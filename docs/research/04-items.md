# 04 - Items (装备 EQUIP / 法术 MAGIC) - 卫戍协议：盟约 (act2autochess)

Source of truth: `activity_table.json -> activity.AUTOCHESS_SEASON.act2autochess` (`trapChessDataDict`, `trapShopChessDatas`, `effectInfoDataDict`, `effectBuffInfoDataDict`) + `character_table.json` (trap_*) + `skill_table.json` (sktok_*). Data corresponds to 盟约 **下半** (contains 下半 items 简易通讯机/紧急调度券/天马之枪 etc. and the 下半 changes to 奥术法阵 and 商业包装方案). Machine-readable version: `04-items.json` (every entry, raw buffs/blackboards, flattened `params`, `implFormula`).

Tags: **[DATA]** = read directly from game data, **[WEB]** = community/official web source, **[ASSUMED]** = our proposal where sources are silent.

## 1. Key facts (TL;DR)

- 59 shop-table entries: **56 EQUIP** items (each has normal `_a` + golden/进阶 `_b` chess entry = 112) + **3 MAGIC** Arts (no golden) = 115 chess entries in `trapChessDataDict`. [DATA]
- Tier (`itemLevel`) I-VI. Distinct buyable equipment by tier: I:5, II:7, III:12, IV:12, V:9, VI:11. Normal prices 1-5 funds; every golden entry has `purchasePrice` 5. [DATA]
- Shop (调度中心) has **1 item slot at every shop level** in all real modes (`shopLevelDataDict[*][L].itemCount = 1`; training mode 0 until L5). Season 1 only had items from shop level 5. [DATA]
- **Max 2 equipment per operator**; equipped items are locked; a 3rd equip = replace (the replaced item is destroyed). Items return to hand when the operator is promoted (3->elite) or sold. [WEB: PRTS 卫戍协议/帮助, arknights.wiki.gg, in-game tip]
- **2 identical normal items auto-merge into 1 golden** (`upgradeNum=2`). `upgradeNum=100` = never merges (寻呼模块, 信标, 拟态物质, 突变细胞, 人事部文档, 变形同构体; talent note "本装备不会合并为进阶品质"). [DATA]
- Many items are **consumed on equip** ("装备时销毁"): economy/recruit effects. They need an operator target but never take a slot. [DATA]
- `trapDuration`: -1 on all normal EQUIP (permanent), 0 on golden & MAGIC (unused by us). `canGiveBond=true` only on 变形同构体; `giveBondId` is set on 18 items (14 bonds) and is the lookup table used by 变形同构体. `givePowerId` always null. [DATA]
- **MAGIC (法术)**: 画卷, 教鞭, “神秘顾客”; all `hideInShop=true`; only granted by strategies (bands). Drag onto a map tile during prep; instant. Limit: max **2** current-round Arts on the map; all Arts removed at round end. [DATA + WEB wiki.gg]

## 2. Rules for implementation

| Rule | Value / behaviour | Source |
|---|---|---|
| Equip slots per operator | 2 | [WEB] PRTS 帮助 "每名干员最多可佩戴2件装备" |
| Who can be equipped | Operators on the battlefield **or in hand/整备区** (下半) | [WEB] ak.hypergryph.com/news/5114 "装备可直接配置在处于整备区的干员身上" |
| Unequip | Not allowed. Items leave an operator only on: operator promoted to elite, item merges to golden, operator sold -> items go to hand (overflow to 5 temporary hand slots, which are wiped at next phase) | [WEB] PRTS/bwiki, in-game tip "干员晋级后已配发装备会回收至整备区，需要重新配置" |
| Replacement | Drop an item on an operator with 2 items -> choose 1 equipped item to **destroy**; cancel allowed | [WEB] PRTS 帮助 "达到上限强行佩戴会改为替换装备"; wiki.gg |
| Merge | 2 x same normal (`_a`, upgradeNum 2) -> 1 golden (`_b`), automatic, immediate | [DATA]+[WEB] tip "两件同名装备可以合成一件更强力的装备" |
| Merge counts equipped copies? | Yes: copies in hand and on operators both count; resulting golden goes to hand (slot freed) | [ASSUMED] (consistent with "道具晋级" being a removal condition) |
| Non-mergeable | upgradeNum 100 items (list above); golden entries have upgradeNum 0 | [DATA] |
| Consume-on-equip | Effects tagged `kind=consume_on_equip` resolve once on drop, item destroyed, no slot used | [DATA] |
| Hand capacity | Items share the 10 regular hand slots with operators (+5 temporary) | [DATA] constData.maxDeckChessCnt=10; [WEB] PRTS 帮助 |
| Shop item slot | 1 slot per refresh at all shop levels (L1-L6) | [DATA] shopLevelDataDict.itemCount |
| Shop item pool | Non-hidden normal EQUIP with tier <= shop level (mirrors operator rule "调度中心等级≥干员所在等阶") | [ASSUMED] |
| Shop item tier odds | Reuse operator tier-odds of that shop level, then uniform within tier; if tier has no item fall back to lower tier | [ASSUMED] |
| Item price | `purchasePrice` of `_a` entry (1-5) | [DATA] |
| Golden in shop | Never; golden only via merge or effects (整备 buff: "你接下来购买的1件装备变为进阶品质"; band 至纯凝结 gives golden 博士投影) | [DATA]/[ASSUMED] |
| Refresh / freeze | Item slot refreshes (1 fund, constData.shopRefreshPrice) and freezes together with operator slots | [ASSUMED] |
| Sell item | Unequipped item in hand sells for 1 fund (normal or golden) | [ASSUMED] (official text only states operators sell for 1) |
| Stacking | Different items on one operator stack: %ATK/%DEF/%HP additive with other % buffs (`final = base*(1+Σ%)+flat`), ASPD flat additive, `damage_scale` multipliers multiply, procs roll independently. Normal+golden copy of same item may coexist and both apply | [ASSUMED] |
| Bond-gated effects | "若携带者为【X】盟约干员" checks the operator's bonds **including** a bond granted by 变形同构体 | [ASSUMED] |
| Arts usage | Drag onto a map tile during 休整期; instant resolve; 画卷 range `1-1` = placed tile + tile in front; others `0-1` | [DATA] range_table |
| Arts limit | Max 2 current-round Arts on map at once; all Arts destroyed at round end | [WEB] wiki.gg Stronghold_Protocol |
| Free item events | 道具补给 (`equip_free_*`, choiceType EQUIP_FREE) in 机变阶段: after rounds 2/8 (标准), 2/5/8 (险境), 2/8/10 (绝境+). Offer 3 items (tier <= shopLevel+1, cap 6), pick 1 free. 机密商店 (`artifact_paid_*`, also EQUIP_FREE, "无需消耗资金"): offer 3 items tier >= IV, pick 1 | [WEB] Bahamut snA=12294 (rounds); offer size/tier [ASSUMED] |

### Shop item slots by mode (itemCount per shop level) [DATA]

| Mode | L1 | L2 | L3 | L4 | L5 | L6 |
|---|---|---|---|---|---|---|
| mode_training_1 | 0 (ops 3) | 0 (ops 3) | 0 (ops 3) | 0 (ops 3) | 1 (ops 3) | 1 (ops 3) |
| mode_single_funny | 1 (ops 3) | 1 (ops 4) | 1 (ops 4) | 1 (ops 4) | 1 (ops 4) | 1 (ops 5) |
| mode_single_normal | 1 (ops 3) | 1 (ops 4) | 1 (ops 4) | 1 (ops 5) | 1 (ops 5) | 1 (ops 5) |
| mode_single_hard | 1 (ops 3) | 1 (ops 4) | 1 (ops 4) | 1 (ops 5) | 1 (ops 5) | 1 (ops 5) |
| mode_single_abyss | 1 (ops 3) | 1 (ops 4) | 1 (ops 4) | 1 (ops 5) | 1 (ops 5) | 1 (ops 5) |
| mode_multi_funny | 1 (ops 3) | 1 (ops 4) | 1 (ops 4) | 1 (ops 4) | 1 (ops 4) | 1 (ops 5) |
| mode_multi_normal | 1 (ops 3) | 1 (ops 4) | 1 (ops 4) | 1 (ops 5) | 1 (ops 5) | 1 (ops 5) |
| mode_multi_hard | 1 (ops 3) | 1 (ops 4) | 1 (ops 4) | 1 (ops 5) | 1 (ops 5) | 1 (ops 5) |
| mode_multi_abyss | 1 (ops 3) | 1 (ops 4) | 1 (ops 4) | 1 (ops 5) | 1 (ops 5) | 1 (ops 5) |

## 3. Full item list (EQUIP)

Columns: normal id (golden = same id with `_b`), name / EN name [EN names for 下半-new items are our translation], tier, price (normal; golden always 5), category, normal effect -> **golden** effect, giveBond (for 变形同构体), merge.

### Tier I

| id | name | EN | price | cat | normal effect | golden effect | giveBond | merge |
|---|---|---|---|---|---|---|---|---|
| `chess_item_1_01_e_a` | 维式重锤 | Victorian Hammer | 1 | STAT | 攻击力+15% | 攻击力+25% | 维多利亚(victoriaShip) | x2 |
| `chess_item_1_02_e_a` | 坚守盾牌 | Durable Shield | 1 | STAT | 防御力+20% | 防御力+35% | 坚守(steadShip) | x2 |
| `chess_item_1_03_e_a` | 盟约之币 | Alliance Coin | 1 | ECONOMY | 装备时销毁，并获得1资金 | 装备时销毁，并获得2资金 |  | x2 |
| `chess_item_1_04_e_a` | 随身身份牌 | Portable ID Tag | 1 | BOND | 装备时销毁，并使携带者所属盟约层数+3（无需激活盟约） | 装备时销毁，并使携带者所属盟约层数+6（无需激活盟约） |  | x2 |
| `chess_item_1_05_e_a` | 源石溶剂 | Originium Solvent | 1 | STAT | 携带者每秒流失60点生命值，攻击力+40% | 携带者每秒流失60点生命值，攻击力+60% |  | x2 |

### Tier II

| id | name | EN | price | cat | normal effect | golden effect | giveBond | merge |
|---|---|---|---|---|---|---|---|---|
| `chess_item_2_01_e_a` | 不屈弹射器 | Tough Launcher | 1 | STAT | 再部署时间-30%，生命值-30% | 再部署时间-50%，生命值-30% | 不屈(indomShip) | x2 |
| `chess_item_2_02_e_a` | 紧急调度券 | Emergency Dispatch Voucher | 2 | RECRUIT | 装备时销毁，随机获取当前调度中心内的1名干员 （调度中心中对应干员消失） | 装备时销毁，随机获取当前调度中心内的2名干员 （调度中心中对应干员消失） |  | x2 |
| `chess_item_2_03_e_a` | 战栗维式重锤 | Frightening Victorian Hammer | 2 | ON_HIT | 攻击力+20%；若携带者是地面干员则攻击时有10%概率使目标战栗2秒 | 攻击力+35%；若携带者是地面干员则攻击时有10%概率使目标战栗2秒 | 维多利亚(victoriaShip) | x2 |
| `chess_item_2_04_e_a` | 萨尔贡浓茶 | Sargonian Teaspresso | 2 | STAT | 技力自然回复速度+0.15/秒 | 技力自然回复速度+0.25/秒 | 萨尔贡(sargonShip) | x2 |
| `chess_item_2_05_e_a` | 精打细算玩偶 | Thrifty Doll | 3 | ECONOMY | 装备时销毁，之后每回合开始时额外获得1资金 | 装备时销毁，之后每回合开始时额外获得2资金 |  | x2 |
| `chess_item_2_06_e_a` | 简易通讯机 | Simple Communicator | 2 | RECRUIT | 装备时销毁，随机获得1名与该干员有相同盟约的干员 | 装备时销毁，随机获得2名与该干员有相同盟约的干员 |  | x2 |
| `chess_item_2_07_e_a` | 见钱眼开玩偶 | Money-Eyed Doll | 1 | ECONOMY | 装备时销毁，下回合额外获得2资金 | 装备时销毁，下回合额外获得4资金 |  | x2 |

### Tier III

| id | name | EN | price | cat | normal effect | golden effect | giveBond | merge |
|---|---|---|---|---|---|---|---|---|
| `chess_item_3_01_e_a` | 叙拉古正装 | Siracusan Formalwear | 2 | STAT | 攻击速度+15，携带者部署方向左右两侧的我方干员攻击速度+10 | 攻击速度+25，携带者部署方向左右两侧的我方干员攻击速度+15 | 叙拉古(siracusaShip) | x2 |
| `chess_item_3_02_e_a` | 精准狙击镜 | Precision Scope | 2 | ON_HIT | 攻击距离自身3格及以上的目标时，伤害提高30% | 攻击距离自身3格及以上的目标时，伤害提高50% | 精准(preciShip) | x2 |
| `chess_item_3_03_e_a` | 激光发射器 | Laser Sighter | 2 | STAT | 攻击无视目标25%法术抗性 | 攻击无视目标45%法术抗性 |  | x2 |
| `chess_item_3_04_e_a` | 炎国短刀 | Yanese Dagger | 2 | ON_HIT | 每开启一次技能，获得5%的攻击力加成（最多叠加10次） | 每开启一次技能，获得8%的攻击力加成（最多叠加10次） | 炎(yanShip) | x2 |
| `chess_item_3_05_e_a` | 迅捷作战粮 | Quick Combat Rations | 2 | SP | 部署时，获得3点技力；每有一个同盟约的其他干员，额外获得3点技力 | 部署时，获得6点技力；每有一个同盟约的其他干员，额外获得6点技力 | 迅捷(swiftShip) | x2 |
| `chess_item_3_06_e_a` | 歌利亚头盔 | Goliath Helmet | 2 | STAT | 生命值+25%；部署时若身前一格没有其他干员，生命值额外+15% | 生命值+45%；部署时若身前一格没有其他干员，生命值额外+25% |  | x2 |
| `chess_item_3_07_e_a` | 阿戈尔重刃 | Aegirian Blade | 2 | STAT | 攻击力+40%，攻击速度-10 | 攻击力+60%，攻击速度-10 | 阿戈尔(egirShip) | x2 |
| `chess_item_3_08_e_a` | 奥术法阵 | Pocket Arts Circle | 1 | STAT | 法术抗性+20，攻击使目标失去特殊能力5秒 | 法术抗性+30，攻击使目标失去特殊能力5秒 | 奥术(arcaneShip) | x2 |
| `chess_item_3_09_e_a` | 坚固维式重锤 | Durable Victorian Hammer | 2 | SURVIVAL | 攻击力+25%；首次受到致命伤害时生命值不低于1，持续8秒 | 攻击力+45%；首次受到致命伤害时生命值不低于1，持续8秒 | 维多利亚(victoriaShip) | x2 |
| `chess_item_3_10_e_a` | 加速维式重锤 | Speedy Victorian Hammer | 2 | STAT | 攻击力+25%；攻击速度+30 | 攻击力+45%；攻击速度+30 | 维多利亚(victoriaShip) | x2 |
| `chess_item_3_11_e_a` | 突袭手雷 | Raid Grenade | 1 | ON_HIT | 每次部署后的10秒内，攻击时使目标晕眩2秒 | 每次部署后的15秒内，攻击时使目标晕眩2秒 | 突袭(raidShip) | x2 |
| `chess_item_3_12_e_a` | 骑士储蓄罐 | Knight Piggy Bank | 3 | ECONOMY | 装备时销毁，并随机获得1~6资金 | 装备时销毁，并随机获得2~12资金 |  | x2 |

### Tier IV

| id | name | EN | price | cat | normal effect | golden effect | giveBond | merge |
|---|---|---|---|---|---|---|---|---|
| `chess_item_4_01_e_a` | 寻呼模块 | Dispatch Module | 4 | RECRUIT | 装备时销毁，立即特殊刷新一次调度中心，出现三名与该干员有相同盟约的干员，免费获取其中一名！（不高于当前调度中心等级） | 装备时销毁，立即特殊刷新一次调度中心，出现三名与该干员有相同盟约的干员，免费获取其中一名！（不高于当前调度中心等级） |  | no |
| `chess_item_4_02_e_a` | 蜂鸣器 | Buzzer | 1 | SURVIVAL | 更容易受到攻击，生命值+40% | 更容易受到攻击，生命值+60% |  | x2 |
| `chess_item_4_03_e_a` | 有限加速器 | Miniature Accelerator | 2 | ON_HIT | 每次攻击或治疗后，本场战斗中攻击速度+1，最高60层 | 每次攻击或治疗后，本场战斗中攻击速度+2，最高60层 |  | x2 |
| `chess_item_4_04_e_a` | 伪装服 | Disguise Outfit | 1 | SURVIVAL | 首次受到伤害后获得隐匿，持续15秒 | 首次受到伤害后获得隐匿，持续25秒 |  | x2 |
| `chess_item_4_05_e_a` | 防暴盾 | Riot Shield | 2 | SURVIVAL | 阻挡敌人时，受到来自非自身阻挡单位的伤害降低40% | 阻挡敌人时，受到来自非自身阻挡单位的伤害降低70% |  | x2 |
| `chess_item_4_06_e_a` | 休眠子裔 | Dormant Heir | 2 | SURVIVAL | 每攻击1个目标，回复自身2%最大生命值 | 每攻击1个目标，回复自身4%最大生命值 |  | x2 |
| `chess_item_4_07_e_a` | 卡西米尔竞技旗 | Kazimierz Tournament Banner | 2 | ON_HIT | 部署后15秒内造成的伤害提升至135%，随后逐渐衰减 | 部署后15秒内造成的伤害提升至160%，随后逐渐衰减 | 卡西米尔(kazimierzShip) | x2 |
| `chess_item_4_08_e_a` | 拉特兰桥夹 | Lateran Clip | 1 | ON_HIT | 子弹类技能剩余一发子弹时有50%概率恢复40%的子弹（每次部署最多触发3次） | 子弹类技能剩余一发子弹时有60%概率恢复60%的子弹（每次部署最多触发3次） | 拉特兰(lateranoShip) | x2 |
| `chess_item_4_09_e_a` | 灼燃维式重锤 | Burning Victorian Hammer | 2 | ON_HIT | 攻击力+30%；造成法术伤害附带相当于10%伤害的灼燃损伤 | 攻击力+50%；造成法术伤害附带相当于10%伤害的灼燃损伤 | 维多利亚(victoriaShip) | x2 |
| `chess_item_4_10_e_a` | 浓缩嗅盐 | Concentrated Smelling Salts | 2 | SURVIVAL | 生命值大于70%时，免疫晕眩、冻结等特殊状态 | 生命值大于40%时，免疫晕眩、冻结等特殊状态 |  | x2 |
| `chess_item_4_11_e_a` | 护盾无人机 | Protection Drone | 2 | SURVIVAL | 治疗时有10%概率使目标获得1层护盾（最多1层） | 治疗时有15%概率使目标获得1层护盾（最多1层） |  | x2 |
| `chess_item_4_12_e_a` | M3茧甲 | M3 Cocoon Shell | 3 | SURVIVAL | 战斗阶段被击倒时立刻复活（一场战斗仅1次） | 战斗阶段被击倒时立刻复活（一场战斗仅2次） |  | x2 |

### Tier V

| id | name | EN | price | cat | normal effect | golden effect | giveBond | merge |
|---|---|---|---|---|---|---|---|---|
| `chess_item_5_01_e_a` | 催泪瓦斯 | Teargas Can | 2 | ON_HIT | 攻击时有3%概率使目标获得一层麻痹 | 攻击时有5%概率使目标获得一层麻痹 |  | x2 |
| `chess_item_5_02_e_a` | 谢拉格不融冰 | Kjeragi Nevermeltice | 2 | ON_HIT | 攻击时有12%概率对目标施加1.5秒的寒冷 | 攻击时有20%概率对目标施加1.5秒的寒冷 | 谢拉格(kjeragShip) | x2 |
| `chess_item_5_03_e_a` | 双模机械臂 | Bimodule Robotic Arm | 3 | ON_HIT | 攻击力+30%，自身造成物理和法术伤害时，伤害类型转化为弱点伤害 | 攻击力+50%，自身造成物理和法术伤害时，伤害类型转化为弱点伤害 |  | x2 |
| `chess_item_5_04_e_a` | 信标 | Transmitter (Beacon) | 3 | RECRUIT | 装备时，目标干员和本装备销毁并进行一次特殊刷新，出现两名与携带者同等阶的干员，免费获取其中一名 / 若在同盟模拟中且存在其他队友，下个休整期向相应盟约人数最多的队友发送1个原干员 / 相应盟约人数相同则随机发送 / 无法装备给自编干员 | 装备时，目标干员和本装备销毁并进行一次特殊刷新，出现两名与携带者同等阶的干员，免费获取其中一名 / 若在同盟模拟中且存在其他队友，下个休整期向相应盟约人数最多的队友发送1个原干员 / 相应盟约人数相同则随机发送 / 无法装备给自编干员 |  | no |
| `chess_item_5_05_e_a` | 拟态物质 | Mimic Matter | 4 | RECRUIT | 装备时销毁，若已拥有至少2名该初始干员，则再获得1名该初始干员；否则随机获得1名同盟约初始干员 | 装备时销毁，若已拥有至少2名该初始干员，则再获得1名该初始干员；否则随机获得1名同盟约初始干员 |  | no |
| `chess_item_5_06_e_a` | 博士投影 | Doctor Hologram | 5 | RECRUIT | 任意干员可装备，下个回合开始时销毁，并使该干员晋升为精锐干员 | 任意干员可装备，立即使该干员晋升为精锐干员 |  | x2 |
| `chess_item_5_07_e_a` | 商业包装方案 | Commercial Packaging Plan | 3 | RECRUIT | 每出售8名干员，额外获得一个与此装备携带者的同盟约初始干员（不高于当前调度中心等级） | 每出售7名干员，额外获得一个与此装备携带者的同盟约初始干员（不高于当前调度中心等级） |  | x2 |
| `chess_item_5_08_e_a` | 突变细胞 | Mutated Cells | 2 | RECRUIT | 战斗结束后，装备者替换为高一阶的随机干员 | 战斗结束后，装备者替换为高一阶的随机干员 |  | no |
| `chess_item_5_09_e_a` | 天马之盔 | Pegasus Helm | 3 | SET | 生命值+50%，若与“天马之枪”一起装备，每秒回复8%最大生命值。 | 生命值+75%，若与“天马之枪”一起装备，每秒回复8%最大生命值。 |  | x2 |

### Tier VI

| id | name | EN | price | cat | normal effect | golden effect | giveBond | merge |
|---|---|---|---|---|---|---|---|---|
| `chess_item_6_01_e_a` | 天马之枪 | Pegasus Lance | 3 | SET | 攻击力+40%，若与“天马之盔”一起装备，造成伤害时额外造成30%的真实伤害 | 攻击力+60%，若与“天马之盔”一起装备，造成伤害时额外造成30%的真实伤害 |  | x2 |
| `chess_item_6_02_e_a` | 铳骑之威 | Gun-Knight's Might | 4 | BOND_SIGNATURE | 攻击力+40%；若携带者为【拉特兰】盟约干员，该干员每次攻击时，有35%概率额外对攻击范围内一名敌人发射子弹造成150%攻击力的物理伤害 / 若该【拉特兰】盟约干员同时装备“拉特兰桥夹”，子弹伤害改为300%攻击力 | 攻击力+60%；若携带者为【拉特兰】盟约干员，该干员每次攻击时，有35%概率额外对攻击范围内一名敌人发射子弹造成150%攻击力的物理伤害 / 若该【拉特兰】盟约干员同时装备“拉特兰桥夹”，子弹伤害改为300%攻击力 |  | x2 |
| `chess_item_6_03_e_a` | 天师古鼎 | Tianshi's Cauldron | 4 | BOND_SIGNATURE | 生命值+45%；若携带者为【炎】盟约干员，本回合每获得过1名干员战斗开始后攻击速度+25（最多3层） / 若该【炎】盟约干员同时装备“炎国短刀”，每次获得干员时获得2资金（每回合最多3次） | 生命值+70%；若携带者为【炎】盟约干员，本回合每获得过1名干员战斗开始后攻击速度+25（最多3层） / 若该【炎】盟约干员同时装备“炎国短刀”，每次获得干员时获得2资金（每回合最多3次） |  | x2 |
| `chess_item_6_04_e_a` | 海沟实验体 | Trench Test Subject | 4 | BOND_SIGNATURE | 获得180点伤害减免；若携带者为【阿戈尔】盟约干员，自身受到伤害时对伤害来源造成自身攻击力50%的法术伤害（每0.5秒最多触发一次） / 若该【阿戈尔】盟约干员同时装备“阿戈尔重刃”，则自身受到伤害时额外造成一次50%攻击力的法术伤害（每0.5秒最多触发一次） | 获得300点伤害减免；若携带者为【阿戈尔】盟约干员，自身受到伤害时对伤害来源造成自身攻击力50%的法术伤害（每0.5秒最多触发一次） / 若该【阿戈尔】盟约干员同时装备“阿戈尔重刃”，则自身受到伤害时额外造成一次50%的攻击力的法术伤害（每0.5秒最多触发一次） |  | x2 |
| `chess_item_6_05_e_a` | 蒸汽之心 | Steam Heart | 4 | BOND_SIGNATURE | 攻击速度+35；若携带者为【维多利亚】盟约干员，该干员获得当前场上所有维式重锤特殊效果 / 若该【维多利亚】盟约干员同时装备“维式重锤”系列装备，该“维式重锤”装备特殊效果获得强化（效果变为2倍） | 攻击速度+55；若携带者为【维多利亚】盟约干员，该干员获得当前场上所有维式重锤特殊效果 / 若该【维多利亚】盟约干员同时装备“维式重锤”系列装备，该“维式重锤”装备特殊效果获得强化（效果变为2倍） |  | x2 |
| `chess_item_6_06_e_a` | 耶拉冈德之泪 | Kjeragandr's Tears | 4 | BOND_SIGNATURE | 法术抗性+30；若携带者为【谢拉格】盟约干员，该干员攻击范围内被寒冷或冻结的敌人每秒受到一次自身攻击力30%的法术伤害 / 若该【谢拉格】盟约干员同时装备“谢拉格不融冰”，则使自身攻击范围内寒冷或冻结的敌人每秒受到的法术伤害提升至100%攻击力 | 法术抗性+50；若携带者为【谢拉格】盟约干员，该干员攻击范围内被寒冷或冻结的敌人每秒受到一次自身攻击力30%的法术伤害 / 若该【谢拉格】盟约干员同时装备“谢拉格不融冰”，则使自身攻击范围内寒冷或冻结的敌人每秒受到的法术伤害提升至100%攻击力 |  | x2 |
| `chess_item_6_07_e_a` | 黄沙罗盘 | Desert Compass | 4 | BOND_SIGNATURE | 初始技力+30；若携带者为【萨尔贡】盟约干员，该干员首次技能结束时立刻回复30点技力 / 若该【萨尔贡】盟约干员同时装备“萨尔贡浓茶”，每次开启技能时为全部【萨尔贡】干员回复3点技力 | 初始技力+50；若携带者为【萨尔贡】盟约干员，该干员首次技能结束时立刻回复30点技力 / 若该【萨尔贡】盟约干员同时装备“萨尔贡浓茶”，每次开启技能时为全部【萨尔贡】干员回复3点技力 |  | x2 |
| `chess_item_6_08_e_a` | 人事部文档 | HR File | 4 | RECRUIT | 装备时销毁，最大可部署人数变为9 | 装备时销毁，最大可部署人数变为9 |  | no |
| `chess_item_6_09_e_a` | 变形同构体 | Damazti Isomorph | 3 | BOND_GRANT | 携带者获得额外盟约（由另一件携带装备而定） / 具体对应关系可在模拟中查看本装备天赋栏 | 携带者获得额外盟约（由另一件携带装备而定） / 具体对应关系可在模拟中查看本装备天赋栏 |  | no |
| `chess_item_6_10_e_a` | 骑士戒律 | Knightly Code | 4 | BOND_SIGNATURE | 再部署时间-40%；若携带者为【卡西米尔】盟约干员，开启技能后20s内，使攻击范围内敌人攻击速度-35%，移动速度-35% / 若该【卡西米尔】盟约干员同时装备“卡西米尔竞技旗”，该卡西米尔干员技能持续期间，攻击力+100%，且受到致命伤害时不撤退，技能结束后退场 | 再部署时间-60%；若携带者为【卡西米尔】盟约干员，开启技能后20s内，使攻击范围内敌人攻击速度-35%，移动速度-35% / 若该【卡西米尔】盟约干员同时装备“卡西米尔竞技旗”，该卡西米尔干员技能持续期间，攻击力+100%，且受到致命伤害时不撤退，技能结束后退场 |  | x2 |
| `chess_item_6_11_e_a` | 家族徽章 | Family Crest | 4 | BOND_SIGNATURE | 技力自然回复速度+0.2/秒；若携带者为【叙拉古】盟约干员，该干员处于隐匿状态时，攻击力逐渐提升至200%，持续至隐匿结束后首次造成伤害或干员离场 / 若该【叙拉古】盟约干员同时装备“叙拉古正装”，该叙拉古干员失去隐匿后首次造成伤害时额外造成800%攻击力的真实伤害 | 技力自然回复速度+0.35/秒；若携带者为【叙拉古】盟约干员，该干员处于隐匿状态时，攻击力逐渐提升至200%，持续至隐匿结束后首次造成伤害或干员离场 / 若该【叙拉古】盟约干员同时装备“叙拉古正装”，该叙拉古干员失去隐匿后首次造成伤害时额外造成800%攻击力的真实伤害 |  | x2 |

## 4. Implementable categories and formulas

Param names below are the keys of `items[].normal.params` / `items[].golden.params` in the JSON (flattened blackboards; duplicate keys get suffix `_1`). Values shown as normal / golden.

### STAT - 属性型 Flat stat modifiers (always on while equipped)

- **维式重锤** (`chess_item_1_01_e_a`, TI, 1) - ATK% += atk (additive with other ATK% buffs)  
  params: `atk=0.15/0.25`; buff keys: `env_gbuff_new_with_verify`
- **坚守盾牌** (`chess_item_1_02_e_a`, TI, 1) - DEF% += def  
  params: `def=0.2/0.35`; buff keys: `env_gbuff_new_with_verify`
- **源石溶剂** (`chess_item_1_05_e_a`, TI, 1) - ATK% += atk; in battle carrier loses `damage` HP per second (periodic self-damage, true/unmitigated [ASSUMED], can kill the carrier [ASSUMED]).  
  params: `atk=0.4/0.6, damage=60.0`; buff keys: `env_gbuff_new_with_verify, env_gbuff_new_with_verify`
- **不屈弹射器** (`chess_item_2_01_e_a`, TII, 1) - respawnTime *= (1 + respawn_time) (i.e. -30%/-50%); maxHP% += max_hp (-30%).  
  params: `respawn_time=-0.3/-0.5, max_hp=-0.3`; buff keys: `env_gbuff_new_with_verify`
- **萨尔贡浓茶** (`chess_item_2_04_e_a`, TII, 2) - spRecoveryPerSec += sp_recovery_per_sec (flat, on top of base 1 SP/s for auto-recovery skills).  
  params: `sp_recovery_per_sec=0.15/0.25`; buff keys: `env_gbuff_new_with_verify`
- **叙拉古正装** (`chess_item_3_01_e_a`, TIII, 2) - Carrier ASPD += attack_speed. Allies deployed on the 2 tiles left/right of the carrier (perpendicular to its facing direction) get ASPD += attack_speed_1 while the carrier is on the field.  
  params: `attack_speed=15.0/25.0, at_root=1.0, attack_speed_1=10.0/15.0`; buff keys: `env_gbuff_new_with_verify, char_dynamic_ability_new`
- **激光发射器** (`chess_item_3_03_e_a`, TIII, 2) - Carrier's attacks ignore magic_resist_penetrate (percent) of target RES: effRES = RES * (1 - p).  
  params: `magic_resist_penetrate=0.25/0.45`; buff keys: `env_gbuff_new_with_verify`
- **歌利亚头盔** (`chess_item_3_06_e_a`, TIII, 2) - maxHP% += init_max_hp; additionally, if at deploy time the tile directly in front of the carrier (facing direction) has no allied operator, maxHP% += ex_max_hp.  
  params: `init_max_hp=0.25/0.45, ex_max_hp=0.15/0.25`; buff keys: `env_gbuff_new_with_verify`
- **阿戈尔重刃** (`chess_item_3_07_e_a`, TIII, 2) - ATK% += atk; ASPD += attack_speed (-10).  
  params: `atk=0.4/0.6, attack_speed=-10.0`; buff keys: `env_gbuff_new_with_verify`
- **奥术法阵** (`chess_item_3_08_e_a`, TIII, 1) - RES += magic_resistance (flat); each attack applies 失去特殊能力 (silence: enemy loses its special abilities/talents) to target for `silence` s.  
  params: `magic_resistance=20.0/30.0, silence=5.0`; buff keys: `env_gbuff_new_with_verify, env_gbuff_new_with_verify`
- **加速维式重锤** (`chess_item_3_10_e_a`, TIII, 2) - ATK% += atk; ASPD += attack_speed (the hammer 'special effect' = the ASPD part).  
  params: `atk=0.25/0.45, attack_speed=30.0`; buff keys: `env_gbuff_new_with_verify, env_gbuff_new_with_verify`

### ON_HIT - 战斗触发 On-attack / on-skill / time-window combat effects

- **战栗维式重锤** (`chess_item_2_03_e_a`, TII, 2) - ATK% += atk. If carrier is a MELEE(ground) operator: on each attack, prob chance to apply 战栗(Tremble: target cannot normal-attack while blocked) for disarmed_duration s. Special effect doubled (prob x2 [ASSUMED]) when carrier also has 蒸汽之心 and is Victoria.  
  params: `atk=0.2/0.35, prob=0.1, disarmed_duration=2.0`; buff keys: `env_gbuff_new_with_verify, env_gbuff_new_with_verify`
- **精准狙击镜** (`chess_item_3_02_e_a`, TIII, 2) - If distance(carrier tile, target) >= radius (3 tiles, Chebyshev/Euclid on tile grid [ASSUMED Euclidean]), outgoing damage *= damage_scale.  
  params: `radius=3.0, damage_scale=1.3/1.5`; buff keys: `env_gbuff_new_with_verify`
- **炎国短刀** (`chess_item_3_04_e_a`, TIII, 2) - Each time the carrier activates a skill: stacks = min(stacks+1, atk_buff_cnt); ATK% += atk * stacks. Stacks reset each battle.  
  params: `prob=1.0, atk=0.05/0.08, atk_buff_cnt=10.0`; buff keys: `env_gbuff_new_with_verify`
- **突袭手雷** (`chess_item_3_11_e_a`, TIII, 1) - For `duration` s after EACH deploy, every attack stuns the target for `stun` s.  
  params: `stun=2.0, duration=10.0/15.0`; buff keys: `env_gbuff_new_with_verify`
- **有限加速器** (`chess_item_4_03_e_a`, TIV, 2) - After each attack or heal: stacks = min(stacks+1, max_buff_cnt); ASPD += attack_speed * stacks. Resets each battle.  
  params: `attack_speed=1.0/2.0, max_buff_cnt=60.0, atk=0.0`; buff keys: `env_gbuff_new_with_verify`
- **卡西米尔竞技旗** (`chess_item_4_07_e_a`, TIV, 2) - After each deploy: outgoing damage *= damage_scale for `interval` (15) s; afterwards every ex_interval (0.5) s the multiplier changes by damage_scale_minus until it reaches 1.0.  
  params: `damage_scale=1.35/1.6, interval=15.0, ex_interval=0.5, damage_scale_minus=-0.04/-0.07`; buff keys: `env_gbuff_new_with_verify`
- **拉特兰桥夹** (`chess_item_4_08_e_a`, TIV, 1) - Ammo-type skills: when ammo remaining becomes 1, prob chance to restore ceil(ammo_percent * maxAmmo) [ASSUMED rounding] bullets; max max_trigger_cnt triggers per deploy.  
  params: `prob=0.5/0.6, ammo_percent=0.4/0.6, max_trigger_cnt=3.0`; buff keys: `env_gbuff_new_with_verify`
- **灼燃维式重锤** (`chess_item_4_09_e_a`, TIV, 2) - ATK% += atk. When dealing ARTS damage: also inflict 灼燃损伤(Burn elemental damage) = damage_scale * that damage.  
  params: `atk=0.3/0.5, damage_scale=0.1`; buff keys: `env_gbuff_new_with_verify, env_gbuff_new_with_verify`
- **催泪瓦斯** (`chess_item_5_01_e_a`, TV, 2) - On attack: prob chance to add 1 layer of 麻痹(Paralysis: each layer interrupts one enemy normal attack, max 3 layers).  
  params: `prob=0.03/0.05`; buff keys: `env_gbuff_new_with_verify`
- **谢拉格不融冰** (`chess_item_5_02_e_a`, TV, 2) - On attack: prob chance to apply 寒冷(Cold: ASPD -30; cold again while cold -> Frozen) for `cold` s.  
  params: `prob=0.12/0.2, cold=1.5`; buff keys: `env_gbuff_new_with_verify`
- **双模机械臂** (`chess_item_5_03_e_a`, TV, 3) - ATK% += atk; carrier's physical and arts damage becomes 弱点伤害(weakness damage): each hit is dealt as whichever of physical/arts yields MORE damage against that target's DEF/RES.  
  params: `atk=0.3/0.5`; buff keys: `env_gbuff_new_with_verify, env_gbuff_new_with_verify`

### SURVIVAL - 生存 Survival (taunt, shields, undying, revive, DR, CC-immunity)

- **坚固维式重锤** (`chess_item_3_09_e_a`, TIII, 2) - ATK% += atk. First time per battle carrier would take lethal damage: HP cannot drop below 1 for undeadable_duration s.  
  params: `atk=0.25/0.45, undeadable_duration=8.0`; buff keys: `env_gbuff_new_with_verify, env_gbuff_new_with_verify`
- **蜂鸣器** (`chess_item_4_02_e_a`, TIV, 1) - tauntLevel = 1 (enemies prefer this unit as target); maxHP% += max_hp.  
  params: `taunt_level=1.0, max_hp=0.4/0.6`; buff keys: `env_gbuff_new_with_verify, env_gbuff_new_with_verify`
- **伪装服** (`chess_item_4_04_e_a`, TIV, 1) - First time the carrier takes damage in a battle: gain 隐匿(Camouflage: not targeted by ranged enemies unless blocking) for `duration` s.  
  params: `duration=15.0/25.0`; buff keys: `env_gbuff_new_with_verify`
- **防暴盾** (`chess_item_4_05_e_a`, TIV, 2) - While the carrier is blocking >=1 enemy: damage taken from sources NOT blocked by the carrier *= damage_scale.  
  params: `damage_scale=0.6/0.3`; buff keys: `env_gbuff_new_with_verify`
- **休眠子裔** (`chess_item_4_06_e_a`, TIV, 2) - For each target hit by an attack: heal self hp_ratio * maxHP.  
  params: `hp_ratio=0.02/0.04`; buff keys: `env_gbuff_new_with_verify`
- **浓缩嗅盐** (`chess_item_4_10_e_a`, TIV, 2) - While HP/maxHP > hp_ratio: immune to stun, freeze, sleep, and other CC 'special states' [ASSUMED list: stun/freeze/sleep/levitate/palsy].  
  params: `hp_ratio=0.7/0.4`; buff keys: `env_gbuff_new_with_verify`
- **护盾无人机** (`chess_item_4_11_e_a`, TIV, 2) - Each heal the carrier performs: prob chance to give the healed target 1 shield layer (max max_stack_cnt layers; 1 layer blocks one instance of damage).  
  params: `prob=0.1/0.15, max_stack_cnt=1.0`; buff keys: `env_gbuff_new_with_verify`
- **M3茧甲** (`chess_item_4_12_e_a`, TIV, 3) - When the carrier is defeated during the battle phase: revive immediately in place at full HP [ASSUMED full HP] up to max_respawn_cnt times per battle.  
  params: `max_respawn_cnt=1.0/2.0`; buff keys: `env_gbuff_new_with_verify`

### SP - 技力 SP gain

- **迅捷作战粮** (`chess_item_3_05_e_a`, TIII, 2) - On deploy: SP += sp_each_person * (1 + N), N = number of OTHER deployed operators sharing at least one bond with the carrier [ASSUMED interpretation].  
  params: `sp_each_person=3.0/6.0`; buff keys: `env_gbuff_new_with_verify`

### ECONOMY - 经济 Consumed on equip, gives funds

- **盟约之币** (`chess_item_1_03_e_a`, TI, 1) - On equip: destroy item, player.funds += randInt(min,max) (normal 1, golden 2). Does not use an equip slot.  
  params: `min=1.0/2.0, max=1.0/2.0`; buff keys: `equip_destory_gain_random_coin`
- **精打细算玩偶** (`chess_item_2_05_e_a`, TII, 3) - On equip: destroy item; register a permanent player effect: at the start of every subsequent round player.funds += count (stackable).  
  params: `count=1.0/2.0`; buff keys: `gain_coin_when_round_start`
- **见钱眼开玩偶** (`chess_item_2_07_e_a`, TII, 1) - On equip: destroy item; at the start of NEXT round only: player.funds += count.  
  params: `count=2.0/4.0`; buff keys: `use_equip_gain_coin_when_next_round_start`
- **骑士储蓄罐** (`chess_item_3_12_e_a`, TIII, 3) - On equip: destroy item, player.funds += randInt(min,max) inclusive (normal 1-6, golden 2-12).  
  params: `min=1.0/2.0, max=6.0/12.0`; buff keys: `equip_destory_gain_random_coin`

### RECRUIT - 调度 Roster manipulation (get / transform / promote operators, deploy cap)

- **紧急调度券** (`chess_item_2_02_e_a`, TII, 2) - On equip: destroy item; pick `count` random operator(s) currently displayed in the player's shop (调度中心) slots, move them to hand for free; those shop slots become empty.  
  params: `count=1.0/2.0`; buff keys: `use_equip_reward_random_char_chess_in_shop`
- **简易通讯机** (`chess_item_2_06_e_a`, TII, 2) - On equip: destroy item; give player `count` random NORMAL-quality operator(s) that share at least one bond with the target operator (tier <= current shop level [ASSUMED]).  
  params: `count=1.0/2.0`; buff keys: `use_equip_reward_char_chess_with_same_bond`
- **寻呼模块** (`chess_item_4_01_e_a`, TIV, 4) - On equip: destroy item; open a special shop refresh with refresh_cnt(3) operators sharing a bond with the target (tier <= current shop level); player takes choice_cnt(1) of them for free. Never merges (upgradeNum=100).  
  params: `refresh_cnt=3.0, choice_cnt=1.0`; buff keys: `use_equip_reward_special_goods_char_chess`
- **信标** (`chess_item_5_04_e_a`, TV, 3) - On equip: destroy BOTH the item and the target operator; special refresh of refresh_cnt(2) operators of the SAME tier as the target, take choice_cnt(1) free. Multiplayer: at next prep phase send 1 copy of the original operator to the teammate who has the most operators of that operator's bond(s) (tie -> random). Cannot target DIY(自编) operators. Never merges.  
  params: `refresh_cnt=2.0, choice_cnt=1.0`; buff keys: `use_equip_recruit_new_char_and_give_char_to_player_most_bond`
- **拟态物质** (`chess_item_5_05_e_a`, TV, 4) - On equip: destroy item; if player owns >= 2 NORMAL copies of the target operator (field+hand), give 1 more normal copy (usually triggers 3->elite merge); else give 1 random normal operator sharing a bond with the target. Never merges.  
  params: `-`; buff keys: `use_equip_reward_char_chess`
- **博士投影** (`chess_item_5_06_e_a`, TV, 5) - Normal: equip onto any normal operator (occupies a slot until next round start), at the start of the next round destroy item and promote the operator to elite(精锐/golden). Golden: on equip, destroy item and promote immediately. On promotion, equipped items return to hand.  
  params: `-`; buff keys: `equip_round_start_upgrade_char`
- **商业包装方案** (`chess_item_5_07_e_a`, TV, 3) - Stays equipped. Counter of operators SOLD by the player (any): every `count` sales, give 1 random NORMAL operator sharing a bond with the carrier, tier <= current shop level.  
  params: `count=8.0/7.0`; buff keys: `sell_char_count_gain_equip_owner_bond`
- **突变细胞** (`chess_item_5_08_e_a`, TV, 2) - After the battle ends: replace the carrier with a random operator one tier higher (max tier 6). The cell is used up by that battle, but it is not lost: it comes back to the item list at the **next round start** (VERIFIED — user playtest; a normal item just stays equipped, this one is consumed and handed back a round later). The replacement is NOT deployed: it goes to the 备战区 (hand, overflow temp), even when the carrier stood on the board (VERIFIED — user playtest; the tile is freed). Keeps elite status? [ASSUMED: result is NORMAL quality; other equipped item returns to hand]. Never merges.  
  params: `-`; buff keys: `char_chess_transformation_equip`
- **人事部文档** (`chess_item_6_08_e_a`, TVI, 4) - On equip: destroy item; player's max deployable operator count becomes `count` (9) (base maxBattleChessCnt = 8). Never merges; a second copy has no further effect [ASSUMED].  
  params: `count=9.0`; buff keys: `equip_destory_deployment_cnt_change`

### BOND - 盟约层数 Bond-layer consumables

- **随身身份牌** (`chess_item_1_04_e_a`, TI, 1) - On equip: destroy item; for EACH bond of the target operator: bondLayer[bond] += layer (works even if that bond is not activated).  
  params: `layer=3.0/6.0`; buff keys: `use_equip_reward_char_chess_bond_layer`

### BOND_GRANT - 盟约赋予 Grants an extra bond

- **变形同构体** (`chess_item_6_09_e_a`, TVI, 3) - Carrier additionally counts as a member of bond B where B = giveBondId of the OTHER item equipped on the same operator (see bondGrantTable). No effect if the other item has giveBondId=null. Never merges.  
  params: `-`; buff keys: ``

### SET - 套装 Two-piece set (天马)

- **天马之盔** (`chess_item_5_09_e_a`, TV, 3) - maxHP% += max_hp. If carrier also holds 天马之枪 (either quality): regen hp_recovery_per_sec_by_max_hp_ratio * maxHP per second.  
  params: `max_hp=0.5/0.75, hp_recovery_per_sec_by_max_hp_ratio=0.08`; buff keys: `env_gbuff_new_with_verify, env_gbuff_new_with_verify`
- **天马之枪** (`chess_item_6_01_e_a`, TVI, 3) - ATK% += atk. If carrier also holds 天马之盔: every damage instance additionally deals atk_scale * ATK as TRUE damage [ASSUMED: % of ATK, per blackboard key atk_scale; description says 30% true damage].  
  params: `atk=0.4/0.6, atk_scale=0.3`; buff keys: `env_gbuff_new_with_verify, env_gbuff_new_with_verify`

### BOND_SIGNATURE - VI阶盟约专属 Bond-gated signature items (bonus if carrier has bond X, extra bonus if paired with bond's base item)

- **铳骑之威** (`chess_item_6_02_e_a`, TVI, 4) - ATK% += atk. If carrier has bond Laterano: on each attack, prob chance to fire an extra bullet at 1 enemy in range dealing atk_scale_1 * ATK physical damage; if carrier also holds 拉特兰桥夹 -> atk_scale_2 * ATK.  
  params: `prob=0.35, atk_scale_1=1.5, atk_scale_2=3.0, atk=0.4/0.6`; buff keys: `env_gbuff_new_with_verify, env_gbuff_new_with_verify`
- **天师古鼎** (`chess_item_6_03_e_a`, TVI, 4) - maxHP% += max_hp. If carrier has bond Yan: at battle start ASPD += attack_speed * min(k, max_cnt), k = operators the player acquired during THIS round's prep. If also holding 炎国短刀: each time the player acquires an operator, funds += count (max `max` times per round).  
  params: `attack_speed=25.0, max_cnt=3.0, max_hp=0.45/0.7, count=2.0, max=3.0`; buff keys: `env_gbuff_new_with_verify, env_gbuff_new_with_verify, equip_with_another_gain_coin_when_gain_char`
- **海沟实验体** (`chess_item_6_04_e_a`, TVI, 4) - Flat damage reduction: each incoming hit reduced by `value` (180/300, min 0 [ASSUMED]). If carrier has bond Aegir: when taking damage, deal atk_scale * ATK arts damage to the source (internal CD lock_duration 0.5 s); if also holding 阿戈尔重刃, one additional hit of atk_scale * ATK arts (same CD).  
  params: `lock_duration=0.5, atk_scale=0.5, value=180.0/300.0`; buff keys: `env_gbuff_new_with_verify, env_gbuff_new_with_verify`
- **蒸汽之心** (`chess_item_6_05_e_a`, TVI, 4) - ASPD += attack_speed_1 (35/55). If carrier has bond Victoria: gains the special effects of every hammer (灼燃/坚固/加速/战栗) currently equipped by ANY of the player's on-field operators (burn 10% of arts dmg, undying 8 s, ASPD +30, 10% tremble 2 s). If it also holds a hammer-series item, that hammer's special effect is doubled (burn 20%, undying 16 s, ASPD +60, tremble prob 20% [ASSUMED doubling targets]).  
  params: `damage_scale=0.1, undeadable_duration=8.0, attack_speed=30.0, prob=0.1, disarmed_duration=2.0, attack_speed_1=35.0/55.0`; buff keys: `env_gbuff_new_with_verify, env_gbuff_new_with_verify`
- **耶拉冈德之泪** (`chess_item_6_06_e_a`, TVI, 4) - RES += magic_resistance. If carrier has bond Kjerag: every `interval` (1 s) each Cold or Frozen enemy inside the carrier's attack range takes atk_scale * ATK arts damage; atk_scale_ex (100%) if carrier also holds 谢拉格不融冰.  
  params: `atk_scale=0.3, interval=1.0, atk_scale_ex=1.0, magic_resistance=30.0/50.0`; buff keys: `char_dynamic_ability_new, env_gbuff_new_with_verify`
- **黄沙罗盘** (`chess_item_6_07_e_a`, TVI, 4) - Initial SP += init_sp (30/50). If carrier has bond Sargon: when its FIRST skill ends, SP += sp (30). If also holding 萨尔贡浓茶: each time the carrier activates a skill, all Sargon operators on field gain addition_sp (3) SP.  
  params: `sp=30.0, addition_sp=3.0, init_sp=30.0/50.0`; buff keys: `env_gbuff_new_with_verify`
- **骑士戒律** (`chess_item_6_10_e_a`, TVI, 4) - respawnTime *= (1 + respawn_time) (-40%/-60%). If carrier has bond Kazimierz: for `duration` (20) s after activating a skill, enemies inside its attack range get ASPD x attack_speed(0.65) and move speed x move_speed(0.65) (i.e. -35%). If also holding 卡西米尔竞技旗: during skill duration ATK% += atk (+100%), and lethal damage does not retreat it; it retreats when the skill ends.  
  params: `respawn_time=-0.4/-0.6, max_hp=0.0, duration=20.0, atk=1.0, move_speed=0.65, attack_speed=0.65`; buff keys: `env_gbuff_new_with_verify, env_gbuff_new_with_verify, char_dynamic_ability_new`
- **家族徽章** (`chess_item_6_11_e_a`, TVI, 4) - spRecoveryPerSec += sp_recovery_per_sec (0.2/0.35). If carrier has bond Siracusa: while Camouflaged, ATK% += atk_per_sec per second (2%/s) up to max_atk (+100%, i.e. 200% ATK); the bonus lasts until the first damage dealt after camouflage ends, or until the carrier leaves the field. If also holding 叙拉古正装: that first hit after losing camouflage additionally deals atk_scale (800%) * ATK true damage.  
  params: `sp_recovery_per_sec=0.2/0.35, atk_per_sec=0.02, max_atk=1.0, atk_scale=8.0`; buff keys: `env_gbuff_new_with_verify, env_gbuff_new_with_verify`

### MAGIC - 法术 Arts: placed on a map tile, not equipped

- **“神秘顾客”** (`chess_item_6_01_m`, TVI, 2) - Drag onto the field: choose a special bounty (hunter_band_1). When actively destroyed: +1 fund and the item passes to the next player. UNUSED in act2 (no band/garrison grants it) - implement last or skip.  
  params: `count=1.0`; buff keys: `trap_create_self_choice, trap_disney_special`
- **画卷** (`chess_item_6_02_m`, TVI, 2) - Drag onto a map tile during prep. Range 1-1 = the tile itself + the tile in front (facing). Gives the player a copy of 1 operator inside that range, INCLUDING elite status and equipped items (copies go to hand). Consumed.  
  params: `-`; buff keys: `trap_copy_front_char`
- **教鞭** (`chess_item_6_03_m`, TVI, 2) - Drag onto the field during prep: opens a personal bounty choice (choice event hunter_band_1). The chosen bounty adds extra enemies to your next battle; killing them / perfect defence grants funds (see ENEMY_GAIN '...悬赏' effects). Consumed.  
  params: `-`; buff keys: `trap_create_self_choice`

## 5. 变形同构体 (Damazti Isomorph) bond-grant table [DATA]

Carrier gains the bond of its OTHER equipped item. From `trapChessDataDict[*].giveBondId` (also listed in the trap talent text).

| bond | items that grant it |
|---|---|
| 维多利亚 (`victoriaShip`) | 维式重锤(chess_item_1_01_e), 战栗维式重锤(chess_item_2_03_e), 坚固维式重锤(chess_item_3_09_e), 加速维式重锤(chess_item_3_10_e), 灼燃维式重锤(chess_item_4_09_e) |
| 坚守 (`steadShip`) | 坚守盾牌(chess_item_1_02_e) |
| 不屈 (`indomShip`) | 不屈弹射器(chess_item_2_01_e) |
| 萨尔贡 (`sargonShip`) | 萨尔贡浓茶(chess_item_2_04_e) |
| 叙拉古 (`siracusaShip`) | 叙拉古正装(chess_item_3_01_e) |
| 精准 (`preciShip`) | 精准狙击镜(chess_item_3_02_e) |
| 炎 (`yanShip`) | 炎国短刀(chess_item_3_04_e) |
| 迅捷 (`swiftShip`) | 迅捷作战粮(chess_item_3_05_e) |
| 阿戈尔 (`egirShip`) | 阿戈尔重刃(chess_item_3_07_e) |
| 奥术 (`arcaneShip`) | 奥术法阵(chess_item_3_08_e) |
| 突袭 (`raidShip`) | 突袭手雷(chess_item_3_11_e) |
| 卡西米尔 (`kazimierzShip`) | 卡西米尔竞技旗(chess_item_4_07_e) |
| 拉特兰 (`lateranoShip`) | 拉特兰桥夹(chess_item_4_08_e) |
| 谢拉格 (`kjeragShip`) | 谢拉格不融冰(chess_item_5_02_e) |

Note: 9 bonds cannot be obtained this way (灵巧, 助力, 远见, 奇迹, 投资人, 调和, 协防, 独行, 绝技 have no item).

## 6. VI-tier bond signature items and combos [DATA]

| item | base stat (normal/golden) | needs bond | bond effect | combo partner | combo effect |
|---|---|---|---|---|---|
| 铳骑之威 | ATK +40%/+60% | 拉特兰 | 35% on attack: extra bullet 150% ATK phys to 1 enemy in range | 拉特兰桥夹 | bullet 300% ATK |
| 天师古鼎 | HP +45%/+70% | 炎 | battle start ASPD +25 per operator acquired this round (max 3) | 炎国短刀 | +2 funds per operator acquired (max 3/round) |
| 海沟实验体 | flat DR 180/300 | 阿戈尔 | on hit taken: 50% ATK arts to source (0.5 s CD) | 阿戈尔重刃 | extra 50% ATK arts hit (0.5 s CD) |
| 蒸汽之心 | ASPD +35/+55 | 维多利亚 | gains special effects of all hammers equipped on your field | 维式重锤系列 | that hammer's special effect x2 |
| 耶拉冈德之泪 | RES +30/+50 | 谢拉格 | cold/frozen enemies in range take 30% ATK arts per s | 谢拉格不融冰 | 100% ATK per s |
| 黄沙罗盘 | initial SP +30/+50 | 萨尔贡 | first skill end: +30 SP | 萨尔贡浓茶 | each skill cast: all Sargon +3 SP |
| 骑士戒律 | redeploy -40%/-60% | 卡西米尔 | 20 s after skill: enemies in range ASPD/move x0.65 | 卡西米尔竞技旗 | during skill ATK +100%, no retreat on lethal, retreats when skill ends |
| 家族徽章 | SP regen +0.2/+0.35 /s | 叙拉古 | while camouflaged ATK +2%/s up to 200%, until first damage after camo | 叙拉古正装 | first hit after camo: +800% ATK true damage |
| 天马之枪 (no bond) | ATK +40%/+60% | - | - | 天马之盔 | +30% true damage on each damage instance |
| 天马之盔 (T5, no bond) | HP +50%/+75% | - | - | 天马之枪 | regen 8% maxHP per s |

Combo check: `equip_chess_id` in blackboard is the partner's id WITHOUT the `_a/_b` suffix -> either quality satisfies it.

## 7. MAGIC (法术 / Arts) [DATA]

| id | name | EN | tier | price | range | effect | obtained from |
|---|---|---|---|---|---|---|---|
| `chess_item_6_01_m` | “神秘顾客” | "Mystery Customer" | 6 | 2 (hidden) | `0-1` [{'row': 0, 'col': 0}] | 拖拽至场上使用后，选择一项特殊悬赏任务进行挑战；主动销毁时获得1份资金，并将“神秘顾客”传递给下一名玩家 | nothing in act2 (legacy/unused) |
| `chess_item_6_02_m` | 画卷 | Dusk's Scroll | 6 | 2 (hidden) | `1-1` [{'row': 0, 'col': 0}, {'row': 0, 'col': 1}] | 拖拽至场上使用后，获得范围内的干员（包括精锐状态和装备！） | band_dusk (【幻画为真】 round 1) |
| `chess_item_6_03_m` | 教鞭 | Pointing Stick | 6 | 2 (hidden) | `0-1` [{'row': 0, 'col': 0}] | 拖拽至场上使用后，选择一项悬赏任务进行挑战 | band_doberm (【加练！】 every 2 rounds) |

- Buff keys: 画卷 `trap_copy_front_char{}`; 教鞭 `trap_create_self_choice{choice_event=hunter_band_1}`; 神秘顾客 additionally `trap_disney_special{count=1}`.
- `hunter_band_1` (choiceType PERSONAL_CHOOSE, "悬赏决策") pool is server-side. [ASSUMED] offer 3 random `enemyeffect_b_*` bounties (e.g. 碎骨·悬赏 +1, 萨卡兹百夫长·悬赏 +2, 泥岩·悬赏 +4, 锏·悬赏 +5, “复仇者”·悬赏 +6 funds; buff `add_enemy_kill_gain_coin{count,enemy_id,coin,round=1}`): adds 1 enemy to your next battle, killer gets `coin` funds.
- 画卷 copy: duplicates the operator (same chess id incl. elite `_b`) AND clones its equipped items into the copy [DATA desc "包括精锐状态和装备"]; copy goes to hand [ASSUMED]; if hand full -> temporary hand.

## 8. Item sources other than the shop [DATA]

| source | id | trigger / what |
|---|---|---|
| BAND_INITIAL band_orchid | `aceffect_band_23` | 【猎头顾问】每次主动刷新均变为特殊刷新：必定刷新2名同名干员，并冻结其中一名；第10回合获得1个<寻呼模块> / <寻呼模块>：装备时销毁，立即在调度中心中刷新三名与该干员盟约相同的干员，免费获得其中一名!（不超过当前调度中心等级） -> `chess_item_4_01_e_a` {'round': 10.0, 'count': 1.0, 'type': 'equip'} |
| BAND_INITIAL band_doberm | `aceffect_band_25` | 【加练！】每2个回合获得1个特殊法术<教鞭> / <教鞭>：使用后为下场战斗添加额外敌人，若自身战斗完美作战可获得资金 -> `chess_item_6_03_m` {'round': 2.0, 'count': 1.0, 'type': 'trap'} |
| BAND_INITIAL band_cathy | `aceffect_band_26` | 【定向投放】每次升级调度中心时，在调度中心刷新随机3件装备，可以选择并获得其中1件 -> `pool_equip_kathe` {'count': 3.0, 'choice': 1.0} |
| BAND_INITIAL band_malkie | `aceffect_band_27` | 【商业包装】初始获得1个<商业包装方案> / <商业包装方案>：每出售8名任意干员后，获得1名装备者的同盟约普通干员 -> `chess_item_5_07_e_a` {'round': 1.0, 'count': 1.0, 'type': 'equip'} |
| BAND_INITIAL band_damaztic | `aceffect_band_40` | 【变形同构】每5回合获得1件特殊装备<变形同构体> / <变形同构体>：与特定装备一同装备时装备者将视为特定盟约成员 -> `chess_item_6_09_e_a` {'round': 5.0, 'count': 1.0, 'type': 'equip'} |
| BAND_INITIAL band_damaztic | `aceffect_band_40` | 【变形同构】每5回合获得1件特殊装备<变形同构体> / <变形同构体>：与特定装备一同装备时装备者将视为特定盟约成员 -> `chess_item_6_09_e_a` {'round': 10.0, 'count': 1.0, 'type': 'equip'} |
| BAND_INITIAL band_damaztic | `aceffect_band_40` | 【变形同构】每5回合获得1件特殊装备<变形同构体> / <变形同构体>：与特定装备一同装备时装备者将视为特定盟约成员 -> `chess_item_6_09_e_a` {'round': 15.0, 'count': 1.0, 'type': 'equip'} |
| BAND_INITIAL band_quintus | `aceffect_band_41` | 【不稳定要素】第3回合获得1件特殊装备<突变细胞> / <突变细胞>：战斗结束后使装备者变为高一阶的随机干员（最高6阶） -> `chess_item_5_08_e_a` {'round': 3.0, 'count': 1.0, 'type': 'equip'} |
| BAND_INITIAL band_dusk | `aceffect_band_45` | 【墨色真颜】若你的场上存在同名干员，这些干员攻击力+30% / 【幻画为真】第1回合获得1个特殊法术<画卷> / <画卷>：使用后可以复制该法术范围内的1名干员（包括精锐状态和携带的装备） -> `chess_item_6_02_m` {'round': 1.0, 'count': 1.0, 'type': 'trap'} |
| BAND_INITIAL band_justin | `aceffect_band_47` | 【私募基金】在第1、4、7、10回合进入休整期时获得1个<骑士储蓄罐> / <骑士储蓄罐>：装备时随机获得1~6资金并销毁 -> `chess_item_3_12_e_a` {'round': 1.0, 'count': 1.0, 'type': 'equip'} |
| BAND_INITIAL band_justin | `aceffect_band_47` | 【私募基金】在第1、4、7、10回合进入休整期时获得1个<骑士储蓄罐> / <骑士储蓄罐>：装备时随机获得1~6资金并销毁 -> `chess_item_3_12_e_a` {'round': 4.0, 'count': 1.0, 'type': 'equip'} |
| BAND_INITIAL band_justin | `aceffect_band_47` | 【私募基金】在第1、4、7、10回合进入休整期时获得1个<骑士储蓄罐> / <骑士储蓄罐>：装备时随机获得1~6资金并销毁 -> `chess_item_3_12_e_a` {'round': 7.0, 'count': 1.0, 'type': 'equip'} |
| BAND_INITIAL band_justin | `aceffect_band_47` | 【私募基金】在第1、4、7、10回合进入休整期时获得1个<骑士储蓄罐> / <骑士储蓄罐>：装备时随机获得1~6资金并销毁 -> `chess_item_3_12_e_a` {'round': 10.0, 'count': 1.0, 'type': 'equip'} |
| BAND_INITIAL band_jesica | `aceffect_band_54` | 【集结指示】在第4、7、10、13回合进入休整期时获得1个<寻呼模块> / <寻呼模块>：装备时销毁，立即在调度中心中刷新三名与该干员盟约相同的干员，免费获得其中一名!（不超过当前调度中心等级） -> `chess_item_4_01_e_a` {'round': 4.0, 'count': 1.0, 'type': 'equip'} |
| BAND_INITIAL band_jesica | `aceffect_band_54` | 【集结指示】在第4、7、10、13回合进入休整期时获得1个<寻呼模块> / <寻呼模块>：装备时销毁，立即在调度中心中刷新三名与该干员盟约相同的干员，免费获得其中一名!（不超过当前调度中心等级） -> `chess_item_4_01_e_a` {'round': 7.0, 'count': 1.0, 'type': 'equip'} |
| BAND_INITIAL band_jesica | `aceffect_band_54` | 【集结指示】在第4、7、10、13回合进入休整期时获得1个<寻呼模块> / <寻呼模块>：装备时销毁，立即在调度中心中刷新三名与该干员盟约相同的干员，免费获得其中一名!（不超过当前调度中心等级） -> `chess_item_4_01_e_a` {'round': 10.0, 'count': 1.0, 'type': 'equip'} |
| BAND_INITIAL band_jesica | `aceffect_band_54` | 【集结指示】在第4、7、10、13回合进入休整期时获得1个<寻呼模块> / <寻呼模块>：装备时销毁，立即在调度中心中刷新三名与该干员盟约相同的干员，免费获得其中一名!（不超过当前调度中心等级） -> `chess_item_4_01_e_a` {'round': 13.0, 'count': 1.0, 'type': 'equip'} |
| BAND_INITIAL band_mlyss | `aceffect_band_55` | 【至纯凝结】在第1回合开始时获得一个进阶<博士投影> / 进阶<博士投影>：任意干员可装备，立即使该干员晋升为精锐干员 -> `chess_item_5_06_e_b` {'round': 1.0, 'count': 1.0, 'type': 'equip'} |
| BAND_INITIAL band_fang | `aceffect_band_57` | 【协力共进】第8、10、12、14回合时，获得1个<信标> / <信标>：装备后销毁携带干员，并在调度中心刷新两名同等阶干员免费获取其中一名；原干员在下回合传递给对应盟约人数最多的队友 -> `chess_item_5_04_e_a` {'round': 8.0, 'count': 1.0, 'type': 'equip'} |
| BAND_INITIAL band_fang | `aceffect_band_57` | 【协力共进】第8、10、12、14回合时，获得1个<信标> / <信标>：装备后销毁携带干员，并在调度中心刷新两名同等阶干员免费获取其中一名；原干员在下回合传递给对应盟约人数最多的队友 -> `chess_item_5_04_e_a` {'round': 10.0, 'count': 1.0, 'type': 'equip'} |
| BAND_INITIAL band_fang | `aceffect_band_57` | 【协力共进】第8、10、12、14回合时，获得1个<信标> / <信标>：装备后销毁携带干员，并在调度中心刷新两名同等阶干员免费获取其中一名；原干员在下回合传递给对应盟约人数最多的队友 -> `chess_item_5_04_e_a` {'round': 12.0, 'count': 1.0, 'type': 'equip'} |
| BAND_INITIAL band_fang | `aceffect_band_57` | 【协力共进】第8、10、12、14回合时，获得1个<信标> / <信标>：装备后销毁携带干员，并在调度中心刷新两名同等阶干员免费获取其中一名；原干员在下回合传递给对应盟约人数最多的队友 -> `chess_item_5_04_e_a` {'round': 14.0, 'count': 1.0, 'type': 'equip'} |
| BAND_INITIAL band_narant | `aceffect_band_60` | 【见者有份】偶数回合进入休整期时，调度中心特殊刷新两件装备，免费获取其中一件；萨尔贡盟约<在场6名不同【萨尔贡】干员>效果替换为【萨尔贡】干员技能开启后，周围八格干员同时享受该干员携带的不高于V阶的装备效果，持续60秒 / 在<萨尔贡>部分干员缺席时体验可能不完整 -> `pool_equip_narant` {'round': 2.0, 'count': 1.0, 'type': 'equip', 'refresh_cnt': 2.0, 'choice_cnt': 1.0} |
| BOND  | `bondeffect_victoria` | 携带装备的【维多利亚】干员伤害提升至{0:0%}（受层数影响） / <每叠加25层>获得一件带有随机特殊效果的维式重锤 / <在场6名不同【维多利亚】干员>【维多利亚】干员每携带1件装备攻击力+50%，携带进阶装备改为+80% -> `pool_equip_vict` {'layer': 25.0, 'count': 1.0} |
| BUFF_GAIN  | `allybuff_select_1` | 你获得2件随机1阶装备，若存在其他队友则他们也获得 -> `pool_equip_shop_1` {'count': 2.0} |
| GARRISON  | `garrison_45_a` | <进入休整期时>获得1件随机装备 -> `pool_equip_normal` {'count': 1.0, 'conditionkey': 'character_target_inboard'} |
| GARRISON 卡涅利安(char_426_billro), 蜜蜡(char_344_beewax) | `garrison_49_a` | <获得时>获得1件“迅捷作战粮” -> `chess_item_3_05_e_a` {'count': 1.0} |
| GARRISON 缪尔赛思(char_249_mlyss) | `garrison_76_a` | <获得时>获得1个“变形同构体” -> `chess_item_6_09_e_a` {'count': 1.0} |
| GARRISON 洛洛(char_4040_rockr) | `garrison_91_a` | <获得时>随机制造1件洛洛的定制品 -> `pool_equip_rockr` {'count': 1.0} |
| GARRISON 耶拉(char_4013_kjera) | `garrison_92_a` | <获得时>获得1件“谢拉格不融冰” -> `chess_item_5_02_e_a` {'count': 1.0} |
| GARRISON 佩佩(char_4058_pepe) | `garrison_94_a` | <进入休整期时>获得1件“盟约之币”或“萨尔贡浓茶”，有小概率发现“黄沙罗盘” -> `pool_equip_pepe` {'count': 1.0, 'conditionkey': 'character_target_inboard'} |
| GARRISON 凯瑟琳(char_4162_cathy) | `garrison_127_a` | <进入休整期时>若当前为奇数回合，获得1件随机装备 -> `pool_equip_normal` {'round_list': '1,3,5,7,9,11,13,15', 'count': 1.0, 'conditionkey': 'character_target_inboard'} |
| GARRISON 诗怀雅(char_308_swire) | `garrison_133_a` | <获得时>获得1个“盟约之币” -> `chess_item_1_03_e_a` {'count': 1.0} |
| GARRISON  | `garrison_134_a` | 本干员三合一为精锐状态时获得1件高阶装备：“骑士戒律” -> `None` {} |
| GARRISON  | `garrison_135_a` | <获得时>获得1件“卡西米尔竞技旗” -> `chess_item_4_07_e_a` {'count': 1.0} |
| GARRISON  | `garrison_45_b` | <进入休整期时>获得2件随机装备 -> `pool_equip_normal` {'count': 2.0, 'conditionkey': 'character_target_inboard'} |
| GARRISON 卡涅利安(char_426_billro), 蜜蜡(char_344_beewax) | `garrison_49_b` | <获得时>获得2件“迅捷作战粮” -> `chess_item_3_05_e_a` {'count': 2.0} |
| GARRISON 缪尔赛思(char_249_mlyss) | `garrison_76_b` | <获得时>获得2个“变形同构体” -> `chess_item_6_09_e_a` {'count': 2.0} |
| GARRISON 洛洛(char_4040_rockr) | `garrison_91_b` | <获得时>随机制造2件洛洛的定制品 -> `pool_equip_rockr` {'count': 2.0} |
| GARRISON 耶拉(char_4013_kjera) | `garrison_92_b` | <获得时>获得2件“谢拉格不融冰” -> `chess_item_5_02_e_a` {'count': 2.0} |
| GARRISON 佩佩(char_4058_pepe) | `garrison_94_b` | <进入休整期时>获得2件“盟约之币”或“萨尔贡浓茶”，有概率发现“黄沙罗盘” -> `pool_equip_pepe` {'count': 2.0, 'conditionkey': 'character_target_inboard'} |
| GARRISON 凯瑟琳(char_4162_cathy) | `garrison_127_b` | <进入休整期时>若当前为奇数回合，获得2件随机装备 -> `pool_equip_normal` {'round_list': '1,3,5,7,9,11,13,15', 'count': 2.0, 'conditionkey': 'character_target_inboard'} |
| GARRISON 诗怀雅(char_308_swire) | `garrison_133_b` | <获得时>获得2个“盟约之币” -> `chess_item_1_03_e_a` {'count': 2.0} |
| GARRISON  | `garrison_134_b` | <获得时>获得1件【骑士戒律】 -> `chess_item_6_10_e_a` {'count': 1.0} |
| GARRISON  | `garrison_135_b` | <获得时>获得2件【卡西米尔竞技旗】 -> `chess_item_4_07_e_a` {'count': 2.0} |

Pools referenced but NOT defined in client data (server-side) - proposed contents [ASSUMED]:

- `pool_equip_normal` (凯瑟琳/garrison_45/127): any non-hidden normal EQUIP with tier <= shop level.
- `pool_equip_shop_1` (列装): tier I normal EQUIP.
- `pool_equip_vict` (维多利亚 bond, every 25 layers): {灼燃, 坚固, 加速, 战栗}维式重锤, uniform.
- `pool_equip_pepe` (佩佩): 盟约之币 45%, 萨尔贡浓茶 45%, 黄沙罗盘 10% (golden 佩佩: 40/40/20).
- `pool_equip_rockr` (洛洛 "定制品"): {有限加速器, 激光发射器, 护盾无人机, 双模机械臂, 蜂鸣器} uniform.
- `pool_equip_kathe` (band_cathy 定向投放, on each shop upgrade 3 choose 1) and `pool_equip_narant` (band_narant, every even round 2 choose 1): tier <= new shop level normal EQUIP.
- garrison_45 / 134 / 135 exist but are not referenced by any operator in `charChessDataDict` (unused this season).

## 9. Status / damage terms used by items

- **晕眩 Stun**: cannot move, block, attack or use skills
- **寒冷 Cold**: ASPD -30; if Cold is applied again while Cold -> Frozen
- **冻结 Frozen**: cannot move, attack or use skills; (AK standard) RES -15 while frozen
- **战栗 Tremble**: while blocked, cannot perform normal attacks (implemented as disarm-when-blocked)
- **麻痹 Paralysis**: each layer cancels one enemy normal attack; max 3 layers
- **失去特殊能力 Silence(enemy)**: enemy loses its special abilities/talents for the duration
- **隐匿 Camouflage**: not targeted by enemy attacks unless blocking
- **护盾 Shield layer**: each layer absorbs one instance of damage completely
- **灼燃损伤 Burn (elemental)**: accumulates on target; (AK standard) at 1000 burst for 7000 arts damage and RES -20 for 10 s; simplify if needed
- **弱点伤害 Weakness damage**: deals physical or arts, whichever the target resists less
- **伤害减免 Flat DR**: each hit reduced by a fixed value
- **嘲讽 tauntLevel**: higher tauntLevel is targeted first by enemies

## 10. Changes vs season 1 (act1autochess) [DATA]

- 13 new items: 天马之枪, 源石溶剂, 家族徽章, 天马之盔, 精打细算玩偶, 骑士储蓄罐, 见钱眼开玩偶, 卡西米尔竞技旗, 随身身份牌, 骑士戒律, 紧急调度券, 简易通讯机, 叙拉古正装. None removed.
- Items now sold from shop level 1 (1 slot) instead of level 5.
- Tier/price changes (act1 tier,price -> act2): 盟约之币 [4, 3]->[1, 1]; 不屈弹射器 [1, 1]->[2, 1]; 萨尔贡浓茶 [3, 2]->[2, 2]; 激光发射器 [2, 2]->[3, 2]; 炎国短刀 [2, 1]->[3, 2]; 迅捷作战粮 [2, 2]->[3, 2]; 歌利亚头盔 [2, 2]->[3, 2]; 阿戈尔重刃 [1, 1]->[3, 2]; 奥术法阵 [1, 2]->[3, 1]; 坚固维式重锤 [2, 2]->[3, 2]; 加速维式重锤 [2, 2]->[3, 2]; 寻呼模块 [5, 4]->[4, 4]; 蜂鸣器 [2, 1]->[4, 1]; 有限加速器 [2, 2]->[4, 2]; 伪装服 [3, 1]->[4, 1]; 防暴盾 [3, 2]->[4, 2]; 休眠子裔 [4, 1]->[4, 2]; 拉特兰桥夹 [3, 2]->[4, 1]; 灼燃维式重锤 [2, 2]->[4, 2]; 护盾无人机 [4, 3]->[4, 2]; 催泪瓦斯 [4, 2]->[5, 2]; 谢拉格不融冰 [4, 2]->[5, 2]; 双模机械臂 [4, 4]->[5, 3]; 信标 [5, 1]->[5, 3]; 商业包装方案 [6, 3]->[5, 3]; 突变细胞 [6, 2]->[5, 2]; 人事部文档 [6, 5]->[6, 4]; 变形同构体 [6, 4]->[6, 3].
- arknights.wiki.gg "Stronghold_Protocol_Alliance/Items" reflects older global data (e.g. 维式重锤 +10%); do NOT use its numbers, use this file.

## 11. Open questions / assumptions to confirm

1. Shop item tier odds and whether item slot shares the operator odds table (server-side). [ASSUMED above]
2. Item sell value (1 fund assumed) - no official statement found.
3. Whether equipped copies count toward the 2-copy merge (assumed yes).
4. Exact contents of server pools (`pool_equip_*`) and of `hunter_band_1` bounty choices.
5. 道具补给 / 机密商店 offer size and tier (3-pick-1 assumed); round schedule taken from a community post.
6. M3茧甲 revive HP (full assumed); 突变细胞 result quality (normal assumed) and whether the other equipped item returns to hand. (The cell's own fate is settled: used up by the battle, back in the item list at the next round start — user playtest.)
7. 天马之枪 "30% true damage": `atk_scale=0.3` suggests 30% of ATK per damage instance; alternative reading 30% of damage dealt. We use 30% ATK.
8. 蒸汽之心 doubling for 战栗锤: prob or duration? (we double prob 10%->20%).

## 12. Sources

- Game data: Kengxxiao/ArknightsGameData zh_CN (activity_table act2autochess, character_table, skill_table, range_table).
- PRTS 卫戍协议/帮助: https://prts.wiki/w/%E5%8D%AB%E6%88%8D%E5%8D%8F%E8%AE%AE/%E5%B8%AE%E5%8A%A9
- PRTS 卫戍协议：盟约 下半 (change log 奥术法阵, 商业包装方案): https://prts.wiki/w/%E5%8D%AB%E6%88%8D%E5%8D%8F%E8%AE%AE%EF%BC%9A%E7%9B%9F%E7%BA%A6_%E4%B8%8B%E5%8D%8A
- Official 更新公告 (new items; equip on 整备区): https://ak.hypergryph.com/news/5114
- arknights.wiki.gg Stronghold Protocol (equip rules, Arts limit): https://arknights.wiki.gg/wiki/Stronghold_Protocol ; items (EN names): https://arknights.wiki.gg/wiki/Stronghold_Protocol_Alliance/Items
- Bahamut 衛戍協議:盟約入門介紹 (道具補給 rounds): https://forum.gamer.com.tw/C.php?bsn=33651&snA=12294
- In-game tips (autoChessData.gameTipsList): "两件同名装备可以合成一件更强力的装备", "特定的装备组合可以为干员赋予额外的盟约效果", "干员晋级后已配发装备会回收至整备区，需要重新配置".

---

## Addendum (critic)

Written 2026-09-27 by the completeness critic. Sources: the official gameplay-intro long image (§装备, §休整期), BWIKI `盟约` §道具, PRTS `卫戍协议/帮助` §装备/手牌区, and screenshots `i.meee.com.tw/Mb2mtd9.png` (机密商店) and `SEbySVl.png` (战术决策).

Corrections to §2 and §11:

| Rule | Was | Now | Tag |
|---|---|---|---|
| Sell item | 1 fund [ASSUMED] | **Items cannot be sold.** Unwanted items can only be **destroyed for 0 funds**: "多余的装备无法进行出售，可以销毁" (official intro) and "多余的道具只能被销毁，无法出售获得资金" (BWIKI). UI: drag to a destroy zone and confirm. | VERIFIED |
| Merge counts equipped copies | yes [ASSUMED] | Confirmed: "两个同名道具（无论是否被装备）会自动合并且晋级…并自动返回整备区". The golden goes to the hand, and the slot it came from is freed. | VERIFIED |
| Unequip | – | Confirmed. An item is locked on its operator and leaves only when the operator is promoted, when the item itself merges, or when the operator is sold. In every case it returns to the hand. Replacing an item destroys the replaced one. | VERIFIED |
| Who can be equipped | board or hand (下半) | Confirmed (BWIKI: "可直接配置在处于整备区的干员身上"). | VERIFIED |
| Hand capacity | 10 shared + 5 temp | Confirmed: "手牌区域分为10个常规手牌区和5个临时手牌区". Items, operators and summon stacks all use it. With a full regular hand you **cannot buy**, items included. Passive gains overflow into temp, and temp blocks readying. | VERIFIED |
| Refresh/freeze covers the item slot | [ASSUMED] | Confirmed: the single 冻结 button freezes **all** unsold slots, the item slot included. A refresh rerolls the item slot too. | VERIFIED |
| Shop item pool / tier odds | tier ≤ shop level, operator odds | The tier cap is confirmed by "※仅在调度中心等级 ≥ 干员所在等阶时，该干员才有可能出现在栏位中" for operators, and mirrored for items. The odds are still [ASSUMED]. **Recommended:** pick the tier with the same copy-weighted tier shares as operators (see 00-INDEX), then draw uniformly within the tier. | ASSUMED |
| 道具补给 / 机密商店 format | 3-pick-1, 机密商店 tier ≥ IV | **Multi: 6 cards shared by the team, each player takes 1.** Solo: 3 cards. **机密商店 draws from all tiers I–VI with duplicates.** A screenshot shows 变形同构体 (VI), 骑士储蓄罐 (III), 双模机械臂 (V) ×2 and 盟约之币 (I) ×2. **道具补给** at R3 (上半 data) showed tiers II–IV, including 有限加速器 ×2. [ASSUMED] tier windows for 道具补给: R3 I–IV, R6 II–V, R9 III–VI, R11 IV–VI. All cards are `_a` (normal) items. | VERIFIED format; tiers partly ASSUMED |
| 列装 (`allybuff_select_1`) | 2 random tier-I items | Confirmed: "你获得2件随机1阶装备，若存在其他队友则他们也获得". | VERIFIED |
| Arts (MAGIC) | max 2 on the map | Unchanged. Only bands grant them (画卷, 教鞭). | – |

Other notes:
- **人事部文档** (`chess_item_6_08_e`) sets the deploy cap to **9**: "最大可部署人数变为9". The UI counter "剩余可放置角色" must read the cap per player, not the constant 8.
- The item card in the shop shows the tier chip and a price badge. There is always exactly 1 item slot at every level in all real modes (`itemCount` = 1).
