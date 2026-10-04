# 03 - Operator pool (干员池), 特质 (garrison), combat stats — 卫戍协议：盟约 (act2autochess)

Source: Kengxxiao/ArknightsGameData zh_CN — `activity_table.activity.AUTOCHESS_SEASON.act2autochess` (charShopChessDatas, charChessDataDict, shopCharChessInfoData, garrisonDataDict, bondInfoDict, diyChessDict, constData) + `activity_table.autoChessData` (skillTriggerDataList, skillRangeDict, shopStateTokenDict, prepareStateDict) joined with character_table / skill_table / range_table / battle_equip_table / uniequip_table. Machine-readable companion: `03-operators.json` (one object per chessId, 266 objects = 133 normal + 133 golden).

Rich-text tags (`<@ba.vup>…</>`, `<$ba.inspire>…</>`) are stripped in this doc; `{key:0%}` placeholders are resolved at the chess skill level (Lv4 normal / Lv7 golden). Raw strings are kept in the JSON (`descRaw`, `descriptionRaw`). Literal angle-bracket phrases such as `<获得时>` / `<战斗中>` are part of the text (they are trigger labels, not tags).

## 1. Core rules for chess pieces

### 1.1 Tier -> training status (shopCharChessInfoData)

| Tier | Normal: phase / level / skill Lv / module Lv | Golden (精锐): phase / level / skill Lv / module Lv | purchasePrice | chessSoldPrice | Normal icon / golden icon |
|---|---|---|---|---|---|
| 1 | E1 Lv55 / S-Lv4 / mod 0 | E2 Lv50 / S-Lv7 / mod 1 | 2 (golden entry also 2) | 1 (golden 1) | char_elite_base_1 / char_elite_gold_2 |
| 2 | E1 Lv60 / S-Lv4 / mod 0 | E2 Lv55 / S-Lv7 / mod 1 | 3 (golden entry also 3) | 1 (golden 1) | char_elite_base_1 / char_elite_gold_2 |
| 3 | E2 Lv1 / S-Lv4 / mod 0 | E2 Lv60 / S-Lv7 / mod 1 | 3 (golden entry also 3) | 1 (golden 1) | char_elite_base_2 / char_elite_gold_2 |
| 4 | E2 Lv1 / S-Lv4 / mod 0 | E2 Lv60 / S-Lv7 / mod 1 | 3 (golden entry also 3) | 1 (golden 1) | char_elite_base_2 / char_elite_gold_2 |
| 5 | E2 Lv1 / S-Lv4 / mod 0 | E2 Lv60 / S-Lv7 / mod 1 | 4 (golden entry also 4) | 1 (golden 1) | char_elite_base_2 / char_elite_gold_2 |
| 6 | E2 Lv1 / S-Lv4 / mod 0 | E2 Lv60 / S-Lv7 / mod 3 | 4 (golden entry also 4) | 1 (golden 1) | char_elite_base_2 / char_elite_gold_2 |

- Every chess has `upgradeNum = 3`: 3 copies of the same normal chess -> 1 golden (精锐) chess (`upgradeChessId` = `goldenChessId`). Golden chess have `upgradeChessId = null` (no further upgrade). Exception via 特质: 风丸 `chess_char_2_11` (garrison_93: "只需2个相同的本干员即可合成精锐") needs only 2 copies.
- favorPoint = 0 in every status -> **trust bonus 0**. potentialRank 0 (preset data). Module (模组) is **inactive on normal chess** (equipLevel 0) and **active on golden chess** at stage 1 (tiers 1–5) or stage 3 (tier 6). The module used is always `defaultUniEquipId` (always the operator's `uniequip_002_*` = first advanced module, X or Y type depending on operator; 凛御银灰 `char_1045_svash2` has none).
- Golden stat jump is large: tier 1 goes E1 Lv55 -> E2 Lv50 (so skill 3 exists but chess keep their `defaultSkillIndex`; the skill index does NOT change on upgrade, only the level 4 -> 7).
- Prices: see 1.1 table; purchasePrice is per tier (T1=2, T2=3, T3=3, T4=3, T5=4, T6=4 coins); selling any chess returns 1 (data `chessSoldPrice`=1 for all; the shop/economy doc should confirm whether golden sells for more via other rules). Note: garrison `SERVER_PRICE` effects override the purchase price for specific chess (e.g. "购买价格为1").
- Board/bench limits (constData): maxBattleChessCnt = **8** on field, maxDeckChessCnt = **10** on bench (整备区), storeCntMax = 6, shopRefreshPrice = 1, fallbackBondId = `emptyShip` (协防干员), borrowCount = 20 (max friend-support borrows).

### 1.2 chessType, isHidden, backup (原型/替补) and DIY (甄选)

- `PRESET` (74): 特许干员 — all 4★ (19) / 5★ (48) and 7 non-gacha 6★ (伺夜, 信仰搅拌机, 歌蕾蒂娅, 魔王 x2, 流明, 溯光星源); usable even if the player does not own them.
- `NORMAL` (55): all 6★ gacha operators. If the player owns the operator, their own copy is used; otherwise a friend-support copy (up to `borrowCount`=20) or the **backup** operator: `backupCharId` is a special non-obtainable stand-in (预备干员 4★ `char_600..607` or 6★ "罗德岛特派高级干员" `char_608..617` = 郁金香/Sharp/Mechanist/Stormeye/Pith/Touch/Raidian/Misery/领主·Sharp) with `backupCharSkillIndex`. Backups keep the chess's bonds and 特质. **For the fan remake: always use the real operator** (no ownership system); backup data is kept in JSON (`backup`).
- `DIY` (4): `chess_char_5_diy1/2_a`, `chess_char_6_diy1/2_a` — 甄选 slots (2 in tier 5, 2 in tier 6). `diyChessDict` = `TIER_6` means the player may put in **one of their own 6★ operators** not already in the pool; bondIds = [] and garrisonIds = null, so it gets the fallback bond `emptyShip` (协防干员) and no 特质. Status same as tier 5/6 chess. Remake suggestion [ASSUMED]: either drop DIY slots or let each player pick any 6★ from a curated list before the match.
- `isHidden = true` (17 chess): not offered in the current shop pool. Best explained as **上半期 entries retired in the 下半期 rebalance** (official news 5114: "调整部分上半期预设干员的等阶、特质及所属盟约"): 8 of them are operators that now have a different visible tier entry; `chess_char_1_15_a` 盟约·辅助干员 (char_616_pithst, bonds 调和+协防干员) is a special piece granted only by strategy band effect `aceffect_band_42` 优等生 (round 1: gain 1 special operator); the other 8 (红豆, 地灵, 崖心, 协律, 见行者, 巫恋, 蜜蜡, 瑰盐) were dropped from the pool. For the remake, **exclude hidden chess from the shop pool** (keep them in data only; a few effects may still reference them - verify in shop/garrison research). Operators appearing in two tiers: 锡人 (char_4151_tinman): chess_char_1_16 hidden, chess_char_2_19; 耶拉 (char_4013_kjera): chess_char_3_20, chess_char_4_03 hidden; 录武官 (char_4196_reckpr): chess_char_4_15 hidden, chess_char_5_23; 白面鸮 (char_128_plosis): chess_char_4_21, chess_char_5_16 hidden; 百炼嘉维尔 (char_1026_gvial2): chess_char_4_23, chess_char_5_18 hidden; 魔王 (char_4134_cetsyr): chess_char_4_25, chess_char_5_09 hidden; 华法琳 (char_171_bldsk): chess_char_4_26, chess_char_5_04 hidden; 妮芙 (char_4146_nymph): chess_char_5_22, chess_char_6_10 hidden. Hidden list: 1_05 红豆, 1_11 地灵, 1_15 盟约·辅助干员, 1_16 锡人, 2_03 崖心, 2_15 协律, 3_07 见行者, 3_15 巫恋, 4_03 耶拉, 4_05 蜜蜡, 4_08 瑰盐, 4_15 录武官, 5_04 华法琳, 5_09 魔王, 5_16 白面鸮, 5_18 百炼嘉维尔, 6_10 妮芙.
- Owned-operator bonus (`autoChessData.prepareStateDict`, applies in the real game only when the player owns the operator; **not needed for the remake**): aceffect_char_1 ATK×1.05; _2 ATK×1.05 DEF×1.05; _3 ATK×1.10 DEF×1.05 HP×1.05; _4 ATK/DEF/HP×1.10 (by the player's own training level; community: E1 / E2 Lv1 / E2 Lv60+).

### 1.3 Stat formula used in the tables

- `stat(level) = kf0 + (kf1 - kf0) * (level - kf0.level) / (kf1.level - kf0.level)` using `character_table[charId].phases[evolvePhase].attributesKeyFrames` (two keyframes: Lv1 and max level). maxHp/atk/def/cost/blockCnt/respawnTime rounded half-up to int; others kept as float.
- Golden: + module `battle_equip_table[defaultUniEquipId].phases[equipLevel-1].attributeBlackboard` (max_hp, atk, def, attack_speed, magic_resistance, …). Module trait additions are listed as `module.traitEffect` / `module.hiddenTalentEffects` in JSON.
- No potential, no trust. Talent-driven permanent stat increases (e.g. "攻击力+8%") are NOT folded into the numbers; apply them in the sim from `talents[]`.
- `cost` (DP) and `respawnTime` are used by automatic redeployment in battle (see 1.4).
- Attack interval = `baseAttackTime * 100 / attackSpeed` seconds.

### 1.4 Skill auto-trigger rules (autoChessData.skillTriggerDataList + skillRangeDict)

All skills fire automatically in this mode. Normal behaviour: AUTO skills fire by their normal rules when SP is full; PASSIVE skills are always on. MANUAL skills are converted to automatic using the rule list below (first match: charId+skillIndex, then subProfessionId, then profession). Rule rows:

| profession | subProfessionId | charId | skillIndex | skillTriggerType |
|---|---|---|---|---|
| TANK |  |  | 0 | TAKE_DAMAGE |
| NONE | bearer |  | 0 | ALWAYS |
| NONE | tactician |  | 0 | ALWAYS |
| NONE | bard |  | 0 | ALWAYS |
| NONE | librator |  | 0 | SEARCH |
| NONE | phalanx |  | 0 | SEARCH |
| NONE |  | char_291_aglina | 1 | SEARCH |
| NONE |  | char_291_aglina | 2 | SEARCH |
| NONE |  | char_249_mlyss | -1 | MLYSS_WTRMAN |
| NONE |  | char_4141_marcil | 1 | MARCILS2 |
| NONE |  | char_377_gdglow | 2 | GDGLOW_SKILL_2 |
| NONE |  | char_1038_whitw2 | 2 | GDGLOW_SKILL_2 |
| NONE |  | char_1016_agoat2 | 2 | GDGLOW_SKILL_2 |
| NONE |  | char_1035_wisdel | 2 | ALWAYS |
| NONE |  | char_4145_ulpia | 2 | CUSTOM_RANGE_SEARCH_ENEMY |
| NONE |  | char_1019_siege2 | 2 | CUSTOM_RANGE_SEARCH_ENEMY |
| NONE |  | char_2026_yu | 2 | CUSTOM_RANGE_SEARCH_ENEMY |
| NONE |  | char_430_fartth | 2 | CUSTOM_RANGE_SEARCH_ENEMY |
| NONE |  | char_4037_demetr | 2 | CUSTOM_RANGE_SEARCH_ENEMY |
| NONE |  | char_4064_mlynar | 2 | CUSTOM_RANGE_SEARCH_ENEMY |
| NONE |  | char_1043_leizi2 | 2 | CUSTOM_RANGE_SEARCH_ENEMY |
| NONE |  | char_1046_sbell2 | 2 | CUSTOM_RANGE_SEARCH_ENEMY |
| NONE |  | char_4080_lin | 2 | CUSTOM_RANGE_SEARCH_ENEMY |
| NONE |  | char_1051_headb2 | 2 | CUSTOM_RANGE_SEARCH_ENEMY |
| NONE |  | char_2025_shu | 2 | TRY_SEARCH_ALLY_SKILL |

Meaning (names are from the data; semantics partly inferred — the official wording, PRTS 卫戍协议/帮助 §作战阶段 技能操作, is quoted in DESIGN §20.2):

- `DEFAULT` (no matching row; 97 of 129 pool chess): the basic strategy "技能就绪，且即将进行普通攻击/治疗" — SP full AND about to attack (heal skills: to heal) AND an enemy (an injured ally) inside the initial range; a MANUAL skill with a 技能范围 of its own (not an attack-range change) uses `SKILL_RANGE` instead (DESIGN §20.2).
- `TAKE_DAMAGE` (profession TANK, 15 chess): SP full AND the unit takes damage — PRTS 重装 "不受技能范围影响，受到伤害时释放技能". The row has skillIndex 0 but pool tanks use S1 x2, S2 x10, S3 x4; as a class row it covers every MANUAL skill of the class (DESIGN §20.2; C1 below keeps the "skill 1 only" counter-reading). **History of the row** (activity_table `autoChessData.skillTriggerDataList`): 上半 (act1autochess, 2025-11) shipped no TANK row — 重装 skills had no strategy of their own; 下半 (act2autochess, 2026-03-14) added `TANK | | | 0 | TAKE_DAMAGE` for every skill index, with PRTS's 重装 line (下半, 2026/3/14). **Deliberate deviation** (the owner, 2026-10-03, after community feedback — GitHub issue #4, PR #12; DESIGN §21.29): 深巡 S2, 雷蛇 S2, 号角 S2 / S3 and 灰毫 S1 / S2 cast with an enemy in range (`DEFAULT`; `tools/build-data.mjs TRIGGER_DEVIATIONS`, keyed per chess — 灰毫 S1 is the generic `skcom_atk_up[3]` — with `rawRule` keeping the official TAKE_DAMAGE); every other MANUAL 重装 skill, 深巡 S1 included, keeps TAKE_DAMAGE; extended 2026-10-04 to 余 S2 (SKILL_RANGE on its x-1, DESIGN §22.10).
- `ALWAYS` (5 chess; subprof bearer 旗手 / tactician 战术家 / bard 吟游者, plus 维什戴尔 S3 not in pool): cast as soon as SP is full, no target needed. Pool: 伺夜 S3, 缪尔赛思 S3 (tactician), 魔王 S3 (T4 & hidden T5), 浊心斯卡蒂 S3 (bard).
- `SEARCH` (4 chess; subprof librator 解放者 / phalanx 阵法术师, 安洁莉娜 S2/S3): [ASSUMED] cast when SP full and any enemy is on the field (search whole map) — phalanx/librator skills change their own attack mode and should not wait for an enemy in their (small/none) normal range. Pool: 薄绿 S2, 蜜蜡 S2 (hidden), 卡涅利安 S2 (phalanx); 安洁莉娜 S3. 玛恩纳 S3 and 圣聆初雪 S3 are overridden by their charId rows (CUSTOM_RANGE).
- `CUSTOM_RANGE_SEARCH_ENEMY` (6 chess): SP full AND an enemy inside the `skillRangeDict` range (listed below). Pool: 乌尔比安 S3 (6-1), 维娜·维多利亚 S3 (x-4), 余 S3 (3-15), 远牙 S3 (6-1), 玛恩纳 S3 (3-18), 圣聆初雪 S3 (x-2). Not in pool: 塑心 demetr, 司霆惊蛰 leizi2, 林 lin, 猎蜂? headb2.
- `GDGLOW_SKILL_2` (2 chess: 荒芜拉普兰德 whitw2 S3, 纯烬艾雅法拉 agoat2 S3; 澄闪 gdglow not in pool): named after 澄闪 S3 whose skill places/targets a zone; [ASSUMED] cast when SP full and an enemy is inside the attack range, choosing the target tile/enemy with the most enemies around it.
- `MLYSS_WTRMAN` (缪尔赛思, skillIndex -1): AI rule for her summon 流形 (token_10030_mlyss_wtrman) placement/behaviour [ASSUMED: token copies/follows the nearest allied operator as in the base game]; her S3 itself uses the tactician ALWAYS rule.
- `MARCILS2` (玛露西尔 S2) and `TRY_SEARCH_ALLY_SKILL` (黍 S3) are for operators not in this season's pool.
- Redeployment (PRTS 卫戍协议/帮助 §作战阶段 单位部署, quoted in research 01 §4.3): a knocked-out operator auto-redeploys on the tile it lies on when its `respawnTime` has elapsed AND there is enough DP for its `cost` (or instantly via effects). So **cost and respawnTime matter** in battle; see the battle-rules research for the DP economy.

skillRangeDict (custom trigger ranges; `O` = operator tile, `#` = trigger tile, facing right):

- `skchr_ulpia_3` -> rangeId `6-1`
- `skchr_siege2_3` -> rangeId `x-4`
- `skchr_yu_3` -> rangeId `3-15`
- `skchr_fartth_3` -> rangeId `6-1`
- `skchr_demetr_3` -> rangeId `x-2`
- `skchr_mlynar_3` -> rangeId `3-18`
- `skchr_leizi2_3` -> rangeId `2-1`
- `skchr_sbell2_3` -> rangeId `x-2`
- `skchr_lin_3` -> rangeId `x-2`
- `skchr_headb2_3` -> rangeId `2-4`

```
skchr_ulpia_3 (6-1):
O######

skchr_siege2_3 (x-4):
###
#O#
###

skchr_yu_3 (3-15):
###.
####
O###
####
###.

skchr_fartth_3 (6-1):
O######

skchr_demetr_3 (x-2):
.###.
#####
##O##
#####
.###.

skchr_mlynar_3 (3-18):
##..
###.
O###
###.
##..

skchr_leizi2_3 (2-1):
#..
##.
O##
##.
#..

skchr_sbell2_3 (x-2):
.###.
#####
##O##
#####
.###.

skchr_lin_3 (x-2):
.###.
#####
##O##
#####
.###.

skchr_headb2_3 (2-4):
.#.
O##
.#.

```

## 2. Roster by tier

Columns: `sid` = shopLevelSortId (chess id = `chess_char_<tier>_<sid>_a`, golden `_b`). Type P = PRESET, N = NORMAL, D = DIY; H = hidden. Stats format `HP/ATK/DEF/RES/Block/BAT/rangeId` (BAT = base attack time). Skill SP = initSp/spCost. Trigger = resolved auto-cast rule. 特质 shows normal -> golden.

### Tier 1 (20 chess: 16 visible, 4 hidden, 0 DIY)

| sid | 干员 (charId) | ★ | 职业·分支 | 位置 | 盟约 | 特质 normal -> golden | Type |
|---|---|---|---|---|---|---|---|
| 01 | 隐现 (char_498_inside) | 5 | 狙击·速射手 | 远程 | 拉特兰、迅捷 | 【拉特兰】每叠加5层，本干员攻击速度+1 **->** 【拉特兰】每叠加5层，本干员攻击速度+2 | P |
| 02 | 角峰 (char_199_yak) | 4 | 重装·铁卫 | 近战 | 谢拉格、坚守 | <获得时>自身所属盟约层数+2（无需激活盟约） **->** <获得时>自身所属盟约层数+4（无需激活盟约） | P |
| 03 | 惊蛰 (char_306_leizi) | 5 | 术师·链术师 | 远程 | 炎 | <获得时>获得等于当前调度中心等级的【炎】层数（无需激活盟约） **->** <获得时>获得等于两倍的当前调度中心等级的【炎】层数（无需激活盟约） | P |
| 04 | 深巡 (char_4137_udflow) | 5 | 重装·哨戒铁卫 | 近战 | 阿戈尔 | 攻击海怪敌人时攻击力提升至150% **->** 攻击海怪敌人时攻击力提升至200% | P |
| 05 | 红豆 (char_290_vigna) | 4 | 先锋·冲锋手 | 近战 | 不屈 | 购买价格为1 **->** 购买价格为1 | P H |
| 06 | 刺玫 (char_494_vendla) | 5 | 医疗·咒愈师 | 远程 | 维多利亚、助力 | <休整期结束时>使已激活的【维多利亚】层数+1 **->** <休整期结束时>使已激活的【维多利亚】层数+2 | P |
| 07 | 普罗旺斯 (char_145_prove) | 5 | 狙击·重射手 | 远程 | 叙拉古 | <获得时>获得1次免费刷新 **->** <获得时>获得2次免费刷新 | P |
| 08 | 德克萨斯 (char_102_texas) | 5 | 先锋·尖兵 | 近战 | 独行、叙拉古 | <售出时>获得1次免费刷新 **->** <售出时>获得2次免费刷新 | P |
| 09 | 跃跃 (char_4100_caper) | 4 | 狙击·回环射手 | 远程 | 精准 | 攻击无人机敌人时攻击力提升至150% **->** 攻击无人机敌人时攻击力提升至200% | P |
| 10 | 古米 (char_196_sunbr) | 4 | 重装·守护者 | 近战 | 坚守 | 技力自然恢复速度+0.15/秒 **->** 技力自然恢复速度+0.3/秒 | P |
| 11 | 地灵 (char_183_skgoat) | 4 | 辅助·凝滞师 | 远程 | 奇迹、远见 | <获得时>自身所属盟约层数+2（无需激活盟约） **->** <获得时>自身所属盟约层数+4（无需激活盟约） | P H |
| 12 | 艾丝黛尔 (char_127_estell) | 4 | 近卫·强攻手 | 近战 | 萨尔贡 | <获得时>自身所属盟约层数+2（无需激活盟约） **->** <获得时>自身所属盟约层数+4（无需激活盟约） | P |
| 13 | 波登可 (char_258_podego) | 4 | 辅助·凝滞师 | 远程 | 助力 | <休整期结束时>当前激活且层数最多的盟约层数+1，此干员在整备区时也有效 **->** <休整期结束时>当前激活且层数最多的盟约层数+2，此干员在整备区时也有效 | P |
| 14 | 格雷伊 (char_253_greyy) | 4 | 术师·扩散术师 | 远程 | 灵巧 | <售出时>进入下个休整期额外获得1资金 **->** <售出时>进入下个休整期额外获得2资金 | P |
| 15 | 盟约·辅助干员 (char_616_pithst) | 4 | 辅助·巫役 | 远程 | 调和、协防干员 | 攻击力和生命值+20% **->** 攻击力和生命值+40% | P H |
| 16 | 锡人 (char_4151_tinman) | 5 | 特种·炼金师 | 远程 | 投资人、迅捷 | <获得时>自身所属盟约层数+2（无需激活盟约） **->** <获得时>自身所属盟约层数+4（无需激活盟约） | P H |
| 17 | 深靛 (char_469_indigo) | 4 | 术师·秘术师 | 远程 | 奥术、精准 | <获得时>自身所属盟约层数+2（无需激活盟约） **->** <获得时>自身所属盟约层数+4（无需激活盟约） | P |
| 18 | 宴 (char_337_utage) | 4 | 近卫·武者 | 近战 | 突袭 | <战斗中>造成的伤害变为弱点伤害（基于敌人的防御力和法术抗性变换物理和法术伤害） **->** <战斗中>造成的伤害变为弱点伤害（基于敌人的防御力和法术抗性变换物理和法术伤害） | P |
| 19 | 野鬃 (char_496_wildmn) | 5 | 先锋·冲锋手 | 近战 | 卡西米尔、迅捷 | <获得时>自身所属盟约层数+2（无需激活盟约） **->** <获得时>自身所属盟约层数+4（无需激活盟约） | P |
| 20 | 雷蛇 (char_107_liskam) | 5 | 重装·哨戒铁卫 | 近战 | 不屈 | <休整期结束时>使已激活的【不屈】层数+1 **->** <休整期结束时>使已激活的【不屈】层数+2 | P |

| sid | 干员 | 技能 (idx) | 类型/SP | SP init/cost | 持续 | Trigger | Normal stats | Golden stats |
|---|---|---|---|---|---|---|---|---|
| 01 | 隐现 | “解决麻烦” (S2) | 手动/自然 | 8/24 -> 10/20 | ammo | DEFAULT | 1123/399/140/0/1/1s/3-3 | 1421/508/167/0/1/1s/3-3 |
| 02 | 角峰 | 抗寒体质 (S2) | 手动/自然 | 0/47 -> 5/44 | 27s | TAKE_DAMAGE | 2216/313/478/5/3/1.2s/0-1 | 3154/358/648/5/4/1.2s/0-1 |
| 03 | 惊蛰 | 初雷 (S2) | 手动/自然 | 43/80 -> 46/80 | 31s -> 32s | DEFAULT | 1041/502/93/15/1/2.3s/3-1 | 1391/649/111/20/1/2.3s/3-1 |
| 04 | 深巡 | 行动能力剥夺 (S2) | 手动/自然 | 21/39 -> 22/36 | 15s | TAKE_DAMAGE | 2207/348/479/0/3/1.2s/2-2 | 2904/449/655/0/3/1.2s/2-2 |
| 05 | 红豆 | 槌音 (S2) | 手动/自然 | 0/32 -> 5/28 | 22s -> 25s | DEFAULT | 1267/458/281/0/1/1s/1-1 | 1764/572/332/0/1/1s/1-1 |
| 06 | 刺玫 | 荆藤庇荫 (S2) | 手动/自然 | 10/36 -> 12/32 | 15s | DEFAULT | 1137/413/77/15/1/1.6s/3-3 | 1402/531/92/20/1/1.6s/3-3 |
| 07 | 普罗旺斯 | 狼眼 (S1) | 被动/被动 | 0/0 | - | DEFAULT | 1215/569/148/0/1/1.6s/3-6 | 1527/753/223/0/1/1.6s/3-6 |
| 08 | 德克萨斯 | 剑雨 (S2) | 手动/自然 | 23/40 -> 26/40 | - | DEFAULT | 1285/386/260/0/2/1.05s/1-1 | 1828/501/332/0/2/1.05s/1-1 |
| 09 | 跃跃 | 乐趣加倍 (S2) | 手动/攻击 | 11/32 -> 12/29 | 16s -> 17s | DEFAULT | 1770/479/132/0/1/1s/y-7 | 2215/584/153/0/1/1s/y-7 |
| 10 | 古米 | 备用军粮 (S1) | 自动/自然 | 0/6 -> 0/5 | - | TAKE_DAMAGE | 1802/340/450/10/3/1.2s/0-1 | 2493/450/532/10/3/1.2s/0-1 |
| 11 | 地灵 | 攻击力强化·β型 (S1) | 手动/自然 | 0/37 -> 5/37 | 25s | DEFAULT | 946/390/83/15/1/1.9s/y-2 | 1225/456/116/20/1/1.9s/y-2 |
| 12 | 艾丝黛尔 | 舍身突击 (S2) | 手动/受击 | 10/24 -> 10/23 | 15s | DEFAULT | 1840/512/252/0/2/1.2s/1-1 | 2389/674/298/0/3/1.2s/1-1 |
| 13 | 波登可 | 孢子扩散 (S2) | 手动/自然 | 10/32 -> 10/29 | - | DEFAULT | 913/399/78/15/1/1.9s/y-2 | 1165/493/91/20/1/1.9s/y-2 |
| 14 | 格雷伊 | 静电释放 (S2) | 手动/自然 | 0/60 | 23s -> 26s | DEFAULT | 1145/576/106/15/1/2.9s/3-6 | 1505/667/124/20/1/2.9s/3-6 |
| 15 | 盟约·辅助干员 | 战术咏唱·双型 (S1) | 手动/攻击 | 9/20 -> 10/17 | 30s | DEFAULT | 836/347/86/10/1/1.6s/y-2 | 1117/429/97/15/1/1.6s/y-2 |
| 16 | 锡人 | “大拉里” (S2) | 手动/自然 | 12/30 -> 14/25 | inf | DEFAULT | 836/359/79/25/1/1.5s/2-1 | 1105/455/93/30/1/1.5s/3-5 |
| 17 | 深靛 | 光影迷宫 (S2) | 手动/自然 | 10/47 -> 15/44 | 20s | DEFAULT | 1139/885/102/20/1/3s/3-14 | 1356/1099/113/20/1/3s/3-14 |
| 18 | 宴 | 落地斩·破门 (S2) | 被动/被动 | 0/0 | inf | DEFAULT | 2530/564/260/0/1/1.2s/1-1 | 3354/704/298/0/1/1.2s/1-1 |
| 19 | 野鬃 | 夹枪冲锋 (S2) | 手动/自然 | 20/40 -> 25/40 | 20s | DEFAULT | 1482/443/290/0/1/1s/1-1 | 1971/564/347/0/1/1s/1-1 |
| 20 | 雷蛇 | 反击电弧 (S2) | 手动/受击 | 0/41 -> 0/38 | 20s | TAKE_DAMAGE | 2198/337/489/0/3/1.2s/2-2 | 2892/435/667/0/3/1.2s/2-2 |

### Tier 2 (19 chess: 17 visible, 2 hidden, 0 DIY)

| sid | 干员 (charId) | ★ | 职业·分支 | 位置 | 盟约 | 特质 normal -> golden | Type |
|---|---|---|---|---|---|---|---|
| 01 | 送葬人 (char_279_excu) | 5 | 狙击·散射手 | 远程 | 拉特兰、精准 | <战斗中>首次击倒敌人时，使已激活的【精准】【拉特兰】层数+3 **->** <战斗中>首次击倒敌人时，使已激活的【精准】【拉特兰】层数+6 | P |
| 02 | 赫默 (char_108_silent) | 5 | 医疗·医师 | 远程 | 远见 | <进入休整期时>使自身已激活的盟约层数+2 **->** <进入休整期时>使自身已激活的盟约层数+4 | P |
| 03 | 崖心 (char_173_slchan) | 5 | 特种·钩索师 | 近战 | 谢拉格、不屈 | <获得时>自身所属盟约层数+3（无需激活盟约） **->** <获得时>自身所属盟约层数+6（无需激活盟约） | P H |
| 04 | 小满 (char_4122_grabds) | 5 | 辅助·凝滞师 | 远程 | 炎、灵巧 | <休整期结束时>本回合每获得过1名干员，使已激活的【炎】层数+1 **->** <休整期结束时>本回合每获得过1名干员，使已激活的【炎】层数+2 | P |
| 05 | 哈洛德 (char_4114_harold) | 5 | 医疗·行医 | 远程 | 谢拉格、维多利亚 | 攻击力和生命值+20%；核心盟约每叠加3层，本干员攻击力和生命值+1% [+1 impl. entries] **->** 攻击力和生命值+40%；核心盟约每叠加3层，本干员攻击力和生命值+2% | P |
| 06 | 莎草 (char_4139_papyrs) | 5 | 医疗·链愈师 | 远程 | 萨尔贡 | <战斗中>首次开启技能时，使已激活的【萨尔贡】层数+5 **->** <战斗中>首次开启技能时，使已激活的【萨尔贡】层数+10 | P |
| 07 | 幽灵鲨 (char_143_ghost) | 5 | 近卫·强攻手 | 近战 | 阿戈尔 | <战斗中>自身被击倒时，使已激活的【阿戈尔】层数+3 **->** <战斗中>自身被击倒时，使已激活的【阿戈尔】层数+6 | P |
| 08 | 泡泡 (char_381_bubble) | 4 | 重装·铁卫 | 近战 | 萨尔贡、坚守 | 【萨尔贡】【坚守】每叠加3层，本干员防御力+1% **->** 【萨尔贡】【坚守】每叠加3层，本干员防御力+2% | P |
| 09 | 休谟斯 (char_491_humus) | 4 | 近卫·收割者 | 近战 | 突袭 | <战斗中>每击倒2名敌人时，使已激活的【突袭】层数+1 **->** <战斗中>每击倒2名敌人，使已激活的【突袭】层数+2 | P |
| 10 | 洛洛 (char_4040_rockr) | 5 | 术师·驭械术师 | 远程 | 维多利亚、奥术 | <获得时>随机制造1件洛洛的定制品 **->** <获得时>随机制造2件洛洛的定制品 | P |
| 11 | 风丸 (char_4016_kazema) | 5 | 特种·傀儡师 | 近战 | 奇迹 | 只需2个相同的本干员即可合成精锐 **->** 只需2个相同的本干员即可合成精锐 | P |
| 12 | 砾 (char_237_gravel) | 4 | 特种·处决者 | 近战 | 卡西米尔、不屈 | <部署时>使已激活的【卡西米尔】层数+1 / <被击倒时>使已激活的【不屈】层数+2 [+1 impl. entries] **->** <部署时>使已激活的【卡西米尔】层数+2 / <被击倒时>使已激活的【不屈】层数+4 | P |
| 13 | 蒂比 (char_4191_tippi) | 5 | 特种·巡空者 | 近战 | 迅捷、灵巧 | <进入休整期时>使自身已激活的盟约层数+2 **->** <进入休整期时>使自身已激活的盟约层数+4 | P |
| 14 | 调香师 (char_181_flower) | 4 | 医疗·群愈师 | 远程 | 助力、协防干员 | <休整期结束时>当前激活且层数最多的盟约层数+2，此干员在整备区时也有效 **->** <休整期结束时>当前激活且层数最多的盟约层数+4，此干员在整备区时也有效 | P |
| 15 | 协律 (char_4051_akkord) | 4 | 术师·轰击术师 | 远程 | 奥术、助力 | <获得时>自身所属盟约层数+4（无需激活盟约） **->** <获得时>自身所属盟约层数+8（无需激活盟约） | P H |
| 16 | 拉普兰德 (char_140_whitew) | 5 | 近卫·领主 | 近战 | 叙拉古 | <刷新时>若为本回合首次主动刷新，使已激活的【叙拉古】层数+4，此干员在整备区时也有效 **->** <刷新时>若为本回合首次主动刷新，使已激活的【叙拉古】层数+8，此干员在整备区时也有效 | P |
| 17 | 折桠 (char_4207_branch) | 5 | 重装·不屈者 | 近战 | 坚守、独行 | <休整期结束时>使已激活的【坚守】层数+4 **->** <休整期结束时>使已激活的【坚守】层数+8 | P |
| 18 | 灰毫 (char_431_ashlok) | 5 | 重装·要塞 | 近战 | 卡西米尔、坚守 | <获得时>当前激活且层数最多的盟约层数+3 **->** <获得时>当前激活且层数最多的盟约层数+6 | P |
| 19 | 锡人 (char_4151_tinman) | 5 | 特种·炼金师 | 远程 | 投资人、迅捷 | 攻击力和生命值+20%；【投资人】【迅捷】每叠加3层，本干员攻击力和生命值+1% [+1 impl. entries] **->** 攻击力和生命值+40%；【投资人】【迅捷】每叠加3层，本干员攻击力和生命值+2% | P |

| sid | 干员 | 技能 (idx) | 类型/SP | SP init/cost | 持续 | Trigger | Normal stats | Golden stats |
|---|---|---|---|---|---|---|---|---|
| 01 | 送葬人 | 最终旅程 (S2) | 手动/自然 | 25/77 -> 29/74 | 16s -> 17s | DEFAULT | 1694/584/161/0/1/2.3s/2-5 | 2146/721/179/0/1/2.3s/2-5 |
| 02 | 赫默 | 医疗无人机 (S2) | 自动/自然 | 0/26 -> 0/22 | - | DEFAULT | 1400/369/110/0/1/2.85s/3-3 | 1614/451/133/0/1/2.85s/3-3 |
| 03 | 崖心 | 束缚链 (S2) | 手动/自然 | 10/22 -> 10/19 | - | DEFAULT | 1447/592/279/0/2/1.8s/3-2 | 1820/742/346/0/2/1.8s/3-2 |
| 04 | 小满 | 乡音沉沉 (S2) | 手动/自然 | 5/30 -> 10/25 | 14s | DEFAULT | 977/419/81/15/1/1.9s/y-2 | 1270/530/95/20/1/1.9s/y-2 |
| 05 | 哈洛德 | 重症优先 (S2) | 手动/自然 | 13/37 -> 15/35 | 25s | DEFAULT | 1176/295/78/10/1/2.85s/3-17 | 1408/381/94/10/1/2.85s/3-17 |
| 06 | 莎草 | 巧思乍现 (S1) | 自动/自然 | 0/9 | - | DEFAULT | 1440/338/124/0/1/2.85s/y-2 | 1639/450/173/0/1/2.85s/y-2 |
| 07 | 幽灵鲨 | 肉斩骨断 (S2) | 手动/自然 | 25/45 -> 30/43 | 11s -> 12s | DEFAULT | 1909/530/280/0/2/1.2s/1-1 | 2422/704/365/0/3/1.2s/1-1 |
| 08 | 泡泡 | “挨打” (S2) | 手动/自然 | 0/50 -> 0/49 | 25s | TAKE_DAMAGE | 2391/314/470/0/3/1.2s/0-1 | 3373/358/657/0/3/1.2s/0-1 |
| 09 | 休谟斯 | 高效处理 (S2) | 手动/自然 | 20/50 -> 25/45 | 20s -> 25s | DEFAULT | 1612/511/342/0/2/1.3s/1-3 | 2133/603/404/0/2/1.3s/1-3 |
| 10 | 洛洛 | 自负此轭 (S2) | 手动/自然 | 15/45 -> 20/40 | 40s | DEFAULT | 1078/259/99/15/1/1.3s/3-1 | 1406/317/128/20/1/1.3s/3-1 |
| 11 | 风丸 | 纸艺·双影 (S2) | 手动/自然 | 5/25 -> 10/20 | 20s | DEFAULT | 1816/547/254/0/2/1.2s/1-1 | 2214/697/326/0/2/1.2s/1-1 |
| 12 | 砾 | 鼠群 (S2) | 被动/被动 | 0/0 | inf | DEFAULT | 1107/352/281/0/1/0.93s/1-1 | 1452/430/363/0/1/0.93s/1-1 |
| 13 | 蒂比 | 紧急赶场通知 (S2) | 自动/自然 | 1/16 -> 2/13 | 15s | DEFAULT | 1805/567/297/0/2/1.5s/2-2 | 2210/695/364/0/2/1.5s/2-2 |
| 14 | 调香师 | 精调 (S2) | 手动/自然 | 20/60 | 30s | DEFAULT | 1232/256/120/0/1/2.85s/y-2 | 1544/331/140/0/1/2.85s/y-2 |
| 15 | 协律 | 震爆调谐 (S2) | 手动/自然 | 20/60 -> 24/52 | 32s | DEFAULT | 1237/564/98/15/1/2.9s/5-1 | 1610/695/107/20/1/2.9s/5-1 |
| 16 | 拉普兰德 | 狼魂 (S2) | 自动/攻击 | 0/27 -> 0/24 | 15s -> 17s | DEFAULT | 1791/535/293/10/2/1.3s/3-12 | 2304/664/345/15/2/1.3s/3-12 |
| 17 | 折桠 | 生存决心 (S2) | 手动/自然 | 0/24 -> 3/22 | 15s | TAKE_DAMAGE | 2645/650/400/10/3/1.6s/0-1 | 3638/805/535/10/3/1.6s/0-1 |
| 18 | 灰毫 | 攻击力强化·γ型 (S1) | 手动/自然 | 5/37 -> 10/35 | 30s | TAKE_DAMAGE | 2218/696/379/0/3/2.8s/4-5 | 3155/863/494/0/3/2.8s/4-6 |
| 19 | 锡人 | “大拉里” (S2) | 手动/自然 | 12/30 -> 14/25 | inf | DEFAULT | 851/366/80/25/1/1.5s/2-1 | 1120/461/94/30/1/1.5s/3-5 |

### Tier 3 (21 chess: 19 visible, 2 hidden, 0 DIY)

| sid | 干员 (charId) | ★ | 职业·分支 | 位置 | 盟约 | 特质 normal -> golden | Type |
|---|---|---|---|---|---|---|---|
| 01 | 能天使 (char_103_angel) | 6 | 狙击·速射手 | 远程 | 拉特兰、奇迹 | <获得时>使下个休整期额外获得1资金 **->** <获得时>使下个休整期额外获得2资金 | N |
| 02 | 断崖 (char_294_ayer) | 5 | 近卫·领主 | 近战 | 灵巧 | <休整期结束时>使自身及身后一格干员的已激活盟约分别各层数+3 **->** <休整期结束时>使自身及身后一格干员的已激活盟约分别各层数+6 | P |
| 03 | 诗怀雅 (char_308_swire) | 5 | 近卫·教官 | 近战 | 炎、远见 | <获得时>获得1个“盟约之币” **->** <获得时>获得2个“盟约之币” | P |
| 04 | 琳琅诗怀雅 (char_1033_swire2) | 6 | 特种·行商 | 近战 | 炎、投资人 | <休整期结束时>使下个休整期额外获得1资金（若已激活【炎】/【投资人】此特质在整备区也有效） **->** <休整期结束时>使下个休整期额外获得2资金（若已激活【炎】/【投资人】此特质在整备区也有效） | N |
| 05 | 斯卡蒂 (char_263_skadi) | 6 | 近卫·无畏者 | 近战 | 阿戈尔、坚守、突袭 | <战斗中>每击倒2名单位时，使已激活的【阿戈尔】【坚守】【突袭】层数+1 **->** <战斗中>每击倒2名敌人时，使已激活的【阿戈尔】【坚守】【突袭】层数+2 | N |
| 06 | 菲莱 (char_4148_philae) | 5 | 重装·本源铁卫 | 近战 | 萨尔贡 | <战斗中>开启技能时，使已激活的【萨尔贡】层数+6 **->** <战斗中>开启技能时，使已激活的【萨尔贡】层数+12 | P |
| 07 | 见行者 (char_4036_forcer) | 5 | 特种·推击手 | 近战 | 拉特兰 | <休整期结束时>使自身及身后一格干员的已激活盟约分别各层数+3 **->** <休整期结束时>使自身及身后一格干员的已激活盟约分别各层数+6 | P H |
| 08 | 薄绿 (char_388_mint) | 5 | 术师·阵法术师 | 远程 | 维多利亚 | <休整期结束时>场上每有1名不同阶的【维多利亚】干员，使已激活的【维多利亚】层数+2 **->** <休整期结束时>场上每有1名不同阶的【维多利亚】干员，使已激活的【维多利亚】层数+4 | P |
| 09 | 海霓 (char_4079_haini) | 5 | 辅助·削弱者 | 远程 | 阿戈尔、奥术 | <战斗中>首次击倒敌人或我方干员时，使已激活的【阿戈尔】【奥术】层数+3 **->** <战斗中>首次击倒敌人或我方干员时，使已激活的【阿戈尔】【奥术】层数+6 | P |
| 10 | 松果 (char_440_pinecn) | 4 | 狙击·散射手 | 远程 | 迅捷、协防干员 | <售出时>进行一次I阶干员的免费特殊招募 / 本干员合成为精锐状态后，上述特殊招募变为V阶干员 **->** <售出时>进行一次V阶干员的免费特殊招募 | P |
| 11 | 雪猎 (char_4211_snhunt) | 5 | 狙击·猎手 | 远程 | 谢拉格、精准 | <获得时>自身所属盟约层数+5（无需激活盟约） **->** <获得时>自身所属盟约层数+10（无需激活盟约） | P |
| 12 | 瑕光 (char_423_blemsh) | 6 | 重装·守护者 | 近战 | 卡西米尔、突袭 | <部署时>使自身已激活的盟约层数+4（每场作战至多12层） **->** <部署时>使自身已激活的盟约层数+8（每场作战至多24层） | N |
| 13 | 至简 (char_4054_malist) | 5 | 术师·驭械术师 | 远程 | 萨尔贡、灵巧 | 购买价格为1 **->** 购买价格为1 | P |
| 14 | 初雪 (char_174_slbell) | 5 | 辅助·削弱者 | 远程 | 谢拉格、远见 | <战斗中>每当范围内1名敌人进入冻结时，有50%概率使已激活的【谢拉格】层数+1 **->** <战斗中>每当范围内1名敌人进入冻结时，有50%概率使已激活的【谢拉格】层数+2 | P |
| 15 | 巫恋 (char_254_vodfox) | 5 | 辅助·削弱者 | 远程 | 叙拉古、助力 | <售出时>获得2次免费刷新 **->** <售出时>获得4次免费刷新 | P H |
| 16 | 蛇屠箱 (char_150_snakek) | 4 | 重装·铁卫 | 近战 | 坚守、不屈 | <休整期结束时>同一行每有1名干员，使已激活的【坚守】层数+1 **->** <休整期结束时>同一行每有1名干员，使已激活的【坚守】层数+2 | P |
| 17 | 流星 (char_126_shotst) | 4 | 狙击·速射手 | 远程 | 卡西米尔、独行 | <战斗中>攻击力和生命值+25%，造成的伤害变为弱点伤害（基于敌人的防御力和法术抗性变换物理和法术伤害） [+1 impl. entries] **->** <战斗中>攻击力和生命值+50%，造成的伤害变为弱点伤害（基于敌人的防御力和法术抗性变换物理和法术伤害） | P |
| 18 | 忍冬 (char_4026_vulpis) | 6 | 先锋·尖兵 | 近战 | 叙拉古、迅捷 | <获得时>自身所属盟约层数+6（无需激活盟约） **->** <获得时>自身所属盟约层数+12（无需激活盟约） | N |
| 19 | 伺夜 (char_427_vigil) | 6 | 先锋·战术家 | 远程 | 叙拉古、奇迹 | <战斗中>造成的伤害变为弱点伤害（基于敌人的防御力和法术抗性变换物理和法术伤害），前3次击倒敌人时使已激活的【叙拉古】层数+2、【奇迹】层数+1 [+2 impl. entries] **->** <战斗中>造成的伤害变为弱点伤害（基于敌人的防御力和法术抗性变换物理和法术伤害），前3次击倒敌人时使已激活的【叙拉古】层数+4、【奇迹】层数+2 | P |
| 20 | 耶拉 (char_4013_kjera) | 5 | 术师·驭械术师 | 远程 | 谢拉格、助力 | <获得时>获得1件“谢拉格不融冰” **->** <获得时>获得2件“谢拉格不融冰” | P |
| 21 | 空弦 (char_332_archet) | 6 | 狙击·速射手 | 远程 | 拉特兰、灵巧 | <进入休整期时>使自身及身前一格干员的已激活盟约分别各层数+3 **->** <进入休整期时>使自身及身前一格干员的已激活盟约分别各层数+6 | N |

| sid | 干员 | 技能 (idx) | 类型/SP | SP init/cost | 持续 | Trigger | Normal stats | Golden stats |
|---|---|---|---|---|---|---|---|---|
| 01 | 能天使 | 过载模式 (S3) | 自动/自然 | 20/44 -> 20/38 | 15s | DEFAULT | 1338/437/136/0/1/1s/3-3 | 1670/532/153/0/1/1s/3-3 |
| 02 | 断崖 | 浮游刃启动 (S2) | 手动/自然 | 18/54 -> 21/53 | 20s -> 21s | DEFAULT | 1911/542/311/10/2/1.3s/3-12 | 2411/675/359/10/2/1.3s/3-12 |
| 03 | 诗怀雅 | 协同作战 (S2) | 手动/攻击 | 20/55 -> 20/50 | 18s -> 21s | DEFAULT | 1378/551/346/0/2/1.05s/2-2 | 1898/679/396/0/2/1.05s/2-2 |
| 04 | 琳琅诗怀雅 | “见面礼” (S2) | 被动/被动 | 0/0 | inf | DEFAULT | 1864/672/388/0/1/1s/1-1 | 2323/788/469/0/1/1s/1-1 |
| 05 | 斯卡蒂 | 涌潮悲歌 (S3) | 手动/自然 | 55/90 -> 60/90 | 38s -> 41s | DEFAULT | 2938/842/220/0/1/1.5s/1-1 | 3853/1012/249/0/1/1.5s/1-1 |
| 06 | 菲莱 | 冥河诅咒 (S2) | 手动/自然 | 13/55 -> 17/50 | 40s | TAKE_DAMAGE | 2323/482/435/10/3/1.6s/0-1 | 3148/617/516/10/3/1.6s/0-1 |
| 07 | 见行者 | 惊爆射击 (S2) | 手动/自然 | 0/21 -> 0/20 | inf | DEFAULT | 1510/528/316/0/2/1.2s/1-1 | 1999/666/365/0/2/1.2s/1-1 |
| 08 | 薄绿 | 聚能涡旋 (S2) | 手动/自然 | 10/33 -> 12/31 | 20s | SEARCH | 1594/629/170/15/1/2s/x-1 | 1986/746/204/15/1/2s/x-1 |
| 09 | 海霓 | 阻滞性显色剂 (S2) | 手动/自然 | 19/39 -> 22/38 | 26s -> 27s | DEFAULT | 1267/365/90/25/1/1.6s/y-6 | 1534/434/113/25/1/1.6s/y-6 |
| 10 | 松果 | 电能过载 (S2) | 自动/自然 | 0/30 | 20s | DEFAULT | 1650/560/150/0/1/2.3s/2-5 | 2120/681/180/0/1/2.3s/2-5 |
| 11 | 雪猎 | 风雪连弩 (S2) | 手动/自然 | 7/20 -> 7/14 | - | DEFAULT | 1316/824/177/0/1/1.6s/4-9 | 1750/991/211/0/1/1.6s/4-9 |
| 12 | 瑕光 | 先贤化身 (S3) | 手动/受击 | 15/29 -> 15/28 | 23s -> 26s | TAKE_DAMAGE | 2334/402/476/10/3/1.2s/1-1 | 3096/496/581/10/3/1.2s/1-1 |
| 13 | 至简 | 神工意匠 (S2) | 自动/自然 | 1/7 -> 2/6 | - | DEFAULT | 1064/268/100/20/1/1.3s/3-1 | 1375/327/115/20/1/1.3s/3-1 |
| 14 | 初雪 | 自然震慑 (S2) | 手动/自然 | 13/40 -> 16/40 | 14s -> 18s | DEFAULT | 1251/356/89/25/1/1.6s/y-6 | 1615/411/99/25/1/1.6s/y-6 |
| 15 | 巫恋 | 诅咒娃娃 (S2) | 自动/自然 | 10/44 -> 10/38 | inf | DEFAULT | 1347/338/92/25/1/1.6s/y-6 | 1632/400/117/25/1/1.6s/y-6 |
| 16 | 蛇屠箱 | 壳状防御 (S2) | 手动/自然 | 0/40 | 30s | TAKE_DAMAGE | 2173/310/503/0/3/1.2s/0-1 | 3100/357/723/0/3/1.2s/0-1 |
| 17 | 流星 | 碎甲击·扩散 (S2) | 手动/攻击 | 0/19 -> 0/18 | inf | DEFAULT | 1123/381/139/0/1/1s/3-3 | 1434/475/161/0/1/1s/3-3 |
| 18 | 忍冬 | 隐狐之艺 (S3) | 手动/自然 | 6/21 -> 7/20 | 10s | DEFAULT | 1481/460/304/0/2/1.05s/1-1 | 2020/563/354/0/2/1.05s/1-1 |
| 19 | 伺夜 | 领袖的尊严 (S3) | 手动/自然 | 6/42 -> 7/39 | 15s | ALWAYS | 1439/378/130/0/1/1s/3-3 | 1798/454/161/0/1/1s/3-3 |
| 20 | 耶拉 | 心随意动 (S2) | 手动/自然 | 15/47 -> 20/44 | 25s | DEFAULT | 1121/246/101/20/1/1.3s/3-1 | 1450/300/116/20/1/1.3s/3-1 |
| 21 | 空弦 | 箭矢·暴风 (S3) | 手动/攻击 | 15/37 -> 15/34 | 20s | DEFAULT | 1364/427/146/0/1/1s/3-3 | 1590/511/180/0/1/1s/3-3 |

### Tier 4 (26 chess: 22 visible, 4 hidden, 0 DIY)

| sid | 干员 (charId) | ★ | 职业·分支 | 位置 | 盟约 | 特质 normal -> golden | Type |
|---|---|---|---|---|---|---|---|
| 01 | 信仰搅拌机 (char_4194_rmixer) | 6 | 重装·哨戒铁卫 | 近战 | 拉特兰、坚守 | 【拉特兰】【坚守】每叠加3层，本干员防御力+1% **->** 【拉特兰】【坚守】每叠加3层，本干员防御力+2% | P |
| 02 | 莫斯提马 (char_213_mostma) | 6 | 术师·扩散术师 | 远程 | 拉特兰、奥术 | <战斗中>自身周围4格的干员每消耗6发弹药，使已激活的【拉特兰】层数+1 **->** <战斗中>自身周围4格的干员每消耗6发弹药，使已激活的【拉特兰】层数+2 | N |
| 03 | 耶拉 (char_4013_kjera) | 5 | 术师·驭械术师 | 远程 | 谢拉格、助力 | <获得时>获得1件“谢拉格不融冰” **->** <获得时>获得2件“谢拉格不融冰” | P H |
| 04 | 伊内丝 (char_4087_ines) | 6 | 先锋·情报官 | 近战 | 远见、突袭 | <休整期结束时>使自身已激活的盟约层数+5 **->** <休整期结束时>使自身已激活的盟约层数+10 | N |
| 05 | 蜜蜡 (char_344_beewax) | 5 | 术师·阵法术师 | 远程 | 萨尔贡、助力 | <获得时>获得1件“迅捷作战粮” **->** <获得时>获得2件“迅捷作战粮” | P H |
| 06 | 寒芒克洛丝 (char_1021_kroos2) | 5 | 狙击·速射手 | 远程 | 精准 | <战斗开始时>使身前一格干员获得特质“开启技能时使已激活【精准】层数+1”（每场战斗至多10层） **->** <战斗开始时>使身前一格干员获得特质“开启技能时使已激活【精准】层数+2”（每场战斗至多20层） | P |
| 07 | 风笛 (char_222_bpipe) | 6 | 先锋·冲锋手 | 近战 | 维多利亚、远见、不屈 | <战斗中>前3次击倒敌人时，使已激活的【维多利亚】【远见】【不屈】层数+2 **->** <战斗中>前3次击倒敌人时，使已激活的【维多利亚】【远见】【不屈】层数+4 | N |
| 08 | 瑰盐 (char_4163_rosesa) | 5 | 医疗·群愈师 | 远程 | 协防干员 | <售出时>触发场上一名拥有“休整期结束时”的干员的特质（优先触发部署位置更靠上的和更靠右的） **->** <售出时>触发场上一名拥有“休整期结束时”的干员的特质（优先触发部署位置更靠上的和更靠右的） | P H |
| 09 | 水月 (char_437_mizuki) | 6 | 特种·伏击客 | 近战 | 阿戈尔、独行 | 【阿戈尔】每叠加3层，本干员攻击力+1% **->** 【阿戈尔】每叠加3层，本干员攻击力+2% | N |
| 10 | 阿罗玛 (char_446_aroma) | 5 | 术师·轰击术师 | 远程 | 叙拉古、奥术 | <休整期结束时>本回合每刷新过1次，使已激活的【叙拉古】【奥术】层数+2（至多6层） **->** <休整期结束时>本回合每刷新过1次，使已激活的【叙拉古】【奥术】层数+4（每回合至多12层） | P |
| 11 | 凯瑟琳 (char_4162_cathy) | 5 | 辅助·工匠 | 近战 | 维多利亚、灵巧 | <进入休整期时>若当前为奇数回合，获得1件随机装备 **->** <进入休整期时>若当前为奇数回合，获得2件随机装备 | P |
| 12 | 歌蕾蒂娅 (char_474_glady) | 6 | 特种·钩索师 | 近战 | 阿戈尔 | <进入休整期时>若同一行有3名干员，获得1个斯卡蒂、幽灵鲨或深巡 **->** <进入休整期时>若同一行有3名干员，获得1个斯卡蒂、幽灵鲨或深巡，重复2次 | P |
| 13 | 灵知 (char_206_gnosis) | 6 | 辅助·削弱者 | 远程 | 谢拉格、灵巧 | <获得时>自身所属盟约层数+5（无需激活盟约） **->** <获得时>自身所属盟约层数+10（无需激活盟约） | N |
| 14 | 莱恩哈特 (char_373_lionhd) | 5 | 术师·扩散术师 | 远程 | 迅捷、精准 | <休整期结束时>使自身已激活的盟约层数+5 **->** <休整期结束时>使自身已激活的盟约层数+10 | P |
| 15 | 录武官 (char_4196_reckpr) | 5 | 医疗·医师 | 远程 | 炎、奇迹 | <获得时>【炎】层数+6、【奇迹】层数+3（无需激活盟约） [+1 impl. entries] **->** <获得时>【炎】层数+12、【奇迹】层数+6（无需激活盟约） | P H |
| 16 | 缄默德克萨斯 (char_1028_texas2) | 6 | 特种·处决者 | 近战 | 叙拉古、突袭 | <进入休整期时>获得1次免费刷新 **->** <进入休整期时>获得2次免费刷新 | N |
| 17 | 星熊 (char_136_hsguma) | 6 | 重装·铁卫 | 近战 | 炎 | <获得时>自身所属盟约层数+8（无需激活盟约） **->** <获得时>自身所属盟约层数+16（无需激活盟约） | N |
| 18 | 泥岩 (char_311_mudrok) | 6 | 重装·不屈者 | 近战 | 独行 | <售出时>进入下个休整期额外获得2资金 **->** <售出时>进入下个休整期额外获得4资金 | N |
| 19 | 焰尾 (char_420_flamtl) | 6 | 先锋·尖兵 | 近战 | 卡西米尔 | <获得时>获得1个野鬃或灰毫，小概率获得远牙 **->** <获得时>获得2个野鬃或灰毫，小概率获得远牙 | N |
| 20 | 远牙 (char_430_fartth) | 6 | 狙击·神射手 | 远程 | 卡西米尔、精准 | <战斗开始时>使同一行最右边一名干员获得特质“<部署时>使已激活的【卡西米尔】【精准】层数+4（每场作战至多24层）” **->** <战斗开始时>使同一行最右边一名干员获得特质“<部署时>使已激活的【卡西米尔】【精准】层数+8（每场作战至多48层）” | N |
| 21 | 白面鸮 (char_128_plosis) | 5 | 医疗·群愈师 | 远程 | 助力、灵巧 | 身前一格干员若为“进入休整期时”特质，本干员的特质与其相同 **->** 身前一格干员若为“进入休整期时”特质，本干员的特质与其相同 | P |
| 22 | 银灰 (char_172_svrash) | 6 | 近卫·领主 | 近战 | 谢拉格 | <战斗中>每当范围内1名敌人进入冻结时，有50%概率使已激活的【谢拉格】层数+1 **->** <战斗中>每当范围内1名敌人进入冻结时，有50%概率使已激活的【谢拉格】层数+2 | N |
| 23 | 百炼嘉维尔 (char_1026_gvial2) | 6 | 近卫·强攻手 | 近战 | 萨尔贡 | <战斗中>开启技能时，使已激活的【萨尔贡】层数+9 **->** <战斗中>开启技能时，使已激活的【萨尔贡】层数+18 | N |
| 24 | 卡涅利安 (char_426_billro) | 6 | 术师·阵法术师 | 远程 | 萨尔贡、助力 | <获得时>获得1件“迅捷作战粮” **->** <获得时>获得2件“迅捷作战粮” | N |
| 25 | 魔王 (char_4134_cetsyr) | 6 | 辅助·吟游者 | 远程 | 协防干员 | <战斗中>战斗中当本干员身前一格的干员因特质使层数提升时，使其额外层数+1 **->** <战斗中>战斗中当本干员身前一格的干员因特质使层数提升时，使其额外层数+2 | P |
| 26 | 华法琳 (char_171_bldsk) | 5 | 医疗·医师 | 远程 | 奇迹 | <战斗开始时>使身前一格干员获得特质“开启技能时使自身所属已激活盟约层数+1”（每场战斗至多7层） **->** <战斗开始时>使身前一格干员获得特质“开启技能时使自身所属已激活盟约层数+2”（每场战斗至多14层） | P |

| sid | 干员 | 技能 (idx) | 类型/SP | SP init/cost | 持续 | Trigger | Normal stats | Golden stats |
|---|---|---|---|---|---|---|---|---|
| 01 | 信仰搅拌机 | 退休前布道 (S3) | 手动/自然 | 20/43 -> 22/41 | ammo | TAKE_DAMAGE | 2638/418/513/0/3/1.2s/2-2 | 3537/515/669/0/3/1.2s/2-2 |
| 02 | 莫斯提马 | 序时之匙 (S3) | 手动/自然 | 56/110 -> 62/110 | 22s -> 24s | DEFAULT | 1428/700/110/20/1/2.9s/3-6 | 1695/840/125/20/1/2.9s/3-6 |
| 03 | 耶拉 | 心随意动 (S2) | 手动/自然 | 15/47 -> 20/44 | 25s | DEFAULT | 1121/246/101/20/1/1.3s/3-1 | 1450/300/116/20/1/1.3s/3-1 |
| 04 | 伊内丝 | 暗夜无明 (S2) | 手动/自然 | 10/27 -> 15/24 | 12s | DEFAULT | 1760/482/241/0/1/1s/2-2 | 2149/573/268/0/1/1s/2-2 |
| 05 | 蜜蜡 | 守卫尖碑 (S2) | 手动/自然 | 10/28 -> 10/26 | 20s | SEARCH | 1644/632/178/15/1/2s/x-1 | 2064/764/198/15/1/2s/x-1 |
| 06 | 寒芒克洛丝 | 封喉 (S2) | 手动/自然 | 15/45 -> 20/40 | 24s -> 26s | DEFAULT | 1246/411/148/0/1/1s/3-3 | 1561/501/169/0/1/1s/3-3 |
| 07 | 风笛 | 高效冲击 (S2) | 自动/自然 | 0/6 -> 0/5 | - | DEFAULT | 1738/492/313/0/1/1s/1-1 | 2383/604/359/0/1/1s/1-1 |
| 08 | 瑰盐 | 绝妙的长效药呀 (S2) | 手动/自然 | 19/43 -> 21/40 | 27s | DEFAULT | 1323/264/125/0/1/2.85s/y-2 | 1656/338/144/0/1/2.85s/y-2 |
| 09 | 水月 | 囚徒困境 (S2) | 手动/自然 | 5/22 -> 5/19 | 17s -> 19s | DEFAULT | 1336/692/302/30/0/3.5s/y-1 | 1736/867/338/30/0/3.5s/y-1 |
| 10 | 阿罗玛 | 小心地滑 (S2) | 手动/自然 | 20/55 -> 21/48 | 23s | DEFAULT | 1288/638/103/20/1/2.9s/5-1 | 1664/778/112/20/1/2.9s/5-1 |
| 11 | 凯瑟琳 | 战火淬炼 (S2) | 手动/自然 | 15/35 -> 15/32 | 30s | DEFAULT | 2144/456/353/0/2/1.5s/1-1 | 2644/546/423/0/2/1.5s/1-1 |
| 12 | 歌蕾蒂娅 | 缺水的碎漩狂舞 (S3) | 手动/自然 | 22/42 -> 24/39 | 8s | DEFAULT | 1754/640/281/0/2/1.8s/3-2 | 2232/792/314/0/2/1.8s/3-2 |
| 13 | 灵知 | 零度爆发 (S2) | 手动/自然 | 0/8 -> 0/7 | inf | DEFAULT | 1587/377/116/25/1/1.6s/y-6 | 1989/444/142/25/1/1.6s/y-6 |
| 14 | 莱恩哈特 | 解构与爆破 (S2) | 手动/自然 | 0/14 -> 0/13 | inf | DEFAULT | 1276/649/100/20/1/2.9s/3-6 | 1626/787/115/20/1/2.9s/3-6 |
| 15 | 录武官 | 一点关窍 (S2) | 手动/自然 | 20/42 -> 25/40 | 25s | DEFAULT | 1422/416/99/0/1/2.85s/3-3 | 1610/480/118/0/1/2.85s/3-3 |
| 16 | 缄默德克萨斯 | 剑雨滂沱 (S3) | 被动/被动 | 0/0 | 6s -> 7s | DEFAULT | 1246/443/268/0/1/0.93s/1-1 | 1619/567/302/0/1/0.93s/1-1 |
| 17 | 星熊 | 荆棘 (S2) | 被动/被动 | 0/0 | - | TAKE_DAMAGE | 2849/356/527/0/3/1.2s/1-1 | 3513/455/727/0/4/1.2s/1-1 |
| 18 | 泥岩 | 岩崩锤 (S2) | 自动/受击 | 0/5 | - | TAKE_DAMAGE | 2867/687/463/10/3/1.6s/1-1 | 3815/871/555/10/3/1.6s/1-1 |
| 19 | 焰尾 | 焰心 (S3) | 手动/自然 | 2/21 -> 3/19 | 8s | DEFAULT | 1560/431/313/0/2/1.05s/1-1 | 2118/529/365/0/2/1.05s/1-1 |
| 20 | 远牙 | 光羽箭 (S3) | 手动/自然 | 6/27 -> 7/24 | 16s -> 17s | CUSTOM_RANGE_SEARCH_ENEMY (6-1) | 1217/980/133/0/1/2.7s/3-9 | 1419/1193/153/0/1/2.7s/3-9 |
| 21 | 白面鸮 | 脑啡肽 (S2) | 手动/自然 | 70/100 -> 75/100 | 33s -> 36s | DEFAULT | 1271/268/124/0/1/2.85s/y-2 | 1584/348/143/0/1/2.85s/y-2 |
| 22 | 银灰 | 真银斩 (S3) | 手动/自然 | 55/90 -> 60/90 | 23s -> 26s | DEFAULT | 2022/577/329/10/2/1.3s/3-12 | 2569/712/374/10/2/1.3s/3-12 |
| 23 | 百炼嘉维尔 | 丛林之魂 (S3) | 手动/自然 | 20/40 -> 21/39 | 25s | DEFAULT | 2179/582/320/0/3/1.2s/1-1 | 2811/749/390/0/3/1.2s/1-1 |
| 24 | 卡涅利安 | 沙缚镣锁 (S2) | 手动/自然 | 4/25 -> 7/25 | 25s | SEARCH | 1726/727/198/15/1/2s/x-1 | 2178/872/218/15/1/2s/x-1 |
| 25 | 魔王 | 编织重构现世 (S3) | 手动/自然 | 35/80 -> 35/70 | 30s | ALWAYS | 1221/306/188/0/1/1.3s/x-1 | 1671/368/220/0/1/1.3s/x-1 |
| 26 | 华法琳 | 紧急包扎 (S1) | 自动/攻击 | 0/4 | - | DEFAULT | 1368/404/100/0/1/2.85s/3-3 | 1522/509/119/0/1/2.85s/3-3 |

### Tier 5 (25 chess: 19 visible, 4 hidden, 2 DIY)

| sid | 干员 (charId) | ★ | 职业·分支 | 位置 | 盟约 | 特质 normal -> golden | Type |
|---|---|---|---|---|---|---|---|
| 22 | 妮芙 (char_4146_nymph) | 6 | 术师·本源术师 | 远程 | 迅捷 | <休整期结束时>整备区每有1个干员，使已激活的【迅捷】层数+2 **->** <休整期结束时>整备区每有1个干员，使已激活的【迅捷】层数+4 | N |
| 01 | 圣约送葬人 (char_1032_excu2) | 6 | 近卫·收割者 | 近战 | 拉特兰、远见 | <战斗中>自身每消耗7发子弹，使已激活的【拉特兰】层数+7、【远见】层数+3（每场战斗分别至多触发7次） [+1 impl. entries] **->** <战斗中>自身每消耗7发子弹，使已激活的【拉特兰】层数+14、【远见】层数+6（每场战斗至多触发7次） | N |
| 02 | 缇缇 (char_4056_titi) | 6 | 医疗·咒愈师 | 远程 | 萨尔贡、精准 | <战斗中>每当范围内有敌人或干员进入沉睡或晕眩时，使已激活的【萨尔贡】【精准】层数+1（每场战斗至多24层） **->** <战斗中>每当范围内有敌人或干员进入沉睡或晕眩时，使已激活的【萨尔贡】【精准】层数+2（每场战斗至多48层） | N |
| 03 | 烛煌 (char_1040_blaze2) | 6 | 术师·本源术师 | 远程 | 维多利亚、炎 | <获得时>【炎】【维多利亚】层数+5（无需激活盟约） **->** <获得时>【炎】【维多利亚】层数+10（无需激活盟约） | N |
| 04 | 华法琳 (char_171_bldsk) | 5 | 医疗·医师 | 远程 | 奇迹 | <战斗开始时>使身前一格干员获得特质“开启技能时使自身所属已激活盟约层数+1”（每场战斗至多7层） **->** <战斗开始时>使身前一格干员获得特质“开启技能时使自身所属已激活盟约层数+2”（每场战斗至多14层） | P H |
| 05 | 乌尔比安 (char_4145_ulpia) | 6 | 近卫·重剑手 | 近战 | 阿戈尔 | 【阿戈尔】每叠加2层，本干员攻击力+1% **->** 【阿戈尔】每叠加2层，本干员攻击力+2% | N |
| 06 | 隐德来希 (char_4010_etlchi) | 6 | 近卫·收割者 | 近战 | 不屈、灵巧 | 核心盟约每叠加3层，本干员攻击力和生命值+1% **->** 核心盟约每叠加3层，本干员攻击力和生命值+2% | N |
| 07 | 史尔特尔 (char_350_surtr) | 6 | 近卫·术战者 | 近战 | 突袭、奥术 | <部署时>使已激活的【突袭】层数+8（每场作战至多50层） **->** <部署时>使已激活的【突袭】层数+16（每场作战至多100层） | N |
| 08 | 号角 (char_4039_horn) | 6 | 重装·要塞 | 近战 | 维多利亚 | <休整期结束时>当前已激活且层数最多的盟约每有1名不同阶干员在场，层数+2 **->** <休整期结束时>当前已激活且层数最多的盟约每有1名不同阶干员在场，层数+4 | N |
| 09 | 魔王 (char_4134_cetsyr) | 6 | 辅助·吟游者 | 远程 | 协防干员 | <战斗中>战斗中当本干员身前一格的干员因特质使层数提升时，使其额外层数+1 **->** <战斗中>战斗中当本干员身前一格的干员因特质使层数提升时，使其额外层数+2 | P H |
| 10 | 铃兰 (char_358_lisa) | 6 | 辅助·凝滞师 | 远程 | 叙拉古、协防干员 | <进入休整期时>触发身前一格的其他干员的“获得时”类效果 **->** <进入休整期时>触发身前两格的其他干员的“获得时”类效果 | N |
| 11 | 塞雷娅 (char_202_demkni) | 6 | 重装·守护者 | 近战 | 坚守、独行 | 身前一格干员若为“休整期结束时”特质，本干员的特质与其相同 **->** 身前一格干员若为“休整期结束时”特质，本干员的特质与其相同 | N |
| 12 | 夕 (char_2015_dusk) | 6 | 术师·扩散术师 | 远程 | 炎、奥术 | <休整期结束时>当前休整期每获得过一名干员，使已激活的【炎】【奥术】层数+2 **->** <休整期结束时>当前休整期每获得过一名干员，使已激活的【炎】【奥术】层数+4 | N |
| 13 | 归溟幽灵鲨 (char_1023_ghost2) | 6 | 特种·傀儡师 | 近战 | 阿戈尔、不屈 | <战斗中>自身被击倒或替身与本体进行切换时，使已激活的【阿戈尔】层数+5、【不屈】层数+5 **->** <战斗中>自身被击倒或替身与本体进行切换时，使已激活的【阿戈尔】层数+10、【不屈】层数+10 | N |
| 14 | 凛御银灰 (char_1045_svash2) | 6 | 先锋·策士 | 近战 | 谢拉格、投资人、迅捷 | <战斗开始时>使身前一格【谢拉格】干员获得特质“范围内1名敌人进入冻结时，有60%概率使已激活的【谢拉格】层数+1” **->** <战斗开始时>使身前一格【谢拉格】干员获得特质“范围内1名敌人进入冻结时，有60%概率使已激活的【谢拉格】层数+2” | N |
| 15 | 引星棘刺 (char_1039_thorn2) | 6 | 特种·炼金师 | 远程 | 迅捷、奇迹 | <休整期结束时>使自身及身前一格干员的已激活盟约分别各层数+4 **->** <休整期结束时>使自身及身前一格干员的已激活盟约分别各层数+8 | N |
| 16 | 白面鸮 (char_128_plosis) | 5 | 医疗·群愈师 | 远程 | 助力、灵巧 | 身前一格干员若为“进入休整期时”特质，本干员的特质与其相同 **->** 身前一格干员若为“进入休整期时”特质，本干员的特质与其相同 | P H |
| 17 | 山 (char_264_f12yin) | 6 | 近卫·斗士 | 近战 | 投资人 | <休整期结束时>本回合每获得过1名干员，使已激活的【投资人】层数+1 **->** <休整期结束时>本回合每获得过1名干员，使已激活的【投资人】层数+2 | N |
| 18 | 百炼嘉维尔 (char_1026_gvial2) | 6 | 近卫·强攻手 | 近战 | 萨尔贡 | <战斗中>开启技能时，使已激活的【萨尔贡】层数+9 **->** <战斗中>开启技能时，使已激活的【萨尔贡】层数+18 | N H |
| 19 | 玛恩纳 (char_4064_mlynar) | 6 | 近卫·解放者 | 近战 | 卡西米尔 | 【卡西米尔】每叠加5层，本干员部署后100秒内基础攻击力+10、基础生命值+50 **->** 【卡西米尔】每叠加5层，本干员部署后100秒内基础攻击力+20、基础生命值+100 | N |
| 20 | 安洁莉娜 (char_291_aglina) | 6 | 辅助·凝滞师 | 远程 | 叙拉古、奇迹 | <休整期结束时>本回合每刷新过1次，使已激活的【叙拉古】层数+4（每回合至多12层） **->** <休整期结束时>本回合每刷新过1次，使已激活的【叙拉古】层数+8（每回合至多24层） | N |
| 21 | 寒檀 (char_341_sntlla) | 5 | 术师·扩散术师 | 远程 | 远见 | <进入休整期时><休整期结束时>使已激活的【远见】层数+4 [+1 impl. entries] **->** <进入休整期时><休整期结束时>使已激活的【远见】层数+8 | P |
| 23 | 录武官 (char_4196_reckpr) | 5 | 医疗·医师 | 远程 | 炎、奇迹 | <获得时>【炎】层数+6、【奇迹】层数+3（无需激活盟约） **->** <获得时>【炎】层数+12、【奇迹】层数+6（无需激活盟约） | P |
| diy1 | *甄选 DIY slot* | 6 req | any | - | (fallback 协防干员) | none | D |
| diy2 | *甄选 DIY slot* | 6 req | any | - | (fallback 协防干员) | none | D |

| sid | 干员 | 技能 (idx) | 类型/SP | SP init/cost | 持续 | Trigger | Normal stats | Golden stats |
|---|---|---|---|---|---|---|---|---|
| 22 | 妮芙 | 怵然震爆 (S2) | 手动/自然 | 3/17 -> 6/14 | inf | DEFAULT | 1237/550/107/15/1/1.6s/3-1 | 1611/670/122/15/1/1.6s/3-1 |
| 01 | 圣约送葬人 | 近身铳斗 (S2) | 手动/攻击 | 3/15 -> 6/15 | ammo | DEFAULT | 1967/586/396/0/2/1.3s/1-3 | 2314/706/463/0/2/1.3s/1-3 |
| 02 | 缇缇 | 旧日绽放 (S3) | 手动/自然 | 20/45 -> 22/40 | 25s | DEFAULT | 1208/438/93/20/1/1.6s/3-3 | 1439/546/109/20/1/1.6s/3-3 |
| 03 | 烛煌 | 众恶的焚场 (S3) | 手动/自然 | 13/37 -> 16/34 | ammo | DEFAULT | 1206/556/108/15/1/1.6s/3-1 | 1472/678/133/15/1/1.6s/3-1 |
| 04 | 华法琳 | 紧急包扎 (S1) | 自动/攻击 | 0/4 | - | DEFAULT | 1368/404/100/0/1/2.85s/3-3 | 1522/509/119/0/1/2.85s/3-3 |
| 05 | 乌尔比安 | 必须开辟的通路 (S3) | 手动/自然 | 10/29 -> 15/28 | 25s | CUSTOM_RANGE_SEARCH_ENEMY (6-1) | 4697/1317/0/0/2/2.5s/1-1 | 5905/1568/0/0/2/2.5s/1-1 |
| 06 | 隐德来希 | 灵与欲的惜别 (S3) | 手动/自然 | 20/36 -> 20/35 | 20s | DEFAULT | 2038/581/388/0/2/1.3s/1-3 | 2397/710/450/0/2/1.3s/1-3 |
| 07 | 史尔特尔 | 黄昏 (S3) | 手动/自然 | 0/9 -> 0/8 | inf | DEFAULT | 2216/544/343/15/1/1.25s/1-1 | 2680/659/390/20/1/1.25s/1-1 |
| 08 | 号角 | 终极防线 (S3) | 手动/自然 | 15/50 -> 25/40 | 24s | TAKE_DAMAGE | 2200/776/452/0/3/2.8s/4-6 | 2775/947/615/0/3/2.8s/4-6 |
| 09 | 魔王 | 编织重构现世 (S3) | 手动/自然 | 35/80 -> 35/70 | 30s | ALWAYS | 1221/306/188/0/1/1.3s/x-1 | 1671/368/220/0/1/1.3s/x-1 |
| 10 | 铃兰 | 狐火渺然 (S3) | 手动/自然 | 43/70 -> 46/70 | 27s -> 29s | DEFAULT | 1184/432/107/25/1/1.9s/y-2 | 1480/491/121/25/1/1.9s/y-2 |
| 11 | 塞雷娅 | 药物配置 (S2) | 自动/自然 | 0/9 -> 0/8 | - | TAKE_DAMAGE | 2268/388/487/10/3/1.2s/0-1 | 3003/502/559/10/3/1.2s/0-1 |
| 12 | 夕 | 工笔入化 (S1) | 自动/自然 | 0/7 -> 0/6 | inf | DEFAULT | 1404/771/106/20/1/2.9s/3-6 | 1787/923/120/20/1/2.9s/3-6 |
| 13 | 归溟幽灵鲨 | 生存的渴望 (S2) | 手动/自然 | 20/40 -> 25/35 | 15s -> 17s | DEFAULT | 2214/604/267/0/2/1.2s/1-1 | 2804/742/303/0/2/1.2s/1-1 |
| 14 | 凛御银灰 | 御敌的锋锐 (S2) | 手动/自然 | 7/17 -> 8/17 | - | DEFAULT | 1552/507/317/15/2/1.2s/1-1 | 1994/581/370/15/2/1.2s/1-1 |
| 15 | 引星棘刺 | 解构涌潮 (S2) | 手动/自然 | 12/27 -> 13/24 | inf | DEFAULT | 926/405/89/30/1/1.5s/3-5 | 1170/499/100/30/1/1.5s/3-5 |
| 16 | 白面鸮 | 脑啡肽 (S2) | 手动/自然 | 70/100 -> 75/100 | 33s -> 36s | DEFAULT | 1271/268/124/0/1/2.85s/y-2 | 1584/348/143/0/1/2.85s/y-2 |
| 17 | 山 | 横扫架势 (S2) | 手动/自然 | 0/9 -> 0/8 | - | DEFAULT | 2250/475/299/0/1/0.78s/1-1 | 2738/584/352/0/1/0.78s/1-1 |
| 18 | 百炼嘉维尔 | 链锯强袭 (S2) | 手动/自然 | 25/42 -> 25/39 | 33s -> 36s | DEFAULT | 2179/582/320/0/3/1.2s/1-1 | 2811/749/390/0/3/1.2s/1-1 |
| 19 | 玛恩纳 | 未照耀的荣光 (S3) | 手动/自然 | 15/50 -> 20/45 | 26s | CUSTOM_RANGE_SEARCH_ENEMY (3-18) | 3241/301/426/15/3/1.2s/1-2 | 3907/355/476/15/3/1.2s/1-2 |
| 20 | 安洁莉娜 | 秘杖·反重力模式 (S3) | 手动/自然 | 3/25 -> 6/25 | 14s -> 18s | SEARCH | 1108/449/100/25/1/1.9s/y-2 | 1382/546/113/25/1/1.9s/y-2 |
| 21 | 寒檀 | “女巫之泪” (S2) | 手动/自然 | 20/47 -> 20/44 | 15s | DEFAULT | 1279/646/103/20/1/2.9s/3-6 | 1629/779/118/20/1/2.9s/3-6 |
| 23 | 录武官 | 一点关窍 (S2) | 手动/自然 | 20/42 -> 25/40 | 25s | DEFAULT | 1422/416/99/0/1/2.85s/3-3 | 1610/480/118/0/1/2.85s/3-3 |

### Tier 6 (22 chess: 19 visible, 1 hidden, 2 DIY)

| sid | 干员 (charId) | ★ | 职业·分支 | 位置 | 盟约 | 特质 normal -> golden | Type |
|---|---|---|---|---|---|---|---|
| 01 | 蕾缪安 (char_4193_lemuen) | 6 | 狙击·神射手 | 远程 | 拉特兰、精准 | <战斗中>自身每消耗10发子弹，若同一行有3名干员，使已激活的【拉特兰】【精准】层数+2 **->** <战斗中>自身每消耗10发子弹，若同一行有3名干员，使已激活的【拉特兰】【精准】层数+4 | N |
| 02 | 圣聆初雪 (char_1046_sbell2) | 6 | 术师·阵法术师 | 远程 | 谢拉格、奥术 | 【谢拉格】【奥术】每叠加3层，本干员攻击力+1% **->** 【谢拉格】【奥术】每叠加3层，本干员攻击力+2% | N |
| 03 | 余 (char_2026_yu) | 6 | 重装·本源铁卫 | 近战 | 炎、坚守 | <进入休整期时>若同一行有3名干员，随机获得1名当前人数最多盟约的干员 **->** <进入休整期时>随机获得1名当前人数最多盟约的干员 | N |
| 04 | 浊心斯卡蒂 (char_1012_skadi2) | 6 | 辅助·吟游者 | 远程 | 阿戈尔 | 【阿戈尔】每叠加10层，本干员每秒回复50生命，自然技力回复速度+0.15/秒 **->** 【阿戈尔】每叠加10层，本干员每秒回复100生命，自然技力回复速度+0.3/秒 | N |
| 05 | 异客 (char_472_pasngr) | 6 | 术师·链术师 | 远程 | 萨尔贡、迅捷、精准 | 【萨尔贡】【迅捷】【精准】每叠加3层，本干员攻击力+2% **->** 【萨尔贡】【迅捷】【精准】每叠加3层，本干员攻击力+4% | N |
| 06 | 佩佩 (char_4058_pepe) | 6 | 近卫·撼地者 | 近战 | 萨尔贡、不屈 | <进入休整期时>获得1件“盟约之币”或“萨尔贡浓茶”，有小概率发现“黄沙罗盘” **->** <进入休整期时>获得2件“盟约之币”或“萨尔贡浓茶”，有概率发现“黄沙罗盘” | N |
| 07 | 维娜·维多利亚 (char_1019_siege2) | 6 | 近卫·术战者 | 近战 | 维多利亚、奇迹 | <休整期结束时>场上每有1名不同阶的【维多利亚】/【奇迹】干员使已激活的【维多利亚】层数+3/【奇迹】层数+2 [+1 impl. entries] **->** <休整期结束时>场上每有1名不同阶的【维多利亚】/【奇迹】干员使已激活的【维多利亚】层数+6/【奇迹】层数+4 | N |
| 08 | 焰影苇草 (char_1020_reed2) | 6 | 医疗·咒愈师 | 远程 | 维多利亚、精准 | 【维多利亚】每叠加3层，本干员攻击速度+1 **->** 【维多利亚】每叠加3层，本干员攻击速度+2 | N |
| 09 | 塑心 (char_245_cello) | 6 | 辅助·巫役 | 远程 | 拉特兰 | <战斗中>开启技能时，同一行每有1名干员，当前已激活且层数最多的盟约层数+1（每场作战至多10层） **->** <战斗中>开启技能时，同一行每有1名干员，当前已激活且层数最多的盟约层数+2（每场作战至多20层） | N |
| 10 | 妮芙 (char_4146_nymph) | 6 | 术师·本源术师 | 远程 | 迅捷 | <休整期结束时>整备区每有1个干员，使已激活的【迅捷】层数+2 **->** <休整期结束时>整备区每有1个干员，使已激活的【迅捷】层数+4 | N H |
| 11 | 缪尔赛思 (char_249_mlyss) | 6 | 先锋·战术家 | 远程 | 调和 | <获得时>获得1个“变形同构体” **->** <获得时>获得2个“变形同构体” | N |
| 12 | 迷迭香 (char_391_rosmon) | 6 | 狙击·投掷手 | 远程 | 精准、远见、协防干员 | 攻击力和生命值+20%；核心盟约每叠加3层，本干员攻击力和生命值+1% [+1 impl. entries] **->** 攻击力和生命值+40%；核心盟约每叠加3层，本干员攻击力和生命值+2% | N |
| 13 | 新约能天使 (char_1041_angel2) | 6 | 特种·怪杰 | 远程 | 拉特兰 | <获得时>使下个休整期额外获得2资金 **->** <获得时>使下个休整期额外获得4资金 | N |
| 14 | 流明 (char_4042_lumen) | 6 | 医疗·疗养师 | 远程 | 助力 | <休整期结束时>整备区中每名干员所在的已激活盟约分别层数+2 **->** <休整期结束时>整备区中每名干员所在的已激活盟约分别层数+4 | P |
| 15 | 仇白 (char_4082_qiubai) | 6 | 近卫·领主 | 近战 | 炎、突袭 | 【炎】【突袭】每叠加3层，本干员攻击束缚和停顿状态的敌人造成的伤害提升1% **->** 【炎】【突袭】每叠加3层，本干员攻击束缚和停顿状态的敌人造成的伤害提升2% | N |
| 16 | 溯光星源 (char_1047_halo2) | 6 | 辅助·凝滞师 | 远程 | 奥术、灵巧 | <休整期结束时>本回合每花费3资金，使已激活的【灵巧】【奥术】层数+2 **->** <休整期结束时>本回合每花费3资金，使已激活的【灵巧】【奥术】层数+4 | P |
| 17 | 耀骑士临光 (char_1014_nearl2) | 6 | 近卫·无畏者 | 近战 | 卡西米尔、突袭 | <战斗开始时>使自身和身前一格干员获得特质“【卡西米尔】每叠加3层，本干员再部署时间-1.5%，攻击速度+0.5” [+3 impl. entries] **->** <战斗开始时>使自身和身前一格干员获得特质“【卡西米尔】每叠加3层，本干员再部署时间-3%，攻击速度+1” | N |
| 18 | 荒芜拉普兰德 (char_1038_whitw2) | 6 | 术师·驭械术师 | 远程 | 叙拉古 | <战斗中>击倒敌人时，使已激活的【叙拉古】层数+2 / 将荒芜拉普兰德合成为精锐即可在战斗中使所有【叙拉古】干员获得该效果 **->** <战斗开始时>使所有【叙拉古】干员获得特质“击倒敌人时，使已激活的【叙拉古】层数+2” | N |
| 19 | 锏 (char_4116_blkkgt) | 6 | 近卫·剑豪 | 近战 | 谢拉格、卡西米尔、迅捷 | <获得时>自身所属的盟约层数+8 / <部署时>使自身已激活的盟约层数+8（至多24层） [+1 impl. entries] **->** <获得时>自身所属的盟约层数+16 / <部署时>使自身已激活的盟约层数+16（至多48层） | N |
| 20 | 纯烬艾雅法拉 (char_1016_agoat2) | 6 | 医疗·行医 | 远程 | 助力 | <战斗中>开启技能时，当前已激活且层数最多的盟约层数+3 **->** <战斗中>开启技能时，当前已激活且层数最多的盟约层数+6 | N |
| diy1 | *甄选 DIY slot* | 6 req | any | - | (fallback 协防干员) | none | D |
| diy2 | *甄选 DIY slot* | 6 req | any | - | (fallback 协防干员) | none | D |

| sid | 干员 | 技能 (idx) | 类型/SP | SP init/cost | 持续 | Trigger | Normal stats | Golden stats |
|---|---|---|---|---|---|---|---|---|
| 01 | 蕾缪安 | 礼炮·强制追思 (S3) | 手动/自然 | 26/45 -> 29/42 | ammo | DEFAULT | 1158/984/143/0/1/2.7s/3-9 | 1470/1248/164/0/1/2.7s/3-9 |
| 02 | 圣聆初雪 | 群山俯首 (S3) | 手动/自然 | 30/56 -> 35/53 | 35s | CUSTOM_RANGE_SEARCH_ENEMY (x-2) | 1687/718/233/15/1/2s/x-1 | 1933/871/292/15/1/2s/x-1 |
| 03 | 余 | 灶里乾坤 (S3) | 手动/自然 | 24/55 -> 33/55 | 41s -> 42s | CUSTOM_RANGE_SEARCH_ENEMY (3-15) | 2433/548/444/10/3/1.6s/0-1 | 3430/724/532/10/3/1.6s/0-1 |
| 04 | 浊心斯卡蒂 | "潮涌，潮枯" (S3) | 手动/自然 | 15/39 -> 15/38 | 20s | ALWAYS | 1202/305/186/0/1/1.3s/x-1 | 1598/382/234/0/1/1.3s/x-1 |
| 05 | 异客 | 辉煌裂片 (S3) | 手动/自然 | 0/35 -> 0/34 | inf | DEFAULT | 1215/571/116/20/1/2.3s/3-1 | 1442/739/125/20/1/2.3s/3-1 |
| 06 | 佩佩 | 时光震荡 (S3) | 手动/自然 | 30/57 -> 32/51 | 40s | DEFAULT | 2223/1083/328/0/2/1.8s/1-1 | 2939/1333/367/0/2/1.8s/1-1 |
| 07 | 维娜·维多利亚 | 俱以我之名 (S3) | 手动/自然 | 25/65 -> 30/60 | 25s | CUSTOM_RANGE_SEARCH_ENEMY (x-4) | 2200/546/348/15/1/1.25s/1-1 | 3101/688/396/15/1/1.25s/1-1 |
| 08 | 焰影苇草 | 生命火种 (S3) | 手动/自然 | 15/45 -> 20/40 | 30s | DEFAULT | 1361/440/67/20/1/1.6s/3-3 | 1668/563/78/20/1/1.6s/3-3 |
| 09 | 塑心 | “黄金的狂喜” (S1) | 自动/自然 | 6/7 -> 12/6 | inf | DEFAULT | 936/407/93/15/1/1.6s/y-2 | 1322/499/104/15/1/1.6s/y-2 |
| 10 | 妮芙 | 怵然震爆 (S2) | 手动/自然 | 3/17 -> 6/14 | inf | DEFAULT | 1237/550/107/15/1/1.6s/3-1 | 1661/700/122/15/1/1.6s/3-1 |
| 11 | 缪尔赛思 | 浅层非熵适应 (S3) | 手动/自然 | 10/42 -> 15/39 | 15s | ALWAYS | 1486/407/98/0/1/1s/3-3 | 1893/492/141/0/1/1s/3-3 |
| 12 | 迷迭香 | 末梢阻断 (S2) | 手动/自然 | 20/37 -> 20/34 | 33s -> 36s | DEFAULT | 1477/584/200/15/1/2.1s/3-9 | 2062/728/230/15/1/2.1s/3-9 |
| 13 | 新约能天使 | 开火成瘾症 (S2) | 手动/自然 | 22/30 -> 23/30 | ammo | DEFAULT | 1720/587/120/10/1/1.3s/3-3 | 2215/732/140/10/1/1.3s/3-3 |
| 14 | 流明 | 灯火不灭 (S3) | 手动/自然 | 0/61 -> 0/57 | ammo | DEFAULT | 1569/432/88/10/1/2.85s/3-4 | 1899/549/103/10/1/2.85s/3-4 |
| 15 | 仇白 | 问雪 (S3) | 手动/自然 | 34/61 -> 38/58 | 30s | DEFAULT | 1959/581/333/10/2/1.3s/3-12 | 2304/727/424/10/2/1.3s/3-12 |
| 16 | 溯光星源 | 并流连锁 (S3) | 手动/自然 | 18/45 -> 21/40 | 25s | DEFAULT | 1136/442/105/25/1/1.9s/y-2 | 1439/552/118/25/1/1.9s/y-2 |
| 17 | 耀骑士临光 | 耀阳颔首 (S3) | 手动/自然 | 15/55 -> 20/50 | 25s | DEFAULT | 2698/883/247/0/1/1.5s/1-1 | 3593/1108/279/0/1/1.5s/1-1 |
| 18 | 荒芜拉普兰德 | 终幕·浩劫 (S3) | 手动/自然 | 38/69 -> 38/63 | 40s | GDGLOW_SKILL_2 | 1142/287/98/20/1/1.3s/3-1 | 1541/356/111/20/1/1.3s/3-1 |
| 19 | 锏 | 归于宁静 (S3) | 手动/自然 | 10/35 -> 15/33 | - | DEFAULT | 2168/495/274/0/2/1.3s/1-1 | 2767/638/367/0/2/1.3s/1-1 |
| 20 | 纯烬艾雅法拉 | 火山回响 (S3) | 手动/自然 | 30/75 -> 40/70 | 50s | GDGLOW_SKILL_2 | 1237/339/87/10/1/2.85s/3-17 | 1511/439/102/10/1/2.85s/3-17 |


## 3. Per-operator details (skill text Lv4 / Lv7, talents, module on golden, tokens)

### Tier 1

**chess_char_1_01 隐现** (Insider, 5★ 狙击·速射手) — 盟约 拉特兰、迅捷
- 特性: 优先攻击空中单位
- 技能 S2 “解决麻烦” [skchr_inside_2, MANUAL, INCREASE_WITH_TIME, durationType AMMO]
  - Lv4: 攻击力+80%，攻击间隔略微缩短，优先攻击使用远程武器的敌人并且不容易成为敌人的攻击目标 / 攻击装有14发弹药，打完后结束（可随时停止技能）
  - Lv7: 攻击力+100%，攻击间隔略微缩短，优先攻击使用远程武器的敌人并且不容易成为敌人的攻击目标 / 攻击装有14发弹药，打完后结束（可随时停止技能）
- 天赋 (normal): 火力支援: 在场停留20秒后，自身弹药类技能弹药上限+2
- 天赋 (golden): 火力支援: 在场停留20秒后，自身弹药类技能弹药上限+3，其他随机一名【拉特兰】干员的弹药类技能弹药上限+1
- 模组 (golden, stage 1): “最初的惊喜” MAR-X — attr maxHp+80, atk+22; trait ADD: 攻击空中单位时攻击力提升至110%

**chess_char_1_02 角峰** (Matterhorn, 4★ 重装·铁卫) — 盟约 谢拉格、坚守
- 特性: 能够阻挡三个敌人
- 技能 S2 抗寒体质 [skchr_yak_2, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 生命上限+30%，防御力+10%，法术抗性+60%
  - Lv7: 生命上限+40%，防御力+15%，法术抗性+70%
- 天赋 (normal): 雪原卫士: 法术抗性+7
- 天赋 (golden): 雪原卫士: 法术抗性+15
- 模组 (golden, stage 1): 父亲的袍子 PRO-Y — attr maxHp+200, def+30, blockCnt+1; trait OVERRIDE: 能够阻挡四个敌人

**chess_char_1_03 惊蛰** (Leizi, 5★ 术师·链术师) — 盟约 炎
- 特性: 攻击造成法术伤害，且会在3个敌人间跳跃，每次跳跃伤害降低15%并造成短暂停顿（精英2后更新）
- 技能 S2 初雷 [skchr_leizi_2, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 攻击力+80%，攻击在跳跃时不再降低伤害
  - Lv7: 攻击力+100%，攻击在跳跃时不再降低伤害
- 天赋 (normal): 通流无阻: 攻击未被阻挡的敌人时攻击力提升至110%
- 天赋 (golden): 通流无阻: 攻击未被阻挡的敌人时攻击力提升至120%
- 模组 (golden, stage 1): “天地通明” CHA-X — attr maxHp+80, atk+55; trait OVERRIDE: 攻击造成法术伤害，且会在4个敌人间跳跃，每次跳跃伤害降低10%并造成一定时间停顿

**chess_char_1_04 深巡** (Underflow, 5★ 重装·哨戒铁卫) — 盟约 阿戈尔
- 特性: 能够阻挡三个敌人，可以进行远程攻击
- 技能 S2 行动能力剥夺 [skchr_udflow_2, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 攻击距离加长，攻击力+30%，攻击速度+25，攻击变为向正前方发射的毒性鳍刺，能穿过3个目标且造成1秒停顿。
  - Lv7: 攻击距离加长，攻击力+40%，攻击速度+30，攻击变为向正前方发射的毒性鳍刺，能穿过3个目标且造成1秒停顿。
- 天赋 (normal): 细胞活性抑制剂: 攻击使目标在3秒内每秒受到40点法术伤害（对【海怪】敌人伤害加倍）
- 天赋 (golden): 细胞活性抑制剂: 攻击使目标在3秒内每秒受到80点法术伤害（对【海怪】敌人伤害加倍）
- 模组 (golden, stage 1): 基于咖啡的神经活性剂 SPT-X — attr atk+38, def+30; trait ADD: 攻击范围内敌人的隐匿效果失效

**chess_char_1_05 红豆** (Vigna, 4★ 先锋·冲锋手) — 盟约 不屈
- 特性: 击杀敌人后获得1点部署费用，撤退时返还初始部署费用
- 技能 S2 槌音 [skchr_vigna_2, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 攻击间隔略微增大，攻击力+120%
  - Lv7: 攻击间隔略微增大，攻击力+150%
- 天赋 (normal): 蛮力穿刺: 攻击时，10%几率当次攻击的攻击力+50%。技能中这个几率提高到30%
- 天赋 (golden): 蛮力穿刺: 攻击时，10%几率当次攻击的攻击力+100%。技能中这个几率提高到30%
- 模组 (golden, stage 1): 伟大的摇滚 CHG-Y — attr maxHp+80, atk+40; trait ADD: 攻击生命值低于40%的敌人时攻击力提升至115%

**chess_char_1_06 刺玫** (Vendela, 5★ 医疗·咒愈师) — 盟约 维多利亚、助力
- 特性: 攻击造成法术伤害，攻击敌人时为攻击范围内一名友方干员治疗相当于50%伤害的生命值
- 技能 S2 荆藤庇荫 [skchr_vendla_2, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 攻击力+55%，使攻击范围内生命上限最高的友方角色更容易受到敌人攻击，且该角色受到攻击时刺玫对目标造成攻击力20%的法术伤害并仅对该角色触发刺玫特性
  - Lv7: 攻击力+75%，使攻击范围内生命上限最高的友方角色更容易受到敌人攻击，且该角色受到攻击时刺玫对目标造成攻击力30%的法术伤害并仅对该角色触发刺玫特性
- 天赋 (normal): 土壤基肥改良: 攻击范围内生命上限最高的友方角色受到的治疗效果提升8%
- 天赋 (golden): 土壤基肥改良: 攻击范围内生命上限最高的友方角色受到的治疗效果提升15%
- 模组 (golden, stage 1): 碎片 INC-X — attr maxHp+105, atk+23; trait OVERRIDE: 攻击造成法术伤害，攻击敌人时为攻击范围内一名友方干员治疗相当于60%伤害的生命值

**chess_char_1_07 普罗旺斯** (Provence, 5★ 狙击·重射手) — 盟约 叙拉古
- 特性: 高精度的近距离射击
- 技能 S1 狼眼 [skchr_prove_1, PASSIVE, 8, durationType NONE]
  - Lv4: 目标敌人的生命每降低20%，对其造成伤害时的攻击力+12%
  - Lv7: 目标敌人的生命每降低20%，对其造成伤害时的攻击力+16%
- 天赋 (normal): 狩猎箭头: 攻击时，20%几率当次攻击的攻击力提升至140%。当敌人在正前方一格时，该几率提升到50%
- 天赋 (golden): 狩猎箭头: 攻击时，20%几率当次攻击的攻击力提升至180%。当敌人在正前方一格时，该几率提升到50%
- 模组 (golden, stage 1): 尾巴养护套装 ARC-X — attr atk+40, def+30, respawnTime+-25; trait ADD: 再部署时间减少

**chess_char_1_08 德克萨斯** (Texas, 5★ 先锋·尖兵) — 盟约 独行、叙拉古
- 特性: 能够阻挡两个敌人
- 技能 S2 剑雨 [skchr_texas_2, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 立即获得10点费用；对周围所有敌人造成两次相当于攻击力120%的法术伤害，并令击中目标晕眩2秒
  - Lv7: 立即获得11点费用；对周围所有敌人造成两次相当于攻击力135%的法术伤害，并令击中目标晕眩2秒
- 天赋 (normal): 战术快递: 编入队伍后，额外获得1点初始部署费用
- 天赋 (golden): 战术快递: 编入队伍后，额外获得2点初始部署费用
- 模组 (golden, stage 1): 外勤私人补给包 SOL-Y — attr maxHp+100, atk+35, def+15; trait ADD: 首次部署时部署费用-4

**chess_char_1_09 跃跃** (Caper, 4★ 狙击·回环射手) — 盟约 精准
- 特性: 持有回旋投射物时才能够攻击（投射物需要时间回收）
- 技能 S2 乐趣加倍 [skchr_caper_2, MANUAL, INCREASE_WHEN_ATTACK, durationType NONE]
  - Lv4: 攻击力+25%，每次攻击额外发射1个回旋投射物
  - Lv7: 攻击力+40%，每次攻击额外发射1个回旋投射物
- 天赋 (normal): 戏耍随心: 攻击时，25%几率当次攻击的攻击力提升至130%
- 天赋 (golden): 戏耍随心: 攻击时，25%几率当次攻击的攻击力提升至150%
- 模组 (golden, stage 1): 暖意的归宿 LPS-X — attr maxHp+130, atk+15; trait ADD: 攻击周围8格的敌人时攻击力提升至110%

**chess_char_1_10 古米** (Гум, 4★ 重装·守护者) — 盟约 坚守
- 特性: 技能可以治疗友方单位
- 技能 S1 备用军粮 [skchr_sunbr_1, AUTO, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 下次攻击会恢复附近一名友方角色相当于古米攻击力115%的生命值 / 可充能1次
  - Lv7: 下次攻击会恢复附近一名友方角色相当于古米攻击力130%的生命值 / 可充能2次
- 天赋 (normal): 平底锅专精: 攻击时，10%几率当次攻击的攻击力提升至150%，并晕眩敌人0.5秒
- 天赋 (golden): 平底锅专精: 攻击时，15%几率当次攻击的攻击力提升至200%，并晕眩敌人1秒
- 模组 (golden, stage 1): 蜜糖馅饼礼包 GUA-X — attr maxHp+150, atk+40; trait ADD: 治疗生命值低于50%的友方单位时治疗量提升15%

**chess_char_1_11 地灵** (Earthspirit, 4★ 辅助·凝滞师) — 盟约 奇迹、远见
- 特性: 攻击造成法术伤害，并对敌人造成短暂的停顿
- 技能 S1 攻击力强化·β型 [skcom_atk_up[2], MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 攻击力+35%
  - Lv7: 攻击力+50%
- 天赋 (normal): none
- 天赋 (golden): 地质勘探: 略微延长特性停顿的持续时间
- 模组 (golden, stage 1): 待确认的申请表 DEC-Y — attr maxHp+90, def+20; trait OVERRIDE: 攻击造成法术伤害，并对敌人造成较长的停顿

**chess_char_1_12 艾丝黛尔** (Estelle, 4★ 近卫·强攻手) — 盟约 萨尔贡
- 特性: 同时攻击阻挡的所有敌人
- 技能 S2 舍身突击 [skchr_estell_2, MANUAL, INCREASE_WHEN_TAKEN_DAMAGE, durationType NONE]
  - Lv4: 攻击力+100%，不再成为其他角色的治疗目标
  - Lv7: 攻击力+115%，不再成为其他角色的治疗目标
- 天赋 (normal): 自愈能力: 周围8格内有敌人倒下时，恢复自身最大生命值7%的生命
- 天赋 (golden): 自愈能力: 周围8格内有敌人倒下时，恢复自身最大生命值12%的生命
- 模组 (golden, stage 1): 荒野地的饯别礼 CEN-Y — attr maxHp+70, atk+32; trait ADD: 生命值高于50%时受到的物理伤害降低20%

**chess_char_1_13 波登可** (Podenco, 4★ 辅助·凝滞师) — 盟约 助力
- 特性: 攻击造成法术伤害，并对敌人造成短暂的停顿
- 技能 S2 孢子扩散 [skchr_podego_2, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 立即投掷一个小瓶，碎裂后在周围产生一个持续5秒的孢子群 / 孢子群范围内所有敌人被停顿且失去特殊能力，每秒受到相当于攻击力50%的法术伤害
  - Lv7: 立即投掷一个小瓶，碎裂后在周围产生一个持续5秒的孢子群 / 孢子群范围内所有敌人被停顿且失去特殊能力，每秒受到相当于攻击力60%的法术伤害
- 天赋 (normal): 园丁: 在场时，所有【辅助】干员攻击力+5%
- 天赋 (golden): 园丁: 在场时，所有【辅助】干员攻击力+9%
- 模组 (golden, stage 1): “不谢的苗圃” DEC-X — attr maxHp+70, atk+25; trait ADD: 攻击范围内存在敌人时技力自然恢复速度+0.2/秒

**chess_char_1_14 格雷伊** (Greyy, 4★ 术师·扩散术师) — 盟约 灵巧
- 特性: 攻击造成群体法术伤害
- 技能 S2 静电释放 [skchr_greyy_2, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 攻击速度+50，天赋停顿的持续时间提升至1.6倍
  - Lv7: 攻击速度+65，天赋停顿的持续时间提升至1.7倍
- 天赋 (normal): 静电场: 攻击时对攻击目标造成0.4秒的停顿
- 天赋 (golden): 静电场: 攻击时对攻击目标造成0.6秒的停顿
- 模组 (golden, stage 1): 新的开始 SPC-Y — attr cost+-8, maxHp+75, attackSpeed+3; trait ADD: 部署费用减少

**chess_char_1_15 盟约·辅助干员** (Alliance/Supportive Opertator, 4★ 辅助·巫役) — 盟约 调和、协防干员
- 特性: 攻击造成法术伤害，可以造成元素损伤
- 技能 S1 战术咏唱·双型 [skchr_pithst_1, MANUAL, INCREASE_WHEN_ATTACK, durationType NONE]
  - Lv4: 攻击速度+70，同时攻击2个目标
  - Lv7: 攻击速度+80，同时攻击2个目标
- 天赋 (normal): 迭代元素: 攻击同时附带18%攻击力的神经损伤（优先）、灼燃损伤、凋亡损伤；优先攻击未处于损伤爆发的目标; 灵便条约: 在【卫戍协议】中，隶属于盟约【调和】
- 天赋 (golden): 迭代元素 [mod]: 攻击同时附带18%攻击力的神经损伤（优先）、灼燃损伤、凋亡损伤；优先攻击未处于损伤爆发的目标; 灵便条约: 在【卫戍协议】中，隶属于盟约【调和】
- 模组 (golden, stage 1): 盟约·辅助干员证章 RIT-X — attr maxHp+90, atk+23; trait ADD: 对精英和领袖敌人造成的元素损伤提升18%

**chess_char_1_16 锡人** (Tin Man, 5★ 特种·炼金师) — 盟约 投资人、迅捷
- 特性: 可以投掷炼金单元协助作战
- 技能 S2 “大拉里” [skchr_tinman_2, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 投掷一个炼金单元，在11秒内使落点周围的地面敌人每秒受到相当于攻击力65%的法术伤害、友方单位每秒恢复相当于攻击力15%的生命 / 可充能1次
  - Lv7: 投掷一个炼金单元，在12秒内使落点周围的地面敌人每秒受到相当于攻击力80%的法术伤害、友方单位每秒恢复相当于攻击力20%的生命 / 可充能2次
- 天赋 (normal): “在路上”: 在【萨卡兹的无终奇语】中，被招募时希望消耗-2，且作为负荷干员时使负荷临界点额外+3
- 天赋 (golden): “在路上”: 在【萨卡兹的无终奇语】中，被招募时希望消耗-2，且作为负荷干员时使负荷临界点额外+9; 凋敝魂灵: 使自身炼金单元影响范围内地面敌人受到的持续伤害提高20%
- 模组 (golden, stage 1): “颅相学” ALC-X — attr maxHp+80, atk+20; trait ADD: 场上存在炼金单元时，技力自然恢复速度+0.1/秒

**chess_char_1_17 深靛** (Indigo, 4★ 术师·秘术师) — 盟约 奥术、精准
- 特性: 攻击造成法术伤害，在找不到攻击目标时可以将攻击能量储存起来之后一齐发射（最多3个）
- 技能 S2 光影迷宫 [skchr_indigo_2, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 攻击间隔略微缩短，天赋的触发几率提升至2.0倍，攻击范围内处于束缚状态的敌人每0.5秒受到相当于深靛攻击力12%的法术伤害
  - Lv7: 攻击间隔一定程度缩短，天赋的触发几率提升至2.5倍，攻击范围内处于束缚状态的敌人每0.5秒受到相当于深靛攻击力15%的法术伤害
- 天赋 (normal): 柔光缚目: 攻击时有12%的几率使目标束缚4秒，不以束缚状态的敌人为攻击目标
- 天赋 (golden): 柔光缚目: 攻击时有18%的几率使目标束缚4秒，不以束缚状态的敌人为攻击目标
- 模组 (golden, stage 1): 法杖保养套装 MSC-X — attr atk+45, attackSpeed+3; trait OVERRIDE: 攻击造成法术伤害，在找不到攻击目标时可以将攻击能量储存起来之后一齐发射（最多4个）

**chess_char_1_18 宴** (Utage, 4★ 近卫·武者) — 盟约 突袭
- 特性: 不成为其他角色的治疗目标，每次攻击到敌人后回复自身50生命（精英2后更新）
- 技能 S2 落地斩·破门 [skchr_utage_2, PASSIVE, 8, durationType NONE]
  - Lv4: 部署后立即流失50%当前生命，并在14秒内攻击力+65%，伤害类型变为法术
  - Lv7: 部署后立即流失50%当前生命，并在15秒内攻击力+80%，伤害类型变为法术
- 天赋 (normal): 认真模式: 在场时，自身获得最高+75攻击速度的坚忍（损失60%生命值时达到最大加成）
- 天赋 (golden): 认真模式 [mod]: 
- 模组 (golden, stage 1): 翻盖手机 SBL-X — attr maxHp+160, atk+45; trait ADD: 生命值低于50%时，获得25%的庇护

**chess_char_1_19 野鬃** (Wild Mane, 5★ 先锋·冲锋手) — 盟约 卡西米尔、迅捷
- 特性: 击杀敌人后获得1点部署费用，撤退时返还初始部署费用
- 技能 S2 夹枪冲锋 [skchr_wildmn_2, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 攻击范围扩大，攻击力+45%，攻击会把目标往攻击方向中等力度地推开
  - Lv7: 攻击范围扩大，攻击力+60%，攻击会把目标往攻击方向中等力度地推开
- 天赋 (normal): 一致向前: 首次部署后，所有未部署的【近卫】干员的部署费用-1
- 天赋 (golden): 一致向前: 部署后，所有未部署的【近卫】干员的部署费用-1（每个干员每次被部署前，最多可被减少5费）
- 模组 (golden, stage 1): 长枪替补套装 CHG-X — attr atk+40, attackSpeed+3; trait OVERRIDE: 击杀敌人后获得2点部署费用，撤退时返还该次部署费用

**chess_char_1_20 雷蛇** (Liskarm, 5★ 重装·哨戒铁卫) — 盟约 不屈
- 特性: 能够阻挡三个敌人，可以进行远程攻击
- 技能 S2 反击电弧 [skchr_liskam_2, MANUAL, INCREASE_WHEN_TAKEN_DAMAGE, durationType NONE]
  - Lv4: 攻击间隔增大，攻击力+105%，每次攻击对最多3个敌人造成法术伤害，并有15%概率使命中目标晕眩1秒 / 持续时间结束后雷蛇晕眩5秒
  - Lv7: 攻击间隔增大，攻击力+125%，每次攻击对最多3个敌人造成法术伤害，并有20%概率使命中目标晕眩1秒 / 持续时间结束后雷蛇晕眩5秒
- 天赋 (normal): 战术防御: 受到攻击时，回复自己和周围一格内随机一名友方角色1点技力
- 天赋 (golden): 战术防御: 受到攻击时，回复自己和周围一格内随机一名友方角色1点技力; 雷抗: 法术抗性+10
- 模组 (golden, stage 1): 震撼存储 SPT-X — attr atk+38, def+30; trait ADD: 攻击范围内敌人的隐匿效果失效

### Tier 2

**chess_char_2_01 送葬人** (Executor, 5★ 狙击·散射手) — 盟约 拉特兰、精准
- 特性: 攻击范围内的所有敌人，对自己前方一横排的敌人攻击力提升至150%
- 技能 S2 最终旅程 [skchr_excu_2, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 普通攻击变为二连击，且攻击间隔少量缩短
  - Lv7: 普通攻击变为二连击，且攻击间隔一定程度缩短
- 天赋 (normal): 终结改装: 攻击时无视目标80的防御力
- 天赋 (golden): 终结改装: 攻击时无视目标160的防御力
- 模组 (golden, stage 1): 执行者随身包 RPR-X — attr atk+38, attackSpeed+3; trait OVERRIDE: 攻击范围内的所有敌人，对自己前方一横排的敌人攻击力提升至160%

**chess_char_2_02 赫默** (Silence, 5★ 医疗·医师) — 盟约 远见
- 特性: 恢复友方单位生命
- 技能 S2 医疗无人机 [skchr_silent_2, AUTO, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 获得一个医疗无人机 / 最多可库存1个无人机；无人机投入战场后治疗周围友军，10秒后自动销毁
- 天赋 (normal): 强化注射: 在场时，所有友方【医疗】职业干员攻速+6
- 天赋 (golden): 强化注射: 在场时，所有友方【医疗】职业干员攻速+12
- 模组 (golden, stage 1): 紧急防卫程序 PHY-Y — attr maxHp+70, attackSpeed+4; trait ADD: 治疗地面单位时治疗量提升15%
- 召唤物: token_10000_silent_healrb 医疗探机 (DEFAULT) HP/ATK/DEF 1000/85/0

**chess_char_2_03 崖心** (Cliffheart, 5★ 特种·钩索师) — 盟约 谢拉格、不屈
- 特性: 技能可以使敌人产生位移 / 可以放置于远程位
- 技能 S2 束缚链 [skchr_slchan_2, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 立即将前方大范围内至多2个目标中等力度地拖拽至面前，对其造成相当于自己攻击力150%的真实的伤害，并使其晕眩1.5秒
  - Lv7: 立即将前方大范围内至多2个目标中等力度地拖拽至面前，对其造成相当于自己攻击力170%的真实的伤害，并使其晕眩1.5秒
- 天赋 (normal): 雪境猎手: 未阻挡敌人时，攻击力和防御力各+6%
- 天赋 (golden): 雪境猎手: 未阻挡敌人时，攻击力和防御力各+12%
- 模组 (golden, stage 1): “凌绝顶” HOK-X — attr atk+25, def+22; trait ADD: 拖拽期间敌人受到正比于距离的法术伤害

**chess_char_2_04 小满** (Grain Buds, 5★ 辅助·凝滞师) — 盟约 炎、灵巧
- 特性: 攻击造成法术伤害，并对敌人造成短暂的停顿
- 技能 S2 乡音沉沉 [skchr_grabds_2, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 停止攻击敌人并使攻击范围内3个敌方单位沉睡4秒，之后攻击速度+45，且攻击3个敌人
  - Lv7: 停止攻击敌人并使攻击范围内3个敌方单位沉睡4秒，之后攻击速度+90，且攻击3个敌人
- 天赋 (normal): 好好听话: 攻击速度+6，若目标为【野生动物】则特性的停顿时间略微延长
- 天赋 (golden): 好好听话: 攻击速度+10，若目标为【野生动物】则特性的停顿时间延长
- 模组 (golden, stage 1): 在田野上 DEC-X — attr maxHp+90, atk+33; trait ADD: 攻击范围内存在敌人时技力自然恢复速度+0.2/秒

**chess_char_2_05 哈洛德** (Harold, 5★ 医疗·行医) — 盟约 谢拉格、维多利亚
- 特性: 恢复友方单位生命，并回复相当于攻击力50%的元素损伤（可以回复未受伤友方单位的元素损伤）
- 特质 implementation entries (normal): garrison_09_a [IN_BATTLE/GAIN_BUFF] 攻击力和生命值+20%；核心盟约每叠加3层，本干员攻击力和生命值+1%; garrison_03_a [IN_BATTLE/GAIN_BUFF] 攻击力和生命值+20%
- 技能 S2 重症优先 [skchr_harold_2, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 攻击速度+55，优先治疗元素损伤最严重的目标。治疗元素损伤累计超过一半的目标时，元素损伤回复量提升至160%
  - Lv7: 攻击速度+80，优先治疗元素损伤最严重的目标。治疗元素损伤累计超过一半的目标时，元素损伤回复量提升至200%
- 天赋 (normal): 我即军营: 攻击范围内元素损伤累计超过一半的目标受到的元素损伤降低12%
- 天赋 (golden): 我即军营: 攻击范围内元素损伤累计超过一半的目标受到的元素损伤降低15%
- 模组 (golden, stage 1): 腿部护理套装 WDM-X — attr maxHp+70, atk+20; trait OVERRIDE: 恢复友方单位生命，并回复相当于攻击力60%的元素损伤（可以回复未受伤友方单位的元素损伤）

**chess_char_2_06 莎草** (Papyrus, 5★ 医疗·链愈师) — 盟约 萨尔贡
- 特性: 恢复友方单位生命，且会在3个友方单位间跳跃，每次跳跃治疗量降低25%
- 技能 S1 巧思乍现 [skchr_papyrs_1, AUTO, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 下次治疗时的治疗量提升至攻击力的160%，天赋附加屏障效果提升至150% / 可充能2次
  - Lv7: 下次治疗时的治疗量提升至攻击力的175%，天赋附加屏障效果提升至200% / 可充能2次
- 天赋 (normal): 博览古卷: 治疗会为目标干员附加相当于自身10%攻击力的屏障，持续8秒
- 天赋 (golden): 博览古卷: 治疗会为目标干员附加相当于自身20%攻击力的屏障，持续8秒
- 模组 (golden, stage 1): 小小的种子 XAH-X — attr atk+38, def+23; trait OVERRIDE: 恢复友方单位生命，且会在3个友方单位间跳跃，每次跳跃治疗量降低15%

**chess_char_2_07 幽灵鲨** (Specter, 5★ 近卫·强攻手) — 盟约 阿戈尔
- 特性: 同时攻击阻挡的所有敌人
- 技能 S2 肉斩骨断 [skchr_ghost_2, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 技能持续期间内干员的生命值始终不会低于1，攻击力+70% / 技能结束后干员晕眩10秒
  - Lv7: 技能持续期间内干员的生命值始终不会低于1，攻击力+100% / 技能结束后干员晕眩10秒
- 天赋 (normal): 体力上限提升: 生命上限+10%
- 天赋 (golden): 深海再生力: 生命上限+10%，每秒回复最大生命2%的生命
- 模组 (golden, stage 1): 幽明烛光 CEN-X — attr atk+34, def+30; trait OVERRIDE: 同时攻击阻挡的所有敌人，攻击被阻挡的敌人攻击力提升至110%

**chess_char_2_08 泡泡** (Bubble, 4★ 重装·铁卫) — 盟约 萨尔贡、坚守
- 特性: 能够阻挡三个敌人
- 技能 S2 “挨打” [skchr_bubble_2, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 停止攻击敌人；防御力+65%，自身更易受敌人攻击，每次受到攻击时对目标造成相当于泡泡防御力40%的物理伤害
  - Lv7: 停止攻击敌人；防御力+85%，自身更易受敌人攻击，每次受到攻击时对目标造成相当于泡泡防御力40%的物理伤害
- 天赋 (normal): 尖刺盾: 敌人攻击泡泡后，攻击力下降5%，持续5秒
- 天赋 (golden): 尖刺盾: 敌人攻击泡泡后，攻击力下降8%，持续5秒
- 模组 (golden, stage 1): 泡泡闪光必杀剑 PRO-X — attr maxHp+180, def+50; trait ADD: 阻挡敌人时防御力+20%

**chess_char_2_09 休谟斯** (Humus, 4★ 近卫·收割者) — 盟约 突袭
- 特性: 无法被友方角色治疗，攻击造成群体伤害，每攻击到一个敌人回复自身50生命，最大生效数等于阻挡数
- 技能 S2 高效处理 [skchr_humus_2, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 技能持续时间内阻挡数+1，生命值高于50%时，获得+25%攻击力的精力充沛；高于80%时效果翻倍
  - Lv7: 技能持续时间内阻挡数+1，生命值高于50%时，获得+36%攻击力的精力充沛；高于80%时效果翻倍
- 天赋 (normal): 再回收: 超出自身生命上限的生命值可转化为屏障；最多不超过自身最大生命值的60%
- 天赋 (golden): 再回收: 超出自身生命上限的生命值可转化为屏障；最多不超过自身最大生命值的100%
- 模组 (golden, stage 1): 恶地奇异工具套组 REA-X — attr maxHp+100, atk+10, def+14; trait OVERRIDE: 无法被友方角色治疗，攻击造成群体伤害，每攻击到一个敌人回复自身60生命，最大生效数等于阻挡数

**chess_char_2_10 洛洛** (Rockrock, 5★ 术师·驭械术师) — 盟约 维多利亚、奥术
- 特性: 操作浮游单元造成法术伤害 / 单元攻击同一敌人伤害提升（最高造成干员110%攻击力的伤害）
- 技能 S2 自负此轭 [skchr_rockr_2, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 攻击速度+45，释放浮游单元锁定敌人攻击 / 过载：特性浮游单元伤害上限提升至1.6倍，攻击力+40%，技能结束后晕眩过载持续时间的等长时间 / 浮游单元锁敌后直至敌人被击杀或技能结束后返回干员身边，可随时主动关闭技能
  - Lv7: 攻击速度+60，释放浮游单元锁定敌人攻击 / 过载：特性浮游单元伤害上限提升至1.7倍，攻击力+50%，技能结束后晕眩过载持续时间的等长时间 / 浮游单元锁敌后直至敌人被击杀或技能结束后返回干员身边，可随时主动关闭技能
- 天赋 (normal): 立于磐石: 每在场上停留15秒，攻击力+2%，最多可以叠加3次
- 天赋 (golden): 立于磐石: 每在场上停留15秒，攻击力+4%，最多可以叠加4次
- 模组 (golden, stage 1): 未命名的无人机 FUN-X — attr maxHp+50, atk+13, def+11; trait OVERRIDE: 操作浮游单元造成法术伤害 / 单元攻击同一敌人伤害提升（单元初始伤害提高，最高造成干员110%攻击力的伤害）

**chess_char_2_11 风丸** (Kazemaru, 5★ 特种·傀儡师) — 盟约 奇迹
- 特性: 受到致命伤时不撤退，切换成<替身>作战（替身阻挡数为0），持续20秒后自身再次替换<替身>
- 技能 S2 纸艺·双影 [skchr_kazema_2, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 立即流失50%当前生命，攻击力+70%，并在周围的近战部署位召唤<替身>协助作战
  - Lv7: 立即流失50%当前生命，攻击力+90%，并在周围的近战部署位召唤<替身>协助作战
- 天赋 (normal): 折纸生花: <替身>出现时对其周围8格内所有敌方单位造成相当于其攻击力225%的法术伤害
- 天赋 (golden): 折纸生花: <替身>出现时对其周围8格内所有敌方单位造成相当于其攻击力270%的法术伤害
- 模组 (golden, stage 1): 旧物 PUM-X — attr atk+45, def+25; trait OVERRIDE: 受到致命伤时不撤退，切换成<替身>作战（替身阻挡数为0但攻击力提升），持续20秒后自身再次替换<替身>
- 召唤物: token_10022_kazema_shadow 纸偶 (HIDDEN) HP/ATK/DEF 1816/611/254

**chess_char_2_12 砾** (Gravel, 4★ 特种·处决者) — 盟约 卡西米尔、不屈
- 特性: 再部署时间大幅度减少
- 特质 implementation entries (normal): garrison_75_a [IN_BATTLE/ADD_BOND] <部署时>使已激活的【卡西米尔】层数+1 / <被击倒时>使已激活的【不屈】层数+2; garrison_143_a [IN_BATTLE/ADD_BOND] <部署时>使已激活的【卡西米尔】层数+1
- 技能 S2 鼠群 [skchr_gravel_2, PASSIVE, 8, durationType NONE]
  - Lv4: 部署后获得可吸收相当于自己最大生命140%的屏障，该屏障会在10秒内持续衰减
  - Lv7: 部署后获得可吸收相当于自己最大生命180%的屏障，该屏障会在10秒内持续衰减
- 天赋 (normal): 快速部署: 自身部署费用-1
- 天赋 (golden): 小个子支援: 自身部署费用-1，所有初始部署费用不超过10的单位防御力提升6%
- 模组 (golden, stage 1): 隐秘行动工具包 EXE-X — attr maxHp+100, def+40; trait ADD: 撤退时返还大量该次部署费用

**chess_char_2_13 蒂比** (Tippi, 5★ 特种·巡空者) — 盟约 迅捷、灵巧
- 特性: 起飞后能够阻挡2个飞行敌人
- 技能 S2 紧急赶场通知 [skchr_tippi_2, AUTO, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 立刻起飞，攻击范围扩大，攻击力+20%，攻击变为3连射 / 受到攻击后触发，并闪避本次物理或法术伤害
  - Lv7: 立刻起飞，攻击范围扩大，攻击力+30%，攻击变为3连射 / 受到攻击后触发，并闪避本次物理或法术伤害
- 天赋 (normal): 片场工作指南: 若最近13秒内未受攻击，闪避下一次物理或法术攻击
- 天赋 (golden): 片场工作指南: 若最近9秒内未受攻击，闪避下一次物理或法术攻击

**chess_char_2_14 调香师** (Perfumer, 4★ 医疗·群愈师) — 盟约 助力、协防干员
- 特性: 同时恢复三个友方单位的生命
- 技能 S2 精调 [skchr_flower_2, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 攻击速度-50，攻击力+180%
  - Lv7: 攻击速度-50，攻击力+210%
- 天赋 (normal): 熏衣草: 在战场时全体友方单位每秒恢复相当于调香师攻击力3%的生命
- 天赋 (golden): 熏衣香: 在战场时全体友方单位每秒恢复相当于调香师攻击力5%的生命
- 模组 (golden, stage 1): “爱琴之吻” RIN-Y — attr maxHp+55, atk+25; trait OVERRIDE: 同时恢复四个友方单位的生命

**chess_char_2_15 协律** (Akkord, 4★ 术师·轰击术师) — 盟约 奥术、助力
- 特性: 攻击造成超远距离的群体法术伤害
- 技能 S2 震爆调谐 [skchr_akkord_2, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 攻击力+35%，每次攻击在攻击范围内的其他干员处施加一次音爆，造成相当于15%攻击力的群体法术伤害
  - Lv7: 攻击力+45%，每次攻击在攻击范围内的其他干员处施加一次音爆，造成相当于20%攻击力的群体法术伤害
- 天赋 (normal): 律脉同构: 攻击范围内至少有1名其他友方干员时，攻击力+8%
- 天赋 (golden): 律脉同构: 攻击范围内至少有1名其他友方干员时，攻击力+15%
- 模组 (golden, stage 1): 移动八音盒 BLA-X — attr maxHp+145, atk+40; trait OVERRIDE: 攻击造成超远距离的群体法术伤害，距离越远伤害越高，最高达到110%

**chess_char_2_16 拉普兰德** (Lappland, 5★ 近卫·领主) — 盟约 叙拉古
- 特性: 可以进行远程攻击，但此时攻击力降低至80%
- 技能 S2 狼魂 [skchr_whitew_2, AUTO, INCREASE_WHEN_ATTACK, durationType NONE]
  - Lv4: 攻击力+75%，伤害类型变为法术，额外攻击一个目标，远程攻击不再降低攻击力 / 技能自动开启
  - Lv7: 攻击力+90%，伤害类型变为法术，额外攻击一个目标，远程攻击不再降低攻击力 / 技能自动开启
- 天赋 (normal): 精神摧毁: 攻击使目标的特殊能力失效，持续1秒
- 天赋 (golden): 精神摧毁: 攻击使目标的特殊能力失效，持续5秒
- 模组 (golden, stage 1): “幼狼的牙齿” LOR-X — attr maxHp+110, atk+20, attackSpeed+4; trait ADD: 攻击附带10%攻击力的法术伤害

**chess_char_2_17 折桠** (Веточки, 5★ 重装·不屈者) — 盟约 坚守、独行
- 特性: 无法被友方角色治疗
- 技能 S2 生存决心 [skchr_branch_2, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 技能开启时使自身周围的地面敌人战栗5秒；攻击力+100%，防御力+30%，同时攻击阻挡的所有敌人
  - Lv7: 技能开启时使自身周围的地面敌人战栗5秒；攻击力+120%，防御力+40%，同时攻击阻挡的所有敌人
- 天赋 (normal): 简易包扎: 技能结束时恢复自身40%最大生命值
- 天赋 (golden): 简易包扎: 技能结束时恢复自身50%最大生命值
- 模组 (golden, stage 1): “时间的痕迹” UNY-X — attr maxHp+210, def+35; trait ADD: 受到来自自身阻挡单位的伤害降低15%

**chess_char_2_18 灰毫** (Ashlock, 5★ 重装·要塞) — 盟约 卡西米尔、坚守
- 特性: 不阻挡敌人时优先远程群体物理攻击
- 技能 S1 攻击力强化·γ型 [skcom_atk_up[3], MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 攻击力+45%
  - Lv7: 攻击力+60%
- 天赋 (normal): 炮术研习: 攻击力+4%，周身四格为地面时改为攻击力+8%
- 天赋 (golden): 炮术研习: 攻击力+8%，周身四格为地面时改为攻击力+16%
- 模组 (golden, stage 1): 出门必备套装 FOR-X — attr maxHp+235, atk+45; trait ADD: 攻击被阻挡的敌人时攻击力提升至110%

**chess_char_2_19 锡人** (Tin Man, 5★ 特种·炼金师) — 盟约 投资人、迅捷
- 特性: 可以投掷炼金单元协助作战
- 特质 implementation entries (normal): garrison_151_a [IN_BATTLE/GAIN_BUFF] 攻击力和生命值+20%；【投资人】【迅捷】每叠加3层，本干员攻击力和生命值+1%; garrison_03_a [IN_BATTLE/GAIN_BUFF] 攻击力和生命值+20%
- 技能 S2 “大拉里” [skchr_tinman_2, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 投掷一个炼金单元，在11秒内使落点周围的地面敌人每秒受到相当于攻击力65%的法术伤害、友方单位每秒恢复相当于攻击力15%的生命 / 可充能1次
  - Lv7: 投掷一个炼金单元，在12秒内使落点周围的地面敌人每秒受到相当于攻击力80%的法术伤害、友方单位每秒恢复相当于攻击力20%的生命 / 可充能2次
- 天赋 (normal): “在路上”: 在【萨卡兹的无终奇语】中，被招募时希望消耗-2，且作为负荷干员时使负荷临界点额外+3
- 天赋 (golden): “在路上”: 在【萨卡兹的无终奇语】中，被招募时希望消耗-2，且作为负荷干员时使负荷临界点额外+9; 凋敝魂灵: 使自身炼金单元影响范围内地面敌人受到的持续伤害提高20%
- 模组 (golden, stage 1): “颅相学” ALC-X — attr maxHp+80, atk+20; trait ADD: 场上存在炼金单元时，技力自然恢复速度+0.1/秒

### Tier 3

**chess_char_3_01 能天使** (Exusiai, 6★ 狙击·速射手) — 盟约 拉特兰、奇迹
- 特性: 优先攻击空中单位
- 技能 S3 过载模式 [skchr_angel_3, AUTO, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 攻击变为5连射，攻击间隔略微缩短 / 技能会自动开启
  - Lv7: 攻击变为5连射，攻击间隔少量缩短 / 技能会自动开启
- 天赋 (normal): 快速弹匣: 攻击速度+12; 天使的祝福: 攻击力+6%，生命上限+10%。置入战场后这个效果会同样赋予给一名随机友方单位
- 模组 (golden, stage 1): 能天使的杰作 MAR-X — attr maxHp+110, atk+27; trait ADD: 攻击空中单位时攻击力提升至110%
- backup (unowned): 预备干员-狙击 (char_603_csnipe) S3

**chess_char_3_02 断崖** (Ayerscarpe, 5★ 近卫·领主) — 盟约 灵巧
- 特性: 可以进行远程攻击，但此时攻击力降低至80%
- 技能 S2 浮游刃启动 [skchr_ayer_2, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 攻击范围扩大，伤害类型变为法术；每次攻击时，额外对周围8格友方单位阻挡的所有敌人造成相当于攻击力100%的法术伤害(均视为近战攻击）
  - Lv7: 攻击范围扩大，伤害类型变为法术；每次攻击时，额外对周围8格友方单位阻挡的所有敌人造成相当于攻击力130%的法术伤害(均视为近战攻击）
- 天赋 (normal): 索敌援助: 自身与周围8格友方干员攻速+8
- 模组 (golden, stage 1): 荒野便携提神剂 LOR-X — attr maxHp+120, atk+37; trait ADD: 攻击附带10%攻击力的法术伤害

**chess_char_3_03 诗怀雅** (Swire, 5★ 近卫·教官) — 盟约 炎、远见
- 特性: 可以攻击到较远敌人，攻击自身未阻挡的敌人时攻击力提升至120%
- 技能 S2 协同作战 [skchr_swire_2, MANUAL, INCREASE_WHEN_ATTACK, durationType NONE]
  - Lv4: 攻击力+40%，第一天赋效果提升至2.4倍
  - Lv7: 攻击力+50%，第一天赋效果提升至2.7倍
- 天赋 (normal): 近距离作战指导: 在场时周围8格内的近战友方单位攻击力+10%
- 模组 (golden, stage 1): 防身口红 INS-X — attr maxHp+120, atk+50; trait OVERRIDE: 可以攻击到较远敌人，攻击自身未阻挡的敌人时攻击力提升至130%

**chess_char_3_04 琳琅诗怀雅** (Swire the Elegant Wit, 6★ 特种·行商) — 盟约 炎、投资人
- 特性: 再部署时间减少，撤退时不返还部署费用，在场时每3秒消耗3点部署费用（不足时自动撤退）
- 技能 S2 “见面礼” [skchr_swire2_2, PASSIVE, 8, durationType NONE]
  - Lv4: 消耗一枚金币在范围内一个可放置且可通行的地面放置香槟炸弹，香槟炸弹会对触碰到的首个敌人造成相当于攻击力155%的物理伤害，并使目标停顿2秒 / 香槟炸弹在场3秒后可额外造成一次伤害；携带此技能时金币上限为3
  - Lv7: 消耗一枚金币在范围内一个可放置且可通行的地面放置香槟炸弹，香槟炸弹会对触碰到的首个敌人造成相当于攻击力170%的物理伤害，并使目标停顿2秒 / 香槟炸弹在场3秒后可额外造成一次伤害；携带此技能时金币上限为4
- 天赋 (normal): 大买家: 开启技能时获得1枚金币（可用于技能消耗），技能期间每次特性消耗费用时获得1枚金币，并提升自身4%的攻击力（最多叠加8次）; 破财消灾: 受到致命伤害时，若费用足够则消耗5点部署费用使生命恢复到70%，每次触发该天赋时消耗的费用翻倍
- 模组 (golden, stage 1): “金币辉煌” MER-X — attr maxHp+130, atk+25, def+35; trait OVERRIDE: 再部署时间减少，撤退时不返还部署费用，在场时每3秒消耗2点部署费用（不足时自动撤退）
- 召唤物: token_10031_swire2_gdtrap 香槟炸弹 (HIDDEN) HP/ATK/DEF 1000/100/0
- backup (unowned): 预备干员-医疗 (char_605_cmedic) S3

**chess_char_3_05 斯卡蒂** (Skadi, 6★ 近卫·无畏者) — 盟约 阿戈尔、坚守、突袭
- 特性: 能够阻挡一个敌人
- 技能 S3 涌潮悲歌 [skchr_skadi_3, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 攻击力、防御力和生命上限各+85%
  - Lv7: 攻击力、防御力和生命上限各+100%
- 天赋 (normal): 深海掠食者: 编入队伍时，所有【深海猎人】干员的攻击力+14%; 迅捷出击: 自身再部署时间-10秒
- 模组 (golden, stage 1): 潮湿的剑袋 DRE-Y — attr maxHp+300, atk+55; trait ADD: 被击倒时不撤退且回复所有生命但生命上限-60%，攻击速度+30（单次部署只触发1次）
- backup (unowned): 预备干员-近卫 (char_601_cguard) S3

**chess_char_3_06 菲莱** (Philae, 5★ 重装·本源铁卫) — 盟约 萨尔贡
- 特性: 能够阻挡三个敌人，可以造成元素损伤
- 技能 S2 冥河诅咒 [skchr_philae_2, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 停止攻击，生命上限+40%，受到攻击时对周围的地面敌人造成攻击力110%的法术伤害并附带25%攻击力的凋亡损伤（每2秒最多触发一次）；若技能期间受到元素损伤则攻击力+70%至技能结束
  - Lv7: 停止攻击，生命上限+50%，受到攻击时对周围的地面敌人造成攻击力140%的法术伤害并附带25%攻击力的凋亡损伤（每2秒最多触发一次）；若技能期间受到元素损伤则攻击力+80%至技能结束
- 天赋 (normal): 神河谕使: 受到的元素损伤-10%，受到凋亡损伤时回复2点技力
- 模组 (golden, stage 1): 被摩挲的日子 PRP-X — attr maxHp+150, atk+45; trait ADD: 阻挡敌人时，自身造成的元素损伤提升15%

**chess_char_3_07 见行者** (Enforcer, 5★ 特种·推击手) — 盟约 拉特兰
- 特性: 同时攻击阻挡的所有敌人 / 可以放置于远程位
- 技能 S2 惊爆射击 [skchr_forcer_2, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 立即将范围内所有敌人往身前方向中等力度地推开并晕眩1.9秒（撞到高台时晕眩时间延长为3秒）。若目标碰撞其他敌人，使其晕眩1.9秒。
  - Lv7: 立即将范围内所有敌人往身前方向较大力地推开并晕眩2.2秒（撞到高台时晕眩时间延长为3.4秒）。若目标碰撞其他敌人，使其晕眩2.2秒。
- 天赋 (normal): 技巧射击: 攻击重量大于等于3的敌人时无视目标180的防御力
- 模组 (golden, stage 1): 可执行的幻想 PUS-X — attr maxHp+170, atk+45; trait OVERRIDE: 同时攻击阻挡的所有敌人 / 可以放置于远程位，并返还该次部署费用的一半

**chess_char_3_08 薄绿** (Mint, 5★ 术师·阵法术师) — 盟约 维多利亚
- 特性: 通常时不攻击且防御力和法术抗性大幅度提升，技能开启时攻击造成群体法术伤害
- 技能 S2 聚能涡旋 [skchr_mint_2, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 每次攻击把目标小力地拖拽至面前，并造成相当于攻击力110%的法术伤害。技能结束时对攻击范围内所有敌人造成相当于攻击力210%的法术伤害
  - Lv7: 每次攻击把目标小力地拖拽至面前，并造成相当于攻击力115%的法术伤害。技能结束时对攻击范围内所有敌人造成相当于攻击力240%的法术伤害
- 天赋 (normal): 地质学者: 技能未开启时，周围四格友方单位的防御力+10%；技能开启时，自身不容易受到敌人攻击
- 模组 (golden, stage 1): 注意力保持装置 PLX-X — attr maxHp+130, atk+40, def+15; trait OVERRIDE: 通常时不攻击且防御力和法术抗性更大幅度提升，技能开启时保留部分效果且攻击造成群体法术伤害

**chess_char_3_09 海霓** (Lucilla, 5★ 辅助·削弱者) — 盟约 阿戈尔、奥术
- 特性: 攻击造成法术伤害
- 技能 S2 阻滞性显色剂 [skchr_haini_2, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 攻击力+30%，额外攻击一个目标，攻击范围内的非精英和领袖敌人移动速度-40%，且被击倒时使天赋效果提升0.4倍，最多提升至2.6倍，持续至技能结束
  - Lv7: 攻击力+40%，额外攻击一个目标，攻击范围内的非精英和领袖敌人移动速度-50%，且被击倒时使天赋效果提升0.5倍，最多提升至3.0倍，持续至技能结束
- 天赋 (normal): 测绘器材的奇用: 攻击范围内的非精英和领袖敌人获得16%的脆弱效果
- 模组 (golden, stage 1): 多功能测绘仪-改良版 UMD-X — attr atk+13, def+13; trait ADD: 并对目标造成10％虚弱效果，持续2秒

**chess_char_3_10 松果** (Pinecone, 4★ 狙击·散射手) — 盟约 迅捷、协防干员
- 特性: 攻击范围内的所有敌人，对自己前方一横排的敌人攻击力提升至150%
- 技能 S2 电能过载 [skchr_pinecn_2, AUTO, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 攻击力+25%，攻击范围缩短；每使用过一次技能额外追加攻击力+20%的效果（最多+60%）
  - Lv7: 攻击力+40%，攻击范围缩短；每使用过一次技能额外追加攻击力+20%的效果（最多+60%）
- 天赋 (normal): 便携电源: 部署后60秒内技力自然回复速度+0.45/秒
- 模组 (golden, stage 1): 移动电箱 RPR-X — attr atk+30, def+15; trait OVERRIDE: 攻击范围内的所有敌人，对自己前方一横排的敌人攻击力提升至160%

**chess_char_3_11 雪猎** (Snow Hunter, 5★ 狙击·猎手) — 盟约 谢拉格、精准
- 特性: 攻击时需要消耗子弹且攻击力提升至120%，不攻击时会缓慢地装填子弹（最多8发）
- 技能 S2 风雪连弩 [skchr_snhunt_2, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 立即使用特殊子弹发动相当于攻击力160%的两连击（对非移动敌人提升至185%） / 可充能1次
  - Lv7: 立即使用特殊子弹发动相当于攻击力180%的两连击（对非移动敌人提升至210%） / 可充能2次
- 天赋 (normal): 裂云一击: 开启技能时，派出裂云兽进行攻击，造成相当于攻击力180%的物理伤害和3秒寒冷
- 模组 (golden, stage 1): 过去的狩猎 HUN-X — attr maxHp+140, atk+50; trait ADD: 子弹数量为空时下次装填额外加装1发子弹

**chess_char_3_12 瑕光** (Blemishine, 6★ 重装·守护者) — 盟约 卡西米尔、突袭
- 特性: 技能可以治疗友方单位
- 技能 S3 先贤化身 [skchr_blemsh_3, MANUAL, INCREASE_WHEN_TAKEN_DAMAGE, durationType NONE]
  - Lv4: 攻击力+65%，防御力+25%，每次攻击额外造成相当于攻击力60%的法术伤害，并恢复周围一名其他友方单位相当于攻击力70%的生命
  - Lv7: 攻击力+80%，防御力+30%，每次攻击额外造成相当于攻击力70%的法术伤害，并恢复周围一名其他友方单位相当于攻击力80%的生命
- 天赋 (normal): 剑盾骑士: 在场时所有受击回复的技能在干员攻击时也回复1点技力; 仁慈: 自身可以攻击并优先攻击沉睡的目标且攻击力提升至140%
- 模组 (golden, stage 1): 工匠团的回响 GUA-Y — attr maxHp+160, atk+35, def+35; trait ADD: 受到的伤害减少15%
- backup (unowned): 郁金香 (char_608_acpion) S3

**chess_char_3_13 至简** (Minimalist, 5★ 术师·驭械术师) — 盟约 萨尔贡、灵巧
- 特性: 操作浮游单元造成法术伤害 / 单元攻击同一敌人伤害提升（最高造成干员110%攻击力的伤害）
- 技能 S2 神工意匠 [skchr_malist_2, AUTO, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 下次攻击造成相当于攻击力130%的法术伤害，并连续攻击两次 / 可充能2次
  - Lv7: 下次攻击造成相当于攻击力160%的法术伤害，并连续攻击两次 / 可充能3次
- 天赋 (normal): 忽有所悟: 攻击时，25％几率当次攻击的攻击力提升至150％
- 模组 (golden, stage 1): “新家园” FUN-Y — attr maxHp+60, atk+20; trait OVERRIDE: 操作浮游单元造成法术伤害 / 单元攻击同一敌人伤害提升（最高造成干员120%攻击力的伤害）

**chess_char_3_14 初雪** (Pramanix, 5★ 辅助·削弱者) — 盟约 谢拉格、远见
- 特性: 攻击造成法术伤害
- 技能 S2 自然震慑 [skchr_slbell_2, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 攻击范围内所有敌人防御力-40%，法术抗性-23%
  - Lv7: 攻击范围内所有敌人防御力-45%，法术抗性-26%
- 天赋 (normal): 虚弱化: 攻击范围内的敌人生命少于40%时，令其获得30%的脆弱效果; 双响: 攻击时同时攻击两个目标
- 模组 (golden, stage 1): “续针” UMD-X — attr maxHp+100, attackSpeed+4; trait ADD: 并对目标造成10％虚弱效果，持续2秒

**chess_char_3_15 巫恋** (Shamare, 5★ 辅助·削弱者) — 盟约 叙拉古、助力
- 特性: 攻击造成法术伤害
- 技能 S2 诅咒娃娃 [skchr_vodfox_2, AUTO, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 获得一个诅咒娃娃（最多可库存1个） / 诅咒娃娃周围敌人的攻击力和防御力-25%，15秒后自动销毁
  - Lv7: 获得一个诅咒娃娃（最多可库存1个） / 诅咒娃娃周围敌人的攻击力和防御力-30%，15秒后自动销毁
- 天赋 (normal): 溃败暗示 : 攻击范围内的敌人生命少于40%时，令其获得30%的脆弱效果
- 模组 (golden, stage 1): 布艺苹果 UMD-X — attr atk+10, def+15; trait ADD: 并对目标造成10％虚弱效果，持续2秒
- 召唤物: token_10006_vodfox_doll 诅咒娃娃 (DEFAULT) HP/ATK/DEF 1000/100/0

**chess_char_3_16 蛇屠箱** (Cuora, 4★ 重装·铁卫) — 盟约 坚守、不屈
- 特性: 能够阻挡三个敌人
- 技能 S2 壳状防御 [skchr_snakek_2, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 停止攻击敌人；阻挡数+1，防御力+75%，每秒恢复最大生命的1%
  - Lv7: 停止攻击敌人；阻挡数+1，防御力+95%，每秒恢复最大生命的2%
- 天赋 (normal): 防御专精: 防御力+12%
- 模组 (golden, stage 1): 超强棒球套装 PRO-X — attr maxHp+130, def+60; trait ADD: 阻挡敌人时防御力+20%

**chess_char_3_17 流星** (Meteor, 4★ 狙击·速射手) — 盟约 卡西米尔、独行
- 特性: 优先攻击空中单位
- 特质 implementation entries (normal): garrison_137_a [IN_BATTLE/GAIN_BUFF] <战斗中>攻击力和生命值+25%，造成的伤害变为弱点伤害（基于敌人的防御力和法术抗性变换物理和法术伤害）; garrison_01_a [IN_BATTLE/GAIN_BUFF] <战斗中>造成的伤害变为弱点伤害（基于敌人的防御力和法术抗性变换物理和法术伤害）
- 技能 S2 碎甲击·扩散 [skchr_shotst_2, MANUAL, INCREASE_WHEN_ATTACK, durationType NONE]
  - Lv4: 立即对攻击范围内至多5个敌人造成相当于攻击力155%的物理伤害，5秒内使命中目标的防御力-30%
  - Lv7: 立即对攻击范围内至多5个敌人造成相当于攻击力170%的物理伤害，5秒内使命中目标的防御力-35%
- 天赋 (normal): 空射专精: 攻击空中目标时，攻击力提升至135%
- 模组 (golden, stage 1): 猎刀 MAR-X — attr maxHp+100, atk+22; trait ADD: 攻击空中单位时攻击力提升至110%

**chess_char_3_18 忍冬** (Vulpisfoglia, 6★ 先锋·尖兵) — 盟约 叙拉古、迅捷
- 特性: 能够阻挡两个敌人
- 技能 S3 隐狐之艺 [skchr_vulpis_3, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 技能开启时立即获得7点部署费用，攻击距离+1，攻击力+65%，攻击速度从+160逐渐衰减至+0，同时攻击阻挡的所有敌人，每次攻击晕眩敌人0.2秒 / 若技能期间击倒敌人，则技能结束时进入迷彩状态，直至下一次开启技能
  - Lv7: 技能开启时立即获得8点部署费用，攻击距离+1，攻击力+80%，攻击速度从+170逐渐衰减至+0，同时攻击阻挡的所有敌人，每次攻击晕眩敌人0.2秒 / 若技能期间击倒敌人，则技能结束时进入迷彩状态，直至下一次开启技能
- 天赋 (normal): 追凶: 对每个敌人造成首次伤害后，10秒内忍冬对该敌人造成伤害时额外造成攻击力30%的法术伤害; 蓄势: 在场时，部署费用的自然回复速度+10%，若4秒内自身未受到伤害，则每秒恢复4%的最大生命值
- 模组 (golden, stage 1): 杀手也有假期 SOL-X — attr maxHp+175, atk+35; trait OVERRIDE: 能够阻挡两个敌人，阻挡敌人时攻击力和防御力各+8％
- backup (unowned): Sharp (char_609_acguad) S3

**chess_char_3_19 伺夜** (Vigil, 6★ 先锋·战术家) — 盟约 叙拉古、奇迹
- 特性: 可以在攻击范围内选择一次战术点来召唤援军，自身攻击援军阻挡的敌人时攻击力提升至150%
- 特质 implementation entries (normal): garrison_152_a [IN_BATTLE/ADD_BOND] <战斗中>造成的伤害变为弱点伤害（基于敌人的防御力和法术抗性变换物理和法术伤害），前3次击倒敌人时使已激活的【叙拉古】层数+2、【奇迹】层数+1; garrison_153_a [IN_BATTLE/ADD_BOND] 【152】<战斗中>造成的伤害变为弱点伤害（基于敌人的防御力和法术抗性变换物理和法术伤害），前3次击倒敌人时使已激活的【叙拉古】层数+2、【奇迹】层数+1; garrison_01_a [IN_BATTLE/GAIN_BUFF] <战斗中>造成的伤害变为弱点伤害（基于敌人的防御力和法术抗性变换物理和法术伤害）
- 技能 S3 领袖的尊严 [skchr_vigil_3, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 技能持续时间内逐渐获得10点部署费用，攻击变为三连击；狼群与伺夜攻击被狼群阻挡的单位造成伤害时，额外造成相当于伺夜攻击力20%的法术伤害
  - Lv7: 技能持续时间内逐渐获得11点部署费用，攻击变为三连击；狼群与伺夜攻击被狼群阻挡的单位造成伤害时，额外造成相当于伺夜攻击力30%的法术伤害
- 天赋 (normal): 狼群领袖: 可以在战术点召唤由初始两只“狼影”构成的狼群协助作战，“狼影”的数量每25秒增加一只（至多3只；每只“狼影”使狼群阻挡数+1且攻击额外造成一次伤害）; 狼群天性: 敌人被狼群阻挡时，伺夜和狼群对其的攻击无视其175防御力
- 模组 (golden, stage 1): 叙拉古式入门礼 TAC-X — attr maxHp+150, atk+20, def+15; trait OVERRIDE: 可以在攻击范围内选择一次战术点来召唤援军，援军受到来自自身阻挡单位的伤害降低15%，自身攻击援军阻挡的敌人时攻击力提升至150%
- 召唤物: token_10028_vigil_wolf 狼群 (DEFAULT) HP/ATK/DEF 880/304/259

**chess_char_3_20 耶拉** (Kjera, 5★ 术师·驭械术师) — 盟约 谢拉格、助力
- 特性: 操作浮游单元造成法术伤害 / 单元攻击同一敌人伤害提升（最高造成干员110%攻击力的伤害）
- 技能 S2 心随意动 [skchr_kjera_2, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 浮游单元+1，释放浮游单元锁定敌人攻击，攻击力+29%，自身与浮游单元攻击有15%概率对敌人造成2.5秒寒冷。 / 浮游单元锁敌后直至敌人被击杀或技能结束后返回干员身边
  - Lv7: 浮游单元+1，释放浮游单元锁定敌人攻击，攻击力+40%，自身与浮游单元攻击有20%概率对敌人造成2.5秒寒冷。 / 浮游单元锁敌后直至敌人被击杀或技能结束后返回干员身边
- 天赋 (normal): 低眉: 攻击力+10%，攻击范围内存在2格以上的地面地形时，改为攻击力+16%
- 模组 (golden, stage 1): 以雪为线 FUN-Y — attr maxHp+65, atk+18; trait OVERRIDE: 操作浮游单元造成法术伤害 / 单元攻击同一敌人伤害提升（最高造成干员120%攻击力的伤害）

**chess_char_3_21 空弦** (Archetto, 6★ 狙击·速射手) — 盟约 拉特兰、灵巧
- 特性: 优先攻击空中单位
- 技能 S3 箭矢·暴风 [skchr_archet_3, MANUAL, INCREASE_WHEN_ATTACK, durationType NONE]
  - Lv4: 攻击力+10%，攻击距离+1，攻击变为3连击，每次可以攻击2个敌人
  - Lv7: 攻击力+15%，攻击距离+1，攻击变为3连击，每次可以攻击2个敌人
- 天赋 (normal): 兰登战术: 在场时所有【狙击】干员的攻击回复技能每2.5秒回复1点技力; 铁弦: 部署后立即获得一层护盾，护盾破裂后获得7点技力
- 模组 (golden, stage 1): “明天的种子” MAR-Y — attr atk+17, def+17, attackSpeed+2; trait ADD: 范围内存在地面敌人时攻击速度+8
- backup (unowned): Stormeye (char_611_acnipe) S3

### Tier 4

**chess_char_4_01 信仰搅拌机** (Sankta Miksaparato, 6★ 重装·哨戒铁卫) — 盟约 拉特兰、坚守
- 特性: 能够阻挡三个敌人，可以进行远程攻击
- 技能 S3 退休前布道 [skchr_rmixer_3, MANUAL, INCREASE_WITH_TIME, durationType AMMO]
  - Lv4: 技能开启时为所有其他【拉特兰】干员补弹2发；攻击范围扩大，生命上限+35%，攻击力+140%，防御力+35%，停止主动攻击敌人，受到攻击时立即向攻击范围内最多3个敌人进行1次反击，反击最小间隔为实际攻击间隔的60% / 攻击装有30发弹药，打完后结束（可随时停止技能）
  - Lv7: 技能开启时为所有其他【拉特兰】干员补弹3发；攻击范围扩大，生命上限+55%，攻击力+170%，防御力+55%，停止主动攻击敌人，受到攻击时立即向攻击范围内最多3个敌人进行1次反击，反击最小间隔为实际攻击间隔的30% / 攻击装有30发弹药，打完后结束（可随时停止技能）
- 天赋 (normal): 扫射迎宾仪礼: 每次造成伤害使自身10秒内防御力+30，攻击速度+3，最多可叠加3层; 架盾送客仪礼: 若8秒内未主动攻击，获得相当于生命上限15%的屏障，失去屏障后重新计时
- 模组 (golden, stage 1): 毛刷套装 SPT-X — attr maxHp+210, atk+40, def+30; trait ADD: 攻击范围内敌人的隐匿效果失效

**chess_char_4_02 莫斯提马** (Mostima, 6★ 术师·扩散术师) — 盟约 拉特兰、奥术
- 特性: 攻击造成群体法术伤害
- 技能 S3 序时之匙 [skchr_mostma_3, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 攻击范围扩大，攻击变为向外扩散的波纹，攻击力+90%，第二天赋的效果提升至3倍，小力度地击退攻击目标
  - Lv7: 攻击范围扩大，攻击变为向外扩散的波纹，攻击力+120%，第二天赋的效果提升至3倍，小力度地击退攻击目标
- 天赋 (normal): 技力光环·术师: 在场时所有【术师】干员的技力自然回复速度+0.4/秒（同类效果取最高）; 主观缓时: 攻击范围内的敌人移动速度-15%
- 模组 (golden, stage 1): 锁与匙之家 SPC-Y — attr cost+-8, atk+51, attackSpeed+5; trait ADD: 部署费用减少
- backup (unowned): Stormeye (char_611_acnipe) S2

**chess_char_4_03 耶拉** (Kjera, 5★ 术师·驭械术师) — 盟约 谢拉格、助力
- 特性: 操作浮游单元造成法术伤害 / 单元攻击同一敌人伤害提升（最高造成干员110%攻击力的伤害）
- 技能 S2 心随意动 [skchr_kjera_2, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 浮游单元+1，释放浮游单元锁定敌人攻击，攻击力+29%，自身与浮游单元攻击有15%概率对敌人造成2.5秒寒冷。 / 浮游单元锁敌后直至敌人被击杀或技能结束后返回干员身边
  - Lv7: 浮游单元+1，释放浮游单元锁定敌人攻击，攻击力+40%，自身与浮游单元攻击有20%概率对敌人造成2.5秒寒冷。 / 浮游单元锁敌后直至敌人被击杀或技能结束后返回干员身边
- 天赋 (normal): 低眉: 攻击力+10%，攻击范围内存在2格以上的地面地形时，改为攻击力+16%
- 模组 (golden, stage 1): 以雪为线 FUN-Y — attr maxHp+65, atk+18; trait OVERRIDE: 操作浮游单元造成法术伤害 / 单元攻击同一敌人伤害提升（最高造成干员120%攻击力的伤害）

**chess_char_4_04 伊内丝** (Ines, 6★ 先锋·情报官) — 盟约 远见、突袭
- 特性: 再部署时间减少，可使用远程攻击
- 技能 S2 暗夜无明 [skchr_ines_2, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 攻击范围扩大，攻击力+60%，自身获得隐匿，每次攻击获得1点部署费用并偷取目标5点攻击速度（最多50点，持续至技能结束或伊内丝离场）
  - Lv7: 攻击范围扩大，攻击力+80%，自身获得隐匿，每次攻击获得1点部署费用并偷取目标6点攻击速度（最多60点，持续至技能结束或伊内丝离场）
- 天赋 (normal): 影织: 对每个敌人首次造成伤害后，使目标束缚5秒并偷取其90点攻击力（持续至目标被击倒或伊内丝离场）; 影哨: 攻击范围内敌人的隐匿效果失效且移动速度-30%，撤退后留下一个影哨使该效果持续生效（最多1个）
- 模组 (golden, stage 1): 角部“护理”套组 AGE-Y — attr maxHp+150, atk+20; trait ADD: 首次撤退再部署时间额外减少35%
- backup (unowned): 预备干员-特种 (char_607_cspec) S2

**chess_char_4_05 蜜蜡** (Beeswax, 5★ 术师·阵法术师) — 盟约 萨尔贡、助力
- 特性: 通常时不攻击且防御力和法术抗性大幅度提升，技能开启时攻击造成群体法术伤害
- 技能 S2 守卫尖碑 [skchr_beewax_2, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 在攻击范围内的近战部署位召唤一个可以阻挡敌人的方尖塔，方尖塔在出现时会对附近的敌人造成相当于攻击力200%的法术伤害，并使其晕眩1秒
  - Lv7: 在攻击范围内的近战部署位召唤一个可以阻挡敌人的方尖塔，方尖塔在出现时会对附近的敌人造成相当于攻击力230%的法术伤害，并使其晕眩1.5秒
- 天赋 (normal): 沙原的庇护: 技能未开启时，每秒恢复4%的最大生命
- 模组 (golden, stage 1): “司祭的祝福” PLX-X — attr maxHp+150, atk+55; trait OVERRIDE: 通常时不攻击且防御力和法术抗性更大幅度提升，技能开启时保留部分效果且攻击造成群体法术伤害
- 召唤物: token_10011_beewax_oblisk 沙之碑 (HIDDEN) HP/ATK/DEF 5000/82/504

**chess_char_4_06 寒芒克洛丝** (Kroos the Keen Glint, 5★ 狙击·速射手) — 盟约 精准
- 特性: 优先攻击空中单位
- 技能 S2 封喉 [skchr_kroos2_2, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 攻击间隔少量缩短，攻击变为2连射，击中目标40次后技能剩余时间内攻击变为4连射
  - Lv7: 攻击间隔一定程度缩短，攻击变为2连射，击中目标40次后技能剩余时间内攻击变为4连射
- 天赋 (normal): 中的: 攻击时，20%几率当次攻击的攻击力提升至150%，并使敌人晕眩0.2秒
- 模组 (golden, stage 1): 真心的话和想冒的险 MAR-X — attr maxHp+110, atk+22; trait ADD: 攻击空中单位时攻击力提升至110%

**chess_char_4_07 风笛** (Bagpipe, 6★ 先锋·冲锋手) — 盟约 维多利亚、远见、不屈
- 特性: 击杀敌人后获得1点部署费用，撤退时返还初始部署费用
- 技能 S2 高效冲击 [skchr_bpipe_2, AUTO, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 下一次的攻击力提升至145%，且额外攻击一次 / 可充能1次
  - Lv7: 下一次的攻击力提升至160%，且额外攻击一次 / 可充能2次
- 天赋 (normal): 精密填弹: 每次攻击有25%的概率攻击力提升至130%，且额外攻击一个目标; 军事传统: 编入队伍时所有【先锋】干员的初始技力+6
- 模组 (golden, stage 1): 破城矛弹夹 CHG-X — attr maxHp+150, atk+50; trait OVERRIDE: 击杀敌人后获得2点部署费用，撤退时返还该次部署费用
- backup (unowned): 预备干员-近卫 (char_601_cguard) S2

**chess_char_4_08 瑰盐** (Rose Salt, 5★ 医疗·群愈师) — 盟约 协防干员
- 特性: 同时恢复三个友方单位的生命
- 技能 S2 绝妙的长效药呀 [skchr_rosesa_2, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 攻击间隔小幅度缩短，攻击范围内的友方干员受到的物理与法术伤害的20%变为持续5秒的生命流失
  - Lv7: 攻击间隔缩短，攻击范围内的友方干员受到的物理与法术伤害的30%变为持续5秒的生命流失
- 天赋 (normal): 最好的草药医生: 自身攻击力-5%，但攻击范围内的友方干员受到的治疗效果提升15%
- 模组 (golden, stage 1): 多彩盐漠生活 RIN-X — attr maxHp+70, atk+25; trait ADD: 攻击范围扩大

**chess_char_4_09 水月** (Mizuki, 6★ 特种·伏击客) — 盟约 阿戈尔、独行
- 特性: 对攻击范围内所有敌人造成伤害 / 拥有50%的物理和法术闪避且不容易成为敌人的攻击目标
- 技能 S2 囚徒困境 [skchr_mizuki_2, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 攻击间隔小幅度缩短，攻击力+15%，第一天赋额外攻击1个目标并附加0.8秒束缚
  - Lv7: 攻击间隔缩短，攻击力+20%，第一天赋额外攻击1个目标并附加1秒束缚
- 天赋 (normal): 创伤性癔症: 攻击时对攻击目标中生命值最少的敌人额外造成相当于攻击力50%的法术伤害; 反移情: 攻击范围内存在生命值低于一半的敌人时，攻击力+10%
- 模组 (golden, stage 1): 使者之约 AMB-X — attr maxHp+120, atk+60; trait ADD: 攻击范围内所有敌人移动速度-20%
- backup (unowned): 领主·Sharp (char_617_sharp2) S1

**chess_char_4_10 阿罗玛** (Aroma, 5★ 术师·轰击术师) — 盟约 叙拉古、奥术
- 特性: 攻击造成超远距离的群体法术伤害
- 技能 S2 小心地滑 [skchr_aroma_2, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 攻击力+65%，攻击范围内浮空状态的敌人结束浮空落地时，对其造成攻击力65%的法术伤害
  - Lv7: 攻击力+80%，攻击范围内浮空状态的敌人结束浮空落地时，对其造成攻击力80%的法术伤害
- 天赋 (normal): 起泡性能测试: 对每个敌人首次进行攻击时攻击力提升至110%，并使目标浮空2.5秒
- 模组 (golden, stage 1): 柠檬味的童年 BLA-X — attr maxHp+150, atk+49; trait OVERRIDE: 攻击造成超远距离的群体法术伤害，距离越远伤害越高，最高达到110%

**chess_char_4_11 凯瑟琳** (Catherine, 5★ 辅助·工匠) — 盟约 维多利亚、灵巧
- 特性: 能够阻挡两个敌人，使用<支援装置>协助作战
- 技能 S2 战火淬炼 [skchr_cathy_2, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 停止攻击，生命上限+40%，防御力+10%，装置效果改为使目标干员每秒获得相当于凯瑟琳生命上限6%的屏障（不会超过天赋上限）
  - Lv7: 停止攻击，生命上限+55%，防御力+15%，装置效果改为使目标干员每秒获得相当于凯瑟琳生命上限6%的屏障（不会超过天赋上限）
- 天赋 (normal): 定向支援信号: 携带3个支援装置（最多部署2个），使一名干员获得相当于凯瑟琳生命上限20%的屏障（若目标最近5秒内未受攻击，则每秒补充相当于凯瑟琳生命上限6%的屏障，不超过初始上限），装置效果不叠加
- 天赋 (golden): 定向支援信号 [mod]: 
- 模组 (golden, stage 1): 闲暇时分 CRA-X — attr maxHp+100, atk+20, def+20; trait ADD: <支援装置>的持有上限+1且部署费用减少
- 召唤物: token_10041_cathy_catsld 爬行号·防护单元 (not in shopStateTokenDict) HP/ATK/DEF 100/100/0

**chess_char_4_12 歌蕾蒂娅** (Gladiia, 6★ 特种·钩索师) — 盟约 阿戈尔
- 特性: 技能可以使敌人产生位移 / 可以放置于远程位
- 技能 S3 缺水的碎漩狂舞 [skchr_glady_3, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 对一个远处目标束缚并制造一个龙卷风使周围敌人移动速度-50%，每1.5秒造成85%攻击力的法术伤害并小力地拖拽至中心。技能结束时把目标地点周围的敌人小力地拖拽至面前
  - Lv7: 对一个远处目标束缚并制造一个龙卷风使周围敌人移动速度-50%，每1.5秒造成100%攻击力的法术伤害并中等力度地拖拽至中心。技能结束时把目标地点周围的敌人中等力度地拖拽至面前
- 天赋 (normal): 阿戈尔的波涛: 在场时，所有【深海猎人】干员每秒回复2.5%最大生命值且受到【海怪】敌人的物理与法术伤害降低25%; 弱肉强食: 攻击重量小于等于3的敌人时攻击力提升至130%
- 模组 (golden, stage 1): 执政官手镜 HOK-X — attr maxHp+110, atk+45; trait ADD: 拖拽期间敌人受到正比于距离的法术伤害

**chess_char_4_13 灵知** (Gnosis, 6★ 辅助·削弱者) — 盟约 谢拉格、灵巧
- 特性: 攻击造成法术伤害
- 技能 S2 零度爆发 [skchr_gnosis_2, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 对范围内所有敌人造成2.5秒寒冷和相当于攻击力130%的法术伤害；蓄力：额外造成一层寒冷
  - Lv7: 对范围内所有敌人造成3秒寒冷和相当于攻击力160%的法术伤害；蓄力：额外造成一层寒冷
- 天赋 (normal): 坚冰: 攻击造成1秒寒冷；范围内寒冷的敌人受到25%的脆弱，范围内冻结的敌人脆弱效果提升至2倍; 殊途同归: 灵知在场且部署后经过10秒时，使所有【谢拉格】干员获得抵抗
- 模组 (golden, stage 1): “誓言” UMD-X — attr maxHp+105, atk+15, def+15; trait ADD: 并对目标造成10％虚弱效果，持续2秒
- backup (unowned): Raidian (char_614_acsupo) S2

**chess_char_4_14 莱恩哈特** (Leonhardt, 5★ 术师·扩散术师) — 盟约 迅捷、精准
- 特性: 攻击造成群体法术伤害
- 技能 S2 解构与爆破 [skchr_lionhd_2, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 攻击范围扩大，立即对攻击范围内的所有敌人造成相当于攻击力170%的法术伤害且使其在6秒内法术抗性-8% / 可充能2次
  - Lv7: 攻击范围扩大，立即对攻击范围内的所有敌人造成相当于攻击力200%的法术伤害且使其在6秒内法术抗性-12% / 可充能2次
- 天赋 (normal): 破片杀伤: 攻击范围内每有一个敌人，自身攻击力+4%（最多可叠加5层）
- 模组 (golden, stage 1): 传承与开拓 SPC-X — attr maxHp+80, atk+45; trait ADD: 攻击范围扩大

**chess_char_4_15 录武官** (Record Keeper, 5★ 医疗·医师) — 盟约 炎、奇迹
- 特性: 恢复友方单位生命
- 特质 implementation entries (normal): garrison_156_a [SERVER_GAIN/SERVER_ADD_MULTIPLE_BOND] <获得时>【炎】层数+6、【奇迹】层数+3（无需激活盟约）; garrison_157_a [SERVER_GAIN/SERVER_ADD_BOND] <获得时>【炎】层数+6、【奇迹】层数+3（无需激活盟约）
- 技能 S2 一点关窍 [skchr_reckpr_2, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 攻击力+45%，治疗干员后为其施加一个增益，使其在10秒内每次受到伤害时恢复80点生命
  - Lv7: 攻击力+60%，治疗干员后为其施加一个增益，使其在10秒内每次受到伤害时恢复120点生命
- 天赋 (normal): 学成于聚: 攻击范围内的干员开启技能时自身回复1点技力，且攻击速度+16，持续8秒
- 模组 (golden, stage 1): 未完成的录武簿 PHY-X — attr maxHp+70, attackSpeed+4; trait ADD: 治疗生命值低于50%的友方单位时治疗量提升15%

**chess_char_4_16 缄默德克萨斯** (Texas the Omertosa, 6★ 特种·处决者) — 盟约 叙拉古、突袭
- 特性: 再部署时间大幅度减少
- 技能 S3 剑雨滂沱 [skchr_texas2_3, PASSIVE, 8, durationType NONE]
  - Lv4: 部署后立即对周围所有敌人造成两次相当于攻击力115%的法术伤害并使目标晕眩1.5秒，之后每秒释放剑雨攻击范围内最多2个不同的目标，造成攻击力85%的法术伤害和0.2秒晕眩
  - Lv7: 部署后立即对周围所有敌人造成两次相当于攻击力130%的法术伤害并使目标晕眩1.5秒，之后每秒释放剑雨攻击范围内最多3个不同的目标，造成攻击力100%的法术伤害和0.2秒晕眩
- 天赋 (normal): 德克萨斯传统: 被动技能持续时间内攻击力+20%；首次击倒敌人时回复所有生命并重新释放被动技能; 德克萨斯剑术: 每次部署后击倒一名敌人之前，攻击速度+8，受到的所有伤害降低25%
- 模组 (golden, stage 1): 蓝莓与黑巧 EXE-Y — attr maxHp+140, atk+40; trait ADD: 周围四格没有友方干员时攻击力+10%
- backup (unowned): Misery (char_615_acspec) S2

**chess_char_4_17 星熊** (Hoshiguma, 6★ 重装·铁卫) — 盟约 炎
- 特性: 能够阻挡三个敌人
- 技能 S2 荆棘 [skchr_hsguma_2, PASSIVE, 8, durationType NONE]
  - Lv4: 防御力+13% / 每次受到攻击时对目标造成相当于星熊攻击力65%的物理伤害
  - Lv7: 防御力+21% / 每次受到攻击时对目标造成相当于星熊攻击力80%的物理伤害
- 天赋 (normal): 战术装甲: 获得25%的伤害抵挡; 特种作战策略: 在场时所有友方【重装】职业干员的防御力提升6%
- 模组 (golden, stage 1): 友人们的赠礼 PRO-Y — attr atk+50, def+70, blockCnt+1; trait OVERRIDE: 能够阻挡四个敌人
- backup (unowned): Mechanist (char_610_acfend) S2

**chess_char_4_18 泥岩** (Mudrock, 6★ 重装·不屈者) — 盟约 独行
- 特性: 无法被友方角色治疗
- 技能 S2 岩崩锤 [skchr_mudrok_2, AUTO, INCREASE_WHEN_TAKEN_DAMAGE, durationType NONE]
  - Lv4: 下次攻击时回复自身4%的最大生命，对周围所有地面敌人造成相当于攻击力190%的物理伤害，并有30%的几率晕眩其0.5秒
  - Lv7: 下次攻击时回复自身5%的最大生命，对周围所有地面敌人造成相当于攻击力210%的物理伤害，并有30%的几率晕眩其0.6秒
- 天赋 (normal): 沃土予身: 每9秒获得1层护盾（最多3层，部署后立即获得1层），每层护盾破裂时恢复自身20%最大生命; 手足相惜: 受到来自【萨卡兹】敌人的伤害降低30%
- 模组 (golden, stage 1): 土石的根系 UNY-X — attr maxHp+245, atk+55; trait ADD: 受到来自自身阻挡单位的伤害降低15%
- backup (unowned): 预备干员-重装 (char_602_cdfend) S2

**chess_char_4_19 焰尾** (Flametail, 6★ 先锋·尖兵) — 盟约 卡西米尔
- 特性: 能够阻挡两个敌人
- 技能 S3 焰心 [skchr_flamtl_3, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 技能持续时间内逐渐获得8点部署费用，攻击间隔缩短，攻击力+45%，阻挡数+1，获得60%的物理和法术闪避
  - Lv7: 技能持续时间内逐渐获得8点部署费用，攻击间隔缩短，攻击力+60%，阻挡数+1，获得80%的物理和法术闪避
- 天赋 (normal): 前锋剑术: 触发闪避时，下次攻击变为二连击并攻击所有阻挡的敌人; 红松骑士团团长: 在场时，所有【卡西米尔】势力的干员获得22%的物理闪避
- 模组 (golden, stage 1): 红松的起点 SOL-Y — attr maxHp+175, atk+35; trait ADD: 首次部署时部署费用-4
- backup (unowned): 郁金香 (char_608_acpion) S2

**chess_char_4_20 远牙** (Fartooth, 6★ 狙击·神射手) — 盟约 卡西米尔、精准
- 特性: 优先攻击攻击范围内防御力最低的敌方单位
- 技能 S3 光羽箭 [skchr_fartth_3, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 攻击范围改为前方无限长的直线，攻击力+80%，攻击原本范围以外的目标时，造成的伤害提高至125%
  - Lv7: 攻击范围改为前方无限长的直线，攻击力+100%，攻击原本范围以外的目标时，造成的伤害提高至130%
- 天赋 (normal): 凝神: 最近10秒内未受伤害时，攻击力+15%; 屏息: 技能开启时不容易成为敌人的目标，且攻击无视目标的物理闪避
- 模组 (golden, stage 1): 首战支援套组 DEA-X — attr atk+70, attackSpeed+5; trait ADD: 攻击越远的敌人造成的伤害越高（最高提升15%）
- backup (unowned): 预备干员-狙击 (char_603_csnipe) S2

**chess_char_4_21 白面鸮** (Ptilopsis, 5★ 医疗·群愈师) — 盟约 助力、灵巧
- 特性: 同时恢复三个友方单位的生命
- 技能 S2 脑啡肽 [skchr_plosis_2, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 攻击范围扩大，攻击间隔较大幅度缩短
  - Lv7: 攻击范围扩大，攻击间隔大幅度缩短
- 天赋 (normal): 技力光环: 在场时所有友方单位的技力自然回复速度+0.3/秒（同类效果取最高）
- 模组 (golden, stage 1): 医疗环境分析装置 RIN-X — attr maxHp+60, atk+30; trait ADD: 攻击范围扩大

**chess_char_4_22 银灰** (SilverAsh, 6★ 近卫·领主) — 盟约 谢拉格
- 特性: 可以进行远程攻击，但此时攻击力降低至80%
- 技能 S3 真银斩 [skchr_svrash_3, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 防御力-70%，攻击力+125%，攻击范围扩大，同时攻击至多4个目标（视为近距离攻击）
  - Lv7: 防御力-70%，攻击力+140%，攻击范围扩大，同时攻击至多5个目标（视为近距离攻击）
- 天赋 (normal): 领袖: 攻击力+10%，编入队伍时所有我方单位的再部署时间-10%; 鹰眼视觉: 攻击范围内敌人的隐匿效果失效
- 模组 (golden, stage 1): 雪境羽兽护理套组 LOR-X — attr maxHp+190, atk+45; trait ADD: 攻击附带10%攻击力的法术伤害
- backup (unowned): Sharp (char_609_acguad) S2

**chess_char_4_23 百炼嘉维尔** (Gavial the Invincible, 6★ 近卫·强攻手) — 盟约 萨尔贡
- 特性: 同时攻击阻挡的所有敌人
- 技能 S3 丛林之魂 [skchr_gvial2_3, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 攻击力+85%，攻击速度+60，阻挡数+2，技能期间暂时只受到50%的伤害，其余伤害延后至技能结束，变为持续20秒等量的生命流失效果
  - Lv7: 攻击力+100%，攻击速度+80，阻挡数+2，技能期间暂时只受到50%的伤害，其余伤害延后至技能结束，变为持续20秒等量的生命流失效果
- 天赋 (normal): 战地巨斧: 攻击力和防御力提升10%，每再阻挡一个敌人提升4%; 医学背景: 受到的治疗效果提升20%，生命值低于一半时提升至40%
- 模组 (golden, stage 1): 嘉维尔的折磨 CEN-X — attr maxHp+150, atk+45, def+23; trait OVERRIDE: 同时攻击阻挡的所有敌人，攻击被阻挡的敌人攻击力提升至110%
- backup (unowned): Sharp (char_609_acguad) S2

**chess_char_4_24 卡涅利安** (Carnelian, 6★ 术师·阵法术师) — 盟约 萨尔贡、助力
- 特性: 通常时不攻击且防御力和法术抗性大幅度提升，技能开启时攻击造成群体法术伤害
- 技能 S2 沙缚镣锁 [skchr_billro_2, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 攻击间隔缩短，每次攻击对目标造成0.3秒停顿； / 蓄力额外效果：攻击力+10%且停顿变为束缚0.3秒
  - Lv7: 攻击间隔较大幅度缩短，每次攻击对目标造成0.3秒停顿； / 蓄力额外效果：攻击力+15%且停顿变为束缚0.4秒
- 天赋 (normal): 生命之餐: 开启技能时立即恢复40%最大生命值； / 蓄力时效果翻倍; 蓄势待发: 技力超过上限时，技力自然回复速度+0.6/秒
- 模组 (golden, stage 1): 风信子与匕首 PLX-X — attr maxHp+200, atk+66; trait OVERRIDE: 通常时不攻击且防御力和法术抗性更大幅度提升，技能开启时保留部分效果且攻击造成群体法术伤害
- backup (unowned): 预备干员-术师 (char_604_ccast) S2

**chess_char_4_25 魔王** (Civilight Eterna, 6★ 辅助·吟游者) — 盟约 协防干员
- 特性: 不攻击，持续恢复范围内所有友军生命（每秒相当于自身攻击力10%的生命），自身不受鼓舞影响
- 技能 S3 编织重构现世 [skchr_cetsyr_3, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 攻击范围扩大，自身特性效果提高至65%，“微尘”不再消失，攻击范围内所有其它友方单位获得相当于魔王65%的最大生命值的鼓舞效果，每隔2秒重新分配攻击范围内所有友方单位的生命
  - Lv7: 攻击范围扩大，自身特性效果提高至75%，“微尘”不再消失，攻击范围内所有其它友方单位获得相当于魔王80%的最大生命值的鼓舞效果，每隔2秒重新分配攻击范围内所有友方单位的生命
- 天赋 (normal): 过往尘埃: 魔王周围持续围绕3枚“微尘”，“微尘”碰撞友方干员时，消失并使该干员受到魔王特性效果提升至1.5倍，持续6秒，消失的“微尘”在6秒后重生; 魔王残响: 上阵时，所有友方单位受到【萨卡兹】敌人的伤害降低10%
- 模组 (golden, stage 1): 故事的结局 BAR-X — attr maxHp+180, atk+20; trait ADD: 攻击范围内存在2名及以上其他干员时，攻击力+8%（不受技能影响）

**chess_char_4_26 华法琳** (Warfarin, 5★ 医疗·医师) — 盟约 奇迹
- 特性: 恢复友方单位生命
- 技能 S1 紧急包扎 [skchr_bldsk_1, AUTO, INCREASE_WHEN_ATTACK, durationType NONE]
  - Lv4: 下次治疗额外回复目标最大生命值的15% / 只当目标生命值不满一半时才会触发，可充能2次
  - Lv7: 下次治疗额外回复目标最大生命值的19% / 只当目标生命值不满一半时才会触发，可充能3次
- 天赋 (normal): 血液样本回收: 攻击范围内有敌人倒下时，为自身和范围内随机一名友方单位回复2点技力
- 模组 (golden, stage 1): 应急储备 PHY-X — attr maxHp+40, atk+30; trait ADD: 治疗生命值低于50%的友方单位时治疗量提升15%

### Tier 5

**chess_char_5_22 妮芙** (Nymph, 6★ 术师·本源术师) — 盟约 迅捷
- 特性: 攻击造成法术伤害，可以造成元素伤害
- 技能 S2 怵然震爆 [skchr_nymph_2, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 对敌人造成一次相当于攻击力270%的法术伤害、使其恐惧4秒，并对目标周围造成一次等额法术溅射伤害，均附带造成法术伤害18%的凋亡损伤；若攻击到的单位处于凋亡损伤爆发期间，使第一天赋造成的伤害效果提高至攻击力的70% / 可充能1次
  - Lv7: 对敌人造成一次相当于攻击力300%的法术伤害、使其恐惧5秒，并对目标周围造成一次等额法术溅射伤害，均附带造成法术伤害22%的凋亡损伤；若攻击到的单位处于凋亡损伤爆发期间，使第一天赋造成的伤害效果提高至攻击力的85% / 可充能2次
- 天赋 (normal): 失魂: 攻击处于凋亡损伤爆发期间的敌人时使其每秒受到相当于攻击力40%的元素伤害，持续至凋亡损伤爆发结束; 窥心钥: 每当自身攻击范围内敌人凋亡损伤爆发，攻击力+2%，最多可叠加10层
- 模组 (golden, stage 1): 心声 PRI-X — attr maxHp+100, atk+50; trait ADD: 对处于元素爆发期间的敌人造成的伤害提升至110%
- backup (unowned): Stormeye (char_611_acnipe) S3

**chess_char_5_01 圣约送葬人** (Executor the Ex Foedere, 6★ 近卫·收割者) — 盟约 拉特兰、远见
- 特性: 无法被友方角色治疗，攻击造成群体伤害，每攻击到一个敌人回复自身50生命，最大生效数等于阻挡数
- 特质 implementation entries (normal): garrison_23_a [IN_BATTLE/ADD_BOND] <战斗中>自身每消耗7发子弹，使已激活的【拉特兰】层数+7、【远见】层数+3（每场战斗分别至多触发7次）; garrison_55_a [IN_BATTLE/ADD_BOND] 【23】<战斗中>自身每消耗7发子弹，使已激活的【拉特兰】层数+7、【远见】层数+3（【远见】每场战斗至多21层）
- 技能 S2 近身铳斗 [skchr_excu2_2, MANUAL, INCREASE_WHEN_ATTACK, durationType AMMO]
  - Lv4: 攻击力+45%，防御力+45%，阻挡数+1，受到敌人的近战攻击时有20%几率闪避并补充1颗弹药 / 攻击装有12发弹药，打完后结束（可随时停止技能）
  - Lv7: 攻击力+60%，防御力+60%，阻挡数+1，受到敌人的近战攻击时有30%几率闪避并补充1颗弹药 / 攻击装有12发弹药，打完后结束（可随时停止技能）
- 天赋 (normal): 受选之人: 攻击时有20%几率额外攻击一次，技能期间每消耗1颗弹药这个几率提升5%，技能结束时重置; 铳弹共感: 每有一个【拉特兰】干员在场，自身的弹药类技能弹药上限+1（最多4层）
- 模组 (golden, stage 1): 待解答 REA-X — attr atk+40, def+24, attackSpeed+5; trait OVERRIDE: 无法被友方角色治疗，攻击造成群体伤害，每攻击到一个敌人回复自身60生命，最大生效数等于阻挡数
- backup (unowned): 预备干员-先锋 (char_600_cpione) S3

**chess_char_5_02 缇缇** (Titi, 6★ 医疗·咒愈师) — 盟约 萨尔贡、精准
- 特性: 攻击造成法术伤害，攻击敌人时为攻击范围内一名友方干员治疗相当于50%伤害的生命值
- 技能 S3 旧日绽放 [skchr_titi_3, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 攻击力+110%，同时攻击两名敌人，攻击非沉睡目标时使其沉睡5秒，技能期间，全场敌人从沉睡状态醒来或于沉睡中被击倒时，受到法术伤害（随沉睡时长提高至攻击力370%），并使周围一名其他敌人沉睡5秒，攻击范围内的其他友方干员受到致命伤害时，陷入沉睡至生命值完全恢复或技能结束
  - Lv7: 攻击力+150%，同时攻击两名敌人，攻击非沉睡目标时使其沉睡5秒，技能期间，全场敌人从沉睡状态醒来或于沉睡中被击倒时，受到法术伤害（随沉睡时长提高至攻击力400%），并使周围一名其他敌人沉睡5秒，攻击范围内的其他友方干员受到致命伤害时，陷入沉睡至生命值完全恢复或技能结束
- 天赋 (normal): 凝固的时光: 自身可以攻击沉睡的敌人，且攻击非移动敌人时对其额外造成相当于攻击力15%的法术伤害，在场时沉睡中的敌人每秒受到缇缇攻击力30%的法术伤害; 勇气的报偿: 场上的【米诺斯】或【萨尔贡】干员生命值高于50%时，获得+20攻速的精力充沛
- 模组 (golden, stage 1): 远方的礼物 INC-X — attr maxHp+100, atk+35; trait OVERRIDE: 攻击造成法术伤害，攻击敌人时为攻击范围内一名友方干员治疗相当于60%伤害的生命值
- backup (unowned): 预备干员-术师 (char_604_ccast) S3

**chess_char_5_03 烛煌** (Blaze the Igniting Spark, 6★ 术师·本源术师) — 盟约 维多利亚、炎
- 特性: 攻击造成法术伤害，可以造成元素伤害
- 技能 S3 众恶的焚场 [skchr_blaze2_3, MANUAL, INCREASE_WITH_TIME, durationType AMMO]
  - Lv4: 攻击范围改变，攻击力+70%，攻击间隔大幅缩短，攻击变为群体攻击；若目标处于灼燃损伤爆发期间则额外造成攻击力60%的元素伤害 / 自身每秒流失最大生命的3%，攻击装有18发弹药，全场有敌人进入灼燃损伤爆发时获得2颗额外弹药，弹药打完后结束（可随时停止技能）
  - Lv7: 攻击范围改变，攻击力+85%，攻击间隔大幅缩短，攻击变为群体攻击；若目标处于灼燃损伤爆发期间则额外造成攻击力70%的元素伤害 / 自身每秒流失最大生命的3%，攻击装有21发弹药，全场有敌人进入灼燃损伤爆发时获得2颗额外弹药，弹药打完后结束（可随时停止技能）
- 天赋 (normal): 熔点引爆: 全场有敌人灼燃损伤爆发开始时，立即对其造成相当于攻击力350%的元素伤害并回复12%最大生命; 绝处重燃: 被击倒时倒地并获得6000点屏障，倒地期间不能攻击，无法被治疗，每秒回复3%生命；生命回满后复活并使附近的敌人晕眩5秒
- 模组 (golden, stage 1): 热切的期盼 PRI-X — attr atk+52, def+10; trait ADD: 对处于元素爆发期间的敌人造成的伤害提升至110%
- backup (unowned): Pith (char_612_accast) S3

**chess_char_5_04 华法琳** (Warfarin, 5★ 医疗·医师) — 盟约 奇迹
- 特性: 恢复友方单位生命
- 技能 S1 紧急包扎 [skchr_bldsk_1, AUTO, INCREASE_WHEN_ATTACK, durationType NONE]
  - Lv4: 下次治疗额外回复目标最大生命值的15% / 只当目标生命值不满一半时才会触发，可充能2次
  - Lv7: 下次治疗额外回复目标最大生命值的19% / 只当目标生命值不满一半时才会触发，可充能3次
- 天赋 (normal): 血液样本回收: 攻击范围内有敌人倒下时，为自身和范围内随机一名友方单位回复2点技力
- 模组 (golden, stage 1): 应急储备 PHY-X — attr maxHp+40, atk+30; trait ADD: 治疗生命值低于50%的友方单位时治疗量提升15%

**chess_char_5_05 乌尔比安** (Ulpianus, 6★ 近卫·重剑手) — 盟约 阿戈尔
- 特性: 同时攻击阻挡的所有敌人
- 技能 S3 必须开辟的通路 [skchr_ulpia_3, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 最大生命值+40%，攻击力+200%，立即朝面前扔出一个船锚，撞击到目标或达到最远距离时停止，并对周围所有敌人造成攻击力135%的物理伤害和6秒晕眩。若船锚停留的位置可以部署，乌尔比安会移动到该位置 / 可以手动结束技能，技能结束时乌尔比安会返回到初始的位置
  - Lv7: 最大生命值+60%，攻击力+230%，立即朝面前扔出一个船锚，撞击到目标或达到最远距离时停止，并对周围所有敌人造成攻击力140%的物理伤害和6秒晕眩。若船锚停留的位置可以部署，乌尔比安会移动到该位置 / 可以手动结束技能，技能结束时乌尔比安会返回到初始的位置
- 天赋 (normal): 本性的坚守: 每次受到伤害时，治疗自身100点生命值；生命值低于50%时，治疗效果提升至160点生命值; 血脉的哺养: 每次击倒一名敌人时，自身的生命上限提高120，攻击力提高30，最多叠加9次，其他【深海猎人】干员获得50%的提高效果
- 模组 (golden, stage 1): 乌尔比安的衣橱 CRU-X — attr maxHp+330, atk+84; trait ADD: 受到的治疗效果提升20%
- 召唤物: token_10039_ulpia_block 从不混淆的方向 (HIDDEN) HP/ATK/DEF 3500/660/585
- backup (unowned): 预备干员-重装 (char_602_cdfend) S3

**chess_char_5_06 隐德来希** (Entelechia, 6★ 近卫·收割者) — 盟约 不屈、灵巧
- 特性: 无法被友方角色治疗，攻击造成群体伤害，每攻击到一个敌人回复自身50生命，最大生效数等于阻挡数
- 技能 S3 灵与欲的惜别 [skchr_etlchi_3, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 攻击范围扩大，攻击力+80%，攻击速度+100，立刻为攻击范围内最多3名生命值最高的地面敌人召唤对应的心烛，每次攻击对心烛至少造成35%攻击力的伤害，心烛继承原敌人当前60%的生命值，被攻击时原敌人也会流失同等生命值 / 心烛只受隐德来希攻击的影响
  - Lv7: 攻击范围扩大，攻击力+110%，攻击速度+100，立刻为攻击范围内最多3名生命值最高的地面敌人召唤对应的心烛，每次攻击对心烛至少造成35%攻击力的伤害，心烛继承原敌人当前60%的生命值，被攻击时原敌人也会流失同等生命值 / 心烛只受隐德来希攻击的影响
- 天赋 (normal): 萃血: 每次攻击敌人时偷取目标75点生命上限（最高1350）并使目标每秒受到200点法术伤害持续5秒; 重盈: 生命值低于25%时，仅一次立刻回复50%最大生命值，且自身之后受到的物理伤害降低10%
- 模组 (golden, stage 1): 易枯萎的航船 REA-X — attr atk+50, def+20; trait OVERRIDE: 无法被友方角色治疗，攻击造成群体伤害，每攻击到一个敌人回复自身60生命，最大生效数等于阻挡数
- backup (unowned): Sharp (char_609_acguad) S3

**chess_char_5_07 史尔特尔** (Surtr, 6★ 近卫·术战者) — 盟约 突袭、奥术
- 特性: 攻击造成法术伤害
- 技能 S3 黄昏 [skchr_surtr_3, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 立即恢复所有生命；攻击力+210%，攻击距离+2，攻击目标数+2，生命上限+5000，逐渐流失生命（60秒后到达最大生命20%/秒）；持续时间无限
  - Lv7: 立即恢复所有生命；攻击力+240%，攻击距离+2，攻击目标数+2，生命上限+5000，逐渐流失生命（60秒后到达最大生命20%/秒）；持续时间无限
- 天赋 (normal): 熔火: 无视攻击目标20法术抗性; 余烬: 受到致命伤害时持续使生命值不低于1，8秒后强制退出战场
- 模组 (golden, stage 1): 萨米的不灭心脏碎片 AFT-X — attr atk+30, magicResistance+5; trait ADD: 未阻挡敌人时攻击速度+8
- backup (unowned): 预备干员-近卫 (char_601_cguard) S3

**chess_char_5_08 号角** (Horn, 6★ 重装·要塞) — 盟约 维多利亚
- 特性: 不阻挡敌人时优先远程群体物理攻击
- 技能 S3 终极防线 [skchr_horn_3, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 攻击力+25%，攻击间隔缩短 / 过载：攻击力改为+50%，逐渐流失生命（12秒后到达最大生命12%/秒）该技能可随时主动关闭
  - Lv7: 攻击力+40%，攻击间隔大幅缩短 / 过载：攻击力改为+80%，逐渐流失生命（12秒后到达最大生命12%/秒）该技能可随时主动关闭
- 天赋 (normal): 军事要塞: 在场时所有重装干员的攻击力+20%; 血战: 被击倒时不撤退，恢复所有生命且生命上限-50%，攻击速度+18、防御力+18%（单次部署只触发一次）
- 模组 (golden, stage 1): “典范之人” FOR-X — attr atk+65, def+52; trait ADD: 攻击被阻挡的敌人时攻击力提升至110%
- backup (unowned): Mechanist (char_610_acfend) S3

**chess_char_5_09 魔王** (Civilight Eterna, 6★ 辅助·吟游者) — 盟约 协防干员
- 特性: 不攻击，持续恢复范围内所有友军生命（每秒相当于自身攻击力10%的生命），自身不受鼓舞影响
- 技能 S3 编织重构现世 [skchr_cetsyr_3, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 攻击范围扩大，自身特性效果提高至65%，“微尘”不再消失，攻击范围内所有其它友方单位获得相当于魔王65%的最大生命值的鼓舞效果，每隔2秒重新分配攻击范围内所有友方单位的生命
  - Lv7: 攻击范围扩大，自身特性效果提高至75%，“微尘”不再消失，攻击范围内所有其它友方单位获得相当于魔王80%的最大生命值的鼓舞效果，每隔2秒重新分配攻击范围内所有友方单位的生命
- 天赋 (normal): 过往尘埃: 魔王周围持续围绕3枚“微尘”，“微尘”碰撞友方干员时，消失并使该干员受到魔王特性效果提升至1.5倍，持续6秒，消失的“微尘”在6秒后重生; 魔王残响: 上阵时，所有友方单位受到【萨卡兹】敌人的伤害降低10%
- 模组 (golden, stage 1): 故事的结局 BAR-X — attr maxHp+180, atk+20; trait ADD: 攻击范围内存在2名及以上其他干员时，攻击力+8%（不受技能影响）

**chess_char_5_10 铃兰** (Suzuran, 6★ 辅助·凝滞师) — 盟约 叙拉古、协防干员
- 特性: 攻击造成法术伤害，并对敌人造成短暂的停顿
- 技能 S3 狐火渺然 [skchr_lisa_3, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 停止攻击，攻击范围扩大，第二天赋效果提升至1.4倍，攻击范围内的所有敌人被停顿，且每秒回复范围内所有友方单位相当于攻击力9%的生命
  - Lv7: 停止攻击，攻击范围扩大，第二天赋效果提升至1.7倍，攻击范围内的所有敌人被停顿，且每秒回复范围内所有友方单位相当于攻击力11%的生命
- 天赋 (normal): 技力光环·辅助: 在场时所有【辅助】干员的技力自然回复速度+0.4/秒（同类效果取最高）; 画地为牢: 攻击范围内被停顿的敌人在下一瞬间起还会受到等长时间的20%的脆弱效果
- 模组 (golden, stage 1): 怀中御守 DEC-X — attr maxHp+100, attackSpeed+4; trait ADD: 攻击范围内存在敌人时技力自然恢复速度+0.2/秒
- backup (unowned): 预备干员-辅助 (char_606_csuppo) S3

**chess_char_5_11 塞雷娅** (Saria, 6★ 重装·守护者) — 盟约 坚守、独行
- 特性: 技能可以治疗友方单位
- 技能 S2 药物配置 [skchr_demkni_2, AUTO, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 治疗附近一定范围内的所有友军相当于塞雷娅攻击力95%的生命
  - Lv7: 治疗附近一定范围内的所有友军相当于塞雷娅攻击力110%的生命
- 天赋 (normal): 莱茵充能护服: 每在场上停留20秒，攻击力+5%，防御力+4%，最多叠加5层; 精神回复: 每次回复友方单位生命值时额外回复该单位1点技力
- 模组 (golden, stage 1): 闲置的拳击手套 GUA-X — attr maxHp+150, atk+50; trait ADD: 治疗生命值低于50%的友方单位时治疗量提升15%
- backup (unowned): Touch (char_613_acmedc) S3

**chess_char_5_12 夕** (Dusk, 6★ 术师·扩散术师) — 盟约 炎、奥术
- 特性: 攻击造成群体法术伤害
- 技能 S1 工笔入化 [skchr_dusk_1, AUTO, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 下一次攻击溅射范围扩大，造成相当于攻击力180%的法术伤害 / 可充能2次
  - Lv7: 下一次攻击溅射范围扩大，造成相当于攻击力210%的法术伤害 / 可充能2次
- 天赋 (normal): 化境: 夕与"小自在"击杀一名敌人时，夕获得2%攻击力，最多可叠加15层; 点睛: 部署后首次攻击敌人时，在目标位置（可部署地面）召唤一个“小自在”（持续25秒）
- 模组 (golden, stage 1): 无题长卷 SPC-X — attr maxHp+120, atk+55; trait ADD: 攻击范围扩大
- 召唤物: token_10015_dusk_drgn “小自在” (HIDDEN) HP/ATK/DEF 1997/398/302
- backup (unowned): Raidian (char_614_acsupo) S3

**chess_char_5_13 归溟幽灵鲨** (Specter the Unchained, 6★ 特种·傀儡师) — 盟约 阿戈尔、不屈
- 特性: 受到致命伤时不撤退，切换成<替身>作战（替身阻挡数为0），持续20秒后自身再次替换<替身>
- 技能 S2 生存的渴望 [skchr_ghost2_2, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 攻击力+70%，攻击速度+22，技能持续期间内干员的生命值不会低于1 / 技能结束后视为被击倒
  - Lv7: 攻击力+100%，攻击速度+34，技能持续期间内干员的生命值不会低于1 / 技能结束后视为被击倒
- 天赋 (normal): 拥抱自我: <替身>使周围敌人移动速度-40%且每秒造成相当于40%攻击力的法术伤害; 阿戈尔的深邃: 编入队伍时，所有【深海猎人】干员的生命值+20%
- 模组 (golden, stage 1): “唱片”收藏箱 PUM-X — attr maxHp+200, atk+50; trait OVERRIDE: 受到致命伤时不撤退，切换成<替身>作战（替身阻挡数为0但攻击力提升），持续20秒后自身再次替换<替身>
- backup (unowned): Sharp (char_609_acguad) S3

**chess_char_5_14 凛御银灰** (SilverAsh the Reignfrost, 6★ 先锋·策士) — 盟约 谢拉格、投资人、迅捷
- 特性: 能够阻挡两个敌人，可以支援待部署区的我方单位
- 技能 S2 御敌的锋锐 [skchr_svash2_2, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 对前方6名敌人造成攻击力260%的物理伤害，使其4秒内寒冷且隐匿失效；待部署区中距离“风雪之眼”最近的1名干员费用-11（优先选择右侧近卫/术师/狙击干员）；使“风雪之眼”左侧所有干员部署时以自身攻击力施放一次本技能的范围效果（最多叠加2次） / 可充能2次
  - Lv7: 对前方6名敌人造成攻击力320%的物理伤害，使其5秒内寒冷且隐匿失效；待部署区中距离“风雪之眼”最近的1名干员费用-11（优先选择右侧近卫/术师/狙击干员）；使“风雪之眼”左侧所有干员部署时以自身攻击力施放一次本技能的范围效果（最多叠加2次） / 可充能2次
- 天赋 (normal): 开放性开局: 在场时向待部署区中加入“风雪之眼”，且会使待部署区按照部署费用排列。位于“风雪之眼”左侧的干员与自身初始技力+4，下次再部署时间-20%; 雪境先驱: 在场时，【谢拉格】干员免疫冻结，防御力+60且每秒回复1.5%最大生命值；在场15秒后防御力和生命回复效果翻倍
- 召唤物: token_10057_svash2_eagle1 风雪之眼 (HIDDEN) HP/ATK/DEF 100/100/0; token_10057_svash2_eagle2 风雪之眼 (HIDDEN) HP/ATK/DEF 100/100/0; token_10057_svash2_eagle3 风雪之眼 (HIDDEN) HP/ATK/DEF 100/100/0; token_10057_svash2_eagle (not in character_table)
- backup (unowned): 郁金香 (char_608_acpion) S3

**chess_char_5_15 引星棘刺** (Thorns the Lodestar, 6★ 特种·炼金师) — 盟约 迅捷、奇迹
- 特性: 可以投掷炼金单元协助作战
- 技能 S2 解构涌潮 [skchr_thorn2_2, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 投掷一个炼金单元，在12秒内使落点周围的地面敌人受到的治疗和回复效果降低50%，每秒受到相当于攻击力120%的法术伤害，友方单位每秒恢复相当于攻击力12%的生命；炼金单元能在12秒内缓慢沿投掷方向移动且影响范围持续扩大 / 可充能1次
  - Lv7: 投掷一个炼金单元，在15秒内使落点周围的地面敌人受到的治疗和回复效果降低50%，每秒受到相当于攻击力140%的法术伤害，友方单位每秒恢复相当于攻击力15%的生命；炼金单元能在15秒内缓慢沿投掷方向移动且影响范围持续扩大 / 可充能2次
- 天赋 (normal): 心相: 攻击力+10%，攻击范围内存在其他干员时，自身投掷的炼金单元持续时间延长3秒; 视界: 在场时，所有友方单位攻击速度+5，敌方单位攻击速度-5；位于连续6格或以上直线道路的友方和敌方单位受到的效果翻倍
- 模组 (golden, stage 1): 三面的金币 ALC-X — attr maxHp+80, atk+30; trait ADD: 场上存在炼金单元时，技力自然恢复速度+0.1/秒
- backup (unowned): 预备干员-狙击 (char_603_csnipe) S3

**chess_char_5_16 白面鸮** (Ptilopsis, 5★ 医疗·群愈师) — 盟约 助力、灵巧
- 特性: 同时恢复三个友方单位的生命
- 技能 S2 脑啡肽 [skchr_plosis_2, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 攻击范围扩大，攻击间隔较大幅度缩短
  - Lv7: 攻击范围扩大，攻击间隔大幅度缩短
- 天赋 (normal): 技力光环: 在场时所有友方单位的技力自然回复速度+0.3/秒（同类效果取最高）
- 模组 (golden, stage 1): 医疗环境分析装置 RIN-X — attr maxHp+60, atk+30; trait ADD: 攻击范围扩大

**chess_char_5_17 山** (Mountain, 6★ 近卫·斗士) — 盟约 投资人
- 特性: 能够阻挡一个敌人
- 技能 S2 横扫架势 [skchr_f12yin_2, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 可以在下列状态和初始状态间切换： / 防御力-30%，攻击距离缩短，攻击力+35%，阻挡数+1，同时攻击阻挡的所有敌人，每秒恢复最大生命的4.0%
  - Lv7: 可以在下列状态和初始状态间切换： / 防御力-25%，攻击距离缩短，攻击力+50%，阻挡数+1，同时攻击阻挡的所有敌人，每秒恢复最大生命的5.0%
- 天赋 (normal): 巨力重拳: 攻击时有20%的几率攻击力提升至160%，并在3秒内使目标攻击力降低15%（不可叠加）; 强壮肉体: 防御力+10%，获得15%的物理闪避
- 模组 (golden, stage 1): “自由的代价” FGT-Y — attr maxHp+160, atk+35, def+15; trait OVERRIDE: 能够阻挡一个敌人，生命值高于50%时攻击速度+10
- backup (unowned): Misery (char_615_acspec) S3

**chess_char_5_18 百炼嘉维尔** (Gavial the Invincible, 6★ 近卫·强攻手) — 盟约 萨尔贡
- 特性: 同时攻击阻挡的所有敌人
- 技能 S2 链锯强袭 [skchr_gvial2_2, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 攻击范围扩大，攻击力+110%，防御力+35%；攻击到未被阻挡的敌人时，将其中等力度地拖拽至面前
  - Lv7: 攻击范围扩大，攻击力+140%，防御力+40%；攻击到未被阻挡的敌人时，将其中等力度地拖拽至面前
- 天赋 (normal): 战地巨斧: 攻击力和防御力提升10%，每再阻挡一个敌人提升4%; 医学背景: 受到的治疗效果提升20%，生命值低于一半时提升至40%
- 模组 (golden, stage 1): 嘉维尔的折磨 CEN-X — attr maxHp+150, atk+45, def+23; trait OVERRIDE: 同时攻击阻挡的所有敌人，攻击被阻挡的敌人攻击力提升至110%
- backup (unowned): Stormeye (char_611_acnipe) S3

**chess_char_5_19 玛恩纳** (Młynar, 6★ 近卫·解放者) — 盟约 卡西米尔
- 特性: 通常不攻击且阻挡数为0，技能未开启时40秒内攻击力逐渐提升至最高+200%且技能结束时重置攻击力
- 技能 S3 未照耀的荣光 [skchr_mlynar_3, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 攻击范围扩大，特性提升至2倍（每击倒一名敌人时特性倍率-10%），攻击对5个目标造成相当于125%攻击力的物理伤害。范围内所有敌人受到卡西米尔干员攻击时额外附带玛恩纳10%攻击力的真实伤害
  - Lv7: 攻击范围扩大，特性提升至2倍（每击倒一名敌人时特性倍率-10%），攻击对5个目标造成相当于150%攻击力的物理伤害。范围内所有敌人受到卡西米尔干员攻击时额外附带玛恩纳11%攻击力的真实伤害
- 天赋 (normal): 游侠: 攻击敌人时攻击力提升至110%。周围存在3名及以上敌人时攻击力提升至115%且受到的伤害减少15%; 无动于衷: 在场时，自身更容易受到攻击，所有卡西米尔干员被攻击时反弹相当于玛恩纳攻击力15%的真实伤害
- 模组 (golden, stage 1): “鞘中人” LIB-X — attr maxHp+225, atk+18, attackSpeed+5; trait OVERRIDE: 通常不攻击且阻挡数为0，技能未开启时40秒内攻击力逐渐提升至最高+200%且技能结束时重置攻击力
- backup (unowned): 领主·Sharp (char_617_sharp2) S1

**chess_char_5_20 安洁莉娜** (Angelina, 6★ 辅助·凝滞师) — 盟约 叙拉古、奇迹
- 特性: 攻击造成法术伤害，并对敌人造成短暂的停顿
- 技能 S3 秘杖·反重力模式 [skchr_aglina_3, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 全场所有敌人失重，攻击范围扩大，攻击力+90%，可以攻击4个敌人 / 技能未开启时无法普通攻击
  - Lv7: 全场所有敌人失重，攻击范围扩大，攻击力+105%，可以攻击5个敌人 / 技能未开启时无法普通攻击
- 天赋 (normal): 加速力场: 全场友方单位攻速+7; 兼职工作: 技能未开启时，全场友方单位每秒回复20点生命
- 模组 (golden, stage 1): 重力校准模块 DEC-Y — attr maxHp+90, atk+35; trait OVERRIDE: 攻击造成法术伤害，并对敌人造成较长的停顿
- backup (unowned): Raidian (char_614_acsupo) S3

**chess_char_5_21 寒檀** (Santalla, 5★ 术师·扩散术师) — 盟约 远见
- 特性: 攻击造成群体法术伤害
- 特质 implementation entries (normal): garrison_141_a [SERVER_PREP_START/SERVER_ADD_BOND] <进入休整期时><休整期结束时>使已激活的【远见】层数+4; garrison_142_a [SERVER_PREP_FIN/SERVER_ADD_BOND] <休整期结束时>使已激活的【远见】层数+4
- 技能 S2 “女巫之泪” [skchr_sntlla_2, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 攻击范围扩大，攻击间隔超大幅度缩短，攻击变为向攻击范围内的随机地块召唤冰凌，冰凌落地后对周围所有敌人造成1秒寒冷和相当于寒檀攻击力65%的法术伤害
  - Lv7: 攻击范围扩大，攻击间隔超大幅度缩短，攻击变为向攻击范围内的随机地块召唤冰凌，冰凌落地后对周围所有敌人造成1秒寒冷和相当于寒檀攻击力75%的法术伤害
- 天赋 (normal): 生于冰寒: 在战场停留20秒后，攻击力+15%且获得抵抗
- 模组 (golden, stage 1): “冰焰” SPC-Y — attr cost+-8, maxHp+80, atk+40; trait ADD: 部署费用减少

**chess_char_5_23 录武官** (Record Keeper, 5★ 医疗·医师) — 盟约 炎、奇迹
- 特性: 恢复友方单位生命
- 技能 S2 一点关窍 [skchr_reckpr_2, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 攻击力+45%，治疗干员后为其施加一个增益，使其在10秒内每次受到伤害时恢复80点生命
  - Lv7: 攻击力+60%，治疗干员后为其施加一个增益，使其在10秒内每次受到伤害时恢复120点生命
- 天赋 (normal): 学成于聚: 攻击范围内的干员开启技能时自身回复1点技力，且攻击速度+16，持续8秒
- 模组 (golden, stage 1): 未完成的录武簿 PHY-X — attr maxHp+70, attackSpeed+4; trait ADD: 治疗生命值低于50%的友方单位时治疗量提升15%

### Tier 6

**chess_char_6_01 蕾缪安** (Lemuen, 6★ 狙击·神射手) — 盟约 拉特兰、精准
- 特性: 优先攻击攻击范围内防御力最低的敌方单位
- 技能 S3 礼炮·强制追思 [skchr_lemuen_3, MANUAL, INCREASE_WITH_TIME, durationType AMMO]
  - Lv4: 停止攻击，每0.5秒消耗1发子弹依次锁定敌人，技能结束时对每名被锁定的敌人所在位置进行轰炸，轰炸造成攻击力240%的范围物理伤害（中心伤害提升至攻击力的360%） / 攻击装有5发弹药，打完后结束（可随时停止技能）
  - Lv7: 停止攻击，每0.5秒消耗1发子弹依次锁定敌人，技能结束时对每名被锁定的敌人所在位置进行轰炸，轰炸造成攻击力270%的范围物理伤害（中心伤害提升至攻击力的390%） / 攻击装有5发弹药，打完后结束（可随时停止技能）
- 天赋 (normal): 跨境追缉许可: 精英或领袖敌人在拉特兰干员的攻击范围内停留超过8秒后被通缉，受到拉特兰干员的攻击时伤害提升15%，蕾缪安可以攻击到所有被通缉的目标; 逃犯引渡手续: 在场20秒后，攻击力+10%，自身弹药类技能弹药上限+1
- 天赋 (golden): 跨境追缉许可: 精英或领袖敌人在拉特兰干员的攻击范围内停留超过8秒后被通缉，受到拉特兰干员的攻击时伤害提升15%，蕾缪安可以攻击到所有被通缉的目标; 逃犯引渡手续 [mod]: 在场15秒后，攻击力+18%，自身弹药类技能弹药上限+2，其他拉特兰干员弹药类技能弹药上限+1
- 模组 (golden, stage 3): “弹匣与花窗” DEA-Y — attr maxHp+120, atk+120; trait ADD: 攻击的敌人未被击倒时自身额外获得1点技力
- backup (unowned): Stormeye (char_611_acnipe) S3

**chess_char_6_02 圣聆初雪** (Pramanix the Prerita, 6★ 术师·阵法术师) — 盟约 谢拉格、奥术
- 特性: 通常时不攻击且防御力和法术抗性大幅度提升，技能开启时攻击造成群体法术伤害
- 技能 S3 群山俯首 [skchr_sbell2_3, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 攻击范围扩大，立即诱导攻击范围内的所有敌人至自身周围的可达地面，持续10秒，积雪生成速度加快，攻击力+35%，攻击速度+30，攻击无视目标10点法术抗性，每次攻击造成相当于攻击力180%的法术伤害
  - Lv7: 攻击范围扩大，立即诱导攻击范围内的所有敌人至自身周围的可达地面，持续10秒，积雪生成速度加快，攻击力+70%，攻击速度+30，攻击无视目标10点法术抗性，每次攻击造成相当于攻击力210%的法术伤害
- 天赋 (normal): 无垠的雪景: 攻击范围内的地面每隔5.5秒产生一层积雪，地面敌人经过时立即受到相当于攻击力75%的法术伤害，每层积雪使经过的所有敌人移动速度下降12%，最多叠加5层（首个敌人离开该地块时积雪消失）; 圣山的祝福: 受到伤害时使敌人寒冷1.5秒，若受到致命伤害，仅一次立刻回复所有生命值并使自身冻结4秒，使攻击范围内所有敌方单位冻结8秒
- 天赋 (golden): 无垠的雪景 [mod]: 攻击范围内的地面每隔5秒产生一层积雪，地面敌人经过时立即受到相当于攻击力100%的法术伤害，每层积雪使经过的所有敌人移动速度下降12%，最多叠加5层（首个敌人离开该地块时积雪消失），部署后立刻使攻击范围内的地面产生一层积雪; 圣山的祝福: 受到伤害时使敌人寒冷1.5秒，若受到致命伤害，仅一次立刻回复所有生命值并使自身冻结4秒，使攻击范围内所有敌方单位冻结8秒
- 模组 (golden, stage 3): 千分之一的心 PLX-Y — attr atk+75, def+38; trait ADD: 范围内敌人越多造成的伤害越高（最高提升15%）
- 召唤物: token_10058_sbell2_icetgt 保护目标（冻结状态） (HIDDEN) HP/ATK/DEF 3500/100/800
- backup (unowned): 郁金香 (char_608_acpion) S3

**chess_char_6_03 余** (Yu, 6★ 重装·本源铁卫) — 盟约 炎、坚守
- 特性: 能够阻挡三个敌人，可以造成元素损伤
- 技能 S3 灶里乾坤 [skchr_yu_3, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 生命上限+50%，攻击力+50%，防御力+50%，将第二天赋效果赋予全场所有干员；生成一面跨越整个战场的火墙，其他友方穿过火墙造成法术伤害时附带相当于余攻击力6%的灼燃损伤，敌方子弹穿过火墙时有10%几率被清除
  - Lv7: 生命上限+80%，攻击力+80%，防御力+80%，将第二天赋效果赋予全场所有干员；生成一面跨越整个战场的火墙，其他友方穿过火墙造成法术伤害时附带相当于余攻击力7%的灼燃损伤，敌方子弹穿过火墙时有15%几率被清除
- 天赋 (normal): 礼尚往来: 阻挡敌人时自身获得25%的庇护，并使阻挡的目标每秒受到相当于攻击力40%的法术伤害和相当于攻击力12%的灼燃损伤; 闲云隐市: 场上干员数量不低于4时，自身每秒回复相当于生命上限1.5%的生命与元素损伤
- 天赋 (golden): 礼尚往来: 阻挡敌人时自身获得25%的庇护，并使阻挡的目标每秒受到相当于攻击力40%的法术伤害和相当于攻击力12%的灼燃损伤; 闲云隐市 [mod]: 场上干员数量不低于2时，自身每秒回复相当于生命上限1.5%的生命与元素损伤；不低于4时，自身对处于灼燃损伤爆发期间的目标造成的法术伤害提升14%
- 模组 (golden, stage 3): 人间百味 PRP-X — attr maxHp+400, atk+85; trait ADD: 阻挡敌人时，自身造成的元素损伤提升15%
- backup (unowned): Mechanist (char_610_acfend) S3

**chess_char_6_04 浊心斯卡蒂** (Skadi the Corrupting Heart, 6★ 辅助·吟游者) — 盟约 阿戈尔
- 特性: 不攻击，持续恢复范围内所有友军生命（每秒相当于自身攻击力10%的生命），自身不受鼓舞影响
- 技能 S3 "潮涌，潮枯" [skchr_skadi2_3, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 特性变为自身每秒流失5%生命，使范围内所有敌人每秒受到40%攻击力的真实伤害（自身与海嗣造成的伤害可叠加），范围内所有友方单位获得相当于浊心斯卡蒂65%攻击力的鼓舞效果
  - Lv7: 特性变为自身每秒流失5%生命，使范围内所有敌人每秒受到55%攻击力的真实伤害（自身与海嗣造成的伤害可叠加），范围内所有友方单位获得相当于浊心斯卡蒂80%攻击力的鼓舞效果
- 天赋 (normal): 远古血亲: 可以使用一个持续25秒的海嗣，海嗣的攻击范围视为自身攻击范围的延伸; 捕食习性: 自身或海嗣攻击范围内存在我方干员时，自身攻击力+6%；存在【深海猎人】干员时改为攻击力+15%
- 天赋 (golden): 远古血亲 [mod]: 可以使用一个持续30秒的海嗣，海嗣的攻击范围视为自身攻击范围的延伸，海嗣的再部署时间-5秒; 捕食习性: 自身或海嗣攻击范围内存在我方干员时，自身攻击力+6%；存在【深海猎人】干员时改为攻击力+15%
- 模组 (golden, stage 3): 蜕化的残迹 BAR-X — attr maxHp+130, atk+35, def+17; trait ADD: 攻击范围内存在2名及以上其他干员时，攻击力+8%（不受技能影响）
- 召唤物: token_10017_skadi2_dedant 斯卡蒂的海嗣 (DEFAULT) HP/ATK/DEF 100/100/0
- backup (unowned): Raidian (char_614_acsupo) S3

**chess_char_6_05 异客** (Passenger, 6★ 术师·链术师) — 盟约 萨尔贡、迅捷、精准
- 特性: 攻击造成法术伤害，且会在4个敌人间跳跃，每次跳跃伤害降低15%并造成短暂停顿
- 技能 S3 辉煌裂片 [skchr_pasngr_3, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 立即寻找大范围内生命值最高的目标，在其位置生成持续4秒的雷暴区域，期间每0.5秒以115%的攻击力对雷暴区域内的随机敌人进行一次额外攻击；可充能2次
  - Lv7: 立即寻找大范围内生命值最高的目标，在其位置生成持续4秒的雷暴区域，期间每0.5秒以130%的攻击力对雷暴区域内的随机敌人进行一次额外攻击；可充能2次
- 天赋 (normal): 机理分析: 攻击命中生命值在80%以上的敌人时，3秒内异客对其造成的伤害提升20%; 孤卒: 当周围4格没有敌人时，攻击力+8%
- 天赋 (golden): 机理分析: 攻击命中生命值在80%以上的敌人时，3秒内异客对其造成的伤害提升20%; 孤卒 [mod]: 当周围4格没有敌人时，攻击力+8%，技力自然回复速度+0.25/秒
- 模组 (golden, stage 3): 电磁调节器 CHA-X — attr atk+90, attackSpeed+5; trait OVERRIDE: 攻击造成法术伤害，且会在4个敌人间跳跃，每次跳跃伤害降低10%并造成一定时间停顿
- backup (unowned): Stormeye (char_611_acnipe) S3

**chess_char_6_06 佩佩** (Pepe, 6★ 近卫·撼地者) — 盟约 萨尔贡、不屈
- 特性: 攻击使目标周围的其他敌人受到相当于攻击力50%的群体物理伤害
- 技能 S3 时光震荡 [skchr_pepe_3, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 攻击间隔略微增大，攻击力+150%，攻击使命中的目标晕眩0.8秒，对主目标提升至1秒，每次攻击后使溅射范围扩大且攻击力额外+13%，最多叠加4层
  - Lv7: 攻击间隔略微增大，攻击力+180%，攻击使命中的目标晕眩0.8秒，对主目标提升至1.5秒，每次攻击后使溅射范围扩大且攻击力额外+16%，最多叠加4层
- 天赋 (normal): 往昔传承: 技能期间每击倒1名敌人，技能结束时获得1点技力，至多回复14点; 弥漫莲香: 在场时，所有【近卫】干员的攻击力+16%
- 天赋 (golden): 往昔传承 [mod]: 技能期间每击倒1名敌人，技能结束时获得2点技力，至多回复17点; 弥漫莲香: 在场时，所有【近卫】干员的攻击力+16%
- 模组 (golden, stage 3): 晴雨 HAM-X — attr maxHp+300, atk+113; trait ADD: 溅射范围内有大于或等于3个敌人时，使当次攻击力提升至115%
- backup (unowned): Sharp (char_609_acguad) S3

**chess_char_6_07 维娜·维多利亚** (Vina Victoria, 6★ 近卫·术战者) — 盟约 维多利亚、奇迹
- 特性: 攻击造成法术伤害
- 特质 implementation entries (normal): garrison_53_a [SERVER_PREP_FIN/SERVER_ADD_BOND_METHOD] <休整期结束时>场上每有1名不同阶的【维多利亚】/【奇迹】干员使已激活的【维多利亚】层数+3/【奇迹】层数+2; garrison_54_a [SERVER_PREP_FIN/SERVER_ADD_BOND_METHOD] <休整期结束时>场上每有1名不同阶的【维多利亚】/【奇迹】干员使已激活的【维多利亚】层数+3/【奇迹】层数+2
- 技能 S3 俱以我之名 [skchr_siege2_3, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 立即在天赋一生效范围内可部署地面召唤“黄金盟誓”；技能期间可攻击被天赋一生效范围友方单位阻挡的敌人，攻击力+145%，攻击目标数+1，攻击间隔缩短，攻击时伤害类型变为真实
  - Lv7: 立即在天赋一生效范围内可部署地面召唤“黄金盟誓”；技能期间可攻击被天赋一生效范围友方单位阻挡的敌人，攻击力+160%，攻击目标数+2，攻击间隔缩短，攻击时伤害类型变为真实
- 天赋 (normal): 诸王的叹息: 自身与周围8格友方单位受到的物理伤害减少20%，且此范围内每个友方单位使维娜攻击力+5%; 无拘的锋芒: 对每个敌人首次造成伤害时，使其战栗4秒
- 天赋 (golden): 诸王的叹息 [mod]: 自身与周围8格友方单位受到的物理伤害减少26%，且此范围内每个友方单位使维娜攻击力+7%; 无拘的锋芒: 对每个敌人首次造成伤害时，使其战栗4秒
- 模组 (golden, stage 3): 城主的冒险 AFT-X — attr maxHp+440, atk+56; trait ADD: 未阻挡敌人时攻击速度+8
- 召唤物: token_10040_siege2_vlion 黄金盟誓 (HIDDEN) HP/ATK/DEF 4000/425/270
- backup (unowned): 领主·Sharp (char_617_sharp2) S1

**chess_char_6_08 焰影苇草** (Reed The Flame Shadow, 6★ 医疗·咒愈师) — 盟约 维多利亚、精准
- 特性: 攻击造成法术伤害，攻击敌人时为攻击范围内一名友方干员治疗相当于50%伤害的生命值
- 技能 S3 生命火种 [skchr_reed2_3, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 同时攻击两名敌人，攻击力+25%，第一天赋触发几率提升至100%，技能期间附带灼痕效果的敌人每秒受到20%焰影苇草攻击力的法术伤害、被击倒时对周围敌人造成100%焰影苇草攻击力的法术伤害并施加灼痕效果 / 灼痕效果持续至技能结束
  - Lv7: 同时攻击两名敌人，攻击力+40%，第一天赋触发几率提升至100%，技能期间附带灼痕效果的敌人每秒受到30%焰影苇草攻击力的法术伤害、被击倒时对周围敌人造成110%焰影苇草攻击力的法术伤害并施加灼痕效果 / 灼痕效果持续至技能结束
- 天赋 (normal): 灼痕: 造成伤害时有30%概率对敌人施加灼痕效果：攻击力-20%、30%的【法术脆弱】，不可叠加持续6秒; 映耀: 治疗其他友方单位时，焰影苇草同时享受50%的治疗量
- 天赋 (golden): 灼痕: 造成伤害时有30%概率对敌人施加灼痕效果：攻击力-20%、30%的【法术脆弱】，不可叠加持续6秒; 映耀 [mod]: 治疗其他友方单位时治疗效果提升5%，焰影苇草同时享受60%的治疗量
- 模组 (golden, stage 3): “赠予红龙的花冠” INC-X — attr maxHp+160, atk+50; trait OVERRIDE: 攻击造成法术伤害，攻击敌人时为攻击范围内一名友方干员治疗相当于60%伤害的生命值
- backup (unowned): Pith (char_612_accast) S3

**chess_char_6_09 塑心** (Virtuosa, 6★ 辅助·巫役) — 盟约 拉特兰
- 特性: 攻击造成法术伤害，可以造成元素损伤
- 技能 S1 “黄金的狂喜” [skchr_cello_1, AUTO, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 对一个未处于损伤爆发期间的敌人造成相当于攻击力210%的法术伤害并附带85%攻击力的凋亡损伤 / 可充能2次，技能未开启时无法普通攻击
  - Lv7: 对一个未处于损伤爆发期间的敌人造成相当于攻击力240%的法术伤害并附带95%攻击力的凋亡损伤 / 可充能2次，技能未开启时无法普通攻击
- 天赋 (normal): 无词哀歌: 使攻击范围内敌人每秒受到相当于攻击力10%的凋亡损伤并停顿0.2秒; 精神逆构: 使攻击范围内敌人受到的凋亡损伤提高20%
- 天赋 (golden): 无词哀歌: 使攻击范围内敌人每秒受到相当于攻击力10%的凋亡损伤并停顿0.2秒; 精神逆构 [mod]: 使攻击范围内敌人受到的凋亡损伤提高33%，凋亡损伤爆发期间受到5%的元素脆弱
- 模组 (golden, stage 3): 强弱法 RIT-X — attr maxHp+210, atk+40; trait ADD: 对精英和领袖敌人造成的元素损伤提升18%
- backup (unowned): Touch (char_613_acmedc) S3

**chess_char_6_10 妮芙** (Nymph, 6★ 术师·本源术师) — 盟约 迅捷
- 特性: 攻击造成法术伤害，可以造成元素伤害
- 技能 S2 怵然震爆 [skchr_nymph_2, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 对敌人造成一次相当于攻击力270%的法术伤害、使其恐惧4秒，并对目标周围造成一次等额法术溅射伤害，均附带造成法术伤害18%的凋亡损伤；若攻击到的单位处于凋亡损伤爆发期间，使第一天赋造成的伤害效果提高至攻击力的70% / 可充能1次
  - Lv7: 对敌人造成一次相当于攻击力300%的法术伤害、使其恐惧5秒，并对目标周围造成一次等额法术溅射伤害，均附带造成法术伤害22%的凋亡损伤；若攻击到的单位处于凋亡损伤爆发期间，使第一天赋造成的伤害效果提高至攻击力的85% / 可充能2次
- 天赋 (normal): 失魂: 攻击处于凋亡损伤爆发期间的敌人时使其每秒受到相当于攻击力40%的元素伤害，持续至凋亡损伤爆发结束; 窥心钥: 每当自身攻击范围内敌人凋亡损伤爆发，攻击力+2%，最多可叠加10层
- 天赋 (golden): 失魂: 攻击处于凋亡损伤爆发期间的敌人时使其每秒受到相当于攻击力40%的元素伤害，持续至凋亡损伤爆发结束; 窥心钥 [mod]: 全场有敌人凋亡损伤爆发时，攻击力+3%，最多可叠加10层，叠至10层后，攻击速度+12
- 模组 (golden, stage 3): 心声 PRI-X — attr maxHp+150, atk+80; trait ADD: 对处于元素爆发期间的敌人造成的伤害提升至110%
- backup (unowned): 领主·Sharp (char_617_sharp2) S1

**chess_char_6_11 缪尔赛思** (Muelsyse, 6★ 先锋·战术家) — 盟约 调和
- 特性: 可以在攻击范围内选择一次战术点来召唤援军，自身攻击援军阻挡的敌人时攻击力提升至150%
- 技能 S3 浅层非熵适应 [skchr_mlyss_3, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 立即获得13点费用，自身与流形攻击力+22%，若流形为近战复制体时每2秒对周围八格敌人向自己中心小力度地拖拽并使所有阻挡的单位持续晕眩，若为远程复制体时刷新所有流形且攻击附带持续1.5秒的束缚
  - Lv7: 立即获得14点费用，自身与流形攻击力+35%，若流形为近战复制体时每2秒对周围八格敌人向自己中心小力度地拖拽并使所有阻挡的单位持续晕眩，若为远程复制体时刷新所有流形且攻击附带持续1.5秒的束缚
- 天赋 (normal): 净水即生命: 可召唤流形来复制待部署干员的大部分属性（生命上限、攻击、防御、法抗、阻挡数、攻击间隔、攻击范围、伤害类型、根据近/远程位获得特殊特性）协助作战，其被击败后会在25秒后自动刷新; 开源节流: 携带时【莱茵生命】干员部署费用-2，首名【莱茵生命】干员部署费用额外-1
- 天赋 (golden): 净水即生命 [mod]: 可召唤流形来复制待部署干员的全部属性（生命上限、攻击、防御、法抗、阻挡数、攻击间隔、攻击范围、伤害类型、根据近/远程位获得特殊特性）协助作战，首次部署后立即获得5点技力，其被击败后会在25秒后自动刷新; 开源节流: 携带时【莱茵生命】干员部署费用-2，首名【莱茵生命】干员部署费用额外-1
- 模组 (golden, stage 3): 梳妆流形 TAC-X — attr maxHp+190, atk+25, def+30; trait OVERRIDE: 可以在攻击范围内选择一次战术点来召唤援军，援军受到来自自身阻挡单位的伤害降低15%，自身攻击援军阻挡的敌人时攻击力提升至150%
- 召唤物: token_10030_mlyss_wtrman 流形 (DEFAULT) HP/ATK/DEF 1600/247/210
- backup (unowned): 郁金香 (char_608_acpion) S3

**chess_char_6_12 迷迭香** (Rosmontis, 6★ 狙击·投掷手) — 盟约 精准、远见、协防干员
- 特性: 攻击对小范围的地面敌人造成两次物理伤害（第二次为余震，伤害降低至攻击力的一半）
- 特质 implementation entries (normal): garrison_09_a [IN_BATTLE/GAIN_BUFF] 攻击力和生命值+20%；核心盟约每叠加3层，本干员攻击力和生命值+1%; garrison_03_a [IN_BATTLE/GAIN_BUFF] 攻击力和生命值+20%
- 技能 S2 末梢阻断 [skchr_rosmon_2, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 攻击间隔增大，攻击力+20%，溅射范围扩大，每次攻击额外造成2次余震；受到攻击和余震的目标有20%的几率晕眩0.9秒
  - Lv7: 攻击间隔增大，攻击力+30%，溅射范围扩大，每次攻击额外造成2次余震；受到攻击和余震的目标有20%的几率晕眩1.1秒
- 天赋 (normal): 歼灭战装备: 攻击无视目标160防御力; 感知稳定: 部署后随机选择一名在场的【术师】干员，自身和其的攻击力+8%
- 天赋 (golden): 歼灭战装备 [mod]: 攻击无视目标220防御力; 感知稳定: 部署后随机选择一名在场的【术师】干员，自身和其的攻击力+8%
- 模组 (golden, stage 3): “记事” BOM-X — attr maxHp+275, atk+75; trait OVERRIDE: 攻击对小范围的地面敌人造成三次物理伤害（后两次为余震，伤害降低至攻击力的50％）
- 召唤物: token_10012_rosmon_shield 迷迭香的战术装备 (HIDDEN) HP/ATK/DEF 5000/82/468
- backup (unowned): Pith (char_612_accast) S3

**chess_char_6_13 新约能天使** (Exusiai the New Covenant, 6★ 特种·怪杰) — 盟约 拉特兰
- 特性: 自身生命会不断流失
- 技能 S2 开火成瘾症 [skchr_angel2_2, MANUAL, INCREASE_WITH_TIME, durationType AMMO]
  - Lv4: 立即偷取攻击范围内1名友方干员70点攻击速度（持续至技能结束或新约能天使离场），自身与其获得最大生命值180%的屏障，该屏障会持续衰减，攻击间隔降低，每次攻击造成攻击力230%的物理伤害 / 攻击装有35发弹药，打完后结束（可随时停止技能），如果成功偷取攻击速度则额外获得5发弹药
  - Lv7: 立即偷取攻击范围内1名友方干员70点攻击速度（持续至技能结束或新约能天使离场），自身与其获得最大生命值200%的屏障，该屏障会持续衰减，攻击间隔降低，每次攻击造成攻击力270%的物理伤害 / 攻击装有35发弹药，打完后结束（可随时停止技能），如果成功偷取攻击速度则额外获得5发弹药
- 天赋 (normal): 火力电台: 在场时，每当有友方干员的弹药被消耗就会回复自身6%生命值，并有25%概率立即对该干员攻击范围的敌人召唤一次轰炸，造成相当于自身攻击力150%的物理溅射伤害; 铳弹协约: 在场时，携带弹药类技能的干员攻击力+9%，对【拉特兰】干员的效果翻倍
- 天赋 (golden): 火力电台 [mod]: 在场时，每当有友方干员的弹药被消耗就会回复自身6%生命值，并有35%概率立即对该干员攻击范围的敌人召唤一次轰炸，造成相当于自身攻击力185%的物理溅射伤害; 铳弹协约: 在场时，携带弹药类技能的干员攻击力+9%，对【拉特兰】干员的效果翻倍
- 模组 (golden, stage 3): 新朋友圣城生活套组 GEE-X — attr maxHp+210, atk+65; trait ADD: 生命值高于80%时，技力自然回复速度+0.25/秒
- 召唤物: token_10056_angel2_target 投递坐标 (HIDDEN) HP/ATK/DEF 2370/0/0
- backup (unowned): Misery (char_615_acspec) S3

**chess_char_6_14 流明** (Lumen, 6★ 医疗·疗养师) — 盟约 助力
- 特性: 拥有较大治疗范围，但在治疗较远目标时治疗量变为80%
- 技能 S3 灯火不灭 [skchr_lumen_3, MANUAL, INCREASE_WITH_TIME, durationType AMMO]
  - Lv4: 攻击力+30%，攻击速度+20，优先治疗处于异常状态中的单位；只在治疗异常状态中的单位时会消耗子弹，使该次治疗量提升至攻击力的135%并解除目标所受的异常状态 / 攻击装有4发子弹，打完后技能结束（期间可随时停止技能）
  - Lv7: 攻击力+40%，攻击速度+20，优先治疗处于异常状态中的单位；只在治疗异常状态中的单位时会消耗子弹，使该次治疗量提升至攻击力的150%并解除目标所受的异常状态 / 攻击装有6发子弹，打完后技能结束（期间可随时停止技能）
- 天赋 (normal): 凡人之愿: 治疗的目标获得4秒抵抗，若目标生命值高于75%则改为6秒抵抗; 应急处理: 攻击范围内的友方受到异常状态时，立刻治疗目标相当于流明攻击力80%的生命，该效果有12秒冷却时间
- 天赋 (golden): 凡人之愿 [mod]: 治疗的目标获得5秒抵抗，若目标生命值高于75%则改为8秒抵抗; 应急处理: 攻击范围内的友方受到异常状态时，立刻治疗目标相当于流明攻击力80%的生命，该效果有12秒冷却时间
- 模组 (golden, stage 3): 纯铜单筒望远镜 WAH-X — attr maxHp+160, atk+45; trait ADD: 自身获得抵抗且更不容易受到敌人的攻击

**chess_char_6_15 仇白** (Qiubai, 6★ 近卫·领主) — 盟约 炎、突袭
- 特性: 可以进行远程攻击，但此时攻击力降低至80%
- 技能 S3 问雪 [skchr_qiubai_3, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 攻击范围扩大，攻击力+30%，伤害类型变为法术，额外攻击2个目标，远程攻击不再降低伤害，每次攻击使自身攻击速度+10（最多叠加5次）
  - Lv7: 攻击范围扩大，攻击力+40%，伤害类型变为法术，额外攻击2个目标，远程攻击不再降低伤害，每次攻击使自身攻击速度+13（最多叠加6次）
- 天赋 (normal): 入隙: 攻击处于停顿、束缚的敌人时，额外造成相当于攻击力40%的法术伤害; 落英: 攻击时有20%的几率使目标束缚1.5秒
- 天赋 (golden): 入隙 [mod]: 攻击处于停顿、束缚的敌人时，额外造成相当于攻击力45%的法术伤害，目标同时处于停顿和束缚时该伤害提升至原本的1.2倍; 落英: 攻击时有20%的几率使目标束缚1.5秒
- 模组 (golden, stage 3): 雪浸过的斗笠 LOR-X — attr atk+55, def+45, attackSpeed+7; trait ADD: 攻击附带10%攻击力的法术伤害
- backup (unowned): Raidian (char_614_acsupo) S3

**chess_char_6_16 溯光星源** (Astgenne the Lightchaser, 6★ 辅助·凝滞师) — 盟约 奥术、灵巧
- 特性: 攻击造成法术伤害，并对敌人造成短暂的停顿
- 技能 S3 并流连锁 [skchr_halo2_3, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 攻击范围扩大，攻击力+35%，攻击间隔缩短，持续锁定2个敌人进行攻击，被锁定的敌人会互相链接；每个被链接的敌人会把即将受到法术伤害的15%额外传导给其他链接目标
  - Lv7: 攻击范围扩大，攻击力+50%，攻击间隔缩短，持续锁定2个敌人进行攻击，被锁定的敌人会互相链接；每个被链接的敌人会把即将受到法术伤害的20%额外传导给其他链接目标
- 天赋 (normal): 数据建模: 对敌人造成停顿效果时，自身的攻击速度+1，最多叠加18次; 能源解析: 攻击范围内的敌人受到10%的脆弱效果，敌人在溯光星源的攻击范围内停留超过7秒后，脆弱效果提升至14%
- 天赋 (golden): 数据建模 [mod]: 对敌人造成停顿效果时，使自身的攻击速度+1，最多叠加25次；叠满后使自身攻击力+12%; 能源解析: 攻击范围内的敌人受到10%的脆弱效果，敌人在溯光星源的攻击范围内停留超过7秒后，脆弱效果提升至14%; 数据建模 [mod]: 
- 模组 (golden, stage 3): 探索者的收藏 DEC-Y — attr maxHp+115, atk+50; trait OVERRIDE: 攻击造成法术伤害，并对敌人造成较长的停顿

**chess_char_6_17 耀骑士临光** (Nearl the Radiant Knight, 6★ 近卫·无畏者) — 盟约 卡西米尔、突袭
- 特性: 能够阻挡一个敌人
- 特质 implementation entries (normal): garrison_145_a [IN_BATTLE/ADD_BOND] <战斗开始时>使自身和身前一格干员获得特质“【卡西米尔】每叠加3层，本干员再部署时间-1.5%，攻击速度+0.5”; garrison_144_a [IN_BATTLE/GAIN_BUFF] 【145】【卡西米尔】每叠加3层，本干员再部署时间-1.5%，攻击速度+0.5; garrison_159_a [IN_BATTLE/GAIN_BUFF] 【145】【卡西米尔】每叠加3层，本干员攻击速度+0.5; garrison_160_a [IN_BATTLE/ADD_BOND] 【145】<战斗开始时>使自身和身前一格干员获得特质“【卡西米尔】每叠加3层，攻击速度+0.5”
- 技能 S3 耀阳颔首 [skchr_nearl2_3, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 在周围四格可部署地面召唤一把"耀阳"对周围敌人造成90%耀骑士临光攻击力的真实伤害并晕眩3秒，自身攻击范围扩大，攻击力+70%、防御力+40%，攻击自身与"耀阳"阻挡的单位时伤害类型变为真实
  - Lv7: 在周围四格可部署地面召唤一把"耀阳"对周围敌人造成100%耀骑士临光攻击力的真实伤害并晕眩3秒，自身攻击范围扩大，攻击力+100%、防御力+70%，攻击自身与"耀阳"阻挡的单位时伤害类型变为真实
- 天赋 (normal): 不畏苦暗: 部署时对周围四格敌人造成80%攻击力的真实伤害并晕眩3秒，上一名部署干员势力为【卡西米尔】时额外造成一次伤害; 破晓: 攻击无视敌人20%的防御力
- 天赋 (golden): 不畏苦暗: 部署时对周围四格敌人造成80%攻击力的真实伤害并晕眩3秒，上一名部署干员势力为【卡西米尔】时额外造成一次伤害; 破晓 [mod]: 攻击无视敌人28%的防御力
- 模组 (golden, stage 3): 耀阳锋刃 DRE-X — attr maxHp+330, atk+105; trait ADD: 攻击被阻挡的敌人时攻击力提升至115%
- 召唤物: token_10019_nearl2_sword “耀阳” (HIDDEN) HP/ATK/DEF 6000/10/540
- backup (unowned): 郁金香 (char_608_acpion) S3

**chess_char_6_18 荒芜拉普兰德** (Lappland the Decadenza, 6★ 术师·驭械术师) — 盟约 叙拉古
- 特性: 操作浮游单元造成法术伤害 / 单元攻击同一敌人伤害提升（最高造成干员110%攻击力的伤害）
- 技能 S3 终幕·浩劫 [skchr_whitw2_3, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 浮游单元+2，攻击力+45%，释放特殊形态的浮游单元散开后在整个战场范围各自追逐较近的敌人，追上时使目标恐惧2秒并锁定其攻击，浮游单元周围的敌人移动速度-30%且每秒受到相当于攻击力100%的法术伤害（不叠加）；浮游单元在锁定目标倒下后重新索敌，直至技能结束后返回干员身边
  - Lv7: 浮游单元+2，攻击力+60%，释放特殊形态的浮游单元散开后在整个战场范围各自追逐较近的敌人，追上时使目标恐惧2秒并锁定其攻击，浮游单元周围的敌人移动速度-40%且每秒受到相当于攻击力100%的法术伤害（不叠加）；浮游单元在锁定目标倒下后重新索敌，直至技能结束后返回干员身边
- 天赋 (normal): 头狼: 每在场上停留20秒，浮游单元依次获得以下一个效果：伤害上限提高10%、造成伤害时使目标特殊能力失效2秒、数量+1; 叙拉古的荣幸: 编入队伍时所有【叙拉古】干员的初始技力+5
- 天赋 (golden): 头狼: 每在场上停留20秒，浮游单元依次获得以下一个效果：伤害上限提高10%、造成伤害时使目标特殊能力失效2秒、数量+1; 叙拉古的荣幸 [mod]: 编入队伍时所有【叙拉古】干员的初始技力+5，且首次触发技能后攻击速度+10
- 模组 (golden, stage 3): 狼时 FUN-X — attr maxHp+160, atk+33; trait OVERRIDE: 操作浮游单元造成法术伤害 / 单元攻击同一敌人伤害提升（单元初始伤害提高，最高造成干员110%攻击力的伤害）
- backup (unowned): Pith (char_612_accast) S3

**chess_char_6_19 锏** (Degenbrecher, 6★ 近卫·剑豪) — 盟约 谢拉格、卡西米尔、迅捷
- 特性: 普通攻击连续造成两次伤害
- 特质 implementation entries (normal): garrison_155_a [IN_BATTLE/ADD_BOND] <获得时>自身所属的盟约层数+8 / <部署时>使自身已激活的盟约层数+8（至多24层）; garrison_65_a [SERVER_GAIN/SERVER_ADD_BOND_CHESS_ALL] <获得时>自身所属盟约层数+8（无需激活盟约）
- 技能 S3 归于宁静 [skchr_blkkgt_3, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 持续发动总计10次斩击，每次斩击对最多5名敌人造成相当于攻击力180%的物理伤害，天赋的发动概率提升至100%，并持续将敌人中等力度地拖拽至自身中心，之后将造成一次相当于攻击力300%的物理伤害并将敌人较大力地拖拽至自身中心
  - Lv7: 持续发动总计10次斩击，每次斩击对最多6名敌人造成相当于攻击力200%的物理伤害，天赋的发动概率提升至100%，并持续将敌人中等力度地拖拽至自身中心，之后将造成一次相当于攻击力300%的物理伤害并将敌人较大力地拖拽至自身中心
- 天赋 (normal): “天生的武者”: 造成伤害时有10%的几率攻击力提升至160%，并使目标战栗5秒; 活着的传奇: 攻击被战栗的目标时，无视目标25%的防御力
- 天赋 (golden): “天生的武者” [mod]: 造成伤害时有10%的几率攻击力提升至170%，并使目标战栗5秒; 活着的传奇: 攻击被战栗的目标时，无视目标25%的防御力
- 模组 (golden, stage 3): “过往的注脚” SWO-X — attr maxHp+120, atk+50, def+50; trait ADD: 技能造成的伤害提升10%
- backup (unowned): Misery (char_615_acspec) S3

**chess_char_6_20 纯烬艾雅法拉** (Eyjafjalla the Hvít Aska, 6★ 医疗·行医) — 盟约 助力
- 特性: 恢复友方单位生命，并回复相当于攻击力50%的元素损伤（可以回复未受伤友方单位的元素损伤）
- 技能 S3 火山回响 [skchr_agoat2_3, MANUAL, INCREASE_WITH_TIME, durationType NONE]
  - Lv4: 攻击范围扩大至整个战场，治疗变为35%治疗量和元素损伤回复量的5连发，优先治疗不同的目标，第二天赋的效果提升至2.9倍
  - Lv7: 攻击范围扩大至整个战场，治疗变为45%治疗量和元素损伤回复量的5连发，优先治疗不同的目标，第二天赋的效果提升至3.8倍
- 天赋 (normal): 氤氲: 普通治疗使目标每秒额外受到一次治疗量和元素损伤回复量为10%的增益治疗，持续6秒（最多叠加3层）; 火山灰疗愈: 攻击范围内的友方单位生命上限+6%，且受到的元素损伤降低12%
- 天赋 (golden): 氤氲: 普通治疗使目标每秒额外受到一次治疗量和元素损伤回复量为10%的增益治疗，持续6秒（最多叠加3层）; 火山灰疗愈 [mod]: 攻击范围内的友方单位生命上限+8%，且受到的元素损伤降低14%
- 模组 (golden, stage 3): 想要留住的声音 WDM-X — attr maxHp+140, atk+44; trait OVERRIDE: 恢复友方单位生命，并回复相当于攻击力60%的元素损伤（可以回复未受伤友方单位的元素损伤）
- backup (unowned): Touch (char_613_acmedc) S3

## 4. Tokens / summons

`autoChessData.shopStateTokenDict` lists 55 tokens supported by the autochess mode (`DEFAULT` = shown as a piece on the board during prep; `HIDDEN` = exists only in battle / not shown). Tokens reachable from the current pool:

| tokenId | name | displayType | owner chess | note |
|---|---|---|---|---|
| token_10000_silent_healrb | 医疗探机 | DEFAULT | chess_char_2_02 (赫默) | 不会受到攻击，恢复周围友方单位的生命 |
| token_10022_kazema_shadow | 纸偶 | HIDDEN | chess_char_2_11 (风丸) | 不阻挡敌人 |
| token_10031_swire2_gdtrap | 香槟炸弹 | HIDDEN | chess_char_3_04 (琳琅诗怀雅) |  |
| token_10006_vodfox_doll | 诅咒娃娃 | DEFAULT | chess_char_3_15 (巫恋) | 不会受到攻击 |
| token_10028_vigil_wolf | 狼群 | DEFAULT | chess_char_3_19 (伺夜) | 只能部署在召唤者攻击范围内 |
| token_10011_beewax_oblisk | 沙之碑 | HIDDEN | chess_char_4_05 (蜜蜡) | 能够阻挡三个敌人 |
| token_10041_cathy_catsld | 爬行号·防护单元 | not listed | chess_char_4_11 (凯瑟琳) | 不会受到攻击 |
| token_10039_ulpia_block | 从不混淆的方向 | HIDDEN | chess_char_5_05 (乌尔比安) | 乌尔比安技能结束时返回该位置，并且其他干员不能部署 |
| token_10015_dusk_drgn | “小自在” | HIDDEN | chess_char_5_12 (夕) | 攻击造成法术伤害 |
| token_10057_svash2_eagle1 | 风雪之眼 | HIDDEN | chess_char_5_14 (凛御银灰) | 凛御银灰在场时添加至待部署区。部署费用随凛御银灰的技能而变化 |
| token_10057_svash2_eagle2 | 风雪之眼 | HIDDEN | chess_char_5_14 (凛御银灰) | 凛御银灰在场时添加至待部署区。部署费用随凛御银灰的技能而变化 |
| token_10057_svash2_eagle3 | 风雪之眼 | HIDDEN | chess_char_5_14 (凛御银灰) | 凛御银灰在场时添加至待部署区。部署费用随凛御银灰的技能而变化 |
| token_10057_svash2_eagle | (missing in character_table; container id) | not listed | chess_char_5_14 (凛御银灰) |  |
| token_10058_sbell2_icetgt | 保护目标（冻结状态） | HIDDEN | chess_char_6_02 (圣聆初雪) | 能够阻挡三个敌人 |
| token_10017_skadi2_dedant | 斯卡蒂的海嗣 | DEFAULT | chess_char_6_04 (浊心斯卡蒂) | 不会受到攻击 |
| token_10040_siege2_vlion | 黄金盟誓 | HIDDEN | chess_char_6_07 (维娜·维多利亚) | 能够阻挡一个敌人，攻击造成真实伤害 |
| token_10030_mlyss_wtrman | 流形 | DEFAULT | chess_char_6_11 (缪尔赛思) | 初始攻击造成法术伤害，只能部署在召唤者攻击范围内 |
| token_10012_rosmon_shield | 迷迭香的战术装备 | HIDDEN | chess_char_6_12 (迷迭香) | 能够阻挡两个敌人，降低被阻挡单位的防御力 |
| token_10056_angel2_target | 投递坐标 | HIDDEN | chess_char_6_13 (新约能天使) | 不会受到攻击 |
| token_10019_nearl2_sword | “耀阳” | HIDDEN | chess_char_6_17 (耀骑士临光) | 能够阻挡两个敌人 |

Token stats are computed at the owner's phase/level (token keyframes, clamped to the token phase maxLevel) + module `tokenAttributeBlackboard` on golden; see `chess[].tokens[].stats` in JSON. Other tokens in shopStateTokenDict (not in current pool, kept for completeness): token_10001_deepcl_tentac 触手, token_10002_kalts_mon3tr Mon3tr, token_10003_cgbird_bird 幻影, token_10004_otter_motter 机械水獭, token_10036_lasher_mcbird 发条羽兽, token_10005_mgllan_drone1 龙腾.F, token_10005_mgllan_drone2 龙腾.L, token_10005_mgllan_drone3 龙腾.A, token_10007_phatom_twin 镜中虚影, token_10008_cqbw_box 此面向敌, token_10009_weedy_cannon 工程蓄水炮, token_10010_folivo_car 移动摄影器, token_10013_robin_mine “夹子”, token_10014_bstalk_crab 磐蟹护卫队, token_10016_rfrost_mine 迎宾踏垫, token_10018_robrta_mach 全自动造型仪, token_10020_ling_soul1 “清平”, token_10020_ling_soul2 “逍遥”, token_10020_ling_soul3 “弦惊”, token_10021_blkngt_hypnos 眠兽, token_10023_windft_wrench 可靠电池, token_10024_ebnhlz_rcube 旧日残影, token_10025_doroth_recttp 共振装置, token_10026_bgsnow_subbow “打字机”, token_10027_ironmn_pile1 白铁™多功能平台, token_10027_ironmn_pile2 白铁™多功能平台, token_10027_ironmn_pile3 铁钳号·原型机, token_10029_slent2_protrb 夜灯, token_10032_jesca2_jckshd 机动盾牌, token_10034_ray_sndbst 沙地兽, token_10033_ela_grzmot 雷鸣地雷, token_10035_wisdel_wward 魂灵之影, token_10037_mitm_trshrb 樱桃三号, token_10042_tecno_puppet 木偶舞者, token_10043_necras_skeltn 悲叹的仆役, token_10055_phatm2_mndclv 迷狂牢笼, token_10065_demetr_dmtpos 牵绊.

## 5. Distribution

### 5.1 Per tier

| Tier | total shop entries | visible | hidden | DIY | PRESET | NORMAL |
|---|---|---|---|---|---|---|
| 1 | 20 | 16 | 4 | 0 | 20 | 0 |
| 2 | 19 | 17 | 2 | 0 | 19 | 0 |
| 3 | 21 | 19 | 2 | 0 | 15 | 6 |
| 4 | 26 | 22 | 4 | 0 | 13 | 13 |
| 5 | 25 | 19 | 4 | 2 | 5 | 18 |
| 6 | 22 | 19 | 1 | 2 | 2 | 18 |
| all | 133 | 112 | 17 | 4 | 74 | 55 |

### 5.2 Per profession x tier (non-DIY, incl. hidden; visible count in parentheses)

| 职业 | T1 | T2 | T3 | T4 | T5 | T6 | total |
|---|---|---|---|---|---|---|---|
| 先锋 PIONEER | 3 (2) | 0 (0) | 2 (2) | 3 (3) | 1 (1) | 1 (1) | 10 (9) |
| 近卫 WARRIOR | 2 (2) | 3 (3) | 3 (3) | 2 (2) | 7 (6) | 5 (5) | 22 (21) |
| 重装 TANK | 4 (4) | 3 (3) | 3 (3) | 3 (3) | 2 (2) | 1 (1) | 16 (16) |
| 狙击 SNIPER | 3 (3) | 1 (1) | 5 (5) | 2 (2) | 0 (0) | 2 (2) | 13 (13) |
| 术师 CASTER | 3 (3) | 2 (1) | 3 (3) | 6 (4) | 4 (4) | 4 (3) | 22 (18) |
| 医疗 MEDIC | 1 (1) | 4 (4) | 0 (0) | 4 (2) | 4 (2) | 3 (3) | 16 (12) |
| 辅助 SUPPORT | 3 (1) | 1 (1) | 3 (2) | 3 (3) | 3 (2) | 3 (3) | 16 (12) |
| 特种 SPECIAL | 1 (0) | 5 (4) | 2 (1) | 3 (3) | 2 (2) | 1 (1) | 14 (11) |

### 5.3 Per rarity x tier (non-DIY)

| ★ | T1 | T2 | T3 | T4 | T5 | T6 |
|---|---|---|---|---|---|---|
| 4 | 11 | 5 | 3 | 0 | 0 | 0 |
| 5 | 9 | 14 | 11 | 10 | 4 | 0 |
| 6 | 0 | 0 | 7 | 16 | 19 | 20 |

### 5.4 Per bond (盟约) — members by tier (H = hidden)

| bondId | 名称 | count (visible) | T1 | T2 | T3 | T4 | T5 | T6 |
|---|---|---|---|---|---|---|---|---|
| yanShip | 炎 | 11 (10) | 惊蛰 | 小满 | 诗怀雅、琳琅诗怀雅 | 录武官(H)、星熊 | 烛煌、夕、录武官 | 余、仇白 |
| sargonShip | 萨尔贡 | 12 (10) | 艾丝黛尔 | 莎草、泡泡 | 菲莱、至简 | 蜜蜡(H)、百炼嘉维尔、卡涅利安 | 缇缇、百炼嘉维尔(H) | 异客、佩佩 |
| victoriaShip | 维多利亚 | 10 (10) | 刺玫 | 哈洛德、洛洛 | 薄绿 | 风笛、凯瑟琳 | 烛煌、号角 | 维娜·维多利亚、焰影苇草 |
| kjeragShip | 谢拉格 | 12 (10) | 角峰 | 崖心(H)、哈洛德 | 雪猎、初雪、耶拉 | 耶拉(H)、灵知、银灰 | 凛御银灰 | 圣聆初雪、锏 |
| lateranoShip | 拉特兰 | 11 (10) | 隐现 | 送葬人 | 能天使、见行者(H)、空弦 | 信仰搅拌机、莫斯提马 | 圣约送葬人 | 蕾缪安、塑心、新约能天使 |
| egirShip | 阿戈尔 | 9 (9) | 深巡 | 幽灵鲨 | 斯卡蒂、海霓 | 水月、歌蕾蒂娅 | 乌尔比安、归溟幽灵鲨 | 浊心斯卡蒂 |
| siracusaShip | 叙拉古 | 11 (10) | 普罗旺斯、德克萨斯 | 拉普兰德 | 巫恋(H)、忍冬、伺夜 | 阿罗玛、缄默德克萨斯 | 铃兰、安洁莉娜 | 荒芜拉普兰德 |
| kazimierzShip | 卡西米尔 | 10 (10) | 野鬃 | 砾、灰毫 | 瑕光、流星 | 焰尾、远牙 | 玛恩纳 | 耀骑士临光、锏 |
| preciShip | 精准 | 12 (12) | 跃跃、深靛 | 送葬人 | 雪猎 | 寒芒克洛丝、莱恩哈特、远牙 | 缇缇 | 蕾缪安、异客、焰影苇草、迷迭香 |
| swiftShip | 迅捷 | 14 (12) | 隐现、锡人(H)、野鬃 | 蒂比、锡人 | 松果、忍冬 | 莱恩哈特 | 妮芙、凛御银灰、引星棘刺 | 异客、妮芙(H)、锏 |
| skillfulShip | 灵巧 | 12 (11) | 格雷伊 | 小满、蒂比 | 断崖、至简、空弦 | 凯瑟琳、灵知、白面鸮 | 隐德来希、白面鸮(H) | 溯光星源 |
| arcaneShip | 奥术 | 10 (9) | 深靛 | 洛洛、协律(H) | 海霓 | 莫斯提马、阿罗玛 | 史尔特尔、夕 | 圣聆初雪、溯光星源 |
| steadShip | 坚守 | 10 (10) | 角峰、古米 | 泡泡、折桠、灰毫 | 斯卡蒂、蛇屠箱 | 信仰搅拌机 | 塞雷娅 | 余 |
| deputShip | 助力 | 13 (8) | 刺玫、波登可 | 调香师、协律(H) | 巫恋(H)、耶拉 | 耶拉(H)、蜜蜡(H)、白面鸮、卡涅利安 | 白面鸮(H) | 流明、纯烬艾雅法拉 |
| visiShip | 远见 | 9 (8) | 地灵(H) | 赫默 | 诗怀雅、初雪 | 伊内丝、风笛 | 圣约送葬人、寒檀 | 迷迭香 |
| miraShip | 奇迹 | 11 (8) | 地灵(H) | 风丸 | 能天使、伺夜 | 录武官(H)、华法琳 | 华法琳(H)、引星棘刺、安洁莉娜、录武官 | 维娜·维多利亚 |
| investShip | 投资人 | 5 (4) | 锡人(H) | 锡人 | 琳琅诗怀雅 |  | 凛御银灰、山 |  |
| raidShip | 突袭 | 9 (9) | 宴 | 休谟斯 | 斯卡蒂、瑕光 | 伊内丝、缄默德克萨斯 | 史尔特尔 | 仇白、耀骑士临光 |
| indomShip | 不屈 | 9 (7) | 红豆(H)、雷蛇 | 崖心(H)、砾 | 蛇屠箱 | 风笛 | 隐德来希、归溟幽灵鲨 | 佩佩 |
| maniShip | 调和 | 2 (1) | 盟约·辅助干员(H) |  |  |  |  | 缪尔赛思 |
| emptyShip | 协防干员 | 8 (5) | 盟约·辅助干员(H) | 调香师 | 松果 | 瑰盐(H)、魔王 | 魔王(H)、铃兰 | 迷迭香 |
| soloShip | 独行 | 6 (6) | 德克萨斯 | 折桠 | 流星 | 水月、泥岩 | 塞雷娅 |  |
| suntShip | 绝技 | 0 (0) |  |  |  |  |  |  |

Note: `suntShip` 绝技 has no operator members; it can only be granted through equipment combinations (loading tip: 特定的装备组合可以为干员赋予额外的盟约效果) — see the equipment/bond research.

Bond count per chess: 1 bonds: 48, 2 bonds: 75, 3 bonds: 6. Chess whose 特质 is implemented by several garrison entries: 2_05 哈洛德 (2), 2_12 砾 (2), 2_19 锡人 (2), 3_17 流星 (2), 3_19 伺夜 (3), 4_15 录武官 (2), 5_01 圣约送葬人 (2), 5_21 寒檀 (2), 6_07 维娜·维多利亚 (2), 6_12 迷迭香 (2), 6_17 耀骑士临光 (4), 6_19 锏 (2).

### 5.5 特质 event types (normal chess)

| eventType | 显示 | count |
|---|---|---|
| IN_BATTLE | 持续叠加 | 35 |
| IN_BATTLE | 作战能力 | 31 |
| SERVER_PREP_FIN | 持续叠加 | 25 |
| SERVER_GAIN | 单次叠加 | 19 |
| SERVER_GAIN | 整备能力 | 11 |
| SERVER_CHESS_SOLD | 整备能力 | 5 |
| SERVER_PREP_START | 整备能力 | 5 |
| SERVER_PREP_START | 持续叠加 | 4 |
| SERVER_PREP_START | 特异化 | 3 |
| SERVER_PRICE | 整备能力 | 2 |
| SERVER_REFRESH_SHOP | 持续叠加 | 1 |
| SERVER_PREP_FIN | 整备能力 | 1 |
| SERVER_CHESS_SOLD | 特异化 | 1 |
| SERVER_PREP_FIN | 特异化 | 1 |

effectType counts: ADD_BOND 35, GAIN_BUFF 30, SERVER_ADD_BOND_CHESS_ALL 17, SERVER_ADD_BOND_METHOD 10, SERVER_ADD_BOND 7, SERVER_GAIN_EQUIP 6, SERVER_GAIN_FREE_REFRESH_COUNT 4, SERVER_ONCE_GOLD 4, SERVER_ADD_BOND_POSITION 4, SERVER_ADD_BOND_ACTIVATED_MOST_LAYER 3, SERVER_CHESS_PRICE 2, SERVER_POOL_EQUIP 2, SERVER_TRIGGER_ANOTHER 2, SERVER_ADD_REFRESH_CNT_MULTIPLIER_BOND_LAYER 2, SERVER_POOL_CHAR 2, SERVER_ADD_MULTIPLE_BOND 2, SERVER_FRONT_SAME_EFFECT_PREP_START 2, NONE 1, SERVER_GAIN_BOND_LAYER_BY_REFRESH_CNT 1, SERVER_ONCE_GOLD_WITH_BOND_CONDITION 1, SERVER_SELL_CHESS_GAIN_SPECIAL_GOODS 1, SERVER_GAIN_RANDOM_EQUIP_CHESS_IN_POOL 1, SERVER_ADD_ACT_BOND_DIFF_LV_MOST_LAYER 1, SERVER_FRONT_SAME_EFFECT_PREP_FIN 1, SERVER_MOST_BOND 1, SERVER_ADD_BOND_IN_HAND 1, SERVER_ADD_BOND_ROUND_COIN_COST 1.

Semantics [from descriptions]: `IN_BATTLE` 作战能力 = battle buff applied via battleRuneKey (`char_attribute_mul` direct multiplier, or `env_gbuff_new_with_verify` scripted effect whose `key` names the script, e.g. `act1autochess_gar_eff_attrByBond` = +stat per N bond layers); `SERVER_GAIN` 单次叠加 = one-shot when the chess is acquired (<获得时>); `SERVER_PREP_START` / `SERVER_PREP_FIN` = at start / end of each prep phase while on field; `SERVER_CHESS_SOLD` = when sold; `SERVER_PRICE` = modifies its own purchase price; `SERVER_REFRESH_SHOP` = on shop refresh. Full blackboards per chess are in JSON `garrisons[]`.
- **Multi-entry 特质**: `garrisonIds` can hold 2–4 ids for one displayed 特质. `garrisonIds[0]` carries the full display text; the following ids are implementation components (their text repeats part of the first, sometimes prefixed by an internal marker like `【145】` = "component of garrison_145"; ignore the marker). Apply ALL entries' effects, display only the first. Example 哈洛德: garrison_09 (display "攻击力和生命值+20%；核心盟约每叠加3层…+1%", blackboard = the per-layer part) + garrison_03 (the flat +20%). `give_garrison_id` in a blackboard = grants that garrison to the listed targets at battle start (耀骑士临光).
- `conditionkey = character_target_inboard` (63 garrisons): effect only works while the chess is **on the battlefield board** (not bench). Text "此干员在整备区时也有效" = also works from the bench (no conditionkey). `character_same_row` + `check_count` 3: requires 3 operators in the same row.
- `SERVER_POOL_CHAR` / `SERVER_POOL_EQUIP` / `SERVER_SELL_CHESS_GAIN_SPECIAL_GOODS` reference named pools (`pool_char_pinus`, `pool_chess_glady`, `pool_equip_rockr`, `pool_equip_pepe`, `pool_equip_normal`, `pool_chess_shop_1_reward`…) that are not defined in the exported tables — contents must be inferred from the description text [ASSUMED].

IN_BATTLE scripted effect keys (`blackboard.key` of `env_gbuff_new_with_verify`), counts over all 266 chess objects, with one example each:

| script key | count | example |
|---|---|---|
| act1autochess_gar_eff_attrByBond | 28 | 隐现: 【拉特兰】每叠加5层，本干员攻击速度+1 |
| act1autochess_gar_event_selfkillenemy | 15 | 送葬人: <战斗中>首次击倒敌人时，使已激活的【精准】【拉特兰】层数+3 |
| act1autochess_gar_event_useskill | 12 | 莎草: <战斗中>首次开启技能时，使已激活的【萨尔贡】层数+5 |
| act2autochess_gar_event_onstart | 8 | 砾: <部署时>使已激活的【卡西米尔】层数+1 |
| act1autochess_gar_event_consume_ammo | 8 | 莫斯提马: <战斗中>自身周围4格的干员每消耗6发弹药，使已激活的【拉特兰】层数+1 |
| act1autochess_gar_eff_chaos | 6 | 宴: <战斗中>造成的伤害变为弱点伤害（基于敌人的防御力和法术抗性变换物理和法术伤害） |
| act1autochess_gar_event_selfdead | 6 | 幽灵鲨: <战斗中>自身被击倒时，使已激活的【阿戈尔】层数+3 |
| act1autochess_gar_eff_attack_enemy | 4 | 深巡: 攻击海怪敌人时攻击力提升至150% |
| act1autochess_gar_event_enemy_abflag_inrange | 4 | 初雪: <战斗中>每当范围内1名敌人进入冻结时，有50%概率使已激活的【谢拉格】层数+1 |
| act1autochess_gar_event_addition_cnt | 4 | 魔王: <战斗中>战斗中当本干员身前一格的干员因特质使层数提升时，使其额外层数+1 |
| attr_common_global_buff | 2 | 古米: 技力自然恢复速度+0.15/秒 |
| act2autochess_gar_event_allyenemy_sleepstun_inrange | 2 | 缇缇: <战斗中>每当范围内有敌人或干员进入沉睡或晕眩时，使已激活的【萨尔贡】【精准】层数+1（每场战斗至多24层） |
| act2autochess_gar_eff_attrByBond_add_onstart | 2 | 玛恩纳: 【卡西米尔】每叠加5层，本干员部署后100秒内基础攻击力+10、基础生命值+50 |
| act2autochess_gar_eff_ab_damageScaleByBond | 2 | 仇白: 【炎】【突袭】每叠加3层，本干员攻击束缚和停顿状态的敌人造成的伤害提升1% |
| act1autochess_gar_eff_respawnTimeByBond | 2 | 耀骑士临光: 【145】【卡西米尔】每叠加3层，本干员再部署时间-1.5%，攻击速度+0.5 |

`char_attribute_mul` garrisons (no script) are plain multiplicative stat buffs, e.g. "攻击力和生命值+20%" = atk×1.2, max_hp×1.2.

## 6. Attack ranges used by pool chess

`O` = operator tile (included in range), `o` = operator tile not in range, `#` = in range; facing right.

```
1-1  (used by 60 chess objects)
O#

3-3  (used by 32 chess objects)
####
O###
####

y-2  (used by 26 chess objects)
####
#O##
####

3-1  (used by 20 chess objects)
###.
O###
###.

0-1  (used by 16 chess objects)
O

x-1  (used by 14 chess objects)
..#..
.###.
##O##
.###.
..#..

2-2  (used by 12 chess objects)
O##

3-6  (used by 12 chess objects)
###
O##
###

3-12  (used by 8 chess objects)
##..
O###
##..

y-6  (used by 8 chess objects)
.##.
####
#O##
####
.##.

1-3  (used by 6 chess objects)
.#
O#
.#

3-9  (used by 6 chess objects)
###..
####.
O####
####.
###..

3-5  (used by 4 chess objects)
##.
###
O##
###
##.

2-5  (used by 4 chess objects)
.##
O##
.##

3-2  (used by 4 chess objects)
O###

3-17  (used by 4 chess objects)
.###
####
O###
####
.###

5-1  (used by 4 chess objects)
O#####

4-6  (used by 3 chess objects)
...##.
o..###
...##.

y-7  (used by 2 chess objects)
#####
#O###
#####

2-1  (used by 2 chess objects)
#..
##.
O##
##.
#..

3-14  (used by 2 chess objects)
.###
O###
.###

4-9  (used by 2 chess objects)
##...
O####
##...

y-1  (used by 2 chess objects)
###.
#O##
###.

1-2  (used by 2 chess objects)
#.
O#
#.

3-4  (used by 2 chess objects)
###.
####
O###
####
###.

4-5  (used by 1 chess objects)
...##
o..##
...##

```

## 7. Assumptions / open questions

- `SEARCH`, `GDGLOW_SKILL_2`, `MLYSS_WTRMAN` semantics inferred from names [ASSUMED]; DEFAULT / TAKE_DAMAGE follow the wiki rule text. Buff skills of non-listed supports under DEFAULT are [ASSUMED] to wait for an enemy in range.
- [ASSUMED] Stat rounding half-up to integer; the client may keep floats internally. Difference <= 1 point.
- Tokens not in `shopStateTokenDict` (e.g. 凯瑟琳 `token_10041_cathy_catsld`) may be unsupported/disabled in this mode; decide per-operator in the sim spec.
- Hidden chess: exact way they enter play should be confirmed by the shop/garrison/equip research (some garrisons have effectType `SERVER_GAIN_CHAR` / `SERVER_POOL_CHAR`).
- Talents with conditions tied to the main game (e.g. deploy count, DP) must be re-interpreted for the mode; this doc lists them verbatim.
- Community sources: PRTS 卫戍协议 page (substitution, 甄选 rules), BWIKI 盟约 page (甄选 slot, 8/9 deploy limit), official news 5114 (特许干员 rule, 协防干员 rework).

---

## Addendum (critic)

Written 2026-09-27 by the completeness critic. Sources: BWIKI `盟约` §作战期 (auto-cast list), PRTS `卫戍协议/帮助` §战斗部署/手牌区, and the official gameplay-intro image.

### C1. Skill auto-cast: correction to §1.4
> Superseded by user playtest #6 (DESIGN §20): the class rows apply to **every MANUAL skill** of the class and never to an AUTO skill (PRTS 卫戍协议/帮助 names whole classes; the 阵法术师 row must cover 薄绿's default S2, a phalanx that never attacks with its skill off); a MANUAL skill with its own 技能范围 (not an attack-range change) uses SKILL_RANGE; automatic operations have a 3 s cooldown. The "skill 1 only" reading below (BWIKI) is kept for the record.

The rows in `skillTriggerDataList` with `skillIndex: 0` apply to **skill 1 only**. They are not wildcards. Evidence:
- BWIKI transcribes every row as "技能1": "重装职业干员 技能1，受到伤害后自动释放"; "吟游者/执旗手/战术家子职业干员 技能1，技力满后自动释放"; "解放者/阵法术师子职业干员 技能1，初始攻击范围内出现敌人后自动释放".
- The data has a separate sentinel `-1` for "all skills" (缪尔赛思: "全部技能，受流形影响").

Consequences for the current pool:
- **TAKE_DAMAGE applies only to 古米 (`chess_char_1_10`, S1) and 灰毫 (`chess_char_2_18`, S1).** Every other tank uses S2 or S3 and follows DEFAULT.
- The bearer, tactician, bard, librator and phalanx rows match **no pool chess** this season, because all of them default to S2 or S3. They still fall under DEFAULT, except the charId rows: 玛恩纳 S3 and 圣聆初雪 S3 use CUSTOM_RANGE, 缪尔赛思 uses MLYSS_WTRMAN, and 安洁莉娜 S2/S3 use SEARCH.
- **DEFAULT, official wording:** "将要攻击(或治疗)且在敌人进入初始攻击范围时将自动开启技能". The skill fires when SP is ready AND the unit is about to perform a normal attack (or heal) AND an enemy is inside its *initial* attack range. Heal-type skills fire when it is about to heal.
- **Vanguard S1** skills (DP skills) fire as soon as SP is full ("先锋职业干员 技能1，技力满后自动释放"). No pool vanguard defaults to S1.

### C2. Deployment, summons and the hand (PRTS 帮助, verbatim rules)
- **Placing on the board in prep** only sets the starting tile. Deploy-time effects do **not** fire in prep ("干员或召唤物的部署效果在此部署时不生效"). The deploy cap is "单位部署数量受部署位限制（初始为8）". It can be raised: 04 lists a RECRUIT item for this, and BWIKI mentions "8/9".
- **Summons that are manually deployable:**
  - When their owner is placed on the board, they are sent to the hand. The number sent equals the summon's *deploy limit*, not its initial count.
  - Several summons of the same owner **stack in 1 hand slot**. Summons of different owners don't stack.
  - Withdrawing the owner removes its summons from the board.
  - Tokens marked `DEFAULT` in `shopStateTokenDict` are these placeable pieces: 医疗探机, 诅咒娃娃, 狼群, 斯卡蒂的海嗣, 流形. `HIDDEN` tokens exist only in battle.
  - [ASSUMED] Summons do **not** use one of the 8 deploy slots, as in the base game. Keep this as a config flag.
- **Battle start:** every board unit deploys for free, in order **从上到下>从左到右** (下半): down each column, the columns left to right (research 01 §4.3). In the boss round the order is mirrored for the right-side player. After that, knocked-out units redeploy automatically on their tile when the respawn timer is done and DP ≥ `cost` (DP starts at 10, +1/s, cap 99).
- **Ranged units may stand on melee tiles** ("所有行动内远程干员可部署在近战位"). Melee units may **not** use ranged-only tiles (HIGH `h`) — except elite 歌蕾蒂娅 carrying HOK-Y 淡金坠饰 (`uniequip_003_glady`). The branch trait 「可以放置于远程位」 (钩索师 / 推击手; PRTS 新人入门 "可部署在高台和地面") is on every variant and is **not** read (owner's decision 2026-10-04, reversing the §22.6 reading of GitHub #32 item 4). 崖心 has only HOK-X; 见行者, a normal record, any other module and no module stay on the ground. Maps: see 05.

### C3. Pool membership per match
The per-match ban removes every visible chess whose bonds are **all** in the disabled set. The rule is verified; see 01 Addendum A2. Elites of banned chess are also unobtainable. Hidden chess (17) stay out of the shop as §1.2 says.

### C4. DIY (甄选) recommendation
The 2024 rule text reads "对于五六阶干员，除了目标干员外，还各共开放了2个甄选干员名额，博士可以选择等阶加入精英干员或自己在活动外已有的六星干员". The remake has no account roster. **Recommendation:** v1 disables the 4 DIY chess, so they are not in the pool or the copy tables. v2 lets each player pre-pick up to 2 T5 and 2 T6 from a curated 6★ list. Stats come from `character_table` at the tier's status. The bond is derived from nation/group/team through `powerIdList`, else 协防干员. There is no 特质.
