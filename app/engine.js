/* Nuzlocke Coach engine: Radical Red 4.1 data on top of @smogon/calc.
 * Works in the browser (window.calc from the calculator's bundle) and in Node (tests).
 * All numbers come from the calculator, fed with Radical Red's own stats, types and move data. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.createEngine = factory;
})(typeof self !== 'undefined' ? self : this, function createEngine(C, D) {
  'use strict';
  const gen = C.Generations.get(9);
  const toID = C.toID;
  const STAT = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
  const species = new Map(D.species.map(s => [s.i, s]));
  // Radical Red's own damage formula (app/damage.js); the calculator is the fallback for what it doesn't cover
  const RRD = (typeof module === 'object' && module && module.exports && typeof require === 'function') ? require('./damage.js')
    : (typeof self !== 'undefined' ? self : this).createRRDamage;
  const moves = new Map(D.moves.map(m => [m.i, m]));
  const banned = new Set(D.bans.moves);
  const condBanned = new Set(D.bans.cond);
  const condOK = new Set(D.bans.condSpecies);

  // ---- custom (Radical Red only) ability effects, from their in-game descriptions ----
  const STAT_MULT = { 'Feline Prowess': { spa: 2 }, 'Sage Power': { spa: 1.5 } };
  const KICK = /Kick|Triple Axel/;
  const BONE = /^(Bone Club|Bonemerang|Bone Rush|Shadow Bone)$/;
  const HIGH_CRIT = new Set(['Slash', 'Night Slash', 'Leaf Blade', 'Cross Chop', 'Stone Edge', 'Karate Chop', 'Psycho Cut', 'Shadow Claw',
    'Crabhammer', 'Razor Leaf', 'Air Cutter', 'Aeroblast', 'Attack Order', 'Blaze Kick', 'Cross Poison', 'Drill Run', 'Poison Tail',
    'Sky Attack', 'Spacial Rend', 'Razor Wind', 'Snipe Shot', 'Esper Wing', 'Aqua Cutter', 'Ivy Cudgel', 'Triple Arrows', 'Shadow Blast']);
  const ALWAYS_CRIT = new Set(['Frost Breath', 'Storm Throw', 'Wicked Blow', 'Surging Strikes', 'Flower Trick', 'Zippy Zap']);
  // the game's own lists, where the data has them (Radical Red adds Drill Peck and Razor Shell to the high-crit moves)
  for (const [k, set] of [['highCrit', HIGH_CRIT], ['alwaysCrit', ALWAYS_CRIT]]) {
    const ids = D.moveLists && D.moveLists[k];
    if (ids && ids.length) { set.clear(); for (const i of ids) { const m = D.moves.find(x => x.i === i); if (m) set.add(m.f); } }
  }
  const WEATHER_SETTERS = { Drizzle: 'Rain', 'Primordial Sea': 'Heavy Rain', Drought: 'Sun', 'Desolate Land': 'Harsh Sunshine',
    'Orichalcum Pulse': 'Sun', 'Sand Stream': 'Sand', 'Snow Warning': 'Snow' };
  const STATUS_CODE = { 8: 'psn', 16: 'brn', 32: 'frz', 64: 'par', 128: 'tox' };

  // carry stat multipliers through the calculator's internal clone()
  const origClone = C.Pokemon.prototype.clone;
  C.Pokemon.prototype.clone = function () {
    const c = origClone.call(this);
    if (this._mult) {
      c._mult = this._mult;
      for (const k in this._mult) { c.rawStats[k] = Math.floor(c.rawStats[k] * this._mult[k]); c.stats[k] = c.rawStats[k]; }
    }
    return c;
  };

  // ---- memoization: damage rolls don't depend on current HP except for a few abilities and moves ----
  const HP_SENSITIVE_AB = new Set(['Blaze', 'Torrent', 'Overgrow', 'Swarm', 'Defeatist', 'Multiscale', 'Shadow Shield', 'Tera Shell', 'Berserk', 'Anger Shell']);
  const HP_SENSITIVE_MV = /^(Eruption|Water Spout|Dragon Energy|Flail|Reversal|Brine|Wring Out|Crush Grip|Hard Press|Final Gambit|Endeavor|Super Fang|Ruination|Nature's Madness)$/;
  const cache = new Map();
  function memo(key, fn) { let v = cache.get(key); if (v === undefined) { v = fn(); if (cache.size > 200000) cache.clear(); cache.set(key, v); } return v; }
  // frozen specs (the AI builds one per battler per decision) keep their key, so it's built once
  const frozenKeys = new WeakMap();
  function specKey(spec, hpRelevant) {
    if (Object.isFrozen(spec)) {
      let k = frozenKeys.get(spec);
      if (!k) { k = {}; frozenKeys.set(spec, k); }
      const slot = hpRelevant ? String(hpRelevant) : '0';
      return k[slot] || (k[slot] = specKeyRaw(spec, hpRelevant));
    }
    return specKeyRaw(spec, hpRelevant);
  }
  // how much of current HP a damage roll depends on: pinch abilities only care about 1/3, Multiscale about full HP,
  // Defeatist and Berserk about half; HP-based moves (Eruption, Flail, ...) need the HP itself
  const PINCH = new Set(['Blaze', 'Torrent', 'Overgrow', 'Swarm']), FULL_HP = new Set(['Multiscale', 'Shadow Shield', 'Tera Shell']);
  // (the game compares whole HP: at or below a third of max HP for the pinch abilities and Radical Red's Defeatist)
  function hpPart(spec, mode) {
    const pct = spec.hpPct == null ? 100 : spec.hpPct;
    if (mode === 'roll') {
      if (pct >= 100) return 'F';
      if (PINCH.has(spec.ab) || spec.ab === 'Defeatist') {
        const mx = maxHP(spec), hp = Math.max(1, Math.round(mx * pct / 100));
        return hp <= Math.floor(mx / 3) ? 'L' : 'H';
      }
      if (FULL_HP.has(spec.ab)) return 'D';
      if (HP_SENSITIVE_AB.has(spec.ab)) return pct <= 50 ? 'L' : 'H';
      return '';
    }
    return Math.round(pct * 10);
  }
  function specKeyRaw(spec, hpRelevant) {
    const b = spec.boosts || {};
    return [spec.s, spec.lv, spec.nat, spec.ab, spec.it || 0, spec.iv ? spec.iv.join('.') : '', spec.ev ? spec.ev.join('.') : '', b.atk || 0, b.def || 0, b.spa || 0, b.spd || 0, b.spe || 0,
      spec.status || (spec.st ? STATUS_CODE[spec.st] : ''), spec.firstTurn ? 1 : 0, spec.entry === false ? 0 : 1, spec.movesFirst ? 1 : 0, spec.movesLast ? 1 : 0,
      hpRelevant ? hpPart(spec, hpRelevant) : '', spec.fr == null ? '' : spec.fr, spec.types ? spec.types.join('/') : '', spec.grounded ? 'g' : '', spec.floating ? 'f' : '',
      spec.charged ? 'c' : '', spec.faintedAllies || ''].join(',');
  }
  const HP_TYPES = ['Fighting', 'Flying', 'Poison', 'Ground', 'Rock', 'Bug', 'Ghost', 'Steel', 'Fire', 'Water', 'Grass', 'Electric', 'Psychic', 'Ice', 'Dragon', 'Dark'];
  /** Hidden Power's type from IVs (order hp, atk, def, spa, spd, spe). Perfect IVs give Dark. */
  function hiddenPowerType(iv) {
    const v = iv || [31, 31, 31, 31, 31, 31];
    const bits = [v[0] & 1, v[1] & 1, v[2] & 1, v[5] & 1, v[3] & 1, v[4] & 1];
    return HP_TYPES[Math.floor(bits.reduce((s, x, i) => s + (x << i), 0) * 15 / 63)];
  }

  /** Hardcore and Restricted Mode change some of your Pokemon's abilities (decoded from the game's code at 0x09079584,
   *  which the ability getters call when flag 0x1034 or 0x103C is set). Applied to your side only, as the game describes it. */
  // The difficulty: 'hardcore' (Hardcore Mode) or 'normal' (Normal Mode with Minimal Grinding). Hardcore bans some
  // moves and changes some abilities for the player; outside Hardcore, bosses whose level follows yours come in 2
  // levels lower (until the game is cleared). Minimal Grinding drops trainer EVs in both (the data has none).
  let MODE = 'hardcore', REL = 0;
  function setMode(mode, cleared) { MODE = mode === 'normal' ? 'normal' : 'hardcore'; REL = MODE === 'normal' && !cleared ? -2 : 0; }
  function getMode() { return MODE; }
  function hardcoreAbility(ab, sid) {
    if (MODE !== 'hardcore') return ab;
    switch (ab) {
      case 'Drizzle': case 'Primordial Sea': return 'Adaptability';
      case 'Drought': case 'Desolate Land': return 'Sheer Force';
      case 'Speed Boost': return sid === 891 ? 'Striker' : (sid === 1320 || sid === 1321) ? ab : 'Infiltrator';
      case 'Trace': return 'Synchronize';
      case 'Sand Stream': return sid === 248 || sid === 889 ? 'Intimidate' : sid === 579 ? 'Solid Rock' : 'Sand Force';
      case 'Snow Warning': return 'Slush Rush';
      case 'Magic Bounce': return 'Magic Guard';
      case 'Anger Shell': return 'Regenerator';
      case 'Moxie': case 'Beast Boost': case 'Soul-Heart': case 'Grim Neigh': return 'Unnerve';
      case 'Seed Sower': case 'Grassy Surge': return sid === 1104 ? 'Intimidate' : 'Self Sufficient';
      case 'Defiant': case 'Competitive': return 'Clear Body';
      case 'Hadron Engine': return 'Quark Drive';
      case 'OrichalcumPulse': return 'Protosynthesis';
      case 'Stamina': return 'Inner Focus';
      case 'Triage': return sid === 981 ? ab : 'Natural Cure';
      case 'Electric Surge': case 'Misty Surge': return 'Telepathy';
      case 'Psychic Surge': return 'Dazzling';
      case 'Contrary': return sid === 308 ? ab : 'Bad Company';
      case 'Imposter': return 'Limber';
      case 'Toxic Debris': return 'Corrosion';
      case 'Sand Spit': return 'Sand Force';
      case 'Blazing Soul': return 'Flash Fire';
      default: return ab;
    }
  }
  function sp(id) { return species.get(id); }
  function mv(id) { return moves.get(id); }
  const FRUSTRATION = (D.moves.find(m => (m.f || m.n) === 'Frustration') || {}).i;
  // the full name where the calculator has one (the ROM shortens 58 of them: "HeavyDBoots", "WeaknessPol."), so every
  // check by name works and the page shows the real name
  function itemName(id) { return id && D.items[id] ? D.items[id].c || D.items[id].n : null; }
  function natureName(i) { return D.natures[i] ? D.natures[i].n : 'Hardy'; }
  // The ROM spells some abilities its own way ("SupremeOverlord", "ThermalExchange", "Sword Of Ruin", "Bone Zone "): one
  // spelling everywhere, the calculator's where it has one, so every check by name works on both sides
  const AB_CANON = {}, AB_ROM = {};
  for (const [rom, v] of Object.entries(D.abilities || {})) {
    const canon = v && v.c && !/\(/.test(v.c) ? v.c : rom.trim();
    AB_CANON[rom] = canon; AB_CANON[rom.trim()] = canon; AB_ROM[canon] = rom;
  }
  function canonAbility(ab) { if (!ab) return ab || null; const t = String(ab).trim(); return AB_CANON[t] || AB_CANON[ab] || t; }
  function abilityInfo(name) { if (!name) return { c: null, d: '' }; const t = String(name).trim(); return D.abilities[name] || D.abilities[t] || D.abilities[AB_ROM[t]] || { c: null, d: '' }; }

  function typeEff(moveType, defTypes) {
    const t = gen.types.get(toID(moveType));
    if (!t) return 1;
    return defTypes.reduce((e, d) => e * (t.effectiveness[d] ?? 1), 1);
  }

  /** spec: {s, lv, nat, ab, it, mv, iv?, boosts?, hpPct?, status?, firstTurn?} */
  function buildMon(spec) {
    const s = sp(spec.s);
    if (!s) throw new Error('Unknown species ' + spec.s);
    const ab = abilityInfo(spec.ab);
    const item = spec.it ? (D.items[spec.it] || {}).c : null;
    const ivs = {}; const evs = {};
    STAT.forEach((k, i) => { ivs[k] = spec.iv ? spec.iv[i] : 31; evs[k] = spec.ev ? spec.ev[i] || 0 : 0; });
    const boosts = Object.assign({}, spec.boosts || {});
    if (spec.ab === 'Valiant Shield' && spec.entry !== false) boosts.def = Math.min(6, (boosts.def || 0) + 1);
    const opts = {
      level: spec.lv, nature: natureName(spec.nat), ability: ab.c || 'No Ability', ivs, evs, boosts,
      status: spec.status || (spec.st ? STATUS_CODE[spec.st] || '' : ''),
      overrides: { baseStats: Object.fromEntries(STAT.map((k, i) => [k, s.s[i]])), types: s.t, weightkg: s.w },
    };
    if (item) opts.item = item;
    // Protosynthesis and Quark Drive: the calculator works out the raised stat itself once told to (Booster Energy, sun, Electric Terrain)
    if (spec.ab === 'Protosynthesis' || spec.ab === 'Quark Drive') opts.boostedStat = 'auto';
    const p = new C.Pokemon(gen, s.c || 'Mew', opts);
    if (STAT_MULT[spec.ab]) {
      p._mult = STAT_MULT[spec.ab];
      for (const k in p._mult) { p.rawStats[k] = Math.floor(p.rawStats[k] * p._mult[k]); p.stats[k] = p.rawStats[k]; }
    }
    if (spec.hpPct != null && spec.hpPct < 100) p.originalCurHP = Math.max(1, Math.round(p.maxHP() * spec.hpPct / 100));
    return p;
  }

  function buildMove(id, attackerSpec, { maxHits = false, crit = false, z = false, bp = 0 } = {}) {
    const m = mv(id);
    const opts = { isCrit: crit };
    let name = m.c;
    const overrides = {};
    if (z && m.z) {                                // Z-Move: one hit at the ROM's Z-power, same type and category
      name = m.k === 'P' ? 'Tackle' : 'Swift';
      Object.assign(overrides, { basePower: m.z, type: m.t === '???' ? 'Normal' : m.t, category: m.k === 'P' ? 'Physical' : 'Special', priority: 0 });
    } else if (!name) {                                   // Radical Red's own move: a neutral stand-in with its real numbers
      name = m.k === 'P' ? 'Tackle' : m.k === 'S' ? 'Swift' : 'Growl';
      Object.assign(overrides, { basePower: m.p, type: m.t, category: { P: 'Physical', S: 'Special', X: 'Status' }[m.k], priority: m.r });
    } else if (name === 'Hidden Power') {
      Object.assign(overrides, { type: hiddenPowerType(attackerSpec.iv), basePower: 60 });
    } else {
      const base = gen.moves.get(toID(name));
      if (base) {
        if (m.p > 1 && m.p !== base.basePower) overrides.basePower = m.p;
        const dynamicType = /^(Hidden Power|Weather Ball|Judgment|Multi-Attack|Techno Blast|Revelation Dance|Ivy Cudgel|Raging Bull|Tera Blast|Natural Gift|Terrain Pulse|Aura Wheel)$/.test(name);
        if (!dynamicType && m.t !== base.type && m.t !== '???') overrides.type = m.t;
        const cat = { P: 'Physical', S: 'Special', X: 'Status' }[m.k];
        if (cat !== base.category) overrides.category = cat;
        if (m.r !== (base.priority || 0)) overrides.priority = m.r;
        if (base.multihit && Array.isArray(base.multihit)) {
          opts.hits = attackerSpec.ab === 'Skill Link' ? base.multihit[1] : (maxHits ? base.multihit[1] : base.multihit[0]);
        }
      }
    }
    if (bp > 0 && !z) overrides.basePower = bp;   // this use's power (Rollout's doubling, Fury Cutter, Echoed Voice)
    if (Object.keys(overrides).length) opts.overrides = overrides;
    return new C.Move(gen, name, opts);
  }

  function fieldFor(weather, extra) {
    const f = { gameType: 'Singles' };
    if (weather) f.weather = weather;
    if (extra && extra.terrain) f.terrain = extra.terrain;
    if (extra && extra.defSide) f.defenderSide = extra.defSide;
    if (extra && extra.atkSide) f.attackerSide = extra.atkSide;
    return new C.Field(f);
  }

  /** Damage rolls (16 values, multi-hit totals) for one use of a move, with Radical Red's
   *  custom ability effects applied. Memoized: safe to call in tight simulation loops. */
  function rawRolls(attSpec, defSpec, moveId, opts) {
    const o = opts || {};
    const m = mv(moveId);
    if (!m || m.k === 'X') return null;
    const hpRel = HP_SENSITIVE_MV.test(m.f) ? true : (HP_SENSITIVE_AB.has(attSpec.ab) || HP_SENSITIVE_AB.has(defSpec.ab)) ? 'roll' : false;
    const ds = o.defSide || null;
    const key = ['R', specKey(attSpec, hpRel), specKey(defSpec, hpRel), moveId, o.weather || '', o.terrain || '',
      ds ? [ds.isReflect ? 1 : 0, ds.isLightScreen ? 1 : 0, ds.isAuroraVeil ? 1 : 0].join('') : '', o.crit ? 1 : 0, o.hits || 0, o.z ? 'Z' : '', o.bp || ''].join('|');
    return memo(key, () => {
      const fixed = fixedRolls(attSpec, defSpec, m);
      if (fixed) return fixed;
      const game = gameRolls(attSpec, defSpec, moveId, o, ds);
      if (game) return game;
      const att = buildMon(attSpec), def = buildMon(defSpec);
      const move = buildMove(moveId, attSpec, { crit: !!o.crit, maxHits: o.maxHits, z: !!o.z, bp: o.bp });
      if (o.hits && !o.z) move.hits = o.hits;
      let res;
      try { res = C.calculate(gen, att, def, move, fieldFor(o.weather, { terrain: o.terrain, defSide: ds })); }
      catch (e) { return { rolls: [0], eff: 0, type: m.t, hits: 1, priority: m.r, contact: false, punch: false, notes: [] }; }
      let rolls = rollsOf(res).slice();
      const eff = typeEff(move.type, sp(defSpec.s).t);
      const notes = [];
      const scale = f => { rolls = rolls.map(x => Math.floor(x * f)); };
      if (attSpec.ab === 'Striker' && KICK.test(m.f)) { scale(1.3); notes.push('Striker: kicking move ×1.3'); }
      if (attSpec.ab === 'Fatal Precision' && eff > 1) { scale(1.2); notes.push('Fatal Precision: super-effective ×1.2, never misses'); }
      if (attSpec.ab === 'ORAORAORAORA!' && move.flags && move.flags.punch) { scale(1.5); notes.push('ORAORAORAORA!: punches hit again for 50%'); }
      if (attSpec.ab === 'Bull Rush' && attSpec.firstTurn) { scale(1.2); notes.push('Bull Rush: first turn ×1.2'); }
      if (defSpec.ab === 'Primal Armor' && eff > 1) { scale(0.5); notes.push('Primal Armor: super-effective ×0.5'); }
      if (attSpec.ab === 'Bone Zone' && BONE.test(m.f) && eff < 1) {
        const stab = sp(attSpec.s).t.includes(move.type) ? 1.5 : 1;
        const neutral = C.calculate(gen, buildMon(attSpec), buildMon(defSpec), new C.Move(gen, move.name, { overrides: { type: '???' }, hits: move.hits }), fieldFor(o.weather, { terrain: o.terrain, defSide: ds }));
        rolls = rollsOf(neutral).map(x => Math.floor(x * stab));
        notes.push('Bone Zone: ignores resistances and immunities (approx.)');
      }
      return { rolls, eff, type: move.type, hits: move.hits || 1, priority: move.priority || 0,
        contact: !!(move.flags && move.flags.contact) || (!m.c && m.k === 'P'), punch: !!(move.flags && move.flags.punch),
        sound: !!(move.flags && move.flags.sound), notes };
    });
  }

  /** Moves whose damage the battle script sets outright (the game's effect scripts 40, 41, 87, 88 and 130): half the
   *  target's HP (Super Fang, Ruination, Nature's Madness; at least 1), 40 (Dragon Rage), 20 (Sonic Boom), the user's
   *  level (Seismic Toss, Night Shade), level x 50-150% (Psywave). Type immunities still apply (typecalc2). */
  function fixedRolls(attSpec, defSpec, m) {
    const n = m.f;
    let rolls = null;
    const defMax = rawStats(defSpec).hp;
    const defHp = defSpec.hpPct == null || defSpec.hpPct >= 100 ? defMax : Math.max(1, Math.round(defMax * defSpec.hpPct / 100));
    const lv = attSpec.lv || 50;
    if (n === 'Super Fang' || n === 'Ruination' || n === "Nature's Madness") rolls = [Math.max(1, Math.floor(defHp / 2))];
    else if (n === 'Dragon Rage') rolls = [40];
    else if (n === 'Sonic Boom') rolls = [20];
    else if (n === 'Seismic Toss' || n === 'Night Shade') rolls = [lv];
    else if (n === 'Psywave') rolls = Array.from({ length: 16 }, (_, i) => Math.max(1, Math.floor(lv * (50 + Math.round(i * 100 / 15)) / 100)));
    if (!rolls) return null;
    const type = m.t;
    let eff = typeEff(type, defSpec.types || sp(defSpec.s).t);
    if (eff === 0 && type === 'Ghost' && defSpec.ab === 'Scrappy') eff = 1;
    if (eff === 0 && (type === 'Normal' || type === 'Fighting') && attSpec.ab === 'Scrappy') eff = 1;
    if (defSpec.ab === 'Wonder Guard' && eff <= 1) eff = 0;
    if (eff === 0) rolls = [0];
    return { rolls, eff: eff === 0 ? 0 : 1, type, hits: 1, priority: m.r || 0, contact: !!((m.fl || 0) & 1), punch: false, sound: false, notes: ['fixed damage'] };
  }

  // The game's damage, step for step (app/damage.js), for one use of a move; null when it doesn't handle the move
  let rrd = null;
  const PB_BANNED = new Set((D.moveLists && D.moveLists.parentalBondBanned) || []);
  function rrBattler(spec) {
    const s = sp(spec.s);
    const st = rawStats(Object.assign({}, spec, { ab: null }));   // the game's stats; abilities act inside the formula
    const maxHP = st.hp;
    const hp = spec.hpPct == null || spec.hpPct >= 100 ? maxHP : Math.max(1, Math.round(maxHP * spec.hpPct / 100));
    const b = Object.assign({}, spec.boosts || {});
    if (spec.ab === 'Valiant Shield' && spec.entry !== false) b.def = Math.min(6, (b.def || 0) + 1);
    // raised on entry (the calculator used to add these itself)
    if (spec.ab === 'Intrepid Sword' && spec.entry !== false) b.atk = Math.min(6, (b.atk || 0) + 1);
    if (spec.ab === 'Dauntless Shield' && spec.entry !== false) b.def = Math.min(6, (b.def || 0) + 1);
    return { sp: s, lv: spec.lv, st, b, ab: canonAbility(spec.ab), it: spec.it ? D.items[spec.it] || null : null, itId: spec.it || 0,
      status: spec.status || (spec.st ? STATUS_CODE[spec.st] || '' : ''), hp, maxHP, types: spec.types || s.t, iv: spec.iv,
      grounded: !!spec.grounded, floating: !!spec.floating, faintedAllies: spec.faintedAllies || 0,
      firstTurn: !!spec.firstTurn, movesLast: !!spec.movesLast, movesFirst: !!spec.movesFirst, disguised: !!spec.disguised, charged: !!spec.charged, flashFire: !!spec.flashFire,
      fr: spec.fr };
  }
  function gameRolls(attSpec, defSpec, moveId, o, ds) {
    if (!RRD || o.z) return null;
    if (!rrd) rrd = RRD(D, (mt, dt) => typeEff(mt, [dt]), hiddenPowerType);
    const m = mv(moveId);
    const base = m.c ? gen.moves.get(toID(m.c)) : null;
    if (base && (base.ohko || base.damage)) return null;                 // fixed damage and one-hit KOs: the calculator's
    if (/^(Seismic Toss|Night Shade|Super Fang|Ruination|Nature's Madness|Endeavor|Final Gambit|Psywave|Counter|Mirror Coat|Metal Burst|Comeuppance|Bide|Beat Up|Spit Up|Present|Fling|Natural Gift|Triple Kick|Triple Axel|Multi-Attack|Techno Blast|Aura Wheel|Raging Bull|Ivy Cudgel|Tera Blast)$/.test(m.f)) return null;
    const att = rrBattler(attSpec), def = rrBattler(defSpec);
    att.spe = speedOf(attSpec, o.weather, o.terrain); def.spe = speedOf(defSpec, o.weather, o.terrain);
    att.qp = qpStat(attSpec, o.weather, o.terrain); def.qp = qpStat(defSpec, o.weather, o.terrain);
    // Meteor Beam and Electro Shot raise Sp. Atk on the charge turn, before they hit (callers that already raised it take one off)
    if (m.f === 'Meteor Beam' || m.f === 'Electro Shot') att.b = Object.assign({}, att.b, { spa: Math.min(6, (att.b.spa || 0) + 1) });
    const fo = { weather: o.weather || null, terrain: o.terrain || null, crit: !!o.crit, bp: o.bp || 0, priority: priorityOfMove(attSpec, m),
      reflect: !!(ds && ds.isReflect), lightScreen: !!(ds && ds.isLightScreen), auroraVeil: !!(ds && ds.isAuroraVeil) };
    const first = rrd.rolls(att, def, m, fo);
    if (!first) return null;
    let hits = 1;
    if (o.hits) hits = o.hits;
    else if (base && base.multihit) hits = typeof base.multihit === 'number' ? base.multihit : (attSpec.ab === 'Skill Link' ? base.multihit[1] : base.multihit[0] + 1);
    let rolls = first.rolls.slice();
    if (hits > 1) {
      // later hits land on a target that's no longer at full HP (Multiscale)
      const later = (def.ab === 'Multiscale' || def.ab === 'Shadow Shield') ? rrd.rolls(att, Object.assign({}, def, { hp: def.maxHP - 1 }), m, fo) : first;
      rolls = rolls.map((x, i) => x + later.rolls[i] * (hits - 1));
    } else if (att.ab === 'Parental Bond' && !PB_BANNED.has(m.i) && m.tg !== 8) {
      const second = rrd.rolls(att, def, m, Object.assign({}, fo, { parentalBond: true }));
      rolls = rolls.map((x, i) => x + second.rolls[i]);
    }
    const notes = first.notes.slice();
    if (att.ab === 'ORAORAORAORA!' && first.punch) { rolls = rolls.map(x => Math.floor(x * 1.5)); notes.push('ORAORAORAORA!: punches hit again for 50%'); }
    if (attSpec.ab === 'Striker' && rrd.has('kick', m.i)) notes.push('Striker: kicking move ×1.3');
    if (attSpec.ab === 'Iron Fist' && first.punch) notes.push('Iron Fist: punching move ×1.3 (Radical Red)');
    return { rolls, eff: first.eff, type: first.moveType, hits, priority: m.r || 0, contact: first.contact, punch: first.punch, sound: first.sound, notes,
      ...(first.immune ? { immune: first.immune } : {}) };
  }

  function rollsOf(result) {
    const d = result.damage;
    if (typeof d === 'number') return [d];
    if (Array.isArray(d) && Array.isArray(d[0])) return d[0].map((_, i) => d.reduce((s, hit) => s + hit[i], 0));  // multi-hit: per-roll totals
    return d;
  }

  /** Critical hit chance: the move's stage, the attacker's item (Scope Lens, Razor Claw; the Leek for Farfetch'd and
   *  Sirfetch'd; Lucky Punch for Chansey) and ability (Super Luck, Merciless against poison), Focus Energy; Battle Armor
   *  and Shell Armor block them. Gen 7+ rates: 1/24, 1/8, 1/2, then always. */
  const CRIT_RATE = [1 / 24, 1 / 8, 1 / 2, 1];
  function critChanceOf(attSpec, defSpec, m) {
    if (['Battle Armor', 'Shell Armor'].includes(defSpec.ab)) return 0;
    if (ALWAYS_CRIT.has(m.f)) return 1;
    if (attSpec.ab === 'Merciless' && /psn|tox/.test(defSpec.status || defSpec.st || '')) return 1;
    let stage = HIGH_CRIT.has(m.f) ? 1 : 0;
    const it = itemName(attSpec.it) || '';
    const species = (sp(attSpec.s) || {}).n || '';
    if (it === 'Scope Lens' || it === 'Razor Claw') stage++;
    if (/^(Leek|Stick|Leek Stick)$/.test(it) && /Farfetch|Sirfetch/.test(species)) stage += 2;
    if (it === 'Lucky Punch' && /^Chansey/.test(species)) stage += 2;
    if (attSpec.ab === 'Super Luck') stage++;
    if (attSpec.focus) stage += 2;
    return CRIT_RATE[Math.min(3, stage)];
  }
  /** Accuracy as a fraction: the move's, with No Guard, Compound Eyes, Hustle (physical moves), Victory Star, Wide Lens,
   *  the target's BrightPowder or Lax Incense, and Fatal Precision on super-effective hits. Weather is the battle's job. */
  function accuracyOf(attSpec, defSpec, m) {
    if (!m.a || attSpec.ab === 'No Guard' || defSpec.ab === 'No Guard') return 1;
    if (attSpec.ab === 'Fatal Precision' && typeEff(m.t, sp(defSpec.s).t) > 1) return 1;
    let p = m.a / 100;
    if (attSpec.ab === 'Compound Eyes') p *= 1.3;
    if (attSpec.ab === 'Hustle' && m.k === 'P') p *= 0.8;
    if (attSpec.ab === 'Victory Star') p *= 1.1;
    if (itemName(attSpec.it) === 'Wide Lens') p *= 1.1;
    if (['BrightPowder', 'Bright Powder', 'Lax Incense'].includes(itemName(defSpec.it))) p *= 0.9;
    return Math.min(1, p);
  }
  /** A move's priority with the abilities that change it (Gale Wings and Blazing Soul at full HP, Triage, Prankster). */
  function priorityOfMove(attSpec, m) {
    let p = m.r || 0;
    const full = attSpec.hpPct == null || attSpec.hpPct >= 100;
    if (attSpec.ab === 'Gale Wings' && m.t === 'Flying' && full) p++;
    if (attSpec.ab === 'Blazing Soul' && m.t === 'Fire' && full) p++;
    if (attSpec.ab === 'Prankster' && m.k === 'X') p++;
    if (attSpec.ab === 'Triage' && (m.e === 3 || m.e === 32 || m.e === 132)) p += 3;
    return p;
  }
  /** Moves whose power grows with each use in a row: Rollout and Ice Ball double for five hits (twice that after Defense
   *  Curl), Fury Cutter doubles up to 160, Echoed Voice adds 40 a turn up to 200. The power of the first five uses. */
  function rampPowers(m, attSpec) {
    if (m.e === 117) return [1, 2, 4, 8, 16].map(k => m.p * k * (attSpec.curled ? 2 : 1));
    if (m.f === 'Fury Cutter') return [1, 2, 4, 4, 4].map(k => m.p * k);
    if (m.f === 'Echoed Voice') return [1, 2, 3, 4, 5].map(k => m.p * k);
    return null;
  }

  /** Damage of one move. Returns HP numbers and percentages of the defender's max HP. */
  function damage(attSpec, defSpec, moveId, { weather = null, worst = false, terrain = null, defSide = null } = {}) {
    const m = mv(moveId);
    if (!m || m.k === 'X') return null;
    const base = m.c ? gen.moves.get(toID(m.c)) : null;
    let hits = 0;
    if (base && Array.isArray(base.multihit)) hits = attSpec.ab === 'Skill Link' ? base.multihit[1] : (worst ? base.multihit[1] : base.multihit[0]);
    const r = rawRolls(attSpec, defSpec, moveId, { weather, terrain, defSide, hits });
    const rc = rawRolls(attSpec, defSpec, moveId, { weather, terrain, defSide, hits, crit: true });
    const notes = r.notes.slice();
    if (STAT_MULT[attSpec.ab] && m.k === 'S') notes.push(`${attSpec.ab}: Sp. Atk ×${STAT_MULT[attSpec.ab].spa}`);
    if (!m.c) notes.push('Radical Red move: damage from its type and power; extra effects not modeled');
    for (const [who, a] of [['attacker', attSpec.ab], ['defender', defSpec.ab]]) {
      const info = abilityInfo(a);
      if (info.x && !['Striker', 'Fatal Precision', 'ORAORAORAORA!', 'Bull Rush', 'Primal Armor', 'Bone Zone', 'Feline Prowess', 'Sage Power', 'Valiant Shield'].includes(a))
        notes.push(`${a} (${who}): ${info.d} Not modeled.`);
    }
    const hp = maxHP(defSpec);
    const cur = defSpec.hpPct != null && defSpec.hpPct < 100 ? Math.max(1, Math.round(hp * defSpec.hpPct / 100)) : hp;
    const rolls = r.rolls;
    const min = Math.min(...rolls), max = Math.max(...rolls);
    const n = min > 0 ? Math.ceil(cur / min) : 0;
    const koAll = rolls.filter(x => x >= cur).length / rolls.length;
    let text = '';
    if (min >= cur) text = 'guaranteed OHKO';
    else if (koAll > 0) text = `${(100 * koAll).toFixed(1)}% chance to OHKO`;
    else if (n > 0) text = `guaranteed ${n}HKO`;
    const sashed = cur === hp && (itemName(defSpec.it) === 'Focus Sash' || defSpec.ab === 'Sturdy') && max >= cur;
    // a move that grows in power: the least damage of each of its first five uses in a row
    const powers = rampPowers(m, attSpec);
    const seq = powers ? powers.map(bp => Math.min(...rawRolls(attSpec, defSpec, moveId, { weather, terrain, defSide, hits, bp }).rolls)) : null;
    return {
      move: m, moveName: m.f, type: r.type, eff: r.eff, hp, cur,
      min, max, minPct: 100 * min / hp, maxPct: 100 * max / hp,
      critMax: Math.max(...rc.rolls), critMaxPct: 100 * Math.max(...rc.rolls) / hp, critMinPct: 100 * Math.min(...rc.rolls) / hp,
      hits: r.hits, acc: Math.round(100 * accuracyOf(attSpec, defSpec, m)), priority: priorityOfMove(attSpec, m), seq,
      ko: { text, n: min >= cur ? 1 : n, chance: koAll }, sashed, notes,
      critChance: critChanceOf(attSpec, defSpec, m),
    };
  }

  // ---- probabilities: damage distribution of one attack, and the chance of fainting ----
  const HIT_DIST = { 2: 0.35, 3: 0.35, 4: 0.15, 5: 0.15 };
  /** Probability mass over damage dealt by one use of a move (capped at cap), including
   *  hit counts, all 16 rolls, crits and accuracy. Returns Float64Array of length cap+1. */
  function damageDist(attSpec, defSpec, moveId, weather, cap) {
    return memo(['DD', specKey(attSpec, true), specKey(defSpec, true), moveId, weather || '', cap].join('|'), () => damageDistRaw(attSpec, defSpec, moveId, weather, cap));
  }
  function damageDistRaw(attSpec, defSpec, moveId, weather, cap) {
    const m = mv(moveId);
    const dist = new Float64Array(cap + 1);
    if (!m || m.k === 'X') { dist[0] = 1; return dist; }
    const base = m.c ? gen.moves.get(toID(m.c)) : null;
    let hitsDist = { 0: 1 };
    if (base && Array.isArray(base.multihit)) {
      const [lo, hi] = base.multihit;
      if (attSpec.ab === 'Skill Link') hitsDist = { [hi]: 1 };
      else if (itemName(attSpec.it) === 'Loaded Dice') hitsDist = { 4: 0.5, 5: 0.5 };
      else if (lo === 2 && hi === 5) hitsDist = HIT_DIST;
      else hitsDist = { [hi]: 1 };
    }
    const acc = accuracyOf(attSpec, defSpec, m);
    const pc = critChanceOf(attSpec, defSpec, m);
    for (const [h, ph] of Object.entries(hitsDist)) {
      for (const crit of [false, true]) {
        const p = ph * (crit ? pc : 1 - pc) * acc;
        if (p <= 0) continue;
        const rolls = rawRolls(attSpec, defSpec, moveId, { weather, crit, hits: +h || 0 }).rolls;
        for (const r of rolls) dist[Math.min(cap, r)] += p / rolls.length;
      }
    }
    dist[0] += 1 - acc;
    return dist;
  }
  /** Chance that n attacks drawn from dist add up to at least hp (dist is sparse: few non-zero entries). */
  function faintChance(dist, hp, n) {
    if (n <= 0) return 0;
    const pts = [];
    for (let d = 0; d < dist.length; d++) if (dist[d] > 1e-12) pts.push(d, dist[d]);
    let cur = new Map([[0, 1]]);
    let dead = 0;
    for (let k = 0; k < n; k++) {
      const next = new Map();
      for (const [a, pa] of cur) {
        for (let i = 0; i < pts.length; i += 2) {
          const v = a + pts[i], p = pa * pts[i + 1];
          if (v >= hp) dead += p;
          else next.set(v, (next.get(v) || 0) + p);
        }
      }
      cur = next;
      if (!cur.size) break;
    }
    return Math.min(1, dead);
  }

  /** Protosynthesis or Quark Drive switched on (Booster Energy, sun, Electric Terrain): the stat it raises (Speed ×1.5,
   *  the others ×1.3), counting stat stages, or null. */
  function qpStat(spec, weather, terrain) {
    const a = spec.ab, energy = /^Boost(er)? Energy$/.test(itemName(spec.it) || '');
    const on = (a === 'Protosynthesis' && (energy || /Sun/.test(weather || ''))) || (a === 'Quark Drive' && (energy || terrain === 'Electric'));
    if (!on) return null;
    const r = rawStats(spec), b = spec.boosts || {};
    const mod = k => Math.floor(r[k] * ((b[k] || 0) >= 0 ? (2 + (b[k] || 0)) / 2 : 2 / (2 - b[k])));
    return ['def', 'spa', 'spd', 'spe'].reduce((best, k) => (mod(k) > mod(best) ? k : best), 'atk');
  }
  // The game's SpeedCalc order: stage, weather abilities, other abilities, held item, then Quick Feet or paralysis
  function speedOf(spec, weather, terrain) {
    let s = rawStats(spec).spe;
    const b = (spec.boosts && spec.boosts.spe) || 0;
    const R = [[10, 40], [10, 35], [10, 30], [10, 25], [10, 20], [10, 15], [10, 10], [15, 10], [20, 10], [25, 10], [30, 10], [35, 10], [40, 10]][Math.max(0, Math.min(12, 6 + b))];
    s = Math.floor(s * R[0] / R[1]);
    const it = spec.it ? D.items[spec.it] || {} : {};
    const item = it.c || itemName(spec.it);
    const a = spec.ab;
    const w = weather || '';
    const umbrella = item === 'Utility Umbrella';
    if ((a === 'Swift Swim' && /Rain/.test(w) && !umbrella) || (a === 'Chlorophyll' && /Sun/.test(w) && !umbrella) || (a === 'Sand Rush' && w === 'Sand') || (a === 'Slush Rush' && /Snow|Hail/.test(w))) s *= 2;
    if (a === 'Surge Surfer' && terrain === 'Electric') s *= 2;
    if (qpStat(spec, weather, terrain) === 'spe') s = Math.floor(s * 1.5);
    if (a === 'Bull Rush' && spec.firstTurn) s = Math.floor(s * 1.5);
    if (it.he === 24) s = Math.floor(s * 3 / 4);                          // Radical Red: Macho Brace and the Power items cost a quarter
    else if (item === 'Choice Scarf') s = Math.floor(s * 15 / 10);
    else if (item === 'Iron Ball') s = Math.floor(s / 2);
    else if (item === 'Quick Powder' && /^Ditto/.test((sp(spec.s) || {}).n || '')) s *= 2;
    const status = spec.status || (spec.st ? STATUS_CODE[spec.st] : '');
    if (a === 'Quick Feet' && status) s = Math.floor(s * 15 / 10);
    else if (status === 'par') s = Math.floor(s / 2);
    return s;
  }

  function weatherFor(a, b, aFirst) {
    const wa = WEATHER_SETTERS[a.ab], wb = WEATHER_SETTERS[b.ab];
    if (wa && wb) return aFirst ? wb : wa;   // the slower setter's weather lasts
    return wa || wb || null;
  }

  function maxHP(spec) { return memo('H|' + specKey(spec, false), () => buildMon(Object.assign({}, spec, { hpPct: 100 })).maxHP()); }
  function rawStats(spec) { return memo('S|' + specKey(spec, false), () => Object.assign({}, buildMon(Object.assign({}, spec, { hpPct: 100, boosts: {} })).rawStats)); }

  /** One-on-one outlook between my Pokemon and theirs (both at the HP given in the specs). */
  /** entry: true (default) = both Pokemon have just come in (Intimidate, first-turn effects apply);
   *  false = a battle already in progress, boosts as given. */
  function matchup(mine, theirs, opts) {
    const o = opts || {};
    const key = ['MU', specKey(mine, true), (mine.mv || []).join('.'), specKey(theirs, true), (theirs.mv || []).join('.'),
      o.weather === undefined ? 'auto' : (o.weather || ''), o.entry === false ? 0 : 1].join('|');
    return memo(key, () => matchupRaw(mine, theirs, o));
  }
  function matchupRaw(mine, theirs, { weather: forced, entry = true } = {}) {
    // Intimidate: theirs arrives after a KO (set mode) and lowers my Attack; mine lowers theirs when I switch in
    const me = Object.assign({}, mine, { boosts: Object.assign({}, mine.boosts) });
    const them = Object.assign({}, theirs, { boosts: Object.assign({}, theirs.boosts), firstTurn: entry });
    if (entry) {
      if (them.ab === 'Intimidate' && !['Clear Body', 'White Smoke', 'Hyper Cutter', 'Full Metal Body', 'Inner Focus', 'Own Tempo', 'Oblivious', 'Scrappy'].includes(me.ab))
        me.boosts.atk = (me.boosts.atk || 0) - 1;
      if (me.ab === 'Intimidate') them.boosts.atk = (them.boosts.atk || 0) - 1;
    }
    const prelimMeFaster = speedOf(me, null) > speedOf(them, null);
    const weather = forced !== undefined ? forced : weatherFor(me, them, prelimMeFaster);
    const mySpeed = speedOf(me, weather), theirSpeed = speedOf(them, weather);
    const myHits = (me.mv || []).map(id => damage(me, them, id, { weather })).filter(Boolean);
    const theirHits = (them.mv || []).map(id => damage(them, me, id, { weather, worst: true })).filter(Boolean);
    const threat = theirHits.slice().sort((a, b) => (b.max - a.max))[0] || null;
    const myHP = maxHP(me) * (me.hpPct != null ? me.hpPct / 100 : 1);
    const theirMax = threat ? threat.max : 0;
    let toKOme = theirMax > 0 ? Math.ceil(myHP / theirMax) : Infinity;
    const hpInt = Math.max(1, Math.round(myHP));
    let dist = null;
    // each of my attacks played out: how many hits it needs, who moves first (priority, then Speed), and the chance of
    // losing my Pokemon before it wins (their best move every turn, all rolls, hit counts, crits, my accuracy)
    const outcome = h => {
      let toKO = h.min > 0 ? Math.ceil(h.cur / h.min) : Infinity;
      if (h.seq && h.min > 0) {   // Rollout and friends: add up the growing hits (after five, Rollout starts over)
        let sum = 0, k = 0;
        while (sum < h.cur && k < 20) { sum += h.seq[k % h.seq.length]; k++; }
        toKO = Math.min(toKO, k);
      }
      if (h.sashed && toKO === 1) toKO = 2;
      const first = threat ? (h.priority > threat.priority || (h.priority === threat.priority && mySpeed > theirSpeed)) : mySpeed > theirSpeed;
      const taken = !isFinite(toKO) ? Infinity : (first ? toKO - 1 : toKO);
      let r = 1;
      if (isFinite(toKO) && threat) {
        if (!dist) dist = damageDist(them, me, threat.move.i, weather, hpInt);
        r = faintChance(dist, hpInt, taken);
        const myAcc = h.acc === 0 ? 1 : Math.min(1, h.acc / 100);
        if (myAcc < 1) {                                  // one miss gives them one more attack
          const pMiss = 1 - Math.pow(myAcc, toKO);
          r = r + pMiss * (faintChance(dist, hpInt, taken + 1) - r);
        }
      } else if (isFinite(toKO) && !threat) r = 0;
      return { h, toKO, first, taken, r };
    };
    // the attack a player would pick here: least risk, then fewest hits, then most damage (a weaker priority move can win
    // a matchup the strongest move loses)
    const pick = myHits.map(outcome).sort((a, b) => (a.r - b.r) || (a.toKO - b.toKO) || (b.h.min - a.h.min) || (b.h.acc - a.h.acc))[0] || null;
    const best = pick ? pick.h : null;
    const toKOthem = pick ? pick.toKO : Infinity;
    const meFirst = pick ? pick.first : mySpeed > theirSpeed;
    const win = meFirst ? toKOthem <= toKOme : toKOthem < toKOme;
    const hitsTaken = pick ? pick.taken : Infinity;
    const dmgTaken = hitsTaken === Infinity ? Infinity : hitsTaken * theirMax;
    const critTaken = hitsTaken === Infinity ? Infinity : (hitsTaken > 0 && threat ? threat.critMax + (hitsTaken - 1) * theirMax : 0);
    const risk = pick ? pick.r : 1;
    let verdict;
    if (!best || !isFinite(toKOthem)) verdict = 'lose';
    else if (risk <= 1e-9) verdict = 'safe';
    else if (risk <= 0.05) verdict = 'ok';
    else if (risk <= 0.35) verdict = 'risky';
    else verdict = 'lose';
    const accRisk = best && best.acc < 100 ? best.acc : null;
    return {
      best, threat, myHits, theirHits, mySpeed, theirSpeed, meFirst, weather,
      toKOthem, toKOme, hitsTaken, verdict, accRisk, risk,
      hpLeftPct: isFinite(dmgTaken) ? Math.max(0, 100 * (myHP - dmgTaken) / maxHP(me)) : 0,
      critHpLeftPct: isFinite(critTaken) ? Math.max(0, 100 * (myHP - critTaken) / maxHP(me)) : 0,
    };
  }

  /** The boss's team as specs, with levels that follow the player's top level resolved. */
  function bossTeam(bossIndex, playerTop) {
    const b = D.bosses[bossIndex];
    return b.party.map(m => Object.assign({}, m, {
      lv: m.lv != null ? m.lv : Math.max(1, Math.min(100, (playerTop || b.cap) + m.rel + REL)),
      nat: m.nat != null ? m.nat : 0,
      ab: canonAbility(m.ab || ((sp(m.s) || {}).a || [])[0] || null),
      fr: (m.mv || []).includes(FRUSTRATION) ? 0 : 255,     // CFRU: trainer Pokemon get full friendship, or none with Frustration
    }));
  }

  const VERDICT_SCORE = { safe: 3, ok: 2, risky: 1, lose: 0 };
  const WEATHER_USERS = { 'Sand Rush': 'Sand', 'Sand Force': 'Sand', 'Swift Swim': 'Rain', 'Rain Dish': 'Rain', Hydration: 'Rain',
    Chlorophyll: 'Sun', 'Solar Power': 'Sun', 'Leaf Guard': 'Sun', 'Slush Rush': 'Snow', 'Ice Body': 'Snow', Protosynthesis: 'Sun' };

  /** Weather the boss team keeps up: the first weather setter in its party. */
  function teamWeather(team) {
    for (const t of team) if (WEATHER_SETTERS[t.ab]) return WEATHER_SETTERS[t.ab];
    return null;
  }

  /** Best six (and a lead) from the roster against one boss. roster: array of specs with a `key`. */
  function planBoss(bossIndex, roster, partyKeys) {
    const top = Math.max(...roster.filter(r => !partyKeys || partyKeys.includes(r.key)).map(r => r.lv), 1);
    const team = bossTeam(bossIndex, top);
    const tw = teamWeather(team);
    // a teammate's weather can still be up when a weather-user comes in: assume it for those Pokemon
    const grid = roster.map(r => team.map(t => matchup(r, t, (tw && WEATHER_USERS[t.ab] === tw) ? { weather: tw } : {})));
    const answers = team.map((t, j) => roster.map((r, i) => ({ r, i, m: grid[i][j] }))
      .sort((a, b) => (VERDICT_SCORE[b.m.verdict] - VERDICT_SCORE[a.m.verdict]) || (a.m.risk - b.m.risk) || (b.m.hpLeftPct - a.m.hpLeftPct)));
    // greedy cover: pick the Pokemon that adds the most safe/ok answers
    const chosen = [];
    const covered = team.map(() => 0);
    const slots = Math.min(6, roster.length);
    while (chosen.length < slots) {
      let bestI = -1, bestGain = -1;
      roster.forEach((r, i) => {
        if (chosen.includes(i)) return;
        let gain = 0;
        team.forEach((t, j) => {
          const s = VERDICT_SCORE[grid[i][j].verdict];
          gain += Math.max(0, s - covered[j]) * 10 + grid[i][j].hpLeftPct / 100;
        });
        if (gain > bestGain) { bestGain = gain; bestI = i; }
      });
      if (bestI < 0) break;
      chosen.push(bestI);
      team.forEach((t, j) => { covered[j] = Math.max(covered[j], VERDICT_SCORE[grid[bestI][j].verdict]); });
    }
    const leadAnswer = answers[0].find(a => chosen.includes(a.i));
    return { team, grid, answers, chosen, lead: leadAnswer ? leadAnswer.i : chosen[0], top, teamWeather: tw };
  }

  /** Moves a Pokemon can use at its level: level-up moves (Move Relearner) and TMs, Hardcore bans removed. */
  function learnable(speciesId, level) {
    const L = D.learn[speciesId];
    const s = sp(speciesId);
    const out = new Map();
    if (L) {
      for (const [lv, id] of L.l) if (lv <= level && mv(id)) out.set(id, lv === 0 ? 'Evolution' : `Lv ${lv}`);
      for (const t of L.t) { const id = D.tms[t]; if (mv(id) && !out.has(id)) out.set(id, t < 120 ? `TM${String(t + 1).padStart(2, '0')}` : `HM${String(t - 119).padStart(2, '0')}`); }
      for (const id of L.u || []) if (mv(id) && !out.has(id)) out.set(id, 'Move Tutor');
    }
    const list = [];
    for (const [id, how] of out) list.push({ id, how, banned: isBanned(id, s && s.g) });
    return list;
  }
  function upcoming(speciesId, level) {
    const L = D.learn[speciesId];
    return L ? L.l.filter(([lv, id]) => lv > level && mv(id)).slice(0, 6).map(([lv, id]) => ({ id, lv })) : [];
  }
  function isBanned(moveId, speciesName) {
    if (MODE !== 'hardcore') return false;   // only Hardcore restricts your moves
    if (banned.has(moveId)) return true;
    if (condBanned.has(moveId) && !condOK.has(speciesName)) return true;
    return false;
  }

  /** Four moves (from what it can learn) that cover a boss team best.
   *  includeTMs: also consider TM/HM moves (the player may not own them yet). */
  function suggestMoves(spec, bossIndex, playerTop, includeTMs) {
    const team = bossTeam(bossIndex, playerTop || spec.lv);
    const pool = learnable(spec.s, spec.lv).filter(x => !x.banned && (includeTMs || !/^[TH]M/.test(x.how)));
    for (const id of spec.mv || []) if (!pool.some(x => x.id === id) && mv(id)) pool.push({ id, how: 'Known', banned: isBanned(id, sp(spec.s).g) });
    const scored = pool.filter(x => mv(x.id).k !== 'X').map(x => ({
      ...x, per: team.map(t => { const d = damage(Object.assign({}, spec, { mv: [x.id] }), t, x.id); return d ? Math.min(100, d.minPct) * (d.acc / 100) : 0; }),
    }));
    const picked = [];
    const bestPer = team.map(() => 0);
    for (let k = 0; k < 4 && scored.length; k++) {
      let top = null, gain = -1;
      for (const c of scored) {
        if (picked.includes(c)) continue;
        const g = c.per.reduce((s, v, j) => s + Math.max(0, v - bestPer[j]), 0);
        if (g > gain) { gain = g; top = c; }
      }
      if (!top || gain <= 0.5) break;
      picked.push(top);
      top.per.forEach((v, j) => { bestPer[j] = Math.max(bestPer[j], v); });
    }
    return { picked, bestPer, team, pool };
  }

  return { C, gen, D, sp, mv, itemName, hardcoreAbility, natureName, abilityInfo, buildMon, damage, damageDist, faintChance, speedOf, matchup,
    bossTeam, planBoss, teamWeather, learnable, upcoming, isBanned, suggestMoves, maxHP, rawStats, rawRolls, typeEff, hiddenPowerType, setMode, getMode, critChanceOf, accuracyOf, priorityOfMove, rampPowers, qpStat, canonAbility,
    STATUS_CODE, WEATHER_SETTERS, HIGH_CRIT, ALWAYS_CRIT, STAT_MULT, clearCache: () => cache.clear() };
});
