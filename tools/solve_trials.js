// Solve Radical Red's puzzle battles with the Coach's own simulator and boss AI (data/trial_solutions.json).
//
// A puzzle battle (data/trials.json, tools/extract_trials.py) lends you six Pokemon; you pick three. The opponent
// sends its Pokemon out in party order and never switches by choice. Every pick of three, in every order, is searched
// turn by turn (each move and switch you could choose, and who you send in after a faint, which the game asks you
// once you have seen the turn) against the moves the boss AI would pick (all those tied for its top score) with the
// expected dice (middle damage roll, no crits, hits that are likely land), until a line wins. A win must leave you a Pokemon standing: if your last
// Pokemon and theirs go down together, the game counts a draw, and a draw is a loss (sim.js battleOver).
// Each winning line is then replayed with real dice: at every turn the search runs again from where the battle stands
// (so a different AI pick or a miss is answered), and the share of wins is its odds.
//
// A rental battle (all six lent to you) has nothing to pick: its odds come from the Coach's planner, as for a boss.
//
// usage: NODE_PATH=... node tools/solve_trials.js data/trials.json app/rrdata.json > data/trial_solutions.json
//   (TRIAL=<trainer id> for one trial, DEPTH=<turns> (13), RUNS=<replays> (40), SEARCH_NODES=<turns searched per
//   lineup> (2,000,000), LINEUP=<names> for one lineup, ALL=1 for every lineup, not just the ones the game's hint
//   names, WORST=1 to answer every move the opponent has, not just its AI's picks)
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
/** You: this turn's action, and who comes in if yours faints (the game asks you): rep, or a function of the state
 *  that names one, else the first one still standing in your lineup. */
function you(action, rep) {
  return {
    choose: () => action,
    replace: (st, side) => {
      const ok = k => k != null && k >= 0 && !st[side].team[k].fainted && !st[side].slots.includes(k);
      const want = typeof rep === 'function' ? rep(st) : rep;
      if (ok(want)) return want;
      const i = st[side].team.findIndex((m, k) => ok(k));
      return i >= 0 ? i : null;
    },
  };
}
/** Who could come in after a faint this turn: everyone standing but the one that will be out. One choice (or none)
 *  is no choice. */
function repsFor(st, a) {
  const out = a.type === 'switch' ? a.to : st.p.slots[0];
  const bench = st.p.team.map((m, i) => i).filter(i => !st.p.team[i].fainted && i !== out);
  return bench.length >= 2 ? bench : [null];
}
const replaced = (st, from) => st.events.slice(from).some(e => e.type === 'switch' && e.side === 'p' && e.why === 'replace');
function actions(st) {
  const me = SIM.act(st, 'p');
  const out = SIM.usable(me, st).map(id => ({ type: 'move', id }));
  if (SIM.canSwitch(st, me)) st.p.team.forEach((m, i) => { if (!m.fainted && !st.p.slots.includes(i)) out.push({ type: 'switch', to: i }); });
  return out;
}
const AI = trialAI();
let nodes = 0, limit = Infinity;
const BUDGET = new Error('node budget');
const moveId = n => (D.moves.find(m => (m.f || m.n) === n) || {}).i;
// Lines found by hand, tried first (the search still has to show that they win against every move the AI could pick,
// so a known line only saves time). Per trial: the lineup, and each turn's action: a move, '>Name' to switch, and
// 'Move/Name' to send Name in if yours faints that turn.
// Cerulean: Fake Out takes Aron off full HP, so its Focus Sash can't save it from Drain Punch; Phanpy comes in on
// Pikachu's Volt Tackle (immune), lives through Freezy Frost on its own Focus Sash and Earthquakes Pikachu; Gastly knocks
// Phanpy out and Fletchling (Gale Wings: Brave Bird goes first at full HP) takes Gastly and Skorupi; Buneary comes back
// in on Timburr's Ice Punch, flinches it with Fake Out the next turn (it came in during the turn before) and Healing
// Wishes Fletchling back to full, which Brave Birds Timburr and Larvesta.
const KNOWN = {
  6: { lineup: 'Buneary,Fletchling,Phanpy',
    line: 'Fake Out;Drain Punch;>Phanpy;Earthquake;Earthquake/Fletchling;Brave Bird;Brave Bird;>Buneary;Fake Out;Healing Wish;Brave Bird;Brave Bird' },
};
let HINT = null;    // the known line for the lineup being searched: turn -> action
function hintFor(t, team) {
  const k = KNOWN[t.trainer];
  if (!k || k.lineup !== team.map(m => m.label.split(' ')[0]).join(',')) return null;
  const idx = n => team.findIndex(m => m.label.startsWith(n));
  return k.line.split(';').map(x => {
    if (x.startsWith('>')) return { type: 'switch', to: idx(x.slice(1)) };
    const [mv, rep] = x.split('/');
    return { type: 'move', id: moveId(mv), rep: rep ? idx(rep) : null };
  });
}
const same = (a, h) => !!h && a.type === h.type && (a.type === 'switch' ? a.to === h.to : a.id === h.id);
/** The opponent's possible actions this turn: what its AI would pick here (every move tied for the top score, since
 *  the AI breaks ties at random), or with WORST=1 every move it has; and with a Roar-like move of yours, each Pokemon
 *  it could drag in. */
const TIE_DICE = [0, 0.2, 0.4, 0.6, 0.8, 0.999].map(v => { const d = () => v; d.expected = false; return d; });
function aiPicks(st) {
  const out = new Set();
  for (const d of TIE_DICE) {
    const c = SIM.cloneState(st);
    try { const a = AI.choose(c, 'a', d, false, true); if (a && a.type === 'move') out.add(a.id); } catch (e) { /* fall back below */ }
  }
  return [...out];
}
function replies(st, a) {
  const foe = SIM.act(st, 'a');
  if (!foe || foe.fainted) return [{ move: null }];
  const all = SIM.usable(foe, st);
  const picks = process.env.WORST ? [] : aiPicks(st).filter(id => all.includes(id));
  const moves = picks.length ? picks : all;
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
  const h = HINT && HINT[st.turn];
  let acts = actions(st);
  if (h) acts = acts.filter(a => same(a, h)).concat(acts.filter(a => !same(a, h)));
  for (const a of acts) {
    const then = [];
    let ok = true;
    let reps = repsFor(st, a);
    if (same(a, h) && h.rep != null && reps.includes(h.rep)) reps = [h.rep].concat(reps.filter(x => x !== h.rep));
    for (const r of replies(st, a)) {
      // if yours faints, you pick who comes in once you have seen what happened: any one that wins will do
      let sub = null, used = null;
      for (const rep of reps) {
        if (++nodes > limit) throw BUDGET;
        const nx = SIM.cloneState(st);
        nx.policies = { p: you(a, rep), a: fixed(r) };
        SIM.playTurn(nx, SIM.expectedDice());
        sub = guaranteed(nx, depth - 1);
        if (sub) { used = rep; break; }
        if (!replaced(nx, 0)) break;            // nothing fainted: the choice made no difference
      }
      if (!sub) { ok = false; break; }
      then.push([r, sub, used]);
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
    const pick = AI.choose(cur, 'a', SIM.expectedDice(), false, true);
    const r = node.then.find(([x]) => x.move === pick.id) || node.then[0];
    acts.push(r[2] != null ? Object.assign({}, node.a, { rep: r[2] }) : node.a);
    cur.policies = { p: you(node.a, r[2]), a: fixed(r[0]) };
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
    const from = st.log.length, ev = st.events.length;
    const me = SIM.act(st, 'p');
    st.policies = { p: you(a, a.rep), a: AI };
    SIM.playTurn(st, rng);
    const sent = replaced(st, ev) && a.rep != null ? `; if it faints, send in ${st.p.team[a.rep].name}` : '';
    turns.push({ you: (a.type === 'switch' ? `${me.name}: switch to ${st.p.team[a.to].name}` : `${me.name}: ${name(a.id)}`) + sent,
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
/** Replay with real dice. Each turn the search runs again from where the battle stands (a node budget), so a
 *  different AI pick, a miss or a crit is answered; when it finds nothing in time, you keep to the strategy you were
 *  following (its move for the move the boss used), and off it the Coach's planner plays on. */
const bossMoves = (st, from) => st.events.slice(from).filter(e => e.type === 'move' && e.side === 'a').map(e => e.move);
function odds(team, opp, runs, depth, budget, root) {
  let wins = 0;
  const planner = SIM.plannerPolicy();
  for (let r = 0; r < runs; r++) {
    const rng = SIM.mulberry32(1000 + r * 7919);
    const st = SIM.newBattle(team, opp, { lead: 0 });
    st.policies = { p: you(null), a: AI };
    SIM.begin(st, rng);
    let plan = root;
    while (!st.over && st.turn < 40) {
      nodes = 0; memo.clear(); limit = budget;
      let strat = null;
      try { strat = guaranteed(st, depth); } catch (e) { if (e !== BUDGET) throw e; }
      limit = Infinity;
      if (strat && !strat.done) plan = strat;
      const ev = st.events.length;
      if (plan && !plan.done) {
        const node = plan;
        // after a faint, send in the one the strategy picked for the move the boss actually used
        const pick = now => { const used = bossMoves(now, ev); return node.then.find(([x]) => used.includes(x.move)); };
        st.policies = { p: you(node.a, now => { const hit = pick(now); return hit ? hit[2] : null; }), a: AI };
        SIM.playTurn(st, rng);
        const next = pick(st);
        plan = next ? next[1] : null;
      } else {
        st.policies = { p: planner, a: AI };
        SIM.playTurn(st, rng);
      }
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
  // LINEUP=Buneary,Fletchling,Phanpy searches just that lineup (to check a line found by hand)
  const want = process.env.LINEUP ? process.env.LINEUP.split(',').map(n => t.rentals.findIndex(m => m.n.startsWith(n))) : null;
  const todo = want ? [want] : first.length ? first.concat(process.env.ALL ? rest : []) : lineups;
  // a known line's lineup first
  const known = todo.filter(l => hintFor(t, l.map(i => spec(t.rentals[i], 'r' + i))));
  for (const lineup of known.concat(todo.filter(l => !known.includes(l)))) {
    const team = lineup.map(i => spec(t.rentals[i], 'r' + i));
    HINT = hintFor(t, team);
    const st = newState(team, opp);
    nodes = 0; memo.clear(); limit = +(process.env.SEARCH_NODES || 2e6);
    let strat = null;
    try { strat = guaranteed(st, +(process.env.DEPTH || 13)); } catch (e) { if (e !== BUDGET) throw e; process.stderr.write(`  ${team.map(m => m.label).join('/')}: no line within ${limit} turns searched\n`); }
    limit = Infinity;
    if (strat) found.push({ lineup, team, strat, line: lineOf(st, strat), nodes, hint: HINT });
    process.stderr.write(`  ${team.map(m => m.label).join('/')}: ${strat ? 'wins' : 'no line'} (${nodes} turns searched)\n`);
  }
  const scored = found.map(f => { HINT = f.hint; return Object.assign(f, { odds: odds(f.team, opp, +(process.env.RUNS || 40), 10, 20000, f.strat) }); });
  HINT = null;
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
