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
    w: m.weightkg || 10, gr: s.growthRate || 0, gd: s.genderRatio,
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
const itemIdByName = {};
for (const [id, name] of Object.entries(items)) if (name && !(name in itemIdByName)) itemIdByName[name] = +id;
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
// move tutors: learn[species].u = tutor move ids
const tutors = read('tutors.json');
for (const [sid, idx] of Object.entries(tutors.species)) if (outLearn[sid]) outLearn[sid].u = idx.map(k => tutors.moves[k].id).filter(Boolean);

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
// where each fight is: the map its trainer stands on, else the map whose scripts start it (rivals, admins, leaders)
const standing = read('trainer_locations.json');
const scripted = fs.existsSync(path.join(D, 'fight_places.json')) ? read('fight_places.json') : { fights: {}, given: {} };
const bossLoc = Object.assign({}, scripted.fights, standing);
let done = 0;
const bosses = order.map((tid, i) => {
  const t = trainers[tid];
  const ov = t.hardcoreOverride.find(p => p.order === i);
  const b = {
    i, id: tid, n: t.name, cls: t.class, cat: category(t), dbl: ov.double ? 1 : 0, cap: HC[done], ...(bossLoc[tid] ? { loc: bossLoc[tid] } : {}),
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

// ---------- evolutions and Mega Evolution ----------
const evolutions = read('evolutions.json');
const outEvo = {}, outMega = {};
for (const [sid, list] of Object.entries(evolutions)) {
  for (const e of list) {
    if (e.method === 0xFE) { (outMega[sid] = outMega[sid] || []).push([e.unknown === 0 ? e.param : 0, e.target, e.unknown === 0 ? 0 : e.param]); continue; }
    if (e.method === 0xFD) continue;   // Gigantamax: not in this game's battles
    (outEvo[sid] = outEvo[sid] || []).push([e.target, e.method, e.param, e.how]);
  }
}

// ---------- wild encounters by area, in story order ----------
const STORY = ['Pallet Town', 'Route 1', 'Viridian City', 'Route 22', 'Route 2', 'Viridian Forest', 'Pewter City', 'Route 3', 'Mt. Moon',
  'Route 4', 'Cerulean City', 'Route 24', 'Route 25', 'Route 5', 'Route 6', 'Vermilion City', 'S.S. Anne', 'Route 11', "Diglett's Cave",
  'Route 9', 'Route 10', 'Rock Tunnel', 'Power Plant', 'Lavender Town', 'Route 8', 'Route 7', 'Celadon City', 'Pokémon Tower',
  'Route 12', 'Route 13', 'Route 14', 'Route 15', 'Route 16', 'Route 17', 'Route 18', 'Fuchsia City', 'Safari Zone', 'Saffron City',
  'Route 19', 'Route 20', 'Seafoam Islands', 'Cinnabar Island', 'Pokémon Mansion', 'Route 21', 'One Island', 'Treasure Beach',
  'Kindle Road', 'Mt. Ember', 'Cape Brink', 'Two Island', 'Three Island', 'Bond Bridge', 'Berry Forest', 'Route 23', 'Victory Road',
  'Four Island', 'Icefall Cave', 'Five Island', 'Five Isle Meadow', 'Memorial Pillar', 'Water Labyrinth', 'Resort Gorgeous', 'Lost Cave',
  'Six Island', 'Water Path', 'Ruin Valley', 'Green Path', 'Outcast Island', 'Altering Cave', 'Pattern Bush', 'Seven Island',
  'Canyon Entrance', 'Sevault Canyon', 'Tanoby Ruins', 'Cerulean Cave'];
const encounters = read('encounters.json');
function merge(info, kind) {
  // one row per species (and rod), chances added up, level range widened
  const rows = new Map();
  for (const x of info.slots) {
    if (!x.s) continue;
    const key = x.s + (x.rod ? '|' + x.rod : '');
    const r = rows.get(key);
    if (r) { r[1] = Math.min(r[1], x.min); r[2] = Math.max(r[2], x.max); r[3] += x.pct; }
    else rows.set(key, kind === 'fish' ? [x.s, x.min, x.max, x.pct, x.rod] : [x.s, x.min, x.max, x.pct]);
  }
  return [...rows.values()].sort((a, b) => (a[4] || '').localeCompare(b[4] || '') || b[3] - a[3]);
}
const outAreas = [];
for (const [name, maps] of Object.entries(encounters)) {
  if (name === "Oak's Lab") continue;   // a renamed Tanoby chamber slot (Unown only), not a place you can reach
  const parts = maps.map(m => {
    const k = {};
    for (const [kind, t] of Object.entries(m.methods)) {
      k[kind] = {};
      for (const [when, info] of Object.entries(t)) if (info) k[kind][when] = merge(info, kind);
    }
    return { g: m.group, m: m.num, k };
  });
  let minLv = 100;
  for (const p of parts) for (const t of Object.values(p.k)) for (const rows of Object.values(t)) for (const r of rows) minLv = Math.min(minLv, r[1]);
  outAreas.push({ n: name, parts, minLv });
}
// areas with gifts or items but no wild Pokemon (Silph Co., department stores, gyms) are listed too
const findsAreas = fs.existsSync(path.join(D, 'finds.json')) ? Object.keys(read('finds.json').areas) : [];
for (const n of findsAreas) if (!outAreas.some(a => a.n === n)) outAreas.push({ n, parts: [], minLv: 100, fo: 1 });
outAreas.sort((a, b) => {
  const ia = STORY.indexOf(a.n), ib = STORY.indexOf(b.n);
  if (ia >= 0 && ib >= 0) return ia - ib;
  if (ia >= 0) return -1;
  if (ib >= 0) return 1;
  return a.minLv - b.minLv || a.n.localeCompare(b.n);
});

// ---------- regular trainers on each area ----------
const locations = read('trainer_locations.json');
const bossIds = new Set(order);
function defaultMoves(sid, lv) {
  const L = outLearn[sid];
  if (!L) return [];
  const known = [];
  for (const [l, mv] of L.l) if (l <= lv && !known.includes(mv)) { known.push(mv); if (known.length > 4) known.shift(); }
  return known;
}
const outTrainers = {};
for (const [tid, places] of Object.entries(locations)) {
  const t = trainers[tid];
  if (!t || bossIds.has(+tid)) continue;
  const ov = (t.alwaysOverride || [])[0];
  const party = ov ? ov.party.map(m => ({ s: m.speciesId, lv: m.level ?? null, rel: m.relativeToPlayerMax ?? null, nat: m.natureId, ab: m.ability, it: m.itemId || null, mv: m.moveIds,
      iv: [m.ivs.hp, m.ivs.atk, m.ivs.def, m.ivs.spa, m.ivs.spd, m.ivs.spe] }))
    : t.party.map(m => {
      const sp = m.spread || {};
      return { s: m.speciesId, lv: m.level, nat: sp.natureId ?? null, ab: m.ability || null, it: m.itemId || (m.item && itemIdByName[m.item]) || null,
        mv: m.moveIds && m.moveIds.length ? m.moveIds : defaultMoves(m.speciesId, m.level),
        iv: m.ivs ? [m.ivs.hp, m.ivs.atk, m.ivs.def, m.ivs.spa, m.ivs.spd, m.ivs.spe] : null,
        ev: sp.evs ? [sp.evs.hp, sp.evs.atk, sp.evs.def, sp.evs.spa, sp.evs.spd, sp.evs.spe] : null };
    });
  outTrainers[tid] = { n: t.name, cls: t.class, dbl: (ov ? ov.double : t.double) ? 1 : 0, a: places, party };
}

// ---------- gifts, static encounters, items, shops, and where each TM is ----------
const finds = fs.existsSync(path.join(D, 'finds.json')) ? read('finds.json') : { areas: {}, mart: [] };
const tmIndexOfItem = {};
for (const [id, name] of Object.entries(items)) {
  const m = /^(TM|HM)(\d+)$/.exec(name || '');
  if (m) tmIndexOfItem[id] = m[1] === 'TM' ? +m[2] - 1 : 119 + +m[2];
}
const outFinds = {}, tmWhere = {};
const addTM = (id, area, how) => { const t = tmIndexOfItem[id]; if (t == null) return; const list = tmWhere[t] = tmWhere[t] || []; if (!list.some(x => x[0] === area)) list.push([area, how]); };
for (const [area, a] of Object.entries(finds.areas)) {
  outFinds[area] = {
    i: a.items.map(([id, qty, how]) => [id, qty, how[0]]),
    g: a.gifts.filter(g => outSpecies.some(x => x.i === g.s)).map(g => [g.kind[0], g.s, g.lv || null]),
    sh: a.shops,
  };
  for (const [id, , how] of a.items) addTM(id, area, how === 'hidden' ? 'hidden' : how === 'given' ? 'gift' : 'found');
  for (const shop of a.shops) for (const id of shop) addTM(id, area, 'shop');
}
for (const id of finds.mart) addTM(id, 'Poké Marts', 'shop');
// where each held item can be found or bought (first few places)
const itemWhere = {};
const addItem = (id, area, how) => { if (tmIndexOfItem[id] != null || !outItems[id] || !outItems[id].c) return; const l = itemWhere[id] = itemWhere[id] || []; if (l.length < 4 && !l.some(x => x[0] === area)) l.push([area, how]); };
for (const [area, a] of Object.entries(finds.areas)) {
  for (const [id, , how] of a.items) addItem(id, area, how === 'hidden' ? 'hidden' : how === 'given' ? 'gift' : 'found');
  for (const shop of a.shops) for (const id of shop) addItem(id, area, 'shop');
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
  // where scripts hand over the fishing rods (Radical Red moves them earlier than FireRed)
  rods: Object.fromEntries(['Old Rod', 'Good Rod', 'Super Rod'].map(n => [n, scripted.given[Object.keys(items).find(k => items[k] === n)] || []])),
  evo: outEvo, mega: outMega, areas: outAreas, trainers: outTrainers, finds: outFinds, mart: finds.mart, tmWhere, itemWhere,
  // the care package cheat (code SO2Toxic): what each checkpoint hands over in Hardcore Mode, and where or after which badge
  care: fs.existsSync(path.join(D, 'care_package.json')) ? read('care_package.json').packages.map(p => Object.assign(
    { area: p.area, items: p.items.filter(([id]) => items[id]) }, p.after ? { after: p.after } : {})) : [],
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`areas ${outAreas.length}, route trainers ${Object.keys(outTrainers).length}, species with evolutions ${Object.keys(outEvo).length}, Mega forms ${Object.keys(outMega).length}`);
console.log(`species ${outSpecies.length}, moves ${outMoves.length}, abilities ${Object.keys(outAbilities).length}, items ${Object.keys(outItems).length}, bosses ${bosses.length}, milestones ${done}, ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);
