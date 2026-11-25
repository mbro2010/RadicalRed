const { SIM, E, D, test, assert, mon, bossSpecs, mid } = require('./lib');
function battle(player, boss, opts) { const st = SIM.newBattle(player, boss, opts || {}); st.policies = { p: SIM.plannerPolicy(), a: SIM.bossPolicy() }; st.turn = 1; return st; }
test('ai: takes a knockout that moves first (+9)', () => {
  const rotom = bossSpecs(416, 36).find(m => /Rotom/.test(m.label));
  const st = battle([mon('Golem', 36), mon('Venusaur', 36)], [rotom]);
  const r = st.policies.a.choose(st, 'a', SIM.expectedDice(), true, true);
  const top = r.scores.find(s => s.id === r.id);
  assert(top.score >= 109, 'KO move scored ' + top.score);
});
test('ai: Z-Move when the plain move would not surely knock out', () => {
  const rotom = bossSpecs(416, 36).find(m => /Rotom/.test(m.label));
  const st = battle([mon('Golem', 36), mon('Venusaur', 36)], [rotom]);
  const r = st.policies.a.choose(st, 'a', SIM.expectedDice(), true, true);
  assert(r.z === true && E.mv(r.id).f === 'Blizzard', 'expected Z-Blizzard, got ' + E.mv(r.id).f + (r.z ? ' (Z)' : ''));
});
test('ai: switches to a Pokemon that absorbs the predicted move', () => {
  const st = battle([mon('Squirtle', 16, { nature: 'Modest', moves: ['Water Gun', 'Bite', 'Rapid Spin', 'Water Pulse'] })], bossSpecs(414, 16));
  const r = st.policies.a.choose(st, 'a', SIM.expectedDice(), true, true);
  assert(r.type === 'switch' && /absorbs/.test(r.why), 'expected an absorb switch, got ' + JSON.stringify(r).slice(0, 80));
});
test('ai: Mega Evolves on its first move', () => {
  const amph = bossSpecs(416, 36).find(m => /Ampharos/.test(m.label));
  const st = SIM.runBattle([mon('Golem', 36)], [amph], { expected: true, record: true });
  assert(st.events.some(e => e.type === 'mega'), 'Mega Evolution happened');
});
test('ai: fighting styles', () => {
  const rotom = bossSpecs(416, 36).find(m => /Rotom/.test(m.label));
  const st = battle([mon('Golem', 36)], [rotom]);
  assert(SIM.AI.fightingStyle(st, st.a.team[0]) === 'setup', 'Rotom-Frost with Nasty Plot is a set-up sweeper');
});
