// test/match/fakeBattle.js — a scriptable stand-in for server/sim/Battle.js implementing the DESIGN §5.1 surface the
// match uses: constructor(opts), step(), finished, time, tickCount, forceEnd(reason), result(), snapshot(),
// drainEvents(), fieldMeta(), on(name, fn, opts) / off(), errorCount.
//
// Behaviour is set per construction by FakeBattle.script(battle) → plan (or the default plan):
//   {
//     duration: game seconds until the battle finishes by itself (default: min(timeLimit, 8); boss: never — the
//               shared pool or the match ends it),
//     leaks: { [playerId]: n }        counted leaks recorded for that player (normal fields; taken from its spawns),
//     survivors: { [sourcePlayerId]: n } unite: re-entered enemies of that source still alive at the end,
//     coins: { [playerId]: n }, layerGains: { [playerId]: { bondId: n } }, damage: { [playerId]: n },
//     bossDps: shared-pool damage per game second (split evenly between the field's players; default 0),
//     leakEvents: [{ at: seconds, lpr }]  boss fields: 'enemyLeak' hook calls at those times,
//     lpLossEvents: [{ at: seconds, amount }] 'lpLoss' hook calls (leader "扣除目标生命" effects) at those times,
//     deadUids: [uid]                 operators reported dead in unitsEnd (alive false, hpPct 0),
//     throwAt: tick number at which step() throws (error-isolation tests),
//     throwInCtor: true → the constructor throws,
//   }
// Every constructed instance is recorded in FakeBattle.instances (tests inspect the inputs the match built).

import { TICK } from '../../server/sim/constants.js';

export class FakeBattle {
  static script = null;
  static instances = [];

  static reset() { FakeBattle.script = null; FakeBattle.instances = []; }

  constructor(opts = {}) {
    this.opts = opts;
    this.kind = opts.kind ?? 'normal';
    this.fieldId = opts.fieldId ?? null;
    this.round = opts.round ?? 0;
    this.players = (opts.players ?? []).map((p) => p.playerId);
    this.spawns = opts.spawns ?? [];
    this.sharedBoss = opts.sharedBoss ?? null;
    this.timeLimit = Number.isFinite(opts.timeLimit) && opts.timeLimit > 0 ? opts.timeLimit : Infinity;
    this.time = 0;
    this.tickCount = 0;
    this.finished = false;
    this.reason = null;
    this.errorCount = 0;
    this._hooks = {};
    this._events = [];
    const plan = typeof FakeBattle.script === 'function' ? FakeBattle.script(this) : null;
    const bossLike = this.kind === 'boss' || this.kind === 'hidden';
    this.plan = { duration: bossLike ? Infinity : Math.min(this.timeLimit, 8), leaks: {}, survivors: {}, coins: {}, layerGains: {}, damage: {}, bossDps: 0, leakEvents: [], lpLossEvents: [], deadUids: [], ...(plan || {}) };
    if (this.plan.throwInCtor) throw new Error('FakeBattle: constructor failure (scripted)');
    this._leakIdx = 0;
    this._lpLossIdx = 0;
    FakeBattle.instances.push(this);
  }

  on(name, fn) {
    (this._hooks[name] ||= []).push(fn);
    return { name, fn };
  }

  off() {}

  _emit(name, ctx) { for (const fn of this._hooks[name] || []) fn(ctx, this); }

  step() {
    if (this.finished) return;
    if (this.plan.throwAt != null && this.tickCount + 1 >= this.plan.throwAt) throw new Error('FakeBattle: step failure (scripted)');
    this.tickCount++;
    this.time = this.tickCount * TICK;
    if (this.tickCount % 3 === 0) this._events.push(['fx', 'tick', 0, 0, { t: this.time }]);
    if (this.sharedBoss && this.plan.bossDps > 0) {
      const per = (this.plan.bossDps * TICK) / Math.max(1, this.players.length);
      for (const pid of this.players) this.sharedBoss.damage(pid, per);
    }
    while (this._leakIdx < this.plan.leakEvents.length && this.plan.leakEvents[this._leakIdx].at <= this.time) {
      const le = this.plan.leakEvents[this._leakIdx++];
      this._emit('enemyLeak', { enemy: { lpr: le.lpr ?? 1, defId: le.enemyKey ?? 'enemy_fake', isBoss: !!le.boss } });
    }
    while (this._lpLossIdx < this.plan.lpLossEvents.length && this.plan.lpLossEvents[this._lpLossIdx].at <= this.time) {
      const le = this.plan.lpLossEvents[this._lpLossIdx++];
      this._emit('lpLoss', { amount: le.amount, reason: 'fake', source: null });
    }
    if (this.sharedBoss && this.sharedBoss.hp <= 0) { this._finish('cleared'); return; }
    if (this.time >= this.plan.duration - 1e-9) this._finish(this._leakTotal() > 0 ? 'timeout' : 'cleared');
    else if (this.time >= this.timeLimit - 1e-9) this._finish('timeout');
  }

  _leakTotal() {
    let n = 0;
    for (const v of Object.values(this.plan.leaks || {})) n += v;
    for (const v of Object.values(this.plan.survivors || {})) n += v;
    return n;
  }

  forceEnd(reason = 'forced') {
    if (this.finished) return;
    this._finish(reason === 'timeout' ? 'timeout' : 'forced');
  }

  _finish(reason) {
    this.finished = true;
    this.reason = reason;
  }

  result() {
    const perPlayer = {};
    for (const pid of this.players) {
      const spawnsOf = this.spawns.filter((s) => (s.ownerPlayerId ?? pid) === pid);
      let total = 0;
      for (const s of this.kind === 'unite' ? this.spawns : spawnsOf) total += Math.max(1, s.count || 1);
      if (this.kind === 'unite' && this.players.indexOf(pid) > 0) total = 0;
      const leaked = [];
      const n = this.plan.leaks[pid] || 0;
      for (let i = 0; i < n; i++) {
        const s = spawnsOf[i % Math.max(1, spawnsOf.length)] || { enemyKey: 'enemy_1007_slime', mods: { slot: 'N' } };
        leaked.push({ enemyKey: s.enemyKey, mods: s.mods ?? null, lpr: 1, sourcePlayerId: pid, tag: s.tag ?? null, counted: true, spawned: true });
      }
      if (this.kind === 'unite' && this.players.indexOf(pid) === 0) {
        for (const [src, k] of Object.entries(this.plan.survivors || {})) {
          const pool = this.spawns.filter((s) => s.sourcePlayerId === src);
          for (let i = 0; i < k; i++) {
            const s = pool[i % Math.max(1, pool.length)] || { enemyKey: 'enemy_1007_slime', mods: null };
            leaked.push({ enemyKey: s.enemyKey, mods: s.mods ?? null, lpr: 1, sourcePlayerId: src, tag: null, counted: true, spawned: true });
          }
        }
      }
      const units = (this.opts.players.find((p) => p.playerId === pid)?.units ?? []).filter((u) => u.kind === 'chess');
      perPlayer[pid] = {
        ...(Number.isFinite(this.plan.creditedKills?.[pid]) ? { creditedKills: this.plan.creditedKills[pid] } : {}),
        killed: Math.max(0, total - leaked.length),
        total,
        leaked,
        perfect: !leaked.some((l) => l.counted !== false),
        layerGains: { ...(this.plan.layerGains[pid] || {}) },
        ...(this.plan.tempLayerGains && this.plan.tempLayerGains[pid] ? { tempLayerGains: { ...this.plan.tempLayerGains[pid] } } : {}),
        coins: this.plan.coins[pid] || 0,
        damageDealt: this.plan.damage[pid] || 1000,
        bossDamage: 0,
        healingDone: 0,
        deaths: 0,
        unitsEnd: units.map((u) => {
          const dead = this.plan.deadUids.includes(u.uid);
          return { uid: u.uid, id: u.uid, defId: u.chessId, hpPct: dead ? 0 : 0.5, sp: dead ? 0 : 3, skillActive: false, alive: !dead };
        }),
        unitStats: units.map((u) => ({ id: u.uid, uid: u.uid, defId: u.chessId, name: u.chessId, kind: 'op', dmg: 100, kills: 1, heal: 0, taken: 10, attacks: 5 })),
      };
    }
    const res = { time: this.time, reason: this.reason ?? 'forced', perPlayer, killed: 0, total: 0, errors: this.errorCount };
    if (this.sharedBoss) res.bossHpLeft = Math.max(0, this.sharedBoss.hp);
    return res;
  }

  snapshot() {
    const snap = { fieldId: this.fieldId, t: this.time, units: [[1, 5, 10, 100, 100, 0, 10, 0, 0]], dp: 10, killed: 0, total: this.spawns.length };
    if (this.sharedBoss) snap.boss = { hp: Math.round(this.sharedBoss.hp), max: Math.round(this.sharedBoss.maxHp) };
    return snap;
  }

  drainEvents() { const e = this._events; this._events = []; return e; }

  fieldMeta() {
    return { fieldId: this.fieldId, kind: this.kind, rect: this.opts.rect ?? null, stageId: this.opts.stageId ?? null, units: [] };
  }
}
