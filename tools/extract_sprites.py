"""Decode Pokemon front and back sprites and menu icons from your own ROM into PNG atlases for the Coach app.

The tables come from the ROM header (0x08000128 front pictures, 0x0800012C back pictures, 0x08000130 palettes,
0x08000138 icons, 0x0800013C icon palette numbers, 0x08000140 icon palettes). Front and back pictures are
LZ77-compressed 64x64 4bpp tiles sharing one compressed 16-color palette; icons are two uncompressed 32x32 4bpp
frames (the menu animation), kept one above the other in 32x64 cells.

The output is game art: keep it on your own device or in a private page. It is not committed to the
repository (app/sprites/ is in .gitignore).

usage: python3 tools/extract_sprites.py app/sprites
"""
import json
import os
import struct
import sys
import zlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rom import rom, u8, u16, u32, isptr  # noqa: E402

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join('app', 'sprites')
G = 0x08000000
FRONT, BACK, PALS, ICONS, ICON_PAL_IDS, ICON_PALS = (u32(a) - G for a in (0x128, 0x12C, 0x130, 0x138, 0x13C, 0x140))
NAMES = u32(0x144) - G
N_SPECIES = 1376


def lz77(off):
    """GBA BIOS LZ77 (type 0x10)"""
    if rom[off] != 0x10:
        return None
    size = rom[off + 1] | rom[off + 2] << 8 | rom[off + 3] << 16
    out = bytearray()
    p = off + 4
    while len(out) < size:
        flags = rom[p]
        p += 1
        for bit in range(8):
            if len(out) >= size:
                break
            if flags & (0x80 >> bit):
                b1, b2 = rom[p], rom[p + 1]
                p += 2
                n = (b1 >> 4) + 3
                disp = ((b1 & 0xF) << 8 | b2) + 1
                for _ in range(n):
                    out.append(out[-disp])
            else:
                out.append(rom[p])
                p += 1
    return bytes(out)


def palette(raw):
    cols = []
    for k in range(16):
        c = raw[2 * k] | raw[2 * k + 1] << 8
        r, g, b = c & 31, c >> 5 & 31, c >> 10 & 31
        cols.append((r * 255 // 31, g * 255 // 31, b * 255 // 31, 0 if k == 0 else 255))
    return cols


def tiles_to_rgba(data, width_tiles, height_tiles, pal):
    w, h = width_tiles * 8, height_tiles * 8
    px = [[(0, 0, 0, 0)] * w for _ in range(h)]
    for t in range(width_tiles * height_tiles):
        tx, ty = t % width_tiles, t // width_tiles
        for y in range(8):
            for x in range(0, 8, 2):
                byte = data[t * 32 + y * 4 + x // 2]
                px[ty * 8 + y][tx * 8 + x] = pal[byte & 0xF]
                px[ty * 8 + y][tx * 8 + x + 1] = pal[byte >> 4]
    return px


def write_png(path, pixels):
    h, w = len(pixels), len(pixels[0])
    raw = bytearray()
    for row in pixels:
        raw.append(0)
        for p in row:
            raw.extend(p)
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(bytes(raw), 9)) + chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)
    return len(png)


def blank(px):
    return all(p[3] == 0 for row in px for p in row)


os.makedirs(OUT, exist_ok=True)
icon_pal_count = max(u8(ICON_PAL_IDS + s) for s in range(N_SPECIES)) + 1
icon_pals = []
for k in range(icon_pal_count):
    p = u32(ICON_PALS + 8 * k)
    icon_pals.append(palette(rom[p - G:p - G + 32]) if isptr(p) else palette(bytes(32)))

fronts, backs, icons, index = [], [], [], {}
for s in range(1, N_SPECIES):
    if rom[NAMES + 11 * s] in (0xFF, 0xAC):      # unnamed slot
        continue
    entry = {}
    fp, pp = u32(FRONT + 8 * s), u32(PALS + 8 * s)
    if isptr(fp) and isptr(pp):
        data, praw = lz77(fp - G), lz77(pp - G)
        if data and praw and len(data) >= 2048:
            pal = palette(praw)
            px = tiles_to_rgba(data, 8, 8, pal)
            if not blank(px):
                entry['f'] = len(fronts)
                fronts.append(px)
                bp = u32(BACK + 8 * s)
                bdata = lz77(bp - G) if isptr(bp) else None
                if bdata and len(bdata) >= 2048:
                    bpx = tiles_to_rgba(bdata, 8, 8, pal)
                    if not blank(bpx):
                        entry['b'] = len(backs)
                        backs.append(bpx)
    ip = u32(ICONS + 4 * s)
    if isptr(ip):
        o = ip - G
        px = tiles_to_rgba(rom[o:o + 1024], 4, 8, icon_pals[u8(ICON_PAL_IDS + s)])
        if not blank(px[:32]):
            entry['i'] = len(icons)
            icons.append(px)
    if entry:
        index[s] = entry


def atlas(sprites, size, cols, height=None):
    height = height or size
    rows = (len(sprites) + cols - 1) // cols
    out = [[(0, 0, 0, 0)] * (cols * size) for _ in range(rows * height)]
    for k, px in enumerate(sprites):
        ox, oy = (k % cols) * size, (k // cols) * height
        for y in range(height):
            out[oy + y][ox:ox + size] = px[y]
    return out, rows


FRONT_COLS, ICON_COLS = 32, 40
fa, front_rows = atlas(fronts, 64, FRONT_COLS)
ba, back_rows = atlas(backs, 64, FRONT_COLS)
ia, icon_rows = atlas(icons, 32, ICON_COLS, 64)
a = write_png(os.path.join(OUT, 'front.png'), fa)
c = write_png(os.path.join(OUT, 'back.png'), ba)
b = write_png(os.path.join(OUT, 'icons.png'), ia)
with open(os.path.join(OUT, 'index.json'), 'w') as f:
    json.dump({'frontCols': FRONT_COLS, 'frontRows': front_rows, 'backRows': back_rows, 'iconCols': ICON_COLS, 'iconRows': icon_rows,
               'iconFrames': 2, 'species': index}, f, separators=(',', ':'))
print(f'{len(fronts)} front sprites ({a // 1024} KB), {len(backs)} back sprites ({c // 1024} KB), '
      f'{len(icons)} two-frame icons ({b // 1024} KB), {icon_pal_count} icon palettes')
