# 02 - 盟约 (Bonds / Alliances) - 卫戍协议：盟约 (act2autochess)

Research deliverable for the fan remake. Machine-readable twin: `02-bonds.json` (same content + raw rich-text, full blackboards, act1 values).

**Sources.** Official client data `Kengxxiao/ArknightsGameData` zh_CN `activity_table.json` -> `activity.AUTOCHESS_SEASON.act2autochess` (卫戍协议：盟约 **下半**, startTime 1773475200 = 2026-03-14, already includes the 3/27 balance patch) and `autoChessData`; `character_table.json`; `enemy_database.json` (炎佑). Community: PRTS `卫戍协议：盟约 下半` + `…/PRTS盟约记录` (formulas, hidden notes, 3/27 patch notes), 巴哈姆特 bsn=33651 snA=12294 / 12316, arknights.wiki.gg Stronghold Protocol (Alliance) pages, gamemarket.gg guide.

**Conventions.** `L` = the bond's current layer count (层数). "member" = an operator whose chess has that bondId. Tier = chess tier I-VI (= shop tier, not rarity). `[ASSUMED]` = my guess, not backed by data or a source. `[UNKNOWN]` = unresolved. Numbers are the zh_CN act2 data unless stated.

## 1. Overview of all 23 bonds

| # | bondId | 名称 | Type | Activate | Count from | Tiers (member count / layer milestones) | Layer formula(s) | Members (in shop / total) |
|---|---|---|---|---|---|---|---|---|
| 1 | `yanShip` | 炎 | CORE | 3 (upward 3) | BOARD | 3 distinct 炎 on board; 6 distinct; 9 distinct | atkMultiplier = 1 + 0.23 + 0.009*L | 10 / 11 |
| 2 | `sargonShip` | 萨尔贡 | CORE | 3 (upward 3) | BOARD | 3 distinct; 6 distinct; 6 distinct AND strategy 娜仁图亚 (band_narant) | stackDurationSec = 5 + 0.22*L; aspdPerStack = 12; atkPerStack(6) = 0.12; maxStacks = 25 | 10 / 12 |
| 3 | `victoriaShip` | 维多利亚 | CORE | 3 (upward 3) | BOARD | 3 distinct; every 25 layers (cumulative); 6 distinct | damageMultiplier = 1.25 + 0.008*L (only if carrying equipment); hammerPayouts = floor(L/25); atkPerItem(6) = 0.5 normal, 0.8 advanced | 10 / 10 |
| 4 | `kjeragShip` | 谢拉格 | CORE | 3 (upward 3) | BOARD | 3 distinct; 6 distinct | damageMultiplier = 1.25; damageMultiplierVsColdOrFrozen = 1.35 + 0.01*L; windIntervalSec = 25; windColdDurationSec = 20 + 0.1*L | 10 / 12 |
| 5 | `lateranoShip` | 拉特兰 | CORE | 3 (upward 3) | BOARD | 3 distinct; 6 distinct | ammoMultiplier = floor(baseAmmo * (1.05 + 0.015*L)); atkPerAmmo(6) = 0.04; atkCap(6) = 2.0 | 10 / 11 |
| 6 | `egirShip` | 阿戈尔 | CORE | 3 (upward 3) | BOARD | 3 distinct; 3 distinct (battle start); 5 distinct | hpMultiplier = 1.35 + 0.01*L; devourDamage = 5000; layersPerDevoured = tier of devoured unit | 9 / 9 |
| 7 | `siracusaShip` | 叙拉古 | CORE | 3 (upward 3) | BOARD | 3 distinct; 6 distinct | aspd = 25 + 0.8*L; durationSec = 32 + 0.4*L; procDamage = 5000 + 50*L; prdStep = 0.00139 | 10 / 11 |
| 8 | `kazimierzShip` | 卡西米尔 | CORE | 3 (upward 3) | BOARD | 3 distinct; 6 distinct | atkPerDeploy = 0.20; atkCap = 0.50 + 0.01*L | 10 / 10 |
| 9 | `preciShip` | 精准 | add-on | 2 (upward 2) | BOARD | 2 distinct; 3 distinct | atkMultiplier = 1.10 + 0.012*L; defPenetrateRatio(3) = 0.3; resPenetrateRatio(3) = 0.3 | 12 / 12 |
| 10 | `swiftShip` | 迅捷 | add-on | 2 (upward 2) | BOARD | 2 distinct; L >= 40 | p = min(1, 0.20 + 0.0035*L); reaches100%AtL = 229 | 12 / 14 |
| 11 | `skillfulShip` | 灵巧 | add-on | 2 (upward 2) | BOARD | 2 distinct; L >= 40 | aspd = 10 + L | 11 / 12 |
| 12 | `arcaneShip` | 奥术 | add-on | 2 (upward 2) | BOARD | 2 distinct; 3 distinct | magicTakenMul = 1.20 + 0.01*L; magicTakenMulLowHp(3) = 1.4*(1.20 + 0.01*L); hpThreshold = 0.5; durationSec = 3 | 9 / 10 |
| 13 | `steadShip` | 坚守 | add-on | 2 (upward 2) | BOARD | 2 distinct; 3 distinct | hpMultiplier = 1.25 + 0.012*L; redirectRatio = 0.4; thornsDamage = 850 + 10*L; thornsCooldownSec = 0.2; fragile = 1.4 for 5 s | 10 / 10 |
| 14 | `deputShip` | 助力 | add-on | 2 (upward 2) | BOARD | 2 distinct; 3 助力 (distinct name or elite state) | defMultiplier = 1.15 + 0.012*L; redeployTimeMul = 0.7; layersPerRound = 2 (4 at 3 members) to every active bond | 8 / 13 |
| 15 | `visiShip` | 远见 | add-on | 2 (upward 2) | BOARD_AND_DECK | 2 distinct (board + bench); first time L >= 80; first time L >= 150 | goldPayouts = 2 * floor(L/10) | 8 / 9 |
| 16 | `miraShip` | 奇迹 | add-on | 2 (upward 2) | BOARD_AND_DECK | 2 distinct (board + bench); every 100 layers | p = min(1, 0.18 + 0.003*L); goldPayouts = 20 * floor(L/100) | 8 / 11 |
| 17 | `investShip` | 投资人 | add-on | 3 (upward 3) | BOARD_AND_DECK | 3 distinct (board + bench); L >= 100 | gainTraitRepeat = 2 if L < 100 else 3 | 4 / 5 |
| 18 | `raidShip` | 突袭 | add-on | 2 (upward 2) | BOARD | 2 distinct; L >= 50 | atkHpMultiplier = 1.25 + 0.01*L; idleSec = 10; aspdAll(L>=50) = 50 | 9 / 9 |
| 19 | `indomShip` | 不屈 | add-on | 2 (upward 2) | BOARD | 2 distinct; 3 distinct | p = min(1, 0.18 + 0.004*L); reaches100%AtL = 205 | 7 / 9 |
| 20 | `maniShip` | 调和 | add-on | 1 (upward 1) | BOARD | 1 调和 on board |  | 1 / 2 |
| 21 | `emptyShip` | 协防干员 | add-on | 2 (upward 2) | BOARD | 2 distinct | damageTakenMul = 0.8; memberDamageMul = 1.2 (elite 1.4) | 5 / 8 |
| 22 | `soloShip` | 独行 | add-on | 1 (downward 1,2) | BOARD | exactly 1 distinct 独行 on board | atkMul = 1.6; hpMul = 1.6; spOnDeploy = 15 | 6 / 6 |
| 23 | `suntShip` | 绝技 | add-on | 2 (upward_golden 2) | BOARD_ALL_CHESS | 2 elite (精锐) operators on board (any operators, duplicates count); 5 elite operators on board | atkMul = 1.3; spCostMul = floor(sp*0.7) | 0 / 0 |

Core (isPower, bondType SEASON): 炎 萨尔贡 维多利亚 谢拉格 拉特兰 阿戈尔 叙拉古 卡西米尔. New in act2 (下半): 叙拉古, 卡西米尔 (core), 奥术, 独行, 绝技 (add-on).

## 2. Global mechanics

### 2.1 Activation & member counting

- activeCondition BOARD: count distinct member operators placed on the battlefield grid (constData.maxBattleChessCnt = 8, probably the on-board cap). Operators on the bench (整备区; constData.maxDeckChessCnt = 10, probably the bench cap) do not count.
- activeCondition BOARD_AND_DECK (远见, 奇迹, 投资人): board + bench both count ("整备区的X干员也可用于激活盟约").
- activeCondition BOARD_ALL_CHESS + template count_threshold_upward_golden (绝技): count every elite (精锐, *_b chess) on the board, regardless of bonds; duplicates of the same operator each count.
- count_threshold_upward with activeParamList [n]: active iff count >= n. Higher tiers come from blackboard keys power_bond_char_cnt / ex_bond_char_cnt / power_char_cnt / ex_char_cnt (member-count tiers) and power_bond_stack_cnt / layer (layer-milestone tiers).
- count_threshold_downward with activeParamList ["1","2"] (独行): active iff 1 <= count < 2.
- "不同" (distinct): operators are identified by their normal chess id (chessNormalIdLookupDict maps *_b -> *_a), so a normal and an elite copy of the same operator count once. Exception: 助力 3-member tier counts operators that differ in name OR elite state (PRTS 修正). 独行 is only broken by 2+ DIFFERENT 独行 operators (PRTS 修正).
- 调和 (maniShip): while active (>=1 调和 operator on board) every core bond (isPower=true) gets member count +1 (a single +1, not per 调和 operator), and 调和 operators receive the effects of every active core bond as if members. [ASSUMED: the +1 applies only to core bonds that already have >=1 real member on the board.] "炎佑" does not include 调和 operators' stats unless they are also 炎 (PRTS).
- Item 变形同构体 (chess_item_6_09_e, canGiveBond) worn together with a bond item (trapChessData.giveBondId) makes the wearer an extra member of that bond. 14 bonds have such items; 灵巧/远见/奇迹/投资人/助力/调和/协防干员/独行/绝技 do not.
- DIY (自选) chess slots chess_char_5_diy1/2 and chess_char_6_diy1/2 have bondIds [] and are filled with a 6-star operator the player owns (diyChessDict = TIER_6). Their bond is derived from the chosen operator's nationId/groupId/teamId matched against autoChessData.bondInfoDict[*].powerIdList (e.g. yan: yan,sui,lungmen,lee,lgd; victoria: victoria,glasgow; kjerag: kjerag,karlan; egir: egir,abyssal; siracusa: siracusa,chiave; kazimierz: kazimierz,pinus; sargon; laterano). No match -> constData.fallbackBondId = emptyShip (协防干员). (bwiki: operators from those nations get the nation alliance, "others receive the 协防 designation".)
- Prototype substitution: a NORMAL chess whose operator the player does not own is fielded as its backupCharId (预备干员 / 原型干员) but keeps the chess's bonds and traits (PRTS: "烛煌（或对应的原型干员）").
- Mode filter: 标准模拟 (mode_single_funny / mode_multi_funny) enables only 13 bonds (炎 萨尔贡 维多利亚 谢拉格 叙拉古 精准 迅捷 坚守 助力 远见 不屈 调和 协防干员); 拉特兰 阿戈尔 卡西米尔 灵巧 奥术 奇迹 投资人 突袭 独行 绝技 are inactive there. Training/险境/绝境/终极 enable all 23.
- Stat math: attribute bonuses from 盟约, strategies and equipment are "直接乘算" (PRTS 盟约记录 "盟约效果，策略效果，装备效果提供的属性加成均为直接乘算，与自持有干员的属性加成独立"). **Corrected 2026-10-01 (DESIGN §20.10):** 直接乘算 is PRTS's technical modifier class (游戏数据基础 属性基本公式: "直接乘算结果 D_t = t₁ + t₂ + … + tₙ", A = (A₀ + D_p)(1 + D_t); 作战机制: X₂ = X₁(1 + b₁% + b₂%), a skill's "攻击力+180%" being the example) — the values are SUMMED with each other and with the skills' "+X%"; "与自持有干员的属性加成独立" means they are separate from the **自持有加成** (PRTS 卫戍协议：盟约 下半, its own table: an operator the player really owns gets +5–10 % ATK / DEF / max HP by its real promotion — 精英1 Lv.1 +5/+5/–, 精英2 Lv.1 +10/+5/+5, 精英2 Lv.60 +10/+10/+10, the highest met applies), which the remake does not model. E.g. 炎 +50% ATK and an item +30% ATK -> final = base_atk x (1 + 0.5 + 0.3) (+ any skill %), not x 1.5 x 1.3 (the reading used until v2.5).
- Core bonds (bondType SEASON, isPower) = 炎 萨尔贡 维多利亚 谢拉格 拉特兰 阿戈尔 叙拉古 卡西米尔 (8). The other 15 are add-on (REGULAR). bondOrder: 调和 = 1 (listed first in UI), others 2.
- weight (10 for most, 0 for 投资人/调和/协防干员/绝技): weight used when an effect picks a random bond (e.g. SERVER_ADD_BOND_ACTIVATED_RANDOM, random bond chess) [ASSUMED meaning].

### 2.2 Layers (层数)

- Each player has one integer layer counter L per bond (23 counters). All start at 0 when the simulation starts, are never reset between rounds and are never reduced (no layer-loss effect exists in the data) [ASSUMED: never reduced].
- L is kept while the bond is inactive, but bond effects only apply while the bond is active (PRTS 盟约记录).
- Wording contract used by every source: "使已激活的【X】层数+N" -> add only if bond X is active at the moment of the trigger; "（无需激活盟约）" -> add even if X is inactive. "自身所属盟约" = every bond of that operator; "自身已激活的盟约" = only its bonds that are active.
- No layer cap in the data. Caps are per source: max_add_count_per_battle (layers a single garrison instance may add in one battle), max_layer (per round, e.g. 安洁莉娜 12/round). The official cap is in the client, not the data: `AutoChessBattleConst.MAX_GARRISON_STACK = 999`, `AddBondCount` stores `min(L + n, 999)` per bond (research 11 §1). Since 2026-10-01 (DESIGN §20.12) the remake stops each bond at 999 (`shared/constants.js BOND_LAYER_CAP`, `layerGainRoom`); the community agrees (巴哈姆特 12534 "每把都能999层", "沒999層的盟約情況下"; 12316 "999謝").
- Layers gained in battle persist after the battle and immediately affect formulas that read L [ASSUMED live update: recompute bond buffs whenever L changes; the reference game uses env_gbuff that reads current stacks].
- IN_BATTLE layer gains are disabled while fighting for a teammate in the 联防 (Unite) phase and in the leader/boss round (巴哈姆特 snA=12294; arknights.wiki.gg: "Players cannot gain stacks via Combat-related Operator Attributes when assisting other players in the Unite Phase").
- 魔王 (garrison_59, emptyShip): whenever the operator on the tile in front of 魔王 raises layers through its own trait during battle, that raise gets +1 extra layer (per trigger).
- 投资人 (investShip) makes every "获得时" (SERVER_GAIN) trait trigger 2x (3x at 投资人 L>=100) - this includes the "<获得时>自身所属盟约层数+N" layer sources, so they double/triple.
- Trait timing vocabulary (garrison eventType): 获得时 SERVER_GAIN (when a chess is bought or granted), 进入休整期时 SERVER_PREP_START, 休整期结束时 SERVER_PREP_FIN (player ends prep / battle about to start), 刷新时 SERVER_REFRESH_SHOP, 售出时 SERVER_CHESS_SOLD, 购买价格 SERVER_PRICE, 战斗中/部署时/战斗开始时 IN_BATTLE.
- conditionkey character_target_inboard: a prep-phase trait only fires when its owner is on the board, not on the bench (整备区), unless its text says "此干员在整备区时也有效".
- Layer milestone effects ("每叠加25层", "每叠加10层", "每叠加100层") pay out once per multiple of the step crossed: payouts = floor(L/step) - payoutsAlreadyGiven. "首次达到X层" effects latch permanently.

Implementation sketch (server-authoritative):

```ts
type BondId = string;
interface PlayerBondState { layers: Record<BondId, number>; milestonePaid: Record<string, number>; latched: Set<string>; }
function addLayers(p, bond, n, opts: {requireActive: boolean, sourceKey?: string, perBattleCap?: number}) {
  if (opts.requireActive && !isActive(p, bond)) return 0;
  if (opts.perBattleCap) { n = Math.min(n, opts.perBattleCap - battleCounter(p, opts.sourceKey)); if (n <= 0) return 0; }
  if (inUnitePhaseForTeammate || isLeaderRound) { if (sourceIsInBattle) return 0; }
  p.layers[bond] += n; onLayersChanged(p, bond);   // pays milestones (维多利亚 25, 远见 10/80/150, 奇迹 100, 迅捷 40, 灵巧 40, 突袭 50, 投资人 100) and refreshes live buffs
  return n;
}
```

### 2.3 Hidden round (隐秘核心)

- **act2_下半**: Round 15 "隐秘核心" (bossInfoDict boss_8/9/10, isHidingBoss=true: Originium-corrupted versions of boss_1/2/3) is entered after round 14 only in 险境模拟 or harder, if: solo - sum of L over all ACTIVE bonds > 350 and remaining HP > 1; co-op (同盟模拟) - sum over all players > 1200 and sum of remaining HP > 1. (PRTS 卫戍协议：盟约 下半)
- **act1_上半**: Previous half used > 300 (solo) / > 1000 (co-op).
- **assumed**: [ASSUMED] checked right after the round-14 leader fight is won; "all active bonds" includes add-on bonds; hidden boss weights from bossInfoDict (boss_8 50, boss_9 40, boss_10 40).

- Settlement missions read "已激活的【X】…中盟约最高层数达到30/70层" (missionData 2autochessActivity_12..22) - i.e. L is tracked per bond and read at settlement.

## 3. Bonds in detail

### 3.1 炎 `yanShip` (CORE)

- Data: identifier 1, icon `icon_yanShip`, bondType SEASON, isPower True, powerIdList ['yan', 'sui', 'lungmen', 'lee', 'lgd'], activeCount 3, activeCondition BOARD, template count_threshold_upward, params ['3'], activeType BATTLE, noStack False, weight 10, bondOrder 2, isHiddenCharList False, effectId `bondeffect_yan`, descParamBase ['base_atk'] / perStack ['atk_per_stack'].
- Active in modes: all 9 modes
- UI desc (bondInfoDict.desc):

  > 【炎】干员攻击力提升（受层数影响）
  > <在场6名不同【炎】干员>战斗开始时召唤可自主行动的“炎佑”，其攻击力生命值分别为开战时【炎】干员攻击力生命值总和的30%，“炎佑”同时攻击3个目标，可使用“祛恶之焰”，攻击时附带攻击力一定比例的灼燃损伤且周围敌人受到一定比例的元素脆弱
  > <在场9名不同【炎】干员>改为召唤2只“炎佑”，攻击力提升至1.5倍，受到的伤害-90%

- Detail desc (effectInfoDataDict, placeholders resolved):

  > 【炎】干员攻击力+(23+0.9×L)%（受层数影响）
  > <在场6名不同【炎】干员>战斗开始时收集【炎】干员部分属性召唤“炎佑”（其攻击力和生命值为【炎】干员攻击力和生命值总和的30%）；“炎佑”同时攻击3个目标，攻击附带20%攻击力的灼燃损伤，周围敌人受到20%的元素脆弱，周期性使用“祛恶之焰”
  > <在场9名不同【炎】干员>改为召唤2只“炎佑”；“炎佑”攻击力提升至1.5倍，受到的伤害-90%

- Buff blackboard(s):
  - `env_gbuff_new`: `{"key": "act1autochess_bond_eff_yan", "base_atk": 0.23, "atk_per_stack": 0.009, "power_bond_char_cnt": 6.0, "ex_bond_char_cnt": 9.0, "damage_resistance": 0.9, "atk": 1.5}`
  - act1 (上半) values for comparison: `[{"key": "act1autochess_bond_eff_yan", "base_atk": 0.23, "atk_per_stack": 0.009, "power_bond_char_cnt": 6.0}]`

**Implementable spec**

- **[3 distinct 炎 on board]** 炎 members (+调和 members) ATK x(1 + 0.23 + 0.009*L).
- **[6 distinct]** At battle start spawn 1 "炎佑" (enemy_9012_acloon template, allied flying ranged unit, not blockable, moves on its own). ATK = 0.30 x sum(ATK of 炎 operators on board at battle start), maxHP = 0.30 x sum(maxHP of those operators). Template: DEF 200, RES 0, BAT 2.5 s, ASPD 100, attack range radius 2.0 tiles, magic damage, hits up to 3 targets; every hit adds 灼燃损伤 (burn elemental damage) = 20% of its ATK and applies 元素脆弱 (elemental damage taken x1.2) to enemies within 0.8 tiles of the target. Skill "祛恶之焰": cooldown 15 s (first cast 15 s after spawn), channels a flame on one enemy in range dealing 60% ATK magic damage per second to it and to enemies within 1.0 tile, for up to 20 s.
- **[9 distinct]** Spawn 2 炎佑 instead; each has ATK x1.5 and takes 90% less damage (damage_resistance 0.9).
- Formulas: `atkMultiplier = 1 + 0.23 + 0.009*L`
- Caps: none
- How layers are gained: Economy-driven: 惊蛰 获得时 +shop level (no activation needed); 小满 休整期结束 +1 per operator gained this round; 夕 +2 炎/奥术 per operator gained; 录武官 获得时 +6 炎 +3 奇迹; 星熊 获得时 +8 own bonds; 烛煌 获得时 +5 炎/维多利亚; 机变 "诗怀雅的盟誓" +10. Strategy 杜遥夜: first 2 manual refreshes each round prefer a 炎 operator.
- How it plays: Buy many operators each round (every gain feeds 小满/夕), rush 6 炎 for the 炎佑 spike; 琳琅诗怀雅 / 诗怀雅 give early gold. 9 炎 is a late-game luxury.
- [ASSUMED] 炎佑 base stats are replaced (not added) by the 30% sums
- [ASSUMED] 祛恶之焰 hit_duration=20 read as 20 one-second ticks
- [ASSUMED] spawn point: centre of the player's board / near the objective
- [ASSUMED] targets = 3 nearest enemies in range
- Bond item (with 变形同构体 grants this bond): 炎国短刀 `chess_item_3_04_e` (2 gold: 每开启一次技能，获得5%的攻击力加成（最多叠加10次）)
- Garrisons that explicitly add layers to this bond: `garrison_30`, `garrison_31`, `garrison_35`, `garrison_36`, `garrison_119`, `garrison_156` (see section 4; plus the generic ones)
- Garrisons that scale with this bond's layers: `garrison_09`, `garrison_10`, `garrison_101`, `garrison_103`

Members (11 chess, 10 in current shop pool; by tier in shop: {'1': 1, '2': 1, '3': 2, '4': 1, '5': 3, '6': 2}):

| Tier | Operator | chessId | ★ | Class | Type | Bonds | Trait (normal) | Trait (elite) |
|---|---|---|---|---|---|---|---|---|
| 1 | 惊蛰 | `chess_char_1_03_a` | 5 | CASTER | PRESET | 炎 | <获得时>获得等于当前调度中心等级的【炎】层数（无需激活盟约） | <获得时>获得等于两倍的当前调度中心等级的【炎】层数（无需激活盟约） |
| 2 | 小满 | `chess_char_2_04_a` | 5 | SUPPORT | PRESET | 炎/灵巧 | <休整期结束时>本回合每获得过1名干员，使已激活的【炎】层数+1 | <休整期结束时>本回合每获得过1名干员，使已激活的【炎】层数+2 |
| 3 | 诗怀雅 | `chess_char_3_03_a` | 5 | WARRIOR | PRESET | 炎/远见 | <获得时>获得1个“盟约之币” | <获得时>获得2个“盟约之币” |
| 3 | 琳琅诗怀雅 | `chess_char_3_04_a` | 6 | SPECIAL | NORMAL -> 预备干员-医疗 | 炎/投资人 | <休整期结束时>使下个休整期额外获得1资金（若已激活【炎】/【投资人】此特质在整备区也有效） | <休整期结束时>使下个休整期额外获得2资金（若已激活【炎】/【投资人】此特质在整备区也有效） |
| 4 | 录武官 *(hidden)* | `chess_char_4_15_a` | 5 | MEDIC | PRESET | 炎/奇迹 | <获得时>【炎】层数+6、【奇迹】层数+3（无需激活盟约） / <获得时>【炎】层数+6、【奇迹】层数+3（无需激活盟约） | <获得时>【炎】层数+12、【奇迹】层数+6（无需激活盟约） / <获得时>【炎】层数+12、【奇迹】层数+6（无需激活盟约） |
| 4 | 星熊 | `chess_char_4_17_a` | 6 | TANK | NORMAL -> Mechanist | 炎 | <获得时>自身所属盟约层数+8（无需激活盟约） | <获得时>自身所属盟约层数+16（无需激活盟约） |
| 5 | 烛煌 | `chess_char_5_03_a` | 6 | CASTER | NORMAL -> Pith | 维多利亚/炎 | <获得时>【炎】【维多利亚】层数+5（无需激活盟约） | <获得时>【炎】【维多利亚】层数+10（无需激活盟约） |
| 5 | 夕 | `chess_char_5_12_a` | 6 | CASTER | NORMAL -> Raidian | 炎/奥术 | <休整期结束时>当前休整期每获得过一名干员，使已激活的【炎】【奥术】层数+2 | <休整期结束时>当前休整期每获得过一名干员，使已激活的【炎】【奥术】层数+4 |
| 5 | 录武官 | `chess_char_5_23_a` | 5 | MEDIC | PRESET | 炎/奇迹 | <获得时>【炎】层数+6、【奇迹】层数+3（无需激活盟约） | <获得时>【炎】层数+12、【奇迹】层数+6（无需激活盟约） |
| 6 | 余 | `chess_char_6_03_a` | 6 | TANK | NORMAL -> Mechanist | 炎/坚守 | <进入休整期时>若同一行有3名干员，随机获得1名当前人数最多盟约的干员 | <进入休整期时>随机获得1名当前人数最多盟约的干员 |
| 6 | 仇白 | `chess_char_6_15_a` | 6 | WARRIOR | NORMAL -> Raidian | 炎/突袭 | 【炎】【突袭】每叠加3层，本干员攻击束缚和停顿状态的敌人造成的伤害提升1% | 【炎】【突袭】每叠加3层，本干员攻击束缚和停顿状态的敌人造成的伤害提升2% |

### 3.2 萨尔贡 `sargonShip` (CORE)

- Data: identifier 2, icon `icon_sargonShip`, bondType SEASON, isPower True, powerIdList ['sargon'], activeCount 3, activeCondition BOARD, template count_threshold_upward, params ['3'], activeType BATTLE, noStack False, weight 10, bondOrder 2, isHiddenCharList False, effectId `bondeffect_sargon`, descParamBase ['base_time'] / perStack ['time_per_stack'].
- Active in modes: all 9 modes
- UI desc (bondInfoDict.desc):

  > 【萨尔贡】干员开启技能时，所有【萨尔贡】干员攻击速度提升（有上限），持续一定时间（受层数影响，每层持续时间独立计算）
  > <在场6名不同【萨尔贡】干员>开启技能还会为所有【萨尔贡】干员提供等持续时间的攻击力（有上限）
  > 选择策略【娜仁图亚】时，<在场6名不同【萨尔贡】干员>的效果会有所改变

- Detail desc (effectInfoDataDict, placeholders resolved):

  > 【萨尔贡】干员开启技能时，所有【萨尔贡】干员攻击速度+12（至多+300），持续(5+0.22×L)秒（受层数影响）
  > <在场6名不同【萨尔贡】干员>开启技能还会使所有【萨尔贡】干员攻击力+12%（至多+300%）
  > 选择策略【娜仁图亚】时，<在场6名不同【萨尔贡】干员>的效果会有所改变

- Buff blackboard(s):
  - `env_gbuff_new`: `{"key": "act1autochess_bond_eff_sargon", "base_time": 5.0, "time_per_stack": 0.22, "max_buff_stack_cnt": 25.0, "base_attack_speed": 12.0, "power_bond_char_cnt": 6.0, "base_atk": 0.12, "invalid_in_band": "band_narant"}`
  - `env_gbuff_new`: `{"key": "act2autochess_bond_eff_sargon[share]", "base_time": 5.0, "time_per_stack": 0.22, "max_buff_stack_cnt": 25.0, "base_attack_speed": 12.0, "power_bond_char_cnt": 6.0, "valid_in_band": "band_narant", "base_power_time": 60.0, "power_time_per_stack": 0.0, "filter_item_level": 5.0}`
  - act1 (上半) values for comparison: `[{"key": "act1autochess_bond_eff_sargon", "base_time": 5.0, "time_per_stack": 0.22, "max_buff_stack_cnt": 25.0, "base_attack_speed": 12.0, "power_bond_char_cnt": 6.0, "base_atk": 0.12}]`

**Implementable spec**

- **[3 distinct]** Whenever any 萨尔贡 member activates its skill, every 萨尔贡 member on the field gains one stack: ASPD +12 for (5 + 0.22*L) s. Each stack has its own timer; at most 25 concurrent stacks (=> +300 ASPD cap).
- **[6 distinct]** Each stack additionally gives ATK +12% (25 stacks => +300% cap), same duration.
- **[6 distinct AND strategy 娜仁图亚 (band_narant)]** Replaces the 6-member effect: when a 萨尔贡 member activates its skill, operators on its 8 surrounding tiles also enjoy the effects of the equipment (tier <= V, filter_item_level 5) it carries, for 60 s (base_power_time 60, power_time_per_stack 0).
- Formulas: `stackDurationSec = 5 + 0.22*L`; `aspdPerStack = 12`; `atkPerStack(6) = 0.12`; `maxStacks = 25`
- Caps: 25 stacks: +300 ASPD, +300% ATK
- How layers are gained: In battle on skill activation: 菲莱 +6 每次开技能, 百炼嘉维尔 +9 每次开技能, 莎草 +5 首次开技能, 缇缇 +1 萨尔贡/精准 per sleep/stun in range (<=24/battle); 艾丝黛尔 获得时 +2; 机变 "缇缇的盟誓" +10. Strategy 佩佩: after shop level 2/4/6 one special refresh preferring 萨尔贡.
- How it plays: Fast-cycling skills (萨尔贡浓茶 / 黄沙罗盘 items) keep many stacks alive; L mainly extends duration, so stacks overlap more.
- Note: PRTS: the in-level UI shows twice the real duration (display bug); real duration is 5+0.22L.
- [ASSUMED] When a 26th stack would be added, it replaces the stack with the shortest remaining time
- [ASSUMED] stack granted to all 萨尔贡 members including the caster
- Bond item (with 变形同构体 grants this bond): 萨尔贡浓茶 `chess_item_2_04_e` (2 gold: 技力自然回复速度+0.15/秒)
- Garrisons that explicitly add layers to this bond: `garrison_42`, `garrison_43`, `garrison_44`, `garrison_125`, `garrison_128` (see section 4; plus the generic ones)
- Garrisons that scale with this bond's layers: `garrison_09`, `garrison_10`, `garrison_15`, `garrison_100`

Members (12 chess, 10 in current shop pool; by tier in shop: {'1': 1, '2': 2, '3': 2, '4': 2, '5': 1, '6': 2}):

| Tier | Operator | chessId | ★ | Class | Type | Bonds | Trait (normal) | Trait (elite) |
|---|---|---|---|---|---|---|---|---|
| 1 | 艾丝黛尔 | `chess_char_1_12_a` | 4 | WARRIOR | PRESET | 萨尔贡 | <获得时>自身所属盟约层数+2（无需激活盟约） | <获得时>自身所属盟约层数+4（无需激活盟约） |
| 2 | 莎草 | `chess_char_2_06_a` | 5 | MEDIC | PRESET | 萨尔贡 | <战斗中>首次开启技能时，使已激活的【萨尔贡】层数+5 | <战斗中>首次开启技能时，使已激活的【萨尔贡】层数+10 |
| 2 | 泡泡 | `chess_char_2_08_a` | 4 | TANK | PRESET | 萨尔贡/坚守 | 【萨尔贡】【坚守】每叠加3层，本干员防御力+1% | 【萨尔贡】【坚守】每叠加3层，本干员防御力+2% |
| 3 | 菲莱 | `chess_char_3_06_a` | 5 | TANK | PRESET | 萨尔贡 | <战斗中>开启技能时，使已激活的【萨尔贡】层数+6 | <战斗中>开启技能时，使已激活的【萨尔贡】层数+12 |
| 3 | 至简 | `chess_char_3_13_a` | 5 | CASTER | PRESET | 萨尔贡/灵巧 | 购买价格为1 | 购买价格为1 |
| 4 | 蜜蜡 *(hidden)* | `chess_char_4_05_a` | 5 | CASTER | PRESET | 萨尔贡/助力 | <获得时>获得1件“迅捷作战粮” | <获得时>获得2件“迅捷作战粮” |
| 4 | 百炼嘉维尔 | `chess_char_4_23_a` | 6 | WARRIOR | NORMAL -> Sharp | 萨尔贡 | <战斗中>开启技能时，使已激活的【萨尔贡】层数+9 | <战斗中>开启技能时，使已激活的【萨尔贡】层数+18 |
| 4 | 卡涅利安 | `chess_char_4_24_a` | 6 | CASTER | NORMAL -> 预备干员-术师 | 萨尔贡/助力 | <获得时>获得1件“迅捷作战粮” | <获得时>获得2件“迅捷作战粮” |
| 5 | 缇缇 | `chess_char_5_02_a` | 6 | MEDIC | NORMAL -> 预备干员-术师 | 萨尔贡/精准 | <战斗中>每当范围内有敌人或干员进入沉睡或晕眩时，使已激活的【萨尔贡】【精准】层数+1（每场战斗至多24层） | <战斗中>每当范围内有敌人或干员进入沉睡或晕眩时，使已激活的【萨尔贡】【精准】层数+2（每场战斗至多48层） |
| 5 | 百炼嘉维尔 *(hidden)* | `chess_char_5_18_a` | 6 | WARRIOR | NORMAL -> Stormeye | 萨尔贡 | <战斗中>开启技能时，使已激活的【萨尔贡】层数+9 | <战斗中>开启技能时，使已激活的【萨尔贡】层数+18 |
| 6 | 异客 | `chess_char_6_05_a` | 6 | CASTER | NORMAL -> Stormeye | 萨尔贡/迅捷/精准 | 【萨尔贡】【迅捷】【精准】每叠加3层，本干员攻击力+2% | 【萨尔贡】【迅捷】【精准】每叠加3层，本干员攻击力+4% |
| 6 | 佩佩 | `chess_char_6_06_a` | 6 | WARRIOR | NORMAL -> Sharp | 萨尔贡/不屈 | <进入休整期时>获得1件“盟约之币”或“萨尔贡浓茶”，有小概率发现“黄沙罗盘” | <进入休整期时>获得2件“盟约之币”或“萨尔贡浓茶”，有概率发现“黄沙罗盘” |

### 3.3 维多利亚 `victoriaShip` (CORE)

- Data: identifier 3, icon `icon_victoriaShip`, bondType SEASON, isPower True, powerIdList ['victoria', 'glasgow'], activeCount 3, activeCondition BOARD, template count_threshold_upward, params ['3'], activeType BATTLE, noStack False, weight 10, bondOrder 2, isHiddenCharList False, effectId `bondeffect_victoria`, descParamBase ['base_damage_scale'] / perStack ['damage_scale_per_stack'].
- Active in modes: all 9 modes
- UI desc (bondInfoDict.desc):

  > 携带装备的【维多利亚】干员造成的伤害提升（受层数影响）
  > <每叠加25层>获得1件带有随机效果的维式重锤
  > <在场6名不同【维多利亚】干员>携带装备的【维多利亚】干员攻击力提升，携带进阶装备时额外提升

- Detail desc (effectInfoDataDict, placeholders resolved):

  > 携带装备的【维多利亚】干员伤害提升至(125+0.8×L)%（受层数影响）
  > <每叠加25层>获得一件带有随机特殊效果的维式重锤
  > <在场6名不同【维多利亚】干员>【维多利亚】干员每携带1件装备攻击力+50%，携带进阶装备改为+80%

- Buff blackboard(s):
  - `env_gbuff_new`: `{"key": "act1autochess_bond_eff_victoria", "damage_scale_per_stack": 0.008, "base_damage_scale": 1.25, "power_bond_char_cnt": 6.0, "atk_normal_equip": 0.5, "atk_golden_equip": 0.3}`
  - `bond_layer_added_reward_equip`: `{"layer": 25.0, "count": 1.0, "pool": "pool_equip_vict"}`
  - act1 (上半) values for comparison: `[{"key": "act1autochess_bond_eff_victoria", "damage_scale_per_stack": 0.008, "base_damage_scale": 1.2, "power_bond_char_cnt": 6.0, "power_atk": 0.8}, {"layer": 25.0, "count": 1.0, "pool": "pool_equip_vict"}]`

**Implementable spec**

- **[3 distinct]** 维多利亚 members that carry >= 1 equipment: all damage dealt x(1.25 + 0.008*L).
- **[every 25 layers (cumulative)]** Gain 1 维式重锤 with a random special effect (pool_equip_vict).
- **[6 distinct]** 维多利亚 members: ATK +50% per equipped item; an advanced (进阶/golden) item gives +80% instead (atk_normal_equip 0.5 + atk_golden_equip 0.3).
- Formulas: `damageMultiplier = 1.25 + 0.008*L (only if carrying equipment)`; `hammerPayouts = floor(L/25)`; `atkPerItem(6) = 0.5 normal, 0.8 advanced`
- Caps: none
- How layers are gained: 休整期结束: 薄绿 +2 per distinct tier of 维多利亚 on board, 维娜·维多利亚 +3 per distinct tier (and 奇迹 +2 per distinct tier of 奇迹), 刺玫 +1, 号角 +2 per distinct-tier operator of the highest-layer bond; in battle: 风笛 first 3 kills +2 维多利亚/远见/不屈; 烛煌 获得时 +5; 机变 "风笛的盟誓" +8. Strategy 哈洛德: from round 4 gain 1 维多利亚 operator every 2 rounds.
- How it plays: Field 维多利亚 of as many different tiers as possible (T1..T6) for 薄绿/维娜; hand all equipment (incl. free hammers) to 维多利亚 carries; 蒸汽之心 copies all hammer effects.
- [ASSUMED] pool_equip_vict = uniform random among 灼燃/坚固/加速/战栗维式重锤 (normal grade)
- [ASSUMED] hammer payout also counts layers added while the bond is inactive
- Bond item (with 变形同构体 grants this bond): 维式重锤 `chess_item_1_01_e` (1 gold: 攻击力+15%), 灼燃维式重锤 `chess_item_4_09_e` (2 gold: 攻击力+30%；造成法术伤害附带相当于10%伤害的灼燃损伤), 坚固维式重锤 `chess_item_3_09_e` (2 gold: 攻击力+25%；首次受到致命伤害时生命值不低于1，持续8秒), 加速维式重锤 `chess_item_3_10_e` (2 gold: 攻击力+25%；攻击速度+30), 战栗维式重锤 `chess_item_2_03_e` (2 gold: 攻击力+20%；若携带者是地面干员则攻击时有10%概率使目标战栗2秒)
- Garrisons that explicitly add layers to this bond: `garrison_35`, `garrison_48`, `garrison_50`, `garrison_53`, `garrison_139`, `garrison_154` (see section 4; plus the generic ones)
- Garrisons that scale with this bond's layers: `garrison_09`, `garrison_10`, `garrison_11`

Members (10 chess, 10 in current shop pool; by tier in shop: {'1': 1, '2': 2, '3': 1, '4': 2, '5': 2, '6': 2}):

| Tier | Operator | chessId | ★ | Class | Type | Bonds | Trait (normal) | Trait (elite) |
|---|---|---|---|---|---|---|---|---|
| 1 | 刺玫 | `chess_char_1_06_a` | 5 | MEDIC | PRESET | 维多利亚/助力 | <休整期结束时>使已激活的【维多利亚】层数+1 | <休整期结束时>使已激活的【维多利亚】层数+2 |
| 2 | 哈洛德 | `chess_char_2_05_a` | 5 | MEDIC | PRESET | 谢拉格/维多利亚 | 攻击力和生命值+20%；核心盟约每叠加3层，本干员攻击力和生命值+1% / 攻击力和生命值+20% | 攻击力和生命值+40%；核心盟约每叠加3层，本干员攻击力和生命值+2% / 攻击力和生命值+40% |
| 2 | 洛洛 | `chess_char_2_10_a` | 5 | CASTER | PRESET | 维多利亚/奥术 | <获得时>随机制造1件洛洛的定制品 | <获得时>随机制造2件洛洛的定制品 |
| 3 | 薄绿 | `chess_char_3_08_a` | 5 | CASTER | PRESET | 维多利亚 | <休整期结束时>场上每有1名不同阶的【维多利亚】干员，使已激活的【维多利亚】层数+2 | <休整期结束时>场上每有1名不同阶的【维多利亚】干员，使已激活的【维多利亚】层数+4 |
| 4 | 风笛 | `chess_char_4_07_a` | 6 | PIONEER | NORMAL -> 预备干员-近卫 | 维多利亚/远见/不屈 | <战斗中>前3次击倒敌人时，使已激活的【维多利亚】【远见】【不屈】层数+2 | <战斗中>前3次击倒敌人时，使已激活的【维多利亚】【远见】【不屈】层数+4 |
| 4 | 凯瑟琳 | `chess_char_4_11_a` | 5 | SUPPORT | PRESET | 维多利亚/灵巧 | <进入休整期时>若当前为奇数回合，获得1件随机装备 | <进入休整期时>若当前为奇数回合，获得2件随机装备 |
| 5 | 烛煌 | `chess_char_5_03_a` | 6 | CASTER | NORMAL -> Pith | 维多利亚/炎 | <获得时>【炎】【维多利亚】层数+5（无需激活盟约） | <获得时>【炎】【维多利亚】层数+10（无需激活盟约） |
| 5 | 号角 | `chess_char_5_08_a` | 6 | TANK | NORMAL -> Mechanist | 维多利亚 | <休整期结束时>当前已激活且层数最多的盟约每有1名不同阶干员在场，层数+2 | <休整期结束时>当前已激活且层数最多的盟约每有1名不同阶干员在场，层数+4 |
| 6 | 维娜·维多利亚 | `chess_char_6_07_a` | 6 | WARRIOR | NORMAL -> 领主·Sharp | 维多利亚/奇迹 | <休整期结束时>场上每有1名不同阶的【维多利亚】/【奇迹】干员使已激活的【维多利亚】层数+3/【奇迹】层数+2 / <休整期结束时>场上每有1名不同阶的【维多利亚】/【奇迹】干员使已激活的【维多利亚】层数+3/【奇迹】层数+2 | <休整期结束时>场上每有1名不同阶的【维多利亚】/【奇迹】干员使已激活的【维多利亚】层数+6/【奇迹】层数+4 / <休整期结束时>场上每有1名不同阶的【维多利亚】/【奇迹】干员使已激活的【维多利亚】层数+6/【奇迹】层数+4 |
| 6 | 焰影苇草 | `chess_char_6_08_a` | 6 | MEDIC | NORMAL -> Pith | 维多利亚/精准 | 【维多利亚】每叠加3层，本干员攻击速度+1 | 【维多利亚】每叠加3层，本干员攻击速度+2 |

### 3.4 谢拉格 `kjeragShip` (CORE)

- Data: identifier 4, icon `icon_kjeragShip`, bondType SEASON, isPower True, powerIdList ['kjerag', 'karlan'], activeCount 3, activeCondition BOARD, template count_threshold_upward, params ['3'], activeType BATTLE, noStack False, weight 10, bondOrder 2, isHiddenCharList False, effectId `bondeffect_kjerag`, descParamBase ['base_ex_damage_scale', 'bond_eff_kjerag[storm].base_time'] / perStack ['ex_damage_scale_per_stack', 'bond_eff_kjerag[storm].time_per_stack'].
- Active in modes: all 9 modes
- UI desc (bondInfoDict.desc):

  > 【谢拉格】干员造成的伤害提升，对寒冷、冻结敌人获得额外提升（受层数影响）
  > <在场6名不同【谢拉格】干员>战场上每25秒过一阵寒风使场上的敌人寒冷一定时间（受层数影响）

- Detail desc (effectInfoDataDict, placeholders resolved):

  > 【谢拉格】干员伤害提升至125%，对寒冷和冻结敌人额外提升至(135+1×L)%（受层数影响）
  > <在场6名不同【谢拉格】干员>战场上每25秒吹过一阵寒风使敌人寒冷(20+0.1×L)秒（受层数影响）

- Buff blackboard(s):
  - `env_gbuff_new`: `{"key": "act1autochess_bond_eff_kjerag", "base_damage_scale": 1.25, "base_ex_damage_scale": 1.35, "ex_damage_scale_per_stack": 0.01, "power_bond_char_cnt": 6.0, "bond_eff_kjerag[storm].interval": 25.0, "bond_eff_kjerag[storm].base_time": 20.0, "bond_eff_kjerag[storm].time_per_stack": 0.1}`
  - act1 (上半) values for comparison: `[{"key": "act1autochess_bond_eff_kjerag", "base_damage_scale": 1.3, "base_ex_damage_scale": 1.35, "ex_damage_scale_per_stack": 0.01, "power_bond_char_cnt": 6.0, "bond_eff_kjerag[storm].interval": 25.0, "bond_eff_kjerag[storm].base_time": 20.0, "bond_eff_kjerag[storm].time_per_stack": 0.1}]`

**Implementable spec**

- **[3 distinct]** 谢拉格 members deal damage x1.25; against enemies that are 寒冷 (cold) or 冻结 (frozen) x(1.35 + 0.01*L) instead.
- **[6 distinct]** Every 25 s a cold wind applies 寒冷 to every enemy on the field for (20 + 0.1*L) s.
- Formulas: `damageMultiplier = 1.25`; `damageMultiplierVsColdOrFrozen = 1.35 + 0.01*L`; `windIntervalSec = 25`; `windColdDurationSec = 20 + 0.1*L`
- Caps: none
- How layers are gained: In battle, freeze-driven: 初雪 and 银灰 - each enemy in range that becomes frozen: 50% chance +1; 凛御银灰 gives the 谢拉格 operator in front of it a 60% version (<=200/battle); 锏 部署时 +8 own active bonds (<=24/battle). 获得时: 角峰 +2, 崖心 +3 (hidden), 雪猎 +5, 灵知 +5, 锏 +8. 机变 "银灰的盟誓" +8. Strategy 休露丝: first 谢拉格 bought each round costs 1.
- How it plays: Standard AK rule: applying 寒冷 to an already-cold enemy freezes it. The 6-member wind + cold-on-hit sources (谢拉格不融冰 12% 1.5 s cold) create constant freezes, so layers can reach hundreds per battle.
- Note: 巴哈姆特: avoid lighting 3 奥术 alongside max-layer 谢拉格 (圣聆初雪 gets damage-capped).
- [ASSUMED] first wind at t = 25 s
- [ASSUMED] wind re-applying cold on a cold enemy triggers freeze like any cold source
- Bond item (with 变形同构体 grants this bond): 谢拉格不融冰 `chess_item_5_02_e` (2 gold: 攻击时有12%概率对目标施加1.5秒的寒冷)
- Garrisons that explicitly add layers to this bond: `garrison_28`, `garrison_29` (see section 4; plus the generic ones)
- Garrisons that scale with this bond's layers: `garrison_05`, `garrison_09`, `garrison_10`

Members (12 chess, 10 in current shop pool; by tier in shop: {'1': 1, '2': 1, '3': 3, '4': 2, '5': 1, '6': 2}):

| Tier | Operator | chessId | ★ | Class | Type | Bonds | Trait (normal) | Trait (elite) |
|---|---|---|---|---|---|---|---|---|
| 1 | 角峰 | `chess_char_1_02_a` | 4 | TANK | PRESET | 谢拉格/坚守 | <获得时>自身所属盟约层数+2（无需激活盟约） | <获得时>自身所属盟约层数+4（无需激活盟约） |
| 2 | 崖心 *(hidden)* | `chess_char_2_03_a` | 5 | SPECIAL | PRESET | 谢拉格/不屈 | <获得时>自身所属盟约层数+3（无需激活盟约） | <获得时>自身所属盟约层数+6（无需激活盟约） |
| 2 | 哈洛德 | `chess_char_2_05_a` | 5 | MEDIC | PRESET | 谢拉格/维多利亚 | 攻击力和生命值+20%；核心盟约每叠加3层，本干员攻击力和生命值+1% / 攻击力和生命值+20% | 攻击力和生命值+40%；核心盟约每叠加3层，本干员攻击力和生命值+2% / 攻击力和生命值+40% |
| 3 | 雪猎 | `chess_char_3_11_a` | 5 | SNIPER | PRESET | 谢拉格/精准 | <获得时>自身所属盟约层数+5（无需激活盟约） | <获得时>自身所属盟约层数+10（无需激活盟约） |
| 3 | 初雪 | `chess_char_3_14_a` | 5 | SUPPORT | PRESET | 谢拉格/远见 | <战斗中>每当范围内1名敌人进入冻结时，有50%概率使已激活的【谢拉格】层数+1 | <战斗中>每当范围内1名敌人进入冻结时，有50%概率使已激活的【谢拉格】层数+2 |
| 3 | 耶拉 | `chess_char_3_20_a` | 5 | CASTER | PRESET | 谢拉格/助力 | <获得时>获得1件“谢拉格不融冰” | <获得时>获得2件“谢拉格不融冰” |
| 4 | 耶拉 *(hidden)* | `chess_char_4_03_a` | 5 | CASTER | PRESET | 谢拉格/助力 | <获得时>获得1件“谢拉格不融冰” | <获得时>获得2件“谢拉格不融冰” |
| 4 | 灵知 | `chess_char_4_13_a` | 6 | SUPPORT | NORMAL -> Raidian | 谢拉格/灵巧 | <获得时>自身所属盟约层数+5（无需激活盟约） | <获得时>自身所属盟约层数+10（无需激活盟约） |
| 4 | 银灰 | `chess_char_4_22_a` | 6 | WARRIOR | NORMAL -> Sharp | 谢拉格 | <战斗中>每当范围内1名敌人进入冻结时，有50%概率使已激活的【谢拉格】层数+1 | <战斗中>每当范围内1名敌人进入冻结时，有50%概率使已激活的【谢拉格】层数+2 |
| 5 | 凛御银灰 | `chess_char_5_14_a` | 6 | PIONEER | NORMAL -> 郁金香 | 谢拉格/投资人/迅捷 | <战斗开始时>使身前一格【谢拉格】干员获得特质“范围内1名敌人进入冻结时，有60%概率使已激活的【谢拉格】层数+1” | <战斗开始时>使身前一格【谢拉格】干员获得特质“范围内1名敌人进入冻结时，有60%概率使已激活的【谢拉格】层数+2” |
| 6 | 圣聆初雪 | `chess_char_6_02_a` | 6 | CASTER | NORMAL -> 郁金香 | 谢拉格/奥术 | 【谢拉格】【奥术】每叠加3层，本干员攻击力+1% | 【谢拉格】【奥术】每叠加3层，本干员攻击力+2% |
| 6 | 锏 | `chess_char_6_19_a` | 6 | WARRIOR | NORMAL -> Misery | 谢拉格/卡西米尔/迅捷 | <获得时>自身所属的盟约层数+8<br><部署时>使自身已激活的盟约层数+8（至多24层） / <获得时>自身所属盟约层数+8（无需激活盟约） | <获得时>自身所属的盟约层数+16<br><部署时>使自身已激活的盟约层数+16（至多48层） / <获得时>自身所属盟约层数+16（无需激活盟约） |

### 3.5 拉特兰 `lateranoShip` (CORE)

- Data: identifier 5, icon `icon_lateranoShip`, bondType SEASON, isPower True, powerIdList ['laterano'], activeCount 3, activeCondition BOARD, template count_threshold_upward, params ['3'], activeType BATTLE, noStack False, weight 10, bondOrder 2, isHiddenCharList False, effectId `bondeffect_laterano`, descParamBase ['base_ammo_percent'] / perStack ['ammo_percent_per_stack'].
- Active in modes: mode_training_1, mode_single_normal, mode_single_hard, mode_single_abyss, mode_multi_normal, mode_multi_hard, mode_multi_abyss
- UI desc (bondInfoDict.desc):

  > 【拉特兰】干员开启技能获得的弹药量提升（受层数影响）
  > <在场6名不同【拉特兰】干员>【拉特兰】干员每消耗1发弹药，所有【拉特兰】干员攻击力提升（有上限）

- Detail desc (effectInfoDataDict, placeholders resolved):

  > 【拉特兰】干员开启技能时获得的弹药量+(5+1.5×L)%（受层数影响）
  > <在场6名不同【拉特兰】干员>任意【拉特兰】干员每消耗1发弹药，全体【拉特兰】干员攻击力+4%，至多+200%

- Buff blackboard(s):
  - `env_gbuff_new`: `{"key": "act1autochess_bond_eff_laterano", "base_ammo_percent": 0.05, "ammo_percent_per_stack": 0.015, "power_bond_char_cnt": 6.0, "atk_per_consume": 0.04, "max_atk_for_consume": 2.0}`
  - act1 (上半) values for comparison: `[{"key": "act1autochess_bond_eff_laterano", "base_ammo_percent": 0.05, "ammo_percent_per_stack": 0.015, "power_bond_char_cnt": 6.0, "atk_per_consume": 0.04, "max_atk_for_consume": 1.8}]`

**Implementable spec**

- **[3 distinct]** When a 拉特兰 member activates a skill that grants ammo, ammo gained x(1 + 0.05 + 0.015*L), rounded down.
- **[6 distinct]** Every ammo consumed by any 拉特兰 member: all 拉特兰 members ATK +4% (until battle end), max +200% (= 50 ammo).
- Formulas: `ammoMultiplier = floor(baseAmmo * (1.05 + 0.015*L))`; `atkPerAmmo(6) = 0.04`; `atkCap(6) = 2.0`
- Caps: +200% ATK from the 6-member effect
- How layers are gained: Ammo consumption in battle: 圣约送葬人 each 7 bullets +7 拉特兰 (7 triggers => 49/battle) and +3 远见 (<=21/battle); 莫斯提马 ops in its 4 adjacent tiles each 6 ammo +1; 蕾缪安 each 10 bullets with 3 ops in its row +2 拉特兰/精准; 送葬人 first kill +3 精准/拉特兰. Prep: 空弦 进入休整期 +3 to self and front tile operator's active bonds. 机变 "莫斯提马的盟誓" +10. Strategy 潘格尼尼: after spending 55 gold gain a random elite T4+ 拉特兰.
- How it plays: Only ammo-skill operators benefit from the 3-tier; the bond is weak until 6 (巴哈姆特: "3人效果較差").
- [ASSUMED] non-ammo skills unaffected
- [ASSUMED] "ammo consumed" = each shot/bullet decrement
- Bond item (with 变形同构体 grants this bond): 拉特兰桥夹 `chess_item_4_08_e` (1 gold: 子弹类技能剩余一发子弹时有50%概率恢复40%的子弹（每次部署最多触发3次）)
- Garrisons that explicitly add layers to this bond: `garrison_20`, `garrison_22`, `garrison_23`, `garrison_24`, `garrison_138` (see section 4; plus the generic ones)
- Garrisons that scale with this bond's layers: `garrison_09`, `garrison_10`, `garrison_14`, `garrison_16`

Members (11 chess, 10 in current shop pool; by tier in shop: {'1': 1, '2': 1, '3': 2, '4': 2, '5': 1, '6': 3}):

| Tier | Operator | chessId | ★ | Class | Type | Bonds | Trait (normal) | Trait (elite) |
|---|---|---|---|---|---|---|---|---|
| 1 | 隐现 | `chess_char_1_01_a` | 5 | SNIPER | PRESET | 拉特兰/迅捷 | 【拉特兰】每叠加5层，本干员攻击速度+1 | 【拉特兰】每叠加5层，本干员攻击速度+2 |
| 2 | 送葬人 | `chess_char_2_01_a` | 5 | SNIPER | PRESET | 拉特兰/精准 | <战斗中>首次击倒敌人时，使已激活的【精准】【拉特兰】层数+3 | <战斗中>首次击倒敌人时，使已激活的【精准】【拉特兰】层数+6 |
| 3 | 能天使 | `chess_char_3_01_a` | 6 | SNIPER | NORMAL -> 预备干员-狙击 | 拉特兰/奇迹 | <获得时>使下个休整期额外获得1资金 | <获得时>使下个休整期额外获得2资金 |
| 3 | 见行者 *(hidden)* | `chess_char_3_07_a` | 5 | SPECIAL | PRESET | 拉特兰 | <休整期结束时>使自身及身后一格干员的已激活盟约分别各层数+3 | <休整期结束时>使自身及身后一格干员的已激活盟约分别各层数+6 |
| 3 | 空弦 | `chess_char_3_21_a` | 6 | SNIPER | NORMAL -> Stormeye | 拉特兰/灵巧 | <进入休整期时>使自身及身前一格干员的已激活盟约分别各层数+3 | <进入休整期时>使自身及身前一格干员的已激活盟约分别各层数+6 |
| 4 | 信仰搅拌机 | `chess_char_4_01_a` | 6 | TANK | PRESET | 拉特兰/坚守 | 【拉特兰】【坚守】每叠加3层，本干员防御力+1% | 【拉特兰】【坚守】每叠加3层，本干员防御力+2% |
| 4 | 莫斯提马 | `chess_char_4_02_a` | 6 | CASTER | NORMAL -> Stormeye | 拉特兰/奥术 | <战斗中>自身周围4格的干员每消耗6发弹药，使已激活的【拉特兰】层数+1 | <战斗中>自身周围4格的干员每消耗6发弹药，使已激活的【拉特兰】层数+2 |
| 5 | 圣约送葬人 | `chess_char_5_01_a` | 6 | WARRIOR | NORMAL -> 预备干员-先锋 | 拉特兰/远见 | <战斗中>自身每消耗7发子弹，使已激活的【拉特兰】层数+7、【远见】层数+3（每场战斗分别至多触发7次） | <战斗中>自身每消耗7发子弹，使已激活的【拉特兰】层数+14、【远见】层数+6（每场战斗至多触发7次） |
| 6 | 蕾缪安 | `chess_char_6_01_a` | 6 | SNIPER | NORMAL -> Stormeye | 拉特兰/精准 | <战斗中>自身每消耗10发子弹，若同一行有3名干员，使已激活的【拉特兰】【精准】层数+2 | <战斗中>自身每消耗10发子弹，若同一行有3名干员，使已激活的【拉特兰】【精准】层数+4 |
| 6 | 塑心 | `chess_char_6_09_a` | 6 | SUPPORT | NORMAL -> Touch | 拉特兰 | <战斗中>开启技能时，同一行每有1名干员，当前已激活且层数最多的盟约层数+1（每场作战至多10层） | <战斗中>开启技能时，同一行每有1名干员，当前已激活且层数最多的盟约层数+2（每场作战至多20层） |
| 6 | 新约能天使 | `chess_char_6_13_a` | 6 | SPECIAL | NORMAL -> Misery | 拉特兰 | <获得时>使下个休整期额外获得2资金 | <获得时>使下个休整期额外获得4资金 |

### 3.6 阿戈尔 `egirShip` (CORE)

- Data: identifier 6, icon `icon_egirShip`, bondType SEASON, isPower True, powerIdList ['egir', 'abyssal'], activeCount 3, activeCondition BOARD, template count_threshold_upward, params ['3'], activeType BATTLE, noStack False, weight 10, bondOrder 2, isHiddenCharList False, effectId `bondeffect_egir`, descParamBase ['base_max_hp'] / perStack ['max_hp_per_stack'].
- Active in modes: mode_training_1, mode_single_normal, mode_single_hard, mode_single_abyss, mode_multi_normal, mode_multi_hard, mode_multi_abyss
- UI desc (bondInfoDict.desc):

  > 【阿戈尔】干员生命值提升（受层数影响）
  > 战斗开始时，【阿戈尔】干员会吞噬身前一格干员对其造成5000点物理伤害并获得其基础攻击力和阻挡数，使【阿戈尔】叠加等于被吞噬者等阶的盟约层数（【阿戈尔】之间优先更靠左和靠上的干员发起吞噬）
  > <在场5名不同【阿戈尔】干员>前3名【阿戈尔】干员首次被击倒时立刻复活

- Detail desc (effectInfoDataDict, placeholders resolved):

  > 【阿戈尔】干员生命值+(35+1×L)%（受层数影响）
  > 战斗开始时【阿戈尔】干员依次吞噬身前一格干员造成5000点物理伤害并获得其基础攻击力和阻挡数，并叠加等于被吞噬者等阶的盟约层数（【阿戈尔】之间优先更靠左和靠上的干员发起吞噬）
  > <在场5名不同【阿戈尔】干员>前3名【阿戈尔】干员首次被击倒时立刻复活

- Buff blackboard(s):
  - `env_gbuff_new`: `{"key": "act1autochess_bond_eff_egir", "base_max_hp": 0.35, "max_hp_per_stack": 0.01, "bond_type": "bond_by_id", "bond_id": "egirShip", "bond_add_type": "by_charlevel", "damage_value": 5000.0, "power_bond_char_cnt": 5.0, "max_free_respawn_cnt": 3.0}`
  - act1 (上半) values for comparison: `[{"key": "act1autochess_bond_eff_egir", "base_max_hp": 0.35, "max_hp_per_stack": 0.01, "bond_type": "bond_by_id", "bond_id": "egirShip", "bond_add_type": "by_charlevel", "damage_value": 6000.0, "power_bond_char_cnt": 5.0, "max_free_respawn_cnt": 2.0}]`

**Implementable spec**

- **[3 distinct]** 阿戈尔 members maxHP x(1 + 0.35 + 0.01*L).
- **[3 distinct (battle start)]** Devour (吞噬): see algorithm.
- **[5 distinct]** The first 3 阿戈尔 members by position — the devour order below (step 1), i.e. the deployment order, fixed at battle start — each revive immediately on their own first knock-out, whatever the order of knock-outs (max_free_respawn_cnt 3; PRTS 阿戈尔 备注 "从最先部署（更靠左和靠上的）的【阿戈尔】干员开始", players' videos; until 0.1.3 the remake gave them to the first 3 members knocked out). A devour knock-out of one of them spends its revive (it stays standing, step 4); any other member the devour knocks out stays down.
- Algorithm:
  1. Order: 阿戈尔 members sorted leftmost first, then topmost ("更靠左和靠上").
  2. Each 阿戈尔 in order marks the unit on the tile directly in front of it (its facing direction) and also the front-tile unit of every 阿戈尔 it has marked (chain). It never marks itself, a unit it already marked, or a unit that marked it.
  3. The marker immediately gains the base ATK of every unit it marked (added to base ATK at the final stage) and their block counts.
  4. After all marks are placed, each mark makes its target suffer one 5000-point physical 流失 (HP loss, source = the target itself; if it dies, the kill is credited to the marker), resolved in marking order. A target knocked out for the first time has its pending marks cancelled ("目标首次被击倒后解除自身被付与但还未触发的【吞噬】效果") — also when it is back at once (the 5-tier revive, 不屈's 立刻重新部署, 埃芒加德, M3茧甲), so a revived member is not devoured again. DESIGN §22.3.
  5. Each devoured unit adds layers to 阿戈尔 equal to its tier (1-6), once per unit per battle.
  6. (5-member tier) Revive is implemented as: when the unit leaves the field for any reason other than being moved, its next deployment has 0 redeploy time and 0 cost (PRTS). Devour layers: each devoured unit adds its tier once per battle (refreshes next round).
- Formulas: `hpMultiplier = 1.35 + 0.01*L`; `devourDamage = 5000`; `layersPerDevoured = tier of devoured unit`
- Caps: 3 revives per battle
- How layers are gained: Devour (tier per devoured unit, every battle); 幽灵鲨 被击倒 +3; 归溟幽灵鲨 被击倒/替身切换 +5 阿戈尔 +5 不屈; 斯卡蒂 each 2 kills +1 阿戈尔/坚守/突袭; 海霓 first kill (enemy or ally) +3 阿戈尔/奥术; 机变 "斯卡蒂的盟誓" +8. Strategy 克莱门莎: an 阿戈尔 knocked out adds layers = its tier.
- How it plays: Put cheap/high-tier fodder in front of 阿戈尔 carries: they steal base ATK and block, gain layers, and (5) revive. Tier-6 fodder gives +6 layers per battle.
- 5000 physical 流失: less the target's DEF (PRTS 作战机制: a 物理/法术流失 "会受到目标当前防御力/法术抗性影响而相应衰减"; DEF-free [ASSUMED] until 0.1.1), no shields, dodge or damage multipliers (a 流失)
- [ASSUMED] marked allied units are the player's own operators (devour hits allies)
- Bond item (with 变形同构体 grants this bond): 阿戈尔重刃 `chess_item_3_07_e` (2 gold: 攻击力+40%，攻击速度-10)
- Garrisons that explicitly add layers to this bond: `garrison_38`, `garrison_40`, `garrison_46`, `garrison_131` (see section 4; plus the generic ones)
- Garrisons that scale with this bond's layers: `garrison_07`, `garrison_09`, `garrison_10`, `garrison_12`, `garrison_84`

Members (9 chess, 9 in current shop pool; by tier in shop: {'1': 1, '2': 1, '3': 2, '4': 2, '5': 2, '6': 1}):

| Tier | Operator | chessId | ★ | Class | Type | Bonds | Trait (normal) | Trait (elite) |
|---|---|---|---|---|---|---|---|---|
| 1 | 深巡 | `chess_char_1_04_a` | 5 | TANK | PRESET | 阿戈尔 | 攻击海怪敌人时攻击力提升至150% | 攻击海怪敌人时攻击力提升至200% |
| 2 | 幽灵鲨 | `chess_char_2_07_a` | 5 | WARRIOR | PRESET | 阿戈尔 | <战斗中>自身被击倒时，使已激活的【阿戈尔】层数+3 | <战斗中>自身被击倒时，使已激活的【阿戈尔】层数+6 |
| 3 | 斯卡蒂 | `chess_char_3_05_a` | 6 | WARRIOR | NORMAL -> 预备干员-近卫 | 阿戈尔/坚守/突袭 | <战斗中>每击倒2名单位时，使已激活的【阿戈尔】【坚守】【突袭】层数+1 | <战斗中>每击倒2名敌人时，使已激活的【阿戈尔】【坚守】【突袭】层数+2 |
| 3 | 海霓 | `chess_char_3_09_a` | 5 | SUPPORT | PRESET | 阿戈尔/奥术 | <战斗中>首次击倒敌人或我方干员时，使已激活的【阿戈尔】【奥术】层数+3 | <战斗中>首次击倒敌人或我方干员时，使已激活的【阿戈尔】【奥术】层数+6 |
| 4 | 水月 | `chess_char_4_09_a` | 6 | SPECIAL | NORMAL -> 领主·Sharp | 阿戈尔/独行 | 【阿戈尔】每叠加3层，本干员攻击力+1% | 【阿戈尔】每叠加3层，本干员攻击力+2% |
| 4 | 歌蕾蒂娅 | `chess_char_4_12_a` | 6 | SPECIAL | PRESET | 阿戈尔 | <进入休整期时>若同一行有3名干员，获得1个斯卡蒂、幽灵鲨或深巡 | <进入休整期时>若同一行有3名干员，获得1个斯卡蒂、幽灵鲨或深巡，重复2次 |
| 5 | 乌尔比安 | `chess_char_5_05_a` | 6 | WARRIOR | NORMAL -> 预备干员-重装 | 阿戈尔 | 【阿戈尔】每叠加2层，本干员攻击力+1% | 【阿戈尔】每叠加2层，本干员攻击力+2% |
| 5 | 归溟幽灵鲨 | `chess_char_5_13_a` | 6 | SPECIAL | NORMAL -> Sharp | 阿戈尔/不屈 | <战斗中>自身被击倒或替身与本体进行切换时，使已激活的【阿戈尔】层数+5、【不屈】层数+5 | <战斗中>自身被击倒或替身与本体进行切换时，使已激活的【阿戈尔】层数+10、【不屈】层数+10 |
| 6 | 浊心斯卡蒂 | `chess_char_6_04_a` | 6 | SUPPORT | NORMAL -> Raidian | 阿戈尔 | 【阿戈尔】每叠加10层，本干员每秒回复50生命，自然技力回复速度+0.15/秒 | 【阿戈尔】每叠加10层，本干员每秒回复100生命，自然技力回复速度+0.3/秒 |

### 3.7 叙拉古 `siracusaShip` (CORE)

- Data: identifier 7, icon `icon_siracusaShip`, bondType SEASON, isPower True, powerIdList ['siracusa', 'chiave'], activeCount 3, activeCondition BOARD, template count_threshold_upward, params ['3'], activeType BATTLE, noStack False, weight 10, bondOrder 2, isHiddenCharList False, effectId `bondeffect_siracusa`, descParamBase ['base_attack_speed', 'base_duration', 'base_damage'] / perStack ['attack_speed_per_stack', 'duration_per_stack', 'damage_per_stack'].
- Active in modes: all 9 modes
- UI desc (bondInfoDict.desc):

  > 【叙拉古】干员部署后攻击速度提升，持续一定时间（受层数影响）
  > <在场6名不同【叙拉古】干员>【叙拉古】干员部署后进入等时长的隐匿状态，【叙拉古】干员隐匿状态下和脱离隐匿10秒内对敌人攻击时有3%的概率造成一定真实伤害（受层数影响）并恐惧3秒

- Detail desc (effectInfoDataDict, placeholders resolved):

  > 【叙拉古】干员部署后攻击速度+(25+0.8×L)，持续(32+0.4×L)秒（受层数影响）
  > <在场6名不同【叙拉古】干员>【叙拉古】干员部署后还会进入等时长的隐匿状态，【叙拉古】干员在隐匿状态和脱离隐匿10秒内对敌人攻击时有3%概率造成(5000+50×L)（受层数影响）点真实伤害并恐惧目标3秒

- Buff blackboard(s):
  - `env_gbuff_new`: `{"key": "act2autochess_bond_eff_siracusa", "base_duration": 32.0, "duration_per_stack": 0.4, "base_attack_speed": 25.0, "attack_speed_per_stack": 0.8, "power_bond_char_cnt": 6.0, "ex_bond_char_cnt": 6.0, "end_duration": 10.0, "prob": 0.03, "base_damage": 5000.0, "damage_per_stack": 50.0, "fear": 3.0}`

**Implementable spec**

- **[3 distinct]** After every deployment (incl. redeploy) a 叙拉古 member gains ASPD +(25 + 0.8*L) for (32 + 0.4*L) s.
- **[6 distinct]** After deployment also 隐匿 (camouflage) for the same duration. While camouflaged and for 10 s after it ends, each normal damage instance (普通伤害 = attack type NORMAL: attacks, skill hits, drone attacks; not 溅射 / 持续 / 附加 — `bonds/core.js siracusaRolls`) it deals may add (5000 + 50*L) true damage (source = the operator) and 恐惧 (fear) 3 s. Nominal 3% chance, implemented as pseudo-random: all 叙拉古 members share one counter; attempt n since last proc succeeds with p = 0.00139*n (guaranteed at n = 720); counter resets on proc.
- Formulas: `aspd = 25 + 0.8*L`; `durationSec = 32 + 0.4*L`; `procDamage = 5000 + 50*L`; `prdStep = 0.00139`
- Caps: none
- How layers are gained: Shop refresh-driven: 拉普兰德 first manual refresh each round +4 (works from bench); 安洁莉娜 休整期结束 +4 per refresh this round (<=12/round); 阿罗玛 +2 叙拉古/奥术 per refresh (<=6); 伺夜 first 3 kills +2 叙拉古 +1 奇迹; 荒芜拉普兰德 each kill +2 (elite: every 叙拉古 gets this, <=100/battle); 忍冬 获得时 +6 own bonds (x2/x3 with 投资人); 机变 "德克萨斯的盟誓" +10. Strategy 贾维: every 6 manual refreshes get a free 叙拉古 (<=2/round).
- How it plays: Refresh a lot in prep (free refresh sources: 普罗旺斯, 德克萨斯, 缄默德克萨斯, 巫恋) to feed 拉普兰德/安洁莉娜; pair with 投资人 for 忍冬.
- Note: PRTS: the 10 s post-stealth window restarts if the operator's status effects or immunities change.
- [ASSUMED] 隐匿 = standard AK camouflage (not targeted by ranged enemies unless blocking)
- Bond item (with 变形同构体 grants this bond): 叙拉古正装 `chess_item_3_01_e` (2 gold: 攻击速度+15，携带者部署方向左右两侧的我方干员攻击速度+10)
- Garrisons that explicitly add layers to this bond: `garrison_118`, `garrison_122`, `garrison_123`, `garrison_146`, `garrison_147`, `garrison_152` (see section 4; plus the generic ones)
- Garrisons that scale with this bond's layers: `garrison_09`, `garrison_10`, `garrison_129`

Members (11 chess, 10 in current shop pool; by tier in shop: {'1': 2, '2': 1, '3': 2, '4': 2, '5': 2, '6': 1}):

| Tier | Operator | chessId | ★ | Class | Type | Bonds | Trait (normal) | Trait (elite) |
|---|---|---|---|---|---|---|---|---|
| 1 | 普罗旺斯 | `chess_char_1_07_a` | 5 | SNIPER | PRESET | 叙拉古 | <获得时>获得1次免费刷新 | <获得时>获得2次免费刷新 |
| 1 | 德克萨斯 | `chess_char_1_08_a` | 5 | PIONEER | PRESET | 独行/叙拉古 | <售出时>获得1次免费刷新 | <售出时>获得2次免费刷新 |
| 2 | 拉普兰德 | `chess_char_2_16_a` | 5 | WARRIOR | PRESET | 叙拉古 | <刷新时>若为本回合首次主动刷新，使已激活的【叙拉古】层数+4，此干员在整备区时也有效 | <刷新时>若为本回合首次主动刷新，使已激活的【叙拉古】层数+8，此干员在整备区时也有效 |
| 3 | 巫恋 *(hidden)* | `chess_char_3_15_a` | 5 | SUPPORT | PRESET | 叙拉古/助力 | <售出时>获得2次免费刷新 | <售出时>获得4次免费刷新 |
| 3 | 忍冬 | `chess_char_3_18_a` | 6 | PIONEER | NORMAL -> Sharp | 叙拉古/迅捷 | <获得时>自身所属盟约层数+6（无需激活盟约） | <获得时>自身所属盟约层数+12（无需激活盟约） |
| 3 | 伺夜 | `chess_char_3_19_a` | 6 | PIONEER | PRESET | 叙拉古/奇迹 | <战斗中>造成的伤害变为弱点伤害（基于敌人的防御力和法术抗性变换物理和法术伤害），前3次击倒敌人时使已激活的【叙拉古】层数+2、【奇迹】层数+1 / <战斗中>造成的伤害变为弱点伤害（基于敌人的防御力和法术抗性变换物理和法术伤害） | <战斗中>造成的伤害变为弱点伤害（基于敌人的防御力和法术抗性变换物理和法术伤害），前3次击倒敌人时使已激活的【叙拉古】层数+4、【奇迹】层数+2 / <战斗中>造成的伤害变为弱点伤害（基于敌人的防御力和法术抗性变换物理和法术伤害） |
| 4 | 阿罗玛 | `chess_char_4_10_a` | 5 | CASTER | PRESET | 叙拉古/奥术 | <休整期结束时>本回合每刷新过1次，使已激活的【叙拉古】【奥术】层数+2（至多6层） | <休整期结束时>本回合每刷新过1次，使已激活的【叙拉古】【奥术】层数+4（每回合至多12层） |
| 4 | 缄默德克萨斯 | `chess_char_4_16_a` | 6 | SPECIAL | NORMAL -> Misery | 叙拉古/突袭 | <进入休整期时>获得1次免费刷新 | <进入休整期时>获得2次免费刷新 |
| 5 | 铃兰 | `chess_char_5_10_a` | 6 | SUPPORT | NORMAL -> 预备干员-辅助 | 叙拉古/协防干员 | <进入休整期时>触发身前一格的其他干员的“获得时”类效果 | <进入休整期时>触发身前两格的其他干员的“获得时”类效果 |
| 5 | 安洁莉娜 | `chess_char_5_20_a` | 6 | SUPPORT | NORMAL -> Raidian | 叙拉古/奇迹 | <休整期结束时>本回合每刷新过1次，使已激活的【叙拉古】层数+4（每回合至多12层） | <休整期结束时>本回合每刷新过1次，使已激活的【叙拉古】层数+8（每回合至多24层） |
| 6 | 荒芜拉普兰德 | `chess_char_6_18_a` | 6 | CASTER | NORMAL -> Pith | 叙拉古 | <战斗中>击倒敌人时，使已激活的【叙拉古】层数+2<br>将荒芜拉普兰德合成为精锐即可在战斗中使所有【叙拉古】干员获得该效果 | <战斗开始时>使所有【叙拉古】干员获得特质“击倒敌人时，使已激活的【叙拉古】层数+2” |

### 3.8 卡西米尔 `kazimierzShip` (CORE)

- Data: identifier 8, icon `icon_kazimierzShip`, bondType SEASON, isPower True, powerIdList ['kazimierz', 'pinus'], activeCount 3, activeCondition BOARD, template count_threshold_upward, params ['3'], activeType BATTLE, noStack False, weight 10, bondOrder 2, isHiddenCharList False, effectId `bondeffect_kazimierz`, descParamBase ['base_max_atk_when_born'] / perStack ['max_atk_when_born_per_stack'].
- Active in modes: mode_training_1, mode_single_normal, mode_single_hard, mode_single_abyss, mode_multi_normal, mode_multi_hard, mode_multi_abyss
- UI desc (bondInfoDict.desc):

  > 每次有干员部署时，【卡西米尔】干员攻击力+20%持续至战斗结束（上限受层数影响）
  > <在场6名不同【卡西米尔】干员>【卡西米尔】干员阻挡敌人时每2秒对周围敌人造成120%攻击力真实伤害和0.1秒晕眩，未阻挡敌人时攻击附带30%攻击力的真实伤害

- Detail desc (effectInfoDataDict, placeholders resolved):

  > 每次有干员部署时【卡西米尔】干员攻击力+20%（至多+(50+1×L)%）（受层数影响）
  > <在场6名不同【卡西米尔】干员>【卡西米尔】干员阻挡敌人时每2秒对周围敌人造成120%攻击力真实伤害和0.1秒晕眩，未阻挡敌人时攻击附带30%攻击力的真实伤害

- Buff blackboard(s):
  - `env_gbuff_new`: `{"key": "act2autochess_bond_eff_kazimierz", "atk_when_born": 0.2, "base_max_atk_when_born": 0.5, "max_atk_when_born_per_stack": 0.01, "damage_interval": 2.0, "damage_atk_scale": 1.2, "stun": 0.1, "range_radius": 0.8, "power_bond_char_cnt": 6.0, "pure_atk_scale": 0.3}`

**Implementable spec**

- **[3 distinct]** Every time any friendly operator is deployed (incl. redeploys) each 卡西米尔 member gains ATK +20% until battle end, capped at +(50 + 1*L)%.
- **[6 distinct]** While blocking >= 1 enemy: every 2 s deals 120% ATK true damage to all enemies within radius 0.8 tiles and stuns them 0.1 s. While not blocking: each normal damage instance adds 30% ATK sourceless true damage.
- Formulas: `atkPerDeploy = 0.20`; `atkCap = 0.50 + 0.01*L`
- Caps: ATK bonus cap 50%+1%/layer
- How layers are gained: Deploy-driven in battle: 砾 部署时 +1; 瑕光 部署时 +4 own active bonds (<=12/battle); 远牙 grants the right-most operator in its row "部署时 +4 卡西米尔/精准 (<=24/battle)"; 锏 部署时 +8 (<=24); 获得时: 野鬃 +2, 灰毫 +3 to highest-layer bond; 机变 "玛恩纳的盟誓" +12. Strategy 玛恩纳: +1 gold next round per 卡西米尔 bought (<=3).
- How it plays: Maximise deploy events: low redeploy time (助力 -30%, 骑士戒律), operators that die/retreat and come back (砾 + 不屈). 巴哈姆特: do not light 坚守 (damage sharing keeps 砾 alive).
- [ASSUMED] initial auto-deployments at battle start also count as deploys
- [ASSUMED] buff applies to members deployed later too (stored globally, capped)
- Bond item (with 变形同构体 grants this bond): 卡西米尔竞技旗 `chess_item_4_07_e` (2 gold: 部署后15秒内造成的伤害提升至135%，随后逐渐衰减)
- Garrisons that explicitly add layers to this bond: `garrison_108`, `garrison_124`, `garrison_143` (see section 4; plus the generic ones)
- Garrisons that scale with this bond's layers: `garrison_09`, `garrison_10`, `garrison_115`, `garrison_144`, `garrison_159`

Members (10 chess, 10 in current shop pool; by tier in shop: {'1': 1, '2': 2, '3': 2, '4': 2, '5': 1, '6': 2}):

| Tier | Operator | chessId | ★ | Class | Type | Bonds | Trait (normal) | Trait (elite) |
|---|---|---|---|---|---|---|---|---|
| 1 | 野鬃 | `chess_char_1_19_a` | 5 | PIONEER | PRESET | 卡西米尔/迅捷 | <获得时>自身所属盟约层数+2（无需激活盟约） | <获得时>自身所属盟约层数+4（无需激活盟约） |
| 2 | 砾 | `chess_char_2_12_a` | 4 | SPECIAL | PRESET | 卡西米尔/不屈 | <部署时>使已激活的【卡西米尔】层数+1<br><被击倒时>使已激活的【不屈】层数+2 / <部署时>使已激活的【卡西米尔】层数+1 | <部署时>使已激活的【卡西米尔】层数+2<br><被击倒时>使已激活的【不屈】层数+4 / <部署时>使已激活的【卡西米尔】层数+2 |
| 2 | 灰毫 | `chess_char_2_18_a` | 5 | TANK | PRESET | 卡西米尔/坚守 | <获得时>当前激活且层数最多的盟约层数+3 | <获得时>当前激活且层数最多的盟约层数+6 |
| 3 | 瑕光 | `chess_char_3_12_a` | 6 | TANK | NORMAL -> 郁金香 | 卡西米尔/突袭 | <部署时>使自身已激活的盟约层数+4（每场作战至多12层） | <部署时>使自身已激活的盟约层数+8（每场作战至多24层） |
| 3 | 流星 | `chess_char_3_17_a` | 4 | SNIPER | PRESET | 卡西米尔/独行 | <战斗中>攻击力和生命值+25%，造成的伤害变为弱点伤害（基于敌人的防御力和法术抗性变换物理和法术伤害） / <战斗中>造成的伤害变为弱点伤害（基于敌人的防御力和法术抗性变换物理和法术伤害） | <战斗中>攻击力和生命值+50%，造成的伤害变为弱点伤害（基于敌人的防御力和法术抗性变换物理和法术伤害） / <战斗中>造成的伤害变为弱点伤害（基于敌人的防御力和法术抗性变换物理和法术伤害） |
| 4 | 焰尾 | `chess_char_4_19_a` | 6 | PIONEER | NORMAL -> 郁金香 | 卡西米尔 | <获得时>获得1个野鬃或灰毫，小概率获得远牙 | <获得时>获得2个野鬃或灰毫，小概率获得远牙 |
| 4 | 远牙 | `chess_char_4_20_a` | 6 | SNIPER | NORMAL -> 预备干员-狙击 | 卡西米尔/精准 | <战斗开始时>使同一行最右边一名干员获得特质“<部署时>使已激活的【卡西米尔】【精准】层数+4（每场作战至多24层）” | <战斗开始时>使同一行最右边一名干员获得特质“<部署时>使已激活的【卡西米尔】【精准】层数+8（每场作战至多48层）” |
| 5 | 玛恩纳 | `chess_char_5_19_a` | 6 | WARRIOR | NORMAL -> 领主·Sharp | 卡西米尔 | 【卡西米尔】每叠加5层，本干员部署后100秒内基础攻击力+10、基础生命值+50 | 【卡西米尔】每叠加5层，本干员部署后100秒内基础攻击力+20、基础生命值+100 |
| 6 | 耀骑士临光 | `chess_char_6_17_a` | 6 | WARRIOR | NORMAL -> 郁金香 | 卡西米尔/突袭 | <战斗开始时>使自身和身前一格干员获得特质“【卡西米尔】每叠加3层，本干员再部署时间-1.5%，攻击速度+0.5” | <战斗开始时>使自身和身前一格干员获得特质“【卡西米尔】每叠加3层，本干员再部署时间-3%，攻击速度+1” |
| 6 | 锏 | `chess_char_6_19_a` | 6 | WARRIOR | NORMAL -> Misery | 谢拉格/卡西米尔/迅捷 | <获得时>自身所属的盟约层数+8<br><部署时>使自身已激活的盟约层数+8（至多24层） / <获得时>自身所属盟约层数+8（无需激活盟约） | <获得时>自身所属的盟约层数+16<br><部署时>使自身已激活的盟约层数+16（至多48层） / <获得时>自身所属盟约层数+16（无需激活盟约） |

### 3.9 精准 `preciShip` (add-on)

- Data: identifier 9, icon `icon_preciShip`, bondType REGULAR, isPower False, powerIdList [], activeCount 2, activeCondition BOARD, template count_threshold_upward, params ['2'], activeType BATTLE, noStack False, weight 10, bondOrder 2, isHiddenCharList False, effectId `bondeffect_preci`, descParamBase ['base_atk'] / perStack ['atk_per_stack'].
- Active in modes: all 9 modes
- UI desc (bondInfoDict.desc):

  > 【精准】干员攻击力提升（受层数影响）
  > <在场3名不同【精准】干员>生效范围变为【精准】干员和所有远程干员，且攻击无视一定的防御力和法术抗性

- Detail desc (effectInfoDataDict, placeholders resolved):

  > 【精准】干员攻击力+(10+1.2×L)%（受层数影响）
  > <在场3名不同【精准】干员>生效范围变为所有【精准】干员和远程干员，且攻击无视30%防御力和法术抗性

- Buff blackboard(s):
  - `env_gbuff_new`: `{"key": "act1autochess_bond_eff_preci", "base_atk": 0.1, "atk_per_stack": 0.012, "power_def_penetrate": 0.3, "power_magic_resist_penetrate": 0.3, "power_bond_char_cnt": 3.0}`
  - act1 (上半) values for comparison: `[{"key": "act1autochess_bond_eff_preci", "base_atk": 0.1, "atk_per_stack": 0.012, "power_def_penetrate": 0.3, "power_magic_resist_penetrate": 0.3, "silence": 2.0, "power_bond_char_cnt": 3.0}]`

**Implementable spec**

- **[2 distinct]** 精准 members ATK x(1 + 0.10 + 0.012*L).
- **[3 distinct]** Scope becomes 精准 members + every RANGED operator; affected units also ignore 30% of target DEF and 30% of target RES.
- Formulas: `atkMultiplier = 1.10 + 0.012*L`; `defPenetrateRatio(3) = 0.3`; `resPenetrateRatio(3) = 0.3`
- How layers are gained: Kill/skill/deploy in battle: 寒芒克洛丝 gives front operator "开技能 +1 精准 (<=10/battle)"; 远牙 grant (+4/deploy); 缇缇 +1 per sleep/stun; 蕾缪安, 送葬人; 莱恩哈特 休整期结束 +5 own active bonds; 获得时: 深靛 +2, 雪猎 +5. 机变 "缇缇的盟誓" +10.
- [ASSUMED] penetration = ratio ignore (like 无视 x% 防御)
- Bond item (with 变形同构体 grants this bond): 精准狙击镜 `chess_item_3_02_e` (2 gold: 攻击距离自身3格及以上的目标时，伤害提高30%)
- Garrisons that explicitly add layers to this bond: `garrison_24`, `garrison_44`, `garrison_68`, `garrison_89`, `garrison_96`, `garrison_108`, `garrison_125`, `garrison_138` (see section 4; plus the generic ones)
- Garrisons that scale with this bond's layers: `garrison_100`

Members (12 chess, 12 in current shop pool; by tier in shop: {'1': 2, '2': 1, '3': 1, '4': 3, '5': 1, '6': 4}):

| Tier | Operator | chessId | ★ | Class | Type | Bonds | Trait (normal) | Trait (elite) |
|---|---|---|---|---|---|---|---|---|
| 1 | 跃跃 | `chess_char_1_09_a` | 4 | SNIPER | PRESET | 精准 | 攻击无人机敌人时攻击力提升至150% | 攻击无人机敌人时攻击力提升至200% |
| 1 | 深靛 | `chess_char_1_17_a` | 4 | CASTER | PRESET | 奥术/精准 | <获得时>自身所属盟约层数+2（无需激活盟约） | <获得时>自身所属盟约层数+4（无需激活盟约） |
| 2 | 送葬人 | `chess_char_2_01_a` | 5 | SNIPER | PRESET | 拉特兰/精准 | <战斗中>首次击倒敌人时，使已激活的【精准】【拉特兰】层数+3 | <战斗中>首次击倒敌人时，使已激活的【精准】【拉特兰】层数+6 |
| 3 | 雪猎 | `chess_char_3_11_a` | 5 | SNIPER | PRESET | 谢拉格/精准 | <获得时>自身所属盟约层数+5（无需激活盟约） | <获得时>自身所属盟约层数+10（无需激活盟约） |
| 4 | 寒芒克洛丝 | `chess_char_4_06_a` | 5 | SNIPER | PRESET | 精准 | <战斗开始时>使身前一格干员获得特质“开启技能时使已激活【精准】层数+1”（每场战斗至多10层） | <战斗开始时>使身前一格干员获得特质“开启技能时使已激活【精准】层数+2”（每场战斗至多20层） |
| 4 | 莱恩哈特 | `chess_char_4_14_a` | 5 | CASTER | PRESET | 迅捷/精准 | <休整期结束时>使自身已激活的盟约层数+5 | <休整期结束时>使自身已激活的盟约层数+10 |
| 4 | 远牙 | `chess_char_4_20_a` | 6 | SNIPER | NORMAL -> 预备干员-狙击 | 卡西米尔/精准 | <战斗开始时>使同一行最右边一名干员获得特质“<部署时>使已激活的【卡西米尔】【精准】层数+4（每场作战至多24层）” | <战斗开始时>使同一行最右边一名干员获得特质“<部署时>使已激活的【卡西米尔】【精准】层数+8（每场作战至多48层）” |
| 5 | 缇缇 | `chess_char_5_02_a` | 6 | MEDIC | NORMAL -> 预备干员-术师 | 萨尔贡/精准 | <战斗中>每当范围内有敌人或干员进入沉睡或晕眩时，使已激活的【萨尔贡】【精准】层数+1（每场战斗至多24层） | <战斗中>每当范围内有敌人或干员进入沉睡或晕眩时，使已激活的【萨尔贡】【精准】层数+2（每场战斗至多48层） |
| 6 | 蕾缪安 | `chess_char_6_01_a` | 6 | SNIPER | NORMAL -> Stormeye | 拉特兰/精准 | <战斗中>自身每消耗10发子弹，若同一行有3名干员，使已激活的【拉特兰】【精准】层数+2 | <战斗中>自身每消耗10发子弹，若同一行有3名干员，使已激活的【拉特兰】【精准】层数+4 |
| 6 | 异客 | `chess_char_6_05_a` | 6 | CASTER | NORMAL -> Stormeye | 萨尔贡/迅捷/精准 | 【萨尔贡】【迅捷】【精准】每叠加3层，本干员攻击力+2% | 【萨尔贡】【迅捷】【精准】每叠加3层，本干员攻击力+4% |
| 6 | 焰影苇草 | `chess_char_6_08_a` | 6 | MEDIC | NORMAL -> Pith | 维多利亚/精准 | 【维多利亚】每叠加3层，本干员攻击速度+1 | 【维多利亚】每叠加3层，本干员攻击速度+2 |
| 6 | 迷迭香 | `chess_char_6_12_a` | 6 | SNIPER | NORMAL -> Pith | 精准/远见/协防干员 | 攻击力和生命值+20%；核心盟约每叠加3层，本干员攻击力和生命值+1% / 攻击力和生命值+20% | 攻击力和生命值+40%；核心盟约每叠加3层，本干员攻击力和生命值+2% / 攻击力和生命值+40% |

### 3.10 迅捷 `swiftShip` (add-on)

- Data: identifier 10, icon `icon_swiftShip`, bondType REGULAR, isPower False, powerIdList [], activeCount 2, activeCondition BOARD, template count_threshold_upward, params ['2'], activeType BATTLE, noStack False, weight 10, bondOrder 2, isHiddenCharList False, effectId `bondeffect_swift`, descParamBase ['base_prob'] / perStack ['prob_per_stack'].
- Active in modes: all 9 modes
- UI desc (bondInfoDict.desc):

  > 【迅捷】干员技能结束时有概率（受层数影响）立刻回复12点技力
  > <达到40层>所有干员技能结束时有等概率额外回复15点技力

- Detail desc (effectInfoDataDict, placeholders resolved):

  > 【迅捷】干员技能结束时有(20+0.35×L)%概率（受层数影响）立刻回复12点技力
  > <达到40层>所有干员技能结束时有等概率额外回复15点技力

- Buff blackboard(s):
  - `env_gbuff_new`: `{"key": "act1autochess_bond_eff_swift", "base_prob": 0.2, "prob_per_stack": 0.0035, "power_bond_stack_cnt": 40.0, "normal_sp": 12.0, "power_sp": 15.0}`
  - act1 (上半) values for comparison: `[{"key": "act1autochess_bond_eff_swift", "base_prob": 0.2, "prob_per_stack": 0.0035, "power_bond_stack_cnt": 40.0, "normal_sp": 10.0, "power_sp": 15.0}]`

**Implementable spec**

- **[2 distinct]** When a 迅捷 member's skill ends: with p = min(1, 0.20 + 0.0035*L) immediately +12 SP.
- **[L >= 40]** Every operator whose skill ends: with the same p, additionally +15 SP.
- Formulas: `p = min(1, 0.20 + 0.0035*L)`; `reaches100%AtL = 229`
- How layers are gained: 妮芙 休整期结束 +2 per operator on the bench; 蒂比 进入休整期 +2 own active bonds; 莱恩哈特 +5; 引星棘刺 +4 self & front; 获得时: 锡人/野鬃 +2, 忍冬 +6, 锏 +8. 机变 "银灰的盟誓" +8.
- [ASSUMED] 迅捷 members roll both the 12 SP and the 15 SP independently
- Bond item (with 变形同构体 grants this bond): 迅捷作战粮 `chess_item_3_05_e` (2 gold: 部署时，获得3点技力；每有一个同盟约的其他干员，额外获得3点技力)
- Garrisons that explicitly add layers to this bond: `garrison_56` (see section 4; plus the generic ones)
- Garrisons that scale with this bond's layers: `garrison_100`, `garrison_151`

Members (14 chess, 12 in current shop pool; by tier in shop: {'1': 2, '2': 2, '3': 2, '4': 1, '5': 3, '6': 2}):

| Tier | Operator | chessId | ★ | Class | Type | Bonds | Trait (normal) | Trait (elite) |
|---|---|---|---|---|---|---|---|---|
| 1 | 隐现 | `chess_char_1_01_a` | 5 | SNIPER | PRESET | 拉特兰/迅捷 | 【拉特兰】每叠加5层，本干员攻击速度+1 | 【拉特兰】每叠加5层，本干员攻击速度+2 |
| 1 | 锡人 *(hidden)* | `chess_char_1_16_a` | 5 | SPECIAL | PRESET | 投资人/迅捷 | <获得时>自身所属盟约层数+2（无需激活盟约） | <获得时>自身所属盟约层数+4（无需激活盟约） |
| 1 | 野鬃 | `chess_char_1_19_a` | 5 | PIONEER | PRESET | 卡西米尔/迅捷 | <获得时>自身所属盟约层数+2（无需激活盟约） | <获得时>自身所属盟约层数+4（无需激活盟约） |
| 2 | 蒂比 | `chess_char_2_13_a` | 5 | SPECIAL | PRESET | 迅捷/灵巧 | <进入休整期时>使自身已激活的盟约层数+2 | <进入休整期时>使自身已激活的盟约层数+4 |
| 2 | 锡人 | `chess_char_2_19_a` | 5 | SPECIAL | PRESET | 投资人/迅捷 | 攻击力和生命值+20%；【投资人】【迅捷】每叠加3层，本干员攻击力和生命值+1% / 攻击力和生命值+20% | 攻击力和生命值+40%；【投资人】【迅捷】每叠加3层，本干员攻击力和生命值+2% / 攻击力和生命值+40% |
| 3 | 松果 | `chess_char_3_10_a` | 4 | SNIPER | PRESET | 迅捷/协防干员 | <售出时>进行一次I阶干员的免费特殊招募<br>本干员合成为精锐状态后，上述特殊招募变为V阶干员 | <售出时>进行一次V阶干员的免费特殊招募 |
| 3 | 忍冬 | `chess_char_3_18_a` | 6 | PIONEER | NORMAL -> Sharp | 叙拉古/迅捷 | <获得时>自身所属盟约层数+6（无需激活盟约） | <获得时>自身所属盟约层数+12（无需激活盟约） |
| 4 | 莱恩哈特 | `chess_char_4_14_a` | 5 | CASTER | PRESET | 迅捷/精准 | <休整期结束时>使自身已激活的盟约层数+5 | <休整期结束时>使自身已激活的盟约层数+10 |
| 5 | 妮芙 | `chess_char_5_22_a` | 6 | CASTER | NORMAL -> Stormeye | 迅捷 | <休整期结束时>整备区每有1个干员，使已激活的【迅捷】层数+2 | <休整期结束时>整备区每有1个干员，使已激活的【迅捷】层数+4 |
| 5 | 凛御银灰 | `chess_char_5_14_a` | 6 | PIONEER | NORMAL -> 郁金香 | 谢拉格/投资人/迅捷 | <战斗开始时>使身前一格【谢拉格】干员获得特质“范围内1名敌人进入冻结时，有60%概率使已激活的【谢拉格】层数+1” | <战斗开始时>使身前一格【谢拉格】干员获得特质“范围内1名敌人进入冻结时，有60%概率使已激活的【谢拉格】层数+2” |
| 5 | 引星棘刺 | `chess_char_5_15_a` | 6 | SPECIAL | NORMAL -> 预备干员-狙击 | 迅捷/奇迹 | <休整期结束时>使自身及身前一格干员的已激活盟约分别各层数+4 | <休整期结束时>使自身及身前一格干员的已激活盟约分别各层数+8 |
| 6 | 异客 | `chess_char_6_05_a` | 6 | CASTER | NORMAL -> Stormeye | 萨尔贡/迅捷/精准 | 【萨尔贡】【迅捷】【精准】每叠加3层，本干员攻击力+2% | 【萨尔贡】【迅捷】【精准】每叠加3层，本干员攻击力+4% |
| 6 | 妮芙 *(hidden)* | `chess_char_6_10_a` | 6 | CASTER | NORMAL -> 领主·Sharp | 迅捷 | <休整期结束时>整备区每有1个干员，使已激活的【迅捷】层数+2 | <休整期结束时>整备区每有1个干员，使已激活的【迅捷】层数+4 |
| 6 | 锏 | `chess_char_6_19_a` | 6 | WARRIOR | NORMAL -> Misery | 谢拉格/卡西米尔/迅捷 | <获得时>自身所属的盟约层数+8<br><部署时>使自身已激活的盟约层数+8（至多24层） / <获得时>自身所属盟约层数+8（无需激活盟约） | <获得时>自身所属的盟约层数+16<br><部署时>使自身已激活的盟约层数+16（至多48层） / <获得时>自身所属盟约层数+16（无需激活盟约） |

### 3.11 灵巧 `skillfulShip` (add-on)

- Data: identifier 11, icon `icon_skillfulShip`, bondType REGULAR, isPower False, powerIdList [], activeCount 2, activeCondition BOARD, template count_threshold_upward, params ['2'], activeType BATTLE, noStack False, weight 10, bondOrder 2, isHiddenCharList False, effectId `bondeffect_skillful`, descParamBase ['base_attack_speed'] / perStack ['attack_speed_per_stack'].
- Active in modes: mode_training_1, mode_single_normal, mode_single_hard, mode_single_abyss, mode_multi_normal, mode_multi_hard, mode_multi_abyss
- UI desc (bondInfoDict.desc):

  > 【灵巧】干员及周围4格干员攻击速度提升（受层数影响）
  > <达到40层>生效范围变为【灵巧】干员周围8格

- Detail desc (effectInfoDataDict, placeholders resolved):

  > 【灵巧】干员及周围4格的干员攻击速度+(10+1×L)（受层数影响）
  >  <达到40层>生效范围变为【灵巧】干员周围8格

- Buff blackboard(s):
  - `env_gbuff_new`: `{"key": "act1autochess_bond_eff_skillful", "base_attack_speed": 10.0, "attack_speed_per_stack": 1.0, "power_bond_stack_cnt": 40.0}`
  - act1 (上半) values for comparison: `[{"key": "act1autochess_bond_eff_skillful", "base_attack_speed": 10.0, "attack_speed_per_stack": 1.0, "power_bond_stack_cnt": 20.0}, {"layer": 20.0, "count": 1.0, "price": 1.0}]`

**Implementable spec**

- **[2 distinct]** 灵巧 members and operators on their 4 orthogonally adjacent tiles: ASPD +(10 + 1*L).
- **[L >= 40]** Area becomes the 8 surrounding tiles.
- Formulas: `aspd = 10 + L`
- How layers are gained: 溯光星源 休整期结束 +2 灵巧/奥术 per 3 gold spent this round ; 断崖 +3 self & behind; 空弦 +3 self & front; 蒂比 +2; 获得时 灵知 +5. (act1 灵巧 also had a 20-layer shop reward; removed in act2.)
- [ASSUMED] a unit covered by several 灵巧 auras gets the bonus once
- Garrisons that explicitly add layers to this bond: `garrison_36`, `garrison_66`, `garrison_85`, `garrison_121` (see section 4; plus the generic ones)

Members (12 chess, 11 in current shop pool; by tier in shop: {'1': 1, '2': 2, '3': 3, '4': 3, '5': 1, '6': 1}):

| Tier | Operator | chessId | ★ | Class | Type | Bonds | Trait (normal) | Trait (elite) |
|---|---|---|---|---|---|---|---|---|
| 1 | 格雷伊 | `chess_char_1_14_a` | 4 | CASTER | PRESET | 灵巧 | <售出时>进入下个休整期额外获得1资金 | <售出时>进入下个休整期额外获得2资金 |
| 2 | 小满 | `chess_char_2_04_a` | 5 | SUPPORT | PRESET | 炎/灵巧 | <休整期结束时>本回合每获得过1名干员，使已激活的【炎】层数+1 | <休整期结束时>本回合每获得过1名干员，使已激活的【炎】层数+2 |
| 2 | 蒂比 | `chess_char_2_13_a` | 5 | SPECIAL | PRESET | 迅捷/灵巧 | <进入休整期时>使自身已激活的盟约层数+2 | <进入休整期时>使自身已激活的盟约层数+4 |
| 3 | 断崖 | `chess_char_3_02_a` | 5 | WARRIOR | PRESET | 灵巧 | <休整期结束时>使自身及身后一格干员的已激活盟约分别各层数+3 | <休整期结束时>使自身及身后一格干员的已激活盟约分别各层数+6 |
| 3 | 至简 | `chess_char_3_13_a` | 5 | CASTER | PRESET | 萨尔贡/灵巧 | 购买价格为1 | 购买价格为1 |
| 3 | 空弦 | `chess_char_3_21_a` | 6 | SNIPER | NORMAL -> Stormeye | 拉特兰/灵巧 | <进入休整期时>使自身及身前一格干员的已激活盟约分别各层数+3 | <进入休整期时>使自身及身前一格干员的已激活盟约分别各层数+6 |
| 4 | 凯瑟琳 | `chess_char_4_11_a` | 5 | SUPPORT | PRESET | 维多利亚/灵巧 | <进入休整期时>若当前为奇数回合，获得1件随机装备 | <进入休整期时>若当前为奇数回合，获得2件随机装备 |
| 4 | 灵知 | `chess_char_4_13_a` | 6 | SUPPORT | NORMAL -> Raidian | 谢拉格/灵巧 | <获得时>自身所属盟约层数+5（无需激活盟约） | <获得时>自身所属盟约层数+10（无需激活盟约） |
| 4 | 白面鸮 | `chess_char_4_21_a` | 5 | MEDIC | PRESET | 助力/灵巧 | 身前一格干员若为“进入休整期时”特质，本干员的特质与其相同 | 身前一格干员若为“进入休整期时”特质，本干员的特质与其相同 |
| 5 | 隐德来希 | `chess_char_5_06_a` | 6 | WARRIOR | NORMAL -> Sharp | 不屈/灵巧 | 核心盟约每叠加3层，本干员攻击力和生命值+1% | 核心盟约每叠加3层，本干员攻击力和生命值+2% |
| 5 | 白面鸮 *(hidden)* | `chess_char_5_16_a` | 5 | MEDIC | PRESET | 助力/灵巧 | 身前一格干员若为“进入休整期时”特质，本干员的特质与其相同 | 身前一格干员若为“进入休整期时”特质，本干员的特质与其相同 |
| 6 | 溯光星源 | `chess_char_6_16_a` | 6 | SUPPORT | PRESET | 奥术/灵巧 | <休整期结束时>本回合每花费3资金，使已激活的【灵巧】【奥术】层数+2 | <休整期结束时>本回合每花费3资金，使已激活的【灵巧】【奥术】层数+4 |

### 3.12 奥术 `arcaneShip` (add-on)

- Data: identifier 12, icon `icon_arcaneShip`, bondType REGULAR, isPower False, powerIdList [], activeCount 2, activeCondition BOARD, template count_threshold_upward, params ['2'], activeType BATTLE, noStack False, weight 10, bondOrder 2, isHiddenCharList False, effectId `bondeffect_arcane`, descParamBase ['base_damage_scale_show', 'base_damage_scale_show_ex'] / perStack ['damage_scale_per_stack', 'damage_scale_per_stack_show_ex'].
- Active in modes: mode_training_1, mode_single_normal, mode_single_hard, mode_single_abyss, mode_multi_normal, mode_multi_hard, mode_multi_abyss
- UI desc (bondInfoDict.desc):

  > 【奥术】干员造成法术伤害时使目标受到的法术伤害提升（受层数影响），持续3秒
  > <在场3名不同【奥术】干员>【奥术】干员对生命值低于50%的敌人施加的伤害提升比例提升（受层数影响）

- Detail desc (effectInfoDataDict, placeholders resolved):

  > 【奥术】干员造成法术伤害时使目标受到的法术伤害提升(20+1×L)%（受层数影响），持续3秒
  > <在场3名不同【奥术】干员>【奥术】干员对生命值低于50%的敌人施加的伤害提升比例为(68+1.4×L)%（受层数影响）

- Buff blackboard(s):
  - `env_gbuff_new`: `{"key": "act2autochess_bond_eff_arcane", "weak_duration": 3.0, "base_damage_scale": 1.2, "damage_scale_per_stack": 0.01, "power_bond_char_cnt": 3.0, "power_weak_scale": 1.4, "hp_ratio": 0.5, "base_damage_scale_show": 0.2, "base_damage_scale_show_ex": 0.68, "damage_scale_per_stack_show_ex": 0.014}`

**Implementable spec**

- **[2 distinct]** When an 奥术 member deals magic damage, the target takes magic damage x(1.20 + 0.01*L) (i.e. +(20+L)%) for 3 s. ONE instance per target whatever applies it — the strongest value wins, a weaker one resumes if it outlasts it; reapplying refreshes (corrected 2026-10-01, DESIGN §20.10: PRTS 作战机制 "同名buff的默认叠加策略buff只能表现出一个"; 巴哈姆特 12316 first-hand "共享型buff會跟對面搶 如果對面層數比你高就不需要再特別激活直接吃他的奧術buff就行" — the two players of a pair field compete for it).
- **[3 distinct]** Against enemies below 50% HP the multiplier is 1.4 x (1.20 + 0.01*L) = 1.68 + 0.014*L (i.e. +(68+1.4L)%).
- Formulas: `magicTakenMul = 1.20 + 0.01*L`; `magicTakenMulLowHp(3) = 1.4*(1.20 + 0.01*L)`; `hpThreshold = 0.5`; `durationSec = 3`
- How layers are gained: 夕 +2 per operator gained; 阿罗玛 +2 per refresh (<=6); 溯光星源 +2 per 3 gold spent; 海霓 first kill +3; 获得时: 深靛 +2, 协律 +4 (hidden). 机变 "莫斯提马的盟誓" +10.
- [ASSUMED] one instance per target, the strongest (the engine's default same-name rule; the two players of a pair field compete for it). Until v2.5 this read "instances from different 奥术 sources stack multiplicatively" and the remake kept one instance per player, so two players' instances multiplied.
- Bond item (with 变形同构体 grants this bond): 奥术法阵 `chess_item_3_08_e` (1 gold: 法术抗性+20，攻击使目标失去特殊能力5秒)
- Garrisons that explicitly add layers to this bond: `garrison_119`, `garrison_121`, `garrison_122`, `garrison_131` (see section 4; plus the generic ones)
- Garrisons that scale with this bond's layers: `garrison_05`

Members (10 chess, 9 in current shop pool; by tier in shop: {'1': 1, '2': 1, '3': 1, '4': 2, '5': 2, '6': 2}):

| Tier | Operator | chessId | ★ | Class | Type | Bonds | Trait (normal) | Trait (elite) |
|---|---|---|---|---|---|---|---|---|
| 1 | 深靛 | `chess_char_1_17_a` | 4 | CASTER | PRESET | 奥术/精准 | <获得时>自身所属盟约层数+2（无需激活盟约） | <获得时>自身所属盟约层数+4（无需激活盟约） |
| 2 | 洛洛 | `chess_char_2_10_a` | 5 | CASTER | PRESET | 维多利亚/奥术 | <获得时>随机制造1件洛洛的定制品 | <获得时>随机制造2件洛洛的定制品 |
| 2 | 协律 *(hidden)* | `chess_char_2_15_a` | 4 | CASTER | PRESET | 奥术/助力 | <获得时>自身所属盟约层数+4（无需激活盟约） | <获得时>自身所属盟约层数+8（无需激活盟约） |
| 3 | 海霓 | `chess_char_3_09_a` | 5 | SUPPORT | PRESET | 阿戈尔/奥术 | <战斗中>首次击倒敌人或我方干员时，使已激活的【阿戈尔】【奥术】层数+3 | <战斗中>首次击倒敌人或我方干员时，使已激活的【阿戈尔】【奥术】层数+6 |
| 4 | 莫斯提马 | `chess_char_4_02_a` | 6 | CASTER | NORMAL -> Stormeye | 拉特兰/奥术 | <战斗中>自身周围4格的干员每消耗6发弹药，使已激活的【拉特兰】层数+1 | <战斗中>自身周围4格的干员每消耗6发弹药，使已激活的【拉特兰】层数+2 |
| 4 | 阿罗玛 | `chess_char_4_10_a` | 5 | CASTER | PRESET | 叙拉古/奥术 | <休整期结束时>本回合每刷新过1次，使已激活的【叙拉古】【奥术】层数+2（至多6层） | <休整期结束时>本回合每刷新过1次，使已激活的【叙拉古】【奥术】层数+4（每回合至多12层） |
| 5 | 史尔特尔 | `chess_char_5_07_a` | 6 | WARRIOR | NORMAL -> 预备干员-近卫 | 突袭/奥术 | <部署时>使已激活的【突袭】层数+8（每场作战至多50层） | <部署时>使已激活的【突袭】层数+16（每场作战至多100层） |
| 5 | 夕 | `chess_char_5_12_a` | 6 | CASTER | NORMAL -> Raidian | 炎/奥术 | <休整期结束时>当前休整期每获得过一名干员，使已激活的【炎】【奥术】层数+2 | <休整期结束时>当前休整期每获得过一名干员，使已激活的【炎】【奥术】层数+4 |
| 6 | 圣聆初雪 | `chess_char_6_02_a` | 6 | CASTER | NORMAL -> 郁金香 | 谢拉格/奥术 | 【谢拉格】【奥术】每叠加3层，本干员攻击力+1% | 【谢拉格】【奥术】每叠加3层，本干员攻击力+2% |
| 6 | 溯光星源 | `chess_char_6_16_a` | 6 | SUPPORT | PRESET | 奥术/灵巧 | <休整期结束时>本回合每花费3资金，使已激活的【灵巧】【奥术】层数+2 | <休整期结束时>本回合每花费3资金，使已激活的【灵巧】【奥术】层数+4 |

### 3.13 坚守 `steadShip` (add-on)

- Data: identifier 13, icon `icon_steadShip`, bondType REGULAR, isPower False, powerIdList [], activeCount 2, activeCondition BOARD, template count_threshold_upward, params ['2'], activeType BATTLE, noStack False, weight 10, bondOrder 2, isHiddenCharList False, effectId `bondeffect_stead`, descParamBase ['base_max_hp', 'base_damage_value'] / perStack ['max_hp_per_stack', 'damage_value_per_stack'].
- Active in modes: all 9 modes
- UI desc (bondInfoDict.desc):

  > 所有干员生命值提升（受层数影响）
  > <在场3名不同【坚守】干员>场上非【坚守】干员受到伤害时，所受伤害的40%由所有【坚守】干员平均承担。【坚守】干员受到伤害时，伤害来源将受到一定法术伤害（受层数影响，每0.2秒至多触发1次）和持续5秒的40%脆弱效果

- Detail desc (effectInfoDataDict, placeholders resolved):

  > 所有干员生命值+(25+1.2×L)%（受层数影响）
  > <在场3名不同【坚守】干员>场上非【坚守】干员受到伤害时，所受伤害的40%由【坚守】干员平均承担；【坚守】干员受到伤害时，伤害来源受到(850+10×L)点法术伤害（受层数影响，每0.2秒至多触发1次）和持续5秒的40%的脆弱效果

- Buff blackboard(s):
  - `env_gbuff_new`: `{"key": "act1autochess_bond_eff_stead", "base_max_hp": 0.25, "max_hp_per_stack": 0.012, "damage_resistance": 0.4, "power_bond_char_cnt": 3.0, "cd_duration": 0.2, "weak[limit]": 5.0, "damage_scale": 1.4, "base_damage_value": 850.0, "damage_value_per_stack": 10.0}`
  - act1 (上半) values for comparison: `[{"key": "act1autochess_bond_eff_stead", "base_max_hp": 0.3, "max_hp_per_stack": 0.0125, "damage_resistance": 0.4, "power_bond_char_cnt": 3.0}]`

**Implementable spec**

- **[2 distinct]** ALL operators maxHP x(1 + 0.25 + 0.012*L).
- **[3 distinct]** When a non-坚守 operator takes damage, 40% of that damage is taken instead by the 坚守 members, split evenly. When a 坚守 member takes damage, the damage source takes (850 + 10*L) sourceless magic damage and 脆弱 (damage taken x1.4) for 5 s; each 坚守 member can reflect at most once per 0.2 s.
- Formulas: `hpMultiplier = 1.25 + 0.012*L`; `redirectRatio = 0.4`; `thornsDamage = 850 + 10*L`; `thornsCooldownSec = 0.2`; `fragile = 1.4 for 5 s`
- How layers are gained: 折桠 休整期结束 +4; 蛇屠箱 +1 per operator in same row; 斯卡蒂 kills; 获得时 角峰 +2; 机变 "斯卡蒂的盟誓" +8.
- Note: PRTS: thorns hit whatever the damage source is; sourceless damage can consume the thorns cooldown.
- Bond item (with 变形同构体 grants this bond): 坚守盾牌 `chess_item_1_02_e` (1 gold: 防御力+20%)
- Garrisons that explicitly add layers to this bond: `garrison_38`, `garrison_69`, `garrison_70` (see section 4; plus the generic ones)
- Garrisons that scale with this bond's layers: `garrison_14`, `garrison_15`

Members (10 chess, 10 in current shop pool; by tier in shop: {'1': 2, '2': 3, '3': 2, '4': 1, '5': 1, '6': 1}):

| Tier | Operator | chessId | ★ | Class | Type | Bonds | Trait (normal) | Trait (elite) |
|---|---|---|---|---|---|---|---|---|
| 1 | 角峰 | `chess_char_1_02_a` | 4 | TANK | PRESET | 谢拉格/坚守 | <获得时>自身所属盟约层数+2（无需激活盟约） | <获得时>自身所属盟约层数+4（无需激活盟约） |
| 1 | 古米 | `chess_char_1_10_a` | 4 | TANK | PRESET | 坚守 | 技力自然恢复速度+0.15/秒 | 技力自然恢复速度+0.3/秒 |
| 2 | 泡泡 | `chess_char_2_08_a` | 4 | TANK | PRESET | 萨尔贡/坚守 | 【萨尔贡】【坚守】每叠加3层，本干员防御力+1% | 【萨尔贡】【坚守】每叠加3层，本干员防御力+2% |
| 2 | 折桠 | `chess_char_2_17_a` | 5 | TANK | PRESET | 坚守/独行 | <休整期结束时>使已激活的【坚守】层数+4 | <休整期结束时>使已激活的【坚守】层数+8 |
| 2 | 灰毫 | `chess_char_2_18_a` | 5 | TANK | PRESET | 卡西米尔/坚守 | <获得时>当前激活且层数最多的盟约层数+3 | <获得时>当前激活且层数最多的盟约层数+6 |
| 3 | 斯卡蒂 | `chess_char_3_05_a` | 6 | WARRIOR | NORMAL -> 预备干员-近卫 | 阿戈尔/坚守/突袭 | <战斗中>每击倒2名单位时，使已激活的【阿戈尔】【坚守】【突袭】层数+1 | <战斗中>每击倒2名敌人时，使已激活的【阿戈尔】【坚守】【突袭】层数+2 |
| 3 | 蛇屠箱 | `chess_char_3_16_a` | 4 | TANK | PRESET | 坚守/不屈 | <休整期结束时>同一行每有1名干员，使已激活的【坚守】层数+1 | <休整期结束时>同一行每有1名干员，使已激活的【坚守】层数+2 |
| 4 | 信仰搅拌机 | `chess_char_4_01_a` | 6 | TANK | PRESET | 拉特兰/坚守 | 【拉特兰】【坚守】每叠加3层，本干员防御力+1% | 【拉特兰】【坚守】每叠加3层，本干员防御力+2% |
| 5 | 塞雷娅 | `chess_char_5_11_a` | 6 | TANK | NORMAL -> Touch | 坚守/独行 | 身前一格干员若为“休整期结束时”特质，本干员的特质与其相同 | 身前一格干员若为“休整期结束时”特质，本干员的特质与其相同 |
| 6 | 余 | `chess_char_6_03_a` | 6 | TANK | NORMAL -> Mechanist | 炎/坚守 | <进入休整期时>若同一行有3名干员，随机获得1名当前人数最多盟约的干员 | <进入休整期时>随机获得1名当前人数最多盟约的干员 |

### 3.14 助力 `deputShip` (add-on)

- Data: identifier 14, icon `icon_deputShip`, bondType REGULAR, isPower False, powerIdList [], activeCount 2, activeCondition BOARD, template count_threshold_upward, params ['2'], activeType BATTLE, noStack False, weight 10, bondOrder 2, isHiddenCharList False, effectId `bondeffect_deput`, descParamBase ['base_def'] / perStack ['def_per_stack'].
- Active in modes: all 9 modes
- UI desc (bondInfoDict.desc):

  > 所有干员防御力提升（受层数影响），再部署时间减少
  > 休整期结束时，使当前所有已激活盟约层数+2
  > <在场3名不同【助力】干员>改为层数+4

- Detail desc (effectInfoDataDict, placeholders resolved):

  > 所有干员防御力+(15+1.2×L)%（受层数影响），再部署时间-30%
  > 休整期结束时，使当前所有已激活的盟约层数+2
  > <在场3名不同【助力】干员>改为层数+4

- Buff blackboard(s):
  - `env_gbuff_new`: `{"key": "act1autochess_bond_eff_deput", "base_def": 0.15, "def_per_stack": 0.012, "respawn_time": -0.3}`
  - `bond_activated_add_layer`: `{"layer": 2.0, "count": 3.0, "bond": "deputShip", "more_layer": 4.0}`

**Implementable spec**

- **[2 distinct]** ALL operators DEF x(1 + 0.15 + 0.012*L); redeploy time -30%. At the end of every prep phase (休整期结束时) every currently active bond (incl. 助力) gets +2 layers.
- **[3 助力 (distinct name or elite state)]** +4 layers instead of +2.
- Formulas: `defMultiplier = 1.15 + 0.012*L`; `redeployTimeMul = 0.7`; `layersPerRound = 2 (4 at 3 members) to every active bond`
- How layers are gained: 波登可 +1 / 调香师 +2 to highest-layer bond at prep end (work from bench); 流明 +2 to active bonds of every bench operator; 纯烬艾雅法拉 +3 highest-layer bond per skill; its own +2/+4 per round.
- How it plays: Cheap universal layer engine: activate as many bonds as possible so each gets +2/+4 every round (helps the hidden-round threshold).

Members (13 chess, 8 in current shop pool; by tier in shop: {'1': 2, '2': 1, '3': 1, '4': 2, '6': 2}):

| Tier | Operator | chessId | ★ | Class | Type | Bonds | Trait (normal) | Trait (elite) |
|---|---|---|---|---|---|---|---|---|
| 1 | 刺玫 | `chess_char_1_06_a` | 5 | MEDIC | PRESET | 维多利亚/助力 | <休整期结束时>使已激活的【维多利亚】层数+1 | <休整期结束时>使已激活的【维多利亚】层数+2 |
| 1 | 波登可 | `chess_char_1_13_a` | 4 | SUPPORT | PRESET | 助力 | <休整期结束时>当前激活且层数最多的盟约层数+1，此干员在整备区时也有效 | <休整期结束时>当前激活且层数最多的盟约层数+2，此干员在整备区时也有效 |
| 2 | 调香师 | `chess_char_2_14_a` | 4 | MEDIC | PRESET | 助力/协防干员 | <休整期结束时>当前激活且层数最多的盟约层数+2，此干员在整备区时也有效 | <休整期结束时>当前激活且层数最多的盟约层数+4，此干员在整备区时也有效 |
| 2 | 协律 *(hidden)* | `chess_char_2_15_a` | 4 | CASTER | PRESET | 奥术/助力 | <获得时>自身所属盟约层数+4（无需激活盟约） | <获得时>自身所属盟约层数+8（无需激活盟约） |
| 3 | 巫恋 *(hidden)* | `chess_char_3_15_a` | 5 | SUPPORT | PRESET | 叙拉古/助力 | <售出时>获得2次免费刷新 | <售出时>获得4次免费刷新 |
| 3 | 耶拉 | `chess_char_3_20_a` | 5 | CASTER | PRESET | 谢拉格/助力 | <获得时>获得1件“谢拉格不融冰” | <获得时>获得2件“谢拉格不融冰” |
| 4 | 耶拉 *(hidden)* | `chess_char_4_03_a` | 5 | CASTER | PRESET | 谢拉格/助力 | <获得时>获得1件“谢拉格不融冰” | <获得时>获得2件“谢拉格不融冰” |
| 4 | 蜜蜡 *(hidden)* | `chess_char_4_05_a` | 5 | CASTER | PRESET | 萨尔贡/助力 | <获得时>获得1件“迅捷作战粮” | <获得时>获得2件“迅捷作战粮” |
| 4 | 白面鸮 | `chess_char_4_21_a` | 5 | MEDIC | PRESET | 助力/灵巧 | 身前一格干员若为“进入休整期时”特质，本干员的特质与其相同 | 身前一格干员若为“进入休整期时”特质，本干员的特质与其相同 |
| 4 | 卡涅利安 | `chess_char_4_24_a` | 6 | CASTER | NORMAL -> 预备干员-术师 | 萨尔贡/助力 | <获得时>获得1件“迅捷作战粮” | <获得时>获得2件“迅捷作战粮” |
| 5 | 白面鸮 *(hidden)* | `chess_char_5_16_a` | 5 | MEDIC | PRESET | 助力/灵巧 | 身前一格干员若为“进入休整期时”特质，本干员的特质与其相同 | 身前一格干员若为“进入休整期时”特质，本干员的特质与其相同 |
| 6 | 流明 | `chess_char_6_14_a` | 6 | MEDIC | PRESET | 助力 | <休整期结束时>整备区中每名干员所在的已激活盟约分别层数+2 | <休整期结束时>整备区中每名干员所在的已激活盟约分别层数+4 |
| 6 | 纯烬艾雅法拉 | `chess_char_6_20_a` | 6 | MEDIC | NORMAL -> Touch | 助力 | <战斗中>开启技能时，当前已激活且层数最多的盟约层数+3 | <战斗中>开启技能时，当前已激活且层数最多的盟约层数+6 |

### 3.15 远见 `visiShip` (add-on)

- Data: identifier 15, icon `icon_visiShip`, bondType REGULAR, isPower False, powerIdList [], activeCount 2, activeCondition BOARD_AND_DECK, template count_threshold_upward, params ['2'], activeType ALL, noStack False, weight 10, bondOrder 2, isHiddenCharList False, effectId `bondeffect_visi`, descParamBase [] / perStack [].
- Active in modes: all 9 modes
- UI desc (bondInfoDict.desc):

  > <每叠加10层>获得一次2资金
  > <首次达到80层>所有【远见】干员购买价格永久-1资金
  > <首次达到150层>以上效果改为调度中心内所有干员的购买价格永久-1资金（整备区的【远见】干员也可用于激活盟约）

- Detail desc (effectInfoDataDict, placeholders resolved):

  > <每叠加10层>获得一次2资金
  > <首次到达80层>所有【远见】干员购买价格永久-1资金
  > <首次到达150层>上述效果改为所有干员购买价格永久-1资金
  > 整备区的【远见】干员也可用于激活盟约

- Buff blackboard(s):
  - `bond_layer_gain_coin`: `{"layer": 10.0, "count": 2.0}`
  - `bond_multi_layer_char_goods_price_bond_discount`: `{"layer1": 80.0, "bond": "visiShip", "discount": 1.0, "layer2": 150.0}`
  - act1 (上半) values for comparison: `[{"layer": 10.0, "count": 2.0}, {"layer": 100.0, "discount": 1.0}]`

**Implementable spec**

- **[2 distinct (board + bench)]** Each time cumulative L passes a multiple of 10: +2 gold.
- **[first time L >= 80]** All 远见 operators' shop price permanently -1.
- **[first time L >= 150]** Replaces the above: every operator in the shop permanently -1 (overrides, does not stack; 3/27 update).
- Formulas: `goldPayouts = 2 * floor(L/10)`
- How layers are gained: 寒檀 进入/结束休整期 +4 each; 伊内丝 +5 own active bonds; 赫默 +2; 圣约送葬人 +3 per 7 bullets (<=21/battle); 风笛 kills +2; 机变 "风笛的盟誓" +8.
- No floor but 0: the text names none, so a price of 1 (至简's 特质, 休露丝's first 谢拉格) becomes 0 (owner's decision 2026-10-04; this note assumed a floor of 1 until 0.1.3)
- Garrisons that explicitly add layers to this bond: `garrison_50`, `garrison_55`, `garrison_63`, `garrison_64`, `garrison_141`, `garrison_142` (see section 4; plus the generic ones)

Members (9 chess, 8 in current shop pool; by tier in shop: {'2': 1, '3': 2, '4': 2, '5': 2, '6': 1}):

| Tier | Operator | chessId | ★ | Class | Type | Bonds | Trait (normal) | Trait (elite) |
|---|---|---|---|---|---|---|---|---|
| 1 | 地灵 *(hidden)* | `chess_char_1_11_a` | 4 | SUPPORT | PRESET | 奇迹/远见 | <获得时>自身所属盟约层数+2（无需激活盟约） | <获得时>自身所属盟约层数+4（无需激活盟约） |
| 2 | 赫默 | `chess_char_2_02_a` | 5 | MEDIC | PRESET | 远见 | <进入休整期时>使自身已激活的盟约层数+2 | <进入休整期时>使自身已激活的盟约层数+4 |
| 3 | 诗怀雅 | `chess_char_3_03_a` | 5 | WARRIOR | PRESET | 炎/远见 | <获得时>获得1个“盟约之币” | <获得时>获得2个“盟约之币” |
| 3 | 初雪 | `chess_char_3_14_a` | 5 | SUPPORT | PRESET | 谢拉格/远见 | <战斗中>每当范围内1名敌人进入冻结时，有50%概率使已激活的【谢拉格】层数+1 | <战斗中>每当范围内1名敌人进入冻结时，有50%概率使已激活的【谢拉格】层数+2 |
| 4 | 伊内丝 | `chess_char_4_04_a` | 6 | PIONEER | NORMAL -> 预备干员-特种 | 远见/突袭 | <休整期结束时>使自身已激活的盟约层数+5 | <休整期结束时>使自身已激活的盟约层数+10 |
| 4 | 风笛 | `chess_char_4_07_a` | 6 | PIONEER | NORMAL -> 预备干员-近卫 | 维多利亚/远见/不屈 | <战斗中>前3次击倒敌人时，使已激活的【维多利亚】【远见】【不屈】层数+2 | <战斗中>前3次击倒敌人时，使已激活的【维多利亚】【远见】【不屈】层数+4 |
| 5 | 圣约送葬人 | `chess_char_5_01_a` | 6 | WARRIOR | NORMAL -> 预备干员-先锋 | 拉特兰/远见 | <战斗中>自身每消耗7发子弹，使已激活的【拉特兰】层数+7、【远见】层数+3（每场战斗分别至多触发7次） | <战斗中>自身每消耗7发子弹，使已激活的【拉特兰】层数+14、【远见】层数+6（每场战斗至多触发7次） |
| 5 | 寒檀 | `chess_char_5_21_a` | 5 | CASTER | PRESET | 远见 | <进入休整期时><休整期结束时>使已激活的【远见】层数+4 / <休整期结束时>使已激活的【远见】层数+4 | <进入休整期时><休整期结束时>使已激活的【远见】层数+8 / <休整期结束时>使已激活的【远见】层数+8 |
| 6 | 迷迭香 | `chess_char_6_12_a` | 6 | SNIPER | NORMAL -> Pith | 精准/远见/协防干员 | 攻击力和生命值+20%；核心盟约每叠加3层，本干员攻击力和生命值+1% / 攻击力和生命值+20% | 攻击力和生命值+40%；核心盟约每叠加3层，本干员攻击力和生命值+2% / 攻击力和生命值+40% |

### 3.16 奇迹 `miraShip` (add-on)

- Data: identifier 16, icon `icon_miraShip`, bondType REGULAR, isPower False, powerIdList [], activeCount 2, activeCondition BOARD_AND_DECK, template count_threshold_upward, params ['2'], activeType ALL, noStack False, weight 10, bondOrder 2, isHiddenCharList False, effectId `bondeffect_mira`, descParamBase ['baseprob'] / perStack ['prob'].
- Active in modes: mode_training_1, mode_single_normal, mode_single_hard, mode_single_abyss, mode_multi_normal, mode_multi_hard, mode_multi_abyss
- UI desc (bondInfoDict.desc):

  > 刷新调度中心时，有概率使下次刷新不消耗资金（受层数影响）
  > <每叠加100层>获得20资金（整备区的【奇迹】干员也可用于激活盟约）

- Detail desc (effectInfoDataDict, placeholders resolved):

  > 刷新调度中心时，有(18+0.3×L)%（受层数影响）概率使下次刷新不消耗资金
  > <每叠加100层>获得20资金
  > 整备区的【奇迹】干员也可用于激活盟约

- Buff blackboard(s):
  - `bond_refresh_shop_next_free`: `{"probk": 0.3, "prob": 0.003, "baseprob": 0.18}`
  - `bond_layer_gain_coin`: `{"layer": 100.0, "count": 20.0}`
  - act1 (上半) values for comparison: `[{"probk": 0.3, "prob": 0.003, "baseprob": 0.25}, {"layer": 50.0, "count": 10.0}]`

**Implementable spec**

- **[2 distinct (board + bench)]** After each shop refresh, if the player has 0 free refreshes: with p = 0.18 + 0.003*L gain 1 free refresh.
- **[every 100 layers]** +20 gold.
- Formulas: `p = min(1, 0.18 + 0.003*L)`; `goldPayouts = 20 * floor(L/100)`
- How layers are gained: 维娜·维多利亚 +2 per distinct-tier 奇迹; 录武官 获得时 +3; 伺夜 kills +1; 引星棘刺 +4 self & front; 华法琳 (奇迹 member) gives the operator in front "开技能时 +1 own active bonds" (data: <=7/battle, elite +2 <=14; PRTS 3/27 patch note says cap raised to 12/24).
- Note: blackboard probk = 0.3: meaning unknown (not in any description) [UNKNOWN].
- Garrisons that explicitly add layers to this bond: `garrison_54`, `garrison_153`, `garrison_156`, `garrison_157` (see section 4; plus the generic ones)

Members (11 chess, 8 in current shop pool; by tier in shop: {'2': 1, '3': 2, '4': 1, '5': 3, '6': 1}):

| Tier | Operator | chessId | ★ | Class | Type | Bonds | Trait (normal) | Trait (elite) |
|---|---|---|---|---|---|---|---|---|
| 1 | 地灵 *(hidden)* | `chess_char_1_11_a` | 4 | SUPPORT | PRESET | 奇迹/远见 | <获得时>自身所属盟约层数+2（无需激活盟约） | <获得时>自身所属盟约层数+4（无需激活盟约） |
| 2 | 风丸 | `chess_char_2_11_a` | 5 | SPECIAL | PRESET | 奇迹 | 只需2个相同的本干员即可合成精锐 | 只需2个相同的本干员即可合成精锐 |
| 3 | 能天使 | `chess_char_3_01_a` | 6 | SNIPER | NORMAL -> 预备干员-狙击 | 拉特兰/奇迹 | <获得时>使下个休整期额外获得1资金 | <获得时>使下个休整期额外获得2资金 |
| 3 | 伺夜 | `chess_char_3_19_a` | 6 | PIONEER | PRESET | 叙拉古/奇迹 | <战斗中>造成的伤害变为弱点伤害（基于敌人的防御力和法术抗性变换物理和法术伤害），前3次击倒敌人时使已激活的【叙拉古】层数+2、【奇迹】层数+1 / <战斗中>造成的伤害变为弱点伤害（基于敌人的防御力和法术抗性变换物理和法术伤害） | <战斗中>造成的伤害变为弱点伤害（基于敌人的防御力和法术抗性变换物理和法术伤害），前3次击倒敌人时使已激活的【叙拉古】层数+4、【奇迹】层数+2 / <战斗中>造成的伤害变为弱点伤害（基于敌人的防御力和法术抗性变换物理和法术伤害） |
| 4 | 录武官 *(hidden)* | `chess_char_4_15_a` | 5 | MEDIC | PRESET | 炎/奇迹 | <获得时>【炎】层数+6、【奇迹】层数+3（无需激活盟约） / <获得时>【炎】层数+6、【奇迹】层数+3（无需激活盟约） | <获得时>【炎】层数+12、【奇迹】层数+6（无需激活盟约） / <获得时>【炎】层数+12、【奇迹】层数+6（无需激活盟约） |
| 4 | 华法琳 | `chess_char_4_26_a` | 5 | MEDIC | PRESET | 奇迹 | <战斗开始时>使身前一格干员获得特质“开启技能时使自身所属已激活盟约层数+1”（每场战斗至多7层） | <战斗开始时>使身前一格干员获得特质“开启技能时使自身所属已激活盟约层数+2”（每场战斗至多14层） |
| 5 | 华法琳 *(hidden)* | `chess_char_5_04_a` | 5 | MEDIC | PRESET | 奇迹 | <战斗开始时>使身前一格干员获得特质“开启技能时使自身所属已激活盟约层数+1”（每场战斗至多7层） | <战斗开始时>使身前一格干员获得特质“开启技能时使自身所属已激活盟约层数+2”（每场战斗至多14层） |
| 5 | 引星棘刺 | `chess_char_5_15_a` | 6 | SPECIAL | NORMAL -> 预备干员-狙击 | 迅捷/奇迹 | <休整期结束时>使自身及身前一格干员的已激活盟约分别各层数+4 | <休整期结束时>使自身及身前一格干员的已激活盟约分别各层数+8 |
| 5 | 安洁莉娜 | `chess_char_5_20_a` | 6 | SUPPORT | NORMAL -> Raidian | 叙拉古/奇迹 | <休整期结束时>本回合每刷新过1次，使已激活的【叙拉古】层数+4（每回合至多12层） | <休整期结束时>本回合每刷新过1次，使已激活的【叙拉古】层数+8（每回合至多24层） |
| 5 | 录武官 | `chess_char_5_23_a` | 5 | MEDIC | PRESET | 炎/奇迹 | <获得时>【炎】层数+6、【奇迹】层数+3（无需激活盟约） | <获得时>【炎】层数+12、【奇迹】层数+6（无需激活盟约） |
| 6 | 维娜·维多利亚 | `chess_char_6_07_a` | 6 | WARRIOR | NORMAL -> 领主·Sharp | 维多利亚/奇迹 | <休整期结束时>场上每有1名不同阶的【维多利亚】/【奇迹】干员使已激活的【维多利亚】层数+3/【奇迹】层数+2 / <休整期结束时>场上每有1名不同阶的【维多利亚】/【奇迹】干员使已激活的【维多利亚】层数+3/【奇迹】层数+2 | <休整期结束时>场上每有1名不同阶的【维多利亚】/【奇迹】干员使已激活的【维多利亚】层数+6/【奇迹】层数+4 / <休整期结束时>场上每有1名不同阶的【维多利亚】/【奇迹】干员使已激活的【维多利亚】层数+6/【奇迹】层数+4 |

### 3.17 投资人 `investShip` (add-on)

- Data: identifier 17, icon `icon_investShip`, bondType REGULAR, isPower False, powerIdList [], activeCount 3, activeCondition BOARD_AND_DECK, template count_threshold_upward, params ['3'], activeType ALL, noStack False, weight 0, bondOrder 2, isHiddenCharList False, effectId `bondeffect_invest`, descParamBase [] / perStack [].
- Active in modes: mode_training_1, mode_single_normal, mode_single_hard, mode_single_abyss, mode_multi_normal, mode_multi_hard, mode_multi_abyss
- UI desc (bondInfoDict.desc):

  > 干员的“获得时”类特质每次触发2次
  > <达到100层>“获得时”类特质每次触发3次（整备区的【投资人】干员也可用于激活盟约）

- Detail desc (effectInfoDataDict, placeholders resolved):

  > 干员的“获得时”类特质每次触发2次
  > <达到100层>“获得时”类特质每次触发3次
  > 整备区的【投资人】干员也可用于激活盟约

- Buff blackboard(s):
  - `bond_layer_char_garrison_bonus`: `{"layer": 0.0, "event": "SERVER_GAIN", "count": 2.0}`
  - `bond_layer_char_garrison_bonus`: `{"layer": 100.0, "event": "SERVER_GAIN", "count": 3.0}`
  - act1 (上半) values for comparison: `[{"layer": 0.0, "event": "SERVER_GAIN", "count": 2.0}, {"layer": 70.0, "event": "SERVER_GAIN", "count": 3.0}]`

**Implementable spec**

- **[3 distinct (board + bench)]** Every "获得时" (SERVER_GAIN) trait of every operator triggers 2 times.
- **[L >= 100]** Triggers 3 times.
- Formulas: `gainTraitRepeat = 2 if L < 100 else 3`
- How layers are gained: 山 休整期结束 +1 per operator gained this round; 机变 "诗怀雅的盟誓" +10, "银灰的盟誓" +8; generic sources.
- How it plays: Pair with high "获得时 +N 自身所属盟约" operators (忍冬 +6, 锏 +8, 星熊 +8, 雪猎 +5) - their layers double/triple.
- Garrisons that explicitly add layers to this bond: `garrison_34` (see section 4; plus the generic ones)
- Garrisons that scale with this bond's layers: `garrison_151`

Members (5 chess, 4 in current shop pool; by tier in shop: {'2': 1, '3': 1, '5': 2}):

| Tier | Operator | chessId | ★ | Class | Type | Bonds | Trait (normal) | Trait (elite) |
|---|---|---|---|---|---|---|---|---|
| 1 | 锡人 *(hidden)* | `chess_char_1_16_a` | 5 | SPECIAL | PRESET | 投资人/迅捷 | <获得时>自身所属盟约层数+2（无需激活盟约） | <获得时>自身所属盟约层数+4（无需激活盟约） |
| 2 | 锡人 | `chess_char_2_19_a` | 5 | SPECIAL | PRESET | 投资人/迅捷 | 攻击力和生命值+20%；【投资人】【迅捷】每叠加3层，本干员攻击力和生命值+1% / 攻击力和生命值+20% | 攻击力和生命值+40%；【投资人】【迅捷】每叠加3层，本干员攻击力和生命值+2% / 攻击力和生命值+40% |
| 3 | 琳琅诗怀雅 | `chess_char_3_04_a` | 6 | SPECIAL | NORMAL -> 预备干员-医疗 | 炎/投资人 | <休整期结束时>使下个休整期额外获得1资金（若已激活【炎】/【投资人】此特质在整备区也有效） | <休整期结束时>使下个休整期额外获得2资金（若已激活【炎】/【投资人】此特质在整备区也有效） |
| 5 | 凛御银灰 | `chess_char_5_14_a` | 6 | PIONEER | NORMAL -> 郁金香 | 谢拉格/投资人/迅捷 | <战斗开始时>使身前一格【谢拉格】干员获得特质“范围内1名敌人进入冻结时，有60%概率使已激活的【谢拉格】层数+1” | <战斗开始时>使身前一格【谢拉格】干员获得特质“范围内1名敌人进入冻结时，有60%概率使已激活的【谢拉格】层数+2” |
| 5 | 山 | `chess_char_5_17_a` | 6 | WARRIOR | NORMAL -> Misery | 投资人 | <休整期结束时>本回合每获得过1名干员，使已激活的【投资人】层数+1 | <休整期结束时>本回合每获得过1名干员，使已激活的【投资人】层数+2 |

### 3.18 突袭 `raidShip` (add-on)

- Data: identifier 18, icon `icon_raidShip`, bondType REGULAR, isPower False, powerIdList [], activeCount 2, activeCondition BOARD, template count_threshold_upward, params ['2'], activeType BATTLE, noStack False, weight 10, bondOrder 2, isHiddenCharList False, effectId `bondeffect_raid`, descParamBase ['base_atk'] / perStack ['atk_per_stack'].
- Active in modes: mode_training_1, mode_single_normal, mode_single_hard, mode_single_abyss, mode_multi_normal, mode_multi_hard, mode_multi_abyss
- UI desc (bondInfoDict.desc):

  > 【突袭】干员10秒内未进行攻击或技能就绪时，若范围内没有敌人，则保留技力立即再部署至一名地面敌人周围，期间攻击力和生命值提升（受层数影响）
  > <达到50层>所有干员攻击速度+50

- Detail desc (effectInfoDataDict, placeholders resolved):

  > 【突袭】干员10秒内未进行攻击或技能就绪时，若范围内没有敌人，则保留技力立即再部署至一名地面敌人周围，期间攻击力和生命值+(25+1×L)%（受层数影响）
  >  <达到50层>所有干员攻击速度+50

- Buff blackboard(s):
  - `env_gbuff_new`: `{"key": "act1autochess_bond_eff_raid", "base_attack_speed": 0.0, "attack_speed_per_stack": 0.0, "base_atk": 0.25, "atk_per_stack": 0.01, "base_max_hp": 0.25, "max_hp_per_stack": 0.01, "power_bond_stack_cnt": 50.0, "power_attack_speed": 50.0, "no_attack_duration": 10.0}`
  - act1 (上半) values for comparison: `[{"key": "act1autochess_bond_eff_raid", "base_attack_speed": 0.0, "attack_speed_per_stack": 0.0, "base_atk": 0.1, "atk_per_stack": 0.01, "base_max_hp": 0.1, "max_hp_per_stack": 0.01, "power_bond_stack_cnt": 30.0, "power_respawn_time": 1.0, "power_cost_scale": 0.5}]`

**Implementable spec**

- **[2 distinct]** If a 突袭 member has not attacked for 10 s, or its skill is ready, and no enemy is in its range: it is immediately redeployed (keeping SP) onto a tile next to a ground enemy; while in that redeployed state its ATK and maxHP x(1 + 0.25 + 0.01*L).
- **[L >= 50]** ALL operators ASPD +50.
- Formulas: `atkHpMultiplier = 1.25 + 0.01*L`; `idleSec = 10`; `aspdAll(L>=50) = 50`
- How layers are gained: 史尔特尔 部署时 +8 (<=50/battle); 休谟斯 each 2 kills +1; 瑕光 +4/deploy; 斯卡蒂; 伊内丝 +5; 机变 "斯卡蒂的盟誓" +8, "德克萨斯的盟誓" +10.
- [ASSUMED] target enemy = the ground enemy closest to the player's objective (its own field's; another field's only while its own has none) that the member can reach; landing tile = the nearest free deployable tile within 2 tiles of it from which the member's attack range covers it. No such tile for any of the 8 most advanced → no jump; the poll looks again every 0.25 s (GitHub issue #51 — up to 0.1.1 the idle trigger landed out of reach and hopped every 10 s; DESIGN §22.2)
- [ASSUMED] the buff lasts until the operator leaves the field
- Bond item (with 变形同构体 grants this bond): 突袭手雷 `chess_item_3_11_e` (1 gold: 每次部署后的10秒内，攻击时使目标晕眩2秒)
- Garrisons that explicitly add layers to this bond: `garrison_38`, `garrison_64`, `garrison_74`, `garrison_77`, `garrison_107` (see section 4; plus the generic ones)
- Garrisons that scale with this bond's layers: `garrison_17`, `garrison_101`, `garrison_103`, `garrison_129`

Members (9 chess, 9 in current shop pool; by tier in shop: {'1': 1, '2': 1, '3': 2, '4': 2, '5': 1, '6': 2}):

| Tier | Operator | chessId | ★ | Class | Type | Bonds | Trait (normal) | Trait (elite) |
|---|---|---|---|---|---|---|---|---|
| 1 | 宴 | `chess_char_1_18_a` | 4 | WARRIOR | PRESET | 突袭 | <战斗中>造成的伤害变为弱点伤害（基于敌人的防御力和法术抗性变换物理和法术伤害） | <战斗中>造成的伤害变为弱点伤害（基于敌人的防御力和法术抗性变换物理和法术伤害） |
| 2 | 休谟斯 | `chess_char_2_09_a` | 4 | WARRIOR | PRESET | 突袭 | <战斗中>每击倒2名敌人时，使已激活的【突袭】层数+1 | <战斗中>每击倒2名敌人，使已激活的【突袭】层数+2 |
| 3 | 斯卡蒂 | `chess_char_3_05_a` | 6 | WARRIOR | NORMAL -> 预备干员-近卫 | 阿戈尔/坚守/突袭 | <战斗中>每击倒2名单位时，使已激活的【阿戈尔】【坚守】【突袭】层数+1 | <战斗中>每击倒2名敌人时，使已激活的【阿戈尔】【坚守】【突袭】层数+2 |
| 3 | 瑕光 | `chess_char_3_12_a` | 6 | TANK | NORMAL -> 郁金香 | 卡西米尔/突袭 | <部署时>使自身已激活的盟约层数+4（每场作战至多12层） | <部署时>使自身已激活的盟约层数+8（每场作战至多24层） |
| 4 | 伊内丝 | `chess_char_4_04_a` | 6 | PIONEER | NORMAL -> 预备干员-特种 | 远见/突袭 | <休整期结束时>使自身已激活的盟约层数+5 | <休整期结束时>使自身已激活的盟约层数+10 |
| 4 | 缄默德克萨斯 | `chess_char_4_16_a` | 6 | SPECIAL | NORMAL -> Misery | 叙拉古/突袭 | <进入休整期时>获得1次免费刷新 | <进入休整期时>获得2次免费刷新 |
| 5 | 史尔特尔 | `chess_char_5_07_a` | 6 | WARRIOR | NORMAL -> 预备干员-近卫 | 突袭/奥术 | <部署时>使已激活的【突袭】层数+8（每场作战至多50层） | <部署时>使已激活的【突袭】层数+16（每场作战至多100层） |
| 6 | 仇白 | `chess_char_6_15_a` | 6 | WARRIOR | NORMAL -> Raidian | 炎/突袭 | 【炎】【突袭】每叠加3层，本干员攻击束缚和停顿状态的敌人造成的伤害提升1% | 【炎】【突袭】每叠加3层，本干员攻击束缚和停顿状态的敌人造成的伤害提升2% |
| 6 | 耀骑士临光 | `chess_char_6_17_a` | 6 | WARRIOR | NORMAL -> 郁金香 | 卡西米尔/突袭 | <战斗开始时>使自身和身前一格干员获得特质“【卡西米尔】每叠加3层，本干员再部署时间-1.5%，攻击速度+0.5” | <战斗开始时>使自身和身前一格干员获得特质“【卡西米尔】每叠加3层，本干员再部署时间-3%，攻击速度+1” |

### 3.19 不屈 `indomShip` (add-on)

- Data: identifier 19, icon `icon_indomShip`, bondType REGULAR, isPower False, powerIdList [], activeCount 2, activeCondition BOARD, template count_threshold_upward, params ['2'], activeType BATTLE, noStack False, weight 10, bondOrder 2, isHiddenCharList False, effectId `bondeffect_indom`, descParamBase ['base_prob'] / perStack ['prob_per_stack'].
- Active in modes: all 9 modes
- UI desc (bondInfoDict.desc):

  > 地面干员被击倒时，有概率立即重新部署（受层数影响）
  > <在场3名不同【不屈】干员>地面干员被击倒时使场上所有干员技力+5

- Detail desc (effectInfoDataDict, placeholders resolved):

  > 地面干员被击倒时，有(18+0.4×L)%（受层数影响）概率立刻重新部署
  > <在场3名不同【不屈】干员>地面干员被击倒时使场上所有干员技力+5

- Buff blackboard(s):
  - `env_gbuff_new`: `{"key": "act1autochess_bond_eff_indom", "base_prob": 0.18, "prob_per_stack": 0.004, "power_bond_stack_cnt": 0.0, "sp": 5.0, "power_bond_char_cnt": 3.0}`

**Implementable spec**

- **[2 distinct]** When a ground operator (地面干员 = melee position, on any tile) is knocked out / retreats / swaps 替身<->本体: with p = min(1, 0.18 + 0.004*L) it is redeployed at once (next deployment has 0 redeploy time and 0 cost). Also consumes a "复活" charge if it had one.
- **[3 distinct]** When a ground (melee-position) operator is knocked out: every operator on the field +5 SP.
- Formulas: `p = min(1, 0.18 + 0.004*L)`; `reaches100%AtL = 205`
- How layers are gained: 雷蛇 休整期结束 +1; 砾 被击倒 +2; 归溟幽灵鲨 +5; 风笛 kills +2; 机变 "风笛的盟誓" +8.
- Bond item (with 变形同构体 grants this bond): 不屈弹射器 `chess_item_2_01_e` (1 gold: 再部署时间-30%，生命值-30%)
- Garrisons that explicitly add layers to this bond: `garrison_40`, `garrison_50`, `garrison_75`, `garrison_78`, `garrison_158` (see section 4; plus the generic ones)

Members (9 chess, 7 in current shop pool; by tier in shop: {'1': 1, '2': 1, '3': 1, '4': 1, '5': 2, '6': 1}):

| Tier | Operator | chessId | ★ | Class | Type | Bonds | Trait (normal) | Trait (elite) |
|---|---|---|---|---|---|---|---|---|
| 1 | 红豆 *(hidden)* | `chess_char_1_05_a` | 4 | PIONEER | PRESET | 不屈 | 购买价格为1 | 购买价格为1 |
| 1 | 雷蛇 | `chess_char_1_20_a` | 5 | TANK | PRESET | 不屈 | <休整期结束时>使已激活的【不屈】层数+1 | <休整期结束时>使已激活的【不屈】层数+2 |
| 2 | 崖心 *(hidden)* | `chess_char_2_03_a` | 5 | SPECIAL | PRESET | 谢拉格/不屈 | <获得时>自身所属盟约层数+3（无需激活盟约） | <获得时>自身所属盟约层数+6（无需激活盟约） |
| 2 | 砾 | `chess_char_2_12_a` | 4 | SPECIAL | PRESET | 卡西米尔/不屈 | <部署时>使已激活的【卡西米尔】层数+1<br><被击倒时>使已激活的【不屈】层数+2 / <部署时>使已激活的【卡西米尔】层数+1 | <部署时>使已激活的【卡西米尔】层数+2<br><被击倒时>使已激活的【不屈】层数+4 / <部署时>使已激活的【卡西米尔】层数+2 |
| 3 | 蛇屠箱 | `chess_char_3_16_a` | 4 | TANK | PRESET | 坚守/不屈 | <休整期结束时>同一行每有1名干员，使已激活的【坚守】层数+1 | <休整期结束时>同一行每有1名干员，使已激活的【坚守】层数+2 |
| 4 | 风笛 | `chess_char_4_07_a` | 6 | PIONEER | NORMAL -> 预备干员-近卫 | 维多利亚/远见/不屈 | <战斗中>前3次击倒敌人时，使已激活的【维多利亚】【远见】【不屈】层数+2 | <战斗中>前3次击倒敌人时，使已激活的【维多利亚】【远见】【不屈】层数+4 |
| 5 | 隐德来希 | `chess_char_5_06_a` | 6 | WARRIOR | NORMAL -> Sharp | 不屈/灵巧 | 核心盟约每叠加3层，本干员攻击力和生命值+1% | 核心盟约每叠加3层，本干员攻击力和生命值+2% |
| 5 | 归溟幽灵鲨 | `chess_char_5_13_a` | 6 | SPECIAL | NORMAL -> Sharp | 阿戈尔/不屈 | <战斗中>自身被击倒或替身与本体进行切换时，使已激活的【阿戈尔】层数+5、【不屈】层数+5 | <战斗中>自身被击倒或替身与本体进行切换时，使已激活的【阿戈尔】层数+10、【不屈】层数+10 |
| 6 | 佩佩 | `chess_char_6_06_a` | 6 | WARRIOR | NORMAL -> Sharp | 萨尔贡/不屈 | <进入休整期时>获得1件“盟约之币”或“萨尔贡浓茶”，有小概率发现“黄沙罗盘” | <进入休整期时>获得2件“盟约之币”或“萨尔贡浓茶”，有概率发现“黄沙罗盘” |

### 3.20 调和 `maniShip` (add-on)

- Data: identifier 20, icon `icon_maniShip`, bondType REGULAR, isPower False, powerIdList [], activeCount 1, activeCondition BOARD, template count_threshold_upward, params ['1'], activeType MANI, noStack True, weight 0, bondOrder 1, isHiddenCharList False, effectId `bondeffect_mani`, descParamBase [] / perStack [].
- Active in modes: all 9 modes
- UI desc (bondInfoDict.desc):

  > 激活时使场上核心盟约的激活人数+1，【调和】干员享受已激活的核心盟约的效果

- Detail desc (effectInfoDataDict, placeholders resolved):

  > 激活时可以使场上核心盟约的激活人数+1，【调和】干员享受已激活的核心盟约的效果

- Buff blackboard(s):
  - `other_bond_add_trigger_cnt`: `{"count": 1.0}`

**Implementable spec**

- **[1 调和 on board]** Every core bond's member count +1; 调和 operators receive the effects of all active core bonds.
- Members note: 缪尔赛思 (T6) and 盟约·辅助干员 (T1, hidden; given in round 1 by strategy Pith "优等生").
- [ASSUMED] +1 only for core bonds with >=1 real member
- [ASSUMED] one +1 total no matter how many 调和 operators

Members (2 chess, 1 in current shop pool; by tier in shop: {'6': 1}):

| Tier | Operator | chessId | ★ | Class | Type | Bonds | Trait (normal) | Trait (elite) |
|---|---|---|---|---|---|---|---|---|
| 1 | 盟约·辅助干员 *(hidden)* | `chess_char_1_15_a` | 4 | SUPPORT | PRESET | 调和/协防干员 | 攻击力和生命值+20% | 攻击力和生命值+40% |
| 6 | 缪尔赛思 | `chess_char_6_11_a` | 6 | PIONEER | NORMAL -> 郁金香 | 调和 | <获得时>获得1个“变形同构体” | <获得时>获得2个“变形同构体” |

### 3.21 协防干员 `emptyShip` (add-on)

- Data: identifier 21, icon `icon_emptyShip`, bondType REGULAR, isPower False, powerIdList [], activeCount 2, activeCondition BOARD, template count_threshold_upward, params ['2'], activeType BATTLE, noStack True, weight 0, bondOrder 2, isHiddenCharList False, effectId `bondeffect_empty`, descParamBase [] / perStack [].
- Active in modes: all 9 modes
- UI desc (bondInfoDict.desc):

  > 所有干员受到的物理和法术伤害-20%，【协防干员】伤害提升至120%，精锐【协防】干员造成伤害提升至140%

- Detail desc (effectInfoDataDict, placeholders resolved):

  > 所有干员受到的物理和法术伤害-20%；【协防干员】伤害提升至120%，精锐【协防干员】造成伤害提升至140%

- Buff blackboard(s):
  - `env_gbuff_new`: `{"key": "act1autochess_bond_eff_assis", "damage_resistance": 0.2, "damage_scale_normal": 1.2, "damage_scale_extra": 1.4}`

**Implementable spec**

- **[2 distinct]** ALL operators take -20% physical and magic damage; 协防干员 members deal damage x1.2 (elite 协防 x1.4).
- Formulas: `damageTakenMul = 0.8`; `memberDamageMul = 1.2 (elite 1.4)`
- Meaning: "协防干员" (assist operators) = fallback bond (constData.fallbackBondId). DIY/self-selected 6-star operators whose faction matches no core bond become 协防干员; some preset operators (调香师, 松果, 瑰盐, 魔王, 铃兰, 迷迭香, 盟约·辅助干员) are natively 协防.
- Note: noStack=true: no layer-scaled effect, but layers are still counted (巴哈姆特).

Members (8 chess, 5 in current shop pool; by tier in shop: {'2': 1, '3': 1, '4': 1, '5': 1, '6': 1}):

| Tier | Operator | chessId | ★ | Class | Type | Bonds | Trait (normal) | Trait (elite) |
|---|---|---|---|---|---|---|---|---|
| 1 | 盟约·辅助干员 *(hidden)* | `chess_char_1_15_a` | 4 | SUPPORT | PRESET | 调和/协防干员 | 攻击力和生命值+20% | 攻击力和生命值+40% |
| 2 | 调香师 | `chess_char_2_14_a` | 4 | MEDIC | PRESET | 助力/协防干员 | <休整期结束时>当前激活且层数最多的盟约层数+2，此干员在整备区时也有效 | <休整期结束时>当前激活且层数最多的盟约层数+4，此干员在整备区时也有效 |
| 3 | 松果 | `chess_char_3_10_a` | 4 | SNIPER | PRESET | 迅捷/协防干员 | <售出时>进行一次I阶干员的免费特殊招募<br>本干员合成为精锐状态后，上述特殊招募变为V阶干员 | <售出时>进行一次V阶干员的免费特殊招募 |
| 4 | 瑰盐 *(hidden)* | `chess_char_4_08_a` | 5 | MEDIC | PRESET | 协防干员 | <售出时>触发场上一名拥有“休整期结束时”的干员的特质（优先触发部署位置更靠上的和更靠右的） | <售出时>触发场上一名拥有“休整期结束时”的干员的特质（优先触发部署位置更靠上的和更靠右的） |
| 4 | 魔王 | `chess_char_4_25_a` | 6 | SUPPORT | PRESET | 协防干员 | <战斗中>战斗中当本干员身前一格的干员因特质使层数提升时，使其额外层数+1 | <战斗中>战斗中当本干员身前一格的干员因特质使层数提升时，使其额外层数+2 |
| 5 | 魔王 *(hidden)* | `chess_char_5_09_a` | 6 | SUPPORT | PRESET | 协防干员 | <战斗中>战斗中当本干员身前一格的干员因特质使层数提升时，使其额外层数+1 | <战斗中>战斗中当本干员身前一格的干员因特质使层数提升时，使其额外层数+2 |
| 5 | 铃兰 | `chess_char_5_10_a` | 6 | SUPPORT | NORMAL -> 预备干员-辅助 | 叙拉古/协防干员 | <进入休整期时>触发身前一格的其他干员的“获得时”类效果 | <进入休整期时>触发身前两格的其他干员的“获得时”类效果 |
| 6 | 迷迭香 | `chess_char_6_12_a` | 6 | SNIPER | NORMAL -> Pith | 精准/远见/协防干员 | 攻击力和生命值+20%；核心盟约每叠加3层，本干员攻击力和生命值+1% / 攻击力和生命值+20% | 攻击力和生命值+40%；核心盟约每叠加3层，本干员攻击力和生命值+2% / 攻击力和生命值+40% |

### 3.22 独行 `soloShip` (add-on)

- Data: identifier 22, icon `icon_soloShip`, bondType REGULAR, isPower False, powerIdList [], activeCount 1, activeCondition BOARD, template count_threshold_downward, params ['1', '2'], activeType BATTLE, noStack True, weight 10, bondOrder 2, isHiddenCharList False, effectId `bondeffect_solo`, descParamBase [] / perStack [].
- Active in modes: mode_training_1, mode_single_normal, mode_single_hard, mode_single_abyss, mode_multi_normal, mode_multi_hard, mode_multi_abyss
- UI desc (bondInfoDict.desc):

  > <在场1名【独行】干员>【独行】干员攻击力和生命值+60%，初始技力+15（在场2名及以上【独行】干员时失效）

- Detail desc (effectInfoDataDict, placeholders resolved):

  > <在场1名【独行】干员>【独行】干员攻击力和生命值+60%，初始技力+15（在场2名及以上【独行】干员时失效）

- Buff blackboard(s):
  - `env_gbuff_new`: `{"key": "act2autochess_bond_eff_solo", "atk": 0.6, "max_hp": 0.6, "sp": 15.0}`

**Implementable spec**

- **[exactly 1 distinct 独行 on board]** That operator ATK +60%, maxHP +60%, +15 SP when deployed. Disabled when 2+ different 独行 operators are on the board.
- Formulas: `atkMul = 1.6`; `hpMul = 1.6`; `spOnDeploy = 15`
- Note: noStack=true

Members (6 chess, 6 in current shop pool; by tier in shop: {'1': 1, '2': 1, '3': 1, '4': 2, '5': 1}):

| Tier | Operator | chessId | ★ | Class | Type | Bonds | Trait (normal) | Trait (elite) |
|---|---|---|---|---|---|---|---|---|
| 1 | 德克萨斯 | `chess_char_1_08_a` | 5 | PIONEER | PRESET | 独行/叙拉古 | <售出时>获得1次免费刷新 | <售出时>获得2次免费刷新 |
| 2 | 折桠 | `chess_char_2_17_a` | 5 | TANK | PRESET | 坚守/独行 | <休整期结束时>使已激活的【坚守】层数+4 | <休整期结束时>使已激活的【坚守】层数+8 |
| 3 | 流星 | `chess_char_3_17_a` | 4 | SNIPER | PRESET | 卡西米尔/独行 | <战斗中>攻击力和生命值+25%，造成的伤害变为弱点伤害（基于敌人的防御力和法术抗性变换物理和法术伤害） / <战斗中>造成的伤害变为弱点伤害（基于敌人的防御力和法术抗性变换物理和法术伤害） | <战斗中>攻击力和生命值+50%，造成的伤害变为弱点伤害（基于敌人的防御力和法术抗性变换物理和法术伤害） / <战斗中>造成的伤害变为弱点伤害（基于敌人的防御力和法术抗性变换物理和法术伤害） |
| 4 | 水月 | `chess_char_4_09_a` | 6 | SPECIAL | NORMAL -> 领主·Sharp | 阿戈尔/独行 | 【阿戈尔】每叠加3层，本干员攻击力+1% | 【阿戈尔】每叠加3层，本干员攻击力+2% |
| 4 | 泥岩 | `chess_char_4_18_a` | 6 | TANK | NORMAL -> 预备干员-重装 | 独行 | <售出时>进入下个休整期额外获得2资金 | <售出时>进入下个休整期额外获得4资金 |
| 5 | 塞雷娅 | `chess_char_5_11_a` | 6 | TANK | NORMAL -> Touch | 坚守/独行 | 身前一格干员若为“休整期结束时”特质，本干员的特质与其相同 | 身前一格干员若为“休整期结束时”特质，本干员的特质与其相同 |

### 3.23 绝技 `suntShip` (add-on)

- Data: identifier 23, icon `icon_suntShip`, bondType REGULAR, isPower False, powerIdList [], activeCount 2, activeCondition BOARD_ALL_CHESS, template count_threshold_upward_golden, params ['2'], activeType BATTLE, noStack True, weight 0, bondOrder 2, isHiddenCharList True, effectId `bondeffect_sunt`, descParamBase [] / perStack [].
- Active in modes: mode_training_1, mode_single_normal, mode_single_hard, mode_single_abyss, mode_multi_normal, mode_multi_hard, mode_multi_abyss
- UI desc (bondInfoDict.desc):

  > <在场2名精锐状态的干员>精锐状态的干员攻击力+30%
  > <在场5名精锐状态的干员>精锐状态的干员技力消耗-30%
  > （所有干员的精锐状态均可激活本盟约）

- Detail desc (effectInfoDataDict, placeholders resolved):

  > <在场2名精锐状态的干员>精锐状态的干员攻击力+30%
  > <在场5名精锐状态的干员>精锐状态的干员技力消耗-30%
  > （所有干员的精锐状态均可激活本盟约）

- Buff blackboard(s):
  - `env_gbuff_new`: `{"key": "act2autochess_bond_eff_sunt", "power_char_cnt": 2.0, "ex_char_cnt": 5.0, "power_atk": 0.3, "sp_ratio": 0.7}`

**Implementable spec**

- **[2 elite (精锐) operators on board (any operators, duplicates count)]** All elite operators ATK +30%.
- **[5 elite operators on board]** At battle start every elite operator and its summons have skill SP cost x0.7 (rounded down, may become 0).
- Formulas: `atkMul = 1.3`; `spCostMul = floor(sp*0.7)`
- Note: isHiddenCharList=true, chessIdList empty: no member operators; elites are not "members" of 绝技 (PRTS).
- Note: noStack=true

Members: none (any elite operator counts toward activation; no membership).

Notes on the member tables: *(hidden)* = `isHidden` in charShopChessDatas - not in the current shop pool (tier-moved duplicates such as 录武官 T4, 百炼嘉维尔 T5, 华法琳 T5, 魔王 T5, 妮芙 T6, 白面鸮 T5, 耶拉 T4; removed operators such as 红豆, 地灵, 锡人 T1, 崖心, 协律, 见行者, 巫恋, 蜜蜡, 瑰盐; or special-only chess such as 盟约·辅助干员 given by strategy Pith). Type NORMAL -> X = if the player does not own the operator it is fielded as prototype X with the same bonds/traits. PRESET = always available. DIY chess (4 slots) are not listed (bond derived from the chosen operator, see 2.1).

## 4. Layer sources catalogue (garrison traits that add layers)

`targets` = explicit bonds, or a targeting mode. Amounts/caps are in the normal / elite descriptions. Rows marked *unused* exist in the data but no act2 chess owns them (legacy from act1).

| Garrison | Timing | Effect type | Targets | Normal | Elite | Owners |
|---|---|---|---|---|---|---|
| `garrison_20` | IN_BATTLE | ADD_BOND | 拉特兰 | <战斗中>身前一格的干员每消耗7发弹药，使已激活的【拉特兰】层数+1 | <战斗中>身前一格的干员每消耗7发弹药，使已激活的【拉特兰】层数+2 | *unused* |
| `garrison_22` | IN_BATTLE | ADD_BOND | 拉特兰 | <战斗中>自身周围4格的干员每消耗6发弹药，使已激活的【拉特兰】层数+1 | <战斗中>自身周围4格的干员每消耗6发弹药，使已激活的【拉特兰】层数+2 | 莫斯提马(T4) |
| `garrison_23` | IN_BATTLE | ADD_BOND | 拉特兰 | <战斗中>自身每消耗7发子弹，使已激活的【拉特兰】层数+7、【远见】层数+3（每场战斗分别至多触发7次） | <战斗中>自身每消耗7发子弹，使已激活的【拉特兰】层数+14、【远见】层数+6（每场战斗至多触发7次） | 圣约送葬人(T5) |
| `garrison_24` | IN_BATTLE | ADD_BOND | 拉特兰, 精准 | <战斗中>自身每消耗10发子弹，若同一行有3名干员，使已激活的【拉特兰】【精准】层数+2 | <战斗中>自身每消耗10发子弹，若同一行有3名干员，使已激活的【拉特兰】【精准】层数+4 | 蕾缪安(T6) |
| `garrison_25` | SERVER_GAIN | SERVER_ADD_BOND_CHESS_ALL | SELF_BONDS | <获得时>自身所属盟约层数+2（无需激活盟约） | <获得时>自身所属盟约层数+4（无需激活盟约） | 角峰(T1), 地灵(T1,hidden), 艾丝黛尔(T1), 锡人(T1,hidden), 深靛(T1), 野鬃(T1) |
| `garrison_28` | IN_BATTLE | ADD_BOND | 谢拉格 | <战斗中>每当范围内1名敌人进入冻结时，有50%概率使已激活的【谢拉格】层数+1 | <战斗中>每当范围内1名敌人进入冻结时，有50%概率使已激活的【谢拉格】层数+2 | 初雪(T3), 银灰(T4) |
| `garrison_29` | IN_BATTLE | ADD_BOND | 谢拉格 | <战斗中>每当范围内1名敌人进入冻结时，有60%概率使已激活的【谢拉格】层数+1 | <战斗中>每当范围内1名敌人进入冻结时，有60%概率使已激活的【谢拉格】层数+2 | granted by 凛御银灰(T5) via garrison_126 |
| `garrison_30` | SERVER_GAIN | SERVER_ADD_BOND_METHOD | 炎 | <获得时>获得等于当前调度中心等级的【炎】层数（无需激活盟约） | <获得时>获得等于两倍的当前调度中心等级的【炎】层数（无需激活盟约） | 惊蛰(T1) |
| `garrison_31` | SERVER_PREP_FIN | SERVER_ADD_BOND_METHOD | 炎 | <休整期结束时>本回合每获得过1名干员，使已激活的【炎】层数+1 | <休整期结束时>本回合每获得过1名干员，使已激活的【炎】层数+2 | 小满(T2) |
| `garrison_33` | SERVER_GAIN | SERVER_ADD_BOND_ACTIVATED_MOST_LAYER | ACTIVATED_BOND_WITH_MOST_LAYERS | <获得时>当前已激活且层数最多的盟约层数+3 | <获得时>当前已激活且层数最多的盟约层数+6 | *unused* |
| `garrison_34` | SERVER_PREP_FIN | SERVER_ADD_BOND_METHOD | 投资人 | <休整期结束时>本回合每获得过1名干员，使已激活的【投资人】层数+1 | <休整期结束时>本回合每获得过1名干员，使已激活的【投资人】层数+2 | 山(T5) |
| `garrison_35` | SERVER_GAIN | SERVER_ADD_BOND | 炎, 维多利亚 | <获得时>【炎】【维多利亚】层数+5（无需激活盟约） | <获得时>【炎】【维多利亚】层数+10（无需激活盟约） | 烛煌(T5) |
| `garrison_36` | SERVER_PREP_FIN | SERVER_ADD_BOND_METHOD | 炎, 灵巧 | <休整期结束时>当前休整期每获得过一名干员，使已激活的【炎】【灵巧】层数+1 | <休整期结束时>当前休整期每获得过一名干员，使已激活的【炎】【灵巧】层数+2 | *unused* |
| `garrison_38` | IN_BATTLE | ADD_BOND | 阿戈尔, 坚守, 突袭 | <战斗中>每击倒2名单位时，使已激活的【阿戈尔】【坚守】【突袭】层数+1 | <战斗中>每击倒2名敌人时，使已激活的【阿戈尔】【坚守】【突袭】层数+2 | 斯卡蒂(T3) |
| `garrison_40` | IN_BATTLE | ADD_BOND | 阿戈尔, 不屈 | <战斗中>自身被击倒或替身与本体进行切换时，使已激活的【阿戈尔】层数+5、【不屈】层数+5 | <战斗中>自身被击倒或替身与本体进行切换时，使已激活的【阿戈尔】层数+10、【不屈】层数+10 | 归溟幽灵鲨(T5) |
| `garrison_41` | SERVER_GAIN | SERVER_ADD_BOND_CHESS_ALL | SELF_BONDS | <获得时>自身所属盟约层数+3（无需激活盟约） | <获得时>自身所属盟约层数+6（无需激活盟约） | 崖心(T2,hidden) |
| `garrison_42` | IN_BATTLE | ADD_BOND | 萨尔贡 | <战斗中>首次开启技能时，使已激活的【萨尔贡】层数+5 | <战斗中>首次开启技能时，使已激活的【萨尔贡】层数+10 | 莎草(T2) |
| `garrison_43` | IN_BATTLE | ADD_BOND | 萨尔贡 | <战斗中>开启技能时，使已激活的【萨尔贡】层数+6 | <战斗中>开启技能时，使已激活的【萨尔贡】层数+12 | 菲莱(T3) |
| `garrison_44` | IN_BATTLE | ADD_BOND | 萨尔贡, 精准 | <战斗中>开启技能时，若同一行有3名干员，使已激活的【萨尔贡】【精准】层数+2 | <战斗中>开启技能时，若同一行有3名干员，使已激活的【萨尔贡】【精准】层数+4 | *unused* |
| `garrison_46` | IN_BATTLE | ADD_BOND | 阿戈尔 | <战斗中>自身被击倒时，使已激活的【阿戈尔】层数+3 | <战斗中>自身被击倒时，使已激活的【阿戈尔】层数+6 | 幽灵鲨(T2) |
| `garrison_47` | SERVER_PREP_FIN | SERVER_ADD_BOND_POSITION | SELF_AND_BEHIND_TILE_ACTIVATED_BONDS | <休整期结束时>使自身及身后一格干员的已激活盟约分别各层数+3 | <休整期结束时>使自身及身后一格干员的已激活盟约分别各层数+6 | 断崖(T3), 见行者(T3,hidden) |
| `garrison_48` | SERVER_PREP_FIN | SERVER_ADD_BOND_METHOD | 维多利亚 | <休整期结束时>场上每有1名不同阶的【维多利亚】干员，使已激活的【维多利亚】层数+2 | <休整期结束时>场上每有1名不同阶的【维多利亚】干员，使已激活的【维多利亚】层数+4 | 薄绿(T3) |
| `garrison_50` | IN_BATTLE | ADD_BOND | 维多利亚, 远见, 不屈 | <战斗中>前3次击倒敌人时，使已激活的【维多利亚】【远见】【不屈】层数+2 | <战斗中>前3次击倒敌人时，使已激活的【维多利亚】【远见】【不屈】层数+4 | 风笛(T4) |
| `garrison_51` | SERVER_PREP_FIN | SERVER_ADD_BOND_CHESS_ALL | SELF_BONDS | <休整期结束时>使自身已激活的盟约层数+5 | <休整期结束时>使自身已激活的盟约层数+10 | 莱恩哈特(T4) |
| `garrison_53` | SERVER_PREP_FIN | SERVER_ADD_BOND_METHOD | 维多利亚 | <休整期结束时>场上每有1名不同阶的【维多利亚】/【奇迹】干员使已激活的【维多利亚】层数+3/【奇迹】层数+2 | <休整期结束时>场上每有1名不同阶的【维多利亚】/【奇迹】干员使已激活的【维多利亚】层数+6/【奇迹】层数+4 | 维娜·维多利亚(T6) |
| `garrison_54` | SERVER_PREP_FIN | SERVER_ADD_BOND_METHOD | 奇迹 | <休整期结束时>场上每有1名不同阶的【维多利亚】/【奇迹】干员使已激活的【维多利亚】层数+3/【奇迹】层数+2 | <休整期结束时>场上每有1名不同阶的【维多利亚】/【奇迹】干员使已激活的【维多利亚】层数+6/【奇迹】层数+4 | 维娜·维多利亚(T6) |
| `garrison_55` | IN_BATTLE | ADD_BOND | 远见 | 【23】<战斗中>自身每消耗7发子弹，使已激活的【拉特兰】层数+7、【远见】层数+3（【远见】每场战斗至多21层） | 【23】<战斗中>自身每消耗7发子弹，使已激活的【拉特兰】层数+14、【远见】层数+6（【远见】每场战斗至多42层） | 圣约送葬人(T5) |
| `garrison_56` | SERVER_PREP_FIN | SERVER_ADD_BOND_METHOD | 迅捷 | <休整期结束时>整备区每有1个干员，使已激活的【迅捷】层数+2 | <休整期结束时>整备区每有1个干员，使已激活的【迅捷】层数+4 | 妮芙(T5), 妮芙(T6,hidden) |
| `garrison_57` | SERVER_PREP_FIN | SERVER_ADD_BOND_IN_HAND | ACTIVATED_BONDS_OF_EACH_BENCH_OPERATOR | <休整期结束时>整备区中每名干员所在的已激活盟约分别层数+2 | <休整期结束时>整备区中每名干员所在的已激活盟约分别层数+4 | 流明(T6) |
| `garrison_58` | SERVER_GAIN | SERVER_ADD_BOND_ACTIVATED_RANDOM | RANDOM_ACTIVATED_BOND | <获得时>使随机一个已激活的盟约层数+2，重复2次 | <获得时>使随机一个已激活的盟约层数+4，重复2次 | *unused* |
| `garrison_61` | SERVER_PREP_FIN | SERVER_ADD_ACT_BOND_DIFF_LV_MOST_LAYER | ACTIVATED_BOND_WITH_MOST_LAYERS | <休整期结束时>当前已激活且层数最多的盟约每有1名不同阶干员在场，层数+2 | <休整期结束时>当前已激活且层数最多的盟约每有1名不同阶干员在场，层数+4 | 号角(T5) |
| `garrison_63` | IN_BATTLE | ADD_BOND | 远见 | <战斗中>开启技能时，使已激活的【远见】层数+1 | <战斗中>开启技能时，使已激活的【远见】层数+2 | *unused* |
| `garrison_64` | IN_BATTLE | ADD_BOND | 远见, 突袭 | <战斗中>每击倒2名敌人时，使已激活的【突袭】【远见】层数+2 | <战斗中>每击倒2名敌人时，使已激活的【突袭】【远见】层数+4 | *unused* |
| `garrison_65` | SERVER_GAIN | SERVER_ADD_BOND_CHESS_ALL | SELF_BONDS | <获得时>自身所属盟约层数+8（无需激活盟约） | <获得时>自身所属盟约层数+16（无需激活盟约） | 星熊(T4), 锏(T6) |
| `garrison_66` | SERVER_PREP_FIN | SERVER_ADD_BOND_ROUND_COIN_COST | 灵巧 | <休整期结束时>本回合每花费1资金，使已激活的【灵巧】层数+1 | <休整期结束时>本回合每花费1资金，使已激活的【灵巧】层数+2 | *unused* |
| `garrison_68` | IN_BATTLE | ADD_BOND | 精准 | <战斗中>每击倒3名敌人时，使已激活的【精准】层数+4 | <战斗中>每击倒3名敌人时，使已激活的【精准】层数+8 | *unused* |
| `garrison_69` | SERVER_PREP_FIN | SERVER_ADD_BOND | 坚守 | <休整期结束时>使已激活的【坚守】层数+4 | <休整期结束时>使已激活的【坚守】层数+8 | 折桠(T2) |
| `garrison_70` | SERVER_PREP_FIN | SERVER_ADD_BOND_METHOD | 坚守 | <休整期结束时>同一行每有1名干员，使已激活的【坚守】层数+1 | <休整期结束时>同一行每有1名干员，使已激活的【坚守】层数+2 | 蛇屠箱(T3) |
| `garrison_71` | SERVER_GAIN | SERVER_ADD_BOND_CHESS_ALL | SELF_BONDS | <获得时>自身所属盟约层数+6（无需激活盟约） | <获得时>自身所属盟约层数+12（无需激活盟约） | 忍冬(T3) |
| `garrison_72` | IN_BATTLE | ADD_BOND | GRANTS_GARRISON | <战斗开始时>使身前一格干员获得特质“开启技能时使自身所属已激活盟约层数+1”（每场战斗至多7层） | <战斗开始时>使身前一格干员获得特质“开启技能时使自身所属已激活盟约层数+2”（每场战斗至多14层） | 华法琳(T4), 华法琳(T5,hidden) |
| `garrison_73` | IN_BATTLE | ADD_BOND | GRANTS_GARRISON | <战斗开始时>使身前一格干员获得特质“开启技能时使已激活【精准】层数+1”（每场战斗至多10层） | <战斗开始时>使身前一格干员获得特质“开启技能时使已激活【精准】层数+2”（每场战斗至多20层） | 寒芒克洛丝(T4) |
| `garrison_74` | IN_BATTLE | ADD_BOND | 突袭 | <战斗中>每击倒1名敌人时，使已激活的【突袭】层数+1 | <战斗中>每击倒1名敌人时，使已激活的【突袭】层数+2 | *unused* |
| `garrison_75` | IN_BATTLE | ADD_BOND | 不屈 | <部署时>使已激活的【卡西米尔】层数+1<br><被击倒时>使已激活的【不屈】层数+2 | <部署时>使已激活的【卡西米尔】层数+2<br><被击倒时>使已激活的【不屈】层数+4 | 砾(T2) |
| `garrison_77` | IN_BATTLE | ADD_BOND | 突袭 | <战斗中>每击倒2名敌人时，使已激活的【突袭】层数+1 | <战斗中>每击倒2名敌人，使已激活的【突袭】层数+2 | 休谟斯(T2) |
| `garrison_78` | IN_BATTLE | ADD_BOND | 不屈 | <战斗中>每击倒2名敌人时，使已激活的【不屈】层数+1 | <战斗中>每击倒2名敌人时，使已激活的【不屈】层数+2 | *unused* |
| `garrison_79` | SERVER_PREP_FIN | SERVER_ADD_BOND_POSITION | SELF_AND_FRONT_TILE_ACTIVATED_BONDS | <休整期结束时>使自身及身前一格干员的已激活盟约分别各层数+4 | <休整期结束时>使自身及身前一格干员的已激活盟约分别各层数+8 | 引星棘刺(T5) |
| `garrison_80` | SERVER_PREP_START | SERVER_ADD_BOND_CHESS_ALL | SELF_BONDS | <进入休整期时>使自身已激活的盟约层数+2 | <进入休整期时>使自身已激活的盟约层数+4 | 赫默(T2), 蒂比(T2) |
| `garrison_81` | SERVER_PREP_FIN | SERVER_ADD_BOND_ACTIVATED_MOST_LAYER | ACTIVATED_BOND_WITH_MOST_LAYERS | <休整期结束时>当前激活且层数最多的盟约层数+2，此干员在整备区时也有效 | <休整期结束时>当前激活且层数最多的盟约层数+4，此干员在整备区时也有效 | 调香师(T2) |
| `garrison_83` | SERVER_PREP_FIN | SERVER_ADD_BOND_FRONT_ALL_LAYER | ACTIVATED_BONDS_OF_ALL_OPERATORS_IN_FRONT | <休整期结束时>自身正前方的所有干员所属已激活盟约分别各层数+1 | <休整期结束时>自身正前方的所有干员所属已激活盟约分别各层数+2 | *unused* |
| `garrison_85` | IN_BATTLE | ADD_BOND | 灵巧 | <战斗中>每击倒3名敌人时，使已激活的【灵巧】层数+2 | <战斗中>每击倒3名敌人时，使已激活的【灵巧】层数+4 | *unused* |
| `garrison_89` | IN_BATTLE | ADD_BOND | 精准 | <战斗中>每击倒3名敌人时，若同一列有至少4名干员，使已激活的【精准】层数+4 | <战斗中>每击倒3名敌人时，若同一行有至少4名干员，使已激活的【精准】层数+8 | *unused* |
| `garrison_90` | IN_BATTLE | ADD_BOND | ACTIVATED_BOND_WITH_MOST_LAYERS | <战斗中>开启技能时，同一行每有1名干员，当前已激活且层数最多的盟约层数+1（每场作战至多10层） | <战斗中>开启技能时，同一行每有1名干员，当前已激活且层数最多的盟约层数+2（每场作战至多20层） | 塑心(T6) |
| `garrison_95` | IN_BATTLE | ADD_BOND | SELF_ACTIVATED_BONDS | <战斗中>开启技能时，使自身已激活的盟约层数+1（每场作战至多7层） | <战斗中>开启技能时，使自身已激活的盟约层数+2 | granted by 华法琳(T4) via garrison_72, granted by 华法琳(T5,hidden) via garrison_72 |
| `garrison_96` | IN_BATTLE | ADD_BOND | 精准 | <战斗中>开启技能时，使已激活的【精准】层数+1（每场作战至多10层） | <战斗中>开启技能时，使已激活的【精准】层数+2 | granted by 寒芒克洛丝(T4) via garrison_73 |
| `garrison_97` | IN_BATTLE | ADD_BOND | SELF_ACTIVATED_BONDS | <战斗中>开启技能时，使自身已激活的盟约层数+2（每场作战至多10层） | <战斗中>开启技能时，使自身已激活的盟约层数+4（每场作战至多20层） | *unused* |
| `garrison_102` | SERVER_PREP_FIN | SERVER_ADD_BOND_ACTIVATED_MOST_LAYER | ACTIVATED_BOND_WITH_MOST_LAYERS | <休整期结束时>当前激活且层数最多的盟约层数+1，此干员在整备区时也有效 | <休整期结束时>当前激活且层数最多的盟约层数+2，此干员在整备区时也有效 | 波登可(T1) |
| `garrison_104` | SERVER_PREP_FIN | SERVER_ADD_BOND_CHESS_ALL | SELF_BONDS | <休整期结束时>使自身已激活的盟约层数+5 | <休整期结束时>使自身已激活的盟约层数+10 | 伊内丝(T4) |
| `garrison_105` | SERVER_GAIN | SERVER_ADD_BOND_ACTIVATED_MOST_LAYER | ACTIVATED_BOND_WITH_MOST_LAYERS | <获得时>当前激活且层数最多的盟约层数+3 | <获得时>当前激活且层数最多的盟约层数+6 | 灰毫(T2) |
| `garrison_106` | IN_BATTLE | ADD_BOND | SELF_ACTIVATED_BONDS | <部署时>使自身已激活的盟约层数+4（每场作战至多12层） | <部署时>使自身已激活的盟约层数+8（每场作战至多24层） | 瑕光(T3) |
| `garrison_107` | IN_BATTLE | ADD_BOND | 突袭 | <部署时>使已激活的【突袭】层数+8（每场作战至多50层） | <部署时>使已激活的【突袭】层数+16（每场作战至多100层） | 史尔特尔(T5) |
| `garrison_108` | IN_BATTLE | ADD_BOND | 卡西米尔, 精准 | <部署时>使已激活的【卡西米尔】【精准】层数+4（每场作战至多24层） | <部署时>使已激活的【卡西米尔】【精准】层数+8（每场作战至多48层） | granted by 远牙(T4) via garrison_148 |
| `garrison_109` | SERVER_GAIN | SERVER_ADD_BOND_CHESS_ALL | SELF_BONDS | 【105】<获得时>自身所属盟约层数+2（无需激活盟约） | 【105】<获得时>自身所属盟约层数+2（无需激活盟约） | *unused* |
| `garrison_110` | SERVER_GAIN | SERVER_ADD_BOND_CHESS_ALL | SELF_BONDS | 【106】<获得时>自身所属盟约层数+3（无需激活盟约） | 【106】<获得时>自身所属盟约层数+3（无需激活盟约） | *unused* |
| `garrison_111` | SERVER_GAIN | SERVER_ADD_BOND_CHESS_ALL | SELF_BONDS | <获得时>自身所属盟约层数+5（无需激活盟约） | <获得时>自身所属盟约层数+10（无需激活盟约） | 雪猎(T3), 灵知(T4) |
| `garrison_112` | SERVER_GAIN | SERVER_ADD_BOND_CHESS_ALL | SELF_BONDS | <获得时>自身所属盟约层数+7（无需激活盟约） | <获得时>自身所属盟约层数+14（无需激活盟约） | *unused* |
| `garrison_117` | IN_BATTLE | ADD_BOND | GRANTS_GARRISON | <战斗开始时>使身前一格【叙拉古】干员获得特质“击倒敌人时使自身已激活的所有盟约层数+2” | 【117】击倒敌人时，使已激活的【叙拉古】层数+2 | *unused* |
| `garrison_118` | IN_BATTLE | ADD_BOND | 叙拉古 | <战斗中>击倒敌人时，使已激活的【叙拉古】层数+2<br>将荒芜拉普兰德合成为精锐即可在战斗中使所有【叙拉古】干员获得该效果 | <战斗开始时>使所有【叙拉古】干员获得特质“击倒敌人时，使已激活的【叙拉古】层数+2” | 荒芜拉普兰德(T6) |
| `garrison_119` | SERVER_PREP_FIN | SERVER_ADD_BOND_METHOD | 炎, 奥术 | <休整期结束时>当前休整期每获得过一名干员，使已激活的【炎】【奥术】层数+2 | <休整期结束时>当前休整期每获得过一名干员，使已激活的【炎】【奥术】层数+4 | 夕(T5) |
| `garrison_121` | SERVER_PREP_FIN | SERVER_ADD_BOND_ROUND_COIN_COST | 灵巧, 奥术 | <休整期结束时>本回合每花费3资金，使已激活的【灵巧】【奥术】层数+2 | <休整期结束时>本回合每花费3资金，使已激活的【灵巧】【奥术】层数+4 | 溯光星源(T6) |
| `garrison_122` | SERVER_PREP_FIN | SERVER_ADD_REFRESH_CNT_MULTIPLIER_BOND_LAYER | 叙拉古, 奥术 | <休整期结束时>本回合每刷新过1次，使已激活的【叙拉古】【奥术】层数+2（至多6层） | <休整期结束时>本回合每刷新过1次，使已激活的【叙拉古】【奥术】层数+4（每回合至多12层） | 阿罗玛(T4) |
| `garrison_123` | SERVER_REFRESH_SHOP | SERVER_GAIN_BOND_LAYER_BY_REFRESH_CNT | 叙拉古 | <刷新时>若为本回合首次主动刷新，使已激活的【叙拉古】层数+4，此干员在整备区时也有效 | <刷新时>若为本回合首次主动刷新，使已激活的【叙拉古】层数+8，此干员在整备区时也有效 | 拉普兰德(T2) |
| `garrison_124` | IN_BATTLE | ADD_BOND | 卡西米尔 | <部署时>使已激活的【卡西米尔】层数+5 | <部署时>使已激活的【卡西米尔】层数+10 | *unused* |
| `garrison_125` | IN_BATTLE | ADD_BOND | 萨尔贡, 精准 | <战斗中>每当范围内有敌人或干员进入沉睡或晕眩时，使已激活的【萨尔贡】【精准】层数+1（每场战斗至多24层） | <战斗中>每当范围内有敌人或干员进入沉睡或晕眩时，使已激活的【萨尔贡】【精准】层数+2（每场战斗至多48层） | 缇缇(T5) |
| `garrison_126` | IN_BATTLE | ADD_BOND | GRANTS_GARRISON | <战斗开始时>使身前一格【谢拉格】干员获得特质“范围内1名敌人进入冻结时，有60%概率使已激活的【谢拉格】层数+1” | <战斗开始时>使身前一格【谢拉格】干员获得特质“范围内1名敌人进入冻结时，有60%概率使已激活的【谢拉格】层数+2” | 凛御银灰(T5) |
| `garrison_128` | IN_BATTLE | ADD_BOND | 萨尔贡 | <战斗中>开启技能时，使已激活的【萨尔贡】层数+9 | <战斗中>开启技能时，使已激活的【萨尔贡】层数+18 | 百炼嘉维尔(T4), 百炼嘉维尔(T5,hidden) |
| `garrison_130` | SERVER_GAIN | SERVER_ADD_BOND_CHESS_ALL | SELF_BONDS | <获得时>自身所属盟约层数+4（无需激活盟约） | <获得时>自身所属盟约层数+8（无需激活盟约） | 协律(T2,hidden) |
| `garrison_131` | IN_BATTLE | ADD_BOND | 阿戈尔, 奥术 | <战斗中>首次击倒敌人或我方干员时，使已激活的【阿戈尔】【奥术】层数+3 | <战斗中>首次击倒敌人或我方干员时，使已激活的【阿戈尔】【奥术】层数+6 | 海霓(T3) |
| `garrison_136` | SERVER_GAIN | SERVER_ADD_BOND_CHESS_ALL | SELF_BONDS | <获得时>自身所属盟约层数+7（无需激活盟约） | <获得时>自身所属盟约层数+14（无需激活盟约） | *unused* |
| `garrison_138` | IN_BATTLE | ADD_BOND | 拉特兰, 精准 | <战斗中>首次击倒敌人时，使已激活的【精准】【拉特兰】层数+3 | <战斗中>首次击倒敌人时，使已激活的【精准】【拉特兰】层数+6 | 送葬人(T2) |
| `garrison_139` | IN_BATTLE | ADD_BOND | 维多利亚 | <战斗中>前3次击倒敌人时，使已激活的【维多利亚】层数+3 | <战斗中>前3次击倒敌人时，使已激活的【维多利亚】层数+6 | *unused* |
| `garrison_140` | IN_BATTLE | ADD_BOND | ACTIVATED_BOND_WITH_MOST_LAYERS | <战斗中>开启技能时，当前已激活且层数最多的盟约层数+3 | <战斗中>开启技能时，当前已激活且层数最多的盟约层数+6 | 纯烬艾雅法拉(T6) |
| `garrison_141` | SERVER_PREP_START | SERVER_ADD_BOND | 远见 | <进入休整期时><休整期结束时>使已激活的【远见】层数+4 | <进入休整期时><休整期结束时>使已激活的【远见】层数+8 | 寒檀(T5) |
| `garrison_142` | SERVER_PREP_FIN | SERVER_ADD_BOND | 远见 | <休整期结束时>使已激活的【远见】层数+4 | <休整期结束时>使已激活的【远见】层数+8 | 寒檀(T5) |
| `garrison_143` | IN_BATTLE | ADD_BOND | 卡西米尔 | <部署时>使已激活的【卡西米尔】层数+1 | <部署时>使已激活的【卡西米尔】层数+2 | 砾(T2) |
| `garrison_145` | IN_BATTLE | ADD_BOND | GRANTS_GARRISON | <战斗开始时>使自身和身前一格干员获得特质“【卡西米尔】每叠加3层，本干员再部署时间-1.5%，攻击速度+0.5” | <战斗开始时>使自身和身前一格干员获得特质“【卡西米尔】每叠加3层，本干员再部署时间-3%，攻击速度+1” | 耀骑士临光(T6) |
| `garrison_146` | SERVER_CHESS_SOLD | SERVER_ADD_REFRESH_CNT_MULTIPLIER_BOND_LAYER | 叙拉古 | <售出时>本回合每刷新过1次，使已激活的【叙拉古】层数+2（至多12层） | <售出时>本回合每刷新过1次，使已激活的【叙拉古】层数+4（至多24层） | *unused* |
| `garrison_147` | SERVER_PREP_FIN | SERVER_ADD_REFRESH_CNT_MULTIPLIER_BOND_LAYER | 叙拉古 | <休整期结束时>本回合每刷新过1次，使已激活的【叙拉古】层数+4（每回合至多12层） | <休整期结束时>本回合每刷新过1次，使已激活的【叙拉古】层数+8（每回合至多24层） | 安洁莉娜(T5) |
| `garrison_148` | IN_BATTLE | ADD_BOND | GRANTS_GARRISON | <战斗开始时>使同一行最右边一名干员获得特质“<部署时>使已激活的【卡西米尔】【精准】层数+4（每场作战至多24层）” | <战斗开始时>使同一行最右边一名干员获得特质“<部署时>使已激活的【卡西米尔】【精准】层数+8（每场作战至多48层）” | 远牙(T4) |
| `garrison_150` | SERVER_PREP_START | SERVER_ADD_BOND_POSITION | SELF_AND_FRONT_TILE_ACTIVATED_BONDS | <进入休整期时>使自身及身前一格干员的已激活盟约分别各层数+3 | <进入休整期时>使自身及身前一格干员的已激活盟约分别各层数+6 | 空弦(T3) |
| `garrison_152` | IN_BATTLE | ADD_BOND | 叙拉古 | <战斗中>造成的伤害变为弱点伤害（基于敌人的防御力和法术抗性变换物理和法术伤害），前3次击倒敌人时使已激活的【叙拉古】层数+2、【奇迹】层数+1 | <战斗中>造成的伤害变为弱点伤害（基于敌人的防御力和法术抗性变换物理和法术伤害），前3次击倒敌人时使已激活的【叙拉古】层数+4、【奇迹】层数+2 | 伺夜(T3) |
| `garrison_153` | IN_BATTLE | ADD_BOND | 奇迹 | 【152】<战斗中>造成的伤害变为弱点伤害（基于敌人的防御力和法术抗性变换物理和法术伤害），前3次击倒敌人时使已激活的【叙拉古】层数+2、【奇迹】层数+1 | 【152】<战斗中>造成的伤害变为弱点伤害（基于敌人的防御力和法术抗性变换物理和法术伤害），前3次击倒敌人时使已激活的【叙拉古】层数+4、【奇迹】层数+2 | 伺夜(T3) |
| `garrison_154` | SERVER_PREP_FIN | SERVER_ADD_BOND | 维多利亚 | <休整期结束时>使已激活的【维多利亚】层数+1 | <休整期结束时>使已激活的【维多利亚】层数+2 | 刺玫(T1) |
| `garrison_155` | IN_BATTLE | ADD_BOND | SELF_ACTIVATED_BONDS | <获得时>自身所属的盟约层数+8<br><部署时>使自身已激活的盟约层数+8（至多24层） | <获得时>自身所属的盟约层数+16<br><部署时>使自身已激活的盟约层数+16（至多48层） | 锏(T6) |
| `garrison_156` | SERVER_GAIN | SERVER_ADD_MULTIPLE_BOND | 炎, 奇迹 | <获得时>【炎】层数+6、【奇迹】层数+3（无需激活盟约） | <获得时>【炎】层数+12、【奇迹】层数+6（无需激活盟约） | 录武官(T4,hidden), 录武官(T5) |
| `garrison_157` | SERVER_GAIN | SERVER_ADD_BOND | 奇迹 | <获得时>【炎】层数+6、【奇迹】层数+3（无需激活盟约） | <获得时>【炎】层数+12、【奇迹】层数+6（无需激活盟约） | 录武官(T4,hidden) |
| `garrison_158` | SERVER_PREP_FIN | SERVER_ADD_BOND | 不屈 | <休整期结束时>使已激活的【不屈】层数+1 | <休整期结束时>使已激活的【不屈】层数+2 | 雷蛇(T1) |
| `garrison_160` | IN_BATTLE | ADD_BOND | GRANTS_GARRISON | 【145】<战斗开始时>使自身和身前一格干员获得特质“【卡西米尔】每叠加3层，攻击速度+0.5” | 【145】<战斗开始时>使自身和身前一格干员获得特质“【卡西米尔】每叠加3层，攻击速度+1” | 耀骑士临光(T6) |

Blackboard vocabulary (for implementing the above): IN_BATTLE event keys `act1autochess_gar_event_useskill` (skill activated), `…_selfkillenemy` (check_cnt kills by self), `…_selfdead` (self knocked out), `…_consume_ammo` (consume_count ammo; range_id `0-1` self, `1-1` front tile, `x-5` self + 4 adjacent), `…_enemy_abflag_inrange` (check_ab_flag 16 = frozen, prob), `act2autochess_gar_event_onstart` (on deploy), `act2autochess_gar_event_allyenemy_sleepstun_inrange`; `bond_type` bond_by_id / bond_self (own ACTIVE bonds) / bond_actived_maxstack (active bond with most layers); `bond_add_type` by_count / by_charcount_samerow / by_charlevel; `conditionkey` character_same_row / character_same_col with check_count, character_target_inboard; `max_add_count_per_battle`. Server methods: add_method shoplv (= shop level), round_gain_char (operators gained this round), same_bond_diff_lv (distinct tiers of that bond on board x multi), hand_count (bench size), same_row (operators in same row).

## 5. Traits that read layers (每叠加N层 ...)

Formula: bonus = floor(L_sum / divide_num) x per-step value, where L_sum = sum of L over the listed bonds [ASSUMED: sum over listed bonds, only active bonds count]. 核心盟约 = the 8 core bonds.

| Garrison | Reads | Normal | Elite | Owners |
|---|---|---|---|---|
| `garrison_05` | 谢拉格, 奥术 | 【谢拉格】【奥术】每叠加3层，本干员攻击力+1% | 【谢拉格】【奥术】每叠加3层，本干员攻击力+2% | 圣聆初雪(T6) |
| `garrison_07` | 阿戈尔 | 【阿戈尔】每叠加3层，本干员攻击力+1% | 【阿戈尔】每叠加3层，本干员攻击力+2% | 水月(T4) |
| `garrison_09` | 炎, 谢拉格, 萨尔贡, 拉特兰, 维多利亚, 阿戈尔, 卡西米尔, 叙拉古 | 攻击力和生命值+20%；核心盟约每叠加3层，本干员攻击力和生命值+1% | 攻击力和生命值+40%；核心盟约每叠加3层，本干员攻击力和生命值+2% | 哈洛德(T2), 迷迭香(T6) |
| `garrison_10` | 炎, 谢拉格, 萨尔贡, 拉特兰, 维多利亚, 阿戈尔, 卡西米尔, 叙拉古 | 核心盟约每叠加3层，本干员攻击力和生命值+1% | 核心盟约每叠加3层，本干员攻击力和生命值+2% | 隐德来希(T5) |
| `garrison_11` | 维多利亚 | 【维多利亚】每叠加3层，本干员攻击速度+1 | 【维多利亚】每叠加3层，本干员攻击速度+2 | 焰影苇草(T6) |
| `garrison_12` | 阿戈尔 | 【阿戈尔】每叠加2层，本干员攻击力+1% | 【阿戈尔】每叠加2层，本干员攻击力+2% | 乌尔比安(T5) |
| `garrison_14` | 拉特兰, 坚守 | 【拉特兰】【坚守】每叠加3层，本干员防御力+1% | 【拉特兰】【坚守】每叠加3层，本干员防御力+2% | 信仰搅拌机(T4) |
| `garrison_15` | 萨尔贡, 坚守 | 【萨尔贡】【坚守】每叠加3层，本干员防御力+1% | 【萨尔贡】【坚守】每叠加3层，本干员防御力+2% | 泡泡(T2) |
| `garrison_16` | 拉特兰 | 【拉特兰】每叠加5层，本干员攻击速度+1 | 【拉特兰】每叠加5层，本干员攻击速度+2 | 隐现(T1) |
| `garrison_17` | 突袭 | 【突袭】每叠加3层，本干员再部署时间-1.5% | 【突袭】每叠加3层，本干员再部署时间-3% | *unused* |
| `garrison_84` | 阿戈尔 | 【阿戈尔】每叠加10层，本干员每秒回复50生命，自然技力回复速度+0.15/秒 | 【阿戈尔】每叠加10层，本干员每秒回复100生命，自然技力回复速度+0.3/秒 | 浊心斯卡蒂(T6) |
| `garrison_100` | 萨尔贡, 迅捷, 精准 | 【萨尔贡】【迅捷】【精准】每叠加3层，本干员攻击力+2% | 【萨尔贡】【迅捷】【精准】每叠加3层，本干员攻击力+4% | 异客(T6) |
| `garrison_101` | 炎, 突袭 | 【炎】【突袭】每叠加3层，本干员攻击束缚和停顿状态的敌人造成的伤害提升1% | 【炎】【突袭】每叠加3层，本干员攻击束缚和停顿状态的敌人造成的伤害提升2% | 仇白(T6) |
| `garrison_103` | 炎, 突袭 | 【炎】【突袭】每叠加3层，本干员攻击束缚和停顿状态的敌人造成的伤害提升1% | 【炎】【突袭】每叠加3层，本干员攻击束缚和停顿状态的敌人造成的伤害提升2% | *unused* |
| `garrison_115` | 卡西米尔 | 【卡西米尔】每叠加5层，本干员部署后100秒内基础攻击力+10、基础生命值+50 | 【卡西米尔】每叠加5层，本干员部署后100秒内基础攻击力+20、基础生命值+100 | 玛恩纳(T5) |
| `garrison_129` | 叙拉古, 突袭 | 【叙拉古】【突袭】每叠加2层，本干员攻击力+1% | 【叙拉古】【突袭】每叠加2层，本干员攻击力+2% | *unused* |
| `garrison_144` | 卡西米尔 | 【145】【卡西米尔】每叠加3层，本干员再部署时间-1.5%，攻击速度+0.5 | 【卡西米尔】每叠加3层，本干员再部署时间-3%，攻击速度+1 | 耀骑士临光(T6), granted by 耀骑士临光(T6) via garrison_145 |
| `garrison_151` | 投资人, 迅捷 | 攻击力和生命值+20%；【投资人】【迅捷】每叠加3层，本干员攻击力和生命值+1% | 攻击力和生命值+40%；【投资人】【迅捷】每叠加3层，本干员攻击力和生命值+2% | 锡人(T2) |
| `garrison_159` | 卡西米尔 | 【145】【卡西米尔】每叠加3层，本干员攻击速度+0.5 | 【145】【卡西米尔】每叠加3层，本干员攻击速度+1 | 耀骑士临光(T6), granted by 耀骑士临光(T6) via garrison_160 |

## 6. Strategies (分队/策略), 机变 choices and items touching bonds

| effectId | Type | Name | Description | Key params |
|---|---|---|---|---|
| `aceffect_band_21` | BAND_INITIAL | 重点监护 (strategy 华法琳) | 【重点监护】开始作战时，使场上每个不同等阶的1个随机我方干员的所属盟约层数+2 | prep_finish_char_bond_add_layer {"layer": 2.0} |
| `aceffect_band_28` | BAND_INITIAL | 广交豪杰 (strategy 杜遥夜) | 【广交豪杰】每回合前2次主动刷新为特殊刷新：优先刷新出1名<炎>干员<br>在<炎>部分干员缺席时体验可能不完整 | band_first_self_refresh_present_char {"bond": "yanShip", "count": 1.0} |
| `aceffect_band_29` | BAND_INITIAL | 博学多通 (strategy 佩佩) | 【博学多通】升级调度中心至2、4和6级后，获得1次特殊刷新：此次刷新出现的干员优先为<萨尔贡>干员<br>在<萨尔贡>部分干员缺席时体验可能不完整 | up_shop_next_refresh_must_present_bond_char {"bond": "sargonShip", "cnt": 0.0, "price": 0.0, "lvlist": "2,4,6"} |
| `aceffect_band_30` | BAND_INITIAL | 人才盲盒 (strategy 哈洛德) | 【人才盲盒】从第4回合开始每2回合获得1名<维多利亚>干员<br>在<维多利亚>部分干员缺席时体验可能不完整 | gain_bond_char_per_round {"bond": "victoriaShip", "round": 4.0, "count": 1.0, "preround": 2.0} |
| `aceffect_band_31` | BAND_INITIAL | 雪域礼赠 (strategy 休露丝) | 【雪域礼赠】每回合购买的首名<谢拉格>干员消耗资金为1<br>在<谢拉格>部分干员缺席时体验可能不完整 | first_buy_in_round_char_price_change {"bond": "kjeragShip", "price": 1.0} |
| `aceffect_band_33` | BAND_INITIAL | 崇高牺牲 (strategy 克莱门莎) | 【崇高牺牲】<阿戈尔>干员被击倒时，提供等同于该干员等阶的<阿戈尔>盟约层数<br>在<阿戈尔>部分干员缺席时体验可能不完整 | env_gbuff_new_with_verify {"key": "act1autochess_band13_buff", "bond_type": "bond_by_id", "bond_id": "egirShip", "bond_add_type": "by_charlevel"} |
| `aceffect_band_49` | BAND_INITIAL | “神秘顾客” (strategy 鸭爵) | 【“神秘顾客”】从第5回合起，你和队友遭遇的部分敌人可能会替换为<鸭爵><高普尼克><流泪小子><圆仔>，击倒这些敌人者获得1资金奖励（包括联防阶段） | round_start_all_player_change_enemy_2 {"min": 0.0, "max": 2.0, "enemylist": "enemy_2002_bearmi_2,enemy_2034_sythef_2,enemy_2085_skzjxd_2,enemy_2001_duckmi_2", "round": 5.0, "count": 1.0, "minweight": 0.6, "maxweight": 0.99} |
| `aceffect_band_50` | BAND_INITIAL | 文火慢炖 (strategy 余) | 【文火慢炖】第8回合开始时，若仅激活了1个盟约，使其增加36层；否则使所有已激活盟约增加12层 | round_start_bond_check_gain_layer {"round": 8.0, "factioncount": 1.0, "count1": 36.0, "count2": 12.0} |
| `aceffect_band_58` | BAND_INITIAL | 业务指标 (strategy 玛恩纳) | 【业务指标】每购买一名<卡西米尔>干员，下回合开始时资金+1（每回合至多3资金）<br>在<卡西米尔>部分干员缺席时体验可能不完整 | round_start_gain_coin_by_bond_char_chess_buy {"bond": "kazimierzShip", "count": 1.0, "max_count": 3.0} |
| `aceffect_band_59` | BAND_INITIAL | 团伙行动 (strategy 贾维) | 【团伙行动】主动刷新6次调度中心后获得一名不高于当前调度中心等级的<叙拉古>干员（每回合至多获得2名）<br>在<叙拉古>部分干员缺席时体验可能不完整 | refresh_shop_count_gain_coin_bond_char_chess {"refresh_count": 6.0, "bond": "siracusaShip", "max_count": 2.0} |
| `eff_acarm074` | EQUIP | 商业包装方案 | 每出售8名干员，额外获得一个与此装备携带者的同盟约初始干员（不高于当前调度中心等级） | sell_char_count_gain_equip_owner_bond {"count": 8.0} |
| `eff_acgarm074` | EQUIP | 商业包装方案 | 每出售7名干员，额外获得一个与此装备携带者的同盟约初始干员（不高于当前调度中心等级） | sell_char_count_gain_equip_owner_bond {"count": 7.0} |
| `eff_acarm077` | EQUIP | 天师古鼎 | 生命值+45%；若携带者为【炎】盟约干员，本回合每获得过1名干员战斗开始后攻击速度+25（最多3层）<br>若该【炎】盟约干员同时装备“炎国短刀”，每次获得干员时获得2资金（每回合最多3次） | env_gbuff_new_with_verify {"key": "act1autochess_equip_acarm077_global_buff", "equip_chess_id": "chess_item_3_04_e", "attack_speed": 25.0, "max_cnt": 3.0}; env_gbuff_new_with_verify {"key": "attr_common_global_buff", "max_hp": 0.45}; equip_with_another_gain_coin_when_gain_char {"other_equip": "chess_item_3_04_e_a,chess_item_3_04_e_b", "count": 2.0, "max": 3.0, "bond": "yanShip"} |
| `eff_acgarm077` | EQUIP | 天师古鼎 | 生命值+70%；若携带者为【炎】盟约干员，本回合每获得过1名干员战斗开始后攻击速度+25（最多3层）<br>若该【炎】盟约干员同时装备“炎国短刀”，每次获得干员时获得2资金（每回合最多3次） | env_gbuff_new_with_verify {"key": "act1autochess_equip_acarm077_global_buff", "equip_chess_id": "chess_item_3_04_e", "attack_speed": 25.0, "max_cnt": 3.0}; env_gbuff_new_with_verify {"key": "attr_common_global_buff", "max_hp": 0.7}; equip_with_another_gain_coin_when_gain_char {"other_equip": "chess_item_3_04_e_a,chess_item_3_04_e_b", "count": 2.0, "max": 3.0, "bond": "yanShip"} |
| `eff_acarm109` | EQUIP | 信标 | 装备时，目标干员和本装备销毁并进行一次特殊刷新，出现两名与携带者同等阶的干员，免费获取其中一名<br>若在同盟模拟中且存在其他队友，下个休整期向相应盟约人数最多的队友发送1个原干员<br>相应盟约人数相同则随机发送<br>无法装备给自编干员 | use_equip_recruit_new_char_and_give_char_to_player_most_bond {"refresh_cnt": 2.0, "choice_cnt": 1.0} |
| `eff_acgarm109` | EQUIP | 信标 | 装备时，目标干员和本装备销毁并进行一次特殊刷新，出现两名与携带者同等阶的干员，免费获取其中一名<br>若在同盟模拟中且存在其他队友，下个休整期向相应盟约人数最多的队友发送1个原干员<br>相应盟约人数相同则随机发送<br>无法装备给自编干员 | use_equip_recruit_new_char_and_give_char_to_player_most_bond {"refresh_cnt": 2.0, "choice_cnt": 1.0} |
| `eff_acarm114` | EQUIP | 简易通讯机 | 装备时销毁，随机获得1名与该干员有相同盟约的干员 | use_equip_reward_char_chess_with_same_bond {"count": 1.0} |
| `eff_acgarm114` | EQUIP | 简易通讯机 | 装备时销毁，随机获得2名与该干员有相同盟约的干员 | use_equip_reward_char_chess_with_same_bond {"count": 2.0} |
| `eff_acarm124` | EQUIP | 随身身份牌 | 装备时销毁，并使携带者所属盟约层数+3（无需激活盟约） | use_equip_reward_char_chess_bond_layer {"layer": 3.0} |
| `eff_acgarm124` | EQUIP | 随身身份牌 | 装备时销毁，并使携带者所属盟约层数+6（无需激活盟约） | use_equip_reward_char_chess_bond_layer {"layer": 6.0} |
| `allybuff_select_2_1` | BUFF_GAIN | 斯卡蒂的盟誓 | 你的阿戈尔、突袭和坚守盟约层数+8，若存在其他队友则他们也获得 | global_special_choice_bond_addlayer {"bond_list": "raidShip,steadShip,egirShip", "count": 8.0} |
| `allybuff_select_2_2` | BUFF_GAIN | 诗怀雅的盟誓 | 你的炎和投资人盟约层数+10，若存在其他队友则他们也获得 | global_special_choice_bond_addlayer {"bond_list": "yanShip,investShip", "count": 10.0} |
| `allybuff_select_2_3` | BUFF_GAIN | 风笛的盟誓 | 你的维多利亚、远见和不屈盟约层数+8，若存在其他队友则他们也获得 | global_special_choice_bond_addlayer {"bond_list": "victoriaShip,indomShip,visiShip", "count": 8.0} |
| `allybuff_select_2_4` | BUFF_GAIN | 银灰的盟誓 | 你的谢拉格、投资人、迅捷盟约层数+8，若存在其他队友则他们也获得 | global_special_choice_bond_addlayer {"bond_list": "investShip,kjeragShip,swiftShip", "count": 8.0} |
| `allybuff_select_2_5` | BUFF_GAIN | 莫斯提马的盟誓 | 你的拉特兰、奥术盟约层数+10，若存在其他队友则他们也获得 | global_special_choice_bond_addlayer {"bond_list": "lateranoShip,arcaneShip", "count": 10.0} |
| `allybuff_select_2_6` | BUFF_GAIN | 缇缇的盟誓 | 你的萨尔贡、精准盟约层数+10，若存在其他队友则他们也获得 | global_special_choice_bond_addlayer {"bond_list": "sargonShip,preciShip", "count": 10.0} |
| `allybuff_select_2_7` | BUFF_GAIN | 玛恩纳的盟誓 | 你的卡西米尔盟约层数+12，若存在其他队友则他们也获得 | global_special_choice_bond_addlayer {"bond_list": "kazimierzShip", "count": 12.0} |
| `allybuff_select_2_8` | BUFF_GAIN | 德克萨斯的盟誓 | 你的叙拉古、突袭盟约层数+10，若存在其他队友则他们也获得 | global_special_choice_bond_addlayer {"bond_list": "siracusaShip,raidShip", "count": 10.0} |
| `allybuff_select_7_1` | BUFF_GAIN | 炎盟约驰援 | 你获得1名炎盟约的随机干员棋子 | single_special_choice_gain_bond_chess {"count": 1.0, "bond": "yanShip"} |
| `allybuff_select_7_2` | BUFF_GAIN | 谢拉格驰援 | 你获得1名谢拉格盟约的随机干员棋子 | single_special_choice_gain_bond_chess {"count": 1.0, "bond": "kjeragShip"} |
| `allybuff_select_7_3` | BUFF_GAIN | 萨尔贡驰援 | 你获得1名萨尔贡盟约的随机干员棋子 | single_special_choice_gain_bond_chess {"count": 1.0, "bond": "sargonShip"} |
| `allybuff_select_7_4` | BUFF_GAIN | 叙拉古驰援 | 你获得1名叙拉古盟约的随机干员棋子 | single_special_choice_gain_bond_chess {"count": 1.0, "bond": "siracusaShip"} |
| `allybuff_select_7_5` | BUFF_GAIN | 卡西米尔驰援 | 你获得1名卡西米尔盟约的随机干员棋子 | single_special_choice_gain_bond_chess {"count": 1.0, "bond": "kazimierzShip"} |
| `allybuff_select_7_6` | BUFF_GAIN | 拉特兰驰援 | 你获得1名拉特兰盟约的随机干员棋子 | single_special_choice_gain_bond_chess {"count": 1.0, "bond": "lateranoShip"} |
| `allybuff_select_7_7` | BUFF_GAIN | 维多利亚驰援 | 你获得1名维多利亚盟约的随机干员棋子 | single_special_choice_gain_bond_chess {"count": 1.0, "bond": "victoriaShip"} |
| `allybuff_select_7_8` | BUFF_GAIN | 阿戈尔驰援 | 你获得1名阿戈尔盟约的随机干员棋子 | single_special_choice_gain_bond_chess {"count": 1.0, "bond": "egirShip"} |

Bond items for 变形同构体 (`chess_item_6_09_e`, "携带者获得额外盟约（由另一件携带装备而定）"):

| Item | chessId | Gives bond | Price | Effect |
|---|---|---|---|---|
| 炎国短刀 | `chess_item_3_04_e` | 炎 | 2 | 每开启一次技能，获得5%的攻击力加成（最多叠加10次） |
| 维式重锤 | `chess_item_1_01_e` | 维多利亚 | 1 | 攻击力+15% |
| 灼燃维式重锤 | `chess_item_4_09_e` | 维多利亚 | 2 | 攻击力+30%；造成法术伤害附带相当于10%伤害的灼燃损伤 |
| 坚固维式重锤 | `chess_item_3_09_e` | 维多利亚 | 2 | 攻击力+25%；首次受到致命伤害时生命值不低于1，持续8秒 |
| 加速维式重锤 | `chess_item_3_10_e` | 维多利亚 | 2 | 攻击力+25%；攻击速度+30 |
| 战栗维式重锤 | `chess_item_2_03_e` | 维多利亚 | 2 | 攻击力+20%；若携带者是地面干员则攻击时有10%概率使目标战栗2秒 |
| 阿戈尔重刃 | `chess_item_3_07_e` | 阿戈尔 | 2 | 攻击力+40%，攻击速度-10 |
| 坚守盾牌 | `chess_item_1_02_e` | 坚守 | 1 | 防御力+20% |
| 奥术法阵 | `chess_item_3_08_e` | 奥术 | 1 | 法术抗性+20，攻击使目标失去特殊能力5秒 |
| 萨尔贡浓茶 | `chess_item_2_04_e` | 萨尔贡 | 2 | 技力自然回复速度+0.15/秒 |
| 迅捷作战粮 | `chess_item_3_05_e` | 迅捷 | 2 | 部署时，获得3点技力；每有一个同盟约的其他干员，额外获得3点技力 |
| 不屈弹射器 | `chess_item_2_01_e` | 不屈 | 1 | 再部署时间-30%，生命值-30% |
| 拉特兰桥夹 | `chess_item_4_08_e` | 拉特兰 | 1 | 子弹类技能剩余一发子弹时有50%概率恢复40%的子弹（每次部署最多触发3次） |
| 谢拉格不融冰 | `chess_item_5_02_e` | 谢拉格 | 2 | 攻击时有12%概率对目标施加1.5秒的寒冷 |
| 精准狙击镜 | `chess_item_3_02_e` | 精准 | 2 | 攻击距离自身3格及以上的目标时，伤害提高30% |
| 突袭手雷 | `chess_item_3_11_e` | 突袭 | 1 | 每次部署后的10秒内，攻击时使目标晕眩2秒 |
| 卡西米尔竞技旗 | `chess_item_4_07_e` | 卡西米尔 | 2 | 部署后15秒内造成的伤害提升至135%，随后逐渐衰减 |
| 叙拉古正装 | `chess_item_3_01_e` | 叙拉古 | 2 | 攻击速度+15，携带者部署方向左右两侧的我方干员攻击速度+10 |

## 7. What changed from 上半 (act1autochess) to 下半 (act2autochess)

- New bonds: 叙拉古, 卡西米尔 (core); 奥术, 独行, 绝技 (add-on).
- 炎: added 9-member tier (2 炎佑, ATK x1.5, -90% damage taken); 炎佑 now hits 3 targets.
- 萨尔贡: strategy 娜仁图亚 variant of the 6-tier.
- 维多利亚: base damage 1.20 -> 1.25; 6-tier changed from flat ATK 80% to +50% per item (+80% advanced).
- 谢拉格: base damage 1.30 -> 1.25.
- 拉特兰: 6-tier cap 180% -> 200%.
- 阿戈尔: devour damage 6000 -> 5000, revives 2 -> 3, order now left/top first.
- 精准: removed 2 s silence from the 3-tier.  迅捷: 10 -> 12 SP.  灵巧: milestone 20 -> 40 and 20-layer shop reward removed.
- 坚守: HP 30%+1.25%/L -> 25%+1.2%/L, added thorns (850+10L magic, 40% fragile).  突袭: 10%+1%/L -> 25%+1%/L, milestone 30 (free redeploy) -> 50 (all ASPD +50).
- 远见: now BOARD_AND_DECK; 100-layer discount -> 80 (远见 ops) / 150 (all ops, overrides).  奇迹: BOARD_AND_DECK; base 25% -> 18%; 10 gold/50 layers -> 20 gold/100 layers.  投资人: BOARD_AND_DECK; 3x at 70 -> 100 layers; activeCount 3.
- Hidden round thresholds 300/1000 -> 350/1200.

## 8. Open questions / discrepancies

1. 华法琳 granted-trait cap: data garrison_95 = 7 (elite 14) per battle, PRTS 3/27 patch note says 12/24. Recommend the patch-note value if we want "latest official"; data value otherwise.
2. 调和 +1: applies to every core bond or only those with >=1 real member on board? (assumed the latter).
3. 奇迹 blackboard `probk` 0.3 has no known meaning.
4. `pool_equip_vict` content (assumed the 4 special 维式重锤).
5. 炎佑 spawn position/movement AI and whether its template DEF 200 is kept; 祛恶之焰 tick model.
6. 突袭 teleport destination selection rule.
7. Whether layer milestones (维多利亚 25, 远见 10, 奇迹 100) also pay for layers added while the bond is inactive via "无需激活" sources (assumed yes - they read L).
8. Hidden-round total: whether 协防/独行/绝技/调和 (noStack) layers count (they have counters in the backend per 巴哈姆特).


---

## Addendum (critic)

Written 2026-09-27 by the completeness critic. Sources: the official 3/27 notice (`ak.hypergryph.com/news/8584`), PRTS `卫戍协议：盟约_下半` 更新记录, BWIKI `盟约` / `盟约/S.W.E.E.P.报告`, and the screenshot `i.meee.com.tw/9H7Kugy.png`.

1. **§8 Q1 (华法琳 cap): resolved → use 12 per battle normal, 24 elite.** The official 3/27 notice says "调整每场战斗至多获得的层数". PRTS gives the numbers: "付与的特质的叠层上限从初始7/精锐14提升至初始12/精锐24". The client data (`garrison_72_*` → `garrison_95_*`, `max_add_count_per_battle` 7/14) was not updated for this line, although it already carries the other 3/27 changes: 奇迹 `baseprob` 0.18, 远见 80/150, 商业包装方案 8/7. Override `max_add_count_per_battle` to 12/24.
2. **Per-match incomplete bonds (new, verified).** See 01 Addendum A2.
   - Each match disables a random set D: 3 core + 4 add-on in NORMAL+; the static list + 1 add-on in FUNNY.
   - Every operator whose bonds are **all** in D leaves the pool.
   - A bond in D can still be activated through:
     - members that also carry a non-disabled bond;
     - 变形同构体 items;
     - 调和's +1.
   - Layers of a bond in D still accumulate from "无需激活" sources.
   - Weight-0 bonds (投资人, 调和, 协防干员, 绝技) are never in D. That is the meaning of `weight` here: it is the draw weight for D. The "SERVER_ADD_BOND_ACTIVATED_RANDOM" reading in §2.1 is only a secondary use.
3. **§2.2 "IN_BATTLE gains disabled in 联防 and the boss round": confirmed.** PRTS 帮助 says "领袖轮战斗中无法通过战斗内效果叠加层数". BWIKI says "联防阶段，【盟约】的层数叠加会被禁用". The HUD shows the bond strip with the tooltip "层数叠加已禁用" in both. SERVER_* (prep) sources still work in the boss round's prep.
4. **Core vs add-on flag.** The act2 `bondInfoDict` has no `isPower` field. Read it from `autoChessData.bondInfoDict[b].isPower` (8 core). All `maxInactiveBondCount` values are −1, so the data gives no cap on disabled bonds.
5. **§2.3 hidden-round thresholds 350/1200: confirmed** (PRTS 下半 §隐秘核心). 05 used 300/1000 (上半) and is corrected there.
