const { SIM, E, test, assert, mon, bossSpecs, mid, D } = require("./lib");
test('sim: a full expected battle ends', () => {
  const st = SIM.runBattle([mon('Squirtle', 16), mon('Pidgey', 15), mon('Mankey', 16)], bossSpecs(414, 16), { expected: true, record: true });
  assert(st.over && ['p', 'a'].includes(st.winner), 'battle finished: ' + st.winner);
});
test('sim: odds are probabilities', () => {
  const r = SIM.simulate([mon('Wartortle', 16), mon('Ivysaur', 16)], bossSpecs(414, 16), { runs: 20 });
  assert(r.pWin >= 0 && r.pWin <= 1 && r.pNoLoss <= r.pWin + 1e-9, 'odds');
});
test('sim: Taunt blocks status moves and Encore locks the last move', () => {
  const st = SIM.newBattle([mon('Pikachu', 20, { moves: ['Thunder Wave', 'Thunder Shock'] })], [mon('Gengar', 40, { moves: ['Taunt', 'Encore'] })], {});
  const p = st.p.team[0];
  p.taunt = 2;
  assert(!SIM.usable(p, st).includes(mid('Thunder Wave')), 'Taunt hides Thunder Wave');
  p.taunt = 0; p.encore = 2; p.encoreMove = mid('Thunder Shock');
  assert(SIM.usable(p, st).length === 1 && SIM.usable(p, st)[0] === mid('Thunder Shock'), 'Encore locks Thunder Shock');
});
test('sim: Sage Power locks into its first move', () => {
  const st = SIM.runBattle([mon('Alakazam', 40, { ability: 'Sage Power', moves: ['Psychic', 'Shadow Ball'] })], [mon('Snorlax', 40)], { expected: true, record: true });
  const used = new Set(st.events.filter(e => e.type === 'move' && e.side === 'p').map(e => e.move));
  assert(used.size === 1, 'Sage Power user used ' + used.size + ' different moves');
});
test('sim: the planner uses your Z-Move when it wins the fight', () => {
  const me = mon('Charizard', 40, { moves: ['Flamethrower', 'Air Slash'], item: 'Firium Z' });
  const foe = mon('Venusaur', 44, { moves: ['Earth Power', 'Sludge Bomb'] });
  const st = SIM.runBattle([me], [foe], { expected: true, record: true });
  assert(st.events.some(e => e.type === 'zmove' && e.side === 'p'), 'player used a Z-Move');
});
test('sim: recorded events say who acted and how the field stands (for battle replays)', () => {
  const st = SIM.newBattle([mon('Charmander', 16, { moves: ['Ember', 'Scratch'] })], bossSpecs(D.bosses[D.bosses.findIndex(b => b.n === 'Brock')].id, 16), { record: true });
  st.policies = { p: SIM.plannerPolicy(), a: SIM.bossPolicy() };
  SIM.begin(st, SIM.expectedDice());
  for (let k = 0; k < 3 && !st.over; k++) SIM.playTurn(st, SIM.expectedDice());
  const kinds = new Set(st.log.map(l => l.kind));
  assert(kinds.has('switch') && kinds.has('move') && kinds.has('dmg'), 'kinds: ' + [...kinds].join(','));
  for (const l of st.log) {
    assert(l.snap && Array.isArray(l.snap.p) && Array.isArray(l.snap.a), 'every event has a snapshot');
    if (l.kind === 'move' || l.kind === 'dmg' || l.kind === 'faint') assert(l.who && (l.who.side === 'p' || l.who.side === 'a') && l.who.i >= 0, 'who for ' + l.kind);
  }
  const hit = st.log.find(l => l.kind === 'dmg');
  const tgt = hit.snap[hit.who.side].find(x => x.i === hit.who.i);
  assert(tgt && tgt.hp < tgt.mhp && E.sp(tgt.s), 'damage shows in the snapshot');
});
test('sim: sampled battles have real luck, replay the same from a seed, and can look for one that goes wrong', () => {
  const brock = D.bosses.find(b => b.n === 'Brock');
  const team = bossSpecs(brock.id, 16);
  const mine = [mon('Squirtle', 16), mon('Pidgey', 15), mon('Mankey', 16)];
  const a = SIM.sampleBattle(mine, team, { seed: 11 }), b = SIM.sampleBattle(mine, team, { seed: 11 });
  assert(a.script && a.script.turns.length > 1, 'a recorded battle');
  assert(JSON.stringify(a.script.turns.map(t => t.lines.map(l => l.text))) === JSON.stringify(b.script.turns.map(t => t.lines.map(l => l.text))), 'same seed, same battle');
  const texts = new Set();
  for (let s = 1; s <= 6; s++) texts.add(JSON.stringify(SIM.sampleBattle(mine, team, { seed: s * 7919 }).script.turns.map(t => t.lines.map(l => l.text))));
  assert(texts.size > 1, 'different seeds, different battles');
  const bad = SIM.sampleBattle(mine, team, { seed: 3, mode: 'bad', tries: 60 });
  assert(bad.script && (bad.script.winner !== 'p' || bad.script.faints.length), 'found one that goes wrong');
  const p = a.script.turns[0].lines[0].snap.p[0];
  assert(Array.isArray(p.mv) && p.mv.length, 'snapshots carry the moves for the move menu');
});
