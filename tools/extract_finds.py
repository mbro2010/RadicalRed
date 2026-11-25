"""Find what each area gives you: gift Pokemon (givemon), static encounters (setwildbattle), eggs, item balls,
hidden items, items handed over by people, and what each shop sells. Scans every map's object, trigger and sign
scripts (following goto and call), using FireRed's script command lengths.

Item finds use the game's own pattern: setorcopyvar 0x8000 (item), setorcopyvar 0x8001 (quantity), then
callstd 1 (find an item, e.g. an item ball) or callstd 0 (someone gives it to you). Hidden items are sign events of
kind 7 whose data holds the item (bits 0-15) and quantity (bits 24-30).

usage: python3 tools/extract_finds.py data
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rom import rom, u8, u16, u32, dec, isptr  # noqa: E402

OUT = sys.argv[1] if len(sys.argv) > 1 else 'data'
G = 0x08000000

from script_walk import L, BATTLE_LEN  # noqa: E402  (FireRed script command lengths)

species = {s['id']: s['name'] for s in json.load(open(os.path.join(OUT, 'species.json')))}
items = json.load(open(os.path.join(OUT, 'items.json')))
maps = json.load(open(os.path.join(OUT, 'maps.json')))
MAP_GROUPS = u32(0x5524C) - G


def header(g, n):
    return u32(u32(MAP_GROUPS + 4 * g) - G + 4 * n) - G


def walk(start, found, depth=0, seen=None, vars_=None):
    """Follow a script, collecting gifts, statics, eggs, item finds and shops."""
    seen = seen if seen is not None else set()
    vars_ = vars_ if vars_ is not None else {}
    o = start
    for _ in range(200):
        if o in seen or not (0 <= o < len(rom) - 16):
            return
        seen.add(o)
        op = rom[o]
        val = lambda v: vars_.get(v, None) if 0x4000 <= v < 0x8100 else v
        if op == 0x5C:                                  # trainerbattle: follow the script that runs after the win (gym TMs)
            cont = {1: 14, 2: 14, 6: 18, 8: 18}.get(rom[o + 1])
            if cont and depth < 6 and isptr(u32(o + cont)):
                walk(u32(o + cont) - G, found, depth + 1, seen, dict(vars_))
            o += 2 + BATTLE_LEN.get(rom[o + 1], 12)
            continue
        if op not in L:
            return
        if op in (0x16, 0x1A):                          # setvar / setorcopyvar
            vars_[u16(o + 1)] = u16(o + 3)
        elif op == 0x09 and rom[o + 1] in (0, 1):       # callstd: obtain (0) or find (1) the item in 0x8000
            it, qty = vars_.get(0x8000), vars_.get(0x8001, 1)
            if it and str(it) in items:
                found.append({'kind': 'item', 'item': it, 'qty': qty if qty and qty < 100 else 1, 'how': 'found' if rom[o + 1] == 1 else 'given'})
        elif op == 0x44:                                # additem
            it = val(u16(o + 1))
            if it and str(it) in items:
                found.append({'kind': 'item', 'item': it, 'qty': max(1, min(99, val(u16(o + 3)) or 1)), 'how': 'given'})
        elif op == 0x79:                                # givemon species, level, item
            s, lv = val(u16(o + 1)), rom[o + 3]
            if s in species and 0 < lv <= 100:
                found.append({'kind': 'gift', 's': s, 'lv': lv, 'item': val(u16(o + 4)) or None})
        elif op == 0x7A:                                # giveegg
            s = val(u16(o + 1))
            if s in species:
                found.append({'kind': 'egg', 's': s})
        elif op == 0xB6:                                # setwildbattle species, level, item
            s, lv = val(u16(o + 1)), rom[o + 3]
            if s in species and 0 < lv <= 100:
                found.append({'kind': 'static', 's': s, 'lv': lv, 'item': val(u16(o + 4)) or None})
        elif op == 0x86:                                # pokemart <item list>
            p = u32(o + 1)
            if isptr(p):
                lst, q = [], p - G
                while u16(q) and len(lst) < 64:
                    lst.append(u16(q)); q += 2
                found.append({'kind': 'shop', 'items': [i for i in lst if str(i) in items]})
        if op in (0x04, 0x05) and depth < 6 and isptr(u32(o + 1)):
            walk(u32(o + 1) - G, found, depth + 1, seen, dict(vars_))
            if op == 0x05:
                return
        if op in (0x06, 0x07) and depth < 6 and isptr(u32(o + 2)):
            walk(u32(o + 2) - G, found, depth + 1, seen, dict(vars_))
        if op in (0x02, 0x03, 0x08):
            return
        o += 1 + L[op]


raw = []   # (area, origin script, finding)
for mp in maps:
    name = mp['name']
    if not name:
        continue
    h = header(mp['group'], mp['num'])
    ev = u32(h + 4) - G
    found = []
    n_obj, n_coord, n_bg = u8(ev), u8(ev + 2), u8(ev + 3)
    objs, coords, bgs = u32(ev + 4), u32(ev + 12), u32(ev + 16)
    def scan(script):
        before = len(found)
        walk(script - G, found)
        for f in found[before:]:
            f['origin'] = script
    if isptr(objs):
        for k in range(min(n_obj, 64)):
            sp = u32(objs - G + 24 * k + 16)
            if isptr(sp):
                scan(sp)
    if isptr(coords):
        for k in range(min(n_coord, 64)):
            sp = u32(coords - G + 16 * k + 12)
            if isptr(sp):
                scan(sp)
    if isptr(bgs):
        for k in range(min(n_bg, 64)):
            b = bgs - G + 12 * k
            kind, data = u8(b + 5), u32(b + 8)
            if kind == 7:                               # hidden item
                it, qty = data & 0xFFFF, (data >> 24) & 0x7F
                if str(it) in items:
                    found.append({'kind': 'item', 'item': it, 'qty': qty or 1, 'how': 'hidden', 'origin': b})
            elif kind < 5 and isptr(data):
                scan(data)
    for f in found:
        raw.append((name, f))

vendor_area = {}
for name, f in raw:
    if f['kind'] == 'item' and f['how'] == 'given':
        vendor_area.setdefault(f['origin'], (name, []))[1].append(f['item'])
# scripts reused in many areas (Pokemon Center and post-game services, the shared Poke Mart) aren't places to find things
origin_areas = {}
for name, f in raw:
    origin_areas.setdefault(f['origin'], set()).add(name)
SHARED = 3
# one script handing out many different items is a vendor or exchange, not a set of pickups
vendor = {}
for name, f in raw:
    if f['kind'] == 'item' and f['how'] == 'given':
        vendor.setdefault(f['origin'], set()).add(f['item'])
VENDORS = {o for o, its in vendor.items() if len(its) >= 6}
for name, f in list(raw):
    if f['origin'] in VENDORS and f['kind'] == 'item' and f['how'] == 'given':
        raw.remove((name, f))
areas, mart = {}, set()
for name, f in raw:
    if len(origin_areas[f['origin']]) >= SHARED:
        if f['kind'] == 'shop':
            mart.update(f['items'])
        continue
    if True:
        a = areas.setdefault(name, {'items': [], 'gifts': [], 'shops': []})
        for f in [f]:
            if f['kind'] == 'item':
                a['items'].append([f['item'], f['qty'], f['how']])
            elif f['kind'] == 'shop':
                if f['items'] and f['items'] not in a['shops']:
                    a['shops'].append(f['items'])
            else:
                g = {'kind': f['kind'], 's': f['s'], 'lv': f.get('lv'), 'item': f.get('item')}
                if g not in a['gifts']:
                    a['gifts'].append(g)

for o in VENDORS:
    if len(origin_areas.get(o, ())) >= SHARED:
        continue
    name, its = vendor_area[o]
    a = areas.setdefault(name, {'items': [], 'gifts': [], 'shops': []})
    lst = sorted(set(its))
    if lst not in a['shops']:
        a['shops'].append(lst)
for a in areas.values():
    seen, gifts = set(), []
    for g in a['gifts']:
        k = (g['kind'], g['s'], g['lv'])
        if k not in seen:
            seen.add(k); gifts.append(g)
    a['gifts'] = gifts
areas = {k: v for k, v in areas.items() if v['items'] or v['gifts'] or v['shops']}
with open(os.path.join(OUT, 'finds.json'), 'w') as fh:
    json.dump({'areas': areas, 'mart': sorted(mart)}, fh, indent=0)
n_items = sum(len(a['items']) for a in areas.values())
n_gifts = sum(len(a['gifts']) for a in areas.values())
tms = sum(1 for a in areas.values() for i in a['items'] if (items.get(str(i[0])) or '').startswith(('TM', 'HM')))
print(f'{len(areas)} areas: {n_items} item pickups ({tms} TMs/HMs), {n_gifts} gift/static/egg Pokemon, '
      f'{sum(len(a["shops"]) for a in areas.values())} shops')
