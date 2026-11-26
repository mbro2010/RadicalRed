const { SIM, E, test, assert, mon, bossSpecs, mid, sid, D } = require("./lib");
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

test('sim: the planner sets up when it makes the fight safer, and attacks when setting up gains nothing', () => {
  const falkner = D.bosses.findIndex(b => b.n === 'Falkner');
  const mk = (n, lv, mv) => ({ key: n, s: sid(n), lv, nat: 0, ab: E.sp(sid(n)).a[0], it: null, mv: mv.map(mid) });
  const top = (mine, foeName) => {
    const foe = E.bossTeam(falkner, 16).find(t => E.sp(t.s).n === foeName);
    const st = SIM.newBattle([mine], [Object.assign({ key: 'b', label: foeName }, foe)], { lead: 0, record: false });
    st.policies = { p: SIM.plannerPolicy(), a: SIM.bossPolicy() };
    SIM.begin(st, SIM.expectedDice());
    return st.policies.p.evaluate(st, 'p');
  };
  // Shell Smash lets Shellder move first and knock Yanma out; attacking straight away loses
  const a = top(mk('Shellder', 16, ['Shell Smash', 'Ice Shard', 'Water Gun', 'Icicle Spear']), 'Yanma');
  assert(a[0].label === 'Use Shell Smash' && a[0].risk < 0.05, 'Shell Smash first: ' + a.slice(0, 2).map(x => x.label + ' ' + x.risk.toFixed(2)).join(', '));
  // Growth does nothing for a Bulbasaur that loses to Wattrel either way: no setting up in a lost fight
  const b = top(mk('Bulbasaur', 16, ['Vine Whip', 'Growth', 'Tackle', 'Razor Leaf']), 'Wattrel');
  assert(b[0].label !== 'Use Growth', 'no Growth in a lost fight: ' + b.slice(0, 2).map(x => x.label + ' ' + x.risk.toFixed(2)).join(', '));
});
test('sim: the planner takes a setup step for its six, plays the fight with it, and keeps the odds without it', async () => {
  const team = bossSpecs(414, 16);   // Brock
  const item = n => +Object.keys(D.items).find(k => D.items[k].n === n);
  const mine = [mon('Wartortle', 16, { moves: ['Water Gun', 'Bite', 'Rapid Spin', 'Withdraw'] }), mon('Mankey', 16, { moves: ['Karate Chop', 'Low Kick', 'Fury Swipes'] }), mon('Pidgeotto', 16, { moves: ['Gust', 'Quick Attack', 'Sand Attack'] })];
  let seen = null;
  const setup = six => { seen = six.map(s => s.key); const specs = six.map(s => s.key === 'Mankey' ? Object.assign({}, s, { it: item('Black Belt') }) : s); return { changed: true, specs, info: [{ key: 'Mankey', it: item('Black Belt') }] }; };
  const res = await SIM.planFight(mine, team, { setup, screenRuns: 4, leadRuns: 6, finalRuns: 30 });
  assert(seen && seen.length === 3, 'the setup step saw the six');
  assert(res.setup && res.setup[0].key === 'Mankey', 'the setup comes back');
  assert(res.baseOdds && res.baseOdds.runs === 30, 'odds without the setup too');
  const leadKey = mine[res.lead].key;
  assert(res.script.order[0] === leadKey, 'the order starts with the lead: ' + res.script.order.join(', '));
  assert(res.script.order.every(k => mine.some(m => m.key === k)), 'the order lists your Pokemon');
  assert(Object.keys(res.script.faces).every(k => res.script.order.includes(k)), 'who each one takes on');
  // nothing to change: no second check
  const same = await SIM.planFight(mine, team, { setup: six => ({ changed: false, specs: six, info: [] }), screenRuns: 4, leadRuns: 6, finalRuns: 30 });
  assert(same.baseOdds === null, 'no comparison when nothing changes');
});
// ---- moves that lock you in, trap you or lock a move out (what cost run 5 its Geodude against Falkner)
function duel(mine, theirs, o) {
  const st = SIM.newBattle(mine, theirs, Object.assign({ record: true }, o || {}));
  SIM.begin(st, SIM.expectedDice());
  return st;
}
function play(st, pMove, aMove) {
  const fixed = id => ({ choose: (s, sd) => (typeof id === 'function' ? id(s, sd) : { type: 'move', id }), replace: () => null });
  st.policies = { p: fixed(pMove), a: fixed(aMove) };
  SIM.playTurn(st, SIM.expectedDice());
}
test('sim: Rollout locks the user in for five hits, doubling each time; it can\'t switch; a miss ends it', () => {
  const geo = mon('Geodude', 15, { moves: ['Rollout', 'Tackle', 'Defense Curl', 'Rock Throw'] });
  const foe = mon('Blissey', 50, { moves: ['Splash'] });   // takes many hits
  const st = duel([geo, mon('Pidgey', 15)], [foe]);
  const g = SIM.act(st, 'p');
  const dealt = [];
  for (let k = 0; k < 5; k++) {
    const before = SIM.act(st, 'a').hp;
    play(st, (s, sd) => ({ type: 'move', id: SIM.usable(SIM.act(s, sd), s)[0] === mid('Rollout') ? mid('Rollout') : mid('Rollout') }), mid('Splash'));
    dealt.push(before - SIM.act(st, 'a').hp);
    if (k < 4) {
      assert(SIM.usable(g, st).length === 1 && SIM.usable(g, st)[0] === mid('Rollout'), `hit ${k + 1}: only Rollout next`);
      assert(!SIM.canSwitch(st, g), `hit ${k + 1}: no switching while rolling`);
    }
  }
  for (let k = 1; k < 5; k++) assert(dealt[k] >= 1.7 * dealt[k - 1], `each hit about twice the last: ${dealt.join(', ')}`);
  assert(SIM.usable(g, st).length > 1 && SIM.canSwitch(st, g), 'free again after the fifth hit');
  // a miss ends it early
  const st2 = duel([mon('Geodude', 15, { moves: ['Rollout', 'Tackle'] })], [mon('Blissey', 50, { moves: ['Splash'] })]);
  st2.policies = { p: { choose: () => ({ type: 'move', id: mid('Rollout'), outcome: 'hit' }), replace: () => null }, a: { choose: () => ({ type: 'move', id: mid('Splash') }), replace: () => null } };
  SIM.playTurn(st2, SIM.expectedDice());
  st2.policies.p = { choose: () => ({ type: 'move', id: mid('Rollout'), outcome: 'miss' }), replace: () => null };
  SIM.playTurn(st2, SIM.expectedDice());
  assert(SIM.usable(SIM.act(st2, 'p'), st2).length === 2, 'the miss ended the lock');
  // Defense Curl doubles it (and raises Defense)
  const st3 = duel([mon('Geodude', 15, { moves: ['Rollout', 'Defense Curl'] })], [mon('Blissey', 50, { moves: ['Splash'] })]);
  play(st3, mid('Defense Curl'), mid('Splash'));
  assert(SIM.act(st3, 'p').boosts.def === 1, 'Defense Curl raises Defense');
  const b3 = SIM.act(st3, 'a').hp; play(st3, mid('Rollout'), mid('Splash'));
  assert(b3 - SIM.act(st3, 'a').hp >= 1.7 * dealt[0], 'Rollout after Defense Curl hits twice as hard');
});
test('sim: Outrage locks in for 2-3 turns, then confuses; paralysis or sleep cancels the lock', () => {
  const st = duel([mon('Dragonite', 50, { moves: ['Outrage', 'Extreme Speed'] })], [mon('Blissey', 70, { moves: ['Splash'] })]);
  const d = SIM.act(st, 'p');
  play(st, mid('Outrage'), mid('Splash'));
  assert(SIM.usable(d, st).length === 1 && !SIM.canSwitch(st, d), 'locked after the first turn');
  for (let k = 0; k < 3 && d.rampage; k++) play(st, (s, sd) => ({ type: 'move', id: SIM.usable(SIM.act(s, sd), s)[0] }), mid('Splash'));
  assert(!d.rampage && d.confused > 0, 'the rampage ended in confusion');
  const st2 = duel([mon('Dragonite', 50, { moves: ['Outrage', 'Extreme Speed'] })], [mon('Blissey', 70, { moves: ['Splash'] })]);
  const d2 = SIM.act(st2, 'p');
  play(st2, mid('Outrage'), mid('Splash'));
  st2.policies = { p: { choose: () => ({ type: 'move', id: mid('Outrage'), outcome: 'par' }), replace: () => null }, a: { choose: () => ({ type: 'move', id: mid('Splash') }), replace: () => null } };
  SIM.playTurn(st2, SIM.expectedDice());
  assert(!d2.rampage && SIM.usable(d2, st2).length === 2 && !d2.confused, 'full paralysis cancels it without confusion');
});
test('sim: binding moves hurt 1/8 a turn for 4-5 turns and keep the target in; Mean Look, Shadow Tag and Arena Trap keep it in too', () => {
  const st = duel([mon('Pidgeotto', 20, { moves: ['Gust'] }), mon('Rattata', 20)], [mon('Arbok', 20, { moves: ['Wrap'] })]);
  const p = SIM.act(st, 'p');
  play(st, mid('Gust'), mid('Wrap'));
  assert(p.bound && !SIM.canSwitch(st, p), 'caught in Wrap: no switching');
  const hp1 = p.hp; play(st, mid('Gust'), mid('Wrap'));
  assert(hp1 - p.hp >= Math.floor(p.maxHp / 8), 'loses at least 1/8 a turn');
  // Ghosts slip out; the binder leaving frees it
  const g = duel([mon('Gastly', 20, { moves: ['Lick'] }), mon('Rattata', 20)], [mon('Arbok', 20, { moves: ['Wrap'] })]);
  play(g, mid('Lick'), mid('Wrap'));
  assert(SIM.canSwitch(g, SIM.act(g, 'p')), 'a Ghost can always switch out');
  const ml = duel([mon('Pidgeotto', 20, { moves: ['Gust'] }), mon('Rattata', 20)], [mon('Umbreon', 20, { moves: ['Mean Look'] })]);
  play(ml, mid('Gust'), mid('Mean Look'));
  assert(!SIM.canSwitch(ml, SIM.act(ml, 'p')), 'Mean Look keeps it in');
  const tag = duel([mon('Pidgeotto', 20), mon('Rattata', 20)], [mon('Wobbuffet', 20, { ability: 'Shadow Tag', moves: ['Counter'] })]);
  assert(!SIM.canSwitch(tag, SIM.act(tag, 'p')), 'Shadow Tag keeps it in');
  const arena = duel([mon('Pidgeotto', 20), mon('Rattata', 20)], [mon('Diglett', 20, { ability: 'Arena Trap', moves: ['Scratch'] })]);
  assert(SIM.canSwitch(arena, SIM.act(arena, 'p')), 'Arena Trap does not hold a Flying type');
  const arena2 = duel([mon('Rattata', 20), mon('Pidgeotto', 20)], [mon('Diglett', 20, { ability: 'Arena Trap', moves: ['Scratch'] })]);
  assert(!SIM.canSwitch(arena2, SIM.act(arena2, 'p')), 'Arena Trap holds a grounded one');
});
test('sim: Disable and Torment lock moves out; Truant loafs every other turn; Freeze Shock charges first', () => {
  const st = duel([mon('Rattata', 20, { moves: ['Tackle', 'Quick Attack'] })], [mon('Hypno', 30, { moves: ['Disable', 'Torment'] })]);
  play(st, mid('Tackle'), mid('Splash') || mid('Disable'));
  play(st, mid('Quick Attack'), mid('Disable'));
  const r = SIM.act(st, 'p');
  assert(r.disabled === mid('Quick Attack') && !SIM.usable(r, st).includes(mid('Quick Attack')), 'Disable takes its last move away');
  const t = duel([mon('Rattata', 20, { moves: ['Tackle', 'Quick Attack'] })], [mon('Hypno', 30, { moves: ['Torment'] })]);
  play(t, mid('Tackle'), mid('Torment'));
  assert(!SIM.usable(SIM.act(t, 'p'), t).includes(mid('Tackle')), 'Torment: not the same move twice in a row');
  const s = duel([mon('Slakoth', 20, { ability: 'Truant', moves: ['Scratch'] })], [mon('Blissey', 50, { moves: ['Splash'] })]);
  const hp = [];
  for (let k = 0; k < 4; k++) { const b = SIM.act(s, 'a').hp; play(s, mid('Scratch'), mid('Splash')); hp.push(b - SIM.act(s, 'a').hp); }
  assert(hp[0] > 0 && hp[1] === 0 && hp[2] > 0 && hp[3] === 0, 'Truant: a hit, a loaf, a hit, a loaf: ' + hp.join(','));
  const fz = duel([mon('Kyurem', 60, { moves: ['Freeze Shock'] })], [mon('Blissey', 60, { moves: ['Splash'] })]);
  const b0 = SIM.act(fz, 'a').hp; play(fz, mid('Freeze Shock'), mid('Splash'));
  assert(SIM.act(fz, 'a').hp === b0 && SIM.act(fz, 'p').charging, 'Freeze Shock charges on the first turn');
});
test('sim: the planner sees a Rollout lock coming (run 5: Geodude against Flittle\'s Calm Mind)', () => {
  E.setMode('normal', false);
  try {
    const fi = D.bosses.findIndex(b => b.n === 'Falkner');
    const b = D.bosses[fi], saved = b.party;
    b.party = b.np;
    const team = E.bossTeam(fi, 15).map((t, i) => Object.assign({ key: 'b' + i, label: E.sp(t.s).n }, t));
    b.party = saved;
    const st = SIM.newBattle([mon('Geodude', 15, { moves: ['Tackle', 'Defense Curl', 'Rollout', 'Rock Throw'] }), mon('Staravia', 15, { moves: ['Wing Attack', 'Quick Attack'] })], team, {});
    st.policies = { p: SIM.plannerPolicy(), a: SIM.bossPolicy() };
    SIM.begin(st, SIM.expectedDice());
    st.a.slots[0] = 2; st.a.team[2].slot = 0;   // Flittle out
    const opts = SIM.plannerPolicy().evaluate(st, 'p');
    const roll = opts.find(x => x.label === 'Use Rollout');
    assert(roll && roll.lock && roll.lock.turns >= 2, 'Rollout is played out locked in');
    assert(opts[0].label !== 'Use Rollout', 'and not picked against a Calm Mind user: ' + opts.slice(0, 3).map(x => x.label).join(', '));
  } finally { E.setMode('hardcore'); }
});
