"""Every map as the game walks it: the tile grid (metatile, collision, elevation), each tile's behavior from its tileset,
people (object events) with their scripts and the flag that hides them, doors and stairs (warps), triggers (coord
events), signs and hidden items (bg events), map connections and the map's own scripts. FireRed's layouts:

  MapHeader   +0 layout, +4 events, +8 map scripts, +0xC connections, +0x14 region-map section, +0x17 map type
  MapLayout   +0 width, +4 height, +0xC grid (u16: bits 0-9 metatile, 10-11 collision, 12-15 elevation),
              +0x10 primary tileset (metatiles 0-639), +0x14 secondary tileset (640-1023)
  Tileset     +0x14 metatile attributes (u32 each: behavior in bits 0-8, encounter type in bits 24-26: 1 land, 2 water)
  ObjectEvent (24 bytes) +1 graphics, +4 x, +6 y, +8 elevation, +9 movement type, +0xC trainer type, +0xE sight,
              +0x10 script, +0x14 flag that hides it
  Warp (8)    +0 x, +2 y, +4 elevation, +5 destination warp, +6 map number, +7 map group
  CoordEvent (16) +0 x, +2 y, +4 elevation, +6 variable, +8 value (runs while the variable has it), +0xC script
  BgEvent (12) +0 x, +2 y, +4 elevation, +5 kind (0-4 sign scripts, 7 hidden item), +8 script or item data
"""
import os
import struct
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rom import rom, u16, u32, isptr  # noqa: E402
from script_walk import G, header  # noqa: E402

PRIMARY = 640
_attr_cache = {}


def s16(a):
    return struct.unpack_from('<h', rom, a)[0]


def behaviors(tileset_ptr, count):
    key = (tileset_ptr, count)
    if key not in _attr_cache:
        ts = tileset_ptr - G
        attr = u32(ts + 0x14)
        # behavior | encounter type << 16
        _attr_cache[key] = [(u32(attr - G + 4 * i) & 0x1FF) | (((u32(attr - G + 4 * i) >> 24) & 7) << 16) for i in range(count)] if isptr(attr) else [0] * count
    return _attr_cache[key]


def load(group, num):
    h = header(group, num)
    m = {'group': group, 'num': num, 'sec': rom[h + 0x14], 'type': rom[h + 0x17]}
    lay = u32(h) - G
    w, hgt = u32(lay), u32(lay + 4)
    data = u32(lay + 12) - G
    prim, sec = behaviors(u32(lay + 16), PRIMARY), behaviors(u32(lay + 20), 1024 - PRIMARY) if isptr(u32(lay + 20)) else [0] * 384
    grid = []
    for y in range(hgt):
        row = []
        for x in range(w):
            t = u16(data + 2 * (y * w + x))
            mt = t & 0x3FF
            a = prim[mt] if mt < PRIMARY else sec[mt - PRIMARY]
            row.append((mt, (t >> 10) & 3, t >> 12, a & 0x1FF, a >> 16))   # metatile, collision, elevation, behavior, encounter type
        grid.append(row)
    m.update(w=w, h=hgt, grid=grid, attrs=(prim, sec))
    ev = u32(h + 4) - G
    n_obj, n_warp, n_coord, n_bg = rom[ev], rom[ev + 1], rom[ev + 2], rom[ev + 3]
    objs, warps, coords, bgs = u32(ev + 4), u32(ev + 8), u32(ev + 12), u32(ev + 16)
    m['objects'] = []
    if isptr(objs):
        for k in range(min(n_obj, 64)):
            o = objs - G + 24 * k
            m['objects'].append({'id': rom[o], 'gfx': rom[o + 1], 'x': s16(o + 4), 'y': s16(o + 6), 'elev': rom[o + 8], 'move': rom[o + 9],
                                 'trainer': u16(o + 0xC), 'sight': u16(o + 0xE), 'script': u32(o + 0x10), 'flag': u16(o + 0x14)})
    m['warps'] = []
    if isptr(warps):
        for k in range(min(n_warp, 64)):
            o = warps - G + 8 * k
            m['warps'].append({'x': s16(o), 'y': s16(o + 2), 'elev': rom[o + 4], 'to_warp': rom[o + 5], 'to': (rom[o + 7], rom[o + 6])})
    m['coords'] = []
    if isptr(coords):
        for k in range(min(n_coord, 64)):
            o = coords - G + 16 * k
            m['coords'].append({'x': s16(o), 'y': s16(o + 2), 'elev': rom[o + 4], 'var': u16(o + 6), 'value': u16(o + 8), 'script': u32(o + 12)})
    m['bgs'] = []
    if isptr(bgs):
        for k in range(min(n_bg, 64)):
            o = bgs - G + 12 * k
            m['bgs'].append({'x': s16(o), 'y': s16(o + 2), 'elev': rom[o + 4], 'kind': rom[o + 5], 'data': u32(o + 8)})
    con = u32(h + 12)
    m['connections'] = []
    if isptr(con):
        c = con - G
        cnt, arr = u32(c), u32(c + 4)
        if isptr(arr) and cnt < 16:
            for k in range(cnt):
                e = arr - G + 12 * k
                m['connections'].append({'dir': u32(e), 'offset': struct.unpack_from('<i', rom, e + 4)[0], 'to': (rom[e + 8], rom[e + 9])})
    ms = u32(h + 8)
    m['mapscripts'] = []
    if isptr(ms):
        q = ms - G
        for _ in range(16):
            typ = rom[q]
            if typ == 0:
                break
            p = u32(q + 1)
            if isptr(p):
                if typ in (2, 4):   # on frame / on warp into: [var, value, script] until var 0
                    t = p - G
                    for _ in range(32):
                        var = u16(t)
                        if var == 0:
                            break
                        m['mapscripts'].append({'type': typ, 'var': var, 'value': u16(t + 2), 'script': u32(t + 4)})
                        t += 8
                else:
                    m['mapscripts'].append({'type': typ, 'script': p})
            q += 5
    return m
