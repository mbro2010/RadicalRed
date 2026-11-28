"""Everything on the side, read from the ROM's map scripts (data/extras.json): skills, services, gifts you have to earn,
leader rematches, cheat codes, and where each one is.

Found by what the person says (their script's text), so a person who moves to another map in a later version is still
found. Each entry: id, kind (skill, service, trial, gift, rematch, codes), name, what it does, what it takes, the map
(group, number) and the person's tile, and the script's address. When it opens in a run comes from the world solver
(tools/world_logic.py: the first fight after which that map is reachable). Trials (puzzle and rental battles) come
from data/trials.json (tools/extract_trials.py), with their solutions (data/trial_solutions.json).

usage: RR_ROM=... python3 -I tools/extract_extras.py data app/rrdata.json
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rom import rom, u16, u32, isptr, dec  # noqa: E402
from script_walk import G, L, BATTLE_LEN, BATTLE_CONT, header, entry_points  # noqa: E402

DATA = sys.argv[1] if len(sys.argv) > 1 else 'data'
APP = json.load(open(sys.argv[2] if len(sys.argv) > 2 else 'app/rrdata.json'))
MAPS = json.load(open(os.path.join(DATA, 'maps.json')))
ITEMS = {int(k): v['c'] or v['n'] for k, v in APP['items'].items()}
SPECIES = {s['i']: s['n'] for s in APP['species']}

# (id, kind, name, text that identifies the person, what it does, what it takes)
SIGNS = [
    ('pc-services', 'service', 'Pokémon Center helper', r"We can change a Pokémon's nature",
     'Changes a Pokémon\'s nature for free; swaps the gender of Snorunt, Ralts, Kirlia, Salandit, Burmy, Combee, Espurr, '
     'Basculin and Lechonk (their evolutions need one); tells you the mode you play; redeems codes (Mystery Gift); and, '
     'with the Rare Candy code on, sets a Pokémon to the level cap.', 'Nothing (in every Pokémon Center)'),
    ('relearner', 'trial', 'Move Maniac (Move Relearner)', r"Pokémon Move Maniac",
     'Win his puzzle battle and the Move Relearner is unlocked in your party menu for good; he also teaches the moves himself.',
     'Win the puzzle battle (or two Tiny Mushrooms or a Big Mushroom per move before that)'),
    ('pokevial', 'trial', 'PokéVial trial', r"Pass this simple trial of mine",
     'Win his puzzle battle for the PokéVial: a portable Pokémon Center in the skills menu, 6 heals, refilled by Nurse Joy.',
     'Win the puzzle battle'),
    ('eevee', 'trial', 'Day Care man (Eevee)', r"I have some powerful Pokémon",
     'Beat him with the six Hisuian Pokémon he lends you (Lv 100 on both sides) for a Lv 5 Eevee.', 'Win the rental battle (try as often as you like)'),
    ('metronome', 'trial', 'Metronome gambler', r"team of Metronome",
     'Bet $10,000, $50,000 or $100,000 on a battle of six Lv 100 Metronome-only Pokémon on each side; a win pays double.',
     'Money to bet; pure luck (save first)'),
    ('inf-repel', 'skill', 'Infinite Repel', r"Infinite Repel",
     'Keeps wild Pokémon away until you switch it off in the skills menu.', 'Beat Lass Anne in Viridian Forest'),
    ('time-changer', 'skill', 'Time Changer', r"time changer device",
     'Sets the time of day (day, night or dusk) from the skills menu: night encounters and night or day evolutions on demand.',
     'Answer three questions: Pancham (no night evolution), 5 PM (night encounters start), Never'),
    ('running-shoes', 'item', 'Running Shoes', r"switched shoes with the Running Shoes", 'Run with B.', "Oak's Aide catches up with you"),
    ('egg-seller', 'gift', 'Egg seller', r"I have an egg sent to me by a",
     'Sells one egg: a Wonder Egg (a random first-form Pokémon, even Cosmog) or a Paldean Egg (a Paldean Pokémon).', '$5,000'),
    ('ev-reducer', 'service', 'EV reducer', r"subtract EVs", 'Takes EVs off a stat or resets them all.', 'Nothing'),
    ('ability-swap', 'service', 'Ability swapper', r"swap to a Pokémon's hidden ability",
     'Swaps a Pokémon between its hidden ability and a normal one.', 'A Bottle Cap'),
    ('ev-checker', 'service', 'EV checker', r"check your Pokémon's EVs", 'Shows a Pokémon\'s EVs.', 'Nothing'),
    ('iv-zero', 'service', 'IV setter', r"set the IV of a specific stat to 0", 'Sets one IV to 0 (minimum Speed for Trick Room).', 'Nothing'),
    ('iv-checker', 'service', 'IV checker', r"check your Pokémon's IVs", 'Shows a Pokémon\'s IVs.', 'Nothing'),
    ('ball-swap', 'service', 'Ball switcher', r"switch the Poké Ball of your", 'Moves a Pokémon to another kind of Poké Ball.', 'Nothing'),
    ('hp-ivs', 'service', 'Hidden Power IVs', r"IVs for a specific Hidden Power",
     'Sets the IVs for the Hidden Power type you want (every IV must be 30 or more).', 'Nothing'),
    ('ev-audino', 'service', 'EV trainer', r"slaugh-\s*ter a family of Audinos",
     'A battle against a family of Audinos for Exp. ($10,000), or EV training ($2,000).', 'Money'),
    ('move-deleter', 'service', 'Move Deleter', r"I'm the Move Deleter", 'Makes a Pokémon forget a move (even an HM).', 'Nothing'),
    ('egg-tutor', 'service', 'Egg Move tutor', r"I teach Egg moves", 'Teaches Egg moves without breeding.', 'Name four Pokémon from their cries'),
    ('wild-doubles', 'service', 'Wild double battles', r"turn on wild double battles", 'Turns wild double battles on or off.', 'Nothing'),
    ('starter-tutor', 'trial', 'Starter tutor', r"move tutors specifically for(\s|\{FA\})*starters",
     'Teaches starter-only moves once you beat him in a starter-only battle.', 'Win a battle using only starter Pokémon'),
    ('battle-sim', 'service', 'Battle Simulator', r"One Island Battle Simulator",
     'Battles against random boss trainers of the region, with prizes.', 'Nothing'),
    ('follower', 'service', 'Pokémon follower', r"would like to come out of its ball",
     'Lets one of your Pokémon out of its ball to walk behind you; talk again to put it back. Four people want to see a '
     'certain Pokémon following you: a Lucario (Celadon City), a Yamper (Vermilion City), a Sharpedo (Route 12) and a '
     'Swampert (Saffron City).', 'Nothing'),
    ('lucario-fan', 'gift', 'Lucario fan', r"This is my trusted pal",
     'Come back with a Lucario following you and answer the questions about Lucario sets for the Lucarionite.',
     'A Lucario following you, after your fifth badge'),
    ('yamper-fan', 'gift', 'Yamper lover', r"I just adore my",
     'Come back with a Yamper following you and the two Yampers play: 5 Wish Pieces.', 'A Yamper following you'),
    ('sharpedo-stone', 'gift', 'Stone finder', r"I found this stone one day",
     'Show a Sharpedo following you and the stone reacts: the Sharpedonite.', 'A Sharpedo following you'),
    ('mudkip-fan', 'gift', 'Mudkip fan', r"Herd U Liek Mudkipz",
     'Answer no twice and the kid battles you (a Swampert team, cap 68) for TM26 (Earthquake). Come back with a Swampert '
     'following you for the Swampertite, then with the Z-Power Ring for a second battle (Gian, cap 85) and a Lv 50 Cosmog.',
     'Answer no twice; then a Swampert following you; then the Z-Power Ring'),
    ('codes', 'codes', 'Cheat codes', r"put in a(\s|\{FA\})*cheat code",
     'Woyaopp: Rare Candy cheat (the youngster in Viridian City sells them; the Pokémon Center helper sets a Pokémon to the level '
     'cap). DexAll: DexNav cheat. SO2Toxic: care packages. TeamPreview: see the opponent\'s team before a battle. EZCatch: easy catching.',
     'Type the code at the sign'),
]


def texts_of(start, limit=4000):
    """Every text a script can show (loadword 0 and message), following every branch."""
    out, seen, todo, n = [], set(), [start - G], 0
    while todo and n < limit:
        o = todo.pop()
        while 0 <= o < len(rom) - 20 and o not in seen and n < limit:
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
            p = u32(o + 2) if op == 0x0F and rom[o + 1] == 0 else u32(o + 1) if op == 0x67 else None
            if p and isptr(p):
                out.append(dec(rom[p - G:p - G + 500]).replace('\n', ' '))
            if op in (0x04, 0x05) and isptr(u32(o + 1)):
                todo.append(u32(o + 1) - G)
            if op in (0x06, 0x07) and isptr(u32(o + 2)):
                todo.append(u32(o + 2) - G)
            if op in (0x02, 0x03, 0x05, 0x08, 0x0C, 0x0D):
                break
            o += 1 + L[op]
    return out


def rematches():
    """Leaders who battle again once you have the Mega Ring (353) or the Z-Power Ring (267), and what they give."""
    rings = {353: 'Mega Ring', 267: 'Z-Power Ring'}
    found = []
    for mp in MAPS:
        try:
            h = header(mp['group'], mp['num'])
            eps = entry_points(h)
        except Exception:
            continue
        for kind, sp in eps:
            if kind != 'person':
                continue
            # follow the paths that pass a ring check, and collect each battle with what comes after it
            todo, seen = [(sp - G, ())], set()
            while todo:
                o, need = todo.pop()
                v8000, battle, gives, stack = None, None, [], []
                for _ in range(500):
                    if not (0 <= o < len(rom) - 20) or (o, need) in seen:
                        break
                    seen.add((o, need))
                    op = rom[o]
                    if op == 0x5C:
                        battle = u16(o + 2)
                        cont = BATTLE_CONT.get(rom[o + 1])
                        if cont and isptr(u32(o + cont)):
                            o = u32(o + cont) - G
                            continue
                        o += 2 + BATTLE_LEN.get(rom[o + 1], 12)
                        continue
                    if op not in L:
                        break
                    if op == 0x47 and u16(o + 1) in rings and rom[o + 5] == 0x21 and rom[o + 10] == 0x06:
                        # checkitem ring, 1; compare VAR_RESULT, 1; goto_if >= (has it)
                        todo.append((u32(o + 12) - G, need + (rings[u16(o + 1)],)))
                        o += 5 + 5 + 6
                        continue
                    if op in (0x06, 0x07) and isptr(u32(o + 2)):
                        todo.append((u32(o + 2) - G, need))
                    if op in (0x16, 0x1A) and u16(o + 1) == 0x8000:
                        v8000 = u16(o + 3)
                    if op == 0x09 and rom[o + 1] in (0, 1) and v8000 and battle:
                        gives.append(ITEMS.get(v8000, str(v8000)))
                    if op == 0x79 and battle:
                        gives.append(f'{SPECIES.get(u16(o + 1), u16(o + 1))} (Lv {rom[o + 3]})')
                    if op == 0x03 and stack:
                        o = stack.pop()         # return from a call (Saffron's Mudkip fan sets a variable in one first)
                        continue
                    if op in (0x02, 0x03, 0x0C, 0x0D):
                        break
                    if op == 0x05:
                        if not isptr(u32(o + 1)):
                            break
                        o = u32(o + 1) - G
                        continue
                    if op == 0x04 and isptr(u32(o + 1)):
                        stack.append(o + 5)
                        o = u32(o + 1) - G
                        continue
                    o += 1 + L[op]
                if need and battle is not None and gives:
                    found.append({'map': [mp['group'], mp['num']], 'mapName': mp['name'], 'script': sp, 'needs': sorted(set(need)),
                                  'trainer': battle, 'gives': gives})
    # one per (trainer, needs)
    out, keys = [], set()
    for r in found:
        k = (r['trainer'], tuple(r['needs']))
        if k not in keys:
            keys.add(k)
            out.append(r)
    return out


def main():
    from world_maps import load
    out = []
    done = set()
    for mp in MAPS:
        try:
            m = load(mp['group'], mp['num'])
        except Exception:
            continue
        people = [('person', o['script'], (o['x'], o['y'])) for o in m['objects'] if isptr(o['script'])]
        people += [('sign', b['data'], (b['x'], b['y'])) for b in m['bgs'] if b['kind'] < 5 and isptr(b['data'])]
        for kind, sp, at in people:
            t = ' '.join(texts_of(sp))
            for sid, k, nm, pat, what, takes in SIGNS:
                if re.search(pat, t) and (sid, sp, mp['group'], mp['num']) not in done:
                    if sid == 'inf-repel' and 'You unlocked the Infinite Repel' not in t:
                        continue
                    done.add((sid, sp, mp['group'], mp['num']))
                    out.append({'id': sid, 'kind': k, 'name': nm, 'what': what, 'takes': takes, 'map': [mp['group'], mp['num']],
                                'mapName': mp['name'], 'at': list(at), 'script': sp})
    # the Pokemon Center helper stands in every Center: one entry with all its maps
    pcs = [e for e in out if e['id'] == 'pc-services']
    if pcs:
        first = dict(pcs[0])
        first['maps'] = [e['map'] for e in pcs]
        first['mapNames'] = sorted({e['mapName'] for e in pcs})
        out = [e for e in out if e['id'] != 'pc-services'] + [first]
    res = {'extras': out, 'rematches': rematches()}
    json.dump(res, open(os.path.join(DATA, 'extras.json'), 'w'), indent=1, ensure_ascii=False)
    for e in out:
        print(f"{e['id']:14s} {e['mapName']} {e['map']} at {e['at']}")
    for r in res['rematches']:
        print(f"rematch {r['mapName']} trainer {r['trainer']} needs {r['needs']}: {r['gives']}")


if __name__ == '__main__':
    main()
