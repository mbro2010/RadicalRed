// Match Radical Red's in-game names (shortened to fit the GBA's fixed-width
// tables) to the damage calculator's full names, using types and stats to
// pick the right form. Writes data/calc_names.json and prints anything that
// needed a fallback, so it can be reviewed.
//
// usage: node tools/map_names.js data
const fs = require('fs');
const path = require('path');
const C = require('@smogon/calc');

const D = process.argv[2] || 'data';
const read = f => JSON.parse(fs.readFileSync(path.join(D, f), 'utf8'));
const gen = C.Generations.get(9);
const toID = C.toID;

// RR name is often a truncation or abbreviation of the real name: check that
// its letters appear in order inside the candidate's id.
function isSubseq(short, long) {
  let j = 0;
  for (let i = 0; i < long.length && j < short.length; i++) if (long[i] === short[j]) j++;
  return j === short.length;
}

// ---------- species ----------
const STAT = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
const rrSpecies = read('species.json');
const calcSpecies = [...gen.species];
const byBaseId = {};
for (const s of calcSpecies) {
  const base = toID(s.baseSpecies || s.name);
  (byBaseId[base] = byBaseId[base] || []).push(s);
}
function statDist(rr, cs) {
  return STAT.reduce((d, k) => d + Math.abs(rr.base[k] - cs.baseStats[k]), 0);
}
function sameTypes(rr, cs) {
  const a = [...rr.types].sort().join('/'), b = [...cs.types].sort().join('/');
  return a === b;
}
const SPECIES_MANUAL = { 'Gouge Fire': 'Gouging Fire' };
const speciesOut = {};
const speciesReport = [];
for (const rr of rrSpecies) {
  if (!rr.name || rr.id === 0) continue;
  if (rr.name === '?' || rr.name === 'Bad Egg') continue;
  const id = rr.name.startsWith('UNOWN') ? 'unown' : toID(SPECIES_MANUAL[rr.name] || rr.name);
  let pool = byBaseId[id] || [];
  if (!pool.length) {
    // truncated names: base species whose id starts with / contains the RR letters in order
    pool = Object.entries(byBaseId).filter(([k]) => k.startsWith(id) || (id.length >= 6 && isSubseq(id, k) && k[0] === id[0]))
      .flatMap(([, v]) => v);
  }
  if (!pool.length) {
    // A Pokemon Radical Red added: stats and types come from the ROM; Mew is a neutral stand-in with no species-specific effects.
    speciesOut[rr.id] = { calc: 'Mew', exact: false, custom: true, weightkg: 4 };
    speciesReport.push(`CUSTOM species ${rr.id} ${rr.name}`); continue;
  }
  let best = null, bestScore = Infinity;
  for (const cs of pool) {
    const score = statDist(rr, cs) + (sameTypes(rr, cs) ? 0 : 50) + (cs.name.includes('-Gmax') ? 5 : 0) + (cs.name.includes('-Totem') ? 5 : 0);
    if (score < bestScore) { bestScore = score; best = cs; }
  }
  if (bestScore > 0 && /-(Gmax|Totem)/.test(best.name)) {
    const baseForm = pool.find(cs => !cs.forme) || pool[0];
    best = baseForm;
  }
  speciesOut[rr.id] = { calc: best.name, exact: bestScore === 0, weightkg: best.weightkg };
  if (bestScore !== 0) speciesReport.push(`approx species ${rr.id} ${rr.name} [${rr.types}] -> ${best.name} [${best.types}] (diff ${bestScore})`);
}

// ---------- moves ----------
// Similarity: longest common subsequence relative to the shorter name, with a
// bonus when the first word is a prefix match ("Dazzle Gleam" ~ "Dazzling Gleam").
function lcs(a, b) {
  const dp = Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let prev = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev + 1 : Math.max(dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[b.length];
}
function similarity(rrName, calcName) {
  const a = toID(rrName), b = toID(calcName);
  const base = lcs(a, b) / Math.max(a.length, 1);
  const w1 = rrName.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)[0] || '';
  const c1 = calcName.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)[0] || '';
  const prefix = w1 && c1 && (c1.startsWith(w1.slice(0, 4)) || w1.startsWith(c1.slice(0, 4))) ? 0.15 : 0;
  return base + prefix - Math.max(0, b.length - a.length - 6) * 0.02;
}
// Reviewed by hand: names whose shortening the similarity score can't settle.
const MOVE_MANUAL = {
  'Disarm Cry': 'Disarming Voice', 'Flower Guard': 'Flower Shield', 'Petal Storm': 'Petal Blizzard',
  'Space Hole': 'Hyperspace Hole', 'Space Fury': 'Hyperspace Fury', 'Cliff Blades': 'Precipice Blades',
  'Steam Pump': 'Steam Eruption', 'Water Star': 'Water Shuriken', '1000 Arrows': 'Thousand Arrows',
  '1000 Waves': 'Thousand Waves', 'Draco Hammer': 'Dragon Hammer', 'Geist Beam': 'Moongeist Beam',
  'Sparkle Aria': 'Sparkling Aria', 'Spirit Lock': 'Spirit Shackle', 'Bad Tantrum': 'Stomping Tantrum',
  'Sunsteel Ram': 'Sunsteel Strike', 'Teary Look': 'Tearful Look', 'Crafty Guard': 'Crafty Shield',
  'Woods Curse': "Forest's Curse", 'Giant Blade': 'Behemoth Blade', 'Giant Bash': 'Behemoth Bash',
  'False Yield': 'False Surrender', 'Meteor Rush': 'Meteor Assault', 'MistyExplode': 'Misty Explosion',
  'Jealous Burn': 'Burning Jealousy', 'Corrode Gas': 'Corrosive Gas', 'SurgeStrikes': 'Surging Strikes',
  'Freeze Glare': 'Freezing Glare', 'Astral Bomb': 'Astral Barrage', 'InfernoMarch': 'Infernal Parade',
  'PsyshieldRam': 'Psyshield Bash', 'Revive Bless': 'Revival Blessing', 'Dazzle Gleam': 'Dazzling Gleam',
  'Super Slam': 'Supercell Slam', 'SmellingSalt': 'Smelling Salts', 'Para Charge': 'Parabolic Charge',
  "Nature's Mad": "Nature's Madness", 'Revel Dance': 'Revelation Dance', 'Allure Voice': 'Alluring Voice',
};
// Radical Red's own moves; damage uses their ROM type/power/category on a neutral stand-in.
const MOVE_CUSTOM = new Set(['Dark Hole', 'Leech Fang', 'Metal Bash']);
const LAST_REAL_MOVE = 828;  // 829+ are placeholders, Z-moves and Max moves
const rrMoves = read('moves.json');
const calcMoves = [...gen.moves].filter(m => m.name !== '(No Move)');
const moveById = Object.fromEntries(calcMoves.map(m => [toID(m.name), m]));
const CAT = { physical: 'Physical', special: 'Special', status: 'Status' };
const moveOut = {};
const moveReport = [];
for (const rr of rrMoves) {
  if (rr.id === 0 || rr.id > LAST_REAL_MOVE || !rr.name || rr.name === 'Placeholder') continue;
  let m = moveById[toID(rr.name)];
  let how = 'exact';
  if (MOVE_CUSTOM.has(rr.name)) m = null;
  else if (!m && MOVE_MANUAL[rr.name]) { m = moveById[toID(MOVE_MANUAL[rr.name])]; how = 'manual'; }
  if (!m && !MOVE_CUSTOM.has(rr.name)) {
    const scored = calcMoves.map(c => {
      let sc = similarity(rr.name, c.name);
      if (c.type !== rr.type) sc -= 0.5;
      if (CAT[rr.category] !== c.category) sc -= 0.5;
      if ((c.basePower || 0) !== rr.power) sc -= 0.05;
      return { c, sc };
    }).sort((a, b) => b.sc - a.sc);
    if (scored[0].sc >= 0.75) { m = scored[0].c; how = `fuzzy ${scored[0].sc.toFixed(2)}`; }
  }
  if (!m) {
    // A move Radical Red added: damage comes from its own type/power/category on a neutral stand-in.
    moveOut[rr.id] = { calc: null, custom: true };
    moveReport.push(`CUSTOM move ${rr.id} ${rr.name} (${rr.type} ${rr.category} ${rr.power})`);
    continue;
  }
  moveOut[rr.id] = { calc: m.name, how };
  if (how !== 'exact') moveReport.push(`${how} move ${rr.id} ${rr.name} -> ${m.name}`);
}

// ---------- abilities ----------
const rrAbilities = read('abilities.json');
const calcAbilities = [...gen.abilities];
const ABILITY_MANUAL = { 'Neutralize Gas': 'Neutralizing Gas' };
const ABILITY_CUSTOM = new Set(['Bad Company', 'Fatal Precision', 'Bull Rush', 'Feline Prowess', 'Wandering Soul', 'ORAORAORAORA!',
  'Parasitic Waste', 'Primal Armor', 'Phoenix Down', 'Bone Zone', 'Self Sufficient', 'Valiant Shield', 'Striker', 'Blazing Soul', 'Sage Power']);
const abilityOut = {};
const abilityReport = [];
rrAbilities.forEach((name, i) => {
  if (!i || !name || i > 255) return;   // ability fields are one byte: IDs above 255 are never used
  name = name.trim();
  if (ABILITY_CUSTOM.has(name)) { abilityOut[name] = null; return; }
  if (name === 'As One') { abilityOut[`As One#${i}`] = i === 73 ? 'As One (Glastrier)' : 'As One (Spectrier)'; return; }
  if (ABILITY_MANUAL[name]) { abilityOut[name] = ABILITY_MANUAL[name]; return; }
  const id = toID(name);
  let a = calcAbilities.find(x => toID(x.name) === id);
  if (!a) {
    const c = calcAbilities.filter(x => toID(x.name).startsWith(id) || (toID(x.name)[0] === id[0] && isSubseq(id, toID(x.name))));
    c.sort((p, q) => p.name.length - q.name.length);
    a = c[0];
    abilityReport.push(a ? `abbrev ability ${i} ${name} -> ${a.name}` : `NO MATCH ability ${i} ${name}`);
  }
  if (a) abilityOut[name] = a.name;
});

// ---------- items ----------
const rrItems = read('items.json');
const calcItems = [...gen.items];
const ITEM_NO_MATCH = new Set(['Iron', 'Repel', 'Honey', 'Tea', 'Ruby']);
const itemOut = {};
const itemReport = [];
for (const [idStr, name] of Object.entries(rrItems)) {
  if (!name || ITEM_NO_MATCH.has(name)) continue;
  const id = toID(name);
  let it = calcItems.find(x => toID(x.name) === id);
  if (!it) {
    const c = calcItems.filter(x => { const xid = toID(x.name); return xid.startsWith(id) || (xid[0] === id[0] && isSubseq(id, xid)); });
    c.sort((p, q) => (toID(p.name).startsWith(id) ? 0 : 1) - (toID(q.name).startsWith(id) ? 0 : 1) || p.name.length - q.name.length);
    it = c[0];
    if (it) itemReport.push(`abbrev item ${idStr} ${name} -> ${it.name}`);
  }
  if (it) itemOut[idStr] = it.name;
}

fs.writeFileSync(path.join(D, 'calc_names.json'), JSON.stringify({ species: speciesOut, moves: moveOut, abilities: abilityOut, items: itemOut }, null, 0));
const show = (title, arr) => { console.log(`\n== ${title}: ${arr.length}`); arr.forEach(l => console.log('  ' + l)); };
show('species needing review', speciesReport);
show('moves needing review', moveReport);
show('abilities needing review', abilityReport);
show('items needing review', itemReport);
console.log(`\nmapped species ${Object.keys(speciesOut).length}, moves ${Object.keys(moveOut).length}, abilities ${Object.keys(abilityOut).length}, items ${Object.keys(itemOut).length}`);
