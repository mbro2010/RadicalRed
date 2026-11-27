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
test('sim: frostbite (Radical Red\'s freeze) never stops a move, chips 1/16 a turn, halves special hits, and Scald cures it', () => {
  const st = duel([mon('Alakazam', 40, { moves: ['Psychic'] }), mon('Rattata', 20)], [mon('Snorlax', 60, { moves: ['Splash'] })]);
  const p = SIM.act(st, 'p'), a = SIM.act(st, 'a');
  p.status = 'frz';
  const hp0 = a.hp, myHp0 = p.hp;
  play(st, mid('Psychic'), mid('Splash'));
  assert(a.hp < hp0, 'a frostbitten Pokemon still attacks');
  assert(myHp0 - p.hp === Math.max(1, Math.floor(p.maxHp / 16)), 'and loses 1/16 at the end of the turn');
  const ala = mon('Alakazam', 40, { moves: ['Psychic'] }), lax = mon('Snorlax', 60);
  const hot = E.rawRolls(ala, lax, mid('Psychic'), {}).rolls, cold = E.rawRolls(Object.assign({}, ala, { status: 'frz' }), lax, mid('Psychic'), {}).rolls;
  assert(cold[15] < hot[15] * 0.55 && cold[15] > hot[15] * 0.45, 'its special moves do half: ' + cold[15] + ' vs ' + hot[15]);
  const sc = duel([mon('Snorlax', 40, { moves: ['Body Slam'] })], [mon('Vaporeon', 40, { moves: ['Scald'] })]);
  SIM.act(sc, 'p').status = 'frz';
  play(sc, mid('Body Slam'), mid('Scald'));
  assert(SIM.act(sc, 'p').status !== 'frz', 'a Scald that hits cures it');
});
test('engine: Radical Red\'s changes, checked against the game\'s own damage code (tools/game_damage.py)', () => {
  const roll = (a, d, mv, o) => E.rawRolls(a, d, mid(mv), o || {}).rolls;
  const lax = mon('Snorlax', 50), champ = mon('Machamp', 50, { ability: 'Iron Fist' });
  // Iron Fist x1.3 (the calculator has x1.2): same numbers the emulator gave
  const fist = roll(champ, lax, 'Mach Punch'), plain = roll(Object.assign({}, champ, { ab: 'No Guard' }), lax, 'Mach Punch');
  assert(fist[15] > plain[15] * 1.25, 'Iron Fist is x1.3 here');
  // Gems x1.5, frozen Pokemon hit back at half power with special moves, Defeatist at a third, Hard Press stays at 1 power
  const gem = mon('Snorlax', 50, { item: 'Normal Gem', moves: ['Body Slam'] });
  assert(roll(gem, lax, 'Body Slam')[15] >= Math.floor(roll(mon('Snorlax', 50), lax, 'Body Slam')[15] * 1.45), 'Gems x1.5');
  const archen = (hp) => Object.assign(mon('Archen', 50, { ability: 'Defeatist' }), { hpPct: hp });
  assert(roll(archen(40), lax, 'Rock Slide')[15] === roll(archen(100), lax, 'Rock Slide')[15], 'Defeatist does nothing above a third');
  assert(roll(archen(30), lax, 'Rock Slide')[15] < roll(archen(100), lax, 'Rock Slide')[15] * 0.6, 'and halves at a third');
  assert(roll(mon('Steelix', 50), lax, 'Hard Press')[15] <= 4, 'Hard Press keeps its 1 power in this game');
  // the random roll comes last: the lowest roll is the highest one times 85%, rounded down
  const r = roll(mon('Pidgeotto', 20), mon('Grookey', 14), 'Air Slash');
  assert(r[0] === Math.floor(r[15] * 85 / 100), 'rolls run 85-100% of the top roll: ' + r[0] + '-' + r[15]);
  // abilities that take a move in: Storm Drain, Volt Absorb, Wonder Guard
  assert(roll(mon('Wartortle', 16), mon('Lileep', 16, { ability: 'Storm Drain' }), 'Water Gun').every(x => x === 0), 'Storm Drain takes Water moves');
  assert(roll(mon('Pikachu', 20), mon('Lanturn', 20, { ability: 'Volt Absorb' }), 'Thunder Shock').every(x => x === 0), 'Volt Absorb takes Electric moves');
});
// a fixed choice each turn, and who comes in when one is needed
function playWith(st, pMove, aMove, pIn, aIn) {
  const fixed = (id, inIdx) => ({ choose: () => (typeof id === 'object' ? id : { type: 'move', id }), replace: () => (inIdx == null ? null : inIdx) });
  st.policies = { p: fixed(pMove, pIn), a: fixed(aMove, aIn) };
  SIM.playTurn(st, SIM.expectedDice());
}
test('sim: Wish heals whoever is in its spot at the end of the next turn (half the wisher\'s max HP); one at a time', () => {
  const st = duel([mon('Togekiss', 40, { moves: ['Wish', 'Air Slash'] }), mon('Snorlax', 40, { moves: ['Body Slam'] })], [mon('Blissey', 50, { moves: ['Splash'] })]);
  const t = SIM.act(st, 'p'), lax = st.p.team[1];
  t.hp = Math.floor(t.maxHp / 2);
  playWith(st, mid('Wish'), mid('Splash'));
  assert(t.hp === Math.floor(t.maxHp / 2), 'nothing yet at the end of the turn it was made');
  lax.hp = 10;
  playWith(st, { type: 'switch', to: 1 }, mid('Splash'));   // the wisher leaves: the wish goes to whoever is there
  assert(lax.hp === 10 + Math.floor(t.maxHp / 2), 'Snorlax got the wish: ' + lax.hp);
  playWith(st, mid('Body Slam'), mid('Splash'));
  assert(!Object.keys(st.p.wish || {}).length, 'and it is used up');
  const st2 = duel([mon('Togekiss', 40, { moves: ['Wish'] })], [mon('Blissey', 50, { moves: ['Splash'] })]);
  playWith(st2, mid('Wish'), mid('Splash'));
  playWith(st2, mid('Wish'), mid('Splash'));
  assert(st2.log.some(l => /But it failed/.test(l.text)), 'a second Wish while one is coming fails');
});
test('sim: Future Sight hits two turns after the turn it is used, on whoever is there; a second one fails meanwhile', () => {
  const st = duel([mon('Alakazam', 50, { moves: ['Future Sight', 'Calm Mind'] })], [mon('Snorlax', 60, { moves: ['Splash'] }), mon('Blissey', 60, { moves: ['Splash'] })]);
  const lax = SIM.act(st, 'a'), hp0 = lax.hp;
  playWith(st, mid('Future Sight'), mid('Splash'));
  assert(lax.hp === hp0 && st.a.future[0] && st.a.future[0].left === 2, 'no damage when used');
  playWith(st, mid('Future Sight'), mid('Splash'));
  assert(lax.hp === hp0 && st.log.some(l => /But it failed/.test(l.text)), 'a second one fails; still nothing');
  playWith(st, mid('Calm Mind'), mid('Splash'));
  assert(lax.hp < hp0 && !Object.keys(st.a.future).length, 'it comes down at the end of the third turn: ' + (hp0 - lax.hp));
});
test('sim: Perish Song knocks out everyone who heard it at the end of the third turn after; switching out escapes it', () => {
  const st = duel([mon('Lapras', 40, { moves: ['Perish Song', 'Surf'] }), mon('Snorlax', 40, { moves: ['Body Slam'] })], [mon('Blissey', 70, { moves: ['Splash'] }), mon('Chansey', 70, { moves: ['Splash'] })]);
  const lap = SIM.act(st, 'p'), bl = SIM.act(st, 'a');
  playWith(st, mid('Perish Song'), mid('Splash'));
  assert(lap.perish === 2 && bl.perish === 2, 'both heard it (count 3 shown, then down)');
  playWith(st, { type: 'switch', to: 1 }, mid('Splash'));
  assert(lap.perish == null, 'switching out ends it');
  playWith(st, mid('Body Slam'), mid('Splash'));
  assert(!bl.fainted && bl.perish === 0, 'count 0 now');
  playWith(st, mid('Body Slam'), mid('Splash'), null, 1);
  assert(bl.fainted && SIM.act(st, 'a') !== bl, 'it faints at the end of the turn its count is 0');
  const sp = duel([mon('Lapras', 40, { moves: ['Perish Song'] })], [mon('Exploud', 40, { ability: 'Soundproof', moves: ['Splash'] })]);
  playWith(sp, mid('Perish Song'), mid('Splash'));
  assert(SIM.act(sp, 'a').perish == null && SIM.act(sp, 'p').perish === 2, 'Soundproof is spared');
});
test('sim: Healing Wish faints the user and fully heals the hurt Pokemon that comes in; Baton Pass hands over boosts; Chilly Reception snows', () => {
  const st = duel([mon('Jirachi', 50, { moves: ['Healing Wish'] }), mon('Snorlax', 40, { moves: ['Body Slam'] })], [mon('Blissey', 70, { moves: ['Splash'] })]);
  const lax = st.p.team[1];
  lax.hp = 20; lax.status = 'par';
  playWith(st, mid('Healing Wish'), mid('Splash'), 1);
  assert(st.p.team[0].fainted && SIM.act(st, 'p') === lax && lax.hp === lax.maxHp && !lax.status, 'Snorlax comes in healed: ' + lax.hp + '/' + lax.maxHp);
  const bp = duel([mon('Ninjask', 40, { moves: ['Swords Dance', 'Baton Pass'] }), mon('Snorlax', 40, { moves: ['Body Slam'] })], [mon('Blissey', 70, { moves: ['Splash'] })]);
  playWith(bp, mid('Swords Dance'), mid('Splash'));
  playWith(bp, mid('Baton Pass'), mid('Splash'), 1);
  assert(SIM.act(bp, 'p') === bp.p.team[1] && bp.p.team[1].boosts.atk === 2, 'Snorlax gets +2 Attack');
  const cr = duel([mon('Slowpoke', 40, { moves: ['Chilly Reception'] }), mon('Snorlax', 40, { moves: ['Body Slam'] })], [mon('Blissey', 70, { moves: ['Splash'] })]);
  playWith(cr, mid('Chilly Reception'), mid('Splash'), 1);
  assert(cr.weather === 'Snow' && SIM.act(cr, 'p') === cr.p.team[1], 'snow, then out');
});
test('sim: Sand Spit whips up a sandstorm when hit, Toxic Debris scatters Toxic Spikes, Stamina and Weak Armor react', () => {
  const ss = duel([mon('Machamp', 40, { moves: ['Karate Chop'] })], [mon('Silicobra', 40, { ability: 'Sand Spit', moves: ['Splash'] })]);
  playWith(ss, mid('Karate Chop'), mid('Splash'));
  assert(ss.weather === 'Sand', 'sandstorm after the hit');
  const td = duel([mon('Machamp', 40, { moves: ['Karate Chop'] })], [mon('Glimmora', 40, { ability: 'Toxic Debris', moves: ['Splash'] })]);
  playWith(td, mid('Karate Chop'), mid('Splash'));
  assert(td.p.hazards.tspikes === 1, 'a layer of Toxic Spikes on the attacker\'s side');
  const sm = duel([mon('Machamp', 40, { moves: ['Karate Chop'] })], [mon('Mudsdale', 60, { ability: 'Stamina', moves: ['Splash'] })]);
  playWith(sm, mid('Karate Chop'), mid('Splash'));
  assert(SIM.act(sm, 'a').boosts.def === 1, 'Stamina: +1 Defense');
  const wa = duel([mon('Machamp', 40, { moves: ['Karate Chop'] })], [mon('Skarmory', 60, { ability: 'Weak Armor', moves: ['Splash'] })]);
  playWith(wa, mid('Karate Chop'), mid('Splash'));
  assert(SIM.act(wa, 'a').boosts.def === -1 && SIM.act(wa, 'a').boosts.spe === 2, 'Weak Armor: -1 Defense, +2 Speed');
});
test('sim: First Impression works only on the first turn out, like Fake Out, but never flinches (BS_158_FakeOut)', () => {
  const st = duel([mon('Gyarados', 27, { moves: ['Thrash', 'Wish'] })], [mon('Lokix', 23, { moves: ['First Impression'] })]);
  playWith(st, mid('Wish'), mid('First Impression'));
  assert(!st.log.some(l => /flinch/i.test(l.text)) && st.p.wish && st.p.wish[0], 'Gyarados still moves (and makes its wish)');
  playWith(st, mid('Thrash'), mid('First Impression'));
  assert(st.log.some(l => /But it failed/.test(l.text)), 'not on its second turn out');
  const fo = duel([mon('Gyarados', 27, { moves: ['Wish'] })], [mon('Persian', 30, { moves: ['Fake Out'] })]);
  playWith(fo, mid('Wish'), mid('Fake Out'));
  assert(fo.log.some(l => /flinch/i.test(l.text)), 'Fake Out does flinch');
});

// ---- this round: what the Viridian puzzle battle turned up ----
const itemId = n => +Object.keys(D.items).find(k => D.items[k].n === n || D.items[k].c === n);
test('sim: both sides out of Pokemon after one action is a draw, and the game counts a draw as your loss', () => {
  const st = duel([mon('Electrode', 30, { moves: ['Explosion'] })], [mon('Magikarp', 5, { moves: ['Splash'] })]);
  playWith(st, mid('Explosion'), mid('Splash'));
  assert(st.over && st.winner === 'a' && st.draw, 'Explosion taking the last two down loses');
  const ok = duel([mon('Electrode', 30, { moves: ['Explosion'] }), mon('Pikachu', 30, { moves: ['Thunderbolt'] })], [mon('Magikarp', 5, { moves: ['Splash'] })]);
  playWith(ok, mid('Explosion'), mid('Splash'));
  assert(ok.over && ok.winner === 'p' && !ok.draw, 'with one left standing it is a win');
});
test('sim: residual damage is at least 1 HP (Stealth Rock and Iron Barbs knock out a Shedinja), and fainting on entry brings the next one in at once', () => {
  const sr = duel([mon('Aron', 50, { moves: ['Stealth Rock'] })], [mon('Shedinja', 50, { moves: ['Shadow Sneak'] }), mon('Shedinja', 50, { moves: ['Shadow Sneak'] }), mon('Magikarp', 50, { moves: ['Splash'] })]);
  const t0 = sr.a.team[0]; t0.hp = 0; t0.fainted = true;   // the lead is gone: the next one comes in through the rocks
  sr.p.hazards = sr.p.hazards; sr.a.hazards.sr = 1;
  const order = (s, side) => { const i = s[side].team.findIndex((m, k) => !m.fainted && !s[side].slots.includes(k)); return i >= 0 ? i : null; };
  sr.policies = { p: { choose: () => ({ type: 'move', id: mid('Stealth Rock') }), replace: order }, a: { choose: () => ({ type: 'move', id: mid('Splash') }), replace: order } };
  SIM.playTurn(sr, SIM.expectedDice());
  assert(sr.a.team[1].fainted, 'the second Shedinja falls to Stealth Rock as it comes in (1/8 of 1 HP rounds up to 1)');
  assert(SIM.act(sr, 'a').name === 'Magikarp', 'and the next one is sent at once');
  const barbs = duel([mon('Gible', 5, { moves: ['Tackle'], ability: 'Iron Barbs' })], [mon('Shedinja', 60, { moves: ['X-Scissor'] })]);
  playWith(barbs, mid('Tackle'), mid('X-Scissor'));
  assert(barbs.p.team[0].fainted && barbs.a.team[0].fainted, 'Iron Barbs still hurts the attacker when the holder faints');
});
test("sim: items the ROM shortens work (Heavy-Duty Boots, Weakness Policy), and Wonder Guard lets only super-effective hits in", () => {
  const boots = duel([mon('Aron', 50, { moves: ['Splash'] })], [mon('Magikarp', 50, { moves: ['Splash'] }), mon('Charizard', 50, { moves: ['Splash'], item: 'HeavyDBoots' })]);
  boots.a.hazards.sr = 1;
  const before = boots.a.team[1].hp;
  SIM.switchIn(boots, 'a', 1, SIM.expectedDice(), 'switch', 0);
  assert(boots.a.team[1].hp === before, 'Heavy-Duty Boots keep Charizard out of the rocks');
  const wp = duel([mon('Machamp', 40, { moves: ['Close Combat'] })], [mon('Snorlax', 60, { moves: ['Splash'], item: 'WeaknessPol.' })]);
  playWith(wp, mid('Close Combat'), mid('Splash'));
  assert(wp.a.team[0].boosts.atk === 2 && !wp.a.team[0].item, 'Weakness Policy goes off on a super-effective hit');
  const wg = duel([mon('Machamp', 40, { moves: ['Close Combat'] })], [mon('Shedinja', 40, { moves: ['Splash'] })]);
  playWith(wg, mid('Close Combat'), mid('Splash'));
  assert(!wg.a.team[0].fainted, 'Close Combat does nothing to Shedinja');
  const fg = duel([mon('Shuckle', 40, { moves: ['Final Gambit'] })], [mon('Gengar', 40, { moves: ['Splash'] })]);
  playWith(fg, mid('Final Gambit'), mid('Splash'));
  assert(!fg.a.team[0].fainted && !fg.p.team[0].fainted, "Final Gambit can't touch a Ghost (and the user stays)");
});
