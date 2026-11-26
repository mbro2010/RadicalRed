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
test('advice: level-up move prompt (learn Bite over Scratch, keep Leer; skip a move that adds nothing)', () => {
  const { ADV } = require('./lib');
  const rival = D.bosses.findIndex(b => b.n === 'Terry');
  const toto = mon('Totodile', 13, { ability: 'Sheer Force', moves: ['Scratch', 'Leer', 'Aqua Jet', 'Rage'] });
  const a = ADV.learnAdvice(toto, mid('Bite'), rival, 2);
  // Scratch only repeats what Bite does; Leer first (their Defense down) makes Brock's Lunatone and Varoom safer
  assert(a.learn && a.forget === mid('Scratch'), 'learn Bite, forget Scratch: ' + JSON.stringify(a));
  const full = Object.assign({}, toto, { mv: [mid('Bite'), mid('Ice Fang'), mid('Aqua Jet'), mid('Crunch')] });
  // Scary Face (their Speed -2) lets it move first against Yanma and Lunatone; Bite only repeats Crunch
  const b = ADV.learnAdvice(full, mid('Scary Face'), rival, 2);
  assert(b.learn && b.forget === mid('Bite'), 'Scary Face replaces the redundant Bite: ' + JSON.stringify(b));
  const c = ADV.learnAdvice(full, mid('Splash'), rival, 2);
  assert(!c.learn, 'Splash adds nothing: ' + JSON.stringify(c));
  const free = ADV.learnAdvice(Object.assign({}, toto, { mv: [mid('Scratch')] }), mid('Bite'), rival, 2);
  assert(free.learn && free.forget == null, 'a free slot just learns it');
});

test('advice: status and stat moves count when they turn a fight (Sleep Powder over Growl; not where it still loses)', () => {
  const { ADV, SIM } = require('./lib');
  const brock = D.bosses.findIndex(b => b.n === 'Brock');
  const bulba = mon('Bulbasaur', 13, { moves: ['Tackle', 'Vine Whip', 'Growl', 'Leech Seed'] });
  const a = ADV.learnAdvice(bulba, mid('Sleep Powder'), brock, 2);
  assert(a.learn && a.forget === mid('Growl'), 'learn Sleep Powder, forget Growl: ' + JSON.stringify(a));
  assert(/Sleep Powder first/.test(a.reason), 'says Sleep Powder first is what helps: ' + a.reason);
  // a status move gets no credit in a race it can't win: no way to knock the foe out
  const lunatone = E.bossTeam(brock, 16).find(t => E.sp(t.s).n === 'Lunatone');
  const pika = mon('Pikachu', 16, { moves: ['Thunder Shock', 'Thunder Wave'] });
  const p = ADV.duelPlan(pika, Object.assign({}, lunatone, { ab: 'Levitate' }), pika.mv);
  assert(p.via == null || p.verdict !== 'lose', 'no credit for paralysis in a lost race: ' + JSON.stringify(p));
  // the odds behind it: a paralyzed foe that needs 2 hits in 2 chances lands both 56% of the time
  const r = SIM.statusRisk({ hitsTaken: 2, toKOme: 2, risk: 1 }, 'par');
  assert(Math.abs(r - 0.5625) < 1e-9, 'paralysis odds: ' + r);
});

test('engine: Normal Mode drops Hardcore\'s move bans and ability changes; level-following bosses come 2 lower', () => {
  const ban = D.bans.moves[0];
  const rel = D.bosses.findIndex(b => b.party.some(m => m.rel != null));
  const relMon = D.bosses[rel].party.findIndex(m => m.rel != null);
  try {
    assert(E.isBanned(ban, 'Pikachu') && E.hardcoreAbility('Drizzle', sid('Politoed')) === 'Adaptability', 'Hardcore rules');
    const hard = E.bossTeam(rel, 30)[relMon].lv;
    E.setMode('normal');
    assert(!E.isBanned(ban, 'Pikachu') && E.hardcoreAbility('Drizzle', sid('Politoed')) === 'Drizzle', 'no Hardcore rules in Normal');
    assert(E.bossTeam(rel, 30)[relMon].lv === hard - 2, 'two levels lower outside Hardcore');
    E.setMode('normal', true);
    assert(E.bossTeam(rel, 30)[relMon].lv === hard, 'not once the game is cleared');
  } finally { E.setMode('hardcore'); }
});
