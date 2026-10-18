// server/match/player/prep.js — PlayerState methods: the gate of every prep intent (_gate: alive, PREP, not ready),
// g.reward (a reward offer's pick), Ready (refused while temp holds pieces) and the resolution of the temp pieces due
// at a prep's deadline.
// Installed on PlayerState.prototype by server/match/PlayerState.js (a method container: never instantiated; `this` is
// the player state).

import { ERR, PHASE } from '../../../shared/constants.js';
import { freeSlot } from '../board.js';
import { OK, fail } from './common.js';

export class PlayerPrep {
  _gate({ allowWhenReady = false } = {}) {
    if (!this.alive) return fail(ERR.ELIMINATED);
    if (this.m.phase !== PHASE.PREP) return fail(ERR.WRONG_PHASE);
    if (this.ready && !allowWhenReady) return fail(ERR.WRONG_PHASE, 'ready');
    return null;
  }

  /**
   * g.reward {idx}: the pick of the first queued offer (promotion reward, a strategy's special refresh, an item offer).
   * A pick is a 招募 like a purchase: a full regular hand refuses it, also when it would complete a merge (PRTS
   * 卫戍协议/帮助 §手牌区, see buy; GitHub #82).
   */
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
      // Already displayed equipment rewards survive stock exhaustion (#624, maintainer 2026-10-14).
      if (handFull) return fail(ERR.HAND_FULL);
    } else if (slot.kind === 'chess') {
      const rec = this.gd.chess(slot.id);
      if (!rec || (rec.isDiy && !rec.diyFor)) return fail(ERR.BAD_TARGET);
      // Owner decision 2026-10-11 (#498): already displayed operator rewards survive stock exhaustion.
      // acquireChess records the deficit. Displayed item rewards do the same (acquireItem displayed).
      if (handFull) return fail(ERR.HAND_FULL);
    } else return fail(ERR.BAD_TARGET);
    const price = Number.isFinite(slot.price) && slot.price > 0 ? Math.trunc(slot.price) : 0;
    if (price > this.funds) return fail(ERR.NO_FUNDS);
    slot.sold = true;
    this.offers.shift();
    if (price > 0) this.spend(price);
    if (slot.kind === 'item') {
      const gained = this.acquireItem(slot.id, { source: 'reward', displayed: true });
      // #677: maintainer decision 2026-10-17 (official play memory): one Cathy cell per player/match.
      // [ASSUMED] Only a successful pick from this source counts; Quintus's grant is independent.
      if (gained && offer.source === 'band:band_cathy' && slot.id === 'chess_item_5_08_e_a') {
        this.counters['band:cathy:cellTaken'] = 1;
        // [ASSUMED] Remove the cell from queued Cathy offers too, retaining their other choices without rerolling.
        for (const pending of this.offers) if (pending.source === 'band:band_cathy') {
          pending.slots = pending.slots.filter((s) => s.id !== slot.id);
        }
        this.offers = this.offers.filter((pending) => pending.slots.length);
      }
    } else this.acquireChess(slot.id, { source: 'reward' });
    this._afterSpend(price, 'reward');
    this.recompute();
    return OK;
  }

  setReady(on) {
    if (!this.alive) return fail(ERR.ELIMINATED);
    if (this.m.phase !== PHASE.PREP) return fail(ERR.WRONG_PHASE);
    if (on && this.personalChoice) return fail(ERR.BAD_TARGET, '请先完成教鞭选择'); // i18n-ignore: developer error detail
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
        for (const it of p.items || []) this.releaseItemStock(it);
        p.items = [];
      } else if (p.kind === 'item') this.releaseItemStock(p);
    }
    if (changed) this.recompute();
  }
}
