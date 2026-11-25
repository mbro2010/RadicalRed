"""The care package cheat (code SO2Toxic): which items it hands over, and where.

Typing a code upstairs in your house (Pallet Town, map 4.1) runs the cheat-code script at 0x1050086. In 4.1:

- SO2Toxic sets flag 0x103F, the care package. Every place that hands over a package does `checkflag 0x103F` and
  then `call_if TRUE` to a list of `giveitem`s (setorcopyvar 0x8000 item, setorcopyvar 0x8001 count, callstd 0).
- Woyaopp is the Rare Candy cheat (flag 0x1040: "Talk to the youngster in Viridian City"), not items.

Some items in a package depend on the game mode: `checkflag F; call_if FALSE` adds items only when F is not set.
Choosing Hardcore Mode sets 0x1034 (Hardcore), 0x1032 (Minimal Grinding) and 0x10BE (no weather rocks, terrain
seeds, Weakness Policy, Throat Spray...), so Hardcore players get the base lists only.

Each package is placed by walking every map's scripts (script_walk.entry_points) to the `checkflag 0x103F` that
gives it. A package handed over after a gym win records the badge set on the way (flags 0x820-0x827); the one in
Pallet Town is Mom's, after you become Champion ("There are a lot of new perks after becoming Champion", 0x9111463).
Every other package comes from a one-time trigger you walk over in that area. The code-entry script itself (which
hands over the packages for checkpoints already passed) is skipped, and a package that only repeats part of another
one in the same area (Fuchsia City calls part of its package from two places) is folded into it.

usage: RR_ROM=/path/to/rom python3 tools/extract_care_package.py data
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rom import rom, u16, u32, isptr  # noqa: E402
from script_walk import L, BATTLE_LEN, BATTLE_CONT, G, header, entry_points  # noqa: E402

OUT = sys.argv[1] if len(sys.argv) > 1 else 'data'
maps = json.load(open(os.path.join(OUT, 'maps.json')))
CARE_FLAG = 0x103F
HARDCORE_FLAGS = {0x1034, 0x1032, 0x10BE}
CODE_SCRIPT = 0x105013F            # SO2Toxic's own script: hands over packages for checkpoints already passed


def items_of(start, flags_set, depth=0, seen=None):
    """[(item, count)] a package script hands over with these mode flags set."""
    seen = seen if seen is not None else set()
    out, o, last_flag, item = [], start, None, None
    for _ in range(300):
        if o in seen or not (0 <= o < len(rom) - 8):
            break
        seen.add(o)
        op = rom[o]
        if op not in L:
            break
        if op == 0x2B:                                    # checkflag
            last_flag = u16(o + 1)
        elif op == 0x1A:                                  # setorcopyvar
            var, val = u16(o + 1), u16(o + 3)
            if var == 0x8000:
                item = val
            elif var == 0x8001 and item is not None:
                out.append((item, val))
                item = None
        elif op == 0x44:                                  # additem
            out.append((u16(o + 1), u16(o + 3)))
        elif op == 0x04 and depth < 6 and isptr(u32(o + 1)):
            out += items_of(u32(o + 1) - G, flags_set, depth + 1, seen)
        elif op == 0x07 and depth < 6 and isptr(u32(o + 2)):   # call_if: follow it when the mode flags allow
            cond = rom[o + 1]
            taken = True
            if last_flag is not None and cond in (0, 1):
                is_set = last_flag in flags_set
                taken = is_set if cond == 1 else not is_set
            if taken:
                out += items_of(u32(o + 2) - G, flags_set, depth + 1, seen)
        if op == 0x05 and isptr(u32(o + 1)):             # goto: the package continues there
            o = u32(o + 1) - G
            continue
        if op in (0x02, 0x03):
            break
        o += 1 + L[op]
    return out


# every `checkflag 0x103F; call_if TRUE, package`
pat = bytes([0x2B, CARE_FLAG & 0xFF, CARE_FLAG >> 8])
sites = {}
i = rom.find(pat)
while i >= 0:
    nxt = i + 3
    if rom[nxt] == 0x07 and rom[nxt + 1] == 1 and isptr(u32(nxt + 2)) and not (CODE_SCRIPT <= i < CODE_SCRIPT + 0x100):
        sites[i] = u32(nxt + 2) - G
    i = rom.find(pat, i + 1)


def walk(start, path, seen, found, depth=0):
    o = start
    for _ in range(400):
        if o in seen or not (0 <= o < len(rom) - 24):
            return
        seen.add(o)
        if o in sites and o not in found:
            found[o] = list(path)
        op = rom[o]
        if op == 0x29 and 0x820 <= u16(o + 1) <= 0x827:    # setflag: a badge
            path = path + [('badge', u16(o + 1) - 0x820)]
        if op == 0x5C:                                    # trainerbattle: the package may come after the win
            typ, tid = rom[o + 1], u16(o + 2)
            cont = BATTLE_CONT.get(typ)
            if cont and depth < 10 and isptr(u32(o + cont)):
                walk(u32(o + cont) - G, path + [('trainer', tid)], seen, found, depth + 1)
            o += 2 + BATTLE_LEN.get(typ, 12)
            continue
        if op not in L:
            return
        if op in (0x04, 0x05) and depth < 10 and isptr(u32(o + 1)):
            walk(u32(o + 1) - G, path, seen, found, depth + 1)
            if op == 0x05:
                return
        if op in (0x06, 0x07) and depth < 10 and isptr(u32(o + 2)):
            walk(u32(o + 2) - G, path, seen, found, depth + 1)
        if op in (0x02, 0x03, 0x08):
            return
        o += 1 + L[op]


placed = {}
for mp in maps:
    if not mp['name']:
        continue
    for _kind, sp in entry_points(header(mp['group'], mp['num'])):
        found = {}
        walk(sp - G, [], set(), found)
        for site, path in found.items():
            trainer = next((v for k, v in reversed(path) if k == 'trainer'), None)
            badge = next((v for k, v in reversed(path) if k == 'badge'), None)
            placed.setdefault(site, (mp['name'], trainer, badge))

BADGES = ['Boulder', 'Cascade', 'Thunder', 'Rainbow', 'Soul', 'Marsh', 'Volcano', 'Earth']
AFTER_CHAMPION = {'Pallet Town'}                          # Mom's package (see above)
packages = []
for site, sub in sorted(sites.items()):
    if site not in placed:
        continue                                          # not reachable from any map's scripts
    area, trainer, badge = placed[site]
    hard = items_of(sub, HARDCORE_FLAGS)
    other = [x for x in items_of(sub, set()) if x not in hard]
    if not hard and not other:
        continue
    pk = {'area': area, 'items': hard, 'otherModes': other, 'script': hex(site)}
    if badge is not None:
        pk['after'] = BADGES[badge] + ' Badge'
        if trainer is not None:
            pk['trainer'] = trainer
    elif area in AFTER_CHAMPION:
        pk['after'] = 'Champion'
    packages.append(pk)
# fold packages that only repeat part of another one in the same area
keep = []
for pk in packages:
    whole = next((q for q in packages if q is not pk and q['area'] == pk['area'] and len(q['items']) > len(pk['items'])
                  and all(x in q['items'] for x in pk['items'])), None)
    if not whole:
        keep.append(pk)
packages = keep

with open(os.path.join(OUT, 'care_package.json'), 'w') as fh:
    json.dump({'code': 'SO2Toxic', 'flag': hex(CARE_FLAG), 'packages': packages}, fh, indent=1)
print(f'{len(packages)} care packages placed; Hardcore items: {sum(len(p["items"]) for p in packages)}')
