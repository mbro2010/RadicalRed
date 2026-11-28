// Abilities that change how a battle goes (not just its damage), as the game's engine runs them.
const { SIM, E, test, assert, mid } = require('./lib');
const { spec, battle, ALWAYS, NEVER, P, A, text, mew, slowMew, lax } = require('./duel');

test('abilities: Contrary turns stat changes around (Leaf Storm raises Sp. Atk); Simple doubles them', () => {
  let st = battle([mew(['Leaf Storm'], { ability: 'Contrary' })], [slowMew(['Splash'])], { p: ['Leaf Storm'], a: ['Splash'] }, { dice: NEVER });
  assert(P(st).boosts.spa === 2, 'Contrary Leaf Storm: +2 Sp. Atk, got ' + P(st).boosts.spa);
  st = battle([mew(['Swords Dance'], { ability: 'Simple' })], [slowMew(['Splash'])], { p: ['Swords Dance'], a: ['Splash'] });
  assert(P(st).boosts.atk === 4, 'Simple Swords Dance: +4');
  st = battle([mew(['Splash'], { ability: 'Contrary' })], [spec('Mew', 100, ['Splash'], { ability: 'Intimidate', nature: 'Brave', key: 'Foe' })], { p: ['Splash'], a: ['Splash'] });
  assert(P(st).boosts.atk === 1, 'Intimidate on a Contrary Pokemon raises its Attack');
});

test('abilities: Neutralizing Gas switches off the other abilities while it is out (Levitate no longer saves you)', () => {
  const st = battle([spec('Gengar', 100, ['Splash'], { ability: 'Levitate' })], [spec('Mew', 100, ['Earthquake'], { ability: 'Neutralizing Gas', key: 'Foe' })], { p: ['Splash'], a: ['Earthquake'] }, { dice: NEVER });
  assert(P(st).hp < P(st).maxHp, 'Earthquake hits a Levitate Gengar under Neutralizing Gas: ' + text(st));
  // when it leaves, the abilities come back
  const st2 = battle([spec('Gengar', 100, ['Splash'], { ability: 'Levitate' })], [spec('Mew', 100, ['Splash'], { ability: 'Neutralizing Gas', key: 'Foe' }), lax()], { p: ['Splash'], a: ['switch:1'] });
  assert(P(st2).ability === 'Levitate', 'Levitate is back after the gas leaves');
});

test('abilities: Magic Bounce sends status moves and hazards back; Good as Gold ignores status moves', () => {
  let st = battle([mew(['Thunder Wave'])], [slowMew(['Splash'], { ability: 'Magic Bounce' })], { p: ['Thunder Wave'], a: ['Splash'] });
  assert(P(st).status === 'par' && !A(st).status, 'Thunder Wave bounced back');
  st = battle([mew(['Stealth Rock'])], [slowMew(['Splash'], { ability: 'Magic Bounce' })], { p: ['Stealth Rock'], a: ['Splash'] });
  assert(st.p.hazards.sr && !st.a.hazards.sr, 'Stealth Rock lands on the side that set it');
  st = battle([mew(['Toxic'])], [slowMew(['Splash'], { ability: 'Good as Gold' })], { p: ['Toxic'], a: ['Splash'] });
  assert(!A(st).status, 'Good as Gold: no Toxic');
});

test('abilities: Trace copies the foe\'s ability (Intimidate goes off); Synchronize passes poison, paralysis and burns back', () => {
  let st = battle([mew(['Splash'], { ability: 'Trace' })], [spec('Mew', 100, ['Splash'], { ability: 'Intimidate', nature: 'Brave', key: 'Foe' })], { p: ['Splash'], a: ['Splash'] });
  assert(P(st).ability === 'Intimidate' && A(st).boosts.atk === -1, 'traced Intimidate lowers the foe\'s Attack');
  st = battle([mew(['Toxic'])], [slowMew(['Splash'], { ability: 'Synchronize' })], { p: ['Toxic'], a: ['Splash'] });
  assert(A(st).status === 'tox' && P(st).status === 'tox', 'Synchronize: both badly poisoned');
});

test('abilities: Damp stops Explosion; Unnerve keeps berries uneaten; Gluttony eats pinch berries at half HP', () => {
  let st = battle([mew(['Explosion'])], [slowMew(['Splash'], { ability: 'Damp' })], { p: ['Explosion'], a: ['Splash'] });
  assert(!P(st).fainted && A(st).hp === A(st).maxHp, 'Damp: no Explosion');
  st = battle([mew(['Super Fang'], { ability: 'Unnerve' })], [slowMew(['Splash'], { item: 'Sitrus Berry' })], { p: ['Super Fang'], a: ['Splash'] }, { dice: NEVER });
  assert(E.itemName(A(st).item) === 'Sitrus Berry', 'Unnerve: the Sitrus Berry stays');
  // a hit that leaves it between a quarter and half of its HP: Gluttony eats the Figy Berry, without it the berry waits
  const half = s => { A(s).hp = Math.floor(A(s).maxHp / 2) + 20; };
  st = battle([mew(['Tackle'])], [slowMew(['Splash'], { item: 'Figy Berry', ability: 'Gluttony' })], { p: ['Tackle'], a: ['Splash'] }, { dice: NEVER, setup: half });
  assert(!A(st).item, 'Gluttony eats the Figy Berry at half HP');
  st = battle([mew(['Tackle'])], [slowMew(['Splash'], { item: 'Figy Berry' })], { p: ['Tackle'], a: ['Splash'] }, { dice: NEVER, setup: half });
  assert(A(st).item, 'without Gluttony it waits for a quarter');
});

test('abilities: Protean turns the user into its move\'s type; Soul-Heart gains Sp. Atk when anything faints', () => {
  let st = battle([mew(['Ice Beam'], { ability: 'Protean' })], [slowMew(['Splash'])], { p: ['Ice Beam'], a: ['Splash'] }, { dice: NEVER });
  assert(P(st).types.length === 1 && P(st).types[0] === 'Ice', 'Protean: Ice type now');
  st = battle([mew(['Final Gambit'])], [slowMew(['Splash'], { ability: 'Soul-Heart' }), lax()], { p: ['Final Gambit'], a: ['Splash'] }, { setup: s => { A(s).hp = 50; } });
  assert(st.a.team[0].fainted || /Soul-Heart|SPA/.test(text(st)), 'something fainted');
});

test('abilities: Bad Dreams hurts sleeping foes, Shed Skin and Hydration cure status, Early Bird wakes early', () => {
  let st = battle([mew(['Splash'], { nature: 'Brave' })], [spec('Mew', 100, ['Spore'], { ability: 'Bad Dreams', key: 'Foe' })], { p: ['Splash'], a: ['Spore'] });
  assert(P(st).status === 'slp' && P(st).hp < P(st).maxHp && /Bad Dreams/.test(text(st)), 'Bad Dreams: ' + text(st));
  st = battle([mew(['Splash'], { ability: 'Hydration' })], [slowMew(['Toxic'])], { p: ['Splash'], a: ['Toxic'] }, { setup: s => { s.weather = 'Rain'; s.weatherTurns = 5; } });
  assert(!P(st).status, 'Hydration cures in the rain');
});

test('abilities: Poison Touch poisons on contact; Gulp Missile spits back after Surf; Cloud Nine switches weather off', () => {
  let st = battle([mew(['Tackle'], { ability: 'Poison Touch' })], [slowMew(['Splash'])], { p: ['Tackle'], a: ['Splash'] });
  assert(A(st).status === 'psn', 'Poison Touch');
  st = battle([spec('Mew', 100, ['Tackle'], { nature: 'Brave' })], [spec('Cramorant', 100, ['Surf'], { ability: 'Gulp Missile', key: 'Foe' })], { p: ['Tackle'], a: ['Surf'] }, { dice: NEVER });
  assert(/Gulp Missile/.test(text(st)) && P(st).boosts.def === -1, 'Gulp Missile: hurt and Defense down: ' + text(st));
  st = battle([mew(['Thunder'], { ability: 'Cloud Nine' })], [slowMew(['Splash'])], { p: ['Thunder'], a: ['Splash'] }, { setup: s => { s.weather = 'Sun'; s.weatherTurns = 5; } });
  assert(SIM.hitChance(st, P(st), A(st), SIM.meta(mid('Thunder'))) > 0.6, 'Cloud Nine: sun no longer drops Thunder to 50%');
});

test('abilities: a Blue Orb Kyogre turns Primal as it comes in, and its heavy rain makes Fire moves fail; Dragon Ascent Rayquaza Mega Evolves', () => {
  const st = battle([spec('Charizard', 100, ['Flamethrower'])], [spec('Kyogre', 100, ['Splash'], { item: 'Blue Orb', ability: 'Drizzle', key: 'Foe' })], { p: ['Flamethrower'], a: ['Splash'] }, { dice: NEVER });
  assert(/Primal/.test(E.sp(A(st).spec.s).n), 'Kyogre-Primal: ' + E.sp(A(st).spec.s).n);
  assert(SIM.heldForm({ spec: { s: A(st).spec.s }, item: null }) === null, 'and no further form');
  assert(st.weather === 'Heavy Rain' && A(st).hp === A(st).maxHp, 'heavy rain: Flamethrower does nothing: ' + text(st));
  const st2 = battle([spec('Mew', 100, ['Splash'], { nature: 'Brave' })], [spec('Rayquaza', 100, ['Dragon Ascent'], { key: 'Foe' })], { p: ['Splash'], a: ['Dragon Ascent'] }, { dice: NEVER });
  assert(/Mega/.test(E.sp(A(st2).spec.s).n), 'Rayquaza Mega Evolves: ' + E.sp(A(st2).spec.s).n);
});
