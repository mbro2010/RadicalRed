"""Dump Radical Red's in-game ability descriptions.  usage: python3 tools/extract_ability_text.py data

The description pointer table is at 0x1009B84 (the engine reads it through
the vanilla slot at 0x080001C4). It has 256 entries: ability IDs are one byte.
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rom import s, u32, isptr

ABILITY_NAMES, DESC_PTRS = 0x10E32C0, u32(0x1C4) - 0x08000000
out = {}
for i in range(1, 256):
    name = s(ABILITY_NAMES + i*17, 17).strip()
    p = u32(DESC_PTRS + 4*i)
    if name and isptr(p):
        out[name] = s(p - 0x08000000, 160).replace('\n', ' ')
json.dump(out, open(os.path.join(sys.argv[1], 'ability_descriptions.json'), 'w'), indent=0, ensure_ascii=False)
print('descriptions', len(out), 'table', hex(DESC_PTRS))
