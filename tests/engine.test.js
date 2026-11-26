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
test('advice: the plan\'s setup hands out held items by biggest gain, as many as you have, then natures only where they matter', () => {
  const { ADV } = require('./lib');
  const item = n => +Object.keys(D.items).find(k => D.items[k].n === n);
  const team = bossSpecs(414);   // Brock
  const wart = mon('Wartortle', 16, { moves: ['Water Gun', 'Bite', 'Rapid Spin', 'Withdraw'] });
  const mankey = (key, o) => mon('Mankey', 16, Object.assign({ key, moves: ['Karate Chop', 'Low Kick', 'Fury Swipes'] }, o));
  // one Mystic Water and one Black Belt: each goes where it wins matchups
  let r = ADV.planSetup([wart, mankey('M1')], team, [[item('Mystic Water'), 1], [item('Black Belt'), 1]]);
  const by = k => r.info.find(x => x.key === k);
  assert(r.changed, 'something changes');
  assert(by('Wartortle').it === item('Mystic Water'), 'Wartortle holds Mystic Water: ' + by('Wartortle').it);
  assert(by('M1').it === item('Black Belt'), 'Mankey holds Black Belt: ' + by('M1').it);
  // only one Black Belt for two Mankey
  r = ADV.planSetup([mankey('M1'), mankey('M2')], team, [[item('Black Belt'), 1]]);
  assert(r.info.filter(x => x.it === item('Black Belt')).length === 1, 'one Black Belt handed out');
  // nothing better: it keeps what it holds; an item it must keep stays even when something is better
  r = ADV.planSetup([mankey('M1', { item: 'Oran Berry' })], team, [[item('Oran Berry'), 1]]);
  assert(r.info[0].it === item('Oran Berry'), 'keeps its Oran Berry');
  r = ADV.planSetup([Object.assign(mankey('M1', { item: 'Everstone' }), { keepItem: true })], team, [[item('Everstone'), 1], [item('Black Belt'), 1]]);
  assert(r.info[0].it === item('Everstone'), 'Everstone stays on a Pokemon you stopped evolving');
  // a nature changes only with a real gain, the specs carry the setup, and nothing changes with nothing to give
  r = ADV.planSetup([wart, mankey('M1')], team, [[item('Mystic Water'), 1], [item('Black Belt'), 1]]);
  for (const x of r.info) assert(x.nat === x.natFrom || x.gNat >= 0.3, `${x.key}: a nature change needs a real gain (${x.gNat})`);
  r.specs.forEach((s, k) => assert(s.it === r.info[k].it && s.nat === r.info[k].nat, 'specs carry the setup'));
  const strong = mon('Wartortle', 16, { nature: 'Modest', moves: ['Water Gun', 'Bite', 'Rapid Spin', 'Withdraw'] });
  assert(!ADV.planSetup([strong], team, []).changed || ADV.planSetup([strong], team, []).info[0].gNat >= 0.3, 'no change without a gain');
});
test('engine: crit odds count items and abilities (the Leek Stick), accuracy counts Hustle, priority counts Gale Wings; Rollout adds up', () => {
  const m = n => D.moves.find(x => x.f === n);
  const item = n => +Object.keys(D.items).find(k => D.items[k].n === n);
  const farf = mon('Farfetch’d-Galar', 20, { item: 'Leek Stick', moves: ['Slam'] });
  const target = mon('Rattata', 20);
  assert(Math.abs(E.critChanceOf(farf, target, m('Slam')) - 0.5) < 1e-9, 'Leek Stick on Galarian Farfetch’d: crits half the time');
  assert(Math.abs(E.critChanceOf(Object.assign({}, target, { it: item('Scope Lens') }), target, m('Tackle')) - 1 / 8) < 1e-9, 'Scope Lens: 1 in 8');
  assert(E.critChanceOf(target, mon('Shellder', 20, { ability: 'Shell Armor' }), m('Slash')) === 0, 'Shell Armor: no crits');
  assert(Math.abs(E.accuracyOf(mon('Rufflet', 12, { ability: 'Hustle' }), target, m('Aerial Ace')) - 1) < 1e-9, 'Aerial Ace never misses, Hustle or not');
  assert(Math.abs(E.accuracyOf(mon('Rufflet', 12, { ability: 'Hustle' }), target, m('Rock Tomb')) - m('Rock Tomb').a / 100 * 0.8) < 1e-9, 'Hustle: physical moves 20% less accurate');
  assert(E.priorityOfMove(mon('Talonflame', 50, { ability: 'Gale Wings' }), m('Brave Bird')) === 1, 'Gale Wings at full HP: +1');
  assert(E.priorityOfMove(Object.assign(mon('Talonflame', 50, { ability: 'Gale Wings' }), { hpPct: 90 }), m('Brave Bird')) === 0, 'not below full HP');
  // Rollout's hits double, so a matchup needs fewer of them than its first hit suggests
  const geo = mon('Geodude', 15, { moves: ['Rollout'] }), bliss = mon('Chansey', 30, { moves: ['Pound'] });
  const d = E.damage(geo, bliss, m('Rollout').i);
  assert(d.seq && d.seq.length === 5 && d.seq[1] > d.seq[0] && d.seq[4] > 10 * d.seq[0], 'Rollout grows: ' + (d.seq || []).join(','));
  const mu = E.matchup(geo, bliss);
  assert(mu.toKOthem < Math.ceil(d.cur / d.min), 'fewer hits than the first one says');
  // Normal Mode's regular-table trainers get the species' ability and a neutral nature
  const any = D.bosses.findIndex(b => (b.np || []).some(x => x.ab == null));
  if (any >= 0) { const b = D.bosses[any], saved = b.party; b.party = b.np; const t = E.bossTeam(any, 20); b.party = saved; assert(t.every(x => x.ab && x.nat != null), 'abilities and natures filled in'); }
});
