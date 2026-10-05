// Local battle runner — client-side combat (DESIGN §14, research 09 §3.2 / §6.4).
//
// Like the official client, the browser simulates battles itself with the shared deterministic sim (server/sim,
// served read-only at /sim/). The server sends a JSON BattleSpec (`b.start`); this module builds the Battle with
// /sim/spec.js createBattleFromSpec and
//   * steps it at the battle speed (fixed 1/30 s ticks, 2× → 60 ticks per real second; at most
//     max(8, 4·speed) ticks per animation frame, bounded fast-forward up to CATCHUP_TICKS per frame when it is far
//     behind: a reconnect, observing a running field, a tab back from the background),
//   * feeds the render engine every frame through the same wire formats the server used to stream
//     (`snap` = b.snap frame from battle.snapshot(), `ev` = b.ev frame from battle.drainEvents()) and publishes the
//     field meta (m.field shape) into store.match.field so the game screen enters the battle,
//   * when authoritative: reports b.progress (~1 Hz; boss fields 4 Hz with the shared-pool damage and the LP meter)
//     and b.result (compactResult) at the end; applies b.pool (LocalBossPool.sync) and b.end (forceEnd / takeover),
//   * keeps an authoritative battle running while the tab is hidden (a 250 ms interval pump; browsers throttle it to
//     ~1 Hz, the bounded fast-forward absorbs that); the server deadline + takeover cover anything worse.
// A frame that fast-forwards (catch-up) passes on only the state-bearing events (keepsState: spawns, deaths, deploys,
// statuses, skills, leaks and the fx that change an enemy's model form — shared/protocol.js fxForm); while the tab is
// hidden the battle on screen keeps the same events (compacted past HELD_MAX; a backlog still past it makes the view
// re-enter from the field meta) and the first frame back delivers them — or, for a battle that ended while hidden, the
// visibilitychange itself — so the view still knows every unit and every enemy's current form (player report #5 after
// 0.1.0: a 转译基底·α that changed form during a stall or in a background tab died in its first-form model). Such a
// frame or step covers seconds of play, so it drains the events every EV_SLICE ticks and each batch keeps its own game
// time (`gt`): the render engine then knows how late a form fx is and skips a change clip that has already ended.
// Display replicas (a teammate's field after the own battle, 联防 observers, the partner of a boss pair) run the same
// spec fast-forwarded to the server's clock (`elapsed`) and never report.
// A b.result lost with the socket (the request failed DISCONNECTED / OFFLINE, or timed out twice) is kept and sent
// again when the session is back online ('status' → 'online') or when a b.start still names this finished battle
// authoritative (the server is waiting for it); the server takes a duplicate idempotently. A server refusal is final.
// Solo pause (g.pause, DESIGN §14): while `m.public.paused` is true every local battle clock stands still (no ticks, no
// reports); on resume the clocks move on by the paused time, like the server's field clock.
// Live leaks (user playtest #3 item 2): every normal field simulated here keeps its counted leaks so far — the settle
// rule's count (leaked entries with counted !== false, /sim/spec.js battleProgress) — and publishes them as
// state().leaks { [fieldId]: n } whenever one changes, authoritative or display replica alike; the top bar shows the
// own field's min(lpCapPerRound, n) as the LP about to be lost (ui/hud.js liveLp). A 联防 field keeps each leaker's
// enemies still standing (/sim/spec.js uniteLeft; user playtest #6 item 7) as state().uniteLeft { [playerId]: n },
// published whenever it changes (it falls as the helpers kill them), and its authority reports it as b.progress `left`.
// Live bond layers (DESIGN §20.15): every battle simulated here keeps the bonds whose layers grew in it (IN_BATTLE gains,
// Battle.addLayers — normal battles only) as absolute counts per player, published as state().bondLayers
// { [playerId]: { [bondId]: n } } (every battle of the round: the own one, the teammates' replicas) whenever one grows;
// the bond strip of the player on screen — the own one, or a watched teammate's — shows them live (ui/watchBonds.js).
//
// The sim (≈ 0.2–1 ms per tick) runs on the main thread: one battle at a time is stepped for display (plus an
// authoritative one if it is not the one on screen). stats() exposes the measured cost.
//
//   import { battleRunner } from './battle/runner.js'     (browser singleton wired to net.js + store.js; null in Node)
//   battleRunner.on('snap' | 'ev' | 'field' | 'state', fn) → off
//   battleRunner.state()  → { battleId, fieldId, kind, authoritative, watch, done, own, members, loading, paused, leaks,
//                              uniteLeft, bondLayers } | null
//   battleRunner.stats()  → { ticks, stepMs, avgTickMs, maxFrameMs, catchups, errors, battles }
//   battleRunner.unitStats(unitId, fieldId?) → the live stats of a unit of the battle on screen (shared/protocol.js
//                           unitStatsEntry: current HP, effective max HP / ATK / DEF / RES / interval / block / move
//                           speed next to its base; an ally also its live attack range `range` — unit.liveRangeGrid,
//                           facing RIGHT, never a kit's target-selection grid) | null — the detail card reads it a few
//                           times a second (user playtest #4 item 7; the range mini-map, community report E1 after
//                           0.1.0). Read-only: it takes the stats the sim computed last (`unit._s`) and the range grid it
//                           keeps, and never makes the unit recompute them, so looking never changes the battle's floats.
//   battleRunner.unitIdOf(uid, ownerId, fieldId?) → the id of an own board piece's unit in that battle | null
//   battleRunner.ownerOps(ownerId, fieldId?) → [{ kind: 'op', ownerId, defId, items? }] that player's operators in the
//                           battle on screen with their equipment (a teammate's bond popup: the members in play, DESIGN
//                           §20.15, 变形同构体 wearers included) | []
//
// createBattleRunner(deps) builds an instance with injectable net / store / clock / frame scheduler / sim loader
// (test/match/runner.test.js drives it under Node).

import { net as appNet } from '../net.js';
import { store as appStore } from '../store.js';
import { unitStatsEntry, fxForm } from '../../../shared/protocol.js';
import { spectateEffects } from './observe.js';

const TICK = 1 / 30;
/** Fast-forward budget per frame (ticks) when far behind. */
export const CATCHUP_TICKS = 240;
/** Silent catch-up slice (ticks) while a new battle is prepared before it is shown. */
const PREPARE_SLICE = 600;
const MAX_ENTRIES = 4;
const STATE_EV = new Set(['spawn', 'die', 'deploy', 'status', 'skill', 'leak']);
/**
 * The b.ev tuples a catch-up frame or the hidden-tab backlog keeps: the state-bearing kinds, and every fx that sets an
 * enemy's model form (shared/protocol.js fxForm — dropped, the view kept the old model: player report #5 after 0.1.0).
 */
export const keepsState = (x) => Array.isArray(x) && (STATE_EV.has(x[0]) || fxForm(x) !== undefined);
/**
 * Hidden-tab backlog cap (tuples) of the battle on screen. Past it the backlog is compacted (compactHeld: only the last
 * 'status' per unit and status, the last 'skill' per unit — what the view ends up showing); only a backlog still past it
 * (thousands of spawns) makes the view re-enter from the field meta.
 */
export const HELD_MAX = 3000;
/**
 * Ticks per event batch of a step that covers more than one frame of play (a catch-up frame of up to CATCHUP_TICKS, a
 * hidden-tab step): its events are drained every EV_SLICE ticks and stamped with that game time, not the frame's.
 */
export const EV_SLICE = 15;

/**
 * A hidden-tab backlog without the superseded toggles: of the 'status' tuples only the last per (unit, status), of the
 * 'skill' tuples only the last per unit, every other tuple (spawn / die / deploy / leak / form fx — bounded by the units)
 * kept; order preserved. A long hidden boss fight toggles statuses thousands of times, the rest stays small.
 */
export function compactHeld(list) {
  const last = new Map();
  list.forEach((x, i) => {
    if (x[0] === 'status') last.set(`s:${x[1]}:${x[2]}`, i);
    else if (x[0] === 'skill') last.set(`k:${x[1]}`, i);
  });
  return list.filter((x, i) => (x[0] === 'status' ? last.get(`s:${x[1]}:${x[2]}`) === i : x[0] === 'skill' ? last.get(`k:${x[1]}`) === i : true));
}
/** Data files the simulation reads (DataSource + content/support gameData()). */
export const SIM_DATA_FILES = Object.freeze(['chess', 'enemies', 'tokens', 'stages', 'waves', 'bonds', 'items', 'garrisons', 'bands', 'effects']);

/** Request failures after which a b.result counts as never delivered (re-sent on resume / b.start). */
export const LOST_RESULT_CODES = Object.freeze(['DISCONNECTED', 'OFFLINE', 'TIMEOUT']);

/** Ticks per frame at a speed (same cap as the server pacing: server/match/fields.js maxTicksPerInterval). */
export const ticksPerFrameCap = (speed) => Math.max(8, Math.ceil((Number(speed) || 2) * 4));

function deepFreeze(root) {
  const stack = [root];
  while (stack.length) {
    const o = stack.pop();
    if (o === null || typeof o !== 'object' || Object.isFrozen(o)) continue;
    Object.freeze(o);
    for (const v of Object.values(o)) if (v !== null && typeof v === 'object') stack.push(v);
  }
  return root;
}

/**
 * Browser sim loader: the /sim/ modules + the data files (own frozen copies — the server's data is frozen too, so a
 * content bug that writes into a record fails identically on both sides).
 */
export async function loadBrowserSim({ base = '/sim/', dataBase = '/data/', fetchFn = (...a) => globalThis.fetch(...a) } = {}) {
  const [spec, simdata, support] = await Promise.all([
    import(`${base}spec.js`), import(`${base}simdata.js`), import(`${base}content/support/index.js`),
  ]);
  const fetchOnce = async (n) => {
    try {
      const res = await fetchFn(`${dataBase}${n}.json`, { cache: 'no-cache' });
      return res && res.ok ? await res.json() : null;
    } catch { return null; }
  };
  const files = await Promise.all(SIM_DATA_FILES.map(async (n) => (await fetchOnce(n)) ?? fetchOnce(n)));
  // a battle simulated without part of the data would still produce a plausible result the server accepts: never run
  // one — the loader fails (the next b.start retries it; meanwhile the server's deadline takes the field over)
  const missing = SIM_DATA_FILES.filter((n, i) => !files[i] || typeof files[i] !== 'object');
  if (missing.length) throw new Error(`simulation data unavailable: ${missing.join(', ')}`);
  const raw = {};
  SIM_DATA_FILES.forEach((n, i) => { raw[n] = deepFreeze(files[i]); });
  simdata.setSimData(raw);
  if (typeof support.setGameData === 'function') support.setGameData(null); // re-read through the injected data
  return { spec, ds: new simdata.DataSource(raw, null) };
}

/** Battle logger: content errors are isolated by the sim; report them as warnings (the server logs its own). */
const SIM_LOGGER = Object.freeze({
  error: (...a) => console.warn('[sim]', ...a),
  warn: (...a) => console.warn('[sim]', ...a),
  info() {},
  debug() {},
});

/**
 * @param {{ net: any, store: any, loadSim?: () => Promise<{ spec: any, ds: any }>, now?: () => number,
 *   raf?: (fn: (t: number) => void) => any, caf?: (h: any) => void, setInterval?: Function, clearInterval?: Function,
 *   doc?: { hidden?: boolean, addEventListener?: Function } | null, logger?: object }} deps
 */
export function createBattleRunner(deps) {
  const net = deps.net;
  const store = deps.store;
  const now = deps.now || (() => (globalThis.performance ? performance.now() : Date.now()));
  const raf = deps.raf || ((fn) => globalThis.requestAnimationFrame(fn));
  const caf = deps.caf || ((h) => globalThis.cancelAnimationFrame(h));
  const setIv = deps.setInterval || ((fn, ms) => globalThis.setInterval(fn, ms));
  const clearIv = deps.clearInterval || ((h) => globalThis.clearInterval(h));
  const doc = deps.doc !== undefined ? deps.doc : (typeof document !== 'undefined' ? document : null);
  const loadSim = deps.loadSim || (() => loadBrowserSim());
  const logger = deps.logger || SIM_LOGGER;

  const listeners = new Map();
  const emit = (type, payload) => {
    const set = listeners.get(type);
    if (!set) return;
    for (const fn of [...set]) {
      try { fn(payload); } catch (err) { console.warn(`[runner] ${type} listener failed`, err); }
    }
  };

  /** @type {Map<string, any>} battleId → entry */
  const entries = new Map();
  let cur = null;              // entry on screen
  let simP = null;
  let startSeq = 0;
  let loading = null;          // b.start being prepared
  let rafH = null;
  let ivH = null;
  let lastPool = null;
  /** solo pause: the runner clock's instant when m.public.paused turned true (null while running) */
  let pausedAt = null;
  /** a normal field's leak count (or a battle's bond layers) changed since the last publishState() */
  let leaksDirty = false;
  const stats = { ticks: 0, stepMs: 0, maxFrameMs: 0, catchups: 0, errors: 0, battles: 0, frames: 0 };
  /** Hidden-tab backlog tuple → the game time it was drained at (emitFrame batches the backlog by it). */
  const heldAt = new WeakMap();

  const hidden = () => !!(doc && doc.hidden);
  /** The battle clock: frozen at the pause instant while the solo battle is paused. */
  const clock = () => (pausedAt != null ? pausedAt : now());
  const bossLike = (e) => e.kind === 'boss' || e.kind === 'hidden';

  function ensureSim() {
    if (!simP) {
      simP = loadSim().catch((err) => { simP = null; throw err; });
    }
    return simP;
  }

  /** Counted leaks so far of every normal field simulated here: { [fieldId]: n } (user playtest #3 item 2). */
  function leakMap() {
    const out = {};
    for (const e of entries.values()) if (e.kind === 'normal' && e.fieldId) out[e.fieldId] = e.leaks;
    return out;
  }

  /**
   * Live bond layers of every battle simulated here (DESIGN §20.15): { [playerId]: { [bondId]: n } } — only the bonds
   * whose layers grew in this round's battle, as absolute counts (the battle's live copy, ≤ BOND_LAYER_CAP).
   */
  function layerMap() {
    const out = {};
    for (const e of entries.values()) {
      if (!e.live) continue;
      for (const [pid, m] of Object.entries(e.live)) out[pid] = { ...(out[pid] || {}), ...m };
    }
    return out;
  }

  /**
   * The 联防 field on screen (never an older round's kept entry, nor while a new battle is being prepared): each
   * leaker's enemies still standing { [playerId]: n } (absent = none left), else null.
   */
  function uniteLeftMap() {
    const e = cur;
    return !loading && e && e.kind === 'unite' && e.left ? { ...e.left } : null;
  }

  function state() {
    const e = cur;
    if (!e) return loading ? { loading: true, battleId: loading.battleId, fieldId: loading.fieldId, kind: loading.kind, leaks: leakMap(), uniteLeft: uniteLeftMap(), bondLayers: layerMap() } : null;
    return {
      battleId: e.battleId, fieldId: e.fieldId, kind: e.kind, authoritative: e.authoritative, watch: e.watch,
      done: e.done, own: e.own, members: e.members.slice(), loading: !!loading, speed: e.speed, paused: pausedAt != null,
      leaks: leakMap(), uniteLeft: uniteLeftMap(), bondLayers: layerMap(),
    };
  }

  function publishState() {
    leaksDirty = false;
    const s = state();
    try { store.patch('match', { battle: s }); } catch { /* store without a match slice */ }
    emit('state', s);
  }

  /**
   * Re-count an entry's leaks when its battle recorded a new one (Battle.leakedCount) or ended (timeout leaks, and the
   * final result): the settle rule's count, leaked entries with counted !== false (/sim/spec.js battleProgress).
   * 联防: each leaker's enemies still standing (/sim/spec.js uniteLeft) whenever a kill, a leak, a spawn or the end
   * changed them.
   */
  function noteLeaks(e) {
    noteLayers(e);
    if (e.kind === 'unite') { noteUniteLeft(e); return; }
    if (e.kind !== 'normal') return;
    const b = e.battle;
    const mark = `${Number(b.leakedCount) || 0}:${b.finished ? 1 : 0}`;
    if (mark === e.leakMark) return;
    e.leakMark = mark;
    let n = e.leaks;
    try { n = Math.max(0, Math.trunc(Number(e.sim.spec.battleProgress(b).leaks) || 0)); } catch { /* keep the last count */ }
    if (n !== e.leaks) { e.leaks = n; leaksDirty = true; }
  }

  function noteUniteLeft(e) {
    const b = e.battle;
    const mark = `${Number(b.killed) || 0}:${Number(b.leakedCount) || 0}:${Number(b.total) || 0}:${b.finished ? 1 : 0}`;
    if (mark === e.leakMark) return;
    e.leakMark = mark;
    let left = e.left;
    try { left = e.sim.spec.uniteLeft(b) || left; } catch { /* keep the last count */ }
    if (JSON.stringify(left) !== JSON.stringify(e.left)) { e.left = left; leaksDirty = true; }
  }

  /**
   * Re-read an entry's live bond layers (DESIGN §20.15): per player of its spec, the bonds whose layers in the battle's
   * live copy (Battle.addLayers, clamped at BOND_LAYER_CAP like the client's AddBondCount) exceed the spec's start
   * count. Nothing to do when the battle disables gains (联防, boss rounds).
   */
  function noteLayers(e) {
    const b = e.battle;
    if (!b || (b.flags && b.flags.layerGainsEnabled === false) || typeof b.getPlayer !== 'function') return;
    let sum = 0;
    let live = null;
    for (const sp of Array.isArray(e.spec.players) ? e.spec.players : []) {
      const ps = sp && sp.playerId != null ? b.getPlayer(sp.playerId) : null;
      if (!ps || !ps.bonds || typeof ps.bonds !== 'object') continue;
      const start = sp.bonds && typeof sp.bonds === 'object' ? sp.bonds : {};
      for (const id of Object.keys(ps.bonds)) {
        const n = Number(ps.bonds[id] && ps.bonds[id].layers) || 0;
        const from = Number(start[id] && start[id].layers) || 0;
        if (!(n > from)) continue;
        sum += n - from;
        if (!live) live = {};
        if (!live[sp.playerId]) live[sp.playerId] = {};
        live[sp.playerId][id] = n;
      }
    }
    if (sum === e.layerSum) return;
    e.layerSum = sum;
    e.live = live;
    leaksDirty = true;
  }

  /** Publish the state when a leak count (or a battle's bond layers) changed since the last publish. */
  function flushLeaks() { if (leaksDirty) publishState(); }

  /** Target tick of an entry on its clock. */
  const targetTick = (e, t) => Math.max(0, Math.floor((((t - e.t0) / 1000) * e.speed) / TICK + 1e-9));

  /**
   * Step `n` ticks. `sliced` (a catch-up frame, a hidden-tab step): every EV_SLICE ticks the events drained so far go to
   * `e.slices` as { gt, ev } with that game time, for emitFrame / hold.
   */
  function stepEntry(e, n, sliced = false) {
    const b = e.battle;
    const t = now();
    let k = 0;
    try {
      for (; k < n && !b.finished; k++) {
        b.step();
        if (sliced && (k + 1) % EV_SLICE === 0 && k + 1 < n) {
          const ev = b.drainEvents() || [];
          if (ev.length) e.slices.push({ gt: Number(b.time) || 0, ev });
        }
      }
    } catch (err) {
      stats.errors++;
      console.warn('[runner] battle step failed', err);
      try { b.forceEnd('timeout'); } catch { /* ignore */ }
    }
    const dt = now() - t;
    stats.ticks += k;
    stats.stepMs += dt;
    return dt;
  }

  function frameOf(e) {
    const snap = e.battle.snapshot();
    const { t: gt, ...rest } = snap || {};
    return { ...rest, t: 'b.snap', fieldId: e.fieldId, gt: Number.isFinite(gt) ? gt : 0 };
  }

  /** The steps' events, each batch with its own game time: the sliced ones (stepEntry), then the rest at `gt`. */
  function drainSlices(e, gt) {
    let ev = [];
    try { ev = e.battle.drainEvents() || []; } catch { ev = []; }
    const out = e.slices;
    e.slices = [];
    if (ev.length) out.push({ gt, ev });
    return out;
  }

  function emitFrame(e, catchingUp) {
    // the hidden-tab backlog overflowed: the view starts again from the field meta (UnitInfo carries every unit's form)
    if (e.stale) { show(e); return; }
    const gt = Number(e.battle.time) || 0;
    // the hidden-tab backlog first, batched by the game time each tuple was drained at (a tuple put there by hand: now)
    const held = e.held;
    if (held.length) e.held = [];
    let run = null;
    for (const x of held) {
      const at = heldAt.get(x) ?? gt;
      if (!run || run.gt !== at) { if (run) emit('ev', run); run = { t: 'b.ev', fieldId: e.fieldId, gt: at, ev: [] }; }
      run.ev.push(x);
    }
    if (run) emit('ev', run);
    for (const s of drainSlices(e, gt)) {
      const list = catchingUp ? s.ev.filter(keepsState) : s.ev;
      if (list.length) emit('ev', { t: 'b.ev', fieldId: e.fieldId, gt: s.gt, ev: list });
    }
    try { emit('snap', frameOf(e)); } catch (err) { console.warn('[runner] snapshot failed', err); }
  }

  /**
   * Events of a step that is not rendered (hidden tab): the battle on screen keeps its state-bearing ones for the next
   * rendered frame (keepsState, ≤ HELD_MAX — beyond that it is re-entered from the field meta); any other battle starts
   * from its field meta when shown (show()), so its events go.
   */
  function hold(e) {
    const batches = drainSlices(e, Number(e.battle.time) || 0);
    if (e !== cur || e.stale) return;
    for (const s of batches) for (const x of s.ev) if (keepsState(x)) { e.held.push(x); heldAt.set(x, s.gt); }
    if (e.held.length > HELD_MAX) {
      e.held = compactHeld(e.held);
      if (e.held.length > HELD_MAX) { e.held = []; e.stale = true; }
    }
  }

  /**
   * The tab is visible again: the battle on screen that ended while it was hidden (advance() no longer runs for it)
   * delivers its backlog and last snapshot now — else the view kept the pre-hide state for the rest of the phase.
   */
  function flushHidden() {
    const e = cur;
    if (e && e.battle.finished && (e.held.length || e.stale)) emitFrame(e, false);
  }

  function progress(e, force = false) {
    if (!e.authoritative || e.resultSent || !net) return;
    const t = now();
    const every = bossLike(e) ? 250 : 1000;
    if (!force && t - e.lastProgressAt < every) return;
    e.lastProgressAt = t;
    const p = e.sim.spec.battleProgress(e.battle);
    const msg = { battleId: e.battleId, gt: Math.min(1e5, p.gt), killed: Math.min(p.killed, p.total), total: Math.min(1e5, p.total), done: !!p.done };
    if (bossLike(e)) {
      const pool = e.battle.sharedBoss;
      msg.leaks = Math.min(1e6, e.meter.lp);
      msg.bossDmg = pool && Number.isFinite(pool.cum) ? pool.cum : 0;
      if (pool && pool.byPlayer) {
        const by = {};
        for (const pid of Object.keys(pool.byPlayer).slice(0, 4)) by[pid] = pool.byPlayer[pid];
        msg.by = by;
      }
    } else {
      msg.leaks = Math.min(1e6, p.leaks);
      // 联防: the leakers' enemies still standing (shared/protocol.js b.progress `left`, ≤ 4 players)
      if (p.left) msg.left = Object.fromEntries(Object.entries(p.left).slice(0, 4));
    }
    try { net.send('b.progress', msg); } catch { /* offline */ }
  }

  function finished(e) {
    if (e.done) return;
    e.done = true;
    noteLeaks(e);
    if (e.authoritative && !e.resultSent && net) {
      progress(e, true);
      e.resultSent = true;
      let result = null;
      try {
        result = e.sim.spec.compactResult(e.battle.result());
        // an oversized frame would close the socket at the very end of the battle (64 KB inbound limit)
        if (typeof e.sim.spec.fitResult === 'function') result = e.sim.spec.fitResult(result, { bossLike: bossLike(e), battleId: e.battleId });
      } catch (err) { console.warn('[runner] result failed', err); }
      if (result) {
        e.result = result;
        // the view answers with the settlement voice of this battle (screens/game.js → audio.voice result*): the
        // compact result carries the leaks and the kill count the slot is picked from
        emit('result', { fieldId: e.fieldId, battleId: e.battleId, own: !!e.own, result });
        deliver(e);
      }
    }
    if (e === cur) publishState();
    else flushLeaks();
  }

  /**
   * Send an entry's b.result (retried once on a timeout). `e.delivery`: 'pending' while a request is out, 'delivered'
   * once the server answered (ok, or a refusal — final), 'undelivered' when it never got there (LOST_RESULT_CODES): kept
   * for redeliver() (session back online) and for an authoritative b.start of the finished battle.
   */
  function deliver(e) {
    if (!net || !e.result || e.delivery === 'pending') return;
    e.delivery = 'pending';
    const msg = { battleId: e.battleId, result: e.result };
    const send = (tries) => {
      let req;
      try { req = net.request('b.result', msg, { timeout: 15000 }); } catch (err) { req = Promise.reject(err); }
      return Promise.resolve(req).then(() => { e.delivery = 'delivered'; }, (err) => {
        const code = err && err.code;
        if (code === 'TIMEOUT' && tries > 0) return send(tries - 1);
        if (LOST_RESULT_CODES.includes(code)) {
          e.delivery = 'undelivered';
          console.warn(`[runner] b.result not delivered (${code}) — sent again when the session resumes`);
        } else {
          e.delivery = 'delivered';
          console.warn('[runner] b.result refused', code);
        }
        return null;
      });
    };
    send(1);
  }

  /** The session is back: every result lost with the socket goes out again. */
  function redeliver() {
    for (const e of entries.values()) if (e.delivery === 'undelivered') deliver(e);
  }

  /** Solo pause (m.public.paused): freeze / resume every local battle clock. */
  function setPaused(on) {
    if (on === (pausedAt != null)) return;
    if (on) {
      pausedAt = now();
    } else {
      const d = Math.max(0, now() - pausedAt);
      pausedAt = null;
      for (const e of entries.values()) { e.t0 += d; e.lastProgressAt += d; }
    }
    publishState();
    schedule();
  }

  /** Advance one entry to its clock (bounded); render it when it is on screen. */
  function advance(e, t, render) {
    if (e.battle.finished) { if (!e.done) finished(e); return; }
    const behind = targetTick(e, t) - (e.battle.tickCount || 0);
    if (behind <= 0) return;
    const cap = ticksPerFrameCap(e.speed);
    const catchingUp = behind > cap * 4;
    if (catchingUp) stats.catchups++;
    const n = Math.min(behind, catchingUp ? CATCHUP_TICKS : cap);
    const dt = stepEntry(e, n, catchingUp || !render);
    if (dt > stats.maxFrameMs) stats.maxFrameMs = dt;
    if (render) emitFrame(e, catchingUp);
    else hold(e);
    noteLeaks(e);
    progress(e);
    if (e.battle.finished) finished(e);
  }

  function running(e) { return !e.battle.finished && (e === cur || (e.authoritative && !e.resultSent)); }

  function frame() {
    rafH = null;
    stats.frames++;
    const t = clock();
    for (const e of [...entries.values()]) if (running(e)) advance(e, t, e === cur);
    flushLeaks();
    schedule();
  }

  function pump() {
    // hidden tab: no animation frames — keep authoritative battles on their clock (no rendering)
    if (!hidden()) return;
    for (const e of [...entries.values()]) if (e.authoritative && running(e)) advance(e, clock(), false);
    flushLeaks();
  }

  function schedule() {
    // paused: nothing to step (the view keeps its last frame); resume reschedules
    const any = pausedAt == null && [...entries.values()].some(running);
    if (any && rafH == null && !hidden()) rafH = raf(frame);
    const needPump = pausedAt == null && [...entries.values()].some((e) => e.authoritative && running(e));
    if (needPump && ivH == null) ivH = setIv(pump, 250);
    else if (!needPump && ivH != null) { clearIv(ivH); ivH = null; }
  }

  /** Put an entry on screen: field meta into the store (the game screen enters it), then its current frame. */
  function show(e) {
    cur = e;
    e.held = [];
    e.slices = [];
    e.stale = false;
    let meta = null;
    try { meta = e.battle.fieldMeta(); } catch { meta = { units: [] }; }
    const field = {
      t: 'm.field', ...meta, fieldId: e.fieldId, kind: e.kind, rect: meta.rect ?? e.spec.rect, stageId: meta.stageId ?? e.spec.stageId,
      live: !e.done, battleId: e.battleId, players: e.members.slice(), local: true, speed: e.speed,
      // the watched player's effects column (user playtest #2; undefined for 联防 / boss pairs and server-run fields)
      effects: spectateEffects(e.spec, e.members),
      // which half each player holds (联防: the first helper takes the right half; boss pairs: L / R)
      sides: Object.fromEntries((e.spec.players || []).filter((p) => p && p.playerId).map((p) => [p.playerId, p.side === 'R' || Number(p.colOffset) >= 8 ? 'R' : 'L'])),
    };
    emit('field', field);
    try { store.patch('match', { field }); } catch { /* ignore */ }
    publishState();
    try { e.battle.drainEvents(); } catch { /* the view starts from the meta + this frame */ }
    emit('snap', frameOf(e));
    schedule();
  }

  function evict() {
    if (entries.size <= MAX_ENTRIES) return;
    for (const [id, e] of entries) {
      if (entries.size <= MAX_ENTRIES) break;
      if (e === cur || (e.authoritative && !e.resultSent) || e.own || e.delivery === 'pending' || e.delivery === 'undelivered') continue;
      entries.delete(id);
    }
  }

  function yieldFrame() { return new Promise((resolve) => { if (hidden()) setTimeout(resolve, 0); else raf(() => resolve()); }); }

  async function onStart(msg) {
    if (!msg || typeof msg !== 'object' || !msg.spec || typeof msg.battleId !== 'string') return;
    const speed = Number(msg.speed) > 0 ? Number(msg.speed) : 2;
    const existing = entries.get(msg.battleId);
    if (existing) {
      const was = existing.authoritative;
      existing.authoritative = !!msg.authoritative && !existing.resultSent;
      existing.watch = !!msg.watch;
      // the server still waits for this finished battle's result (lost with the socket, or its answer was): again
      if (msg.authoritative && existing.resultSent) deliver(existing);
      if (existing.authoritative && !was) {
        // handover (the partner left): continue from the field's clock and report from now on
        existing.t0 = clock() - ((Number(msg.elapsed) || 0) / speed) * 1000;
        existing.lastProgressAt = -Infinity;
        if (existing.battle.finished) { existing.done = false; finished(existing); }
      }
      ++startSeq;
      loading = null;
      // a resend of what is already on screen (reconnect / resync) only updates the state; switching back shows it
      if (cur !== existing) show(existing);
      else { publishState(); schedule(); }
      return;
    }
    const seq = ++startSeq;
    loading = { battleId: msg.battleId, fieldId: msg.fieldId, kind: msg.kind };
    publishState();
    let sim;
    try { sim = await ensureSim(); } catch (err) {
      console.warn('[runner] simulation unavailable', err);
      if (seq === startSeq) { loading = null; publishState(); }
      return;
    }
    if (seq !== startSeq) return; // superseded by a newer b.start
    let battle;
    try {
      battle = sim.spec.createBattleFromSpec(msg.spec, sim.ds, { logger });
    } catch (err) {
      console.warn('[runner] battle construction failed', err);
      loading = null;
      publishState();
      return;
    }
    stats.battles++;
    const e = {
      battleId: msg.battleId, fieldId: msg.fieldId || msg.spec.fieldId, kind: msg.kind || msg.spec.kind, spec: msg.spec, sim, battle,
      authoritative: !!msg.authoritative, watch: !!msg.watch, own: !msg.watch, speed,
      members: (msg.spec.players || []).map((p) => p && p.playerId).filter(Boolean),
      t0: clock() - ((Number(msg.elapsed) || 0) / speed) * 1000, lastProgressAt: -Infinity, done: false, resultSent: false,
      result: null, delivery: null,
      meter: sim.spec.attachLpMeter(battle),
      // counted leaks so far (normal fields; noteLeaks) and the Battle state they were counted at; 联防 fields: each
      // leaker's enemies still standing (noteUniteLeft)
      leaks: 0, leakMark: '', left: null,
      // live bond layers grown in this battle { [playerId]: { [bondId]: n } } and their total gain (noteLayers)
      live: null, layerSum: 0,
      // state-bearing events of the steps run while the tab was hidden (hold(); delivered by the next rendered frame;
      // heldAt = the game time each was drained at), and whether that backlog overflowed (the next frame re-enters the
      // view from the field meta); the event batches of the current sliced step (stepEntry)
      held: [], stale: false, slices: [],
    };
    if (lastPool && battle.sharedBoss && typeof battle.sharedBoss.sync === 'function') {
      battle.sharedBoss.sync(lastPool.hp, lastPool.acked ? lastPool.acked[e.fieldId] : undefined);
    }
    // silent catch-up to the field's clock before it is shown (a reconnect / observing a running field)
    while (!battle.finished && targetTick(e, clock()) - battle.tickCount > ticksPerFrameCap(speed)) {
      const n = Math.min(PREPARE_SLICE, targetTick(e, clock()) - battle.tickCount);
      stepEntry(e, n);
      try { battle.drainEvents(); } catch { /* ignore */ }
      noteLeaks(e);
      if (e.authoritative) progress(e);
      await yieldFrame();
      if (seq !== startSeq) {
        // superseded while preparing: an authoritative battle must still finish (it is kept), a replica is dropped
        if (e.authoritative) { entries.set(e.battleId, e); evict(); if (e.leaks) leaksDirty = true; schedule(); }
        return;
      }
    }
    entries.set(e.battleId, e);
    evict();
    loading = null;
    noteLeaks(e);
    show(e);
    if (battle.finished) finished(e);
  }

  function onPool(msg) {
    if (!msg || typeof msg !== 'object') return;
    lastPool = msg;
    for (const e of entries.values()) {
      const pool = e.battle.sharedBoss;
      if (pool && typeof pool.sync === 'function') pool.sync(msg.hp, msg.acked ? msg.acked[e.fieldId] : undefined);
    }
    emit('pool', msg);
  }

  function onEnd(msg) {
    const e = msg && entries.get(msg.battleId);
    if (!e) return;
    if (msg.reason === 'takeover') {
      e.authoritative = false;
      if (e === cur) publishState();
      schedule();
      return;
    }
    if (!e.battle.finished) {
      try { e.battle.forceEnd(msg.reason === 'timeout' ? 'timeout' : 'forced'); } catch { /* ignore */ }
    }
    if (e === cur) emitFrame(e, false);
    finished(e);
    flushLeaks();
    schedule();
  }

  /** Drop every battle (a new round's prep, the match ended, the player left). */
  function clear() {
    ++startSeq;
    loading = null;
    for (const e of entries.values()) {
      // never drop an unreported authoritative result (the round already moved on: the server has its own)
      if (e.authoritative && !e.resultSent && !e.battle.finished) { try { e.battle.forceEnd('forced'); } catch { /* ignore */ } }
    }
    entries.clear();
    cur = null;
    lastPool = null;
    if (rafH != null) { caf(rafH); rafH = null; }
    if (ivH != null) { clearIv(ivH); ivH = null; }
    publishState();
  }

  const offs = [];
  if (net && typeof net.on === 'function') {
    offs.push(net.on('b.start', (m) => { onStart(m).catch((err) => console.warn('[runner] b.start failed', err)); }));
    offs.push(net.on('b.pool', onPool));
    offs.push(net.on('b.end', onEnd));
    // the session is back (reconnect / resume): results lost with the old socket go out again
    offs.push(net.on('status', (st) => { if (st && st.status === 'online') redeliver(); }));
  }
  // phase changes: combat fields live until the next prep; leaving the match drops everything
  let lastPhase = null;
  if (store && typeof store.subscribe === 'function') {
    offs.push(store.subscribe((s) => {
      const pub = s && s.match && s.match.public ? s.match.public : null;
      // solo pause (DESIGN §14): the local battle clocks follow m.public.paused
      setPaused(!!(pub && pub.paused));
      const phase = pub ? pub.phase : null;
      if (phase === lastPhase) return;
      lastPhase = phase;
      if (!phase || ['PREP', 'ROUND_START', 'SP_DRAFT', 'RESULT', 'LOBBY', 'INFO_CHECK', 'BAND_DRAFT', 'BATTLE_CHECK'].includes(phase)) {
        if (entries.size || loading) clear();
      }
      // warm the simulation up as soon as a match runs (the first b.start then starts at once)
      if (phase && phase !== 'LOBBY' && !simP) ensureSim().catch(() => {});
    }));
  }
  if (doc && typeof doc.addEventListener === 'function') {
    doc.addEventListener('visibilitychange', () => { if (hidden()) return; flushHidden(); schedule(); });
  }

  return {
    on(type, fn) {
      if (typeof fn !== 'function') return () => {};
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
      return () => listeners.get(type)?.delete(fn);
    },
    state,
    stats() {
      return { ...stats, avgTickMs: stats.ticks ? stats.stepMs / stats.ticks : 0, entries: entries.size, loadingSim: !!simP };
    },
    /**
     * Live stats of unit `unitId` of the battle on screen (null: no such battle / unit, or `fieldId` names another
     * field). Reads the sim's last computed stats (`unit._s`, falling back to the base) — never `unit.s`, whose lazy
     * recompute would run earlier than the sim itself would run it.
     * @param {number} unitId @param {string|null} [fieldId]
     */
    unitStats(unitId, fieldId = null) {
      const e = cur;
      if (!e || !Number.isInteger(unitId) || (fieldId != null && e.fieldId !== fieldId)) return null;
      let u = null;
      try { u = typeof e.battle.unitById === 'function' ? e.battle.unitById(unitId) : null; } catch { u = null; }
      if (!u) return null;
      try { return unitStatsEntry(u, u._s || null); } catch { return null; }
    },
    /**
     * The unit id of the board piece `uid` owned by `ownerId` in the battle on screen (an own operator's card opened in
     * prep and left open into the battle turns live); null when that battle has no such unit.
     * @param {number} uid @param {string} ownerId @param {string|null} [fieldId]
     */
    unitIdOf(uid, ownerId, fieldId = null) {
      const e = cur;
      if (!e || !Number.isInteger(uid) || (fieldId != null && e.fieldId !== fieldId)) return null;
      const list = Array.isArray(e.battle.allyUnits) ? e.battle.allyUnits : [];
      const u = list.find((x) => x && x.uid === uid && x.ownerId === ownerId);
      return u && Number.isInteger(u.id) ? u.id : null;
    },
    /**
     * The operators `ownerId` fields in the battle on screen — their board in that battle, waiting to deploy, deployed
     * or knocked out (the field meta published by show() is taken before they deploy) — as UnitInfo-like
     * { kind: 'op', ownerId, defId }: a teammate's bond popup lists them as the members in play (ui/watchBonds.js
     * ownerBoard). [] when no such battle is on screen.
     * @param {string} ownerId @param {string|null} [fieldId]
     */
    ownerOps(ownerId, fieldId = null) {
      const e = cur;
      if (!e || typeof ownerId !== 'string' || !ownerId || (fieldId != null && e.fieldId !== fieldId)) return [];
      const list = Array.isArray(e.battle.allyUnits) ? e.battle.allyUnits : [];
      return list.filter((u) => u && u.kind === 'op' && u.ownerId === ownerId && typeof u.defId === 'string')
        .map((u) => (Array.isArray(u.items) && u.items.length ? { kind: 'op', ownerId, defId: u.defId, items: [...u.items] } : { kind: 'op', ownerId, defId: u.defId }));
    },
    /** Re-show the current battle (the game screen remounted). */
    reshow() { if (cur) show(cur); },
    /** Test / debug hooks. */
    _entries: entries,
    _frame: frame,
    _pump: pump,
    onStart, onPool, onEnd, clear, ensureSim, redeliver, setPaused,
    dispose() { clear(); for (const off of offs) { try { off?.(); } catch { /* ignore */ } } },
  };
}

/** The browser runner, wired to the app's socket and store (null outside a browser). */
export const battleRunner = typeof window !== 'undefined' && typeof document !== 'undefined'
  ? createBattleRunner({ net: appNet, store: appStore })
  : null;
if (battleRunner) globalThis.__SP_RUNNER__ = battleRunner; // dev / E2E introspection
