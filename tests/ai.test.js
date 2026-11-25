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
test('ai: Power-Up Punch scores like setup (Route 22 rival, Snubbull vs Totodile): paralyze, then punch and boost', () => {
  const { D } = require('./lib');
  const team = E.bossTeam(1, 16).map((t, i) => Object.assign({ key: 'b' + i, label: E.sp(t.s).n }, t));
  const st = SIM.newBattle([mon('Totodile', 16), mon('Pidgey', 15)], team, { record: true });
  st.policies = { p: SIM.plannerPolicy(), a: SIM.bossPolicy() };
  SIM.begin(st, SIM.expectedDice());
  const picks = [];
  for (let k = 0; k < 3 && !st.over; k++) {
    const a = st.policies.a.choose(st, 'a', SIM.expectedDice(), true, true);
    picks.push(a.type === 'move' ? E.mv(a.id).f : 'switch');
    if (k === 1) {
      const pup = Object.values(a.scores).find(s => E.mv(s.id).f === 'Power-Up Punch');
      assert(pup && pup.why.some(w => /raises Attack/.test(w)), 'Power-Up Punch gets the setup bonus: ' + JSON.stringify(pup));
    }
    SIM.playTurn(st, SIM.expectedDice());
  }
  assert(picks[0] === 'Thunder Wave' && picks[1] === 'Power-Up Punch' && picks[2] === 'Power-Up Punch', picks.join(', '));
  void D;
});
test('ai: replacements on equal scores are a coin flip unless one would faint (CalcMostSuitableMonToSwitchInto)', () => {
  const lead = bossSpecs(414, 16)[0];
  const twin = k => Object.assign({}, bossSpecs(414, 16)[1], { key: 'twin' + k, label: 'Twin ' + k });
  const st = SIM.newBattle([mon('Squirtle', 16)], [lead, twin(1), twin(2)], {});
  st.a.team[0].fainted = true; st.a.team[0].hp = 0;
  const choices = SIM.AI.switchChoices(st, 'a');
  assert(choices.length === 2 && choices.includes(1) && choices.includes(2), 'both twins are possible: ' + JSON.stringify(choices));
  const picked = new Set();
  for (let seed = 1; seed < 40; seed++) picked.add(SIM.bossPolicy().replace(st, 'a', SIM.mulberry32(seed), 'faint', 0));
  assert(picked.has(1) && picked.has(2), 'a coin flip picks either: ' + [...picked].join(','));
});
test('ai: switches out when only bad moves are left (Snubbull to Squirtle against a paralyzed Tentacool, as in run 2)', () => {
  const rival = D.bosses.findIndex(b => b.n === 'Terry' && b.party.some(m => E.sp(m.s).n === 'Squirtle'));
  const team = E.bossTeam(rival, 16).map((t, i) => Object.assign({ key: 'b' + i, label: E.sp(t.s).n }, t));
  const st = battle([mon('Tentacool', 16, { moves: ['Acid', 'Water Gun', 'Wrap', 'Supersonic'] }), mon('Charmeleon', 16)], team);
  let r = st.policies.a.choose(st, 'a', SIM.expectedDice(), true, true);
  assert(r.type === 'move' && E.mv(r.id).f === 'Thunder Wave', 'turn 1: Thunder Wave still works, so no switch: ' + JSON.stringify(r).slice(0, 60));
  SIM.actives(st, 'p')[0].status = 'par';
  r = st.policies.a.choose(st, 'a', SIM.expectedDice(), true, true);
  assert(r.type === 'switch' && st.a.team[r.to].name === 'Squirtle' && /only bad moves/.test(r.why), 'then every attack is resisted: switch to Squirtle, got ' + JSON.stringify(r).slice(0, 80));
});
test('ai: the switching cooldown (2 after a chosen switch, 1 after a replacement, cleared when the player switches)', () => {
  const st = SIM.newBattle([mon('Tentacool', 16), mon('Charmeleon', 16)], bossSpecs(414, 16), {});
  st.policies = { p: SIM.plannerPolicy(), a: SIM.bossPolicy() };
  st.turn = 3;
  SIM.switchIn(st, 'a', 1, SIM.expectedDice(), 'switch', 0);
  assert(SIM.actives(st, 'a')[0].swCooldown === 2, 'a chosen switch sets 2');
  SIM.switchIn(st, 'p', 1, SIM.expectedDice(), 'switch', 0);
  assert(SIM.actives(st, 'a')[0].swCooldown === 0, 'the player switching in clears it');
  SIM.switchIn(st, 'a', 2, SIM.expectedDice(), 'replace', 0);
  assert(SIM.actives(st, 'a')[0].swCooldown === 1, 'a replacement after a faint sets 1');
});
