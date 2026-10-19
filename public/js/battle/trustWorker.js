// A vanilla BattleSpec is simulated off the page's main thread; only its bound outcome digest leaves this Worker.
const { createBattleFromSpec, compactResult, fitResult } = await import('/sim/spec.js');
const { DataSource, setSimData } = await import('/sim/simdata.js');
const { TICK } = await import('/sim/constants.js');
const { trustHash, HARD_CAP_SECONDS } = await import('/shared/trust.js');

self.onmessage = ({ data: task }) => {
  if (task?.t !== 'verify') return;
  try {
    if (task.spec.cs && task.spec.cs !== task.officialCs) throw new Error('non-official input');
    if (task.spec.kind === 'boss' || task.spec.kind === 'hidden') throw new Error('coupled input');
    if (trustHash(task.spec) !== task.specHash) throw new Error('input binding');
    setSimData(task.raw);
    const battle = createBattleFromSpec(task.spec, new DataSource(task.raw, null), { quiet: true, recordEvents: false });
    // The same hard cap as server/match/fields.js; no timer or gameplay RNG is introduced.
    const cap = Math.ceil(HARD_CAP_SECONDS / TICK);
    for (let i = 0; i < cap && !battle.finished; i++) battle.step();
    if (!battle.finished) battle.forceEnd('timeout');
    const result = fitResult(compactResult(battle.result()), { battleId: task.spec.battleId });
    if (result.errors > 0) throw new Error('simulation failed');
    self.postMessage({ t: 'done', taskId: task.taskId, specHash: task.specHash, digest: trustHash(result) });
  } catch {
    self.postMessage({ t: 'error', taskId: task.taskId });
  }
};
self.postMessage({ t: 'ready' });
