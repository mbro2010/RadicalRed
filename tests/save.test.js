const { SR, D, test, assert, sid, mid } = require('./lib');
// builds a 128 KB FireRed-layout save (both slots, rotated sectors) with CFRU-style and vanilla-encrypted Pokemon
function makeSave() {
  const buf = new Uint8Array(0x20000 + 16);
  const w16 = (o, v) => { buf[o] = v & 255; buf[o + 1] = v >> 8 & 255; };
  const w32 = (o, v) => { w16(o, v & 0xFFFF); w16(o + 2, v >>> 16); };
  const ORDERS = ['GAEM', 'GAME', 'GEAM', 'GEMA', 'GMAE', 'GMEA', 'AGEM', 'AGME', 'AEGM', 'AEMG', 'AMGE', 'AMEG', 'EGAM', 'EGMA', 'EAGM', 'EAMG', 'EMGA', 'EMAG', 'MGAE', 'MGEA', 'MAGE', 'MAEG', 'MEGA', 'MEAG'];
  function putMon(base, o, m, encrypted, inParty) {
    w32(base + o, m.pid); w32(base + o + 4, m.otid);
    const sub = new Uint8Array(48), order = encrypted ? ORDERS[m.pid % 24] : 'GAEM', at = k => 12 * order.indexOf(k);
    const s16 = (o2, v) => { sub[o2] = v & 255; sub[o2 + 1] = v >> 8; };
    s16(at('G'), m.s); s16(at('G') + 4, m.exp & 0xFFFF); s16(at('G') + 6, m.exp >>> 16);
    m.mv.forEach((id, k) => s16(at('A') + 2 * k, id));
    const ivw = (31 | 31 << 5 | 31 << 10 | 31 << 15 | 31 << 20 | 31 << 25 | (m.hidden ? 1 << 31 : 0)) >>> 0;
    s16(at('M') + 4, ivw & 0xFFFF); s16(at('M') + 6, ivw >>> 16);
    const key = encrypted ? (m.pid ^ m.otid) >>> 0 : 0;
    for (let i = 0; i < 48; i += 4) w32(base + o + 32 + i, ((sub[i] | sub[i + 1] << 8 | sub[i + 2] << 16 | sub[i + 3] << 24) ^ key) >>> 0);
    if (inParty) { buf[base + o + 84] = m.lv; w16(base + o + 86, 40); w16(base + o + 88, 50); }
  }
  for (const [slotBase, counter] of [[0, 5], [0xE000, 6]]) for (let k = 0; k < 14; k++) {
    const id = (k + 3) % 14, so = slotBase + k * 0x1000;
    w16(so + 0xFF4, id); w32(so + 0xFF8, 0x08012025); w32(so + 0xFFC, counter);
    if (counter !== 6) continue;
    if (id === 1) {
      buf[so + 0x34] = 2;
      putMon(so, 0x38, { pid: 0x12345679, otid: 0xABCDEF01, s: sid('Charmeleon'), exp: 4000, mv: [mid('Ember'), mid('Scratch')], lv: 21 }, false, true);
      putMon(so, 0x38 + 100, { pid: 0x0BADBEE4, otid: 1, s: sid('Pidgeotto'), exp: 4000, mv: [mid('Gust')], lv: 20, hidden: true }, true, true);
    }
    if (id === 2) buf[so + 0xFE4 - 0xF80] = 0b101;
    if (id === 5) putMon(so, 4, { pid: 7, otid: 9, s: sid('Geodude'), exp: 1000, mv: [mid('Tackle')] }, false, false);
  }
  return buf.buffer;
}
test('save: reads party, boxes and badges from the newest slot', () => {
  const r = SR.read(makeSave());
  assert(r.counter === 6, 'newest slot');
  assert(r.party.length === 2 && r.party[0].lv === 21 && r.party[1].lv === 20, 'party');
  assert(D.species.find(s => s.i === r.party[1].s).a[2] === r.party[1].ab, 'hidden ability from bit 31');
  assert(r.boxes.length === 1 && r.boxes[0].lv === 12, 'box Pokemon level from experience');
  assert(r.badges.join() === '0,2', 'badges');
});
