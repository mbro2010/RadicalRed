"""Load the Radical Red ROM and provide small helpers for reading it.

The ROM is never stored in this repository. Point the tools at your own copy:

    export RR_ROM=/path/to/radicalred-4.1.gba

Every address used by these tools was found in Radical Red 4.1. A different
version will have different addresses, so the loader warns when the file
doesn't match the version the tools were written against.
"""
import hashlib
import os
import re
import struct
import sys

EXPECTED_SHA1 = '964f951a0fdaf209e4ea1344883ef0d557bb3a80'  # Radical Red 4.1 (FireRed BPRE rev 0 base)

ROM_PATH = os.environ.get('RR_ROM') or os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'rom', 'radicalred.gba')
if not os.path.exists(ROM_PATH):
    sys.exit(f'ROM not found at {ROM_PATH}. Set RR_ROM to the path of your Radical Red 4.1 ROM.')
rom = open(ROM_PATH, 'rb').read()
if hashlib.sha1(rom).hexdigest() != EXPECTED_SHA1:
    print(f'warning: {ROM_PATH} is not the Radical Red 4.1 ROM these tools were written for; '
          'table addresses may be wrong.', file=sys.stderr)

# ---- Gen 3 text encoding (international charmap) ----
cm = {0x00: ' '}
for i, c in enumerate('0123456789'): cm[0xA1 + i] = c
for i, c in enumerate('ABCDEFGHIJKLMNOPQRSTUVWXYZ'): cm[0xBB + i] = c
for i, c in enumerate('abcdefghijklmnopqrstuvwxyz'): cm[0xD5 + i] = c
cm.update({0xAB: '!', 0xAC: '?', 0xAD: '.', 0xAE: '-', 0xAF: '·', 0xB0: '…', 0xB1: '“', 0xB2: '”', 0xB3: '‘', 0xB4: "'",
           0xB5: '♂', 0xB6: '♀', 0xB7: '$', 0xB8: ',', 0xB9: '×', 0xBA: '/', 0xF0: ':', 0x5C: '(', 0x5D: ')', 0x1B: 'é',
           0x2D: '&', 0x2E: '+', 0x35: '=', 0x36: ';', 0x51: '¿', 0x52: '¡', 0x5A: 'Í', 0x5B: '%', 0x53: 'Pk', 0x54: 'Mn',
           0xFE: '\n'})
inv = {v: k for k, v in cm.items() if len(v) == 1 and v != '\n'}


def enc(text):
    """encode text in the game's character set"""
    return bytes(inv[c] for c in text)


def dec(b, stop=True):
    """decode game text; control codes are shown as {FC}/{FDxx}"""
    out = []
    i = 0
    while i < len(b):
        x = b[i]
        if x == 0xFF and stop:
            break
        if x == 0xFC:
            out.append('{FC}'); i += 2; continue
        if x == 0xFD:
            out.append('{FD%02X}' % b[i + 1] if i + 1 < len(b) else '{FD}'); i += 2; continue
        out.append(cm.get(x, '{%02X}' % x)); i += 1
    return ''.join(out)


def s(off, n=64): return dec(rom[off:off + n])
def u8(o): return rom[o]
def u16(o): return struct.unpack_from('<H', rom, o)[0]
def s8(o): return struct.unpack_from('<b', rom, o)[0]
def u32(o): return struct.unpack_from('<I', rom, o)[0]
def isptr(v): return 0x08000000 <= v < 0x08000000 + len(rom)
def find(b): return [m.start() for m in re.finditer(re.escape(b), rom)]


def refs(off):
    """4-byte-aligned places in the ROM holding a pointer to off (code literal pools, tables)"""
    p = struct.pack('<I', 0x08000000 + off)
    return [o for o in find(p) if o % 4 == 0]


def refs_any(off):
    """all places holding a pointer to off, aligned or not (event scripts store unaligned pointers)"""
    return find(struct.pack('<I', 0x08000000 + off))


def lit_users(val, lo=0x1000000, hi=0x10D0000):
    """code offsets of 'ldr rX,[pc,#imm]' instructions whose literal equals val (default: the added engine code)"""
    out = []
    for off in range(lo, hi, 2):
        h = struct.unpack_from('<H', rom, off)[0]
        if h >> 11 == 0b01001:
            addr = ((0x08000000 + off + 4) & ~2) + (h & 0xFF) * 4 - 0x08000000
            if 0 <= addr < len(rom) - 4 and struct.unpack_from('<I', rom, addr)[0] == val:
                out.append(off)
    return out
