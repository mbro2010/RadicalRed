"""Turn the extracted JSON into the compact dataset the boss page reads.

usage: python3 tools/build_data.py data page/bosses.json
"""
import json, sys, os
D = sys.argv[1]; OUT = sys.argv[2]
species = json.load(open(f'{D}/species.json'))
moves = json.load(open(f'{D}/moves.json'))
trainers = {t['id']: t for t in json.load(open(f'{D}/trainers.json'))}
order = json.load(open(f'{D}/hardcore_order.json'))
caps = json.load(open(f'{D}/level_caps.json'))
natures = json.load(open(f'{D}/natures.json'))
sp_by_name = {}
for s in species: sp_by_name.setdefault(s['name'], s)
mv_by_id = {m['id']: m for m in moves}
HC = caps['hardcore']

# Trainers whose win advances the level cap (flag found in the battle script, except the two marked inferred)
MILESTONE_AFTER = {414: 'Boulder Badge', 46: 'Archer (flag 0x201)', 415: 'Cascade Badge', 416: 'Thunder Badge',
                   417: 'Rainbow Badge', 348: 'Giovanni, Rocket Hideout (inferred)', 53: 'Archer (flag 0x955)',
                   349: 'Giovanni, Silph Co. (inferred)', 420: 'Marsh Badge', 418: 'Soul Badge', 61: 'May (flag 0x998)',
                   419: 'Volcano Badge', 68: 'Ariana (flag 0x981)', 69: 'Giovanni (flag 0x982)', 74: 'Earth Badge',
                   26: 'Brendan (flag 0x991)'}
HP_TYPES = ['Fighting','Flying','Poison','Ground','Rock','Bug','Ghost','Steel','Fire','Water','Grass','Electric','Psychic','Ice','Dragon','Dark']

def hp_type(iv):
    bits = [iv['hp'] & 1, iv['atk'] & 1, iv['def'] & 1, iv['spe'] & 1, iv['spa'] & 1, iv['spd'] & 1]
    return HP_TYPES[(sum(b << i for i, b in enumerate(bits)) * 15) // 63]

def calc_stats(sp, level, iv, nature_id):
    nat = natures[nature_id]
    out = {}
    for k in ('hp', 'atk', 'def', 'spa', 'spd', 'spe'):
        b = sp['base'][k]
        if k == 'hp':
            out[k] = 1 if sp['name'] == 'Shedinja' else (2*b + iv[k]) * level // 100 + level + 10
        else:
            v = (2*b + iv[k]) * level // 100 + 5
            if nat['up'] == k: v = v * 110 // 100
            if nat['down'] == k: v = v * 90 // 100
            out[k] = v
    return out

STATUS = {0: None, 8: 'Poisoned', 16: 'Burned', 32: 'Frozen', 64: 'Paralyzed', 128: 'Badly poisoned'}

def mon_entry(m, cap):
    sp = species[m['speciesId']]
    rel = m.get('relativeToPlayerMax')
    lvl = m['level'] if rel is None else max(1, cap + rel)
    iv = m['ivs']
    nat = natures[m['natureId']]
    ability = m['ability']
    if m['abilitySlot'].startswith('slot1 (no hidden') and sp['abilities'][1]:
        ability = f"{sp['abilities'][0]} or {sp['abilities'][1]}"
    mvs = []
    for mid in m['moveIds']:
        mv = mv_by_id[mid]
        t = mv['type']
        name = mv['name']
        if name == 'Hidden Power':
            t = hp_type(iv)
        mvs.append({'n': name, 't': t, 'c': {'physical':'p','special':'sp','status':'st'}[mv['category']], 'p': mv['power'], 'a': mv['accuracy'], 'pr': mv['priority']})
    e = {'sp': m['species'], 'ty': sp['types'], 'lv': lvl, 'rel': rel, 'ab': ability, 'it': m['item'],
         'alt': sp_by_name[m['species']]['id'] != m['speciesId'],
         'na': nat['name'], 'up': nat['up'], 'dn': nat['down'], 'mv': mvs,
         'st': calc_stats(sp, lvl, iv, m['natureId']), 'base': sp['base']}
    if any(v != 31 for v in iv.values()):
        e['iv'] = [iv[k] for k in ('hp', 'atk', 'def', 'spa', 'spd', 'spe')]
    st = STATUS.get(m['raw']['b27'])
    if st: e['status'] = st
    return e

def category(t):
    c, n = t['class'], t['name']
    if c in ('Leader',): return 'gym'
    if c in ('Rival', 'Champion') or n == 'Terry': return 'rival'
    if c in ('Elite Four',): return 'e4'
    if c in ('Boss', 'Rocket Admin', 'Team Rocket'): return 'rocket'
    return 'other'

bosses = []
milestones_done = 0
for i, tid in enumerate(order):
    t = trainers[tid]
    ov = [p for p in t['hardcoreOverride'] if p['order'] == i][0]
    cap = HC[milestones_done]
    party = [mon_entry(m, cap) for m in ov['party']]
    entry = {'i': i, 'id': tid, 'name': t['name'], 'cls': t['class'], 'cat': category(t), 'dbl': ov['double'],
             'cap': cap, 'party': party}
    if tid in MILESTONE_AFTER:
        entry['ms'] = MILESTONE_AFTER[tid]
        entry['capAfter'] = HC[milestones_done + 1]
        milestones_done += 1
    bosses.append(entry)

# Rival variants: tag each Terry team with its final Pokemon so the player can tell them apart
for b in bosses:
    if b['cat'] == 'rival':
        b['variant'] = b['party'][-1]['sp']

payload = {'version': 'Radical Red 4.1', 'mode': 'Hardcore', 'bosses': bosses,
           'caps': {'hardcore': HC, 'normal': caps['normal']}}
if os.path.exists(f'{D}/restrictions.json'):
    payload['restrictions'] = json.load(open(f'{D}/restrictions.json'))
with open(OUT, 'w') as f:
    json.dump(payload, f, ensure_ascii=False, separators=(',', ':'))
print('bosses', len(bosses), 'milestones counted', milestones_done, 'bytes', os.path.getsize(OUT))
