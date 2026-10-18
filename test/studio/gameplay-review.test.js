// Review regressions use synthetic drafts and the installation's data, never Forge pack files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture } from '../helpers/contentFixtures.js';
import { createPlugin, templateById, manifestText } from '../../server/studio/templates/index.js';
import { createPluginFiles } from '../../server/studio/files.js';
import { createAuthoring } from '../../server/studio/authoring.js';
import { createTrialBench } from '../../server/studio/trial.js';
import { readStudioData } from '../../server/studio/gameData.js';
import { checkPluginFolder } from '../../server/plugins/pack.js';
import { buildContentSet } from '../../server/plugins/contentSet.js';
import { editGameplay } from '../../public/studio/js/gameplayModel.js';
import { GameplayExercise } from '../../public/studio/js/gameplayTrial.js';
import { ItemForm } from '../../public/studio/js/editors/item.js';
import { getData, setData } from '../../server/data.js';
import { createRegistry } from '../../server/match/effectsMeta.js';
import { Match } from '../../server/match/Match.js';
import { VirtualScheduler } from '../../server/match/scheduler.js';
import { PHASE } from '../../shared/constants.js';

const data = readStudioData(path.resolve('data'));
function setup(t, template, options = {}) {
  const f = fixture(t), id = `review-${template}`;
  const made = createPlugin(templateById(template), { id, options, data });
  const dir = f.put(id, made.manifest, {});
  for (const [rel, bytes] of Object.entries(made.files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), bytes);
  }
  fs.writeFileSync(path.join(dir, '.studio.json'), manifestText({ v: 1, authoring: made.authoring }));
  const files = createPluginFiles(path.dirname(dir)), author = createAuthoring({ files, dataDir: path.resolve('data') });
  const read = rel => fs.readFileSync(path.join(dir, rel), 'utf8');
  const write = (rel, value) => fs.writeFileSync(path.join(dir, rel), typeof value === 'string' ? value : manifestText(value));
  const draft = patch => editGameplay({ ...author.read(id), id }, patch);
  const bench = createTrialBench({ registry: f.registry, files }); t.after(() => bench.close());
  return { ...f, id, dir, read, write, draft, author, bench };
}
function nodes(v) {
  if (Array.isArray(v)) return v.flatMap(nodes);
  return v && typeof v === 'object' ? [v, ...nodes(v.props?.children)] : [];
}

test('review: bond rename preserves unowned fields, extra entries and raw JSON bytes; reopens visible edits', t => {
  const f = setup(t, 'bond');
  f.put('required-helper', { permissions: ['data.patch'], data: ['patch.json'] }, { 'patch.json': {
    patch: 1, ops: [{ op: 'set', file: 'items', id: 'chess_item_1_01_e_b', path: ['price'], value: 0 }],
  } });
  f.write('plugin.json', { ...JSON.parse(f.read('plugin.json')), requires: { 'required-helper': '*' } });
  const doc = JSON.parse(f.read('data/bond.json'));
  doc.entries.push({ file: 'bonds', id: 'bond_x_review_bond_extra', value: { name: 'Extra', desc: 'Extra', thresholds: [1] } });
  const text = manifestText(doc).replace('"isCore": false', '"isCore": false, "bondOrder" : 2.71e2, "maxCount":12');
  f.write('data/bond.json', text.replace(`"name": "${f.id}"`, '"name": "Manual name"'));
  const reopened = f.draft({}); assert.equal(reopened.options.name, 'Manual name');
  f.author.save(f.id, f.draft({ name: 'Renamed' }));
  assert.equal(f.read('data/bond.json'), text.replace(`"name": "${f.id}"`, '"name": "Renamed"'));
  assert.equal(JSON.parse(f.read('data/bond.json')).entries[0].value.bondOrder, 271);
});

test('review: mixed rules/data retains declarations, permissions and bytes in validation, trial and save', async t => {
  const f = setup(t, 'rules');
  const m = JSON.parse(f.read('plugin.json'));
  m.permissions = ['data.patch']; m.data = ['extra.json'];
  f.write('plugin.json', manifestText(m).replace('"data": [', '"data" : ['));
  const extra = '{ "patch":1, "ops":[{"op":"set","file":"items","id":"chess_item_1_01_e_a","path":["price"],"value":0}] }\n';
  f.write('extra.json', extra);
  const draft = f.draft({ rules: { unequip: 'allow' } });
  assert.equal(f.author.validateDraft(draft).ok, true);
  const trial = await f.bench.run({ id: f.id, seconds: 1, draft });
  assert.equal(trial.ok, true, JSON.stringify(trial.issues));
  f.author.save(f.id, draft);
  assert.deepEqual(checkPluginFolder(f.dir).problems, []);
  assert.equal(f.read('extra.json'), extra);
  assert.ok(f.read('plugin.json').includes('"data" : ['));
});

test('review: invalid retained content rejects both live validation and save before any write', t => {
  const f = setup(t, 'rules');
  const m = JSON.parse(f.read('plugin.json')); m.permissions = ['data.patch']; m.data = ['extra.json'];
  f.write('plugin.json', m); f.write('extra.json', { patch: 1, ops: [{ op: 'set', file: 'items', id: 'missing', path: ['price'], value: 1 }] });
  const before = [f.read('plugin.json'), f.read('extra.json'), f.read('.studio.json')];
  const draft = f.draft({ rules: { unequip: 'allow' } });
  assert.equal(f.author.validateDraft(draft).ok, false);
  assert.throws(() => f.author.save(f.id, draft));
  assert.deepEqual([f.read('plugin.json'), f.read('extra.json'), f.read('.studio.json')], before);
});

test('review: clearing bond effects retains separately declared DSL and its permission', t => {
  const f = setup(t, 'bond');
  const talents = JSON.parse(f.read('data/talents.json'));
  const extraTrait = { op: 1, charId: 'char_112_siege', trait: { desc: 'Extra trait', dsl: { dsl: 1,
    talents: [{ when: 'deploy', do: [{ buff: { mods: { atkPct: 0.1 } } }] }],
  } } };
  f.write('data/talents.json', [...talents, extraTrait]);
  const m = JSON.parse(f.read('plugin.json')); m.dsl.push('extra.json');
  f.write('plugin.json', m);
  const extra = manifestText({ dsl: 1, pluginId: f.id, meta: { key: `effect:${f.id}:extra`, on: [{ when: 'income', do: [{ funds: { amount: 2 } }] }] } });
  f.write('extra.json', extra);
  f.author.save(f.id, f.draft({ prep: [], talents: [] }));
  const next = JSON.parse(f.read('plugin.json'));
  assert.deepEqual(next.dsl, ['extra.json']); assert.ok(next.permissions.includes('dsl'));
  assert.deepEqual(next.operators, ['data/talents.json']);
  assert.deepEqual(JSON.parse(f.read('data/talents.json')), [extraTrait]);
  assert.deepEqual(f.author.read(f.id).options.talents, []);
  assert.equal(f.read('extra.json'), extra); assert.deepEqual(checkPluginFolder(f.dir).problems, []);
});

test('review: final item params use strings within a buff and the first occurrence across buffs', () => {
  const made = createPlugin(templateById('item'), { id: 'flatten', data, options: { paired: false, normal: {
    buffs: [{ key: 'synthetic', bb: { first: 1, shared: 4 }, bbStr: { shared: 'text' } },
      { key: 'synthetic', bb: { first: 2, last: 3 }, bbStr: {} }],
  } } });
  assert.deepEqual(JSON.parse(made.files['data/item.json']).entries[0].value.params, { first: 1, shared: 'text', last: 3 });
});

test('review: edited item buffs rebuild first-occurrence params and grant the edited layers on equip', t => {
  const source = data.items.chess_item_1_04_e_a;
  const f = setup(t, 'item', { base: source.id, paired: false, normal: { buffs: source.buffs.map(b => ({ ...b, bb: { ...b.bb, layer: 1 } })) } });
  f.registry.rescan(); const set = buildContentSet({ registry: f.registry, ids: [f.id] });
  assert.deepEqual(set.problems, []);
  const id = 'item_x_review_item_a'; assert.equal(set.data.items[id].params.layer, 1);
  const original = getData(); setData(set.data); t.after(() => setData(original));
  const scheduler = new VirtualScheduler();
  const m = new Match({ data: set.data, mode: 'solo', modeId: 'mode_single_normal', seed: 1, scheduler, registry: createRegistry(),
    seats: [{ playerId: 'p', seat: 0, name: 'P', isBot: false }], send: () => true, broadcast() {}, onEnd() {} });
  t.after(() => { m.dispose(); scheduler.dispose(); });
  m.phase = PHASE.PREP; m.round = 1;
  const ps = m.players.get('p'), rec = Object.values(set.data.chess).find(c => c.charId === 'char_102_texas' && !c.isGolden);
  const unit = ps.newPiece('chess', rec.chessId); ps.board.set('10,5', unit); ps.recompute();
  const item = ps.newPiece('item', id); ps.stow(item);
  assert.deepEqual(ps.equip(item.uid, unit.uid), { ok: true });
  for (const bid of rec.bonds) assert.equal(ps.layers[bid], 1);
});

for (const base of ['chess_item_6_09_e_a', 'chess_item_6_01_m']) test(`review: inherited item ${base} validates and composes`, t => {
  const f = setup(t, 'item', { base });
  assert.equal(f.author.validateDraft(f.draft({})).ok, true);
  f.registry.rescan(); const set = buildContentSet({ registry: f.registry, ids: [f.id] });
  assert.deepEqual(set.problems, []);
  const item = set.data.items.item_x_review_item_a;
  assert.equal(item.itemType, data.items[base].itemType); assert.equal(item.effectRef, base);
  if (!data.items[base].goldenId) assert.equal(item.goldenId, null);
});

test('review: item picker disables elite pairing for a base with no elite', () => {
  const tree = nodes(ItemForm({ draft: { id: 'picker', template: 'item', options: { base: 'chess_item_6_01_m' } }, onChange() {}, details: { items: data.items, defaults: {} } }));
  const toggle = tree.find(n => n.props?.label === '生成普通与精锐配对'); // i18n-ignore: test selector
  assert.equal(toggle.props.disabled, true); assert.equal(toggle.props.value, false);
});

test('review: bond sample uses SP_PLUGIN_RESOURCES as binary with an empty plugins mount', t => {
  const f = fixture(t), resources = path.join(f.dir, 'resources'), target = path.join(resources, '_template/cosmetic/media');
  fs.mkdirSync(target, { recursive: true });
  const bytes = Buffer.from([137, 80, 78, 71, 255, 0, 128]); fs.writeFileSync(path.join(target, 'sample.png'), bytes);
  const old = process.env.SP_PLUGIN_RESOURCES; process.env.SP_PLUGIN_RESOURCES = resources;
  t.after(() => { if (old === undefined) delete process.env.SP_PLUGIN_RESOURCES; else process.env.SP_PLUGIN_RESOURCES = old; });
  const made = createPlugin(templateById('bond'), { id: 'mounted', data });
  assert.deepEqual(made.files['assets/studio-bond.png'], bytes);
});

for (const hook of ['income', 'refresh']) test(`review: bond ${hook} default and explicit trials dispatch its real hook`, async t => {
  const f = setup(t, 'bond', { talents: [], prep: [{ when: hook, do: [{ funds: { amount: 7 } }] }] });
  f.registry.rescan();
  for (const exercise of [{}, { hook }]) {
    const r = await f.bench.run({ id: f.id, seconds: 1, exercise });
    assert.equal(r.ok, true, JSON.stringify(r.issues));
    assert.equal(r.exercise.after.funds - r.exercise.before.funds, 7);
  }
  const field = nodes(GameplayExercise({ template: 'bond', value: {}, onChange() {} })).find(n => n.props?.label === '触发器'); // i18n-ignore: test selector
  assert.ok(field.props.options.includes(hook)); assert.ok(!field.props.options.includes('gain'));
});

test('review: rules trial exercises four real actions and passes equipment/loadout/morph into replay', async t => {
  const f = setup(t, 'rules', { rules: { shopBias: 'bondBias', prepLoadout: 'prep', morphPairing: 'plus', unequip: 'allow' } });
  f.registry.rescan(); const r = await f.bench.run({ id: f.id, seconds: 2 });
  assert.equal(r.ok, true, JSON.stringify(r.issues));
  assert.equal(r.plugin.spec.morphPairing, 'plus');
  assert.equal(r.vanilla.spec.morphPairing, undefined);
  const checks = Object.fromEntries(r.exercise.ruleChecks.map(c => [c.rule, c]));
  const base = Object.fromEntries(r.exercise.reference.map(c => [c.rule, c]));
  assert.equal(checks.shopBias.active, true, JSON.stringify(checks.shopBias));
  assert.notDeepEqual(checks.shopBias.draws, base.shopBias.draws);
  assert.ok(checks.shopBias.outcomes.every(x => x.ok));
  assert.equal(checks.prepLoadout.result.ok, true, JSON.stringify(checks.prepLoadout)); assert.ok(base.prepLoadout.result.error);
  assert.equal(checks.unequip.result.ok, true, JSON.stringify(checks.unequip)); assert.equal(checks.unequip.returned, true); assert.ok(base.unequip.result.error);
  assert.equal(checks.morphPairing.items.length, 3); assert.equal(base.morphPairing.items.length, 2);
  assert.deepEqual(r.plugin.spec.players[0].units[0].items, checks.morphPairing.items);
  assert.equal(r.plugin.spec.players[0].units[0].skillIndex, 0);
});
