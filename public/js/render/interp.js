// render/interp.js — snapshot interpolation buffer for battle rendering (pure logic, no PIXI / DOM).
//
// The server streams `b.snap` at ~20 Hz real time; snapshot time `t` is GAME seconds and combat runs at 2×
// real time (DESIGN §4), so the game clock advances `rate` ≈ 2 game-s per real second. The buffer:
//   * keeps ~2 s of snapshots (each indexed id → tuple once, at push time),
//   * estimates `rate` from arrival times (sliding window, clamped, default 2),
//   * runs a render clock `renderT` that trails the newest snapshot by `delay` real seconds (default 100 ms),
//     advancing at `rate` and gently steered back when network jitter pushes it off target (hard snap when it
//     is more than `snapAfter` real seconds off),
//   * extrapolation guard: renderT never runs more than `maxExtrapolate` real seconds past the newest snapshot;
//     positions are extrapolated along the last velocity for at most that long, then freeze,
//   * sample(): per unit, lerps x/y/hp/sp between the two snapshots bracketing renderT; flags/anim come from
//     the older one. A unit missing from the newer snapshot (died/left mid-buffer) holds its last position
//     until renderT reaches the newer snapshot; a unit that only exists in the newer one (spawned mid-buffer)
//     appears when renderT reaches it. Moves longer than `teleport` tiles between two snapshots snap, and so does a
//     unit whose deploy animation starts in between (a redeploy while it stays listed: 乌尔比安's 【移动】, a 突袭 jump).
//   * event queue: a `b.ev` batch is stamped with its game time (`gt`, the snapshot it was drained with); a batch
//     without one is placed inside the latest snapshot interval (newest snapshot time minus half an interval),
//     and handed out by `takeEvents()` once renderT passes the stamp. Stale cosmetic events (> `eventMaxLag`
//     game s behind) are dropped by the caller's choice (`isCosmeticEvent`); state events — an enemy's form fx
//     included — are always delivered, and a full queue sheds only cosmetic ones.
//
// Snapshot tuple layout (DESIGN §8.2): [id, x, y, hp, maxHp, sp, spMax, flags, anim]. Two optional lists ride along
// (server/sim/Battle.js snapshot, user playtest #4 items 8 / 9):
//   * `elem` [[id, element, fill, cooldownEnd, cooldown]] — the element gauge a unit shows: appended to that unit's
//     normalised tuple (EL…EL_DUR) and handed out by sample() as `el`, `elFill`, `elUntil`, `elDur` (from the older
//     snapshot, like flags);
//   * `down` [[id, respawnAt, respawnTime, state, row?, col?]] — knocked-out operators waiting to redeploy (they are no
//     longer in `units`) and the tile they lie on (where they fell, or their home — sim Battle._layBody; kept only when
//     both are integers): downAt(time) returns the list of the snapshot at `time`.
// Game times in both (`cooldownEnd`, `respawnAt`) are on the snapshots' clock, so a view compares them with renderT.

import { fxForm } from '../../../shared/protocol.js';
import { ANIM } from '../../../shared/constants.js';

export const TUPLE = Object.freeze({ ID: 0, X: 1, Y: 2, HP: 3, MAXHP: 4, SP: 5, SPMAX: 6, FLAGS: 7, ANIM: 8, EL: 9, EL_FILL: 10, EL_UNTIL: 11, EL_DUR: 12 });
/** The unit was (re)deployed between tuples `a` and the newer `b`: `b` plays the deploy animation, `a` did not (sim snapshot animOf). */
const redeployed = (a, b) => b[8] === ANIM.DEPLOY && a[8] !== ANIM.DEPLOY;
/** Element keys a snapshot `elem` entry may carry (server/sim/constants.js ELEMENT_ORDER). */
const ELEMENT_KEYS = new Set(['neural', 'erosion', 'burn', 'apoptosis', 'necrosis']);

const MAX_EVENTS = 6000;
const finite = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Cosmetic event kinds that may be dropped when far behind (never state-changing). */
export const COSMETIC_EVENTS = new Set(['atk', 'dmg', 'heal', 'fx', 'layer', 'bounty']);
/**
 * Whether an event may be dropped when stale or shed from a full queue. An 'fx' that carries an enemy's model `form`
 * (shared/protocol.js fxForm) is state: dropping it left the view on the old model after a long main-thread stall, on a
 * watched field after a hidden tab and on a field entered late (user report #5 after 0.1.0) — the fourth place the client
 * keeps it, with battle/runner.js keepsState and screens/game.js keepEarly.
 */
export const isCosmeticEvent = (ev) => Array.isArray(ev) && COSMETIC_EVENTS.has(ev[0]) && fxForm(ev) === undefined;

/**
 * Game time (s) of a b.snap / b.ev payload, or NaN. On the wire every frame is `{ t: '<type>', … }`, so the server
 * sends the game time as `gt` (server/match/fields.js snapFrame); raw Battle snapshots and the demo recordings
 * carry it as a numeric `t`. This is the only place that conversion happens.
 */
export function frameTime(msg) {
  if (!msg || typeof msg !== 'object') return NaN;
  const t = typeof msg.gt === 'number' ? msg.gt : msg.t;
  return typeof t === 'number' && Number.isFinite(t) ? t : NaN;
}

/**
 * Validate & normalise a b.snap payload. Returns `{ t, units: Map<id, tuple>, down: [[id, respawnAt, respawnTime,
 * state, row?, col?]] | null, raw }` or null when unusable. Tuples with a non-finite id/x/y are skipped; other numbers default
 * to 0; a unit's `elem` entry (see header) is appended to its tuple; malformed `elem` / `down` entries are dropped.
 */
export function normalizeSnapshot(snap) {
  if (!snap || typeof snap !== 'object') return null;
  const t = frameTime(snap);
  if (!Number.isFinite(t)) return null;
  const units = new Map();
  const list = Array.isArray(snap.units) ? snap.units : [];
  for (const u of list) {
    if (!Array.isArray(u) || u.length < 3) continue;
    const id = u[0];
    if (!(typeof id === 'number' || typeof id === 'string')) continue;
    const x = u[1], y = u[2];
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    units.set(id, [id, x, y, finite(u[3]), finite(u[4]), finite(u[5]), finite(u[6]), finite(u[7]) | 0, finite(u[8]) | 0]);
  }
  if (Array.isArray(snap.elem)) {
    for (const e of snap.elem) {
      if (!Array.isArray(e) || !ELEMENT_KEYS.has(e[1])) continue;
      const tu = units.get(e[0]);
      if (tu && tu.length === 9) tu.push(e[1], clamp(finite(e[2]), 0, 1), finite(e[3]), Math.max(0, finite(e[4])));
    }
  }
  let down = null;
  if (Array.isArray(snap.down)) {
    for (const d of snap.down) {
      if (!Array.isArray(d) || !(typeof d[0] === 'number' || typeof d[0] === 'string')) continue;
      const e = [d[0], finite(d[1]), Math.max(0, finite(d[2])), finite(d[3]) | 0];
      if (Number.isInteger(d[4]) && Number.isInteger(d[5])) e.push(d[4], d[5]);
      (down || (down = [])).push(e);
    }
  }
  return { t, units, down, raw: snap };
}

export class SnapshotBuffer {
  /**
   * @param {{ delay?: number, rate?: number, maxExtrapolate?: number, keep?: number, teleport?: number,
   *           snapAfter?: number, minRate?: number, maxRate?: number }} [opts]
   *   delay / maxExtrapolate / snapAfter / keep are REAL seconds.
   */
  constructor(options) {
    const opts = options && typeof options === 'object' ? options : {};
    this.delay = Math.max(0, finite(opts.delay, 0.1));
    this.defaultRate = clamp(finite(opts.rate, 2), 0.05, 20);
    this.minRate = finite(opts.minRate, 0.25);
    this.maxRate = finite(opts.maxRate, 8);
    this.maxExtrapolate = Math.max(0, finite(opts.maxExtrapolate, 0.12));
    this.keep = Math.max(0.5, finite(opts.keep, 2.5));
    this.teleport = Math.max(0.5, finite(opts.teleport, 2.5));
    this.snapAfter = Math.max(0.2, finite(opts.snapAfter, 0.75));
    this.reset();
  }

  reset() {
    /** @type {{t:number, units:Map<any, any[]>, raw:any, at:number}[]} ascending by t */
    this.snaps = [];
    /** @type {{t:number, at:number}[]} arrival log for rate estimation */
    this.arrivals = [];
    this.rate = this.defaultRate;
    this.renderT = NaN;
    this.lastNow = NaN;
    this.interval = 0.1 * this.defaultRate / 2; // game s between snapshots (estimated)
    /** @type {{t:number, ev:any}[]} */
    this.events = [];
    this.meta = null; // latest snapshot's extra fields (dp, killed, total, boss…)
    return this;
  }

  get newestT() { return this.snaps.length ? this.snaps[this.snaps.length - 1].t : NaN; }
  get oldestT() { return this.snaps.length ? this.snaps[0].t : NaN; }
  get size() { return this.snaps.length; }

  /**
   * Add a snapshot received at real time `now` (seconds). Out-of-order / duplicate snapshots are dropped;
   * a snapshot far older than the newest (a server-side reset, e.g. a new battle) resets the buffer.
   * @returns {boolean} accepted
   */
  push(snap, now) {
    const s = normalizeSnapshot(snap);
    if (!s) return false;
    now = finite(now, this.lastNow || 0);
    const newest = this.newestT;
    if (this.snaps.length) {
      if (s.t < newest - 5) this.reset(); // the server restarted the stream (new battle): old events are obsolete
      else if (s.t <= newest) return false;
    }
    s.at = now;
    const prev = this.snaps[this.snaps.length - 1];
    if (prev) {
      const dt = s.t - prev.t;
      if (dt > 0 && dt < 2) this.interval = this.interval * 0.8 + dt * 0.2;
    }
    this.snaps.push(s);
    this.meta = s.raw;
    // rate estimate over a ~1.5 s window of arrivals
    this.arrivals.push({ t: s.t, at: now });
    while (this.arrivals.length > 2 && now - this.arrivals[0].at > 1.5) this.arrivals.shift();
    if (this.arrivals.length >= 4) {
      const a = this.arrivals[0], b = this.arrivals[this.arrivals.length - 1];
      const dReal = b.at - a.at, dGame = b.t - a.t;
      if (dReal > 0.2 && dGame > 0) this.rate = clamp(this.rate * 0.7 + (dGame / dReal) * 0.3, this.minRate, this.maxRate);
    }
    // trim old snapshots (keep at least 2). Trimming never waits for the render clock: while the page is hidden
    // (no animation frames) snapshots keep arriving and must not pile up; a clock left behind is clamped.
    const horizon = s.t - this.keep * this.rate;
    while (this.snaps.length > 2 && this.snaps[1].t < horizon) this.snaps.shift();
    if (!Number.isFinite(this.renderT)) this.renderT = Math.max(this.snaps[0].t, s.t - this.delay * this.rate);
    else if (this.renderT < this.snaps[0].t) this.renderT = this.snaps[0].t;
    return true;
  }

  /**
   * Queue a b.ev batch. `t` (game s, the frame's `gt`) when the server stamps it; otherwise the batch is placed
   * inside the latest snapshot interval (see header).
   */
  pushEvents(evs, now, t) {
    if (!Array.isArray(evs) || !evs.length) return 0;
    let stamp = typeof t === 'number' && Number.isFinite(t) ? t : NaN;
    if (!Number.isFinite(stamp)) {
      const n = this.newestT;
      stamp = Number.isFinite(n) ? n - this.interval * 0.5 : (Number.isFinite(this.renderT) ? this.renderT : 0);
    }
    let added = 0;
    for (const ev of evs) {
      if (!Array.isArray(ev) || typeof ev[0] !== 'string') continue;
      this.events.push({ t: stamp, ev });
      added++;
    }
    // bounded queue (hidden tab: nothing consumes it) — shed the oldest cosmetic events first
    if (this.events.length > MAX_EVENTS) {
      const keep = [];
      const excess = this.events.length - MAX_EVENTS;
      let shed = 0;
      for (const e of this.events) {
        if (shed < excess && isCosmeticEvent(e.ev)) { shed++; continue; }
        keep.push(e);
      }
      this.events = keep.length > MAX_EVENTS * 2 ? keep.slice(keep.length - MAX_EVENTS * 2) : keep;
    }
    // keep sorted (batches normally arrive in order; a server stamp may be older)
    if (this.events.length > 1 && this.events[this.events.length - 1].t < this.events[this.events.length - 1 - added]?.t) {
      this.events.sort((a, b) => a.t - b.t);
    }
    return added;
  }

  /**
   * Advance the render clock to real time `now` (seconds). Returns renderT (NaN until the first snapshot).
   */
  update(now) {
    now = finite(now, 0);
    if (!this.snaps.length) { this.lastNow = now; return NaN; }
    const dt = Number.isFinite(this.lastNow) ? clamp(now - this.lastNow, 0, 1) : 0;
    this.lastNow = now;
    const newest = this.newestT;
    const target = newest - this.delay * this.rate;
    if (!Number.isFinite(this.renderT)) this.renderT = target;
    this.renderT += dt * this.rate;
    const err = target - this.renderT;
    if (Math.abs(err) > this.snapAfter * this.rate) this.renderT = target;
    else this.renderT += err * Math.min(1, dt * 3);
    const cap = newest + this.maxExtrapolate * this.rate;
    if (this.renderT > cap) this.renderT = cap;
    if (this.renderT < this.snaps[0].t) this.renderT = this.snaps[0].t;
    return this.renderT;
  }

  /** Jump the render clock to the newest snapshot (scrubbing / first frame after a reset). */
  snapToNewest() {
    if (this.snaps.length) this.renderT = this.newestT;
    return this.renderT;
  }

  /** Index of the newest snapshot with t ≤ time (−1 when time is before all). */
  _indexAt(time) {
    const s = this.snaps;
    let lo = 0, hi = s.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (s[mid].t <= time) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }

  /**
   * The `down` list (knocked-out operators waiting to redeploy, see header) of the snapshot shown at `time` (default
   * renderT) — the same snapshot sample() reads flags from — or null.
   */
  downAt(time = this.renderT) {
    const s = this.snaps;
    if (!s.length || !Number.isFinite(time)) return null;
    const ia = this._indexAt(time);
    return s[ia < 0 ? 0 : ia].down || null;
  }

  /**
   * Interpolated state at `time` (default renderT). Fills and returns `out` (a Map id → sample object reused
   * across calls: `{ id, x, y, hp, maxHp, sp, spMax, flags, anim, vx, vy, seen, el, elFill, elUntil, elDur }` —
   * `el` = the shown element gauge (null: none), see header). Samples of units no longer present are deleted from `out`.
   */
  sample(time = this.renderT, out = new Map()) {
    const s = this.snaps;
    if (!s.length || !Number.isFinite(time)) { out.clear(); return out; }
    let ia = this._indexAt(time);
    if (ia < 0) ia = 0;
    const A = s[ia];
    const B = ia + 1 < s.length ? s[ia + 1] : null;
    const span = B ? B.t - A.t : 0;
    const alpha = B && span > 0 ? clamp((time - A.t) / span, 0, 1) : 0;
    const P = !B && ia > 0 ? s[ia - 1] : null; // for extrapolation
    const ext = !B ? clamp(time - A.t, 0, this.maxExtrapolate * this.rate) : 0;
    const stamp = A.t;
    for (const [id, a] of A.units) {
      let o = out.get(id);
      if (!o) { o = { id, x: 0, y: 0, hp: 0, maxHp: 0, sp: 0, spMax: 0, flags: 0, anim: 0, vx: 0, vy: 0, seen: 0, el: null, elFill: 0, elUntil: 0, elDur: 0 }; out.set(id, o); }
      const b = B ? B.units.get(id) : null;
      if (b) {
        const dx = b[1] - a[1], dy = b[2] - a[2];
        // (a deployment in between — the newer snapshot starts its deploy animation — lands on its tile, no slide)
        const tele = dx * dx + dy * dy > this.teleport * this.teleport || redeployed(a, b);
        o.x = tele ? (alpha < 1 ? a[1] : b[1]) : a[1] + dx * alpha;
        o.y = tele ? (alpha < 1 ? a[2] : b[2]) : a[2] + dy * alpha;
        o.vx = !tele && span > 0 ? dx / span : 0;
        o.vy = !tele && span > 0 ? dy / span : 0;
        o.hp = a[3] + (b[3] - a[3]) * alpha;
        o.maxHp = b[4] || a[4];
        o.sp = a[5] + (b[5] - a[5]) * alpha;
        o.spMax = b[6] || a[6];
      } else {
        let vx = 0, vy = 0;
        if (P && ext > 0) {
          const p = P.units.get(id);
          const dtp = A.t - P.t;
          if (p && dtp > 0) {
            vx = (a[1] - p[1]) / dtp; vy = (a[2] - p[2]) / dtp;
            if (vx * vx + vy * vy > (this.teleport / dtp) ** 2 || redeployed(p, a)) { vx = 0; vy = 0; }
          }
        }
        o.x = a[1] + vx * ext;
        o.y = a[2] + vy * ext;
        o.vx = vx; o.vy = vy;
        o.hp = a[3]; o.maxHp = a[4]; o.sp = a[5]; o.spMax = a[6];
      }
      // the sim rounds hp up and maxHp to nearest, so a snapshot may say hp = maxHp + 1
      if (o.hp > o.maxHp && o.maxHp > 0) o.hp = o.maxHp;
      else if (!(o.hp > 0)) o.hp = 0;
      o.flags = a[7];
      o.anim = a[8];
      if (a.length > 9) { o.el = a[9]; o.elFill = a[10]; o.elUntil = a[11]; o.elDur = a[12]; } else if (o.el !== null) { o.el = null; o.elFill = 0; o.elUntil = 0; o.elDur = 0; }
      o.seen = stamp;
    }
    for (const id of out.keys()) if (!A.units.has(id)) out.delete(id);
    return out;
  }

  /**
   * Remove and return (in order) the queued events due at `time` (default renderT). When `dropCosmeticBefore`
   * is a number, cosmetic events stamped earlier than it are discarded instead of returned; a state event stamped
   * earlier is returned, and when `late` (a Map) is given it records that event → how far (game s) its stamp lies
   * before `time`, so the caller can skip its stale cosmetics (render/app.js: a late form fx switches the model without
   * replaying its telegraph and with its closing clip shortened).
   */
  takeEvents(time = this.renderT, out = [], dropCosmeticBefore = null, late = null) {
    if (!this.events.length || !Number.isFinite(time)) return out;
    let n = 0;
    while (n < this.events.length && this.events[n].t <= time) n++;
    if (!n) return out;
    const list = this.events;
    for (let i = 0; i < n; i++) {
      const e = list[i];
      if (typeof dropCosmeticBefore === 'number' && e.t < dropCosmeticBefore) {
        if (isCosmeticEvent(e.ev)) continue;
        if (late) late.set(e.ev, time - e.t);
      }
      out.push(e.ev);
    }
    const rest = list.length - n;
    list.copyWithin(0, n);
    list.length = rest;
    return out;
  }

  /**
   * Look ahead: call `fn(ev, t)` for every queued event stamped in (from, to] (ascending; nothing is removed).
   * Lets the renderer start animations that must peak when an event becomes due (attack wind-ups).
   */
  forEachUpcoming(from, to, fn) {
    const list = this.events;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.t > to) break;
      if (e.t > from) fn(e.ev, e.t);
    }
  }

  /** Deliver every queued event now (used before a reset so state events are not lost). */
  flushEvents(out = []) {
    for (const e of this.events) out.push(e.ev);
    this.events.length = 0;
    return out;
  }
}
