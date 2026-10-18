// server/match/player/items.js — PlayerState methods: items — g.equip (max 2, a 3rd replaces the one the player picks;
// consume-on-equip items), g.art (Arts on a tile, rotated by the facing), g.destroy (hand / temp items; equipped
// ones are locked) and g.unequip (DESIGN §34.15, only when the room's unequip rule is allow).
// Installed on PlayerState.prototype by server/match/PlayerState.js (a method container: never instantiated; `this` is
// the player state).

import { ERR, GEO } from '../../../shared/constants.js';
import { morphSlotPolicy, ruleOption } from '../../../shared/plugins/rules.js';
import { tileKey, inField, parseDir, freeSlot } from '../board.js';
import { offsetTile } from '../../sim/dir.js';
import { itemKey } from '../gamedata.js';
import { OK, fail } from './common.js';

export class PlayerItems {
  /**
   * A copy that actually leaves the match repays shared-item debt first (#624). Equipping, selling a carrier
   * (the item returns to the hand) and a merge that keeps the golden do not call this.
   * @param {any} piece
   * @returns {number} copies repaid
   */
  releaseItemStock(piece) {
    if (!piece || piece.kind !== 'item' || !this.m?.itemPool) return 0;
    return this.m.itemPool.repay(piece.id, this.m.itemPool.need(piece.id));
  }

  /**
   * g.equip {itemUid, targetUid, replaceUid?}. A third item on a carrier with both slots used replaces the equipped item
   * the player picked in the replace dialog (`replaceUid`, research 09 §1.2 UseEquipUp.unloadInstId; absent ⇒ the
   * oldest); the replaced item is destroyed. A `replaceUid` that is not one of the target's equipped items is refused.
   * A consume-on-equip item replaces the same way before it resolves (GitHub #263): the carrier keeps a free slot, and a
   * target its effect refuses (博士投影 on an elite) gets the picked item back — nothing is destroyed.
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
    const policy = this._slotPolicy();
    // [ASSUMED] a second 变形同构体 is refused before anything moves. Official accepts() is always true.
    if (!policy.accepts(target.items || [], rec)) return fail(ERR.BAD_TARGET, 'morph already equipped');
    const consume = typeof rec.kind === 'string' && rec.kind.startsWith('consume_on_equip');
    if (consume) {
      const key = 'item:' + itemKey(item.id);
      if (!this.m.registry.has(key)) return fail(ERR.BAD_TARGET, 'effect not available');
      // a full carrier replaces first, consumables included (PRTS 卫戍协议/帮助 "达到上限强行佩戴会改为替换装备：指定一件已佩戴
      // 装备替换为将要佩戴的装备，并销毁被指定的装备"; GitHub #263): the pick (else the oldest) comes off before the effect —
      // which so sees the carrier without it (its bonds) — and is destroyed once the effect went through, leaving the slot
      // free (the normal 博士投影 then takes it: ev.keep, so it no longer pushes the oldest item out). A refusal puts it back.
      const off = this._takeReplaced(target, replaceUid, rec);
      const ev = { item, target, golden: !!rec.isGolden, keep: false, error: null, consumed: true };
      this.m.dispatchItem(this, item, target, 'onEquip', ev);
      if (ev.error) {
        if (off) target.items.splice(Math.min(off.idx, target.items.length), 0, off.piece);
        return fail(ERR[ev.error] ? ev.error : ERR.BAD_TARGET, typeof ev.detail === 'string' ? ev.detail : undefined);
      }
      if (off) {
        this.m.dispatchItem(this, off.piece, target, 'onDestroy', { item: off.piece, holder: target, reason: 'replace' });
        this.releaseItemStock(off.piece);
      }
      // the handler may have destroyed the target (信标) — resolve the item again
      const again = this.find(item.uid);
      if (again && again.area !== 'equipped') this._detach(again);
      if (ev.keep) {
        const holder = this.find(target.uid);
        if (holder && holder.piece.kind === 'chess') this._attach(holder.piece, item);
      }
      // !ev.keep, or the carrier is gone: the consumed item left play. A kept item is on the carrier.
      if (!this.find(item.uid)) this.releaseItemStock(item);
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
  /** The room's equip-slot policy. Official returns the shared frozen singleton, so the numbers stay today's. */
  _slotPolicy() {
    return morphSlotPolicy(ruleOption(this.m?.rules, 'morphPairing'), (it) => !!this.gd.item(it?.id)?.canGiveBond);
  }

  _attach(target, item, replaceUid = null) {
    target.items = target.items || [];
    const policy = this._slotPolicy();
    const rec = this.gd.item(item.id);
    const cap = policy.slotCap(this.gd.equipPerChess);
    // A plus morph does not occupy a slot, so this while does not run for it. Official occupies() is always true
    // and slotsUsed is items.length, so the comparison and the splice index stay today's.
    while (policy.occupies(rec) && policy.slotsUsed(target.items) >= cap) { // loop-cap: splices one item each pass
      const i = policy.replacedIndex(target.items, replaceUid);
      const [old] = target.items.splice(i, 1);
      replaceUid = null;
      this.m.dispatchItem(this, old, target, 'onDestroy', { item: old, holder: target, reason: 'replace' });
      this.releaseItemStock(old);
    }
    target.items.push(item);
  }

  /**
   * A consume-on-equip item on a full carrier: take the item `replaceUid` names (else the oldest) off `target` — not yet
   * destroyed — and return { piece, idx } (null while a slot is free).
   */
  _takeReplaced(target, replaceUid = null, incoming = null) {
    target.items = target.items || [];
    const policy = this._slotPolicy();
    // A plus morph does not replace anyone. Official occupies() is always true.
    if (incoming && !policy.occupies(incoming)) return null;
    if (policy.slotsUsed(target.items) < policy.slotCap(this.gd.equipPerChess)) return null;
    const idx = policy.replacedIndex(target.items, replaceUid);
    const [piece] = target.items.splice(idx, 1);
    return { piece, idx };
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
      this.releaseItemStock(loc.piece);
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
    this.releaseItemStock(loc.piece);
    this.m.dispatchItem(this, loc.piece, loc.holder || null, 'onDestroy', { item: loc.piece, holder: loc.holder || null, reason: 'player' });
    this.recompute();
    return OK;
  }

  /**
   * g.unequip {itemUid}: during PREP, while the seat is not ready, move one equipped item back to the hand
   * (right→left), else into a free hole of the visible temporary window. Neither free: HAND_FULL and nothing moves.
   * The official rule returns the same lock as destroy. Bots never send this.
   * [ASSUMED] shares the existing prep-intent ready lock; hidden temp overflow is not a free slot. Never calls stow.
   */
  unequip(itemUid) {
    const g = this._gate(); if (g) return g;
    if (ruleOption(this.m?.rules, 'unequip') !== 'allow') return fail(ERR.BAD_TARGET, 'equipped items are locked');
    const loc = this.find(itemUid);
    if (!loc || loc.piece.kind !== 'item' || loc.area !== 'equipped') return fail(ERR.BAD_TARGET);
    const handAt = freeSlot(this.hand);
    const tempAt = freeSlot(this.temp.slice(0, GEO.TEMP_SIZE));
    if (handAt < 0 && tempAt < 0) return fail(ERR.HAND_FULL);
    const piece = loc.piece;
    this._detach(loc);
    if (handAt >= 0) this.hand[handAt] = piece;
    else this._putTemp(tempAt, piece);
    this.recompute();
    return OK;
  }
}
