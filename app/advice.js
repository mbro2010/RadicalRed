/* Per-Pokemon advice: which nature to set (Radical Red has a free Nature Change service) and
 * when to learn which move, using exact level-up levels from the ROM and only TMs the player owns. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.createAdvice = factory;
})(typeof self !== 'undefined' ? self : this, function createAdvice(E, SIM) {
  'use strict';
  const D = E.D;
  const VS = { safe: 3, ok: 2, risky: 1, lose: 0 };
  const OPT = { tutors: false };   // count move tutor moves as available (you still have to reach the tutor)
  function setOptions(o) { Object.assign(OPT, o || {}); }
  const CANDIDATE_NATURES = ['Adamant', 'Jolly', 'Modest', 'Timid', 'Bold', 'Impish', 'Calm', 'Careful', 'Brave', 'Quiet', 'Hasty', 'Naive', 'Hardy']
    .map(n => D.natures.findIndex(x => x.n === n)).filter(i => i >= 0);

  /** Boss fights ahead that move the level cap (gyms, rival, admins, Elite Four), starting at fromIndex. */
  function upcomingMajor(fromIndex, count) {
    const out = [];
    for (let i = Math.max(0, fromIndex); i < D.bosses.length && out.length < count; i++) {
      const b = D.bosses[i];
      if (b.ms || b.cat === 'gym' || b.cat === 'e4') out.push(i);
    }
    return out;
  }

  /** Moves available at `level`: level-up moves up to that level, owned TMs, and what it already knows. */
  function available(spec, level, ownedTMs) {
    const L = D.learn[spec.s];
    const s = E.sp(spec.s);
    const out = new Map();
    if (L) {
      for (const [lv, id] of L.l) if (lv <= level && E.mv(id) && !E.isBanned(id, s.g)) out.set(id, { id, how: lv === 0 ? 'on evolution' : `Lv ${lv}`, lv });
      for (const t of L.t) {
        if (!ownedTMs || !ownedTMs.includes(t)) continue;
        const id = D.tms[t];
        if (E.mv(id) && !out.has(id) && !E.isBanned(id, s.g)) out.set(id, { id, how: t < 120 ? `TM${String(t + 1).padStart(2, '0')}` : `HM${String(t - 119).padStart(2, '0')}`, tm: t });
      }
    }
    if (L && L.u && OPT.tutors) for (const id of L.u) if (E.mv(id) && !out.has(id) && !E.isBanned(id, s.g)) out.set(id, { id, how: 'Move Tutor', tutor: true });
    for (const id of spec.mv || []) if (!out.has(id) && E.mv(id)) out.set(id, { id, how: 'knows it' });
    return [...out.values()];
  }

  const clampB = v => Math.max(-6, Math.min(6, v));
  const STATUS_IMMUNE = { par: ['Electric'], brn: ['Fire'], psn: ['Poison', 'Steel'], tox: ['Poison', 'Steel'], frz: ['Ice'] };
  const verdictOf = r => (r <= 1e-9 ? 'safe' : r <= 0.05 ? 'ok' : r <= 0.35 ? 'risky' : 'lose');
  /** One on one against `foe`: attack straight away, or first use one of its status or stat moves (taking one free hit
   *  for it: sleep, paralysis, a burn, confusion, raising its own stats or lowering theirs), then attack. The plan with
   *  the least risk: { score, verdict, risk, via (the move used first, or null) }. */
  function duelPlan(spec, foe, mv, opts) {
    const me = Object.assign({}, spec, { mv });
    const base = E.matchup(me, foe, opts);
    const best = { score: VS[base.verdict] - base.risk, verdict: base.verdict, risk: base.risk, via: null };
    if (!SIM || !SIM.statusEffect) return best;
    const t = base.threat, hp = E.maxHP(me);
    const hitPct = t ? 100 * (t.min + t.max) / 2 / hp : 0;
    const pFaint = !t ? 0 : t.min >= hp ? 1 : t.max >= hp ? (t.max - hp + 1) / Math.max(1, t.max - t.min + 1) : 0;
    const foeTypes = (E.sp(foe.s) || {}).t || [];
    for (const id of mv) {
      const fx = SIM.statusEffect(id), m = E.mv(id);
      if (!fx || fx.heal) continue;
      if (fx.status && (foe.status || (STATUS_IMMUNE[fx.status] || []).some(x => foeTypes.includes(x)) || E.typeEff(m.t, foeTypes) === 0)) continue;
      if (fx.status === 'slp' && ['Insomnia', 'Vital Spirit', 'Sweet Veil', 'Comatose'].includes(foe.ab)) continue;
      const me2 = Object.assign({}, me, { hpPct: Math.max(1, 100 - hitPct), boosts: Object.assign({}, me.boosts), entry: false });
      const foe2 = Object.assign({}, foe, { boosts: Object.assign({}, foe.boosts), entry: false });
      if (fx.self) for (const [k, v] of Object.entries(fx.self)) me2.boosts[k] = clampB((me2.boosts[k] || 0) + v);
      if (fx.foe && !['Clear Body', 'White Smoke', 'Full Metal Body'].includes(foe.ab)) for (const [k, v] of Object.entries(fx.foe)) foe2.boosts[k] = clampB((foe2.boosts[k] || 0) + v);
      if (fx.status) foe2.status = fx.status;
      const mu = E.matchup(me2, foe2, Object.assign({}, opts, { entry: false }));
      if (!mu.best || !isFinite(mu.toKOthem)) continue;   // still no way to knock it out: nothing gained
      let r = pFaint + (1 - pFaint) * SIM.statusRisk(mu, fx.status || (fx.conf ? 'conf' : ''));
      r = r * fx.acc + (1 - fx.acc) * Math.min(1, pFaint * 2 + base.risk);   // a miss is a hit taken for nothing
      const verdict = verdictOf(r);
      const score = VS[verdict] - r;
      if (score > best.score + 0.05) Object.assign(best, { score, verdict, risk: r, via: id });
    }
    return best;
  }
  /** A whole moveset against a boss team: each of their Pokemon handled the best way it can (see duelPlan). */
  function setValue(spec, team, mv) {
    let v = 0;
    const per = [];
    for (const foe of team) {
      const P = duelPlan(spec, foe, mv);
      v += P.score;
      per.push(P);
    }
    return { v, per };
  }

  /** Greedy four-move pick that covers a boss team best (guaranteed damage × accuracy). */
  function bestSet(spec, team, pool, withStatus) {
    const scored = pool.filter(x => E.mv(x.id).k !== 'X').map(x => ({ ...x,
      per: team.map(t => { const d = E.damage(Object.assign({}, spec, { mv: [x.id] }), t, x.id); return d ? Math.min(100, d.minPct) * (d.acc ? d.acc / 100 : 1) : 0; }) }));
    const picked = [], bestPer = team.map(() => 0);
    for (let k = 0; k < 4; k++) {
      let top = null, gain = 0.5;
      for (const c of scored) {
        if (picked.includes(c)) continue;
        const g = c.per.reduce((s, v, j) => s + Math.max(0, v - bestPer[j]), 0);
        if (g > gain) { gain = g; top = c; }
      }
      if (!top) break;
      picked.push(top);
      top.per.forEach((v, j) => { bestPer[j] = Math.max(bestPer[j], v); });
    }
    // fill the remaining slots: strongest remaining attacks (coverage first, then raw damage), preferring moves it already knows
    const rest = scored.filter(c => !picked.includes(c)).map(c => ({ c, total: c.per.reduce((a, b) => a + b, 0) + (c.how === 'knows it' ? 5 : 0) }))
      .sort((a, b) => b.total - a.total);
    for (const r of rest) { if (picked.length >= 4) break; if (r.total > 0) picked.push(r.c); }
    // keep a status move worth having (healing, a status condition, Yawn, Leech Seed) if there is room
    const USEFUL = new Set([1, 33, 66, 67, 167, 187, 84, 32, 132]);
    for (const x of pool) {
      if (picked.length >= 4) break;
      const m = E.mv(x.id);
      if (m && m.k === 'X' && USEFUL.has(m.e) && !picked.some(p => p.id === x.id)) picked.push(Object.assign({ status: true }, x));
    }
    if (!withStatus || !SIM) return picked;
    // then: would a status or stat move (setting up, Thunder Wave, Growl, Sleep Powder…) handle their team better than
    // one of these? Each swap is played out against every one of their Pokemon; up to two such moves.
    const cands = pool.filter(x => SIM.statusEffect(x.id) && !(SIM.statusEffect(x.id) || {}).heal && !picked.some(p => p.id === x.id));
    let cur = picked.slice(), curV = setValue(spec, team, cur.map(x => x.id)).v;
    for (let round = 0; round < 2 && cands.length; round++) {
      let bestSwap = null;
      for (const c of cands) {
        if (cur.some(p => p.id === c.id)) continue;
        const tries = cur.length < 4 ? [cur.concat(Object.assign({ status: true }, c))] : cur.map((p, k) => cur.slice(0, k).concat(Object.assign({ status: true }, c), cur.slice(k + 1)));
        for (const set of tries) {
          if (!set.some(x => E.mv(x.id).k !== 'X')) continue;   // it still needs a way to do damage
          const v = setValue(spec, team, set.map(x => x.id)).v;
          if (v > curV + 0.3 && (!bestSwap || v > bestSwap.v)) bestSwap = { set, v };
        }
      }
      if (!bestSwap) break;
      cur = bestSwap.set; curV = bestSwap.v;
    }
    return cur;
  }

  /** How well this Pokemon (at the boss's cap, with its best moves) handles a boss team. */
  function fightScore(spec, bossIndex, ownedTMs) {
    const b = D.bosses[bossIndex];
    const lv = Math.max(spec.lv, b.cap);
    const s = Object.assign({}, spec, { lv: Math.min(lv, b.cap) });
    const team = E.bossTeam(bossIndex, b.cap);
    const set = bestSet(s, team, available(s, s.lv, ownedTMs));
    const withMoves = Object.assign({}, s, { mv: set.map(x => x.id) });
    let score = 0;
    const per = team.map(t => {
      const m = E.matchup(withMoves, t);
      score += VS[m.verdict] - m.risk;
      return { foe: E.sp(t.s).n, verdict: m.verdict, risk: m.risk, faster: m.mySpeed > m.theirSpeed };
    });
    return { score, per, set };
  }

  /** Rank natures for this Pokemon against the next big fights. */
  function natureAdvice(spec, fromBoss, ownedTMs, count) {
    const bosses = upcomingMajor(fromBoss, count || 3);
    const tried = Array.from(new Set(CANDIDATE_NATURES.concat(spec.nat != null ? [spec.nat] : [])));
    const results = tried.map(nat => {
      const s = Object.assign({}, spec, { nat });
      let total = 0;
      const fights = bosses.map(bi => { const f = fightScore(s, bi, ownedTMs); total += f.score; return { boss: bi, ...f }; });
      return { nat, total, fights };
    }).sort((a, b) => b.total - a.total);
    const current = results.find(r => r.nat === spec.nat);
    let best = results[0];
    // When no nature changes the fights much, fall back to the usual rule: raise the stat its best moves use
    // (or Speed, if a little more Speed would let it move first against these bosses), lower the attacking stat it doesn't use.
    let reason = 'Wins or saves the most matchups against these fights.';
    const second = results[1];
    if (!second || best.total - Math.min(...results.map(r => r.total)) < 0.25) {
      const sets = best.fights.flatMap(f => f.set).map(x => E.mv(x.id)).filter(m => m && m.k !== 'X');
      const phys = sets.filter(m => m.k === 'P').length, spec2 = sets.filter(m => m.k === 'S').length;
      const physical = phys >= spec2;
      // would +10% Speed let it move first against something it currently doesn't outspeed?
      const plain = Object.assign({}, spec, { nat: D.natures.findIndex(x => x.n === 'Hardy') });
      let flips = 0;
      for (const bi of bosses) {
        const b = D.bosses[bi];
        const at = Object.assign({}, plain, { lv: b.cap });
        const mine = E.speedOf(at, null);
        for (const tm of E.bossTeam(bi, b.cap)) { const theirs = E.speedOf(tm, null); if (mine <= theirs && Math.floor(mine * 1.1) > theirs) flips++; }
      }
      const pick = flips > 0 ? (physical ? 'Jolly' : 'Timid') : (physical ? 'Adamant' : 'Modest');
      const pr = results.find(r => D.natures[r.nat].n === pick) || results[0];
      best = pr;
      reason = flips > 0
        ? `No nature changes these fights much, but +Speed lets it move first against ${flips} more of their Pokémon. Its best moves are ${physical ? 'physical' : 'special'}.`
        : `No nature changes these fights much, so raise ${physical ? 'Attack' : 'Sp. Atk'} (its best moves are ${physical ? 'physical' : 'special'}) and lower the attacking stat it doesn't use.`;
    }
    // explain the difference between the best nature and the current one
    const changes = [];
    if (current && best.nat !== current.nat) {
      best.fights.forEach((f, k) => {
        f.per.forEach((p, j) => {
          const q = current.fights[k].per[j];
          if (VS[p.verdict] > VS[q.verdict]) changes.push(`${D.bosses[f.boss].n}'s ${p.foe}: ${q.verdict} → ${p.verdict}${p.faster && !q.faster ? ' (now faster)' : ''}`);
        });
      });
    }
    return { bosses, ranked: results.slice(0, 4), current, best, changes, reason };
  }

  /** When to learn what: best moves before each of the next big fights, and when each becomes available. */
  function movePlan(spec, fromBoss, ownedTMs, count) {
    const bosses = upcomingMajor(fromBoss, count || 3);
    const s = E.sp(spec.s);
    const steps = [];
    let prev = (spec.mv || []).slice();
    for (const bi of bosses) {
      const b = D.bosses[bi];
      const lv = Math.max(spec.lv, b.cap);
      const at = Object.assign({}, spec, { lv: Math.min(lv, b.cap) });
      const team = E.bossTeam(bi, b.cap);
      const pool = available(at, at.lv, ownedTMs);
      const set = bestSet(at, team, pool, true);
      const ids = set.map(x => x.id);
      const add = set.filter(x => !prev.includes(x.id));
      // only replace as many old moves as there are new ones (a moveset holds four)
      const keepRoom = Math.max(0, 4 - add.length);
      const keep = prev.filter(id => ids.includes(id));
      const drop = add.length ? prev.filter(id => !ids.includes(id)).slice(0, Math.max(0, prev.length + add.length - 4)) : [];
      void keep; void keepRoom;
      steps.push({ boss: bi, cap: b.cap, set, add: add.map(x => ({ ...x, alreadyPassed: x.lv != null && x.lv <= spec.lv && !(spec.mv || []).includes(x.id) })), drop });
      prev = ids;
    }
    // level-up moves still to come (exact levels), with Hardcore bans marked
    const L = D.learn[spec.s];
    const upcoming = L ? L.l.filter(([lv, id]) => lv > spec.lv && E.mv(id)).map(([lv, id]) => ({ lv, id, banned: E.isBanned(id, s.g) })) : [];
    return { steps, upcoming };
  }

  /** A move offered at level-up: is it worth a slot, and which move should go? Each way of fitting it in is played
   *  against the next big fights' teams at their level cap: for each of their Pokemon the best way to handle it (attack,
   *  or set up, paralyze, put to sleep, lower its stats first: see duelPlan), then how much damage the four moves do.
   *  So a status or stat move wins a slot when it turns a fight around, not only a stronger attack. */
  function learnAdvice(spec, newId, fromBoss, count) {
    const known = (spec.mv || []).filter(id => E.mv(id));
    const nm = E.mv(newId);
    if (!nm) return { learn: false, forget: null, reason: '' };
    if (known.includes(newId)) return { learn: false, forget: null, reason: 'It already knows it.' };
    if (known.length < 4) return { learn: true, forget: null, reason: 'It has a free move slot.' };
    const bosses = upcomingMajor(fromBoss, count || 2);
    const teams = bosses.map(bi => ({ bi, cap: D.bosses[bi].cap, team: E.bossTeam(bi, D.bosses[bi].cap) }));
    const value = mv => {
      let v = 0;
      const per = [];
      for (const { bi, cap, team } of teams) {
        const s = Object.assign({}, spec, { mv, lv: Math.max(spec.lv, cap) });
        for (const foe of team) {
          const P = duelPlan(s, foe, mv);
          v += 10 * P.score;
          per.push(Object.assign({ bi, foe: E.sp(foe.s).n }, P));
          let best = 0;
          for (const id of mv) { const mm = E.mv(id); if (!mm || mm.k === 'X') continue; const d = E.damage(Object.assign({}, s, { mv: [id] }), foe, id); if (d) best = Math.max(best, Math.min(100, d.minPct) * (d.acc ? d.acc / 100 : 1)); }
          v += best / 25;
        }
      }
      // a status move that does nothing against these fights is dead weight
      for (const id of mv) { const mm = E.mv(id); if (mm && mm.k === 'X' && !per.some(p => p.via === id)) v -= 0.2; }
      return { v, per };
    };
    const now = value(known);
    const options = known.map(id => Object.assign({ forget: id }, value(known.filter(x => x !== id).concat(newId)))).sort((a, b) => b.v - a.v);
    const best = options[0];
    const names = teams.map(t => D.bosses[t.bi].n).join(' and ');
    if (best && best.v > now.v + 0.5) {
      // what changes: their Pokemon it now handles better, and whether the new move is how
      // what changes: their Pokemon it now handles better (a better verdict, or the same with less risk), and how
      const pct = r => (r <= 1e-9 ? '0%' : r < 0.01 ? '<1%' : Math.round(100 * r) + '%');
      const diffs = best.per.map((p, k) => ({ p, q: now.per[k], d: (VS[p.verdict] - p.risk) - (VS[now.per[k].verdict] - now.per[k].risk) })).filter(x => x.d > 0.02).sort((a, b) => b.d - a.d);
      const say = x => `${D.bosses[x.p.bi].n}'s ${x.p.foe} (${x.q.verdict === x.p.verdict ? `${pct(x.q.risk)} → ${pct(x.p.risk)} risk` : `${x.q.verdict} → ${x.p.verdict}`})`;
      const viaNew = diffs.filter(x => x.p.via === newId);
      const reason = nm.k === 'X' && viaNew.length
        ? `Using ${nm.f} first makes ${viaNew.length === 1 ? 'a matchup' : viaNew.length + ' matchups'} safer: ${viaNew.slice(0, 3).map(say).join(', ')}. ${E.mv(best.forget).f} matters least.`
        : diffs.length ? `With ${nm.f} instead of ${E.mv(best.forget).f}: ${diffs.slice(0, 3).map(say).join(', ')}.`
        : `${nm.f} does more against ${names} than ${E.mv(best.forget).f} does.`;
      return { learn: true, forget: best.forget, gain: best.v - now.v, reason };
    }
    return { learn: false, forget: null, gain: best ? best.v - now.v : 0, reason: `What it knows already does as well against ${names}.` };
  }

  /** Held items and natures for the Pokemon you bring to one fight, as the plan brings them (same levels and moves),
   *  judged one on one against their team: safe 3, ok 2, risky 1, lose 0, minus the chance of fainting.
   *  specs: the six as they are. team: their team. pool: [[itemId, count], ...], the held items you have (what your
   *  Pokemon hold included). Items first: everyone starts empty-handed and the biggest gains get their item first, as many
   *  as you have of each; a Pokemon keeps what it holds when nothing does better and nobody needs it more. Then natures,
   *  with those items, only where one makes a real difference to this fight (the Nature Change service is free, but it's
   *  still a trip).
   *  Returns { specs, changed, info: [{ key, nat, it, natFrom, itFrom, gNat, gIt }] }, in the order given. */
  function planSetup(specs, team, pool, opts) {
    const o = Object.assign({ natGain: 0.3, itemGain: 0.15 }, opts || {});
    const foes = team.map(t => Object.assign({}, t, { entry: true }));
    const memo = new Map();
    /** v: the matchup points; c: a finer tie-break, the damage it deals per hit minus the damage it takes (in HP). */
    const rate = (spec, nat, it) => {
      const k = spec.key + '|' + nat + '|' + (it || 0);
      if (memo.has(k)) return memo.get(k);
      let s = Object.assign({}, spec, { nat, it: it || null, entry: true });
      const mega = it && SIM && SIM.megaTarget ? SIM.megaTarget({ spec: s, item: it }) : null;
      if (mega) s = Object.assign(s, { s: mega, ab: (E.sp(mega).a || [])[0] || s.ab });
      let v = 0, c = 0;
      for (const t of foes) {
        const mu = E.matchup(s, t);
        v += VS[mu.verdict] - mu.risk;
        c += ((mu.best ? (mu.best.minPct + mu.best.maxPct) / 2 : 0) - (mu.threat ? mu.threat.maxPct : 0)) / 100;
      }
      const r = { v, c };
      memo.set(k, r);
      return r;
    };
    const score = (spec, nat, it) => rate(spec, nat, it).v;
    const info = specs.map(sp => ({ key: sp.key, nat: sp.nat, it: sp.it || null, natFrom: sp.nat, itFrom: sp.it || null, gNat: 0, gIt: 0 }));
    // held items across the six first (handing one over is easier than a trip to change a nature), with the natures they have
    const left = new Map((pool || []).filter(([, c]) => c > 0));
    const ids = [...left.keys()];
    const none = specs.map(sp => score(sp, sp.nat, null));
    const pairs = [];
    specs.forEach((sp, k) => { if (!sp.keepItem) for (const id of ids) pairs.push({ k, id, g: score(sp, sp.nat, id) - none[k] + (id === sp.it ? 0.05 : 0) }); });
    pairs.sort((a, b) => b.g - a.g);
    // an item you want kept where it is (an Everstone on a Pokemon you've stopped evolving) stays put
    specs.forEach(sp => { if (sp.keepItem && sp.it && left.get(sp.it) > 0) left.set(sp.it, left.get(sp.it) - 1); });
    const got = new Map();
    for (const x of pairs) {
      if (x.g < o.itemGain || got.has(x.k) || !(left.get(x.id) > 0)) continue;
      got.set(x.k, x.id); left.set(x.id, left.get(x.id) - 1);
    }
    specs.forEach((sp, k) => {
      if (sp.keepItem) info[k].it = sp.it || null;
      else if (got.has(k)) info[k].it = got.get(k);
      else if (sp.it && !left.has(sp.it)) info[k].it = sp.it;   // something the advice doesn't weigh: leave it be
      else if (sp.it && left.get(sp.it) > 0) { info[k].it = sp.it; left.set(sp.it, left.get(sp.it) - 1); }
      else info[k].it = null;
      info[k].gIt = score(sp, sp.nat, info[k].it) - score(sp, sp.nat, sp.it || null);
    });
    // natures, with the items they'll hold, where one still makes a real difference: the natures people use (and the one
    // it has); on a tie, one that doesn't lower Speed, then the finer measure, then the usual order
    const usual = CANDIDATE_NATURES;
    specs.forEach((sp, k) => {
      const tries = usual.includes(sp.nat) || sp.nat == null ? usual : [sp.nat].concat(usual);
      const it = info[k].it, base = score(sp, sp.nat, it);
      let best = null;
      tries.forEach((n, order) => {
        const r = rate(sp, n, it), slow = (D.natures[n] || {}).d === 'spe' ? 1 : 0;
        const better = !best || (Math.abs(r.v - best.v) > 0.005 ? r.v > best.v : slow !== best.slow ? slow < best.slow : Math.abs(r.c - best.c) > 0.002 ? r.c > best.c : order < best.order);
        if (better) best = { n, v: r.v, c: r.c, slow, order };
      });
      if (best && best.n !== sp.nat && best.v - base >= o.natGain) { info[k].nat = best.n; info[k].gNat = best.v - base; }
    });
    const changed = info.some(x => x.nat !== x.natFrom || x.it !== x.itFrom);
    return { changed, info, specs: specs.map((sp, k) => Object.assign({}, sp, { nat: info[k].nat, it: info[k].it })) };
  }

  return { natureAdvice, movePlan, learnAdvice, available, bestSet, upcomingMajor, fightScore, setOptions, duelPlan, setValue, planSetup };
});
