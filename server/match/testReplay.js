// Offline re-simulation of [test-input ROOM] JSON lines. Supply the SAME content set and
// build as the original match. This is a developer API, not a network request or script loader.
// A journal of an official version's match (init.options.version, DESIGN §35.23) replays in a process whose data
// singleton is that version's (server/data.js setData(getVersionData(id)) before this module is imported — the kits,
// builtinMeta and the official-bounds cache read the singleton, as in the version's match host), with that data passed in.
// Both are checked, as the version host checks its own (host/entry.js): another version's data would re-simulate on other
// kits and items without an error.
import { Match } from './Match.js';
import { TEST_INPUT_METHODS } from './testTrace.js';
import { getData } from '../data.js';
import { DEFAULT_VERSION, versionOfData } from '../../shared/versions.js';

export function replayTestMatch(data, entries, { send = () => {}, broadcast = () => {}, onEnd = () => {}, registry, BattleClass } = {}) {
  entries = decodeTestTrace(entries);
  if (entries.some((e) => e && e.kind === 'capped')) throw new TypeError('journal is not replayable');
  const init = entries[0];
  if (!init || init.version !== 1 || init.kind !== 'init' || init.options?.test !== true) throw new TypeError('invalid test journal');
  const want = init.options?.version ?? DEFAULT_VERSION;
  if (want !== versionOfData(data) || want !== versionOfData(getData())) {
    throw new TypeError(`journal of ${want} needs that version's data (see test/helpers/versionReplay.mjs)`);
  }
  let now = init.at;
  let seq = 0;
  const timers = new Map();
  const add = (fn, repeat) => { const id = ++seq; timers.set(id, { fn, repeat }); return id; };
  const scheduler = {
    virtual: init.virtual, instant: init.instant, now: () => now,
    setTimeout: (fn) => add(fn, false), setInterval: (fn) => add(fn, true),
    clearTimeout: (id) => timers.delete(id), clearInterval: (id) => timers.delete(id), dispose: () => timers.clear(),
  };
  // journal:false — replaying must not log again, and must not wrap timers a second time.
  // Old journals predate selectable bots. Neither old nor new recordings read the replay host's environment.
  const m = new Match({ ...init.options, botStrategy: init.options.botStrategy ?? 'legacy',
    botStrategySeats: init.options.botStrategySeats ?? {}, journal: false,
    externalReplay: true, data, scheduler, send, broadcast, onEnd, registry, BattleClass });
  for (const e of entries.slice(1)) {
    if (!Number.isFinite(e.at) || e.at < now) throw new TypeError('invalid journal time');
    now = e.at;
    if (e.kind === 'capped') throw new TypeError('journal is not replayable');
    if (e.kind === 'timer') {
      const timer = timers.get(e.id);
      if (!timer) throw new TypeError(`missing journal timer ${e.id}`);
      if (!timer.repeat) timers.delete(e.id);
      m._testSliceBudget = Number.isInteger(e.steps) && e.steps > 0 ? e.steps : null;
      m._testSliceCount = 0;
      try { timer.fn(); }
      finally { m._testSliceBudget = null; }
    } else if (e.kind === 'call' && TEST_INPUT_METHODS.includes(e.method) && Array.isArray(e.args)) {
      m[e.method](...e.args);
    } else throw new TypeError('invalid journal entry');
  }
  return m;
}

/** Reassemble one complete journal, rejecting missing/reordered/oversized fragments. */
export function decodeTestTrace(entries) {
  const out = [];
  let pending = null;
  for (const e of entries) {
    if (e.kind !== 'chunk') {
      if (pending) throw new TypeError('incomplete journal record');
      out.push(e); continue;
    }
    if (!Number.isInteger(e.parts) || e.parts < 1 || e.parts > 4096 || typeof e.text !== 'string' || e.text.length > 512) throw new TypeError('invalid journal chunk');
    if (!pending) pending = { id: e.id, parts: e.parts, next: 0, text: '' };
    if (e.id !== pending.id || e.parts !== pending.parts || e.part !== pending.next) throw new TypeError('out of order journal chunk');
    pending.text += e.text; pending.next++;
    if (pending.next === pending.parts) { out.push(JSON.parse(pending.text)); pending = null; }
  }
  if (pending) throw new TypeError('incomplete journal record');
  return out;
}
