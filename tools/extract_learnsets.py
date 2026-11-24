"""Extract level-up learnsets, the TM/HM list and TM/HM compatibility.

usage: python3 tools/extract_learnsets.py data

Layouts (found in the engine's own code):
- Level-up learnsets: pointer table at *(0x08043E20); each species points to
  3-byte entries (u16 move, u8 level), ended by an entry with level 0xFF.
- TM/HM moves: 128 u16 move IDs at 0x18224B8 (TM01-TM120, then HM01-HM08).
- TM/HM compatibility: table at *(0x08043C68), 16 bytes per species; bit n of
  the 128-bit field means the species can learn TM/HM index n
  (CanMonLearnTMHM at 0x090A54C8).
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rom import rom, u16, u32

OUT = sys.argv[1] if len(sys.argv) > 1 else 'data'
N_SPECIES = 1376
LEARNSET_PTRS = u32(0x43E20) - 0x08000000
TM_MOVES = 0x18224B8
TM_COMPAT = u32(0x43C68) - 0x08000000

tm_moves = [u16(TM_MOVES + 2*i) for i in range(128)]
tm_labels = [f'TM{i+1:02d}' for i in range(120)] + [f'HM{i+1:02d}' for i in range(8)]

out = {}
for sp in range(N_SPECIES):
    p = u32(LEARNSET_PTRS + 4*sp) - 0x08000000
    lvl = []
    for i in range(200):
        mv, lv = u16(p + 3*i), rom[p + 3*i + 2]
        if lv == 0xFF:
            break
        lvl.append([lv, mv])
    bits = int.from_bytes(rom[TM_COMPAT + 16*sp: TM_COMPAT + 16*sp + 16], 'little')
    tms = [i for i in range(128) if bits >> i & 1]
    out[sp] = {'levelup': lvl, 'tm': tms}

with open(os.path.join(OUT, 'learnsets.json'), 'w') as f:
    json.dump(out, f, separators=(',', ':'))
with open(os.path.join(OUT, 'tms.json'), 'w') as f:
    json.dump([{'label': l, 'move': m} for l, m in zip(tm_labels, tm_moves)], f, indent=1)
print('species', len(out), 'tm/hm', len(tm_moves))
