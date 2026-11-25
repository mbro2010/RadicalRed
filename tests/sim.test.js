const { SIM, E, test, assert, mon, bossSpecs, mid } = require('./lib');
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
