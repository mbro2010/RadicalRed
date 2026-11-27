"""Every species' weight as the game's battle code sees it (Low Kick, Grass Knot, Heavy Slam, Heat Crash), by running
the game's own GetActualSpeciesWeight (0x09084288: the alternate-size table for forms, else the Pokédex entry) in the
emulator (gba_emu.py). Weights are in hectograms (0.1 kg).
usage: RR_ROM=... RR_PYLIB=... python3 -I tools/extract_weights.py data   ->  data/weights.json
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gba_emu import GBA
GET_ACTUAL_SPECIES_WEIGHT = 0x09084288
species = json.load(open(os.path.join(sys.argv[1], 'species.json')))
g = GBA()
out = {}
for s in species:
    sid = s['id'] if isinstance(s, dict) else s
    if not sid: continue
    w = g.call(GET_ACTUAL_SPECIES_WEIGHT, sid, 0, 0, 0, stack=(0, 0)) & 0xFFFF   # no ability, no item; checkNimble off
    out[sid] = w
json.dump(out, open(os.path.join(sys.argv[1], 'weights.json'), 'w'), separators=(',', ':'))
print('weights', len(out), 'e.g. Bulbasaur', out.get(1), 'Snorlax', out.get(143))
