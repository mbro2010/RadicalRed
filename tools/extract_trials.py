"""Radical Red's puzzle battles and rental battles, read from the ROM (data/trials.json).

Four people lend you Pokemon for a battle and give a prize for winning it. Their scripts set one of two flags right
before a `trainerbattle 9` (the early-rival battle, which reports a win or loss instead of whiting you out; var 0x8000
= 0xFEFE makes CFRU run it as a normal battle you may lose):

- flag 0x1042, a **puzzle battle**: `callnative 0x9079301` shows the six rentals of row var 0x5127 of the rental table
  at 0x9124D00 (60-byte rows, the team pointer at +0x24) and you pick three;
- flag 0x104B, a **rental battle**: `callnative 0x9079288` gives you all six Pokemon of row var 0x5127 + 2 (it reads
  0x9124D00 + 0x3C * var + 0x9C).

The opponent's team comes from the party builder (0x0907B624): with flag 0x1042 set, trainer 7 uses the record at
0x9124DF0 and trainer 6 the one after it; with flag 0x104B set, trainer 5 uses the record at 0x9124E90 and trainer 14
the one after it (code at 0x0907B662-0x0907B848; checked below). Records are the 60-byte boss records (team pointer at
+0x10, size at +0x2C) and their Pokemon the 28-byte boss Pokemon (tools/extract.py decode_record_party).

A draw counts as a loss: if your last Pokemon and theirs go down at once (Iron Barbs, recoil), you lose the trial.

usage: RR_ROM=... python3 -I tools/extract_trials.py data app/rrdata.json
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rom import rom, u8, u16, u32, isptr, dec  # noqa: E402
from script_walk import G, L, BATTLE_LEN, header  # noqa: E402

DATA = sys.argv[1] if len(sys.argv) > 1 else 'data'
APP = json.load(open(sys.argv[2] if len(sys.argv) > 2 else 'app/rrdata.json'))
SPECIES = {s['i']: s for s in APP['species']}
MOVES = {m['i']: m for m in APP['moves']}
NATURES = [n['n'] if isinstance(n, dict) else n for n in APP['natures']]
ITEMS = {int(k): v['n'] for k, v in APP['items'].items()}
MAPS = json.load(open(os.path.join(DATA, 'maps.json')))

RENTALS = 0x9124D00 - G
PUZZLE, RENTAL = 0x1042, 0x104B
PICK3, FIXED6 = 0x9079301, 0x9079289          # callnative targets (Thumb, odd)
OPPONENT = {PUZZLE: {7: 0x9124DF0 - G, 6: 0x9124E2C - G}, RENTAL: {5: 0x9124E90 - G, 14: 0x9124ECC - G}}
REL = {101: -2, 102: -1, 103: 0, 104: -3}


def check_builder():
    """The party builder's special cases are where this tool says (cmp r4, #7 / #6 / #5 / #14 and the tables)."""
    want = {0x907B672: 0x2C07, 0x907B67A: 0x2C06, 0x907B808: 0x2C05, 0x907B80E: 0x2C0E}
    for a, h in want.items():
        assert u16(a - G) == h, f'party builder changed at {a:#x}'


def text(p):
    return dec(rom[p - G:p - G + 600]).replace('\n', ' ') if isptr(p) else None


def mon(q):
    """A 28-byte boss Pokemon record at file offset q."""
    sp = u16(q)
    s = SPECIES.get(sp, {'n': f'species {sp}', 'a': [None, None, None]})
    sel = (u8(q + 25) >> 4) & 3          # 0 hidden, 1 slot 1, 2/3 slot 2 (falls back to slot 1)
    ab = s['a'][2] if sel == 0 else s['a'][0] if sel == 1 else s['a'][1]
    ab = ab or s['a'][0]
    ivw = u32(q + 4)
    lv = u8(q + 26)
    return {'s': sp, 'n': s['n'], 'lv': lv if lv not in REL else None, 'capRel': REL.get(lv), 'nat': u8(q + 2),
            'nature': NATURES[u8(q + 2)] if u8(q + 2) < 25 else None, 'it': u16(q + 14) or None, 'item': ITEMS.get(u16(q + 14)),
            'mv': [u16(q + 16 + 2 * j) for j in range(4) if u16(q + 16 + 2 * j)],
            'moves': [MOVES[u16(q + 16 + 2 * j)]['n'] for j in range(4) if u16(q + 16 + 2 * j) in MOVES],
            'ab': ab, 'iv': [(ivw >> (5 * i)) & 31 for i in range(6)], 'ev': list(rom[q + 8:q + 14])}


def team(ptr, n=6):
    out = []
    for k in range(n):
        q = ptr - G + 28 * k
        if not u16(q):
            break
        out.append(mon(q))
    return out


def block(o):
    """Commands from file offset o to the end of the block: [(offset, op, raw bytes)], and where it goes next."""
    cmds = []
    while 0 <= o < len(rom) - 20:
        op = rom[o]
        if op == 0x5C:
            n = 2 + BATTLE_LEN.get(rom[o + 1], 12)
            cmds.append((o, op, rom[o:o + n])); o += n
            continue
        if op not in L:
            break
        n = 1 + L[op]
        cmds.append((o, op, rom[o:o + n]))
        if op in (0x02, 0x03, 0x05, 0x08, 0x0C, 0x0D):
            break
        o += n
    return cmds


def walk(start):
    """Every command reachable from a script, in the order met (follows calls and branches once)."""
    seen, todo, cmds = set(), [start - G if start >= G else start], []
    while todo:
        o = todo.pop()
        if o in seen:
            continue
        for c in block(o):
            if c[0] in seen:
                break
            seen.add(c[0])
            cmds.append(c)
            off, op, raw = c
            if op in (0x04, 0x05) and isptr(u32(off + 1)):
                todo.append(u32(off + 1) - G)
            if op in (0x06, 0x07) and isptr(u32(off + 2)):
                todo.append(u32(off + 2) - G)
    return sorted(cmds)


def outcome_paths(after):
    """After a trainerbattle 9: (win start, loss start). The script compares VAR_RESULT (0x800D): 0 won, 1 lost."""
    win = loss = None
    o = after
    for _ in range(4):
        if rom[o] == 0x21 and u16(o + 1) == 0x800D and rom[o + 5] == 0x06 and rom[o + 6] == 1:
            v, t = u16(o + 3), u32(o + 7) - G
            if v == 1:
                loss = t
            elif v == 0:
                win = t
            o += 11
            continue
        break
    if win is None:
        win = o                      # falls through to the win
    return win, loss


def path_summary(o, limit=60):
    """Texts, flags, Pokemon, money of the straight-line path from o (following gotos and calls)."""
    res = {'texts': [], 'flags': [], 'mons': [], 'money': 0, 'items': []}
    seen, stack, n = set(), [], 0
    v8000 = None
    while o is not None and n < limit and 0 <= o < len(rom) - 20 and o not in seen:
        seen.add(o); n += 1
        op = rom[o]
        if op == 0x5C:
            o += 2 + BATTLE_LEN.get(rom[o + 1], 12); continue
        if op not in L:
            break
        if op == 0x0F and rom[o + 1] == 0 or op == 0x67:
            t = text(u32(o + 2) if op == 0x0F else u32(o + 1))
            if t:
                res['texts'].append(t)
        if op == 0x29:
            res['flags'].append(u16(o + 1))
        if op == 0x79:
            res['mons'].append({'s': u16(o + 1), 'n': SPECIES.get(u16(o + 1), {}).get('n'), 'lv': rom[o + 3]})
        if op == 0x90:
            res['money'] += u32(o + 1)
        if op in (0x1A, 0x16) and u16(o + 1) == 0x8000:
            v8000 = u16(o + 3)
        if op == 0x09 and rom[o + 1] in (0, 1) and v8000:
            res['items'].append(ITEMS.get(v8000, v8000))
        if op in (0x02, 0x0C, 0x0D):
            break
        if op == 0x03:
            if stack:
                o = stack.pop(); continue
            break
        if op == 0x04:
            stack.append(o + 5); o = u32(o + 1) - G; continue
        if op == 0x05:
            o = u32(o + 1) - G; continue
        o += 1 + L[op]
    return res


UNLOCKS = {0x1047: 'PokéVial', 0x1049: 'Move Relearner'}


def trials_on(mp, h):
    from script_walk import entry_points
    found = []
    for kind, sp in entry_points(h):
        cmds = walk(sp)
        flags_set = {u16(o + 1) for o, op, _ in cmds if op == 0x29}
        if not flags_set & {PUZZLE, RENTAL}:
            continue
        battles = [(o, u16(o + 2)) for o, op, raw in cmds if op == 0x5C and rom[o + 1] == 9]
        if not battles:
            continue
        mode = PUZZLE if PUZZLE in flags_set else RENTAL
        row = next((u16(o + 3) for o, op, _ in cmds if op == 0x16 and u16(o + 1) == 0x5127), 0)
        natives = {u32(o + 1) for o, op, _ in cmds if op == 0x23}
        tid = battles[0][1]
        rec = OPPONENT[mode][tid]
        opp = team(u32(rec + 0x10), u16(rec + 0x2C))
        if PICK3 in natives:
            rentals, pick = team(u32(RENTALS + 0x3C * row + 0x24)), 3
        else:
            rentals, pick = team(u32(RENTALS + 0x3C * (row + 2) + 0x24)), 6
        texts = [text(u32(o + 2)) for o, op, _ in cmds if op == 0x0F and rom[o + 1] == 0]
        texts = [t for t in texts if t]
        bets = []
        prize = {'flags': [], 'mons': [], 'money': 0, 'items': [], 'texts': []}
        hint = None
        for o, t in battles:
            win, loss = outcome_paths(o + 2 + BATTLE_LEN[9])
            w = path_summary(win)
            if loss is not None:
                hint = hint or ' '.join(path_summary(loss)['texts'])
            for k in ('flags', 'mons', 'items', 'texts'):
                for x in w[k]:
                    if x not in prize[k]:
                        prize[k].append(x)
            if w['money']:
                # the bet is the takemoney before this battle
                bet = max((u32(q + 1) for q, op, _ in cmds if op == 0x91 and q < o), default=0, key=lambda b: b if b else 0)
                prev = [u32(q + 1) for q, op, _ in cmds if op == 0x91 and q < o]
                bets.append({'bet': prev[-1] if prev else 0, 'win': w['money']})
        rules = next((t for t in texts if t.startswith('The rules are simple')), None)
        found.append({
            'map': [mp['group'], mp['num']], 'mapName': mp['name'], 'script': sp, 'kind': 'puzzle' if mode == PUZZLE else 'rental',
            'trainer': tid, 'rentalRow': row if mode == PUZZLE else row + 2, 'pick': pick, 'rentals': rentals, 'opponent': opp,
            'intro': texts[0] if texts else None, 'rules': rules, 'hint': hint,
            'prize': {'unlocks': [UNLOCKS[f] for f in prize['flags'] if f in UNLOCKS], 'flags': prize['flags'],
                      'mons': prize['mons'], 'items': prize['items'], 'texts': prize['texts'][:4]},
            'bets': bets,
        })
    return found


def main():
    check_builder()
    out = []
    seen = set()
    for mp in MAPS:
        try:
            h = header(mp['group'], mp['num'])
        except Exception:
            continue
        try:
            for t in trials_on(mp, h):
                if t['script'] not in seen:
                    seen.add(t['script'])
                    out.append(t)
        except Exception as e:  # a map whose events don't parse
            print('skip', mp['name'], e, file=sys.stderr)
    # where each one stands (the person who runs the script)
    from world_maps import load
    for t in out:
        m = load(*t['map'])
        ob = next((o for o in m['objects'] if o['script'] == t['script']), None)
        t['at'] = [ob['x'], ob['y']] if ob else None
    json.dump(out, open(os.path.join(DATA, 'trials.json'), 'w'), indent=1, ensure_ascii=False)
    for t in out:
        print(f"{t['mapName']} {t['map']} at {t['at']}: {t['kind']} battle vs trainer {t['trainer']}, pick {t['pick']} of "
              f"{len(t['rentals'])}: {', '.join(m['n'] for m in t['rentals'])} vs {', '.join(m['n'] for m in t['opponent'])}; "
              f"prize {t['prize']['unlocks'] or t['prize']['mons'] or t['bets']}")


if __name__ == '__main__':
    main()
