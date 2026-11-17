// server/sim/battle/events.js — Battle methods: client events (DESIGN §8.2 tuples, bounded buffer), the snapshot, field
// meta, fx and the sim log.
// Installed on Battle.prototype by server/sim/Battle.js (a method container: never instantiated; `this` is the battle).

import { bondTimerView } from '../content/bonds/timers.js';
import { EVENT_BUFFER_CAP } from '../constants.js';
import { elementView } from '../attack.js';
import { unitInfo, snapshotUnits, ammoView, wolfView, negView, moteView, coinView, mysticView, layerView, chargeView } from '../snapshot.js';

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
  /**
   * Emit ['rate', id, seconds] for every unit whose own attack interval changed since the last tick (a skill turning on or
   * off, an attack-speed buff or debuff landing, a form change): the renderer paces the attack clip over the sim value
   * instead of guessing it from the operator record. Display only — nothing in the sim reads these tuples, and a unit's
   * first value already travels in its UnitInfo (`atkInterval`, snapshot.js unitInfo).
   *
   * The flag is raised where the interval is computed (units.js `_recalc`), so a tick with no stat change costs one
   * property read per unit — the heavy-field budget (test/sim/performance.test.js) does not move.
   */
  _emitRateChanges() {
    if (!this.recordEvents) return;
    for (const u of this.units) {
      if (!u._rateDirty) continue;
      u._rateDirty = false;
      if (!u.alive || !u.deployed) continue;
      const iv = Number(u.s && u.s.interval);
      if (!(iv > 0)) continue;
      const r = Math.round(iv * 1000) / 1000;
      // unitInfo seeds the birth value; the first changed value must reach the client too.
      if (u._rateSent === r) continue;
      u._rateSent = r;
      this._ev(['rate', u.id, r]);
    }
  }

  drainEvents() {
    const ev = this._evq;
    this._evq = [];
    return ev;
  }

  /**
   * Record that an enemy's attack recovery (atkStandUntil) is cut or ignored now — snapshot `standCut`, display metadata
   * (render/interp.js); never changes the attack's timing or state.
   */
  _cutAttackStand(unit) {
    if (unit.side === 'enemy' && Number.isFinite(unit.atkStandUntil) && unit.atkStandUntil > this.time) {
      unit.atkStandCutAt = this.time;
    }
  }

  /**
   * Compact full snapshot of this field (DESIGN §8.2 b.snap), plus (only when non-empty):
   *   down: [[id, respawnAt, respawnTime, state, row, col]] — operators that left the field waiting to redeploy (isDown): the
   *         game time their respawn timer ends, its length (s), constants.js DOWN_STATE and the tile they lie on (and
   *         come back on: _layBody — where they fell, or their home);
   *   elem: [[id, element, fill, cooldownEnd, cooldown]] — the element gauge each unit shows (attack/element.js elementView);
   *   ammo: [[id, rounds left, rounds in the magazine]] — a running ammo skill, whole rounds (snapshot.js ammoView): the segmented bar;
   *   wolves: [[id, 狼影 left, the talent's maximum]] — 伺夜's 狼群 (snapshot.js wolfView): the pips under the HP bar;
   *   neg: [[id, fill]] — the share of its cap a negative-HP pool holds (snapshot.js negView; 斩业星熊's 我执): the red bar;
   *   energy: [[id, stored, the trait's maximum]] — a 秘术师's stored attack energies (snapshot.js mysticView): the
   *         count under the HP bar;
   *   layers: [[id, n]] — the hit-negating 护盾 layers a unit holds (snapshot.js layerView: 泥岩's): the official layer
   *         effect it shows;
   *   charges: [[id, stored, maximum]] — the charges an ally's charge skill stores (snapshot.js chargeView: 卡涅利安's): the
   *         official sand armour of her charges;
   *   bondTimers: [[id, [{ id: effectId, count, remaining }]]] — selected-unit timed bond readouts (#746);
   *         count + next expiry in simulation seconds; omitted when no declared effect is active.
   *   motes: [[id, count, wide]] — the orbiting 「微尘」 of a unit (snapshot.js moteView; 魔王's T1 过往尘埃): how many
   *         still circle her and whether S2's wider radius is up (display only: render/motes.js draws them);
   *   stand: [[id, until]] — when each enemy's attack recovery ends (atkStandUntil; alive, deployed, visible, not
   *         feared or stunned) — display metadata (render/interp.js holds the position until then);
   *   standCut: [[id, at]] — the latest time each listed enemy's recovery was cut or ignored (_cutAttackStand), the
   *         dying ones in their death window included.
   *   face: [[id, ±1]] — a scripted horizontal sign (心虚设计师, mem.publishFacing): the model turns with the front
   *         cut while it stands. Display only; the nine-field tuples and the golden canon omit it.
   * ammo / wolves / neg / motes / energy / layers / charges / stand / standCut / face are display only: no sim state
   * reads them, and the nine-field unit tuples are unchanged. bondTimers is also display only (golden canon excludes it).
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
    let elem = null, ammo = null, wolves = null, neg = null, motes = null, energy = null, stand = null, standCut = null, face = null;
    let listed = null;   // the ids in snap.units, built for the first enemy with a cut to report
    for (const u of this.units) {
      if (u.side === 'enemy' && u.atkStandCutAt >= 0) {
        const cutAt = Math.round(u.atkStandCutAt * 1000) / 1000;
        if (cutAt <= snap.t && (listed || (listed = new Set(snap.units.map((x) => x[0])))).has(u.id)) (standCut || (standCut = [])).push([u.id, cutAt]);
      }
      if (!u.alive || !u.deployed || u.hidden) continue;
      if (u.mem.publishFacing) (face || (face = [])).push([u.id, u.facing]);
      const until = Math.round(u.atkStandUntil * 1000) / 1000;
      if (u.side === 'enemy' && !u.s.flags.fear && !u.s.flags.stun && Number.isFinite(until) && until > snap.t) {
        (stand || (stand = [])).push([u.id, until]);
      }
      const timers = bondTimerView(u, this.time);
      if (timers.length) (snap.bondTimers || (snap.bondTimers = [])).push([u.id, timers]);
      const v = elementView(u, this.time);
      if (v) (elem || (elem = [])).push([u.id, v[0], v[1], v[2], v[3]]);
      const am = ammoView(u);
      if (am) (ammo || (ammo = [])).push([u.id, am[0], am[1]]);
      const wv = wolfView(u);
      if (wv) (wolves || (wolves = [])).push([u.id, wv[0], wv[1]]);
      const ng = negView(u);
      if (ng) (neg || (neg = [])).push([u.id, ng]);
      const mo = moteView(u);
      if (mo) (motes || (motes = [])).push([u.id, mo[0], mo[1]]);
      const purse = coinView(u);
      if (purse) (snap.coins || (snap.coins = [])).push([u.id, ...purse]);
      const en = mysticView(u);
      if (en) (energy || (energy = [])).push([u.id, en[0], en[1]]);
      const ly = layerView(u);
      if (ly) (snap.layers || (snap.layers = [])).push([u.id, ly]);
      const ch = chargeView(u);
    if (motes) snap.motes = motes;
      if (ch) (snap.charges || (snap.charges = [])).push([u.id, ch[0], ch[1]]);
    }
    if (elem) snap.elem = elem;
    if (ammo) snap.ammo = ammo;
    if (wolves) snap.wolves = wolves;
    if (neg) snap.neg = neg;
    if (energy) snap.energy = energy;
    if (stand) snap.stand = stand;
    if (standCut) snap.standCut = standCut;
    if (face) snap.face = face;
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
