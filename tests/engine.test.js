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
test('engine: Hardcore ability changes (decoded from 0x09079584)', () => {
  const s = n => require('./lib').sid(n);
  assert(E.hardcoreAbility('Drizzle', s('Pelipper')) === 'Adaptability', 'Drizzle');
  assert(E.hardcoreAbility('Speed Boost', s('Ninjask')) === 'Infiltrator', 'Speed Boost');
  assert(E.hardcoreAbility('Sand Stream', 248) === 'Intimidate' && E.hardcoreAbility('Sand Stream', 579) === 'Solid Rock' && E.hardcoreAbility('Sand Stream', s('Hippowdon')) === 'Sand Force', 'Sand Stream by species');
  assert(E.hardcoreAbility('Contrary', 308) === 'Contrary' && E.hardcoreAbility('Contrary', s('Serperior')) === 'Bad Company', 'Contrary');
  assert(E.hardcoreAbility('Overgrow', 1) === 'Overgrow', 'others unchanged');
});
test('engine: a one-on-one matchup is played with the attack that wins it, not just the strongest one', () => {
  // Totodile at 16 vs Brock's Lunatone: Bite hits harder, but Aqua Jet moves first and wins
  const brock = D.bosses.findIndex(b => b.n === 'Brock');
  const lunatone = E.bossTeam(brock, 16).find(t => E.sp(t.s).n === 'Lunatone');
  const toto = mon('Totodile', 16, { ability: 'Sheer Force', moves: ['Scratch', 'Bite', 'Aqua Jet', 'Rage'] });
  const m = E.matchup(toto, lunatone);
  const onlyJet = E.matchup(Object.assign({}, toto, { mv: [mid('Aqua Jet')] }), lunatone);
  assert(m.risk <= onlyJet.risk + 1e-9, `adding moves never makes a matchup worse (${m.risk} vs ${onlyJet.risk})`);
  assert(m.best && m.best.moveName === 'Aqua Jet' && m.meFirst, 'picks Aqua Jet and moves first: ' + (m.best && m.best.moveName));
});
test('advice: level-up move prompt (learn Bite over Leer; skip a move that adds nothing)', () => {
  const { ADV } = require('./lib');
  const rival = D.bosses.findIndex(b => b.n === 'Terry');
  const toto = mon('Totodile', 13, { ability: 'Sheer Force', moves: ['Scratch', 'Leer', 'Aqua Jet', 'Rage'] });
  const a = ADV.learnAdvice(toto, mid('Bite'), rival, 2);
  assert(a.learn && a.forget === mid('Leer'), 'learn Bite, forget Leer: ' + JSON.stringify(a));
  const b = ADV.learnAdvice(Object.assign({}, toto, { mv: [mid('Bite'), mid('Ice Fang'), mid('Aqua Jet'), mid('Crunch')] }), mid('Scary Face'), rival, 2);
  assert(!b.learn, 'Scary Face adds nothing to a full attacking set: ' + JSON.stringify(b));
  const free = ADV.learnAdvice(Object.assign({}, toto, { mv: [mid('Scratch')] }), mid('Bite'), rival, 2);
  assert(free.learn && free.forget == null, 'a free slot just learns it');
});
