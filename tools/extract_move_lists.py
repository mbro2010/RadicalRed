"""Dump the game's move-category lists (punching, biting, sound, slicing, kicking moves and so on).

Radical Red keeps them as arrays of move IDs ending in 0xFEFE, one after another from 0x103F92E. Which list is which
was read from the code that uses them (Iron Fist reads the punching list, Striker the kicking list, ...; see NOTES.md).
usage: python3 tools/extract_move_lists.py data   ->  data/move_lists.json
"""
import json, os, struct, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rom import rom

LISTS = {
    'gravityBanned': 0x103F92E, 'sheerForce': 0x103FCFE, 'reckless': 0x103FE70, 'punch': 0x103FE9A, 'kick': 0x103FECC,
    'slice': 0x103FEEE, 'bone': 0x103FF2A, 'pulse': 0x103FF34, 'bite': 0x103FF4C, 'ballBomb': 0x103FF64, 'wind': 0x103FF9E,
    'dance': 0x103FFC0, 'powder': 0x103FFD8, 'sound': 0x103FFEA, 'substituteBypass': 0x104002C, 'typeChangeException': 0x1040096,
    'ignoreStatChanges': 0x10400B0, 'highCrit': 0x10400B8, 'alwaysCrit': 0x10400F0, 'recharge': 0x104010E,
    'minimizeDouble': 0x1040122, 'moldBreaker': 0x1040136, 'flinch': 0x1040146, 'unfreezeAttacker': 0x1040180,
    'unfreezeTarget': 0x1040196, 'changePhysicality': 0x10401A0, 'hits2to5': 0x10401A8, 'hits2': 0x10401CE,
    'recoil25': 0x10401E6, 'recoil33': 0x10401F2, 'recoil50': 0x1040200, 'ignoreInAir': 0x104020E,
    'ignoreUnderground': 0x104021E, 'ignoreUnderwater': 0x1040224, 'rainAlwaysHit': 0x104022A,
    'specialAttackPhysicalDamage': 0x1040238, 'liftProtect': 0x104025A, 'statusDouble': 0x1040272, 'halfHpRecoil': 0x104027C,
    'parentalBondBanned': 0x103FC46,
}
out = {}
for name, a in LISTS.items():
    ids = []
    while True:
        v = struct.unpack_from('<H', rom, a)[0]
        if v == 0xFEFE: break
        if v > 2000 or len(ids) > 400: sys.exit(f'{name}: no list at {a:#x}')
        ids.append(v); a += 2
    out[name] = ids
json.dump(out, open(os.path.join(sys.argv[1], 'move_lists.json'), 'w'), indent=0)
print(len(out), 'lists:', ', '.join(f'{k} {len(v)}' for k, v in out.items()))
