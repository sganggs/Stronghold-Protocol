import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readFxAssets, validateFxPrefab } from '../../server/plugins/fxAssets.js';
import { listPluginFiles, readPluginFolder } from '../../server/plugins/registry.js';
import { expandFxRecords, compilePluginFxDsl } from '../../server/plugins/fxRecords.js';
import { operatorFxProblems, pluginFxProblems } from '../../public/js/render/vfx/pluginFormat.js';
import { preparePluginFx, mergePluginFx } from '../../public/js/render/vfx/pluginLibrary.js';
import * as visual from '../../shared/plugins/visual.js';
import { getData } from '../../server/data.js';
import { guard } from '../helpers/contentFixtures.js';
import { fxFixture, compiled, prefab, book } from '../helpers/fxFixtures.js';
import { png } from '../helpers/pluginFixtures.js';
import { makeRuntime, runActions } from '../../server/sim/content/dsl/vocab.js';
import { validateDsl } from '../../server/sim/content/dsl/validate.js';
import { checkPluginFolder } from '../../server/plugins/pack.js';
import { nodeSha256 } from '../../server/plugins/identity.js';
import { importForge } from '../../server/plugins/forgeImport.js';
import { createPluginRegistry } from '../../server/plugins/registry.js';
import { buildContentSet } from '../../server/plugins/contentSet.js';
import { ROOT } from '../../server/data.js';
import { schemaValidator } from '../helpers/jsonSchema.js';

test('official effect format and optional expansion preserve legacy records', () => {
  for (const fx of [{ unit: 'char_112_siege', skills: { 0: 'skchr_siege_3' } }, { unit: 'char_4217_makoto' }]) assert.deepEqual(operatorFxProblems(fx), []);
  for (const fx of [{}, { unit: '../x' }, { unit: 'x', skills: [] }, { unit: 'x', skills: { 0: 'https://bad' } }, { unit: 'x', script: 'x' }]) assert.ok(operatorFxProblems(fx).length);
  const r = guard(), base = getData(), opts = { pluginId: 'data-demo' };
  const old = expandFxRecords(base, [r], opts);
  assert.deepEqual(old.problems, []); assert.equal(old.data.chess.chess_x_data_demo_guard_a.fx, undefined);
  r.fx = { unit: 'char_112_siege', skills: { 0: 'skchr_siege_3' } };
  const next = expandFxRecords(base, [r], opts);
  assert.deepEqual(next.problems, []);
  assert.deepEqual(next.data.chess.chess_x_data_demo_guard_a.fx, r.fx);
  assert.deepEqual(next.data.backups.units[r.charId].fx, r.fx);
  r.fx.unit = '../bad'; assert.equal(expandFxRecords(base, [r], opts).data, base);
});

test('editor schemas describe official mappings and cosmetic effects', () => {
  const v = schemaValidator(path.join(ROOT, 'schemas'));
  const fx = { flipbooks: { flash: book() }, bind: { char_x_fx_demo_guard: { 0: { skillStart: 'flash' } } }, silentPhases: ['quiet'] };
  assert.deepEqual(v.validate('overlay.schema.json', { fx }), []);
  for (const bad of [{ index: 'remote.json' }, { flipbooks: { bad: { ...book(), frames: 257 } } }, { bind: { char_112_siege: {} } }, { script: 'run()' }]) assert.ok(v.validate('overlay.schema.json', { fx: bad }).length);
  const r = guard(); r.fx = { unit: 'char_112_siege', skills: { 0: 'skchr_siege_3' } };
  assert.deepEqual(v.validate('records.schema.json', r), []);
});

test('compiled assets merge under a private namespace and all files are pinned', t => {
  const f = fxFixture(t), index = compiled(f);
  const config = { index: 'fx/index.json', flipbooks: { flash: book() }, bind: { char_x_fx_demo_guard: { 0: { skillStart: 'flash', projectile: 'spark' } } } };
  const got = readFxAssets(f.root, config, ['fx-demo'], listPluginFiles(f.root));
  assert.equal(got.files.length, 3);
  const v = { ...got.value, images: { 'fx/sheet.png': { w: 8, h: 8, url: '/p/fx-demo/12345678/fx/sheet.png' } } };
  const original = { units: { char_112_siege: { kind: 'char' } }, prefabs: {}, skills: {} };
  const merged = mergePluginFx(original, { 'fx-demo': v });
  assert.equal(merged.index.units.char_112_siege, original.units.char_112_siege);
  assert.equal(Object.keys(original.units).length, 1);
  assert.equal(merged.index.pluginUnits.char_x_fx_demo_guard, 'plugin:fx-demo:char_x_fx_demo_guard');
  assert.equal(merged.descriptors.get('plugin:fx-demo:spark').materials[0].textures._MainTex.tex, 'plugin:fx-demo:sheet');
  assert.equal(merged.index.units['plugin:fx-demo:char_x_fx_demo_guard'].modes[0].attack.cast[0].effects[0], 'plugin:fx-demo:spark');
  assert.equal(merged.index.skills['plugin:fx-demo:skx_fx_demo_one'].uses[0].keys[0], 'plugin:fx-demo:spark');
  assert.equal(index.units.char_x_fx_demo_guard.modes[0].attack.cast[0].effects[0], 'spark');
  const dir = path.join(f.root, 'fx-demo');
  fs.mkdirSync(dir); fs.renameSync(path.join(f.root, 'fx'), path.join(dir, 'fx'));
  f.put('fx-demo/plugin.json', { manifest: 2, id: 'fx-demo', name: 'FX', version: '1.0.0', app: '>=0.3.0 <0.4.0', api: 1,
    class: 'cosmetic', permissions: ['assets.add'], assets: { fx: config } });
  const r = readPluginFolder(dir, { vanilla: { manifest: { version: 1, chars: {} }, sha256: 'a'.repeat(64) } });
  assert.deepEqual(r.problems, []); assert.equal(r.plugin.visual.ops[0].effects.index.version, 3);
  assert.ok(r.plugin.visual.served.has('fx/prefabs/spark.json'));
});

test('reject hostile paths, foreign units, dangling bindings, file and texture budgets', t => {
  const f = fxFixture(t); compiled(f);
  const read = config => readFxAssets(f.root, config, ['fx-demo'], listPluginFiles(f.root));
  for (const config of [ { index: '../index.json' }, { flipbooks: { flash: { ...book(), image: 'https://bad' } } },
    { bind: { char_112_siege: { 0: { hit: 'spark' } } } }, { bind: { char_x_fx_demo_guard: { 0: { hit: 'absent' } } } } ]) assert.throws(() => read(config));
  assert.ok(pluginFxProblems({ flipbooks: { bad: { ...book(), frames: 257 } } }, ['fx-demo']).length);
  assert.ok(pluginFxProblems({ flipbooks: { bad: { ...book(), fps: 0 } } }, ['fx-demo']).length);
  const b = fs.readFileSync(path.join(f.root, 'fx/sheet.png')); b.writeUInt32BE(2049, 16); f.put('fx/sheet.png', b);
  assert.throws(() => read({ flipbooks: { flash: book() } }), /2048/);
  assert.throws(() => readFxAssets(f.root, { index: 'fx/index.json' }, ['fx-demo'], [{ rel: 'fx/index.json', bytes: 33 * 1024 * 1024 }]), /byte/);
});

test('compiled descriptors reject cycles, scripts, arbitrary meshes and particle bombs', () => {
  const textures = { sheet: {} };
  assert.equal(validateFxPrefab(prefab(), textures).key, 'spark');
  for (const change of [d => d.nodes[0].parent = 0, d => d.nodes[0].script = 'run()', d => d.nodes[0].meshFilter = { mesh: 'remote' },
    d => d.refs = ['spark'], d => d.materials[0].shader = 'custom', d => d.nodes[0].behaviours[0].class = 'ExecuteScript',
    d => d.nodes = Array(65).fill(d.nodes[0]), d => d.textures = ['missing'], d => d.nodes[0].particleSystem = { InitialModule: { maxNumParticles: 1e9 } }]) {
    const d = prefab(); change(d); assert.throws(() => validateFxPrefab(d, textures));
  }
});

test('visual document pins effect data and refuses unlisted texture URLs', t => {
  const f = fxFixture(t); compiled(f);
  const got = readFxAssets(f.root, { index: 'fx/index.json' }, ['fx-demo'], listPluginFiles(f.root));
  const ops = [{ at: ['fx', 'fx-demo'], effects: got.value }];
  const files = Object.fromEntries(got.files.map(rel => [rel, nodeSha256(fs.readFileSync(path.join(f.root, rel)))]));
  const comp = { id: 'fx-demo', version: '1.0.0', files, writes: visual.writesHashOf(ops) };
  const v = { v: 2, assets: 'a'.repeat(64), overlays: [comp] }; v.vs = visual.visualHashOf(v);
  const doc = { visual: v, writes: [{ id: 'fx-demo', ops }] };
  assert.equal(preparePluginFx(doc, visual).length, 1);
  got.value.index.version = 99;
  assert.equal(preparePluginFx(doc, visual).length, 0, 'tampering fails the writes hash');
});

test('particle, emitter and aggregate file caps reject otherwise valid compiled bundles', t => {
  const ps = () => ({ lengthInSec: 1, InitialModule: { startLifetime: 1, startSpeed: 1, startSize: 1, startColor: [1, 1, 1, 1], maxNumParticles: 1 }, EmissionModule: { rateOverTime: 1, m_Bursts: [] } });
  const d = prefab(); d.nodes[0].particleSystem = ps();
  assert.equal(validateFxPrefab(d, { sheet: {} }), d);
  d.materials[0].passes = [{ blend: ['SrcAlpha', 'One', 'Zero', 'OneMinusSrcAlpha'], blendOp: 'Add', zTest: 'LessEqual', zWrite: false, cull: 'Off', colorMask: 15 }];
  assert.equal(validateFxPrefab(d, { sheet: {} }), d, 'compiled material states keep the official string enums');
  const many = count => { const x = structuredClone(d); x.nodes = Array.from({ length: count }, (_, i) => ({ id: i, parent: i ? 0 : null, particleSystem: ps() })); return x; };
  assert.throws(() => validateFxPrefab(many(17), { sheet: {} }), /cap/);
  const particles = many(5); for (const n of particles.nodes) n.particleSystem.InitialModule.maxNumParticles = 256;
  assert.throws(() => validateFxPrefab(particles, { sheet: {} }), /cap/);
  const emitters = many(3); for (const n of emitters.nodes) n.particleSystem.EmissionModule.m_Bursts = Array.from({ length: 16 }, () => ({ countCurve: 1 }));
  assert.throws(() => validateFxPrefab(emitters, { sheet: {} }), /cap/);
  for (const bad of [1, true, 'true']) { d.nodes[0].particleSystem.prewarm = bad; assert.throws(() => validateFxPrefab(d, { sheet: {} })); }
  const f = fxFixture(t), ix = { format: 'fx-index', version: 3, units: {}, skills: {}, textures: {}, prefabs: {} };
  for (let i = 0; i < 128; i++) {
    const id = `p${i}`; ix.textures[id] = { file: `fx/${id}.png` }; ix.prefabs[id] = { file: `fx/${id}.json` };
    f.put(`fx/${id}.png`, png(4, 4)); const p = prefab(); p.key = id; p.textures = [id]; p.materials[0].textures._MainTex.tex = id; f.put(`fx/${id}.json`, p);
  }
  f.put('fx/index.json', ix);
  assert.throws(() => readFxAssets(f.root, { index: 'fx/index.json' }, ['fx-demo'], listPluginFiles(f.root)), /file\/byte limit/);
});

test('DSL plugin action compiles to a normal fx event with a namespaced effect address', () => {
  const spec = { dsl: 1, talents: [{ when: 'deploy', do: [{ fx: { kind: 'plugin', id: 'flash', at: 'self', dur: 0.3 } }] }] };
  const compiled = compilePluginFxDsl(spec, 'fx-demo');
  assert.equal(validateDsl(compiled).ok, true);
  const events = [], unit = { id: 7, x: 2, y: 3 };
  const battle = { fx: (kind, data) => events.push({ kind, data }) };
  const rt = makeRuntime(battle, unit, { pluginId: 'fx-demo', params: {} });
  runActions(compiled.talents[0].do, rt);
  assert.deepEqual(events, [{ kind: 'plugin', data: { x: 2, y: 3, id: 7, skill: 'plugin:fx-demo:flash', dur: 0.3 } }]);
  assert.equal(spec.talents[0].do[0].fx.id, 'flash');
  assert.throws(() => compilePluginFxDsl({ fx: { kind: 'plugin', id: '../bad' } }, 'fx-demo'));
});

test('registry, pack/check and studio findings accept fx-only cosmetics and warn for missing official keys', t => {
  const f = fxFixture(t);
  const man = { manifest: 2, id: 'fx-demo', name: 'Effects', version: '1.0.0', app: '>=0.3.0 <0.4.0', api: 1, class: 'cosmetic', scope: ['room'], permissions: ['assets.add'], assets: { fx: { silentPhases: ['quiet'] } } };
  f.put('fx-demo/plugin.json', man);
  const vanilla = { manifest: {}, sha256: 'a'.repeat(64) };
  const loaded = readPluginFolder(path.join(f.root, 'fx-demo'), { vanilla });
  assert.deepEqual(loaded.problems, []); assert.equal(loaded.plugin.visual.ops[0].effects.config.silentPhases[0], 'quiet');
  const op = guard(); op.fx = { unit: 'char_999999_missing' };
  f.put('data-demo/plugin.json', { ...man, id: 'data-demo', class: 'content', permissions: ['data.add'], assets: undefined, operators: ['op.json'] }); f.put('data-demo/op.json', op);
  const checked = checkPluginFolder(path.join(f.root, 'data-demo'), 'plugins/data-demo', { vanilla });
  assert.deepEqual(checked.problems, []); assert.ok(checked.warnings.some(s => s.includes('char_999999_missing')));
});

test('saved content fx mapping and DSL action survive production content-set composition', t => {
  const f = fxFixture(t), op = guard();
  op.fx = { unit: 'char_112_siege', skills: { 0: 'skchr_siege_3' } };
  op.kit = { dsl: { dsl: 1, talents: [{ when: 'deploy', do: [{ fx: { kind: 'plugin', id: 'flash', dur: 0.4 } }] }] } };
  f.put('plugins/data-demo/plugin.json', { manifest: 2, id: 'data-demo', name: 'Demo', version: '1.0.0', app: '>=0.3.0 <0.4.0', api: 1,
    class: 'content', scope: ['room'], permissions: ['data.add', 'dsl'], operators: ['op.json'] });
  f.put('plugins/data-demo/op.json', op);
  const registry = createPluginRegistry({ publicDir: path.join(f.root, 'public'), packsDir: path.join(f.root, 'packs'), pluginsDir: path.join(f.root, 'plugins'), dataDir: path.join(ROOT, 'data') });
  const set = buildContentSet({ registry, ids: ['data-demo'] });
  assert.deepEqual(set.problems, []);
  const rec = set.data.chess.chess_x_data_demo_guard_a;
  assert.deepEqual(rec.fx, op.fx);
  assert.equal(rec.dsl.talents[0].do[0].fx.skill, 'plugin:data-demo:flash');
});

test('Forge silent phases produce a cosmetic even without media and unknown fields remain skips', async t => {
  const f = fxFixture(t);
  f.put('pack/pack.json', { id: 'silent-demo', name: 'Quiet', version: '1.0.0', fx: { silentPhases: ['helmLow', 'spinStop'], unsupported: true } });
  const { report } = await importForge(path.join(f.root, 'pack'), { pluginsDir: path.join(f.root, 'plugins'), root: ROOT, dataDir: path.join(ROOT, 'data'), dryRun: true });
  assert.equal(report.ok, true); assert.ok(report.products.some(p => p.class === 'cosmetic'));
  assert.ok(report.products.flatMap(p => p.imported).includes('fx.silentPhases'));
  assert.ok(report.skipped.some(s => s.path === 'fx.unsupported'));
  f.put('pack/pack.json', { id: 'silent-demo', name: 'Quiet', version: '1.0.0', fx: { silentPhases: [] } });
  const empty = await importForge(path.join(f.root, 'pack'), { pluginsDir: path.join(f.root, 'plugins'), root: ROOT, dataDir: path.join(ROOT, 'data'), dryRun: true });
  assert.equal(empty.report.products.length, 0);
});

test('client preparation and merging reject pinned official-unit hijacks and hostile prefab bodies', t => {
  const f = fxFixture(t); compiled(f);
  const { value, files: used } = readFxAssets(f.root, { index: 'fx/index.json' }, ['fx-demo'], listPluginFiles(f.root));
  const files = Object.fromEntries(used.map(rel => [rel, nodeSha256(fs.readFileSync(path.join(f.root, rel)))]));
  const prepare = effects => {
    const ops = [{ at: ['fx', 'fx-demo'], effects }];
    const v = { v: 2, assets: 'a'.repeat(64), overlays: [{ id: 'fx-demo', version: '1.0.0', files, writes: visual.writesHashOf(ops) }] };
    v.vs = visual.visualHashOf(v);
    return preparePluginFx({ visual: v, writes: [{ id: 'fx-demo', ops }] }, visual);
  };
  assert.equal(prepare(value).length, 1);
  const official = { units: { char_103_angel: { kind: 'char', marker: 'official' } }, skills: {}, prefabs: {} };
  for (const mutate of [
    e => { e.index.units.char_103_angel = e.index.units.char_x_fx_demo_guard; },
    e => { e.index.units.char_x_foreign_guard = e.index.units.char_x_fx_demo_guard; },
    e => { e.prefabs.spark.nodes[0].particleSystem = { InitialModule: { maxNumParticles: 1e9 } }; },
    e => { e.prefabs.spark.nodes[0].parent = 0; },
    e => { e.prefabs.spark.materials[0].shader = 'custom'; },
  ]) {
    const e = structuredClone(value); mutate(e);
    assert.equal(prepare(e).length, 0, 'a valid writes hash does not replace schema validation');
    const merged = mergePluginFx(official, { 'fx-demo': e });
    assert.deepEqual(merged.index.units, official.units);
    assert.deepEqual(merged.index.pluginUnits, {});
    assert.equal(merged.descriptors.size, 0);
  }
});

test('client ownership allows declared dependency units, including compiled units without bindings', t => {
  const f = fxFixture(t), idx = compiled(f);
  idx.units.char_x_dependency_guard = idx.units.char_x_fx_demo_guard;
  f.put('fx/index.json', idx);
  const { value } = readFxAssets(f.root, { index: 'fx/index.json' }, ['fx-demo', 'dependency'], listPluginFiles(f.root));
  assert.equal(mergePluginFx(null, { 'fx-demo': value }).index.pluginUnits.char_x_dependency_guard, 'plugin:fx-demo:char_x_dependency_guard');
});

for (const path of ['prepare', 'merge']) test(`client ${path} validates hostile prefabs even when all units are owned`, t => {
  const f = fxFixture(t); compiled(f);
  const { value, files: used } = readFxAssets(f.root, { index: 'fx/index.json' }, ['fx-demo'], listPluginFiles(f.root));
  value.prefabs.spark.nodes[0].particleSystem = { InitialModule: { maxNumParticles: 1e9 } };
  if (path === 'merge') {
    assert.equal(mergePluginFx(null, { 'fx-demo': value }).descriptors.size, 0);
  } else {
    const ops = [{ at: ['fx', 'fx-demo'], effects: value }];
    const files = Object.fromEntries(used.map(rel => [rel, 'b'.repeat(64)]));
    const v = { v: 2, assets: 'a'.repeat(64), overlays: [{ id: 'fx-demo', version: '1.0.0', files, writes: visual.writesHashOf(ops) }] };
    v.vs = visual.visualHashOf(v);
    assert.equal(preparePluginFx({ visual: v, writes: [{ id: 'fx-demo', ops }] }, visual).length, 0);
  }
});
