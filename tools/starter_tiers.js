// Rank Radical Red's 27 starters for a Hardcore nuzlocke, from the game's own data.
//
// For every major fight up to the Champion (gym leaders, rival, Rocket admins and Giovanni, the Elite Four and
// the other milestone fights), each starter is tested at that fight's Hardcore level cap: evolved by level-up
// where the ROM's evolution table says it would be by then, with its best four level-up moves at that level
// (Hardcore-banned moves left out, TMs and tutors not assumed), against the boss's exact Hardcore team.
// The rival fights use the team you'd actually face: the rival's starter depends on which ball you take
// (grass ball: he takes Charmander; water: Bulbasaur; fire: Squirtle).
// Each of the boss's Pokemon is a one-on-one matchup (counting every damage roll, crit and miss); a fight's score
// is the average over their team of (safe 3, ok 2, risky 1, lose 0) minus the chance of fainting.
// The first fights (caps 16 and 23: the rival, Falkner, Brock, Archer) are also played out whole: the starter alone
// against the boss's whole team in the battle simulator (the ported boss AI, real luck, 40 battles each), counting
// how much of their team it knocks out before it falls, with no items, as in Hardcore. That catches what one-on-one
// matchups from full HP miss: by their third or fourth Pokemon your starter is worn down.
// Overall = 40% the first fights (one-on-one and played out, half each) + 25% the rest of the early game (caps up
// to 36) + 35% the rest of the run: a nuzlocke ends at its first wipe, and the first fights are where your starter is
// most of your team.
//
// usage: node tools/starter_tiers.js data app/rrdata.json app/starters.json [hardcore|normal]
//   normal: Normal Mode with Minimal Grinding (its own boss teams and level caps; no move bans or ability changes)
const fs = require('fs');
const path = require('path');
const C = require('@smogon/calc');

const DATA = process.argv[2] || 'data';
const D = JSON.parse(fs.readFileSync(process.argv[3] || 'app/rrdata.json', 'utf8'));
const OUT = process.argv[4] || 'app/starters.json';
const MODE = process.argv[5] === 'normal' ? 'normal' : 'hardcore';
const E = require(path.resolve(__dirname, '../app/engine.js'))(C, D);
// the difficulty's boss teams and caps (Normal Mode's teams come from the regular trainer table: b.np)
if (MODE === 'normal') for (const b of D.bosses) { if (b.np && b.np.length) { b.party = b.np; b.dbl = b.ndbl; if (b.nv) b.v = b.nv; } b.cap = D.caps.normal[b.mi]; }
E.setMode(MODE);
const SIM = require(path.resolve(__dirname, '../app/sim.js'))(E);
const ADV = require(path.resolve(__dirname, '../app/advice.js'))(E, SIM);
/** The starter alone against a boss's whole team: the share of their team it knocks out before it falls (mean of runs). */
function sweep(spec, bi, runs) {
  const team = E.bossTeam(bi, D.bosses[bi].cap).map((t, i) => Object.assign({ key: 'b' + i, label: E.sp(t.s).n }, t));
  let sum = 0;
  for (let k = 0; k < runs; k++) {
    const st = SIM.runBattle([spec], team, { seed: 7919 * (k + 1) + bi, maxTurns: 60, doubles: false });
    sum += st.a.team.filter(m => m.fainted).length / team.length;
  }
  return sum / runs;
}
const SWEEP_RUNS = 40;
const starters = JSON.parse(fs.readFileSync(path.join(DATA, 'starters.json'), 'utf8'));

const VS = { safe: 3, ok: 2, risky: 1, lose: 0 };
const NATURES = ['Adamant', 'Jolly', 'Modest', 'Timid'].map(n => D.natures.findIndex(x => x.n === n));
const LEVEL_EVO = new Set([4, 8, 9, 10, 11, 12, 13, 20, 21, 22, 23, 31, 32]);
const EARLY_CAP = D.caps[MODE][3];   // the fourth milestone's cap: 36 in Hardcore, 34 in Normal
const FIRST_CAP = D.caps[MODE][1];   // the second: 23 in Hardcore, 22 in Normal

function evolvedBy(sid, lv) {
  let s = sid;
  for (let g = 0; g < 4; g++) {
    const next = (D.evo[s] || []).find(([, method, param]) => LEVEL_EVO.has(method) && param <= lv);
    if (!next) break;
    s = next[0];
  }
  return s;
}
function stages(sid) {
  const out = [{ s: sid, lv: 5 }];
  let s = sid;
  for (let g = 0; g < 3; g++) {
    const next = (D.evo[s] || []).find(([, method]) => LEVEL_EVO.has(method));
    if (!next) break;
    out.push({ s: next[0], lv: next[2] });
    s = next[0];
  }
  return out;
}

// the fights: major bosses up to the Champion; same-name same-cap groups are variants
const bosses = D.bosses.filter(b => !b.route);
const champ = bosses.reduce((last, b) => (b.cat === 'rival' && b.mi === 16 ? b.i : last), -1);
const groups = [];
for (const b of bosses) {
  if (b.i > champ) break;
  if (!(b.cat === 'gym' || b.cat === 'e4' || b.cat === 'rival' || b.ms)) continue;
  const g = groups[groups.length - 1];
  if (g && g.name === b.n && g.cap === b.cap && g.members[g.members.length - 1] === b.i - 1) g.members.push(b.i);
  else groups.push({ name: b.n, cap: b.cap, cat: b.cat, members: [b.i] });
}
// rival triples are ordered Squirtle line, Bulbasaur line, Charmander line (trainer ids 329-331 and onward)
const RIVAL_POS = { Squirtle: 0, Bulbasaur: 1, Charmander: 2 };
function fightsFor(st) {
  return groups.map(g => {
    if (g.cat === 'rival' && g.members.length === 3) return { ...g, members: [g.members[RIVAL_POS[st.rival]]] };
    return g;
  });
}

const t0 = Date.now();
const results = [];
for (const st of starters) {
  const fights = fightsFor(st);
  // moves per fight (neutral nature), then the best of four natures
  const perNature = NATURES.map(nat => {
    let early = 0, nEarly = 0, late = 0, nLate = 0, first = 0, nFirst = 0;
    const detail = [];
    for (const f of fights) {
      const as = evolvedBy(st.species, f.cap);
      const sp = E.sp(as);
      let sum = 0;
      const per = [];
      const sets = [];
      for (const bi of f.members) {
        const spec = { key: 'starter', s: as, lv: f.cap, nat, ab: sp.a[0], it: null, mv: [] };
        const r = ADV.fightScore(spec, bi, []);
        sum += r.score / r.per.length;
        per.push(...r.per);
        sets.push(r.set.map(x => x.id));
      }
      const score = sum / f.members.length;
      const handles = per.filter(p => p.verdict === 'safe' || p.verdict === 'ok').length / f.members.length;
      const size = per.length / f.members.length;
      detail.push({ name: f.name, cap: f.cap, as, score: +score.toFixed(3), handles: +handles.toFixed(1), size, moves: sets[0] });
      if (f.cap <= FIRST_CAP) { first += score; nFirst++; } else if (f.cap <= EARLY_CAP) { early += score; nEarly++; } else { late += score; nLate++; }
    }
    early /= nEarly; late /= nLate; first /= nFirst;
    return { nat, early, late, first, overall: 0.4 * first + 0.25 * early + 0.35 * late, detail };
  });
  const best = perNature.sort((a, b) => b.overall - a.overall)[0];
  // the first fights, played out whole (the starter alone, no items), with the nature and moves found above
  const swept = [];
  for (const d of best.detail) {
    if (d.cap > FIRST_CAP) continue;
    const f = fights.find(x => x.name === d.name && x.cap === d.cap);
    const spec = { key: 'starter', s: d.as, lv: d.cap, nat: best.nat, ab: E.sp(d.as).a[0], it: null, mv: d.moves };
    const frac = f.members.reduce((a, bi) => a + sweep(spec, bi, SWEEP_RUNS), 0) / f.members.length;
    d.sweep = +frac.toFixed(3);
    swept.push(frac);
  }
  // one-on-one and played out count half each in the first fights (a full sweep = 3, the top of the one-on-one scale)
  const sweepScore = swept.length ? 3 * swept.reduce((a, b) => a + b, 0) / swept.length : 0;
  best.firstMatch = best.first;
  best.first = 0.5 * best.first + 0.5 * sweepScore;
  best.overall = 0.4 * best.first + 0.25 * best.early + 0.35 * best.late;
  const final = stages(st.species);
  const fsp = E.sp(final[final.length - 1].s);
  // the moves it relies on most
  const freq = new Map();
  for (const d of best.detail) for (const id of d.moves || []) freq.set(id, (freq.get(id) || 0) + 1);
  const keyMoves = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id]) => {
    const lv = ((D.learn[final[0].s] || {}).l || []).concat(...final.slice(1).map(x => (D.learn[x.s] || {}).l || [])).find(([, m]) => m === id);
    return { id, lv: lv ? lv[0] : null };
  });
  const sorted = best.detail.slice().sort((a, b) => b.score - a.score);
  results.push({
    s: st.species, name: st.name, gen: st.gen, ball: st.ball, type: st.type, rival: st.rival,
    stages: final, types: fsp.t, ability: E.sp(st.species).a[0], hidden: E.sp(st.species).a[2] || null, bst: fsp.s.reduce((a, b) => a + b, 0),
    nature: D.natures[best.nat].n, first: +best.first.toFixed(3), early: +best.early.toFixed(3), late: +best.late.toFixed(3), overall: +best.overall.toFixed(3),
    best: sorted.slice(0, 3).map(d => ({ name: d.name, cap: d.cap, handles: d.handles, size: d.size })),
    worst: sorted.slice(-3).reverse().map(d => ({ name: d.name, cap: d.cap, handles: d.handles, size: d.size })),
    fights: best.detail.map(d => [d.name, d.cap, d.score, d.handles, d.size, d.sweep != null ? d.sweep : null]),
    keyMoves,
  });
  process.stderr.write(`${st.name}: ${best.overall.toFixed(2)} (${((Date.now() - t0) / 1000).toFixed(0)}s)\n`);
}

// tiers: distance from the field's average in standard deviations
results.sort((a, b) => b.overall - a.overall);
const mean = results.reduce((s, r) => s + r.overall, 0) / results.length;
const sd = Math.sqrt(results.reduce((s, r) => s + (r.overall - mean) ** 2, 0) / results.length);
for (const r of results) {
  const z = (r.overall - mean) / sd;
  r.tier = z >= 1.0 ? 'S' : z >= 0.35 ? 'A' : z >= -0.35 ? 'B' : z >= -1.0 ? 'C' : 'D';
  r.rank = results.indexOf(r) + 1;
}
const out = {
  method: 'Each starter at every major fight\'s level cap (' + (MODE === 'normal' ? 'Normal Mode with Minimal Grinding' : 'Hardcore Mode') + ') up to the Champion, evolved by level, with its best level-up moves and best nature, one-on-one against each boss Pokemon (rival fights use the team you would face); the first fights (caps 16 and 23) are also played out whole, the starter alone against their whole team (' + SWEEP_RUNS + ' simulated battles each, no items). Overall = 40% the first fights + 25% the rest of the early game (caps to 36) + 35% the rest of the run.',
  fights: groups.length, early: groups.filter(g => g.cap <= EARLY_CAP).length, starters: results,
};
out.mode = MODE;
fs.writeFileSync(OUT, JSON.stringify(out));
fs.writeFileSync(path.join(DATA, MODE === 'normal' ? 'starter_tiers_normal.json' : 'starter_tiers.json'), JSON.stringify(out, null, 1));
console.log(`${results.length} starters over ${groups.length} fights in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
for (const r of results) console.log(r.tier, r.rank, r.name, r.overall, 'early', r.early, 'late', r.late, r.nature, '| best', r.best.map(b => b.name).join(', '), '| worst', r.worst.map(b => b.name).join(', '));
