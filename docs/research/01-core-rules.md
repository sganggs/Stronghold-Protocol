# 01 · Core Rules: loop, economy, shop, rounds, modes, strategies (bands)

Scope: 卫戍协议：盟约. The season data is `act2autochess` (盟约 下半, CN start 2026‑03‑14). The data key `act1autochess` is 盟约 上半, kept here for reference only.

Machine-readable companion: `01-core-data.json`. It holds every table below plus the raw data. That includes the per-mode round schedule, shop tables, all 40 bands with buff blackboards, choice effects, tips, broadcasts, bosses and reward factors.

Confidence tags used throughout:
- **[DATA]**: read directly from the client game data (`activity_table.json` and the level JSON files).
- **[WIKI]**: taken from official help text as quoted by PRTS or BWIKI, or from the official patch notes.
- **[COMM]**: community-measured (NGA, Bahamut, bilibili, note.com).
- **[INFER]**: derived from the data by arithmetic.
- **[ASSUMED]**: not documented anywhere I could find. These are proposed values that we can tune.

---

## 0. TL;DR constants for the server

| Constant | Value | Tag |
|---|---|---|
| Funds per round | R1=4, R2=5, R3=6, then +1/round, capped at **10** | R1–R3 [INFER from band_lmlee: R1+R2+R3 = 15]; growth and cap [ASSUMED] |
| Standard (FUNNY) mode | +2 funds/round on top of the above | [ASSUMED] ("初始资源更加丰富") |
| Leftover funds | Lost when the prep phase ends. Only band 坎诺特 keeps them. | [WIKI] |
| Refresh | 1 fund (`shopRefreshPrice`=1) | [DATA][WIKI] |
| Sell any operator (normal or elite) | +1 fund (`chessSoldPrice`=1) | [DATA][WIKI] |
| Buy operator, by tier I..VI | 2 / 3 / 3 / 3 / 4 / 4 | [DATA] |
| Shop upgrade price (NORMAL/HARD/ABYSS, both solo and multi), level 1→2…5→6 | 5, 8, 11, 12, 13 | [DATA] |
| Upgrade price change | −1 per round (floor 0). Resets to the next level's base after an upgrade. | [WIKI] |
| Shop slots (operators + items) | 3+1 / 4+1 / 4+1 / 5+1 / 5+1 / 5+1 (NORMAL+). `storeCntMax`=6 | [DATA] |
| Board cap / bench cap | 8 (`maxBattleChessCnt`) / 10 (`maxDeckChessCnt`) | [DATA] |
| Max LP lost per normal round | 10 (`costPlayerHpLimit`) | [DATA][WIKI] |
| Starting LP | the band's `totalHp` (20–45) | [DATA] |
| Merge | 3 identical → elite (精锐). 风丸 needs only 2. Elites never merge further. | [DATA] |
| Promotion reward | Free pick of 1 from 3 random operators of tier min(shopLevel+1, 6) | [COMM] |
| Shared pool copies per operator, tier I..VI | 12 / 14 / 18 / 16 / 8 / 5. An elite occupies 3 copies. | [COMM] |
| Rounds: multi FUNNY / other multi / solo FUNNY / other solo | 14 / 14 (+15 hidden) / 9 / 14 (+15 hidden) | [DATA] |
| Players (同盟模拟) | up to 4, co-op PvE | [WIKI] |

---

## 1. Modes (`modeDataDict`) [DATA]

`modeType`: LOCAL = tutorial, SINGLE = 独立模拟 (solo), MULTI = 同盟模拟 (co-op, up to 4 players; also called 联合模拟 in tips).

| modeId | Name / code | Type | Difficulty | specialPhaseTime (s) | Active bonds | Unlock (`preposedMode`) | effectDescList |
|---|---|---|---|---|---|---|---|
| mode_training_1 | 入门协议 AC‑TR‑1 | LOCAL | TRAINING | 150 | all 23 | – | ·仅可使用预置的调配干员 ·无奖励 ·无法用于解锁策略 |
| mode_single_funny | 标准模拟 AC‑1 | SINGLE | FUNNY | 150 | 13 (10 inactive) | training | ·可以快速完成作战 ·常规奖励 |
| mode_single_normal | 险境模拟 AC‑2 | SINGLE | NORMAL | 150 | 23 | funny (solo or multi) | ·可使用盟约数增加 ·大幅增加奖励 |
| mode_single_hard | 绝境模拟 AC‑3 | SINGLE | HARD | 150 | 23 | normal | ·作战环境困难 ·出现更加危险的敌人 |
| mode_single_abyss | 终极模拟 AC‑4 | SINGLE | ABYSS | 150 | 23 | hard ×2 ("通关2次【绝境模拟】") | ·作战环境无比困难 ·出现极度危险的敌人 (startTime 2026‑03‑27) |
| mode_multi_funny | 标准模拟 | MULTI | FUNNY | 16 | 13 | training | ·作战环境较为温和 ·常规奖励 |
| mode_multi_normal | 险境模拟 | MULTI | NORMAL | 16 | 23 | funny | as solo |
| mode_multi_hard | 绝境模拟 | MULTI | HARD | 16 | 23 | normal | as solo |
| mode_multi_abyss | 终极模拟 | MULTI | ABYSS | 16 | 23 | hard ×2 | as solo |

- **FUNNY inactive bonds:** lateranoShip, egirShip, kazimierzShip, skillfulShip, arcaneShip, miraShip, investShip, raidShip, soloShip, suntShip.
- **FUNNY and NORMAL also disable 18 dangerous enemies** (`inactiveEnemyKey`, e.g. `enemy_1112_emppnt`, `enemy_1207_sfji`, `enemy_1072_dlancer`…). HARD and ABYSS have none disabled.
- **Mode description (PRTS 下半):** 标准模拟 = "轻松的协议模式，作战环境较为温和，**初始资源更加丰富**，升级条件更加宽松。无法使用全部盟约。可获得卫戍认证并解锁策略。"

Enemy HP and ATK multipliers by mode [WIKI, PRTS 下半]:

| | FUNNY | NORMAL | HARD | ABYSS |
|---|---|---|---|---|
| 独立 (solo) | ×0.7 | ×0.7 | ×0.8 | ×1.0 |
| 同盟 (multi) | ×0.8 | ×0.8 | ×1.0 | ×1.0 |

Solo is shorter and uses lower enemy numbers. Solo has no time limit on prep or choice phases in 下半. You may leave and return within 24 h (`singleReconnectTime`=86400). Trophies (奖杯) are **only** awarded in multi [WIKI + tip].

Reward currency: 卫戍认证 (`act2autochess_token_chess`).

- **Formula:** `baseRewardDataList[roundsCleared].count × difficultyFactor × modeFactor` [INFER; verified against the 250/400/425 per full clear reported on note.com].
- **baseRewardDataList (round → count):** 10, 20, … 100 (R10), 120, 140, 160, 200 (R14).
- **difficultyFactor:** FUNNY 1.0, NORMAL 1.6, HARD 1.7, ABYSS 1.7.
- **modeFactor:** 1.25 for both SINGLE and MULTI.
- **Daily bonus:** earn 200 → +300 ("每日防卫目标", resets 04:00).

### Training (入门协议)
- **Format:** 4 rounds on stage `act1autochess_m01`.
- **Players:** band 歌利亚 (`band_sarkazb`, 45 LP) plus 3 NPC teammates (`trainingNpcList`: 华法琳/阿米娅/杜遥夜 bands). Preset operators only.
- **Boss:** `boss_7` (“萨米的意志”) in R4. R3 has a choice event (`equip_free_1_tr`).
- **Enemy types:** FLY, TIMES, ELEMENT.
- **Bonds:** `trBondIds` = 14 bonds, of which 5 are banned (`trBannedBondIds`: kjerag, stead, indom, swift, visi).
- **Shop:** L1–L6 upgrade 4/4/6/9/12/99. 3 operator slots at every level; the item slot appears only at L5+.
- **Prep time:** 999 s.

---

## 2. Match lobby → start (`enterStepList`) [DATA]

| Step | Time (s) | Hint at (s) | Title |
|---|---|---|---|
| INFO_CHECK | 25 | 5 | 确认本局信息 |
| BAND_CHECK | 50 | 15 | 选择策略 |
| BATTLE_CHECK | 3 | 0 | 协议启动 |

**INFO_CHECK** shows the match configuration. The screen shows:
- the stage map (`stageDatasDict`, weight 50 each): FUNNY = act1 m01 only; NORMAL = act1 m01–m04 + act2 m01–m04; HARD/ABYSS = act1 m02–m04 + act2 m01–m04. act1 m05–m07 have weight 0 (unused);
- the R14 boss (weighted: boss_1 胄 6, boss_2 铳 6, boss_3 管 6, boss_4 昆图斯 5, boss_5 卢西恩 10, boss_6 阿利斯泰尔 5, boss_7 萨米的意志 5);
- the special-enemy types (3 of FLY/TIMES/ELEMENT/DOT/INVISIBLE/REFLECTION, `specialEnemyNum`=3);
- the **banned bonds ("B位")**. Bonds with `weight`=10 are bannable. 投资人, 调和, 协防, 绝技 have weight 0 and are never banned.
  - Number banned per match: [ASSUMED] 1 core + 1 add-on. The exact count was not found.
  - Tip: "归属于特定盟约的干员只有部分会出现在调度中心内". Proposal: an operator is removed from the pool only if *all* its bonds are inactive or banned [ASSUMED].

**BAND_CHECK:** each player picks one strategy ("策略/分队" = band) from the unlocked bands.
- Tip: "联合模拟在选择策略时可以进行一次跳过". [ASSUMED] Each player is offered 3 random unlocked bands and may reroll once.
- Bands are not exclusive between teammates [ASSUMED].
- Clearing 3 times with a band (`victorCount`=3) grants a corner badge (角标).

**Before the match (out-of-match loadout):**
- Players fill 2 DIY slots at tier V and 2 at tier VI (`chess_char_5_diy1/2`, `chess_char_6_diy1/2`) with their own operators. Community: "自己五阶放一个白铁".
- They can borrow up to **20 support operators** (`borrowCount`=20; "助战8变20人"). These cover NORMAL-type chess they don't own. Otherwise the chess falls back to `backupCharId`.

---

## 3. Round schedule [DATA]

Columns: `turnInfoDataDict` (prep time, boss flags), `battleDataDict` (level, SP flag) and each level's `options.maxPlayTime` (combat time limit).

Definitions:
- `normalPhaseTime` = **prep (休整期) time limit in seconds**. Solo = 300. PRTS 上半: "各轮次均有300秒的决策时间"; in 下半 solo prep became unlimited.
- `isSpPrepare` = this round's prep is preceded by a **机变阶段** (choice event). Community counts it as "decision after round N−1".
- `specialPhaseTime` = the choice-phase timer: multi 16 s per picker (first picker 30 s, ~70 s total); solo 150 s, unlimited in 下半.
- Combat (`maxPlayTime`) is the round level's time limit. Enemies still alive at the limit count as leaked [ASSUMED; community "超时" complaints agree].
- All round levels have DP `initialCost`=10, +1 DP/s, max 99, 8 deploy slots.

### Multi (同盟) — NORMAL / HARD / ABYSS (FUNNY = same but ends at R14 and SP rounds differ)

| R | Prep s | Combat s | Level | SP before prep (FUNNY / NORMAL / HARD+ABYSS) | Notes |
|---|---|---|---|---|---|
| 1 | 65 | 45 | act1_01 | – | first 3 rounds: enemies only use the lower red gate [COMM] |
| 2 | 65 | 45 | act1_02 | – | |
| 3 | 65 | 55 | act1_03 | ✔ / ✔ / ✔ | decision after R2 |
| 4 | 95 | 55 | act1_04 | | upper route enemies from R4 [COMM] |
| 5 | 95 | 55 | act1_05 | | |
| 6 | 100 | 70 | act1_06 | – / ✔ / – | decision after R5 (NORMAL) |
| 7 | 105 | 85 | act1_07 | | |
| 8 | 105 | 85 | act1_h01 | | |
| 9 | 125 | 95 | act1_h02 | ✔ / ✔ / ✔ | decision after R8 |
| 10 | 125 | 95 | act1_h03 | | |
| 11 | 125 | 115 | act1_h04 | – / – / ✔ | decision after R10 (HARD+) |
| 12 | 125 | 115 | act1_h05 | | |
| 13 | 150 | 115 | act1_h06 | | |
| 14 | 195 | boss (120 s level; −1 LP/s after `bossTurnHpReduceTime`=150 s) | h07_0X (boss_1..7) | | **最终攻势** (Final Assault). Last round for FUNNY. |
| 15 | 195 (NORMAL) / 215 (HARD, ABYSS) | boss | h08_0X (boss_8..10) | | **隐秘核心** (Hidden Core); only if its conditions are met (§10) |

### Solo (独立)

| Mode | Rounds | SP rounds (`isSpPrepare`) | Prep | Notes |
|---|---|---|---|---|
| single_funny | **9** | none | 300 | R9 = boss (uses `_S` boss levels). No decisions. |
| single_normal | 14 (+15) | 6, 9 (decisions after R5 = 道具补给, R8 = 战术决策) | 300 | |
| single_hard | 14 (+15) | 3, 9, 11 | 300 | |
| single_abyss | 14 (+15) | 3, 9, 11 | 300 | |

Solo boss levels are the `…_S` variants (`level_act1autochess_h07_0X_S`).

Bosses (`bossInfoDict`, HP pool by difficulty FUNNY / NORMAL / HARD / ABYSS) [DATA]:

| bossId | Enemy | Pick weight | HP F / N / H / A | Hidden |
|---|---|---|---|---|
| boss_1 | 假想敌：胄 | 6 | 247 500 / 675 000 / 1 800 000 / 3 600 000 | |
| boss_2 | 假想敌：铳 | 6 | 225 000 / 400 000 / 800 000 / 3 000 000 | |
| boss_3 | 假想敌：管 | 6 | 285 000 / 708 750 / 2 000 000 / 4 000 000 | |
| boss_4 | 盐风主教昆图斯 | 5 | 307 500 / 708 750 / 2 100 000 / 4 200 000 | |
| boss_5 | 卢西恩，“猩红血钻” (new in act2) | 10 | 200 000 / 390 000 / 780 000 / 3 000 000 | |
| boss_6 | 阿利斯泰尔，帝国余晖 | 5 | 285 000 / 705 000 / 1 990 000 / 3 980 000 | |
| boss_7 | “萨米的意志” | 5 | 277 500 / 787 500 / 2 000 000 / 4 000 000 | |
| boss_8 | 假想敌：胄 (hidden) | 50 | 750 000 / 937 500 / 3 600 000 / 7 200 000 | ✔ |
| boss_9 | 假想敌：铳 (hidden) | 40 | 675 000 / 900 000 / 2 800 000 / 3 950 000 | ✔ |
| boss_10 | 假想敌：管 (hidden) | 40 | 825 000 / 1 012 500 / 3 800 000 / 7 600 000 | ✔ |

Boss HP scaling:
- The boss HP is one shared pool for the whole team.
- It shrinks when teammates are eliminated or leave [COMM: "联机队友变少，最后boss血条也会变少"].
- Proposal: `hp = bloodPoint × alivePlayers / 4` [ASSUMED]. Solo uses `bloodPoint × 0.25` [ASSUMED].

---

## 4. Phase flow of one round

```
[round start] ──► (机变阶段 if isSpPrepare) ──► 休整期 (prep) ──► 各自行动阶段 (own combat) ──► 联防 (unite, multi only, if needed) ──► 结算 (settlement) ──► next round
```

### 4.1 Round start ("进入休整期时") — proposed server order [WIKI + ASSUMED order]
1. `round += 1`. If round > 1: `upgradePrice = max(0, upgradePrice − 1)` [WIKI: "升级调度中心所需的资金每回合-1直至0，升级后重置"].
2. `funds = income(round)` + pending coins earned since the last prep (bounties, 暴行-type "下回合加钱", band 玛恩纳, etc.).
   - Funds do **not** carry over [WIKI: "没有用完的资金无法留到下一回合"].
   - Exception, band 坎诺特 (`coin_carry_over {capital:5, interest:1, max:1}`): keep leftovers, +1 if leftover ≥ 5.
3. Destroy everything in the 临时整备区 (temporary overflow bench) [tip: "处于临时整备区的调度资源，在进入下一回合后会自动销毁"].
   *Superseded in the remake (user playtest #3, DESIGN §6.2):* wiping at the round start destroyed what SETTLE had just put
   there (battle-result grants, a SETTLE merge's elite, returned equipment) before the player ever saw it — reported as a
   bug by a player of the official mode. The remake resolves a temp piece at the deadline of the first prep in which its
   player could act on it (the "next round" of the tip = the combat that follows that prep; Ready stays blocked meanwhile).
4. If `isSpPrepare`: run the 机变阶段 choice (§12) before the shop opens.
5. Free automatic shop refresh of all **non-frozen** slots [ASSUMED, auto-chess convention]. Promotion-reward slots from last round are gone.
6. Fire "<进入休整期时>" effects: bands (e.g. 小贾斯汀 R1/4/7/10, 杰西卡 R4/7/10/13, 松桐 on even rounds…), operator traits (garrison), equipment.
7. Start the prep timer (`normalPhaseTime`; solo unlimited in 下半).

### 4.2 Prep (休整期): what a player can do [WIKI/tips/COMM]
- **Buy** an operator (tier price) or an item from the shop. Bought units go to the bench (待部署区/整备区, max 10). If the bench is full, they go to the temp area and are destroyed at the next round.
- **Sell** any operator or item for **1 fund** by dragging it to the shop area. Tip: "拖拽干员至整备区可以直接撤退干员" = drag a board unit to the bench to un-deploy it.
- **Refresh** the shop: 1 fund. Several effects make refreshes free: 奇迹 bond proc, the "补给" choice.
- **Freeze** shop slots. Tip: "调度中心即使冻结，依然可以主动刷新". [ASSUMED] Freezing is per slot and free. Frozen slots survive refreshes and the next round start; toggle to unfreeze.
- **Upgrade** the 调度中心 (shop level 1→6) at the current price. Broadcast: "{0}博士将调度中心等级提升为{1}级".
- **Arrange** the board: max 8 deployed operators. Grid position matters for traits (前方/周围4格/8格, 同一行, 最右边…).
- **Equip** items to operators on the board or the bench (下半 allows the bench). Use 法术 (MAGIC) items on map tiles.
- **Look** at teammates' boards and at the enemies for this round (right-top magnifier: route / enemy preview).
- **Emotes** (multi). **Ready** (准备): cancellable until all players are ready. Once everyone is ready, combat starts ("全体参与者就绪之前可随时取消准备").
- At prep end: fire "<休整期结束时>" effects (e.g. 助力 +2 layers to all active bonds), then funds are cleared.

### 4.3 Combat (各自行动阶段)
Each player fights their own copy of the round level independently. There is no PvP.
- **Deployment:** automatic, paying DP (start 10, +1/s). **Redeploy also costs DP** [COMM].
- **Deploy order:**
  - 上半: left→right, bottom→top (PRTS "从左到右>从下到上": along each row, the rows from the bottom).
  - 下半: PRTS 卫戍协议/帮助 "按从上到下>从左到右的顺序部署" (from 2026-03-14): a scan down each column (top first), the columns from left to right — the order PRTS gives the 阿戈尔 devour ("从最先部署（更靠左和靠上的）的【阿戈尔】干员开始") and act-2 videos show (BV1rVwjziEQt, BV1pGAPzrEpZ). The remake read it as top row first until 0.1.3. The last-placed unit has the highest taunt.
- **Skills:** fire automatically. Units with summons deploy the summon on first deployment regardless of SP [COMM].
- **Perfect clear (完美作战):** every enemy killed before the time limit, none reached the objective.
- **Bond stacking:**
  - "<战斗中>" triggers work only here, never in 联防 or boss rounds [COMM].
  - Layers persist all match. Tip: "叠加的盟约会在单次模拟中始终保留，但只有在盟约被激活时才会发挥作用".
  - Only active bonds gain layers in most cases.

### 4.4 联防 (Unite / joint defense), multi only [WIKI]
- **Trigger:** some but not all players failed to clear perfectly.
- **Setup:** 1–2 players who *did* clear perfectly field their board as-is. They face the **union of all enemies the other players leaked**, using the escaped-battle template `level_act1autochess_escaped_multi` (char limit 20).
- **Rules:**
  - Bond stacking is disabled ("该阶段不能叠加层数").
  - The helpers fight "以其阵地当前的状态" (PRTS 帮助): the remake reads that as including the layers their own combat reached that round (the count the strip shows) [ASSUMED]; the settlement adds those gains once.
  - Bounty kills here pay the killer.
  - Only perfect-clear teammates can defend (tip).
  - Community: in 下半 the result shown is the *defended* player's view.
- **LP loss:** enemies that also survive 联防 cost their original owner LP (cap 10 per round).
- **No perfect player:** leaks cost LP directly.
- **Partner choice:** [ASSUMED] the defenders are the 2 perfect players with the fewest leaks this round, tie broken by seat index. The official selection rule is unknown.

### 4.5 Settlement
- Each player loses `min(10, number of their enemies not killed)` LP [WIKI: "每回合最多-10血 (就算大漏50个也-10)"]. `enemy.lifePointReduce` is 1 for almost all regular enemies. Use 1 per enemy (see 05-enemies-levels.md).
- **Bounty coins:**
  - Kill-type bounty: whoever kills the enemy (owner or 联防 helper) gets the coins.
  - "战术特训" type: coins if the chooser cleared perfectly in their own phase.
- Coins are credited to the next prep.
- **Elimination:** LP ≤ 0 → the player is out.
  - Multi: their operators return to the shared pool immediately [COMM]. Boss HP drops.
  - Community calls ≤10 LP "斩杀线" (one bad round kills you).
- Score/rewards use rounds cleared (`roundScoreDataList`, `baseRewardDataList`).

---

## 5. Economy

### 5.1 Income per round
- **Official text:** "每回合开始时，将会进入休整期并且提供一定量的资金…没有用完的资金无法留到下一回合。" The amounts are not published.
- **Evidence:**
  - Band 老鲤 `give_coin_in_round`: R1 = 0, R2 = 0, **R3 = 15**. It reads "第1、2回合的资金暂存至第3回合发放", so **R1+R2+R3 = 15**.
  - Linear +1/round then gives **4, 5, 6**. Start 3 gives 12 and start 5 gives 18, so only 4 fits.
  - NGA: "2回合升本…亏一块". The R2 upgrade costs 4, and 5 − 4 = 1 is left over, which only fits R2 = 5.
  - NGA: "3回合都做不到连买三张". With 6 funds at shop L2, three purchases are impossible.
- **Proposal:** `income(r) = min(3 + r, 10)` → 4,5,6,7,8,9,10,10,10…
  - Cap 10 [ASSUMED]. The 2024 season capped at 10–12, and cap 12 is a fine alternative.
  - FUNNY: +2 per round [ASSUMED].
- **Other income sources [DATA]:**
  - Bounties (1–6 coins).
  - Choice "财富" (+1 to every teammate).
  - Bonds: 远见 "<每叠加10层>获得一次2资金"; 奇迹 "<每叠加100层>获得20资金" and chance of a free next refresh.
  - Items: 骑士储蓄罐 (1–6), 炎 VI items (+2 per acquisition, max 3/round).
  - Operator traits: 红豆 0-cost, 暴行 "下回合加钱"…
  - Bands: 玛恩纳 (+1 per Kazimierz bought, max 3), 坎诺特 interest, 鸭爵 (+1 per duck-type enemy killed).

### 5.2 Spending [DATA unless noted]

| Action | Cost |
|---|---|
| Buy operator (`shopCharChessInfoData`) | tier I **2**, II **3**, III **3**, IV **3**, V **4**, VI **4**. The same price is charged if the shop offers an elite copy (e.g. "升华" choice). |
| Buy item (`trapChessDataDict.purchasePrice`) | 1–5 by item (tier I items 1, most tier II–IV 2, tier VI 3–4, advanced/金 items 5). See 04-items.md. |
| Refresh | 1 (`shopRefreshPrice`) |
| Sell (operator of any tier, normal *or* elite) | refund **1** (`chessSoldPrice`=1 for all rows). Community special case: selling 煌 gives 1 fund + transforms. |
| Upgrade shop level N→N+1 | `initialUpgradePrice[N]` − rounds elapsed since reaching N (floor 0) |

Shop upgrade base prices (`shopLevelDataDict`, price shown at level N = cost to go N→N+1) [DATA]:

| Mode | L1→2 | L2→3 | L3→4 | L4→5 | L5→6 | Operator slots at L1..L6 | Item slots |
|---|---|---|---|---|---|---|---|
| NORMAL / HARD / ABYSS (solo & multi) | 5 | 8 | 11 | 12 | 13 | 3,4,4,5,5,5 | 1 at every level |
| multi_funny | 5 | 8 | 10 | 11 | 11 | 3,4,4,4,4,5 | 1 |
| single_funny | 1 | 1 | 5 | 8 | 10 | 3,4,4,4,4,5 | 1 |
| training | 4 | 4 | 6 | 9 | 12 | 3 ×6 | 0 (L1–4), 1 (L5–6) |

Level 6 has price 99 (no further upgrade). Level tag colours: #434343, #626654, #445760, #615B74, #6C5E41, #5d341e.

The 20-fund 绮良 / 55-fund 帕格尼尼 band thresholds count **funds spent** (buy, refresh and upgrade) [ASSUMED: all spending].

---

## 6. Shop (调度中心)

- **Slots:** `charChessCount` operator slots + `itemCount` item slots, total ≤ `storeCntMax` = 6.
- **Tier availability:** shop level L offers operators of tier ≤ L [WIKI/COMM: "商店等级决定会卖的干员最高阶级"]. Items also ≤ L [ASSUMED].
- **Chess counts per tier (`charShopChessDatas`, 133 chess):**

  | Tier | Visible (PRESET / NORMAL / DIY slots) | Hidden (not in shop; only granted by effects) |
  |---|---|---|
  | I | 16 PRESET | 4 (incl. Pith's special 盟约·辅助干员) |
  | II | 17 PRESET | 2 |
  | III | 13 PRESET + 6 NORMAL | 2 |
  | IV | 9 PRESET + 13 NORMAL | 4 |
  | V | 2 PRESET + 17 NORMAL + 2 DIY | 3 PRESET + 1 NORMAL (百炼嘉维尔) |
  | VI | 2 PRESET + 17 NORMAL + 2 DIY | 1 (妮芙) |

  Chess types:
  - PRESET = fixed system operator.
  - NORMAL = uses the player's own operator (or a borrowed support). If neither is available it uses `backupCharId` (预备干员).
  - DIY = a player-chosen own operator in a tier V/VI slot.
- **Shared pool (multi) [COMM, bilibili BV1JWy3BkEpt + note.com]:**
  - Each operator has a fixed number of copies shared by all 4 players: **I 12, II 14, III 18, IV 16, V 8, VI 5** (缪尔赛思 4).
  - An elite occupies 3 copies. Copies in a shop display do **not** occupy the pool.
  - All owned copies (board + bench, however obtained) do.
  - If owned copies ≥ cap, that operator can no longer roll.
  - Eliminated or quitting players' copies return immediately.
  - DIY slots: [ASSUMED] private per player, with the same copy caps as their tier.
- **Roll odds [ASSUMED; the official odds are unpublished]:**
  - Each empty operator slot draws one copy uniformly at random from **all remaining pool copies** of non-hidden chess with tier ≤ shop level (Hearthstone-Battlegrounds model).
  - This matches community observations: "一本卡池最小所以好凑三连", "三本大大稀释浓度", "卡池变大了三连概率低".
  - Resulting share of tiers at L6 ≈ I 14%, II 17%, III 25%, IV 26%, V 11%, VI 7%.
  - Optional: never show the same operator twice in one roll, except via 梓兰's special refresh.
- **Special refreshes:** band effects replace the normal roll.
  - 杜遥夜: first 2 active refreshes each round guarantee 1 Yan.
  - 梓兰: every refresh contains 2 copies of one operator and freezes one.
  - 佩佩: after upgrading to L2/4/6, one Sargon-priority refresh.
  - 寻呼模块 / 信标: special 3- or 2-choice refresh.
- **Promotion reward slot:** see §7. Tip: "晋级的特殊奖励无法被刷新、冻结，也不会保留至下一回合".

---

## 7. Merging (精锐 / elite promotion) [DATA + WIKI]

- **Merge rule:** 3 copies with the same `chessId` merge automatically into `upgradeChessId`, the `_b` elite. Copies on the board or bench all count.
  - WIKI: "三位同名干员（无论是否部署）会自动合并且晋级为精锐干员".
  - `upgradeNum`=3 for 132 chess; **风丸 `chess_char_2_11_a` needs 2**.
  - Elites have `upgradeNum`=0: **no further merging**.
- **Where the elite goes:** to the hand, **unless a consumed copy was deployed — then to that copy's board position**.
  PRTS 卫戍协议/帮助 §干员的获得与精锐化: "发送1名【精锐】状态的该干员至手牌区（若消耗已部署至作战区的干员，则发送至作战区对应位置）";
  confirmed first-hand by the user after playtest #6 ("合成精锐时，如果消耗了场上的干员，精锐会出现在场上那个位置"). See A1 row 7
  for the remake's choices where the text is silent.
- **Equipment:** anything the merged units carried returns to the bench. Tip: "干员晋级后已配发装备会回收至整备区".
- **Bond traits** of "<获得时>" type: a triple stacks 1+1+2 (the elite value is double) [COMM].
- **Stats (`shopCharChessInfoData`):**

  | Tier | Normal copy | Elite copy |
  |---|---|---|
  | I | E1 Lv55, skill 4 | E2 Lv50, skill 7, module lv1 |
  | II | E1 Lv60 | E2 Lv55 |
  | III–V | E2 Lv1, skill 4 | E2 Lv60, skill 7, module lv1 |
  | VI | E2 Lv1, skill 4 | E2 Lv60, skill 7, module lv3 |

  Trust 0. Owned-operator training adds `cultivateEffectList`: E1 +5% ATK/DEF; E2 +10% ATK, +5% DEF/HP; E2 Lv60 +10% all.
- **Promotion reward [COMM]:** after a merge the player gets a special shop offer. They pick **1 of 3 random operators of tier min(shopLevel+1, 6)**, free.
  - Sources: "碰出來可以選一個階級+1的幹員"; "资金0でランダムに選ばれた3体の中から1体"; NGA "卡一本…三连给的二本".
  - Reward pools are named `pool_chess_shop_{N}_reward` in the data (老鲤 draws from `pool_chess_shop_2_reward` / `_4_reward`).
  - It cannot be refreshed or frozen and expires at round end.
- **Broadcast:** "{0}博士的{1}干员晋升为精锐".

---

## 8. Board, bench and bonds (limits only; details in 02-bonds.md)
- **Board:** 8 deployed operators (`maxBattleChessCnt`, level `characterLimit`=8).
- **Bench:** 10 (`maxDeckChessCnt`), plus a temporary overflow area that is wiped each round.
- **Board and bench swaps:** in 下半 operators on the bench and the board can be swapped even with a full bench.
- **Bond activation:** most bonds count only board operators (`activeCondition` BOARD).
  - 远见 / 奇迹 / 投资人 are BOARD_AND_DECK: bench units count too. Tip: "一些特殊的盟约不需要部署干员也能激活生效".
  - `fallbackBondId`=emptyShip (协防干员): the bond for operators with no faction bond.

---

## 9. Life points (目标生命值)
- **Start:** the band's `totalHp`: 20 (铃兰) … 45 (歌利亚). See §11.
- **Normal rounds:** lose 1 per enemy not killed (leaked or alive at timeout, after 联防), **max 10 per round** (`costPlayerHpLimit`=10) [DATA+WIKI].
- **Loss:** LP ≤ 0 → eliminated.
  - Multi: the team wins if anyone survives to kill the R14 boss [ASSUMED: the team result is shared, and the clear counts for everyone still in].
  - Quitting counts as elimination.
- **Final assault (R14/R15):**
  - All remaining LP of all players merge into one pool; there is no 10 cap.
  - After the boss round has run `bossTurnHpReduceTime` = 150 s, the team loses 1 LP per second.
  - If regular wave enemies reach the goal and bring LP to 0, the team fails immediately [WIKI].

## 10. Final Assault and Hidden Core [WIKI, PRTS 下半]
- **最终攻势 (R14):**
  - Players are paired. Each pair shares one boss battlefield: one plays the left half and one the right half ("两名参与者会处于同一个战场，但无法查看另一组队友的战场情况").
  - For the right-side player the board is mirrored ("你的最左边是你的最右边").
  - Everyone damages one shared boss HP bar ("所有人将一起对敌方领袖造成伤害"). Some bosses appear on both sides and share HP.
  - Broadcasts at 20/50/80% damage share per player: "{0}博士对敌方领袖造成的伤害超过20%!".
- **隐秘核心 (R15, NORMAL+ only):**
  - Entry condition after passing R14:
    - solo: activated bond layers total **> 350** and LP > 1;
    - multi: sum over all players **> 1200** and LP sum > 1.
    - (盟约 上半 values were 300 / 1000.)
  - The boss is weighted among 胄/铳/管 hidden versions (50/40/40).
  - Failing it does not affect the clear or the reward. Success shows a special banner and awards more trophies.

---

## 11. Strategies / bands (`bandDataListDict`, 40 entries) [DATA]

A band is the player's commander/"分队" chosen at BAND_CHECK. It sets **starting LP** (`totalHp`) and grants one permanent rule-changing effect (`effectType` BAND_INITIAL). Common fields: `victorCount`=3 (3 clears → badge) and `bandRewardModulus`=1.0.

`band_zumama` (森蚺, 上半 only) is defined in `autoChessData.bandDataDict` but absent from act2.

Modes column: L=LOCAL(training), S=SINGLE, M=MULTI. Raw rich-text is kept in the JSON as `descRaw`.

| # | bandId | Name | LP | Modes | Effect (plain text) | Key buff params | Unlock |
|---|---|---|---|---|---|---|---|
| 1 | `band_bldsk` | 华法琳 | 28 | L,S,M | 【重点监护】开始作战时，使场上每个不同等阶的1个随机我方干员的所属盟约层数+2 | `prep_finish_char_bond_add_layer` {"layer": 2.0} | - |
| 2 | `band_amiya` | 阿米娅 | 25 | L,S,M | 【众志合一】场上存在3、4或5种以上激活盟约时，所有干员攻击力、生命值分别+20/30/40% | `env_gbuff_new_with_verify` {"key": "act1autochess_band2_buff", "atk_1": 0.2, "atk_2": 0.3, "atk_3": 0.4, "max_hp_1": 0.2, "max_hp_2": 0.3, "max_hp_3": 0.4, "value_1": 3.0, "value_2": 4.0, "value_3": 5.0} | - |
| 3 | `band_duyaoy` | 杜遥夜 | 29 | L,S,M | 【广交豪杰】每回合前2次主动刷新为特殊刷新：优先刷新出1名<炎>干员 / 在<炎>部分干员缺席时体验可能不完整 | `band_first_self_refresh_present_char` {"bond": "yanShip", "count": 1.0} | - |
| 4 | `band_sarkazb` | 歌利亚 | 45 | L,S,M | 【坚不可摧】初始目标生命值为45点 |  | - |
| 5 | `band_orchid` | 梓兰 | 30 | S,M | 【猎头顾问】每次主动刷新均变为特殊刷新：必定刷新2名同名干员，并冻结其中一名；第10回合获得1个<寻呼模块> / <寻呼模块>：装备时销毁，立即在调度中心中刷新三名与该干员盟约相同的干员，免费获得其中一名!（不超过当前调度中心等级） | `band_shop_refresh_copy_max_lv_char` {"count": 1.0}; `preparation_start_gain_chess_from_round` {"round": 10.0, "count": 1.0, "type": "equip", "chess": "chess_item_4_01_e_a"} | 在【标准模拟】中通过第9回合后解锁 |
| 6 | `band_justin` | 小贾斯汀 | 23 | S,M | 【私募基金】在第1、4、7、10回合进入休整期时获得1个<骑士储蓄罐> / <骑士储蓄罐>：装备时随机获得1~6资金并销毁 | `preparation_start_gain_chess_from_round` {"round": 1.0, "count": 1.0, "type": "equip", "chess": "chess_item_3_12_e_a"}; `preparation_start_gain_chess_from_round` {"round": 4.0, "count": 1.0, "type": "equip", "chess": "chess_item_3_12_e_a"}; `preparation_start_gain_chess_from_round` {"round": 7.0, "count": 1.0, "type": "equip", "chess": "chess_item_3_12_e_a"}; `preparation_start_gain_chess_from_round` {"round": 10.0, "count": 1.0, "type": "equip", "chess": "chess_item_3_12_e_a"} | 通关【标准模拟】后解锁 |
| 7 | `band_ermengard` | 埃芒加德 | 27 | S,M | 【命结之秘】战斗中前3个被击倒的干员立刻复活！ | `env_gbuff_new_with_verify` {"key": "act1autochess_band28_buff", "max_respawn_cnt": 3.0} | 在【险境模拟】中通过第9回合后解锁 |
| 8 | `band_lmlee` | 老鲤 | 27 | S,M | 【得闲饮茶】第1、2回合的资金暂存至第3回合发放；第3回合进入休整期时，获得2、4阶随机干员各1名 | `give_coin_in_round` {"round": 1.0, "coin": 0.0}; `give_coin_in_round` {"round": 2.0, "coin": 0.0}; `give_coin_in_round` {"round": 3.0, "coin": 15.0}; `prep_start_gain_chess_from_pool_in_round` {"round": 3.0, "type": "char", "pool": "pool_chess_shop_2_reward", "count": 1.0}; `prep_start_gain_chess_from_pool_in_round` {"round": 3.0, "type": "char", "pool": "pool_chess_shop_4_reward", "count": 1.0} | 通关任意模拟2次解锁 |
| 9 | `band_kirara` | 绮良 | 26 | S,M | 【通关奖励】每使用20资金，获得一名不高于当前调度中心等级的随机干员 | `band_coin_cost_gain_random_char_by_shop_level` {"coin_cnt": 20.0, "count": 1.0} | 在【险境模拟】中通过第13回合后解锁 |
| 10 | `band_pepe` | 佩佩 | 23 | S,M | 【博学多通】升级调度中心至2、4和6级后，获得1次特殊刷新：此次刷新出现的干员优先为<萨尔贡>干员 / 在<萨尔贡>部分干员缺席时体验可能不完整 | `up_shop_next_refresh_must_present_bond_char` {"bond": "sargonShip", "cnt": 0.0, "price": 0.0, "lvlist": "2,4,6"} | 通关时的结算阵容中，包含6名【萨尔贡】干员解锁 |
| 11 | `band_harold` | 哈洛德 | 23 | S,M | 【人才盲盒】从第4回合开始每2回合获得1名<维多利亚>干员 / 在<维多利亚>部分干员缺席时体验可能不完整 | `gain_bond_char_per_round` {"bond": "victoriaShip", "round": 4.0, "count": 1.0, "preround": 2.0} | 通关时的结算阵容中，包含6名【维多利亚】干员解锁 |
| 12 | `band_sciurus` | 休露丝 | 24 | S,M | 【雪域礼赠】每回合购买的首名<谢拉格>干员消耗资金为1 / 在<谢拉格>部分干员缺席时体验可能不完整 | `first_buy_in_round_char_price_change` {"bond": "kjeragShip", "price": 1.0} | 通关时的结算阵容中，包含6名【谢拉格】干员解锁 |
| 13 | `band_paganini` | 潘格尼尼 | 24 | S,M | 【定制铳械】累计花费55资金后，获得1名4阶及以上随机的精锐<拉特兰>干员 / 在<拉特兰>部分干员缺席时体验可能不完整 | `band_cost_coin_reach_cnt_gain_chess_from_pool` {"coin_cnt": 55.0, "count": 1.0, "type": "char", "pool": "pool_char_later"} | 多场模拟中【拉特兰】盟约累计200层解锁 |
| 14 | `band_clementia` | 克莱门莎 | 26 | S,M | 【崇高牺牲】<阿戈尔>干员被击倒时，提供等同于该干员等阶的<阿戈尔>盟约层数 / 在<阿戈尔>部分干员缺席时体验可能不完整 | `env_gbuff_new_with_verify` {"key": "act1autochess_band13_buff", "bond_type": "bond_by_id", "bond_id": "egirShip", "bond_add_type": "by_charlevel"} | 多场模拟中【阿戈尔】盟约累计200层解锁 |
| 15 | `band_emperor` | 大帝 | 26 | S,M | 【加急调派】我方干员每次部署后再部署时间减少50% | `env_gbuff_new_with_verify` {"key": "act1autochess_band16_buff", "respawn_time": -0.5, "value": 0.0} | 通关时本局内，累计获取过6名特种干员解锁 |
| 16 | `band_mberry` | 桑葚 | 28 | S,M | 【药枚实验】战斗开始时，使最右边的所有我方单位获得效果：每次攻击时有25%的概率获得1层护盾（最多1层） | `env_gbuff_new_with_verify` {"key": "act1autochess_band17_buff", "prob": 0.25} | 通关任意模拟4次解锁 |
| 17 | `band_humus` | 休谟斯 | 24 | L,S,M | 【回收利用】地面干员技能结束时使周围四格随机1名干员获得3点技力 | `env_gbuff_new_with_verify` {"key": "act1autochess_band18_buff", "sp": 3.0} | 通关任意模拟3次解锁 |
| 18 | `band_quintus` | 昆图斯 | 31 | S,M | 【不稳定要素】第3回合获得1件特殊装备<突变细胞> / <突变细胞>：战斗结束后使装备者变为高一阶的随机干员（最高6阶） | `preparation_start_gain_chess_from_round` {"round": 3.0, "count": 1.0, "type": "equip", "chess": "chess_item_5_08_e_a"} | 通关任意模拟3次解锁 |
| 19 | `band_yu` | 余 | 27 | S,M | 【文火慢炖】第8回合开始时，若仅激活了1个盟约，使其增加36层；否则使所有已激活盟约增加12层 | `round_start_bond_check_gain_layer` {"round": 8.0, "factioncount": 1.0, "count1": 36.0, "count2": 12.0} | 在【标准模拟】中通过第9回合后解锁 |
| 20 | `band_doberm` | 杜宾 | 30 | S,M | 【加练！】每2个回合获得1个特殊法术<教鞭> / <教鞭>：使用后为下场战斗添加额外敌人，若自身战斗完美作战可获得资金 | `preparation_start_gain_chess_every_n_round` {"round": 2.0, "count": 1.0, "type": "trap", "chess": "chess_item_6_03_m"} | 通关任意模拟1次解锁 |
| 21 | `band_cathy` | 凯瑟琳 | 26 | S,M | 【定向投放】每次升级调度中心时，在调度中心刷新随机3件装备，可以选择并获得其中1件 | `up_shop_add_special_goods` {"count": 3.0, "choice": 1.0, "pool": "pool_equip_kathe"} | - |
| 22 | `band_malkie` | 马克维茨 | 28 | S,M | 【商业包装】初始获得1个<商业包装方案> / <商业包装方案>：每出售8名任意干员后，获得1名装备者的同盟约普通干员 | `preparation_start_gain_chess_from_round` {"round": 1.0, "count": 1.0, "type": "equip", "chess": "chess_item_5_07_e_a"} | 通关任意模拟1次解锁 |
| 23 | `band_qalaisa` | 卡莱莎 | 26 | S,M | 【食腐之蝶】我方干员被击倒时，场上剩余我方单位攻击力+20%（最大200%，持续至该干员被击倒或战斗结束） | `env_gbuff_new_with_verify` {"key": "act1autochess_band15_buff", "atk": 0.2, "max_stack_cnt": 10.0} | 通关任意模拟1次解锁 |
| 24 | `band_chen` | 陈 | 22 | S,M | 【以己之长】所有干员造成的物理和法术伤害变为弱点伤害（根据敌人的防御力和法术抗性变更伤害类型） | `env_gbuff_new_with_verify` {"key": "act1autochess_band19_buff"} | - |
| 25 | `band_damaztic` | “变形者集群” | 29 | S,M | 【变形同构】每5回合获得1件特殊装备<变形同构体> / <变形同构体>：与特定装备一同装备时装备者将视为特定盟约成员 | `preparation_start_gain_chess_from_round` {"round": 5.0, "count": 1.0, "type": "equip", "chess": "chess_item_6_09_e_a"}; `preparation_start_gain_chess_from_round` {"round": 10.0, "count": 1.0, "type": "equip", "chess": "chess_item_6_09_e_a"}; `preparation_start_gain_chess_from_round` {"round": 15.0, "count": 1.0, "type": "equip", "chess": "chess_item_6_09_e_a"} | 通关任意模拟1次解锁 |
| 26 | `band_pith` | Pith | 24 | S,M | 【优等生】第1回合获得1名可以造成神经、灼燃、凋亡损伤的特殊干员，其属于调和盟约：可以使部分盟约人数计数+1 | `preparation_start_gain_chess_from_round` {"round": 1.0, "count": 1.0, "type": "char", "chess": "chess_char_1_15_a"} | - |
| 27 | `band_dusk` | 夕 | 28 | S,M | 【墨色真颜】若你的场上存在同名干员，这些干员攻击力+30% / 【幻画为真】第1回合获得1个特殊法术<画卷> / <画卷>：使用后可以复制该法术范围内的1名干员（包括精锐状态和携带的装备） | `preparation_start_gain_chess_from_round` {"round": 1.0, "count": 1.0, "type": "trap", "chess": "chess_item_6_02_m"}; `env_gbuff_new_with_verify` {"key": "act2autochess_band12_buff", "atk": 0.3} | 通关任意模拟1次解锁 |
| 28 | `band_cannot` | 坎诺特 | 27 | S,M | 【利滚利】每回合剩余的资金可以继承，剩余至少5资金时，每回合额外获得1资金 | `coin_carry_over` {"capital": 5.0, "interest": 1.0, "max": 1.0} | - |
| 29 | `band_ducklord` | 鸭爵 | 29 | S,M | 【“神秘顾客”】从第5回合起，你和队友遭遇的部分敌人可能会替换为<鸭爵><高普尼克><流泪小子><圆仔>，击倒这些敌人者获得1资金奖励（包括联防阶段） | `round_start_all_player_change_enemy_2` {"min": 0.0, "max": 2.0, "enemylist": "enemy_2002_bearmi_2,enemy_2034_sythef_2,enemy_2085_skzjxd_2,enemy_2001_duckmi_2", "round": 5.0, "count": 1.0, "minweight": 0.6, "maxweight": 0.99} | 通关任意模拟1次解锁 |
| 30 | `band_lisa` | 铃兰 | 20 | S,M | 【御守之力】每个回合开始时，触发战场上一名干员的获得时效果一次（优先选择最靠右和最靠下） | `round_start_activate_char_chess_effect_in_board` {"event_type": "SERVER_GAIN", "count": 1.0} | - |
| 31 | `band_vodfox` | 巫恋 | 22 | S,M | 【替身娃娃】每回合首次出售初始干员时，改为与调度中心中随机一名干员交换 | `first_sell_char_chess_exchange_char_chess_in_shop` {"count": 1.0} | - |
| 32 | `band_ioleta` | 伊奥莱塔·罗素 | 29 | S,M | 【统御号令】战斗开始时，场上每有一个精锐干员，精锐干员的攻击力，生命值+10% | `env_gbuff_new_with_verify` {"key": "act2autochess_band3_buff", "atk_per_cnt": 0.1, "max_hp_per_cnt": 0.1} | - |
| 33 | `band_jesica` | 杰西卡 | 22 | S,M | 【集结指示】在第4、7、10、13回合进入休整期时获得1个<寻呼模块> / <寻呼模块>：装备时销毁，立即在调度中心中刷新三名与该干员盟约相同的干员，免费获得其中一名!（不超过当前调度中心等级） | `preparation_start_gain_chess_from_round` {"round": 4.0, "count": 1.0, "type": "equip", "chess": "chess_item_4_01_e_a"}; `preparation_start_gain_chess_from_round` {"round": 7.0, "count": 1.0, "type": "equip", "chess": "chess_item_4_01_e_a"}; `preparation_start_gain_chess_from_round` {"round": 10.0, "count": 1.0, "type": "equip", "chess": "chess_item_4_01_e_a"}; `preparation_start_gain_chess_from_round` {"round": 13.0, "count": 1.0, "type": "equip", "chess": "chess_item_4_01_e_a"} | 通关任意模拟1次解锁 |
| 34 | `band_mlyss` | 缪尔赛思 | 28 | S,M | 【至纯凝结】在第1回合开始时获得一个进阶<博士投影> / 进阶<博士投影>：任意干员可装备，立即使该干员晋升为精锐干员 | `preparation_start_gain_chess_from_round` {"round": 1.0, "count": 1.0, "type": "equip", "chess": "chess_item_5_06_e_b"} | 通关任意模拟1次解锁 |
| 35 | `band_makiri` | 松桐 | 24 | S,M | 【九流之缘】偶数回合的休整期开始时，随机获得调度中心的一名干员 | `round_start_gain_char_chess_in_shop_every_n_round` {"round": 2.0, "count": 1.0} | - |
| 36 | `band_fang` | 芬 | 24 | S,M | 【协力共进】第8、10、12、14回合时，获得1个<信标> / <信标>：装备后销毁携带干员，并在调度中心刷新两名同等阶干员免费获取其中一名；原干员在下回合传递给对应盟约人数最多的队友 | `preparation_start_gain_chess_from_round` {"round": 8.0, "count": 1.0, "type": "equip", "chess": "chess_item_5_04_e_a"}; `preparation_start_gain_chess_from_round` {"round": 10.0, "count": 1.0, "type": "equip", "chess": "chess_item_5_04_e_a"}; `preparation_start_gain_chess_from_round` {"round": 12.0, "count": 1.0, "type": "equip", "chess": "chess_item_5_04_e_a"}; `preparation_start_gain_chess_from_round` {"round": 14.0, "count": 1.0, "type": "equip", "chess": "chess_item_5_04_e_a"} | 通关任意模拟3次解锁 |
| 37 | `band_mlynar` | 玛恩纳 | 24 | S,M | 【业务指标】每购买一名<卡西米尔>干员，下回合开始时资金+1（每回合至多3资金） / 在<卡西米尔>部分干员缺席时体验可能不完整 | `round_start_gain_coin_by_bond_char_chess_buy` {"bond": "kazimierzShip", "count": 1.0, "max_count": 3.0} | 通关时的结算阵容中，包含6名【卡西米尔】干员解锁 |
| 38 | `band_chiave` | 贾维 | 23 | S,M | 【团伙行动】主动刷新6次调度中心后获得一名不高于当前调度中心等级的<叙拉古>干员（每回合至多获得2名） / 在<叙拉古>部分干员缺席时体验可能不完整 | `refresh_shop_count_gain_coin_bond_char_chess` {"refresh_count": 6.0, "bond": "siracusaShip", "max_count": 2.0} | 通关时的结算阵容中，包含6名【叙拉古】干员解锁 |
| 39 | `band_narant` | 娜仁图亚 | 26 | S,M | 【见者有份】偶数回合进入休整期时，调度中心特殊刷新两件装备，免费获取其中一件；萨尔贡盟约<在场6名不同【萨尔贡】干员>效果替换为【萨尔贡】干员技能开启后，周围八格干员同时享受该干员携带的不高于V阶的装备效果，持续60秒 / 在<萨尔贡>部分干员缺席时体验可能不完整 | `preparation_start_add_special_goods_every_n_round` {"round": 2.0, "count": 1.0, "type": "equip", "pool": "pool_equip_narant", "refresh_cnt": 2.0, "choice_cnt": 1.0} | 通关时的结算阵容中，包含6名【萨尔贡】干员解锁 |
| 40 | `band_amedic` | Touch | 28 | S,M | 【外勤医疗】所有玩家场地上出现一名<预备干员-医疗>；战斗开始时，若场上至少有两名精锐干员，则替换为<Touch> | `auto_chess_change_map` {"common_condition": "condition_golden_chess_le", "cnt": 1.0, "char_605_cmedic#1": 1.0, "char_605_cmedic#2_multi_only": 1.0, "char_605_cmedic#3": 1.0, "char_605_cmedic#4_multi_only": 1.0, "char_613_acmedc#1": 0.0, "char_613_acmedc#2_multi_only": 0.0, "char_613_acmedc#3": 0.0, "char_613_acmedc#4_multi_only": 0.0}; `auto_chess_change_map` {"common_condition": "condition_golden_chess_ge", "cnt": 2.0, "char_613_acmedc#1": 1.0, "char_613_acmedc#2_multi_only": 1.0, "char_613_acmedc#3": 1.0, "char_613_acmedc#4_multi_only": 1.0, "char_605_cmedic#1": 0.0, "char_605_cmedic#2_multi_only": 0.0, "char_605_cmedic#3": 0.0, "char_605_cmedic#4_multi_only": 0.0} | 通关任意模拟3次解锁 |

Band notes for implementation:
- **Economy bands:**
  - 坎诺特 (carry-over + interest). `constData.noMoneyTipsBand`=[band_cannot]: the "leftover funds will be lost" warning is not shown to this band.
  - 老鲤: R1/R2 income 0, R3 15, plus 1 random tier II and 1 random tier IV at R3.
  - 小贾斯汀 (piggy bank 1–6).
  - 绮良: 1 random operator of tier ≤ shop level per 20 funds spent.
  - 帕格尼尼: an elite Laterano of tier ≥ IV after 55 funds spent (`pool_char_later`).
  - 玛恩纳: +1 next round per Kazimierz bought, max 3.
  - 贾维: 6 active refreshes → 1 Siracusa operator, max 2/round.
- **Shop-manipulation bands:** 杜遥夜, 梓兰, 佩佩, 凯瑟琳 (on every shop upgrade, choose 1 of 3 items), 巫恋 (the first sale of a normal operator each round swaps it with a random shop operator), 娜仁图亚 (even rounds: 1 of 2 items free).
- **Free-unit bands:** 哈洛德 (a Victoria operator every 2 rounds from R4), 松桐 (even rounds: a random shop operator), Pith (R1 special 调和 operator `chess_char_1_15_a`), 缪尔赛思 (R1 advanced 博士投影 = instant elite), 昆图斯 (R3 突变细胞), 变形者集群 (变形同构体 at R5/10/15), 杰西卡 / 芬 (寻呼模块 / 信标 at fixed rounds), 杜宾 (教鞭 every 2 rounds: add enemies, earn coins on perfect).
- **Combat bands:** 阿米娅, 埃芒加德, 大帝, 桑葚, 休谟斯, 卡莱莎, 陈, 夕, 伊奥莱塔, Touch (swaps a map token 预备干员-医疗 → Touch if ≥2 elites), 余 (R8 bond burst), 华法琳, 克莱门莎, 铃兰 (at each round start re-trigger 1 operator's "获得时" effect).
- **Multi-only effects:**
  - 鸭爵 affects teammates too. From R5, 0–2 enemies per round are replaced by 鸭爵/高普尼克/流泪小子/圆仔, each worth 1 coin to the killer.
  - 芬's 信标 passes the operator to a teammate.

---

## 12. 机变阶段: choice events (`effectChoiceInfoDict`, 109 entries incl. `_s` solo variants) [DATA + WIKI]

| choiceType | effectType | Name | Ids | What it does |
|---|---|---|---|---|
| EQUIP_FREE | EQUIP | 道具补给 | equip_free_1..4 (+_tr) | Pick 1 free item |
| EQUIP_FREE | EQUIP | 机密商店 | artifact_paid_1..5 | Pick 1 free (special) item |
| BOUNTY_HUNT | ENEMY_GAIN | 悬赏决策 | enemy_initial_1..10, bounty_hunter_1..15, bossInitial_1..6 | Pick a bounty: extra enemies in your next 1 / 2 / all battles; coins on kill or on perfect |
| BUFF_SELECT | BUFF_GAIN | 战术决策 | buff_select_1..4, hardbuff_select_1..3, terrain_m01_1…m07_1 | Team buff, enemy debuff or map change |
| PERSONAL_CHOOSE | ENEMY_GAIN | 悬赏决策 | hunter_band_1 | Personal bounty pick (pool server-side) |

The `_s` ids are the solo copies with identical text.

When they happen:
- Rounds with `isSpPrepare`. PRTS (multi): FUNNY after R2/R8 (no bounties); NORMAL after R2/R5/R8; HARD+ after R2/R8 (bounties fixed) and R10 (no 战术决策).
- Solo NORMAL: R5 道具补给, R8 战术决策.
- Proposed mapping [ASSUMED]:
  - HARD/ABYSS: R3 = bounty (enemy_initial / bounty_hunter tier I–II); R9 = bounty (tier II–III); R11 = 道具补给 or 机密商店.
  - NORMAL: R3 bounty, R6 道具补给, R9 战术决策.
  - FUNNY: R3 道具补给, R9 战术决策.

Choice format:
- **Multi:** 6 options shared by the team. Players pick 1 each in turn (first picker 30 s, others 16 s, `specialPhaseTime`=16, ~70 s total).
- **Solo:** 3 options (3选1), time unlimited in 下半.
- Effects worded "若存在其他队友则他们也获得" apply to everyone.

Bounty semantics (buff keys) [DATA]:
- **Kill bounty** `add_enemy_kill_gain_coin {count, enemy_id, coin, round}`:
  - Adds `count` copies of `enemy_id` to the chooser's next `round` battles (99 = all remaining).
  - Whoever kills it (the chooser or a 联防 teammate) gets `coin`.
  - `enemyPrice` = coin value (1–6).
- **Perfect bounty** `add_enemy_selfbattle_win_gain_coin` / `next_battle_add_enemy_win_gain_coin` ("战术特训"): adds enemies; coins only if the chooser clears perfectly in their own phase.
- **多轮悬赏 · 假想敌 (enemyInitial_1..6):** adds 1 imaginary enemy to every subsequent battle, 1 coin each kill.

Team buffs (BUFF_GAIN, `allybuff_select_*`):
- 列装: 2 random tier‑I items.
- 盟誓 x8: bond layers +8…12 for specific bonds.
- 财富: +1 fund.
- 补给: next 2 refreshes free, stackable.
- 整备: next item bought is advanced.
- 升华: next operator bought is elite.
- 驰援 x8: 1 random operator of a nation bond.
- 自愈, 火力, 征召, 无瑕, 锐利.

Enemy debuffs (`enemydebuff_select_1..9`): all/elite/leader enemies get −ATK%, −DEF or −RES.

Map changes (`map_m0X_*`): remove barricades, turn them into shooting platforms, stop a sandstorm, remove bushes.

The full list of 182 choice, enemy and char-map effects is in Appendix A.

Enemy-side global modifiers (`aceffect_enemy_*`, type ENEMY):
- 急行军: move speed +15%.
- 补给线: HP +8%; 补给线II: HP +20%.
- 攻坚装备: ATK +10%, HP +20%.
- 攻坚装备II: ×0.8 / ×0.8.
- 攻坚装备III: ATK ×0.7, HP ×0.75.

The last two look like the solo/easy stat reductions. [ASSUMED] Map them per mode as in §1.

---

## 13. Scoring, trophies, titles, tips, broadcasts

- **`roundScoreDataList`** (score by rounds cleared) [DATA]: 0→0, 1→10, 2→20, 3→30, 4→50, 5→70, 6→90, 7→110, 8→130, 9→150, 10→170, 11→200, 12→230, 13→260, 14→300. Used for the result screen and history [ASSUMED purpose].
- **Trophies (成就奖杯), multi only** [WIKI PRTS 下半]:

| Rounds passed | 标准 | 险境 | 绝境 | 终极 |
|---|---|---|---|---|
| ≤4 | 0 | 0 | 0 | 0 |
| ≤8 | 1 | 1 | 1 | 1 |
| ≤11 | 2 | 2 | 2 | 2 |
| ≤13 | 2 | 3 | 3 | 3 |
| 14 (clear) | 3 | 4 | 5 | 6 |
| ?? (hidden core) | – | 5 | 7 | 8 |

- **Trophy tiers (`medalDataList`):** 0, 10, 30, 60, 100 → trophy_level1..5 icons. The tier is shown in rooms and at band selection and is used for matchmaking ("精确搜寻").
- **End-of-match titles (`playerTitleDataDict`):** 卫戍之星, 不朽盟约, 坚若磐石, 精英云集, 万事俱备, 挥金如土. [ASSUMED meanings]: top boss damage, most bond layers, least LP lost, most elites, most items, most funds spent.
- **Broadcasts (`broadcastList`)**, in priority order (`{0}` = player, `{1}` = operator/level, `{2}` = amount):
  - BOSS_HIT (30): "{0}博士对敌方领袖造成的伤害超过20% / 50% / 80%!"
  - CHAR_DAMAGE (20): "{0}博士的{1}干员造成的伤害量达到{2}", at 200 000 / 500 000 / 1 000 000.
  - SHOP_LEVEL (11): "{0}博士将调度中心等级提升为{1}级", for levels 2–6.
  - BOND_EFFECT (10): "叠加层数".
  - GOLDEN_CHAR (2): "{0}博士的{1}干员晋升为精锐".
  - CHAR_GIFT (1): "{0}博士给你赠送了{1}".
- **Report reasons (`reportPlayerDataList`):** 消极游戏, 故意捣乱, 中途退出, 不当言论, 骚扰, 作弊, 脚本, 其他.
- **Emote themes:** emoticon_autochess_basic, emoticon_originium_slug, emoticon_autochess_basic_2, emoticon_foolsday_doctor / _amiya / _wisdel. Chat CD 1 s, bubble 3 s (`chatCD`, `chatTime`).
- **Other constData:**
  - ping colours <60 / <200 / ≥200 ms;
  - `invitationSendCd` 60 s; `matchTimeMax` 120 s;
  - `bossTrailerStartRound` 3 (boss preview from R3);
  - hint timers 10 s;
  - `singleClosureStayTime` 15 s.
  - Price colours: discount #59f4ca, premium #ff5454, normal #ffc600.

### Game tips (`gameTipsList`, all weight 50), CN → EN
1. 只有在联合模拟中才能获得奖杯 → Trophies are only earned in co-op (joint) simulation.
2. 联合模拟在选择策略时可以进行一次跳过 → In co-op you may skip once while choosing a strategy.
3. 归属于特定盟约的干员只有部分会出现在调度中心内 → Only some operators of certain alliances appear in the Dispatch Center.
4. 调度中心即使冻结，依然可以主动刷新 → Even when frozen, the Dispatch Center can still be manually refreshed.
5. 晋级的特殊奖励无法被刷新、冻结，也不会保留至下一回合 → Special promotion rewards can't be refreshed or frozen and don't carry to the next round.
6. 处于临时整备区的调度资源，在进入下一回合后会自动销毁 → Resources in the temporary bench are destroyed when the next round begins.
7. 一些特殊的盟约不需要部署干员也能激活生效 → Some special alliances activate without deploying operators.
8. 干员晋级后已配发装备会回收至整备区，需要重新配置 → After promotion, equipped items return to the bench and must be re-equipped.
9. 两件同名装备可以合成一件更强力的装备 → Two identical items merge into a stronger one.
10. 特定的装备组合可以为干员赋予额外的盟约效果 → Certain item combos grant an operator an extra alliance.
11. 叠加的盟约会在单次模拟中始终保留，但只有在盟约被激活时才会发挥作用 → Alliance stacks persist for the whole run but only work while the alliance is active.
12. 多数情况下只有已经激活的盟约才可进行叠加 → Usually only active alliances can gain stacks.
13. 休整期可以查看队友的战场情况 → During the rest phase you can view teammates' battlefields.
14. 休整期可以查看当前回合即将迎击的敌方单位 → During the rest phase you can view this round's incoming enemies.
15. 拖拽干员至整备区可以直接撤退干员 → Drag an operator to the bench to withdraw it.
16. 全体参与者就绪之前可随时取消准备，准备战斗后将无法进行操作 → You can cancel Ready until everyone is ready; after the battle starts no actions are possible.
17. 只有达成完美作战的队友可以进行联防 → Only teammates with a perfect clear can join the joint defense.
18. 进行联防时，盟约不会继续叠加 → Alliances don't gain stacks during joint defense.
19. 最终攻势中，两名参与者会处于同一个战场，但无法查看另一组队友的战场情况 → In the Final Assault, two participants share one battlefield but can't see the other pair's.
20. 最终攻势中，所有人将一起对敌方领袖造成伤害 → In the Final Assault, everyone damages the enemy leader together.
21. 达成特定的条件，可在最终攻势后解锁隐秘核心 → Meeting certain conditions unlocks the Hidden Core after the Final Assault.

---

## 14. Implementation notes for an authoritative server

Proposed server state per player:

```
{ lp, funds, pendingFunds, shopLevel, upgradePrice, roundsAtLevel, shopSlots[6]{chessId|itemId, frozen, special},
  board[8]{chessId,pos,items[]}, bench[10], tempBench[], bondLayers{bondId:int}, spentTotal, refreshCountRound, perfectThisRound, eliminated }
```

- Shared state: `pool{chessId:copiesLeft}` (multi), `round`, `phase`, `choiceQueue`, `bannedBonds`, `bossId`, `stageId`, `teamLp` (final).
- Phase timers come from `turnInfoDataDict[mode][round].normalPhaseTime`. When a timer expires, auto-ready the player; they keep whatever they did. The combat limit comes from the round level's `maxPlayTime`.
- Round-start order and settlement: §4.
- Pool bookkeeping must be atomic, since two players can buy the last copy at once. Shop-displayed copies are not reserved, so the purchase fails if the pool is empty [COMM behaviour].
- Merge check runs after every acquisition, including gifts, band grants and item effects. Board and bench copies both count.
- Suggested defaults for undocumented values:
  - income `min(3+r, 10)`, FUNNY +2;
  - copy-weighted shop roll;
  - per-slot free freeze;
  - banned bonds per match: 1 core + 1 add-on;
  - boss HP `× alive/4` (solo ×0.25).

---

## 15. Open questions
1. **Exact income after R3, and the cap.** The formula is inferred: `3+r` is solid for R1–R3 only; the cap of 10 is a guess (could be 12). FUNNY's "更加丰富" bonus is unknown.
2. **Official shop tier odds.** Unpublished. The copy-weighted model is consistent with community remarks but unverified.
3. **Number of bonds banned per match** and exactly which operators disappear ("只有部分会出现").
4. **Band offer count and skip semantics** at BAND_CHECK (3 offered + 1 reroll assumed).
5. **Which choice-event ids occur at which SP round** (server-side pools). The same applies to the `pool_*` contents.
6. **Boss HP scaling** with player count, and solo boss HP.
7. **联防 defender selection** when more than 2 players are perfect. Whether 1 or 2 defenders fight (PRTS: "1~2名").
8. **Round-15 hidden boss selection.** Is it weighted random, or tied to the R14 boss? Thresholds: 下半 350/1200 vs 上半 300/1000. The sibling doc 05 uses 300/1000; act2 should use **350/1200**.
9. **Whether the team result counts for eliminated players** (trophies are by "自身的通过回合数", i.e. per player rounds survived).

## 16. Sources
- Game data: Kengxxiao/ArknightsGameData zh_CN (`activity_table.json` → `autoChessData`, `activity.AUTOCHESS_SEASON.act2autochess`; level JSONs).
- PRTS: https://prts.wiki/w/卫戍协议 (raw); https://prts.wiki/w/卫戍协议：盟约 (上半); https://prts.wiki/w/卫戍协议：盟约_下半 (modes, hidden core, trophies).
- BWIKI 盟约 玩法介绍: https://wiki.biligame.com/arknights/盟约 (refresh 1, sell 1, merge, funds not kept, upgrade −1/round).
- Official patch notes: https://ak.hypergryph.com/news/5114.
- Bahamut guides: https://forum.gamer.com.tw/C.php?bsn=33651&snA=12294 and snA=12316 (10 LP cap, B位, decision rounds, deploy order, pool rules).
- NGA: tid 45713703 (economy / leveling), 45597280, 45645958, 46479287, 46592301 (mechanics and bugs), 46551276 (R3 bounty numbers).
- bilibili BV1JWy3BkEpt (shared pool 12/14/18); note.com yu_channel_jp (pool I–VI = 12/14/18/16/8/5); note.com aik0aaac (250/400/425 rewards).
- arknights.wiki.gg/wiki/Stronghold_Protocol (upgrade costs, 10 LP cap).

---

## Appendix A: all choice / enemy / char-map effects (`effectInfoDataDict` minus EQUIP/BOND/BAND/GARRISON)

| effectId | Type | Name | Bounty funds | Effect |
|---|---|---|---|---|
| `aceffect_char_1` | CHAR_MAP | 未精英化 | 0 | 无相关加成 |
| `aceffect_char_2` | CHAR_MAP | 精英阶段1 | 0 | 攻击力和防御力+5% |
| `aceffect_char_3` | CHAR_MAP | 精英阶段2 | 0 | 攻击力+10%，防御力和最大生命值+5% |
| `aceffect_char_4` | CHAR_MAP | 精英阶段2-60级 | 0 | 攻击力、防御力和最大生命值+10% |
| `enemyeffect_1` | ENEMY_GAIN | 无人机护障·P·战术特训 | 2 | 为自身下场作战添加3只无人机护障·P，若各自行动阶段就达成完美作战，获得2资金 |
| `enemyeffect_2` | ENEMY_GAIN | 法术大师A2·多轮战术特训 | 2 | 之后的每场作战添加2只法术大师A2，若各自行动阶段就达成完美作战，获得2资金 |
| `enemyeffect_3_2` | ENEMY_GAIN | 法术大师A2·悬赏 | 2 | 为自身下场作战添加1只法术大师A2，将其击倒者获得2资金 |
| `enemyeffect_3_3` | ENEMY_GAIN | 元核孽生者·悬赏 | 3 | 为自身下场作战添加1只元核孽生者，将其击倒者获得3资金 |
| `enemyeffect_3_4` | ENEMY_GAIN | 山海众头目·悬赏 | 2 | 为自身下场作战添加1只山海众头目，将其击倒者获得2资金 |
| `enemyeffect_3_2_e` | ENEMY_GAIN | “萨科塔之眼”·悬赏 | 2 | 为自身下场作战添加1只“萨科塔之眼”，将其击倒者获得2资金 |
| `enemyeffect_3_3_e` | ENEMY_GAIN | 幽灵组长·悬赏 | 1 | 为自身下场作战添加1只幽灵组长，将其击倒者获得1资金 |
| `enemyeffect_3_4_e` | ENEMY_GAIN | 重装防御者·悬赏 | 1 | 为自身下场作战添加1只重装防御者，将其击倒者获得1资金 |
| `enemyeffect_3_5_e` | ENEMY_GAIN | 重弩突袭者·悬赏 | 2 | 为自身下场作战添加1只重弩突袭者，将其击倒者获得2资金 |
| `enemyeffect_4` | ENEMY_GAIN | 山海众头目·多轮悬赏 | 1 | 之后的每场作战添加1只山海众头目，将其击倒者获得1资金 |
| `enemyeffect_5_1` | ENEMY_GAIN | 源石虫·特训 | 0 | 为自身下场作战添加1只源石虫，但不获得资金 |
| `enemyeffect_5` | ENEMY_GAIN | 鸭爵·悬赏 | 3 | 为自身下场作战添加1只鸭爵，将其击倒者获得3资金 |
| `enemyeffect_6` | ENEMY_GAIN | 高普尼克·悬赏 | 3 | 为自身下场作战添加1只高普尼克，将其击倒者获得3资金 |
| `enemyeffect_7` | ENEMY_GAIN | 流泪小子·悬赏 | 3 | 为自身下场作战添加1只流泪小子，将其击倒者获得3资金 |
| `enemyeffect_8` | ENEMY_GAIN | 圆仔·悬赏 | 3 | 为自身下场作战添加1只圆仔，将其击倒者获得3资金 |
| `enemyeffect_b_1` | ENEMY_GAIN | 碎骨·悬赏 | 1 | 为自身下场作战添加1个碎骨，将其击倒者获得1资金 |
| `enemyeffect_b_2` | ENEMY_GAIN | 萨卡兹百夫长·悬赏 | 2 | 为自身下场作战添加1个萨卡兹百夫长，将其击倒者获得2资金 |
| `enemyeffect_b_3` | ENEMY_GAIN | 弑君者·悬赏 | 1 | 为自身下场作战添加1个弑君者，将其击倒者获得1资金 |
| `enemyeffect_b_4` | ENEMY_GAIN | 泥岩·悬赏 | 4 | 为自身下场作战添加1个泥岩，将其击倒者获得4资金 |
| `enemyeffect_b_5` | ENEMY_GAIN | 腐败骑士·悬赏 | 3 | 为自身下场作战添加1个腐败骑士，将其击倒者获得3资金 |
| `enemyeffect_b_6` | ENEMY_GAIN | 凋零骑士·悬赏 | 3 | 为自身下场作战添加1个凋零骑士，将其击倒者获得3资金 |
| `enemyeffect_b_7` | ENEMY_GAIN | “遗弃者”·悬赏 | 4 | 为自身下场作战添加1个“遗弃者”，将其击倒者获得4资金 |
| `enemyeffect_b_8` | ENEMY_GAIN | 喷气人·悬赏 | 3 | 为自身下场作战添加1个喷气人，将其击倒者获得3资金 |
| `enemyeffect_b_9` | ENEMY_GAIN | 杰斯顿·威廉姆斯·悬赏 | 4 | 为自身下场作战添加1个杰斯顿·威廉姆斯，将其击倒者获得4资金 |
| `enemyeffect_b_10` | ENEMY_GAIN | W·悬赏 | 1 | 为自身下场作战添加1个W，将其击倒者获得1资金 |
| `enemyeffect_b_11` | ENEMY_GAIN | “鼠王”·悬赏 | 2 | 为自身下场作战添加1个“鼠王”，将其击倒者获得2资金 |
| `enemyeffect_b_12` | ENEMY_GAIN | “庞贝”·悬赏 | 2 | 为自身下场作战添加1个“庞贝”，将其击倒者获得2资金 |
| `enemyeffect_b_13` | ENEMY_GAIN | 大鲍勃·悬赏 | 2 | 为自身下场作战添加1个大鲍勃，将其击倒者获得2资金 |
| `enemyeffect_b_14` | ENEMY_GAIN | “自在”·悬赏 | 4 | 为自身下场作战添加1个“自在”，将其击倒者获得4资金 |
| `enemyeffect_b_15` | ENEMY_GAIN | 锏·悬赏 | 5 | 为自身下场作战添加1个锏，将其击倒者获得5资金 |
| `enemyeffect_b_16` | ENEMY_GAIN | 扎罗，“狼之主”·悬赏 | 5 | 为自身下场作战添加1个扎罗，“狼之主”，将其击倒者获得5资金 |
| `enemyeffect_b_17` | ENEMY_GAIN | “墓碑”·悬赏 | 4 | 为自身下场作战添加1个“墓碑”，将其击倒者获得4资金 |
| `enemyeffect_b_18` | ENEMY_GAIN | 迷路的巨像·悬赏 | 5 | 为自身下场作战添加1个迷路的巨像，将其击倒者获得5资金 |
| `enemyeffect_b_19` | ENEMY_GAIN | 澪·悬赏 | 3 | 为自身下场作战添加1个澪，将其击倒者获得3资金 |
| `enemyeffect_b_20` | ENEMY_GAIN | “巨大的丑东西”·悬赏 | 5 | 为自身下场作战添加1个“巨大的丑东西”，将其击倒者获得5资金 |
| `enemyeffect_b_21` | ENEMY_GAIN | “复仇者”·悬赏 | 6 | 为自身下场作战添加1个“复仇者”，将其击倒者获得6资金 |
| `enemyeffect_b_22` | ENEMY_GAIN | “邪魔的利刃”·悬赏 | 3 | 为自身下场作战添加1个“邪魔的利刃”，将其击倒者获得3资金 |
| `enemyeffect_b_23` | ENEMY_GAIN | 陷落雪祀·悬赏 | 3 | 为自身下场作战添加1个陷落雪祀，将其击倒者获得3资金 |
| `enemyeffect_b_24` | ENEMY_GAIN | 纠缠藤蔓·悬赏 | 3 | 为自身下场作战添加1个纠缠藤蔓，将其击倒者获得3资金 |
| `allybuff_select_1` | BUFF_GAIN | 列装 | 0 | 你获得2件随机1阶装备，若存在其他队友则他们也获得 |
| `allybuff_select_2_1` | BUFF_GAIN | 斯卡蒂的盟誓 | 0 | 你的阿戈尔、突袭和坚守盟约层数+8，若存在其他队友则他们也获得 |
| `allybuff_select_2_2` | BUFF_GAIN | 诗怀雅的盟誓 | 0 | 你的炎和投资人盟约层数+10，若存在其他队友则他们也获得 |
| `allybuff_select_2_3` | BUFF_GAIN | 风笛的盟誓 | 0 | 你的维多利亚、远见和不屈盟约层数+8，若存在其他队友则他们也获得 |
| `allybuff_select_2_4` | BUFF_GAIN | 银灰的盟誓 | 0 | 你的谢拉格、投资人、迅捷盟约层数+8，若存在其他队友则他们也获得 |
| `allybuff_select_2_5` | BUFF_GAIN | 莫斯提马的盟誓 | 0 | 你的拉特兰、奥术盟约层数+10，若存在其他队友则他们也获得 |
| `allybuff_select_2_6` | BUFF_GAIN | 缇缇的盟誓 | 0 | 你的萨尔贡、精准盟约层数+10，若存在其他队友则他们也获得 |
| `allybuff_select_2_7` | BUFF_GAIN | 玛恩纳的盟誓 | 0 | 你的卡西米尔盟约层数+12，若存在其他队友则他们也获得 |
| `allybuff_select_2_8` | BUFF_GAIN | 德克萨斯的盟誓 | 0 | 你的叙拉古、突袭盟约层数+10，若存在其他队友则他们也获得 |
| `allybuff_select_3` | BUFF_GAIN | 财富 | 0 | 你获得1资金，若存在其他队友则他们也获得 |
| `allybuff_select_4` | BUFF_GAIN | 补给 | 0 | 你接下来的2次刷新变为免费（可叠加），若存在其他队友则他们也获得 |
| `allybuff_select_5` | BUFF_GAIN | 整备 | 0 | 你接下来购买的1件装备变为进阶品质 |
| `allybuff_select_6` | BUFF_GAIN | 升华 | 0 | 你接下来购买的1名干员变为精锐状态 |
| `allybuff_select_7_1` | BUFF_GAIN | 炎盟约驰援 | 0 | 你获得1名炎盟约的随机干员棋子 |
| `allybuff_select_7_2` | BUFF_GAIN | 谢拉格驰援 | 0 | 你获得1名谢拉格盟约的随机干员棋子 |
| `allybuff_select_7_3` | BUFF_GAIN | 萨尔贡驰援 | 0 | 你获得1名萨尔贡盟约的随机干员棋子 |
| `allybuff_select_7_4` | BUFF_GAIN | 叙拉古驰援 | 0 | 你获得1名叙拉古盟约的随机干员棋子 |
| `allybuff_select_7_5` | BUFF_GAIN | 卡西米尔驰援 | 0 | 你获得1名卡西米尔盟约的随机干员棋子 |
| `allybuff_select_7_6` | BUFF_GAIN | 拉特兰驰援 | 0 | 你获得1名拉特兰盟约的随机干员棋子 |
| `allybuff_select_7_7` | BUFF_GAIN | 维多利亚驰援 | 0 | 你获得1名维多利亚盟约的随机干员棋子 |
| `allybuff_select_7_8` | BUFF_GAIN | 阿戈尔驰援 | 0 | 你获得1名阿戈尔盟约的随机干员棋子 |
| `allybuff_select_11` | BUFF_GAIN | 自愈 | 0 | 你获得：我方单位每次受到伤害时回复50点生命值；若存在其他队友则他们也获得此效果 |
| `allybuff_select_13` | BUFF_GAIN | 火力 | 0 | 你获得：休整期结束时若手牌区至少有3个单位，我方所有干员无视敌人20法术抗性；若存在其他队友则他们也获得此效果 |
| `allybuff_select_14` | BUFF_GAIN | 征召 | 0 | 你获得：开始作战时若场上至少有一行存在3名干员，所有干员的再部署时间-50%；若存在其他队友则他们也获得此效果 |
| `allybuff_select_18` | BUFF_GAIN | 无瑕 | 0 | 你获得：干员在生命值为满时，攻击力、防御力+30%；若存在其他队友则他们也获得此效果 |
| `allybuff_select_19` | BUFF_GAIN | 锐利 | 0 | 你获得：休整期结束时若手牌区为空，我方所有干员无视敌人30%的防御力；若存在其他队友则他们也获得此效果 |
| `enemydebuff_select_1` | BUFF_GAIN | 排斥：乏力 | 0 | 全部敌人获得减益效果：攻击力-5% |
| `enemydebuff_select_2` | BUFF_GAIN | 排斥：脆弱 | 0 | 全部敌人获得减益效果：防御力-100 |
| `enemydebuff_select_3` | BUFF_GAIN | 排斥：致幻 | 0 | 全部敌人获得减益效果：法术抗性-3 |
| `enemydebuff_select_4` | BUFF_GAIN | 责罚：乏力 | 0 | 精英敌人获得减益效果：攻击力-6% |
| `enemydebuff_select_5` | BUFF_GAIN | 责罚：脆弱 | 0 | 精英敌人获得减益效果：防御力-150 |
| `enemydebuff_select_6` | BUFF_GAIN | 责罚：致幻 | 0 | 精英敌人获得减益效果：法术抗性-5 |
| `enemydebuff_select_7` | BUFF_GAIN | 裁决：乏力 | 0 | 领袖敌人获得减益效果：攻击力-7% |
| `enemydebuff_select_8` | BUFF_GAIN | 裁决：脆弱 | 0 | 领袖敌人获得减益效果：防御力-200 |
| `enemydebuff_select_9` | BUFF_GAIN | 裁决：致幻 | 0 | 领袖敌人获得减益效果：法术抗性-7 |
| `aceffect_enemy_1` | ENEMY | 急行军 | 0 | 所有敌人移动速度+15% |
| `aceffect_enemy_2` | ENEMY | 补给线 | 0 | 所有敌人最大生命值+8% |
| `aceffect_enemy_2_2` | ENEMY | 补给线II | 0 | 所有敌人最大生命值+20% |
| `aceffect_enemy_3` | ENEMY | 攻坚装备 | 0 | 所有敌人攻击力+10%，最大生命值+20% |
| `aceffect_enemy_4` | ENEMY | 攻坚装备II | 0 | 所有敌人攻击力-20%，最大生命值-20% |
| `aceffect_enemy_5` | ENEMY | 攻坚装备III | 0 | 所有敌人攻击力-30%，最大生命值-25% |
| `enemyInitial_1` | ENEMY_GAIN | 多轮悬赏 · 假想敌：蚀裂 | 1 | 后续每场作战添加1只假想敌：蚀裂（被击倒时造成持续伤害），击倒它的你或队友获得1资金 |
| `enemyInitial_2` | ENEMY_GAIN | 多轮悬赏 · 假想敌：淤困 | 1 | 后续每场作战添加1只假想敌：淤困（可造成元素损伤），击倒它的你或队友获得1资金 |
| `enemyInitial_3` | ENEMY_GAIN | 多轮悬赏 · 假想敌：骨刺 | 1 | 后续每场作战添加1只假想敌：骨刺（拥有隐匿），击倒它的你或队友获得1资金 |
| `enemyInitial_4` | ENEMY_GAIN | 多轮悬赏 · 假想敌：黑云 | 1 | 后续每场作战添加1只假想敌：黑云（空中敌人），击倒它的你或队友获得1资金 |
| `enemyInitial_5` | ENEMY_GAIN | 多轮悬赏 · 假想敌：再生 | 1 | 后续每场作战添加1只假想敌：再生（需要一定攻击次数击破），击倒它的你或队友获得1资金 |
| `enemyInitial_6` | ENEMY_GAIN | 多轮悬赏 · 假想敌：镜膜 | 1 | 后续每场作战添加1只假想敌：镜膜（拥有折射），击倒它的你或队友获得1资金 |
| `map_m01_1` | BUFF_GAIN | 模拟战场演变·模式一 | 0 | 移除场地上全部阻隔工事 |
| `map_m02_1` | BUFF_GAIN | 模拟战场演变·模式二 | 0 | 场地上全部阻隔工事变为射击台 |
| `map_m02_2` | BUFF_GAIN | 模拟战场演变·模式三 | 0 | 移除场地上全部阻隔工事 |
| `map_m03_1` | BUFF_GAIN | 模拟战场演变·模式四 | 0 | 移除场地左侧的阻隔工事 |
| `map_m03_2` | BUFF_GAIN | 模拟战场演变·模式五 | 0 | 场地右侧的射击台变为可以部署高台干员和地面干员的地面 |
| `map_m04_1` | BUFF_GAIN | 模拟战场演变·模式六 | 0 | 移除场地上全部阻隔工事 |
| `map_m06_1` | BUFF_GAIN | 模拟战场演变·模式八 | 0 | 场地中的沙尘暴停止 |
| `map_m07_1` | BUFF_GAIN | 模拟战场演变·模式九 | 0 | 场上的树丛全部消失 |
| `enemyeffect_10_1` | ENEMY_GAIN | 战术特训·飞行I | 1 | 为自身下场战斗添加1只妖怪，若各自行动阶段就达成完美作战，获得1资金 |
| `enemyeffect_10_2` | ENEMY_GAIN | 战术特训·飞行II | 2 | 为自身下场战斗添加1只暴鸰，若各自行动阶段就达成完美作战，获得2资金 |
| `enemyeffect_10_3` | ENEMY_GAIN | 战术特训·飞行III | 3 | 为自身下场战斗添加1只帝国炮火中枢先兆者，若各自行动阶段就达成完美作战，获得3资金 |
| `enemyeffect_10_4` | ENEMY_GAIN | 悬赏·飞行I | 1 | 为自身接下来两场作战添加1只妖怪，将其击倒者获得1资金 |
| `enemyeffect_10_5` | ENEMY_GAIN | 悬赏·飞行II | 2 | 为自身接下来两场作战添加1只暴鸰，将其击倒者获得2资金 |
| `enemyeffect_10_6` | ENEMY_GAIN | 悬赏·飞行III | 3 | 为自身接下来两场作战添加1只法术大师A1，将其击倒者获得3资金 |
| `enemyeffect_11_1` | ENEMY_GAIN | 战术特训·频次I | 1 | 为自身下场战斗添加1只磨砻，若各自行动阶段就达成完美作战，获得1资金 |
| `enemyeffect_11_2` | ENEMY_GAIN | 战术特训·频次II | 2 | 为自身下场战斗添加1只烹泉，若各自行动阶段就达成完美作战，获得2资金 |
| `enemyeffect_11_3` | ENEMY_GAIN | 战术特训·频次III | 3 | 为自身下场战斗添加1只新硎，若各自行动阶段就达成完美作战，获得3资金 |
| `enemyeffect_11_4` | ENEMY_GAIN | 悬赏·频次I | 1 | 为自身接下来两场作战添加1只磨砻，将其击倒者获得1资金 |
| `enemyeffect_11_5` | ENEMY_GAIN | 悬赏·频次II | 2 | 为自身接下来两场作战添加1只烹泉，将其击倒者获得2资金 |
| `enemyeffect_11_6` | ENEMY_GAIN | 悬赏·频次III | 3 | 为自身接下来两场作战添加1只清明，将其击倒者获得3资金 |
| `enemyeffect_12_1` | ENEMY_GAIN | 战术特训·损伤I | 1 | 为自身下场战斗添加1只底海滑动者，若各自行动阶段就达成完美作战，获得1资金 |
| `enemyeffect_12_2` | ENEMY_GAIN | 战术特训·损伤II | 2 | 为自身下场战斗添加1只炽焰源石虫，若各自行动阶段就达成完美作战，获得2资金 |
| `enemyeffect_12_3` | ENEMY_GAIN | 战术特训·损伤III | 3 | 为自身下场战斗添加1只灼藤，若各自行动阶段就达成完美作战，获得3资金 |
| `enemyeffect_12_4` | ENEMY_GAIN | 悬赏·损伤I | 1 | 为自身接下来两场作战添加1只底海滑动者，将其击倒者获得1资金 |
| `enemyeffect_12_5` | ENEMY_GAIN | 悬赏·损伤II | 2 | 为自身接下来两场作战添加1只控潮术师，将其击倒者获得2资金 |
| `enemyeffect_12_6` | ENEMY_GAIN | 悬赏·损伤III | 3 | 为自身接下来两场作战添加1只术师快艇，将其击倒者获得3资金 |
| `enemyeffect_13_1` | ENEMY_GAIN | 战术特训·持续I | 1 | 为自身下场战斗添加1只逐腐兽，若各自行动阶段就达成完美作战，获得1资金 |
| `enemyeffect_13_2` | ENEMY_GAIN | 战术特训·持续II | 2 | 为自身下场战斗添加1只萨卡兹枯朽战士组长，若各自行动阶段就达成完美作战，获得2资金 |
| `enemyeffect_13_3` | ENEMY_GAIN | 战术特训·持续III | 3 | 为自身下场战斗添加1只尖端萨卡兹枯朽战车，若各自行动阶段就达成完美作战，获得3资金 |
| `enemyeffect_13_4` | ENEMY_GAIN | 悬赏·持续I | 1 | 为自身接下来两场作战添加1只萨卡兹枯朽战士组长，将其击倒者获得1资金 |
| `enemyeffect_13_5` | ENEMY_GAIN | 悬赏·持续II | 2 | 为自身接下来两场作战添加1只逐腐兽，将其击倒者获得2资金 |
| `enemyeffect_13_6` | ENEMY_GAIN | 悬赏·持续III | 3 | 为自身接下来两场作战添加1只萨卡兹枯朽战车，将其击倒者获得3资金 |
| `enemyeffect_14_1` | ENEMY_GAIN | 战术特训·隐匿I | 1 | 为自身下场战斗添加1只隐形弩手，若各自行动阶段就达成完美作战，获得1资金 |
| `enemyeffect_14_2` | ENEMY_GAIN | 战术特训·隐匿II | 2 | 为自身下场战斗添加1只节日爵士乐手，若各自行动阶段就达成完美作战，获得2资金 |
| `enemyeffect_14_3` | ENEMY_GAIN | 战术特训·隐匿III | 3 | 为自身下场战斗添加1只家族灭迹人，若各自行动阶段就达成完美作战，获得3资金 |
| `enemyeffect_14_4` | ENEMY_GAIN | 悬赏·隐匿I | 1 | 为自身接下来两场作战添加1只隐形弩手，将其击倒者获得1资金 |
| `enemyeffect_14_5` | ENEMY_GAIN | 悬赏·隐匿II | 2 | 为自身接下来两场作战添加1只隐形术师，将其击倒者获得2资金 |
| `enemyeffect_14_6` | ENEMY_GAIN | 悬赏·隐匿III | 3 | 为自身接下来两场作战添加1只山海众头目，将其击倒者获得3资金 |
| `enemyeffect_15_1` | ENEMY_GAIN | 战术特训·折射I | 1 | 为自身下场战斗添加1只深池方阵战士，若各自行动阶段就达成完美作战，获得1资金 |
| `enemyeffect_15_2` | ENEMY_GAIN | 战术特训·折射II | 2 | 为自身下场战斗添加1只深池暗影术师队长，若各自行动阶段就达成完美作战，获得2资金 |
| `enemyeffect_15_3` | ENEMY_GAIN | 战术特训·折射III | 3 | 为自身下场战斗添加1只深池伙友卫队精英，若各自行动阶段就达成完美作战，获得3资金 |
| `enemyeffect_15_4` | ENEMY_GAIN | 悬赏·折射I | 1 | 为自身接下来两场作战添加1只深池方阵战士，将其击倒者获得1资金 |
| `enemyeffect_15_5` | ENEMY_GAIN | 悬赏·折射II | 2 | 为自身接下来两场作战添加1只深池暗影术师，将其击倒者获得2资金 |
| `enemyeffect_15_6` | ENEMY_GAIN | 悬赏·折射III | 3 | 为自身接下来两场作战添加1只深池伙友卫队，将其击倒者获得3资金 |
| `enemyeffect_16_1` | ENEMY_GAIN | 悬赏·特异III | 3 | 为自身下场战斗添加1只泥岩巨像，将其击倒者获得3资金 |
| `enemyeffect_16_2` | ENEMY_GAIN | 悬赏·特异III | 3 | 为自身下场战斗添加1只“越长尘”，将其击倒者获得3资金 |
| `enemyeffect_16_3` | ENEMY_GAIN | 悬赏·特异III | 3 | 为自身下场战斗添加1只狂暴宿主组长，将其击倒者获得3资金 |
| `enemyeffect_16_4` | ENEMY_GAIN | 悬赏·特异III | 3 | 为自身下场战斗添加1只温顺的武装大驮兽，将其击倒者获得3资金 |
| `enemyeffect_16_5` | ENEMY_GAIN | 悬赏·特异III | 3 | 为自身下场战斗添加1只萨卡兹骸骨拷打者，将其击倒者获得3资金 |
| `enemyeffect_16_6` | ENEMY_GAIN | 悬赏·特异III | 3 | 为自身下场战斗添加1只高准度伦蒂尼姆城防自行炮，将其击倒者获得3资金 |
| `enemyeffect_16_7` | ENEMY_GAIN | 悬赏·特异III | 3 | 为自身下场战斗添加1只乌顶巨角卢鲁，将其击倒者获得3资金 |
| `enemyeffect_16_8` | ENEMY_GAIN | 悬赏·特异III | 3 | 为自身下场战斗添加1只伊利昂的木驮兽，将其击倒者获得3资金 |
| `enemyeffect_16_9` | ENEMY_GAIN | 悬赏·特异II | 2 | 为自身下场战斗添加1只拥霜羽兽，将其击倒者获得2资金 |
| `enemyeffect_16_10` | ENEMY_GAIN | 悬赏·特异II | 2 | 为自身下场战斗添加1只异质裂兽·α，将其击倒者获得2资金 |
| `enemyeffect_16_11` | ENEMY_GAIN | 悬赏·损伤I | 1 | 为自身下场战斗添加1只心虚设计师，将其击倒者获得1资金 |
| `enemyeffect_16_12` | ENEMY_GAIN | 悬赏·特异I | 1 | 为自身下场战斗添加1只转译基底·α，将其击倒者获得1资金 |
| `enemyeffect_10_7` | ENEMY_GAIN | 悬赏·飞行I | 1 | 为自身下场战斗添加1只法术大师A2，将其击倒者获得1资金 |
| `enemyeffect_10_8` | ENEMY_GAIN | 悬赏·飞行II | 2 | 为自身下场战斗添加1只枯朽萃聚使徒，将其击倒者获得2资金 |
| `enemyeffect_11_7` | ENEMY_GAIN | 悬赏·频次I | 1 | 为自身下场战斗添加1只沏虹，将其击倒者获得1资金 |
| `enemyeffect_11_8` | ENEMY_GAIN | 悬赏·频次II | 2 | 为自身下场战斗添加1只新硎，将其击倒者获得2资金 |
| `enemyeffect_12_7` | ENEMY_GAIN | 悬赏·损伤II | 2 | 为自身下场战斗添加1只灼藤，将其击倒者获得2资金 |
| `enemyeffect_12_8` | ENEMY_GAIN | 悬赏·损伤II | 2 | 为自身下场战斗添加1只异光体孽生者，将其击倒者获得2资金 |
| `enemyeffect_13_7` | ENEMY_GAIN | 悬赏·持续I | 1 | 为自身下场战斗添加1只假想敌：蚀裂，将其击倒者获得1资金 |
| `enemyeffect_13_8` | ENEMY_GAIN | 悬赏·持续II | 2 | 为自身下场战斗添加1只尖端萨卡兹枯朽战车，将其击倒者获得2资金 |
| `enemyeffect_14_7` | ENEMY_GAIN | 悬赏·隐匿I | 1 | 为自身下场战斗添加1只重弩突袭者，将其击倒者获得1资金 |
| `enemyeffect_14_8` | ENEMY_GAIN | 悬赏·隐匿II | 2 | 为自身下场战斗添加1只家族暗影灭迹人，将其击倒者获得2资金 |
| `enemyeffect_15_7` | ENEMY_GAIN | 悬赏·折射II | 2 | 为自身下场战斗添加1只深池重甲卫士队长，将其击倒者获得2资金 |
| `enemyeffect_15_8` | ENEMY_GAIN | 悬赏·折射II | 2 | 为自身下场战斗添加1只愤怒的守墓石像，将其击倒者获得2资金 |
| `enemyeffect_17_1` | ENEMY_GAIN | 悬赏·特异I | 1 | 为自身接下来两场作战添加1只雪孩子，将其击倒者获得1资金 |
| `enemyeffect_17_2` | ENEMY_GAIN | 悬赏·特异I | 1 | 为自身接下来两场作战添加1只新手祭司学徒，将其击倒者获得1资金 |
| `enemyeffect_17_3` | ENEMY_GAIN | 悬赏·特异I | 1 | 为自身接下来两场作战添加1只冒失的小弟，将其击倒者获得1资金 |
| `enemyeffect_17_4` | ENEMY_GAIN | 悬赏·特异II | 2 | 为自身接下来两场作战添加1只骇笑看客，将其击倒者获得2资金 |
| `enemyeffect_17_5` | ENEMY_GAIN | 悬赏·特异II | 2 | 为自身接下来两场作战添加1只水遁忍者，将其击倒者获得2资金 |
| `enemyeffect_17_6` | ENEMY_GAIN | 悬赏·特异III | 3 | 为自身接下来两场作战添加1只自制投石机，将其击倒者获得3资金 |
| `enemyeffect_18_1` | ENEMY_GAIN | 悬赏·损伤I | 1 | 为自身接下来两场作战添加1只临时收音师，将其击倒者获得1资金 |
| `enemyeffect_18_2` | ENEMY_GAIN | 悬赏·特异I | 1 | 为自身接下来两场作战添加1只迷茫的修理小助手，将其击倒者获得1资金 |
| `enemyeffect_18_3` | ENEMY_GAIN | 悬赏·特异I | 1 | 为自身接下来两场作战添加1只高能源石虫，将其击倒者获得1资金 |
| `enemyeffect_18_4` | ENEMY_GAIN | 悬赏·特异II | 2 | 为自身接下来两场作战添加1只圣堂剑士，将其击倒者获得2资金 |
| `enemyeffect_18_5` | ENEMY_GAIN | 悬赏·特异II | 2 | 为自身接下来两场作战添加1只寻仇者，将其击倒者获得2资金 |
| `enemyeffect_18_6` | ENEMY_GAIN | 悬赏·损伤III | 3 | 为自身接下来两场作战添加1只主角阵营角色，将其击倒者获得3资金 |
| `enemyeffect_19_1` | ENEMY_GAIN | 悬赏·特异I | 1 | 为自身接下来两场作战添加1只节日气球，将其击倒者获得1资金 |
| `enemyeffect_19_2` | ENEMY_GAIN | 悬赏·特异I | 1 | 为自身接下来两场作战添加1只简饲源石虫，将其击倒者获得1资金 |
| `enemyeffect_19_3` | ENEMY_GAIN | 悬赏·折射I | 1 | 为自身接下来两场作战添加1只深池侦察犬pro，将其击倒者获得1资金 |
| `enemyeffect_19_4` | ENEMY_GAIN | 悬赏·飞行II | 2 | 为自身接下来两场作战添加1只吉兆飞鳞，将其击倒者获得2资金 |
| `enemyeffect_19_5` | ENEMY_GAIN | 悬赏·特异II | 2 | 为自身接下来两场作战添加1只咸鳞汁推荐者，将其击倒者获得2资金 |
| `enemyeffect_19_6` | ENEMY_GAIN | 悬赏·损伤III | 3 | 为自身接下来两场作战添加1只反派阵营角色，将其击倒者获得3资金 |
| `enemyeffect_20_1` | ENEMY_GAIN | 悬赏·持续I | 1 | 为自身接下来两场作战添加1只萨卡兹枯朽战士，将其击倒者获得1资金 |
| `enemyeffect_20_2` | ENEMY_GAIN | 悬赏·频次I | 1 | 为自身接下来两场作战添加1只俗心，将其击倒者获得1资金 |
| `enemyeffect_20_3` | ENEMY_GAIN | 悬赏·特异I | 1 | 为自身接下来两场作战添加1只潜伏者，将其击倒者获得1资金 |
| `enemyeffect_20_4` | ENEMY_GAIN | 悬赏·特异II | 2 | 为自身接下来两场作战添加1只“独轮车玩具”，将其击倒者获得2资金 |
| `enemyeffect_20_5` | ENEMY_GAIN | 悬赏·损伤II | 2 | 为自身接下来两场作战添加1只无胄盟清扫小队，将其击倒者获得2资金 |
| `enemyeffect_20_6` | ENEMY_GAIN | 悬赏·损伤III | 3 | 为自身接下来两场作战添加1只鼎沸，将其击倒者获得3资金 |

---

## Addendum (critic)

Written by the completeness critic on 2026-09-27, after cross-reading 01–07. New sources:
- PRTS `卫戍协议/帮助` and the raw wikitext of `卫戍协议：盟约_下半` §开始模拟.
- The raw wikitext of the BWIKI page `盟约` and of `盟约/S.W.E.E.P.报告`.
- The official gameplay-intro long image (`img.71acg.net/sykb~bbs/pc/1763033996225879`, 800×13685, in 10 slices).
- The TW/CN screenshots already listed in 06 §15.
- The official 3/27 notice (`ak.hypergryph.com/news/8584`).

Local copies are in `scratchpad/gd/extra/critic/` (`bw_盟约.txt`, `bw_sweep.txt`, `bw_卫戍协议_1.txt`, `intro_00..09.jpg`, screenshots). Tags: **[VERIFIED]** = from an official or wiki rule text or a screenshot. **[ASSUMED]** = still a proposal.

### A1. Corrections and confirmations to this file

| § | Was | Now | Tag |
|---|---|---|---|
| 0, 5.1 | income R1–R3 = 4/5/6 inferred. Cap 10. FUNNY +2 | **R1 = 4, R2 = 5, R3 = 6 confirmed by screenshots.** R1 = 4: official intro (标准, round 1, funds 4, board empty) and TW client R1. R2 = 5: TW R2, upgrade price 4. R3 = 6: official intro 标准 R3 and the co-op 道具补给 screenshot at R3. **FUNNY gets no bonus** (the official intro shows 4 at R1 in 标准). Cap still unknown: **recommend `income(r) = min(3 + r, 12)`**, because the predecessor 卫戍协议 (2024) used "从第2回合开始每回合获得资金数+1，上限12" and 盟约's upgrade prices (5/8/11/12/13) are one step above 2024's (5/6/8/11/12). Keep the cap in config (10 is the alternative). | VERIFIED R1–R3; cap ASSUMED |
| 4.1 | round-start auto refresh [ASSUMED] | Confirmed: "进入此阶段时，触发<进入休整期时>的效果，分配一定资金，刷新调度中心未被冻结的位置". Income is granted **before** the 机变 phase: funds are visible behind every 机变 overlay screenshot. | VERIFIED |
| 4.2 / 14 | freeze per slot [ASSUMED] | **One 冻结 button freezes ALL unsold slots**, operators and item: "【冻结】会将当前整备区的全部未售出栏位冻结，将其保留至下一回合。点击【解冻】可以解除该操作". The freeze is consumed at the next round start. In the official intro, frozen cards reappear in R3 and the button reads 冻结 again. A manual refresh is allowed while frozen (tip 4) and rerolls every slot, frozen ones included (2024 rule "重新调配包括冻结中的所有干员和道具"). Keep a per-slot `frozen` flag internally, because 梓兰 freezes one card. | VERIFIED |
| new | – | At **combat start, all unfrozen shop contents are cleared** ("进入作战期后，栏上若未处于冻结状态则清空全部物资"). | VERIFIED |
| 4.2 / 8 | bench 10 + temp area | **Hand (手牌区/整备区) = 10 regular + 5 temporary slots**, shared by operators, **items** and hand-deployable **summons**. Several summons of one owner stack into 1 slot; summons of different owners don't stack.<br>When the regular hand is full, every action that would add a card is refused: buy, and withdraw from the board. Exception: a purchase that completes a 3-merge nets −1 card, so allow it.<br>Passive gains (merge result, band/trait/item grants, items returned by promotion) overflow into the temp slots. **While temp is non-empty the player cannot start combat.** Temp is wiped when the next phase starts.<br>A board↔hand swap is allowed even with a full hand. Cards fill hand slots **right→left**. | VERIFIED |
| 5.2 | – | **Items cannot be sold** ("多余的装备无法进行出售，可以销毁"). They can only be destroyed for 0 funds. Operators sell for 1 from board or hand. | VERIFIED |
| 7 | promotion reward [COMM] | Confirmed (PRTS 帮助, BWIKI, official intro). On acquiring the 3rd copy:<br>1. The 3rd copy is not created, and the 2 owned copies are destroyed wherever they are.<br>2. **1 elite goes to the hand — or, when a consumed copy was deployed, to that copy's board position** (PRTS 帮助 "发送1名【精锐】状态的该干员至手牌区（若消耗已部署至作战区的干员，则发送至作战区对应位置）"; the user confirmed it first-hand after playtest #6 — this row used to read "not to a board tile", a misreading of the same sentence). Their equipment returns to the hand ("干员晋级后已配发装备会回收至整备区，需要重新配置"). [ASSUMED] where the text is silent: with two or three deployed copies the elite takes the tile of the one that deploys first (the left column first, top to bottom — the official deploy order, §4.3) with its facing; the copies' summons leave and the elite's own summon card joins the hand (§战斗部署 "如果部署的干员拥有可手动部署的附属召唤物，则该召唤物会立刻加入手牌区"); the deploy count never grows. A 突变细胞 carrier is destroyed before its new operator is gained (official footage, DESIGN §21.1), so a merge that operator completes never uses the carrier's tile.<br>3. The shop then temporarily shows **3 operators of tier min(shopLevel+1, 6) at price 0**. The official intro shows "II 0 ×3" after a tier-I merge at L1 and "III 0 ×3" at L2.<br>4. The player takes **1**. The offer cannot be refreshed or frozen and expires at round end. | VERIFIED (elite to the copy's board position: PRTS + the user); the tile among several deployed copies ASSUMED |
| 2 | BAND_CHECK "3 random + reroll" [ASSUMED] | **All unlocked bands are shown.** In co-op, players pick **one at a time in a random order** shown on the left ("以随机顺序进行策略轮选"). Each co-op player may **skip once**. The step lasts 50 s; on timeout the band is 华法琳. **Duplicates are allowed:** the official illustration shows 2 teammates' picks still un-greyed in the grid. [ASSUMED] 12 s per turn inside the 50 s step. | VERIFIED except the per-turn timer |
| 2 | banned bonds "1 core + 1 add-on" [ASSUMED] | Replaced by the verified rule in **A2**. | VERIFIED |
| 1, 12 | one ×0.7/×0.8 multiplier per mode; `aceffect_enemy_*` mapping [ASSUMED] | Replaced by the **per-round table in A3**. | VERIFIED (PRTS, user-sourced) |
| 4.3 | "automatic, paying DP" | At battle start **all board units deploy for free**, one by one in order: 下半 "从上到下>从左到右" — down each column, the columns left to right (§4.3); right-side players in the boss round are mirrored.<br>**DP starts at 10, +1/s, cap 99.** These are the round-level `options`. `initialCost` 0 in `m0X` is the terrain file, not the round level.<br>DP is only spent on **automatic redeploy**: the unit returns to its original tile when its respawn timer is done, the tile is free, and DP ≥ `cost`.<br>Precisely (PRTS 卫戍协议/帮助 §作战阶段 单位部署, checked after player report F5): the unit comes back on the tile where its 倒地干员 lies ("原地留下一个“倒地干员”…满足再部署条件时，移除场上的该倒地干员并自动部署至该位置"). That is its original tile unless it was moved off it (a 突袭 jump, 乌尔比安's anchor). No ally may deploy on that tile ("倒地干员所在地块视为可部署，但所有我方单位在此处的部署行为将被阻止"). One knocked out on another piece's initial position goes back to its own ("若干员被击倒的位置为其他干员或召唤物的初始位置，则在被击倒后，尝试返回其自身的初始位置").<br>Deploy effects do not fire during prep placement. Battle speed is forced to **2×**. | VERIFIED |
| 4.3 | leaked/timeout | When `maxPlayTime` ends, the battle stops. Every enemy not killed (still alive, or reached the goal) is "未击倒" and feeds 联防/LP. [ASSUMED] `maxPlayTime` is **game-time** seconds, so the client at 2× shows it ticking twice as fast. Last spawns land at 15/38/73 s against limits of 45/55/115 s, which leaves the time needed to kill walkers. | VERIFIED + ASSUMED unit |
| 3 | solo prep 300 s | 下半 solo has **no timer** on prep or 机变 ("休整期及机变阶段没有时间限制…24小时内随时返回"). Treat `normalPhaseTime` 300 and `specialPhaseTime` 150 as an optional "timed solo" setting. | VERIFIED |
| 4.4 | 联防 partner rule "fewest leaks" | Meaningless, because helpers are perfect by definition. There are **at most 2 helpers**: "所有防卫成功的玩家（最多2名）". Default choice: highest LP, then seat index [ASSUMED]. 1 helper uses `escaped_single` (8 units); 2 helpers use `escaped_multi` (20). | VERIFIED cap |
| 10 | Final Assault | Players are paired. **With an odd count the leftover player forms their own group** ("如有落单的玩家将单独成组") and uses the `_s` map.<br>**Movable bosses spawn one per alive player's side** and share the HP pool ("对于可移动的领袖敌人，将在每个存活玩家的一侧生成并行动").<br>**The boss HP pool is not affected by the A3 multipliers** ("领袖单位于服务器的生命值加成不受上述加成影响").<br>Overtime −1 LP/s starts at `bossTurnHpReduceTime` = 150 s. The level's 120 s `maxPlayTime` is not a hard stop in boss rounds: "计时结束后战斗仍然会继续".<br>Wave enemies that bring the merged LP to 0 end the match at once. | VERIFIED |
| 3 (table) | multi FUNNY = 14 rounds | Confirmed from data: **multi FUNNY has 14 rounds, no R15.** **Solo FUNNY has 9 rounds** (boss `h07_01_S` at R9). The 05 doc's "FUNNY has 9 rounds" applies to solo only. | VERIFIED |

### A2. Per-match disabled bonds and banned operators (VERIFIED)

**Rule.** At INFO_CHECK the server picks a disabled bond set `D`. **An operator is removed from the pool iff every one of its bonds is in `D`** (or in the mode's static `inactiveBondIdList`).

**Proof 1.** Screenshot `i.meee.com.tw/9H7Kugy.png` (终极, 下半, in-match dropdown "本局禁用干员情况") shows these banned counts per bond: 维多利亚 **7**, 阿戈尔 **6**, 谢拉格 **5**, 精准 **5**, 助力 **5**, 奥术 **4**, 奇迹 **3**. Take D = those 7 bonds and count the visible, non-DIY act2 chess whose `bondIds ⊆ D`. The result is exactly 7/6/5/5/5/4/3, over 25 operators. An exact match on 7 numbers cannot be coincidence.

**Proof 2.** The official intro (上半 标准) greys only 坚守. Its 本局禁用干员 list shows exactly the 2 chess whose only bond is 坚守 (tier I and tier V).

```
core   = bonds with autoChessData.bondInfoDict[b].isPower  (8)
addon  = other bonds with weight > 0                        (11; 投资人/调和/协防干员/绝技 have weight 0 → never disabled)
D      = weightedSample(core, Nc) ∪ weightedSample(addon, Na)       // all weights are 10 → uniform
banned = { visible non-DIY chess c : c.bondIds ≠ [] ∧ c.bondIds ⊆ (D ∪ mode.inactiveBondIdList) }  (+ their _b elites)
```

- **Nc/Na:**
  - Observed: 终极 3 core greyed in 2 separate matches, with 3 + 4 in the dropdown. 上半 标准: 0 + 1.
  - **Recommend NORMAL/HARD/ABYSS = 3 core + 4 add-on.** A simulation gives a mean of 22 banned operators (range 12–29).
  - **Recommend FUNNY = static list + 0 core + 1 add-on.** The static FUNNY list alone removes 27 operators.
  - Nc/Na for NORMAL/HARD are [ASSUMED].
- **Other bonds:** a disabled bond can still be activated through members that also carry a non-disabled bond, and through 变形同构体 items. The briefing marks such bonds with "部分盟约所含干员阵容不完整".
- **UI:** the briefing shows a core row and an add-on row (lit = complete, grey + badge = incomplete) plus a "本局禁用干员" portrait list. The in-match info dropdown shows per-bond banned counts.
- **DIY/support picks** may be affected ("禁用盟约有可能影响自选的支援干员"). In the remake, a DIY pick whose derived bond is in D is still allowed [ASSUMED].

### A3. Enemy HP/ATK multipliers by mode and round (replaces §1 table and the §12 mapping)

Source: PRTS `卫戍协议：盟约_下半` §开始模拟. PRTS flags it as user-provided, but it is the only per-round data available.

Formula: `atkMul = base × 1.1^k`, `hpMul = base × 1.2^k × extra`, using the same `k` for ATK and HP except where noted. DEF and RES are unchanged.

Each `k` is one stack of the data effect 攻坚装备 (ATK +10 %, HP +20 %, multiplicative). `base` 0.8 = 攻坚装备II. `base` 0.7 = 攻坚装备III: data says ATK ×0.7 / HP ×0.75, PRTS shows 0.7 for both. Use the data values. `extra` 1.08 = 补给线. **终极 (ABYSS): enemy move speed ×1.15 from round 3** (急行军). **Leader HP pools are excluded.**

| Mode | base | k for rounds 1…14 | hidden (R15) |
|---|---|---|---|
| solo 标准 FUNNY (9 rounds) | 0.7 | 0 ×9 | – |
| solo 险境 NORMAL | 0.7 | 0,0,0,1,1,1,1,2,2,2,3,4,5,5 | 5 [ASSUMED = R14] |
| solo 绝境 HARD | 0.8 | 0,0,0,0,1,1,1,1,2,2,3,3,4,4 | 4 |
| solo 终极 ABYSS | 1.0 | 1,2,2,2,2,3,3,3,3,4,5,5,6,7 | 7 |
| multi 标准 FUNNY | 0.8 | 0 ×11, then 1,1,1 | – |
| multi 险境 NORMAL | 0.8 | 0,1,1,2,2,2,2,3,4,4,5,6,7,7 | 7 [ASSUMED = R14] |
| multi 绝境 HARD | 1.0 | 1,2,2,3,3,3,3,3,4,5,6,6,7,8 | 8 |
| multi 终极 ABYSS, **ATK** | 1.0 | 1,2,2,3,3,4,5,5,5,5,6,6,7,8 | 8 |
| multi 终极 ABYSS, **HP** | 1.0 | 1,2,2,3,4,4\*,7,8,8,8,9,10,10\*,10\* (\* = ×1.08) | 10\* |

Machine-readable copy: `01-core-data.json → _criticAddendum.enemyStatMultipliers`.

### A4. 机变 (special draft) details

- **Timing:** it opens at the start of that round's prep, after income.
- **Multi:**
  - One **family** per SP round and 6 shared cards.
  - Pick order is random, not seat order (screenshots show out-of-seat order). Everyone takes exactly 1 card.
  - Timers: 30 s for the first picker, 16 s for the others. On timeout a random remaining card is auto-assigned.
- **Solo:** 3 cards, pick 1, no timer.
- **Family per SP round.** What is documented:
  - FUNNY never has bounties.
  - HARD+ R3 and R9 are bounties; R11 has no 战术决策 (PRTS/Bahamut).
  - Solo NORMAL: R6 = 道具补给, R9 = 战术决策 (PRTS note "5道具补给8战术决策").
  - Bahamut: 悬赏 is common, 战术决策 rare.

  Recommended defaults [ASSUMED where not listed above]:

  | Mode | SP rounds | Family |
  |---|---|---|
  | multi/solo HARD, ABYSS | 3, 9, 11 | R3 悬赏 (`enemy_initial_*`), R9 悬赏 (`bounty_hunter_*`/`bossInitial_*`), R11 道具补给 50 % / 机密商店 50 % |
  | multi NORMAL | 3, 6, 9 | weighted: 悬赏 50, 道具补给 25, 机密商店 10, 战术决策 15 |
  | solo NORMAL | 6, 9 | R6 道具补给, R9 战术决策 |
  | multi FUNNY | 3, 9 | 道具补给 45, 战术决策 35, 机密商店 20 |
- **Card contents, observed:**
  - 机密商店: 6 random equipment of **any tier I–VI**, duplicates allowed (screenshot: VI, III, V, I, V, I).
  - 道具补给: 6 random equipment. At R3 the observed tiers were II–IV, with a duplicate.
  - 悬赏: 6 bounty effects (coins 6/2/1/2/3/1).
  - 战术决策: a mix of `allybuff_select_*` (盟誓/列装/财富/补给…), `enemydebuff_select_*`, and the current stage's `terrain_*`.
  - [ASSUMED] 道具补给 tier windows: R3 I–IV, R6 II–V, R9 III–VI, R11 IV–VI. Solo draws 3 cards from the same pools.

### A5. Other resolved items
- The **华法琳** granted-trait cap should be **12 / 24 per battle**. The official 3/27 notice changed it and PRTS lists 7/14 → 12/24. The client data still shows 7/14, even though the other 3/27 changes (奇迹 18 %, 远见 80/150, 商业包装方案 8/7) are already in it. See 02.
- ~~The skill auto-cast rows with `skillIndex` 0 mean skill 1 only (BWIKI "重装职业干员 技能1，受到伤害后自动释放").~~ Superseded by user playtest #6 (DESIGN §20): the class rows apply to **every MANUAL skill** of the class and never to an AUTO skill (PRTS 卫戍协议/帮助 names whole classes; the 阵法术师 row must cover 薄绿's default S2, a phalanx that never attacks with its skill off); a MANUAL skill with its own 技能范围 (not an attack-range change) uses SKILL_RANGE; automatic operations have a 3 s cooldown. See 03 C1.
- Asset URLs: 40 random URLs from `07-assets.json` were re-checked on 2026-09-27; 40/40 returned `200`.
