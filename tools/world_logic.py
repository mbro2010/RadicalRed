"""What's open when, worked out from the ROM the way a player walks it.

A walker goes over every map tile by tile with the game's movement rules (pokefirered field_player_avatar.c and
event_object_movement.c): collision bits, elevation (bridges and water sit at other heights), one-way ledges,
walls on one side of a tile, doors and stairs (warps), and the seams between maps (connections). Water needs Surf
(the Soul Badge and HM03), waterfalls Waterfall (HM07); a Cut tree needs the Cascade Badge and HM01, a Rock Smash
rock the Marsh Badge and HM06, a Strength boulder the Rainbow Badge and HM04 (Radical Red's own scripts at
0x904DDC8, 0x904DE08 and 0x904DE58, and its field-move badge table at 0x9148738: no Pokemon has to know the move).

People stand in the way unless the flag that hides them is set; triggers (coord events) run while their variable has
their value; a trigger that walks you back stays in the way until something changes its variable. Every script you
can reach (people you can talk to, triggers you step on, item balls, hidden items, the map's own on-load and
on-frame scripts) is run by a small interpreter: flags, variables, items, trainer wins, objects removed, tiles
changed (setmetatile), warps. Route trainers are beaten as you meet them; boss fights (the Coach's boss table) are not:
the walker stops at them and records where each one becomes available. Then the bosses are beaten one at a time (an
optional fight you can reach first, else the next in the run's order), and after each one the walk starts over: what
each fight opens is the difference.

The interpreter follows every choice of a menu (multichoice) or a random roll; caps a variable at what scripts can tell
apart; hides an item ball once picked up; follows elevators (setdynamicwarp) and the temporary variables a map's own
scripts set; treats a door any switch state opens as open and a door that shuts behind you as passed; and walks you
where a room's script walks you in. NOTES.md ("What's open when") has the details and what it found.

Set WL_TRACE=1 to print what changes each round, WL_CKPT=file to save after every fight and pick up from there.

usage: RR_ROM=... python3 -I tools/world_logic.py data app/rrdata.json [hardcore|normal] order.json [world.json] > report.txt
(order.json: node tools/fight_order.js app/rrdata.json hardcore)
"""
import json
import os
import sys
from collections import deque, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rom import rom, u16, u32, isptr  # noqa: E402
from script_walk import G, L, BATTLE_LEN, BATTLE_CONT  # noqa: E402
from world_maps import load  # noqa: E402

DATA = sys.argv[1] if len(sys.argv) > 1 else 'data'
APPDATA = sys.argv[2] if len(sys.argv) > 2 else 'app/rrdata.json'
MODE = sys.argv[3] if len(sys.argv) > 3 else 'hardcore'
MAPINFO = {(m['group'], m['num']): m for m in json.load(open(os.path.join(DATA, 'maps.json')))}
APP = json.load(open(APPDATA))
ITEMS = json.load(open(os.path.join(DATA, 'items.json')))
BOSS_IDS = {b['id'] for b in APP['bosses']}

# ---------------- tiles ----------------
SURFABLE = {0x10, 0x11, 0x12, 0x15, 0x50, 0x51, 0x52, 0x53}
WATERFALL = 0x13
LEDGE = {0x38: 'E', 0x39: 'W', 0x3A: 'N', 0x3B: 'S', 0x3E: 'S', 0x3F: 'S'}
DIRS = {'N': (0, -1), 'S': (0, 1), 'W': (-1, 0), 'E': (1, 0)}
OPP = {'N': 'S', 'S': 'N', 'W': 'E', 'E': 'W'}
WALL = {'N': {0x32, 0x34, 0x35}, 'S': {0x33, 0x36, 0x37}, 'E': {0x30, 0x34, 0x36}, 'W': {0x31, 0x35, 0x37}}
CONN = {1: 'S', 2: 'N', 3: 'W', 4: 'E'}
DOORISH = set(range(0x60, 0x70))
# warps that work when you step on them (IsWarpMetatileBehavior, arrow and stair warps): doors, ladders, cave doors,
# arrow mats, holes, escalators, stairs. A warp on plain floor is only where you arrive (Fly, scripts, the way back).
WARP_BEH = {0x60, 0x61, 0x62, 0x63, 0x64, 0x65, 0x66, 0x67, 0x69, 0x6A, 0x6B, 0x6C, 0x6D, 0x6E, 0x6F, 0x71}
GRASS = {0x02, 0x03, 0x07}
# objects: Cut tree, Rock Smash rock, Strength boulder (graphics ids)
CUT_TREE, SMASH_ROCK, BOULDER = 95, 96, 97
# movement types that don't stand still (they don't hold a tile): wandering, walking back and forth, and the walk
# sequences 0x1D-0x34 that patrol a small loop (the Gengar on the post-game Pokemon Tower floor)
WANDERS = {2, 3, 4, 5, 6} | set(range(0x19, 0x35))
FACING = {7: 'N', 8: 'S', 9: 'W', 10: 'E', 13: 'SN', 14: 'WE', 15: 'NW', 16: 'NE', 17: 'SW', 18: 'SE', 19: 'SNW', 20: 'SNE', 21: 'NWE', 22: 'SWE'}
HM = {'cut': 0x153, 'surf': 0x155, 'strength': 0x156, 'smash': 0x158, 'waterfall': 0x159, 'dive': 0x15A}
BADGE = {'cut': 0x821, 'surf': 0x824, 'strength': 0x823, 'smash': 0x825}

_maps = {}


def MAP(key):
    if key not in _maps:
        try:
            m = load(*key) if key in MAPINFO else None
        except Exception:
            m = None
        if m:
            m['warp_at'] = defaultdict(list)
            for w in m['warps']:
                m['warp_at'][(w['x'], w['y'])].append(w)
            m['trig_at'] = defaultdict(list)
            for i, c in enumerate(m['coords']):
                if isptr(c['script']) and c['script'] != G and c['var']:
                    m['trig_at'][(c['x'], c['y'])].append(i)
        _maps[key] = m
    return _maps[key]


def name(key):
    return (MAPINFO.get(key) or {}).get('name') or f'map {key}'


def item_name(i):
    return ITEMS.get(str(i)) or f'item {i}'


class State:
    def __init__(self):
        self.flags, self.vars, self.items, self.beaten, self.tiles = set(), {}, set(), set(), {}
        self.starts = []

    def copy(self):
        s = State()
        s.flags, s.vars, s.items, s.beaten, s.tiles = set(self.flags), dict(self.vars), set(self.items), set(self.beaten), dict(self.tiles)
        s.starts = list(self.starts)
        return s

    def can(self, what):
        if what in BADGE and BADGE[what] not in self.flags:
            return False
        return HM[what] in self.items

    def key(self):
        # (the start points too: a ferry trip adds one and nothing else)
        return (frozenset(self.flags), frozenset(self.vars.items()), frozenset(self.items), frozenset(self.beaten), frozenset(self.tiles.items()),
                len(self.starts))


# ---------------- scripts ----------------
TABLE = {0: (1, 0, 0), 1: (0, 1, 0), 2: (0, 0, 1), 3: (1, 1, 0), 4: (0, 1, 1), 5: (1, 0, 1)}
PLAYER = (0xFF, 0x7F)


class Out:
    def __init__(self):
        self.set, self.clear, self.vars, self.items, self.mons, self.beat = set(), set(), {}, [], [], set()
        self.boss = None
        self.moved_player = False
        self.warp = None
        self.warps = []              # every place a path of the script sends you (warps, and the dynamic warp an elevator sets)
        self.tiles = []
        self.statics = []
        self.trades = 0
        self.stop = None
        self.wrote = set()           # variables the script set
        self.tvars = {}              # the temporary variables (0x4000-0x400F) it leaves, for the map it runs on
        self.bosses = set()          # every boss some path of the script meets
        self.puzzles = set()         # puzzle and rental battles (won with their Pokemon)
        self.money = 0
        self.found = False           # picked up an item ball (callstd 1)
        self.disp = (0, 0)           # where the script walks the player (applymovement), from where it starts

    def copy(self):
        o = Out()
        o.set, o.clear, o.vars, o.items, o.mons, o.beat = set(self.set), set(self.clear), dict(self.vars), list(self.items), list(self.mons), set(self.beat)
        o.boss, o.moved_player, o.warp, o.tiles, o.statics = self.boss, self.moved_player, self.warp, list(self.tiles), list(self.statics)
        o.warps = list(self.warps)
        o.trades, o.stop, o.bosses, o.puzzles, o.money = self.trades, self.stop, set(self.bosses), set(self.puzzles), self.money
        o.wrote = set(self.wrote)
        o.found = self.found
        o.disp = self.disp
        o.tvars = dict(self.tvars)
        return o


def objflag(mapkey, local):
    m = MAP(mapkey)
    if not m:
        return 0
    for o in m['objects']:
        if o['id'] == local:
            return o['flag']
    return 0


# callnatives that check your party before a battle (Hardcore Clair: no Fairy types, no Altaria, Absol or Audino with its
# Mega Stone, at 0x9077E3C) or for a scene (the Viridian helper who lets a Pokemon out of its ball to walk behind you,
# 0x909921C): the walk assumes you bring a party that passes
PARTY_CHECKS = {0x9077E3D, 0x909921D}
# the species walking behind you (set in code once that helper lets one out, flag 0x1055). Four people want to see a
# certain one: a Lucario (Celadon: the Lucarionite), a Yamper (Vermilion: Wish Pieces), a Sharpedo (Route 12: the
# Sharpedonite) and a Swampert (Saffron: the Swampertite, then Gian's battle). You pick it, so both answers are followed
FOLLOWER = 0x5130
# set from the start; cutscenes clear it for a moment to show their extras, then set it again: it stays set
CUTSCENE_FLAGS = {0x200}
MENU_OPS = {0x6F, 0x70, 0x71}       # multichoice, multichoicedefault, multichoicegrid
MAX_CHOICES = 8                     # options tried at each menu (game menus have 2 to 7)
PUZZLE_FLAGS = (0x1042, 0x104B)     # Radical Red's puzzle battle (3 of 6 rentals) and rental battle (a fixed team)


class Ctx:
    """One path through a script: its own flags, variables, items, wins and call stack."""
    def __init__(self, S=None):
        if S is not None:
            self.flags, self.vars, self.items, self.beaten = set(S.flags), dict(S.vars), set(S.items), set(S.beaten)
            self.r, self.stack, self.menus, self.out = 0, [], frozenset(), Out()

    def fork(self):
        c = Ctx()
        c.flags, c.vars, c.items, c.beaten = set(self.flags), dict(self.vars), set(self.items), set(self.beaten)
        c.r, c.stack, c.menus, c.out = self.r, list(self.stack), self.menus, self.out.copy()
        return c


_reads = {}


def reads(start):
    """What a script can look at, from a walk of every path through it: flags it checks, variables it compares or
    copies, items it checks, trainers it battles or checks. Its result depends on nothing else in the state."""
    o0 = start - G if start >= G else start
    if o0 in _reads:
        return _reads[o0]
    flags, vars_, items, trainers = set(), set(), set(), set()
    seen, todo, n = set(), [o0], 0
    while todo and n < 30000:
        o = todo.pop()
        while 0 <= o < len(rom) - 16 and o not in seen and n < 30000:
            seen.add(o); n += 1
            op = rom[o]
            if op == 0x5C:
                typ = rom[o + 1]
                trainers.add(u16(o + 2))
                cont = BATTLE_CONT.get(typ)
                if cont and isptr(u32(o + cont)):
                    todo.append(u32(o + cont) - G)
                o += 2 + BATTLE_LEN.get(typ, 12)
                continue
            if op not in L:
                break
            a1, a2 = u16(o + 1), u16(o + 3)
            if op == 0x2B:
                flags.add(a1)
            elif op == 0x21 and a1 >= 0x4000:
                vars_.add(a1)
            elif op == 0x22:
                vars_.update(v for v in (a1, a2) if v >= 0x4000)
            elif op in (0x19, 0x1A) and a2 >= 0x4000:
                vars_.add(a2)
            elif op in (0x17, 0x18):
                vars_.add(a1)
            elif op in (0x47, 0x4A):
                items.add(a1)
            elif op == 0x60:
                trainers.add(a1)
            if op in (0x04, 0x05) and isptr(u32(o + 1)):
                todo.append(u32(o + 1) - G)
            if op in (0x06, 0x07) and isptr(u32(o + 2)):
                todo.append(u32(o + 2) - G)
            if op in (0x02, 0x03, 0x05, 0x0C, 0x0D):
                break
            o += 1 + L[op]
    r = (tuple(sorted(flags)), tuple(sorted(vars_)), tuple(sorted(items)), tuple(sorted(trainers)))
    _reads[o0] = r
    return r


_runs = {}


def run(start, S, mapkey, fight=None, max_steps=4000):
    """Run a script on state S (cached on just the part of the state it can look at: reads())."""
    fl, vs, its, trs = reads(start)
    key = (start, mapkey, fight, tuple(f in S.flags for f in fl), tuple(S.vars.get(v, 0) for v in vs),
           tuple(i in S.items for i in its), tuple(t in S.beaten for t in trs))
    hit = _runs.get(key)
    if hit is None:
        hit = _runs[key] = run_now(start, S, mapkey, fight, max_steps)
    return hit


def run_now(start, S, mapkey, fight=None, max_steps=4000):
    """Run a script on state S. fight: the boss being beaten now (its battle counts as won). A menu (multichoice) or a
    random roll splits the run: every choice is followed, and the result is what any of them can do (merge)."""
    budget = [max_steps * 6]
    todo = [(start - G if start >= G else start, Ctx(S))]
    outs = []
    while todo and budget[0] > 0:
        o, c = todo.pop()
        if not _path(o, c, S, mapkey, fight, max_steps, budget, todo):
            outs.append(c.out)
    return merge(outs) if outs else Out()


def merge(outs):
    """What any path of a script can do. A boss stops the script only if every path meets one."""
    if len(outs) == 1:
        return outs[0]
    m = Out()
    for o in outs:
        m.bosses |= o.bosses
        m.puzzles |= o.puzzles
    done = [o for o in outs if o.boss is None]
    if not done:
        m.boss, m.stop = outs[0].boss, 'boss'
        return m
    clear = None
    for o in done:
        m.set |= o.set
        clear = set(o.clear) if clear is None else clear & o.clear
        for k, v in o.vars.items():
            m.vars[k] = max(m.vars.get(k, 0), v)
        m.items += [x for x in o.items if x not in m.items]
        m.mons += [x for x in o.mons if x not in m.mons]
        m.beat |= o.beat
        m.warp = m.warp or o.warp
        m.warps += [w for w in o.warps if w not in m.warps]
        m.tiles += [t for t in o.tiles if t not in m.tiles]
        m.statics += [x for x in o.statics if x not in m.statics]
        m.money = max(m.money, o.money)
        m.wrote |= o.wrote
        m.found = m.found or o.found
        m.disp = m.disp if m.disp != (0, 0) else o.disp
        for k, v in o.tvars.items():
            m.tvars[k] = max(m.tvars.get(k, 0), v)
    m.clear = (clear or set()) - m.set
    m.moved_player = all(o.moved_player for o in done)
    m.stop = done[0].stop
    return m


def _path(o, ctx, S, mapkey, fight, max_steps, budget, todo):
    """Follow one path from o. Returns True when it split at a menu (its choices are queued in todo)."""
    out = ctx.out
    flags, vars_, items, beaten = ctx.flags, ctx.vars, ctx.items, ctx.beaten
    r = ctx.r
    stack = ctx.stack
    steps = 0
    val = lambda v: vars_.get(v, 0) if v >= 0x4000 else v
    while o is not None and steps < max_steps and budget[0] > 0 and 0 <= o < len(rom) - 16:
        steps += 1
        budget[0] -= 1
        op = rom[o]
        if op == 0x5C:
            typ, tid = rom[o + 1], u16(o + 2)
            cont = BATTLE_CONT.get(typ)
            puzzle = any(f in flags for f in PUZZLE_FLAGS)     # a puzzle or rental battle: their Pokemon, not yours
            if tid in BOSS_IDS and tid not in beaten and tid != fight and not puzzle:
                out.boss = tid
                out.bosses.add(tid)
                out.stop = 'boss'
                return False
            if typ == 9:
                vars_[0x800D] = 0                               # the early-rival battle reports a win as 0
            if puzzle:
                out.puzzles.add(tid)
            elif tid not in beaten or tid == fight:
                beaten.add(tid); out.beat.add(tid)
                if cont and isptr(u32(o + cont)):
                    o = u32(o + cont) - G
                    continue
            o += 2 + BATTLE_LEN.get(typ, 12)
            continue
        if op not in L:
            out.stop = f'op {op:#x}'
            break
        n = L[op]
        a1 = u16(o + 1) if n >= 2 else 0
        a2 = u16(o + 3) if n >= 4 else 0
        if op in (0x02, 0x0D, 0x0C):
            break
        if op == 0x03:
            if stack:
                o = stack.pop(); continue
            break
        if op in (0x04, 0x05):
            t = u32(o + 1)
            if not isptr(t):
                break
            if op == 0x04:
                stack.append(o + 5)
            o = t - G
            continue
        if op in (0x06, 0x07):
            c, t = rom[o + 1], u32(o + 2)
            if TABLE.get(c, (0, 0, 0))[r] and isptr(t):
                if op == 0x07:
                    stack.append(o + 6)
                o = t - G
                continue
            o += 6
            continue
        if op in (0x08, 0x09, 0x0A, 0x0B):
            std = rom[o + 1] if op in (0x08, 0x09) else rom[o + 2]
            go = op in (0x08, 0x09) or TABLE.get(rom[o + 1], (0, 0, 0))[r]
            if go and std in (0, 1):
                it = vars_.get(0x8000, 0)
                if it:
                    items.add(it); out.items.append((it, vars_.get(0x8001, 1)))
                vars_[0x800D] = 1
                if std == 1:
                    out.found = True       # an item ball: the standard script removes it (its flag is set)
            elif go and std == 5:      # MSGBOX_YESNO: follow both answers (Saffron's kid only battles if you say no twice)
                if o in ctx.menus:
                    break
                for v in (1, 0):
                    c2 = ctx.fork()
                    c2.vars[0x800D] = v
                    c2.menus = ctx.menus | {o}
                    c2.r = r
                    todo.append((o + 1 + n, c2))
                return True
            if op == 0x08 and go:
                break
            o += 1 + n
            continue
        if op in (0x16, 0x17, 0x18, 0x19, 0x1A):
            out.wrote.add(a1)
        if op == 0x16:
            vars_[a1] = a2
        elif op == 0x17:
            vars_[a1] = vars_.get(a1, 0) + a2
        elif op == 0x18:
            vars_[a1] = vars_.get(a1, 0) - a2
        elif op == 0x19:
            vars_[a1] = vars_.get(a2, 0)
        elif op == 0x1A:
            vars_[a1] = val(a2)
        elif op == 0x21 and a1 == FOLLOWER and o not in ctx.menus:
            for v in (1, 0):
                c2 = ctx.fork()
                c2.menus = ctx.menus | {o}
                c2.r = v
                todo.append((o + 1 + n, c2))
            return True
        elif op == 0x21:
            x = val(a1)
            r = 0 if x < a2 else 1 if x == a2 else 2
        elif op == 0x22:
            x, y = val(a1), val(a2)
            r = 0 if x < y else 1 if x == y else 2
        elif op == 0x1C:
            r = 1
        elif op == 0x29:
            flags.add(a1); out.set.add(a1); out.clear.discard(a1)
        elif op == 0x2A:
            flags.discard(a1); out.clear.add(a1); out.set.discard(a1)
        elif op == 0x2B:
            r = 1 if a1 in flags else 0
        elif op == 0x44:
            items.add(a1); out.items.append((a1, a2))
        elif op in (0x47, 0x4A):
            vars_[0x800D] = 1 if a1 in items else 0
        elif op == 0x46:
            vars_[0x800D] = 1
        elif op == 0x23 and u32(o + 1) in PARTY_CHECKS:
            vars_[0x800D] = 1          # a party check you can meet (Hardcore Clair: no Fairy types): you meet it
        elif op == 0x25 and a1 == 0xF5:
            vars_[0x800D] = 1          # special 0xF5: you pick your Pokemon for a tag or puzzle battle (0 means you backed out)
        elif op == 0x25 and a1 == 0x187:
            vars_[0x800D] = 0          # special 0x187: the ferry can sail (2 would turn it back)
        elif op == 0x25 and a1 == 0x17B:
            # special 0x17B, the Seagallop ferry scene: it lands you at sSeagallopSpawnLocations[VAR_0x8006] (0x46AEFC) in
            # code, not by a script warp. Every Seagallop trip ends here (the sailors at Vermilion's harbor and on each island).
            d = vars_.get(0x8006, 0)
            if 0 <= d < len(SEAGALLOP):
                g, n, x, y = SEAGALLOP[d]
                out.warp = ((g, n), 0xFF, x, y)
                out.warps.append(out.warp)
        elif op == 0x7C:
            vars_[0x800D] = 0
        elif op == 0x43:
            vars_[0x800D] = 6
        elif op == 0x92:
            vars_[0x800D] = 1
        elif op == 0x6E:
            vars_[0x800D] = 1
        elif op in MENU_OPS or op == 0x8F:
            # a menu (or a random roll): follow every choice
            if o in ctx.menus:
                break                                           # back at a menu this path already chose from
            n_choices = MAX_CHOICES if op in MENU_OPS else max(1, min(MAX_CHOICES, a1))
            for v in range(n_choices):
                c2 = ctx.fork()
                c2.vars[0x800D] = v
                c2.menus = ctx.menus | {o}
                c2.r = r
                todo.append((o + 1 + n, c2))
            return True
        elif op == 0x26:
            # specialvar: GetBattleOutcome (special 0xB4) says you won the battle that just ran (a ghost Marowak, a
            # Snorlax); the rest answer 0
            # special 13 reads your lead's friendship (Morty's Mega Stone wants it maxed: you can get there)
            vars_[a1] = 1 if a2 == 0xB4 else 255 if a2 == 0x0D else 0
        elif op == 0x79:
            out.mons.append((u16(o + 1), rom[o + 3], 'gift'))
            vars_[0x800D] = 0
        elif op == 0x7A:
            out.mons.append((a1, 0, 'egg'))
        elif op == 0xB6:
            out.statics.append((a1, rom[o + 3]))
        elif op == 0x90:
            out.money += u32(o + 1)
        elif op == 0x4F:
            if a1 in PLAYER:
                out.moved_player = True
                dx, dy = steps_of(u32(o + 3))
                out.disp = (out.disp[0] + dx, out.disp[1] + dy)
        elif op == 0x53:
            f = objflag(mapkey, a1)
            if f:
                flags.add(f); out.set.add(f)
        elif op in (0x39, 0x3A, 0x3B, 0x3D, 0xD1):
            out.warp = ((rom[o + 1], rom[o + 2]), rom[o + 3], u16(o + 4), u16(o + 6))
            out.warps.append(out.warp)
        elif op == 0x3C:
            out.warp = ((rom[o + 1], rom[o + 2]), None, None, None)
            out.warps.append(out.warp)
        elif op in (0x3E, 0x3F):
            # setwarp / setdynamicwarp: where a door with no fixed destination (an elevator's, 127.127) takes you next
            out.warps.append(((rom[o + 1], rom[o + 2]), rom[o + 3], u16(o + 4), u16(o + 6)))
        elif op == 0xA2:
            out.tiles.append((mapkey, u16(o + 1), u16(o + 3), u16(o + 5), u16(o + 7)))
        elif op == 0x60:
            r = 1 if a1 in beaten else 0
        elif op == 0x61:
            beaten.add(a1); out.beat.add(a1)
        o += 1 + n
    for f in flags - S.flags:
        out.set.add(f)
    out.set -= set(PUZZLE_FLAGS)        # the game clears them when the battle ends
    for k, v in vars_.items():
        # temporary variables (0x4000-0x400F, cleared on every map change) and special ones (0x8000+) don't last;
        # every variable the script wrote is kept, so a cached result works for any state that reads the same
        if 0x4010 <= k < 0x8000 and (k in out.wrote or S.vars.get(k, 0) != v):
            out.vars[k] = v
        elif 0x4000 <= k < 0x4010 and k in out.wrote:
            out.tvars[k] = v
    return False


# movement actions that step (pokefirered event_object_movement.h): walk slower, slow, normal (0x08-0x13), jump two
# tiles (0x14-0x17), walk fast (0x1D-0x20); 0xFE ends the list
_STEP = {}
for _base, _n in ((0x08, 1), (0x0C, 1), (0x10, 1), (0x14, 2), (0x1D, 1)):
    for _k, (_dx, _dy) in enumerate(((0, 1), (0, -1), (-1, 0), (1, 0))):
        _STEP[_base + _k] = (_dx * _n, _dy * _n)


def steps_of(ptr):
    """Where a movement list takes whoever follows it: (dx, dy)."""
    if not isptr(ptr):
        return (0, 0)
    o, dx, dy = ptr - G, 0, 0
    for _ in range(64):
        b = rom[o]
        if b == 0xFE:
            break
        sx, sy = _STEP.get(b, (0, 0))
        dx += sx; dy += sy
        o += 1
    return (dx, dy)


_shift = {}


def entry_shift(mk):
    """How far a map's on-frame scripts walk you when you come in (the Elite Four rooms walk you off the door)."""
    if mk not in _shift:
        d = (0, 0)
        for sc in MAP(mk)['mapscripts']:
            if sc['type'] == 2 and isptr(sc['script']):
                out = run_now(sc['script'], State(), mk)
                if out.disp != (0, 0):
                    d = out.disp
                    break
        _shift[mk] = d
    return _shift[mk]


_caps = {}


def var_cap(k):
    """The highest value of a variable that any script can tell apart: one more than the largest number it's compared
    with (a counter one script keeps raising, like 0x5137, would never settle otherwise). None: no cap (it's compared
    with another variable)."""
    if not _caps:
        from script_walk import header, entry_points
        top, free = defaultdict(int), set()
        for key in MAPINFO:
            try:
                eps = entry_points(header(*key))
            except Exception:
                continue
            for _kind, sp in eps:
                seen, todo, n = set(), [sp - G], 0
                while todo and n < 5000:
                    o = todo.pop()
                    while 0 <= o < len(rom) - 16 and o not in seen and n < 5000:
                        seen.add(o); n += 1
                        op = rom[o]
                        if op == 0x5C:
                            cont = BATTLE_CONT.get(rom[o + 1])
                            if cont and isptr(u32(o + cont)):
                                todo.append(u32(o + cont) - G)
                            o += 2 + BATTLE_LEN.get(rom[o + 1], 12)
                            continue
                        if op not in L:
                            break
                        if op == 0x21 and u16(o + 1) >= 0x4000:
                            top[u16(o + 1)] = max(top[u16(o + 1)], u16(o + 3))
                        elif op == 0x22:
                            free.update((u16(o + 1), u16(o + 3)))
                        elif op in (0x19, 0x1A) and u16(o + 3) >= 0x4000:
                            free.add(u16(o + 3))      # copied into another variable: keep its value
                        if op in (0x04, 0x05) and isptr(u32(o + 1)):
                            todo.append(u32(o + 1) - G)
                        if op in (0x06, 0x07) and isptr(u32(o + 2)):
                            todo.append(u32(o + 2) - G)
                        if op in (0x02, 0x03, 0x05, 0x0C, 0x0D):
                            break
                        o += 1 + L[op]
        _caps['top'], _caps['free'] = top, free
    if k in _caps['free']:
        return None
    return _caps['top'].get(k, 0) + 1


def apply(S, out):
    """Fold a script's effects into the state; True if anything changed."""
    before = S.key()
    S.flags |= out.set
    S.flags -= out.clear - CUTSCENE_FLAGS
    for k, v in out.vars.items():
        # story variables move forward: a script that would set one back (a choice among several, a scene replayed)
        # doesn't undo progress; past what any script can tell apart, more makes no difference
        cap = var_cap(k)
        if cap is not None:
            v = min(v, cap)
        if v > S.vars.get(k, 0):
            S.vars[k] = v
    for it, _q in out.items:
        S.items.add(it)
    S.beaten |= out.beat
    for (mk, x, y, mt, col) in out.tiles:
        old = S.tiles.get((mk, x, y))
        if old is not None and old[1] == 0 and col != 0:
            continue     # a door a switch can open stays open: you can flip the switch back whenever you like
        m = MAP(mk)
        if col != 0 and m and 0 <= y < m['h'] and 0 <= x < m['w'] and not m['grid'][y][x][1]:
            continue     # a door that shuts behind you (an Elite Four room): you were already through it
        S.tiles[(mk, x, y)] = (mt, col)
    return S.key() != before


# ---------------- one map as the current state sees it ----------------
def tile(m, S, mk, x, y):
    """(metatile, collision, elevation, behavior, encounter type) as the state has it: a script's setmetatile swaps
    the metatile (and with it the behavior) and sets the collision, keeping the elevation."""
    t = m['grid'][y][x]
    ov = S.tiles.get((mk, x, y))
    if ov:
        mt, col = ov
        mt &= 0x3FF
        prim, sec = m['attrs']
        a = prim[mt] if mt < 640 else sec[mt - 640] if mt - 640 < len(sec) else 0
        return (mt, 1 if col else 0, t[2], a & 0x1FF, a >> 16)
    return t


def objects_view(mk, S):
    """Blocking objects (x, y) -> object, boss sight tiles (x, y) -> trainer id, and the objects that walk around
    (x, y) -> object (they hold no tile; you talk to them where they roam), for this state."""
    m = MAP(mk)
    block, sight, roam = {}, {}, {}
    for ob in m['objects']:
        if ob['flag'] and ob['flag'] in S.flags:
            continue
        x, y = ob['x'], ob['y']
        if not (0 <= x < m['w'] and 0 <= y < m['h']):
            continue
        g = ob['gfx']
        if g == CUT_TREE and S.can('cut'):
            continue
        if g == SMASH_ROCK and S.can('smash'):
            continue
        if g == BOULDER and S.can('strength'):
            continue
        if ob['move'] not in WANDERS:
            block[(x, y)] = ob
        else:
            roam[(x, y)] = ob
        tid = trainer_of(ob)
        if tid is not None and tid in BOSS_IDS:
            WHERE.setdefault(tid, set()).add((ob['script'], mk))
        if tid is not None and tid in BOSS_IDS and tid not in S.beaten and ob['sight']:
            for d in FACING.get(ob['move'], 'NSWE' if ob['move'] in (1, 0x17, 0x18) else ''):
                dx, dy = DIRS[d]
                for k in range(1, min(ob['sight'], 8) + 1):
                    tx, ty = x + dx * k, y + dy * k
                    if not (0 <= tx < m['w'] and 0 <= ty < m['h']) or m['grid'][ty][tx][1]:
                        break
                    sight[(tx, ty)] = tid
    return block, sight, roam


_trainer_cache = {}
WHERE = {}   # boss trainer id -> {(script, map)} where its battle starts


def trainer_of(ob):
    sp = ob['script']
    if sp in _trainer_cache:
        return _trainer_cache[sp]
    tid = None
    if isptr(sp):
        o = sp - G
        for _ in range(12):
            op = rom[o]
            if op == 0x5C:
                tid = u16(o + 2)
                break
            if op not in L or op in (0x02, 0x03, 0x05):
                break
            o += 1 + L[op]
    _trainer_cache[sp] = tid
    return tid


# ---------------- the walk ----------------
def walk(S):
    """Everything reachable in state S: tiles per map, and the scripts you can reach (events)."""
    seen = set()
    q = deque()
    for st in S.starts:
        q.append(st)
    reached = defaultdict(set)
    events = {}          # (kind, mapkey, index) -> script offset
    blocked_by = {}      # boss id -> where you meet it
    views = {}

    def view(mk):
        if mk not in views:
            views[mk] = objects_view(mk, S)
        return views[mk]

    trig_cache = {}
    temps = {}

    def var_on(mk, v):
        """A variable as a trigger on this map sees it: the temporary ones (0x4000-0x400F, reset on every map change) are
        what the map's own on-load and on-transition scripts set (a gatehouse sets one when you have the Bicycle)."""
        if not (0x4000 <= v < 0x4010):
            return S.vars.get(v, 0)
        if mk not in temps:
            t = {}
            for sc in MAP(mk)['mapscripts']:
                if sc['type'] in (1, 3) and isptr(sc['script']):
                    t.update(run(sc['script'], S, mk).tvars)
            temps[mk] = t
        return temps[mk].get(v, 0)

    def trigger_ok(mk, x, y):
        """Can you step on (x, y)? Triggers there run first."""
        m = MAP(mk)
        for i in m['trig_at'].get((x, y), ()):
            c = m['coords'][i]
            if var_on(mk, c['var']) != c['value']:
                continue
            key = (mk, i)
            if key not in trig_cache:
                out = run(c['script'], S, mk)
                trig_cache[key] = out
            out = trig_cache[key]
            events[('trigger', mk, i)] = c['script']
            for b in out.bosses:
                blocked_by.setdefault(b, (mk, x, y))
                WHERE.setdefault(b, set()).add((c['script'], mk))
            if out.boss is not None:
                blocked_by.setdefault(out.boss, (mk, x, y))
                WHERE.setdefault(out.boss, set()).add((c['script'], mk))
                return False
            still = out.vars.get(c['var'], out.tvars.get(c['var'], var_on(mk, c['var']))) == c['value']
            if out.moved_player and still and not out.warp:
                return False
        return True

    while q:
        node = q.popleft()
        if node in seen:
            continue
        seen.add(node)
        mk, x, y, z, surf = node
        m = MAP(mk)
        if not m:
            continue
        reached[mk].add((x, y))
        block, sight, _ = view(mk)
        # warps on this tile (only on a door, ladder, stair, arrow mat... tile)
        here = tile(m, S, mk, x, y)
        for w in (m['warp_at'].get((x, y), ()) if here[3] in WARP_BEH else ()):
            if w['to'] != (127, 127) and w['to'][0] != 0:
                dm = MAP(w['to'])
                if dm and w['to_warp'] < len(dm['warps']):
                    dw = dm['warps'][w['to_warp']]
                    if 0 <= dw['x'] < dm['w'] and 0 <= dw['y'] < dm['h']:
                        el = dm['grid'][dw['y']][dw['x']][2]
                        q.append((w['to'], dw['x'], dw['y'], el if el not in (0, 15) else 3, False))
                        if dm['grid'][dw['y']][dw['x']][1]:
                            # you arrive on a solid tile (an Elite Four room's door): the room's own script walks you in
                            ex, ey = dw['x'] + entry_shift(w['to'])[0], dw['y'] + entry_shift(w['to'])[1]
                            if (ex, ey) != (dw['x'], dw['y']) and 0 <= ex < dm['w'] and 0 <= ey < dm['h']:
                                q.append((w['to'], ex, ey, 3, False))
        for d, (dx, dy) in DIRS.items():
            nx, ny, nm, nk = x + dx, y + dy, m, mk
            if not (0 <= nx < m['w'] and 0 <= ny < m['h']):
                hop = None
                for c in m['connections']:
                    if CONN.get(c['dir']) != d:
                        continue
                    t = MAP(c['to'])
                    if not t:
                        continue
                    if d == 'S':
                        tx, ty = nx - c['offset'], 0
                    elif d == 'N':
                        tx, ty = nx - c['offset'], t['h'] - 1
                    elif d == 'W':
                        tx, ty = t['w'] - 1, ny - c['offset']
                    else:
                        tx, ty = 0, ny - c['offset']
                    if 0 <= tx < t['w'] and 0 <= ty < t['h']:
                        hop = (c['to'], tx, ty)
                        break
                if not hop:
                    continue
                nk, nx, ny = hop
                nm = MAP(nk)
            cur = tile(m, S, mk, x, y)
            nt = tile(nm, S, nk, nx, ny)
            nblock, nsight, _ = view(nk)
            # walls on one side
            if cur[3] in WALL[d] or nt[3] in WALL[OPP[d]]:
                continue
            # ledges: jump over to the tile beyond
            if LEDGE.get(nt[3]) == d and not surf:
                jx, jy = nx + dx, ny + dy
                if 0 <= jx < nm['w'] and 0 <= jy < nm['h'] and (jx, jy) not in nblock:
                    jt = tile(nm, S, nk, jx, jy)
                    if not jt[1] and trigger_ok(nk, jx, jy) and (jx, jy) not in nsight:
                        q.append((nk, jx, jy, jt[2] if jt[2] not in (0, 15) else z, False))
                continue
            # a warp tile you walk into (doors, stairs) even when it shows as solid
            is_warp = nt[3] in WARP_BEH and (nx, ny) in nm['warp_at']
            if (nx, ny) in nblock:
                # talk to them (and they may be an obstacle you can clear)
                ob = nblock[(nx, ny)]
                if isptr(ob['script']):
                    events[('talk', nk, ob['id'])] = ob['script']
                continue
            water = nt[3] in SURFABLE or nt[3] == WATERFALL
            if water:
                if nt[3] == WATERFALL and not (surf and S.can('waterfall')):
                    continue
                if not surf and not S.can('surf'):
                    continue
                q.append((nk, nx, ny, 1, True))
                continue
            if nt[1] and not is_warp:
                # counters: talk across them
                if nt[3] == 0x80:
                    bx, by = nx + dx, ny + dy
                    if 0 <= bx < nm['w'] and 0 <= by < nm['h'] and (bx, by) in nblock:
                        ob = nblock[(bx, by)]
                        if isptr(ob['script']):
                            events[('talk', nk, ob['id'])] = ob['script']
                # signs and hidden things in front of you
                continue
            if surf:
                # getting off the water: only onto ground at height 3
                if nt[2] != 3:
                    continue
            elif z not in (0, 15) and nt[2] not in (0, 15) and nt[2] != z:
                continue
            if (nx, ny) in nsight:
                blocked_by.setdefault(nsight[(nx, ny)], (nk, nx, ny))
                continue
            if not trigger_ok(nk, nx, ny):
                continue
            nz = z if nt[2] in (15,) else nt[2]
            q.append((nk, nx, ny, nz, False))
    # bg events (hidden items, signs with scripts) on reached tiles or in front of them
    for mk, tiles in reached.items():
        m = MAP(mk)
        # people who walk around: you can talk to them when you reach where they roam
        for (ox, oy), ob in view(mk)[2].items():
            if isptr(ob['script']) and any((ox + dx, oy + dy) in tiles for dx, dy in ((0, 0), (0, 1), (0, -1), (1, 0), (-1, 0))):
                events[('talk', mk, ob['id'])] = ob['script']
        for i, b in enumerate(m['bgs']):
            near = any((b['x'] + dx, b['y'] + dy) in tiles for dx, dy in ((0, 0), (0, 1), (0, -1), (1, 0), (-1, 0)))
            if not near:
                continue
            if b['kind'] == 7:
                events[('hidden', mk, i)] = b['data']
            elif b['kind'] < 5 and isptr(b['data']):
                events[('sign', mk, i)] = b['data']
        for i, s in enumerate(m['mapscripts']):
            if s['type'] in (1, 3, 5, 7) and isptr(s['script']):
                events[('mapscript', mk, i)] = s['script']
            elif s['type'] == 2 and isptr(s['script']) and var_on(mk, s['var']) == s['value']:
                events[('frame', mk, i)] = s['script']
    return reached, events, blocked_by


DEBUG = os.environ.get('WL_DEBUG') == '1'
PUZZLES_SEEN = {}     # puzzle and rental battles: trainer id -> where
SEEN_AT = {}          # boss trainer id -> the step after which you can first reach its battle
REWARDS = {}          # (kind, what, map) -> the step it first became available (kinds: mon, item, unlock, money, puzzle)
CUR = ['start']       # the step being worked out
# features Radical Red unlocks with a flag (the skills menu at 0x9058437, the party menu's Move Relearner)
UNLOCKS = {0x1047: 'PokeVial (skills menu, 6 heals, refilled by Nurse Joy)', 0x1049: 'Move Relearner in the party menu',
           0x1057: 'Infinite Repel (skills menu)', 0x1058: 'Time Changer (skills menu: day, night or dusk)',
           0x82F: 'Running Shoes'}


def note_rewards(out, mk, sp):
    for sid, lv, how in out.mons:
        REWARDS.setdefault(('mon', (sid, lv, how), mk), (CUR[0], sp))
    for it, q in out.items:
        REWARDS.setdefault(('item', it, mk), (CUR[0], sp))
    for f in out.set:
        if f in UNLOCKS:
            REWARDS.setdefault(('unlock', f, mk), (CUR[0], sp))
    if out.money:
        REWARDS.setdefault(('money', out.money, mk), (CUR[0], sp))
    for t in out.puzzles:
        REWARDS.setdefault(('puzzle', t, mk), (CUR[0], sp))


def settle(S, log, bosses_seen, max_rounds=400):
    """Walk, run every reachable script, fold in what they do; repeat until nothing changes."""
    seen_keys = set()
    trace = os.environ.get('WL_TRACE') == '1'
    for rnd in range(max_rounds):
        k0 = S.key()
        if k0 in seen_keys:
            break
        seen_keys.add(k0)
        if trace:
            snap = (set(S.flags), dict(S.vars), set(S.items), len(S.starts), len(S.tiles))
        reached, events, blocked = walk(S)
        for b, where in blocked.items():
            bosses_seen.setdefault(b, where)
            SEEN_AT.setdefault(b, CUR[0])
        changed = False
        for (kind, mk, idx), sp in sorted(events.items(), key=lambda kv: (kv[0][0] != 'mapscript', kv[0])):
            if DEBUG and kind != 'hidden':
                o2 = run(sp, S, mk)
                if o2.set or o2.vars or o2.items or o2.mons or o2.boss is not None or o2.warp or o2.beat:
                    print('   event', kind, name(mk), mk, idx, hex(sp), 'set', sorted(hex(f) for f in o2.set - S.flags)[:6], 'vars', {hex(k): v for k, v in o2.vars.items()},
                          'items', [item_name(i) for i, _ in o2.items][:4], 'mons', o2.mons[:2], 'boss', o2.boss, 'warp', o2.warp, 'beat', sorted(o2.beat)[:4], 'stop', o2.stop)
            if kind == 'hidden':
                it = sp & 0xFFFF
                if it and it not in S.items and 0x150 <= it <= 0x200:
                    S.items.add(it); changed = True
                    log.append(('hidden item', mk, item_name(it)))
                continue
            out = run(sp, S, mk)
            for b in out.bosses:
                bosses_seen.setdefault(b, (mk, kind))
                SEEN_AT.setdefault(b, CUR[0])
                WHERE.setdefault(b, set()).add((sp, mk))
            for t in out.puzzles - PUZZLES_SEEN.keys():
                PUZZLES_SEEN[t] = (mk, kind)
            if out.boss is not None:
                continue
            note_rewards(out, mk, sp)
            if kind == 'talk' and out.found:
                f = objflag(mk, idx)
                if f and f not in S.flags:
                    S.flags.add(f); changed = True     # the ball is gone (doors check the Card Key ball's flag)
            before = set(S.items)
            if apply(S, out):
                changed = True
                for it in set(S.items) - before:
                    log.append(('item', mk, item_name(it)))
                for mon in out.mons:
                    log.append(('pokemon', mk, mon))
            for (wk, wid, wx, wy) in out.warps or ([out.warp] if out.warp else []):
                dm = MAP(wk)
                if dm:
                    if wid is not None and wid < len(dm['warps']) and wid != 0xFF:
                        p = (wk, dm['warps'][wid]['x'], dm['warps'][wid]['y'], 3, False)
                    elif wx is not None and 0 <= wx < dm['w'] and 0 <= wy < dm['h']:
                        p = (wk, wx, wy, 3, False)
                    else:
                        p = None
                    if p and p not in S.starts:
                        S.starts.append(p); changed = True
        if trace:
            dv = {hex(k): (snap[1].get(k), v) for k, v in S.vars.items() if snap[1].get(k) != v}
            print(f'    round {rnd}: {len(reached)} maps, flags +{sorted(hex(f) for f in S.flags - snap[0])[:6]} vars {dict(list(dv.items())[:6])} '
                  f'items +{sorted(S.items - snap[2])[:4]} starts +{len(S.starts) - snap[3]} tiles +{len(S.tiles) - snap[4]}', file=sys.stderr, flush=True)
        if not changed:
            return reached, events
    return reached, events


def beat(S, tid):
    """Win a boss fight: its scripts carry on past the battle (badge, items, story flags), then it counts as beaten."""
    for sp, mk in sorted(WHERE.get(tid, ())):
        apply(S, run(sp, S, mk, fight=tid))
    S.beaten.add(tid)


def new_game():
    S = State()
    apply(S, run(0x81A6481 - G, S, (3, 0)))       # the flags a new game sets
    S.flags |= {0x1034, 0x1032, 0x10BE} if MODE == 'hardcore' else {0x1032}
    S.starts = [((3, 0), 6, 8, 3, False)]          # in front of your house
    return S


BOSSES = {b['id']: b for b in APP['bosses']}


def pick_next(pending, seen):
    """The next fight to win. An optional fight (no badge or story milestone) that you can reach and that belongs to
    this chapter or the next comes first: you can take it early (the Dig Grunt in Cerulean once Bill is helped opens
    Route 5 and Vermilion before Misty). Otherwise the next fight of the run you can reach."""
    met = [i for i, g in enumerate(pending) if any(t in seen for t in g)]
    if not met:
        return None
    ms = [i for i, g in enumerate(pending) if BOSSES.get(g[0], {}).get('ms')]
    chapter = BOSSES.get(pending[ms[0]][0], {}).get('mi', 99) if ms else 99
    for i in met:
        b = BOSSES.get(pending[i][0], {})
        if not b.get('ms') and b.get('mi', 99) <= chapter + 1:
            return i
    return met[0]


def solve(order):
    """order: the run's fights, each a list of trainer ids (versions of one fight). Returns the steps taken and when
    each map was first reached. With WL_CKPT set, the work so far is saved after every fight and picked up again
    from there (WL_STEPS: how many fights to do in this sitting)."""
    import pickle
    ckpt = os.environ.get('WL_CKPT')
    limit = int(os.environ.get('WL_STEPS', '100000'))
    if ckpt and os.path.exists(ckpt):
        with open(ckpt, 'rb') as f:
            saved = pickle.load(f)
        S, log, seen, first, methods, steps, pending = (saved[k] for k in ('S', 'log', 'seen', 'first', 'methods', 'steps', 'pending'))
        WHERE.update(saved['WHERE']); PUZZLES_SEEN.update(saved['PUZZLES_SEEN']); REWARDS.update(saved['REWARDS']); SEEN_AT.update(saved.get('SEEN_AT', {}))
        print(f'  resumed after {len(steps) - 1} fights', file=sys.stderr, flush=True)
    else:
        S = new_game()
        log, seen = [], {}
        CUR[0] = 'start'
        reached, _ = settle(S, log, seen)
        first = {mk: 'start' for mk in reached}
        methods = {}
        note_methods(S, reached, methods, 'start')
        steps = [('start', sorted(reached), [])]
        pending = [list(g) for g in order]
    done_now = 0
    while pending and done_now < limit:
        # a trial (a puzzle or rental battle, fought with Pokemon they lend you) is no fight of your run: once you can
        # reach it, it leaves the list (data/trials.json has it, with its solution)
        pending = [g for g in pending if not all(t in PUZZLES_SEEN for t in g)]
        k = pick_next(pending, seen)
        if k is None:
            break
        g = pending.pop(k)
        for t in g:
            if t in seen:
                beat(S, t)
            else:
                S.beaten.add(t)
        if BOSSES.get(g[0], {}).get('cls') == 'Champion':
            S.flags.add(0x82C)       # the Hall of Fame sets FLAG_SYS_GAME_CLEAR (in code, after the credits)
        before = len(log)
        CUR[0] = g[0]
        reached, _ = settle(S, log, seen)
        print(f'  [{len(steps)}] beat {g} -> {len(reached)} maps', file=sys.stderr, flush=True)
        new = sorted(mk for mk in reached if mk not in first)
        for mk in new:
            first[mk] = g[0]
        note_methods(S, reached, methods, g[0])
        steps.append((g[0], new, log[before:]))
        done_now += 1
        if ckpt:
            with open(ckpt + '.tmp', 'wb') as f:
                pickle.dump({'S': S, 'log': log, 'seen': seen, 'first': first, 'methods': methods, 'steps': steps, 'pending': pending,
                             'WHERE': WHERE, 'PUZZLES_SEEN': PUZZLES_SEEN, 'REWARDS': REWARDS, 'SEEN_AT': SEEN_AT}, f)
            os.replace(ckpt + '.tmp', ckpt)
    SOLVED['methods'] = methods
    return S, steps, first, pending, seen


SOLVED = {}
SEAGALLOP = [tuple(rom[0x46AEFC + 4 * i: 0x46AEFC + 4 * i + 4]) for i in range(11)]   # Vermilion, One-Seven Island, Cinnabar, Navel Rock, Birth Island
ROD_IDS = {v: int(k) for k, v in ITEMS.items() if v in ('Old Rod', 'Good Rod', 'Super Rod')}


def note_methods(S, reached, methods, when):
    """For each map, the first step where you can meet wild Pokemon by each method: land (a land-encounter tile you
    can walk on), surf (a water tile you can surf on), fish (water you can face, with each rod you have), rock (a Rock
    Smash rock you can break)."""
    for mk, tiles in reached.items():
        m = MAP(mk)
        got = set()
        for (x, y) in tiles:
            t = tile(m, S, mk, x, y)
            if t[4] == 1 and t[3] not in SURFABLE:
                got.add('land')
            if t[4] == 2 or t[3] in SURFABLE:
                if t[3] in SURFABLE:
                    got.add('surf')
            for dx, dy in ((0, 1), (0, -1), (1, 0), (-1, 0)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < m['w'] and 0 <= ny < m['h']:
                    nt = tile(m, S, mk, nx, ny)
                    if nt[3] in SURFABLE:
                        for rod, rid in ROD_IDS.items():
                            if rid in S.items:
                                got.add('fish:' + rod)
        if S.can('smash'):
            for o in m['objects']:
                if o['gfx'] == SMASH_ROCK and not (o['flag'] and o['flag'] in S.flags):
                    if any((o['x'] + dx, o['y'] + dy) in tiles for dx, dy in ((0, 1), (0, -1), (1, 0), (-1, 0))):
                        got.add('rock')
        for k in got:
            methods.setdefault((mk, k), when)


def species_name(sid):
    for sp in APP['species']:
        if sp['i'] == sid:
            return sp['n']
    return f'species {sid}'


def label_of(tid, BOSS):
    if tid == 'start':
        return 'start'
    b = BOSS.get(tid, {})
    return f"{b.get('n')} (cap {b.get('cap')}, #{tid})"


if __name__ == '__main__':
    order = json.load(open(sys.argv[4])) if len(sys.argv) > 4 else []
    S, steps, first, pending, seen = solve(order)
    BOSS = {b['id']: b for b in APP['bosses']}
    by_step = defaultdict(list)
    for (kind, what, mk), (step, sp) in REWARDS.items():
        by_step[step].append((kind, what, mk, sp))
    for tid, new, got in steps:
        areas = sorted({name(mk) for mk in new})
        print(f'{label_of(tid, BOSS)}: opens {", ".join(areas) if areas else "nothing new"}')
        for kind, what, mk, sp in sorted(by_step.get(tid, []), key=lambda r: (r[0], str(r[1]))):
            if kind == 'mon':
                print(f'    pokemon: {species_name(what[0])} Lv {what[1]} ({what[2]}, {name(mk)})')
            elif kind == 'unlock':
                print(f'    unlock: {UNLOCKS[what]} ({name(mk)})')
            elif kind == 'puzzle':
                print(f'    puzzle/rental battle: trainer {what} ({name(mk)})')
            elif kind == 'money':
                print(f'    money: up to ${what} ({name(mk)})')
            elif kind == 'item' and (0x150 <= what <= 0x200 or 'HM' in item_name(what) or 'Ticket' in item_name(what) or 'Ring' in item_name(what)):
                print(f'    key item: {item_name(what)} ({name(mk)})')
    if pending:
        print('never reached:', [[(BOSS.get(t, {}).get('n'), t) for t in g] for g in pending][:20])
    if len(sys.argv) > 5:
        res = {
            'mode': MODE,
            'steps': [{'after': tid, 'opens': [list(mk) for mk in new]} for tid, new, got in steps],
            'firstReached': {f'{mk[0]}.{mk[1]}': (t if t == 'start' else t) for mk, t in first.items()},
            'methods': {f'{mk[0]}.{mk[1]}|{k}': t for (mk, k), t in SOLVED['methods'].items()},
            'rewards': [{'kind': kind, 'what': list(what) if isinstance(what, tuple) else what, 'map': list(mk), 'after': step, 'script': sp}
                        for (kind, what, mk), (step, sp) in REWARDS.items()],
            'bossesMet': {str(t): list(map(str, w)) for t, w in seen.items()},
            'seenAfter': {str(t): a for t, a in SEEN_AT.items()},
            'taken': [tid for tid, new, got in steps],
            'puzzlesMet': {str(t): [list(w[0]), w[1]] for t, w in PUZZLES_SEEN.items()},
            'neverReached': pending,
        }
        json.dump(res, open(sys.argv[5], 'w'), indent=0)
