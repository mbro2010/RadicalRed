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

**Normal Mode with Minimal Grinding**, the Coach's other difficulty, also read from the game code: the same 153 fights, but 108 bosses have their own Normal teams (Normal Falkner: Rufflet, Wattrel and Flittle; Normal Brock: Alolan Geodude, Varoom, Onix and Archen at Lv 12-14), and the rest come from the regular trainer table (the Route 22 rival: a Starly and his starter at Lv 9). Minimal Grinding skips boss EVs here too. Level caps are 15, 22, 27, 34, then the same as Hardcore from 44. Bosses whose level follows yours come in 2 levels lower than in Hardcore (until the game is cleared). Every move and ability is yours to use. The care package adds weather rocks, terrain seeds, Weakness Policy, Throat Spray, Air Balloon and Terrain Extender to Hardcore's lists (and no EV items, with Minimal Grinding).

## Nuzlocke Coach (`app/`)

A phone web app to use through the run, styled like a GBA menu, with sprites decoded from your own ROM. Each run is played on **Hardcore** or **Normal with Minimal Grinding** (chosen on the run's first screen, changeable from the run card): the boss teams, level caps, move and ability rules, care package and starter tier list follow it, and the nuzlocke rules are the same either way (a fainted Pokémon is gone, no items in battle, set mode, level caps). It's built around **your run**, one screen at a time: each screen is one step, with **Back** and **Next**, a dot for each step of the chapter (one chapter per level cap) and your place saved with the run. **The whole run, step by step** at the bottom lists every step.

1. **Start the run** (rules: dupes clause, move tutors) and **choose your starter** from the tier list.
2. **Each new area on its own screen**, in story order. Its encounter table from the ROM (day and night side by side, grass, surfing, Rock Smash and each rod), its gifts and one-time encounters, TMs, items and shops. Tap **Caught** on your first encounter and it joins your team with its level and the moves a wild one knows, or **✕** if it got away; not there yet, or waiting for a rod or Surf? **Next** leaves it open for later. Every area gets a **verdict** in one line: the time of day to go (Radical Red has day and night tables, by your phone's clock) and whether to **catch now** or **skip for now** and come back with a rod or Surf (your first encounter in an area is the only one that counts), with the species to hope for. Species are judged by what they'd add to your team against the next two big fights (matchups they win or save that your Pokémon don't). Skipping is only advised with four or more Pokémon and when the later catch is much better, and the further away the rod or Surf is, the better it has to be: with a small team, a Pokémon now beats a better one later. **What your team still needs** lists the boss Pokémon you have no safe answer to yet. Route 21's grass (south of Pallet Town), Route 2 and Viridian Forest are open before the rival; Diglett's Cave's Route 2 end before Falkner.
3. **The trainers there**, on a screen of their own after the area: each one you'd fight at this level cap (a gym you come back to later, or the sea trainers of Route 21, wait for later), with its team. **Plan and fight** gives it the same three parts as a boss; walked around one? **Skipped it**.
4. **The next fight**, in three tabs, one part at a time:
   - **Plan**: first, if anyone in your party is under the level cap, **Level everyone up to the cap** in one tap (made for the Rare Candy cheat). It goes level by level as the game does: each new move comes up as a prompt (judged against your next two big fights, see *Move advice* below, skipping moves Hardcore bans), and each evolution plays the game's flashing evolution scene, with a button to stop it. Where the evolution depends on the time of day, gender or stats (Cubone, Tyrogue, Wurmple…), it asks which one you got. Then **Plan this fight**: the Coach simulates the battle hundreds of times with your Pokémon and the boss's exact team, in a background worker so the page stays responsive. It picks your six from your party and box, then the **held item and nature for each of them** for this fight. Items come from what you have (the items you've ticked, what your Pokémon hold and, if you entered the **care package** code, everything it has handed you so far), as many as you have of each: everyone starts empty-handed and the biggest gains get their items first, and a Pokémon keeps what it holds when nothing does better. Natures come after, with those items, and change only where one makes a real difference to this fight (Radical Red's Nature Change service is free). It picks the lead with them and plays the fight again, so the odds (win with no losses, win at all, average losses) are for your team set up that way, next to the odds as they are now. You get **Bring these, in this order**: the lead first, then the order they come in in the most likely battle, each with whom it takes on (or *in reserve*, for when things go wrong), its held item (and where it comes from: your bag, the care package, or another Pokémon that gives it up) and its nature, with **Give it** and **Changed it** buttons, or **Set up my party like this** for all of it at once (these six in your party in that order, the rest to your box). The Battle tab then starts with the plan's lead. Below: the most common ways things go wrong and a turn-by-turn script (what to click, when to switch, when to use a status or stat move first, any planned sacrifice). **Watch it play out** shows whole battles on a Game Boy-style battle screen: the **most likely battle**, **a new battle** with real luck each time, or **one that goes wrong**. **Double battles** (26 of the 153 Hardcore boss fights) are planned as doubles.
   - **Battle**: play it turn by turn on the same battle screen. Each turn the Coach marks its move with each move's risk, says who should move first and why (priority, or both Speeds), and shows what the boss AI will most likely do. Then **tell it what happened**, one question at a time: **1. Your move**, **2. Their move** (their four moves and their bench as buttons, the AI's likely pick and coin flips marked), **3. What happened**: **who moved first**, then each move in the order it played with how it went: **hit, critical hit, missed**, or **fully paralyzed, fast asleep, frozen solid, hurt itself in confusion, flinched** (offered when they can happen: paralysis when it's paralyzed or their first move could paralyze it, a flinch only when they moved first with a move that can flinch). The turn is played again that way, so the battle screen says "Snubbull is paralyzed! It can't move!" and the HP bars follow; set the HP to match your game where it differs. Setting a Pokémon to 0 HP replays the turn with that knock-out, so a foe that fell before its move never uses it ("No, it moved" undoes one). **Your Speed**: the Coach can't see your Pokémon's IVs, so it assumes perfect ones until you enter its real stats (see *Pokémon*). When the order you report says otherwise, it takes the closest Speed that explains it for the rest of the battle and keeps the estimate for later fights. Battle text reads like the game ("It's super effective!", "is hurt by its burn!"). Turns redraw only the parts around the battle screen, so the page doesn't jump. Doubles keep one card with every question; you can also write it in your own words and Claude fills the report in. It keeps an **AI check** of how often the boss did what the ported AI predicted.
   - **Result**: who fainted (gone for good) and the win, which raises the level cap after a milestone fight. Each Pokémon that falls gets a small funeral: a gravestone with its name, level and what took it, under a night sky, with a button to pay respects. Optional fights can be skipped; a loss ends the run.
5. Then the next areas and the next fight, chapter by chapter, until you **beat the Champion** (save the run as a win, or keep going into the post-game) or **wipe** (save it to your history and start the next run, in one step).

The moments are marked: a Poké Ball wobble for each catch, the badge and the new level cap for each milestone, and the Hall of Fame when you beat the Champion. With reduced motion turned on, nothing moves. Fights with versions show the one you'll face: the rival's team follows your starter, and for other leaders you pick the version you see. If you take fights in another order, **Fighting someone else first?** switches to that fight.

**Move advice** weighs status and stat moves, not only damage: for each of their Pokémon in your next big fights, it plays out attacking straight away against using a status or stat move first (taking one free hit for it), with the game's odds: a paralyzed foe acts 3 turns in 4, a sleeping one loses 1 to 3 turns, a confused one hurts itself 1 time in 3; Growl, Leer, Scary Face and the like change the stats the damage is worked out from. A move wins a slot when it makes fights safer ("Using Sleep Powder first makes 3 matchups safer: Brock's Lunatone 100% → 75% risk…"); it gets no credit in a fight you'd lose anyway. The battle planner uses the same reasoning, so it recommends setting up (Shell Smash before Yanma) only when that's safer than attacking.

The **menu** holds the tools:

- **Pokémon**: your party as the game's party menu shows it (the lead on the left, the other five on the right, each with its icon, a held-item mark, level and HP bar), your PC box below, and the graveyard. Tap one for its **summary**, with the game's pages: **Info** (ability, nature, held item, where it was caught, how it evolves, the Coach's nature advice), **Stats** (each stat with its base, IV and EV; the nature's raised stat in red, the lowered one in blue) and **Moves** (type, category, power, accuracy, what it learns next, the **move plan**). Level it up (one level, or to the cap) from any page, and **give it an item** from everything you have, the Coach's picks for the next big fight first. **Match my game's numbers**: type the stats your game's summary shows and the Coach works out its IVs (a range at low levels, narrowed by later entries; EVs where IVs can't explain a stat), so every plan, battle and Speed check uses your Pokémon's real stats. Add Pokémon by hand or **import your My Boy! save file** (beta): party, PC boxes, badges, TMs and held items, read on the phone. **I entered the care package code (SO2Toxic)** turns on the care package: Radical Red 4.1 hands out items at 16 checkpoints (the DexNav aide on Route 2, Viridian Forest, Pewter City, … Mom after you become Champion), read from the ROM with Hardcore Mode's own lists; the Coach counts the ones you've reached and shows each on its area. (Woyaopp is the Rare Candy code: the youngster in Viridian City.)
- **Start a new run**: say how this run ended (wiped out, gave up, game crashed or won, and where); it goes into your history and the next run starts right away, at choosing your starter.
- **All areas**: every area in story order, with the same logging.
- **Plan any fight**: plan any boss or route trainer ahead of time.
- **Quick check**: the one-on-one calculator, with the boss AI's move scores and a **reality check** that compares a hit you saw with every possible roll.
- **Past runs & starters**: **insights** across your runs (where your Pokémon fall, how each starter did against the tier list, who you rely on, the AI check), every past run with how far it got, and the **starter tier list**.

How it works: `sim.js` is a turn-by-turn simulator for singles and doubles (targets, spread moves at 75%, redirection, Wide Guard, Helping Hand): damage rolls, crits, accuracy, speed and priority, status, confusion, Encore, Taunt, stat changes, hazards, screens, weather, terrain, healing, pivots, recharge and charge turns, Destiny Bond, berries, Mega Evolution, Z-Moves, and key items and abilities. Move effects are driven by the ROM's own effect IDs. `ai.js` is the boss AI, **ported from the battle AI of the engine Radical Red is built on** (Complete Fire Red Upgrade): every move starts at 100 points, loses points if it would fail or be absorbed, and gains the engine's own bonuses (+9 for a knockout before the target moves, +2 for the strongest attack, status, setup, healing, hazard and pivot bonuses by the Pokémon's fighting style). It switches out and picks its next Pokémon with the engine's switch-in scoring, Mega Evolves immediately, and uses a Z-Move unless the plain move already knocks out. In doubles it uses the engine's doubles logic: knockout points per attack and target, doubles fighting styles, and partner coordination. Your side is planned by playing out every promising pair of actions for a turn against the AI's choice. Radical Red may have private changes to its AI that the public engine source doesn't show. `advice.js` handles natures, evolutions and move timing, and the plan's held items and natures for its six (items first, by the biggest gain in one-on-one matchups against their team and as many as you have of each, then natures only where one still changes a matchup; ties go to natures that don't lower Speed); `save.js` reads save files; `stage.js` is the battle screen, which plays recorded battle events (see `NOTES.md`); `flow.js` lays out the run: chapters by level cap, the boss table's fights in order (versions of one fight grouped), and areas placed in FireRed's story order, checked against where the bosses stand and the wild levels (see `NOTES.md`). `engine.js` runs the open-source [Smogon damage calculator](https://github.com/smogon/damage-calc) (Gen 9 rules), fed with Radical Red's own stats, types, abilities and move data.

## Starter tier list

All 27 starters (Gen 1-9) are available in Oak's Lab: the balls' script swaps in the chosen generation's trio, and the ball you take decides the rival's starter (grass ball: he takes Charmander; water: Bulbasaur; fire: Squirtle). `tools/starter_tiers.js` tests each starter at every major fight's Hardcore level cap up to the Champion (36 fights: gym leaders, rival, Rocket admins and Giovanni, Elite Four and the other milestone fights), evolved by level as it would be by then, with its best level-up moves (Hardcore bans excluded, no TMs or tutors assumed) and the best of Adamant, Jolly, Modest and Timid. Each of the boss's Pokémon is a one-on-one matchup counting every damage roll, crit and miss, scored 3 (safe) to −1 (loses), and rival fights use the team that starter gives you.

The **first fights** (caps 16 and 23: the rival, Falkner, Brock and Archer) are also **played out whole**: the starter alone against the boss's whole team in the battle simulator, against the ported boss AI, with real luck (40 battles each) and no items, as in Hardcore. One-on-one matchups from full HP miss what happens by the third or fourth Pokémon. Played out, **no starter beats Hardcore Brock alone**: the best (Tepig, Grookey, Totodile) knock out about one of his six, and most fire starters almost none (his Hippopotas sets a sandstorm and the AI brings in Lunatone and Lileep, which wall them). Plan on catches that cover him. Overall = 40% the first fights (one-on-one and played out, half each) + 25% the rest of the early game (caps up to 36) + 35% the rest of the run. Tiers are by distance from the average (S is more than one standard deviation above it). The Coach's tier list can also be ranked by the first fights alone.

| Tier | Starters |
| --- | --- |
| S | Scorbunny, Fennekin, Torchic, Charmander, Totodile |
| A | Chimchar, Cyndaquil, Popplio, Fuecoco, Litten, Mudkip |
| B | Piplup, Rowlet, Quaxly, Turtwig, Grookey, Tepig, Sobble, Oshawott |
| C | Bulbasaur, Chespin |
| D | Chikorita, Froakie, Sprigatito, Squirtle, Treecko, Snivy |

For the first fights alone, the order is Scorbunny and Totodile, then Torchic, Popplio, Charmander, Litten, Sobble and Quaxly. Fennekin, second overall for its late game, is weak in the first fights.

**Normal Mode with Minimal Grinding** has its own list (`node tools/starter_tiers.js data app/rrdata.json app/starters-normal.json normal`), against its teams and caps. The Route 22 rival is easy there (every starter beats his two Lv 9 Pokémon alone), but Falkner and Brock still can't be beaten by a starter alone. Totodile, Tepig, Mudkip and Quaxly lead; Fennekin, Torchic and Charmander are A, Scorbunny B.

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
