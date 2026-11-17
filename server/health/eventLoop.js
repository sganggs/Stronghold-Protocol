// server/health/eventLoop.js — a main-thread event-loop delay sampler.
//
// Why it exists: when the hall stalls, the operator has to tell whether the stall is the rehearsal / battle slice running
// on the main thread or something else. A thread pool cannot answer that — and the pool is off by default anyway — so
// this sampler reads the main thread's own loop, needs no pool, is off by default, and writes a *local* line only.
//
// It deliberately does NOT extend /healthz: the maintainer asked for a bounded local log, not a public endpoint. Every
// line is one window: the loop delay percentiles, the CPU and memory the process used over that window, and the room /
// player / spectator counts with the phase the hall was in. At most LOOP_LOG_MAX lines are kept in memory.
//
// SP_LOOP_SAMPLE=1 turns it on; SP_LOOP_WINDOW_MS sets the window (100 ms .. 1 h).
import { monitorEventLoopDelay } from 'node:perf_hooks';

/** Where the sampler's window defaults to, and the bounds SP_LOOP_WINDOW_MS is held to. */
export const LOOP_WINDOW_MS = 60000;
const MIN_WINDOW_MS = 100;
const MAX_WINDOW_MS = 3600000;
/** How many recent windows are kept for inspection (never grows with uptime). */
export const LOOP_LOG_MAX = 120;

/**
 * The sampler's configuration. Unlike the worker pool this is off by default: an operator who never sets anything still
 * gets the numbers that decide whether phase 3 is worth reviewing.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ enabled: boolean, windowMs: number }}
 */
export function eventLoopSettings(env = process.env) {
  const raw = env.SP_LOOP_SAMPLE;
  const enabled = String(raw || '').trim() === '1';
  const n = Number(env.SP_LOOP_WINDOW_MS);
  const windowMs = Number.isInteger(n) && n >= MIN_WINDOW_MS && n <= MAX_WINDOW_MS ? n : LOOP_WINDOW_MS;
  return { enabled, windowMs };
}

const ms = (ns) => Math.round((ns / 1e6) * 10) / 10;

/**
 * A sampler over the main thread's event loop.
 *
 * @param {object} [opts]
 * @param {{ info?: Function, warn?: Function }} [opts.log] where lines go (defaults to console)
 * @param {number} [opts.windowMs] window length; defaults to eventLoopSettings()
 * @param {number} [opts.keep] how many recent windows to keep
 * @param {{ enable(): void, disable(): void, reset(): void, percentile(p: number): number, count: number,
 *   min: number, max: number, mean: number }} [opts.histogram] the delay histogram (injectable for tests)
 * @param {() => object} [opts.counts] the hall counts reported with each window
 */
export function createEventLoopSampler({ log = console, windowMs, keep = LOOP_LOG_MAX, histogram, counts = null } = {}) {
  const settings = eventLoopSettings();
  const window = windowMs ?? settings.windowMs;
  const maxLines = Math.max(1, Math.min(LOOP_LOG_MAX, keep));
  const hist = histogram ?? monitorEventLoopDelay({ resolution: 20 });
  const recent = [];
  let timer = null;
  let baseline = null;

  /** @param {object} [extra] counts for this window (rooms / humans / matches / spectators / phase) */
  function snapshot(extra = null) {
    const stats = {
      samples: hist.count,
      min: ms(hist.min),
      mean: ms(hist.mean),
      p50: ms(hist.percentile(50)),
      p95: ms(hist.percentile(95)),
      p99: ms(hist.percentile(99)),
      max: ms(hist.max),
    };
    hist.reset();
    return { ...stats, ...(extra ?? {}) };
  }

  /** Take the CPU and memory the process used since the previous window. */
  function usage() {
    const now = Date.now();
    const cpu = process.cpuUsage();
    const mem = process.memoryUsage();
    const prev = baseline ?? { at: now, user: cpu.user, system: cpu.system };
    const elapsed = Math.max(1, now - prev.at);
    const spentMs = (cpu.user - prev.user + cpu.system - prev.system) / 1000;
    baseline = { at: now, user: cpu.user, system: cpu.system };
    return { cpu: Math.round((spentMs / elapsed) * 100), mem: Math.round(mem.rss / (1024 * 1024)) };
  }

  /** @param {object} [extra] counts for this window */
  function report(extra = null) {
    const countsNow = counts ? counts() : null;
    const { cpu, mem } = usage();
    const record = { ...snapshot(), ...(countsNow && typeof countsNow === 'object' ? countsNow : {}), ...(extra ?? {}), cpu, mem };
    recent.push(record);
    if (recent.length > maxLines) recent.splice(0, recent.length - maxLines);
    log.info?.(`[loop] p50=${record.p50}ms p95=${record.p95}ms p99=${record.p99}ms max=${record.max}ms ` +
      `samples=${record.samples} cpu=${record.cpu}% mem=${record.mem}MB ` +
      `rooms=${record.rooms ?? 0} matches=${record.matches ?? 0} humans=${record.humans ?? 0} ` +
      `spectators=${record.spectators ?? 0} phase=${record.phase ?? 'idle'} rehearsals=${record.rehearsals ?? 0}`);
    return record;
  }

  return {
    get running() { return timer != null; },
    /** The thread count this sampler needs: it observes the main thread, so it never starts a pool. */
    stats() { return { pools: 0, windowMs: window, samples: hist.count }; },
    recent() { return recent.slice(); },
    snapshot,
    report,
    /** Report one window now (the timer does this on its own; tests and shutdown use it directly). */
    sampleOnce(extra = null) { return report(extra); },
    start() {
      if (timer != null) return;
      hist.enable();
      // Seed the CPU baseline so the first window reports the window's own usage, not the process's lifetime.
      baseline = (() => { const c = process.cpuUsage(); return { at: Date.now(), user: c.user, system: c.system }; })();
      timer = setInterval(() => { report(); }, window);
      timer.unref?.();
    },
    stop() {
      if (timer == null) return;
      clearInterval(timer);
      timer = null;
      hist.disable();
    },
    close() { this.stop(); },
  };
}

/**
 * The sampler a server runs with, or null unless SP_LOOP_SAMPLE=1.
 * @param {{ log?: object, env?: NodeJS.ProcessEnv, counts?: () => object, windowMs?: number }} [opts]
 */
export function createEventLoopMonitor({ log = console, env = process.env, counts = null, windowMs } = {}) {
  const settings = eventLoopSettings(env);
  if (!settings.enabled) return null;
  return createEventLoopSampler({ log, windowMs: windowMs ?? settings.windowMs, counts });
}
