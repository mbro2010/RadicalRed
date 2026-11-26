/* The battle screen: a small Game Boy-style scene that plays recorded battle events.
 *
 * Your Pokemon stand on the near platform seen from behind, the boss's on the far one, with HP boxes and a text box,
 * as in FireRed. play() takes the simulator's recorded events (each carries who it's about and a snapshot of the
 * field right after it) and animates them: send-outs, the attacker lunging, the target flashing, damage popping up,
 * HP draining, fainting, Mega Evolution, status and stat changes. Every event ends by matching the snapshot, so the
 * screen always shows exactly what the simulator computed. Tap the screen to skip ahead. With reduced motion, nothing
 * moves: text and HP change in place.
 *
 * createStage(host, { sprite(sid) -> { f, b } atlas indexes, sheets: { fc, fr, bc, br }, foe: 'Leader Brock',
 *   terrain: 'grass' | 'cave' | 'water' | 'indoor', doubles })  */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.createStage = factory;
})(typeof self !== 'undefined' ? self : this, function createStage(host, o) {
  'use strict';
  const win = typeof window !== 'undefined' ? window : null;
  const reduce = !!(win && win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const STATUS = { par: 'PAR', brn: 'BRN', psn: 'PSN', tox: 'PSN', slp: 'SLP', frz: 'FRZ' };
  const STAT_NAME = { ATK: 'Attack', DEF: 'Defense', SPA: 'Sp. Atk', SPD: 'Sp. Def', SPE: 'Speed', ACC: 'accuracy', EVA: 'evasiveness' };
  // the game's own lines for status and damage that isn't a hit
  const STATUS_TEXT = { paralyzed: 'is paralyzed! It may be unable to move!', burned: 'was burned!', poisoned: 'was poisoned!',
    'badly poisoned': 'was badly poisoned!', asleep: 'fell asleep!', frozen: 'was frozen solid!' };
  const HURT_TEXT = {
    'hurt itself in confusion': () => 'It hurt itself in its confusion!', recoil: n => `${n} is damaged by the recoil!`,
    crash: n => `${n} kept going and crashed!`, 'Life Orb': n => `${n} lost some of its HP!`, poison: n => `${n} is hurt by poison!`,
    toxic: n => `${n} is hurt by poison!`, burn: n => `${n} is hurt by its burn!`, sandstorm: n => `${n} is buffeted by the sandstorm!`,
    'Stealth Rock': n => `Pointed stones dug into ${n}!`, spikes: n => `${n} is hurt by the spikes!`, 'Leech Seed': n => `${n}’s health is sapped by Leech Seed!`,
    'Rocky Helmet': n => `${n} was hurt by the Rocky Helmet!`, Curse: n => `${n} is afflicted by the curse!`, Substitute: n => `${n} put in a substitute!`,
    'Black Sludge': n => `${n} is hurt by its Black Sludge!`, hail: n => `${n} is buffeted by the hail!`,
  };
  let speed = o.speed || 1, skipping = false, alive = true, pauseGate = null, resumeFn = null;
  const slots = { p: [], a: [] };   // per side and position: { i, s, mon, box } as shown now

  host.innerHTML = `<div class="stage t-${o.terrain || 'grass'}${o.doubles ? ' dbl' : ''}">
    <div class="stcap" hidden></div>
    <div class="scene"><div class="plat far"></div><div class="plat near"></div><div class="balls foe"></div><div class="balls you"></div></div>
    <div class="tbox"><span class="txt" aria-live="polite"></span><span class="more" aria-hidden="true"></span></div></div>`;
  const stage = host.firstElementChild, scene = stage.querySelector('.scene'), txt = stage.querySelector('.txt'), cap = stage.querySelector('.stcap');
  stage.addEventListener('click', () => { if (busy) skip(); });
  let busy = false;

  const sideCls = side => (side === 'p' ? 'you' : 'foe');
  const short = n => String(n || '').replace(/ \(.*\)$/, '');
  function bgPos(x, cols) { return cols > 1 ? `${(100 * x) / (cols - 1)}%` : '0%'; }
  function paint(el, sid, side) {
    const e = o.sprite(sid) || {};
    const S = o.sheets;
    const back = side === 'p' && e.b != null;
    const idx = back ? e.b : e.f;
    if (idx == null) { el.style.backgroundImage = 'none'; return; }
    const cols = back ? S.bc : S.fc, rows = back ? S.br : S.fr;
    el.style.backgroundImage = `url(sprites/${back ? 'back' : 'front'}.png)`;
    el.style.backgroundSize = `${cols * 100}% ${rows * 100}%`;
    el.style.backgroundPosition = `${bgPos(idx % cols, cols)} ${bgPos(Math.floor(idx / cols), rows)}`;
    el.classList.toggle('flip', side === 'p' && !back);   // no back picture: show the front one turned around
  }
  function slot(side, k) {
    let x = slots[side][k];
    if (x) return x;
    const mon = document.createElement('div');
    mon.className = `mon ${sideCls(side)} k${k}`;
    mon.innerHTML = '<i class="spr"></i>';
    const box = document.createElement('div');
    box.className = `box ${sideCls(side)} k${k}`;
    box.innerHTML = `<div class="nmrow"><b class="nm"></b><span class="lv"></span></div><div class="hprow"><span class="stt" hidden></span><span class="hpl">HP</span><span class="bar"><i></i></span></div>${side === 'p' ? '<span class="hpn"></span>' : ''}`;
    scene.appendChild(mon); scene.appendChild(box);
    x = slots[side][k] = { i: null, s: null, mon, box, pct: 100, hp: 0, shown: false };
    return x;
  }
  function setHp(x, ent, animate) {
    const pct = ent.mhp ? Math.max(0, Math.min(100, (100 * ent.hp) / ent.mhp)) : 0;
    const bar = x.box.querySelector('.bar i');
    bar.style.transition = animate && !reduce && !skipping ? `width ${0.55 / speed}s linear, background-color .2s` : 'none';
    bar.style.width = pct + '%';
    bar.className = pct <= 20 ? 'lo' : pct <= 50 ? 'mid' : '';
    const hpn = x.box.querySelector('.hpn');
    if (hpn) {
      const from = x.hp, to = ent.hp, t0 = performance.now(), dur = 550 / speed;
      if (!animate || reduce || skipping || from === to) hpn.textContent = `${to}/${ent.mhp}`;
      else {
        const step = now => {
          const f = Math.min(1, (now - t0) / dur);
          hpn.textContent = `${Math.round(from + (to - from) * f)}/${ent.mhp}`;
          if (f < 1 && alive) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }
    }
    x.pct = pct; x.hp = ent.hp;
    const stt = x.box.querySelector('.stt');
    stt.hidden = !STATUS[ent.st];
    stt.textContent = STATUS[ent.st] || '';
    stt.className = `stt s-${ent.st || 'none'}`;
  }
  function place(side, ent, animate) {
    const x = slot(side, ent.k);
    if (x.i !== ent.i || x.s !== ent.s) {
      paint(x.mon.firstElementChild, ent.s, side);
      x.box.querySelector('.nm').textContent = short(ent.n);
      x.box.querySelector('.lv').textContent = `Lv${ent.lv}`;
      x.i = ent.i; x.s = ent.s;
      x.hp = ent.hp;
    }
    setHp(x, ent, animate);
    const show = !ent.f;
    x.mon.classList.toggle('gone', !show);
    x.box.classList.toggle('gone', !show);
    x.shown = show;
    return x;
  }
  /** Draw the field as a snapshot describes it, without animation (or with HP drains when animate). */
  function show(snap, animate) {
    if (!snap) return;
    for (const side of ['p', 'a']) {
      const ents = snap[side] || [];
      for (const ent of ents) place(side, ent, animate);
      slots[side].forEach((x, k) => { if (x && !ents.some(e => e.k === k)) { x.mon.classList.add('gone'); x.box.classList.add('gone'); x.shown = false; } });
    }
    const balls = (el, list) => { el.innerHTML = (list || []).map(v => `<i class="${v ? '' : 'out'}"></i>`).join(''); };
    balls(scene.querySelector('.balls.you'), snap.pl);
    balls(scene.querySelector('.balls.foe'), snap.al);
  }
  function wait(ms) {
    if (skipping || !alive) return Promise.resolve();
    return new Promise(res => setTimeout(res, (reduce ? Math.min(ms, 350) : ms) / speed)).then(() => pauseGate);
  }
  /** Run a CSS animation class once; then() runs as it ends (fainting hides the sprite before the class goes). */
  function anim(el, name, then) {
    if (!el || reduce || skipping) { if (then && el) then(); return; }
    el.classList.remove(name);
    void el.offsetWidth;   // restart the animation
    el.classList.add(name);
    const end = ev => {
      if (ev.target !== el) return;
      if (then) then();
      el.classList.remove(name);
      el.removeEventListener('animationend', end);
    };
    el.addEventListener('animationend', end);
  }
  async function say(text, hold) {
    if (!alive) return;
    if (skipping || reduce) { txt.textContent = text; return wait(skipping ? 0 : 380); }
    const per = Math.max(8, 20 / speed), n = text.length;
    const budget = Math.min(650 / speed, n * per);
    const t0 = performance.now();
    await new Promise(res => {
      const step = now => {
        if (!alive || skipping) { txt.textContent = text; return res(); }
        const k = Math.min(n, Math.ceil(((now - t0) / budget) * n));
        txt.textContent = text.slice(0, k);
        if (k < n) requestAnimationFrame(step); else res();
      };
      requestAnimationFrame(step);
    });
    return wait(hold == null ? 420 : hold);
  }
  function pop(x, text, cls) {
    if (!x || reduce || skipping) return;
    const p = document.createElement('span');
    p.className = `pop ${cls || ''}`;
    p.textContent = text;
    const r = x.mon.offsetLeft + x.mon.offsetWidth / 2, t = x.mon.offsetTop + x.mon.offsetHeight * 0.25;
    p.style.left = r + 'px'; p.style.top = t + 'px';
    scene.appendChild(p);
    p.addEventListener('animationend', () => p.remove());
  }
  const who = (l, side) => (l.who ? (l.snap[l.who.side] || []).find(e => e.i === l.who.i) : null);
  const foePre = side => (side === 'a' ? 'The foe’s ' : '');
  /** One recorded event, animated. */
  async function sendOut(side, ent) {
    const prev = slots[side][ent.k];
    if (prev && prev.shown && prev.i !== ent.i) { anim(prev.mon, 'recall'); await wait(320); }
    const x = place(side, ent, false);
    anim(x.mon, 'sendout'); anim(x.box, side === 'p' ? 'box-in-you' : 'box-in-foe');
    await say(side === 'a' ? `${o.foe || 'The foe'} sent out ${short(ent.n)}!` : `Go! ${short(ent.n)}!`);
  }
  async function event(l) {
    const ent = who(l);
    const side = l.who ? l.who.side : null;
    if (l.kind === 'switch' && !ent) {
      // the opening: the boss sends out first, then you
      for (const sd of ['a', 'p']) for (const e of (l.snap && l.snap[sd]) || []) {
        const cur = slots[sd][e.k];
        if (!e.f && !(cur && cur.shown && cur.i === e.i)) await sendOut(sd, e);
      }
      show(l.snap, true);
      return;
    }
    if (!ent && l.kind !== 'crit' && l.kind !== '') { if (l.text) await say(l.text.replace(/^(Your|Boss) /, ''), 300); show(l.snap, true); return; }
    const x = ent ? slot(side, ent.k) : null;
    const nm = ent ? short(ent.n) : '';
    switch (l.kind) {
      case 'switch': await sendOut(side, ent); break;
      case 'move': {
        const z = /Z-Move \(Z-(.+?)\)/.exec(l.text);
        const m = z ? 'Z-' + z[1] : ((/ uses (.+)$/.exec(l.text) || [])[1] || 'a move');
        const said = say(`${foePre(side)}${nm} used ${m}!`, 120);
        anim(x.mon, side === 'p' ? 'lunge-you' : 'lunge-foe');
        if (z) anim(x.mon, 'zpower');
        await said; await wait(260);
        break;
      }
      case 'dmg': {
        const before = x.pct;
        anim(x.mon, 'hit');
        place(side, ent, true);
        const lost = Math.round(before - x.pct);
        if (lost > 0) pop(x, `−${lost}%`);
        await wait(640);
        break;
      }
      case 'crit': anim(scene, 'shake'); await say('A critical hit!', 300); break;
      case 'miss': {
        const m = /'s attack misses (.+)$/.exec(l.text);
        await say(`${foePre(side)}${nm}’s attack missed!`, 300);
        if (m) { for (const sd of ['p', 'a']) for (const y of slots[sd]) if (y && y.shown && short(m[1]) === y.box.querySelector('.nm').textContent) anim(y.mon, 'dodge'); }
        break;
      }
      case 'faint':
        anim(x.mon, 'faint', () => x.mon.classList.add('gone')); anim(x.box, 'box-out', () => x.box.classList.add('gone'));
        await say(`${foePre(side)}${nm} fainted!`, 380);
        break;
      case 'hurt': {
        const cause = (/\(([^)]+)\)\s*$/.exec(l.text) || [])[1];
        const before = x.pct;
        anim(x.mon, cause === 'hurt itself in confusion' ? 'hit' : 'hit-soft'); place(side, ent, true);
        const lost = Math.round(before - x.pct);
        if (lost > 0) pop(x, `−${lost}%`, 'soft');
        const said = HURT_TEXT[cause];
        await say(said ? said(foePre(side) + nm) : `${foePre(side)}${nm} is hurt${cause ? ' by ' + cause : ''}!`, 300);
        break;
      }
      case 'cant': {
        // couldn't move: fully paralyzed, asleep, frozen, flinched, recharging
        const k = /paralyzed/.test(l.text) ? 'par' : /asleep/.test(l.text) ? 'slp' : /frozen/.test(l.text) ? 'frz' : '';
        if (k) anim(x.mon, 'st-' + k);
        await say(foePre(side) + l.text, 420);
        break;
      }
      case 'conf': anim(x.mon, 'tint'); await say(foePre(side) + l.text, 320); break;
      case 'cure': await say(foePre(side) + l.text, 320); break;
      case 'heal': {
        const before = x.pct;
        anim(x.mon, 'glow'); place(side, ent, true);
        const got = Math.round(x.pct - before);
        if (got > 0) pop(x, `+${got}%`, 'heal');
        const cause = (/\(([^)]+)\)\s*$/.exec(l.text) || [])[1];
        await say(/Phoenix Down/.test(l.text) ? `${nm} rose again with Phoenix Down!` : `${foePre(side)}${nm} restored HP${cause ? ' (' + cause + ')' : ''}.`, 300);
        break;
      }
      case 'status': {
        const what = (/ is ([a-z ]+?)(?: \(|$)/.exec(l.text) || [])[1] || 'affected';
        anim(x.mon, 'st-' + (ent.st || 'par'));
        await say(`${foePre(side)}${nm} ${STATUS_TEXT[what] || 'is ' + what + '!'}`, 320);
        break;
      }
      case 'boost': {
        const parts = l.text.split(': ').slice(1).join(': ').split(', ').map(s => /([A-Z]+) ([+-]\d)/.exec(s)).filter(Boolean);
        for (const [, stat, v] of parts) {
          const n = +v;
          anim(x.mon, n > 0 ? 'up' : 'down');
          const how = n >= 3 ? 'rose drastically' : n === 2 ? 'sharply rose' : n > 0 ? 'rose' : n <= -3 ? 'severely fell' : n === -2 ? 'harshly fell' : 'fell';
          await say(`${foePre(side)}${nm}’s ${STAT_NAME[stat] || stat} ${how}!`, 260);
        }
        break;
      }
      case 'mega': {
        anim(x.mon, 'mega');
        await wait(380);
        place(side, ent, false);
        const into = (/ into (.+)!$/.exec(l.text) || [])[1];
        await say(`${foePre(side)}${short(l.text.split(' Mega Evolves')[0])} Mega Evolved${into ? ' into ' + into : ''}!`, 420);
        break;
      }
      default:
        if (l.text) await say(l.text.replace(/^(Your|Boss) /, ''), 300);
    }
    show(l.snap, true);
  }
  /** Play recorded events in order; resolves when done (or skipped). */
  async function play(lines) {
    busy = true; stage.classList.add('busy');
    for (const l of lines || []) {
      if (!alive) break;
      if (skipping) { show(l.snap, false); continue; }
      await event(l);
    }
    skipping = false; busy = false; stage.classList.remove('busy');
  }
  /** Opening: the field slides in and the trainer challenges you. */
  async function intro() {
    anim(scene, 'open');
    await say(`${o.foe || 'The trainer'} wants to battle!`, 520);
  }
  function skip() { if (busy) skipping = true; }
  function pause() { if (!pauseGate) pauseGate = new Promise(res => { resumeFn = res; }); }
  function resume() { if (resumeFn) { const r = resumeFn; pauseGate = null; resumeFn = null; r(); } }
  function caption(text) { cap.hidden = !text; cap.textContent = text || ''; if (text) anim(cap, 'cap-in'); }
  function destroy() { alive = false; resume(); host.innerHTML = ''; }
  function text(t) { txt.textContent = t || ''; }
  const escHTML = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  /** Your turn as the game shows it: the move menu, and the cursor walking onto the chosen move.
   *  moves: [{ n: name, c: type color }], pick: index of the move used. */
  async function menu(moves, pick) {
    if (!alive || skipping || !moves || !moves.length || pick < 0 || pick >= moves.length) return;
    const box = stage.querySelector('.tbox');
    const m = document.createElement('div');
    m.className = 'fightmenu';
    m.setAttribute('aria-hidden', 'true');
    m.innerHTML = moves.map((mv, k) => `<span class="fm${k === 0 ? ' on' : ''}" style="--t:${escHTML(mv.c)}">${escHTML(mv.n)}</span>`).join('');
    box.appendChild(m);
    const items = [...m.children];
    const route = reduce ? [pick] : pick === 0 ? [0] : pick === 1 ? [0, 1] : pick === 2 ? [0, 2] : [0, 1, 3];
    for (let s = 0; s < route.length; s++) {
      items.forEach((el, k) => el.classList.toggle('on', k === route[s]));
      await wait(s === 0 ? 300 : 210);
    }
    items[pick].classList.add('chosen');
    await wait(300);
    m.remove();
  }
  return { show, play, intro, say, text, menu, skip, pause, resume, caption, destroy, wait,
    setSpeed(v) { speed = v; stage.style.setProperty('--spd', v); }, get busy() { return busy; }, get alive() { return alive; } };
});
