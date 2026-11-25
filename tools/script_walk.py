"""FireRed script commands, shared by the tools that read map scripts.

L gives the number of bytes after each opcode (pokefirered asm/macros/event.inc); opcodes not in it stop a walk.
trainerbattle (0x5C) has a length that depends on its type: BATTLE_LEN. entry_points() lists every script a map can
run: its people (object events), triggers (coord events), signs, and the map's own scripts (on load, on transition,
on resume, and the on-frame and on-warp tables keyed by a variable's value).
"""
from rom import u8, u16, u32, isptr

G = 0x08000000
# bytes after the opcode, FireRed script commands (pokefirered asm/macros/event.inc); None = variable/stop
L = {0x00: 0, 0x01: 0, 0x02: 0, 0x03: 0, 0x04: 4, 0x05: 4, 0x06: 5, 0x07: 5, 0x08: 1, 0x09: 1, 0x0A: 2, 0x0B: 2, 0x0C: 0, 0x0D: 0, 0x0E: 1,
     0x0F: 5, 0x10: 2, 0x11: 5, 0x12: 5, 0x13: 5, 0x14: 2, 0x15: 8, 0x16: 4, 0x17: 4, 0x18: 4, 0x19: 4, 0x1A: 4, 0x1B: 2, 0x1C: 2, 0x1D: 5,
     0x1E: 5, 0x1F: 5, 0x20: 8, 0x21: 4, 0x22: 4, 0x23: 4, 0x24: 4, 0x25: 2, 0x26: 4, 0x27: 0, 0x28: 2, 0x29: 2, 0x2A: 2, 0x2B: 2, 0x2C: 4,
     0x2D: 0, 0x2E: 0, 0x2F: 2, 0x30: 0, 0x31: 2, 0x32: 0, 0x33: 3, 0x34: 2, 0x35: 0, 0x36: 2, 0x37: 1, 0x38: 1, 0x39: 7, 0x3A: 7, 0x3B: 7,
     0x3C: 2, 0x3D: 7, 0x3E: 7, 0x3F: 7, 0x40: 7, 0x41: 7, 0x42: 4, 0x43: 0, 0x44: 4, 0x45: 4, 0x46: 4, 0x47: 4, 0x48: 2, 0x49: 4, 0x4A: 4,
     0x4B: 2, 0x4C: 2, 0x4D: 2, 0x4E: 2, 0x4F: 6, 0x50: 8, 0x51: 2, 0x52: 4, 0x53: 2, 0x54: 4, 0x55: 2, 0x56: 4, 0x57: 6, 0x58: 4, 0x59: 4,
     0x5A: 0, 0x5B: 3, 0x5D: 0, 0x5E: 0, 0x5F: 0, 0x60: 2, 0x61: 2, 0x62: 2, 0x63: 6, 0x64: 2, 0x65: 3, 0x66: 0, 0x67: 4, 0x68: 0, 0x69: 0,
     0x6A: 0, 0x6B: 0, 0x6C: 0, 0x6D: 0, 0x6E: 2, 0x6F: 4, 0x70: 5, 0x71: 5, 0x72: 0, 0x73: 4, 0x74: 4, 0x75: 4, 0x76: 0, 0x77: 1, 0x78: 4,
     0x79: 14, 0x7A: 2, 0x7B: 4, 0x7C: 2, 0x7D: 3, 0x7E: 1, 0x7F: 3, 0x80: 3, 0x81: 3, 0x82: 3, 0x83: 3, 0x84: 3, 0x85: 5, 0x86: 4, 0x87: 4,
     0x88: 4, 0x89: 2, 0x8A: 3, 0x8F: 2, 0x90: 5, 0x91: 5, 0x92: 5, 0x93: 3, 0x94: 0, 0x95: 3, 0x96: 2, 0x97: 1, 0x98: 2, 0x99: 2, 0x9A: 1,
     0x9B: 4, 0x9C: 2, 0x9D: 3, 0x9E: 2, 0x9F: 2, 0xA0: 0, 0xA1: 4, 0xA2: 8, 0xA3: 0, 0xA4: 2, 0xA5: 0, 0xA6: 1, 0xA7: 2, 0xA8: 4, 0xA9: 3,
     0xAA: 9, 0xAB: 2, 0xAC: 4, 0xAD: 4, 0xAE: 0, 0xAF: 4, 0xB0: 4, 0xB1: 8, 0xB2: 0, 0xB3: 2, 0xB4: 2, 0xB5: 2, 0xB6: 5, 0xB7: 0, 0xC0: 2,
     0xC1: 2, 0xC2: 2, 0xC3: 1, 0xC4: 7, 0xC5: 0, 0xC6: 3, 0xC7: 1, 0xC8: 4, 0xC9: 0, 0xCA: 0, 0xCB: 0, 0xCC: 5, 0xCD: 2, 0xCE: 2, 0xD0: 2,
     0xD1: 7, 0xD2: 3}
BATTLE_LEN = {0: 12, 1: 16, 2: 16, 3: 8, 4: 16, 5: 12, 6: 20, 7: 16, 8: 20, 9: 8}
# where the script that runs after the win sits in a trainerbattle, by type
BATTLE_CONT = {1: 14, 2: 14, 6: 18, 8: 18}


MAP_GROUPS = u32(0x5524C) - G


def header(g, n):
    """file offset of map n of group g's header"""
    return u32(u32(MAP_GROUPS + 4 * g) - G + 4 * n) - G


def entry_points(h):
    """(kind, script pointer) for everything a map can run"""
    out = []
    ev = u32(h + 4) - G
    n_obj, n_coord, n_bg = u8(ev), u8(ev + 2), u8(ev + 3)
    objs, coords, bgs = u32(ev + 4), u32(ev + 12), u32(ev + 16)
    if isptr(objs):
        for k in range(min(n_obj, 64)):
            sp = u32(objs - G + 24 * k + 16)
            if isptr(sp):
                out.append(('person', sp))
    if isptr(coords):
        for k in range(min(n_coord, 64)):
            sp = u32(coords - G + 16 * k + 12)
            if isptr(sp):
                out.append(('trigger', sp))
    if isptr(bgs):
        for k in range(min(n_bg, 64)):
            b = bgs - G + 12 * k
            if u8(b + 5) < 5 and isptr(u32(b + 8)):
                out.append(('sign', u32(b + 8)))
    ms = u32(h + 8)
    if isptr(ms):
        q = ms - G
        for _ in range(16):
            typ = u8(q)
            if typ == 0:
                break
            p = u32(q + 1)
            if isptr(p):
                if typ in (2, 4):                       # on frame / on warp into: [var, value, script] until var 0
                    r = p - G
                    for _ in range(32):
                        if u16(r) == 0:
                            break
                        if isptr(u32(r + 4)):
                            out.append(('map', u32(r + 4)))
                        r += 8
                else:
                    out.append(('map', p))
            q += 5
    return out
