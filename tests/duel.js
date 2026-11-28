// A small battle for checking one move or ability at a time (tests/moves.test.js, tests/abilities.test.js).
const { SIM, D, mid, sid } = require('./lib');

const nat = n => D.natures.findIndex(x => x.n === n);
/** A Pokemon spec: species, level, moves (names), options { item, ability, nature, key }. */
function spec(name, lv, moves, o = {}) {
  const item = o.item ? +Object.keys(D.items).find(k => D.items[k].n === o.item || D.items[k].c === o.item) : null;
  return Object.assign({ key: o.key || name, label: o.key || name, s: sid(name), lv, nat: nat(o.nature || 'Hardy'), ab: o.ability || 'Run Away', it: item, mv: moves.map(mid) }, o.extra || {});
}
const ALWAYS = () => 0;          // every chance happens: hits land, secondary effects trigger, crits too
const NEVER = () => 0.999;       // no chance happens (no crits, no secondary effects; moves under 100% accuracy miss)
/** A battle: mine and theirs are arrays of specs; plan.p / plan.a give each turn's action: a move name, 'switch:N', or a function. */
function battle(mine, theirs, plan, o = {}) {
  const st = SIM.newBattle(mine, theirs, { record: true });
  const pick = (side, list) => (s, sd) => {
    const t = s.turn - 1, a = typeof list === 'function' ? list(s) : list[Math.min(t, list.length - 1)];
    if (typeof a === 'string' && a.startsWith('switch:')) return { type: 'switch', to: +a.slice(7) };
    const m = s[sd].team[s[sd].slots[0]];
    return { type: 'move', id: a ? mid(a) : m.moves[0] };
  };
  const repl = (s, side) => s[side].team.findIndex((m, i) => !m.fainted && !s[side].slots.includes(i));
  st.policies = { p: { choose: pick('p', plan.p), replace: repl }, a: { choose: pick('a', plan.a), replace: repl } };
  const dice = o.dice || ALWAYS;
  SIM.begin(st, dice);
  if (o.setup) o.setup(st);
  for (let k = 0; k < (o.turns || 1) && !st.over; k++) SIM.playTurn(st, dice);
  return st;
}
const P = st => st.p.team[st.p.slots[0]], A = st => st.a.team[st.a.slots[0]];
const text = st => st.log.map(l => l.text).join(' / ');
const mew = (moves, o) => spec('Mew', 100, moves, o);
const slowMew = (moves, o) => spec('Mew', 100, moves, Object.assign({ nature: 'Brave', key: 'Foe' }, o || {}));
const lax = (o) => spec('Snorlax', 100, ['Splash'], Object.assign({ key: 'Bench' }, o || {}));

module.exports = { spec, battle, ALWAYS, NEVER, P, A, text, mew, slowMew, lax };
