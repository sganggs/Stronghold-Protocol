// Disposable process: checks the same plugin bytes the registry/checker use, then records real Battle snapshots/events.
import fs from 'node:fs';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sandboxProcessOptions } from '../match/host/childHost.js';
import path from 'node:path';
import { createPluginRegistry, readPluginFolder } from '../plugins/registry.js';
import { buildContentSet } from '../plugins/contentSet.js';
import { checkPluginFolder } from '../plugins/pack.js';
import { createPluginFiles, StudioError } from './files.js';
import { createAuthoring } from './authoring.js';
import { stageAuthorDependencies } from './gameplayCheck.js';
import { inventory, linkFile } from './candidate.js';
import { writeTrialDraftFile } from './trialDraft.js';
import { scriptExecution } from '../../shared/plugins/scriptLoad.js';
import { chooseOperator, baselineOperator, trialScenario } from './trialScenario.js';
import { addFxReplay } from './fxReplay.js';
import { GAMEPLAY_TEMPLATES } from '../../public/studio/js/gameplayModel.js';

const quiet = { info() {}, warn() {}, error() {}, log() {} };
const issue = p => ({ level: 'problem', code: p.code || 'PLUGIN_INVALID', text: p.message || p.zh || p.text || '', file: p.file,
  params: { ...(p.params || {}), where: p.path || p.file || '', detail: p.message || p.zh || p.text || '' } });

process.on('disconnect', () => process.exit(0));
process.once('message', async ({ dirs, request, allowedScripts, temporary, heapMb }) => {
  const reply = value => {
    if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
    if (process.connected) process.send(value);
  };
  try {
    const registry = createPluginRegistry(dirs, { log: quiet });
    const files = createPluginFiles(dirs.pluginsDir);
    const selected = files.root(request.id);
    const authored = createAuthoring({ files, dataDir: dirs.dataDir });
    let draft = null, draftDir = null;
    if (request.draft) {
      const originalManifest = JSON.parse(fs.readFileSync(files.stat(request.id, 'plugin.json').abs, 'utf8'));
      if (originalManifest.class !== 'content' || !['numbers','operator','dsl','meta','mode','fx', ...GAMEPLAY_TEMPLATES].includes(request.draft.template)) throw new StudioError('PLUGIN_STUDIO_REQUEST', 400);
      // The copied folder is checked and the full dependency set composed below, before any simulation.
      const made = authored.prepare(request.id, request.draft, { validate: false, allowUntracked: true });
      if (!temporary) throw new StudioError('PLUGIN_STUDIO_TRIAL_FAILED', 500);
      const dir = path.join(temporary, request.id); draftDir = dir; fs.mkdirSync(dir);
      for (const f of inventory(selected)) linkFile(f.abs, path.join(dir, f.rel));
      for (const [rel, text] of Object.entries(made.files)) {
        if (rel !== 'plugin.lock.json') writeTrialDraftFile(dir, rel, text);
      }
      stageAuthorDependencies(temporary, request.id, made.manifest, { dataDir: dirs.dataDir, pluginsDir: dirs.pluginsDir });
      draft = readPluginFolder(dir, { vanilla: registry.vanillaAssets() });
      const check = checkPluginFolder(dir, undefined, { vanilla: registry.vanillaAssets(), dataDir: dirs.dataDir });
      if (check.problems.length) { reply({ ok: false, issues: check.issues }); return; }
    } else {
      // Reject links throughout the folder before invoking any checker that reads declared JSON.
      for (const f of files.list(request.id)) if (f.link) throw new StudioError('PLUGIN_STUDIO_PATH', 403, { detail: f.rel });
      const check = checkPluginFolder(selected, undefined, { vanilla: registry.vanillaAssets(), dataDir: dirs.dataDir });
      if (check.problems.length) { reply({ ok: false, issues: check.issues }); return; }
    }
    const lookup = registry.plugin;
    const view = { ...registry, plugin(id) {
      let p = id === request.id && draft ? draft.plugin : lookup(id);
      if (!p) return null;
      files.root(id); // dependencies must also be regular studio folders
      for (const f of files.list(id)) if (f.link) throw new StudioError('PLUGIN_STUDIO_PATH', 403, { detail: f.rel });
      if (p.script) {
        const allowed = allowedScripts.find(x => x.id === id && x.hash === p.script.lockHash);
        if (p.script.lockValid && allowed) p = { ...p, script: { ...p.script, execution: allowed.execution }, status: 'loaded', disabled: null };
        else p = { ...p, status: 'disabled', disabled: { code: 'PLUGIN_SCRIPTS_DISABLED' } };
      }
      return p;
    } };
    const p = view.plugin(request.id);
    if (!p || p.status !== 'loaded') {
      const problems = p?.disabled ? [issue(p.disabled)] : registry.report().skipped.find(x => x.where === `plugins/${request.id}/`)?.issues;
      reply({ ok: false, issues: problems?.length ? problems : [issue({ code: 'PLUGIN_UNKNOWN' })] }); return;
    }
    if (p.class === 'ui') throw new StudioError('PLUGIN_STUDIO_TRIAL_SCENARIO', 400);
    const base = buildContentSet({ registry: view, ids: [] });
    const set = buildContentSet({ registry: view, ids: [{ id: request.id, settings: request.settings }] });
    if (!set.cs) { reply({ ok: false, issues: set.problems.map(issue) }); return; }
    const newOp = Object.values(set.data.chess).find(r => !r.isGolden && !base.data.chess[r.chessId]);
    const wizard = request.draft || authored.read(request.id);
    const member = wizard?.template === 'bond' ? wizard.options.members?.[0] : wizard?.template === 'trait' ? wizard.options.charId || wizard.target?.replace(/^operator:/, '') : null;
    const op = request.operator ? chooseOperator(set.data, request.operator) : member ? chooseOperator(set.data, member) : newOp || chooseOperator(set.data);
    const opponent = chooseOperator(set.data, request.opponent);
    const original = baselineOperator(base.data, op);
    const originalOpponent = baselineOperator(base.data, opponent);
    // Build both scenarios before installing plugin data; golden's module caches official data.
    const baseScene = await trialScenario(request, base.data, original, originalOpponent);
    const modScene = await trialScenario(request, set.data, op, opponent);
    const options = scriptExecution(set.scripts || []) === 'sandbox' ? sandboxProcessOptions(heapMb)
      : { execArgv: [`--max-old-space-size=${heapMb}`] };
    const runner = fork(fileURLToPath(new URL('./trialRunner.js', import.meta.url)), [], {
      ...options, serialization: 'json', stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    const result = await new Promise((resolve, reject) => {
      runner.once('message', resolve);
      runner.once('error', reject);
      runner.once('exit', () => reject(new StudioError('PLUGIN_STUDIO_TRIAL_FAILED', 500)));
      runner.send({ base, set, baseScene, modScene, original, op, request, wizard: wizard ? { ...wizard, id: request.id } : null });
    });
    reply(addFxReplay(result, view, request.id, set.data, draftDir ? { ...files, root: id => id === request.id ? draftDir : files.root(id) } : files, { staged: request.draft?.uploads?.map(u => u.path) || [] }));
  } catch (e) { reply({ ok: false, issues: [issue({ code: e.code?.startsWith('PLUGIN_') ? e.code : 'PLUGIN_STUDIO_TRIAL_FAILED', params: e.params })] }); }
  finally { if (temporary) fs.rmSync(temporary, { recursive: true, force: true }); }
});
