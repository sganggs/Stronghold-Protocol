# 08 · Official waves, enemy counts, routes and preview (卫戍协议：盟约 下半)

Written 2026-09-28 in response to the user's test report. The user asked for enemy kinds, counts, routes and numbers to follow the official game (items 1, 2, 3, 4 and 9).

**This file supersedes** 05-enemies-levels.md §3.2 steps 1–7 (the generation algorithm and the `k` copies) and 00-INDEX §8 #12. It also supersedes every `[ASSUMED]` pathing statement in 05 §1 and §2.

## Tags

- **[DATA]**: official game data or official client code.
  - Game data: Kengxxiao zh_CN `activity_table`, `levels/*`, `enemy_database`.
  - Client code means the user's local Windows client. The method names come from `global-metadata.dat` (IL2CPP v29, not encrypted). The method bodies come from disassembling `GameAssembly.dll`. The IL2CPP method RVAs are listed in Appendix B.
- **[WIKI]**: PRTS or BWIKI text.
- **[VIDEO]**: in-game screenshots. These are the PRTS `战场一览` map images, taken at round-1 prep.
- **[ASSUMED]**: not proven.

---

## 0. TL;DR

1. **Our enemy counts are 2–4× too high, and our faction mixing is wrong.**
   - Official rule [DATA, client `RandomEnemyGenerater`]: each round uses exactly **one** special-enemy entry.
   - Every placeholder spawn **action** (not every enemy) is replaced by `clamp(roundHalfEven(n·BE_template / BE_new), 1, 5)` enemies in total.
   - The placeholders of the other movement class (fly placeholders in a ground round, walk placeholders in a FLY round) are **not spawned at all**.
   - Official multi 险境 R3 has **6–10 enemies** (average 7.7). Ours averages 28 (max 68). R13 is ≈ 37 officially vs ours ≈ 81 (max 115).
2. **Factions per match.** 3 random types. Each is given **exactly 3 of the 15 round slots**; SPECIAL gets the other 6. The slot order is shuffled, so there is one type per round [DATA].
3. **Lanes.** Official pathing is a **4-directional** SPFA flow field (unit cost, crate tiles 1000), followed by line-of-sight smoothing [DATA]. We use 8-directional A* with √2 diagonals.
   - That is why upper-gate enemies drop into the lower lane on 战场#02 (act1 m02) and 战场#04 (act1 m04).
   - Our data also turns on four act1 m02 crates that are hidden in the 下半 level and absent in the 下半 screenshot. Those crates block the top road.
4. **Preview.** Each spawn action is previewed at its route's start gate + 6 rows [DATA]:
   - Upper gate (12,10) → zone rows 17–18.
   - Lower gate (9,10) → zone rows 14–15.
   - Up to 50 models are shown. Elites and bosses are always shown.
5. **Custom balance to remove:**
   - All of `data/tuning.json` `enemyHpMul` / `enemyAtkMul` / `bossHpMul`.
   - The `k`-copies logic and the kept fly placeholders.
   - The extra ×0.7 on solo bounties.
   - The custom 联防 slot grouping.
   - The details are in §6 and §7.

---

## 1. Sources and method

- **Game data [DATA]:**
  - `autoChessData.constData`: `min/maxReplacedEnemyCount` 1/5, `templateEnemy*`, `maxLevelCnt` 15, `specialEnemyNum` 3, `enemyTypeIdentifierToFillRandom` 1, and the BE factors 1/5/3/3.
  - `act2autochess.specialEnemyInfoDict` (67 entries) and `specialEnemyRandomTypeDict` (count 3 / weight 3 per random type; SPECIAL −1).
  - `modeDataDict[*].inactiveEnemyKey`, the round templates `level_act1autochess_01…h06` and `h07_*`/`h08_*`/`escaped_*`, the stage files `level_act{1,2}autochess_m0X`, and `enemy_database`.
- **Client code [DATA].** Class and field names come from `global-metadata.dat`. The x64 bodies were disassembled with capstone and annotated with IL2CPP method names.
  - `RandomEnemyGenerater` (sic): `_GenerateSpecialEnemyTypesLocal`, `_GenerateRandomEnemyData`, `_DoReplaceLevelDataClient`, `_DoReplaceActionDataClient`, `_CalculateActionBattleEffectiveness`, `_CalculateEnemyCountByBattleEffectiveness`, `_GetEnemyAttrPower`, `_InitData`, `ShouldActionUpToServer`, `_GenerateRoundEnemyData`.
  - `Torappu.Battle.SPFA`: `_GenerateNextMapImpl`, `_PostprocessAndMakeNextMapSmoothly`, `_RaycastSegmentLine`, `_RaycastBresenhamLine`.
  - Also `Torappu.Battle.Tile.get_moveCost`, the `GridPosition` static constructor, `AutoChessEnemyPreviewManager`, and `AutoChessLevelEnemyManager`.
- **Wiki [WIKI]:** PRTS `卫戍协议：盟约 下半` (§开始模拟, the enemy multiplier table), `卫戍协议/帮助`, `卫戍协议：盟约` (上半 update log), `…下半/战场一览` and `…下半/PRTS盟约记录`, and BWIKI `盟约`.
- **Screenshots [VIDEO]:** PRTS `卫戍协议盟约 战场01…08 (ver2) 地图.png`. These are round-1 prep screenshots, and they show the round-1 enemies in the preview pen (§2.6).
- **No community per-round enemy tables exist.** PRTS and BWIKI list only the faction pools (`战术特训敌人`).
- **Scratch scripts** (not project files) are in `…/scratchpad/research2/waves/`:
  - `comp.py` / `official_counts.py`: the count algorithm.
  - `simofficial.py`: the distribution.
  - `akpath.py` / `akpath2.py`: the official pathing.
  - `pathtest.mjs` / `ourcounts.mjs`: our current behaviour.
  - `akdis.py`: the disassembler.

---

## 2. Official per-round enemy composition

### 2.1 Match setup: the type schedule [DATA, `_GenerateSpecialEnemyTypesLocal`]

```
types  = [t for t in autoChessData.enemyTypeDatas if t.involveRandom]   // FLY TIMES ELEMENT DOT INVISIBLE REFLECTION
shuffle(types, battleRng); types = first specialEnemyNum (3) of them    // uniform, distinct
slots  = []
for t in types: repeat specialEnemyRandomTypeDict[t].count (3) times: slots.push(t.typeIdentifier)
while slots.length < maxLevelCnt (15): slots.push(enemyTypeIdentifierToFillRandom = 1 = SPECIAL)
shuffle(slots, battleRng)                                               // slots[r-1] = type of round r
```

- Every match therefore has **9 rounds** of its 3 chosen types (3 each) and **6 rounds of SPECIAL**. The positions are random across R1–R15.
  - R14 (leader) and R15 (hidden core) consume slots 14 and 15.
  - The solo 标准 leader round R9 consumes slot 9.
- The briefing shows "三种特训敌人的类型" [WIKI 帮助: "您将事先得知本次战斗即将迎战的领袖单位，三种特训敌人的类型"]. SPECIAL is the filler and is not one of the three.
- In co-op the server sends the per-round types (`AutoChessBattleRoundEnemyInfo{enemyType, enemyKey, actionIndex, count, round}`). The local generator is used when none are sent. The whole team shares one composition per round, because the round data has no player index [DATA].

### 2.2 Per-round pick [DATA, `_GenerateRandomEnemyData`]

```
for round r in 1..15:
  typeId = slots[r-1]; if typeId == 0: skip
  half   = r <= maxLevelCnt/2 (=7)        // R1–R7 first half, R8–R15 second half
  cands  = [e in specialEnemyInfoDict if typeOf(e.type).typeIdentifier == typeId
                                        and e.isInFirstHalf == half
                                        and e.specialEnemyKey ∉ mode.inactiveEnemyKey]
  e      = weightedPick(cands, e.randomWeight)          // weights 8/10/15 as in data
  special[r] = e.specialEnemyKey
  normal[r]  = e.attachedNormalEnemyKeys[randInt(len)]  // always 1 element in 下半 data
  elite[r]   = e.attachedEliteEnemyKeys[randInt(len)]   // always 1 element
```

- `inactiveEnemyKey` filters **only the special key**. Attached normal and elite keys are not filtered. For example, 疯狂的逐腐兽 can still appear as the elite of 假想敌：蚀裂 in 险境. This matches the 上半 note [WIKI]: "以上调整仅针对战术特训敌人，不影响悬赏决策出场".
- In every entry the special, normal and elite share the same fly flag [DATA check]: FLY entries are all flyers, every other entry is all walkers.

### 2.3 Template action → actual spawns [DATA, `_DoReplaceLevelDataClient` / `_DoReplaceActionDataClient`]

The placeholder map is built from constData in `_InitData`:

| template key | class |
|---|---|
| `enemy_1422_lrsldr` | NormalWalk |
| `enemy_1005_yokai` | NormalFly |
| `enemy_1427_lrnazg` | EliteWalk |
| `enemy_1042_frostd` | EliteFly |
| `enemy_1425_lrcmra` | SpecialWalk |
| `enemy_1040_bombd` | SpecialFly |

Token placeholders (`1000_gopro_2`, `1041_lazerd`) are **not** in the map. They are only used by the 联防 templates (§5).

For every SPAWN action of `waves[0].fragments[0].actions` (processed last to first):

```
if action.key not in placeholderMap:            // literal (e.g. R1 源石虫 ×2, boss escorts): keep as is
    keep
else:
    cls, isFlySlot = placeholderMap[action.key]
    newKey = {Normal: normal[r], Elite: elite[r], Special: special[r]}[cls]
    if isFly(newKey) != isFlySlot:               // walk slot but FLY round, or fly slot but ground round
        action.isValid = false                   // NOT spawned, NOT sent to server, NOT previewed
    else:
        originBE = action.count * P(action.key) / f(action.key)          // float32
        newBE    = P(newKey) / f(newKey)
        n'       = clamp(RoundHalfToEven(originBE / newBE), minReplacedEnemyCount 1, maxReplacedEnemyCount 5)
        action.interval = action.count * action.interval / n'          // same time window
        action.key = newKey; action.count = n'
P(k) = maxHp*1 + atk*5 + def*3 + magicResistance*3     // enemy_database, level = randomEnemyAttributeDict[k].level (all 0)
f(k) = randomEnemyAttributeDict[k].enemyBattleEffectivenessFactor
```

Notes on the count rule:

- The **cap of 5 applies per action.** One template action (for example R3 "N ×10") becomes at most 5 enemies. It never becomes 10·k.
- **Rounding** is C# `Math.Round(double)`, which is banker's rounding. The only exact .5 case in the data is 2 × 灵幛 → 隐形弩手组长: ratio 4.5 gives **4**.
- P uses `enemy_database` values. The `level_autochess_enemy_data` overrides (灼藤 and 元核孽生者 ATK 400) are **not** used for the count. They still apply to the spawned stats.
- Spawn timing [DATA, `AutoChessLevelEnemyManager._CalculateActionPredelay`]: the i-th unit of an action spawns at `preDelay + i·step`.
  - `step = max(window/n', 0.05·window)`, where `window = originalCount·originalInterval`. `MIN_ACTION_INTERVAL_RATIO` = 0.05.
  - For n' ≤ 20 this equals the rescaled interval.
- `ShouldActionUpToServer` [DATA] excludes:
  - invalid actions,
  - boss enemies (`AutoChessBattleUtil.IsBossEnemy`),
  - non-SPAWN actions,
  - actions with a `randomSpawnGroupKey`.

**Kinds per round:** at most 3 faction kinds (normal, elite, special), plus the literal 源石虫 in R1. They are all flyers (FLY round) or all walkers (every other type).

### 2.4 Leader and hidden rounds [DATA]

- The `h07_*` / `h08_*` templates contain only **E and EF** placeholders (escorts), for example h07_01: `lrnazg` 1+1 walk and `frostd` 1+2 fly. They are replaced with slot 14 / 15's elite by the same rule.
  - Ground round: E becomes the elite and **EF is dropped**.
  - FLY round: the reverse.
- Literal escorts (重装防御组长 ×14 and the like) and the boss itself are kept.
- The leader's HP is not scaled [WIKI: "领袖单位于服务器的生命值加成不受上述加成影响"].

### 2.5 Enemy stat scaling

- The per-mode, per-round `atk × 1.1^kA`, `hp × 1.2^kH` table with base 0.7 / 0.8 / 1 is the **only** source [WIKI, PRTS 下半 §开始模拟, flagged "敌方属性加成情况由用户提供"].
  - `data/config.json → modes[*].enemyScale` reproduces it. I spot-checked 险境 multi R1/R2/R4/R8/R9; docs/BALANCE.md §2 reports every mode and round as matching.
  - The same table is in 01-core-data.json `_criticAddendum.enemyStatMultipliers`.
- Base values [WIKI, mode descriptions]:
  - Solo: "所有敌人的生命值、攻击力降低至70%". 绝境 80 %; 终极 not reduced.
  - Co-op: 80 % in 标准 and 险境; 绝境 and 终极 not reduced.
  - **DEF:** the 上半 11/18 note said "敌人生命值、攻击力和防御力降至70%/80%". The 下半 text names only HP and ATK. We apply HP/ATK only, which matches 下半. Adding DEF would be optional [ASSUMED].
- 终极: every enemy moves at ×1.15 from R3 [WIKI].
- The scaling applies to wave, faction and bounty enemies. It does **not** apply to the leader's server HP pool [WIKI].
- The BE count rule (§2.3) uses **unscaled** DB stats [DATA]. Scaling happens at spawn.

### 2.6 Evidence from official screenshots [VIDEO]

The PRTS map images are R1 prep screenshots, 1 280 × 720, with the preview pen at the top right (rows 14–15). They match §2.3 exactly and **contradict our k-copies rule**.

| image | visible R1 enemies | official prediction (entry → R1) | ours would give |
|---|---|---|---|
| 战场02 ver2 (act1 m02) | 源石虫 ×2, 猎狗pro ×4, **no drones** | SPECIAL 高级军用猎狗 → 源石虫 ×2 + 猎狗pro ×4 (N 2 × 6620/3060 = 4.33 → 4) | 源石虫 ×2 + 猎狗pro ×4 + 妖怪 ×2 |
| 战场07 ver2 (act2 m03) | 源石虫 ×2, 猎狗pro ×4 | same | same as above |
| 战场04 (act1 m04) | 源石虫 ×2, 灼热源石虫 ×5 | ELEMENT 炽焰源石虫 → 源石虫 ×2 + 灼热源石虫 ×5 (2 × 6620/1450 = 9.1 → cap 5) | 源石虫 ×2 + 灼热源石虫 ×10 + 妖怪 ×2 |
| 战场02 (上半) / 06 ver2 | 源石虫 ×2 + 3 humanoid walkers (上半: white Sarkaz swordsmen) | e.g. SPECIAL 萨卡兹大剑组长 → 萨卡兹刀兵 ×3 (2 × 6620/4660 = 2.84 → 3); 粉碎攻坚手 / 山海众头目 → 宿主士兵 ×3 also fit | +妖怪 ×2 |
| 战场01 | 源石虫 ×2 + drone(s), **no ground N** | a FLY round (walk N dropped, NF replaced) | ground N ×2 + flyers |
| 战场03 / 05 ver2 / 08 | 源石虫 ×2 + 2 walkers, no drones | e.g. TIMES/DOT/INVISIBLE picks with N ×2 | +妖怪 ×2 |

Every screenshot shows only one movement class besides the 源石虫. This confirms that the placeholders of the other class are dropped.

### 2.7 Resulting counts

**Distribution: official vs ours**, 同盟 险境 (`mode_multi_normal`), enemies per board per round.

- Official: 4 000 simulated matches of §2.1–2.3.
- Ours: `server/match/waves.js` over 200 seeds.

| R | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| official avg | 4.7 | 7.7 | 7.7 | 10.3 | 20.0 | 23.2 | 26.2 | 18.2 | 20.3 | 22.2 | 23.6 | 35.0 | 37.5 |
| official min–max | 3–7 | 4–10 | 6–10 | 7–20 | 13–30 | 14–30 | 17–35 | 8–29 | 8–33 | 8–35 | 10–35 | 14–53 | 12–57 |
| ours avg | 7.1 | 17.6 | 28.3 | 24.5 | 42.8 | 50.5 | 58.5 | 39.8 | 42.1 | 47.1 | 51.4 | 80.1 | 81.0 |
| ours max | 14 | 39 | **68** | 48 | 93 | 113 | 134 | 54 | 60 | 65 | 69 | 107 | 115 |

- 绝境 and 终极 differ only by the unbanned keys: R12 ≈ 36.8, R13 ≈ 38.7 on average.
- A FLY round happens in ≈ 10 % of rounds (3 of 15 slots in the half of the matches that draw FLY).

**Totals per possible round pick** [DATA, computed with §2.3 on the real templates] follow. Per-action breakdowns for all 67 entries are regenerable with `comp.py`, and §7 step 1 describes the test fixtures.

**First half (R1–R7).** Total enemies spawned per board when this entry is the round pick. ⛔ = special key banned in 标准/险境.

| type | special (key) | w | attached N / E | R1 | R2 | R3 | R4 | R5 | R6 | R7 |
|---|---|---|---|---|---|---|---|---|---|---|
| SPECIAL | 萨卡兹大剑组长 (`1010_demon_2`) | 10 | 萨卡兹刀兵 / 萨卡兹大剑手 | 5 | 8 | 7 | 9 | 19 | 23 | 27 |
| SPECIAL | 粉碎攻坚手 (`1045_hammer`) | 10 | 宿主士兵 / 步兵 | 5 | 10 | 10 | 12 | 24 | 27 | 28 |
| SPECIAL | 拳师囚犯 (`1118_lidbox_2`) | 10 | 普通囚犯 / 老练囚犯 | 4 | 6 | 7 | 8 | 17 | 21 | 25 |
| SPECIAL | 高级军用猎狗 (`1325_cbgpro_2`) | 10 | 猎狗pro / 军用猎狗 | 6 | 10 | 8 | 14 | 27 | 30 | 33 |
| SPECIAL | 重犯 (`1121_lifbos`) | 10 | 普通囚犯 / 老练囚犯 | 4 | 6 | 7 | 7 | 16 | 19 | 22 |
| SPECIAL | 弧光锋卫 (`1328_cbjedi`) | 10 | Dor-1号失败品 / 莱茵生命防卫科高级成员 | 5 | 8 | 7 | 9 | 21 | 24 | 26 |
| FLY | 法术大师A1 (`1041_lazerd`) | 10 | “萨科塔之翼” / 妖怪MKII | 3 | 7 | 9 | 14 | 18 | 22 | 23 |
| FLY | 护障 (`1355_mrfly`) | 10 | 妖怪 / 妖怪MKII | 4 | 9 | 9 | 14 | 19 | 23 | 23 |
| FLY | 御4 (`1017_defdrn`) | 10 | 妖怪 / 妖怪MKII | 4 | 9 | 9 | 16 | 21 | 26 | 25 |
| FLY | “萨科塔之眼” (`10084_hlegle`) | 10 | “萨科塔之翼” / 妖怪MKII | 3 | 7 | 9 | 11 | 15 | 19 | 21 |
| FLY | 远眺 (`1407_hummbd`) | 10 | 妖怪 / 妖怪MKII | 4 | 9 | 9 | 15 | 20 | 24 | 23 |
| FLY | 护障·P ⛔ (`1355_mrfly_2`) | 8 | 妖怪 / 御4 | 4 | 9 | 9 | 14 | 19 | 22 | 23 |
| TIMES | 明鉴 (`1195_sfyin_2`) | 10 | 磨砻 / 俗心 | 4 | 6 | 6 | 7 | 16 | 20 | 24 |
| TIMES | 深池逐火精锐战士 (`1288_duskls_2`) | 10 | 深池逐火战士 / 深池逐火战士 | 4 | 4 | 7 | 9 | 16 | 19 | 23 |
| TIMES | 俗心 (`1197_sfshu`) | 10 | 磨砻 / 俗心 | 4 | 6 | 6 | 7 | 16 | 19 | 23 |
| TIMES | 雅气 ⛔ (`1197_sfshu_2`) | 8 | 磨砻 / 雅气 | 4 | 6 | 6 | 6 | 14 | 17 | 21 |
| ELEMENT | 控潮术师 (`1161_tidmag`) | 10 | 潜水员 / 码头水手 | 5 | 8 | 6 | 8 | 18 | 21 | 25 |
| ELEMENT | 炽焰源石虫 (`1305_mhslim_2`) | 10 | 灼热源石虫 / 炽焰源石虫 | 7 | 10 | 10 | 20 | 30 | 30 | 35 |
| DOT | 深溟巢涌者 (`1234_dsubrl`) | 10 | 单核掠食者 / 异光体掠食者 | 4 | 4 | 7 | 7 | 13 | 14 | 17 |
| DOT | 萨卡兹枯朽战车 (`1272_nhtank`) | 10 | 萨卡兹枯朽战士 / 萨卡兹枯朽战士组长 | 4 | 6 | 8 | 8 | 17 | 19 | 21 |
| DOT | 逐腐兽 (`1270_nhstlk`) | 10 | 萨卡兹枯朽战士 / 萨卡兹枯朽战士组长 | 4 | 6 | 8 | 9 | 18 | 21 | 24 |
| INVISIBLE | 山海众头目 (`1299_ymkilr`) | 10 | 宿主士兵 / 隐形弩手 | 5 | 10 | 8 | 10 | 24 | 27 | 28 |
| INVISIBLE | 节日爵士乐手 (`10034_cnvsax`) | 10 | 宿主士兵 / 隐形弩手 | 5 | 10 | 8 | 11 | 25 | 28 | 30 |
| INVISIBLE | 扶桥老手 (`10042_prtrop_2`) | 10 | 寻险水手 / 架桥船工 | 4 | 6 | 7 | 8 | 17 | 21 | 25 |
| REFLECTION | 深池伙友卫队 (`1174_duholy`) | 10 | 深池侦察兵 / 深池重甲卫士 | 5 | 8 | 6 | 8 | 19 | 22 | 26 |
| REFLECTION | 深池暗影术师 (`1168_dumage`) | 10 | 深池侦察犬 / 深池方阵步兵 | 5 | 8 | 8 | 13 | 24 | 27 | 32 |
| REFLECTION | 深池重甲卫士 (`1170_dushld`) | 10 | 深池侦察兵 / 深池方阵步兵 | 5 | 8 | 8 | 11 | 22 | 26 | 29 |

**Second half (R8–R13).** Same columns.

| type | special (key) | w | attached N / E | R8 | R9 | R10 | R11 | R12 | R13 |
|---|---|---|---|---|---|---|---|---|---|
| SPECIAL | 重装五十夫长 (`1006_shield_3`) | 10 | 宿主士兵 / 重装侦察兵 | 24 | 30 | 30 | 28 | 39 | 41 |
| SPECIAL | 弧光镜卫 (`1329_cbshld`) | 10 | Dor-1号失败品 / 莱茵生命防卫科高级成员 | 26 | 29 | 31 | 33 | 51 | 50 |
| SPECIAL | 粉碎攻坚组长 (`1045_hammer_2`) | 10 | 宿主重装士兵 / 宿主重装士兵 | 9 | 10 | 13 | 15 | 20 | 26 |
| SPECIAL | 访问团持盾者 (`1387_winshd`) | 10 | 访问团新兵 / 访问团老兵 | 15 | 16 | 18 | 19 | 32 | 38 |
| SPECIAL | 传奇重犯 (`1121_lifbos_2`) | 10 | 老练囚犯 / 强壮囚犯 | 14 | 16 | 18 | 18 | 30 | 35 |
| SPECIAL | 萨卡兹悖谬暴虐兵长 (`1320_wdrrl_2`) | 10 | 萨卡兹枯朽辟路前锋 / 萨卡兹大剑手 | 18 | 22 | 23 | 24 | 33 | 37 |
| SPECIAL | 集团军中坚盾卫 (`10124_uashld_2`) | 10 | 宿主士兵 / 宿主重装士兵 | 23 | 30 | 30 | 29 | 38 | 43 |
| SPECIAL | 测试用动力装甲 ⛔ (`1254_lypa_2`) | 10 | Dor-1号失败品 / 莱茵生命防卫科高级成员 | 29 | 31 | 34 | 36 | 57 | 55 |
| SPECIAL | 渎罪奇美拉 ⛔ (`1425_lrcmra_2`) | 10 | 萨卡兹枯朽辟路前锋 / 萨卡兹大剑手 | 19 | 22 | 24 | 26 | 37 | 41 |
| SPECIAL | 弧光镜卫长 ⛔ (`1329_cbshld_2`) | 10 | Dor-α号失败品 / Dor-β号复制体 | 23 | 27 | 30 | 28 | 42 | 48 |
| SPECIAL | 萨卡兹穿刺手 ⛔ (`1072_dlancer`) | 10 | 萨卡兹刀兵 / 萨卡兹大剑组长 | 26 | 29 | 32 | 36 | 50 | 49 |
| FLY | 威龙 (`1005_yokai_3`) | 10 | 妖怪 / 妖怪MKII | 19 | 19 | 20 | 25 | 39 | 31 |
| FLY | 帝国炮火先兆者 ⛔ (`1112_emppnt`) | 10 | 妖怪 / 妖怪MKII | 19 | 19 | 20 | 25 | 39 | 31 |
| FLY | 法术大师A2 (`1041_lazerd_2`) | 10 | 妖怪MKII / 寒霜 | 12 | 12 | 12 | 15 | 24 | 22 |
| FLY | 假想敌：黑云 (`9009_acfort`) | 10 | 妖怪MKII / 威龙 | 8 | 8 | 8 | 10 | 14 | 12 |
| TIMES | 深池逐火护卫 (`1292_duskld`) | 10 | 深池逐火战士 / 深池逐火精锐战士 | 19 | 18 | 23 | 28 | 43 | 45 |
| TIMES | 沉沙 ⛔ (`1207_sfji`) | 10 | 磨砻 / 俗心 | 17 | 21 | 21 | 21 | 32 | 33 |
| TIMES | 身观 (`1199_sfjin`) | 10 | 磨砻 / 俗心 | 17 | 21 | 21 | 22 | 32 | 35 |
| TIMES | 假想敌：再生 (`9010_acpupp`) | 10 | 俗心 / 雅气 | 11 | 10 | 14 | 17 | 25 | 31 |
| ELEMENT | 掠海漂移体 (`2025_syufo`) | 10 | 骨海漂流体 / 骨海漂流体 | 24 | 26 | 29 | 30 | 45 | 48 |
| ELEMENT | 领潮员 (`1161_tidmag_2`) | 10 | 潜水员 / 码头水手长 | 20 | 24 | 26 | 28 | 34 | 35 |
| ELEMENT | 元核孽生者 (`1439_dslntf`) | 10 | 底海滑动者 / 富营养的滑动者 | 26 | 31 | 31 | 31 | 45 | 41 |
| ELEMENT | 萨卡兹王庭军精锐术师 ⛔ (`1275_dwlock_2`) | 10 | 萨卡兹王庭军战士 / 萨卡兹王庭军精锐战士 | 16 | 18 | 20 | 18 | 32 | 35 |
| ELEMENT | 假想敌：淤困 (`9007_acelem`) | 10 | 萨卡兹王庭军战士 / 萨卡兹王庭军精锐战士 | 15 | 18 | 19 | 17 | 30 | 32 |
| ELEMENT | 灼藤 ⛔ (`10067_ftsjc`) | 8 | 卷心籽 / 灼藤 | 20 | 24 | 25 | 25 | 31 | 29 |
| DOT | 富营养的巢涌者 ⛔ (`1234_dsubrl_2`) | 10 | 异光体掠食者 / 异光体掠食者 | 15 | 18 | 18 | 17 | 30 | 32 |
| DOT | 集团军重型火炮 ⛔ (`10122_uacann_2`) | 10 | 萨卡兹枯朽战士组长 / 萨卡兹枯朽战士组长 | 20 | 20 | 23 | 27 | 42 | 42 |
| DOT | 尖端萨卡兹枯朽战车 ⛔ (`1272_nhtank_2`) | 10 | 萨卡兹枯朽战士组长 / 疯狂的逐腐兽 | 13 | 15 | 17 | 20 | 25 | 27 |
| DOT | 假想敌：蚀裂 (`9006_actoxi`) | 15 | 萨卡兹枯朽战士组长 / 疯狂的逐腐兽 | 15 | 15 | 19 | 23 | 31 | 34 |
| DOT | 疯狂的逐腐兽 ⛔ (`1270_nhstlk_2`) | 8 | 萨卡兹枯朽战士 / 萨卡兹枯朽战士组长 | 24 | 25 | 28 | 29 | 47 | 49 |
| INVISIBLE | 访问团强攻冠军 (`1389_winbab_2`) | 10 | 访问团新兵 / 隐形弩手组长 | 18 | 18 | 21 | 22 | 38 | 44 |
| INVISIBLE | 山海众秘使 (`1299_ymkilr_2`) | 10 | 萨卡兹枯朽辟路前锋 / 隐形弩手组长 | 20 | 23 | 24 | 25 | 38 | 41 |
| INVISIBLE | 重弩突袭者 (`1404_msnip`) | 10 | 潜伏者 / 隐形弩手组长 | 29 | 33 | 35 | 35 | 53 | 57 |
| INVISIBLE | 假想敌：骨刺 ⛔ (`9008_acbunn`) | 10 | 业余竞演者 / 隐形弩手组长 | 20 | 23 | 25 | 24 | 38 | 39 |
| INVISIBLE | 家族灭迹人 ⛔ (`1283_sgkill`) | 8 | 业余竞演者 / 隐形弩手组长 | 20 | 23 | 25 | 24 | 38 | 39 |
| REFLECTION | 深池伙友卫队精英 ⛔ (`1174_duholy_2`) | 10 | 深池侦察队长 / 深池重甲卫士队长 | 18 | 20 | 22 | 24 | 34 | 39 |
| REFLECTION | 深池重甲卫士队长 (`1170_dushld_2`) | 10 | 深池侦察队长 / 深池方阵指挥官 | 22 | 23 | 26 | 29 | 46 | 49 |
| REFLECTION | 守墓石像 (`1172_dugago`) | 10 | 深池侦察队长 / 深池方阵指挥官 | 20 | 23 | 24 | 24 | 38 | 39 |
| REFLECTION | 假想敌：镜膜 (`9011_acrefr`) | 10 | 深池侦察队长 / 深池重甲卫士队长 | 18 | 20 | 22 | 24 | 34 | 39 |
| REFLECTION | 深池伙友影刃精英 ⛔ (`1175_dushdo_2`) | 8 | 深池侦察犬 / 深池伙友卫队精英 | 20 | 24 | 26 | 28 | 34 | 35 |

**Two concrete example matches** (同盟 险境). Per round: slot type, the special entry, the total, and the kinds and counts **per gate** (what the preview shows).

Example A. Types INVISIBLE / FLY / REFLECTION; slots `SPEC INVI SPEC FLY REFL REFL SPEC FLY INVI SPEC FLY SPEC REFL SPEC INVI`.

| R | type | entry | total | lower gate (9,10) | upper gate (12,10) |
|---|---|---|---|---|---|
| 1 | SPECIAL | 萨卡兹大剑组长 | 5 | 萨卡兹刀兵 ×3, 源石虫 ×2 | — |
| 2 | INVISIBLE | 节日爵士乐手 | 10 | 宿主士兵 ×10 (2 actions × 5) | — |
| 3 | SPECIAL | 重犯 | 7 | 普通囚犯 ×5, 老练囚犯 ×2 | — |
| 4 | FLY | 法术大师A1 | 14 | 妖怪MKII ×5, 法术大师A1 ×4, “萨科塔之翼” ×3 | “萨科塔之翼” ×2 |
| 5 | REFLECTION | 深池伙友卫队 | 19 | 深池侦察兵 ×8, 深池重甲卫士 ×3, 深池伙友卫队 ×1 | 深池侦察兵 ×7 |
| 8 | FLY | 法术大师A2 | 12 | 妖怪MKII ×2, 寒霜 ×2, 法术大师A2 ×1 | 寒霜 ×3, 妖怪MKII ×2, 法术大师A2 ×2 |
| 12 | SPECIAL | 集团军中坚盾卫 | 38 | 宿主士兵 ×21, 宿主重装士兵 ×6, 集团军中坚盾卫 ×3 | 宿主重装士兵 ×4, 宿主士兵 ×3, 集团军中坚盾卫 ×1 |
| 13 | REFLECTION | 深池重甲卫士队长 | 49 | 深池方阵指挥官 ×15, 深池重甲卫士队长 ×14, 深池侦察队长 ×12 | 深池方阵指挥官 ×4, 深池重甲卫士队长 ×3, 深池侦察队长 ×1 |

Example B. Types DOT / TIMES / ELEMENT.

| R | type | entry | total | lower gate | upper gate |
|---|---|---|---|---|---|
| 1 | SPECIAL | 高级军用猎狗 | 6 | 猎狗pro ×4, 源石虫 ×2 | — |
| 3 | TIMES | 俗心 | 6 | 磨砻 ×5, 俗心 ×1 | — |
| 4 | SPECIAL | 拳师囚犯 | 8 | 普通囚犯 ×2, 老练囚犯 ×2, 拳师囚犯 ×2 | 普通囚犯 ×2 |
| 7 | DOT | 逐腐兽 | 24 | 萨卡兹枯朽战士 ×8, 萨卡兹枯朽战士组长 ×5, 逐腐兽 ×5 | 萨卡兹枯朽战士 ×6 |
| 8 | ELEMENT | 假想敌：淤困 | 15 | 萨卡兹王庭军战士 ×5, 萨卡兹王庭军精锐战士 ×2, 假想敌：淤困 ×1 | 萨卡兹王庭军精锐战士 ×4, 萨卡兹王庭军战士 ×2, 假想敌：淤困 ×1 |
| 11 | DOT | 假想敌：蚀裂 | 23 | 萨卡兹枯朽战士组长 ×8, 假想敌：蚀裂 ×6, 疯狂的逐腐兽 ×4 | 萨卡兹枯朽战士组长 ×4, 假想敌：蚀裂 ×1 |
| 12 | SPECIAL | 弧光镜卫 | 51 | Dor-1号失败品 ×18, 莱茵生命防卫科高级成员 ×15, 弧光镜卫 ×8 | 莱茵生命防卫科高级成员 ×5, Dor-1号失败品 ×3, 弧光镜卫 ×2 |

---

## 3. Routes and lanes

### 3.1 Official ground pathfinding [DATA, client `Torappu.Battle.SPFA` + `Tile` + `GridPosition`]

1. **Flow field per destination.** The engine computes one flow field per destination (a route's end, or a MOVE checkpoint) over the **whole map grid**.
   - `PathRequest` is `{targetPos, motionMode, allowDiagonalMove}`.
   - It uses a FIFO queue (SPFA), seeded with the destination at `dist` 0.
2. **Neighbours.** The neighbour order is `GridPosition.GRID_FOUR_WAYS` = **UP (row+1), RIGHT (col+1), DOWN (row−1), LEFT (col−1)**. There are **no diagonal edges**.
3. **Edge cost.** The cost is `Tile.moveCost` of the neighbour: **1**, or **1000** if the tile is "obstacle-like" (a tile holding an active 阻隔工事). FLY always costs 1.
4. **Passability.** A neighbour is used only if it is passable for the motion. For WALK that is `passableMask` ALL (floor, road, start, end, telin, telout, mire, smog, deepsea, infection). `fence_bound`, wall and forbidden tiles are **not** walkable.
5. **Relaxation.** Relax only on strict improvement: `if unvisited or dist[cur]+cost < dist[nb]: dist[nb] = dist[cur]+cost; parent[nb] = cur; enqueue if not queued`. With equal costs, a tile keeps the first parent that reached it. That tie-break comes from the BFS order plus the UP/RIGHT/DOWN/LEFT neighbour order.
6. **Smoothing** (`_PostprocessAndMakeNextMapSmoothly`):
   - Visit tiles row 0→H−1, col 0→W−1, updating in place.
   - For each tile n: `b = parent[n]; while parent[b] exists and LOS(n, parent[b]): b = parent[b]; parent[n] = b`.
   - Every autochess route has `allowDiagonalMove: true`, so LOS is the **Bresenham** variant (`_RaycastBresenhamLine`). Every tile on the line must be valid and not obstacle-like (`Node.CheckObstacleLikeOrInvalid`). A diagonal step also needs both orthogonal neighbours clear.
   - With `allowDiagonalMove: false`, LOS is true only for the same row or column (`_RaycastSegmentLine`).
7. **Movement.** An enemy moves from its current tile straight toward `parent[tile]`. The field is rebuilt when tiles change, for example when a crate dies (`ClearCache` / `GenerateNextMap`).
8. **Crates** (`trap_1105_accrate` 阻隔工事: "改变敌人的行进路线 / 如果阻隔工事阻挡了敌人，敌人会破坏此工事" [DATA]).
   - They are passable at cost 1000, so enemies route around them when any detour is < 1000 tiles longer.
   - If a crate is the only way, the enemy walks into it, is blocked, and destroys it.
   - Moving up and back down is not special-cased. Lane choice is purely this BFS.

### 3.2 Expected lanes per stage (official algorithm, crates as in each level file's non-hidden predefines)

| stage | upper gate (12,10) → goal (9,2) | lower gate (9,10) → goal |
|---|---|---|
| act1 m01 #01 | **row 12** → (12,4) → col 4 → (9,4) → E. Waypoints (12,10)→(12,4)→(9,4)→(9,2) | (9,9) → col 9 up to row 12 → row 12 → col 4 → E. Merges into the upper road. |
| act1 m02 #02 (no crates in 下半) | **row 12 all the way** → (12,3) → col 3 → (9,3) → E | (9,9) → (11,9) → **row 11** → (11,6) → col 6 → row 9 → E |
| act1 m03 #03 | row 12 → col 6 → **row 10** → (10,3) → (9,3) → E. If 射击台 blocks (10,3)/(10,4) [ASSUMED], it goes (10,5) → (9,5) → row 9. | **row 9** straight |
| act1 m04 #04 | (12,9) → (11,9) → **row 11** → (11,4) → (10,4) → (9,4) → E. Smoothed waypoints: (12,10) → (12,9) → (11,9) → (11,4) → (9,4) → E, so it stays on row 11 to col 4. | (9,9) → (10,9) → **row 10** → (10,4) → (9,4) → E |
| act2 m01 #05 | one snake for both gates: col 9 down → row 9 → col 7 up → row 12 → col 5 down → row 9 → E | same snake (enters at (9,9)) |
| act2 m02 #06 | row 12 → **col 7 (mire)** → row 9 → E. Crates on col 9 at (10,9)/(11,9). | **row 9** straight |
| act2 m03 #07 | **row 12** → col 4 → E | (9,9) → (10,9) → row 10 → (10,6) → (9,6) → row 9 → E |
| act2 m04 #08 | **row 12** → (12,4) → col 4 → E | row 9 → (9,6) → col 6 up (deep water) → row 11 → (11,4) → col 4 → E |

The raw BFS chains and smoothed waypoints are in scratch `lanes_official.txt`.

**Remake deviation (user playtest #2, 2026-09-29; narrowed after the community report D5, 2026-10-03).** The user
reported the 战场#01 lower-gate enemies walking up the col-9 floor lane, where no operator can block them.
`server/sim/grid.js` keeps every official route LENGTH and the official route itself unless the 2026-09-29
road-over-floor preference route (equal-length ties to the chain with the fewest non-blockable floor / gate tiles,
smoothing that never cuts across floor its grid route does not walk, the corner tiles of a diagonal step included)
crosses strictly fewer non-blockable tiles; in that comparison a segment that only touches a floor tile's corner does
not cross it. Used alone (0.1.0) the preference also bent official diagonals into L shapes — the D5 report after
0.1.0: on 战场#04 the lower-gate enemies walked (9,10) → (9,8) → (10,8) instead of the official diagonal (9,10) →
(10,7), which only brushes the corner of the floor (10,9). Lanes that still differ from the table above (21 of the 154
stage × gate × field routes, test/sim/pathing-official.test.js):
- act1 m01 #01, lower gate: (9,10) → (9,8) → **col 8 road up** → (12,8) → row 12 → col 4 → E (official: (9,9) → (12,8)
  through the floor (10,9)); the 联防 partner routes pass the same exit.
- Boss fields: the exits from (2,10) on 战场#01 / #02 avoid part of the arena's central floor; 战场#02's 联防 partner
  lower gate avoids (12,17); the inactive 战场#07 (上半) 联防 partner upper gate takes row 9 instead of row 12's floor.
- The inactive 战场#05 (上半): its 深水区 refuses deployment (player report #3 after 0.1.0) and the sim does not model the
  特制水上平台 canoes over it (they only enter the prep's deploy map), so the water counts as non-blockable and 7 of its
  routes take the floor lanes beside it (one non-blockable tile fewer than the official routes).
  Floor the terrain forces stays (gates, (12,9) beside the upper gate, the col-9 floor where walls or a crate block the
  road: #02 lower (10,9)/(11,9), #04 upper (11,9), #05 upper (11,9)/(10,9), #07 lower (10,9)).
  Full audit: test/sim/pathing-blockable.test.js.
- Official again since D5 (0.1.0 took L routes there): 战场#04's lower gate (normal, 联防) and boss exits, the boss exit
  (5,10) of 战场#05(下半), the boss exit (2,10) of 战场#07(下半) and the inactive 战场#06(上半). The diagonal first
  step out of the (2,10) exit of 战场#07(下半) (and #06(上半)) passes its side tiles (2,9) / (2,11) at exactly
  √0.5 ≈ 0.70711, just beyond the ground block radius 0.70709997 (PRTS 游戏数据基础 §阻挡半径), so an operator standing
  there no longer catches those enemies; every other blocking tile of the 154 routes is unchanged.

### 3.3 What we do and the root cause of "upper-gate enemies walk the lower lane"

- **Our pathfinder.** `server/sim/grid.js` is **8-directional A\*** with diagonal cost √2 and a no-corner-cut rule. It is limited to the field rect (rows 9–12, cols 0–10). Neighbour order is W, E, S, N, then diagonals.
- **Crates and platforms.** Crates and platforms/mounds are **impassable** (with an `ignoreObstacles` fallback) instead of cost 1000.

| stage | ours, upper gate | official | effect |
|---|---|---|---|
| act1 m02 | 12,10 → 12,9 → 12,8 → 12,7 → 12,6 → **11,6 → 10,6 → 9,6** → row 9 (lower road) | row 12 → col 3 (top road) | **Wrong lane.** Two causes: (a) `data/stages.json` marks crates `trap_1105_accrate#001–004` at (12,4), (12,5), (11,7), (11,8) as `active: true`, although the level file has them `hidden: true` and the PRTS 下半 screenshot shows none, so the top road is blocked; (b) even without crates, the 8-dir metric makes col 6 (10.41) shorter than the top road (11). |
| act1 m04 | 12,10 → 12,9 → 11,9 → **10,8** → row 10 | row 11 (upper row of the 2-wide band) | Upper-gate enemies join the lower-gate lane at once. |
| act1 m03 | … (10,6) → **(9,5)** → row 9 | row 10 → (10,3) (if platforms are walkable) | joins the lower lane 3 tiles early (platform rule [ASSUMED]) |
| act1 m01 (lower gate) | (9,9) → (10,8) → col 8 up | col 9 up | small visual difference |
| act2 m01–m04 | same lanes as official (diagonal corner cuts only) | — | OK |

The historical note on act1 m02 [DATA]:

- The **上半** PRTS image shows crates at (12,4) and (12,5).
- The **下半** `ver2` image shows none. The current level file has all m02 crates and platforms `hidden`.
- The terrain effects `map_m02_1/2` ("阻隔工事变为射击台" / "移除全部阻隔工事") still exist in the 下半 `effectInfoDataDict`. The 战术决策 card pools are server-side, so they may still be offered.
  - On 下半 m02, applying them can only remove crates that are already hidden, or show the hidden 射击台 via the platform aliases [ASSUMED].
  - They are no reason to start with crates.
- **The 下半 m02 has no crates at start.**

### 3.4 Pathing spec to implement (replaces `Grid.findPath` for ground enemies)

```
flowField(dest, {obstacleCost = 1000, allowDiagonal = true}):   // cache per (dest, grid.version)
  dist = Int32Array(ROWS*COLS).fill(-1); parent = Int32Array(...).fill(-1); inQ = Uint8Array
  q = FIFO; dist[dest] = 0; q.push(dest)
  while q: cur = q.shift(); inQ[cur] = 0
    for (dr,dc) of [[+1,0],[0,+1],[-1,0],[0,-1]]:             // UP, RIGHT, DOWN, LEFT — do not reorder
      nb = cur+(dr,dc); if !inMap(nb) || tile(nb).pass !== 'ALL': continue
      nd = dist[cur] + (isCrate(nb) ? obstacleCost : 1)
      if dist[nb] < 0 || nd < dist[nb]: dist[nb] = nd; parent[nb] = cur; if !inQ[nb]: q.push(nb); inQ[nb]=1
  // smoothing, row-major, in place
  for r in 0..ROWS-1: for c in 0..COLS-1: n=(r,c); if dist[n]<0 || parent[n]<0: continue
      b = parent[n]; while parent[b] >= 0 && los(n, parent[b]): b = parent[b]; parent[n] = b
  los(a,b): Bresenham from a to b; every visited tile passable && !crate; on a diagonal step also both
            orthogonal neighbours passable && !crate  (allowDiagonal=false ⇒ same row or same col only)
```

- A ground enemy at tile t with a leg to D moves straight toward `parent_D[t]`. It re-reads the field on entering a new tile, or when `grid.version` changes.
- The whole 19×21 map may be used as the official does. Keeping the field rect is harmless for normal rounds, because no shorter path leaves it.
- `remainingDistance` (targeting "closest to goal") should use `dist_D[t]` plus the leg tail. The official exposes `TryCalculatePathFindingDistance` on the same field.
- **Performance.** One BFS over 399 tiles per destination and grid version replaces one A\* per enemy leg. It is also deterministic across clients.

---

## 4. Enemy preview (prep phase) [DATA, client `AutoChessEnemyPreviewManager`]

### 4.1 Which enemies use which gate

The gate is the start of the action's route. R1–R3 use only the lower gate. Notation: `class count @ preDelay / interval` (game seconds). E.g. `N3@7/5` = 3 enemies of the N slot, the first at 7 s, then one every 5 s. Counts are template counts before replacement (§2.3).

| R | tpl | lower gate (9,10) | upper gate (12,10) |
|---|---|---|---|
| 1 | 01 | 源石虫2@3/5 N2@12/3 NF2@12/3 | — |
| 2 | 02 | N3@3/5 N3@15/7 NF4@3/7 NF5@15/7 | — |
| 3 | 03 | N10@6/6 E1@18/10 NF9@6/7 EF2@10/10 | — |
| 4 | 04 | N2@12/4 E1@13/12 S1@29/7 NF2@3/6 NF3@26/6.5 EF3@17/9 SF2@18/9 | N2@3/6 NF3@7/8 |
| 5 | 05 | N3@7/5 N3@27/5 E2@14/7 S1@25/9 NF3@3/6 NF4@16/5 EF3@17/1 SF2@31/6 | N2@3/10 N3@22/8 NF3@5/6 NF3@22/6 |
| 6 | 06 | N4@7/8 N3@16/8 E2@20/12 S2@28/14 NF4@2/5 NF4@20/7 NF4@27/5 EF3@17/1 SF3@29/5 | N3@2/8 N3@19/8 NF4@7/8 |
| 7 | 07 | N4@8/5 N4@22/9 E4@5/17 S2@12/14 S1@40/14 EF3@17/11 SF1@9/12 SF1@13/12 EF2@41/11 NF2@2/10 NF8@27/4 | N3@2/8 N3@18/10 NF4@5/5 NF1@30/5 |
| 8 | h01 | N3@2/3 N3@28/5 N2@62/5 E1@37/9 S3@42/9 NF2@3/5 NF2@25/5 EF2@17/5 SF1@10/20 | N3@11/1 E2@17/10 S1@9/12 NF2@5/7 NF2@13/5 EF3@39/5 SF3@28/12 |
| 9 | h02 | N3@2/5 N3@42/7 N3@65/5 E2@17/10 S1@13/16 S1@40/5 NF2@3/3 EF3@28/5 | N3@3/5 N3@39/5 E1@41/10 NF1@3/1 NF2@13/5 NF3@20/5 EF2@41/5 SF1@7/7 SF3@21/12 |
| 10 | h03 | N3@3/5 N3@25/5 N3@49/5 E3@17/10 E1@41/10 S1@57/5 NF2@7/5 EF3@28/6 | N2@3/4 N4@5/5 S3@17/13 NF2@3/4 NF3@5/5 NF2@13/5 EF2@41/5 SF1@10/10 SF3@25/10 |
| 11 | h04 | N2@5/2 N3@22/2 N2@45/5 N2@50/5 E1@10/9 E3@54/7 S2@17/5 S4@42/5 NF3@27/2 EF3@28/2 EF2@52/2 SF2@17/2 | N2@5/5 N2@10/5 S1@6/20 NF2@3/3 NF2@5/5 NF4@9/5 EF1@20/5 SF1@7/10 SF2@21/10 |
| 12 | h05 | N3@5/3 N2@30/3 N2@10/3 N3@35/5 N3@51/4 E2@12/10 E2@37/9 E2@53/7 S3@2/10 S3@10/10 S2@31/10 NF3@10/3 NF3@27/2 EF3@28/2 EF3@47/6 SF2@12/5 SF3@22/6 SF2@35/5 | N2@5/3 E3@10/10 S2@21/12 NF2@5/1 NF3@8/4 NF3@21/5 NF3@43/5 EF2@13/5 EF2@15/5 SF2@17/10 |
| 13 | h06 | N3@7/3 N3@10/5 N3@39/5 N3@62/4 E3@11/9 E4@37/9 E3@55/9 S4@2/10 S4@10/7 S3@32/10 NF3@27/2 EF4@28/2 EF3@55/7 SF2@10/5 SF3@22/5 SF2@35/5 | N1@7/1 E2@3/10 S2@21/15 NF2@5/1 NF3@21/4 NF3@50/5 EF2@13/5 EF1@15/5 SF3@17/11 |

- FLY actions also start at a gate (their routes start at (9,10) or (12,10)), so they are previewed at that gate.
- Only the **valid** actions of the round's movement class appear (§2.3).
- Leader rounds use the boss field gates (2,10) and (5,10) with a row offset of 13, which lands in the same pen.

### 4.2 Placement algorithm

1. **Preview entries.** For each valid round action there is one entry `{preDelay, startPosition = routes[action.routeIndex].startPosition, enemyKey, count}`. The boss action is added in leader rounds. Entries are sorted by `preDelay` (`_CompareActionByTime`).
2. **Thinning.** Let `total = Σ count`.
   - `showRatio = min(1, 50/total)` and `totalShowCnt = min(50, total)`. `MAX_PREVIEW_CNT` = 50.
   - Per entry, `n = max(1, round(count·showRatio))`.
   - An enemy whose handbook `enemyLevel` ≠ NORMAL (elites, bosses) always uses ratio 1.
   - **Each enemy is shown as its own model.** The preview has no count badge.
3. **Pen and zones.**
   - The pen is `enemy_place_rect ((14,7),(18,13))` (stage `configBlackBoard`).
   - The zone anchors are the `tile_start` tiles in the rect: **(15,7)** and **(18,7)**.
   - Every other pen tile with `passableMask` ALL and without `previewNotAlloed` belongs to the Manhattan-nearest anchor. Row 16 is excluded.
   - **Lower zone** = rows 14–15 (13 tiles). **Upper zone** = rows 17–18 (13 tiles). Each list is in row-major order (low row first, col 7→13).
4. **Zone choice.**
   - Target = `(start.row + enemy_preview_row_offset, start.col)`. The offset is 6 by default (13 in leader rounds); neither key is set in the stages, so the defaults apply.
   - The zone is the anchor with the smallest `|anchor.row − target.row| + |anchor.col − target.col|` among anchors with `anchor.row ≤ target.row`.
   - Result: lower gate (9,10) → the (15,7) zone; upper gate (12,10) → the (18,7) zone.
5. **Tile choice.** The k-th model sent to a zone goes to `zoneTiles[clamp(round(k/totalShowCnt·len) + Random.Range(−1,0))]`. Several models may share a tile. When no zone fits, a random pen tile is used.
6. **Camera.** In the official 3D camera the pen sits top-right, beyond the gates.
   - For our 2D board, render the pen rows 14–18 (the stage already has them).
   - Alternatively, render two gate-anchored zones next to the gates: the upper zone beside (12,10) and the lower zone beside (9,10). That is what the user remembers ("右侧上下红门后方").
   - Keep the grouping exact: one zone per gate.

---

## 5. Secondary: bounty and 联防 spawn mapping [DATA, client `AutoChessLevelEnemyManager`; partially decoded]

**Bounty (悬赏) and extra enemies** (`_InsertSpActionToNormal`, `_GetSpEnemyActionData`):

- Each added enemy is attached to the first action of the round's **original** template whose key is `templateEnemyNormal` (walker) or `templateEnemyNormalFly` (flyer). Summoned tokens use `templateEnemyToken` / `templateEnemyTokenFly` instead.
- If no action matches, it uses action 0.
- All units attached to that action are then spread evenly over its window: `preDelay + i·max(window/n, 0.05·window)`.
- So a walking bounty enters at the round's first N action gate. That is the lower gate in every round, because action N#1 always starts at (9,10).

**联防:**

- Each leaked enemy maps to the escaped template's action as follows:
  - walkers → the `lrsldr` action (route 3: WALK from (9,18) via (9,10), or from (9,10) in `escaped_single`; preDelay 3, interval 8),
  - flyers → the `yokai` action (route 0),
  - tokens → `gopro_2` / `lazerd`.
- Elite and special leakers are **not** routed through the E/S actions (the class is ignored).
- Timing is recomputed per owner uid (`_CalculateActionPredelayConsiderUid`; constants `ACTION_INTERVAL_FOR_UID` 0.5 s, `MAX_ACTION_INTERVAL_FOR_UID` 5 s). The exact formula was not decoded [ASSUMED: 0.5 s spacing within an owner, capped at 5 s].
- Helper order [WIKI 帮助]: most units on the field (downed included) > has an active bond (?) > highest bond layers (?) > most undowned units. The first helper takes the right-hand field. With 3 perfect players, the top 2 by the same order help.

---

## 6. Deviations from official numbers (custom balance and assumptions)

| # | Where (ours) | Current | Official | Source | Action |
|---|---|---|---|---|---|
| 1 | `server/match/waves.js` `replaceSlot` / `templateSpawns`; `data/factions.json` `generation.kFormula` | each template **enemy** → k copies (k ≤ 5), 0.5 s stagger | each template **action** → `clamp(roundHalfEven(n·BE_t/BE_new),1,5)` enemies, interval `n·iv/n'` | [DATA] | replace (§7-1) |
| 2 | `setupMatchWaves` / `pickEntries` | 3 factions per match; **every** round: a ground entry from the chosen types + SPECIAL, **and** a FLY entry | 15-slot schedule (3 types × 3 + 6 SPECIAL, shuffled); **one** entry per round | [DATA] | replace |
| 3 | `flyPlaceholders` 'keep' (BALANCE §2.2) | 寒霜 / 暴鸰 / 妖怪 stay in ground rounds (the #1 leak source) | the other movement class is **not spawned** (`isValid=false`) | [DATA] + [VIDEO] | drop the knob; implement the rule |
| 4 | `pickEntries` `inactiveIn`, `pickReplacement` filters attached keys | inactive list also filters N/E replacements | only `specialEnemyKey` is filtered | [DATA], [WIKI] 上半 note | change |
| 5 | `data/tuning.json → modes[*].enemyHpMul / enemyAtkMul` (all 8 modes, e.g. multi 险境 R13 HP ×0.55) | custom per-round multipliers from `tools/balance.mjs` | none; only the PRTS table (`config.enemyScale`) | [WIKI] | **delete** (keep `titles.comment_3`, which is unrelated) |
| 6 | `data/tuning.json → mode_single_funny.bossHpMul 0.6` | leader pool ×0.6 in solo 标准 | none | — | **delete** |
| 7 | `config.bossHpScale` `bloodPoint × alive/4`, solo ×0.25 [ASSUMED] | pool scales with alive players | co-op: split leaders share HP, "敌方领袖的总生命值不变" → pool = `bloodPoint` (no alive scaling found); **solo: unknown**. **Re-read 2026-10-01 (DESIGN §20.10):** notice 5114's full sentence is "在联合模拟的最终攻势阶段，部分敌方领袖会同时出现在战场的左右两侧，两侧的敌方领袖共享生命值（敌方领袖的总生命值不变）" — the left / right copies of one pair field share the HP; it says nothing about the number of players. The one note on that is community (巴哈姆特 12294 "聯機隊友(撤退/死掉)變少，最後boss血條也會變少", no proportion); it became the config switch `bossHpScale.aliveScaling` (× alive / 4). **2026-10-03 (upstream issue #113 "联机boss血量没有乘以联机人数"):** the pool does scale with the number of PLAYERS; that version read it as the seats (`playerScaling`, × seats / 4, an eliminated player still counted) and kept `aliveScaling` off. **2026-10-05 (user rule):** the factor is the players alive when that boss fight starts, read once and locked there (`aliveScaling` **on**; × seats is the flip) — see DESIGN §20.10 | [WIKI] notice 5114 / PRTS 下半 | co-op: `bloodPoint × alive / 4`, alive captured at the fight's start ([ASSUMED proportion]; `aliveScaling: false` = the seats); solo: keep a config value, flagged unknown |
| 8 | `waves.js bountySpawns` `soloMul 0.7` for "perfect" bounties | bounty HP/ATK/DEF ×0.7 **on top of** the solo 0.7 base | no bounty-specific rule; the "70 %" note is the global solo base, already in `enemyScale` | [WIKI] 上半 11/18 log | remove `soloMul` |
| 9 | `bountySpawns` timing | t = 4 s, +5 s per bounty, interval 3, `routeByMotion` | attached to the template's first N / NF action window (§5) | [DATA] | change |
| 10 | `buildUniteWave` | grouped by slot class N/E/S/…, compressed into 40 % of the time limit | walkers → `lrsldr` action, flyers → `yokai`, tokens → T/TF; per-owner 0.5 s spacing | [DATA] (partial) | change |
| 11 | `config.unite.helperOrder` `highestLpThenSeat` [ASSUMED] | by LP | most units on the field > active bond > layers > undowned units | [WIKI] 帮助 | change |
| 12 | `gamedata.combatTimeLimit` ×2 (`COMBAT_TIME_SCALE`) | `maxPlayTime` read as real seconds | unit not stated. The official count rule keeps each action's window, e.g. FLY R2 still spawns its last flyer at ≈ 43 s of "45", so ×2 remains necessary. | [ASSUMED], supported by spawn schedules | keep, but re-check after the count fix |
| 13 | `server/sim/grid.js` 8-dir A\*, √2 | see §3.3 | 4-dir SPFA flow field + LOS smoothing | [DATA] | replace (§7-3) |
| 14 | `data/stages.json` act1 m02 crates `trap_1105_accrate#001–004` `active:true` | top road blocked | hidden in the 下半 level; absent in the 下半 screenshot | [DATA] + [VIDEO] | set `active:false` |
| 15 | crates impassable + `ignoreObstacles` fallback | — | passable at cost 1000, block LOS; blocked enemy destroys the crate | [DATA] | change |
| 16 | 射击台 / mounds block ground movement [ASSUMED] | — | unknown (crate and platform token data are identical; behaviour is in the prefab) | — | keep, flagged |
| 17 | `config.enemyScale` (HP/ATK only) | — | 下半 text: HP/ATK; 上半 11/18 also named DEF | [WIKI] | keep; optional DEF |
| 18 | `economy.income` `min(3+r, 12)` | R4+ assumed | BWIKI (hidden text, older season): "从第2回合开始每回合获得资金数+1，上限12" | [WIKI], weak | keep |
| 19 | `previewOf` | one list per key, no gate | per-action models placed in a gate zone (§4) | [DATA] | change |

Everything in `docs/BALANCE.md` §4 (the tuned tables) and the `tools/balance.mjs --tuning` path becomes obsolete once #1–#6 are applied. The "competent board" model can still be used to *measure* difficulty, but no longer to tune it.

---

## 7. Changes required in our implementation (precise diffs vs current behaviour)

1. **`server/match/waves.js` + `data/factions.json`** (and the data generator in `tools/`):
   - **Match setup.** `setupMatchWaves` returns `{stageId, factions: [3 types], typeSlots: [15 types], bossId, hiddenBossId}`.
     - Shuffle the 6 `involveRandom` types and take 3.
     - Push each `count` (3) times, fill to `maxLevelCnt` (15) with SPECIAL, then Fisher-Yates-shuffle with the match rng.
     - Store `typeSlots` in match state. It is visible in the briefing as the 3 types, and the slot order stays hidden.
   - **Round pick.** Add `pickRoundEntry(gd, rng, typeSlots, r)`:
     - half = `r <= 7`;
     - candidates = `specialEnemyInfoDict` of that type and half, whose **special** key is not in `mode.inactiveEnemyKeys`;
     - weighted by `randomWeight`;
     - `normal = attachedNormal[randInt]`, `elite = attachedElite[randInt]`.
     - Generate the picks for all 15 rounds at match start (like the client), so the preview and the server agree.
   - **Replacement.** Replace `templateSpawns` / `replaceSlot` as follows:
     - For each template SPAWN action whose key is a template placeholder: if `isFly(newKey) !== isFlySlot`, **skip the action** (no spawn, no preview).
     - Otherwise `n' = clamp(roundHalfEven(f32(f32(n·P(t))/f(t)) / f32(P(new)/f(new))), 1, 5)`, and each unit i spawns at `time + i·max(n·iv/n', 0.05·n·iv)`.
     - `P = hp + 5·atk + 3·def + 3·res` from the `enemy_database` level-0 attributes (not the autochess overrides).
     - `roundHalfEven(x) = (x − floor(x) === 0.5) ? (floor(x) % 2 ? floor(x)+1 : floor(x)) : Math.floor(x + 0.5)`.
     - Keep literal keys and the T/TF tokens unchanged.
     - Remove `COPY_STAGGER`, the `k` fields (`kS`, `N[].k`, `E[].k`), `flyPlaceholders`, `groundRouteLike` and the `inactiveIn` filtering of attached keys.
   - **Leader rounds.** `buildBossWave` uses the pick of slot 14 (or 15, or 9 in solo 标准) with the same rule, so only E **or** EF escorts spawn.
   - **Unit tests** (fixtures from §2.6 / §2.7):
     - R1 高级军用猎狗 → {源石虫 2, 猎狗pro 4};
     - R1 炽焰源石虫 → {源石虫 2, 灼热源石虫 5};
     - R1 萨卡兹大剑组长 → {源石虫 2, 萨卡兹刀兵 3};
     - R3 FLY 护障 → {妖怪 5, 妖怪MKII 4} and no walkers;
     - an elite action "2 × 灵幛" → 隐形弩手组长 ×**4** (the tie case);
     - multi 险境 R3 total ≤ 10 for every entry.
2. **Stat scaling and balance.**
   - Delete every `enemyHpMul`, `enemyAtkMul` and `bossHpMul` in `data/tuning.json`. Keep the `titles` block.
   - Remove the `soloMul` in `bountySpawns`.
   - `config.bossHpScale`: co-op pool = `bloodPoint[difficulty]` × the players alive when that fight starts / 4 (`aliveScaling`, on; the count is captured once at the fight's start and locked, so an elimination during the fight is not a factor); solo stays a flagged config value. (2026-10-01: × alive / 4 available behind `aliveScaling`, off, see §6 #7. 2026-10-03: upstream issue #113 — the room size IS the factor, shipped as `aliveScaling: false` = the seats. 2026-10-05: the user's rule restored the alive count with the lock.)
   - Keep `enemyScale` (PRTS table) and the 终极 speed ×1.15 from R3.
   - Re-run `tools/balance.mjs --tuning off` only to report, not to tune.
3. **Pathing** (`server/sim/grid.js`, `server/sim/ai.js`, `server/sim/Battle.js`):
   - Add `Grid.flowField(dest)` as in §3.4, cached per `(dest, version)`.
   - `planLeg` for WALK: follow the smoothed parents from the enemy's tile to the leg target and re-plan on version change. That is the same trigger as today.
   - Crates: `setObstacle` marks a cost-1000 obstacle-like tile, not an impassable one. The existing "blocked enemy attacks the crate" logic stays.
   - `data/stages.json`: set act1 m02 `trap_1105_accrate#001…#004` to `active:false`.
   - Keep platforms and mounds blocking [ASSUMED].
   - Add tests: the upper gate on act1 m02 reaches E through (12,3)→(9,3), and on act1 m04 it stays on row 11 down to col 4.
4. **Preview** (`previewOf` and the client prep view):
   - Emit one entry per valid action: `{enemyKey, count, gate: route.start, preDelay, elite}`.
   - The client places models with §4.2: two zones, ≤ 50 models, elites always shown.
   - Show upper-gate enemies in the upper zone and lower-gate enemies in the lower zone.
   - The HUD count stays Σ count.
5. **Bounty and 联防**:
   - `bountySpawns`: attach bounties to the round template's first `lrsldr` / `yokai` action (gate, preDelay, window spread).
   - `buildUniteWave`: walkers → the escaped template's `lrsldr` action route; flyers → `yokai`; tokens → `gopro_2` / `lazerd`; 0.5 s spacing per owner.
   - Change `unite.helperOrder` to the PRTS rule (§5).
6. **Performance (user item 4).**
   - Items 1 and 3 cut enemies per board by ≈ 55–70 % (R12: 80 → 35) and replace per-enemy A\* with one BFS per destination.
   - Measure again before adding other optimisations.

---

## 8. Open questions

| # | Question | Default |
|---|---|---|
| 1 | Do 射击台 (act1 m03 (10,3)/(10,4)) and 土石结构 block ground movement? | Block [ASSUMED] |
| 2 | Leader HP pool in solo, and in co-op with fewer than 4 alive players | co-op `bloodPoint × alive / 4`, `alive` = the players alive when that boss fight starts (captured once there and locked — user rule 2026-10-05; `aliveScaling: false` = the seats, the reading upstream issue #113 shipped 2026-10-03; the proportion is [ASSUMED]); solo config value (flagged) |
| 3 | Unit of `maxPlayTime` | Real seconds (×2 game) [ASSUMED] |
| 4 | Exact 联防 predelay formula (`_CalculateActionPredelayConsiderUid`) | 0.5 s per owner [ASSUMED] |
| 5 | DEF reduction in the 70 % / 80 % bases | HP/ATK only (下半 text) |

Everything else in §2–§4 is decoded from official data or client code.

---

## Appendix A. Official client/server split for battles (relevant to user item 5) [DATA, metadata names]

- The protocol types show that **each client simulates its own battle locally** and reports events to the server:
  - `AutoChessBattleSceneSelfBattleKillEnemyUp {enemyInstId, attackerInstId, damageSrc}`
  - `…SelfBattleEnemyEscapeUp {enemyInstId, isToken}`
  - `…SelfBattleAddBondUp {charInstId, layerDelta, bondIndexList}`
  - `…SelfBattleFinishUp {round, escapedInstIds, escapedTokenInstIds, killedInsts, charBattleStatusList}`
  - `…SelfBattleInfoUp {round, charBattleStatusList, charBattleInfoList}`
- 联防 uses the same pattern:
  - `…HelpBattleKillEnemyUp {enemyInstId, isToken, killedByPlayer, attackerInstId, damageSrc}`
  - `…HelpBattleEnemyEscapeUp`
  - `…HelpBattleFinishUp {round, escapedEnemies, killInfos}`
- The server sends:
  - `AutoChessBattleSelfBattleInfo {enemyInfos: [{enemyId, actionIndex, instIdList}]}`
  - `AutoChessBattleHelpBattleInfo {escapedEnemies: [{ownerPlayerIndex, enemyId, enemyInstId, isToken}], players: [{deployment, charBattleStatusList}]}`
- **The helper client receives the partner's deployment and end-of-battle status and replays 联防 locally.**
- Round enemy data is generated client-side with a shared seed (`RandomEnemyGenerater`). Actions go to the server only if `ShouldActionUpToServer`.

## Appendix B. Client method RVAs (Windows build in the user's CrossOver bottle, metadata v29) for re-verification

| method | RVA |
|---|---|
| `RandomEnemyGenerater._DoReplaceActionDataClient` | 0x180b640f0 |
| `_CalculateEnemyCountByBattleEffectiveness` | 0x180b63e70 |
| `_CalculateActionBattleEffectiveness` | 0x180b63d50 |
| `_GetEnemyAttrPower` | 0x180b65e10 |
| `_GenerateSpecialEnemyTypesLocal` | 0x180b655c0 |
| `_GenerateRandomEnemyData` | 0x180b64870 |
| `_DoReplaceLevelDataClient` | 0x180b64580 |
| `_InitData` | 0x180b663f0 |
| `SPFA._GenerateNextMapImpl` | 0x180893720 |
| `SPFA._PostprocessAndMakeNextMapSmoothly` | 0x1808940c0 |
| `SPFA._RaycastSegmentLine` | 0x180894c80 |
| `Tile.get_moveCost` | 0x18089cdc0 (obstacle-like ? 1000 : 1) |
| `GridPosition..cctor` | 0x18210a800 (FOUR_WAYS = UP, RIGHT, DOWN, LEFT) |
| `AutoChessEnemyPreviewManager._GeneratePreviewData` | 0x180b3cad0 |
| `AutoChessEnemyPreviewManager._GetBetterGridToSpawn` | 0x180b3d180 |
| `AutoChessEnemyPreviewManager._InitIfNot` | 0x180b3d710 |
| `AutoChessEnemyPreviewManager..ctor` | 0x180b3e190 (row offsets 6 / 13) |
| `<_SpawnPreviewEnemies>d__16.MoveNext` | 0x180b4fc40 (cap 50) |
| `AutoChessLevelEnemyManager._CalculateActionPredelay` | 0x180b453c0 (ratio 0.05) |
| `AutoChessLevelEnemyManager._GetSpEnemyActionData` | 0x180b466f0 |

`Il2CppCodeGenModule` for Assembly-CSharp is at VA 0x186e69af0 (217 790 method pointers at 0x188216460).
