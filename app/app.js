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

  let D = null, E = null;
  const S = {
    roster: [], run: { beaten: [] }, tab: 'team', planBoss: null, example: false,
    battle: { boss: null, them: 0, me: null, themHp: 100, meHp: 100, themBoost: {}, meBoost: {}, weather: 'auto', themStatus: '', meStatus: '' },
  };

  // ---------------- small helpers ----------------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function textOn(hex) { const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16); return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#1b1b1b' : '#ffffff'; }
  function typeChip(t) { const c = TYPE_COLORS[t] || '#888888'; return `<span class="type" style="background:${c};color:${textOn(c)}">${esc(t)}</span>`; }
  function typesHTML(ts) { return `<span class="types">${ts.map(typeChip).join('')}</span>`; }
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
  function specOf(m, extra) { return Object.assign({ key: m.key, s: m.s, lv: m.lv, nat: m.nat, ab: m.ab, it: m.it || null, mv: (m.mv || []).filter(Boolean) }, extra || {}); }
  function alive() { return S.roster.filter(m => m.box !== 'dead'); }
  function party() { return S.roster.filter(m => m.box === 'party'); }
  function milestonesDone() { return D.bosses.filter(b => b.ms && S.run.beaten.includes(b.i)).length; }
  function capNow() { return D.caps.hardcore[Math.min(milestonesDone(), 17)]; }
  function nextBoss() { const b = D.bosses.find(b => !S.run.beaten.includes(b.i)); return b ? b.i : D.bosses.length - 1; }
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
          const roster = [], run = { beaten: [] };
          snap.docs.forEach(d => {
            const v = d.data(); if (!v) return;
            if (d.id === 'run') Object.assign(run, v);
            else if (d.id.startsWith('mon-')) roster.push(Object.assign({}, v, { key: d.id }));
          });
          roster.sort((a, b) => (a.ord || 0) - (b.ord || 0));
          if (!S.example || roster.length) { S.roster = roster; S.example = false; }
          S.run = { beaten: Array.isArray(run.beaten) ? run.beaten.slice() : [] };
          render();
        }, err => { clearTimeout(this.timer); this.note = 'Saving to your account stopped working (' + err.code + '). Reload to try again.'; renderStatus(); });
      } else {
        this.mode = 'local';
        try { const v = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); if (v) { S.roster = v.roster || []; S.run = v.run || { beaten: [] }; } } catch (e) { /* storage blocked */ }
        render();
      }
    },
    saveLocal() { try { localStorage.setItem(LS_KEY, JSON.stringify({ roster: S.roster, run: S.run })); } catch (e) { this.note = 'This browser blocked saving.'; } },
    async saveMon(m) {
      if (S.example) return;
      const body = { s: m.s, nick: m.nick || '', lv: m.lv, nat: m.nat, ab: m.ab, it: m.it || null, mv: m.mv, box: m.box, met: m.met || '', ord: m.ord || Date.now() };
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
      if (this.mode === 'db') { try { await this.col.doc('run').set({ beaten: S.run.beaten }); } catch (e) { flash('Couldn’t save progress (' + e.code + ').'); } }
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
    else if (S.tab === 'plan') renderPlan();
    else renderBattle();
  }

  // ---------------- TEAM ----------------
  function monCard(m) {
    const s = E.sp(m.s); const ab = E.abilityInfo(m.ab);
    const moves = (m.mv || []).map(id => moveChip(id, E.isBanned(id, s.g) ? 'banned in Hardcore' : '')).join('');
    const over = m.lv > capNow() ? `<span class="tag ban">above cap ${capNow()}</span>` : '';
    const moveTo = m.box === 'party' ? 'box' : 'party';
    return `<div class="card" data-key="${esc(m.key)}">
      <div class="mon-head"><span class="mon-name">${esc(monName(m))}</span>${typesHTML(s.t)}<span class="lv">Lv ${m.lv}</span>${over}</div>
      <dl class="kv"><dt>Ability</dt><dd>${esc(m.ab || '—')}${ab.x ? ' <span class="tag">Radical Red ability</span>' : ''}</dd>
        <dt>Item</dt><dd>${esc(E.itemName(m.it) || '—')}</dd><dt>Nature</dt><dd>${esc(natureText(m.nat))}</dd>${m.met ? `<dt>Caught</dt><dd>${esc(m.met)}</dd>` : ''}</dl>
      <div class="moves">${moves || '<span class="muted small">No moves entered</span>'}</div>
      ${m.box === 'dead' ? '' : `<div class="row">
        <button class="btn small" data-act="edit">Edit</button>
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
        <div class="row" style="justify-content:center"><button class="btn primary" data-act="add">Add a Pokémon</button><button class="btn" data-act="example">Try an example team</button></div></div>`;
      main.innerHTML = html; wireTeam(); return;
    }
    html += `<div class="row"><button class="btn primary" data-act="add">Add a Pokémon</button><span class="muted small">${p.length}/6 in party · ${box.length} in box · ${dead.length} fainted</span></div>`;
    html += `<section class="section"><div class="head"><h2>Party</h2></div>${p.length ? p.map(monCard).join('') : '<div class="empty small">No Pokémon in your party. Move some from your box.</div>'}</section>`;
    if (box.length) html += `<section class="section"><div class="head"><h2>Box</h2></div>${box.map(monCard).join('')}</section>`;
    if (dead.length) html += `<details class="more"><summary>Fainted (${dead.length})</summary><div class="section" style="margin-top:8px">${dead.map(monCard).join('')}</div></details>`;
    main.innerHTML = html;
    wireTeam();
  }
  function wireTeam() {
    main.querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', async () => {
      const act = btn.dataset.act;
      const card = btn.closest('[data-key]'); const m = card ? S.roster.find(x => x.key === card.dataset.key) : null;
      if (act === 'add') openEditor(null);
      else if (act === 'example') loadExample();
      else if (act === 'edit') openEditor(m);
      else if (act === 'move') { m.box = m.box === 'party' ? 'box' : 'party'; render(); await store.saveMon(m); }
      else if (act === 'faint') {
        btn.textContent = 'Confirm: mark as fainted'; btn.dataset.act = 'faint2'; btn.classList.add('primary');
        btn.addEventListener('click', async () => { m.box = 'dead'; render(); await store.saveMon(m); }, { once: true });
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
          if (match(m) && !known.some(k => k.id === m.i)) res.push({ id: m.i, label: esc(m.f), sub: 'tutor/egg?' + (s && E.isBanned(m.i, s.g) ? ' · banned' : '') });
        }
      }
      return res;
    };
  }

  // ---------------- editor sheet ----------------
  function openEditor(existing) {
    const m = existing ? JSON.parse(JSON.stringify(existing)) : { key: 'mon-' + uid(), s: null, lv: Math.max(5, capNow() - 3), nat: 0, ab: null, it: null, mv: [], box: party().length < 6 ? 'party' : 'box', nick: '', met: '' };
    const isNew = !existing;
    function draw() {
      const s = m.s ? E.sp(m.s) : null;
      const abil = s ? s.a.map((a, i) => a ? `<option value="${esc(a)}" ${m.ab === a ? 'selected' : ''}>${esc(a)}${i === 2 ? ' (hidden)' : ''}</option>` : '').join('') : '';
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
        close(); render(); await store.saveMon(m);
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
    return D.bosses.map(b => `<option value="${b.i}" ${b.i === sel ? 'selected' : ''}>${S.run.beaten.includes(b.i) ? '✓ ' : ''}#${b.i + 1} ${esc(bossLabel(b))} · cap ${b.cap}</option>`).join('');
  }
  function theirSetHTML(t) {
    const s = E.sp(t.s);
    return `<div class="mon-head"><span class="mon-name">${esc(s.n)}</span>${typesHTML(s.t)}<span class="lv">Lv ${t.lv}</span>${t.rel != null ? `<span class="tag">your top ${t.rel ? (t.rel > 0 ? '+' : '−') + Math.abs(t.rel) : ''}</span>` : ''}</div>
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
    const roster = alive();
    let html = `<section class="section">
      <div class="field"><label for="plan-boss">Boss</label><select id="plan-boss" class="inline">${bossOptions(S.planBoss)}</select></div>
      <div class="row small"><span class="pill cap">Cap ${b.cap}</span>${b.ms ? `<span class="pill">Win: cap rises to ${b.capAfter}</span>` : ''}${b.dbl ? '<span class="pill warn">Double battle, planned as singles</span>' : ''}
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
      const nameOf = i => monName(roster[i]);
      let out = html;
      out += `<section class="section"><div class="head"><h2>Bring these</h2><span class="muted small">Their levels set from your top level: Lv ${P.top}</span></div>
        <div class="card"><div class="lineup">${P.chosen.map(i => `<span class="pick ${i === P.lead ? 'lead' : ''}">${i === P.lead ? 'Lead: ' : ''}${esc(nameOf(i))}</span>`).join('')}</div>
        <p class="note" style="margin:0">They lead with ${esc(E.sp(P.team[0].s).n)}. After each KO the boss AI picks its next Pokémon, so have an answer ready for each one.${P.teamWeather ? ` Their team sets ${esc(P.teamWeather)}; weather users are planned with it up.` : ''}</p></div></section>`;
      out += `<section class="section"><h2>Their team and your answers</h2>${P.team.map((t, j) => {
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
      out += movesetSection(P);
      out += claudeSection();
      main.innerHTML = out;
      wirePlan(P);
    }, 30);
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
        ${tmOnly.length ? `<div class="lbl">If you have the TM</div><div class="moves">${tmOnly.map(x => moveChip(x.id, x.how)).join('')}</div>` : ''}</div>`;
    }).join('')}<p class="note">Picked to cover the most of this boss team with guaranteed damage, accuracy included. Hardcore-banned moves are left out.</p></div></details>`;
  }
  function claudeSection() {
    return `<section class="section" id="claude-sec" hidden><div class="head"><h2>Game plan from Claude</h2></div>
      <div class="card"><p class="note" style="margin:0">Claude turns the calculations above into a written plan. It only sees these numbers, so check anything surprising in the Battle tab.</p>
      <div class="row"><button class="btn primary" id="claude-go">Write a game plan</button><button class="btn" id="claude-stop" hidden>Stop</button></div>
      <div class="claude-out" id="claude-out" hidden></div></div></section>`;
  }
  async function wirePlan(P) {
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
    lines.push('\nWrite a concise game plan in plain text (no markdown tables, under 250 words): which six to bring and why, the lead, how to handle each of their Pokémon, and the two biggest dangers. Use only the numbers above and never invent damage numbers. If nothing beats one of their Pokémon safely, say so plainly and suggest what kind of Pokémon or move would fix it.');
    return lines.join('\n');
  }

  // ---------------- BATTLE ----------------
  function stepper(side, stat, val) {
    return `<div class="b"><span>${STAT_LABEL[stat]}</span><span class="stepper"><button type="button" data-boost="${side}:${stat}:-1" aria-label="Lower ${STAT_LABEL[stat]}">−</button><span>${val > 0 ? '+' + val : val}</span><button type="button" data-boost="${side}:${stat}:1" aria-label="Raise ${STAT_LABEL[stat]}">+</button></span></div>`;
  }
  function renderBattle() {
    const B = S.battle;
    if (B.boss == null) B.boss = S.planBoss != null ? S.planBoss : nextBoss();
    const p = party().length ? party() : alive();
    if (!p.length) {
      main.innerHTML = `<div class="empty">Add your Pokémon on the Team tab first.<button class="btn" id="bt-ex">Try an example team</button></div>`;
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
    const quick = `<section class="section">
      <div class="field"><label for="bt-boss">Boss</label><select id="bt-boss" class="inline">${bossOptions(B.boss)}</select></div>
      <div class="two">
      <div class="card"><div class="lbl">Their Pokémon</div><div class="chips">${team.map((t, j) => `<button class="chipbtn" data-them="${j}" aria-pressed="${j === B.them}">${esc(E.sp(t.s).n)}</button>`).join('')}</div>
        <div class="field"><label for="bt-themhp">Their HP: ${B.themHp}%</label><input type="range" id="bt-themhp" min="1" max="100" value="${B.themHp}"></div></div>
      <div class="card"><div class="lbl">Your Pokémon</div><div class="chips">${p.map(m => `<button class="chipbtn" data-me="${esc(m.key)}" aria-pressed="${m.key === B.me}">${esc(monName(m))}</button>`).join('')}</div>
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
    // options: attack with each move, or switch
    const options = [];
    for (const r of myRows) {
      if (!r.d) continue;
      const mm = E.matchup(Object.assign({}, meSpec, { mv: [r.id] }), themSpec, { weather, entry: false });
      options.push({ label: `Use ${E.mv(r.id).f}`, risk: mm.risk, m: mm });
    }
    for (const o of p) {
      if (o.key === B.me) continue;
      const spec = specOf(o, { entry: true });
      const hp = E.maxHP(spec);
      const best = theirRows.filter(x => x.d).sort((a, b) => b.d.max - a.d.max)[0];
      const threatOn = best ? E.damage(themSpec, spec, best.id, { weather, worst: true }) : null;
      const pEntry = threatOn ? E.faintChance(E.damageDist(themSpec, spec, best.id, weather, hp), hp, 1) : 0;
      const after = Math.max(1, 100 - (threatOn ? threatOn.maxPct : 0));
      const mm = E.matchup(Object.assign({}, spec, { hpPct: after }), themSpec, { weather });
      options.push({ label: `Switch to ${monName(o)}`, risk: pEntry + (1 - pEntry) * mm.risk, m: mm, entry: threatOn, pEntry });
    }
    options.sort((a, b) => (a.risk - b.risk) || ((a.m ? a.m.toKOthem : 99) - (b.m ? b.m.toKOthem : 99)) || ((b.m && b.m.best ? b.m.best.minPct : 0) - (a.m && a.m.best ? a.m.best.minPct : 0)));
    const rec = options[0];
    html += `<section class="section"><div class="card rec"><h3>${rec ? esc(rec.label) : 'No options'}${rec ? ' ' + verdictBadge({ verdict: rec.risk <= 1e-9 ? 'safe' : rec.risk <= 0.05 ? 'ok' : rec.risk <= 0.35 ? 'risky' : 'lose', risk: rec.risk }) : ''}</h3>
      <p class="small" style="margin:0">${mySpe > theirSpe ? 'You move first' : mySpe === theirSpe ? 'Speed tie: either can move first' : 'They move first'} (Spe ${mySpe} vs ${theirSpe}; priority moves go first).${rec && rec.entry ? ` Coming in takes up to ${pct(rec.entry.maxPct)}% from ${esc(rec.entry.moveName)}.` : ''}</p>
      <div class="answers">${options.slice(0, 4).map(o => `<div class="answer"><div class="top"><b>${esc(o.label)}</b>${verdictBadge({ verdict: o.risk <= 1e-9 ? 'safe' : o.risk <= 0.05 ? 'ok' : o.risk <= 0.35 ? 'risky' : 'lose', risk: o.risk })}</div>${o.m && o.m.best ? `<span class="small num">${esc(o.m.best.moveName)} ${pct(o.m.best.minPct)}–${pct(o.m.best.maxPct)}%, KO in ${isFinite(o.m.toKOthem) ? o.m.toKOthem : '∞'}</span>` : ''}</div>`).join('')}</div>
      <p class="note" style="margin:0">Risk = chance your Pokémon faints before it wins this 1-on-1 (or, for a switch, while coming in or after), if they use their strongest move each turn.</p></div></section>`;
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
    main.innerHTML = html;
    wireBattle();
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

  // ---------------- boot ----------------
  async function boot() {
    try { const t = localStorage.getItem('rrcoach:tab'); if (t) { S.tab = t; document.querySelectorAll('.tabs button').forEach(o => o.setAttribute('aria-selected', o.dataset.tab === t ? 'true' : 'false')); } } catch (e) {}
    if (!window.calc || !window.createEngine) { main.innerHTML = '<div class="empty">The damage calculator didn’t load. Check your connection and reload.</div>'; return; }
    try {
      const r = await fetch('rrdata.json'); if (!r.ok) throw new Error('HTTP ' + r.status);
      D = await r.json();
    } catch (e) { main.innerHTML = `<div class="empty">The game data didn’t load (${esc(e.message)}). Reload to try again.</div>`; return; }
    E = window.createEngine(window.calc, D);
    render();
    store.init();
  }
  boot();
})();
