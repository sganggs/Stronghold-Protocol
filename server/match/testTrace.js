// Test-only input journal. [ASSUMED] JSON lines go to the existing server logger, never to a
// client-selected path. Record actual timer execution order as well as platform inputs: wall
// clock jitter must not change a replay. A sliced callback records how many steps it took
// (`steps`); replay stops at that count and does not read the wall clock again.
// The journal of one match stops at TEST_JOURNAL_CAP lines, the same bound the replay decoder
// puts on one record. Hitting it marks the match not replayable and appends one capped marker
// instead of truncating a record in place. No record buffer grows with the duration of a match.
import { guardTestMessage } from '../../shared/testMode.js';

export const TEST_INPUT_METHODS = Object.freeze([
  'start', 'handle', 'setLoadout', 'onDisconnect', 'onReconnect', 'onLeave', 'setHost',
  'addSpectator', 'removeSpectator', 'requestSetupReroll', 'cancelSetupReroll', 'dispose',
]);
/** Lines of one match's [test-input] journal, including chunks and the capped marker. */
export const TEST_JOURNAL_CAP = 4096;
const clone = (v) => JSON.parse(JSON.stringify(v));

/**
 * Step budget shared by bot-prep generators, rehearsals and headless battles inside one
 * timer callback. Null when this match is not a test match. `wall` is the slice check:
 * recording uses the wall clock; replay ignores it and stops after the journalled step count.
 * @param {object} m
 */
export function testSlice(m) {
  if (!m || m.test !== true) return null;
  return {
    get replaying() { return Number.isInteger(m._testSliceBudget); },
    note(n = 1) { m._testSliceCount = (m._testSliceCount || 0) + n; },
    stop() { return Number.isInteger(m._testSliceBudget) && (m._testSliceCount || 0) >= m._testSliceBudget; },
    wall(elapsed, budgetMs) {
      if (Number.isInteger(m._testSliceBudget)) return (m._testSliceCount || 0) >= m._testSliceBudget;
      return Number.isFinite(budgetMs) && elapsed >= budgetMs;
    },
  };
}

export function installTestTrace(m, opts) {
  const scheduler = m.sched;
  let seq = 0;
  let depth = 0;
  let eventNow = null;
  let record = 0;
  let lines = 0;
  let capped = false;
  const write = (line) => m.log.info?.(`[test-input ${m.roomCode}] ${line}`);
  const markCapped = () => {
    if (capped) return;
    capped = true;
    m.testReplayable = false;
    // Keep one line for this marker so a full journal is never a silent prefix.
    if (lines < TEST_JOURNAL_CAP) {
      lines++;
      const at = eventNow ?? scheduler.now();
      write(JSON.stringify({ kind: 'capped', at }));
    }
  };
  const emit = (entry) => {
    if (capped) return;
    const json = JSON.stringify(entry);
    // Match-host logs have a 4000-byte IPC limit. Chunk large inputs (loadouts/results)
    // before forwarding; 512 UTF-16 units fit even after JSON escaping and UTF-8 encoding.
    if (json.length <= 512) {
      if (lines + 1 > TEST_JOURNAL_CAP - 1) { markCapped(); return; }
      lines++;
      write(json);
      return;
    }
    const id = ++record;
    const parts = Math.ceil(json.length / 512);
    if (parts > TEST_JOURNAL_CAP || lines + parts > TEST_JOURNAL_CAP - 1) { markCapped(); return; }
    for (let part = 0; part < parts; part++) {
      lines++;
      write(JSON.stringify({ kind: 'chunk', id, part, parts, text: json.slice(part * 512, (part + 1) * 512) }));
    }
  };
  const options = {};
  for (const key of ['roomCode', 'mode', 'difficulty', 'modeId', 'seats', 'spectators', 'seed', 'matchNo', 'hostId', 'aiPicksLast', 'cs', 'vs', 'requireCs', 'kitted', 'rules', 'offers']) {
    if (opts[key] !== undefined) options[key] = clone(opts[key]);
  }
  Object.assign(options, {
    test: true, seed: m.seed, timerScale: m.timerScale, combatSpeed: m.gameSpeed,
    clientCombat: m.clientCombat, verify: m.verifyMode, battleContent: m.battleContent,
    botRehearsal: m.botRehearsal, botRehearsalDelegate: m.botRehearsalDelegate,
    botRehearsalDelegateMs: m.botRehearsalDelegateMs,
  });
  // Finite slice budgets must replay with the same bounded/unbounded split. Infinity is omitted:
  // JSON would turn it into null, and a virtual scheduler already defaults to unbounded.
  if (Number.isFinite(m.botSliceMs)) options.botSliceMs = m.botSliceMs;
  if (Number.isFinite(m.headlessSliceMs)) options.headlessSliceMs = m.headlessSliceMs;
  emit({ version: 1, kind: 'init', at: m.startedAt, options, virtual: scheduler.virtual, instant: scheduler.instant });
  const register = (method, fn, ms) => {
    const id = ++seq;
    return scheduler[method](() => {
      const recording = !Number.isInteger(m._testSliceBudget);
      const previous = eventNow;
      eventNow = scheduler.now();
      if (recording) m._testSliceCount = 0;
      depth++;
      try { fn(); }
      finally {
        depth--;
        if (recording) {
          const steps = m._testSliceCount || 0;
          emit({ kind: 'timer', at: eventNow, id, ...(steps > 0 ? { steps } : {}) });
        }
        eventNow = previous;
      }
    }, ms);
  };
  m.sched = {
    virtual: scheduler.virtual, instant: scheduler.instant,
    now: () => eventNow ?? scheduler.now(),
    setTimeout: (fn, ms) => register('setTimeout', fn, ms),
    setInterval: (fn, ms) => register('setInterval', fn, ms),
    clearTimeout: (h) => scheduler.clearTimeout(h),
    clearInterval: (h) => scheduler.clearInterval(h),
    dispose: () => scheduler.dispose(),
  };
  for (const method of TEST_INPUT_METHODS) {
    const original = m[method];
    if (typeof original !== 'function') continue;
    m[method] = function (...args) {
      // Replace an oversized g.test before the journal clones it and before the match sees it.
      if (method === 'handle' && args[1] && typeof args[1] === 'object') {
        const next = guardTestMessage(args[1]);
        if (next !== args[1]) args = [args[0], next, ...args.slice(2)];
      }
      const external = depth === 0;
      const previous = eventNow;
      if (external) { eventNow = scheduler.now(); emit({ kind: 'call', at: eventNow, method, args: clone(args) }); }
      depth++;
      try { return original.apply(this, args); } finally { depth--; eventNow = previous; }
    };
  }
}
