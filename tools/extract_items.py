"""Dump item names and hold effects by item ID.  usage: python3 tools/extract_items.py data"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rom import rom, s, cm

ITEMS = 0x13C0000
def valid(b):
    if 0xFF not in b: return False
    k = b.index(0xFF)
    return k > 0 and all(x in cm and x != 0xFE for x in b[:k]) or all(x in cm or x in range(0x55, 0x5A) for x in b[:k])
items = {}
bad = 0
for i in range(1, 2000):
    raw = rom[ITEMS + i*44: ITEMS + i*44 + 14]
    if valid(raw):
        items[i] = s(ITEMS + i*44, 14); bad = 0
    else:
        bad += 1
        if bad > 20: break
json.dump(items, open(os.path.join(sys.argv[1], 'items.json'), 'w'), indent=0, ensure_ascii=False)
# what each item does when held: its hold effect and that effect's number (a type, a percentage...), item struct +18/+19
effects = {i: [rom[ITEMS + i*44 + 18], rom[ITEMS + i*44 + 19]] for i in items}
json.dump(effects, open(os.path.join(sys.argv[1], 'item_effects.json'), 'w'), separators=(',', ':'))
print('items', len(items), 'last id', max(items))
