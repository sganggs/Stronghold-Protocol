// server/match/player/acquire.js — PlayerState methods: gains and merges — copy counts, acquireChess (hand, overflow
// temp, the no-room rule) and the chess merge (3 copies → the elite, on a consumed deployed copy's tile or in the hand;
// the reward offer), promotion, transformation (突变细胞: a destroy, then a gain), item upgrades, reward / item offers,
// acquireItem and the item merges (2 identical → the golden item; deferred merges at the next prep start).
// Installed on PlayerState.prototype by server/match/PlayerState.js (a method container: never instantiated; `this` is
// the player state).

import { pieceDir, parseDir, mergeTile } from '../board.js';
import { MAX_OFFER_SLOTS } from './common.js';
import { onMerge } from '../botEmotes.js';

export class PlayerAcquire {
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
    // a DIY slot is only ever this player's own 自选 piece: a slot it has not filled has no body (甄选干员) to gain
    if (!rec || (rec.isDiy && !rec.diyFor)) return null;
    const base = this.gd.baseIdOf(chessId);
    const need = rec.isGolden ? this.gd.goldenCopies : 1;
    // the shared pool, or this player's stock of a slotted 自选 piece (player/diy.js poolOf)
    const taken = fromPool ? this.poolOf(base).take(base, need) : 0;
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
   * stood on the board the elite takes its tile and facing — of several, the one that deploys first (the left board
   * column first, top to bottom within a column — Battle.start's order) [ASSUMED]. The incoming copy is never deployed (a 突变细胞 transformation
   * destroyed its carrier before the gain: that tile is no copy's). It replaces a deployed copy, so the deploy count
   * never grows. Otherwise the elite goes to the hand, overflow temp — outside PREP too (a SETTLE merge's elite waits in
   * temp through the next prep, tempDue). The copies' equipment returns to the hand ("干员晋级后已配发装备会回收至整备区";
   * overflow temp; with both full it stays on the elite, up to its equipPerChess (2) slots — any further item is
   * destroyed with a log warning, as before the official rule) and an identical normal pair among it merges like any gain
   * (checkItemMerges); their summons are removed, and an elite on the board
   * gets its own summon stack (grantTokensFor: its loadout, like any deployment). Returns the elite piece (or null if
   * the elite could not be stored).
   * @param {string} baseId
   * @param {any} incoming the acquired, not yet stowed copy (null: only owned copies)
   */
  _mergeChess(baseId, incoming) {
    const need = this.gd.mergeCount(baseId);
    const goldenId = this.gd.goldenIdOf(baseId);
    if (!(need > 1) || !goldenId) return null;
    const locs = this._chessLocations().filter((l) => !this.gd.isGolden(l.piece.id) && this.gd.baseIdOf(l.piece.id) === baseId);
    const consumed = [];
    if (incoming) consumed.push({ piece: incoming, area: 'new' });
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
    // a new piece: this round's per-piece counters start at 0, none is carried over from the copies — a newly merged
    // elite 拉普兰德 is a new 拉普兰德 and fires +8 on its own first manual refresh this round (GitHub #169; the owner's
    // decision of 2026-10-06; pieceRoundCount)
    const elite = this.newPiece('chess', goldenId, { poolCopies: copies });
    const deployed = consumed.filter((l) => l.key && !this.board.has(l.key)).map((l) => ({ key: l.key, dir: pieceDir(l.piece) }));
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
    // the returned equipment follows the auto-merge rule like any other gain ("已拥有2件同一初始装备时…自动合并")
    this.checkItemMerges();
    // deployed like any operator placed by hand: its manually deployable summons join the hand (after the returned
    // equipment, which would be lost in temp — a summon stack removed there comes back at the next round start)
    if (where === 'board') this.grantTokensFor(elite);
    if (!where) {
      this.poolOf(baseId).give(baseId, copies);
      this.m.toast(this, 'warn', '整备区已满，晋升的精锐干员无法放入');
      this.m.log.warn?.(`[match ${this.m.roomCode}] ${this.playerId}: merge result dropped (hand+temp full)`);
      this.recompute();
      return null;
    }
    this.stats.merges++;
    this.pushRewardOffer('merge');
    // (named as everyone sees the elite: a chess this player fields as its stand-in by the stand-in's name — 0.2.0 补位,
    // the owner's recall of the official mode, 2026-10-06 [ASSUMED for the ticker])
    const rec = this.gd.chess(goldenId);
    const shown = rec ? this.fieldRecord(rec) || rec : null;
    this.m.tickerFor('GOLDEN_CHAR', [this.name, shown ? shown.name : goldenId], { playerId: this.playerId });
    this.m.dispatch(this, 'onMerge', { kind: 'chess', piece: elite, baseId, consumed: consumed.map((l) => l.piece.uid), area: where });
    onMerge(this.m, this, { kind: 'chess' }); // AI bot says "害怕" on its 3rd chess merge of a round (enabled by default; SP_BOT_EMOTES=0 silences it)
    return elite;
  }

  /** Promote a normal chess piece to its elite in place (升华, 博士投影). Takes extra pool copies when available. */
  promote(piece) {
    if (!piece || piece.kind !== 'chess' || this.gd.isGolden(piece.id)) return false;
    const goldenId = this.gd.goldenIdOf(piece.id);
    if (!goldenId) return false;
    const base = this.gd.baseIdOf(piece.id);
    const extra = Math.max(0, this.gd.goldenCopies - (piece.poolCopies || 0));
    piece.poolCopies = (piece.poolCopies || 0) + this.poolOf(base).take(base, extra);
    piece.id = goldenId;
    this.recompute();
    // an elite on the board tops its summon stacks up to the elite's deploy limit, like an elite merged onto a tile
    // (_mergeChess → grantTokensFor): 麦哲伦 / 令 3 → 4, 望 6 → 7 with their modules (0.2.0 review round 17)
    if ([...this.board.values()].includes(piece)) this.grantTokensFor(piece);
    return true;
  }

  /**
   * Transformation (突变细胞 "战斗结束后，装备者替换为高一阶的随机干员"; PRTS 卫戍协议：盟约 下半/PRTS盟约记录 备注 "生效时，原
   * 干员销毁，获得一名高一阶的随机初始干员（最高六阶）"): a destroy followed by a gain. The carrier is destroyed wherever it
   * stands — a board tile is freed (the deploy count drops), its summons are removed, its pool copies return. Its
   * equipment, the cell included, comes off first (PRTS 卫戍协议/帮助 "在失去该干员（干员出售、销毁、合并等）…时自动卸除"): to
   * the hand, overflowing into temp, auto-merging like any gain. Then `newId` is gained like any other gained operator
   * (acquireChess, onGain source 'transform'): the hand, overflow temp ("被发送至手牌区的物资优先从右到左填充空位"), and with
   * both full it goes back to the pool ("整备区已满，获得的干员已返还"); it gets no summon card in the hand (only a deployment
   * brings one), and a merge it completes follows the ordinary rule (_mergeChess: the elite on a consumed deployed copy's
   * tile, else the hand — the carrier's freed tile is no copy's). An item that found no slot takes one the gain freed (a
   * merge consumes copies), else stays on the gained operator up to its equipPerChess slots, else it is destroyed with a
   * log warning (as in a merge). Official footage (bilibili BV1vzyVBuEN9, BV1Qkw1zMEoR; pointed out in PR #2): at the
   * next prep the carrier's tile is empty, one more deployment is left and the new operator waits in the 整备区.
   * @param {any} piece the carrier (an owned chess piece)
   * @param {string} newId chess id gained in its place
   * @returns {any} the gained piece (the elite when it completed a merge) or null
   */
  transformChess(piece, newId) {
    const loc = this.find(piece.uid);
    if (!loc || loc.piece.kind !== 'chess' || !this.gd.chess(newId)) return null;
    // 原干员销毁: off its tile / slot, its summons removed, its copies back to the pool
    this._detach(loc);
    this.removeTokensOf(piece.uid);
    const items = piece.items || [];
    piece.items = [];
    this.returnCopies(piece);
    // its equipment comes off first (the returned pair auto-merges, which may free a slot for the gain)
    const left = items.filter((it) => !this.stow(it, { allowTemp: true }));
    this.checkItemMerges();
    // 获得一名…干员: gained like any other gained operator
    const np = this.acquireChess(newId, { source: 'transform' });
    for (const it of left) {
      if (this.stow(it, { allowTemp: true })) continue;
      if (np && this.find(np.uid) && np.items.length < this.gd.equipPerChess) { np.items.push(it); continue; }
      this.m.log.warn?.(`[match ${this.m.roomCode}] ${this.playerId}: returned item ${it.id} destroyed (no space)`);
    }
    if (left.length) this.checkItemMerges();
    this.recompute();
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
   * The player's slotted 自选 pieces join the draw like in its shop (player/diy.js diyRollEntries: once the 调度中心 is at
   * the slot's level) — the reward is a temporary refresh of the shop ("临时刷新3名…干员") [ASSUMED].
   */
  pushRewardOffer(source = 'merge', { tier = null, ids = null, label = null } = {}) {
    const ro = this.gd.rewardOffer();
    const t = Number.isInteger(tier) ? tier : Math.min(this.shop.level + ro.tierOffset, ro.maxTier);
    // an offer never shows one operator twice, whoever built the list (user playtest #6 item 19)
    let list = Array.isArray(ids) ? [...new Set(ids)].filter((id) => this.gd.chess(id)) : null;
    if (!list) {
      list = [];
      const fresh = (id) => !list.includes(id);
      for (let i = 0; i < ro.count; i++) {
        let id = null;
        for (let tt = t; tt >= 1 && !id; tt--) id = this.m.pool.roll(this.m.rngShop, { tier: tt, filter: fresh, extra: this.diyRollEntries() });
        if (id) list.push(id);
      }
    }
    if (!list.length) return null;
    const offer = { tier: t, source, label: typeof label === 'string' && label ? label : null, slots: list.slice(0, MAX_OFFER_SLOTS).map((id) => ({ kind: 'chess', id, price: ro.price, sold: false })) };
    this.offers.push(offer);
    this.dirty();
    return offer;
  }

  /**
   * Queue a free pick-one offer of items (凯瑟琳 定向投放, 娜仁图亚 见者有份); shown as shop.rewardOffer with slots of kind
   * 'item' under its `label` (the effect's name; player report #6 after 0.1.0).
   */
  pushItemOffer(ids, { source = 'effect', tier = null, label = null } = {}) {
    const list = [...new Set(Array.isArray(ids) ? ids : [])].filter((id) => this.gd.item(id)).slice(0, MAX_OFFER_SLOTS);
    if (!list.length) return null;
    const offer = { tier: Number.isInteger(tier) ? tier : null, source, label: typeof label === 'string' && label ? label : null, slots: list.map((id) => ({ kind: 'item', id, price: 0, sold: false })) };
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
   * `deferMerge` (effectsMeta, while onPrepEnd is on the stack): stow it — hand, else temp — and do not merge in this
   * call, even when an identical normal copy is already owned. The next prep's start runs checkItemMerges. Nothing
   * already equipped is taken off for the fight about to start. Hand and temp both full keeps the 「整备区已满，获得的装备已销毁」
   * outcome. [ASSUMED] every item granted at 休整期结束, not only 维多利亚's 战栗维式重锤 (owner's decision 2026-10-04).
   */
  acquireItem(itemId, { source = 'grant', toTemp = false, silent = false, deferMerge = false } = {}) {
    const rec = this.gd.item(itemId);
    if (!rec) return null;
    let piece = this.newPiece('item', itemId);
    // A prep-end grant may sit beside an identical copy until the next prep. The invariant counts only copies
    // without this mark, so the fight that is about to start is not reported as a missed merge.
    if (deferMerge) piece.deferMerge = true;
    if (!deferMerge && this.completesItemMerge(itemId)) {
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
}
