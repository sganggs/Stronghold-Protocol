// server/sim/battle/economy.js — Battle methods: DP, IN_BATTLE bond layer gains (capped by layerGainRoom) and bounty
// coins.
// Installed on Battle.prototype by server/sim/Battle.js (a method container: never instantiated; `this` is the battle).

import { layerGainRoom } from '../../../shared/constants.js';

export class BattleEconomy {
  // Optional source is presentation attribution; the return value and DP arithmetic stay unchanged.
  addDp(playerId, n, source = null) {
    const ps = this.getPlayer(playerId);
    if (!ps || !Number.isFinite(n)) return 0;
    const before = ps.dp;
    ps.dp = Math.max(0, Math.min(this.flags.dpMax, ps.dp + n));
    const reason = source?.def?.subProf;
    if ((n > 0 && ['agent', 'charger', 'pioneer'].includes(reason)) || (n < 0 && reason === 'merchant')) {
      this.resourceNumber(source, 'cost', ps.dp - before, reason);
    }
    return ps.dp;
  }

  /** Settled display-only resource receipt. Live render hosts opt in; headless/golden runs need no extra events. */
  resourceNumber(unit, resource, amount, reason) {
    if (!this.opts.resourceNumbers || !unit?.alive || !unit.deployed || unit.hidden || !Number.isFinite(amount) || amount === 0) return;
    this._ev(['resource', unit.id, resource, amount, reason]);
  }

  /**
   * Record an IN_BATTLE layer gain (no-op when gains are disabled). Returns the layers added: at most the room left
   * under BOND_LAYER_CAP (999, shared/constants.js) on the live copy — the client's AddBondCount `min(L + n, 999)`; the
   * `layerGain` hook (魔王's +1 …) runs first, then the clamp; a bond already at the cap gains 0 (no hook, no event).
   * Without a live copy of the bond (a partial PlayerBattleInput) the battle's own gains count; the match's settle
   * clamps the persistent count the same way.
   */
  addLayers(playerId, bondId, n, reason = '', opts = {}) {
    if (!this.flags.layerGainsEnabled || !(n > 0) || !Number.isFinite(n) || playerId == null) return 0;
    const pp = this._pp(playerId);
    if (!pp) return 0;
    const ps = this.getPlayer(playerId);
    const live = ps && ps.bonds[bondId] ? (ps.bonds[bondId].layers ?? 0) : (pp.layerGains[bondId] ?? 0);
    if (!(layerGainRoom(live, Infinity) > 0)) return 0;
    const source = opts.source ?? null;
    const ctx = { playerId, bondId, n, reason, source, tile: Array.isArray(opts.tile) ? opts.tile : this._sourceTile(source) };
    if (this._hooks.layerGain) { this.emit('layerGain', ctx); if (!(ctx.n > 0) || !Number.isFinite(ctx.n)) return 0; }
    const add = layerGainRoom(live, ctx.n);
    if (!(add > 0)) return 0;
    pp.layerGains[bondId] = (pp.layerGains[bondId] ?? 0) + add;
    if (ps && ps.bonds[bondId]) ps.bonds[bondId].layers = (ps.bonds[bondId].layers ?? 0) + add;
    this._ev(['layer', playerId, bondId, add]);
    return add;
  }

  /**
   * Tile of a gain's source unit ([r, c]): where it stands, or where it stood when it left the field during this very
   * instant (a "被击倒时" gain fires from its `death`). null otherwise (no source, long gone, not a unit).
   */
  _sourceTile(u) {
    if (!u || typeof u !== 'object' || !Number.isFinite(u.x)) return null;
    const here = u.alive && u.deployed && !u.hidden;
    if (!here && !(u.deathAt === this.time && !u.alive)) return null;
    return u.side === 'ally' ? [u.tileR, u.tileC] : [Math.round(u.y), Math.round(u.x)];
  }

  /**
   * The player a kill bounty (`unit.bounty`: a 悬赏 card's enemy, a 鸭爵 swap) pays when its enemy dies: the bounty pays
   * whenever the body dies (the owner's decision, relayed 2026-10-06). An operator or summon of a player of this battle
   * that dealt the blow pays its player ("将其击倒者获得N资金" — a 联防 helper included); any other death — 无来源 damage
   * (terrain, an uncredited tick), its own drain, another enemy, an ownerless unit — pays the card's owner when that
   * player fights here (own field, Final Assault / Hidden Core), else (联防, where the owner is the leaker) the player
   * whose half of the field it fell on: PRTS 卫戍协议：盟约 决策 "该敌人于对应玩家所属区域倒下时，使相应玩家获得额外资金"
   * [ASSUMED for 联防: no source names the payee of a death nobody caused there]. Until 0.2.0 that fallback was the
   * leaker, who has no entry in a 联防 battle, and addCoins dropped the coins (community report of 2026-10-06
   * 「被源石地板烫死的悬赏没给赏金」: in 0.1.x the 联防 field was the round's map, as it is again since 0.2.1, 战场#04's
   * 活性源石 included).
   */
  _bountyPayee(unit, killer = null) {
    if (killer && killer.side === 'ally' && killer.ownerId != null && this._pp(killer.ownerId)) return killer.ownerId;
    const owner = unit.bounty?.ownerPlayerId ?? unit.ownerId;
    if (owner != null && this._pp(owner)) return owner;
    return this._ownerForTile([Math.round(unit.y), Math.round(unit.x)]);
  }

  addCoins(playerId, n) {
    const pp = this._pp(playerId);
    if (!pp || !(n > 0) || !Number.isFinite(n)) return 0;
    pp.coins += n;
    this._ev(['bounty', playerId, n]);
    return n;
  }
}
