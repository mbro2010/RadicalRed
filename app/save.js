/* Read a Radical Red save file (.sav from My Boy! or any GBA emulator): party, PC boxes and badges.
 *
 * Layout, from the FireRed save format and the engine source:
 *   - 128 KB of flash, two save slots of 14 sectors (4 KB each); each sector ends with a footer:
 *     section id (u16) at 0xFF4, checksum (u16) at 0xFF6, signature 0x08012025 at 0xFF8, save counter at 0xFFC.
 *     The slot with the higher counter is the latest save.
 *   - Section 1 starts SaveBlock1: party count at 0x34, six 100-byte Pokemon from 0x38; flags from 0xEE0
 *     (badges are flags 0x820-0x827). Sections 5-13 hold the PC (current box byte, then 14 boxes x 30 x 80 bytes).
 *   - Radical Red's engine (CFRU) stores Pokemon unencrypted in a fixed order: growth (species, item, exp,
 *     PP bonuses, friendship, ball), attacks (4 moves, 4 PP), EVs, misc (IVs in one word; bit 30 egg, bit 31
 *     hidden ability). The vanilla encrypted, shuffled layout is also tried, and whichever reads as a real
 *     Pokemon is used.
 * Nature is the personality value mod 25; the ability is the hidden one if bit 31 is set, otherwise slot 1 or 2
 * by the personality's lowest bit. Box Pokemon store experience, not level, so their level comes from the
 * species' growth rate. The bag is read from FireRed's pocket layout and only used if it reads as real items.
 * This is a beta: check the preview before importing. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.createSaveReader = factory;
})(typeof self !== 'undefined' ? self : this, function createSaveReader(D) {
  'use strict';
  const SECTOR = 0x1000, SIG = 0x08012025, SLOT = 14 * SECTOR;
  const species = new Map(D.species.map(s => [s.i, s]));
  const moves = new Set(D.moves.map(m => m.i));
  const ORDERS = ['GAEM', 'GAME', 'GEAM', 'GEMA', 'GMAE', 'GMEA', 'AGEM', 'AGME', 'AEGM', 'AEMG', 'AMGE', 'AMEG',
    'EGAM', 'EGMA', 'EAGM', 'EAMG', 'EMGA', 'EMAG', 'MGAE', 'MGEA', 'MAGE', 'MAEG', 'MEGA', 'MEAG'];
  // Gen 3 characters (enough for nicknames)
  const CHARS = {};
  '0123456789'.split('').forEach((c, i) => { CHARS[0xA1 + i] = c; });
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach((c, i) => { CHARS[0xBB + i] = c; });
  'abcdefghijklmnopqrstuvwxyz'.split('').forEach((c, i) => { CHARS[0xD5 + i] = c; });
  Object.assign(CHARS, { 0x00: ' ', 0xAB: '!', 0xAC: '?', 0xAD: '.', 0xAE: '-', 0xB0: '…', 0xB1: '“', 0xB2: '”', 0xB3: '‘', 0xB4: '’', 0xB5: '♂', 0xB6: '♀', 0xB8: ',', 0xBA: '/', 0xF0: ':' });
  const text = (b, o, n) => { let s = ''; for (let i = 0; i < n && b[o + i] !== 0xFF; i++) s += CHARS[b[o + i]] || ''; return s.trim(); };

  // experience needed for each level, by growth rate (0 medium fast, 1 erratic, 2 fluctuating, 3 medium slow, 4 fast, 5 slow)
  function expFor(rate, n) {
    if (n <= 1) return 0;
    const c = n * n * n;
    switch (rate) {
      case 1: return n <= 50 ? Math.floor(c * (100 - n) / 50) : n <= 68 ? Math.floor(c * (150 - n) / 100) : n <= 98 ? Math.floor(c * Math.floor((1911 - 10 * n) / 3) / 500) : Math.floor(c * (160 - n) / 100);
      case 2: return n <= 15 ? Math.floor(c * (Math.floor((n + 1) / 3) + 24) / 50) : n <= 36 ? Math.floor(c * (n + 14) / 50) : Math.floor(c * (Math.floor(n / 2) + 32) / 50);
      case 3: return Math.floor(6 * c / 5) - 15 * n * n + 100 * n - 140;
      case 4: return Math.floor(4 * c / 5);
      case 5: return Math.floor(5 * c / 4);
      default: return c;
    }
  }
  function levelFromExp(rate, exp) { let n = 1; while (n < 100 && exp >= expFor(rate, n + 1)) n++; return n; }

  function u16(b, o) { return b[o] | b[o + 1] << 8; }
  function u32(b, o) { return (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) >>> 0; }

  /** Decode one Pokemon (100 bytes in the party, 80 in a box). */
  function readMon(b, o, inParty) {
    const pid = u32(b, o), otid = u32(b, o + 4);
    if (!pid && !otid) return null;
    const tryLayout = (order, key) => {
      const sub = {};
      const raw = new Uint8Array(48);
      for (let i = 0; i < 48; i += 4) {
        const v = (u32(b, o + 32 + i) ^ key) >>> 0;
        raw[i] = v & 255; raw[i + 1] = v >>> 8 & 255; raw[i + 2] = v >>> 16 & 255; raw[i + 3] = v >>> 24 & 255;
      }
      for (let k = 0; k < 4; k++) sub[order[k]] = 12 * k;
      const G = sub.G, A = sub.A, Ev = sub.E, M = sub.M;
      const s = u16(raw, G), item = u16(raw, G + 2), exp = u32(raw, G + 4);
      const mv = [0, 1, 2, 3].map(k => u16(raw, A + 2 * k)).filter(Boolean);
      const ivw = u32(raw, M + 4);
      const iv = [ivw & 31, ivw >>> 5 & 31, ivw >>> 10 & 31, ivw >>> 20 & 31, ivw >>> 25 & 31, ivw >>> 15 & 31];   // hp atk def spa spd spe
      const ev = [raw[Ev], raw[Ev + 1], raw[Ev + 2], raw[Ev + 4], raw[Ev + 5], raw[Ev + 3]];
      const ok = species.has(s) && mv.length > 0 && mv.every(m => moves.has(m)) && exp < 2000000;
      return ok ? { s, item, exp, mv, iv, ev, egg: !!(ivw >>> 30 & 1), hidden: !!(ivw >>> 31 & 1) } : null;
    };
    const r = tryLayout('GAEM', 0) || tryLayout(ORDERS[pid % 24], (pid ^ otid) >>> 0);
    if (!r || r.egg) return null;
    const sp = species.get(r.s);
    const lv = inParty && b[o + 84] >= 1 && b[o + 84] <= 100 ? b[o + 84] : levelFromExp(sp.gr || 0, r.exp);
    const ab = r.hidden && sp.a[2] ? sp.a[2] : (pid & 1) && sp.a[1] ? sp.a[1] : sp.a[0];
    const out = {
      s: r.s, lv, nat: pid % 25, ab, it: r.item && D.items[r.item] ? r.item : null, mv: r.mv, iv: r.iv, ev: r.ev,
      nick: text(b, o + 8, 10), pid,
    };
    if (inParty) { out.hp = u16(b, o + 86); out.maxHp = u16(b, o + 88); }
    if (out.nick && out.nick.toUpperCase() === (sp.g || sp.n).toUpperCase()) out.nick = '';
    return out;
  }

  function read(buffer) {
    const b = new Uint8Array(buffer);
    if (b.length < 0x20000) throw new Error('This file is too small to be a GBA save (expected 128 KB).');
    const notes = [];
    // pick the newest valid slot
    const slots = [0, SLOT].map(base => {
      const sections = {};
      let counter = -1, valid = 0;
      for (let k = 0; k < 14; k++) {
        const so = base + k * SECTOR;
        if (u32(b, so + 0xFF8) !== SIG) continue;
        const id = u16(b, so + 0xFF4);
        if (id > 13) continue;
        sections[id] = so; counter = Math.max(counter, u32(b, so + 0xFFC)); valid++;
      }
      return { base, sections, counter, valid };
    }).filter(sl => sl.valid >= 5 && sl.sections[1] != null);
    if (!slots.length) throw new Error('No saved game found in this file. Save in-game first, then export the .sav again.');
    slots.sort((x, y) => y.counter - x.counter);
    const sl = slots[0];
    // SaveBlock1: sections 1-4 back to back
    const sb1 = new Uint8Array(4 * 0xF80);
    for (let k = 1; k <= 4; k++) if (sl.sections[k] != null) sb1.set(b.subarray(sl.sections[k], sl.sections[k] + 0xF80), (k - 1) * 0xF80);
    const count = Math.min(6, sb1[0x34]);
    const party = [];
    for (let i = 0; i < count; i++) { const m = readMon(sb1, 0x38 + 100 * i, true); if (m) party.push(m); }
    if (party.length < count) notes.push(`${count - party.length} party slot${count - party.length > 1 ? 's' : ''} couldn't be read (an egg or an unknown format).`);
    const flags = 0xEE0;
    const badges = [];
    for (let k = 0; k < 8; k++) { const f = 0x820 + k; if (sb1[flags + (f >> 3)] >> (f & 7) & 1) badges.push(k); }
    // PC: sections 5-13 back to back
    const pc = new Uint8Array(9 * 0xF80);
    let havePC = true;
    for (let k = 5; k <= 13; k++) { if (sl.sections[k] == null) { havePC = false; continue; } pc.set(b.subarray(sl.sections[k], sl.sections[k] + 0xF80), (k - 5) * 0xF80); }
    const boxes = [];
    if (havePC) {
      for (let bx = 0; bx < 14; bx++) for (let j = 0; j < 30; j++) {
        const o = 4 + (bx * 30 + j) * 80;
        if (o + 80 > pc.length) break;
        const m = readMon(pc, o, false);
        if (m) boxes.push(Object.assign(m, { box: bx + 1 }));
      }
    } else notes.push('The PC boxes are missing from this save, so only the party was read.');
    // bag (beta): FireRed's pockets in SaveBlock1 (items 0x310, TM case 0x464, berries 0x54C), quantities XOR'd with the
    // security key in SaveBlock2 at 0xF20. Only used when the slots read as real items.
    let bag = null;
    if (sl.sections[0] != null) {
      const key = u32(b, sl.sections[0] + 0xF20) & 0xFFFF;
      const pocket = (off, n) => { const out = []; for (let k = 0; k < n; k++) { const id = u16(sb1, off + 4 * k), q = (u16(sb1, off + 4 * k + 2) ^ key) & 0xFFFF; if (id) out.push([id, q]); } return out; };
      const all = pocket(0x310, 42).concat(pocket(0x464, 58), pocket(0x54C, 43));
      const valid = all.filter(([id, q]) => D.items[id] && q > 0 && q <= 999);
      if (all.length && valid.length / all.length >= 0.8) bag = valid.map(([id, q]) => ({ id, q }));
      else if (all.length) notes.push("Your bag couldn't be read from this save (Radical Red may keep it somewhere else), so items and TMs aren't imported.");
    }
    return { counter: sl.counter, party, boxes, badges, bag, notes };
  }

  return { read, levelFromExp, expFor };
});
