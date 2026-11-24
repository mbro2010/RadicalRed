"""Sanity checks on the extracted trainer data.  usage: python3 tools/validate.py data"""
import json, sys, collections
D = sys.argv[1]
tr = json.load(open(f'{D}/trainers.json')); sp = json.load(open(f'{D}/species.json')); mv = json.load(open(f'{D}/moves.json'))
problems = collections.Counter(); examples = collections.defaultdict(list)
notes = collections.Counter(); note_ex = collections.defaultdict(list)
def note(cond, key, ex):
    if not cond:
        notes[key]+=1
        if len(note_ex[key])<4: note_ex[key].append(ex)
def chk(cond, key, ex):
    if not cond:
        problems[key]+=1
        if len(examples[key])<4: examples[key].append(ex)
for t in tr:
    for src, parties in [('hc', t.get('hardcoreOverride', [])), ('always', t.get('alwaysOverride', []))]:
        for p in parties:
            chk(len(p['party']) == p['partySize'], 'size', t['name'])
            for m in p['party']:
                ex = f"{t['id']} {t['name']} {m['species']}"
                chk(m['speciesId'] > 0 and m['species'] and '{' not in m['species'], src+':species', ex)
                chk(len(m['moves']) >= 1, src+':no moves', ex)
                chk(all(0 < x < 1004 for x in m['moveIds']), src+':move range', ex)
                chk(m['natureId'] < 25, src+':nature', ex)
                lv = m.get('level')
                note(lv is None or 1 <= lv <= 100, src+': level above 100 (joke/secret trainer)', ex+f' lv={lv}')
                chk(all(v <= 31 for v in m['ivs'].values()), src+':ivs', ex)
                note(sum(m['evsInRecord'].values()) <= 510, src+': EVs over 510 in record (post-game superbosses)', ex)
                note(sum(m['evsInRecord'].values()) == 0, src+': EVs in record (zeroed in Hardcore by Minimal Grinding)', ex)
                chk(m['item'] is None or '{' not in m['item'], src+':item', ex+f" {m['item']}")
                chk(m['raw']['b24'] == 0, src+':b24 nonzero', ex+f" {m['raw']}")
                note(m['raw']['b27'] == 0, src+': starts the battle with a status (e.g. Guts + burn)', ex+f" status byte {m['raw']['b27']}")
print('problems:', dict(problems) or 'none')
for k,v in examples.items(): print(' ', k, v)
print('notes (expected quirks):')
for k,v in notes.items(): print(f'  {k}: {v}  e.g. {note_ex[k]}')
# distribution of b25 values and relative levels
b25 = collections.Counter(); rel = collections.Counter(); evs_nonzero = 0
for t in tr:
    for p in t.get('hardcoreOverride', []):
        for m in p['party']:
            b25[m['raw']['b25']] += 1
            if m.get('relativeToPlayerMax') is not None: rel[(t['name'], m['species'], m['relativeToPlayerMax'])] += 1
            if sum(m['evsInRecord'].values()): evs_nonzero += 1
print('b25 values', dict(b25)); print('relative-level mons', list(rel)[:20], len(rel)); print('HC mons with EVs in record:', evs_nonzero)
