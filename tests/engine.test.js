const { E, D, test, assert, mon, bossSpecs, mid, sid } = require('./lib');
test('engine: type chart and damage', () => {
  assert(E.typeEff('Water', ['Fire']) === 2 && E.typeEff('Electric', ['Ground']) === 0, 'type chart');
  const sq = mon('Squirtle', 16, { nature: 'Modest', moves: ['Water Gun'] });
  const hippo = bossSpecs(414, 16)[0];
  const d = E.damage(sq, hippo, mid('Water Gun'));
  assert(d && d.minPct > 40 && d.maxPct < 80, 'Water Gun vs Hippopotas ' + (d && d.minPct));
});
test('engine: Hardcore bans', () => {
  assert(E.isBanned(mid('Protect'), 'Pikachu'), 'Protect is banned');
  assert(!E.isBanned(mid('Thunderbolt'), 'Pikachu'), 'Thunderbolt is fine');
});
test('engine: Z-Move damage is stronger than the plain move', () => {
  const r = bossSpecs(416, 36).find(m => /Rotom/.test(m.label));
  const golem = mon('Golem', 36);
  const plain = E.rawRolls(r, golem, mid('Blizzard'), {}), z = E.rawRolls(r, golem, mid('Blizzard'), { z: true });
  assert(z.rolls[15] > plain.rolls[15], 'Z-Blizzard hits harder');
});
