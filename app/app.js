/* Nuzlocke Coach UI. Data: rrdata.json (from the ROM). Math: engine.js + @smogon/calc. */
(function () {
  'use strict';
  const TYPE_COLORS = { Normal: '#a8a77a', Fire: '#ee8130', Water: '#6390f0', Electric: '#f7d02c', Grass: '#7ac74c', Ice: '#96d9d6',
    Fighting: '#c22e28', Poison: '#a33ea1', Ground: '#e2bf65', Flying: '#a98ff3', Psychic: '#f95587', Bug: '#a6b91a', Rock: '#b6a136',
    Ghost: '#735797', Dragon: '#6f35fc', Dark: '#705746', Steel: '#b7b7ce', Fairy: '#d685ad', '???': '#68a090' };
  const STATS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
  const STAT_LABEL = { hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe' };
  const $ = (sel, root) => (root || document).querySelector(sel);
  const main = $('#main');
  const sheet = $('#sheet');

  let D = null, E = null, SIM = null, ADV = null, SR = null;
  let SPR = null;   // sprite index (sprites/index.json); without it the page simply shows no sprites
  const S = {
    roster: [], run: { beaten: [], tms: [], enc: {}, dupes: true, checks: [], no: 1, started: null, starter: null }, history: [], tab: 'team', routeFilter: 'todo', openArea: null, encTime: null, planBoss: null, example: false, plans: {}, planning: null,
    battle: { boss: null, them: 0, me: null, themHp: 100, meHp: 100, themBoost: {}, meBoost: {}, weather: 'auto', themStatus: '', meStatus: '' },
  };

  // ---------------- small helpers ----------------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function textOn(hex) { const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16); return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#1b1b1b' : '#ffffff'; }
  function typeChip(t) { const c = TYPE_COLORS[t] || '#888888'; return `<span class="type" style="background:${c};color:${textOn(c)}">${esc(t)}</span>`; }
  function typesHTML(ts) { return `<span class="types">${ts.map(typeChip).join('')}</span>`; }
  function sprEntry(sid) {
    if (!SPR) return null;
    let e = SPR.species[sid];
    if (!e) { const sp = E.sp(sid); const base = sp && D.species.find(x => x.g === sp.g && SPR.species[x.i]); e = base ? SPR.species[base.i] : null; }
    return e;
  }
  function icon(sid, cls) {
    const e = sprEntry(sid); if (!e || e.i == null) return '';
    const c = SPR.iconCols;
    return `<span class="ico ${cls || ''}" style="--x:${e.i % c};--y:${Math.floor(e.i / c)};--icols:${c}" aria-hidden="true"></span>`;
  }
  function front(sid, cls) {
    const e = sprEntry(sid); if (!e || e.f == null) return '';
    const c = SPR.frontCols;
    return `<span class="spr ${cls || ''}" style="--x:${e.f % c};--y:${Math.floor(e.f / c)};--fcols:${c}" aria-hidden="true"></span>`;
  }
  const tmName = t => (t < 120 ? `TM${String(t + 1).padStart(2, '0')}` : `HM${String(t - 119).padStart(2, '0')}`);
  const tmOfItem = id => { const m = /^(TM|HM)(\d+)$/.exec(E.itemName(id) || ''); return m ? (m[1] === 'TM' ? +m[2] - 1 : 119 + +m[2]) : null; };
  const HOW_LABEL = { found: 'found', hidden: 'hidden', gift: 'given', shop: 'sold' };
  function tmWhere(t, max) {
    const list = (D.tmWhere || {})[t] || [];
    if (!list.length) return '';
    const shown = list.slice(0, max || 3).map(([a, how]) => `${a}${how && how !== 'found' ? ' (' + (HOW_LABEL[how] || how) + ')' : ''}`);
    return shown.join(', ') + (list.length > shown.length ? ` +${list.length - shown.length}` : '');
  }
  const NOTABLE_ITEM = /ite$|ite [XY]$| Z$|Stone$|^(Leftovers|Life Orb|Choice |Focus Sash|Eviolite|Assault Vest|Rocky Helmet|Expert Belt|Muscle Band|Wise Glasses|Light Clay|Heavy-Duty Boots|Black Sludge|Air Balloon|Weakness Policy|Sitrus Berry|Lum Berry|Scope Lens|Razor Claw|King's Rock|Quick Claw|Shell Bell|Mystic Water|Charcoal|Miracle Seed|Magnet|Never-Melt Ice|Black Belt|Poison Barb|Soft Sand|Sharp Beak|Twisted Spoon|SilverPowder|Hard Stone|Spell Tag|Dragon Fang|BlackGlasses|Metal Coat|Silk Scarf|Pixie Plate|Loaded Dice|Punch Glove|Mega Ring|Ability|Exp\. Share|Covert Cloak|Clear Amulet)/;
  function hpBar(p) { p = Math.max(0, Math.min(100, p)); return `<div class="hp"><span>HP</span><div class="track"><i class="${p <= 20 ? 'lo' : p <= 50 ? 'mid' : ''}" style="width:${p}%"></i></div></div>`; }
  function pct(x) { return x >= 99.95 ? '100' : x.toFixed(x < 10 ? 1 : 0); }
  function fmtRisk(r) { if (r <= 0) return '0%'; if (r < 0.001) return '<0.1%'; return (100 * r).toFixed(r < 0.1 ? 1 : 0) + '%'; }
  function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }
  function natureText(i) { const n = D.natures[i]; if (!n) return ''; return n.u ? `${n.n} (+${STAT_LABEL[n.u]} −${STAT_LABEL[n.d]})` : `${n.n} (neutral)`; }
  function monName(m) { const s = E.sp(m.s); return m.nick ? `${m.nick} (${s.n})` : s.n; }
  function verdictBadge(m) {
    if (m.verdict === 'safe') return '<span class="verdict v-safe">Safe</span>';
    if (m.verdict === 'ok') return `<span class="verdict v-ok">${fmtRisk(m.risk)} risk</span>`;
    if (m.verdict === 'risky') return `<span class="verdict v-risky">${fmtRisk(m.risk)} risk</span>`;
    return '<span class="verdict v-lose">Loses</span>';
  }
  function moveChip(id, extra) {
    const m = E.mv(id); if (!m) return '';
    const c = TYPE_COLORS[m.t] || '#888888';
    const cat = { P: 'Phys', S: 'Spec', X: 'Status' }[m.k];
    return `<div class="mv"><span class="bar" style="background:${c}"></span><span class="txt"><span class="nm">${esc(m.f)}</span><span class="meta">${esc(m.t)} · ${cat}${m.p ? ' · ' + (m.p === 1 ? 'var' : m.p) : ''}${extra ? ' · ' + extra : ''}</span></span></div>`;
  }
  // your Pokemon battle with Hardcore's ability changes applied
  function specOf(m, extra) { return Object.assign({ key: m.key, s: m.s, lv: m.lv, nat: m.nat, ab: E.hardcoreAbility(m.ab, m.s), it: m.it || null, mv: (m.mv || []).filter(Boolean) }, extra || {}); }
  function alive() { return S.roster.filter(m => m.box !== 'dead'); }
  function party() { return S.roster.filter(m => m.box === 'party'); }
  function milestonesDone() { return D.bosses.filter(b => b.ms && S.run.beaten.includes(b.i)).length; }
  function capNow() { return D.caps.hardcore[Math.min(milestonesDone(), 17)]; }
  function nextBoss() { const b = D.bosses.find(b => !b.route && !S.run.beaten.includes(b.i)); return b ? b.i : D.routeStart - 1; }
  /** Battles that are alternatives of each other (the rival's three starter versions, repeated gym entries):
   *  same trainer name and cap, next to each other in the table. */
  function variantsOf(i) {
    const b = D.bosses[i]; const out = [i];
    for (let j = i - 1; j >= 0 && D.bosses[j].n === b.n && D.bosses[j].cap === b.cap; j--) out.push(j);
    for (let j = i + 1; j < D.bosses.length && D.bosses[j].n === b.n && D.bosses[j].cap === b.cap; j++) out.push(j);
    return out;
  }
  function bossLabel(b) { return `${b.n} (${b.cls})${b.v ? ' · has ' + b.v : ''}${b.dbl ? ' · double' : ''}`; }

  // ---------------- storage: your account (db), or this device ----------------
  const LS_KEY = 'rrcoach:v1';
  const store = {
    mode: 'loading', col: null, unsub: null, timer: null, note: '',
    async init() {
      let db = null, user = null;
      try { if (window.claude && claude.use) { [db, user] = await Promise.all([claude.use('db'), claude.use('user')]); } } catch (e) { db = null; }
      const id = user ? await user.id().catch(() => null) : null;
      if (db && id) {
        this.mode = 'db';
        this.col = db.collection('data/users/' + id);
        this.timer = setTimeout(() => { this.note = 'Your saved team hasn’t loaded yet. Check your connection.'; renderStatus(); }, 10000);
        this.unsub = this.col.onSnapshot(snap => {
          clearTimeout(this.timer); this.note = '';
          const roster = [], run = { beaten: [] }, history = [];
          snap.docs.forEach(d => {
            const v = d.data(); if (!v) return;
            if (d.id === 'run') Object.assign(run, v);
            else if (d.id.startsWith('mon-')) roster.push(Object.assign({}, v, { key: d.id }));
            else if (d.id.startsWith('hist-')) history.push(Object.assign({}, v, { id: d.id.slice(5) }));
          });
          S.history = history.sort((a, b) => (b.ended || 0) - (a.ended || 0));
          roster.sort((a, b) => (a.ord || 0) - (b.ord || 0));
          if (!S.example || roster.length) { S.roster = roster; S.example = false; }
          S.run = { beaten: Array.isArray(run.beaten) ? run.beaten.slice() : [], tms: Array.isArray(run.tms) ? run.tms.slice() : [],
            enc: run.enc && typeof run.enc === 'object' ? Object.assign({}, run.enc) : {}, dupes: run.dupes !== false, checks: Array.isArray(run.checks) ? run.checks.slice(-50) : [], tutors: !!run.tutors,
            no: run.no || (history.length + 1), started: run.started || null, starter: run.starter || null, aiChecks: run.aiChecks || null, bag: Array.isArray(run.bag) ? run.bag.slice() : [] };
          ADV.setOptions({ tutors: S.run.tutors });
          render();
        }, err => { clearTimeout(this.timer); this.note = 'Saving to your account stopped working (' + err.code + '). Reload to try again.'; renderStatus(); });
      } else {
        this.mode = 'local';
        try { const v = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); if (v) { S.roster = v.roster || []; S.history = v.history || []; S.run = Object.assign({ beaten: [], tms: [], enc: {}, dupes: true, checks: [], tutors: false, no: S.history.length + 1, started: null, starter: null }, v.run || {}); ADV.setOptions({ tutors: S.run.tutors }); } } catch (e) { /* storage blocked */ }
        render();
      }
    },
    saveLocal() { try { localStorage.setItem(LS_KEY, JSON.stringify({ roster: S.roster, run: S.run, history: S.history })); } catch (e) { this.note = 'This browser blocked saving.'; } },
    async saveHist(h) {
      if (this.mode === 'db') { try { await this.col.doc('hist-' + h.id).set(Object.assign({}, h, { id: undefined })); } catch (e) { flash('Couldn’t save the run to your history (' + e.code + ').'); } }
      else this.saveLocal();
    },
    async deleteHist(id) {
      if (this.mode === 'db') { try { await this.col.doc('hist-' + id).delete(); } catch (e) { flash('Couldn’t delete (' + e.code + ').'); } }
      else this.saveLocal();
    },
    async saveMon(m) {
      if (S.example) return;
      const body = { s: m.s, nick: m.nick || '', lv: m.lv, nat: m.nat, ab: m.ab, it: m.it || null, mv: m.mv, box: m.box, met: m.met || '', ord: m.ord || Date.now(), pid: m.pid || null, died: m.died || null };
      if (this.mode === 'db') { try { await this.col.doc(m.key).set(body); } catch (e) { flash('Couldn’t save to your account (' + e.code + ').'); } }
      else this.saveLocal();
    },
    async deleteMon(key) {
      if (S.example) return;
      if (this.mode === 'db') { try { await this.col.doc(key).delete(); } catch (e) { flash('Couldn’t delete (' + e.code + ').'); } }
      else this.saveLocal();
    },
    async saveRun() {
      if (S.example) return;
      if (!S.run.started && S.roster.length) S.run.started = Math.min(...S.roster.map(m => m.ord || Date.now()));
      if (this.mode === 'db') { try { await this.col.doc('run').set({ beaten: S.run.beaten, tms: S.run.tms || [], enc: S.run.enc || {}, dupes: S.run.dupes !== false, checks: (S.run.checks || []).slice(-50), tutors: !!S.run.tutors, aiChecks: S.run.aiChecks || null, bag: S.run.bag || [],
        no: S.run.no || 1, started: S.run.started || null, starter: S.run.starter || null }); } catch (e) { flash('Couldn’t save progress (' + e.code + ').'); } }
      else this.saveLocal();
    },
  };
  let flashMsg = '';
  function flash(msg) { flashMsg = msg; renderStatus(); setTimeout(() => { flashMsg = ''; renderStatus(); }, 6000); }

  function renderStatus() {
    const el = $('#status'); if (!el || !D) return;
    const nb = D.bosses[nextBoss()];
    const where = S.example ? '<span class="pill warn">Example team, not saved</span>'
      : store.mode === 'db' ? '<span class="pill">Saved to your account</span>'
      : store.mode === 'local' ? '<span class="pill warn">Saved on this device only</span>' : '<span class="pill">Loading…</span>';
    el.innerHTML = `<span class="pill cap">Cap ${capNow()}</span><span class="pill">Next: ${esc(nb.n)}</span>${where}` +
      (store.note || flashMsg ? `<span class="pill warn">${esc(flashMsg || store.note)}</span>` : '');
  }

  // ---------------- tabs ----------------
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
    S.tab = b.dataset.tab;
    document.querySelectorAll('.tabs button').forEach(o => o.setAttribute('aria-selected', o === b ? 'true' : 'false'));
    try { localStorage.setItem('rrcoach:tab', S.tab); } catch (e) {}
    render();
    window.scrollTo(0, 0);
  }));

  function render() {
    if (!D) return;
    renderStatus();
    if (S.tab === 'team') renderTeam();
    else if (S.tab === 'routes') renderRoutes();
    else if (S.tab === 'plan') renderPlan();
    else if (S.tab === 'runs') renderRuns();
    else renderBattle();
  }

  // ---------------- TEAM ----------------
  function monCard(m) {
    const s = E.sp(m.s); const ab = E.abilityInfo(m.ab);
    const moves = (m.mv || []).map(id => moveChip(id, E.isBanned(id, s.g) ? 'banned in Hardcore' : '')).join('');
    const over = m.lv > capNow() ? `<span class="tag ban">above cap ${capNow()}</span>` : '';
    const moveTo = m.box === 'party' ? 'box' : 'party';
    const evo = evoSummary(m.s);
    return `<div class="card" data-key="${esc(m.key)}">
      <div class="slot">${icon(m.s, 'x2')}<div class="who"><b>${esc(monName(m))}</b><div class="row" style="gap:6px">${typesHTML(s.t)}<span class="lv">Lv ${m.lv}</span>${over}${m.box === 'dead' ? '<span class="tag ban">fainted</span>' : ''}</div></div></div>
      <dl class="kv"><dt>Ability</dt><dd>${esc(m.ab || '—')}${ab.x ? ' <span class="tag">Radical Red ability</span>' : ''}${m.ab && E.hardcoreAbility(m.ab, m.s) !== m.ab ? ` <span class="tag ban">Hardcore: ${esc(E.hardcoreAbility(m.ab, m.s))}</span>` : ''}</dd>
        <dt>Item</dt><dd>${esc(E.itemName(m.it) || '—')}</dd><dt>Nature</dt><dd>${esc(natureText(m.nat))}</dd>${m.met ? `<dt>Caught</dt><dd>${esc(m.met)}</dd>` : ''}
        ${evo.length ? `<dt>Evolves</dt><dd>${evo.map(esc).join('<br>')}</dd>` : ''}</dl>
      <div class="moves">${moves || '<span class="muted small">No moves entered</span>'}</div>
      ${m.box === 'dead' ? '' : `<div class="row">
        <button class="btn small" data-act="edit">Edit</button>
        <button class="btn small primary" data-act="advice">Nature &amp; moves</button>
        <button class="btn small" data-act="move" ${m.box !== 'party' && party().length >= 6 ? 'disabled title="Your party is full"' : ''}>To ${moveTo}</button>
        <button class="btn small ghost" data-act="faint">Fainted…</button>
      </div>`}
      ${m.box === 'dead' ? `<div class="row"><button class="btn small" data-act="edit">Edit</button><button class="btn small ghost" data-act="delete">Delete…</button></div>` : ''}
    </div>`;
  }
  function renderTeam() {
    const p = party(), box = S.roster.filter(m => m.box === 'box'), dead = S.roster.filter(m => m.box === 'dead');
    let html = '';
    if (S.example) html += `<div class="banner">This is an example team so you can see how the Coach works. Nothing here is saved. Add your first Pokémon to start your own.</div>`;
    if (!S.roster.length) {
      html += `<div class="empty"><h2>Add the Pokémon you have</h2>
        <p class="small" style="max-width:46ch;margin:0">Enter each Pokémon as you catch it: species, level, nature, ability, item and moves. The Plan and Battle tabs then work out lineups and turns against every Hardcore boss.</p>
        <div class="row" style="justify-content:center"><button class="btn primary" data-act="add">Add a Pokémon</button><button class="btn" data-act="import">Import save file</button><button class="btn" data-act="example">Try an example team</button></div></div>`;
      main.innerHTML = html; wireTeam(); return;
    }
    if (!S.example && S.roster.length && !alive().length) html += `<div class="banner" style="display:grid;gap:8px"><b>Every Pokémon you had has fainted: that's a wipe.</b><span>Save this run to your history and start fresh in one step.</span><div><button class="btn primary" data-act="endrun">End this run…</button></div></div>`;
    html += `<div class="row"><button class="btn primary" data-act="add">Add a Pokémon</button><button class="btn" data-act="import">Import save file</button><span class="muted small">${p.length}/6 in party · ${box.length} in box · ${dead.length} fainted</span></div>`;
    html += `<section class="section"><div class="head"><h2>Party</h2></div>${p.length ? p.map(monCard).join('') : '<div class="empty small">No Pokémon in your party. Move some from your box.</div>'}</section>`;
    if (box.length) html += `<section class="section"><div class="head"><h2>Box</h2></div>${box.map(monCard).join('')}</section>`;
    if (dead.length) html += `<details class="more"><summary>Fainted (${dead.length})</summary><div class="section" style="margin-top:8px">${dead.map(monCard).join('')}</div></details>`;
    html += tmCaseHTML();
    html += bagHTML();
    main.innerHTML = html;
    wireTeam();
    wireTMCase();
    wireBag();
  }
  // ---------------- TM case: which TMs you own (move advice only uses these) ----------------
  function tmCaseHTML() {
    const owned = new Set(S.run.tms || []);
    return `<details class="more" id="tmcase" ${S.tmOpen ? 'open' : ''}><summary>TMs you have (${owned.size})</summary>
      <p class="note">Tick each TM when you get it. Move advice only suggests TMs you have, so it never recommends a move you can't teach yet.</p>
      <label class="row small" style="flex-wrap:nowrap;gap:6px"><input type="checkbox" id="tutors" ${S.run.tutors ? 'checked' : ''}> <span>Also suggest move tutor moves (${'126'} tutors, read from the ROM; you still have to reach the tutor)</span></label>
      <input class="search" id="tm-filter" placeholder="Filter by move or number" style="margin:6px 0;width:100%">
      <div class="tmgrid">${D.tms.map((id, i) => {
        const m = E.mv(id); if (!m) return '';
        const label = i < 120 ? `TM${String(i + 1).padStart(2, '0')}` : `HM${String(i - 119).padStart(2, '0')}`;
        return `<label class="tm" data-q="${esc((label + ' ' + m.f).toLowerCase())}"><input type="checkbox" data-tm="${i}" ${owned.has(i) ? 'checked' : ''}><span class="num">${label}</span> <span>${esc(m.f)}${tmWhere(i) ? `<span class="note" style="display:block">${esc(tmWhere(i))}</span>` : ''}</span>${E.isBanned(id, '') ? ' <span class="tag ban">banned</span>' : ''}</label>`;
      }).join('')}</div></details>`;
  }
  function wireTMCase() {
    const box = $('#tmcase'); if (!box) return;
    box.addEventListener('toggle', () => { S.tmOpen = box.open; });
    const tu = $('#tutors'); if (tu) tu.onchange = () => { S.run.tutors = tu.checked; ADV.setOptions({ tutors: tu.checked }); store.saveRun(); };
    const f = $('#tm-filter');
    f.addEventListener('input', () => { const q = f.value.trim().toLowerCase(); box.querySelectorAll('.tm').forEach(el => { el.hidden = q && !el.dataset.q.includes(q); }); });
    let t = null;
    box.querySelectorAll('[data-tm]').forEach(cb => cb.addEventListener('change', () => {
      const i = +cb.dataset.tm; const set = new Set(S.run.tms || []);
      if (cb.checked) set.add(i); else set.delete(i);
      S.run.tms = [...set].sort((a, b) => a - b);
      box.querySelector('summary').textContent = `TMs you have (${S.run.tms.length})`;
      clearTimeout(t); t = setTimeout(() => store.saveRun(), 600);
    }));
  }
  // ---------------- held items you have (item advice only gives these) ----------------
  let HELD = null;
  function heldItems() {
    if (!HELD) HELD = Object.entries(D.items).filter(([id, x]) => x.c && tmOfItem(+id) == null && !/Ball$|Potion$|Revive|Heal$|Ether$|Elixir|Repel|Mail$|Fossil|Shard$|Nugget|Pearl$|Stardust|Mushroom|Wing$|Candy|Escape Rope|Flute$|Honey|Fresh Water|Soda Pop|Lemonade|Moomoo/.test(x.n))
      .map(([id, x]) => ({ id: +id, n: x.n })).sort((a, b) => a.n.localeCompare(b.n));
    return HELD;
  }
  function bagHTML() {
    const have = new Set(S.run.bag || []);
    const where = id => ((D.itemWhere || {})[id] || []).slice(0, 2).map(([a, how]) => `${a}${how !== 'found' ? ' (' + (HOW_LABEL[how] || how) + ')' : ''}`).join(', ');
    return `<details class="more" id="bag" ${S.bagOpen ? 'open' : ''}><summary>Held items you have (${have.size})</summary>
      <p class="note">Tick the held items you own. The Plan tab then suggests which Pokémon should hold what for each fight.</p>
      <input class="search" id="bag-filter" placeholder="Filter items" style="margin:6px 0;width:100%">
      <div class="tmgrid">${heldItems().map(x => `<label class="tm" data-q="${esc(x.n.toLowerCase())}"><input type="checkbox" data-bag="${x.id}" ${have.has(x.id) ? 'checked' : ''}><span>${esc(x.n)}${where(x.id) ? `<span class="note" style="display:block">${esc(where(x.id))}</span>` : ''}</span></label>`).join('')}</div></details>`;
  }
  function wireBag() {
    const box = $('#bag'); if (!box) return;
    box.addEventListener('toggle', () => { S.bagOpen = box.open; });
    const f = $('#bag-filter');
    f.addEventListener('input', () => { const q = f.value.trim().toLowerCase(); box.querySelectorAll('.tm').forEach(el => { el.hidden = q && !el.dataset.q.includes(q); }); });
    let t = null;
    box.querySelectorAll('[data-bag]').forEach(cb => cb.addEventListener('change', () => {
      const id = +cb.dataset.bag; const set = new Set(S.run.bag || []);
      if (cb.checked) set.add(id); else set.delete(id);
      S.run.bag = [...set];
      box.querySelector('summary').textContent = `Held items you have (${S.run.bag.length})`;
      clearTimeout(t); t = setTimeout(() => store.saveRun(), 600);
    }));
  }
  /** Which of your Pokemon should hold which of your items for this fight: each item is tried on each Pokemon against the boss
   *  team (one-on-one matchups; Mega Stones as the Mega form), the best gains are assigned greedily, then the whole fight is
   *  simulated before and after. */
  async function itemAdvice(lineup, team, doubles, onStep) {
    const VS = { safe: 3, ok: 2, risky: 1, lose: 0 };
    const pool = new Map();
    for (const id of S.run.bag || []) pool.set(id, (pool.get(id) || 0) + 1);
    for (const m of S.roster) if (m.it && m.box !== 'dead') pool.set(m.it, (pool.get(m.it) || 0) + 1);
    const candidates = [...pool.keys()].filter(id => (D.items[id] || {}).c);
    const score = (m, it) => {
      let spec = specOf(m, { it });
      const mega = it && SIM.megaTarget({ spec, item: it });
      if (mega) spec = Object.assign({}, spec, { s: mega, ab: (E.sp(mega).a || [])[0] || spec.ab });
      return team.reduce((sum, t) => { const mu = E.matchup(Object.assign({}, spec, { entry: true }), Object.assign({}, t, { entry: true })); return sum + VS[mu.verdict] - mu.risk; }, 0);
    };
    const base = lineup.map(m => score(m, m.it || null));
    const gains = [];
    for (let k = 0; k < lineup.length; k++) {
      for (const it of candidates) if (it !== lineup[k].it) gains.push({ k, it, g: score(lineup[k], it) - base[k] });
      if (onStep) { onStep((k + 1) / lineup.length / 2); await new Promise(r => setTimeout(r, 0)); }
    }
    gains.sort((a, b) => b.g - a.g);
    const left = new Map(pool), assigned = new Map();
    for (const x of gains) {
      if (x.g < 0.15 || assigned.has(x.k) || !(left.get(x.it) > 0)) continue;
      assigned.set(x.k, x); left.set(x.it, left.get(x.it) - 1);
    }
    // check the whole fight with and without the swaps
    const specsNow = lineup.map(m => specOf(m, { label: monName(m) }));
    const specsNew = lineup.map((m, k) => specOf(m, { label: monName(m), it: assigned.has(k) ? assigned.get(k).it : m.it || null }));
    let before = null, after = null;
    if (assigned.size) {
      before = await SIM.simulateAsync(specsNow, team, { runs: 40, seed: 5, doubles }, () => {});
      if (onStep) onStep(0.75);
      after = await SIM.simulateAsync(specsNew, team, { runs: 40, seed: 5, doubles }, () => {});
    }
    return { assigned: [...assigned.values()].map(x => ({ m: lineup[x.k], it: x.it, g: x.g, from: lineup[x.k].it || null })), before, after, candidates: candidates.length };
  }

  // ---------------- per-Pokemon advice: nature and when to learn what ----------------
  function openAdvice(m) {
    document.body.style.overflow = 'hidden';
    sheet.hidden = false;
    sheet.innerHTML = `<div class="inner"><div class="row"><h2 class="grow">${esc(monName(m))}: nature &amp; moves</h2><button class="btn ghost" id="adv-close">Close</button></div><div class="empty">Testing natures and movesets against your next big fights…</div></div>`;
    const close = () => { sheet.hidden = true; sheet.innerHTML = ''; document.body.style.overflow = ''; };
    $('#adv-close').onclick = close;
    setTimeout(() => {
      const spec = specOf(m);
      const from = nextBoss();
      const tms = S.run.tms || [];
      const na = ADV.natureAdvice(spec, from, tms, 3);
      const mp = ADV.movePlan(spec, from, tms, 3);
      const best = na.best, cur = na.current;
      const nat = i => natureText(i);
      const bossList = na.bosses.map(i => `${D.bosses[i].n} (cap ${D.bosses[i].cap})`).join(', ');
      const s = E.sp(m.s);
      let html = `<div class="inner"><div class="row"><h2 class="grow">${esc(monName(m))}: nature &amp; moves</h2><button class="btn ghost" id="adv-close">Close</button></div>
        <div class="card rec"><div class="lbl">Set its nature to</div><h3>${esc(nat(best.nat))}${best.nat === m.nat ? ' <span class="verdict v-safe">already set</span>' : ''}</h3>
          <p class="small" style="margin:0">${esc(na.reason)}${best.nat !== m.nat && cur ? ` Compared with ${esc(D.natures[m.nat].n)}: ${na.changes.length ? esc(na.changes.slice(0, 4).join('; ')) : 'fewer close calls, no matchup flips'}.` : ''}</p>
          <p class="note" style="margin:0">Tested against ${esc(bossList)}, at each fight's level cap with its best moves. Radical Red has a free Nature Change service, in the same menu as “Set Mon To Lvl Cap”.</p>
          <div class="chips">${na.ranked.map(r => `<span class="tag">${esc(D.natures[r.nat].n)} ${r.total.toFixed(1)}</span>`).join('')}</div></div>`;
      const evo = evoSummary(m.s);
      if (evo.length) {
        const lvEvo = (D.evo[m.s] || []).filter(([, method, param]) => [4, 8, 9, 10, 20, 21, 22, 23, 31, 32].includes(method) && param > m.lv);
        const when = lvEvo.map(([to, , param]) => {
          const by = na.bosses.find(i => D.bosses[i].cap >= param);
          return `${E.sp(to).n} at Lv ${param}${by != null ? ` (in time for ${D.bosses[by].n}, cap ${D.bosses[by].cap})` : ' (after the next big fights)'}`;
        });
        html += `<div class="card"><div class="lbl">Evolution</div><div class="small">${evo.map(esc).join('<br>')}</div>${when.length ? `<p class="note" style="margin:0">Next: ${esc(when.join('; '))}. Evolving changes its stats and moves, so check this page again afterwards.</p>` : ''}</div>`;
      }
      html += `<section class="section"><h2>When to learn what</h2>${mp.steps.map(st => {
        const b = D.bosses[st.boss];
        const adds = st.add.filter(x => !E.mv(x.id) || true);
        return `<div class="card"><div class="mon-head"><span class="mon-name">Before ${esc(b.n)}</span><span class="pill cap">cap ${st.cap}</span></div>
          <div class="moves">${st.set.map(x => moveChip(x.id, esc(x.how))).join('') || '<span class="muted small">No damaging moves available.</span>'}</div>
          ${adds.length ? `<div class="small">${adds.map(x => `Learn <b>${esc(E.mv(x.id).f)}</b> ${x.how.startsWith('Lv') ? (x.alreadyPassed ? `(it learned this at ${esc(x.how)}: ask the Move Maniac, 2 Tiny Mushrooms or 1 Big Mushroom)` : `when it reaches ${esc(x.how)}`) : x.how === 'on evolution' ? '(learned on evolution or from the Move Maniac)' : x.how === 'Move Tutor' ? 'from a move tutor' : `with ${esc(x.how)}`}`).join('<br>')}</div>` : '<div class="small muted">No change needed.</div>'}
          ${st.drop.length ? `<div class="small muted">Replace: ${st.drop.map(id => esc(E.mv(id).f)).join(', ')}</div>` : ''}</div>`;
      }).join('')}</section>`;
      html += `<section class="section"><h2>Level-up moves still to come</h2><div class="card"><div class="moves">${mp.upcoming.length ? mp.upcoming.map(u => moveChip(u.id, `Lv ${u.lv}${u.banned ? ' · banned in Hardcore' : ''}`)).join('') : '<span class="muted small">None left.</span>'}</div>
        <p class="note" style="margin:0">When a level-up move is offered, decide then: skipping it means paying the Move Maniac later. If ${esc(s.n)} evolves, its move list changes, so check again after evolving.</p></div></section>`;
      const allTM = ADV.movePlan(spec, from, D.tms.map((_, i) => i), 3);
      const wanted = new Map();
      for (const stp of allTM.steps) for (const x of stp.set) if (x.tm != null && !tms.includes(x.tm) && !wanted.has(x.tm)) wanted.set(x.tm, { id: x.id, boss: D.bosses[stp.boss].n });
      if (wanted.size) html += `<section class="section"><h2>TMs worth getting</h2><div class="card">${[...wanted.entries()].map(([t, x]) => `<div class="small"><b>${tmName(t)} ${esc(E.mv(x.id).f)}</b> would make its best set for ${esc(x.boss)}${tmWhere(t) ? ` · <span class="muted">${esc(tmWhere(t))}</span>` : ' · <span class="muted">location not found in the map scripts</span>'}</div>`).join('')}
        <p class="note" style="margin:0">Where each TM is, read from the maps' scripts: items on the ground, hidden items, gifts and shops.</p></div></section>`;
      html += `<p class="note">Move advice uses ${tms.length} TM${tms.length === 1 ? '' : 's'} from your TM case. Tick TMs on the Team tab as you get them.</p></div>`;
      sheet.innerHTML = html;
      $('#adv-close').onclick = close;
    }, 30);
  }
  function wireTeam() {
    main.querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', async () => {
      const act = btn.dataset.act;
      const card = btn.closest('[data-key]'); const m = card ? S.roster.find(x => x.key === card.dataset.key) : null;
      if (act === 'add') openEditor(null);
      else if (act === 'import') openImport();
      else if (act === 'endrun') openEndRun('wipe');
      else if (act === 'example') loadExample();
      else if (act === 'edit') openEditor(m);
      else if (act === 'advice') openAdvice(m);
      else if (act === 'move') { m.box = m.box === 'party' ? 'box' : 'party'; render(); await store.saveMon(m); }
      else if (act === 'faint') {
        btn.textContent = 'Confirm: mark as fainted'; btn.dataset.act = 'faint2'; btn.classList.add('primary');
        btn.addEventListener('click', async () => { m.box = 'dead'; m.died = { at: Date.now(), before: D.bosses[nextBoss()].n }; render(); await store.saveMon(m); }, { once: true });
      } else if (act === 'delete') {
        btn.textContent = 'Confirm delete'; btn.dataset.act = 'delete2'; btn.classList.add('primary');
        btn.addEventListener('click', async () => { S.roster = S.roster.filter(x => x !== m); render(); await store.deleteMon(m.key); }, { once: true });
      }
    }));
  }
  function loadExample() {
    const find = n => D.species.find(s => s.n === n).i;
    const mvs = names => names.map(n => D.moves.find(m => m.f === n || m.n === n).i);
    const nat = n => D.natures.findIndex(x => x.n === n);
    S.example = true;
    S.roster = [
      { key: 'ex1', s: find('Squirtle'), lv: 16, nat: nat('Modest'), ab: 'Torrent', it: null, mv: mvs(['Water Gun', 'Bite', 'Rapid Spin', 'Water Pulse']), box: 'party' },
      { key: 'ex2', s: find('Pidgey'), lv: 15, nat: nat('Jolly'), ab: 'Keen Eye', it: null, mv: mvs(['Gust', 'Quick Attack', 'Tackle']), box: 'party' },
      { key: 'ex3', s: find('Mankey'), lv: 16, nat: nat('Adamant'), ab: 'Vital Spirit', it: null, mv: mvs(['Karate Chop', 'Low Kick', 'Fury Swipes']), box: 'party' },
      { key: 'ex4', s: find('Pikachu'), lv: 15, nat: nat('Timid'), ab: 'Static', it: null, mv: mvs(['ThunderShock', 'Quick Attack', 'Electro Ball']), box: 'party' },
    ];
    render();
  }

  // ---------------- autocomplete ----------------
  function attachSearch(input, list, source, onPick) {
    let items = [];
    const show = () => {
      items = source(input.value.trim().toLowerCase());
      if (!items.length) { list.hidden = true; list.innerHTML = ''; return; }
      list.innerHTML = items.map((it, i) => `<button type="button" data-i="${i}"><span>${it.label}</span><span class="sub">${it.sub || ''}</span></button>`).join('');
      list.hidden = false;
      list.querySelectorAll('button').forEach(b => b.addEventListener('mousedown', e => e.preventDefault()));
      list.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { const it = items[+b.dataset.i]; list.hidden = true; onPick(it); }));
    };
    input.addEventListener('input', show);
    input.addEventListener('focus', show);
    input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 120));
    input.addEventListener('keydown', e => { if (e.key === 'Enter' && items[0]) { e.preventDefault(); list.hidden = true; onPick(items[0]); } });
  }
  function speciesSource(q) {
    if (!q) return [];
    const res = [];
    for (const s of D.species) {
      if (s.bo) continue;
      const n = s.n.toLowerCase(), g = s.g.toLowerCase();
      const rank = n.startsWith(q) || g.startsWith(q) ? 0 : (n.includes(q) || g.includes(q)) ? 1 : -1;
      if (rank >= 0) res.push({ rank, s });
    }
    res.sort((a, b) => a.rank - b.rank || a.s.n.length - b.s.n.length);
    return res.slice(0, 10).map(({ s }) => ({ id: s.i, label: esc(s.n), sub: esc(s.t.join('/')) }));
  }
  function itemSource(q) {
    if (!q) return [];
    const out = [];
    for (const [id, it] of Object.entries(D.items)) {
      const n = it.n.toLowerCase();
      if (n.startsWith(q) || (q.length > 2 && n.includes(q))) out.push({ id: +id, label: esc(it.n), sub: it.c && it.c !== it.n ? esc(it.c) : '' , r: n.startsWith(q) ? 0 : 1 });
    }
    return out.sort((a, b) => a.r - b.r).slice(0, 10);
  }
  function moveSource(speciesId, level) {
    return q => {
      const learn = speciesId ? E.learnable(speciesId, level) : [];
      const s = speciesId ? E.sp(speciesId) : null;
      const match = m => !q || m.f.toLowerCase().includes(q) || m.n.toLowerCase().includes(q);
      const known = learn.filter(x => match(E.mv(x.id))).sort((a, b) => (a.how.startsWith('Lv') ? 0 : 1) - (b.how.startsWith('Lv') ? 0 : 1));
      const res = known.slice(0, 12).map(x => ({ id: x.id, label: esc(E.mv(x.id).f), sub: esc(x.how) + (x.banned ? ' · banned' : '') }));
      if (q && res.length < 6) {
        for (const m of D.moves) {
          if (res.length >= 10) break;
          if (match(m) && !known.some(k => k.id === m.i)) res.push({ id: m.i, label: esc(m.f), sub: 'egg or event move?' + (s && E.isBanned(m.i, s.g) ? ' · banned' : '') });
        }
      }
      return res;
    };
  }

  // ---------------- editor sheet ----------------
  function wildMoves(sid, lv) {
    const L = D.learn[sid]; if (!L) return [];
    const k = [];
    for (const [l, id] of L.l) if (l <= lv && E.mv(id) && !k.includes(id)) { k.push(id); if (k.length > 4) k.shift(); }
    return k;
  }
  function openEditor(existing, prefill) {
    const m = existing ? JSON.parse(JSON.stringify(existing)) : { key: 'mon-' + uid(), s: null, lv: Math.max(5, capNow() - 3), nat: 0, ab: null, it: null, mv: [], box: party().length < 6 ? 'party' : 'box', nick: '', met: '' };
    if (!existing && prefill) {
      Object.assign(m, { s: prefill.s, lv: prefill.lv, met: prefill.met || '' });
      const sp = E.sp(prefill.s); m.ab = sp ? sp.a[0] : null; m.mv = wildMoves(prefill.s, prefill.lv);
    }
    const isNew = !existing;
    function draw() {
      const s = m.s ? E.sp(m.s) : null;
      const abil = s ? s.a.map((a, i) => a ? `<option value="${esc(a)}" ${m.ab === a ? 'selected' : ''}>${esc(a)}${i === 2 ? ' (hidden)' : ''}${E.hardcoreAbility(a, m.s) !== a ? ' → ' + esc(E.hardcoreAbility(a, m.s)) + ' in Hardcore' : ''}</option>` : '').join('') : '';
      const abInfo = m.ab ? E.abilityInfo(m.ab) : null;
      sheet.innerHTML = `<div class="inner">
        <div class="row"><h2 class="grow">${isNew ? 'Add a Pokémon' : 'Edit ' + esc(monName(existing))}</h2><button class="btn ghost" id="ed-cancel">Cancel</button></div>
        <div class="fields">
          <div class="field wide ac"><label for="ed-species">Species</label>
            <input id="ed-species" autocomplete="off" placeholder="Type a name, e.g. Charmander" value="${s ? esc(s.n) : ''}">
            <div class="ac-list" id="ed-species-list" hidden></div>
            ${s ? `<div class="row small">${typesHTML(s.t)}<span class="muted">Base ${s.s.join(' / ')}</span></div>` : ''}</div>
          <div class="field"><label for="ed-level">Level</label><input id="ed-level" type="number" min="1" max="100" inputmode="numeric" value="${m.lv}"></div>
          <div class="field"><label for="ed-nature">Nature</label><select id="ed-nature">${D.natures.map((n, i) => `<option value="${i}" ${m.nat === i ? 'selected' : ''}>${esc(natureText(i))}</option>`).join('')}</select></div>
          <div class="field"><label for="ed-ability">Ability</label><select id="ed-ability" ${s ? '' : 'disabled'}>${abil}</select></div>
          <div class="field ac"><label for="ed-item">Held item</label><input id="ed-item" autocomplete="off" placeholder="None" value="${esc(E.itemName(m.it) || '')}"><div class="ac-list" id="ed-item-list" hidden></div></div>
          ${abInfo && abInfo.d ? `<p class="note wide" style="margin:0">${esc(m.ab)}: ${esc(abInfo.d)}${abInfo.x ? ' (Radical Red ability)' : ''}</p>` : ''}
          ${[0, 1, 2, 3].map(i => `<div class="field ac"><label for="ed-mv${i}">Move ${i + 1}</label><input id="ed-mv${i}" autocomplete="off" placeholder="${s ? 'Search its moves' : 'Pick a species first'}" value="${m.mv[i] ? esc(E.mv(m.mv[i]).f) : ''}" ${s ? '' : 'disabled'}><div class="ac-list" id="ed-mv${i}-list" hidden></div>${m.mv[i] && s && E.isBanned(m.mv[i], s.g) ? '<span class="tag ban">Hardcore bans this move</span>' : ''}</div>`).join('')}
          <div class="field wide row" style="gap:6px">${s ? '<button class="btn small" id="ed-default">Fill its level-up moves</button>' : ''}<span class="note">Wild Pokémon know the last four moves they learned by level.</span></div>
          <div class="field"><label for="ed-nick">Nickname (optional)</label><input id="ed-nick" value="${esc(m.nick || '')}" maxlength="20"></div>
          <div class="field"><label for="ed-met">Caught at (optional)</label><input id="ed-met" value="${esc(m.met || '')}" maxlength="40" placeholder="Route 3"></div>
          <div class="field"><label for="ed-box">Where</label><select id="ed-box"><option value="party" ${m.box === 'party' ? 'selected' : ''}>Party</option><option value="box" ${m.box === 'box' ? 'selected' : ''}>Box</option><option value="dead" ${m.box === 'dead' ? 'selected' : ''}>Fainted</option></select></div>
        </div>
        ${s ? upcomingHTML(m) : ''}
        <div class="row"><button class="btn primary" id="ed-save" ${s ? '' : 'disabled'}>${isNew ? 'Add to team' : 'Save changes'}</button>${!isNew ? '<button class="btn ghost" id="ed-delete">Delete…</button>' : ''}<span class="note" id="ed-msg"></span></div>
      </div>`;
      wire();
    }
    function upcomingHTML(mm) {
      const up = E.upcoming(mm.s, mm.lv);
      if (!up.length) return '';
      const s = E.sp(mm.s);
      return `<div class="card"><h3>Learns next</h3><div class="moves">${up.map(u => moveChip(u.id, 'Lv ' + u.lv + (E.isBanned(u.id, s.g) ? ' · banned' : ''))).join('')}</div></div>`;
    }
    function readBasics() {
      const lv = parseInt($('#ed-level').value, 10); if (lv >= 1 && lv <= 100) m.lv = lv;
      m.nat = parseInt($('#ed-nature').value, 10) || 0;
      const ab = $('#ed-ability'); if (ab && !ab.disabled) m.ab = ab.value;
      m.nick = $('#ed-nick').value.trim(); m.met = $('#ed-met').value.trim(); m.box = $('#ed-box').value;
      if (!$('#ed-item').value.trim()) m.it = null;
    }
    function defaultMoves() {
      const L = D.learn[m.s]; if (!L) return [];
      const seen = []; for (const [lv, id] of L.l) if (lv <= m.lv && E.mv(id) && !seen.includes(id)) seen.push(id);
      return seen.slice(-4);
    }
    function wire() {
      $('#ed-cancel').onclick = close;
      attachSearch($('#ed-species'), $('#ed-species-list'), speciesSource, it => {
        readBasics();
        const changed = m.s !== it.id; m.s = it.id;
        const s = E.sp(m.s);
        if (changed) { m.ab = s.a[0]; m.mv = defaultMoves(); }
        draw(); $('#ed-level').focus();
      });
      attachSearch($('#ed-item'), $('#ed-item-list'), itemSource, it => { readBasics(); m.it = it.id; draw(); });
      [0, 1, 2, 3].forEach(i => {
        const inp = $('#ed-mv' + i); if (!inp || inp.disabled) return;
        attachSearch(inp, $('#ed-mv' + i + '-list'), moveSource(m.s, m.lv), it => { readBasics(); m.mv[i] = it.id; m.mv = m.mv.filter(Boolean); draw(); });
        inp.addEventListener('change', () => { if (!inp.value.trim()) { readBasics(); m.mv.splice(i, 1); draw(); } });
      });
      $('#ed-level').addEventListener('change', () => { readBasics(); draw(); });
      $('#ed-ability') && $('#ed-ability').addEventListener('change', () => { readBasics(); draw(); });
      const df = $('#ed-default'); if (df) df.onclick = () => { readBasics(); m.mv = defaultMoves(); draw(); };
      const del = $('#ed-delete');
      if (del) del.onclick = () => {
        del.textContent = 'Confirm delete'; del.classList.add('primary');
        del.onclick = async () => { S.roster = S.roster.filter(x => x.key !== m.key); close(); render(); await store.deleteMon(m.key); };
      };
      const save = $('#ed-save');
      if (save) save.onclick = async () => {
        readBasics();
        if (!m.s) { $('#ed-msg').textContent = 'Pick a species first.'; return; }
        if (m.box === 'party' && (!existing || existing.box !== 'party') && party().length >= 6) m.box = 'box';
        if (S.example) { S.example = false; S.roster = []; }
        const idx = S.roster.findIndex(x => x.key === m.key);
        if (idx >= 0) S.roster[idx] = m; else { m.ord = Date.now(); S.roster.push(m); }
        close();
        if (prefill && prefill.onSave) prefill.onSave(m);
        render(); await store.saveMon(m);
      };
    }
    function close() { sheet.hidden = true; sheet.innerHTML = ''; document.body.style.overflow = ''; }
    document.body.style.overflow = 'hidden';
    sheet.hidden = false;
    draw();
    if (isNew) setTimeout(() => $('#ed-species') && $('#ed-species').focus(), 50);
  }

  // ---------------- PLAN ----------------
  function bossOptions(sel) {
    const cur = D.bosses[sel];
    const extra = cur && cur.route ? `<option value="${cur.i}" selected>${esc(cur.n)} (${esc(cur.cls)}) · ${esc((cur.areas || []).join(', '))}</option>` : '';
    return extra + D.bosses.filter(b => !b.route).map(b => `<option value="${b.i}" ${b.i === sel ? 'selected' : ''}>${S.run.beaten.includes(b.i) ? '✓ ' : ''}#${b.i + 1} ${esc(bossLabel(b))} · cap ${b.cap}</option>`).join('');
  }
  function theirSetHTML(t) {
    const s = E.sp(t.s);
    const mega = SIM.megaTarget({ spec: t, item: t.it }) ;
    return `<div class="slot">${icon(t.s, 'x2')}<div class="who"><b>${esc(s.n)}</b><div class="row" style="gap:6px">${typesHTML(s.t)}<span class="lv">Lv ${t.lv}</span>${t.rel != null ? `<span class="tag">your top ${t.rel ? (t.rel > 0 ? '+' : '−') + Math.abs(t.rel) : ''}</span>` : ''}${mega ? `<span class="tag ban">Mega Evolves: ${esc(E.sp(mega).n)}</span>` : ''}${/ Z$/.test(E.itemName(t.it) || '') ? '<span class="tag ban">Z-Move</span>' : ''}</div></div></div>
      <div class="small muted">${esc(t.ab)} · ${esc(E.itemName(t.it) || 'no item')} · ${esc(D.natures[t.nat].n)}${t.st ? ' · starts ' + esc({ 8: 'poisoned', 16: 'burned', 64: 'paralyzed', 128: 'badly poisoned' }[t.st] || 'statused') : ''}</div>
      <div class="moves">${t.mv.map(id => moveChip(id)).join('')}</div>`;
  }
  function answerHTML(a) {
    const m = a.m;
    const who = esc(monName(a.r));
    if (!m.best) return `<div class="answer"><div class="top"><b>${who}</b>${verdictBadge(m)}</div><span class="small muted">No damaging moves entered.</span></div>`;
    const hits = m.toKOthem === 1 ? 'one hit' : isFinite(m.toKOthem) ? `${m.toKOthem} hits` : 'can’t KO';
    const threat = m.threat ? `takes ${esc(m.threat.moveName)} up to ${pct(m.threat.maxPct)}% (crit ${pct(m.threat.critMaxPct)}%)` : 'they have no damaging move';
    return `<div class="answer"><div class="top"><b>${who}</b>${verdictBadge(m)}<span class="muted small">${m.meFirst ? 'moves first' : 'moves second'} · Spe ${m.mySpeed} vs ${m.theirSpeed}</span></div>
      <div class="small"><span class="num">${esc(m.best.moveName)} ${pct(m.best.minPct)}–${pct(m.best.maxPct)}%</span> (${hits})${m.accRisk ? ` · ${m.accRisk}% accurate` : ''}; ${threat}${m.weather ? ` · ${esc(m.weather)}` : ''}</div>
      ${m.best.notes.length ? `<div class="notes">${m.best.notes.map(esc).join('<br>')}</div>` : ''}</div>`;
  }
  let planCache = { key: '', plan: null };
  function renderPlan() {
    if (S.planBoss == null) S.planBoss = nextBoss();
    const b = D.bosses[S.planBoss];
    if (b.route) b.cap = capNow();
    const roster = alive();
    let html = `<section class="section">
      <div class="field"><label for="plan-boss">Boss</label><select id="plan-boss" class="inline">${bossOptions(S.planBoss)}</select></div>
      <div class="row small"><span class="pill cap">Cap ${b.cap}</span>${b.ms ? `<span class="pill">Win: cap rises to ${b.capAfter}</span>` : ''}${b.dbl ? '<span class="pill warn">Double battle</span>' : ''}
        <span class="grow"></span><button class="btn small" id="plan-beaten" ${S.example ? 'disabled' : ''}>${S.run.beaten.includes(b.i) ? 'Mark as not beaten' : 'Mark as beaten'}</button></div>
    </section>`;
    if (!roster.length) {
      html += `<div class="empty">Add your Pokémon on the Team tab and the Coach will plan this fight.<button class="btn" id="plan-ex">Try an example team</button></div>`;
      html += `<section class="section"><h2>Their team</h2>${D.bosses[S.planBoss].party.map((_, j) => `<div class="card">${theirSetHTML(E.bossTeam(S.planBoss, b.cap)[j])}</div>`).join('')}</section>`;
      main.innerHTML = html; wirePlan(); return;
    }
    main.innerHTML = html + '<div class="empty">Working out every matchup…</div>';
    wirePlan();
    setTimeout(() => {
      const key = JSON.stringify([S.planBoss, roster.map(r => [r.key, r.s, r.lv, r.nat, r.ab, r.it, r.mv, r.box])]);
      if (planCache.key !== key) planCache = { key, plan: E.planBoss(S.planBoss, roster.map(r => specOf(r)), party().map(r => r.key)) };
      const P = planCache.plan;
      let out = html;
      out += battlePlanHTML(key, P);
      out += `<section class="section"><h2>Their team and your answers</h2><p class="note" style="margin:0">One-on-one numbers for each of their Pokémon, with your best three answers.</p>${P.team.map((t, j) => {
        const top = P.answers[j].slice(0, 3);
        const none = top.every(a => a.m.verdict === 'lose');
        return `<div class="card">${theirSetHTML(t)}<div class="answers">${top.map(answerHTML).join('')}</div>${none ? '<div class="banner">Nothing in your team beats this one safely. Look for a Pokémon that resists its moves or outspeeds and hits it super-effectively.</div>' : ''}</div>`;
      }).join('')}</section>`;
      out += `<details class="more"><summary>Full matchup grid</summary><div class="tablewrap" style="margin-top:8px"><table class="grid"><thead><tr><th></th>${P.team.map(t => `<th>${esc(E.sp(t.s).n)}</th>`).join('')}</tr></thead><tbody>${
        roster.map((r, i) => `<tr><th>${esc(monName(r))}</th>${P.grid[i].map(m => {
          const cls = { safe: 'v-safe', ok: 'v-ok', risky: 'v-risky', lose: 'v-lose' }[m.verdict];
          const label = m.verdict === 'safe' ? 'safe' : m.verdict === 'lose' ? 'loses' : fmtRisk(m.risk);
          return `<td class="${cls}">${label}</td>`;
        }).join('')}</tr>`).join('')}</tbody></table></div></details>`;
      out += `<section class="section" id="items-sec"><details class="more" ${S.itemsOpen ? 'open' : ''} id="items-det"><summary>Held items for this fight</summary><div class="card" style="margin-top:8px" id="items-out">
        <p class="small" style="margin:0">Tries every held item you have (ticked on the Party tab, plus what your Pokémon already hold) on each Pokémon you'd bring, keeps the swaps that win or save matchups against this team, then simulates the fight before and after.</p>
        <div class="row"><button class="btn" id="items-go" ${(S.run.bag || []).length || S.roster.some(m => m.it) ? '' : 'disabled'}>Suggest held items</button>${(S.run.bag || []).length ? '' : '<span class="note">Tick the items you have on the Party tab first.</span>'}</div></div></details></section>`;
      out += movesetSection(P);
      out += claudeSection();
      main.innerHTML = out;
      wirePlan(P);
    }, 30);
  }
  // ---------------- the simulated battle plan ----------------
  function planInputs() {
    const roster = alive();
    const top = Math.max(1, ...(party().length ? party() : roster).map(m => m.lv));
    const team = E.bossTeam(S.planBoss, top).map((t, i) => Object.assign({ key: 'b' + i, label: E.sp(t.s).n }, t));
    return { roster, specs: roster.map(r => specOf(r, { label: monName(r) })), team, top };
  }
  function riskBadge(r) { return verdictBadge({ verdict: r <= 1e-9 ? 'safe' : r <= 0.05 ? 'ok' : r <= 0.35 ? 'risky' : 'lose', risk: r }); }
  function battlePlanHTML(key) {
    const res = S.plans[key];
    const running = S.planning && S.planning.key === key;
    let h = `<section class="section" id="bp"><div class="head"><h2>Battle plan</h2><span class="muted small">Simulated with your Pokémon</span></div>`;
    if (!res) {
      h += `<div class="card"><p class="small" style="margin:0">The Coach plays this fight hundreds of times with your Pokémon and the boss's exact team. It picks your six and your lead, then writes the turn-by-turn plan: what to click, when to switch, and any sacrifice the plan needs. Takes about 10–40 seconds on a phone.</p>
        ${running ? `<div class="progress"><span style="width:${Math.round(100 * S.planning.frac)}%"></span></div><div class="note" id="bp-status">${esc(S.planning.text || 'Starting…')}</div>` : '<div class="row"><button class="btn primary" id="bp-go">Plan this fight</button></div>'}</div></section>`;
      return h;
    }
    const o = res.odds, roster = res.roster;
    const verdict = o.pNoLoss >= 0.9 ? 'Solid plan: you win without losing anyone in almost every simulated battle.'
      : o.pNoLoss >= 0.6 ? 'Workable, but things go wrong often enough to matter. Look at the dangers below.'
      : o.pWin >= 0.5 ? 'You usually win, but you usually lose a Pokémon doing it.'
      : 'Your team isn’t ready for this fight yet. Train, catch an answer to the dangers below, or rework movesets.';
    h += `<div class="card rec"><div class="odds">
        <div><span class="big">${Math.round(100 * o.pNoLoss)}%</span><span class="lbl">win, no losses</span></div>
        <div><span class="big">${Math.round(100 * o.pWin)}%</span><span class="lbl">win</span></div>
        <div><span class="big">${o.expLosses.toFixed(1)}</span><span class="lbl">Pokémon lost on average</span></div></div>
      <p class="small" style="margin:0">${esc(verdict)}</p>
      <div class="lbl">Bring${res.doubles ? ' (double battle: your first two lead)' : ''}</div><div class="lineup">${res.lineup.map(i => { const isLead = [].concat(res.lead).includes(i); return `<span class="pick ${isLead ? 'lead' : ''}">${icon(roster[i].s)}${isLead ? 'Lead: ' : ''}${esc(monName(roster[i]))}</span>`; }).join('')}</div>
      ${res.doubles ? '<p class="small" style="margin:0">Put the two leads first in your party. Each turn below lists both of your moves and who to aim them at.</p>' : ''}
      <p class="note" style="margin:0">From ${o.runs} simulated battles against the boss AI ported from Radical Red's engine: the same move scores, fighting styles, targeting and switching rules.</p>
      <div class="row"><button class="btn small" id="bp-redo">Plan again</button></div></div>`;
    const causes = Object.entries(o.causes).sort((a, b) => b[1] - a[1]).slice(0, 4);
    if (causes.length) h += `<div class="card"><h3>What can go wrong</h3>${causes.map(([k, n]) => `<div class="small">${esc(k)} <span class="muted">· ${Math.round(100 * n / o.runs)}% of battles</span></div>`).join('')}</div>`;
    const sc = res.script;
    h += `<details class="more" open><summary>Turn by turn: the most likely way it goes</summary><ol class="script">${sc.turns.map(t => {
      const d = t.decision;
      const lines = t.lines.filter(l => !/^(Your|Boss) .* uses /.test(l.text) || true).map(l => `<div class="${l.kind === 'faint' ? 'ev faint' : l.kind === 'crit' ? 'ev crit' : 'ev'}">${esc(l.text)}</div>`).join('');
      if (!d) return `<li class="turn start"><div class="t-head"><b>Start</b></div>${lines}</li>`;
      return `<li class="turn ${t.sacrifice ? 'sac' : ''}"><div class="t-head"><b>Turn ${t.turn}</b> · your ${esc(d.you)} (${Math.round(100 * d.youHp)}%) vs their ${esc(d.foe)} (${Math.round(100 * d.foeHp)}%)</div>
        ${d.lines ? `<div class="t-do" style="display:grid;gap:2px">${d.lines.map(l => `<span>${esc(l)}</span>`).join('')}</div>` : `<div class="t-do">${esc(d.action)} ${riskBadge(d.risk || 0)}</div>`}
        ${t.sacrifice ? `<div class="banner">Planned sacrifice: ${esc(t.sacrifice)} is expected to faint here. Every other option was riskier for the rest of your team; its fall gives your next Pokémon a free switch-in.</div>` : ''}
        <div class="t-lines">${lines}</div></li>`;
    }).join('')}</ol>
    <p class="note">${sc.winner === 'p' ? `Ends in a win on turn ${sc.totalTurns}.` : sc.winner === 'a' ? 'In this line the boss wins.' : 'This line stalls out.'} Risk on each turn is the chance that the Pokémon you have in faints before it wins its fight. When something unexpected happens (a crit, a miss, a different move), use the Battle tab: it plans the next move from wherever you are.</p></details></section>`;
    return h;
  }
  // ---------------- planning in a background worker (falls back to the page if workers are blocked) ----------------
  let planWorker = null, workerBroken = false, workerSeq = 0;
  function planInBackground(specs, team, opts) {
    const { onProgress, ...rest } = opts || {};
    const onPage = () => SIM.planFight(specs, team, opts);
    if (workerBroken || typeof Worker === 'undefined') return onPage();
    return new Promise(resolve => {
      try { if (!planWorker) planWorker = new Worker('worker.js'); } catch (e) { workerBroken = true; resolve(onPage()); return; }
      const id = ++workerSeq;
      let started = false, done = false;
      const fallback = () => {
        if (done) return; done = true; workerBroken = true;
        try { planWorker.terminate(); } catch (e) { /* already gone */ }
        planWorker = null; resolve(onPage());
      };
      const timer = setTimeout(() => { if (!started) fallback(); }, 25000);
      planWorker.onmessage = ev => {
        const m = ev.data; if (!m || m.id !== id || done) return;
        started = true;
        if (m.error) { clearTimeout(timer); fallback(); }
        else if (m.result) { clearTimeout(timer); done = true; resolve(m.result); }
        else if (onProgress) onProgress(m.progress, m.text);
      };
      planWorker.onerror = () => { clearTimeout(timer); fallback(); };
      planWorker.postMessage({ id, specs, team, opts: rest });
    });
  }
  async function runPlan(key) {
    if (S.planning) return;
    const { roster, specs, team } = planInputs();
    S.planning = { key, frac: 0, text: 'Starting…' };
    render();
    try {
      const res = await planInBackground(specs, team, { doubles: !!D.bosses[S.planBoss].dbl, onProgress: (frac, text) => {
        S.planning.frac = frac; S.planning.text = text;
        const bar = document.querySelector('#bp .progress span'); if (bar) bar.style.width = Math.round(100 * frac) + '%';
        const st = $('#bp-status'); if (st) st.textContent = text;
      } });
      S.plans[key] = Object.assign(res, { roster });
    } catch (e) {
      flash('Planning failed: ' + (e && e.message ? e.message : e));
    } finally {
      S.planning = null;
      if (S.tab === 'plan') render();
    }
  }
  function movesetSection(P) {
    const p = party(); if (!p.length) return '';
    return `<details class="more"><summary>Moveset ideas for this fight</summary><div class="section" style="margin-top:8px">${p.map(m => {
      const now = E.suggestMoves(specOf(m), S.planBoss, P.top, false);
      const tm = E.suggestMoves(specOf(m), S.planBoss, P.top, true);
      const list = sug => sug.picked.length ? sug.picked.map(x => moveChip(x.id, x.how)).join('') : '<span class="muted small">No damaging moves found.</span>';
      const tmOnly = tm.picked.filter(x => /^[TH]M/.test(x.how));
      return `<div class="card"><div class="mon-head"><span class="mon-name">${esc(monName(m))}</span><span class="lv">Lv ${m.lv}</span></div>
        <div class="lbl">Best from level-up moves (Move Relearner)</div><div class="moves">${list(now)}</div>
        ${tmOnly.length ? `<div class="lbl">If you have the TM</div><div class="moves">${tmOnly.map(x => { const t = /^TM(\d+)/.test(x.how) ? +x.how.slice(2) - 1 : /^HM(\d+)/.test(x.how) ? 119 + +x.how.slice(2) : null; return moveChip(x.id, x.how + (t != null && tmWhere(t, 2) ? ' · ' + tmWhere(t, 2) : '')); }).join('')}</div>` : ''}</div>`;
    }).join('')}<p class="note">Picked to cover the most of this boss team with guaranteed damage, accuracy included. Hardcore-banned moves are left out.</p></div></details>`;
  }
  function claudeSection() {
    return `<section class="section" id="claude-sec" hidden><div class="head"><h2>Game plan from Claude</h2></div>
      <div class="card"><p class="note" style="margin:0">Claude turns the calculations above into a written plan. It only sees these numbers, so check anything surprising in the Battle tab.</p>
      <div class="row"><button class="btn primary" id="claude-go">Write a game plan</button><button class="btn" id="claude-stop" hidden>Stop</button></div>
      <div class="claude-out" id="claude-out" hidden></div></div></section>`;
  }
  async function runItemAdvice() {
    const box = $('#items-out'); if (!box) return;
    const plan = Object.entries(S.plans).find(([k, v]) => v && JSON.parse(k)[0] === S.planBoss);
    const roster = alive();
    const lineup = plan ? plan[1].lineup.map(i => plan[1].roster[i]) : (party().length ? party() : roster.slice(0, 6));
    const b = D.bosses[S.planBoss];
    const top = Math.max(1, ...lineup.map(m => m.lv));
    const team = E.bossTeam(S.planBoss, top).map((t, i) => Object.assign({ key: 'b' + i, label: E.sp(t.s).n }, t));
    box.innerHTML = '<div class="progress"><span style="width:2%"></span></div><div class="note">Trying each item on each Pokémon…</div>';
    const bar = () => box.querySelector('.progress span');
    const r = await itemAdvice(lineup, team, !!b.dbl, f => { const el = bar(); if (el) el.style.width = Math.round(100 * f) + '%'; });
    if (!r.assigned.length) { box.innerHTML = `<p class="small" style="margin:0">None of your ${r.candidates} held items changes a matchup here. Keep what they hold.</p>`; return; }
    const odds = (o) => `${Math.round(100 * o.pNoLoss)}% no losses, ${Math.round(100 * o.pWin)}% win`;
    box.innerHTML = `<div class="answers">${r.assigned.map(x => `<div class="answer"><div class="top">${icon(x.m.s)}<b>${esc(monName(x.m))}</b> holds <b>${esc(E.itemName(x.it))}</b></div>
        <span class="small muted">${x.from ? 'instead of ' + esc(E.itemName(x.from)) + ' · ' : ''}+${x.g.toFixed(1)} matchup points</span></div>`).join('')}</div>
      ${r.before && r.after ? `<p class="small" style="margin:0">Simulated fight (40 battles each): now ${odds(r.before)} → with these items ${odds(r.after)}.</p>` : ''}
      <div class="row"><button class="btn primary" id="items-apply">Give them these items</button><span class="note">Updates your Pokémon's items; plan the fight again afterwards.</span></div>`;
    $('#items-apply').onclick = async () => {
      for (const x of r.assigned) { const m = S.roster.find(y => y.key === x.m.key); if (m) { m.it = x.it; await store.saveMon(m); } }
      flash('Items updated. Plan the fight again to see the new odds.'); render();
    };
  }
  async function wirePlan(P) {
    const ig = $('#items-go'); if (ig) ig.onclick = () => runItemAdvice();
    const idt = $('#items-det'); if (idt) idt.addEventListener('toggle', () => { S.itemsOpen = idt.open; });
    const sel = $('#plan-boss'); if (sel) sel.onchange = () => { S.planBoss = +sel.value; S.battle.boss = S.planBoss; render(); };
    const ex = $('#plan-ex'); if (ex) ex.onclick = () => { loadExample(); };
    const bt = $('#plan-beaten');
    if (bt) bt.onclick = async () => {
      const i = S.planBoss;
      const group = variantsOf(i);
      S.run.beaten = S.run.beaten.includes(i) ? S.run.beaten.filter(x => !group.includes(x)) : Array.from(new Set(S.run.beaten.concat(group)));
      if (S.run.beaten.includes(i)) S.planBoss = nextBoss();
      render(); await store.saveRun();
    };
    if (!P) return;
    const key = JSON.stringify([S.planBoss, alive().map(r => [r.key, r.s, r.lv, r.nat, r.ab, r.it, r.mv, r.box])]);
    const go = $('#bp-go'); if (go) go.onclick = () => runPlan(key);
    const redo = $('#bp-redo'); if (redo) redo.onclick = () => { delete S.plans[key]; runPlan(key); };
    const sample = await claudeSample();
    const sec = $('#claude-sec'); if (!sec) return;
    if (!sample) return;
    sec.hidden = false;
    let ctl = null;
    $('#claude-go').onclick = async () => {
      const out = $('#claude-out'); out.hidden = false; out.textContent = 'Thinking…';
      ctl = new AbortController();
      $('#claude-stop').hidden = false; $('#claude-go').disabled = true;
      try {
        await sample(planPrompt(P), { signal: ctl.signal, onText: ({ text }) => { out.textContent = text; } });
      } catch (e) {
        if (e.code === 'not_granted' || e.code === 'sampling_disabled') { sec.hidden = true; }
        else if (e.code !== 'cancelled') out.textContent = (e.text ? e.text + '\n\n' : '') + (e.code === 'rate_limited' ? 'Claude is busy or your usage limit is reached. Try again later.' : 'The plan was interrupted. Try again.');
      } finally { $('#claude-stop').hidden = true; $('#claude-go').disabled = false; }
    };
    $('#claude-stop').onclick = () => ctl && ctl.abort();
  }
  let samplePromise = null;
  function claudeSample() {
    if (!samplePromise) samplePromise = (window.claude && claude.use) ? claude.use('sample').catch(() => null) : Promise.resolve(null);
    return samplePromise;
  }
  function setLine(t) {
    const s = E.sp(t.s);
    return `${s.n} Lv ${t.lv}, ${t.ab}, ${E.itemName(t.it) || 'no item'}, ${D.natures[t.nat].n}; moves: ${(t.mv || []).map(id => E.mv(id).f).join(', ')}`;
  }
  function planPrompt(P) {
    const b = D.bosses[S.planBoss];
    const roster = alive();
    const lines = [];
    lines.push('You are coaching a hardcore nuzlocke of Pokémon Radical Red 4.1 in Hardcore Mode. Rules: a fainted Pokémon is gone for good; no items in battle; set mode (no free switch after a KO); level caps. The boss AI leads with its first Pokémon and, after each KO, sends whichever of its Pokémon it judges best.');
    lines.push(`\nBoss: ${b.n} (${b.cls})${b.dbl ? ', double battle (the numbers below treat it as singles)' : ''}. Level cap ${b.cap}.`);
    lines.push('Their team in order:');
    P.team.forEach((t, j) => lines.push(`${j + 1}. ${setLine(t)}`));
    lines.push('\nThe player\'s available Pokémon:');
    roster.forEach(r => lines.push(`- ${monName(r)}: ${setLine(r)}${r.box === 'party' ? ' (in party)' : ' (in box)'}`));
    lines.push('\nCalculated 1-on-1 matchups (Smogon damage calculator fed with the ROM\'s real stats; "risk" = chance the player\'s Pokémon faints before winning, assuming the boss uses its strongest move every turn and counting every roll, crit, multi-hit count and miss):');
    P.team.forEach((t, j) => {
      lines.push(`vs ${E.sp(t.s).n}:`);
      P.answers[j].slice(0, 4).forEach(a => {
        const m = a.m;
        if (!m.best) return;
        lines.push(`  ${monName(a.r)}: ${m.verdict === 'safe' ? 'safe (0% risk)' : m.verdict === 'lose' ? 'loses' : fmtRisk(m.risk) + ' risk'}; ${m.best.moveName} ${pct(m.best.minPct)}-${pct(m.best.maxPct)}% per hit, KO in ${isFinite(m.toKOthem) ? m.toKOthem : 'never'}; takes ${m.threat ? m.threat.moveName + ' up to ' + pct(m.threat.maxPct) + '% (crit ' + pct(m.threat.critMaxPct) + '%)' : 'nothing'}; ${m.meFirst ? 'moves first' : 'moves second'}${m.weather ? '; weather ' + m.weather : ''}`);
      });
    });
    lines.push(`\nCalculator's suggested six: ${P.chosen.map(i => monName(roster[i])).join(', ')}; lead ${monName(roster[P.lead])}.`);
    const key = JSON.stringify([S.planBoss, roster.map(r => [r.key, r.s, r.lv, r.nat, r.ab, r.it, r.mv, r.box])]);
    const sim = S.plans[key];
    if (sim) {
      const o = sim.odds;
      lines.push(`\nSimulated plan (${o.runs} battles against the boss AI ported from the game's engine${sim.doubles ? ', double battle' : ''}): win with no losses ${Math.round(100 * o.pNoLoss)}%, win ${Math.round(100 * o.pWin)}%, average losses ${o.expLosses.toFixed(1)}. Lineup: ${sim.lineup.map(i => monName(sim.roster[i])).join(', ')}; lead ${[].concat(sim.lead).map(i => monName(sim.roster[i])).join(' and ')}.`);
      lines.push('Most likely line, turn by turn:');
      for (const t of sim.script.turns) if (t.decision) lines.push(`  Turn ${t.turn}: ${t.decision.you} vs ${t.decision.foe}: ${t.decision.action} (risk ${fmtRisk(t.decision.risk || 0)})${t.sacrifice ? ' [planned sacrifice]' : ''}`);
      lines.push('Most common ways it goes wrong: ' + Object.entries(o.causes).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => `${k} (${Math.round(100 * n / o.runs)}%)`).join('; '));
    }
    lines.push('\nWrite a concise game plan in plain text (no markdown tables, under 250 words): which six to bring and why, the lead, how to handle each of their Pokémon, and the two biggest dangers. Use only the numbers above and never invent damage numbers. If nothing beats one of their Pokémon safely, say so plainly and suggest what kind of Pokémon or move would fix it.');
    return lines.join('\n');
  }

  // ---------------- BATTLE ----------------
  // ---------------- BATTLE: live mode, turn by turn, with the AI check ----------------
  function renderBattle() {
    const mode = S.battleMode || 'live';
    const head = `<div class="row"><span class="seg" role="group" aria-label="Battle mode"><button data-bmode="live" aria-pressed="${mode === 'live'}">Live battle</button><button data-bmode="whatif" aria-pressed="${mode !== 'live'}">Quick check</button></span>
      <span class="note">${mode === 'live' ? 'Play the fight turn by turn: the Coach keeps track and re-plans.' : 'Any one-on-one, set up by hand.'}</span></div>`;
    if (mode === 'live') renderLive(head); else renderWhatIf(head);
    main.querySelectorAll('[data-bmode]').forEach(b => b.onclick = () => { S.battleMode = b.dataset.bmode; render(); });
  }
  const pctOf = m => Math.round(100 * m.hp / m.maxHp);
  function liveStart(bi, lead) {
    const b = D.bosses[bi];
    const doubles = !!b.dbl;
    const mine = party().length ? party() : alive();
    const specs = mine.map(m => specOf(m, { label: monName(m) }));
    const top = Math.max(...mine.map(m => m.lv));
    const bossSpecs = E.bossTeam(bi, top).map((t, i) => Object.assign({ key: 'b' + i, label: E.sp(t.s).n }, t));
    const st = SIM.newBattle(specs, bossSpecs, { doubles, lead, record: true });
    st.policies = { p: doubles ? SIM.doublesPlanner() : SIM.plannerPolicy(), a: SIM.bossPolicy() };
    SIM.begin(st, SIM.expectedDice());
    S.live = { bi, doubles, st, step: 'choose', turns: [], checks: [], next: null, pred: null };
  }
  function actionLabel(st, side, a) {
    if (!a) return '—';
    if (a.type === 'switch') return `switch to ${st[side].team[a.to].name}`;
    const m = E.mv(a.id);
    const t = a.target && st.size > 1 && (m || {}).tg === 0 ? (SIM.actives(st, a.target.side).find(x => x.slot === a.target.slot) || {}).name : null;
    return `${a.z ? 'Z-' : ''}${m ? m.f : '?'}${t ? ' on ' + t : ''}`;
  }
  /** Options for one battler: its usable moves (and Z-Move), switches, and targets in doubles. */
  function actionSelect(st, side, slot, chosen, idp) {
    const m = SIM.actives(st, side).find(x => x.slot === slot);
    const opts = [];
    const moves = side === 'p' ? SIM.usable(m, st) : m.moves;
    for (const id of moves) {
      const mv = E.mv(id); if (!mv) continue;
      opts.push([`m:${id}`, mv.f]);
      if (side === 'p' && SIM.zKind(st, m, id) === 'type') opts.push([`z:${id}`, `Z-${mv.f} (Z-Move)`]);
    }
    st[side].team.forEach((x, i) => { if (!x.fainted && !st[side].slots.includes(i)) opts.push([`s:${i}`, `Switch to ${x.name}`]); });
    const cur = chosen ? (chosen.type === 'switch' ? `s:${chosen.to}` : `${chosen.z ? 'z' : 'm'}:${chosen.id}`) : '';
    const foes = SIM.actives(st, side === 'p' ? 'a' : 'p');
    const tSel = st.size > 1 && foes.length > 1 ? `<select class="inline" id="${idp}-t" style="width:auto">${foes.map(f => `<option value="${f.slot}" ${chosen && chosen.target && chosen.target.slot === f.slot ? 'selected' : ''}>on ${esc(f.name)}</option>`).join('')}</select>` : '';
    return `<div class="row" style="gap:6px">${icon(m.spec.s)}<b class="small" style="min-width:5.5em">${esc(m.name)}</b><select class="inline" id="${idp}" style="width:auto;max-width:100%" data-hastarget="${tSel ? 1 : 0}">${opts.map(([v, l]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>${tSel}</div>`;
  }
  function readAction(st, side, slot, idp) {
    const v = ($('#' + idp) || {}).value || '';
    const [k, x] = v.split(':');
    if (k === 's') return { type: 'switch', to: +x, why: 'switch' };
    const foeSide = side === 'p' ? 'a' : 'p';
    const tEl = $('#' + idp + '-t');
    const foes = SIM.actives(st, foeSide);
    const tslot = tEl ? +tEl.value : (foes[0] ? foes[0].slot : 0);
    return { type: 'move', id: +x, z: k === 'z', target: { side: foeSide, slot: tslot } };
  }
  function renderLive(head) {
    const pp = party().length ? party() : alive();
    if (!pp.length) { main.innerHTML = head + '<div class="empty">Add your Pokémon on the Party tab first.</div>'; return; }
    if (!S.live) {
      const bi = S.battle.boss != null ? S.battle.boss : (S.planBoss != null ? S.planBoss : nextBoss());
      const b = D.bosses[bi];
      const n = b.dbl ? 2 : 1;
      main.innerHTML = head + `<section class="section"><div class="card rec">
        <div class="field"><label for="lv-boss">Fight</label><select id="lv-boss" class="inline">${bossOptions(bi)}</select></div>
        <div class="lbl">${b.dbl ? 'Your two leads (double battle)' : 'Your lead'}</div>
        <div class="chips">${pp.map((m, i) => `<button class="chipbtn" data-lead="${i}" aria-pressed="${(S.liveLead || [0, 1].slice(0, n)).includes(i)}">${icon(m.s)}${esc(monName(m))}</button>`).join('')}</div>
        <p class="small" style="margin:0">Each turn the Coach recommends your move${n > 1 ? 's' : ''} and shows what the boss AI will most likely do. Then tell it what actually happened: it fills in its prediction, so usually you only nudge the HP bars. It re-plans from there, and it keeps score of how often the boss AI did what it predicted.</p>
        <div class="row"><button class="btn primary" id="lv-start">Start the battle</button></div></div></section>`;
      $('#lv-boss').onchange = e => { S.battle.boss = +e.target.value; S.liveLead = null; render(); };
      main.querySelectorAll('[data-lead]').forEach(btn => btn.onclick = () => {
        const i = +btn.dataset.lead; let cur = (S.liveLead || [0, 1].slice(0, n)).slice();
        cur = cur.includes(i) ? cur.filter(x => x !== i) : cur.concat(i).slice(-n);
        S.liveLead = cur.length ? cur : [i]; render();
      });
      $('#lv-start').onclick = () => { const lead = (S.liveLead || [0, 1]).slice(0, n); liveStart(bi, n > 1 ? lead : lead[0]); render(); };
      return;
    }
    const L = S.live, st = L.st, b = D.bosses[L.bi];
    const slotRow = side => SIM.actives(st, side).map(m => `<div class="side">${front(m.spec.s, side === 'p' ? 'flip' : '')}<div class="plate"><b>${esc(m.name)}</b><span class="small">Lv ${m.spec.lv}${m.status ? ' · ' + esc(m.status.toUpperCase()) : ''}</span>${hpBar(pctOf(m))}</div></div>`).join('');
    const arena = st.size > 1
      ? `<div class="arena" style="grid-template-columns:1fr 1fr">${slotRow('a')}</div><div class="arena" style="grid-template-columns:1fr 1fr">${slotRow('p')}</div>`
      : `<div class="arena">${slotRow('p')}${slotRow('a')}</div>`;
    let html = head + `<section class="section"><div class="row"><h2 class="grow">vs ${esc(b.n)} · turn ${st.turn + 1}</h2><button class="btn small ghost" id="lv-end">End battle</button></div>${arena}`;
    if (st.over) {
      const won = st.winner === 'p';
      const fallen = st.p.team.filter(m => m.fainted);
      const n = L.checks.length, ok = L.checks.filter(c => c.ok).length;
      html += `<div class="card rec"><h3>${won ? 'You won!' : 'The battle is over.'}</h3>
        <p class="small" style="margin:0">The boss AI did what the Coach predicted ${ok} of ${n} time${n === 1 ? '' : 's'}.</p>
        ${fallen.length ? `<p class="small" style="margin:0">Fainted: ${fallen.map(m => esc(m.name)).join(', ')}.</p>` : ''}
        <div class="row">${won && !S.run.beaten.includes(L.bi) && !b.route ? `<button class="btn primary" id="lv-beaten">Mark ${esc(b.n)} as beaten</button>` : ''}
          ${fallen.length && !S.example ? `<button class="btn" id="lv-dead">Mark ${fallen.length} fainted Pokémon as dead</button>` : ''}
          <button class="btn ghost" id="lv-close">Close</button></div></div>`;
    } else if (L.step === 'choose') {
      // recommendation and the AI's likely move
      let recs, pred, alts = '';
      if (L.doubles) {
        const d = st.policies.p.decide(st, 'p');
        recs = d.acts; pred = d.ai;
        alts = d.alts.slice(1).map(x => `<div class="small muted">or: ${x.combo.map(a => esc(actionLabel(st, 'p', a))).join(' + ')}</div>`).join('');
      } else {
        const opts = st.policies.p.evaluate(st, 'p');
        recs = opts[0] ? [opts[0].type === 'switch' ? { type: 'switch', to: opts[0].to } : { type: 'move', id: opts[0].id, z: !!opts[0].z }] : [];
        pred = [st.policies.a.choose(st, 'a', SIM.expectedDice(), true, true)];
        alts = opts.slice(1, 3).map(x => `<div class="small muted">or: ${esc(x.label)} ${riskBadge(x.risk)}</div>`).join('');
      }
      L.pred = pred;
      const mine = SIM.actives(st, 'p'), theirs = SIM.actives(st, 'a');
      html += `<div class="card rec"><div class="lbl">Do this</div>
        ${mine.map((m, k) => `<h3>${esc(m.name)}: ${esc(actionLabel(st, 'p', recs[k]))}</h3>`).join('')}${alts}
        <p class="small" style="margin:0">The boss AI will most likely use: ${theirs.map((m, k) => `<b>${esc(m.name)}</b>: ${esc(actionLabel(st, 'a', pred[k]))}`).join('; ')}.</p></div>
        <div class="card"><div class="lbl">What happened this turn?</div>
          <div class="small muted">You used</div>${mine.map(m => actionSelect(st, 'p', m.slot, recs[mine.indexOf(m)], 'lvp' + m.slot)).join('')}
          <div class="small muted">They used</div>${theirs.map(m => actionSelect(st, 'a', m.slot, pred[theirs.indexOf(m)], 'lva' + m.slot)).join('')}
          <div class="row"><button class="btn primary" id="lv-play">Play the turn</button><span class="note">Pick a different move if the boss did something else: that's how the AI check learns.</span></div></div>`;
    } else if (L.step === 'check') {
      const nx = L.next;
      const row = (side, m) => `<div class="row" style="gap:6px;flex-wrap:nowrap">${icon(m.spec.s)}<span class="grow small"><b>${esc(m.name)}</b></span>
        <input type="number" min="0" max="100" inputmode="numeric" data-hp="${side}:${m.idx}" value="${pctOf(m)}" style="width:4.5em;padding:6px;border-radius:8px;border:1px solid var(--line);background:var(--surface)"><span class="small">%</span>
        <select class="inline" data-stat="${side}:${m.idx}" style="width:auto">${[['', 'OK'], ['par', 'PAR'], ['brn', 'BRN'], ['psn', 'PSN'], ['tox', 'TOX'], ['slp', 'SLP'], ['frz', 'FRZ']].map(([k, l]) => `<option value="${k}" ${m.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`;
      const onField = side => nx[side].slots.map(i => nx[side].team[i]).filter(Boolean);
      const changed = side => nx[side].team.filter(m => m.fainted && !st[side].team[m.idx].fainted || (!m.fainted && st[side].slots.includes(m.idx)));
      void changed;
      const slotPick = side => nx.size > 1 || nx[side].team.some(m => !m.fainted && !nx[side].slots.includes(m.idx)) ? nx[side].slots.map((idx, k) => `<div class="row small" style="gap:6px"><span>${side === 'p' ? 'Your' : 'Their'} ${nx.size > 1 ? (k ? 'right' : 'left') + ' ' : ''}Pokémon now:</span>
          <select class="inline" data-slot="${side}:${k}" style="width:auto">${nx[side].team.map((m, i) => `<option value="${i}" ${i === idx ? 'selected' : ''} ${m.fainted && i !== idx ? 'disabled' : ''}>${esc(m.name)}${m.fainted ? ' (fainted)' : ''}</option>`).join('')}</select></div>`).join('') : '';
      html += `<div class="card"><div class="lbl">Check the result</div>
        <p class="small" style="margin:0">This is what the Coach expects after that turn (middle damage rolls). Fix anything that's different in your game: HP as the bar shows it, status, and who's out.</p>
        ${L.lastLines.length ? `<div class="t-lines">${L.lastLines.map(l => `<div class="${l.kind === 'faint' ? 'ev faint' : 'ev'}">${esc(l.text)}</div>`).join('')}</div>` : ''}
        <div class="small muted">Yours</div>${onField('p').map(m => row('p', m)).join('')}${slotPick('p')}
        <div class="small muted">Theirs</div>${onField('a').map(m => row('a', m)).join('')}${slotPick('a')}
        <div class="row"><button class="btn primary" id="lv-confirm">Confirm and plan the next turn</button><button class="btn ghost" id="lv-back">Back</button></div></div>`;
    }
    const n = L.checks.length, ok = L.checks.filter(c => c.ok).length;
    if (n) html += `<p class="note">AI check this fight: ${ok} of ${n} boss moves predicted.${L.checks.filter(c => !c.ok).slice(-2).map(c => ` Turn ${c.turn}: ${esc(c.mon)} used ${esc(c.actual)}, not ${esc(c.predicted)}.`).join('')}</p>`;
    html += `</section>`;
    main.innerHTML = html;
    wireLive();
  }
  function wireLive() {
    const L = S.live; if (!L) return;
    const st = L.st;
    const end = $('#lv-end'); if (end) end.onclick = () => { if (end.dataset.armed) { S.live = null; render(); } else { end.dataset.armed = '1'; end.textContent = 'Confirm: end it'; end.classList.add('primary'); } };
    const close = $('#lv-close'); if (close) close.onclick = () => { S.live = null; render(); };
    const beaten = $('#lv-beaten'); if (beaten) beaten.onclick = async () => { S.run.beaten.push(L.bi); await store.saveRun(); beaten.remove(); flash('Marked as beaten.'); };
    const dead = $('#lv-dead'); if (dead) dead.onclick = async () => {
      const b = D.bosses[L.bi];
      for (const x of st.p.team.filter(m => m.fainted)) { const m = S.roster.find(r => r.key === x.key); if (m && m.box !== 'dead') { m.box = 'dead'; m.died = { at: Date.now(), before: b.n }; await store.saveMon(m); } }
      dead.remove(); flash('Marked as fainted.');
    };
    main.querySelectorAll('select[data-hastarget="1"]').forEach(sel => {
      const t = $('#' + sel.id + '-t');
      const sync = () => { if (t) t.hidden = sel.value.startsWith('s:'); };
      sel.addEventListener('change', sync); sync();
    });
    const play = $('#lv-play');
    if (play) play.onclick = () => {
      const mine = SIM.actives(st, 'p'), theirs = SIM.actives(st, 'a');
      const myActs = mine.map(m => readAction(st, 'p', m.slot, 'lvp' + m.slot));
      const theirActs = theirs.map(m => readAction(st, 'a', m.slot, 'lva' + m.slot));
      // the AI check: did the boss do what the ported AI predicted?
      theirs.forEach((m, k) => {
        const p = (L.pred || [])[k], a = theirActs[k];
        if (!p) return;
        const same = p.type === a.type && (a.type === 'switch' ? p.to === a.to : p.id === a.id);
        const c = { turn: st.turn + 1, boss: D.bosses[L.bi].n, mon: m.name, predicted: actionLabel(st, 'a', p), actual: actionLabel(st, 'a', a), ok: same, at: Date.now() };
        L.checks.push(c);
        const AC = S.run.aiChecks || (S.run.aiChecks = { n: 0, ok: 0, misses: [] });
        AC.n++; if (same) AC.ok++; else AC.misses = AC.misses.concat([c]).slice(-60);
      });
      if (!S.example) store.saveRun();
      // play it out with those actions to predict the result
      const nx = SIM.cloneState(st);
      nx.opts.record = true;
      const fixed = (acts, base) => ({ chooseAll: () => acts, choose: (s2, side, rng, e, pk, slot) => acts[SIM.actives(s2, side).findIndex(x => x.slot === slot)] || acts[0],
        replace: (s2, side, rng, why, slot) => base.replace(s2, side, rng, why, slot) });
      nx.policies = { p: fixed(myActs, st.policies.p), a: fixed(theirActs, st.policies.a) };
      const before = nx.log.length;
      SIM.playTurn(nx, SIM.expectedDice());
      L.lastLines = nx.log.slice(before);
      L.next = nx; L.step = 'check';
      render();
    };
    const back = $('#lv-back'); if (back) back.onclick = () => { L.step = 'choose'; L.next = null; render(); };
    const conf = $('#lv-confirm');
    if (conf) conf.onclick = () => {
      const nx = L.next;
      // who is in each slot now
      main.querySelectorAll('[data-slot]').forEach(sel => {
        const [side, k] = sel.dataset.slot.split(':'); const idx = +sel.value;
        if (nx[side].slots[+k] !== idx && !nx[side].team[idx].fainted) { nx[side].slots[+k] = idx; nx[side].team[idx].slot = +k; nx[side].team[idx].firstTurn = true; }
      });
      main.querySelectorAll('[data-hp]').forEach(inp => {
        const [side, i] = inp.dataset.hp.split(':'); const m = nx[side].team[+i];
        const pc = Math.max(0, Math.min(100, +inp.value));
        if (pc !== pctOf(m)) { m.hp = Math.round(m.maxHp * pc / 100); if (pc > 0 && m.hp === 0) m.hp = 1; }
        if (m.hp <= 0 && !m.fainted) { m.hp = 0; m.fainted = true; }
        if (m.hp > 0 && m.fainted) m.fainted = false;
      });
      main.querySelectorAll('[data-stat]').forEach(sel => { const [side, i] = sel.dataset.stat.split(':'); const m = nx[side].team[+i]; if (!m.fainted) m.status = sel.value; });
      nx.policies = st.policies;
      if (!SIM.actives(nx, 'a').length && !nx.a.team.some(m => !m.fainted)) { nx.over = true; nx.winner = 'p'; }
      else if (!nx.p.team.some(m => !m.fainted)) { nx.over = true; nx.winner = 'a'; }
      else { nx.over = false; nx.winner = null; }
      L.st = nx; L.next = null; L.step = 'choose';
      render(); window.scrollTo(0, 0);
    };
  }
  function stepper(side, stat, val) {
    return `<div class="b"><span>${STAT_LABEL[stat]}</span><span class="stepper"><button type="button" data-boost="${side}:${stat}:-1" aria-label="Lower ${STAT_LABEL[stat]}">−</button><span>${val > 0 ? '+' + val : val}</span><button type="button" data-boost="${side}:${stat}:1" aria-label="Raise ${STAT_LABEL[stat]}">+</button></span></div>`;
  }
  function renderWhatIf(head) {
    const B = S.battle;
    if (B.boss == null) B.boss = S.planBoss != null ? S.planBoss : nextBoss();
    const p = party().length ? party() : alive();
    if (!p.length) {
      main.innerHTML = head + `<div class="empty">Add your Pokémon on the Party tab first.<button class="btn" id="bt-ex">Try an example team</button></div>`;
      $('#bt-ex').onclick = loadExample; return;
    }
    if (!B.me || !p.some(m => m.key === B.me)) B.me = p[0].key;
    const top = Math.max(...p.map(m => m.lv));
    const team = E.bossTeam(B.boss, top);
    if (B.them >= team.length) B.them = 0;
    const meM = p.find(m => m.key === B.me);
    const meSpec = specOf(meM, { hpPct: B.meHp, boosts: B.meBoost, status: B.meStatus, entry: false });
    const themSpec = Object.assign({}, team[B.them], { hpPct: B.themHp, boosts: B.themBoost, status: B.themStatus || (team[B.them].st ? E.STATUS_CODE[team[B.them].st] : ''), entry: false });
    let weather = B.weather === 'auto' ? (E.WEATHER_SETTERS[themSpec.ab] || E.WEATHER_SETTERS[meSpec.ab] || E.teamWeather(team) || null) : (B.weather === 'none' ? null : B.weather);
    const statusSel = (id, v) => `<select id="${id}" class="inline">${[['', 'Healthy'], ['par', 'Paralyzed'], ['brn', 'Burned'], ['psn', 'Poisoned'], ['tox', 'Badly poisoned'], ['slp', 'Asleep'], ['frz', 'Frozen']].map(([k, l]) => `<option value="${k}" ${v === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    const arena = `<div class="arena"><div class="side">${front(meM.s, 'x2 flip')}<div class="plate"><b>${esc(monName(meM))}</b><span class="small">Lv ${meM.lv}</span>${hpBar(B.meHp)}</div></div>
      <div class="side">${front(team[B.them].s, 'x2')}<div class="plate"><b>${esc(E.sp(team[B.them].s).n)}</b><span class="small">Lv ${team[B.them].lv}</span>${hpBar(B.themHp)}</div></div></div>`;
    const quick = `<section class="section">
      <div class="field"><label for="bt-boss">Boss</label><select id="bt-boss" class="inline">${bossOptions(B.boss)}</select></div>
      ${arena}
      <div class="two">
      <div class="card"><div class="lbl">Their Pokémon</div><div class="chips">${team.map((t, j) => `<button class="chipbtn" data-them="${j}" aria-pressed="${j === B.them}">${icon(t.s)}${esc(E.sp(t.s).n)}</button>`).join('')}</div>
        <div class="field"><label for="bt-themhp">Their HP: ${B.themHp}%</label><input type="range" id="bt-themhp" min="1" max="100" value="${B.themHp}"></div></div>
      <div class="card"><div class="lbl">Your Pokémon</div><div class="chips">${p.map(m => `<button class="chipbtn" data-me="${esc(m.key)}" aria-pressed="${m.key === B.me}">${icon(m.s)}${esc(monName(m))}</button>`).join('')}</div>
        <div class="field"><label for="bt-mehp">Your HP: ${B.meHp}%</label><input type="range" id="bt-mehp" min="1" max="100" value="${B.meHp}"></div></div>
      </div></section>`;
    const changed = B.themStatus || B.meStatus || B.weather !== 'auto' || Object.values(B.themBoost).some(Boolean) || Object.values(B.meBoost).some(Boolean);
    const adjust = `<details class="more" id="bt-adjust" ${S.adjustOpen || changed ? 'open' : ''}><summary>Status, stat changes and weather${weather ? ' · ' + esc(weather) : ''}</summary>
      <div class="two" style="margin-top:8px">
      <div class="card"><div class="lbl">${esc(E.sp(themSpec.s).n)}</div><div class="row"><span class="lbl">Status</span>${statusSel('bt-themst', themSpec.status)}</div>
        <div class="boosts">${['atk', 'def', 'spa', 'spd', 'spe'].map(k => stepper('them', k, B.themBoost[k] || 0)).join('')}</div></div>
      <div class="card"><div class="lbl">${esc(monName(meM))}</div><div class="row"><span class="lbl">Status</span>${statusSel('bt-mest', B.meStatus)}</div>
        <div class="boosts">${['atk', 'def', 'spa', 'spd', 'spe'].map(k => stepper('me', k, B.meBoost[k] || 0)).join('')}</div></div>
      </div>
      <div class="row" style="margin-top:8px"><label class="lbl" for="bt-weather">Weather</label><select id="bt-weather" class="inline" style="width:auto">${[['auto', 'Auto (from abilities)'], ['none', 'None'], ['Sun', 'Sun'], ['Rain', 'Rain'], ['Sand', 'Sand'], ['Snow', 'Snow']].map(([k, l]) => `<option value="${k}" ${B.weather === k ? 'selected' : ''}>${l}</option>`).join('')}</select><button class="btn small ghost" id="bt-reset">Reset HP and changes</button></div>
    </details>`;
    let html = quick;
    // numbers
    const mySpe = E.speedOf(meSpec, weather), theirSpe = E.speedOf(themSpec, weather);
    const myRows = meSpec.mv.map(id => ({ id, d: E.damage(meSpec, themSpec, id, { weather }) }));
    const myHP = Math.max(1, Math.round(E.maxHP(meSpec) * B.meHp / 100));
    const theirRows = (themSpec.mv || []).map(id => {
      const d = E.damage(themSpec, meSpec, id, { weather, worst: true });
      const p1 = d ? E.faintChance(E.damageDist(themSpec, meSpec, id, weather, myHP), myHP, 1) : 0;
      return { id, d, p1 };
    });
    // options from the same planner the Plan tab simulates with: every attack, status or healing move, and every switch
    const mySpecs = p.map(m => specOf(m, { label: monName(m) }));
    const bossSpecs = team.map((t, i) => Object.assign({ key: 'b' + i, label: E.sp(t.s).n }, t));
    const live = SIM.newBattle(mySpecs, bossSpecs, {});
    live.p.active = p.findIndex(m => m.key === B.me); live.a.active = B.them;
    const lm = live.p.team[live.p.active], lf = live.a.team[live.a.active];
    lm.hp = Math.max(1, Math.round(lm.maxHp * B.meHp / 100)); lf.hp = Math.max(1, Math.round(lf.maxHp * B.themHp / 100));
    Object.assign(lm.boosts, B.meBoost); Object.assign(lf.boosts, B.themBoost);
    lm.status = B.meStatus; lf.status = themSpec.status; lm.firstTurn = false; lf.firstTurn = false;
    if (weather) { live.weather = weather; live.weatherTurns = 5; }
    live.policies = { p: SIM.plannerPolicy(), a: SIM.bossPolicy() };
    live.turn = 3; lf.enteredTurn = 0; lm.enteredTurn = 0;
    const options = live.policies.p.evaluate(live, 'p');
    const theirPick = live.policies.a.choose(live, 'a', SIM.expectedDice(), true, true);
    const theirText = theirPick.type === 'switch' ? `switch to ${esc(E.sp(team[theirPick.to].s).n)} (${esc(theirPick.why || '')})`
      : `${theirPick.z ? 'Z-' : ''}${esc(E.mv(theirPick.id) ? E.mv(theirPick.id).f : '—')}`;
    const why = theirPick.scores ? `<details class="more"><summary>Why the boss picks this</summary><div class="small" style="display:grid;gap:2px;margin-top:4px">${theirPick.scores.slice().sort((a, b) => b.score - a.score).map(x =>
      `<div><span class="num">${x.score}</span> ${esc(E.mv(x.id).f)}${x.why && x.why.length ? ' <span class="muted">(' + esc(x.why.join('; ')) + ')</span>' : ''}</div>`).join('')}
      <div class="note">Every move starts at 100; the highest score is used, ties at random. Fighting style: ${esc(SIM.AI.STYLE_NAMES[theirPick.style] || theirPick.style || '—')}.</div></div></details>` : '';
    const rec = options[0];
    html += `<section class="section"><div class="card rec"><div class="lbl">Do this</div><h3>${rec ? esc(rec.label) : 'No options'}${rec ? ' ' + riskBadge(rec.risk) : ''}</h3>
      <p class="small" style="margin:0">${mySpe > theirSpe ? 'You move first' : mySpe === theirSpe ? 'Speed tie: either can move first' : 'They move first'} (Spe ${mySpe} vs ${theirSpe}; priority moves go first). The boss AI's pick: <b>${theirText}</b>.${rec && rec.type === 'switch' ? ` Coming in costs about ${Math.round(rec.entryPct || 0)}% HP.` : ''}</p>${why}
      <div class="answers">${options.slice(0, 4).map(o => `<div class="answer"><div class="top"><b>${esc(o.label)}</b>${riskBadge(o.risk)}</div>${o.mu && o.mu.best ? `<span class="small num">${esc(o.mu.best.moveName)} ${pct(o.mu.best.minPct)}–${pct(o.mu.best.maxPct)}%, KO in ${isFinite(o.mu.toKOthem) ? o.mu.toKOthem : '∞'}</span>` : ''}</div>`).join('')}</div>
      <p class="note" style="margin:0">Risk = chance the Pokémon you'd have in faints before it wins this matchup, counting every roll, crit, multi-hit count and miss. Options are ranked by expected losses for your whole team, so sometimes the pick is a sacrifice that sets up a free switch.</p></div></section>`;
    html += adjust;
    html += `<section class="section"><h2>Your moves</h2><div class="card"><table class="moves-out"><thead><tr><th>Move</th><th>Damage</th><th>Result</th></tr></thead><tbody>${myRows.map(r => {
      const m = E.mv(r.id);
      if (!r.d) return `<tr><td>${esc(m.f)}</td><td class="n">status</td><td class="muted">—</td></tr>`;
      return `<tr><td>${esc(m.f)}<div class="note">${esc(r.d.type)} · ${m.a ? m.a + '% acc' : 'never misses'}</div></td><td class="n">${pct(r.d.minPct)}–${pct(r.d.maxPct)}%</td><td>${esc(r.d.ko.text || '')}${r.d.sashed ? '<div class="notes">Focus Sash / Sturdy: survives at 1 HP</div>' : ''}${r.d.notes.length ? `<div class="notes">${r.d.notes.map(esc).join('<br>')}</div>` : ''}</td></tr>`;
    }).join('')}</tbody></table></div></section>`;
    html += `<section class="section"><h2>Their moves on you</h2><div class="card"><table class="moves-out"><thead><tr><th>Move</th><th>Damage</th><th>KO you this turn</th></tr></thead><tbody>${theirRows.map(r => {
      const m = E.mv(r.id);
      if (!r.d) return `<tr><td>${esc(m.f)}</td><td class="n">status</td><td class="muted">—</td></tr>`;
      return `<tr><td>${esc(m.f)}<div class="note">${esc(r.d.type)} · ${m.a ? m.a + '% acc' : 'never misses'}${r.d.hits > 1 ? ' · up to ' + r.d.hits + ' hits' : ''}</div></td><td class="n">≤${pct(r.d.maxPct)}%<div class="note">crit ≤${pct(r.d.critMaxPct)}%</div></td><td class="n">${fmtRisk(r.p1)}</td></tr>`;
    }).join('')}</tbody></table>
    <p class="note" style="margin:0">Damage shown is the most a move can do (top roll, most hits). The KO column counts every roll, hit count, crit and miss.</p></div></section>`;
    html += realityHTML(meSpec, themSpec, weather, meM);
    main.innerHTML = head + html;
    wireBattle();
    wireReality(meSpec, themSpec, weather, meM);
  }
  // ---------------- reality check: does an observed hit match the numbers? ----------------
  function realityHTML(meSpec, themSpec, weather, meM) {
    const checks = S.run.checks || [];
    const bad = checks.filter(c => !c.ok);
    const opts = [...meSpec.mv.map(id => ['me:' + id, `Your ${monName(meM)}: ${E.mv(id).f}`]), ...(themSpec.mv || []).map(id => ['them:' + id, `Their ${E.sp(themSpec.s).n}: ${E.mv(id).f}`])]
      .filter(([k]) => E.mv(+k.split(':')[1]).k !== 'X');
    return `<section class="section"><details class="more" id="rc" ${S.rcOpen ? 'open' : ''}><summary>Reality check: did a hit match the numbers?</summary><div class="card check" style="margin-top:8px">
      <p class="small" style="margin:0">After a hit, enter how much HP it took (the bar's drop, in %). The Coach compares it with every possible roll for the current HP, boosts and weather above. A miss on the range points at something it doesn't know: an ability, item or effect.</p>
      <div class="fields"><div class="field wide"><label for="rc-move">Hit</label><select id="rc-move" class="inline">${opts.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></div>
        <div class="field"><label for="rc-pct">HP lost (%)</label><input id="rc-pct" type="number" min="0" max="100" inputmode="decimal"></div>
        <div class="field"><span class="lbl">Critical hit?</span><label class="row small" style="flex-wrap:nowrap;gap:6px;padding:8px 0"><input type="checkbox" id="rc-crit"> Yes, it was a crit</label></div></div>
      <div class="row"><button class="btn" id="rc-go">Check</button><span id="rc-out" class="small"></span></div>
      ${checks.length ? `<div class="note">${checks.length} checked so far, ${bad.length} outside the predicted range.${bad.slice(-3).map(c => ` ${esc(c.t)}`).join(';')}</div>` : ''}
    </div></details></section>`;
  }
  function wireReality(meSpec, themSpec, weather) {
    const rc = $('#rc'); if (!rc) return;
    rc.addEventListener('toggle', () => { S.rcOpen = rc.open; });
    const go = $('#rc-go'); if (!go) return;
    go.onclick = () => {
      const v = $('#rc-move').value; if (!v) return;
      const [side, id] = v.split(':');
      const obs = parseFloat($('#rc-pct').value); if (!isFinite(obs)) { $('#rc-out').textContent = 'Enter the HP it lost.'; return; }
      const crit = $('#rc-crit').checked;
      const att = side === 'me' ? meSpec : themSpec, def = side === 'me' ? themSpec : meSpec;
      const d = E.damage(att, def, +id, { weather });
      if (!d) return;
      const lo = crit ? d.critMinPct : d.minPct, hi = crit ? d.critMaxPct : d.maxPct;
      const ok = obs >= Math.floor(lo) - 1 && obs <= Math.ceil(hi) + 1;
      $('#rc-out').innerHTML = ok ? `<span class="verdict v-safe">matches</span> predicted ${pct(lo)}–${pct(hi)}%` : `<span class="verdict v-lose">outside</span> predicted ${pct(lo)}–${pct(hi)}%. Check the HP, boosts, weather and item above; if they're right, something isn't modeled.`;
      const t = `${E.sp(att.s).n} ${E.mv(+id).f} → ${E.sp(def.s).n}: saw ${obs}%, expected ${pct(lo)}–${pct(hi)}%${crit ? ' (crit)' : ''}`;
      S.run.checks = (S.run.checks || []).concat([{ t, ok, at: Date.now() }]).slice(-50);
      if (!S.example) store.saveRun();
    };
  }
  function wireBattle() {
    const B = S.battle;
    $('#bt-boss').onchange = e => { B.boss = +e.target.value; B.them = 0; B.themHp = 100; B.themBoost = {}; B.themStatus = ''; render(); };
    main.querySelectorAll('[data-them]').forEach(b => b.onclick = () => { B.them = +b.dataset.them; B.themHp = 100; B.themBoost = {}; B.themStatus = ''; render(); });
    main.querySelectorAll('[data-me]').forEach(b => b.onclick = () => { B.me = b.dataset.me; B.meHp = 100; B.meBoost = {}; B.meStatus = ''; render(); });
    main.querySelectorAll('[data-boost]').forEach(b => b.onclick = () => {
      const [side, stat, d] = b.dataset.boost.split(':'); const obj = side === 'me' ? B.meBoost : B.themBoost;
      obj[stat] = Math.max(-6, Math.min(6, (obj[stat] || 0) + +d)); render();
    });
    let t = null;
    const slider = (id, key) => { const el = $(id); el.oninput = () => { el.previousElementSibling.textContent = (key === 'meHp' ? 'Your' : 'Their') + ' HP: ' + el.value + '%'; clearTimeout(t); t = setTimeout(() => { B[key] = +el.value; render(); }, 150); }; };
    slider('#bt-themhp', 'themHp'); slider('#bt-mehp', 'meHp');
    $('#bt-themst').onchange = e => { B.themStatus = e.target.value; render(); };
    $('#bt-mest').onchange = e => { B.meStatus = e.target.value; render(); };
    $('#bt-weather').onchange = e => { B.weather = e.target.value; render(); };
    const adj = $('#bt-adjust'); if (adj) adj.addEventListener('toggle', () => { S.adjustOpen = adj.open; });
    $('#bt-reset').onclick = () => { Object.assign(B, { themHp: 100, meHp: 100, themBoost: {}, meBoost: {}, themStatus: '', meStatus: '' }); render(); };
  }

  // ---------------- evolutions ----------------
  /** "Level 36 → Venusaur", "item: Fire Stone → Flareon": every way this species evolves, from the ROM. */
  function evoSummary(sid) {
    return (D.evo[sid] || []).map(([to, , , how]) => `${how.replace(/^item: /, '').replace(/^Level /, 'Lv ')} → ${E.sp(to) ? E.sp(to).n : '?'}`);
  }
  let FAMILY = null;   // species id -> id of the first stage of its evolution family
  function familyOf(sid) {
    if (!FAMILY) {
      FAMILY = new Map();
      const parent = new Map();
      for (const [from, list] of Object.entries(D.evo)) for (const [to] of list) if (!parent.has(to)) parent.set(to, +from);
      for (const [from, list] of Object.entries(D.mega || {})) for (const [, to] of list) parent.set(to, +from);
      for (const sp of D.species) { let r = sp.i, guard = 0; while (parent.has(r) && guard++ < 6) r = parent.get(r); FAMILY.set(sp.i, r); }
    }
    return FAMILY.get(sid) || sid;
  }
  /** Evolution families you already have (for the dupes clause): every Pokemon caught, including fainted ones. */
  function ownedFamilies() {
    const set = new Set(S.roster.map(m => familyOf(m.s)));
    for (const e of Object.values(S.run.enc || {})) if (e && e.r === 'caught' && e.s) set.add(familyOf(e.s));
    return set;
  }
  /** What this species is by a given level through level-up evolutions. */
  function evolvedBy(sid, lv) {
    let s = sid, guard = 0;
    while (guard++ < 4) {
      const next = (D.evo[s] || []).find(([, method, param]) => [4, 8, 9, 10, 11, 12, 13, 20, 21, 22, 23, 31, 32].includes(method) && param <= lv);
      if (!next) break;
      s = next[0];
    }
    return s;
  }

  // ---------------- ROUTES: first encounter per area ----------------
  const METHOD_LABEL = { land: 'Grass / cave', water: 'Surfing', rock: 'Rock Smash', fish: 'Fishing' };
  function gameTimeNow() { const h = new Date().getHours(); return h >= 4 && h < 17 ? 'day' : 'night'; }
  function areaSpecies(a) {
    const out = new Set();
    for (const part of a.parts) for (const t of Object.values(part.k)) for (const rows of Object.values(t)) for (const r of rows) out.add(r[0]);
    return [...out];
  }
  function areaHasTime(a) { return a.parts.some(p => Object.values(p.k).some(t => t.day || t.night)); }
  function encRows(rows, owned, area) {
    return rows.map(r => {
      const [sid, lo, hi, pctv, rod] = r;
      const sp = E.sp(sid); if (!sp) return '';
      const dupe = S.run.dupes !== false && owned.has(familyOf(sid));
      return `<div class="enc-row ${dupe ? 'dupe' : ''}">${icon(sid)}<div><div class="nm">${esc(sp.n)} ${typesHTML(sp.t)}${dupe ? '<span class="tag">dupe</span>' : ''}</div>
        <div class="meta">Lv ${lo === hi ? lo : lo + '–' + hi} · ${pctv}%${rod ? ' · ' + esc(rod) : ''}</div></div>
        <div class="row" style="gap:4px;flex-wrap:nowrap"><button class="btn small" data-got="${sid}" data-lv="${hi}" data-area="${esc(area)}">Caught</button><button class="btn small ghost" data-fail="${sid}" data-area="${esc(area)}" aria-label="Didn't catch ${esc(sp.n)}">✕</button></div></div>`;
    }).join('');
  }
  function routeTrainers(a) { return D.bosses.filter(b => b.route && (b.areas || []).includes(a.n)); }
  function areaCard(a) {
    const e = (S.run.enc || {})[a.n];
    const owned = ownedFamilies();
    const when = S.encTime || gameTimeNow();
    let status = '<span class="tag">not yet</span>';
    if (e && e.r === 'caught') status = `${icon(e.s)}<span class="verdict v-safe">${esc(E.sp(e.s) ? E.sp(e.s).n : 'caught')}</span>`;
    else if (e && e.r === 'failed') status = `${e.s ? icon(e.s) : ''}<span class="verdict v-lose">missed${e.s && E.sp(e.s) ? ': ' + esc(E.sp(e.s).n) : ''}</span>`;
    else if (e && e.r === 'skipped') status = '<span class="verdict v-ok">skipped</span>';
    const open = S.openArea === a.n;
    let body = '';
    if (open) {
      const timed = areaHasTime(a);
      if (timed) body += `<div class="row small"><span class="seg" role="group" aria-label="Time of day"><button data-time="day" aria-pressed="${when === 'day'}">Day 4:00–16:59</button><button data-time="night" aria-pressed="${when === 'night'}">Night 17:00–3:59</button></span><span class="note">My Boy! uses your phone's clock.</span></div>`;
      a.parts.forEach((part, k) => {
        const label = a.parts.length > 1 ? `<div class="lbl">Part ${k + 1} of ${a.parts.length}</div>` : '';
        let inner = '';
        for (const [kind, t] of Object.entries(part.k)) {
          const rows = t.any || t[when] || t.day || t.night;
          if (!rows || !rows.length) continue;
          inner += `<div class="lbl">${METHOD_LABEL[kind] || kind}${t.any || !timed ? '' : ` (${when === 'day' ? 'day' : 'night'})`}</div><div class="enc">${encRows(rows, owned, a.n)}</div>`;
        }
        if (inner) body += label + inner;
      });
      const tr = routeTrainers(a);
      if (tr.length) body += `<div class="lbl">Trainers here (${tr.length})</div><div class="enc">${tr.map(b => `<div class="enc-row" style="grid-template-columns:1fr auto">
          <div><div class="nm">${esc(b.cls)} ${esc(b.n)}${b.dbl ? ' <span class="tag">double</span>' : ''}</div>
          <div class="team-icons">${b.party.map(m => `<span class="t">${icon(m.s) || esc(E.sp(m.s).n)}<span>${m.lv != null ? 'Lv ' + m.lv : 'top' + (m.rel ? (m.rel > 0 ? '+' : '−') + Math.abs(m.rel) : '')}</span></span>`).join('')}</div></div>
          <button class="btn small" data-plan="${b.i}">Plan</button></div>`).join('')}</div>`;
      const fd = (D.finds || {})[a.n];
      if (fd) {
        const seen = new Set();
        const gifts = fd.g.filter(([k, sid, lv]) => { const key = k + (E.sp(sid) || {}).n + lv; if (seen.has(key) || !E.sp(sid)) return false; seen.add(key); return true; });
        const KIND = { g: 'gift', s: 'one-time encounter', e: 'egg' };
        if (gifts.length) body += `<div class="lbl">Gifts and one-time encounters</div><div class="enc">${gifts.slice(0, 20).map(([k, sid, lv]) => `<div class="enc-row">${icon(sid)}<div><div class="nm">${esc(E.sp(sid).n)} ${typesHTML(E.sp(sid).t)}</div><div class="meta">${KIND[k] || k}${lv ? ' · Lv ' + lv : ''}</div></div>
            <button class="btn small" data-gift="${sid}" data-lv="${lv || 5}" data-area="${esc(a.n)}">Add</button></div>`).join('')}</div>`;
        const owned = new Set(S.run.tms || []);
        const tmsHere = [...new Set(fd.i.map(([id]) => tmOfItem(id)).filter(t => t != null))];
        const notable = [...new Set(fd.i.filter(([id]) => tmOfItem(id) == null && NOTABLE_ITEM.test(E.itemName(id) || '')).map(([id]) => E.itemName(id)))];
        const rest = fd.i.filter(([id]) => tmOfItem(id) == null && !NOTABLE_ITEM.test(E.itemName(id) || ''));
        if (tmsHere.length || notable.length || rest.length) body += `<div class="lbl">Items here</div><div class="chips">${tmsHere.map(t => `<button class="chipbtn" data-tmown="${t}" aria-pressed="${owned.has(t)}" title="Tap when you have it">${tmName(t)} ${esc(E.mv(D.tms[t]) ? E.mv(D.tms[t]).f : '')}</button>`).join('')}${notable.map(n => `<span class="tag">${esc(n)}</span>`).join(' ')}</div>
          ${rest.length ? `<details><summary class="small muted">${rest.length} other item${rest.length > 1 ? 's' : ''}</summary><div class="small muted">${[...new Set(rest.map(([id]) => E.itemName(id)))].map(esc).join(', ')}</div></details>` : ''}
          ${tmsHere.length ? '<div class="note">Tap a TM once you have it: it goes into your TM case and move advice starts using it.</div>' : ''}`;
        const shopTMs = [...new Set(fd.sh.flat().map(id => tmOfItem(id)).filter(t => t != null))];
        const shopNotable = [...new Set(fd.sh.flat().filter(id => tmOfItem(id) == null && NOTABLE_ITEM.test(E.itemName(id) || '')).map(id => E.itemName(id)))];
        if (fd.sh.length) body += `<div class="lbl">Shops and exchanges (${fd.sh.length})</div><div class="small">${shopTMs.length ? `TMs: ${shopTMs.map(t => `${tmName(t)} ${esc(E.mv(D.tms[t]) ? E.mv(D.tms[t]).f : '')}`).join(', ')}. ` : ''}${shopNotable.length ? `Held items and stones: ${shopNotable.slice(0, 18).map(esc).join(', ')}${shopNotable.length > 18 ? '…' : ''}.` : ''}${!shopTMs.length && !shopNotable.length ? 'Basic supplies.' : ''}</div>`;
      }
      body += `<div class="row"><button class="btn small" data-best="${esc(a.n)}">Best catch here</button>${e ? `<button class="btn small ghost" data-undo="${esc(a.n)}">Undo this encounter</button>` : `<button class="btn small ghost" data-skip="${esc(a.n)}">No encounter here</button>`}</div>
        <div id="best-${encodeURIComponent(a.n)}"></div>`;
    }
    return `<details class="card area ${e ? 'done' : ''}" data-area="${esc(a.n)}" ${open ? 'open' : ''}><summary><span class="nm">${esc(a.n)}</span><span class="st">${status}</span>
      <span class="note">${a.fo ? 'no wild Pokémon · gifts and items' : `${areaSpecies(a).length} species · from Lv ${a.minLv}`}${routeTrainers(a).length ? ' · ' + routeTrainers(a).length + ' trainers' : ''}</span></summary><div class="body">${body}</div></details>`;
  }
  function renderRoutes() {
    const enc = S.run.enc || {};
    const areas = D.areas;
    const wild = areas.filter(a => !a.fo);
    const doneN = wild.filter(a => enc[a.n]).length, caught = Object.values(enc).filter(e => e && e.r === 'caught').length;
    const list = S.routeFilter === 'todo' ? areas.filter(a => (!enc[a.n] && !a.fo) || a.n === S.openArea) : areas;
    main.innerHTML = `<section class="section">
      <div class="card"><div class="row"><h2 class="grow">Routes</h2><span class="pill">${doneN}/${wild.length} done · ${caught} caught</span></div>
        <p class="small" style="margin:0">Nuzlocke rule: only the first Pokémon you meet in each area counts. Open an area, then tap <b>Caught</b> on what you got (it goes into your party with its level and the moves a wild one knows) or <b>✕</b> if it fainted or fled. Encounter tables, levels and odds are read from the ROM, including the separate day and night tables.</p>
        <div class="row small"><span class="seg" role="group" aria-label="Show"><button data-filter="todo" aria-pressed="${S.routeFilter === 'todo'}">Still to do</button><button data-filter="all" aria-pressed="${S.routeFilter !== 'todo'}">All areas, items and gifts</button></span>
          <label class="row" style="gap:6px;flex-wrap:nowrap"><input type="checkbox" id="dupes" ${S.run.dupes !== false ? 'checked' : ''}> <span>Dupes clause: mark species you already have</span></label></div></div>
      ${list.map(areaCard).join('') || '<div class="empty">Every area is done. Switch to “All areas” to review them.</div>'}
    </section>`;
    wireRoutes();
  }
  function setEnc(area, val) {
    if (S.example) { S.example = false; S.roster = []; }
    S.run.enc = Object.assign({}, S.run.enc || {});
    if (val) S.run.enc[area] = val; else delete S.run.enc[area];
    store.saveRun();
  }
  function wireRoutes() {
    main.querySelectorAll('details.area').forEach(d => d.addEventListener('toggle', () => {
      if (d.open && S.openArea !== d.dataset.area) { S.openArea = d.dataset.area; renderRoutes(); const el = main.querySelector(`details.area[data-area="${CSS.escape(S.openArea)}"]`); if (el) el.scrollIntoView({ block: 'nearest' }); }
      else if (!d.open && S.openArea === d.dataset.area) S.openArea = null;
    }));
    main.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => { S.routeFilter = b.dataset.filter; renderRoutes(); });
    main.querySelectorAll('[data-time]').forEach(b => b.onclick = () => { S.encTime = b.dataset.time; renderRoutes(); });
    const du = $('#dupes'); if (du) du.onchange = () => { S.run.dupes = du.checked; store.saveRun(); renderRoutes(); };
    main.querySelectorAll('[data-got]').forEach(b => b.onclick = () => {
      const sid = +b.dataset.got, area = b.dataset.area;
      openEditor(null, { s: sid, lv: +b.dataset.lv, met: area, onSave: m => setEnc(area, { s: sid, r: 'caught', key: m.key }) });
    });
    main.querySelectorAll('[data-fail]').forEach(b => b.onclick = () => { setEnc(b.dataset.area, { s: +b.dataset.fail, r: 'failed' }); renderRoutes(); });
    main.querySelectorAll('[data-skip]').forEach(b => b.onclick = () => { setEnc(b.dataset.skip, { r: 'skipped' }); renderRoutes(); });
    main.querySelectorAll('[data-undo]').forEach(b => b.onclick = () => { setEnc(b.dataset.undo, null); renderRoutes(); });
    main.querySelectorAll('[data-plan]').forEach(b => b.onclick = () => { S.planBoss = +b.dataset.plan; S.tab = 'plan'; selectTab('plan'); render(); window.scrollTo(0, 0); });
    main.querySelectorAll('[data-best]').forEach(b => b.onclick = () => bestCatch(D.areas.find(a => a.n === b.dataset.best)));
    main.querySelectorAll('[data-gift]').forEach(b => b.onclick = () => openEditor(null, { s: +b.dataset.gift, lv: +b.dataset.lv, met: `${b.dataset.area} (gift)` }));
    main.querySelectorAll('[data-tmown]').forEach(b => b.onclick = () => {
      const t = +b.dataset.tmown; const set = new Set(S.run.tms || []);
      if (set.has(t)) set.delete(t); else set.add(t);
      S.run.tms = [...set].sort((x, y) => x - y); b.setAttribute('aria-pressed', set.has(t));
      store.saveRun();
    });
  }
  /** Encounter planner: which species here would help most in the next two big fights, as what it evolves into by then. */
  function bestCatch(a) {
    const box = document.getElementById('best-' + encodeURIComponent(a.n)); if (!box) return;
    box.innerHTML = '<div class="note">Testing each species against your next big fights…</div>';
    setTimeout(() => {
      const majors = ADV.upcomingMajor(nextBoss(), 2);
      const tms = S.run.tms || [];
      const owned = ownedFamilies();
      const ranked = areaSpecies(a).map(sid => {
        let total = 0; const notes = [];
        for (const bi of majors) {
          const b = D.bosses[bi];
          const as = evolvedBy(sid, b.cap);
          const sp = E.sp(as);
          const spec = { key: 'cand', s: as, lv: b.cap, nat: 0, ab: E.hardcoreAbility(sp.a[0], as), it: null, mv: [] };
          const f = ADV.fightScore(spec, bi, tms);
          total += f.score;
          const wins = f.per.filter(x => x.verdict === 'safe' || x.verdict === 'ok').length;
          notes.push(`${as !== sid ? 'as ' + sp.n + ', ' : ''}handles ${wins} of ${b.n}'s ${f.per.length} at Lv ${b.cap}`);
        }
        return { sid, total, notes, dupe: S.run.dupes !== false && owned.has(familyOf(sid)) };
      }).sort((x, y) => (x.dupe - y.dupe) || (y.total - x.total));
      box.innerHTML = `<div class="card" style="box-shadow:none;border-width:2px"><div class="lbl">Most useful catches for ${majors.map(i => esc(D.bosses[i].n)).join(' and ')}</div>
        ${ranked.slice(0, 4).map((r, k) => `<div class="slot">${icon(r.sid)}<div class="who"><span><b style="font-size:15px">${k + 1}. ${esc(E.sp(r.sid).n)}</b>${r.dupe ? ' <span class="tag">dupe</span>' : ''}</span><span class="small muted">${esc(r.notes.join('; '))}</span></div><span class="num">${r.total.toFixed(1)}</span></div>`).join('')}
        <p class="note" style="margin:0">Each species is tested at the level cap of those fights, evolved by level-up where it would be by then, with its best level-up moves and your TMs, against the bosses' exact Hardcore teams. You can't choose your first encounter, but this tells you which result to hope for and which to keep in your party.</p></div>`;
    }, 30);
  }
  function selectTab(t) { document.querySelectorAll('.tabs button').forEach(o => o.setAttribute('aria-selected', o.dataset.tab === t ? 'true' : 'false')); }

  // ---------------- import from a save file ----------------
  const BADGES = ['Boulder Badge', 'Cascade Badge', 'Thunder Badge', 'Rainbow Badge', 'Soul Badge', 'Marsh Badge', 'Volcano Badge', 'Earth Badge'];
  function openImport() {
    document.body.style.overflow = 'hidden';
    sheet.hidden = false;
    const close = () => { sheet.hidden = true; sheet.innerHTML = ''; document.body.style.overflow = ''; };
    let parsed = null;
    function draw(msg) {
      const p = parsed;
      sheet.innerHTML = `<div class="inner"><div class="row"><h2 class="grow">Import from your save file</h2><button class="btn ghost" id="im-close">Close</button></div>
        <div class="card"><p class="small" style="margin:0">In My Boy!, save in-game, then export the save: menu → <b>Export save</b> (it makes a <b>.sav</b> file). Pick that file here. Nothing is uploaded: the file is read on your phone.</p>
          <div class="dropzone"><input type="file" id="im-file" accept=".sav,.srm,.sa1,application/octet-stream"><span class="note">Beta: Radical Red's save layout was read from the engine source, not yet checked against a real save. Check the preview before importing.</span></div>
          ${msg ? `<div class="banner">${esc(msg)}</div>` : ''}</div>
        ${p ? `<div class="card"><h3>Your party (${p.party.length})</h3>${p.party.map(m => { const sp = E.sp(m.s); return `<div class="slot">${icon(m.s, 'x2')}<div class="who"><b>${esc(m.nick ? m.nick + ' (' + sp.n + ')' : sp.n)}</b>
              <span class="small">Lv ${m.lv} · ${esc(natureText(m.nat))} · ${esc(m.ab || '')}${m.it ? ' · ' + esc(E.itemName(m.it)) : ''}</span>
              <span class="small muted">${m.mv.map(id => esc(E.mv(id) ? E.mv(id).f : '?')).join(', ')}</span></div>${m.maxHp ? `<div style="width:90px">${hpBar(100 * m.hp / m.maxHp)}</div>` : ''}</div>`; }).join('') || '<p class="muted small">No party Pokémon found.</p>'}
            <p class="small" style="margin:0">PC boxes: ${p.boxes.length} Pokémon. Badges: ${p.badges.length}.${p.bag ? ` Bag: ${p.bag.filter(x => tmOfItem(x.id) != null).length} TMs and ${p.bag.filter(x => tmOfItem(x.id) == null && (D.items[x.id] || {}).c).length} held items.` : ''}</p>
            ${p.bag ? '<label class="row small"><input type="checkbox" id="im-bag" checked> Also import your TMs and held items (beta)</label>' : ''}
            ${p.notes.map(n => `<div class="note">${esc(n)}</div>`).join('')}
            <label class="row small"><input type="checkbox" id="im-boxes" ${p.boxes.length ? '' : 'disabled'}> Also import the ${p.boxes.length} Pokémon in your PC boxes</label>
            <label class="row small"><input type="checkbox" id="im-badges" checked ${p.badges.length ? '' : 'disabled'}> Mark the gyms of your ${p.badges.length} badges as beaten</label>
            <div class="row"><button class="btn primary" id="im-go">Import</button><span class="note">Pokémon already in the Coach are updated (matched by the game's personality value); the rest are added. Nothing is deleted.</span></div></div>` : ''}
      </div>`;
      $('#im-close').onclick = close;
      $('#im-file').onchange = async ev => {
        const f = ev.target.files[0]; if (!f) return;
        try { parsed = SR.read(await f.arrayBuffer()); draw(''); }
        catch (e) { parsed = null; draw(e.message || String(e)); }
      };
      const go = $('#im-go');
      if (go) go.onclick = async () => {
        if (S.example) { S.example = false; S.roster = []; }
        const take = p.party.map(m => Object.assign({}, m, { box: 'party' })).concat($('#im-boxes').checked ? p.boxes.map(m => Object.assign({}, m, { box: 'box' })) : []);
        const changed = [];
        let partyCount = 0;
        for (const t of take) {
          let m = t.pid ? S.roster.find(r => r.pid === t.pid && r.box !== 'dead') : null;
          const fields = { s: t.s, lv: t.lv, nat: t.nat, ab: t.ab, it: t.it, mv: t.mv.slice(0, 4), nick: t.nick || (m && m.nick) || '', pid: t.pid };
          if (m) Object.assign(m, fields);
          else { m = Object.assign({ key: 'mon-' + uid(), met: 'Imported', ord: Date.now() + changed.length }, fields); S.roster.push(m); }
          m.box = t.box === 'party' && partyCount < 6 ? 'party' : (m.box === 'party' && t.box !== 'party' ? 'box' : t.box === 'party' ? 'box' : m.box || 'box');
          if (m.box === 'party') partyCount++;
          changed.push(m);
        }
        // anything else still marked as in the party goes to the box, so the party matches the game
        for (const r of S.roster) if (r.box === 'party' && !changed.includes(r)) r.box = 'box';
        if ($('#im-bag') && $('#im-bag').checked && p.bag) {
          S.run.tms = [...new Set((S.run.tms || []).concat(p.bag.map(x => tmOfItem(x.id)).filter(t => t != null)))].sort((x, y) => x - y);
          S.run.bag = [...new Set((S.run.bag || []).concat(p.bag.filter(x => tmOfItem(x.id) == null && (D.items[x.id] || {}).c).map(x => x.id)))];
        }
        if ($('#im-badges').checked) for (const k of p.badges) { const b = D.bosses.find(x => x.ms === BADGES[k]); if (b && !S.run.beaten.includes(b.i)) S.run.beaten.push(b.i); }
        close(); render();
        for (const m of S.roster) await store.saveMon(m);
        await store.saveRun();
        flash(`Imported ${changed.length} Pokémon from your save.`);
      };
    }
    draw('');
  }

  // ---------------- RUNS: the current run, starting over, past runs and the starter tier list ----------------
  const RESULT = { wipe: ['Wiped out', 'v-lose'], quit: ['Gave up', 'v-risky'], win: ['Won', 'v-safe'] };
  const fmtDate = t => (t ? new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
  function lastBeatenMajor() {
    let last = null;
    for (const b of D.bosses) if (!b.route && S.run.beaten.includes(b.i) && (b.ms || b.cat === 'gym' || b.cat === 'e4' || b.cat === 'rival')) last = b;
    return last;
  }
  function runSummary() {
    const enc = Object.values(S.run.enc || {});
    const last = lastBeatenMajor();
    return {
      milestones: milestonesDone(), cap: capNow(), beaten: S.run.beaten.length, lastBeaten: last ? last.n : null,
      caught: enc.filter(e => e && e.r === 'caught').length, missed: enc.filter(e => e && e.r === 'failed').length, areas: enc.length,
      alive: alive().length, fainted: S.roster.filter(m => m.box === 'dead').length,
    };
  }
  function teamIcons(team) {
    return `<div class="team-icons">${team.map(m => `<span class="t" style="${m.box === 'dead' ? 'opacity:.45;filter:grayscale(1)' : ''}" title="${esc((E.sp(m.s) || {}).n || '')}">${icon(m.s) || esc((E.sp(m.s) || {}).n || '?')}<span>${m.box === 'dead' ? '✝' : 'Lv ' + m.lv}</span></span>`).join('')}</div>`;
  }
  let TIERS = null, tiersLoading = null;
  function loadTiers() {
    if (TIERS || tiersLoading) return tiersLoading;
    tiersLoading = fetch('starters.json').then(r => (r.ok ? r.json() : null)).then(v => { TIERS = v; if (S.tab === 'runs') renderRuns(); }).catch(() => { TIERS = { error: true }; });
    return tiersLoading;
  }
  const TIER_COLORS = { S: '#e0523e', A: '#e8963a', B: '#e8c22c', C: '#5bb36a', D: '#5b8fd6' };
  function tierListHTML() {
    if (!TIERS) { loadTiers(); return '<div class="empty">Loading the starter tier list…</div>'; }
    if (TIERS.error || !TIERS.starters) return '<div class="empty">The starter tier list didn’t load.</div>';
    const pick = S.tierPick != null ? TIERS.starters.find(x => x.s === S.tierPick) : null;
    const rows = ['S', 'A', 'B', 'C', 'D'].map(t => {
      const list = TIERS.starters.filter(x => x.tier === t);
      if (!list.length) return '';
      return `<div class="tier"><span class="tl" style="background:${TIER_COLORS[t]}">${t}</span><div class="chips">${list.map(x =>
        `<button class="chipbtn" data-tier="${x.s}" aria-pressed="${S.tierPick === x.s}">${icon(x.s)}${esc(x.name)}</button>`).join('')}</div></div>`;
    }).join('');
    let detail = '';
    if (pick) {
      const bar = (v, label) => `<div class="small" style="display:grid;grid-template-columns:7.5em 1fr 3em;gap:6px;align-items:center"><span>${label}</span><div class="progress"><span style="width:${Math.max(0, Math.min(100, 100 * (v + 1) / 4))}%"></span></div><span class="num">${v.toFixed(2)}</span></div>`;
      const fightLine = f => `${esc(f.name)} (cap ${f.cap}): ${f.handles.toFixed(f.handles % 1 ? 1 : 0)} of ${f.size}`;
      detail = `<div class="card" style="box-shadow:none;border-width:2px">
        <div class="slot">${front(pick.stages[pick.stages.length - 1].s)}<div class="who"><b>#${pick.rank} ${esc(pick.name)} <span class="tag">tier ${pick.tier}</span></b>
          <span class="small">${pick.stages.map((st, k) => `${esc(E.sp(st.s).n)}${k ? ' (Lv ' + st.lv + ')' : ''}`).join(' → ')}</span>
          <div class="row" style="gap:4px">${typesHTML(pick.types)}<span class="small muted">Gen ${pick.gen} · ${esc(pick.type)} ball · final base total ${pick.bst}</span></div></div></div>
        ${bar(pick.early, 'Early game')}${bar(pick.late, 'Rest of the run')}
        <dl class="kv"><dt>Nature</dt><dd>${esc(pick.nature)} tested best (set it free with the Nature Change service)</dd>
          <dt>Ability</dt><dd>${esc(pick.ability || '—')}${pick.hidden ? ` · hidden: ${esc(pick.hidden)}` : ''}</dd>
          <dt>Rival</dt><dd>He takes the ${esc(pick.rival)} line, so his ${esc(pick.rival)} fights are the ones scored here</dd>
          <dt>Key moves</dt><dd>${pick.keyMoves.map(k => esc(E.mv(k.id) ? E.mv(k.id).f : '?') + (k.lv === 0 ? ' (on evolving)' : k.lv ? ` (Lv ${k.lv})` : '')).join(', ')}</dd>
          <dt>Best vs</dt><dd>${pick.best.map(fightLine).join('<br>')}</dd>
          <dt>Struggles vs</dt><dd>${pick.worst.map(fightLine).join('<br>')}</dd></dl>
        ${!S.roster.length && !S.example ? `<div class="row"><button class="btn primary" data-choose="${pick.s}">Start this run with ${esc(pick.name)}</button></div>` : ''}
      </div>`;
    }
    return `<div class="card"><p class="small" style="margin:0">All 27 starters Oak's Lab offers (the generation setting changes the three balls), ranked for Hardcore from the game's data. Each one is tested at every major fight's level cap up to the Champion (${TIERS.fights} fights), evolved by level as it would be by then, with its best level-up moves and nature, one-on-one against each of the boss's Pokémon. Early game (the first four badges) counts 60%, because that's when your starter carries you. Tap one for details.</p>
      ${rows}${detail}
      <p class="note" style="margin:0">Scores run from 3 (beats every boss Pokémon safely) to −1 (loses to all of them); one Pokémon alone rarely beats a whole Hardcore team, so even the best sit near 1. TMs and tutors aren't assumed, so Pokémon that rely on them can do better than this.</p></div>`;
  }
  function renderRuns() {
    const r = runSummary();
    const runNo = S.run.no || S.history.length + 1;
    const wins = S.history.filter(h => h.result === 'win').length;
    const best = S.history.slice().sort((a, b) => ((b.progress || {}).milestones || 0) - ((a.progress || {}).milestones || 0))[0];
    let html = `<section class="section"><div class="card rec"><div class="row"><h2 class="grow">Run #${runNo}</h2><span class="pill">${S.example ? 'example team' : 'started ' + fmtDate(S.run.started || (S.roster.length ? Math.min(...S.roster.map(m => m.ord || Date.now())) : null))}</span></div>
      <dl class="kv"><dt>Progress</dt><dd>${r.milestones} of 16 milestones · cap ${r.cap}${r.lastBeaten ? ` · last beat ${esc(r.lastBeaten)}` : ''}</dd>
        <dt>Encounters</dt><dd>${r.caught} caught, ${r.missed} missed, ${r.areas} areas done</dd>
        <dt>Team</dt><dd>${r.alive} alive, ${r.fainted} fainted</dd></dl>
      ${S.roster.length ? teamIcons(S.roster) : '<p class="small muted" style="margin:0">No Pokémon yet. Pick a starter below or add one on the Party tab.</p>'}
      <div class="row"><button class="btn primary" id="run-end" ${S.example || (!S.roster.length && !S.run.beaten.length) ? 'disabled' : ''}>End this run…</button>
        <span class="note">Saves it to your history, then clears your party, boxes, encounters, beaten bosses and TMs for a fresh start. Your settings stay.</span></div></div></section>`;
    html += `<section class="section"><div class="head"><h2>Starter tier list</h2></div>${tierListHTML()}</section>`;
    html += `<section class="section"><div class="head"><h2>Past runs</h2>${S.history.length ? `<span class="muted small">${S.history.length} run${S.history.length > 1 ? 's' : ''} · ${wins} won${best && best.progress ? ` · furthest: ${best.progress.milestones} milestones (run #${best.no})` : ''}</span>` : ''}</div>
      ${S.history.length ? S.history.map(h => {
        const [label, cls] = RESULT[h.result] || ['Ended', 'v-ok'];
        const p = h.progress || {};
        const days = h.started && h.ended ? Math.max(1, Math.round((h.ended - h.started) / 86400000)) : null;
        const deaths = (h.team || []).filter(m => m.box === 'dead');
        return `<div class="card" data-hist="${esc(h.id)}"><div class="row"><b class="grow" style="font-family:var(--font-display);font-size:18px">Run #${h.no || '?'}</b><span class="verdict ${cls}">${label}</span></div>
          <div class="small">${fmtDate(h.started)} – ${fmtDate(h.ended)}${days ? ` · ${days} day${days > 1 ? 's' : ''}` : ''}${h.starter && E.sp(h.starter) ? ` · starter ${esc(E.sp(h.starter).n)}` : ''}</div>
          <dl class="kv"><dt>Reached</dt><dd>${p.milestones || 0} of 16 milestones · cap ${p.cap || '—'}${p.lastBeaten ? ` · last beat ${esc(p.lastBeaten)}` : ''}</dd>
            ${h.endedAt ? `<dt>Ended at</dt><dd>${esc(h.endedAt)}</dd>` : ''}
            <dt>Encounters</dt><dd>${(h.enc || {}).caught || 0} caught, ${(h.enc || {}).missed || 0} missed</dd>
            ${deaths.length ? `<dt>Lost</dt><dd>${deaths.map(m => `${esc((E.sp(m.s) || {}).n || '?')}${m.died && m.died.before ? ` (before ${esc(m.died.before)})` : ''}`).join(', ')}</dd>` : ''}
            ${h.notes ? `<dt>Notes</dt><dd>${esc(h.notes)}</dd>` : ''}</dl>
          ${teamIcons(h.team || [])}
          <div class="row"><button class="btn small ghost" data-delhist="${esc(h.id)}">Delete…</button></div></div>`;
      }).join('') : '<div class="empty">Finished runs show up here: how far you got, your team, who fell and where.</div>'}</section>`;
    main.innerHTML = html;
    const end = $('#run-end'); if (end) end.onclick = () => openEndRun(alive().length ? 'quit' : 'wipe');
    main.querySelectorAll('[data-tier]').forEach(b => b.onclick = () => { S.tierPick = S.tierPick === +b.dataset.tier ? null : +b.dataset.tier; renderRuns(); });
    main.querySelectorAll('[data-choose]').forEach(b => b.onclick = () => {
      const sid = +b.dataset.choose;
      openEditor(null, { s: sid, lv: 5, met: 'Starter', onSave: m => { S.run.starter = sid; if (!S.run.started) S.run.started = Date.now(); store.saveRun(); } });
    });
    main.querySelectorAll('[data-delhist]').forEach(b => b.onclick = () => {
      if (b.dataset.armed) { const id = b.dataset.delhist; S.history = S.history.filter(h => h.id !== id); renderRuns(); store.deleteHist(id); return; }
      b.dataset.armed = '1'; b.textContent = 'Confirm delete'; b.classList.add('primary');
    });
  }
  function openEndRun(preset) {
    document.body.style.overflow = 'hidden';
    sheet.hidden = false;
    const close = () => { sheet.hidden = true; sheet.innerHTML = ''; document.body.style.overflow = ''; };
    let result = preset || 'wipe';
    const nb = D.bosses[nextBoss()];
    const majors = D.bosses.filter(b => !b.route && (b.ms || b.cat === 'gym' || b.cat === 'e4' || b.cat === 'rival')).filter((b, k, arr) => k === arr.findIndex(x => x.n === b.n && x.cap === b.cap));
    function draw() {
      const r = runSummary();
      sheet.innerHTML = `<div class="inner"><div class="row"><h2 class="grow">End run #${S.run.no || S.history.length + 1}</h2><button class="btn ghost" id="er-close">Cancel</button></div>
        <div class="card"><div class="lbl">How did it end?</div>
          <span class="seg" role="group" aria-label="Result">${Object.entries(RESULT).map(([k, [l]]) => `<button data-res="${k}" aria-pressed="${result === k}">${l}</button>`).join('')}</span>
          <div class="field"><label for="er-at">Where</label><select id="er-at" class="inline">
            <option value="">—</option>
            ${majors.map(b => `<option value="${esc(b.n)} (cap ${b.cap})" ${b.n === nb.n && b.cap === nb.cap ? 'selected' : ''}>${esc(b.n)} (${esc(b.cls)}, cap ${b.cap})</option>`).join('')}
            <option value="A route or wild battle">A route or wild battle</option><option value="Somewhere else">Somewhere else</option></select></div>
          <div class="field"><label for="er-notes">Notes (optional)</label><textarea id="er-notes" rows="3" style="padding:8px 10px;border-radius:10px;border:1px solid var(--line);background:var(--surface)" placeholder="What went wrong, what to try next time"></textarea></div>
          <p class="small" style="margin:0">Saved to your history: ${r.milestones} milestones, cap ${r.cap}, ${S.roster.length} Pokémon (${r.fainted} fainted), ${r.caught} catches. Then your party, boxes, encounters, beaten bosses and TMs are cleared for run #${(S.run.no || S.history.length + 1) + 1}.</p>
          <div class="row"><button class="btn primary" id="er-go">Save and start a new run</button></div></div></div>`;
      $('#er-close').onclick = close;
      sheet.querySelectorAll('[data-res]').forEach(b => b.onclick = () => { result = b.dataset.res; const n = $('#er-notes').value, at = $('#er-at').value; draw(); $('#er-notes').value = n; $('#er-at').value = at; });
      $('#er-go').onclick = async () => {
        const btn = $('#er-go'); btn.disabled = true; btn.textContent = 'Saving…';
        await endRun(result, $('#er-at').value, $('#er-notes').value.trim());
        close(); S.tab = 'runs'; selectTab('runs'); render(); window.scrollTo(0, 0);
        flash('Run saved to your history. Good luck on the next one!');
      };
    }
    draw();
  }
  async function endRun(result, endedAt, notes) {
    const r = runSummary();
    const no = S.run.no || S.history.length + 1;
    const starter = S.run.starter || (S.roster.find(m => /starter/i.test(m.met || '')) || {}).s || null;
    const h = {
      id: uid(), no, result, endedAt: endedAt || '', notes: notes || '', starter,
      started: S.run.started || (S.roster.length ? Math.min(...S.roster.map(m => m.ord || Date.now())) : Date.now()), ended: Date.now(),
      progress: { milestones: r.milestones, cap: r.cap, beaten: r.beaten, lastBeaten: r.lastBeaten },
      enc: { caught: r.caught, missed: r.missed, areas: r.areas },
      team: S.roster.map(m => ({ s: m.s, lv: m.lv, nick: m.nick || '', box: m.box, met: m.met || '', died: m.died || null })),
    };
    S.history = [h].concat(S.history);
    await store.saveHist(h);
    const keys = S.roster.map(m => m.key);
    S.roster = [];
    S.run = { beaten: [], tms: [], enc: {}, dupes: S.run.dupes !== false, checks: [], tutors: !!S.run.tutors, no: no + 1, started: null, starter: null, aiChecks: S.run.aiChecks || null };
    S.live = null;
    S.plans = {}; planCache = { key: '', plan: null }; S.planBoss = null; S.tierPick = null;
    S.battle = { boss: null, them: 0, me: null, themHp: 100, meHp: 100, themBoost: {}, meBoost: {}, weather: 'auto', themStatus: '', meStatus: '' };
    for (const k of keys) await store.deleteMon(k);
    await store.saveRun();
  }

  /** Regular trainers on each route become plannable fights after the bosses (they never count as progress). */
  function addRouteTrainers() {
    D.routeStart = D.bosses.length;
    for (const [tid, t] of Object.entries(D.trainers || {})) {
      const party = t.party.filter(m => E.sp(m.s)).map(m => ({ s: m.s, lv: m.lv, rel: m.rel, iv: m.iv || [31, 31, 31, 31, 31, 31], ev: m.ev || null,
        nat: m.nat != null ? m.nat : 0, ab: m.ab || E.sp(m.s).a[0], it: m.it || null, mv: (m.mv || []).filter(id => E.mv(id)) }));
      if (!party.length) continue;
      D.bosses.push({ i: D.bosses.length, id: +tid, n: t.n, cls: t.cls, cat: 'trainer', dbl: t.dbl, cap: null, party, route: true, areas: t.a });
    }
  }

  // ---------------- boot ----------------
  async function boot() {
    try { const t = localStorage.getItem('rrcoach:tab'); if (t) { S.tab = t; document.querySelectorAll('.tabs button').forEach(o => o.setAttribute('aria-selected', o.dataset.tab === t ? 'true' : 'false')); } } catch (e) {}
    if (!window.calc || !window.createEngine || !window.createSim || !window.createAdvice) { main.innerHTML = '<div class="empty">The damage calculator didn’t load. Check your connection and reload.</div>'; return; }
    try {
      const r = await fetch('rrdata.json'); if (!r.ok) throw new Error('HTTP ' + r.status);
      D = await r.json();
    } catch (e) { main.innerHTML = `<div class="empty">The game data didn’t load (${esc(e.message)}). Reload to try again.</div>`; return; }
    E = window.createEngine(window.calc, D);
    SIM = window.createSim(E);
    ADV = window.createAdvice(E);
    SR = window.createSaveReader ? window.createSaveReader(D) : null;
    addRouteTrainers();
    const sprites = fetch('sprites/index.json').then(r => (r.ok ? r.json() : null)).catch(() => null);
    SPR = await Promise.race([sprites, new Promise(res => setTimeout(() => res(null), 4000))]);
    if (!SPR) sprites.then(v => { if (v) { SPR = v; render(); } });
    render();
    store.init();
  }
  boot();
})();
