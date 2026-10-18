// One simulation realm per comparison; sandbox uses the same SES adapter and permission flags as match hosts.
import { scriptExecution, loadScripts } from '../../shared/plugins/scriptLoad.js';
import { gameplayTrial } from './gameplayTrial.js';
const quiet = { info() {}, warn() {}, error() {}, log() {} };
process.on('disconnect', () => process.exit(0));
process.once('message', async ({ base, set, baseScene, modScene, original, op, request, wizard }) => {
  try {
    const mode = scriptExecution(set.scripts || []);
    let sandbox;
    if (mode === 'sandbox') {
      if (!process.permission || process.env.SP_PLUGIN_SCRIPTS !== 'sandbox') throw new Error('PLUGIN_SANDBOX_DISABLED');
      sandbox = await import('../../shared/plugins/sandbox.js');
      await sandbox.initializeSandbox({ loadSES: () => import('ses') });
    }
    const { createBattleFromSpec } = await import('../sim/spec.js');
    const { DataSource, setSimData } = await import('../sim/simdata.js');
    const { setGameData } = await import('../sim/content/support/index.js');
    const { installOfficialBounds } = await import('../../shared/plugins/officialBounds.js');
    const { StudioError } = await import('./files.js');
function recordBattle(set, scene) {
  const raw = scene.stage ? { ...set.data, stages: { ...set.data.stages, [scene.stage.id]: scene.stage } } : set.data;
  setSimData(raw); setGameData(raw); installOfficialBounds(set.bounds);
  const spec = { ...scene.spec, cs: set.cs };
  const b = createBattleFromSpec(spec, new DataSource(raw), { logger: quiet, quiet: true, recordEvents: true });
  if (scene.duel) b.autoFinish = false;
  const duelDamage = new Map();
  if (scene.duel) b.on('damaged', ({ source, target, amount }) => {
    if (source && source !== target) duelDamage.set(source.id, (duelDamage.get(source.id) || 0) + (Number(amount) || 0));
  });
  b.start();
  const field = b.fieldMeta();
  const frames = [], events = {};
  let bytes = 0;
  const capture = () => {
    const ev = b.drainEvents();
    for (const e of ev) events[e[0]] = (events[e[0]] || 0) + 1;
    const frame = { snap: b.snapshot(), ev };
    bytes += Buffer.byteLength(JSON.stringify(frame));
    if (bytes > 6 * 1024 * 1024) throw new StudioError('PLUGIN_STUDIO_TRIAL_LIMIT', 413);
    frames.push(frame);
  };
  capture();
  // [ASSUMED] Duel is a fixed-position attack exercise using forceAttack/ally targets. Enemy-only selectors stay
  // enemy-only, so it is not an official PvP mode. First knock-out ends the exercise; no redeployment.
  const pair = b.allyUnits.slice(0, 2);
  if (scene.duel) for (const u of pair) b.setAllyTarget(u);
  let winner = null;
  for (let tick = 0; tick < Math.ceil(scene.cap * 30) && !b.finished; tick++) {
    b.step();
    if (scene.duel) {
      for (const [i, u] of pair.entries()) if (u.alive && pair[1 - i]?.alive && u.canAct && u.atkCd <= 0 && !u.s.flags.disarm && !u.profile?.noAttack) {
        u.skill?.onAboutToAttack();
        b.forceAttack(u, [pair[1 - i]]);
        u.atkCd = Math.max(u.atkCd, u.s.interval);
      }
      if (pair.some(u => !u.alive)) { winner = pair[0]?.alive ? 'left' : pair[1]?.alive ? 'right' : 'draw'; b.forceEnd('forced'); }
    }
    if (tick % 3 === 2 || b.finished) capture();
  }
  if (!b.finished) b.forceEnd('forced');
  capture();
  const result = b.result();
  const units = b.units.filter(u => u.kind === 'op').map(u => ({ id: u.id, defId: u.defId, name: u.name,
    damage: scene.duel ? duelDamage.get(u.id) || 0 : u.stats.dmg, healing: u.stats.heal, taken: u.stats.taken, kills: u.stats.kills, attacks: u.stats.attacks }));
  return { cs: set.cs, spec, field, frames, result, events, units, damage: units.reduce((n, u) => n + u.damage, 0),
    outcome: scene.duel ? winner || 'draw' : result.reason === 'cleared' && result.resolved === result.killed ? 'win' : result.reason === 'timeout' ? 'timeout' : 'loss',
    stage: raw.stages[spec.stageId], errors: (b.errors || []).map(({ label, who, message }) => ({ label, who, message })) };
}


    setGameData(base.data); installOfficialBounds(base.bounds);
    const reference = wizard?.template === 'rules' ? gameplayTrial(base, baseScene, wizard, request) : null;
    const vanilla = recordBattle(base, baseScene);
    if (set.scripts?.length) {
      const hashInput = { plugins: set.index.plugins, settings: set.settings };
      if (sandbox) {
        const { parse } = await import('acorn');
        await sandbox.installSandboxScripts(set.scripts, { hashInput, parse });
      } else await loadScripts(set.scripts, { hashInput });
    }
    const { installServerOperatorTraits } = await import('../plugins/operatorTraits.js');
    await installServerOperatorTraits(set.data);
    installOfficialBounds(set.bounds);
    setGameData(set.data);
    const exercise = gameplayTrial(set, modScene, wizard, request);
    if (set.rules?.morphPairing === 'plus') modScene.spec.morphPairing = 'plus';
    if (exercise && reference) exercise.reference = reference.ruleChecks;
    const plugin = recordBattle(set, modScene);
    process.send({ ok: true, vanilla, plugin, ...(exercise ? { exercise } : {}), comparison: { damage: plugin.damage - vanilla.damage,
      duration: plugin.result.time - vanilla.result.time, baseline: original.name, operator: op.name, duel: modScene.duel } });
  } catch (e) {
    process.send({ ok: false, issues: [{ level: 'problem', code: e.code?.startsWith('PLUGIN_') ? e.code : 'PLUGIN_STUDIO_TRIAL_FAILED', params: {} }] });
  }
});
