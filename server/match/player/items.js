// server/match/player/items.js — PlayerState methods: items — g.equip (max 2, a 3rd replaces the one the player picks;
// consume-on-equip items), g.art (Arts on a tile, rotated by the facing) and g.destroy (hand / temp items; equipped
// ones are locked).
// Installed on PlayerState.prototype by server/match/PlayerState.js (a method container: never instantiated; `this` is
// the player state).

import { ERR } from '../../../shared/constants.js';
import { tileKey, inField, parseDir } from '../board.js';
import { offsetTile } from '../../sim/dir.js';
import { itemKey } from '../gamedata.js';
import { OK, fail } from './common.js';

export class PlayerItems {
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
    // Capture the target before effects can promote or remove it.
    const action = { type: 'item.use', playerId: this.playerId, round: this.m.round, at: this.m.sched.now(),
      itemId: item.id, itemUid: item.uid,
      targets: [{ uid: target.uid, id: target.id, charId: this.gd.chess(target.id)?.charId ?? null }] };
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
      this.m.onAction?.({ ...action, outcome: ev.keep ? 'equipped' : 'consumed' });
      return OK;
    }
    this._detach(iloc);
    if (this.completesItemMerge(item.id)) {
      // an identical normal copy is already owned (equipped somewhere): merge instead of equipping — the golden
      // item goes to the hand (research 04 §2 "copies in hand and on operators both count")
      if (this._mergeItem(item.id, item)) {
        this.recompute();
        this.m.onAction?.({ ...action, type: 'item.merge', targets: [] });
        return OK;
      }
      if (!this.find(item.uid)) this.stow(item, { allowTemp: true });
    }
    const replaced = target.items?.length >= this.gd.equipPerChess ? (replaceUid ?? target.items[0].uid) : null;
    this._attach(target, item, replaceUid);
    this.stats.itemsEquipped++;
    this.m.dispatchItem(this, item, target, 'onEquip', { item, target, golden: !!rec.isGolden, consumed: false });
    this.checkItemMerges();
    this.recompute();
    this.m.onAction?.({ ...action, outcome: 'equipped', replacedUid: replaced });
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
    const action = { type: 'item.use', outcome: 'art', playerId: this.playerId, round: this.m.round, at: this.m.sched.now(),
      itemId: loc.piece.id, itemUid, tile: { row, col, dir: d },
      targets: targets.map((p) => ({ uid: p.uid, id: p.id, charId: this.gd.chess(p.id)?.charId ?? null })) };
    const ev = { item: loc.piece, row, col, dir: d, targets, error: null, used: true };
    this.m.dispatchItem(this, loc.piece, null, 'onArt', ev);
    if (ev.error) return fail(ERR[ev.error] ? ev.error : ERR.BAD_TARGET, typeof ev.detail === 'string' ? ev.detail : undefined);
    if (ev.used !== false) {
      const again = this.find(itemUid);
      if (again) this._detach(again);
      this.round.arts++;
      this.m.onAction?.(action);
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
}
