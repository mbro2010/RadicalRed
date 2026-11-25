"""Extract move tutors: the 128 tutor moves (pointer at 0x08120BE4) and which species can learn each
(16 bytes of bit flags per species, pointer at 0x08120C30), as used by the engine (CFRU/DPE, 128 tutors).

usage: python3 tools/extract_tutors.py data
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rom import rom, u16, u32  # noqa: E402

OUT = sys.argv[1] if len(sys.argv) > 1 else 'data'
G = 0x08000000
NUM_TUTORS, STRIDE = 128, 16
moves_at, compat_at = u32(0x120BE4) - G, u32(0x120C30) - G
names = {m['id']: m['name'] for m in json.load(open(os.path.join(OUT, 'moves.json')))}
n_species = len(json.load(open(os.path.join(OUT, 'species.json'))))
tutor_moves = [u16(moves_at + 2 * k) for k in range(NUM_TUTORS)]
learn = {}
for s in range(n_species):
    bits = int.from_bytes(rom[compat_at + s * STRIDE:compat_at + (s + 1) * STRIDE], 'little')
    ids = [k for k in range(NUM_TUTORS) if bits >> k & 1 and tutor_moves[k]]
    if ids:
        learn[s] = ids
with open(os.path.join(OUT, 'tutors.json'), 'w') as f:
    json.dump({'moves': [{'id': m, 'name': names.get(m)} for m in tutor_moves], 'species': learn}, f, indent=0)
print(f'{sum(1 for m in tutor_moves if m)} tutor moves, {len(learn)} species can learn at least one')
