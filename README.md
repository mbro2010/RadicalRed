# Radical Red Hardcore Nuzlocke Toolkit

Tools for beating a **hardcore nuzlocke of Pokémon Radical Red 4.1 in Hardcore Mode**, with AI help. The guiding rule: every fact comes from the game's own ROM, never from online guides, which mix versions and difficulty modes.

The ROM is **not** in this repository. Bring your own copy.

## What's here

| Path | What it is |
| --- | --- |
| `tools/` | Python scripts that read data straight out of the ROM (standard library only) |
| `data/` | The extracted game data as JSON |
| `page/` | A phone-friendly boss reference page and the dataset it reads |
| `app/` | **Nuzlocke Coach**: a phone web app for the playthrough (roster, boss lineups, risk-rated matchups, battle helper) |
| `NOTES.md` | Reverse-engineering notes: table addresses, data layouts, game flags, and how Hardcore Mode works internally |

### `data/`

- `species.json`: 1,376 species and forms with base stats, types and abilities (including hidden abilities)
- `moves.json`: 1,004 moves with power, type, accuracy, PP, priority and physical/special/status category
- `abilities.json`, `natures.json`
- `trainers.json`: all 742 trainers, with their regular team, the **Hardcore override team** where one exists (153 boss fights), and the override used in every mode (39 special trainers)
- `hardcore_order.json`: the Hardcore boss table in the game's order, which follows the story
- `level_caps.json`: Normal and Hardcore level caps and the events that raise them
- `restrictions.json`: moves your Pokémon can't learn in Hardcore
- `learnsets.json`, `tms.json`: level-up moves per species, the 120 TMs and 8 HMs, and which species can learn each
- `items.json`, `ability_descriptions.json`: item names and Radical Red's own ability descriptions
- `calc_names.json`: how each in-game (shortened) name maps to the damage calculator's names
- `evolutions.json`: every evolution, including Mega Evolution stones (Radical Red changed many levels: Rattata, Pidgey, Poochyena and Zigzagoon evolve at 16)
- `encounters.json`, `maps.json`: wild Pokémon per area, map and method (grass, surfing, Rock Smash, fishing by rod), with the game's separate day (4:00–16:59) and night (17:00–3:59) tables
- `trainer_locations.json`: which area each trainer stands in, read from the maps' NPC scripts
- `tutors.json`: the 126 move tutor moves and which species can learn each

## Rebuilding the data

```sh
export RR_ROM=/path/to/radicalred-4.1.gba    # your own copy

python3 tools/extract.py data                # tables -> data/*.json
python3 tools/restrictions.py data/restrictions.json
python3 tools/validate.py data               # sanity checks
python3 tools/build_data.py data page/bosses.json

# Nuzlocke Coach data
python3 tools/extract_learnsets.py data
python3 tools/extract_items.py data
python3 tools/extract_ability_text.py data
npm install                                  # installs @smogon/calc for the name matching
node tools/map_names.js data                 # prints every match that needed review
python3 tools/extract_world.py data         # evolutions, encounters, map names, trainer locations
python3 tools/extract_tutors.py data
node tools/build_app_data.js data app/rrdata.json

# optional: sprites for the app, decoded from your own ROM (kept out of git)
python3 tools/extract_sprites.py app/sprites
```

The tools check the ROM's SHA-1 and warn if it isn't Radical Red 4.1, because every address is version-specific.

To view the boss page locally, serve the `page/` folder (it loads `bosses.json` next to it), for example `python3 -m http.server -d page` and open `rr-hardcore-bosses.html`.

## What Hardcore Mode actually does

Read from the game code (details and addresses in `NOTES.md`):

- **153 boss battles use separate Hardcore teams.** Hardcore Brock, for example, has 6 Pokémon instead of 4.
- **Boss EVs are zero.** Hardcore always enables Minimal Grinding, which skips EVs on boss Pokémon.
- **Most boss levels follow yours.** 646 of the 779 Hardcore boss Pokémon have their level set from your highest-level party Pokémon when the battle starts, from 3 below it up to equal. Gym leaders have fixed levels that match the cap.
- **Hardcore level caps:** 16, 23, 28, 36, 44, 47, 56, 57, 59, 68, 73, 76, 79, 80, 81, 82, 85, then 100 after becoming Champion. Normal Mode's first four are 15, 22, 27 and 34.
- **Your Pokémon can't learn 82 moves**, including setup moves, hazards, weather, Protect and Substitute. Toxic and Leech Seed are allowed only on 156 listed species.
- **Some abilities are restricted too.** The game's own description says so; which ones isn't decoded yet.

## Nuzlocke Coach (`app/`)

A phone web app to use through the run, styled like a GBA menu, with sprites decoded from your own ROM:

- **Party**: enter each Pokémon as you catch it, or **import your My Boy! save file** (beta): party, PC boxes and badges, read on the phone. The move picker lists what it can learn by level-up, TM or tutor, and flags moves Hardcore bans. Each card shows how it evolves.
- **Routes**: every area in story order with its encounter table from the ROM (day and night, grass, surfing, Rock Smash and each rod). Tap **Caught** on your first encounter and it joins your party with its level and the moves a wild one knows, or **✕** if it got away. The dupes clause marks species families you already have. **Best catch here** ranks the area's species by how much they'd help in your next two big fights, as what they evolve into by then. Each area also lists its trainers and their teams, and any of them can be planned like a boss.
- **Plan**: for any boss or route trainer, **Plan this fight** simulates the battle hundreds of times with your Pokémon and the exact team. It picks your six and your lead, and writes a turn-by-turn script: what to click, when to switch, and any planned sacrifice. It reports the odds (win with no losses, win at all, average losses) and the most common ways things go wrong.
- **Battle**: set the active Pokémon and HP mid-fight. The planner ranks every move and switch by expected losses for your whole team, and shows what the boss AI will pick and why (its move scores). A **reality check** compares a hit you saw with every possible roll, to catch anything the Coach doesn't know about.
- **Nature & moves** (on each Pokémon): the nature to set with Radical Red's free Nature Change service, when it evolves, and the best four moves before each of the next big fights with exactly when each becomes available: level-up level, a TM you own, a move tutor (optional), or the Move Maniac for moves it already passed.

How it works: `sim.js` is a turn-by-turn singles simulator: damage rolls, crits, accuracy, speed and priority, status, confusion, Encore, Taunt, stat changes, hazards, screens, weather, terrain, healing, pivots, recharge and charge turns, Destiny Bond, berries, Mega Evolution, Z-Moves, and key items and abilities. Move effects are driven by the ROM's own effect IDs. `ai.js` is the boss AI, **ported from the battle AI of the engine Radical Red is built on** (Complete Fire Red Upgrade): every move starts at 100 points, loses points if it would fail or be absorbed, and gains the engine's own bonuses (+9 for a knockout before the target moves, +2 for the strongest attack, status, setup, healing, hazard and pivot bonuses by the Pokémon's fighting style). It switches out and picks its next Pokémon with the engine's switch-in scoring, Mega Evolves immediately, and uses a Z-Move unless the plain move already knocks out. Radical Red may have private changes to its AI that the public engine source doesn't show. `advice.js` handles natures, evolutions and move timing; `save.js` reads save files. `engine.js` runs the open-source [Smogon damage calculator](https://github.com/smogon/damage-calc) (Gen 9 rules), fed with Radical Red's own stats, types, abilities and move data.

## Roadmap

1. ~~Extract boss teams, level caps and restrictions from the ROM~~
2. ~~Damage calculator using Radical Red's own move and species data~~
3. ~~Turn-by-turn battle advisor that minimizes the chance of losing a Pokémon~~
4. ~~Regular trainers, wild encounter tables and move tutors~~; Hardcore ability restrictions still to decode
5. ~~Model the boss AI from the engine's AI code~~ (ported from CFRU; double battles are still planned as singles)
6. ~~Import your team from your My Boy! save file~~ (beta: built from the format, waiting on a real save to confirm)
7. ~~Confusion, Encore, Taunt, Mega Evolution and Z-Moves in the simulator~~; your own Z-Moves in plans
8. Double battles
