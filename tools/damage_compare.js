// Compare the engine's damage rolls with the game's (from tools/game_damage.py).  node tools/damage_compare.js out.json [--list kind]
const cases = require(require('path').resolve(process.argv[2]));
const listKind = process.argv[3] === '--list' ? process.argv[4] : null;
const showClose = process.argv.includes('--close');
const by = {};
let exact = 0, close = 0, off = 0, err = 0, immune = 0;
const bad = [];
for (const c of cases) {
  const k = c.kind;
  const b = by[k] || (by[k] = { n: 0, exact: 0, close: 0, off: 0, err: 0 });
  b.n++;
  if (!c.game || !c.engine) { b.err++; err++; continue; }
  // an immune target: the game's type step leaves 1 (the move fails before it lands), the engine says 0
  if (c.engine.every(x => x === 0) && (c.flags & 8 || c.game.every(x => x <= 1))) { b.exact++; exact++; continue; }
  // the game stops these before its damage step (absorbing abilities and the like), which the harness doesn't run
  if (c.immune && c.engine.every(x => x === 0)) { b.immune = (b.immune || 0) + 1; immune++; continue; }
  // Focus Sash, Focus Band and Sturdy leave the target at 1 HP in the game's last step; the engine leaves that to the battle
  if (c.def && c.def.hp === c.def.stats[0] && c.game.every((x, i) => x === c.engine[i] || (x === c.def.hp - 1 && c.engine[i] >= c.def.hp))) { b.exact++; exact++; continue; }
  const diffs = c.engine.map((x, i) => x - c.game[i]);
  const maxAbs = Math.max(...diffs.map(Math.abs));
  const maxG = Math.max(...c.game);
  if (maxAbs === 0) { b.exact++; exact++; }
  else if (maxAbs <= Math.max(1, Math.ceil(maxG * 0.02))) { b.close++; close++; if (showClose) bad.push({ c, ratio: (c.engine[15] / Math.max(1, c.game[15])).toFixed(2) }); }   // within 2% (or 1 HP) on every roll
  else { b.off++; off++; bad.push({ c, ratio: (c.engine[15] / Math.max(1, c.game[15])).toFixed(2) }); }
}
console.log(`cases ${cases.length}: exact ${exact}, within 2% ${close}, off ${off}, errors ${err}, blocked before damage ${immune}`);
for (const [k, b] of Object.entries(by)) console.log(`  ${k.padEnd(11)} ${b.n} cases: exact ${b.exact}, close ${b.close}, off ${b.off}, errors ${b.err}`);
const show = bad.filter(x => !listKind || x.c.kind === listKind).slice(0, listKind ? 60 : 25);
for (const { c, ratio } of show) {
  const s = c.spec;
  console.log(`#${c.id} ${c.kind} ${s.move} | ${s.atk.ab}${s.atk.it ? ' @' + s.atk.it : ''}${s.atk.status ? ' ' + s.atk.status : ''} -> ${s.def.ab}${s.def.it ? ' @' + s.def.it : ''} | w:${c.weather} t:${c.terrain} R:${c.reflect ? 1 : 0} L:${c.lightScreen ? 1 : 0} crit:${c.crit ? 1 : 0} | engine ${c.engine[0]}-${c.engine[15]} game ${c.game[0]}-${c.game[15]} (x${ratio})`);
}
