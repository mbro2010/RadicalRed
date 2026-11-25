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
- `finds.json`: per area, gift Pokémon, one-time encounters, eggs, item balls, hidden items, items people give you, and shop stock (from the maps' scripts)
- `starters.json`: the 27 starters Oak's Lab offers (a generation setting swaps the three balls) and which rival line each one gives you
- `starter_tiers.json`: the starter tier list (see below)

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
python3 tools/extract_finds.py data          # gifts, one-time encounters, items, shops
python3 tools/extract_fight_places.py data   # where each scripted fight starts, and who hands over key items
python3 tools/extract_care_package.py data   # the care package cheat (SO2Toxic): items per checkpoint
python3 tools/extract_starters.py data
node tools/build_app_data.js data app/rrdata.json
node tools/starter_tiers.js data app/rrdata.json app/starters.json   # about a minute

# optional: sprites for the app, decoded from your own ROM (kept out of git)
python3 tools/extract_sprites.py app/sprites
```

The tools check the ROM's SHA-1 and warn if it isn't Radical Red 4.1, because every address is version-specific.

Tests: `npm install && npm test` runs `tests/*.test.js` against the app's own modules and the committed game data (no ROM needed): data integrity, damage, the ported boss AI, singles and doubles simulation, and the save reader. GitHub Actions runs them on every push.

To view the boss page locally, serve the `page/` folder (it loads `bosses.json` next to it), for example `python3 -m http.server -d page` and open `rr-hardcore-bosses.html`.

## What Hardcore Mode actually does

Read from the game code (details and addresses in `NOTES.md`):

- **153 boss battles use separate Hardcore teams.** Hardcore Brock, for example, has 6 Pokémon instead of 4.
- **Boss EVs are zero.** Hardcore always enables Minimal Grinding, which skips EVs on boss Pokémon.
- **Most boss levels follow yours.** 646 of the 779 Hardcore boss Pokémon have their level set from your highest-level party Pokémon when the battle starts, from 3 below it up to equal. Gym leaders have fixed levels that match the cap.
- **Hardcore level caps:** 16, 23, 28, 36, 44, 47, 56, 57, 59, 68, 73, 76, 79, 80, 81, 82, 85, then 100 after becoming Champion. Normal Mode's first four are 15, 22, 27 and 34.
- **Your Pokémon can't learn 82 moves**, including setup moves, hazards, weather, Protect and Substitute. Toxic and Leech Seed are allowed only on 156 listed species.
- **Some of your abilities change.** Decoded from the game's code: Drizzle becomes Adaptability, Drought Sheer Force, Speed Boost Infiltrator, Moxie and Beast Boost Unnerve, Magic Bounce Magic Guard, terrain surges become Telepathy, Dazzling or Self Sufficient, and more (full list in `NOTES.md`). The Coach applies these to your Pokémon in every calculation and shows them on your cards.

## Nuzlocke Coach (`app/`)

A phone web app to use through the run, styled like a GBA menu, with sprites decoded from your own ROM. It's built around **your run**: one page that takes you through it in order, so you don't jump between screens.

1. **Start the run** (rules: dupes clause, move tutors) and **choose your starter** from the tier list.
2. **Catch** in the areas you reach next, in story order. Each area has its encounter table from the ROM (day and night, grass, surfing, Rock Smash and each rod), its gifts and one-time encounters, TMs, items and shops. Tap **Caught** on your first encounter and it joins your team with its level and the moves a wild one knows, or **✕** if it got away. Each catch step starts with **your team against the next two big fights**: the boss Pokémon you have no safe answer to yet, and attack types most of your party is weak to. Every route then gets a **verdict** in one line: the time of day to go (Radical Red has day and night tables, by your phone's clock) and whether to **catch now** or **skip for now** and come back with a rod or Surf you don't have yet (your first encounter in an area is the only one that counts), with the species to hope for. Species are judged by what they'd add to that team (matchups they win or save that your Pokémon don't); each way of meeting them (grass, each rod, surfing) is weighed by how often each species appears. Encounter lists show day and night side by side, and **Why? Compare the species** shows the numbers. Route 21's grass (south of Pallet Town, Lv 4–6), Route 2 and Viridian Forest are open before the rival; Diglett's Cave's Route 2 end before Falkner. Areas you move past without an encounter stay open for later, and any other area can be logged from the same step.
3. **The next fight**, in four parts:
   - **Get your team ready**: level everyone up to the cap in one tap (made for the Rare Candy cheat). It goes level by level as the game does: each new move comes up as a prompt ("Totodile wants to learn Bite. Coach: learn it and forget Leer", judged against your next two big fights, skipping moves Hardcore bans), and each evolution plays the game's flashing evolution scene, with a button to stop it. Where the evolution depends on the time of day, gender or stats (Cubone, Tyrogue, Wurmple…), it asks which one you got. **Natures and held items** for each party Pokémon sit right below: the nature for your next three big fights (with a button for when you've changed it with Radical Red's Nature Changer) and the held item for this fight, both judged at the level cap and evolved where they'd be by then. Items come from what you have: the items you've ticked, what your team holds and, if you entered the **care package** code, everything it has handed you so far (see below). Where a better item is coming later in the care package, it says so ("Later: Life Orb, after the Volcano Badge").
   - **Plan it**: the Coach simulates the battle hundreds of times with your Pokémon and the boss's exact team, in a background worker so the page stays responsive. It picks your six and your lead and writes a turn-by-turn script: what to click, when to switch, and any planned sacrifice. It reports the odds (win with no losses, win at all, average losses) and the most common ways things go wrong. **Watch it play out** shows whole battles with your team, your moves and their exact team on a Game Boy-style battle screen, your Pokémon from behind on the near platform and theirs facing you. Each turn the move menu comes up and the cursor walks onto the move the Coach picks, then the turn plays. The **most likely battle** (average damage rolls, no crits or misses) plays by itself once a plan is ready; **a new battle** simulates a fresh one with real luck each time (damage rolls, critical hits, misses and the boss AI's own choices); **one that goes wrong** searches simulated battles for one where you lose a Pokémon, so you can see how. Each ends with a summary (who fainted, when and to what) and a tally of the battles you watched. Before you plan, it uses your party as it is. Pause, next turn and up to 3× speed. **Double battles** (26 of the 153 Hardcore boss fights) are planned as doubles. Below the plan: their team one on one, **held items for this fight** and **moveset ideas**.
   - **Play it turn by turn** on the same battle screen: the Coach's move is marked in the move menu with each move's risk this turn (and your switches, with their risk), and you see what the boss AI will most likely do, including when it will switch out. Then **tell it what happened**, one question at a time: **1. Your move** (the Coach's pick first, each move and switch with its risk), **2. Their move** (their four moves and their bench as buttons; the AI's likely pick, close calls and coin flips marked), **3. HP after**: bars already set from what you entered, for whoever is on the field after the turn (a switch-in included: yours in real HP, theirs in percent, with − / + for exact values), their status, and who came out after a faint (the AI's pick marked). Each tap moves to the next question; tap a step to go back. Doubles keep one card with every question. Or write it in your own words ("Water Gun, Snubbull switched to Squirtle, it's at about half, I'm at 70"), and Claude fills the report in. **Next turn** plays it on the battle screen, matches your numbers and gives the next move. It keeps an **AI check** of how often the boss did what the ported AI predicted.
   - **Log the result**: who fainted (gone for good) and the win, which raises the level cap after a milestone fight. Each Pokémon that falls gets a small funeral: a gravestone with its name, level and what took it, under a night sky, with a button to pay respects. Optional fights can be skipped; a loss ends the run.
4. Then the next areas and the next fight, chapter by chapter (one per level cap), until you **beat the Champion** (save the run as a win, or keep going into the post-game) or **wipe** (save it to your history and start the next run, in one step).

Steps you've done fold into one line each; open one to fix an encounter or undo a result. The moments are marked: a Poké Ball wobble for each catch, the badge and the new level cap for each milestone, and the Hall of Fame when you beat the Champion. Your run card shows your badges and your party's icons hopping as in the game's menus. With reduced motion turned on, nothing moves. Fights with versions show the one you'll face: the rival's team follows your starter, and for other leaders you pick the version you see. If you take fights in another order, **Fighting someone else first?** switches the step to that fight.

The **menu** holds the tools:

- **Team & PC**: enter each Pokémon, or **import your My Boy! save file** (beta): party, PC boxes, badges, TMs and held items, read on the phone. Tap any Pokémon (here or in the party strip) for its sheet: a level counter (− / + / up to the cap) that plays the level-ups as above, its moves and what it learns next, how it evolves, and the Coach's nature and held item. The move picker lists what it can learn by level-up, TM or tutor, and flags moves Hardcore bans. **Move plan** gives the best four moves before each of the next big fights, with exactly when each becomes available. The fallen rest in the **graveyard**. **I entered the care package code (SO2Toxic)** turns on the care package: Radical Red 4.1 hands out items at 16 checkpoints (the DexNav aide on Route 2, Viridian Forest, Pewter City, … Mom after you become Champion), read from the ROM with Hardcore Mode's own lists; the Coach counts the ones you've reached and shows each on its area. (Woyaopp is the Rare Candy code: the youngster in Viridian City.)
- **Start a new run**: say how this run ended (wiped out, gave up, game crashed or won, and where); it goes into your history and the next run starts right away, at choosing your starter.
- **All areas**: every area in story order, with the same logging.
- **Plan any fight**: plan any boss or route trainer ahead of time.
- **Quick check**: the one-on-one calculator, with the boss AI's move scores and a **reality check** that compares a hit you saw with every possible roll.
- **Past runs & starters**: **insights** across your runs (where your Pokémon fall, how each starter did against the tier list, who you rely on, the AI check), every past run with how far it got, and the **starter tier list**.

How it works: `sim.js` is a turn-by-turn simulator for singles and doubles (targets, spread moves at 75%, redirection, Wide Guard, Helping Hand): damage rolls, crits, accuracy, speed and priority, status, confusion, Encore, Taunt, stat changes, hazards, screens, weather, terrain, healing, pivots, recharge and charge turns, Destiny Bond, berries, Mega Evolution, Z-Moves, and key items and abilities. Move effects are driven by the ROM's own effect IDs. `ai.js` is the boss AI, **ported from the battle AI of the engine Radical Red is built on** (Complete Fire Red Upgrade): every move starts at 100 points, loses points if it would fail or be absorbed, and gains the engine's own bonuses (+9 for a knockout before the target moves, +2 for the strongest attack, status, setup, healing, hazard and pivot bonuses by the Pokémon's fighting style). It switches out and picks its next Pokémon with the engine's switch-in scoring, Mega Evolves immediately, and uses a Z-Move unless the plain move already knocks out. In doubles it uses the engine's doubles logic: knockout points per attack and target, doubles fighting styles, and partner coordination. Your side is planned by playing out every promising pair of actions for a turn against the AI's choice. Radical Red may have private changes to its AI that the public engine source doesn't show. `advice.js` handles natures, evolutions and move timing; `save.js` reads save files; `stage.js` is the battle screen, which plays recorded battle events (see `NOTES.md`); `flow.js` lays out the run: chapters by level cap, the boss table's fights in order (versions of one fight grouped), and areas placed in FireRed's story order, checked against where the bosses stand and the wild levels (see `NOTES.md`). `engine.js` runs the open-source [Smogon damage calculator](https://github.com/smogon/damage-calc) (Gen 9 rules), fed with Radical Red's own stats, types, abilities and move data.

## Starter tier list

All 27 starters (Gen 1-9) are available in Oak's Lab: the balls' script swaps in the chosen generation's trio, and the ball you take decides the rival's starter (grass ball: he takes Charmander; water: Bulbasaur; fire: Squirtle). `tools/starter_tiers.js` tests each starter at every major fight's Hardcore level cap up to the Champion (36 fights: gym leaders, rival, Rocket admins and Giovanni, Elite Four and the other milestone fights), evolved by level as it would be by then, with its best level-up moves (Hardcore bans excluded, no TMs or tutors assumed) and the best of Adamant, Jolly, Modest and Timid. Each of the boss's Pokémon is a one-on-one matchup counting every damage roll, crit and miss, scored 3 (safe) to −1 (loses), and rival fights use the team that starter gives you. Overall = 60% early game (caps up to 36, the first four badges) + 40% the rest. Tiers are by distance from the average (S is more than one standard deviation above it).

| Tier | Starters |
| --- | --- |
| S | Scorbunny, Fennekin, Charmander, Totodile, Torchic |
| A | Chimchar, Fuecoco, Mudkip, Cyndaquil, Litten, Popplio |
| B | Rowlet, Piplup, Quaxly, Sobble, Grookey, Turtwig |
| C | Tepig, Oshawott, Bulbasaur, Chespin |
| D | Froakie, Chikorita, Treecko, Sprigatito, Snivy, Squirtle |

## Roadmap

1. ~~Extract boss teams, level caps and restrictions from the ROM~~
2. ~~Damage calculator using Radical Red's own move and species data~~
3. ~~Turn-by-turn battle advisor that minimizes the chance of losing a Pokémon~~
4. ~~Regular trainers, wild encounter tables, move tutors and Hardcore's ability changes~~
5. ~~Model the boss AI from the engine's AI code~~ (ported from CFRU, singles and doubles)
6. ~~Import your team from your My Boy! save file~~ (beta: built from the format, waiting on a real save to confirm)
7. ~~Confusion, Encore, Taunt, Mega Evolution and Z-Moves in the simulator; your own Z-Moves in plans~~
8. ~~Double battles~~
9. ~~One guided page for the whole run~~
10. Confirm the save reader and the AI port against real saves and fights (send a `.sav` and your AI-check misses)
