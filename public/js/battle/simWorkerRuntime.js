// Kept separate from the browser port so the same engine/packets can be verified with a Node worker.
import { InPageSimHost } from './simHost.js';

export function createSimWorker({ loadSim, prepareScripts = browserScripts } = {}) {
  const host = new InPageSimHost(loadSim ? { loadSim } : {});
  let loaded = false;
  let loadingStarted = false;
  let installScripts = null;
  const packet = (step = null) => {
    const b = host.battle;
    const pids = (host.spec.players || []).map(p => p.playerId);
    return {
      snap: b.snapshot(), ev: b.drainEvents() || [], ticks: step?.ticks || 0, slices: step?.slices || [],
      state: { time: b.time, tickCount: b.tickCount, finished: b.finished, killed: b.killed, total: b.total,
        leakedCount: b.leakedCount, flags: b.flags,
        // A length marker, not enemy objects; runner's uniteLeftMark uses it.
        enemies: Array(b.enemies?.length || 0).fill(null),
        allyUnits: (b.allyUnits || []).map(u => ({ id: u.id, uid: u.uid, ownerId: u.ownerId })),
        sharedBoss: b.sharedBoss ? { cum: b.sharedBoss.cum, byPlayer: { ...b.sharedBoss.byPlayer } } : null,
        // An array, never the method: WorkerSimHost.battle is a plain object and Object.assign would overwrite a function.
        // null outside a leader fight so a later packet cannot leave the previous fight's rows in place.
        leaderHits: (b.kind === 'boss' || b.kind === 'hidden') && typeof b.leaderHits === 'function' ? b.leaderHits() : null },
      meta: b.fieldMeta(), players: Object.fromEntries(pids.map(id => [id, { bonds: b.getPlayer(id)?.bonds }])),
      ops: Object.fromEntries(pids.map(id => [id, host.ownerOps(id)])), meter: { lp: host.meter.lp },
      progress: host.progress(), left: host.spec.kind === 'unite' ? host.uniteLeft() : null,
      result: b.finished ? host.compactResult({ bossLike: ['boss', 'hidden'].includes(host.spec.kind), battleId: host.spec.battleId }) : null,
    };
  };
  return async (method, args = []) => {
    if (method === 'load') {
      if (loadingStarted) throw new Error('one content set per simulation worker');
      loadingStarted = true;
      const content = args[0];
      if (!content?.data || !content.cs) throw new Error('missing content data');
      // Lock down before importing any engine module. Data/DSL sets never load SES.
      const install = content.scripts?.length ? await prepareScripts(content) : null;
      await host.load(content.cs, { ...content, deferScripts: true });
      installScripts = install;
      loaded = !install;
      return { install: !!install };
    }
    if (method === 'install') {
      if (!installScripts || loaded) throw new Error('no pending script installation');
      await installScripts();
      installScripts = null;
      loaded = true;
      return true;
    }
    if (!loaded) throw new Error('simulation not loaded');
    switch (method) {
      case 'start': host.start(args[0]); return packet();
      case 'step': {
        if (!Number.isInteger(args[0]) || args[0] < 0 || args[0] > 600) throw new Error('invalid step count');
        return packet(host.step(args[0], args[1] || {}));
      }
      case 'unitStats': return host.unitStats(args[0]);
      case 'ownerOps': return host.ownerOps(args[0]);
      case 'syncPool': host.syncPool(...args); return true;
      case 'forceEnd': host.forceEnd(args[0]); return packet();
      case 'stop': host.stop(); return true;
      default: throw new Error('unknown simulation command');
    }
  };
}

async function browserScripts(content) {
  return prepareScriptRuntime(content);
}

/** Same production adapter in both browser Workers and the Node determinism harness. */
export async function prepareScriptRuntime(content, { loadSES = () => import('/vendor/ses.umd.js'),
  loadMath = () => import('/sim/detmath.js'), loadParser = () => import('/vendor/acorn.mjs'), sdkUrl, extensionsUrl } = {}) {
  const { verifyScripts, scriptExecution, loadScripts } = await import('../../../shared/plugins/scriptLoad.js');
  verifyScripts(content.scripts, content.hashInput);
  const opts = { hashInput: content.hashInput, cs: content.cs, nativeVerified: content.nativeVerified, sdkUrl, extensionsUrl };
  if (scriptExecution(content.scripts) !== 'sandbox') return () => loadScripts(content.scripts, opts);
  const sandbox = await import('../../../shared/plugins/sandbox.js');
  await sandbox.initializeSandbox({ loadSES, loadMath });
  const { parse } = await loadParser();
  return () => sandbox.installSandboxScripts(content.scripts, { ...opts, parse });
}
