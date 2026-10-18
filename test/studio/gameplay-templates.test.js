// Synthetic author drafts only; official records are read from the installation, never copied into fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture } from '../helpers/contentFixtures.js';
import { createPlugin, templateById, manifestText } from '../../server/studio/templates/index.js';
import { createPluginFiles } from '../../server/studio/files.js';
import { createAuthoring } from '../../server/studio/authoring.js';
import { checkGameplayDraft } from '../../server/studio/gameplayCheck.js';
import { buildContentSet } from '../../server/plugins/contentSet.js';
import { checkPluginFolder } from '../../server/plugins/pack.js';
import { createTrialBench } from '../../server/studio/trial.js';
import { GAMEPLAY_TEMPLATES, editGameplay, gameplayOptions, bondId } from '../../public/studio/js/gameplayModel.js';
import { validateDraft } from '../../public/studio/js/validateDraft.js';
import { BondEditor } from '../../public/studio/js/editors/bond.js';
import { ItemForm } from '../../public/studio/js/editors/item.js';
import { TraitEditor } from '../../public/studio/js/editors/trait.js';
import { OffersEditor } from '../../public/studio/js/editors/offers.js';
import { RulesEditor } from '../../public/studio/js/editors/rules.js';
import { validateTraitSpec, TRAIT_EVENTS } from '../../server/plugins/operatorTraits.js';
import { gameplayTrial } from '../../server/studio/gameplayTrial.js';
import { chooseOperator, trialScenario } from '../../server/studio/trialScenario.js';
import { createPreviewLayers } from '../../public/studio/js/preview/layers.js';

function setup(t, template, options = {}) {
  const f = fixture(t), id = `form-${template}`;
  const made = createPlugin(templateById(template), { id, options });
  const dir = f.put(id, made.manifest, made.files);
  fs.writeFileSync(path.join(dir, '.studio.json'), manifestText({ v: 1, authoring: made.authoring }));
  const files = createPluginFiles(path.join(f.dir, 'plugins'));
  const author = createAuthoring({ files, dataDir: path.resolve('data') });
  return { ...f, id, dir, files, made, author };
}

const edits = {
  bond: { name: 'Edited bond', thresholds: [1, 3], desc: 'Member talent', countMode: 'BOARD_AND_DECK', isCore: true, members: ['char_102_texas'] },
  item: { name: 'Edited item', paired: true, normal: { price: 3, tier: 2 }, elite: { price: 5, tier: 3 }, hideInShop: true },
  trait: { desc: 'Edited trait', override: true, translations: { en: 'Trait' }, spec: { dsl: 1, talents: [{ when: 'elementBurst', if: { element: 'erosion', targetOnField: true, selfOnField: false }, do: [{ layers: { bond: 'selfActive', amount: 1, maxPerBattle: 2 } }] }], meta: { on: [{ when: 'gain', do: [{ gainItem: { item: 'chess_item_1_01_e_a', count: 2 } }] }] } } },
  offers: { window: { offer: 1, id: 'edited', when: { at: ['prep', 'battleCheck'], rounds: { from: 3, to: 9 } }, windowSec: 12, quorum: 'none', onTimeout: 'skip', slots: 2, refresh: { perSlot: 2 }, defer: ['prepSettle'], options: { source: 'offers/cards.json' } } },
  rules: { rules: { shopBias: 'bondBias', prepLoadout: 'prep', morphPairing: 'plus', unequip: 'allow' } },
};
const badEdits = {
  bond: { thresholds: [0] }, item: { normal: { price: -1, tier: 7 } },
  trait: { spec: { dsl: 1, talents: [{ when: 'elementBurst', do: [{ layers: { bond: 'selfActive', amount: 1, maxPerBattle: 1000001 } }] }] } },
  offers: { window: { offer: 1, id: 'bad', when: { at: ['prep'] }, slots: 7, windowSec: 9999, options: { source: 'offers/cards.json' } } },
  rules: { rules: { unequip: 'sometimes' } },
};
for (const template of GAMEPLAY_TEMPLATES) {
  test(`${template}: form -> JSON -> save -> strict check/composition; invalid field leaves files unchanged`, t => {
    const f = setup(t, template);
    const initial = { ...f.author.read(f.id), id: f.id };
    const draft = editGameplay(initial, edits[template]);
    assert.deepEqual(gameplayOptions(JSON.parse(JSON.stringify(draft))), draft.options);
    f.author.save(f.id, draft);
    assert.deepEqual(JSON.parse(f.files.readSidecar(f.id, '.studio.json')).authoring.options, draft.options);
    const checked = checkPluginFolder(f.dir);
    assert.deepEqual(checked.problems, []); assert.deepEqual(checked.warnings, []);
    f.registry.rescan();
    const set = buildContentSet({ registry: f.registry, ids: [f.id] });
    assert.deepEqual(set.problems, []);
    if (template === 'bond') {
      const b = set.data.bonds[bondId(f.id)];
      assert.ok(b.members.length); assert.deepEqual(b.thresholds, [1, 3]);
      assert.ok(b.members.every(id => set.data.chess[id].bonds.includes(b.bondId)));
    }
    if (template === 'item') {
      const a = set.data.items.item_x_form_item_a, b = set.data.items.item_x_form_item_b;
      assert.equal(a.goldenId, b.id); assert.equal(b.baseId, a.id); assert.equal(a.price, 3); assert.equal(b.price, 5);
      assert.equal(a.effectRef, 'chess_item_1_01_e_a'); assert.equal(b.effectRef, 'chess_item_1_01_e_b');
    }
    if (template === 'rules') assert.deepEqual(set.rules, edits.rules.rules);
    const before = fs.readFileSync(path.join(f.dir, 'plugin.json'), 'utf8');
    const invalid = editGameplay({ ...f.author.read(f.id), id: f.id }, badEdits[template]);
    const result = f.author.validateDraft(invalid);
    assert.equal(result.ok, false); assert.ok(result.problems[0].code.startsWith('PLUGIN_'));
    assert.ok(result.problems[0].message.length > 0);
    assert.throws(() => f.author.save(f.id, invalid));
    assert.equal(fs.readFileSync(path.join(f.dir, 'plugin.json'), 'utf8'), before);
  });

  test(`${template}: fresh template passes complete check and runs an unsaved trial battle`, { timeout: 60000 }, async t => {
    const f = setup(t, template);
    assert.equal(checkGameplayDraft(f.id, f.made).ok, true);
    const bench = createTrialBench({ registry: f.registry, files: f.files }); t.after(() => bench.close());
    const result = await bench.run({ id: f.id, scenario: 'dummy', seconds: 2, draft: { template, options: {} } });
    assert.equal(result.ok, true, JSON.stringify(result.issues));
    assert.ok(result.plugin.frames.length > 1); assert.deepEqual(result.plugin.errors, []);
    assert.ok(result.exercise);
    if (template === 'bond') {
      assert.equal(result.plugin.spec.players[0].bonds[bondId(f.id)].active, true);
      assert.equal(result.exercise.after.funds, result.exercise.before.funds + 1);
      assert.ok(result.plugin.damage > result.vanilla.damage);
    }
    if (template === 'item') assert.deepEqual(result.plugin.spec.players[0].units[0].items, ['item_x_form_item_a']);
    if (template === 'trait') assert.ok(result.plugin.damage > result.vanilla.damage);
    if (template === 'offers') {
      assert.equal(result.exercise.windows.length, 1); assert.equal(result.exercise.blocking, true);
      const w = result.exercise.windows[0], slot = w.seats[0].slots[0];
      const picked = await bench.run({ id: f.id, seconds: 1, exercise: { actions: [{ kind: 'pick', id: w.id, pluginId: w.pluginId, idx: 0, cardId: slot.id }] } });
      assert.equal(picked.ok, true, JSON.stringify(picked.issues));
      assert.equal(picked.exercise.windows.length, 0);
      assert.ok(picked.exercise.after.funds > picked.exercise.before.funds);
    }
  });
}

test('save gate validates all five full drafts through the existing keyed validator endpoint', async () => {
  for (const template of GAMEPLAY_TEMPLATES) {
    const draft = { id: 'form-test', template, options: badEdits[template] };
    const result = await validateDraft(draft, { get: () => assert.fail('no example fetch'), post: async (route, body) => {
      assert.equal(route, 'validate-dsl'); assert.deepEqual(body, { draft }); return { ok: false };
    } });
    assert.equal(result.ok, false);
  }
});

// Invoke the real forms and their field callbacks without opening a browser or replacing editor code.
function nodes(v) {
  if (Array.isArray(v)) return v.flatMap(nodes);
  if (!v || typeof v !== 'object') return [];
  return [v, ...nodes(v.props?.children)];
}
for (const [template, Form, label, value, read] of [
  ['bond', BondEditor, '名字', 'Round trip bond', o => o.name],
  ['item', ItemForm, '价格', 17, o => o.normal.price],
  ['trait', TraitEditor, '特质文本（中文）', 'Round trip trait', o => o.desc],
  ['offers', OffersEditor, '选项数量', 3, o => o.window.slots],
  ['rules', RulesEditor, 'unequip', 'allow', o => o.rules.unequip],
]) test(`${template}: actual form callback survives JSON and renders the edited value`, () => {
  let draft = { id: 'round-trip', template, options: {} };
  const render = () => nodes(Form({ draft, onChange: next => { draft = JSON.parse(JSON.stringify(next)); } }));
  const field = render().find(n => n.props?.label === label);
  assert.ok(field, label);
  field.props.onChange(value);
  assert.equal(read(draft.options), value);
  assert.equal(render().find(n => n.props?.label === label).props.value, value);
});

test('removing both bond effect lists removes owned parts/permission and preserves the icon', t => {
  const f = setup(t, 'bond');
  f.author.save(f.id, editGameplay({ ...f.author.read(f.id), id: f.id }, { prep: [], talents: [] }));
  const manifest = JSON.parse(fs.readFileSync(path.join(f.dir, 'plugin.json'), 'utf8'));
  assert.equal(manifest.operators, undefined); assert.equal(manifest.dsl, undefined);
  assert.equal(manifest.permissions.includes('dsl'), false);
  assert.ok(manifest.assets.bonds[bondId(f.id)]);
  f.registry.rescan();
  const set = buildContentSet({ registry: f.registry, ids: [f.id] });
  assert.deepEqual(set.problems, []);
  assert.equal(Object.values(set.data.garrisons).some(g => g.operatorTrait?.pluginId === f.id), false);
});

test('two authored bonds retain each other on a shared official member', t => {
  const f = setup(t, 'bond', { prep: [], talents: [] });
  const other = createPlugin(templateById('bond'), { id: 'second-bond', options: { prep: [], talents: [] } });
  f.put('second-bond', other.manifest, other.files);
  const set = buildContentSet({ registry: f.registry, ids: [f.id, 'second-bond'] });
  assert.deepEqual(set.problems, []);
  const member = Object.values(set.data.chess).find(c => c.charId === 'char_102_texas' && !c.isGolden);
  assert.ok(member.bonds.includes(bondId(f.id))); assert.ok(member.bonds.includes(bondId('second-bond')));
});

test('trait form vocabulary covers all eight prep hooks, burst filters and both numeric caps', () => {
  assert.throws(() => templateById('trait').build({ id: 'trait-test', options: { charId: 'char_backup_only' },
    data: { chess: {}, backups: { units: { char_backup_only: {} } } } }), { code: 'PLUGIN_DATA_REFERENCE' });
  const spec = { dsl: 1, talents: [{ when: 'elementBurst', if: { element: 'apoptosis', targetOnField: true, selfOnField: false },
    do: [{ layers: { bond: 'selfActive', amount: 1, maxPerBattle: 1000000 } }] }],
  meta: { on: TRAIT_EVENTS.map(when => ({ when, do: [{ gainItem: { item: 'synthetic-item', count: 64 } }] })) } };
  assert.equal(validateTraitSpec(spec, 'trait-test'), spec);
  assert.throws(() => validateTraitSpec({ ...spec, meta: { on: [{ when: 'gain', do: [{ gainItem: { item: 'synthetic-item', count: 65 } }] }] } }, 'trait-test'), { code: 'PLUGIN_DSL_NUMBER' });
  assert.throws(() => validateTraitSpec({ ...spec, talents: [{ ...spec.talents[0], if: { targetOnField: 'yes' } }] }, 'trait-test'), { code: 'PLUGIN_DSL_CONDITION' });
});

test('offer exercise uses real refresh limits, round matching and timeout grants', async t => {
  const f = setup(t, 'offers');
  const set = buildContentSet({ registry: f.registry, ids: [f.id] });
  const op = chooseOperator(set.data);
  const scene = await trialScenario({ seconds: 1 }, set.data, op, op);
  const draft = { id: f.id, template: 'offers', options: {} };
  const run = exercise => gameplayTrial(set, scene, draft, { exercise });
  const first = run({}), w = first.windows[0], slot = w.seats[0].slots[0];
  const action = { kind: 'refresh', id: w.id, pluginId: w.pluginId, idx: 0, cardId: slot.id };
  const refreshed = run({ actions: [action] });
  assert.deepEqual(refreshed.outcomes, [{ ok: true }]);
  const next = refreshed.windows[0].seats[0].slots[0];
  assert.notEqual(next.id, slot.id); assert.equal(next.remaining, 0);
  assert.ok(run({ actions: [action, { ...action, cardId: next.id }] }).outcomes[1].error);
  assert.equal(run({ round: 2 }).windows.length, 0);
  const timeout = run({ actions: [{ kind: 'timeout' }] });
  assert.equal(timeout.blocking, false); assert.equal(timeout.windows.length, 0);
  assert.ok(timeout.after.funds > timeout.before.funds);
});

test('new bond art is mirrored into the ordinary slot preview', () => {
  const key = bondId('icon-test'), layers = createPreviewLayers();
  layers.set([{ at: ['bonds', key], value: '/studio/api/plugins/icon-test/file/assets/icon.png' }], [{ kind: 'bond', key, container: ['bonds'] }]);
  assert.equal(layers.apply({ bonds: {} }).bonds[`${key}~plugin`], '/studio/api/plugins/icon-test/file/assets/icon.png');
});
