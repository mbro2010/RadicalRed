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
| Battle-simulator Normal boss records | `0x1126340` | 60 | 108 |
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

For the opponent's side, checked in this order:

1. Flag `0x1042` → special handling for trainers 6 and 7
2. Flag `0x104B` → special handling for trainers 5 and 14
3. Flag `0x1065` (battle simulator, Normal) → simulator table `0x1126340`
4. Flag `0x1034` (**Hardcore**) and not `0x1065` → Hardcore table `0x112C9B4` when the trainer is listed
5. Flag `0x1066` (battle simulator, Hardcore) → Hardcore table
6. The table used in every mode, `0x11259DC`
7. Otherwise the vanilla trainer table

Record-based teams are built by `0x09078F9C`, one Pokémon at a time by `0x09078C48`. Personality, nature, ability and shininess are generated in `0x09077088`. EVs from records and spreads are skipped when Minimal Grinding (`0x1032`) or Easy (`0x1033`) is set.

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

Nothing is locked: an area can be logged from any step, a fight can be taken out of order, and areas you move past stay open.

## Battle replays

In recorded battles (the plan's most likely line and live battles) every event carries who it's about and a snapshot of the field right after it: each active Pokémon's species, name, level, HP and status, and which of each side's Pokémon can still fight (`sim.js`, `log` and `snapshot`). The battle screen (`app/stage.js`) animates those events and then draws the snapshot, so what you watch always matches what the simulator computed: Mega Evolution swaps the sprite, damage pops show the HP each hit took, and faints, status, stat changes and healing each get their own effect.

## Open questions

- Which abilities Hardcore or Restricted Mode restricts for the player
- Boss Pokémon byte `+24` and bits 1–2 of byte `+25`
- Natures of regular trainers' Pokémon without a spread (fixed personality; formula not decoded)
- Flags `0x38` and `0x53` (inferred from level consistency)
- Level-up learnsets (3-byte entries: u16 move, u8 level), needed for regular trainers that use default moves
- Type chart and battle-mechanic changes, needed for the damage calculator

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

The player's side of one-on-one matchups (`E.matchup`) is played with the attack that wins it: least risk of fainting, then fewest hits, then most damage. Before, it always took the hardest-hitting move, so a weaker priority move that wins (Aqua Jet against Lunatone) was ignored, and learning a stronger move could make a matchup look worse.

## Starters

Professor Oak's Lab is map 4.3. Its three Poké Ball objects (scripts at `0x0904FA29`, `0x0904FA6D`, `0x0904FAB1`) set `0x5124` to the species (Bulbasaur, Squirtle, Charmander), `0x5125` to the ball (1-3) and `0x4001` to 0, 1, 2. The script at `0x0904FB42` checks the generation setting in `0x5123` (2-9; set by the scripts at `0x0904F664` onward) and swaps in that generation's grass, water and fire starter for each ball. `0x4001` becomes the rival's pick (`0x4031`): the aide's lines map 0 to Charmander, 1 to Bulbasaur and 2 to Squirtle, so the rival always counters your ball's type with a Kanto starter. The rival's Hardcore teams come in triples in that order (Squirtle line, Bulbasaur line, Charmander line).
