import { parentPort, workerData } from 'node:worker_threads';
import { setData } from '../data.js';
import { memorySample } from './memory.js';

// Content imports getData() too: never read a different on-disk version when this thread starts later.
setData(workerData.data);
const [{ DataSource }, { createBattleFromSpec }, { HeadlessJob }, { RehearsalRun }] = await Promise.all([
  import('../sim/simdata.js'), import('../sim/spec.js'),
  import('../match/fields.js'), import('../sim/rehearsal.js'),
]);
const ds = new DataSource(workerData.data, null);
const quiet = { info() {}, warn() {}, error() {}, debug() {} };

parentPort.on('message', ({ id, type, payload, cancel }) => {
  const flag = new Int32Array(cancel);
  const cancelled = () => Atomics.load(flag, 0) !== 0;
  try {
    if (cancelled()) throw new Error('cancelled');
    let value;
    if (type === 'battle') {
      const battle = createBattleFromSpec(payload.spec, ds, { recordEvents: false, logger: quiet });
      const job = new HeadlessJob(battle, { players: payload.players });
      let sent = 0, lastProgress = performance.now();
      while (!job.run(4)) {
        if (cancelled()) throw new Error('cancelled');
        if (payload.progress && performance.now() - lastProgress >= 100) {
          parentPort.postMessage({ id, progress: { reset: sent === 0, samples: job.timeline.slice(sent) } });
          sent = job.timeline.length;
          lastProgress = performance.now();
        }
      }
      const out = job.output();
      value = { result: out.result, timeline: out.timeline, time: out.battle.time, errors: out.battle.errors,
        crashed: out.crashed };
    } else if (type === 'rehearsal') {
      // BattleSpecs remove live boss pools and construct candidates lazily, like local/adaptive rehearsals.
      const factories = payload.specs.map((spec) => () => createBattleFromSpec(spec, ds, { logger: quiet }));
      const run = new RehearsalRun(factories, payload.playerId, payload.cap, payload.limits || {});
      while (!run.run(cancelled)) if (cancelled()) throw new Error('cancelled');
      value = { bestIndex: run.score.index, stats: { totalTicks: run.totalTicks, completed: run.completed,
        considered: run.index, stopReason: run.stopReason, choice: run.score.index, candidates: factories.length } };
    } else throw new Error(`unknown simulation task: ${type}`);
    parentPort.postMessage({ id, value, memory: memorySample() });
  } catch (err) {
    parentPort.postMessage({ id, error: err.message, memory: memorySample() });
  }
});
