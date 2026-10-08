// server/sim/battle/spawns.js — Battle methods: enemies: the spawn queue (counted in `total` up front), routes and the
// owner of a tile, spawnEnemy, and the enemies on the field — hidden ones, the shared boss pool sync, the field clamp
// and the list compaction.
// Installed on Battle.prototype by server/sim/Battle.js (a method container: never instantiated; `this` is the battle).

import { MAX_ALIVE_ENEMIES } from '../constants.js';
import { Unit } from '../units.js';
import { compileRoute } from '../ai.js';
import { unitInfo } from '../snapshot.js';
import { normalizeRoute, normalizeEnemy } from '../simdata.js';
import { fin } from './util.js';

const FALLBACK_ENEMY = Object.freeze({
  type: 'enemy', id: 'enemy_unknown', key: 'enemy_unknown', name: '未知敌人', rank: 'NORMAL', maxHp: 2000, atk: 200, def: 100, res: 0,
  aspd: 100, bat: 2, rangeRadius: 0, moveSpeed: 1, massLevel: 1, lpr: 1, motion: 'WALK', applyWay: 'MELEE', dmgType: 'phys',
  immune: new Set(), tauntLevel: 0, blockCnt: 1, epResistance: 0, epDamageResistance: 0, hpRecoveryPerSec: 0, notCountInTotal: false,
  tags: [], abilities: [], skills: [], talent: {}, spine: 'unknown', avatar: 'unknown', raw: {},
});

export class BattleSpawns {
  _queueSpawn(s, precount) {
    if (Number(s.time) === Infinity) return; // "never" — not scheduled, not counted
    // capped: a bogus count (Infinity, 1e9) would otherwise hang the constructor / exhaust memory
    const count = Math.min(MAX_ALIVE_ENEMIES, Math.max(1, Math.floor(fin(s.count ?? 1, 1)) || 1));
    const interval = Math.max(0, fin(s.interval, 0));
    const def = this.data.getEnemy(s.enemyKey);
    for (let i = 0; i < count; i++) {
      const p = {
        time: Math.max(0, fin(s.time, 0)) + i * interval, enemyKey: s.enemyKey, routeIndex: s.routeIndex ?? 0, route: s.route ?? null,
        mods: s.mods ?? null, sourcePlayerId: s.sourcePlayerId ?? null, bounty: s.bounty ?? null, tag: s.tag ?? null,
        ownerPlayerId: s.ownerPlayerId ?? null, pos: s.pos ?? null, seq: ++this._spawnSeq, countInTotal: s.countInTotal,
      };
      p.counted = p.countInTotal ?? (!(def && def.notCountInTotal) && p.tag !== 'boss' && p.tag !== 'part');
      if (precount && p.counted) {
        this.total++;
        const owner = p.ownerPlayerId ?? this._ownerForTile(p.pos ?? this._routeFor(p.routeIndex, p.route)?.start);
        const pp = this._pp(owner);
        if (pp) pp.total++;
        p.precounted = true;
      }
      this._pending.push(p);
    }
  }

  _processSpawns() {
    const now = this.time + 1e-9;
    while (this._pending.length && this._pending[0].time <= now) {
      const p = this._pending.shift();
      this._safe(() => this.spawnEnemy(p.enemyKey, { ...p, _precounted: p.precounted }), 'spawnEnemy');
    }
  }

  _routeFor(idx, explicit = null) {
    if (explicit) return normalizeRoute(explicit);
    return this.routes[idx] ?? this.routes[0] ?? this._defaultRoute();
  }

  _defaultRoute() {
    if (this._defRoute !== undefined) return this._defRoute;
    const starts = this.grid.specialTiles('start');
    const ends = this.grid.specialTiles('end');
    this._defRoute = starts.length && ends.length ? { motion: 'WALK', start: starts[0], end: ends[0], checkpoints: [] } : null;
    return this._defRoute;
  }

  _ownerForTile(tile) {
    if (!this.players.length) return null;
    if (this.players.length === 1 || !tile) return this.players[0].playerId;
    const c = Array.isArray(tile) ? tile[1] : tile.c;
    const half = c >= 11 ? 'R' : 'L';
    return (this.players.find((p) => p.half === half) ?? this.players[0]).playerId;
  }

  /**
   * Spawn an enemy now. opts: { routeIndex, route, pos:[r,c], mods:{hpMul,atkMul,defMul,resMul,speedMul}, tag,
   * sourcePlayerId, ownerPlayerId, bounty:{coins,ownerPlayerId}, countInTotal }
   */
  spawnEnemy(enemyKey, opts = {}) {
    if (this.enemies.length >= MAX_ALIVE_ENEMIES && this.aliveEnemies().length >= MAX_ALIVE_ENEMIES) {
      this._handlerError('spawnEnemy', null, new Error(`more than ${MAX_ALIVE_ENEMIES} living enemies; spawn of ${enemyKey} refused`));
      return null;
    }
    // opts.def: an inline record (data/enemies.json shape, or an already normalised EnemyDef) for keys absent from data
    let def = null;
    if (opts.def && typeof opts.def === 'object') {
      try { def = opts.def.type === 'enemy' && opts.def.immune instanceof Set ? opts.def : normalizeEnemy(enemyKey, opts.def); } catch (e) { this._handlerError('spawnEnemy.def', null, e); }
    }
    if (!def) def = this.data.getEnemy(enemyKey);
    if (!def) { this.log(`unknown enemy ${enemyKey}`); def = { ...FALLBACK_ENEMY, id: enemyKey, key: enemyKey }; }
    const ov = this.enemyOverrides[def.key] ?? this.enemyOverrides[enemyKey];
    if (ov && ov.stats) {
      const st = ov.stats;
      def = { ...def,
        maxHp: Math.max(1, fin(st.maxHp ?? st.hp, def.maxHp)), atk: Math.max(0, fin(st.atk, def.atk)), def: Math.max(0, fin(st.def, def.def)),
        res: Math.max(0, fin(st.res, def.res)), moveSpeed: Math.max(0, fin(st.moveSpeed, def.moveSpeed)),
        bat: Math.max(0.1, fin(st.bat, def.bat)), aspd: fin(st.aspd, def.aspd) || def.aspd,
        rangeRadius: Math.max(0, fin(st.rangeRadius, def.rangeRadius)), massLevel: fin(st.massLevel, def.massLevel),
        lpr: fin(st.lpr, def.lpr), blockCnt: Math.max(1, fin(st.blockCnt, def.blockCnt)) };
    }
    const route = opts.route ? normalizeRoute(opts.route) : this._routeFor(opts.routeIndex ?? 0);
    let start = opts.pos ?? route?.start ?? [this.rect.r0, this.rect.c1];
    if (!Array.isArray(start) || !Number.isFinite(start[0]) || !Number.isFinite(start[1])) start = route?.start ?? [this.rect.r0, this.rect.c1];
    const R = this.rect; // spawn inside the field (same bounds as _clampPos)
    start = [Math.max(R.r0 - 0.5, Math.min(R.r1 + 0.5, start[0])), Math.max(R.c0 - 0.5, Math.min(R.c1 + 0.5, start[1]))];
    // multipliers: finite and ≥ 0 (hp > 0), anything else counts as 1
    const mm = (v, pos = false) => { const n = fin(v, 1); return n < 0 || (pos && n <= 0) ? 1 : n; };
    const m0 = opts.mods || {};
    const m = { hpMul: mm(m0.hpMul, true), atkMul: mm(m0.atkMul), defMul: mm(m0.defMul), resMul: mm(m0.resMul), speedMul: mm(m0.speedMul) };
    const e = new Unit({
      id: ++this._idSeq, side: 'enemy', kind: 'enemy', def, defId: def.key ?? enemyKey, name: def.name,
      x: start[1], y: start[0], motion: def.motion,
      base: {
        maxHp: def.maxHp * (m.hpMul ?? 1), atk: def.atk * (m.atkMul ?? 1), def: def.def * (m.defMul ?? 1), res: def.res * (m.resMul ?? 1),
        aspd: def.aspd, bat: def.bat, blockCnt: 0, moveSpeed: def.moveSpeed * (m.speedMul ?? 1), spRecovery: 0,
        tauntLevel: def.tauntLevel, massLevel: def.massLevel, hpRecoveryPerSec: def.hpRecoveryPerSec, rangeRadius: def.rangeRadius,
      },
    });
    e.alive = true;
    e.deployed = true;
    e.blockWeight = def.blockCnt ?? 1;
    e.hitArea = def.hitArea ?? null;   // 巨型单位 hit rectangle (body.js); null = a point
    e.lpr = def.lpr;
    e.mods = opts.mods ?? null;
    e.tag = opts.tag ?? null;
    e.bounty = opts.bounty ?? null;
    e.sourcePlayerId = opts.sourcePlayerId ?? null;
    e.ownerId = opts.ownerPlayerId ?? this._ownerForTile(start);
    e.spawnX = e.x; e.spawnY = e.y;
    e.spawnSeq = ++this._spawnSeq;
    e.deploySeq = ++this._deploySeq;
    e.deployedAt = this.time;
    e.atkCd = 0;
    e.pauseUntil = -Infinity;      // content holds (暴鸰's drop)
    e.atkStandUntil = -Infinity;   // standing for its attack clip (ai.js attackStand)
  e.unbalanceUntil = -Infinity;  // the UNBALANCE state of a displacement (ai.js; constants UNBALANCE_STAGGER)
    e.swing = false;               // a normal attack swung, its damage frame not reached yet (ai.js enemyAttack)
    // every enemy profile starts with the same fields (stable object shapes keep the hot loop's property reads fast);
    // `dmgType` null = the data's (content may arm a data-unarmed enemy: ai.js enemyAttack); `blockFree` = its 索敌不受阻挡
    // 影响 (content: 自制投石机 — targeting.js canTargetAlly / sortAllyTargets, ai.js attackTargets)
    e.profile = { noAttack: def.dmgType === 'none', maxTargets: 1, atkScale: 1, dmgType: null, blockFree: false };
    e.route = { legs: route ? compileRoute(route, this.rect) : [], legIdx: 0, pts: null, ptIdx: 0, suffix: null, version: -1, waitLeft: null };
    if (!e.route.legs.length) {
      const end = this.grid.specialTiles('end')[0];
      if (end) e.route.legs.push({ t: 'move', r: end[0], c: end[1], final: true });
    }
    e.counted = opts.countInTotal ?? (!def.notCountInTotal && e.tag !== 'boss' && e.tag !== 'part');
    if (e.counted && !opts._precounted) {
      this.total++;
      const pp = this._pp(e.ownerId);
      if (pp) pp.total++;
    }
    if (e.tag === 'boss') {
      e.isBoss = true;
      if (this.sharedBoss) { e.bossPool = this.sharedBoss; this._syncBossHp(e); }
    }
    e.hp = e.bossPool ? e.hp : e.s.maxHp;
    this.units.push(e);
    this.enemies.push(e);
    this._ev(['spawn', unitInfo(e)]);
    if (this._hooks.deploy) this.emit('deploy', { unit: e, initial: false });
    if (this._hooks.enemySpawn) this.emit('enemySpawn', { enemy: e });
    return e;
  }

  // =============================================================================================================
  // enemies on the field: hidden, boss pool, clamp, compaction

  _setHidden(e, on) {
    if (e.hidden === on) return;
    e.hidden = on;
    if (on) this._unblock(e);
    this.fx(on ? 'disappear' : 'appear', { x: e.x, y: e.y, id: e.id });
  }

  _syncBossHp(e) {
    const pool = e.bossPool;
    if (!pool) return;
    if (Number.isFinite(pool.maxHp) && pool.maxHp > 0 && e.base.maxHp !== pool.maxHp) { e.base.maxHp = pool.maxHp; e.markDirty(); }
    // a broken pool (NaN hp) must not leak NaN into the unit: show it full until the pool is sane again
    const ratio = pool.maxHp > 0 ? (Number.isFinite(pool.hp) ? Math.max(0, pool.hp) / pool.maxHp : 1) : 0;
    e.hp = e.s.maxHp * Math.min(1, ratio);
  }

  _bossSync() {
    if (!this.sharedBoss) return;
    for (const e of this.enemies) if (e.alive && e.bossPool) {
      this._syncBossHp(e);
      if (e.bossPool.hp <= 0) this.kill(e, null);
    }
  }

  _clampPos(e) {
    const R = this.rect;
    if (e.x < R.c0 - 0.5) e.x = R.c0 - 0.5;
    if (e.x > R.c1 + 0.5) e.x = R.c1 + 0.5;
    if (e.y < R.r0 - 0.5) e.y = R.r0 - 0.5;
    if (e.y > R.r1 + 0.5) e.y = R.r1 + 0.5;
  }

  _compactEnemies() {
    if (!this._enemiesDirty) return;
    this.enemies = this.enemies.filter((e) => e.alive);
    this._enemiesDirty = false;
  }
}
