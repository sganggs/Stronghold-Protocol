// server/match/host/entry.js — a match host (DESIGN §32.6, P1c; the design study's §6.4 方案 B): one child process — or,
// with the `worker` transport (SP_MATCH_HOST=worker), one worker thread (server/match/host/index.js) — per content set
// with gameplay plugins, running every match of that set. Either has its own module table ("worker" below means either),
// so the process-wide singletons of the server's code — server/data.js getData(), the content modules' gameData(), the
// kit registries, the meta effect registry — are this content set's: not one line of the sim, the match or the content
// code changes for it.
//
// Boot (a worker's workerData — a child process's first message, { type: 'init', … } — is { cs, hashInput, files, bounds,
// options }):
//   1. heartbeats start (every options.heartbeatMs, default 1 s: server/match/host/index.js terminates a worker whose
//      heartbeats stop — its matches end with 'plugin-hang');
//   2. the content set is checked: every data file's bytes (`files`, as served) hash to its entry of `hashInput.data`,
//      and `hashInput` hashes to `cs` (shared/plugins/identity.js contentHashOf) — the same composition a browser checks;
//      anything else: 'boot-error' and the worker exits (the room's match ends with 'plugin-start');
//   3. the files are parsed and installed with server/data.js setData — before anything that reads the data is imported —
//      and `bounds`, the official-bounds snapshot the main process validated the set against (shared/plugins/officialBounds.js,
//      DESIGN §32.5), with installOfficialBounds: the engine's plugin caps are the ones the set's pages install (none: the floor);
//   4. when the set carries data.dsl, each prep spec is registered on this process's MetaRegistry
//      (getDefaultRegistry + registerDslMeta) and remembered as a prep-only grant;
//   5. server/match/Match.js is imported (options.matchModule instead: tests only, like the lobby's MatchClass) and
//      wrapped so each player receives those grants, 'ready'.
// Messages (from index.js / proxy.js; queued until booted, then handled in order):
//   { type: 'create', matchId, opts }       new Match({ ...options.matchOptions, ...opts, data, log, now, send, broadcast,
//                                           onEnd }) and start() — send / broadcast / onEnd post 'send' / 'broadcast' /
//                                           'end' back; a match that cannot be created posts 'failed'
//   { type: 'call', matchId, method, args, id? }   one MATCH INTERFACE call; with `id` its answer is posted as 'reply'
//   { type: 'dispose', matchId }            the match is disposed and forgotten
// Logs go to the main process ('log': its logger prefixes them with the set's `[cs:<8 hex>]`).
// options.virtualTime (tests / tools only): the matches run on a VirtualScheduler stepped in 20 ms slices — an all-AI
// match to its end in seconds — with the heartbeats still going.

import { parentPort, workerData } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { getData, setData } from '../../data.js';
import { installOfficialBounds } from '../../../shared/plugins/officialBounds.js';
import { contentHashOf } from '../../../shared/plugins/identity.js';

/** A worker thread (parentPort), else a child process (its IPC channel). */
const viaWorker = !!parentPort;
const rawPost = viaWorker ? (m) => parentPort.postMessage(m) : (m) => { if (process.connected) process.send(m); };
const post = (m) => { try { rawPost(m); } catch (e) { try { rawPost({ type: 'log', level: 'error', text: `[host] a message could not be posted: ${e?.message || e}` }); } catch { /* gone */ } } };
/** The content set and the options: a worker's workerData now, a child process's first message (init). */
let cs = null;
let hashInput = null;
let files = null;
let bounds = null;
let scripts = [];
let sandbox = false;
/** PLUGIN API v2: the content set's interaction windows (docs/PLUGINS.md §10b) — data, injected into every match. */
let offers = [];
let options = {};
const adopt = (init) => { ({ cs, hashInput, files, bounds = null, scripts = [], sandbox = false, offers = [] } = init || {}); options = (init && init.options) || {}; };
if (viaWorker) adopt(workerData);
// a child process whose parent is gone has nothing left to do
if (!viaWorker) process.on('disconnect', () => process.exit(0));
const text = (a) => a.map((x) => (x instanceof Error ? (x.stack || x.message) : typeof x === 'string' ? x : (() => { try { return JSON.stringify(x); } catch { return String(x); } })())).join(' ').slice(0, 4000);
const log = {
  info: (...a) => post({ type: 'log', level: 'info', text: text(a) }),
  warn: (...a) => post({ type: 'log', level: 'warn', text: text(a) }),
  error: (...a) => post({ type: 'log', level: 'error', text: text(a) }),
  debug: () => {},
};
let beat = null;
const startBeat = () => { if (!beat) beat = setInterval(() => post({ type: 'hb' }), Math.max(50, Number(options.heartbeatMs) || 1000)); };
if (viaWorker) startBeat();

/** @type {any[]} messages that came before the boot finished */
const queue = [];
let booted = false;
let MatchClass = null;
let VirtualScheduler = null;
/** Prep EffectRefs this content set grants to every player. Empty when the set has no data.dsl. */
let dslGrants = [];
/** @type {Map<string, any>} */
const matches = new Map();
const ERR_INTERNAL = 'INTERNAL';

let started = viaWorker;
const onMessage = (m) => {
  if (!started) {
    // a child process: the first message is the content set (init); the boot starts then
    if (m && m.type === 'init') { started = true; adopt(m); startBeat(); run(); }
    return;
  }
  if (!booted) queue.push(m); else handle(m);
};
if (viaWorker) parentPort.on('message', onMessage); else process.on('message', onMessage);

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * Register every prep spec on this process's MetaRegistry and return the keys to grant.
 * A throw fails the boot: a match must not start with a dropped prep effect.
 * [ASSUMED] A content-set DSL meta spec is on for every player of that set. Authors cannot register global:
 * (DESIGN §32.7). The grant itself is applied when the match constructs its players.
 */
async function installPrepDsl(data) {
  const table = data && data.dsl;
  if (!table || typeof table !== 'object' || Array.isArray(table) || !Object.keys(table).length) return [];
  const { getDefaultRegistry } = await import('../effectsMeta.js');
  const { registerDslMeta } = await import('../dslMeta.js');
  const registry = getDefaultRegistry();
  const grants = [];
  const seen = new Set();
  for (const [pluginId, specs] of Object.entries(table)) {
    if (!Array.isArray(specs)) {
      const err = new Error('PLUGIN_DSL_SHAPE data.dsl: entries must be arrays');
      err.code = 'PLUGIN_DSL_SHAPE';
      throw err;
    }
    for (const spec of specs) {
      registerDslMeta(registry, spec, { pluginId });
      const key = spec && spec.meta && spec.meta.key;
      if (typeof key === 'string' && !seen.has(key)) { seen.add(key); grants.push({ key }); }
    }
  }
  return grants;
}

/** Push the set's prep grants onto each player. A probe match with no effects array is left alone. */
function grantPrepDsl(match, grants) {
  if (!grants.length || !match || !match.players || typeof match.players.values !== 'function') return;
  for (const ps of match.players.values()) {
    if (!ps || !Array.isArray(ps.effects)) continue;
    for (const g of grants) {
      if (ps.effects.some((e) => e && e.key === g.key)) continue;
      // battle: false keeps the grant out of the battle's playerEffects (player/round.js).
      ps.effects.push({ id: `dsl:${g.key}`, key: g.key, battle: false, hidden: true });
    }
  }
}

async function boot() {
  if (!hashInput || typeof hashInput !== 'object' || !hashInput.data || !files) throw new Error('no content set was given');
  if (sandbox) for (const name of Object.keys(files)) files[name] = Uint8Array.from(files[name]);
  for (const [name, h] of Object.entries(hashInput.data)) {
    // (a child process receives the bytes as a Uint8Array: the IPC channel's structured clone)
    const b = files[name];
    if (!b) throw new Error(`data/${name}.json is missing`);
    if (sha256(b) !== h) throw new Error(`data/${name}.json does not match its hash in the content set (changed on disk since the server started?)`);
  }
  if (contentHashOf(hashInput) !== cs) throw new Error('the content set does not hash to its cs');
  const decoder = new TextDecoder('utf-8');
  /** @type {Record<string, any>} */
  const data = {};
  for (const name of Object.keys(hashInput.data)) data[name] = JSON.parse(decoder.decode(files[name]));
  setData(data);
  installOfficialBounds(bounds && bounds.v === 1 ? bounds : null);
  if (Object.values(data.garrisons ?? {}).some(g => g.operatorTrait)) {
    const { installServerOperatorTraits } = await import('../../plugins/operatorTraits.js');
    await installServerOperatorTraits(data);
  }
  if (scripts.length) {
    const { verifyScripts, scriptExecution, loadScripts } = await import('../../../shared/plugins/scriptLoad.js');
    verifyScripts(scripts, hashInput);
    if (sandbox !== (scriptExecution(scripts) === 'sandbox')) throw new Error('script execution mode mismatch');
    if (sandbox) {
      if (viaWorker || !process.permission || process.env.SP_PLUGIN_SCRIPTS !== 'sandbox') throw new Error('PLUGIN_SANDBOX_DISABLED');
      const sandboxModule = await import('../../../shared/plugins/sandbox.js');
      await sandboxModule.initializeSandbox({ loadSES: () => import('ses') });
      await import('../../sim/spec.js');
      const { parse } = await import('acorn');
      await sandboxModule.installSandboxScripts(scripts, { hashInput, parse, log: log.info });
    } else await loadScripts(scripts, { hashInput, log: log.info });
  }
  // After setData, before Match: Match reads opts.registry || getDefaultRegistry(), the same singleton.
  dslGrants = await installPrepDsl(data);
  const mod = await import(typeof options.matchModule === 'string' && options.matchModule ? pathToFileURL(options.matchModule).href : '../Match.js');
  const Inner = mod.Match || mod.default;
  if (typeof Inner !== 'function') throw new Error('the match module exports no Match');
  // [ASSUMED] Grant the prep EffectRefs after super(), once players exist (DESIGN §32.7).
  MatchClass = class ContentMatch extends Inner {
    constructor(opts) {
      // Rules come from the verified content identity, never the per-room create payload.
      const bound = { ...opts, offers };
      delete bound.rules;
      if (hashInput.rules) bound.rules = hashInput.rules;
      super(bound);
      grantPrepDsl(this, dslGrants);
    }
  };
  if (options.virtualTime) ({ VirtualScheduler } = await import('../scheduler.js'));
}

/** A MATCH INTERFACE method a match class may lack: what the platform does then (server/lobby.js callMatch). */
function fallback(match, method, args) {
  if (method === 'onLeave' && typeof match.onDisconnect === 'function') return match.onDisconnect(...args);
  if (method === 'setLoadout') return { error: 'ROOM_STARTED', detail: 'stored for the next match' };
  if (method === 'requestSetupReroll' || method === 'cancelSetupReroll') return { error: 'WRONG_PHASE' };
  return undefined;
}

/** A plain copy of a match's answer that a MessagePort can carry. */
function plain(r) {
  if (r == null || typeof r !== 'object') return r ?? { ok: true };
  try { return JSON.parse(JSON.stringify(r)); } catch { return { error: ERR_INTERNAL }; }
}

/** The diagnostics of a match (tests): its phase, errors, verify counters and fields. */
function diag(match) {
  return {
    phase: match.phase ?? null, round: match.round ?? null, ended: !!match.ended, cs: match.cs ?? null, modeId: match.modeId ?? null,
    errorCount: match.errorCount ?? 0, errors: (match.errors || []).slice(0, 3).map((e) => String(e?.label || e?.message || e).slice(0, 200)),
    verifyStats: match.verifyStats ? { ...match.verifyStats } : null, simErrors: match.simErrors ?? 0,
    fields: Array.isArray(match.fields) ? match.fields.map((f) => ({ fieldId: f.fieldId, kind: f.kind, players: Array.isArray(f.players) ? [...f.players] : [], mode: f.mode ?? null,
      authority: f.authority ?? null, done: !!f.done, resultSource: f.resultSource ?? null, battleId: f.battleId ?? null })) : [],
  };
}

function create(matchId, opts) {
  const sched = options.virtualTime && VirtualScheduler ? new VirtualScheduler({ start: Date.now() }) : null;
  let match;
  try {
    match = new MatchClass({
      ...(options.matchOptions || {}),
      ...opts,
      // the content set installed at boot (server/data.js getData)
      data: installed,
      // the match names itself in its lines ([match <code>] …), as in the server process (the host adds [cs:<8 hex>])
      log,
      now: Date.now,
      send: (playerId, msg) => { post({ type: 'send', matchId, playerId, msg }); return true; },
      broadcast: (msg) => post({ type: 'broadcast', matchId, msg }),
      onEnd: (summary) => post({ type: 'end', matchId, summary: plain(summary) }),
      ...(sched ? { scheduler: sched } : {}),
    });
  } catch (e) {
    log.error(`[host] match ${matchId} could not be created`, e);
    post({ type: 'failed', matchId, error: String(e?.message || e).slice(0, 300) });
    return;
  }
  matches.set(matchId, match);
  try { match.start(); } catch (e) {
    log.error(`[host] match ${matchId} failed to start`, e);
    matches.delete(matchId);
    try { match.dispose?.(); } catch { /* ignore */ }
    post({ type: 'failed', matchId, error: String(e?.message || e).slice(0, 300) });
    return;
  }
  if (sched) pump(match, sched);
}

/** server/data.js getData() is the content set after the boot (setData): every match gets it as its data. */
let installed = null;

/** Virtual time (tests): run the match's scheduler in slices, the heartbeats in between. */
function pump(match, sched) {
  const slice = () => {
    if (match.disposed || !matches.has(findId(match))) return;
    const t0 = Date.now();
    while (sched.pending() > 0 && Date.now() - t0 < 20) sched.runNext(); // loop-cap: 20 ms of wall time a slice (virtual time, tests only)
    if (sched.pending() > 0) setImmediate(slice);
  };
  setImmediate(slice);
}
const findId = (match) => { for (const [id, m] of matches) if (m === match) return id; return null; };

function handle(m) {
  if (!m || typeof m !== 'object') return;
  if (m.type === 'create') { if (!matches.has(m.matchId)) create(m.matchId, m.opts || {}); return; }
  const match = matches.get(m.matchId);
  if (m.type === 'dispose') {
    if (match) { matches.delete(m.matchId); try { match.dispose?.(); } catch (e) { log.error(`[host] match ${m.matchId} dispose threw`, e); } }
    return;
  }
  if (m.type === 'call') {
    let result;
    if (!match) result = { error: 'WRONG_PHASE', detail: 'no running match' };
    else if (m.method === 'diag') result = diag(match);
    else {
      try {
        const fn = match[m.method];
        result = typeof fn === 'function' ? fn.apply(match, Array.isArray(m.args) ? m.args : []) : fallback(match, m.method, m.args || []);
      } catch (e) {
        log.error(`[host] match ${m.matchId} ${m.method} threw`, e);
        result = { error: ERR_INTERNAL };
      }
    }
    if (m.id != null) post({ type: 'reply', matchId: m.matchId, id: m.id, result: plain(result) });
  }
}

function run() {
  boot().then(async () => {
    installed = getData();
    booted = true;
    post({ type: 'ready' });
    for (const m of queue.splice(0)) handle(m);
  }, (e) => {
    post({ type: 'boot-error', error: String(e?.message || e).slice(0, 300) });
    log.error('[host] the content set did not boot', e);
    setTimeout(() => process.exit(1), 50);
  });
}
if (viaWorker) run();
