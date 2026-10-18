// server/match/match/bossRounds.js — Match methods: the Final Assault / Hidden Core (the rules:
// server/match/finalAssault.js) — the boss fields and the shared pool; client-side boss fields (plausibility budgets on
// the field clock, cumulative credits, handovers, the boss clock, the end: pool 0 → victory, team LP 0 → defeat);
// b.pool; the merged team LP and its shares; the overtime drain; bounties after a boss field; then the Hidden Core or
// RESULT.
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { PHASE, GEO } from '../../../shared/constants.js';
import { createRng, deriveSeed } from '../../sim/rng.js';
import { creditedKillsOf } from '../../sim/spec.js';
import { buildBossWave, bountySpawns } from '../waves.js';
import { pairPlayers, bossPoolHp, SharedBossPool, CreditPool, hiddenEligible, BOSS_HIT_STEPS } from '../finalAssault.js';
import { FieldRunner, HeadlessPacer, syntheticResult, BOSS_SILENCE_MS, CATCHUP_TICKS_PER_INTERVAL } from '../fields.js';
import { FLOW_TICKER_PRIORITY, BOSS_CLOCK_MS, DELAYS } from './common.js';

/** b.pool broadcasts at most this often (ms). */
const POOL_MIN_GAP_MS = 250;
/**
 * Final Assault / Hidden Core under client-side combat: m.public (boss HP, team LP, field progress) at most this often
 * (ms) — b.pool (≤ 4 Hz) already carries the exact pool / team LP, so a boss b.progress never re-marks the whole
 * public state.
 */
const BOSS_PUBLIC_MS = 1000;
/** How long the match waits for a boss field's b.result after it forced the end (real ms, × timerScale). */
const BOSS_RESULT_GRACE_MS = 6000;
/**
 * Plausibility of a boss field's client reports (b.progress bossDmg / leaks, the b.result damage), on the SERVER's
 * field clock — so no single frame decides the Final Assault: the credited pool damage of one field stays ≤ the whole
 * pool per BOSS_MIN_CLEAR_GS game seconds (20 % of the pool per game second; the balance model's fastest mean kills
 * take ≈ 18–20 s at ≈ 5 %/s per field, docs/BALANCE.md §3), the credited LP cost ≤ BOSS_LP_BURST + BOSS_LP_PER_GS per
 * game second (a leader's "扣除所有目标生命" comes after ≥ 200 s). Reports are cumulative: what exceeds the budget is
 * credited later as the budget grows (the boss clock re-applies the latest report), never lost — a 'cleared' b.result
 * whose report covers the pool waits for it too (`heldResult`; 999-layer kills take 2–4 game s), it is not handed over.
 */
const BOSS_MIN_CLEAR_GS = 5;
const BOSS_LP_BURST = 10;
const BOSS_LP_PER_GS = 1;

export class MatchBoss {
  startFinalAssault(hidden) {
    const alive = this.alivePlayers();
    if (!alive.length) { this.finish({ victory: false, reason: 'eliminated' }); return; }
    this.phase = hidden ? PHASE.HIDDEN_CORE : PHASE.FINAL_ASSAULT;
    this.lastResults = new Map();
    if (!hidden) this._openTeamLp();
    const bossId = hidden ? this.hiddenBossId : this.bossId;
    // BOSS_HIT tickers ("对敌方领袖造成的伤害超过20% / 50% / 80%"): the player's damage to THIS leader over its pool —
    // the pool's own per-player tally, one pool per boss round. stats.bossDamage (the result's 领袖伤害) adds up both
    // rounds, so it would credit the Final Assault's damage to the hidden leader ("隐藏boss还没打就出了50%播报").
    const hitSteps = new Map();
    const pool = new SharedBossPool(bossPoolHp(this.gd, bossId, alive.length), {
      onHit: (pid, dmg) => {
        const ps = this.players.get(pid);
        if (!ps) return;
        ps.stats.bossDamage += dmg;
        const share = (pool.byPlayer.get(pid) || 0) / pool.maxHp;
        const done = hitSteps.get(pid) || 0;
        let reached = done;
        BOSS_HIT_STEPS.forEach((s, i) => { if (share >= s) reached = Math.max(reached, i + 1); });
        if (reached > done) {
          hitSteps.set(pid, reached);
          this.tickerFor('BOSS_HIT', [ps.name], { playerId: pid, param: String(BOSS_HIT_STEPS[reached - 1]) });
        }
      },
    });
    this.bossPool = pool;
    const groups = pairPlayers(alive, createRng(deriveSeed(this.seed, 'boss-pairs')), this.bossPairs);
    this.bossPairs = groups.map(g => g.map(p => p.playerId));
    const reuse = this.bossWaves && this.bossWaves.length === groups.length && this.bossWaves.every((w, i) => w.players.join() === groups[i].map((p) => p.playerId).join());
    this.fields = groups.map((g, i) => {
      const solo = this.isSolo || g.length === 1;
      const wave = reuse ? this.bossWaves[i].wave : buildBossWave(this.gd, this.rngWaves, this.factions, this.round, { bossId, solo });
      // one spawn list per field, shared by the field's players' onBattleStart handlers (edit it in place)
      const spawns = wave.spawns.map((s) => ({ ...s, mods: s.mods ? { ...s.mods } : undefined }));
      // bounties with battles left (a multi-round card lasts MULTI_ROUND_BOUNTY_BATTLES) follow their player into the
      // boss field, on the player's half
      g.forEach((ps, j) => {
        for (const b of bountySpawns(this.gd, this.round, wave, ps.bounties, ps.playerId, { solo: this.isSolo, side: j === 0 ? 'L' : 'R' })) spawns.push(b);
      });
      const inputs = g.map((ps, j) => {
        const input = ps.battleInput({ side: j === 0 ? 'L' : 'R', colOffset: j === 0 ? 0 : 8 });
        input.lpForBoss = this.teamLp;
        // `side` + `routes`: the player's half of a pair field (spawn-list edits for one player, e.g. 鸭爵's swap)
        const ev = { input, kind: hidden ? 'hidden' : 'boss', round: this.round, spawns, routes: wave.routes, side: g.length > 1 ? (j === 0 ? 'L' : 'R') : null };
        this.dispatch(ps, 'onBattleStart', ev);
        return ev.input && typeof ev.input === 'object' ? ev.input : input;
      });
      const fieldId = `b${i + 1}`;
      const bopts = {
        seed: deriveSeed(this.seed, `${fieldId}:${this.round}`),
        kind: hidden ? 'hidden' : 'boss',
        modeId: this.modeId,
        round: this.round,
        stageId: this.stageId,
        rect: { ...GEO.BOSS_RECT },
        timeLimit: Infinity,
        players: inputs,
        spawns: this._sanitizeSpawns(spawns),
        routes: wave.routes,
        sharedBoss: this.bossPool,
        // the round's enemy effects for the leaders' mid-fight summons (server/sim/content/bosses.js summonMods)
        flags: { layerGainsEnabled: false, ...this.gd.dp, enemyScale: this.gd.enemyScale(this.round) },
        fieldId,
        enemyOverrides: wave.overrides,
        waveId: wave.templateId,
        bossId,
      };
      if (this.clientCombat) return { fieldId, kind: hidden ? 'hidden' : 'boss', players: g.map((p) => p.playerId), opts: bopts, battle: null, live: true };
      const battle = this.newBattle(bopts);
      try {
        battle.on('enemyLeak', (ctx) => this._bossLeak(ctx && ctx.enemy), { priority: -1000, owner: 'match' });
        // leader "扣除目标生命" effects (boss_7 Doom, 斥退 …: server/sim/content/bosses.js lpLoss) hit the team pool
        battle.on('lpLoss', (ctx) => this._teamLpLoss(ctx && ctx.amount), { priority: -1000, owner: 'match' });
      } catch (e) { this.reportError('boss leak hook', e); }
      return { fieldId, kind: hidden ? 'hidden' : 'boss', players: g.map((p) => p.playerId), battle, live: true };
    });
    this.overtimeApplied = 0;
    // HUD: the boss level's countdown (maxPlayTime, 120 real s — the battle goes on past it) and the moment the
    // overtime drain starts (150 real s), both on the field clock
    const onClock = (realS) => this.sched.now() + Math.round(((realS * this.gd.combatTimeScale) / this.gameSpeed) * 1000);
    const levelTime = this.gd.bossLevelTime(this.round);
    // Maintainer 2026-10-10: only teams with an AI teammate keep the extra grace after the visible countdown.
    // Freeze this choice for the fight; a disconnect / host transfer cannot change its LP clock midway.
    const team = this.order.filter((p) => !p.left);
    this.bossOvertimeStartReal = team.length > 1 && team.some((p) => p.isBot)
      ? this.gd.bossOvertimeAfterReal : (levelTime || this.gd.bossOvertimeAfterReal);
    this.deadline = this.sched.instant || !levelTime ? 0 : onClock(levelTime);
    this.overtimeAt = this.sched.instant ? 0 : onClock(this.bossOvertimeStartReal);
    if (this.clientCombat) { this._startFinalClient(hidden); return; }
    this._defaultWatch();
    this.markPublic();
    this.runner = new FieldRunner(this, this.fields, {
      onTick: (runner) => this._bossTick(runner),
      onDone: (runner) => this._finalDone(runner, hidden),
    });
    this.runner.start();
  }

  /**
   * Merged team LP at the moment a Final Assault first opens. The Hidden Core keeps whatever is left;
   * it does not call this again. A test jump straight into the hidden round calls it once when the
   * assault that would have opened the pool was skipped. [ASSUMED] that sum is the alive players'
   * current LP, not a leftover after a fight that did not happen.
   */
  _openTeamLp() {
    const alive = this.alivePlayers();
    this.teamLp = alive.reduce((s, p) => s + Math.max(0, p.lp), 0);
    for (const ps of alive) ps.lpAtFinal = Math.max(0, ps.lp);
  }

  _startFinalClient(hidden) {
    const pool = this.bossPool;
    const recs = this.fields.map((x) => this._ccField({ fieldId: x.fieldId, kind: x.kind, players: x.players, opts: x.opts, boss: { poolHp: pool.hp, poolMax: pool.maxHp } }));
    this._finalEnding = null;
    this._bossStartAt = this.sched.now();
    this.watchers.clear();
    if (!recs.some((f) => this._authorityFor(f))) {
      // nobody to simulate on a client: the server runs every boss field (FieldRunner, no streaming)
      this.fields = recs;
      for (const f of recs) {
        f.mode = 'server';
        // a CreditPool with nothing acknowledged credits everything; it counts this field's damage for b.pool `acked`
        f.credit = new CreditPool(pool);
        f.battle = this._specBattle(f.spec, { sharedBoss: f.credit });
        try {
          f.battle.on('enemyLeak', (ctx) => this._bossLeak(ctx && ctx.enemy), { priority: -1000, owner: 'match' });
          f.battle.on('lpLoss', (ctx) => this._teamLpLoss(ctx && ctx.amount), { priority: -1000, owner: 'match' });
        } catch (e) { this.reportError('boss leak hook', e); }
      }
      this._watchBossFields(recs);
      this.markPublic();
      this.runner = new FieldRunner(this, recs, {
        onTick: (runner) => this._bossTick(runner),
        onDone: (runner) => this._finalDone(runner, hidden),
        emit: false,
      });
      this.runner.start();
      return;
    }
    this._launch(recs);
    this._watchBossFields(recs);
    this.markPublic();
    this._broadcastPool(true);
    this._bossClockOn = true;
    this._bossClock = this.later(BOSS_CLOCK_MS, () => this._bossClockTick());
  }

  /** The most shared-pool damage a boss field's client reports may have credited by now (server field clock). */
  _bossDmgBudget(f) {
    return this.bossPool ? (this.bossPool.maxHp * this._fieldElapsed(f)) / BOSS_MIN_CLEAR_GS : 0;
  }

  /** The most team LP a boss field's client reports may have cost by now (server field clock). */
  _bossLpBudget(f) {
    return BOSS_LP_BURST + BOSS_LP_PER_GS * this._fieldElapsed(f);
  }

  /**
   * A boss field's shared-pool damage, as reported cumulatively by its client (`by`: per player) — credited up to the
   * plausibility budget of the field clock; the rest is credited by later reports / the boss clock (`bossReported`).
   */
  _creditBoss(f, cum, by) {
    const pool = this.bossPool;
    const reported = Number(cum);
    // the team LP ran out first: the run failed at that moment (PRTS "…使目标生命值扣除至0，则无视倒计时直接失败"), so
    // damage reported afterwards — in flight, or rounded up in the final b.result — changes nothing (user playtest #6)
    if (!pool || !Number.isFinite(reported) || this._finalEnding === 'forced') return;
    if (!f.bossReported || reported > f.bossReported.cum) f.bossReported = { cum: reported, by: by && typeof by === 'object' ? { ...by } : null };
    const c = Math.min(reported, this._bossDmgBudget(f));
    if (!(c > f.bossAcked)) return;
    const delta = c - f.bossAcked;
    f.bossAcked = c;
    let attributed = 0;
    if (by && typeof by === 'object') {
      for (const pid of f.players) {
        const v = Number(by[pid]);
        const prev = f.bossBy[pid] || 0;
        if (!Number.isFinite(v) || v <= prev) continue;
        const d = Math.min(delta - attributed, v - prev);
        if (d > 0) { f.bossBy[pid] = prev + d; pool.damage(pid, d); attributed += d; }
      }
    }
    if (delta - attributed > 0) {
      const pid = by ? null : f.players[0];
      if (pid) f.bossBy[pid] = (f.bossBy[pid] || 0) + (delta - attributed);
      pool.damage(pid, delta - attributed);
    }
  }

  /** A boss field's LP cost (leaks × lpr + leader LP effects): `cumulative` totals from its client, deltas from the server run. */
  _creditLp(f, amount, cumulative = false) {
    let n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return;
    if (cumulative) {
      // a client's cumulative report: credited up to the field clock's plausibility budget (the rest later)
      if (n > f.lpReported) f.lpReported = n;
      n = Math.min(n, this._bossLpBudget(f));
      if (n <= f.lpAcked) return;
      const d = n - f.lpAcked;
      f.lpAcked = n;
      this._teamLpLoss(d);
      return;
    }
    const before = f.lpCum;
    f.lpCum += n;
    const credit = Math.max(0, f.lpCum - Math.max(before, f.lpAcked));
    if (credit > 0) this._teamLpLoss(credit);
  }

  /**
   * The authority's per-player split of the LP its field's enemy leaks cost (b.progress `leaksBy`: cumulative, per player,
   * the leader's own LP effects not in it) — the highest value seen per player. The field's perfect-payout bounties are
   * paid only where the final result agrees with it (`_bossLeaksAgree`).
   */
  _noteLeaksBy(f, by) {
    if (!by || typeof by !== 'object') return;
    if (!f.leaksBy) f.leaksBy = {};
    for (const pid of f.players) {
      const v = Number(by[pid]);
      if (Number.isFinite(v) && v > (f.leaksBy[pid] || 0)) f.leaksBy[pid] = v;
    }
  }

  /**
   * Whether a boss field's b.result may be believed about one player's leaks before a perfect-payout bounty pays: the
   * result comes from a client (a server run is the truth itself) and does not contradict what that client reported while
   * it fought — LP it asked the team to pay must have been split into the players' own leaks and the leader's effects
   * (b.progress `leaksBy`; reports without the split explain nothing), and the player's leaked list must show at least the
   * leak LP reported for it (a leak is never moved to the other seat or dropped). A modified authority can still lie in
   * both; what the server cannot see it cannot check (the boss path never re-simulates).
   */
  _bossLeaksAgree(f, res, pid) {
    if (!f.cc || f.resultSource !== 'client') return true;
    if (f.lpReported > 1e-9 && !f.leaksBy) return false;
    const shown = ((res.perPlayer[pid] && res.perPlayer[pid].leaked) || []).reduce((n, l) => n + (Number.isFinite(l.lpr) && l.lpr >= 0 ? l.lpr : 1), 0);
    return shown + 1e-6 >= ((f.leaksBy && f.leaksBy[pid]) || 0);
  }

  /** The server runs a boss field in real time (no client left): credits only what exceeds the client's reports. */
  _bossServerRun(f) {
    const credit = new CreditPool(this.bossPool, { acked: f.bossAcked, ackedBy: f.bossBy });
    const battle = this._specBattle(f.spec, { sharedBoss: credit });
    f.battle = battle;
    f.credit = credit;
    f.lpCum = 0;
    try {
      battle.on('enemyLeak', (ctx) => { const e = ctx && ctx.enemy; if (e) this._creditLp(f, Number.isFinite(e.lpr) && e.lpr >= 0 ? e.lpr : 1); }, { priority: -1000, owner: 'match' });
      battle.on('lpLoss', (ctx) => this._creditLp(f, ctx && ctx.amount), { priority: -1000, owner: 'match' });
    } catch (e) { this.reportError('boss leak hook', e); }
    if (!this.pacer) this.pacer = new HeadlessPacer(this);
    const entry = this.pacer.add({
      battle,
      onDone: () => {
        if (f.done) return;
        let res = null;
        try { res = battle.result(); } catch (e) { this.reportError('boss result', e); }
        f.result = res && res.perPlayer ? res : syntheticResult(f.players, { bossBy: f.bossBy });
        f.resultSource = 'server';
        this._fieldDone(f);
        this._checkFinalEnd();
      },
      onTick: () => this._checkFinalEnd(),
    });
    const gt = this._fieldElapsed(f);
    // the fast-forward to the field clock is spread over the pacing intervals on a real host (virtual time: at once)
    if (gt > 0 && !entry.done) this.pacer.skipTo(entry, gt, { budgetTicks: this.sched.virtual ? Infinity : CATCHUP_TICKS_PER_INTERVAL });
  }

  /**
   * A boss field's authority left, went silent or sent an implausible result (`demote`: never its authority again):
   * its partner (a replica already running) takes over, else the server.
   */
  _bossHandover(f, why, { demote = false } = {}) {
    if (f.done || f.mode !== 'client' || f.heldResult) return; // a held 'cleared' result is in: nothing left to run
    const prev = f.authority;
    if (demote && prev) f.demoted.add(prev);
    const next = this._authorityFor(f, prev);
    if (next) {
      f.authority = next;
      f.lastProgressAt = this.sched.now();
      if (prev) this.sendTo(prev, { t: 'b.end', battleId: f.battleId, fieldId: f.fieldId, reason: 'takeover' });
      this._sendStart(next, f);
      return;
    }
    this._runOnServer(f, why);
  }

  _bossClockTick() {
    this._bossClock = null;
    if (this.phase !== PHASE.FINAL_ASSAULT && this.phase !== PHASE.HIDDEN_CORE) return;
    if (this.paused) return; // re-armed by _resume
    const now = this.sched.now();
    this._applyOvertime(((now - this._bossStartAt) / 1000) * this.gameSpeed);
    for (const f of this.fields) {
      // reports held back by the plausibility budget are credited as the field clock advances
      if (f.cc && !f.done && f.mode === 'client') {
        if (f.bossReported && f.bossReported.cum > f.bossAcked) this._creditBoss(f, f.bossReported.cum, f.bossReported.by);
        if (f.lpReported > f.lpAcked) this._creditLp(f, f.lpReported, true);
      }
      if (f.cc && !f.done && f.mode === 'client' && !f.heldResult && now - f.lastProgressAt > BOSS_SILENCE_MS) {
        this.log.info?.(`[match ${this.roomCode}] ${f.fieldId}: no progress from ${f.authority} — handing the field over`);
        this._bossHandover(f, 'silent');
      }
    }
    this._checkFinalEnd();
    this._broadcastPool(false);
    if (this.fields.some((f) => f.cc && !f.done)) this._bossClock = this.later(BOSS_CLOCK_MS, () => this._bossClockTick());
    else this._bossClockOn = false;
  }

  /** Pool depleted → victory; team LP 0 → defeat: every boss field is ended. */
  _checkFinalEnd() {
    if (this._finalEnding || !this.bossPool || !this.fields.some((f) => f.cc)) return;
    if (this.phase !== PHASE.FINAL_ASSAULT && this.phase !== PHASE.HIDDEN_CORE) return;
    if (this.bossPool.hp <= 0) this._endFinal('cleared');
    else if (this.teamLp != null && this.teamLp <= 0) this._endFinal('forced');
  }

  _endFinal(reason) {
    if (this._finalEnding) return;
    this._finalEnding = reason;
    this._broadcastPool(true);
    for (const f of this.fields) {
      if (!f.cc || f.done) continue;
      if (f.mode === 'server' && f.battle) {
        try { f.battle.forceEnd('forced'); } catch (e) { this.reportError('boss forceEnd', e); }
        let res = null;
        try { res = f.battle.result(); } catch (e) { this.reportError('boss result', e); }
        f.result = res && res.perPlayer ? res : syntheticResult(f.players, { bossBy: f.bossBy });
        f.resultSource = 'server';
        continue; // _fieldDone below (after every field was told)
      }
      for (const pid of this._humansShowing(f)) this.sendTo(pid, { t: 'b.end', battleId: f.battleId, fieldId: f.fieldId, reason });
      if (f.heldResult) {
        // its authority already reported 'cleared' (_onResult): that result completes the field
        f.result = f.heldResult;
        this._bossResultDamage(f, f.result);
        f.resultSource = 'client';
        continue; // _fieldDone below
      }
      f.waitTimer = this.later(this.scaled(BOSS_RESULT_GRACE_MS), () => {
        f.waitTimer = null;
        if (f.done) return;
        f.result = syntheticResult(f.players, { bossBy: f.bossBy, time: this._fieldElapsed(f) });
        this._fieldDone(f);
      });
    }
    if (this.pacer) { this.pacer.stop(); this.pacer = null; }
    for (const f of this.fields) if (f.cc && !f.done && (f.mode === 'server' || f.heldResult)) this._fieldDone(f);
  }

  /** b.pool { hp, max, teamLp, acked } to everyone (≤ 4 Hz; `force` skips the dedupe, never the rate). */
  _broadcastPool(force) {
    if (!this.bossPool || this.disposed) return;
    const now = this.sched.now();
    if (now - this._lastPoolAt < POOL_MIN_GAP_MS) {
      if (!this._poolTimer) {
        this._poolTimer = this.later(Math.max(1, POOL_MIN_GAP_MS - (now - this._lastPoolAt)), () => { this._poolTimer = null; this._broadcastPool(force); });
      }
      return;
    }
    // exact numbers: a client shows `hp − (its cumulative damage − acked)` and ends its battle as 'cleared' when that
    // reaches 0 — rounded values could show 0 while the server's pool still holds a fraction of a point
    // a server-run field (no client left, or none at all): what its battle has put into the pool so far — a display
    // replica (a reconnecting / watching human) subtracts only its local damage beyond that from the server hp
    const acked = {};
    for (const f of this.fields) if (f.cc) acked[f.fieldId] = f.mode === 'server' && f.credit ? Math.max(f.bossAcked, f.credit.cum) : f.bossAcked;
    const msg = {
      t: 'b.pool', hp: Math.max(0, this.bossPool.hp), max: this.bossPool.maxHp,
      teamLp: this.teamLp == null ? null : Math.max(0, Math.round(this.teamLp)), acked,
    };
    const key = JSON.stringify(msg);
    if (!force && key === this._lastPoolKey) return;
    this._lastPoolKey = key;
    this._lastPoolAt = now;
    this.broadcast(msg);
  }

  /**
   * Bounties after a boss field: kill-bounty coins and — when `perfect` — the coins of every perfect-payout bounty (a
   * 战术特训 card: PRTS "若各自行动阶段就达成完美作战，获得N资金", the same sum SETTLE pays after a normal battle) go to
   * pending funds (spent in the Hidden Core's prep), and every bounty used one of its battles, exactly like SETTLE does
   * for normal rounds.
   * @param {boolean} perfect the player's own field was perfect and the team won (`_finishFinal`)
   */
  _settleBossBounties(ps, pp, perfect) {
    let coins = Math.max(0, Math.trunc(Number(pp.coins) || 0));
    if (perfect) for (const b of ps.bounties) if (b.card.payout === 'perfect') coins += b.card.coin;
    if (coins > 0) { ps.pendingFunds += coins; ps.stats.fundsGained += coins; }
    if (!ps.bounties.length) return;
    for (const b of ps.bounties) b.roundsLeft--;
    ps.bounties = ps.bounties.filter((b) => b.roundsLeft > 0);
    ps.dirty();
  }

  _bossLeak(enemy) {
    if (!enemy || this.teamLp == null) return;
    // lifePointReduce from data: 0 for harmless enemies (e.g. 装置 / unharmful escorts), 1 when absent
    const lpr = Number.isFinite(enemy.lpr) && enemy.lpr >= 0 ? enemy.lpr : 1;
    this._teamLpLoss(lpr);
  }

  _teamLpLoss(amount) {
    const n = Number(amount);
    if (this.teamLp == null || !Number.isFinite(n) || !(n > 0)) return;
    this.teamLp = Math.max(0, this.teamLp - n);
    if (this._bossLazyPublic()) { this._bossPublic(); return; }
    this._syncTeamLp();
    this.markPublic();
  }

  /** Boss rounds under client-side combat: m.public / the per-player LP shares refresh at ~1 Hz (b.pool is live). */
  _bossLazyPublic() {
    return this.clientCombat && (this.phase === PHASE.FINAL_ASSAULT || this.phase === PHASE.HIDDEN_CORE) && this.fields.some((f) => f.cc);
  }

  /** Throttled (BOSS_PUBLIC_MS) refresh of m.public and the players' LP shares during a boss round. */
  _bossPublic() {
    if (this._bossPubTimer || this.disposed || this.ended) return;
    const wait = Math.max(0, BOSS_PUBLIC_MS - (this.sched.now() - this._bossPubAt));
    this._bossPubTimer = this.later(wait, () => {
      this._bossPubTimer = null;
      this._bossPubAt = this.sched.now();
      this._syncTeamLp();
      this.markPublic();
    });
  }

  /**
   * The merged team LP (Final Assault / Hidden Core, research 01 §9) written back to the alive players as shares of
   * what each brought in (`lpAtFinal`, largest remainder, ties → seat), so m.public / m.private / m.result never show
   * the pre-merge LP of a team that lost LP in the boss fight (Σ alive lp = round(teamLp)).
   */
  _syncTeamLp() {
    if (this.teamLp == null) return;
    const alive = this.alivePlayers().filter((p) => p.lpAtFinal != null);
    if (!alive.length) return;
    const total = Math.max(0, Math.round(this.teamLp));
    const base = alive.reduce((s, p) => s + Math.max(0, p.lpAtFinal), 0);
    const rows = alive.map((p) => {
      const v = base > 0 ? (total * Math.max(0, p.lpAtFinal)) / base : total / alive.length;
      const n = Math.floor(v + 1e-9);
      return { p, n, frac: v - n };
    });
    let left = total - rows.reduce((s, x) => s + x.n, 0);
    for (const x of rows.slice().sort((a, b) => b.frac - a.frac || a.p.seat - b.p.seat)) {
      if (left <= 0) break;
      x.n++;
      left--;
    }
    for (const x of rows) if (x.p.lp !== x.n) { x.p.lp = x.n; x.p.dirty(); }
  }

  /**
   * Overtime drain on the boss field clock (`gt` game seconds): 1 team LP per real second from the 150 real-second mark
   * (bossTurnHpReduceTime, gamedata.js bossOvertimeDue).
   */
  _applyOvertime(gt) {
    const due = this.gd.bossOvertimeDue(gt, this.bossOvertimeStartReal);
    if (due > this.overtimeApplied) {
      const loss = due - this.overtimeApplied;
      this.overtimeApplied = due;
      this._teamLpLoss(loss);
    }
  }

  _bossTick(runner) {
    this._applyOvertime(runner.time);
    if (this.teamLp <= 0 && this.bossPool.hp > 0) runner.forceAll('forced');
    // client-side combat with every boss field on the server: humans that reconnect / watch run display replicas
    // whose LocalBossPool follows b.pool
    if (this.fields.some((f) => f.cc)) { this._broadcastPool(false); this._bossPublic(); }
    else if (runner.ticks % 6 === 0) this.markPublic();
    if (runner.ticks % 30 === 0) this.flush();
  }

  _finalDone(runner, hidden) { this._finishFinal(hidden, (f) => runner.resultOf(f)); }

  /** Every boss field is over: stats, bounties, then the Hidden Core or RESULT. */
  _finishFinal(hidden, resultOf) {
    if (this.phase !== (hidden ? PHASE.HIDDEN_CORE : PHASE.FINAL_ASSAULT)) return;
    this._stopClientCombat();
    // the end condition the server registered first decides (client-side combat: _endFinal — pool 0 → victory, team LP 0
    // → defeat); a boss field's final result may never turn a defeat into a victory (user playtest #6 item 5)
    const victory = this._finalEnding ? this._finalEnding === 'cleared' : this.bossPool.hp <= 0;
    for (const f of this.fields) {
      const res = resultOf(f);
      this._collectSimErrors(f, res);
      f.live = false;
      for (const pid of f.players) {
        const pp = res.perPlayer && res.perPlayer[pid];
        const ps = this.players.get(pid);
        if (pp) this.lastResults.set(pid, pp);
        if (pp && ps) {
          ps.stats.dmgDealt += Number(pp.damageDealt) || 0;
          ps.stats.kills += Number(pp.killed) || 0;
          ps.creditedKills += creditedKillsOf(pp);
          ps.dirty(); // m.private.stats
          this._charDamageTickers(ps, pp);
        }
        if (pp && ps) {
          // the own battle counts as perfect when the team won, the result is a real one (not the stand-in of a field that
          // never reported) and the player's own field let no counted enemy through [ASSUMED: the boss battle is a battle
          // of the player's own — "下场作战" — so a perfect-payout card pays as after a normal one]
          const perfect = victory && !res.synthetic && pp.perfect === true && !(pp.leaked || []).some((l) => l && l.counted !== false)
            && this._bossLeaksAgree(f, res, pid);
          this._settleBossBounties(ps, pp, perfect);
        }
        if (pp && ps) this.dispatch(ps, 'onBattleResult', { result: pp, lpLoss: 0, perfect: !!pp.perfect, boss: true });
      }
    }
    this._syncTeamLp();
    this.deadline = 0;
    this.overtimeAt = 0;
    this.markPublic();
    this.runner = null;
    if (!hidden) {
      const eligible = victory && !!this.hiddenBossId && hiddenEligible(this.gd, { layerSum: this.hiddenLayerSum, teamLp: this.teamLp });
      this.later(this.scaled(DELAYS.SETTLE), () => {
        if (eligible) {
          this.hiddenReached = true;
          this.bossPool = null;
          this.tickerText('隐秘核心已解锁', FLOW_TICKER_PRIORITY);
          this.startRound(this.gd.hiddenRound);
        } else {
          this.finish({ victory, reason: victory ? 'victory' : 'defeat' });
        }
      });
    } else {
      this.later(this.scaled(DELAYS.SETTLE), () => this.finish({ victory: true, hiddenCleared: victory, reason: 'victory' }));
    }
  }
}
