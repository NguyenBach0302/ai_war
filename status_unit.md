# Unit Status

Source of truth used here:
- `init_db.sql` for seeded unit stats
- `server/match/MatchService.js` for online/server simulation behavior
- `public/game.js` for local/client simulation behavior

## Architecture

- The server is the authoritative simulator for online matches.
- Coordinate model:
  - `x` / `ox` is the horizontal axis and represents the length of the road.
  - `y` / `oy` is the vertical axis and represents the width of the road.
- The server advances the war by evaluating all unit statuses every frame: HP, mana, cooldowns, buffs, position, target, behavior, damage, and death state.
- Each unit should be treated as occupying a `10 x 10` area in the simulation space.
- Units should not overlap or override each other's occupied area.
- Units are arranged widthwise across the road first, then expand lengthwise only after width slots are filled.
- The server decides movement, targeting, skill usage, attacks, damage resolution, and elimination results.
- The client does not decide authoritative combat results in online mode.
- The client receives trimmed `match-state` payloads from the server, reads the unit status list, and renders the battlefield, animations, projectiles, logs, and UI for the user.
- In short:
  - Server: simulate war from unit state.
  - Client: render war from server state.

## Current Unit Roster

| Unit | Role | Cost | HP | Mana | Move | Range | DMG | ATK SPD | Type | Core Special |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| Guard | Tanker | 80 | 200 | 100 | 1.5 | 25 | 15 | 0.8 | Physical | Protect/Statue form: gains survivability and extra HP |
| Assassin | Burst/Flank | 60 | 80 | 80 | 1.9 | 20 | 35 | 1.5 | Physical | Dash to farthest enemy, then gain crit/dodge/lifesteal buffs |
| Mage | Artillery | 75 | 70 | 120 | 1.2 | 140 | 60 | 1.0 | Magic | Fire burst/AoE true damage with mana refund on kill |
| Healer | Support | 50 | 90 | 120 | 1.1 | 120 | 5 | 1.0 | Physical | Prioritizes healing low-HP allies |
| Bowman | Debuffer | 45 | 100 | 40 | 1.2 | 160 | 12 | 1.7 | Physical | Focus buff for physical penetration |
| Gunman | DPS | 90 | 110 | 60 | 0.9 | 160 | 45 | 0.8 | Physical | Grenade AoE within 2x attack range |
| Iceman | Control Mage | 60 | 100 | 90 | 1.2 | 130 | 12 | 1.1 | Magic | Freeze nearest 3 enemies and deal true damage |
| ChilyGirl | Melee Bruiser | 70 | 85 | 100 | 1.15 | 25 | 10 | 2.5 | Physical | Immortal burst window, protection trigger, then 10x punch |
| Sniper | Elite DPS | 0 | 90 | 100 | 0.7 | 300 | 80 | 0.5 | Physical | Extreme range precision damage |

## Advanced Stats

| Unit | Crit | Armor | MRes | Phys Pen | Magic Pen | Dodge | Lifesteal |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Guard | 0.00 | 60 | 30 | 0.00 | 0.00 | 0.10 | 0.00 |
| Assassin | 0.25 | 10 | 10 | 0.00 | 0.00 | 0.30 | 0.00 |
| Mage | 0.00 | 10 | 10 | 0.00 | 0.10 | 0.10 | 0.00 |
| Healer | 0.00 | 10 | 10 | 0.00 | 0.00 | 0.10 | 0.00 |
| Bowman | 0.00 | 10 | 10 | 0.15 | 0.00 | 0.10 | 0.00 |
| Gunman | 0.05 | 15 | 10 | 0.05 | 0.00 | 0.10 | 0.00 |
| Iceman | 0.00 | 10 | 20 | 0.00 | 0.10 | 0.10 | 0.00 |
| ChilyGirl | 0.00 | 50 | 50 | 0.00 | 0.00 | 0.10 | 0.00 |
| Sniper | 0.20 | 10 | 10 | 0.30 | 0.00 | 0.10 | 0.00 |

## Runtime Notes

### Realtime unit state from server

Each unit inside `match-state.state.units[]` carries the minimum runtime state needed for online rendering and reconciliation.

| Field | Meaning |
| --- | --- |
| `x`, `y` | Current unit position on the battlefield |
| `state` | High-level runtime state such as `march`, `fight`, `idle`, `frozen` |
| `facing` | Direction the unit is facing: `left` or `right` |
| `animAction` | Current animation action selected by the server |
| `animStartedAt` | Frame where the current animation started |
| `radius` | Collision/render radius used by the client |
| `buffs[]` | Active temporary combat modifiers exposed to the client |
| `hp`, `maxHp`, `mana`, `maxMana` | Current health and mana state |
| `isPet` | Reserved flag, currently `false` in authoritative online state |
| `untargetableTimer` | Reserved timer, currently `0` in authoritative online state |
| `blockTimer` | Reserved timer, currently `0` in authoritative online state |

Fields intentionally removed from the online broadcast for performance:
- `position`
- `footprint`
- `stats`
- `target`
- `targetDistance`
- `lastDamageDealt`
- `lastDamageTaken`
- `behavior`
- `cooldown`
- `laneY`

Those fields may still exist in local/client simulation logic or be useful for debug tooling, but they are no longer sent in every online `match-state` packet.

### Spatial occupancy rule

| Rule | Meaning |
| --- | --- |
| Unit footprint | Every unit occupies a `10 x 10` area |
| No overlap | One unit cannot override another unit's occupied area |
| Horizontal axis | `x` is road length and is the direction units travel toward the enemy base |
| Vertical axis | `y` is road width and is used to distribute units across the lane |
| Formation arrangement | Units fill width slots along `y` first, then add new rows along `x` |
| Spacing formula | Distance between units uses Euclidean distance: `sqrt(dx^2 + dy^2)` |
| Server responsibility | The server enforces spacing/collision because it is authoritative |
| Client responsibility | The client should render positions received from the server and should not invent overlap resolution in online mode |

### Realtime damage event payload

Recent server events are included in `match-state.events[]`. Damage events contain:

| Field | Meaning |
| --- | --- |
| `type` | Event type, for damage this is `damage` |
| `frame` | Simulation frame where the hit happened |
| `attackerId`, `attackerType`, `attackerOwner` | Source unit identity |
| `targetId`, `targetType`, `targetOwner` | Target identity |
| `amount` | Final damage after crit, pen, armor/mres, and dodge resolution |
| `damageType` | `physical`, `magic`, or `true` |
| `dodged` | Whether the hit was avoided |
| `crit` | Whether the hit crit |
| `skill` | Skill label when damage came from a skill, otherwise `null` |
| `attackerX`, `attackerY` | Attacker position at hit time |
| `targetX`, `targetY` | Target position at hit time |

### Server-side skills actually implemented
- Guard: at 80 mana, heals for 35% max HP and can exceed current max up to `1.4x`.
- Assassin: at 80 mana, dashes to a far enemy and gains temporary dodge/lifesteal buffs.
- Mage: at 80 mana, launches AoE magic damage (`55`) in radius `70`.
- Healer: at 80 mana, heals an ally for `max(35, dmg * 8)`.
- Bowman: at 40 mana, gains temporary `+0.15 phys_pen`.
- Gunman/Gunner: at 60 mana, throws grenade for `1.8x dmg` AoE physical damage.
- Iceman: at 60 mana, freezes 3 nearest enemies and deals `20 true damage`.
- ChilyGirl: at 70 mana, throws a big chili for `3x dmg` true AoE damage.

### Client/local skills actually implemented
- Guard: statue mode for `480` frames with `+50% max HP`, `+50 armor`, `+50 mres`.
- Assassin: dash grants `+0.5 crit`, `+0.5 dodge`, `+0.5 lifesteal` for `180` frames.
- Mage: if fighting in close range, deals `60 true damage` AoE and refunds mana on kill.
- Healer: uses a healing projectile on low-HP allies when in range.
- Bowman: basic special is treated as a fast ranged DPS/pen unit; no unique heavy active beyond pen boost logic.
- Gunman/Gunner: grenade projectile with AoE explosion.
- Iceman: active freeze plus a passive freeze trigger when low HP.
- ChilyGirl: active grants `invulnerable + atk_speed x2 + bonus true damage`; low-HP passive triggers protection and then a forward punch for `10x dmg`.

## Other

- `ChilyGirl` was originally inserted as a magic artillery unit in `init_db.sql`, then immediately converted by `UPDATE` into the current melee bruiser version. The updated row is the real effective one.
- The database uses the name `Gunman`, while art/code also reference `Gunner`. Runtime code handles both spellings in several places.
- `Sniper` cost is seeded as `0`, which makes it effectively free if bought directly from unit data. The code also has a separate evolution path where `Gunman` can become `Sniper`.
- Client `applyUnitData()` assigns a generic `skillCost` of `30` to most units, but actual runtime mana thresholds vary by unit. Use the runtime values above when balancing behavior.
- `match-state.events[]` includes gameplay events plus visual events, so consumers should filter by `event.type` instead of assuming the list is visual-only.
- Current implementation note: the authoritative server enforces a `10 x 10` occupied-area spacing rule, preserves widthwise lane offsets within the road, and resolves spacing with Euclidean distance. The client may still use a larger visual sprite size than the simulation footprint.
- Match logic has been extracted from `server/index.js` into `server/match/MatchService.js`.
- Online performance work already applied:
  - match-state broadcast rate reduced from every `2` frames to every `4` frames
  - match event history and visual event history are capped instead of growing unbounded
  - the client caches the static map background instead of redrawing the full terrain every frame
  - a lightweight `/api/match/ping` endpoint exists for gameplay connection latency display
