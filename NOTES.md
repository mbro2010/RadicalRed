# Reverse-engineering notes: Radical Red 4.1

Everything here was found by reading the ROM's code and data. ROM offsets are file offsets; add `0x08000000` for the GBA address. Addresses written as `0x08…`/`0x09…` are GBA addresses.

- ROM: 32 MB, header `POKEMON FIRE` / `BPRE01` rev 0 (FireRed US 1.0 base)
- SHA-1: `964f951a0fdaf209e4ea1344883ef0d557bb3a80`

## Engine layout

The added engine code sits at roughly ROM `0x1000000`–`0x10D0000`. Its structures (table layouts, Z-move fields in the move struct, the hidden-ability byte in base stats) match the open-source Complete Fire Red Upgrade engine.

- Calls into vanilla FireRed functions go through `bx rN` veneers at `0x0907CEA4`–`0x0907CEAC`, used as `ldr rN,=func` followed by `bl veneer`, because a Thumb `bl` can't reach 16 MB back.
- Repointed tables are read **indirectly** from vanilla literal-pool slots. To find a table, read the slot:

| Slot | Points to |
| --- | --- |
| `0x080001BC` | base stats |
| `0x08000144` | species names |
| `0x080001C8` | items |
| `0x0800FC00` | trainers (still at the vanilla `0x23EAC8`) |
| `0x08043E20` | level-up learnsets (read by the move-learning code; not extracted yet) |

- Vanilla functions identified from use: `CreateMon 0x0803DA54`, `GetMonData 0x0803FBE8`, `SetMonData 0x0804037C`, `CalculateMonStats 0x0803E47C`, `ZeroEnemyPartyMons 0x0803DA34`, `FlagGet 0x0806E6D0`, `FlagSet 0x0806E680`, `VarGet 0x0806E568`, `Random 0x08044EC8`, `GetNatureFromPersonality 0x08042EB4`.

## Data tables

| Table | ROM offset | Entry size | Entries |
| --- | --- | --- | --- |
| Species names | `0x14042CC` | 11 | 1376 |
| Base stats | `0x17B98EC` | 28 | 1376 |
| Move names | `0x10F3188` | 13 | 1004 |
| Move data | `0x11521D0` | 12 | 1004 |
| Ability names | `0x10E32C0` | 17 | 282 |
| Items | `0x13C0000` | 44 (vanilla struct) | indexed by item ID |
| Trainers | `0x23EAC8` | 40 (vanilla struct) | 743 |
| Trainer class names | `0x23E558` | 13 | |
| Nature name pointers | `0x463E60` | 4 | 25 (standard order) |
| Regular-trainer spreads | `0x112533C` | 11 | indexes 1–153 |
| Fixed IV per trainer class | `0x1124F08` | 1 | per class ID |
| Hardcore boss records | `0x112C9B4` | 60 | 153 |
| Boss records used in every mode | `0x11259DC` | 60 | 40 |
| Normal boss records (also the battle simulator's Normal teams) | `0x1126340` | 60 | 108 |
| Level caps, Normal | `0x135013C` | 1 | 18 |
| Level caps, Hardcore | `0x135014E` | 1 | 18 |

Type IDs are the standard ones: 0 Normal … 17 Dark, 9 is `???`, 23 is Fairy.

## Layouts

**Base stats (28 bytes):** 0–5 HP/Atk/Def/Spe/SpA/SpD, 6–7 types, 8 catch rate, 9 exp yield, 10–11 EV yield, 12–15 wild held items, 16 gender ratio, 17 egg cycles, 18 friendship, 19 growth rate, 20–21 egg groups, 22–23 abilities, 24 safari flee rate, 25 body colour / flip, **26 hidden ability**, 27 unused.

**Move (12 bytes):** effect, power, type, accuracy, PP, effect chance, target, priority (signed), flags, Z-move power, **category** (0 physical, 1 special, 2 status), Z-move effect.

**Trainer (40 bytes, vanilla):** party flags (bit 0 custom moves, bit 1 held item), class, music/gender, pic, name[12], items[4] (u16), double battle (u32), AI flags (u32), party size (u32), party pointer.

**Regular party Pokémon (8 or 16 bytes, vanilla):** u16 IV field, u16 level, u16 species, then u16 item and/or u16 moves[4] depending on the party flags.
- If party flags are 3, AI flags are above 1 and `1 ≤ (IV field & 0xFF) ≤ 153`, the IV field is a **spread index**.
- **Spread (11 bytes):** nature, Hidden Power type code (0 = none), IV applied to every stat, EVs HP/Atk/Def/Spe/SpA/SpD, ball (`0xFE` class default, `0xFF` random), ability selector (0 hidden, 1 slot 1, 2 slot 2, 3 random slot, 4 random with a 1-in-3 hidden chance, above 4 leaves nature and ability random).
- Without a spread, IVs come from the class IV table (10 if the class entry is 0), or 31 when flag `0x1` is set.

**Boss record (60 bytes):** `+0` always `0x0E`, `+3` double battle, `+8` trainer ID (u32), `+0x0C` pointer (same in every record), `+0x10` party pointer, `+0x2C` party size (u16).

**Boss Pokémon (28 bytes):**

| Offset | Field |
| --- | --- |
| `+0` | species (u16) |
| `+2` | nature (standard IDs) |
| `+3` | ball (`0xFF` = default) |
| `+4` | IVs packed 5 bits each: HP, Atk, Def, Spe, SpA, SpD |
| `+8`–`+13` | EVs HP, Atk, Def, Spe, SpA, SpD |
| `+14` | held item (u16) |
| `+16`–`+23` | moves (4 × u16) |
| `+24` | unknown (0 in every Hardcore record) |
| `+25` | bit 0 shiny; bits 4–5 ability: 0 hidden, 1 slot 1, 2–3 slot 2; bits 1–2 unknown |
| `+26` | level (see below) |
| `+27` | starting status (8 poisoned, 16 burned, …) |

**Relative levels.** Level values 101–104 mean "relative to the player's highest-level party Pokémon": 101 → −2, 102 → −1, 103 → ±0, 104 → −3. The base is the highest level in the player's party, eggs skipped (`0x09076EB4`). Outside Hardcore that base drops by a further 2 unless the game is cleared (flag `0x82C`). Easy Mode lowers boss levels by 3, to a minimum of 1.

**Ability resolution.** "Hidden" sets the hidden-ability bit (bit 31 of the IV word) and falls back to a normal slot when the species has no hidden ability. Slots 1 and 2 are picked by bit 0 of the personality value.

## Party builder (`0x0907B624`)

For the opponent's side (the builder's 4th argument is 1), checked in this order:

1. Flag `0x1042` → special handling for trainers 6 and 7
2. Flag `0x104B` → special handling for trainers 5 and 14
3. **Not Hardcore** (`0x1034` clear) → the Normal boss records `0x1126340` when the trainer is listed (`0x0907B812` → `0x0907B81E`; 108 bosses)
4. Flag `0x1065` (battle simulator on Normal) → the same Normal records
5. Flag `0x1034` (**Hardcore**) and not `0x1065` → Hardcore table `0x112C9B4` when the trainer is listed
6. Flag `0x1066` (battle simulator on Hardcore) → Hardcore table
7. The table used in every mode, `0x11259DC`
8. Otherwise the vanilla trainer table

An earlier reading had step 3 missing (the Normal records used only by the battle simulator); a player's Normal Falkner with a Flittle showed it was wrong. When flag `0x104B` is clear the code jumps to `0x0907B84A`, which for the opponent's side goes straight to the Hardcore check at `0x0907B812`; when it is set and the trainer isn't 5 or 14, the code falls into the same check.

Record-based teams are built by `0x09078F9C`, one Pokémon at a time by `0x09078C48`. Personality, nature, ability and shininess are generated in `0x09077088`. EVs from records and spreads are skipped when Minimal Grinding (`0x1032`) or Easy (`0x1033`) is set.

**Checked by running it**: `tools/game_parties.py` calls the builder itself in the emulator (`tools/gba_emu.py`: `CreateMon`, `GetMonData`, `FlagSet` from FireRed; the save block pointers, the player's trainer ID and the rival's name at `SB1+0x3A4C` set up first) for every trainer, in Hardcore and in Normal, with 8 random seeds to see what changes between battles. `data/game_parties.json` is what it built: species (with forms), level, nature, ability, item, moves, IVs, EVs and the computed stats. `tools/build_app_data.js` fills the natures and abilities the tables leave open from it (a trainer's personality comes from its name and the species, so it's the same every battle), marks the 13 trainers whose spread rolls an ability each battle, and checks every boss and route trainer against it: 2,400 Pokémon, no differences in any field. A Pokémon without set moves knows the last four it learned by its level, a move it already knows moving to the end (the game's rule, used for wild Pokémon too).

## Flags

| Flag | Meaning |
| --- | --- |
| `0x1034` | Hardcore Mode |
| `0x1032` | Minimal Grinding (always set by Hardcore) |
| `0x1033` | Easy Mode |
| `0x103C` | Restricted Mode |
| `0x0940` / `0x0941` / `0x0942` / `0x093A` | Species / learnset / ability / scaled randomizer |
| `0x1065` / `0x1066` | Battle simulator on Normal / Hardcore |
| `0x090E` | A battle-simulator battle is running |
| `0x104E` | Set when a record-based boss team is built |
| `0x082C` | Game cleared |

Hardcore and Restricted also set `0x1B8`, `0x973`, `0x975` and `0x170` at the start (meaning unknown). The difficulty-selection script starts at `0x104ED92`.

## Level caps

The native at `0x090950A4` reports the cap: `index = milestones()` (`0x090C1FDE`), then `cap = table[index]`, using the Hardcore table when `0x1034` is set. The Easy Mode path adds 3 (seen in code, not fully traced). Flag `0x82C` (game cleared) forces index 17, cap 100.

The 16 milestone flags, in story order:

| Flag | Event |
| --- | --- |
| `0x820` | Boulder Badge (Brock) |
| `0x201` | Archer, trainer 46 |
| `0x821` | Cascade Badge (Misty) |
| `0x822` | Thunder Badge (Lt. Surge) |
| `0x823` | Rainbow Badge (Erika) |
| `0x038` | inferred: Giovanni, Rocket Hideout (trainer 348) |
| `0x955` | Archer, trainer 53 |
| `0x053` | inferred: Giovanni, Silph Co. (trainer 349) |
| `0x825` | Marsh Badge (Sabrina) |
| `0x824` | Soul Badge (Koga) |
| `0x998` | May, trainer 61 |
| `0x826` | Volcano Badge (Blaine) |
| `0x981` | Ariana, trainer 68 |
| `0x982` | Giovanni, trainer 69 |
| `0x827` | Earth Badge (Clair, trainer 74) |
| `0x991` | Brendan, trainer 26 |

The two inferred flags have no `setflag` next to a battle. They are probably object-hide flags set when Giovanni leaves the map. Placing them there makes every gym leader's fixed level equal to the cap in effect for that fight.

## Hardcore move restrictions

Lists of u16 move IDs, terminated by `0xFEFE`:

- `0x103FAE0`: banned outright (82 moves)
- `0x103FB86`: Leech Seed and Toxic, allowed only for the species listed at `0x116618C`
- `0x103FB8C`: a third list, empty in 4.1 (its exception species are at `0x11660AE`)

These lists are checked when a move is learned by level-up (`0x090A8818`) and in the other teaching paths (`0x090A8B9E`, `0x090A8EC4`), when flag `0x1034` or `0x103C` is set.

## Data used by the Coach app

| What | Where | Notes |
| --- | --- | --- |
| Type chart | `0x1146CE2` | 24×24 bytes, row = attacking type: 0 neutral, 1 immune, 5 half, 20 double. Identical to the standard Gen 6+ chart. The vanilla Gen 3 list at `0x24F050` is no longer used. |
| Level-up learnsets | pointer table at `*(0x08043E20)` = `0x180175C` | 3-byte entries (u16 move, u8 level), ended by level `0xFF` |
| TM/HM moves | `0x18224B8` | 128 × u16: TM01–TM120, then HM01–HM08 |
| TM/HM compatibility | `*(0x08043C68)` = `0x13E6DB4` | 16 bytes per species, bit n = TM/HM index n (`CanMonLearnTMHM` at `0x090A54C8`) |
| Ability descriptions | `*(0x080001C4)` = `0x1009B84` | 256 pointers; ability IDs are one byte, so names above 255 are never used |
| Items | `0x13C0000` | 44-byte vanilla struct, indexed by item ID (750 items) |

Move struct byte 9 is the Z-move power. Radical Red adds 15 abilities of its own (for example Striker, Bone Zone, Sage Power, Primal Armor and Feline Prowess) and about a dozen moves of its own (for example Soul Robbery, Dark Hole, Leech Fang and Aqua Fang). It also changes the types and stats of many existing Pokémon, so vanilla Pokédex data is wrong for it.

## The run path (`app/flow.js`)

The Coach lays the run out as one path. **Fights** are the Hardcore boss table in its own order, which is the game's progression: each entry's level cap rises only at the 16 milestone fights, so caps never go down along the table. Neighbouring entries with the same trainer, class and cap are versions of one fight (the rival's three teams in each rival fight, Bugsy 2, Pryce 3, Jasmine 3, Ketchup 2, each Elite Four member 2), except generic Grunts and Goons, who are separate trainers. The rival's teams are always ordered Squirtle line, Bulbasaur line, Charmander line, so the one you face follows from your starter's ball. For the other leaders the trigger for each version isn't known; you pick the one you see.

**Where fights happen.** 82 boss trainers stand on a map (`trainer_locations.json`, from the people on each map). The rest are started by scripts: the rival, the Rocket admins, the extra leaders, the Elite Four and the Champion. `tools/extract_fight_places.py` walks every script a map can run (people, triggers, signs, and the map's own scripts, including the on-frame tables that start rival and Champion battles), following goto, call, both sides of each branch and the script after a won battle, and records which map starts each trainerbattle. Together they place 151 of the 153 boss fights; the other two are started some other way: Sheila (a Beauty listed among the Route 13 trainers) and Ariana's first fight (cap 57, listed between Archer and Giovanni, who are both in Silph Co.). Scripts shared by three or more areas don't count as a place. A few places worth knowing: Brendan's first fight is in Viridian Forest, Falkner is in Pewter City, Bugsy on Route 25, Whitney on Route 11, Pryce on Route 20 (by the Seafoam Islands), May at Cinnabar Island, Archer, Ariana and Giovanni at caps 79-80 in Cerulean Cave, Brendan's milestone fight (cap 82) on Route 23, and after Sabrina the cap-68 fights send you back around Kanto (Brock, Misty and Lt. Surge at their gyms, other trainers in Saffron, Celadon, Route 8, Route 15 and Fuchsia).

**Rods.** The same walk finds who hands over each key item. Radical Red moves the rods earlier than FireRed: the **Old Rod is in Viridian City**, the Good Rod in Vermilion City and the Super Rod in Fuchsia City (FireRed: Vermilion, Fuchsia, Route 12). The Bicycle is in Cerulean City (voucher in Vermilion), the Poké Flute in Lavender Town, the Silph Scope and Lift Key in the Rocket Hideout, the Card Key in Silph Co., the Secret Key in the Pokémon Mansion and the S.S. Ticket on Route 25.

**Areas** are placed by FireRed's map order before the fight you'd reach next, and checked: every area that hosts a boss fight comes before that fight on the path (a test enforces it), and wild levels rise along the path for the main story's grass and caves. Placement choices worth knowing:

- Areas with only fishing or surfing come up where you'd first fish them with the Old Rod: Pallet Town with Route 1 and Viridian City, Cerulean City on arrival, then Vermilion and the S.S. Anne dock, Celadon, Fuchsia and Route 19's beach.
- Route 16's grass is reachable from Celadon (as in FireRed, the Cut house side), so it comes before Erika even though its trainers come later.
- Power Plant, Route 20, Seafoam, Cinnabar and Route 21 need Surf (HM03 is a Safari Zone gift).
- Cerulean Cave has Rocket and other boss trainers at caps 79-81 in Radical Red, so it sits there, before Victory Road.
- The Sevii Islands and the rest are after the Champion: their wild Pokémon are at the last cap (83-85) and their boss fights come after the Champion in the table.
- Route 23 comes with Brendan's milestone fight there (cap 82), though its wild Pokémon are only level 33-35.
- Route 4 comes with Mt. Moon: its west end (west of Mt. Moon's entrance, with the Pokémon Center) has grass you can walk before going in. Route 24 comes after the Rocket at the end of Nugget Bridge, with Route 25: its grass is north of the bridge, so the bridge trainers come first (the one exception the placement test allows). Run 6 found both: the path had Route 4 after Mt. Moon, and Route 24 before the bridge, where beating the bridge trainers marked it passed before you could log it.

Nothing is locked: an area can be logged from any step, a fight can be taken out of order, and areas you move past stay open.

**What the maps say** (the world data, next section) changes the story order in two ways. A fight the story order puts before you can reach it moves to right after the milestone that opens it: Radical Red gates **Routes 12 and 16** ("I think I'd better get Erika and Sabrina's badge before proceeding", triggers on var 0x5055 checking flags 0x823 and 0x825), so the 20 trainers of Routes 12, 13, 16, 17 and 18 (cap 56 in the table) come after Sabrina (`g.after`; fights are never moved earlier). And areas and fights you can reach **earlier** than the story puts them are offered as you go (`openEarly`): on an area page and on the fight you're at, "Open early" lists the areas you can already walk to and meet wild Pokémon in, and the ones an optional fight you can reach now would open. After the Nugget Bridge Rocket that is the **Dig Grunt** in Cerulean (the burgled house's backyard; his levels follow yours, so he can be fought any time): he opens Route 5 (with the Day Care Eevee), Route 6, Underground Path and Route 9, and Route 6's trainer Jeff then opens Vermilion City, the S.S. Anne, Route 11 and the north of Route 12, all before Misty and Bugsy.

**One screen at a time** (`runPages` in `app.js`). Each step of the path becomes pages: an areas step gives a page per area and, after an area with trainers, a trainers page; a fight step is one page with four tabs (get ready, plan, battle, result). The pages of the chapter you're in are shown as dots; you can go back to any earlier page, and Next on the page you're at moves you on (an area without an encounter stays open; Next on the last page of an areas step marks the step passed, as "Move on" did). Your place is `run.at`, saved with the run; a transient `S.view` is a page you went back to. Route trainers whose fixed levels are above the chapter's cap + 4 aren't listed on its trainers page (Viridian City's are the Viridian Gym's, Lv 37-43, and Route 21's are swimmers at Lv 62-70); trainers whose levels follow yours always are. Results for route trainers are kept in `run.tr` (ROM trainer id → won / skipped); they never move the level cap.

## What's open when: the world, walked from the ROM (`tools/world_logic.py`)

A walker goes over every map tile by tile with FireRed's movement rules: collision and elevation bits, ledges, one-way walls, warps (only on door, stair, ladder, arrow and pad tiles), map connections, water (Surf: Soul Badge and HM03; waterfalls: HM07), and the field obstacles with Radical Red's own badge table at `0x9148738` (Cut: Cascade Badge and HM01; Strength: Rainbow Badge and HM04; Rock Smash: Marsh Badge and HM06; no Pokémon has to know the move). Every script it can reach (people, triggers, signs, hidden items, the map's own scripts) runs in a small interpreter: flags, variables, items, trainer wins, objects removed, tiles changed, warps. Bosses (the Coach's boss table) stop it; it records where each one is first met, then wins them one at a time and walks again: each fight's new maps, items, gifts and unlocks are what it opens. In about 10 seconds it walks the whole main game, 109 fights and 258 maps, in each difficulty (`data/world_hardcore.json`, `data/world_normal.json`). What it had to learn to get there:

- **Menus** (`multichoice`) and random rolls split a script: every choice is followed, and the result is what any of them can do. A boss blocks a trigger only when every path meets it.
- A **counter** a script keeps raising (var 0x5137) never settles: a variable counts only up to one more than the largest number any script compares it with (`var_cap`).
- **Picking up an item ball** hides it (its flag is set): Silph Co.'s doors check the Card Key ball's flag `0x192`, not the item.
- **Elevators** set where their door goes with `setdynamicwarp`; the walker follows every floor the panel offers (the Lift Key's check included).
- **Temporary variables** (0x4000-0x400F) are what the map's own on-load and on-transition scripts set: the Cycling Road gatehouse sets one when you have the Bicycle (flag 0x271).
- `specialvar` GetBattleOutcome (special 0xB4) says you won (the Pokémon Tower's ghost Marowak, the Snorlax); special 0xF5 (choosing your Pokémon for a tag battle) says you chose.
- **Switches** (the Pokémon Mansion's statues) flip doors: a door any switch state opens stays open, since you can flip it back. A door that **shuts behind you** (each Elite Four room) doesn't stop you: you were already through it; and a room's own script walking you off a solid door tile is followed (`entry_shift`).
- Flag `0x200` is set from the start; cutscenes clear it for a moment to show their extras and set it again, so it stays set (otherwise the hack's creator, who battles you in front of the Pokémon League door, would stand in the doorway forever).
- **Hardcore Clair** checks your whole party before she battles (`callnative 0x9077E3C`): no Fairy types, and no Altaria, Absol or Audino holding the Mega Stone that makes it Fairy. The walker assumes you bring a party that passes; the Coach warns on her fight page and plans without them (`D.rules`).
- Optional fights (no badge or story milestone) that can be reached and belong to the chapter you're in or the next come first, so each area is opened at the earliest point (`pick_next`).

Facts it turned up: the PokéVial trial (Viridian) and the Time Changer are open from the start; Infinite Repel after Brendan in Viridian Forest; the Move Relearner trial after Archer at Mt. Moon; the Dig Grunt and Route 6's Jeff before Misty (above); the Mega Ring after Silph Co.'s Giovanni (Saffron), which opens the leader rematches; gift Pokémon the path didn't list: Omanyte (Vermilion), Eevee Lv 25 (Celadon), Larvitar Lv 30 (Celadon), Lapras Lv 25 (the rival at Silph Co.), Tauros Lv 35 (Saffron's dojo), a Magikarp (Route 4) and eggs in Pewter, Cerulean and Vermilion. Before the Pokémon League door a surprise boss waits: **soupercell**, the hack's creator (trainer 24), who warns that your rival's last team won't resemble the one you've seen. Not walked yet: the Sevii Islands and the rest after the Champion (their ferry and ticket chain).

## Side quests, trials and services (`tools/extract_trials.py`, `tools/extract_extras.py`, `tools/solve_trials.js`)

**Trials.** Four people lend you Pokémon for a battle with a prize (`data/trials.json`). Their scripts set flag 0x1042 (a **puzzle battle**: `callnative 0x9079301` shows six rentals and you pick three) or 0x104B (a **rental battle**: `callnative 0x9079288` gives you all six) before a `trainerbattle 9` with var 0x8000 = 0xFEFE (CFRU's "continue after a loss" battle, 14 bytes; the script tables had it as 10). Rentals are rows of the table at 0x9124D00 (60-byte rows, team pointer at +0x24: puzzle row var 0x5127, rental row var 0x5127 + 2). The opponent's team comes from the party builder's special cases (0x0907B662-0x0907B848): with 0x1042, trainer 7 uses the record at 0x9124DF0 and trainer 6 the next; with 0x104B, trainer 5 uses 0x9124E90 and trainer 14 the next.

| Where | Battle | Prize |
| --- | --- | --- |
| Viridian City (house) | pick 3 of Rookidee, Skarmory, Gible, Aron, Shuckle, Fletchling (Lv 5) against six Lv 100 Shedinja (Focus Sash; the last holds Heavy-Duty Boots) | the **PokéVial**: a portable Pokémon Center in the skills menu, 6 heals, refilled by Nurse Joy |
| Cerulean City (house) | pick 3 of Phanpy, Fletchling, Taillow, Anorith, Mienfoo, Buneary (Lv 5) against Aron, Pikachu, Gastly, Skorupi, Timburr, Larvesta (Lv 5) | the **Move Relearner** in your party menu, for good (he also teaches moves himself) |
| Route 5 Day Care | the Day Care man's six Hisuian Lv 100s against his six Hisuian Lv 100s | a Lv 5 **Eevee**; try as often as you like |
| Celadon Game Corner | bet $10,000, $50,000 or $100,000 on six Metronome-only Lv 100s a side | double the bet |

The puzzle battles say "among these choices lie a guaranteed path to victory". `tools/solve_trials.js` searches every pick in every order with the simulator and the boss AI (no voluntary switches; replacements in party order), turn by turn, for a line that wins **against every move the opponent could pick** (and every Pokémon a Roar could drag in), with states remembered; then replays it with real dice. For Viridian it finds three, all Skarmory, Aron and Gible: lead Aron (Sturdy holds one hit) for Stealth Rock; when it falls, send Skarmory and switch straight to Gible, whose Iron Barbs knocks out the Shedinja that hits it while the rocks take the next four; Skarmory comes back (Sturdy again) and Drill Pecks the last one, whose Heavy-Duty Boots replaced its Focus Sash. Gible can't be the last of yours: if both last Pokémon go down together the game counts a draw, and a draw is a loss. Cerulean's search (lineups the game's own hint names: lead Buneary, with Fletchling) found no line within 12 turns; the Coach shows his hint.

**Skills** (the skills menu, script 0x9058437): Auto Run always; **Infinite Repel** (flag 0x1057: beat Lass Anne in Viridian Forest); **PokéVial** (0x1047); **Time Changer** (0x1058: the aide in Oak's Lab, three questions: Pancham, 5 PM, Never), which sets day, night or dusk for night encounters and evolutions.

**Services and gifts** (`data/extras.json`, found by what each person says): the Pokémon Center helper (free nature changes, gender swaps for evolutions, mode info, codes, and with the Rare Candy code a "set to level cap"); in Saffron an EV reducer, EV and IV checkers, an IV-to-0 setter (Trick Room), a Hidden Power IV setter, a ball switcher and a hidden-ability swapper (a Bottle Cap); in Lavender an EV trainer and an Audino battle for Exp.; in Fuchsia the Move Deleter, an Egg Move tutor (name four cries) and wild double battles; Two Island's starter tutor (beat him with starters only); One Island's Battle Simulator; three egg sellers ($5,000 each in Pewter, Cerulean and Vermilion: a Wonder Egg or a Paldean Egg). Codes at the sign in your house: **Woyaopp** (Rare Candy), **DexAll** (DexNav), **SO2Toxic** (care packages), **TeamPreview** (see the opponent's team before a battle), **EZCatch** (easy catching). Mystery Gift codes at the Pokémon Center need the game cleared or New Game Plus; "Puzzle" (New Game Plus) skips the puzzle battles.

**Leader rematches** once you have their badge and the item: Brock (Mega Ring: Aerodactylite, TM71), Misty (Mega Ring: Gyaradosite and a Lv 5 **Finizen**; with the Z-Power Ring too: Waterium Z and a Lv 100 Drednaw), Lt. Surge (Manectite), Erika (Mega Ring: a Lv 5 **Ogerpon** and TM86), Cole on Route 8 (Rocky Helmet, Centiskite), Clair (Z-Power Ring: TM72, a Lv 100 Dragapult), Oak (Eevium Z).

The Coach's **Side quests & services** screen lists them all with where they are and when your run can first reach them; the run page shows the ones that open as you go.

## Simulator fixes from the trials

- **A draw is a loss.** Outside the Battle Frontier, CFRU keeps FireRed's `checkteamslost` (atk24 at 0x802240A): when both sides are out of Pokémon after the same action, the outcome is LOST | WON = DREW, and `IsPlayerDefeated` counts a draw: you white out. Recoil, Life Orb, Rocky Helmet, Rough Skin, Iron Barbs, Explosion, Destiny Bond, Perish Song or end-of-turn damage on your last Pokémon while theirs goes down is a run-ending trade (`battleOver` in `sim.js`). The simulator had called it a win.
- **Residual damage is at least 1 HP** (Stealth Rock, Spikes, Life Orb, Rocky Helmet, Rough Skin and Iron Barbs, poison, Leech Seed, Curse, crash damage): a 1-HP Shedinja falls to the rocks.
- **Replacements after a faint on entry**: one that goes down to hazards as it comes in is replaced at once, until one stands.
- **58 items the ROM shortens** ("HeavyDBoots", "WeaknessPol.", "Safe Goggles", "Ut. Umbrella", "Protect Pads", "Electr. Seed", "Terrain Ext.", "BrightPowder") now go by their full names (`E.itemName`), so the simulator's and the boss AI's checks by name work: Heavy-Duty Boots, Weakness Policy, Safety Goggles, Utility Umbrella, Protective Pads, Electric Seed and Terrain Extender had never taken effect.
- **Wonder Guard** lets only super-effective damaging moves in (fixed-damage moves too: they have power 1 in the ROM), and Final Gambit and Endeavor respect type immunities.

## Battle replays

In recorded battles (the plan's most likely line and live battles) every event carries who it's about and a snapshot of the field right after it: each active Pokémon's species, name, level, HP and status, and which of each side's Pokémon can still fight (`sim.js`, `log` and `snapshot`). The battle screen (`app/stage.js`) animates those events and then draws the snapshot, so what you watch always matches what the simulator computed: Mega Evolution swaps the sprite, damage pops show the HP each hit took, and faints, status, stat changes and healing each get their own effect.

## Normal Mode with Minimal Grinding

The Coach's other difficulty. Without flag `0x1034` the party builder (above) takes a boss's team from the Normal boss records (`0x1126340`, 108 of the 153 boss fights, with natures, items, moves and IVs like the Hardcore records), else from the records used in every mode (`0x11259DC`), else from the regular trainer table with its spread (`normalTeam` in `tools/build_app_data.js`, kept as each boss's `np`, `ndbl` and, for rivals, `nv`). The 45 fights without a Normal record include the first rival fights, Brendan, and generic trainers listed in the Hardcore table. Minimal Grinding (`0x1032`) skips the EVs of records and spreads, so no trainer EVs are kept, in either mode (regular trainers' spreads were the only ones that had any). A spread with a Hidden Power type gets IVs of 31 or 30 that give that type (the type code is the type ID; the exact IVs the game picks aren't traced, so a stat can be off by one). A random ability slot is taken as slot 1. Level values 101-104 follow your highest level 2 lower outside Hardcore until the game is cleared (`E.setMode(mode, cleared)`). Each boss carries `mi`, the milestones done before it, so its cap in either mode is `caps[mode][mi]`. Move bans and ability changes are Hardcore's only (`isBanned`, `hardcoreAbility` return early). The care package is walked with `0x1032` alone (`normal` in `care_package.json`, `n` in the app data): Hardcore's lists plus weather rocks, terrain seeds, Weakness Policy, Throat Spray, Air Balloon and Terrain Extender, without the EV items Minimal Grinding leaves out. The run saves its difficulty (`run.mode`); switching it swaps the boss teams, caps and double-battle flags in place (`syncMode` in `app.js`), rebuilds the run path and clears everything worked out for the other one. The plan worker gets the difficulty with each request.

## Your Pokémon's stats under Minimal Grinding

Radical Red's `CreateBoxMon` (`0x09078512`) takes a fixed IV (0-31, trainer Pokémon) or `USE_RANDOM_IVS`; for random IVs it rolls `Random()` and, when flag `0x1032` (Minimal Grinding) is set, writes 31 into all six IV fields (`0x090786C0`: `SetMonData` 0x27-0x2C) instead of random ones. The gift and egg paths do the same (`0x090879B4`, `0x09087FB4`). EV gain after a knock-out is skipped while `0x1032` is set (`0x090945F6`). The Hardcore choice script sets `0x1034` and `0x1032` together (`setflag 0x1034; setflag 0x1032` at `0x0104F10C`), so in both of the Coach's difficulties every Pokémon you get has perfect IVs and no EVs: its default numbers for your side are the game's.

## Moves that lock you in, trap you or lock a move out

From the engine source (`atkB3_rolloutdamagecalculation`, `CancelMultiTurnMoves`, `SetMoveEffect`, the end-of-turn steps):

| What | How long | Ends early | Coach |
| --- | --- | --- | --- |
| Rollout, Ice Ball (effect 117) | 5 hits from the first that lands, power 30, 60, 120, 240, 480 (×2 after Defense Curl) | a miss or no effect; can't move | `useMove`, `rampPowers` |
| Thrash, Petal Dance, Outrage (27) | 2-3 turns (`(Random() & 1) + 2`), then confusion | can't move (no confusion) | `useMove` |
| Uproar (159) | 2-5 turns (`(Random() & 3) + 2`); nobody falls asleep | can't move | `useMove`, `canStatus` |
| Bide (26) | stores 2 turns, returns double | can't move | `useMove` |
| Bind, Wrap, Fire Spin, Clamp, Whirlpool, Sand Tomb, Magma Storm, Infestation, Snap Trap (42) | 4-5 turns (`(Random() & 1) + 4`), 7 with Grip Claw; 1/8 max HP a turn, 1/6 with Binding Band | the binder leaves; Rapid Spin | `hitOne`, `endOfTurn` |
| Mean Look, Block, Spider Web, Anchor Shot, Spirit Shackle, Thousand Waves, Jaw Lock (both sides), Octolock (106) | while the trapper stays in; Octolock drops Def and Sp. Def each turn | the trapper leaves | `statusMove`, `hitOne` |
| Shadow Tag, Arena Trap (grounded), Magnet Pull (Steel) | while the holder is in | | `canSwitch` |
| Disable (86), Torment (165) | 4 turns; until it switches out | | `usable` |

"Can't move" is sleep, full paralysis, a flinch, hurting itself in confusion or Truant (Radical Red's freeze is frostbite, which doesn't stop a move; see below): the engine's attack canceler calls `CancelMultiTurnMoves`, which also drops a charging two-turn move. Ghost types and Shed Shell always get out of traps; nothing gets out of its own lock, charge or recharge turn. `canSwitch` is the one rule for both sides (the ported AI uses it too), and `lockInfo` tells the live battle what to say.

## Moves whose effect comes later, and switches that carry things over

From the engine (`end_turn.c`, `atkD4_trywish`, `general_bs_commands.c`, `switching.c`):

| Move | Effect | When | Coach |
| --- | --- | --- | --- |
| Wish (179) | heals max(1, the wisher's max HP / 2) | end of the next turn, whoever is in that spot (not at full HP); one at a time per spot | `statusMove`, `delayedEffects` |
| Future Sight, Doom Desire (148) | the hit, worked out when it lands from the user as it is then (its stat changes only if it's still out); Sturdy and Focus Sash hold | end of the turn two turns after the one it's used; fails if one is already coming to that spot; lost if no one is there | `futureAttack`, `futureHit` |
| Perish Song (114) | everyone on the field without a count (not Soundproof) gets 3; each end of turn the count shows, then drops; at 0 it faints | the end of the third turn after the one it's sung; switching out ends it, Baton Pass hands it on | `statusMove`, `endOfTurn` |
| Healing Wish, Lunar Dance (168) | the user faints; the next Pokémon to come into that spot hurt or statused is fully healed and cured (before hazards) | the replacement after the turn | `statusMove`, `onEntry` |
| Memento (168) | the target's Attack and Sp. Atk -2, the user faints | | `statusMove` |

End of turn is the engine's order for these: weather damage for everyone (sandstorm at least 1 HP now), then Future Sight, then Wish, then each battler's own effects, with the perish count after Yawn. **Baton Pass** hands over stat changes, Substitute, confusion, Focus Energy, Leech Seed and the perish count. **Shed Tail** (half the user's HP, fails at half or less) hands over a Substitute of a quarter of its max HP. **Chilly Reception** starts snow, then switches out (like Teleport, last). **Roar, Whirlwind, Dragon Tail and Circle Throw** drag in a random bench Pokémon (`forcedPick`). Who comes in after any of them is the player's (or the AI's, `ai.pivotTo`) choice in the live battle, which asks.

**Abilities that answer a damaging hit** (`onHitAbility`, after contact punishment; the engine's `ABILITYEFFECT_MOVE_END` list, Paldea's as their games have them). Sand Spit starts a sandstorm (5 turns, 8 with Smooth Rock) unless one is up. Run 6's Silicobra did this in Normal Mode; Hardcore turns your Sand Spit into Sand Force. Seed Sower starts Grassy Terrain. Toxic Debris lays Toxic Spikes on the attacker's side after a physical hit (up to 2; on 4 boss Pokémon, Glimmet and Glimmora). The rest:

- Stamina: +1 Defense. Weak Armor (physical hit): -1 Defense, +2 Speed.
- Water Compaction (Water): +2 Defense. Steam Engine (Fire or Water): +6 Speed.
- Justified (Dark): +1 Attack. Rattled (Bug, Dark, Ghost): +1 Speed. Thermal Exchange (Fire): +1 Attack.
- Anger Point (a critical hit): Attack to +6. Berserk (falling below half): +1 Sp. Atk. Anger Shell (falling below half): +1 Attack, Sp. Atk and Speed, -1 Defense and Sp. Def.
- Cotton Down: -1 Speed to everyone else. Cursed Body: 1 in 3 disables the move, 4 turns.
- Mummy and Lingering Aroma pass on (contact). Wandering Spirit swaps (contact). Perish Body: both get a perish count (contact).
- Aftermath: 1/4 of the attacker's max HP when knocked out by contact. Innards Out: the HP it lost.

## Live turns as the game plays them

**Pivots** (run 6: "it wasn't letting me choose the next mon after the U-turn"). When a U-turn, Volt Switch, Flip Turn, Parting Shot, Baton Pass, Teleport, Shed Tail, Chilly Reception, Roar or Dragon Tail switches someone out, step 3 asks **who came in**. The AI's pick (`pivotTo` from its switch check, or its best switch-in) or the Coach's pick for you is marked, and the turn is played again with your answer (`L.pivotIn`, used by the preview's `replace` and `forced`). HP rows cover both Pokémon. Applying the report keeps whoever came in (`finalAt`); it used to put the U-turner back, so the next turn's prediction started from the wrong Pokémon, and the U-turn had to be logged again as a switch. A line under the battle shows what's on the field and still to come: weather and terrain with turns left, hazards, screens, Tailwind, a Wish ("heals … at the end of this turn"), Future Sight, perish counts and a waiting Healing Wish.


The turn report's third step replays the turn with what you saw (`useMove` and `playTurn` in `sim.js`): an action can carry `first` (it moved first: beats priority and Speed in singles, and skips Custap), `outcome` (`hit`, `crit`, `miss`, or `par`, `slp`, `conf`, `flinch`: couldn't move; asleep with a moved outcome means it woke; `conf` hurts itself with the game's 40-power typeless hit), `ko` (its hit knocked the target out, past Sturdy and a Sash) and `noKO` (the target held on at 1 HP or more). The report sets `ko` or `noKO` on the other side's move when you move a Pokémon's HP to 0 or back up from 0, so who got to move stays right. Each attempt leaves an `outcome` event, which is how the report reads the order and the result back. A status set by hand starts its counter (sleep: 2 turns).

**Speed** (`speedLesson` in `app.js`): when the order you report contradicts the Speeds the Coach assumed (same priority, no Trick Room, no Quick Claw, Custap, Quick Draw or Stall), it searches your Pokémon's raw Speed (between IV 0 / EV 0 and IV 31 / EV 252) for the closest value that explains it, keeps it for the rest of the battle (`speRaw`, used by `speed()`), and saves a Speed IV estimate (or EVs, if it moved first) with the Pokémon (`iv`, `ev`, `ivGuess`), unless you entered its real stats. A tie is left as a tie.

**IVs from the summary screen** (`readStats`/`setStats`): each stat the game shows is matched against the Gen 3 formula for every IV 0-31 with no EVs; the IVs that fit form a range (at Lv 16 several IVs give the same stat), narrowed by later entries, and the middle of the range is used. A stat above what IV 31 gives is explained by EVs (from battles). A nature change keeps the IVs; a species correction (not an evolution) drops them. Pokémon carry `iv` and `ev` into every spec (`specOf`), and `statsAt` marks real ones.

## Status and stat moves

`statusEffect` (`sim.js`) says what a status move does: boosts for you (Swords Dance, Shell Smash…), drops for the target (Growl, Leer, Scary Face…), a status, confusion (Supersonic, Swagger, Flatter) or healing. The planner (`plannerPolicy`) and the move advice (`duelPlan` in `advice.js`) both weigh using one first: the foe gets one free hit (its best move's average; the chance it knocks you out from there), then the one-on-one race is worked out again from the new state (`E.matchup` with the boosts, drops or status). Paralysis, sleep and confusion don't change the damage, so their effect on the race is worked out from it (`statusRisk`): the foe gets the same number of chances to hit (`hitsTaken`) and needs as many hits to knock you out (`toKOme`), but a paralyzed foe acts 3 turns in 4 (binomial), a sleeping one loses 1 to 3 turns (averaged), a confused one hurts itself 1 time in 3 for about three turns. A move gets no credit in a race you can't win (no way to knock the foe out), and its cost counts what losing your Pokémon means for the rest of your team and the HP left after the whole fight, so attacking wins a tie. Move advice values a moveset as the sum, over the next two big fights' Pokémon, of the best plan against each (verdict and risk) plus damage; a status move that helps against none of them counts a little against the set. `bestSet(..., true)` (the move plan) swaps up to two status or stat moves into the damage-coverage set when that handles their team better.

## Radical Red's damage, from the game's own code

`app/damage.js` is the damage formula step for step as the game does it, and `tools/game_damage.py` checks it against the ROM's own code running in a CPU emulator (Unicorn; `tools/gba_emu.py` maps the ROM and RAM, handles the BIOS calls it needs and calls functions). Each case writes two battlers into `gBattleMons` and runs the battle script commands an attack runs: `atk05_damagecalc` (`0x09087430`), `atk06_typecalc` (`0x09082A48`), then `atk07_adjustnormaldamage` (`0x09083E86`) once per roll. `tools/damage_cases.js` makes random cases with the engine's 16 rolls; `tools/damage_compare.js` compares. 30,000 random cases, all 16 rolls: no differences (every ability below 256 and every held item once each way, weather, terrain, screens, crits, burn, frostbite, stages, low HP, variable-power moves, multi-hit moves per hit). The harness doesn't run the attack canceler, so moves the game stops before its damage step (Volt Absorb, Wonder Guard, Soundproof, priority into Psychic Terrain...) are counted apart, and Mold Breaker is mimicked by clearing the target's ability (the canceler does that for the move: `DisabledMoldBreakerAbilities`). Focus Sash and Sturdy cap the game's numbers at the target's HP − 1.

Addresses (Radical Red 4.1): battle script command table `0x0903EF20` (repointed from FireRed's `0x0825011C`); `atk04_critcalc` `0x0908252C`; `CalculateBaseDamage` `0x09085A10`; the base-power boosts (`AdjustBasePower`) `0x09085304`; the random roll `0x09081BA0`, which calls the LCG at `0x0808322C` (state `0x020386D0`, `s*0x41C64E6D + 0x3039`); `gNewBS` pointer `0x0203E038` (`criticalMultiplier[bank]` +`0x15C` in tenths, `ResultFlags[bank]` +`0x160`, the Protosynthesis / Quark Drive stat +`0x19`); terrain `0x0203E028`; the in-battle ability getter `0x090757D0` (0 when suppressed: Gastro Acid, Neutralizing Gas); `GetActualSpeciesWeight` `0x09084288` (alternate sizes `0x09161F7A`, the Pokédex `0x09814030`); `CanEvolve` (Eviolite) `0x090C1B90`, which asks the *party slot*, so the harness creates party Pokémon too. In `gBattleMons` (`0x02023BE4`, `0x58` each) CFRU keeps a third type at `+0x18`, where FireRed's unused HP stat stage was; the stages run from `+0x19` (Attack).

The game's order, all whole numbers: base power (variable powers) and its boosts (ability, then item, then Charge, terrain, sports), the attacking and defending stats with their ability and item boosts, sandstorm and hail, then the stages (a crit ignores the attacker's drops and the target's raises); `((2L/5+2) × power × A / D) / 50 + 2`; then Knock Off, Solar Beam in weather, weather, auras, Tinted Lens or Sniper, Expert Belt, the target's damage-cutting abilities, resist berries, screens, burn or frostbite, Parental Bond's second hit, spread; then ×1.5 for a crit (`atk05`); STAB (×1.5, ×2 Adaptability) and each of the target's types in turn, never below 1 (`atk06`); and the random roll last, `damage × (100 − (Random() & 15)) / 100` (`atk07`). So the lowest roll is always the highest roll × 85%, rounded down. The standard calculator applies the roll before STAB and type and chains its boosts in 4096ths, which put about 40% of rolls 1-3 HP off.

Radical Red's own changes, each read from its code or found by the emulator and then checked there:

| | Radical Red | Main series / standard calculator |
| --- | --- | --- |
| Iron Fist | ×1.3 (punching list at `0x103FE9A`) | ×1.2 |
| Gems | ×1.5 | ×1.3 |
| Life Orb | ×1.3 on base power | ×1.3 on the final damage |
| Liquid Voice | Water and ×1.2 | Water only |
| Transistor | ×1.5 | ×1.3 (Gen 9) |
| Illusion | ×1.3 while disguised | none |
| Rivalry | ×1.25 same gender, nothing otherwise | ×0.75 for the opposite gender |
| Reckless | its own list, Explosion, Self-Destruct, Misty Explosion, Chloroblast and Draco Barrage included, Axe Kick not | recoil and crash moves |
| Sheer Force | its own list of 184 (Blast Burn, Hydro Cannon, Frenzy Plant, Scale Shot included; many Gen 9 moves not) | moves with secondary effects |
| Mega Launcher | adds Flash Cannon, Snipe Shot, Octazooka, Armor Cannon | pulse moves |
| Sharpness | adds False Swipe, Shadow Claw | slicing moves |
| Bulletproof | adds Spike Cannon, Flash Cannon, Snipe Shot | ball and bomb moves |
| Striker (RR) | ×1.3 on its kicking list (Stomp, Pyro Ball, High Horsepower, Low Sweep, Triple Arrows, Aqua Step...; not Axe Kick) | |
| Wind Rider | its list (Sonic Slash in, Aeroblast and Tailwind out) | wind moves |
| High-crit moves | adds Drill Peck, Razor Shell | |
| Defeatist | at 1/3 HP or less | at 1/2 |
| Primal Armor (RR) | super-effective hits ×0.5 | |
| Purifying Salt | Ghost damage ×0.5 at the end | Ghost attacker's stat ×0.5 |
| Protosynthesis, Quark Drive | ×1.3 to the stat stored when they switched on (Def and Sp. Def too) | ×1.3 (5325/4096) |
| Orichalcum Pulse, Hadron Engine | ×4/3 Attack in sun, Sp. Atk in Electric Terrain | ×5461/4096 |
| Terapagos (its ability is Multiscale's number, shown as Tera Shell) | at full HP, ×0.5 for each type slot and the blank third one (×1/4 for one type), and no Multiscale | Tera Shell: not very effective |
| Frostbite (replaces freeze) | special moves ×0.5 (see below) | freeze |
| Hail | Ice types' Defense ×1.5, like snow | damage only (Gen 3-8) |
| Explosion, Self-Destruct, Misty Explosion | the target's Defense (Sp. Def for Misty Explosion) counts half | no |
| Barb Barrage | ×2 against any status | against poison |
| Hex, Bitter Malice, Infernal Parade | ×2 against any status (`0x1040272`) | Bitter Malice: no |
| Hard Press | keeps its table power of 1 (2-3 HP) | 100 × the target's HP fraction |
| Judgment | the user's first type (Arceus's follows its plate) | the plate's type |
| Electro Ball | 60 at least | 40 when slower |
| Electro Drift | ×1.3 on base power when super effective | ×5461/4096 |
| Psyblade, Expanding Force, Rising Voltage, Terrain Pulse, Misty Explosion | ×1.5, ×1.5, ×2, ×2, ×1.5 in their terrain | |
| Knock Off | no ×1.5 against a Z-Crystal, the holder's own Mega Stone, any Mega's stone, or the items forms need | |
| Weights | the game's Pokédex (Low Kick, Grass Knot, Heavy Slam, Heat Crash): 78 differ from the standard data, a few oddly (Fraxure and Volcanion weigh 0, so Heavy Slam against them is 40 power; Cherrim 0.1 kg; Vanillite 172 kg) | |
| Macho Brace, Power items | Speed ×0.75 | ×0.5 |

**Abilities past number 255** (Pure Power, Filter, Shell Armor, Rough Skin, Air Lock, Shadow Shield, Prism Armor, Libero, Tera Shell...) are display names only: the battle code keeps abilities in one byte, and a Pokémon shown with one of them has the number of an ability that works the same (Filter shows for Solid Rock's). Species data therefore lists the working ability.

**Mold Breaker** and the moves that ignore abilities (the list at `0x1040136`: Moongeist Beam, Sunsteel Strike, Photon Geyser, Shell Side Arm) work in the attack canceler, which switches the target's breakable abilities off for the move; `damage.js` drops them the same way.

## Move effects and abilities, from the game's battle scripts (`tools/battle_scripts.py`)

A move's effect number picks a battle script (`gBattleScriptsForMoveEffects` at `0x103F508`, 256 effects), and the script decides what the move does, including the special cases for single moves (`jumpifmove MOVE_X`). `tools/battle_scripts.py` disassembles every one with the command set read from CFRU's `battle_script_macros.s` (`--moves` lists the moves each script singles out). The in-game move descriptions are at `0x103DF74` (one pointer per move from move 1); they say what Radical Red changed. To find what the simulator got wrong, every move in the ROM was played once in a small battle (Mew against Mew, a bench on each side) with dice that make every chance happen, and what changed was recorded; anything that didn't match the script was fixed and has a test in `tests/moves.test.js`.

What the game does that the simulator was missing or got wrong:
- **Fixed damage** is set by the script: Super Fang and Ruination halve the target's current HP (at least 1), Dragon Rage does 40, Sonic Boom 20, Seismic Toss and Night Shade the user's level, Psywave 50-150% of it; type immunities still apply (`typecalc2`). The calculator gave Super Fang 0 and Dragon Rage 1. `engine.js` now works these out itself.
- **Friendship moves**: trainer Pokémon get full friendship, or none if they know Frustration (`ShouldGiveTrainerMonMaxFriendship`), so a boss's Frustration hits at 102 power like Return. Yours is assumed full: Return 102, Frustration 1.
- **One-hit KO moves** (Guillotine, Horn Drill, Sheer Cold) are effect 0 with 1 power in 4.1, and no Pokémon can learn them; Fissure's slot is Soul Robbery. They do 1-2 damage (the emulator agrees).
- **Hard Press** stays at 1 power (the game's damage code, run in the emulator). **Magnitude** rolls its power in its script (`magnitudedamagecalculation`): 10-150, 70 in the middle. Trump Card is 40.
- **Hurricane** confuses (its script jumps to the confusion hit); **Dark Hole** may put to sleep (its chance, 40%); **Dire Claw** may poison, paralyze or sleep; **Diamond Storm** raises the user's Defense by 2; **Freezy Frost** and **Clear Smog** remove stat changes; **Sappy Seed** seeds (not Grass types); **Stone Axe** and **Ceaseless Edge** lay Stealth Rock and Spikes; **Salt Cure** chips 1/8 a turn (1/4 to Water and Steel) and doesn't trap; **Mortal Spin** poisons without the Speed boost; **Fell Stinger** gives +3 Attack only when it knocks out; **Mind Blown** and **Steel Beam** cost half the user's max HP, rounded up, hit or miss (`ATK49_MOVE_RECOIL`); Struggle a quarter.
- **Endure** leaves the user at 1 HP instead of blocking the hit (it shares Protect's odds). **Mat Block** works on the first turn out only.
- **Poltergeist** fails on a target with no item; **Last Resort** fails until the user has used each of its other moves since it came in; **Dream Eater** needs a sleeping target; **Belch** needs a berry eaten; **Steel Roller** needs terrain (it and Ice Spinner clear it); **Burn Up** and **Double Shock** need the user's type; **Shell Trap** needs a physical hit first; **Snore** needs sleep; **Spit Up** and **Swallow** need Stockpile.
- **Counter**, **Mirror Coat**, **Metal Burst** and **Comeuppance** return the hit taken this turn (x2, x2, x1.5, x1.5) to whoever dealt it, and fail otherwise.
- **Pursuit** hits a Pokémon that switches out first, at double power.
- **Semi-invulnerable targets**: only the game's lists reach them (`ignoreInAir`: Gust, Twister, Thunder, Sky Uppercut, Hurricane, Smack Down, Thousand Arrows; `ignoreUnderground`: Earthquake, Magnitude; `ignoreUnderwater`: Surf, Whirlpool), and those do double damage there. Smack Down and Thousand Arrows bring a flyer down.
- **Protect**: Feint, Shadow Force, Phantom Force, Hyperspace Hole/Fury and Hyper Drill get through and lift it (`liftProtect`); Burning Bulwark burns, Silk Trap lowers Speed, Obstruct lowers Defense by 2 on contact.
- **Item moves**: Knock Off, Thief and Covet (take it), Bug Bite and Pluck (eat the berry), Incinerate (burn a berry or Gem), Trick, Switcheroo and Bestow (a Choice item handed over locks the target), Recycle; Fling and Natural Gift are left out.
- **Field and side effects**: Gravity (5 turns: accuracy x5/3, everyone grounded, Fly and friends banned), Magic Room and Wonder Room no longer act as Trick Room, and Lucky Chant and Magnet Rise no longer act as Tailwind; Lucky Chant stops critical hits, Magnet Rise floats over Ground moves, Mist blocks stat drops, Defog clears hazards on both sides and screens on the target's, Court Change swaps the sides' effects, the terrain moves set terrain, Aurora Veil needs hail or snow, and Brick Break, Psychic Fangs and Raging Bull shatter screens.
- **Status moves by name**: Transform (and Imposter), Assist (a random move of a teammate's), Nature Power (Tri Attack, or the terrain's move), Charge, Ingrain, Aqua Ring, Pain Split, Psych Up, Topsy-Turvy, Heal Bell, Aromatherapy, Refresh (frostbite too), Psycho Shift, Purify, Life Dew, Jungle Healing, Lunar Blessing (a quarter), Soak, Forest's Curse, Trick-or-Treat, Magic Powder, Reflect Type, Role Play, Skill Swap, Worry Seed, Gastro Acid, Entrainment, Simple Beam, Lock-On, Mind Reader, Laser Focus, Nightmare, Heal Block, Tickle, Kinesis, Sweet Scent; Spit Up and Swallow with Stockpile; Throat Chop stops sound moves for two turns and Psychic Noise healing; Glaive Rush leaves its user open.
- **Radical Red's own changes** the data shows: Sand Attack and Smokescreen lower Attack; Mud-Slap, Mirror Shot, Mud Bomb, Leaf Tornado and Night Daze lost their accuracy drops; Muddy Water and Flash lower Attack; Octazooka lowers Speed; Roar of Time forces a switch; Teleport is a pivot.
- **The boss AI** gets the engine's checks for these (`ai_negatives.c`): no Poltergeist without a target item, no Last Resort too early, no Counter when it expects a status move, no Metal Burst when it would move first, no Endeavor or Pain Split from higher HP, no fixed-damage move into an immunity, no Trick when the items match, no Tailwind under Trick Room, and the rest.

**Abilities** that change how a fight goes (`tests/abilities.test.js`): Contrary (turns stat changes around: a Contrary Leaf Storm raises Sp. Atk) and Simple; Trace; Neutralizing Gas (switches every other ability off while it's out: Levitate stops working); Magic Bounce (status moves and hazards go back); Good as Gold; Synchronize; Damp (no Explosion, Self-Destruct, Misty Explosion or Mind Blown); Unnerve and As One (no berries); Gluttony, Ripen, Cheek Pouch; Protean and Libero (the user takes its move's type: every move, as CFRU does it); Soul-Heart; Supreme Overlord (+10% power per fainted ally); Gulp Missile; Bad Dreams; Shed Skin, Hydration, Early Bird, Leaf Guard; Poison Touch, Effect Spore, Toxic Chain, Magician; Electromorphosis and Wind Power; Steadfast; Cloud Nine and Air Lock (weather off while they're out); Illuminate (Radical Red: +20% accuracy); Zero to Hero (Palafin's Hero form after it switches out); Throat Spray. Abilities the battle changes (Skill Swap, Gastro Acid, Transform) now reach the damage too.

**Forms a held item brings out**: the game's form table (`D.mega`) has entries with no Mega Stone, where the condition is the held item: Kyogre with the Blue Orb and Groudon with the Red Orb (Primal Reversion), Dialga with the Adamant Orb, Eternatus with its Eternamax orb. These change as the Pokémon comes in and don't use the side's Mega. Rayquaza Mega Evolves when it knows Dragon Ascent, and Necrozma Ultra Bursts with Necrozium Z. Primordial Sea, Desolate Land and Delta Stream make heavy rain (Fire moves fail), harsh sunshine (Water moves fail) or strong winds, which last while their Pokémon is out and can't be replaced by other weather. Bosses that use these: Misty's Kyogre (Hardcore), Lorelei's (Normal), Lance's Dialga and Rayquaza, Clair's and Terry's legendaries.

Left out: PP (and so Pressure), Plus and Minus (doubles), Dancer, Cute Charm and Attract, Hunger Switch, Imprison, Grudge, Spite, Snatch, Magic Coat, Mimic, Sketch, Metronome, Copycat, Mirror Move, Me First, Embargo, Telekinesis, Powder, Electrify, Ion Deluge, Wonder Room's swap and Magic Room's item block (they only last their turns), Last Respects and Rage Fist's growth, and the Booster Energy being used up.

## How they fight (`app/strategy.js`)

Each fight's Plan tab (and the Plan screen) has "How they fight, and what to exploit", worked out for every boss in both modes from their sets and the boss AI's rules (`ai.js`): nothing is written per boss. For each of their Pokémon: its fighting style (`PredictFightingStyle`: attacker, set-up sweeper, status attacker, staller, hazard setter, screens, phazer, Baton Passer, cleric), any form change (Mega, Primal and the held-item forms, Rayquaza, Ultra Burst), its item, its ability (Radical Red's in-game description where there's no note), and its moves that change how you play: Fake Out, priority, Sucker Punch (used only when it expects your attack), set-up (only when it judges it safe: `IncreaseStatViability`'s checks), Explosion and the like (when it would go down anyway), Destiny Bond (when it moves second into your knockout), hazards, screens, Trick Room, healing (when you threaten a knockout and the heal outpaces you), sleep and status (never into an immunity), pivots, phazing, Knock Off, Pursuit, Counter, Trick, Taunt, Encore, trapping, fixed damage, charge and recharge turns, self-lowering and lock-in moves, and its Z-Move. For the fight: the lead and how the rest come in, weather and terrain setters, and Intimidate. Exploits from the AI's rules: how it reads your move (your best-scoring move; it doesn't expect switches), the 93% roll it judges damage at, the conditions under which it switches out (all of them, in the engine's order), and, when the team has them, the Sucker Punch bait, chipping Focus Sash, Sturdy and Multiscale, Choice locks, Explosion and Destiny Bond turns, set-up sweepers held back by a threat, status immunities, Natural Cure and Regenerator switches, Trick Room, Weakness Policy, primal weather, Fake Out leads, and Defiant and Competitive. `tests/strategy.test.js` builds the notes for every boss in both modes.

## Frostbite

Radical Red turns on CFRU's `FROSTBITE` option (the in-game text: "A frostbite reduces Sp Attack. It also causes ongoing HP loss."; `"{x} got frostbite!"`, `"{x} is hurt by its frostbite!"`). A frostbitten Pokémon still moves (the canceler's freeze check is compiled out), its special moves do half damage, it loses 1/16 of its max HP at the end of each turn (not with Magic Guard), and it's cured by using a thawing move (`0x1040180`: Flame Wheel, Sacred Fire, Flare Blitz, Scald, Scorching Sands, Fusion Flare...) or by being hit by one or by Scald, Steam Eruption, Scorching Sands or Matcha Gotcha (`0x1040196`); not every Fire move. Hail doubles the chance of inflicting it. Ice types, Magma Armor and sun prevent it. The boss AI's `IsBankIncapacitated` doesn't count it, and its "thaw yourself" bonus is off. `sim.js` plays all of this; the live battle no longer offers "frozen solid".

## Open questions

- Which abilities Hardcore or Restricted Mode restricts for the player
- Boss Pokémon byte `+24` and bits 1–2 of byte `+25`
- Flags `0x38` and `0x53` (inferred from level consistency)
- Level-up learnsets (3-byte entries: u16 move, u8 level), needed for regular trainers that use default moves

## Evolutions, encounters, maps, trainers, tutors, sprites

- **Evolution table**: pointer at literal `0x08042F6C`; 16 entries of 8 bytes per species (DPE layout: method u16, parameter u16, target u16, extra u16). Method `0xFE` is Mega Evolution (parameter = stone item; extra 0) and `0xFD` Gigantamax. Methods follow CFRU's `enum EvolutionMethods`.
- **Wild encounters**: the main table `gWildMonHeaders` (pointer at `0x08082990`, now at `0x0872C984`, 134 maps) plus two clock tables at `0x09166428` and `0x09166AB8` (83 maps each). The code at `0x090C3550` reads the clock (`0x03005EA0`, hour at +6): `0x0908CC04` is true from 20:00 to 3:59 and `0x0908CFDC` from 17:00 to 19:59; either picks the `0x09166428` table, otherwise `0x09166AB8`. A map missing from the chosen table, or a method left empty in it, falls back to the main table. Headers are 20 bytes (group, map, padding, then land, water, Rock Smash and fishing pointers); slots use the FireRed odds (grass 20/20/10/10/10/10/5/5/4/4/1/1, surfing and Rock Smash 60/30/5/4/1, fishing Old Rod 70/30, Good Rod 60/20/20, Super Rod 40/40/15/4/1).
- **Maps**: `gMapGroups` pointer at `0x0805524C` (43 groups). Map header byte `0x14` is the region-map section; names are the vanilla table at `0x083F1CAC`, indexed by section - `0x58`. Radical Red renamed the Monean Chamber slot to "Oak's Lab"; its Unown table is ignored.
- **Trainer locations**: each map's object events (24 bytes; script pointer at +16) are scanned for `trainerbattle` (0x5C, trainer id at +2), following `goto`/`call`.
- **Move tutors**: 128 tutor moves (u16) at the pointer in `0x08120BE4`; compatibility at the pointer in `0x08120C30`, 16 bytes of bit flags per species.
- **Sprites**: from the ROM header: front pictures `0x08000128` and back pictures `0x0800012C` (both LZ77, 64x64 4bpp, sharing the palette at `0x08000130`, LZ77), icons `0x08000138` (two 32x32 4bpp frames, the menu animation), icon palette numbers `0x0800013C`, icon palettes `0x08000140`. `tools/extract_sprites.py` writes front, back and icon atlases (icons as 32x64 cells, both frames) for the app; they're game art, so they stay out of git.
- **Hardcore abilities**: the game's description of Hardcore Mode (`0x0910D9B9`) says it "restricts certain abilities and moves from the player". The change is code, not a table: the ability getters for slot 1, slot 2 and the hidden ability (e.g. `0x090C2218`) go through `0x0907979C`, which calls `0x09079584` when flag `0x1034` (Hardcore) or `0x103C` (Restricted) is set. That function swaps: Drizzle and Primordial Sea → Adaptability; Drought and Desolate Land → Sheer Force; Speed Boost → Infiltrator (Striker on species 891, Blaziken's form; kept on Flittle and Espathra); Trace → Synchronize; Sand Stream → Sand Force (Intimidate on Tyranitar 248/889, Solid Rock on Gigalith); Snow Warning → Slush Rush; Magic Bounce → Magic Guard; Anger Shell → Regenerator; Moxie, Beast Boost, Soul-Heart and Grim Neigh → Unnerve; Grassy Surge and Seed Sower → Self Sufficient (Intimidate on species 1104, Rillaboom); Defiant and Competitive → Clear Body; Hadron Engine → Quark Drive; Orichalcum Pulse → Protosynthesis; Stamina → Inner Focus; Triage → Natural Cure (kept on Comfey); Electric and Misty Surge → Telepathy; Psychic Surge → Dazzling; Contrary → Bad Company (kept on species 308); Imposter → Limber; Toxic Debris → Corrosion; Sand Spit → Sand Force; Blazing Soul → Flash Fire. The getter itself doesn't check whose Pokémon it is; the Coach applies it to your side only, as the game describes it and since 83 Hardcore boss Pokémon are built around these abilities. A boss's ability popup in-game settles it.

## Save files

FireRed layout: two 14-sector slots of 4 KB, footer at `0xFF4` (section id, checksum, `0x08012025`, counter); the higher counter wins. SaveBlock1 is sections 1-4 (party count `0x34`, party `0x38`, flags `0xEE0`, badges are flags `0x820`-`0x827`); the PC is sections 5-13 (current box, then 14 x 30 box Pokémon of 80 bytes). CFRU keeps Pokémon unencrypted in a fixed growth/attacks/EVs/misc order, with the hidden-ability flag in bit 31 of the IV word; `app/save.js` also accepts the vanilla encrypted layout.

## The boss AI port

`app/ai.js` follows CFRU's `src/Battle_AI`: `ai_negatives.c` (moves that fail or are absorbed: -10/-20), `ai_positives.c` (per-effect bonuses, `DamageMoveViabilityIncrease`), `ai_advanced.c` (`PredictFightingStyle`, `IncreaseStatusViability`, `IncreaseStatViability`, `ShouldTryToSetUpStat`, `ShouldRecover`, `ShouldPivot`, `IncreaseViabilityForSlowKOMove`), `ai_util.c` (`CalcStrongestMove`, `MoveKnocksOutPossiblyGoesFirstWithBestAccuracy`, `CalcShouldAIUseZMove`) and `ai_switching.c` (`ShouldSwitch`, `CalcMostSuitableMonToSwitchInto`, with the weights in `include/new/ai_switching.h`). The AI judges damage at the 93% roll (`AI_CalcDmg`) and only assumes crits for moves that always crit. Bosses use AI flags 7 (bad-move and positive scripts; the semi-smart script is skipped).

Two fixes came from a real run (the Route 22 rival, whose Snubbull used Power-Up Punch three times, then sent out Bulbasaur where the port expected Slowpoke):

- **Attacks that raise a stat** (effects 139 Attack up: Power-Up Punch, Metal Claw, Meteor Mash; 110 Sp. Atk up: Charge Beam; 96 Speed up: Flame Charge, Aqua Step…) get the stat-raising bonus in `ai_positives.c` when the boost chance is at least 75% and raising that stat is a good idea (`GoodIdeaToRaiseAttackAgainst`: the target has no Unaware, the stat isn't already +6, the user has a move that uses it). With it, Power-Up Punch outscores Covet, as in the game.
- **Replacements after a faint**: `CalcMostSuitableMonToSwitchInto` only takes a candidate with a strictly higher score. On a tie it takes the candidate if the current best faints to the player's Pokémon and the candidate doesn't, and when neither faints it flips a coin. The port now flips the same coin in random battles, and the turn report marks both Pokémon ("coin flip") so the player knows either can come.

Run 2 found the other big gap, in switching (Snubbull stayed in against Tentacool in the Coach's prediction, but switched to Squirtle in the game):

- **Only bad moves left** (`ShouldSwitchIfOnlyBadMovesLeft` → `CalcOnlyBadMovesLeftInMoveset`, `ai_util.c`): the AI keeps its Pokémon in while any status move still works (no penalty from `AIScript_Negatives`), while Knock Off can take an item, or when it has Protect. Otherwise, if its strongest attack does under a third of the target's remaining HP (counting the target's Leftovers and similar healing), and the best switch-in has an edge the current one doesn't (a knockout, a 2HKO, resisting every attack, walling the foe, or speed), it switches to the best switch-in, else the second best, as long as that one outspeeds, walls or resists everything and the predicted attack won't do too much to it. Snubbull's Thunder Wave kept it in on turn 1; once Tentacool was paralyzed, every attack it had was resisted, so it switched. The port used to approximate this with "every move scores below 95", which almost never happens.
- **Switching cooldown** (`gNewBS->ai.switchingCooldown`): 2 after a chosen switch (`SetSwitchingBankSwitchingCooldownTo2`, unless the other side switched that turn too), 1 after replacing a fainted Pokémon, minus 1 at each end of turn, and back to 0 whenever the player's Pokémon comes in (`SwitchIn_HandleAICooldown`). Most switching rules don't fire while it's above 0. The simulator now keeps it per Pokémon (`swCooldown`); before, the port treated any Pokémon that came in last turn as cooling down, including the lead on turn 1.

Run 6 lost to Bugsy's U-turns (Normal Mode: Lokix, Ledian, Scyther, Scizor). The AI check logged Lokix and Scizor U-turning into each other turn after turn, while the port predicted First Impression, Knock Off and Bullet Punch. Four pieces were missing or off:

- **Save the sweeper for later** (`ShouldSaveSweeperForLater`, the last switch check). A damager that can't knock the foe out leaves when the foe would knock it out first (to a switch-in that outspeeds and knocks out, if there is one). It also leaves when it has no useful boost or setup move and the best switch-in can knock the foe out. Otherwise it leaves half the time (a quarter if it could 2HKO), unless it already resists everything or its best move drains. It goes to a switch-in that resists every attack the foe has (`SwitchToBestResistMon`). With a fast pivot (`FastPivotingMoveInMovesetThatAffects`: U-turn, Volt Switch, Flip Turn or Parting Shot that works and goes first) it doesn't switch. It uses the pivot move, +9 (`PIVOT_IMMEDIATELY`), to that Pokémon (`ai.pivotTo`). So Lokix U-turns to Scizor against Gyarados on 42% of turn 1s, and Scizor U-turns back when Lokix resists what's in. The port used to turn every switch into a pivot when the AI had a pivot move, but in the engine only `ConfirmAISwitch` with a fast pivot does. Every other switch reason switches for real.
- **ShouldPivot**, ported again line by line. It now has the hazard check first, "it expects the player to switch: pivot", the branch where the foe moves first (KO, 2HKO, 3HKO+, each split by what the AI can do), Spikes with a hazard remover, and the attacking-stat check (-3 or lower; with both kinds of attack the engine compares a constant for Attack, so only Sp. Atk counts). Non-damagers don't get "try" in the first branch. `IncreasePivotViability` by style is now 3 attacker; 9 set-up, status, stall, Baton Pass; 7 cleric and screens; 4 phazer; 3 hazards (it was 9 for all but attackers). On "don't", the strongest move is worked out again without it (`RecalcStrongestMoveIgnoringMove`). With a Wish coming that a teammate needs, a pivot gets +7.
- **What the AI expects the player to do** (`PredictMovesForBanks`). The engine runs its own two scripts on the player's moves, with no guess about its own move yet. Its prediction is the best of them, ties at random. It expects nothing while the player recharges, loafs or sleeps (without Sleep Talk or Snore), and the locked move while locked in. When none of them reaches 100, it expects a **switch**. The port used to take the player's strongest attack. The prediction feeds who moves first, Protect, Sucker Punch, the absorb switch and the rest, and "expects a switch" makes it pivot. It costs a second scoring pass per decision (plans take about 1.8 times as long; the damage numbers are shared).
- **First Impression** shares Fake Out's effect (158, first turn only), but the engine's bonus (`IncreaseFakeOutViability`) and the flinch (`BS_158_FakeOut`: `jumpifmove MOVE_FIRSTIMPRESSION BS_STANDARD_HIT`) are Fake Out's alone. The port scored First Impression +4 and the simulator made it flinch every time.

The other switch checks, in the engine's order (`ShouldSwitch`): absorb the predicted move; **pass on a Wish** to a teammate under half HP that survives the predicted hit (unless the wisher is hurt and safe); **the perish count is up**; only bad moves left; **Natural Cure** (asleep, or a status at half HP or more) or **Regenerator** (half HP or less and about to be knocked out, unless it knocks out first): to a switch-in that resists everything, else the best one (half the time if the predicted hit would hurt it); Yawn; **asleep**, half the time (not with Shed Skin, Early Bird, Sleep Talk, Snore or Rest); heavy end-of-turn damage; about to be knocked out; **an attacking stat at -3 or lower** (was -2, by U-turn when it has a fast pivot); save the sweeper. Not ported: stopping a locked move, Wonder Guard and the semi-invulnerable "troll" switch. **Wish** (effect 179): -10 while one is coming; +8 for a cleric with a teammate under 65% (`ShouldUseWishAromatherapy`), else scored like a healing move. **Future Sight / Doom Desire**: -10 while one is on its way to that spot. **Perish Song**: -10 as the last Pokémon against two or more, or when the foe already has a count (or Soundproof); +3 (status) when the foe is trapped. **Healing Wish, Lunar Dance** (the Memento effect, 168): -10 with no one to come in or the team at full HP; Memento -5.

The live battle samples the boss's choice 24 times with real dice (`sampleBoss`). "Lokix: First Impression, or U-turn about 42% of the time (the engine flips a coin here)", the move buttons carry the shares, and the AI check counts a flagged coin flip apart from a miss.

The player's side of one-on-one matchups (`E.matchup`) is played with the attack that wins it: least risk of fainting, then fewest hits, then most damage. Before, it always took the hardest-hitting move, so a weaker priority move that wins (Aqua Jet against Lunatone) was ignored, and learning a stronger move could make a matchup look worse.

## Saving to the account database

The published Coach saves to the artifact's database (`data/users/<id>`: `run`, `mon-*`, `hist-*`). Two properties of it broke run 3 and the first "Start a new run": snapshot bodies are **frozen** (so a counter taken from one, like the AI check's, threw in strict mode on the next turn report, and the live battle stopped after turn 1), and **every write echoes back** as a snapshot (first with `hasPendingWrites`, then confirmed). The page used to rebuild its whole state from every snapshot, so a stale echo could put the old run back in the middle of starting a new one. Now the page keeps only plain copies (`plain()`), applies the first load in full, and after that ignores its own echoes (pending ones, and confirmed ones equal to any of its last 12 writes to that document, compared with `canon()`, so a late echo of an older save can't take the page back), applying only changes made elsewhere, one document at a time.

## The care package cheat (SO2Toxic)

Codes are typed at an event tile (a sign or PC event) upstairs in your house in Pallet Town (map 4.1). The code script at `0x1050086` compares the entry with each string (`special 0x12D`):

| Code | Script | Sets |
| --- | --- | --- |
| `Woyaopp` | `0x10500F3` | flag `0x1040`: the Rare Candy cheat ("Talk to the youngster in Viridian City") |
| `DexAll` | `0x105011F` | flag `0x1056`: DexNav |
| `SO2Toxic` | `0x105013F` | flag `0x103F`: the care package |
| `TeamPreview` | `0x10507FB` | team preview |
| `EZCatch` | `0x1050109` | flag `0x109D`: easy catching |

Every place that hands over a package does `checkflag 0x103F` and then `call_if TRUE` to a list of `giveitem`s. `SO2Toxic`'s own script hands over the packages for checkpoints already passed (by story variables and badge flags). Some items depend on the mode: `checkflag F; call_if FALSE` adds them only when F is not set. Choosing Hardcore Mode (`0x104F10C`) sets `0x1034` (Hardcore), `0x1032` (Minimal Grinding) and `0x10BE`, so Hardcore players don't get the weather rocks, terrain seeds, Weakness Policy, Throat Spray, Heat Rock, Air Balloon, Terrain Extender, or the EV wings and vitamins.

`tools/extract_care_package.py` finds every package, places it by walking every map's scripts, and writes `data/care_package.json` (Hardcore lists, plus what other modes add). Most packages come from one-time triggers you walk over (`var == 0`, then set): Route 2 (the DexNav aide), Viridian Forest, Pewter City, Route 3, Route 4, Route 24, Cerulean City, Route 6, Route 9, Route 10, Celadon City and Fuchsia City. Three come after gym wins (Thunder, Volcano and Earth Badges), and one from Mom in Pallet Town after you become Champion (Choice Band, Specs and Scarf, Rocky Helmet, Eviolite). A care package NPC near "the tunnel from Cerulean" (`0x1050D95`) isn't on any map in 4.1.

**When you can have them** (run 6: the Coach offered a Wacan Berry before the Nugget Bridge Rocket). A trigger that starts a battle hands its package over only after you win, since the script goes on past `trainerbattle` only after a win. So those packages record the trainer: the Rocket at the end of Nugget Bridge (Route 24, trainer 356, x10-11 y15, with the Nugget), and the Rocket behind the burgled house in Cerulean City (trainer 355, cap 36, with TM28), not the city on arrival. Fuchsia City's package comes in two parts. Its west entrance (x0 y39) hands over the berries and Heart Scale on arrival. The rest (Leftovers, Expert Belt, Lucky Punch, DeepSeaScale, PP Max) comes after Brendan's battle at the north of the city (trainer 57, cap 68, x24 y6). The extractor used to fold the first part into the second. Three more triggers sit behind a fight on the way there, read off the maps (`GATES`):

- Pewter City: Oak's aide waits at the east exit (x43 y21-23), one step past the gym guide's trigger (x42), which walks you back to the gym until you have the Boulder Badge.
- Route 4: the trigger is outside Mt. Moon's east exit (x31-33 y6-7). Inside, the last ladder up (B2F x6 y10) is in a pocket you only reach across Archer's trigger (B2F x4-5 y7, trainer 46).
- Route 10: the trigger is at the south end (y78), past Rock Tunnel and the one-tile gap beside Herman (x11 y73, trainer 163).

The app counts a package from the step after that fight (won, skipped or behind you), or after the badge.

## Starters

Professor Oak's Lab is map 4.3. Its three Poké Ball objects (scripts at `0x0904FA29`, `0x0904FA6D`, `0x0904FAB1`) set `0x5124` to the species (Bulbasaur, Squirtle, Charmander), `0x5125` to the ball (1-3) and `0x4001` to 0, 1, 2. The script at `0x0904FB42` checks the generation setting in `0x5123` (2-9; set by the scripts at `0x0904F664` onward) and swaps in that generation's grass, water and fire starter for each ball. `0x4001` becomes the rival's pick (`0x4031`): the aide's lines map 0 to Charmander, 1 to Bulbasaur and 2 to Squirtle, so the rival always counters your ball's type with a Kanto starter. The rival's Hardcore teams come in triples in that order (Squirtle line, Bulbasaur line, Charmander line).

**Ranking them** (`tools/starter_tiers.js`). One-on-one matchups at each fight's cap (best level-up moves, best of four natures, Hardcore bans out) say how a starter does against each boss Pokémon from full HP. The first fights (caps 16 and 23) are also played out whole with `SIM.runBattle`: the starter alone, the boss's whole team, the ported boss AI, 40 seeded battles each, no items; the share of their team it knocks out before it falls is the "played out" score (×3, to sit on the one-on-one scale). The two count half each in the first-fights score, which is 40% of the overall (25% the rest of the early game, caps up to 36; 35% the rest of the run). Run 4's question ("these early games seem brutal with fire starters") is what the played-out test answers: one-on-one, Charmeleon beats four of Hardcore Brock's six; played out, it knocks out 0.1 of them on average, because Hippopotas's sandstorm wears it down and the AI switches in Lunatone and Lileep, which wall it. No starter beats Hardcore Brock alone (a data test checks it).
