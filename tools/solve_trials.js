// Solve Radical Red's puzzle battles with the Coach's own simulator and boss AI (data/trial_solutions.json).
//
// A puzzle battle (data/trials.json, tools/extract_trials.py) lends you six Pokemon; you pick three. The opponent
// sends its Pokemon out in party order and never switches by choice. Every pick of three, in every order, is searched
// turn by turn (each move and switch you could choose) against the boss AI with the expected dice (middle damage roll,
// no crits, hits that are likely land), until a line wins. A win must leave you a Pokemon standing: if your last
// Pokemon and theirs go down together, the game counts a draw, and a draw is a loss (sim.js battleOver).
// Each winning line is then replayed with real dice: at every turn the search runs again from where the battle stands
// (so a different AI pick or a miss is answered), and the share of wins is its odds.
//
// A rental battle (all six lent to you) has nothing to pick: its odds come from the Coach's planner, as for a boss.
//
// usage: NODE_PATH=... node tools/solve_trials.js data/trials.json app/rrdata.json > data/trial_solutions.json
'use strict';
const path = require('path');
const C = require('@smogon/calc');
const D = require(path.resolve(process.argv[3] || 'app/rrdata.json'));
const E = require(path.resolve(__dirname, '../app/engine.js'))(C, D);
const SIM = require(path.resolve(__dirname, '../app/sim.js'))(E);
const TRIALS = require(path.resolve(process.argv[2] || 'data/trials.json'));

// FireRed keeps stats as HP Atk Def Spe SpA SpD; the engine wants HP Atk Def SpA SpD Spe
const order = a => [a[0], a[1], a[2], a[4], a[5], a[3]];
const spec = (m, key) => ({ key, label: m.n, s: m.s, lv: m.lv, nat: m.nat, ab: m.ab, it: m.it, mv: m.mv, iv: order(m.iv), ev: order(m.ev) });
const name = id => (E.mv(id) || { f: '?' }).f;

function combos(n, k) {
  const out = [];
  const rec = (start, cur) => { if (cur.length === k) { out.push(cur.slice()); return; } for (let i = start; i < n; i++) { cur.push(i); rec(i + 1, cur); cur.pop(); } };
  rec(0, []);
  return out;
}
function perms(a) { return a.length <= 1 ? [a.slice()] : a.flatMap((x, i) => perms(a.filter((_, j) => j !== i)).map(p => [x].concat(p))); }

/** The opponent: the boss AI without voluntary switches, sending replacements out in party order. */
function trialAI() {
  const ai = SIM.bossPolicy({ noSwitch: true });
  return {
    choose: (st, side, rng, ex, peek, slot) => ai.choose(st, side, rng, ex, peek, slot),
    replace: (st, side) => { const i = st[side].team.findIndex((m, k) => !m.fainted && !st[side].slots.includes(k)); return i >= 0 ? i : null; },
  };
}
/** You: this turn's action, and replacements in your lineup order (the first one still standing). */
function you(action) {
  return {
    choose: () => action,
    replace: (st, side) => { const i = st[side].team.findIndex((m, k) => !m.fainted && !st[side].slots.includes(k)); return i >= 0 ? i : null; },
  };
}
function actions(st) {
  const me = SIM.act(st, 'p');
  const out = SIM.usable(me, st).map(id => ({ type: 'move', id }));
  if (SIM.canSwitch(st, me)) st.p.team.forEach((m, i) => { if (!m.fainted && !st.p.slots.includes(i)) out.push({ type: 'switch', to: i }); });
  return out;
}
const AI = trialAI();
let nodes = 0;
/** The opponent's possible actions this turn: each move it can use (the search must beat every one), and with a
 *  Roar-like move of yours, each Pokemon it could drag in. */
function replies(st, a) {
  const foe = SIM.act(st, 'a');
  if (!foe || foe.fainted) return [{ move: null }];
  const moves = SIM.usable(foe, st);
  const phaze = a.type === 'move' && [28, 234].includes((E.mv(a.id) || {}).e);
  const drags = phaze ? st.a.team.map((m, i) => i).filter(i => !st.a.team[i].fainted && !st.a.slots.includes(i)) : [null];
  const out = [];
  for (const id of moves) for (const d of (drags.length ? drags : [null])) out.push({ move: id, drag: d });
  return out;
}
function fixed(r) {
  return {
    choose: () => ({ type: 'move', id: r.move }),
    replace: (st, side) => { const i = st[side].team.findIndex((m, k) => !m.fainted && !st[side].slots.includes(k)); return i >= 0 ? i : null; },
    forced: () => r.drag,
  };
}
function sig(st) {
  const mon = m => [m.hp, m.fainted ? 1 : 0, m.item || 0, m.status || '', m.sleep || 0, m.encore || 0, m.encoreMove || 0, m.lastMove || 0,
    m.boosts.atk, m.boosts.def, m.boosts.spa, m.boosts.spd, m.boosts.spe, m.toxic || 0, m.sub || 0, m.firstTurn ? 1 : 0].join(',');
  const side = sd => sd.slots.join('/') + ':' + sd.team.map(mon).join(';') + ':' + JSON.stringify(sd.hazards) + JSON.stringify(sd.screens);
  return side(st.p) + '|' + side(st.a) + '|' + (st.weather || '') + (st.terrain || '') + (st.trickRoom || 0);
}
const memo = new Map();
/** A strategy that wins from here whatever the opponent does: { a, then: [[reply, strategy]...] }, or null. */
function guaranteed(st, depth) {
  if (st.over) return st.winner === 'p' ? { done: true } : null;
  if (depth <= 0) return null;
  const k = sig(st) + '#' + depth;
  if (memo.has(k)) return memo.get(k);
  memo.set(k, null);
  let found = null;
  for (const a of actions(st)) {
    const then = [];
    let ok = true;
    for (const r of replies(st, a)) {
      nodes++;
      const nx = SIM.cloneState(st);
      nx.policies = { p: you(a), a: fixed(r) };
      SIM.playTurn(nx, SIM.expectedDice());
      const sub = guaranteed(nx, depth - 1);
      if (!sub) { ok = false; break; }
      then.push([r, sub]);
    }
    if (ok) { found = { a, then }; break; }
  }
  memo.set(k, found);
  return found;
}
/** The expected line of a strategy: follow the reply the boss AI would pick (or the first). */
function lineOf(st, strat) {
  const acts = [];
  let cur = SIM.cloneState(st), node = strat;
  while (node && !node.done) {
    acts.push(node.a);
    const pick = AI.choose(cur, 'a', SIM.expectedDice(), false, true);
    const r = node.then.find(([x]) => x.move === pick.id) || node.then[0];
    cur.policies = { p: you(node.a), a: fixed(r[0]) };
    SIM.playTurn(cur, SIM.expectedDice());
    node = r[1];
  }
  return acts;
}
/** How many of the opponent's choices the strategy answers, and its depth (for the write-up). */
function size(strat) { return !strat || strat.done ? 0 : 1 + strat.then.reduce((n, [, s]) => n + size(s), 0); }
/** Replay a line with the battle log on: what you do and what happens, turn by turn. */
function replay(team, opp, acts) {
  const st = SIM.newBattle(team, opp, { lead: 0, record: true });
  const rng = SIM.expectedDice();
  st.policies = { p: you(null), a: AI };
  SIM.begin(st, rng);
  const turns = [];
  for (const a of acts) {
    const from = st.log.length;
    const me = SIM.act(st, 'p');
    st.policies = { p: you(a), a: AI };
    SIM.playTurn(st, rng);
    turns.push({ you: a.type === 'switch' ? `${me.name}: switch to ${st.p.team[a.to].name}` : `${me.name}: ${name(a.id)}`,
      log: st.log.slice(from).map(l => l.text) });
  }
  return { turns, winner: st.winner, draw: !!st.draw };
}
function newState(team, opp) {
  const st = SIM.newBattle(team, opp, { lead: 0 });
  st.policies = { p: you(null), a: AI };
  SIM.begin(st, SIM.expectedDice());
  return st;
}
/** Replay with real dice, searching again each turn from the real state. */
function odds(team, opp, runs, depth, budget) {
  let wins = 0;
  for (let r = 0; r < runs; r++) {
    const rng = SIM.mulberry32(1000 + r * 7919);
    const st = SIM.newBattle(team, opp, { lead: 0 });
    st.policies = { p: you(null), a: AI };
    SIM.begin(st, rng);
    while (!st.over && st.turn < 40) {
      nodes = 0; memo.clear();
      const strat = guaranteed(st, depth);
      const a = strat && !strat.done ? strat.a : actions(st)[0];
      st.policies = { p: you(a), a: AI };
      SIM.playTurn(st, rng);
    }
    if (st.winner === 'p') wins++;
  }
  return wins / runs;
}

const out = [];
const only = process.env.TRIAL ? +process.env.TRIAL : null;
for (const t of TRIALS) {
  if (only != null && t.trainer !== only) continue;
  const opp = t.opponent.map((m, i) => spec(m, 'b' + i));
  if (t.pick === 6) {
    // a rental battle: no picks; the planner plays it like a boss fight
    const team = t.rentals.map((m, i) => spec(m, 'r' + i));
    const sim = SIM.simulate(team, opp, { runs: 200, ai: trialAI() });
    out.push({ map: t.map, mapName: t.mapName, trainer: t.trainer, kind: t.kind, odds: sim.wins / sim.runs, note: 'all six are yours; the planner plays it' });
    continue;
  }
  const found = [];
  // the game's own hint after a loss names the lead (and a partner): search those lineups first
  const hinted = (t.hint || '').match(/leading with (?:\{[^}]*\})*([A-Z][a-z]+)/);
  const partner = (t.hint || '').match(/partner to it in(?: this fight)? is (?:\{[^}]*\})*([A-Z][a-z]+)/);
  const lead = hinted ? t.rentals.findIndex(m => m.n.startsWith(hinted[1])) : -1;
  const mate = partner ? t.rentals.findIndex(m => m.n.startsWith(partner[1])) : -1;
  const lineups = [];
  for (const pick of combos(t.rentals.length, t.pick)) for (const lineup of perms(pick)) lineups.push(lineup);
  const first = lineups.filter(l => (lead < 0 || l[0] === lead) && (mate < 0 || l.includes(mate)));
  const rest = lineups.filter(l => !first.includes(l));
  const todo = first.length ? first.concat(process.env.ALL ? rest : []) : lineups;
  for (const lineup of todo) {
    {
      const team = lineup.map(i => spec(t.rentals[i], 'r' + i));
      const st = newState(team, opp);
      nodes = 0; memo.clear();
      const strat = guaranteed(st, +(process.env.DEPTH || 12));
      if (strat) found.push({ lineup, team, strat, line: lineOf(st, strat), nodes });
    }
  }
  const scored = found.map(f => Object.assign(f, { odds: odds(f.team, opp, +(process.env.RUNS || 40), 10, 20000) }));
  scored.sort((x, y) => y.odds - x.odds || x.line.length - y.line.length);
  out.push({
    map: t.map, mapName: t.mapName, trainer: t.trainer, kind: t.kind, searched: combos(t.rentals.length, t.pick).length * 6,
    solutions: scored.slice(0, 6).map(f => ({
      lineup: f.lineup.map(i => t.rentals[i].n), lead: t.rentals[f.lineup[0]].n, odds: f.odds, guaranteed: true,
      turns: f.line.length, branches: size(f.strat), play: replay(f.team, opp, f.line),
    })),
  });
  process.stderr.write(`${t.mapName}: ${found.length} winning lineups\n`);
}
process.stdout.write(JSON.stringify(out, null, 1) + '\n');
