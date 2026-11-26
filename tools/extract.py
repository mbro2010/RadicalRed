"""Extract Radical Red 4.1 game data straight from the ROM into JSON.

Every address below was located and verified by reading the ROM's own code
(see notes in the session); nothing here comes from online sources.
"""
import sys, json, os
sys.path.insert(0, os.path.dirname(__file__))
from rom import rom, s, u8, u16, u32, isptr

OUT = sys.argv[1] if len(sys.argv) > 1 else 'data'
os.makedirs(OUT, exist_ok=True)

# ---- table addresses (ROM offsets) ----
SPECIES_NAMES, N_SPECIES = 0x14042CC, 1376     # 11-byte names
BASE_STATS = 0x17B98EC                          # 28-byte entries
MOVE_NAMES, N_MOVES = 0x10F3188, 1004           # 13-byte names
MOVE_DATA = 0x11521D0                           # 12-byte entries
ABILITY_NAMES, N_ABILITIES = 0x10E32C0, 282     # 17-byte names
ITEMS = 0x13C0000                               # 44-byte entries
TRAINERS, N_TRAINERS = 0x23EAC8, 743            # 40-byte vanilla struct Trainer
TRAINER_CLASS_NAMES = 0x23E558                  # 13-byte names
NATURE_NAME_PTRS = 0x463E60                     # 25 pointers
SPREADS = 0x112533C                             # 11-byte EV/IV/nature spreads (regular trainers)
CLASS_IVS = 0x1124F08                           # fixed IV per trainer class (regular trainers)
HARDCORE_TEAMS, N_HARDCORE = 0x112C9B4, 0x99    # 60-byte boss records, used when flag 0x1034 (Hardcore) set
NORMAL_TEAMS, N_NORMAL = 0x1126340, 0x6C        # 60-byte boss records used outside Hardcore (and by the battle simulator on Normal)
ALWAYS_TEAMS, N_ALWAYS = 0x11259DC, 0x28        # 60-byte records used in every mode
LEVEL_CAPS_NORMAL, LEVEL_CAPS_HARDCORE = 0x135013C, 0x135014E  # 18 bytes each

TYPES = {0:'Normal',1:'Fighting',2:'Flying',3:'Poison',4:'Ground',5:'Rock',6:'Bug',7:'Ghost',8:'Steel',
         9:'???',10:'Fire',11:'Water',12:'Grass',13:'Electric',14:'Psychic',15:'Ice',16:'Dragon',17:'Dark',23:'Fairy'}
STATS = ['hp','atk','def','spe','spa','spd']
SPLIT = {0:'physical',1:'special',2:'status'}
HP_TYPES = ['Fighting','Flying','Poison','Ground','Rock','Bug','Ghost','Steel','Fire','Water','Grass','Electric','Psychic','Ice','Dragon','Dark']

def name_at(base, stride, i):
    return s(base + i*stride, stride).replace('\n', ' ')

species_name = [name_at(SPECIES_NAMES, 11, i) for i in range(N_SPECIES)]
move_name = [name_at(MOVE_NAMES, 13, i) for i in range(N_MOVES)]
ability_name = [name_at(ABILITY_NAMES, 17, i) for i in range(N_ABILITIES)]
def item_name(i): return s(ITEMS + i*44, 14) if i else None
nature_name = [s(u32(NATURE_NAME_PTRS + 4*i) - 0x08000000, 12) for i in range(25)]
# nature effects (standard Gen 3+ layout: up = id//5, down = id%5 over atk,def,spe,spa,spd)
NAT_STATS = ['atk','def','spe','spa','spd']
def nature_info(n):
    up, down = NAT_STATS[n//5], NAT_STATS[n%5]
    return {'id': n, 'name': nature_name[n], 'up': None if up == down else up, 'down': None if up == down else down}

# ---- species ----
species = []
for i in range(N_SPECIES):
    o = BASE_STATS + i*28
    b = rom[o:o+28]
    species.append({
        'id': i, 'name': species_name[i],
        'base': dict(zip(STATS, b[0:6])),
        'types': sorted(set([TYPES.get(b[6], f'#{b[6]}'), TYPES.get(b[7], f'#{b[7]}')]), key=lambda t: (t != TYPES.get(b[6]), t)),
        'abilities': [ability_name[b[22]] if b[22] else None, ability_name[b[23]] if b[23] else None],
        'hiddenAbility': ability_name[b[26]] if b[26] else None,
        'catchRate': b[8], 'genderRatio': b[16], 'growthRate': b[19],
    })

# ---- moves ----
moves = []
for i in range(N_MOVES):
    o = MOVE_DATA + i*12
    b = rom[o:o+12]
    moves.append({'id': i, 'name': move_name[i], 'effect': b[0], 'power': b[1], 'type': TYPES.get(b[2], f'#{b[2]}'),
                  'accuracy': b[3], 'pp': b[4], 'effectChance': b[5], 'target': b[6],
                  'priority': b[7] - 256 if b[7] > 127 else b[7], 'flags': b[8], 'zPower': b[9], 'category': SPLIT.get(b[10], b[10])})

# ---- level caps ----
level_caps = {
    'normal': list(rom[LEVEL_CAPS_NORMAL:LEVEL_CAPS_NORMAL+18]),
    'hardcore': list(rom[LEVEL_CAPS_HARDCORE:LEVEL_CAPS_HARDCORE+18]),
    'note': 'Cap index = number of milestone flags set (16 milestones); after the game is cleared (flag 0x82C) index 17 = 100.',
    'milestones': [  # flag -> event, found by matching setflag commands to the trainer battle right before them
        {'flag': '0x820', 'event': 'Boulder Badge (Brock)'}, {'flag': '0x201', 'event': 'Beat Archer (trainer 46)'},
        {'flag': '0x821', 'event': 'Cascade Badge (Misty)'}, {'flag': '0x822', 'event': 'Thunder Badge (Lt. Surge)'},
        {'flag': '0x823', 'event': 'Rainbow Badge (Erika)'}, {'flag': '0x38', 'event': 'story flag 0x38 (not yet identified)'},
        {'flag': '0x955', 'event': 'Beat Archer (trainer 53)'}, {'flag': '0x53', 'event': 'story flag 0x53 (not yet identified)'},
        {'flag': '0x824', 'event': 'Soul Badge (Koga)'}, {'flag': '0x825', 'event': 'Marsh Badge (Sabrina)'},
        {'flag': '0x998', 'event': 'Beat May (trainer 61)'}, {'flag': '0x826', 'event': 'Volcano Badge (Blaine)'},
        {'flag': '0x981', 'event': 'Beat Ariana / Giovanni (trainers 68/69)'}, {'flag': '0x982', 'event': 'Beat Giovanni (trainer 69)'},
        {'flag': '0x827', 'event': 'Earth Badge (Giovanni)'}, {'flag': '0x991', 'event': 'Beat Brendan (trainer 26)'},
    ],
}

# ---- trainers ----
def trainer_header(tid):
    o = TRAINERS + tid*40
    return {'id': tid, 'name': s(o+4, 12), 'classId': u8(o+1), 'class': name_at(TRAINER_CLASS_NAMES, 13, u8(o+1)),
            'partyFlags': u8(o), 'double': bool(u32(o+24)), 'aiFlags': u32(o+28), 'partySize': u32(o+32),
            'partyPtr': u32(o+36) - 0x08000000, 'items': [item_name(u16(o+16+2*k)) for k in range(4) if u16(o+16+2*k)]}

def ivs_unpack(w):
    # packed like the Gen 3 IV word: hp, atk, def, spe, spa, spd (5 bits each)
    return {'hp': w & 31, 'atk': (w>>5)&31, 'def': (w>>10)&31, 'spe': (w>>15)&31, 'spa': (w>>20)&31, 'spd': (w>>25)&31}

def ability_for(species_id, slot):
    sp = species[species_id]
    if slot == 'hidden':
        return sp['hiddenAbility'] or sp['abilities'][0], ('hidden' if sp['hiddenAbility'] else 'slot1 (no hidden ability)')
    if slot == 1 and sp['abilities'][1]:
        return sp['abilities'][1], 'slot2'
    return sp['abilities'][0], 'slot1'

def level_info(lv):
    rel = {101: -2, 102: -1, 103: 0, 104: -3}
    if lv in rel:
        return {'level': None, 'relativeToPlayerMax': rel[lv]}
    return {'level': lv}

def decode_record_party(ptr, size):
    """28-byte boss Pokemon records (decoded from the builder at 0x09078C48)"""
    mons = []
    for k in range(size):
        o = ptr + k*28
        spc, nature, ball, ivw = u16(o), u8(o+2), u8(o+3), u32(o+4)
        evs = dict(zip(STATS, rom[o+8:o+14]))
        item = u16(o+14)
        mv = [u16(o+16+2*j) for j in range(4)]
        flags25 = u8(o+25)
        absel = (flags25 >> 4) & 3   # 0 -> hidden ability, 1 -> slot 1, 2/3 -> slot 2
        ab, abslot = ability_for(spc, 'hidden' if absel == 0 else (0 if absel == 1 else 1))
        m = {'species': species_name[spc], 'speciesId': spc, 'nature': nature_name[nature], 'natureId': nature,
             'item': item_name(item), 'itemId': item or None, 'moves': [move_name[x] for x in mv if x], 'moveIds': [x for x in mv if x],
             'ability': ab, 'abilitySlot': abslot, 'ivs': ivs_unpack(ivw), 'evsInRecord': evs,
             'shiny': bool(flags25 & 1), 'raw': {'b24': u8(o+24), 'b25': flags25, 'b27': u8(o+27)}}
        m.update(level_info(u8(o+26)))
        mons.append(m)
    return mons

def decode_override_table(base, n):
    out = {}
    for i in range(n):
        o = base + i*0x3C
        tid = u32(o+8)
        out.setdefault(tid, []).append({'order': i, 'double': bool(u8(o+3)), 'partySize': u16(o+0x2C),
                                        'party': decode_record_party(u32(o+0x10) - 0x08000000, u16(o+0x2C))})
    return out

def decode_spread(idx):
    o = SPREADS + idx*11
    b = rom[o:o+11]
    hp = b[1]
    return {'spread': idx, 'nature': nature_name[b[0]] if b[0] < 25 else None, 'natureId': b[0],
            'hiddenPowerTypeCode': hp, 'iv': b[2], 'evs': dict(zip(STATS, b[3:9])), 'ball': b[9], 'abilitySelector': b[10]}

def decode_vanilla_party(t):
    flags, ptr, size = t['partyFlags'], t['partyPtr'], t['partySize']
    stride = 16 if flags & 1 else 8
    civ = u8(CLASS_IVS + t['classId'])
    mons = []
    for k in range(size):
        o = ptr + k*stride
        ivf, lvl, spc = u16(o), u16(o+2), u16(o+4)
        m = {'species': species_name[spc], 'speciesId': spc}
        m.update(level_info(lvl))
        if flags & 2:
            it = u16(o+6); m['item'] = item_name(it)
        if flags & 1:
            mv = [u16(o+8+2*j) for j in range(4)] if flags & 2 else [u16(o+6+2*j) for j in range(4)]
            m['moves'] = [move_name[x] for x in mv if x]; m['moveIds'] = [x for x in mv if x]
        else:
            m['moves'] = None  # default level-up moves (filled in later from learnsets)
        if flags == 3 and t['aiFlags'] > 1 and 1 <= (ivf & 0xFF) <= 0x99:
            sp = decode_spread(ivf & 0xFF)
            m['spread'] = sp
            m['nature'] = sp['nature']
            sel = sp['abilitySelector']
            if sel == 0: m['ability'], m['abilitySlot'] = ability_for(spc, 'hidden')
            elif sel in (1, 2): m['ability'], m['abilitySlot'] = ability_for(spc, 0 if sel == 1 else 1)
            elif sel == 3: m['ability'], m['abilitySlot'] = 'random (slot 1 or 2)', 'random'
            elif sel == 4: m['ability'], m['abilitySlot'] = 'random (1/3 hidden)', 'random'
            m['ivs'] = 'spread' if sp['hiddenPowerTypeCode'] else {k: min(31, sp['iv']) for k in STATS}
        else:
            fixed = civ if civ else 10
            m['ivs'] = {k: fixed for k in STATS}
            m['nature'] = None  # derived from a fixed personality value; not decoded yet
        mons.append(m)
    return mons

hardcore = decode_override_table(HARDCORE_TEAMS, N_HARDCORE)
normal = decode_override_table(NORMAL_TEAMS, N_NORMAL)
always = decode_override_table(ALWAYS_TEAMS, N_ALWAYS)

trainers = []
for tid in range(N_TRAINERS):
    t = trainer_header(tid)
    if not isptr(t['partyPtr'] + 0x08000000) or t['partySize'] == 0:
        continue
    entry = {k: v for k, v in t.items() if k not in ('partyPtr',)}
    entry['party'] = decode_vanilla_party(t)
    if tid in always: entry['alwaysOverride'] = always[tid]
    if tid in hardcore: entry['hardcoreOverride'] = hardcore[tid]
    if tid in normal: entry['normalOverride'] = normal[tid]
    trainers.append(entry)

hardcore_order = []
for i in range(N_HARDCORE):
    o = HARDCORE_TEAMS + i*0x3C
    hardcore_order.append(u32(o+8))

def dump(name, obj):
    with open(os.path.join(OUT, name), 'w') as f:
        json.dump(obj, f, indent=1, ensure_ascii=False)

dump('species.json', species)
dump('moves.json', moves)
dump('abilities.json', ability_name)
dump('natures.json', [nature_info(n) for n in range(25)])
dump('trainers.json', trainers)
dump('hardcore_order.json', hardcore_order)
dump('level_caps.json', level_caps)
print('species', len(species), 'moves', len(moves), 'abilities', len(ability_name), 'trainers', len(trainers),
      'hardcore overrides', len(hardcore), 'normal overrides', len(normal), 'always overrides', len(always))
