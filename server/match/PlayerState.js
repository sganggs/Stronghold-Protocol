// server/match/PlayerState.js — authoritative per-player state + every prep intent handler (DESIGN §6.2).
//
// Handlers validate → mutate → recompute bonds → mark the private view dirty. They never throw on bad input; they
// return `{ ok: true }` or `{ error: ERR.*, detail? }`. Rules (research 00-INDEX §3–§4, 01 A1, 04 §2):
//   * Hand (整备区) 10 slots filled right→left, temp (临时整备区) 5 slots. A full hand refuses buys and reward picks —
//     also one that would complete a merge at once (PRTS 卫戍协议/帮助 §手牌区 "例如招募/购入等通常情况下会增加手牌的操作";
//     GitHub #82) — and withdrawals, except one whose own summon stack frees a slot. Passive gains (merge results,
//     grants, returned equipment) overflow into temp, and a free hand slot pulls them back in at once, right→left
//     (_fillHandFromTemp at every recompute: "常规手牌区出现空位时自动移入"); temp blocks Ready ("直到溢出情况排除才可开始
//     进行作战").
//     A temp piece is resolved (chess sold back to the pool, items destroyed, summon stacks removed — they come back at
//     the next round start, grantTokensFor) at the deadline of the
//     first prep in which the player could act on it (tempDue): a piece that overflowed during a prep before Ready
//     expires at that prep's end; one that arrived after Ready, at the prep end (<休整期结束时> grants), in COMBAT /
//     SETTLE (battle-result grants, merges, returned equipment) or at the next round start / 机变 stays visible and
//     usable (move to a free hand slot, place, equip, destroy, sell) through the NEXT prep — nothing is destroyed before
//     the player saw it in a prep ("处于临时整备区的调度资源，在进入下一回合后会自动销毁").
//   * Board: own region rows 9–12 × cols 2–10, legality from the stage legend (board.js); deploy cap 8 (+effects);
//     tokens (placeable summons) don't use deploy slots. Board↔hand swaps are always allowed. In a boss round the
//     legality reads the player's half of the boss field (Match.deployFieldOf → board.js field 'bossL' / 'bossR',
//     user playtest #5 item 7); board coordinates are unchanged. A terrain change (terrain 机变 cards, content
//     overrides) or a change of the deploy field withdraws the pieces left on tiles they may no longer occupy (hand,
//     overflow temp; summons back onto their stack) — see _evictIllegal.
//   * Shop: per-level chess slots + item slot, copy-weighted rolls from the SHARED pool (pool.js); refresh 1 (free
//     refreshes first), one toggle freezes all unsold slots until the next round start (a manual refresh while frozen
//     rerolls everything and the new slots stay frozen), level-up price = base − rounds elapsed (floor 0).
//   * Merge: 3 normal copies (风丸 2) on board/hand/temp → 1 elite; equipment returns to the hand; a
//     reward offer of 3 different free chess of tier min(level+1, 6) is queued (never one operator twice — user
//     playtest #6 item 19; a short tier tops up from the tier below; pick 1, expires at prep end; an offer earned
//     after the prep — SETTLE / Final Assault effects — is kept for the next prep). Where the elite goes (PRTS
//     卫戍协议/帮助 "发送1名【精锐】状态的该干员至手牌区（若消耗已部署至作战区的干员，则发送至作战区对应位置）", user
//     playtest #6 follow-up): when a consumed copy stood on the board, onto that copy's tile with its facing (of several,
//     the one that deploys first — board.js mergeTile, [ASSUMED]); it replaces a deployed copy, so the deploy count
//     never grows, and it gets its own summon stack (grantTokensFor). Otherwise to the hand, overflow temp — also
//     outside PREP (a SETTLE merge's elite waits in temp for the next prep).
//   * Per-piece round counters (pieceRoundCount, piece.meta.round): an operator's own counts of the current round
//     (拉普兰德: the manual refreshes she witnessed — player feedback after 0.1.0); a new piece starts at 0, an elite
//     merged this round too (a new 拉普兰德 — GitHub #169, the owner's decision of 2026-10-06).
//   * Transformations (transformChess, 突变细胞 — PRTS 备注 "生效时，原干员销毁，获得一名高一阶的随机初始干员"): a destroy
//     followed by a gain. The carrier leaves wherever it stands (a board tile is freed, the deploy count drops), its
//     equipment — the cell included — returns to the hand first (overflow temp), then the new chess is gained like any
//     other (acquireChess: hand, overflow temp, the no-room rule; a merge it completes puts the elite on a consumed
//     deployed copy's tile — never the carrier's —, else in the hand). Official footage: the tile is empty at the next
//     prep and the new operator waits in the 整备区 (pointed out in PR #2).
//   * Items: equip max 2 (a 3rd replaces the equipped item the player picks — g.equip replaceUid, the oldest when
//     absent; equipped items are otherwise locked: g.destroy refuses them),
//     2 identical normal items (hand/temp/equipped) merge into the golden item in the hand, items are never sold
//     (destroy for 0). consume-on-equip items resolve through the effect registry and never take a slot — on a full
//     carrier they still replace (destroy) the picked item first, leaving a free slot (PRTS 帮助, GitHub #263).
//   * Tokens (PRTS 卫戍协议/帮助 §战斗部署, user playtest #6): placing an owner with manually deployable summons
//     (tokens.json `placeable`: 赫默's 医疗探机 and 巫恋's 诅咒娃娃 with their S2, 凯瑟琳's 爬行号·防护单元, 海嗣 / 狼群 /
//     流形) sends one stack (deployLimit copies — 凯瑟琳 2) to the hand, placed by hand like any piece (no deploy slot);
//     withdrawing/selling/merging the owner removes its tokens (an elite that takes a merged copy's tile gets a fresh
//     stack of its own, like any deployment), moving it on the board (also when a summon dragged onto
//     it swaps it away) sends its placed summons back onto their stack ("移动干员时，其所属召唤物全部退场并重置至手牌区");
//     a summon stack removed from temp at a prep deadline comes back at the next round start (startRound tops every
//     board owner's summons up to the deploy limit, "干员所属召唤物会于下一回合返还"). In battle a skill's summon takes its
//     tile when the skill fires (sim/content/tokens.js dockSkillSummons). A summon whose text reads "只能部署在召唤者
//     攻击范围内" (tokens.json `ownerRange`: the tacticians' 狼群 / 流形 — their tactical point; player report #9 after
//     0.1.0) only goes on a tile of its owner's attack range (_legal / summonRange: the loadout's grid rotated by the
//     owner's facing); a swap with its owner is checked from the owner's new tile, and one an in-place re-orientation
//     (or a promotion) leaves outside goes back onto its stack (recompute → _liftOutOfRange) [ASSUMED: kept when still
//     inside]. A re-orientation that would leave such a summon with no stack and no free hand / temp slot is refused
//     (HAND_FULL); elsewhere (a promotion, an owner moved with no room) it leaves the board and its stack comes back at
//     the next round start (grantTokensFor) — no out-of-range placement reaches the battle.
//   * Facing (DESIGN §3, research 09 §1.2): every board piece has `dir` ∈ UP|RIGHT|DOWN|LEFT (server/sim/dir.js), set
//     by g.move {…, dir} (absent ⇒ RIGHT) and kept across rounds. g.move onto the piece's OWN tile re-orients it in
//     place; a swap keeps the occupant's dir; a piece put on the board by an effect (a merge elite taking a consumed
//     copy's tile) keeps that tile's dir, anything else defaults to RIGHT (`pieceDir`). g.art {…, dir} rotates the
//     Art's range (画卷 1-1: its tile + the tile in front).
//   * Operator loadout (DESIGN §16): the human's checked `seat.loadout` ({ [baseChessId]: { skill, module } }, entries
//     equal to the defaults dropped) is re-checked against this match's data (shared/protocol.js checkLoadout; a
//     mismatch falls back to the defaults) and kept frozen; bots always use the defaults. Match.setLoadout may replace
//     it during INFO_CHECK only. battleInput() resolves every chess unit to `skillIndex` + `moduleId` (resolveLoadout:
//     normal chess → moduleId null, elite → uniEquipId | 'none'); m.private exposes `loadout`.
//   * 潜能 / 练度 (0.2.2, the owner's decision of 2026-10-08 「调配干员里自己设置吧，默认满潜满加成」): the human's checked
//     `seat.ops` ({ [charId]: { potential, cultivate } }, defaults dropped) is re-checked (checkLoadoutOps) and changed
//     with the loadout; a missing entry — and every operator of a bot — is 潜能 6, 精英2 Lv.60. battleInput() states both
//     for every operator the player owns (a chess fielded as itself, an owned 自选 pick: `cultivationFor`), never for a
//     补位 stand-in or a prototype pick (shared/potential.js cultivationOf); the 自选 summons' hand count follows the
//     owner's potential (望's 棋子). m.private exposes `ops`; the scouting views carry each unit's `potential` / `cultivate`.
//   * Operator ownership (0.2.0 补位, the approved plan — owner's decision 2026-10-05): the human's `seat.notOwned` (base
//     chess ids marked 未持有 on the 干员持有 screen) is re-checked against this match's data (shared/protocol.js
//     checkNotOwned + a stand-in record in data/backups.json) and fixed for the match (`standIns`; bots own every
//     operator). A piece of such a chess — normal or elite, wherever it is — keeps the chess's identity for the rules
//     (bonds, 特质, tier, price, sell price, merge: every rule that reads gd.chess) and is its official stand-in
//     (`fieldRecord` = gd.standIn: body, stats, range, position, skills / talents / module — the backup selection, the
//     loadout never applies to it, "对于补位干员其技能不可更改"): battleInput marks it `standIn: true`, placeClass /
//     summon range / the bots' range read the stand-in record, it makes no summons (none of the 17 stand-ins has one),
//     and what shows it shows the stand-in (the owner's recall of the official mode, 2026-10-06): the scouting views
//     (board and bench), the m.result lineup (`standInFor`), the elite / gift tickers' names. m.private exposes `standIns`.
//   * 自选编队 (0.2.0 DIY, the owner's decisions of 2026-10-05; player/diy.js): the human's `seat.diy` picks are re-checked
//     against this match's data and kits and fixed for the match (`diy`; bots none [ASSUMED]). With picks, `this.gd` is the
//     player's data view: the slotted slots' ids (normal and elite) are the composed 自选 records, so the player's piece
//     of a slot is the operator for every rule (name, class, position, bonds from its factions, no 特质, the pick's skill
//     and module; tier, price, sell price and the 3 → elite merge are the slot's). Each slotted piece has its own stock
//     (8 at tier 5, 5 at tier 6 [ASSUMED]; none when every bond of it is banned this match) and joins this player's shop
//     rolls once the 调度中心 reaches the slot's level; it never enters the shared pool. battleInput carries `diy` (the
//     pick), m.private exposes `diy` (and `diyBanned`), the scouting views draw the operator with its pick.
//
// Code layout: this file keeps the constructor (the per-player state fields); the methods live in
// server/match/player/, one module per concern, and are installed on PlayerState.prototype below in a fixed order,
// with the descriptors of class methods (non-enumerable getters included; `this` is the player state):
//   basics.js     seat flags and counts (getters), the temp due prep, the operator loadout, the deploy map and the
//                 eviction after a terrain / deploy-field change, dirty
//   pieces.js     piece bookkeeping: new pieces, lookup, detach / stow, per-piece round counters, pool copies,
//                 summon stacks
//   acquire.js    gains and merges: acquireChess / acquireItem, the chess and item merges, promotion,
//                 transformation, reward / item offers
//   economy.js    funds, spending, prep-side layer gains, the shop (prices, rolls) and its intents: buy, refresh,
//                 freeze, levelUp, sell
//   placement.js  g.move: placement legality, summon ranges, board / hand / temp moves and swaps, re-orientation
//   items.js      g.equip, g.art, g.destroy
//   prep.js       the prep-intent gate, g.reward, Ready, the temp resolution
//   round.js      the round lifecycle the match calls (startRound, endPrep, eliminate, recompute, bond views) and
//                 battleInput
//   views.js      pieceView, effectsView, m.private (privateView)
//   diy.js        自选编队: the picks (setDiy), the player's data view, the DIY stock (initDiyStock, poolOf), the shop's
//                 DIY draws (diyRollEntries), the pick of a piece (diyPickOf)
//   common.js     HAND_SIZE, TEMP_SIZE, MAX_OFFER_SLOTS, OK, fail

import { FIELD } from './board.js';
import { computeBonds } from './bondsMeta.js';
import { HAND_SIZE, TEMP_SIZE } from './player/common.js';
import { PlayerBasics } from './player/basics.js';
import { PlayerPieces } from './player/pieces.js';
import { PlayerAcquire } from './player/acquire.js';
import { PlayerEconomy } from './player/economy.js';
import { PlayerPlacement } from './player/placement.js';
import { PlayerItems } from './player/items.js';
import { PlayerPrep } from './player/prep.js';
import { PlayerRound } from './player/round.js';
import { PlayerViews } from './player/views.js';
import { PlayerDiy, DiyStock } from './player/diy.js';

export class PlayerState {
  /**
   * @param {import('./Match.js').Match} m owning match
   * @param {{ seat: number, playerId: string, name: string, isBot: boolean, connected: boolean, loadout?: any, notOwned?: any, diy?: any, persona?: string }} seat
   */
  constructor(m, seat) {
    this.m = m;
    this.gd = m.gd;
    this.playerId = seat.playerId;
    this.seat = seat.seat;
    this.name = seat.name;
    this.isBot = !!seat.isBot;
    /** preset strategy persona id (shared/botPersonas.js; bots only, set by lobby room.addBot) */
    this.botPersona = this.isBot && typeof seat.persona === 'string' ? seat.persona : null;
    this.connected = this.isBot ? true : !!seat.connected;
    this.left = false;
    this.autoplay = false;
    this.alive = true;
    this.lp = 0;
    this.bandId = null;
    this.funds = 0;
    this.pendingFunds = 0;
    this.ready = false;
    this.infoReady = this.isBot;
    this.lastEmoteAt = -Infinity;
    /** operator loadout (DESIGN §16): frozen { [baseChessId]: { skill, module } }, {} = every chess on its defaults */
    this.loadout = Object.freeze({});
    // 0.2.2: the per-operator 潜能 / 练度 ({} = every operator 潜能 6, 精英2 Lv.60 — bots always)
    this.ops = Object.freeze({});
    if (!this.isBot && (seat.loadout || seat.ops)) this.setLoadout(seat.loadout ?? null, seat.ops ?? null);
    /**
     * 补位 (0.2.0): the base chess ids this player fields as their stand-ins — the seat's not-owned list when the match
     * started, re-checked against this match's data; frozen, sorted; [] = every operator owned (bots always)
     */
    this.standIns = Object.freeze([]);
    /** @type {Set<string>} lookup set of `standIns` */
    this._standInSet = new Set();
    if (!this.isBot && seat.notOwned) this.setNotOwned(seat.notOwned);
    /**
     * 自选编队 (0.2.0): the slotted picks { [slotBaseId]: { charId, skillIndex, uniEquipId } } — the seat's when the match
     * started, re-checked; frozen; {} = none (bots always). setDiy makes `this.gd` the player's data view.
     */
    this.diy = Object.freeze({});
    /** @type {Map<string, object>} slot id (normal / elite) → composed 自选 record (setDiy) */
    this._diyRecords = new Map();
    /** the copies of the slotted pieces (initDiyStock, once the match's bans are drawn) */
    this.diyStock = new DiyStock();
    /** slotted slots without stock: every bond of the operator is switched off this match */
    this.diyBanned = Object.freeze([]);
    if (!this.isBot && seat.diy) this.setDiy(seat.diy);
    this.shop = { level: 1, upgradePrice: this.gd.upgradeBase(1) ?? 0, slots: [], frozen: false, freeRefreshes: 0 };
    /** reward offers queue (merge rewards, special refreshes): { tier, source, label, slots: [{ kind, id, price, sold }] } */
    this.offers = [];
    /** @type {Array<any>} */
    this.hand = new Array(HAND_SIZE).fill(null);
    /** @type {Array<any>} */
    this.temp = new Array(TEMP_SIZE).fill(null);
    /** preps of this player that ended so far (endPrep) = index of the current (or next) prep */
    this.prepsEnded = 0;
    /** @type {Map<number, number>} temp piece uid → index of the prep whose deadline resolves it (see tempDue) */
    this._tempDue = new Map();
    /** @type {Map<string, any>} 'r,c' → piece */
    this.board = new Map();
    /** persistent bond layers */
    this.layers = {};
    /** computed bond states */
    this.bonds = {};
    /**
     * this round's IN_BATTLE layer gains of the finished normal battle ({ [bondId]: n }, Match._finishCombat) until
     * settle() makes them persistent — the views add them (bondsView, DESIGN §20.15); null otherwise
     */
    this.pendingLayerGains = null;
    /** optional per-bond count bonus written by effects */
    this.bondCountBonus = {};
    /** EffectRef list: { id, key, name, desc, iconKind, iconId, counter?, battle, params, data } */
    this.effects = [];
    /** active bounties: { id, card, roundsLeft, chooser } */
    this.bounties = [];
    /**
     * The open personal choice of the Art 教鞭 (Match.offerBountyChoice): up to three cards.bounty entries the owner picks one
     * of with `g.choice { idx, choiceId }` — m.private only; Ready is refused while it is open, the prep's deadline (or the
     * bot) resolves it
     * @type {null | { id: string, round: number, sourceItemId: string, cards: any[] }}
     */
    this.personalChoice = null;
    /** free-form counters for content (ctx.counter / setCounter) */
    this.counters = {};
    /** per-round counters (reset at round start) */
    this.round = { refreshes: 0, buys: 0, sells: 0, spent: 0, gainedChess: 0, arts: 0 };
    this.deployCapBonus = 0;
    this.deployCapMin = 0;
    this.deviceOverrides = {};
    this.tileOverrides = {};
    this.stats = {
      dmgDealt: 0, kills: 0, leaks: 0, gold: 0, refreshes: 0, merges: 0, itemMerges: 0, itemsEquipped: 0,
      bossDamage: 0, lpLost: 0, buys: 0, sells: 0, perfectRounds: 0, fundsGained: 0, healing: 0,
    };
    this.eliminatedRound = null;
    this.lpAtFinal = null;
    /** last combat result for this player (unite carry state, bounties) */
    this.lastResult = null;
    this._deployMap = null;
    /** the deploy field of `_deployMap` ('normal' | 'bossL' | 'bossR', Match.deployFieldOf) */
    this._deployField = undefined;
    /** the deploy map changed since the board's legality was last checked (invalidateDeployMap) */
    this._legalityStale = false;
    /** Match.scheduleBotPrep: the latest bot prep of this seat (older sliced rehearsals drop out) */
    this._botPrepToken = 0;
    this.bonds = computeBonds(this.gd, this);
  }
}

// the method modules, in this order (a name defined twice is an error, never a silent override)
for (const part of [PlayerBasics, PlayerPieces, PlayerAcquire, PlayerEconomy, PlayerPlacement, PlayerItems, PlayerPrep, PlayerRound, PlayerViews, PlayerDiy]) {
  for (const key of Reflect.ownKeys(part.prototype)) {
    if (key === 'constructor') continue;
    if (Object.prototype.hasOwnProperty.call(PlayerState.prototype, key)) throw new Error(`PlayerState.${String(key)} is defined twice`);
    Object.defineProperty(PlayerState.prototype, key, Object.getOwnPropertyDescriptor(part.prototype, key));
  }
}

export { FIELD };
