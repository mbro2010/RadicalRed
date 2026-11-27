"""Run Radical Red's own code in a CPU emulator (Unicorn, pip install unicorn): build trainer parties with the game's
party builder and read what it made. ROM path: RR_ROM (or the first argument)."""
import sys, struct
import os
if os.environ.get('RR_PYLIB'): sys.path.insert(0, os.environ['RR_PYLIB'])   # where unicorn is installed, if not on the path
from unicorn import Uc, UC_ARCH_ARM, UC_MODE_THUMB, UC_HOOK_INTR, UC_HOOK_MEM_UNMAPPED, UcError
from unicorn.arm_const import UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3, UC_ARM_REG_SP, UC_ARM_REG_LR, UC_ARM_REG_PC
ROMP = os.environ.get("RR_ROM") or (sys.argv[1] if len(sys.argv) > 1 else "")
ROM = open(ROMP, "rb").read() if ROMP else b""
# FireRed 1.0 addresses (pokefirered) and the ones in NOTES.md
CREATE_MON, GET_MON_DATA, SET_MON_DATA, FLAG_SET, FLAG_GET = 0x0803DA54, 0x0803FBE8, 0x0804037C, 0x0806E680, 0x0806E6D0
GET_MON_ABILITY, PARTY_BUILDER, ZERO_ENEMY = 0x08040D38, 0x0907B624, 0x0803DA34
G_PLAYER_PARTY, G_PLAYER_COUNT, G_ENEMY_PARTY, G_ENEMY_COUNT = 0x02024284, 0x02024029, 0x0202402C, 0x02024028
SB1_PTR, SB2_PTR, SB1, SB2, RNG = 0x03005008, 0x0300500C, 0x0202552C, 0x02024588, 0x03005000
OPPONENT_A, BATTLE_TYPE = 0x020386AE, 0x02022B4C
R = [UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3]
def s32(v): return v - (1 << 32) if v & 0x80000000 else v

class GBA:
    RET = 0x03007E00
    def __init__(self, seed=0x1234):
        mu = Uc(UC_ARCH_ARM, UC_MODE_THUMB)
        for base, size in [(0, 0x4000), (0x02000000, 0x40000), (0x03000000, 0x8000), (0x04000000, 0x1000), (0x05000000, 0x1000),
                           (0x06000000, 0x18000), (0x07000000, 0x1000), (0x08000000, 0x2000000)]:
            mu.mem_map(base, size)
        mu.mem_write(0x08000000, ROM)
        mu.mem_write(self.RET, b'\xfe\xe7')          # b . (we stop here)
        mu.hook_add(UC_HOOK_INTR, self._intr)
        mu.hook_add(UC_HOOK_MEM_UNMAPPED, self._unmapped)
        self.mu = mu
        self.w32(SB1_PTR, SB1); self.w32(SB2_PTR, SB2)
        self.w32(SB2 + 0x0A, 0x2A5E1B07)               # the player's trainer ID
        self.w32(RNG, seed)
        self.w32(BATTLE_TYPE, 0x8)                      # a trainer battle
        self.mu.mem_write(SB1 + 0x3A4C, bytes([0xCE, 0xBF, 0xCC, 0xCC, 0xD3, 0xFF]))   # the rival's name, TERRY
        self.mu.mem_write(SB2, bytes([0xCA, 0xC6, 0xBB, 0xD3, 0xBF, 0xCC, 0xFF]))      # the player's name
    # memory helpers
    def w32(self, a, v): self.mu.mem_write(a, struct.pack('<I', v & 0xFFFFFFFF))
    def w16(self, a, v): self.mu.mem_write(a, struct.pack('<H', v & 0xFFFF))
    def w8(self, a, v): self.mu.mem_write(a, bytes([v & 0xFF]))
    def r32(self, a): return struct.unpack('<I', bytes(self.mu.mem_read(a, 4)))[0]
    def r16(self, a): return struct.unpack('<H', bytes(self.mu.mem_read(a, 2)))[0]
    def r8(self, a): return self.mu.mem_read(a, 1)[0]
    def _unmapped(self, mu, access, addr, size, value, user):
        print(f'unmapped access {access} at {addr:#x} pc={mu.reg_read(UC_ARM_REG_PC):#x}')
        return False
    def _intr(self, mu, intno, user):
        if intno != 2:
            raise RuntimeError(f'interrupt {intno}')
        pc = mu.reg_read(UC_ARM_REG_PC)
        ins = self.r16(pc - 2)
        n = ins & 0xFF if (ins >> 8) == 0xDF else self.r16(pc) & 0xFF
        r0, r1, r2 = (mu.reg_read(x) for x in R[:3])
        if n in (6, 7):                                  # Div / DivArm
            num, den = (s32(r0), s32(r1)) if n == 6 else (s32(r1), s32(r0))
            q = int(num / den) if den else 0
            rem = num - q * den
            mu.reg_write(UC_ARM_REG_R0, q & 0xFFFFFFFF); mu.reg_write(UC_ARM_REG_R1, rem & 0xFFFFFFFF); mu.reg_write(UC_ARM_REG_R3, abs(q))
        elif n == 8:                                     # Sqrt
            mu.reg_write(UC_ARM_REG_R0, int(r0 ** 0.5))
        elif n == 0x0B:                                  # CpuSet
            cnt, fill, wide = r2 & 0x1FFFFF, (r2 >> 24) & 1, (r2 >> 26) & 1
            unit = 4 if wide else 2
            if fill:
                v = bytes(mu.mem_read(r0, unit)); mu.mem_write(r1, v * cnt)
            else:
                mu.mem_write(r1, bytes(mu.mem_read(r0, cnt * unit)))
        elif n == 0x0C:                                  # CpuFastSet
            cnt, fill = r2 & 0x1FFFFF, (r2 >> 24) & 1
            cnt = (cnt + 7) & ~7
            if fill:
                v = bytes(mu.mem_read(r0, 4)); mu.mem_write(r1, v * cnt)
            else:
                mu.mem_write(r1, bytes(mu.mem_read(r0, cnt * 4)))
        elif n in (0x01, 0x02, 0x04, 0x05):
            pass
        else:
            raise RuntimeError(f'unhandled SWI {n:#x} at {pc:#x}')
    def call(self, addr, *args, stack=()):
        mu = self.mu
        sp = 0x03007C00
        for i, v in enumerate(stack): self.w32(sp + 4 * i, v)
        mu.reg_write(UC_ARM_REG_SP, sp)
        for reg, v in zip(R, args): mu.reg_write(reg, v & 0xFFFFFFFF)
        mu.reg_write(UC_ARM_REG_LR, self.RET | 1)
        mu.emu_start(addr | 1, self.RET, count=20_000_000)
        return mu.reg_read(UC_ARM_REG_R0)
    # game helpers
    def flag_set(self, f): self.call(FLAG_SET, f)
    def flag_get(self, f): return self.call(FLAG_GET, f) & 0xFF
    def mon_data(self, mon, field): return self.call(GET_MON_DATA, mon, field, 0)
    def ability(self, mon): return self.call(GET_MON_ABILITY, mon) & 0xFF
    def set_player_party(self, species, level):
        self.mu.mem_write(G_PLAYER_PARTY, bytes(600))
        self.call(CREATE_MON, G_PLAYER_PARTY, species, level, 31, stack=(0, 0, 0, 0))
        self.w8(G_PLAYER_COUNT, 1)
    def build(self, trainer_id):
        self.mu.mem_write(G_ENEMY_PARTY, bytes(600))
        self.w16(OPPONENT_A, trainer_id)
        n = self.call(PARTY_BUILDER, G_ENEMY_PARTY, trainer_id, 1, 1) & 0xFF
        out = []
        for k in range(6):
            mon = G_ENEMY_PARTY + 100 * k
            sp = self.mon_data(mon, 0x0B) & 0xFFFF
            if not sp: continue
            pers = self.mon_data(mon, 0x00)
            out.append({
                'species': sp, 'item': self.mon_data(mon, 0x0C) & 0xFFFF,
                'moves': [self.mon_data(mon, 0x0D + i) & 0xFFFF for i in range(4)],
                'ev': [self.mon_data(mon, 0x1A + i) & 0xFF for i in range(6)],          # HP Atk Def Spe SpA SpD
                'iv': [self.mon_data(mon, 0x27 + i) & 0x1F for i in range(6)],          # HP Atk Def Spe SpA SpD
                'personality': pers, 'nature': pers % 25, 'ability': self.ability(mon),
                'level': self.r8(mon + 0x54),
                'stats': [self.r16(mon + 0x58)] + [self.r16(mon + 0x5A + 2 * i) for i in range(5)],   # HP Atk Def Spe SpA SpD
                'status': self.r32(mon + 0x50),
            })
        return n, out

ABILITY_NAMES = 0x10E32C0
CH = {0x00: ' '}
for i in range(26): CH[0xBB + i] = chr(65 + i); CH[0xD5 + i] = chr(97 + i)
for i in range(10): CH[0xA1 + i] = chr(48 + i)
CH.update({0xAB: '!', 0xAC: '?', 0xAD: '.', 0xAE: '-', 0xB4: "'", 0xB8: ',', 0xBA: '/', 0x1B: 'é'})
def text(off, n):
    s = []
    for b in ROM[off:off + n]:
        if b == 0xFF: break
        s.append(CH.get(b, '{%02X}' % b))
    return ''.join(s)
def ability_name(i): return text(ABILITY_NAMES + 17 * i, 17)
