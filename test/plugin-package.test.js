// Plugin author resources in full/lite/update releases and Docker. Offline, no listening sockets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build, isRefused, plan, selectTracked, stageProblems } from '../tools/package.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const ENV = { ...process.env, SP_PACKAGE_SCAN_USER: '0' };
const REQUIRED = ['tools/plugin.mjs', 'test/helpers/battleHarness.js', 'schemas/plugin.schema.json',
  'schemas/overlay.schema.json', 'schemas/records.schema.json', 'schemas/dsl.schema.json', 'schemas/ui.schema.json',
  'schemas/catalog.schema.json', 'plugins/README.md', 'plugins/AGENTS.md', 'plugins/_template/ui/ui/index.html',
  'plugins/_template/script/test/guard.test.js', 'docs/PLUGINS.md', 'docs/PLUGIN-GUIDE.md', 'docs/PLUGIN-DSL.md',
  'docs/PLUGIN-API.md', 'docs/plugin-catalog.example.json'];
const PRIVATE = ['plugins/mine/plugin.json', 'plugins/config.json', 'plugins/.studio-key', 'plugins/_dist/mine.zip',
  'plugins/_moved/mine/file.js', 'plugins/_incoming/mine/plugin.json', 'plugins/_replaced/mine/plugin.json',
  'handoff/notes.md', 'pv/movie.mp4', '3，9，11回合情况/notes.txt', 'docs/research/10-networking-hosting.md',
  'test/helpers/other.js', 'test/helpers/battleHarness.js/extra', 'test/e2e/out/private.png'];

test('full and lite include author resources, refuse even tracked private plugins and all other tests', () => {
  assert.deepEqual(selectTracked([...REQUIRED, ...PRIVATE]).keep, [...REQUIRED].sort());
  for (const file of PRIVATE) assert.equal(isRefused(file), true, file);
  for (const lite of [false, true]) {
    const p = plan(ROOT, { lite, allowDirty: true, scan: false, measure: false });
    for (const file of REQUIRED) assert.ok(p.files.includes(file), `${lite ? 'lite' : 'full'}: ${file}`);
    assert.ok(!p.files.some(file => PRIVATE.includes(file)));
    assert.deepEqual(p.problems.filter(x => !x.startsWith('missing art:') && !x.startsWith('no art under')), []);
  }
});

test('stage guard allows the exact harness but rejects private plugin and extra test leaves', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-plugin-stage-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const put = file => { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), ''); };
  put('test/helpers/battleHarness.js');
  assert.deepEqual(stageProblems(dir, new Set(['test/helpers/battleHarness.js']), { env: ENV }).problems, []);
  for (const file of ['plugins/config.json', 'plugins/mine/plugin.json', 'test/helpers/extra.js']) put(file);
  const problems = stageProblems(dir, new Set(['test/helpers/battleHarness.js', 'plugins/config.json', 'plugins/mine/plugin.json', 'test/helpers/extra.js']), { env: ENV }).problems;
  for (const file of ['plugins/config.json', 'plugins/mine/plugin.json', 'test/helpers/extra.js']) assert.ok(problems.includes(`refused: ${file} is in the stage`));
});

const hasZip = !spawnSync('zip', ['-v']).error || /bsdtar/.test(spawnSync('tar', ['--version'], { encoding: 'utf8' }).stdout || '');
test('offline release stage runs plugin CLI, native author harness and sandbox trials; mounted plugins do not hide templates',
  { skip: !hasZip && 'no zip / bsdtar', timeout: 120000 }, t => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-author-release-'));
    t.after(() => fs.rmSync(out, { recursive: true, force: true }));
    const p = plan(ROOT, { lite: true, allowDirty: true, scan: false, measure: false });
    assert.deepEqual(p.problems, []);
    const { stage } = build(ROOT, p, { out, install: false, keepStage: true, env: ENV, log() {} });
    // No registry access in a unit test: copy the locally installed production lock entries as real files.
    const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json')));
    for (const [rel, entry] of Object.entries(lock.packages)) {
      if (!rel.startsWith('node_modules/') || entry.dev || entry.link) continue;
      assert.ok(fs.statSync(path.join(ROOT, rel)).isDirectory(), `npm ci needed: ${rel}`);
      fs.cpSync(path.join(ROOT, rel), path.join(stage, rel), { recursive: true, dereference: true });
    }
    let env = { ...ENV, SP_PLUGIN_SCRIPTS: 'sandbox' };
    delete env.NODE_TEST_CONTEXT;
    delete env.SP_PLUGIN_RESOURCES;
    const run = args => {
      const r = spawnSync(process.execPath, args, { cwd: stage, env, encoding: 'utf8', timeout: 90000, maxBuffer: 4 * 1024 * 1024 });
      assert.equal(r.status, 0, `${args.join(' ')}\n${r.stdout}\n${r.stderr}`);
      return r.stdout;
    };
    run(['tools/vendor.mjs']);
    const pkg = JSON.parse(fs.readFileSync(path.join(stage, 'package.json')));
    assert.equal(pkg.dependencies.ses, '2.3.0'); assert.equal(pkg.dependencies.acorn, '8.18.0');
    assert.equal(pkg.scripts.test, undefined, 'the release still omits the development test command');
    for (const [module, file] of [['ses', 'ses.umd.js'], ['acorn', 'acorn.mjs']]) {
      assert.ok(!fs.lstatSync(path.join(stage, 'node_modules', module)).isSymbolicLink());
      assert.ok(fs.statSync(path.join(stage, 'public/vendor', file)).size > 0);
    }
    run(['--permission', `--allow-fs-read=${fs.realpathSync(stage)}`, '--input-type=module', '-e', "await import('ses'); await import('acorn');"]);
    for (const command of [['new'], ['list', '--json'], ['surface'], ['errors'], ['catalog', 'docs/plugin-catalog.example.json', '--json']]) run(['tools/plugin.mjs', ...command]);
    for (const template of ['ui', 'dsl', 'script']) {
      run(['tools/plugin.mjs', 'new', template, `release-${template}`]);
      run(['tools/plugin.mjs', 'check', `release-${template}`, '--strict']);
      run(['tools/plugin.mjs', 'pack', `release-${template}`, '--zip']);
    }
    assert.match(run(['tools/plugin.mjs', 'test', 'release-script']), /ℹ fail 0\b/); // the spec report on every Node version
    run(['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import { createPluginRegistry } from './server/plugins/registry.js';
      import { createPluginFiles } from './server/studio/files.js';
      import { createTrialBench } from './server/studio/trial.js';
      import { trialOptions } from './server/studio/trialOptions.js';
      import { trialScenario, chooseOperator } from './server/studio/trialScenario.js';
      import { readStudioData } from './server/studio/gameData.js';
      import path from 'node:path';
      const dirs = Object.fromEntries(['public','data','shared','packs','plugins'].map(k => [k+'Dir', path.resolve(k)]));
      const registry = createPluginRegistry(dirs, { scriptMode: 'sandbox' });
      assert.deepEqual(trialOptions(dirs.dataDir).golden, []);
      const data = readStudioData(dirs.dataDir);
      await assert.rejects(trialScenario({ scenario: 'golden:bonds:bond-deputShip-low' }, data, chooseOperator(data)), { code: 'PLUGIN_STUDIO_TRIAL_SCENARIO' });
      const bench = createTrialBench({ registry, files: createPluginFiles(dirs.pluginsDir) });
      try { for (const id of ['release-dsl','release-script']) {
        const result = await bench.run({ id, scenario: 'dummy', seconds: 1, seed: 7 });
        assert.equal(result.ok, true, JSON.stringify(result));
        assert.deepEqual(result.plugin.errors, []);
        assert.ok(result.plugin.frames.length > 0);
      } } finally { bench.close(); }
    `]);
    // Emulate Docker's empty /app/plugins mount. The only templates are now in the root-owned resource location.
    fs.renameSync(path.join(stage, 'plugins'), path.join(stage, 'plugin-resources'));
    fs.mkdirSync(path.join(stage, 'plugins'));
    env = { ...env, SP_PLUGIN_RESOURCES: path.join(stage, 'plugin-resources') };
    for (const template of ['ui', 'script']) {
      run(['tools/plugin.mjs', 'new', template, `mounted-${template}`]);
      run(['tools/plugin.mjs', 'check', `mounted-${template}`, '--strict']);
    }
    for (const file of ['README.md', 'AGENTS.md']) assert.ok(fs.existsSync(path.join(stage, 'plugin-resources', file)));
  });

test('Docker copies real production dependencies and separate author resources with narrow context exceptions', () => {
  const docker = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
  // (.gitattributes gives .dockerignore no eol: a Windows checkout with core.autocrlf has CRLF lines, as Docker allows)
  const ignore = fs.readFileSync(path.join(ROOT, '.dockerignore'), 'utf8').split(/\r?\n/);
  assert.match(docker, /npm ci --omit=dev --ignore-scripts/);
  assert.match(docker, /COPY --from=deps \/app\/node_modules \.\/node_modules/);
  assert.match(docker, /SP_PLUGIN_RESOURCES=\/app\/plugin-resources/);
  assert.match(docker, /COPY --from=build \/app\/plugin-resources \.\/plugin-resources/);
  assert.match(docker, /chown node:node \/app\/plugins/);
  for (const file of ['tools/plugin.mjs', 'test/helpers/battleHarness.js', 'schemas']) assert.ok(docker.includes(`COPY --from=build /app/${file} ./${file}`), file);
  for (const rule of ['node_modules', 'public/vendor', 'plugins/*', '!plugins/_template/', '!plugins/README.md', '!plugins/AGENTS.md',
    'test/*', '!test/helpers/', 'test/helpers/*', '!test/helpers/battleHarness.js', 'handoff', 'pv', '3，9，11回合情况', 'docs/research/*.md']) assert.ok(ignore.includes(rule), rule);
});
