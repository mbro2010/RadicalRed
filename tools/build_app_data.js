// Build the single data file the Nuzlocke Coach app loads (app/rrdata.json)
// from the extracted ROM data.
//
// usage: node tools/build_app_data.js data app/rrdata.json
const fs = require('fs');
const path = require('path');

const D = process.argv[2] || 'data';
const OUT = process.argv[3] || 'app/rrdata.json';
const read = f => JSON.parse(fs.readFileSync(path.join(D, f), 'utf8'));

const species = read('species.json');
const moves = read('moves.json');
const abilityNames = read('abilities.json');
const abilityText = read('ability_descriptions.json');
const items = read('items.json');
const natures = read('natures.json');
const learn = read('learnsets.json');
const tms = read('tms.json');
const calc = read('calc_names.json');
const trainers = Object.fromEntries(read('trainers.json').map(t => [t.id, t]));
const order = read('hardcore_order.json');
const caps = read('level_caps.json');
const restrictions = read('restrictions.json');

const STAT = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

// ---------- species ----------
const firstIdByName = {};
for (const s of species) if (s.name && !(s.name in firstIdByName)) firstIdByName[s.name] = s.id;
const outSpecies = [];
for (const s of species) {
  const m = calc.species[s.id];
  if (!m || !s.name || s.name === '?' || s.name === 'Bad Egg') continue;
  if (/^UNOWN./.test(s.name)) continue;
  const alt = firstIdByName[s.name] !== s.id;
  let display = s.name;
  if (m.calc && m.calc.includes('-') && m.exact) display = m.calc;            // e.g. Raichu-Alola, Charizard-Mega-X
  else if (alt) display = `${s.name} (${s.types.join('/')})`;                  // Radical Red's own forms
  else if (!m.custom && m.calc && m.calc.toLowerCase().replace(/[^a-z0-9]/g, '') !== s.name.toLowerCase().replace(/[^a-z0-9]/g, '')
           && !m.calc.includes('-')) display = m.calc;                           // full name for shortened ones
  const battleOnly = /-(Mega|Gmax|Primal|Eternamax|Ultra)/.test(m.calc || '') || /-Mega/.test(display);
  outSpecies.push({
    i: s.id, n: display, g: s.name, c: m.calc, t: s.types,
    s: STAT.map(k => s.base[k]),
    a: [s.abilities[0], s.abilities[1], s.hiddenAbility].map(x => x ? x.trim() : null),
    w: m.weightkg || 10,
    ...(battleOnly ? { bo: 1 } : {}),
    ...(m.custom ? { x: 1 } : {}),
  });
}

// ---------- moves ----------
const outMoves = [];
for (const m of moves) {
  const c = calc.moves[m.id];
  if (!c) continue;
  outMoves.push({
    i: m.id, n: m.name, f: c.calc || m.name, c: c.calc, t: m.type, p: m.power, a: m.accuracy,
    k: { physical: 'P', special: 'S', status: 'X' }[m.category], r: m.priority, z: m.zPower, e: m.effect, ec: m.effectChance, tg: m.target,
    ...(c.custom ? { x: 1 } : {}),
  });
}
const moveIdByName = {};
for (const m of moves) if (m.name && !(m.name in moveIdByName)) moveIdByName[m.name] = m.id;

// ---------- abilities ----------
const outAbilities = {};
abilityNames.forEach((raw, i) => {
  if (!i || i > 255 || !raw) return;
  const name = raw.trim();
  const key = name === 'As One' ? `As One#${i}` : name;
  const c = key in calc.abilities ? calc.abilities[key] : undefined;
  if (outAbilities[name] && name !== 'As One') return;
  outAbilities[name] = { c: c === undefined ? null : c, d: abilityText[name] || '', ...(c === null ? { x: 1 } : {}) };
});
outAbilities['As One'] = { c: 'As One (Glastrier)', d: abilityText['As One'] || '' };

// ---------- items ----------
const outItems = {};
for (const [id, name] of Object.entries(items)) {
  if (!name || /^Free Space|^\?+$/.test(name)) continue;
  outItems[id] = { n: name, c: calc.items[id] || null };
}

// ---------- learnsets ----------
const tmMoves = tms.map(t => t.move);
const outLearn = {};
for (const s of outSpecies) {
  const L = learn[s.i];
  if (!L) continue;
  outLearn[s.i] = { l: L.levelup.filter(([, mv]) => mv > 0), t: L.tm };
}

// ---------- bosses ----------
const MILESTONE_AFTER = {414: 'Boulder Badge', 46: 'Archer', 415: 'Cascade Badge', 416: 'Thunder Badge', 417: 'Rainbow Badge',
  348: 'Giovanni, Rocket Hideout', 53: 'Archer', 349: 'Giovanni, Silph Co.', 420: 'Marsh Badge', 418: 'Soul Badge', 61: 'May',
  419: 'Volcano Badge', 68: 'Ariana', 69: 'Giovanni', 74: 'Earth Badge', 26: 'Brendan'};
function category(t) {
  if (t.class === 'Leader') return 'gym';
  if (t.class === 'Rival' || t.class === 'Champion' || t.name === 'Terry') return 'rival';
  if (t.class === 'Elite Four') return 'e4';
  if (['Boss', 'Rocket Admin', 'Team Rocket'].includes(t.class)) return 'rocket';
  return 'other';
}
const HC = caps.hardcore;
let done = 0;
const bosses = order.map((tid, i) => {
  const t = trainers[tid];
  const ov = t.hardcoreOverride.find(p => p.order === i);
  const b = {
    i, id: tid, n: t.name, cls: t.class, cat: category(t), dbl: ov.double ? 1 : 0, cap: HC[done],
    party: ov.party.map(m => ({
      s: m.speciesId, lv: m.level ?? null, rel: m.relativeToPlayerMax ?? null,
      iv: [m.ivs.hp, m.ivs.atk, m.ivs.def, m.ivs.spa, m.ivs.spd, m.ivs.spe],
      nat: m.natureId, ab: m.ability, it: m.itemId || null, mv: m.moveIds,
      ...(m.raw.b27 ? { st: m.raw.b27 } : {}),
    })),
  };
  if (MILESTONE_AFTER[tid]) { b.ms = MILESTONE_AFTER[tid]; b.capAfter = HC[done + 1]; done++; }
  return b;
});
for (const b of bosses) if (b.cat === 'rival') {
  const last = b.party[b.party.length - 1];
  b.v = (outSpecies.find(s => s.i === last.s) || {}).n;
}

const out = {
  version: 'Radical Red 4.1', calcVersion: '@smogon/calc 0.12.0 (gen 9 mechanics)',
  natures: natures.map(n => ({ n: n.name, u: n.up, d: n.down })),
  species: outSpecies, moves: outMoves, abilities: outAbilities, items: outItems,
  learn: outLearn, tms: tmMoves,
  bans: {
    moves: restrictions.bannedMoves.map(n => moveIdByName[n]).filter(Boolean),
    cond: restrictions.conditionalMoves.map(n => moveIdByName[n]).filter(Boolean),
    condSpecies: restrictions.conditionalAllowedSpecies,
  },
  bosses, caps: { hardcore: HC, normal: caps.normal },
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`species ${outSpecies.length}, moves ${outMoves.length}, abilities ${Object.keys(outAbilities).length}, items ${Object.keys(outItems).length}, bosses ${bosses.length}, milestones ${done}, ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);
