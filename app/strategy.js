/* How a boss fights, and what to exploit: notes for each of their Pokemon (its item, ability and moves, as the game's
 * engine runs them) and for the fight as a whole, worked out from the boss AI's own rules (ai.js, a port of CFRU's battle
 * AI). Everything here comes from the boss's set and those rules; nothing is hand-written per boss.
 *
 *   createStrategy(E, SIM).bossNotes(bossIndex, top) -> { lead, team: [note], mons: [{ s, name, style, notes: [note] }],
 *                                                        exploits: [note] }
 * A note is { t: text, k: 'item' | 'ability' | 'move' | 'ai' | 'form' | 'field' | 'cheese' }. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.createStrategy = factory;
})(typeof self !== 'undefined' ? self : this, function createStrategy(E, SIM) {
  'use strict';
  const D = E.D;
  const mvName = id => { const m = E.mv(id); return m ? m.f || m.n : '?'; };
  const mvOf = id => E.mv(id) || {};
  const STYLE = {
    kill: 'Attacker: it goes for a knockout whenever it sees one, and otherwise its strongest hit',
    setup: 'Set-up sweeper: it boosts when it judges it safe, then attacks',
    status: 'Status attacker: it spreads status when that pays, and attacks',
    stall: 'Staller: it wears you down with status, healing and chip damage',
    baton: 'Baton Passer: it boosts and passes the boosts to a teammate',
    cleric: 'Support: it heals and cures its team',
    screens: 'Screen setter: it puts up Reflect or Light Screen for its team',
    setupScreens: 'Screens and attacks',
    phaze: 'Phazer: it forces your boosts away',
    hazards: 'Hazard setter: it lays its hazards first',
  };
  const TYPE_OF_ITEM = { 'Mystic Water': 'Water', Charcoal: 'Fire', 'Miracle Seed': 'Grass', Magnet: 'Electric', 'Never-Melt Ice': 'Ice', NeverMeltIce: 'Ice',
    'Black Belt': 'Fighting', 'Poison Barb': 'Poison', 'Soft Sand': 'Ground', 'Sharp Beak': 'Flying', 'Twisted Spoon': 'Psychic', 'Silver Powder': 'Bug',
    SilverPowder: 'Bug', 'Hard Stone': 'Rock', 'Spell Tag': 'Ghost', 'Dragon Fang': 'Dragon', 'Black Glasses': 'Dark', BlackGlasses: 'Dark', 'Metal Coat': 'Steel',
    'Silk Scarf': 'Normal', 'Flame Plate': 'Fire', 'Splash Plate': 'Water', 'Meadow Plate': 'Grass', 'Zap Plate': 'Electric', 'Icicle Plate': 'Ice', 'Fist Plate': 'Fighting',
    'Toxic Plate': 'Poison', 'Earth Plate': 'Ground', 'Sky Plate': 'Flying', 'Mind Plate': 'Psychic', 'Insect Plate': 'Bug', 'Stone Plate': 'Rock', 'Spooky Plate': 'Ghost',
    'Draco Plate': 'Dragon', 'Dread Plate': 'Dark', 'Iron Plate': 'Steel', 'Pixie Plate': 'Fairy', 'Sea Incense': 'Water', 'Wave Incense': 'Water', 'Rose Incense': 'Grass',
    'Odd Incense': 'Psychic', 'Rock Incense': 'Rock' };
  const RESIST = { 'Occa Berry': 'Fire', 'Passho Berry': 'Water', 'Wacan Berry': 'Electric', 'Rindo Berry': 'Grass', 'Yache Berry': 'Ice',
    'Chople Berry': 'Fighting', 'Kebia Berry': 'Poison', 'Shuca Berry': 'Ground', 'Coba Berry': 'Flying', 'Payapa Berry': 'Psychic',
    'Tanga Berry': 'Bug', 'Charti Berry': 'Rock', 'Kasib Berry': 'Ghost', 'Haban Berry': 'Dragon', 'Colbur Berry': 'Dark',
    'Babiri Berry': 'Steel', 'Roseli Berry': 'Fairy', 'Chilan Berry': 'Normal' };

  function itemNotes(t, moves) {
    const it = E.itemName(t.it);
    if (!it) return [];
    const two = moves.filter(id => [145, 151, 155, 75, 39].includes(mvOf(id).e) || /^(Meteor Beam|Electro Shot|Geomancy|Solar Beam|Solar Blade|Sky Attack)$/.test(mvName(id)));
    const N = {
      'Focus Sash': 'Focus Sash: it lives through any one hit from full HP. Chip it first (Stealth Rock, sand or hail, a multi-hit move, any weak hit), then knock it out.',
      'Weakness Policy': 'Weakness Policy: a super-effective hit that doesn\'t knock it out gives it +2 Attack and Sp. Atk. Knock it out in one hit, or hit it with neutral moves.',
      'Choice Scarf': 'Choice Scarf: 1.5x Speed, but locked into its first move until it switches. Bring in something that walls that move.',
      'Choice Band': 'Choice Band: 1.5x Attack, locked into its first move until it switches.',
      'Choice Specs': 'Choice Specs: 1.5x Sp. Atk, locked into its first move until it switches.',
      'Assault Vest': 'Assault Vest: 1.5x Sp. Def and no status moves: it only attacks.',
      'Life Orb': 'Life Orb: its hits do 1.3x, and each one costs it a tenth of its HP.',
      'Leftovers': 'Leftovers: it heals 1/16 of its HP every turn.',
      'Black Sludge': 'Black Sludge: it heals 1/16 of its HP every turn.',
      'Rocky Helmet': 'Rocky Helmet: contact moves cost you 1/6 of your HP.',
      'Air Balloon': 'Air Balloon: Ground moves miss it until any hit pops the balloon.',
      'White Herb': 'White Herb: undoes its lowered stats once (after Shell Smash, Close Combat or your Intimidate).',
      'Lum Berry': 'Lum Berry: it shakes off the first status or confusion.',
      'Sitrus Berry': 'Sitrus Berry: it heals a quarter once it falls to half HP.',
      'Custap Berry': 'Custap Berry: at a quarter of its HP it moves first, once.',
      'Booster Energy': 'Booster Energy: its Protosynthesis or Quark Drive is on from the start (its best stat x1.3, or Speed x1.5).',
      'Eviolite': 'Eviolite: 1.5x Defense and Sp. Def (it can still evolve).',
      'Light Clay': 'Light Clay: its screens last 8 turns.',
      'Heavy-Duty Boots': 'Heavy-Duty Boots: hazards don\'t touch it.',
      'Toxic Orb': 'Toxic Orb: it badly poisons itself at the end of the first turn (it wants the status: Guts, Poison Heal, Toxic Boost).',
      'Flame Orb': 'Flame Orb: it burns itself at the end of the first turn (it wants the status: Guts, Flare Boost).',
      'Expert Belt': 'Expert Belt: its super-effective hits do 1.2x.',
      'Muscle Band': 'Muscle Band: its physical hits do 1.1x.', 'Wise Glasses': 'Wise Glasses: its special hits do 1.1x.',
      'Scope Lens': 'Scope Lens: critical hits are more likely (1 in 8).', 'Razor Claw': 'Razor Claw: critical hits are more likely (1 in 8).',
      'Wide Lens': 'Wide Lens: its moves are 10% more accurate.', 'Bright Powder': 'Bright Powder: your moves are 10% less accurate against it.',
      'Shell Bell': 'Shell Bell: it heals an eighth of the damage it deals.', 'Big Root': 'Big Root: its draining moves heal 30% more.',
      'Throat Spray': 'Throat Spray: +1 Sp. Atk after its first sound move.', 'Terrain Extender': 'Terrain Extender: its terrain lasts 8 turns.',
      'Damp Rock': 'Damp Rock: its rain lasts 8 turns.', 'Heat Rock': 'Heat Rock: its sun lasts 8 turns.',
      'Smooth Rock': 'Smooth Rock: its sandstorm lasts 8 turns.', 'Icy Rock': 'Icy Rock: its snow lasts 8 turns.',
      'Electric Seed': 'Electric Seed: +1 Defense once Electric Terrain is up.', 'Grassy Seed': 'Grassy Seed: +1 Defense once Grassy Terrain is up.',
      'Psychic Seed': 'Psychic Seed: +1 Sp. Def once Psychic Terrain is up.', 'Misty Seed': 'Misty Seed: +1 Sp. Def once Misty Terrain is up.',
      'Red Card': 'Red Card: the first Pokémon that hits it is sent back and something else is dragged in.',
      'Eject Button': 'Eject Button: it switches out after the first hit it takes.',
      'Quick Claw': 'Quick Claw: sometimes it moves first.', 'King\'s Rock': 'King\'s Rock: its hits can make you flinch.', 'Razor Fang': 'Razor Fang: its hits can make you flinch.',
      'Clear Amulet': 'Clear Amulet: you can\'t lower its stats.', 'Covert Cloak': 'Covert Cloak: your moves\' extra effects don\'t touch it.',
      'Loaded Dice': 'Loaded Dice: its multi-hit moves hit 4 or 5 times.', 'Punching Glove': 'Punching Glove: its punches do 1.1x without contact.',
      'Iron Ball': 'Iron Ball: it\'s slow and grounded.', 'Mental Herb': 'Mental Herb: it shakes off Taunt, Encore or Disable once.',
      'Power Herb': two.length ? `Power Herb: ${mvName(two[0])} hits on the first turn, once.` : 'Power Herb: a two-turn move hits at once.',
      'Leek Stick': 'Leek Stick: its critical hits are much more likely.',
    };
    if (N[it]) return [N[it]];
    if (RESIST[it]) return [`${it}: the first super-effective ${RESIST[it]} hit on it does half.`];
    if (/ Gem$/.test(it)) return [`${it}: its first ${it.replace(' Gem', '')} move does 1.5x (Radical Red), then it's gone.`];
    if (TYPE_OF_ITEM[it]) return [`${it}: its ${TYPE_OF_ITEM[it]} moves do 1.2x.`];
    if (/ium Z$/.test(it)) return [`${it}: one Z-Move, once. It uses it unless the plain move already knocks you out.`];
    return [];
  }

  const ABILITY = {
    Intimidate: 'Intimidate: your Attack drops a stage when it comes in (not for Clear Body, Inner Focus, Own Tempo, Oblivious or Scrappy; Defiant and Competitive turn it around).',
    Sturdy: 'Sturdy: it lives through any one hit from full HP. Chip it first.',
    Multiscale: 'Multiscale: it takes half damage at full HP. Chip it first (hazards, weather, a weak hit).',
    'Shadow Shield': 'Shadow Shield: it takes half damage at full HP. Chip it first.',
    Unaware: 'Unaware: it ignores your stat boosts. Setting up against it does nothing.',
    'Magic Bounce': 'Magic Bounce: your status moves and hazards bounce back at you.',
    Contrary: 'Contrary: its stat changes are reversed (its drops become boosts; your Intimidate raises it).',
    Moxie: 'Moxie: +1 Attack for every knockout. Don\'t feed it.', 'Beast Boost': 'Beast Boost: its best stat rises with every knockout.',
    'Soul-Heart': 'Soul-Heart: +1 Sp. Atk whenever any Pokémon faints.', 'Supreme Overlord': 'Supreme Overlord: 10% more power for each teammate that has fainted: it gets stronger as you win.',
    'Speed Boost': 'Speed Boost: +1 Speed every turn.', Regenerator: 'Regenerator: it heals a third when it switches out.',
    'Natural Cure': 'Natural Cure: switching out cures its status, and the AI uses that.', Prankster: 'Prankster: its status moves go first (Dark types are immune to them).',
    Levitate: 'Levitate: Ground moves miss.', 'Volt Absorb': 'Volt Absorb: Electric moves heal it.', 'Water Absorb': 'Water Absorb: Water moves heal it.',
    'Dry Skin': 'Dry Skin: Water moves heal it; Fire does 1.25x.', 'Flash Fire': 'Flash Fire: Fire moves power it up instead.', 'Sap Sipper': 'Sap Sipper: Grass moves raise its Attack.',
    'Storm Drain': 'Storm Drain: Water moves raise its Sp. Atk.', 'Lightning Rod': 'Lightning Rod: Electric moves raise its Sp. Atk.', 'Motor Drive': 'Motor Drive: Electric moves raise its Speed.',
    'Earth Eater': 'Earth Eater: Ground moves heal it.', 'Well-Baked Body': 'Well-Baked Body: Fire moves raise its Defense.', 'Wind Rider': 'Wind Rider: wind moves raise its Attack.',
    'Mold Breaker': 'Mold Breaker: it ignores your ability (Levitate, Sturdy, Multiscale...).', Teravolt: 'Teravolt: it ignores your ability.', Turboblaze: 'Turboblaze: it ignores your ability.',
    'Shadow Tag': 'Shadow Tag: you can\'t switch out (Ghost types can).', 'Arena Trap': 'Arena Trap: grounded Pokémon can\'t switch out.', 'Magnet Pull': 'Magnet Pull: Steel types can\'t switch out.',
    'Iron Barbs': 'Iron Barbs: contact moves cost you 1/8 of your HP.', 'Rough Skin': 'Rough Skin: contact moves cost you 1/8 of your HP.',
    Static: 'Static: contact moves may paralyze you.', 'Flame Body': 'Flame Body: contact moves may burn you.', 'Poison Point': 'Poison Point: contact moves may poison you.',
    'Effect Spore': 'Effect Spore: contact moves may poison, paralyze or sleep you.', 'Cursed Body': 'Cursed Body: hitting it may disable your move.',
    Defiant: 'Defiant: lowering its stats gives it +2 Attack. Don\'t.', Competitive: 'Competitive: lowering its stats gives it +2 Sp. Atk. Don\'t.',
    Guts: 'Guts: a status condition makes it stronger. Don\'t burn or poison it.', 'Toxic Boost': 'Toxic Boost: poison makes it stronger.', 'Flare Boost': 'Flare Boost: a burn makes it stronger.',
    'Quick Feet': 'Quick Feet: a status makes it faster.', 'Poison Heal': 'Poison Heal: poison heals it.', Unburden: 'Unburden: its Speed doubles once its item is used.',
    Protean: 'Protean: it takes the type of each move it uses (its weaknesses change).', Libero: 'Libero: it takes the type of each move it uses.',
    'Wonder Guard': 'Wonder Guard: only super-effective hits touch it (and hazards, weather, status).',
    'Sheer Force': 'Sheer Force: its moves do 1.3x but lose their extra effects.', 'Serene Grace': 'Serene Grace: its moves\' extra effects (flinches!) are twice as likely.',
    'Skill Link': 'Skill Link: its multi-hit moves hit 5 times (and break a Focus Sash).', 'No Guard': 'No Guard: every move hits, its and yours.',
    'Swift Swim': 'Swift Swim: double Speed in rain.', Chlorophyll: 'Chlorophyll: double Speed in sun.', 'Sand Rush': 'Sand Rush: double Speed in sand.', 'Slush Rush': 'Slush Rush: double Speed in snow.',
    'Surge Surfer': 'Surge Surfer: double Speed on Electric Terrain.', Drizzle: 'Drizzle: it brings rain as it comes in.', Drought: 'Drought: it brings sun as it comes in.',
    'Sand Stream': 'Sand Stream: it brings a sandstorm as it comes in.', 'Snow Warning': 'Snow Warning: it brings snow as it comes in.',
    'Primordial Sea': 'Primordial Sea: heavy rain while it\'s out. Fire moves fail.', 'Desolate Land': 'Desolate Land: harsh sunshine while it\'s out. Water moves fail.',
    'Delta Stream': 'Delta Stream: strong winds while it\'s out: Flying types lose their weaknesses.',
    'Electric Surge': 'Electric Surge: Electric Terrain as it comes in (no sleep on the ground).', 'Grassy Surge': 'Grassy Surge: Grassy Terrain as it comes in (healing; Earthquake halved).',
    'Psychic Surge': 'Psychic Surge: Psychic Terrain as it comes in (no priority moves on the ground).', 'Misty Surge': 'Misty Surge: Misty Terrain as it comes in (no status on the ground).',
    Trace: 'Trace: it copies your ability as it comes in.', 'Neutralizing Gas': 'Neutralizing Gas: every other ability is off while it\'s out (your Levitate too).',
    Illusion: 'Illusion: it comes in disguised as its last teammate (and in Radical Red does 1.3x).', Disguise: 'Disguise: its first hit is blocked (it loses 1/8 instead).',
    Damp: 'Damp: nobody can explode while it\'s out.', Unnerve: 'Unnerve: your berries don\'t work while it\'s out.', 'As One': 'As One: your berries don\'t work while it\'s out.',
    'Inner Focus': 'Inner Focus: no flinching and no Intimidate.', Truant: 'Truant: it loafs every other turn. Set up then.', Simple: 'Simple: its stat changes are doubled.',
    'Bad Dreams': 'Bad Dreams: sleeping Pokémon lose 1/8 a turn.', 'Gulp Missile': 'Gulp Missile: after Surf or Dive, the next hit it takes costs the attacker a quarter of its HP.',
    'Zero to Hero': 'Zero to Hero: once it switches out and back, it\'s Palafin-Hero.', 'Phoenix Down': 'Phoenix Down (Radical Red): it revives at half HP the first time it faints.',
    Synchronize: 'Synchronize: poisoning, paralyzing or burning it does the same to you.', Technician: 'Technician: its weak moves (60 power or less) do 1.5x.',
    'Huge Power': 'Huge Power: double Attack.', 'Pure Power': 'Pure Power: double Attack.', Adaptability: 'Adaptability: its STAB moves do 2x.',
    'Tinted Lens': 'Tinted Lens: resisting its moves helps half as much.', Sniper: 'Sniper: its critical hits do 2.25x.', 'Super Luck': 'Super Luck: critical hits are more likely.',
    Pressure: 'Pressure: your moves use 2 PP.', 'Good as Gold': 'Good as Gold: status moves don\'t touch it.', 'Purifying Salt': 'Purifying Salt: no status, and Ghost moves do half.',
    'Thick Fat': 'Thick Fat: Fire and Ice moves do half.', Heatproof: 'Heatproof: Fire moves do half.', 'Water Bubble': 'Water Bubble: Fire moves do half; no burns.',
    'Fur Coat': 'Fur Coat: physical hits do half.', 'Ice Scales': 'Ice Scales: special hits do half.', 'Solid Rock': 'Solid Rock: super-effective hits do 3/4.',
    Filter: 'Filter: super-effective hits do 3/4.', 'Prism Armor': 'Prism Armor: super-effective hits do 3/4.', 'Primal Armor': 'Primal Armor (Radical Red): super-effective hits do half.',
    Dazzling: 'Dazzling: priority moves don\'t work on it.', 'Queenly Majesty': 'Queenly Majesty: priority moves don\'t work on it.', 'Armor Tail': 'Armor Tail: priority moves don\'t work on it.',
    'Sage Power': 'Sage Power (Radical Red): 1.5x Sp. Atk, locked into its first move.', 'Gorilla Tactics': 'Gorilla Tactics: 1.5x Attack, locked into its first move.',
    'Bull Rush': 'Bull Rush (Radical Red): its first turn out is faster and hits harder.', 'Feline Prowess': 'Feline Prowess (Radical Red): double Sp. Atk.',
    Stalwart: 'Stalwart: its moves can\'t be redirected.', 'Cloud Nine': 'Cloud Nine: weather does nothing while it\'s out.', 'Air Lock': 'Air Lock: weather does nothing while it\'s out.',
    Download: 'Download: +1 Attack or Sp. Atk as it comes in, by your weaker defense.', 'Intrepid Sword': 'Intrepid Sword: +1 Attack as it comes in.', 'Dauntless Shield': 'Dauntless Shield: +1 Defense as it comes in.',
    Stamina: 'Stamina: +1 Defense every time it\'s hit.', 'Weak Armor': 'Weak Armor: physical hits lower its Defense and raise its Speed by 2.',
    'Steam Engine': 'Steam Engine: a Fire or Water hit maxes its Speed.', Justified: 'Justified: Dark hits raise its Attack.', Berserk: 'Berserk: +1 Sp. Atk when it falls below half.',
    'Anger Point': 'Anger Point: a critical hit maxes its Attack.', Mummy: 'Mummy: contact turns your ability into Mummy.', 'Poison Touch': 'Poison Touch: its contact moves may poison you.',
    'Toxic Chain': 'Toxic Chain: its hits may badly poison you.', Magician: 'Magician: its hits steal your item.', 'Shed Skin': 'Shed Skin: a third of the time it cures its status at the end of a turn.',
    Hydration: 'Hydration: rain cures its status.', 'Early Bird': 'Early Bird: it wakes up twice as fast.', Insomnia: 'Insomnia: it can\'t be put to sleep.', 'Vital Spirit': 'Vital Spirit: it can\'t be put to sleep.',
    Comatose: 'Comatose: it counts as asleep and can\'t be statused.', Limber: 'Limber: it can\'t be paralyzed.', 'Own Tempo': 'Own Tempo: it can\'t be confused.', Oblivious: 'Oblivious: no Taunt, no Intimidate.',
    'Clear Body': 'Clear Body: you can\'t lower its stats.', 'White Smoke': 'White Smoke: you can\'t lower its stats.', 'Full Metal Body': 'Full Metal Body: you can\'t lower its stats.',
    'Battle Armor': 'Battle Armor: no critical hits on it.', 'Shell Armor': 'Shell Armor: no critical hits on it.', Soundproof: 'Soundproof: sound moves don\'t touch it.',
    Bulletproof: 'Bulletproof: ball and bomb moves don\'t touch it.', Overcoat: 'Overcoat: no powders, no weather damage.', 'Sticky Hold': 'Sticky Hold: its item can\'t be taken.',
    'Suction Cups': 'Suction Cups: it can\'t be forced out.', 'Mirror Armor': 'Mirror Armor: your stat drops bounce back.', Steadfast: 'Steadfast: flinching raises its Speed.',
    Electromorphosis: 'Electromorphosis: getting hit charges its next Electric move.', 'Cheek Pouch': 'Cheek Pouch: eating a berry heals it a third too.', Gluttony: 'Gluttony: it eats its pinch berry at half HP.',
    Ripen: 'Ripen: its berries work twice as well.',
  };
  function abilityNotes(t) {
    const a = E.canonAbility(t.ab);
    if (!a) return [];
    if (ABILITY[a]) return [ABILITY[a]];
    const info = E.abilityInfo ? E.abilityInfo(a) : null;
    const d = info && (info.d || info.desc);
    return d ? [`${a}: ${String(d).replace(/\s+/g, ' ')}`] : [];
  }

  const SETUP_MOVES = /^(Swords Dance|Dragon Dance|Nasty Plot|Shell Smash|Quiver Dance|Calm Mind|Bulk Up|Coil|Shift Gear|Victory Dance|Tail Glow|Belly Drum|Agility|Rock Polish|Iron Defense|Cosmic Power|Amnesia|Work Up|Growth|Hone Claws|Geomancy|Curse|Tidy Up|No Retreat|Clangorous Soul|Fillet Away|Stockpile|Cotton Guard|Acid Armor|Barrier|Autotomize)$/;
  const SLEEP = /^(Spore|Sleep Powder|Hypnosis|Lovely Kiss|Sing|Grass Whistle|Dark Void|Yawn)$/;
  function moveNotes(t, st, m) {
    const out = [];
    const ids = t.mv || [];
    const name = new Map(ids.map(id => [id, mvName(id)]));
    const has = re => ids.filter(id => re.test(name.get(id)));
    const list = xs => xs.map(id => name.get(id)).join(', ');
    const fo = has(/^Fake Out$/);
    if (fo.length) out.push('Fake Out on its first turn out: you flinch. A Ghost type, Inner Focus or Shield Dust ignores it.');
    const prio = ids.filter(id => (mvOf(id).r || 0) > 0 && mvOf(id).k !== 'X' && !/^(Fake Out|Sucker Punch|Upper Hand|Thunderclap|First Impression)$/.test(name.get(id)));
    if (prio.length) out.push(`${list(prio)}: hits first (priority). Don't count on outspeeding it at low HP.`);
    if (has(/^(Sucker Punch|Thunderclap)$/).length) out.push(`${list(has(/^(Sucker Punch|Thunderclap)$/))}: first, but only if you attack. It uses it when it expects an attack: a status move, Protect or a switch makes it fail (and it won't use it if it expects a status move).`);
    const setup = has(SETUP_MOVES);
    if (setup.length) out.push(`${list(setup)}: it boosts only when it judges it safe: when you can't knock it out first and won't nearly do (not against Unaware, not into a Focus Sash or Sturdy it can't break). Keep a threat in front of it and it attacks instead.`);
    const boom = has(/^(Explosion|Self-Destruct|Misty Explosion|Final Gambit|Memento|Healing Wish|Lunar Dance)$/);
    if (boom.length) out.push(`${list(boom)}: when it would go down anyway (you can knock it out) and it has no other knockout, it takes you with it. A Ghost type takes no Explosion; Protect wastes it.`);
    if (has(/^Destiny Bond$/).length) out.push('Destiny Bond: when it moves second and you can knock it out, it uses Destiny Bond: the hit that knocks it out takes your Pokémon too. That turn, switch, set up or Protect, then knock it out.');
    const hz = has(/^(Stealth Rock|Spikes|Toxic Spikes|Sticky Web)$/).concat(has(/^(Stone Axe|Ceaseless Edge)$/));
    if (hz.length) out.push(`${list(hz)}: it lays hazards while they aren't up yet and you have more than one Pokémon left.`);
    if (has(/^(Reflect|Light Screen|Aurora Veil)$/).length) out.push(`${list(has(/^(Reflect|Light Screen|Aurora Veil)$/))}: halves your hits for 5 turns (8 with Light Clay). Brick Break, Psychic Fangs or Defog clears them.`);
    if (has(/^Trick Room$/).length) out.push('Trick Room: it sets it when it\'s slower than you; then slower Pokémon move first for 5 turns.');
    if (has(/^Tailwind$/).length) out.push('Tailwind: doubles its side\'s Speed for 4 turns.');
    if (has(/^(Rain Dance|Sunny Day|Sandstorm|Hail|Snowscape|Chilly Reception)$/).length) out.push(`${list(has(/^(Rain Dance|Sunny Day|Sandstorm|Hail|Snowscape|Chilly Reception)$/))}: it changes the weather.`);
    const heal = ids.filter(id => [32, 132, 37, 179].includes(mvOf(id).e) || /^(Strength Sap|Swallow|Pain Split)$/.test(name.get(id)));
    if (heal.length) out.push(`${list(heal)}: it heals when you threaten to knock it out and healing outpaces your damage. Hit hard enough that the heal can't keep up, or Taunt it.`);
    if (has(/^Rest$/).length && has(/^Sleep Talk$/).length) out.push('Rest and Sleep Talk: it keeps attacking while asleep.');
    const sleep = has(SLEEP);
    if (sleep.length) out.push(`${list(sleep)}: sleep. Not on Insomnia, Vital Spirit, Sweet Veil, behind a Substitute, under Safeguard, or on Electric or Misty Terrain; Grass types and Overcoat block powders.`);
    const stt = has(/^(Will-O-Wisp|Thunder Wave|Toxic|Glare|Stun Spore|Poison Powder|Nuzzle)$/);
    if (stt.length) out.push(`${list(stt)}: it won't use ${stt.length > 1 ? 'them' : 'it'} on a Pokémon ${stt.length > 1 ? 'they' : 'it'} can't affect, so an immune Pokémon makes it attack instead.`);
    if (has(/^(U-turn|Volt Switch|Flip Turn|Parting Shot|Teleport|Baton Pass|Shed Tail|Chilly Reception)$/).length) out.push(`${list(has(/^(U-turn|Volt Switch|Flip Turn|Parting Shot|Teleport|Baton Pass|Shed Tail|Chilly Reception)$/))}: it pivots out to the teammate that handles you best.`);
    if (has(/^(Roar|Whirlwind|Dragon Tail|Circle Throw|Haze|Clear Smog|Roar of Time)$/).length) out.push(`${list(has(/^(Roar|Whirlwind|Dragon Tail|Circle Throw|Haze|Clear Smog|Roar of Time)$/))}: your boosts (+2 or more) get forced or wiped away.`);
    if (has(/^Knock Off$/).length) out.push('Knock Off: removes your item, and does 1.5x while you hold one.');
    if (has(/^Pursuit$/).length) out.push('Pursuit: switching out against it costs you a double-power hit.');
    if (has(/^(Counter|Mirror Coat|Metal Burst|Comeuppance)$/).length) out.push(`${list(has(/^(Counter|Mirror Coat|Metal Burst|Comeuppance)$/))}: it returns the hit it takes. It uses it when it expects your attack; a status move makes it fail.`);
    if (has(/^(Trick|Switcheroo)$/).length) out.push(`${list(has(/^(Trick|Switcheroo)$/))}: it hands you its ${E.itemName(t.it) || 'item'} (a Choice item locks you in).`);
    if (has(/^Taunt$/).length) out.push('Taunt: when it expects a status move, it Taunts you (no status moves for 3 turns).');
    if (has(/^Encore$/).length) out.push('Encore: after you use a status move, it locks you into it for 3 turns.');
    if (has(/^(Leech Seed|Sappy Seed)$/).length) out.push('Leech Seed: drains 1/8 a turn until you switch. Grass types are immune.');
    if (has(/^Substitute$/).length) out.push('Substitute: status moves and most hits stop at the doll. Sound moves and Infiltrator go through.');
    if (has(/^Perish Song$/).length) out.push('Perish Song: everyone in faints in three turns unless they switch out.');
    const trap = ids.filter(id => [42, 106].includes(mvOf(id).e) && name.get(id) !== 'Salt Cure');
    if (trap.length) out.push(`${list(trap)}: traps you (Ghost types and Shed Shell get out).`);
    const fixed = has(/^(Super Fang|Ruination|Nature's Madness|Seismic Toss|Night Shade|Dragon Rage|Sonic Boom|Endeavor|Psywave)$/);
    if (fixed.length) out.push(`${list(fixed)}: fixed damage that ignores your defenses (type immunities still work).`);
    const charge = ids.filter(id => [145, 151, 155, 75, 39].includes(mvOf(id).e) && E.itemName(t.it) !== 'Power Herb' && !/^(Meteor Beam|Electro Shot)$/.test(name.get(id)) || ([145].includes(mvOf(id).e) && /^(Meteor Beam|Electro Shot)$/.test(name.get(id)) && E.itemName(t.it) !== 'Power Herb'));
    if (charge.length) out.push(`${list(charge)}: two turns (charging, or up in the air or under ground); use the first turn${/Solar/.test(list(charge)) ? '; in sun it fires at once' : ''}.`);
    const recharge = ids.filter(id => mvOf(id).e === 80);
    if (recharge.length) out.push(`${list(recharge)}: it has to recharge the turn after. A free turn for you.`);
    const drop = has(/^(Close Combat|Superpower|Draco Meteor|Overheat|Leaf Storm|Psycho Boost|Fleur Cannon|V-create|Make It Rain|Armor Cannon|Headlong Rush|Dragon Ascent|Hammer Arm|Ice Hammer|Spin Out|Clanging Scales)$/);
    if (drop.length) out.push(`${list(drop)}: lowers its own stats each use${E.canonAbility(t.ab) === 'Contrary' ? ' (Contrary: raises them!)' : ''}.`);
    const lock = ids.filter(id => [27, 117, 159].includes(mvOf(id).e));
    if (lock.length) out.push(`${list(lock)}: it locks itself in for a few turns (Outrage and Thrash then confuse it).`);
    const z = /ium Z$/.test(E.itemName(t.it) || '') && SIM.zKind ? ids.find(id => { try { return !!SIM.zKind(st, m, id); } catch (e) { return false; } }) : null;
    if (z) out.push(`Z-Move: its ${name.get(z)} becomes a Z-Move once (when the plain move doesn't already knock you out).`);
    return out;
  }

  function bossNotes(bi, top) {
    const b = D.bosses[bi];
    const team = E.bossTeam(bi, top || b.cap).map((m, i) => Object.assign({ key: 'b' + i, label: E.sp(m.s).n }, m));
    const placeholder = { key: 'you', label: 'you', s: (D.species.find(x => x.n === 'Mew') || D.species[1]).i, lv: top || b.cap, nat: 0, ab: '', it: null, mv: [] };
    const st = SIM.newBattle([placeholder], team, { doubles: !!b.dbl });
    const mons = [], styles = [];
    st.a.team.forEach((m, j) => {
      const t = team[j];
      const notes = [];
      let style = null;
      try { style = SIM.AI.fightingStyle(st, m); } catch (e) { style = null; }
      styles.push(style);
      if (style && STYLE[style]) notes.push({ k: 'ai', t: STYLE[style] + '.' });
      const form = SIM.heldForm ? SIM.heldForm({ spec: t, item: t.it, moves: t.mv }) : null;
      if (form) {
        const f = E.sp(form), mega = /Mega/.test(f.n);
        const types = f.n.includes(f.t.join('/')) ? '' : `, ${f.t.join('/')}`;
        notes.push({ k: 'form', t: `${mega ? 'Mega Evolves on its first turn' : 'Changes form as it comes in'}: ${f.n}${types}, ability ${(f.a || []).filter(Boolean)[0] || 'unchanged'}. Plan against that form.` });
      }
      for (const x of itemNotes(t, t.mv || [])) notes.push({ k: 'item', t: x });
      for (const x of abilityNotes(form ? Object.assign({}, t, { ab: (E.sp(form).a || []).filter(Boolean)[0] || t.ab }) : t)) notes.push({ k: 'ability', t: x });
      for (const x of moveNotes(t, st, m)) notes.push({ k: 'move', t: x });
      mons.push({ s: t.s, name: E.sp(t.s).n, lv: t.lv, style, notes });
    });

    // the fight as a whole
    const teamNotes = [];
    const lead = team[0];
    teamNotes.push({ k: 'field', t: `It leads with ${E.sp(lead.s).n}${b.dbl ? ' and ' + E.sp((team[1] || lead).s).n + ' (a double battle)' : ''}, then sends the rest by the AI's switch-in scoring: whoever outspeeds and knocks out, resists your moves or walls you best.` });
    const ab = team.map(t => E.canonAbility(t.ab));
    const weather = team.filter((t, j) => /^(Drizzle|Drought|Sand Stream|Snow Warning|Primordial Sea|Desolate Land|Delta Stream|Orichalcum Pulse)$/.test(ab[j]));
    if (weather.length) teamNotes.push({ k: 'field', t: `Weather: ${weather.map((t, j) => `${E.sp(t.s).n} (${E.canonAbility(t.ab)})`).join(', ')} sets it as it comes in.` });
    const terr = team.filter((t, j) => /Surge$|^(Hadron Engine|Seed Sower)$/.test(ab[j]));
    if (terr.length) teamNotes.push({ k: 'field', t: `Terrain: ${terr.map(t => `${E.sp(t.s).n} (${E.canonAbility(t.ab)})`).join(', ')}.` });
    const intim = team.filter((t, j) => ab[j] === 'Intimidate');
    if (intim.length) teamNotes.push({ k: 'field', t: `Intimidate x${intim.length} (${intim.map(t => E.sp(t.s).n).join(', ')}): physical attackers lose Attack each time one comes in.` });

    // exploits from the AI's rules
    const ex = [];
    const any = re => team.some(t => (t.mv || []).some(id => re.test(mvName(id))));
    const anyItem = re => team.some(t => re.test(E.itemName(t.it) || ''));
    const anyAb = re => ab.some(a => re.test(a || ''));
    ex.push({ k: 'cheese', t: 'It reads your move the way it scores its own: it expects your best-scoring move and plays against that. It doesn\'t see a switch coming unless all your moves look bad, so a switch into the move it expects to answer is the cleanest way to get a free turn.' });
    ex.push({ k: 'cheese', t: 'It judges its damage at the 93% roll and counts on a critical hit only for moves that always crit. If its best hit at that roll leaves you standing, it plays as if it can\'t knock you out.' });
    ex.push({ k: 'cheese', t: 'It stays in unless: a teammate\'s ability would absorb the attack it expects (Volt Absorb, Flash Fire...); it\'s asleep without Sleep Talk (half the time); it\'s badly poisoned or seeded with more than a third of its HP; it would be knocked out before moving and a teammate resists or walls you; its Attack or Sp. Atk is at -3; it has nothing useful left; or an attacker that can\'t knock you out steps aside for a teammate that can.' });
    if (any(/^(Sucker Punch|Thunderclap)$/)) ex.push({ k: 'cheese', t: 'Sucker Punch: it fires when it expects your attack. When your best move is an attack, that\'s the turn to Protect, set up or use a status move: Sucker Punch fails and you get the turn.' });
    if (anyItem(/^Focus Sash$/) || anyAb(/^(Sturdy|Multiscale|Shadow Shield)$/)) ex.push({ k: 'cheese', t: 'Focus Sash, Sturdy and Multiscale need full HP: Stealth Rock, Spikes, sand or hail, or any chip hit first turns them off. Multi-hit moves break a Sash in one turn.' });
    if (anyItem(/^Choice /) || anyAb(/^(Gorilla Tactics|Sage Power)$/)) ex.push({ k: 'cheese', t: 'Choice-locked Pokémon (and Gorilla Tactics or Sage Power): see its first move, then switch to something that walls it. It only switches out once that move is useless.' });
    if (any(/^(Explosion|Self-Destruct|Misty Explosion)$/)) ex.push({ k: 'cheese', t: 'Explosion users explode when they would faint anyway: if you threaten a knockout, expect it. A Ghost type or Protect that turn wastes it.' });
    if (any(/^Destiny Bond$/)) ex.push({ k: 'cheese', t: 'Destiny Bond: the turn it moves second into your knockout, it bonds. Make that turn a switch, a boost or Protect, and knock it out the turn after (it can\'t use it twice in a row).' });
    if (team.some((t, j) => styles[j] === 'setup')) ex.push({ k: 'cheese', t: 'Its set-up sweepers won\'t boost while you can knock them out or nearly do. Keep something faster and strong in front of them; an Unaware Pokémon stops their boosts from mattering at all.' });
    if (any(/^(Spore|Sleep Powder|Hypnosis|Yawn|Will-O-Wisp|Thunder Wave|Toxic|Glare|Stun Spore)$/)) ex.push({ k: 'cheese', t: 'Its status moves are only used where they work: a Pokémon they can\'t affect (Electric types vs Thunder Wave, Fire vs Will-O-Wisp, Poison and Steel vs Toxic, Grass or Overcoat vs powders, Misty or Electric Terrain, Safeguard) takes attacks instead.' });
    if (team.some(t => E.canonAbility(t.ab) === 'Natural Cure' || E.canonAbility(t.ab) === 'Regenerator')) ex.push({ k: 'cheese', t: 'Natural Cure and Regenerator Pokémon switch out to cure or heal: punish the switch with hazards or a strong hit on what comes in.' });
    if (any(/^Trick Room$/)) ex.push({ k: 'cheese', t: 'Trick Room: it sets it only when it\'s slower. Lead with something slower than it and it won\'t set it, or stall out the 5 turns with Protect and switches.' });
    if (anyItem(/^Weakness Policy$/)) ex.push({ k: 'cheese', t: 'Weakness Policy: neutral hits, status and fixed damage (Seismic Toss, Super Fang) don\'t set it off.' });
    if (team.some(t => /Orb$/.test(E.itemName(t.it) || '') && SIM.heldForm && SIM.heldForm({ spec: t, item: t.it }))) ex.push({ k: 'cheese', t: 'Primal weather lasts only while its Pokémon is out. Heavy rain makes Fire moves fail, harsh sunshine Water moves; other weather can\'t replace it.' });
    if (any(/^Fake Out$/)) ex.push({ k: 'cheese', t: 'Fake Out leads: lead with a Ghost type or an Inner Focus Pokémon, or something that doesn\'t mind losing the first turn.' });
    if (anyAb(/^(Defiant|Competitive)$/)) ex.push({ k: 'cheese', t: 'Defiant and Competitive: no Intimidate, no stat-lowering moves against them.' });
    return { lead: E.sp(lead.s).n, team: teamNotes, mons, exploits: ex };
  }
  return { bossNotes };
});
