"""Disassemble the game's battle scripts: the per-effect scripts every move runs (gBattleScriptsForMoveEffects) and
anything they jump to, with the command set read from CFRU's battle_script_macros.s.

Radical Red runs on CFRU, whose move effects are battle scripts: a move's effect number picks a script, and the script
decides what the move does, including the special cases for single moves (jumpifmove MOVE_X ...). Reading the game's
own scripts says exactly what each move does in Radical Red, where its changes differ from CFRU's published source.

usage: python3 tools/battle_scripts.py CFRU_DIR [effect ...]      print the scripts (all effects, or the ones given)
       python3 tools/battle_scripts.py CFRU_DIR --moves OUT.json  per effect: which moves its script singles out
"""
import json, os, re, struct, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rom import rom, u8, u16, u32, isptr

CF = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', '..', 'skeli789', 'complete-fire-red-upgrade')
DATA = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app', 'rrdata.json')))
MOVE = {m['i']: m.get('f') or m['n'] for m in DATA['moves']}
ABIL = {}
for i, a in enumerate(DATA.get('abilities') or []):
    if isinstance(a, dict): ABIL[a.get('i', i)] = a.get('n')
    else: ABIL[i] = a
ITEM = {int(k): (v.get('n') if isinstance(v, dict) else v) for k, v in (DATA.get('items') or {}).items()}

# ---- symbols: .equ constants and the linker's RAM/ROM symbols ----
SYM = {}
def num(s):
    s = s.strip()
    try: return int(s, 0)
    except ValueError: return None
for f in ('asm_defines.s', 'battle_script_macros.s'):
    for line in open(os.path.join(CF, f), errors='replace'):
        m = re.match(r'\s*\.equ\s+(\w+)\s*,\s*(.+?)\s*(@.*)?$', line)
        if m: SYM[m.group(1)] = m.group(2).strip()
for line in open(os.path.join(CF, 'BPRE.ld'), errors='replace'):
    m = re.match(r'\s*(\w+)\s*=\s*(0x[0-9A-Fa-f]+)\s*;', line)
    if m: SYM.setdefault(m.group(1), m.group(2))
def resolve(expr, depth=0):
    """A constant expression from the macros (numbers, symbols, | and +) to a number, or None."""
    expr = expr.strip()
    if depth > 8: return None
    v = num(expr)
    if v is not None: return v
    if expr in SYM: return resolve(SYM[expr], depth + 1)
    for op in ('|', '+'):
        if op in expr:
            parts = [resolve(p, depth + 1) for p in expr.split(op)]
            if None in parts: return None
            out = 0
            for p in parts: out = (out | p) if op == '|' else (out + p)
            return out
    return None
NAME_OF_ADDR = {}
for k in list(SYM):
    v = resolve(k)
    if v is not None and v >= 0x02000000: NAME_OF_ADDR.setdefault(v, k)

# ---- the command set: each macro as a flat list of fields (size, literal value or parameter name) ----
MACROS = {}
cur = None
for line in open(os.path.join(CF, 'battle_script_macros.s'), errors='replace'):
    line = line.split('@')[0].rstrip()
    m = re.match(r'\s*\.macro\s+(\w+)\s*(.*)$', line)
    if m:
        params = [p.split(':')[0].strip() for p in re.split(r'[,\s]+', m.group(2).strip()) if p.strip()]
        cur = {'name': m.group(1), 'params': params, 'body': []}
        continue
    if cur is None: continue
    if re.match(r'\s*\.endm', line):
        MACROS[cur['name']] = cur; cur = None; continue
    if line.strip(): cur['body'].append(line.strip())
SIZES = {'.byte': 1, '.2byte': 2, '.hword': 2, '.4byte': 4, '.word': 4}
def expand(name, args, depth=0):
    mac = MACROS[name]
    sub = dict(zip(mac['params'], args))
    out = []
    for b in mac['body']:
        m = re.match(r'(\.\w+)\s*(.*)$', b)
        if m and m.group(1) in SIZES:
            for e in [x.strip() for x in m.group(2).split(',') if x.strip()]:
                e2 = re.sub(r'\\(\w+)', lambda mm: '\\' + mm.group(1) if mm.group(1) not in sub else sub[mm.group(1)], e)
                p = re.fullmatch(r'\\(\w+)', e.strip())
                out.append((SIZES[m.group(1)], ('param', p.group(1)) if p else ('lit', e2)))
            continue
        m = re.match(r'(\w+)\s*(.*)$', b)
        if m and m.group(1) in MACROS and depth < 6:
            inner = [x.strip() for x in re.split(r',', m.group(2)) if x.strip()] if ',' in m.group(2) else [x for x in m.group(2).split() if x]
            inner = [re.sub(r'\\(\w+)', lambda mm: sub.get(mm.group(1), mm.group(0)), x) for x in inner]
            for size, f in expand(m.group(1), inner, depth + 1):
                if f[0] == 'lit':
                    pm = re.fullmatch(r'\\?(\w+)', f[1])
                    if f[1].startswith('\\'): f = ('param', f[1][1:])
                out.append((size, f))
            continue
        return None   # something this reader doesn't model
    return out
CMDS = []
for name, mac in MACROS.items():
    try: fields = expand(name, ['\\' + p for p in mac['params']])
    except (KeyError, RecursionError): fields = None
    if not fields: continue
    lits = []
    off = 0
    ok = True
    norm = []
    for size, f in fields:
        if f[0] == 'lit':
            v = resolve(f[1].lstrip('\\'))
            if v is None:
                pn = f[1].lstrip('\\')
                if pn in mac['params']: f = ('param', pn)
                else: ok = False; break
            else: lits.append((off, size, v))
        norm.append((off, size, f))
        off += size
    if not ok or not lits or lits[0][0] != 0 or lits[0][1] != 1: continue
    CMDS.append({'name': name, 'len': off, 'lits': lits, 'fields': norm})
BY_OP = {}
for c in CMDS: BY_OP.setdefault(c['lits'][0][2], []).append(c)
for op in BY_OP: BY_OP[op].sort(key=lambda c: -len(c['lits']))   # most specific first

def rd(o, size): return rom[o] if size == 1 else u16(o) if size == 2 else u32(o)
def match(o):
    for c in BY_OP.get(rom[o], []):
        if all(rd(o + off, size) == v for off, size, v in c['lits']): return c
    return None
ENDS = {'end', 'end2', 'end3', 'return', 'goto', 'end4', 'endselectionscript'}
JUMP_PARAMS = re.compile(r'rom_address|ptr|jump|address|script|dest|fail|label|bs\b', re.I)
def fmt_arg(cname, pname, size, v):
    if size == 4 and isptr(v) and v >= 0x08000000: return f'{v:#x}'
    if size == 4 and v in NAME_OF_ADDR: return NAME_OF_ADDR[v]
    if re.search(r'move', cname, re.I) and size == 2 and v in MOVE and pname in ('compare', 'move'): return f'MOVE<{MOVE[v]}>'
    if cname in ('jumpifability', 'jumpifabilitypresent', 'jumpifabilitypresentattackerfield', 'jumpifabilitypresenttargetfield') and pname == 'ability': return f'ABILITY<{ABIL.get(v, v)}>'
    return f'{v:#x}' if v > 9 else str(v)

def disasm(start, seen=None, limit=4000):
    """Every command reachable from start: {addr: (name, args, len)}."""
    seen = {} if seen is None else seen
    todo = [start]
    while todo:
        a = todo.pop()
        o = a - 0x08000000
        steps = 0
        while 0 <= o < len(rom) and (o + 0x08000000) not in seen and steps < limit:
            steps += 1
            c = match(o)
            if not c:
                seen[o + 0x08000000] = ('??', [f'{rom[o]:#04x}'], 1)
                break
            args, targets = [], []
            for off, size, f in c['fields']:
                if f[0] != 'param': continue
                v = rd(o + off, size)
                args.append(fmt_arg(c['name'], f[1], size, v))
                if size == 4 and isptr(v) and 0x081D0000 <= v < 0x09FFFFFF and not (re.search(r'asm|table|string|func|ptr_', f[1], re.I) and 'rom_address' not in f[1]):
                    if 'asm' not in c['name'] and 'printfromtable' not in c['name'] and 'callasm' not in c['name']: targets.append(v)
            seen[o + 0x08000000] = (c['name'], args, c['len'])
            todo.extend(targets)
            if c['name'] in ENDS: break
            o += c['len']
    return seen

def effect_table():
    """gBattleScriptsForMoveEffects: starts with the vanilla hit script 0x081D6926, then CFRU's scripts."""
    pat = struct.pack('<I', 0x081D6926)
    best = None
    for m in re.finditer(re.escape(pat), rom):
        a = m.start()
        if a % 4: continue
        n = 0
        while isptr(u32(a + 4 * n)) and n < 400: n += 1
        if n > 200 and (best is None or n > best[1]): best = (a, n)
    return best

if __name__ == '__main__':
    tab, n = effect_table()
    effects = {}
    for e in range(n):
        effects[e] = u32(tab + 4 * e)
    if '--moves' in sys.argv:
        out = {}
        for e, a in effects.items():
            code = disasm(a)
            mv = sorted({x for (nm, args, _) in code.values() for x in args if x.startswith('MOVE<')})
            out[e] = {'script': f'{a:#x}', 'moves': [x[5:-1] for x in mv]}
        json.dump(out, open(sys.argv[sys.argv.index('--moves') + 1], 'w'), indent=0)
        print('effects', len(out), 'table', hex(tab))
        sys.exit()
    want = [int(x) for x in sys.argv[2:] if x.isdigit()]
    print(f'effect table at {tab:#x}: {n} effects; {len(CMDS)} commands known')
    for e in (want or range(n)):
        a = effects[e]
        print(f'\n=== effect {e} @ {a:#x}')
        code = disasm(a)
        for addr in sorted(code):
            nm, args, ln = code[addr]
            print(f'  {addr:#09x}  {nm} {", ".join(args)}')
