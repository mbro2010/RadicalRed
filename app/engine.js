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
  const HP_SENSITIVE_MV = /^(Eruption|Water Spout|Dragon Energy|Flail|Reversal|Brine|Wring Out|Crush Grip|Hard Press|Final Gambit|Endeavor)$/;
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
  function hpPart(spec, mode) {
    const pct = spec.hpPct == null ? 100 : spec.hpPct;
    if (mode === 'roll') {
      if (PINCH.has(spec.ab)) return pct <= 100 / 3 ? 'L' : 'H';
      if (FULL_HP.has(spec.ab)) return pct >= 100 ? 'F' : 'D';
      if (HP_SENSITIVE_AB.has(spec.ab)) return pct <= 50 ? 'L' : 'H';
      return '';
    }
    return Math.round(pct / 2);
  }
  function specKeyRaw(spec, hpRelevant) {
    const b = spec.boosts || {};
    return [spec.s, spec.lv, spec.nat, spec.ab, spec.it || 0, spec.iv ? spec.iv.join('.') : '', b.atk || 0, b.def || 0, b.spa || 0, b.spd || 0, b.spe || 0,
      spec.status || (spec.st ? STATUS_CODE[spec.st] : ''), spec.firstTurn ? 1 : 0, spec.entry === false ? 0 : 1,
      hpRelevant ? hpPart(spec, hpRelevant) : ''].join(',');
  }
  const HP_TYPES = ['Fighting', 'Flying', 'Poison', 'Ground', 'Rock', 'Bug', 'Ghost', 'Steel', 'Fire', 'Water', 'Grass', 'Electric', 'Psychic', 'Ice', 'Dragon', 'Dark'];
  /** Hidden Power's type from IVs (order hp, atk, def, spa, spd, spe). Perfect IVs give Dark. */
  function hiddenPowerType(iv) {
    const v = iv || [31, 31, 31, 31, 31, 31];
    const bits = [v[0] & 1, v[1] & 1, v[2] & 1, v[5] & 1, v[3] & 1, v[4] & 1];
    return HP_TYPES[Math.floor(bits.reduce((s, x, i) => s + (x << i), 0) * 15 / 63)];
  }

  function sp(id) { return species.get(id); }
  function mv(id) { return moves.get(id); }
  function itemName(id) { return id && D.items[id] ? D.items[id].n : null; }
  function natureName(i) { return D.natures[i] ? D.natures[i].n : 'Hardy'; }
  function abilityInfo(name) { return (name && D.abilities[name]) || { c: null, d: '' }; }

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
    STAT.forEach((k, i) => { ivs[k] = spec.iv ? spec.iv[i] : 31; evs[k] = 0; });
    const boosts = Object.assign({}, spec.boosts || {});
    if (spec.ab === 'Valiant Shield' && spec.entry !== false) boosts.def = Math.min(6, (boosts.def || 0) + 1);
    const opts = {
      level: spec.lv, nature: natureName(spec.nat), ability: ab.c || 'No Ability', ivs, evs, boosts,
      status: spec.status || (spec.st ? STATUS_CODE[spec.st] || '' : ''),
      overrides: { baseStats: Object.fromEntries(STAT.map((k, i) => [k, s.s[i]])), types: s.t, weightkg: s.w },
    };
    if (item) opts.item = item;
    const p = new C.Pokemon(gen, s.c || 'Mew', opts);
    if (STAT_MULT[spec.ab]) {
      p._mult = STAT_MULT[spec.ab];
      for (const k in p._mult) { p.rawStats[k] = Math.floor(p.rawStats[k] * p._mult[k]); p.stats[k] = p.rawStats[k]; }
    }
    if (spec.hpPct != null && spec.hpPct < 100) p.originalCurHP = Math.max(1, Math.round(p.maxHP() * spec.hpPct / 100));
    return p;
  }

  function buildMove(id, attackerSpec, { maxHits = false, crit = false, z = false } = {}) {
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
      ds ? [ds.isReflect ? 1 : 0, ds.isLightScreen ? 1 : 0, ds.isAuroraVeil ? 1 : 0].join('') : '', o.crit ? 1 : 0, o.hits || 0, o.z ? 'Z' : ''].join('|');
    return memo(key, () => {
      const att = buildMon(attSpec), def = buildMon(defSpec);
      const move = buildMove(moveId, attSpec, { crit: !!o.crit, maxHits: o.maxHits, z: !!o.z });
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

  function rollsOf(result) {
    const d = result.damage;
    if (typeof d === 'number') return [d];
    if (Array.isArray(d) && Array.isArray(d[0])) return d[0].map((_, i) => d.reduce((s, hit) => s + hit[i], 0));  // multi-hit: per-roll totals
    return d;
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
    return {
      move: m, moveName: m.f, type: r.type, eff: r.eff, hp, cur,
      min, max, minPct: 100 * min / hp, maxPct: 100 * max / hp,
      critMax: Math.max(...rc.rolls), critMaxPct: 100 * Math.max(...rc.rolls) / hp,
      hits: r.hits, acc: m.a, priority: r.priority,
      ko: { text, n: min >= cur ? 1 : n, chance: koAll }, sashed, notes,
      critChance: ALWAYS_CRIT.has(m.f) ? 1 : HIGH_CRIT.has(m.f) ? 0.125 : 1 / 24,
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
    const acc = m.a === 0 || attSpec.ab === 'No Guard' || defSpec.ab === 'No Guard' ? 1 : Math.min(1, m.a / 100);
    const pc = ALWAYS_CRIT.has(m.f) ? 1 : HIGH_CRIT.has(m.f) ? 0.125 : 1 / 24;
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

  function speedOf(spec, weather) {
    let s = rawStats(spec).spe;
    const b = (spec.boosts && spec.boosts.spe) || 0;
    s = Math.floor(s * (b >= 0 ? (2 + b) / 2 : 2 / (2 - b)));
    const item = itemName(spec.it);
    if (item === 'Choice Scarf') s = Math.floor(s * 1.5);
    if (item === 'Iron Ball') s = Math.floor(s / 2);
    const a = spec.ab;
    const w = weather || '';
    if ((a === 'Swift Swim' && /Rain/.test(w)) || (a === 'Chlorophyll' && /Sun/.test(w)) || (a === 'Sand Rush' && w === 'Sand') || (a === 'Slush Rush' && /Snow|Hail/.test(w))) s *= 2;
    if (a === 'Bull Rush' && spec.firstTurn) s = Math.floor(s * 1.5);
    const status = spec.status || (spec.st ? STATUS_CODE[spec.st] : '');
    if (a === 'Quick Feet' && status) s = Math.floor(s * 1.5);
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
    const best = myHits.slice().sort((a, b) => (b.min - a.min) || (b.acc - a.acc))[0] || null;
    const threat = theirHits.slice().sort((a, b) => (b.max - a.max))[0] || null;
    const myHP = maxHP(me) * (me.hpPct != null ? me.hpPct / 100 : 1);
    const theirHP = (best ? best.cur : maxHP(them));
    let toKOthem = best && best.min > 0 ? Math.ceil(theirHP / best.min) : Infinity;
    if (best && best.sashed && toKOthem === 1) toKOthem = 2;
    const theirMax = threat ? threat.max : 0;
    let toKOme = theirMax > 0 ? Math.ceil(myHP / theirMax) : Infinity;
    const meFirst = best && threat ? (best.priority > threat.priority || (best.priority === threat.priority && mySpeed > theirSpeed)) : mySpeed > theirSpeed;
    const win = meFirst ? toKOthem <= toKOme : toKOthem < toKOme;
    const hitsTaken = !isFinite(toKOthem) ? Infinity : (meFirst ? toKOthem - 1 : toKOthem);
    const dmgTaken = hitsTaken === Infinity ? Infinity : hitsTaken * theirMax;
    const critTaken = hitsTaken === Infinity ? Infinity : (hitsTaken > 0 && threat ? threat.critMax + (hitsTaken - 1) * theirMax : 0);
    // chance of losing my Pokemon before it wins: their best move every turn, all rolls, hit counts, crits, accuracy
    let risk = 1;
    const hpInt = Math.max(1, Math.round(myHP));
    if (best && isFinite(toKOthem) && threat) {
      const dist = damageDist(them, me, threat.move.i, weather, hpInt);
      risk = faintChance(dist, hpInt, hitsTaken);
      const myAcc = best.acc === 0 ? 1 : Math.min(1, best.acc / 100);
      if (myAcc < 1) {                                  // one miss gives them one more attack
        const pMiss = 1 - Math.pow(myAcc, toKOthem);
        risk = risk + pMiss * (faintChance(dist, hpInt, hitsTaken + 1) - risk);
      }
    } else if (best && isFinite(toKOthem) && !threat) risk = 0;
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
      lv: m.lv != null ? m.lv : Math.max(1, Math.min(100, (playerTop || b.cap) + m.rel)),
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

  return { C, gen, D, sp, mv, itemName, natureName, abilityInfo, buildMon, damage, damageDist, faintChance, speedOf, matchup,
    bossTeam, planBoss, teamWeather, learnable, upcoming, isBanned, suggestMoves, maxHP, rawStats, rawRolls, typeEff, hiddenPowerType,
    STATUS_CODE, WEATHER_SETTERS, HIGH_CRIT, ALWAYS_CRIT, STAT_MULT, clearCache: () => cache.clear() };
});
