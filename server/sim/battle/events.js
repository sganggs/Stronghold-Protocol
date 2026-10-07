// server/sim/battle/events.js — Battle methods: client events (DESIGN §8.2 tuples, bounded buffer), the snapshot, field
// meta, fx and the sim log.
// Installed on Battle.prototype by server/sim/Battle.js (a method container: never instantiated; `this` is the battle).

import { EVENT_BUFFER_CAP } from '../constants.js';
import { elementView } from '../damage.js';
import { unitInfo, snapshotUnits } from '../snapshot.js';

export class BattleEvents {
  fx(kind, params = {}) {
    const { x = 0, y = 0, ...extra } = params || {};
    this._ev(['fx', kind, Math.round(x * 100) / 100, Math.round(y * 100) / 100, extra]);
  }

  log(msg) {
    const k = 'log:' + msg;
    if (this._errKeys.has(k)) return;
    this._errKeys.add(k);
    if (this.opts.verbose) this.logger.warn?.(`[sim] ${msg}`);
  }

  _ev(tuple) {
    if (!this.recordEvents) return;
    this._evq.push(tuple);
    if (this._evq.length > EVENT_BUFFER_CAP) this._evq.splice(0, this._evq.length - EVENT_BUFFER_CAP / 2);
  }

  /** Client-facing events since the last drain (DESIGN §8.2 tuples). */
  drainEvents() {
    const ev = this._evq;
    this._evq = [];
    return ev;
  }

  /**
   * Compact full snapshot of this field (DESIGN §8.2 b.snap), plus (only when non-empty):
   *   down: [[id, respawnAt, respawnTime, state, row, col]] — operators that left the field waiting to redeploy (isDown): the
   *         game time their respawn timer ends, its length (s), constants.js DOWN_STATE and the tile they lie on (and
   *         come back on: _layBody — where they fell, or their home);
   *   elem: [[id, element, fill, cooldownEnd, cooldown]] — the element gauge each unit shows (damage.js elementView).
   */
  snapshot() {
    const snap = {
      fieldId: this.fieldId,
      t: Math.round(this.time * 1000) / 1000,
      units: snapshotUnits(this.units, this.time),
      dp: this.players.length ? Math.floor(this.players[0].dp) : 0,
      killed: this.killed,
      total: this.total,
      // the HUD capsule's numerator (DESIGN §14): the field's own scheduled enemies that are 已解决 (down or leaked).
      // `killed` above counts every counted knock-out (runtime splits / summons too) and may exceed `total`.
      resolved: this.resolved,
    };
    if (this.players.length > 1) {
      snap.dps = {};
      for (const p of this.players) snap.dps[p.playerId] = Math.floor(p.dp);
    }
    if (this.sharedBoss) snap.boss = { hp: Math.max(0, Math.round(this.sharedBoss.hp)), max: Math.round(this.sharedBoss.maxHp) };
    const r2 = (v) => Math.round(v * 100) / 100;
    let down = null;
    for (const u of this.allyUnits) {
      if (!this.isDown(u)) continue;
      (down || (down = [])).push([u.id, r2(u.respawnAt), r2(Math.max(0, u.respawnAt - u.deathAt)), this._downState(u), ...this.restTile(u)]);
    }
    if (down) snap.down = down;
    let elem = null;
    for (const u of this.units) {
      if (!u.alive || !u.deployed || u.hidden) continue;
      const v = elementView(u, this.time);
      if (v) (elem || (elem = [])).push([u.id, v[0], v[1], v[2], v[3]]);
    }
    if (elem) snap.elem = elem;
    return snap;
  }

  /**
   * Field meta for m.field: { fieldId, kind, rect, stageId, units: UnitInfo[] } — the units on the field, knocked-out
   * operators waiting to redeploy included (a client joining mid-battle shows them down).
   */
  fieldMeta() {
    return {
      fieldId: this.fieldId, kind: this.kind, rect: { ...this.rect }, stageId: this.stageId,
      units: this.units.filter((u) => (u.alive && u.deployed && !u.hidden) || this.isDown(u)).map(unitInfo),
    };
  }
}
