// Random damage cases for checking the Coach's damage engine against the game's own code (tools/game_damage.py).
//   NODE_PATH=... node tools/damage_cases.js data app/rrdata.json cases.json [count] [seed]
// Each case has the engine's 16 rolls ("engine") and everything the emulator needs to make the game's.
// Then:  python3 -I tools/game_damage.py cases.json out.json   and   node tools/damage_compare.js out.json
const fs = require('fs');
const path = require('path');
const C = require('@smogon/calc');
const [dataDir, appData, outFile, countArg, seedArg] = process.argv.slice(2);
const D = require(path.resolve(appData));
const E = require(path.resolve(__dirname, '../app/engine.js'))(C, D);
const ABILITIES = JSON.parse(fs.readFileSync(path.join(dataDir, 'abilities.json'), 'utf8'));
// Battle abilities are one byte: names past 255 are only display names for clones (Filter shows for Solid Rock's ID)
const abilityId = name => { const t = String(name).trim(); const i = ABILITIES.findIndex(a => a.trim() === t); return i < 0 || i > 255 ? 0 : i; };
const TYPE_ID = { Normal: 0, Fighting: 1, Flying: 2, Poison: 3, Ground: 4, Rock: 5, Bug: 6, Ghost: 7, Steel: 8, '???': 9, Fire: 10, Water: 11,
  Grass: 12, Electric: 13, Psychic: 14, Ice: 15, Dragon: 16, Dark: 17, Fairy: 23 };
const STATUS_BITS = { '': 0, brn: 0x10, psn: 0x8, par: 0x40, tox: 0x80, frz: 0x20, slp: 2 };

let seed = +(seedArg || 1) >>> 0;
const rnd = () => {                                   // mulberry32
  seed = (seed + 0x6D2B79F5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = a => a[Math.floor(rnd() * a.length)];
const chance = p => rnd() < p;

const species = D.species.filter(s => s && s.s && s.s.every(x => x > 0) && s.t && s.t.length && s.t.every(t => TYPE_ID[t] != null) && s.c);
// Plain damaging moves: fixed power, one hit, no fixed-damage or weight/HP/speed-based power, no two-turn charge
const VARIABLE = /^(False Swipe|Hold Back|Low Kick|Grass Knot|Heavy Slam|Heat Crash|Gyro Ball|Electro Ball|Eruption|Water Spout|Dragon Energy|Flail|Reversal|Return|Frustration|Punishment|Stored Power|Power Trip|Magnitude|Present|Natural Gift|Fling|Beat Up|Spit Up|Trump Card|Wring Out|Crush Grip|Hard Press|Seismic Toss|Night Shade|Dragon Rage|Sonic Boom|Super Fang|Nature's Madness|Ruination|Endeavor|Final Gambit|Psywave|Counter|Mirror Coat|Metal Burst|Comeuppance|Bide|Guillotine|Horn Drill|Fissure|Sheer Cold|Weather Ball|Terrain Pulse|Hidden Power|Judgment|Multi-Attack|Techno Blast|Revelation Dance|Aura Wheel|Ivy Cudgel|Raging Bull|Tera Blast|Photon Geyser|Shell Side Arm|Body Press|Foul Play|Psyshock|Psystrike|Secret Sword|Brine|Hex|Venoshock|Facade|Smelling Salts|Wake-Up Slap|Acrobatics|Assurance|Avalanche|Revenge|Payback|Retaliate|Round|Echoed Voice|Fury Cutter|Rollout|Ice Ball|Stomping Tantrum|Temper Flare|Knock Off|Bolt Beak|Fishious Rend|Lash Out|Rage Fist|Last Respects|Barb Barrage|Infernal Parade|Bitter Malice|Collision Course|Electro Drift|Solar Beam|Solar Blade|Expanding Force|Rising Voltage|Misty Explosion|Grav Apple|Pursuit|Freeze-Dry|Flying Press|Thousand Arrows|Struggle|Future Sight|Doom Desire|Explosion|Self-Destruct|Steel Roller|Poltergeist|Burn Up|Double Shock|Synchronoise|Dream Eater|Belch|Sucker Punch|Upper Hand|Fake Out|First Impression|Focus Punch|Shell Trap|Beak Blast|Meteor Beam|Electro Shot|Sky Attack|Razor Wind|Skull Bash|Freeze Shock|Ice Burn|Geomancy|Phantom Force|Shadow Force|Fly|Dig|Dive|Bounce|Sky Drop|Hyper Beam|Giga Impact|Blast Burn|Hydro Cannon|Frenzy Plant|Rock Wrecker|Roar of Time|Prismatic Laser|Eternabeam|Meteor Assault)$/;
const moves = D.moves.filter(m => (m.k === 'P' || m.k === 'S') && m.p > 1 && m.c && !VARIABLE.test(m.f) && (() => {
  const b = E.gen.moves.get(C.toID(m.c)); return b && !b.multihit && !b.ohko && !b.damage;
})());
const NO_EFFECT_AB = ['Run Away', 'Pickup', 'Honey Gather', 'Illuminate', 'Ball Fetch', 'Keen Eye', 'Early Bird', 'Shed Skin', 'Natural Cure', 'Insomnia',
  'Vital Spirit', 'Own Tempo', 'Oblivious', 'Inner Focus', 'Synchronize', 'Static', 'Poison Point', 'Flame Body', 'Effect Spore', 'Cute Charm',
  'Stench', 'Rattled', 'Frisk', 'Anticipation', 'Forewarn', 'Pressure', 'Unnerve', 'Telepathy'].filter(a => abilityId(a) > 0);
const ITEMS = ['Life Orb', 'Choice Band', 'Choice Specs', 'Expert Belt', 'Muscle Band', 'Wise Glasses', 'Charcoal', 'Mystic Water', 'Miracle Seed',
  'Magnet', 'Never-Melt Ice', 'Black Belt', 'Poison Barb', 'Soft Sand', 'Sharp Beak', 'Twisted Spoon', 'Silver Powder', 'Hard Stone', 'Spell Tag',
  'Dragon Fang', 'Black Glasses', 'Metal Coat', 'Silk Scarf', 'Flame Plate', 'Fire Gem', 'Water Gem', 'Normal Gem', 'Punching Glove',
  'Eviolite', 'Assault Vest', 'Occa Berry', 'Passho Berry', 'Wacan Berry', 'Rindo Berry', 'Yache Berry', 'Chople Berry', 'Kebia Berry',
  'Shuca Berry', 'Coba Berry', 'Payapa Berry', 'Tanga Berry', 'Charti Berry', 'Kasib Berry', 'Haban Berry', 'Colbur Berry', 'Babiri Berry',
  'Chilan Berry', 'Roseli Berry', 'Light Ball', 'Thick Club', 'Deep Sea Tooth', 'Deep Sea Scale', 'Metal Powder', 'Soul Dew'];
const itemByName = {};
for (const [id, it] of Object.entries(D.items)) { itemByName[it.c] = +id; itemByName[it.n] = +id; }
const items = ITEMS.filter(n => itemByName[n]);
const DMG_ABILITIES = ['Adaptability', 'Aerilate', 'Pixilate', 'Refrigerate', 'Galvanize', 'Normalize', 'Liquid Voice', 'Analytic', 'Blaze', 'Torrent',
  'Overgrow', 'Swarm', 'Guts', 'Huge Power', 'Pure Power', 'Hustle', 'Iron Fist', 'Mega Launcher', 'Strong Jaw', 'Sharpness', 'Reckless',
  'Sheer Force', 'Technician', 'Tough Claws', 'Punk Rock', 'Sand Force', 'Solar Power', 'Steelworker', 'Steely Spirit', 'Transistor',
  "Dragon's Maw", 'Rocky Payload', 'Water Bubble', 'Tinted Lens', 'Sniper', 'Neuroforce', 'Gorilla Tactics', 'Toxic Boost', 'Flare Boost',
  'Striker', 'Fatal Precision', 'Bull Rush', 'Rivalry', 'Supreme Overlord', 'Stakeout', 'Flash Fire', 'Defeatist', 'Slow Start',
  'Thick Fat', 'Heatproof', 'Filter', 'Solid Rock', 'Prism Armor', 'Multiscale', 'Shadow Shield', 'Fur Coat', 'Ice Scales', 'Fluffy',
  'Dry Skin', 'Marvel Scale', 'Grass Pelt', 'Primal Armor', 'Purifying Salt', 'Levitate', 'Wonder Guard', 'Volt Absorb', 'Water Absorb',
  'Flash Fire', 'Sap Sipper', 'Motor Drive', 'Lightning Rod', 'Storm Drain', 'Earth Eater', 'Well-Baked Body', 'Bulletproof', 'Soundproof',
  'Dauntless Shield', 'Intrepid Sword', 'Feline Prowess', 'Sage Power', 'Bone Zone', 'ORAORAORAORA!', 'Illusion', 'Long Reach', 'Unseen Fist',
  'Scrappy', 'Mold Breaker', 'Infiltrator', 'Battle Armor', 'Shell Armor', 'Super Luck', 'Merciless', 'Steadfast'].filter(a => abilityId(a) > 0 && !['Rivalry', 'ORAORAORAORA!', 'Illusion', 'Analytic', 'Stakeout', 'Flash Fire', 'Slow Start', 'Supreme Overlord', 'Intrepid Sword', 'Dauntless Shield'].includes(a));
const ABILITY_ROM = n => ABILITIES[abilityId(n)];
// Mold Breaker and the moves that ignore abilities: the game switches the target's ability off before the damage step
const MOLD_MOVES = new Set((D.moveLists && D.moveLists.moldBreaker) || []);
const BREAKABLE_DEF = ['Battle Armor', 'Clear Body', 'Damp', 'Dry Skin', 'Flash Fire', 'Heatproof', 'Hyper Cutter', 'Immunity', 'Inner Focus',
  'Insomnia', 'Keen Eye', 'Leaf Guard', 'Levitate', 'Lightning Rod', 'Limber', 'Magma Armor', 'Marvel Scale', 'Motor Drive', 'Oblivious',
  'Own Tempo', 'Sand Veil', 'Shield Dust', 'Simple', 'Snow Cloak', 'Solid Rock', 'Soundproof', 'Sticky Hold', 'Storm Drain', 'Sturdy',
  'Suction Cups', 'Tangled Feet', 'Thick Fat', 'Unaware', 'Volt Absorb', 'Water Absorb', 'Water Veil', 'Wonder Guard', 'Big Pecks',
  'Contrary', 'Friend Guard', 'Heavy Metal', 'Light Metal', 'Magic Bounce', 'Multiscale', 'Sap Sipper', 'Telepathy', 'Wonder Skin',
  'Aroma Veil', 'Bulletproof', 'Flower Veil', 'Fur Coat', 'Overcoat', 'Sweet Veil', 'Dazzling', 'Disguise', 'Fluffy', 'Water Bubble',
  'Mirror Armor', 'Punk Rock', 'Ice Scales', 'Ice Face', 'Pastel Veil', 'Grass Pelt', 'Purifying Salt', 'Well-Baked Body', 'Earth Eater',
  'Wind Rider', 'Primal Armor'];
const moldBreaks = (atk, def, move) => (['Mold Breaker', 'Teravolt', 'Turboblaze'].includes(E.canonAbility(atk.ab)) || MOLD_MOVES.has(move.i))
  && BREAKABLE_DEF.includes(E.canonAbility(def.ab));

function makeSide(tag) {
  const s = pick(species);
  const lv = chance(0.5) ? 5 + Math.floor(rnd() * 96) : pick([10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 100]);
  const nat = Math.floor(rnd() * 25);
  const ab = ABILITY_ROM(pick(NO_EFFECT_AB));
  return { s: s.i, lv, nat, ab, it: null, status: '', boosts: {}, hpPct: 100, iv: [31, 31, 31, 31, 31, 31], ev: [0, 0, 0, 0, 0, 0] };
}
function gameSide(spec) {
  const st = E.rawStats(Object.assign({}, spec, { ab: null }));
  const sp = E.sp(spec.s);
  const maxHP = st.hp;
  const b = spec.boosts || {};
  return {
    species: spec.s, level: spec.lv, stats: [st.hp, st.atk, st.def, st.spe, st.spa, st.spd],
    hp: spec.hpPct >= 100 ? maxHP : Math.max(1, Math.round(maxHP * spec.hpPct / 100)),
    types: sp.t.map(t => TYPE_ID[t]), ability: abilityId(spec.ab), item: spec.it || 0, status1: STATUS_BITS[spec.status || ''],
    stages: { atk: b.atk || 0, def: b.def || 0, spa: b.spa || 0, spd: b.spd || 0, spe: b.spe || 0 }, personality: 0,
    qp: ({ atk: 1, def: 2, spe: 3, spa: 4, spd: 5 })[E.qpStat(spec, spec._w, spec._t)] || 0,
  };
}
// every ability a battler can have (IDs below 256) and every item that does something when held
const ALL_ABILITIES = ABILITIES.map((a, i) => i).filter(i => i > 0 && i < 256 && ABILITIES[i] && !/^-+$/.test(ABILITIES[i]))
  .map(i => ABILITIES[i]).filter(a => !['Rivalry', 'ORAORAORAORA!', 'Parental Bond', 'Illusion', 'Imposter', 'Wonder Guard', 'Zen Mode', 'Stance Change', 'Schooling', 'Disguise', 'Ice Face', 'Power Construct', 'Shields Down', 'Battle Bond', 'Gulp Missile', 'Hunger Switch', 'Forecast', 'Flower Gift', 'Multitype', 'RKS System', 'Zero to Hero', 'Trace', 'Protean', 'Libero', 'Color Change', 'Mimicry', 'Analytic', 'Stakeout', 'Slow Start', 'Supreme Overlord', 'Flash Fire', 'Download', 'Intimidate', 'Intrepid Sword', 'Dauntless Shield', 'Air Lock', 'Cloud Nine', 'Neutralizing Gas', 'Drizzle', 'Drought', 'Sand Stream', 'Snow Warning', 'Primordial Sea', 'Desolate Land', 'Delta Stream', 'Electric Surge', 'Grassy Surge', 'Misty Surge', 'Psychic Surge', 'Hadron Engine', 'OrichalcumPulse', 'Protosynthesis', 'Quark Drive', 'Seed Sower', 'Sand Spit', 'Plus', 'Minus', 'Battery', 'Power Spot', 'Friend Guard', 'Valiant Shield', 'Dark Aura', 'Fairy Aura', 'Aura Break'].includes(a.trim()));
const HELD = Object.entries(D.items).filter(([id, it]) => it.he && it.c).map(([id]) => +id);
// moves whose power depends on the battle, with the state that matters
const VAR_MOVES = ['Low Kick', 'Grass Knot', 'Heavy Slam', 'Heat Crash', 'Gyro Ball', 'Electro Ball', 'Eruption', 'Water Spout', 'Flail', 'Reversal',
  'Hex', 'Venoshock', 'Infernal Parade', 'Bitter Malice', 'Barb Barrage', 'Facade', 'Acrobatics', 'Brine', 'Knock Off', 'Solar Beam', 'Solar Blade',
  'Weather Ball', 'Stored Power', 'Power Trip', 'Punishment', 'Wring Out', 'Crush Grip', 'Hard Press', 'Body Press', 'Foul Play', 'Psyshock',
  'Psystrike', 'Secret Sword', 'Photon Geyser', 'Smelling Salts', 'Wake-Up Slap', 'Freeze-Dry', 'Flying Press', 'Thousand Arrows', 'Return',
  'Frustration', 'Hydro Steam', 'Psyblade', 'Sacred Sword', 'Darkest Lariat', 'Chip Away', 'Brick Break', 'Psychic Fangs', 'Hidden Power',
  'Judgment', 'Revelation Dance', 'Terrain Pulse', 'Expanding Force', 'Rising Voltage', 'Misty Explosion', 'Collision Course', 'Electro Drift',
  'Dragon Energy', 'Steel Beam', 'Explosion', 'Self-Destruct', 'Synchronoise', 'Dream Eater', 'Last Respects', 'Rage Fist', 'Temper Flare',
  'Lash Out', 'Stomping Tantrum', 'Bolt Beak', 'Fishious Rend', 'Payback', 'Assurance', 'Avalanche', 'Revenge', 'Retaliate', 'Round', 'Echoed Voice']
  .map(n => D.moves.find(m => m.f === n)).filter(Boolean);
const KINDS = ['neutral', 'crit', 'burn', 'stages', 'weather', 'terrain', 'screens', 'item', 'atkAbility', 'defAbility', 'variable', 'variable', 'hp', 'hail', 'combo', 'combo', 'multihit'];
const N = +(countArg || 2000);
const cases = [];
const statuses = ['brn', 'psn', 'tox', 'par', 'slp', 'frz'];
for (let i = 0; i < N; i++) {
  // the first passes go through every ability and held item in turn, attacking and defending
  let kind = KINDS[i % KINDS.length];
  const sweepA = i < ALL_ABILITIES.length * 2, sweepI = !sweepA && i < ALL_ABILITIES.length * 2 + HELD.length * 2;
  if (sweepA) kind = i % 2 ? 'defAbility' : 'atkAbility';
  else if (sweepI) kind = i % 2 ? 'defItem' : 'atkItem';
  const atk = makeSide(), def = makeSide();
  let move = kind === 'variable' ? pick(VAR_MOVES) : pick(moves);
  if (kind === 'multihit') move = pick(D.moves.filter(m => { const b = m.c && E.gen.moves.get(C.toID(m.c)); return b && b.multihit && !/Triple|Population|Beat Up|Surging|Dragon Darts|Scale Shot|Water Shuriken/.test(m.f); }));
  const o = { weather: null, terrain: null, defSide: null, crit: false };
  const c = { id: i, kind, move: move.i, crit: false, weather: '', terrain: '', reflect: false, lightScreen: false };
  const setWeather = w => { c.weather = w; o.weather = { rain: 'Rain', sun: 'Sun', sand: 'Sand', hail: 'Hail' }[w]; };
  const setTerrain = t => { c.terrain = t; o.terrain = t[0].toUpperCase() + t.slice(1); };
  const randomStages = side => { for (const k of ['atk', 'def', 'spa', 'spd', 'spe']) if (chance(0.5)) side.boosts[k] = Math.floor(rnd() * 13) - 6; };
  if (kind === 'crit') { o.crit = true; }
  if (kind === 'burn') atk.status = 'brn';
  if (kind === 'stages') { randomStages(atk); randomStages(def); }
  if (kind === 'weather') setWeather(pick(['rain', 'sun', 'sand']));
  if (kind === 'hail') setWeather('hail');
  if (kind === 'terrain') setTerrain(pick(['electric', 'grassy', 'misty', 'psychic']));
  if (kind === 'screens') { if (chance(0.5)) { c.reflect = true; } else { c.lightScreen = true; } o.defSide = { isReflect: c.reflect, isLightScreen: c.lightScreen }; }
  if (kind === 'item') { const it = itemByName[pick(items)]; if (chance(0.6)) atk.it = it; else def.it = it; }
  if (kind === 'atkItem') atk.it = HELD[(i - ALL_ABILITIES.length * 2) >> 1];
  if (kind === 'defItem') def.it = HELD[(i - ALL_ABILITIES.length * 2) >> 1];
  if (kind === 'atkAbility') atk.ab = sweepA ? ALL_ABILITIES[i >> 1] : ABILITY_ROM(pick(DMG_ABILITIES));
  if (kind === 'defAbility') def.ab = sweepA ? ALL_ABILITIES[i >> 1] : ABILITY_ROM(pick(DMG_ABILITIES));
  if (kind === 'hp') {
    atk.ab = ABILITY_ROM(pick(['Blaze', 'Torrent', 'Overgrow', 'Swarm', 'Defeatist'])); def.ab = ABILITY_ROM(pick(['Multiscale', 'Pressure', 'Run Away']));
    atk.hpPct = pick([10, 25, 33, 34, 50, 51, 100]); def.hpPct = pick([50, 99, 100]);
  }
  if (kind === 'variable' || kind === 'combo') {
    if (chance(0.4)) def.status = pick(statuses);
    if (chance(0.3)) atk.status = pick(statuses);
    if (chance(0.4)) atk.hpPct = pick([1, 5, 10, 20, 34, 50, 70, 100]);
    if (chance(0.4)) def.hpPct = pick([10, 40, 49, 50, 51, 100]);
    if (chance(0.4)) randomStages(atk);
    if (chance(0.4)) randomStages(def);
    if (chance(0.4)) setWeather(pick(['rain', 'sun', 'sand', 'hail']));
    if (chance(0.3)) setTerrain(pick(['electric', 'grassy', 'misty', 'psychic']));
    if (chance(0.4)) atk.it = pick(HELD);
    if (chance(0.4)) def.it = pick(HELD);
  }
  if (kind === 'combo') {
    if (chance(0.5)) atk.ab = ABILITY_ROM(pick(DMG_ABILITIES));
    if (chance(0.5)) def.ab = ABILITY_ROM(pick(DMG_ABILITIES));
    if (chance(0.25)) o.crit = true;
    if (chance(0.25)) { c.reflect = chance(0.5); c.lightScreen = !c.reflect; o.defSide = { isReflect: c.reflect, isLightScreen: c.lightScreen }; }
  }
  if (E.ALWAYS_CRIT.has(move.f)) o.crit = true;
  if (move.f === 'Bolt Beak' || move.f === 'Fishious Rend') atk.movesFirst = true;   // the harness's target hasn't moved yet
  if (['Battle Armor', 'Shell Armor'].includes(String(def.ab).trim())) o.crit = false;   // the game wouldn't crit (the harness forces it)
  c.crit = o.crit;
  if (kind === 'multihit') o.hits = 1;                 // the harness makes one hit
  let r;
  try { r = E.rawRolls(atk, def, move.i, o); } catch (e) { r = null; c.engineError = String(e && e.message || e); }
  c.engine = r ? r.rolls : null;
  if (r && r.immune) c.immune = r.immune;            // blocked before the damage step (Volt Absorb, Soundproof, ...)
  atk._w = def._w = o.weather; atk._t = def._t = o.terrain;
  c.atk = gameSide(atk); c.def = gameSide(def);
  if (moldBreaks(atk, def, move)) c.def.ability = 0;      // the game's attack canceler switches it off for the move
  c.spec = { atk, def, o, move: move.f };
  cases.push(c);
}
fs.writeFileSync(outFile, JSON.stringify(cases));
console.log('cases', cases.length, 'moves', moves.length, 'species', species.length, 'items', items.length, 'abilities', DMG_ABILITIES.length);
