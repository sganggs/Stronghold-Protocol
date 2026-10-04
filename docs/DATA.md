# DATA.md — generated game data (`data/*.json`)

All files in `data/` except `data/assets.json` are produced by **`node tools/build-data.mjs`** (task F1) from the
official zh_CN client data ([Kengxxiao/ArknightsGameData](https://github.com/Kengxxiao/ArknightsGameData)) joined
with `docs/research/*.json`. Do not edit them by hand — change the build script and rebuild.
`data/assets.json` is written by `tools/fetch-assets.mjs`, which keeps the current file rather than drop entries whose
downloads failed on this machine unless `--allow-shrink` (or `--prune`) is passed (docs/ASSETS.md, DESIGN §21.25).

```
node tools/build-data.mjs              # build (downloads missing official files into .cache/gamedata/)
node tools/build-data.mjs --offline    # never download; fail if a cached file is missing
node tools/build-data.mjs --refresh    # re-download every official file
node tools/build-data.mjs --no-research --out /tmp/x   # research-free build (fallback defaults), other dir
node tools/build-data.mjs --cache <dir> --report <file> # other cache dir / report file (tests, CI)
node tools/build-data.mjs --force      # write data/ even when integrity checks fail (debugging only)
node --test test/data.test.js          # integrity tests (+ raw-data cross-check and rebuild check when .cache/gamedata exists)
```
Unknown options or a missing option value are errors (exit code 2); `--refresh` and `--offline` are exclusive.

- **Cache.** Official files live under `.cache/gamedata/<repo path>` (`excel/activity_table.json`,
  `levels/enemydata/enemy_database.json`, `levels/activities/act1autochess/level_*.json`, …) and are fetched from
  `https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData/master/zh_CN/gamedata/<path>` when missing.
  Downloads are validated (must parse as JSON) and written atomically.
- **Report.** Every run writes `.cache/build-data-report.json` (counts, byte sizes, warnings (each once), errors, `written`).
  Integrity errors (see §17) make the exit code 1 **and leave the previous output untouched** (unless `--force`);
  warnings never do. Each output file is written atomically (temp file + rename).
- **Determinism.** Same inputs ⇒ byte-identical outputs (stable key order, no timestamps, no randomness).
- **Size.** ≈3.5 MB total (limit 6 MB; `chess.json` ≈1.65 MB with the loadout choices), compact JSON (no indentation).
- **Derived paths.** `stages.json groundPaths*` come from the sim's own `server/sim/grid.js` pathing: a change there
  needs a rebuild (the offline-rebuild test catches a stale `data/`).

## 0. Conventions used by every file

| Convention | Meaning |
|---|---|
| ids | Always the official ids: `chess_char_1_01_a` (normal) / `_b` (精锐 golden), `chess_item_1_01_e_a`, `garrison_16_a`, `bondeffect_yan`, `enemy_1422_lrsldr`, `band_bldsk`, `boss_1`, `act1autochess_03` (wave template = level file name, lower-case), `act2autochess_m01` (stage). |
| `desc` / `descRaw` | `descRaw` keeps the official rich-text markup (`<@ba.vup>+15%</>`, `<$ba.sluggish>停顿</>`), `desc` is plain text. Literal trigger labels such as `<获得时>`, `<在场6名不同【炎】干员>` are part of the text and kept in both. `\n` escapes are real newlines. Placeholders (`{atk:0%}`, `{-x}`, `{x:0.0}`) are already **resolved** at the record's level, except bond `effectDesc` (see bonds). |
| `bb` / `bbStr` | Flattened official blackboard. `bb[key]` = number; `bbStr[key]` = the official `valueStr` when present. A string-valued entry (value 0 + valueStr) appears **only** in `bbStr`. Duplicate keys get `_1`, `_2` suffixes. Numbers are float-noise-cleaned (6 decimals). |
| `params` | Effects/items/bands: `{…bb, …bbStr}` of all buffs merged, first occurrence wins (convenience; use `buffs` for exact semantics). |
| positions | `[row, col]`, **row 0 = bottom**, col 0 = left, 19 × 21 grid (DESIGN §3). |
| `rangeGrid` | `[[dRow, dCol], …]` relative to the unit facing **right** (`[0,0]` = own tile). Rotated for the unit's direction (DESIGN §3, `server/sim/dir.js rotateOffset`): RIGHT `(dr,dc)`, UP `(dc,−dr)`, LEFT `(−dr,−dc)`, DOWN `(−dc,dr)`; `rangeExtend` grows +dCol before rotating. (Every grid in the data is symmetric top-to-bottom, so LEFT equals mirroring `dCol`.) |
| round-keyed maps | JSON object keys are strings: `rounds["14"]`. |
| `[ASSUMED]` / `assumed: true` | Value is a documented reconstruction (research), not client data. Keep it tunable. |

---

## 1. `config.json` — modes, economy and all global tunables

Top level: `{ season, seasonName, modes, economy, lpCapPerRound, bossOvertimeAfter, bossOvertimeDrainPerSec, bossHpScale, hiddenCore, dp, unite, finalAssault, timers, bans, bandDraft, titles, titleRule, tips, broadcasts, trophies, roundScores, rewards, constants }`.

### 1.1 `modes[modeId]` (9 modes; `modeId = mode_${single|multi}_${difficulty}` + `mode_training_1`)

| Field | Example | Meaning |
|---|---|---|
| `modeId`, `name`, `code`, `sortId` | `"mode_multi_abyss"`, `"终极模拟"`, `"AC-4"`, `5` | official |
| `type` | `"MULTI"` | `SINGLE` 独立 / `MULTI` 同盟 / `LOCAL` training |
| `difficulty` | `"ABYSS"` | `FUNNY` `NORMAL` `HARD` `ABYSS` (`TRAINING`) |
| `inScope` | `true` | false for training (out of scope v1) |
| `color`, `iconId`, `backgroundId` | `"#ff0024"`, `"mode_abyss_icon"` | UI |
| `desc`, `effectDescList`, `unlockText` | | official texts |
| `specialPhaseTime` | `16` | official 机变 phase time field (multi 16 s per picker, solo 150) |
| `activeBondIds` / `inactiveBondIds` | FUNNY: 13 / 10 | static bond availability |
| `inactiveEnemyKeys` | 18 keys (FUNNY/NORMAL) | enemies never used in this mode |
| `lastRound` | `14` (solo FUNNY `9`) | last regular round (boss round) |
| `bossRound` | `14` | round of the Final Assault |
| `hiddenRound` | `15` or `null` | 隐秘核心 round (NORMAL+) |
| `rounds[r]` | see below | per-round schedule |
| `spRounds` | `[3,9,11]` | rounds whose prep opens with a 机变 draft |
| `combatTimeLimit[r]` | `{"1":45,…,"14":null}` | = `rounds[r].combatTimeLimit`: **real** seconds of the forced-2× battle (DESIGN §4) |
| `enemyScale[r]` | `{"atk":1.1,"hp":1.2,"speed":1,"kAtk":1,"kHp":1}` | non-boss enemy multipliers (research 01 A3): `atk = atkBase·1.1^kAtk`, `hp = hpBase·1.2^kHp·extra`, `speed` 1.15 on ABYSS from R3. Apply to level-0 stats after special-enemy replacement, also to bounty/special enemies. **Leader HP pools excluded.** |
| `bossHpScale` | multi `{"bloodPointKey":"bloodPointAbyss","coop":1,"aliveScaling":false,"aliveFull":4,"aliveAssumed":true,…}` · solo `{"bloodPointKey":"bloodPoint","solo":0.25,"soloAssumed":true,…}` | one pool for every boss field: co-op = `bosses[id].bloodPoint[difficulty]` whatever the number of alive players; `aliveScaling: true` would scale it × alive / `aliveFull` (巴哈姆特 12294 "隊友變少，最後boss血條也會變少" — one community note, no proportion: off until confirmed, the proportion [ASSUMED, flagged `aliveAssumed`]); solo = × `solo` [ASSUMED, flagged]. `GameData.bossPoolHp(bossId, aliveCount)` / `bossPoolShare` implement it (DESIGN §20.10) |
| `upgradePrices` | `[5,8,11,12,13]` | base price L1→2 … L5→6 (−1 per round start, floor 0, reset after upgrade) |
| `maxShopLevel` | `6` | |
| `shopSlots[level]` | `{"1":{"chess":3,"item":1},…}` | operator + item slots per shop level |
| `levelTagColors[level]` | `"#434343"` | UI |
| `stages` | `["act1autochess_m02",…]` | active stages allowed (pick by `stages[id].weight`, 50 each): 标准 FUNNY (and training) = `act1autochess_m01` 战场#01 only; 险境 NORMAL = the 8 active stages; 绝境 HARD / 终极 ABYSS = 7 (no 战场#01) — official mode data |
| `bossWeights` / `hiddenBossWeights` | `{"boss_1":6,…}` / `{"boss_8":50,…}` | weighted boss picks |

`rounds[r]`:

| Field | Example | Meaning |
|---|---|---|
| `template` | `"act1autochess_03"` | wave template (`waves.json`) for non-boss rounds; `null` for boss rounds |
| `bossTemplates` | `{"boss_1":"act1autochess_h07_01",…}` | boss rounds: template per bossId (solo uses `_s`) |
| `combatTimeLimit` | `55` | **real** seconds (= template `maxPlayTime`) of the forced-2× battle: the Battle / 联防 limit is 2 × this in game seconds (`gamedata.js combatTimeLimit`, `config.combatTimeScale` default 2; docs/BALANCE.md §2.1); `null` for boss rounds (no hard stop) |
| `levelMaxPlayTime` | `120` | raw `maxPlayTime` of the (first) template in real seconds; boss rounds: the Final Assault / Hidden Core countdown (`m.public.deadline`, `gamedata.js bossLevelTime`) — not a hard stop, the battle goes on |
| `prepTime` | `65` | multi/training prep timer (real seconds); **`null` for solo** (untimed in 下半) |
| `prepTimeData` | `300` | official `normalPhaseTime` (optional "timed solo") |
| `isSpPrepare`, `isBoss`, `isHidden` | | 机变 before prep / leader round / 隐秘核心 |
| `bossOvertimeAfter` | `150` | boss rounds: team LP −1 per **real** second after this many real seconds (= 300 game s on the 2× field clock; `m.public.overtimeAt`) |

### 1.2 `economy`

| Field | Example | Meaning |
|---|---|---|
| `income` | `[0,4,5,6,…,12]` | index = round (index 0 unused): `min(3+r, 12)`; `incomeCap` 12, `incomeCapAlternative` 10, `incomeAssumedAfterRound` 3 |
| `leftoverFundsLost`, `leftoverFundsKeptByBands` | `true`, `["band_cannot"]` | |
| `chessPrice[tier]` / `chessSell[tier]` | `{"normal":2,"golden":2}` / `{"normal":1,"golden":1}` | |
| `chessStatus[tier]` | `{"normal":{"phase":1,"level":55,"skillLevel":4,"equipLevel":0,…},"golden":{…}}` | training status per tier |
| `refreshPrice` | `1` | |
| `freeze` | `{"scope":"allUnsoldSlots","price":0,"consumedAtRoundStart":true,"refreshWhileFrozenRerollsAll":true,…}` | one toggle freezes all unsold slots |
| `shopClearedAtCombatStart` | `"unfrozenSlots"` | |
| `itemSellable`, `itemDestroyRefund` | `false`, `0` | items can only be destroyed |
| `benchSize`, `tempSize`, `deployCap`, `storeCntMax` | `10`, `5`, `8`, `6` | |
| `equipPerChess`, `maxArtsPerRound` | `2`, `2` | |
| `poolCopies[tier]` + `poolCopiesOverrides` | `{"1":12,"2":14,"3":18,"4":16,"5":8,"6":5}`, `{"chess_char_6_11_a":4}` (缪尔赛思) | shared pool copies per base chess |
| `goldenCopies`, `mergeCount`, `mergeCountOverrides`, `itemMergeCount` | `3`, `3`, `{"chess_char_2_11_a":2}` (风丸), `2` | |
| `rewardOffer` | `{"count":3,"tierOffset":1,"maxTier":6,"price":0,…}` | merge reward: 3 **different** free chess of tier `min(shopLevel+1,6)` (a short tier tops up from the tier below; `PlayerState.pushRewardOffer`, user playtest #6 item 19) |
| `handFillOrder` | `"rightToLeft"` | |
| `shopOdds` | `{"model":"copyWeighted",…}` | [ASSUMED] roll model |
| `borrowCount`, `fallbackBondId`, `defaultBandId`, `defaultStartLp` | `20`, `"emptyShip"`, `"band_bldsk"`, `28` | |

### 1.3 Other global keys

| Key | Example | Meaning |
|---|---|---|
| `lpCapPerRound` | `10` | max LP lost per player per normal round |
| `bossOvertimeAfter`, `bossOvertimeDrainPerSec` | `150`, `1` | official `bossTurnHpReduceTime`: from 150 **real** s of a boss round the merged team LP loses 1 per whole real second (`gamedata.js bossOvertimeDue`; first point at 151 s) |
| `bossHpScale` | `{"formula":"co-op: bloodPoint[difficulty] — one pool for every field …","coop":1,"solo":0.25,"soloAssumed":true,"aliveScaling":false,"aliveFull":4,"aliveAssumed":true,…}` | global form of the mode rule |
| `hiddenCore` | `{"single":350,"multi":1200,"minTeamLpExclusive":1,"difficulties":["NORMAL","HARD","ABYSS"],"checkedAfterRound":14}` | Σ activated layers must be **>** threshold and LP **>** 1 |
| `dp` | `{"init":10,"perSec":1,"max":99}` | |
| `unite` | `{"maxHelpers":2,"helperOrder":"unitsOnField>activeBond>undownedUnits; pair: unitsOnField>activeBond>activeLayers>undownedUnits, first = right field (PRTS 帮助)","layerGainsEnabled":false,"templates":{"1":"act1autochess_escaped_single","2":"act1autochess_escaped_multi"},…}` | 联防; `helperOrder` documents the rule `server/match/unite.js helperOrder` implements (research 08 §5; ties → seat) |
| `finalAssault` | `{"pairing":"seatOrderPairs","oddPlayerAlone":true,"movableBossPerAlivePlayerSide":true,"layerGainsEnabled":false}` | |
| `timers` | `{"infoCheck":25,"infoCheckHint":5,"bandDraft":50,"bandDraftHint":15,"bandTurn":30,"battleCheck":3,"spFirst":30,"spTurn":16,"soloPrepTimeData":300,"soloSpTimeData":150,"chatCd":1,"chatBubble":3,"broadcastDelay":1,"enterSteps":[…]}` | seconds |
| `bans[difficulty]` | `{"core":3,"addon":4}` (FUNNY `{0,1}`) + `rule` | per-match disabled-bond draw (research 01 A2) |
| `bandDraft` | `{"skipsPerPlayer":1,"order":"random","duplicatesAllowed":true,"timeoutBandId":"band_bldsk"}` | |
| `titles[]` | `{"id":"comment_1","picId":"comment_icon_1","name":"卫戍之星","stat":"bossDamage","rule":"max","onlyOnWin":true,"text":"…"}` | 评语 + [ASSUMED] criteria; `titleRule` explains assignment |
| `tips[]` | `{"tip":"只有在联合模拟中才能获得奖杯","weight":50}` | gameTipsList |
| `broadcasts[]` | `{"id":"comment_boss_hit_1","type":"BOSS_HIT","priority":30,"text":"{0}博士对敌方领袖造成的伤害超过20%!","textRaw":"<@ba.vup>{0}博士</>…","params":["0.2"]}` | `{0}` player, `{1}` operator/level, `{2}` amount |
| `trophies` | `{"byRoundsPassed":[{"maxRound":4,"FUNNY":0,…},…],"hiddenCore":{…},"multiOnly":true,"medals":[{"count":0,"iconId":"trophy_level1_icon"},…]}` | |
| `roundScores[]` | `{"round":4,"score":50}` | |
| `rewards` | `{"itemId":"act2autochess_token_chess","baseByRoundsPassed":[{"round":1,"count":10,"dailyPoint":10},…],"formula":"…","difficultyFactor":{…},"modeFactor":{…}}` | 卫戍认证 |
| `constants` | `{"maxLevelCnt":15,"bossTrailerStartRound":3,"singleReconnectTime":86400,…,"pingConds":[…]}` | misc official constData; `singleReconnectTime` (s) = how long a dropped **solo** run stays resumable (server/lobby.js; co-op keeps the 10-minute window) |

---

## 2. `chess.json` — `{ [chessId]: Chess }` (266 = 133 normal + 133 golden)

112 are `visible` (non-hidden, non-DIY) normal chess: per tier 16/17/19/22/19/19. 17 are `isHidden` (retired
上半 entries or effect-only such as `chess_char_1_15_a` 盟约·辅助干员 from band Pith); 4 are DIY (甄选) slots.

| Field | Example | Meaning |
|---|---|---|
| `chessId`, `baseId`, `goldenId`, `isGolden` | `"chess_char_1_01_b"`, `"chess_char_1_01_a"`, `"chess_char_1_01_b"`, `true` | normal/golden pair |
| `tier` | `1` | 阶 I–VI (shop tier) |
| `identifier`, `shopSortId` | `133`, `1` | official ordering |
| `isHidden`, `isDiy`, `visible` | | `visible = !isHidden && !isDiy` (only visible chess enter the shop pool) |
| `chessType` | `"PRESET"` | `PRESET` / `NORMAL` / `DIY` |
| `charId` | `"char_498_inside"` | operator (null for DIY) |
| `name`, `appellation` | `"隐现"`, `"Insider"` | |
| `rarity` | `5` | stars 1–6 |
| `profession`, `subProfessionId`, `subProfessionName`, `position` | `"SNIPER"`, `"fastshot"`, `"速射手"`, `"RANGED"` | |
| `placement` | | not stored. A MELEE chess may stand on a 高台 only when it is elite 歌蕾蒂娅 (`char_474_glady`, `isGolden`) carrying HOK-Y 淡金坠饰 (`uniequip_003_glady`), decided at place time from the loadout (`shared/highGround.js`, `board.js placeClass`). The trait 「可以放置于远程位」 is not read. Owner's decision 2026-10-04; §22.6's `placement: "all"` is gone. `position` stays MELEE for the battle |
| `nationId` | `"laterano"` | |
| `bonds[]` | `["lateranoShip","swiftShip"]` | bondIds (→ `bonds.json`) |
| `garrisonIds[]` | `["garrison_16_b"]` | 特质 (→ `garrisons.json`); first = displayed trait |
| `price`, `sellPrice` | `2`, `1` | |
| `upgradeNum`, `upgradeChessId` | `3`, `"chess_char_1_01_b"` | copies needed to merge (风丸 2; golden 0) |
| `status` | `{"phase":2,"level":50,"skillLevel":7,"equipLevel":1}` | training status used for all numbers |
| `stats` | `{"maxHp":1421,"atk":508,"def":167,"res":0,"cost":15,"blockCnt":1,"bat":1,"aspd":100,"respawnTime":80,"spRecovery":1,"hpRecoveryPerSec":0,"moveSpeed":1,"tauntLevel":0,"massLevel":0,"deployLimit":1,"deckStack":0}` | keyframes linearly interpolated at `status`, hp/atk/def/cost/block/respawn rounded; **golden includes the module attribute bonus**. `aspd` 100 = base (module attack_speed added). Talent stat boosts are NOT folded in. |
| `immunities` | `{"stun":false,"silence":false,"sleep":false,"frozen":false,"levitate":false}` | |
| `rangeId`, `rangeGrid` | `"3-3"`, `[[1,0],[1,1],…]` | attack range at `status` |
| `dmgType` | `"phys"` | `phys` / `arts` / `heal` (derived, see §2.1) |
| `attackKind` | `"ranged"` | `melee` / `ranged` / `heal` / `none` |
| `projectile` | `"arrow"` | `arrow` (phys ranged) / `bolt` (arts ranged) / `orb` (heal) / `none` |
| `canHitFly` | `true` | |
| `targetPriority` | `"fly"` | from trait text: `fly` (优先攻击空中单位), `lowestDef` (防御力最低), else `null` |
| `trait` | `{"desc":"优先攻击空中单位","descRaw":"…","bb":{"atk_scale":1.1},"bbStr":{},"rangeGrid":null,"moduleDesc":"攻击空中单位时攻击力提升至110%","moduleDescRaw":"…"}` | profession trait (+ golden module trait upgrade merged into `bb`; `rangeGrid` = trait-effect area, e.g. 散射手 front row — **not** the attack range) |
| `skill` | see below | default skill at `status.skillLevel` (normal 4, golden 7) |
| `skills[]` | `[{…skill record…, "index":0, "isDefault":false}, {…, "index":1, "isDefault":true}]` | **loadout choices** (DESIGN §16): every skill unlocked at `status` (E1 ⇒ S1–S2, E2 ⇒ S1–S3; the default is always listed), same shape as `skill` + `isDefault`, at the chess skill level, `trigger` resolved **for that skill index** (§2.2). The `isDefault` entry equals `skill` |
| `modules[]`, `statsBase`, `traitBase`, `talentsBase` | see §2.2 | golden chess with `equipLevel > 0` only: selectable modules + the no-module base they apply to |
| `talents[]` | `{"index":0,"name":"火力支援","desc":"…","descRaw":"…","bb":{"self_ammo":3,"duration":20,"ally_ammo":1},"bbStr":{},"rangeGrid":null,"tokenKey":null,"hidden":false,"fromModule":false}` | best unlocked candidate at `status` (potential 0); golden: module talent upgrades applied (`fromModule`); module data-only talents have `name:null, hidden:true`. A module upgrade of an existing talent **merges** blackboards (module keys win, base keys it does not restate are kept — e.g. 宴 keeps `min_attack_speed`; 仇白's upgrade adds `atk_scale_t` next to the old `atk_scale`: prefer the key the text uses). Module parts flagged `isToken` are **not** applied to the operator; they upgrade its summons (tokens.json variants). `containerTokenKey`: the official talent token id when it is a container missing from character_table (凛御银灰), `tokenKey` then holds the default skill's token |
| `tokens[]` | `["token_10028_vigil_wolf"]` | summons (→ `tokens.json`): displayTokenDict + default-skill `overrideTokenKey` + talent `tokenKey`; `tokens.json → variants[chessId].sources` tells which (a `display`-only token is not produced by this chess's default skill or talents) |
| `module` | `{"id":"uniequip_002_inside","name":"“最初的惊喜”","type":"MAR-X","level":1,"active":true}` | active only on golden chess |
| `assets` | `{"avatar":"char_498_inside_2","portrait":"char_498_inside_2","spine":"char_498_inside","skillIcon":"skchr_inside_2","subProfIcon":"sub_fastshot_icon"}` | asset **ids** (URLs in `data/assets.json`); golden uses the E2 art when it exists |
| `diyRequirement` | `"TIER_6"` | DIY only |

`skill`:

| Field | Example | Meaning |
|---|---|---|
| `skillId`, `iconId`, `name`, `level`, `index` | `"skchr_inside_2"`, `"skchr_inside_2"`, `"“解决麻烦”"`, `7`, `1` | `index` = character skill slot |
| `desc`, `descRaw` | `"攻击力+100%，…攻击装有14发弹药…"` | placeholders resolved |
| `skillType` | `"MANUAL"` | `MANUAL` / `AUTO` / `PASSIVE` |
| `durationType` | `"AMMO"` | `NONE` / `AMMO` |
| `duration` | `0` | seconds (0 = instant/ammo) |
| `spType` | `"INCREASE_WITH_TIME"` | also `INCREASE_WHEN_ATTACK`, `INCREASE_WHEN_TAKEN_DAMAGE`, `ON_DEPLOY` (passive, no SP) |
| `spCost`, `initSp`, `maxChargeTime`, `increment` | `20`, `10`, `1`, `1` | `maxChargeTime > 1` ⇒ charges |
| `bb`, `bbStr` | `{"atk":1,"base_attack_time":-0.3,"attack@trigger_time":14}` | kit input (DESIGN §5.6) |
| `rangeId`, `rangeGrid` | `null` | skill range override |
| `prefabId`, `overrideTokenKey` | | |
| `trigger` | `{"rule":"DEFAULT","rawRule":"DEFAULT","customRangeGrid":null}` | auto-cast rule (the official 技能策略, PRTS 卫戍协议/帮助 §作战阶段 技能操作; §2.2). `rule` ∈ `DEFAULT` (basic strategy), `SKILL_RANGE` (a MANUAL skill with a 技能范围 of its own: `customRangeGrid` = its `rangeGrid`, `rawRule` `DEFAULT` — no official row), `TAKE_DAMAGE` (every MANUAL 重装 skill but seven: 深巡 / 雷蛇 S2, 号角 S2 / S3 and 灰毫 S1 / S2 are `DEFAULT` with `rawRule` `TAKE_DAMAGE` — a deliberate deviation, `tools/build-data.mjs TRIGGER_DEVIATIONS`, DESIGN §21.29 — and 余 S2 is `SKILL_RANGE` with `rawRule` `TAKE_DAMAGE` and `customRangeGrid` its x-1, DESIGN §22.10), `SP_FULL` (official `ALWAYS`: 执旗手 / 战术家 / 吟游者 MANUAL skills), `CUSTOM_RANGE` (official `CUSTOM_RANGE_SEARCH_ENEMY`, uses `customRangeGrid`), `SEARCH` (解放者 / 阵法术师 MANUAL skills, 安洁莉娜 S2/S3), `MLYSS_WTRMAN` (缪尔赛思), `GDGLOW_SKILL_2` (荒芜拉普兰德, 纯烬艾雅法拉 S3: "全场存在可选目标时释放技能"). |

### 2.1 Combat classification heuristic (`dmgType` / `attackKind` / `projectile` / `canHitFly`)
- `dmgType`: MEDIC (except `incantationmedic`) and `bard` → `heal`; trait text containing 法术伤害 or profession CASTER → `arts`; else `phys`.
- `attackKind`: `bard`, `phalanx`, `librator` → `none` (no normal attack); heal → `heal`; position RANGED or melee sub-professions with a ranged normal attack (`lord`, `fortress`, `shotprotector`, `agent`, `hookmaster`) → `ranged`; else `melee`.
- `canHitFly`: ranged attackers unless the trait says 地面敌人 (投掷手) or the sub-profession is `fortress` (要塞: 灰毫, 号角 — DESIGN §22.13); `skywalker` (蒂比) true.
- These are defaults for the generic engine; kits may override.

### 2.2 Loadout choices: skills & modules (DESIGN §16)

Before a match the player may pick, per base chess, the equipped **skill** (any index legal for both the normal and the
elite record — `shared/protocol.js loadoutOptions`) and, for the elite, the **module** (or none). The data carries
everything needed to resolve a unit for `(chessId, skillIndex, moduleId)` (`simdata resolveLoadout / loadoutRecord`,
`DataSource.getChess(id, loadout)`):

- `skills[]` — see the table above. Triggers per skill (`tools/build-data.mjs resolveTrigger`): charId rows (exact
  `skillIndex`, or −1 = every skill) → subProfession rows → profession rows. The class rows apply to **every skill
  index** — PRTS names whole classes ("重装干员", "先锋-战术家、先锋-执旗手、辅助-吟游者分支干员", "近卫-解放者、术师-阵法术师
  分支干员"; a phalanx never attacks with its skill off, so the row must cover 薄绿's default S2) — but only to **MANUAL**
  skills: an AUTO skill keeps its own rule (DEFAULT; kits add a base-game rule where needed, e.g. 古米 S1). Then a
  MANUAL operator skill whose `rangeId` is a 技能范围 — its description is not an attack-range change ("攻击范围扩大 /
  改变 / 缩小 / 缩短", "攻击距离+N / 加长 / 缩短") — is `SKILL_RANGE` with `customRangeGrid` = its `rangeGrid`; summons keep
  DEFAULT. `customRangeGrid` of `CUSTOM_RANGE` from `skillRangeDict[skillId]`. (Research 03 Addendum C1 read the rows'
  `skillIndex 0` as "skill 1 only" after BWIKI's transcription; superseded by user playtest #6.)
- `modules[]` (golden, `equipLevel > 0`): every **ADVANCED** `uniequip` of the character (the INITIAL `uniequip_001_*`
  is "no module" = choice `'none'`), in official order, at the chess `equipLevel` (1, T6: 3):

| Field | Example (`chess_char_6_11_b`) | Meaning |
|---|---|---|
| `uniEquipId`, `name`, `typeName`, `typeIcon`, `icon` | `"uniequip_003_mlyss"`, `"落叶四季"`, `"TAC-Y"`, `"tac-y"`, `"uniequip_003_mlyss"` | |
| `isDefault`, `level` | `false`, `3` | default = `defaultUniEquipId` (= `module.id`) |
| `attr` | `{"maxHp":170,"atk":28,"def":28}` | flat stat additions (stat field names): `stats = statsBase[f] + attr[f]` (float-noise cleaned) |
| `traitOverride` | `{"desc":"…提升至165%","descRaw":…,"bb":{"atk_scale":1.65},"bbStr":{},"rangeGrid":null,"moduleDesc"?:…}` \| `null` | the full trait with this module; `null` ⇒ `traitBase` |
| `talentChanges[]` | `{"talentIndex":1,"name":"开源节流","desc":…,"descRaw":…,"bb":{"cost":-2,"runtime_cost":-1},"bbStr":{},"rangeGrid":null,"tokenKey":null,"hidden":false}` | talent additions/overrides (`talentIndex` −1 = new hidden data-only talent); applied to `talentsBase` with the build's merge rule (`simdata composeTalents`: override of an existing index merges blackboards, module keys win) |

- `statsBase` / `traitBase` / `talentsBase` — the golden record **without** any module (`stats` / `trait` / `talents`
  keep the default module, unchanged). `test/data.test.js` proves that composing the default module onto the base
  reproduces `stats`, `trait` and `talents` exactly for every golden chess.
- Module-less goldens (蒂比, 凛御银灰): `modules: []`, base = own values. Normal chess have none of these fields.
- Module parts flagged `isToken` and the per-token attribute blackboards go to the summons: `tokens.json →
  variants[owner].byModule` (§14). Module choices never change the combat classification (`dmgType`…; the build warns
  if one ever would).

---

## 3. `bonds.json` — `{ [bondId]: Bond }` (23 bonds, 8 core)

| Field | Example (`deputShip`) | Meaning |
|---|---|---|
| `bondId`, `name`, `identifier` | `"deputShip"`, `"助力"`, `14` | |
| `isCore`, `bondType`, `bondOrder`, `powerIdList` | `false`, `"REGULAR"`, `2`, `[]` | core = `isPower` (SEASON); `powerIdList` = nation/group ids for DIY bond derivation |
| `iconId` | `"icon_deputShip"` | |
| `activeCount` | `2` | official activation count |
| `thresholds` | `[2,3]` | ascending member counts that raise the tier (tier = number of thresholds reached). yan `[3,6,9]`, egir `[3,5]`, sunt `[2,5]`, solo `[1]` |
| `maxCount` | `null` (solo `1`) | `count_threshold_downward`: active only while `count ≤ maxCount` |
| `thresholdTemplate` | `"count_threshold_upward"` | also `_downward` (独行), `_upward_golden` (绝技) |
| `countMode` | `"BOARD"` | `BOARD` (distinct base chess on board), `BOARD_AND_DECK` (+hand: 远见/奇迹/投资人), `BOARD_ALL_CHESS` (绝技: every golden chess on board, duplicates count) |
| `countsHand`, `countsGoldenOnly` | `false`, `false` | convenience flags |
| `activeType`, `isActiveInDeck`, `noStack`, `weight`, `maxInactiveBondCount` | `"BATTLE"`, `false`, `false`, `10`, `-1` | `weight` 0 ⇒ never drawn for per-match bans |
| `layerMilestones[]` | `[{"layer":25,"mode":"every","effect":"bond_layer_added_reward_equip"}]` | layer-based powers: `reach` (while L ≥ layer), `every` (each multiple), `first` (latched once) |
| `desc`, `descRaw` | | bond panel text |
| `effectId`, `effectName`, `effectDesc`, `effectDescRaw` | `"bondeffect_deput"`, …, `"所有干员防御力+{0:0%}（受层数影响）…"` | in-battle text with **positional** placeholders |
| `effectDescParams[]` | `[{"index":0,"format":"0%","base":"base_def","perStack":"def_per_stack"}]` | `{i:fmt}` = `bb[base] + bb[perStack] × layers` — layers never exceed 999 (the official `MAX_GARRISON_STACK`, not in any table: shared/constants.js `BOND_LAYER_CAP`, research 11) |
| `bb`, `bbStr` | `{"base_def":0.15,"def_per_stack":0.012,"respawn_time":-0.3,"layer":2,"count":3,"more_layer":4}` | all buffs merged (first wins) |
| `buffs[]` | `[{"key":"env_gbuff_new","bb":{…},"bbStr":{"key":"act1autochess_bond_eff_deput"}}, …]` | exact official buffs (e.g. 萨尔贡 has a second buff valid only with `band_narant`) |
| `baseParams`, `perStackParams` | `["base_def"]`, `["def_per_stack"]` | official descParamBaseList / descParamPerStackList |
| `members[]`, `visibleMembers[]` | `["chess_char_1_06_a",…]` | base (normal) chessIds incl. hidden / only visible |
| `spec` | `{"tiers":[{"need":"…","effect":"…"}],"formulas":{…},"layerGain":"…",…}` | research 02 implementer spec (null without research) |

## 4. `garrisons.json` — `{ [garrisonId]: Garrison }` (249; 43 distinct `effectKey`s)

| Field | Example | Meaning |
|---|---|---|
| `garrisonId` | `"garrison_30_a"` | `_a` normal, `_b` golden version |
| `desc`, `descRaw` | `"<获得时>获得等于当前调度中心等级的【炎】层数（无需激活盟约）"` | |
| `eventType`, `eventTypeDesc`, `eventTypeIcon` | `"SERVER_GAIN"`, `"单次叠加"`, `"icon_bond"` | `IN_BATTLE`, `SERVER_GAIN` 获得时, `SERVER_PREP_START` 进入休整期时, `SERVER_PREP_FIN` 休整期结束时, `SERVER_CHESS_SOLD`, `SERVER_PRICE`, `SERVER_REFRESH_SHOP` |
| `effectType` | `"SERVER_ADD_BOND_METHOD"` | |
| `effectKey` | `"SERVER_ADD_BOND_METHOD"` / `"act1autochess_gar_eff_attrByBond"` | handler key: `bbStr.key` (battle runes) else `effectType` |
| `battleRuneKey`, `charLevel` | `null`, `0` | |
| `bb`, `bbStr` | `{"multi":1}`, `{"add_method":"shoplv","bond":"yanShip"}` | |
| `owners[]` | `["chess_char_1_03_a"]` | chess carrying it (includes garrisons referenced by other garrisons, which may have no owner) |

## 5. `items.json` — `{ [itemChessId]: Item }` (115 = 56 EQUIP × 2 + 3 MAGIC)

| Field | Example (`chess_item_1_01_e_a`) | Meaning |
|---|---|---|
| `id`, `baseId`, `goldenId`, `isGolden` | `"chess_item_1_01_e_a"`, …, `"chess_item_1_01_e_b"`, `false` | |
| `trapId`, `iconId` | `"trap_1041_acarm041"` | icon id = trapId |
| `identifier`, `shopSortId` | `267`, `1` | |
| `name` | `"维式重锤"` | |
| `itemType` | `"EQUIP"` | `EQUIP` (equipped, max 2) / `MAGIC` (Arts, dropped on a tile) |
| `tier`, `price`, `hideInShop` | `1`, `1`, `false` | golden price 5 (never sold in shop) |
| `shopExcluded`, `shopExcludedBy` | `false`, `null` / `true`, `"维多利亚盟约每25层 / 洛洛的定制品"` | effect-only items the shop never sells although the official table does not hide them (`tools/build-data.mjs SHOP_EXCLUDED_ITEMS`, sourced: the 4 special 维式重锤 — 战栗 / 坚固 / 加速 / 灼燃 — and 突变细胞; user playtest #4 item 5), normal and golden. `sim/simdata.js isShopItem` (non-golden EQUIP, not `hideInShop`, not `shopExcluded`) is the one predicate of every shop-item draw (the shop's item slot, 道具补给 / 机密商店 cards, `pool_equip_normal` / `_shop_1` / `_kathe` / `_narant`, `Match.rollItemId`): 51 of the 56 normal items; the item card shows `shopExcludedBy` as the source |
| `mergeable`, `upgradeNum`, `upgradeChessId` | `true`, `2`, `"chess_item_1_01_e_b"` | 2 copies → golden; `upgradeNum` 100 = never merges |
| `duration` | `-1` | trapDuration |
| `giveBondId`, `givePowerId`, `canGiveBond` | `"victoriaShip"`, `null`, `false` | 变形同构体 (`canGiveBond`) grants the `giveBondId` of the *other* equipped item |
| `requiresBondId` | `null` / `"yanShip"` | VI-tier bond signature items (research 04) |
| `effectId`, `effectName`, `desc`, `descRaw` | `"eff_acarm041"`, …, `"攻击力+15%"` | |
| `buffs[]`, `params` | `[{"key":"env_gbuff_new_with_verify","countType":"NONE","bb":{"atk":0.15},"bbStr":{"key":"attr_common_global_buff"}}]` | |
| `category`, `kind`, `family`, `implFormula` | `"STAT"`, `"passive"`, `null`, `"ATK% += atk …"` | research 04 (categories: STAT, ON_HIT, SURVIVAL, SP, ECONOMY, RECRUIT, BOND, BOND_GRANT, SET, BOND_SIGNATURE, MAGIC); `implFormula` is overridden by `tools/build-data.mjs ITEM_RULES` where research 04 was wrong (突变细胞; its research entry carries the correction too) |
| `note` | `null` / `"生效时原干员销毁，突变细胞与其他装备退回整备区，可再次配发；随后获得一名高一阶的随机初始干员（最高6阶），进入整备区，需要重新部署"` | a rule the official text leaves out (`ITEM_RULES`, sourced; normal and golden), shown under the effect in the item card — 突变细胞 is not consumed (player feedback after 0.1.0: PRTS 下半 记录 备注 "生效时，原干员销毁…", players re-inject it every round) and its new operator joins the 整备区, the carrier's tile left empty (official footage; PR #2) |
| `rangeGrid` | `[[0,0]]` | Arts area (画卷 `[[0,0],[0,1]]`) |
| `flavor` | | |

## 6. `bands.json` — `{ [bandId]: Band }` (40)

| Field | Example | Meaning |
|---|---|---|
| `bandId`, `sortId`, `name`, `iconId` | `"band_bldsk"`, `1`, `"华法琳"`, `"icon_bldsk"` | |
| `modeTypeList` | `["LOCAL","SINGLE","MULTI"]` | |
| `totalHp` | `28` | starting LP (20–45) |
| `effectId`, `effectName`, `desc`, `descRaw` | `"aceffect_band_21"`, `"重点监护"`, `"【重点监护】开始作战时…"` | |
| `buffs[]`, `params` | `[{"key":"prep_finish_char_bond_add_layer","bb":{"layer":2},"bbStr":{}}]` | |
| `victorCount`, `rewardModulus`, `unlockDesc` | `3`, `1`, `null` | |
| `bondIds` | `["lateranoShip"]` (潘格尼尼) / `[]` | the bonds the strategy is built around (`shared/bandBonds.js`: the bond names in <…> of its text — the official note "在<X>部分干员缺席时体验可能不完整" among them — and the bond ids / bond pools of its blackboards, `pool` → choices.json `pools[pool].bond`); 9 bands are tied. The bot never picks, and the strategy draft marks 本局禁用, a band whose bond the mode switches off (DESIGN §21.26) |

## 7. `effects.json` — `{ [effectId]: Effect }` (361: every effect of the season)

Types: `BAND_INITIAL` 41, `BOND` 23, `EQUIP` 115, `ENEMY_GAIN` 129 (悬赏), `BUFF_GAIN` 43 (战术决策), `ENEMY` 6 (`aceffect_enemy_*` global modifiers), `CHAR_MAP` 4.

| Field | Example | Meaning |
|---|---|---|
| `effectId`, `effectType`, `name` | `"aceffect_band_21"`, `"BAND_INITIAL"`, `"重点监护"` | |
| `desc`, `descRaw` | | |
| `counterType`, `continuedRound`, `decoIconId`, `enemyPrice` | `"NONE"`, `-1`, `null`, `0` | `enemyPrice` = bounty coins |
| `buffs[]` | `{"key":"…","countType":"NONE","bb":{…},"bbStr":{…}}` | |
| `params` | `{"layer":2}` | merged convenience view |

## 8. `choices.json` — 机变 draft data

| Key | Example | Meaning |
|---|---|---|
| `events[id]` | `{"id":"enemy_initial_1","choiceType":"BOUNTY_HUNT","effectType":"ENEMY_GAIN","name":"悬赏决策","desc":"…","color":"#35d8b4","family":"bounty","solo":false,"training":false}` | 109 official choice events; `_s` = solo copies; `usedBy` on events opened by items (`hunter_band_1` ← 教鞭 / “神秘顾客”) |
| `families` | `{"bounty":{"name":"悬赏决策",…},"supply":{…},"shop":{…},"tactic":{…}}` | 悬赏决策 / 道具补给 / 机密商店 / 战术决策; `desc` = the overlay header after the name, the official event text (战术决策 "进行协同调整，做好迎战准备。", as on the official screens and in effectChoiceInfoDict `buff_select_*`) |
| `format` | `{"multi":{"cards":6,"pickOrder":"random","firstPickSec":30,"otherPickSec":16,"onTimeout":"autoPickRandom","eachPlayerPicks":1},"solo":{"cards":3,"timer":null},"opensAfterIncome":true}` | |
| `cards.bounty[]` | `{"effectId":"enemyeffect_10_4","name":"悬赏·飞行I","tier":1,"coin":1,"payout":"kill","rounds":2,"multiRound":false,"enemyKey":"enemy_1005_yokai","count":1,"adds":[…],"draft":true,"draftExcluded":null,"draftPool":"initial","series":10}` | `payout` `kill` (killer gets coins, 联防 helpers too) / `perfect` (chooser's own phase perfect); `rounds` = battles affected (99 = all remaining); `tier` from the I/II/III suffix (else coin value); `enemyKey` = the effect's `enemy_id` (fixed per card; the title only names category and tier); `draft` = offered by a 悬赏决策 draft (86 cards); else `draftExcluded` `perfect` (战术特训: "仅由法术教鞭生成" — the 教鞭 Art's cards; 20) / `hidden` (鸭爵 / 高普尼克 / 流泪小子 / 圆仔; 4) / `unseen` (in none of the 59 official bounty drafts of the user's 66 screenshots: the 7 multi-round cards, enemyeffect_3_*, the boss bounties of no seen R9 group; 19, [ASSUMED] not offered) — build-data `bountyDraftExclusion`, `server/match/choices.js draftBounty`, user playtest #6 item 4, player feedback after 0.1.0 report #2; `draftPool` = the kind of draft that offers it: `initial` (R3: the 42 "接下来两场作战" cards), `boss` (R9: 19 boss bounties + 源石虫·特训), `hunter` (R11: the faction _7 / _8 and 特异 series 16 "下场战斗" cards, 24), null when not drafted; `series` = N of `enemyeffect_N_M` (null otherwise) |
| `cards.tactic[]` | `{"effectId":"map_m01_1","name":"模拟战场演变·模式一","kind":"terrain","stageId":"act1autochess_m01","team":false}` | `kind` `ally` / `enemyDebuff` / `terrain` (only for the match stage); `team` = also given to teammates. A 战术决策 draws each card on its own, with replacement, so the same card can be offered twice (official match 7 R11: 补给 ×2; `tacticDraft`) |
| `bountyDrafts[kind]` | `{"initial":{"events":[…],"slots":10,"pick":"slot","groups":[{"cards":[…6],"seen":[1,3,5,9,17]},…],"rule":{"series":[10,…,15,20],"tiers":[1,1,1,2,2,3],"perSeries":2,"prefer":["enemyeffect_10_6","enemyeffect_20_6"]},"count":6},"boss":{"events":[…],"slots":6,"pick":"seen","groups":[{"cards":[…9],"seen":[7,…,21],"weights":[12,13,…]},…],"count":6},"hunter":{"events":[…],"slots":7,"pick":"slot","groups":[{"cards":[…7],"seen":[1,6,21,22],"weights":[…]},{"cards":[…6],"open":1,…},…],"rule":{"size":7,"onePerSeries":[10,…,15],"maxSeries16":2,"giants":[…],"cards":[…]},"count":6}}` | the official 悬赏决策 card lists, read from 66 screenshots of 22 official co-op 绝境 / 终极 matches (player feedback after 0.1.0 report #2; build-data `BOUNTY_INITIAL_SETS` / `BOUNTY_BOSS_GROUPS` / `BOUNTY_HUNTER_GROUPS`, readings in `test/fixtures/official-bounty-drafts.json`, `seen` = its match numbers). A draft = one group (`pick` `slot`: one of `slots` events, uniform — a seen group or, for an unseen event, a list built by `rule`; `seen`: a group by the matches it came in), then `count` different cards of its `cards` drawn one by one by `weights` (1 + the drafts of the group the card showed in; a rule-built card 1). `initial`: 9 seen sets of 6 (all six shown), the 10th by `rule` — tiers I I I II II III, ≤ `perSeries` a series, the III one of `prefer` (the two-battle cards no draft showed) [ASSUMED]; `boss`: the 6 groups of 9, 9, 9, 9, 8 and 6 cards (one per bossInitial event; 9 where three named bosses came; the three single-draft groups completed only with the base cards they lack [ASSUMED] — match 4's base-only group may instead be a draft of the 泥岩 group), the 鼠王 group in 14 of 22 matches — every one on the dark grey board — so picked by `seen` [ASSUMED: the per-match cause is open]; `hunter`: the 7 seen lists of 7, `slots` 7 so one of them uniform, so no list is built from nothing [ASSUMED] (which of the 15 events R11 fires is open: by the blocks of effectChoiceInfoDict it would be bounty_hunter_8..15, beside artifact_paid_4 / 5 and hardbuff_select; with 8 events an unseen list would come in about 1 R11 bounty draft in 8); `open` = cards still unseen, drawn by `rule`: a giant for a list without one, else tier I / II cards, one per `onePerSeries` series, ≤ `maxSeries16` of 16_9..12 [ASSUMED] — the only way 12_8 / 16_2 / 16_6 (in no draft) come, about 1 R11 bounty draft in 15 |
| `schedule[modeId]` | `{"spRounds":[3,6,9],"rounds":{"3":{"families":[{"family":"bounty","weight":50},…],"cards":6,"supplyTiers":[1,4],"bountyDraft":"initial","events":{"bounty":[…],"supply":[…],"shop":[…],"tactic":[…]},"assumed":true}}}` | research 01 A4 defaults: pick a family by weight; `supplyTiers` = item tier window for 道具补给; 机密商店 draws `shopDraft` at its `rounds` (R11), else any normal shop item of tiers I–VI per card (duplicates allowed); `bountyDraft` = the `bountyDrafts` kind of the round's 悬赏决策 (R3 / 险境 R6 `initial`, R9 `boss`, R11 `hunter`); 绝境 / 终极 R11 = 悬赏决策 14 / 机密商店 4 / 战术决策 4 (the official co-op R11s of 22 matches, no 道具补给; weights = those counts [ASSUMED]; solo takes the same weights [ASSUMED: no solo screenshot — extrapolated from co-op, the data has solo R11 悬赏决策 events `bounty_hunter_*_s`]); `events` = the official event ids of that kind (`enemy_initial_*`, `bossInitial_*`, `bounty_hunter_*`), usable as the phase header |
| `shopDraft` | `{"rounds":[11],"slots":[{"6":1},{"6":1},{"5":1},{"coin":1},{"3":1,"4":2,"5":3,"coin":2},{"3":1,"4":2,"5":3,"coin":2}],"coin":"chess_item_1_03_e_a","itemWeights":{"chess_item_6_09_e_a":5,…},"seen":[2,4,5,8],"count":6}` | the official 机密商店 (R11 of matches 2, 4, 5, 8; build-data `SHOP_DRAFT`; the user: "机密商店按官方改成可以重复吧"): six slots, each drawn on its own — with replacement, so an item can come twice (official: 盟约之币 ×2, 变形同构体 ×2) — a tier (or `coin` = 盟约之币) by the slot's weights, then an item of that tier by `itemWeights` (1 + the official cards it showed on; unlisted 1). Every official shop: exactly two tier VI, ≥ 1 V, ≥ 1 盟约之币, no other tier I / II; the slot split and the weights [ASSUMED]; solo 3 of the 6 [ASSUMED]; only at `rounds` (R11 = 绝境 / 终极, the rounds of the screenshots) — the earlier 机密商店 of 标准 R3 / R9 and 险境 R3 / R6 / R9 (no screenshot; the data's shop events sit in three blocks) keep the previous draw, any normal shop item of tiers I–VI per card, with replacement [ASSUMED]; free (price 0) |
| `tacticDraft` | `{"rounds":[11],"kinds":["ally"],"weights":{"allybuff_select_4":4,…},"seen":[7,9,18,20],"count":6}` | the official 战术决策 (R11 of matches 7, 9, 18, 20; build-data `TACTIC_DRAFT`; the user: "战术决策也按官方改成可以重复吧"): six cards, each drawn on its own — with replacement, so a card can come twice (official: 补给 ×2 in match 7; the other three drafts show six different cards). All 24 official cards are `ally` cards (no 排斥 / 责罚 / 裁决, no 模拟战场演变; four drafts without a debuff: about 0.04 % for the previous draw, 6 different cards of the 26 ally + 9 debuff cards), and 列装 / 财富 / 补给 / 整备 / 升华 made 12 of them (uniform: about 4.6), so at `rounds` (R11 = 绝境 / 终极, the round of the screenshots) only the cards of `kinds`, each by `weights` (1 + the official cards it showed on; unlisted 1) [ASSUMED: the weights; no terrain card at R11 — the maps of the 4 matches are unknown]; each card independent, no slots like `shopDraft` [ASSUMED, open: all 4 drafts hold a 驰援, a 盟誓 and two of 列装 / 财富 / 补给 / 整备 / 升华 — about 3 % under independent draws, a pattern spotted after the fact]; solo 3 [ASSUMED]; other rounds (标准 R3 / R9, 险境 R3 / R6 / R9, 险境 solo R9; no screenshot) every card uniform, terrain cards only for the match stage, with replacement too [ASSUMED]. A card acting only on dead bonds is never offered (`Match.bondLive`). `assumed` lists the assumed parts |
| `pools[poolId]` | `{"kind":"equip","items":[…]}` / `{"kind":"chess","tier":2,"rule":"shopEligible"}` | server-side reward pools referenced by effects (`pool_equip_*`, `pool_chess_shop_N_reward`, `pool_char_later`, …), all [ASSUMED]; `rule:"shopEligible"` = visible/non-hidden entries, `maxTier:"shopLevel"` = ≤ current shop level, `weighted` = `[[id, weight]]`. `pool_equip_vict` (维多利亚, every 25 layers: "获得一件带有随机特殊效果的维式重锤") and `pool_equip_rockr` (洛洛's 定制品; user playtest #4 — the research 04 §8 guess 有限加速器 / 激光发射器 / 护盾无人机 / 双模机械臂 / 蜂鸣器 is superseded) = the 4 special 维式重锤, uniform |

## 9. `enemies.json` — `{ [enemyKey]: Enemy }` (249 keys that can appear)

Collected from all wave templates (spawns, branches, enemyDbRefs), special-enemy entries and pools, bounty
effects, band effects, bosses, placeholders, mode bans, plus summons (`extraEnemyKeyList`) and enemy keys in enemy
blackboards (transitively). Level = `randomEnemyAttributeDict[key].level` (0 for all); the season override level
`level_autochess_enemy_data` is applied (灼藤/元核孽生者 ATK 400, …).

| Field | Example (`enemy_1422_lrsldr`) | Meaning |
|---|---|---|
| `key`, `name`, `level`, `rank`, `handbookIndex` | …, `"萨卡兹枯朽前锋"`, `0`, `"NORMAL"`, `"NAC18"` | `rank` NORMAL / ELITE / BOSS |
| `desc`, `descRaw`, `applyWay` | …, `"MELEE"` | `applyWay` MELEE / RANGED / ALL / NONE |
| `stats` | `{"maxHp":4700,"atk":300,"def":100,"res":40,"moveSpeed":0.8,"bat":3,"aspd":100,"rangeRadius":0,"rawRangeRadius":-1,"blockCnt":1,"massLevel":1,"lpr":1,"hpRecoveryPerSec":0,"elementRes":0,"elementDmgRes":0,"hitRatePhys":0,"hitRateArts":0,"dmgType":"phys","dmgTypes":["phys","arts"],"motion":"WALK","immunities":{…},"otherImmunities":[],"tauntLevel":0}` | level-0 (unscaled). **`rangeRadius` ≥ 0 is the normal-attack radius under the DESIGN §5.5 contract: `> 0` ⇔ the enemy attacks units it is not blocked by; always 0 for `applyWay` MELEE** (melee enemies only hit their blocker; 粉碎攻坚手/宿主士兵/深池方阵步兵 carry an official 1.2–2.5 used by abilities) and negative sentinels become 0. `rawRangeRadius` = the official value. `blockCnt` = block slots it consumes; `lpr` = lifePointReduce (LP cost of a leak; except the 鸭爵 strategy's four swapped-in `_2` enemies — the `round_start_all_player_change_enemy_2` enemylist — which cost 1, not the database's roguelike 0: PRTS 下半/PRTS盟约记录 鸭爵 备注 "进入保护目标点将减少1点目标生命值"; build-data `bandSwapEnemyKeys`); `dmgType` = first handbook damage type (`phys`/`arts`/`heal`/`none`/…), full list in `dmgTypes`. `elementRes` = 损伤抵抗 (official `epResistance` = EP_RESISTANCE, % off every element gauge fill; 10 on 转译基底·α, 0 on every other enemy here) and `elementDmgRes` = 元素抗性 (`epDamageResistance`, % off 元素伤害 — the bursts' HP damage; 0 on every enemy here — newer event enemies of the full database reach 10–15 on both) — PRTS 元素 / 游戏数据基础 and the enemy pages' 损伤抵抗 / 元素抗性 rows. Undefined database fields (`m_defined:false`) holding the zero value fall back to the defaults `lpr` 1, `bat` 1, `aspd` 100, `moveSpeed` 1 (see §15) |
| `abilities[]` | `{"text":"位于源石污染区内时，攻击造成法术伤害","textRaw":"…","format":"NORMAL"}` | handbook ability list |
| `talents` | `{"bb":{"1.hp_ratio":0.2,"1.damage_scale":0.5},"bbStr":{}}` | talentBlackboard |
| `skills[]` | `{"prefabKey":"2","priority":0,"cooldown":50,"initCooldown":0,"spCost":0,"bb":{"hp_ratio":0.02},"bbStr":{"branch_id":"boss_summon_enemy","enemy_key":"enemy_1005_yokai"}}` | `branch_id` → `waves[t].branches` |
| `sp` | `{"type":"INCREASE_WHEN_ATTACK","maxSp":3,"initSp":0,"increment":1}` | enemy_database `spData` of the 22 enemies with SP skills (e.g. 假想敌：黑云 `enemy_9009_acfort`: `INCREASE_WITH_TIME`, `maxSp` 3 = its ammo cap); absent otherwise |
| `notCountInTotal`, `tags` | `false`, `["sarkaz"]` | |
| `be`, `beFactor`, `attrPower`, `isFlyEnemy` | `6620`, `1`, `6620`, `false` | `attrPower` = the official float32 attribute power `P = atk·5 + maxHp + def·3 + res·3` of the **enemy_database** record (season override NOT applied: 灼藤 / 元核孽生者 count with their database ATK) — the input of the replacement count (§10); `beFactor` = `randomEnemyAttributeDict.enemyBattleEffectivenessFactor`; `be` = round(P'/f) on the spawned stats (informative); `isFlyEnemy` = the official movement class |
| `tokenOnly` | `false` | only ever spawned by other enemies (summons / blackboards / level refs) — a token for 联防 routing (research 08 §5) |
| `acTypes`, `acType` | `[]`, `null` | 特训 type(s): FLY/TIMES/ELEMENT/DOT/INVISIBLE/REFLECTION/SPECIAL |
| `templateSlot` | `"N"` | placeholder slot when the key is a template key |
| `summons[]`, `inactiveIn[]`, `seasonOverride` | | spawned enemies; modes banning it; overridden fields |
| `iconId`, `spine` | `"enemy_1422_lrsldr"` | asset ids |
| `hitArea` | `{"w":4.95,"h":2.95,"dx":0,"dy":1}` (`enemy_9013_acstmk`) | **huge units only** (巨型单位, 7 keys: 假想敌：胄 ×2, 假想敌：管 ×2 — the 隐秘核心 one `dx` 1 —, 盐风主教昆图斯, 阿利斯泰尔，帝国余晖, “萨米的意志”): the hit rectangle, `w` tiles along the columns × `h` along the rows, centred on the unit's position moved `dx` columns right / `dy` rows up (sim/body.js; user playtest #5). Not in the game tables (the collider lives in the prefab): `tools/build-data.mjs HIT_AREAS` by `prefabKey`, from PRTS "巨型单位：受击判定区域为长4.95、宽2.95的长方形，向上偏移1.0" and PRTS盟约记录 (the season's 阿利斯泰尔 / “萨米的意志” versions); absent = a point. All 7 are also 自缚 + 无法被阻挡 (PRTS 天赋 — not a data field either: content/bosses.js `SELF_BOUND`) |
| `staticBody` | `true` (`enemy_1005_yokai` 妖怪) | **静态刚体 only** (28 keys: every air unit of the mode except “炎佑” — 妖怪 ×3, 御4, 暴鸰, 法术大师 ×2, 寒霜, 帝国炮火先兆者 ×2, 枯朽之种, 枯朽萃聚使徒, 护障 ×2, 远眺, 愧悔魂灵圣杯, 假想敌：黑云, “斩胄之剑”, “破胄之锤”, 刺胄之弹, 未装配刀片, 防护背心, 冲击式施术单元, 节日气球, “萨科塔之翼 / 之眼 / 昂首” — plus the ground boss 盐风主教昆图斯): pushes and pulls never move it, the skills still hit it (sim `Battle._displaceable`; player report after 0.1.0). PRTS 特殊机制 静态刚体: "该单位的Unity刚体的刚体类型为部分静态（Kinematic）或静态（Static）…无法产生任何速度或移动…※是否为静态刚体与单位的行动方式无关". Not in the game tables (the rigidbody lives in the prefab): `tools/build-data.mjs STATIC_BODIES` by key, from the 天赋 "{{特殊机制|静态刚体}}" of each enemy's PRTS page (every enemy of the file, read 2026-10-03); absent = a dynamic body |
| `modelScale` | `0.5926` (`enemy_1005_yokai_3` 威龙) | official drawn size of the enemy's Spine model relative to the standard (user playtest #6): the battle prefab's transform scale down to its Spine renderer (Graphic × FaceSwitcher × Spine; SkeletonDataAsset.scale is 0.01 for every enemy skeleton) ÷ 0.27, the standard of 1454 of the client's 2147 enemy prefabs (2080 have exactly one Spine renderer) and of the operators' battle skins. The renderer multiplies `UNIT.modelScale` by it (render/units.js `enemyModelScale`). 125 keys (122 prefabs) carry one, from 0.5926 (威龙 0.16; 妖怪 0.7407, 寒霜 0.6667) to 2.2222 (青铜镜 / 青瓷茶器 0.6); absent = 1. Not in the game tables: `tools/build-data.mjs MODEL_SCALES` by `prefabKey`, read from the local client by `tools/local-extract/enemy_scales.py` |
| `attackAnim` | `{"clip":"Attack","dur":1,"hit":0.533}` (`enemy_1019_jshoot` 隐形弩手) | the enemy's attack clip — the one the client plays for its attacks (data/assets.json `anims.attack.loop` of its model, not an Idle stand-in) —, its length (s) and first strike frame (`hits`, the OnAttack event; absent when the clip has none). An unblocked ranged enemy stands for this clip at each attack (sim/ai.js `attackStand`, GitHub #58). 213 keys; absent = no attack clip known (御4, 寒霜, the 岁 relics …: the sim keeps `ATTACK_PAUSE`). Not in the game tables: `tools/build-data.mjs enemyAttackAnim` reads the committed asset manifest (tools/fetch-assets.mjs, from the Spine skeletons) |
| `attackMoves` | `true` | **「不停止移动」 attackers only**: the handbook ability text says it attacks on the move (“十字路口”量产型's 四向攻击) — it never stops to attack (sim/ai.js `attackStand`). No enemy of the mode has it (build-data `attacksOnTheMove`) |

## 10. `factions.json` — special enemies (特训敌人)

| Key | Example | Meaning |
|---|---|---|
| `templateSlots` | `{"N":"enemy_1422_lrsldr","E":"enemy_1427_lrnazg","S":"enemy_1425_lrcmra","NF":"enemy_1005_yokai","EF":"enemy_1042_frostd","SF":"enemy_1040_bombd","T":"enemy_1000_gopro_2","TF":"enemy_1041_lazerd"}` | placeholder keys in wave templates |
| `types[type]` | `{"type":"FLY","name":"特训敌人·飞行","desc":"…","icon":"fly_icon","sortId":2,"typeIdentifier":2,"involveRandom":true,"count":3,"weight":3,"pool":[…],"entries":[…]}` | 7 types |
| `entries[key]` | `{"key":"enemy_1041_lazerd","type":"FLY","weight":10,"firstHalf":true,"fly":true,"N":[{"key":"enemy_10083_hlbird"}],"E":[{"key":"enemy_1005_yokai_2"}],"inactiveIn":[]}` | 67 entries (`specialEnemyInfoDict`); `fly` = the movement class shared by the special, normal and elite keys; `inactiveIn` = modes whose `inactiveEnemyKey` bans the SPECIAL key (attached keys are never filtered) |
| `generation` | `{"specialEnemyNum":3,"maxLevelCnt":15,"fillType":"SPECIAL","typeSlots":{"FLY":3,…},"firstHalfMaxRound":7,"minReplacedEnemyCount":1,"maxReplacedEnemyCount":5,"minActionIntervalRatio":0.05,"beFactors":{…},"placeholders":{"enemy_1422_lrsldr":{"slot":"N","cls":"normal","fly":false},…},"powerFormula":"…","countFormula":"…","timingFormula":"…","notes":[…]}` | parameters of the **official** generator (client `RandomEnemyGenerater`, research 08 §2 — normative) |

The official generator (implemented by `server/match/waves.js`):
1. **Match:** 3 random types (shuffle the 6 `involveRandom` types, keep 3); each owns `typeSlots[t]` (3) of the 15 round
   slots, `fillType` (SPECIAL) the other 6; the slots are shuffled → one type per round. All 15 round picks are drawn
   at match start (weighted entry of that type and half whose SPECIAL key the mode allows; random attached N / E).
2. **Round:** every template SPAWN action whose key is a `placeholders` key becomes the pick's normal / elite /
   special key, or is **skipped** when that key's movement class differs from the placeholder's (ground rounds drop
   NF/EF/SF, FLY rounds drop N/E/S). Its count `n' = clamp(roundHalfEven(f32(f32(f32(n·P(tpl))/f(tpl)) /
   f32(P(new)/f(new)))), 1, 5)` (P = `enemies[k].attrPower`, f = `beFactor`), unit *i* at
   `time + i·max(n·interval/n', 0.05·n·interval)`. Literal keys and the T / TF token keys are kept.
3. **Leader / hidden rounds** use the pick of their own slot (14 / 15; solo 标准 9): only E **or** EF escorts spawn.

## 11. `waves.json` — `{ [templateId]: Wave }` (38 templates)

Non-boss rounds use `act1autochess_01…07`, `h01…h06`; leaders `h07_0X` (+`_s` solo; boss_5 is `act2autochess_h07_05`);
hidden core `h08_0X`; 联防 `act1autochess_escaped_single|multi`; training `tr01/02/04`.

| Field | Example | Meaning |
|---|---|---|
| `id`, `kind`, `solo` | `"act1autochess_03"`, `"normal"`, `false` | `kind` normal / boss / hidden / escaped / training |
| `bossId` | `null` / `"boss_8"` | |
| `maxPlayTime` | `55` | **real** seconds of the forced-2× battle (DESIGN §4; spawn `time`s below are game seconds) |
| `dp`, `characterLimit`, `moveMultiplier`, `bgm` | `{"init":10,"perSec":1,"max":99}`, `8`, `0.5`, `"bat_kazimierz2_2"` | level options |
| `routes[]` | `{"motion":"FLY","start":[9,10],"end":[9,2],"checkpoints":[[9,9],[12,9],…]}` | WALK routes have 0–1 checkpoints (usually the end) ⇒ pathfind between them on the stage grid; `motion:"E_NUM"` (start/end `[0,0]`) = dummy route of a non-SPAWN action (only `ACTIVATE_PREDEFINED` in boss_4 branches) |
| `routes[].steps` | `[{"t":"move","p":[1,17]},{"t":"disappear"},{"t":"wait","s":3},{"t":"appear","p":[5,10]}]` | present only when a route has non-MOVE checkpoints (`move`, `patrol`, `wait` s, `disappear`, `appear` p); authoritative when present |
| `routes[].spawnRandom` | `[0.3,0.3]` | random spawn offset (tiles), optional |
| `extraRoutes[]` | same shape | routes used by `branches` |
| `spawns[]` | `{"time":6,"key":"enemy_1422_lrsldr","count":10,"interval":6,"routeIndex":0,"slot":"N"}` | `time` = absolute game seconds of the first unit; unit i spawns at `time + i·interval`. Optional: `slot` (placeholder N/E/S/NF/EF/SF/T/TF → replace per `factions`), `tag` (`boss` / `part`), `hidden`/`hiddenGroup`, `group`/`pack`/`weight` (random spawn group: `group:"local"` = only on the local side), `unharmful` (counts as killed), `action` (non-SPAWN action, e.g. `ACTIVATE_PREDEFINED` with `key` = device alias) |
| `branches[name]` | `{"boss_summon_enemy":[[{"time":0,"key":"enemy_1005_yokai","count":1,"interval":1,"routeIndex":5}]]}` | script-triggered spawns (`skills[].bbStr.branch_id`, `dragon` = 炎佑, `boss_escaped_walk/fly`, `boss_battle_multi_player` = mirrored boss sharing HP); array of **phases**, times relative to the phase start, `routeIndex` → `extraRoutes`. [ASSUMED] phase *i* runs on the *i*-th trigger (clamped to the last) |
| `overrides[enemyKey]` | `{"enemy_1430_lrrook":{"stats":{"maxHp":60000}}}` | per-template enemy overrides (bosses): partial `stats`, `talents`, `skills` |
| `devices[]` | `{"key":"trap_039_dstnta","alias":"trap_039_dstnta#1","pos":[5,9],"dir":"…","hidden":true}` | template predefines (activated by branches) |
| `totalCount`, `slotCounts` | `22`, `{"N":10,"E":1,"NF":9,"EF":2}` | SPAWN counts before replacement (excl. `unharmful`) |
| `usedBy[]` | `{"modeId":"mode_multi_normal","round":3,"bossId":null}` | |

Timing: templates have one wave with one fragment, so `time = wave.preDelay + fragment.preDelay + action.preDelay`
exactly (the builder warns if a multi-fragment template ever appears).

## 12. `stages.json` — `{ [stageId]: Stage }` (11 terrains, 8 active)

| Field | Example | Meaning |
|---|---|---|
| `id`, `name` | `"act2autochess_m01"`, `"战场#05(下半) 源石流发生装置"` | player-facing name from research 05 (the official tables carry none; falls back to id). The build drops bracketed segments containing Latin letters (research notes such as `战场#01 (upper half #01)` → `战场#01`), logs a warning, and fails validation if Latin text remains |
| `weight`, `active`, `modes` | `50`, `true`, `["mode_single_normal",…]` | match-start pick weight (act1 m05–m07 weight 0) |
| `size` | `[19,21]` | |
| `rows[]` | `rows[9] = "##Errr#rrrSrrr#rrrS##"` | 19 strings, **index = row (0 = bottom)**, one glyph per col |
| `tiles[glyph]` | `{"tileKey":"tile_road","height":"LOW","buildable":"ALL","passable":"ALL","groundPassable":true,"flyPassable":true,"special":null,"bb":{}}` | actual tile properties of each glyph used. `buildable` is the **effective** deploy type: the level's buildableType, except a tile whose mechanism refuses deployment — 深水区 `tile_deepsea` (PRTS 深水区 地形信息 "部署类型 全部位 … 地形机制 拒绝部署（待补充）"; player report #3 after 0.1.0) — which is `NONE` and keeps the level's value in `buildableType` (`server/sim/grid.js DEPLOY_REFUSED_TILES`, shared with the builder) |
| `devices[]` | `{"key":"trap_013_blower","name":"源石流发生装置","alias":"trap_013_blower#001","pos":[13,5],"dir":"DOWN","hidden":false,"role":"blower","active":true,"stats":{…},"rangeGrid":[[0,0],…],"rangeTiles":[[13,5],[12,5],[11,5],[10,5]],"skill":{"skillId":"sktok_blower","bb":{"blower_s_character[equal].atk":0.3,…}},"desc":null}` | predefined devices; `role` ∈ crate, platform, mound, blower, mireController, tideController, turret (双眼皮, activated by band 机械援助), coldWind, sandstorm, waterPlatform, sealedFloor, bush, bossSpawn; `active` = present at match start (= not `hidden` in the level file); `rangeGrid` is facing right, `rangeTiles` = absolute tiles after rotating by `dir` (RIGHT `(dr,dc)`, UP `(dc,−dr)`, LEFT `(−dr,−dc)`, DOWN `(−dc,dr)`), clipped to the grid (null without a range). Terrain cards / band effects toggle devices by `alias` |
| `mapChars[]` | `{"key":"char_605_cmedic","alias":"char_605_cmedic#1","pos":[10,2],…}` | band_amedic map characters (→ `tokens.json`) |
| `special` | `{"mire":{"intervalSec":1,"aspdPerStack":-0.05,"moveMulPerStack":-0.05,"maxStacks":10,"heavyWeight":3,…}}`, `{"infection":{"bb":{"damage":70,"atk":0.2,"attack_speed":20,"duration":300}}}`, `{"deepsea":{"skillId":"sktok_tidectrl_3","bb":{…}}}`, `{"smog":{"rule":"operatorsNotTargetableByEnemyRanged"}}`, `{"blower":{…}}` | special-terrain parameters |
| `runes[]`, `globalBuffs[]` | `{"key":"map_tile_blackb_assign","bb":{…},"bbStr":{…}}` | level runes (act2 m03 reed rune has no reed tiles — leftover) |
| `deployTiles` | `{"normal":{"melee":[[9,3],…],"rangedOnly":[[10,4],…],"changedByDevices":[…]},"bossLeft":{…},"bossRight":{…}}` | deployable tiles at match start: `melee` = LOW (effective) buildable ALL/MELEE (ranged may use them too) — and a 深水区 under an active 特制水上平台 (`waterPlatform`, "在水上建立可以部署任意单位的平台"; act1 m05 only — the prep's deploy map only: the sim does not model the canoes, so its Grid keeps those tiles NONE, automatic placements avoid them and the path tie-break counts them as non-blockable [ASSUMED, weight 0 this season]) —, `rangedOnly` = high ground / active platforms; tiles under active crates/mounds and the 深水区 excluded. `bossLeft` / `bossRight` (field coordinates, boss rows 1–5) are what a player may deploy on in a boss round's prep: board (r, c) = boss (r − 7, c) / the right half mirrored (r − 7, 20 − c) (server/match/board.js `field`, user playtest #5 item 7) |
| `groundPaths` / `groundPathsWithDevices` | `{"12,10->9,2":[[12,10],[12,9],…,[12,3],[11,3],[10,3],[9,3],[9,2]]}` | the ground route of the sim's own `server/sim/grid.js` flow field (research 08 §3.4: 4-direction SPFA from the goal, crates cost 1000, Bresenham line-of-sight smoothing — official route lengths — kept unless the remake's (0.1.0's) road-over-floor preference route crosses strictly fewer non-blockable floor / gate / 深水区 tiles — the fewest among equal-length chains, smoothing that never cuts across floor its grid route does not walk; a corner touch does not count as a crossing — e.g. 战场#01's lower gate takes the col-8 road, not the col-9 floor lane, while 战场#04's keeps the official diagonal from row 9 into row 10; DESIGN §14 corrections, test/sim/pathing-official.test.js) as the tiles an enemy crosses, over the whole map, without / with the match-start devices (crates cost 1000, platforms / mounds blocking [ASSUMED]); the battle re-reads its flow fields live |
| `options`, `config` | `{"characterLimit":8,"moveMultiplier":0.5}`, `{…configBlackBoard strings…}` | |

Glyph legend (`rows`):

| Glyph | tileKey | Height | Build | Ground | Meaning |
|---|---|---|---|---|---|
| `#` | tile_forbidden | HIGH | NONE | no (fly yes) | void |
| `X` | tile_forbidden | HIGH | NONE | no (fly no) | hard separator (rows 6, 13) |
| `r` | tile_road | LOW | ALL | yes | deployable ground |
| `R` | tile_road | LOW | NONE | yes | non-deployable road |
| `f` | tile_floor | LOW | NONE | yes | lane col 9 / preview pen |
| `p` | tile_floor | LOW | NONE | yes | preview row (previewNotAlloed) |
| `h` | tile_wall | HIGH | RANGED | no | high ground |
| `b` | tile_fence_bound | LOW | ALL | no | fenced lowland (deployable, blocks ground) |
| `a` | tile_achand | HIGH | ALL | no | hand slot (row 7 cols 0–9; row 0 boss benches) |
| `A` | tile_achand | HIGH | ALL | no | temp hand slot (row 8 cols 4–8) |
| `S` / `E` | tile_start / tile_end | LOW | NONE | yes | red gate / blue objective |
| `I` / `O` | tile_telin / tile_telout | LOW | NONE | yes | teleport in / out (boss field) |
| `m` `g` `i` | tile_mire / tile_smog / tile_infection | LOW | ALL | yes | special terrain (see `special`) |
| `d` | tile_deepsea | LOW | NONE (level: ALL) | yes | 深水区 (see `special.deepsea`): enemies wade through it; no unit may be deployed on it (PRTS 深水区 地形信息 "拒绝部署（待补充）") — 战场#08's pool at board (10–12, 6), (10–12, 14), boss (3–5, 6) / (3–5, 14) |

## 13. `bosses.json` — `{ [bossId]: Boss }` (10; boss_8–10 hidden)

| Field | Example (`boss_5`) | Meaning |
|---|---|---|
| `bossId`, `enemyKey`, `handbookId`, `name`, `sortId` | `"boss_5"`, `"enemy_2016_csphtm"`, …, `"卢西恩，“猩红血钻”"`, `5` | `enemyKey` = activity_table `autoChessData.bossInfoDict[*].enemyId`, the official `IsBossEnemy` list: the units 限伤 applies to (one hit ≥ 300000 in a boss battle deals 0; shared/constants.js `BOSS_HIT_LIMIT`, research 11 §2.3) — the wave templates tag exactly these keys `boss` |
| `weight`, `hidden` | `10`, `false` | pick weight within its round |
| `bloodPoint` | `{"FUNNY":200000,"NORMAL":390000,"HARD":780000,"ABYSS":3000000}` | shared leader HP pool per difficulty: bossInfoDict `bloodPoint` / `bloodPointNormal` / `bloodPointHard` / `bloodPointAbyss` of the current data (PRTS 盟约记录's leader table is an older revision: 铳 险境, 胄 / 铳 / 萨米 绝境 differ, no 终极, no 卢西恩); no single hit of ≥ 300000 counts toward it (限伤, `BOSS_HIT_LIMIT`) |
| `lpr` | `30` | LP cost if it leaks |
| `templates[modeId]` | `{"round":14,"template":"act2autochess_h07_05"}` | |
| `escortsByTemplate[templateId]` | `[{"key":"enemy_2009_csaudc","slot":null,"count":4},…]` | non-boss spawns (slot = still a placeholder) |
| `parts[]` | `["enemy_9014_acstma","enemy_9015_acstmb"]` | boss parts (random local groups / unharmful); not leaders — 限伤 never applies to them |
| `abilities[]` | handbook texts | |

## 14. `tokens.json` — `{ [tokenId]: Token }` (22)

`kind`: `summon` (19 chess summons), `bondSummon` (`enemy_9012_acloon` 炎佑 for 炎 6/9), `mapChar` (`char_605_cmedic`
预备干员-医疗 / `char_613_acmedc` Touch placed by band `band_amedic`).

| Field | Example (`token_10028_vigil_wolf`) | Meaning |
|---|---|---|
| `tokenId`, `kind`, `name`, `appellation`, `desc`, `descRaw` | …, `"summon"`, `"狼群"` | |
| `profession`, `subProfessionId`, `position` | `"TOKEN"`, `"notchar1"`, `"MELEE"` | |
| `displayType`, `placeable` | `"DEFAULT"`, `true` | `shopStateTokenDict` DEFAULT / HIDDEN (battle-only) / `null` (not listed). `placeable` (a prep hand piece) = a manually deployable summon (PRTS 卫戍协议/帮助 "可手动部署的附属召唤物…加入手牌区"; user playtest #6): not HIDDEN and made by an owner's talent or skill — 医疗探机 (赫默 S2), 诅咒娃娃 (巫恋 S2), 海嗣, 狼群, 流形 and 爬行号·防护单元 (凯瑟琳's talent device — the only pool summon missing from `shopStateTokenDict`, read as shown: placed by hand in the base game, by the friend's report, and confirmed by the user after playtest #6, DESIGN §20); 投递坐标 (HIDDEN) is not. In battle a skill's summon deploys once at the battle start, then on its tile each time the skill gives one (SIM.md, token pieces) |
| `ownerRange` | `true` | the token text reads "只能部署在召唤者攻击范围内" (`desc`; the tacticians' 援军 — 狼群, 流形; PRTS 狼群 特性): its hand piece may only stand on a tile of its owner's attack range (server/match/board.js `ownerRangeKeys`, `PlayerState._legal`, the client's `gameLogic.summonRange`; player report #9 after 0.1.0). `false` for every other token |
| `owners[]` | `["chess_char_3_19_a","chess_char_3_19_b"]` | |
| `stats`, `rangeGrid`, `dmgType`, `attackKind`, `projectile`, `canHitFly` | first owner's values | defaults |
| `skill` | `{"skillId":"sktok_vigil_wolf_3","bb":{…}}` | default token skill (same slot as the owner's skill) |
| `deployLimit`, `count` | `1`, `1` | `count` = copies sent to the hand / spawned (talent/skill `cnt`); `null` ⇒ use `deployLimit` |
| `abnormal[]` | `["healFree"]` | abnormal effects the summon holds from the start, no official table carries them — `tools/build-data.mjs TOKEN_ABNORMAL` from the PRTS summon pages (user playtest #6 item 18): `healFree` = 禁疗 (“小自在”, “耀阳”, 斯卡蒂的海嗣, 沙之碑, 流形, 狼群, 迷迭香的战术装备, 黄金盟誓, 保护目标（冻结状态）), `isolated` = 孤立 "无法被同阵营选中" (“炎佑”, 从不混淆的方向); `[]` otherwise. The sim sets `noHeal` / `isolated` (docs/SIM.md §3) |
| `variants[ownerChessId]` | `{"phase":2,"level":1,"stats":{…},"immunities":{…},"rangeGrid":…,"trait":{…},"dmgType":…,"skill":{full skill record},"talents":[…],"count":1,"sources":["talent","display"]}` | stats at the owner's phase/level (clamped to the token's max level) + golden module `tokenAttributeBlackboard`; the owner's module parts flagged `isToken` upgrade the variant's `trait` (+`moduleDesc`) and `talents` (伺夜's wolves, 缪尔赛思's 流形 `scale` 1, 浊心斯卡蒂's 海嗣 30 s, “耀阳” `atk_scale` 1.15). `sources` ⊆ `talent`/`skill`/`display`: how the owner produces it (`display` only = listed on the character but unused by its default skill/talents, e.g. 迷迭香 S2, 凛御银灰 eagle1/3). `count` = copies from a talent `cnt` or the default skill's `cnt` when that skill overrides this token; `null` ⇒ use `deployLimit` |
| `variants[o].bySkill[i]` | `{"skill":{…},"count":1,"sources":["talent","display"]}` | owner loadout with the non-default skill index `i` (one entry per other selectable owner skill): the token skill of that slot (伺夜's wolves, 缪尔赛思's 流形, 凛御银灰's eagles…), the count and how the chess then produces it (`sources` may be `[]`: 风丸 S1 makes no 纸偶; 赫默 / 巫恋 S1 only `display` ⇒ no hand piece). The sim resolves them for an owner loadout: `simdata getToken(id, ownerChessId, loadout)` → `def.sources` / `def.count` |
| `variants[o].byModule[m]` | `{"stats":{…},"immunities":{…},"trait":{…},"talents":[…]}` | golden owner with another module `m` or `'none'`: the token as that module makes it (module `tokenAttributeBlackboard`, `isToken` trait/talent parts) |
| `assets` | `{"avatar":"token_10028_vigil_wolf","spine":"token_10028_vigil_wolf"}` | |
| mapChar extras | `phase`, `level`, `trait`, `talents`, `positions:[{"alias":"char_613_acmedc#2_multi_only","pos":[10,10],"dir":"RIGHT","multiOnly":true}]`, `source` | |
| bondSummon extras | `bondId`, `motion`, `skills`, `talents`, `assets.isEnemyModel` | 炎佑 base template (600 ATK / 12000 HP); at battle start 30 % of the 炎 operators' ATK / HP sums are **added** to it (PRTS "（最终加算）", bonds.yanShip; the 9-炎 ATK ×1.5 on the whole ATK [ASSUMED]) |

---

## 15. Anomalies found while joining (also in `.cache/build-data-report.json`)

1. **凛御银灰 container token** `token_10057_svash2_eagle` (talent tokenKey) is not in `character_table`: the talent's
   `tokenKey` is remapped to the default skill's token (S2 → `…_eagle2`, `containerTokenKey` keeps the official id).
   `…_eagle1/3` stay listed (`sources:["display"]`, belong to S1/S3). With another skill selected (DESIGN §16) the
   talent follows that skill's eagle (`simdata loadoutRecord`; `variants[o].bySkill[i].sources`).
2. **DIY chess** (`chess_char_5_diy1/2`, `chess_char_6_diy1/2`, `_a` and `_b` = 8 records): no `charId`, no stats/skill; `visible:false`,
   name placeholder `甄选干员`. Out of scope for v1.
3. **Module-less chess**: 蒂比 (`chess_char_2_13`) and 凛御银灰 (`chess_char_5_14`) have no module; their golden
   record has `module:{id:null,active:false}` and no module stat bonus.
4. **Hidden chess (17)** are kept with `visible:false`; several operators exist in two tiers with one hidden
   (锡人, 耶拉, 录武官, 白面鸮, 百炼嘉维尔, 魔王, 华法琳, 妮芙).
5. **Every non-DIY chess (258 records: 129 normal + 129 golden) has a resolvable default skill, stats and range** — no
   skill anomalies.
6. **Skill triggers** (§2.2): the class rows cover every MANUAL skill of the class (all 重装 MANUAL skills are
   `TAKE_DAMAGE` but the six of the deliberate deviation, DESIGN §21.29, which are `DEFAULT` with `rawRule` `TAKE_DAMAGE`, and 余 S2, `SKILL_RANGE` on its x-1 (DESIGN §22.10); 薄绿 / 卡涅利安 / 蜜蜡 / 玛恩纳 S2 `SEARCH`; 伺夜 / 魔王 / 浊心斯卡蒂 S3 `SP_FULL`) and no AUTO skill (古米 /
   雷蛇 / 瑕光 / 塞雷娅 / 号角 / 信仰搅拌机 S1, 伺夜 S1/S2, 魔王 S1); 13 MANUAL skills (26 normal + elite records) with
   their own 技能范围 are `SKILL_RANGE` (德克萨斯 S2, 凛御银灰 S2, 锏 S2/S3, 异客 S3, 忍冬 S2, 焰尾 S2 …); 余 S2 joins them by the §22.10 deviation, 14 skills / 28 records in the data.
7. **Trait candidate `rangeId`** (送葬人, 松果 1-3; 风丸, 归溟幽灵鲨 x-4) is the trait-effect area, exposed as
   `trait.rangeGrid`, not the attack range.
8. **Passive skills** use numeric `spType 8` in skill_table → normalized to `ON_DEPLOY`.
9. **Bond `effectDesc`** keeps positional placeholders by design (`effectDescParams`).
10. **Hidden module talents**: module data-only talent candidates have no name/text; kept as `hidden:true,fromModule:true`.
11. **act1 m02** crates and platforms are all `hidden` in the 下半 level file and absent from the PRTS 下半 screenshot
    ⇒ **no crates at start** (`active` = `!hidden` for every device; research 08 §3.3 — an earlier build kept
    #001–#004 active, which blocked the top road). Its terrain cards can only act on hidden devices.
    Platforms/mounds block ground movement [ASSUMED]; crates are obstacle-like (cost 1000), not walls.
12. **Boss per-template overrides** (e.g. 愧悔魂灵圣杯 HP 60 000, 昆图斯 ATK 480, 卢西恩 ATK 700/600) live in
    `waves[t].overrides`, not in `enemies.json`.
13. `act1autochess_h08_01` `totalCount` 15 excludes the two unharmful hand parts (research counted 17).
14. Escaped (联防) templates have `maxPlayTime 1` in data; use the round's `combatTimeLimit`.
15. 炎佑 name in the enemy DB is `"炎佑"` with literal ASCII quotes.
16. Research-only fields (null without `docs/research`): stage `name`, item `category/kind/family/implFormula/
    requiresBondId/rangeGrid/flavor`, bond `spec`, E2 art availability (falls back to "char has an E2 phase").
17. [ASSUMED] content (flagged in data): 机变 family schedule and server pools, the solo leader pool factor
    (`bossHpScale.solo` 0.25), title criteria, income cap 12, per-turn band-draft timer 30 s (`timers.bandTurn`, the
    step's only countdown — user playtest #4), the shop-only item list (`SHOP_EXCLUDED_ITEMS`, from play), the alive / 4
    proportion of the optional co-op alive scaling (`bossHpScale.aliveAssumed`; `aliveScaling` off). The special-enemy
    generator, the co-op leader pool (`bloodPoint`, one pool for every field) and the 联防 timing are official.
18. **Module parts flagged `isToken`** (伺夜, 浊心斯卡蒂, 缪尔赛思, 耀骑士临光 golden) upgrade the summon only; they are
    applied to `tokens.json` variants, never to the operator's talents/trait.
19. **Undefined enemy-database fields** (`m_defined:false`): a zero `m_value` means "never set" and falls back to the
    default (`lifePointReduce` 1 — 萨卡兹王庭军战士, 深池逐火战士, 圣堂剑士…; `attackSpeed` 100 — 卢西恩, 萨卡兹枯朽战车…;
    `baseAttackTime` 1 — 枯朽之种); a non-zero `m_value` is the prefab value and is kept (boss-part immunities).
    Defined values are never changed: 假想敌：铳/管/弦 have an official `aspd` 0 (skill-driven; engines clamp).
20. **MELEE enemies with an official radius** (粉碎攻坚手 2.5, 宿主士兵 2.5, 迷路的巨像 2.5, 清明/堂皇 2, 雪怪小队破冰者
    1.9, 冰爆源石虫 1.75, 深池方阵步兵 1.5, 深池伙友卫队 1.4, 山海众头目 1.2 …): `rangeRadius` 0, value in `rawRangeRadius`.
21. **Token counts**: a skill `cnt` is only used as a token count when that skill overrides the token (夕's S1 `cnt` 2
    is a charge count ⇒ “小自在” `count` null).
22. **联防 spawn timing** (client `GenerateHelpBattleEnemyData` → `_GetSpEnemyActionData` →
    `_CalculateActionPredelayConsiderUid`, decoded from GameAssembly.dll; `server/match/waves.js buildUniteWave`): every
    leaked enemy is a 1-unit action on the route of the escaped template's first `lrsldr` (walker) / `yokai` (flyer) /
    `gopro_2` / `lazerd` (token) action, else action 0. Per host action, with W = count·interval of that action and
    M = the largest per-owner group, step = min(max(W/M, 0.05·W), 5 s); the k-th owner (first-leak order) starts
    0.5·k s after the action's preDelay (no cap) and its i-th unit spawns i·step later.
23. **Preview zones** (`waves.js gateOf`, client `AutoChessEnemyPreviewManager`): target row = route start row + 6
    (leader / hidden rounds + 13); the upper pen zone (anchor (18,7)) needs target row ≥ 18, everything else goes to the
    lower zone (15,7). Normal fields: only the (12,10) gate is upper; boss fields: (5,10) upper, the (2,10) gate and the
    leaders starting at (3,x) / (4,x) lower.

## 16. Counts (current build)

`chess 266 (112 visible; 283 selectable skills over the visible chess, 184 module choices over 129 goldens)`, `bonds 23`, `garrisons 249 (43 effect keys)`, `items 115`, `bands 40`, `effects 361`,
`enemies 249`, `factions 67 entries`, `waves 38`, `stages 11 (8 active)`, `bosses 10`, `tokens 22`, `choice events 109`,
`bounty cards 129`, `tactic cards 43`.

## 17. Integrity guarantees (checked by the builder and `test/data.test.js`)

Chess bonds/garrisons/tokens/base/golden ids resolve; talent tokens are in `chess.tokens`; every non-DIY chess has
`skills[]` with exactly one default equal to `skill` (and every skill token listed in `chess.tokens`); golden module
choices are consistent (one default iff `module.active`, base fields present; composing the default reproduces the
record); token variants carry `bySkill` / `byModule` for exactly the other owner choices; bond members exist and
carry the bond; items/bands/bonds reference existing effects; wave spawn keys and branch keys resolve in
`enemies.json`, route indices exist; every mode round has a template (or boss templates) present in `waves.json`;
stages are 19 × 21 with known glyphs and contiguous helper paths; bosses/factions/tokens/choice pools resolve; token
variants carry `sources`; enemies have `maxHp`/`bat` > 0, `aspd`/`moveSpeed`/`lpr` ≥ 0 and `rangeRadius` ≥ 0 (0 for
MELEE); no non-finite numbers; total size < 6 MB. `test/data.test.js` additionally re-derives every chess/enemy stat
from the raw official tables (incl. the float32 `attrPower`) and rebuilds offline to prove `data/` is not stale (both
skipped without the cache); faction entries carry no `k` copies and share one movement class; every device's
`active` = `!hidden`; the helper lanes of act1 m02 / m04 / act2 m02 are the official ones (research 08 §3.2).
`test/match/waves-official.test.js` checks the generator against 429 official entry × round compositions
(`test/fixtures/official-waves.json`); with the cache, `test/match/waves-crosscheck.test.js` re-implements the client
generator and preview zones on the raw level files for every mode × round × template (leader and hidden rounds
included) × allowed entry, and `test/sim/pathing-crosscheck.test.js` re-implements the client SPFA + smoothing over the
whole map for every walkable tile of the normal / 联防 / boss fields of the 8 stages (extended by the road-over-floor
preference; against the pure official algorithm: identical route lengths, never more non-blockable tiles crossed).
