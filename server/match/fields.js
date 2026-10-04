// server/match/fields.js — runs the battles of one combat phase (DESIGN §4, §11, §14).
//
// Server-run combat (legacy streaming mode, SP_COMBAT=server; and the Final Assault when no field has a connected human):
// FieldRunner steps every live field in lockstep:
//   * real-time pacing (RealScheduler, or VirtualScheduler with instantCombat=false): an interval every 1000/30 ms
//     accumulates elapsed real time × the match's game speed (forced 2×; `opts.combatSpeed` in tests/tools) and
//     steps floor(acc / TICK) ticks, never more than maxTicksPerInterval(speed) (8 at 2×) per interval — the
//     remainder is dropped so a stalled server never spirals.
//   * instant (VirtualScheduler default): every field is stepped to completion synchronously.
//   * a solo pause (Match.paused, g.pause) skips the intervals: the field clock stands still (HeadlessPacer too).
// Every SNAP_EVERY (3) ticks of a field its events are drained; watchers of that field get `b.ev` then `b.snap`, both
// carrying the field's game time `gt` (`emit: false` skips the streaming: server-run fields under client-side combat).
// Per-field isolation: an exception from step() force-ends that field as a timeout (and, if even that throws, the
// field is closed with a synthetic result). A hard cap (HARD_CAP_SECONDS of game time) force-ends anything left.
// Results that did not come from a finished battle carry `synthetic: true` (the match never charges LP for them).
//
// Client-side combat (DESIGN §14) helpers:
//   HeadlessJob / runHeadless(battle)      step a battle to its end — in wall-clock-bounded slices (bots, takeovers
//                                          under a real scheduler) or at once (verification, virtual time) — and keep a
//                                          progress timeline [[gt, killed, total]] for the teammates' waiting UI
//                                          (联防: [gt, killed, total, left] — left = spec.js uniteLeft, the leakers'
//                                          enemies still standing, for their live counter; user playtest #6 item 7)
//   HeadlessPacer                          real-time pacing of a dynamic set of server-run battles without snapshots
//                                          (boss fields that share the pool while other fields run on clients); a
//                                          takeover's fast-forward is spread over the pacing intervals
//   specBounds(spec, gd) / validateClientResult(spec, result, { gd })
//                                          a client's b.result is accepted only when it is plausible for its spec;
//                                          the returned result is rebuilt from whitelisted fields (never the raw object)
//   uniteBillBounds(spawns, gd)            联防: per leaker, the most survivors settlement can bill (sent in + the
//                                          offspring bound) — the live counter's clamp
//   syntheticResult(players, progress)     stand-in when a boss field's client never reported
import { TICK, SNAPSHOT_EVERY } from '../sim/constants.js';
import { layerGainRoom } from '../../shared/constants.js';
import { uniteLeft } from '../sim/spec.js';
import { GRANTED_CAP_OVERRIDE } from '../sim/content/garrisons/battle.js';

export const MAX_TICKS_PER_INTERVAL = 8;
export const INTERVAL_MS = 1000 / 30;
export const GAME_SPEED = 2;
export const HARD_CAP_SECONDS = 3700;
const SNAP_EVERY = Number.isInteger(SNAPSHOT_EVERY) && SNAPSHOT_EVERY > 0 ? SNAPSHOT_EVERY : 3;

/** Catch-up cap per pacing interval: 8 ticks at the normal 2× speed, proportionally more when sped up. */
export function maxTicksPerInterval(speed) {
  return Math.max(MAX_TICKS_PER_INTERVAL, Math.ceil((Number(speed) || GAME_SPEED) * 4));
}

/**
 * Wire frame of a snapshot. Every frame is `{ t: '<type>', …payload }`, so the snapshot's game time (DESIGN §8.2)
 * travels as `gt` (game seconds) — the `t` key is the frame type 'b.snap'. `b.ev` frames carry the same `gt`.
 */
export function snapFrame(fieldId, snap) {
  const { t: gt, ...rest } = snap || {};
  return { ...rest, t: 'b.snap', fieldId, gt: typeof gt === 'number' && Number.isFinite(gt) ? gt : 0 };
}

/** Synthetic per-player result used when a field could not run at all (never punishes the player). */
export function emptyPerPlayer() {
  return { killed: 0, total: 0, leaked: [], perfect: true, layerGains: {}, coins: 0, damageDealt: 0, bossDamage: 0, healingDone: 0, deaths: 0, unitsEnd: [], unitStats: [] };
}

/** A finished stand-in for a battle that failed to construct. */
export class DeadBattle {
  constructor(opts, reason = 'forced') {
    this.fieldId = opts.fieldId ?? null;
    this.kind = opts.kind ?? 'normal';
    this.rect = opts.rect ?? null;
    this.stageId = opts.stageId ?? null;
    this.finished = true;
    this.time = 0;
    this.tickCount = 0;
    this.errorCount = 1;
    const perPlayer = {};
    for (const p of opts.players || []) perPlayer[p.playerId] = emptyPerPlayer();
    this._result = { time: 0, reason, perPlayer, killed: 0, total: 0, errors: 1, synthetic: true };
    this.errors = [];
  }
  step() {}
  forceEnd() {}
  result() { return this._result; }
  snapshot() { return { fieldId: this.fieldId, t: 0, units: [], dp: 0, killed: 0, total: 0 }; }
  drainEvents() { return []; }
  fieldMeta() { return { fieldId: this.fieldId, kind: this.kind, rect: this.rect, stageId: this.stageId, units: [] }; }
  on() { return null; }
  off() {}
}

export class FieldRunner {
  /**
   * @param {import('./Match.js').Match} m
   * @param {Array<{ fieldId: string, kind: string, players: string[], battle: any, live?: boolean }>} fields
   * @param {{ onTick?: (runner: FieldRunner) => void, onDone: (runner: FieldRunner) => void }} hooks
   */
  constructor(m, fields, { onTick = null, onDone, emit = true }) {
    this.m = m;
    this.fields = fields;
    this.emit = emit !== false;
    for (const f of fields) f.live = !f.battle.finished;
    this.onTick = onTick;
    this.onDone = onDone;
    this.ticks = 0;
    this.acc = 0;
    this.last = 0;
    this.interval = null;
    this.done = false;
    this.stopped = false;
    this.crashes = 0;
  }

  /** Game seconds elapsed on the master clock (all fields step in lockstep). */
  get time() { return this.ticks * TICK; }

  start() {
    if (this.fields.every((f) => !f.live)) { this._finish(); return; }
    if (this.m.sched.instant) {
      // one scheduler callback: run everything now (virtual time / tools)
      this.m.later(0, () => this._runInstant());
      return;
    }
    this.last = this.m.sched.now();
    this.interval = this.m.sched.setInterval(() => this.m.guard(() => this._pump()), INTERVAL_MS);
  }

  stop() {
    this.stopped = true;
    if (this.interval) { this.m.sched.clearInterval(this.interval); this.interval = null; }
  }

  _runInstant() {
    const cap = Math.ceil(HARD_CAP_SECONDS / TICK);
    while (!this.stopped && !this.done && this.ticks < cap) {
      this._tick();
      if (this.fields.every((f) => !f.live)) break;
    }
    if (!this.done && !this.stopped) this._forceAll('timeout');
    this._checkDone();
  }

  _pump() {
    if (this.stopped || this.done) return;
    const now = this.m.sched.now();
    const dt = Math.max(0, now - this.last);
    this.last = now;
    if (this.m.paused) return; // solo pause (Match.setPause): the field clock stands still
    const speed = Number.isFinite(this.m.gameSpeed) && this.m.gameSpeed > 0 ? this.m.gameSpeed : GAME_SPEED;
    this.acc += (dt / 1000) * speed;
    const cap = maxTicksPerInterval(speed);
    let n = Math.floor(this.acc / TICK + 1e-9);
    if (n > cap) { n = cap; this.acc = 0; } else this.acc -= n * TICK;
    for (let i = 0; i < n && !this.done && !this.stopped; i++) {
      this._tick();
      if (this.fields.every((f) => !f.live)) break;
    }
    if (this.time >= HARD_CAP_SECONDS) this._forceAll('timeout');
    this._checkDone();
  }

  _tick() {
    this.ticks++;
    for (const f of this.fields) {
      if (!f.live) continue;
      const b = f.battle;
      try {
        b.step();
      } catch (e) {
        this.crashes++;
        this.m.reportError(`field ${f.fieldId} step`, e);
        this._forceField(f, 'timeout');
      }
      if (b.finished) { f.live = false; this.m.markPublic(); }
      if (this.ticks % SNAP_EVERY === 0 || !f.live) this._emit(f);
    }
    if (this.onTick) {
      try { this.onTick(this); } catch (e) { this.m.reportError('field onTick', e); }
    }
    for (const f of this.fields) if (f.live && f.battle.finished) { f.live = false; this.m.markPublic(); this._emit(f); }
  }

  _forceField(f, reason) {
    try {
      f.battle.forceEnd(reason);
    } catch (e) {
      this.m.reportError(`field ${f.fieldId} forceEnd`, e);
    }
    if (!f.battle.finished) {
      // the battle object is unusable: replace it by a finished stand-in (players keep a clean result)
      const dead = new DeadBattle({ fieldId: f.fieldId, kind: f.kind, players: f.players.map((playerId) => ({ playerId })) }, 'forced');
      f.battle = dead;
    }
    f.live = false;
    this.m.markPublic();
  }

  /** Force-end every live field (team LP 0, hard cap). */
  _forceAll(reason) {
    for (const f of this.fields) if (f.live || !f.battle.finished) this._forceField(f, reason);
  }

  forceAll(reason = 'forced') { this._forceAll(reason); this._checkDone(); }

  _emit(f) {
    let ev = [];
    try { ev = f.battle.drainEvents() || []; } catch (e) { this.m.reportError(`field ${f.fieldId} drainEvents`, e); }
    if (!this.emit) return;
    const watchers = this.m.watchersOf(f.fieldId);
    if (!watchers.length) return;
    let snapMsg = null;
    try { snapMsg = snapFrame(f.fieldId, f.battle.snapshot()); } catch (e) { this.m.reportError(`field ${f.fieldId} snapshot`, e); }
    const time = Number(f.battle.time);
    const gt = snapMsg ? snapMsg.gt : Number.isFinite(time) ? time : 0;
    const evMsg = ev.length ? { t: 'b.ev', fieldId: f.fieldId, gt, ev } : null;
    for (const pid of watchers) {
      if (evMsg) this.m.sendTo(pid, evMsg);
      if (snapMsg) this.m.sendTo(pid, snapMsg);
    }
  }

  _checkDone() {
    if (this.done || this.stopped) return;
    if (this.fields.some((f) => f.live && !f.battle.finished)) return;
    this._finish();
  }

  _finish() {
    if (this.done) return;
    this.done = true;
    if (this.interval) { this.m.sched.clearInterval(this.interval); this.interval = null; }
    this.onDone(this);
  }

  /** Result of a field (never throws). */
  resultOf(f) {
    try {
      const r = f.battle.result();
      if (r && typeof r === 'object' && r.perPlayer) return r;
    } catch (e) {
      this.m.reportError(`field ${f.fieldId} result`, e);
    }
    const perPlayer = {};
    for (const pid of f.players) perPlayer[pid] = emptyPerPlayer();
    return { time: 0, reason: 'forced', perPlayer, killed: 0, total: 0, errors: 1, synthetic: true };
  }
}

// =====================================================================================================================
// client-side combat (DESIGN §14)

/** Real-time grace after a battle's time limit before the server takes a silent client's field over (ms). */
export const RESULT_GRACE_MS = 15_000;
/** A boss field whose authoritative client sent no b.progress for this long is handed over (ms). */
export const BOSS_SILENCE_MS = 12_000;
/** Game-time spacing of the progress timeline samples of a server-run field (s). */
export const TIMELINE_EVERY = 1;

/** Wall-clock budget of one headless slice under a real scheduler (ms): the host's event loop stays responsive. */
export const HEADLESS_SLICE_MS = 8;
/** Extra ticks per pacing interval while a server-paced boss field catches up to its clock (takeover). */
export const CATCHUP_TICKS_PER_INTERVAL = 240;
const perfNow = () => (globalThis.performance ? globalThis.performance.now() : Date.now());

/**
 * A timeline sample of a battle: [gt, killed, total], plus — 联防 — the leakers' enemies still standing
 * (spec.js uniteLeft; omitted when unknown).
 */
export function timelineSample(b) {
  const s = [Number(b && b.time) || 0, Number(b && b.killed) || 0, Number(b && b.total) || 0];
  if (b && b.kind === 'unite') {
    let left = null;
    try { left = uniteLeft(b); } catch { left = null; }
    if (left) s.push(left);
  }
  return s;
}

/**
 * A server-run battle stepped to its end, in one go or in wall-clock-bounded slices (a low-power host must not stall
 * its event loop for the ~0.1–1 s a whole battle takes, several times at once when bots fight): `run(budgetMs)` steps
 * until the battle ends (→ true) or the budget is used (→ false; checked every 16 ticks). `timeline` grows while it
 * runs (timelineSample: [gt, killed, total(, left)] every TIMELINE_EVERY game seconds, then the final state);
 * `output()` once done gives `{ battle, result, timeline, crashed }`. A throwing battle is force-ended, then replaced by
 * a DeadBattle; the run is bounded by HARD_CAP_SECONDS.
 */
export class HeadlessJob {
  constructor(battle, { onError = null, players = [] } = {}) {
    this.battle = battle;
    this.onError = onError;
    this.players = players;
    this.timeline = [timelineSample(battle)];
    this.every = Math.max(1, Math.round(TIMELINE_EVERY / TICK));
    this.cap = Math.ceil(HARD_CAP_SECONDS / TICK);
    this.n = 0;
    this.crashed = false;
    this.done = false;
    this._out = null;
  }

  run(budgetMs = Infinity, now = perfNow) {
    if (this.done) return true;
    const timed = Number.isFinite(budgetMs);
    const t0 = timed ? now() : 0;
    let b = this.battle;
    try {
      let k = 0;
      while (!b.finished && this.n < this.cap) {
        b.step();
        this.n++;
        k++;
        if (this.n % this.every === 0) this.timeline.push(timelineSample(b));
        if (timed && (k & 15) === 0 && !b.finished && now() - t0 >= budgetMs) return false;
      }
      if (!b.finished) b.forceEnd('timeout');
    } catch (e) {
      this.crashed = true;
      if (this.onError) this.onError(e);
      try { b.forceEnd('timeout'); } catch { /* replaced below */ }
      if (!b.finished) b = this.battle = new DeadBattle({ fieldId: b.fieldId, kind: b.kind, players: this.players.map((playerId) => ({ playerId })) }, 'forced');
    }
    this._finish();
    return true;
  }

  _finish() {
    const b = this.battle;
    let result = null;
    try { result = b.result(); } catch (e) { if (this.onError) this.onError(e); }
    if (!result || typeof result !== 'object' || !result.perPlayer) {
      const perPlayer = {};
      for (const pid of this.players) perPlayer[pid] = emptyPerPlayer();
      result = { time: Number(b.time) || 0, reason: 'forced', perPlayer, killed: 0, total: 0, errors: 1, synthetic: true };
    }
    this.timeline.push(timelineSample(b));
    this.done = true;
    this._out = { battle: b, result, timeline: this.timeline, crashed: this.crashed };
  }

  output() { return this._out; }
}

/**
 * Step a battle to its end right now (HeadlessJob in one go). Returns `{ battle, result, timeline, crashed }`.
 */
export function runHeadless(battle, opts = {}) {
  const job = new HeadlessJob(battle, opts);
  job.run(Infinity);
  return job.output();
}

/** Timeline sample at game time `gt`: [gt, killed, total(, left)] of the last sample ≤ gt. */
export function timelineAt(timeline, gt) {
  if (!Array.isArray(timeline) || !timeline.length) return [0, 0, 0];
  let lo = 0, hi = timeline.length - 1;
  if (gt >= timeline[hi][0]) return timeline[hi];
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (timeline[mid][0] <= gt) lo = mid; else hi = mid - 1;
  }
  return timeline[lo];
}

/**
 * Real-time pacing of server-run battles without snapshots (DESIGN §14: boss fields that share the pool while other
 * fields run on clients). `add({ battle, onDone(entry), onTick?(entry) })`; `skipTo(entry, gt)` fast-forwards a newly
 * added battle silently (takeover). Same accumulator / cap rules as FieldRunner.
 */
export class HeadlessPacer {
  constructor(m) {
    this.m = m;
    /** @type {Set<{ battle: any, onDone: Function, onTick?: Function, done?: boolean }>} */
    this.entries = new Set();
    this.interval = null;
    this.acc = 0;
    this.last = 0;
    this.stopped = false;
  }

  add(entry) {
    if (this.stopped || !entry || !entry.battle) return entry;
    this.entries.add(entry);
    if (!this.interval) {
      this.last = this.m.sched.now();
      this.acc = 0;
      this.interval = this.m.sched.setInterval(() => this.m.guard(() => this._pump()), INTERVAL_MS);
    }
    return entry;
  }

  /**
   * Fast-forward an entry's battle silently until its game time reaches `gt` (bounded). `budgetTicks` (default: all at
   * once) spreads it over the pacing intervals instead — at most that many extra ticks per interval on top of the
   * normal pacing — so a takeover late in a boss fight never stalls the host's event loop.
   */
  skipTo(entry, gt, { budgetTicks = Infinity } = {}) {
    const cap = Math.ceil(Math.min(Number(gt) || 0, HARD_CAP_SECONDS) / TICK);
    if (Number.isFinite(budgetTicks) && budgetTicks > 0) {
      entry.skipTicks = cap;
      entry.skipBudget = Math.max(1, Math.floor(budgetTicks));
      entry.skipped = 0;
      return;
    }
    this._skip(entry, cap, Infinity);
  }

  /** Silent steps toward `cap` ticks (at most `max`); returns the steps taken. */
  _skip(entry, cap, max) {
    const b = entry.battle;
    let k = 0;
    try {
      while (!b.finished && b.tickCount < cap && k < max) { b.step(); k++; }
    } catch (e) {
      this.m.reportError('pacer skip', e);
      try { b.forceEnd('timeout'); } catch { /* ignore */ }
    }
    try { b.drainEvents?.(); } catch { /* ignore */ }
    if (b.finished) this._finish(entry);
    return k;
  }

  remove(entry) { this.entries.delete(entry); if (!this.entries.size) this._clear(); }

  stop() { this.stopped = true; this._clear(); this.entries.clear(); }

  _clear() { if (this.interval) { this.m.sched.clearInterval(this.interval); this.interval = null; } }

  _pump() {
    if (this.stopped) return;
    const now = this.m.sched.now();
    const dt = Math.max(0, now - this.last);
    this.last = now;
    if (this.m.paused) return; // solo pause (Match.setPause): the field clock stands still
    const speed = Number.isFinite(this.m.gameSpeed) && this.m.gameSpeed > 0 ? this.m.gameSpeed : GAME_SPEED;
    this.acc += (dt / 1000) * speed;
    const cap = maxTicksPerInterval(speed);
    let n = Math.floor(this.acc / TICK + 1e-9);
    if (n > cap) { n = cap; this.acc = 0; } else this.acc -= n * TICK;
    for (const e of [...this.entries]) {
      if (this.stopped) break;
      if (e.done) continue;
      const b = e.battle;
      if (e.skipTicks != null) {
        // sliced fast-forward (takeover): the field clock keeps running, so the target moves with the pacing
        e.skipTicks += n;
        e.skipped += this._skip(e, e.skipTicks, e.skipBudget + n);
        if (e.done) continue;
        if (b.tickCount >= e.skipTicks) e.skipTicks = null;
        if (e.onTick) { try { e.onTick(e); } catch (err) { this.m.reportError('pacer onTick', err); } }
        continue;
      }
      for (let i = 0; i < n && !b.finished; i++) {
        try { b.step(); } catch (err) {
          this.m.reportError('pacer step', err);
          try { b.forceEnd('timeout'); } catch { /* ignore */ }
          break;
        }
        if (b.time >= HARD_CAP_SECONDS) { try { b.forceEnd('timeout'); } catch { /* ignore */ } }
      }
      if (e.onTick) { try { e.onTick(e); } catch (err) { this.m.reportError('pacer onTick', err); } }
      if (b.finished) this._finish(e);
    }
  }

  _finish(e) {
    if (e.done) return;
    e.done = true;
    this.entries.delete(e);
    if (!this.entries.size) this._clear();
    try { e.onDone(e); } catch (err) { this.m.reportError('pacer onDone', err); }
  }
}

/** Synthetic per-player results of a field whose client never reported (boss fields only; no LP relevance). */
export function syntheticResult(players, { bossBy = {}, time = 0 } = {}) {
  const perPlayer = {};
  for (const pid of players) perPlayer[pid] = { ...emptyPerPlayer(), bossDamage: Math.max(0, Number(bossBy[pid]) || 0) };
  return { time, reason: 'forced', perPlayer, killed: 0, total: 0, errors: 0, synthetic: true };
}

// ---- result validation ------------------------------------------------------------------------------------------

const derivedCache = new WeakMap();
const ENEMY_KEY_RE = /enemy_[A-Za-z0-9_]+/g;

/** Enemy keys a spawned enemy's data record mentions (summons, splits, transformations): content may spawn them. */
function derivedKeys(gd, key) {
  if (!gd || typeof gd.enemy !== 'function') return [];
  let m = derivedCache.get(gd);
  if (!m) { m = new Map(); derivedCache.set(gd, m); }
  if (m.has(key)) return m.get(key);
  const out = new Set();
  const rec = gd.enemy(key);
  if (rec) {
    let text = '';
    try { text = JSON.stringify(rec); } catch { text = ''; }
    for (const k of text.match(ENEMY_KEY_RE) || []) if (k !== key && gd.enemy(k)) out.add(k);
  }
  const list = [...out];
  m.set(key, list);
  return list;
}

/**
 * How many `child` enemies one `parent` can leave behind, when its data says so: a talent naming the child
 * (`<X>.enemy_key`) with a count (`<X>.cnt`, e.g. 磨砻 DeadSpawn 2, 烹泉 4, 沉沙's unconsumed blades ≤ 4) or without one
 * (DeathRattle: the 术师 of a 术师快艇 = 1) — the sim's kitDeathSpawn / kitBlades / DeathRattle kits. null when the data
 * gives no such bound (periodic summoners such as 枯朽萃聚使徒's BornBugs, keys a record merely mentions).
 */
function offspringPerParent(gd, parent, child) {
  const rec = gd && typeof gd.enemy === 'function' ? gd.enemy(parent) : null;
  const t = rec && rec.talents && typeof rec.talents === 'object' ? rec.talents : null;
  if (!t || !t.bbStr || typeof t.bbStr !== 'object') return null;
  let n = null;
  for (const [k, v] of Object.entries(t.bbStr)) {
    if (v !== child || !k.endsWith('.enemy_key')) continue;
    const prefix = k.slice(0, -'.enemy_key'.length);
    const cnt = Number(t.bb && t.bb[`${prefix}.cnt`]);
    if (Number.isFinite(cnt) && cnt > 0) n = (n || 0) + Math.max(1, Math.ceil(cnt));
    else if (prefix === 'DeathRattle') n = (n || 0) + 1;
    else return null; // a countless summon talent (a boss's endless 余音): no bound from data
  }
  return n;
}

const summonCache = new WeakMap();
function summonIndex(gd) {
  let idx = summonCache.get(gd);
  if (idx) return idx;
  idx = { byOwner: new Map(), ownerless: [] };
  const tokens = gd.raw && gd.raw.tokens && typeof gd.raw.tokens === 'object' ? gd.raw.tokens : {};
  for (const [id, t] of Object.entries(tokens)) {
    const owners = t && Array.isArray(t.owners) ? t.owners : [];
    if (!owners.length) idx.ownerless.push(id);
    for (const o of owners) { if (!idx.byOwner.has(o)) idx.byOwner.set(o, []); idx.byOwner.get(o).push(id); }
  }
  summonCache.set(gd, idx);
  return idx;
}
/** Summon (token) ids a chess (normal or elite) can create: its data `tokens` + tokens naming it an owner. */
function summonsOf(gd, chessId) {
  if (typeof gd.chess !== 'function' || typeof chessId !== 'string') return [];
  const rec = gd.chess(chessId);
  const out = new Set(rec && Array.isArray(rec.tokens) ? rec.tokens : []);
  const idx = summonIndex(gd);
  for (const id of [chessId, rec && rec.baseId, rec && rec.goldenId]) for (const t of (id && idx.byOwner.get(id)) || []) out.add(t);
  return [...out];
}
/** Summons no chess owns (bond / band units every player may field: 炎佑, 预备干员-医疗, Touch). */
function ownerlessSummons(gd) { return summonIndex(gd).ownerless; }

const WORD_RE = /[A-Za-z][A-Za-z0-9_]*/g;
const recJson = (rec) => { try { return rec ? JSON.stringify(rec) : ''; } catch { return ''; } };

/**
 * Bonds an IN_BATTLE layer gain of this player can name: its bond snapshot (every bond its lineup counts), plus bonds
 * its band, its effects (机变 cards, 驻守 …), its units and their items mention (content grants layers to those —
 * e.g. 克莱门莎's <阿戈尔>, requireActive: false). Anything else is a forged gain.
 */
function layerBondsOf(p, gd) {
  const out = new Set(Object.keys(p.bonds && typeof p.bonds === 'object' ? p.bonds : {}));
  if (typeof gd.bond !== 'function') return out;
  const texts = [recJson(p.playerEffects), recJson(p.bonds)];
  const band = p.bandId && typeof gd.band === 'function' ? gd.band(p.bandId) : null;
  if (band) {
    texts.push(recJson(band));
    if (band.effectId && typeof gd.effect === 'function') texts.push(recJson(gd.effect(band.effectId)));
  }
  for (const u of Array.isArray(p.units) ? p.units : []) {
    if (!u) continue;
    if (u.kind === 'token') { if (typeof gd.token === 'function') texts.push(recJson(gd.token(u.tokenId))); continue; }
    if (typeof gd.chess === 'function') texts.push(recJson(gd.chess(u.chessId)));
    for (const it of Array.isArray(u.items) ? u.items : []) if (typeof gd.item === 'function') texts.push(recJson(gd.item(it)));
  }
  for (const t of texts) for (const w of t.match(WORD_RE) || []) if (!out.has(w) && gd.bond(w)) out.add(w);
  return out;
}

/**
 * What the player's IN_BATTLE layer 特质 can add to each bond in one battle on top of the flat 60 + 4·round (DESIGN
 * §21.26): the traits of its units (garrisons with `bond_add_count` / `bond_add_count_multi`) and the ones their ADD_BOND
 * traits hand out (`give_garrison_id`, counted for every operator of the player — "所有【X】" reaches them all), each on
 * the bonds it names (`bond_by_id` ids; `bond_self` / `bond_actived_maxstack`: every bond of the player's snapshot and
 * units), up to the per-battle cap the sim applies (content/garrisons/battle.js: `max_add_count_per_battle`, the handed-out
 * 华法琳 trait's GRANTED_CAP_OVERRIDE). A trait the data gives no cap (初雪 / 银灰's freeze trait, 菲莱 / 百炼嘉维尔's per-skill
 * 萨尔贡, 斯卡蒂's per-kill …) — or a 魔王, whose +extra on every trait gain counts toward no cap — leaves its bonds bounded
 * only by the room under 999 (Infinity here): such boards legitimately gain hundreds of layers a battle.
 * @returns {Map<string, number>} bondId → extra allowance (Infinity: uncapped)
 */
function layerAllowanceOf(p, gd) {
  const out = new Map();
  if (typeof gd.garrison !== 'function' || typeof gd.chess !== 'function' || typeof gd.bond !== 'function') return out;
  const units = (Array.isArray(p.units) ? p.units : []).filter((u) => u && u.kind !== 'token' && typeof u.chessId === 'string');
  const lineup = new Set(Object.keys(p.bonds && typeof p.bonds === 'object' ? p.bonds : {}));
  for (const u of units) for (const b of gd.chess(u.chessId)?.bonds || []) lineup.add(b);
  let extra = false;
  const credit = (g, times, handedOut) => {
    const bb = g.bb || {};
    if (Number.isFinite(bb.extra_cnt)) { extra = true; return; }
    if (!Number.isFinite(bb.bond_add_count) && !Number.isFinite(bb.bond_add_count_multi)) return;
    const s = g.bbStr || {};
    const bonds = s.bond_type === 'bond_by_id' ? String(s.bond_id ?? '').split(',').map((x) => x.trim()).filter((x) => gd.bond(x)) : [...lineup];
    const override = handedOut ? GRANTED_CAP_OVERRIDE[g.garrisonId] : undefined;
    const cap = override ?? (Number(bb.max_add_count_per_battle) > 0 ? Number(bb.max_add_count_per_battle) : Infinity);
    for (const b of bonds) out.set(b, (out.get(b) || 0) + cap * times);
  };
  for (const u of units) {
    for (const gid of gd.chess(u.chessId)?.garrisonIds || []) {
      const g = gd.garrison(gid);
      if (!g || g.eventType !== 'IN_BATTLE') continue;
      if (g.effectKey !== 'ADD_BOND') { credit(g, 1, false); continue; }
      const given = gd.garrison(g.bbStr?.give_garrison_id);
      if (given && given.eventType === 'IN_BATTLE') credit(given, units.length, true);
    }
  }
  if (extra) for (const b of out.keys()) out.set(b, Infinity);
  return out;
}

/**
 * Bounds of a battle derived from its spec: spawn counts per enemy key, keys content may add, bounty coins, the
 * player ids and each player's unit uids.
 */
export function specBounds(spec, gd = null) {
  const keyCounts = new Map();
  /** `${enemyKey}|${sourcePlayerId}` → scheduled count (联防: whose leak re-enters) */
  const keySourceCounts = new Map();
  /** spawn keys whose schedule entries may leak without costing LP (countInTotal false, boss / part tags) */
  const uncountedKeys = new Set();
  let spawnCount = 0;
  let bountyCoins = 0;
  const sources = new Set();
  for (const s of Array.isArray(spec && spec.spawns) ? spec.spawns : []) {
    if (!s || typeof s.enemyKey !== 'string') continue;
    const n = Math.max(1, Math.min(10_000, Math.floor(Number(s.count) || 1)));
    spawnCount += n;
    keyCounts.set(s.enemyKey, (keyCounts.get(s.enemyKey) || 0) + n);
    const ks = `${s.enemyKey}|${typeof s.sourcePlayerId === 'string' ? s.sourcePlayerId : ''}`;
    keySourceCounts.set(ks, (keySourceCounts.get(ks) || 0) + n);
    if (s.countInTotal === false || s.tag === 'boss' || s.tag === 'part') uncountedKeys.add(s.enemyKey);
    const coins = Math.max(Number(s.bounty && s.bounty.coins) || 0, Number(s.mods && s.mods.bountyCoins) || 0);
    if (coins > 0) bountyCoins += coins * n;
    if (typeof s.sourcePlayerId === 'string') sources.add(s.sourcePlayerId);
  }
  const derived = new Set();
  for (const k of keyCounts.keys()) for (const d of derivedKeys(gd, k)) derived.add(d);
  const maxTotal = spawnCount * 4 + 100;
  // 联防: `${childKey}|${sourcePlayerId}` → how many content-spawned children the enemies that leaker sent in can leave
  // (offspringPerParent per parent; maxTotal when the data gives no bound) — a survivor of a split / summon is billed
  // only to a leaker whose own enemies can have produced it
  const derivedSourceCounts = new Map();
  for (const s of Array.isArray(spec && spec.spawns) ? spec.spawns : []) {
    if (!s || typeof s.enemyKey !== 'string' || typeof s.sourcePlayerId !== 'string') continue;
    const n = Math.max(1, Math.min(10_000, Math.floor(Number(s.count) || 1)));
    for (const d of derivedKeys(gd, s.enemyKey)) {
      const per = offspringPerParent(gd, s.enemyKey, d);
      const ks = `${d}|${s.sourcePlayerId}`;
      derivedSourceCounts.set(ks, Math.min(maxTotal, (derivedSourceCounts.get(ks) || 0) + (per == null ? maxTotal : n * per)));
    }
  }
  for (const k of keyCounts.keys()) {
    const rec = gd && typeof gd.enemy === 'function' ? gd.enemy(k) : null;
    if (rec && rec.notCountInTotal) uncountedKeys.add(k);
  }
  const players = new Map();
  for (const p of Array.isArray(spec && spec.players) ? spec.players : []) {
    if (!p || typeof p.playerId !== 'string') continue;
    const chess = new Map();
    const all = new Map();
    // unit types this player can field: its board's chess / tokens, their summons, and the ownerless summons of
    // bonds / bands (炎佑, 预备干员) — the only names a statistic of a unit created in battle (no board uid) may carry
    const defIds = new Set(gd ? ownerlessSummons(gd) : []);
    for (const u of Array.isArray(p.units) ? p.units : []) {
      if (!u || !Number.isInteger(u.uid)) continue;
      const defId = u.kind === 'token' ? u.tokenId : u.chessId;
      all.set(u.uid, defId);
      if (typeof defId === 'string') defIds.add(defId);
      if (u.kind !== 'token') {
        chess.set(u.uid, defId);
        if (gd) for (const t of summonsOf(gd, defId)) defIds.add(t);
      }
    }
    // the layers each bond starts the battle with (PlayerBattleInput.bonds): a gain never passes BOND_LAYER_CAP
    const startLayers = new Map();
    for (const [id, b] of Object.entries(p.bonds && typeof p.bonds === 'object' ? p.bonds : {})) {
      const v = Number(b && b.layers);
      if (Number.isFinite(v) && v > 0) startLayers.set(id, v);
    }
    players.set(p.playerId, { chess, all, defIds, bonds: gd ? layerBondsOf(p, gd) : null, startLayers, layerAllow: gd ? layerAllowanceOf(p, gd) : new Map() });
  }
  const round = Number(spec && spec.round) || 0;
  return {
    keyCounts, keySourceCounts, derivedSourceCounts, uncountedKeys, derived, spawnCount, bountyCoins, sources, players,
    // content spawns (splits, summons, boss minions) can add enemies beyond the schedule
    maxTotal,
    layerCap: 60 + 4 * round,
    maxTime: spec && spec.timeLimit > 0 ? spec.timeLimit + 5 : HARD_CAP_SECONDS,
  };
}

/**
 * 联防: the most enemies settlement can bill each leaker — what it sent in plus what those enemies can leave behind
 * (splits / summons within offspringPerParent, maxTotal without a data bound): validateClientResult's (key, leaker)
 * budgets summed per leaker. Bounds the live counter (Match._uniteLeft; user playtest #6 item 7).
 * @param {object[]} spawns the 联防 spawns (unite.js plan.leaked: { enemyKey, sourcePlayerId, … })
 * @returns {Map<string, number>} leaker id → bound
 */
export function uniteBillBounds(spawns, gd = null) {
  const B = specBounds({ spawns: Array.isArray(spawns) ? spawns : [] }, gd);
  const out = new Map();
  for (const [ks, n] of [...B.keySourceCounts, ...B.derivedSourceCounts]) {
    const pid = ks.slice(ks.lastIndexOf('|') + 1);
    if (pid) out.set(pid, (out.get(pid) || 0) + n);
  }
  return out;
}

const finiteIn = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const sameMods = (a, b) => {
  const ka = a && typeof a === 'object' ? Object.keys(a).filter((k) => a[k] !== undefined).sort() : [];
  const kb = b && typeof b === 'object' ? Object.keys(b).filter((k) => b[k] !== undefined).sort() : [];
  if (ka.length !== kb.length) return false;
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i] || a[ka[i]] !== b[kb[i]]) return false;
  return true;
};

/**
 * Semantic validation of a client's BattleResult against the battle's spec (DESIGN §14 "Result validation"). The
 * payload already passed shared/protocol.js isBattleResult (types, sizes). Checks: every spec player reported and
 * nobody else; killed ≤ total ≤ bound; each leaked enemy key exists in the spawns (multiset bound; keys content may
 * spawn are bounded by the total) — boss fields excepted (their leaks cost team LP through b.progress); a leak is
 * `counted: false` only for enemies that never count (data notCountInTotal, countInTotal false, boss / part entries,
 * content spawns); 联防: leaks + never-spawned re-entries per (enemy, leaker) ≤ what that leaker sent in, and a split /
 * summon only on a leaker who sent in its parent, ≤ the parents' data offspring count (offspringPerParent); per-bond layer
 * gains ≤ 60 + 4·round + what the player's layer 特质 can add to that bond (layerAllowanceOf: their per-battle caps, no
 * flat bound when one is uncapped) and ≤ the room left under BOND_LAYER_CAP (999) from the bond's starting layers, only
 * on bonds the player's lineup / band / effects / items name, none when the spec disables gains; coins ≤ the spawns' bounty coins;
 * perfect consistent with the counted leaks; unit states only for the player's own units, within range.
 * @returns {{ ok: true, result: object } | { ok: false, reason: string }}
 */
export function validateClientResult(spec, raw, { gd = null } = {}) {
  const bad = (reason) => ({ ok: false, reason });
  try {
    if (!spec || !raw || typeof raw !== 'object' || !raw.perPlayer || typeof raw.perPlayer !== 'object') return bad('shape');
    const B = specBounds(spec, gd);
    const bossLike = spec.kind === 'boss' || spec.kind === 'hidden';
    if (!['cleared', 'timeout', 'forced'].includes(raw.reason)) return bad('reason');
    if (!finiteIn(raw.time, 0, B.maxTime)) return bad('time');
    const pids = Object.keys(raw.perPlayer);
    if (pids.length !== B.players.size || pids.some((pid) => !B.players.has(pid))) return bad('players');
    const spawnMods = new Map();
    for (const s of spec.spawns || []) {
      if (!s || typeof s.enemyKey !== 'string') continue;
      if (!spawnMods.has(s.enemyKey)) spawnMods.set(s.enemyKey, []);
      spawnMods.get(s.enemyKey).push(s);
    }
    const leakCount = new Map();
    // 联防: (enemyKey, leaker) budget shared by the helpers' leaks and the never-spawned re-entries
    const sourceLeft = new Map(B.keySourceCounts);
    const derivedLeft = new Map(B.derivedSourceCounts);
    const takeFrom = (left, key, src) => {
      const ks = `${key}|${src || ''}`;
      const n = left.get(ks) || 0;
      if (n <= 0) return false;
      left.set(ks, n - 1);
      return true;
    };
    const takeSource = (key, src) => takeFrom(sourceLeft, key, src);
    // a content-spawned enemy (split, summon): billed only to a leaker who sent in a parent, within its offspring bound
    const takeDerived = (key, src) => B.derived.has(key) && takeFrom(derivedLeft, key, src);
    let coinsSum = 0;
    const perPlayer = {};
    for (const pid of pids) {
      const p = raw.perPlayer[pid];
      if (!p || typeof p !== 'object') return bad('player');
      const own = B.players.get(pid);
      if (!Number.isInteger(p.killed) || !Number.isInteger(p.total) || p.killed < 0 || p.killed > p.total || p.total > B.maxTotal) return bad('counts');
      const leaked = [];
      for (const l of Array.isArray(p.leaked) ? p.leaked : []) {
        if (!l || typeof l.enemyKey !== 'string') return bad('leak');
        const key = l.enemyKey;
        if (gd && typeof gd.enemy === 'function' && !gd.enemy(key) && !B.keyCounts.has(key)) return bad('leak key');
        const counted = l.counted !== false;
        if (!bossLike) {
          if (!B.keyCounts.has(key) && !B.derived.has(key)) return bad('leak key');
          const n = (leakCount.get(key) || 0) + 1;
          leakCount.set(key, n);
          const bound = (B.keyCounts.get(key) || 0) + (B.derived.has(key) ? B.maxTotal : 0);
          if (n > bound) return bad('leak multiset');
          // a leak costs LP unless the enemy never counts (data notCountInTotal, countInTotal false, boss / part
          // entries); content-spawned keys (summons, splits) may carry their own flag
          if (!counted && !B.uncountedKeys.has(key) && !B.derived.has(key)) return bad('uncounted leak');
        }
        // mods / tag / source come from the spawn schedule (a leak re-enters 联防 with them). An enemy content spawned
        // (a split, a summon) carries its parent's mods — the round multipliers, a bounty id — so the leak's mods may
        // equal another schedule entry's: keep those (dropping them would re-enter it weaker and lose its bounty)
        const cands = spawnMods.get(key) || [];
        const match = cands.find((s) => sameMods(s.mods ?? null, l.mods ?? null)) || null;
        const src = match || cands[0] || null;
        const parent = match ? null : (spec.spawns || []).find((s) => s && typeof s.enemyKey === 'string' && sameMods(s.mods ?? null, l.mods ?? null)) || null;
        const modsOf = (s) => (s && s.mods ? { ...s.mods } : null);
        const mods = match ? modsOf(match) : parent ? modsOf(parent) : modsOf(src);
        let sourcePlayerId = typeof l.sourcePlayerId === 'string' ? l.sourcePlayerId : null;
        if (spec.kind === 'unite') {
          if (!sourcePlayerId || !B.sources.has(sourcePlayerId)) sourcePlayerId = src && typeof src.sourcePlayerId === 'string' ? src.sourcePlayerId : null;
          // whose LP a surviving enemy costs: never more of (key, leaker) than that leaker sent into the 联防 — or, for a
          // split / summon, than the enemies that leaker sent in can leave behind
          if (!takeSource(key, sourcePlayerId) && !takeDerived(key, sourcePlayerId)) return bad('leak source');
        } else if (sourcePlayerId !== pid && !B.players.has(sourcePlayerId)) sourcePlayerId = pid;
        const lpr = finiteIn(l.lpr, 0, 1000) ? l.lpr : 1;
        const e = { enemyKey: key, mods, lpr, sourcePlayerId, tag: src ? (src.tag ?? null) : (typeof l.tag === 'string' ? l.tag : null), counted, spawned: true };
        if (l.boss) e.boss = true;
        leaked.push(e);
      }
      const countedLeaks = leaked.filter((l) => l.counted !== false).length;
      if (!bossLike && countedLeaks > p.total + B.spawnCount) return bad('leaks > total');
      if (typeof p.perfect !== 'boolean' || p.perfect !== (countedLeaks === 0)) return bad('perfect');
      const layerGains = {};
      for (const [bondId, n] of Object.entries(p.layerGains || {})) {
        // ≤ 60 + 4·round + what the player's layer 特质 can add to the bond (layerAllowanceOf; uncapped ones: no flat
        // bound), and never past BOND_LAYER_CAP from the layers the bond started with (Battle.addLayers clamps)
        const bound = Math.min(B.layerCap + (own.layerAllow.get(bondId) || 0), layerGainRoom(own.startLayers.get(bondId) || 0, Infinity));
        if (!finiteIn(n, 0, bound)) return bad('layer bound');
        if (n > 0 && spec.flags && spec.flags.layerGainsEnabled === false) return bad('layers disabled');
        if (gd && typeof gd.bond === 'function' && !gd.bond(bondId)) return bad('bond');
        if (n > 0 && own.bonds && !own.bonds.has(bondId)) return bad('layer bond');
        if (n > 0) layerGains[bondId] = n;
      }
      const coins = Number(p.coins) || 0;
      if (!finiteIn(coins, 0, B.bountyCoins + 1e-6)) return bad('coins');
      coinsSum += coins;
      const unitsEnd = [];
      const seen = new Set();
      for (const u of Array.isArray(p.unitsEnd) ? p.unitsEnd : []) {
        // units the sim created during the battle (no board uid) or not on this player's board carry nothing the match uses
        // (the board's operators and summon pieces: 联防 carries an operator's HP ratio and SP, a summon's SP — unite.js)
        if (!u || !Number.isInteger(u.uid) || !own.all.has(u.uid) || seen.has(u.uid)) continue;
        seen.add(u.uid);
        if (!finiteIn(u.hpPct, 0, 1) || !finiteIn(u.sp, 0, 1e5)) return bad('unit state');
        unitsEnd.push({ uid: u.uid, defId: own.all.get(u.uid), hpPct: u.hpPct, sp: u.sp, skillActive: !!u.skillActive, alive: !!u.alive && u.hpPct > 0 });
      }
      const unitStats = [];
      for (const u of Array.isArray(p.unitStats) ? p.unitStats : []) {
        if (!u) continue;
        const onBoard = Number.isInteger(u.uid) && own.all.has(u.uid);
        const defId = onBoard ? own.all.get(u.uid) : (typeof u.defId === 'string' ? u.defId : null);
        if (!defId) continue;
        // a unit created in battle (summon) is one this player's lineup can field — never another player's operator
        if (!onBoard && gd && !own.defIds.has(defId)) continue;
        const rec = gd ? (gd.chess?.(defId) || gd.token?.(defId)) : null;
        if (gd && !rec) continue;
        unitStats.push({
          uid: Number.isInteger(u.uid) ? u.uid : null, defId, name: rec && typeof rec.name === 'string' ? rec.name : defId, kind: u.kind === 'token' ? 'token' : 'op',
          dmg: Math.max(0, Number(u.dmg) || 0), kills: Math.max(0, Math.trunc(Number(u.kills) || 0)), heal: Math.max(0, Number(u.heal) || 0),
          taken: Math.max(0, Number(u.taken) || 0), attacks: Math.max(0, Math.trunc(Number(u.attacks) || 0)),
        });
      }
      const stat = (v) => (finiteIn(v, 0, 1e13) ? v : 0);
      perPlayer[pid] = {
        killed: p.killed, total: p.total, leaked, perfect: countedLeaks === 0, layerGains, coins,
        damageDealt: stat(p.damageDealt), bossDamage: stat(p.bossDamage), healingDone: stat(p.healingDone), deaths: Math.trunc(stat(p.deaths)),
        unitsEnd, unitStats,
      };
    }
    if (coinsSum > B.bountyCoins + 1e-6) return bad('coins');
    const result = { time: raw.time, reason: raw.reason, perPlayer, killed: 0, total: 0, errors: Math.max(0, Math.trunc(Number(raw.errors) || 0)) };
    for (const pid of pids) { result.killed += perPlayer[pid].killed; result.total += perPlayer[pid].total; }
    if (spec.kind === 'unite' && Array.isArray(raw.unspawned)) {
      const unspawned = [];
      for (const u of raw.unspawned) {
        if (!u || typeof u.enemyKey !== 'string' || !B.keyCounts.has(u.enemyKey)) return bad('unspawned');
        const src = typeof u.sourcePlayerId === 'string' && B.sources.has(u.sourcePlayerId) ? u.sourcePlayerId : null;
        if (!takeSource(u.enemyKey, src)) return bad('unspawned source');
        unspawned.push({ enemyKey: u.enemyKey, sourcePlayerId: src, tag: typeof u.tag === 'string' ? u.tag : null, time: Number(u.time) || 0 });
      }
      if (unspawned.length > B.spawnCount) return bad('unspawned');
      if (unspawned.length) result.unspawned = unspawned;
    }
    return { ok: true, result };
  } catch (e) {
    return bad(`exception: ${e && e.message}`);
  }
}
