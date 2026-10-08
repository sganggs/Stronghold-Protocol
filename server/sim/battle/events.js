// server/sim/battle/events.js — Battle methods: client events (DESIGN §8.2 tuples, bounded buffer), the snapshot, field
// meta, fx and the sim log.
// Installed on Battle.prototype by server/sim/Battle.js (a method container: never instantiated; `this` is the battle).

import { EVENT_BUFFER_CAP } from '../constants.js';
import { elementView } from '../damage.js';
import { unitInfo, snapshotUnits } from '../snapshot.js';

/**
 * The projectile kinds the ENGINE draws itself: the profile `projectile` values — one set for operators and one for
 * enemies (professions.js header, ai.js performAttack / enemyAttack) — plus the two the engine's own attacks add (ai.js
 * throwBoomerang's return leg, content/enemies/fly.js's 暴鸰 bomb) and the two that only ever ride the `'atk'` event (a
 * 锁定攻击范围 AoE's `'beam'`, a 链愈师's `'chain'`). A projectile whose `visual` is one of these is already carried by
 * that event (or is no visual at all), so the snapshot's `proj` outlet is only for a kit's OWN visuals: anything outside
 * this set is content-owned and published (see snapshot below).
 */
const ENGINE_PROJECTILES = new Set([
  'none', 'beam', 'chain',
  'arrow', 'bolt', 'bomb', 'lob', 'orb', 'drone', 'boomerang', 'boomerangReturn',
  'enemy', 'droneBomb',
]);

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
   *   proj: [[id, x, y, kind]] — CONTENT-OWNED projectiles, drawn by the client from this list instead of from an 'atk'
   *         event: a projectile a kit adds itself has no attack to hang a visual on, and one whose flight the kit owns
   *         (projectiles.js `steer`) has no target view to home on either. `kind` is the projectile's `visual`, or its
   *         `data.hitTag` when it sets one (a kit telling two of its own kinds apart). Only projectiles whose `visual`
   *         is NOT one of the engine's own (ENGINE_PROJECTILES above) are published — an arrow or an enemy shot is still
   *         drawn from its 'atk' event — and the engine's position stays authoritative for the ones that are.
   *   fever: [[id, pct]] — a gauge a KIT keeps on `unit.mem.gauges.fever` (0..100, rounded and clamped here),
   *         forwarded so the client can show it. Deliberately generic — the engine does not know what the gauge means,
   *         it only forwards what the kit wrote (`unit.mem` is the kit's own space); a kit that writes nothing is
   *         published nowhere.
   */
  snapshot() {
    const snap = {
      fieldId: this.fieldId,
      t: Math.round(this.time * 1000) / 1000,
      units: snapshotUnits(this.units, this.time),
      dp: this.players.length ? Math.floor(this.players[0].dp) : 0,
      killed: this.killed,
      total: this.total,
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
    let proj = null;
    for (const p of this.projectiles.list) {
      if (!p.visual || ENGINE_PROJECTILES.has(p.visual)) continue;
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;   // never publish a position the client cannot draw
      const kind = typeof p.data?.hitTag === 'string' && p.data.hitTag ? p.data.hitTag : p.visual;
      (proj || (proj = [])).push([p.id, r2(p.x), r2(p.y), kind]);
    }
    if (proj) snap.proj = proj;
    let fever = null;
    for (const u of this.units) {
      if (!u.alive || !u.deployed || u.hidden) continue;
      const pct = u.mem?.gauges?.fever;
      if (Number.isFinite(pct)) (fever || (fever = [])).push([u.id, Math.max(0, Math.min(100, Math.round(pct)))]);
    }
    if (fever) snap.fever = fever;
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
