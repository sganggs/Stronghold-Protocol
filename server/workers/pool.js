// One process-wide pool for CPU work. Each thread loads game data once; tasks carry only battle inputs.
//
// SP_WORKERS is opt-in: unset (or junk) means NO pool at all, see createSimulationPool — the server keeps doing the work
// inline, exactly as before the pool existed. Set it to a thread count (1..32) to turn the pool on; 0 is the explicit
// "off" and stays off. SP_WORKER_QUEUE bounds the queue and SP_WORKER_TIMEOUT_MS the per-task timeout. A thread that is
// being terminated after a crash or a timeout keeps its place in the size budget until it has actually stopped, so the
// pool never runs more threads than its size and never overruns its queue while a thread is retiring.
import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';

/** The thread count the default (no SP_WORKERS) would pick — kept for callers that want to report it without starting a pool. */
export function defaultWorkerCount(cpus = availableParallelism()) {
  return Math.min(8, Math.max(1, cpus - 2));
}

export function workerSettings(env = process.env) {
  const integer = (value, fallback, min, max) => {
    if (value == null || String(value).trim() === '') return fallback;
    const n = Number(value);
    return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
  };
  // Opt-in: an unset SP_WORKERS is 0 (no pool), not a CPU-derived count. A server only starts threads when the operator
  // asked for them; junk falls back to the same safe, off state. Nothing here depends on the CPU count any more, which
  // is why the old `cpus` parameter is gone — a pool that does not exist never needed a size.
  return {
    size: integer(env.SP_WORKERS, 0, 0, 32),
    maxQueue: integer(env.SP_WORKER_QUEUE, 256, 0, 10000),
    timeoutMs: integer(env.SP_WORKER_TIMEOUT_MS, 120000, 1, 3600000),
  };
}

const failure = (code, message) => Object.assign(new Error(message), { code });

export class SimulationPool {
  // A pool always has at least one thread when it exists at all: createSimulationPool / workerSettings decide whether to
  // start one (unset or 0 SP_WORKERS = no pool), so the constructor's fallback is the CPU-derived count, never 0.
  constructor({ data, size = defaultWorkerCount(), maxQueue = 256, timeoutMs = 120000,
    workerUrl = new URL('./simulation.js', import.meta.url) } = {}) {
    if (!Number.isInteger(size) || size < 1 || size > 32) throw new RangeError('worker size must be 1..32');
    if (!Number.isInteger(maxQueue) || maxQueue < 0 || maxQueue > 10000) throw new RangeError('maxQueue must be 0..10000');
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3600000) throw new RangeError('timeoutMs must be 1..3600000');
    this.data = data;
    this.size = size;
    this.maxQueue = maxQueue;
    this.timeoutMs = timeoutMs;
    this.workerUrl = workerUrl;
    this.slots = new Set();
    this.queue = [];
    this.nextId = 0;
    this.closed = false;
    this.terminations = new Set();
    this.counters = { submitted: 0, completed: 0, failed: 0, cancelled: 0, rejected: 0,
      queueMs: 0, computeMs: 0 };
  }

  stats() {
    return { size: this.size, threads: this.slots.size, busy: [...this.slots].filter((s) => s.task).length,
      queued: this.queue.length, maxQueue: this.maxQueue, timeoutMs: this.timeoutMs,
      avgComputeMs: this.counters.completed > 0 ? this.counters.computeMs / this.counters.completed : 0,
      ...this.counters,
      memory: [...this.slots].map((s) => ({ threadId: s.worker.threadId, busy: !!s.task, sample: s.memory || null })) };
  }

  submit(type, payload, { priority = 0, onProgress = null } = {}) {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    const task = { id: ++this.nextId, type, payload, priority, onProgress, resolve, reject, settled: false,
      enqueuedAt: performance.now(), flag: new Int32Array(new SharedArrayBuffer(4)), slot: null, timer: null };
    const handle = { promise, cancel: () => this._cancel(task) };
    // Free means neither retired nor busy. A thread that is stopping keeps its place in the size budget until
    // terminate() resolves, so it must not make the queue look drainable and let submit() overrun maxQueue.
    if (this.closed || (this.queue.length >= this.maxQueue &&
        this.slots.size >= this.size && ![...this.slots].some((s) => !s.retired && !s.task))) {
      this.counters.rejected++;
      this._settle(task, failure(this.closed ? 'POOL_CLOSED' : 'POOL_FULL', 'simulation pool unavailable'));
      return handle;
    }
    this.counters.submitted++;
    task.timer = setTimeout(() => {
      if (task.settled) return;
      this.counters.failed++;
      Atomics.store(task.flag, 0, 1);
      this._settle(task, failure('TASK_TIMEOUT', 'simulation task timed out'));
      if (task.slot) this._retire(task.slot);
      else this.queue = this.queue.filter((t) => t !== task);
      this._drain();
    }, this.timeoutMs);
    task.timer.unref?.();
    this.queue.push(task);
    this.queue.sort((a, b) => b.priority - a.priority || a.id - b.id);
    this._drain();
    return handle;
  }

  _settle(task, err, value) {
    if (task.settled) return;
    task.settled = true;
    clearTimeout(task.timer);
    const { resolve, reject } = task;
    // The cancel handle may remain on a field after completion; it must not retain the input and progress closure.
    task.payload = null;
    task.onProgress = null;
    task.resolve = null;
    task.reject = null;
    task.timer = null;
    if (err) reject(err);
    else resolve(value);
  }

  _cancel(task) {
    if (task.settled) return;
    this.counters.cancelled++;
    Atomics.store(task.flag, 0, 1);
    this.queue = this.queue.filter((t) => t !== task);
    this._settle(task, failure('TASK_CANCELLED', 'simulation task cancelled'));
    // A running task keeps its slot until it observes the shared cancellation flag.
    if (task.slot) {
      task.timer = setTimeout(() => this._retire(task.slot), Math.min(1000, this.timeoutMs));
      task.timer.unref?.();
    }
  }

  _spawn() {
    const worker = new Worker(this.workerUrl, { workerData: { data: this.data } });
    const slot = { worker, task: null, retired: false };
    this.slots.add(slot);
    worker.on('message', (msg) => {
      if (msg.memory) slot.memory = msg.memory;
      const task = slot.task;
      if (slot.retired || !task || msg.id !== task.id) return;
      if (msg.progress) {
        if (!task.settled && task.onProgress) {
          try { task.onProgress(msg.progress); } catch (err) { this._retire(slot, err); }
        }
        return;
      }
      clearTimeout(task.timer);
      slot.task = null;
      task.slot = null;
      this.counters.computeMs += performance.now() - task.startedAt;
      if (!task.settled) {
        if (msg.error) {
          this.counters.failed++;
          this._settle(task, failure('TASK_FAILED', msg.error));
        } else {
          this.counters.completed++;
          this._settle(task, null, msg.value);
        }
      }
      worker.unref();
      this._drain();
    });
    worker.on('error', (err) => { this._retire(slot, err); this._drain(); });
    worker.on('exit', (code) => {
      if (!slot.retired) { this._retire(slot, new Error(`simulation worker exited (${code})`)); this._drain(); }
    });
    worker.unref();
    return slot;
  }

  _retire(slot, err = new Error('simulation worker stopped')) {
    if (!slot || slot.retired) return;
    slot.retired = true;
    if (slot.task) clearTimeout(slot.task.timer);
    if (slot.task && !slot.task.settled) {
      this.counters.failed++;
      this._settle(slot.task, failure('WORKER_FAILED', err.message));
    }
    if (slot.task) slot.task.slot = null;
    slot.task = null;
    // Keep the retiring thread in the size budget until it has actually stopped.
    const stopping = slot.worker.terminate().catch(() => {}).then(() => {
      this.slots.delete(slot);
      this.terminations.delete(stopping);
      this._drain();
    });
    this.terminations.add(stopping);
  }

  _drain() {
    if (this.closed) return;
    while (this.queue.length) {
      let slot = [...this.slots].find((s) => !s.retired && !s.task);
      if (!slot && this.slots.size >= this.size) break;
      const task = this.queue.shift();
      try {
        if (!slot) slot = this._spawn();
        slot.task = task;
        task.slot = slot;
        task.startedAt = performance.now();
        this.counters.queueMs += task.startedAt - task.enqueuedAt;
        slot.worker.ref();
        slot.worker.postMessage({ id: task.id, type: task.type, payload: task.payload, cancel: task.flag.buffer });
      } catch (err) {
        this.counters.failed++;
        this._settle(task, failure('WORKER_FAILED', err.message));
        if (slot) this._retire(slot, err);
      }
    }
  }

  async close() {
    if (this.closing) return this.closing;
    this.closed = true;
    for (const task of this.queue) this._settle(task, failure('POOL_CLOSED', 'simulation pool closed'));
    this.queue = [];
    const slots = [...this.slots];
    this.slots.clear();
    this.closing = Promise.all([...this.terminations, ...slots.filter((slot) => !slot.retired).map((slot) => {
      slot.retired = true;
      if (slot.task) {
        clearTimeout(slot.task.timer);
        Atomics.store(slot.task.flag, 0, 1);
        this._settle(slot.task, failure('POOL_CLOSED', 'simulation pool closed'));
      }
      return slot.worker.terminate();
    })]);
    await this.closing;
  }
}

/**
 * The pool a server should run with, or null when it is switched off. The pool is opt-in: an unset SP_WORKERS (and the
 * explicit 0, and any junk value) all mean "do not start a pool", and the callers keep doing the work inline, exactly as
 * before the pool existed. Only SP_WORKERS=1..32 starts threads.
 * @param {{ data?: object, env?: NodeJS.ProcessEnv, workerUrl?: URL }} [opts]
 * @returns {SimulationPool | null}
 */
export function createSimulationPool({ data, env = process.env, workerUrl } = {}) {
  const { size, maxQueue, timeoutMs } = workerSettings(env);
  if (size === 0) return null;
  return new SimulationPool({ data, size, maxQueue, timeoutMs, ...(workerUrl ? { workerUrl } : {}) });
}
