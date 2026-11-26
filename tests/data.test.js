const { D, E, test, assert, sid } = require('./lib');
test('data: species, moves, bosses and caps are present', () => {
  assert(D.species.length > 1300, 'species');
  assert(D.moves.length > 800, 'moves');
  assert(D.bosses.length === 153, 'Hardcore boss fights: ' + D.bosses.length);
  assert(D.caps.hardcore.slice(0, 4).join() === '16,23,28,36', 'first Hardcore caps');
  for (const b of D.bosses) for (const m of b.party) { assert(E.sp(m.s), `${b.n}: unknown species ${m.s}`); for (const id of m.mv) assert(E.mv(id), `${b.n}: unknown move ${id}`); }
});
test('data: Radical Red evolution levels come from the ROM', () => {
  const lv = n => D.evo[sid(n)][0][3];
  assert(lv('Rattata') === 'Level 16' && lv('Poochyena') === 'Level 16' && lv('Ivysaur') === 'Level 36', 'evolution levels');
  assert(D.mega[sid('Ampharos')][0][1] === sid('Ampharos-Mega'), 'Ampharosite gives Mega Ampharos');
});
test('data: encounters have separate day and night tables', () => {
  const r1 = D.areas.find(a => a.n === 'Route 1');
  const land = r1.parts[0].k.land;
  const names = t => land[t].map(r => E.sp(r[0]).n);
  assert(names('night').includes('Hoothoot') && !names('day').includes('Hoothoot'), 'Hoothoot only at night');
  assert(D.areas.length >= 70, 'areas');
});
test('data: move tutors and route trainers', () => {
  const tutorMoves = new Set(Object.values(D.learn).flatMap(L => L.u || []));
  assert(tutorMoves.size >= 120, 'tutor moves ' + tutorMoves.size);
  assert(Object.keys(D.trainers).length > 300, 'route trainers');
});
test('data: 27 starters with tiers', () => {
  const T = require('../app/starters.json');
  assert(T.starters.length === 27, 'starters');
  assert(T.starters.every(s => 'SABCD'.includes(s.tier)), 'tiers');
  // the first fights are also played out whole, the starter alone against their team
  assert(T.starters.every(s => s.first != null && s.fights.filter(f => f[5] != null).length >= 4), 'first fights played out');
  const brock = s => s.fights.find(f => f[0] === 'Brock' && f[1] === 16);
  assert(T.starters.every(s => brock(s)[5] < 0.5), 'no starter beats Hardcore Brock alone');
});
test('data: gifts, items and TM locations from the map scripts', () => {
  const r4 = D.finds['Route 4'];
  assert(r4 && r4.i.some(([id]) => D.items[id].n === 'TM05'), 'TM05 on Route 4');
  assert(r4.g.some(([k, s]) => k === 'g' && E.sp(s).g === 'Magikarp'), 'Magikarp gift on Route 4');
  assert(D.finds['Viridian Forest'].g.some(([k, s]) => k === 's' && E.sp(s).g === 'Virizion'), 'static Virizion');
  assert(Object.keys(D.tmWhere).length >= 100, 'TM locations ' + Object.keys(D.tmWhere).length);
});
test('data: the care package cheat (SO2Toxic) by checkpoint, Hardcore lists', () => {
  const name = id => D.items[id] && D.items[id].n;
  const at = (area, after) => D.care.find(p => p.area === area && (after ? p.after === after : !p.after));
  assert(D.care.length === 16, 'sixteen packages: ' + D.care.length);
  assert(at('Route 2') && at('Route 2').items.some(([id]) => name(id) === 'Mystic Water'), 'the DexNav aide on Route 2 hands over the type items');
  assert(at('Cinnabar Island', 'Volcano Badge').items.some(([id]) => name(id) === 'Life Orb'), 'Life Orb after Blaine');
  assert(at('Pallet Town', 'Champion').items.some(([id]) => name(id) === 'Choice Band'), 'the Choice items only after the Champion');
  assert(at('Fuchsia City').items.some(([id]) => name(id) === 'Leftovers'), 'Leftovers in Fuchsia City');
  const all = D.care.flatMap(p => p.items.map(([id]) => name(id)));
  for (const n of ['WeaknessPol.', 'Heat Rock', 'Throat Spray', 'Air Balloon', 'Protein']) assert(!all.includes(n), 'Hardcore leaves out ' + n);
});
