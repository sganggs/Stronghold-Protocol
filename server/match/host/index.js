// server/match/host/index.js — where a room's match runs (DESIGN §32.6, P1c; the design study's §6.4 方案 B):
//
//   * the vanilla content set — and a room whose plugins are all cosmetic (its cs is the vanilla one) — runs its match in
//     this process exactly as before: server/lobby.js does `new MatchClass(opts)` itself and never asks the hosts;
//   * a content set with gameplay plugins runs its matches in a match host of its own — a child process by default, a
//     worker thread when asked (server/match/host/entry.js runs in either) — shared by every room that plays that set (one
//     host per `cs`, any number of matches in it; "worker" below means either): its module table holds that set's data
//     and registries, so a plugin's data can never leak into another room, and a plugin that hangs or crashes its host
//     ends that set's matches only.
//
//   create(cs, opts) → a MatchProxy (server/match/host/proxy.js) — the lobby's room.match. The worker is started on the
//     first match of a set (the set's data bytes and hash input from server/plugins/contentSets.js: the worker checks them
//     against `cs` before it imports the match) and kept while it has matches, then IDLE_MS more [ASSUMED 10 min: the
//     design study's]; a new set needing a worker when `maxWorkers` run stops an idle one first, else PLUGIN_BUSY.
//   Watchdog: every worker posts a heartbeat each heartbeatMs (1 s); one silent for watchdogMs (10 s) [ASSUMED: the design
//     study's] is terminated and each of its matches ends with 'plugin-hang' (the room back in its lobby, its members told:
//     proxy.js crash). A worker that exits on its own (an uncaught error, ERR_WORKER_OUT_OF_MEMORY past `resourceLimits`)
//     ends them with 'plugin-crash'; one whose content set does not boot, with 'plugin-start'. The log names the set and
//     its plugins.
//   resourceLimits [ASSUMED]: 768 MB old generation, 64 MB young generation, 4 MB stack per worker (options.resourceLimits;
//   a child process gets the old-generation limit as --max-old-space-size).
//   Transport (options.transport, env SP_MATCH_HOST): 'process' — a child process (child_process.fork), the DEFAULT — or
//   'worker' — a worker thread (the design study's first choice), only when asked for. Measured on Node 22.22 (DESIGN
//   §32.6): a worker thread that runs out of its memory limit through one large allocation (`new Array(n).fill(…)`, an
//   array or a Map grown to hundreds of MB — what a data plugin's extreme number can make the match do) is NOT stopped
//   with ERR_WORKER_OUT_OF_MEMORY but aborts the WHOLE server process (exit 134, "FATAL ERROR: … Allocation failed"),
//   vanilla rooms included; only an allocation of many small objects ends the worker alone. A child process that runs out
//   of memory aborts alone (SIGABRT) and its matches end with 'plugin-crash' — hence the default (the coordinator's
//   decision of 2026-10-14, after the review).
//   stats() → { workers, matches, transport } (/healthz); close() terminates every worker (server shutdown).
//
// Official versions (DESIGN §35.23, M1; option `kind: 'version'`): the same hosts run a non-default official version's
//   matches (server/index.js builds a second pool over server/versions.js — one host per version `cs`, counted apart
//   from the plugin hosts: `maxWorkers` is the server's maxHosts). Its log lines say `[versions]` and name the version;
//   its matches end with 'version-crash' / 'version-hang' / 'version-start' (proxy.js: the version msgids), and a full
//   pool refuses with INTERNAL 'version hosts busy'. The same defaults (idle 10 min).
//
// Options (startServer `matchHost`): transport, maxWorkers (default: the content-set limit, 4), heartbeatMs, watchdogMs,
// idleMs, resourceLimits, matchOptions (JSON-safe Match options every hosted match gets — the e2e and host tests scale
// the timers with it), and for tests only: matchModule (a module whose `Match` replaces server/match/Match.js in the
// workers), virtualTime (the matches run on a virtual clock).

import { Worker } from 'node:worker_threads';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ERR } from '../../../shared/constants.js';
import { csUrlPart } from '../../../shared/plugins/identity.js';
import { MatchProxy } from './proxy.js';
import { validHostMessage } from './ipc.js';
import { scriptExecution, verifyScripts } from '../../../shared/plugins/scriptLoad.js';
import { forkSandbox, sandboxInit, scriptMode } from './childHost.js';

const ENTRY = fileURLToPath(new URL('./entry.js', import.meta.url));
const noopLog = { info() {}, warn() {}, error() {}, debug() {} };

/** Defaults [ASSUMED] (see the header). */
export const HOST_DEFAULTS = Object.freeze({
  transport: 'process',
  maxWorkers: 4,
  heartbeatMs: 1000,
  watchdogMs: 10_000,
  idleMs: 10 * 60_000,
  resourceLimits: Object.freeze({ maxOldGenerationSizeMb: 768, maxYoungGenerationSizeMb: 64, stackSizeMb: 4 }),
});

/** An error the lobby turns into a refusal (start). */
export class HostError extends Error {
  /** @param {string} code an ERR code @param {string} message */
  constructor(code, message) { super(message); this.code = code; }
}

/**
 * The match hosts of one server.
 * @param {{ contents: { get: (cs: string) => any, dataBytes: (cs: string) => Record<string, Buffer> | null },
 *   log?: object, options?: Partial<typeof HOST_DEFAULTS> & { matchOptions?: object, matchModule?: string, virtualTime?: boolean,
 *   kind?: 'plugins' | 'version' } }} deps
 *   kind: 'plugins' (the content sets of gameplay plugins, the default) or 'version' (official versions — the header)
 */
export function createMatchHosts({ contents, log = noopLog, options = {} }) {
  const o = { ...HOST_DEFAULTS, ...options };
  const versionKind = o.kind === 'version';
  /** the log prefix and the stop reasons of this pool's hosts (the header) */
  const P = versionKind ? '[versions]' : '[plugins]';
  const R = versionKind
    ? { crash: 'version-crash', hang: 'version-hang', start: 'version-start' }
    : { crash: 'plugin-crash', hang: 'plugin-hang', start: 'plugin-start' };
  /** @type {Map<string, WorkerHost>} by cs */
  const hosts = new Map();
  let seq = 0;
  let closed = false;

  /** One worker (or child process) and the matches of its content set. */
  class WorkerHost {
    constructor(cs) {
      this.cs = cs;
      /** 'version' hosts: the match's stop reasons name the version (proxy.js crashMessage) */
      this.kind = versionKind ? 'version' : 'plugins';
      const set = contents.get(cs);
      this.tag = versionKind && set?.name ? `[${set.name}]` : `[cs:${csUrlPart(cs).slice(0, 8)}]`;
      const files = set ? contents.dataBytes(cs) : null;
      if (!set || !files) throw new HostError(ERR.INTERNAL, `the content set ${csUrlPart(cs)} is not kept by this server`);
      const scripts = set.scripts || [];
      if (scripts.length) verifyScripts(scripts, set.hashInput);
      const sandbox = scriptExecution(scripts) === 'sandbox';
      if (sandbox && scriptMode() !== 'sandbox') throw new HostError('PLUGIN_SANDBOX_DISABLED', 'SP_PLUGIN_SCRIPTS=sandbox required');
      if (sandbox && scripts.some(p => p.class !== 'script')) throw new HostError('PLUGIN_SANDBOX_CLASS', 'trusted plugins must never enter SES');
      this.plugins = versionKind ? String(set.name || csUrlPart(cs)) : (set.plugins || []).map((p) => `${p.id}@${p.version}`).join(', ');
      /** @type {Map<string, MatchProxy>} */
      this.matches = new Map();
      this.lastBeat = Date.now();
      this.ready = false;
      this.dead = null;
      this.idleTimer = null;
      const init = {
        cs, hashInput: set.hashInput, files, bounds: set.bounds ?? null, scripts, sandbox,
        // PLUGIN API v2: the set's interaction windows (docs/PLUGINS.md §10b) — data only; the host injects them into
        // every match it runs (server/match/host/entry.js), so the engine owns the window and no plugin code runs here
        offers: Array.isArray(set.offers) ? set.offers : [],
        options: { heartbeatMs: o.heartbeatMs, matchOptions: o.matchOptions || {}, matchModule: o.matchModule || null, virtualTime: !!o.virtualTime },
      };
      const failed = (e) => {
        log.error?.(`${P} match host ${this.tag} (${this.plugins}) failed: ${e?.code || ''} ${e?.message || e}`);
        this.stop(this.ready ? R.crash : R.start, `${e?.code || ''} ${e?.message || e}`.trim());
      };
      const exited = (code, signal) => {
        if (!this.dead) {
          log.warn?.(`${P} match host ${this.tag} (${this.plugins}) exited (${signal ? `signal ${signal}` : `code ${code}`})`);
          this.stop(this.ready ? R.crash : R.start, `the match host exited (${signal ? `signal ${signal}` : `code ${code}`})`);
        }
        if (hosts.get(this.cs) === this) hosts.delete(this.cs);
      };
      // a worker thread only when asked for by name (anything else: a child process — the header's measurement)
      this.transport = !scripts.length && o.transport === 'worker' ? 'worker' : 'process';
      if (this.transport === 'process') {
        // a child process: its memory limit is its own (an out-of-memory abort ends it alone — see the header)
        const mb = Math.max(64, Number(o.resourceLimits?.maxOldGenerationSizeMb) || HOST_DEFAULTS.resourceLimits.maxOldGenerationSizeMb);
        this.child = sandbox ? forkSandbox(ENTRY, { memoryMb: mb }) : fork(ENTRY, [], { execArgv: [`--max-old-space-size=${mb}`], serialization: 'advanced', stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
        // the last lines it printed (an abort's "FATAL ERROR …") go into the log when it dies
        this.stderr = '';
        this.child.stderr?.on('data', (d) => { this.stderr = (this.stderr + String(d)).slice(-2000); });
        this.child.on('message', (m) => this.onMessage(m));
        this.child.on('error', failed);
        this.child.on('exit', (code, signal) => {
          if (!this.dead && this.stderr.trim()) log.warn?.(`${P} match host ${this.tag} printed: ${this.stderr.trim().split('\n').slice(0, 3).join(' | ')}`);
          exited(code, signal);
        });
        this.child.unref?.();
        this.child.channel?.unref?.();
        this.send = (m) => { if (this.child.connected) this.child.send(m); };
        this.kill = () => { try { this.child.kill('SIGKILL'); } catch { /* gone */ } };
        this.send({ type: 'init', ...(sandbox ? sandboxInit(init) : init) });
      } else {
        this.worker = new Worker(ENTRY, { workerData: init, resourceLimits: { ...o.resourceLimits }, stdout: false, stderr: false });
        this.worker.unref?.();
        this.worker.on('message', (m) => this.onMessage(m));
        this.worker.on('error', failed);
        this.worker.on('exit', (code) => exited(code, null));
        this.send = (m) => this.worker.postMessage(m);
        this.kill = () => { try { this.worker.terminate(); } catch { /* gone */ } };
      }
      log.info?.(`${P} match host ${this.tag} started for ${this.plugins} (${this.transport})`);
    }

    post(m) {
      if (this.dead) {
        // a message for a host already gone: its match learns it at once
        const p = this.matches.get(m.matchId);
        if (p) queueMicrotask(() => p.crash(this.dead.reason, this.dead.detail));
        return;
      }
      try { this.send(m); } catch (e) { log.warn?.(`${P} match host ${this.tag} cannot take a message: ${e?.message || e}`); }
    }

    forget(matchId) {
      this.matches.delete(matchId);
      this.armIdle();
    }

    armIdle() {
      if (this.dead || this.matches.size || this.idleTimer) return;
      this.idleTimer = setTimeout(() => { this.idleTimer = null; if (!this.matches.size) this.stop(null, 'idle'); }, o.idleMs);
      this.idleTimer.unref?.();
    }

    onMessage(m) {
      if (!validHostMessage(m)) return;
      if (m.type === 'hb') { this.lastBeat = Date.now(); return; }
      if (m.type === 'log') {
        const fn = log[m.level];
        fn?.call(log, `${this.tag} ${m.text}`);
        return;
      }
      if (m.type === 'ready') { this.ready = true; this.lastBeat = Date.now(); log.info?.(`${P} match host ${this.tag} ready`); return; }
      if (m.type === 'boot-error') {
        log.error?.(`${P} match host ${this.tag} (${this.plugins}) did not boot: ${m.error}`);
        this.stop(R.start, String(m.error || ''));
        return;
      }
      const p = this.matches.get(m.matchId);
      if (p) p.deliver(m);
    }

    /**
     * Stop the worker: its matches end with `reason` (null: none left — an idle stop or the server's shutdown).
     * @param {string | null} reason 'plugin-crash' | 'plugin-hang' | 'plugin-start' (a 'version' pool: 'version-…') @param {string} [detail]
     */
    stop(reason, detail = '') {
      if (this.dead) return;
      this.dead = { reason: reason || R.crash, detail };
      if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
      if (hosts.get(this.cs) === this) hosts.delete(this.cs);
      this.kill();
      const list = [...this.matches.values()];
      this.matches.clear();
      if (reason && list.length) log.warn?.(`${P} match host ${this.tag} (${this.plugins}) stopped (${reason}${detail ? `: ${detail}` : ''}) — ${list.length} match(es) ended`);
      for (const p of list) { try { if (reason) p.crash(reason, detail); else p.halt(); } catch (e) { log.error?.(`${P} crash handler failed`, e); } }
    }
  }

  // the watchdog: a worker whose heartbeats stopped is terminated (its matches end)
  const watchdog = setInterval(() => {
    const now = Date.now();
    for (const h of [...hosts.values()]) if (!h.dead && now - h.lastBeat > o.watchdogMs) h.stop(R.hang, `no heartbeat for ${Math.round((now - h.lastBeat) / 1000)} s`);
  }, Math.max(100, Math.min(1000, Math.floor(o.watchdogMs / 4))));
  watchdog.unref?.();

  /** A worker for `cs`: the running one, or a new one (an idle one of another set stopped when the limit is reached). */
  function hostFor(cs) {
    const cur = hosts.get(cs);
    if (cur && !cur.dead) return cur;
    if (hosts.size >= o.maxWorkers) {
      const idle = [...hosts.values()].find((h) => !h.matches.size);
      if (idle) idle.stop(null, 'room for another content set');
      else if (versionKind) throw new HostError(ERR.INTERNAL, 'version hosts busy');
      else throw new HostError(ERR.PLUGIN_BUSY, `${hosts.size} match hosts run (limit ${o.maxWorkers})`);
    }
    const h = new WorkerHost(cs);
    hosts.set(cs, h);
    return h;
  }

  return {
    /**
     * The match of a room playing the content set `cs` (with gameplay plugins), run in that set's worker.
     * @param {string} cs @param {any} opts the lobby's Match options (send / broadcast / onEnd stay here)
     * @returns {MatchProxy}
     */
    create(cs, opts) {
      if (closed) throw new HostError(ERR.INTERNAL, 'the server is stopping');
      const h = hostFor(cs);
      if (h.idleTimer) { clearTimeout(h.idleTimer); h.idleTimer = null; }
      const matchId = `${opts.roomCode ?? 'room'}-${opts.matchNo ?? 0}-${++seq}`;
      const proxy = new MatchProxy({ host: h, matchId, opts, log });
      h.matches.set(matchId, proxy);
      return proxy;
    },
    /** Workers running and the matches in them (/healthz). */
    stats() {
      let matches = 0;
      for (const h of hosts.values()) matches += h.matches.size;
      return { workers: hosts.size, matches, transport: o.transport === 'worker' ? 'worker' : 'process' };
    },
    /** Stop every worker (the server stops; the lobby has disposed its rooms first). */
    close() {
      closed = true;
      clearInterval(watchdog);
      for (const h of [...hosts.values()]) h.stop(null, 'shutdown');
    },
    /** Test hook: the worker of a set (its thread id, its state). */
    _host: (cs) => hosts.get(cs) || null,
  };
}
