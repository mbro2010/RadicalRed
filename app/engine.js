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

  function buildMove(id, attackerSpec, { maxHits = false, crit = false } = {}) {
    const m = mv(id);
    const opts = { isCrit: crit };
    let name = m.c;
    const overrides = {};
    if (!name) {                                   // Radical Red's own move: a neutral stand-in with its real numbers
      name = m.k === 'P' ? 'Tackle' : m.k === 'S' ? 'Swift' : 'Growl';
      Object.assign(overrides, { basePower: m.p, type: m.t, category: { P: 'Physical', S: 'Special', X: 'Status' }[m.k], priority: m.r });
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
    return new C.Field(Object.assign(f, extra || {}));
  }

  function rollsOf(result) {
    const d = result.damage;
    if (typeof d === 'number') return [d];
    if (Array.isArray(d) && Array.isArray(d[0])) return d[0].map((_, i) => d.reduce((s, hit) => s + hit[i], 0));  // multi-hit: per-roll totals
    return d;
  }

  /** Damage of one move. Returns HP numbers and percentages of the defender's max HP. */
  function damage(attSpec, defSpec, moveId, { weather = null, worst = false } = {}) {
    const m = mv(moveId);
    if (!m || m.k === 'X') return null;
    const notes = [];
    const att = buildMon(attSpec), def = buildMon(defSpec);
    const field = fieldFor(weather);
    const move = buildMove(moveId, attSpec, { maxHits: worst });
    let res = C.calculate(gen, att, def, move, field);
    let rolls = rollsOf(res).slice();
    const critRes = C.calculate(gen, buildMon(attSpec), buildMon(defSpec), buildMove(moveId, attSpec, { maxHits: worst, crit: true }), field);
    let critRolls = rollsOf(critRes).slice();
    const moveType = move.type;
    const eff = typeEff(moveType, sp(defSpec.s).t);
    // Radical Red custom abilities that change damage (from their in-game descriptions)
    const scale = f => { rolls = rolls.map(x => Math.floor(x * f)); critRolls = critRolls.map(x => Math.floor(x * f)); };
    if (attSpec.ab === 'Striker' && KICK.test(m.f)) { scale(1.3); notes.push('Striker: kicking move ×1.3'); }
    if (attSpec.ab === 'Fatal Precision' && eff > 1) { scale(1.2); notes.push('Fatal Precision: super-effective ×1.2, never misses'); }
    if (attSpec.ab === 'ORAORAORAORA!' && move.flags && move.flags.punch) { scale(1.5); notes.push('ORAORAORAORA!: punches hit again for 50%'); }
    if (attSpec.ab === 'Bull Rush' && attSpec.firstTurn) { scale(1.2); notes.push('Bull Rush: first turn ×1.2'); }
    if (defSpec.ab === 'Primal Armor' && eff > 1) { scale(0.5); notes.push('Primal Armor: super-effective ×0.5'); }
    if (attSpec.ab === 'Bone Zone' && BONE.test(m.f) && eff < 1) {
      const stab = sp(attSpec.s).t.includes(moveType) ? 1.5 : 1;
      const neutral = C.calculate(gen, buildMon(attSpec), buildMon(defSpec), new C.Move(gen, move.name, { overrides: { type: '???' }, hits: move.hits }), field);
      rolls = rollsOf(neutral).map(x => Math.floor(x * stab));
      notes.push('Bone Zone: ignores resistances and immunities (approx.)');
    }
    if (STAT_MULT[attSpec.ab] && m.k === 'S') notes.push(`${attSpec.ab}: Sp. Atk ×${STAT_MULT[attSpec.ab].spa}`);
    if (!m.c) notes.push('Radical Red move: damage from its type and power; extra effects not modeled');
    for (const [who, a] of [['attacker', attSpec.ab], ['defender', defSpec.ab]]) {
      const info = abilityInfo(a);
      if (info.x && !['Striker', 'Fatal Precision', 'ORAORAORAORA!', 'Bull Rush', 'Primal Armor', 'Bone Zone', 'Feline Prowess', 'Sage Power', 'Valiant Shield'].includes(a))
        notes.push(`${a} (${who}): ${info.d} Not modeled.`);
    }
    const hp = def.maxHP();
    const cur = def.originalCurHP || hp;
    const min = Math.min(...rolls), max = Math.max(...rolls);
    let ko = { chance: 0, n: 0, text: '' };
    try { ko = res.kochance(); } catch (e) { /* calc can't describe some moves */ }
    // if a custom modifier changed damage, recompute the simple KO picture ourselves
    const scaled = notes.some(n => /×|Bone Zone/.test(n));
    const ohkoGuaranteed = min >= cur;
    const sashed = cur === hp && (def.item === 'Focus Sash' || def.ability === 'Sturdy') && max >= cur;
    return {
      move: m, moveName: m.f, type: moveType, eff, hp, cur,
      min, max, minPct: 100 * min / hp, maxPct: 100 * max / hp,
      critMax: Math.max(...critRolls), critMaxPct: 100 * Math.max(...critRolls) / hp,
      hits: move.hits || 1, acc: m.a, priority: move.priority || 0,
      ko: scaled ? { text: ohkoGuaranteed ? 'guaranteed OHKO' : '', n: ohkoGuaranteed ? 1 : 0, chance: ohkoGuaranteed ? 1 : 0 } : ko,
      sashed, notes,
      critChance: ALWAYS_CRIT.has(m.f) ? 1 : HIGH_CRIT.has(m.f) ? 0.125 : 1 / 24,
    };
  }

  // ---- probabilities: damage distribution of one attack, and the chance of fainting ----
  const HIT_DIST = { 2: 0.35, 3: 0.35, 4: 0.15, 5: 0.15 };
  /** Probability mass over damage dealt by one use of a move (capped at cap), including
   *  hit counts, all 16 rolls, crits and accuracy. Returns Float64Array of length cap+1. */
  function damageDist(attSpec, defSpec, moveId, weather, cap) {
    const m = mv(moveId);
    const dist = new Float64Array(cap + 1);
    if (!m || m.k === 'X') { dist[0] = 1; return dist; }
    const base = m.c ? gen.moves.get(toID(m.c)) : null;
    let hitsDist = { 1: 1 };
    if (base && Array.isArray(base.multihit)) {
      const [lo, hi] = base.multihit;
      if (attSpec.ab === 'Skill Link') hitsDist = { [hi]: 1 };
      else if (itemName(attSpec.it) === 'Loaded Dice') hitsDist = { 4: 0.5, 5: 0.5 };
      else if (lo === 2 && hi === 5) hitsDist = HIT_DIST;
      else hitsDist = { [hi]: 1 };
    }
    const acc = m.a === 0 || attSpec.ab === 'No Guard' || defSpec.ab === 'No Guard' ? 1 : Math.min(1, m.a / 100);
    const one = damage(attSpec, defSpec, moveId, { weather });
    const pc = one ? one.critChance : 1 / 24;
    for (const [h, ph] of Object.entries(hitsDist)) {
      for (const crit of [false, true]) {
        const p = ph * (crit ? pc : 1 - pc) * acc;
        if (p <= 0) continue;
        const att = buildMon(attSpec), def = buildMon(defSpec);
        const mvObj = buildMove(moveId, attSpec, { crit });
        if (base && Array.isArray(base.multihit)) mvObj.hits = +h;
        let rolls;
        try { rolls = rollsOf(C.calculate(gen, att, def, mvObj, fieldFor(weather))); } catch (e) { rolls = [0]; }
        if (one && one.max > 0) {                       // apply the same custom-ability scaling as damage()
          const raw = rollsOf(C.calculate(gen, buildMon(attSpec), buildMon(defSpec), buildMove(moveId, attSpec, {}), fieldFor(weather)));
          const f = Math.max(...raw) > 0 ? one.max / Math.max(...raw) : 1;
          if (Math.abs(f - 1) > 0.01 && !crit && +h === (one.hits || 1)) rolls = rolls.map(x => Math.floor(x * f));
        }
        for (const r of rolls) dist[Math.min(cap, r)] += p / rolls.length;
      }
    }
    dist[0] += 1 - acc;
    return dist;
  }
  /** Chance that n attacks drawn from dist add up to at least hp. */
  function faintChance(dist, hp, n) {
    if (n <= 0) return 0;
    let cur = new Float64Array(hp + 1); cur[0] = 1;
    for (let k = 0; k < n; k++) {
      const next = new Float64Array(hp + 1);
      for (let a = 0; a <= hp; a++) {
        if (!cur[a]) continue;
        if (a >= hp) { next[hp] += cur[a]; continue; }
        for (let d = 0; d < dist.length; d++) if (dist[d]) next[Math.min(hp, a + d)] += cur[a] * dist[d];
      }
      cur = next;
    }
    return cur[hp];
  }

  function speedOf(spec, weather) {
    const p = buildMon(spec);
    let s = p.rawStats.spe;
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

  function maxHP(spec) { return buildMon(spec).maxHP(); }

  /** One-on-one outlook between my Pokemon and theirs (both at the HP given in the specs). */
  /** entry: true (default) = both Pokemon have just come in (Intimidate, first-turn effects apply);
   *  false = a battle already in progress, boosts as given. */
  function matchup(mine, theirs, { weather: forced, entry = true } = {}) {
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

  return { gen, D, sp, mv, itemName, natureName, abilityInfo, buildMon, damage, damageDist, faintChance, speedOf, matchup,
    bossTeam, planBoss, teamWeather, learnable, upcoming, isBanned, suggestMoves, maxHP, typeEff, STATUS_CODE, WEATHER_SETTERS };
});
