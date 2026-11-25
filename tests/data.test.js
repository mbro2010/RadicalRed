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
});
