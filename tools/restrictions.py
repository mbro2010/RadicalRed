"""Dump the moves Hardcore/Restricted mode stops your Pokemon from learning.

usage: python3 tools/restrictions.py data/restrictions.json
"""
import sys, json, os
sys.path.insert(0, os.path.dirname(__file__))
from rom import u16, s
MVN=0x10F3188; SPN=0x14042CC
def lst(o):
    out=[]; i=0
    while u16(o+2*i) != 0xFEFE: out.append(u16(o+2*i)); i+=1
    return out
banned = lst(0x103FAE0)
toxic_ls = lst(0x103FB86)
exc = lst(0x116618C)
# keep order, drop duplicate names
def names(ids, base, stride):
    seen=[]; 
    for i in ids:
        n = s(base+i*stride, stride)
        if n not in seen: seen.append(n)
    return seen
out = {'bannedMoves': names(banned, MVN, 13), 'conditionalMoves': names(toxic_ls, MVN, 13),
       'conditionalAllowedSpecies': names(exc, SPN, 11),
       'source': 'Move-learning code checks flag 0x1034 (Hardcore) or 0x103C (Restricted) against these lists'}
json.dump(out, open(sys.argv[1], 'w'), ensure_ascii=False, indent=1)
print(len(out['bannedMoves']), out['conditionalMoves'], len(out['conditionalAllowedSpecies']))
