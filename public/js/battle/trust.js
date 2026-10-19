// One optional peer verification Worker per tab. A busy or unavailable worker declines immediately.
import { battleRunner } from './runner.js';

export const TRUST_WORKER_URL = '/js/battle/trustWorker.js';

export function installTrustVerifier({ net, runner = battleRunner, createWorker = () => new Worker(TRUST_WORKER_URL, { type: 'module' }) } = {}) {
  if (!net?.on || !runner?.ensureSim) return null;
  let active = null;
  const answer = (task, fields) => net.send('b.verifyResult', { taskId: task.taskId, ...fields });
  function clear() {
    const old = active;
    active = null;
    try { old?.worker?.terminate(); } catch { /* already gone */ }
  }
  function fail(task) {
    if (active?.task !== task) return;
    clear();
    answer(task, { error: true });
  }
  function onTask(task) {
    if (!task || typeof task.taskId !== 'string' || typeof task.specHash !== 'string' || !task.spec) return;
    if (active) { answer(task, { error: true }); return; }
    const inst = { task, worker: null, ready: false, data: null, started: false };
    active = inst;
    function pump() {
      if (active !== inst || !inst.ready || !inst.data || inst.started) return;
      inst.started = true;
      try {
        inst.worker.postMessage({ t: 'verify', taskId: task.taskId, specHash: task.specHash,
          spec: task.spec, officialCs: task.officialCs, raw: inst.data });
      } catch { fail(task); }
    }
    try {
      inst.worker = createWorker();
      inst.worker.onerror = () => fail(task);
      inst.worker.onmessage = ({ data }) => {
        if (active !== inst) return;
        if (data?.t === 'ready') { inst.ready = true; pump(); return; }
        if (data?.taskId !== task.taskId) return;
        clear();
        if (data.t === 'done') answer(task, { specHash: data.specHash, digest: data.digest });
        else answer(task, { error: true });
      };
      Promise.resolve(runner.ensureSim()).then((sim) => {
        if (!sim?.raw || sim.cs) { fail(task); return; }
        if (active !== inst) return;
        inst.data = sim.raw;
        pump();
      }, () => fail(task));
    } catch { fail(task); }
  }
  const offTask = net.on('b.verify', onTask);
  const offCancel = net.on('b.verifyCancel', (m) => { if (m?.taskId === active?.task.taskId) clear(); });
  const offStatus = net.on('status', (s) => { if (s?.status !== 'online') clear(); });
  return { clear, dispose() { offTask(); offCancel(); offStatus(); clear(); } };
}
