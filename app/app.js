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

  let D = null, E = null, SIM = null, ADV = null, SR = null, FLOW = null;
  /** A fresh run's state: beaten bosses, skipped fights, areas moved past, the team picked in fights with versions. */
  function newRun(no, keep) {
    keep = keep || {};
    return { beaten: [], tms: [], enc: {}, dupes: keep.dupes !== false, checks: [], tutors: !!keep.tutors, no, started: null, starter: null,
      aiChecks: keep.aiChecks || null, bag: [], skipped: [], passed: [], variants: {}, postgame: false, care: !!keep.care, tr: {}, at: null };
  }
  let SPR = null;   // sprite index (sprites/index.json); without it the page simply shows no sprites
  const S = {
    roster: [], run: newRun(1), history: [], screen: 'run', routeFilter: 'todo', openArea: null, encTime: null, planBoss: null, example: false, plans: {}, planning: null,
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
  function specOf(m, extra) {
    const o = { key: m.key, s: m.s, lv: m.lv, nat: m.nat, ab: E.hardcoreAbility(m.ab, m.s), it: m.it || null, mv: (m.mv || []).filter(Boolean) };
    if (Array.isArray(m.iv) && m.iv.length === 6) o.iv = m.iv.slice();
    if (Array.isArray(m.ev) && m.ev.length === 6 && m.ev.some(Boolean)) o.ev = m.ev.slice();
    if (m.statsAt) o.exact = true;
    return Object.assign(o, extra || {});
  }
  function alive() { return S.roster.filter(m => m.box !== 'dead'); }
  function party() { return S.roster.filter(m => m.box === 'party'); }
  function milestonesDone() { return D.bosses.filter(b => b.ms && S.run.beaten.includes(b.i)).length; }
  function capNow() { return D.caps.hardcore[Math.min(milestonesDone(), 17)]; }
  /** The next fight on the path: the first boss you haven't beaten or skipped. */
  function nextBoss() {
    const skipped = new Set(S.run.skipped || []);
    const b = D.bosses.find(b => !b.route && !S.run.beaten.includes(b.i) && !(FLOW && skipped.has((FLOW.groupOf(b.i) || {}).first)));
    return b ? b.i : D.routeStart - 1;
  }
  /** Versions of one fight (the rival's three teams, a leader's alternates); separate Grunts stay separate (flow.js). */
  function variantsOf(i) { return FLOW ? FLOW.variantsOf(i) : [i]; }
  function bossLabel(b) { return `${b.n} (${b.cls})${b.v ? ' · has ' + b.v : ''}${b.dbl ? ' · double' : ''}`; }

  // ---------------- storage: your account (db), or this device ----------------
  const LS_KEY = 'rrcoach:v1';
  /** A stable string for a document body (key order doesn't matter), to recognize the echo of this page's own write. */
  function canon(v) {
    if (Array.isArray(v)) return '[' + v.map(x => canon(x === undefined ? null : x)).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
    return JSON.stringify(v === undefined ? null : v);
  }
  /** Database snapshots are frozen: the app only ever keeps its own plain copies. */
  const plain = v => (v == null ? v : JSON.parse(JSON.stringify(v)));
  function runFromDoc(run, histLen) {
    return { beaten: Array.isArray(run.beaten) ? run.beaten.slice() : [], tms: Array.isArray(run.tms) ? run.tms.slice() : [],
      enc: run.enc && typeof run.enc === 'object' ? Object.assign({}, run.enc) : {}, dupes: run.dupes !== false, checks: Array.isArray(run.checks) ? run.checks.slice(-50) : [], tutors: !!run.tutors,
      no: run.no || (histLen + 1), started: run.started || null, starter: run.starter || null, aiChecks: run.aiChecks || null, bag: Array.isArray(run.bag) ? run.bag.slice() : [],
      skipped: Array.isArray(run.skipped) ? run.skipped.slice() : [], passed: Array.isArray(run.passed) ? run.passed.slice() : [],
      variants: run.variants && typeof run.variants === 'object' ? Object.assign({}, run.variants) : {}, postgame: !!run.postgame, care: run.care != null ? !!run.care : run.anyItems !== false,
      tr: run.tr && typeof run.tr === 'object' ? Object.assign({}, run.tr) : {}, at: run.at || null };
  }
  const store = {
    mode: 'loading', ready: false, col: null, unsub: null, timer: null, note: '',
    loaded: false,
    mine: new Map(),   // document id -> canon() of this page's last write to it (null: deleted)
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
          if (!this.loaded) {
            // the first load (and a copy cached from an earlier visit before it): take everything, unless the page
            // has already saved something since
            if (!this.mine.size) this.applyAll(snap);
            if (!snap.metadata || !snap.metadata.fromCache) this.loaded = true;
            this.ready = true;
            render();
            return;
          }
          // after that, what's on the page is the truth: the echoes of its own saves are ignored (replacing the run
          // mid-way through starting a new one, or a battle turn, broke both), and only changes made elsewhere,
          // such as on another device, are applied, one document at a time
          let changed = false;
          for (const ch of snap.docChanges()) {
            const d = ch.doc;
            if (d.metadata && d.metadata.hasPendingWrites) continue;
            const body = ch.type === 'removed' ? null : d.data();
            if (this.mine.has(d.id) && this.mine.get(d.id).includes(body == null ? null : canon(body))) continue;   // one of its own recent saves, even an older one arriving late
            if (this.applyDoc(d.id, body)) changed = true;
          }
          if (changed) render();
        }, err => { clearTimeout(this.timer); this.ready = true; this.note = 'Saving to your account stopped working (' + err.code + '). Reload to try again.'; render(); });
      } else {
        this.mode = 'local';
        this.ready = true;
        try { const v = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); if (v) { S.roster = v.roster || []; S.history = v.history || []; S.run = Object.assign(newRun(S.history.length + 1), v.run || {}); ADV.setOptions({ tutors: S.run.tutors }); } } catch (e) { /* storage blocked */ }
        render();
      }
    },
    applyAll(snap) {
      const roster = [], history = [];
      let run = { beaten: [] };
      snap.docs.forEach(d => {
        const v = plain(d.data()); if (!v) return;
        if (d.id === 'run') run = Object.assign(run, v);
        else if (d.id.startsWith('mon-')) roster.push(Object.assign(v, { key: d.id }));
        else if (d.id.startsWith('hist-')) history.push(Object.assign(v, { id: d.id.slice(5) }));
      });
      S.history = history.sort((a, b) => (b.ended || 0) - (a.ended || 0));
      roster.sort((a, b) => (a.ord || 0) - (b.ord || 0));
      if (!S.example || roster.length) { S.roster = roster; S.example = false; }
      S.run = runFromDoc(run, history.length);
      ADV.setOptions({ tutors: S.run.tutors });
    },
    /** A change made elsewhere to one document: the run, one Pokemon or one past run. Returns whether anything changed. */
    applyDoc(id, body) {
      if (id === 'run') { if (!body) return false; S.run = runFromDoc(plain(body), S.history.length); ADV.setOptions({ tutors: S.run.tutors }); return true; }
      if (id.startsWith('mon-')) {
        const i = S.roster.findIndex(m => m.key === id);
        if (!body) { if (i < 0) return false; S.roster.splice(i, 1); return true; }
        const m = Object.assign(plain(body), { key: id });
        if (i >= 0) S.roster[i] = m; else { S.roster.push(m); S.roster.sort((a, b) => (a.ord || 0) - (b.ord || 0)); }
        return true;
      }
      if (id.startsWith('hist-')) {
        const hid = id.slice(5), i = S.history.findIndex(h => h.id === hid);
        if (!body) { if (i < 0) return false; S.history.splice(i, 1); return true; }
        const h = Object.assign(plain(body), { id: hid });
        if (i >= 0) S.history[i] = h; else S.history.push(h);
        S.history.sort((a, b) => (b.ended || 0) - (a.ended || 0));
        return true;
      }
      return false;
    },
    /** Write one document, remembering what was written so its echo isn't mistaken for a change from elsewhere. */
    remember(id, v) { const a = (this.mine.get(id) || []).concat([v]).slice(-12); this.mine.set(id, a); },
    async put(id, body) { this.remember(id, canon(body)); await this.col.doc(id).set(body); },
    async drop(id) { this.remember(id, null); await this.col.doc(id).delete(); },
    saveLocal() { try { localStorage.setItem(LS_KEY, JSON.stringify({ roster: S.roster, run: S.run, history: S.history })); } catch (e) { this.note = 'This browser blocked saving.'; } },
    async saveHist(h) {
      if (this.mode === 'db') { try { const body = plain(Object.assign({}, h, { id: undefined })); await this.put('hist-' + h.id, body); } catch (e) { flash('Couldn’t save the run to your history (' + e.code + ').'); } }
      else this.saveLocal();
    },
    async deleteHist(id) {
      if (this.mode === 'db') { try { await this.drop('hist-' + id); } catch (e) { flash('Couldn’t delete (' + e.code + ').'); } }
      else this.saveLocal();
    },
    async saveMon(m) {
      if (S.example) return;
      const body = { s: m.s, nick: m.nick || '', lv: m.lv, nat: m.nat, ab: m.ab, it: m.it || null, mv: m.mv, box: m.box, met: m.met || '', ord: m.ord || Date.now(), pid: m.pid || null, died: m.died || null, noEvo: !!m.noEvo,
        iv: m.iv || null, ev: m.ev || null, ivGuess: !!m.ivGuess, statsAt: m.statsAt || null };
      if (this.mode === 'db') { try { await this.put(m.key, plain(body)); } catch (e) { flash('Couldn’t save to your account (' + e.code + ').'); } }
      else this.saveLocal();
    },
    async deleteMon(key) {
      if (S.example) return;
      if (this.mode === 'db') { try { await this.drop(key); } catch (e) { flash('Couldn’t delete (' + e.code + ').'); } }
      else this.saveLocal();
    },
    async saveRun() {
      if (S.example) return;
      if (!S.run.started && S.roster.length) S.run.started = Math.min(...S.roster.map(m => m.ord || Date.now()));
      if (this.mode === 'db') { try { await this.put('run', plain({ beaten: S.run.beaten, tms: S.run.tms || [], enc: S.run.enc || {}, dupes: S.run.dupes !== false, checks: (S.run.checks || []).slice(-50), tutors: !!S.run.tutors, aiChecks: S.run.aiChecks || null, bag: S.run.bag || [],
        no: S.run.no || 1, started: S.run.started || null, starter: S.run.starter || null,
        skipped: S.run.skipped || [], passed: S.run.passed || [], variants: S.run.variants || {}, postgame: !!S.run.postgame, care: !!S.run.care, tr: S.run.tr || {}, at: S.run.at || null })); } catch (e) { flash('Couldn’t save progress (' + e.code + ').'); } }
      else this.saveLocal();
    },
  };
  // ---------------- messages and celebrations ----------------
  const REDUCE = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  let toastTimer = null;
  /** A message in a game-style text box that slides up from the bottom, then goes away. */
  function flash(msg) {
    let el = $('#toast');
    if (!el) {
      el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status');
      el.onclick = () => el.classList.remove('on');
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('on'), 4500);
  }
  let celeTimer = null;
  /** A moment worth marking (a catch, a win, the Hall of Fame), over the page; tap or wait to go on. */
  function celebrate(html, ms, cls) {
    let el = $('#cele');
    if (!el) {
      el = document.createElement('div'); el.id = 'cele'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-live', 'polite');
      el.onclick = () => closeCele();
      document.body.appendChild(el);
    }
    el.className = 'cele ' + (cls || '');
    el.innerHTML = `<div class="cele-card">${html}<span class="cele-tap">Tap to continue</span></div>`;
    el.hidden = false; void el.offsetWidth; el.classList.add('on');
    clearTimeout(celeTimer); celeTimer = setTimeout(closeCele, REDUCE ? Math.min(ms, 2600) : ms);
  }
  let celeWaiters = [];
  function closeCele() {
    const el = $('#cele'); if (!el) return;
    el.classList.remove('on'); clearTimeout(celeTimer);
    setTimeout(() => { if (!el.classList.contains('on')) { el.hidden = true; el.innerHTML = ''; } }, 260);
    const w = celeWaiters; celeWaiters = []; setTimeout(() => w.forEach(f => f()), 280);
  }
  /** Resolves once no celebration is on screen. */
  function afterCele() { const el = $('#cele'); return el && el.classList.contains('on') ? new Promise(r => celeWaiters.push(r)) : Promise.resolve(); }
  function celebrateCatch(sid, how) {
    const sp = E.sp(sid); if (!sp) return;
    const line = how === 'starter' ? `You chose ${sp.n}!` : how === 'gift' ? `You received ${sp.n}!` : `Gotcha! ${sp.n} was caught!`;
    const sub = how === 'starter' ? 'Your partner for this run.' : how === 'box' ? 'Sent to your box.' : 'Added to your party.';
    celebrate(`<div class="catch-scene"><div class="catch-mon">${front(sid, 'x2')}</div><div class="pball" aria-hidden="true"><i></i></div>
        <div class="stars" aria-hidden="true">${[0, 1, 2, 3, 4, 5].map(k => `<i style="--k:${k}"></i>`).join('')}</div></div>
      <div class="cele-text">${esc(line)}</div><div class="cele-sub">${esc(sub)}</div>`, 3600, 'is-catch');
  }
  function celebrateWin(b, capBefore, capAfter, dead) {
    const badge = b.ms && /Badge/.test(b.ms) ? b.ms : null;
    celebrate(`<div class="cele-kicker">${esc(b.cls)} ${esc(b.n)} was defeated!</div>
      ${badge ? `<div class="badge-big">${badgeSVG(badge)}</div><div class="cele-text">You earned the ${esc(badge)}!</div>` : `<div class="cele-text">${b.ms ? 'Milestone cleared!' : 'Victory!'}</div>`}
      ${capAfter !== capBefore ? `<div class="capchg">Level cap <b class="from">${capBefore}</b> → <b class="to">${capAfter}</b></div>` : ''}
      ${dead.length ? `<div class="lost">${dead.map(m => `<span class="t">${icon(m.s)}<span>${esc(monShort(m))}</span></span>`).join('')}<span class="small muted">fainted</span></div>` : '<div class="cele-sub">No losses.</div>'}`,
    badge || capAfter !== capBefore ? 4400 : 2600, 'is-win');
  }
  function celebrateHoF() {
    const team = party().length ? party() : alive().slice(0, 6);
    celebrate(`<div class="cele-kicker">Welcome to the Hall of Fame!</div>
      <div class="hof">${team.map((m, k) => `<span class="hof-mon" style="--k:${k}">${front(m.s)}<span>${esc(monShort(m))}<small>Lv ${m.lv}</small></span></span>`).join('')}</div>
      <div class="cele-text">Run #${S.run.no || S.history.length + 1} beat the Champion.</div>`, 7000, 'is-hof');
  }
  /** The eight gym badges as small shapes in their colors (off: an outline). */
  function badgeSVG(name, off) {
    const k = BADGES.indexOf(name);
    const star = (n, r1, r2) => Array.from({ length: n * 2 }, (_, i) => { const a = Math.PI * i / n - Math.PI / 2, r = i % 2 ? r2 : r1; return `${(12 + r * Math.cos(a)).toFixed(1)},${(12 + r * Math.sin(a)).toFixed(1)}`; }).join(' ');
    const shapes = [
      '<path d="M8 2h8l6 6v8l-6 6H8l-6-6V8z"/>',
      '<path d="M12 2c4 6 7 9.5 7 13a7 7 0 0 1-14 0c0-3.5 3-7 7-13z"/>',
      `<polygon points="${star(8, 11, 5)}"/>`,
      '<circle class="p1" cx="12" cy="6.5" r="5"/><circle class="p2" cx="17.5" cy="12" r="5"/><circle class="p3" cx="12" cy="17.5" r="5"/><circle class="p4" cx="6.5" cy="12" r="5"/><circle class="c" cx="12" cy="12" r="3"/>',
      '<path d="M12 21C5 15 2 11.5 2 8a5 5 0 0 1 10-1 5 5 0 0 1 10 1c0 3.5-3 7-10 13z"/>',
      '<circle cx="12" cy="12" r="10"/><circle class="c" cx="12" cy="12" r="4.5"/>',
      '<path d="M12 1c2.5 4.5 7 7.5 7 13a7 7 0 0 1-14 0c0-3 1.4-5.2 3-6.8.3 2 1.3 3.2 2.4 3.6C9.6 7.6 10.5 4 12 1z"/>',
      '<path d="M12 1l9 11-9 11-9-11z"/>',
    ];
    return `<svg viewBox="0 0 24 24" class="badge b${k}${off ? ' off' : ''}" role="img" aria-label="${esc(name)}${off ? ' (not yet)' : ''}">${shapes[k] || '<circle cx="12" cy="12" r="10"/>'}</svg>`;
  }
  function badgesHTML() {
    const got = new Set(D.bosses.filter(b => b.ms && /Badge/.test(b.ms) && S.run.beaten.includes(b.i)).map(b => b.ms));
    return `<div class="badges" aria-label="Badges: ${got.size} of 8">${BADGES.map(n => badgeSVG(n, !got.has(n))).join('')}</div>`;
  }

  function renderStatus() {
    const el = $('#status'); if (!el || !D) return;
    const nb = D.bosses[nextBoss()];
    const where = S.example ? '<span class="pill warn">Example team, not saved</span>'
      : store.mode === 'db' ? '<span class="pill">Saved to your account</span>'
      : store.mode === 'local' ? '<span class="pill warn">Saved on this device only</span>' : '<span class="pill">Loading…</span>';
    el.innerHTML = `<span class="pill cap">Cap ${capNow()}</span><span class="pill">Next: ${esc(nb.n)}</span>${where}` +
      (store.note ? `<span class="pill warn">${esc(store.note)}</span>` : '');
  }

  // ---------------- screens: your run, and the tools in the menu ----------------
  const SCREENS = { run: 'Your run', team: 'Pokémon', areas: 'All areas', fight: 'Plan any fight', check: 'Quick check', runs: 'Past runs & starters' };
  function go(screen) {
    if (screen === 'newrun') { toggleMenu(false); startNewRun(); return; }
    S.screen = SCREENS[screen] ? screen : 'run';
    toggleMenu(false);
    render();
    main.classList.remove('screen-in'); void main.offsetWidth; main.classList.add('screen-in');
    window.scrollTo(0, 0);
  }
  function toggleMenu(open) {
    const menu = $('#menu'), btn = $('#menu-btn'); if (!menu || !btn) return;
    const on = open == null ? menu.hidden : open;
    menu.hidden = !on; btn.setAttribute('aria-expanded', on ? 'true' : 'false');
  }
  document.addEventListener('click', e => {
    const g = e.target.closest('[data-go]');
    if (g) { e.preventDefault(); go(g.dataset.go); return; }
    if (e.target.closest('#menu-btn')) { toggleMenu(); return; }
    if (!e.target.closest('#menu')) toggleMenu(false);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') toggleMenu(false); });

  function render() {
    if (!D) return;
    stopStages();
    renderStatus();
    const scr = S.screen || 'run';
    const back = $('#backbar');
    if (back) { back.hidden = scr === 'run'; const t = back.querySelector('b'); if (t) t.textContent = SCREENS[scr] || ''; }
    document.querySelectorAll('#menu [data-go]').forEach(b => b.setAttribute('aria-current', b.dataset.go === scr ? 'page' : 'false'));
    if (scr === 'run') renderRun();
    else if (scr === 'team') renderTeam();
    else if (scr === 'areas') renderRoutes();
    else if (scr === 'fight') renderPlan();
    else if (scr === 'runs') renderRuns();
    else renderWhatIf('');
  }

  // ---------------- TEAM ----------------
  // ---------------- stats as the game shows them: base, level, IVs, EVs, nature ----------------
  const STATS6 = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
  const STAT_FULL = { hp: 'HP', atk: 'Attack', def: 'Defense', spa: 'Sp. Atk', spd: 'Sp. Def', spe: 'Speed' };
  function statOf(k, base, lv, iv, ev, nat) {
    const core = Math.floor((2 * base + iv + Math.floor(ev / 4)) * lv / 100);
    if (k === 'hp') return base === 1 ? 1 : core + lv + 10;
    const n = D.natures[nat] || {};
    return Math.floor((core + 5) * (n.u === k ? 110 : n.d === k ? 90 : 100) / 100);
  }
  const ivOf = m => (Array.isArray(m.iv) && m.iv.length === 6 ? m.iv : [31, 31, 31, 31, 31, 31]);
  const evOf = m => (Array.isArray(m.ev) && m.ev.length === 6 ? m.ev : [0, 0, 0, 0, 0, 0]);
  function monStats(m, lv) {
    const b = E.sp(m.s).s, iv = ivOf(m), ev = evOf(m);
    return Object.fromEntries(STATS6.map((k, i) => [k, statOf(k, b[i], lv || m.lv, iv[i], ev[i], m.nat)]));
  }
  /** The IVs (a range at low levels) and EVs that give the stats your game shows; null for a stat nothing explains. */
  function readStats(m, shown) {
    const b = E.sp(m.s).s;
    return STATS6.map((k, i) => {
      const v = shown[i];
      if (!(v > 0)) return null;
      const ok = [];
      for (let iv = 0; iv <= 31; iv++) if (statOf(k, b[i], m.lv, iv, 0, m.nat) === v) ok.push(iv);
      if (ok.length) return { lo: ok[0], hi: ok[ok.length - 1], ev: 0 };
      for (let ev = 4; ev <= 252; ev += 4) if (statOf(k, b[i], m.lv, 31, ev, m.nat) === v) return { lo: 31, hi: 31, ev };   // EVs from battles
      return null;
    });
  }
  /** Keep what the stats say: IVs in the middle of what fits (narrowed by earlier entries), EVs, and the numbers themselves. */
  function setStats(m, shown) {
    const fit = readStats(m, shown);
    if (fit.some(x => !x)) return fit;
    const prev = m.statsAt && m.statsAt.ivr;
    const ivr = fit.map((x, i) => {
      if (prev && prev[i] && !x.ev) { const lo = Math.max(x.lo, prev[i][0]), hi = Math.min(x.hi, prev[i][1]); if (lo <= hi) return [lo, hi]; }
      return [x.lo, x.hi];
    });
    m.iv = ivr.map(([lo, hi]) => Math.round((lo + hi) / 2));
    m.ev = fit.map(x => x.ev);
    m.statsAt = { lv: m.lv, s: m.s, st: shown.slice(), ivr };
    m.ivGuess = false;
    return fit;
  }
  /** Where its IVs come from, in words. */
  function ivSource(m) {
    if (m.statsAt) return `From your game's numbers at Lv ${m.statsAt.lv}.`;
    if (m.ivGuess) return 'Perfect IVs assumed, except Speed: estimated from who moved first in a battle.';
    return 'Perfect IVs (31) assumed. Enter the numbers from your game to make every plan exact.';
  }

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
        <button class="btn small primary" data-act="mon">Level &amp; advice</button>
        <button class="btn small" data-act="edit">Edit</button>
        <button class="btn small" data-act="advice">Move plan</button>
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
        <p class="small" style="max-width:46ch;margin:0">Enter each Pokémon as you catch it: species, level, nature, ability, item and moves. The Coach then plans every Hardcore boss fight with them: lineup, lead and every turn.</p>
        <div class="row" style="justify-content:center"><button class="btn primary" data-act="add">Add a Pokémon</button><button class="btn" data-act="import">Import save file</button><button class="btn" data-act="example">Try an example team</button></div></div>`;
      main.innerHTML = html; wireTeam(); return;
    }
    if (!S.example && S.roster.length && !alive().length) html += `<div class="banner" style="display:grid;gap:8px"><b>Every Pokémon you had has fainted: that's a wipe.</b><span>Save this run to your history and start fresh in one step.</span><div><button class="btn primary" data-act="endrun">End this run…</button></div></div>`;
    // the party menu, as the game lays it out: the lead on the left, the other five on the right
    html += `<section class="section"><div class="pm" role="group" aria-label="Your party">
        <div class="pm-grid">${partySlotHTML(p[0], 0)}<div class="pm-rest">${[1, 2, 3, 4, 5].map(k => partySlotHTML(p[k], k)).join('')}</div></div>
        <div class="pm-msg"><span class="pm-say">${p.length ? 'Choose a Pokémon.' : 'No Pokémon in your party. Move some from your box.'}</span>
          <span class="pm-btns"><button class="pm-btn" data-act="add">Add</button><button class="pm-btn" data-act="import">Import save</button></span></div>
      </div></section>`;
    if (box.length) html += `<section class="section"><div class="head"><h2>PC box</h2><span class="note">${box.length} Pokémon · tap one to see it</span></div>
      <div class="pc">${box.map(m => `<button class="pc-mon" data-mon="${esc(m.key)}" aria-label="${esc(monName(m))}, level ${m.lv}">${icon(m.s)}<span>Lv${m.lv}</span>${m.it ? '<i class="pm-held"></i>' : ''}</button>`).join('')}</div></section>`;
    if (dead.length) html += `<section class="section"><div class="head"><h2>Graveyard</h2></div><div class="graveyard">${dead.map(m => `<div class="grave-slot">${graveHTML(m)}<span class="small muted">${esc(deathLine(m))}</span></div>`).join('')}</div>
      <details class="more"><summary>Edit the fallen (${dead.length})</summary><div class="section" style="margin-top:8px">${dead.map(monCard).join('')}</div></details></section>`;
    html += tmCaseHTML();
    html += bagHTML();
    main.innerHTML = html;
    wireTeam();
    wireTMCase();
    wireBag();
    main.querySelectorAll('[data-mon]').forEach(b => b.onclick = () => { const m = S.roster.find(x => x.key === b.dataset.mon); if (m) openMon(m); });
  }
  /** One slot of the party menu: icon (with a held-item mark), name, level, HP bar and HP. */
  function partySlotHTML(m, k) {
    if (!m) return `<div class="pm-slot pm-empty" aria-hidden="true"></div>`;
    const sp = E.sp(m.s), hp = monStats(m).hp;
    return `<button class="pm-slot${k === 0 ? ' pm-lead' : ''}" data-mon="${esc(m.key)}" aria-label="${esc(monName(m))}, level ${m.lv}${m.it ? ', holds ' + esc(E.itemName(m.it)) : ''}">
      <span class="pm-ico">${icon(m.s)}${m.it ? '<i class="pm-held"></i>' : ''}</span>
      <span class="pm-name">${esc(m.nick || sp.n)}</span>
      <span class="pm-lv">Lv${m.lv}${m.lv > capNow() ? ' <span class="pm-over">over cap</span>' : ''}</span>
      <span class="pm-hp"><b>HP</b><span class="pm-bar"><i></i></span></span>
      <span class="pm-hpn">${hp}/${hp}</span>
    </button>`;
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
    return `<label class="switch"><input type="checkbox" id="care-on" ${S.run.care ? 'checked' : ''}><span><b>I entered the care package code (SO2Toxic)</b><span class="note" style="display:block">Radical Red then hands you items at ${(D.care || []).length} checkpoints. The Coach suggests only what it has given you so far. (Woyaopp is the Rare Candy code: the youngster in Viridian City.)</span></span></label>
      ${S.run.care ? carePackagesHTML() : ''}
      <details class="more" id="bag" ${S.bagOpen ? 'open' : ''}><summary>Held items you have (${have.size})</summary>
      <p class="note">Tick the held items you own. Each fight then suggests which Pokémon should hold what.</p>
      <input class="search" id="bag-filter" placeholder="Filter items" style="margin:6px 0;width:100%">
      <div class="tmgrid">${heldItems().map(x => `<label class="tm" data-q="${esc(x.n.toLowerCase())}"><input type="checkbox" data-bag="${x.id}" ${have.has(x.id) ? 'checked' : ''}><span>${esc(x.n)}${where(x.id) ? `<span class="note" style="display:block">${esc(where(x.id))}</span>` : ''}</span></label>`).join('')}</div></details>`;
  }
  function wireBag() {
    const ai = $('#care-on'); if (ai) ai.onchange = async () => { S.run.care = ai.checked; TUNE.clear(); CARE = null; flash(ai.checked ? 'Held-item tips now include the care package items you’ve got so far.' : 'Held-item tips now use only the items you’ve ticked.'); render(); await store.saveRun(); };
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
    const pool = itemPool();
    const candidates = [...pool.keys()].filter(id => (D.items[id] || {}).c);
    const score = (m, it) => itemScore(m, it, team);
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
      html += `<p class="note">Move advice uses ${tms.length} TM${tms.length === 1 ? '' : 's'} from your TM case. Tick TMs under Pokémon as you get them.</p></div>`;
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
      else if (act === 'mon') openMon(m);
      else if (act === 'advice') openAdvice(m);
      else if (act === 'move') { m.box = m.box === 'party' ? 'box' : 'party'; render(); await store.saveMon(m); }
      else if (act === 'faint') {
        btn.textContent = 'Confirm: mark as fainted'; btn.dataset.act = 'faint2'; btn.classList.add('primary');
        btn.addEventListener('click', async () => { m.box = 'dead'; m.died = { at: Date.now(), before: D.bosses[nextBoss()].n }; render(); funeral([m]); await store.saveMon(m); }, { once: true });
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

  // ---------------- keeping your team up to date: levels, new moves, evolutions, natures, held items ----------------
  const LEVEL_EVO = new Set([4, 8, 9, 10, 11, 12, 13, 20, 21, 22, 23, 31, 32]);
  /** Level-up moves a species learns at exactly this level (0: on evolving). */
  function movesAt(sid, lv) { const L = D.learn[sid]; return L ? [...new Set(L.l.filter(([l, id]) => l === lv && E.mv(id)).map(([, id]) => id))] : []; }
  /** What it can evolve into by leveling up to `lv` ([] if nothing). Some branch: day or night, male or female, Attack vs Defense. */
  function levelEvolutions(sid, lv) { return (D.evo[sid] || []).filter(([to, method, param]) => LEVEL_EVO.has(method) && param <= lv && E.sp(to)).map(([to, , , how]) => ({ to, how })); }
  function levelEvolution(sid, lv) { const l = levelEvolutions(sid, lv); return l.length ? l[0].to : null; }
  /** Which form it's evolving into: the only one, or the one the player saw (null: it didn't evolve). */
  async function whichEvolution(m, lv) {
    const opts = levelEvolutions(m.s, lv);
    if (opts.length < 2) return opts.length ? opts[0].to : null;
    const nm = m.nick || E.sp(m.s).n;
    const a = await ask(`<div class="cele-kicker">What? ${esc(nm)} is evolving!</div>
      <p class="small" style="margin:0">It can become ${opts.length === 2 ? 'either of these' : 'one of these'}. Which one is it turning into in your game?</p>
      <div class="evo-pick">${opts.map(o => `<button class="btn" data-answer="${o.to}">${icon(o.to, 'x2')}<span><b>${esc(E.sp(o.to).n)}</b><small>${esc(o.how)}</small></span></button>`).join('')}</div>
      <button class="btn ghost" data-answer="none">I stopped it</button>`);
    return a === 'none' ? null : +a;
  }
  // ---------------- the care package cheat (code SO2Toxic): items at checkpoints, read from the ROM ----------------
  let HELD_SET = null;
  function heldSet() { if (!HELD_SET) HELD_SET = new Set(heldItems().map(x => x.id)); return HELD_SET; }
  /** Where a package is on the run path (for ordering): its area's step, or the fight that wins its badge. */
  function careOrder(pk, P) {
    const k = P.steps.findIndex(st => pk.after === 'Champion' ? st.step.kind === 'champion'
      : pk.after ? st.step.kind === 'fight' && st.step.g.members.some(i => D.bosses[i].ms === pk.after)
      : st.step.kind === 'areas' && st.step.areas.includes(pk.area));
    return k < 0 ? 1e9 : k;
  }
  /** Has the run reached this package? Its badge (or the Champion) is won, or its area is behind you or has an encounter logged. */
  function carePassed(pk, P) {
    if (pk.after === 'Champion') return !!S.run.postgame || !!(FLOW.champ && FLOW.champ.members.some(i => S.run.beaten.includes(i)));
    if (pk.after) return D.bosses.some((b, i) => b.ms === pk.after && S.run.beaten.includes(i));
    if ((S.run.enc || {})[pk.area]) return true;
    return P.steps.some((st, k) => k < P.current && st.step.kind === 'areas' && st.step.areas.includes(pk.area));
  }
  function careWhere(pk) { return pk.after === 'Champion' ? 'from Mom after you become Champion' : pk.after ? `after the ${pk.after}` : `in ${pk.area}`; }
  let CARE = null;
  /** The care package so far: packages in run order (got or not), items handed over (id -> where) and items still to come. */
  function careState() {
    const key = JSON.stringify([!!S.run.care, S.run.beaten, Object.keys(S.run.enc || {}), S.run.passed, S.run.skipped, !!S.run.postgame, !!S.run.started]);
    if (CARE && CARE.key === key) return CARE;
    const P = runProgress();
    const list = (D.care || []).map(pk => ({ pk, got: carePassed(pk, P), at: careOrder(pk, P) })).sort((a, b) => a.at - b.at);
    const now = new Map(), later = new Map();
    if (S.run.care) for (const x of list) for (const [id] of x.pk.items) {
      if (x.got) { if (!now.has(id)) now.set(id, careWhere(x.pk)); }
      else if (!later.has(id)) later.set(id, careWhere(x.pk));
    }
    for (const id of now.keys()) later.delete(id);
    CARE = { key, list, now, later };
    return CARE;
  }
  function carePackagesHTML() {
    const C = careState();
    const next = C.list.find(x => !x.got);
    const names = pk => pk.items.map(([id, q]) => E.itemName(id) + (q !== 10 ? ` ×${q}` : '')).join(', ');
    return `<details class="more"><summary>Care package: ${C.list.filter(x => x.got).length} of ${C.list.length} so far${next ? ` · next ${esc(careWhere(next.pk))}` : ''}</summary>
      <div class="care-list">${C.list.map(x => `<div class="care-row${x.got ? ' got' : ''}"><span class="care-mark" aria-hidden="true">${x.got ? '✓' : '○'}</span><div><b>${esc(careWhere(x.pk).replace(/^in /, ''))}</b><span class="small muted"> ${esc(names(x.pk))}</span></div></div>`).join('')}</div>
      <p class="note" style="margin:0">Hardcore Mode leaves some items out (weather rocks, terrain seeds, Weakness Policy, Throat Spray, Air Balloon, Terrain Extender, EV items). Each checkpoint is a spot you walk over in that area, except the three after gym wins and Mom's after the Champion.</p></details>`;
  }
  /** Items the advice may hand out: the care package so far, what you've ticked, and what your team holds. */
  function itemPool() {
    const pool = new Map(), held = heldSet();
    for (const id of careState().now.keys()) if (held.has(id)) pool.set(id, 10);
    for (const id of S.run.bag || []) pool.set(id, (pool.get(id) || 0) + 1);
    for (const m of S.roster) if (m.it && m.box !== 'dead') pool.set(m.it, (pool.get(m.it) || 0) + 1);
    return pool;
  }
  /** Care package items that haven't come yet, for "better later" tips (id -> where it comes). */
  function laterPool() { const held = heldSet(), out = new Map(); for (const [id, w] of careState().later) if (held.has(id)) out.set(id, w); return out; }
  function itemFrom(id) { const w = careState().now.get(id); return w ? `care package, ${w}` : (S.run.bag || []).includes(id) ? 'in your bag' : 'one of your Pokémon holds it'; }
  /** The Pokemon as it will fight: at the level cap (or above) and evolved by then, unless you stopped its evolution. */
  function fightForm(m, cap) {
    const lv = Math.max(m.lv, cap);
    if (lv === m.lv) return m;
    const out = Object.assign({}, m, { lv });
    const to = m.noEvo ? m.s : evolvedBy(m.s, lv);
    if (to !== m.s && E.sp(to)) { const slot = E.sp(m.s).a.indexOf(m.ab); out.s = to; out.ab = E.sp(to).a[slot >= 0 ? slot : 0] || E.sp(to).a[0]; }
    return out;
  }
  function formNote(m, f) { return f === m ? '' : `at Lv ${f.lv}${f.s !== m.s ? ' as ' + E.sp(f.s).n : ''}`; }
  /** How one Pokemon holding one item does against a boss team (safe 3 ... lose 0, minus the chance of fainting). */
  function itemScore(m, it, team) {
    const VS = { safe: 3, ok: 2, risky: 1, lose: 0 };
    let spec = specOf(m, { it });
    const mega = it && SIM.megaTarget({ spec, item: it });
    if (mega) spec = Object.assign({}, spec, { s: mega, ab: (E.sp(mega).a || [])[0] || spec.ab });
    return team.reduce((sum, t) => { const mu = E.matchup(Object.assign({}, spec, { entry: true }), Object.assign({}, t, { entry: true })); return sum + VS[mu.verdict] - mu.risk; }, 0);
  }

  /** A question over the page that waits for an answer: resolves with the data-answer of the button tapped. */
  function ask(html, cls) {
    return new Promise(resolve => {
      let el = $('#ask');
      if (!el) { el = document.createElement('div'); el.id = 'ask'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); document.body.appendChild(el); }
      el.className = 'cele ask ' + (cls || '');
      el.innerHTML = `<div class="cele-card ask-card">${html}</div>`;
      el.hidden = false; void el.offsetWidth; el.classList.add('on');
      el.querySelectorAll('[data-answer]').forEach(b => b.onclick = ev => {
        ev.stopPropagation();
        el.classList.remove('on');
        setTimeout(() => { if (!el.classList.contains('on')) { el.hidden = true; el.innerHTML = ''; } }, 220);
        resolve(b.dataset.answer);
      });
      const first = el.querySelector('[data-answer].primary, [data-answer]'); if (first) first.focus({ preventScroll: true });
    });
  }
  /** "Totodile wants to learn Bite": learn it (and what to forget) or skip, with the Coach's advice. */
  async function offerMove(m, id, when) {
    const mv = E.mv(id), sp = E.sp(m.s);
    if (!mv || (m.mv || []).includes(id)) return;
    if (E.isBanned(id, sp.g)) return;   // Hardcore won't let your Pokemon learn it
    const nm = m.nick || sp.n;
    if ((m.mv || []).length < 4) { m.mv = (m.mv || []).concat(id); flash(`${nm} learned ${mv.f}!`); return; }
    const adv = ADV.learnAdvice(specOf(m), id, nextBoss(), 2);
    const answer = await ask(`<div class="cele-kicker">${esc(nm)} wants to learn ${esc(mv.f)}</div>
      <div class="moves" style="width:100%">${moveChip(id, when)}</div>
      <p class="small" style="margin:0;text-align:left"><b>${adv.learn ? `Coach: learn it and forget ${esc(E.mv(adv.forget).f)}.` : 'Coach: skip it.'}</b> ${esc(adv.reason)}</p>
      <div class="lbl" style="justify-self:start">Forget which move?</div>
      <div class="cmd-moves" style="width:100%">${m.mv.map(x => { const k = E.mv(x); if (!k) return ''; const pick = adv.learn && adv.forget === x;
        return `<button class="mvbtn${pick ? ' pick' : ''}" data-answer="${x}" style="--t:${TYPE_COLORS[k.t] || '#888888'}"><span class="mvn">${esc(k.f)}</span><span class="mvm">${esc(k.t)} · ${k.k === 'X' ? 'status' : (k.p > 1 ? k.p : '—')}</span>${pick ? '<span class="cp">Coach pick</span>' : ''}</button>`; }).join('')}</div>
      <button class="btn${adv.learn ? '' : ' primary'}" data-answer="skip">Don't learn ${esc(mv.f)}</button>`);
    if (answer === 'skip') { flash(`${nm} did not learn ${mv.f}.`); return; }
    const forget = +answer;
    m.mv = m.mv.map(x => (x === forget ? id : x));
    flash(`${nm} forgot ${E.mv(forget).f} and learned ${mv.f}!`);
  }
  /** The game's evolution scene: the sprite flashes between the two forms, faster and faster. Resolves false if stopped. */
  function evolveScene(m, to) {
    const from = E.sp(m.s), into = E.sp(to), nm = m.nick || from.n;
    return new Promise(resolve => {
      let el = $('#ask');
      if (!el) { el = document.createElement('div'); el.id = 'ask'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); document.body.appendChild(el); }
      el.className = 'cele ask evo';
      el.innerHTML = `<div class="cele-card evo-card"><div class="evo-stage"><span class="evo-a">${front(m.s, 'x2')}</span><span class="evo-b">${front(to, 'x2')}</span></div>
        <div class="cele-text evo-text" aria-live="polite">What? ${esc(nm)} is evolving!</div>
        <div class="row" style="justify-content:center"><button class="btn small ghost" id="evo-stop">Stop it, keep ${esc(from.n)}</button></div></div>`;
      el.hidden = false; void el.offsetWidth; el.classList.add('on');
      const card = el.querySelector('.evo-card'), text = el.querySelector('.evo-text');
      let settled = false;
      const close = ok => { el.classList.remove('on'); setTimeout(() => { if (!el.classList.contains('on')) { el.hidden = true; el.innerHTML = ''; } }, 220); resolve(ok); };
      const timer = setTimeout(() => {
        if (settled) return; settled = true;
        card.classList.add('done');
        text.textContent = `Congratulations! Your ${nm} evolved into ${into.n}!`;
        const row = card.querySelector('.row'); row.innerHTML = '<button class="btn primary" id="evo-ok">Continue</button>';
        $('#evo-ok').onclick = () => close(true);
        $('#evo-ok').focus({ preventScroll: true });
      }, REDUCE ? 700 : 3700);
      $('#evo-stop').onclick = ev => {
        ev.stopPropagation();
        if (settled) return; settled = true; clearTimeout(timer);
        card.classList.add('stopped');
        text.textContent = `Huh? ${nm} stopped evolving!`;
        setTimeout(() => close(false), 1300);
      };
    });
  }
  /** Level up to `target` the way the game does: each level's new moves (with the Coach's advice), then any evolution. */
  async function levelUp(m, target, onLevel) {
    target = Math.max(1, Math.min(100, Math.round(target)));
    if (target <= m.lv) { m.lv = target; render(); await store.saveMon(m); return; }
    for (let L = m.lv + 1; L <= target; L++) {
      m.lv = L;
      if (onLevel) { onLevel(m); if (!REDUCE) await new Promise(r => setTimeout(r, 150)); }
      for (const id of movesAt(m.s, L)) await offerMove(m, id, `Lv ${L}`);
      if (!m.noEvo && levelEvolution(m.s, L)) {
        const to = await whichEvolution(m, L);
        if (to && await evolveScene(m, to)) {
          evolveMon(m, to);
          if (onLevel) onLevel(m);
          for (const id of movesAt(m.s, 0).concat(movesAt(m.s, L))) await offerMove(m, id, 'on evolving');
        } else m.noEvo = true;
      }
    }
    render();
    await store.saveMon(m);
  }
  async function levelPartyTo(cap) {
    const shown = new Map(party().map(m => [m.key, m.s]));
    const tick = m => {
      const evolved = shown.get(m.key) !== m.s; shown.set(m.key, m.s);
      main.querySelectorAll(`[data-edit="${CSS.escape(m.key)}"]`).forEach(b => {
        const lv = b.querySelector('.lv'); if (lv) { lv.textContent = 'Lv ' + m.lv; lv.classList.remove('tick'); void lv.offsetWidth; lv.classList.add('tick'); }
        if (!evolved) return;
        const nm = b.querySelector('.nm'); if (nm) nm.textContent = monShort(m);
        const ic = b.querySelector('.ico'); if (ic && icon(m.s, 'hop')) ic.outerHTML = icon(m.s, 'hop');
      });
    };
    for (const m of party().filter(x => x.lv < cap)) await levelUp(m, cap, tick);
  }

  /** One Pokemon at a glance: level ticker, moves, evolution, and the Coach's nature and held item for the next fight. */
  /** The summary, as the game's: Info (ability, nature, held item), Stats (yours, or your game's numbers), Moves; levels at the top. */
  function openMon(m) {
    document.body.style.overflow = 'hidden';
    sheet.hidden = false;
    const owner = {}; sheet._owner = owner;   // late work for this sheet stops once another one opens
    const mine = () => sheet._owner === owner && !sheet.hidden;
    const close = () => { sheet._owner = null; sheet.hidden = true; sheet.innerHTML = ''; document.body.style.overflow = ''; render(); };
    const nb = D.bosses[nextBoss()];
    let natureHTML = null, itemHTML = null, busy = false, editing = false, itemsOpen = false, statNote = '', typed = null;
    let page = S.sumPage || 'info';
    function infoPage(sp) {
      const ab = E.abilityInfo(m.ab), hcAb = m.ab && E.hardcoreAbility(m.ab, m.s) !== m.ab ? ` <span class="tag ban">Hardcore: ${esc(E.hardcoreAbility(m.ab, m.s))}</span>` : '';
      const evo = evoSummary(m.s);
      const pool = [...itemPool().keys()].filter(id => E.itemName(id)).sort((a, b) => E.itemName(a).localeCompare(E.itemName(b)));
      const holder = id => S.roster.find(x => x !== m && x.it === id && x.box !== 'dead');
      return `<dl class="sum-kv">
          <dt>Ability</dt><dd>${esc(m.ab || '—')}${ab.x ? ' <span class="tag">Radical Red</span>' : ''}${hcAb}</dd>
          <dt>Nature</dt><dd>${esc(natureText(m.nat))}</dd>
          <dt>Item</dt><dd><span class="grow">${m.it ? `<b>${esc(E.itemName(m.it))}</b>` : 'None'}</span><button class="btn small${itemsOpen ? ' primary' : ''}" id="mo-items" aria-expanded="${itemsOpen}">${m.it ? 'Change' : 'Give an item'}</button></dd>
          ${m.met ? `<dt>Caught</dt><dd>${esc(m.met)}</dd>` : ''}
          ${evo.length ? `<dt>Evolves</dt><dd>${evo.map(esc).join('<br>')}${m.noEvo ? '<br><span class="muted">stopped: it won’t evolve</span>' : ''}</dd>` : ''}
        </dl>
        ${itemsOpen ? `<div class="card sum-items"><div class="lbl">Held item for ${esc(nb.cls)} ${esc(nb.n)}</div>
          <div id="mo-item">${itemHTML || '<span class="note">Trying held items against their team…</span>'}</div>
          <div class="lbl">Everything you can give it (${pool.length})</div>
          <div class="chips">${m.it ? `<button class="chipbtn" data-giveit="0">Take it off</button>` : ''}${pool.map(id => `<button class="chipbtn" data-giveit="${id}" aria-pressed="${m.it === id}">${esc(E.itemName(id))}${holder(id) ? ` <span class="small muted">(${esc(holder(id).nick || E.sp(holder(id).s).n)} has it)</span>` : ''}</button>`).join('') || '<span class="note">No items yet: the care package, your bag and what your team holds show up here.</span>'}</div></div>` : ''}
        <div class="card"><div class="lbl">Nature</div><div id="mo-nature">${natureHTML || '<span class="note">Working out the best nature for the next big fights…</span>'}</div></div>`;
    }
    function statsPage(sp) {
      const st = monStats(m), nat = D.natures[m.nat] || {}, iv = ivOf(m), ev = evOf(m), base = sp.s;
      const mark = k => (nat.u === k ? ' up' : nat.d === k ? ' down' : '');
      const arrow = k => (nat.u === k ? '<span class="sr up" aria-label="raised by its nature">▲</span>' : nat.d === k ? '<span class="sr down" aria-label="lowered by its nature">▼</span>' : '');
      const ivr = m.statsAt && m.statsAt.ivr;
      const ivText = i => (ivr ? (ivr[i][0] === ivr[i][1] ? String(ivr[i][0]) : `${ivr[i][0]}–${ivr[i][1]}`) : m.ivGuess && i === 5 ? `~${iv[i]}` : String(iv[i]));
      if (editing) {
        return `<p class="small" style="margin:0">Type the stats your game's summary shows for <b>${esc(m.nick || sp.n)}</b> at <b>Lv ${m.lv}</b> (${esc(D.natures[m.nat].n)}). The Coach works out its IVs from them.</p>
          <div class="sum-edit">${STATS6.map((k, i) => `<label class="${mark(k).trim()}"><span>${STAT_FULL[k]} ${arrow(k)}</span><input type="number" inputmode="numeric" min="1" max="999" data-st="${i}" value="${typed && typed[i] != null ? typed[i] : m.statsAt && m.statsAt.st && m.statsAt.lv === m.lv && m.statsAt.s === m.s ? m.statsAt.st[i] : st[k]}"></label>`).join('')}</div>
          ${statNote ? `<p class="note bad" style="margin:0">${statNote}</p>` : ''}
          <div class="row"><button class="btn primary" id="mo-stsave">Save</button><button class="btn ghost" id="mo-stcancel">Cancel</button></div>`;
      }
      const maxB = Math.max(...base);
      return `<table class="sum-stats"><thead><tr><th></th><th>Stat</th><th>Base</th><th>IV</th>${ev.some(Boolean) ? '<th>EV</th>' : ''}</tr></thead><tbody>
          ${STATS6.map((k, i) => `<tr class="${mark(k).trim()}"><th>${STAT_FULL[k]} ${arrow(k)}</th><td class="v">${st[k]}</td>
            <td><span class="bstat"><i style="width:${Math.round(100 * base[i] / Math.max(150, maxB))}%"></i></span><span class="small muted">${base[i]}</span></td>
            <td class="small">${ivText(i)}</td>${ev.some(Boolean) ? `<td class="small">${ev[i]}</td>` : ''}</tr>`).join('')}
        </tbody></table>
        <p class="note" style="margin:0">${esc(ivSource(m))}</p>
        <div class="row"><button class="btn${m.statsAt ? '' : ' primary'}" id="mo-stedit">${m.statsAt ? 'Update from my game' : 'Match my game’s numbers'}</button>${m.statsAt || m.ivGuess ? '<button class="btn ghost small" id="mo-streset">Back to perfect IVs</button>' : ''}</div>`;
    }
    function movesPage(sp) {
      const next = E.upcoming(m.s, m.lv).filter(u => !E.isBanned(u.id, sp.g)).slice(0, 4);
      const row = id => {
        const mv = E.mv(id); if (!mv) return '';
        const ban = E.isBanned(id, sp.g);
        return `<div class="sm-row" style="--t:${TYPE_COLORS[mv.t] || '#888888'}"><span class="sm-type">${esc(mv.t)}</span><b class="sm-n">${esc(mv.f)}</b>
          <span class="sm-meta">${mv.k === 'X' ? 'Status' : mv.k === 'P' ? 'Physical' : 'Special'} · ${mv.p > 1 ? 'Power ' + mv.p : '—'} · ${mv.a ? 'Acc ' + mv.a : 'never misses'}${ban ? ' · <span class="tag ban">banned in Hardcore</span>' : ''}</span></div>`;
      };
      return `<div class="sum-moves">${(m.mv || []).map(row).join('') || '<span class="muted small">No moves entered</span>'}</div>
        ${next.length ? `<p class="small" style="margin:0">Learns next: ${next.map(u => `<b>${esc(E.mv(u.id).f)}</b> at Lv ${u.lv}`).join(', ')}</p>` : ''}
        <div class="row"><button class="btn primary" id="mo-plan">Move plan: what to learn and teach</button><button class="btn" id="mo-editmv">Change moves</button></div>`;
    }
    function draw(tick) {
      if (sheet._owner !== owner) return;
      const sp = E.sp(m.s), cap = capNow();
      const tabs = [['info', 'Info'], ['stats', 'Stats'], ['moves', 'Moves']];
      const body = page === 'stats' ? statsPage(sp) : page === 'moves' ? movesPage(sp) : infoPage(sp);
      sheet.innerHTML = `<div class="inner sum">
        <div class="sum-band"><div class="sum-tabs" role="tablist" aria-label="Summary pages">${tabs.map(([k, l]) => `<button role="tab" data-page="${k}" aria-selected="${page === k}">${l}</button>`).join('')}</div>
          <button class="sum-x" id="mo-close" aria-label="Close the summary">✕</button></div>
        <div class="sum-hero">
          <div class="sum-pic">${front(m.s, 'x2')}</div>
          <div class="sum-id"><div class="sum-name">${esc(m.nick || sp.n)}</div>${m.nick ? `<div class="small muted">${esc(sp.n)}</div>` : ''}
            ${typesHTML(sp.t)}
            <div class="small">${m.it ? `Holds <b>${esc(E.itemName(m.it))}</b>` : 'No held item'} · ${m.box === 'party' ? 'in your party' : m.box === 'box' ? 'in your PC box' : 'fainted'}</div></div>
          <div class="ticker sum-lv" role="group" aria-label="Level">
            <button class="btn" id="mo-down" aria-label="One level down" ${busy ? 'disabled' : ''}>−</button><span class="lvbig">Lv ${m.lv}</span><button class="btn" id="mo-up" aria-label="One level up" ${busy ? 'disabled' : ''}>+</button>
            <button class="btn small" id="mo-cap" ${m.lv >= cap || busy ? 'disabled' : ''}>Level up to the cap (${cap})</button>
            ${m.noEvo && levelEvolution(m.s, m.lv) ? `<button class="btn small" id="mo-evolve">Evolve it now</button>` : ''}</div>
        </div>
        <div class="sum-page" role="tabpanel">${body}</div>
        <div class="row sum-acts"><button class="btn" id="mo-edit">Edit everything</button>
          <button class="btn" id="mo-box">${m.box === 'party' ? 'Move to box' : 'Move to party'}</button>
          ${m.box === 'party' && party()[0] !== m ? '<button class="btn" id="mo-lead">Make it the lead</button>' : ''}</div>
      </div>`;
      wire();
      if (tick) { const el = sheet.querySelector('.lvbig'); if (el) el.classList.add('tick'); }
    }
    function wire() {
      $('#mo-close').onclick = close;
      sheet.querySelectorAll('[data-page]').forEach(b => b.onclick = () => { page = S.sumPage = b.dataset.page; editing = false; statNote = ''; draw(); });
      const goTo = async target => { busy = true; natureHTML = itemHTML = null; draw(); await levelUp(m, target, () => draw(true)); busy = false; draw(); compute(); };
      $('#mo-up').onclick = () => goTo(m.lv + 1);
      $('#mo-down').onclick = () => goTo(m.lv - 1);
      $('#mo-cap').onclick = () => goTo(capNow());
      const ev = $('#mo-evolve'); if (ev) ev.onclick = async () => { const to = await whichEvolution(m, m.lv); if (to && await evolveScene(m, to)) { m.noEvo = false; evolveMon(m, to); for (const id of movesAt(m.s, 0)) await offerMove(m, id, 'on evolving'); await store.saveMon(m); } draw(); };
      $('#mo-edit').onclick = () => { sheet._owner = null; sheet.hidden = true; sheet.innerHTML = ''; openEditor(m); };
      $('#mo-box').onclick = async () => { if (m.box !== 'party' && party().length >= 6) { flash('Your party is full.'); return; } m.box = m.box === 'party' ? 'box' : 'party'; draw(); await store.saveMon(m); };
      const lead = $('#mo-lead'); if (lead) lead.onclick = async () => { m.ord = Math.min(...S.roster.map(x => x.ord || 0)) - 1; S.roster.sort((a, b) => (a.ord || 0) - (b.ord || 0)); draw(); flash(`${m.nick || E.sp(m.s).n} leads your party.`); await store.saveMon(m); };
      const items = $('#mo-items'); if (items) items.onclick = () => { itemsOpen = !itemsOpen; draw(); };
      sheet.querySelectorAll('[data-setnat]').forEach(b => b.onclick = async () => { m.nat = +b.dataset.setnat; natureHTML = null; if (m.statsAt) m.statsAt = Object.assign({}, m.statsAt, { st: null }); draw(); compute(); await store.saveMon(m); flash(`Nature set to ${D.natures[m.nat].n}.`); });   // IVs stay: a nature only changes the multiplier
      sheet.querySelectorAll('[data-giveit]').forEach(b => b.onclick = async () => { m.it = +b.dataset.giveit || null; itemHTML = null; itemsOpen = false; draw(); compute(); await store.saveMon(m); flash(`${m.nick || E.sp(m.s).n} now holds ${E.itemName(m.it) || 'nothing'}.`); });
      // stats: match the game's numbers
      const se = $('#mo-stedit'); if (se) se.onclick = () => { editing = true; statNote = ''; typed = null; draw(); const f = sheet.querySelector('[data-st="0"]'); if (f) f.focus(); };
      const sc = $('#mo-stcancel'); if (sc) sc.onclick = () => { editing = false; statNote = ''; typed = null; draw(); };
      sheet.querySelectorAll('[data-st]').forEach(inp => inp.addEventListener('input', () => { (typed = typed || [])[+inp.dataset.st] = inp.value; }));
      const sr = $('#mo-streset'); if (sr) sr.onclick = async () => { m.statsAt = null; m.iv = null; m.ev = null; m.ivGuess = false; draw(); await store.saveMon(m); };
      const ss = $('#mo-stsave'); if (ss) ss.onclick = async () => {
        const shown = STATS6.map((k, i) => Math.round(+((sheet.querySelector(`[data-st="${i}"]`) || {}).value || 0)));
        const fit = setStats(m, shown);
        const bad = STATS6.filter((k, i) => !fit[i]);
        if (bad.length) { statNote = `${bad.map(k => STAT_FULL[k]).join(', ')} ${bad.length === 1 ? 'doesn’t' : 'don’t'} fit a Lv ${m.lv} ${esc(E.sp(m.s).n)} with a ${esc(D.natures[m.nat].n)} nature. Check its level and nature (Info), then try again.`; draw(); return; }
        editing = false; statNote = ''; typed = null; natureHTML = itemHTML = null; draw(); compute();
        await store.saveMon(m);
        flash('Stats saved: every plan now uses its real IVs.');
      };
      const plan = $('#mo-plan'); if (plan) plan.onclick = () => { sheet._owner = null; sheet.hidden = true; sheet.innerHTML = ''; openAdvice(m); };
      const emv = $('#mo-editmv'); if (emv) emv.onclick = () => { sheet._owner = null; sheet.hidden = true; sheet.innerHTML = ''; openEditor(m); };
    }
    function compute() {
      setTimeout(() => {
        if (!mine()) return;
        const f = fightForm(m, capNow()), fn = formNote(m, f);
        const na = ADV.natureAdvice(specOf(f), nextBoss(), S.run.tms || [], 3);
        const best = na.best;
        natureHTML = best.nat === m.nat
          ? `<p class="small" style="margin:0"><b>${esc(D.natures[m.nat].n)} is already the best</b> for ${esc(na.bosses.map(i => D.bosses[i].n).join(', '))}.</p>`
          : `<p class="small" style="margin:0"><b>Coach: ${esc(natureText(best.nat))}.</b> ${esc(na.reason)}${na.changes.length ? ' ' + esc(na.changes.slice(0, 3).join('; ')) + '.' : ''}</p>
             <div class="row"><button class="btn small primary" data-setnat="${best.nat}">I changed it to ${esc(D.natures[best.nat].n)}</button><span class="note">Radical Red's Nature Changer does it in-game.</span></div>`;
        const team = E.bossTeam(nextBoss(), Math.max(f.lv, topLevel()));
        const base = itemScore(f, m.it || null, team);
        const tried = [...itemPool().keys()].filter(id => id !== m.it).map(id => ({ id, g: itemScore(f, id, team) - base })).filter(x => x.g > 0.15).sort((a, b) => b.g - a.g).slice(0, 3);
        const top = tried.length ? tried[0].g : 0;
        const later = [...laterPool()].map(([id, w]) => ({ id, w, g: itemScore(f, id, team) - base })).filter(x => x.g > top + 0.5).sort((a, b) => b.g - a.g)[0];
        itemHTML = tried.length
          ? `<div class="answers">${tried.map((x, k) => `<div class="answer"><div class="top"><b>${esc(E.itemName(x.id))}</b>${k === 0 ? '<span class="tag">Coach pick</span>' : ''}<span class="grow"></span><button class="btn small${k === 0 ? ' primary' : ''}" data-giveit="${x.id}">Give it</button></div>
              <span class="small muted">+${x.g.toFixed(1)} matchup points against their ${team.length}${m.it ? ` (instead of ${esc(E.itemName(m.it))})` : ''} · ${esc(itemFrom(x.id))}</span></div>`).join('')}</div>`
          : `<p class="small" style="margin:0">${m.it ? `${esc(E.itemName(m.it))} is as good as anything you have.` : 'None of your items changes these matchups.'}</p>`;
        itemHTML += `${later ? `<p class="small" style="margin:0">Later: <b>${esc(E.itemName(later.id))}</b> (+${later.g.toFixed(1)}) comes ${esc(later.w)}.</p>` : ''}
          <p class="note" style="margin:0">${fn ? 'Judged ' + esc(fn) + ', the way it will fight. ' : ''}From what you have: ${S.run.care ? 'the care package so far, ' : ''}items you've ticked under Pokémon and what your team holds.</p>`;
        draw();
      }, 40);
    }
    draw();
    compute();
  }

  // ---------------- a funeral for each Pokemon that falls (Nuzlocke rules: gone for good) ----------------
  const EPITAPHS = ['It gave everything.', 'Gone, but not forgotten.', 'Fainted in the line of duty.', 'The Nuzlocke claims another.',
    'Its legend lives on.', 'Rest easy in Lavender Town.', 'A true partner to the end.', 'It took the hit so others could win.'];
  function epitaph(m) { let h = 0; for (const c of (m.nick || '') + m.key) h = (h * 31 + c.charCodeAt(0)) >>> 0; return EPITAPHS[h % EPITAPHS.length]; }
  /** What took it: the live battle's record of the faint if there is one ("Squirtle's Aqua Jet, turn 5"). */
  function liveCause(key) {
    const L = S.live; if (!L) return null;
    const ev = (L.faints || []).concat(L.st && L.st.events ? L.st.events : []);
    const e = ev.find(x => x.type === 'faint' && x.side === 'p' && x.key === key);
    return e ? { cause: e.cause || '', turn: e.turn } : null;
  }
  function deathLine(m) {
    const d = m.died || {};
    const by = d.cause ? `fell to ${d.cause}${d.turn ? ` on turn ${d.turn}` : ''}` : d.before ? `fell fighting ${d.before}` : 'fell in battle';
    return `Lv ${m.lv} · ${by}`;
  }
  function graveHTML(m, big) {
    return `<div class="grave${big ? ' big' : ''}"><div class="stone"><b>RIP</b><span class="gn">${esc(monShort(m))}</span><span class="gl">Lv ${m.lv}</span></div></div>`;
  }
  let funeralBusy = Promise.resolve();
  /** Mark them fainted (with what took them) and hold a funeral, one at a time, after any celebration on screen. */
  function funeral(mons) {
    mons = mons.filter(Boolean);
    if (!mons.length) return funeralBusy;
    funeralBusy = funeralBusy.then(async () => {
      await afterCele();
      for (let k = 0; k < mons.length; k++) {
        const m = mons[k];
        const more = k < mons.length - 1;
        const done = ask(`<div class="rip-scene" aria-hidden="true">
            <div class="rip-sky">${[0, 1, 2, 3, 4].map(i => `<i style="--i:${i}"></i>`).join('')}</div>
            <div class="rip-ghost">${front(m.s, 'x2')}</div>
            ${graveHTML(m, true)}
            <div class="rip-ground"></div>
            <div class="rip-flowers">${[0, 1, 2, 3].map(i => `<i style="--i:${i}"></i>`).join('')}</div>
            <div class="rip-candle"><i></i></div>
            <div class="rip-fs"></div></div>
          <div class="cele-text rip-title">Rest in peace, ${esc(monShort(m))}.</div>
          <div class="cele-sub">${esc(deathLine(m))}${S.run.no ? ` · Run #${S.run.no}` : ''}</div>
          <div class="rip-epitaph">“${esc(epitaph(m))}”</div>
          <div class="row" style="justify-content:center"><button class="btn" id="rip-f">Pay respects</button><button class="btn primary" data-answer="ok">${more ? `Next (${k + 2} of ${mons.length})` : 'Continue'}</button></div>`, 'is-rip');
        const f = $('#rip-f'), fs = $('#ask .rip-fs');
        if (f) f.onclick = ev => {
          ev.stopPropagation();
          if (!fs) return;
          const el = document.createElement('span'); el.className = 'rip-pop'; el.textContent = fs.childElementCount % 2 ? '♥' : 'F';
          el.style.left = (30 + Math.random() * 40) + '%';
          fs.appendChild(el); setTimeout(() => el.remove(), 1600);
        };
        await done;
      }
    });
    return funeralBusy;
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
        // stats typed for another species or nature no longer say anything about its IVs
        if (existing && existing.s !== m.s && (m.statsAt || m.ivGuess) && familyOf(existing.s) !== familyOf(m.s)) { m.statsAt = null; m.iv = null; m.ev = null; m.ivGuess = false; }
        const fell = m.box === 'dead' && (!existing || existing.box !== 'dead');
        if (fell && !m.died) m.died = { at: Date.now(), before: D.bosses[nextBoss()].n };
        if (idx >= 0) S.roster[idx] = m; else { m.ord = Date.now(); S.roster.push(m); }
        close();
        if (prefill && prefill.onSave) prefill.onSave(m);
        render();
        if (fell) funeral([m]);
        await store.saveMon(m);
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
  /** What a plan depends on: the fight and every Pokemon you could bring. */
  function planKey() { return JSON.stringify([S.planBoss, alive().map(r => [r.key, r.s, r.lv, r.nat, r.ab, r.it, r.mv, r.box])]); }
  /** One-on-one numbers for the fight you're planning (cached until your team changes). */
  function matchups() {
    const key = planKey();
    if (planCache.key !== key) planCache = { key, plan: E.planBoss(S.planBoss, alive().map(r => specOf(r)), party().map(r => r.key)) };
    return planCache.plan;
  }
  /** Everything after the battle plan: their team with your answers, the grid, held items, movesets, Claude.
   *  compact: inside a run step, so the answers fold away too. */
  function planExtrasHTML(P, compact) {
    const roster = alive();
    const answers = P.team.map((t, j) => {
        const top = P.answers[j].slice(0, 3);
        const none = top.every(a => a.m.verdict === 'lose');
        return `<div class="card">${theirSetHTML(t)}<div class="answers">${top.map(answerHTML).join('')}</div>${none ? '<div class="banner">Nothing in your team beats this one safely. Look for a Pokémon that resists its moves or outspeeds and hits it super-effectively.</div>' : ''}</div>`;
      }).join('');
    let out = compact
      ? `<details class="more"><summary>Their team, one on one: your best answers</summary><div class="section" style="margin-top:8px">${answers}</div></details>`
      : `<section class="section"><h2>Their team and your answers</h2><p class="note" style="margin:0">One-on-one numbers for each of their Pokémon, with your best three answers.</p>${answers}</section>`;
    out += `<details class="more"><summary>Full matchup grid</summary><div class="tablewrap" style="margin-top:8px"><table class="grid"><thead><tr><th></th>${P.team.map(t => `<th>${esc(E.sp(t.s).n)}</th>`).join('')}</tr></thead><tbody>${
        roster.map((r, i) => `<tr><th>${esc(monName(r))}</th>${P.grid[i].map(m => {
          const cls = { safe: 'v-safe', ok: 'v-ok', risky: 'v-risky', lose: 'v-lose' }[m.verdict];
          const label = m.verdict === 'safe' ? 'safe' : m.verdict === 'lose' ? 'loses' : fmtRisk(m.risk);
          return `<td class="${cls}">${label}</td>`;
        }).join('')}</tr>`).join('')}</tbody></table></div></details>`;
    out += `<section class="section" id="items-sec"><details class="more" ${S.itemsOpen ? 'open' : ''} id="items-det"><summary>Held items for this fight</summary><div class="card" style="margin-top:8px" id="items-out">
        <p class="small" style="margin:0">Tries every held item you have (${S.run.care ? 'the care package so far, ' : ''}what you've ticked under Pokémon and what your Pokémon hold) on each Pokémon you'd bring, keeps the swaps that win or save matchups against this team, then simulates the fight before and after.</p>
        <div class="row"><button class="btn" id="items-go" ${itemPool().size ? '' : 'disabled'}>Suggest held items</button>${itemPool().size ? '' : '<span class="note">Tick the items you have first (Menu → Pokémon, Bag).</span>'}</div></div></details></section>`;
    out += movesetSection(P);
    out += claudeSection();
    return out;
  }
  function renderPlan() {
    if (S.planBoss == null) S.planBoss = nextBoss();
    const bi = S.planBoss;
    const b = D.bosses[bi];
    if (b.route) b.cap = capNow();
    const roster = alive();
    let html = `<section class="section">
      <div class="field"><label for="plan-boss">Fight</label><select id="plan-boss" class="inline">${bossOptions(bi)}</select></div>
      <div class="row small"><span class="pill cap">Cap ${b.cap}</span>${b.ms ? `<span class="pill">Win: cap rises to ${b.capAfter}</span>` : ''}${b.dbl ? '<span class="pill warn">Double battle</span>' : ''}
        <span class="grow"></span><button class="btn small" id="plan-beaten" ${S.example ? 'disabled' : ''}>${S.run.beaten.includes(b.i) ? 'Mark as not beaten' : 'Mark as beaten'}</button></div>
      <p class="note" style="margin:0">Plan ahead for any fight here. For the next fight on your run, the run page has all of this in one place.</p>
    </section>`;
    if (!roster.length) {
      html += `<div class="empty">Add your Pokémon (Menu → Pokémon) and the Coach will plan this fight.<button class="btn" id="plan-ex">Try an example team</button></div>`;
      html += `<section class="section"><h2>Their team</h2>${D.bosses[bi].party.map((_, j) => `<div class="card">${theirSetHTML(E.bossTeam(bi, b.cap)[j])}</div>`).join('')}</section>`;
      main.innerHTML = html; wirePlan(); return;
    }
    main.innerHTML = html + '<div class="empty">Working out every matchup…</div>';
    wirePlan();
    setTimeout(() => {
      if (S.screen !== 'fight' || S.planBoss !== bi) return;   // you moved on meanwhile
      const P = matchups();
      main.innerHTML = html + battlePlanHTML(planKey()) + theaterHTML() + planExtrasHTML(P, false)
        + `<section class="section" id="live"><div class="head"><h2>Play it live</h2></div>${liveBlockHTML(bi)}</section>`;
      wirePlan(P);
      wireTheater();
      wireLiveBlock(bi);
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
  function battlePlanHTML(key, bare) {
    const res = S.plans[key];
    const running = S.planning && S.planning.key === key;
    let h = `<section class="section" id="bp">${bare ? '' : '<div class="head"><h2>Battle plan</h2><span class="muted small">Simulated with your Pokémon</span></div>'}`;
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
    <p class="note">${sc.winner === 'p' ? `Ends in a win on turn ${sc.totalTurns}.` : sc.winner === 'a' ? 'In this line the boss wins.' : 'This line stalls out.'} Risk on each turn is the chance that the Pokémon you have in faints before it wins its fight. When something unexpected happens (a crit, a miss, a different move), play it live below: it re-plans from wherever you are.</p></details></section>`;
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
  function wireBattlePlan() {
    const key = planKey();
    const go = $('#bp-go'); if (go) go.onclick = () => runPlan(key);
    const redo = $('#bp-redo'); if (redo) redo.onclick = () => { delete S.plans[key]; runPlan(key); };
  }
  // ---------------- watching fights play out: the most likely battle, a new one with real luck, one that goes wrong ----------------
  const theater = {};   // per fight and team: how the battles you watched went
  /** Who fights: the plan's six and lead when there is a plan, else your party as it is, your first Pokémon leading. */
  function theaterInputs() {
    const key = planKey();
    const res = S.plans[key];
    const { specs, team } = planInputs();
    const doubles = !!D.bosses[S.planBoss].dbl;
    if (res && res.lineup) {
      return { key, res, team, doubles, planned: true, specs: res.lineup.map(i => specs[i]).filter(Boolean),
        lead: doubles ? [].concat(res.lead).map(l => res.lineup.indexOf(l)) : res.lineup.indexOf(res.lead) };
    }
    const p = party().length ? party() : alive().slice(0, 6);
    return { key, res: null, team, doubles, planned: false, specs: p.map(m => specOf(m, { label: monName(m) })), lead: doubles ? [0, 1] : 0 };
  }
  function tallyText(x) { return `${x.n} simulated battle${x.n === 1 ? '' : 's'} watched for this fight: ${x.won} won, ${x.clean} without a loss.`; }
  function theaterHTML() {
    if (!alive().length) return '';
    const T = theaterInputs();
    if (!T.specs.length) return '';
    const o = T.res && T.res.odds;
    const tl = theater[T.key];
    return `<div class="card theater"><div class="lbl">Watch it play out</div>
      <div class="row">${T.res ? '<button class="btn primary" data-watch="likely">▶ Most likely battle</button>' : ''}
        <button class="btn${T.res ? ' small' : ' primary'}" data-watch="random">▶ ${T.res ? 'A new battle' : 'Simulate the battle'}</button>
        ${!o || o.pNoLoss < 0.999 ? '<button class="btn small" data-watch="bad">▶ One that goes wrong</button>' : ''}</div>
      <p class="note" style="margin:0">${T.planned ? 'The plan’s six and lead' : 'Your party as it is now, your first Pokémon leading (plan the fight for the Coach’s six and lead)'}, with your moves, against their exact team. Every new battle has its own luck: damage rolls, critical hits, misses and the boss AI’s choices.</p>
      <div class="stage-host" id="th-stage" hidden></div>
      <div class="row small" id="th-ctl" hidden><button class="btn small" id="th-pause">Pause</button><button class="btn small" id="th-next">Next turn</button><button class="btn small" id="th-speed">Speed ${S.thSpeed || 1}×</button><button class="btn small ghost" id="th-close">Close</button></div>
      <div class="th-out" id="th-out" aria-live="polite">${tl ? `<div class="note">${tallyText(tl)}</div>` : ''}</div></div>`;
  }
  function wireTheater() {
    main.querySelectorAll('[data-watch]').forEach(b => b.onclick = () => watchBattle(b.dataset.watch));
    if (S.autoWatch && S.autoWatch === planKey() && $('[data-watch="likely"]')) { S.autoWatch = null; watchBattle('likely'); }
  }
  /** A battle with real luck, run on the page in small batches so it stays responsive; 'bad' looks for one you lose a Pokémon in. */
  async function sampleOnPage(T, mode, onProgress) {
    const tick = () => new Promise(r => setTimeout(r, 0));
    const base = { lead: T.lead, doubles: T.doubles, seed: (Math.floor(Math.random() * 4294967295) >>> 0) || 1 };
    await tick();
    if (mode !== 'bad') return SIM.sampleBattle(T.specs, T.team, base);
    let seed = base.seed, tried = 0;
    while (tried < 150) {
      const r = SIM.sampleBattle(T.specs, T.team, Object.assign({}, base, { seed, mode: 'bad', tries: 6 }));
      tried += r.script ? r.tries : 6;
      if (r.script) return Object.assign(r, { tries: tried });
      seed = r.seed; onProgress(tried); await tick();
    }
    return { script: null, tries: tried };
  }
  const usedMove = text => { const z = /Z-Move \(Z-(.+?)\)/.exec(text); return z ? z[1] : ((/ uses (.+)$/.exec(text) || [])[1] || ''); };
  function battleSummary(sc) {
    const lost = sc.faints || [];
    const head = sc.winner === 'p' ? `You won in ${sc.totalTurns} turns${lost.length ? '' : ' without losing anyone'}.` : sc.winner === 'a' ? `You lost on turn ${sc.totalTurns}.` : `Nobody won in ${sc.totalTurns} turns.`;
    return `<div class="th-sum"><b>${esc(head)}</b>${lost.length ? ` Fainted: ${lost.map(f => `${esc(f.name)} (turn ${f.turn}${f.cause ? ', ' + esc(f.cause) : ''})`).join(', ')}.` : ''}</div>`;
  }
  let theaterRun = 0;
  /** Play a battle on the battle screen as if someone were playing it: the move menu each turn, then the turn. */
  async function watchBattle(mode) {
    const T = theaterInputs();
    const host = $('#th-stage'), ctl = $('#th-ctl'), out = $('#th-out');
    if (!host || !T.specs.length || !window.createStage) return;
    const run = ++theaterRun;
    if (planStage) { planStage.destroy(); planStage = null; }
    let script = null, title = '';
    if (mode === 'likely') { script = T.res && T.res.script; title = 'The most likely battle: average damage rolls, no critical hits or misses.'; }
    else {
      out.innerHTML = `<div class="note">${mode === 'bad' ? 'Looking for a battle where something goes wrong…' : 'Simulating a battle…'}</div>`;
      const r = await sampleOnPage(T, mode, n => { if (run === theaterRun) out.innerHTML = `<div class="note">Looking for a battle where something goes wrong… ${n} tried</div>`; });
      if (run !== theaterRun || !$('#th-stage')) return;   // another battle started, or the page moved on
      if (!r.script) { out.innerHTML = `<div class="note">In ${r.tries} simulated battles you never lost a Pokémon.</div>`; return; }
      script = r.script;
      title = mode === 'bad' ? `A battle where something goes wrong (found ${r.tries === 1 ? 'on the first try' : `in ${r.tries} tries`}).` : 'A new simulated battle with its own luck.';
    }
    if (!script) return;
    const b = D.bosses[S.planBoss];
    host.hidden = false; ctl.hidden = false;
    const stage = planStage = window.createStage(host, stageOpts(b, T.doubles));
    stage.setSpeed(S.thSpeed || 1);
    let paused = false;
    const pauseBtn = $('#th-pause');
    pauseBtn.onclick = () => { paused = !paused; if (paused) stage.pause(); else stage.resume(); pauseBtn.textContent = paused ? 'Resume' : 'Pause'; };
    $('#th-next').onclick = () => { if (paused) { paused = false; stage.resume(); pauseBtn.textContent = 'Pause'; } stage.skip(); };
    $('#th-speed').onclick = () => { S.thSpeed = (S.thSpeed || 1) >= 3 ? 1 : (S.thSpeed || 1) + 1; stage.setSpeed(S.thSpeed); $('#th-speed').textContent = `Speed ${S.thSpeed}×`; };
    $('#th-close').onclick = () => { theaterRun++; stage.destroy(); if (planStage === stage) planStage = null; host.hidden = true; ctl.hidden = true; };
    out.innerHTML = `<div class="note">${esc(title)}</div>`;
    host.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const turns = script.turns || [];
    const first = turns.length && turns[0].lines.length ? turns[0].lines[0].snap : null;
    stage.show({ p: [], a: [], pl: first ? first.pl : [], al: first ? first.al : [] });
    await stage.intro();
    let last = null;
    for (const t of turns) {
      if (!stage.alive) return;
      const d = t.decision;
      stage.caption(d ? `Turn ${t.turn}: ${d.lines ? d.lines.join(' · ') : d.action}` : '');
      // singles: the move menu first, the cursor walking onto the move the Coach picked
      const firstMine = t.lines.find(l => l.who && l.who.side === 'p' && (l.kind === 'move' || l.kind === 'switch'));
      if (!T.doubles && d && last && firstMine && firstMine.kind === 'move') {
        const me = (last.p || []).find(e => e.i === firstMine.who.i);
        const moves = me && me.mv ? me.mv.map(id => E.mv(id)).filter(Boolean) : [];
        const name = usedMove(firstMine.text);
        const pick = moves.findIndex(m => m.f === name || m.n === name);
        if (pick >= 0) { stage.text(`What will ${me.n.replace(/ \(.*\)$/, '')} do?`); await stage.wait(380); await stage.menu(moves.map(m => ({ n: m.f, c: TYPE_COLORS[m.t] || '#888888' })), pick); }
      }
      await stage.play(t.lines);
      if (t.lines.length) last = t.lines[t.lines.length - 1].snap;
      await stage.wait(420);
    }
    if (!stage.alive || run !== theaterRun) return;
    stage.caption(script.winner === 'p' ? `You win in ${script.totalTurns} turns` : script.winner === 'a' ? 'The boss wins this one' : 'Nobody wins this one');
    await stage.say(script.winner === 'p' ? `${b.cls} ${b.n} was defeated!` : script.winner === 'a' ? 'You have no Pokémon left to fight…' : 'The battle stalls out.');
    if (mode !== 'likely') {
      const x = theater[T.key] || (theater[T.key] = { n: 0, won: 0, clean: 0 });
      x.n++; if (script.winner === 'p') { x.won++; if (!(script.faints || []).length) x.clean++; }
    }
    if ($('#th-out') === out) out.innerHTML = battleSummary(script) + (theater[T.key] ? `<div class="note">${tallyText(theater[T.key])}</div>` : '');
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
      S.autoWatch = key;
    } catch (e) {
      flash('Planning failed: ' + (e && e.message ? e.message : e));
    } finally {
      S.planning = null;
      if (S.screen === 'run' || S.screen === 'fight') render();
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
      <div class="card"><p class="note" style="margin:0">Claude turns the calculations above into a written plan. It only sees these numbers, so check anything surprising with Quick check.</p>
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
    wireBattlePlan();
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
    const sim = S.plans[planKey()];
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

  // ---------------- PLAY IT LIVE: turn by turn, with the AI check ----------------
  const pctOf = m => Math.round(100 * m.hp / m.maxHp);
  const pctExact = m => 100 * m.hp / m.maxHp;   // the report keeps your HP exact (you see the numbers in the game)
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
    // the opening plays on the battle screen: an empty field, then both sides send out their leads
    const intro = { p: [], a: [], pl: st.p.team.map(() => 1), al: st.a.team.map(() => 1) };
    S.live = { bi, doubles, st, step: 'choose', turns: [], checks: [], next: null, pred: null, anim: { from: intro, lines: st.log.slice(), intro: true } };
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
  /** The live battle for one fight: pick your lead, then turn by turn (recommendation, what happened, check). */
  function liveBlockHTML(bi) { return `<div id="lv-body">${liveBodyHTML(bi)}</div>`; }
  /** Redraw the whole live block in place (starting or ending a battle, picking leads): the page stays where it is. */
  function redrawLive(bi) {
    const body = $('#lv-body');
    if (!body) { render(); return; }
    if (liveStage) { liveStage.destroy(); liveStage = null; }
    body.outerHTML = liveBlockHTML(bi);
    wireLiveBlock(bi);
  }
  function liveBodyHTML(bi) {
    const pp = party().length ? party() : alive();
    if (!pp.length) return '<div class="empty">Add your Pokémon first (Menu → Pokémon).</div>';
    if (!S.live || S.live.bi !== bi) {
      const b = D.bosses[bi];
      const n = b.dbl ? 2 : 1;
      const other = S.live ? D.bosses[S.live.bi] : null;
      return `<div class="card">
        <div class="lbl">${b.dbl ? 'Your two leads (double battle)' : 'Your lead'}</div>
        <div class="chips">${pp.map((m, i) => `<button class="chipbtn" data-lead="${i}" aria-pressed="${(S.liveLead || [0, 1].slice(0, n)).includes(i)}">${icon(m.s)}${esc(monName(m))}</button>`).join('')}</div>
        <p class="small" style="margin:0">Each turn the Coach recommends your move${n > 1 ? 's' : ''} and shows what the boss AI will most likely do. Then tell it what actually happened: it fills in its prediction, so usually you only nudge the HP bars. It re-plans from there, and it keeps score of how often the boss AI did what it predicted.</p>
        ${other ? `<p class="note" style="margin:0">Starting ends your live battle against ${esc(other.n)}.</p>` : ''}
        <div class="row"><button class="btn primary" id="lv-start">Start the battle</button></div></div>`;
    }
    return `<div id="lv-head">${liveHeadHTML()}</div><div class="stage-host" id="lv-stage"></div><div id="lv-below">${liveBelowHTML()}</div>`;
  }
  function liveHeadHTML() {
    const L = S.live, b = D.bosses[L.bi];
    return `<div class="row"><h3 class="grow" style="font-family:var(--font-display);font-size:18px">vs ${esc(b.n)} · turn ${L.st.turn + 1}</h3><button class="btn small ghost" id="lv-end">End battle</button></div>`;
  }
  /** Under the battle screen: the turn report, the turn playing, or how the battle ended. */
  function liveBelowHTML() {
    const L = S.live, st = L.st, b = D.bosses[L.bi];
    let html = L.lesson ? `<p class="note lv-lesson">${esc(L.lesson)}</p>` : '';
    if (st.over) {
      const won = st.winner === 'p';
      const fallen = st.p.team.filter(m => m.fainted);
      const n = L.checks.length, ok = L.checks.filter(c => c.ok).length;
      html += `<div class="card rec"><h3>${won ? 'You won!' : 'The battle is over.'}</h3>
        <p class="small" style="margin:0">The boss AI did what the Coach predicted ${ok} of ${n} time${n === 1 ? '' : 's'}.</p>
        ${fallen.length ? `<p class="small" style="margin:0">Fainted: ${fallen.map(m => esc(m.name)).join(', ')}.</p>` : ''}
        <div class="row">${S.screen === 'run' ? `<button class="btn primary" id="lv-log">${won ? `Log the win${fallen.length ? ` and ${fallen.length} fainted` : ''}` : 'Log the loss'}</button>` : `${won && !S.run.beaten.includes(L.bi) && !b.route ? `<button class="btn primary" id="lv-beaten">Mark ${esc(b.n)} as beaten</button>` : ''}
          ${fallen.length && !S.example ? `<button class="btn" id="lv-dead">Mark ${fallen.length} fainted Pokémon as dead</button>` : ''}`}
          <button class="btn ghost" id="lv-close">Close</button></div></div>`;
    } else if (L.step === 'choose') {
      // recommendation and the AI's likely move
      let recs, pred, alts = '', opts = null;
      if (L.doubles) {
        const d = st.policies.p.decide(st, 'p');
        recs = d.acts; pred = d.ai;
        alts = d.alts.slice(1).map(x => `<div class="small muted">or: ${x.combo.map(a => esc(actionLabel(st, 'p', a))).join(' + ')}</div>`).join('');
      } else {
        opts = st.policies.p.evaluate(st, 'p');
        recs = opts[0] ? [opts[0].type === 'switch' ? { type: 'switch', to: opts[0].to } : { type: 'move', id: opts[0].id, z: !!opts[0].z }] : [];
        pred = [st.policies.a.choose(st, 'a', SIM.expectedDice(), true, true)];
        alts = opts.slice(1, 3).map(x => `<div class="small muted">or: ${esc(x.label)} ${riskBadge(x.risk)}</div>`).join('');
      }
      L.pred = pred; L.recs = recs;
      const mine = SIM.actives(st, 'p'), theirs = SIM.actives(st, 'a');
      L.opts = opts;
      if (L.doubles) html += `<div class="card rec"><div class="lbl">Do this</div>
        ${mine.map((m, k) => `<h3>${esc(m.name)}: ${esc(actionLabel(st, 'p', recs[k]))}</h3>`).join('')}${alts}
        <p class="small" style="margin:0">The boss AI will most likely use: ${theirs.map((m, k) => predictionHTML(st, m, pred[k])).join('; ')}.</p></div>`;
      html += `<div class="card report${L.doubles ? '' : ' wiz'}" id="lv-report"></div>`;
    } else if (L.step === 'anim') {
      html += `<div class="card"><div class="row"><span class="grow small muted">Playing the turn the Coach expects. Tap the screen to skip.</span><button class="btn small" id="lv-skip">Skip</button></div></div>`;
    }
    const n = L.checks.length, ok = L.checks.filter(c => c.ok).length;
    if (n) html += `<p class="note">AI check this fight: ${ok} of ${n} boss moves predicted.${L.checks.filter(c => !c.ok).slice(-2).map(c => ` Turn ${c.turn}: ${esc(c.mon)} used ${esc(c.actual)}, not ${esc(c.predicted)}.`).join('')}</p>`;
    return html;
  }
  // ---------------- the turn report: what happened, in taps or in words; the Coach re-plans from it ----------------
  const STATUS_OPTS = [['', 'OK'], ['par', 'PAR'], ['brn', 'BRN'], ['psn', 'PSN'], ['tox', 'TOX'], ['slp', 'SLP'], ['frz', 'FRZ']];
  const shortName = n => String(n || '').replace(/ \(.*\)$/, '');
  /** The boss's likely move, why the AI likes it, and how close the next choice is (a tie is a coin flip in the engine). */
  function predictionHTML(st, m, a) {
    const main = `<b>${esc(m.name)}: ${esc(actionLabel(st, 'a', a))}</b>`;
    const sc = a && a.scores ? Object.values(a.scores).filter(x => x && x.id).sort((x, y) => y.score - x.score) : [];
    if (!a || a.type !== 'move' || sc.length < 2) return main;
    const top = sc.find(x => x.id === a.id) || sc[0], next = sc.find(x => x.id !== top.id);
    const why = (top.why || []).map(w => w.replace(/^[+-]\d+\s*/, '')).filter(Boolean).join(', ');
    let s = main + (why ? ` <span class="muted">(${esc(why)})</span>` : '');
    if (next && next.score === top.score) s += `, or <b>${esc(E.mv(next.id).f)}</b>: a coin flip`;
    else if (next && top.score - next.score <= 3) s += `, maybe <b>${esc(E.mv(next.id).f)}</b>`;
    return s;
  }
  function lvActsInit(L) {
    if (L.acts && L.actsTurn === L.st.turn) return;
    L.acts = { p: (L.recs || []).slice(), a: (L.pred || []).map(a => (a ? { type: a.type, id: a.id, to: a.to, z: !!a.z, target: a.target } : null)) };
    L.actsTurn = L.st.turn; L.hpEdits = {}; L.statEdits = {}; L.cnfEdits = {}; L.sendout = {}; L.prev = null; L.wiz = 'you';
  }
  /** The turn as entered, played out with average rolls: the report starts from this (HP, status, who is out). */
  function lvPreview() {
    const L = S.live, st = L.st;
    const nx = SIM.cloneState(st);
    nx.opts.record = true;
    const fixed = (acts, base) => ({ chooseAll: () => acts, choose: (s2, side, rng, e, pk, slot) => acts[SIM.actives(s2, side).findIndex(x => x.slot === slot)] || acts[0],
      replace: (s2, side, rng, why, slot) => base.replace(s2, side, rng, why, slot) });
    nx.policies = { p: fixed(L.acts.p, st.policies.p), a: fixed(L.acts.a, st.policies.a) };
    const before = nx.log.length;
    SIM.playTurn(nx, SIM.expectedDice());
    L.prev = { nx, lines: nx.log.slice(before) };
  }
  /** Who the boss AI would send in for a fallen Pokémon (several when it's a coin flip), and who the Coach would send for you. */
  function aiChoicesAfter(nx, orig, k) { const probe = SIM.cloneState(nx); probe.a.slots[k] = orig; return SIM.AI.switchChoices(probe, 'a'); }
  function coachReplace(nx, orig, k) { const probe = SIM.cloneState(nx); probe.p.slots[k] = orig; return S.live.st.policies.p.replace(probe, 'p', SIM.expectedDice(), 'faint', k); }
  /** Which Pokemon took this turn's hits in each slot: the one that switched in, else the one that started. */
  function fieldedAt(side) {
    const L = S.live, st = L.st;
    return st[side].slots.map((orig, k) => { const a = (L.acts[side] || [])[k]; return a && a.type === 'switch' && st[side].team[a.to] ? a.to : orig; });
  }
  /** Marks for their choices: the AI's pick, and moves within 3 points of it ("maybe"), or tied with it ("coin flip"). */
  function predMarks(k) {
    const a = (S.live.pred || [])[k], marks = {};
    if (!a) return marks;
    if (a.type === 'switch') { marks['s:' + a.to] = 'likely'; return marks; }
    const sc = a.scores ? Object.values(a.scores).filter(x => x && x.id).sort((x, y) => y.score - x.score) : [];
    const top = sc.find(x => x.id === a.id) || sc[0];
    const tied = top ? sc.filter(x => x.id !== a.id && x.score === top.score) : [];
    marks['m:' + a.id] = tied.length ? 'coin flip' : 'likely';
    for (const x of sc) if (x.id !== a.id && top && top.score - x.score <= 3) marks['m:' + x.id] = x.score === top.score ? 'coin flip' : 'maybe';
    return marks;
  }
  function actKey(a) { return !a ? '' : a.type === 'switch' ? 's:' + a.to : (a.z ? 'z:' : 'm:') + a.id; }
  /** What a Pokemon did this turn, as buttons: its moves, then a switch to one of its team. */
  function actButtonsHTML(st, side, m, k, chosen, marks, extra) {
    const cur = actKey(chosen);
    extra = extra || {};
    const moves = side === 'p' ? SIM.usable(m, st) : m.moves;
    const mvBtn = (v, mv, label) => `<button class="mvbtn${extra.pick === v ? ' pick' : ''}" data-act="${side}:${k}:${v}" aria-pressed="${cur === v}" style="--t:${TYPE_COLORS[mv.t] || '#888888'}"><span class="mvn">${esc(label)}</span><span class="mvm">${esc(mv.t)} · ${mv.k === 'X' ? 'status' : (mv.p > 1 ? mv.p : '—')}${extra.meta && extra.meta(v) ? ' · ' + esc(extra.meta(v)) : ''}</span>${marks[v] ? `<span class="cp">${esc(marks[v])}</span>` : ''}</button>`;
    let h = `<div class="cmd-moves">${moves.map(id => { const mv = E.mv(id); return mv ? mvBtn('m:' + id, mv, mv.f) : ''; }).join('')}`;
    if (side === 'p') h += moves.filter(id => SIM.zKind(st, m, id) === 'type').map(id => mvBtn('z:' + id, E.mv(id), 'Z-' + E.mv(id).f)).join('');
    h += '</div>';
    const bench = st[side].team.map((x, i) => i).filter(i => !st[side].team[i].fainted && !st[side].slots.includes(i));
    if (bench.length) h += `<div class="rp-swrow"><span class="small muted">${side === 'a' ? 'Or they switched to' : 'Or you switched to'}</span><div class="chips">${bench.map(i => {
      const v = 's:' + i, x = st[side].team[i];
      return `<button class="chipbtn" data-act="${side}:${k}:${v}" aria-pressed="${cur === v}">${icon(x.spec.s)}${esc(shortName(x.name))}${marks[v] ? ` <span class="tag">${esc(marks[v])}</span>` : extra.meta && extra.meta(v) ? ` <span class="small muted">${esc(extra.meta(v))}</span>` : ''}</button>`;
    }).join('')}</div></div>`;
    return h;
  }
  const riskText = r => (r == null ? '' : r <= 1e-9 ? 'safe' : r >= 0.995 ? 'loses' : fmtRisk(r) + ' risk');
  /** Singles: one question at a time. 1. what you did (the Coach's pick first), 2. what they did, 3. HP after the turn. */
  function renderReport() {
    const L = S.live, box = $('#lv-report');
    if (!L || !box || !L.acts) return;
    if (L.doubles) return renderReportAll();
    const st = L.st;
    if (!L.prev) lvPreview();
    const nx = L.prev.nx;
    const me = SIM.actives(st, 'p')[0], foe = SIM.actives(st, 'a')[0];
    if (!me || !foe) return renderReportAll();
    const step = L.wiz || 'you';
    const STEPS = [['you', 'Your move'], ['them', 'Their move'], ['hp', 'What happened']];
    const bar = `<div class="wiz-steps" role="tablist">${STEPS.map(([k, l], i) => `<button class="wiz-step${k === step ? ' on' : ''}" role="tab" aria-selected="${k === step}" data-wiz="${k}"><span class="n">${i + 1}</span>${l}</button>`).join('')}</div>`;
    let body = '';
    if (step === 'you') {
      const opts = L.opts || [], rec = (L.recs || [])[0];
      const riskOf = v => { const [kind, x] = v.split(':'); const o = opts.find(q => (kind === 's' ? q.type === 'switch' && q.to === +x : q.type !== 'switch' && q.id === +x && !!q.z === (kind === 'z'))); return o ? riskText(o.risk) : ''; };
      const recKey = actKey(rec);
      const recOpt = opts[0];
      body = `<div class="wiz-q">What did you do with <b>${esc(shortName(me.name))}</b>?</div>
        ${rec ? `<p class="small wiz-tip">Coach: <b>${esc(actionLabel(st, 'p', rec))}</b>${recOpt ? ' ' + riskBadge(recOpt.risk) : ''}</p>` : ''}
        ${actButtonsHTML(st, 'p', me, 0, L.acts.p[0], recKey ? { [recKey]: 'Coach pick' } : {}, { pick: recKey, meta: riskOf })}
        <p class="small muted" style="margin:0">${esc(shortName(foe.name))} will most likely use ${predictionHTML(st, foe, (L.pred || [])[0]).replace(/^<b>[^:]*: /, '<b>')}.</p>
        ${orderHint(st, me, foe, L.acts.p[0], L.acts.a[0])}`;
    } else if (step === 'them') {
      body = `<div class="wiz-q">What did <b>${esc(shortName(foe.name))}</b> do?</div>
        ${actButtonsHTML(st, 'a', foe, 0, L.acts.a[0], predMarks(0))}
        <details class="rp-words" ${L.wordsOpen ? 'open' : ''} hidden><summary>Or tell the Coach in your own words</summary>
          <textarea id="lv-words" rows="2" placeholder="e.g. Water Gun, Snubbull switched to Squirtle, it's at about half, I'm at 70%">${esc(L.words || '')}</textarea>
          <div class="row"><button class="btn small" id="lv-parse">Fill it in</button><span class="note" id="lv-parse-out" aria-live="polite">${esc(L.wordsNote || '')}</span></div></details>`;
    } else {
      body = `<div class="wiz-q">What happened?</div>
        ${timelineHTML(st, nx)}
        <div class="lbl" style="margin-top:6px">HP after the turn</div>
        <p class="small muted" style="margin:0">The bars show what the Coach worked out from the above. Move one only if your game shows something else.</p>
        ${reportRows(nx)}
        <button class="btn primary wiz-go" id="lv-next">Next turn</button>`;
    }
    box.innerHTML = bar + body;
    wireReport();
  }
  // ---------------- what happened, in the game's order: who moved first, and how each move went ----------------
  const OUTCOME_LABEL = { hit: 'Hit', crit: 'Critical hit', miss: 'Missed', par: 'Fully paralyzed', slp: 'Fast asleep', frz: 'Frozen solid',
    conf: 'Hurt itself in confusion', flinch: 'Flinched', recharge: 'Had to recharge' };
  const CANT = ['par', 'slp', 'frz', 'conf', 'flinch', 'recharge'];
  /** The turn as the simulator played it: who acted in which order, and how each one's move went. */
  function turnOutcomes(nx) {
    const order = [], o = {};
    const rank = x => (x === 'hit' ? 0 : x === 'crit' ? 1 : x === 'miss' ? 2 : 3);   // can't-move beats a miss beats a crit
    for (const e of nx.events) {
      if (e.type !== 'outcome' || e.turn !== nx.turn) continue;
      if (!order.includes(e.side)) order.push(e.side);
      if (!o[e.side] || rank(e.o) > rank(o[e.side])) o[e.side] = e.o;
    }
    return { order, o };
  }
  /** Who should move first with these two moves, and why (priority, or Speed). */
  function firstMover(st, me, foe, pa, aa) {
    if (!pa || !aa || pa.type !== 'move' || aa.type !== 'move') return null;
    const pp = SIM.priorityOf(st, me, pa.id), pf = SIM.priorityOf(st, foe, aa.id);
    const sp = SIM.speed(st, me), sf = SIM.speed(st, foe);
    if (pp !== pf) return { side: pp > pf ? 'p' : 'a', why: 'priority', sp, sf };
    if (sp === sf) return { side: null, why: 'tie', sp, sf };
    return { side: (st.trickRoom ? sp < sf : sp > sf) ? 'p' : 'a', why: st.trickRoom ? 'trick room' : 'speed', sp, sf };
  }
  function speedLine(F, me, foe) {
    if (F.why === 'priority') return `${esc(shortName((F.side === 'p' ? me : foe).name))}’s move has priority.`;
    const tail = me.spec.exact ? '' : me.speRaw ? ', from who moved first earlier' : me.spec.iv ? ', estimated from an earlier battle'
      : ' if its Speed IV is perfect (enter its stats under Pokémon to be sure)';
    return `Speed: their ${esc(shortName(foe.name))} ${F.sf}, yours ${F.sp}${tail}${F.why === 'trick room' ? '. Trick Room: the slower one moves first' : ''}.`;
  }
  /** Step 1: who moves first if you attack (switches always go first). */
  function orderHint(st, me, foe, pa, aa) {
    const myMove = pa && pa.type === 'move' ? pa : { type: 'move', id: (SIM.usable(me, st) || [])[0] };
    if (!myMove.id || !aa || aa.type !== 'move') return '';
    const F = firstMover(st, me, foe, myMove, aa);
    if (!F) return '';
    const you = pa && pa.type === 'move' ? 'You' : 'If you attack, you';
    const head = F.side === null ? 'Speed tie: either of you can move first.' : F.side === 'p' ? `${you} should move first.` : `${esc(shortName(foe.name))} should move first.`;
    return `<p class="small muted" style="margin:0">⚡ ${head} ${F.side === null ? '' : speedLine(F, me, foe)}</p>`;
  }
  /** What could have happened to this move: it moved (hit, crit, missed), or it couldn't (status, confusion, flinch). */
  function outcomeChoices(st, sd, m, a, foe, foeAct, foeFirst) {
    if (m.recharge) return ['recharge'];
    const mv = E.mv(a.id) || {};
    const atFoe = mv.k !== 'X' || [0, 8, 32].includes(mv.tg || 0);
    const out = ['hit'];
    if (mv.k !== 'X') out.push('crit');
    if (atFoe && mv.a > 0 && m.ability !== 'No Guard' && (!foe || foe.ability !== 'No Guard')) out.push('miss');
    const can = new Set();
    if (m.status === 'slp') can.add('slp');
    if (m.status === 'frz') can.add('frz');
    if (m.status === 'par') can.add('par');
    if (m.confused) can.add('conf');
    if (foeFirst && foeAct && foeAct.type === 'move' && foe) {
      for (const k of SIM.mayCause(foe, foeAct.id)) if (['par', 'slp', 'frz', 'conf', 'flinch'].includes(k)) can.add(k);
      if (m.ability === 'Inner Focus') can.delete('flinch');
    }
    return out.concat(['slp', 'frz', 'par', 'conf', 'flinch'].filter(k => can.has(k)));
  }
  function timelineHTML(st, nx) {
    const L = S.live;
    const acts = { p: L.acts.p[0], a: L.acts.a[0] };
    const who = { p: SIM.actives(st, 'p')[0], a: SIM.actives(st, 'a')[0] };
    const T = turnOutcomes(nx);
    const movers = ['p', 'a'].filter(sd => acts[sd] && acts[sd].type === 'move' && who[sd]);
    const order = T.order.filter(sd => movers.includes(sd)).concat(movers.filter(sd => !T.order.includes(sd)));
    let h = '';
    for (const sd of ['p', 'a']) if (acts[sd] && acts[sd].type === 'switch' && who[sd]) {
      const to = st[sd].team[acts[sd].to];
      h += `<div class="tl-row"><span class="tl-n">⇄</span>${icon(to.spec.s)}<span>${sd === 'p' ? 'You' : 'They'} switched to <b>${esc(shortName(to.name))}</b> (switches go first)</span></div>`;
    }
    if (movers.length === 2) {
      const F = firstMover(st, who.p, who.a, acts.p, acts.a);
      h += `<div class="tl-q"><span class="small">Who moved first?</span><div class="chips">${['a', 'p'].map(sd => `<button class="chipbtn" data-first="${sd}" aria-pressed="${order[0] === sd}">${icon(who[sd].spec.s)}${esc(shortName(who[sd].name))} <span class="small muted">${sd === 'a' ? 'theirs' : 'yours'}</span></button>`).join('')}</div>
        ${F ? `<span class="note">${F.side === null ? 'A speed tie: either can go first.' : speedLine(F, who.p, who.a)}</span>` : ''}</div>`;
    }
    order.forEach((sd, n) => {
      const m = who[sd], a = acts[sd], mv = E.mv(a.id) || { f: '?' };
      const o = T.o[sd];
      const fsd = sd === 'p' ? 'a' : 'p';
      const foeFirst = order.indexOf(fsd) >= 0 && order.indexOf(fsd) < n;
      const choices = outcomeChoices(st, sd, m, a, who[fsd], acts[fsd], foeFirst);
      const label = k => (k === 'hit' && mv.k === 'X' ? 'It worked' : OUTCOME_LABEL[k]);
      const sleepy = m.status === 'slp' ? 'Hit, Missed or Critical hit means it woke up.' : m.status === 'frz' ? 'Hit, Missed or Critical hit means it thawed out.' : '';
      h += `<div class="tl-row"><span class="tl-n">${n + 1}</span>${icon(m.spec.s)}<span>${sd === 'a' ? 'Their' : 'Your'} <b>${esc(shortName(m.name))}</b> used <b>${esc(mv.f)}</b></span></div>`;
      h += o
        ? `<div class="chips tl-out">${choices.map(k => `<button class="chipbtn${CANT.includes(k) ? ' cant' : ''}" data-out="${sd}:${k}" aria-pressed="${k === o}">${esc(label(k))}</button>`).join('')}</div>${sleepy ? `<p class="note" style="margin:0 0 0 30px">${sleepy}</p>` : ''}`
        : `<div class="tl-out small muted">Fainted before it could move. <button class="btn small ghost" data-moved="${sd}">No, it moved</button></div>`;
    });
    return h ? `<div class="tl">${h}</div>` : '';
  }
  /** HP and status rows for whoever is on the field after the turn, and who came in for a fallen one. */
  function reportRows(nx) {
    const L = S.live, st = L.st;
    const pctNow = (side, i) => { const k = side + ':' + i; return k in L.hpEdits ? L.hpEdits[k] : pctExact(nx[side].team[i]); };
    const stNow = (side, i) => { const k = side + ':' + i; return k in L.statEdits ? L.statEdits[k] : (nx[side].team[i].status || ''); };
    const cnfNow = (side, i) => { const k = side + ':' + i; return k in (L.cnfEdits || {}) ? L.cnfEdits[k] : !!nx[side].team[i].confused; };
    // could it have been confused this turn? (their move can confuse)
    const confusable = side => { const os = side === 'p' ? 'a' : 'p', o = (L.acts[os] || [])[0], u = SIM.actives(st, os)[0]; return !!(o && o.type === 'move' && u && SIM.mayCause(u, o.id).has('conf')); };
    const hpRow = (side, i) => {
      const m = nx[side].team[i], nm = esc(shortName(m.name)), pct = pctNow(side, i);
      const val = side === 'p' ? Math.round(m.maxHp * pct / 100) : Math.round(pct);
      const max = side === 'p' ? m.maxHp : 100;
      const out = side === 'p' ? (val ? `${val}/${m.maxHp}` : 'fainted') : (val ? val + '%' : 'fainted');
      const cnf = cnfNow(side, i) || confusable(side);
      return `<div class="rp-mon">${icon(m.spec.s)}<div class="rp-name"><b>${nm}</b> <span class="muted small">${side === 'a' ? 'theirs' : 'yours'}</span></div>
        <div class="rp-st">${cnf ? `<button class="rp-cnf" data-cnf="${side}:${i}" aria-pressed="${cnfNow(side, i)}" aria-label="${nm}: confused">Confused</button>` : ''}<select class="inline" data-stat="${side}:${i}" aria-label="${nm}: status">${STATUS_OPTS.map(([k, l]) => `<option value="${k}" ${stNow(side, i) === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="rp-hp"><button class="rp-nudge" data-nudge="${side}:${i}:-1" aria-label="${nm}: less HP">−</button><input type="range" min="0" max="${max}" step="1" value="${val}" data-hp="${side}:${i}" data-max="${max}" aria-label="${nm}: HP left${side === 'a' ? ', percent' : ''}"><button class="rp-nudge" data-nudge="${side}:${i}:1" aria-label="${nm}: more HP">+</button><output data-hpo="${side}:${i}">${out}</output></div></div>`;
    };
    const sendRows = side => fieldedAt(side).map((cur, k) => {
      if (cur == null || !st[side].team[cur] || pctNow(side, cur) > 0) return '';
      const taken = new Set(fieldedAt(side));
      const cands = nx[side].team.map((m, i) => i).filter(i => !taken.has(i) && !st[side].slots.includes(i) && !nx[side].team[i].fainted && pctNow(side, i) > 0);
      if (!cands.length) return '';
      const key = side + ':' + k;
      const picks = side === 'a' ? aiChoicesAfter(nx, cur, k) : [coachReplace(nx, cur, k)];
      const chosen = key in L.sendout ? L.sendout[key] : (nx[side].slots[k] !== cur && cands.includes(nx[side].slots[k]) ? nx[side].slots[k] : picks[0]);
      return `<div class="rp-out"><div class="lbl">${esc(shortName(st[side].team[cur].name))} fainted. Who did ${side === 'a' ? 'they' : 'you'} send out?</div>
        <div class="chips">${cands.map(i => {
          const m = nx[side].team[i];
          const tag = side === 'a' ? (picks.length > 1 && picks.includes(i) ? 'coin flip' : picks[0] === i ? 'AI pick' : '') : (picks[0] === i ? 'Coach pick' : '');
          return `<button class="chipbtn" data-sendout="${key}:${i}" aria-pressed="${i === chosen}">${icon(m.spec.s)}${esc(shortName(m.name))}${tag ? ` <span class="tag">${tag}</span>` : ''}</button>`;
        }).join('')}</div>${side === 'a' && picks.length > 1 ? '<p class="note" style="margin:0">The engine flips a coin between equally good switch-ins, so either can come.</p>' : ''}</div>`;
    }).join('');
    const rows = side => fieldedAt(side).filter(i => i != null && st[side].team[i]).map(i => hpRow(side, i)).join('');
    return rows('a') + rows('p') + sendRows('a') + sendRows('p');
  }
  /** Doubles (and anything unusual): every question on one card. */
  function renderReportAll() {
    const L = S.live, box = $('#lv-report');
    if (!L || !box || !L.acts) return;
    const st = L.st;
    if (!L.prev) lvPreview();
    const nx = L.prev.nx;
    const singles = !L.doubles;
    const mine = SIM.actives(st, 'p'), theirs = SIM.actives(st, 'a');
    const they = singles
      ? theirs.map((m, k) => `<div class="rp-side"><div class="rp-q">${icon(m.spec.s)}<span>What did <b>${esc(shortName(m.name))}</b> do?</span></div>${actButtonsHTML(st, 'a', m, k, L.acts.a[k], predMarks(k))}</div>`).join('')
      : `<div class="rp-acts"><div><div class="small muted">You used</div>${mine.map((m, k) => actionSelect(st, 'p', m.slot, L.acts.p[k], 'lvp' + m.slot)).join('')}</div>
          <div><div class="small muted">They used</div>${theirs.map((m, k) => actionSelect(st, 'a', m.slot, L.acts.a[k], 'lva' + m.slot)).join('')}</div></div>`;
    const youDid = singles && L.acts.p[0] ? `<p class="small" style="margin:0">You: <b>${esc(actionLabel(st, 'p', L.acts.p[0]))}</b> <span class="muted">(tap a move or a switch above to change it)</span></p>` : '';
    box.innerHTML = `<div class="lbl">What happened this turn?</div>${they}${youDid}
      <div class="lbl">After the turn: set the HP to match your game</div>
      ${reportRows(nx)}
      ${singles ? `<details class="rp-words" ${L.wordsOpen ? 'open' : ''} hidden><summary>Or tell the Coach in your own words</summary>
        <textarea id="lv-words" rows="2" placeholder="e.g. Water Gun, Snubbull switched to Squirtle, it's at about half, I'm at 70%">${esc(L.words || '')}</textarea>
        <div class="row"><button class="btn small" id="lv-parse">Fill it in</button><span class="note" id="lv-parse-out" aria-live="polite">${esc(L.wordsNote || '')}</span></div></details>` : ''}
      <div class="row"><button class="btn primary" id="lv-next">Next turn</button><span class="note">The Coach plays it out, matches your numbers and gives you the next move.</span></div>`;
    wireReport();
    const mk = actKey(L.acts.p[0]);
    main.querySelectorAll('[data-mvpick]').forEach(o => o.setAttribute('aria-pressed', o.dataset.mvpick === mk ? 'true' : 'false'));
  }
  function wireReport() {
    const L = S.live, box = $('#lv-report'); if (!L || !box) return;
    const st = L.st;
    const reset = () => { L.prev = null; L.hpEdits = {}; L.statEdits = {}; L.cnfEdits = {}; L.sendout = {}; renderReport(); };
    // singles: tap what each side did
    box.querySelectorAll('[data-act]').forEach(b => b.onclick = () => {
      const [side, k, kind, x] = b.dataset.act.split(':');
      const foe = side === 'p' ? 'a' : 'p';
      L.acts[side][+k] = kind === 's' ? { type: 'switch', to: +x, why: 'switch' } : { type: 'move', id: +x, z: kind === 'z', target: { side: foe, slot: (SIM.actives(st, foe)[0] || { slot: 0 }).slot } };
      if (!L.doubles) L.wiz = side === 'p' ? 'them' : 'hp';   // on to the next question
      reset();
    });
    box.querySelectorAll('[data-wiz]').forEach(b => b.onclick = () => { L.wiz = b.dataset.wiz; renderReport(); });
    // what happened: who moved first, and how each move went; the turn is played again that way
    box.querySelectorAll('[data-first]').forEach(b => b.onclick = () => {
      const sd = b.dataset.first, a = L.acts[sd][0], o = L.acts[sd === 'p' ? 'a' : 'p'][0];
      if (!a || b.getAttribute('aria-pressed') === 'true') return;
      a.first = true; if (o) o.first = false;
      reset();
    });
    box.querySelectorAll('[data-out]').forEach(b => b.onclick = () => {
      const [sd, k] = b.dataset.out.split(':'), a = L.acts[sd][0];
      if (!a || b.getAttribute('aria-pressed') === 'true') return;
      a.outcome = k;
      reset();
    });
    box.querySelectorAll('[data-moved]').forEach(b => b.onclick = () => {
      // it didn't faint before its move: the hit before it left it standing
      const sd = b.dataset.moved, o = L.acts[sd === 'p' ? 'a' : 'p'][0];
      if (o && o.type === 'move') { o.noKO = true; o.ko = false; }
      reset();
    });
    // doubles: the selects
    const readActs = () => {
      L.acts.p = SIM.actives(st, 'p').map(m => readAction(st, 'p', m.slot, 'lvp' + m.slot));
      L.acts.a = SIM.actives(st, 'a').map(m => readAction(st, 'a', m.slot, 'lva' + m.slot));
    };
    box.querySelectorAll('select[id^="lvp"], select[id^="lva"]').forEach(sel => sel.addEventListener('change', () => { readActs(); reset(); }));
    box.querySelectorAll('select[data-hastarget="1"]').forEach(sel => {
      const tg = $('#' + sel.id + '-t');
      const sync = () => { if (tg) tg.hidden = sel.value.startsWith('s:'); };
      sel.addEventListener('change', sync); sync();
    });
    const setHp = (inp, v) => {
      const key = inp.dataset.hp, max = +inp.dataset.max, side = key[0];
      v = Math.max(0, Math.min(max, Math.round(v)));
      inp.value = v;
      const out = box.querySelector(`[data-hpo="${key}"]`);
      const m = L.prev.nx[side].team[+key.split(':')[1]];
      if (out) out.textContent = v ? (side === 'p' ? `${v}/${m.maxHp}` : v + '%') : 'fainted';
      const before = key in L.hpEdits ? L.hpEdits[key] : pctExact(m);
      L.hpEdits[key] = side === 'p' ? 100 * v / m.maxHp : v;
      if ((L.hpEdits[key] === 0) !== (before === 0)) {
        // fainting (or not) changes who comes in, and who got to move: play the turn again with the knock-out as it was
        const o = !L.doubles && L.acts[side === 'p' ? 'a' : 'p'][0];
        if (o && o.type === 'move' && E.mv(o.id) && E.mv(o.id).k !== 'X' && +key.split(':')[1] === fieldedAt(side)[0]) {
          o.ko = L.hpEdits[key] === 0; o.noKO = !o.ko; L.prev = null;
        }
        renderReport();
      }
    };
    box.querySelectorAll('input[type=range][data-hp]').forEach(inp => {
      inp.addEventListener('input', () => { const out = box.querySelector(`[data-hpo="${inp.dataset.hp}"]`); const side = inp.dataset.hp[0]; if (out) out.textContent = +inp.value ? (side === 'p' ? `${inp.value}/${inp.dataset.max}` : inp.value + '%') : 'fainted'; });
      inp.addEventListener('change', () => setHp(inp, +inp.value));
    });
    box.querySelectorAll('[data-nudge]').forEach(b => b.onclick = () => {
      const [side, i, d] = b.dataset.nudge.split(':');
      const inp = box.querySelector(`input[data-hp="${side}:${i}"]`); if (inp) setHp(inp, +inp.value + +d);
    });
    box.querySelectorAll('[data-stat]').forEach(sel => sel.onchange = () => { L.statEdits[sel.dataset.stat] = sel.value; });
    box.querySelectorAll('[data-cnf]').forEach(b => b.onclick = () => {
      const on = b.getAttribute('aria-pressed') !== 'true';
      (L.cnfEdits = L.cnfEdits || {})[b.dataset.cnf] = on; b.setAttribute('aria-pressed', String(on));
    });
    box.querySelectorAll('[data-sendout]').forEach(b => b.onclick = () => { const [side, k, i] = b.dataset.sendout.split(':'); L.sendout[side + ':' + k] = +i; renderReport(); });
    const words = box.querySelector('.rp-words');
    if (words) {
      words.addEventListener('toggle', () => { L.wordsOpen = words.open; });
      claudeSample().then(s => { if (s && words.isConnected) words.hidden = false; });   // only where this page can ask Claude
    }
    const ta = $('#lv-words'); if (ta) ta.addEventListener('input', () => { L.words = ta.value; });
    const parse = $('#lv-parse'); if (parse) parse.onclick = () => parseTurnWords(($('#lv-words') || {}).value || '');
    const nb = $('#lv-next'); if (nb) nb.onclick = applyReport;
  }
  function applyReport() {
    const L = S.live; if (!L || !L.prev) return;
    const st = L.st, nx = L.prev.nx;
    // the AI check: did the boss do what the ported AI predicted?
    SIM.actives(st, 'a').forEach((m, k) => {
      const p = (L.pred || [])[k], a = L.acts.a[k];
      if (!p || !a) return;
      const same = p.type === a.type && (a.type === 'switch' ? p.to === a.to : p.id === a.id);
      const c = { turn: st.turn + 1, boss: D.bosses[L.bi].n, mon: m.name, predicted: actionLabel(st, 'a', p), actual: actionLabel(st, 'a', a), ok: same, at: Date.now() };
      L.checks.push(c);
      const AC = S.run.aiChecks || (S.run.aiChecks = { n: 0, ok: 0, misses: [] });
      AC.n++; if (same) AC.ok++; else AC.misses = AC.misses.concat([c]).slice(-60);
    });
    if (!S.example) store.saveRun();
    for (const [key, pct] of Object.entries(L.hpEdits)) {
      const [side, i] = key.split(':'); const m = nx[side].team[+i]; if (!m) continue;
      m.hp = Math.round(m.maxHp * pct / 100); if (pct > 0 && m.hp === 0) m.hp = 1;
      m.fainted = m.hp <= 0; if (m.fainted) m.status = '';
    }
    for (const [key, s] of Object.entries(L.statEdits)) {
      const [side, i] = key.split(':'); const m = nx[side].team[+i]; if (!m || m.fainted) continue;
      if (s === 'slp' && m.status !== 'slp') m.sleep = 2;   // put to sleep: a couple of turns, as the Coach counts it
      if (s !== 'slp') m.sleep = 0;
      if (s === 'tox' && m.status !== 'tox') m.toxic = 0;
      m.status = s;
    }
    for (const [key, on] of Object.entries(L.cnfEdits || {})) { const [side, i] = key.split(':'); const m = nx[side].team[+i]; if (m && !m.fainted) m.confused = on ? Math.max(m.confused || 0, 3) : 0; }
    // who is out now: whoever took the turn's hits in each slot (the starter, or the one that switched in) stays in if it
    // is still standing; if it fell, the one you said came out replaces it (else the AI's pick, or the Coach's for you)
    for (const side of ['p', 'a']) fieldedAt(side).forEach((cur, k) => {
      const o = nx[side].team[cur]; if (!o) return;
      if (!o.fainted) {
        if (nx[side].slots[k] !== cur) { const was = nx[side].slots[k]; if (nx[side].team[was]) nx[side].team[was].slot = null; nx[side].slots[k] = cur; o.slot = k; }
        return;
      }
      const key = side + ':' + k;
      let to = key in L.sendout ? L.sendout[key] : (nx[side].slots[k] !== cur ? nx[side].slots[k] : null);
      if (to == null) to = side === 'a' ? aiChoicesAfter(nx, cur, k)[0] : coachReplace(nx, cur, k);
      const t2 = to != null ? nx[side].team[to] : null;
      if (t2 && !t2.fainted && (nx[side].slots[k] === to || !nx[side].slots.includes(to))) { nx[side].slots[k] = to; t2.slot = k; t2.firstTurn = true; }
    });
    // remember each of your faints and what took it (for the funeral): the simulator's record, or, for one you set by
    // hand, the move their Pokemon used this turn
    const recorded = nx.events.filter(e => e.type === 'faint' && e.side === 'p');
    const foeAct = L.acts.a[0], foeMon = SIM.actives(st, 'a')[0];
    const handCause = foeAct && foeAct.type === 'move' && foeMon ? `${shortName(foeMon.name)}'s ${E.mv(foeAct.id) ? E.mv(foeAct.id).f : 'attack'}` : '';
    const newly = nx.p.team.filter((m, i) => m.fainted && !(st.p.team[i] || {}).fainted)
      .map(m => recorded.find(e => e.key === m.key) || { type: 'faint', side: 'p', key: m.key, name: m.name, turn: st.turn + 1, cause: handCause });
    L.faints = (L.faints || []).concat(newly);
    speedLesson(st, nx);
    nx.policies = st.policies;
    if (!SIM.actives(nx, 'a').length && !nx.a.team.some(m => !m.fainted)) { nx.over = true; nx.winner = 'p'; }
    else if (!nx.p.team.some(m => !m.fainted)) { nx.over = true; nx.winner = 'a'; }
    else { nx.over = false; nx.winner = null; }
    L.st = nx; L.step = 'anim';
    L.anim = { from: SIM.snapshot(st), lines: L.prev.lines };
    L.prev = null; L.acts = null; L.hpEdits = {}; L.statEdits = {}; L.cnfEdits = {}; L.sendout = {}; L.words = ''; L.wordsNote = '';
    refreshLive();
    if (liveStage && liveStage.alive && $('#lv-stage') && $('#lv-stage').firstElementChild) playLive(); else mountLiveStage();
  }
  /** Who moved first says something about your Pokémon's Speed (its IVs and EVs aren't known until you enter its real
   *  stats): when the order you saw contradicts the Speed the Coach assumed, it takes the closest Speed that explains it,
   *  for the rest of this battle and (as a Speed IV estimate) for later fights. */
  function speedLesson(st, nx) {
    const L = S.live; L.lesson = '';
    if (L.doubles) return;
    const pa = L.acts.p[0], aa = L.acts.a[0];
    if (!pa || !aa || pa.type !== 'move' || aa.type !== 'move' || !(pa.first || aa.first)) return;
    const me = SIM.actives(st, 'p')[0], foe = SIM.actives(st, 'a')[0];
    if (!me || !foe || st.trickRoom || SIM.priorityOf(st, me, pa.id) !== SIM.priorityOf(st, foe, aa.id)) return;
    const it = x => (x.item ? E.itemName(x.item) || '' : '');
    if (/Quick Claw|Custap|Lagging Tail|Full Incense/.test(it(me) + ' ' + it(foe)) || [me.ability, foe.ability].some(a => a === 'Quick Draw' || a === 'Stall')) return;
    const meFirst = !!pa.first;
    const sp = SIM.speed(st, me), sf = SIM.speed(st, foe);
    if (meFirst ? sp > sf : sp < sf) return;   // what the Coach expected
    if (sp === sf) { if (meFirst) L.lesson = `A speed tie with ${shortName(foe.name)}: either of you can move first.`; return; }
    const ivs = (me.spec.iv || [31, 31, 31, 31, 31, 31]).slice(), evs = (me.spec.ev || [0, 0, 0, 0, 0, 0]).slice();
    const rawWith = (iv, ev) => E.rawStats(Object.assign({}, me.spec, { iv: ivs.slice(0, 5).concat([iv]), ev: evs.slice(0, 5).concat([ev]) })).spe;
    const lo = rawWith(0, 0), hi = rawWith(31, 252), base = me.speRaw || E.rawStats(me.spec).spe;
    const eff = r => SIM.speed(st, Object.assign({}, me, { speRaw: r }));
    let r = null;
    if (meFirst) { for (let x = base + 1; x <= hi; x++) if (eff(x) >= sf) { r = x; break; } }   // a tie it won counts
    else { for (let x = base - 1; x >= lo; x--) if (eff(x) < sf) { r = x; break; } }
    const nm = shortName(me.name);
    if (r == null) { L.lesson = `${meFirst ? nm : shortName(foe.name)} moved first, which Speed can’t explain (a Quick Claw, or a speed tie?). The Coach keeps its numbers.`; return; }
    const m2 = nx.p.team[me.idx]; if (m2) m2.speRaw = r;
    L.lesson = meFirst ? `You moved first, so ${nm} is faster than the Coach assumed: it now counts its Speed as ${r}.`
      : `${shortName(foe.name)} moved first, so ${nm}’s Speed can’t be ${base}: the Coach now counts it as ${r} or less. Enter its real stats under Pokémon for exact numbers.`;
    // keep it for later fights, as a Speed IV (or EV) estimate, unless you entered its real stats
    const mon = S.roster.find(x => x.key === me.key);
    if (mon && !mon.statsAt && !S.example) {
      let iv = 31, ev = 0;
      if (meFirst) { ev = 0; while (ev < 252 && rawWith(31, ev) < r) ev += 4; }
      else { iv = 0; while (iv < 31 && rawWith(iv + 1, 0) <= r) iv++; }
      mon.iv = (mon.iv || [31, 31, 31, 31, 31, 31]).slice(); mon.iv[5] = iv;
      mon.ev = (mon.ev || [0, 0, 0, 0, 0, 0]).slice(); mon.ev[5] = ev;
      mon.ivGuess = true;
      store.saveMon(mon);
    }
  }
  /** "Water Gun, Snubbull at about half, it used Power-Up Punch": Claude turns the player's words into the report (singles). */
  async function parseTurnWords(text) {
    const L = S.live, out = $('#lv-parse-out');
    if (!L || !out) return;
    if (!text.trim()) { out.textContent = 'Write what happened first.'; return; }
    const sample = await claudeSample();
    if (!sample) { out.textContent = 'Typing it out needs Claude, which isn’t available on this page. Use the choices above.'; return; }
    const st = L.st;
    const me = SIM.actives(st, 'p')[0], foe = SIM.actives(st, 'a')[0];
    if (!me || !foe) return;
    const ctx = {
      your_pokemon_out: shortName(me.name), your_moves: SIM.usable(me, st).map(id => E.mv(id).f), your_hp_before: pctOf(me),
      your_other_pokemon: st.p.team.filter(m => !m.fainted && m.idx !== me.idx).map(m => shortName(m.name)),
      their_pokemon_out: shortName(foe.name), their_moves: foe.moves.map(id => E.mv(id).f), their_hp_before: pctOf(foe),
      their_other_pokemon: st.a.team.filter(m => !m.fainted && m.idx !== foe.idx).map(m => shortName(m.name)),
    };
    const prompt = 'A player is reporting one turn of a Pokémon battle to a battle tracker. Turn their words into data.\n\n'
      + 'The battle before this turn:\n' + JSON.stringify(ctx, null, 1) + '\n\n'
      + 'What the player wrote:\n<report>\n' + text.slice(0, 600) + '\n</report>\n\n'
      + 'Reply with only one JSON object with these keys, using null for anything the player didn\'t say:\n'
      + '{"you_used": a name from your_moves, or "switch:" followed by a name from your_other_pokemon,\n'
      + ' "they_used": a name from their_moves, or "switch:" followed by a name from their_other_pokemon,\n'
      + ' "your_hp": percent of HP your Pokémon on the field has left after the turn (the one you switched to, if you switched; 0 if it fainted),\n'
      + ' "their_hp": percent of HP their Pokémon on the field has left after the turn (the one they switched to, if they switched; 0 if it fainted),\n'
      + ' "your_status": one of "par", "brn", "psn", "tox", "slp", "frz", "none",\n'
      + ' "their_status": one of the same,\n'
      + ' "you_sent_out": a name from your_other_pokemon, if yours fainted and you sent one out,\n'
      + ' "they_sent_out": a name from their_other_pokemon, if theirs fainted and they sent one out}\n'
      + '"Half" means about 50, "a sliver" about 5, "full" 100. Example:\n'
      + '{"you_used":"Water Gun","they_used":"Power-Up Punch","your_hp":70,"their_hp":40,"your_status":null,"their_status":null,"you_sent_out":null,"they_sent_out":null}';
    out.textContent = 'Reading it…';
    const btn = $('#lv-parse'); if (btn) btn.disabled = true;
    try {
      const r = await sample.json(prompt, { modelTier: 'quick' });
      if (S.live !== L || L.st !== st) return;
      applyWords(r && typeof r === 'object' ? r : {});
    } catch (e) {
      const code = e && e.code;
      const msg = ['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed'].includes(code) ? 'Claude isn’t available for this page, so use the choices above.'
        : code === 'rate_limited' ? 'Claude is busy or you’ve reached your usage limit. Use the choices above.'
        : code === 'cancelled' ? '' : 'I couldn’t read that. Try other words, or use the choices above.';
      L.wordsNote = msg; const o = $('#lv-parse-out'); if (o) o.textContent = msg;
    } finally { const b = $('#lv-parse'); if (b) b.disabled = false; }
  }
  function applyWords(r) {
    const L = S.live, st = L.st;
    const me = SIM.actives(st, 'p')[0], foe = SIM.actives(st, 'a')[0];
    const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const act = (side, m, v) => {
      if (!v) return null;
      const s = String(v);
      if (/^switch:/i.test(s)) {
        const want = norm(s.slice(7));
        const idx = st[side].team.findIndex(x => !x.fainted && x.idx !== m.idx && norm(shortName(x.name)) === want);
        return idx >= 0 ? { type: 'switch', to: idx } : null;
      }
      const ids = side === 'p' ? SIM.usable(m, st) : m.moves;
      const id = ids.find(x => E.mv(x) && (norm(E.mv(x).f) === norm(s) || norm(E.mv(x).n) === norm(s)));
      return id ? { type: 'move', id, z: false, target: { side: side === 'p' ? 'a' : 'p', slot: 0 } } : null;
    };
    const got = [];
    const a1 = act('p', me, r.you_used), a2 = act('a', foe, r.they_used);
    if (a1) { L.acts.p[0] = a1; got.push(`you used ${actionLabel(st, 'p', a1)}`); }
    if (a2) { L.acts.a[0] = a2; got.push(`${shortName(foe.name)} used ${actionLabel(st, 'a', a2)}`); }
    L.prev = null; L.hpEdits = {}; L.statEdits = {}; L.sendout = {};
    lvPreview();
    const pct = v => (v == null || v === '' || isNaN(+v) ? null : Math.max(0, Math.min(100, Math.round(+v))));
    const yh = pct(r.your_hp), th = pct(r.their_hp);
    const mi = fieldedAt('p')[0], fi = fieldedAt('a')[0];          // after a switch, the one that came in
    const myOut = st.p.team[mi] || me, theirOut = st.a.team[fi] || foe;
    if (yh != null) { L.hpEdits['p:' + mi] = yh; got.push(`${shortName(myOut.name)} ${yh ? yh + '%' : 'fainted'}`); }
    if (th != null) { L.hpEdits['a:' + fi] = th; got.push(`${shortName(theirOut.name)} ${th ? th + '%' : 'fainted'}`); }
    const stt = v => ({ par: 'par', brn: 'brn', psn: 'psn', tox: 'tox', slp: 'slp', frz: 'frz', none: '' })[String(v || '').toLowerCase()];
    if (stt(r.your_status) !== undefined) L.statEdits['p:' + mi] = stt(r.your_status);
    if (stt(r.their_status) !== undefined) L.statEdits['a:' + fi] = stt(r.their_status);
    const sent = (side, v) => {
      if (!v) return;
      const idx = st[side].team.findIndex(x => !x.fainted && norm(shortName(x.name)) === norm(v));
      if (idx >= 0) { L.sendout[side + ':0'] = idx; got.push(`${side === 'a' ? 'they' : 'you'} sent out ${shortName(st[side].team[idx].name)}`); }
    };
    sent('a', r.they_sent_out); sent('p', r.you_sent_out);
    L.wordsNote = got.length ? `Got it: ${got.join(', ')}. Check it below, then tap Next turn.` : 'I couldn’t match that to this battle. Use the choices above.';
    renderReport();
  }
  function wireLiveBlock(bi) {
    const b = D.bosses[bi], n = b.dbl ? 2 : 1;
    main.querySelectorAll('[data-lead]').forEach(btn => btn.onclick = () => {
      const i = +btn.dataset.lead; let cur = (S.liveLead || [0, 1].slice(0, n)).slice();
      cur = cur.includes(i) ? cur.filter(x => x !== i) : cur.concat(i).slice(-n);
      S.liveLead = cur.length ? cur : [i]; redrawLive(bi);
    });
    const start = $('#lv-start');
    if (start) start.onclick = () => { const lead = (S.liveLead || [0, 1]).slice(0, n); liveStart(bi, n > 1 ? lead : lead[0]); redrawLive(bi); };
    wireLive();
    mountLiveStage();
  }
  // ---------------- the battle screen (stage.js) for live battles and plan replays ----------------
  let liveStage = null, planStage = null;
  /** Where a fight happens decides the backdrop: caves, the sea, gyms and buildings, or grass. */
  function terrainOf(b) {
    const loc = (b && b.loc && b.loc[0]) || '';
    if (/Mt\. Moon|Tunnel|Cave|Victory Road|Seafoam|Mt\. Ember|Icefall|Diglett|Chamber|Lost Cave|Altering/.test(loc)) return 'cave';
    if (/Route (19|20|21)$|Beach|Sea/.test(loc)) return 'water';
    if (/Silph|Hideout|Tower|League|S\.S\. Anne|Mansion|Power Plant|Warehouse|Game Corner|Dept|Plateau/.test(loc)) return 'indoor';
    if (b && /Leader|Elite Four|Champion/.test(b.cls) && !/^Route/.test(loc)) return 'indoor';
    return 'grass';
  }
  function stageOpts(b, doubles) {
    const fc = (SPR && SPR.frontCols) || 32;
    return { sprite: sid => { const e = sprEntry(sid); return e ? { f: e.f, b: e.b } : null; },
      sheets: { fc, fr: (SPR && SPR.frontRows) || 43, bc: fc, br: (SPR && SPR.backRows) || 43 },
      foe: b ? `${b.cls} ${b.n}` : 'The trainer', terrain: terrainOf(b), doubles: !!doubles };
  }
  function stopStages() {
    if (liveStage) { liveStage.destroy(); liveStage = null; }
    if (planStage) { planStage.destroy(); planStage = null; }
  }
  /** The live battle's screen: plays the opening or the turn just entered, else shows where things stand. */
  function mountLiveStage() {
    const host = $('#lv-stage'), L = S.live;
    if (!host || !L || !window.createStage) return;
    liveStage = window.createStage(host, stageOpts(D.bosses[L.bi], L.doubles));
    playLive();
  }
  function livePrompt() {
    const L = S.live, stage = liveStage; if (!L || !stage) return;
    const st = L.st;
    if (st.over) stage.text(st.winner === 'p' ? `${D.bosses[L.bi].n} was defeated!` : 'You have no Pokémon left to fight…');
    else { const me = SIM.actives(st, 'p'); stage.text(me.length === 1 ? `What will ${me[0].name.replace(/ \(.*\)$/, '')} do?` : 'What will your Pokémon do?'); }
  }
  /** Play what is queued on the battle screen (the opening, or the turn just entered), then ask for the next turn.
   *  Only the parts around the screen are redrawn, in place: the page doesn't jump. */
  function playLive() {
    const L = S.live, stage = liveStage;
    if (!stage || !L) return;
    if (!L.anim) { stage.show(SIM.snapshot(L.st)); livePrompt(); return; }
    const a = L.anim;
    stage.show(a.from);
    keepInView($('#lv-stage'));
    (async () => {
      if (a.intro) await stage.intro();
      await stage.play(a.lines);
      if (liveStage !== stage || !stage.alive || S.live !== L) return;   // the page moved on meanwhile
      L.anim = null;
      stage.show(SIM.snapshot(L.st), true);   // the HP you set, where it differs from the Coach's numbers
      if (L.step === 'anim') { L.step = 'choose'; refreshLive(); }
      livePrompt();
    })();
  }
  /** Redraw the live battle around the battle screen (its title and what's under it) without rebuilding the page. */
  function refreshLive() {
    const L = S.live, head = $('#lv-head'), below = $('#lv-below');
    if (!L || !head || !below) { render(); return; }
    head.innerHTML = liveHeadHTML();
    below.innerHTML = liveBelowHTML();
    wireLive();
  }
  /** Scroll only as far as needed to show the element (nothing when it's already on screen). */
  function keepInView(el) {
    if (!el) return;
    const r = el.getBoundingClientRect(), h = window.innerHeight || document.documentElement.clientHeight;
    if (r.top >= 0 && r.bottom <= h) return;
    el.scrollIntoView({ block: r.height > h ? 'start' : 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
  function scrollToLive() { keepInView($('#lv-stage') || $('#live')); }
  function wireLive() {
    const L = S.live; if (!L) return;
    const st = L.st;
    const end = $('#lv-end'); if (end) end.onclick = () => { if (end.dataset.armed) { const bi = L.bi; S.live = null; redrawLive(bi); } else { end.dataset.armed = '1'; end.textContent = 'Confirm: end it'; end.classList.add('primary'); } };
    const close = $('#lv-close'); if (close) close.onclick = () => { const bi = L.bi; S.live = null; redrawLive(bi); };
    const beaten = $('#lv-beaten'); if (beaten) beaten.onclick = async () => { S.run.beaten.push(L.bi); await store.saveRun(); beaten.remove(); flash('Marked as beaten.'); };
    const dead = $('#lv-dead'); if (dead) dead.onclick = async () => {
      const b = D.bosses[L.bi];
      const fallen = [];
      for (const x of st.p.team.filter(m => m.fainted)) { const m = S.roster.find(r => r.key === x.key); if (m && m.box !== 'dead') { m.box = 'dead'; m.died = Object.assign({ at: Date.now(), before: b.n }, liveCause(m.key) || {}); fallen.push(m); await store.saveMon(m); } }
      dead.remove(); funeral(fallen);
    };
    main.querySelectorAll('select[data-hastarget="1"]').forEach(sel => {
      const t = $('#' + sel.id + '-t');
      const sync = () => { if (t) t.hidden = sel.value.startsWith('s:'); };
      sel.addEventListener('change', sync); sync();
    });
    const skipBtn = $('#lv-skip'); if (skipBtn) skipBtn.onclick = () => { if (liveStage) liveStage.skip(); };
    // the command box (singles): tapping a move is "I used this"
    main.querySelectorAll('[data-mvpick]').forEach(btn => btn.onclick = () => {
      if (!L.acts) return;
      const [kind, x] = btn.dataset.mvpick.split(':');
      L.acts.p[0] = kind === 's' ? { type: 'switch', to: +x, why: 'switch' } : { type: 'move', id: +x, z: false, target: { side: 'a', slot: 0 } };
      L.prev = null; L.hpEdits = {}; L.statEdits = {}; L.sendout = {};
      renderReport();
    });
    if (L.step === 'choose' && !st.over) { lvActsInit(L); renderReport(); }
    const logb = $('#lv-log');
    if (logb) logb.onclick = () => {
      const b = D.bosses[L.bi], g = FLOW.groupOf(L.bi);
      const key = b.route ? 'tr:' + b.id : g ? g.first : L.bi;
      if (st.winner === 'p') { S.resultForm = { g: key, fainted: st.p.team.filter(m => m.fainted).map(m => m.key) }; setFightTab(key, 'result'); render(); keepInView($('#result')); }
      else openEndRun('wipe', b);
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
      main.innerHTML = head + `<div class="empty">Add your Pokémon first (Menu → Pokémon).<button class="btn" id="bt-ex">Try an example team</button></div>`;
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
  function routeTrainers(a) { return D.bosses.filter(b => b.route && (b.areas || []).includes(a.n)); }
  /** The highest fixed level in a trainer's team (null when every level follows yours). */
  function trainerTopLv(b) { const lv = b.party.filter(m => m.lv != null).map(m => m.lv); return lv.length ? Math.max(...lv) : null; }
  /** Trainers here you'd fight at this level cap: the rest (a gym you come back to, the sea routes) wait for later. */
  function trainersNow(a, cap) { return routeTrainers(a).filter(b => { const t = trainerTopLv(b); return t == null || t <= cap + 4; }); }
  function areaCard(a, need, pin) {
    const e = (S.run.enc || {})[a.n];
    const owned = ownedFamilies();
    let status = a.fo || !areaSpecies(a).length ? '' : '<span class="tag">not yet</span>';
    if (e && e.r === 'caught') status = `${icon(e.s)}<span class="verdict v-safe">${esc(E.sp(e.s) ? E.sp(e.s).n : 'caught')}</span>`;
    else if (e && e.r === 'failed') status = `${e.s ? icon(e.s) : ''}<span class="verdict v-lose">missed${e.s && E.sp(e.s) ? ': ' + esc(E.sp(e.s).n) : ''}</span>`;
    else if (e && e.r === 'skipped') status = '<span class="verdict v-ok">skipped</span>';
    const open = !!pin || S.openArea === a.n;
    let body = '';
    if (open) {
      a.parts.forEach((part, k) => {
        const label = a.parts.length > 1 ? `<div class="lbl">Part ${k + 1} of ${a.parts.length}</div>` : '';
        let inner = '';
        for (const [kind, t] of Object.entries(part.k)) {
          const rows = mergedRows(t);
          if (!rows.length) continue;
          inner += `<div class="lbl">${METHOD_LABEL[kind] || kind}</div><div class="enc">${encRowsMerged(rows, owned, a.n)}</div>`;
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
      const pks = S.run.care ? (D.care || []).filter(pk => pk.area === a.n && !pk.after) : [];
      if (pks.length) body += `<div class="lbl">Care package here (SO2Toxic)</div><div class="small">${pks.map(pk => pk.items.map(([id, q]) => esc(E.itemName(id)) + (q !== 10 ? ' ×' + q : '')).join(', ')).join('; ')}</div>`;
      body += `<div class="row"><button class="btn small" data-best="${esc(a.n)}">Why? Compare the species</button>${e ? `<button class="btn small ghost" data-undo="${esc(a.n)}">Undo this encounter</button>` : `<button class="btn small ghost" data-skip="${esc(a.n)}">No encounter here</button>`}</div>
        <div id="best-${encodeURIComponent(a.n)}"></div>`;
    }
    const advise = !e && !a.fo && areaSpecies(a).length && (S.screen === 'run' || open);
    return `<details class="card area ${e ? 'done' : ''}" data-area="${esc(a.n)}" ${pin ? 'data-pin="1"' : ''} ${open ? 'open' : ''}><summary><span class="nm">${esc(a.n)}</span><span class="st">${status}</span>
      <span class="note">${a.fo || !areaSpecies(a).length ? 'no wild Pokémon · gifts and items' : `${areaSpecies(a).length} species`}${routeTrainers(a).length ? ' · ' + routeTrainers(a).length + (routeTrainers(a).length === 1 ? ' trainer' : ' trainers') : ''}${need ? ' · ' + esc(need) : ''}</span>
      ${advise ? catchLineHTML(a) : ''}</summary><div class="body">${body}</div></details>`;
  }
  function renderRoutes() {
    const enc = S.run.enc || {};
    const order = FLOW ? FLOW.steps.filter(s => s.kind === 'areas').flatMap(s => s.areas) : D.areas.map(a => a.n);
    const areas = order.map(n => D.areas.find(a => a.n === n)).filter(Boolean);
    const wild = areas.filter(a => !a.fo && areaSpecies(a).length);
    const doneN = wild.filter(a => enc[a.n]).length, caught = Object.values(enc).filter(e => e && e.r === 'caught').length;
    const list = S.routeFilter === 'todo' ? areas.filter(a => (!enc[a.n] && !a.fo && areaSpecies(a).length) || a.n === S.openArea) : areas;
    main.innerHTML = `<section class="section">
      <div class="card"><div class="row"><h2 class="grow">All areas</h2><span class="pill">${doneN}/${wild.length} done · ${caught} caught</span></div>
        <p class="small" style="margin:0">Nuzlocke rule: only the first Pokémon you meet in each area counts. Open an area, then tap <b>Caught</b> on what you got (it goes into your party with its level and the moves a wild one knows) or <b>✕</b> if it fainted or fled. Encounter tables, levels and odds are read from the ROM, including the separate day and night tables.</p>
        <div class="row small"><span class="seg" role="group" aria-label="Show"><button data-filter="todo" aria-pressed="${S.routeFilter === 'todo'}">Still to do</button><button data-filter="all" aria-pressed="${S.routeFilter !== 'todo'}">All areas, items and gifts</button></span>
          <label class="row" style="gap:6px;flex-wrap:nowrap"><input type="checkbox" id="dupes" ${S.run.dupes !== false ? 'checked' : ''}> <span>Dupes clause: mark species you already have</span></label></div></div>
      ${list.map(a => areaCard(a, FLOW ? FLOW.needOf(a.n) : '')).join('') || '<div class="empty">Every area is done. Switch to “All areas” to review them.</div>'}
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
    fillCatch();
    main.querySelectorAll('details.area').forEach(d => d.addEventListener('toggle', () => {
      if (d.dataset.pin) return;   // an area's own page keeps it open
      if (d.open && S.openArea !== d.dataset.area) { S.openArea = d.dataset.area; render(); const el = main.querySelector(`details.area[data-area="${CSS.escape(S.openArea)}"]`); if (el) el.scrollIntoView({ block: 'nearest' }); }
      else if (!d.open && S.openArea === d.dataset.area) S.openArea = null;
    }));
    main.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => { S.routeFilter = b.dataset.filter; render(); });

    const du = $('#dupes'); if (du) du.onchange = () => { S.run.dupes = du.checked; store.saveRun(); render(); };
    main.querySelectorAll('[data-got]').forEach(b => b.onclick = () => {
      const sid = +b.dataset.got, area = b.dataset.area;
      openEditor(null, { s: sid, lv: +b.dataset.lv, met: area, onSave: m => { setEnc(area, { s: sid, r: 'caught', key: m.key }); celebrateCatch(m.s, m.box); } });
    });
    main.querySelectorAll('[data-fail]').forEach(b => b.onclick = () => { setEnc(b.dataset.area, { s: +b.dataset.fail, r: 'failed' }); render(); });
    main.querySelectorAll('[data-skip]').forEach(b => b.onclick = () => { setEnc(b.dataset.skip, { r: 'skipped' }); render(); });
    main.querySelectorAll('[data-undo]').forEach(b => b.onclick = () => { setEnc(b.dataset.undo, null); render(); });
    main.querySelectorAll('[data-plan]').forEach(b => b.onclick = () => { S.planBoss = +b.dataset.plan; go('fight'); });
    main.querySelectorAll('[data-best]').forEach(b => b.onclick = () => bestCatch(D.areas.find(a => a.n === b.dataset.best)));
    main.querySelectorAll('[data-gift]').forEach(b => b.onclick = () => openEditor(null, { s: +b.dataset.gift, lv: +b.dataset.lv, met: `${b.dataset.area} (gift)`, onSave: m => celebrateCatch(m.s, 'gift') }));
    main.querySelectorAll('[data-tmown]').forEach(b => b.onclick = () => {
      const t = +b.dataset.tmown; const set = new Set(S.run.tms || []);
      if (set.has(t)) set.delete(t); else set.add(t);
      S.run.tms = [...set].sort((x, y) => x - y); b.setAttribute('aria-pressed', set.has(t));
      store.saveRun();
    });
  }
  /** Encounter planner: which species here would help most in the next two big fights, as what it evolves into by then. */
  // ---------------- what to catch: team-aware, by encounter method, and whether to wait for a rod or Surf ----------------
  const VSV = { safe: 3, ok: 2, risky: 1, lose: 0 };
  /** How well your living Pokemon answer each Pokemon in a boss fight (the best of your party and box, at the fight's cap). */
  const ANSWERS = new Map();
  function teamAnswers(bi) {
    const b = D.bosses[bi];
    const key = JSON.stringify([bi, alive().map(m => [m.key, m.s, m.lv, m.nat, m.ab, m.it || 0, m.mv])]);
    if (ANSWERS.has(key)) return ANSWERS.get(key);
    const team = E.bossTeam(bi, b.cap);
    const mine = alive().map(m => ({ m, spec: specOf(fightForm(m, b.cap)) }));
    const out = team.map(foe => {
      let best = 0, who = null;
      for (const x of mine) { const mu = E.matchup(Object.assign({}, x.spec, { entry: true }), Object.assign({}, foe, { entry: true })); const v = VSV[mu.verdict] - mu.risk; if (v > best) { best = v; who = x.m; } }
      return { foe, best, who };
    });
    if (ANSWERS.size > 60) ANSWERS.clear();
    ANSWERS.set(key, out);
    return out;
  }
  /** Your team against the next big fights: the Pokemon you have no safe answer to, and attack types most of your party is weak to. */
  function teamGaps(majors) {
    const gaps = [];
    for (const bi of majors) for (const a of teamAnswers(bi)) if (a.best < VSV.ok - 0.05) gaps.push({ bi, s: a.foe.s });
    const p = (party().length ? party() : alive()).map(m => E.sp(fightForm(m, D.bosses[majors[0]].cap).s)).filter(Boolean);
    const types = new Map();
    for (const bi of majors) for (const foe of E.bossTeam(bi, D.bosses[bi].cap)) for (const id of foe.mv) { const mv = E.mv(id); if (mv && mv.k !== 'X' && mv.p > 1) types.set(mv.t, true); }
    const weak = [...types.keys()].map(t => ({ t, n: p.filter(sp => E.typeEff(t, sp.t) >= 2).length })).filter(x => p.length && x.n >= Math.max(2, Math.ceil(p.length / 2))).sort((x, y) => y.n - x.n).slice(0, 3);
    return { gaps, weak, size: p.length };
  }
  /** How a species would add to your team in a boss fight, at its cap and evolved by then: the matchups it would win or save
   *  that your team doesn't already cover (and its plain total, for ties). */
  const CANDS = new Map();
  function candidateValue(sid, bi) {
    const b = D.bosses[bi];
    const key = sid + '|' + bi + '|' + (S.run.tms || []).length;
    let f = CANDS.get(key);
    if (!f) {
      const as = evolvedBy(sid, b.cap), sp = E.sp(as);
      const spec = { key: 'cand', s: as, lv: b.cap, nat: 0, ab: E.hardcoreAbility(sp.a[0], as), it: null, mv: [] };
      f = Object.assign({ as }, ADV.fightScore(spec, bi, S.run.tms || []));
      if (CANDS.size > 600) CANDS.clear();
      CANDS.set(key, f);
    }
    const ans = teamAnswers(bi);
    let gain = 0; const fills = [];
    f.per.forEach((x, k) => { const v = VSV[x.verdict] - x.risk, have = ans[k] ? ans[k].best : 0; if (v > have + 0.05) { gain += v - have; if (have < VSV.ok - 0.05 && v >= VSV.ok - 0.05) fills.push(x.foe); } });
    return { as: f.as, gain, total: f.score, fills };
  }
  /** When each way of meeting Pokemon opens: grass now; a rod once you've reached where it's handed out; Surf after the Soul Badge. */
  function methodOpen(kind, rod, P) {
    if (kind === 'land') return { now: true, label: 'Grass / cave', at: P.current };
    if (kind === 'rock') return { now: true, label: 'Rock Smash', at: P.current };
    if (kind === 'fish') {
      const where = ((D.rods || {})[rod] || [])[0];
      const k = where ? P.steps.findIndex(st => st.step.kind === 'areas' && st.step.areas.includes(where)) : -1;
      const now = k < 0 || k <= P.current || !!(S.run.enc || {})[where];
      return { now, label: rod, where, at: k < 0 ? P.current : k, why: where ? `the ${rod} (${where})` : `the ${rod}`, when: where ? `from ${where}` : '' };
    }
    // water: Surf, usable outside battle after the Soul Badge
    const soul = D.bosses.findIndex(b => b.ms === 'Soul Badge');
    const k = P.steps.findIndex(st => st.step.kind === 'fight' && st.step.g.members.includes(soul));
    return { now: S.run.beaten.some(i => D.bosses[i].ms === 'Soul Badge'), label: 'Surfing', at: k < 0 ? P.current : k + 1, why: 'Surf (after the Soul Badge)', when: 'after the Soul Badge' };
  }
  /** The two big fights after a point on the run path. */
  function majorsFrom(stepIndex) {
    const st = FLOW.steps.slice(stepIndex).find(s => s.kind === 'fight');
    return ADV.upcomingMajor(st ? Math.max(nextBoss(), st.g.first) : nextBoss(), 2);
  }
  /** Both time tables of a method merged: one row per species, with its chance by day and by night. */
  function mergedRows(t) {
    if (t.any) return t.any.map(([sid, lo, hi, pct, rod]) => ({ sid, lo, hi, rod, day: pct, night: pct, any: true }));
    const out = new Map();
    for (const time of ['day', 'night']) for (const [sid, lo, hi, pct, rod] of (t[time] || [])) {
      const k = sid + '|' + (rod || '');
      const r = out.get(k) || { sid, lo, hi, rod, day: 0, night: 0 };
      r.lo = Math.min(r.lo, lo); r.hi = Math.max(r.hi, hi); r[time] += pct;
      out.set(k, r);
    }
    return [...out.values()].sort((x, y) => (y.day + y.night) - (x.day + x.night));
  }
  function encRowsMerged(rows, owned, area) {
    return rows.map(r => {
      const sp = E.sp(r.sid); if (!sp) return '';
      const dupe = S.run.dupes !== false && owned.has(familyOf(r.sid));
      const when = r.any || r.day === r.night ? `${r.day}%` : !r.night ? `${r.day}% by day only` : !r.day ? `${r.night}% at night only` : `${r.day}% day · ${r.night}% night`;
      return `<div class="enc-row ${dupe ? 'dupe' : ''}">${icon(r.sid)}<div><div class="nm">${esc(sp.n)} ${typesHTML(sp.t)}${dupe ? '<span class="tag">dupe</span>' : ''}</div>
        <div class="meta">Lv ${r.lo === r.hi ? r.lo : r.lo + '–' + r.hi} · ${when}${r.rod ? ' · ' + esc(r.rod) : ''}</div></div>
        <div class="row" style="gap:4px;flex-wrap:nowrap"><button class="btn small" data-got="${r.sid}" data-lv="${r.hi}" data-area="${esc(area)}">Caught</button><button class="btn small ghost" data-fail="${r.sid}" data-area="${esc(area)}" aria-label="Didn't catch ${esc(sp.n)}">✕</button></div></div>`;
    }).join('');
  }
  /** What to do on a route: the best time of day, catch now or come back with a rod or Surf, and who to hope for. Every
   *  way of meeting Pokemon here is judged by what its species would add to your team in the next two big fights
   *  (for one you'll only have later, the two big fights after that). */
  function catchAdvice(a) {
    const P = runProgress(), owned = ownedFamilies();
    const times = areaHasTime(a) ? ['day', 'night'] : ['any'];
    const opts = [];
    for (const time of times) {
      const groups = new Map();
      for (const part of a.parts) for (const [kind, t] of Object.entries(part.k)) {
        const rows = t.any || (time === 'any' ? null : t[time]) || t.day || t.night || [];
        for (const r of rows) {
          const open = methodOpen(kind, kind === 'fish' ? r[4] : null, P);
          const g = groups.get(open.label) || { open, rows: new Map() };
          g.rows.set(r[0], (g.rows.get(r[0]) || 0) + r[3]);
          groups.set(open.label, g);
        }
      }
      for (const [label, g] of groups) {
        const majors = majorsFrom(g.open.now ? P.current : g.open.at);
        const total = [...g.rows.values()].reduce((x, y) => x + y, 0) || 1;
        const ranked = [...g.rows.entries()].map(([sid, pct]) => {
          let gain = 0, sum = 0, as = sid; const fills = [];
          for (const bi of majors) { const v = candidateValue(sid, bi); gain += v.gain; sum += v.total; as = v.as; fills.push(...v.fills.map(n => `${n} (${D.bosses[bi].n})`)); }
          const dupe = S.run.dupes !== false && owned.has(familyOf(sid));
          return { sid, as, pct: pct / total * 100, gain: dupe ? 0 : gain, sum, fills, dupe };
        }).sort((x, y) => (x.dupe - y.dupe) || (y.gain - x.gain) || (y.sum - x.sum));
        opts.push({ time, label, open: g.open, majors, ranked, expect: ranked.reduce((s, r) => s + r.pct / 100 * r.gain, 0) });
      }
    }
    const byExpect = (x, y) => y.expect - x.expect;
    const now = opts.filter(o => o.open.now).sort(byExpect), later = opts.filter(o => !o.open.now).sort(byExpect);
    const bestNow = now[0] || null, bestLater = later[0] || null;
    let time = 'any';
    if (times.length > 1 && bestNow) {
      const at = t => Math.max(0, ...now.filter(o => o.time === t).map(o => o.expect));
      const d = at('day'), n = at('night');
      if (Math.abs(d - n) > Math.max(0.3, 0.1 * Math.max(d, n))) time = d > n ? 'day' : 'night';
    }
    const pick = bestNow ? (time === 'any' ? bestNow : now.find(o => o.time === time) || bestNow) : null;
    // Waiting means fighting the next bosses without this Pokémon. With a small team a body now is worth a lot, and the
    // further away the rod or Surf is, the better the later catch has to be. Only a much better one, with a team of 4+.
    const n = alive().length;
    const body = n <= 2 ? 3 : n <= 3 ? 2 : n <= 5 ? 1 : 0.4;
    const chOf = k => ((FLOW.steps[Math.min(k, FLOW.steps.length - 1)] || {}).ch || 0);
    const far = bestLater ? Math.max(0, chOf(bestLater.open.at) - chOf(P.current)) : 0;
    const wait = bestLater && (!pick || (n >= 4 && bestLater.expect > (pick.expect + body) * 1.5 + 0.5 * far)) ? bestLater : null;
    return { opts, pick, wait, time, timed: times.length > 1, body, far };
  }
  const TIME_TEXT = { day: 'Go by day (4 AM–5 PM on your phone’s clock)', night: 'Go at night (5 PM–4 AM on your phone’s clock)', any: 'Any time of day' };
  /** The verdict for a route, in one or two sentences. */
  function catchLine(C) {
    const hope = o => o.ranked.filter(r => r.gain > 0.05).slice(0, 2).map(r => `${E.sp(r.sid).n} (${Math.round(r.pct)}%)`);
    if (C.wait) {
      const h = hope(C.wait);
      return `<b>Skip for now:</b> come back ${C.wait.label === 'Surfing' ? 'with Surf, after the Soul Badge' : `with the ${esc(C.wait.label)}${C.wait.open.where ? ` (from ${esc(C.wait.open.where)})` : ''}`}${h.length ? `, hoping for ${esc(h.join(' or '))}` : ''}.`;
    }
    if (!C.pick) return 'Nothing to meet here yet.';
    const h = hope(C.pick);
    const better = C.opts.filter(o => !o.open.now).sort((x, y) => y.expect - x.expect)[0];
    const small = better && better.expect > C.pick.expect * 1.3 + 0.4 && alive().length < 4 ? ` Better ones come ${better.label === 'Surfing' ? 'with Surf' : `with the ${esc(better.label)}`}, but your team is small: take one now.` : '';
    const how = C.pick.label === 'Grass / cave' ? '' : C.pick.label === 'Surfing' ? ' by surfing' : ` with the ${esc(C.pick.label)}`;
    if (!h.length) return `<b>${TIME_TEXT[C.time]}: catch now${how}.</b> Nothing here covers a gap in your team, but a backup is better than nothing.${small}`;
    return `<b>${TIME_TEXT[C.time]}: catch now${how}.</b> Hoping for ${esc(h.join(' or '))}.${small}`;
  }
  const CATCH = new Map();
  function catchKey(a) { return a.n + '|' + JSON.stringify([alive().map(m => [m.s, m.lv, m.mv]), S.run.beaten, Object.keys(S.run.enc || {}), (S.run.tms || []).length, S.run.dupes !== false]); }
  function catchFor(a) { const k = catchKey(a); if (!CATCH.has(k)) { if (CATCH.size > 200) CATCH.clear(); CATCH.set(k, catchAdvice(a)); } return CATCH.get(k); }
  /** Fill in the verdicts on the page, one route at a time, so it stays responsive. */
  function fillCatch() {
    const el = main.querySelector('[data-adv][data-pending="1"]');
    if (!el) return;
    setTimeout(() => {
      if (!el.isConnected) { fillCatch(); return; }
      const a = D.areas.find(x => x.n === el.dataset.adv);
      const html = a ? catchLine(catchFor(a)) : '';
      main.querySelectorAll(`[data-adv="${CSS.escape(el.dataset.adv)}"]`).forEach(x => { x.innerHTML = html; x.dataset.pending = '0'; });
      fillCatch();
    }, 20);
  }
  function catchLineHTML(a) {
    const k = catchKey(a);
    return CATCH.has(k) ? `<span class="adv" data-adv="${esc(a.n)}" data-pending="0">${catchLine(CATCH.get(k))}</span>` : `<span class="adv" data-adv="${esc(a.n)}" data-pending="1"><span class="muted">Working out what to hope for here…</span></span>`;
  }
  /** The details behind a verdict: each way of meeting Pokemon here, by time of day, best species first. */
  function bestCatch(a) {
    const box = document.getElementById('best-' + encodeURIComponent(a.n)); if (!box) return;
    box.innerHTML = '<div class="note">Comparing every species here…</div>';
    setTimeout(() => {
      if (!box.isConnected) return;
      const C = catchFor(a);
      if (!C.opts.length) { box.innerHTML = '<p class="small" style="margin:0">No wild Pokémon here.</p>'; return; }
      const covers = r => { const u = [...new Set(r.fills.map(x => x.replace(/ \(.*\)$/, '')))]; return u.length > 2 ? `${u.slice(0, 2).join(', ')} and ${u.length - 2} more` : u.join(' and '); };
      const fmt = r => `<div class="slot catch-row">${icon(r.sid)}<div class="who"><span class="cr-n"><b>${esc(E.sp(r.sid).n)}</b>${r.as !== r.sid ? `<span class="small muted"> → ${esc(E.sp(r.as).n)}</span>` : ''}${r.dupe ? ' <span class="tag">dupe</span>' : ''}</span>
        <span class="small muted">${Math.round(r.pct)}% · ${r.fills.length ? 'answers ' + esc(covers(r)) : r.gain > 0.05 ? 'adds to what you have' : 'nothing your team lacks'}</span></div><span class="num">${r.gain > 0.05 ? '+' + r.gain.toFixed(1) : '—'}</span></div>`;
      const when = o => (o.time === 'any' ? '' : o.time === 'day' ? ' · day' : ' · night');
      box.innerHTML = `<div class="card catch-card" style="box-shadow:none;border-width:2px">
        ${C.opts.slice().sort((x, y) => (y.open.now - x.open.now) || (y.expect - x.expect)).map(o => `<details class="more" ${o === C.pick || o === C.wait ? 'open' : ''}><summary>${esc(o.label)}${when(o)}${o.open.now ? '' : ` · later${o.open.when ? ', ' + esc(o.open.when) : ''}`} · expected +${o.expect.toFixed(1)}</summary>
          <div class="section" style="margin-top:6px">${o.ranked.slice(0, 4).map(fmt).join('')}<div class="small muted">Judged for ${o.majors.map(i => esc(D.bosses[i].n)).join(' and ')}.</div></div></details>`).join('')}
        <p class="note" style="margin:0">The number is what a species adds to your team: matchups against those bosses' exact Hardcore teams that it wins or saves and your Pokémon don't, at the level cap, evolved by level-up where it would be by then. “Expected” weighs each species by how often it appears.</p></div>`;
    }, 30);
  }
  /** Your team's gaps for the catch step: what the next big fights have that you can't answer yet. */
  function gapsHTML() {
    if (!alive().length) return '';
    const majors = ADV.upcomingMajor(nextBoss(), 2);
    if (!majors.length) return '';
    const G = teamGaps(majors);
    const byBoss = majors.map(bi => ({ bi, list: G.gaps.filter(g => g.bi === bi) })).filter(x => x.list.length);
    return `<div class="gaps"><div class="lbl">Your team vs ${majors.map(i => esc(D.bosses[i].n)).join(' and ')}: no safe answer yet to</div>
      ${byBoss.length ? byBoss.map(x => { const n = E.bossTeam(x.bi, D.bosses[x.bi].cap).length; return `<div class="gap-row"><b class="small">${esc(D.bosses[x.bi].n)}</b><span class="gap-icons">${x.list.map(g => `<span title="${esc(E.sp(g.s).n)}" role="img" aria-label="${esc(E.sp(g.s).n)}">${icon(g.s)}</span>`).join('')}</span><span class="small muted">${x.list.length === n ? `all ${n}` : `${x.list.length} of ${n}`}${x.list.length <= 2 ? ': ' + x.list.map(g => esc(E.sp(g.s).n)).join(', ') : ''}</span></div>`; }).join('') : '<div class="small">nobody: you have a safe answer to every Pokémon in both fights.</div>'}
      ${G.weak.length ? `<div class="small">Weak spots: ${G.weak.map(w => `${typeChip(w.t)} ${w.n} of ${G.size} weak`).join(', ')}.</div>` : ''}
      <div class="note">Each route below says what to hope for there, judged against this.</div></div>`;
  }

  // ---------------- YOUR RUN: the whole run as one path, step by step ----------------
  // Start → starter → catch on the new routes → the next fight (get ready, plan, play it, log it) → new routes → …
  // Steps you've done fold into one line; the step to do now is open; chapters follow the level caps (flow.js).
  let lastNow = null;
  function starterEntry() { return TIERS && TIERS.starters && S.run.starter ? TIERS.starters.find(x => x.s === S.run.starter) || null : null; }
  /** Which team you'll face in a fight with versions: your pick, else your rival's from your starter. */
  function fightOf(g) { const st = starterEntry(); return FLOW.chosenFight(g, S.run, st ? st.rival : null); }
  function topLevel() { const p = party().length ? party() : alive(); return Math.max(1, ...p.map(m => m.lv)); }
  function runProgress() { return FLOW.progress(S.run, { starterKnown: S.roster.some(m => /starter/i.test(m.met || '')) }); }
  function scrollToNow() { const el = $('#now'); if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
  function monShort(m) { return m.nick || (E.sp(m.s) || {}).n || '?'; }
  function partyStrip(cap) {
    return `<div class="party-strip">${party().map(m => `<button class="pmon" data-edit="${esc(m.key)}" aria-label="Edit ${esc(monName(m))}">${icon(m.s, 'hop')}<span class="nm">${esc(monShort(m))}</span><span class="lv${m.lv > cap ? ' over' : m.lv < cap ? ' under' : ''}">Lv ${m.lv}</span></button>`).join('')}</div>`;
  }

  let entering = false;
  // ---------------- the run, one screen at a time ----------------
  // Each step of the path becomes pages: the start, your starter, then each new area (and its trainers) on a page of
  // its own, then the fight (get ready, plan, battle, result). Back and Next walk them; your place is saved with the run.
  function runPages(P) {
    const pages = [];
    const cur = P.current < P.steps.length ? P.steps[P.current] : null;
    const curCh = cur ? cur.step.ch : -1;
    P.steps.forEach((st, k) => {
      const s = st.step;
      if ((k > P.current && s.ch !== curCh) || (s.post && !S.run.postgame && s.kind !== 'champion')) return;
      const base = { k, st, ch: s.ch };
      if (s.kind === 'areas') {
        for (const n of s.areas) {
          const a = D.areas.find(x => x.n === n); if (!a) continue;
          pages.push(Object.assign({ id: 'area:' + n, kind: 'area', area: a, label: n }, base));
          const cap = (FLOW.chapters[s.ch] || {}).cap || capNow();
          if (trainersNow(a, cap).length) pages.push(Object.assign({ id: 'trainers:' + n, kind: 'trainers', area: a, cap, label: 'Trainers: ' + n }, base));
        }
      } else if (s.kind === 'fight') pages.push(Object.assign({ id: s.id, kind: 'fight', label: D.bosses[fightOf(s.g)].n }, base));
      else pages.push(Object.assign({ id: s.id, kind: s.kind, label: s.kind === 'start' ? 'Start' : s.kind === 'starter' ? 'Starter' : 'Champion' }, base));
    });
    return { pages, cur };
  }
  const trainerState = b => ((S.run.tr || {})[b.id] || '');
  function pageDone(pg) {
    if (pg.kind === 'area') return !FLOW.isWild(pg.area.n) || !!(S.run.enc || {})[pg.area.n];
    if (pg.kind === 'trainers') return trainersNow(pg.area, pg.cap).every(b => trainerState(b));
    return pg.st.done || pg.st.passed;
  }
  /** Where you are: your saved place in the step you're on, else its first page still to do. */
  function herePage(pages, P) {
    const inStep = pages.filter(pg => pg.k === P.current);
    const at = inStep.find(pg => pg.id === S.run.at);
    if (at) return pages.indexOf(at);
    const todo = inStep.find(pg => !pageDone(pg)) || inStep[0];
    return todo ? pages.indexOf(todo) : pages.length - 1;
  }
  function renderRun() {
    if (!store.ready && !S.example) { main.innerHTML = '<div class="empty">Loading your run…</div>'; return; }
    const P = runProgress();
    const R = runPages(P), pages = R.pages;
    const here = herePage(pages, P);
    let vi = S.view ? pages.findIndex(pg => pg.id === S.view) : -1;
    if (vi < 0 || vi >= here) { vi = here; S.view = null; }
    const pg = pages[vi];
    entering = lastNow !== (pg && pg.id);
    const wiped = !S.example && S.roster.length > 0 && !alive().length;
    let html = '';
    if (S.example) html += `<div class="banner" style="display:grid;gap:8px"><span>This is the example team: nothing is saved and it isn't part of a run.</span><div><button class="btn small" id="ex-clear">Clear the example</button></div></div>`;
    html += runHeadHTML();
    if (wiped) html += wipeHTML();
    if (pg) {
      html += pagerHTML(pages, vi, here, P);
      html += `<section class="runpage${entering ? ' enter' : ''}" id="now" data-page="${esc(pg.id)}">${pageBodyHTML(pg, P)}</section>`;
      html += pageNavHTML(pages, vi, here, P);
    }
    html += `<details class="more overview" id="overview" ${S.overviewOpen ? 'open' : ''}><summary>The whole run, step by step</summary>${pathHTML(P, wiped, true)}</details>`;
    main.innerHTML = html;
    wireRun();
    wirePages(pages, vi, here, P);
    if (lastNow != null && pg && lastNow !== pg.id) setTimeout(() => keepInView($('#pager')), 60);
    lastNow = pg ? pg.id : null;
  }
  /** Chapter, where this page sits in it (a dot per page), and its name. */
  function pagerHTML(pages, vi, here, P) {
    const pg = pages[vi];
    const c = FLOW.chapters[pg.ch];
    const inCh = pages.filter(x => x.ch === pg.ch);
    const dots = inCh.map(x => {
      const i = pages.indexOf(x);
      const cls = i === vi ? 'on' : i === here ? 'here' : pageDone(x) || i < here ? 'done' : '';
      return `<button class="pdot ${cls}" data-goto="${esc(x.id)}" aria-label="${esc(x.label)}" ${i > here ? 'disabled' : ''}></button>`;
    }).join('');
    const n = inCh.indexOf(pg) + 1;
    return `<div class="pager" id="pager"><div class="row"><span class="ch-cap">Cap ${c ? c.cap : capNow()}</span><span class="grow small muted">${c ? esc(FLOW.chapterTitle(c)) : ''}</span><span class="small muted">${n} of ${inCh.length}</span></div>
      <div class="pdots">${dots}</div>${vi < here ? `<div class="row small"><span class="grow muted">Looking back: you're at <b>${esc(pages[here].label)}</b>.</span><button class="btn small" data-goto="${esc(pages[here].id)}">Back to where you are</button></div>` : ''}</div>`;
  }
  function pageBodyHTML(pg, P) {
    if (pg.kind === 'start') return startHTML();
    if (pg.kind === 'starter') return starterHTML();
    if (pg.kind === 'champion') return championHTML();
    if (pg.kind === 'area') return areaPageHTML(pg, P);
    if (pg.kind === 'trainers') return S.trainerBi != null && D.bosses[S.trainerBi] && (D.bosses[S.trainerBi].areas || []).includes(pg.area.n) ? trainerFightHTML(S.trainerBi, pg.area) : trainersPageHTML(pg);
    if (pg.st.done || pg.st.passed) return `<div class="card"><h2>${esc(pg.label)}</h2>${reviewHTML(pg.st)}</div>`;
    return fightHTML(pg.st, P);
  }
  /** Back and Next: Next on the page you're at moves you on (an area left without an encounter stays open for later). */
  function pageNavHTML(pages, vi, here, P) {
    const pg = pages[vi];
    const back = vi > 0 ? `<button class="btn" data-pnav="back" aria-label="Back to ${esc(pages[vi - 1].label)}">← Back</button>` : '<span></span>';
    // a fight moves on when you log it; the start and the starter when you've done them
    if (vi === here && (pg.kind === 'fight' || pg.kind === 'start' || pg.kind === 'starter' || pg.kind === 'champion')) return vi > 0 ? `<div class="pnav">${back}</div>` : '';
    if (S.trainerBi != null && pg.kind === 'trainers') return '';
    const next = pages[vi + 1];
    const nextLabel = vi < here ? (next ? next.label : '') : next ? next.label : (() => { const nf = P.steps.slice(P.current + 1).find(x => x.step.kind === 'fight'); return nf ? D.bosses[fightOf(nf.step.g)].n : 'the next step'; })();
    const why = vi === here && pg.kind === 'area' && FLOW.isWild(pg.area.n) && !(S.run.enc || {})[pg.area.n] ? '<span class="note">No encounter logged here: it stays open for later.</span>' : '';
    return `<div class="pnav">${back}<button class="btn primary" data-pnav="next">Next: ${esc(nextLabel)} →</button></div>${why}`;
  }
  function wirePages(pages, vi, here, P) {
    const pg = pages[vi];
    const go2 = id => { const i = pages.findIndex(x => x.id === id); if (i < 0) return; S.trainerBi = null; if (i >= here) { S.view = null; if (pages[i].k === P.current) S.run.at = id; } else S.view = id; render(); keepInView($('#pager')); };
    main.querySelectorAll('[data-goto]').forEach(b => b.onclick = () => go2(b.dataset.goto));
    main.querySelectorAll('[data-pnav]').forEach(b => b.onclick = () => {
      if (b.dataset.pnav === 'back') { if (vi > 0) go2(pages[vi - 1].id); return; }
      if (vi < here) { go2(pages[vi + 1].id); return; }
      // moving on from where you are
      const next = pages[vi + 1];
      if (next && next.k === pg.k) { S.run.at = next.id; S.view = null; S.trainerBi = null; render(); keepInView($('#pager')); store.saveRun(); return; }
      if (pg.st.step.kind === 'areas') S.run.passed = [...new Set((S.run.passed || []).concat(pg.st.step.id))];
      S.run.at = null; S.view = null; S.trainerBi = null; S.extraArea = null; S.openArea = null;
      render(); keepInView($('#pager')); store.saveRun();
    });
    const ov = $('#overview'); if (ov) ov.addEventListener('toggle', () => { S.overviewOpen = ov.open; });
  }
  function areaPageHTML(pg, P) {
    const a = pg.area, s = pg.st.step;
    const wild = FLOW.isWild(a.n);
    const older = FLOW.stillOpen(S.run, s.k).filter(n => !s.areas.includes(n));
    const card = (n, pin) => areaCard(D.areas.find(x => x.n === n), FLOW.needOf(n), pin);
    const first = s.areas.find(n => FLOW.isWild(n)) === a.n;
    let h = `<p class="small muted" style="margin:0">${wild ? 'Only your first encounter here counts: tap <b>Caught</b> on what you got, or <b>✕</b> if it fainted or fled. Not here yet, or waiting for a rod or Surf? Tap Next: it stays open for later.' : 'No wild Pokémon here: just items, gifts and one-time encounters.'}</p>`;
    h += card(a.n, true);
    if (wild && !s.post) h += `<details class="more small"><summary>What your team still needs</summary>${gapsHTML()}</details>`;
    if (older.length && first) h += `<details class="more" id="older" ${S.olderOpen ? 'open' : ''}><summary>Still open from earlier (${older.length})</summary><div class="section" style="margin-top:8px">${older.map(n => card(n)).join('')}</div></details>`;
    if (first) h += otherAreaHTML(s, older);
    return h;
  }
  function trainersPageHTML(pg) {
    const a = pg.area, list = trainersNow(a, pg.cap);
    const later = routeTrainers(a).filter(b => !list.includes(b));
    const done = list.filter(b => trainerState(b)).length;
    return `<div class="card rec"><div class="lbl">Trainers</div><h2>Trainers on ${esc(a.n)}</h2>
        <p class="small" style="margin:0">Plan each one you have to fight and play it turn by turn, like a boss. Walked around one? Mark it skipped. ${done ? `${done} of ${list.length} done.` : ''}</p></div>
      <div class="section">${list.map(b => {
        const stt = trainerState(b), team = E.bossTeam(b.i, topLevel());
        return `<div class="card trainer ${stt}"><div class="row"><b class="grow">${esc(b.cls)} ${esc(b.n)}${b.dbl ? ' <span class="tag">double</span>' : ''}</b>${stt === 'won' ? '<span class="verdict v-safe">won</span>' : stt === 'skipped' ? '<span class="verdict v-ok">skipped</span>' : ''}</div>
          <div class="team-icons">${team.map(m => `<span class="t">${icon(m.s)}<span>Lv ${m.lv}</span></span>`).join('')}</div>
          <div class="row">${stt ? `<button class="btn small ghost" data-trundo="${b.id}">Undo</button>` : `<button class="btn small primary" data-trfight="${b.i}">Plan and fight</button><button class="btn small" data-trwon="${b.id}">Already beat it</button><button class="btn small ghost" data-trskip="${b.id}">Skipped it</button>`}</div></div>`;
      }).join('')}</div>
      ${later.length ? `<p class="note" style="margin:0">Later here: ${later.length} more trainer${later.length === 1 ? '' : 's'} (Lv ${Math.min(...later.map(trainerTopLv))}–${Math.max(...later.map(trainerTopLv))}), for when you come back stronger.</p>` : ''}`;
  }
  // a fight in four parts, one at a time: get ready, plan, battle, result
  const FIGHT_TABS = [['ready', 'Get ready'], ['plan', 'Plan'], ['battle', 'Battle'], ['result', 'Result']];
  function setFightTab(key, tab) { S.fightTab = Object.assign({}, S.fightTab, { [key]: tab }); }
  function fightTab(key, bi) {
    if (S.resultForm && S.resultForm.g === key) return 'result';
    const t = (S.fightTab || {})[key];
    if (t) return t;
    return S.live && S.live.bi === bi ? 'battle' : 'ready';
  }
  function fightTabsHTML(key, tab) {
    return `<div class="ftabs" role="tablist" aria-label="This fight, step by step">${FIGHT_TABS.map(([k, l], i) => `<button role="tab" class="ftab${k === tab ? ' on' : ''}" aria-selected="${k === tab}" data-ftab="${k}" data-fkey="${esc(String(key))}"><span class="n">${i + 1}</span>${l}</button>`).join('')}</div>`;
  }
  function fightPanelHTML(key, tab, bi, cap, result) {
    const nextBtn = (t, l) => `<div class="pnav"><span></span><button class="btn primary" data-ftab="${t}" data-fkey="${esc(String(key))}">${l} →</button></div>`;
    if (tab === 'ready') return prepHTML(cap) + nextBtn('plan', 'Next: plan it');
    if (tab === 'plan') return (alive().length ? battlePlanHTML(planKey(), true) + theaterHTML() + '<div id="fight-more" class="section"><div class="note">Working out every matchup…</div></div>' : '<div class="empty">Add your Pokémon first.</div>') + nextBtn('battle', 'Next: the battle');
    if (tab === 'battle') return `<section class="section" id="live">${liveBlockHTML(bi)}</section>` + (S.live && S.live.bi === bi && !S.live.st.over ? '' : nextBtn('result', 'Next: log the result'));
    return `<div id="result">${result}</div>`;
  }
  function trainerFightHTML(bi, a) {
    const b = D.bosses[bi];
    b.cap = capNow();
    S.planBoss = bi;
    const key = 'tr:' + b.id, tab = fightTab(key, bi);
    const team = E.bossTeam(bi, topLevel());
    return `<div class="card rec fight-head" id="fight-page" data-fkey="${esc(key)}">
        <div class="row"><button class="linkbtn" id="tr-back">← All trainers on ${esc(a.n)}</button></div>
        <div class="lbl">Trainer</div><div class="row"><h2 class="grow">${esc(b.cls)} ${esc(b.n)}</h2>${b.dbl ? '<span class="pill warn">Double battle</span>' : ''}</div>
        <div class="vs-team">${team.map((m, k) => `<span class="vs-mon" style="--k:${k}" title="${esc(E.sp(m.s).n)}">${front(m.s, 's48') || icon(m.s)}<span>Lv ${m.lv}</span></span>`).join('')}</div></div>
      ${fightTabsHTML(key, tab)}${fightPanelHTML(key, tab, bi, capNow(), trainerResultHTML(b))}`;
  }
  function trainerResultHTML(b) {
    const key = 'tr:' + b.id, F = S.resultForm && S.resultForm.g === key ? S.resultForm : null;
    if (!F) return `<div class="card"><p class="small" style="margin:0">When it's over, log it. Pokémon that fainted are gone for good.</p>
      <div class="row"><button class="btn primary" id="res-won">I won</button><button class="btn" id="res-skip">I skipped it</button><button class="btn ghost" id="res-lost">I lost (run over)</button></div></div>`;
    const p = party().length ? party() : alive();
    return `<div class="card rec"><div class="lbl">You won! Did any of your Pokémon faint? Tap them.</div>
      <div class="chips">${p.map(m => `<button class="chipbtn" data-fainted="${esc(m.key)}" aria-pressed="${F.fainted.includes(m.key)}">${icon(m.s)}${esc(monShort(m))}</button>`).join('')}</div>
      <div class="row"><button class="btn primary" id="res-save">${F.fainted.length ? `Save: won, ${F.fainted.length} fainted` : 'Save: won, nobody fainted'}</button><button class="btn ghost" id="res-cancel">Cancel</button></div></div>`;
  }
  function setTrainer(id, v) { S.run.tr = Object.assign({}, S.run.tr || {}); if (v) S.run.tr[id] = v; else delete S.run.tr[id]; }
  async function logTrainer(b, fainted) {
    setTrainer(b.id, 'won');
    const dead = [];
    for (const key of fainted) { const m = S.roster.find(x => x.key === key); if (m && m.box !== 'dead') { m.box = 'dead'; m.died = Object.assign({ at: Date.now(), before: `${b.cls} ${b.n}` }, liveCause(key) || {}); dead.push(m); } }
    if (S.live && S.live.bi === b.i) S.live = null;
    S.resultForm = null; S.trainerBi = null;
    render();
    flash(`Beat ${b.cls} ${b.n}.`);
    funeral(dead);
    for (const m of dead) await store.saveMon(m);
    await store.saveRun();
  }
  /** Start over: save this run to your history (how and where it ended) and begin the next one at step 1. */
  function startNewRun() {
    if (!S.roster.length && !S.run.beaten.length && !S.run.started) { flash('This run hasn’t started yet: start it below.'); go('run'); return; }
    openEndRun('wipe');
  }
  function runHeadHTML() {
    const r = runSummary();
    const no = S.run.no || S.history.length + 1;
    const box = S.roster.filter(m => m.box === 'box').length;
    return `<section class="card runhead">
      <div class="row"><h2 class="grow">Run #${no}</h2><span class="pill">${r.milestones} of 16 milestones</span></div>
      ${badgesHTML()}
      ${party().length ? partyStrip(r.cap) : ''}
      <div class="row small"><span class="muted grow">${S.roster.length ? `${party().length}/6 in party · ${box} in box · ${r.fainted} fainted · ${r.caught} caught` : 'No Pokémon yet'}</span><button class="btn small ghost" data-go="team">Pokémon</button>${S.run.started || S.roster.length ? '<button class="btn small ghost" data-go="newrun">Start a new run</button>' : ''}</div>
    </section>`;
  }
  function wipeHTML() {
    const no = S.run.no || S.history.length + 1;
    return `<div class="card rec lost"><h2>Run over</h2><p class="small" style="margin:0">Every Pokémon you had has fainted. Save run #${no} to your history and start run #${no + 1}.</p>
      <div class="row"><button class="btn primary" id="wipe-end">Save and start run #${no + 1}</button></div></div>`;
  }
  function pathHTML(P, wiped, lines) {
    const cur = P.current < P.steps.length ? P.steps[P.current] : null;
    const curCh = cur ? cur.step.ch : FLOW.chapters.length - 1;
    const open = S.openChapters || (S.openChapters = new Set());
    let h = '';
    for (const c of FLOW.chapters) {
      if (c.post && !S.run.postgame) continue;
      if (c.k > curCh + 1) break;
      const sts = c.steps.map(k => P.steps[k]);
      const endB = c.end ? D.bosses[c.end.first] : null;
      const title = `<span class="ch-cap">Cap ${c.cap}</span>${endB && /Badge/.test(endB.ms) ? badgeSVG(endB.ms, !S.run.beaten.some(i => c.end.members.includes(i))) : ''}<span class="ch-t">${esc(FLOW.chapterTitle(c))}</span>`;
      if (c.k < curCh) {
        const won = sts.filter(s => s.won).length;
        const lost = S.roster.filter(m => m.died && sts.some(s => s.step.kind === 'fight' && s.step.g.first === m.died.fight)).length;
        h += `<details class="chap done" data-ch="${c.k}" ${open.has(c.k) ? 'open' : ''}><summary>${title}<span class="ch-sum">✓ ${won} won${lost ? ` · ✝ ${lost}` : ''}</span></summary><ol class="path">${sts.map(s => stepHTML(s, false)).join('')}</ol></details>`;
      } else if (c.k === curCh) {
        h += `<section class="chap now"><div class="ch-head">${title}</div><ol class="path">${sts.map(s => lines ? stepHTML(s, false, P, s === cur) : stepHTML(s, s === cur && !wiped, P)).join('')}</ol></section>`;
      } else {
        const nf = sts.filter(s => s.step.kind === 'fight').length;
        const na = sts.filter(s => s.step.kind === 'areas').reduce((n, s) => n + s.step.areas.filter(a => FLOW.isWild(a)).length, 0);
        h += `<div class="chap next"><div class="ch-head">${title}</div><p class="small muted" style="margin:0">Next chapter: ${nf} fight${nf === 1 ? '' : 's'}${na ? ` and ${na} new area${na === 1 ? '' : 's'}` : ''}.</p></div>`;
      }
    }
    return h;
  }
  function stepHTML(st, isNow, P, here) {
    const s = st.step;
    if (isNow) return `<li class="step now${entering ? ' enter' : ''}" id="now"><span class="dot" aria-hidden="true"></span><div class="now-body">${stepBodyHTML(st, P)}</div></li>`;
    if (here) return `<li class="step here"><span class="dot" aria-hidden="true"></span><div class="line">${stepLineHTML(st)} <span class="tag">you are here</span></div></li>`;
    const state = st.done ? 'done' : st.passed ? 'passed' : 'todo';
    const canOpen = (st.done || st.passed) && (s.kind === 'areas' || s.kind === 'fight');
    const opened = canOpen && S.openStep === s.id;
    const line = stepLineHTML(st);
    return `<li class="step ${state}"><span class="dot" aria-hidden="true"></span>${canOpen
      ? `<button class="line linebtn" data-openstep="${esc(s.id)}" aria-expanded="${opened}">${line}</button>` : `<div class="line">${line}</div>`}${opened ? `<div class="now-body">${reviewHTML(st)}</div>` : ''}</li>`;
  }
  function areaChipHTML(n) {
    const e = (S.run.enc || {})[n];
    if (!FLOW.isWild(n)) return `<span class="achip finds">${esc(n)}</span>`;
    if (!e) return `<span class="achip">${esc(n)}</span>`;
    if (e.r === 'caught') return `<span class="achip caught">${e.s ? icon(e.s) : ''}${esc(n)}</span>`;
    if (e.r === 'failed') return `<span class="achip failed">${e.s ? icon(e.s) : ''}${esc(n)} ✕</span>`;
    return `<span class="achip">${esc(n)} –</span>`;
  }
  function stepLineHTML(st) {
    const s = st.step;
    if (s.kind === 'start') return S.run.started ? `Run started ${esc(fmtDate(S.run.started))}` : 'Start the run';
    if (s.kind === 'starter') { const sp = S.run.starter ? E.sp(S.run.starter) : null; return sp ? `${icon(S.run.starter)}<span>Starter: <b>${esc(sp.n)}</b></span>` : st.done || st.passed ? 'Starter' : 'Choose your starter'; }
    if (s.kind === 'champion') return 'Beat the Champion';
    if (s.kind === 'areas') return `<span class="achips">${s.areas.map(areaChipHTML).join('')}</span>`;
    const b = D.bosses[fightOf(s.g)];
    const res = st.won ? '<span class="verdict v-safe">won</span>' : st.skipped ? '<span class="verdict v-ok">skipped</span>' : st.passed ? '<span class="verdict v-ok">not logged</span>' : '';
    const lost = st.won ? S.roster.filter(m => m.died && m.died.fight === s.g.first).length : 0;
    return `<span class="grow"><b>${esc(b.n)}</b> <span class="muted small">${esc(b.cls)}${b.loc ? ' · ' + esc(b.loc[0]) : ''}</span>${b.dbl ? ' <span class="tag">double</span>' : ''}${s.g.ms ? ' <span class="tag capup">cap ↑</span>' : ''}</span>${res}${lost ? `<span class="verdict v-lose">✝ ${lost}</span>` : ''}`;
  }
  /** A finished step, opened again: fix an encounter, or undo a result. */
  function reviewHTML(st) {
    const s = st.step;
    if (s.kind === 'areas') return s.areas.map(n => areaCard(D.areas.find(a => a.n === n), FLOW.needOf(n))).join('');
    const b = D.bosses[fightOf(s.g)];
    if (st.passed && !st.done) return `<div class="row small"><span class="grow muted">You went past ${esc(b.n)} without logging it.</span><button class="btn small" data-markwon="${s.g.first}">I beat it</button><button class="btn small ghost" data-markskip="${s.g.first}">I skipped it</button></div>`;
    return `<div class="row small"><span class="grow muted">${st.won ? `Beaten.` : 'Skipped.'} Undo it if that was a mistake (Pokémon marked as fainted stay fainted; fix them under Pokémon).</span><button class="btn small ghost" data-undofight="${s.g.first}">${st.won ? 'Undo the win' : 'Undo the skip'}</button></div>`;
  }
  function stepBodyHTML(st, P) {
    const s = st.step;
    if (s.kind === 'start') return startHTML();
    if (s.kind === 'starter') return starterHTML();
    if (s.kind === 'areas') return areasHTML(st, P);
    if (s.kind === 'fight') return fightHTML(st, P);
    return championHTML();
  }
  function startHTML() {
    const no = S.run.no || S.history.length + 1;
    const H = S.history;
    const best = H.length ? Math.max(...H.map(h => (h.progress || {}).milestones || 0)) : 0;
    return `<div class="card rec"><h2>Start run #${no}</h2>
      <p class="small" style="margin:0">The Coach takes you through the run in order: choose your starter, log the first encounter on each route, then for each fight get your team ready, plan it, play it turn by turn and log how it went. Then the next routes and the next fight, until you win or wipe.</p>
      <div class="lbl">Rules</div>
      <label class="row small" style="flex-wrap:nowrap;gap:8px"><input type="checkbox" id="r-dupes" ${S.run.dupes !== false ? 'checked' : ''}> Dupes clause: flag Pokémon from families you already caught</label>
      <label class="row small" style="flex-wrap:nowrap;gap:8px"><input type="checkbox" id="r-tutors" ${S.run.tutors ? 'checked' : ''}> Move tutors: let move advice suggest tutor moves</label>
      <div class="row"><button class="btn primary" id="run-start">Start run #${no}</button><button class="btn" id="run-import">Already playing? Import your save</button></div>
      ${H.length ? `<p class="note" style="margin:0">${H.length} past run${H.length > 1 ? 's' : ''}, furthest ${best} of 16 milestones. <button class="linkbtn" data-go="runs">See past runs</button></p>` : ''}</div>`;
  }
  function starterHTML() {
    return `<div class="card rec"><h2>Choose your starter</h2><p class="small" style="margin:0">Your starter carries the early game. These are all 27 that Oak's Lab offers, ranked for Hardcore against the game's own boss teams. Tap one for details, then choose it.</p></div>
      ${tierListHTML(true)}
      <div class="row"><button class="btn small ghost" id="st-skip">Already have your team? Skip this</button></div>`;
  }
  function championHTML() {
    const no = S.run.no || S.history.length + 1;
    return `<div class="card rec"><h2>You beat the Champion!</h2><p class="small" style="margin:0">Run #${no} is a win. Save it to your history, or keep going into the post-game: the Sevii Islands and the fights after the Champion.</p>
      <div class="row"><button class="btn primary" id="win-save">Save run #${no} as a win</button><button class="btn" id="win-more">Keep going</button></div></div>`;
  }
  function areasHTML(st, P) {
    const s = st.step;
    const nextF = P.steps.slice(s.k + 1).find(x => x.step.kind === 'fight');
    const nb = nextF ? D.bosses[fightOf(nextF.step.g)] : null;
    const wild = s.areas.filter(n => FLOW.isWild(n));
    const older = FLOW.stillOpen(S.run, s.k).filter(n => !s.areas.includes(n));
    const title = s.post ? 'Areas after the Champion' : wild.length <= 4 ? wild.join(', ').replace(/, ([^,]*)$/, ' and $1') : 'New areas';
    const card = n => areaCard(D.areas.find(a => a.n === n), FLOW.needOf(n));
    let h = `<div class="card rec"><div class="lbl">Catch</div><h2>${esc(title)}</h2>
      <p class="small" style="margin:0">Only your first encounter in each area counts. Open an area and tap <b>Caught</b> on what you got (it joins your team with the level and moves a wild one has), or <b>✕</b> if it fainted or fled. Gifts, one-time encounters and items are listed in each area.</p>
      ${s.post ? '' : gapsHTML()}</div>`;
    h += s.areas.map(card).join('');
    if (older.length) h += `<details class="more" id="older" ${S.olderOpen ? 'open' : ''}><summary>Still open from earlier (${older.length})</summary><div class="section" style="margin-top:8px">${older.map(card).join('')}</div></details>`;
    h += otherAreaHTML(s, older);
    h += `<div class="row"><button class="btn primary" id="step-next" data-id="${esc(s.id)}">Move on${nb ? `: next, ${esc(nb.n)}` : ''}</button>
      <span class="note">${st.open.length === 1 ? 'An area without an encounter stays open for later, under “Still open”.' : `Areas without an encounter (${st.open.length}) stay open for later, under “Still open”.`}</span></div>`;
    return h;
  }
  function otherAreaHTML(s, older) {
    const shown = new Set(s.areas.concat(older));
    const enc = S.run.enc || {};
    const order = FLOW.steps.filter(x => x.kind === 'areas').flatMap(x => x.areas).filter(n => FLOW.isWild(n) && !enc[n] && !shown.has(n));
    const extra = S.extraArea && !shown.has(S.extraArea) ? D.areas.find(a => a.n === S.extraArea) : null;
    if (!order.length && !extra) return '';
    return `<div class="field"><label for="other-area">Caught something in another area?</label><select id="other-area" class="inline"><option value="">Pick the area…</option>${order.map(n => `<option ${S.extraArea === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
      ${extra ? areaCard(extra, FLOW.needOf(extra.n)) : ''}`;
  }
  function variantLabel(g, i) {
    const b = D.bosses[i];
    if (b.v) return 'with ' + b.v;
    const parties = g.members.map(j => D.bosses[j].party.map(m => m.s));
    const n = Math.max(...parties.map(x => x.length));
    for (let k = 0; k < n; k++) if (new Set(parties.map(x => x[k])).size > 1) { const sp = b.party[k] ? E.sp(b.party[k].s) : null; return sp ? (k ? 'has ' : 'leads with ') + sp.n : 'smaller team'; }
    return 'version ' + (g.members.indexOf(i) + 1);
  }
  function variantHTML(g, bi) {
    const rival = D.bosses[g.first].cat === 'rival' && g.members.length === 3;
    const label = rival ? (starterEntry() ? "Your rival's team, from your starter (change it if you see another)" : "Your rival's team depends on your starter: pick the one you see") : `This fight has ${g.members.length} versions: pick the one you see`;
    return `<div class="lbl">${esc(label)}</div><div class="chips">${g.members.map(i => `<button class="chipbtn" data-variant="${i}" data-g="${g.first}" aria-pressed="${i === bi}">${esc(variantLabel(g, i))}</button>`).join('')}</div>`;
  }
  function focusHTML(st, g) {
    const pathB = D.bosses[fightOf(st.step.g)];
    if (g !== st.step.g) return `<div class="row small"><span class="muted grow">Out of order: ${esc(pathB.n)} is next on the path.</span><button class="linkbtn" id="focus-clear">Back to ${esc(pathB.n)}</button></div>`;
    const beaten = new Set(S.run.beaten), skipped = new Set(S.run.skipped || []);
    const later = FLOW.groups.filter(x => x.first > g.first && !x.members.some(i => beaten.has(i)) && !skipped.has(x.first) && !(FLOW.champ && x.first > FLOW.champ.first)).slice(0, 30);
    if (!later.length) return '';
    return `<details class="more small"><summary>Fighting someone else first?</summary><select id="focus-fight" class="inline" style="margin-top:6px"><option value="">Pick the fight…</option>${later.map(x => { const b = D.bosses[fightOf(x)]; return `<option value="${x.first}">${esc(b.n)} (${esc(b.cls)}${b.loc ? ', ' + esc(b.loc[0]) : ''}, cap ${b.cap})</option>`; }).join('')}</select></details>`;
  }
  function prepHTML(cap) {
    const p = party();
    if (!p.length) return `<div class="card"><p class="small" style="margin:0">Your party is empty. Add the Pokémon you have, or move some out of your box.</p><div><button class="btn" data-go="team">Pokémon</button></div></div>`;
    const under = p.filter(m => m.lv < cap);
    const evo = p.map(m => ({ m, to: evolvedBy(m.s, m.lv) })).filter(x => x.to !== x.m.s && E.sp(x.to));
    return `<div class="card">${partyStrip(cap)}
      ${under.length ? `<div class="row"><button class="btn small" id="to-cap">Level ${under.length === p.length ? 'everyone' : esc(under.map(monShort).join(', '))} up to ${cap}</button><span class="note">the cap; new moves and evolutions come up as you go</span></div>` : `<p class="small" style="margin:0">Everyone is at the level cap (${cap}).</p>`}
      ${evo.map(x => `<div class="evo-row">${icon(x.to)}<span>${esc(monName(x.m))} evolves into <b>${esc(E.sp(x.to).n)}</b> by Lv ${x.m.lv}.</span><button class="btn small" data-evolve="${esc(x.m.key)}" data-to="${x.to}">Evolve</button></div>`).join('')}
      <p class="note" style="margin:0">Tap a Pokémon for its level, moves, and the Coach's nature and held item. The plan picks your best six from your party and box.</p></div>
      <div class="card tune" id="prep-tune"><div class="lbl">Natures and held items</div><div class="tune-rows">${p.map(m => tuneRowHTML(m)).join('')}</div>
      <p class="note" style="margin:0">Natures are picked for your next three big fights (Radical Red's Nature Changer swaps them); held items for this fight, from what you have${S.run.care ? ' (care package so far included)' : ''}. Both are judged at the level cap, evolved where they would be by then.</p></div>`;
  }
  /** Coach's nature and held item for each party Pokemon, worked out one at a time after the page shows. */
  const TUNE = new Map();
  function tuneKey(m) { return JSON.stringify([m.key, m.s, m.lv, m.nat, m.ab, m.it || 0, m.mv, !!m.noEvo, S.planBoss, capNow(), topLevel(), careState().key, (S.run.bag || []).length, (S.run.tms || []).length]); }
  function tuneRowHTML(m) {
    const r = TUNE.get(tuneKey(m));
    const head = `${icon(m.s)}<b>${esc(monShort(m))}</b>`;
    if (!r) return `<div class="tune-row" data-tune="${esc(m.key)}">${head}<span class="note grow">Working it out…</span></div>`;
    const nat = r.nat === m.nat
      ? `<span class="small">Nature: <b>${esc(D.natures[m.nat].n)}</b> <span class="muted">is best</span></span>`
      : `<span class="small">Nature: <b>${esc(natureText(r.nat))}</b> <span class="muted">(now ${esc(D.natures[m.nat].n)})</span></span><button class="btn small" data-tunenat="${esc(m.key)}" data-v="${r.nat}">Changed it</button>`;
    const it = r.it
      ? `<span class="small">Hold: <b>${esc(E.itemName(r.it))}</b> <span class="muted">(+${r.g.toFixed(1)}${m.it ? ', instead of ' + esc(E.itemName(m.it)) : ''}; ${esc(itemFrom(r.it))})</span></span><button class="btn small" data-tuneit="${esc(m.key)}" data-v="${r.it}">Give it</button>`
      : `<span class="small">Hold: ${m.it ? `<b>${esc(E.itemName(m.it))}</b> <span class="muted">is as good as anything you have</span>` : '<span class="muted">none of your items changes these matchups</span>'}</span>`;
    const later = r.later ? `<div class="tune-line"><span class="small muted">Later: <b>${esc(E.itemName(r.later.id))}</b> (+${r.later.g.toFixed(1)}) comes ${esc(r.later.w)}</span></div>` : '';
    return `<div class="tune-row" data-tune="${esc(m.key)}">${head}<div class="tune-pick"><div class="tune-line">${nat}</div><div class="tune-line">${it}</div>${later}</div></div>`;
  }
  function tuneFor(m) {
    const k = tuneKey(m);
    if (TUNE.has(k)) return TUNE.get(k);
    const f = fightForm(m, capNow());
    const na = ADV.natureAdvice(specOf(f), S.planBoss, S.run.tms || [], 3);
    const team = E.bossTeam(S.planBoss, Math.max(f.lv, topLevel()));
    const base = itemScore(f, m.it || null, team);
    let best = null;
    for (const id of itemPool().keys()) { if (id === m.it) continue; const g = itemScore(f, id, team) - base; if (g > 0.15 && (!best || g > best.g)) best = { id, g }; }
    let later = null;   // a care package item still to come that would beat everything you have
    for (const [id, w] of laterPool()) { const g = itemScore(f, id, team) - base; if (g > (best ? best.g : 0) + 0.5 && (!later || g > later.g)) later = { id, g, w }; }
    const r = { nat: na.best.nat, it: best ? best.id : null, g: best ? best.g : 0, later };
    if (TUNE.size > 300) TUNE.clear();
    TUNE.set(k, r);
    return r;
  }
  function fillTune() {
    const box = $('#prep-tune'); if (!box) return;
    const todo = party().filter(m => !TUNE.has(tuneKey(m)));
    const wire = () => {
      box.querySelectorAll('[data-tunenat]').forEach(b => b.onclick = async () => { const m = S.roster.find(x => x.key === b.dataset.tunenat); if (!m) return; m.nat = +b.dataset.v; flash(`${monShort(m)} is now ${D.natures[m.nat].n}.`); render(); await store.saveMon(m); });
      box.querySelectorAll('[data-tuneit]').forEach(b => b.onclick = async () => { const m = S.roster.find(x => x.key === b.dataset.tuneit); if (!m) return; m.it = +b.dataset.v; flash(`${monShort(m)} now holds ${E.itemName(m.it)}.`); render(); await store.saveMon(m); });
    };
    wire();
    if (!todo.length) return;
    const m = todo[0];
    setTimeout(() => {
      if (!document.body.contains(box)) return;
      tuneFor(m);
      const row = box.querySelector(`[data-tune="${CSS.escape(m.key)}"]`);
      if (row) row.outerHTML = tuneRowHTML(m);
      fillTune();
    }, 30);
  }
  function resultHTML(g, bi) {
    const b = D.bosses[bi];
    const F = S.resultForm && S.resultForm.g === g.first ? S.resultForm : null;
    if (!F) return `<div class="card"><p class="small" style="margin:0">When the fight is over, log how it went. Pokémon that fainted are gone for good${b.ms ? `; a win raises the level cap to ${b.capAfter}` : ''}.</p>
      <div class="row"><button class="btn primary" id="res-won">I won</button>${g.ms ? '' : '<button class="btn" id="res-skip">I skipped it</button>'}<button class="btn ghost" id="res-lost">I lost (run over)</button></div></div>`;
    const p = party().length ? party() : alive();
    return `<div class="card rec"><div class="lbl">You won! Did any of your Pokémon faint? Tap them.</div>
      <div class="chips">${p.map(m => `<button class="chipbtn" data-fainted="${esc(m.key)}" aria-pressed="${F.fainted.includes(m.key)}">${icon(m.s)}${esc(monShort(m))}</button>`).join('')}</div>
      <div class="row"><button class="btn primary" id="res-save">${F.fainted.length ? `Save: won, ${F.fainted.length} fainted` : 'Save: won, nobody fainted'}</button><button class="btn ghost" id="res-cancel">Cancel</button></div></div>`;
  }
  function fightHTML(st) {
    const g = S.focus != null && FLOW.groupOf(S.focus) ? FLOW.groupOf(S.focus) : st.step.g;
    const bi = fightOf(g);
    S.planBoss = bi;   // the plan, the matchups, held items and the live battle all work on this fight
    const b = D.bosses[bi];
    const cap = capNow();
    const team = E.bossTeam(bi, topLevel());
    let h = `<div class="card rec fight-head" id="fight-page" data-fkey="${g.first}">
      <div class="lbl">${g === st.step.g ? (b.ms ? 'Next fight · raises the level cap' : 'Next fight') : 'Fighting out of order'}</div>
      <div class="row"><h2 class="grow">${esc(b.n)}</h2>${b.dbl ? '<span class="pill warn">Double battle</span>' : ''}</div>
      <div class="small muted">${esc(b.cls)}${b.loc ? ' · ' + esc(b.loc.join(', ')) : ''} · cap ${cap}${b.ms ? ` · a win raises it to ${b.capAfter}` : ''}</div>
      <div class="vs-team">${team.map((m, k) => `<span class="vs-mon" style="--k:${k}" title="${esc(E.sp(m.s).n)}">${front(m.s, 's48') || icon(m.s)}<span>Lv ${m.lv}</span></span>`).join('')}</div>
      ${g.members.length > 1 ? variantHTML(g, bi) : ''}
      ${focusHTML(st, g)}
    </div>`;
    const tab = fightTab(g.first, bi);
    h += fightTabsHTML(g.first, tab);
    h += fightPanelHTML(g.first, tab, bi, cap, resultHTML(g, bi));
    return h;
  }
  function evolveMon(m, to) {
    const from = E.sp(m.s), into = E.sp(to);
    const slot = from ? from.a.indexOf(m.ab) : 0;
    m.s = to; m.ab = (into.a[slot >= 0 ? slot : 0]) || into.a[0];
  }
  async function logWin(g, bi, fainted) {
    const b = D.bosses[bi];
    const capBefore = capNow();
    S.run.beaten = [...new Set(S.run.beaten.concat(g.members))];
    const dead = [];
    for (const key of fainted) { const m = S.roster.find(x => x.key === key); if (m && m.box !== 'dead') { m.box = 'dead'; m.died = Object.assign({ at: Date.now(), before: b.n, fight: g.first }, liveCause(key) || {}); dead.push(m); } }
    if (S.live && g.members.includes(S.live.bi)) S.live = null;
    S.resultForm = null; S.focus = null; S.openStep = null; S.extraArea = null; S.run.at = null; S.view = null;
    const cap = capNow();
    render();
    if (FLOW.champ && g.first === FLOW.champ.first) celebrateHoF();
    else celebrateWin(b, capBefore, cap, dead);
    funeral(dead);
    for (const m of dead) await store.saveMon(m);
    await store.saveRun();
  }
  function wireRun() {
    const on = (sel, fn) => { const el = $(sel); if (el) el.onclick = fn; };
    on('#ex-clear', () => { S.example = false; S.roster = []; render(); });
    main.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => { const m = S.roster.find(x => x.key === b.dataset.edit); if (m) openMon(m); });
    main.querySelectorAll('details.chap').forEach(d => d.addEventListener('toggle', () => { const k = +d.dataset.ch; if (d.open) S.openChapters.add(k); else S.openChapters.delete(k); }));
    main.querySelectorAll('[data-openstep]').forEach(b => b.onclick = () => { S.openStep = S.openStep === b.dataset.openstep ? null : b.dataset.openstep; render(); });
    main.querySelectorAll('[data-undofight]').forEach(b => b.onclick = () => {
      if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Confirm: undo'; b.classList.add('primary'); return; }
      const g = FLOW.groupOf(+b.dataset.undofight);
      S.run.beaten = S.run.beaten.filter(i => !g.members.includes(i));
      S.run.skipped = (S.run.skipped || []).filter(i => i !== g.first);
      S.openStep = null; render(); store.saveRun();
    });
    main.querySelectorAll('[data-markwon]').forEach(b => b.onclick = () => { const g = FLOW.groupOf(+b.dataset.markwon); S.run.beaten = [...new Set(S.run.beaten.concat(g.members))]; S.openStep = null; render(); store.saveRun(); });
    main.querySelectorAll('[data-markskip]').forEach(b => b.onclick = () => { S.run.skipped = [...new Set((S.run.skipped || []).concat(+b.dataset.markskip))]; S.openStep = null; render(); store.saveRun(); });
    on('#wipe-end', () => openEndRun('wipe'));
    on('#win-save', () => openEndRun('win', D.bosses[FLOW.champ.first]));
    on('#win-more', () => { S.run.postgame = true; render(); store.saveRun(); });
    // start
    const du = $('#r-dupes'); if (du) du.onchange = () => { S.run.dupes = du.checked; store.saveRun(); };
    const tu = $('#r-tutors'); if (tu) tu.onchange = () => { S.run.tutors = tu.checked; ADV.setOptions({ tutors: S.run.tutors }); store.saveRun(); };
    on('#run-start', () => { if (S.example) { S.example = false; S.roster = []; } S.run.started = Date.now(); render(); store.saveRun(); });
    on('#run-import', () => openImport());
    // starter
    wireTiers();
    on('#st-skip', () => { S.run.passed = [...new Set((S.run.passed || []).concat('starter'))]; render(); store.saveRun(); });
    // areas
    wireRoutes();
    const older = $('#older'); if (older) older.addEventListener('toggle', () => { S.olderOpen = older.open; });
    const oa = $('#other-area'); if (oa) oa.onchange = () => { S.extraArea = oa.value || null; S.openArea = oa.value || null; render(); };
    on('#step-next', () => { const id = $('#step-next').dataset.id; S.run.passed = [...new Set((S.run.passed || []).concat(id))]; S.extraArea = null; S.openArea = null; render(); store.saveRun(); });
    wireFight();
  }
  function wireFight() {
    const on = (sel, fn) => { const el = $(sel); if (el) el.onclick = fn; };
    // trainers on a route: fight one, or mark it beaten or skipped
    main.querySelectorAll('[data-trfight]').forEach(b => b.onclick = () => { S.trainerBi = +b.dataset.trfight; render(); keepInView($('#pager')); });
    main.querySelectorAll('[data-trwon]').forEach(b => b.onclick = () => { setTrainer(+b.dataset.trwon, 'won'); render(); store.saveRun(); });
    main.querySelectorAll('[data-trskip]').forEach(b => b.onclick = () => { setTrainer(+b.dataset.trskip, 'skipped'); render(); store.saveRun(); });
    main.querySelectorAll('[data-trundo]').forEach(b => b.onclick = () => { setTrainer(+b.dataset.trundo, null); render(); store.saveRun(); });
    on('#tr-back', () => { S.trainerBi = null; S.resultForm = null; render(); keepInView($('#pager')); });
    if (!$('#fight-page')) return;   // no fight on the page
    main.querySelectorAll('[data-ftab]').forEach(b => b.onclick = () => { setFightTab(b.dataset.fkey, b.dataset.ftab); render(); keepInView($('#fight-page')); });
    const bi = S.planBoss;
    const tb = D.bosses[bi];
    if (tb && tb.route) {
      // a route trainer: its result is kept with the run, it never moves the level cap
      on('#res-won', () => { S.resultForm = { g: 'tr:' + tb.id, fainted: [] }; render(); });
      on('#res-skip', () => { setTrainer(tb.id, 'skipped'); S.trainerBi = null; S.resultForm = null; render(); store.saveRun(); });
      on('#res-lost', () => openEndRun('wipe', tb));
      main.querySelectorAll('[data-fainted]').forEach(c => c.onclick = () => { const F = S.resultForm, k = c.dataset.fainted; F.fainted = F.fainted.includes(k) ? F.fainted.filter(x => x !== k) : F.fainted.concat(k); render(); });
      on('#res-cancel', () => { S.resultForm = null; render(); });
      on('#res-save', () => logTrainer(tb, S.resultForm.fainted.slice()));
    }
    const g = FLOW.groupOf(bi) || { first: bi, members: [bi] };
    main.querySelectorAll('[data-variant]').forEach(b => b.onclick = () => { S.run.variants = Object.assign({}, S.run.variants, { [b.dataset.g]: +b.dataset.variant }); render(); store.saveRun(); });
    const ff = $('#focus-fight'); if (ff) ff.onchange = () => { if (!ff.value) return; S.focus = +ff.value; S.resultForm = null; render(); scrollToNow(); };
    on('#focus-clear', () => { S.focus = null; S.resultForm = null; render(); scrollToNow(); });
    on('#to-cap', () => levelPartyTo(capNow()));
    main.querySelectorAll('[data-evolve]').forEach(b => b.onclick = async () => {
      const m = S.roster.find(x => x.key === b.dataset.evolve); if (!m) return;
      const from = monName(m); evolveMon(m, +b.dataset.to); flash(`${from} evolved into ${E.sp(m.s).n}. Check its moves and ability.`); render(); await store.saveMon(m);
    });
    wireBattlePlan();
    wireTheater();
    wireLiveBlock(bi);
    if (!(tb && tb.route)) {
      on('#res-won', () => { S.resultForm = { g: g.first, fainted: [] }; render(); });
      on('#res-skip', () => { S.run.skipped = [...new Set((S.run.skipped || []).concat(g.first))]; S.focus = null; S.resultForm = null; S.run.at = null; render(); store.saveRun(); });
      on('#res-lost', () => openEndRun('wipe', D.bosses[bi]));
      main.querySelectorAll('[data-fainted]').forEach(c => c.onclick = () => { const F = S.resultForm, k = c.dataset.fainted; F.fainted = F.fainted.includes(k) ? F.fainted.filter(x => x !== k) : F.fainted.concat(k); render(); });
      on('#res-cancel', () => { S.resultForm = null; render(); });
      on('#res-save', () => logWin(g, bi, S.resultForm.fainted.slice()));
    }
    // one-on-one matchups, held items and movesets once the page is up
    const key = planKey();
    setTimeout(() => {
      const box = $('#fight-more');
      if (box && S.screen === 'run' && S.planBoss === bi && planKey() === key) {
        const P = matchups();
        box.innerHTML = planExtrasHTML(P, true);
        wirePlan(P);
      }
      fillTune();
    }, 30);
  }

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
  const RESULT = { wipe: ['Wiped out', 'v-lose'], quit: ['Gave up', 'v-risky'], crash: ['Game crashed', 'v-ok'], win: ['Won', 'v-safe'] };
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
    tiersLoading = fetch('starters.json').then(r => (r.ok ? r.json() : null)).then(v => { TIERS = v; if (S.screen === 'runs' || S.screen === 'run') render(); }).catch(() => { TIERS = { error: true }; });
    return tiersLoading;
  }
  const TIER_COLORS = { S: '#e0523e', A: '#e8963a', B: '#e8c22c', C: '#5bb36a', D: '#5b8fd6' };
  function tierListHTML(choose) {
    if (!TIERS) { loadTiers(); return '<div class="empty">Loading the starter tier list…</div>'; }
    if (TIERS.error || !TIERS.starters) return '<div class="empty">The starter tier list didn’t load.</div>';
    const pick = S.tierPick != null ? TIERS.starters.find(x => x.s === S.tierPick) : null;
    const byFirst = S.tierSort === 'first' && TIERS.starters[0].first != null;
    const firstRows = byFirst ? `<ol class="first-rank">${TIERS.starters.slice().sort((a, b) => b.first - a.first).map(x => {
        const ff = (x.fights || []).filter(f => f[5] != null);
        return `<li><button class="chipbtn" data-tier="${x.s}" aria-pressed="${S.tierPick === x.s}">${icon(x.s)}${esc(x.name)}</button><span class="small muted">${ff.map(f => `${esc(f[0])} ${(f[5] * f[4]).toFixed(1)}/${f[4]}`).join(' · ')}</span></li>`;
      }).join('')}</ol>` : '';
    const rows = byFirst ? firstRows : ['S', 'A', 'B', 'C', 'D'].map(t => {
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
        ${pick.first != null ? bar(pick.first, 'First fights') : ''}${bar(pick.early, 'Early game')}${bar(pick.late, 'Rest of the run')}
        ${(pick.fights || []).some(f => f[5] != null) ? `<div class="small"><b>The first fights, alone</b> (one on one from full HP · against their whole team, no items):
          <ul class="first-fights">${(pick.fights || []).filter(f => f[5] != null).map(f => `<li><b>${esc(f[0])}</b> (cap ${f[1]}): beats ${(+f[3]).toFixed(f[3] % 1 ? 1 : 0)} of ${f[4]} one on one · knocks out ${(f[5] * f[4]).toFixed(1)} of ${f[4]} in a row</li>`).join('')}</ul>
          <span class="muted">Your catches have to cover the rest: no starter beats Hardcore Brock alone.</span></div>` : ''}
        <dl class="kv"><dt>Nature</dt><dd>${esc(pick.nature)} tested best (set it free with the Nature Change service)</dd>
          <dt>Ability</dt><dd>${esc(pick.ability || '—')}${pick.hidden ? ` · hidden: ${esc(pick.hidden)}` : ''}</dd>
          <dt>Rival</dt><dd>He takes the ${esc(pick.rival)} line, so his ${esc(pick.rival)} fights are the ones scored here</dd>
          <dt>Key moves</dt><dd>${pick.keyMoves.map(k => esc(E.mv(k.id) ? E.mv(k.id).f : '?') + (k.lv === 0 ? ' (on evolving)' : k.lv ? ` (Lv ${k.lv})` : '')).join(', ')}</dd>
          <dt>Best vs</dt><dd>${pick.best.map(fightLine).join('<br>')}</dd>
          <dt>Struggles vs</dt><dd>${pick.worst.map(fightLine).join('<br>')}</dd></dl>
        ${choose ? `<div class="row"><button class="btn primary" data-choose="${pick.s}">Choose ${esc(pick.name)}</button><span class="note">Then set the nature and ability you got.</span></div>` : ''}
      </div>`;
    }
    return `<div class="card"><p class="small" style="margin:0">All 27 starters Oak's Lab offers (the generation setting changes the three balls), ranked for Hardcore from the game's data. Each one is tested at every major fight's level cap up to the Champion (${TIERS.fights} fights), evolved by level as it would be by then, with its best level-up moves and nature, one-on-one against each of the boss's Pokémon. The first fights (the rival, Falkner, Brock and Archer) are also played out whole, the starter alone against their whole team, and count 40%: a nuzlocke ends at its first wipe, and that's when your starter is most of your team. Tap one for details.</p>
      <div class="row small"><span class="seg" role="group" aria-label="Rank by"><button data-tiersort="run" aria-pressed="${!byFirst}">Whole run</button><button data-tiersort="first" aria-pressed="${byFirst}">First fights</button></span>${byFirst ? '<span class="muted">Their Pokémon knocked out in a row, alone, no items</span>' : ''}</div>
      ${rows}${detail}
      <p class="note" style="margin:0">Scores run from 3 (beats every boss Pokémon safely) to −1 (loses to all of them); one Pokémon alone rarely beats a whole Hardcore team, so even the best sit near 1. TMs and tutors aren't assumed, so Pokémon that rely on them can do better than this.</p></div>`;
  }
  /** What your runs say: where you lose Pokemon, how each starter did, who you rely on, encounter luck, the AI check. */
  function insightsHTML() {
    const H = S.history || [];
    const AC = S.run.aiChecks;
    if (!H.length && !(AC && AC.n)) return '';
    const parts = [];
    if (H.length) {
      const ms = H.map(h => (h.progress || {}).milestones || 0);
      const wins = H.filter(h => h.result === 'win').length;
      parts.push(`<div class="small">${H.length} finished run${H.length > 1 ? 's' : ''}: ${wins} won, average ${(ms.reduce((a, b) => a + b, 0) / H.length).toFixed(1)} of 16 milestones, best ${Math.max(...ms)}.</div>`);
      // where Pokemon fall
      const deaths = new Map(), ends = new Map();
      for (const h of H) {
        for (const m of h.team || []) if (m.box === 'dead') { const k = (m.died && m.died.before) || 'unknown'; deaths.set(k, (deaths.get(k) || 0) + 1); }
        if (h.result !== 'win' && h.endedAt) ends.set(h.endedAt, (ends.get(h.endedAt) || 0) + 1);
      }
      const top = [...deaths.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
      if (top.length) parts.push(`<div><div class="lbl">Where your Pokémon fall</div>${top.map(([k, n]) => `<div class="small">${k === 'unknown' ? 'Unrecorded' : 'Before ' + esc(k)}: ${n} lost</div>`).join('')}</div>`);
      const topEnds = [...ends.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
      if (topEnds.length) parts.push(`<div><div class="lbl">Runs ended at</div>${topEnds.map(([k, n]) => `<div class="small">${esc(k)}: ${n} run${n > 1 ? 's' : ''}</div>`).join('')}</div>`);
      // starters you used, against the tier list
      const st = new Map();
      for (const h of H) if (h.starter) { const x = st.get(h.starter) || { n: 0, ms: 0, wins: 0 }; x.n++; x.ms += (h.progress || {}).milestones || 0; if (h.result === 'win') x.wins++; st.set(h.starter, x); }
      if (st.size) {
        const tierOf = sid => (TIERS && TIERS.starters ? (TIERS.starters.find(t => t.s === sid) || {}).tier : null);
        parts.push(`<div><div class="lbl">Your starters</div>${[...st.entries()].sort((a, b) => b[1].ms / b[1].n - a[1].ms / a[1].n).map(([sid, x]) =>
          `<div class="slot">${icon(+sid)}<div class="who"><span class="small"><b>${esc(E.sp(+sid) ? E.sp(+sid).n : '?')}</b>${tierOf(+sid) ? ` · tier ${tierOf(+sid)}` : ''}</span><span class="small muted">${x.n} run${x.n > 1 ? 's' : ''}, average ${(x.ms / x.n).toFixed(1)} milestones${x.wins ? `, ${x.wins} won` : ''}</span></div></div>`).join('')}</div>`);
      }
      // who you rely on
      const used = new Map();
      for (const h of H) for (const m of h.team || []) { const k = E.sp(m.s) ? E.sp(m.s).g : m.s; const x = used.get(k) || { s: m.s, n: 0, alive: 0 }; x.n++; if (m.box !== 'dead') x.alive++; used.set(k, x); }
      const favs = [...used.values()].filter(x => x.n > 1).sort((a, b) => b.n - a.n).slice(0, 6);
      if (favs.length) parts.push(`<div><div class="lbl">Pokémon you keep using</div><div class="team-icons">${favs.map(x => `<span class="t">${icon(x.s)}<span>${x.n} runs, ${Math.round(100 * x.alive / x.n)}% lived</span></span>`).join('')}</div></div>`);
      const caught = H.reduce((a, h) => a + ((h.enc || {}).caught || 0), 0), missed = H.reduce((a, h) => a + ((h.enc || {}).missed || 0), 0);
      if (caught + missed) parts.push(`<div class="small">Encounters: ${caught} caught, ${missed} missed (${Math.round(100 * caught / (caught + missed))}% caught).</div>`);
    }
    if (AC && AC.n) {
      parts.push(`<div><div class="lbl">AI check (all your live battles)</div><div class="small">The boss did what the ported AI predicted ${AC.ok} of ${AC.n} times (${Math.round(100 * AC.ok / AC.n)}%).</div>
        ${(AC.misses || []).slice(-3).reverse().map(c => `<div class="small muted">${esc(c.boss)}: ${esc(c.mon)} used ${esc(c.actual)}, predicted ${esc(c.predicted)}</div>`).join('')}
        ${AC.n >= 10 ? '<div class="note">If you send me the misses, I can check them against the engine and tighten the AI.</div>' : ''}</div>`);
    }
    return `<section class="section"><div class="head"><h2>Insights</h2></div><div class="card" style="gap:10px">${parts.join('')}</div></section>`;
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
      ${S.roster.length ? teamIcons(S.roster) : '<p class="small muted" style="margin:0">No Pokémon yet. Pick a starter below, or add one under Pokémon.</p>'}
      <div class="row"><button class="btn primary" id="run-end" ${S.example || (!S.roster.length && !S.run.beaten.length) ? 'disabled' : ''}>End this run…</button><button class="btn" data-go="run">Back to the run</button>
        <span class="note">Saves it to your history, then clears your party, boxes, encounters, beaten bosses and TMs for a fresh start. Your settings stay.</span></div></div></section>`;
    html += insightsHTML();
    html += `<section class="section"><div class="head"><h2>Starter tier list</h2></div>${tierListHTML(false)}</section>`;
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
    wireTiers();
    main.querySelectorAll('[data-delhist]').forEach(b => b.onclick = () => {
      if (b.dataset.armed) { const id = b.dataset.delhist; S.history = S.history.filter(h => h.id !== id); renderRuns(); store.deleteHist(id); return; }
      b.dataset.armed = '1'; b.textContent = 'Confirm delete'; b.classList.add('primary');
    });
  }
  function wireTiers() {
    main.querySelectorAll('[data-tier]').forEach(b => b.onclick = () => { S.tierPick = S.tierPick === +b.dataset.tier ? null : +b.dataset.tier; render(); });
    main.querySelectorAll('[data-tiersort]').forEach(b => b.onclick = () => { S.tierSort = b.dataset.tiersort; render(); });
    main.querySelectorAll('[data-choose]').forEach(b => b.onclick = () => {
      const sid = +b.dataset.choose;
      openEditor(null, { s: sid, lv: 5, met: 'Starter', onSave: m => { S.run.starter = sid; if (!S.run.started) S.run.started = Date.now(); S.tierPick = null; store.saveRun(); celebrateCatch(m.s, 'starter'); } });
    });
  }
  /** End the run: how it ended and where, saved to your history; the next run starts fresh. at: the fight it ended at. */
  function openEndRun(preset, at) {
    document.body.style.overflow = 'hidden';
    sheet.hidden = false;
    const close = () => { sheet.hidden = true; sheet.innerHTML = ''; document.body.style.overflow = ''; };
    let result = preset || 'wipe';
    const nb = at || D.bosses[nextBoss()];
    const majors = D.bosses.filter(b => !b.route && (b.ms || b.cat === 'gym' || b.cat === 'e4' || b.cat === 'rival')).filter((b, k, arr) => k === arr.findIndex(x => x.n === b.n && x.cap === b.cap));
    function draw() {
      const r = runSummary();
      const no = S.run.no || S.history.length + 1;
      sheet.innerHTML = `<div class="inner"><div class="row"><h2 class="grow">Start run #${no + 1}</h2><button class="btn ghost" id="er-close">Cancel</button></div>
        <div class="card"><div class="lbl">How did run #${no} end?</div>
          <span class="seg" role="group" aria-label="Result">${Object.entries(RESULT).map(([k, [l]]) => `<button data-res="${k}" aria-pressed="${result === k}">${l}</button>`).join('')}</span>
          <div class="field"><label for="er-at">Where</label><select id="er-at" class="inline">
            <option value="">—</option>
            ${(nb && !majors.some(b => b.n === nb.n && b.cap === nb.cap) ? [nb] : []).concat(majors).map(b => `<option value="${esc(b.n)} (cap ${b.cap})" ${b.n === nb.n && b.cap === nb.cap ? 'selected' : ''}>${esc(b.n)} (${esc(b.cls)}, cap ${b.cap})</option>`).join('')}
            <option value="A route or wild battle">A route or wild battle</option><option value="Somewhere else">Somewhere else</option></select></div>
          <div class="field"><label for="er-notes">Notes (optional)</label><textarea id="er-notes" rows="3" style="padding:8px 10px;border-radius:10px;border:1px solid var(--line);background:var(--surface)" placeholder="What went wrong, what to try next time"></textarea></div>
          <p class="small" style="margin:0">Run #${no} goes into your history: ${r.milestones} milestones, cap ${r.cap}, ${S.roster.length} Pokémon (${r.fainted} fainted), ${r.caught} catches. Run #${no + 1} starts right away with the same rules, at choosing your starter.</p>
          <div class="row"><button class="btn primary" id="er-go">Save run #${no} and start run #${no + 1}</button></div></div></div>`;
      $('#er-close').onclick = close;
      sheet.querySelectorAll('[data-res]').forEach(b => b.onclick = () => { result = b.dataset.res; const n = $('#er-notes').value, at = $('#er-at').value; draw(); $('#er-notes').value = n; $('#er-at').value = at; });
      $('#er-go').onclick = async () => {
        const btn = $('#er-go'); btn.disabled = true; btn.textContent = 'Saving…';
        await endRun(result, $('#er-at').value, $('#er-notes').value.trim());
        S.run.started = Date.now();          // the next run starts now: straight to choosing a starter
        await store.saveRun();
        close(); go('run'); scrollToNow();
        celebrate(`<div class="cele-kicker">Run #${S.run.no} begins!</div><div class="cele-sub">Run #${S.run.no - 1} is in your history. Now choose your starter.</div>`, 2600, 'is-start');
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
    S.run = newRun(no + 1, S.run);
    S.live = null; S.focus = null; S.resultForm = null; S.openStep = null; S.extraArea = null; S.openChapters = new Set(); lastNow = null;
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
    if (!window.calc || !window.createEngine || !window.createSim || !window.createAdvice || !window.createFlow) { main.innerHTML = '<div class="empty">The damage calculator didn’t load. Check your connection and reload.</div>'; return; }
    try {
      const r = await fetch('rrdata.json'); if (!r.ok) throw new Error('HTTP ' + r.status);
      D = await r.json();
    } catch (e) { main.innerHTML = `<div class="empty">The game data didn’t load (${esc(e.message)}). Reload to try again.</div>`; return; }
    E = window.createEngine(window.calc, D);
    SIM = window.createSim(E);
    ADV = window.createAdvice(E, SIM);
    SR = window.createSaveReader ? window.createSaveReader(D) : null;
    FLOW = window.createFlow(D);
    addRouteTrainers();
    loadTiers();
    const sprites = fetch('sprites/index.json').then(r => (r.ok ? r.json() : null)).catch(() => null);
    SPR = await Promise.race([sprites, new Promise(res => setTimeout(() => res(null), 4000))]);
    if (!SPR) sprites.then(v => { if (v) { SPR = v; render(); } });
    render();
    store.init();
  }
  boot();
})();
