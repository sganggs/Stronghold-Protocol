# DESIGN §6, §16 — The match and meta engine (server/match), operator loadouts

Part of [DESIGN.md](../DESIGN.md) (the index; section numbers are global).

## 6. Match & meta (server/match)

### 6.1 State machine (Match.js)

```
LOBBY(room) → INFO_CHECK (co-op 25 s; solo and any single-human match untimed (§18.2); all ready ⇒ skip; the operator loadout (§16) locks when it ends) → BAND_DRAFT (co-op: random order — the room option 「AI 队友最后选择」 (host, off by default; `room.setAiPicksLast`) puts every human seat before every AI seat, each group keeping the drawn order, and draws no extra random number; a skipping human goes behind the other humans still to pick and ahead of the AI seats, or to the very end when no other human remains [ASSUMED] —, ONE countdown — `BAND_TURN_SECONDS` 50 s per turn = m.public.deadline, AI seats pick at once, 1 skip each, a strategy a teammate already took is refused (队友已选), timeout ⇒ the strategy the player highlights (`g.bandFocus`) while free, else band_bldsk, else the first free one; solo: free pick, no timer, no skip; a single human: untimed) → BATTLE_CHECK (3 s)
→ loop r = 1..lastRound:
     ROUND_START   (income, upgrade price −1 (floor 0), temp NOT wiped — what overflowed after the last prep's deadline is shown in this
                    prep (§6.2 temp overflow), unfrozen shop slots rerolled, frozen kept; a strategy's 「进入休整期时」 grants and the
                    traits' <进入休整期时> effects wait for PREP, DESIGN §35.24 / §35.53)
     [SP_DRAFT]    (if r ∈ spRounds: 机变 draft; co-op: random order (「AI 队友最后选择」, off by default: humans first, the same partition as the strategy draft), 30 s first picker / 16 s others; solo 3 cards; solo / single human untimed;
                    a card is picked with two taps, §18.2)
     PREP          (onPrepStart: the strategies' 「进入休整期时」 grants — 老鲤, 松桐, 杜宾, 娜仁图亚, the preparation_start_* keys —
                    and the traits' <进入休整期时> effects (META.md §2.3), after the 机变 draft, GitHub #851, DESIGN §35.24 /
                    §35.53; co-op: timer from config, ends when all alive humans+bots ready;
                    solo / single human: untimed, ends on ready)
     PREP_END      (<休整期结束时> effects; unfrozen shop cleared; Ready is blocked while a personal choice or temp overflow is pending;
                    at the deadline personal choices are auto-picked first, then
                    the temp pieces due at this prep are resolved (chess sold back, items destroyed, summon stacks removed — they come back at the next round start, §20.1) — pieces that arrived
                    after Ready or during the <休整期结束时> effects wait for the next prep (§6.2 tempDue))
     COMBAT        (one Battle per alive player, all in parallel, 2×; watchers get snapshots; solo: pausable, §14 Solo pause)
     UNITE         (co-op only, if ≥1 leaked & ≥1 perfect: ≤2 perfect helpers in `unite.js helperOrder` order (research 08 §5 / PRTS 帮助:
                    most units on the field > an active bond > most standing units > seat; the pair ordered by units > active bond >
                    Σ active layers > standing > seat, the first one on the right-hand field) fight the union of leaks; no layer gains — with
                    the layers their own combat reached (the round's pending gains, PRTS "以其阵地当前的状态" [ASSUMED]);
                    a helper's operator knocked out at the end of its own combat enters down — carryState { down: true },
                    PRTS "上一阶段为退场状态的干员强制退场", its full redeploy timer — confirmed by the user (§19.3))
     SETTLE        (LP −min(leaks,10) per player (unite survivors to their source); eliminations; layer gains applied; coins; broadcast;
                    after a 联防 the outcome and every player's charge ride the SETTLE m.public as `uniteResult`, GitHub #235)
   R14 FINAL_ASSAULT (merged team LP; random pairs fixed for this match; shared boss pool; 120 real s countdown, no hard stop; overtime −1 team LP per
                    real s after 120 real s, or 150 with an AI teammate at fight start (§29.1, m.public.overtimeAt); no layer gains; team LP 0 ⇒ defeat at once (PRTS 直接失败),
                    pool 0 ⇒ victory — the first end the server registers decides, §20.5)
   R15 HIDDEN_CORE  (if difficulty ≥ NORMAL and Σ activated layers > 350 solo / 1200 co-op and team LP > 1 — GitHub #645)
→ RESULT (per-player stats, titles, rounds passed, victory/defeat)
```
Solo FUNNY has 9 rounds (boss at R9); everything is read from `data/config.json → modes[modeId]`.

Shop layouts are version-specific (`config.modes[modeId].shopSlots`, official
`activity.AUTOCHESS_SEASON[season].shopLevelDataDict[modeId][level].charChessCount` / `itemCount`). Both 第一期
builds have no equipment slot at levels 1–4 and one at 5–6; 第二期上半 and the default have one at 1–6 in every
lobby mode. Training, which the lobby does not offer, has one only at 5–6 in every version. An upgrade opens
new slots empty; refresh / the next round fills them. The private shop view includes its actual `{ chess, item }`
layout so an empty equipment slot stays in the equipment column. A mode with zero equipment slots shows no sold
equipment placeholder. Verification and sources: [§36.1](../history/0.3.3.md).

A first-season solo (`config.version.rules.soloTimed`, DESIGN §35.22.7) is not `soloUntimed` unless the room's
「不限时」 is on (`room.setSoloUnlimited`, default off; `room.state` omits `soloUnlimited` unless true; the match is built
with `opts.soloUnlimited`, DESIGN §35.23.10). While it is off, INFO_CHECK, the strategy draft, 机变 and preparation use
their clocks (preparation 300 s, 机变 150 s; the other two use the co-op lengths, because they read `soloUntimed`). A
co-op match with one human stays untimed. A second-season solo stays untimed.

P1b plugin modes inherit an official mode and may override economy and other global configuration field by field in `GameData` (DESIGN §32.5). Original modes retain the same values and behavior; room mode selection belongs to P1c.

### 6.2 Player state (PlayerState.js) — authoritative per player

```js
{ playerId, seat, name, isBot, connected,
  alive, lp, bandId,
  funds, shop: { level, upgradePrice, slots: [ Slot ], frozen: bool, freeRefreshes: n, rewardOffer: null | { tier, source:'merge'|'special', label, queued, slots:[Slot] } },  // a special offer (凯瑟琳's 定向投放 …) by its source's label; queued = offers behind the shown one (§21.2)
  hand: [ Piece|null ×10 ], temp: [ Piece|null ×5, ...queuedPieces ],
  board: Map<'r,c', Piece>,                          // chess & token pieces on the normal field
  bonds: { [bondId]: { count, active, tier, layers } },  // layers persist all match
  effects: [ EffectRef ],                             // band/choice/team/garrison persistent effects & counters
  personalChoice: null | { id, round, sourceItemId, cards: [ BountyCard ] }, // private PREP offer; raw cards on the server
  counters: { refreshes, buys, sells, … },
  stats: { … for results } }
Slot  = { kind:'chess'|'item', id, price, sold:false, frozen }
Piece = { uid, kind:'chess'|'item'|'token', id /* chessId (golden id if elite) | itemId | tokenId */,
          items:[itemPiece...] (chess only, max 2), count (token stacks), ownerUid (tokens), boughtRound,
          meta: { round?: { r, n: { key: count } } } }   // per-piece counters of the current round, module-prefixed keys (拉普兰德's first refresh, §21.1)
```

Intent handlers (validate → mutate → recompute bonds → push private view): `buy(slot)`, `refresh()`, `freeze()`, `levelUp()`, `sell(uid)`, `move(uid, to)`, `equip(itemUid, targetUid, replaceUid?)`, `useArt(itemUid, row, col)`, `destroy(uid)`, `pickReward(idx)`, `pickChoice(idx)`, `setReady(bool)`. Every handler rejects when the phase forbids it (only PREP allows board/shop mutations; SP_DRAFT allows `pickChoice` only; reward pick allowed in PREP). Invalid intents return `error` with a code from `shared/constants.js → ERR` — the server never throws on bad input.

在所有官方版本的未就绪 PREP，干员手牌↔场上互换复用原有两个位置；休整区满或部署数达到上限均不阻止
合法互换，两个方向相同。手牌内、场上内互换同理；地形／召唤物合法性仍逐个检查。真正新增部署仍检查
部署上限，普通撤退仍需要手牌空位；满手牌仍拒绝购买和奖励选择，包括可立即合成的第三张。
**有意偏差（INTENTIONAL DEVIATION）：**官方第一期上／下半不允许满整备区互换，第二期才加入
（[官方公告 5114](https://ak.hypergryph.com/news/5114)）。维护者在 2026-10-25 阅知该证据后，明确决定
「第一期也允许互换」，因此取代 0.3.2 的第一期限制，作为四版本共用的便利功能保留
（[§36.2](../history/0.3.3.md#362-满休整区互换回归round53-benchswap2026-10-25)）。

Summons (§20.1): an operator on the board sends its manually deployable summons to the hand — deploy-limit copies in one stack, no deploy slot (tokens.json `placeable`, `gamedata.placeableTokens`); moving or swapping it sends its placed summons back to their stack, withdrawing or selling it removes them. A range-bound summon (tokens.json `ownerRange`: 狼群, 流形) goes only on a tile of its owner's attack range (`PlayerState._legal` / `summonRange`); in a swap each piece is checked from the tile it ends on; an in-place re-orientation or promotion that leaves it outside sends it back to its stack with a toast (one still inside stays [ASSUMED], user-confirmed 2026-10-03), and a re-orientation whose lifted summon would have no room is refused with `HAND_FULL`; on the other paths it leaves the board and joins the expandable temp queue (§32.14.21).

Equipment (research 04 §2 + addendum, 09 §1.2): 2 slots per chess; a third item on a full carrier replaces the equipped item `replaceUid` names (the replace dialog's pick, official `UseEquipUp.unloadInstId`; absent ⇒ the oldest; a uid not equipped on the target ⇒ `BAD_TARGET`, nothing changes) and the replaced item is destroyed. A consume-on-equip item (盟约之币, 博士投影 …) on a full carrier replaces the same way before it resolves, so the carrier is left with a free slot (the normal 博士投影 takes it until the next round start); a target its effect refuses (博士投影 on an elite) keeps both items — PRTS 卫戍协议/帮助 "达到上限强行佩戴会改为替换装备" names no exception (GitHub #263; the client opens the replace dialog for it, `equipReplaces`). Equipped items are otherwise **locked**: `destroy` (销毁) accepts hand / temp items only (`BAD_TARGET 'equipped items are locked'`); equipment goes back to the hand only when its carrier merges, is sold, or is destroyed by 突变细胞's transformation (the cell itself returns too; PRTS 帮助 "在失去该干员（干员出售、销毁、合并等）…时自动卸除", §21.1) — sales retain all returned equipment in the expandable temp queue; returned equipment is stowed before the operator a transformation gains and before a merge elite's summon cards, and every path that hands the player an item — returned equipment included — ends with the auto-merge, so no player holds two identical mergeable normal items (§21.7).

Economy/shop/pool/merge/hand rules: exactly as research 00-INDEX §3–§4 (income `min(3+r,12)`; prices by tier; refresh 1; freeze toggles all, and a successful manual refresh (paid or free) cancels it — the new cards are not frozen (DESIGN §32.14.7); sell +1; items not sellable; upgrade prices per mode with −1/round; single-player pool copies 12/14/18/16/8/5 plus measured exceptions; co-op shared operators use twice those counts, while equipment has separate shared stock (DESIGN §29.8), and so does each player's private 自选 stock (8 / 5 solo, 16 / 10 co-op — §32.14.31); elite = 3 copies; odds = copy-weighted draw over unbanned visible chess with tier ≤ level; merge 3 (风丸 2) → elite onto the consumed deployed copy's tile, else to the hand (§20.11) + reward offer of 3 **different** free chess of tier `min(level+1, 6)` (copy-weighted, including the player's stocked 自选 of that tier — one shop level before the ordinary shop, §30.23; a tier short of different chess tops up from the tier below [ASSUMED], §20.6); full hand blocks every buy / reward pick, a merge-completing one too (PRTS 卫戍协议/帮助 §手牌区, GitHub #82); overflow to temp; a free hand slot pulls the temp pieces back in at once, right → left (`PlayerState._fillHandFromTemp`); temp blocks ready).

**Advisor economy (§35.13–§35.14).** With a nonempty advisor plan, `economy.level` is a minimum: complete
merges, meet an affordable floor before fill purchases, then resume legacy leveling. `holdLevel:true` requires
an explicit level and nonblank `economy.why`; it caps only this prep, including one-round deferrals. `keep`/`sell`
match exact forms; `buy` and bond priority stop wanting normal copies once that elite is owned. Non-carry seats
spend expiring funds on useful targets, freeze only unaffordable explicit buys or merge completions, search while
a purchase remains affordable, then bank spare operators. Opt-in `freezeSearch` also searches without purchase
funds within the prep's `maxRefreshes`, to freeze a target for next round. `items.buy` requests up to eight items.
Advisor cleanup protects elites, tier ≥4, exact keeps, targets bought this prep and active plan-bond threshold
members; sell unprotected clutter first, destroy cheap unequipped hand items second, fall back last. Incidental
unequippable items must leave two hand slots; explicit requests keep one. Carry bands retain interest behavior.
Absent/empty plans and AI takeover without an advisor retain legacy behavior (maintainer **2026-10-20**).
This is **[ASSUMED] AI policy**, not an official economy change. Bounds and sources:
[EXTERNAL_AI](../EXTERNAL_AI.md#advisor-mode-and-readable-observations-359).

**Temp overflow (临时整备区, row 8; user playtest #3 item 3).** Passive gains that find the hand full (merge elites, grants — the operator a 突变细胞 transformation gains included, §21.1 —, battle-result rewards, equipment returned by a merged / sold / transformed carrier) overflow into an expandable queue with five visible temp slots. The first five pieces fill right-to-left; later pieces wait behind them and refill freed slots in order. No passive gain is discarded for exceeding fifteen visible bench slots (owner correction, 2026-10-14, §32.14.21). Hidden pieces participate in merges, stock accounting, reconnect state and deadline resolution; Ready is refused while any is occupied (official "直到溢出情况排除才可开始进行作战"). A temp piece is resolved — a chess sold back to the pool with its summons removed, items destroyed, a summon stack removed (it comes back at the next round start, PRTS "干员所属召唤物会于下一回合返还", §20.1) — only at the deadline of the **first prep in which its player could act on it** (`PlayerState.tempDue(piece)` vs `prepsEnded`; every write into a temp slot goes through `_putTemp`, which records it): a piece that arrived during a prep before Ready is due at that prep's end; one that arrived after Ready or during the `<休整期结束时>` effects, or outside PREP (COMBAT, 联防, SETTLE — battle-result grants, a SETTLE merge's elite, returned equipment —, the next ROUND_START, 机变) is kept, visible and usable (move to a free hand slot, place, equip, use, destroy, sell) through the **next** prep. Un-readying (`setReady(false)`) makes whatever arrived while ready due at the current prep. ROUND_START no longer wipes temp (it used to destroy what SETTLE had put there before the player ever saw it). A merge's elite whose merge consumed a deployed copy takes that copy's tile and facing (§20.11); otherwise it goes to the hand, overflowing into temp (also outside PREP). `server/match/audit.js` (`tools/matchrun.mjs --check`) tracks the arrivals itself and flags any temp piece that outlives its due prep. The UI frames the row on the board with the rule (§17.5).

Pointing Stick creates at most one pending offer per alive, non-Ready player in PREP. The owner confirms it with
`g.choice { idx, choiceId }`; confirmation validates its ID, round and index, adds one bounty and clears the offer.
Ready requires no pending offer as well as an empty temp area. The co-op prep deadline resolves the offer randomly
before resolving temp and setting Ready; untimed solo / single-human prep does not schedule a separate choice timer.
The offer is recipient-private, including after reconnect, and never enters `m.public.sp` or a teammate's scout view.

### 6.3 Bonds & layers (bondsMeta.js)

- `count` = number of **distinct base chess** on the board carrying the bond (`BOARD`); `BOARD_AND_DECK` bonds also count the hand; 绝技 counts elites on board; 调和 adds +1 to each core bond count that has a real member on the board (the views mark such an entry `harmony: 1`, §21.26), etc. (research 02).
- 变形同构体: an operator wearing it together with an item that has a `giveBondId` is a member of that bond — counted like any member (BOARD: on the board only; once per operator), in the battle, and in the client's member list (tagged 同构) and bond chips (§21.11).
- `tier` from thresholds; `active = tier ≥ 1`.
- `layers[bondId]` persist all match; gains come from garrisons/bands/items/choices/bond effects; IN_BATTLE gains are collected from `BattleResult.layerGains` at SETTLE (disabled in unite/boss/hidden).
- Content plugins may attach operator-owned declarative traits (0.3.1, [§34.26](../history/0.3.1.md#3426-custom-operator-traits-671)). [ASSUMED] Gain is once per acquired copy, not merge output; deploy is hand/temp-to-board. Other prep hooks run once per owned character for its owner, elite preferred; self-sale uses the sold copy/form once, including the final copy. Forced SERVER_GAIN remains separate from acquisition and supports official retrigger/copy interactions. [ASSUMED] Fields with participating battle-layer traits and enabled gains use server simulation for authoritative settlement even with verification off; caps do not prove earned layers. Traits add unless the record explicitly overrides the operator's official mode trait; removing the plugin restores vanilla. See [PLUGIN-DSL §10](../PLUGIN-DSL.md#10-干员特质031671) for events, limits and examples.
- Layer milestones (维多利亚's 维式重锤 every 25, 远见's funds every 10 and its 80 / 150 discounts, 奇迹's funds every 100) pay only while the bond is active; those owed for layers gained while it was off pay as soon as it lights up — `PlayerState.recompute` dispatches `onActiveBonds` whenever the set of active bonds changes, so placing the third 维多利亚 member in prep grants the hammer at once (the maintainer's report of the official game, 2026-10-15; §32.14.31). Each milestone pays once, however often the bond goes off and on.
- A bond holds at most `BOND_LAYER_CAP` = 999 layers (the client's `MAX_GARRISON_STACK`, §20.12): every writer — `PlayerState.addLayers`, the SETTLE merge, `Battle.addLayers`, the dev tools — adds `layerGainRoom(before, n)` = min(n, 999 − before); a gain at the cap adds 0 and dispatches nothing (no onLayers, no `layerGain` hook, no 'layer' event), so the per-N milestones stop with the count.
- Σ activated layers (hidden-core check) = Σ layers over bonds that are active at the moment of the check (end of R14 prep, per research).

### 6.4 Prep-phase effect dispatcher (effectsMeta.js)

A registry mapping **effect keys** → handler objects `{ onRoundStart, onPrepEnd, onGain(piece), onSold(piece), onRefresh, onPrice(slot), onBuy, onMerge, onLevelUp, onBattleResult }`. Sources: garrison `SERVER_*` keys (per chess on board or hand as the key requires), band effects, item meta effects, bond meta effects (助力, 远见, 奇迹, 投资人…), choice/team cards. Content owners register handlers; the dispatcher owns ordering and the 投资人 "获得时 ×2/×3" multiplier, and only while that bond is active (标准 lists `investShip` inactive; copies of one investor are one member — §32.14.8). 娜仁图亚 见者有份 draws `pool_equip_narant` with no tier cap: every shop-eligible equip, uniform [ASSUMED] (§32.14.8). `onBuy` = a shop purchase (`g.buy`) only: a free pick or a grant never counts as 购买 (休露丝, 玛恩纳, 升华, 整备; §21.21). Equipped items run from a snapshot — the owned chess and each holder's items as that step begins (every [holder, item] pair, taken before the first item runs) — each only while it is still equipped on its still-owned holder (handlers move and destroy pieces: 突变细胞, 博士投影; §21.25).

凯瑟琳 定向投放 draws three distinct items and grants one on each 调度中心 upgrade (official
`activity_table.json`, `act2autochess.effectBuffInfoDataDict.aceffect_band_26`: `up_shop_add_special_goods`,
`count: 3`, `choice: 1`, `pool: pool_equip_kathe`). Its pool is every shop-eligible item plus 突变细胞 at any level
(#631; uniform [ASSUMED]). It grants 突变细胞 at most once per match per player — **maintainer decision 2026-10-17
(official play memory)**, #677 / §34.22; the official table names the pool without exposing a cell count.
The match-long player counter `band:cathy:cellTaken` is set only on a successful pick from a `band:band_cathy`
item offer. Later offers exclude the cell, keeping their choices distinct. [ASSUMED] “Given” means taken, so a cell
shown but declined or a refused pick leaves the allowance available. 昆图斯's separate R3 cell grant
(`aceffect_band_41`) neither uses nor checks this allowance [ASSUMED source independence]. [ASSUMED] Taking the cell
also removes it from already queued Cathy offers without rerolling their other choices; empty offers are dropped.
The state survives round changes, item destruction, reconnects and test-console strategy switches; bots and test
replays use the same player methods.
Strategies inheriting Cathy through `effectRef` resolve their behaviour with `bandEffectId` (the content inheritance
contract, §32.5), tag offers with the same `band:band_cathy` source, and share this player counter with Cathy.
[ASSUMED] Once the allowance is used, filter the cell out before drawing and sample eligible items without replacement
until the requested count is reached or candidates are exhausted; no retry budget may shorten a fresh filtered offer.
This filtering includes pool `also` items and respects shared stock and explicit pool weights. Queued offers still
only lose their cell, as described above.

### 6.5 Waves (waves.js)

Per match: pick stage (weighted among the mode's `config.modes[m].stages`, weight 50 each: 标准 FUNNY = 战场#01 `act1autochess_m01` only, 险境 NORMAL = 8 stages, 绝境 / 终极 = 7 without 战场#01 — `waves.js setupMatchWaves`, `test/match/stagepick.test.js`), 3 of 6 typed enemy factions, disabled bond set (3 core + 4 add-on for NORMAL+, per research), boss (weighted), hidden boss. Per round: wave template (by mode & round) → replace placeholders per research 05 §3.2 algorithm → apply stat multipliers (research 00-INDEX §5 `atk ×base×1.1^k`, `hp ×base×1.2^k`, ABYSS speed ×1.15 from R3) → `SpawnSpec[]` + routes resolved on the stage. *(Superseded by the official generator — §14 "Corrections from research 08/09" and the waves.js header.)* A player's normal battle (and the bot rehearsal) runs `withBounties(gd, round, wave, bounties, playerId)`: the bounty units inserted among their host action's own units, which are re-timed around them (client order); `previewOf` keeps one entry per action (`wave.spawns` + `bountySpawns`).

### 6.6 AI players (bot.js)

Match selects a trusted server-side implementation through `botStrategies.js`: `opts.botStrategy` (registered ID
or definition object), then `SP_BOT_STRATEGY`, then `legacy`. `opts.botStrategySeats`, then `SP_BOT_STRATEGY_SEATS`
(`seat:id,…`, seats 0–3), override single seats; a seat without one plays the match's selection. The registry contains the unchanged
`bot.js` adapter, the explicitly configured `external` adapter and the opt-in `ioleta`, `adaptive` and `ioleta-adaptive` strategies. `botStrategyContract.js` defines immutable strategy objects and pure registries; omitted hooks
inherit an existing strategy (legacy by default). Invalid hooks, unknown IDs and duplicate registrations fail early.
Registry additions do not reweight opening choices or consume RNG.
An unset or empty `SP_BOT_STRATEGY` uses the original bot without a programmatic override. `startServer()` validates
both environment selections before loading data or accepting connections; an unknown ID or a malformed seat entry
prevents startup with a diagnostic naming the variable, rejected value, available IDs and how to restore the default.
A seat override applies to the seat number: an AI seat and a human under AI takeover there both play it. A match
whose default or any seat selects `external` has one external host; only external seats ask it, still narrowed by
`SP_EXTERNAL_AI_SEATS`, and they fall back to legacy as before.
Test input journals record the resolved strategy ID and any seat overrides (`botStrategySeats`); replays use them
explicitly, defaulting older records to `legacy` without overrides, independently of the replay host's environment. Prep generators and rehearsal jobs retain journalled slice counts.
The selected implementations do not change draft order or give any AI seat priority.

A seat's implementation (its override, else the match's) handles that seat's band/card drafts, personal bounty choices, sliced prep begin/end and benchmark
bounty estimates. Prep hooks return synchronous iterators and preserve the existing rehearsal job protocol,
including host delegation, cancellation and error cleanup. Definitions do not hold mutable per-room/player state.
This is a development interface, not a new gameplay policy or a client code/plugin loading mechanism.
See [the strategy guide](../BOT_STRATEGIES.md) for the contract, registration and testing steps.

The optional `botbench --layers` audit wraps only benchmark match instances and records actual banked layers,
source hooks, spending and round snapshots ([META §6](../META.md#6-testing--tools)). It never feeds decisions or
counts rehearsal gains. The three §37.24 procurement/refresh trials were withdrawn; legacy policy is unchanged.

The opt-in `ioleta` strategy applies [ASSUMED] staged Russell procurement to Russell seats and legacy prep to other
bands. Its seat-local plan, core-merge/reward ordering and affordable search rules are recorded in
[§35.83](../history/0.3.2.md#3583-optional-bot-strategies-pr-742-lidong1793). Placement candidates remain independently selectable.

Maintainer decision 2026-10-17, requested 2026-10-19 (§35.8): `external`, a strategy of @HankDUMPLINGZhong's
#673 framework (§35.7), sends the seat's existing public/private views to operator-configured HTTP(S) or stdio,
accepts human intents through the same schema and semantic validators, and falls back to legacy on failure.
Requests run asynchronously within existing phase timers; default selection and golden results stay unchanged.
[ASSUMED] Engineering policy: version `sp-ai/1`, 1000 ms total decision/request cap, half the remaining phase
reserved for fallback, 64 intents, 64 KiB response, 3 consecutive failures to match-long legacy for that seat,
1000 ms child restart backoff; limits configurable. One stdio child per match, no HTTP redirects, no client-set
endpoint/command, gameplay actions only. Test journals record replies/failures; offline replay performs no IO.
The complete policy and scope are in [External AI API](../EXTERNAL_AI.md).
Maintainer decision 2026-10-23 (§35.66): a release package does not include this strategy. The zip, the update
package and the Docker image omit the host, and a packaged server ignores external-AI settings.

0.3.4 development adapter (§37.21): provider thinking mode is explicitly configurable, independent of the
token cap. Opt-in local captures omit credentials/headers; debug usage may distinguish reasoning tokens.
[ASSUMED] A normal-stop response with a complete final `plan.items.equip` and only its outer wrapper brace
missing may recover that single brace before the unchanged validators. This changes neither match timers,
the default provider controls, legacy behavior nor the release gate. See [adapter details](../EXTERNAL_AI.md).

0.3.4 development adapter (§37.23): HTTP 429/503 can retry at most three times per decision, within the
original deadline. [ASSUMED] Retry-After is capped at 30 s (missing/invalid: 10 s), and each retry reserves
half the original request budget after waiting. Numeric status/delay diagnostics never include remote error
bodies. Exhaustion retains the generic failure and existing fallback; host timers and release isolation stay fixed.
The opt-in `SP_LLM_REASONING_EFFORT=adaptive` policy keeps provider defaults for solo/ample or unknown budgets,
and selects low for known co-op budgets below 90 s ([ASSUMED], experimental). It uses the host clock pair,
never wall time against virtual time; fixed settings, prompts and timers stay unchanged. Cycle 5 tested fixed
default/low, not adaptive; the adaptive path has mock validation only. See §37.23 and the adapter instructions.

0.3.4 development adapter (§37.25): `SP_LLM_API_FORMAT=anthropic` opts into Messages with a cacheable system
block and explicit Bearer / `x-api-key` authentication. Text blocks use the same plan/choice validation, retries
and fallback; usage includes cache reads and writes in input, reads in cached tokens, and writes separately in
optional diagnostics. `SP_LLM_HEADERS` uses strict safe-header validation and cannot replace credentials or
content/host/cookie/framing headers. OpenAI remains the default; no live Haiku probe was run. Provider controls,
presets and subscription restrictions are documented in [External AI API](../EXTERNAL_AI.md).

Maintainer request 2026-10-19 (§35.12): the example advisor's static knowledge includes a regenerable playbook
from the active data and a sourced community overlay. [ASSUMED] Per-seat scoring uses only announced
bans/enemies, public teammate boards and own progress. §35.15: the band draft returns at most eight
directions and prefers uncontended community/maintainer mains; prep collapses the same band and main into
one candidate with `subOptions`. It does not inspect remaining stock or change execution. Mechanical facts, timing
estimates, score weights and cross-version regeneration are specified in [AI strategy](../AI-STRATEGY.md).
The §35.12 follow-up requires detailed sourced play for named builds: separate freeze/redeployment recipes
check reachable core roles and distinct main thresholds, retaining current-data disagreements and substitutes.

Maintainer approval 2026-10-19 (§35.9) adds owner-selected `mode: 'plan'` beside default `direct`.
One prep plan per seat/round weights legacy procurement/lineup/placement; existing sliced rehearsal and legal
handlers execute it. Draft/card/offer plans may select an observation-local action ID. Invalid plans clear
preferences and resume ordinary legacy. [ASSUMED] Plan schema, weights and conservative action shortcuts are
specified in the API guide. An opt-in hashed static knowledge hello includes active plugin data and language
texts; observations retain raw views and add a named digest, public scouted boards and short action IDs.
No hidden stock/private opponent views are added. Journals replay plans and IDs offline. Benchmarks await real
IO before advancing virtual time and report strategy outcomes/IO metrics. The default bot and golden outcomes
remain unchanged; no official gameplay rule is altered.

After the greedy layout is complete, `planLayoutSteps` rechecks self-range guards on enemy-road tiles. An isolated
guard may move to a free legal road tile with allied damage covering both it and the preceding tile of every incoming
ground route. Different routes may have different supporting allies. The exposure score must not decrease [ASSUMED],
regardless of seat count. Supported guards and guards without such an alternative keep their positions.
These placement assumptions are tracked in [issue #315](https://github.com/sganggs/Stronghold-Protocol/issues/315).

信仰搅拌机's selected 退休前布道 (`skchr_rmixer_3`, the default) is scored and faced on that skill's own grid (both sides
and one tile farther; the record's `skills[].rangeGrid`). `attackRangeGrid` — the deploy overlay, the card and
`summonRange` — stays on the base line: the skill text is 「攻击范围扩大」 without 「被动效果：」. SPT-Y's 攻击距离 +1 does not
grow this planned grid (PRTS 备注: the skill range ignores 攻击距离). S1 and S2 keep `attackRangeGrid`. [ASSUMED] The
skill is ammo and is not up for the whole fight; the plan still uses the skill-on grid (#31, §35.106).

[ASSUMED] Blocking medics prefer legal tiles outside the enemy road, then road tiles supported by allied damage,
then any legal fallback when neither exists (#577). The supported-road test is the same as the guard repair above:
every incoming ground route needs an ally covering both the medic's tile and its preceding contact tile; different
routes may use different allies, and healing never counts as fire support. Within each preference group the existing
exposure score chooses the tile. On boss rounds the planner still places wider healing ranges first; the last
arrangement of the prep rehearses those layout variants against the already-planned boss wave (§35.64). Equal exposure
scores prefer estimated allied DPS **not already covered by a previously placed medic**, before the tile-noise tie-break.

[ASSUMED] Purchase scores within `1e-9` tie in favour of the cheaper offer; genuine score advantages still win.
Pre-emptive hand shedding only sells when the owned operator count exceeds the deploy cap. Lineup evaluation counts
BOARD_AND_DECK members withdrawn from the board only while hand slots remain, in the same order as arrangement
(withdrawals before deployments). A purchase reserves its own hand slot first; members forced to be sold do not count.

[ASSUMED] Layout rehearsals use normal battle inputs and the normal field seed, including battle-start effects,
enemy replacements, teammate effects and in-battle layer gains. A Final Assault / Hidden Core rehearsal uses the wave
`startRound` already planned, an independent seed `deriveSeed(0xA11CE, fa:round:seat)` (not the match seed and not the
live fight's seed), a fresh boss pool per candidate, the teammate's currently deployed board, and the visible
countdown on the combat clock (`bossLevelTime` real seconds × `combatTimeScale`, 240 game seconds when the data
says 120; §35.64). Counted leaks still rank first; leader damage breaks a leak tie (#315), then kills and candidate
order. The layer-gain tie-break trial was withdrawn after a solo NORMAL win-rate regression (§37.20).
Each candidate uses an independent copy of the current
meta RNG. Candidate boards and events are detached; preview contexts expose copied reads and no-op state writers,
including contexts reached through teammates/player. A separate dispatcher owns the preview script budget and drops
preview errors; no live script quota, diagnostics or settlement is affected. Actual starts retain the original RNG
and dispatch. Rehearsals estimate current prep state, not later prep actions or other players' random choices.
These three bot policies are tracked in [issue #315](https://github.com/sganggs/Stronghold-Protocol/issues/315);
combat blocking, healing and damage rules are unchanged.

Pending Pointing Stick offers use the existing bounty scorer at bot prep entry, immediately after a successful cast,
and before Ready. The prep's deadline — and the scheduler's fallback when a step of a bot's prep fails — randomly resolves any remaining offer before temp and Ready; a seat that left is eliminated and its offer dropped.

Deterministic-ish heuristic player used for (a) AI teammates, (b) auto-play for disconnected humans (only auto-ready + auto-picks, not shopping, unless "AI 托管" is toggled), (c) tests. Strategy (§21.6): pick a band (weighted by starting LP; never one built around a bond the mode switches off — `gd.bandBondIds`, §21.26); each prep: take offers, sell dead bench weight, fill the board, complete affordable merges, level on the curve, then buy only merge progress / lineup upgrades worth more than the refreshes their price would buy (shop odds of completing held pairs), freeze for an unaffordable third copy (坎诺特 keeps 5 funds back); build around a committed focus core bond (a teammate's main bond on its strip counts against it; bonds the mode switches off never) + a second bond; value dealers by DPS vs the round's DEF / RES (an attack on every enemy in range counts double — 阵法术师 / 轰击术师), with the range the unit is deployed with; place by the exposure model + rehearsal on the server's deploy map (no 深水区; a blocker whose range is its own tile only — range 0-1 — takes a free tile of the enemy road first; a tactician's 援军 within `PlayerState.summonRange`; a melee chess whose trait reads 「可以放置于远程位」 (钩索师 / 推击手) on a 高台 whose range covers the enemy road, else on the ground, counted as a blocker in the lineup either way — §3; `g.move` judges legality); items by effect (META §1.5: 突变细胞 on the least valuable normal single below 6阶, a cell left in temp gets a hand slot made for it, the operator its transformation gains is deployed by the next prep's lineup step like any owned unit — AI 托管 too; the buy loop's bench shed never sells a piece gained since the bot's last prep, §21.1); 机变 bounties by expected payout − expected LP loss over the offered cards; resolve temp — on a human seat under AI 托管 never by destroying an item while a bench operator can be sold for the slot —; ready. A bot's whole prep — shop decisions and layout planning (`botPrepBeginSteps`, 25–70 ms late in a 4-bot match), the layout rehearsal and `botPrepEndSteps` — runs in wall-clock slices of `botSliceMs` (8 ms) per scheduler callback on a real host (step generators that yield between whole actions, never with a transient board; the same actions in the same order, so decisions are unchanged; at once in virtual time). Under AI 托管 a human's own 自选 pieces score `DIY_PIECE_BONUS` (12) more in the shop / reward choice and the 调度中心 is levelled one round earlier for the step that opens a slotted tier (`levelUp`, `diyOpensAt`; 0.2.0 — bots field no 自选 piece).

### 6.7 Where a match runs: match hosts (§32.6, §35.23)

A room of 第二期下半 (`act2autochess`) without gameplay plugins runs its `Match` in the server process, as always. Two kinds
of rooms run it in a match host (`server/match/host/`: a child process by default, `SP_MATCH_HOST=worker` a worker
thread), whose module table holds that room's data — `server/data.js setData` before the match code is imported, so every
singleton (the kits, builtinMeta, the meta registry, the official-bounds cache) reads it:

- **plugin hosts** (`kind: 'plugins'`, §32.6): one per content set of gameplay plugins, at most `limits.maxSets` (4);
  stop reasons 'plugin-crash' / 'plugin-hang' / 'plugin-start';
- **version hosts** (`kind: 'version'`, §35.23, M1): one per enabled official version other than 第二期下半 (its `cs`,
  `server/versions.js`), at most `maxHosts` (default: one per such version; `SP_MAX_VERSION_HOSTS`), counted apart from
  the plugin hosts. Nothing set enables all four, so that cap is three (§35.23.11). A host is forked on the first match
  of that version, never at boot; an idle server has zero version workers. Log lines `[versions]` with the version's id
  as the host label; stop reasons 'version-crash' /
  'version-hang' / 'version-start' (the room is told `本局模拟出错，已结束` / `本局模拟长时间无响应，已结束` /
  `该版本的模拟无法启动`); a full pool refuses the start with `INTERNAL` 'version hosts busy'. The host installs the
  version's own official-bounds snapshot, and refuses (`failed` → 'version-start') a match whose `opts.version` (absent:
  `act2autochess`) is not its data's (`shared/versions.js versionOfData`). The lobby passes `opts.version` and
  `opts.requireCs: true` (a client b.result must name the version's `cs`; the bot layout rehearsal is never delegated to
  a browser, `match/rehearsal.js`), never `kitted`. A version room without a version host refuses to start (`INTERNAL`):
  the server process's singletons hold 第二期下半's data. `Match.version` is the registry id (null for the default); the
  test journal's `init.options.version`, `m.public` / `m.result` `version` (`views.js` / `results.js`: the page reads a
  replayed result with it), the external AI's `context.gameVersion` and the knowledge pack's `gameVersion` carry it (all
  non-default only). Both kinds: heartbeat watchdog 10 s, idle stop after 10 minutes, `diag()` (tests) reports `version` too.

---

## 16. Operator loadout: skill & module selection (v2.1, user playtest #1)

Official rule (bwiki 盟约, 更新公告 5114): before a match the player cannot change an operator's tier, but can change the **equipped skill and module** of each chess; some non-default choices are stronger. Scope in the remake (no accounts ⇒ everything the chess's status unlocks is selectable):
- **Skills:** any skill unlocked at the chess's status (`evolvePhase`: E1 ⇒ S1–S2, E2 ⇒ S1–S3) at the chess's skill level (normal Lv4, elite Lv7). Default = `defaultSkillIndex`.
- **Modules:** only matter for the elite (golden) chess (`equipLevel` 1, or 3 at T6): any module of that character (or none); default = `defaultUniEquipId`. Normal chess have no module (equipLevel 0).

**Data (`data/chess.json`, built by tools/build-data.mjs):** every chess keeps `skill` (the default, unchanged shape) and gains `skills: [SkillRecord…]` (index, skillId, iconId, name, desc/descRaw, skillType, durationType, duration, spType, spCost, initSp, maxChargeTime, bb (at the chess's skill level), bbStr, rangeGrid, trigger {rule, customRangeGrid} resolved for THAT skill index, isDefault). Golden chess gain `modules: [ModuleRecord…]` = `{ uniEquipId, name, typeName, icon, isDefault, attr: {maxHp, atk, def, res, aspd, cost, blockCnt, respawnTime…} (flat adds at the chess's equipLevel), traitOverride: {desc, descRaw, bb} | null, talentChanges: [{talentIndex, name, desc, bb}] }` plus `statsBase` (stats WITHOUT any module); `stats` stays = stats with the default module (back-compat).

**Loadout wire & state:** the client keeps a per-browser loadout `{ [baseChessId]: { skill: index, module: uniEquipId | 'none' } }` (localStorage) and sends it with C2S `room.loadout { entries }` (validated: known visible chess, legal skill index for that chess's normal AND elite status, legal module id). The lobby stores it on the seat; at match start `Match` receives `seats[].loadout`; `PlayerState` keeps it immutable for the match by default; a room with prepLoadout=prep accepts named overrides during PREP before ready (§34.15); board pieces are resolved to `{chessId, skillIndex, moduleId}` when building `PlayerBattleInput.units[]` (fields `skillIndex`, `moduleId`; BattleSpec carries them). Bots use defaults. m.private exposes the effective loadout so the UI (shop cards, detail panel) shows the chosen skill/module.

Client sync preparation may await chess/backups data. A later edit (including restoring defaults) or `welcome` invalidates the earlier preparation: its payload, missing-data result or failure cannot send or change sync status. The current edit keeps the existing debounce, close flush, ordered requests and retry/lock handling (`public/js/ui/loadoutSync.js`).

**潜能 / 练度 (0.2.2, the owner's decision of 2026-10-08: 「调配干员里自己设置吧，默认满潜满加成」):** official — an operator fights at the player's own potential (调度手册 「卫戍协议中干员潜能由自身已持有干员潜能决定」; an unowned 特许 operator at potential 1) and an owned operator of the same name gets the 自持有 练度 bonus (activity_table `cultivateEffectList`: 未精英化 +0 %, 精英1 ATK / DEF +5 %, 精英2 ATK +10 % DEF / HP +5 %, 精英2 Lv.60 +10 % each — a multiplier of its own, never summed with the 直接乘算 bonuses). The 干员调配 screen sets both per operator (by charId: initial, elite and 自选 forms share them; default 潜能 6 and 精英2 Lv.60); they travel as `room.loadout.ops` (`{ [charId]: { potential, cultivate } }`, defaults dropped; shared/protocol.js `checkLoadoutOps`, strict like the entries), `seats[].ops` → `PlayerState.ops` (re-checked; bots none = the defaults), and every operator the player owns states them in its `PlayerBattleInput` entry (`potential`, `cultivate`; shared/potential.js `cultivationOf`) — never a 补位 stand-in (a not-owned NORMAL chess) or a prototype 自选 pick. The sim composes the def at the potential (data/*.json carry every potential, DATA.md §2.3; the summons' talents at the owner's) and multiplies ATK / DEF / max HP by the tier's `char_attribute_mul` (effects.json `aceffect_char_1…4`, SIM.md §12). The cards (局内数值, shop and detail cards, a teammate's unit from UnitInfo `potential` / `cultivate`) show the numbers at the settings.

**Sim:** `simdata` resolves a unit def for `(chessId, skillIndex, moduleId)` (cached): `skill` = the selected SkillRecord; stats = `statsBase` + module attr (elite) ; trait/talents = base with the selected module's overrides. Kit contract (backward compatible): a kit function `(bb, chess) => { skill?, skills?: { [skillId]: SkillSpec }, talents, trait }` receives `chess.skill` = the **selected** skill and `bb` = its blackboard; the loader uses `skills[selectedSkillId]` if present, else `skill` only when the selected skill is the chess's default, else the **generic** skill spec — talents/trait from the kit always apply. Every visible chess must get hand-authored specs for all of its selectable skills (tracked by a coverage test).

**UI:** a 干员调配 screen reachable from the lobby, room and briefing (INFO_CHECK): the roster is one list, a row per operator with aligned columns under a head row — portrait / name / bonds, the skills and the elite's modules to tap (不装备 first; the quick choices of PR #301 by @farridge, laid out as one list instead of its three columns of cards, the owner's call of 2026-10-08), the 潜能 / 练度 selects (`screens/loadout.js RosterRow`, `screens/cultivation.js`); a click anywhere in the row that is not one of its controls picks the operator and opens the detail — the controls act on their own: a skill / module button selects the row through `quickChange` and keeps the list on a phone, a select opens its own list (`RosterRow onRowClick` → `screens/loadoutSections.js rowControlHit`, which anchors the guard to the row, so a wrapping link or button cannot swallow its clicks); the detail beside it (below 1000 px wide it slides over the list, a quick choice keeps the list) opens with the 潜能与练度 section (潜能 1–6, the four official 练度 tiers with their effect texts); the detail then shows the operator's 特质 — the in-match `GarrisonBlock` / RichText of the form its 普通 / 精锐 skill toggle shows, triggers such as 「<进入休整期时>」 kept (0.2.2, PR #301 by @farridge); filter by tier/bond/class, per chess choose skill (icon, name, SP info, desc at Lv4 and Lv7) and elite module (official type icon from the local-client art when extracted (§13), else a lettered tile; name/type, stat bonus, trait/talent changes), 恢复默认, persisted; a 局内数值 section between the skills and the modules (普通 / 精锐 toggle, 精锐 first) draws the detail card's own stats block, 特性 and 天赋 for the chosen skill / module (§22.16); the chosen skill/module shown on shop cards and in the detail panel (a teammate's unit — 前往查看 in prep, 联防 / 最终攻势 fields, an observed battle — shows **its owner's** skill/module from its UnitInfo `skillIndex` / `moduleId`, `gameLogic.js unitLoadout`) — which also shows the stats, 特性, talents and attack range the unit fights with (`shared/loadoutRecord.js` `loadoutRecord` / `attackRangeGrid`, the same composition the sim's `getChess(id, loadout)` uses; the deploy wheel's range preview too) — the range it is deployed with: a selected passive range skill (引星棘刺 S3 3-9) and the 特性's permanent 攻击距离 (信仰搅拌机 SPT-Y +1) included, over all 1284 loadouts equal to the battle's range at deployment; in battle and prep the card draws the live `range` (§21.16). In battle the renderer plays the equipped skill's own Spine clip and ON_SKILL_START sound (`UnitInfo.skillIndex`; `data/assets.json` lists icons, clips and sounds for every skill index).

**导出 / 导入 a loadout:** 导出 hands the current loadout out as a versioned envelope `{ kind: 'stronghold.loadout', v, exportedAt, count, entries, ops }` (`ops`: the 潜能 / 练度 settings, 0.2.2 — an import without them leaves the current settings alone) — copied through `ui/clipboard.js copyText` or downloaded as a file. 导入 accepts that envelope, the stored `{ v, entries }` form and a bare `{ [chessId]: { skill, module } }` map (serialised text too), and refuses another tool's `kind`, junk, an empty result and a **newer** `v` (`parseImport` — a newer payload is never mis-read). Both go through `loadoutSync.applyLoadoutEntries` → `sanitizeEntries`, so a preset from another build never sends the server an entry it would refuse, an import that keeps nothing changes nothing, and the result is reported as N imported / M not (`ui/loadoutModel.js`, `screens/loadout.js`).
A payload that carries `ops`, including `ops: {}`, is refused before any write when chess.json or backups.json is missing (`loadoutOpsImportRefusal` in `screens/loadout.js`, the same check as a 自选编队 import). An older file with no `ops` still imports skills and modules once chess is ready and leaves the current 练度 in place.
Export remains available for non-default `ops` alone, including operators outside the normal roster. The roster's
adjusted count and reset scope stay limited to its own operators; the DIY export still carries picks only.

**干员持有 (0.2.0 补位):** the overlay's second tab marks operators as not owned (the 55 NORMAL chess; per-browser `sp.pref.ownership` = `{ v, notOwned }`, synced as `room.ownership { notOwned }` by the same sync engine as the loadout, `ui/loadoutSync.js installPrefSync`; 导出 / 导入 as `{ kind: 'stronghold.ownership', v, exportedAt, count, notOwned }`). A not-owned chess fights as its official stand-in with the backup skill / module — the loadout never applies to it ("对于补位干员其技能不可更改") — and is shown as the stand-in wherever the player's copy appears (shop / reward cards, hand and 临时整备区, board, detail card, result lineup, a teammate's scouting and bond popups: portrait, name, model, with a small 「替补」 mark; the owner's recall of the official mode, 2026-10-06), while its bonds, 特质, tier, price and merge stay the chess's; the 0.2.0 补位 design subsections have the rules and sources.
**自选编队 (0.2.0):** the overlay's third tab fills the four DIY slots (5阶 ×2, 6阶 ×2) with an owned 6★ outside the chess pool (any of its three skills, any module of its elite form but a 集成战略 one) or a prototype (its locked skill / module); only operators with a kit are offered (`welcome.diyKitted`). Per-browser `sp.pref.diy` = `{ v, picks }`, synced as `room.diy { picks }` by the same sync engine; 导出 / 导入 as `{ kind: 'stronghold.diy', v, exportedAt, count, picks }` (`ui/diyModel.js`, `screens/diy.js`). **UI:** the picker is the roster's own screen (the UI paragraph above) with the picker's own **draft** and its own filter row: the 原型 / 已持有 chips and the search it has always had, plus the roster's 职业 chips (`loadoutSections.js ProfFilter`, one markup for both screens — no 盟约 select and no 仅看已调整, neither of which means anything for a slot's pick). The row's quick skill / module choices write the draft (确认 saves it, 取消 / Esc drop it, a saved pick is never touched) while 潜能 / 练度 writes stay immediate; a taken option (another slot holds the operator) disables its row and names that slot, and a prototype's locked skill / module are static cells. Two 自选 facts differ from the roster's list: the modules come from `pickChoices().modules` (集成战略 / 生息演算 ones excluded, 不装备 first) with the 默认 badge suppressed (on a composed slot record `isDefault` marks the current pick, not an official default), and a 自选 record carries `garrisonIds: []`, so the pane has no 特质 section. Below 1000 px wide the pane slides over the list with a 「干员列表」 back button, and a row's first tap only selects it (the next tap opens the pane). Every row's choices are memoized per loaded backups.json (`pickChoices` behind `screens/diy.js rowChoices`): the tier-6 list holds ~81 operators, so a search keystroke never recomposes them all. In the match a slotted piece is the operator for its player (name, art, class, bonds from its factions, no 特质, the pick's skill and module; the slot's tier, price and merge), sold only in that player's shop from the slot's 调度中心 level with its own stock; the shop / reward / detail cards and the own pieces carry a 「自选」 badge (`ui/gameLogic/diy.js`); the 0.2.0 自选编队 design subsection has the rules and sources.

---

### Cooperative buying, reactions and opening rerolls (§28.15–16, §28.21)

[ASSUMED] Bot purchasing applies one soft penalty to non-elite, non-DIY shared-pool cards whose bonds overlap what a
living teammate needs — its opening strategy's bonds or its main core bond on its public bond strip (`teammateBonds`),
minus the bonds the bot's own opening strategy needs: 18 points for tiers V/VI (PR #407), 12 for tiers I–IV (#121, a
歌利亚 bot hoarding a 潘格尼尼 player's low-tier <拉特兰>). Human and AI teammates are treated equally and several
teammates do not stack it; it neither reserves stock nor outweighs an own merge or a missing blocker / healer.
Existing strategy presets and rehearsal counts are unchanged.
A living teammate's selected strategy also soft-reserves its bonds for bot strategy selection and focus planning
before any member is deployed (§30.28). The reservation ends when that teammate is eliminated. [ASSUMED] Focus planning subtracts 30 for the union of
public main-core and opening claims, excluding the bot's own opening bonds; changing that union invalidates the cached
plan even within a prep (§37.15). An accepted advisor main still takes precedence. It does not hard-exclude
a strategy, reserve stock, or stop an immediate merge. A reserved strategy keeps a quarter of its unreserved draw
weight (`SOFT_BAND_RESERVE` = 0.25), so it can still be chosen. Mode-inactive bonds stay weight 0 (DESIGN §21.26).
A strategy whose mechanic also changes the teammates' enemies (鸭爵 「神秘顾客」: from round 5 some enemies of the player
and the teammates become 鸭爵 / 高普尼克 / 流泪小子 / 圆仔) keeps a tenth of its weight while a teammate lives
(`MATE_BURDEN` = 0.1, #121); alone it is drawn as before.

[ASSUMED] AI reactions are cosmetic social choices, enabled by default and disabled with `SP_BOT_EMOTES=0`. Only
mixed human/AI matches emit them, through the existing whitelist and cooldown. A human emote gets at most one eligible
bot reply. Settlement uses that round's results (kills then damage, stable seat tie-break), once per round; the third
chess merge reacts once and resets at settlement. Gifts are classified by trusted source playerId, never display name.
These hooks consume no gameplay RNG and schedule no game actions.

[ASSUMED] During INFO_CHECK any seated human participant may request an opening reroll; all connected human
participants must explicitly agree, including autoplay humans. Bots and spectators do not vote; one human refreshes
immediately. A vote pauses the confirmation timer and blocks Ready. Rejection, cancellation by any seated participant,
disconnect or leaving cancels it and restores the remaining time / prior Ready state. Success preserves the room,
seats, settings and connections, redraws the complete opening, resets Ready, and starts the full original timer
(single-human matches remain untimed). Fixed stage/bans remain fixed and random results can repeat. A separate
seed-derived stream leaves shop/draft RNG untouched; each seat may start one vote per 30 s (a completed reroll opens a
fresh window, a cancelled or rejected vote does not give the cooldown back; the refusal is RATE with the detail `setup
reroll cooldown`, which the client shows as 「每人 30 秒内只能发起一次重刷投票」), and stale revisions or vote identities
are refused. With one human (solo, or co-op with bots) every start completes at once and so clears the cooldown; there
`room.rerollSetup` is throttled by the connection's heavy bucket (server/net.js `HEAVY_TYPES`, 2 per second after a
burst of 6; plain RATE), since each reroll rebuilds the opening and resends `m.public` (§35.47).
All new setup data and player DIY stocks are prepared before mutation; data preparation failure leaves the old opening
intact. This is a remake convenience, not an official mode rule. Unrelated result-screen changes from PR #408 are not
included.

The shared DIY detail preview (stats, range, trait, talents, potential, cultivation and matching normal/elite skill descriptions) follows roster loadout resolution. Jessica shield placement is limited to her four orthogonal neighbors. The two Ptilopsis prep-gift copy exceptions are defined in §29.3 and META; no generic change to all copied conditions is implied.

Shared-stock corrections (§30.1–2, §32.14.24): fixed `SERVER_GAIN_EQUIP` gifts still occupy ordinary/advanced 1/2 copies but
may exceed capacity; `requirePool:false` bypasses equipment limits only for these fixed families. Already displayed
operator and equipment shop cards, and already displayed operator and equipment reward offers, remain valid after
exhaustion and record the deficit (operators: a negative raw left; equipment: `SharedItemPool.debt`, #624, the
maintainer's decision of 2026-10-14). Future rolls exclude empty stock. A copy that actually leaves the match —
destroyed, consumed, wiped from temp, or removed on elimination — repays that deficit first; selling a carrier still
returns its equipment to the hand, so the equipment debt stays. 整备, random grants, 机变 item cards and strategy
grants that are not an already-shown card stay stock-limited. Rockrock and Flametail use the measured weighted
subsets described in DATA and §30.2.


Content-plugin exceptions to the official match rules are opt-in (§34.15): `shopBias=bondBias` filters shop item candidates within their drawn tier by active bond/giveBondId after stock checks, falling
back within that tier; morphPairing=plus uses shared pairing and slot policies (zero-slot morph, one per operator,
only the leftmost bond item grants); unequip=allow moves one equipped item back to the hand then visible temp,
atomically refusing HAND_FULL if both are full. A validated prepLoadout=prep change reconciles affected owners'
summons across board/hand/temp to the selected skill/module stock, then recomputes ranges; unchanged loadouts and
other owners do not replenish spent stock. [ASSUMED] Keep valid board cards in reading order before hand/temp
index order, remove obsolete/excess cards and temp deadlines, and grant missing copies via normal overflow.
These do not alter the default rules above. See
[PLUGINS.md](../PLUGINS.md#rule-switches) for limits and assumptions.

### Opt-in adaptive strategies

[ASSUMED] The registered `adaptive` strategy keeps legacy band picking and procurement and adds map-independent
layout search inside the five-hook contract; `ioleta-adaptive` composes Russell-only procurement with the same search. First three distinct contact candidates form the baseline; remaining legacy
variants and contact repairs extend the list up to eight. Extension stops after a clean completed zero-leak result,
or at a strict six-times-per-candidate total tick cap. Server and host Worker share RehearsalRun, limits and counters.
Default legacy rules remain the baseline. See [BOT_STRATEGIES](../BOT_STRATEGIES.md).
