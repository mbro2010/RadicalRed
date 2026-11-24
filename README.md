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
node tools/build_app_data.js data app/rrdata.json
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

## Nuzlocke Coach (`app/`)

A phone web app to use through the run:

- **Team**: enter each Pokémon as you catch it (species, level, nature, ability, item, moves). The move picker lists what it can learn by level-up or TM, and flags moves Hardcore bans.
- **Plan**: for any boss, the best six from your roster, a lead, and your top answers to each of their Pokémon. Each answer shows damage ranges, speed, and the **chance of losing your Pokémon**. That chance counts every damage roll, multi-hit count, crit and miss. The tab also has moveset ideas from level-up moves and TMs, plus an optional written game plan from Claude based on those numbers.
- **Battle**: pick the active Pokémon and HP, and it ranks attacking with each move against switching, by risk.

How it works: `engine.js` runs the open-source [Smogon damage calculator](https://github.com/smogon/damage-calc) (Gen 9 rules), fed with Radical Red's own stats, types, abilities and move data. Radical Red's custom moves are calculated from their real type, power and category. Its custom abilities are modeled from their in-game descriptions where they change damage, and flagged where they don't. The type chart the engine uses was checked against the ROM's own chart and is identical.

## Roadmap

1. ~~Extract boss teams, level caps and restrictions from the ROM~~
2. ~~Damage calculator using Radical Red's own move and species data~~
3. ~~Turn-by-turn battle advisor that minimizes the chance of losing a Pokémon~~ (first version in `app/`)
4. Regular trainers, wild encounter tables, move tutors, and Hardcore ability restrictions
5. Model the boss AI's move choice (today the Coach assumes their strongest move every turn)
6. Import your team from your save file
