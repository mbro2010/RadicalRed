"""Extract the starter choices from Professor Oak's Lab (map 4.3).

The three Poke Ball objects set 0x5124 (species) and 0x5125 (ball 1-3); a setting stored in 0x5123 picks the
generation, and the script at 0x0904FB42 swaps in that generation's species for each ball. The ball also sets
0x4001 (0, 1, 2), which becomes the rival's pick (0x4031): 0 gives him Charmander, 1 Bulbasaur, 2 Squirtle.

usage: python3 tools/extract_starters.py data
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rom import u8, u16, u32  # noqa: E402

OUT = sys.argv[1] if len(sys.argv) > 1 else 'data'
G = 0x08000000
BALL_TYPE = {1: 'Grass', 2: 'Water', 3: 'Fire'}
RIVAL_LINE = {1: 'Charmander', 2: 'Bulbasaur', 3: 'Squirtle'}   # what the rival takes when you take this ball
species = {s['id']: s['name'] for s in json.load(open(os.path.join(OUT, 'species.json')))}

starters = [{'gen': 1, 'ball': b, 'species': sid} for b, sid in ((1, 1), (2, 7), (3, 4))]   # the balls' own setvar 0x5124
o = 0x104FB42
while u8(o) == 0x21 and u16(o + 1) == 0x5123:          # compare 0x5123, gen ; goto_if ==, branch
    gen, branch = u16(o + 3), u32(o + 7) - G
    p = branch
    while u8(p) == 0x21 and u16(p + 1) == 0x5125:        # compare 0x5125, ball ; goto_if ==, set
        ball, y = u16(p + 3), u32(p + 7) - G
        assert u8(y) == 0x16 and u16(y + 1) == 0x5124    # setvar 0x5124, species
        starters.append({'gen': gen, 'ball': ball, 'species': u16(y + 3)})
        p += 11
    o += 11
for s in starters:
    s.update(name=species[s['species']], type=BALL_TYPE[s['ball']], rival=RIVAL_LINE[s['ball']])
with open(os.path.join(OUT, 'starters.json'), 'w') as f:
    json.dump(starters, f, indent=1)
print(len(starters), 'starters:', ', '.join(s['name'] for s in starters))
