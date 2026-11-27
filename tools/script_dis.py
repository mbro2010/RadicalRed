"""A FireRed event-script disassembler with every command named (pokefirered asm/macros/event.inc), for reading map
scripts: what an obstacle checks, what a trigger gates on, what a reward needs.

  from script_dis import dis       # dis(offset) -> list of lines, following call/goto/branches once each
  python3 -I tools/script_dis.py 0x0904DDC8 [more offsets]   (ROM addresses or file offsets)
"""
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rom import rom, u16, u32, isptr  # noqa: E402
from script_walk import L, BATTLE_LEN, BATTLE_CONT, G  # noqa: E402

# name, argument layout: b byte, h halfword, w word, p pointer, m map (group, num), x warp (group, num, id, x, y)
OPS = {
    0x00: ('nop', ''), 0x01: ('nop1', ''), 0x02: ('end', ''), 0x03: ('return', ''), 0x04: ('call', 'p'), 0x05: ('goto', 'p'),
    0x06: ('goto_if', 'bp'), 0x07: ('call_if', 'bp'), 0x08: ('gotostd', 'b'), 0x09: ('callstd', 'b'), 0x0A: ('gotostd_if', 'bb'),
    0x0B: ('callstd_if', 'bb'), 0x0C: ('returnram', ''), 0x0D: ('endram', ''), 0x0E: ('setmysteryeventstatus', 'b'),
    0x0F: ('loadword', 'bp'), 0x10: ('loadbyte', 'bb'), 0x11: ('setptr', 'bp'), 0x12: ('loadbytefromptr', 'bp'), 0x13: ('setptrbyte', 'bp'),
    0x14: ('copylocal', 'bb'), 0x15: ('copybyte', 'pp'), 0x16: ('setvar', 'hh'), 0x17: ('addvar', 'hh'), 0x18: ('subvar', 'hh'),
    0x19: ('copyvar', 'hh'), 0x1A: ('setorcopyvar', 'hh'), 0x1B: ('compare_local_to_local', 'bb'), 0x1C: ('compare_local_to_value', 'bb'),
    0x1D: ('compare_local_to_ptr', 'bp'), 0x1E: ('compare_ptr_to_local', 'pb'), 0x1F: ('compare_ptr_to_value', 'pb'),
    0x20: ('compare_ptr_to_ptr', 'pp'), 0x21: ('compare', 'hh'), 0x22: ('compare_vars', 'hh'), 0x23: ('callnative', 'p'),
    0x24: ('gotonative', 'p'), 0x25: ('special', 'h'), 0x26: ('specialvar', 'hh'), 0x27: ('waitstate', ''), 0x28: ('delay', 'h'),
    0x29: ('setflag', 'h'), 0x2A: ('clearflag', 'h'), 0x2B: ('checkflag', 'h'), 0x2C: ('initclock', 'hh'), 0x2D: ('dotimebasedevents', ''),
    0x2E: ('gettime', ''), 0x2F: ('playse', 'h'), 0x30: ('waitse', ''), 0x31: ('playfanfare', 'h'), 0x32: ('waitfanfare', ''),
    0x33: ('playbgm', 'hb'), 0x34: ('savebgm', 'h'), 0x35: ('fadedefaultbgm', ''), 0x36: ('fadenewbgm', 'h'), 0x37: ('fadeoutbgm', 'b'),
    0x38: ('fadeinbgm', 'b'), 0x39: ('warp', 'x'), 0x3A: ('warpsilent', 'x'), 0x3B: ('warpdoor', 'x'), 0x3C: ('warphole', 'm'),
    0x3D: ('warpteleport', 'x'), 0x3E: ('setwarp', 'x'), 0x3F: ('setdynamicwarp', 'x'), 0x40: ('setdivewarp', 'x'), 0x41: ('setholewarp', 'x'),
    0x42: ('getplayerxy', 'hh'), 0x43: ('getpartysize', ''), 0x44: ('additem', 'hh'), 0x45: ('removeitem', 'hh'), 0x46: ('checkitemspace', 'hh'),
    0x47: ('checkitem', 'hh'), 0x48: ('checkitemtype', 'h'), 0x49: ('addpcitem', 'hh'), 0x4A: ('checkpcitem', 'hh'), 0x4B: ('adddecoration', 'h'),
    0x4C: ('removedecoration', 'h'), 0x4D: ('checkdecor', 'h'), 0x4E: ('checkdecorspace', 'h'), 0x4F: ('applymovement', 'hp'),
    0x50: ('applymovementat', 'hpbb'), 0x51: ('waitmovement', 'h'), 0x52: ('waitmovementat', 'hbb'), 0x53: ('removeobject', 'h'),
    0x54: ('removeobjectat', 'hbb'), 0x55: ('addobject', 'h'), 0x56: ('addobjectat', 'hbb'), 0x57: ('setobjectxy', 'hhh'),
    0x58: ('showobjectat', 'hbb'), 0x59: ('hideobjectat', 'hbb'), 0x5A: ('faceplayer', ''), 0x5B: ('turnobject', 'hb'),
    0x5D: ('dotrainerbattle', ''), 0x5E: ('gotopostbattlescript', ''), 0x5F: ('gotobeatenscript', ''), 0x60: ('checktrainerflag', 'h'),
    0x61: ('settrainerflag', 'h'), 0x62: ('cleartrainerflag', 'h'), 0x63: ('setobjectxyperm', 'hhh'), 0x64: ('moveobjectoffscreen', 'h'),
    0x65: ('setobjectmovementtype', 'hb'), 0x66: ('waitmessage', ''), 0x67: ('message', 'p'), 0x68: ('closemessage', ''), 0x69: ('lockall', ''),
    0x6A: ('lock', ''), 0x6B: ('releaseall', ''), 0x6C: ('release', ''), 0x6D: ('waitbuttonpress', ''), 0x6E: ('yesnobox', 'bb'),
    0x6F: ('multichoice', 'bbbb'), 0x70: ('multichoicedefault', 'bbbbb'), 0x71: ('multichoicegrid', 'bbbbb'), 0x72: ('drawbox', ''),
    0x73: ('erasebox', 'bbbb'), 0x74: ('drawboxtext', 'bbbb'), 0x75: ('showmonpic', 'hbb'), 0x76: ('hidemonpic', ''), 0x77: ('showcontestwinner', 'b'),
    0x78: ('braillemessage', 'p'), 0x79: ('givemon', 'hbhwwb'), 0x7A: ('giveegg', 'h'), 0x7B: ('setmonmove', 'bbh'), 0x7C: ('checkpartymove', 'h'),
    0x7D: ('bufferspeciesname', 'bh'), 0x7E: ('bufferleadmonspeciesname', 'b'), 0x7F: ('bufferpartymonnick', 'bh'), 0x80: ('bufferitemname', 'bh'),
    0x81: ('bufferdecorationname', 'bh'), 0x82: ('buffermovename', 'bh'), 0x83: ('buffernumberstring', 'bh'), 0x84: ('bufferstdstring', 'bh'),
    0x85: ('bufferstring', 'bp'), 0x86: ('pokemart', 'p'), 0x87: ('pokemartdecoration', 'p'), 0x88: ('pokemartdecoration2', 'p'),
    0x89: ('playslotmachine', 'h'), 0x8A: ('setberrytree', 'bbb'), 0x8F: ('random', 'h'), 0x90: ('givemoney', 'wb'), 0x91: ('takemoney', 'wb'),
    0x92: ('checkmoney', 'wb'), 0x93: ('showmoneybox', 'bbb'), 0x94: ('hidemoneybox', ''), 0x95: ('updatemoneybox', 'bbb'),
    0x96: ('getpricereduction', 'h'), 0x97: ('fadescreen', 'b'), 0x98: ('fadescreenspeed', 'bb'), 0x99: ('setflashradius', 'h'),
    0x9A: ('animateflash', 'b'), 0x9B: ('messageautoscroll', 'p'), 0x9C: ('dofieldeffect', 'h'), 0x9D: ('setfieldeffectargument', 'bh'),
    0x9E: ('waitfieldeffect', 'h'), 0x9F: ('setrespawn', 'h'), 0xA0: ('checkplayergender', ''), 0xA1: ('playmoncry', 'hh'),
    0xA2: ('setmetatile', 'hhhh'), 0xA3: ('resetweather', ''), 0xA4: ('setweather', 'h'), 0xA5: ('doweather', ''), 0xA6: ('setstepcallback', 'b'),
    0xA7: ('setmaplayoutindex', 'h'), 0xA8: ('setobjectpriority', 'hbbb'), 0xA9: ('resetobjectpriority', 'hbb'), 0xAA: ('createvobject', 'bbhhbb'),
    0xAB: ('turnvobject', 'bb'), 0xAC: ('opendoor', 'hh'), 0xAD: ('closedoor', 'hh'), 0xAE: ('waitdooranim', ''), 0xAF: ('setdooropen', 'hh'),
    0xB0: ('setdoorclosed', 'hh'), 0xB1: ('addelevmenuitem', 'bhhh'), 0xB2: ('showelevmenu', ''), 0xB3: ('checkcoins', 'h'), 0xB4: ('givecoins', 'h'),
    0xB5: ('takecoins', 'h'), 0xB6: ('setwildbattle', 'hbh'), 0xB7: ('dowildbattle', ''), 0xC0: ('showcoinsbox', 'bb'), 0xC1: ('hidecoinsbox', 'bb'),
    0xC2: ('updatecoinsbox', 'bb'), 0xC3: ('incrementgamestat', 'b'), 0xC4: ('setescapewarp', 'x'), 0xC5: ('waitmoncry', ''), 0xC6: ('bufferboxname', 'bh'),
    0xC7: ('textcolor', 'b'), 0xC8: ('loadhelp', 'p'), 0xC9: ('unloadhelp', ''), 0xCA: ('signmsg', ''), 0xCB: ('normalmsg', ''),
    0xCC: ('comparehiddenvar', 'bw'), 0xCD: ('setmonobedient', 'h'), 0xCE: ('checkmonobedience', 'h'), 0xD0: ('setworldmapflag', 'h'),
    0xD1: ('warpteleport2', 'x'), 0xD2: ('setmonmetlocation', 'hb'),
}
COND = {0: '<', 1: '==', 2: '>', 3: '<=', 4: '>=', 5: '!='}
BRANCH = {0x04, 0x05, 0x06, 0x07}


def _args(o, fmt):
    p, out = o + 1, []
    for a in fmt:
        if a == 'b': out.append(rom[p]); p += 1
        elif a == 'h': out.append(u16(p)); p += 2
        elif a in 'wp': out.append(u32(p)); p += 4
        elif a == 'm': out.append((rom[p], rom[p + 1])); p += 2
        elif a == 'x': out.append(((rom[p], rom[p + 1]), rom[p + 2], u16(p + 3), u16(p + 5))); p += 7
    return out


def fmt_line(o):
    """(text, next offset or None, branch targets) for the command at file offset o."""
    op = rom[o]
    if op == 0x5C:
        typ, tid = rom[o + 1], u16(o + 2)
        cont = BATTLE_CONT.get(typ)
        extra = f' then {u32(o + cont):#x}' if cont and isptr(u32(o + cont)) else ''
        return f'trainerbattle type {typ} trainer {tid}{extra}', o + 2 + BATTLE_LEN.get(typ, 12), ([u32(o + cont) - G] if cont and isptr(u32(o + cont)) else [])
    if op not in OPS or op not in L:
        return f'?? {op:#04x}', None, []
    name, fmt = OPS[op]
    a = _args(o, fmt)
    targets = []
    if op in (0x04, 0x05) and isptr(a[0]): targets.append(a[0] - G)
    if op in (0x06, 0x07) and isptr(a[1]): targets.append(a[1] - G)
    shown = []
    for k, v in zip(fmt, a):
        if k in 'pw': shown.append(f'{v:#x}')
        elif k == 'h': shown.append(f'{v:#x}' if v > 255 else str(v))
        else: shown.append(str(v))
    if op in (0x06, 0x07): shown[0] = COND.get(a[0], str(a[0]))
    nxt = None if op in (0x02, 0x03, 0x05, 0x08, 0x0C, 0x0D, 0x24) else o + 1 + L[op]
    return f'{name} {", ".join(shown)}'.strip(), nxt, targets


def dis(start, maxn=200):
    """Disassemble from a ROM address or file offset, following every branch once. Returns lines."""
    start = start - G if start >= G else start
    lines, todo, seen = [], [start], set()
    while todo and len(lines) < maxn:
        o = todo.pop(0)
        if o in seen or not (0 <= o < len(rom) - 8):
            continue
        lines.append(f'@{o + G:#x}:')
        while o is not None and o not in seen and len(lines) < maxn:
            seen.add(o)
            text, nxt, targets = fmt_line(o)
            lines.append(f'  {text}')
            todo.extend(t for t in targets if t not in seen)
            o = nxt
    return lines


if __name__ == '__main__':
    for a in sys.argv[1:]:
        print('\n'.join(dis(int(a, 16))))
        print()
