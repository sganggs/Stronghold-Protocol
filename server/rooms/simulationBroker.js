// An application concurrency bound for one supervisor. No lease is a CPU quota or a cross-instance lock.
export function simulationPermitCount(value, warn = console.warn) {
  if (value == null || value === '0' || value === 0) return 0;
  const n = Number(value);
  if (String(value).trim() !== '' && Number.isInteger(n) && n >= 1 && n <= 64) return n;
  warn('[simulation] SP_SIM_PERMITS must be an integer from 1 to 64; disabled');
  return 0;
}

function confirmedExit(pid) {
  try { process.kill(pid, 0); return false; }
  catch (error) { return error.code === 'ESRCH'; }
}

export const SIMULATION_GRANT_MS = 1000;
export const SIMULATION_ORPHAN_MS = 30000;

export function createSimulationBroker(limit, { hasExited = confirmedExit, setTimer = setTimeout, clearTimer = clearTimeout,
  now = () => performance.now(), grantMs = SIMULATION_GRANT_MS, orphanMs = SIMULATION_ORPHAN_MS } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 64) throw new RangeError('invalid simulation permit count');
  const brokers = new Map(), leases = new Map(), byExecutor = new Map();
  let seq = 0, closed = false;
  const keyOf = (broker, executor) => `${broker}/${executor}`;
  function forget(lease) {
    clearTimer(lease.timer);
    clearTimer(lease.orphanTimer);
    leases.delete(lease.id);
    byExecutor.delete(keyOf(lease.broker, lease.executor));
  }
  function prune() {
    for (const lease of leases.values()) {
      const broker = brokers.get(lease.broker);
      if (!broker?.exited) continue;
      let exited = lease.pid === broker.pid;
      if (!exited) { try { exited = hasExited(lease.pid) === true; } catch { /* uncertain liveness keeps its lease */ } }
      if (exited || now() >= broker.exitedAt + orphanMs) forget(lease);
    }
    for (const [key, broker] of brokers) if (broker.exited && ![...leases.values()].some((lease) => lease.broker === key)) brokers.delete(key);
  }
  function armOrphan(lease, broker) {
    lease.orphanTimer = setTimer(() => {
      prune();
      if (leases.get(lease.id) === lease) armOrphan(lease, broker);
    }, Math.max(1, broker.exitedAt + orphanMs - now()));
    lease.orphanTimer?.unref?.();
  }
  return {
    register(broker, pid) {
      if (!closed && typeof broker === 'string' && Number.isInteger(pid) && pid > 0) brokers.set(broker, { pid, exited: false });
    },
    acquire(broker, value = {}) {
      const { executor, pid, request } = value || {};
      if (closed || !brokers.has(broker) || brokers.get(broker).exited || typeof executor !== 'string' || executor.length > 160
        || !executor || !Number.isInteger(pid) || pid < 1 || !Number.isSafeInteger(request) || request < 1) return null;
      const key = keyOf(broker, executor);
      if (byExecutor.has(key) || leases.size >= limit) return null;
      const lease = { id: ++seq, broker, executor, pid, request, active: false, timer: null, orphanTimer: null,
        expiresAt: now() + grantMs };
      leases.set(lease.id, lease); byExecutor.set(key, lease);
      lease.timer = setTimer(() => { if (!lease.active && leases.get(lease.id) === lease) forget(lease); }, grantMs);
      lease.timer?.unref?.();
      return lease.id;
    },
    release(broker, executor, id) {
      const lease = leases.get(id);
      if (lease && lease.broker === broker && lease.executor === executor) forget(lease);
    },
    begin(broker, executor, id) {
      const lease = leases.get(id);
      if (!lease || lease.broker !== broker || lease.executor !== executor) return false;
      if (!lease.active && now() >= lease.expiresAt) { forget(lease); return false; }
      lease.active = true; clearTimer(lease.timer); lease.timer = null; return true;
    },
    cancel(broker, executor, request) {
      const lease = byExecutor.get(keyOf(broker, executor));
      if (lease && lease.request === request && !lease.active) forget(lease);
    },
    executorExited(broker, executor) {
      const lease = byExecutor.get(keyOf(broker, executor));
      if (lease) forget(lease);
    },
    brokerExited(broker) {
      const state = brokers.get(broker);
      if (!state || state.exited) return;
      state.exited = true; state.exitedAt = now();
      for (const lease of leases.values()) if (lease.broker === broker) {
        armOrphan(lease, state);
      }
      prune();
    },
    prune,
    stats() { return { limit, held: leases.size, orphaned: [...leases.values()].filter((lease) => brokers.get(lease.broker)?.exited).length }; },
    close() {
      closed = true;
      for (const lease of leases.values()) { clearTimer(lease.timer); clearTimer(lease.orphanTimer); }
      leases.clear(); byExecutor.clear(); brokers.clear();
    },
  };
}
