// server/match/player/round.js — PlayerState methods: the round lifecycle the match calls — startRound (income, pending
// coins, the shop, summon stacks topped up), endPrep, eliminate (every copy back to the pool), recompute (legality,
// out-of-range summons, temp pieces into free hand slots, bonds), the bond views — and battleInput (the player's
// PlayerBattleInput: board units with their loadout, their 补位 mark or their 自选 pick, carried 联防 state, the reached
// layers).
// Installed on PlayerState.prototype by server/match/PlayerState.js (a method container: never instantiated; `this` is
// the player state).

import { boardOrder, pieceDir } from '../board.js';
import { computeBonds, bondSnapshot, activatedLayers, bondsWithGains } from '../bondsMeta.js';

export class PlayerRound {
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

  // `effects` are kept: a 信标 gift still pending is delivered to the teammate at the next round start (builtin_gift is
  // flagged afterElimination — GitHub #86); nothing else of an eliminated player is dispatched.
  eliminate(round) {
    this.alive = false;
    this.ready = false;
    this.eliminatedRound = round;
    const all = [];
    for (const p of this.board.values()) all.push(p);
    for (const p of this.hand) if (p) all.push(p);
    for (const p of this.temp) if (p) all.push(p);
    for (const p of all) this.returnCopies(p);
    // the equipped equipment is not in `all`: its copies go back with the carriers' (GitHub #466)
    for (const p of all) for (const it of p.items || []) this.returnCopies(it);
    this.board.clear();
    this.hand.fill(null);
    this.temp.fill(null);
    this._tempDue.clear();
    this.offers = [];
    this.bounties = [];
    this.personalChoice = null;
    this.shop.slots = [];
    this.funds = 0;
    this.pendingFunds = 0;
    this.recompute();
  }

  recompute() {
    this.deployMap(); // a change of the deploy field (a boss round's prep) marks the legality stale
    if (this._legalityStale) this._evictIllegal();
    this._liftOutOfRange();
    // a free regular hand slot pulls a temp piece in (PRTS 卫戍协议/帮助 §手牌区 "常规手牌区出现空位时自动移入")
    this._fillHandFromTemp();
    this.bonds = computeBonds(this.gd, this);
    this.dirty();
  }

  activatedLayers() { return activatedLayers(this.bonds); }

  /**
   * The bond states the views show (m.private bonds, m.public players[].bonds): the computed states plus the pending
   * in-battle gains of this round's finished normal battle (bondsMeta.bondsWithGains). The 联防 field fights with them too
   * (battleInput `reached`); no other rule reads them.
   */
  bondsView() { return bondsWithGains(this.bonds, this.pendingLayerGains); }

  /**
   * `reached`: the bonds carry the layers this round's own combat reached (bondsView: the pending in-battle gains, capped
   * like settle()) — the 联防 field (unite.js; PRTS 卫戍协议/帮助 §联防阶段 "将以其阵地当前的状态", [ASSUMED] the current
   * state includes those layers, as the strip shows them). The gains stay pending: settle() adds them once.
   */
  battleInput({ side = 'L', colOffset = 0, carry = null, reached = false } = {}) {
    // a terrain change not yet followed by a recompute (a content hook at the prep end) never fields an illegal board
    this.deployMap();
    if (this._legalityStale) this.recompute();
    const units = [];
    for (const { r, c, piece } of boardOrder(this.board)) {
      if (piece.kind === 'chess') {
        const u = { uid: piece.uid, kind: 'chess', chessId: piece.id, row: r, col: c, dir: pieceDir(piece), items: (piece.items || []).map((i) => i.id) };
        const pick = this.diyPickOf(piece.id);
        if (pick) {
          // 0.2.0 自选编队: a slotted DIY slot fights as its pick (sim getChess(id, { diy }): the operator's body, the pick's
          // skill and module — no loadout fields, docs/SIM.md §12)
          u.diy = { charId: pick.charId, skillIndex: pick.skillIndex, uniEquipId: pick.uniEquipId };
        } else if (this.fieldsStandIn(piece.id)) {
          // 0.2.0 补位: a chess this player does not own fights as its stand-in (sim getChess(id, { standIn: true }): the
          // backup skill / module — no loadout fields, docs/SIM.md §12)
          u.standIn = true;
        } else {
          // DESIGN §16: the equipped skill / module (elite only) from the loadout (defaults when absent)
          const lo = this.loadoutFor(this.gd.chess(piece.id));
          u.skillIndex = lo.skillIndex;
          u.moduleId = lo.moduleId;
        }
        // 0.2.2: the potential / 练度 of an operator the player owns (the chess as itself, an owned 自选 pick — the player's
        // 干员调配 settings, 潜能 6 / 精英2 Lv.60 by default and for bots; never a stand-in's nor a prototype pick's)
        const cv = u.standIn ? null : this.cultivationFor(this.gd.chess(piece.id));
        if (cv) { u.potential = cv.potential; u.cultivate = cv.cultivate; }
        if (carry && carry.has(piece.uid)) u.carryState = carry.get(piece.uid);
        units.push(u);
      } else if (piece.kind === 'token') {
        const u = { uid: piece.uid, kind: 'token', tokenId: piece.id, row: r, col: c, dir: pieceDir(piece), ownerUid: piece.ownerUid };
        if (carry && carry.has(piece.uid)) u.carryState = carry.get(piece.uid); // 联防: { sp } (unite.js)
        units.push(u);
      }
    }
    return {
      playerId: this.playerId,
      seat: this.seat,
      side,
      colOffset,
      units,
      bonds: bondSnapshot(reached ? this.bondsView() : this.bonds),
      bandId: this.bandId,
      playerEffects: this.effects.filter((e) => e.battle !== false).map((e) => ({
        id: e.id, key: e.key ?? null, source: e.iconKind ?? null, params: e.params ?? null, counter: e.counter ?? null, data: e.data ?? null,
      })),
      deviceOverrides: { ...this.deviceOverrides },
    };
  }
}
