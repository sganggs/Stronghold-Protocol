# DATA.md — generated game data (`data/*.json`)

All files in `data/` except `data/assets.json` and `data/i18n/` are produced by **`node tools/build-data.mjs`** (task F1) from the
official zh_CN client data ([Kengxxiao/ArknightsGameData](https://github.com/Kengxxiao/ArknightsGameData)) joined
with `docs/research/*.json`. Do not edit them by hand — change the build script and rebuild.
`data/i18n/en.json` (the official English texts of these files by record id and field) is written by
`node tools/build-i18n.mjs` — rerun it after a build that changes a text (docs/I18N.md §2; `test/i18n-data.test.js`
fails while it is stale).
`data/assets.json` is written by `tools/fetch-assets.mjs`, which keeps the current file rather than drop entries whose
downloads failed on this machine unless `--allow-shrink` (or `--prune`) is passed (docs/ASSETS.md, DESIGN §21.25).

```
node tools/build-data.mjs              # build (downloads missing official files into .cache/gamedata@<commit>/, the profile's pins)
node tools/build-data.mjs --offline    # never download; fail if a cached file is missing
node tools/build-data.mjs --refresh    # re-download every official file; fail if any download fails
node tools/build-data.mjs --no-research --out /tmp/x   # research-free build (fallback defaults), other dir
node tools/build-data.mjs --cache <dir> --report <file> # other cache dir / report file (tests, CI)
node tools/build-data.mjs --force      # write data/ even when integrity checks fail (debugging only)
node tools/build-data.mjs --version act1autochess   # another official version → data/versions/<slug>/ (see "Official versions (M0)")
node --test test/data.test.js          # integrity tests (+ raw-data cross-check and rebuild check when the pinned official files are cached)
```
Unknown options or a missing option value are errors (exit code 2); `--refresh` and `--offline` are exclusive.

- **Cache.** Official files live under `.cache/gamedata/<repo path>` (`excel/activity_table.json`,
  `levels/enemydata/enemy_database.json`, `levels/activities/act1autochess/level_*.json`, …) and are fetched from
  `https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData/master/zh_CN/gamedata/<path>` when missing.
  Downloads are validated (must parse as JSON) and written atomically. With `--refresh`, a download that still fails
  after four attempts aborts the build (exit code 1), even if an older cached file exists. Generated files and the
  previous report remain untouched, including with `--force`; successfully downloaded cache entries are not rolled
  back. Retry `--refresh` to complete the refresh; cached files are not verified to share an upstream revision.
- **Report.** A run that reaches integrity validation writes `.cache/build-data-report.json` (counts, byte sizes, warnings (each once), errors, `written`).
  Integrity errors (see §17) make the exit code 1 **and leave the previous output untouched** (unless `--force`);
  warnings never do. Each output file is written atomically (temp file + rename).
- **Determinism.** Same inputs ⇒ byte-identical outputs (stable key order, no timestamps, no randomness).
- **Size.** ≈5.8 MB for the 15 built files (limit 6 MB; `chess.json` ≈1.88 MB with the loadout choices, `backups.json` ≈2.06 MB), compact JSON (no indentation).
- **Plugin compositions (0.3.0).** Generated files stay official and unchanged. P1b applies patches and compact records to immutable in-memory copies (PLUGINS.md §10); `shared/plugins/validate.js` checks their references without the official quantity assertions. New modes inherit an official base; mode-level economy, DP, timers and other global keys override those defaults. Plugin translations retain the existing i18n overlay format and receive source hashes (`_h`) from the final merged records. A content selection's `cs` also includes the sha256 of each served `i18n/<lang>.json`; the vanilla P0 hash still excludes `data/i18n/`.
- **Derived paths.** `stages.json groundPaths*` come from `server/sim/groundPaths.js`, using the sim's own `server/sim/grid.js` pathing: a change there
  needs a rebuild (the offline-rebuild test catches a stale `data/`).

## 0. Conventions used by every file

Promotion indicators read the resolved record's `status.phase` and `status.level` (chess or a backup form), not
`isGolden` or tier. `status.phase` is the numeric suffix of official `status.evolvePhase`; the UI uses the matching
`assets.ui[elite/elite_<phase>]`. The four shipped versions agree: tiers I/II normal E1 Lv.55/60, elite E2 Lv.50/55;
tiers III–VI normal E2 Lv.1, elite E2 Lv.60. This is a data observation, not a substitute UI lookup (§35.18).

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
| `enemyScale[r]` | `{"atk":1.1,"hp":1.2,"speed":1,"kAtk":1,"kHp":1}` | non-boss enemy multipliers (research 01 A3): `atk = atkBase·1.1^kAtk`, `hp = hpBase·1.2^kHp·extra`, `speed` 1.15 on ABYSS from R3; `supplyHp` (only when ≠ 1, co-op 终极 R5–R15) = the share of `hp` from 补给线 / 补给线II (1.2^(kHp − kAtk) · extra), which the 14 器物 hit-count keys do not take (their `enemy_exclude`). Apply to level-0 stats after special-enemy replacement, also to bounty/special enemies and to the leaders' mid-fight summons. **Leader HP pools excluded.** |
| `bossHpScale` | `{"bloodPointKey":"bloodPointAbyss","unaffectedByEnemyScale":true}` | which `bloodPoint` column the mode reads; the pool rule's keys live in the global `bossHpScale` below — one set here would override it for this mode (`gamedata.js bossPoolShareOf`) |
| `upgradePrices` | `[5,8,11,12,13]` | base price L1→2 … L5→6 (−1 per round start, floor 0, reset after upgrade) |
| `maxShopLevel` | `6` | |
| `shopSlots[level]` | `{"1":{"chess":3,"item":1},…}` | operator + item slots per shop level, from the selected snapshot's `activity.AUTOCHESS_SEASON[season].shopLevelDataDict[modeId][level].charChessCount` / `itemCount`; 第一期: equipment at 5–6, 第二期: 1–6 (lobby modes; §36.1) |
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
| `poolCopies[tier]` + `poolCopiesOverrides` | 12/14/18/16/8/5 plus measured low-tier identity exceptions (DESIGN §29.8) | single-player copies; `coopPoolMultiplier: 2` doubles them in co-op: the shared operators and each player's private 自选 stock alike (the maintainer's decision of 2026-10-15, GitHub #650, DESIGN §32.14.31; before 0.3.0 the 自选 stock stayed 8 / 5) |
| `itemPoolCopies[tier]` + `itemPoolCopiesOverrides` | 4/6/7/8/7/3 plus eight measured exceptions (DESIGN §29.8) | shared shop-equipment ownership: normal 1, upgraded 2; non-shop effect-only equipment unlimited |
| `goldenCopies`, `mergeCount`, `mergeCountOverrides`, `itemMergeCount` | `3`, `3`, `{"chess_char_2_11_a":2}` (风丸), `2` | |
| `rewardOffer` | `{"count":3,"tierOffset":1,"maxTier":6,"price":0,…}` | merge reward: 3 **different** free chess of tier `min(shopLevel+1,6)` (a short tier tops up from the tier below; the player's stocked 自选 of that tier joins the roll, DESIGN §30.23; `PlayerState.pushRewardOffer`, user playtest #6 item 19) |
| `handFillOrder` | `"rightToLeft"` | |
| `shopOdds` | `{"model":"copyWeighted",…}` | [ASSUMED] roll model |
| `borrowCount`, `fallbackBondId`, `defaultBandId`, `defaultStartLp` | `20`, `"emptyShip"`, `"band_bldsk"`, `28` | |

### 1.3 Other global keys

| Key | Example | Meaning |
|---|---|---|
| `lpCapPerRound` | `10` | max LP lost per player per normal round |
| `bossOvertimeAfter`, `bossOvertimeDrainPerSec` | `150`, `1` | official `bossTurnHpReduceTime`: from 150 **real** s of a boss round the merged team LP loses 1 per whole real second (`gamedata.js bossOvertimeDue`; first point at 151 s) |
| `bossHpScale` | `{"formula":"one pool for every boss field …","perPlayer":true,"coop":1,"solo":1,"aliveFull":4,"aliveScaling":false,"aliveAssumed":true,…}` | the leader pool (one for every boss field) = `bosses[id].bloodPoint[difficulty]` × share: `perPlayer` true (the owner's decision of 2026-10-06, adopting PR #209 — it replaces the fixed pool of 「保持固定血量」) — co-op share = `coop` × the players alive when the fight starts (bots and AI 托管 seats count, eliminated and departed seats do not; at most `aliveFull`), solo share = `solo` (1). `perPlayer: false` with `solo: 0.25` restores the fixed pool of 0.1.x (co-op × `coop` whatever the count; `aliveScaling: true` would make it × alive / `aliveFull`, the proportion [ASSUMED, flagged `aliveAssumed`]). `GameData.bossPoolHp(bossId, aliveCount)` / `bossPoolShare` implement it (DESIGN §20.10, §25.13.4) |
| `hiddenCore` | `{"single":350,"multi":1200,"minTeamLpExclusive":1,"difficulties":["NORMAL","HARD","ABYSS"],"checkedAfterRound":14}` | Σ activated layers must be **>** threshold and LP **>** 1 (PRTS; the community's measurement 路标月报#2, GitHub #645) |
| `dp` | `{"init":10,"perSec":1,"max":99}` | |
| `unite` | `{"maxHelpers":2,"helperOrder":"unitsOnField>activeBond>undownedUnits; pair: unitsOnField>activeBond>activeLayers>undownedUnits, first = right field (PRTS 帮助)","layerGainsEnabled":false,"templates":{"1":"act1autochess_escaped_single","2":"act1autochess_escaped_multi"},…}` | 联防; `helperOrder` documents the rule `server/match/unite.js helperOrder` implements (research 08 §5; ties → seat) |
| `finalAssault` | `{"pairing":"seatOrderPairs","oddPlayerAlone":true,"movableBossPerAlivePlayerSide":true,"layerGainsEnabled":false}` | |
| `timers` | `{"infoCheck":25,"infoCheckHint":5,"bandDraft":50,"bandDraftHint":15,"bandTurn":50,"battleCheck":3,"spFirst":30,"spTurn":16,"soloPrepTimeData":300,"soloSpTimeData":150,"chatCd":1,"chatBubble":3,"broadcastDelay":1,"enterSteps":[…]}` | seconds |
| `bans[difficulty]` | `{"core":3,"addon":4}` (FUNNY `{0,1}`) + `rule` | per-match disabled-bond draw (research 01 A2) |
| `bandDraft` | `{"skipsPerPlayer":1,"order":"random","duplicatesAllowed":true,"timeoutBandId":"band_bldsk"}` | |
| `titles[]` | `{"id":"comment_1","picId":"comment_icon_1","name":"卫戍之星","stat":"bossDamage","rule":"max","onlyOnWin":true,"text":"…"}` | 评语 + [ASSUMED] criteria; `titleRule` explains assignment |
| `tips[]` | `{"tip":"只有在联合模拟中才能获得奖杯","weight":50}` | gameTipsList |
| `broadcasts[]` | `{"id":"comment_boss_hit_1","type":"BOSS_HIT","priority":30,"text":"{0}博士对敌方领袖造成的伤害超过20%!","textRaw":"<@ba.vup>{0}博士</>…","params":["0.2"]}` | `{0}` player, `{1}` operator/level, `{2}` amount |
| `trophies` | `{"byRoundsPassed":[{"maxRound":4,"FUNNY":0,…},…],"hiddenCore":{…},"multiOnly":true,"medals":[{"count":0,"iconId":"trophy_level1_icon"},…]}` | |
| `roundScores[]` | `{"round":4,"score":50}` | |
| `rewards` | `{"itemId":"act2autochess_token_chess","baseByRoundsPassed":[{"round":1,"count":10,"dailyPoint":10},…],"formula":"…","difficultyFactor":{…},"modeFactor":{…},"milestones":[{"level":1,"tokens":100},…],"daily":{"name":"每日防卫目标","need":200,"bonus":300,"resetHour":4,"rule":"…"}}` | 卫戍认证; `milestones`: the 60 levels of the settlement's LV (milestoneList, cumulative tokens; 35 in a version at its launch, "Official versions (M0)"); `daily`: 每日防卫目标 (constData dailyMission*; the bonus and the reset hour read from its rule text) |
| `constants` | `{"maxLevelCnt":15,"bossTrailerStartRound":3,"singleReconnectTime":86400,…,"pingConds":[…]}` | misc official constData; `singleReconnectTime` (s) = how long a dropped **solo** run stays resumable (server/lobby.js; co-op keeps the 10-minute window; `null` in a version whose constData lacks it, "Official versions (M0)") |

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
| `backup` | `{"charId":"char_611_acnipe","tmplId":null,"skillIndex":2,"uniEquipId":"uniequip_002_acnipe","potRank":0}` (`chess_char_5_22_a/_b`, 妮芙) | the shop row's official stand-in fields, verbatim (`backupCharId`, `backupTmplId`, `backupCharSkillIndex`, `backupCharUniEquipId`, `backupCharPotRank`), the same on both forms: PRESET (特许) = itself, NORMAL = the 补位 stand-in fielded when the player marked the operator as not owned (干员持有, §18), DIY = none (`charId` null) |
| `charId` | `"char_498_inside"` | operator (null for DIY) |
| `name`, `appellation` | `"隐现"`, `"Insider"` | |
| `rarity` | `5` | stars 1–6 |
| `profession`, `subProfessionId`, `subProfessionName`, `position` | `"SNIPER"`, `"fastshot"`, `"速射手"`, `"RANGED"` | |
| `placeOnRanged` | `true` (present only then) | a MELEE chess whose Chinese trait without a module (`traitBase`, else `trait`) contains 「可以放置于远程位」 — the 钩索师 / 推击手 branch trait: 歌蕾蒂娅, 崖心, 见行者, normal and elite; the module does not matter (every module of the three keeps the line). Stored at build time so a localized record still places: the overlay replaces the trait text, and en / ja / ko / zh-TW (於) no longer contain the Simplified line (GitHub #676). Read at place time (`shared/highGround.js meleeOnHighGround`, which also matches that line when the flag is absent — a Chinese or plugin record — `board.js positionClass`); the owner's decision of 2026-10-05, following PRTS (it reverses the 2026-10-04 one: elite 歌蕾蒂娅 with HOK-Y only). A compact MELEE plugin form may set the same boolean [ASSUMED]; `expandRecords` copies only `true` onto the chess and the 自选 form (`shared/plugins/records.js`). `position` stays MELEE for the battle. The old `placement` string is not stored |
| `nationId` | `"laterano"` | |
| `bonds[]` | `["lateranoShip","swiftShip"]` | bondIds (→ `bonds.json`) |
| `garrisonIds[]` | `["garrison_16_b"]` | 特质 (→ `garrisons.json`); first = displayed trait |
| `price`, `sellPrice` | `2`, `1` | |
| `upgradeNum`, `upgradeChessId` | `3`, `"chess_char_1_01_b"` | copies needed to merge (风丸 2; golden 0) |
| `status` | `{"phase":2,"level":50,"skillLevel":7,"equipLevel":1}` | training status used for all numbers |
| `stats` | `{"maxHp":1421,"atk":531,"def":167,"res":0,"cost":12,"blockCnt":1,"bat":1,"aspd":100,"respawnTime":70,"spRecovery":1,"hpRecoveryPerSec":0,"moveSpeed":1,"tauntLevel":0,"massLevel":0,"deployLimit":1,"deckStack":0}` | keyframes linearly interpolated at `status` **plus every potential attribute modifier** (full potential, 潜能 6 — the default; character_table `potentialRanks` 1–5 — 「攻击力+N」, 「部署费用-1」, 「再部署时间-N秒」, 生命 / 防御 / 法抗 / 攻速 — added to the raw values: the official records carry no potential, a tournament video shows 刺玫 at ATK 435 / cost 15 = her E1 Lv55 413 / 17 + 攻击力+22 and two 部署费用-1; a lower potential — the player's 干员调配 setting since 0.2.2 — reads `potDown`, §2.3), hp/atk/def/cost/block/respawn rounded; **golden includes the module attribute bonus**. `aspd` 100 = base (module attack_speed added). Talent stat boosts are NOT folded in. |
| `immunities` | `{"stun":false,"silence":false,"sleep":false,"frozen":false,"levitate":false}` | |
| `rangeId`, `rangeGrid` | `"3-3"`, `[[1,0],[1,1],…]` | attack range at `status` |
| `dmgType` | `"phys"` | `phys` / `arts` / `heal` (derived, see §2.1) |
| `attackKind` | `"ranged"` | `melee` / `ranged` / `heal` / `none` |
| `projectile` | `"arrow"` | `arrow` (phys ranged) / `bolt` (arts ranged) / `orb` (heal) / `none` |
| `canHitFly` | `true` | |
| `targetPriority` | `"fly"` | from trait text: `fly` (优先攻击空中单位), `lowestDef` (防御力最低), else `null` |
| `trait` | `{"desc":"优先攻击空中单位","descRaw":"…","bb":{"atk_scale":1.1},"bbStr":{},"rangeGrid":null,"moduleDesc":"攻击空中单位时攻击力提升至110%","moduleDescRaw":"…"}` | profession trait (+ golden module trait upgrade merged into `bb`; `rangeGrid` = trait-effect area, e.g. 散射手 front row — **not** the attack range). `desc` = the class trait, or the module's rewrite of it (official `overrideDescripton`); `moduleDesc` = the module's added line (official `additionalDescription`, PRTS 「特性追加」), which the client shows after `desc`, never alone (0.2.0, community report item 16.2). A module part that only adds a display line (official target `DISPLAY`, no rewrite) fills that line with its blackboard and leaves `desc` at the class trait's numbers — 圣约送葬人 REA-Y: `desc` heals 50, `moduleDesc` 攻击速度+12 (0.2.2, GitHub #400); `bb` still merges every part (what the kits read). `rangeExpand` (present only then) is the Chinese `moduleDesc` matching 「攻击范围扩大」; `modeOnly` (present only then) matches 「集成战略」. The preview reads those booleans (`shared/loadoutRecord.js`, GitHub #700) and still matches the Simplified line when the flag is absent. The battle kits still read the Chinese text |
| `skill` | see below | default skill at `status.skillLevel` (normal 4, golden 7) |
| `skills[]` | `[{…skill record…, "index":0, "isDefault":false}, {…, "index":1, "isDefault":true}]` | **loadout choices** (DESIGN §16): every skill unlocked at `status` (E1 ⇒ S1–S2, E2 ⇒ S1–S3; the default is always listed), same shape as `skill` + `isDefault`, at the chess skill level, `trigger` resolved **for that skill index** (§2.2). The `isDefault` entry equals `skill` |
| `modules[]`, `statsBase`, `traitBase`, `talentsBase` | see §2.2 | golden chess with `equipLevel > 0` only: selectable modules + the no-module base they apply to |
| `talents[]` | `{"index":0,"name":"火力支援","desc":"…","descRaw":"…","bb":{"self_ammo":3,"duration":20,"ally_ammo":1},"bbStr":{},"rangeGrid":null,"tokenKey":null,"hidden":false,"fromModule":false}` | best unlocked candidate at `status` at full potential (candidates up to `requiredPotentialRank` 5: the 「天赋效果增强」 steps; module talent candidates the same — an entry a lower potential changes chains its lower candidates, `potMin` / `potBelow`, §2.3); golden: module talent upgrades applied (`fromModule`); module data-only talents have `name:null, hidden:true`. A module upgrade of an existing talent **merges** blackboards (module keys win, base keys it does not restate are kept — e.g. 宴 keeps `min_attack_speed`; 仇白's upgrade adds `atk_scale_t` next to the old `atk_scale`: prefer the key the text uses). Module parts flagged `isToken` are **not** applied to the operator; they upgrade its summons (tokens.json variants). `containerTokenKey`: the official talent token id when it is a container missing from character_table (凛御银灰), `tokenKey` then holds the default skill's token |
| `tokens[]` | `["token_10028_vigil_wolf"]` | summons (→ `tokens.json`): displayTokenDict + default-skill `overrideTokenKey` + talent `tokenKey`; `tokens.json → variants[chessId].sources` tells which (a `display`-only token is not produced by this chess's default skill or talents) |
| `module` | `{"id":"uniequip_002_inside","name":"“最初的惊喜”","type":"MAR-X","level":1,"active":true}` | active only on golden chess |
| `assets` | `{"avatar":"char_498_inside_2","portrait":"char_498_inside_2","spine":"char_498_inside","skillIcon":"skchr_inside_2","subProfIcon":"sub_fastshot_icon"}` | asset **ids** (URLs in `data/assets.json`); golden uses the E2 art when it exists |
| `diyRequirement` | `"TIER_6"` | DIY only |
| `potDown` | `{"0":{"stats.cost":17},"1":{"stats.respawnTime":70},"2":{"stats.atk":413},"4":{"stats.cost":16}}` (`chess_char_1_06_a`, 刺玫) | what a lower potential changes (§2.3; absent when nothing does: the DIY slots, 盟约·辅助干员) |

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
| `passiveRange` | `true` (present only then) | the Chinese `desc` matches 「被动效果：攻击范围扩大」 and `rangeGrid` is non-empty (引星棘刺 S3). The preview uses this skill's grid (GitHub #700). Absent: the same Simplified line still selects it. A localized `desc` does not |
| `prefabId`, `overrideTokenKey` | | |
| `trigger` | `{"rule":"DEFAULT","rawRule":"DEFAULT","customRangeGrid":null}` | auto-cast rule (the official 技能策略, PRTS 卫戍协议/帮助 §作战阶段 技能操作; §2.2). `rule` ∈ `DEFAULT` (basic strategy), `SKILL_RANGE` (a MANUAL skill with a 技能范围 of its own: `customRangeGrid` = its `rangeGrid`, `rawRule` `DEFAULT` — no official row), `ACTIVE_RANGE` (the owner's deliberate deviation of 2026-10-05: a MANUAL skill on the basic strategy — 深巡 S2's deviation included — or on the `SEARCH` row whose attack range while it runs strictly contains the operator's own range: `customRangeGrid` = that running range, `rawRule` the official row, `DEFAULT` / `SEARCH` / 深巡's `TAKE_DAMAGE`), `TAKE_DAMAGE` (every MANUAL 重装 skill but seven: 深巡 / 雷蛇 S2, 号角 S2 / S3 and 灰毫 S1 / S2 are `DEFAULT` with `rawRule` `TAKE_DAMAGE` — a deliberate deviation, `tools/build-data.mjs TRIGGER_DEVIATIONS`, DESIGN §21.29; 深巡 S2 then `ACTIVE_RANGE` on its 3-2 — and 余 S2 is `SKILL_RANGE` with `rawRule` `TAKE_DAMAGE` and `customRangeGrid` its x-1, DESIGN §22.10), `SP_FULL` (official `ALWAYS`: 执旗手 / 战术家 / 吟游者 MANUAL skills), `CUSTOM_RANGE` (official `CUSTOM_RANGE_SEARCH_ENEMY`, uses `customRangeGrid`), `SEARCH` (解放者 / 阵法术师 MANUAL skills, 安洁莉娜 S2/S3 — but those whose running range is larger, `ACTIVE_RANGE`: 薄绿 S1, 蜜蜡 S1, 卡涅利安 S3, 玛恩纳 S2, 安洁莉娜 S3), `MLYSS_WTRMAN` (缪尔赛思), `GDGLOW_SKILL_2` (荒芜拉普兰德, 纯烬艾雅法拉 S3: "全场存在可选目标时释放技能"). `allies: true` (only then present): an ally row the engine plays as one of its rules on an injured, healable ally of `customRangeGrid` — 黍 S3 (data/backups.json): official `TRY_SEARCH_ALLY_SKILL` ("技能范围内存在可治疗的我方单位时释放技能") → `SKILL_RANGE` on its x-2 (`tools/build-data.mjs TRIGGER_ALLY_RULES`). |

### 2.1 Combat classification heuristic (`dmgType` / `attackKind` / `projectile` / `canHitFly`)
- `dmgType`: MEDIC (except `incantationmedic`) and `bard` → `heal`; trait text containing 法术伤害 or profession CASTER → `arts` — but a trait whose 法术伤害 comes only with a running skill ("技能开启时普通攻击会造成法术伤害": 驭法铁卫, 斩业星熊) keeps the normal attack's `phys` (display / the bot; the kit switches to arts while a skill runs; 0.2.0); else `phys`.
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
  DEFAULT. `customRangeGrid` of `CUSTOM_RANGE` from `skillRangeDict[skillId]`. Last, the owner's rule of 2026-10-05 (a
  deliberate deviation): a MANUAL operator skill on DEFAULT (no row, or a DEFAULT entry of `TRIGGER_DEVIATIONS` /
  `STANDIN_TRIGGER_DEVIATIONS` — 深巡 S2) or on the `SEARCH` row (the owner's decision of 2026-10-05 too) whose attack
  range while it runs — its `rangeId` grid when the text is an attack-range change, else the operator's range grown by
  `ability_range_forward_extend`; never "被动效果：攻击范围扩大" (引星棘刺 S3) — strictly contains the record's own
  `rangeGrid` is `ACTIVE_RANGE` with `customRangeGrid` = that running range (`activeAttackGrid`, `ACTIVE_RANGE_OVER`;
  stand-in forms alike). (Research 03 Addendum C1 read the rows'
  `skillIndex 0` as "skill 1 only" after BWIKI's transcription; superseded by user playtest #6.)
- `modules[]` (golden, `equipLevel > 0`): every **ADVANCED** `uniequip` of the character (the INITIAL `uniequip_001_*`
  is "no module" = choice `'none'`), in official order, at the chess `equipLevel` (1, T6: 3):

| Field | Example (`chess_char_6_11_b`) | Meaning |
|---|---|---|
| `uniEquipId`, `name`, `typeName`, `typeIcon`, `icon` | `"uniequip_003_mlyss"`, `"落叶四季"`, `"TAC-Y"`, `"tac-y"`, `"uniequip_003_mlyss"` | |
| `isDefault`, `level` | `false`, `3` | default = `defaultUniEquipId` (= `module.id`) |
| `attr` | `{"maxHp":170,"atk":28,"def":28}` | flat stat additions (stat field names): `stats = statsBase[f] + attr[f]` (float-noise cleaned) |
| `traitOverride` | `{"desc":"…提升至165%","descRaw":…,"bb":{"atk_scale":1.65},"bbStr":{},"rangeGrid":null,"moduleDesc"?:…}` \| `null` | the full trait with this module (`desc`, then the added line `moduleDesc` when present — see `trait` above); `null` ⇒ `traitBase` |
| `talentChanges[]` | `{"talentIndex":1,"name":"开源节流","desc":…,"descRaw":…,"bb":{"cost":-2,"runtime_cost":-2},"bbStr":{},"rangeGrid":null,"tokenKey":null,"hidden":false}` | talent additions/overrides (`talentIndex` −1 = new hidden data-only talent); applied to `talentsBase` with the build's merge rule (`simdata composeTalents`: override of an existing index merges blackboards, module keys win) |

- `statsBase` / `traitBase` / `talentsBase` — the golden record **without** any module (`stats` / `trait` / `talents`
  keep the default module, unchanged). `test/data.test.js` proves that composing the default module onto the base
  reproduces `stats`, `trait` and `talents` exactly for every golden chess.
- Module-less goldens (蒂比, 凛御银灰): `modules: []`, base = own values. Normal chess have none of these fields.
- Module parts flagged `isToken` and the per-token attribute blackboards go to the summons: `tokens.json →
  variants[owner].byModule` (§14). Module choices never change the combat classification (`dmgType`…; the build warns
  if one ever would).

### 2.3 Potential below full potential: `potDown` and chained talents (0.2.2)

Potential (潜能 1–6) is the player's per-operator setting (干员调配, the owner's decision of 2026-10-08 — default 潜能 6;
official: 调度手册 「卫戍协议中干员潜能由自身已持有干员潜能决定」). Every record is built at **full potential** and carries
what each lower one changes; `shared/potential.js atPotential(rec, potential)` composes the record at a potential
(data rank r = potential − 1, character_table's `potentialRanks[r]` being the step from rank r to r + 1). The same
annotation is on chess records, `backups.json` unit forms (§18) and token variants (`tokens.json` and `backups.json`
`tokens` variants, §14 — the owner's potential; a token record's top-level defaults stay full):

- `potDown`: `{ "<rank>": { "<dotted.path>": value } }` — for each rank 0–4, the exact value at that rank of every leaf
  that differs from the rank above (`stats.*` / `statsBase.*` of a record, `stats.*` of a form; a variant's
  `stats.deployLimit`, `stats.deckStack`, `count`, `bySkill.<i>.count`, `byModule.<id>.stats.*`). Applied from rank 4
  down to the wanted rank, each value overwriting, so every leaf ends at its value for that rank.
- a talent entry (`talents`, `talentsBase`, `modules[].talentChanges`; a variant's `talents` and `byModule[*].talents`)
  that a lower rank changes: `potMin` = the lowest rank it holds for, `potBelow` = the fields the entry below it
  changes (`desc`, `descRaw`, `bb` …), itself chained the same way — the candidates by `requiredPotentialRank`
  (刺玫's 土壤基肥改良 `potMin` 4: 11% → 8%; Mon3tr's 不毁重构 below its owner's rank 4: 3 s / 1200).

`tools/build-data.mjs` runs the chess / backups / tokens builders at every rank (`ctx.potRank`) and annotates the
full-rank build from the others; the build fails unless `atRank` rebuilds every rank exactly, and the unit-form parity
(§18) holds at every rank. Nothing else depends on potential (no skill, trait or list length). The data translations
(`data/i18n/*.json`) translate the chained texts too. 练度 (the 自持有 bonus) is no record field: it is the
`char_attribute_mul` of the effects.json CHAR_MAP records `aceffect_char_1…4` (§7), applied to the unit.

---

## 3. `bonds.json` — `{ [bondId]: Bond }` (23 bonds, 8 core)

| Field | Example (`deputShip`) | Meaning |
|---|---|---|
| `bondId`, `name`, `identifier` | `"deputShip"`, `"助力"`, `14` | |
| `isCore`, `bondType`, `bondOrder`, `powerIdList` | `false`, `"REGULAR"`, `2`, `[]` | core = `isPower` (SEASON); `powerIdList` = nation/group/team ids for DIY bond derivation (`backups.json diy.operators[*].bonds`, §18) |
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

Types: `BAND_INITIAL` 41, `BOND` 23, `EQUIP` 115, `ENEMY_GAIN` 129 (悬赏), `BUFF_GAIN` 43 (战术决策), `ENEMY` 6 (`aceffect_enemy_*` global modifiers), `CHAR_MAP` 4 (角色练度映射 — the 自持有 练度 tiers `aceffect_char_1…4`, 未精英化 / 精英阶段1 / 精英阶段2 / 精英阶段2-60级, in `autoChessData.cultivateEffectList` order: their `char_attribute_mul` buff — `atk` / `def` / `max_hp` 1, 1.05, 1.1 — is the unit's 练度 multiplier, `shared/potential.js cultivateMul`, 0.2.2).

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
| `pools[poolId]` | `{"kind":"equip","items":[…]}` / `{"kind":"chess","tier":2,"rule":"shopEligible"}` | server-side reward pools referenced by effects (`pool_equip_*`, `pool_chess_shop_N_reward`, `pool_char_later`, …), all [ASSUMED]; `rule:"shopEligible"` = visible/non-hidden entries, `maxTier:"shopLevel"` = ≤ current shop level, `weighted` = `[[id, weight]]`. `pool_equip_vict` (维多利亚, every 25 layers: "获得一件带有随机特殊效果的维式重锤") and `pool_equip_rockr` (洛洛's 定制品; user playtest #4 — the research 04 §8 guess 有限加速器 / 激光发射器 / 护盾无人机 / 双模机械臂 / 蜂鸣器 is superseded) = the 4 special 维式重锤, uniform. `pool_equip_kathe` and `pool_equip_narant` omit `maxTier` (every shop-eligible tier, uniform [ASSUMED]; 见者有份 §32.14.8). `pool_equip_kathe.also` is 突变细胞 (`chess_item_5_08_e_a`), appended by `Match.rollItemId` at the same uniform weight [ASSUMED] and at any 调度中心 level (#631, §32.14.24); the shop item slot does not read `also`, so 突变细胞 stays `shopExcluded` |

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
| `modelScaleY` | `1.263` (`enemy_1112_emppnt` 帝国炮火先兆者) | **vertically stretched models only** (2 keys, the 先兆者 pair): the official prefab's `Graphic` scale sy ÷ sx — 1.263 because the pair's scale is (0.19, 0.24, 0.24), i.e. the game draws them 26 % taller than `modelScale` (which only carries the horizontal product) implies. The renderer multiplies the skeleton's **Y** scale (and the bar height) by it (render/units.js `enemyModelScaleY`). Not in the game tables: `tools/build-data.mjs MODEL_STRETCH_Y`, read from the local client by `tools/local-extract/enemy_model_offsets.py` (a sweep of all 242 readable enemy prefabs found no other non-uniform one), docs/research/12 §3.1 (PR #211 by @xcdoge; the owner's decision of 2026-10-06) |
| `mirrorX` | `true` (`enemy_1196_msfyin` 木制瑞印) | **mirrored models only** (1 key): the official prefab's `Graphic` X scale is negative (−0.4), so the game draws the authored model flipped; the size pipeline takes `abs(sx)`, and the renderer flips this model on top of the usual direction flip (render/units.js `mirrorX`). Same extraction as `modelScaleY` (`tools/build-data.mjs MIRRORED_PREFABS`) |
| `attackAnim` | `{"clip":"Attack","dur":1,"hit":0.533}` (`enemy_1019_jshoot` 隐形弩手) | the enemy's attack clip — the one the client plays for its attacks (data/assets.json `anims.attack.loop` of its model, not an Idle stand-in) —, its length (s) and first strike frame (`hits`, the OnAttack event; absent when the clip has none). An unblocked ranged enemy stands for this clip at each attack (sim/ai.js `attackStand`, GitHub #58) — any enemy for the rest of it after a strike once its block ends meanwhile (0.2.0) —, and every enemy attack strikes at `hit` after its swing starts — a stun before it cuts the swing (sim/ai.js `attackWindup`, 0.2.0). 213 keys; absent = no attack clip known (御4, 寒霜, the 岁 relics …: the sim keeps `ATTACK_PAUSE`). Not in the game tables: `tools/build-data.mjs enemyAttackAnim` reads the committed asset manifest (tools/fetch-assets.mjs, from the Spine skeletons) |
| `attackMoves` | `true` | **「不停止移动」 attackers only**: the handbook ability text says it attacks on the move (“十字路口”量产型's 四向攻击) — it never stops to attack (sim/ai.js `attackStand`). No enemy of the mode has it (build-data `attacksOnTheMove`) |

## 10. `factions.json` — special enemies (特训敌人)

| Key | Example | Meaning |
|---|---|---|
| `templateSlots` | `{"N":"enemy_1422_lrsldr","E":"enemy_1427_lrnazg","S":"enemy_1425_lrcmra","NF":"enemy_1005_yokai","EF":"enemy_1042_frostd","SF":"enemy_1040_bombd","T":"enemy_1000_gopro_2","TF":"enemy_1041_lazerd"}` | placeholder keys in wave templates |
| `types[type]` | `{"type":"FLY","name":"特训敌人·飞行","desc":"…","icon":"fly_icon","sortId":2,"typeIdentifier":2,"involveRandom":true,"count":3,"weight":3,"pool":[…],"entries":[…]}` | 7 types |
| `entries[key]` | `{"key":"enemy_1041_lazerd","type":"FLY","weight":10,"firstHalf":true,"fly":true,"N":[{"key":"enemy_10083_hlbird"}],"E":[{"key":"enemy_1005_yokai_2"}],"inactiveIn":[]}` | 67 entries (`specialEnemyInfoDict`); `fly` = the movement class shared by the special, normal and elite keys; `inactiveIn` = modes whose `inactiveEnemyKey` bans the SPECIAL key (attached keys are never filtered) |
| `handbookLevels[]` | `{"level":"E","maxHp":[0,1000],"atk":[0,200],"def":[0,100],"res":[0,1],"moveSpeed":[0,0.3],"interval":[6.9,null],"elementRes":[0,1],"elementDmgRes":[0,1]}` | the enemy handbook's 10 letter grades, E … SS weakest first (`enemy_handbook_table.levelInfoList`): per stat the official `[min, max)` band (`null` = open-ended); `interval` is the attack interval in seconds (the table's `attackSpeed`: a shorter interval is the higher grade). Display only: the 敌方图鉴 grades each stat by its band (`screens/sweep.js enemyGrade`) |
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

## 12. `stages.json` — `{ [stageId]: Stage }` (11 terrains, 8 active, + the 2 escaped levels' maps)

The 11 battle stages of `stageDatasDict` — every field of a match is fought on its stage: the own boards, the boss fields
and the 联防 field (both halves, `GEO.UNITE_RECT`; the owner's decision of 2026-10-07) — then the maps of the two escaped
levels: act2autochess constData `escapedBattleTemplateMapSinglePlayer` / `MultiPlayer` name the level of the 联防 wave
(`level_act1autochess_escaped_single` / `_multi`, the wave templates of the same id in `waves.json`). Their map is the
placeholder grid every wave template level carries, tile for tile (the round templates `01…07` and `h01…h08`, the
training `trXX` too): two road halves (cols 3–9 and 11–17, rows 9–12) joined at col 10, the objective at (9,2), no devices or
special terrain. 0.2.0 fought the 联防 battle on it (GitHub #41); no field uses these two records since 0.2.1 — they stay
as official level data, and sim tests use them as a plain two-halves road.

| Field | Example | Meaning |
|---|---|---|
| `id`, `name` | `"act2autochess_m01"`, `"战场#05(下半) 源石流发生装置"` | player-facing name from research 05 (the official tables carry none; falls back to id). The build drops bracketed segments containing Latin letters (research notes such as `战场#01 (upper half #01)` → `战场#01`), logs a warning, and fails validation if Latin text remains. The escaped levels' maps: `联防阵地（1名玩家）` / `联防阵地（2名玩家）`, the remake's own label [ASSUMED] (no table or PRTS page names them; no screen shows it) |
| `weight`, `active`, `modes` | `50`, `true`, `["mode_single_normal",…]` | match-start pick weight (act1 m05–m07 weight 0); the escaped levels' maps: `0`, `false`, `[]` (never a match stage) |
| `kind`, `helpers` | `"unite"`, `1` | only on the escaped levels' two maps: the helper count of their wave template (= `config.unite.templates`; the build fails when they disagree); no field is fought on them |
| `size` | `[19,21]` | |
| `rows[]` | `rows[9] = "##Errr#rrrSrrr#rrrS##"` | 19 strings, **index = row (0 = bottom)**, one glyph per col |
| `tiles[glyph]` | `{"tileKey":"tile_road","height":"LOW","buildable":"ALL","passable":"ALL","groundPassable":true,"flyPassable":true,"special":null,"bb":{}}` | actual tile properties of each glyph used. `buildable` is the **effective** deploy type: the level's buildableType, except a tile whose mechanism refuses deployment — 深水区 `tile_deepsea` (PRTS 深水区 地形信息 "部署类型 全部位 … 地形机制 拒绝部署（待补充）"; player report #3 after 0.1.0) — which is `NONE` and keeps the level's value in `buildableType` (`server/sim/grid.js DEPLOY_REFUSED_TILES`, shared with the builder) |
| `devices[]` | `{"key":"trap_013_blower","name":"源石流发生装置","alias":"trap_013_blower#001","pos":[13,5],"dir":"DOWN","hidden":false,"role":"blower","active":true,"stats":{…},"rangeGrid":[[0,0],…],"rangeTiles":[[13,5],[12,5],[11,5],[10,5]],"skill":{"skillId":"sktok_blower","bb":{"blower_s_character[equal].atk":0.3,…}},"desc":null}` | predefined devices; `role` ∈ crate, platform, mound, blower, mireController, tideController, turret (双眼皮, activated by band 机械援助), coldWind, sandstorm, waterPlatform, sealedFloor, bush, bossSpawn; `active` = present at match start (= not `hidden` in the level file); `rangeGrid` is facing right, `rangeTiles` = absolute tiles after rotating by `dir` (RIGHT `(dr,dc)`, UP `(dc,−dr)`, LEFT `(−dr,−dc)`, DOWN `(−dc,dr)`), clipped to the grid (null without a range). Terrain cards / band effects toggle devices by `alias` |
| `mapChars[]` | `{"key":"char_605_cmedic","alias":"char_605_cmedic#1","pos":[10,2],…}` | band_amedic map characters (→ `tokens.json`) |
| `special` | `{"mire":{"intervalSec":1,"aspdPerStack":-0.05,"moveMulPerStack":-0.05,"maxStacks":10,"heavyWeight":3,…}}`, `{"infection":{"bb":{"damage":70,"atk":0.2,"attack_speed":20,"duration":300}}}`, `{"deepsea":{"skillId":"sktok_tidectrl_3","bb":{…}}}`, `{"smog":{"rule":"operatorsNotTargetableByEnemyRanged"}}`, `{"blower":{…}}` | special-terrain parameters |
| `runes[]`, `globalBuffs[]` | `{"key":"map_tile_blackb_assign","bb":{…},"bbStr":{…}}` | level runes (act2 m03 reed rune has no reed tiles — leftover) |
| `deployTiles` | `{"normal":{"melee":[[9,3],…],"rangedOnly":[[10,4],…],"changedByDevices":[…]},"bossLeft":{…},"bossRight":{…}}` | deployable tiles at match start: `melee` = LOW (effective) buildable ALL/MELEE (ranged may use them too) — and a 深水区 under an active 特制水上平台 (`waterPlatform`, "在水上建立可以部署任意单位的平台"; act1 m05 only — the prep's deploy map only: the sim does not model the canoes, so its Grid keeps those tiles NONE, automatic placements avoid them and the path tie-break counts them as non-blockable [ASSUMED, weight 0 this season]) —, `rangedOnly` = high ground / active platforms; tiles under active crates/mounds and the 深水区 excluded. `bossLeft` / `bossRight` (field coordinates, boss rows 1–5) are what a player may deploy on in a boss round's prep: board (r, c) = boss (r − 7, c) / the right half mirrored (r − 7, 20 − c) (server/match/board.js `field`, user playtest #5 item 7) |
| `groundPaths` / `groundPathsWithDevices` | `{"12,10->9,2":[[12,10],[12,9],…,[12,3],[11,3],[10,3],[9,3],[9,2]]}` | the ground route of the sim's own `server/sim/grid.js` flow field (research 08 §3.4: 4-direction SPFA from the goal, crates cost 1000, Bresenham line-of-sight smoothing — official route lengths — kept unless the remake's (0.1.0's) road-over-floor preference route crosses strictly fewer non-blockable floor / gate / 深水区 tiles and no more 深水区 (GitHub #375) — the fewest among equal-length chains, smoothing that never cuts across floor its grid route does not walk; a corner touch does not count as a crossing — e.g. 战场#01's lower gate takes the col-8 road, not the col-9 floor lane, while 战场#04's keeps the official diagonal from row 9 into row 10; DESIGN §14 corrections, test/sim/pathing-official.test.js) as the tiles an enemy crosses, over the whole map, without / with the match-start devices (crates cost 1000, platforms / mounds blocking [ASSUMED]); the battle re-reads its flow fields live |
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
| `profession`, `subProfessionId`, `position` | `"TOKEN"`, `"notchar1"`, `"MELEE"` | `position` = the token row's, except where PRTS records the client's row as wrong (`tools/build-data.mjs TOKEN_POSITION_CORRECTIONS`): 望's 棋子 `ALL` (PRTS 棋子 部署位置 "全部位", 备注 "游戏内召唤物信息与实际不符（显示为仅部署在近战位）") — the prep's placement class (board.js `positionClass`) |
| `displayType`, `placeable` | `"DEFAULT"`, `true` | `shopStateTokenDict` DEFAULT / HIDDEN (battle-only) / `null` (not listed). `placeable` (a prep hand piece) = a manually deployable summon (PRTS 卫戍协议/帮助 "可手动部署的附属召唤物…加入手牌区"; user playtest #6): not HIDDEN and made by an owner's talent or skill — 医疗探机 (赫默 S2), 诅咒娃娃 (巫恋 S2), 海嗣, 狼群, 流形 and 爬行号·防护单元 (凯瑟琳's talent device — the only pool summon missing from `shopStateTokenDict`, read as shown: placed by hand in the base game, by the friend's report, and confirmed by the user after playtest #6, DESIGN §20); 投递坐标 (HIDDEN) is not; nor is a summon no owner shows (its `display` source, the owner's displayTokenDict — a skill's own object: every such summon is HIDDEN but 予愿安洁莉娜 S3's “一会儿见！”, which the shop state does not list; PRTS 予愿安洁莉娜 S3 备注, 0.2.0). In battle a skill's summon deploys once at the battle start, then on its tile each time the skill gives one (SIM.md, token pieces) |
| `ownerRange` | `true` | the token text reads "只能部署在召唤者攻击范围内" (`desc`; the tacticians' 援军 — 狼群, 流形; PRTS 狼群 特性) — or, data/backups.json, an owner's talent naming the token reads "可以在攻击范围内(的地面)部署 / 使用…" (Mon3tr's 重构体; 莱伊's 沙地兽 says both): its hand piece may only stand on a tile of its owner's attack range (server/match/board.js `ownerRangeKeys`, `PlayerState._legal`, the client's `gameLogic.summonRange`; player report #9 after 0.1.0). `false` for every other token |
| `ownerRangeOutside`, `rangedTilesOnly` | `true` (present only then) | data/backups.json: the token text reads "部署在…攻击范围外" / "仅可以部署在…远程位" — 凯尔希·思衡托's 战术锚点 "仅可以部署在凯尔希·思衡托攻击范围外的远程位" (PRTS 战术锚点 特性): its hand piece may only stand outside its owner's attack range (`PlayerState.summonExcluded`, the client's `gameLogic.summonExcluded`) and on a ranged (高台) tile (board.js placement class `high`; the mode's "所有行动内远程干员可部署在近战位" is an operators' rule [ASSUMED]) (0.2.0) |
| `owners[]` | `["chess_char_3_19_a","chess_char_3_19_b"]` | |
| `stats`, `rangeGrid`, `dmgType`, `attackKind`, `projectile`, `canHitFly` | first owner's values | defaults |
| `skill` | `{"skillId":"sktok_vigil_wolf_3","bb":{…}}` | default token skill (same slot as the owner's skill) |
| `deployLimit`, `count` | `1`, `1` | `deployLimit` = the first owner's `stats.deployLimit`. `count` = copies sent to the hand / spawned (talent/skill `cnt`); `null` ⇒ use `deployLimit` |
| `abnormal[]` | `["healFree"]` | abnormal effects the summon holds from the start, no official table carries them — `tools/build-data.mjs TOKEN_ABNORMAL` from the PRTS summon pages (user playtest #6 item 18): `healFree` = 禁疗 (“小自在”, “耀阳”, 斯卡蒂的海嗣, 沙之碑, 流形, 狼群, 迷迭香的战术装备, 黄金盟誓, 保护目标（冻结状态）), `isolated` = 孤立 "无法被同阵营选中" (“炎佑”, 从不混淆的方向); `[]` otherwise. The sim sets `noHeal` / `isolated` (docs/SIM.md §3) |
| `variants[ownerChessId]` | `{"phase":2,"level":1,"stats":{…},"immunities":{…},"rangeGrid":…,"trait":{…},"dmgType":…,"skill":{full skill record},"talents":[…],"count":1,"sources":["talent","display"]}` | stats at the owner's phase/level (clamped to the token's max level) — **none of the owner's potential attribute modifiers** (a token has no potential ranks) — + golden module `tokenAttributeBlackboard` + the token's own talent additions to `deployLimit` / `deckStack` (blackboard `max_deploy_count` / `max_deck_stack_cnt` — the hidden "TOKEN数" talent of 麦哲伦's / 令's summons and 白铁's devices, 夜莺's 幻影; a module token part of the same talent replaces it: `tools/build-data.mjs tokenTalentDeckBonus`, 0.2.0 — no tokens.json summon has one; PRTS 幻影 备注 "最大可部署数量为3", the owners' "最多同时部署3个"); its `talents` / `trait` candidates are picked at the **owner's potential** (full; their `requiredPotentialRank` mirrors the owner's 「天赋效果增强」 — 夕's “小自在” 18 层, 凯尔希's Mon3tr, 望's 棋子 +1 持有 / 部署 — and the variant chains the lower ones, §2.3: `atPotential(variant, ownerPotential)`); the owner's module parts flagged `isToken` upgrade the variant's `trait` (+`moduleDesc`) and `talents` (伺夜's wolves, 缪尔赛思's 流形 `scale` 1, 浊心斯卡蒂's 海嗣 30 s, “耀阳” `atk_scale` 1.15). `sources` ⊆ `talent`/`skill`/`display`: how the owner produces it (`display` only = listed on the character but unused by its default skill/talents, e.g. 迷迭香 S2, 凛御银灰 eagle1/3). `count` = copies from a talent `cnt` or the default skill's `cnt` when that skill overrides this token; `null` ⇒ use `deployLimit` |
| `variants[o].bySkill[i]` | `{"skill":{…},"count":1,"sources":["talent","display"]}` | owner loadout with the non-default skill index `i` (one entry per other selectable owner skill): the token skill of that slot (伺夜's wolves, 缪尔赛思's 流形, 凛御银灰's eagles…), the count and how the chess then produces it (`sources` may be `[]`: 风丸 S1 makes no 纸偶; 赫默 / 巫恋 S1 only `display` ⇒ no hand piece). The sim resolves them for an owner loadout: `simdata getToken(id, ownerChessId, loadout)` → `def.sources` / `def.count` |
| `variants[o].byModule[m]` | `{"stats":{…},"immunities":{…},"trait":{…},"talents":[…]}` | golden owner with another module `m` or `'none'`: the token as that module makes it (module `tokenAttributeBlackboard`, `isToken` trait/talent parts) |
| `assets` | `{"avatar":"token_10028_vigil_wolf","spine":"token_10028_vigil_wolf"}` | |
| mapChar extras | `phase`, `level`, `trait`, `talents`, `positions:[{"alias":"char_613_acmedc#2_multi_only","pos":[10,10],"dir":"RIGHT","multiOnly":true}]`, `source` | |
| bondSummon extras | `bondId`, `motion`, `skills`, `talents`, `assets.isEnemyModel` | 炎佑 base template (600 ATK / 12000 HP; 第一期上半 V1_1: 300 / 6000, skills' cooldown 25 s instead of 15 s and `2.ep_damage_scale` 1.15 instead of `2.damage_scale` (its 炎 text: 15% 元素脆弱), DESIGN §35.22.5); at battle start 30 % of the 炎 operators' ATK / HP sums are **added** to it (PRTS "（最终加算）", bonds.yanShip; the 9-炎 ATK ×1.5 on the whole ATK [ASSUMED]) |

---

## 15. Anomalies found while joining (also in `.cache/build-data-report.json`)

1. **凛御银灰 container token** `token_10057_svash2_eagle` (talent tokenKey) is not in `character_table`: the talent's
   `tokenKey` is remapped to the default skill's token (S2 → `…_eagle2`, `containerTokenKey` keeps the official id).
   `…_eagle1/3` stay listed (`sources:["display"]`, belong to S1/S3). With another skill selected (DESIGN §16) the
   talent follows that skill's eagle (`simdata loadoutRecord`; `variants[o].bySkill[i].sources`).
2. **DIY chess** (`chess_char_5_diy1/2`, `chess_char_6_diy1/2`, `_a` and `_b` = 8 records): no `charId`, no stats/skill; `visible:false`,
   name placeholder `甄选干员`, not in the shop. Their picks and bond rule are in `backups.json diy` (§18); a slot fights
   only as a 自选 piece — a PlayerBattleInput entry with its `diy` pick (docs/SIM.md §12; shared/diy.js) — and a slot
   without a legal pick fields nothing. Played since 0.2.0: the player fills the slots on the 自选编队 tab (`room.diy`)
   and its own shop sells them (server/match/player/diy.js; §18).
3. **Module-less chess**: 蒂比 (`chess_char_2_13`) and 凛御银灰 (`chess_char_5_14`) have no module; their golden
   record has `module:{id:null,active:false}` and no module stat bonus.
4. **Hidden chess (17)** are kept with `visible:false`; several operators exist in two tiers with one hidden
   (锡人, 耶拉, 录武官, 白面鸮, 百炼嘉维尔, 魔王, 华法琳, 妮芙).
5. **Every non-DIY chess (258 records: 129 normal + 129 golden) has a resolvable default skill, stats and range** — no
   skill anomalies.
6. **Skill triggers** (§2.2): the class rows cover every MANUAL skill of the class (all 重装 MANUAL skills are
   `TAKE_DAMAGE` but the six of the deliberate deviation, DESIGN §21.29, which are `DEFAULT` with `rawRule` `TAKE_DAMAGE` (深巡 S2 then `ACTIVE_RANGE`), and 余 S2, `SKILL_RANGE` on its x-1 (DESIGN §22.10); 薄绿 / 卡涅利安 / 蜜蜡 S2 and 玛恩纳 S1 `SEARCH`; 伺夜 / 魔王 / 浊心斯卡蒂 S3 `SP_FULL`) and no AUTO skill (古米 /
   雷蛇 / 瑕光 / 塞雷娅 / 号角 / 信仰搅拌机 S1, 伺夜 S1/S2, 魔王 S1); 13 MANUAL skills (26 normal + elite records) with
   their own 技能范围 are `SKILL_RANGE` (德克萨斯 S2, 凛御银灰 S2, 锏 S2/S3, 异客 S3, 忍冬 S2, 焰尾 S2 …); 余 S2 joins them by the §22.10 deviation, 14 skills / 28 records in the data; 39 MANUAL skills (78 records) whose
   running attack range strictly contains the operator's own are `ACTIVE_RANGE` (the owner's rule of 2026-10-05; 莫斯提马 S3,
   银灰 S3, 史尔特尔 S2 / S3 …; from the `SEARCH` row 薄绿 S1, 蜜蜡 S1, 卡涅利安 S3, 玛恩纳 S2, 安洁莉娜 S3, and 深巡 S2 over
   its deviation), plus 预备干员 Touch S2 / S3 and Raidian S3 in `backups.json`.
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
17. [ASSUMED] content (flagged in data): 机变 family schedule and server pools, title criteria, income cap 12, per-turn
    band-draft timer 50 s (`timers.bandTurn`, the step's only countdown — user playtest #4; 50 from the owner's
    official-play report of 2026-10-10), the shop-only item list
    (`SHOP_EXCLUDED_ITEMS`, from play), the alive / 4 proportion of the fixed pool's optional alive scaling
    (`bossHpScale.aliveAssumed`; `aliveScaling` off). The special-enemy generator, the leader table (`bloodPoint`, one
    pool for every field) and the 联防 timing are official; the pool's × players alive is the owner's decision of
    2026-10-06 (PR #209: players' observation, no official text).
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

`chess 266 (112 visible; 283 selectable skills over the visible chess, 189 module choices over 129 goldens; 74 PRESET / 55 NORMAL / 4 DIY base chess)`, `bonds 23`, `garrisons 249 (43 effect keys)`, `items 115`, `bands 40`, `effects 361`,
`enemies 249`, `factions 67 entries`, `waves 38`, `stages 13 (11 battle fields + 2 escaped; 8 active)`, `bosses 10`, `tokens 22`, `choice events 109`,
`bounty cards 129`, `tactic cards 43`, `backups: 92 units (17 stand-ins, 75 owned-6★ picks; 268 forms), 38 自选 summons, 4 DIY slots, 15 / 9 prototype picks (tier 5 / 6), 75 owned-6★ picks (7 collab operators excluded)`, potential (§2.3): `256 chess records, 219 forms / variants with potDown; 442 + 401 + 19 chained talent entries (chess, backups, tokens)`.

## 17. Integrity guarantees (checked by the builder and `test/data.test.js`)

The reusable reference pass is `shared/plugins/validate.js validateReferences`; official counts and source-specific assertions remain in `tools/build-data.mjs validateAll`. P1b `validateData` additionally checks the shape and behavior references of merged plugin data.

Every PRESET chess is its own backup and the stand-in builder gives it back field for field (§18); every NORMAL chess
(both forms) composes into its stand-in with an unlocked backup skill and, on the elite form, its module at that level;
every DIY prototype pick has a form for both slot statuses and its locked skill / module there; every owned pick has
both slot forms with its three skills, every module of the character at the elite's stage and a `tokens` variant per
summon; derived DIY bonds exist; no 自选 summon id is a tokens.json record (`test/backups.test.js` also re-derives the
backup fields, the stand-in numbers, the owned pool and the faction ids from the raw tables).
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

## 18. `backups.json` — 补位 stand-ins and 自选 (DIY) data — `{ units, tokens, diy }`

The data of two official features: **补位** — a NORMAL chess whose operator the player does not own is fielded as its
official stand-in (原型干员); played since 0.2.0: the player marks operators as not owned on the 干员持有 tab
(`room.ownership { notOwned }`, DESIGN §25.3, docs/PLAYING.md §3), the match fields those chess with
`standIn: true` — and **自选编队** — two tier-5 and two tier-6 DIY slots, each filled with a 6★ the player owns or a
prototype. Built by `tools/build-data.mjs buildBackups`; `shared/standIn.js` composes it into chess-shaped records,
`shared/diy.js` adds the 自选 rules on top. The sim fields both (docs/SIM.md §12). Played since 0.2.0: the player fills
the four slots on the 自选编队 tab (`room.diy { picks }`, docs/PLAYING.md §3; shared/protocol.js checkDiyPicks keeps the
legal picks), the match takes the picks the seat had at its start (`PlayerState.diy`), and each slotted piece is sold in
that player's shop only — its own stock (the tier's pool copies, 8 / 5 [ASSUMED], twice that in co-op like the shared
pool — DESIGN §32.14.31). The ordinary shop draws it from the 调度中心 level `shopLevel`; the promotion reward draws 自选
of the reward tier, one shop level earlier (DESIGN §30.23).
It has no stock when every bond of it is banned this match, and it is the operator for every rule of that player (its data view:
server/match/player/diy.js, docs/META.md §3). The rules in the data (activity_table act2autochess `charShopChessDatas`; PRTS 卫戍协议, 卫戍协议：盟约
下半/PRTS盟约记录):

- PRESET (74, 特许干员) always fields the real operator (`backup.charId` = itself); NORMAL (55) names one of 17 stand-ins —
  the 4★ 预备干员 `char_600–607`, the 6★ `char_608–615` and 领主·Sharp `char_617` (the "其它分支"); DIY (4) has none.
- A stand-in keeps the chess's bonds, 特质, tier, price, merge and status (the elite form uses the same backup at the
  elite row) and fights as `backup.charId` at that status with skill `backup.skillIndex` (fixed by the chess: the same
  character takes S2 on one chess and S3 on another), module `backup.uniEquipId` (null at tiers 3–4 and for every 4★, so
  even their elite form has none) and the row's potential (`potRank` 0 on all 55) — moot: the 17 原型干员 have no
  potential ranks, and a stand-in takes neither the player's potential nor the 自持有 练度 (0.2.2).

`units[charId]` — first the 17 stand-ins, then the 75 owned-6★ 自选 picks (`diy.ownedPool`); no unit for a PRESET or DIY
chess:

| Field | Example (`char_611_acnipe`) | Meaning |
|---|---|---|
| `charId`, `name`, `appellation`, `rarity`, `profession`, `subProfessionId`, `subProfessionName`, `position`, `nationId`, `isNotObtainable` | `"char_611_acnipe"`, `"Stormeye"`, `"Stormeye"`, `6`, `"SNIPER"`, `"fastshot"`, `"速射手"`, `"RANGED"`, `null`, `true` | as on a chess record (`isNotObtainable` false for the owned picks) |
| `assets` | `{"avatar":"char_611_acnipe","avatarGolden":"char_611_acnipe","portrait":"char_611_acnipe_1","portraitGolden":"char_611_acnipe_1","spine":"char_611_acnipe","subProfIcon":"sub_fastshot_icon"}` | art ids (URLs in `data/assets.json`, which carries all 89 — the owned picks since 0.2.0, ASSETS.md); the elite form takes the E2 art when it exists — of the stand-ins only 领主·Sharp has it, every owned pick does |
| `moduleNames` | `{"uniequip_001_acnipe":{"name":"Stormeye证章","typeName":"ORIGINAL"},"uniequip_002_acnipe":{"name":"Stormeye证章","typeName":"MAR-X"}}` | every module of the character (a composed record names its module on the normal form too) |
| `standsIn[]` | `["chess_char_3_21_a","chess_char_4_02_a","chess_char_5_18_a","chess_char_5_22_a","chess_char_6_01_a","chess_char_6_05_a"]` | the NORMAL base chess it replaces (`[]` for an owned pick) |
| `forms[statusKey]` | keys `"2/1/4/0"`, `"2/60/7/1"`, `"2/60/7/3"` | the character at every status it fights at — of the chess it stands in for and of the DIY slots it may fill (`statusKey(status)` = `phase/level/skillLevel/equipLevel`): 3 forms per 6★ (an owned pick: exactly the three DIY slot statuses — E2 Lv1 skill rank 4 without a module, E2 Lv60 rank 7 with every module at stage 1 and at stage 3), 2 per 4★ |

A **form** holds the operator fields of a chess record with **nothing selected**: `status`; `stats`, `trait`, `talents`
**without** a module, at full potential as on a chess (`potDown` / chained talents for the lower ones, §2.3); `immunities`, `rangeId`, `rangeGrid`, `dmgType`, `attackKind`, `projectile`, `canHitFly`,
`targetPriority`; `placeOnRanged` (present only when that Chinese trait contains 「可以放置于远程位」 — 温蒂's forms — or a compact MELEE plugin form sets `true` [ASSUMED]; the composed 自选 record copies it, GitHub #676); `skills[]` — every skill unlocked at the status, at its skill level, `trigger` resolved per skill, `passiveRange` when that skill's Chinese text is its own range (GitHub #700), no
`isDefault`; `displayTokens` / `tokens` (summons — none of the 17 stand-ins has one; 27 of the owned picks do, their
records in `tokens` below); at `equipLevel > 0` `modules[]` (§2.2 shape without `isDefault`). `buildUnitForm` uses buildChess's helpers and rules, and the build fails when `buildUnitForm` +
`composeUnitRecord` do not give back every PRESET chess field for field (each is its own backup), so a later change to
buildChess that the stand-ins would miss stops the build. The chess trigger deviations (§2.2, DESIGN §21.29) name chess
and never apply to a form; the 重装 stand-ins have their own, by charId (`tools/build-data.mjs STANDIN_TRIGGER_DEVIATIONS`,
the owner's decision of 2026-10-05 in the approved 补位 plan): every skill of 预备干员-重装 and Mechanist is `DEFAULT` —
cast with an enemy in range — with `rawRule` the official `TAKE_DAMAGE`, on every form.

**Composition** (`shared/standIn.js`, pure ESM for the server, the sim and the client): `standInRecord(chess, backups)` is
the NORMAL chess as its stand-in — `IDENTITY_FIELDS` (ids, tier, `isHidden` / `visible`, `chessType`, `backup`, `bonds`,
`garrisonIds`, prices, merge, `status`) from the chess, every other field from the unit's form at the chess's status
with `backup.skillIndex` / `backup.uniEquipId` as the defaults, plus `standInFor` (the replaced charId: the official 补位
mark on the avatar). The result is shaped exactly like a chess record (`skill` = the `isDefault` entry of `skills[]`;
elite `statsBase` / `traitBase` / `talentsBase` / `modules[]`), so `normalizeChess`, `resolveLoadout` (no loadout ⇒ the
backup selection) and `loadoutRecord` read it unchanged; null for a PRESET or DIY chess. `isDroppableChess(chess)` says
which chess a player may mark as not owned (the 55 NORMAL base chess; `shared/protocol.js checkNotOwned` keeps those of a
`room.ownership` list). **In the match** (`server/match/player/basics.js`: `PlayerState.standIns`, `fieldsStandIn`,
`fieldRecord` = `gd.standIn(id)`) the player's piece keeps the chess's identity for every meta rule (price, bonds,
特质, merges, pools) and is deployed as the stand-in (placement class, summon / bot ranges; no summons — none of the 17
has one); what shows the piece shows the stand-in (the prep scouting art of board and bench pieces, the m.result
lineup's `standInFor`, the elite and gift tickers' names — the owner's recall of the official mode, 2026-10-06). **In battle** a PlayerBattleInput entry with `standIn: true` (PlayerState.battleInput:
the player's own field, 联防 and the boss fields alike) is fielded as `getChess(chessId, { standIn: true })` (docs/SIM.md
§12: this record, normalised), and its kit is found by its `charId` (`server/sim/content/index.js kitOf`;
kits/README.md "Stand-in kits") — never by the chess id it keeps, which names the replaced operator's kit. The client
composes the same record (`public/js/ui/gameLogic/standIn.js standInOf`, the renderer's `data.standIn`) to show the
stand-in on the shop / reward cards, the own pieces' models (hand, 临时整备区, board), the detail card, bond popups and the
result lineup, with a small 「替补」 mark.
A 自选 piece is composed by `shared/diy.js`:
`checkDiyPick(slotId, pick, data)` checks one pick `{ charId, skillIndex?, uniEquipId? }` against a slot (a pick of the
slot's tier; a prototype takes its `diy.locked` selection, another skill is refused; an owned pick names one of its three
skills and optionally a module of its elite form at the slot's stage), `diySlot(id, data)` names a slot's tier, elite
twin and `shopLevel`, `diyRecord(slotId, pick, { elite, data })` /
`diyRecordOf(slot, pick, data)` give the record — the slot's identity (tier, price, merge, status; no 特质), the pick's
derived bonds, the operator's form at the slot's status with that skill and module (active on the elite only), plus
`diyFor` = the slot's base id —, `diyPool(tier, { data, kitted })` the legal picks of a tier (prototypes, then the owned
pool; with `kitted`, only operators with a kit: server/sim/content/kits/index.js `KITTED_CHARS`) and
`validateDiyPicks(picks, { data, kitted })` a roster (a prototype may fill a tier-5 and a tier-6 slot, an owned operator
one slot, the picks of a tier differ, no module of another game mode — `isDiyModule` / `DIY_EXCLUDED_MODULE_TYPE`: the
集成战略 modules ISW-A (凯尔希, 傀影, 菲亚梅塔, 提丰, 艾丽妮, 霍尔海雅) and SO-A / SO-B (电弧, 机械师 — "在【岁的界园志异】中",
"在【沉沦者的黑流树海】中") and the 生息演算 module RA-A (森蚺) are never a player's choice [ASSUMED], the owner's decision of
2026-10-05 for ISW-A and the same reason for SO / RA, while the record and the sim still compose them for the kits' tests). **In battle** a PlayerBattleInput entry of a DIY slot carries `diy` (the pick) and
is fielded as `getChess(slotId, { diy })` (docs/SIM.md §12); its kit is `KITS[charId]` (kits/README.md "How to add an
operator (自选)").

`diy`:

| Field | Example | Meaning |
|---|---|---|
| `slots[slotId]` | `{"tier":5,"goldenId":"chess_char_5_diy1_b","shopLevel":5,"requirement":"TIER_6"}` | the four DIY chess `chess_char_5_diy1/2_a`, `chess_char_6_diy1/2_a` (chess.json: price 4, sell 1, `diyRequirement`, empty `bonds` / `garrisonIds`); `shopLevel` = the 调度中心 level whose `shopLevelDisplayDataDict.charChessDiySlotIdList` lists the slot |
| `prototypes[tier]` | `{"5":[…15],"6":[…9]}` | the legal prototype picks: the nine 6★ at both tiers, at tier 5 also the six 4★ that are not 先锋 / 特种 ("第5阶可额外从6名四星原型干员（先锋、特种职业除外）中选取"; `DIY_EXTRA_PROTOTYPES`). A prototype may fill a tier-5 and a tier-6 slot ("原型干员可于5、6阶之间重复选取") |
| `locked[tier][charId]` | `{"skillIndex":2,"uniEquipId":"uniequip_002_acguad","from":["chess_char_5_06_a","chess_char_5_13_a"]}` | the skill and module a prototype carries in a slot of that tier — "技能携带规则与系统补位时一致" (PRTS 卫戍协议), read as [ASSUMED] (the owner's decision of 2026-10-05) the selection of its 补位 rows at that tier (`from`): the eight 6★ elites S3 with their own module, 领主·Sharp S1, the reserves S3 without a module; 预备干员-医疗 has no tier-5 row: S3 by analogy (`from` `[]`, `DIY_PROTOTYPE_FALLBACK_SKILL`) |
| `ownedPool[]` | 75 charIds | the owned 6★ a player may slot: obtainable, rarity = the requirement, and no chess names it — hidden chess included ("不可甄选加入已在名单中的固定干员"); each at most once per roster ("玩家已拥有干员不可重复选取"). Not the collab operators (`excluded`) |
| `excluded[]` | `["char_456_ash","char_1029_yato2","char_1048_orchd2","char_4123_ela","char_4141_marcil","char_4182_oblvns","char_4217_makoto"]` | the 7 obtainable 6★ outside the pool that come from a 联动寻访 — a collab team in `mainPower` / `subPower` (`DIY_EXCLUDED_TEAMS`: rainbow, action4, mujica, sees, laios — 灰烬, 麒麟R夜刀, 艾拉, 玛露西尔, 丰川祥子, 结城理) or a collab series in `displayNumber` (`DIY_EXCLUDED_NUMBER_PREFIXES` MH / RS / AM / PS / DD — also 焰狐龙梓兰 MH05, whose team reserve6 names no collab): left out of the data and the pool by the owner's decision of 2026-10-05 (copyright); the excel does not exclude them |
| `operators[charId]` | `{"name":"煌","rarity":6,"profession":"WARRIOR","subProfessionId":"centurion","obtainable":true,"powers":["rhodes","elite","yan","victoria"],"bonds":["yanShip","victoriaShip"]}` | every pick (owned pool + prototypes): `powers` = the `nationId` / `groupId` / `teamId` of `mainPower` and of every `subPower` (隐藏势力); `bonds` = the core bonds whose `powerIdList` meets them — one or several — else `economy.fallbackBondId` 协防干员 ("甄选加入的干员会根据其实际阵营所属分配核心盟约，若没有可匹配的则改为分配协防干员盟约"); every prototype gets `["emptyShip"]` |

`tokens[tokenId]` — the summons of the owned picks (38 tokens of 27 operators): a tokens.json record (§14: name, text,
`placeable`, `ownerRange`, `abnormal`, `assets`) whose `variants` are keyed by the owner FORM `<charId>@<statusKey>`
(`owners` = those keys; shared/diy.js `diyTokenOwner`) instead of a chess id — a DIY piece is a slot, and two players may
fill one slot with different operators. A variant is the token at the owner's status for its first skill and no module,
`bySkill[i]` the token skill / count / sources under each other skill, `byModule[id]` each module's token attributes,
trait and talents (`tools/build-data.mjs buildDiyTokens`); simdata `getToken` merges them with the pick as the owner's
loadout. No id is also a tokens.json record.

Not in this data: a player's ownership roster and 自选 picks (browser settings sent with `room.ownership` / `room.diy`),
the DIY stock (per player in the match, `PlayerState.diyStock`: `config.economy.poolCopies` of the slot's tier, doubled in
co-op — no excel field), 助战 borrows (`borrowCount` 20), and a player's potential / 练度 per operator (the 干员调配 settings sent with
`room.loadout`; the forms are built at full potential and carry the lower ranks, §2.3; 练度 = effects.json
`aceffect_char_1…4`).

### Acquisition subsets corrected in 0.2.5 (§30.2)

`tools/build-data.mjs` owns the measured Rockrock/Flametail subset weights from
[路标月报#2](https://www.bilibili.com/video/BV1eLXXBqEgF/). Rockrock: ordinary hammer 10; tremble, undying, haste,
burn hammers 2 each; limited accelerator 1; shield drone and laser emitter 4 each. Flametail: Wild Mane 10,
Ashlock 10, Fartooth 3. Rebuild `choices.json` offline; these weights do not exempt draws from shared availability.
The runtime derives unlimited fixed-gift families from `SERVER_GAIN_EQUIP`; this is a grant-source exemption,
not a zero-occupancy flag or a manually maintained second list in generated data.

## Plugin compact metadata (0.3.1)

Plugin records may carry optional `origin` (official charId/chessId provenance) and `assets.voice` (voice bank ID).
`assets.spine` and other art IDs may differ by form. Pair references, not suffixes, identify normal/elite forms.
Hidden additions retain records with `isHidden: true`, `visible: false` and omit visible pools.
See [PLUGINS §16](PLUGINS.md#16-forge-import) for the compact inputs and [ASSUMED] defaults.


### Plugin-only records (0.3.1)

`server/plugins/gameplayRecords.js` adds namespaced bonds and complete supported item pairs to a content set,
without changing these generated files. Membership is rebuilt from chess records. Operator forms may retain tags
and existing token ids. `server/plugins/officialUnitBuilder.js` exports the import-only `deriveOfficialUnit` helper; `tools/build-data.mjs` shares its
normal builder's stat, potential, skill, talent, range and classification paths; loading it performs no CLI I/O.
See PLUGINS.md for namespaces, limits and the local-table version recorded by Forge imports.

## Official versions (M0)

Presentation is shared across the official builds: `tools/assets/versions.mjs` reads their rosters by charId,
enemyKey and iconId, including backups/DIY, rather than merging reused chess ids. `fetch-assets` plans the union;
`local-extract` fills missing official art and effects. See [ASSETS.md](ASSETS.md#id-scope) and §35.109. Gameplay
data and the default version's existing presentation entries remain unchanged by this asset expansion.

The data side of the official version switch (0.3.2, DESIGN §35.22): besides today's game, 第二期下半, the build produces
the three earlier versions, named by period as the maintainer named them (2026-10-22): 第一期 is the official
`act1autochess` (「卫戍协议：盟约」 上半期活动), 第二期 `act2autochess` (下半期活动), and each period's 上半 / 下半 are its
sub-versions V1_1 / V1_2 and V2_1 / V2_2. (PRTS's 「第一期」 is the 2024 卫戍协议, `act1vautochess`, which is not done.)
A bare 上半 / 下半 here and in code comments keeps the official activity sense (上半 = 第一期 / `act1autochess`, 下半 =
第二期 / `act2autochess`); a period's halves are always written with the period (第一期上半 …) or as V1_1 … V2_2.
**M2 core and kits are in** (DESIGN §35.22.7–§35.22.9): golden and botbench load a selected version, and a version room plays that version's rules and kits. **M1 serves enabled versions** (DESIGN §35.23; "Serving the versions (M1)" below): `server/http/static.js` serves `data/versions/<slug>/` only when the server enables that version. Nothing set enables all four, so those files are served (§35.23.11); a version the server does not enable, and a server narrowed to 第二期下半 alone, still answer 404. `data/versions/` is tracked, so the release zips and Docker carry it (48 files, 15.0 MB on disk, about 1.3 MB zipped). The default version is unchanged — `data/*.json`, `data/i18n/`, the golden corpus, the `cs` formula and a default room's `room.state` are pinned: `test/data.test.js` and `test/golden.test.js` guard the data and the goldens, `test/versions-default-guard.test.js` (G2–G4) the `cs` inputs, the formula, the default room and the welcome's versions list. Its file hashes (G1) were the M0 merge check and were deleted when M1 started (DESIGN §35.22.2, §35.23).

**M2 research and rules:** `docs/research/versions/<slug>/02-bonds.json` and `04-items.json` use each snapshot's own
text. First-season `01-core-data.json` supplies the 11-18 blackboard multipliers and preserves 300-second solo prep;
`config.version.rules` is read by the engine/match. Other absent research files still fall back with warnings and are
[ASSUMED], including unmeasured ban/stock/schedule values. See [history §35.22.7](history/0.3.2.md#35227-historical-core-rules-m2)
for the complete list and [the exhaustive blackboard review](research/versions/blackboard-review.json). The following
profile notes describe M0's original fallbacks; the M2 overrides take precedence.

**Registry** (`shared/versions.js`, pure, browser-safe). `DEFAULT_VERSION = 'act2autochess'` is a code constant, never a
server setting: data, rooms and logs without a version mean 第二期下半 (`act2autochess` V2_2).

| id | what | label (msgid; translations [ASSUMED]) | data directory |
|---|---|---|---|
| `act2autochess` | 盟约·下半 V2_2 (2026-03-27 → 04-25), the default | 第二期下半 | `data/` (unchanged) |
| `act2autochess@V2_1` | 盟约·下半 V2_1 (2026-03-14 16:00 → 03-27 16:00) | 第二期上半 | `data/versions/act2autochess-v2_1/` |
| `act1autochess` | 盟约·上半 final, V1_2 (2025-11-25 16:00 → 12-12) | 第一期下半 | `data/versions/act1autochess/` |
| `act1autochess@V1_1` | 盟约·上半 V1_1 with the 11-18 hotfix (2025-11-14 16:00 → 11-25 16:00) | 第一期上半 | `data/versions/act1autochess-v1_1/` |

An id is the official activity id (activity_table `AUTOCHESS_SEASON`), plus `@<versionInfoDict id>` for a sub-version
(`autoChessData.versionInfoDict`: V1_1 from 2025-11-14 16:00, V1_2 from 2025-11-25 16:00, V2_1 from 2026-03-14 16:00,
V2_2 from 2026-03-27 16:00); the id without one is the season's final sub-version. Anything that becomes a path or
a file name uses `versionSlug(entry)` — the last segment of `dir` (lowercase, no `@`), or the id for the default.
`versionOfData(data)` reads `config.version.id`, else the default. The 2024 卫戍协议 (`act1vautochess`) is not a version
(the maintainer's decision of 2026-10-22).

Two deliberate differences from the round-50 design draft (local notes, not in the repository): there is no `data/versions/index.json` (the registry is the
index; M1 reads `shared/versions.js`), and a version's directory is named by its slug, not its id (`@` is not safe in
every file system and URL).

**Profiles** (`tools/versions/<slug>.mjs`, loaded by `tools/versions/profiles.mjs loadProfile`, which checks `id` and
`season` against the registry): `{ id, season, pins, adapters, research, tables, config: { hiddenCore, rules? }, expect }`.

- **`pins`**: the Kengxxiao/ArknightsGameData commit each file group is read from (`pins[group] ?? pins.default`;
  `null` = master; the default version is pinned too since 2026-11-02, DESIGN §37.91). Groups: `activity` (`excel/activity_table.json`), `character` (character / skill /
  uniequip / battle_equip tables), `range` (`excel/range_table.json`), `enemy` (`excel/enemy_handbook_table.json`,
  `levels/enemydata/enemy_database.json`), `levels` (`levels/activities/**`). The master table holds no pure 上半: commit
  `12e0a020` (2026-03-10) migrated `act1autochess` to the 下半 schema and replaced the shared `autoChessData`.

  | version | default pin | other pins | why |
  |---|---|---|---|
  | `act2autochess` (the default) | `17759cc8` (2026-10-08, CN 2.7.81: the build of `data/*.json` since 0.2.3) | `character: 08ba2aea` (2026-11-01, CN 2.7.91: 冻河, 国度, 塔露拉 and the modules of 号角, 凛御银灰, 缪尔赛思, 溯光星源) | master's `activity_table` lost the 盟约 season with CN 2.7.91 (卫戍协议·规程: `activity.AUTOCHESS_SEASON` gone, `autoChessData` empty), so the default reads every other file at the last commit it was built from; only the operator tables move on (DESIGN §37.91) |
  | `act1autochess` | `21b1f240` (2025-12-05, 上半 final; its autochess sections equal `fdf34ff5` … `3421eaff`, its levels equal the V1_2 update `23c99d5d`, its range table equals `dcc057f6`) | `enemy: ee2cabff` (the last enemy change inside the season, 12-05) | 第一期下半 is V1_2's final state (DESIGN §35.22): V1_2 opened on 11-25 with `23c99d5d`, and the 12-05 commit added 莎草's module `uniequip_002_papyrs` (elite ATK 412 → 450, DEF 150 → 173), 娜斯提 `char_4212_nasti` to the owned 自选 pool (71 → 72, with 3 tokens), the 自选 modules `uniequip_003_ray` and Mon3tr's `uniequip_001_monstr` / `_002_monstr`, and 10 bond texts. The commit also changed three 上半 battle templates, which the build does not read (灵巧's range check `x-1` → `x-4`, 回收利用's 地面 check, 迅捷作战粮's `_forceFlag`). Whether 11-25 → 12-05 is a sub-version of its own is open for the maintainer |
  | `act1autochess@V1_1` | `8303c922` (2025-11-14, launch: range, enemies, levels) | `activity` and `character: ea164ef7` (the 11-18 hotfix); no enemy pin: `enemy_database` changed again at `23c99d5d`, so V1_2's `ee2cabff` would leak V1_2 enemies | the maintainer's decision of 2026-10-22: V1_1 includes the hotfix (see below). V1_1's levels are the launch's; the V1_2 update `23c99d5d` changed only the three solo hidden-core levels `h08_0X_s`, whose routes end at the 传送 entrance (1,3) instead of the protection point (2,2) (`waves.json` `routes[].end`, 22 values) |
  | `act2autochess@V2_1` | `1457587e` (2026-03-14, the 下半 launch) | none: no file the build reads changed before V2_2 (`86b6e749`; GitHub history per path), the levels changed next at `a24a8ad1` (04-08) | `987b4cd5` (2026-03-17) changed only the battle templates (`battle/buff_template_data.json`, not a build input; among them 精准's ATK, which the sim already gives as the text says), so the directory is the same with or without it: 第二期上半 stands for V2_1 with the 03-17 fix [ASSUMED], as V1_1 includes its hotfix; whether 03-17 is the maintainer's 「第一次改动」 is open (DESIGN §35.22) |

  **The V1_1 hotfix**: `versionInfoDict` counts the 11-18 hotfix (`ea164ef70736ca2d1a356b3bf7b1cd7540960dc1`) as
  V1_1, and 7 of V1_1's 11 days (11-18 → 11-25 16:00) ran on it, so V1_1 is built with it (the maintainer, 2026-10-22).
  Every change the build reads is in `activity_table`, among them: leader HP ×0.75 (Funny / Normal pools; −5…−12.5%
  Hard), `modeFactorInfo.SINGLE` 1.0 → 1.25, `borrowCount` 8 → 20, the enemy effects 攻坚装备II / III
  (`aceffect_enemy_4` / `_5`), 战场 m06 weight 40 → 60, m07 weight 40 → 5 and Hard modes only (taken out of both Normal
  modes: their stage pool drops from 6 to 5, as in V1_2), 墨浪 / 枯朽萃聚使徒 special-enemy weight 10 → 0, the leader
  weight of `boss_2` (假想敌：铳) 5 → 2, 9 more enemies inactive in the Normal modes (one of them, 沉沙 `enemy_1207_sfji`,
  also in the Funny modes), and 拟态物质's `effectDesc` (`eff_acarm069` and the golden `eff_acgarm069`:
  "若已拥有至少2名该干员，则再获得1名该干员" became "该初始干员…同盟约初始干员"), carried by `effects.json` and the item
  descriptions; the 初始干员 wording is a note for 拟态物质's M2 handler. The commit made the same wording change in
  `skill_table.json`, in the two `sktok_acarm069_1` / `_2` descriptions, so the `character` group is pinned to it as
  well (rows the build does not read: the output equals a build with the launch's character tables, and character /
  uniequip / battle_equip are the same at both commits), and added a client Lua fix of a drag state, not a build input.
- **Cache**: a pinned file is cached in `.cache/gamedata@<sha>/<repo path>` and downloaded from
  `https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData/<sha>/zh_CN/gamedata/<path>` (about 60 MB per version:
  the 8 tables and the level files; V1_1 over two commits, about 19 MB from `8303c922` (the range table, the 2 enemy
  tables and the 43 level files) plus about 41 MB from `ea164ef7` (the activity table and the 4 tables of the `character`
  group), V1_2 over two, `21b1f240` 48 MB with 6 tables and the levels plus
  `ee2cabff` 13 MB with the 2 enemy tables, V2_1 in one, `1457587e` 65 MB with the 8 tables and the 50 level files of
  both seasons). `--offline` / `--refresh` keep their per-file meaning; `--cache
  <dir>` moves every cache (`<dir>` and `<dir>@<sha>`).
- **`adapters`** (`tools/versions/adapters.mjs`, applied to the season section right after it is loaded, never for the
  default; each throws on a shape it does not know):
  - `bondActiveType` — 上半's `bondInfoDict` activates by `activeType` + `isActiveInDeck`; 下半 by `activeCondition` +
    `activeConditionTemplate` + `activeParamList` + `maxInactiveBondCount`. `ALL` + deck (投资人, 远见, 奇迹) →
    `BOARD_AND_DECK`; `BATTLE` → `BOARD`; `MANI` (调和) → `BOARD`; each `count_threshold_upward` on `[activeCount]`, −1 —
    what 下半 writes for the same bonds.
  - `selfBackupPreset` — a NORMAL shop row that backs itself up becomes a PRESET with its default skill and module as the
    backup, as 下半 writes it. In 上半 only `chess_char_1_15` (盟约·辅助干员, hidden) qualifies. [ASSUMED]
  - `launchModes` — the modes open at the season's launch: V2_1's table (`1457587e`) already lists the 终极 modes
    `mode_single_abyss` / `mode_multi_abyss` with `startTime` 1774598400 (2026-03-27 16:00, V2_2); every mode whose
    `startTime` is later than the earliest mode's leaves `modeDataDict`, `battleDataDict` and the stages' mode lists.
    `bosses.json` keeps the ABYSS pools of the table (`boss_1` 2 400 000; V2_2 raised it to 3 600 000), which no mode
    reads.
  - `launchMilestones` — the 功勋 levels open at the season's launch (V1_1 and V2_1): both launch tables list all 60
    levels of `milestoneList`, and levels 36–60 carry the second sub-version's `availableTime` (1764057600 = 2025-11-25
    16:00 at `8303c922` / `ea164ef7`, 1774598400 = 2026-03-27 16:00 at `1457587e`). Every level whose `availableTime`
    is later than the earliest level's leaves the list, so `config.rewards.milestones` (the settlement's LV strip) has
    35 levels; V1_2 keeps 60.
  - A missing `bloodPointAbyss` (no 终极 in 上半: `bosses.json` omits `ABYSS`) and `enemyDataLevelId` (no season enemy
    override level) need no adapter.
- **`research`**: the version's research directory. V2_1 names `docs/research/` itself: the same season, the research
  applies by id (bondId, trapId, enemy and stage ids) [ASSUMED], written on V2_2. 上半's directories
  (`docs/research/versions/<slug>/`) are absent in M0; a file missing there falls back to `docs/research/<name>` with a
  warning — every 上半 field from research is a 下半 value [ASSUMED] until M2 (enemy multipliers, timers, rewards). That includes the descriptive overlays keyed by bondId or trapId:
  `bonds.json` `spec` (上半's 炎 gets 下半's third tier and "hits up to 3 targets", which 上半 has not), and the items'
  `implFormula` / `howToPlay` texts. The sim reads none of them, but an M1 screen (S.W.E.E.P., the guide) must not show
  them as 上半 rules. PRTS (卫戍协议：盟约) dates 上半's solo 70% / co-op 80% enemy multipliers from the 11-18 hotfix,
  which V1_1 includes; the per-round values (research 01 A3) are still 下半's [ASSUMED]. V2_1's overlays are the default's too, written on V2_2, and several contradict its own
  blackboard, so the same M1 caution applies: 奥术法阵's `implFormula` names the 失能 (`silence`) V2_1's item lacks; 奇迹's
  `spec` has p = 0.18 + 0.003·L and 20 funds every 100 layers (V2_1: base 0.25, 10 every 50); 投资人's third tier is at
  L ≥ 100 (V2_1: 70); 远见's 150-layer tier "replaces the above" (the 3-27 rule); 阿戈尔's algorithm orders 「更靠左和靠上」
  (V2_1's text: 「靠下和靠左」). M2 adds `docs/research/versions/act2autochess-v2_1/` overrides [ASSUMED].
- **`tables`**: `'default'` runs the 下半-measured tables of the build; `null` leaves one out [ASSUMED] for M2 —
  `stock` (only the per-identity overrides `economy.poolCopiesOverrides` / `itemPoolCopiesOverrides` become `{}`: the
  tier copies `poolCopies` / `itemPoolCopies` stay the literals cited for 下半 in §1, so every 上半 chess and item uses
  下半's base copies of its tier), `shopDraft`, `tacticDraft` and
  `bountyDrafts` (the `choices.json` key is omitted, and with `bountyDrafts` the boss-card gating and the draft-set
  checks are skipped). The match already draws uniformly when a key is absent. Both 上半 profiles leave all four out;
  V2_1 runs all four (`'default'`) [ASSUMED]: its 机变 events and shop rows are byte-identical to today's, its bounty
  cards have today's ids and draft data (one text differs, 悬赏·折射II `enemyeffect_15_7`: 卫队 / 卫士, 04-14), and the
  stock (2026-03-29) and the official drafts (the end of March 2026) name only operators and items V2_1 has.
  The bounty cards' own `draft` / `draftPool` classification still runs for 上半 [ASSUMED]: `HIDDEN_BOUNTY_IDS` and the
  effect-id shapes of `bountyDraftPool` (`enemyeffect_b_*` / `enemyeffect_5_1` → boss, `enemyeffect_1[0-5]_[78]` /
  `16_*` → hunter, every other kill card → `unseen`, never drafted) come from 下半's PRTS table and screenshots, and the
  match honours them (`server/match/choices.js`). 上半's 93 bounty cards: excluded perfect 20, unseen 14, hidden 4;
  drafted boss 19, initial 18, hunter 18. M2's research decides 上半's own pools. Four drafted ids also change meaning in both 上半 builds:
  `enemyeffect_12_7` and `15_7` are tier II in 下半, I in 上半 (the tier is read from the name, so it comes out right);
  悬赏·频次III `enemyeffect_11_6` (initial pool) targets 沉沙 `enemy_1207_sfji` in 上半, `enemy_1209_sfden` in 下半; and
  “鼠王”·悬赏 `enemyeffect_b_11` (boss pool) is tier 3 / 3 coins in 上半, 2 / 2 in 下半.
  Two more build rules come only from 下半's PRTS record 「卫戍协议：盟约 下半/PRTS盟约记录」 and are carried into 上半
  [ASSUMED] (DESIGN §35.22.3; M2 checks both against 上半): `DIY_EXTRA_PROTOTYPES`, the tier-5 自选 slots' six extra 4★
  prototypes (先锋 / 特种 left out: `backups.json` `diy.prototypes` 15 at tier 5, 9 at tier 6, as the default; PRTS's 上半
  page says nothing of 4★ prototypes in 自选), and `BAND_SWAP_LPR` 1, 鸭爵's swapped-in enemies costing 1 LP
  (§策略 鸭爵 备注: both 上半 builds' `enemy_2001_duckmi_2` / `enemy_2002_bearmi_2` get `lpr` 1; V1_1's table already
  carries the 鸭爵 effect, unused there: V1_1 has no 鸭爵 band).
- **`pools`** (optional): `{ <pool id>: [charId…] }` replaces the operators the build writes for a hand-written chess
  pool where the version's trait text names others. Both 上半 profiles set `pool_chess_glady` to 斯卡蒂 / 幽灵鲨 / 安哲拉
  (`garrison_39`: 「斯卡蒂、幽灵鲨或安哲拉」; 下半: 深巡); V2_1 and the default have none.
- **`config`**: `hiddenCore` single / multi (下半 350 / 1200, V2_1 too; 上半 300 / 1000, PRTS 卫戍协议：盟约); `rules` — V2_1:
  `{}`, the default's (every 下半 switch dates from 2026-03-14); 上半:
  `deployOrder 'rowBottomUp'`, `soloTimed true`, `benchEquip false`, `bossMirrorShare false`
  (PRTS 卫戍协议/帮助; news 5114 describes the later equipment / boss changes). The former `benchFullSwap false`
  restriction is removed as an **INTENTIONAL DEVIATION (有意偏差)**: after reviewing
  [official news 5114](https://ak.hypergryph.com/news/5114), the maintainer decided on 2026-10-25 to allow the swap
  in 第一期上／下半 too. The official first period did not allow it; the second period added it. This convenience
  applies to all four versions ([§36.2](history/0.3.3.md)). M2 reads `rules` (§35.22.7): a first-season
  solo is timed unless the room opts into `soloUnlimited` (§35.23.10).
  `constants.singleReconnectTime` is `null` in a version whose constData lacks it: 上半's has none (the 2026-03-10
  rewrite `12e0a020` added it), so the build writes no 下半 value as official data. The lobby's own fallback then keeps a
  dropped solo run resumable for 24 h (`server/lobby.js SOLO_RECONNECT_FALLBACK_SEC`). That 24 h window is a carried-over
  convenience [ASSUMED], not official 第一期 data: M2 did not add the constant, and the code path is unchanged (§35.23.10).
  **Carried over unreviewed [ASSUMED]**: the rule constants `tools/build-data.mjs` writes as literals (its `buildConfig`
  return block is the full set; a script comparing `data/config.json` with both 上半 configs finds them equal) go into
  上半's `config.json` as measured on 下半. Among them: `bans` (NORMAL / HARD 3 core + 4 addon: 下半 has 8 core bonds, 上半 6, so the same
  draw bans half of 上半's), the `hiddenCore` extras (`minTeamLpExclusive`, `checkedAfterRound`, and `difficulties`,
  which names ABYSS although 上半 and V2_1 have no ABYSS mode — inert, since no mode reads it; so do `trophies.hiddenCore`
  and `rewards.difficultyFactor`), `trophies`, `bossOvertimeAfter` / `bossOvertimeDrainPerSec` /
  `bossHpScale`, `unite`, `finalAssault` and `bandDraft`; the economy literals — the tier stock `poolCopies`
  {12, 14, 18, 16, 8, 5} and `itemPoolCopies` {4, 6, 7, 8, 7, 3} (with `stock` left out every 上半 chess and item uses
  them), `coopPoolMultiplier` 2, `goldenCopies` 3, `mergeCount` 3 / `itemMergeCount` 2, `rewardOffer`, `freeze`,
  `tempSize` 5, `equipPerChess` 2, `maxArtsPerRound` 2 and `incomeCapAlternative` / `incomeAssumedAfterRound`; `dp`
  {10, 1, 99}; the timer literals `timers.spFirst` 30, `bandTurn` 50 (the owner's official-play report of 2026-10-10,
  下半) and `soloPrepTimeData` 300 (it bears on 上半's timed solo, `rules.soloTimed`); and the title stat rules
  (`titles[].stat` / `rule`, `titleRule`). They equal the default, so `tools/bb-audit.mjs` cannot list them; `bans` is
  an M2 item (DESIGN §35.22.5).
- **`config.version`**: a non-default build appends `version: { id, family, rules }` as the last key of `config.json`;
  `data/config.json` never has it. A non-default directory also carries `tuning.json`, a byte copy of the hand-maintained
  `data/tuning.json` (a gameplay file `loadData` and the content hash read) [ASSUMED] the same tuning.
- **`expect`**: the counts `validateAll` checks, and `triggerDeviations`: `'default'` checks every deliberate trigger
  deviation; `'present'` (V2_1) those of the operators the version has (雷蛇 joined with V2_2); `'none'` asserts that
  no chess skill and no backups form has a `TAKE_DAMAGE` row (上半 has no TANK row).

**Tables keyed by stable ids** (so a version that reuses an id for something else is never matched by it: 50 of 上半's
100 chess ids name another operator in 下半; 72 of its 89 item records carry another effect in 下半 and 6 do not exist
there):

- `SHOP_EXCLUDED_ITEMS` and `ITEM_RULES` by the NORMAL item's `effectId` (`eff_acarm042`–`045` the four special 维式重锤,
  `eff_acarm072` 突变细胞; 上半's `chess_item_2_03_e_a` is 灼燃, not 战栗). The default version needs exactly one normal
  EQUIP item per effect, another at most one.
- research 04 by the item's trap id (`trapId`), the `choices.json` pools by `effectId` / `charId` (a missing entry is
  dropped with a warning outside the default [ASSUMED]: 上半 sells none of 野鬃, 灰毫, 远牙 as shop chess (远牙 is a 自选
  operator there), so `pool_char_pinus` is empty). A profile's `pools` replaces the operators of a hand-written chess pool
  where the version's trait text names others: both 第一期 builds list 斯卡蒂 / 幽灵鲨 / 安哲拉 in `pool_chess_glady`, as
  their `garrison_39` says (下半: 深巡, who is shop chess in 第一期 too, so the charId lookup alone kept him; DESIGN
  §35.22.3).
- `TRIGGER_DEVIATIONS` (`server/plugins/officialUnitBuilder.js`) by the operator's `charId` and skill id, and like
  `STANDIN_TRIGGER_DEVIATIONS` applied only over an official `TAKE_DAMAGE` row — the row they override (DESIGN §21.29,
  §22.10). Every 下半 entry meets one (V2_1: all but 雷蛇's, who joined with V2_2); in 上半 none applies.
- `TOKEN_ABNORMAL` / `TOKEN_POSITION_CORRECTIONS` stay keyed by token id: a listed token the version does not build is an
  error in the default only. The enemy, prefab and DIY tables keep their (stable) keys.

**Counts** (this build; warnings in `.cache/build-data-report.<slug>.json`):

| | chess (visible non-DIY, hidden, DIY) | bonds | bands | items | effects | garrisons | enemies | waves | stages | bosses | tokens | bytes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `act2autochess` | 266 (112, 17, 4) | 23 | 40 | 115 | 361 | 249 | 249 | 38 | 13 | 10 | 22 | 5.81 MB |
| `act2autochess@V2_1` | 240 (115, 1, 4) | 23 | 36 | 115 | 361 | 229 | 249 | 38 | 13 | 10 | 21 | 5.40 MB |
| `act1autochess` | 200 (95, 1, 4) | 18 | 30 | 89 | 281 | 174 | 197 | 36 | 9 | 9 | 12 | 4.85 MB |
| `act1autochess@V1_1` | 200 (95, 1, 4) | 18 | 20 | 89 | 281 | 170 | 197 | 36 | 9 | 9 | 12 | 4.76 MB |

`stages` counts the battle fields plus the 2 escaped levels' maps (default: 11 + 2, §16; 上半: 7 + 2). The 6 MB limit
applies per version (the 15 built files). V2_1 also differs from today's data under the same ids, and
the data carries each difference (no code change; DESIGN §35.22.5, pinned by `test/data-versions.test.js`): 节日气球
`enemy_10040_cnvbln` does not count in the total (no LP for its leak) and 圆仔 `enemy_2085_skzjxd` / `_2` is NORMAL (today
ELITE; `level_autochess_enemy_data` changed on 04-14, `86da4cfa`); 卢西恩's `act2autochess_h07_05` / `_s` patrol routes
have 3 checkpoints, not today's 19-checkpoint loops (04-14); 13 elite records lack a module added after 03-14
(`uniequip_003` / `004`), as do two summons' `byModule` entries and four 自选 forms (菲亚梅塔, 提丰, 黍, 娜仁图亚); 异客
`chess_char_6_05_b`'s RA-A module `uniequip_004_pasngr` changes 机理分析 to ×1.2 at every potential (the `1457587e`
battle_equip has only its rank-0 candidate; today ×1.25 from 潜能 5, the base talent's value); the
自选 operators' powers and bonds are the 03-14 character_table's, so 鸿雪 and 真言 are 盟约·辅助干员 (`emptyShip`), not 萨尔贡
(`sargonShip`), and seven more 自选 operators have one power fewer; the 9 自选 operators released after 03-14 (予愿安洁莉娜,
怒潮凛冬, 凯尔希·思衡托, 维伊, 可露希尔, 谬因, 机械师, 克莱门莎, 珊比) are absent, so `diy.ownedPool` holds 67 against 72 (its
4 V2_1-only picks 银灰, 空弦, 卡涅利安 and 伺夜 are pending, and the kitted gate drops them) and `diy.excluded` 5 against 7
(焰狐龙梓兰 and 结城理 came later); and a few texts differ (skills, talents, enemy abilities, one bounty card).

V2_1's warnings: the research name annotation dropped from 战场#01 (as the default) and `DIY_EXCLUDED_TEAMS` team `sees` with no owned-6★ pick (as in 上半). The 上半 builds' remaining warnings: research falling back to
下半 (6 files, [ASSUMED]); `DIY_EXCLUDED_TEAMS` team `sees` has no owned-6★ pick; two `STATIC_BODIES` enemies (`hummbd`,
`cnvbln`) absent from the 上半 modes; the 6 上半-only enemies whose model `data/assets.json` lacks (墨浪 `enemy_1201_sfzhi`,
`enemy_1249_lysdb`, `enemy_1254_lypa`, `enemy_1275_dwlock`, `enemy_1373_ltnhor_2`, `enemy_1376_ltndru`: no `attackAnim`,
one warning each, DESIGN §35.22.5); the research name annotation dropped from 战场#01; the 野鬃 / 灰毫 / 远牙 pool
entries.

**Build and verify**:

```
node tools/build-data.mjs --version act1autochess            # 上半 V1_2 → data/versions/act1autochess/
node tools/build-data.mjs --version act1autochess@V1_1       # 上半 V1_1 → data/versions/act1autochess-v1_1/
node tools/build-data.mjs --version act2autochess@V2_1       # 下半 V2_1 → data/versions/act2autochess-v2_1/
node tools/build-data.mjs --version act1autochess --offline  # from .cache/gamedata@<sha>/ only
node --test test/data-versions.test.js test/versions-default-guard.test.js
```

`test/data-versions.test.js` rebuilds each version offline and compares all 16 files; without the pinned caches it skips
and names the missing `.cache/gamedata@<sha>/`. **Hidden inputs**: a version build also reads the committed
`data/assets.json` (the enemies' attack clips: a manifest of 下半's models, so the 6 上半-only enemies above have no
`attackAnim` and the sim keeps `ATTACK_PAUSE` for them — 墨浪, 萨卡兹王庭军术师 and 巫王乐团圆号手 are ranged, so their
attack timing is off — until M2 adds their models; `data/assets.json` is a default data file, so that change rebuilds
every version directory; G1, which also pinned it, was deleted when M1 started, DESIGN §35.22.2),
`data/tuning.json` (its byte copy; `test/data-versions.test.js` fails
while a copy differs) and `docs/research/*.json` (the default's research, which V2_1 reads by id and 上半 uses as its fallback) — a default-side change to those makes
the version directories stale with no version-related cause. Rebuild every version then
(`--version` for each id). `server/data.js`: `versionDataDir(id)`, `getVersionData(id)` (the default returns `getData()`;
another version loads its directory once, frozen, with `VERSION_DATA_FILES`, never filling the official-bounds cache),
`resetVersionData()`; `loadData(DATA_DIR)` reads the top level only.

### Serving the versions (M1)

DESIGN §35.23. A server offers the versions its owner enables; rooms play one of them (server/lobby.js header "Official
versions"), and their matches run in a match host whose data singleton is that version's.

**Configuration** (`server/http/config.js` versionsFrom): the startServer option `versions: { enabled, default, maxHosts }`
wins over the environment — `SP_VERSIONS` (`all` or a comma list of registry ids), `SP_VERSION_DEFAULT`,
`SP_MAX_VERSION_HOSTS`. Nothing set enables every registry id (the lobby switch on; the default version stays
`act2autochess`, §35.23.11). `SP_VERSIONS=act2autochess`, or `versions.enabled` of that one id, is 第二期下半 alone (the
switch off). An unknown id is warned about and dropped (none left: `act2autochess`); a default that is not enabled is
warned about and replaced by the first enabled id in registry order; `maxHosts` defaults to the number of enabled
non-default versions (at least 1 when there is one). Version match hosts are forked on the first match of a version,
never at boot. The boot log prints one line, e.g.
`[versions] enabled: act2autochess (第二期下半, default), act1autochess (第一期下半)`.

**The service** (`server/versions.js` createVersionSets): at boot, each enabled non-default version's `cs` —
`contentHashOf({ app, sim, data })` over the vanilla code (`app`, `sim`, the same served `/sim/` and `/shared/` files) and
the sha256 of its directory's gameplay files (`server/plugins/identity.js` versionContentOf; the 16 tables, no art
manifest; bytes only, no JSON parse) — and its `config.json` modes (the difficulties it offers: 第一期 and 第二期上半 have
no 终极). A version whose directory is missing a file or unreadable is warned about and stays disabled. Its data
(`loadData` of its directory, deep-frozen), its official-bounds snapshot (`shared/plugins/officialBounds.js`
officialBoundsOf: its own maxima — the main process's cache keeps 第二期下半's) and its manifest load on first use. A
load that fails at run time is logged once and remembered until the server restarts: the version is then unavailable
(`available(id)` false — `room.create` / `room.proposeVersion` answer `VERSION_UNSUPPORTED`, later welcomes leave it out,
and when it is the configured default, rooms created without a version and the settings outside a room use 第二期下半,
else the first enabled version that loads, which the welcome marks the default), while `/healthz` `versions` still lists
it under `enabled` and keeps the configured `default`. The default version is the vanilla content and the server's data.

**HTTP** (`server/http/static.js`):

| path | answer |
|---|---|
| `/data/versions/<slug>/<file>.json` | an enabled version's file; `?v=<sha8>` immutable like `/data/`. Any other path under `data/versions/` (a disabled version, the folder itself, another spelling of one) is a 404: the real path must lie inside an enabled version's real directory |
| `/cs/<cs16>/index.json` | an enabled version's manifest: `{ v: 1, cs, app, vanilla: true, version, sim, simFiles, data: { <name>: { url: '/data/versions/<slug>/<name>.json?v=<sha8>', sha256, bytes } }, plugins: [], settings: {}, bounds: { official: { url, sha256, bytes } } }`, immutable |
| `/cs/<cs16>/bounds/official.json` | its official-bounds snapshot, canonical JSON `{ v: 1, bb, fields, bbMin, fieldMin, text }` |

The vanilla `/cs/<cs16>/index.json` is byte-identical (no `version`, no `bounds`, URLs under `/data/`). The build tag
(`server/http/buildTag.js`) counts the served version directories only, so rebuilding a version the server does not offer
is no new build. `/healthz` adds `versions: { enabled, default, hosts: { workers, matches, transport } }` only when a
non-default version is enabled.

**Match hosts**: the rooms of a non-default version start their matches in `server/match/host/` with `kind: 'version'` —
one child process per version `cs`, at most `maxHosts`, counted apart from the plugin hosts (docs/design/match.md). The
host checks every data file's sha256 against the version's hash input, installs the data with `setData` and the version's
bounds snapshot, and refuses a match whose `opts.version` is not its data's version. A test journal of such a match carries
`init.options.version` and replays in a process whose data singleton is that version's (`server/match/testReplay.js`).
