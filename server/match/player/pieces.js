// server/match/player/pieces.js — PlayerState methods: piece bookkeeping — new pieces, lookup by uid (board / hand /
// temp / equipped), the chess locations, detach and stow (hand first, overflow temp; a free hand slot pulls a temp piece
// in, _fillHandFromTemp), the per-piece round counters (拉普兰德), pool copies back to the shared pool (a 自选 piece's to
// the player's own stock), and summon stacks (removal, lifting, counts, the stack granted for an owner — a 自选 owner's
// from its pick, player/diy.js placeableTokens).
// Installed on PlayerState.prototype by server/match/PlayerState.js (a method container: never instantiated; `this` is
// the player state).

import { tileKey, boardOrder, freeSlot } from '../board.js';
import { TEMP_SIZE } from './common.js';

export class PlayerPieces {
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

  /** Every owned chess piece: board (reading order, board.js boardOrder) then hand then temp. */
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
   * Put a piece into the hand (right→left) or, when `allowTemp`, the expandable temp queue (due at the deadline of the first prep
   * in which the player can act on it, _tempDueNow). Returns 'hand' | 'temp' | null. A piece put into temp while a hand
   * slot is free (`toTemp`) moves into the hand at the next recompute (_fillHandFromTemp).
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
    // Five visible slots are a window, not a capacity limit. Once resources are queued, append
    // new gains behind them; recompute fills visible holes without changing an in-progress merge's indices.
    const j = this.temp.length > TEMP_SIZE ? -1 : freeSlot(this.temp);
    this._putTemp(j >= 0 ? j : this.temp.length, piece);
    return 'temp';
  }

  /** Overflow refill order: the visible row right-to-left, then the hidden queue. */
  tempPieces() {
    return this.temp.slice(0, TEMP_SIZE).reverse().concat(this.temp.slice(TEMP_SIZE)).filter(Boolean);
  }

  /**
   * PRTS help's hand-area rule: free regular slots automatically receive overflow.
   * Refill order [ASSUMED]: visible slots right-to-left, followed by the hidden queue in arrival order;
   * each piece takes the hand's next free slot right-to-left. Recompute runs this after sales, deployments,
   * merges, item use and summon removal. Moving into the hand clears the piece's temp deadline;
   * moving within the visible window keeps it. Returns the number moved into the regular hand.
   * @returns {number}
   */
  _fillHandFromTemp() {
    let moved = 0;
    const indices = Array.from({ length: TEMP_SIZE }, (_, i) => TEMP_SIZE - 1 - i)
      .concat(Array.from({ length: Math.max(0, this.temp.length - TEMP_SIZE) }, (_, i) => TEMP_SIZE + i));
    for (const j of indices) {
      const p = this.temp[j];
      if (!p) continue;
      const i = freeSlot(this.hand);
      if (i < 0) break;
      this._detach({ piece: p, area: 'temp', idx: j });
      this.hand[i] = p;
      moved++;
    }
    if (this.temp.length > TEMP_SIZE) {
      // Keep the oldest five visible and refill them after sales, deployments, equipment use or merges.
      // Moving within temp preserves each UID's existing prep deadline.
      const pending = this.tempPieces();
      this.temp = new Array(TEMP_SIZE).fill(null);
      pending.forEach((p, i) => { this.temp[i < TEMP_SIZE ? TEMP_SIZE - 1 - i : i] = p; });
    }
    return moved;
  }

  /**
   * Per-piece counter of the current round (`piece.meta.round` = { r, n: { key: count } }): 0 for a key not counted yet
   * this round. The counters belong to the operator: a move keeps them, a new piece (bought, granted, transformed, or
   * an elite merged this round — _mergeChess carries none over: GitHub #169, the owner's decision of 2026-10-06)
   * starts at 0 — 拉普兰德's "本回合首次主动刷新" is the first manual refresh she witnesses (player feedback after 0.1.0,
   * garrisons/meta.js).
   */
  pieceRoundCount(piece, key) {
    const rc = piece && piece.meta && piece.meta.round;
    return rc && rc.r === this.m.round && Number.isFinite(rc.n[key]) ? rc.n[key] : 0;
  }

  /** Add `n` to a piece's counter of the current round (pieceRoundCount); returns the new count. */
  bumpPieceRoundCount(piece, key, n = 1) {
    if (!piece || typeof key !== 'string' || !Number.isFinite(n)) return 0;
    if (!piece.meta || typeof piece.meta !== 'object') piece.meta = {};
    const v = this.pieceRoundCount(piece, key) + n;
    if (!piece.meta.round || piece.meta.round.r !== this.m.round) piece.meta.round = { r: this.m.round, n: {} };
    piece.meta.round.n[key] = v;
    return v;
  }

  /** Return a piece's pool copies — to the shared pool, or a 自选 piece's to this player's stock (poolOf). */
  returnCopies(piece) {
    if (piece && piece.kind === 'chess' && piece.poolCopies > 0) {
      const base = this.gd.baseIdOf(piece.id);
      this.poolOf(base).give(base, piece.poolCopies);
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
   * 卫戍协议/帮助 "移动干员时，其所属召唤物全部退场并重置至手牌区"). With no stack and no free hand slot the summon joins
   * the expandable temp queue (`allowTemp`). A stack that a prep deadline then removes still comes back at the next
   * round start. `keep`: a summon the player just placed (the one dragged onto its owner, which swapped the owner
   * away) stays where it was put.
   */
  _liftTokensOf(ownerUid, keep = null) {
    for (const [k, p] of [...this.board]) {
      if (p.kind !== 'token' || p.ownerUid !== ownerUid || p === keep) continue;
      this.board.delete(k);
      // allowTemp always queues past the visible row; put the summon back only if stow itself refused.
      if (!this._returnToken(p, null, { allowTemp: true })) this.board.set(k, p);
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
   * A validated prep loadout change reconciles only the affected owner's board / hand / temp summons (§34.15).
   * [ASSUMED] Keep legal types up to their new limit in board reading order, then hand and temp index order;
   * remove obsolete/excess copies before granting missing cards. Valid placements and UIDs survive.
   * The caller recomputes after every owner is reconciled, returning newly out-of-range summons to their stack.
   */
  _reconcileTokensFor(owner) {
    const rec = this.gd.chess(owner.id);
    const deployed = [...this.board.values()].includes(owner);
    const stock = deployed && rec && !this.fieldsStandIn(rec)
      ? this.gd.placeableTokens(owner.id, this.loadoutFor(rec)) : [];
    const remaining = new Map(stock.map(({ tokenId, count }) => [tokenId, count]));
    const locations = boardOrder(this.board).map(({ r, c, piece }) => ({ piece, area: 'board', key: tileKey(r, c) }))
      .concat(this.hand.map((piece, idx) => ({ piece, area: 'hand', idx })),
        this.temp.map((piece, idx) => ({ piece, area: 'temp', idx })));
    for (const loc of locations) {
      const p = loc.piece;
      if (!p || p.kind !== 'token' || p.ownerUid !== owner.uid) continue;
      const keep = Math.min(p.count || 1, remaining.get(p.id) || 0);
      if (keep > 0) {
        p.count = keep;
        remaining.set(p.id, remaining.get(p.id) - keep);
      } else this._detach(loc);
    }
    if (deployed) this.grantTokensFor(owner);
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
    // 0.2.0 补位: a chess fielded as its stand-in makes the stand-in's summons — none of the 17 has one (DATA.md §18)
    if (this.fieldsStandIn(rec)) return;
    for (const { tokenId, count } of this.gd.placeableTokens(owner.id, this.loadoutFor(rec))) {
      const missing = count - this._tokenCountOf(owner.uid, tokenId);
      if (missing <= 0) continue;
      const stack = [...this.hand, ...this.temp].find((p) => p && p.kind === 'token' && p.ownerUid === owner.uid && p.id === tokenId);
      if (stack) { stack.count = (stack.count || 1) + missing; continue; }
      const t = this.newPiece('token', tokenId, { count: missing, ownerUid: owner.uid });
      this.stow(t, { allowTemp: true });
    }
  }
}
