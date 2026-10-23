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
// A b.start is registered as pending the moment it arrives — before the sim module has loaded, while the Battle is built
// and caught up silently — so what comes for that battle meanwhile is applied to it in order (PR #266): a b.end takeover
// stops its reports; a forced / timeout b.end (the first end counts) ends it as soon as the Battle exists, without
// catching up; a second b.start of it updates its flags (never a second Battle); b.pool and the solo pause reach it. A
// b.start of another field supersedes it: an authority, or a battle the server already ended, is still built and kept, a
// display replica is dropped. The next prep's clear() drops it.
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
// The vanilla sim (≈ 0.2–1 ms per tick) runs on the main thread: one battle at a time is stepped for display (plus an
// authoritative one if it is not the one on screen). Gameplay sets use WorkerSimHost (DESIGN §32.11).
// stats() exposes the measured cost (Worker cost includes the message round trip).
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
//   battleRunner.ownerOps(ownerId, fieldId?) → [{ kind: 'op', ownerId, defId, items?, standInFor?, diy? }] that player's
//                           operators in the battle on screen with their equipment (a teammate's bond popup: the members in
//                           play, DESIGN §20.15, 变形同构体 wearers included; a 补位 stand-in names the replaced charId,
//                           a 自选 operator carries its pick like UnitInfo) | []
//
// Content sets (DESIGN §32.6 and §32.11 — cs checks preserved across both hosts): a b.start whose spec names a
// content set (`spec.cs`) other than the one this page holds — the original content's (welcome.content.vanilla) or the
// room's content set the page downloaded and checked (public/js/content.js) — is simulated by this page as a display
// replica only, never as the battle's authority: no b.progress, no b.result; the server's deadline gives the field to
// the server — and so is every spec naming a content while the page does not know the original one's cs. For a room's
// content set the simulation is loaded on that set's data (content.js contentFor; the next spec of another content
// loads it again — one at a time), and a b.result names the content the battle was simulated on (`cs`, its
// simulation's; a vanilla room's sends none, as before).
//
// createBattleRunner(deps) builds an instance with injectable net / store / clock / frame scheduler / sim loader
// (test/match/runner.test.js and test/match/runner-pending.test.js drive it under Node).

import { net as appNet } from '../net.js';
import { store as appStore } from '../store.js';
import { contentFor as appContentFor, simContent as appSimContent, contentSet as appContentSet } from '../content.js';
import { fxForm } from '../../../shared/protocol.js';
import { spectateEffects } from './observe.js';
import { recordError, setBattleSource } from '../diag.js';
import { loadBrowserSim } from './simLoader.js';
import { InPageSimHost, WorkerSimHost } from './simHost.js';
import { trackCombat, combineCombat } from './metrics.js';
import { t } from '../../../shared/i18n.js';
export { loadBrowserSim, SIM_DATA_FILES } from './simLoader.js';

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
/** Request failures after which a b.result counts as never delivered (re-sent on resume / b.start). */
export const LOST_RESULT_CODES = Object.freeze(['DISCONNECTED', 'OFFLINE', 'TIMEOUT']);

/** Ticks per frame at a speed (same cap as the server pacing: server/match/fields.js maxTicksPerInterval). */
export const ticksPerFrameCap = (speed) => Math.max(8, Math.ceil((Number(speed) || 2) * 4));

/**
 * What the runner compares between two looks at a 联防 battle (noteUniteLeft) before it reads the leakers' enemies still
 * standing again: a knock-out, a leak, a spawn, the end. `total` stands for the spawns no longer — a split child or a summon
 * is outside the capsule's denominator (DESIGN §14 顶栏胶囊) — so the length of the enemy list does.
 * @param {any} b the battle
 */
export const uniteLeftMark = (b) => `${Number(b.killed) || 0}:${Number(b.leakedCount) || 0}:${Number(b.total) || 0}:${Array.isArray(b.enemies) ? b.enemies.length : 0}:${b.finished ? 1 : 0}`;

/**
 * Battle logger: content errors are isolated by the sim; report them as warnings (the server logs its own) and keep
 * them for the diagnostics a player copies (diag.js).
 */
const SIM_LOGGER = Object.freeze({
  error: (...a) => { console.warn('[sim]', ...a); recordError('sim', a.length === 1 ? a[0] : a.map(String).join(' ')); },
  warn: (...a) => console.warn('[sim]', ...a),
  info() {},
  debug() {},
});

/**
 * @param {{ net: any, store: any, loadSim?: () => Promise<{ spec: any, ds: any }>, now?: () => number,
 *   raf?: (fn: (t: number) => void) => any, caf?: (h: any) => void, setInterval?: Function, clearInterval?: Function,
 *   doc?: { hidden?: boolean, addEventListener?: Function } | null, logger?: object,
 *   combatMetrics?: boolean, createHost?: Function }} deps
 * `combatMetrics` true/false pins the 作战统计 meter for a test. Omit it and call setCombatMetrics (the settings
 * screen does; the default is off). A Worker host never attaches the meter.
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
  // `content` (DESIGN §32.6): `{ cs, data }` of a room's content set → the sim on it; null → the original content
  const loadSim = deps.loadSim || ((content) => (content ? loadBrowserSim({ data: content.data, cs: content.cs, bounds: content.bounds ?? null, scripts:content.scripts || [], hashInput:content.hashInput, nativeVerified:content.nativeVerified }) : loadBrowserSim()));
  const logger = deps.logger || SIM_LOGGER;
  // the content sets (DESIGN §32.6): the room's set the page holds (content.js) and the server's original one
  const contentFor = deps.contentFor || appContentFor;
  const heldContent = deps.simContent || appSimContent;
  /** the content set the page is downloading now (content.js contentSet: its cs while loading), else null */
  const loadingContent = deps.loadingContent || (() => { const c = appContentSet.get(); return c.status === 'loading' ? c.cs : null; });
  const vanillaCs = deps.vanillaCs || (() => { try { return store?.get?.()?.content?.vanilla ?? null; } catch { return null; } });

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
  /** compact combat snapshots of locally simulated battles (battle/metrics.js) for the panel's match totals; `clear`
   *  drops them when the match really restarts */
  const combatHistory = new Map();
  const rememberCombat = (e) => {
    if (!e.combatMetrics) return;
    const record = e.combatMetrics();
    if (!(combatHistory.get(e.battleId)?.seconds > record.seconds)) combatHistory.set(e.battleId, record);
  };
  // Opt-in (设置「作战统计」, default off). A boolean deps.combatMetrics pins a test and ignores setCombatMetrics.
  // Otherwise screens/game.js pushes the settings store. A Worker host never attaches: its page battle is wire state.
  let metricsWanted = false;
  const metricsEnabled = () => (typeof deps.combatMetrics === 'boolean' ? deps.combatMetrics : metricsWanted);
  const detachCombat = (e) => {
    if (!e?.combatMetrics) return;
    rememberCombat(e);
    try { e.combatMetrics.stop?.(); } catch { /* the reader is already gone */ }
    e.combatMetrics = null;
  };
  function setCombatMetrics(on) {
    if (typeof deps.combatMetrics === 'boolean') return;
    const next = on === true;
    if (next === metricsWanted) return;
    metricsWanted = next;
    // [ASSUMED] turning the meter on does not backfill a battle already prepared: the hooks would have missed the
    // damage already dealt. The next prepare attaches. Turning it off detaches at once.
    if (next) return;
    for (const e of entries.values()) detachCombat(e);
    for (const e of pending.values()) detachCombat(e);
  }
  /** @type {Map<string, any>} battleId → entry of a b.start still being prepared (prepare(); `battle` null until built) */
  const pending = new Map();
  let cur = null;              // entry on screen
  let simP = null;
  /** the content set simP was loaded for (null: the original content) */
  let simCs = null;
  let startSeq = 0;            // counts the b.starts: the latest one is the view asked for
  let loading = null;          // the pending entry of the latest b.start (shown when prepared)
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

  /**
   * Is `cs` (a spec's) content this page can be the authority of (see the header): a spec without one, the original
   * content's, or the room's content set the page holds — or is downloading (`loading`: a b.start that came while the
   * page loads it, a reconnect; checked again once the simulation is built) — never another (a stale page, a tampered
   * content set), and none at all while the page does not know the original content's cs (it could not tell which data
   * to simulate on).
   * @param {unknown} cs @param {{ loading?: boolean }} [opts]
   */
  function csAccepted(cs, { loading = false } = {}) {
    if (typeof cs !== 'string' || cs === '') return true;
    const vanilla = vanillaCs();
    if (vanilla == null) return false;
    if (cs === vanilla) return true;
    const held = heldContent();
    return (!!held && held.cs === cs) || (loading && loadingContent() === cs);
  }

  /**
   * The simulation for a spec's content `cs` (see the header): the original content's (loaded from /data/) or a room's
   * content set (its checked data, content.js contentFor); one at a time — another content loads it again.
   */
  function ensureSim(cs = null) {
    const vanilla = vanillaCs();
    const want = typeof cs === 'string' && vanilla != null && cs !== vanilla ? cs : null;
    if (simP && simCs === want) return simP;
    simCs = want;
    const p = (want ? contentFor(want).then((content) => {
      if (!content || content.cs !== want) throw new Error(`the content set ${want.slice(0, 8)} is not loaded on this page`);
      return deps.loadSim || (!deps.createHost && !content.scripts?.length) ? loadSim(content) : { content, cs: want, remote: true };
    }) : loadSim(null)).catch((err) => { if (simP === p) { simP = null; simCs = null; } throw err; });
    simP = p;
    return p;
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
    try { n = Math.max(0, Math.trunc(Number(e.host.progress().leaks) || 0)); } catch { /* keep the last count */ }
    if (n !== e.leaks) { e.leaks = n; leaksDirty = true; }
  }

  function noteUniteLeft(e) {
    const b = e.battle;
    const mark = uniteLeftMark(b);
    if (mark === e.leakMark) return;
    e.leakMark = mark;
    let left = e.left;
    try { left = e.host.uniteLeft() || left; } catch { /* keep the last count */ }
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
    const accept = (out) => { k = out.ticks; e.slices.push(...out.slices); };
    try {
      const out = e.host.step(n, { slice: sliced ? EV_SLICE : 0 });
      if (e.host.remote) return out.then((value) => {
        if (e.failed) return 0;
        accept(value);
        const dt = now() - t;
        stats.ticks += k; stats.stepMs += dt;
        return dt;
      });
      accept(out);
    } catch (err) {
      stats.errors++;
      console.warn('[runner] battle step failed', err);
      recordError('runner', err, 'battle step failed');
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
    let ev;
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
    try { emit('snap', frameOf(e)); } catch (err) { console.warn('[runner] snapshot failed', err); recordError('runner', err, 'snapshot failed'); }
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
    e.meter = e.host.meter;
    const p = e.host.progress();
    const msg = { battleId: e.battleId, gt: Math.min(1e5, p.gt), killed: Math.min(p.killed, p.total), total: Math.min(1e5, p.total), done: !!p.done };
    // the HUD capsule's numerator of this field (shared/protocol.js b.progress `resolved`): the field's own scheduled
    // enemies knocked out or leaked. Sent only when the battle reports one (Battle.resolved) — an absent field leaves
    // the teammate UI on its `resolved ?? killed` fallback
    if (Number.isFinite(p.resolved)) msg.resolved = Math.max(0, Math.min(msg.total, p.resolved));
    if (bossLike(e)) {
      const pool = e.battle.sharedBoss;
      msg.leaks = Math.min(1e6, e.meter.lp);
      // the split of that LP between the players' own leaks (the rest is the leader's effects): the server holds the result's
      // leaked lists to it before a perfect-payout bounty pays (Match._bossLeaksAgree)
      if (p.leaksBy) msg.leaksBy = p.leaksBy;
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
        result = e.host.compactResult({ bossLike: bossLike(e), battleId: e.battleId });
      } catch (err) { console.warn('[runner] result failed', err); recordError('runner', err, 'result failed'); }
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
    // a room's content set names itself in the result (DESIGN §32.6: the server refuses one without it) — the set the
    // battle was actually simulated on (its simulation's `cs`: loadBrowserSim's), never only what the spec claims; the
    // original content's result is what it always was
    const cs = e.sim && typeof e.sim.cs === 'string' && e.sim.cs ? e.sim.cs : null;
    const msg = cs ? { battleId: e.battleId, result: e.result, cs } : { battleId: e.battleId, result: e.result };
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
          recordError('runner', code, 'b.result refused');
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
      // a pending battle not built yet takes its clock when it is built
      for (const e of [...entries.values(), ...pending.values()]) if (e.t0 != null) { e.t0 += d; e.lastProgressAt += d; }
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
    if (e.stepping || e.failed) return;
    const finishStep = (dt) => {
      if (e.failed || entries.get(e.battleId) !== e) return;
      if (dt > stats.maxFrameMs) stats.maxFrameMs = dt;
      if (render && e === cur) emitFrame(e, catchingUp);
      else hold(e);
      noteLeaks(e);
      progress(e);
      if (e.battle.finished) finished(e);
      flushLeaks();
    };
    const step = stepEntry(e, n, catchingUp || !render);
    if (e.host.remote) {
      e.stepping = true;
      step.then(finishStep, err => failWorker(e, err)).finally(() => { e.stepping = false; schedule(); });
    } else finishStep(step);
  }

  /** Stop reports immediately. Existing server deadline/takeover is the fallback; b.result's cs refusal asks for it now. */
  function failWorker(e, err) {
    if (e.failed || (pending.get(e.battleId) !== e && entries.get(e.battleId) !== e)) return;
    const authority = e.authoritative;
    e.failed = true; e.authoritative = false; e.done = true;
    e.host?.stop();
    stats.errors++;
    recordError('runner', err, 'plugin worker stopped');
    const text = t('插件卡死，本场由服务器接管');
    if (deps.toast) deps.toast(text, 'error');
    else if (typeof document !== 'undefined') import('../ui/toasts.js').then(m => m.toast(text, 'error')).catch(() => {});
    emit('takeover', { battleId: e.battleId, fieldId: e.fieldId, text });
    // A structurally valid result with no cs is always refused for gameplay sets (requireCs), invoking _runOnServer.
    // It is a failure signal only, never a claimed battle outcome. Vanilla never reaches this path.
    if (authority) {
      const perPlayer = Object.fromEntries(e.members.map(id => [id, { killed: 0, total: 0, leaked: [], perfect: false, layerGains: {}, unitsEnd: [] }]));
      try { Promise.resolve(net.request('b.result', { battleId: e.battleId, result: { reason: 'forced', time: 0, perPlayer } })).catch(() => {}); } catch { /* deadline takes over offline */ }
    }
    if (cur === e) cur = null;
    if (loading === e) loading = null;
    publishState(); schedule();
  }

  function running(e) { return !e.failed && !e.battle.finished && (e === cur || (e.authoritative && !e.resultSent)); }

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
    let meta;
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
      rememberCombat(e);
      e.host?.stop();
      entries.delete(id);
    }
  }

  function yieldFrame() { return new Promise((resolve) => { if (hidden()) setTimeout(resolve, 0); else raf(() => resolve()); }); }

  async function onStart(msg) {
    if (!msg || typeof msg !== 'object' || !msg.spec || typeof msg.battleId !== 'string') return;
    const speed = Number(msg.speed) > 0 ? Number(msg.speed) : 2;
    const seq = ++startSeq;
    const prep = pending.get(msg.battleId);
    const existing = entries.get(msg.battleId) || prep;
    if (existing) {
      existing.seq = seq;
      rebaseSpeed(existing, speed, msg.elapsed, msg.speedRevision);
      const was = existing.authoritative;
      existing.authoritative = !!msg.authoritative && !existing.failed && !existing.resultSent && csAccepted(existing.spec.cs, { loading: !existing.battle });
      existing.watch = !!msg.watch;
      // the server still waits for this finished battle's result (lost with the socket, or its answer was): again
      if (msg.authoritative && existing.resultSent) deliver(existing);
      if (!existing.battle) {
        // still loading: it starts from the latest field clock
        existing.elapsed = Number(msg.elapsed) || 0;
      } else if (existing.authoritative && !was) {
        // handover (the partner left): continue from the field's clock and report from now on
        existing.t0 = clock() - ((Number(msg.elapsed) || 0) / speed) * 1000;
        existing.lastProgressAt = -Infinity;
        if (existing.battle.finished) { existing.done = false; finished(existing); }
      }
      if (prep) {
        // being prepared: the view asked for again, shown when ready (one Battle per battleId)
        loading = prep;
        publishState();
        return prep.ready;
      }
      loading = null;
      // a resend of what is already on screen (reconnect / resync) only updates the state; switching back shows it
      if (existing.failed) return;
      if (cur !== existing) show(existing);
      else { publishState(); schedule(); }
      return;
    }
    const e = {
      battleId: msg.battleId, fieldId: msg.fieldId || msg.spec.fieldId, kind: msg.kind || msg.spec.kind, spec: msg.spec,
      // built by prepare(); `seq` = its latest b.start, `elapsed` = the field clock to start from, `endReason` = the first
      // forced / timeout b.end (applied once the Battle exists), `ready` = the preparation (a promise)
      sim: null, battle: null, meter: null, seq, elapsed: Number(msg.elapsed) || 0, endReason: null, ready: null,
      // (a spec of another content than the page's: a display replica only — see the header)
      authoritative: !!msg.authoritative && csAccepted(msg.spec.cs, { loading: true }), watch: !!msg.watch, own: !msg.watch, speed, speedRevision: msg.speedRevision || 0,
      members: (msg.spec.players || []).map((p) => p && p.playerId).filter(Boolean),
      t0: null, lastProgressAt: -Infinity, done: false, resultSent: false,
      result: null, delivery: null,
      // local-only combat accounting (battle/metrics.js), attached once the Battle exists; the 作战统计 panel reads
      // it on demand — never sent to the server
      combatMetrics: null,
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
    pending.set(e.battleId, e);
    loading = e;
    publishState();
    e.ready = prepare(e);
    return e.ready;
  }

  /**
   * Build a pending entry's Battle once the sim is loaded, apply the b.end that came meanwhile, catch it up silently to
   * the field's clock and register it (shown when it is still the view asked for). It is dropped when clear() removed it
   * (or a new b.start replaced it after a clear) and when a b.start of another field superseded it — unless it is an
   * authority (it must finish and report) or the server already ended it (switching back shows the end).
   */
  async function prepare(e) {
    const wanted = () => pending.get(e.battleId) === e && (e.seq === startSeq || e.authoritative || !!e.endReason);
    try {
      let sim;
      try { sim = await ensureSim(e.spec.cs); } catch (err) {
        console.warn('[runner] simulation unavailable', err);
        recordError('runner', err, 'simulation unavailable');
        return;
      }
      if (!wanted()) return;
      // the content the simulation holds must still be the spec's (the room could have changed it meanwhile)
      if (!csAccepted(e.spec.cs)) e.authoritative = false;
      let battle;
      try {
        e.host = deps.createHost ? deps.createHost(sim, err => failWorker(e, err)) : sim.remote
          ? new WorkerSimHost({ onFailure: err => failWorker(e, err), timeoutMs: deps.workerTimeoutMs })
          : new InPageSimHost();
        if (e.host.remote) {
          await e.host.load(sim.cs, sim.content);
          if (!wanted()) return;
          await e.host.start(e.spec);
        } else { e.host.sim = sim; e.host.start(e.spec, { logger }); }
        battle = e.host.battle;
      } catch (err) {
        if (e.host?.remote) failWorker(e, err);
        else { console.warn('[runner] battle construction failed', err); recordError('runner', err, 'battle construction failed'); }
        return;
      }
      if (!wanted() || e.failed) return;
      stats.battles++;
      e.sim = sim;
      e.battle = battle;
      e.meter = e.host.meter;
      // The Worker page holds wire state only (time, ids): no `damaged` hook and no `heal`, so trackCombat cannot
      // run there. An in-page Battle gets the meter only when 作战统计 is on (default off; a test may pin it).
      if (metricsEnabled() && !e.host.remote) e.combatMetrics = trackCombat(battle);
      e.t0 = clock() - (e.elapsed / e.speed) * 1000;
      if (lastPool) await e.host.syncPool(lastPool.hp, lastPool.acked ? lastPool.acked[e.fieldId] : undefined);
      if (e.endReason) await endBattle(e);
      // silent catch-up to the field's clock before it is shown (a reconnect / observing a running field) — for the view
      // asked for; a superseded authority catches up in the background (advance)
      while (!battle.finished && e.seq === startSeq && targetTick(e, clock()) - battle.tickCount > ticksPerFrameCap(e.speed)) {
        const n = Math.min(PREPARE_SLICE, targetTick(e, clock()) - battle.tickCount);
        await stepEntry(e, n);
        try { battle.drainEvents(); } catch { /* ignore */ }
        noteLeaks(e);
        progress(e);
        await yieldFrame();
        if (!wanted() || e.failed) return;
      }
      pending.delete(e.battleId);
      entries.set(e.battleId, e);
      evict();
      noteLeaks(e);
      leaksDirty = true; // its leak count / bond layers join the published state
      if (e.seq === startSeq) { loading = null; show(e); }
      if (battle.finished) finished(e);
      flushLeaks();
      schedule();
    } catch (err) {
      if (e.host?.remote) failWorker(e, err); else throw err;
    } finally {
      if (entries.get(e.battleId) !== e) e.host?.stop();
      if (pending.get(e.battleId) === e) pending.delete(e.battleId);
      if (loading === e) { loading = null; publishState(); }
    }
  }

  function onPool(msg) {
    if (!msg || typeof msg !== 'object') return;
    lastPool = msg;
    // a pending battle not built yet takes lastPool when it is built
    for (const e of [...entries.values(), ...pending.values()]) {
      if (e.battle && !e.failed) e.host.syncPool(msg.hp, msg.acked ? msg.acked[e.fieldId] : undefined);
    }
    emit('pool', msg);
  }

  function onEnd(msg) {
    const e = msg && (entries.get(msg.battleId) || pending.get(msg.battleId));
    if (!e || e.failed) return;
    if (msg.reason === 'takeover') {
      e.authoritative = false;
      if (e === cur) publishState();
      schedule();
      return;
    }
    // the first end counts; a battle still loading ends as soon as it is built (prepare)
    if (!e.endReason) e.endReason = msg.reason === 'timeout' ? 'timeout' : 'forced';
    if (e.battle) endBattle(e);
  }

  /** End an entry's battle with its b.end reason; an authority reports it at once. */
  function endBattle(e) {
    if (e.host.remote) return e.host.forceEnd(e.endReason).then(() => {
      if (e.failed || (!entries.has(e.battleId) && !pending.has(e.battleId))) return;
      e.meter = e.host.meter;
      if (e === cur) emitFrame(e, false);
      finished(e); flushLeaks(); schedule();
    }, err => failWorker(e, err));
    if (!e.battle.finished) {
      try { e.host.forceEnd(e.endReason); } catch { /* ignore */ }
    }
    if (e === cur) emitFrame(e, false);
    finished(e);
    flushLeaks();
    schedule();
  }

  /**
   * Drop every battle (a new round's prep, the match ended, the player left). Each dropped battle keeps its last
   * combat snapshot in combatHistory for the panel's match totals; `keepMetrics` false (a new match) starts over.
   */
  function clear({ keepMetrics = false } = {}) {
    ++startSeq;
    loading = null;
    for (const e of entries.values()) {
      // never drop an unreported authoritative result (the round already moved on: the server has its own).
      // A Worker battle is ended by stopping its host below, not by forceEnd on the page-side stub.
      if (!e.host?.remote && e.authoritative && !e.resultSent && e.battle && !e.battle.finished) { try { e.battle.forceEnd('forced'); } catch { /* ignore */ } }
      rememberCombat(e);
    }
    // a battle still being prepared too: its preparation finds itself gone and stops (prepare). Snapshot first:
    // host.stop() drops the in-page Battle the meter reads.
    for (const e of pending.values()) rememberCombat(e);
    for (const e of [...entries.values(), ...pending.values()]) e.host?.stop();
    pending.clear();
    entries.clear();
    if (!keepMetrics) combatHistory.clear();
    cur = null;
    lastPool = null;
    if (rafH != null) { caf(rafH); rafH = null; }
    if (ivH != null) { clearIv(ivH); ivH = null; }
    publishState();
  }

  // Change the pacing origin, not the deterministic Battle or its queued simulation work.
  function onSpeed(msg) {
    const e = entries.get(msg.battleId) || pending.get(msg.battleId);
    if (!e || ![2, 4, 8].includes(msg.speed) || !Number.isInteger(msg.revision) || msg.revision <= (e.speedRevision || 0)) return;
    rebaseSpeed(e, msg.speed, msg.elapsed, msg.revision);
    publishState();
    schedule();
  }

  function rebaseSpeed(e, speed, elapsed, revision) {
    if ((revision || 0) < (e.speedRevision || 0)) return;
    const current = e.battle ? Math.max(0, (clock() - e.t0) / 1000 * e.speed) : e.elapsed;
    const gt = Math.max(current || 0, Number(elapsed) || 0);
    e.speed = speed;
    e.speedRevision = revision || 0;
    e.elapsed = gt;
    e.t0 = clock() - gt / speed * 1000;
  }

  const offs = [];
  if (net && typeof net.on === 'function') {
    offs.push(net.on('b.start', (m) => { onStart(m).catch((err) => console.warn('[runner] b.start failed', err)); }));
    offs.push(net.on('b.speed', onSpeed));
    offs.push(net.on('b.pool', onPool));
    offs.push(net.on('b.end', onEnd));
    // the session is back (reconnect / resume): results lost with the old socket go out again
    offs.push(net.on('status', (st) => { if (st && st.status === 'online') redeliver(); }));
  }
  // phase changes: combat fields live until the next prep; leaving the match drops everything
  let lastPhase = null;
  let lastRound = 0;
  if (store && typeof store.subscribe === 'function') {
    offs.push(store.subscribe((s) => {
      const pub = s && s.match && s.match.public ? s.match.public : null;
      const round = Number(pub?.round) || 0;
      // a fresh match (m.public gone), a rewound round or a return to a lobby-like phase resets the combat totals
      const resetMetrics = (!pub && lastPhase != null) || round < lastRound
        || (pub?.phase !== lastPhase && ['LOBBY', 'INFO_CHECK', 'BAND_DRAFT', 'BATTLE_CHECK'].includes(pub?.phase));
      if (resetMetrics) combatHistory.clear();
      lastRound = round;
      // solo pause (DESIGN §14): the local battle clocks follow m.public.paused
      setPaused(!!(pub && pub.paused));
      const phase = pub ? pub.phase : null;
      if (phase === lastPhase && !resetMetrics) return;
      lastPhase = phase;
      if (!phase || ['PREP', 'ROUND_START', 'SP_DRAFT', 'RESULT', 'LOBBY', 'INFO_CHECK', 'BAND_DRAFT', 'BATTLE_CHECK'].includes(phase)) {
        if (entries.size || pending.size) clear({ keepMetrics: !resetMetrics });
      }
      // warm the simulation up as soon as a match runs (the first b.start then starts at once) — on the room's content set
      // when it plays one (DESIGN §32.6)
      const roomCs = s && s.room && s.room.content && s.room.content.vanilla === false ? s.room.content.cs : null;
      if (phase && phase !== 'LOBBY' && (!simP || simCs !== (roomCs || null))) ensureSim(roomCs).catch(() => {});
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
    /**
     * 设置「作战统计」. Ignored when `deps.combatMetrics` pins the runner. Off detaches meters already attached.
     * On does not attach to a battle that was prepared while the meter was off.
     * @param {boolean} on
     */
    setCombatMetrics,
    /**
     * Local-only damage/healing accounting (battle/metrics.js) for the 作战统计 panel: the own current battle
     * (`battle`) or every battle simulated so far in this match (`match`), each restricted to `ownerId` when given.
     * Read on demand by the panel — never sent to the server.
     * @param {{ scope?: 'battle'|'match', ownerId?: string|null }} [opts]
     */
    combatMetrics({ scope = 'match', ownerId = null } = {}) {
      const localEntries = [...entries.values(), ...pending.values()];
      if (scope === 'battle') {
        // scouting another field must not replace the player's own current battle statistics
        const e = ownerId == null ? cur : localEntries.filter((entry) => entry.members.includes(ownerId))
          .sort((a, b) => b.seq - a.seq)[0];
        return combineCombat(e?.combatMetrics ? [e.combatMetrics()] : [], ownerId);
      }
      const records = new Map(combatHistory);
      for (const e of localEntries) if (e.combatMetrics) {
        const record = e.combatMetrics();
        if (!(records.get(e.battleId)?.seconds > record.seconds)) records.set(e.battleId, record);
      }
      return combineCombat(records.values(), ownerId);
    },
    /**
     * The battle on screen as a report attaches it (diag.js): its b.start fields and its game time; null without one.
     * @returns {{ battleId: string, fieldId: string, kind: string, spec: object, time: number|null }|null}
     */
    currentBattle() {
      const e = cur;
      if (!e || !e.spec) return null;
      const time = e.battle && Number.isFinite(e.battle.time) ? e.battle.time : null;
      return { battleId: e.battleId, fieldId: e.fieldId, kind: e.kind, spec: e.spec, time };
    },
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
      try { return e.host.unitStats(unitId); } catch { return null; }
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
      return e.host.ownerOps(ownerId);
    },
    /** Re-show the current battle (the game screen remounted). */
    reshow() { if (cur) show(cur); },
    /** Test / debug hooks. */
    _entries: entries,
    _frame: frame,
    _pump: pump,
    onStart, onPool, onEnd, onSpeed, clear, ensureSim, redeliver, setPaused,
    dispose() { clear(); for (const off of offs) { try { off?.(); } catch { /* ignore */ } } },
  };
}

/** The browser runner, wired to the app's socket and store (null outside a browser). */
export const battleRunner = typeof window !== 'undefined' && typeof document !== 'undefined'
  ? createBattleRunner({ net: appNet, store: appStore })
  : null;
if (battleRunner) globalThis.__SP_RUNNER__ = battleRunner; // dev / E2E introspection
if (battleRunner) setBattleSource(() => battleRunner.currentBattle());
