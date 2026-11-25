"""Where each fight is started, and where scripts hand over key items.

Walks every script a map can run (its people, triggers, signs and the map's own scripts, including the on-frame
tables that start rival and Champion battles; see script_walk.entry_points), following goto, call, both sides of
goto_if/call_if and the script that runs after a won battle. Records:

- fights: trainer id -> the areas whose scripts start a battle with that trainer (trainerbattle)
- given: item id -> the areas whose scripts hand it over (setorcopyvar 0x8000 + callstd 0/1, or additem)

A trainer or item reached from scripts shared by three or more areas gets no place: that's a common script
(the Pokemon League's doors, a service NPC), not a location.

usage: RR_ROM=/path/to/rom python3 tools/extract_fight_places.py data
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rom import rom, u16, u32, isptr  # noqa: E402
from script_walk import L, BATTLE_LEN, BATTLE_CONT, G, header, entry_points  # noqa: E402

OUT = sys.argv[1] if len(sys.argv) > 1 else 'data'
maps = json.load(open(os.path.join(OUT, 'maps.json')))
items = json.load(open(os.path.join(OUT, 'items.json')))
SHARED = 3


def walk(start, found, seen, depth=0, vars_=None):
    vars_ = vars_ if vars_ is not None else {}
    o = start
    for _ in range(300):
        if o in seen or not (0 <= o < len(rom) - 24):
            return
        seen.add(o)
        op = rom[o]
        if op == 0x5C:                                  # trainerbattle type, trainer, ...
            typ = rom[o + 1]
            found['fights'].add(u16(o + 2))
            cont = BATTLE_CONT.get(typ)
            if cont and depth < 8 and isptr(u32(o + cont)):
                walk(u32(o + cont) - G, found, seen, depth + 1, dict(vars_))
            o += 2 + BATTLE_LEN.get(typ, 12)
            continue
        if op not in L:
            return
        if op in (0x16, 0x1A):                          # setvar / setorcopyvar
            vars_[u16(o + 1)] = u16(o + 3)
        elif op == 0x09 and rom[o + 1] in (0, 1):       # callstd obtain/find the item in 0x8000
            it = vars_.get(0x8000)
            if it and str(it) in items:
                found['given'].add(it)
        elif op == 0x44:                                # additem
            it = u16(o + 1)
            if str(it) in items:
                found['given'].add(it)
        if op in (0x04, 0x05) and depth < 8 and isptr(u32(o + 1)):
            walk(u32(o + 1) - G, found, seen, depth + 1, dict(vars_))
            if op == 0x05:
                return
        if op in (0x06, 0x07) and depth < 8 and isptr(u32(o + 2)):
            walk(u32(o + 2) - G, found, seen, depth + 1, dict(vars_))
        if op in (0x02, 0x03, 0x08):
            return
        o += 1 + L[op]


fights, given = {}, {}
for mp in maps:
    name = mp['name']
    if not name:
        continue
    found = {'fights': set(), 'given': set()}
    seen = set()
    for _kind, sp in entry_points(header(mp['group'], mp['num'])):
        walk(sp - G, found, seen)
    for tid in found['fights']:
        places = fights.setdefault(tid, [])
        if name not in places:
            places.append(name)
    for it in found['given']:
        places = given.setdefault(it, [])
        if name not in places:
            places.append(name)
fights = {t: p for t, p in sorted(fights.items()) if len(p) < SHARED}
given = {i: p for i, p in sorted(given.items()) if len(p) < SHARED}
with open(os.path.join(OUT, 'fight_places.json'), 'w') as fh:
    json.dump({'fights': fights, 'given': given}, fh, indent=0)
print(f'{len(fights)} trainers placed, {len(given)} items handed over by scripts')
