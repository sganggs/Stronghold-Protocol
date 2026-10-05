# 06 · Multiplayer (同盟模拟 / 联合模拟) and in-game UI/UX flow

Scope: how the co-op mode of 卫戍协议：盟约 (season `act2autochess`, "盟约·下半"; 上半 = `act1autochess`) works, and what each screen looks like, so we can build a similar but original UI.

Legend:
- **[DATA]** read from the official game data (`activity_table.json`, `autoChessData`, `act2autochess`, level JSONs, `display_meta_table.json`).
- **[OFF]** from an official Hypergryph announcement or the official gameplay-intro long image.
- **[WIKI]** from BWIKI or PRTS (community wikis that copy in-game text).
- **[COMM]** from community guides, videos or screenshots.
- **[SHOT]** seen directly in a screenshot (URLs in §15).
- **[ASSUMED]** our proposal where nothing authoritative was found.

Rich-text tags such as `<@ba.vup>…</>` are stripped. Rules this doc shares with the core loop (economy, bonds, LP) are covered in `01-core-rules.md` and `05-enemies-levels.md`. This doc only restates what multiplayer needs.

---

## 0. TL;DR: the 20 facts the architect needs

1. **This is co-op, not PvP.** 1–4 players (a "同盟", alliance) fight AI waves. Each player has their **own board, bench, shop, funds, shop level, bonds and LP**. Nothing attacks another player. The only rivalry is indirect: the **shared operator pool** ("抢牌/卡牌") and bounty kills. [OFF][WIKI][COMM]
2. **Entry.** 独立模拟 (solo) or 同盟模拟 (co-op). Co-op has two ways in:
   - **联合模拟**: create a room and share a 同盟密钥 (room key), or join with a key or invite.
   - **搜寻队友**: matchmaking, either 精确搜寻 (similar trophy level) or 快速搜寻 (fastest).
   - Unticking 【房间未满4人时搜寻队友】 starts a room with fewer than 4 players. [OFF 5114][WIKI]
3. **Enemy scaling.** Every enemy's HP and ATK are ×0.70 in solo and ×0.80 in co-op. [WIKI PRTS 下半]
4. **Pre-game steps** (`enterStepList`) [DATA]:
   - `INFO_CHECK` "确认本局信息": 25 s, warning at 5 s. Players press 准备就绪; the screen shows "已就绪 x/4".
   - `BAND_CHECK` "选择策略": 50 s, warning at 15 s. A **draft in random order** shown on the left. In co-op each player may **skip once** ("联合模拟在选择策略时可以进行一次跳过"). On timeout 华法琳 (`band_bldsk`) is picked.
   - `BATTLE_CHECK` "协议启动": 3 s.
5. **Round loop (co-op):** [机变 draft on SP rounds] → 休整期 prep (timer, with ready/unready) → simultaneous auto-combat → 联防 unite phase if needed → LP loss → next round. **Round 14 = 最终攻势** (Final Assault). **Round 15 = 隐秘核心** (Hidden Core, optional). 标准 difficulty ends at round 14 with no hidden core.
6. **Co-op prep timer** (`turnInfoDataDict.normalPhaseTime`, seconds, rounds 1→15) [DATA]: `65,65,65,95,95,100,105,105,125,125,125,125,150,195,195`. Round 15 is `215` in 绝境 and 终极.
   - Solo was 300 s in 上半 and is **unlimited** in 下半, with pause, leave and resume allowed. [OFF 5114]
   - Combat time limit = the round level's `maxPlayTime`: `45,45,55,55,55,70,85,85,95,95,115,115,115,120,120`.
7. **Ready check.** "全体参与者就绪之前可随时取消准备，准备战斗后将无法进行操作". You can un-ready until everyone is ready. Combat starts when all players are ready or when the timer runs out. [DATA tip]
8. **机变阶段** (special draft phase), co-op:
   - Offers **6 cards**; each player **takes 1 in turn**, and a taken card is gone. 16 s per picker (`specialPhaseTime`=16), 30 s for the first picker. On timeout the pick is **auto-assigned**. [DATA][WIKI][SHOT]
   - Solo offers 3 cards and has no time limit in 下半.
   - It happens in the prep of rounds where `isSpPrepare`:
     - co-op 标准: rounds 3, 9
     - co-op 险境: rounds 3, 6, 9
     - co-op 绝境/终极: rounds 3, 9, 11

     That is, "after round 2/8", "2/5/8" and "2/8/10". [DATA]
9. **Team cards.** 战术决策 cards marked `icon_team_buff` give the effect **to the picker and to all teammates** ("若存在其他队友则他们也获得"). `icon_player_buff` cards are personal. [DATA]
10. **联防 (Unite / joint defense).** Runs when at least one player leaked and at least one player cleared perfectly (完美作战).
    - **Up to 2** perfect players move their operators, in their end-of-combat state, onto a temporary field (临时阵地) and fight **the union of all leaked enemies**.
    - Enemies that survive cost their **source** player LP, capped at **10 per round**.
    - Bond stacking is disabled during 联防.
    - A bounty target killed by a helper pays the helper. [WIKI][DATA][COMM]
11. **LP.** Each player's LP = their strategy's `totalHp` (20–45). Loss is capped at **10 per round** (`costPlayerHpLimit`=10). A player at 0 LP is **out**, and all their units go back to the shared pool at once. [DATA][COMM]
12. **Final Assault (round 14).**
    - All players' remaining LP **merge into one pool** (no cap).
    - Players are **paired 2 + 2 onto two merged battlefields**, each partner holding one half (left or right).
    - **Everyone damages the same boss HP pool**: some leaders spawn on both sides of a field and share HP.
    - After `bossTurnHpReduceTime`=150 s the pool loses **1 LP per second**.
    - "最终攻势中，两名参与者会处于同一个战场，但无法查看另一组队友的战场情况". [DATA][OFF][WIKI]
13. **Hidden Core (round 15, 险境+).**
    - Co-op: the sum of all players' activated bond stacks > **1200** and merged LP > 1.
    - Solo: > 350 and LP > 1.
    - In 上半 the thresholds were 1000 and 300.
    - Failing round 15 does not affect clear status or rewards. [WIKI PRTS 下半]
14. **Shared pool** (co-op): copies per operator name by tier I..VI = **12 / 14 / 18 / 16 / 8 / 5** (Muelsyse 4).
    - An elite occupies 3 copies. Shop-displayed cards don't count.
    - The shop can't roll an operator whose owned copies (all players' boards, benches and effects) have reached the cap.
    - Units of players who are eliminated or who quit return immediately. [COMM video BV1JWy3BkEpt/BV1ZTUjBaEyy]
15. **No free trading or gifting.** The only player-to-player transfers are item or strategy effects:
    - 信标 (Beacon, from 芬's strategy): sends the original operator to the teammate with the most members of that bond. This fires the broadcast "X博士给你赠送了{1}".
    - "神秘顾客" (鸭爵's strategy): passed to the next player.
    - Team buff cards. [DATA]
16. **Communication is emotes only.** There is no text chat.
    - `chatCD`=1 s between emotes; a bubble shows for `chatTime`=3 s.
    - Room emotes: 10. Battle emotes: 6 per theme. Themes: 卫戍 basic, basic_2, 源石虫, plus 3 paid April-Fools themes.
    - An auto **broadcast ticker** reports boss-damage %, big DPS, shop levels, elite promotions and gifts. [DATA]
17. **Disconnect / leave.**
    - Solo: leave anytime and resume within 24 h (`singleReconnectTime`=86400).
    - Co-op: the match continues. A "断线重连" button appears on the hub. Timers keep running and the missing player's choices auto-resolve (draft auto-assign, strategy default); their board keeps auto-fighting.
    - Quitting counts as a defeat: units return to the pool and the boss HP pool shrinks.
    - 模拟重载时间: ending a sim within 20 s of starting blocks the next start for a while (anti-abuse). [OFF][WIKI][SHOT][ASSUMED details]
18. **Trophies (奖杯), co-op only.** By rounds passed × difficulty (§10). Levels at 0 / 10 / 30 / 60 / 100 cumulative trophies (`medalDataList`). Trophy level feeds 精确搜寻 and is shown on name cards. [DATA][WIKI]
19. **Settlement per player.** Rounds passed, one **评语/title** out of 卫戍之星, 不朽盟约, 坚若磐石, 精英云集, 万事俱备, 挥金如土 (`playerTitleDataDict`), trophies, 卫戍认证 (tokens), 点赞 (like) and 举报 (report, 8 reasons, at most 3 reports). [DATA][WIKI]
20. **Visual language.**
    - Near-black green-grey panels with **mint/teal (#4ed8af / #35d8b4 / #59f4ca)** accents, gold price badges (#ffc600), red for danger and exit.
    - Seven-segment "COUNTDOWN" digits top-right; they go orange at ≤10 s.
    - Round mint bond discs, roman-numeral tier chips, a hexagon coin badge and a green "tower" LP icon.
    - A tilted 3D board with the shop as a bottom card bar. [DATA colors][SHOT]

---

## 1. Terminology (CN → proposed EN → data id)

| CN (in-game) | EN (ours) | Where / id |
|---|---|---|
| 独立模拟 | Solo Simulation | `modeType: SINGLE` |
| 同盟模拟 | Alliance / Co-op Simulation | `modeType: MULTI` |
| 联合模拟 | Private Alliance (room + key) | co-op sub-entry |
| 搜寻队友 (精确/快速) | Matchmaking (Precise / Quick) | co-op sub-entry |
| 同盟密钥 | Alliance Key (room code) | — |
| 入门协议 | Tutorial Protocol | `mode_training_1`, `modeType: LOCAL`. It runs with 3 NPC teammates (`trainingNpcList`). |
| 标准/险境/绝境/终极 模拟 | Standard / Perilous / Desperate / Ultimate | `FUNNY/NORMAL/HARD/ABYSS`; colors `f6a329 / e85a1a / e73118 / ff0024` |
| 确认本局信息 | Briefing | `INFO_CHECK` |
| 选择策略 / 策略 | Strategy (commander) | `BAND_CHECK`, `bandDataListDict` |
| 协议启动 | Protocol start | `BATTLE_CHECK` |
| 休整期 | Rest (prep) phase | `normalPhaseTime` |
| 机变阶段 | Contingency draft | `specialPhaseTime`, `isSpPrepare`, `effectChoiceInfoDict` |
| 作战期 / 各自行动阶段 | Combat / individual action phase | level `maxPlayTime` |
| 联防 / 联防阶段 | Unite (joint-defense) phase | `escapedBattleTemplateMap{Single,Multi}Player` |
| 完美作战 | Perfect clear | — |
| 目标生命值 | LP (target life) | `bandDataListDict.totalHp`, `costPlayerHpLimit` |
| 最终攻势 | Final Assault (round 14) | `isBossTurn`, `bossTurnHpReduceTime` |
| 隐秘核心 | Hidden Core (round "??" = 15) | `isHidingBoss` |
| 调度中心 | Dispatch Center (shop) | `shopLevelDataDict` |
| 整备区 / 临时整备区 | Standby area (bench, 10) / temp overflow (5) | `maxDeckChessCnt`=10 |
| 战场区 | Battlefield (max 8 units) | `maxBattleChessCnt`=8 |
| 冻结 / 解冻 | Freeze / Unfreeze (lock shop) | — |
| 刷新 | Refresh (reroll, 1 fund) | `shopRefreshPrice`=1 |
| 晋级 / 精锐 | Promote / Elite (3→1) | — |
| 奖杯 / 奖杯等级 | Trophies / Trophy level | `medalDataList` |
| 评语 | Commendation (title) | `playerTitleDataDict` |
| 卫戍认证 | Garrison Certificate (reward token) | `act2autochess_token_chess` |
| 交流 | Emote | `enabledEmoticonThemeIdList` |

---

## 2. Mode matrix

| | 独立模拟 (solo) | 同盟模拟 (co-op) |
|---|---|---|
| Players | 1 | 1–4. Normally 4; fewer if "房间未满4人时搜寻队友" is unticked. |
| Enemy HP/ATK factor | ×0.70 | ×0.80 |
| Prep timer | none (下半); 300 s (上半) | `normalPhaseTime` table (§4.2) |
| 机变 draft | 3 choose 1, no timer (data: 150 s in 上半) | 6 cards, 1 each in turn; 16 s each, 30 s first |
| SP rounds (`isSpPrepare`) | 标准 none (9-round mode); 险境 6, 9; 绝境/终极 3, 9, 11 | 标准 3, 9; 险境 3, 6, 9; 绝境/终极 3, 9, 11 |
| Rounds | 标准: 9 (boss on 9). Others: 14 + optional 15. | 标准: 14 (no 15). Others: 14 + optional 15. |
| 联防 | none | yes (§5) |
| Boss round | single field, all your lanes | pairs on merged fields, shared HP pool |
| Hidden core threshold | stacks > 350, LP > 1 | team stacks > 1200, merged LP > 1 |
| Pause / leave | yes, 24 h resume, 【放弃模拟】 to settle | no pause; reconnect via 断线重连 |
| Trophies | none ("只有在联合模拟中才能获得奖杯") | yes (§10) |
| Reward factor (`modeFactorInfo`) | ×1.25 (was ×1 before 11/18) | ×1.25 |
| Strategy unlock / mode unlock | Shared between solo and co-op in 下半 | Shared between solo and co-op in 下半 |

Mode unlocks (`preposedMode`) [DATA]:
- 标准 needs 入门协议.
- 险境 needs 标准 cleared (solo or co-op).
- 绝境 needs 险境 cleared.
- 终极 needs **2 clears** of 绝境.

"盟约数增加" means 标准 bans 10 bonds (`inactiveBondIdList`) and some enemies (`inactiveEnemyKey`).

---

## 3. Lobby, rooms and matchmaking

### 3.1 Hub → mode select [OFF intro image][SHOT]

- **Left column:** 成就统计 (stats), 报酬说明 (rewards info), 每日防卫目标 (daily 200 tokens → +300), 关键目标 (missions), 功勋兑换处 (milestone shop; 60 levels in `milestoneList`).
- **Right column:** S.W.E.E.P.报告 (codex), 物资调配处 (roster config), 模拟邀约 (pending invites).
- **Bottom-right mode buttons:**
  - `独立模拟`
  - a group labelled `同盟模拟` holding `联合模拟` and `搜寻队友`
- **Reconnect:** if you have a live co-op sim, the mode buttons are replaced by **【断线重连】**.
- **Tutorial:** 入门协议 is reachable bottom-left of the co-op screen and is forced on first entry.

### 3.2 联合模拟 (private room)

- **选择同盟方式** offers two options:
  - **【创建同盟】**
  - **输入同盟密钥 + 【加入同盟】** (join with a key)
- **Room screen** (one tall card per seat, 4 seats):
  - Each card shows the player's assistant (secretary) art, a `博士 #1234` tag, the trophy-level chess icon and a "…" emote button.
  - The creator's card is tagged **创建者**. A ready seat shows **☑ 已就绪**.
- **Header:**
  - a lifetime countdown, "13:29 后同盟将自动销毁". Rooms self-destruct after about 15 min idle [ASSUMED 15:00].
  - "当前延迟 11ms", the ping.
- **Footer:**
  - a pill `[快速搜寻 | ♜ 标准模拟]` showing search mode and difficulty (difficulty tinted in mode color).
  - "*同盟人数达标，准许进入模拟"
  - a big mint **准备就绪** button.
- **Rules:**
  - The creator can change difficulty and invite friends.
  - Invites have a 60 s cooldown per invite (`invitationSendCd`=60).
  - Unticking "房间未满4人时搜寻队友" lets the room start with fewer than 4. If it is ticked, the room fills the empty seats through matchmaking.

### 3.3 搜寻队友 (matchmaking)

- Pick difficulty on **选择模拟协议**:
  - Left: a gold hologram of the fortress/barge.
  - Right: stacked difficulty cards with "已选定" check or lock text such as "通关同盟模拟【标准模拟】后解锁".
- Pick the search mode from a dropdown, then press 【开始搜寻】:
  - **精确搜寻**: "更容易搜寻到实力相近的队友", matched by trophy level/count.
  - **快速搜寻**: "更快速地搜寻队友".
- Matching tips (`gameTipsList`, 21 tips, weight 50 each) rotate every 5 s (`matchingTipRotateInterval`).
- Matching timeout `matchTimeMax` = 120 s. What happens next is not documented. [ASSUMED] Offer "start with current members" or "keep searching"; in our build, fill with bots.

### 3.4 Ping display (`pingConds`) [DATA]

A pill next to the exit button shows `NNms`, colored by tier:
- `ping.low` for < 60 ms
- `ping.medium` for 60–199 ms
- `ping.high` for ≥ 200 ms

[ASSUMED] Colors mint / amber / red. Screenshots show the number in amber/orange at 58–85 ms.

### 3.5 Anti-abuse

- **模拟重载时间:** after starting a sim there are 20 s during which ending it blocks starting a new one immediately. [WIKI]
- Abandoning before the first prep phase gives no settlement plus a penalty wait (【等待模拟重载】). [WIKI]

---

## 4. Match flow in co-op (state machine)

```
LOBBY ─► MATCHED ─► INFO_CHECK(25s) ─► BAND_CHECK(50s draft) ─► BATTLE_CHECK(3s)
  └─► for round r = 1..14(15):
        [SP_DRAFT if isSpPrepare[r]]  (6 cards, sequential picks, 16s/30s)
        PREP(normalPhaseTime[r]) ── all ready? ──► COMBAT(maxPlayTime[r])  (all boards in parallel)
        COMBAT_END: each board is PERFECT or LEAKED (alive enemies at timeout count as leaked)
        if any LEAKED and any PERFECT: UNITE(联防) on temp field
        LP_LOSS per source player (cap 10); players at 0 LP → ELIMINATED
        r==14: FINAL_ASSAULT (merged LP, pairs, shared boss HP)
        r==15 only if hidden-core condition met (险境+)
  └─► SETTLEMENT (team page → personal page → rewards)
```

### 4.1 INFO_CHECK "1/2 确认本局信息" (25 s, hint 5 s) [DATA][SHOT]

Shows:
- the enemy leader (portrait, name, lore)
- up to 3 special enemy types (`specialEnemyNum`=3, e.g. 特训敌人·隐匿/飞行/折射)
- **核心盟约** row and **附加盟约** row of bond discs. Lit = active. Greyed with a badge = "部分盟约所含干员阵容不完整" (some of its operators won't appear).
- **本局禁用干员** (banned operators this match)

Footer: "已就绪 2/4" with 4 person pips, plus **准备就绪**. When everyone is ready or the timer ends, the draft starts.

### 4.2 BAND_CHECK "2/2 选择策略" (50 s, hint 15 s) [DATA][OFF][SHOT]

- **Left:** the seat list in **random draft order**. Each row: avatar, name#id, trophy badge, name-card art, and a state box:
  - `…` waiting
  - `⌛ 决策中` choosing
  - chosen strategy icon + 🔍 + ✓ when done
- **Right:** a 4-column grid of 40 strategy portraits (`bandDataListDict`) and a detail pane: portrait, **初始生命值 N**, name and effect. Bottom: **确认选择**.
- An orange rook badge on a portrait = cleared with that strategy 3 times (`victorCount`=3, the corner badge "角标").
- **One skip per player** in co-op: pass your turn and pick later. [DATA tip]
- Timeout → `band_bldsk` 华法琳.
- Unlock conditions come from `bandDataDict.unlockDesc`.
- Whether two players may pick the same strategy is not documented. [ASSUMED] **Allowed** (the community only talks about "宣示主权", declaring a bond to teammates, not about locks). A picked strategy shows the picker's avatar on its portrait.

### 4.3 Prep phase 休整期 (co-op timer) [DATA]

| Round | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Prep s (`normalPhaseTime`, multi) | 65 | 65 | 65 | 95 | 95 | 100 | 105 | 105 | 125 | 125 | 125 | 125 | 150 | 195 | 195 (绝境/终极: 215) |
| Combat s (level `maxPlayTime`) | 45 | 45 | 55 | 55 | 55 | 70 | 85 | 85 | 95 | 95 | 115 | 115 | 115 | 120 | 120 |
| Wave level | 01 | 02 | 03 | 04 | 05 | 06 | 07 | h01 | h02 | h03 | h04 | h05 | h06 | h07_0X | h08_0X |

- 标准 co-op ends at round 14 and has no 15.
- The **countdown turns orange** at ≤10 s (`hintTimeNormalPhase`/`FightPhase`/`SpecialPhase`/`DotPhase` = 10). [SHOT: "01" orange]
- PRTS gives a simplified "各轮次均有70秒的决策时间". Use the data table.
- A full 4-player match takes about 29 min of prep, 21 min of combat, plus 联防 and drafts ≈ **50–60 min**. That is a known community pain point ("燒時間條"). We should support a fast-timer preset.

Prep rules relevant to co-op [DATA tips][WIKI]:
- **Ready:** 准备就绪 toggles ready. "全体参与者就绪之前可随时取消准备，准备战斗后将无法进行操作". Once ready you cannot act, but you can still un-ready until everyone is ready.
- **Overflow:** "若非主动溢出，溢出的手牌会临时存放至整备区前方的5个空位上，直到溢出情况排除才可开始进行作战". Overflowed bench cards sit on 5 temp slots and **block readying**. They are destroyed at the next round ("处于临时整备区的调度资源，在进入下一回合后会自动销毁").
- **Scouting:** "休整期可以查看队友的战场情况" and "…查看当前回合即将迎击的敌方单位". Tap a teammate's avatar in the left list to view their board (read-only). The 🔍▶▶ button shows the enemy preview board.
- **Promotion reward:** the reward operator can't be refreshed or frozen and doesn't carry over.
- **Upgrade cost** drops by 1 each round until 0 [SHOT: 5 → 4 → 3 over rounds 1–3].

### 4.4 Special draft 机变阶段 (co-op) [DATA][WIKI][SHOT]

- **Header:** `悬赏决策 | 选定悬赏目标，获取额外奖励。` with the sub-line "倒计时结束后仍未选定将自动分配".
- **Right header:** "当前轮到你决策" when it's your turn, or "{name} 正在决策… ⌛", plus the countdown.
- **Grid:** 3×2 = **6 cards**. A taken card greys out and shows the taker's avatar badge in its top-right corner.
- **Left list:** ✓ = picked, `…` = picking, exit-door icon = player left.
- **Pick order:** it is **not** simply seat order; screenshots show out-of-seat order. [ASSUMED] Random per draft; alternatively lowest-LP-first as a catch-up rule.
- **Card families** (`effectChoiceInfoDict`, `choiceType` / name / text color `#35d8b4`, or `#f2bd3e` for the "_s" special variant):

| choiceType | Name | Contents (see `04-items.md` / `05-enemies-levels.md`) |
|---|---|---|
| `BOUNTY_HUNT` | 悬赏决策 | Adds an enemy to *your* next combat. "将其击倒者获得N资金": the killer, including a 联防 helper, gets the funds. Multi-round 假想敌: "击倒它的你或队友获得1资金". 战术特训 variants: "若各自行动阶段就达成完美作战，获得N资金" (perfect in your own phase, not via 联防). |
| `EQUIP_FREE` | 道具补给 / 机密商店 | Free equipment (tier chip I–VI on card). |
| `BUFF_SELECT` | 战术决策 | `icon_team_buff`: you **and every teammate** get it (列装, the 8 "…的盟誓" +8/10/12 stacks, 财富 +1 fund, 补给 2 free refreshes, 自愈, 火力, 征召, 无瑕, 锐利). `icon_player_buff`: only you (整备, 升华, 7×"盟约驰援"). |
| `PERSONAL_CHOOSE` | 悬赏决策 (hunter strategy) | Personal-only variant. |

- The terrain cards (`terrain_m0X`, "模拟战场演变") change the map. [ASSUMED] They apply to the **picker's own board**.

### 4.5 Combat (各自行动阶段)

- All boards fight **at the same time** on the server. The client camera switches to the battle view. [SHOT]
- 2× speed. No manual control and no pause in co-op.
- **HUD center capsule:** `killed/total` (e.g. `4/9`), orange-bordered.
- **Right edge:** a DP counter `⊂ 71`. DP starts at 10, gains +1 per second (`costIncreaseTime`=1) and caps at 99. Redeploys cost DP.
- **When your board finishes:** the bottom bar reads **"⌛ 作战结束，等待队友完成作战"**. A bottom view switcher `‹ 自己 ›` cycles through teammates' live battles; you watch, you don't control.
- **Result per board:** PERFECT (all enemies dead) or LEAKED (enemies reached the goal, or were alive at timeout).
  - [ASSUMED] Enemies that reach the protection point during combat are removed from your board and **queued as "leaked"** for 联防. They are **not** charged immediately. Charging happens after 联防.

---

## 5. 联防 Unite phase: exact rules and our implementation

Rules as published [WIKI BWIKI/PRTS][DATA tips][COMM]:
1. **Trigger:** at least one player leaked and at least one player is PERFECT. Only perfect players may help ("只有达成完美作战的队友可以进行联防").
2. **Helpers:** 1 or 2 perfect players ("达成完美作战的玩家（最多2名）将迎战所有突破了防线的敌人"). PRTS: "1~2名完美作战玩家的阵地以其当前状态，迎接所有非完美作战玩家未能击杀的敌人的集合".
3. **State carried over:** helpers' operators keep their **HP ratio, SP and deployment positions** from the end of their own combat and are moved to a **临时阵地**.
4. **Enemies:** the helpers face the **union** of all non-perfect players' leaked enemies.
5. **No stacking:** 【盟约】 stacking is disabled ("进行联防时，盟约不会继续叠加"; <战斗中> triggers don't fire). The HUD shows the bond row with the tooltip **"层数叠加已禁用"**. [SHOT]
6. **LP:** enemies still alive when 联防 ends deduct LP from **their source player**. The cap is 10 per player per round. A fully successful 联防 means the owner loses nothing.
7. **Bounties:** a bounty or 假想敌 carries its reward to whoever kills it, so a helper can collect a teammate's bounty. Band 鸭爵: "…击倒这些敌人者获得1资金（包括联防阶段）".

Data behind it [DATA]:
- The template maps are `level_act1autochess_escaped_single` (characterLimit 8) and `level_act1autochess_escaped_multi` (characterLimit 20). They share one 21×19 geometry: two lanes (left and right halves), a start at the right edge (row 9, col 18) and the goal at the left (row 9, col 2).
- Waves are **placeholders**: 5 × each of 8 template enemies (`templateEnemyNormal/Elite/Special(+Fly)/Token(+Fly)` in `autoChessData.constData`), spawned at 3/10/17 s on routes 0–7. The server swaps in the real leaked enemies by category.
- `maxPlayTime` = 1.0 is a placeholder, overridden at runtime.
- **[ASSUMED interpretation]** `escaped_single` is used with 1 helper and `escaped_multi` with 2 helpers (8+8 operators, plus summons, fit in 20).

What is not published, and what we propose [ASSUMED]:

| Question | Proposal |
|---|---|
| Which 2 helpers if 3 are perfect? | The two with the **most remaining LP**, ties broken by seat index. Alternative: random. Show "联防: A、B" in the banner. |
| Where do helpers stand? | Helper 1 keeps their layout on the **left half**, helper 2 on the **right half**. The single-helper map uses the left half. |
| Timer | Same as that round's combat `maxPlayTime`. [SHOT: countdown 64 during a round-12 联防, consistent with 115 s] |
| Spawn order | Group leaked enemies by type, spawn in 3 staggered batches (t = 3/10/17 s). Keep `sourcePlayerId` on each enemy. |
| What non-helpers do | Watch. The view switcher auto-focuses the 联防 field. Banner "联防阶段" (orange). The owners' LP counters tick down live as enemies escape. |
| Enemy stats | Unchanged from the source board's round/difficulty. |
| Helper operator death | Counts only for 联防. Helper boards reset normally for the next round. |

Visual [SHOT]: the banner is a dark strip with orange chevrons and orange-skull icons reading **联防阶段**. The top capsule shows the kill counter `1/4` and the round `回合 12`.

---

## 6. What is shared vs individual

| Element | Per player | Shared by the team |
|---|---|---|
| Board (8 deploy slots), bench (10 + 5 overflow), shop and shop level, funds, freeze state | ✔ | |
| Strategy (band) and its LP pool (`totalHp`) | ✔ (merged at round 14) | ✔ from the Final Assault on |
| Bonds and stacks | ✔ | Hidden-core check uses the **team sum** |
| Enemy waves per round | Same round template for everyone [ASSUMED same seed and composition]. Per-player additions from bounties/特训 are "为自身下场作战添加". | Special-enemy types and boss are the same for the whole match (briefing) |
| Operator pool (copies per name) | | ✔ (§7) |
| Leaked enemies → 联防 | | ✔ helpers fight them |
| Boss HP | | ✔ one pool across both boss fields |
| 机变 card set | | ✔ one 6-card pool, each takes 1 |
| Team-buff cards | | ✔ picker + teammates |
| Timers, ready gate | | ✔ everyone waits for the slowest (prep ends when all ready or timer) |
| Rewards / trophies | ✔ (own rounds passed) | Team result affects rounds passed |

---

## 7. Shared operator pool (co-op) [COMM, tested by players]

- **Copies per operator name:**

  | Tier | I | II | III | IV | V | VI |
  |---|---|---|---|---|---|---|
  | Copies | 12 | 14 | 18 | 16 | 8 | 5 |

  Exception: 缪尔赛思 (Muelsyse) has 4.
- A **normal** unit uses 1 copy and an **elite** uses 3.
- **Counted:** units on every player's battlefield, bench and temp bench, from any source (buy, reward, strategy effect, 拟态/copy effects).
- **Not counted:** cards currently displayed in any shop.
- When owned copies ≥ the cap, a refresh can't roll that name. Some effects fail when the cap is hit (杜遥夜's search; possibly 拟态物质 or 煌's sell effect).
- Selling (1 fund per bench unit) returns copies. A player's **defeat or quit returns all their copies immediately**.
- The server must own the pool (authoritative) and update it in real time for everyone.

---

## 8. Cross-player interactions (complete list found)

1. **Team buffs** from 战术决策 (§4.4).
2. **Bounties via 联防:** helpers can kill another player's bounty and take the funds.
3. **信标 Beacon.** Item `eff_acarm109` (normal) / `eff_acgarm109` (advanced); strategy 芬 【协力共进】 grants one on rounds 8, 10, 12 and 14.
   - Equipping it destroys the carrier and the Beacon.
   - You get a special refresh with 2 operators of the same tier and take 1 free.
   - "若在同盟模拟中且存在其他队友，下个休整期向相应盟约人数最多的队友发送1个原干员；相应盟约人数相同则随机发送；无法装备给自编干员".
   - The receiver sees the broadcast "{0}博士给你赠送了{1}" (`CHAR_GIFT`, priority 1).
4. **"神秘顾客".** Strategy 鸭爵 (`eff_acdisney`): "拖拽至场上使用后，选择一项特殊悬赏任务进行挑战；主动销毁时获得1份资金，并将"神秘顾客"传递给下一名玩家". From round 5, "你和队友遭遇的部分敌人可能会替换为<鸭爵><高普尼克><流泪小子><圆仔>".
5. **Touch** 【外勤医疗】: "所有玩家场地上出现一名<预备干员-医疗>", which affects all players.
6. **Shared boss field (round 14/15):** partners' debuffs on the boss (e.g. 奥术 magic vulnerability) help each other. The community notes they don't stack: the higher value wins ("共享型buff會跟對面搶").
7. **Emotes** and the broadcast ticker (§9).
8. **No direct trading, gifting, lending of funds, or item passing.** "Giving back" in guides just means not buying, or selling so the copy returns to the pool.

**PvP:** none. There is no versus mode in 盟约 (上 or 下). Competition is only over the shared pool and the post-match comparisons (titles, likes, damage broadcasts). An older, unrelated mode `ENEMY_DUEL` exists elsewhere in the game.

---

## 9. Communication, broadcasts, reporting

### 9.1 Emotes [DATA display_meta_table][WIKI]

- **Where:** bottom-left **【交流】** button with a robot-face icon. It opens a panel of 6 (battle) or 10 (room) emotes; swipe left/right to switch theme.
- **Display:** a bubble near the sender's avatar in the left player list, and over their board [ASSUMED] for `chatTime`=3 s.
- **Cooldown:** `chatCD`=1 s.
- **Enabled themes** (`enabledEmoticonThemeIdList`): `emoticon_autochess_basic`, `emoticon_originium_slug`, `emoticon_autochess_basic_2`, and the paid `emoticon_foolsday_doctor/_amiya/_wisdel`.
- **Room scene** (`AUTOCHESS_ROOM`, basic theme), picIds:
  - hello, thanks, happy, question, sorry
  - scared, thinking, waiting, nice_cooperate, working
- **Battle scene** (`AUTOCHESS_BATTLE`):
  - basic: happy, scared, sorry, thanks, thinking, nice_cooperate
  - basic_2 (下半): **没问题！ 敬礼！ 欢呼！ 酷！ 伤心 快死了**
  - 源石虫 theme: 合作愉快！ 谢谢！ 对不起！ 再见！ ？？？ 很快就好！
- Look: an **octagonal mint glyph face** on a dark tile. Our emote art must be original.

### 9.2 Broadcast ticker (`autoChessData.broadcastList`) [DATA]

A scrolling banner. The highest priority wins. It starts `broadcastBeginDelay`=1 s after the trigger.

| id | priority | Text (player name highlighted) | Trigger |
|---|---|---|---|
| comment_boss_hit_1/2/3 | 30 | {0}博士对敌方领袖造成的伤害超过20% / 50% / 80%! | player's share of the boss pool |
| comment_char_damage_1/2/3 | 20 | {0}博士的{1}干员造成的伤害量达到{2} | 200,000 / 500,000 / 1,000,000 |
| comment_shop_level_1..5 | 11 | {0}博士将调度中心等级提升为{1}级 | shop level 2..6 |
| comment_bond_effect | 10 | 叠加层数 | stack milestone [ASSUMED] |
| comment_golden_char | 2 | {0}博士的{1}干员晋升为精锐 | promotion |
| comment_char_gift | 1 | {0}博士给你赠送了{1} | Beacon transfer |

### 9.3 Like / report at settlement [DATA]

- 点赞 (like) teammates.
- 举报 (report), at most 3 reports (`reportMaxNum`). Reasons:
  - 消极游戏: 挂机、不作为等消极行为
  - 故意捣乱: 阻碍其他玩家游戏
  - 中途退出: 游戏过程中离开
  - 不当言论: 使用了不恰当的名称或签名
  - 骚扰: 进行令人不快的行为
  - 作弊: 使用非常规手段进行游戏
  - 脚本: 利用第三方工具刷取奖励
  - 其他: 其他举报原因

---

## 10. Final Assault, Hidden Core, elimination, settlement

### 10.1 Final Assault (round 14) [DATA][OFF][WIKI][SHOT]

- **Merged LP:** at the start, `teamLP = Σ remaining LP of alive players`. The HUD shows a single tower-LP number, e.g. `13`.
- **Pairing:** "博士们将被两两分组，每一组都会进入一个合并场地". Level maps `h07_0X`/`h08_0X`: a 21×19 field whose boss spawns in the middle (row 3, col 10) and whose ends are at the left (col 2–3) and right (col 17). Solo uses `…_s` maps with all routes going left.
  - [ASSUMED] With 4 players: seats (1,2) and (3,4). With 3: a pair plus a single on an `_s`-style map. With 2: one pair.
  - The left/right player assignment mirrors taunt/deploy priority for the right-side player ("你的最左邊是你的最右邊").
- **Each player** redeploys their own lineup onto their half. The camera has left/right/`全景` (panorama) views (`‹ 全景 ›` switcher).
- **Boss HP:** one pool per match (`act2autochess.bossInfoDict.bloodPoint*`):

  | Boss | Enemy id | Standard | 险境 | 绝境 | 终极 | Hidden? | Weight |
  |---|---|---|---|---|---|---|---|
  | boss_1 | enemy_9013_acstmk | 247,500 | 675,000 | 1,800,000 | 3,600,000 | no | 6 |
  | boss_2 | enemy_9017_achunt | 225,000 | 400,000 | 800,000 | 3,000,000 | no | 6 |
  | boss_3 | enemy_9021_acduml | 285,000 | 708,750 | 2,000,000 | 4,000,000 | no | 6 |
  | boss_4 | enemy_1521_dslily | 307,500 | 708,750 | 2,100,000 | 4,200,000 | no | 5 |
  | boss_5 | enemy_2016_csphtm | 200,000 | 390,000 | 780,000 | 3,000,000 | no | 10 |
  | boss_6 | enemy_9032_aclionk | 285,000 | 705,000 | 1,990,000 | 3,980,000 | no | 5 |
  | boss_7 | enemy_9033_acdeer | 277,500 | 787,500 | 2,000,000 | 4,000,000 | no | 5 |
  | boss_8 | enemy_9013_acstmk_2 | 750,000 | 937,500 | 3,600,000 | 7,200,000 | **yes** | 50 |
  | boss_9 | enemy_9017_achunt_2 | 675,000 | 900,000 | 2,800,000 | 3,950,000 | **yes** | 40 |
  | boss_10 | enemy_9021_acduml_2 | 825,000 | 1,012,500 | 3,800,000 | 7,600,000 | **yes** | 40 |

  - "部分敌方领袖会同时出现在战场的左右两侧，两侧的敌方领袖共享生命值（敌方领袖的总生命值不变）". Both fields and both sides drain the same pool.
  - The community reports fewer surviving players mean a smaller boss bar. [ASSUMED] `bossHP = bloodPoint × aliveAtRound14 / 4`, floored at 1/4.
- **Boss immunity:** the boss takes no 侵蚀 (erosion) damage ("最终攻势中，敌方领袖不会受到侵蚀损伤").
- **No stacking:** <战斗中> stacking is disabled in the boss fight. [COMM]
- **Overtime:** after `bossTurnHpReduceTime` = 150 s, the team LP drains 1/s.
  - [ASSUMED] Minions that reach a goal also cost team LP (per-enemy LP cost; 2 for bosses per `lifePointReduce`), with no 10 cap.
  - Team LP 0 → defeat.
  - Boss dead → victory.
- **Broadcasts:** at 20/50/80 % of total boss HP dealt by one player.
- **Laggy clients:** the community notes "網速不好/幀率過低可能會導致boss戰傷害丟失". Our server-authoritative sim avoids this.

### 10.2 Hidden Core (round "??" = 15) [WIKI PRTS 下半][DATA]

- **Condition (险境/绝境/终极 only):**
  - co-op: Σ over all players of activated bond stacks > 1200, and merged LP > 1
  - solo: > 350 and LP > 1
- Enemies are "被源石所侵蚀" upgraded 假想敌 (boss_8..10).
- Failing doesn't change clear status or 卫戍认证.
- Clearing it gives extra trophies (§10.4) and a special notice.
- Timer: prep 195 s (215 s in 绝境/终极), combat 120 s.

### 10.3 Elimination and leaving [COMM][WIKI][SHOT]

- **Elimination:** a player at 0 LP before round 14 is eliminated ("战败"). Their units return to the pool and the boss pool shrinks.
- [ASSUMED] Eliminated players may stay and spectate (view switcher) or leave. Their settlement uses the rounds they passed.
- **Quitting** (中途退出) is treated the same, plus it can be reported.
  - The left-list avatar becomes a red "exit door" icon. [SHOT Mb2mtd9]
  - Two grey robot "x-eyes" placeholders are seen in a boss screenshot. [ASSUMED] They mean dead or left seats.
- **Disconnection** (not a quit):
  - Official text: "若博士在模拟的作战回合中不慎失去神经同步，可以在一段时间内通过活动主页重新返回作战". The hub shows 【断线重连】. In-game error text: "神经网络连接丢失，请重新连接(错误号:400)".
  - [ASSUMED] Meanwhile the player's board keeps its last lineup and auto-fights. Prep timers expire with no purchases, drafts auto-assign, and the strategy defaults to 华法琳 if disconnected before the draft.

### 10.4 Trophies (co-op only) [WIKI PRTS 下半 + BWIKI table]

| Rounds passed | 标准 | 险境 | 绝境 | 终极 |
|---|---|---|---|---|
| 0–4 | 0 | 0 | 0 | 0 |
| 5–8 | 1 | 1 | 1 | 1 |
| 9–11 | 2 | 2 | 2 | 2 |
| 12–13 | 2 | 3 | 3 | 3 |
| 14 (成功卫戍) | 3 | 4 | 5 | 6 |
| ?? (隐秘核心 cleared) | — | 5 | 7 | 8 |

Trophy level (`medalDataList`): Lv1 at 0, Lv2 at 10, Lv3 at 30, Lv4 at 60, Lv5 at 100 cumulative, with icons `trophy_level1..5_icon`. The art is chess pieces, rook → king, in bronze/silver/gold. The trophy level is shown in rooms, in the strategy draft and on the result card, and is used by 精确搜寻.

`roundScoreDataList` (round → 0,10,20,30,50,70,90,110,130,150,170,200,230,260,300) is a per-round score. [ASSUMED] It is a hidden MMR/"实力" input for 精确搜寻.

### 10.5 Commendations 评语 (`playerTitleDataDict`) [DATA; criteria ASSUMED]

The six titles, with our proposed award rules. The official conditions are unpublished.

| id | Title | Our rule |
|---|---|---|
| comment_1 | **卫戍之星** (Star of the Garrison) | Highest damage to the enemy leader. Only on a win. |
| comment_2 | **不朽盟约** | Highest total activated bond stacks. |
| comment_3 | **坚若磐石** | Least LP lost / most LP remaining. |
| comment_4 | **精英云集** | Most promotions to elite (晋级次数). |
| comment_5 | **万事俱备** | Most equipment fitted / merged [ASSUMED]. |
| comment_6 | **挥金如土** | Most funds spent. |

Evidence:
- A 176-game co-op player shows the six counts 20 / 32 / 25 / 26 / 29 / 19 (sum 151 ≈ 0.86 per game). This suggests **each player receives at most one title per match**: the category where they rank best relative to teammates, each title used at most once per match. [ASSUMED]
- 卫戍之星 is visibly rarer (about 25 % of wins for a strong player).
- The web stats page tracks exactly: 盟约最高叠加数, 单局最多消耗资金, 单局最多晋级次数, 单局最多击败数. This supports the mapping.

### 10.6 Settlement screens [WIKI][SHOT]

1. **Team summary:** "展示同盟的通过回合数，本局耗时和完成日期。同时会显示每个玩家的通过回合数及其获得评语". Each row gets like and report buttons. [layout ASSUMED]
2. **Personal page** [SHOT rZEmfyJ]:
   - **Top left:** STRONGHOLD PROTOCOL logo, the difficulty tag (red "绝境模拟") and a big mint headline **模拟完成** (or failure text). "通过回合 **15**" in huge numerals. Boss medallions with ✓ (round-14 boss and hidden-core boss).
   - **Player card:** avatar, `Dr.name#1234`, trophy-level badge with total (e.g. 180), "获得奖杯 **7**".
   - **Right:** the final lineup as tier-chipped portrait cards. Empty slots read "NO INFO". Below it, a bond row with stacks (359 / 136 / 34 …).
   - **Bottom bar:** "获得卫戍认证! **+425** 常规获得 **+300** 每日防卫目标", then "LV. 38 LEVEL UP! 125/200" (milestone progress bar), then **下一步**.
   - **Background:** a dark topographic Terra map with a glowing orange "TARGET POINT".
3. **Rewards:** tokens = `baseReward[roundsPassed] × difficultyFactor × modeFactor`.
   - Base per round 1..14 (`baseRewardDataList`): 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 120, 140, 160, 200.
   - Difficulty (`difficultyFactorInfo`): FUNNY 1.0, NORMAL 1.6, HARD 1.7, ABYSS 1.7.
   - Mode: ×1.25.
   - Check: 200 × 1.7 × 1.25 = **425** ✓ (matches the screenshot).
   - The daily target is 200 tokens → +300 bonus.
4. **Stats web page** (`ak-webview…/autoChess/act1autochess`):
   - totals for solo and co-op: 总模拟数, 成功卫戍, 绝境突破
   - a **hexagon radar** of the 6 titles
   - 已获奖杯, 已获赞
   - best stacks, most funds spent, most promotions, most kills
   - top-3 bonds and strategies, and the badged strategies

---

## 11. UI layout of each screen (reference 1920×1080 landscape, from screenshots)

Coordinates are approximate fractions of a 16:9 screen. Everything is our own art; only the layout idea is borrowed.

### 11.1 Global chrome (all in-match screens)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│[⇦]58ms   [🔍] 回合 [ 3 ]  (  ⌂ 休息一下  )  ♜ 27  [🔍▶▶]              ┃59┃≡ │
│ exit+ping   info   round    phase / kill capsule   LP   enemy preview   COUNTDOWN│
│            (◉3 灵巧)(◉0 迅捷)(◉ 精准)(◉ 助力)   ← active-bond strip   [☑ 准备就绪]│
│┌──┐                                                                           │
││P1│ ♜24 …   ← player list: avatar, LP, state (…/✓/⌛/door)                    │
││P2│ ♜24 ✓                                                                     │
││P3│ ♜23                                                                        │
││Me│ ♜27  (green person badge = you)                                          │
│└──┘                                                                           │
│ [☺ 交流]                                                         bottom-left │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Exit:** top-left 64 px dark-red square, white "door-arrow" glyph. Asks for confirmation. In co-op it offers 暂离 or 放弃.
- **Ping:** pill at about x = 4–7 %. Amber number + "ms".
- **Top HUD:** a thin dark bar with bracket frames `[ ]`, centered at about x = 25–75 %, y = 2–6 %. Small techno micro-labels ("RHODES ISLAND STATION SERVICE").
  - The **center capsule** has a mint outline in prep and shows a phase label (e.g. "休息一下").
  - In combat and 联防 it has an orange outline and shows `killed/total`.
  - In the boss round it shows `killed/total` plus an orange boss HP bar with a boss glyph.
- **Round box:** "回合" + a white box number.
- **LP:** green rook-tower icon + number.
- **Enemy-preview button:** amber bracket frame `[🔍 ▶▶]`. It swaps the view to the enemy staging board (a separate tiled grid showing this round's enemies standing in formation). The same frame shows `[🔍 ◀◀]` to go back.
- **Countdown:** top-right, 7-segment digits about 90 px tall, mint (#5fe3b0-ish).
  - "COUNTDOWN" microtext underneath.
  - A vertical 5-bar gauge to the right that empties with time.
  - Orange at ≤10 s.
- **准备就绪:** dark button with mint border and checkbox, under the countdown. When checked it fills mint.
- **Bond strip:** round mint discs (about 56 px) with a black glyph and an outer segmented ring.
  - The stack count sits over the bottom of the disc and the name below.
  - Sorted by stacks descending, left → right.
  - Grey disc = present but not active.
  - Tap → detail popup (thresholds and current effect).
- **Player list:** left edge, x ≈ 1–5 %, y ≈ 25–70 %. 4 square portraits (about 90 px) in dark frames with a green LP number.
  - Status glyph to the right: `…` acting / not ready, ✓ ready or picked, ⌛ deciding, red door = left.
  - Tap → view that player's board (read-only).
  - Emote bubbles pop next to it.

### 11.2 Prep phase (休整期) [SHOT c32edaf / 4995084 / a7a712ab]

```
 (board: tilted 3D grid, ~60 % of the screen, centered-left; enemy spawn = red wire-cube on the right,
  protect point = blue wire-cube with ⚠ on the left; operators show a tier chip "I" above their heads)
 wooden bench strip (10 pads) directly under the board = 整备区; +5 temp pads in front when overflowing
                                                             剩余可放置角色: 6   ← right, above buttons
                                                   [❄ 冻结]  [⟳ 刷新 (1)]      ← light-blue / amber
 ┌────────┬───────────┬───────────┬───────────┬──(item)──┬──────────────┐
 │ (4)    │ I   (2)   │ I   (2)   │ I   (2)   │          │   ◆◆◆ 5      │
 │ LEVEL  │  [art]    │  [art]    │  [art]    │          │   目前资金   │
 │   1    │ ⚙炎       │ ⚙助力     │ ⚙精准     │          │   ✕ 收起     │
 │ 升级   │ ⚔ 惊蛰    │ ⚔ 暴行    │ ⚔ 跃跃    │          │              │
 └────────┴───────────┴───────────┴───────────┴──────────┴──────────────┘
   bottom shop bar ≈ x 38 %→98 %, y 74 %→97 %
```

- **Level card:** mint-filled card with "LEVEL" + a big number in a bracket frame and the label 升级. The upgrade cost is a hexagon badge on top. It greys out when you can't afford it.
- **Operator card:** dark card, teal 1 px border.
  - Top-left: tier chip (I–VI, white on black; gold border for V/VI [ASSUMED]).
  - Top-center: price hexagon badge. Gold number; `#59f4ca` when discounted, `#ff5454` when marked up (`constData.discountColor/premiumColor/normalColor`).
  - Right: half-body art. Left: a watermark of the first bond's glyph.
  - Bottom rows: bond icon + bond name(s), then class icon + name.
  - A frozen card gets an icy-blue overlay and a ❄ at the bottom. A promotion reward shows price **0**.
- **Item card:** in 下半 every non-tutorial mode has `itemCount`=1 at every shop level, so one equipment slot is always shown. 入门 has it only from L5, as does the older tip "调度中心会在升至5级后开始售卖装备". Same card shape with an equipment icon and a tier chip.
- **Funds card:** hexagon badge with a coin glyph (three stacked gold triangles) and the amount, "目前资金", and **✕ 收起**, which collapses the shop to reveal the bench and board.
- **Freeze / refresh:** 冻结 is pale blue with a snowflake; it toggles to 解冻. 刷新 is amber with a cycle icon and a cost badge.
- **Deploy interaction:** drag a card or bench unit onto the board. Legal tiles light green, illegal red. While dragging, a red "✕ 点击取消" corner zone appears. Dragging a unit back to the bench retreats it. Selling is a separate sell action [ASSUMED drag onto the funds card]. Equipment: drag onto a unit (board or bench). There is no facing step in auto-chess. [ASSUMED]
- **Remaining deploy counter:** "剩余可放置角色: N" = 8 − deployed (`maxBattleChessCnt`).

### 11.3 Combat [SHOT 05db364c / fc6673cd]

- The camera zooms in on the lane.
- The capsule shows `n/m` kills. Right edge: DP `⊂ 59`.
- When finished: bottom-center message pill "⌛ 作战结束，等待队友完成作战", and the view switcher `‹ 自己 ›` (arrows cycle P1…P4).
- The bond strip stays visible. No shop.

### 11.4 联防 [SHOT GwtDIAW]

- Orange banner "联防阶段" at phase start.
- The HUD capsule shows `1/4` kills. The bond strip is dimmed with the tooltip "层数叠加已禁用".
- The field is a wide two-half arena. Helpers' operators keep their HP bars and SP.
- The view switcher defaults to the 联防 field. Non-helpers can switch to it.
- Owners' LP in the left list decrements live as enemies escape.

### 11.5 机变 draft overlay [SHOT Wrkhtxv / Mb2mtd9 / SEbySVl]

- A full-width dark translucent overlay over the board. The left player list stays visible.
- Title at top-left in large mint-white text with the family name (悬赏决策 / 道具补给 / 机密商店 / 战术决策), then `|`, then the grey description.
- Right: "当前轮到你决策" (mint), or "{name} 正在决策… ⌛", plus the countdown.
- 3×2 grid of cards (about 23 % × 26 % of the screen each), light grey-glass panels:
  - icon (enemy portrait, equipment or team-buff tower glyph) and bold title
  - description with keywords highlighted blue (`ba.vup`: "下场作战", numbers)
  - an equipment tier chip in the top-left (orange frame, roman numeral)
  - a taken card turns lighter/greyed and carries the taker's avatar in a round badge at its top-right
- Behind the overlay, the funds pill and "可放置角色" remain visible at the right.

### 11.6 Strategy draft and briefing

Covered in §4.1–4.2. Both are full-screen dark panels:
- a fine scan-line texture
- difficulty tag (colored glyph + text) at top-left next to exit/ping
- step indicator "**1**/2 确认本局信息" or "**2**/2 选择策略" (big mint numeral)
- countdown at top-right
- a mint primary button bottom-right (准备就绪 / 确认选择)

### 11.7 Final Assault [SHOT YRY8ar1]

- A wide single field seen from above-front with MARTHE-branded barge docks.
- The HUD capsule shows `4/9` kills and the boss HP bar (orange, with a boss glyph); the team LP number follows.
- The boss has its own red bar under its sprite.
- Bottom-center `‹ 全景 ›` switches left half / panorama / right half.
- The countdown keeps running. After the 150 s mark, show a red "DOT" warning; team LP drains 1/s (the `hintTimeDotPhase`=10 s warning before that).
- The damage-share broadcast ticker is at the top-center.

### 11.8 Room / matchmaking / result: see §3 and §10.6

---

## 12. Visual style guide (for an original look-alike)

**Palette.** Official hex values come from data; the rest are sampled by eye.

| Token | Hex | Use |
|---|---|---|
| bg-0 | #0c0f0e | page and backdrop (near-black green-grey) |
| bg-1 | #141816 | panels |
| bg-2 | #1e2421 | cards |
| line | #2f3a35 | 1 px borders, grid |
| mint-500 | #4ed8af [DATA training color] | primary accent, ready buttons, headings |
| mint-400 | #59f4ca [DATA discount] | highlights, discounted price |
| mint-600 | #35d8b4 [DATA choice text] | secondary accent text |
| mint-glow | #17f9b7 [WIKI header] | glows, countdown digits |
| gold | #ffc600 [DATA normalColor] | prices, coins, "当前轮到你" |
| gold-2 | #f2bd3e [DATA special choice] | special/rare card text |
| amber | #f6a329 [DATA 标准] | refresh button, 标准 difficulty |
| orange | #e85a1a [DATA 险境] | combat capsule border, 联防 banner, low-time digits |
| red | #e73118 [DATA 绝境] / #ff0024 [DATA 终极] / #ff5454 [DATA premium] | danger, exit button, markup |
| ice | #9fd4ff [ASSUMED] | freeze button and frozen overlay |
| text-hi | #f2f2f2 | primary text |
| text-lo | #8a948f | secondary |
| Shop-level tag colors (`shopLevelDisplayDataDict`) | L1 #434343, L2 #626654, L3 #445760, L4 #615B74, L5 #6C5E41, L6 #5d341e | level chip background |

**Typography** (original game: Novecento/Bender-style Latin, Source Han Sans CJK). Our choice [ASSUMED], using freely licensed fonts:
- CJK UI: "Noto Sans SC" 400/500/700.
- Latin display (microtext "STRONGHOLD PROTOCOL", "LEVEL", "COUNTDOWN"): "Rajdhani" or "Oxanium", uppercase, +8 % tracking.
- Countdown and big numerals: a 7-segment font ("DSEG7 Classic", npm `dseg`) or "Share Tech Mono".
- Numbers in badges: "Barlow Condensed" 700.

**Shapes and iconography:**
- Rectangles with 1–2 px mint borders and **corner brackets `[ ]`** instead of rounded boxes. Hexagon badges for prices and cost. Circles for bond discs. Chess pieces for trophy levels. A tower (rook) icon for LP.
- Diagonal "chevron" arrows (»») for flow. Hazard-stripe accents (yellow/black) only on the physical barge and board props.
- Scan-line and noise overlays on panels. Topographic-map and radar-circle decorations on the hub and result screens. Tiny techno labels in 8–10 px caps.
- Tier chips use roman numerals I–VI; elite units get a gold outline or glow.

**Motion:**
- Cards slide up from the bottom (shop).
- Bond disc rings fill clockwise as stacks grow.
- Countdown digits flicker at ≤10 s.
- The broadcast ticker slides in from the right. Emote bubbles pop with a 150 ms scale.
- Phase banners ("联防阶段", "最终攻势") wipe in horizontally with chevrons.

**Do not copy:** Arknights logos, the "MARTHE" branding, character art, the exact emote art, or fonts. Build our own glyph set in the same spirit.

---

## 13. Implementation notes for our Node authoritative server [ASSUMED design]

- **Match states:** `LOBBY → BRIEFING(25) → BAND_DRAFT(50) → BOOT(3) → {SP_DRAFT? → PREP → COMBAT → UNITE? → RESOLVE}×N → FINAL → (HIDDEN) → SETTLE`. All timers are server-side; clients only render `deadlineTs`.
- **Ready gate:**
  - `PREP` ends when `every(alive players).ready` or the deadline passes.
  - Ready is blocked while that player's temp-bench overflow is non-empty.
  - At the deadline, destroy overflow units, then auto-ready.
- **Draft engine** (bands and 机变):
  - Keep an order array and one `activeSeat`.
  - Per-turn timer: bands [ASSUMED] 12 s each within the 50 s step; 机变 16 s, 30 s for the first.
  - Allow one "skip" per player in the band draft (it moves the player to the end of the order).
  - Timeout → auto-pick: bands → `band_bldsk`; 机变 → a random remaining card.
- **Combat:**
  - Simulate all boards in one tick loop (same seed per round).
  - Record leaked enemies with `sourcePlayerId`, type, remaining HP [ASSUMED: they re-enter at full HP] and bounty tag.
  - Then run UNITE on a fresh sim instance with helper snapshots (position, HP %, SP).
- **Emotes:** `emote{seat,id}`, rate-limited to 1/s server-side, relayed to all.
- **Broadcasts** are server-generated from events.
- **Disconnect:**
  - Keep the seat for the whole match (the real game allows a return "within a period"). While away, the bot policy is "do nothing, auto-ready at deadline, auto-pick drafts".
  - Offer an **AI takeover** option: a simple buy/merge/deploy heuristic, like the tutorial NPCs (`trainingNpcList` = 华法琳/阿米娅/杜遥夜 bots with 120 trophies).
  - Reconnect restores the full state snapshot.
- **Bots for empty seats:** the real tutorial is a 4-seat match with 3 NPCs. We can reuse that idea to let 1–3 humans play with bots.
- **Spectating:** read-only board views of any seat at any time. During FINAL, hide the other pair's field to match the official rule.
- **Anti-grief:** report and like at settlement, and the 20 s "重载" cooldown. Optional for us.
- **Timer presets:** "Official" (data table) and "Fast" (×0.5 prep, keep combat). Official matches run about 55 min.

---

## 14. PvP?

**No.** 盟约 has no versus mode (confirmed by all sources: official announcements, BWIKI, PRTS, guides). "同盟" means alliance. The teams never fight each other. Indirect competition only:
- the shared operator pool ("卡牌/抢牌")
- who kills a bounty during 联防
- the damage-share broadcasts
- the per-match commendations

---

## 15. Screenshot / reference URLs (not downloaded; for the UI designer)

Official:
- Official gameplay-intro long image (800×13685; hub, room, matchmaking, briefing, strategy draft, prep/shop, drag-deploy, freeze, promotion, equipment…): https://img.71acg.net/sykb~bbs/pc/1763033996225879 (mirrored from the 11/13 2025 official post "「卫戍协议：盟约」玩法介绍")
- Event banners:
  - https://patchwiki.biligame.com/images/arknights/c/cc/t7tdfvs7j0xpzphw620i2iqi4qoh34v.jpg (下半)
  - https://patchwiki.biligame.com/images/arknights/0/03/qeasnqofhr3ffa0bhlbbp0j9854smy9.jpg (上半)
- Icons:
  - trophy lvl1: https://patchwiki.biligame.com/images/arknights/9/96/b2qsb5k5jss4gnzox3a6c0b1gv5uy5g.png
  - team-buff icon: https://patchwiki.biligame.com/images/arknights/4/49/en8v6no3jtgdnvcydolnksu6pflv3co.png
  - title icon 1: https://patchwiki.biligame.com/images/arknights/2/20/7ltxu8xxexf8nyegz3wrnplfnx28k15.png
  - emote "合作愉快": https://patchwiki.biligame.com/images/arknights/0/03/rneluobt0fhtix8oy4xp2x33jelzkvn.png

In-game screenshots (players, CN/TW):
- Final Assault HUD (shared field, boss bar, `‹全景›`): https://i.meee.com.tw/YRY8ar1.png
- 联防 HUD ("层数叠加已禁用", player list with LP, `‹自己›`): https://i.meee.com.tw/GwtDIAW.png
- Briefing 1/2 (leader, special enemies, bonds, 已就绪 2/4): https://i.meee.com.tw/1BJDbxX.png
- Strategy draft 2/2 (order list, 决策中): https://i.meee.com.tw/BOzwbwn.png
- Enemy preview board: https://i.meee.com.tw/wdRAguq.png
- Info dropdown (strategy + bans per bond): https://i.meee.com.tw/9H7Kugy.png
- 机变 drafts:
  - 悬赏决策: https://i.meee.com.tw/Wrkhtxv.png
  - 机密商店 (with a left player): https://i.meee.com.tw/Mb2mtd9.png
  - 战术决策: https://i.meee.com.tw/SEbySVl.png
- Bond strip: https://i.meee.com.tw/e3UUYq8.png
- Emote usage: https://i.meee.com.tw/86HwPAh.png
- Countdown turning orange: https://i.meee.com.tw/WcxNEfR.png
- Result / personal settlement: https://i.meee.com.tw/rZEmfyJ.png
- Roster config 物资调配处: https://i.meee.com.tw/KJGydN0.png
- Trophy table (PRTS 上半): https://i.meee.com.tw/LYFkxSZ.png
- Prep phase with shop (TW client):
  - https://truth.bahamut.com.tw/s01/202606/forum/33651/c32edaf6528776921fa0587c77edc291.JPG
  - https://truth.bahamut.com.tw/s01/202606/forum/33651/4995084674285fdfefc218c7015258c0.JPG
  - https://truth.bahamut.com.tw/s01/202606/forum/33651/a7a712ab367e8855c5a177dd945464fd.JPG
- Combat end, "等待队友完成作战":
  - https://truth.bahamut.com.tw/s01/202606/forum/33651/05db364c3424cfd55778af95ce5cc077.JPG
  - https://truth.bahamut.com.tw/s01/202606/forum/33651/fc6673cd4ee25defcc599d17fc5d3f5d.JPG
- Stats web page (title hexagon radar): https://truth.bahamut.com.tw/s01/202604/forum/33651/a8947d6e34ee687641d438d4df66235d.JPG
- Strategy badges grid: https://truth.bahamut.com.tw/s01/202604/forum/33651/b5db3a1d005cf0b681814a9920b451af.JPG

---

## 16. Open questions and assumptions (review before spec freeze)

1. **联防 helper selection** when 3 or more players are perfect, and the exact 联防 timer. Proposed: highest LP, and the round's combat time.
2. **Boss HP scaling** with the number of alive players. Community-confirmed that it shrinks; the formula is unknown. Proposed: linear n/4.
3. **Pairing rule** for the Final Assault (seat order vs LP), and the 3-player layout.
4. **Strategy draft exclusivity.** Proposed: duplicates allowed. The per-turn time inside the 50 s step is also unknown.
5. **机变 pick order.** Screenshots show non-seat order. Proposed: random (alternative: lowest LP first).
6. **Title (评语) criteria** (§10.5) are inferred.
7. **Disconnect behavior** (idle vs AI) and the co-op reconnect window. The official text says only "一段时间内". Solo is 24 h.
8. **`storeCntMax`=6, `singleClosureStayTime`=15, `bossTrailerStartRound`=3, `specialPhaseStayTime`=1:** semantics are unclear. Guesses: max shop cards, the solo result-screen stay, the round from which the boss preview shows, and a 1 s pause between draft picks.
9. **Do leaked enemies keep their damage** when entering 联防? Proposed: full HP.
10. **Terrain 机变 cards** (`map_m0X`): do they apply to the picker only or to all boards? Proposed: picker only.

## Sources

- Official:
  - https://ak.hypergryph.com/news/5114 (下半 update: fewer-than-4 start, 24 h solo leave, boss both sides with shared HP)
  - https://ak.hypergryph.com/news/9697
  - https://ak.hypergryph.com/news/8584
  - https://ak.hypergryph.com/news/2830 (上半: "和另外三位玩家组队")
- BWIKI:
  - https://wiki.biligame.com/arknights/盟约 (full play rules incl. 联防, 最终攻势, emotes, trophies, tips)
  - https://wiki.biligame.com/arknights/盟约/S.W.E.E.P.报告
- PRTS: https://prts.wiki/w/卫戍协议：盟约_下半 and https://prts.wiki/w/卫戍协议：盟约 (70 %/80 % factors, 16 s/30 s draft, 6-choose-1, hidden core 350/1200, trophy table with 终极)
- arknights.wiki.gg:
  - https://arknights.wiki.gg/wiki/Stronghold_Protocol
  - https://arknights.wiki.gg/wiki/Stronghold_Protocol_Alliance
- Bahamut guides:
  - https://forum.gamer.com.tw/C.php?bsn=33651&snA=12294
  - https://forum.gamer.com.tw/C.php?bsn=33651&snA=12316
  - https://forum.gamer.com.tw/C.php?bsn=33651&snA=12256
  - https://forum.gamer.com.tw/C.php?bsn=33651&snA=12522
- Shared-pool videos: https://www.bilibili.com/video/BV1JWy3BkEpt/ and https://www.bilibili.com/video/BV1ZTUjBaEyy/
- Interview: https://www.bilibili.com/video/BV17L9MBXEBY/ (机核 × 大黄, design background)
- Data: `activity_table.json` (`autoChessData`, `act2autochess`), `levels/act1autochess/*escaped*`, `h07_*`, `display_meta_table.json` (saved to `scratchpad/gd/extra/multiplayer/`)

---

## Addendum (critic)

Written 2026-09-27 by the completeness critic. Sources: the official gameplay-intro long image (`img.71acg.net/sykb~bbs/pc/1763033996225879`, sliced in `scratchpad/gd/extra/critic/intro_*.jpg`), PRTS `卫戍协议/帮助`, PRTS `卫戍协议：盟约_下半` §开始模拟, BWIKI `盟约`, and a re-read of the §15 screenshots.

### D1. Corrections to the TL;DR

| # | Was | Now |
|---|---|---|
| 3 | "HP/ATK ×0.70 solo, ×0.80 co-op" | Too coarse. The multiplier depends on **mode and round**. 标准/险境 co-op start at 0.8; 绝境/终极 co-op start at 1.1¹/1.2¹ and grow to 1.1⁸/1.2⁸ by R14. Full table: 01 Addendum A3. |
| 4 | band draft | Confirmed: "以随机顺序进行策略轮选，顺序会显示在左侧". **All unlocked strategies are shown** (not a random 3). **Duplicates are allowed:** in the official illustration, the strategies already taken by P1/P2 are not greyed in P3's grid. One skip per player. |
| 6 | solo "unlimited" | Confirmed by BWIKI (下半): "休整期及机变阶段没有时间限制…24小时内随时返回". |
| 8 | 机变 | Funds for the round are already granted when the overlay opens: the funds pill reads 13/11/17 behind the three screenshots. The family (悬赏 / 道具补给 / 机密商店 / 战术决策) is the **same for all 6 cards** of one phase. Pick order is **not** seat order. Recommended per-round families: 01 Addendum A4. |
| 10 | 联防 | Confirmed: "所有防卫成功的玩家（最多2名）将以其阵地当前的状态，迎接所有防卫失败玩家未击倒敌人的集合". Helpers keep "生命比例、技力、部署位置". |
| 12 | Final Assault pairing | Players are paired, and **an odd player forms a group alone** ("如有落单的玩家将单独成组"). Movable leaders spawn **one per alive player's side**, all sharing HP. The HP pool is excluded from the round multipliers. The official intro shows R4 of the tutorial with a merged LP of 105 = 45 + 20 + 20 + 20. |
| 15 | gifting | Unchanged: 信标 is the only operator transfer. |
| new | – | **Per-match banned operators are shown to everyone.** At briefing: core and add-on rows with greyed bonds carrying the badge "部分盟约所含干员阵容不完整", plus a 本局禁用干员 portrait list. In match: the info dropdown shows "本局禁用干员情况" with a red person-✕ badge = number of banned operators in each bond. Rule: 01 Addendum A2. The pool is **shared**, so bans apply to the whole team. |

### D2. Answers to §16 open questions

1. **Helper selection (>2 perfect):** still unpublished. Keep "highest LP, then seat". The timer is the round's `maxPlayTime`.
2. **Boss HP vs player count:** still unpublished. What is known: bloodPoint is one pool, it is unaffected by multipliers, and each alive player has their own boss spawn. Keep `bloodPoint × alive/4`, with a solo value of 0.25 [ASSUMED].
3. **Pairing:** odd player alone (verified). Pair order: seats (1,2) and (3,4) among alive players [ASSUMED].
4. **Strategy exclusivity:** allowed duplicates (official illustration). Per-turn timer [ASSUMED] 12 s.
5. **机变 pick order:** random per phase (screenshots). "Lowest LP first" is not supported by any evidence.
8. **`storeCntMax` = 6** = 5 operator slots + 1 item slot at L4–L6. That reading is consistent with `shopLevelDataDict`.
9. **Leaked enemies in 联防:** unknown. Keep "full HP" [ASSUMED].
10. **Terrain cards:** picker only [ASSUMED]. Terrain cards exist only for the current stage (`terrain_m0X`).

### D3. UI facts read from the screenshots

- **Prep:**
  - The shop bar holds, in order: `LEVEL n` card (upgrade cost hexagon on top), operator cards, the item card in 下半, and the funds card with "✕ 收起".
  - A frozen shop tints **all** cards icy and the button toggles to "解冻".
  - Reward cards after a merge show **price 0** with the next tier's chip.
  - Above the buttons, "剩余可放置角色: N" = cap − deployed. The cap is 9 with 人事部文档.
- **Combat:**
  - The capsule shows `killed/total`. The DP counter sits at the right edge.
  - The bond strip stays visible. In 联防 and the boss round it carries the tooltip "层数叠加已禁用".
- **Final Assault:** eliminated seats show a grey robot "x-eyes" avatar in the left list. The view switcher reads `‹ 全景 ›`.
