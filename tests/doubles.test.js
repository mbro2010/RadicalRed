const { D, E, SIM, test, assert, mon, mid } = require('./lib');
const bossOf = name => { const b = D.bosses.find(x => x.dbl && x.n === name); const bi = D.bosses.indexOf(b); return E.bossTeam(bi, b.cap).map((m, i) => Object.assign({ key: 'b' + i, label: E.sp(m.s).n }, m)); };
const team23 = () => [mon('Wartortle', 23), mon('Ivysaur', 23), mon('Pidgeotto', 23), mon('Raichu', 23), mon('Graveler', 23), mon('Nidorino', 23)];
test('doubles: 26 Hardcore boss fights are double battles', () => {
  assert(D.bosses.filter(b => b.dbl).length === 26, 'doubles count');
});
test('doubles: both sides start with two Pokemon and the battle ends', () => {
  const st = SIM.runBattle(team23(), bossOf('Miguel'), { doubles: true, expected: true, record: true });
  const lead = st.events.find(e => e.type === 'lead');
  assert(lead.pAll.length === 2 && lead.aAll.length === 2, 'two leads each');
  assert(st.over && ['p', 'a'].includes(st.winner), 'finished');
});
test('doubles: spread moves hit both foes for 75%', () => {
  const st = SIM.newBattle([mon('Graveler', 30, { moves: ['Rock Slide'] }), mon('Pikachu', 30, { moves: ['Thunder Shock'] })],
    [mon('Charmander', 30, { moves: ['Scratch'] }), mon('Pidgey', 30, { moves: ['Tackle'] })], { doubles: true });
  st.policies = { p: SIM.doublesPlanner(), a: SIM.bossPolicy() }; st.opts.record = true;
  const hp = st.a.team.map(m => m.hp);
  st.policies.p = { chooseAll: () => [{ type: 'move', id: mid('Rock Slide') }, { type: 'move', id: mid('Thunder Shock'), target: { side: 'a', slot: 0 } }], replace: () => null };
  st.policies.a = { chooseAll: () => [{ type: 'move', id: mid('Scratch'), target: { side: 'p', slot: 0 } }, { type: 'move', id: mid('Tackle'), target: { side: 'p', slot: 0 } }], replace: () => null };
  SIM.playTurn(st, SIM.expectedDice());
  assert(st.a.team.every((m, i) => m.hp < hp[i]), 'Rock Slide hit both foes');
});
test('doubles: Follow Me draws single-target attacks', () => {
  const st = SIM.newBattle([mon('Clefairy', 30, { moves: ['Follow Me'] }), mon('Pikachu', 30, { moves: ['Thunder Shock'] })],
    [mon('Machop', 30, { moves: ['Karate Chop'] }), mon('Machop', 30, { moves: ['Karate Chop'], key: 'm2' })], { doubles: true });
  st.policies = { p: { chooseAll: () => [{ type: 'move', id: mid('Follow Me') }, { type: 'move', id: mid('Thunder Shock'), target: { side: 'a', slot: 0 } }], replace: () => null },
    a: { chooseAll: () => [0, 1].map(k => ({ type: 'move', id: mid('Karate Chop'), target: { side: 'p', slot: 1 } })), replace: () => null } };
  const pika = st.p.team[1].hp;
  SIM.playTurn(st, SIM.expectedDice());
  assert(st.p.team[1].hp === pika && st.p.team[0].hp < st.p.team[0].maxHp, 'Clefairy took the hits');
});
test('doubles: the boss AI picks a move and a target for each Pokemon', () => {
  const st = SIM.newBattle(team23(), bossOf('Miguel'), { doubles: true }); st.turn = 1;
  st.policies = { p: SIM.doublesPlanner(), a: SIM.bossPolicy() };
  const acts = st.policies.a.chooseAll(st, 'a', SIM.expectedDice(), true, true);
  assert(acts.length === 2 && acts.every(a => a.type === 'switch' || a.id), 'two actions');
  assert(['dAllOut', 'dSetup', 'dUtility', 'dPhaze', 'dSupport', 'dTotalSupport', 'dTRattack', 'dTRsetup'].includes(acts[0].style), 'doubles fighting style ' + acts[0].style);
});
test('doubles: plan a fight with a lead pair', async () => {
  const team = team23();
  const r = await SIM.planFight(team, bossOf('Miguel'), { doubles: true, screenRuns: 4, leadRuns: 6, finalRuns: 12 });
  assert(Array.isArray(r.lead) && r.lead.length === 2, 'lead pair');
  assert(r.script.turns.some(t => t.decision && t.decision.lines && t.decision.lines.length === 2), 'two actions per turn');
});
