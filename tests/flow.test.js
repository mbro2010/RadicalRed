const { D, test, assert } = require('./lib');
const F = require('../app/flow.js')(D);
const name = s => (s.kind === 'fight' ? D.bosses[s.g.first].n : s.kind === 'areas' ? s.areas.join('+') : s.kind);

test('flow: every boss fight is on the path once, in the boss table order (unless the maps say it opens later)', () => {
  const fights = F.steps.filter(s => s.kind === 'fight');
  const seen = fights.flatMap(s => s.g.members);
  const all = D.bosses.filter(b => !b.route).map(b => b.i);
  assert(seen.slice().sort((a, b) => a - b).join() === all.join(), 'each fight once');
  assert(fights.length === F.groups.length, 'one step per fight');
  // in the table's order, except fights moved to right after the milestone that opens them
  const kept = fights.filter(s => s.g.after == null).flatMap(s => s.g.members);
  assert(kept.join() === kept.slice().sort((a, b) => a - b).join(), 'the rest keep the table order');
  for (const s of fights.filter(x => x.g.after != null)) {
    const gate = F.steps.findIndex(x => x.kind === 'fight' && x.g.first === s.g.after);
    assert(gate >= 0 && gate < s.k, `${D.bosses[s.g.first].n} comes after the fight that opens it`);
  }
});
test("flow: Radical Red's gate on Routes 12 and 16 (Erika's and Sabrina's badges) moves their trainers after Sabrina", () => {
  if (!D.world || !D.world.hardcore) return;
  const fight = (n, id) => F.steps.findIndex(s => s.kind === 'fight' && s.g.members.some(i => D.bosses[i].id === id));
  const sabrina = F.steps.findIndex(s => s.kind === 'fight' && D.bosses[s.g.first].n === 'Sabrina');
  for (const id of [199, 250, 285, 477, 300, 206, 307]) assert(fight('', id) > sabrina, `trainer ${id} after Sabrina`);
  const giovanni = F.steps.findIndex(s => s.kind === 'fight' && D.bosses[s.g.first].id === 348);
  assert(giovanni > 0 && F.steps[giovanni].g.after == null, 'the Rocket Hideout stays where it is');
});
test('flow: versions of one fight are grouped, separate grunts are not', () => {
  const g = i => F.groupOf(i).members.length;
  const at = (n, cap, nth) => D.bosses.filter(b => !b.route && b.n === n && b.cap === cap)[nth || 0].i;
  assert(g(at('Terry', 16)) === 3, "the rival's three teams are one fight");
  assert(g(at('Pryce', 73)) === 3 && g(at('Bugsy', 28)) === 2, 'leader versions grouped');
  assert(g(at('Grunt', 47, 1)) === 1 && g(at('Grunt', 47, 2)) === 1, 'two Rocket Hideout grunts are two fights');
  assert(F.variantsOf(at('Terry', 16, 1)).length === 3, 'variantsOf');
});
test('flow: areas with wild Pokemon are placed once, in story order around the fights', () => {
  const placed = F.steps.filter(s => s.kind === 'areas').flatMap(s => s.areas);
  assert(new Set(placed).size === placed.length, 'each area once');
  for (const a of D.areas) assert(placed.includes(a.n), 'missing ' + a.n);
  const pos = n => F.steps.findIndex(s => s.kind === 'areas' && s.areas.includes(n));
  const fight = (n, cap) => F.steps.findIndex(s => s.kind === 'fight' && D.bosses[s.g.first].n === n && D.bosses[s.g.first].cap === cap);
  assert(pos('Route 1') < fight('Terry', 16) && pos('Viridian Forest') < fight('Sammy', 16), 'early game');
  assert(fight('Brock', 16) < pos('Route 3') && pos('Route 3') < fight('Sally', 23), 'Route 3 after Brock');
  assert(pos('Route 4') < fight('Miguel', 23) && pos('Route 4') === pos('Mt. Moon'), "Route 4's west end before Mt. Moon");
  assert(fight('Grunt', 28) < pos('Route 24') && pos('Route 24') < fight('Bugsy', 28) && fight('Misty', 28) > pos('Route 25'), "Route 24's grass past Nugget Bridge, before Bugsy and Misty");
  assert(pos('Pokémon Tower') < fight('Ruth', 56) && fight('Giovanni', 47) < pos('Pokémon Tower'), 'Pokémon Tower after the Hideout');
  assert(pos('Victory Road') < fight('Lorelei', 85), 'Victory Road before the Elite Four');
  // wild levels rise along the path for the main story's grass and caves
  const lv = n => { const a = D.areas.find(x => x.n === n); let hi = 0; for (const p of a.parts) for (const t of Object.values(p.k.land || {})) for (const r of t) hi = Math.max(hi, r[2]); return hi; };
  assert(lv('Route 1') < lv('Route 3') && lv('Route 3') < lv('Route 9') && lv('Route 9') < lv('Safari Zone') && lv('Safari Zone') < lv('Victory Road'), 'levels rise');
  assert(F.waterOnly('Pallet Town') && !F.waterOnly('Route 1'), 'water-only areas');
  assert(F.needOf('Cerulean City').startsWith('Only fishing or surfing here'), 'need note');
});
test('flow: chapters end with the fights that raise the level cap', () => {
  const main = F.chapters.filter(c => !c.post);
  assert(main.length === 17, 'one chapter per cap up to the Elite Four: ' + main.length);
  assert(main[0].cap === 16 && D.bosses[main[0].end.first].n === 'Brock', 'chapter 1 ends with Brock');
  assert(main[16].cap === 85 && !main[16].end, 'last chapter: Victory Road to the Champion');
  assert(F.chapterTitle(main[2]) === 'Misty · Cascade Badge', F.chapterTitle(main[2]));
  assert(F.steps[F.chapters[0].steps[0]].kind === 'start', 'starts with the run');
});
test('flow: progress finds the step to do now', () => {
  let p = F.progress({ beaten: [], enc: {} });
  assert(F.steps[p.current].kind === 'start', 'fresh run: start');
  p = F.progress({ started: 1, beaten: [], enc: {} });
  assert(F.steps[p.current].kind === 'starter', 'then the starter');
  p = F.progress({ started: 1, starter: 1, beaten: [], enc: {} });
  assert(name(F.steps[p.current]) === 'Route 1+Viridian City+Pallet Town+Route 21+Route 22+Route 2+Viridian Forest', 'then the first areas (Route 21\'s grass, Route 2 and Viridian Forest are open before the rival): ' + name(F.steps[p.current]));
  p = F.progress({ started: 1, starter: 1, beaten: [], enc: { 'Route 1': { r: 'caught' }, 'Viridian City': { r: 'failed' }, 'Pallet Town': { r: 'skipped' }, 'Route 21': { r: 'skipped' }, 'Route 22': { r: 'skipped' }, 'Route 2': { r: 'skipped' }, 'Viridian Forest': { r: 'skipped' } } });
  assert(name(F.steps[p.current]) === 'Terry', 'areas done: the rival');
  p = F.progress({ started: 1, starter: 1, beaten: [], enc: {}, passed: ['areas@0'] });
  assert(name(F.steps[p.current]) === 'Terry', 'moving on leaves areas open');
  assert(F.stillOpen({ enc: {} }, p.current).join() === 'Route 1,Viridian City,Pallet Town,Route 21,Route 22,Route 2,Viridian Forest', 'still open');
  const brock = D.bosses.find(b => b.n === 'Brock').i;
  p = F.progress({ started: 1, starter: 1, beaten: [brock], enc: {} });
  assert(name(F.steps[p.current]) === 'Route 3', 'after Brock: Route 3, earlier steps passed');
  const brockStep = F.steps.find(s => s.kind === 'fight' && s.g.members.includes(brock)).k;
  assert(p.steps.slice(0, brockStep).every(s => s.done || s.passed), 'every step before Brock is done or passed');
  assert(p.steps.slice(2, brockStep).every(s => s.passed), 'unlogged steps you went past count as passed');
  const sally = D.bosses.find(b => b.n === 'Sally').i;
  p = F.progress({ started: 1, starter: 1, beaten: [brock], skipped: [sally], passed: ['areas@' + sally], enc: {} });
  assert(name(F.steps[p.current]) === 'Route 4+Mt. Moon', 'skipping a fight moves on: ' + name(F.steps[p.current]));
  // the Champion: celebrate, and the post-game only when chosen
  const beatenAll = D.bosses.filter(b => !b.route && b.i <= F.champ.members[2]).map(b => b.i);
  p = F.progress({ started: 1, starter: 1, beaten: beatenAll, enc: {} });
  assert(F.steps[p.current].kind === 'champion', 'champion step');
  p = F.progress({ started: 1, starter: 1, beaten: beatenAll, enc: {}, postgame: true });
  assert(F.steps[p.current].post, 'post-game after choosing it');
});
test('flow: the rival team follows your starter', () => {
  const g = F.groupOf(D.bosses.find(b => b.n === 'Terry').i);
  const pick = line => D.bosses[F.chosenFight(g, {}, line)].v;
  assert(pick('Squirtle') === 'Squirtle' && pick('Bulbasaur') === 'Bulbasaur' && pick('Charmander') === 'Charmander', 'rival line');
  assert(F.chosenFight(g, { variants: { [g.first]: g.members[1] } }, 'Squirtle') === g.members[1], 'your pick wins');
});
test('flow: every area comes before the fights held there (fight places from the ROM scripts)', () => {
  const located = D.bosses.filter(b => b.loc && b.loc.length).length;
  assert(located >= 150, 'boss fights with a place: ' + located);
  const pos = n => F.steps.findIndex(s => s.kind === 'areas' && s.areas.includes(n));
  // Route 24's grass is north of Nugget Bridge: the bridge trainers come first
  const past = { 'Route 24': ['Cale', 'Ali', 'Timmy', 'Reli', 'Ethan', 'Grunt'] };
  for (const s of F.steps) if (s.kind === 'fight') for (const i of s.g.members) for (const a of D.bosses[i].loc || []) {
    const p = pos(a);
    if ((past[a] || []).includes(D.bosses[i].n)) { assert(p > s.k, `${a} after ${D.bosses[i].n}`); continue; }
    assert(p < 0 || p < s.k, `${a} is placed after ${D.bosses[i].n} (#${i}), who is fought there`);
  }
});
test('flow: water-only areas follow where Radical Red hands out the rods', () => {
  assert(D.rods['Old Rod'][0] === 'Viridian City' && D.rods['Good Rod'][0] === 'Vermilion City' && D.rods['Super Rod'][0] === 'Fuchsia City', 'rods from the ROM');
  const first = F.steps.find(s => s.kind === 'areas');
  assert(first.areas.includes('Pallet Town') && first.areas.includes('Viridian City'), 'Pallet Town fishing with the Old Rod from the start');
  assert(F.needOf('Pallet Town').includes('Old Rod: Viridian City'), F.needOf('Pallet Town'));
});

test('flow: Normal Mode chapters follow its level caps', () => {
  const createFlow = require('../app/flow.js');
  const F = createFlow(Object.assign({}, D, { bosses: D.bosses.map(b => Object.assign({}, b, { cap: D.caps.normal[b.mi] })) }), 'normal');
  assert(F.chapters[0].cap === 15 && F.chapters[1].cap === 22, 'normal chapter caps: ' + F.chapters.slice(0, 3).map(c => c.cap));
});
test('flow: the world data opens Route 5 early, behind the optional fight with the Dig Grunt in Cerulean (before Misty)', () => {
  if (!D.world || !D.world.hardcore) return;
  const FH = require('../app/flow.js')(D, 'hardcore');
  const misty = FH.steps.findIndex(s => s.kind === 'fight' && D.bosses[s.g.first].n === 'Misty' && D.bosses[s.g.first].cap === 28);
  const bugsy = FH.steps.findIndex(s => s.kind === 'fight' && D.bosses[s.g.first].n === 'Bugsy');
  const grunt = D.bosses.find(b => b.id === 356);
  const run = { beaten: [grunt.i], enc: {} };
  const early = FH.openEarly(run, bugsy);
  const r5 = early.find(x => x.area === 'Route 5');
  assert(r5 && r5.via === 355, 'Route 5 opens once you beat the Dig Grunt (#355)');
  assert(bugsy < misty, 'and that is before Misty');
  const done = FH.openEarly({ beaten: [grunt.i, D.bosses.find(b => b.id === 355).i], enc: {} }, bugsy).find(x => x.area === 'Route 5');
  assert(done && done.via == null, 'with the Dig Grunt beaten it is simply open');
});
