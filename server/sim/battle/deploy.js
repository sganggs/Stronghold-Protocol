// server/sim/battle/deploy.js — Battle methods: deployment, death and redeploy: _deploy (home, landing or rest tile; 联防
// carry), kill / retreat and the removal bookkeeping (_remove, hooks of removed units released at step end), redeploy /
// automatic redeploys, leaks.
// Installed on Battle.prototype by server/sim/Battle.js (a method container: never instantiated; `this` is the battle).

import { COLS } from '../constants.js';
import { unitInfo } from '../snapshot.js';
import { fin } from './util.js';

export class BattleDeploy {
  /**
   * Deploy `u` on its home tile, or on `tile` ([r, c]: a one-off landing tile — the home stays the board tile; an
   * operator that left the field comes back on its body tile, restTile). `keepSp` = { sp, charges }
   * restored right after the skill reset, before the `deploy` hook fires.
   */
  _deploy(u, { initial = false, carry = null, tile = null, keepSp = null } = {}) {
    if ((u.alive && u.deployed) || u._removing) return false;
    const R0 = tile ? tile[0] : u.homeR, C0 = tile ? tile[1] : u.homeC;
    if (!this.grid.inRect(R0, C0)) {
      this.log(`${u} at ${R0},${C0} is outside the field rect; not deployed`);
      if (!tile) u.removed = true;
      return false;
    }
    const k = R0 * COLS + C0;
    const occ = this._occ[k];
    if (occ && occ !== u && occ.alive && occ.deployed) { this.log(`tile ${R0},${C0} occupied; ${u} not deployed`); return false; }
    // "倒地干员所在地块视为可部署，但所有我方单位在此处的部署行为将被阻止" (PRTS 卫戍协议/帮助 §作战阶段 单位部署)
    if (this.downOn(R0, C0, u)) { this.log(`a knocked-out operator lies on ${R0},${C0}; ${u} not deployed`); return false; }
    const first = u.deploySeq === 0;
    u.alive = true;
    u.deployed = true;
    u.removed = false;
    u.hidden = false;
    u.body = null;
    u.countdown = null; // a countdown summon's content starts its new life in the deploy hook (content/tokens.js startCountdown)
    u.downAtHome = false; // a new deployment: a later knock-out lies where it falls again (Battle._layBody)
    u.x = C0; u.y = R0; u.tileR = R0; u.tileC = C0;
    u.blocking = [];
    u.deploySeq = ++this._deploySeq;
    u.aggroSeq = u.deploySeq;
    u.deployedAt = this.time;
    u.atkCd = 0;
    u.lastAttackAt = -Infinity;
    u.elem.burn = u.elem.neural = u.elem.necrosis = u.elem.apoptosis = u.elem.erosion = 0;
    u.ground = this.grid.isLow(R0, C0) && !this._elevated?.has(k);
    u.markDirty();
    u.hp = u.s.maxHp;
    // 联防 carry (PRTS 卫戍协议/帮助 §联防阶段 "将对应单位的生命比例、技力修改至与上一阶段结束时相同（召唤物仅修改技力…）"):
    // an operator's HP ratio here, the SP in skill.reset and again after the `deploy` hook (below) — a summon's SP only
    const cs = initial || (first && this._startDeploying) ? (carry ?? u.carry) : null;
    if (cs && u.kind === 'op' && Number.isFinite(cs.hpPct)) u.hp = Math.max(1, u.s.maxHp * Math.max(0.01, Math.min(1, cs.hpPct)));
    this._occ[k] = u;
    this._refreshRange(u); // also rebuilds baseRangeKeys (initial range incl. permanent rangeExtend)
    if (!u.skill) this._setupUnit(u);
    u.skill.reset(cs);
    const sk = u.skill;
    // "自动操作具有3s冷却，在完成一次操作或作战开始时部署的单位将进入冷却" (PRTS 卫戍协议/帮助; skills.js)
    if (initial) sk.opReadyAt = this.time + this.flags.startOpCooldown;
    if (keepSp && !sk.noSkill && sk.kind !== 'passive' && !sk.active) {
      sk.charges = Math.max(0, Math.min(sk.maxCharges, Math.floor(fin(keepSp.charges, 0))));
      sk.sp = Math.max(0, Math.min(sk.spCost, fin(keepSp.sp, 0)));
      if (sk.charges >= sk.maxCharges) sk.sp = sk.spCost;
    }
    if (first) this._ev(['spawn', unitInfo(u)]);
    this._ev(['deploy', u.id]);
    if (this._hooks.deploy) this.emit('deploy', { unit: u, initial });
    // 联防: "部署完成后，将对应单位的…技力修改至与上一阶段结束时相同" — the carried SP is set again once the deployment is
    // done, so a deploy-time SP gift (独行, 黄沙罗盘 …) does not come on top of it; later redeploys keep those gifts
    if (cs && Number.isFinite(cs.sp) && u.alive && u.skill) u.skill.setSpTotal(cs.sp);
    return true;
  }

  /** Mark `unit` dead (hp reached 0). Fires `kill` then `death`. */
  kill(unit, killer = null) {
    if (!unit || !unit.alive) return;
    unit.hp = 0;
    if (this._hooks.kill) this.emit('kill', { killer, victim: unit });
    // a nested kill/retreat inside the handlers already removed it: a later handler's hp write must not stick
    if (!unit.alive) { if (!unit.bossPool) unit.hp = 0; return; }
    if (unit.hp > 0 && !unit.bossPool) { // revived by a kill handler (clamped: a handler may write any number)
      unit.hp = Math.min(unit.hp, unit.s.maxHp);
      return;
    }
    unit.hp = 0; // NaN / negative writes from handlers
    this._remove(unit, 'killed', killer);
  }

  /**
   * Withdraw an ally without a kill (it may redeploy after its respawn time): an operator lies down where it stood and
   * comes back there (isDown, GitHub #60) — unless `permanent`, or the 突袭 retreat ('raid') that redeploys it at once.
   * `dying`: a forced exit that plays the operator's death animation — a knock-out put off by its own effect (史尔特尔's
   * 余烬, 骑士戒律 + 竞技旗); the `death` hook carries it (Touch's 超脱 counts such an exit: content/tokens.js).
   */
  retreat(unit, { reason = 'retreat', permanent = false, dying = false } = {}) {
    if (!unit || !unit.alive || unit.side !== 'ally') return;
    this._remove(unit, reason, null, permanent, dying);
  }

  _remove(unit, reason, killer = null, permanent = false, dying = false) {
    unit.alive = false;
    unit.removeReason = reason;
    unit.deployed = false;
    unit.deathAt = this.time;
    // while the removal bookkeeping runs, a skill onEnd handler must not redeploy the unit (it would come back
    // alive but without its tile in _occ, its buffs wiped and a respawn timer pending) — redeploy from `death` instead
    unit._removing = true;
    if (unit.skill && unit.skill.active) {
      this._safe(() => unit.skill.end('death'), 'skill.end', unit);
      unit.skill.active = false;
    }
    unit._removing = false;
    if (unit.side === 'ally') {
      this.releaseBlocked(unit);
      const k = unit.tileR * COLS + unit.tileC;
      if (this._occ[k] === unit) this._occ[k] = null;
      // keep persistent buffs only
      const kept = [];
      for (const b of unit.buffs) {
        if (b.persist) kept.push(b);
        else if (b.visible || b.status) this._ev(['status', unit.id, b.status ?? b.key, 0]);
      }
      unit.buffs = kept;
      unit.markDirty();
      if (unit.kind === 'op' && !permanent) {
        if (reason === 'killed') { const pp = this._pp(unit.ownerId); if (pp) pp.deaths++; }
        const mul = unit.persist.redeployMul * unit.s.redeployMul;
        unit.respawnAt = this.time + Math.max(0, unit.base.respawnTime * mul);
        if (this.isDown(unit)) this._layBody(unit); // before `die` / `death`: the body's tile is final for them
      } else {
        unit.removed = true;
      }
      if (unit.kind === 'device' && unit.obstacle) this.grid.setObstacle(unit.tileR, unit.tileC, false, unit.obstacleKind);
    } else {
      unit.removed = true;
      this._unblock(unit);
      this._enemiesDirty = true;
      if (reason === 'killed') {
        const pp = this._pp(unit.ownerId);
        if (unit.counted) {
          this.killed++;
          if (pp) pp.killed++;
        }
        // the HUD capsule's numerator (DESIGN §14): only the enemies the stage itself scheduled (`inTotal`) — a split
        // child / summon / part knocked down here is no 已解决 of the stage's own list and moves the capsule not at all
        if (unit.inTotal) {
          this.killedInTotal++;
          if (pp) pp.killedInTotal++;
        }
        if (killer) killer.stats.kills++;
        if (unit.bounty && unit.bounty.coins > 0) this.addCoins(this._bountyPayee(unit, killer), unit.bounty.coins);
      }
    }
    // the reason ('killed' | 'retreat' | 'expired' | …) lets the client keep the knock-down sound for real knock-outs
    if (reason !== 'leak') this._ev(['die', unit.id, reason]);
    if (this._hooks.death) this.emit('death', { unit, reason, killer, dying: !!dying });
    if (unit.removed) this._toRelease.push(unit);
  }

  /**
   * Drop hooks and periodic timers (`every`) owned by permanently removed units (killed/leaked enemies, expired
   * tokens, destroyed devices). Runs at the end of the step, so the unit's own death/leak handlers still fire;
   * one-shot `after` callbacks are kept (they run once and are gone). Without this, per-enemy content hooks pile up
   * and every emit walks the handlers of every enemy that ever spawned.
   */
  _releaseRemoved() {
    const set = new Set();
    for (const u of this._toRelease) if (u.removed && !u.alive) set.add(u);
    this._toRelease = [];
    if (!set.size) return;
    for (const name of Object.keys(this._hooks)) {
      const list = this._hooks[name];
      let w = 0;
      for (let i = 0; i < list.length; i++) {
        const h = list[i];
        if (h.owner != null && set.has(h.owner)) h.removed = true;
        else list[w++] = h;
      }
      list.length = w;
      if (!w) delete this._hooks[name];
    }
    for (const sc of this._sched) if (sc.interval > 0 && sc.owner != null && set.has(sc.owner)) sc.cancelled = true;
  }

  /**
   * Immediately redeploy a dead (or retreated) ally on its rest tile (restTile: where an operator that left the field
   * lies, else its home tile). opts:
   *   free=true   no DP cost (false: pays `base.cost`, refused when the player lacks the DP)
   *   tile=[r,c]  land on this in-rect tile instead (the home stays the board tile); refused (false) when the tile is
   *               outside the rect, a living unit stands there or another knocked-out operator lies there — no fallback
   *   keepSp      keep the SP / charges the unit had (保留技力): restored before the `deploy` hook fires
   * Returns true when the unit was deployed (full HP, `deploy {initial:false}` fires).
   */
  redeploy(unit, { free = true, tile = null, keepSp = false } = {}) {
    if (!unit || unit.side !== 'ally' || unit.alive || unit.removed) return false;
    let at = null;
    if (tile != null) {
      if (!Array.isArray(tile) || !Number.isInteger(tile[0]) || !Number.isInteger(tile[1]) || !this.grid.inRect(tile[0], tile[1])) return false;
      at = [tile[0], tile[1]];
    } else {
      const rest = this.restTile(unit);
      if (rest[0] !== unit.homeR || rest[1] !== unit.homeC) at = rest;
    }
    const k = at ? at[0] * COLS + at[1] : unit.homeR * COLS + unit.homeC;
    const occ = this._occ[k];
    if (occ && occ.alive && occ !== unit) return false;
    if (at && this.downOn(at[0], at[1], unit)) return false;
    const ps = this.getPlayer(unit.ownerId);
    const cost = unit.base.cost;
    let paid = 0;
    if (!free) {
      if (!ps || ps.dp + 1e-9 < cost) return false;
      paid = Math.min(ps.dp, cost);
      ps.dp = Math.max(0, ps.dp - cost); // paid before `deploy` fires (handlers see the new DP)
    }
    const sk = unit.skill;
    const keep = keepSp && sk && !sk.noSkill && sk.kind !== 'passive' ? { sp: sk.sp, charges: sk.charges } : null;
    if (this._deploy(unit, { initial: false, tile: at, keepSp: keep })) return true;
    if (paid > 0 && ps) ps.dp = Math.min(this.flags.dpMax, ps.dp + paid);
    return false;
  }

  /**
   * Automatic redeploys (DESIGN §5.5): an operator that left the field and whose timer is done comes back on its rest
   * tile — where it lies ("满足再部署条件时，移除场上的该倒地干员并自动部署至该位置", PRTS 卫戍协议/帮助) — when that tile
   * is free and its player has the DP.
   */
  _checkRedeploys() {
    for (const u of this.allyUnits) {
      if (u.alive || u.removed || u.kind !== 'op') continue;
      if (this.time + 1e-9 < u.respawnAt) continue;
      // the DP first: an operator past its timer mostly waits for DP, and the tile checks scan every ally
      const ps = this.getPlayer(u.ownerId);
      const cost = u.base.cost;
      if (!ps || ps.dp + 1e-9 < cost) continue;
      const [r, c] = this.restTile(u);
      const occ = this._occ[r * COLS + c];
      if (occ && occ.alive && occ !== u) continue;
      if (this.downOn(r, c, u)) continue;
      ps.dp = Math.max(0, ps.dp - cost);
      this._deploy(u, { initial: false, tile: r === u.homeR && c === u.homeC ? null : [r, c] });
    }
  }

  /** Leak: an enemy reached its goal. */
  leak(e) {
    if (!e || !e.alive || e.side !== 'enemy') return;
    this._recordLeak(e, false);
    this._remove(e, 'leak');
    this._ev(['leak', e.id]);
    if (this._hooks.enemyLeak) this.emit('enemyLeak', { enemy: e });
  }

  _recordLeak(e, timeout) {
    const owner = timeout ? e.ownerId : this._ownerForTile([Math.round(e.y), Math.round(e.x)]) ?? e.ownerId;
    const pp = this._pp(owner) ?? this._pp(e.ownerId);
    if (pp) {
      pp.leaked.push({ enemyKey: e.defId, mods: e.mods ?? null, lpr: e.lpr ?? 1, sourcePlayerId: e.sourcePlayerId ?? e.ownerId, tag: e.tag ?? null, counted: !!e.counted || e.isBoss, boss: e.isBoss || undefined, spawned: true });
      if (e.counted || e.isBoss) pp.perfect = false;
    }
    if (e.counted) this.leakedCount++;
    // the HUD capsule's leak counter (DESIGN §14): only the stage's own enemies (`inTotal`) — a leaked split child or
    // summon still costs LP through `counted`/`leakedCount` and still breaks 完美作战, but it is no 漏掉 of the stage's
    // own list, so the capsule's numerator does not move for it
    if (e.inTotal) {
      this.leakedInTotal++;
      if (pp) pp.leakedInTotal++;
    }
  }
}
