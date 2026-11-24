"""Minimal ARMv4T Thumb disassembler (enough to read compiled GBA code)."""
import struct
R = ['r0','r1','r2','r3','r4','r5','r6','r7','r8','r9','r10','r11','r12','sp','lr','pc']
COND = ['eq','ne','cs','cc','mi','pl','vs','vc','hi','ls','ge','lt','gt','le','al','nv']
ALU = ['and','eor','lsl','lsr','asr','adc','sbc','ror','tst','neg','cmp','cmn','orr','mul','bic','mvn']
def sx(v, bits):
    return v - (1<<bits) if v & (1<<(bits-1)) else v
def rlist(m, extra=None):
    l = [R[i] for i in range(8) if m & (1<<i)]
    if extra: l.append(extra)
    return '{'+','.join(l)+'}'
def dis1(rom, off):
    """returns (size, text, info) for instruction at ROM offset off"""
    h = struct.unpack_from('<H', rom, off)[0]
    pc = 0x08000000 + off
    info = {}
    t = None
    if h >> 11 == 0b00011:
        I = (h>>10)&1; op=(h>>9)&1; rn=(h>>6)&7; rs=(h>>3)&7; rd=h&7
        t = f"{'sub' if op else 'add'} {R[rd]},{R[rs]},{'#'+str(rn) if I else R[rn]}"
    elif h >> 13 == 0b000:
        op=(h>>11)&3; o5=(h>>6)&31; rs=(h>>3)&7; rd=h&7
        t = f"{['lsl','lsr','asr'][op]} {R[rd]},{R[rs]},#{o5}"
    elif h >> 13 == 0b001:
        op=(h>>11)&3; rd=(h>>8)&7; im=h&0xFF
        t = f"{['mov','cmp','add','sub'][op]} {R[rd]},#{im:#x}"
    elif h >> 10 == 0b010000:
        op=(h>>6)&15; rs=(h>>3)&7; rd=h&7
        t = f"{ALU[op]} {R[rd]},{R[rs]}"
    elif h >> 10 == 0b010001:
        op=(h>>8)&3; h1=(h>>7)&1; h2=(h>>6)&1; rs=((h>>3)&7)|(h2<<3); rd=(h&7)|(h1<<3)
        t = f"{['add','cmp','mov','bx'][op]} " + (R[rs] if op==3 else f"{R[rd]},{R[rs]}")
    elif h >> 11 == 0b01001:
        rd=(h>>8)&7; im=(h&0xFF)*4
        addr = ((pc+4)&~2)+im
        lo = addr-0x08000000
        val = struct.unpack_from('<I', rom, lo)[0] if 0<=lo<len(rom)-4 else None
        info['lit'] = (lo, val)
        t = f"ldr {R[rd]},[pc,#{im:#x}] ; ={val:#010x}" if val is not None else f"ldr {R[rd]},=?"
    elif h >> 12 == 0b0101:
        L=(h>>11)&1; B=(h>>10)&1; S=(h>>9)&1; ro=(h>>6)&7; rb=(h>>3)&7; rd=h&7
        if S==0:
            t = f"{'ldr' if L else 'str'}{'b' if B else ''} {R[rd]},[{R[rb]},{R[ro]}]"
        else:
            t = f"{['strh','ldsb','ldrh','ldsh'][(L<<1)|B]} {R[rd]},[{R[rb]},{R[ro]}]"
    elif h >> 13 == 0b011:
        B=(h>>12)&1; L=(h>>11)&1; o5=(h>>6)&31; rb=(h>>3)&7; rd=h&7
        t = f"{'ldr' if L else 'str'}{'b' if B else ''} {R[rd]},[{R[rb]},#{(o5 if B else o5*4):#x}]"
    elif h >> 12 == 0b1000:
        L=(h>>11)&1; o5=(h>>6)&31; rb=(h>>3)&7; rd=h&7
        t = f"{'ldrh' if L else 'strh'} {R[rd]},[{R[rb]},#{o5*2:#x}]"
    elif h >> 12 == 0b1001:
        L=(h>>11)&1; rd=(h>>8)&7; im=(h&0xFF)*4
        t = f"{'ldr' if L else 'str'} {R[rd]},[sp,#{im:#x}]"
    elif h >> 12 == 0b1010:
        S=(h>>11)&1; rd=(h>>8)&7; im=(h&0xFF)*4
        t = f"add {R[rd]},{'sp' if S else 'pc'},#{im:#x}"
    elif h >> 8 == 0b10110000:
        im=(h&0x7F)*4
        t = f"{'sub' if h&0x80 else 'add'} sp,#{im:#x}"
    elif h >> 12 == 0b1011 and (h>>9)&3 == 0b10:
        L=(h>>11)&1; Rb=(h>>8)&1
        t = f"{'pop' if L else 'push'} {rlist(h&0xFF, ('pc' if L else 'lr') if Rb else None)}"
        if L and Rb: info['ret']=True
    elif h >> 12 == 0b1100:
        L=(h>>11)&1; rb=(h>>8)&7
        t = f"{'ldmia' if L else 'stmia'} {R[rb]}!,{rlist(h&0xFF)}"
    elif h >> 8 == 0b11011111:
        t = f"swi #{h&0xFF:#x}"
    elif h >> 12 == 0b1101:
        c=(h>>8)&15; tgt = pc+4+sx(h&0xFF,8)*2
        info['br']=tgt
        t = f"b{COND[c]} {tgt:#010x}"
    elif h >> 11 == 0b11100:
        tgt = pc+4+sx(h&0x7FF,11)*2
        info['br']=tgt; info['jmp']=True
        t = f"b {tgt:#010x}"
    elif h >> 11 == 0b11110:
        h2 = struct.unpack_from('<H', rom, off+2)[0]
        if h2 >> 11 == 0b11111:
            tgt = pc+4+(sx(h&0x7FF,11)<<12)+((h2&0x7FF)<<1)
            info['call']=tgt
            return 4, f"bl {tgt:#010x}", info
        t = f".hword {h:#06x}"
    else:
        t = f".hword {h:#06x}"
    if t.startswith('bx '): info['ret']=True
    return 2, t, info
def disasm(rom, start, count=60, names=None, stop_at_ret=False):
    off = start & ~1
    out=[]
    for _ in range(count):
        n, t, info = dis1(rom, off)
        note=''
        if names:
            for k in ('call','br'):
                if k in info and info[k] in names: note += f'  <{names[info[k]]}>'
            if 'lit' in info and info['lit'][1] in names: note += f'  <{names[info["lit"][1]]}>'
        out.append(f"{0x08000000+off:08x}: {t}{note}")
        off += n
        if stop_at_ret and info.get('ret'): break
    return '\n'.join(out)
