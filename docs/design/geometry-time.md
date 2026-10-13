# DESIGN §3, §4 — Coordinates, fields, geometry and time

Part of [DESIGN.md](../DESIGN.md) (the index; section numbers are global).

## 3. Coordinates, fields and geometry

- Every stage is a **19-row × 21-col** grid (`data/stages.json`). **Row 0 is the bottom** row, col 0 is the left. Tile `(r,c)` has world centre `(x=c, y=r)`; 1 tile = 1 world unit. Unit positions are floats in this space.
- Areas (research 05 §2.2):
  - **Normal field** (own board): rows 9–12, cols 2–10. Enemy gates `S` at (9,10) and (12,10) (R1–3 only the lower one); protection objective `E` at (9,2). Col 9 lane is not deployable (tile type decides).
  - **Hand (整备区)**: row 7, cols 0–9 (10 regular slots, index = col). **Temp slots**: row 8, cols 4–8 (5 slots). Hand/temp tiles are never part of a battle.
  - **Partner display** cols 11–18 of rows 9–12 (the unite field uses them).
  - **Boss field**: combat deployment rows 2–5; left half cols 2–10, right half cols 10–18. The mapped hand / temp rows are 0 / 1, inside the simulation rect but not deployment tiles (`Battle.onFieldBoard` excludes them): 维什戴尔's 魂灵之影 goes only on a board of the field — a teammate's half, never those rows or an empty half — and without a free one in range no shadow is summoned (§31.10).
  - Enemy preview pen rows 14–18 × cols 7–13 (row 16 empty): during prep the next round's enemies idle there (upper-gate enemies rows 17–18, lower-gate rows 14–15, ≤ 50 models, spawn-time order) — research 08 §4 / 09 §2.
- Tile semantics come from `data/stages.json` legend: height (LOW/HIGH), buildable (ALL/MELEE/RANGED/NONE — the **effective** deploy type: the 深水区 `tile_deepsea` refuses deployment, NONE with the level's `buildableType` ALL kept, PRTS 深水区 地形信息 "拒绝部署（待补充）"; an active 特制水上平台 makes its tile deployable in the prep deploy map only, §21.3), ground-passable, fly-only, special terrain (mire, smog, deepsea, infection). The fenced tiles (围墙 `tile_fence_bound` / 围栏 `tile_fence`, legend `b`: LOW, buildable ALL, passable to flyers only) take units, which attack normally from there but block no ground enemy (PRTS 地形机制, §21.23). Melee chess may stand only on LOW tiles with buildable ALL/MELEE — except a melee chess whose trait reads 「可以放置于远程位」 (the 钩索师 / 推击手 branch trait: 歌蕾蒂娅, 崖心, 见行者, normal and elite, with any module or none), which may use the ranged tiles too (`shared/highGround.js`; the owner's decision of 2026-10-05, following PRTS — it reverses the 2026-10-04 one that allowed only elite 歌蕾蒂娅 with HOK-Y; on a 高台 it attacks and blocks nothing); ranged chess on ALL/RANGED **and** on LOW ALL/MELEE tiles ("所有行动内远程干员可部署在近战位"). Tokens follow their own `position`; a summon marked `ownerRange` (狼群, 流形: "只能部署在召唤者攻击范围内"; Mon3tr's 重构体 by her talent) goes only on a tile of its owner's attack range — the loadout grid rotated by the owner's facing around its tile (`PlayerState.summonRange`, §21.3) —, one marked `ownerRangeOutside` / `rangedTilesOnly` (凯尔希·思衡托's 战术锚点: "仅可以部署在凯尔希·思衡托攻击范围外的远程位") only on a 高台 outside it (`summonExcluded`, placement class `high`; 0.2.0).
- **Facing (corrected, see research 09 §1.2):** like standard Arknights, every board piece has a direction `dir ∈ UP|RIGHT|DOWN|LEFT` chosen with the 4-direction deploy wheel after dropping it on a tile (also re-orientable in place); default `RIGHT`; persists across rounds. Range grid entries are `[dRow, dCol]` relative to facing RIGHT and are rotated: RIGHT `(dr,dc)`, UP `(dc,−dr)`, LEFT `(−dr,−dc)`, DOWN `(−dc,dr)` (row 0 = bottom); `rangeExtend` applies along +dCol before rotating — to a running skill's range too, unless that skill ignores 攻击距离 (`targeting.noRangeExtend`, 信仰搅拌机 S3, §21.16). The right-side Final Assault player is mirrored col `c→20−c` with RIGHT↔LEFT (UP/DOWN unchanged).
- **Range test:** an enemy is inside a grid range if the tile containing it (`round(y), round(x)`) is one of the range tiles; a huge enemy (data `hitArea`: 巨型单位, a 4.95 × 2.95 rectangle moved 1.0 up) if any tile its hit rectangle overlaps is one (PRTS 作战机制 "巨型BOSS单位的每一个占据的格子都可以让其本身通过格子判定"; `sim/body.js`, §19.4). Radius ranges (enemies, auras, AoE) use Euclidean distance in tiles — to a huge enemy's rectangle [ASSUMED] — except splash around a struck target, a 中点判定 on positions (PRTS 作战机制 "中点判定…案例：阻挡，酒神1天赋的1.3溅射半径"). A ranged enemy's normal attack takes an ally whose collider (radius 0.25, PRTS 作战机制 §碰撞体积 "我方干员碰撞体积基本均为以0.25格为半径的圆形") touches its range circle: centre distance ≤ `rangeRadius` + 0.25 (`constants.js ALLY_COLLIDER_RADIUS`, `ai.js enemyAttack`; §20.4).
- **Fields at runtime:** a `Battle` receives a **field rect** (rows/cols subset) and the full stage grid. Normal battles use rows 9–12 × cols 0–10; unite uses rows 9–12 × cols 0–20 of the round's stage, both halves with their terrain and devices (0.2.0's escaped-level map, GitHub #41, withdrawn in 0.2.1: the owner's decision of 2026-10-07); boss uses rows 0–5 × cols 0–20 (solo boss uses the left half only). Pathfinding never leaves the rect.
- **Speed:** `tilesPerSecond = moveSpeed × MOVE_SCALE` with `MOVE_SCALE = 0.5` (in `sim/constants.js`, tunable).

---

## 4. Time model

- Simulation time is **game seconds**. Fixed step `TICK = 1/30 s`.
- Timers count in ticks and take what is within 1e-9 as reached — attack cooldowns and enemy wind-ups (`ai.js
  attackCountdown`), time SP against its cost (`skills.js gainSp`), skill durations, buff intervals, `every()` /
  `after()`, enemy abilities, the 失衡 end —, so a whole number of ticks takes exactly that many: 1 s = 30 ticks (PRTS
  作战机制/sandbox 「帧对齐机制对攻速的影响」: one frame = 1/30 s). Floating point alone held 1 s attacks and 10-SP charges a
  tick longer until 0.2.2 (PR #402, §27.61). A non-integer count ends on the tick that crosses the line, ⌈30 × t⌉ (1.25 s
  = 38); the official game rounds it (四舍五入 since 2019-12-24: 能天使's 0.678 s is 20 frames there, 21 here) — an older
  difference, not changed.
- Combat runs at **2× real time** (forced, like the original): 60 ticks per real second — in the browser's runner (§14) or, for server-run fields, the server's accumulator (2 ticks every real 1/30 s, never more than 8 ticks per interval to avoid spirals).
- Combat time limits come from `data/config.json → modes[m].rounds[r].combatTimeLimit` (= the level's `maxPlayTime`; also `modes[m].combatTimeLimit[r]`) and are **real seconds of the forced-2× battle** (verified by the balance pass: spawn schedules exceed the limit when read as game seconds). The server passes `2 × value` game seconds to the Battle (`server/match/gamedata.js → combatTimeLimit`; `config.combatTimeScale`, default 2); the countdown players see equals the data value. When time runs out, living non-boss enemies count as leaked. 联防 uses the round's limit.
- Final Assault / Hidden Core have **no hard stop** and their clocks are real seconds too: the boss level's `levelMaxPlayTime` (120 real s) is only the HUD countdown (`m.public.deadline`; the battle goes on past it), and the overtime drain (`bossOvertimeAfter` 150 / `bossOvertimeDrainPerSec` 1 = official `bossTurnHpReduceTime`) takes 1 team LP per whole **real** second from 150 real s (= 300 game s on the 2× field clock; first point at 151 s — `gamedata.js bossOvertimeDue`). `m.public.overtimeAt` = the ms epoch when the drain starts; both are placed on the field clock.
- **Solo pause** (§14): while `m.public.paused` the running battle's field clock, the HUD `deadline` / `overtimeAt` and every server deadline of the battle stand still; on resume they move on by the paused time. Co-op battles never pause.
- Prep/draft timers are **real seconds**, stored as absolute server deadlines (`Date.now()`-based) and sent to clients as `deadline` (ms epoch) + `serverNow` for clock-offset correction.
- Snapshots to clients: every **3 ticks** (= 20 Hz real) per watched field.

---
