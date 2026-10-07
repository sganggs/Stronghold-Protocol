// server/sim/battle/lifecycle.js — Battle methods: lifecycle: start (the battle-start deployment: by column, operators
// then summons; 联防 forced exits; `battleStart`), step (the tick order of the Battle.js header), the end checks, timeout
// / forced / cleared finishes and the BattleResult.
// Installed on Battle.prototype by server/sim/Battle.js (a method container: never instantiated; `this` is the battle).

import { FORCED_EXIT, MAX_BATTLE_TIME } from '../constants.js';
import { updateAlly, updateEnemy } from '../ai.js';

export class BattleLifecycle {
  start() {
    if (this.started) return;
    this.started = true;
    this._safe(() => this._spawnStageDevices(), 'stageDevices');
    // PRTS 卫戍协议/帮助 §作战阶段: "按从上到下>从左到右的顺序部署。优先部署干员，随后为召唤物（如果有）", noted "自卫戍协议：
    // 盟约 下半（2026/3/14）起，部署顺序由“从左到右>从下到上”更改为“从上到下>从左到右”" — a scanning order: down each column
    // (top first), the columns from left to right; act 1's along each row, the rows from the bottom. It is the order PRTS
    // gives the 阿戈尔 devour ("从最先部署（更靠左和靠上的）的【阿戈尔】干员开始", content/bonds/core.js egirOrder) and the one
    // act-2 videos show. Per player the operators, left column first, top to bottom within a column (the mirrored right
    // boss side from its own left, i.e. the highest field column — PRTS "部署顺序…左右镜像", research 01 §4.3), then the
    // summon pieces in the same order. Until 0.1.3 the top row came first (row-major). [ASSUMED] On a shared field (联防,
    // boss) the players' fields deploy at the same time (PRTS: one unit after another with a fixed delay, from the battle
    // start), so the i-th operators of all players come in together (in `players` order), then the summons likewise
    const seq0 = this._deploySeq;
    const lists = this.players.map((ps) => ps.units.filter((u) => u.kind === 'op' || u.kind === 'token').slice().sort((a, b) =>
      (ps.mirror ? b.homeC - a.homeC : a.homeC - b.homeC) || b.homeR - a.homeR || a.id - b.id));
    // a summon piece flagged `deferDeploy` by content (one its owner's loadout does not make — 赫默 on S1 with a drone
    // piece —, or a skill's summon when shared/constants.js SKILL_SUMMON_START_DEPLOY is off: content/tokens.js
    // dockSkillSummons) stays off the field, its tile reserved (isReservedTile), until content deploys it
    // (_startDeploying: a board piece content brings in during this deployment — a tactician's 流形 / 狼群 comes with
    // its owner's deploy — takes its 联防 carry on that first deployment too)
    this._startDeploying = true;
    for (const kind of ['op', 'token']) {
      const per = lists.map((l) => l.filter((u) => u.kind === kind && !u.deferDeploy));
      const n = Math.max(0, ...per.map((l) => l.length));
      for (let i = 0; i < n; i++) for (const l of per) if (l[i]) this._safe(() => this._deploy(l[i], { initial: true }), 'initialDeploy', l[i]);
    }
    this._startDeploying = false;
    // 仇恨 (targeting.js sortAllyTargets: the later deployed is attacked first): every summon that came in during the
    // initial deployment — also one an operator's deploy brought along (a tactician's 援军, a start-of-battle summon)
    // — ranks after all the operators (of every player on the field [ASSUMED]), in the order it came
    const summons = this.allyUnits.filter((u) => u.kind === 'token' && u.alive && u.deployed && u.deploySeq > seq0).sort((a, b) => a.deploySeq - b.deploySeq);
    for (const t of summons) t.aggroSeq = ++this._deploySeq;
    // 联防 (PRTS 卫戍协议/帮助 "部署完成后…上一阶段为退场状态的干员强制退场"): an operator knocked out at the end of its
    // own combat is withdrawn right after the deployment — down on its tile, its redeploy timer starting now (re-read
    // after battleStart below; DESIGN §5.5). Its HP ratio is the end-of-phase one (0, as after kill()) until it
    // redeploys at full HP.
    for (const u of this.allyUnits) {
      if (u.kind === 'op' && u.alive && u.carry && u.carry.down === true) {
        this._safe(() => { u.hp = 0; this.retreat(u, { reason: FORCED_EXIT }); }, 'forcedExit', u);
      }
    }
    this.emit('battleStart', {});
    // redeploy-time effects that start with the battle (机变 征召 "所有干员的再部署时间-50%", added by a battleStart
    // handler) cover the operators forced out above too: their timer is re-read with them, as a later knock-out's is
    for (const u of this.allyUnits) {
      if (u.kind !== 'op' || u.alive || u.removed || u.removeReason !== FORCED_EXIT) continue;
      u.respawnAt = u.deathAt + Math.max(0, u.base.respawnTime * u.persist.redeployMul * u.s.redeployMul);
    }
  }

  step() {
    if (this.finished || this._stepping) return; // re-entrant step() from a hook is a no-op
    // forceEnd() requested while stepping (content hook, repeated engine errors) is deferred to the end of the
    // current phase: the remaining phases are skipped and the result is built once, so nothing mutates it later.
    this._stepping = true;
    try {
      if (!this.started) this._phase('start', () => this.start());
      const dt = this.dt;
      this._phase('scheduled', () => this._runScheduled());
      this._phase('spawns', () => this._processSpawns());
      this._phase('dp', () => {
        for (const ps of this.players) ps.dp = Math.min(this.flags.dpMax, ps.dp + this.flags.dpPerSec * dt);
      });
      this._phase('buffs', () => this._tickBuffs(dt));
      this._phase('enemies', () => {
        // enemies spawned by hooks during this loop start moving next tick (a leak hook that spawns an enemy which
        // leaks at once would otherwise loop forever inside a single tick)
        const list = this.enemies;
        for (let i = 0, n = list.length; i < n && !this._endReq; i++) {
          const e = list[i];
          if (!e.alive) continue;
          try { updateEnemy(this, e, dt); } catch (err) { this._internalError('updateEnemy', err); }
          this._clampPos(e);
        }
      });
      this._compactEnemies();
      this._phase('enemyIndex', () => this._buildEnemyIndex());
      this._phase('allies', () => {
        const list = this.allyUnits;
        for (let i = 0; i < list.length && !this._endReq; i++) {
          const u = list[i];
          if (!u.alive || !u.deployed) continue;
          try {
            if (u.skill) u.skill.tick(dt);
            if (u.alive && u.kind !== 'device') updateAlly(this, u, dt);
          } catch (err) { this._internalError('updateAlly', err); }
        }
      });
      this._phase('projectiles', () => this.projectiles.update(dt));
      this._phase('redeploy', () => this._checkRedeploys());
      this._phase('boss', () => this._bossSync());
      if (this._hooks.tick) this._phase('tickHook', () => this.emit('tick', { dt }));
      this._compactEnemies();
      if (this._toRelease.length) this._releaseRemoved();
      if (!this._endReq && !this.finished) {
        this.tickCount++;
        this.time = this.tickCount * dt; // no floating drift over long battles
        this._phase('endCheck', () => this._checkEnd());
      }
    } finally {
      this._stepping = false;
    }
    if (this._endReq && !this.finished) {
      try { this.forceEnd(this._endReq); } catch (e) { this._handlerError('internal:forceEnd', null, e); this._hardFinish(this._endReq); }
    }
  }

  /** Last-resort finish when building the normal result threw (never throws itself). */
  _hardFinish(reason) {
    if (this.finished) return;
    this.finished = true;
    this.reason = reason === 'timeout' ? 'timeout' : 'forced';
    this._endReq = null;
    try { this._result = this._buildResult(); } catch { this._result = { time: this.time, reason: this.reason, perPlayer: {}, killed: this.killed, total: this.total, resolved: this.resolved, errors: this.errorCount }; }
    this.projectiles.clear();
  }

  /** Run until finished or `maxSeconds` of game time elapsed. Returns the result when finished. */
  runToEnd(maxSeconds = MAX_BATTLE_TIME) {
    const limit = this.time + maxSeconds;
    while (!this.finished && this.time < limit) this.step();
    return this.finished ? this.result() : null;
  }

  _phase(name, fn) {
    if (this.finished || this._endReq) return;
    try { fn(); } catch (e) { this._internalError(name, e); }
  }

  _checkEnd() {
    if (this.finished) return;
    if (this.sharedBoss && this.sharedBoss.hp <= 0) { this._finish('cleared'); return; }
    // A boss / hidden field with a shared pool ends only when the pool is empty or the match forces an end (DESIGN
    // §5.5) — never merely because it emptied: the h07_04 pair leader (official route: no wait) can walk into the
    // objective, and the field then idles while another field may still empty the pool or the overtime drain ends it.
    const poolHolds = !!this.sharedBoss && (this.kind === 'boss' || this.kind === 'hidden');
    if (this.autoFinish && !poolHolds && !this._pending.length && !this.enemies.some((e) => e.alive) && this.started) {
      if (!this._hasPendingEnemySchedules()) { this._finish('cleared'); return; }
    }
    if (this.time >= this.timeLimit - 1e-9) { this._timeout(); return; }
    if (this.time >= MAX_BATTLE_TIME) { this._timeout(); return; }
  }

  _hasPendingEnemySchedules() {
    for (const s of this._sched) if (!s.cancelled && s.holdsBattle) return true;
    return false;
  }

  _timeout() {
    // Remaining non-boss enemies on the field count as leaked (DESIGN §5.5). Spawns that never happened before the
    // limit are dropped: they are removed from `total` and reported in `result().unspawned` (not leaks). A content-made
    // neutral (`mem.noLeak`: 隐德来希's 心烛, which follows its original) is never a leak — it is in no spawn schedule, so
    // a client result listing it would be rejected (fields.js validateClientResult 'leak key').
    for (const e of this.enemies) {
      if (!e.alive || e.isBoss || e.mem.noLeak) continue;
      this._recordLeak(e, true);
    }
    this.unspawned = [];
    for (const p of this._pending) {
      if (p.precounted) {
        this.total--;
        const pp = this._pp(p.ownerPlayerId ?? this._ownerForTile(p.pos ?? this._routeFor(p.routeIndex, p.route)?.start));
        if (pp) pp.total--;
      }
      this.unspawned.push({ enemyKey: p.enemyKey, time: p.time, tag: p.tag ?? null, sourcePlayerId: p.sourcePlayerId ?? null });
    }
    this._pending = [];
    this._finish('timeout');
  }

  forceEnd(reason = 'forced') {
    if (this.finished) return;
    if (this._stepping) { if (!this._endReq) this._endReq = reason; return; } // finalised when step() unwinds
    this._endReq = null;
    if (!this.started) this.start();
    if (this.finished) return;
    if (reason === 'timeout') this._timeout();
    else this._finish('forced');
  }

  _finish(reason) {
    if (this.finished) return;
    this.finished = true;
    this.reason = reason;
    this._endReq = null;
    const res = this._buildResult();
    this._result = res;
    this.emit('battleEnd', { result: res });
    // re-sync fields that battleEnd handlers may have changed (layer gains / coins live in perPlayer objects)
    for (const pid of Object.keys(res.perPlayer)) {
      const pp = res.perPlayer[pid];
      pp.perfect = !pp.leaked.some((l) => l.counted !== false);
    }
    this.projectiles.clear();
  }

  _buildResult() {
    const perPlayer = {};
    for (const ps of this.players) {
      const pp = this._perPlayer[ps.playerId];
      pp.perfect = !pp.leaked.some((l) => l.counted !== false);
      // the HUD capsule's numerator of this field (DESIGN §14): this player's own scheduled enemies resolved — knocked
      // down or leaked (`counted` keeps the LP / 完美作战 reading, runtime splits and summons included)
      pp.resolved = Math.min(pp.total, pp.killedInTotal + pp.leakedInTotal);
      // the operators and the board's summon pieces (a board uid): 联防 carries an operator's HP ratio and SP, a summon's
      // SP only (match/unite.js). `sp` is the official 技力 — stored charges included (PRTS 技能 "可充能X次…当前技力上限等于该
      // 技能技力需求的X倍"); a running skill spent its SP at activation, so it reports what was left (0 for one charge).
      // `skillActive` is reported, never carried.
      pp.unitsEnd = ps.units.filter((u) => u.kind === 'op' || (u.kind === 'token' && u.uid != null)).map((u) => ({
        uid: u.uid, id: u.id, defId: u.defId,
        hpPct: u.alive ? Math.max(0, Math.min(1, u.hp / u.s.maxHp)) : 0,
        sp: u.skill && !u.skill.noSkill ? Math.round(u.skill.spTotal * 100) / 100 : 0,
        skillActive: !!(u.skill && u.skill.active && u.skill.kind !== 'passive'),
        alive: !!u.alive,
      }));
      pp.unitStats = ps.units.map((u) => ({
        id: u.id, uid: u.uid, defId: u.defId, name: u.name, kind: u.kind,
        dmg: Math.round(u.stats.dmg), kills: u.stats.kills, heal: Math.round(u.stats.heal), taken: Math.round(u.stats.taken), attacks: u.stats.attacks,
      }));
      perPlayer[ps.playerId] = pp;
    }
    const res = { time: Math.round(this.time * 1000) / 1000, reason: this.reason, perPlayer, killed: this.killed, total: this.total, resolved: this.resolved, errors: this.errorCount };
    if (this.unspawned && this.unspawned.length) res.unspawned = this.unspawned;
    if (this.sharedBoss) res.bossHpLeft = Math.max(0, this.sharedBoss.hp);
    return res;
  }

  /** BattleResult (valid once finished; a provisional result before). */
  result() {
    if (this._result) return this._result;
    return this._buildResult();
  }
}
