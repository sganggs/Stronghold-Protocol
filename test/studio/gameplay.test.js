import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fixture } from '../helpers/contentFixtures.js';
import { createPlugin, templateById, TEMPLATES, manifestText } from '../../server/studio/templates/index.js';
import { createPluginFiles } from '../../server/studio/files.js';
import { createAuthoring } from '../../server/studio/authoring.js';
import { readStudioData, numericFields } from '../../server/studio/gameData.js';
import { checkPluginFolder, packPlugin, zipPlugin } from '../../server/plugins/pack.js';
import { buildContentSet } from '../../server/plugins/contentSet.js';
import { validateDsl } from '../../server/sim/content/dsl/validate.js';
import { compileDsl } from '../../server/sim/content/dsl/compile.js';
import { dslExample } from '../../server/studio/dslExamples.js';
import { makeBattle, enemyRec } from '../helpers/battleHarness.js';
import { DataSource } from '../../server/sim/simdata.js';
import { setGameData } from '../../server/sim/content/support/index.js';
import { forgetOfficialBounds } from '../../shared/plugins/officialBounds.js';

export function makePlugin(f, template, id, options = {}) {
  const made = createPlugin(templateById(template), { id, options });
  const dir = f.put(id, made.manifest, made.files);
  fs.writeFileSync(path.join(dir, '.studio.json'), manifestText({ v: 1, authoring: made.authoring }));
  return { dir, made };
}
for (const template of TEMPLATES.filter(t => t.build)) test(`new ${template.id} -> strict check -> pack -> content composition`, t => {
  const f = fixture(t), id = `studio-${template.id}`;
  const result = spawnSync(process.execPath, ['tools/plugin.mjs', 'new', template.id, id, '--dir', path.join(f.dir, 'plugins')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const dir = path.join(f.dir, 'plugins', id);
  const check = checkPluginFolder(dir);
  f.registry.rescan();
  const set = template.class === 'content' ? buildContentSet({ registry: f.registry, ids: [id] }) : null;
  const cliCheck = spawnSync(process.execPath, ['tools/plugin.mjs', 'check', dir, '--strict'], { encoding: 'utf8' });
  assert.equal(cliCheck.status, 0, cliCheck.stdout + cliCheck.stderr);
  assert.deepEqual(check.problems, []); assert.deepEqual(check.warnings, []);
  assert.equal(packPlugin(dir).wrote, true);
  assert.ok(zipPlugin(dir).body.length > 100);
  if (set) assert.deepEqual(set.problems, []);
  if (['operator', 'dsl'].includes(template.id)) {
    const id0 = template.id === 'dsl' ? 'chess_x_studio_dsl_caster_a' : 'chess_x_studio_operator_one_a';
    assert.ok(set.data.chess[id0.replace(/_a$/, '_b')]);
    setGameData(set.data); t.after(() => setGameData(null));
    const h = makeBattle({ data: new DataSource(set.data), units: [{ chessId: id0, row: 10, col: 5 }], timeLimit: 1 });
    h.step(); assert.equal(h.allies().length, 1); assert.ok(!h.allies()[0].kit.generic);
    if (template.id === 'dsl') assert.equal(h.allies()[0].s.atk, 300, 'the composed DSL kit applies +50% ATK');
  }
});

test('five DSL starting points validate; generated talent executes in battleHarness', t => {
  for (const name of ['skgoat','inside','texas','kazema','lmlee']) assert.deepEqual(validateDsl(dslExample(name, 'dsl-demo').spec).problems, []);
  const f = fixture(t);
  const { made } = makePlugin(f, 'operator', 'talent-test', { kitSource: 'dsl', dsl: { dsl: 1, talents: [{ when: 'deploy', do: [{ buff: { mods: { atkFlat: 50 } } }] }] } });
  const compact = JSON.parse(made.files['data/operator.json']);
  assert.ok(compact.kit.dsl);
  const base = readStudioData(path.resolve('data'));
  const record = Object.values(base.chess).find(c => c.charId === compact.art.ref && !c.isGolden);
  const h = makeBattle({ units: [{ chessId: record.chessId, row: 10, col: 5 }],
    kits: { [record.baseId]: (bb, chess, def) => compileDsl(compact.kit.dsl, { bb, chess, def, pluginId: 'talent-test' }) },
    defs: { enemies: { test_dummy: enemyRec({ key: 'test_dummy', hp: 1e6, speed: 0 }) } }, enemies: [{ key: 'test_dummy', pos: [10, 6] }] });
  h.step(); assert.equal(h.allies()[0].s.atk, h.allies()[0].base.atk + 50);
  h.run(3); assert.ok(h.allies()[0].stats.dmg > 0); h.invariants();
});

test('numeric fields mirror default skills; wizard revision protects external edits; code writes stay confined', t => {
  const f = fixture(t); const data = readStudioData(path.resolve('data'));
  const fields = numericFields(data, { kind: 'operator', key: 'char_102_texas' });
  const skill = fields.find(f => f.path[0] === 'skills' && f.path.at(-1) === 'atk_scale');
  assert.ok(skill.mirrors.length); assert.ok(skill.bounded); assert.ok(skill.max >= 64);
  const { made } = makePlugin(f, 'numbers', 'edit-test', { edits: [{ key: skill.key, value: 2 }] });
  const ops = JSON.parse(made.files['data/patch.json']).ops;
  assert.equal(ops.length, 2); assert.ok(ops.some(op => op.path[0] === 'skill'));
  const files = createPluginFiles(path.join(f.dir, 'plugins'));
  const author = createAuthoring({ files, dataDir: path.resolve('data') });
  const before = author.read('edit-test');
  files.write('edit-test', 'note.txt', Buffer.from('external'));
  assert.throws(() => author.save('edit-test', before), { code: 'PLUGIN_STUDIO_CHANGED' });
  const fresh = author.read('edit-test'); author.save('edit-test', fresh);
  assert.throws(() => files.write('edit-test', 'x.js', Buffer.from('alert(1)')), { code: 'PLUGIN_FILE_TYPE' });
});


test('generated script harness runs with tools/plugin.mjs test, with SDK registrations preloaded', { timeout: 30000 }, t => {
  const f = fixture(t); makePlugin(f, 'script', 'harness-demo');
  for (const name of ['data', 'test', 'server', 'shared']) fs.symlinkSync(path.resolve(name), path.join(f.dir, name));
  const run = spawnSync(process.execPath, ['tools/plugin.mjs', 'test', 'harness-demo', '--root', f.dir], { encoding: 'utf8', timeout: 25000 });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /ℹ pass 1\b/); // the spec report on every Node version (Node 22's default here would be TAP)
});

test('mode wizard economy, DP and round timers reach GameData while the base mode stays unchanged', async t => {
  const { GameData } = await import('../../server/match/gamedata.js');
  const f = fixture(t);
  makePlugin(f, 'mode', 'mode-wizard', { base: 'mode_multi_normal', incomePerRound: 20, refreshPrice: 2, prepTime: 45, infoCheck: 8, dpInit: 20 });
  const set = buildContentSet({ registry: f.registry, ids: ['mode-wizard'] });
  assert.deepEqual(set.problems, []);
  const changed = new GameData(set.data, 'mode_x_mode_wizard_one');
  const original = new GameData(set.data, 'mode_multi_normal');
  assert.equal(changed.income(1), 20); assert.equal(changed.income(10), 20);
  assert.equal(changed.refreshPrice, 2); assert.equal(changed.prepTime(1), 45); assert.equal(changed.timer('infoCheck'), 8);
  assert.equal(changed.dp.dpInit, 20); assert.notEqual(original.income(1), 20);
});

test('the editor\'s DSL check applies the official caps the build applies: a literal over them is refused before saving', t => {
  forgetOfficialBounds();   // a fresh studio process: nothing has read the vanilla tables yet
  const f = fixture(t);
  const author = createAuthoring({ files: createPluginFiles(path.join(f.dir, 'plugins')), dataDir: path.resolve('data') });
  const over = author.validate({ dsl: 1, skill: { kind: 'passive', mods: { atkPct: 750 } } });
  assert.equal(over.ok, false);
  assert.match(JSON.stringify(over.problems), /skill\.mods\.atkPct/);
  assert.equal(author.validate({ dsl: 1, skill: { kind: 'passive', mods: { atkPct: 0.75 } } }).ok, true);
});
