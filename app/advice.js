/* Per-Pokemon advice: which nature to set (Radical Red has a free Nature Change service) and
 * when to learn which move, using exact level-up levels from the ROM and only TMs the player owns. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.createAdvice = factory;
})(typeof self !== 'undefined' ? self : this, function createAdvice(E) {
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

  /** Greedy four-move pick that covers a boss team best (guaranteed damage × accuracy). */
  function bestSet(spec, team, pool) {
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
    return picked;
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
      const set = bestSet(at, team, pool);
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
   *  against the next big fights' teams at their level cap: matchups first (safe/ok/risky/lose), then how much damage
   *  the four moves do to each of their Pokemon; status moves that do something useful (sleep, paralysis, healing,
   *  Leech Seed and the like) count for a little. */
  function learnAdvice(spec, newId, fromBoss, count) {
    const known = (spec.mv || []).filter(id => E.mv(id));
    const nm = E.mv(newId);
    if (!nm) return { learn: false, forget: null, reason: '' };
    if (known.includes(newId)) return { learn: false, forget: null, reason: 'It already knows it.' };
    if (known.length < 4) return { learn: true, forget: null, reason: 'It has a free move slot.' };
    const bosses = upcomingMajor(fromBoss, count || 2);
    const USEFUL = new Set([1, 33, 66, 67, 167, 187, 84, 32, 132, 37, 158, 156]);
    const teams = bosses.map(bi => ({ bi, cap: D.bosses[bi].cap, team: E.bossTeam(bi, D.bosses[bi].cap) }));
    const value = mv => {
      let v = 0;
      for (const { cap, team } of teams) {
        const s = Object.assign({}, spec, { mv, lv: Math.max(spec.lv, cap) });
        for (const foe of team) {
          const m = E.matchup(s, foe);
          v += 10 * (VS[m.verdict] - m.risk);
          let best = 0;
          for (const id of mv) { const mm = E.mv(id); if (!mm || mm.k === 'X') continue; const d = E.damage(Object.assign({}, s, { mv: [id] }), foe, id); if (d) best = Math.max(best, Math.min(100, d.minPct) * (d.acc ? d.acc / 100 : 1)); }
          v += best / 25;
        }
      }
      for (const id of mv) { const mm = E.mv(id); if (mm && mm.k === 'X') v += USEFUL.has(mm.e) ? 3 : -0.2; }   // a status move that does nothing here goes first
      return v;
    };
    const now = value(known);
    const options = known.map(id => ({ forget: id, v: value(known.filter(x => x !== id).concat(newId)) })).sort((a, b) => b.v - a.v);
    const best = options[0];
    const names = teams.map(t => D.bosses[t.bi].n).join(' and ');
    if (best && best.v > now + 0.5) {
      return { learn: true, forget: best.forget, gain: best.v - now,
        reason: `${nm.f} does more against ${names} than ${E.mv(best.forget).f} does.` };
    }
    return { learn: false, forget: null, gain: best ? best.v - now : 0, reason: `What it knows already does as well against ${names}.` };
  }

  return { natureAdvice, movePlan, learnAdvice, available, bestSet, upcomingMajor, fightScore, setOptions };
});
