// One bounded simulation pool for every room's rehearsal work.
//
// The WebSocket, the Match object and the board stay on the main thread in this phase; what moves is the layout
// rehearsal of a bot prep, whose candidates are whole simulated battles (0.2–1 s of CPU per bot late in a match, the
// stall the maintainer asked about). Every room submits into the SAME pool: a pool per room (or the "pinned lane" of an
// earlier revision of this file, which assigned rooms to lanes but then handed all of them the same pool) would
// multiply the thread count and overfill the process, which is exactly what the pool exists to prevent.
// Overload is refused (POOL_FULL from the pool) instead of starting another thread — the caller then runs the same
// candidates on the main thread, so a busy pool costs latency, never correctness.
import { SimulationPool, workerSettings } from './pool.js';

export class RoomWorkerPool {
  constructor({ data, totalWorkers = 1, maxQueue = 256, timeoutMs = 120000, workerUrl } = {}) {
    if (!Number.isInteger(totalWorkers) || totalWorkers < 1 || totalWorkers > 32) {
      throw new RangeError('room worker total must be 1..32');
    }
    this.pool = new SimulationPool({ data, size: totalWorkers, maxQueue, timeoutMs, ...(workerUrl ? { workerUrl } : {}) });
    /** The rooms (or standalone match keys) currently holding work here — bookkeeping for stats(), never a scheduling hint. */
    this.rooms = new Set();
    this.closed = false;
  }

  /**
   * Note that a room is using this pool. It returns the one pool every room submits into; the key is kept for stats()
   * only, because the pool schedules tasks by priority and arrival, not by room.
   */
  assign(key) {
    this.rooms.add(String(key || ''));
    return this.pool;
  }

  /** Submit through the same object startServer passes to Match. */
  submit(type, payload, options) { return this.pool.submit(type, payload, options); }

  /** How many keys a room's tasks can be told apart by: the pool itself does not. */
  has(key) { return this.rooms.has(String(key || '')); }

  release(key) {
    this.rooms.delete(String(key || ''));
  }

  stats() {
    return { kind: 'room-pool', ...this.pool.stats(), rooms: this.rooms.size };
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    await this.pool.close();
  }
}

/**
 * The pool a server should run with, or null when the workers are switched off: the callers then keep doing the work on
 * the main thread, exactly as before the pool existed. Opt-in, like the pool itself — an unset SP_WORKERS starts nothing.
 * @param {{ data?: object, env?: NodeJS.ProcessEnv, workerUrl?: URL }} [opts]
 * @returns {RoomWorkerPool | null}
 */
export function createRoomWorkerPool({ data, env = process.env, workerUrl } = {}) {
  const { size, maxQueue, timeoutMs } = workerSettings(env);
  if (size === 0) return null;
  return new RoomWorkerPool({ data, totalWorkers: size, maxQueue, timeoutMs, workerUrl });
}
