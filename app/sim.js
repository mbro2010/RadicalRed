/* Battle simulator and planner for Radical Red Hardcore boss fights (singles).
 * Damage comes from the engine (Smogon calc fed with ROM data); move effects come from the ROM's
 * effect IDs (FireRed numbering, extended by the engine) plus a few name tables for newer moves.
 * The boss AI is an approximation: it takes KOs, otherwise attacks hard, and sets up, statuses,
 * heals, lays hazards or pivots when those look good, as Radical Red's bosses visibly do. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.createSim = factory;
})(typeof self !== 'undefined' ? self : this, function createSim(E) {
  'use strict';
  const D = E.D;
  const STAGE = s => (s >= 0 ? (2 + s) / 2 : 2 / (2 - s));
  const ACC_STAGE = s => (s >= 0 ? (3 + s) / 3 : 3 / (3 - s));
  const STATS5 = ['atk', 'def', 'spa', 'spd', 'spe'];

  // ---------------- move knowledge ----------------
  const POWDER = new Set(['Spore', 'Sleep Powder', 'Stun Spore', 'Poison Powder', 'Cotton Spore', 'Rage Powder', 'Magic Powder']);
  const SELF_DROP = { 'Close Combat': { def: -1, spd: -1 }, Superpower: { atk: -1, def: -1 }, 'Hammer Arm': { spe: -1 }, 'Ice Hammer': { spe: -1 },
    'V-create': { def: -1, spd: -1, spe: -1 }, 'Clanging Scales': { def: -1 }, 'Spin Out': { spe: -2 }, 'Make It Rain': { spa: -1 },
    'Armor Cannon': { def: -1, spd: -1 }, 'Headlong Rush': { def: -1, spd: -1 }, 'Dragon Ascent': { def: -1, spd: -1 },
    'Hyperspace Fury': { def: -1 }, Overheat: { spa: -2 }, 'Draco Meteor': { spa: -2 }, 'Leaf Storm': { spa: -2 }, 'Fleur Cannon': { spa: -2 },
    'Psycho Boost': { spa: -2 }, 'Scale Shot': { spe: 1, def: -1 } };
  const FANG = { 'Fire Fang': 'brn', 'Ice Fang': 'frz', 'Thunder Fang': 'par' };
  const SETUP = { 'Shell Smash': { atk: 2, spa: 2, spe: 2, def: -1, spd: -1 }, 'Quiver Dance': { spa: 1, spd: 1, spe: 1 }, Coil: { atk: 1, def: 1 },
    'Shift Gear': { atk: 1, spe: 2 }, 'Victory Dance': { atk: 1, def: 1, spe: 1 }, Geomancy: { spa: 2, spd: 2, spe: 2 }, Growth: { atk: 1, spa: 1 },
    'Dragon Dance': { atk: 1, spe: 1 }, 'Calm Mind': { spa: 1, spd: 1 }, 'Bulk Up': { atk: 1, def: 1 }, 'Fillet Away': { atk: 2, spa: 2, spe: 2 },
    'Tidy Up': { atk: 1, spe: 1 }, 'Work Up': { atk: 1, spa: 1 }, 'Hone Claws': { atk: 1 }, 'No Retreat': { atk: 1, def: 1, spa: 1, spd: 1, spe: 1 },
    'Clangorous Soul': { atk: 1, def: 1, spa: 1, spd: 1, spe: 1 }, 'Tail Glow': { spa: 3 }, 'Cotton Guard': { def: 3 }, Stockpile: { def: 1, spd: 1 }, Minimize: { eva: 2 } };
  const EFFECT_BOOST = { 10: { atk: 1 }, 11: { def: 1 }, 12: { spe: 1 }, 13: { spa: 1 }, 14: { spd: 1 }, 50: { atk: 2 }, 51: { def: 2 }, 52: { spe: 2 },
    53: { spa: 2 }, 54: { spd: 2 }, 206: { def: 1, spd: 1 }, 208: { atk: 1, def: 1 }, 211: { spa: 1, spd: 1 }, 212: { atk: 1, spe: 1 },
    156: { def: 1 }, 16: { eva: 1 } };
  const EFFECT_DROP = { 18: { atk: -1 }, 19: { def: -1 }, 20: { spe: -1 }, 21: { spa: -1 }, 22: { spd: -1 }, 58: { atk: -2 }, 59: { def: -2 },
    60: { spe: -2 }, 61: { spa: -2 }, 62: { spd: -2 }, 23: { acc: -1 }, 24: { eva: -1 }, 63: { acc: -2 }, 64: { eva: -2 } };
  const HIT_DROP = { 68: 'atk', 69: 'def', 70: 'spe', 71: 'spa', 72: 'spd' };
  const HIT_SELF_UP = { 96: { spe: 1 }, 110: { spa: 1 }, 138: { def: 1 }, 139: { atk: 1 }, 140: { atk: 1, def: 1, spa: 1, spd: 1, spe: 1 }, 129: { spe: 1 } };
  const RECHARGE = 80, CHARGE = 145, SOLAR = 151, SEMI_INV = 155, PIVOT = 127, TELEPORT = 153, FAKE_OUT = 158, SUCKER = 237;
  // moves that lock the user in, trap the target or lock a move out (the ROM's effect numbers, as the engine runs them):
  // Thrash/Petal Dance/Outrage, Rollout/Ice Ball, Uproar, Bide; Bind/Wrap/Fire Spin...; Mean Look/Block/Spider Web/Jaw Lock...;
  // Disable, Torment; the charge-turn moves Sky Attack/Freeze Shock/Ice Burn and Razor Wind; Focus Energy
  const RAMPAGE = 27, ROLLOUT = 117, UPROAR = 159, BIDE = 26, BIND = 42, MEAN_LOOK = 106, DISABLE = 86, TORMENT = 165, SKY_ATTACK = 75, RAZOR_WIND = 39, FOCUS_ENERGY = 47;
  const LOCK_WORDS = { rampage: 'is rampaging', rollout: 'keeps rolling', uproar: 'is in an uproar', bide: 'is storing energy' };
  const LOCKS_IN = mm => mm.eff === RAMPAGE || mm.eff === ROLLOUT || mm.eff === UPROAR || mm.eff === BIDE;
  const HEAL_HALF = 32, HEAL_WEATHER = 132;
  // moves whose effect comes later (the engine's gWishFutureKnock and Perish Song timers): Wish heals that spot at the end
  // of the next turn; Future Sight and Doom Desire hit that spot two turns after the turn they're used; Perish Song knocks
  // out everyone who heard it three turns after the turn it's sung; Healing Wish and Lunar Dance (the Memento effect, like
  // Memento and Final Gambit) faint the user and heal whoever comes into its spot
  const WISH = 179, FUTURE = 148, PERISH = 114, MEMENTO = 168;
  const PROTECT_EFF = 111, HAZARD = 112;
  const RESIST_BERRY = { 'Occa Berry': 'Fire', 'Passho Berry': 'Water', 'Wacan Berry': 'Electric', 'Rindo Berry': 'Grass', 'Yache Berry': 'Ice',
    'Chople Berry': 'Fighting', 'Kebia Berry': 'Poison', 'Shuca Berry': 'Ground', 'Coba Berry': 'Flying', 'Payapa Berry': 'Psychic',
    'Tanga Berry': 'Bug', 'Charti Berry': 'Rock', 'Kasib Berry': 'Ghost', 'Haban Berry': 'Dragon', 'Colbur Berry': 'Dark',
    'Babiri Berry': 'Steel', 'Roseli Berry': 'Fairy', 'Chilan Berry': 'Normal' };
  const CURE_BERRY = { 'Chesto Berry': 'slp', 'Cheri Berry': 'par', 'Rawst Berry': 'brn', 'Pecha Berry': 'psn', 'Aspear Berry': 'frz' };
  // the moves that cure frostbite: the game's lists of thawing moves (using one cures the user; being hit by either cures the target)
  const THAW_USER = new Set((E.D.moveLists && E.D.moveLists.unfreezeAttacker) || []);
  const THAW_TARGET = new Set((E.D.moveLists && E.D.moveLists.unfreezeTarget) || []);
  const PINCH_HEAL = new Set(['Figy Berry', 'Wiki Berry', 'Mago Berry', 'Aguav Berry', 'Iapapa Berry']);
  const PINCH_STAT = { 'Liechi Berry': 'atk', 'Ganlon Berry': 'def', 'Salac Berry': 'spe', 'Petaya Berry': 'spa', 'Apicot Berry': 'spd' };
  const NO_INTIMIDATE = new Set(['Clear Body', 'White Smoke', 'Hyper Cutter', 'Full Metal Body', 'Inner Focus', 'Own Tempo', 'Oblivious', 'Scrappy']);
  const NO_SECONDARY = new Set(['Shield Dust']);
  const SLEEP_IMMUNE = new Set(['Insomnia', 'Vital Spirit', 'Sweet Veil', 'Comatose', 'Purifying Salt']);
  const WEATHER_ROCK = { 'Damp Rock': 'Rain', 'Heat Rock': 'Sun', 'Smooth Rock': 'Sand', 'Icy Rock': 'Snow' };
  const TERRAIN_SURGE = { 'Electric Surge': 'Electric', 'Grassy Surge': 'Grassy', 'Psychic Surge': 'Psychic', 'Misty Surge': 'Misty', 'Hadron Engine': 'Electric' };
  const TERRAIN_SEED = { 'Electric Seed': ['Electric', 'def'], 'Grassy Seed': ['Grassy', 'def'], 'Psychic Seed': ['Psychic', 'spd'], 'Misty Seed': ['Misty', 'spd'] };
  const ABSORB = { 'Water Absorb': ['Water', 'heal'], 'Volt Absorb': ['Electric', 'heal'], 'Dry Skin': ['Water', 'heal'], 'Earth Eater': ['Ground', 'heal'],
    'Motor Drive': ['Electric', 'spe'], 'Lightning Rod': ['Electric', 'spa'], 'Storm Drain': ['Water', 'spa'], 'Sap Sipper': ['Grass', 'atk'],
    'Flash Fire': ['Fire', 'none'], 'Well-Baked Body': ['Fire', 'def2'], 'Levitate': ['Ground', 'none'] };

  const metaCache = new Map();
  const romList = k => new Set((E.D.moveLists && E.D.moveLists[k]) || []);
  const ROM_SOUND = romList('sound'), ROM_RECOIL25 = romList('recoil25'), ROM_RECOIL33 = romList('recoil33'), ROM_RECOIL50 = romList('recoil50');
  // the game's own move lists for the battle flow: half-max-HP recoil (Mind Blown, Steel Beam), moves that get through
  // or lift Protect (Feint, Shadow Force...), never miss in rain (Thunder, Hurricane...), hit a Pokemon in the air, under
  // ground or under water, and moves Gravity stops
  const ROM_HALF_HP = romList('halfHpRecoil'), ROM_LIFT_PROTECT = romList('liftProtect'), ROM_RAIN_HIT = romList('rainAlwaysHit');
  const ROM_IN_AIR = romList('ignoreInAir'), ROM_UNDERGROUND = romList('ignoreUnderground'), ROM_UNDERWATER = romList('ignoreUnderwater');
  const ROM_GRAVITY_BANNED = romList('gravityBanned'), ROM_MINIMIZE = romList('minimizeDouble');
  // Assist can't call these (the engine's gAssistBannedMoves)
  const ASSIST_BANNED = new Set(['Assist', 'Baneful Bunker', 'Beak Blast', 'Belch', 'Bestow', 'Bounce', 'Celebrate', 'Chatter', 'Circle Throw',
    'Copycat', 'Counter', 'Covet', 'Destiny Bond', 'Detect', 'Dig', 'Dive', 'Dragon Tail', 'Endure', 'Feint', 'Fly', 'Focus Punch', 'Follow Me',
    'Helping Hand', 'Hold Hands', "King's Shield", 'Mat Block', 'Me First', 'Metronome', 'Mimic', 'Mirror Coat', 'Mirror Move', 'Nature Power',
    'Phantom Force', 'Protect', 'Rage Powder', 'Roar', 'Shadow Force', 'Shell Trap', 'Sketch', 'Sky Drop', 'Sleep Talk', 'Snatch',
    'Spiky Shield', 'Spotlight', 'Struggle', 'Switcheroo', 'Thief', 'Transform', 'Trick', 'Whirlwind', 'Obstruct', 'Silk Trap', 'Burning Bulwark']);
  // where a charging move takes its user: up in the air, under ground, under water, or out of reach altogether
  const INVULN_KIND = { Fly: 'air', Bounce: 'air', 'Sky Drop': 'air', Dig: 'under', Dive: 'water', 'Phantom Force': 'gone', 'Shadow Force': 'gone' };
  const BERRY = /Berry$/;
  function meta(id) {
    let m = metaCache.get(id);
    if (m) return m;
    const r = E.mv(id);
    const base = r && r.c ? E.gen.moves.get(E.C.toID(r.c)) : null;
    m = {
      id, name: r ? r.f : '?', type: r ? r.t : 'Normal', power: r ? r.p : 0, acc: r ? r.a : 100, cat: r ? r.k : 'X', pri: r ? r.r : 0,
      eff: r ? r.e : 0, ec: r ? r.ec : 0,
      multihit: base && Array.isArray(base.multihit) ? base.multihit : null,
      drain: base && base.drain ? base.drain : (r && r.e === 3 && r.k !== 'X' ? [1, 2] : null),
      // recoil, contact and sound: the game's own move flags and lists (Volt Tackle is 25% recoil here, Chloroblast 50%)
      // (CFRU divides the damage dealt by 4, 3 or 2: ATK49_MOVE_RECOIL's gPercent25/33/50RecoilMoves)
      recoil: ROM_RECOIL25.has(id) ? [1, 4] : ROM_RECOIL33.has(id) ? [1, 3] : ROM_RECOIL50.has(id) ? [1, 2] : (base && base.recoil ? base.recoil : null),
      contact: r && r.fl != null ? !!(r.fl & 1) : base ? !!(base.flags && base.flags.contact) : (r && r.k === 'P'),
      sound: ROM_SOUND.size ? ROM_SOUND.has(id) : base ? !!(base.flags && base.flags.sound) : false,
      highCrit: E.HIGH_CRIT.has(r && r.f), alwaysCrit: E.ALWAYS_CRIT.has(r && r.f),
    };
    metaCache.set(id, m);
    return m;
  }

  // ---------------- random numbers ----------------
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  /** "Most likely" dice for the main script: middle roll, no crit, no secondary chance, likely hits connect. */
  function expectedDice() {
    const d = () => 0.5; d.expected = true; return d;
  }

  // ---------------- battle state ----------------
  function makeMon(spec, side, idx) {
    const s = E.sp(spec.s);
    const base = Object.assign({}, spec, { hpPct: 100, boosts: {}, entry: false, firstTurn: false });
    const maxHp = s && s.n === 'Shedinja' ? 1 : E.maxHP(base);
    const st = spec.status || (spec.st ? E.STATUS_CODE[spec.st] : '');
    return {
      side, idx, key: spec.key || (side + idx), spec: base, name: spec.label || (s ? s.n : '?'), types: s ? s.t.slice() : ['Normal'],
      hp: maxHp, maxHp, status: st, sleep: st === 'slp' ? 2 : 0, toxic: 0, boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 },
      item: spec.it || null, ability: E.canonAbility(spec.ab) || '', fainted: false, lock: null, charging: null, invuln: false, recharge: false, destinyBond: false,
      protect: false, protectStreak: 0, yawn: 0, seeded: false, flinch: false, unburden: false, firstTurn: true, rampage: 0, sub: 0,
      // rampage: forced uses left of a move that locks it in (lockKind says which kind); bound: held by Bind and the like;
      // trappedBy: can't switch out (Mean Look, Jaw Lock...); disabled/disableTurns: Disable; torment: Torment
      lockKind: null, rollHits: 0, curled: false, choiceMove: null, bound: null, trappedBy: null, disabled: null, disableTurns: 0, torment: false,
      furyHits: 0, truantLoaf: false, bide: null, focus: false,
      usedPhoenix: false, disguise: spec.ab === 'Disguise', moves: (spec.mv || []).filter(id => E.mv(id)), hitThisTurn: false,
    };
  }
  /** One side of the field. slots: the team index in each battle slot (one in singles, two in doubles); .active is slot 0. */
  function makeSide(team, size, lead, extra) {
    const slots = [];
    for (const i of lead == null ? [] : [].concat(lead)) if (i != null && i >= 0 && i < team.length && !slots.includes(i) && slots.length < size) slots.push(i);
    for (let i = 0; i < team.length && slots.length < size; i++) if (!slots.includes(i)) slots.push(i);
    const side = Object.assign({ team, slots, hazards: { sr: 0, spikes: 0, tspikes: 0, web: 0 }, screens: { reflect: 0, light: 0, veil: 0 }, tailwind: 0, safeguard: 0 }, extra || {});
    Object.defineProperty(side, 'active', { get() { return this.slots[0]; }, set(v) { this.slots[0] = v; if (this.team[v]) this.team[v].slot = 0; }, enumerable: true });
    slots.forEach((i, k) => { team[i].slot = k; });
    return side;
  }
  function newBattle(playerSpecs, bossSpecs, opts) {
    const o = opts || {};
    const size = o.doubles ? 2 : 1;
    return {
      size,
      p: makeSide(playerSpecs.map((s, i) => makeMon(s, 'p', i)), size, o.lead != null ? o.lead : 0),
      a: makeSide(bossSpecs.map((s, i) => makeMon(s, 'a', i)), size, 0),
      weather: null, weatherTurns: 0, terrain: null, terrainTurns: 0, trickRoom: 0, turn: 0, log: [], events: [], over: false, winner: null,
      opts: o,
    };
  }
  /** A deep copy of a battle for look-ahead (functions and the log are not copied). */
  function cloneState(st) {
    const copySide = sd => {
      const team = sd.team.map(m => Object.assign({}, m, { boosts: Object.assign({}, m.boosts), spec: m.spec, moves: m.moves,
        bound: m.bound ? Object.assign({}, m.bound) : null, trappedBy: m.trappedBy ? Object.assign({}, m.trappedBy) : null, bide: m.bide ? Object.assign({}, m.bide) : null }));
      const extra = {};
      for (const k of Object.keys(sd)) if (!['team', 'slots', 'hazards', 'screens', 'active'].includes(k)) extra[k] = sd[k];
      const side = makeSide(team, sd.slots.length, null, extra);
      side.slots = sd.slots.slice(); side.hazards = Object.assign({}, sd.hazards); side.screens = Object.assign({}, sd.screens);
      return side;
    };
    const c = Object.assign({}, st, { p: copySide(st.p), a: copySide(st.a), log: [], events: [], opts: Object.assign({}, st.opts, { record: false }) });
    return c;
  }
  const other = side => (side === 'p' ? 'a' : 'p');
  // battle slots: st[side].slots holds the team index in each slot (one in singles, two in doubles); .active is slot 0
  const act = (st, side, slot) => st[side].team[st[side].slots[slot || 0]];
  const actives = (st, side) => st[side].slots.map(i => st[side].team[i]).filter(m => m && !m.fainted);
  const isActive = (st, m) => st[m.side].slots.includes(m.idx) && !m.fainted;
  const alive = (st, side) => st[side].team.filter(m => !m.fainted);
  const bench = (st, side) => st[side].team.filter((m, i) => !m.fainted && !st[side].slots.includes(i));
  function itemName(m) { return m.item ? E.itemName(m.item) : null; }
  /** The weather as it acts right now: none while a Cloud Nine or Air Lock Pokemon is out (it stays on the field). */
  function wx(st) {
    if (!st.weather) return null;
    for (const s2 of ['p', 'a']) for (const i of st[s2].slots) { const x = st[s2].team[i]; if (x && !x.fainted && (x.ability === 'Cloud Nine' || x.ability === 'Air Lock')) return null; }
    return st.weather;
  }
  function hasType(m, t) { return m.types.includes(t); }
  function grounded(m) {
    if (m.grounded || m.gravityGrounded || m.ingrain || itemName(m) === 'Iron Ball') return true;
    if (m.magnetRise) return false;
    return !hasType(m, 'Flying') && m.ability !== 'Levitate' && itemName(m) !== 'Air Balloon';
  }
  /** A recorded event: its text and kind, who it's about, and the field right after it (what replays draw). */
  function log(st, text, kind, who) {
    if (st.opts.record) st.log.push({ turn: st.turn, text, kind: kind || '', who: who ? { side: who.side, i: who.idx } : null, snap: snapshot(st) });
  }
  /** Who is out on each side and how they stand: species, name, level, HP, status; plus who is still able to fight. */
  function snapshot(st) {
    const side = sd => (st[sd].slots || []).map((i, k) => {
      const m = st[sd].team[i];
      return m ? { i, k, s: m.spec.s, n: m.name, lv: m.spec.lv, hp: m.hp, mhp: m.maxHp, st: m.status || '', f: m.fainted ? 1 : 0, mv: (m.moves || []).slice() } : null;
    }).filter(Boolean);
    return { p: side('p'), a: side('a'), pl: st.p.team.map(m => (m.fainted ? 0 : 1)), al: st.a.team.map(m => (m.fainted ? 0 : 1)) };
  }

  /** The engine spec of a battler right now (boosts, status, HP, item). */
  function specNow(m) {
    const out = Object.assign({}, m.spec, {
      it: m.item, boosts: { atk: m.boosts.atk, def: m.boosts.def, spa: m.boosts.spa, spd: m.boosts.spd, spe: m.boosts.spe },
      status: m.status, hpPct: 100 * m.hp / m.maxHp, entry: false, firstTurn: m.firstTurn && m.ability === 'Bull Rush',
    });
    // what the battle changed: its ability, types (Soak, Burn Up...), grounded (Smack Down, Ingrain, Gravity), Magnet Rise, Charge
    out.ab = m.ability || null;
    if (m.typesChanged) out.types = m.types.slice();
    if (m.ability === 'Supreme Overlord') out.faintedAllies = m.faintedAllies || 0;
    if (m.grounded || m.gravityGrounded || m.ingrain) out.grounded = true;
    if (m.magnetRise) out.floating = true;
    if (m.charged) out.charged = true;
    return out;
  }
  function fieldOpts(st, defSide) {
    const sc = st[defSide].screens;
    return { weather: wx(st), terrain: st.terrain, defSide: (sc.reflect || sc.light || sc.veil) ? { isReflect: !!sc.reflect, isLightScreen: !!sc.light, isAuroraVeil: !!sc.veil } : null };
  }
  function speed(st, m) {
    let s = m.speRaw || E.rawStats(m.spec).spe;   // speRaw: what a live battle showed (who moved first)
    s = Math.floor(s * STAGE(m.boosts.spe));
    const it = itemName(m);
    if (it === 'Choice Scarf') s = Math.floor(s * 1.5);
    if (it === 'Iron Ball') s = Math.floor(s / 2);
    const a = m.ability, w = wx(st) || '';
    if ((a === 'Swift Swim' && /Rain/.test(w)) || (a === 'Chlorophyll' && /Sun/.test(w)) || (a === 'Sand Rush' && w === 'Sand') ||
        (a === 'Slush Rush' && /Snow|Hail/.test(w)) || (a === 'Surge Surfer' && st.terrain === 'Electric') || (a === 'Unburden' && m.unburden)) s *= 2;
    if (a === 'Bull Rush' && m.firstTurn) s = Math.floor(s * 1.5);
    if ((a === 'Protosynthesis' || a === 'Quark Drive') && E.qpStat(specNow(m), st.weather, st.terrain) === 'spe') s = Math.floor(s * 1.5);
    if (a === 'Quick Feet' && m.status) s = Math.floor(s * 1.5);
    else if (m.status === 'par') s = Math.floor(s / 2);
    if (st[m.side].tailwind) s *= 2;
    return s;
  }
  function priorityOf(st, m, moveId) {
    const mm = meta(moveId);
    let p = mm.pri;
    if (m.ability === 'Prankster' && mm.cat === 'X') p += 1;
    if (m.ability === 'Gale Wings' && mm.type === 'Flying' && m.hp === m.maxHp) p += 1;
    if (m.ability === 'Triage' && (mm.drain || mm.eff === HEAL_HALF || mm.eff === HEAL_WEATHER)) p += 3;
    if (m.ability === 'Blazing Soul' && mm.type === 'Fire' && m.hp === m.maxHp) p += 1;
    if (mm.name === 'Grassy Glide' && st.terrain === 'Grassy') p += 1;
    return p;
  }

  // ---------------- entering the field ----------------
  function applyBoosts(st, m, boosts, source) {
    let changed = false;
    const landed = {};
    for (let [k, v] of Object.entries(boosts)) {
      if (!v || !(k in m.boosts)) continue;
      if (m.ability === 'Contrary') v = -v;          // stat changes go the other way
      else if (m.ability === 'Simple') v *= 2;       // and doubled
      if (v < 0 && source === 'foe' && (['Clear Body', 'White Smoke', 'Full Metal Body'].includes(m.ability) || itemName(m) === 'Clear Amulet' || st[m.side].mist)) continue;
      const before = m.boosts[k];
      m.boosts[k] = Math.max(-6, Math.min(6, before + v));
      if (m.boosts[k] !== before) { changed = true; landed[k] = m.boosts[k] - before; }
      if (v < 0 && source === 'foe' && m.boosts[k] !== before) {
        if (m.ability === 'Defiant') m.boosts.atk = Math.min(6, m.boosts.atk + 2);
        if (m.ability === 'Competitive') m.boosts.spa = Math.min(6, m.boosts.spa + 2);
      }
    }
    if (changed && st.opts.record) log(st, `${m.name}: ${Object.entries(landed).map(([k, v]) => `${k.toUpperCase()} ${v > 0 ? '+' : ''}${v}`).join(', ')}`, 'boost', m);
    return changed;
  }
  const PRIMAL_WEATHER = { 'Primordial Sea': 'Heavy Rain', 'Desolate Land': 'Harsh Sunshine', 'Delta Stream': 'Strong Winds' };
  function setPrimal(st, w, m) {
    if (st.weather === w) return;
    st.weather = w; st.weatherTurns = 999; st.primal = { side: m.side, key: m.key, ability: m.ability };
    log(st, `${w === 'Heavy Rain' ? 'A heavy rain began to fall' : w === 'Harsh Sunshine' ? 'The sunlight turned extremely harsh' : 'Mysterious strong winds are protecting Flying-type Pokémon'} (${m.name})`);
  }
  /** A primal weather ends when no Pokemon with its ability is left on the field. */
  function primalCheck(st) {
    if (!st.primal) return;
    const a = st.primal.ability;
    if (['p', 'a'].some(s2 => actives(st, s2).some(x => x.ability === a))) return;
    st.primal = null; st.weather = null; st.weatherTurns = 0; log(st, 'The extreme weather faded');
  }
  function setWeather(st, w, m) {
    if (st.weather === w) return;
    if (st.primal && /Heavy Rain|Harsh Sunshine|Strong Winds/.test(st.weather || '')) { log(st, `The extreme weather keeps ${w} away`); return; }
    st.weather = w; st.weatherTurns = (WEATHER_ROCK[itemName(m)] === w) ? 8 : 5;
    log(st, `${w === 'Sun' ? 'The sun is harsh' : w === 'Rain' ? 'It is raining' : w === 'Sand' ? 'A sandstorm rages' : 'It is snowing'} (${m.name})`);
  }
  function setTerrain(st, t, m) {
    st.terrain = t; st.terrainTurns = itemName(m) === 'Terrain Extender' ? 8 : 5;
    for (const side of ['p', 'a']) { const x = act(st, side); if (x && !x.fainted) seedCheck(st, x); }
  }
  function seedCheck(st, m) {
    const seed = TERRAIN_SEED[itemName(m)];
    if (seed && st.terrain === seed[0]) { applyBoosts(st, m, { [seed[1]]: 1 }); consume(m); }
  }
  function consume(m) {
    if (m.item) { m.lastItem = m.item; if (BERRY.test(itemName(m) || '')) m.ateBerry = true; }
    m.item = null; if (m.ability === 'Unburden') m.unburden = true;
  }
  /** m eats a berry right now (Bug Bite and Pluck eat the target's; the eater gets its effect whatever its HP). */
  function eatBerry(st, m, it) {
    if (!it || m.fainted) return;
    m.ateBerry = true;
    log(st, `${m.name} eats the ${it}`);
    if (it === 'Sitrus Berry') heal(st, m, m.maxHp / 4, it);
    else if (it === 'Oran Berry') heal(st, m, 10, it);
    else if (PINCH_HEAL.has(it)) heal(st, m, m.maxHp / 3, it);
    else if (PINCH_STAT[it]) applyBoosts(st, m, { [PINCH_STAT[it]]: 1 });
    else if (it === 'Lum Berry') { m.status = ''; m.sleep = 0; m.confused = 0; }
    else if (CURE_BERRY[it] && (m.status === CURE_BERRY[it] || (CURE_BERRY[it] === 'psn' && m.status === 'tox'))) { m.status = ''; m.sleep = 0; }
    else if (it === 'Persim Berry') m.confused = 0;
  }
  function onEntry(st, side, rng, slot) {
    const m = act(st, side, slot || 0);
    m.firstTurn = true; m.enteredTurn = st.turn; m.lock = null; m.charging = null; m.invuln = false; m.rampage = 0; m.protectStreak = 0; m.toxic = m.status === 'tox' ? 0 : m.toxic;
    clearVolatile(m);
    m.gravityGrounded = !!st.gravity;
    const pass = st.passOn && st.passOn.side === side ? st.passOn : null;
    if (pass) {
      st.passOn = null;
      if (pass.baton) { Object.assign(m, pass.baton, { boosts: Object.assign({}, pass.baton.boosts) }); log(st, `${m.name} takes over what was passed to it`); }
      if (pass.sub) { m.sub = pass.sub; log(st, `${m.name} keeps the substitute`); }
    }
    const hw = (st[side].healWish || {})[slot || 0];
    if (hw && (m.hp < m.maxHp || m.status)) {
      const rest = Object.assign({}, st[side].healWish); delete rest[slot || 0]; st[side].healWish = rest;
      m.hp = m.maxHp; m.status = ''; m.sleep = 0; m.toxic = 0;
      log(st, `The ${hw === 'Lunar Dance' ? 'mystical moonlight' : 'healing wish'} came true for ${m.name}`, 'heal', m);
    }
    const hz = st[side].hazards;
    if (itemName(m) !== 'Heavy-Duty Boots' && m.ability !== 'Magic Guard') {
      if (hz.sr) { const eff = E.typeEff('Rock', m.types); if (eff > 0) hurt(st, m, Math.max(1, Math.floor(m.maxHp * 0.125 * eff)), 'Stealth Rock'); }
      if (hz.spikes && grounded(m)) hurt(st, m, Math.max(1, Math.floor(m.maxHp * [0, 1 / 8, 1 / 6, 1 / 4][hz.spikes])), 'Spikes');
    }
    if (m.fainted) return;
    if (hz.tspikes && grounded(m)) {
      if (hasType(m, 'Poison')) { hz.tspikes = 0; log(st, `${m.name} absorbs the Toxic Spikes`); }
      else if (!m.status && !hasType(m, 'Steel') && itemName(m) !== 'Heavy-Duty Boots') { m.status = hz.tspikes >= 2 ? 'tox' : 'psn'; log(st, `${m.name} is poisoned by Toxic Spikes`); }
    }
    if (hz.web && grounded(m) && itemName(m) !== 'Heavy-Duty Boots') applyBoosts(st, m, { spe: -1 }, 'foe');
    abilityOnEntry(st, side, m);
  }
  // abilities Trace can't copy and Neutralizing Gas can't switch off
  const NO_TRACE = new Set(['Trace', 'Multitype', 'Illusion', 'Zen Mode', 'Imposter', 'Stance Change', 'Power Construct', 'Schooling', 'Comatose',
    'Shields Down', 'Disguise', 'RKS System', 'Battle Bond', 'Flower Gift', 'Forecast', 'Ice Face', 'Gulp Missile', 'Receiver', 'Power of Alchemy',
    'Neutralizing Gas', 'Hunger Switch', 'As One', 'Zero to Hero', 'Commander', 'Protosynthesis', 'Quark Drive']);
  const NO_GAS = new Set(['Multitype', 'Zen Mode', 'Stance Change', 'Schooling', 'Comatose', 'Shields Down', 'Disguise', 'RKS System', 'Battle Bond',
    'Power Construct', 'Ice Face', 'Gulp Missile', 'Neutralizing Gas', 'As One', 'Zero to Hero']);
  const gasOut = st => ['p', 'a'].some(s2 => actives(st, s2).some(x => x.ability === 'Neutralizing Gas'));
  function gasSuppress(m) { if (m.ability && !NO_GAS.has(m.ability) && m.gasOrig == null) { m.gasOrig = m.ability; m.ability = ''; } }
  /** Neutralizing Gas left the field: everyone's ability comes back. */
  function gasCheck(st) {
    if (gasOut(st)) return;
    for (const s2 of ['p', 'a']) for (const x of st[s2].team) if (x.gasOrig != null) { x.ability = x.gasOrig; x.gasOrig = null; }
  }
  function entryFormTarget(m) {
    const list = (D.mega || {})[m.spec.s];
    if (!list || !m.item) return null;
    const hit = list.find(([stone, to, need]) => !stone && need && need === m.item && !/ium Z$/.test(E.itemName(need) || ''));
    return hit ? hit[1] : null;
  }
  /** The form a Pokemon battles in because of what it holds or knows: Mega, Primal, Origin, Eternamax, Ultra Burst. */
  function heldForm(m) { return entryFormTarget(m) || megaTarget(m); }
  function entryForm(st, m) {
    const to = entryFormTarget(m);
    if (!to) return;
    const hit = [0, to];
    const s2 = E.sp(hit[1]);
    if (!s2) return;
    let ab = (s2.a || []).find(Boolean) || m.ability;
    if (m.side === 'p') ab = E.hardcoreAbility(ab, hit[1]);
    m.spec = Object.assign({}, m.spec, { s: hit[1], ab }); m.types = s2.t.slice(); m.ability = ab;
    log(st, `${m.name} changes form: ${s2.n}`, 'mega', m);
    m.name = s2.n;
  }
  function abilityOnEntry(st, side, m) {
    if (!m.formChecked) { m.formChecked = true; entryForm(st, m); }
    const foes = actives(st, other(side));
    const foe = foes.find(f => f.slot === m.slot) || foes[0];
    if (gasOut(st) && m.ability !== 'Neutralizing Gas') gasSuppress(m);
    if (m.ability === 'Neutralizing Gas') {
      for (const s2 of ['p', 'a']) for (const x of actives(st, s2)) if (x !== m) gasSuppress(x);
      log(st, 'Neutralizing gas filled the area');
    }
    if (m.ability === 'Trace' && foe && !foe.fainted && foe.ability && !NO_TRACE.has(foe.ability)) {
      if (m.abilityOrig == null) m.abilityOrig = 'Trace';
      m.ability = foe.ability; log(st, `${m.name} traced ${foe.name}'s ${foe.ability}`);
    }
    const a = m.ability;
    if (a === 'Intimidate') for (const f of foes) {
      if (NO_INTIMIDATE.has(f.ability)) { if (f.ability === 'Rattled') applyBoosts(st, f, { spe: 1 }); }
      else { applyBoosts(st, f, { atk: -1 }, 'foe'); log(st, `${m.name}'s Intimidate lowers ${f.name}'s Attack`); }
    }
    if (PRIMAL_WEATHER[a]) setPrimal(st, PRIMAL_WEATHER[a], m);
    else if (E.WEATHER_SETTERS[a]) setWeather(st, E.WEATHER_SETTERS[a], m);
    if (TERRAIN_SURGE[a]) setTerrain(st, TERRAIN_SURGE[a], m);
    if (a === 'Download' && foe && !foe.fainted) {
      const fs = E.rawStats(foe.spec);
      applyBoosts(st, m, fs.def * STAGE(foe.boosts.def) < fs.spd * STAGE(foe.boosts.spd) ? { atk: 1 } : { spa: 1 });
    }
    if (a === 'Imposter' && foe && !foe.fainted && !foe.sub && !foe.orig && !m.orig) transform(st, m, foe);
    if (a === 'Valiant Shield') applyBoosts(st, m, { def: 1 });
    if (a === 'Intrepid Sword') applyBoosts(st, m, { atk: 1 });      // "Raises Attack on entry"
    if (a === 'Dauntless Shield') applyBoosts(st, m, { def: 1 });
    seedCheck(st, m);
  }
  function switchIn(st, side, idx, rng, why, slot) {
    slot = slot || 0;
    const out = act(st, side, slot);
    if (out && !out.fainted) {
      st[side].lastOut = out.key; st[side].lastOutTurn = st.turn;
      out.boosts = { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 };
      out.lock = null; out.charging = null; out.invuln = false; out.seeded = false; out.yawn = 0; out.rampage = 0; out.sub = 0; out.destinyBond = false; out.stockpile = 0;
      out.confused = 0; out.taunt = 0; out.encore = 0; out.encoreMove = null; out.lastMove = null; out.perish = null; out.focus = false;
      clearVolatile(out);
      releaseHolds(st, out);
      if (out.ability === 'Zero to Hero' && !out.hero) {
        const hero = D.species.find(x => x.n === 'Palafin-Hero');
        if (hero) { out.hero = true; out.spec = Object.assign({}, out.spec, { s: hero.i }); out.types = hero.t.slice(); }
      }
      if (out.ability === 'Regenerator') out.hp = Math.min(out.maxHp, out.hp + Math.floor(out.maxHp / 3));
      if (out.ability === 'Natural Cure') out.status = '';
      if (out.status === 'tox') out.toxic = 0;
    }
    st[side].slots[slot] = idx;
    const m = act(st, side, slot);
    m.slot = slot;
    // the engine's AI switching cooldown (gNewBS->ai.switchingCooldown): 2 after a chosen switch, unless the other side
    // switched this turn too (SetSwitchingBankSwitchingCooldownTo2); 1 after replacing a fainted Pokemon (it can't switch
    // again until an end of turn has passed); and whenever the player's Pokemon comes in, the boss's resets to 0
    if (why === 'switch') { st.switchedTurn = Object.assign({}, st.switchedTurn, { [side]: st.turn }); m.swCooldown = (st.switchedTurn[other(side)] === st.turn) ? 0 : 2; }
    else m.swCooldown = why === 'replace' ? 1 : 0;
    if (side === 'p') for (const x of actives(st, 'a')) x.swCooldown = 0;
    st.events.push({ turn: st.turn, type: 'switch', side, to: m.key, why: why || '', slot });
    log(st, `${side === 'p' ? 'You send out' : 'Boss sends out'} ${m.name}`, 'switch', m);
    gasCheck(st);
    primalCheck(st);
    onEntry(st, side, rng, slot);
    // the engine's isFirstTurn: 2 when it comes in during a turn (a switch, a pivot, a forced switch), counted down at
    // each turn's end, so Fake Out still works the next turn; a replacement at the end of a turn gets its count taken
    // down at once (1), as the battle's leads do: Fake Out works on its first turn, and Speed Boost waits a turn only
    // for one that came in during the turn
    if (!m.fainted) m.firstTurn = why === 'replace' ? 1 : 2;
  }

  /** What leaves with a Pokemon when it switches out or comes in: locks, traps, Disable, Torment, Defense Curl... */
  function clearVolatile(m) {
    m.lockKind = null; m.rollHits = 0; m.curled = false; m.choiceMove = null; m.bound = null; m.trappedBy = null;
    m.disabled = null; m.disableTurns = 0; m.torment = false; m.furyHits = 0; m.truantLoaf = false; m.bide = null; m.focus = false; m.octolock = false;
    m.usedMoves = null; m.saltCure = false; m.ingrain = false; m.aquaRing = false; m.charged = false; m.magnetRise = 0; m.grounded = false;
    m.throatChop = 0; m.healBlock = 0; m.glaiveRush = false; m.laserFocus = false; m.lockOn = null; m.nightmare = false; m.minimized = false;
    m.endure = false; m.invulnKind = null;
    if (m.orig) { Object.assign(m, m.orig); m.orig = null; }    // Transform and type changes wear off
    if (m.typesChanged) { m.types = ((E.sp(m.spec.s) || {}).t || m.types).slice(); m.typesChanged = false; }
    if (m.abilityOrig != null) { m.ability = m.abilityOrig; m.abilityOrig = null; }
  }
  /** A Pokemon leaving the field (switched out or fainted) lets go of whatever it was binding or trapping. */
  function releaseHolds(st, m) {
    for (const f of st[other(m.side)].team) {
      if (f.bound && f.bound.side === m.side && f.bound.idx === m.idx) f.bound = null;
      if (f.trappedBy && f.trappedBy.side === m.side && f.trappedBy.idx === m.idx) { f.trappedBy = null; f.octolock = false; }
    }
  }
  /** The engine's CancelMultiTurnMoves: when a locked-in Pokemon can't move (sleep, paralysis, a flinch, confusion, Truant)
   *  or its Rollout misses, the lock ends (a charging move is lost too), and so does a Fury Cutter streak. */
  function cancelLock(m) {
    if (m.rampage || m.lockKind) { m.rampage = 0; m.lockKind = null; m.lock = m.choiceMove || null; }
    m.rollHits = 0; m.furyHits = 0; m.bide = null;
    if (m.charging) { m.charging = null; m.invuln = false; }
  }
  /** Can this Pokemon switch out right now? Not while locked into a move, charging or recharging; not while bound or
   *  trapped, or kept in by Shadow Tag, Arena Trap or Magnet Pull, unless it's a Ghost type or holds a Shed Shell. */
  function canSwitch(st, m) {
    if (!m || m.fainted) return true;
    if (m.charging || m.recharge || (m.rampage && m.lock)) return false;
    if (hasType(m, 'Ghost') || itemName(m) === 'Shed Shell') return true;
    if (m.bound || m.trappedBy || m.ingrain) return false;
    for (const f of actives(st, other(m.side))) {
      if (f.ability === 'Shadow Tag' && m.ability !== 'Shadow Tag') return false;
      if (f.ability === 'Arena Trap' && grounded(m)) return false;
      if (f.ability === 'Magnet Pull' && hasType(m, 'Steel')) return false;
    }
    return true;
  }
  /** What keeps a Pokemon from choosing freely, for the screen: { kind, move, left, hit } or null. */
  function lockInfo(m) {
    if (!m || m.fainted) return null;
    if (m.charging) return { kind: 'charging', move: m.charging };
    if (m.recharge) return { kind: 'recharge' };
    if (m.rampage && m.lock) return { kind: m.lockKind || 'rampage', move: m.lock, left: m.rampage, hit: m.rollHits || 0 };
    return null;
  }

  // ---------------- damage and effects ----------------
  function hurt(st, m, dmg, cause) {
    if (dmg <= 0 || m.fainted) return 0;
    const d = Math.min(m.hp, dmg);
    m.hp -= d;
    if (cause && st.opts.record) log(st, `${m.name} loses ${Math.round(100 * d / m.maxHp)}% (${cause})`, 'hurt', m);
    if (m.hp <= 0) faint(st, m, cause);
    else berryCheck(st, m);
    return d;
  }
  function heal(st, m, amt, cause) {
    if (m.fainted || amt <= 0 || m.hp >= m.maxHp) return;
    if (m.healBlock && cause !== 'Wish' && cause !== 'Regenerator') { log(st, `${m.name} can't heal (Heal Block)`); return; }
    const before = m.hp;
    m.hp = Math.min(m.maxHp, m.hp + Math.floor(amt));
    if (st.opts.record && m.hp > before) log(st, `${m.name} restores ${Math.round(100 * (m.hp - before) / m.maxHp)}% (${cause})`, 'heal', m);
  }
  function faint(st, m, cause) {
    if (m.ability === 'Phoenix Down' && !m.usedPhoenix) {   // Radical Red: revives to half HP on its first faint
      m.usedPhoenix = true; m.hp = Math.floor(m.maxHp / 2); m.status = '';
      log(st, `${m.name} rises again with Phoenix Down!`, 'heal', m); return;
    }
    m.hp = 0; m.fainted = true; m.status = '';
    releaseHolds(st, m);
    for (const x of st[m.side].team) if (x !== m) x.faintedAllies = (x.faintedAllies || 0) + 1;   // Supreme Overlord
    for (const s2 of ['p', 'a']) for (const x of actives(st, s2)) if (x !== m && x.ability === 'Soul-Heart') applyBoosts(st, x, { spa: 1 });
    if (m.ability === 'Neutralizing Gas') gasCheck(st);
    if (st.primal) primalCheck(st);
    st.events.push({ turn: st.turn, type: 'faint', side: m.side, key: m.key, name: m.name, cause: cause || '' });
    log(st, `${m.name} faints${cause ? ' (' + cause + ')' : ''}`, 'faint', m);
  }
  /** A foe with Unnerve (or As One) keeps berries from being eaten. */
  const unnerved = (st, m) => actives(st, other(m.side)).some(x => x.ability === 'Unnerve' || x.ability === 'As One');
  function berryCheck(st, m) {
    const it = itemName(m);
    if (!it || m.fainted) return;
    if (BERRY.test(it) && unnerved(st, m)) return;
    const r = m.ability === 'Ripen' ? 2 : 1;                                // Ripen: berries work twice as well
    const pinch = m.hp <= m.maxHp / (m.ability === 'Gluttony' ? 2 : 4);    // Gluttony: pinch berries at half HP
    const ate = () => { if (m.ability === 'Cheek Pouch') heal(st, m, m.maxHp / 3, 'Cheek Pouch'); };
    if (it === 'Sitrus Berry' && m.hp <= m.maxHp / 2) { consume(m); heal(st, m, r * m.maxHp / 4, 'Sitrus Berry'); ate(); }
    else if (it === 'Oran Berry' && m.hp <= m.maxHp / 2) { consume(m); heal(st, m, 10 * r, 'Oran Berry'); ate(); }
    else if (it === 'Berry Juice' && m.hp <= m.maxHp / 2) { consume(m); heal(st, m, 20, 'Berry Juice'); }
    else if (PINCH_HEAL.has(it) && pinch) { consume(m); heal(st, m, r * m.maxHp / 3, it); ate(); }
    else if (PINCH_STAT[it] && pinch) { consume(m); applyBoosts(st, m, { [PINCH_STAT[it]]: r }); ate(); }
  }
  function canStatus(st, target, status, moveName, attacker) {
    if (target.fainted || target.status) return false;
    if (st[target.side].safeguard && attacker && attacker.side !== target.side) return false;
    if (target.sub && attacker && attacker.side !== target.side) return false;
    if (st.terrain === 'Misty' && grounded(target)) return false;
    if (status === 'brn' && (hasType(target, 'Fire') || ['Water Veil', 'Water Bubble', 'Thermal Exchange'].includes(target.ability))) return false;
    if ((status === 'psn' || status === 'tox') && (hasType(target, 'Poison') || hasType(target, 'Steel')) && !(attacker && attacker.ability === 'Corrosion')) return false;
    if ((status === 'psn' || status === 'tox') && ['Immunity', 'Pastel Veil'].includes(target.ability)) return false;
    if (status === 'par' && (hasType(target, 'Electric') || target.ability === 'Limber')) return false;
    if (status === 'par' && moveName === 'Thunder Wave' && hasType(target, 'Ground')) return false;
    if (status === 'frz' && (hasType(target, 'Ice') || target.ability === 'Magma Armor' || /Sun/.test(st.weather || ''))) return false;
    if (status === 'slp' && (SLEEP_IMMUNE.has(target.ability) || (st.terrain === 'Electric' && grounded(target)))) return false;
    if (target.ability === 'Leaf Guard' && /Sun/.test(wx(st) || '')) return false;
    if (status === 'slp' && ['p', 'a'].some(sd => actives(st, sd).some(x => x.lockKind === 'uproar'))) return false;
    if (POWDER.has(moveName) && (hasType(target, 'Grass') || target.ability === 'Overcoat' || itemName(target) === 'Safety Goggles')) return false;
    return true;
  }
  function inflict(st, target, status, rng, why, src) {
    target.status = status;
    if (target.ability === 'Synchronize' && src && src !== target && /psn|tox|par|brn/.test(status) && canStatus(st, src, status, '', target)) {
      log(st, `${target.name}'s Synchronize passes it on`); inflict(st, src, status, rng, 'Synchronize');
    }
    if (status === 'slp') target.sleep = rng.expected ? 2 : 1 + Math.floor(rng() * 3);
    if (status === 'tox') target.toxic = 0;
    log(st, `${target.name} ${{ brn: 'is burned', par: 'is paralyzed', psn: 'is poisoned', tox: 'is badly poisoned', slp: 'is asleep', frz: 'got frostbite' }[status]}${why ? ' (' + why + ')' : ''}`, 'status', target);
    const cure = itemName(target);
    if ((cure === 'Lum Berry' || CURE_BERRY[cure] === status || (CURE_BERRY[cure] === 'psn' && status === 'tox')) && !unnerved(st, target)) {
      consume(target); target.status = ''; target.sleep = 0; log(st, `${target.name}'s ${cure} cures it`);
      if (target.ability === 'Cheek Pouch') heal(st, target, target.maxHp / 3, 'Cheek Pouch');
    }
  }
  function roll(rng, p) { if (p >= 1) return true; if (p <= 0) return false; return rng.expected ? p >= 0.5 : rng() < p; }

  function hitChance(st, user, target, mm) {
    if (mm.acc === 0 || user.ability === 'No Guard' || target.ability === 'No Guard') return 1;
    let acc = mm.acc;
    const w = wx(st) || '';
    if ((mm.name === 'Thunder' || mm.name === 'Hurricane') && /Rain/.test(w)) return 1;
    if ((mm.name === 'Thunder' || mm.name === 'Hurricane') && /Sun/.test(w)) acc = 50;
    if (mm.name === 'Blizzard' && /Snow|Hail/.test(w)) return 1;
    if (mm.name === 'Toxic' && hasType(user, 'Poison')) return 1;
    if (user.ability === 'Fatal Precision' && E.typeEff(mm.type, target.types) > 1) return 1;
    let p = acc / 100 * ACC_STAGE(user.boosts.acc - target.boosts.eva);
    if (user.ability === 'Compound Eyes') p *= 1.3;
    if (user.ability === 'Illuminate') p *= 1.2;                 // Radical Red: "Raises accuracy by 20%"
    if (user.ability === 'Hustle' && mm.cat === 'P') p *= 0.8;
    if (user.ability === 'Victory Star') p *= 1.1;
    if (itemName(user) === 'Wide Lens') p *= 1.1;
    if (['BrightPowder', 'Bright Powder', 'Lax Incense'].includes(itemName(target))) p *= 0.9;
    if ((target.ability === 'Sand Veil' && w === 'Sand') || (target.ability === 'Snow Cloak' && /Snow|Hail/.test(w))) p *= 0.8;
    return Math.min(1, p);
  }
  function critChance(user, target, mm) {
    if (['Battle Armor', 'Shell Armor'].includes(target.ability)) return 0;
    if (mm.alwaysCrit) return 1;
    let stage = mm.highCrit ? 1 : 0;
    const it = itemName(user);
    if (it === 'Scope Lens' || it === 'Razor Claw') stage++;
    if (user.ability === 'Super Luck') stage++;
    if (user.ability === 'Merciless' && /psn|tox/.test(target.status || '')) return 1;
    const species = (E.sp(user.spec.s) || {}).n || '';
    if (/^(Leek|Stick|Leek Stick)$/.test(it || '') && /Farfetch|Sirfetch/.test(species)) stage += 2;
    if (it === 'Lucky Punch' && /^Chansey/.test(species)) stage += 2;
    if (user.focus) stage += 2;
    return [1 / 24, 1 / 8, 1 / 2, 1][Math.min(3, stage)];
  }
  function pickHits(rng, user, mm) {
    if (!mm.multihit) return 0;
    const [lo, hi] = mm.multihit;
    if (user.ability === 'Skill Link') return hi;
    if (lo === 2 && hi === 5) {
      if (itemName(user) === 'Loaded Dice') return rng.expected ? 4 : (rng() < 0.5 ? 4 : 5);
      if (rng.expected) return 3;
      const r = rng(); return r < 0.35 ? 2 : r < 0.7 ? 3 : r < 0.85 ? 4 : 5;
    }
    return hi;
  }

  /** Run one move. ctx: {first: did the user move before the target this turn, targetAction} */
  /** Who a move hits: the chosen target (or the other foe if it fainted, or a foe that redirects it), both foes, or everyone else. */
  function targetsOf(st, user, moveId, ctx) {
    const mm = meta(moveId);
    const tg = (E.mv(moveId) || {}).tg || 0;
    const foes = actives(st, other(user.side));
    if (tg === 8) return foes;                                                     // both foes: Rock Slide, Heat Wave, Growl
    if (tg === 32) return foes.concat(actives(st, user.side).filter(m => m !== user)); // everyone else: Earthquake, Surf
    if (tg === 16 || tg === 64) return [];                                         // self, own side or the field
    let t = ctx.target && !ctx.target.fainted && isActive(st, ctx.target) && ctx.target !== user ? ctx.target : null;
    if (!t || t.side === user.side) t = foes.find(f => f.slot === (ctx.target ? ctx.target.slot : 0)) || foes[0] || null;
    if (t && st.size > 1 && foes.length > 1) {
      const center = foes.find(f => f.redirect && f !== t && !(f.redirect === 'Rage Powder' && (hasType(user, 'Grass') || user.ability === 'Overcoat' || itemName(user) === 'Safety Goggles')));
      if (center && !['Stalwart', 'Propeller Tail'].includes(user.ability)) t = center;
      else {
        const rod = foes.find(f => f !== t && ((f.ability === 'Lightning Rod' && mm.type === 'Electric') || (f.ability === 'Storm Drain' && mm.type === 'Water')));
        if (rod && !['Stalwart', 'Propeller Tail'].includes(user.ability)) t = rod;
      }
    }
    return t ? [t] : [];
  }
  function useMove(st, side, moveId, rng, ctx) {
    ctx = ctx || {};
    const user = ctx.user || act(st, side, ctx.slot || 0);
    if (!user || user.fainted || !isActive(st, user)) return;
    user.movedThisTurn = true;
    const mm0 = meta(moveId);
    // What the player saw happen in a live battle: '' lets the dice decide; 'hit', 'miss' or 'crit' means it moved;
    // 'par', 'slp', 'frz', 'conf' or 'flinch' means it couldn't. ko / noKO: its hit did (or didn't) knock the target out.
    const F = ctx.outcome || '';
    user.forced = { o: F, ko: !!ctx.ko, noKO: !!ctx.noKO };
    const cant = (o, text) => { log(st, text, 'cant', user); st.events.push({ turn: st.turn, type: 'outcome', side, key: user.key, o }); cancelLock(user); };
    // turn-skipping conditions, in the game's order (a move another move calls, like Assist's, has passed them already)
    if (!ctx.called) {
    if (user.recharge) { user.recharge = false; cant('recharge', `${user.name} must recharge!`); return; }
    if (user.status === 'slp' || F === 'slp') {
      const talk = (mm0.name === 'Sleep Talk' || mm0.name === 'Snore') && F !== 'slp';
      if (F === 'slp' && user.status !== 'slp') { user.status = 'slp'; user.sleep = 1; }
      if (F && F !== 'slp' && !talk) { user.status = ''; user.sleep = 0; log(st, `${user.name} woke up!`, 'cure', user); }
      else if (user.sleep > 0 || F === 'slp') {
        if (user.sleep > 0) user.sleep -= user.ability === 'Early Bird' ? Math.min(2, user.sleep) : 1;
        if (talk && mm0.name === 'Sleep Talk') {
          const others = user.moves.filter(id => meta(id).name !== 'Sleep Talk' && ![CHARGE, SEMI_INV, SOLAR].includes(meta(id).eff));
          if (others.length) { log(st, `${user.name} uses Sleep Talk`); moveId = others[rng.expected ? 0 : Math.floor(rng() * others.length)]; }
          else { cant('slp', `${user.name} is fast asleep.`); return; }
        } else if (!talk) { cant('slp', `${user.name} is fast asleep.`); return; }
      } else { user.status = ''; log(st, `${user.name} woke up!`, 'cure', user); }
    }
    // Radical Red's freeze is frostbite (CFRU's FROSTBITE): it still moves, and using a thawing move cures it
    if (user.status === 'frz' && THAW_USER.has(moveId)) { user.status = ''; log(st, `${user.name}'s frostbite was cured!`, 'cure', user); }
    if (F === 'flinch' || (user.flinch && !F)) { cant('flinch', `${user.name} flinched and couldn't move!`); if (user.ability === 'Steadfast') applyBoosts(st, user, { spe: 1 }); return; }
    if (user.ability === 'Truant') {   // every other turn it loafs around
      if (user.truantLoaf) { user.truantLoaf = false; cant('truant', `${user.name} is loafing around!`); return; }
      user.truantLoaf = true;
    }
    if (user.confused || F === 'conf') {
      user.confused = F === 'conf' ? Math.max(1, (user.confused || 2) - 1) : user.confused - 1;
      if (user.confused <= 0) { user.confused = 0; log(st, `${user.name} snapped out of its confusion!`, 'cure', user); }
      else {
        log(st, `${user.name} is confused!`, 'conf', user);
        if (F === 'conf' || (!F && !rng.expected && rng() < 1 / 3)) {   // Gen 7+ odds: one in three
          const rs = E.rawStats(user.spec);
          const a = rs.atk * STAGE(user.boosts.atk), d = rs.def * STAGE(user.boosts.def);
          const lv = user.spec.lv || 50;
          const base = Math.floor(Math.floor(Math.floor(2 * lv / 5 + 2) * 40 * a / d) / 50) + 2;
          st.events.push({ turn: st.turn, type: 'outcome', side, key: user.key, o: 'conf' });
          cancelLock(user);
          hurt(st, user, Math.max(1, Math.floor(base * (85 + Math.floor(rng() * 16)) / 100)), 'hurt itself in confusion');
          return;
        }
      }
    }
    if (F === 'par' || (user.status === 'par' && !F && !rng.expected && rng() < 0.25)) {
      if (user.status !== 'par') user.status = 'par';
      cant('par', `${user.name} is paralyzed! It can't move!`); return;
    }
    }
    const mm = meta(moveId);
    st.events.push({ turn: st.turn, type: 'move', side, user: user.key, move: moveId });
    st.events.push({ turn: st.turn, type: 'outcome', side, key: user.key, o: 'hit' });
    // Choice lock (and Gorilla Tactics, Sage Power): the first move it uses, until it switches out
    if ((/^Choice /.test(itemName(user) || '') || user.ability === 'Sage Power' || user.ability === 'Gorilla Tactics') && !user.choiceMove) user.choiceMove = moveId;
    if (user.choiceMove && !user.rampage) user.lock = user.choiceMove;
    // moves that lock it in: Thrash/Outrage/Petal Dance for 2-3 turns (then it's confused), Uproar for 2-5, Bide for 3;
    // Rollout and Ice Ball for 5 hits from the first one that lands. No switching and no other move until it ends.
    const wasLocked = !!(user.rampage && user.lock);
    if (!wasLocked && (mm.eff === RAMPAGE || mm.eff === UPROAR || mm.eff === BIDE)) {
      user.lockKind = mm.eff === RAMPAGE ? 'rampage' : mm.eff === UPROAR ? 'uproar' : 'bide';
      user.lock = moveId;
      // forced uses left after this one: a rampage lasts 2-3 turns, Uproar 2-5 (the engine's timers), Bide stores for two
      user.rampage = mm.eff === RAMPAGE ? (rng.expected ? 1 : (rng() < 0.5 ? 1 : 2)) : mm.eff === UPROAR ? (rng.expected ? 2 : 1 + Math.floor(rng() * 4)) : 3;
      if (mm.eff === BIDE) user.bide = { dmg: 0 };
    }
    // the power of this use, for moves that grow: Rollout and Ice Ball double each hit (twice that after Defense Curl),
    // Fury Cutter doubles up to 160 while it keeps hitting, Echoed Voice adds 40 for each turn in a row someone used it
    let bp = 0;
    if (mm.eff === ROLLOUT) bp = mm.power * Math.pow(2, wasLocked && user.lockKind === 'rollout' ? user.rollHits : 0) * (user.curled ? 2 : 1);
    if (mm.name === 'Fury Cutter') { if (user.lastMove !== moveId) user.furyHits = 0; bp = mm.power * Math.pow(2, Math.min(2, user.furyHits)); }
    if (mm.name === 'Echoed Voice') {
      const ev = st.echo || { turn: -9, n: 0 };
      const n = ev.turn === st.turn ? ev.n : ev.turn === st.turn - 1 ? Math.min(4, ev.n + 1) : 0;
      st.echo = { turn: st.turn, n }; bp = mm.power * (1 + n);
    }
    if (mm.name === 'Spit Up') {     // 100 power per Stockpile; it fails with none
      if (!user.stockpile) { log(st, `${side === 'p' ? 'Your' : 'Boss'} ${user.name} uses Spit Up`, 'move', user); log(st, 'But it failed to spit up a thing'); user.lastMove = moveId; return; }
      bp = 100 * user.stockpile;
    }
    if (mm.name === 'Magnitude') {   // Magnitude 4-10: 10, 30, 50, 70, 90, 110, 150 power (5, 10, 20, 30, 20, 10, 5%)
      const r = rng.expected ? 0.5 : rng();
      const t = [[0.05, 4, 10], [0.15, 5, 30], [0.35, 6, 50], [0.65, 7, 70], [0.85, 8, 90], [0.95, 9, 110], [1.01, 10, 150]].find(x => r < x[0]);
      bp = t[2]; log(st, `Magnitude ${t[1]}!`);
    }
    if (mm.name === 'Present') {     // 40 (40%), 80 (30%), 120 (10%) power, or it heals the target by 1/4 (20%)
      const r = rng.expected ? 0.5 : rng();
      if (r >= 0.8) { const t = targetsOf(st, user, moveId, ctx)[0]; if (t && t.hp < t.maxHp) heal(st, t, t.maxHp / 4, 'Present'); else log(st, 'But it failed'); user.lastMove = moveId; return; }
      bp = r < 0.4 ? 40 : r < 0.7 ? 80 : 120;
    }
    if (bp && bp !== mm.power) ctx = Object.assign({}, ctx, { bp });
    // two-turn moves
    const instantCharge = itemName(user) === 'Power Herb' || (mm.eff === SOLAR && /Sun/.test(st.weather || '')) || (mm.name === 'Electro Shot' && /Rain/.test(st.weather || ''));
    if ((mm.eff === CHARGE || mm.eff === SOLAR || mm.eff === SEMI_INV || mm.eff === SKY_ATTACK || mm.eff === RAZOR_WIND || mm.name === 'Geomancy' || mm.name === 'Sky Attack') && !user.charging) {
      if (mm.name === 'Meteor Beam' || mm.name === 'Electro Shot') applyBoosts(st, user, { spa: 1 });
      if (mm.name === 'Skull Bash') applyBoosts(st, user, { def: 1 });
      if (instantCharge) { if (itemName(user) === 'Power Herb') consume(user); }
      else {
        user.charging = moveId; user.invuln = mm.eff === SEMI_INV || !!INVULN_KIND[mm.name]; user.invulnKind = INVULN_KIND[mm.name] || (user.invuln ? 'air' : null); user.chargeTarget = ctx.target || null;
        log(st, `${user.name} uses ${mm.name} (charging)`); return;
      }
    }
    if (user.charging === moveId) { user.charging = null; user.invuln = false; if (!ctx.target && user.chargeTarget) ctx.target = user.chargeTarget; }
    const zk = ctx.z ? zKind(st, user, moveId) : null;
    if (zk) {
      st[side].zUsed = true;
      log(st, `${side === 'p' ? 'Your' : 'Boss'} ${user.name} unleashes its Z-Move (Z-${mm.name})!`, 'move', user);
      st.events.push({ turn: st.turn, type: 'zmove', side, user: user.key, move: moveId });
      if (zk === 'evoboost') { user.lastMove = moveId; applyBoosts(st, user, { atk: 2, def: 2, spa: 2, spd: 2, spe: 2 }); return; }
    } else log(st, `${side === 'p' ? 'Your' : 'Boss'} ${user.name} uses ${mm.name}`, 'move', user);
    user.lastMove = moveId;
    if (user.glaiveRush) user.glaiveRush = false;   // Glaive Rush's opening lasts until the user moves again
    // Last Resort works only once the user has used every other move it knows since it came in
    if (mm.name === 'Last Resort') {
      const others = user.moves.filter(id => id !== moveId), used = user.usedMoves || [];
      if (!others.length || others.some(id => !used.includes(id))) { log(st, 'But it failed'); return; }
    }
    if (!(user.usedMoves || []).includes(moveId)) user.usedMoves = (user.usedMoves || []).concat(moveId);
    if (ROM_GRAVITY_BANNED.has(moveId) && st.gravity) { log(st, `${user.name} can't use ${mm.name} because of gravity`); return; }
    if ((mm.eff === HEAL_HALF || mm.eff === HEAL_WEATHER || mm.eff === 37 || mm.eff === WISH || mm.name === 'Swallow' || mm.name === 'Strength Sap' || (mm.drain && mm.cat === 'X')) && user.healBlock) { log(st, `${user.name} can't use ${mm.name} (Heal Block)`); return; }
    if (mm.sound && user.throatChop) { log(st, `${user.name} can't use ${mm.name} (Throat Chop)`); return; }
    if ((mm.name === 'Burn Up' && !hasType(user, 'Fire')) || (mm.name === 'Double Shock' && !hasType(user, 'Electric'))) { log(st, 'But it failed'); return; }
    if (mm.name === 'Steel Roller' && !st.terrain) { log(st, 'But it failed'); return; }
    if (mm.name === 'Belch' && !user.ateBerry) { log(st, 'But it failed'); return; }
    if (mm.name === 'Shell Trap' && !user.hitPhysicalThisTurn) { log(st, `${user.name}'s shell trap didn't work`); return; }
    if (mm.name === 'Snore' && user.status !== 'slp') { log(st, 'But it failed'); return; }
    if ((mm.eff === 7 || mm.name === 'Misty Explosion' || mm.name === 'Mind Blown') && ['p', 'a'].some(s2 => actives(st, s2).some(x => x.ability === 'Damp'))) {
      log(st, `Damp prevents ${user.name} from using ${mm.name}`); return;
    }
    if ((user.ability === 'Protean' || user.ability === 'Libero') && mm.type && !(user.types.length === 1 && user.types[0] === mm.type)) {
      user.types = [mm.type]; user.typesChanged = true; log(st, `${user.name} became the ${mm.type} type (${user.ability})`);
    }
    // moves that call another move: Nature Power (Tri Attack, or the terrain's move), Assist (a random move of a teammate's)
    if (mm.name === 'Nature Power') {
      const call = { Electric: 'Thunderbolt', Grassy: 'Energy Ball', Misty: 'Moonblast', Psychic: 'Psychic' }[st.terrain] || 'Tri Attack';
      const id = (D.moves.find(x => (x.f || x.n) === call) || {}).i;
      if (id) { log(st, `Nature Power turns into ${call}`); return useMove(st, side, id, rng, Object.assign({}, ctx, { user, called: true })); }
    }
    if (mm.name === 'Assist' && !ctx.called) {
      const pool = [];
      for (const m2 of st[side].team) if (m2 !== user) for (const id of m2.moves) if (!ASSIST_BANNED.has(meta(id).name) && !pool.includes(id)) pool.push(id);
      if (!pool.length) { log(st, 'But it failed'); return; }
      const id = pool[rng.expected ? 0 : Math.floor(rng() * pool.length)];
      log(st, `Assist calls ${meta(id).name}`);
      return useMove(st, side, id, rng, Object.assign({}, ctx, { user, called: true }));
    }
    if (mm.cat === 'X' && user.taunt) { log(st, `${user.name} can't use ${mm.name} after the taunt`); return; }
    if (mm.eff === FAKE_OUT && !user.firstTurn) { log(st, 'But it failed'); return; }
    if (mm.name === 'Focus Punch' && user.hitThisTurn) { log(st, `${user.name} loses its focus`); return; }
    if (mm.eff === BIDE && user.lockKind === 'bide') {
      user.rampage--;
      if (user.rampage > 0) { log(st, `${user.name} is storing energy`); return; }
      const dmg = 2 * ((user.bide && user.bide.dmg) || 0), foe = actives(st, other(side))[0];
      cancelLock(user);
      if (!dmg || !foe) { log(st, `${user.name} unleashes its energy, but it failed`); return; }
      log(st, `${user.name} unleashes its energy`);
      hurt(st, foe, dmg, 'Bide');
      if (foe.fainted) faint(st, foe, `${user.name}'s Bide`);
      return;
    }
    const tg = (E.mv(moveId) || {}).tg || 0;
    const targets = targetsOf(st, user, moveId, ctx);
    if (mm.eff === SUCKER) {
      const t = targets[0], ta = t && t.plannedAction;
      if (!t || !ta || ta.type !== 'move' || meta(ta.id).cat === 'X' || t.movedThisTurn) { log(st, 'But it failed'); return; }
    }

    // ---- status moves ----
    if (mm.cat === 'X') {
      if (tg === 8 || tg === 32) { for (const t of targets) statusMove(st, user, t, mm, rng); if (!targets.length) log(st, 'But it failed'); return; }
      return statusMove(st, user, targets[0] || null, mm, rng);
    }

    // ---- damaging moves ----
    // Counter (physical hits x2), Mirror Coat (special x2), Metal Burst and Comeuppance (any hit x1.5): back at whoever
    // hit the user this turn, after it was hit; they fail otherwise (the engine's effect 89 and Mirror Coat's 144)
    if (/^(Counter|Mirror Coat|Metal Burst|Comeuppance)$/.test(mm.name)) {
      const hit = mm.name === 'Counter' ? user.lastPhys : mm.name === 'Mirror Coat' ? user.lastSpec : user.lastHit;
      const foe = hit && hit.turn === st.turn ? st[hit.side].team[hit.idx] : null;
      if (!foe || foe.fainted || !isActive(st, foe)) { log(st, 'But it failed'); return; }
      if (foe.protect) { log(st, `${foe.name} protects itself`); return; }
      if (E.typeEff(mm.type, foe.types) === 0) { log(st, `It doesn't affect ${foe.name}`); return; }
      const dmg = Math.max(1, Math.floor(hit.dmg * (mm.name === 'Counter' || mm.name === 'Mirror Coat' ? 2 : 1.5)));
      foe.hitThisTurn = true;
      hurt(st, foe, foe.sub ? 0 : dmg, mm.name);
      if (foe.sub) { foe.sub = Math.max(0, foe.sub - dmg); log(st, 'The substitute takes the hit'); }
      return;
    }
    if (mm.eff === 8 && targets[0] && targets[0].status !== 'slp' && targets[0].ability !== 'Comatose') { log(st, `${targets[0].name} isn't asleep: it fails`); return; }
    if (mm.eff === FUTURE) { if (targets[0]) futureAttack(st, user, targets[0], moveId, mm); else log(st, 'But there was no target'); return; }
    if (!targets.length) { log(st, 'But there was no target'); cancelLock(user); return; }
    const spread = targets.length > 1 ? 0.75 : 1;
    let total = 0, anyHit = false;
    for (const t of targets) {
      if (user.fainted) break;
      const r = hitOne(st, user, t, moveId, mm, rng, ctx, zk, spread, tg);
      total += r.dealt; anyHit = anyHit || r.hit;
    }
    if (user.ability === 'Gulp Missile' && (mm.name === 'Surf' || mm.name === 'Dive') && !user.fainted && !user.gulp) user.gulp = user.hp > user.maxHp / 2 ? 'arrokuda' : 'pikachu';
    if (mm.name === 'Spit Up' && user.stockpile) { const k = user.stockpile; user.stockpile = 0; applyBoosts(st, user, { def: -k, spd: -k }); }
    if (user.charged && mm.type === 'Electric') user.charged = 0;
    if (mm.sound && itemName(user) === 'Throat Spray' && !user.fainted && total > 0) { consume(user); applyBoosts(st, user, { spa: 1 }); }
    // once per move: attacker items, recoil, drain
    if (!user.fainted && total > 0) {
      if (itemName(user) === 'Life Orb' && user.ability !== 'Magic Guard' && user.ability !== 'Sheer Force') hurt(st, user, Math.max(1, Math.floor(user.maxHp / 10)), 'Life Orb');
      if (mm.recoil && !['Rock Head', 'Magic Guard', 'Bad Company'].includes(user.ability)) hurt(st, user, Math.max(1, Math.floor(total * mm.recoil[0] / mm.recoil[1])), 'recoil');
      if (mm.drain && !user.fainted) heal(st, user, Math.max(1, Math.floor(total * mm.drain[0] / mm.drain[1]) * (itemName(user) === 'Big Root' ? 1.3 : 1)), 'drain');
      if (itemName(user) === 'Shell Bell') heal(st, user, Math.floor(total / 8), 'Shell Bell');
    }
    // Mind Blown and Steel Beam: half the user's max HP (rounded up), hit or miss (CFRU ATK49_MOVE_RECOIL)
    if (ROM_HALF_HP.has(moveId) && !user.fainted && user.ability !== 'Magic Guard') hurt(st, user, Math.max(1, Math.ceil(user.maxHp / 2)), mm.name);
    if (mm.name === 'Struggle' && !user.fainted && total > 0) hurt(st, user, Math.max(1, Math.floor(user.maxHp / 4)), 'recoil');
    if ((mm.eff === 7 || mm.name === 'Misty Explosion' || mm.name === 'Explosion' || mm.name === 'Self-Destruct') && !user.fainted) faint(st, user, mm.name);
    if (mm.name === 'Final Gambit' && anyHit && !user.fainted) faint(st, user, mm.name);
    // locks: Rollout starts on its first hit and ends on a miss or after five; a rampage runs its course (then confusion);
    // Uproar runs out; Fury Cutter keeps its streak only while it hits
    if (mm.name === 'Fury Cutter') user.furyHits = anyHit ? user.furyHits + 1 : 0;
    if (!user.fainted && mm.eff === ROLLOUT && !zk) {
      if (!anyHit) cancelLock(user);
      else if (!wasLocked || user.lockKind !== 'rollout') { user.lockKind = 'rollout'; user.lock = moveId; user.rampage = 4; user.rollHits = 1; }
      else { user.rollHits++; if (--user.rampage <= 0) cancelLock(user); }
    } else if (!user.fainted && !wasLocked && (user.lockKind === 'rampage' || user.lockKind === 'uproar') && !anyHit) {
      cancelLock(user);   // a rampage that misses on its first turn never starts
    } else if (!user.fainted && wasLocked && (user.lockKind === 'rampage' || user.lockKind === 'uproar')) {
      if (--user.rampage <= 0) {
        const kind = user.lockKind;
        cancelLock(user);
        if (kind === 'rampage') confuse(st, user, rng, 'fatigue');
        else log(st, `${user.name} calms down`);
      }
    }
    if (user.fainted || !anyHit) return;
    if (zk) { if (mm.eff === RECHARGE) user.recharge = false; return; }
    const sheer = user.ability === 'Sheer Force';
    const chanceOf = p => Math.min(1, (user.ability === 'Serene Grace' ? 2 : 1) * p / 100);
    if (!sheer && HIT_SELF_UP[mm.eff] && mm.name !== 'Fell Stinger' && mm.name !== 'Mortal Spin' && roll(rng, chanceOf(mm.eff === 129 ? 100 : (mm.ec || 100)))) applyBoosts(st, user, HIT_SELF_UP[mm.eff]);
    if ((mm.eff === 182 || mm.eff === 204 || SELF_DROP[mm.name]) && SELF_DROP[mm.name]) applyBoosts(st, user, SELF_DROP[mm.name], user.ability === 'Bad Company' ? 'self-blocked' : 'self');
    else if (mm.eff === 204 && user.ability !== 'Bad Company') applyBoosts(st, user, { spa: -2 });
    if (mm.eff === 129) { st[side].hazards = { sr: 0, spikes: 0, tspikes: 0, web: 0 }; user.bound = null; user.seeded = false; }
    if (mm.eff === RECHARGE) user.recharge = true;
    // pivots
    if (mm.eff === PIVOT && !user.fainted && bench(st, side).length) pivot(st, side, rng, user.slot);
  }
  /** One target of a damaging move: protection, accuracy, damage (spread moves do 75%), reactions and secondary effects. */
  function hitOne(st, user, target, moveId, mm, rng, ctx, zk, spread, tg) {
    const none = { dealt: 0, hit: false };
    const tside = target.side;
    if (tside !== user.side && st[tside].wideGuard && (tg === 8 || tg === 32)) { log(st, `Wide Guard protects ${target.name}`); return none; }
    if (tside !== user.side && st[tside].quickGuard && priorityOf(st, user, moveId) > 0) { log(st, `Quick Guard protects ${target.name}`); return none; }
    if (mm.name === 'Poltergeist' && !target.item) { log(st, 'But it failed'); return none; }   // the effect script fails it first
    // Feint, Shadow Force, Phantom Force, Hyperspace Hole/Fury and Hyper Drill get through Protect and lift it
    if (target.protect && ROM_LIFT_PROTECT.has(moveId)) { target.protect = false; log(st, `${target.name}'s protection was lifted`); }
    if (target.protect && !zk && !(user.ability === 'Unseen Fist' && mm.contact)) {   // Unseen Fist: contact moves get through
      log(st, `${target.name} protects itself`);
      if (mm.contact) {
        const pt = target.protectKind;
        if (pt === 'Spiky Shield') hurt(st, user, Math.max(1, Math.floor(user.maxHp / 8)), 'Spiky Shield');
        if (pt === "King's Shield") applyBoosts(st, user, { atk: -1 }, 'foe');
        if (pt === 'Baneful Bunker' && canStatus(st, user, 'psn', '', target)) inflict(st, user, 'psn', rng, 'Baneful Bunker');
        if (pt === 'Burning Bulwark' && canStatus(st, user, 'brn', '', target)) inflict(st, user, 'brn', rng, 'Burning Bulwark');
        if (pt === 'Silk Trap') applyBoosts(st, user, { spe: -1 }, 'foe');
        if (pt === 'Obstruct') applyBoosts(st, user, { def: -2 }, 'foe');
      }
      return none;
    }
    // a Pokemon up in the air, under ground or under water: only the game's lists of moves reach it (No Guard and Lock-On
    // too), and those hit it twice as hard: Earthquake and Magnitude under ground, Surf and Whirlpool under water, Gust and
    // Twister in the air (CFRU MissesDueToSemiInvulnerability and its damage code)
    let invulnMul = 1;
    if (target.invuln) {
      const k = target.invulnKind || 'air';
      const reach = k === 'air' ? ROM_IN_AIR.has(moveId) : k === 'under' ? ROM_UNDERGROUND.has(moveId) : k === 'water' ? ROM_UNDERWATER.has(moveId) : false;
      const sure = user.ability === 'No Guard' || target.ability === 'No Guard' || (user.lockOn && user.lockOn === target.key);
      if (!reach && !sure) { log(st, `${target.name} avoids the attack`); return none; }
      if (reach && ((k === 'under' && /^(Earthquake|Magnitude)$/.test(mm.name)) || (k === 'water' && /^(Surf|Whirlpool)$/.test(mm.name)) || (k === 'air' && /^(Gust|Twister)$/.test(mm.name)))) invulnMul = 2;
      if (reach && k === 'air' && /^(Smack Down|Thousand Arrows)$/.test(mm.name)) { target.charging = null; target.invuln = false; target.invulnKind = null; log(st, `${target.name} falls straight down`); }
    }
    const FO = user.forced || {};
    // sure hits: Lock-On / Mind Reader on this target, Glaive Rush's opening, a minimized target for Stomp and the like
    const sureHit = (user.lockOn && user.lockOn === target.key) || target.glaiveRush || (target.minimized && ROM_MINIMIZE.has(moveId));
    if (!zk && !sureHit && FO.o !== 'hit' && FO.o !== 'crit' && (FO.o === 'miss' || !roll(rng, hitChance(st, user, target, mm)))) {
      log(st, `${user.name}'s attack misses ${target.name}`, 'miss', user);
      st.events.push({ turn: st.turn, type: 'outcome', side: user.side, key: user.key, o: 'miss' });
      if (mm.name === 'High Jump Kick' || mm.name === 'Jump Kick' || mm.name === 'Supercell Slam') hurt(st, user, Math.max(1, Math.floor(user.maxHp / 2)), 'crash');
      return none;
    }
    const hits = zk ? 1 : pickHits(rng, user, mm);
    if (user.lockOn) user.lockOn = null;
    // Lucky Chant on the target's side stops critical hits; Laser Focus makes the next hit one
    const crit = FO.o === 'crit' ? true : FO.o === 'hit' || FO.o === 'miss' ? false : st[tside].luckyChant ? false : user.laserFocus ? true : roll(rng, critChance(user, target, mm));
    user.laserFocus = false;
    // Spectral Thief and Soul Robbery take the target's stat boosts before they hit
    if ((mm.name === 'Spectral Thief' || mm.name === 'Soul Robbery') && !zk) {
      const up = {};
      for (const k of Object.keys(target.boosts)) if (target.boosts[k] > 0) { up[k] = target.boosts[k]; target.boosts[k] = 0; }
      if (Object.keys(up).length) { log(st, `${user.name} steals ${target.name}'s stat boosts`); applyBoosts(st, user, up); }
    }
    if (crit) st.events.push({ turn: st.turn, type: 'outcome', side: user.side, key: user.key, o: 'crit' });
    const fo = fieldOpts(st, tside);
    // the calculator gives Meteor Beam and Electro Shot their +1 Sp. Atk itself; the battle already raised it on the charge turn
    const atkSpec = specNow(user);
    if ((mm.name === 'Meteor Beam' || mm.name === 'Electro Shot') && !zk) atkSpec.boosts = Object.assign({}, atkSpec.boosts, { spa: Math.max(-6, (atkSpec.boosts.spa || 0) - 1) });
    // who moved first this turn: Bolt Beak and Fishious Rend double before the target moves, Analytic boosts after
    if (target.movedThisTurn) atkSpec.movesLast = true; else atkSpec.movesFirst = true;
    const rr = E.rawRolls(atkSpec, specNow(target), moveId, Object.assign({ crit, hits, z: !!zk, bp: ctx.bp || 0 }, fo));
    const rolls = rr.rolls;
    let dmg = rolls[rng.expected ? 7 : Math.floor(rng() * rolls.length)] || 0;
    if (spread < 1) dmg = Math.floor(dmg * spread);
    if (invulnMul > 1) dmg *= invulnMul;
    if (target.minimized && ROM_MINIMIZE.has(moveId)) dmg *= 2;
    if (target.glaiveRush) dmg *= 2;                     // Glaive Rush: hits on its user do double until it moves again
    if (user.helped) dmg = Math.floor(dmg * 1.5);
    if (zk && target.protect) { dmg = Math.floor(dmg / 4); log(st, `${target.name} couldn't fully protect itself`); }
    // special damage (types still apply: Final Gambit can't touch a Ghost, Endeavor can't either)
    if (mm.name === 'Final Gambit') dmg = rr.eff === 0 ? 0 : user.hp;
    if (mm.name === 'Endeavor') dmg = rr.eff === 0 ? 0 : Math.max(0, target.hp - user.hp);
    // Wonder Guard: only super-effective damaging moves land (fixed-damage moves too: they have power 1 in the ROM)
    if (target.ability === 'Wonder Guard' && mm.power > 0 && (rr.eff || 0) <= 1 && mm.name !== 'Struggle' && !(user.ability === 'Mold Breaker' || user.ability === 'Teravolt' || user.ability === 'Turboblaze')) {
      log(st, `It doesn't affect ${target.name} (Wonder Guard)`);
      return none;
    }
    const absorb = ABSORB[target.ability];
    if (absorb && absorb[0] === rr.type && dmg === 0) {
      if (absorb[1] === 'heal') heal(st, target, target.maxHp / 4, target.ability);
      else if (absorb[1] !== 'none' && absorb[1] !== 'def2') applyBoosts(st, target, { [absorb[1]]: 1 });
      else if (absorb[1] === 'def2') applyBoosts(st, target, { def: 2 });
      log(st, `It doesn't affect ${target.name} (${target.ability})`);
      return none;
    }
    if (dmg === 0 && rr.eff === 0) { log(st, `It doesn't affect ${target.name}`); return none; }
    if (target.sub && !mm.sound && user.ability !== 'Infiltrator') {
      target.sub -= dmg;
      log(st, `The substitute takes the hit`);
      if (target.sub <= 0) { target.sub = 0; log(st, `${target.name}'s substitute breaks`); }
      return { dealt: 0, hit: true };
    }
    if (target.disguise) { target.disguise = false; dmg = Math.floor(target.maxHp / 8); log(st, `${target.name}'s disguise is busted`); }
    const fullHp = target.hp === target.maxHp;
    if (fullHp && dmg >= target.hp && hits <= 1 && !FO.ko && (target.ability === 'Sturdy' || itemName(target) === 'Focus Sash')) {
      dmg = target.hp - 1;
      if (itemName(target) === 'Focus Sash') { consume(target); log(st, `${target.name} hangs on with its Focus Sash`); }
      else log(st, `${target.name} endures with Sturdy`);
    }
    if (target.endure && dmg >= target.hp && !FO.ko) { dmg = target.hp - 1; log(st, `${target.name} endures the hit`); }
    // what the player saw: the hit knocked it out, or it held on
    if (FO.ko) dmg = Math.max(dmg, target.hp);
    else if (FO.noKO && dmg >= target.hp) dmg = Math.max(0, target.hp - 1);
    target.hitThisTurn = true;
    if (mm.cat === 'P') target.hitPhysicalThisTurn = true;
    if (/^(Brick Break|Psychic Fangs|Raging Bull)$/.test(mm.name)) {
      const sc = st[tside].screens;
      if (sc.reflect || sc.light || sc.veil) { st[tside].screens = { reflect: 0, light: 0, veil: 0 }; log(st, `${user.name} shatters the screens`); }
    }
    const dealt = Math.min(target.hp, dmg);
    target.hp -= dealt;
    if (target.status === 'frz' && dealt > 0 && target.hp > 0 && (THAW_TARGET.has(moveId) || THAW_USER.has(moveId))) {
      target.status = ''; log(st, `${target.name}'s frostbite was cured!`, 'cure', target);
    }
    if (target.bide) target.bide.dmg += dealt;
    if (dealt > 0 && user.side !== target.side) {
      const h = { dmg: dealt, side: user.side, idx: user.idx, turn: st.turn };
      target.lastHit = h;
      if (mm.cat === 'P') target.lastPhys = h; else if (mm.cat === 'S') target.lastSpec = h;
    }
    if (st.opts.record) log(st, `${target.name} loses ${Math.round(100 * dealt / target.maxHp)}% (${Math.round(100 * target.hp / target.maxHp)}% left)`, 'dmg', target);
    // the game's order: the hit, then "A critical hit!", then how effective it was
    if (crit) log(st, 'A critical hit!', 'crit');
    if (st.opts.record && dealt > 0) {
      if (rr.eff > 1) log(st, "It's super effective!", 'eff');
      else if (rr.eff > 0 && rr.eff < 1) log(st, "It's not very effective…", 'eff');
    }
    if (hits > 1) log(st, `Hit ${hits} times!`);
    // a Gem powers up one move of its type, then it's gone
    if (itemName(user) === rr.type + ' Gem' && !zk) { consume(user); log(st, `The ${rr.type} Gem strengthened ${user.name}'s power`); }
    // item and ability reactions on the target
    const tItem = itemName(target);
    if (tItem === 'Air Balloon') { consume(target); log(st, `${target.name}'s Air Balloon pops`); }
    if (RESIST_BERRY[tItem] === rr.type && (rr.eff > 1 || tItem === 'Chilan Berry')) consume(target);
    if (tItem === 'Weakness Policy' && rr.eff > 1 && target.hp > 0) { consume(target); applyBoosts(st, target, { atk: 2, spa: 2 }); }
    if (target.hp <= 0) {
      if (target.destinyBond) { faint(st, target, `${mm.name}`); log(st, `${user.name} is taken down by Destiny Bond`); faint(st, user, 'Destiny Bond'); return { dealt, hit: true }; }
      faint(st, target, `${user.name}'s ${mm.name}${crit ? ' (critical hit)' : ''}`);
      if (target.fainted) {
        if (['Moxie', 'Chilling Neigh'].includes(user.ability)) applyBoosts(st, user, { atk: 1 });
        if (user.ability === 'Grim Neigh') applyBoosts(st, user, { spa: 1 });
        if (user.ability === 'Beast Boost') { const rs = E.rawStats(user.spec); const k = STATS5.reduce((a, b) => (rs[b] > rs[a] ? b : a), 'atk'); applyBoosts(st, user, { [k]: 1 }); }
      }
    } else {
      berryCheck(st, target);
    }
    // contact punishment
    if (mm.contact && !user.fainted && dealt > 0) {
      if (tItem === 'Rocky Helmet') hurt(st, user, Math.max(1, Math.floor(user.maxHp / 6)), 'Rocky Helmet');
      if (['Rough Skin', 'Iron Barbs'].includes(target.ability)) hurt(st, user, Math.max(1, Math.floor(user.maxHp / 8)), target.ability);
      if (!user.fainted) {
        if (target.ability === 'Static' && roll(rng, 0.3) && canStatus(st, user, 'par', '', target)) inflict(st, user, 'par', rng, 'Static');
        if (target.ability === 'Flame Body' && roll(rng, 0.3) && canStatus(st, user, 'brn', '', target)) inflict(st, user, 'brn', rng, 'Flame Body');
        if (target.ability === 'Poison Point' && roll(rng, 0.3) && canStatus(st, user, 'psn', '', target)) inflict(st, user, 'psn', rng, 'Poison Point');
        if (target.ability === 'Effect Spore' && !hasType(user, 'Grass') && user.ability !== 'Overcoat' && itemName(user) !== 'Safety Goggles' && roll(rng, 0.3)) {
          const s2 = ['psn', 'par', 'slp'][rng.expected ? 0 : Math.floor(rng() * 3)];
          if (canStatus(st, user, s2, '', target)) inflict(st, user, s2, rng, 'Effect Spore');
        }
        if (user.ability === 'Poison Touch' && !target.fainted && roll(rng, 0.3) && canStatus(st, target, 'psn', '', user)) inflict(st, target, 'psn', rng, 'Poison Touch');
        if (['Gooey', 'Tangling Hair'].includes(target.ability)) applyBoosts(st, user, { spe: -1 }, 'foe');
      }
    }
    if (dealt > 0) onHitAbility(st, user, target, moveId, mm, rr.type, dealt, crit, rng);
    // Gulp Missile: a Cramorant that caught prey with Surf or Dive spits it at whoever hits it
    if (dealt > 0 && target.gulp && !user.fainted) {
      const g = target.gulp; target.gulp = null;
      if (user.ability !== 'Magic Guard') hurt(st, user, Math.max(1, Math.floor(user.maxHp / 4)), 'Gulp Missile');
      if (!user.fainted) { if (g === 'arrokuda') applyBoosts(st, user, { def: -1 }, 'foe'); else if (canStatus(st, user, 'par', '', target)) inflict(st, user, 'par', rng, 'Gulp Missile'); }
    }
    if (dealt > 0 && user.ability === 'Magician' && !user.item && target.item && target.ability !== 'Sticky Hold' && !/ Z$|ite$|ium Z$/.test(itemName(target) || '')) {
      user.item = target.item; target.item = null; log(st, `${user.name} stole ${target.name}'s ${itemName(user)} (Magician)`);
    }
    // effects that happen even when the hit knocks the target out
    if (!zk && !user.fainted) {
      if (mm.name === 'Fell Stinger' && target.fainted) applyBoosts(st, user, { atk: 3 });      // +3 Attack when it knocks out
      if (mm.name === 'Stone Axe') { const hz = st[tside].hazards; if (!hz.sr) { hz.sr = 1; log(st, 'Pointed stones float around the target'); } }
      if (mm.name === 'Ceaseless Edge') { const hz = st[tside].hazards; if (hz.spikes < 3) { hz.spikes++; log(st, 'Spikes are scattered around the target'); } }
      if (/^(Steel Roller|Ice Spinner)$/.test(mm.name) && st.terrain) { st.terrain = null; st.terrainTurns = 0; log(st, 'The terrain disappeared'); }
      if (mm.name === 'Freezy Frost') { for (const s2 of ['p', 'a']) for (const x of actives(st, s2)) x.boosts = { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 }; log(st, 'All stat changes were eliminated'); }
      if (mm.name === 'Glaive Rush') user.glaiveRush = true;
    }
    if (user.fainted || target.fainted || zk) return { dealt, hit: true };
    // knock off
    if (mm.eff === 188 && target.item && target.ability !== 'Sticky Hold') { log(st, `${target.name}'s ${tItem} is knocked off`); consume(target); }
    // item moves: Thief and Covet take it (if the user has none), Bug Bite and Pluck eat a berry, Incinerate burns a berry or a Gem
    if (mm.eff === 105 && target.item && !user.item && target.ability !== 'Sticky Hold' && !/ Z$|ite$|ium Z$/.test(tItem || '')) {
      user.item = target.item; target.item = null; if (target.ability === 'Unburden') target.unburden = true; log(st, `${user.name} stole ${target.name}'s ${tItem}`);
    }
    if ((mm.name === 'Bug Bite' || mm.name === 'Pluck') && BERRY.test(itemName(target) || '') && target.ability !== 'Sticky Hold') {
      const it = itemName(target); target.item = null; eatBerry(st, user, it);
    }
    if (mm.name === 'Incinerate' && (BERRY.test(itemName(target) || '') || / Gem$/.test(itemName(target) || ''))) { log(st, `${target.name}'s ${itemName(target)} was burnt up`); target.item = null; }
    // cures that come with the hit
    if (mm.name === 'Smelling Salts' && target.status === 'par') { target.status = ''; log(st, `${target.name} was cured of paralysis`); }
    if (mm.name === 'Wake-Up Slap' && target.status === 'slp') { target.status = ''; target.sleep = 0; log(st, `${target.name} woke up`); }
    if (mm.name === 'Sparkling Aria' && target.status === 'brn') { target.status = ''; log(st, `${target.name}'s burn was healed`); }
    // Clear Smog: the target's stat changes go back to zero; Smack Down and Thousand Arrows bring it to the ground
    if (mm.name === 'Clear Smog') { target.boosts = { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 }; log(st, `${target.name}'s stat changes were removed`); }
    if (/^(Smack Down|Thousand Arrows)$/.test(mm.name) && !target.grounded && (hasType(target, 'Flying') || target.ability === 'Levitate' || target.magnetRise)) { target.grounded = true; target.magnetRise = 0; log(st, `${target.name} fell straight down`); }
    // Sappy Seed seeds it (not a Grass type); Salt Cure keeps hurting it every turn; Throat Chop and Psychic Noise
    if (mm.name === 'Sappy Seed' && !hasType(target, 'Grass') && !target.seeded) { target.seeded = true; target.seededBy = { side: user.side, slot: user.slot }; log(st, `${target.name} is seeded`); }
    if (mm.name === 'Salt Cure' && !target.saltCure) { target.saltCure = true; log(st, `${target.name} is being salt cured`); }
    if (mm.name === 'Throat Chop') target.throatChop = 2;
    if (mm.name === 'Psychic Noise' && target.ability !== 'Aroma Veil') target.healBlock = 2;
    // secondary effects
    const sheer = user.ability === 'Sheer Force';
    const shielded = NO_SECONDARY.has(target.ability) || itemName(target) === 'Covert Cloak';
    const chanceOf = p => Math.min(1, (user.ability === 'Serene Grace' ? 2 : 1) * p / 100);
    if (!sheer && !shielded) {
      const ec = mm.ec || 0;
      const statusByEff = { 2: 'psn', 4: 'brn', 5: 'frz', 6: 'par', 209: 'tox' };
      const hailFrost = statusByEff[mm.eff] === 'frz' && /Hail|Snow/.test(st.weather || '') ? 2 : 1;   // hail doubles frostbite's chance
      if (statusByEff[mm.eff] && roll(rng, chanceOf(ec * hailFrost)) && canStatus(st, target, statusByEff[mm.eff], mm.name, user)) inflict(st, target, statusByEff[mm.eff], rng, mm.name, user);
      if (user.ability === 'Toxic Chain' && roll(rng, 0.3) && canStatus(st, target, 'tox', mm.name, user)) inflict(st, target, 'tox', rng, 'Toxic Chain', user);
      if (mm.eff === 152 && mm.name === 'Thunder' && roll(rng, chanceOf(ec)) && canStatus(st, target, 'par', mm.name, user)) inflict(st, target, 'par', rng, mm.name);
      if (mm.eff === 152 && mm.name === 'Hurricane' && roll(rng, chanceOf(ec))) confuse(st, target, rng, mm.name);   // its script jumps to the confusion hit
      if (mm.eff === 224 && roll(rng, chanceOf(ec)) && canStatus(st, target, 'slp', mm.name, user)) inflict(st, target, 'slp', rng, mm.name);   // Dark Hole: may sleep
      if (mm.eff === 36 && roll(rng, chanceOf(mm.name === 'Dire Claw' ? (ec || 50) : 20))) {
        const pool = mm.name === 'Dire Claw' ? ['psn', 'par', 'slp'] : ['brn', 'par', 'frz'];
        const s = pool[rng.expected ? 0 : Math.floor(rng() * 3)]; if (canStatus(st, target, s, mm.name, user)) inflict(st, target, s, rng, mm.name);
      }
      if (mm.eff === 135 && roll(rng, chanceOf(ec || 100))) applyBoosts(st, user, { def: 2 });   // Diamond Storm
      if (mm.name === 'Mortal Spin' && canStatus(st, target, 'psn', mm.name, user)) inflict(st, target, 'psn', rng, mm.name);
      if (FANG[mm.name] && roll(rng, chanceOf(10)) && canStatus(st, target, FANG[mm.name], mm.name, user)) inflict(st, target, FANG[mm.name], rng, mm.name);
      // Fake Out always flinches; First Impression shares its effect (first turn only) but skips the flinch (BS_158_FakeOut)
      const flinchP = mm.eff === 31 ? ec : (mm.eff === FAKE_OUT && mm.name === 'Fake Out' ? 100 : 0) + (['King\'s Rock', 'Razor Fang'].includes(itemName(user)) && mm.eff !== 31 ? 10 : 0);
      if (flinchP && !target.movedThisTurn && target.ability !== 'Inner Focus' && roll(rng, chanceOf(flinchP))) { target.flinch = true; }
      if (mm.eff === 76 && roll(rng, chanceOf(ec || 100))) confuse(st, target, rng, mm.name);
      if (HIT_DROP[mm.eff] && roll(rng, chanceOf(ec || 100))) applyBoosts(st, target, { [HIT_DROP[mm.eff]]: mm.name === 'Acid Spray' || mm.name === 'Lumina Crash' ? -2 : -1 }, 'foe');
    }
    // binding moves hold the target for 4-5 turns (7 with Grip Claw), hurting it each turn; trapping moves keep it in
    if (mm.eff === BIND && mm.name !== 'Salt Cure' && !target.bound && !target.fainted) {
      target.bound = { side: user.side, idx: user.idx, name: mm.name, frac: itemName(user) === 'Binding Band' ? 6 : 8,
        left: itemName(user) === 'Grip Claw' ? 7 : (rng.expected ? 4 : 4 + Math.floor(rng() * 2)) };
      log(st, `${target.name} is caught in ${mm.name}`);
    }
    if (mm.eff === MEAN_LOOK && !target.fainted && !target.trappedBy && !hasType(target, 'Ghost')) {
      target.trappedBy = { side: user.side, idx: user.idx };
      if (mm.name === 'Jaw Lock' && !user.trappedBy && !hasType(user, 'Ghost')) user.trappedBy = { side: target.side, idx: target.idx };
      log(st, `${target.name} can't escape now`);
    }
    // forced switch on the target (Dragon Tail, Circle Throw)
    if (mm.eff === 28 && bench(st, tside).length && target.ability !== 'Suction Cups') {
      switchIn(st, tside, forcedPick(st, tside, target.slot, rng), rng, 'forced out', target.slot);
    }
    return { dealt, hit: true };
  }

  function statusMove(st, user, target, mm, rng, bounced) {
    const n = mm.name, e = mm.eff;
    const foeTargeted = (!(e in EFFECT_BOOST) && !SETUP[n] && ![HEAL_HALF, HEAL_WEATHER, 37, PROTECT_EFF, HAZARD, 35, 65, 136, 137, 115, 164, 228, 239, 98, 97, 153, 124, 79, 142, 109, 176, 180, 235, 177, FOCUS_ENERGY, BIDE, WISH, PERISH,
      174, 181, 226, 162, 102, 184, 46, 129].includes(e) && !(e === 193 && n === 'Refresh') && n !== 'Laser Focus'
      && n !== 'Healing Wish' && n !== 'Lunar Dance') || n === 'Strength Sap' || n === 'Parting Shot' || n === 'Leech Seed';
    if (foeTargeted && target && target.protect) { log(st, `${target.name} protects itself`); return; }
    const mold = ['Mold Breaker', 'Teravolt', 'Turboblaze'].includes(user.ability);
    if (foeTargeted && target && target !== user && target.ability === 'Good as Gold' && !mold) { log(st, `It doesn't affect ${target.name} (Good as Gold)`); return; }
    if (foeTargeted && target && target !== user && target.ability === 'Magic Bounce' && !mold && !bounced && !target.fainted) {
      log(st, `${target.name} bounced the ${n} back`); return statusMove(st, target, user, mm, rng, true);
    }
    const FO = user.forced || {};
    if (foeTargeted && target && !target.fainted && FO.o !== 'hit' && (FO.o === 'miss' || !roll(rng, hitChance(st, user, target, mm)))) {
      log(st, `${user.name}'s ${n} misses`, 'miss', user);
      st.events.push({ turn: st.turn, type: 'outcome', side: user.side, key: user.key, o: 'miss' });
      return;
    }
    if (foeTargeted && target && user.ability === 'Prankster' && hasType(target, 'Dark')) { log(st, 'It does not affect Dark types'); return; }
    if (n === 'Stockpile') { if ((user.stockpile || 0) >= 3) { log(st, 'But it failed'); return; } user.stockpile = (user.stockpile || 0) + 1; }
    if (n === 'Defense Curl') user.curled = true;   // Rollout and Ice Ball hit twice as hard after it
    if (SETUP[n] || EFFECT_BOOST[e]) {
      let b = SETUP[n] || EFFECT_BOOST[e];
      if (n === 'Growth' && /Sun/.test(st.weather || '')) b = { atk: 2, spa: 2 };
      if (n === 'Fillet Away' || n === 'Clangorous Soul') { const c = n === 'Fillet Away' ? 2 : 3; if (user.hp <= user.maxHp / c) { log(st, 'But it failed'); return; } hurt(st, user, Math.floor(user.maxHp / c), n); }
      applyBoosts(st, user, b);
      if (n === 'Shell Smash' && itemName(user) === 'White Herb') { user.boosts.def = Math.max(0, user.boosts.def); user.boosts.spd = Math.max(0, user.boosts.spd); consume(user); }
      return;
    }
    // ---- moves this simulator runs by name (their effect scripts single them out, or the effect is theirs alone) ----
    const tgtOk = target && !target.fainted;
    const noItemMove = it => !it || /ite$| Z$|ium Z$/.test(itemName({ item: it }) || '');   // Mega Stones and Z-Crystals stay put
    switch (n) {
      case 'Endure': {
        const p = Math.pow(1 / 3, user.protectStreak);
        if (roll(rng, p)) { user.endure = true; user.protectStreak++; log(st, `${user.name} braced itself`); } else { user.protectStreak = 0; log(st, 'But it failed'); }
        return;
      }
      case 'Gravity': if (st.gravity) { log(st, 'But it failed'); return; }
        st.gravity = 5; for (const s2 of ['p', 'a']) for (const x of actives(st, s2)) { x.gravityGrounded = true; if (x.invulnKind === 'air') { x.charging = null; x.invuln = false; x.invulnKind = null; } x.magnetRise = 0; }
        log(st, 'Gravity intensified'); return;
      case 'Magic Room': st.magicRoom = st.magicRoom ? 0 : 5; log(st, st.magicRoom ? 'It created a bizarre area in which held items lose their effects' : 'Magic Room wore off'); return;
      case 'Wonder Room': st.wonderRoom = st.wonderRoom ? 0 : 5; log(st, st.wonderRoom ? 'It created a bizarre area in which Defense and Sp. Def are swapped' : 'Wonder Room wore off'); return;
      case 'Lucky Chant': if (st[user.side].luckyChant) { log(st, 'But it failed'); return; } st[user.side].luckyChant = 5; log(st, 'The Lucky Chant shields your team from critical hits'); return;
      case 'Magnet Rise': if (user.magnetRise || user.grounded || user.ingrain || st.gravity) { log(st, 'But it failed'); return; } user.magnetRise = 5; log(st, `${user.name} levitated with electromagnetism`); return;
      case 'Mist': if (st[user.side].mist) { log(st, 'But it failed'); return; } st[user.side].mist = 5; log(st, 'Your team became shrouded in mist'); return;
      case 'Charge': user.charged = 2; applyBoosts(st, user, { spd: 1 }); log(st, `${user.name} began charging power`); return;
      case 'Ingrain': if (user.ingrain) { log(st, 'But it failed'); return; } user.ingrain = true; log(st, `${user.name} planted its roots`); return;
      case 'Aqua Ring': if (user.aquaRing) { log(st, 'But it failed'); return; } user.aquaRing = true; log(st, `${user.name} surrounded itself with a veil of water`); return;
      case 'Laser Focus': user.laserFocus = true; log(st, `${user.name} concentrated intensely`); return;
      case 'Lock-On': case 'Mind Reader': if (tgtOk) { user.lockOn = target.key; log(st, `${user.name} took aim at ${target.name}`); } return;
      case 'Minimize': user.minimized = true; break;   // (the evasion comes from its boost below)
      case 'Recycle': if (user.item || !user.lastItem) { log(st, 'But it failed'); return; } user.item = user.lastItem; user.lastItem = null; log(st, `${user.name} found its ${itemName(user)}`); return;
      case 'Refresh': if (!/psn|tox|par|brn|frz/.test(user.status || '')) { log(st, 'But it failed'); return; }   // frostbite too (CFRU's FROSTBITE) user.status = ''; log(st, `${user.name}'s status returned to normal`); return;
      case 'Heal Bell': case 'Aromatherapy': for (const x of st[user.side].team) if (!x.fainted && x.status) { x.status = ''; x.sleep = 0; } log(st, 'Your team was cured of status problems'); return;
      case 'Life Dew': case 'Jungle Healing': case 'Lunar Blessing':
        for (const x of actives(st, user.side)) { heal(st, x, x.maxHp / 4, n); if (n !== 'Life Dew' && x.status) { x.status = ''; x.sleep = 0; } }
        return;
      case 'Purify':
        if (!tgtOk || !target.status) { log(st, 'But it failed'); return; }
        target.status = ''; target.sleep = 0; heal(st, user, user.maxHp / 2, n); return;
      case 'Swallow': {
        const k = user.stockpile || 0;
        if (!k) { log(st, 'But it failed'); return; }
        heal(st, user, user.maxHp * [0, 0.25, 0.5, 1][k], n);
        applyBoosts(st, user, { def: -k, spd: -k }); user.stockpile = 0; return;
      }
      case 'Pain Split': {
        if (!tgtOk) return;
        const avg = Math.floor((user.hp + target.hp) / 2);
        user.hp = Math.min(user.maxHp, avg); target.hp = Math.min(target.maxHp, avg);
        log(st, 'The battlers shared their pain'); return;
      }
      case 'Psych Up': if (tgtOk) { user.boosts = Object.assign({}, target.boosts); log(st, `${user.name} copied ${target.name}'s stat changes`); } return;
      case 'Topsy-Turvy': if (tgtOk) { for (const k of Object.keys(target.boosts)) target.boosts[k] = -target.boosts[k]; log(st, `${target.name}'s stat changes were reversed`); } return;
      case 'Tickle': if (tgtOk) applyBoosts(st, target, { atk: -1, def: -1 }, 'foe'); return;
      case 'Heal Block': if (tgtOk && !target.healBlock) { target.healBlock = 5; log(st, `${target.name} was prevented from healing`); } return;
      case 'Nightmare': if (tgtOk && target.status === 'slp' && !target.nightmare) { target.nightmare = true; log(st, `${target.name} began having a nightmare`); } else log(st, 'But it failed'); return;
      case 'Psycho Shift':
        if (!user.status || !tgtOk || target.status || !canStatus(st, target, user.status, n, user)) { log(st, 'But it failed'); return; }
        inflict(st, target, user.status, rng, n); user.status = ''; user.sleep = 0; return;
      case 'Soak': case 'Magic Powder':
        if (!tgtOk) return;
        target.types = [n === 'Soak' ? 'Water' : 'Psychic']; target.typesChanged = true; log(st, `${target.name} turned into the ${target.types[0]} type`); return;
      case "Forest's Curse": case 'Trick-or-Treat': {
        if (!tgtOk) return;
        const t = n === 'Trick-or-Treat' ? 'Ghost' : 'Grass';
        if (!target.types.includes(t)) { target.types = target.types.slice(0, 2).concat(t); target.typesChanged = true; log(st, `${t} type was added to ${target.name}`); }
        return;
      }
      case 'Reflect Type': if (tgtOk) { user.types = target.types.slice(); user.typesChanged = true; log(st, `${user.name} became the same type as ${target.name}`); } return;
      case 'Role Play': case 'Skill Swap': case 'Worry Seed': case 'Gastro Acid': case 'Entrainment': case 'Simple Beam': {
        if (!tgtOk || NO_ABILITY_CHANGE.has(target.ability) || (n !== 'Worry Seed' && n !== 'Gastro Acid' && n !== 'Simple Beam' && NO_ABILITY_CHANGE.has(user.ability))) { log(st, 'But it failed'); return; }
        const keep = m => { if (m.abilityOrig == null) m.abilityOrig = m.ability; };
        if (n === 'Role Play') { keep(user); user.ability = target.ability; }
        else if (n === 'Skill Swap') { keep(user); keep(target); const a = user.ability; user.ability = target.ability; target.ability = a; }
        else if (n === 'Worry Seed') { keep(target); target.ability = 'Insomnia'; if (target.status === 'slp') { target.status = ''; target.sleep = 0; } }
        else if (n === 'Gastro Acid') { keep(target); target.ability = ''; }
        else if (n === 'Entrainment') { keep(target); target.ability = user.ability; }
        else { keep(target); target.ability = 'Simple'; }
        log(st, `${n}: abilities changed`); return;
      }
      case 'Trick': case 'Switcheroo': case 'Bestow': {
        if (!tgtOk || target.ability === 'Sticky Hold') { log(st, 'But it failed'); return; }
        if (n === 'Bestow') { if (!user.item || target.item || noItemMove(user.item)) { log(st, 'But it failed'); return; } target.item = user.item; user.item = null; log(st, `${target.name} received ${itemName(target)}`); return; }
        if ((!user.item && !target.item) || (user.item && noItemMove(user.item)) || (target.item && noItemMove(target.item))) { log(st, 'But it failed'); return; }
        const a = user.item; user.item = target.item; target.item = a;
        user.choiceMove = null; target.choiceMove = null; if (!user.rampage) user.lock = null; if (!target.rampage) target.lock = null;   // a new Choice item locks from the next move
        log(st, `${user.name} switched items with ${target.name}`); return;
      }
      case 'Transform': {
        if (!tgtOk || user.orig || target.orig || target.sub) { log(st, 'But it failed'); return; }
        transform(st, user, target); return;
      }
      case 'Defog': {
        if (tgtOk) applyBoosts(st, target, { eva: -1 }, 'foe');
        for (const s2 of ['p', 'a']) st[s2].hazards = { sr: 0, spikes: 0, tspikes: 0, web: 0 };
        st[other(user.side)].screens = { reflect: 0, light: 0, veil: 0 }; st[other(user.side)].safeguard = 0; st[other(user.side)].mist = 0;
        if (st.terrain) { st.terrain = null; st.terrainTurns = 0; }
        log(st, 'Defog blows away the hazards and screens'); return;
      }
      case 'Court Change': {
        const a = st.p, b = st.a;
        for (const k of ['hazards', 'screens', 'tailwind', 'safeguard', 'mist', 'luckyChant']) { const t = a[k]; a[k] = b[k]; b[k] = t; }
        log(st, 'The effects on each side of the field were swapped'); return;
      }
      case 'Electric Terrain': case 'Grassy Terrain': case 'Misty Terrain': case 'Psychic Terrain': {
        const t = n.split(' ')[0];
        if (st.terrain === t) { log(st, 'But it failed'); return; }
        setTerrain(st, t, user); log(st, `The battlefield became ${t} Terrain`); return;
      }
      case 'Aurora Veil': if (!/Hail|Snow/.test(st.weather || '')) { log(st, 'But it failed'); return; } break;
      default: break;
    }
    switch (e) {
      case 142: if (n === 'Belly Drum') { if (user.hp <= user.maxHp / 2) { log(st, 'But it failed'); return; } hurt(st, user, Math.floor(user.maxHp / 2), n); user.boosts.atk = 6; log(st, `${user.name} maxes its Attack`); } else { hurt(st, user, Math.floor(user.maxHp / 2), n); applyBoosts(st, user, SETUP[n] || { atk: 2, spa: 2, spe: 2 }); } return;
      case 109: if (hasType(user, 'Ghost')) { hurt(st, user, Math.max(1, Math.floor(user.maxHp / 2)), 'Curse'); } else applyBoosts(st, user, { atk: 1, def: 1, spe: -1 }); return;
      case HEAL_HALF: heal(st, user, user.maxHp / 2, n); return;
      case HEAL_WEATHER: { const w = wx(st) || ''; heal(st, user, user.maxHp * (/Sun/.test(w) ? 2 / 3 : w ? 1 / 4 : 1 / 2), n); return; }
      case 37: if (user.hp === user.maxHp) { log(st, 'But it failed'); return; } user.hp = user.maxHp; user.status = 'slp'; user.sleep = 2; log(st, `${user.name} sleeps and restores its HP`); return;
      case PROTECT_EFF: {
        if (n === 'Mat Block' && !user.firstTurn) { log(st, 'But it failed'); return; }
        if (n === 'Wide Guard' || n === 'Quick Guard') {
          st[user.side][n === 'Wide Guard' ? 'wideGuard' : 'quickGuard'] = true; log(st, `${n} protects ${user.side === 'p' ? 'your' : 'their'} side`); return;
        }
        const p = Math.pow(1 / 3, user.protectStreak);
        if (roll(rng, p)) { user.protect = true; user.protectKind = n; user.protectStreak++; log(st, `${user.name} protects itself`); }
        else { user.protectStreak = 0; log(st, 'But it failed'); }
        return;
      }
      case HAZARD: {
        // Magic Bounce sends hazards back to the side that laid them
        const bouncer = !bounced && actives(st, other(user.side)).find(x => x.ability === 'Magic Bounce');
        if (bouncer) log(st, `${bouncer.name} bounced the ${n} back`);
        const hz = st[bouncer ? user.side : other(user.side)].hazards;
        if ((n === 'Stealth Rock' && hz.sr) || (n === 'Spikes' && hz.spikes >= 3) || (n === 'Toxic Spikes' && hz.tspikes >= 2) || (n === 'Sticky Web' && hz.web)) { log(st, 'But it failed'); return; }
        if (n === 'Stealth Rock') hz.sr = 1; else if (n === 'Spikes') hz.spikes = Math.min(3, hz.spikes + 1);
        else if (n === 'Toxic Spikes') hz.tspikes = Math.min(2, hz.tspikes + 1); else if (n === 'Sticky Web') hz.web = 1;
        log(st, `${n} is laid on ${user.side === 'a' ? 'your' : 'their'} side`); return;
      }
      case 35: st[user.side].screens.light = itemName(user) === 'Light Clay' ? 8 : 5; log(st, 'Light Screen goes up'); return;
      case 65: if (n === 'Aurora Veil') st[user.side].screens.veil = itemName(user) === 'Light Clay' ? 8 : 5; else st[user.side].screens.reflect = itemName(user) === 'Light Clay' ? 8 : 5; log(st, `${n} goes up`); return;
      case 136: setWeather(st, 'Rain', user); return;
      case 137: setWeather(st, 'Sun', user); return;
      case 115: setWeather(st, 'Sand', user); return;
      case 164: setWeather(st, 'Snow', user); return;
      case 228: if (n !== 'Trick Room') { log(st, `${n} has no effect here`); return; }
        st.trickRoom = st.trickRoom ? 0 : 5; log(st, st.trickRoom ? 'The dimensions are twisted (Trick Room)' : 'Trick Room ends'); return;
      case 239: if (n !== 'Tailwind') return;
        if (st[user.side].tailwind) { log(st, 'But it failed'); return; }
        st[user.side].tailwind = 4; log(st, 'A tailwind blows'); return;
      case 98: user.destinyBond = true; log(st, `${user.name} is trying to take its foe down with it`); return;
      case 124: st[user.side].safeguard = 5; return;
      case 79: if (user.hp > user.maxHp / 4 && !user.sub) { hurt(st, user, Math.floor(user.maxHp / 4), 'Substitute'); user.sub = Math.floor(user.maxHp / 4); } return;
      case 25: for (const s of ['p', 'a']) for (const x of actives(st, s)) x.boosts = { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 }; return;
      case 172: if (st.size > 1) { user.redirect = n; log(st, `${user.name} becomes the center of attention`); } return;
      case 176: { const ally = actives(st, user.side).find(m => m !== user); if (ally) { ally.helped = true; log(st, `${user.name} is ready to help ${ally.name}`); } return; }
      case TELEPORT:
        if (n === 'Chilly Reception') setWeather(st, 'Snow', user);   // snow first, then out
        if (bench(st, user.side).length) pivot(st, user.side, rng, user.slot);
        return;
      case PIVOT:
        if (n === 'Parting Shot' && target && !target.fainted) applyBoosts(st, target, { atk: -1, spa: -1 }, 'foe');
        if (n === 'Shed Tail') { if (user.hp <= user.maxHp / 2 || !bench(st, user.side).length) { log(st, 'But it failed'); return; } hurt(st, user, Math.ceil(user.maxHp / 2), 'Shed Tail'); }
        if (bench(st, user.side).length) pivot(st, user.side, rng, user.slot, n);
        return;
      case WISH: {
        const w = st[user.side].wish || {};
        if (w[user.slot]) { log(st, 'But it failed'); return; }
        st[user.side].wish = Object.assign({}, w, { [user.slot]: { left: 2, hp: Math.max(1, Math.floor(user.maxHp / 2)), name: user.name } });
        log(st, `${user.name} made a wish`, 'wish', user); return;
      }
      case PERISH: {
        let heard = 0;
        for (const s2 of ['p', 'a']) for (const x of actives(st, s2)) if (x.perish == null && x.ability !== 'Soundproof') { x.perish = 3; heard++; }
        if (!heard) { log(st, 'But it failed'); return; }
        log(st, 'All Pokémon that heard the song will faint in three turns', 'perish', user); return;
      }
      case MEMENTO:
        if (n === 'Healing Wish' || n === 'Lunar Dance') {
          if (!bench(st, user.side).length) { log(st, 'But it failed'); return; }
          st[user.side].healWish = Object.assign({}, st[user.side].healWish, { [user.slot]: n });
          faint(st, user, n); return;
        }
        if (n === 'Memento') { if (target && !target.fainted) applyBoosts(st, target, { atk: -2, spa: -2 }, 'foe'); faint(st, user, n); return; }
        break;
      case 175: if (target && !target.fainted) { if (target.taunt || target.ability === 'Oblivious' || itemName(target) === 'Mental Herb') log(st, 'But it failed'); else { target.taunt = 3; log(st, `${target.name} fell for the taunt`); } } return;
      case 90: if (target && !target.fainted) { if (!target.lastMove || target.encore || !target.moves.includes(target.lastMove)) log(st, 'But it failed'); else { target.encore = 3; target.encoreMove = target.lastMove; target.lock = null; log(st, `${target.name} must repeat ${meta(target.lastMove).name}`); } } return;
      case 49: if (target && !target.fainted) confuse(st, target, rng, n); return;
      case FOCUS_ENERGY: if (user.focus) log(st, 'But it failed'); else { user.focus = true; log(st, `${user.name} is getting pumped`); } return;
      case MEAN_LOOK:
        if (!target || target.fainted || target.trappedBy || hasType(target, 'Ghost')) { log(st, 'But it failed'); return; }
        target.trappedBy = { side: user.side, idx: user.idx }; if (n === 'Octolock') target.octolock = true;
        log(st, `${target.name} can't escape now`); return;
      case DISABLE:
        if (!target || target.fainted || target.disabled || !target.lastMove || itemName(target) === 'Mental Herb') { log(st, 'But it failed'); return; }
        target.disabled = target.lastMove; target.disableTurns = 4;
        if (target.lock === target.lastMove && !target.rampage) target.lock = null;
        log(st, `${target.name}'s ${meta(target.lastMove).name} was disabled`); return;
      case TORMENT:
        if (!target || target.fainted || target.torment || itemName(target) === 'Mental Herb') { log(st, 'But it failed'); return; }
        target.torment = true; log(st, `${target.name} was subjected to torment`); return;
      case 118: if (target && !target.fainted) { applyBoosts(st, target, { atk: 2 }, 'foe'); confuse(st, target, rng, n); } return;
      case 166: if (target && !target.fainted) { applyBoosts(st, target, { spa: 1 }, 'foe'); confuse(st, target, rng, n); } return;
      case 28: if (target && !target.fainted && bench(st, target.side).length && target.ability !== 'Suction Cups') switchIn(st, target.side, forcedPick(st, target.side, target.slot, rng), rng, 'forced out', target.slot); return;
      default: break;
    }
    if (!target || target.fainted) return;
    if (n === 'Strength Sap') { const atk = Math.floor(E.rawStats(target.spec).atk * STAGE(target.boosts.atk)); heal(st, user, atk, n); applyBoosts(st, target, { atk: -1 }, 'foe'); return; }
    if (e === 84 || n === 'Leech Seed') { if (!hasType(target, 'Grass') && !target.seeded) { target.seeded = true; target.seededBy = { side: user.side, slot: user.slot }; log(st, `${target.name} is seeded`); } return; }
    if (e === 187) { if (!target.status && !target.yawn && canStatus(st, target, 'slp', n, user)) { target.yawn = 2; log(st, `${target.name} grows drowsy`); } return; }
    const statusMoves = { 1: 'slp', 33: 'tox', 66: 'psn', 67: 'par', 167: 'brn' };
    if (statusMoves[e]) {
      if (canStatus(st, target, statusMoves[e], n, user)) inflict(st, target, statusMoves[e], rng, n, user);
      else log(st, 'But it failed');
      return;
    }
    if (EFFECT_DROP[e]) { applyBoosts(st, target, EFFECT_DROP[e], 'foe'); return; }
    // anything else (Celebrate, Helping Hand, Assist, Trick, ...) has no effect we model
  }

  /** Transform (and Imposter): the target's species, stats, moves, types, ability and stat changes, its own HP. */
  function transform(st, user, target) {
    user.orig = { spec: user.spec, moves: user.moves, types: user.types, ability: user.ability, typesChanged: !!user.typesChanged };
    user.spec = Object.assign({}, target.spec, { key: user.spec.key, label: user.spec.label });
    user.moves = target.moves.slice();
    user.types = target.types.slice(); user.typesChanged = false;
    user.ability = target.ability;
    user.boosts = Object.assign({}, target.boosts);
    user.choiceMove = null;
    log(st, `${user.name} transformed into ${target.name}`);
  }
  function confuse(st, target, rng, why) {
    if (target.confused || target.fainted || target.ability === 'Own Tempo' || (st.terrain === 'Misty' && grounded(target)) || target.sub) return;
    target.confused = rng.expected ? 3 : 2 + Math.floor(rng() * 4);
    log(st, `${target.name} becomes confused (${why})`);
    const it = itemName(target);
    if (it === 'Persim Berry' || it === 'Lum Berry') { consume(target); target.confused = 0; log(st, `${target.name}'s ${it} cures its confusion`); }
  }
  /** HP a Pokemon loses to entry hazards when it switches in on `side`. */
  function hazardDamage(st, side, m) {
    const hz = st[side].hazards;
    if (itemName(m) === 'Heavy-Duty Boots' || m.ability === 'Magic Guard') return 0;
    let d = 0;
    if (hz.sr && E.typeEff('Rock', m.types) > 0) d += Math.max(1, Math.floor(m.maxHp * 0.125 * E.typeEff('Rock', m.types)));
    if (hz.spikes && grounded(m)) d += Math.max(1, Math.floor(m.maxHp * [0, 1 / 8, 1 / 6, 1 / 4][hz.spikes]));
    return d;
  }
  const Z_TYPES = { Normalium: 'Normal', Firium: 'Fire', Waterium: 'Water', Electrium: 'Electric', Grassium: 'Grass', Icium: 'Ice',
    Fightinium: 'Fighting', Poisonium: 'Poison', Groundium: 'Ground', Flyinium: 'Flying', Psychium: 'Psychic', Buginium: 'Bug', Rockium: 'Rock',
    Ghostium: 'Ghost', Dragonium: 'Dragon', Darkinium: 'Dark', Steelium: 'Steel', Fairium: 'Fairy' };
  /** The Z-Move a battler could use with this move right now: 'type' (a typed Z-crystal), 'evoboost' (Eevium Z with Last Resort) or null. */
  function zKind(st, m, moveId) {
    if (st[m.side].zUsed) return null;
    const it = itemName(m) || '';
    const mm = meta(moveId);
    if (it === 'Eevium Z' && mm.name === 'Last Resort' && /^Eevee/.test(E.sp(m.spec.s).n)) return 'evoboost';
    const t = Z_TYPES[(it.match(/^(\w+) Z$/) || [])[1]];
    return t && mm.cat !== 'X' && mm.type === t && (E.mv(moveId) || {}).z ? 'type' : null;
  }
  /** Mega Evolution: the battler's stone matches one of its Mega forms (from the ROM's evolution table). */
  function megaTarget(m) {
    const list = (D.mega || {})[m.spec.s];
    if (!list) return null;
    const mv = m.moves || m.spec.mv || [];
    const hit = list.find(([item, to, need]) => (item && m.item && item === m.item)
      || (!item && need && mv.includes(need) && meta(need).name === 'Dragon Ascent' && !/ium Z$/.test(itemName(m) || ''))   // Rayquaza
      || (!item && need && need === m.item && /ium Z$/.test(itemName(m) || '')));                                               // Ultra Burst
    return hit ? hit[1] : null;
  }
  function megaEvolve(st, side, m) {
    m = m || act(st, side);
    const to = megaTarget(m);
    const ultra = /ium Z$/.test(itemName(m) || '');
    if (!to || (st[side].megaUsed && !ultra) || (ultra && m.ultra)) return;
    const s = E.sp(to);
    if (!s) return;
    if (ultra) m.ultra = true; else st[side].megaUsed = true;
    let ab = (s.a || []).find(Boolean) || m.ability;
    if (m.side === 'p') ab = E.hardcoreAbility(ab, to);   // Hardcore changes some of your abilities, Mega forms included
    m.spec = Object.assign({}, m.spec, { s: to, ab });
    m.types = s.t.slice(); m.ability = ab;
    log(st, `${m.name} Mega Evolves into ${s.n}!`, 'mega', m);
    m.name = s.n;
    st.events.push({ turn: st.turn, type: 'mega', side, key: m.key, to });
    abilityOnEntry(st, side, m);
  }
  /** A move that switches the user out. Baton Pass hands its stat changes, Substitute, confusion, Focus Energy, Leech Seed
   *  and perish count to the Pokemon coming in; Shed Tail hands over a Substitute (a quarter of its max HP). */
  function pivot(st, side, rng, slot, how) {
    const pol = st.policies[side];
    const out = act(st, side, slot || 0);
    const idx = pol.replace(st, side, rng, 'pivot', slot || 0);
    if (idx == null || st[side].slots.includes(idx)) return;
    if (out && how === 'Baton Pass') st.passOn = { side, baton: { boosts: Object.assign({}, out.boosts), sub: out.sub || 0, confused: out.confused || 0, focus: !!out.focus, seeded: !!out.seeded, seededBy: out.seededBy || null, perish: out.perish != null ? out.perish : null,
      ingrain: !!out.ingrain, aquaRing: !!out.aquaRing, magnetRise: out.magnetRise || 0, healBlock: out.healBlock || 0, lockOn: out.lockOn || null } };
    if (out && how === 'Shed Tail') st.passOn = { side, sub: Math.floor(out.maxHp / 4) };
    switchIn(st, side, idx, rng, 'pivot', slot || 0);
    st.passOn = null;
  }
  const NO_ABILITY_CHANGE = new Set(['Mummy', 'Lingering Aroma', 'Battle Bond', 'Comatose', 'Disguise', 'Multitype', 'Power Construct', 'RKS System', 'Schooling', 'Shields Down', 'Stance Change', 'Ice Face', 'Zen Mode']);
  /** The target's ability answering a hit that did damage (the engine's ABILITYEFFECT_MOVE_END list; Sand Spit and the
   *  Paldea abilities as their games have them). Contact punishment (Rough Skin, Static, ...) is handled before this. */
  function onHitAbility(st, user, target, moveId, mm, type, dealt, crit, rng) {
    const a = target.ability;
    if (!a || user === target) return;
    const up = b => applyBoosts(st, target, b);
    const alive = !target.fainted;
    const halved = alive && target.hp < target.maxHp / 2 && target.hp + dealt > target.maxHp / 2;   // this hit took it below half
    switch (a) {
      case 'Sand Spit': if (st.weather !== 'Sand') { log(st, `${target.name}'s Sand Spit`); setWeather(st, 'Sand', target); } break;
      case 'Seed Sower': if (st.terrain !== 'Grassy') { log(st, `${target.name}'s Seed Sower turns the ground into grass`); setTerrain(st, 'Grassy', target); } break;
      case 'Toxic Debris':
        if (mm.cat === 'P' && st[user.side].hazards.tspikes < 2) { st[user.side].hazards.tspikes++; log(st, `Poison spikes were scattered on ${user.side === 'p' ? 'your' : 'their'} side (${target.name}'s Toxic Debris)`); }
        break;
      case 'Weak Armor': if (alive && mm.cat === 'P') up({ def: -1, spe: 2 }); break;
      case 'Stamina': if (alive) up({ def: 1 }); break;
      case 'Water Compaction': if (alive && type === 'Water') up({ def: 2 }); break;
      case 'Steam Engine': if (alive && (type === 'Water' || type === 'Fire')) up({ spe: 6 }); break;
      case 'Justified': if (alive && type === 'Dark') up({ atk: 1 }); break;
      case 'Rattled': if (alive && ['Dark', 'Bug', 'Ghost'].includes(type)) up({ spe: 1 }); break;
      case 'Thermal Exchange': if (alive && type === 'Fire') up({ atk: 1 }); break;
      case 'Electromorphosis': if (alive) { target.charged = 2; log(st, `${target.name} is charged (Electromorphosis)`); } break;
      case 'Wind Power': if (alive && E.D.moveLists && (E.D.moveLists.wind || []).includes(moveId)) { target.charged = 2; log(st, `${target.name} is charged (Wind Power)`); } break;
      case 'Anger Point': if (alive && crit && target.boosts.atk < 6) { target.boosts.atk = 6; log(st, `${target.name}'s Anger Point maxed its Attack`); } break;
      case 'Berserk': if (halved && user.ability !== 'Sheer Force') up({ spa: 1 }); break;
      case 'Anger Shell': if (halved) up({ atk: 1, spa: 1, spe: 1, def: -1, spd: -1 }); break;
      case 'Cotton Down':
        for (const x of actives(st, 'p').concat(actives(st, 'a'))) if (x !== target) applyBoosts(st, x, { spe: -1 }, 'foe');
        break;
      case 'Cursed Body':
        if (!user.fainted && mm.eff !== FUTURE && !user.disabled && roll(rng, 1 / 3)) { user.disabled = moveId; user.disableTurns = 4; log(st, `${user.name}'s ${mm.name} was disabled by ${target.name}'s Cursed Body`); }
        break;
      case 'Mummy': case 'Lingering Aroma':
        if (mm.contact && !user.fainted && !NO_ABILITY_CHANGE.has(user.ability)) { user.ability = a; log(st, `${user.name}'s ability became ${a}`); }
        break;
      case 'Wandering Spirit':
        if (mm.contact && !NO_ABILITY_CHANGE.has(user.ability) && user.ability !== a) { target.ability = user.ability; user.ability = a; log(st, `${user.name} and ${target.name} swapped abilities`); }
        break;
      case 'Perish Body':
        if (mm.contact) { let n = 0; for (const x of [user, target]) if (!x.fainted && x.perish == null) { x.perish = 3; n++; } if (n) log(st, 'Both Pokémon will faint in three turns (Perish Body)', 'perish', target); }
        break;
      case 'Aftermath': if (target.fainted && mm.contact && !user.fainted && user.ability !== 'Magic Guard') hurt(st, user, Math.max(1, Math.floor(user.maxHp / 4)), 'Aftermath'); break;
      case 'Innards Out': if (target.fainted && !user.fainted && user.ability !== 'Magic Guard') hurt(st, user, Math.max(1, dealt), 'Innards Out'); break;
      default: break;
    }
  }
  /** Who a Roar, Whirlwind, Dragon Tail or Circle Throw drags in: one of the bench at random (a live battle can say who). */
  function forcedPick(st, side, slot, rng) {
    const opts = bench(st, side);
    const pol = st.policies && st.policies[side];
    const said = pol && pol.forced ? pol.forced(st, side, slot) : null;
    if (said != null && opts.includes(st[side].team[said])) return said;
    return st[side].team.indexOf(opts[rng.expected ? 0 : Math.floor(rng() * opts.length)]);
  }
  /** Future Sight / Doom Desire: set up the hit on the target's spot (fails if one is already coming there). */
  function futureAttack(st, user, target, moveId, mm) {
    const fut = st[target.side].future || {};
    if (fut[target.slot]) { log(st, 'But it failed'); return; }
    st[target.side].future = Object.assign({}, fut, { [target.slot]: { left: 3, side: user.side, key: user.key, move: moveId, name: user.name } });
    log(st, mm.name === 'Doom Desire' ? `${user.name} chose Doom Desire as its destiny` : `${user.name} foresaw an attack`, 'future', user);
  }
  /** End of turn: Future Sight and Doom Desire come down, then wishes come true (the engine's ET_Future_Sight, ET_Wish).
   *  The counters run down even with no one in the spot; the hit or the heal goes to whoever is there when they run out. */
  function delayedEffects(st, rng) {
    for (const side of ['p', 'a']) {
      const fut = st[side].future;
      if (!fut) continue;
      const next = {};
      for (const [slot, f] of Object.entries(fut)) {
        if (f.left > 1) { next[slot] = Object.assign({}, f, { left: f.left - 1 }); continue; }
        const t = act(st, side, +slot);
        if (t && !t.fainted) futureHit(st, f, t, rng);
      }
      st[side].future = next;
    }
    for (const side of ['p', 'a']) {
      const ws = st[side].wish;
      if (!ws) continue;
      const next = {};
      for (const [slot, w] of Object.entries(ws)) {
        if (w.left > 1) { next[slot] = Object.assign({}, w, { left: w.left - 1 }); continue; }
        const t = act(st, side, +slot);
        if (t && !t.fainted && t.hp < t.maxHp) { log(st, `${w.name}'s wish came true`, 'wish', t); heal(st, t, w.hp, 'Wish'); }
      }
      st[side].wish = next;
    }
  }
  /** The delayed hit itself: worked out now, from the user as it is now (with its stat changes if it's still out). */
  function futureHit(st, f, t, rng) {
    const src = st[f.side].team.find(x => x.key === f.key);
    if (!src) return;
    const spec = specNow(src);
    if (!isActive(st, src)) spec.boosts = { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
    log(st, `${t.name} took the ${meta(f.move).name} attack`, 'future', t);
    const rr = E.rawRolls(spec, specNow(t), f.move, Object.assign({}, fieldOpts(st, t.side)));
    const rolls = (rr && rr.rolls) || [];
    let dmg = rolls.length ? rolls[rng.expected ? 7 : Math.floor(rng() * rolls.length)] : 0;
    if (!dmg) { log(st, `It doesn't affect ${t.name}`); return; }
    if (t.hp === t.maxHp && dmg >= t.hp && (t.ability === 'Sturdy' || itemName(t) === 'Focus Sash')) {
      dmg = t.hp - 1;
      if (itemName(t) === 'Focus Sash') consume(t);
    }
    const dealt = Math.min(t.hp, dmg);
    t.hp -= dealt;
    if (st.opts.record) log(st, `${t.name} loses ${Math.round(100 * dealt / t.maxHp)}% (${Math.round(100 * t.hp / t.maxHp)}% left)`, 'dmg', t);
    if (t.hp <= 0) faint(st, t, meta(f.move).name);
    else berryCheck(st, t);
  }

  // ---------------- end of turn ----------------
  function endOfTurn(st, rng) {
    const w = wx(st);
    const field = actives(st, 'p').concat(actives(st, 'a')).sort((x, y) => speed(st, y) - speed(st, x));
    // the engine's order: weather damage for everyone, then Future Sight and Wish, then each battler's own effects
    for (const m of field) {
      if (m && !m.fainted && w === 'Sand' && !['Rock', 'Ground', 'Steel'].some(t => hasType(m, t)) && !['Sand Veil', 'Sand Rush', 'Sand Force', 'Overcoat', 'Magic Guard'].includes(m.ability) && itemName(m) !== 'Safety Goggles')
        hurt(st, m, Math.max(1, Math.floor(m.maxHp / 16)), 'sandstorm');
    }
    delayedEffects(st, rng);
    for (const m of field) {
      if (!m || m.fainted) continue;
      const side = m.side;
      const it = itemName(m);
      if (it === 'Leftovers') heal(st, m, m.maxHp / 16, 'Leftovers');
      if (it === 'Black Sludge') { if (hasType(m, 'Poison')) heal(st, m, m.maxHp / 16, 'Black Sludge'); else hurt(st, m, Math.max(1, Math.floor(m.maxHp / 8)), 'Black Sludge'); }
      if (m.ability === 'Self Sufficient') heal(st, m, m.maxHp / 16, 'Self Sufficient');
      if ((m.ability === 'Rain Dish' && w === 'Rain') || (m.ability === 'Ice Body' && w === 'Snow')) heal(st, m, m.maxHp / 16, m.ability);
      if (m.ability === 'Dry Skin' && w === 'Rain') heal(st, m, m.maxHp / 8, 'Dry Skin');
      if (m.ability === 'Dry Skin' && w === 'Sun') hurt(st, m, Math.max(1, Math.floor(m.maxHp / 8)), 'Dry Skin');
      if (st.terrain === 'Grassy' && grounded(m)) heal(st, m, m.maxHp / 16, 'Grassy Terrain');
      if (m.fainted) continue;
      if (m.seeded) { const by = m.seededBy ? act(st, m.seededBy.side, m.seededBy.slot) : actives(st, other(side))[0]; const d = hurt(st, m, Math.max(1, Math.floor(m.maxHp / 8)), 'Leech Seed'); if (by && !by.fainted) heal(st, by, d, 'Leech Seed'); }
      if (m.fainted) continue;
      if (m.ability !== 'Magic Guard') {
        if (m.status === 'brn') hurt(st, m, Math.max(1, Math.floor(m.maxHp / 16)), 'burn');
        else if (m.status === 'frz') hurt(st, m, Math.max(1, Math.floor(m.maxHp / 16)), 'frostbite');
        else if (m.status === 'psn') { if (m.ability === 'Poison Heal') heal(st, m, m.maxHp / 8, 'Poison Heal'); else hurt(st, m, Math.max(1, Math.floor(m.maxHp / 8)), 'poison'); }
        else if (m.status === 'tox') { m.toxic++; if (m.ability === 'Poison Heal') heal(st, m, m.maxHp / 8, 'Poison Heal'); else hurt(st, m, Math.max(1, Math.floor(m.maxHp * m.toxic / 16)), 'toxic'); }
      }
      if (m.fainted) continue;
      if (m.bound) {
        const b = m.bound, by = st[b.side].team[b.idx];
        if (!by || by.fainted || !isActive(st, by)) m.bound = null;
        else {
          if (m.ability !== 'Magic Guard') hurt(st, m, Math.max(1, Math.floor(m.maxHp / b.frac)), b.name);
          if (m.bound && --m.bound.left <= 0) { m.bound = null; if (!m.fainted) log(st, `${m.name} is freed from ${b.name}`); }
        }
      }
      if (m.fainted) continue;
      if (m.status === 'slp' && m.ability !== 'Magic Guard' && actives(st, other(side)).some(x => x.ability === 'Bad Dreams')) hurt(st, m, Math.max(1, Math.floor(m.maxHp / 8)), 'Bad Dreams');
      if (m.fainted) continue;
      if (m.status && ((m.ability === 'Shed Skin' && roll(rng, 1 / 3)) || (m.ability === 'Hydration' && /Rain/.test(w || '')))) { m.status = ''; m.sleep = 0; m.toxic = 0; log(st, `${m.name}'s ${m.ability} cured its status`, 'cure', m); }
      if (m.saltCure && m.ability !== 'Magic Guard') hurt(st, m, Math.max(1, Math.floor(m.maxHp / (hasType(m, 'Water') || hasType(m, 'Steel') ? 4 : 8))), 'Salt Cure');
      if (m.nightmare) { if (m.status !== 'slp') m.nightmare = false; else if (m.ability !== 'Magic Guard') hurt(st, m, Math.max(1, Math.floor(m.maxHp / 4)), 'Nightmare'); }
      if (m.fainted) continue;
      const root = itemName(m) === 'Big Root' ? 1.3 : 1;
      if (m.aquaRing) heal(st, m, m.maxHp / 16 * root, 'Aqua Ring');
      if (m.ingrain) heal(st, m, m.maxHp / 16 * root, 'Ingrain');
      if (m.octolock && m.trappedBy) applyBoosts(st, m, { def: -1, spd: -1 }, 'foe');
      if (m.disabled && --m.disableTurns <= 0) { m.disabled = null; log(st, `${m.name}'s move is no longer disabled`); }
      if (m.yawn) { m.yawn--; if (m.yawn === 0 && !m.status) inflict(st, m, 'slp', rng, 'Yawn'); }
      if (m.perish != null) {   // the count shows, then drops; at 0 it knocks out
        if (m.perish <= 0) { m.perish = null; log(st, `${m.name}'s perish count fell to 0`, 'perish', m); faint(st, m, 'Perish Song'); continue; }
        log(st, `${m.name}'s perish count fell to ${m.perish}`, 'perish', m); m.perish--;
      }
      if (m.ability === 'Speed Boost' && m.firstTurn !== 2) applyBoosts(st, m, { spe: 1 });
      if (!m.status && it === 'Flame Orb' && !hasType(m, 'Fire')) inflict(st, m, 'brn', rng, 'Flame Orb');
      if (!m.status && it === 'Toxic Orb' && !hasType(m, 'Poison') && !hasType(m, 'Steel')) inflict(st, m, 'tox', rng, 'Toxic Orb');
      berryCheck(st, m);
    }
    if (st.weather && !st.primal && --st.weatherTurns <= 0) { log(st, 'The weather clears'); st.weather = null; }
    if (st.terrain && --st.terrainTurns <= 0) st.terrain = null;
    if (st.trickRoom) st.trickRoom--;
    if (st.gravity && --st.gravity <= 0) { st.gravity = 0; for (const s2 of ['p', 'a']) for (const x of st[s2].team) x.gravityGrounded = false; log(st, 'Gravity returned to normal'); }
    if (st.magicRoom) st.magicRoom--;
    if (st.wonderRoom) st.wonderRoom--;
    for (const side of ['p', 'a']) {
      const sd = st[side];
      for (const k of ['reflect', 'light', 'veil']) if (sd.screens[k]) sd.screens[k]--;
      if (sd.tailwind) sd.tailwind--;
      if (sd.safeguard) sd.safeguard--;
      if (sd.luckyChant) sd.luckyChant--;
      if (sd.mist) sd.mist--;
      for (const x of actives(st, side)) {
        if (x.magnetRise && --x.magnetRise === 0) log(st, `${x.name}'s electromagnetism wore off`);
        if (x.throatChop) x.throatChop--;
        if (x.healBlock && --x.healBlock === 0) log(st, `${x.name}'s Heal Block wore off`);
        if (x.charged) x.charged--;
      }
      sd.wideGuard = false; sd.quickGuard = false;
      for (const m of sd.team) { m.flinch = false; m.hitThisTurn = false; m.hitPhysicalThisTurn = false; if (!m.protect && !m.endure) m.protectStreak = 0; m.protect = false; m.endure = false; m.movedThisTurn = false; m.redirect = null; m.helped = false; m.plannedAction = null; }
      for (const cur of actives(st, side)) {
        if (cur.taunt && --cur.taunt === 0) log(st, `${cur.name}'s taunt wears off`);
        if (cur.encore && --cur.encore === 0) { cur.encoreMove = null; log(st, `${cur.name}'s encore ends`); }
        cur.firstTurn = cur.firstTurn === 2 ? 1 : false;
      }
    }
  }

  // ---------------- one turn ----------------
  function usable(m, st) {
    if (m.charging) return [m.charging];
    if (m.rampage && m.lock) return [m.lock];
    if (m.encore && m.encoreMove && m.moves.includes(m.encoreMove)) return [m.encoreMove];
    let mv = m.moves.slice();
    if (m.taunt) mv = mv.filter(id => meta(id).cat !== 'X');
    if (m.disabled) mv = mv.filter(id => id !== m.disabled);
    if (m.torment && m.lastMove) mv = mv.filter(id => id !== m.lastMove);
    if (m.lock && mv.includes(m.lock)) return [m.lock];
    if (itemName(m) === 'Assault Vest') mv = mv.filter(id => meta(id).cat !== 'X');
    if (!m.firstTurn) mv = mv.filter(id => meta(id).eff !== FAKE_OUT);
    if (m.status !== 'slp') mv = mv.filter(id => meta(id).name !== 'Sleep Talk' && meta(id).name !== 'Snore');
    if (m.throatChop) mv = mv.filter(id => !meta(id).sound);
    if (m.healBlock) mv = mv.filter(id => { const x = meta(id); return !(x.cat === 'X' && (x.eff === HEAL_HALF || x.eff === HEAL_WEATHER || x.eff === 37 || x.eff === WISH)); });
    if (st && st.gravity) mv = mv.filter(id => !ROM_GRAVITY_BANNED.has(id));
    return mv.length ? mv : m.moves.slice(0, 1);
  }
  const resolveTarget = (st, t) => (t && t.side ? act(st, t.side, t.slot || 0) : null);
  /** The risk of a one-on-one race (E.matchup) once the foe is paralyzed, asleep, confused or poisoned: it gets the
   *  same number of chances to hit (hitsTaken) and needs as many hits to knock you out (toKOme), but some chances are
   *  lost: a paralyzed foe acts 3 turns in 4, a sleeping one loses 1 to 3 turns, a confused one hurts itself 1 time in 3
   *  for about three turns. A race you lose either way stays lost. */
  function comb(n, k) { let c = 1; for (let i = 1; i <= k; i++) c = c * (n - k + i) / i; return c; }
  function atLeast(n, p, u) { if (u <= 0) return 1; if (u > n) return 0; let s = 0; for (let k = u; k <= n; k++) s += comb(n, k) * Math.pow(p, k) * Math.pow(1 - p, n - k); return s; }
  function statusRisk(mu, kind) {
    const n = Math.min(20, mu.hitsTaken), u = mu.toKOme;
    if (!kind || !isFinite(n) || !isFinite(u) || n <= 0) return kind === 'tox' ? mu.risk * 0.9 : mu.risk;
    const near = left => (left >= u ? 1 : mu.risk * left / n);   // fewer chances: less risk from rolls and crits too
    if (kind === 'par') return n >= u ? atLeast(n, 0.75, u) : mu.risk * 0.75;
    if (kind === 'slp') return [1, 2, 3].reduce((r, t) => r + near(Math.max(0, n - t)), 0) / 3;
    if (kind === 'conf') { const c = Math.min(n, 3); let r = 0; for (let k = 0; k <= c; k++) r += comb(c, k) * Math.pow(2 / 3, k) * Math.pow(1 / 3, c - k) * near(k + n - c); return r; }
    if (kind === 'tox') return mu.risk * 0.9;
    if (kind === 'psn' || kind === 'brn') return mu.risk * 0.97;
    return mu.risk;
  }
  /** What a status move does when it works: boosts for you (self), drops for the target (foe), a status, confusion,
   *  healing. null for a damaging move or one the Coach doesn't value (Splash, Teleport and the like). */
  function statusEffect(id) {
    const mm = meta(id);
    if (!mm || mm.cat !== 'X') return null;
    const n = mm.name, e = mm.eff, out = {};
    if (SETUP[n] || EFFECT_BOOST[e]) out.self = SETUP[n] || EFFECT_BOOST[e];
    else if (EFFECT_DROP[e]) out.foe = EFFECT_DROP[e];
    const stt = { 1: 'slp', 67: 'par', 167: 'brn', 33: 'tox', 66: 'psn' }[e];
    if (stt) out.status = stt;
    if (e === 49) out.conf = true;
    if (e === 118) { out.conf = true; out.foe = { atk: 2 }; }
    if (e === 166) { out.conf = true; out.foe = { spa: 1 }; }
    if (e === HEAL_HALF || e === HEAL_WEATHER) out.heal = 0.5;
    if (!Object.keys(out).length) return null;
    out.acc = out.self || out.heal ? 1 : mm.acc ? mm.acc / 100 : 1;
    return out;
  }
  /** What a move can do to its target this turn that stops it moving: par, slp, conf, flinch (and brn, psn, tox, and frz:
   *  frostbite, which doesn't stop it). */
  function mayCause(user, moveId) {
    const mm = meta(moveId), e = mm.eff, out = new Set();
    if (mm.cat === 'X') {
      const sm = { 1: 'slp', 33: 'tox', 66: 'psn', 67: 'par', 167: 'brn' }[e];
      if (sm) out.add(sm);
      if (e === 49 || e === 118 || e === 166) out.add('conf');
      return out;
    }
    if (user.ability === 'Sheer Force') return out;
    const sb = { 2: 'psn', 4: 'brn', 5: 'frz', 6: 'par', 209: 'tox' }[e];
    if (sb) out.add(sb);
    if (e === 152 && mm.name === 'Thunder') out.add('par');
    if (e === 36) { out.add('brn'); out.add('par'); out.add('frz'); }
    if (FANG[mm.name]) out.add(FANG[mm.name]);
    if (e === 31 || (e === FAKE_OUT && mm.name === 'Fake Out') || ['King\'s Rock', 'Razor Fang'].includes(itemName(user))) out.add('flinch');
    if (e === 76) out.add('conf');
    return out;
  }
  function playTurn(st, rng) {
    st.turn++;
    const P = st.policies;
    // every battler on the field picks an action (doubles policies may pick both at once)
    const acts = [];
    for (const side of ['p', 'a']) {
      const pol = P[side];
      const mons = st[side].slots.map((i, slot) => ({ slot, m: st[side].team[i] })).filter(x => x.m && !x.m.fainted);
      const chosen = pol.chooseAll && st.size > 1 ? pol.chooseAll(st, side, rng) : mons.map(x => pol.choose(st, side, rng, false, false, x.slot));
      mons.forEach((x, k) => {
        const a = Object.assign({}, chosen[k] || { type: 'move', id: usable(x.m, st)[0] }, { slot: x.slot });
        x.m.plannedAction = a;
        acts.push({ side, slot: x.slot, user: x.m, a });
      });
    }
    const ev = { turn: st.turn, type: 'decide', acts: acts.map(x => ({ side: x.side, slot: x.slot, key: x.user.key, a: x.a, hp: x.user.hp / x.user.maxHp,
      tkey: x.a.target ? (act(st, x.a.target.side, x.a.target.slot) || {}).key || null : null, lk: lockInfo(x.user) })) };
    if (st.size === 1) {
      const pa = acts.find(x => x.side === 'p'), aa = acts.find(x => x.side === 'a');
      Object.assign(ev, { p: pa && pa.a, a: aa && aa.a, pm: pa && pa.user.key, am: aa && aa.user.key, php: pa ? pa.user.hp / pa.user.maxHp : 0, ahp: aa ? aa.user.hp / aa.user.maxHp : 0,
        plk: pa ? lockInfo(pa.user) : null });
    }
    st.events.push(ev);
    // switches go first; a foe that chose Pursuit hits the one leaving before it goes, at double power
    for (const x of acts.filter(y => y.a.type === 'switch').sort((y, z) => speed(st, z.user) - speed(st, y.user))) {
      const to = st[x.side].team[x.a.to];
      if (!to || to.fainted || st[x.side].slots.includes(x.a.to)) continue;
      for (const y of acts) {
        const leaving = act(st, x.side, x.slot);
        if (!leaving || leaving.fainted) break;
        if (y.side === x.side || y.a.type !== 'move' || y.done || meta(y.a.id).name !== 'Pursuit' || !isActive(st, y.user) || y.user.fainted) continue;
        y.done = true;
        log(st, `${y.user.name} goes after ${leaving.name} as it switches out`);
        useMove(st, y.side, y.a.id, rng, { user: y.user, slot: y.user.slot, target: leaving, bp: meta(y.a.id).power * 2, outcome: y.a.outcome, ko: y.a.ko, noKO: y.a.noKO });
      }
      const still = act(st, x.side, x.slot);
      if (!still || still.fainted) continue;      // knocked out on the way out: replaced at the end of the turn
      switchIn(st, x.side, x.a.to, rng, x.a.why || 'switch', x.slot);
    }
    for (const x of acts) if (x.a.type === 'move' && isActive(st, x.user) && megaTarget(x.user)) megaEvolve(st, x.side, x.user);
    const order = acts.filter(x => x.a.type === 'move' && !x.done).map(x => Object.assign({}, x, { id: x.a.id, z: !!x.a.z }));
    for (const o of order) { o.pri = priorityOf(st, o.user, o.id); o.spe = speed(st, o.user); o.r = rng.expected ? (o.side === 'a' ? 0 : 1) + o.slot / 10 : rng(); }
    // a live battle can say who moved first (singles): that beats the Speed the Coach assumed
    const first = st.size === 1 ? (order.find(o => o.a.first) || {}).side || null : null;
    order.sort((x, y) => (first && x.side !== y.side ? (x.side === first ? -1 : 1) : 0) || (y.pri - x.pri) || (st.trickRoom ? x.spe - y.spe : y.spe - x.spe) || (x.r - y.r));
    // Custap Berry: move first within the bracket at low HP
    if (!first) order.forEach((o, i) => {
      const m = o.user;
      if (itemName(m) === 'Custap Berry' && m.hp <= m.maxHp / 4 && i > 0 && order[0].pri === o.pri) { consume(m); order.splice(i, 1); order.unshift(o); log(st, `${m.name}'s Custap Berry lets it move first`); }
    });
    for (const o of order) {
      const m = o.user;
      if (!m || m.fainted || !isActive(st, m)) continue;
      useMove(st, o.side, o.id, rng, { user: m, slot: m.slot, target: resolveTarget(st, o.a.target), z: o.z && !!zKind(st, m, o.id), outcome: o.a.outcome, ko: o.a.ko, noKO: o.a.noKO });
      if (!alive(st, 'p').length || !alive(st, 'a').length) break;
    }
    // the battle ends with the action that ends it (the game checks after each action: no end of turn)
    if (battleOver(st)) return;
    endOfTurn(st, rng);
    for (const side of ['p', 'a']) for (const x of actives(st, side)) if (x.swCooldown) x.swCooldown--;
    // replacements after faints (set mode: the player gets no free look before the boss sends its next Pokemon)
    // one that goes down to hazards as it comes in is replaced at once, until one stands or none are left
    for (const side of ['a', 'p']) {
      st[side].slots.forEach((_, slot) => {
        for (let k = 0; k < 6; k++) {
          const m = st[side].team[st[side].slots[slot]];
          if (!(m && m.fainted && bench(st, side).length)) break;
          const to = P[side].replace(st, side, rng, 'faint', slot);
          if (to == null || st[side].slots.includes(to) || st[side].team[to].fainted) break;
          switchIn(st, side, to, rng, 'replace', slot);
        }
      });
    }
    battleOver(st);
  }
  /** The game's checkteamslost (FireRed atk24, kept by CFRU outside the Battle Frontier): when both sides are out of
   *  Pokemon after the same action (recoil, Life Orb, Rocky Helmet, Rough Skin, Iron Barbs, Explosion, Destiny Bond,
   *  Perish Song, end-of-turn damage) the outcome is a draw, and a draw counts as a defeat: you white out. */
  function battleOver(st) {
    const p = alive(st, 'p').length, a = alive(st, 'a').length;
    if (p && a) return false;
    st.over = true;
    st.winner = p ? 'p' : 'a';
    if (!p && !a) { st.draw = true; log(st, 'Both sides are out of Pokemon at once: the game counts a draw as a loss'); }
    return true;
  }

  // ---------------- quick evaluation helpers ----------------
  function bestDamage(st, from, to) {
    // expected and KO odds of each usable damaging move of `from` against `to`, right now
    const out = [];
    const fo = fieldOpts(st, to.side);
    const sf = specNow(from), stg = specNow(to);
    for (const id of usable(from, st)) {
      const mm = meta(id);
      if (mm.cat === 'X') continue;
      const hits = mm.multihit ? (from.ability === 'Skill Link' ? mm.multihit[1] : 3) : 0;
      const rr = E.rawRolls(sf, stg, id, Object.assign({ hits }, fo));
      const acc = hitChance(st, from, to, mm);
      const mean = rr.rolls.reduce((a, b) => a + b, 0) / rr.rolls.length;
      let ko = rr.rolls.filter(x => x >= to.hp).length / rr.rolls.length;
      if (to.hp === to.maxHp && (to.ability === 'Sturdy' || itemName(to) === 'Focus Sash') && !mm.multihit) ko = 0;
      if (to.sub && !mm.sound) ko = 0;
      out.push({ id, mean, frac: mean / to.maxHp, ko: ko * acc, acc, pri: priorityOf(st, from, id), eff: rr.eff });
    }
    return out;
  }
  const firstMover = (st, a, b, pa, pb) => (pa !== pb ? pa > pb : (st.trickRoom ? speed(st, a) < speed(st, b) : speed(st, a) > speed(st, b)));

  // ---------------- the boss AI (approximation) ----------------
  function aiPolicy(noise) {
    return {
      choose(st, side, rng) {
        const me = act(st, side), foe = act(st, other(side));
        const options = usable(me, st);
        if (options.length === 1 && (me.charging || me.rampage || me.lock || me.recharge)) return { type: 'move', id: options[0] };
        const dmg = bestDamage(st, me, foe);
        const foeDmg = bestDamage(st, foe, me);
        const foeBest = foeDmg.reduce((a, b) => (b.mean > a.mean ? b : a), { mean: 0, ko: 0, pri: 0 });
        const threatened = foeBest.ko >= 0.5 && firstMover(st, foe, me, foeBest.pri, 0);
        const canKO = dmg.filter(d => d.ko >= 0.5);
        let best = null, bestScore = -1e9;
        for (const id of options) {
          const mm = meta(id);
          let s = 0;
          if (mm.cat !== 'X') {
            const d = dmg.find(x => x.id === id) || { frac: 0, ko: 0, pri: 0 };
            s = Math.min(100, d.frac * 100);
            if (d.ko >= 0.5) s = 200 + d.ko * 20 + (d.pri > 0 && !firstMover(st, me, foe, 0, foeBest.pri) ? 30 : 0);
            if (mm.eff === FAKE_OUT && mm.name === 'Fake Out' && me.firstTurn) s = Math.max(s, 120);   // a free flinch (First Impression doesn't flinch)
            if (mm.eff === 7 && me.hp > me.maxHp / 2) s *= 0.3;
            if (mm.eff === PIVOT && threatened && bench(st, side).length) s += 25;
            if (mm.eff === SUCKER && !(foeDmg.length)) s *= 0.2;
          } else {
            const n = mm.name, e = mm.eff;
            const safe = foeBest.frac < 0.4 * (me.hp / me.maxHp);
            const raises = SETUP[n] || EFFECT_BOOST[e] || (e === 142 ? { atk: 6 } : null);
            const boosted = raises ? Math.min(...Object.entries(raises).filter(([, v]) => v > 0).map(([k]) => me.boosts[k])) : 6;
            const capped = (n === 'Stockpile' && (me.stockpile || 0) >= 3) || (e === 142 && me.hp <= me.maxHp / 2);
            if (raises) s = (!canKO.length && safe && boosted < 2 && !capped) ? 75 : (canKO.length || capped ? -50 : 5);
            else if ({ 1: 1, 67: 1, 167: 1, 33: 1, 66: 1 }[e]) {
              const stt = { 1: 'slp', 67: 'par', 167: 'brn', 33: 'tox', 66: 'psn' }[e];
              s = canStatus(st, foe, stt, n, me) && !canKO.length ? (stt === 'slp' ? 85 : 68) : -50;
              if (stt === 'brn' && foeDmg.every(d => meta(d.id).cat !== 'P')) s -= 30;
            } else if (e === 187) s = !foe.status && !foe.yawn && canStatus(st, foe, 'slp', n, me) ? 60 : -50;
            else if (e === HAZARD) {
              const hz = st[other(side)].hazards;
              const done = (n === 'Stealth Rock' && hz.sr) || (n === 'Spikes' && hz.spikes >= 3) || (n === 'Toxic Spikes' && hz.tspikes >= 2) || (n === 'Sticky Web' && hz.web);
              s = !done && bench(st, other(side)).length >= 1 && !canKO.length ? 72 : -50;
            } else if (e === HEAL_HALF || e === HEAL_WEATHER || n === 'Strength Sap') s = me.hp < me.maxHp * 0.5 ? 80 : me.hp < me.maxHp * 0.7 ? 35 : -50;
            else if (e === 37) s = me.hp < me.maxHp * 0.4 ? 70 : -50;
            else if (e === PROTECT_EFF) s = me.protectStreak ? -50 : (foe.status === 'tox' || foe.status === 'psn' || foe.status === 'brn' || foe.seeded ? 45 : 12);
            else if (e === 35 || e === 65) s = (n === 'Light Screen' ? st[side].screens.light : st[side].screens.reflect) ? -50 : 60;
            else if ([136, 137, 115, 164].includes(e)) s = 40;
            else if (e === 228) s = st.trickRoom ? -50 : (speed(st, me) < speed(st, foe) ? 65 : 10);
            else if (e === 239) s = st[side].tailwind ? -50 : 60;
            else if (e === 98) s = me.hp < me.maxHp / 3 && !firstMover(st, me, foe, 0, foeBest.pri) ? 80 : 5;
            else if (e === 84) s = !hasType(foe, 'Grass') && !foe.seeded ? 55 : -50;
            else if (e === PIVOT || e === TELEPORT) s = threatened && bench(st, side).length ? 70 : 5;
            else if (EFFECT_DROP[e]) s = 25;
            else s = 2;
          }
          s += noise && !rng.expected ? rng() * noise : 0;
          if (s > bestScore) { bestScore = s; best = id; }
        }
        return { type: 'move', id: best };
      },
      replace(st, side, rng) {
        // send in what matches up best against the player's active Pokemon
        const foe = act(st, other(side));
        let bestI = null, bestS = -1e9;
        st[side].team.forEach((m, i) => {
          if (m.fainted || st[side].slots.includes(i)) return;
          if (!foe || foe.fainted) { if (bestI == null) bestI = i; return; }
          const off = bestDamage(st, m, foe).reduce((a, b) => Math.max(a, Math.min(1, b.frac) * 100 + (b.ko >= 0.5 ? 50 : 0)), 0);
          const def = bestDamage(st, foe, m).reduce((a, b) => Math.max(a, Math.min(1, b.frac) * 100 + (b.ko >= 0.5 ? 50 : 0)), 0);
          const s = off - def + (speed(st, m) > speed(st, foe) ? 15 : 0);
          if (s > bestS) { bestS = s; bestI = i; }
        });
        return bestI;
      },
    };
  }

  // ---------------- the player's planner ----------------
  /** Analytic estimate of the chance `me` faints before knocking out `foe`, from the current battle state,
   *  if `me` keeps using `moveId` and `foe` keeps using its strongest move (via the engine's matchup). */
  function duelRisk(st, me, foe, moveId, mePct, foePct) {
    const ms = Object.assign(specNow(me), { mv: moveId ? [moveId] : me.moves, entry: false });
    if (mePct != null) ms.hpPct = mePct;
    const fs = Object.assign(specNow(foe), { mv: usable(foe, st), entry: false });
    if (foePct != null) fs.hpPct = foePct;
    const mu = E.matchup(ms, fs, { weather: st.weather, entry: false });
    return mu;
  }
  function plannerPolicy(opts) {
    const o = Object.assign({ hpWeight: 0.15 }, opts || {});
    const value = m => (o.values && o.values[m.key] != null ? o.values[m.key] : 1);
    const memoDecisions = new Map();
    function sig(st, side) {
      const parts = [st.weather || '', st.terrain || '', st.trickRoom ? 1 : 0];
      for (const s of ['p', 'a']) {
        const t = st[s];
        parts.push(t.active, JSON.stringify(t.hazards), t.screens.reflect ? 1 : 0, t.screens.light ? 1 : 0);
        for (const m of t.team) parts.push(m.fainted ? 'x' : [Math.round(20 * m.hp / m.maxHp), m.status, STATS5.map(k => m.boosts[k]).join(''), m.item || 0, m.charging || 0, m.lock || 0].join(':'));
      }
      return side + parts.join('|');
    }
    // expected further losses if `foe` (at foePct) has to be handled by one of my bench Pokemon coming in for free
    function cleanup(st, side, foe, foePct, exclude) {
      let best = Infinity;
      for (const b of bench(st, side)) {
        if (b === exclude) continue;
        const fs = Object.assign(specNow(foe), { hpPct: foePct, mv: usable(foe, st), entry: false });
        const bs = Object.assign(specNow(b), { entry: true });
        const mu = E.matchup(bs, fs, { weather: st.weather, entry: true });
        best = Math.min(best, mu.risk * value(b) + o.hpWeight * (1 - mu.hpLeftPct / 100));
      }
      return best === Infinity ? 3 : best;   // nobody left: very bad
    }
    /** A move that locks me in (Rollout, Outrage, Uproar): play the locked turns out against the boss AI with the likeliest
     *  dice, adding up the chance that each of its attacks meanwhile knocks me out (all rolls, crits and misses), then the
     *  duel from where that leaves me. Returns { risk, hpLeftPct, foePct, mu, turns } or null. */
    function lockLine(st, side, id) {
      const s2 = cloneState(st);
      const foeSide = other(side), dice = expectedDice();
      const me0 = act(s2, side);
      let first = true;   // the move that starts it, then whatever the lock forces
      s2.policies = { [side]: { choose: (s, sd) => { const pick = first ? id : usable(act(s, sd), s)[0]; first = false; return { type: 'move', id: pick }; }, replace: () => null },
        [foeSide]: st.policies[foeSide] };
      let alive = 1, turns = 0;
      for (; turns < 6 && !s2.over; turns++) {
        const hpBefore = me0.hp, ev0 = s2.events.length;
        playTurn(s2, dice);
        // their attacks on me this turn: the chance one of them knocks me out from the HP I had
        for (const e of s2.events.slice(ev0)) {
          if (e.type !== 'move' || e.side !== foeSide || meta(e.move).cat === 'X') continue;
          const foe = s2[foeSide].team.find(x => x.key === e.user);
          if (!foe) continue;
          const dist = E.damageDist(specNow(foe), Object.assign(specNow(me0), { hpPct: 100 * hpBefore / me0.maxHp }), e.move, s2.weather, Math.max(1, hpBefore));
          alive *= 1 - dist[Math.max(1, hpBefore)];
        }
        if (me0.fainted || !isActive(s2, me0) || !(me0.rampage && me0.lock)) { turns++; break; }
      }
      const foeNow = act(s2, foeSide);
      let after = { risk: 0, hpLeftPct: 100 * me0.hp / me0.maxHp, mu: null };
      if (me0.fainted) after = { risk: 1, hpLeftPct: 0, mu: null };
      else if (foeNow && !foeNow.fainted && isActive(s2, me0)) {
        const mu = duelRisk(s2, me0, foeNow, null);
        after = { risk: mu.risk, hpLeftPct: mu.hpLeftPct, mu };
      }
      const risk = Math.min(1, 1 - alive * (1 - after.risk));
      return { risk, hpLeftPct: after.hpLeftPct, foePct: foeNow && !foeNow.fainted ? Math.max(1, 100 * foeNow.hp / foeNow.maxHp) : 1, mu: after.mu, turns };
    }
    function evaluate(st, side) {
      const me = act(st, side), foe = act(st, other(side));
      const options = [];
      // stay and attack
      const moves = usable(me, st);
      const myDmg = bestDamage(st, me, foe);
      for (const id of moves) {
        const mm = meta(id);
        if (mm.cat === 'X') continue;
        if (!(me.rampage && me.lock) && LOCKS_IN(mm)) {   // it locks me in: see what the boss does meanwhile
          const L = lockLine(st, side, id);
          if (L) {
            const cost = L.risk * (value(me) + cleanup(st, side, foe, L.foePct, me)) + o.hpWeight * (1 - L.hpLeftPct / 100);
            options.push({ type: 'move', id, cost, risk: L.risk, mu: L.mu, label: `Use ${mm.name}`, lock: L });
            continue;
          }
        }
        const mu = duelRisk(st, me, foe, id);
        const d = myDmg.find(x => x.id === id);
        const foeAfterPct = Math.max(1, 100 * (foe.hp - (d ? d.mean * Math.max(0, mu.hitsTaken) : 0)) / foe.maxHp);
        const cost = mu.risk * (value(me) + cleanup(st, side, foe, foeAfterPct, me)) + o.hpWeight * (1 - mu.hpLeftPct / 100);
        options.push({ type: 'move', id, cost, risk: mu.risk, mu, label: `Use ${mm.name}` });
      }
      // your Z-Move (once per battle): one big hit now, then the duel goes on with its normal moves
      for (const id of moves) {
        if (meta(id).cat === 'X' || zKind(st, me, id) !== 'type') continue;
        const rr = E.rawRolls(specNow(me), specNow(foe), id, Object.assign({ z: true }, fieldOpts(st, foe.side)));
        if (!rr || !rr.rolls.length || rr.eff === 0) continue;
        const mean = rr.rolls.reduce((a, b) => a + b, 0) / rr.rolls.length;
        const koP = rr.rolls.filter(x => x >= foe.hp).length / rr.rolls.length;
        const foeDmg = bestDamage(st, foe, me);
        const foeBest = foeDmg.reduce((a, b) => (b.ko > a.ko ? b : a), { ko: 0, pri: 0, mean: 0 });
        const meFirst = firstMover(st, me, foe, priorityOf(st, me, id), foeBest.pri);
        const diesFirst = meFirst ? 0 : foeBest.ko;
        const after = Math.max(1, 100 * (foe.hp - mean) / foe.maxHp);
        const rest = koP >= 0.999 ? null : duelRisk(st, me, foe, null, null, after);
        const risk = diesFirst + (1 - diesFirst) * (1 - koP) * (rest ? rest.risk : 0);
        const cost = risk * (value(me) + cleanup(st, side, foe, after, me)) + o.hpWeight * (1 - (rest ? rest.hpLeftPct : 100 * (me.hp - (meFirst ? 0 : foeBest.mean)) / me.maxHp) / 100) - 0.0005;
        options.push({ type: 'move', id, z: true, cost, risk, mu: rest, label: `Use Z-${meta(id).name} (your Z-Move)` });
      }
      // status and healing moves the player might have
      for (const id of moves) {
        const mm = meta(id);
        if (mm.cat !== 'X') continue;
        const stt = { 1: 'slp', 67: 'par', 167: 'brn', 33: 'tox', 66: 'psn' }[mm.eff];
        const cured = itemName(foe) === 'Lum Berry' || CURE_BERRY[itemName(foe)] === stt;
        if (stt && !cured && canStatus(st, foe, stt, mm.name, me)) {
          // one free hit for them this turn, then the duel with them statused
          const foeDmg = bestDamage(st, foe, me);
          const hit = foeDmg.reduce((a, b) => (b.mean > a.mean ? b : a), { mean: 0, ko: 0 });
          const pFaint = hit.ko;
          const afterPct = Math.max(1, 100 * (me.hp - hit.mean) / me.maxHp);
          const saved = foe.status; foe.status = stt;
          const mu = duelRisk(st, me, foe, null, afterPct);
          foe.status = saved;
          if (!mu.best || !isFinite(mu.toKOthem)) continue;   // still can't knock it out: no point
          let r = pFaint + (1 - pFaint) * statusRisk(mu, stt);
          r = r * (mm.acc ? mm.acc / 100 : 1) + (1 - (mm.acc ? mm.acc / 100 : 1)) * Math.min(1, pFaint * 2);
          options.push({ type: 'move', id, cost: r * (value(me) + cleanup(st, side, foe, 100 * foe.hp / foe.maxHp, me)) + o.hpWeight * (1 - Math.min(afterPct, mu.hpLeftPct) / 100), risk: r, label: `Use ${mm.name}` });
        }
        const fx = statusEffect(id);
        if (fx && !stt && (fx.self || fx.foe || fx.conf)) {
          // one free hit for them this turn, then the duel with the stats changed (or them confused)
          const up = fx.self && Object.entries(fx.self).some(([k, v]) => v > 0 && me.boosts[k] < 6);
          const foeHit = fx.foe && !foe.sub && !['Clear Body', 'White Smoke', 'Full Metal Body'].includes(foe.ability) && itemName(foe) !== 'Clear Amulet';
          const conf = fx.conf && !foe.confused && foe.ability !== 'Own Tempo' && !foe.sub;
          if (up || foeHit || conf) {
            const foeDmg = bestDamage(st, foe, me);
            const hit = foeDmg.reduce((a, b) => (b.mean > a.mean ? b : a), { mean: 0, ko: 0 });
            const pFaint = hit.ko;
            const afterPct = Math.max(1, 100 * (me.hp - hit.mean) / me.maxHp);
            const sb = me.boosts, fb = foe.boosts;
            me.boosts = Object.assign({}, sb); foe.boosts = Object.assign({}, fb);
            const bump = (m, d) => { for (const [k, v] of Object.entries(d)) m.boosts[k] = Math.max(-6, Math.min(6, (m.boosts[k] || 0) + v)); };
            if (up) bump(me, fx.self);
            if (foeHit) bump(foe, fx.foe);
            const mu = duelRisk(st, me, foe, null, afterPct);
            me.boosts = sb; foe.boosts = fb;
            if (!mu.best || !isFinite(mu.toKOthem)) continue;   // still can't knock it out: no point
            let r = pFaint + (1 - pFaint) * statusRisk(mu, conf ? 'conf' : '');
            r = r * fx.acc + (1 - fx.acc) * Math.min(1, pFaint * 2);
            // a turn spent: it has to be worth it (attacking wins a tie)
            options.push({ type: 'move', id, cost: r * (value(me) + cleanup(st, side, foe, 100 * foe.hp / foe.maxHp, me)) + o.hpWeight * (1 - Math.min(afterPct, mu.hpLeftPct) / 100) + 0.01, risk: r, label: `Use ${mm.name}` });
          }
        }
        if ((mm.eff === HEAL_HALF || mm.eff === HEAL_WEATHER) && me.hp < me.maxHp * 0.6) {
          const foeDmg = bestDamage(st, foe, me);
          const hit = foeDmg.reduce((a, b) => (b.mean > a.mean ? b : a), { mean: 0, ko: 0 });
          if (hit.mean < me.maxHp * 0.45) {
            const afterPct = Math.min(100, 100 * (me.hp + me.maxHp / 2 - hit.mean) / me.maxHp);
            const mu = duelRisk(st, me, foe, null, afterPct);
            const r = hit.ko + (1 - hit.ko) * mu.risk;
            options.push({ type: 'move', id, cost: r * value(me) + o.hpWeight * (1 - afterPct / 100) + 0.02, risk: r, label: `Use ${mm.name}` });
          }
        }
      }
      // switch: the boss already chose its move against `me`; the newcomer takes it
      const aiMove = st.policies[other(side)].choose(st, other(side), expectedDice(), false, true);
      for (const b of canSwitch(st, me) ? bench(st, side) : []) {
        let entryDmg = 0, pEntry = 0;
        const hz = st[side].hazards;
        if (hz.sr && itemName(b) !== 'Heavy-Duty Boots') entryDmg += Math.max(1, Math.floor(b.maxHp * 0.125 * E.typeEff('Rock', b.types)));
        if (hz.spikes && grounded(b) && itemName(b) !== 'Heavy-Duty Boots') entryDmg += Math.max(1, Math.floor(b.maxHp * [0, 1 / 8, 1 / 6, 1 / 4][hz.spikes]));
        if (aiMove.type === 'move' && meta(aiMove.id).cat !== 'X') {
          const fo = fieldOpts(st, side);
          const rr = E.rawRolls(specNow(foe), Object.assign(specNow(b), { hpPct: 100 }), aiMove.id, Object.assign({ hits: meta(aiMove.id).multihit ? 3 : 0 }, fo));
          const left = b.hp - entryDmg;
          pEntry = rr.rolls.filter(x => x >= left).length / rr.rolls.length * hitChance(st, foe, b, meta(aiMove.id));
          entryDmg += rr.rolls.reduce((a, c) => a + c, 0) / rr.rolls.length;
        }
        const afterPct = Math.max(1, 100 * (b.hp - entryDmg) / b.maxHp);
        const bs = Object.assign(specNow(b), { hpPct: afterPct, entry: true });
        const fs = Object.assign(specNow(foe), { mv: usable(foe, st), entry: false });
        const mu = E.matchup(bs, fs, { weather: st.weather, entry: true });
        const risk = pEntry + (1 - pEntry) * mu.risk;
        const dealt = mu.best ? (mu.best.min + mu.best.max) / 2 * Math.max(0, mu.hitsTaken) : 0;
        const foeAfter = Math.max(1, 100 * (foe.hp - dealt) / foe.maxHp);
        const cost = risk * (value(b) + cleanup(st, side, foe, foeAfter, b)) + o.hpWeight * (1 - Math.min(afterPct, mu.hpLeftPct) / 100) + 0.03;
        const bounce = st[side].lastOut === b.key && st.turn - (st[side].lastOutTurn || 0) <= 2 ? 0.25 : 0;
        options.push({ type: 'switch', to: st[side].team.indexOf(b), cost: cost + bounce, risk, mu, label: `Switch to ${b.name}`, entryPct: 100 - afterPct });
      }
      // equal costs: prefer the faster knockout, then more damage
      for (const x of options) if (x.mu && x.mu.best) x.cost += 0.001 * Math.min(10, x.mu.toKOthem) - 0.00001 * x.mu.best.minPct;
      options.sort((x, y) => x.cost - y.cost);
      return options;
    }
    return {
      evaluate,
      choose(st, side, rng) {
        const me = act(st, side);
        const forced = usable(me, st);
        if (me.charging || (me.rampage && me.lock) || me.recharge) return { type: 'move', id: forced[0] };
        const key = sig(st, side);
        let opts = memoDecisions.get(key);
        if (!opts) { opts = evaluate(st, side); memoDecisions.set(key, opts); }
        const pick = opts[0] || { type: 'move', id: forced[0] };
        const alts = st.opts.record ? opts.slice(0, 3).map(x => ({ label: x.label, risk: x.risk })) : null;
        return pick.type === 'switch' ? { type: 'switch', to: pick.to, why: 'plan', risk: pick.risk, alts } : { type: 'move', id: pick.id, z: !!pick.z, risk: pick.risk, alts };
      },
      replace(st, side, rng, why) {
        const foe = act(st, other(side));
        let bestI = null, bestC = Infinity;
        st[side].team.forEach((b, i) => {
          if (b.fainted || st[side].slots.includes(i)) return;
          if (!foe || foe.fainted) { if (bestI == null) bestI = i; return; }
          const bs = Object.assign(specNow(b), { entry: true });
          const fs = Object.assign(specNow(foe), { mv: usable(foe, st), entry: false });
          const mu = E.matchup(bs, fs, { weather: st.weather, entry: true });
          const c = mu.risk * value(b) + o.hpWeight * (1 - mu.hpLeftPct / 100);
          if (c < bestC) { bestC = c; bestI = i; }
        });
        return bestI;
      },
    };
  }

  // ---------------- the player's planner in doubles ----------------
  /** Each turn: every pair of actions for your two Pokemon (a move on each target, Protect and support moves, switches),
   *  pruned to the most promising, is played out for one turn against what the boss AI will do (it picks without knowing
   *  yours), and the pair that leaves your side best off wins: Pokemon kept, HP kept, foes knocked out. */
  function doublesPlanner(opts) {
    const o = Object.assign({ hpWeight: 0.6, keep: 4 }, opts || {});
    const value = m => (o.values && o.values[m.key] != null ? o.values[m.key] : 1);
    const memo = new Map();
    function quickReplace(st, side) {
      const foes = actives(st, other(side));
      let best = null, bs = -1e9;
      bench(st, side).forEach(b => {
        let sc = 0;
        for (const f of foes) {
          const mine = bestDamage(st, b, f).reduce((a, x) => Math.max(a, Math.min(1, x.frac) + (x.ko >= 0.5 ? 0.5 : 0)), 0);
          const theirs = bestDamage(st, f, b).reduce((a, x) => Math.max(a, Math.min(1, x.frac) + (x.ko >= 0.5 ? 0.5 : 0)), 0);
          sc += mine - theirs + (speed(st, b) > speed(st, f) ? 0.15 : 0);
        }
        sc += 0.2 * b.hp / b.maxHp;
        if (sc > bs) { bs = sc; best = st[side].team.indexOf(b); }
      });
      return best;
    }
    const fixed = acts => ({ chooseAll: () => acts, choose: (st, side, rng, e, p, slot) => acts[slot] || { type: 'move', id: usable(act(st, side, slot), st)[0] }, replace: (st, side) => quickReplace(st, side) });
    function optionsFor(st, side, slot, aiActs) {
      const me = act(st, side, slot);
      const foes = actives(st, other(side));
      const raw = [];
      for (const id of usable(me, st)) {
        const mm = meta(id), tg = (E.mv(id) || {}).tg || 0;
        const single = !(tg === 8 || tg === 32 || tg === 16 || tg === 64);
        const zOk = mm.cat !== 'X' && zKind(st, me, id) === 'type';
        for (const z of zOk ? [false, true] : [false]) {
          if (single && foes.length) for (const f of foes) raw.push({ type: 'move', id, z, target: { side: f.side, slot: f.slot } });
          else raw.push({ type: 'move', id, z });
        }
      }
      // quick score to keep the most promising
      const threatened = aiActs.some(a => a.type === 'move' && meta(a.id).cat !== 'X' && (!a.target || (a.target.side === side && a.target.slot === slot)));
      for (const x of raw) {
        const mm = meta(x.id), tg = (E.mv(x.id) || {}).tg || 0;
        if (mm.cat === 'X') {
          x.q = mm.eff === PROTECT_EFF ? (threatened && !me.protectStreak ? 0.35 : -0.2) : mm.eff === 172 ? 0.25 : mm.eff === 176 ? 0.2 : 0.05;
          continue;
        }
        const hits = tg === 8 || tg === 32 ? foes : foes.filter(f => x.target && f.slot === x.target.slot);
        const mul = hits.length > 1 ? 0.75 : 1;
        let q = 0;
        for (const f of hits) {
          const rr = E.rawRolls(specNow(me), specNow(f), x.id, Object.assign({ z: x.z, hits: mm.multihit ? 3 : 0 }, fieldOpts(st, f.side)));
          if (!rr || !rr.rolls.length) continue;
          const mean = mul * rr.rolls.reduce((a, b) => a + b, 0) / rr.rolls.length;
          q += Math.min(1, mean / f.hp) + (mul * rr.rolls[0] >= f.hp ? 0.6 : 0);
        }
        if (tg === 32) for (const ally of actives(st, side).filter(m => m !== me)) {
          const rr = E.rawRolls(specNow(me), specNow(ally), x.id, fieldOpts(st, side));
          if (rr && rr.rolls.length) q -= 1.5 * Math.min(1, 0.75 * rr.rolls[15] / ally.hp);
        }
        x.q = q * (mm.acc ? Math.min(100, mm.acc) / 100 : 1) - (x.z ? 0.15 : 0);
      }
      raw.sort((a, b) => b.q - a.q);
      const keep = raw.slice(0, o.keep);
      const prot = raw.find(x => meta(x.id).eff === PROTECT_EFF);
      if (prot && !keep.includes(prot)) keep.push(prot);
      // the best switch-ins
      const sw = canSwitch(st, me) ? bench(st, side).map(b => ({ type: 'switch', to: st[side].team.indexOf(b) })) : [];
      if (sw.length) {
        const pick = quickReplace(st, side);
        keep.push(sw.find(x => x.to === pick));
      }
      return keep.length ? keep : [{ type: 'move', id: usable(me, st)[0] }];
    }
    function valueOf(st, side) {
      let v = 0;
      for (const m of st[side].team) v += m.fainted ? -1.2 * value(m) : o.hpWeight * value(m) * m.hp / m.maxHp;
      for (const m of st[other(side)].team) v -= m.fainted ? -1 : o.hpWeight * m.hp / m.maxHp;
      return v;
    }
    function sig(st, side) {
      const parts = [st.weather || '', st.terrain || '', st.trickRoom ? 1 : 0, st.turn > 1 ? 1 : 0];
      for (const s of ['p', 'a']) {
        const t = st[s];
        parts.push(t.slots.join('.'), JSON.stringify(t.hazards), t.tailwind ? 1 : 0, t.screens.reflect ? 1 : 0, t.screens.light ? 1 : 0);
        for (const m of t.team) parts.push(m.fainted ? 'x' : [Math.round(20 * m.hp / m.maxHp), m.status, STATS5.map(k => m.boosts[k]).join(''), m.item || 0, m.charging || 0, m.lock || 0, m.firstTurn ? 1 : 0].join(':'));
      }
      return side + parts.join('|');
    }
    function decide(st, side) {
      const key = sig(st, side);
      if (memo.has(key)) return memo.get(key);
      const aiActs = st.policies[other(side)].chooseAll ? st.policies[other(side)].chooseAll(st, other(side), expectedDice(), true) : [];
      const slots = st[side].slots.map((idx, slot) => ({ slot, m: st[side].team[idx] })).filter(x => x.m && !x.m.fainted);
      const forced = x => x.m.charging || (x.m.rampage && x.m.lock) || x.m.recharge;
      const lists = slots.map(x => (forced(x) ? [{ type: 'move', id: usable(x.m, st)[0], target: x.m.chargeTarget ? { side: x.m.chargeTarget.side, slot: x.m.chargeTarget.slot } : undefined }] : optionsFor(st, side, x.slot, aiActs)));
      const combos = [];
      const rec = (k, acc) => {
        if (k === lists.length) { combos.push(acc.slice()); return; }
        for (const opt of lists[k]) {
          if (opt.type === 'switch' && acc.some(a => a.type === 'switch' && a.to === opt.to)) continue;
          if (opt.z && acc.some(a => a.z)) continue;
          acc.push(opt); rec(k + 1, acc); acc.pop();
        }
      };
      rec(0, []);
      const rng = expectedDice();
      let best = null, bestV = -1e9;
      const scored = [];
      for (const combo of combos) {
        const c = cloneState(st);
        c.policies = { [side]: fixed(combo), [other(side)]: fixed(aiActs) };
        playTurn(c, rng);
        const v = valueOf(c, side) - combo.filter(a => a.type === 'switch').length * 0.03 + 0.001 * combo.reduce((s, a) => s + (a.q || 0), 0);
        scored.push({ combo, v });
        if (v > bestV) { bestV = v; best = combo; }
      }
      scored.sort((x, y) => y.v - x.v);
      const out = { acts: best || [], alts: scored.slice(0, 3), ai: aiActs, base: valueOf(st, side) };
      memo.set(key, out);
      return out;
    }
    return {
      kind: 'doubles-planner',
      decide,
      chooseAll(st, side, rng) {
        const d = decide(st, side);
        return d.acts.map(a => Object.assign({}, a, { risk: 0, why: a.type === 'switch' ? 'plan' : undefined }));
      },
      choose(st, side, rng, explain, peek, slot) { return this.chooseAll(st, side, rng)[slot || 0] || { type: 'move', id: usable(act(st, side, slot || 0), st)[0] }; },
      replace(st, side) { return quickReplace(st, side); },
    };
  }

  // ---------------- the boss AI, ported from the engine (ai.js) ----------------
  const AI = (typeof createAI === 'function' ? createAI : require('./ai.js'))({
    E, meta, usable, act, other, bench, alive, speed, priorityOf, canStatus, hitChance, specNow, fieldOpts, itemName, hasType, grounded,
    hazardDamage, expectedDice, SETUP, EFFECT_BOOST, EFFECT_DROP, zKind, SELF_DROP, actives, canSwitch });
  function bossPolicy(opts) { return AI.policy(opts); }

  // ---------------- running battles ----------------
  /** The leads come out: the lead event, then entry effects with the faster Pokemon's ability first (so the slower one's weather wins). */
  function begin(st, rng) {
    const names = side => actives(st, side).map(m => m.name).join(' and ');
    st.events.push({ turn: 0, type: 'lead', p: act(st, 'p').key, a: act(st, 'a').key, pAll: actives(st, 'p').map(m => m.key), aAll: actives(st, 'a').map(m => m.key) });
    log(st, `You lead with ${names('p')}; the boss leads with ${names('a')}`, 'switch');
    for (const m of actives(st, 'p').concat(actives(st, 'a')).sort((x, y) => speed(st, y) - speed(st, x))) onEntry(st, m.side, rng, m.slot);
    return st;
  }
  function runBattle(playerSpecs, bossSpecs, opts) {
    const o = opts || {};
    const st = newBattle(playerSpecs, bossSpecs, o);
    const rng = o.expected ? expectedDice() : mulberry32(o.seed || 1);
    st.policies = { p: o.player || (st.size > 1 ? doublesPlanner(o.plannerOpts) : plannerPolicy(o.plannerOpts)), a: o.ai || bossPolicy() };
    begin(st, rng);
    while (!st.over && st.turn < (o.maxTurns || 80)) playTurn(st, rng);
    if (!st.over) { st.over = true; st.winner = 'timeout'; }
    return st;
  }

  /** One battle with real luck (damage rolls, crits, misses, the boss AI's own picks), recorded for the battle screen.
   *  mode 'bad': try new seeds (up to tries) for a battle where you lose a Pokemon or the fight, to watch what goes
   *  wrong. Returns the script, the seed (the next untried one when nothing was found) and how many were tried. */
  function sampleBattle(playerSpecs, bossSpecs, opts) {
    const o = opts || {};
    let seed = (o.seed >>> 0) || 1;
    const tries = o.mode === 'bad' ? (o.tries || 150) : 1;
    const base = { lead: o.lead, plannerOpts: o.plannerOpts, maxTurns: o.maxTurns || 60, doubles: o.doubles };
    for (let k = 0; k < tries; k++, seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) {
      if (o.mode === 'bad') {
        const st = runBattle(playerSpecs, bossSpecs, Object.assign({ seed }, base));
        if (st.winner === 'p' && !st.p.team.some(m => m.fainted)) continue;
      }
      const rec = runBattle(playerSpecs, bossSpecs, Object.assign({ seed, record: true }, base));
      return { script: scriptOf(rec), seed, tries: k + 1 };
    }
    return { script: null, seed, tries };
  }

  /** Many simulated battles of one lineup: odds and the most common losses. */
  function simulate(playerSpecs, bossSpecs, opts) {
    const o = Object.assign({ runs: 200, seed: 7 }, opts || {});
    const player = o.doubles ? doublesPlanner(o.plannerOpts) : plannerPolicy(o.plannerOpts);
    const res = { runs: 0, wins: 0, noLoss: 0, losses: 0, lossBy: {}, causes: {}, turns: 0, faced: {} };
    const pl = o.player || player;
    for (let i = 0; i < o.runs; i++) {
      const st = runBattle(playerSpecs, bossSpecs, Object.assign({}, o, { seed: o.seed * 7919 + i * 104729, player: pl }));
      res.runs++; res.turns += st.turn;
      if (st.winner === 'p') res.wins++;
      const lost = st.events.filter(e => e.type === 'faint' && e.side === 'p');
      if (!lost.length && st.winner === 'p') res.noLoss++;
      res.losses += lost.length;
      for (const e of st.events) {
        if (e.type !== 'decide' || !e.p) continue;
        const f = res.faced[e.am] || (res.faced[e.am] = {});
        const k = e.pm + '|' + (e.p.type === 'switch' ? 'switch:' + st.p.team[e.p.to].key : 'move:' + e.p.id);
        f[k] = (f[k] || 0) + 1;
      }
      for (const e of lost) {
        res.lossBy[e.key] = (res.lossBy[e.key] || 0) + 1;
        const k = `${e.name}: ${e.cause}`;
        res.causes[k] = (res.causes[k] || 0) + 1;
      }
    }
    res.pWin = res.wins / res.runs; res.pNoLoss = res.noLoss / res.runs; res.expLosses = res.losses / res.runs; res.avgTurns = res.turns / res.runs;
    return res;
  }

  const tick = () => new Promise(r => setTimeout(r, 0));
  /** Same as simulate(), but yields to the page every few battles and reports progress. */
  async function simulateAsync(playerSpecs, bossSpecs, opts, onBattle) {
    const o = Object.assign({ runs: 200, seed: 7, chunk: 6 }, opts || {});
    const total = { runs: 0, wins: 0, noLoss: 0, losses: 0, lossBy: {}, causes: {}, turns: 0, faced: {} };
    const player = o.doubles ? doublesPlanner(o.plannerOpts) : plannerPolicy(o.plannerOpts);
    for (let i = 0; i < o.runs; i += o.chunk) {
      const n = Math.min(o.chunk, o.runs - i);
      const r = simulate(playerSpecs, bossSpecs, Object.assign({}, o, { runs: n, seed: o.seed + i * 31, player }));
      total.runs += r.runs; total.wins += r.wins; total.noLoss += r.noLoss; total.losses += r.losses; total.turns += r.turns;
      for (const k in r.lossBy) total.lossBy[k] = (total.lossBy[k] || 0) + r.lossBy[k];
      for (const k in r.causes) total.causes[k] = (total.causes[k] || 0) + r.causes[k];
      for (const a in r.faced) { const f = total.faced[a] || (total.faced[a] = {}); for (const k in r.faced[a]) f[k] = (f[k] || 0) + r.faced[a][k]; }
      if (onBattle) onBattle(n);
      await tick();
    }
    total.pWin = total.wins / total.runs; total.pNoLoss = total.noLoss / total.runs; total.expLosses = total.losses / total.runs; total.avgTurns = total.turns / total.runs;
    return total;
  }
  const better = (x, y) => (x.pNoLoss - y.pNoLoss) || (y.expLosses - x.expLosses) || (x.pWin - y.pWin);

  /** Pick six and a lead for one boss, then simulate the plan.
   *  roster: player specs (alive Pokemon, each with key and label). bossSpecs: boss specs in party order.
   *  onProgress(fraction, text) is called as work proceeds.
   *  setup(specsOfSix): optional; once the six are picked it may hand back their held items and natures for this fight
   *  ({ specs, info, changed }): the lead, the odds and the script then use them, and baseOdds keeps the six as they were. */
  async function planFight(roster, bossSpecs, opts) {
    const o = Object.assign({ screenRuns: 16, leadRuns: 30, finalRuns: 200, seed: 11 }, opts || {});
    const progress = o.onProgress || (() => {});
    const plannerOpts = o.plannerOpts;
    const VSP = { safe: 3, ok: 2, risky: 1, lose: 0 };
    const rowOf = r => bossSpecs.map(b => E.matchup(Object.assign({}, r, { entry: true }), Object.assign({}, b, { entry: true })));
    // analytic pre-ranking: how each Pokemon fares against each boss Pokemon
    const grid = roster.map(rowOf);
    const score = i => grid[i].reduce((s, m) => s + VSP[m.verdict] - m.risk, 0);
    let candidates;
    if (roster.length <= 6) candidates = [roster.map((_, i) => i)];
    else {
      // greedy cover of the boss team, then single swaps with the strongest bench Pokemon
      const chosen = [];
      const covered = bossSpecs.map(() => 0);
      while (chosen.length < 6) {
        let bi = -1, bg = -1;
        roster.forEach((r, i) => {
          if (chosen.includes(i)) return;
          const g = grid[i].reduce((s, m, j) => s + Math.max(0, VSP[m.verdict] - covered[j]) * 10 + (1 - m.risk), 0);
          if (g > bg) { bg = g; bi = i; }
        });
        chosen.push(bi);
        bossSpecs.forEach((b, j) => { covered[j] = Math.max(covered[j], VSP[grid[bi][j].verdict]); });
      }
      const rest = roster.map((_, i) => i).filter(i => !chosen.includes(i)).sort((a, b) => score(b) - score(a)).slice(0, 2);
      candidates = [chosen.slice()];
      for (const r of rest) for (let k = 0; k < 6; k++) { const c = chosen.slice(); c[k] = r; candidates.push(c); }
    }
    const doubles = !!o.doubles;
    // the six's specs and matchups: as they are, or with the setup once it's chosen
    let specOfIdx = i => roster[i], rowIdx = i => grid[i];
    // how well each Pokemon does against the boss's lead (two leads in doubles)
    const vsLeads = i => (doubles ? [0, 1] : [0]).filter(j => rowIdx(i)[j]).reduce((sum, j) => sum + VSP[rowIdx(i)[j].verdict] - rowIdx(i)[j].risk, 0);
    const byLead = (a, b) => (rowIdx(a)[0].risk - rowIdx(b)[0].risk) || (rowIdx(b)[0].hpLeftPct - rowIdx(a)[0].hpLeftPct);
    const leadGuess = idxs => {
      const ranked = idxs.slice().sort((a, b) => doubles ? vsLeads(b) - vsLeads(a) : byLead(a, b));
      return doubles ? ranked.slice(0, 2) : ranked[0];
    };
    const screening = candidates.length > 1 ? candidates.length * o.screenRuns : 0;
    let total = screening + 3 * o.leadRuns + o.finalRuns * (o.setup ? 2 : 1);
    let done = 0, phase = 'Picking your six';
    const evalLineup = async (idxs, lead, runs, specFn) => {
      const specs = idxs.map(specFn || specOfIdx);
      return simulateAsync(specs, bossSpecs, { runs, seed: o.seed, lead: doubles ? lead.map(l => idxs.indexOf(l)) : idxs.indexOf(lead), plannerOpts, doubles },
        n => { done += n; progress(Math.min(1, done / total), `${phase}: ${done} of ${total} battles simulated`); });
    };
    // 1) screen lineups (nothing to screen when there's only one)
    let best = { idxs: candidates[0], res: null };
    if (candidates.length > 1) {
      best = null;
      for (const c of candidates) {
        const r = await evalLineup(c, leadGuess(c), o.screenRuns);
        if (!best || better(r, best.res) > 0) best = { idxs: c, res: r };
      }
    }
    // 2) held items and natures for these six, if the caller works them out
    let setup = null;
    if (o.setup) {
      phase = 'Choosing held items and natures';
      progress(Math.min(1, done / total), phase + '…');
      const r = await o.setup(best.idxs.map(i => roster[i]));
      if (r && r.changed && r.specs && r.specs.length === best.idxs.length) {
        const bySix = new Map(best.idxs.map((i, k) => [i, r.specs[k]]));
        const rows = new Map(best.idxs.map((i, k) => [i, rowOf(r.specs[k])]));
        specOfIdx = i => bySix.get(i) || roster[i];
        rowIdx = i => rows.get(i) || grid[i];
        setup = r.info || null;
      } else {
        if (r) setup = r.info || null;
        total -= o.finalRuns;   // no second check needed
      }
    }
    const changed = best.idxs.some(i => specOfIdx(i) !== roster[i]);
    // 3) choose the lead among the three best analytic leads
    phase = 'Choosing your lead';
    let leads = best.idxs.slice().sort(byLead).slice(0, 3);
    if (doubles) {
      // lead pairs from the four best against their leads
      const top = best.idxs.slice().sort((a, b) => vsLeads(b) - vsLeads(a)).slice(0, 4);
      const pairs = [];
      for (let x = 0; x < top.length; x++) for (let y = x + 1; y < top.length; y++) pairs.push([top[x], top[y]]);
      leads = pairs.sort((p1, p2) => (vsLeads(p2[0]) + vsLeads(p2[1])) - (vsLeads(p1[0]) + vsLeads(p1[1]))).slice(0, 3);
      if (!leads.length) leads = [top.slice(0, 2)];
    }
    let bestLead = null;
    for (const l of leads) {
      const r = await evalLineup(best.idxs, l, o.leadRuns);
      if (!bestLead || better(r, bestLead.res) > 0) bestLead = { lead: l, res: r };
    }
    // 4) final odds with more battles; with a setup, the same battles with the six as they were too
    phase = 'Final odds';
    const final = await evalLineup(best.idxs, bestLead.lead, o.finalRuns);
    let baseOdds = null;
    if (changed) { phase = 'Comparing with your Pokémon as they are'; baseOdds = await evalLineup(best.idxs, bestLead.lead, o.finalRuns, i => roster[i]); }
    // 5) the most likely run, turn by turn
    const specs = best.idxs.map(specOfIdx);
    const scriptState = runBattle(specs, bossSpecs, { expected: true, record: true, lead: doubles ? bestLead.lead.map(l => best.idxs.indexOf(l)) : best.idxs.indexOf(bestLead.lead), plannerOpts, maxTurns: 60, doubles });
    progress(1, 'Done');
    return { lineup: best.idxs, lead: bestLead.lead, doubles, odds: final, baseOdds, setup, script: scriptOf(scriptState), grid };
  }

  /** Turn the recorded "most likely" battle into steps a player can follow. */
  function scriptOf(st) {
    const turns = [];
    let cur = null;
    const name = (side, key) => { const m = st[side].team.find(x => x.key === key); return m ? m.name : key; };
    for (const l of st.log) {
      if (!cur || cur.turn !== l.turn) { cur = { turn: l.turn, lines: [], decision: null }; turns.push(cur); }
      cur.lines.push(l);
    }
    for (const e of st.events) {
      if (e.type !== 'decide') continue;
      const t = turns.find(x => x.turn === e.turn);
      if (!t) continue;
      if (!e.p) {
        // doubles: both of your actions, with targets
        const mine = e.acts.filter(x => x.side === 'p'), theirs = e.acts.filter(x => x.side === 'a');
        const who = x => name(x.side, x.key);
        const what = x => (x.a.type === 'switch' ? `switch to ${st.p.team[x.a.to].name}` : `${x.a.z ? 'Z-' : ''}${meta(x.a.id).name}${x.tkey && x.a.target.side === 'a' && (E.mv(x.a.id) || {}).tg === 0 ? ' on ' + name('a', x.tkey) : ''}`);
        t.decision = { you: mine.map(who).join(' & '), foe: theirs.map(who).join(' & '), action: mine.map(x => `${who(x)}: ${what(x)}`).join(' · '),
          lines: mine.map(x => `${who(x)}: ${what(x)}`), risk: 0, alts: null, youHp: mine.reduce((a, x) => a + x.hp, 0) / Math.max(1, mine.length), foeHp: theirs.reduce((a, x) => a + x.hp, 0) / Math.max(1, theirs.length) };
        continue;
      }
      let action = e.p.type === 'switch' ? `Switch to ${st.p.team[e.p.to].name}` : `Use ${e.p.z ? 'Z-' : ''}${meta(e.p.id).name}${e.p.z ? ' (your Z-Move)' : ''}`;
      const lk = e.plk;
      if (e.p.type === 'move' && lk && lk.kind !== 'recharge' && lk.kind !== 'charging') action = `${meta(e.p.id).name} again: locked in${lk.kind === 'rollout' ? ` (hit ${lk.hit + 1} of 5)` : ''}`;
      else if (e.p.type === 'move' && !e.p.z && LOCKS_IN(meta(e.p.id))) action += ' (it locks you in)';
      t.decision = { you: name('p', e.pm), foe: name('a', e.am), action, risk: e.p.risk, alts: e.p.alts, youHp: e.php, foeHp: e.ahp };
    }
    const faints = st.events.filter(e => e.type === 'faint' && e.side === 'p').map(e => {
      const t = turns.find(x => x.turn === e.turn);
      const planned = t && t.decision && t.decision.risk >= 0.5 && t.decision.you === e.name;
      if (planned) t.sacrifice = e.name;
      return { turn: e.turn, name: e.name, cause: e.cause, planned };
    });
    // who you send out, in order (your lead first), and which of theirs each one takes on in this line
    const order = [], faces = {};
    const seen = k => { if (k != null && !order.includes(k)) order.push(k); };
    for (const e of st.events) {
      if (e.type === 'lead') (e.pAll || [e.p]).forEach(seen);
      else if (e.type === 'switch' && e.side === 'p') seen(e.to);
      else if (e.type === 'decide') {
        const theirs = e.acts.filter(x => x.side === 'a');
        for (const x of e.acts) {
          if (x.side !== 'p' || !x.a || x.a.type === 'switch') continue;
          const f = faces[x.key] || (faces[x.key] = []);
          for (const y of theirs) { const nm = name('a', y.key); if (!f.includes(nm)) f.push(nm); }
        }
      }
    }
    return { winner: st.winner, turns, faints, totalTurns: st.turn, order, faces };
  }

  return { meta, snapshot, sampleBattle, makeMon, newBattle, runBattle, simulate, simulateAsync, planFight, scriptOf, plannerPolicy, doublesPlanner, aiPolicy, bossPolicy, AI, megaTarget, heldForm, zKind, usable, actives, cloneState, playTurn, begin, switchIn, speed, priorityOf, mayCause, statusEffect, statusRisk, hitChance, mulberry32, expectedDice, specNow, act, canSwitch, lockInfo, cancelLock, LOCK_WORDS };
});
