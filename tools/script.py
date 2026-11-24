"""Tiny Gen 3 (FireRed) event-script disassembler for the commands we need."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rom import *
OPS = {0x00:('nop',''),0x01:('nop1',''),0x02:('end',''),0x03:('return',''),0x04:('call','p'),0x05:('goto','p'),
 0x06:('goto_if','bp'),0x07:('call_if','bp'),0x08:('gotostd','b'),0x09:('callstd','b'),0x0A:('gotostd_if','bb'),0x0B:('callstd_if','bb'),
 0x0F:('loadword','bp'),0x10:('loadbyte','bb'),0x16:('setvar','hh'),0x17:('addvar','hh'),0x18:('subvar','hh'),0x19:('copyvar','hh'),
 0x1A:('setorcopyvar','hh'),0x21:('compare','hh'),0x22:('compare_vars','hh'),0x23:('callnative','p'),0x24:('gotonative','p'),
 0x25:('special','h'),0x26:('specialvar','hh'),0x27:('waitstate',''),0x28:('delay','h'),0x29:('setflag','h'),0x2A:('clearflag','h'),
 0x2B:('checkflag','h'),0x2F:('playse','h'),0x30:('waitse',''),0x31:('playfanfare','h'),0x32:('waitfanfare',''),
 0x5C:('trainerbattle','*'),0x66:('waitmsg',''),0x67:('preparemsg','p'),0x68:('closemsg',''),0x69:('lockall',''),0x6A:('lock',''),
 0x6B:('releaseall',''),0x6C:('release',''),0x6D:('waitkeypress',''),0x6E:('yesnobox','bb'),0x6F:('multichoice','bbbb'),
 0x7C:('checkpartymove','h'),0x7D:('bufferspeciesname','bh'),0x80:('bufferitemname','bh'),0x82:('buffermovename','bh'),
 0x83:('buffernumberstring','bh'),0x84:('bufferstdstring','bh'),0x85:('bufferstring','bp'),0x9C:('dofieldeffect','h'),
 0xA7:('setwildbattle','hbh'),0xB6:('setwildbattle','hbh'),0xB7:('dowildbattle',''),0xC5:('waitbuttonpress',''),
}
COND = {0:'<',1:'==',2:'>',3:'<=',4:'>=',5:'!='}
def dis_script(off, maxn=80, seen=None):
    out=[]; todo=[off]; seen = seen if seen is not None else set()
    while todo:
        o = todo.pop(0)
        if o in seen or not (0 <= o < len(rom)): continue
        seen.add(o)
        out.append(f'--- script @{o:#x}')
        for _ in range(maxn):
            op = rom[o]
            if op not in OPS: out.append(f'  {o:#x}: ?? {op:#04x}'); break
            name, args = OPS[op]; p = o+1; vals=[]
            for a in args:
                if a=='b': vals.append(rom[p]); p+=1
                elif a=='h': vals.append(u16(p)); p+=2
                elif a=='p': vals.append(u32(p)); p+=4
            txt=''
            if name=='loadword' and isptr(vals[1]): txt = '  "' + s(vals[1]-0x08000000, 120).replace('\n',' ') + '"'
            if name in ('goto','call') and isptr(vals[0]): todo.append(vals[0]-0x08000000)
            if name in ('goto_if','call_if') and isptr(vals[1]): todo.append(vals[1]-0x08000000)
            vs = ', '.join((hex(v) if v>9 else str(v)) for v in vals)
            if name in ('goto_if','call_if'): vs = f'{COND.get(vals[0],vals[0])}, {vals[1]:#x}'
            out.append(f'  {o:#x}: {name} {vs}{txt}')
            o = p
            if name in ('end','return','goto','gotostd'): break
    return '\n'.join(out)
if __name__=='__main__':
    # usage: python3 tools/script.py <rom offset in hex> ...
    for a in sys.argv[1:]:
        print(dis_script(int(a,16)))
