"""Every trainer's party as Radical Red's own party builder makes it (run in an emulator, see gba_emu.py), in both
difficulties: Normal (Minimal Grinding, flag 0x1032) and Hardcore (0x1034 with 0x1032 and 0x10BE, as its script sets them).
The app data builder takes what the tables leave to the game from here: the natures and abilities of trainers on the
regular table (personality from the trainer's name and species, so the same every time) and form changes (Arceus with a
Plate, Keldeo with Secret Sword).

usage: RR_ROM=path/to/rom python3 -I tools/game_parties.py data/trainers.json data/game_parties.json
(unicorn installed; RR_PYLIB points at it if it isn't on the path)"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gba_emu import GBA, ability_name

STAT_ORDER = (0, 1, 2, 4, 5, 3)   # the game's HP Atk Def Spe SpA SpD -> the app's hp atk def spa spd spe
TOP = 50                           # the player's highest level for relative-level Pokemon (levels aren't taken from here)
SEEDS = (0x1234, 0xBEEF, 0x1, 0x7777, 0x31337, 0xC0FFEE, 0x5A5A, 0x2468)   # enough to see what the game rolls each battle

def build(tid, mode, seed):
    g = GBA(seed=seed)
    g.flag_set(0x1032)
    if mode == 'hardcore':
        g.flag_set(0x1034); g.flag_set(0x10BE)
    g.set_player_party(1, TOP)
    n, team = g.build(tid)
    return [{'s': m['species'], 'lv': m['level'], 'nat': m['nature'], 'ab': ability_name(m['ability']), 'it': m['item'],
             'mv': [x for x in m['moves'] if x], 'iv': [m['iv'][k] for k in STAT_ORDER], 'ev': [m['ev'][k] for k in STAT_ORDER],
             'stats': [m['stats'][k] for k in STAT_ORDER]} for m in team]

def main():
    src = sys.argv[-2] if len(sys.argv) >= 3 else 'data/trainers.json'
    out = sys.argv[-1] if len(sys.argv) >= 3 else 'data/game_parties.json'
    ids = sorted({t['id'] for t in json.load(open(src))})
    res = {'normal': {}, 'hardcore': {}, 'random': {}}
    for mode in ('normal', 'hardcore'):
        for tid in ids:
            try:
                runs = [build(tid, mode, seed) for seed in SEEDS]
            except Exception as e:
                print(f'{mode} {tid}: {e}', file=sys.stderr)
                continue
            a = runs[0]
            if not a: continue
            res[mode][str(tid)] = a
            # anything that changes with the random seed is left to chance in the game too: per Pokemon, which fields,
            # and the abilities it was seen with
            for k, x in enumerate(a):
                diff = sorted({f for r in runs[1:] if k < len(r) for f in ('nat', 'ab', 's', 'it', 'mv') if r[k][f] != x[f]})
                if diff:
                    res['random'].setdefault(f'{mode}:{tid}', {})[str(k)] = {'fields': diff, 'ab': sorted({r[k]['ab'] for r in runs if k < len(r)})}
    json.dump(res, open(out, 'w'), separators=(',', ':'))
    print(f"normal {len(res['normal'])} parties, hardcore {len(res['hardcore'])}; random fields in {len(res['random'])}: {list(res['random'].items())[:5]}")

if __name__ == '__main__':
    main()
