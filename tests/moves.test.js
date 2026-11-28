// Move effects checked against the game's battle scripts (tools/battle_scripts.py reads them from the ROM):
// one move at a time in a small battle, with dice that make every chance happen unless a test says otherwise.
const { SIM, E, D, test, assert, mid } = require('./lib');
const { spec, battle, ALWAYS, NEVER, P, A, text, mew, slowMew, lax } = require('./duel');


test('moves: Super Fang halves the target\'s HP, Dragon Rage does 40 and Sonic Boom 20, and type immunity still applies', () => {
  let st = battle([mew(['Super Fang'])], [slowMew(['Splash'])], { p: ['Super Fang'], a: ['Splash'] }, { turns: 2 });
  assert(A(st).hp === A(st).maxHp - Math.floor(A(st).maxHp / 2) - Math.floor(Math.ceil(A(st).maxHp / 2) / 2), 'half, then half again: ' + A(st).hp);
  st = battle([mew(['Dragon Rage'])], [slowMew(['Splash'])], { p: ['Dragon Rage'], a: ['Splash'] });
  assert(A(st).maxHp - A(st).hp === 40, 'Dragon Rage: 40');
  st = battle([mew(['Sonic Boom'])], [slowMew(['Splash'])], { p: ['Sonic Boom'], a: ['Splash'] });
  assert(A(st).maxHp - A(st).hp === 20, 'Sonic Boom: 20');
  st = battle([mew(['Super Fang'])], [spec('Gengar', 100, ['Splash'], { key: 'Foe' })], { p: ['Super Fang'], a: ['Splash'] });
  assert(A(st).hp === A(st).maxHp, 'a Ghost is immune to Super Fang');
});

test('moves: a boss\'s Frustration hits at full power (trainer Pokemon with it get no friendship); yours is weak', () => {
  const bi = D.bosses.findIndex(b => (b.party || []).length);
  const one = E.bossTeam(bi, 50)[0];
  assert(one.fr === ((one.mv || []).includes(mid('Frustration')) ? 0 : 255), 'boss friendship follows Frustration');
  const vs = spec('Snorlax', 50, ['Splash']);
  const boss = E.rawRolls(Object.assign(spec('Snorlax', 50, ['Frustration']), { fr: 0 }), vs, mid('Frustration'), {}).rolls[15];
  const mine = E.rawRolls(spec('Snorlax', 50, ['Frustration']), vs, mid('Frustration'), {}).rolls[15];
  const ret = E.rawRolls(spec('Snorlax', 50, ['Return']), vs, mid('Return'), {}).rolls[15];
  assert(boss === ret && boss > 10 * mine, `boss Frustration ${boss} = Return ${ret}, yours ${mine}`);
});

test('moves: Endure leaves it at 1 HP instead of blocking the hit', () => {
  const st = battle([spec('Mew', 100, ['Splash'], { nature: 'Brave' })], [spec('Mew', 100, ['Endure', 'Explosion'], { key: 'Foe' })],
    { p: ['Splash'], a: ['Endure'] }, { setup: s => { P(s).hp = 1; } });
  // the foe endures; nothing hit it this turn, so check the mark and then hit it hard next turn
  const st2 = battle([mew(['Head Smash'])], [slowMew(['Endure'], { extra: {} })], { p: ['Head Smash'], a: ['Endure'] },
    { setup: s => { A(s).hp = 30; } });
  assert(A(st2).hp === 1 && !A(st2).fainted, 'endured at 1 HP: ' + A(st2).hp + ' / ' + text(st2));
  assert(/braced itself/.test(text(st)), 'Endure braces');
});

test('moves: Hurricane confuses, Dark Hole puts to sleep, Dire Claw poisons, paralyzes or sleeps', () => {
  let st = battle([mew(['Hurricane'])], [slowMew(['Splash'])], { p: ['Hurricane'], a: ['Splash'] });
  assert(/confused \(Hurricane\)/.test(text(st)), 'Hurricane confusion: ' + text(st));
  st = battle([mew(['Dark Hole'])], [slowMew(['Splash'])], { p: ['Dark Hole'], a: ['Splash'] });
  assert(A(st).status === 'slp', 'Dark Hole sleep');
  st = battle([mew(['Dire Claw'])], [slowMew(['Splash'])], { p: ['Dire Claw'], a: ['Splash'] });
  assert(['psn', 'par', 'slp'].includes(A(st).status), 'Dire Claw: ' + A(st).status);
});

test('moves: Haze and Clear Smog reset stat changes; Freezy Frost resets everyone\'s', () => {
  let st = battle([mew(['Haze'], { nature: 'Brave' })], [spec('Mew', 100, ['Swords Dance'], { key: 'Foe' })], { p: ['Haze'], a: ['Swords Dance'] }, { turns: 1 });
  assert(A(st).boosts.atk === 0, 'Haze after Swords Dance: ' + A(st).boosts.atk);
  st = battle([mew(['Clear Smog'], { nature: 'Brave' })], [spec('Mew', 100, ['Swords Dance'], { key: 'Foe' })], { p: ['Clear Smog'], a: ['Swords Dance'] });
  assert(A(st).boosts.atk === 0, 'Clear Smog');
});

test('moves: Poltergeist fails on a target with no item; Knock Off, Thief, Bug Bite and Incinerate deal with items', () => {
  let st = battle([mew(['Poltergeist'])], [slowMew(['Splash'])], { p: ['Poltergeist'], a: ['Splash'] });
  assert(A(st).hp === A(st).maxHp && /But it failed/.test(text(st)), 'Poltergeist without an item fails');
  st = battle([mew(['Poltergeist'])], [slowMew(['Splash'], { item: 'Leftovers' })], { p: ['Poltergeist'], a: ['Splash'] });
  assert(A(st).hp < A(st).maxHp, 'Poltergeist with an item hits');
  st = battle([mew(['Knock Off'])], [slowMew(['Splash'], { item: 'Leftovers' })], { p: ['Knock Off'], a: ['Splash'] });
  assert(!A(st).item, 'Knock Off removes it');
  st = battle([mew(['Thief'])], [slowMew(['Splash'], { item: 'Leftovers' })], { p: ['Thief'], a: ['Splash'] });
  assert(!A(st).item && E.itemName(P(st).item) === 'Leftovers', 'Thief steals it');
  st = battle([mew(['Bug Bite'])], [slowMew(['Splash'], { item: 'Sitrus Berry' })], { p: ['Bug Bite'], a: ['Splash'] }, { setup: s => { P(s).hp = 100; } });
  assert(!A(st).item && P(st).hp > 100, 'Bug Bite eats the Sitrus Berry: ' + P(st).hp);
  st = battle([mew(['Incinerate'])], [slowMew(['Splash'], { item: 'Sitrus Berry' })], { p: ['Incinerate'], a: ['Splash'] });
  assert(!A(st).item, 'Incinerate burns the berry');
});

test('moves: Trick hands over a Choice Scarf and the target is locked into its next move', () => {
  const st = battle([mew(['Trick', 'Splash'], { item: 'Choice Scarf' })], [slowMew(['Splash', 'Swords Dance'])], { p: ['Trick', 'Splash'], a: ['Splash', 'Swords Dance'] }, { turns: 2 });
  assert(E.itemName(A(st).item) === 'Choice Scarf' && !P(st).item, 'items swapped');
  assert(A(st).choiceMove, 'the target is choice-locked after its next move');
});

test('moves: Pursuit hits a Pokemon switching out first, at double power', () => {
  const pursuer = () => spec('Mew', 100, ['Pursuit'], { key: 'Foe' });
  const st = battle([spec('Mew', 100, ['Splash']), lax()], [pursuer()], { p: ['switch:1'], a: ['Pursuit'] }, { dice: NEVER });
  const hitOnWayOut = st.p.team[0].maxHp - st.p.team[0].hp;
  const st2 = battle([spec('Mew', 100, ['Splash']), lax()], [pursuer()], { p: ['Splash'], a: ['Pursuit'] }, { dice: NEVER });
  const normal = st2.p.team[0].maxHp - st2.p.team[0].hp;
  assert(st.p.slots[0] === 1 && hitOnWayOut > 1.7 * normal, `switched out and took ${hitOnWayOut} (normal ${normal})`);
  assert(st.p.team[1].hp === st.p.team[1].maxHp, 'the one coming in is not hit');
});

test('moves: in the air only the game\'s list reaches it (Thunder, Hurricane, Gust...); under ground Earthquake does double', () => {
  const flyer = () => spec('Mew', 100, ['Fly'], { key: 'Foe' });
  let st = battle([spec('Mew', 100, ['Earthquake'], { nature: 'Brave' })], [flyer()], { p: ['Earthquake'], a: ['Fly'] });
  assert(A(st).hp === A(st).maxHp && /avoids the attack/.test(text(st)), 'Earthquake misses a Pokemon up in the air');
  st = battle([spec('Mew', 100, ['Thunder'], { nature: 'Brave' })], [flyer()], { p: ['Thunder'], a: ['Fly'] });
  assert(A(st).hp < A(st).maxHp, 'Thunder hits it');
  const digger = () => spec('Mew', 100, ['Dig'], { key: 'Foe' });
  st = battle([spec('Mew', 100, ['Earthquake'], { nature: 'Brave' })], [digger()], { p: ['Earthquake'], a: ['Dig'] }, { dice: NEVER });
  const under = A(st).maxHp - A(st).hp;
  st = battle([spec('Mew', 100, ['Earthquake'], { nature: 'Brave' })], [spec('Mew', 100, ['Splash'], { key: 'Foe' })], { p: ['Earthquake'], a: ['Splash'] }, { dice: NEVER });
  assert(under > 1.8 * (A(st).maxHp - A(st).hp), 'Earthquake doubles under ground: ' + under);
});

test('moves: Feint and Shadow Force get through Protect; Mat Block works only on the first turn out', () => {
  const st = battle([spec('Mew', 100, ['Feint'], { nature: 'Brave' })], [spec('Mew', 100, ['Protect'], { key: 'Foe' })], { p: ['Feint'], a: ['Protect'] });
  assert(A(st).hp < A(st).maxHp && /protection was lifted/.test(text(st)), 'Feint lifts Protect');
  const st2 = battle([spec('Mew', 100, ['Mat Block', 'Splash'])], [slowMew(['Splash'])], { p: ['Splash', 'Mat Block'], a: ['Splash'] }, { turns: 2 });
  assert(/But it failed/.test(text(st2)), 'Mat Block after the first turn fails');
});

test('moves: Gravity, Magnet Rise, Lucky Chant and Magic Room do their own thing (not Trick Room or Tailwind)', () => {
  let st = battle([mew(['Gravity'])], [slowMew(['Splash'])], { p: ['Gravity'], a: ['Splash'] });
  assert(st.gravity && !st.trickRoom, 'Gravity is up, Trick Room is not');
  st = battle([mew(['Magnet Rise'])], [slowMew(['Splash'])], { p: ['Magnet Rise'], a: ['Splash'] });
  assert(P(st).magnetRise && !st.p.tailwind, 'Magnet Rise, no Tailwind');
  st = battle([spec('Mew', 100, ['Magnet Rise'])], [spec('Mew', 100, ['Earthquake'], { nature: 'Brave', key: 'Foe' })], { p: ['Magnet Rise'], a: ['Earthquake'] });
  assert(P(st).hp === P(st).maxHp, 'Earthquake misses a Pokemon under Magnet Rise: ' + text(st));
  st = battle([spec('Pidgeot', 100, ['Splash'], { nature: 'Brave' })], [spec('Mew', 100, ['Smack Down', 'Earthquake'], { key: 'Foe' })], { p: ['Splash'], a: ['Smack Down', 'Earthquake'] }, { turns: 2, dice: NEVER });
  assert(/fell straight down/.test(text(st)) && /Pidgeot loses/.test(st.log.filter(l => l.turn === 2).map(l => l.text).join(' ')), 'Smack Down grounds a Flying type for Earthquake');
});

test('moves: Counter returns a physical hit twice over, Mirror Coat a special one; both fail if nothing hit', () => {
  let st = battle([spec('Mew', 100, ['Counter'])], [spec('Mew', 100, ['Tackle'], { key: 'Foe' })], { p: ['Counter'], a: ['Tackle'] }, { dice: NEVER });
  const taken = P(st).maxHp - P(st).hp, back = A(st).maxHp - A(st).hp;
  assert(taken > 0 && back === 2 * taken, `Counter: took ${taken}, gave ${back}`);
  st = battle([spec('Mew', 100, ['Mirror Coat'])], [spec('Mew', 100, ['Tackle'], { key: 'Foe' })], { p: ['Mirror Coat'], a: ['Tackle'] }, { dice: NEVER });
  assert(A(st).hp === A(st).maxHp, 'Mirror Coat ignores a physical hit');
});

test('moves: Last Resort fails until every other move has been used; Dream Eater needs a sleeping target', () => {
  const st = battle([mew(['Last Resort', 'Swords Dance'])], [slowMew(['Splash'])], { p: ['Last Resort', 'Swords Dance', 'Last Resort'], a: ['Splash'] }, { turns: 3 });
  const t1 = st.log.filter(l => l.turn === 1).map(l => l.text).join(' '), t3 = st.log.filter(l => l.turn === 3).map(l => l.text).join(' ');
  assert(/But it failed/.test(t1) && /Foe loses/.test(t3), 'fails first, works after Swords Dance');
  const st2 = battle([mew(['Dream Eater'])], [slowMew(['Splash'])], { p: ['Dream Eater'], a: ['Splash'] });
  assert(A(st2).hp === A(st2).maxHp, 'Dream Eater on an awake target fails');
});

test('moves: Stone Axe lays Stealth Rock, Ceaseless Edge Spikes; Salt Cure chips every turn and does not trap', () => {
  let st = battle([mew(['Stone Axe'])], [slowMew(['Splash'])], { p: ['Stone Axe'], a: ['Splash'] });
  assert(st.a.hazards.sr === 1, 'Stone Axe: Stealth Rock');
  st = battle([mew(['Ceaseless Edge'])], [slowMew(['Splash'])], { p: ['Ceaseless Edge'], a: ['Splash'] });
  assert(st.a.hazards.spikes === 1, 'Ceaseless Edge: Spikes');
  st = battle([mew(['Salt Cure', 'Splash'])], [slowMew(['Splash']), lax()], { p: ['Salt Cure', 'Splash'], a: ['Splash'] }, { turns: 2, dice: NEVER });
  assert(A(st).saltCure && !A(st).bound, 'salt cured, not bound');
  assert(SIM.canSwitch(st, A(st)), 'it can still switch out');
  assert(/Salt Cure/.test(st.log.filter(l => l.turn === 2).map(l => l.text).join(' ')), 'chips again on turn 2');
});

test('moves: Mind Blown and Steel Beam cost half the user\'s max HP; Struggle a quarter', () => {
  const st = battle([mew(['Mind Blown'])], [slowMew(['Splash'])], { p: ['Mind Blown'], a: ['Splash'] }, { dice: NEVER });
  assert(P(st).maxHp - P(st).hp === Math.ceil(P(st).maxHp / 2), 'Mind Blown: half max HP, rounded up');
});

test('moves: Brick Break shatters screens; Defog clears hazards; Rapid Spin clears the user\'s side', () => {
  let st = battle([spec('Mew', 100, ['Brick Break'], { nature: 'Brave' })], [spec('Mew', 100, ['Reflect'], { key: 'Foe' })], { p: ['Brick Break'], a: ['Reflect'] });
  assert(!st.a.screens.reflect, 'Reflect is gone');
  st = battle([mew(['Defog'])], [slowMew(['Splash'])], { p: ['Defog'], a: ['Splash'] }, { setup: s => { s.p.hazards.sr = 1; s.a.hazards.spikes = 2; } });
  assert(!st.p.hazards.sr && !st.a.hazards.spikes, 'Defog clears both sides');
});

test('moves: Assist calls a teammate\'s move; Transform copies the target; Charge doubles the next Electric move', () => {
  let st = battle([mew(['Assist']), spec('Snorlax', 100, ['Swords Dance'])], [slowMew(['Splash'])], { p: ['Assist'], a: ['Splash'] });
  assert(/Assist calls Swords Dance/.test(text(st)) && P(st).boosts.atk === 2, 'Assist: Swords Dance');
  st = battle([mew(['Transform'])], [spec('Snorlax', 100, ['Body Slam'], { nature: 'Brave', key: 'Foe' })], { p: ['Transform'], a: ['Body Slam'] }, { dice: NEVER });
  assert(P(st).moves.includes(mid('Body Slam')) && P(st).types.includes('Normal'), 'Transform: moves and types');
  const plain = battle([mew(['Thunderbolt'])], [slowMew(['Splash'])], { p: ['Thunderbolt'], a: ['Splash'] }, { dice: NEVER });
  st = battle([mew(['Charge', 'Thunderbolt'])], [slowMew(['Splash'])], { p: ['Charge', 'Thunderbolt'], a: ['Splash'] }, { turns: 2, dice: NEVER });
  assert(A(st).maxHp - A(st).hp > 1.8 * (A(plain).maxHp - A(plain).hp), 'Charge doubles Thunderbolt');
});

test('moves: Spit Up hits by its Stockpile and fails without; Swallow heals by it', () => {
  const st = battle([mew(['Stockpile', 'Spit Up'])], [slowMew(['Splash'])], { p: ['Stockpile', 'Stockpile', 'Spit Up'], a: ['Splash'] }, { turns: 3, dice: NEVER });
  assert(A(st).hp < A(st).maxHp && P(st).stockpile === 0 && P(st).boosts.def === 0, 'Spit Up used both Stockpiles');
  const st2 = battle([mew(['Spit Up'])], [slowMew(['Splash'])], { p: ['Spit Up'], a: ['Splash'] });
  assert(A(st2).hp === A(st2).maxHp, 'Spit Up with nothing stored fails');
});
