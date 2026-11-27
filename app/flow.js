/* A run as one path, in the order you play it.
 *
 * Chapters follow Hardcore's level caps: each ends with the fight that raises the cap (a badge, an admin, a
 * rival). Inside a chapter come the areas to catch in and the fights, in story order. The fights and their order
 * are the boss table's (the game's own progression); fights with the same trainer and cap next to each other are
 * versions of one fight (the rival's three, a leader's alternate teams), except generic Grunts and Goons, who are
 * separate trainers. Areas are placed by FireRed's map order, checked against where each boss fight starts in the
 * ROM's scripts (every area comes before the fights held there) and the wild levels; areas with only fishing or
 * surfing come up once you'd have a rod (Radical Red hands out the Old Rod in Viridian City) or Surf. Nothing here
 * locks you in: an area can be logged from any step, and fights can be taken in another order.
 *
 * Pure functions over the game data and a run's state, so the page and the tests share them. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.createFlow = factory;
})(typeof self !== 'undefined' ? self : this, function createFlow(D, mode) {
  'use strict';
  const ROD = 'rod', SURF = 'surf';
  // [area, the fight it comes before (trainer, level cap, which of that name at that cap), what you need there]
  const PLACES = [
    ['Route 1', 'Terry', 16], ['Viridian City', 'Terry', 16], ['Pallet Town', 'Terry', 16, 0, ROD], ['Route 21', 'Terry', 16], ['Route 22', 'Terry', 16],
    ['Route 2', 'Terry', 16], ['Viridian Forest', 'Terry', 16],          // open before the rival on Route 22
    ["Diglett's Cave", 'Falkner', 16], ['Pewter City', 'Falkner', 16],   // its Route 2 end (Lv 7) is open before Falkner
    ['Route 3', 'Sally', 23], ['Route 4', 'Miguel', 23], ['Mt. Moon', 'Miguel', 23],   // Route 4's west end is open before Mt. Moon
    ['Cerulean City', 'Terry', 28, 0, ROD],
    ['Route 24', 'Bugsy', 28], ['Route 25', 'Bugsy', 28],   // Route 24's grass is north of Nugget Bridge: after its trainers
    ['Route 5', 'Jeff', 36], ['Underground Path', 'Jeff', 36], ['Route 6', 'Jeff', 36],
    ['Vermilion City', 'Ann', 36, 0, ROD], ['S.S. Anne', 'Ann', 36, 0, ROD],
    ['Route 11', 'Whitney', 36],
    ['Route 9', 'Alicia', 44], ['Route 10', 'Dana', 44], ['Rock Tunnel', 'Dana', 44],
    ['Lavender Town', 'Aidan', 44], ['Route 8', 'Aidan', 44],
    ['Route 7', 'Mary', 44], ['Celadon City', 'Mary', 44, 0, ROD], ['Route 16', 'Mary', 44],
    ['Rocket Hideout', 'Grunt', 47, 1],
    ['Pokémon Tower', 'Ruth', 56],
    ['Route 12', 'Luca', 56], ['Route 17', 'William', 56], ['Route 18', 'William', 56], ['Route 13', 'Sebastian', 56],
    ['Route 14', 'Terry', 56], ['Route 15', 'Terry', 56], ['Fuchsia City', 'Terry', 56, 0, ROD], ['Route 19', 'Terry', 56, 0, ROD], ['Safari Zone', 'Terry', 56],
    ['Saffron City', 'Terry', 56], ['Silph Co.', 'Terry', 56],
    ['Power Plant', 'Kid', 68, 0, SURF],
    ['Route 20', 'Pryce', 73, 0, SURF], ['Seafoam Islands', 'Pryce', 73, 0, SURF],
    ['Cinnabar Island', 'May', 73, 0, SURF], ['Pokémon Mansion', 'Ted', 76, 0, SURF],
    ['Cerulean Cave', 'Grunt', 79],
    ['Route 23', 'Brendan', 82], ['Victory Road', 'Naomi', 85], ['Indigo Plateau', 'Lorelei', 85],
  ];
  // the Sevii Islands and everything else not listed: after the Champion (their wild Pokémon are at the last cap)
  const LONE = /^(Grunt|Goon)$/;
  const RIVAL_POS = { Squirtle: 0, Bulbasaur: 1, Charmander: 2 };   // order of the rival's three teams in each fight
  const CAPS = D.caps[mode === 'normal' ? 'normal' : 'hardcore'];   // the level caps of the difficulty played

  // ---- fights: the boss table in order, versions of one fight grouped ----
  const groups = [];
  for (const b of D.bosses) {
    if (b.route) continue;
    const g = groups[groups.length - 1];
    const last = g ? D.bosses[g.members[g.members.length - 1]] : null;
    if (g && !LONE.test(b.n) && last.n === b.n && last.cls === b.cls && last.cap === b.cap && last.i === b.i - 1) g.members.push(b.i);
    else groups.push({ first: b.i, members: [b.i] });
  }
  const groupOf = new Map();
  for (const g of groups) {
    for (const i of g.members) groupOf.set(i, g);
    g.ms = g.members.some(i => D.bosses[i].ms);
  }
  const champ = groups.find(g => D.bosses[g.first].cls === 'Champion');
  // A fight the story order puts before you can reach it (Radical Red's Cycling Road gate wants Erika's and Sabrina's
  // badges, so Route 16-18's trainers come after Sabrina) moves to right after the fight that opens it (the world data:
  // tools/world_logic.py). Fights are never moved earlier: those that open early are offered as they come up.
  const WORLD0 = (D.world || {})[mode === 'normal' ? 'normal' : 'hardcore'] || null;
  if (WORLD0 && WORLD0.seen) {
    const gOfT = new Map();
    for (const g of groups) for (const i of g.members) gOfT.set(D.bosses[i].id, g);
    const pos = new Map(groups.map((g, k) => [g, k]));
    const champAt = champ ? pos.get(champ) : groups.length;
    // the gate of a fight: the last milestone (badge or story fight) the world solver had won when it could first reach
    // it (the solver takes optional fights as soon as it can, so the fight just before isn't the gate; the milestone is)
    const takenAt = new Map((WORLD0.taken || []).map((t, k) => [t, k]));
    const gateOf = t => {
      const s = WORLD0.seen[t];
      if (s == null) return undefined;           // not worked out (after the Champion)
      if (s === 'start') return null;
      for (let k = takenAt.has(s) ? takenAt.get(s) : -1; k >= 0; k--) { const g = gOfT.get(WORLD0.taken[k]); if (g && g.ms) return g; }
      return null;
    };
    const opener = g => {
      let best = null;
      for (const i of g.members) {
        const o = gateOf(D.bosses[i].id);
        if (o === undefined) return null;
        if (o === null) return null;              // reachable before any milestone
        if (best == null || pos.get(o) < pos.get(best)) best = o;   // any version of the fight will do
      }
      return best;
    };
    const order = [], later = new Map();
    const place = g => { order.push(g); const d = later.get(g); if (d) { later.delete(g); d.forEach(place); } };
    for (const g of groups) {
      const o = opener(g);
      if (o && pos.get(o) > pos.get(g) && pos.get(o) < champAt && !g.ms) { if (!later.has(o)) later.set(o, []); later.get(o).push(g); g.after = o.first; continue; }
      place(g);
    }
    for (const d of later.values()) d.forEach(place);
    groups.length = 0; groups.push(...order);
  }
  function variantsOf(i) { const g = groupOf.get(i); return g ? g.members.slice() : [i]; }

  // ---- areas ----
  const areaByName = new Map(D.areas.map(a => [a.n, a]));
  const hasRows = t => Object.values(t).some(rows => rows && rows.length);
  /** Areas with wild Pokemon: the ones the first-encounter rule applies to. */
  function isWild(n) { const a = areaByName.get(n); return !!a && !a.fo && a.parts.some(p => Object.values(p.k).some(hasRows)); }
  function waterOnly(n) {
    const a = areaByName.get(n);
    return isWild(n) && a.parts.every(p => Object.entries(p.k).every(([k, t]) => k === 'water' || k === 'fish' || !hasRows(t)));
  }
  function anchor(name, cap, nth) {
    // PLACES name a fight by its Hardcore cap: the milestones before it say which, in either difficulty
    const hits = D.bosses.filter(b => !b.route && b.n === name && (b.mi != null ? D.caps.hardcore[b.mi] : b.cap) === cap);
    const b = hits[nth || 0];
    if (!b) throw new Error(`flow: no fight "${name}" at cap ${cap}`);
    return groupOf.get(b.i).first;
  }
  const place = new Map();   // area -> { before: first boss of the fight it precedes, need }
  for (const [n, name, cap, nth, need] of PLACES) if (areaByName.has(n)) place.set(n, { before: anchor(name, cap, nth), need: need || null });
  const postAreas = D.areas.map(a => a.n).filter(n => !place.has(n));
  /** What getting an encounter there takes, beyond walking in. */
  const rodAt = ((D.rods || {})['Old Rod'] || [])[0];
  function needOf(n) {
    if (waterOnly(n)) return rodAt ? `Only fishing or surfing here (Old Rod: ${rodAt})` : 'Only fishing or surfing here';
    const p = place.get(n);
    return p && p.need === SURF ? 'Needs Surf to reach' : '';
  }

  // ---- the path ----
  const steps = [{ id: 'start', kind: 'start', ch: 0 }, { id: 'starter', kind: 'starter', ch: 0 }];
  let ch = 0;
  for (const g of groups) {
    if (champ && g.first > champ.first && !steps.some(s => s.kind === 'champion')) {
      steps.push({ id: 'champion', kind: 'champion', ch });
      ch++;
      if (postAreas.length) steps.push({ id: 'areas@post', kind: 'areas', areas: postAreas, ch, post: true });
    }
    const here = PLACES.map(p => p[0]).filter(n => place.has(n) && place.get(n).before === g.first);
    if (here.length) steps.push({ id: 'areas@' + g.first, kind: 'areas', areas: here, ch });
    steps.push({ id: 'fight@' + g.first, kind: 'fight', g, ch, post: !!(champ && g.first > champ.first) });
    if (g.ms) ch++;
  }
  if (!steps.some(s => s.kind === 'champion')) steps.push({ id: 'champion', kind: 'champion', ch });
  steps.forEach((s, k) => { s.k = k; if (s.post == null) s.post = false; });

  const chapters = [];
  for (const s of steps) {
    let c = chapters[s.ch];
    if (!c) {
      c = chapters[s.ch] = { k: s.ch, cap: CAPS[Math.min(s.ch, CAPS.length - 1)], steps: [], post: false, end: null };
    }
    c.steps.push(s.k);
    if (s.post) c.post = true;
    if (s.kind === 'fight' && s.g.ms) c.end = s.g;
  }
  for (const c of chapters) if (c.post) c.cap = CAPS[Math.min(chapters.filter(x => !x.post).length - 1, CAPS.length - 1)];
  function chapterTitle(c) {
    if (c.post) return 'After the Champion';
    if (!c.end) return 'Victory Road, the Elite Four and the Champion';
    const b = D.bosses[c.end.first];
    return /Badge/.test(b.ms) ? `${b.n} · ${b.ms}` : b.ms;
  }

  /** Which of a fight's teams you'll face: your pick, else the rival's from your starter, else the first. */
  function chosenFight(g, run, rivalLine) {
    const pick = run && run.variants ? run.variants[g.first] : null;
    if (pick != null && g.members.includes(pick)) return pick;
    if (g.members.length === 3 && D.bosses[g.first].cat === 'rival' && RIVAL_POS[rivalLine] != null) return g.members[RIVAL_POS[rivalLine]];
    return g.first;
  }

  /** Where a run stands: each step's state and the step to do now.
   *  run: { started, starter, beaten, skipped, passed, enc, postgame }; opts.starterKnown: a starter is on the team. */
  function progress(run, opts) {
    opts = opts || {};
    const beaten = new Set(run.beaten || []), skipped = new Set(run.skipped || []), passed = new Set(run.passed || []);
    const enc = run.enc || {};
    const out = steps.map(s => {
      const st = { step: s, done: false, won: false, skipped: false, passed: false, open: [] };
      if (s.kind === 'start') st.done = !!run.started || passed.has('start');
      else if (s.kind === 'starter') st.done = !!run.starter || !!opts.starterKnown || passed.has('starter');
      else if (s.kind === 'fight') {
        st.won = s.g.members.some(i => beaten.has(i));
        st.skipped = !st.won && skipped.has(s.g.first);
        st.done = st.won || st.skipped;
      } else if (s.kind === 'areas') {
        st.open = s.areas.filter(n => isWild(n) && !enc[n]);
        st.done = !st.open.length || passed.has(s.id);
      } else if (s.kind === 'champion') st.done = !!run.postgame;
      return st;
    });
    // anything before the last fight you've finished is behind you
    let last = -1;
    out.forEach((st, k) => { if (st.step.kind === 'fight' && st.done) last = k; });
    out.forEach((st, k) => { if (k < last && !st.done) st.passed = true; });
    let current = out.findIndex(st => !st.done && !st.passed);
    if (current < 0) current = out.length;
    // the post-game only opens once you choose to keep going after the Champion
    const ci = out.findIndex(st => st.step.kind === 'champion');
    if (current < out.length && out[current].step.post && !run.postgame) current = ci;
    return { steps: out, current, last };
  }

  /** Areas from earlier steps that still have no encounter logged (some need a rod or Surf you didn't have yet). */
  function stillOpen(run, uptoStep) {
    const enc = run.enc || {};
    const out = [];
    for (const s of steps) {
      if (s.k >= uptoStep) break;
      if (s.kind === 'areas') for (const n of s.areas) if (isWild(n) && !enc[n] && !out.includes(n)) out.push(n);
    }
    return out;
  }

  // ---- what's open when, from the ROM's maps (tools/world_logic.py): earlier than the story order puts it ----
  const WORLD = (D.world || {})[mode === 'normal' ? 'normal' : 'hardcore'] || null;
  const stepOfTrainer = new Map();
  for (const s of steps) if (s.kind === 'fight') for (const i of s.g.members) stepOfTrainer.set(D.bosses[i].id, s.k);
  const groupOfTrainer = new Map();
  for (const g of groups) for (const i of g.members) groupOfTrainer.set(D.bosses[i].id, g);
  /** The step after which something opens (-1: from the start), or null when the world data doesn't say. */
  const stepAfter = t => (t === 'start' ? -1 : stepOfTrainer.has(t) ? stepOfTrainer.get(t) : null);
  /** The fight (trainer id) after which you can first meet wild Pokemon in an area, or null. */
  function areaOpensAfter(n) { return WORLD && WORLD.areas[n] != null ? WORLD.areas[n] : null; }
  /** Where you stand in the world: the fights you've won (and whether each is behind you). */
  function wonTrainers(run) {
    const won = new Set();
    for (const i of run.beaten || []) won.add(D.bosses[i] ? D.bosses[i].id : i);
    return won;
  }
  /** Areas the story order puts later that you can already reach with an encounter, or reach once you win an optional
   *  fight you can reach now (the Dig Grunt in Cerulean, once Bill is helped, opens Route 5 and Vermilion before Misty).
   *  [{ area, via: null | trainer id of the fight that opens it }] */
  function openEarly(run, uptoStep) {
    if (!WORLD) return [];
    const enc = run.enc || {};
    const won = wonTrainers(run);
    const reachable = t => t === 'start' || won.has(t) || (stepAfter(t) != null && stepAfter(t) < uptoStep);
    const out = [];
    for (const s of steps) {
      if (s.kind !== 'areas' || s.k <= uptoStep || (s.post && !run.postgame)) continue;
      for (const n of s.areas) {
        if (!isWild(n) || enc[n] || out.some(x => x.area === n)) continue;
        const t = areaOpensAfter(n);
        if (t == null) continue;
        if (reachable(t)) { out.push({ area: n, via: null }); continue; }
        // a fight you can reach now (it was reached before it was won) that opens it
        const seen = WORLD.seen && WORLD.seen[t];
        const g = groupOfTrainer.get(t);
        if (seen != null && reachable(seen) && g && !D.bosses[g.first].ms) out.push({ area: n, via: t });
      }
    }
    return out;
  }
  /** When a map can first be reached: { after: trainer id or 'start', step } or null. */
  function mapOpens(key) {
    if (!WORLD || WORLD.maps[key] == null) return null;
    const t = WORLD.maps[key];
    return { after: t, step: stepAfter(t) };
  }
  /** Side quests, services and trials, each with the step after which its map opens (null: no world data). */
  function sideList() {
    const side = D.side || { extras: [], rematches: [], trials: [] };
    const when = keys => { const s = keys.map(k => mapOpens(k)).filter(Boolean).sort((a, b) => a.step - b.step)[0]; return s || null; };
    return {
      extras: side.extras.map(e => Object.assign({}, e, { open: when(e.m) })),
      rematches: side.rematches.map(r => Object.assign({}, r, { open: when([r.m]) })),
      trials: side.trials.map(t => Object.assign({}, t, { open: when([t.m]) })),
    };
  }

  return { steps, chapters, groups, champ, PLACES, postAreas, variantsOf, groupOf: i => groupOf.get(i) || null, isWild, waterOnly, needOf, placeOf: n => place.get(n) || null,
    chapterTitle, chosenFight, progress, stillOpen, RIVAL_POS, WORLD, openEarly, areaOpensAfter, mapOpens, sideList, stepAfter };
});
