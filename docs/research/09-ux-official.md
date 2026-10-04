# 09 · Official prep and co-op UX: facing, enemy preview pen, spectating and the combat model, emotes

Written 2026-09-28. This is research only; no code was changed. It answers the user's test feedback on items 2, 5, 6 and 7, and the part of item 9 about UX ("按照官方原版来").

**Tags**
- **[DATA]**: read from the official client or its game data. This covers `activity_table`, the level JSON, `display_meta_table`, the local Windows client's UI bundles and its il2cpp `global-metadata.dat` (class names, field names and constants, parsed with a v29 metadata reader).
- **[WIKI]**: BWIKI 盟约, the official 玩法介绍 long image, and the in-game guidebook pages.
- **[VIDEO]**: frames from bilibili gameplay videos, or screenshots.
- **[COMM]**: community posts on NGA or Bahamut.
- **[ASSUMED]**: our inference or proposal.

**Precedence:** where this file disagrees with `06-multiplayer-ux.md` or `DESIGN.md` about facing, spectating, selling or the enemy preview, **this file wins**. See §7.

Evidence was extracted to the scratchpad `research2/`: guide pages, video frames, sprite sheets, `emoji_table.txt` and `meta_*.txt`.

---

## 0. TL;DR

| # | Question | Official answer | Tag |
|---|---|---|---|
| 1 | Can the facing be set? | **Yes, with the standard Arknights 4-direction deploy wheel.** Drop a unit on a tile and a diamond appears. Swipe toward UP, RIGHT, DOWN or LEFT; the rotated attack range previews live. Release to confirm. Tap "✕ 点击取消" or release in the centre to cancel. Moving a deployed unit (drag it to a tile) goes through the same step. The facing is stored per chess (`ChessPositionInfo.direction`) and persists between rounds. | DATA + VIDEO + WIKI |
| 2 | Enemy preview | The enemies of the coming round stand physically in a **preview pen** behind the gates: rect `((14,7),(18,13))`. Row 16 is kept empty. The upper-gate group stands in rows 17–18, the lower-gate group in rows 14–15. They are placed in spawn-time order, fill outward from the pen's gate column, and several may share a tile. At most **50** are shown. They idle and face left. The pen is visible at the top edge of the prep camera; the HUD button **[🔍▶▶]** pans there in 0.25 s. | DATA + VIDEO |
| 3a | Spectating | In prep you can view teammates' boards: tap an avatar, then **前往查看**. After your own combat ends ("⌛ 作战结束，等待队友完成作战") you can do the same to watch a teammate still fighting. In the Final Assault you cannot see the other pair. There is **no** always-on ‹ › switcher during normal combat. The ‹ › pill exists only inside the shared 联防 and Final Assault fields (left half / 全景 / right half). | DATA + WIKI + VIDEO |
| 3b | Where combat is computed | **On each client.** The client simulates its own battle and reports it to the scene server: kills, escapes, finish, bond-layer gains, operator HP/SP. The server owns economy, shop, board and phases, and sends a shared `stageSeed`, the enemy lists, the 联防 setup (leaked enemies plus helpers' deployment and HP/SP) and the boss setup. | DATA (client network classes) |
| 4 | Emotes | Image only, no text (`ChatReq{emojiGroup, emojiId}`). The pop bubble holds only the icon. There are 6 in-match themes × 6 = **36** battle emotes. The 交流 button sits bottom-left; the panel shows 6 emotes and you swipe to change theme. Cooldown 1 s, bubble 3 s. The bubble appears beside the sender's row in the left player list. | DATA + WIKI |
| 5 | Other | Sell with the **出售 +1** button on the tapped unit's selection diamond, not by dragging. Items: **销毁** only. Buying and upgrading take two taps (first tap shows the confirm state). The strategy draft marks a teammate's pick as **队友已选**. | DATA + WIKI |

---

## 1. Facing and direction in prep

### 1.1 Evidence

1. **Official 玩法介绍 long image, 干员 section [WIKI]** (https://img.71acg.net/sykb~bbs/pc/1763033996225879, y≈6850–7080).
   - A 3-frame strip: card on the bench → unit on a tile with an **orange wedge** at the right of its ground ring → dragging a deployed unit to a new tile.
   - The third frame shows a **white diamond** centred on the target tile and a red **"✕ 点击取消"** tag on the diamond's upper-left edge. Green highlights mark the legal tiles, and a ghost of the unit sits in the centre.
   - Caption: "拖拽干员即可将干员从整备区部署到战场区，也可以直接拖拽已经部署完毕的干员来改变他们的作战位置。"
2. **In-game tutorial of 卫戍协议 (上半), BV1tFUAYnEfZ, 4:56–5:14 [VIDEO].**
   - Amiya says: "**干员的部署方式与其他模式没有区别**，通过拖拽将干员从手牌区部署至战场。"
   - Frames at 5:08–5:11 show the standard AK deploy wheel: a white diamond, a smaller inner diamond with 4 corner chevrons, "✕ 点击取消" at the upper-left, and the finger swiping right.
   - The right chevron lights up and the **attack range appears as orange/yellow striped tiles** in that direction. A tooltip reads **"拖回中心区域取消"**.
   - After release, the unit stands with an orange "›" wedge on its ground ring.
   - At 5:13: "已部署的干员可以直接拖拽改变部署位置。"
3. **Client network data [DATA].**
   - `Torappu.Battle.AutoChess.ChessPositionInfo { instId, position, chessType, direction }` is what the client sends in `AutoChessBattleSceneChangePositionUp { deployCount, unitPositionInfo }` and in `AutoChessBattleSceneUseMagicUp { instId, deployCount, unitPositionInfo }` (Arts too).
   - The server echoes `ChangePositionDn { boardStatus: AutoChessBattleBoardStatus { uidIndex, positions, updatedBonds } }`.
   - The prep state `AutoChessBattlePreparationStatus.positions` holds these entries.
   - So facing is a stored, server-known, per-chess field. It persists until the unit is moved again.
4. **Selection diamond (underframe) of the autochess character menu [DATA]**, bundle `ui/autochess/[uc]autochessbattle.ab`.
   - `act2autochess_panel_character_menu/btn_panel_root/root/group_masks/{mask_up, mask_right, mask_left, mask_down, cancel_mask, block_mask}`: the 4 direction quadrants and a cancel mask.
   - `util_btn` has sprite `icon_sell`, a `price_root/price_txt` ("+1"), a `coin_panel`, a `pc_key_holder`, and funcId `autochessSale`.
   - Code fields: `_underFramePanelBtnParamSellPos` and `_underFramePanelBtnParamDestroyPos`.
5. **Facing matters in the rules [DATA][COMM].**
   - The act2 m01 blowers (`trap_013_blower`, dir DOWN) give operators facing **with** the airflow +30 % ATK and **against** it −30 % (`blower_s_character[equal].atk`). This only works with UP/DOWN facing.
   - 叙拉古正装: "左右两格" perpendicular to the facing. 歌利亚头盔: "前方一格".
   - 画卷 range `1-1`: its own tile plus the tile in front.
   - Garrisons that target "身前一格": 寒克 "给身前一格的干员挂上一个特质", 魔王 "使身前一格的干员特质…" [VIDEO BV1h6DjBoE3T 0:12–0:30]. 铃兰 and 赛媽 are "对着" stackers [COMM Baha 12294].
   - NGA t45645958: "最前一排可部署位不管朝向哪边都可以攻击到 [the boss]". Players pick facings, and write layouts as "空→←白".

### 1.2 Spec (implement exactly)

| Aspect | Official behaviour | Tag |
|---|---|---|
| Directions | 4 directions: `UP`, `RIGHT`, `DOWN`, `LEFT` (AK `Direction`). The range grid (`[dRow, dCol]`, facing RIGHT) is rotated per DATA.md: RIGHT `(dr,dc)`, UP `(dc,−dr)`, LEFT `(−dr,−dc)`, DOWN `(−dc,dr)`. Row 0 is the bottom. | DATA |
| Placing from the bench | 1. Drag the card or bench unit; legal tiles glow green (melee/ranged rules unchanged). 2. Release on a legal tile: the board **keeps the ghost on the tile** and opens the direction diamond. The diamond is centred on the tile, about 3 tiles across its diagonal, with 4 chevrons and a red "✕ 点击取消" tag on its upper-left edge. 3. Press and drag from the centre toward a side; past the centre dead-zone (~0.5 tile) that side's chevron lights and the **rotated range tiles are shown striped orange**. While outside the centre, the tooltip "拖回中心区域取消" is shown. 4. Release: the unit is committed with that direction. Release inside the centre, or tap ✕, and the placement is cancelled (the unit goes back to where it came from). | VIDEO + WIKI |
| Moving a deployed unit | Drag the unit to any legal tile, **including its own tile**. The same diamond opens. The original stays visible until confirmed; cancelling leaves the unit and its facing unchanged. Re-orienting in place = drag the unit onto its own tile and swipe a new direction. | WIKI + ASSUMED (own-tile case) |
| Tap a deployed unit | Opens the selection diamond (underframe) around the unit and shows its **attack range tiles** on the board (orange). Buttons on the diamond: **撤退** (red runner icon, upper-left; unit returns to the bench) and **出售 +1** (coin badge, upper-right). The left side shows the detail card: portrait, tier, LV, ATK/DEF/RES/block/cost, an "攻击范围" mini-grid, bond icons, and tabs 特质/技能/特性/天赋/装备. You cannot rotate from this menu. | DATA + WIKI |
| Default facing | Every player-initiated placement goes through the wheel, so there is no silent default. Server-created board units (effects such as 外勤医疗 or 预备干员, bots, and back-compat) default to **RIGHT**, toward the gates. | ASSUMED |
| Persistence | Facing is stored with the position and survives round changes. At combat start units auto-deploy on their tiles **with their facing**, in order **从上到下>从左到右** (盟约下): down each column, the columns left to right (research 01 §4.3). | DATA (positions) + COMM (order) |
| Melee, ranged, medic | All use the same wheel. The range preview uses the unit's own rangeGrid (heal range for medics). Blocking and "front" logic use the facing vector. | DATA |
| Summons (tokens) | Each summon is its own bench card ("干员及其召唤物会自动加入整备区"), placed and moved freely with the same wheel. Retreating the owner also retreats its summons. | WIKI |
| Equipment | Dragged onto a unit (board or bench). No direction step. A third item opens the equip-replace dialog (`UseEquipUp { charChessInstId, equipChessInstId, isChangeEquip, unloadInstId }`). | DATA |
| Arts (画卷 / 教鞭 / 神秘顾客) | Dragged onto a map tile. `UseMagicUp` carries `unitPositionInfo` including `direction`, so an Art also gets the direction step. For 画卷 (range `1-1`) the direction picks **which neighbouring tile** is "in front" and copied. | DATA + ASSUMED (wheel shown for Arts) |
| Range preview elsewhere | The shop card and detail panel "攻击范围" show a mini-grid (facing RIGHT). On the board the rotated range appears only in the wheel and on the selected unit. | DATA + VIDEO |
| Facing indicator | While not selected, an orange wedge "›" on the unit's ground ring points in the facing direction (prep and combat). The model is Front for RIGHT and DOWN, Front mirrored for LEFT, and Back for UP when a Back model exists. | VIDEO + DATA (ASSETS.md) |
| Final Assault, right side | The right-hand player's board is **mirrored left↔right**: `ConvertChessPositionInfoToBossMap` [DATA]; "分到右边只是把你的场地镜像翻转了过来，本来的蓝门方向和接敌方向并不会变" [COMM NGA t45645958]. Mapping: col `c → 20−c`, RIGHT↔LEFT, UP and DOWN unchanged. FA prep takes place on your own half of the shared field (camera `right_boss_prepare_camera_param (5.93,−6.68,−2.46,1)`), with the same wheel. | DATA + COMM |

---

## 2. Enemy preview pen in prep

### 2.1 Evidence

- **Level config, identical in all 11 stages [DATA]:** `configBlackBoard` has `enemy_place_rect "((14,7),(18,13))"`, `enemy_camera_param "(0,7.86,0.9,1)"` (camera shift toward the pen), `left_prepare_camera_param "(-4.67,0.3,-2.46,1)"` and `move_time 0.25`.
- **Pen tiles:** row 16 of the pen carries `previewNotAlloed=1`. Pen starts `S` sit at **(18,7)** and **(15,7)**.
- **Client class `Torappu.Battle.AutoChess.AutoChessEnemyPreviewManager` [DATA]:**
  - Fields: `MAX_PREVIEW_CNT` (const, decoded **50**), `m_mapRowOffset`, `m_bossMapRowOffset`, `m_betterGridToSpawn`, `m_backUpTiles`, `m_gridSpawnStatus`, `m_previewEnemyData`, `m_spawnedEnemy`.
  - Methods: `_GeneratePreviewData`, `_GetBetterGridToSpawn`, `_SpawnPreviewEnemies`, `_CompareActionByTime`.
  - Related buff key: `autochess_enemy_preview_buff`. Config key name: `enemy_preview_row_offset`.
  - Server data behind it:
    - `AutoChessBattleRoundEnemyInfo { enemyType, enemyKey, actionIndex, count, round }`
    - `AutoChessBattleEffectEnemyInfo { effectInstId, enemyId, count }`, the per-player extras (bounties, 特训) in `PreparationStatus.effectEnemies`.
- **Screenshot of the pen view [VIDEO]** (https://i.meee.com.tw/wdRAguq.png, round 4):
  - A 7×5 tiled pen with red wire-cube gates at its left edge (top row and 4th row).
  - The upper group stands by the top gate and the lower group by the lower gate. Row 16 is empty.
  - Enemies stand individually in formation. Several share a tile as small clusters of the same kind. They face **left** and idle. No count badges, no HP bars.
  - HUD: the left button shows **[🔍◀◀]** (mint) and the right button **[🔍]** (grey).
- **Prep screenshots [VIDEO]** (Bahamut c32edaf…, 4995084…; BV1H3wtziEbY):
  - At the normal prep camera, the pen's front rows with their enemies are visible **at the top-right edge, behind the upper red gate**.
  - The HUD shows **[🔍]** (mint, left of the round box) and **[🔍▶▶]** (amber, right of the LP).
- **Community tip [COMM Baha 12294]:** "前三回合怪只走下面的紅門(可以看右上角的放大鏡了解出怪路線)"; "右上角看敵方出怪(靠上面代表走上面那路，4T後才會出上路怪)".
- **HUD bindings [DATA]:**
  - `btn_check_enemy` (funcId `autochessViewEnemy`, `OnToggleEnemyInfo`): sprites `btn_check_enemy` (🔍▶▶ amber) and `btn_check_enemy_unfold` (grey).
  - `btn_check_player` (`OnTogglePlayerInfo`): sprites `btn_check_player_normal` (🔍 mint; opens the **本局信息** dialog `autochess_hud_player_info_dialog`: mode, strategy, disabled bonds and banned operators) and `btn_check_player_back` (🔍◀◀; returns from the pen).
- **Boss rounds:** `m_bossMapRowOffset` exists [DATA]. In the official FA prep image the boss stands on the boss field with its HP bar during prep [WIKI intro image, 最终攻势 section].

### 2.2 Spec

| Aspect | Rule | Tag |
|---|---|---|
| Content | Every enemy of **your** coming round: the wave-template actions after special-enemy replacement, plus your `effectEnemies` (bounties, 特训, 教鞭/神秘顾客). One figure per enemy instance, including flyers. Capped at **50** figures. | DATA (+ASSUMED that effect enemies are included) |
| Location | Pen rect rows 14–18 × cols 7–13 on the stage grid. Row 16 is never used. Enemies whose route starts at the **upper gate (12,10)** go to rows **17–18**; **lower gate (9,10)** to rows **14–15**. This matches a +6 row offset from the board gate to the pen gate (row 18/15). | DATA + VIDEO |
| Order and packing | Sort by spawn time (`_CompareActionByTime`: wave `preDelay + i·interval`). Fill from the tile nearest the pen gate (col 7) outward along the two rows (col 7→13). Allow several enemies per tile, offset slightly (the screenshot shows 3 on one tile). Proposal: up to 3 per tile before moving on, then `m_backUpTiles` = any free pen tile. | DATA (method names) + VIDEO + ASSUMED (3/tile) |
| Look | Enemy spine in **Idle**, facing **left**, not moving, no HP bar, no targeting, normal colours. No count badge and no bounty marker was observed. | VIDEO + ASSUMED (no bounty marker) |
| Visibility | The pen is part of the scene, so its front rows show at the top edge of the prep camera, behind the upper gate. **[🔍▶▶]** pans the camera to the pen (tween 0.25 s); **[🔍◀◀]** or the same button pans back. It is available only in prep (休整期; the tip says "休整期可以查看当前回合即将迎击的敌方单位"). The pen empties when combat starts. | DATA + VIDEO |
| Intel | Tap an enemy in the pen for its detail card (name, stats, abilities), as with a tapped enemy in battle. There is no separate list panel in the official game. The briefing and S.W.E.E.P. handbook list the match's special enemies and the leader. | ASSUMED (tap) / DATA (no list UI found) |
| Teammates | When you view a teammate's board in prep, their pen (their enemies) is shown too. | WIKI intro image |
| Boss round | During the boss round's prep, the leader and its escorts preview on the **boss field** (`m_bossMapRowOffset`). The boss stands with its HP bar next to its spawn. | DATA + WIKI |

---

## 3. Spectating, waiting, 联防, Final Assault, and the combat model

### 3.1 Official UI facts

**Data tips [DATA]:**
- "休整期可以查看队友的战场情况"
- "最终攻势中，两名参与者会处于同一个战场，但无法查看另一组队友的战场情况"
- "只有达成完美作战的队友可以进行联防"
- "进行联防时，盟约不会继续叠加"

**BWIKI 盟约 [WIKI]:** "如果感到无聊，博士可以在下一个休整期开始之前，通过点击队友头像前往其场地，查看他们的作战情况。"

**Official intro image [WIKI]:**
- Prep: "博士可以在休整期通过点击队友头像前往其场地，查看队友们的部署情况。"
- Screenshot: tapping a teammate's avatar expands a mint **"前往观战/前往查看"** button under it.
- While viewing, your own row becomes a white **"返回战场"** button, the viewed row gets an eye badge, and a bottom-centre pill shows **"👁 华法琳#"**.
- 联防 screenshot: the pill reads **"‹ 👁 阿米娅#"**. The HUD capsule shows `0/1` plus an orange runner tag `×1` (escaped count, `tag_miss`), and "层数叠加已禁用" under the bond disc.

**Player list item (`player_status_item`) [DATA]:**
- Nodes: `emoji_ref_rect`, `connect_status/{mask_dead, mask_reconnect, mask_quit}`, `icon_self` (green person), `icon_watch_other` (eye), `player_hp`, `action_status/{complete_part ✓, moving_part •••}`.
- `normal_ob_part/btn_ob_other` "前往查看"; `disable_ob_part` (`EventOnBtnObNotAvail`); `cancel_ob_part` "返回战场".

**Observe panel (`AutoChessBattleObInfoPanel`) [DATA]:**
- Nodes: `_textNickName`, `_textNickNumber`, `_obOtherPartGO` (👁 name#1234), `_obSelfPartGO` ("你自己"), `_obEmptyPartGO` ("无人在家"), `_obOverviewPartGO` (overview; design text "全屏", the shipped screenshot says **"全景"**), `_leftArrowGo`, `_rightArrowGo`.
- A player-quit overlay reads "当前玩家已离开 / 可自行切换查看其他玩家".
- Toasts: `AUTO_CHESS_BATTLE_ALREADY_OBSERVE` and `AUTO_CHESS_BATTLE_OBSERVE_NOT_AVAIL`.

**View model (`AutoChessBattlePlayerStatusGroupModel`) [DATA]:** `canObserveOther`, `canObLeft/canObRight`, `m_leftBattleObIdx/m_rightBattleObIdx`, `m_mapLayer` (`AutoChessBattleMapLayer {START, LEFT, MID, RIGHT, END}`), `isObOverview`, `FindFirstAvailObTarget`, `CheckIfCancelObValid`.

**Waiting and phases [DATA][VIDEO]:**
- Bottom tips (`panel_bottom_tips`): `TIP_WAIT_FINISH` = **"⌛ 作战结束，等待队友完成作战"**, plus `TIP_READY`, `TIP_HAND_FULL` and `TIP_HAND_OVERFLOW`.
- Bahamut screenshots after combat show only that pill, with **no** view switcher. Finished teammates show ✓ and fighting ones show •••.
- Round result dialog: "作战结束" + "全员无伤！" (perfect), or "生命值减少" plus an LP loss.
- HUD phase capsule: 休息一下 / 开始作战 / 联防开始.
- `battle_waiting_dialog` reads "模拟即将继续 / 正在等待当前阶段结束……" (reconnect or late join).
- Elimination: `self_dead_dialog` has KEEP_WATCH and QUIT_GAME options, and auto-observe via `DeadAutoObUp`/`DeadAutoObDn { obIndex, state, preparation }`.

**Spec**

| Situation | What you see and can do | Tag |
|---|---|---|
| Prep | Tap a teammate avatar → "前往查看" → their board, read-only, including their pen and bonds. Pill "👁 name#1234". "返回战场" or your own avatar returns. `ObserveUp{obIndex}` / `CancelObserveUp`. | DATA + WIKI |
| Own combat running | You watch **your own** field. Observing others is **not offered** ("如果感到无聊…下一个休整期开始之前" and `canObserveOther`). Tapping shows the NOT_AVAIL toast. | ASSUMED (consistent with WIKI and DATA) |
| Own combat finished, others still fighting | Pill "⌛ 作战结束，等待队友完成作战". Your field freezes as it ended. Avatars become tappable → "前往查看" to watch a teammate's live battle. | WIKI + VIDEO |
| 联防 (helpers) | Banner/dialog "联防阶段" (help_battle_dialog with the orange assist robot), capsule "联防开始", kill capsule `n/m`, bond strip "层数叠加已禁用". Helpers fight on the shared escaped field (`escaped_single` for 1 helper, `escaped_multi` for 2). With 2 helpers the enemies enter at col 18 and cross the **right half** (helper 2) and then the **left half** (helper 1), in series like the Final Assault. The pill offers ‹ LEFT half / 全景 / RIGHT half ›: "你自己" on your half, "👁 name#" on the partner's. | DATA + VIDEO |
| 联防 (non-helpers) | Same banner. The camera goes to the 联防 field as an observer, with the ‹ 👁 helper# › pill. Owners' LP drops live as enemies escape; the capsule's `tag_miss` shows the escaped count. | VIDEO + DATA |
| Final Assault | Your pair's field only. The pill offers ‹ LEFT / 全景 / RIGHT ›. The other pair cannot be observed (NOT_AVAIL). Team LP and the shared boss HP bar are in the capsule. After 150 s the team LP drains 1/s. | DATA + VIDEO |
| Eliminated or quit | Choose keep-watching or quit. Keep-watching auto-observes the first available field and can switch freely. A quit target shows "当前玩家已离开". | DATA |

### 3.2 Official combat computation model [DATA: client il2cpp class and field names]

The scene server is separate. `ActAutoChessSyncInfoBattleInfo { sceneId, address, token, modeId, endTime, curRound }` gives a dedicated address and token.

**Server → client:**

| Message | Contents / use |
|---|---|
| `AllStateSyncDn` | `{ modeId, stageId, bossId, hiddenBossId, **stageSeed**, uidIndex, bannedBonds, staticPlayers, sceneDetail }` |
| `PreparationStatusDn` | `{ uidIndex, hp, round, store, charChess, equipChess, trapChess, positions, bonds, selfChoice, maxDeploymentCnt, effectEnemies, roundAnalytics }`: the server is authoritative for prep. |
| `ChangePositionDn` | `{ boardStatus }`: every player's board, so every client knows every board. |
| `StepDn` | `{ seq, duration, actions: [{ playerUidIndex, operate, paramList }] }`, where `operate` ∈ ENEMY_KILLED, ENEMY_ESCAPED, COST_BOSS_HP, SUMMONED_ENEMY_ESCAPED, ENEMY_APPEAR, SUMMONED_ENEMY_APPEAR, ENEMY_FINISHED, BOSS_STATE_CHANGED, BATTLE_STATE_CHANGED, PLAYER_STATUS_CHANGED. |
| `HistoryDn` | `{ steps }`, for catch-up. |
| `ChatDn`, `BroadcastDn`, `PlayerStatusDn`, `PlayerKickDn` | Emotes, ticker, player status, kicks. |
| Per-round battle data | `SelfBattleInfo { enemyInfos: [{ enemyId, actionIndex, instIdList }] }` |
| 联防 setup | `HelpBattleInfo { escapedEnemies: [{ ownerPlayerIndex, enemyId, enemyInstId, isToken }], players: [{ deployment, charBattleStatusList: [{ instId, hp, tech }] }] }` |
| Boss setup | `BossRoundInfo { isHiddenBoss, bossId, hp, groupInfos: [{ group, players }] }` and `BossBattleInfo { group, bossHp, enemyCount, enemyGroup, players }` |

**Client → server:**

| Message | Contents / use |
|---|---|
| Prep intents | `ShopBuyChessUp{slotId,isSpecial}`, `ShopRefreshUp`, `ShopFrozeUp{isFrozen}`, `ShopUpgradeUp`, `ChangePositionUp{deployCount,unitPositionInfo}`, `UseEquipUp`, `UseMagicUp`, `DestroyChessUp{chessInstId,chessType}`, `SelfChoicePickUp`, `SpPreparationPickUp`, `PreparationReadyUp{readyType: READY/CANCEL_READY}`, `ActionUp{seq,actions}` |
| Own combat | `SelfBattleKillEnemyUp{record{enemyInstId,attackerInstId,damageSrc}}`, `SelfBattleEnemyEscapeUp{enemyInstId,isToken}`, `SelfBattleAddBondUp{charInstId,layerDelta,bondIndexList}` (<战斗中> stacks), `SelfBattleInfoUp{round,charBattleStatusList,charBattleInfoList}`, `SelfBattleFinishUp{round,fromRejoin,escapedInstIds,escapedTokenInstIds,killedInsts,charBattleStatusList}` |
| 联防 | `HelpBattleKillEnemyUp{enemyInstId,isToken,killedByPlayer,attackerInstId,damageSrc}`, `HelpBattleEnemyEscapeUp`, `HelpBattleFinishUp{round,fromRejoin,escapedEnemies,killInfos}` |
| Other | `ObserveUp{obIndex}`, `ChatReq{emojiGroup,emojiId}`, `BroadcastUp{uIdx,broadcastId,strParams}` (clients announce their own damage milestones), `LoadingReadyUp{roundEnemies}`, `PauseUp`/`ResumeUp` (solo only), `QuitUp` |

**What this means:**
1. **Combat is client-simulated.** The server never sends unit positions. It receives outcome events and relays them in `StepDn`, which drives the teammates' capsules and LP.
2. Every client holds everything needed to **replay any teammate's battle deterministically**: `stageSeed`, all boards with directions, and enemy lists. Observing a teammate most likely runs a local replica sim, with `StepDn` as the authoritative counters [ASSUMED].
3. The 联防 is set up by the server from the reported leaks and the helpers' end-of-combat HP/SP (`tech`). The helpers' clients simulate it and report `killedByPlayer`, which drives the bounty payout to whichever helper killed.
4. The boss HP is a server-side pool. Pair clients report `COST_BOSS_HP`. Bahamut 12294 notes "網速不好/幀率過低可能會導致boss戰傷害丟失" [COMM].
5. This also matches the general Arknights design: single-player battles have only `battleStart`/`battleFinish` endpoints in every community server emulator (LocalArknights, OpenDoctoratePy) [COMM].

---

## 4. Emotes

### 4.1 Official rules

| Item | Value | Tag |
|---|---|---|
| Message | `AutoChessBattleSceneChatReq { emojiGroup, emojiId }` → `ChatDn`; `AutoChessChatData { uid, emojiGroup, emojiId }`. There is no free text anywhere in 盟约. | DATA |
| Bubble | `autochess_emoji_pop_item = bkg (emoji_bubble_bkg 108×97, a dark rounded square with a tail pointing left) + emoji_icon`. **Icon only, no text.** Anchored at `player_status_item/emoji_ref_rect`, i.e. to the right of the sender's avatar in the left player list. `AutoChessEmojiPopPanel { _popupTime, _chatItemAnim, … }`: pop animation, shown for `chatTime` = **3 s**. A new emote replaces the old one (`m_switchTween`). | DATA |
| Button | Bottom-left **交流** (`emoji_btn` 151×55 with a robot-face icon; `AUTO_CHESS_EMOJI_BTN`). It is greyed (`emoji_btn_disable`) during the cooldown `chatCD` = **1 s** (`_DisableEmojiBtnForAWhile`). | DATA |
| Panel | `autochess_emoji_panel`: `emoji_bkg` (313×231) with a horizontal `scroll_pager`, one page **per theme**, `dot_content` pager dots, and 6 cells (`emoji_cell_bkg` 85×85, 3×2). Swipe left/right to change theme ("在表情发送界面左右滑动来切换主题" [WIKI]). Tapping a cell sends it and closes the panel, with a click animation. The client remembers the last-used theme (`ClearLastUseEmoticonThemeId`). | DATA + WIKI |
| Scenes | `AUTOCHESS_ROOM` = room/lobby (10 emotes, basic theme). `AUTOCHESS_BATTLE` = in match (6 per theme). Themes are enabled by `enabledEmoticonThemeIdList`; the free ones are `isBasic: true`. We unlock all. | DATA |

### 4.2 All emotes (`display_meta_table.emoticonData`, zh_CN) [DATA]

`desc` is `null` for every autochess emote, so any label is ours and is used only as a tooltip or aria-label, never displayed. The suggested labels come from BWIKI where one exists: basic_2 and slug from the BWIKI tabs, basic ones [ASSUMED].

**Theme `emoticon_autochess_basic`** (sortId 100000, isBasic)

| id | scene | sortId | picId | label (ours) |
|---|---|---|---|---|
| autochess_battle_happy | BATTLE | 1001 | pic_happy_battle | 开心 |
| autochess_battle_scared | BATTLE | 1002 | pic_scared_battle | 害怕 |
| autochess_battle_sorry | BATTLE | 1003 | pic_sorry_battle | 对不起 |
| autochess_battle_thanks | BATTLE | 1004 | pic_thanks_battle | 谢谢 |
| autochess_battle_thinking | BATTLE | 1005 | pic_thinking_battle | 思考 |
| autochess_battle_nice_cooperate | BATTLE | 1006 | pic_cooperate_battle | 合作愉快 |
| autochess_room_hello … working (10) | ROOM | 1–10 | pic_hello, pic_thanks, pic_happy, pic_question, pic_sorry_2, pic_scared, pic_thinking, pic_waiting, pic_cooperate, pic_working | room only; **sprites not present in the local client bundles** |

**Theme `emoticon_autochess_basic_2`** (sortId 100001, isBasic; new in 下半)

| id | sortId | picId | label (BWIKI) |
|---|---|---|---|
| autochess_battle_noproblem | 1007 | pic_noproblem_battle | 没问题！ |
| autochess_battle_respect | 1008 | pic_respect_battle | 敬礼！ |
| autochess_battle_call | 1009 | pic_call_battle | 欢呼！ |
| autochess_battle_playingcool | 1010 | pic_playingcool_battle | 酷！ |
| autochess_battle_sad | 1011 | pic_sad_battle | 伤心 |
| autochess_battle_dying | 1012 | pic_dying_battle | 快死了 |

**Theme `emoticon_originium_slug`** (sortId 1001; 促融共竞#1 reward)

| id | sortId | picId | label (BWIKI) |
|---|---|---|---|
| slug_autochess_battle_nice_work | 2001 | pic_nice_work_battle | 合作愉快！ |
| slug_autochess_battle_thanks | 2002 | pic_thanks_battle | 谢谢！ |
| slug_autochess_battle_sorry | 2003 | pic_sorry_battle | 对不起！ |
| slug_autochess_battle_bye | 2004 | pic_bye_battle | 再见！ |
| slug_autochess_battle_distrust | 2005 | pic_distrust_battle | ？？？ |
| slug_autochess_battle_very_soon | 2006 | pic_very_soon_battle | 很快就好！ |

**Theme `emoticon_foolsday_doctor`** (sortId 1002; paid April Fools)

| id | sortId | picId |
|---|---|---|
| autochess_battle_fooldoctor_01 | 1020 | pic_fooldoctor_01_battle |
| autochess_battle_fooldoctor_02 | 1021 | pic_fooldoctor_02_battle |
| autochess_battle_fooldoctor_03 | 1022 | **pic_fooldoctor_04_battle** |
| autochess_battle_fooldoctor_04 | 1023 | **pic_fooldoctor_05_battle** |
| autochess_battle_fooldoctor_05 | 1024 | **pic_fooldoctor_06_battle** |
| autochess_battle_fooldoctor_06 | 1025 | **pic_fooldoctor_08_battle** |

Note that ids 03–06 map to pics 04/05/06/08. Use `picId`, never the id suffix.

**Theme `emoticon_foolsday_amiya`** (sortId 1003): `autochess_battle_foolamiya_01…06`, sortId 1040–1045, `pic_foolamiya_01…06_battle`.

**Theme `emoticon_foolsday_wisdel`** (sortId 1004): `autochess_battle_foolwisdel_01…06`, sortId 1060–1065, `pic_foolwisdel_01…06_battle`.

**Page order:** proposed as `enabledEmoticonThemeIdList` order, i.e. basic, slug, basic_2, fooldoctor, foolamiya, foolwisdel [ASSUMED]. Alternatively sort by theme sortId.

### 4.3 Local client sprites (all contain **no text**) [DATA]

All in `StreamingAssets/AB/Windows/ui/emoticon/theme/`:

| Bundle | Sprites |
|---|---|
| `[uc]emoticon_autochess_basic.ab` | pic_happy_battle, pic_scared_battle, pic_sorry_battle, pic_thanks_battle, pic_thinking_battle, pic_cooperate_battle (120×120 each; mint octagon glyphs) |
| `[uc]emoticon_autochess_basic_2.ab` | pic_noproblem_battle, pic_respect_battle, pic_call_battle, pic_playingcool_battle, pic_sad_battle, pic_dying_battle (120×120) |
| `[uc]emoticon_originium_slug.ab` | pic_nice_work_battle, pic_thanks_battle, pic_sorry_battle, pic_bye_battle, pic_distrust_battle, pic_very_soon_battle (≈102–112×79–99), plus room and pick pics (pic_hello, pic_bye, pic_coming, pic_distrust, pic_exchange, pic_hurry, pic_mefirst, pic_nice_work, pic_sorry, pic_thanks, pic_ufirst, pic_very_soon) and pic_bg |
| `[uc]emoticon_foolsday_doctor.ab` | pic_fooldoctor_{01,02,04,05,06,08}_battle (≈114×115) |
| `[uc]emoticon_foolsday_amiya.ab` | pic_foolamiya_0{1..6}_battle (110–115×115) |
| `[uc]emoticon_foolsday_wisdel.ab` | pic_foolwisdel_0{1..6}_battle (112×115) |

The autochess **room** pics (pic_hello, pic_question, pic_waiting, pic_working, pic_sorry_2, …) are **not** in any local bundle. Keep room emotes out of scope, or reuse the battle glyphs.

The public mirror (ArknightsAssets2 `cn`, `ui/emoticon/theme/[uc]<themeId>/icon/<picId>.png`) has the same 36 battle sprites, at the same sizes (checked 2026-10-03); since v0.1.2 `tools/fetch-assets.mjs` downloads them and the client uses them when the local art is absent (DESIGN §22.5, GitHub issue #42).

---

## 5. Other prep interactions we may have missed

| Item | Official | Tag |
|---|---|---|
| Sell | Tap the unit (board **or bench**) → underframe → **出售** with a "+1" coin badge (funcId `autochessSale`; PC hotkey slot `pc_key_holder`). There is no drag-to-sell. | DATA + WIKI |
| Retreat | Drag the unit onto the bench (整备区) ("拖拽干员至整备区可以直接撤退干员"), or use the underframe 撤退 button. | DATA + WIKI |
| Items and Arts | Cannot be sold. Tap → underframe **销毁** (`_underFramePanelBtnParamDestroyPos`, `icon_destory`) → `DestroyChessUp`. | DATA |
| Buy | Two taps: the first tap on a shop card shows its detail and the **确认购买** state (`EventOnFirstClick`); the second buys (`EventOnConfirm`). If it can't be bought the card shows **无法购买**. | DATA |
| Upgrade | The same two-step confirm (`EventOnFirstClick` → `EventOnUpgrade`). At level 6 it shows **已满级**; a disabled click without funds gives `EventOnUpgradeNotEnough`. | DATA |
| Ready | 准备完成 / 取消准备 (`PreparationReadyUp` READY / CANCEL_READY), until everyone is ready. | DATA |
| Strategy draft | A strategy picked by a teammate is marked **队友已选** (guidebook page 策略与轮选, `autochess_handbook_4`), so duplicate strategies are **not** allowed. This corrects the "Allowed" assumption in 06 §4.2. | DATA (guide image) |
| Auto-arrange | None found. | DATA (no such UI) |
| Deploy order at combat start | Top→bottom, then left→right (盟约下; it matters for taunt). The prep pieces vanish and redeploy with the deploy animation. | COMM + VIDEO |
| Info | The left 🔍 opens 本局信息: mode, your strategy, disabled bonds with the banned operators. | DATA |

---

## 6. Changes required in our implementation

### 6.1 Facing (user item 7)

1. **Protocol.**
   - `g.move {uid, to:{area:'board',row,col}, dir}` with `dir ∈ 'UP'|'RIGHT'|'DOWN'|'LEFT'`; the server defaults to `'RIGHT'` when absent, for bots and old clients.
   - `g.art {itemUid,row,col,dir}`.
   - Broadcast `dir` in the board state (public and private views, snapshot `UnitInfo.dir`).
2. **`server/match/PlayerState.js`.**
   - Store `piece.dir`, preserved across rounds.
   - In `_moveChessToBoard` and `_moveTokenToBoard`, `if (occ === piece) return OK;` must become "update `piece.dir`, recompute, OK". This is the in-place re-orient.
   - Swaps keep each piece's own dir.
   - Pieces spawned onto the board by effects get `'RIGHT'`.
   - `useArt` passes dir to the 画卷 "front" lookup.
3. **Sim (`server/sim`).**
   - Replace scalar `facing ±1` with a direction vector `(fr, fc)` ∈ {(1,0) UP, (0,1) RIGHT, (−1,0) DOWN, (0,−1) LEFT} (row 0 = bottom). Keep `facing` as a derived helper only where a horizontal sign is needed for sprite flip.
   - `targeting.absoluteRangeKeys(grid, r, c, dir, extend)`: apply `rangeExtend` along +dCol **before** rotating. Rotation per DATA.md: RIGHT `(dr,dc)`, UP `(dc,−dr)`, LEFT `(−dr,−dc)`, DOWN `(−dc,dr)`.
   - Every "in front / behind / left-right of" helper uses the vector:
     - `bonds/core.js` `S.frontTile` and the devour order ("更靠左" = back-most along the facing)
     - `professions.js` front checks (the `(x − unit.x)·facing` tests)
     - `skills.js` trigger grids
     - `tokens.js` placement grids and Mech/device helpers
     - kits tier3 (`displace` direction, 薄绿 pull tile) and tier4 device placement
     - `content/devices.js` blower relation: `equal` if the operator dir == blower dir, `opposite` if reversed, otherwise none. Today only fx is compared, so the DOWN blowers never buff anyone.
     - Items 叙拉古正装 (perpendicular pair), 歌利亚头盔 (front tile), 画卷 `1-1`.
4. **`server/match/finalAssault.js`.** The right-side mirror becomes col `c→20−c` with dir RIGHT↔LEFT; UP and DOWN are kept (not a flat `facing=−1`). FA prep on the right half shows the mirrored layout, and moves there go through the wheel in mirrored coordinates.
5. **Client.**
   - `public/js/render/drag.js` + `ui/gameLogic.js`: after a legal drop on a board tile (also the same tile), enter a **direction step** instead of sending `g.move` immediately. Draw the white diamond with 4 chevrons, the red "✕ 点击取消" tag at its upper-left, and live orange-striped rotated range tiles. Show the tooltip "拖回中心区域取消" when outside the centre. Mouse or touch drag from the centre with a ~0.5-tile dead-zone; release sends `g.move{…,dir}`; release in the centre or tap ✕ cancels.
   - The same flow applies to Arts (`g.art`).
   - `render/units.js`: the orange ground wedge rotates to `dir`; model choice Back for UP (as ASSETS.md already says) and Front/mirror otherwise. Remove the "no facing step" comments.
   - **Tap a board unit:** show its range tiles and the underframe with 撤退 / 出售 +1 (see 6.5).
6. **Docs.** `DESIGN.md` §3 "Facing: operators have no facing step" and `06-multiplayer-ux.md` §11.2 "There is no facing step in auto-chess [ASSUMED]" are **wrong**. Replace them with §1.2 of this file.

### 6.2 Enemy preview pen (user item 2)

1. **Server.** Extend the private prep state `nextEnemies` to entries `{enemyKey, gate:'upper'|'lower', t (spawn time s), fly, source:'wave'|'effect'}`, one per instance or grouped with counts. Include bounty, 特训, 教鞭 and 神秘顾客 extras. For boss rounds add `{boss:true}` entries targeting the boss field.
2. **Renderer (`public/js/render/app.js`).** The pen rows 14–18 are already drawn as scenery (`bandFor` [6,18]).
   - Add a `PreviewPen` layer that spawns idle, left-facing enemy spines per §2.2: rect ((14,7),(18,13)), skip row 16, upper rows 17–18, lower rows 14–15, time-sorted, ≤3 per tile with jitter, cap 50.
   - No HP bars and no simulation. Clear it at combat start.
   - Enemy spines are already loaded per round, so reuse the impostor/LRU budget (≤50 extra cheap skeletons; use `impostor.js` beyond ~20 for performance).
3. **Camera.** Make the prep preset keep the pen's front edge visible at the top (official look). Add `setCamera('pen')`, a 0.25 s pan toward rows 14–18, driven by a HUD toggle: right **[🔍▶▶]**, amber; in the pen view the left button becomes **[🔍◀◀]** and the right one greys out.
4. **UI.** `ui/enemyDrawer.js` (our list drawer) is not official. Make the pen the primary view and keep the drawer only as the tap-an-enemy detail source, or behind the left 🔍 "本局信息" dialog. When viewing a teammate in prep, render **their** pen.

### 6.3 Spectating and combat flow (user item 5, UX part)

1. Remove the always-visible `‹ 自己 ›` switcher from normal combat (`ui/combatHud.js`).
2. Normal combat, own battle running: team avatars are **not** watchable (toast "当前无法查看").
3. After your own battle ends:
   - pill "⌛ 作战结束，等待队友完成作战"
   - tapping an avatar expands a "前往查看" button; while observing, your row shows "返回战场", the target row an eye badge, and the bottom pill "👁 {name}#{number}"
4. Prep: the same avatar → 前往查看 flow (read-only board + pen).
5. 联防 and FA fields: the ‹ › pill cycles LEFT half / 全景 / RIGHT half, with captions "你自己" / "👁 name#" / "全景". Non-helpers are auto-moved to the 联防 field as observers. In FA the other pair's field is not selectable.
6. Eliminated players: a dialog offers 继续观战 (auto-observe the first live field, free switching) or 退出.
7. `server/match/Match.js watch()` must enforce the same rules (prep: any teammate; combat: only if your own field finished; FA: own pair only; dead: anything).

### 6.4 Combat computation model (user item 5, architecture) [proposal based on §3.2]

Mirror the official split. This lets a low-power Windows mini-PC host the game.

1. **Server (authoritative, cheap).**
   - Lobby, economy, shop, pool, boards with dir, 机变, bounties, LP, phase timers, seeds.
   - Per round it sends each client `{seed, round, boards of all players, per-player enemy list (instIds), stage}`.
   - It **does not run battles**. It keeps the existing `server/sim` for bots-only rooms and for optional verification (run a player's battle at low priority after the round and compare the kill/escape set; flag the player on mismatch; don't block).
2. **Client.** Runs `server/sim` in a Web Worker. It is already deterministic: no `Math.random`/`Date.now`; only `simdata.js` uses `node:fs` and needs a fetch-based loader.
   - Fixed tick 1/30 at 2×.
   - Report `kill{enemyInstId, attackerUid, src}`, `escape{enemyInstId}` and `bondDelta{uid, delta, bonds}` as they happen.
   - At the end report `finish{round, escapedInstIds, killedInstIds, unitStatus:[{uid,hpRatio,sp}], stats}`.
   - The server relays counters to teammates, like the official `StepDn`.
3. **Divergence rules.**
   - The server only accepts instIds it issued.
   - An instId is counted once, first report wins.
   - A missing `finish` by `maxPlayTime + grace(10 s)` means everything not reported killed is escaped (the official timeout rule: "超出一定时间，则视为剩余敌人入侵成功").
   - Reconnect: the client resubmits with `fromRejoin`, or the server re-sims that board from the seed.
4. **联防.**
   - The server builds `{escapedEnemies:[{ownerId, enemyKey, instId}], helpers:[{playerId, deployment(with dir), unitStatus(hp,sp)}], seed}` and sends it to **all** clients.
   - One helper (the lowest seat) is the **authoritative simulator**. Other clients, including the second helper, run a replica for display only.
   - The server accepts the authority's kill/escape/finish reports. On authority disconnect the next helper takes over, or the server sims it.
5. **Final Assault.** Per pair field, the lower seat is authoritative and reports `bossDamage` deltas and kills. The server owns the shared boss HP (sum of both fields) and the team LP drain, and broadcasts the HP at ~5 Hz.
6. **Observing.** The observer runs a local replica of the target field from the same inputs, fast-forwarded to the server's elapsed round time. Official-style counters come from relayed events. This needs no snapshot streaming from the server, so bandwidth ≈ 0.
7. **Compatibility.** Keep `b.snap` streaming as a fallback for very weak clients (a server-side sim flag per room).

### 6.5 Prep interactions

1. **Sell.** Tap the unit (board or bench) → underframe with **出售 +1** (and 撤退 on board units). Remove any drag-to-sell zone.
2. **Items and Arts.** Tap → **销毁** only.
3. **Shop.** First tap shows the card detail and "确认购买"; the second tap buys.
4. **Upgrade.** First tap arms "升级" confirm; the second tap upgrades.
5. **Strategy draft.** Disallow a strategy already taken by a teammate; show "队友已选".

### 6.6 Emotes (user item 6)

1. `shared/constants.js`:
   - Replace `EMOTES/EMOTE_THEME/EMOTE_TEXT` with the 6 themes × 6 battle ids of §4.2 (`{themeId, id, sortId, picId}`).
   - Delete `EMOTE_TEXT` from display paths. Keep only an aria-label map.
   - Validate `g.emote {theme, id}` server-side, with a 1 s cooldown (already there).
2. `public/js/ui/emotes.js`:
   - `EmoteBubble` renders **the picture only**: dark rounded square, tail toward the avatar, 3 s, pop animation, replace on a new emote.
   - `EmoteWheel`: a pager with one page per theme (3×2 grid of 6), pager dots, swipe or arrow keys, remembering the last theme (localStorage).
   - The button is disabled for 1 s after sending.
   - Fallback when art is missing: a neutral glyph, never text.
3. `tools/local-extract/extract.py` gains 4 more bundles:
   - `ui/emoticon/theme/[uc]emoticon_originium_slug.ab` → `emoticon/slug` (only the `*_battle` sprites)
   - `[uc]emoticon_foolsday_doctor.ab` → `emoticon/fooldoctor`
   - `[uc]emoticon_foolsday_amiya.ab` → `emoticon/foolamiya`
   - `[uc]emoticon_foolsday_wisdel.ab` → `emoticon/foolwisdel`
   - Paths are keyed by `picId` (note fooldoctor 03–06 → pic 04/05/06/08).
   - Update `data/local-assets.json` and `emoteArtPath(theme, picId)`.
4. Bot emotes (if any) use the same ids.

---

## 7. Corrections to earlier research

| File | Old statement | Correct |
|---|---|---|
| 06 §11.2 / DESIGN §3 | "There is no facing step in auto-chess" | 4-direction AK deploy wheel (§1) |
| 06 §11.2 | "Selling [ASSUMED drag onto the funds card]" | 出售 +1 on the unit's selection diamond (§5) |
| 06 §4.5 / §11.3 | "A bottom view switcher ‹ 自己 › cycles through teammates' live battles" | No switcher in normal combat; avatar → 前往查看 after your own combat ends; ‹ › only in 联防/FA fields (§3.1) |
| 06 §4.5 | "All boards fight at the same time on the server" | Each client simulates its own board; the server aggregates events (§3.2) |
| 06 §11.1 | "Enemy-preview button … a separate tiled grid" | The pen is part of the stage scene behind the gates (rows 14–18), visible at the top edge in prep; the button pans the camera (§2) |
| 06 §9.1 | 3 free themes + 3 paid, emote wording "没问题！…" | Correct themes; bubbles are image-only; `desc` is null; the room pics are missing from the local client (§4) |
| DESIGN §3 | "Enemy preview pen … (we show the preview in DOM instead)" | Render the preview in the pen (§6.2) |
| 06 §4.2 | "Duplicate strategies [ASSUMED] Allowed" | Not allowed: "队友已选" (§5) |

---

## 8. Sources

**Local client (Windows build, CrossOver bottle).**
- `…/AB/Windows/ui/autochess/[uc]autochessbattle.ab`: GameObjects, Text ids, sprites, onClick bindings.
- `…/ui/emoticon/theme/*.ab`
- `…/arts/guidebookpages/[pack]autochess.ab`: 19 in-game help pages, including 休整期 (orange facing wedge) and 策略与轮选 (队友已选).
- `…/Arknights_Data/il2cpp_data/Metadata/global-metadata.dat` (v29): class and field names and the `MAX_PREVIEW_CNT` constant.

**Game data.**
- `.cache/gamedata/excel/activity_table.json` `autoChessData` (gameTipsList, constData chatCD/chatTime, enabledEmoticonThemeIdList)
- `levels/activities/act*autochess/level_*_m0*.json` configBlackBoard
- `level_act1autochess_escaped_{single,multi}.json`
- `display_meta_table.json` emoticonData (Kengxxiao zh_CN, downloaded to the scratchpad)

**Official.** 「卫戍协议：盟约」玩法介绍 long image: https://img.71acg.net/sykb~bbs/pc/1763033996225879

**Wiki.** BWIKI 盟约: https://wiki.biligame.com/arknights/盟约 (互动, 联防, 观看队友)

**Videos.**
- BV1tFUAYnEfZ (新手引导实况, 4:56–5:14: deploy wheel)
- BV1H3wtziEbY (全攻略教程, 下半 prep and pen)
- BV1h6DjBoE3T (身前一格 garrisons)
- BV1NbCiBHELD
- BV11cg36qEfA

**Screenshots.**
- https://i.meee.com.tw/wdRAguq.png (pen)
- GwtDIAW (联防)
- YRY8ar1 (FA ‹全景›)
- Bahamut c32edaf…, 4995084…, 05db364c…, fc6673cd… (prep and "等待队友完成作战")

**Community.**
- Bahamut https://forum.gamer.com.tw/C.php?bsn=33651&snA=12294 (放大镜出怪路线, boss-damage loss, deploy order)
- Bahamut https://forum.gamer.com.tw/C.php?bsn=33651&snA=12316
- NGA https://nga.178.com/read.php?tid=45645958 (FA mirror, 朝向)
