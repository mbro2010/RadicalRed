/* Radical Red's damage formula, step for step as the game does it.
 *
 * Radical Red runs on the Complete Fire Red Upgrade (CFRU) battle engine, which does its damage with whole numbers in its
 * own order: base power and its boosts, the attacking and defending stats, the formula, a run of final changes
 * (weather, screens, burn, berries, ...), then the critical hit, then STAB and type effectiveness, and the random
 * roll last of all (85-100%). The standard calculator follows the main-series order instead, so its rolls are often
 * 1-3 HP off. Each step here follows CFRU's damage_calc.c and, where Radical Red changed it, the game's own code
 * (base-power boosts at 0x09085304; Iron Fist x1.3, Gems x1.5, Life Orb on base power, its move lists).
 * Checked against the game's code running in an emulator: tools/game_damage.py, tools/damage_compare.js.
 *
 * rolls(att, def, move, o) -> { rolls: [16 damage values, lowest first], moveType, eff, stab, notes } or null if the move
 * isn't one this handles (the engine then falls back to the calculator).
 *   att / def: { sp (species), lv, st {hp,atk,def,spa,spd,spe} (raw stats), b (stages), ab (ability), it (item: {c,he,hq}),
 *                status ('brn','psn','tox','par','slp','frz' or ''), hp, maxHP, types, firstTurn, charged, ... }
 *   o: { weather, terrain, reflect, lightScreen, auroraVeil, crit, bp (this use's power), spread (doubles, 2 targets) }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.createRRDamage = factory;
})(typeof self !== 'undefined' ? self : this, function createRRDamage(D, eff1, hiddenPowerType) {
  'use strict';
  const L = {};
  for (const [k, ids] of Object.entries(D.moveLists || {})) L[k] = new Set(ids);
  const has = (list, id) => !!(L[list] && L[list].has(id));
  // hold effects (the item's +18 byte) used here
  const HE = { CHOICE: 29, LIGHT_BALL: 45, DEEP_SEA_TOOTH: 35, DEEP_SEA_SCALE: 36, METAL_POWDER: 64, THICK_CLUB: 65, ASSAULT_VEST: 70,
    EVIOLITE: 71, PLATE: 72, LIFE_ORB: 74, LUSTROUS_ORB: 89, GRISEOUS_ORB: 90, EXPERT_BELT: 92, GEM: 94, RESIST_BERRY: 95,
    PROTECTIVE_PADS: 101, AIR_BALLOON: 103, MUSCLE_BAND: 112, RING_TARGET: 114, WISE_GLASSES: 119, TYPE_BOOSTER: 129,
    PUNCHING_GLOVE: 138, SOUL_DEW: 34, IRON_BALL: 98, UTILITY_UMBRELLA: -1 };
  const TYPE_NO = { Normal: 0, Fighting: 1, Flying: 2, Poison: 3, Ground: 4, Rock: 5, Bug: 6, Ghost: 7, Steel: 8, '???': 9, Fire: 10,
    Water: 11, Grass: 12, Electric: 13, Psychic: 14, Ice: 15, Dragon: 16, Dark: 17, Fairy: 23 };
  const TYPE_NAME = Object.fromEntries(Object.entries(TYPE_NO).map(([k, v]) => [v, k]));
  const mul = (x, n, d) => Math.floor(x * n / d);
  const heOf = it => (it && it.he) || 0;
  const hqOf = it => (it && it.hq) || 0;
  // abilities a Mold Breaker-type attacker ignores (the ones that matter for damage)
  // (CFRU switches these off for the length of the move: gMoldBreakerIgnoredAbilities, plus the newer ones)
  const BREAKABLE = new Set(['Battle Armor', 'Clear Body', 'Damp', 'Dry Skin', 'Filter', 'Flash Fire', 'Flower Gift', 'Heatproof',
    'Hyper Cutter', 'Immunity', 'Inner Focus', 'Insomnia', 'Keen Eye', 'Leaf Guard', 'Levitate', 'Lightning Rod', 'Limber',
    'Magma Armor', 'Marvel Scale', 'Motor Drive', 'Oblivious', 'Own Tempo', 'Sand Veil', 'Shell Armor', 'Shield Dust', 'Simple',
    'Snow Cloak', 'Solid Rock', 'Soundproof', 'Sticky Hold', 'Storm Drain', 'Sturdy', 'Suction Cups', 'Tangled Feet', 'Thick Fat',
    'Unaware', 'Vital Spirit', 'Volt Absorb', 'Water Absorb', 'Water Veil', 'White Smoke', 'Wonder Guard', 'Big Pecks', 'Contrary',
    'Friend Guard', 'Heavy Metal', 'Light Metal', 'Magic Bounce', 'Multiscale', 'Sap Sipper', 'Telepathy', 'Wonder Skin',
    'Aroma Veil', 'Bulletproof', 'Flower Veil', 'Fur Coat', 'Overcoat', 'Sweet Veil', 'Dazzling', 'Disguise', 'Fluffy',
    'Queenly Majesty', 'Water Bubble', 'Mirror Armor', 'Punk Rock', 'Ice Scales', 'Ice Face', 'Pastel Veil', 'Prism Armor',
    'Shadow Shield', 'Grass Pelt', 'Purifying Salt', 'Well-Baked Body', 'Earth Eater', 'Wind Rider', 'Armor Tail', 'Primal Armor']);
  const MOLD_BREAKERS = new Set(['Mold Breaker', 'Teravolt', 'Turboblaze']);
  const ATE = { Aerilate: 'Flying', Pixilate: 'Fairy', Refrigerate: 'Ice', Galvanize: 'Electric' };
  const WEATHER_BALL = { Rain: 'Water', 'Heavy Rain': 'Water', Sun: 'Fire', 'Harsh Sunshine': 'Fire', Sand: 'Rock', Hail: 'Ice', Snow: 'Ice' };
  const isRain = w => w === 'Rain' || w === 'Heavy Rain';
  const isSun = w => w === 'Sun' || w === 'Harsh Sunshine';

  function grounded(m) {
    if (heOf(m.it) === HE.IRON_BALL || m.grounded) return true;   // grounded: Smack Down, Thousand Arrows, Ingrain, Gravity
    if (m.floating) return false;                                   // Magnet Rise
    if (m.types.includes('Flying') || m.ab === 'Levitate' || heOf(m.it) === HE.AIR_BALLOON) return false;
    return true;
  }
  // GetMoveTypeSpecial: abilities and moves that change a move's type. Returns [type, boostedByAbility]
  function moveTypeOf(att, move, o) {
    const n = move.f;
    let t = move.t;
    if (n === 'Weather Ball' && o.weather && WEATHER_BALL[o.weather]) t = WEATHER_BALL[o.weather];
    else if (n === 'Hidden Power') t = hiddenPowerType(att.iv);
    else if (n === 'Judgment') t = att.types[0];          // Radical Red: the user's first type (Arceus's follows its plate)
    else if (n === 'Revelation Dance') t = att.types[0];
    else if (n === 'Terrain Pulse' && o.terrain && grounded(att)) t = { Electric: 'Electric', Grassy: 'Grass', Misty: 'Fairy', Psychic: 'Psychic' }[o.terrain] || t;
    const exempt = has('typeChangeException', move.i);
    if (att.ab === 'Normalize' && !exempt) return ['Normal', true];
    if (ATE[att.ab] && t === 'Normal' && !exempt) return [ATE[att.ab], true];
    if (att.ab === 'Liquid Voice' && has('sound', move.i)) return ['Water', true];
    return [t, false];
  }
  function isContact(att, move) {
    if (!((move.fl || 0) & 1)) return false;
    if (att.ab === 'Long Reach' || heOf(att.it) === HE.PROTECTIVE_PADS) return false;
    if (heOf(att.it) === HE.PUNCHING_GLOVE && has('punch', move.i)) return false;
    return true;
  }
  const anyStatus = m => !!m.status;
  const teraShell = m => m.ab === 'Multiscale' && m.hp >= m.maxHP && m.sp.i === 1370;
  // items that can't be knocked off or stolen: Z-Crystals, the holder's own Mega Stone, and the items forms depend on
  function canLoseItem(m) {
    if (!m.it) return false;
    const he = heOf(m.it), n = m.sp.n || '';
    if (he === 130) return false;
    if (he === 73) {                                  // a Mega Stone stays with a Pokemon that uses it, and with any Mega
      for (const [base, list] of Object.entries(D.mega || {})) for (const [stone, form] of list)
        if (stone && ((stone === m.itId && +base === m.sp.i) || form === m.sp.i)) return false;   // (stone 0: a form's way back)
    }
    if ((he === HE.PLATE && /^Arceus/.test(n)) || (he === 87 && /^Silvally/.test(n)) || (he === 86 && /^Genesect/.test(n))
      || (he === HE.GRISEOUS_ORB && /^Giratina/.test(n)) || (he === 93 && /^(Kyogre|Groudon|Dialga)/.test(n)) || (he === 145 && /^Ogerpon/.test(n))) return false;
    return true;
  }
  // the game's own weights (hectograms; a few Radical Red entries are odd, e.g. Fraxure 0), Heavy Metal x2, Float Stone /2
  function weightOf(m) {
    let w = m.sp.wt != null ? m.sp.wt : Math.round((m.sp.w || 10) * 10);
    if (m.ab === 'Heavy Metal') w *= 2;
    if (heOf(m.it) === 107) w = Math.floor(w / 2);
    return w;
  }

  // GetBasePower: moves whose power depends on the battle
  function basePower(att, def, move, o, moveType) {
    let p = move.p;
    if (o.bp > 0) return o.bp;                     // this use's power from the battle (Rollout, Fury Cutter, Echoed Voice, ...)
    switch (move.f) {
      case 'Acrobatics': if (!att.it) p *= 2; break;
      case 'Facade': if (anyStatus(att)) p *= 2; break;
      case 'Brine': if (def.hp < Math.floor(def.maxHP / 2)) p *= 2; break;
      case 'Smelling Salts': if (def.status === 'par') p *= 2; break;
      case 'Wake-Up Slap': if (def.status === 'slp') p *= 2; break;
      case 'Venoshock': if (def.status === 'psn' || def.status === 'tox') p *= 2; break;
      case 'Barb Barrage': if (anyStatus(def)) p *= 2; break;          // Radical Red: any status, not just poison
      case 'Bolt Beak': case 'Fishious Rend': if (att.movesFirst) p *= 2; break;
      case 'Weather Ball': if (o.weather && WEATHER_BALL[o.weather]) p *= 2; break;
      case 'Terrain Pulse': if (o.terrain && grounded(att)) p *= 2; break;
      case 'Psyblade': if (o.terrain === 'Electric') p = mul(p, 15, 10); break;
      case 'Rising Voltage': if (o.terrain === 'Electric' && grounded(def)) p *= 2; break;
      case 'Expanding Force': if (o.terrain === 'Psychic' && grounded(att)) p = mul(p, 15, 10); break;
      case 'Misty Explosion': if (o.terrain === 'Misty' && grounded(att)) p = mul(p, 15, 10); break;
      case 'Eruption': case 'Water Spout': case 'Dragon Energy': p = Math.max(1, Math.floor(150 * att.hp / att.maxHP)); break;
      case 'Flail': case 'Reversal': {
        const r = Math.floor(48 * att.hp / att.maxHP);
        p = r <= 1 ? 200 : r <= 4 ? 150 : r <= 9 ? 100 : r <= 16 ? 80 : r <= 32 ? 40 : 20; break;
      }
      case 'Low Kick': case 'Grass Knot': {
        const w = weightOf(def);
        p = w < 100 ? 20 : w < 250 ? 40 : w < 500 ? 60 : w < 1000 ? 80 : w < 2000 ? 100 : 120; break;
      }
      case 'Heavy Slam': case 'Heat Crash': {
        const dw = weightOf(def), r = dw ? Math.floor(weightOf(att) / dw) : 0;   // (a weight of 0: the game's division gives 0)
        p = r >= 5 ? 120 : r === 4 ? 100 : r === 3 ? 80 : r === 2 ? 60 : 40; break;
      }
      case 'Gyro Ball': p = Math.min(150, Math.floor(25 * speed(def, o) / Math.max(1, speed(att, o))) + 1); break;
      case 'Electro Ball': {
        const r = Math.floor(speed(att, o) / Math.max(1, speed(def, o)));
        p = r >= 4 ? 150 : r === 3 ? 120 : r === 2 ? 80 : 60; break;     // CFRU: never below 60
      }
      case 'Stored Power': case 'Power Trip': p = 20 + 20 * positiveStages(att); break;
      case 'Punishment': p = Math.min(200, 60 + 20 * positiveStages(def)); break;
      case 'Wring Out': case 'Crush Grip': p = Math.max(1, Math.floor(120 * def.hp / def.maxHP)); break;
      // friendship: yours is assumed full; a trainer's Pokemon has full friendship, or none if it knows Frustration
      // (CFRU's ShouldGiveTrainerMonMaxFriendship), so a boss's Frustration hits at full power
      case 'Return': p = Math.max(1, Math.floor((att.fr == null ? 255 : att.fr) * 10 / 25)); break;
      case 'Frustration': p = Math.max(1, Math.floor((255 - (att.fr == null ? 255 : att.fr)) * 10 / 25)); break;
      case 'Magnitude': p = 70; break;                                    // a battle rolls it (o.bp); 70 is the middle magnitude
      case 'Trump Card': p = 40; break;                                   // 40 until its PP runs low (PP isn't tracked)
      default:
        if (has('statusDouble', move.i) && anyStatus(def)) p *= 2;   // Hex, Infernal Parade, Bitter Malice
    }
    return p;
  }
  const positiveStages = m => ['atk', 'def', 'spa', 'spd', 'spe', 'accuracy', 'evasion'].reduce((s, k) => s + Math.max(0, (m.b && m.b[k]) || 0), 0);
  function speed(m, o) {
    if (m.spe != null) return m.spe;                 // the engine's SpeedCalc (items, abilities, weather)
    let s = applyStage(m.st.spe, (m.b && m.b.spe) || 0);
    if (m.status === 'par') s = Math.floor(s / 2);
    return s;
  }
  const RATIO = [[10, 40], [10, 35], [10, 30], [10, 25], [10, 20], [10, 15], [10, 10], [15, 10], [20, 10], [25, 10], [30, 10], [35, 10], [40, 10]];
  function applyStage(v, stage) { const r = RATIO[Math.max(0, Math.min(12, 6 + stage))]; return Math.floor(v * r[0] / r[1]); }

  // AdjustBasePower: Radical Red's base-power boosts (read from the game's code at 0x09085304)
  function adjustBasePower(att, def, move, o, power, ctx) {
    const { moveType, physical, se } = ctx;
    const tablePower = move.p;
    if ((move.f === 'Electro Drift' || move.f === 'Collision Course') && se) power = mul(power, 13, 10);
    switch (att.ab) {
      case 'Technician': if (tablePower <= 60 && move.i <= 0x34F && (move.f !== 'Acrobatics' || att.it)) power = mul(power, 15, 10); break;
      case 'Rivalry': if (att.gender && def.gender && att.gender === def.gender) power = mul(power, 125, 100); break;
      case 'Reckless': if (has('reckless', move.i)) power = mul(power, 12, 10); break;
      case 'Sheer Force': if (has('sheerForce', move.i)) power = mul(power, 13, 10); break;
      case 'Iron Fist': if (has('punch', move.i)) power = mul(power, 13, 10); break;
      case 'Sand Force': if (o.weather === 'Sand' && ['Ground', 'Rock', 'Steel'].includes(moveType)) power = mul(power, 13, 10); break;
      case 'Bull Rush': if (att.firstTurn) power = mul(power, 12, 10); break;
      case 'Analytic': if (att.movesLast) power = mul(power, 13, 10); break;
      case 'Mega Launcher': if (has('pulse', move.i)) power = mul(power, 15, 10); break;
      case 'Tough Claws': if (isContact(att, move)) power = mul(power, 13, 10); break;
      case 'Strong Jaw': if (has('bite', move.i)) power = mul(power, 15, 10); break;
      case 'Aerilate': case 'Pixilate': case 'Refrigerate': case 'Galvanize': case 'Normalize': case 'Liquid Voice':
        if (ctx.ateBoost) power = mul(power, 12, 10); break;
      case 'Toxic Boost': if ((att.status === 'psn' || att.status === 'tox') && physical) power = mul(power, 15, 10); break;
      case 'Flare Boost': if (att.status === 'brn' && !physical) power = mul(power, 15, 10); break;
      case 'Steely Spirit': if (moveType === 'Steel') power = mul(power, 15, 10); break;
      case 'Water Bubble': if (moveType === 'Water') power *= 2; break;
      case 'Transistor': if (moveType === 'Electric') power = mul(power, 15, 10); break;
      case "Dragon's Maw": if (moveType === 'Dragon') power = mul(power, 15, 10); break;
      case 'Rocky Payload': if (moveType === 'Rock') power = mul(power, 15, 10); break;
      case 'Illusion': if (att.disguised) power = mul(power, 13, 10); break;
      case 'Stakeout': if (def.justSwitchedIn) power *= 2; break;
      case 'Neuroforce': if (se) power = mul(power, 125, 100); break;
      case 'Fatal Precision': if (se) power = mul(power, 12, 10); break;
      case 'Striker': if (has('kick', move.i)) power = mul(power, 13, 10); break;
      case 'Sharpness': if (has('slice', move.i)) power = mul(power, 15, 10); break;
      case 'Punk Rock': if (has('sound', move.i)) power = mul(power, 13, 10); break;
    }
    const he = heOf(att.it), hq = hqOf(att.it), sid = att.sp.i;
    switch (he) {
      case HE.LIFE_ORB: power = mul(power, 13, 10); break;
      case HE.SOUL_DEW: if ((moveType === 'Psychic' || moveType === 'Dragon') && /^Lati(as|os)/.test(att.sp.n)) power = mul(power, 12, 10); break;
      case HE.PLATE: case HE.TYPE_BOOSTER: if (TYPE_NO[moveType] === hq) power = mul(power, 12, 10); break;
      case HE.PUNCHING_GLOVE: if (has('punch', move.i)) power = mul(power, 11, 10); break;
      case HE.WISE_GLASSES: if (!physical) power = mul(power, 11, 10); break;
      case HE.MUSCLE_BAND: if (physical) power = mul(power, 11, 10); break;
      case HE.GRISEOUS_ORB: if ((moveType === 'Ghost' || moveType === 'Dragon') && /^Giratina/.test(att.sp.n)) power = mul(power, 12, 10); break;
      case HE.LUSTROUS_ORB: if ((moveType === 'Water' || moveType === 'Dragon') && /^Palkia/.test(att.sp.n)) power = mul(power, 12, 10); break;
      case HE.GEM: if (TYPE_NO[moveType] === hq) { power = mul(power, 15, 10); ctx.notes.push('Gem: ×1.5 (Radical Red), used up'); } break;
    }
    if (att.charged && moveType === 'Electric') power *= 2;
    if (att.ab === 'Supreme Overlord' && att.faintedAllies) power = mul(power, 10 + Math.min(5, att.faintedAllies), 10);   // +10% per fainted ally (Gen 9)
    if (o.terrain) {
      if (o.terrain === 'Electric' && moveType === 'Electric' && grounded(att)) power = mul(power, 13, 10);
      else if (o.terrain === 'Grassy') {
        if (moveType === 'Grass' && grounded(att)) power = mul(power, 13, 10);
        if (['Earthquake', 'Bulldoze', 'Magnitude'].includes(move.f) && grounded(def)) power = Math.floor(power / 2);
      } else if (o.terrain === 'Misty' && moveType === 'Dragon' && grounded(def)) power = Math.floor(power / 2);
      else if (o.terrain === 'Psychic' && moveType === 'Psychic' && grounded(att)) power = mul(power, 13, 10);
    }
    return power;
  }

  /** The 16 damage rolls for one hit. */
  function rolls(att, def, move, o) {
    if (!move || move.k === 'X') return null;
    const notes = [];
    o = o || {};
    // the defender's ability doesn't count against Mold Breaker and the moves that ignore abilities
    if ((MOLD_BREAKERS.has(att.ab) || has('moldBreaker', move.i)) && BREAKABLE.has(def.ab)) def = Object.assign({}, def, { ab: null });
    const [moveType, ateBoost] = moveTypeOf(att, move, o);
    let physical = move.k === 'P';
    if (move.f === 'Photon Geyser' && applyStage(att.st.atk, att.b.atk || 0) > applyStage(att.st.spa, att.b.spa || 0)) physical = true;
    const typed = typeOf(att, def, move, moveType, o);
    const eff = typed.total;
    // moves that never land: absorbing abilities and the other immunities the game checks before its damage step
    const blocked = immuneBy(att, def, move, moveType, eff, o);
    if (blocked) return { rolls: new Array(16).fill(0), moveType, eff: 0, stab: false, notes: [blocked], immune: blocked,
      contact: isContact(att, move), punch: has('punch', move.i), sound: has('sound', move.i) };
    const se = eff > 1, nve = eff > 0 && eff < 1;
    const crit = !!o.crit;
    const ctx = { moveType, physical, se, ateBoost, notes };

    // stats and their stages
    let attack, spAttack, atkStage, spaStage;
    if (move.f === 'Body Press') { attack = att.st.def; spAttack = att.st.spd; atkStage = att.b.def || 0; spaStage = att.b.spd || 0; }
    else if (move.f === 'Foul Play') { attack = def.st.atk; spAttack = def.st.spa; atkStage = def.b.atk || 0; spaStage = def.b.spa || 0; }
    else { attack = att.st.atk; spAttack = att.st.spa; atkStage = att.b.atk || 0; spaStage = att.b.spa || 0; }
    let defense = def.st.def, spDefense = def.st.spd;
    const defStage = def.b.def || 0, spdStage = def.b.spd || 0;

    let power = basePower(att, def, move, o, moveType);
    power = adjustBasePower(att, def, move, o, power, ctx);

    // attacker abilities on stats
    const pinch = att.hp <= Math.floor(att.maxHP / 3);
    switch (att.ab) {
      case 'Huge Power': case 'Pure Power': attack *= 2; break;
      case 'Hustle': attack = mul(attack, 15, 10); break;
      case 'Guts': if (anyStatus(att)) attack = mul(attack, 15, 10); break;
      case 'Solar Power': if (isSun(o.weather)) spAttack = mul(spAttack, 15, 10); break;
      case 'Defeatist': if (pinch) { attack = Math.floor(attack / 2); spAttack = Math.floor(spAttack / 2); } break;   // Radical Red: at 1/3 HP
      case 'Flash Fire': if (att.flashFire && moveType === 'Fire') spAttack = mul(spAttack, 15, 10); break;
      case 'Overgrow': if (moveType === 'Grass' && pinch) { attack = mul(attack, 15, 10); spAttack = mul(spAttack, 15, 10); } break;
      case 'Blaze': if (moveType === 'Fire' && pinch) { attack = mul(attack, 15, 10); spAttack = mul(spAttack, 15, 10); } break;
      case 'Torrent': if (moveType === 'Water' && pinch) { attack = mul(attack, 15, 10); spAttack = mul(spAttack, 15, 10); } break;
      case 'Swarm': if (moveType === 'Bug' && pinch) { attack = mul(attack, 15, 10); spAttack = mul(spAttack, 15, 10); } break;
      case 'Gorilla Tactics': attack = mul(attack, 15, 10); break;
      case 'Feline Prowess': spAttack *= 2; break;
      case 'Sage Power': spAttack = mul(spAttack, 15, 10); break;
      case 'Orichalcum Pulse': if (isSun(o.weather) && !(att.it && att.it.c === 'Utility Umbrella')) attack = mul(attack, 4, 3); break;
      case 'Hadron Engine': if (o.terrain === 'Electric') spAttack = mul(spAttack, 4, 3); break;
    }
    // Protosynthesis and Quark Drive, switched on: x1.3 to the highest stat (worked out when they switch on)
    if (att.qp === 'atk') attack = mul(attack, 13, 10); else if (att.qp === 'spa') spAttack = mul(spAttack, 13, 10);
    if (def.qp === 'def') defense = mul(defense, 13, 10); else if (def.qp === 'spd') spDefense = mul(spDefense, 13, 10);
    // defender abilities on stats
    switch (def.ab) {
      case 'Marvel Scale': if (anyStatus(def)) defense = mul(defense, 15, 10); break;
      case 'Grass Pelt': if (o.terrain === 'Grassy') defense = mul(defense, 15, 10); break;
      case 'Thick Fat': if (moveType === 'Fire' || moveType === 'Ice') { attack = Math.floor(attack / 2); spAttack = Math.floor(spAttack / 2); } break;
      case 'Fur Coat': defense *= 2; break;
    }
    // attacker items on stats
    const ahe = heOf(att.it);
    if (ahe === HE.CHOICE) { if (hqOf(att.it) === 0) attack = mul(attack, 15, 10); else if (hqOf(att.it) === 1) spAttack = mul(spAttack, 15, 10); }
    else if (ahe === HE.THICK_CLUB && /^(Cubone|Marowak)/.test(att.sp.n)) attack *= 2;
    else if (ahe === HE.LIGHT_BALL && /^Pikachu/.test(att.sp.n)) { attack *= 2; spAttack *= 2; }
    else if (ahe === HE.DEEP_SEA_TOOTH && /^Clamperl/.test(att.sp.n)) spAttack *= 2;
    // defender items on stats
    const dhe = heOf(def.it);
    if (dhe === HE.METAL_POWDER && /^Ditto/.test(def.sp.n)) defense *= 2;
    else if (dhe === HE.DEEP_SEA_SCALE && /^Clamperl/.test(def.sp.n)) spDefense *= 2;
    else if (dhe === HE.EVIOLITE && def.sp.ce) { defense = mul(defense, 15, 10); spDefense = mul(spDefense, 15, 10); }
    else if (dhe === HE.ASSAULT_VEST) spDefense = mul(spDefense, 15, 10);
    if (o.weather === 'Sand' && def.types.includes('Rock')) spDefense = mul(spDefense, 15, 10);
    if ((o.weather === 'Hail' || o.weather === 'Snow') && def.types.includes('Ice')) defense = mul(defense, 15, 10);   // Radical Red's hail works like snow
    // the old Explosion: the target's defence counts half
    if (move.f === 'Explosion' || move.f === 'Self-Destruct') defense = Math.floor(defense / 2);
    else if (move.f === 'Misty Explosion') spDefense = Math.floor(spDefense / 2);
    // the Ruin abilities lower everyone else's stat by a quarter
    if (att.ab === 'Sword of Ruin' && def.ab !== 'Sword of Ruin') defense = mul(defense, 75, 100);
    if (att.ab === 'Beads of Ruin' && def.ab !== 'Beads of Ruin') spDefense = mul(spDefense, 75, 100);
    if (def.ab === 'Tablets of Ruin' && att.ab !== 'Tablets of Ruin') attack = mul(attack, 75, 100);
    if (def.ab === 'Vessel of Ruin' && att.ab !== 'Vessel of Ruin') spAttack = mul(spAttack, 75, 100);
    // stages: a critical hit ignores the attacker's drops and the target's raises
    if (def.ab !== 'Unaware') {
      if (!crit || atkStage > 0) attack = applyStage(attack, atkStage);
      if (!crit || spaStage > 0) spAttack = applyStage(spAttack, spaStage);
    }
    if (att.ab !== 'Unaware' && !has('ignoreStatChanges', move.i)) {
      if (!crit || defStage < 0) defense = applyStage(defense, defStage);
      if (!crit || spdStage < 0) spDefense = applyStage(spDefense, spdStage);
    }

    // the formula
    let damage = Math.floor(2 * att.lv / 5) + 2;
    damage *= power;
    if (has('specialAttackPhysicalDamage', move.i)) damage = Math.floor(damage * spAttack / Math.max(1, defense));
    else if (physical) damage = Math.floor(damage * attack / Math.max(1, defense));
    else damage = Math.floor(damage * spAttack / Math.max(1, spDefense));
    damage = Math.floor(damage / 50) + 2;

    // final changes, in the game's order
    if (move.f === 'Knock Off' && canLoseItem(def)) damage = mul(damage, 15, 10);
    if ((move.f === 'Solar Beam' || move.f === 'Solar Blade') && o.weather && !isSun(o.weather)) damage = Math.floor(damage / 2);
    const weatherOn = o.weather && !o.noWeather;
    if (weatherOn && !(def.it && def.it.c === 'Utility Umbrella')) {
      if (isRain(o.weather)) { if (moveType === 'Fire') damage = Math.floor(damage / 2); else if (moveType === 'Water') damage = mul(damage, 15, 10); }
      else if (isSun(o.weather)) {
        if (moveType === 'Fire' || move.f === 'Hydro Steam') damage = mul(damage, 15, 10);   // Hydro Steam is stronger in sun
        else if (moveType === 'Water') damage = Math.floor(damage / 2);
      }
    }
    if ((moveType === 'Dark' && (o.darkAura || att.ab === 'Dark Aura' || def.ab === 'Dark Aura')) || (moveType === 'Fairy' && (o.fairyAura || att.ab === 'Fairy Aura' || def.ab === 'Fairy Aura'))) {
      damage = (o.auraBreak || att.ab === 'Aura Break' || def.ab === 'Aura Break') ? mul(damage, 75, 100) : mul(damage, 4, 3);
    }
    if (att.ab === 'Tinted Lens' && nve) damage *= 2;
    else if (att.ab === 'Sniper' && crit) damage = mul(damage, 15, 10);
    if (ahe === HE.EXPERT_BELT && se) damage = mul(damage, 12, 10);
    switch (def.ab) {
      case 'Dry Skin': if (moveType === 'Fire') damage = mul(damage, 125, 100); break;
      case 'Solid Rock': case 'Filter': case 'Prism Armor': if (se) damage = mul(damage, 75, 100); break;
      case 'Primal Armor': if (se) damage = Math.floor(damage / 2); break;          // Radical Red: super-effective hits x0.5
      case 'Heatproof': case 'Water Bubble': if (moveType === 'Fire') damage = Math.floor(damage / 2); break;
      case 'Multiscale': case 'Shadow Shield': if (def.hp >= def.maxHP && !teraShell(def)) damage = Math.floor(damage / 2); break;
      case 'Fluffy': if (moveType === 'Fire') damage *= 2; if (isContact(att, move)) damage = Math.floor(damage / 2); break;
      case 'Punk Rock': if (has('sound', move.i)) damage = Math.floor(damage / 2); break;
      case 'Ice Scales': if (!physical) damage = Math.floor(damage / 2); break;
      case 'Purifying Salt': if (moveType === 'Ghost') damage = Math.floor(damage / 2); break;
    }
    if (dhe === HE.RESIST_BERRY && att.ab !== 'Unnerve' && ((se && hqOf(def.it) === TYPE_NO[moveType]) || (hqOf(def.it) === 0 && moveType === 'Normal'))) {
      damage = def.ab === 'Ripen' ? Math.floor(damage / 3) : Math.floor(damage / 2);
      notes.push('Resist Berry: halves this hit, then it is used up');
    }
    const screen = physical ? o.reflect : o.lightScreen;
    if ((screen || o.auroraVeil) && !crit && att.ab !== 'Infiltrator' && !['Brick Break', 'Psychic Fangs', 'Raging Bull'].includes(move.f)) {
      damage = o.spread ? mul(damage, 2, 3) : Math.floor(damage / 2);
    }
    if (physical && att.status === 'brn' && att.ab !== 'Guts' && move.f !== 'Facade') damage = Math.floor(damage / 2);
    else if (!physical && att.status === 'frz') damage = Math.floor(damage / 2);          // frostbite (Radical Red's freeze) halves special moves
    if (o.parentalBond) damage = Math.floor(damage / 4);                // Parental Bond's second hit
    if (o.spread) damage = mul(damage, 75, 100);
    if (damage === 0) damage = 1;

    // critical hit (atk05), then STAB and type (atk06), then the random roll (atk07)
    if (crit) damage = mul(damage, 15, 10);
    const stab = att.types.includes(moveType) || att.ab === 'Protean' || att.ab === 'Libero';   // Protean takes the move's type first
    if (stab) damage = att.ab === 'Adaptability' ? damage * 2 : mul(damage, 15, 10);
    if (eff === 0) return { rolls: new Array(16).fill(0), moveType, eff: 0, stab, notes };
    for (const m of typed.steps) damage = Math.max(1, mul(damage, m, 10));
    // Terapagos's ability (Multiscale's number, shown as Tera Shell) at full HP: x0.5 for each of its type slots and the blank third one
    if (teraShell(def)) for (let k = 0; k <= new Set(def.types.slice(0, 2)).size; k++) damage = Math.max(1, mul(damage, 5, 10));
    const out = [];
    for (let r = 85; r <= 100; r++) out.push(Math.max(1, mul(damage, r, 100)));
    return { rolls: out, moveType, eff, stab, notes, contact: isContact(att, move), punch: has('punch', move.i), sound: has('sound', move.i) };

  }

  const ABSORB_TYPE = { 'Volt Absorb': 'Electric', 'Motor Drive': 'Electric', 'Lightning Rod': 'Electric', 'Water Absorb': 'Water',
    'Storm Drain': 'Water', 'Dry Skin': 'Water', 'Flash Fire': 'Fire', 'Well-Baked Body': 'Fire', 'Sap Sipper': 'Grass',
    'Earth Eater': 'Ground', 'Mountaineer': 'Rock' };
  function immuneBy(att, def, move, moveType, eff, o) {
    const a = def.ab;
    if (a && ABSORB_TYPE[a] === moveType) return a;
    if (a === 'Wonder Guard' && eff <= 1) return a;
    if (a === 'Soundproof' && has('sound', move.i)) return a;
    if (a === 'Bulletproof' && has('ballBomb', move.i)) return a;
    if (a === 'Wind Rider' && has('wind', move.i)) return a;
    const prio = o.priority != null ? o.priority : (move.r || 0);
    if (prio > 0 && ['Dazzling', 'Queenly Majesty', 'Armor Tail'].includes(a)) return a;
    if (prio > 0 && o.terrain === 'Psychic' && grounded(def)) return 'Psychic Terrain';
    if (o.weather === 'Heavy Rain' && moveType === 'Fire') return 'Heavy Rain';
    if (o.weather === 'Harsh Sunshine' && moveType === 'Water') return 'Harsh Sunshine';
    return null;
  }

  // atk06 typecalc: each of the target's types in turn (x2 = 20, x0.5 = 5, immune = 0, in tenths)
  function typeOf(att, def, move, moveType, o) {
    const steps = [];
    let total = 1;
    const seen = [];
    const types = def.types.slice(0, 2);
    const ground = moveType === 'Ground';
    for (const dt of types) {
      if (seen.includes(dt)) continue;
      seen.push(dt);
      let e = eff1(moveType, dt);
      if (e === 0) {
        if (dt === 'Ghost' && (moveType === 'Normal' || moveType === 'Fighting') && (att.ab === 'Scrappy' || def.foresight)) e = 1;
        else if (heOf(def.it) === HE.RING_TARGET) e = 1;
        else if (ground && move.f === 'Thousand Arrows') e = 1;
        else if (ground && heOf(def.it) === HE.IRON_BALL) e = 1;
        else if (ground && def.grounded && dt === 'Flying') e = 1;
      }
      if (move.f === 'Freeze-Dry' && dt === 'Water') e = 2;
      if (dt === 'Flying' && e === 2 && o.weather === 'Strong Winds') e = 1;
      if (att.ab === 'Bone Zone' && has('bone', move.i) && e < 1) e = 1;   // Radical Red: bone moves ignore resistances and immunities
      if (e === 2) steps.push(20); else if (e === 0.5) steps.push(5); else if (e === 0) steps.push(0);
      total *= e;
    }
    if (move.f === 'Flying Press') {
      for (const dt of seen) { const e = eff1('Flying', dt); if (e === 2) steps.push(20); else if (e === 0.5) steps.push(5); else if (e === 0) steps.push(0); total *= e; }
    }
    // a Ground move misses a target in the air (Levitate, Air Balloon), unless it's grounded some other way
    if (ground && move.f !== 'Thousand Arrows' && heOf(def.it) !== HE.IRON_BALL && !def.grounded && (def.ab === 'Levitate' || heOf(def.it) === HE.AIR_BALLOON || def.floating)) total = 0;
    return { total, steps };
  }

  return { rolls, has, lists: L, grounded };
});
