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

## Open questions

- Which abilities Hardcore or Restricted Mode restricts for the player
- Boss Pokémon byte `+24` and bits 1–2 of byte `+25`
- Natures of regular trainers' Pokémon without a spread (fixed personality; formula not decoded)
- Flags `0x38` and `0x53` (inferred from level consistency)
- Level-up learnsets (3-byte entries: u16 move, u8 level), needed for regular trainers that use default moves
- Type chart and battle-mechanic changes, needed for the damage calculator
