// server/match/PlayerState.js — authoritative per-player state + every prep intent handler (DESIGN §6.2).
//
// Handlers validate → mutate → recompute bonds → mark the private view dirty. They never throw on bad input; they
// return `{ ok: true }` or `{ error: ERR.*, detail? }`. Rules (research 00-INDEX §3–§4, 01 A1, 04 §2):
//   * Hand (整备区) 10 slots filled right→left, temp (临时整备区) 5 slots. A full hand refuses buys / withdrawals,
//     except a purchase that completes a merge and a withdrawal whose own summon stack frees a slot. Passive gains (merge
//     results, grants, returned equipment) overflow into temp; temp blocks Ready ("直到溢出情况排除才可开始进行作战").
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
//   * Items: equip max 2 (a 3rd replaces the equipped item the player picks — g.equip replaceUid, the oldest when
//     absent; equipped items are otherwise locked: g.destroy refuses them),
//     2 identical normal items (hand/temp/equipped) merge into the golden item in the hand, items are never sold
//     (destroy for 0). consume-on-equip items resolve through the effect registry and never take a slot.
//   * Tokens (PRTS 卫戍协议/帮助 §战斗部署, user playtest #6): placing an owner with manually deployable summons
//     (tokens.json `placeable`: 赫默's 医疗探机 and 巫恋's 诅咒娃娃 with their S2, 凯瑟琳's 爬行号·防护单元, 海嗣 / 狼群 /
//     流形) sends one stack (deployLimit copies — 凯瑟琳 2) to the hand, placed by hand like any piece (no deploy slot);
//     withdrawing/selling/merging the owner removes its tokens (an elite that takes a merged copy's tile gets a fresh
//     stack of its own, like any deployment), moving it on the board (also when a summon dragged onto
//     it swaps it away) sends its placed summons back onto their stack ("移动干员时，其所属召唤物全部退场并重置至手牌区");
//     a summon stack removed from temp at a prep deadline comes back at the next round start (startRound tops every
//     board owner's summons up to the deploy limit, "干员所属召唤物会于下一回合返还"). In battle a skill's summon takes its
//     tile when the skill fires (sim/content/tokens.js dockSkillSummons).
//   * Facing (DESIGN §3, research 09 §1.2): every board piece has `dir` ∈ UP|RIGHT|DOWN|LEFT (server/sim/dir.js), set
//     by g.move {…, dir} (absent ⇒ RIGHT) and kept across rounds. g.move onto the piece's OWN tile re-orients it in
//     place; a swap keeps the occupant's dir; pieces put on the board by effects (a merge elite taking a consumed
//     copy's tile, a transformation keeping the tile) keep that tile's dir, anything else defaults to RIGHT
//     (`pieceDir`). g.art {…, dir} rotates the Art's range (画卷 1-1: its tile + the tile in front).
//   * Operator loadout (DESIGN §16): the human's checked `seat.loadout` ({ [baseChessId]: { skill, module } }, entries
//     equal to the defaults dropped) is re-checked against this match's data (shared/protocol.js checkLoadout; a
//     mismatch falls back to the defaults) and kept frozen; bots always use the defaults. Match.setLoadout may replace
//     it during INFO_CHECK only. battleInput() resolves every chess unit to `skillIndex` + `moduleId` (resolveLoadout:
//     normal chess → moduleId null, elite → uniEquipId | 'none'); m.private exposes `loadout`.

import { ERR, GEO, PHASE, layerGainRoom } from '../../shared/constants.js';
import { checkLoadout, resolveLoadout } from '../../shared/protocol.js';
import { FIELD, tileKey, parseKey, inField, canPlace, positionClass, boardOrder, freeSlot, pieceDir, parseDir, mergeTile } from './board.js';
import { offsetTile } from '../sim/dir.js';
import { computeBonds, bondList, bondSnapshot, activatedLayers, bondsWithGains } from './bondsMeta.js';
import { itemKey } from './gamedata.js';
import { bountyText } from './choices.js';

const HAND_SIZE = GEO.HAND_SIZE;
const TEMP_SIZE = GEO.TEMP_SIZE;
/** g.reward accepts idx 0..5 (shared/protocol.js) */
const MAX_OFFER_SLOTS = 6;
const OK = Object.freeze({ ok: true });
const fail = (error, detail) => (detail ? { error, detail } : { error });

export class PlayerState {
  /**
   * @param {import('./Match.js').Match} m owning match
   * @param {{ seat: number, playerId: string, name: string, isBot: boolean, connected: boolean }} seat
   */
  constructor(m, seat) {
    this.m = m;
    this.gd = m.gd;
    this.playerId = seat.playerId;
    this.seat = seat.seat;
    this.name = seat.name;
    this.isBot = !!seat.isBot;
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
    if (!this.isBot && seat.loadout) this.setLoadout(seat.loadout);
    this.shop = { level: 1, upgradePrice: this.gd.upgradeBase(1) ?? 0, slots: [], frozen: false, freeRefreshes: 0 };
    /** reward offers queue (merge rewards, special refreshes): { tier, source, slots: [{ kind, id, price, sold }] } */
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

  // =================================================================================================
  // basics

  get isHumanActive() { return !this.isBot && !this.left; }
  /** The engine acts for this seat (AI teammate or "AI 托管"; a departed human is eliminated, so nothing is left to do). */
  get botControlled() { return this.isBot || this.left || this.autoplay; }

  get deployCap() { return Math.max(1, this.gd.deployCap + this.deployCapBonus, this.deployCapMin); }
  get deployCount() { let n = 0; for (const p of this.board.values()) if (p.kind === 'chess') n++; return n; }
  get tempEmpty() { return this.temp.every((x) => x == null); }

  /**
   * Index of the prep whose deadline resolves a temp piece (compare with `prepsEnded`): recorded when the piece entered
   * temp (_putTemp); a piece put there by other means counts as due at the current (or next) prep.
   */
  tempDue(piece) {
    const due = piece ? this._tempDue.get(piece.uid) : undefined;
    return Number.isInteger(due) ? due : this.prepsEnded;
  }

  /**
   * Due prep of a piece entering temp now: the current prep while the player can still act on it (PREP, not ready);
   * after Ready or at the prep end (onPrepEnd grants) the next one; outside PREP (COMBAT, SETTLE, ROUND_START, 机变)
   * the next prep to end — `prepsEnded` then already names it.
   */
  _tempDueNow() {
    return this.prepsEnded + (this.m.phase === PHASE.PREP && this.ready ? 1 : 0);
  }

  /** Every write of a piece into a temp slot goes through here (records its due prep). */
  _putTemp(i, piece) {
    this.temp[i] = piece;
    this._tempDue.set(piece.uid, this._tempDueNow());
  }

  /**
   * Replace the operator loadout (DESIGN §16) after re-checking it against this match's data. Accepts the checked
   * form `{ id: { skill, module|null } }` or raw `room.loadout` entries. Returns false (loadout unchanged) when it does
   * not fit the data; bots keep the defaults.
   * @param {any} loadout
   * @returns {boolean}
   */
  setLoadout(loadout) {
    if (this.isBot) return false;
    const entries = {};
    if (loadout && typeof loadout === 'object' && !Array.isArray(loadout)) {
      for (const [id, e] of Object.entries(loadout)) {
        if (!e || typeof e !== 'object') continue;
        const x = {};
        if (Number.isInteger(e.skill)) x.skill = e.skill;
        if (typeof e.module === 'string') x.module = e.module;
        if (Object.keys(x).length) entries[id] = x;
      }
    }
    const res = checkLoadout(entries, (id) => this.gd.chess(id));
    if (!res || !res.ok) {
      this.m.log?.warn?.(`[match ${this.m.roomCode}] loadout of ${this.playerId} ignored: ${res && res.detail}`);
      return false;
    }
    const out = {};
    for (const [id, e] of Object.entries(res.loadout)) out[id] = Object.freeze({ skill: e.skill, module: e.module ?? null });
    this.loadout = Object.freeze(out);
    return true;
  }

  /** The skill index / module a chess record fights with under this player's loadout (DESIGN §16). */
  loadoutFor(chessRecord) {
    return resolveLoadout(this.loadout, chessRecord, (id) => this.gd.chess(id));
  }

  /**
   * Deploy classes of the board tiles (server/match/board.js buildDeployMap) on the field the player deploys on now
   * (Match.deployFieldOf: the own board, or its half of the boss field in a boss round — user playtest #5 item 7).
   * A change of that field (the boss round begins, a re-pairing) re-checks the board's legality like a terrain change.
   */
  deployMap() {
    const field = typeof this.m.deployFieldOf === 'function' ? this.m.deployFieldOf(this) : 'normal';
    if (this._deployMap && this._deployField !== undefined && this._deployField !== field) {
      this._deployMap = null;
      this._legalityStale = true;
    }
    if (!this._deployMap) this._deployMap = this.m.deployMapFor(this, field);
    this._deployField = field;
    return this._deployMap;
  }
  /**
   * The board's terrain changed (terrain 机变 cards, content device / tile overrides): legality is re-checked at the
   * next recompute() / battleInput() — after the whole change, so an intermediate state of a card that toggles several
   * devices never moves a piece.
   */
  invalidateDeployMap() { this._deployMap = null; this._legalityStale = true; }

  /**
   * After a terrain change, pieces standing on tiles they may no longer occupy (a melee operator on a tile that became
   * a 射击台, anything on a tile that became undeployable) are withdrawn like 撤退: an operator goes to the hand
   * (overflow temp — a passive move; the player re-places it during the prep), its summons leave the board with it; a
   * summon returns to its owner's stack. Nothing is lost: with the hand and temp both full a piece stays put.
   * @returns {number} pieces moved
   */
  _evictIllegal() {
    this._legalityStale = false;
    const names = [];
    let moved = 0;
    for (const kind of ['chess', 'token']) {
      for (const { r, c, piece } of boardOrder(this.board)) {
        if (piece.kind !== kind || this._legal(piece, r, c)) continue;
        const key = tileKey(r, c);
        this.board.delete(key);
        const ok = kind === 'chess' ? !!this.stow(piece, { allowTemp: true }) : this._returnToken(piece);
        if (!ok) { this.board.set(key, piece); continue; }
        moved++;
        if (kind === 'chess') {
          this.removeTokensOf(piece.uid);
          const rec = this.gd.chess(piece.id);
          names.push(rec && rec.name ? rec.name : piece.id);
        }
      }
    }
    if (names.length) this.m.toast(this, 'warn', `地形变化：${names.join('、')}无法停留在原位置，已撤回整备区`);
    return moved;
  }

  dirty() { this.m.markPrivate(this); }

  // =================================================================================================
  // piece bookkeeping

  newPiece(kind, id, extra = {}) {
    return { uid: this.m.nextUid(), kind, id, items: kind === 'chess' ? [] : undefined, count: kind === 'token' ? 1 : undefined, ownerUid: undefined, poolCopies: 0, boughtRound: this.m.round, meta: {}, ...extra };
  }

  /**
   * Locate a piece by uid. Returns { piece, area: 'board'|'hand'|'temp'|'equipped', idx?, key?, holder? } or null.
   */
  find(uid) {
    if (!Number.isInteger(uid)) return null;
    for (let i = 0; i < this.hand.length; i++) {
      const p = this.hand[i];
      if (!p) continue;
      if (p.uid === uid) return { piece: p, area: 'hand', idx: i };
      if (p.items) for (const it of p.items) if (it.uid === uid) return { piece: it, area: 'equipped', holder: p };
    }
    for (let i = 0; i < this.temp.length; i++) {
      const p = this.temp[i];
      if (!p) continue;
      if (p.uid === uid) return { piece: p, area: 'temp', idx: i };
      if (p.items) for (const it of p.items) if (it.uid === uid) return { piece: it, area: 'equipped', holder: p };
    }
    for (const [key, p] of this.board) {
      if (p.uid === uid) return { piece: p, area: 'board', key };
      if (p.items) for (const it of p.items) if (it.uid === uid) return { piece: it, area: 'equipped', holder: p };
    }
    return null;
  }

  /** Every owned chess piece: board (deploy order) then hand then temp. */
  allChess() {
    const out = [];
    for (const { piece } of boardOrder(this.board)) if (piece.kind === 'chess') out.push(piece);
    for (const p of this.hand) if (p && p.kind === 'chess') out.push(p);
    for (const p of this.temp) if (p && p.kind === 'chess') out.push(p);
    return out;
  }

  /** Locations of owned pieces, in merge-consumption preference order: temp, hand (left→right), board (reading order). */
  _chessLocations() {
    const out = [];
    for (let i = 0; i < this.temp.length; i++) if (this.temp[i] && this.temp[i].kind === 'chess') out.push({ piece: this.temp[i], area: 'temp', idx: i });
    for (let i = 0; i < this.hand.length; i++) if (this.hand[i] && this.hand[i].kind === 'chess') out.push({ piece: this.hand[i], area: 'hand', idx: i });
    for (const { r, c, piece } of boardOrder(this.board)) if (piece.kind === 'chess') out.push({ piece, area: 'board', key: tileKey(r, c) });
    return out;
  }

  /** Remove a located piece from its container (no side effects). */
  _detach(loc) {
    if (!loc) return;
    if (loc.area === 'hand') this.hand[loc.idx] = null;
    else if (loc.area === 'temp') { this.temp[loc.idx] = null; this._tempDue.delete(loc.piece.uid); }
    else if (loc.area === 'board') this.board.delete(loc.key);
    else if (loc.area === 'equipped') {
      const i = loc.holder.items.indexOf(loc.piece);
      if (i >= 0) loc.holder.items.splice(i, 1);
    }
  }

  /**
   * Put a piece into the hand (right→left) or, when `allowTemp`, the temp slots (due at the deadline of the first prep
   * in which the player can act on it, _tempDueNow). Returns 'hand' | 'temp' | null.
   */
  stow(piece, { allowTemp = true, toTemp = false, preferIdx = null } = {}) {
    if (!toTemp) {
      if (Number.isInteger(preferIdx) && preferIdx >= 0 && preferIdx < this.hand.length && this.hand[preferIdx] == null) {
        this.hand[preferIdx] = piece;
        return 'hand';
      }
      const i = freeSlot(this.hand);
      if (i >= 0) { this.hand[i] = piece; return 'hand'; }
      if (!allowTemp) return null;
    }
    const j = freeSlot(this.temp);
    if (j >= 0) { this._putTemp(j, piece); return 'temp'; }
    return null;
  }

  /** Return a piece's pool copies (and its equipped items are handled by the caller). */
  returnCopies(piece) {
    if (piece && piece.kind === 'chess' && piece.poolCopies > 0) {
      this.m.pool.give(this.gd.baseIdOf(piece.id), piece.poolCopies);
      piece.poolCopies = 0;
    }
  }

  /** Remove every token owned by a chess piece (board, hand, temp). */
  removeTokensOf(ownerUid) {
    for (const [k, p] of [...this.board]) if (p.kind === 'token' && p.ownerUid === ownerUid) this.board.delete(k);
    for (let i = 0; i < this.hand.length; i++) if (this.hand[i] && this.hand[i].kind === 'token' && this.hand[i].ownerUid === ownerUid) this.hand[i] = null;
    for (let i = 0; i < this.temp.length; i++) if (this.temp[i] && this.temp[i].kind === 'token' && this.temp[i].ownerUid === ownerUid) this.temp[i] = null;
  }

  /**
   * An owner that changes its board tile (moved, swapped): its summons on the board go back onto its stack (PRTS
   * 卫戍协议/帮助 "移动干员时，其所属召唤物全部退场并重置至手牌区"); overflow temp when no stack or slot is left (a
   * stack lost there comes back at the next round start). `keep`: a summon the player just placed (the one dragged
   * onto its owner, which swapped the owner away) stays where it was put.
   */
  _liftTokensOf(ownerUid, keep = null) {
    for (const [k, p] of [...this.board]) {
      if (p.kind !== 'token' || p.ownerUid !== ownerUid || p === keep) continue;
      this.board.delete(k);
      if (!this._returnToken(p, null, { allowTemp: true })) this.board.set(k, p); // nowhere to go: it stays put
    }
  }

  /** Copies of one summon type an owner has (placed pieces + stacks in the hand / temp). */
  _tokenCountOf(ownerUid, tokenId) {
    const mine = (p) => !!p && p.kind === 'token' && p.ownerUid === ownerUid && p.id === tokenId;
    let n = 0;
    for (const p of this.board.values()) if (mine(p)) n += p.count || 1;
    for (const p of this.hand) if (mine(p)) n += p.count || 1;
    for (const p of this.temp) if (mine(p)) n += p.count || 1;
    return n;
  }

  /**
   * Owner on the board: send its placeable summons to the hand (one stack per token type, topped up to the deploy limit;
   * gamedata.placeableTokens / tokens.json `placeable`, user playtest #6) — those its equipped skill / module makes
   * (DESIGN §16: 赫默 S2 医疗无人机 a drone, 赫默 S1 none). Called when the owner is placed and at every round start, which
   * returns a stack removed from temp at the last prep deadline (PRTS 卫戍协议/帮助 §手牌区 "干员所属召唤物会于下一回合
   * 返还"); copies the owner still has (placed or stacked) are not granted again.
   */
  grantTokensFor(owner) {
    const rec = owner && owner.kind === 'chess' ? this.gd.chess(owner.id) : null;
    if (!rec) return;
    for (const { tokenId, count } of this.gd.placeableTokens(owner.id, this.loadoutFor(rec))) {
      const missing = count - this._tokenCountOf(owner.uid, tokenId);
      if (missing <= 0) continue;
      const stack = [...this.hand, ...this.temp].find((p) => p && p.kind === 'token' && p.ownerUid === owner.uid && p.id === tokenId);
      if (stack) { stack.count = (stack.count || 1) + missing; continue; }
      const t = this.newPiece('token', tokenId, { count: missing, ownerUid: owner.uid });
      this.stow(t, { allowTemp: true });
    }
  }

  // =================================================================================================
  // acquisition, merges, promotion

  /** Normal copies of a base chess currently owned (board/hand/temp). */
  countCopies(baseId) {
    let n = 0;
    for (const loc of this._chessLocations()) {
      const p = loc.piece;
      if (!this.gd.isGolden(p.id) && this.gd.baseIdOf(p.id) === baseId) n++;
    }
    return n;
  }

  /** Would acquiring one more normal copy of `chessId` complete a merge? */
  completesChessMerge(chessId) {
    const rec = this.gd.chess(chessId);
    if (!rec || rec.isGolden) return false;
    const need = this.gd.mergeCount(chessId);
    if (!(need > 1) || !this.gd.goldenIdOf(chessId)) return false;
    return this.countCopies(this.gd.baseIdOf(chessId)) + 1 >= need;
  }

  /**
   * Acquire a chess (buy, reward, effect grant). Takes pool copies (normal 1, elite goldenCopies) when available,
   * merges immediately when it completes a set, otherwise stows it (hand, overflow temp). Fires onGain (for the
   * elite when a merge happened, research 01 §7 "1+1+2"). Returns the owned piece (the elite after a merge) or null.
   * @param {string} chessId
   * @param {{ source?: string, toTemp?: boolean, fromPool?: boolean, silent?: boolean }} [opts]
   */
  acquireChess(chessId, { source = 'grant', toTemp = false, fromPool = true, silent = false } = {}) {
    const rec = this.gd.chess(chessId);
    if (!rec) return null;
    const base = this.gd.baseIdOf(chessId);
    const need = rec.isGolden ? this.gd.goldenCopies : 1;
    const taken = fromPool ? this.m.pool.take(base, need) : 0;
    const piece = this.newPiece('chess', chessId, { poolCopies: taken });
    this.round.gainedChess++;
    let owned = piece;
    if (!rec.isGolden && this.completesChessMerge(chessId)) {
      owned = this._mergeChess(base, piece);
      if (!owned) return null;
    } else {
      const where = this.stow(piece, { allowTemp: true, toTemp });
      if (!where) {
        this.returnCopies(piece);
        this.m.toast(this, 'warn', '整备区已满，获得的干员已返还');
        return null;
      }
    }
    this.recompute();
    if (!silent) this.m.dispatch(this, 'onGain', { piece: owned, kind: 'chess', source });
    this.recompute();
    return owned;
  }

  /**
   * Merge `need` normal copies of `baseId` (the incoming, not yet stowed piece first, then temp, hand, board) into
   * the elite — PRTS 卫戍协议/帮助 §干员的获得与精锐化: "发送1名【精锐】状态的该干员至手牌区（若消耗已部署至作战区的干员，
   * 则发送至作战区对应位置）" (the user's playtest #6 follow-up confirms it). The tile (`mergeTile`): when a consumed copy
   * stood on the board the elite takes its tile and facing — of several, the one that deploys first (board reading
   * order: top → bottom, then left → right) [ASSUMED]; `fromKey` / `fromDir` = the tile the incoming piece stood on (a
   * transformation of a deployed operator) counts as such a copy. It replaces a deployed copy, so the deploy count never
   * grows. Otherwise the elite goes to the hand, overflow temp — outside PREP too (a SETTLE merge's elite waits in temp
   * through the next prep, tempDue). The copies' equipment returns to the hand ("干员晋级后已配发装备会回收至整备区";
   * overflow temp; with both full it stays on the elite, up to its equipPerChess (2) slots — any further item is
   * destroyed with a log warning, as before the official rule); their summons are removed, and an elite on the board
   * gets its own summon stack (grantTokensFor: its loadout, like any deployment). Returns the elite piece (or null if
   * the elite could not be stored).
   * @param {string} baseId
   * @param {any} incoming the acquired, not yet stowed copy (null: only owned copies)
   * @param {{ fromKey?: string|null, fromDir?: string }} [opts]
   */
  _mergeChess(baseId, incoming, { fromKey = null, fromDir = undefined } = {}) {
    const need = this.gd.mergeCount(baseId);
    const goldenId = this.gd.goldenIdOf(baseId);
    if (!(need > 1) || !goldenId) return null;
    const locs = this._chessLocations().filter((l) => !this.gd.isGolden(l.piece.id) && this.gd.baseIdOf(l.piece.id) === baseId);
    const consumed = [];
    if (incoming) consumed.push({ piece: incoming, area: 'new', key: fromKey || undefined, dir: fromDir });
    for (const l of locs) { if (consumed.length >= need) break; consumed.push(l); }
    if (consumed.length < need) return null;
    let copies = 0;
    const items = [];
    for (const l of consumed) {
      copies += l.piece.poolCopies || 0;
      if (l.area !== 'new') this._detach(l);
      this.removeTokensOf(l.piece.uid);
      for (const it of l.piece.items || []) items.push(it);
      l.piece.items = [];
    }
    const elite = this.newPiece('chess', goldenId, { poolCopies: copies });
    const deployed = consumed.filter((l) => l.key && !this.board.has(l.key)).map((l) => ({ key: l.key, dir: l.area === 'new' ? l.dir : pieceDir(l.piece) }));
    const toTile = (t) => { elite.dir = parseDir(t.dir) || 'RIGHT'; this.board.set(t.key, elite); return 'board'; };
    const tile = mergeTile(deployed, (r, c) => this._legal(elite, r, c));
    let where = tile ? toTile(tile) : this.stow(elite, { allowTemp: true });
    // hand and temp full and no deployed tile legal for it (a terrain change not re-checked yet): it stays on the first
    // deployed copy's tile rather than being lost, like a piece _evictIllegal finds no room for
    if (!where && deployed.length) where = toTile(mergeTile(deployed));
    for (const it of items) {
      if (this.stow(it, { allowTemp: true })) continue;
      if (where && elite.items.length < this.gd.equipPerChess) { elite.items.push(it); continue; }
      this.m.log.warn?.(`[match ${this.m.roomCode}] ${this.playerId}: returned item ${it.id} destroyed (no space)`);
    }
    // deployed like any operator placed by hand: its manually deployable summons join the hand (after the returned
    // equipment, which would be lost in temp — a summon stack removed there comes back at the next round start)
    if (where === 'board') this.grantTokensFor(elite);
    if (!where) {
      this.m.pool.give(baseId, copies);
      this.m.toast(this, 'warn', '整备区已满，晋升的精锐干员无法放入');
      this.m.log.warn?.(`[match ${this.m.roomCode}] ${this.playerId}: merge result dropped (hand+temp full)`);
      this.recompute();
      return null;
    }
    this.stats.merges++;
    this.pushRewardOffer('merge');
    const rec = this.gd.chess(goldenId);
    this.m.tickerFor('GOLDEN_CHAR', [this.name, rec ? rec.name : goldenId], { playerId: this.playerId });
    this.m.dispatch(this, 'onMerge', { kind: 'chess', piece: elite, baseId, consumed: consumed.map((l) => l.piece.uid), area: where });
    return elite;
  }

  /** Promote a normal chess piece to its elite in place (升华, 博士投影). Takes extra pool copies when available. */
  promote(piece) {
    if (!piece || piece.kind !== 'chess' || this.gd.isGolden(piece.id)) return false;
    const goldenId = this.gd.goldenIdOf(piece.id);
    if (!goldenId) return false;
    const base = this.gd.baseIdOf(piece.id);
    const extra = Math.max(0, this.gd.goldenCopies - (piece.poolCopies || 0));
    piece.poolCopies = (piece.poolCopies || 0) + this.m.pool.take(base, extra);
    piece.id = goldenId;
    this.recompute();
    return true;
  }

  /**
   * Replace a chess piece by another chess (突变细胞). The result always goes back to the 备战区 — the hand, overflowing
   * to temp — never onto the board: a transformation is a new operator the player deploys again (user playtest: the
   * carrier used to keep its tile, which handed out a free deployment and its summons). The equipment is kept and the
   * pool copies are swapped; a merge the transformation completes still follows the ordinary merge rule
   * (_mergeChess: the elite takes a consumed deployed copy's tile, PRTS "若消耗已部署至作战区的干员…").
   */
  transformChess(piece, newId) {
    const loc = this.find(piece.uid);
    const rec = this.gd.chess(newId);
    if (!loc || loc.piece.kind !== 'chess' || !rec) return null;
    this._detach(loc);
    this.removeTokensOf(piece.uid);
    const items = piece.items || [];
    piece.items = [];
    this.returnCopies(piece);
    const base = this.gd.baseIdOf(newId);
    const taken = this.m.pool.take(base, rec.isGolden ? this.gd.goldenCopies : 1);
    let np = this.newPiece('chess', newId, { poolCopies: taken });
    np.items = items;
    if (!rec.isGolden && this.completesChessMerge(newId)) {
      np = this._mergeChess(base, np, loc.area === 'board' ? { fromKey: loc.key, fromDir: pieceDir(piece) } : undefined);
      if (!np) { this.recompute(); return null; }
    } else if (!this._putBack(loc, np)) { this.returnCopies(np); np = null; }
    this.recompute();
    if (np) this.m.dispatch(this, 'onGain', { piece: np, kind: 'chess', source: 'transform' });
    return np;
  }

  /** Normal item → golden version in place (整备). */
  upgradeItem(piece) {
    const rec = this.gd.item(piece.id);
    if (!rec || rec.isGolden) return false;
    const gid = rec.upgradeChessId || rec.goldenId;
    if (!gid || !this.gd.item(gid)) return false;
    piece.id = gid;
    this.recompute();
    return true;
  }

  /**
   * Queue a reward offer: `count` DIFFERENT chess of tier min(level + offset, maxTier) at price 0 (pick 1). Each is a
   * copy-weighted roll from the shared pool excluding the ones already drawn; a tier left without another chess tops
   * up from the tier below (user playtest #6 item 19: the official promotion reward never offers one operator twice —
   * the user's first-hand report; the normal shop's slots may repeat). The offer reserves no copies (the pick takes one).
   */
  pushRewardOffer(source = 'merge', { tier = null, ids = null } = {}) {
    const ro = this.gd.rewardOffer();
    const t = Number.isInteger(tier) ? tier : Math.min(this.shop.level + ro.tierOffset, ro.maxTier);
    // an offer never shows one operator twice, whoever built the list (user playtest #6 item 19)
    let list = Array.isArray(ids) ? [...new Set(ids)].filter((id) => this.gd.chess(id)) : null;
    if (!list) {
      list = [];
      const fresh = (id) => !list.includes(id);
      for (let i = 0; i < ro.count; i++) {
        let id = null;
        for (let tt = t; tt >= 1 && !id; tt--) id = this.m.pool.roll(this.m.rngShop, { tier: tt, filter: fresh });
        if (id) list.push(id);
      }
    }
    if (!list.length) return null;
    const offer = { tier: t, source, slots: list.slice(0, MAX_OFFER_SLOTS).map((id) => ({ kind: 'chess', id, price: ro.price, sold: false })) };
    this.offers.push(offer);
    this.dirty();
    return offer;
  }

  /** Queue a free pick-one offer of items (凯瑟琳 定向投放 and similar); shown as shop.rewardOffer with kind 'item'. */
  pushItemOffer(ids, { source = 'effect', tier = null } = {}) {
    const list = (Array.isArray(ids) ? ids : []).filter((id) => this.gd.item(id)).slice(0, MAX_OFFER_SLOTS);
    if (!list.length) return null;
    const offer = { tier: Number.isInteger(tier) ? tier : null, source, slots: list.map((id) => ({ kind: 'item', id, price: 0, sold: false })) };
    this.offers.push(offer);
    this.dirty();
    return offer;
  }

  /** Item merge candidates: normal, mergeable, with a golden version. */
  _itemMergeable(id) {
    const rec = this.gd.item(id);
    if (!rec || rec.isGolden || rec.itemType !== 'EQUIP' || !rec.mergeable) return false;
    const n = Number.isInteger(rec.upgradeNum) ? rec.upgradeNum : this.gd.itemMergeCount;
    if (!(n > 1 && n < 100)) return false;
    const gid = rec.upgradeChessId || rec.goldenId;
    return !!(gid && this.gd.item(gid));
  }

  _itemLocations(id) {
    const out = [];
    for (let i = 0; i < this.temp.length; i++) if (this.temp[i] && this.temp[i].kind === 'item' && this.temp[i].id === id) out.push({ piece: this.temp[i], area: 'temp', idx: i });
    for (let i = 0; i < this.hand.length; i++) if (this.hand[i] && this.hand[i].kind === 'item' && this.hand[i].id === id) out.push({ piece: this.hand[i], area: 'hand', idx: i });
    for (const holder of this.allChess()) for (const it of holder.items || []) if (it.id === id) out.push({ piece: it, area: 'equipped', holder });
    return out;
  }

  completesItemMerge(id) {
    if (!this._itemMergeable(id)) return false;
    const rec = this.gd.item(id);
    const n = Number.isInteger(rec.upgradeNum) ? rec.upgradeNum : this.gd.itemMergeCount;
    return this._itemLocations(id).length + 1 >= n;
  }

  /**
   * Acquire an item (buy, supply card, grant). Merges with an identical normal copy (hand/temp/equipped) into the
   * golden item (to the hand). Returns the owned piece or null.
   */
  acquireItem(itemId, { source = 'grant', toTemp = false, silent = false } = {}) {
    const rec = this.gd.item(itemId);
    if (!rec) return null;
    let piece = this.newPiece('item', itemId);
    if (this.completesItemMerge(itemId)) {
      piece = this._mergeItem(itemId, piece);
      if (!piece) return null;
    } else if (!this.stow(piece, { allowTemp: true, toTemp })) {
      this.m.toast(this, 'warn', '整备区已满，获得的装备已销毁');
      return null;
    }
    this.recompute();
    if (!silent) this.m.dispatch(this, 'onGain', { piece, kind: 'item', source });
    return piece;
  }

  _mergeItem(itemId, incoming = null) {
    const rec = this.gd.item(itemId);
    const need = Number.isInteger(rec.upgradeNum) ? rec.upgradeNum : this.gd.itemMergeCount;
    const locs = this._itemLocations(itemId);
    const consumed = incoming ? [{ piece: incoming, area: 'new' }] : [];
    for (const l of locs) { if (consumed.length >= need) break; consumed.push(l); }
    if (consumed.length < need) return null;
    // remember where equipped twins sat: with a full hand AND a full temp the golden item takes the first one's slot
    const slotOf = consumed.filter((l) => l.area === 'equipped').map((l) => ({ holder: l.holder, idx: l.holder.items.indexOf(l.piece) }));
    for (const l of consumed) if (l.area !== 'new') this._detach(l);
    const golden = this.newPiece('item', rec.upgradeChessId || rec.goldenId);
    if (!this.stow(golden, { allowTemp: true })) {
      const at = slotOf[0];
      if (!at || !this.find(at.holder.uid)) {
        this.m.toast(this, 'warn', '整备区已满，合成的装备已销毁');
        return null;
      }
      at.holder.items.splice(Math.max(0, Math.min(at.idx, at.holder.items.length)), 0, golden);
    }
    this.stats.itemMerges++;
    this.m.dispatch(this, 'onMerge', { kind: 'item', piece: golden, itemId, consumed: consumed.map((l) => l.piece.uid) });
    return golden;
  }

  /** Merge every identical normal item pair currently owned (after equips / returns). */
  checkItemMerges() {
    for (let guard = 0; guard < 20; guard++) {
      const counts = new Map();
      const scan = (p) => { if (p && p.kind === 'item' && this._itemMergeable(p.id)) counts.set(p.id, (counts.get(p.id) || 0) + 1); };
      for (const p of this.hand) scan(p);
      for (const p of this.temp) scan(p);
      for (const holder of this.allChess()) for (const it of holder.items || []) scan(it);
      let did = false;
      for (const [id, n] of counts) {
        const rec = this.gd.item(id);
        const need = Number.isInteger(rec.upgradeNum) ? rec.upgradeNum : this.gd.itemMergeCount;
        if (n >= need) { if (this._mergeItem(id, null)) did = true; break; }
      }
      if (!did) return;
    }
  }

  // =================================================================================================
  // economy

  addFunds(n, { reason = '' } = {}) {
    if (!Number.isFinite(n) || n === 0) return 0;
    const v = Math.trunc(n);
    const before = this.funds;
    this.funds = Math.max(0, this.funds + v);
    if (v > 0) this.stats.fundsGained += v;
    this.dirty();
    return this.funds - before;
  }

  spend(n) {
    const v = Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
    if (v > this.funds) return false;
    this.funds -= v;
    this.stats.gold += v;
    this.round.spent += v;
    this.dirty();
    return true;
  }

  /** onSpend, dispatched once a payment's action is complete (buy / refresh / levelUp / reward / effect). */
  _afterSpend(amount, reason) {
    if (!(amount > 0)) return;
    this.m.dispatch(this, 'onSpend', { amount, reason, total: this.stats.gold });
  }

  /**
   * Bond layer gain (prep-side). `requireActive` = "使已激活的【X】层数+N". Returns layers added: at most the room left
   * under BOND_LAYER_CAP (999, shared/constants.js) — a gain at the cap adds 0 and dispatches nothing.
   */
  addLayers(bondId, n, { requireActive = false, reason = '' } = {}) {
    if (!this.gd.bond(bondId) || !Number.isFinite(n) || n <= 0) return 0;
    if (requireActive && !(this.bonds[bondId] && this.bonds[bondId].active)) return 0;
    const before = this.layers[bondId] || 0;
    const add = layerGainRoom(before, Math.floor(n));
    if (add <= 0) return 0;
    this.layers[bondId] = before + add;
    this.recompute();
    this.m.dispatch(this, 'onLayers', { bondId, from: before, to: before + add, reason });
    return add;
  }

  // =================================================================================================
  // shop

  /** Effective price of a shop slot after onPrice modifiers (never negative). */
  priceOf(slot) {
    if (!slot) return 0;
    const ev = { slot, kind: slot.kind, id: slot.id, price: slot.basePrice };
    this.m.dispatch(this, 'onPrice', ev, { quiet: true });
    const p = Number(ev.price);
    return Number.isFinite(p) ? Math.max(0, Math.round(p)) : slot.basePrice;
  }

  _rollChessSlot() {
    const id = this.m.pool.roll(this.m.rngShop, { maxTier: this.shop.level });
    return id ? { kind: 'chess', id, basePrice: this.gd.chessPrice(id), frozen: false, sold: false } : null;
  }

  _rollItemSlot() {
    const id = this.m.pool.rollItem(this.m.rngShop, this.shop.level);
    return id ? { kind: 'item', id, basePrice: this.gd.itemPrice(id), frozen: false, sold: false } : null;
  }

  /**
   * Reroll the shop. keepFrozen → frozen unsold slots survive (round start); otherwise everything is rerolled
   * (manual refresh). Slot counts follow the current level.
   */
  rollShop({ keepFrozen = false } = {}) {
    const { chess: nChess, item: nItem } = this.gd.shopSlots(this.shop.level);
    const old = this.shop.slots;
    const layout = this.shop.layout || { chess: old.length, item: 0 };
    const oldChess = old.slice(0, layout.chess);
    const oldItems = old.slice(layout.chess);
    const keep = (s, kind) => (keepFrozen && s && s.kind === kind && !s.sold && s.frozen ? { ...s } : null);
    // frozen slots keep their position; sold / empty / unfrozen positions are rerolled
    const slots = [];
    for (let i = 0; i < nChess; i++) slots.push(keep(oldChess[i], 'chess') ?? this._rollChessSlot());
    for (let i = 0; i < nItem; i++) slots.push(keep(oldItems[i], 'item') ?? this._rollItemSlot());
    this.shop.slots = slots;
    this.shop.layout = { chess: nChess, item: nItem };
    for (const s of slots) if (s) s.frozen = this.shop.frozen;
    this.dirty();
  }

  /** Combat start: unfrozen slots are emptied (research 01 A1). */
  clearUnfrozenShop() {
    this.shop.slots = this.shop.slots.map((s) => (s && s.frozen && !s.sold ? s : null));
    this.dirty();
  }

  // =================================================================================================
  // gating

  _gate({ allowWhenReady = false } = {}) {
    if (!this.alive) return fail(ERR.ELIMINATED);
    if (this.m.phase !== PHASE.PREP) return fail(ERR.WRONG_PHASE);
    if (this.ready && !allowWhenReady) return fail(ERR.WRONG_PHASE, 'ready');
    return null;
  }

  // =================================================================================================
  // intent handlers

  buy(slotIdx) {
    const g = this._gate(); if (g) return g;
    if (!Number.isInteger(slotIdx) || slotIdx < 0 || slotIdx >= this.shop.slots.length) return fail(ERR.BAD_TARGET);
    const slot = this.shop.slots[slotIdx];
    if (!slot) return fail(ERR.BAD_TARGET);
    if (slot.sold) return fail(ERR.SOLD_OUT);
    const price = this.priceOf(slot);
    if (this.funds < price) return fail(ERR.NO_FUNDS);
    const handFull = freeSlot(this.hand) < 0;
    let piece;
    if (slot.kind === 'chess') {
      const rec = this.gd.chess(slot.id);
      if (!rec) return fail(ERR.BAD_TARGET);
      const base = this.gd.baseIdOf(slot.id);
      const need = rec.isGolden ? this.gd.goldenCopies : 1;
      if (this.m.pool.has(base) && this.m.pool.left(base) < need) return fail(ERR.SOLD_OUT);
      if (handFull && !this.completesChessMerge(slot.id)) return fail(ERR.HAND_FULL);
      this.spend(price);
      slot.sold = true;
      piece = this.acquireChess(slot.id, { source: 'buy' });
    } else {
      if (!this.gd.item(slot.id)) return fail(ERR.BAD_TARGET);
      if (handFull && !this.completesItemMerge(slot.id)) return fail(ERR.HAND_FULL);
      this.spend(price);
      slot.sold = true;
      piece = this.acquireItem(slot.id, { source: 'buy' });
    }
    this.stats.buys++;
    this.round.buys++;
    this.m.dispatch(this, 'onBuy', { piece, slot, price, kind: slot.kind });
    this._afterSpend(price, 'buy');
    this.recompute();
    return OK;
  }

  refresh() {
    const g = this._gate(); if (g) return g;
    const free = this.shop.freeRefreshes > 0;
    const price = free ? 0 : this.gd.refreshPrice;
    if (!free && this.funds < price) return fail(ERR.NO_FUNDS);
    if (free) this.shop.freeRefreshes--;
    else this.spend(price);
    this.rollShop({ keepFrozen: false });
    this.stats.refreshes++;
    this.round.refreshes++;
    this.m.dispatch(this, 'onRefresh', { slots: this.shop.slots, free, price });
    this._afterSpend(price, 'refresh');
    this.dirty();
    return OK;
  }

  freeze() {
    const g = this._gate(); if (g) return g;
    this.shop.frozen = !this.shop.frozen;
    for (const s of this.shop.slots) if (s && !s.sold) s.frozen = this.shop.frozen;
    this.dirty();
    return OK;
  }

  levelUp() {
    const g = this._gate(); if (g) return g;
    if (this.shop.level >= this.gd.maxShopLevel) return fail(ERR.MAX_LEVEL);
    const price = Math.max(0, this.shop.upgradePrice);
    if (this.funds < price) return fail(ERR.NO_FUNDS);
    this.spend(price);
    this.shop.level++;
    this.shop.upgradePrice = this.gd.upgradeBase(this.shop.level) ?? 0;
    this.m.tickerFor('SHOP_LEVEL', [this.name, String(this.shop.level)], { playerId: this.playerId, param: String(this.shop.level) });
    this.m.dispatch(this, 'onLevelUp', { level: this.shop.level, price });
    this._afterSpend(price, 'levelUp');
    this.dirty();
    return OK;
  }

  sell(uid) {
    const g = this._gate(); if (g) return g;
    const loc = this.find(uid);
    if (!loc) return fail(ERR.BAD_TARGET);
    if (loc.piece.kind !== 'chess') return fail(ERR.BAD_TARGET, loc.piece.kind === 'item' ? 'items cannot be sold' : 'tokens cannot be sold');
    const piece = loc.piece;
    // its equipment returns to the hand (overflow temp): refuse rather than destroy it when there is no room
    const room = this.hand.filter((x) => x == null).length + this.temp.filter((x) => x == null).length + (loc.area === 'hand' || loc.area === 'temp' ? 1 : 0);
    if ((piece.items || []).length > room) return fail(ERR.HAND_FULL, 'no room for the equipment');
    this._detach(loc);
    this.removeTokensOf(piece.uid);
    for (const it of piece.items || []) {
      if (!this.stow(it, { allowTemp: true })) this.m.log.warn?.(`[match ${this.m.roomCode}] ${this.playerId}: item ${it.id} lost on sell (no space)`);
    }
    piece.items = [];
    this.returnCopies(piece);
    const ev = { piece, gain: this.gd.sellPrice(piece.id) };
    this.m.dispatch(this, 'onSold', ev);
    const gain = Number.isFinite(ev.gain) ? Math.max(0, Math.trunc(ev.gain)) : 1;
    this.addFunds(gain, { reason: 'sell' });
    this.stats.sells++;
    this.round.sells++;
    this.checkItemMerges();
    this.recompute();
    return OK;
  }

  /**
   * g.move {uid, to, dir?}. Pieces: chess / token between board, hand and temp; items only within the hand. `dir`
   * (UP|RIGHT|DOWN|LEFT, absent ⇒ RIGHT; `to.dir` is read when the top-level one is absent) is the facing of a piece
   * moved onto the board — onto its own tile it re-orients the piece in place.
   */
  move(uid, to, dir) {
    const g = this._gate(); if (g) return g;
    const loc = this.find(uid);
    if (!loc || loc.area === 'equipped') return fail(ERR.BAD_TARGET);
    if (!to || typeof to !== 'object') return fail(ERR.BAD_TARGET);
    const piece = loc.piece;
    if (to.area === 'board') {
      if (piece.kind === 'item') return fail(ERR.BAD_TARGET, 'items are equipped, not placed');
      const d = parseDir(dir !== undefined ? dir : to.dir);
      if (!d) return fail(ERR.BAD_TARGET, 'bad dir');
      return piece.kind === 'token' ? this._moveTokenToBoard(loc, to.row, to.col, d) : this._moveChessToBoard(loc, to.row, to.col, d);
    }
    if (to.area === 'hand') {
      if (!Number.isInteger(to.idx) || to.idx < 0 || to.idx >= this.hand.length) return fail(ERR.BAD_TARGET);
      return this._moveToHand(loc, to.idx);
    }
    return fail(ERR.BAD_TARGET);
  }

  _placementOf(piece) {
    const rec = piece.kind === 'token' ? this.gd.token(piece.id) : this.gd.chess(piece.id);
    return positionClass(rec);
  }

  _legal(piece, r, c) { return canPlace(this.deployMap(), this._placementOf(piece), r, c); }

  _moveChessToBoard(loc, r, c, dir = 'RIGHT') {
    const piece = loc.piece;
    if (!inField(r, c) || !this._legal(piece, r, c)) return fail(ERR.BAD_TILE);
    const key = tileKey(r, c);
    const occ = this.board.get(key) || null;
    if (occ === piece) return this._reorient(piece, dir);
    if (loc.area === 'board') {
      // board → board: move or swap (the occupant must be legal on the source tile and keeps its own facing); an
      // operator that changes its tile takes its summons off the board (back onto their stacks, _liftTokensOf)
      if (occ) {
        const [sr, sc] = parseKey(loc.key);
        if (!this._legal(occ, sr, sc)) return fail(ERR.BAD_TILE);
        this.board.set(loc.key, occ);
        if (occ.kind === 'chess') this._liftTokensOf(occ.uid);
      } else {
        this.board.delete(loc.key);
      }
      piece.dir = dir;
      this.board.set(key, piece);
      this._liftTokensOf(piece.uid);
      this.recompute();
      return OK;
    }
    // hand/temp → board
    if (!occ || occ.kind !== 'chess') {
      if (this.deployCount >= this.deployCap) return fail(ERR.BOARD_FULL);
    }
    this._detach(loc);
    if (occ) {
      this.board.delete(key);
      if (occ.kind === 'chess') {
        this.removeTokensOf(occ.uid);
        this._putBack(loc, occ);
      } else {
        this._returnToken(occ, loc);
      }
    }
    piece.dir = dir;
    this.board.set(key, piece);
    this.grantTokensFor(piece);
    this.recompute();
    return OK;
  }

  /** In-place re-orientation (g.move onto the piece's own tile with a new direction). */
  _reorient(piece, dir) {
    if (pieceDir(piece) !== dir) { piece.dir = dir; this.dirty(); }
    return OK;
  }

  /** Put a piece into the container slot described by `loc` (hand/temp idx), or anywhere free. */
  _putBack(loc, piece) {
    if (loc.area === 'hand' && this.hand[loc.idx] == null) { this.hand[loc.idx] = piece; return true; }
    if (loc.area === 'temp' && this.temp[loc.idx] == null) { this._putTemp(loc.idx, piece); return true; }
    return !!this.stow(piece, { allowTemp: true });
  }

  /**
   * A board token goes back to the hand: merge into its owner's stack, else occupy a free slot. `allowTemp: false`
   * (the player's own withdrawal): a summon stack is a card, so with a full hand and no stack to join it is refused
   * like any other card (research 01 A1) instead of overflowing into temp.
   */
  _returnToken(tok, preferLoc = null, { allowTemp = true } = {}) {
    const stack = [...this.hand, ...this.temp].find((p) => p && p.kind === 'token' && p.ownerUid === tok.ownerUid && p.id === tok.id);
    if (stack) { stack.count = (stack.count || 1) + (tok.count || 1); return true; }
    tok.count = tok.count || 1;
    if (preferLoc && preferLoc.area === 'hand' && this.hand[preferLoc.idx] == null) { this.hand[preferLoc.idx] = tok; return true; }
    return !!this.stow(tok, { allowTemp });
  }

  _moveTokenToBoard(loc, r, c, dir = 'RIGHT') {
    const piece = loc.piece;
    if (!inField(r, c) || !this._legal(piece, r, c)) return fail(ERR.BAD_TILE);
    const key = tileKey(r, c);
    const occ = this.board.get(key) || null;
    if (occ === piece) return this._reorient(piece, dir);
    if (loc.area === 'board') {
      // board → board: move or swap; an operator swapped onto the summon's old tile changed its tile, so its other
      // summons go back onto their stacks like any moved operator (_liftTokensOf; the summon just placed stays)
      if (occ) {
        const [sr, sc] = parseKey(loc.key);
        if (!this._legal(occ, sr, sc)) return fail(ERR.BAD_TILE);
        this.board.set(loc.key, occ);
      } else {
        this.board.delete(loc.key);
      }
      piece.dir = dir;
      this.board.set(key, piece);
      if (occ && occ.kind === 'chess') this._liftTokensOf(occ.uid, piece);
      this.recompute();
      return OK;
    }
    if (occ) return fail(ERR.BAD_TILE, 'occupied');
    // owner must be on the board for its summons to be deployable
    const owner = [...this.board.values()].find((p) => p.uid === piece.ownerUid);
    if (!owner) return fail(ERR.BAD_TARGET, 'owner not deployed');
    if ((piece.count || 1) > 1) {
      piece.count -= 1;
      const one = this.newPiece('token', piece.id, { count: 1, ownerUid: piece.ownerUid, dir });
      this.board.set(key, one);
    } else {
      this._detach(loc);
      piece.count = 1;
      piece.dir = dir;
      this.board.set(key, piece);
    }
    this.recompute();
    return OK;
  }

  _moveToHand(loc, idx) {
    const piece = loc.piece;
    const occ = this.hand[idx];
    if (occ === piece) return OK;
    if (piece.kind === 'token') {
      if (loc.area !== 'board') {
        // hand/temp token stack: plain slot move / swap inside the containers
        return this._swapContainers(loc, idx);
      }
      this.board.delete(loc.key);
      if (!this._returnToken(piece, occ == null ? { area: 'hand', idx } : null, { allowTemp: false })) {
        this.board.set(loc.key, piece);
        return fail(ERR.HAND_FULL);
      }
      this.recompute();
      return OK;
    }
    if (loc.area === 'board') {
      // withdraw (撤退): to an empty slot, or swap with a chess occupant (which takes the board tile). The piece's own
      // summon stacks leave the hand with it, so a slot holding one counts as free (a full hand nets zero cards)
      const ownStack = (p) => !!p && p.kind === 'token' && p.ownerUid === piece.uid;
      if (occ == null || ownStack(occ)) {
        this.board.delete(loc.key);
        this.removeTokensOf(piece.uid);
        this.hand[idx] = piece;
      } else if (occ.kind === 'chess') {
        const [sr, sc] = parseKey(loc.key);
        if (!this._legal(occ, sr, sc)) return fail(ERR.BAD_TILE);
        // the bench card takes the withdrawn piece's tile with that tile's facing
        occ.dir = pieceDir(piece);
        this.board.set(loc.key, occ);
        this.hand[idx] = piece;
        this.removeTokensOf(piece.uid);
        this.grantTokensFor(occ);
      } else {
        let j = freeSlot(this.hand);
        if (j < 0) j = this.hand.findIndex(ownStack);
        if (j < 0) return fail(ERR.HAND_FULL);
        this.board.delete(loc.key);
        this.removeTokensOf(piece.uid);
        this.hand[j] = piece;
      }
      this.recompute();
      return OK;
    }
    return this._swapContainers(loc, idx);
  }

  /** hand/temp → hand slot: move into an empty slot or swap with the occupant. */
  _swapContainers(loc, idx) {
    const piece = loc.piece;
    const occ = this.hand[idx];
    this._detach(loc);
    this.hand[idx] = piece;
    if (occ) {
      if (loc.area === 'hand') this.hand[loc.idx] = occ;
      else this._putTemp(loc.idx, occ);
    }
    this.recompute();
    return OK;
  }

  /**
   * g.equip {itemUid, targetUid, replaceUid?}. A third item on a carrier with both slots used replaces the equipped item
   * the player picked in the replace dialog (`replaceUid`, research 09 §1.2 UseEquipUp.unloadInstId; absent ⇒ the
   * oldest); the replaced item is destroyed. A `replaceUid` that is not one of the target's equipped items is refused.
   */
  equip(itemUid, targetUid, replaceUid = null) {
    const g = this._gate(); if (g) return g;
    const iloc = this.find(itemUid);
    if (!iloc || iloc.piece.kind !== 'item' || (iloc.area !== 'hand' && iloc.area !== 'temp')) return fail(ERR.BAD_TARGET);
    const rec = this.gd.item(iloc.piece.id);
    if (!rec || rec.itemType !== 'EQUIP') return fail(ERR.BAD_TARGET, 'not equipment');
    const tloc = this.find(targetUid);
    if (!tloc || tloc.piece.kind !== 'chess' || tloc.area === 'equipped') return fail(ERR.BAD_TARGET);
    const item = iloc.piece;
    const target = tloc.piece;
    if (replaceUid != null && !(Number.isInteger(replaceUid) && (target.items || []).some((x) => x.uid === replaceUid))) return fail(ERR.BAD_TARGET, 'replace: not equipped on the target');
    const consume = typeof rec.kind === 'string' && rec.kind.startsWith('consume_on_equip');
    if (consume) {
      const key = 'item:' + itemKey(item.id);
      if (!this.m.registry.has(key)) return fail(ERR.BAD_TARGET, 'effect not available');
      const ev = { item, target, golden: !!rec.isGolden, keep: false, error: null, consumed: true };
      this.m.dispatchItem(this, item, target, 'onEquip', ev);
      if (ev.error) return fail(ERR[ev.error] ? ev.error : ERR.BAD_TARGET, typeof ev.detail === 'string' ? ev.detail : undefined);
      // the handler may have destroyed the target (信标) — resolve the item again
      const again = this.find(item.uid);
      if (again && again.area !== 'equipped') this._detach(again);
      if (ev.keep) {
        const holder = this.find(target.uid);
        if (holder && holder.piece.kind === 'chess') this._attach(holder.piece, item);
      }
      this.stats.itemsEquipped++;
      this.checkItemMerges();
      this.recompute();
      return OK;
    }
    this._detach(iloc);
    if (this.completesItemMerge(item.id)) {
      // an identical normal copy is already owned (equipped somewhere): merge instead of equipping — the golden
      // item goes to the hand (research 04 §2 "copies in hand and on operators both count")
      if (this._mergeItem(item.id, item)) { this.recompute(); return OK; }
      if (!this.find(item.uid)) this.stow(item, { allowTemp: true });
    }
    this._attach(target, item, replaceUid);
    this.stats.itemsEquipped++;
    this.m.dispatchItem(this, item, target, 'onEquip', { item, target, golden: !!rec.isGolden, consumed: false });
    this.checkItemMerges();
    this.recompute();
    return OK;
  }

  /**
   * Attach an item. With both slots used the item `replaceUid` names (the player's pick) is replaced, else the oldest;
   * the replaced item is destroyed.
   */
  _attach(target, item, replaceUid = null) {
    target.items = target.items || [];
    while (target.items.length >= this.gd.equipPerChess) {
      const i = replaceUid != null ? target.items.findIndex((x) => x.uid === replaceUid) : -1;
      const [old] = target.items.splice(i >= 0 ? i : 0, 1);
      replaceUid = null;
      this.m.dispatchItem(this, old, target, 'onDestroy', { item: old, holder: target, reason: 'replace' });
    }
    target.items.push(item);
  }

  /** g.art {itemUid, row, col, dir?}: the Art's range grid is rotated by `dir` (absent ⇒ RIGHT). */
  useArt(itemUid, row, col, dir) {
    const g = this._gate(); if (g) return g;
    const d = parseDir(dir);
    if (!d) return fail(ERR.BAD_TARGET, 'bad dir');
    const loc = this.find(itemUid);
    if (!loc || loc.piece.kind !== 'item' || (loc.area !== 'hand' && loc.area !== 'temp')) return fail(ERR.BAD_TARGET);
    const rec = this.gd.item(loc.piece.id);
    if (!rec || rec.itemType !== 'MAGIC') return fail(ERR.BAD_TARGET, 'not an art');
    if (!inField(row, col)) return fail(ERR.BAD_TILE);
    if (this.round.arts >= this.gd.maxArtsPerRound) return fail(ERR.BAD_TARGET, 'art limit');
    const key = 'item:' + itemKey(loc.piece.id);
    if (!this.m.registry.has(key)) return fail(ERR.BAD_TARGET, 'effect not available');
    const grid = Array.isArray(rec.rangeGrid) && rec.rangeGrid.length ? rec.rangeGrid : [[0, 0]];
    const targets = [];
    for (const [dr, dc] of grid) {
      const [tr, tc] = offsetTile(row, col, dr, dc, d);
      const p = this.board.get(tileKey(tr, tc));
      if (p) targets.push(p);
    }
    const ev = { item: loc.piece, row, col, dir: d, targets, error: null, used: true };
    this.m.dispatchItem(this, loc.piece, null, 'onArt', ev);
    if (ev.error) return fail(ERR[ev.error] ? ev.error : ERR.BAD_TARGET, typeof ev.detail === 'string' ? ev.detail : undefined);
    if (ev.used !== false) {
      const again = this.find(itemUid);
      if (again) this._detach(again);
      this.round.arts++;
    }
    this.recompute();
    return OK;
  }

  /**
   * g.destroy {uid}: an item in the hand / temp (Arts included). Equipped items are locked (research 04 §2 / addendum:
   * they leave the operator only on promotion, merge or sale); replacing one is g.equip's `replaceUid`.
   */
  destroy(uid) {
    const g = this._gate(); if (g) return g;
    const loc = this.find(uid);
    if (!loc || loc.piece.kind !== 'item') return fail(ERR.BAD_TARGET, 'only items can be destroyed');
    if (loc.area === 'equipped') return fail(ERR.BAD_TARGET, 'equipped items are locked');
    this._detach(loc);
    this.m.dispatchItem(this, loc.piece, loc.holder || null, 'onDestroy', { item: loc.piece, holder: loc.holder || null, reason: 'player' });
    this.recompute();
    return OK;
  }

  pickReward(idx) {
    const g = this._gate(); if (g) return g;
    const offer = this.offers[0];
    if (!offer) return fail(ERR.BAD_TARGET, 'no reward');
    if (!Number.isInteger(idx) || idx < 0 || idx >= offer.slots.length) return fail(ERR.BAD_TARGET);
    const slot = offer.slots[idx];
    if (!slot || slot.sold) return fail(ERR.SOLD_OUT);
    const handFull = freeSlot(this.hand) < 0;
    if (slot.kind === 'item') {
      if (!this.gd.item(slot.id)) return fail(ERR.BAD_TARGET);
      if (handFull && !this.completesItemMerge(slot.id)) return fail(ERR.HAND_FULL);
    } else {
      const rec = this.gd.chess(slot.id);
      if (!rec) return fail(ERR.BAD_TARGET);
      const base = this.gd.baseIdOf(slot.id);
      const need = rec.isGolden ? this.gd.goldenCopies : 1;
      if (this.m.pool.has(base) && this.m.pool.left(base) < need) return fail(ERR.SOLD_OUT);
      if (handFull && !this.completesChessMerge(slot.id)) return fail(ERR.HAND_FULL);
    }
    const price = Number.isFinite(slot.price) && slot.price > 0 ? Math.trunc(slot.price) : 0;
    if (price > this.funds) return fail(ERR.NO_FUNDS);
    slot.sold = true;
    this.offers.shift();
    if (price > 0) this.spend(price);
    if (slot.kind === 'item') this.acquireItem(slot.id, { source: 'reward' });
    else this.acquireChess(slot.id, { source: 'reward' });
    this._afterSpend(price, 'reward');
    this.recompute();
    return OK;
  }

  setReady(on) {
    if (!this.alive) return fail(ERR.ELIMINATED);
    if (this.m.phase !== PHASE.PREP) return fail(ERR.WRONG_PHASE);
    if (on && !this.tempEmpty) return fail(ERR.TEMP_NOT_EMPTY);
    if (this.ready === !!on) return OK;
    this.ready = !!on;
    // un-ready: the player can act again, so what overflowed while it was ready is due at this prep's deadline
    if (!on) for (const p of this.temp) if (p && this.tempDue(p) > this.prepsEnded) this._tempDue.set(p.uid, this.prepsEnded);
    this.dirty();
    this.m.onReadyChanged(this);
    return OK;
  }

  /**
   * Prep deadline: every temp piece due at this prep (tempDue ≤ prepsEnded) is resolved — a chess is sold back (its
   * pool copies return, its summons are removed), items are destroyed, the summon stack of an owner still on the board
   * is removed and comes back at the next round start (startRound → grantTokensFor; PRTS "干员所属召唤物会于下一回合
   * 返还"). Pieces that overflowed after the player could no longer act on them (after Ready, at the prep end) are kept
   * for the next prep.
   */
  resolveTemp() {
    let changed = false;
    for (let i = 0; i < this.temp.length; i++) {
      const p = this.temp[i];
      if (!p || this.tempDue(p) > this.prepsEnded) continue;
      this.temp[i] = null;
      this._tempDue.delete(p.uid);
      changed = true;
      if (p.kind === 'chess') {
        this.removeTokensOf(p.uid);
        this.returnCopies(p);
      }
    }
    if (changed) this.recompute();
  }

  // =================================================================================================
  // round lifecycle helpers (called by Match)

  startRound(r) {
    this.round = { refreshes: 0, buys: 0, sells: 0, spent: 0, gainedChess: 0, arts: 0 };
    this.pendingLayerGains = null; // settled (or lapsed) at the last SETTLE
    if (r > 1) this.shop.upgradePrice = Math.max(0, this.shop.upgradePrice - 1);
    // onIncome handlers may rewrite ev.income / ev.pending (e.g. 老鲤 withholds R1–R2 income until R3)
    const ev = { round: r, income: this.gd.income(r), pending: this.pendingFunds };
    this.pendingFunds = 0;
    this.m.dispatch(this, 'onIncome', ev);
    const nonNeg = (v) => (Number.isFinite(v) && v > 0 ? Math.trunc(v) : 0);
    this.addFunds(nonNeg(ev.income) + nonNeg(ev.pending), { reason: 'income' });
    // temp is NOT wiped here: the last prep's deadline resolved what the player could act on (endPrep); what overflowed
    // after it (battle-result grants, SETTLE merges, returned equipment) is shown and usable in this prep (tempDue).
    // Likewise reward offers of the last prep already expired at its end; what is still queued was earned after it —
    // a merge completed during SETTLE / the Final Assault (突变细胞, battle-result grants) — and is shown in this prep
    this.ready = false;
    // summon stacks removed from temp at the last prep deadline come back (PRTS 卫戍协议/帮助 §手牌区); full hand ⇒ temp
    for (const p of [...this.board.values()]) if (p.kind === 'chess') this.grantTokensFor(p);
    this.rollShop({ keepFrozen: true });
    this.shop.frozen = false;
    for (const s of this.shop.slots) if (s) s.frozen = false;
    this.recompute();
  }

  /**
   * Prep deadline (Match.endPrep, after the <休整期结束时> onPrepEnd effects): the temp pieces due at this prep are
   * resolved; what overflowed after Ready or during onPrepEnd stays for the next prep, which `prepsEnded` now names.
   */
  endPrep() {
    this.resolveTemp();
    this.prepsEnded++;
    for (const uid of [...this._tempDue.keys()]) if (!this.temp.some((p) => p && p.uid === uid)) this._tempDue.delete(uid);
    this.offers = [];
    this.clearUnfrozenShop();
    if (!this.gd.leftoverKeptBands.includes(this.bandId)) this.funds = 0;
    this.ready = true;
    this.dirty();
  }

  eliminate(round) {
    this.alive = false;
    this.ready = false;
    this.eliminatedRound = round;
    const all = [];
    for (const p of this.board.values()) all.push(p);
    for (const p of this.hand) if (p) all.push(p);
    for (const p of this.temp) if (p) all.push(p);
    for (const p of all) this.returnCopies(p);
    this.board.clear();
    this.hand.fill(null);
    this.temp.fill(null);
    this._tempDue.clear();
    this.offers = [];
    this.bounties = [];
    this.shop.slots = [];
    this.funds = 0;
    this.pendingFunds = 0;
    this.recompute();
  }

  recompute() {
    this.deployMap(); // a change of the deploy field (a boss round's prep) marks the legality stale
    if (this._legalityStale) this._evictIllegal();
    this.bonds = computeBonds(this.gd, this);
    this.dirty();
  }

  activatedLayers() { return activatedLayers(this.bonds); }

  /**
   * The bond states the views show (m.private bonds, m.public players[].bonds): the computed states plus the pending
   * in-battle gains of this round's finished normal battle (bondsMeta.bondsWithGains). Never used by rules.
   */
  bondsView() { return bondsWithGains(this.bonds, this.pendingLayerGains); }

  // =================================================================================================
  // battle input

  battleInput({ side = 'L', colOffset = 0, carry = null } = {}) {
    // a terrain change not yet followed by a recompute (a content hook at the prep end) never fields an illegal board
    this.deployMap();
    if (this._legalityStale) this.recompute();
    const units = [];
    for (const { r, c, piece } of boardOrder(this.board)) {
      if (piece.kind === 'chess') {
        const u = { uid: piece.uid, kind: 'chess', chessId: piece.id, row: r, col: c, dir: pieceDir(piece), items: (piece.items || []).map((i) => i.id) };
        // DESIGN §16: the equipped skill / module (elite only) from the loadout (defaults when absent)
        const lo = this.loadoutFor(this.gd.chess(piece.id));
        u.skillIndex = lo.skillIndex;
        u.moduleId = lo.moduleId;
        if (carry && carry.has(piece.uid)) u.carryState = carry.get(piece.uid);
        units.push(u);
      } else if (piece.kind === 'token') {
        units.push({ uid: piece.uid, kind: 'token', tokenId: piece.id, row: r, col: c, dir: pieceDir(piece), ownerUid: piece.ownerUid });
      }
    }
    return {
      playerId: this.playerId,
      seat: this.seat,
      side,
      colOffset,
      units,
      bonds: bondSnapshot(this.bonds),
      bandId: this.bandId,
      playerEffects: this.effects.filter((e) => e.battle !== false).map((e) => ({
        id: e.id, key: e.key ?? null, source: e.iconKind ?? null, params: e.params ?? null, counter: e.counter ?? null, data: e.data ?? null,
      })),
      deviceOverrides: { ...this.deviceOverrides },
    };
  }

  // =================================================================================================
  // views

  pieceView(p, rc = null) {
    const rec = p.kind === 'item' ? this.gd.item(p.id) : p.kind === 'token' ? this.gd.token(p.id) : this.gd.chess(p.id);
    const v = {
      uid: p.uid,
      kind: p.kind,
      id: p.id,
      golden: !!(rec && rec.isGolden),
      tier: rec && Number.isInteger(rec.tier) ? rec.tier : null,
      items: p.kind === 'chess' ? (p.items || []).map((it) => ({ uid: it.uid, id: it.id })) : [],
      count: p.kind === 'token' ? (p.count || 1) : 1,
      ownerUid: p.kind === 'token' ? p.ownerUid ?? null : null,
    };
    if (rc) { v.row = rc[0]; v.col = rc[1]; v.dir = pieceDir(p); }
    return v;
  }

  effectsView() {
    const out = [];
    const band = this.bandId ? this.gd.band(this.bandId) : null;
    if (band) out.push({ id: band.effectId || band.bandId, name: band.effectName || band.name, desc: band.desc || '', iconKind: 'band', iconId: band.iconId || band.bandId });
    for (const e of this.effects) {
      if (e.hidden) continue;
      const v = { id: e.id, name: e.name || e.id, desc: e.desc || '', iconKind: e.iconKind || 'choice', iconId: e.iconId || e.id };
      if (e.counter != null) v.counter = e.counter;
      out.push(v);
    }
    for (const b of this.bounties) {
      // the battles the bounty's enemies still come for (an official multi-round card: every battle, no counter) and
      // the card's official rich text (blue "下场作战" / "两场作战", red "每场"; a multi-round card reads as long as it
      // lasts — choices.js bountyText, MULTI_ROUND_BOUNTY_BATTLES) — user playtest #6 item 4
      const left = b.roundsLeft >= 90 ? null : b.roundsLeft;
      const eff = b.card.effectId ? this.gd.effect(b.card.effectId) : null;
      out.push({
        id: b.id, name: b.card.name || '悬赏', desc: bountyText((eff && eff.descRaw) || b.card.desc || '', b.card), iconKind: 'choice', iconId: b.card.effectId || 'bounty',
        counter: left, counterText: left == null ? '之后的每场作战' : `还剩 ${left} 场作战`,
      });
    }
    return out;
  }

  privateView() {
    const slots = this.shop.slots.map((s) => (s ? { kind: s.kind, id: s.id, price: this.priceOf(s), basePrice: s.basePrice, sold: !!s.sold, frozen: !!s.frozen } : null));
    const offer = this.offers[0] || null;
    const free = this.shop.freeRefreshes > 0;
    const board = [];
    for (const { r, c, piece } of boardOrder(this.board)) board.push(this.pieceView(piece, [r, c]));
    return {
      t: 'm.private',
      playerId: this.playerId,
      seat: this.seat,
      alive: this.alive,
      lp: this.lp,
      funds: this.funds,
      bandId: this.bandId,
      ready: this.ready,
      canReady: this.alive && this.tempEmpty && this.m.phase === PHASE.PREP,
      shop: {
        level: this.shop.level,
        maxLevel: this.gd.maxShopLevel,
        upgradePrice: this.shop.level >= this.gd.maxShopLevel ? 0 : this.shop.upgradePrice,
        refreshPrice: free ? 0 : this.gd.refreshPrice,
        freeRefreshes: this.shop.freeRefreshes,
        frozen: this.shop.frozen,
        slots,
        rewardOffer: offer ? { tier: offer.tier, slots: offer.slots.map((s) => ({ kind: s.kind === 'item' ? 'item' : 'chess', id: s.id, price: s.price, sold: !!s.sold })) } : null,
      },
      hand: this.hand.map((p) => (p ? this.pieceView(p) : null)),
      temp: this.temp.map((p) => (p ? this.pieceView(p) : null)),
      board,
      deployCap: this.deployCap,
      deployCount: this.deployCount,
      bonds: bondList(this.gd, this.bondsView(), { full: true }),
      effects: this.effectsView(),
      nextEnemies: this.m.nextEnemiesFor(this),
      // DESIGN §16: the effective operator loadout ({ [baseChessId]: { skill, module } }; chess not listed use defaults)
      loadout: this.loadout,
      stats: {
        dmgDealt: Math.round(this.stats.dmgDealt), kills: this.stats.kills, leaks: this.stats.leaks, gold: this.stats.gold,
        refreshes: this.stats.refreshes, merges: this.stats.merges,
      },
    };
  }
}

export { FIELD };
