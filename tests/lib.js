// Shared setup for the Node tests: the app's own modules with the game data (app/rrdata.json).
const C = require('@smogon/calc');
const D = require('../app/rrdata.json');
const E = require('../app/engine.js')(C, D);
const SIM = require('../app/sim.js')(E);
const ADV = require('../app/advice.js')(E);
const SR = require('../app/save.js')(D);

const sid = n => { const s = D.species.find(x => x.n === n) || D.species.find(x => x.g === n); if (!s) throw new Error('no species ' + n); return s.i; };
const mid = n => { const m = D.moves.find(x => x.f === n || x.n === n); if (!m) throw new Error('no move ' + n); return m.i; };
const nat = n => D.natures.findIndex(x => x.n === n);
function levelMoves(s, lv) {
  const k = [];
  for (const [l, id] of (D.learn[s] || { l: [] }).l) if (l <= lv && E.mv(id) && !k.includes(id)) { k.push(id); if (k.length > 4) k.shift(); }
  return k;
}
/** A player Pokemon spec: name, level, optional { nature, moves (names), item (name), ability, key }. */
function mon(name, lv, o = {}) {
  const s = sid(name);
  const item = o.item ? +Object.keys(D.items).find(k => D.items[k].n === o.item) : null;
  return { key: o.key || name, label: name, s, lv, nat: nat(o.nature || 'Hardy'), ab: o.ability || E.sp(s).a[0], it: item, mv: o.moves ? o.moves.map(mid) : levelMoves(s, lv) };
}
function bossSpecs(id, top) {
  const bi = D.bosses.findIndex(b => b.id === id);
  return E.bossTeam(bi, top || D.bosses[bi].cap).map((m, i) => Object.assign({ key: 'b' + i, label: E.sp(m.s).n }, m));
}
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
module.exports = { C, D, E, SIM, ADV, SR, sid, mid, nat, mon, bossSpecs, levelMoves, test, assert, tests };
