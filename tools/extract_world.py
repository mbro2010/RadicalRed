"""Extract the overworld data a nuzlocke needs from the ROM:

- evolutions.json: every evolution (level, item, trade, friendship, Mega Evolution, ...) from the
  evolution table (16 entries per species, as in DPE)
- maps.json: every map header with its region-map section and name
- encounters.json: wild Pokemon per area (region-map section), per map, per method (grass, surfing,
  Rock Smash, fishing) and per time of day. Radical Red switches tables by the clock: from 4:00 to 16:59
  one table, from 17:00 to 3:59 another; maps without a time split use the main table. Any method the
  time table leaves empty falls back to the main table (decoded from the code at 0x090C3550).
- trainer_locations.json: which map each trainer stands on, from the map's NPC scripts (trainerbattle)

usage: python3 tools/extract_world.py data
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rom import rom, u8, u16, u32, dec, isptr  # noqa: E402

OUT = sys.argv[1] if len(sys.argv) > 1 else 'data'
G = 0x08000000

species = {s['id']: s for s in json.load(open(os.path.join(OUT, 'species.json')))}
items = json.load(open(os.path.join(OUT, 'items.json')))
item_name = (lambda i: items.get(str(i)))
moves = {m['id']: m['name'] for m in json.load(open(os.path.join(OUT, 'moves.json')))}
TYPES = ['Normal', 'Fighting', 'Flying', 'Poison', 'Ground', 'Rock', 'Bug', 'Ghost', 'Steel', 'Mystery', 'Fire', 'Water', 'Grass',
         'Electric', 'Psychic', 'Ice', 'Dragon', 'Dark', '?', '?', '?', '?', '?', 'Fairy']

# ---------------- evolutions ----------------
EVO_TABLE = u32(0x42F6C) - G          # gEvolutionTable (literal used by the engine)
EVOS_PER_MON = 16
METHODS = {1: 'friendship', 2: 'friendship (day)', 3: 'friendship (night)', 4: 'level', 5: 'trade', 6: 'trade holding item',
           7: 'item', 8: 'level, Attack > Defense', 9: 'level, Attack = Defense', 10: 'level, Attack < Defense',
           11: 'level (Silcoon)', 12: 'level (Cascoon)', 13: 'level (Ninjask)', 14: 'level (Shedinja)', 15: 'beauty',
           16: 'level in rain or fog', 17: 'knows a move of type', 18: 'level with a type in the party', 19: 'level on a map',
           20: 'level (male)', 21: 'level (female)', 22: 'level at night', 23: 'level during the day', 24: 'level holding item at night',
           25: 'level holding item during the day', 26: 'knows move', 27: 'level with a Pokemon in the party', 28: 'level at a time of day',
           29: 'flag set', 30: '3 critical hits in one battle', 31: 'level (high-key nature)', 32: 'level (low-key nature)',
           33: 'damage then a location', 34: 'item at a location', 35: 'level holding item', 36: 'item while holding item',
           37: 'knows move (male)', 38: 'knows move (female)', 39: 'item at night', 0xFD: 'Gigantamax', 0xFE: 'Mega Evolution'}


def describe(method, param, unk):
    m = METHODS.get(method, f'method {method}')
    if method in (4, 8, 9, 10, 11, 12, 13, 14, 16, 20, 21, 22, 23, 31, 32):
        return f'{m.replace("level", "Level " + str(param), 1)}'
    if method in (6, 7, 24, 25, 34, 35, 36, 39):
        extra = f' at Lv {unk}' if method == 35 and unk else ''
        return f'{m}: {item_name(param) or param}{extra}'
    if method in (26, 37, 38):
        return f'{m}: {moves.get(param, param)}'
    if method == 17:
        return f'knows a {TYPES[param] if param < len(TYPES) else param}-type move'
    if method == 18:
        return f'Level {unk} with a {TYPES[param] if param < len(TYPES) else param}-type Pokemon in the party'
    if method == 27:
        return f'level up with {species.get(param, {}).get("name", param)} in the party'
    if method == 0xFE:
        return f'Mega Evolution with {item_name(param) or param}' if unk == 0 else f'Mega Evolution (knows {moves.get(param, param)})'
    if method == 1:
        return 'friendship'
    return m


evolutions = {}
for sid in species:
    out = []
    for k in range(EVOS_PER_MON):
        o = EVO_TABLE + (sid * EVOS_PER_MON + k) * 8
        method, param, target, unk = u16(o), u16(o + 2), u16(o + 4), u16(o + 6)
        if method == 0 or target == 0 or target not in species:
            continue
        out.append({'method': method, 'param': param, 'target': target, 'unknown': unk, 'how': describe(method, param, unk)})
    if out:
        evolutions[sid] = out

# ---------------- maps ----------------
MAP_GROUPS = u32(0x5524C) - G          # gMapGroups
MAPSEC_NAMES = 0x3F1CAC               # map-section names, indexed by mapsec - 0x58
names = []
for k in range(200):
    p = u32(MAPSEC_NAMES + 4 * k)
    if not isptr(p):
        break
    names.append(dec(rom[p - G:p - G + 40]).replace('‘', "'").replace('’', "'"))


def mapsec_name(sec):
    i = sec - 0x58
    return names[i] if 0 <= i < len(names) else None


def valid_header(p):
    if not isptr(p):
        return False
    o = p - G
    return all(isptr(u32(o + 4 * k)) for k in (0, 1, 2)) and (u32(o + 12) == 0 or isptr(u32(o + 12))) and 0x58 <= u8(o + 0x14) < 0x58 + len(names) + 8


groups = []
gp = [u32(MAP_GROUPS + 4 * g) for g in range(60)]
for g in range(60):
    if not isptr(gp[g]):
        break
    groups.append(gp[g] - G)
maps = {}
for g, base in enumerate(groups):
    n = 0
    while n < 256:
        p = u32(base + 4 * n)
        if not valid_header(p):
            break
        # stop where the next group's list begins
        if n and any(base + 4 * n == other for other in groups):
            break
        o = p - G
        sec = u8(o + 0x14)
        maps[(g, n)] = {'group': g, 'num': n, 'header': p, 'events': u32(o + 4), 'mapsec': sec, 'name': mapsec_name(sec), 'type': u8(o + 0x17)}
        n += 1

# ---------------- wild encounters ----------------
SLOTS = {'land': [20, 20, 10, 10, 10, 10, 5, 5, 4, 4, 1, 1], 'water': [60, 30, 5, 4, 1], 'rock': [60, 30, 5, 4, 1],
         'fish': [70, 30, 60, 20, 20, 40, 40, 15, 4, 1]}
ROD = ['Old Rod', 'Old Rod', 'Good Rod', 'Good Rod', 'Good Rod', 'Super Rod', 'Super Rod', 'Super Rod', 'Super Rod', 'Super Rod']
KINDS = ['land', 'water', 'rock', 'fish']


def read_headers(ptr):
    base = ptr - G
    out = {}
    n = 0
    while u8(base + n * 20) != 0xFF:
        o = base + n * 20
        out[(u8(o), u8(o + 1))] = [u32(o + 4 + 4 * k) for k in range(4)]
        n += 1
    return out


def read_info(p, kind):
    if not p:
        return None
    o = p - G
    rate, wp = u8(o), u32(o + 4) - G
    mons = []
    for k, chance in enumerate(SLOTS[kind]):
        lo, hi, s = u8(wp + 4 * k), u8(wp + 4 * k + 1), u16(wp + 4 * k + 2)
        slot = {'s': s, 'min': min(lo, hi), 'max': max(lo, hi), 'pct': chance}
        if kind == 'fish':
            slot['rod'] = ROD[k]
        mons.append(slot)
    return {'rate': rate, 'slots': mons}


MAIN = read_headers(u32(0x82990))      # gWildMonHeaders
NIGHT = read_headers(0x09166428)        # 17:00-3:59 (evening and night)
DAY = read_headers(0x09166AB8)          # 4:00-16:59 (morning and day)


def table_for(key, timed):
    """the encounter info pointers the game uses on this map for one time table, with fallback to the main table"""
    t = timed.get(key)
    m = MAIN.get(key)
    return [(t[k] if t and t[k] else (m[k] if m else 0)) for k in range(4)]


areas = {}
for key in sorted(set(MAIN) | set(NIGHT) | set(DAY)):
    mp = maps.get(key)
    name = (mp and mp['name']) or f'Map {key[0]}.{key[1]}'
    day = table_for(key, DAY)
    night = table_for(key, NIGHT)
    entry = {'group': key[0], 'num': key[1], 'timed': key in DAY or key in NIGHT, 'methods': {}}
    for k, kind in enumerate(KINDS):
        d_info, n_info = read_info(day[k], kind), read_info(night[k], kind)
        if not d_info and not n_info:
            continue
        if day[k] == night[k]:
            entry['methods'][kind] = {'any': d_info}
        else:
            entry['methods'][kind] = {'day': d_info, 'night': n_info}
    if entry['methods']:
        areas.setdefault(name, []).append(entry)

# ---------------- trainers on each map ----------------
OPLEN = {0x00: 0, 0x01: 0, 0x02: 0, 0x03: 0, 0x04: 4, 0x05: 4, 0x06: 5, 0x07: 5, 0x08: 1, 0x09: 1, 0x0A: 2, 0x0B: 2, 0x0F: 5, 0x10: 2,
         0x16: 4, 0x17: 4, 0x18: 4, 0x19: 4, 0x1A: 4, 0x21: 4, 0x22: 4, 0x23: 4, 0x25: 2, 0x26: 4, 0x27: 0, 0x28: 2, 0x29: 2, 0x2A: 2,
         0x2B: 2, 0x2F: 2, 0x30: 0, 0x31: 2, 0x32: 0, 0x5A: 0, 0x66: 0, 0x67: 4, 0x68: 0, 0x69: 0, 0x6A: 0, 0x6B: 0, 0x6C: 0, 0x6D: 0,
         0x7D: 3, 0x80: 3, 0x82: 3, 0x83: 3, 0xC5: 0}
BATTLE_LEN = {0: 12, 1: 16, 2: 16, 3: 8, 4: 16, 5: 12, 6: 20, 7: 16, 8: 20, 9: 12}   # 9: the early-rival battle (14 bytes, like pokefirered trainerbattle_earlyrival)


def trainers_in_script(off, depth=0, seen=None):
    seen = seen if seen is not None else set()
    found = []
    o = off
    for _ in range(40):
        if o in seen or not (0 <= o < len(rom)):
            break
        seen.add(o)
        op = rom[o]
        if op == 0x5C:
            typ, tid = rom[o + 1], u16(o + 2)
            found.append(tid)
            o += 2 + BATTLE_LEN.get(typ, 12)
            continue
        if op in (0x04, 0x05) and depth < 3:
            p = u32(o + 1)
            if isptr(p):
                found += trainers_in_script(p - G, depth + 1, seen)
            if op == 0x05:
                break
        if op in (0x06, 0x07) and depth < 3:
            p = u32(o + 2)
            if isptr(p):
                found += trainers_in_script(p - G, depth + 1, seen)
        if op not in OPLEN or op in (0x02, 0x03):
            break
        o += 1 + OPLEN[op]
    return found


trainer_maps = {}
for key, mp in maps.items():
    ev = mp['events'] - G
    count, objs = u8(ev), u32(ev + 4)
    if not isptr(objs) or count > 64:
        continue
    for k in range(count):
        o = objs - G + 24 * k
        sp = u32(o + 16)
        if not isptr(sp):
            continue
        for tid in trainers_in_script(sp - G):
            places = trainer_maps.setdefault(tid, [])
            if mp['name'] and mp['name'] not in places:
                places.append(mp['name'])

with open(os.path.join(OUT, 'evolutions.json'), 'w') as f:
    json.dump(evolutions, f, indent=0)
with open(os.path.join(OUT, 'maps.json'), 'w') as f:
    json.dump([{k: v for k, v in m.items() if k not in ('header', 'events')} for m in maps.values()], f, indent=0)
with open(os.path.join(OUT, 'encounters.json'), 'w') as f:
    json.dump(areas, f, indent=0)
with open(os.path.join(OUT, 'trainer_locations.json'), 'w') as f:
    json.dump(trainer_maps, f, indent=0)
print(f'{len(evolutions)} species with evolutions, {len(maps)} maps in {len(groups)} groups, {len(areas)} areas with wild Pokemon, '
      f'{len(trainer_maps)} trainers placed on maps')
