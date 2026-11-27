"""Radical Red's own damage numbers, from the game's code running in a CPU emulator (see gba_emu.py).

Each case puts two battlers into the game's battle memory (gBattleMons) and runs the battle script commands the
game uses for an attack: atk05 damagecalc, atk06 typecalc, then atk07 (the random roll) once for each of the 16
rolls. Input is a JSON list of cases (made by tools/damage_cases.js); output adds "game": [16 rolls] to each, plus
"flags" (the game's move result flags: 1 missed, 2 super effective, 4 not very effective, 8 no effect).

  RR_ROM=... RR_PYLIB=... python3 -I tools/game_damage.py cases.json out.json

A case:  { atk: BATTLER, def: BATTLER, move: id, crit: bool, weather: 'rain'|'sun'|'sand'|'hail'|'',
           terrain: 'electric'|'grassy'|'misty'|'psychic'|'', reflect: bool, lightScreen: bool }
BATTLER: { species: id, level, stats: [hp, atk, def, spe, spa, spd], hp, types: [t1, t2], ability: id, item: id,
           status1, stages: {atk, def, spa, spd, spe}, personality }
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gba_emu import GBA

# Radical Red 4.1 addresses (battle script command table at 0x0903EF20; RAM names from pokefirered)
ATK05_DAMAGECALC, ATK06_TYPECALC, ATK07_ADJUSTDAMAGE = 0x09087430, 0x09082A48, 0x09083E86
BATTLE_RANDOM_STATE = 0x020386D0                # the LCG (0x0808322C) ApplyRandomDmgMultiplier calls: s' = s*0x41C64E6D + 0x3039
LCG_INV = pow(0x41C64E6D, -1, 1 << 32)
G_BATTLE_MONS, G_BATTLERS_COUNT, G_BATTLER_PARTY_INDEXES, G_BATTLER_POSITIONS = 0x02023BE4, 0x02023BCC, 0x02023BCE, 0x02023BD6
G_CURRENT_MOVE, G_CHOSEN_MOVE, G_BATTLE_MOVE_DAMAGE = 0x02023D4A, 0x02023D4C, 0x02023D50
G_BANK_ATTACKER, G_BANK_TARGET, G_CRIT_MULTIPLIER, G_SCRIPT_PTR = 0x02023D6B, 0x02023D6C, 0x02023D71, 0x02023D74
G_MOVE_RESULT_FLAGS, G_SIDE_STATUSES, G_STATUSES3, G_DISABLE_STRUCTS = 0x02023DCC, 0x02023DDE, 0x02023DFC, 0x02023E0C
G_BATTLE_WEATHER, G_BATTLE_STRUCT_PTR, G_NEW_BS_PTR, G_TERRAIN = 0x02023F1C, 0x02023FE8, 0x0203E038, 0x0203E028
BATTLE_TYPE = 0x02022B4C
NEW_BS, BATTLE_STRUCT, SCRIPT = 0x02010000, 0x02014000, 0x02016000   # zeroed blocks in the (unused) heap
NEW_BS_CRIT_MULT = 0x15C                         # gNewBS->criticalMultiplier[bank], tenths (10 = no crit, 15 = crit)
NEW_BS_RESULT_FLAGS = 0x160                      # gNewBS->ResultFlags[bank]: 2 super effective, 4 not very, 8 no effect
WEATHER = {'': 0, 'rain': 0x1, 'sand': 0x8, 'sun': 0x20, 'hail': 0x80}
TERRAIN = {'': 0, 'electric': 1, 'grassy': 2, 'misty': 3, 'psychic': 4}
TYPE_BLANK = 0x14

class DamageOracle(GBA):
    def __init__(self):
        super().__init__()
        self.clean = (bytes(self.mu.mem_read(0x02000000, 0x40000)), bytes(self.mu.mem_read(0x03000000, 0x8000)))

    def reset(self):
        self.mu.mem_write(0x02000000, self.clean[0]); self.mu.mem_write(0x03000000, self.clean[1])

    def battler(self, bank, b):
        base = G_BATTLE_MONS + 0x58 * bank
        st = b['stats']
        mon = bytearray(0x58)
        def p16(o, v): mon[o:o + 2] = (v & 0xFFFF).to_bytes(2, 'little')
        def p32(o, v): mon[o:o + 4] = (v & 0xFFFFFFFF).to_bytes(4, 'little')
        p16(0x00, b['species'])
        p16(0x02, st[1]); p16(0x04, st[2]); p16(0x06, st[3]); p16(0x08, st[4]); p16(0x0A, st[5])
        p32(0x14, 0x3FFFFFFF)                                   # 31 IVs (Hidden Power reads them)
        stages = b.get('stages') or {}
        mon[0x18] = TYPE_BLANK                                   # CFRU keeps a third type where the HP stage was
        for i, k in enumerate(['atk', 'def', 'spe', 'spa', 'spd', 'acc', 'eva']):
            mon[0x19 + i] = 6 + int(stages.get(k, 0))
        mon[0x20] = b.get('ability', 0)
        t = b['types']
        mon[0x21], mon[0x22] = t[0], t[1] if len(t) > 1 else t[0]
        for i in range(4): mon[0x24 + i] = 10
        p16(0x28, b.get('hp', st[0])); mon[0x2A] = b['level']; mon[0x2B] = b.get('friendship', 255); p16(0x2C, st[0])
        p16(0x2E, b.get('item', 0))
        p32(0x48, b.get('personality', 0)); p32(0x4C, b.get('status1', 0))
        self.mu.mem_write(base, bytes(mon))

    def rolls(self, case):
        self.reset()
        self.w32(G_NEW_BS_PTR, NEW_BS); self.w32(G_BATTLE_STRUCT_PTR, BATTLE_STRUCT)
        self.w32(BATTLE_TYPE, 0x8)                               # a single trainer battle
        self.w8(G_BATTLERS_COUNT, 2)
        for i in range(2):
            self.w16(G_BATTLER_PARTY_INDEXES + 2 * i, 0); self.w8(G_BATTLER_POSITIONS + i, i)
        for party, b in ((0x02024284, case['atk']), (0x0202402C, case['def'])):
            self.call(0x0803DA54, party, b['species'], b['level'], 31, stack=(0, 0, 0, 0))   # CreateMon
        self.battler(0, case['atk']); self.battler(1, case['def'])
        self.w8(G_BANK_ATTACKER, 0); self.w8(G_BANK_TARGET, 1)
        self.w16(G_CURRENT_MOVE, case['move']); self.w16(G_CHOSEN_MOVE, case['move'])
        self.w16(G_BATTLE_WEATHER, WEATHER[case.get('weather') or ''])
        self.w8(G_TERRAIN, TERRAIN[case.get('terrain') or ''])
        self.w16(G_SIDE_STATUSES + 2, (1 if case.get('reflect') else 0) | (2 if case.get('lightScreen') else 0))
        for bank in range(2): self.w8(NEW_BS + NEW_BS_CRIT_MULT + bank, 15 if case.get('crit') else 10)
        for bank, b in ((0, case['atk']), (1, case['def'])):          # Protosynthesis / Quark Drive: the stat it raised (1 Atk .. 5 Sp. Def)
            if b.get('qp'): self.w8(NEW_BS + 0x19 + bank, b['qp'])
        self.w8(G_DISABLE_STRUCTS + 0x1C * 0 + 0x16, 1 if case.get('firstTurn') else 0)
        self.mu.mem_write(SCRIPT, bytes([0x05, 0x06, 0x07, 0x00] * 4))
        self.w32(G_SCRIPT_PTR, SCRIPT)
        self.w8(G_MOVE_RESULT_FLAGS, 0)
        self.call(ATK05_DAMAGECALC)
        self.call(ATK06_TYPECALC)
        before, flags = self.r32(G_BATTLE_MOVE_DAMAGE), self.r8(NEW_BS + NEW_BS_RESULT_FLAGS + 1)
        out = []
        for r in range(16):                                      # the game rolls 100 - (Random() & 15) percent
            want = (15 - r) << 16                                # the LCG's next state, so Random() & 15 == 15 - r
            self.w32(BATTLE_RANDOM_STATE, ((want - 0x3039) * LCG_INV) & 0xFFFFFFFF)
            self.w32(G_BATTLE_MOVE_DAMAGE, before)
            self.w32(G_SCRIPT_PTR, SCRIPT + 2)
            self.call(ATK07_ADJUSTDAMAGE)
            out.append(self.r32(G_BATTLE_MOVE_DAMAGE))
        return out, flags

if __name__ == '__main__':
    src, dst = sys.argv[-2], sys.argv[-1]
    cases = json.load(open(src))
    g = DamageOracle()
    for i, c in enumerate(cases):
        try:
            c['game'], c['flags'] = g.rolls(c)
        except Exception as e:                                   # keep going; the comparison reports these
            c['game'], c['error'] = None, str(e)
        if i % 500 == 499: print(i + 1, 'cases', flush=True)
    json.dump(cases, open(dst, 'w'))
    print('done', len(cases), 'errors', sum(1 for c in cases if c.get('error')))
