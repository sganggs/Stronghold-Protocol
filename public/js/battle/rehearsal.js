// public/js/battle/rehearsal.js — the host's side of the delegated bot layout rehearsal (DESIGN §14).
//
// The server hands the match's current host the candidate BattleSpecs of one bot prep (`b.rehearsal`); this module runs
// them in a module Worker (battle/rehearsalWorker.js, off the page's main thread) and answers
// `b.rehearsalResult { taskId, choice }` with the index of the pick — or `{ taskId, error: true }` when this browser
// cannot run it (no module Worker, the simulation data did not load, the worker died): the server then simulates the
// very same candidates itself, at once instead of waiting for its timeout.
//
// One Worker serves the whole tab: it reports itself (`{ t: 'ready' }`) once its module graph is evaluated — a message
// posted before that is lost — and is then handed the simulation data once from the runner's own load (the page already
// has those frozen /data/*.json for its own battles — no second fetch, no second parse), followed by one task at a
// time. A 4-seat match has at most 3 AI seats, so the queue is small (MAX_PENDING_TASKS); a task that would have to
// wait past it is answered `error` for the same reason — the server should not hold a bot prep for work this page
// cannot do.
//
// The server also drops tasks it no longer waits for (`b.rehearsalCancel`: a timeout, a host change, the prep ending)
// and so does the page. A task still running is stopped by terminating its Worker — the only thing that interrupts a
// simulation already under way, a message would only be read after it —, and the next task builds a fresh Worker (its
// `ready` / data state belongs to that instance; the data is sent again from the page's own copy). The task id in the
// frame keeps a cancel from touching a task that took its place. The page drops its tasks itself when the match on
// screen is over (`clear`, wired in main.js) and when the socket is not online — an answer could not be delivered then.
//
//   installRehearsal({ net, runner, createWorker, log }) → { pending(), clear(), dispose() } | null   (wired in main.js)

import { battleRunner } from './runner.js';

/** The module Worker that simulates the candidates (public/ is served at the root). */
export const WORKER_URL = '/js/battle/rehearsalWorker.js';
/** Tasks kept while the single worker is busy; one more may always run. */
export const MAX_PENDING_TASKS = 3;

/**
 * A spec that names a content set is not this worker's job. The worker only has the page's official `/data/`
 * (no plugin pack, no plugin scripts). A missing `cs` is the official data. Gameplay-plugin rooms are not offered
 * the task at all (server/match/match/rehearsal.js); this refuses one that arrived anyway.
 * @param {unknown[]} specs
 */
export function rehearsalSpecsAreOfficial(specs) {
  return !specs.some((s) => s && typeof s === 'object' && typeof s.cs === 'string' && s.cs !== '');
}

/**
 * @param {{ net?: any, runner?: any, createWorker?: () => Worker, log?: object }} [deps] `net` = the app socket
 *   (default: none — the caller passes it), `runner` = the battle runner whose simulation data the worker is given
 *   (default: the browser singleton; its `ensureSim()` warms and caches it), `createWorker` = the Worker factory (tests)
 * @returns {null | { pending: () => number, clear: () => void, dispose: () => void }} null without a socket, or in Node
 */
export function installRehearsal({ net, runner = battleRunner, createWorker = () => new Worker(WORKER_URL, { type: 'module' }), log = console } = {}) {
  if (!net || typeof net.on !== 'function' || !runner || typeof runner.ensureSim !== 'function') return null;
  /** The tasks waiting for the worker, oldest first. */
  const queue = [];
  /**
   * The live worker with its own state — `task` is the one it runs now, `ready` (its script is evaluated) and `data`
   * (it was given the simulation data) belong to this instance. It is dropped as a whole, so a replacement starts with
   * fresh flags and a late callback of the old one finds itself unknown (`w !== inst`).
   */
  let w = null;
  /** The browser cannot run a module Worker at all: every task is answered `error` at once. */
  let broken = false;

  const answer = (task, fields) => {
    if (task.settled) return;
    task.settled = true;
    net.send('b.rehearsalResult', { taskId: task.id, ...fields });
  };

  /** Give one worker instance the page's simulation data (once): its frozen /data/*.json as the runner loaded them. */
  const sendData = (inst) => runner.ensureSim().then((sim) => {
    // official data only: a content-set load names its `cs` and may carry scripts this worker must not run
    if (!sim || !sim.raw || (typeof sim.cs === 'string' && sim.cs !== '')) throw new Error('no official simulation data');
    if (w !== inst) return; // the instance was dropped while the data loaded: nothing is posted into it
    inst.port.postMessage({ t: 'data', raw: sim.raw });
    inst.data = true;
  });

  /** Terminate the live worker (the only way to stop a simulation already running in it) and forget it. */
  const killWorker = () => {
    const dead = w;
    w = null;
    if (dead) { try { dead.port.terminate(); } catch { /* ignore */ } }
    return dead;
  };

  /**
   * This browser cannot run the tasks (no module Worker, or the worker's script failed): answer the running one and
   * everything queued `error`, so the server rehearses those candidates itself instead of waiting for its timeout.
   */
  const failWorker = (why, err) => {
    log.warn?.(`[rehearsal] ${why}`, err || '');
    broken = true;
    const dead = killWorker();
    const tasks = queue.splice(0);
    if (dead && dead.task) tasks.unshift(dead.task);
    for (const task of tasks) answer(task, { error: true });
  };

  /** The live worker, created on the first task (null once this browser was found unable to run one). */
  function startWorker() {
    if (w || broken) return w;
    const inst = { port: null, ready: false, data: false, task: null };
    try {
      inst.port = createWorker();
    } catch (err) {
      failWorker('module Worker unavailable', err);
      return null;
    }
    inst.port.onmessage = (ev) => onWorkerMessage(inst, ev && ev.data);
    // a late error of a worker that was already dropped (its task was cancelled) says nothing about the live one
    inst.port.onerror = (ev) => { if (w === inst) failWorker('worker failed', ev && ev.message); };
    w = inst;
    return inst;
  }

  /** Hand one task to a worker whose script has run: the data first (once per instance), then the task itself. */
  function sendTask(inst, task) {
    Promise.resolve(inst.data ? null : sendData(inst)).then(() => {
      if (w !== inst || inst.task !== task) return;
      inst.port.postMessage({ t: 'rehearsal', taskId: task.id, playerId: task.playerId, cap: task.cap, specs: task.specs, ...(task.limits ? { limits: task.limits } : {}) });
    }, (err) => {
      log.warn?.('[rehearsal] simulation data unavailable', err);
      if (w !== inst || inst.task !== task) return;
      inst.task = null;
      answer(task, { error: true });
      pump();
    });
  }

  function onWorkerMessage(inst, msg) {
    if (!msg || w !== inst) return; // a late message of a worker that was dropped
    if (msg.t === 'ready') { // only now can the worker receive anything: the waiting task finally goes out
      inst.ready = true;
      if (inst.task) sendTask(inst, inst.task);
      return;
    }
    const task = inst.task;
    if (!task || msg.taskId !== task.id) return; // an answer to a task the server already took over
    inst.task = null;
    if (msg.t === 'done' && Number.isInteger(msg.choice)) answer(task, { choice: msg.choice });
    else { log.warn?.('[rehearsal] the task failed', msg && msg.message); answer(task, { error: true }); }
    pump();
  }

  /** Hand the next queued task to the worker (a fresh one after a termination). */
  function pump() {
    if (w && w.task) return; // the worker is busy
    const task = queue.shift();
    if (!task) return;
    const inst = startWorker();
    if (!inst) { answer(task, { error: true }); return; } // no module Worker: failWorker answered the rest of the queue
    inst.task = task;
    if (inst.ready) sendTask(inst, task); // else it waits for the worker's ready
  }

  /** A task from the match (its own validation: the server's frames are trusted, but a shape check keeps the worker safe). */
  function onTask(msg) {
    if (!msg || typeof msg !== 'object' || typeof msg.taskId !== 'string' || typeof msg.playerId !== 'string'
      || !Number.isFinite(msg.cap) || !Array.isArray(msg.specs)) return;
    const task = { id: msg.taskId, playerId: msg.playerId, cap: msg.cap, specs: msg.specs, limits: msg.limits, settled: false };
    // past the queue, or a spec that names a content set: answer now, so the server rehearses on its own data
    if (broken || queue.length >= MAX_PENDING_TASKS || !rehearsalSpecsAreOfficial(msg.specs)) { answer(task, { error: true }); return; }
    queue.push(task);
    pump();
  }

  /**
   * The server dropped one task (`b.rehearsalCancel`, DESIGN §14): the page drops it too. A task still queued is simply
   * forgotten; the running one is stopped by terminating its worker — a message would only be read after the
   * simulation. A cancel for any other task is ignored, so it can never touch the task that replaced it.
   */
  function onCancel(msg) {
    if (!msg || typeof msg.taskId !== 'string') return;
    if (w && w.task && w.task.id === msg.taskId) {
      w.task.settled = true;
      killWorker();
      pump();
      return;
    }
    const i = queue.findIndex((task) => task.id === msg.taskId);
    if (i >= 0) queue.splice(i, 1)[0].settled = true;
  }

  /** Drop every task of the match that is over: the worker is terminated (a simulation still running really stops) and
   *  the queue emptied; the next task builds a new worker. */
  function clear() {
    const dead = killWorker();
    if (dead && dead.task) dead.task.settled = true;
    for (const task of queue.splice(0)) task.settled = true;
  }

  /**
   * The socket is not online (a drop, a reconnect, another page taking this session over): `net.send` refuses every
   * frame then, so this page could not answer the task any more and the `b.rehearsalCancel` that would drop it cannot
   * arrive either — nothing it computes is still worth a Worker (the server falls back to its own rehearsal). main.js
   * drops the tasks of a match that is over the same way.
   */
  function onStatus(snap) {
    if (!snap || snap.status !== 'online') clear();
  }

  const offTask = net.on('b.rehearsal', onTask);
  const offCancel = net.on('b.rehearsalCancel', onCancel);
  const offStatus = net.on('status', onStatus);
  return {
    /** The tasks queued but not started (tests). */
    pending: () => queue.length,
    /** The match context is over (main.js): nothing of it may keep the worker busy. */
    clear,
    dispose() {
      offTask();
      offCancel();
      offStatus();
      clear();
    },
  };
}
