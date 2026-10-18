// A data plugin's DSL operator fights on the server and through the browser-style loader, and a bad spec
// refuses the content set (DESIGN §32.5 / §32.7, PLUGIN-DSL.md §9).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeBattle } from '../helpers/battleHarness.js';
import { fixture } from '../helpers/contentFixtures.js';
import { buildContentSet, contentSetFiles } from '../../server/plugins/contentSet.js';
import { DataSource } from '../../server/sim/simdata.js';
import { setGameData } from '../../server/sim/content/support/index.js';
import { DATA_SHIM_JS } from '../../server/http/static.js';
import { loadBrowserSim } from '../../public/js/battle/runner.js';
import { buildBattleSpec, createBattleFromSpec, resultDigest } from '../../server/sim/spec.js';
import { budgetUsed } from '../../server/sim/content/dsl/budget.js';
import { kitOf, selectSkillSpec } from '../../server/sim/content/index.js';
import { getData } from '../../server/data.js';
import { rememberOfficialBounds } from '../../shared/plugins/officialBounds.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);

function operator(id, dsl) {
  const ns = id.replace(/-/g, '_');
  return {
    op: 1,
    charId: `char_x_${ns}_caster`,
    name: 'Demo caster',
    profession: 'CASTER',
    subProfessionId: 'corecaster',
    position: 'RANGED',
    rarity: 3,
    as: 'both',
    chess: { tier: 1, bonds: ['deputShip'] },
    forms: {
      normal: { stats: { maxHp: 2000, atk: 200, def: 50, bat: 1.2, blockCnt: 1 }, rangeGrid: [[0, 0], [0, 1]] },
      elite: { stats: { maxHp: 3000, atk: 300, def: 80, bat: 1.2, blockCnt: 1 }, rangeGrid: [[0, 0], [0, 1]] },
    },
    skills: [{ skillId: `skx_${ns}_caster_1`, name: 'Cast', duration: 10, spCost: 10, initSp: 10, default: true }],
    trait: { desc: 'Ranged arts' },
    kit: { dsl },
    art: { ref: 'char_199_yak' },
  };
}

function melee(id, dsl) {
  const ns = id.replace(/-/g, '_');
  return {
    op: 1,
    charId: `char_x_${ns}_keep`,
    name: 'Keep',
    profession: 'WARRIOR',
    subProfessionId: 'fearless',
    position: 'MELEE',
    rarity: 3,
    as: 'chess',
    chess: { tier: 1, bonds: ['deputShip'] },
    forms: {
      normal: { stats: { maxHp: 2000, atk: 100, def: 0, bat: 2, blockCnt: 1 }, rangeGrid: [[0, 0], [0, 1]] },
      elite: { stats: { maxHp: 2000, atk: 100, def: 0, bat: 2, blockCnt: 1 }, rangeGrid: [[0, 0], [0, 1]] },
    },
    skills: [{ skillId: `skx_${ns}_keep_1`, name: 'K', duration: 10, spCost: 10, initSp: 0, default: true }],
    trait: { desc: 'Melee' },
    kit: { dsl },
    art: { ref: 'char_199_yak' },
  };
}

const passive = { dsl: 1, skill: { kind: 'passive', mods: { atkPct: 0.5 } } };

test('a data-plugin DSL operator fights the same battle on the server and in the browser loader', async (t) => {
  const f = fixture(t);
  f.put('data-demo', { permissions: ['data.add', 'dsl'], operators: ['op.json'] }, { 'op.json': operator('data-demo', passive) });
  const set = buildContentSet({ registry: f.registry, ids: ['data-demo'] });
  assert.deepEqual(set.problems, []);
  assert.equal(Object.hasOwn(set.data, 'dsl'), false, 'a battle spec is on the chess record, not data.dsl');
  const id = 'chess_x_data_demo_caster_a';
  const rec = set.data.chess[id];
  assert.equal(rec.pluginId, 'data-demo');
  assert.equal(rec.dsl.pluginId, undefined, 'the author spec is not rewritten');
  assert.equal(rec.dsl.skill.mods.atkPct, 0.5);
  assert.equal(set.data.backups.units.char_x_data_demo_caster.pluginId, 'data-demo');
  const chessBytes = contentSetFiles(set).get('data/chess.json').body.toString('utf8');
  assert.match(chessBytes, /"pluginId":"data-demo"/);
  assert.match(chessBytes, /"atkPct":0\.5/);
  setGameData(set.data);
  t.after(() => setGameData(null));

  const h = makeBattle({ data: new DataSource(set.data), units: [{ chessId: id, row: 10, col: 5 }] });
  h.step();
  const u = h.unit(id);
  assert.notEqual(u.kit.generic, true);
  assert.equal(u.def.raw.pluginId, 'data-demo');
  close(u.s.atk, 300);

  const runtime = path.join(f.dir, 'runtime');
  fs.mkdirSync(path.join(runtime, 'server'), { recursive: true });
  // as the browser gets /sim/: no Node loader (by file name — cpSync passes paths with the OS separator, `\` on
  // Windows). With it simdata.js → nodeData.js → this data.js shim → simdata.js would deadlock the imports below.
  fs.cpSync('server/sim', path.join(runtime, 'server/sim'), { recursive: true, filter: (src) => path.basename(src) !== 'nodeData.js' });
  assert.equal(fs.existsSync(path.join(runtime, 'server/sim/nodeData.js')), false);
  fs.cpSync('shared', path.join(runtime, 'shared'), { recursive: true });
  fs.writeFileSync(path.join(runtime, 'package.json'), '{"type":"module"}');
  fs.writeFileSync(path.join(runtime, 'server/data.js'), DATA_SHIM_JS);
  const table = contentSetFiles(set);
  const base = pathToFileURL(path.join(runtime, 'server/sim')).href + '/';
  const files = Object.fromEntries([...table].filter(([rel]) => /^data\/[^/]+\.json$/.test(rel)).map(([rel, file]) => [rel.slice(5, -5), JSON.parse(file.body.toString('utf8'))]));
  const bounds = JSON.parse(table.get('bounds/official.json').body.toString('utf8'));
  const noFetch = async (url) => assert.fail(`no fetch for a content set (${url})`);
  const loaded = await loadBrowserSim({ base, data: files, cs: set.cs, bounds, fetchFn: noFetch });
  assert.equal(loaded.cs, set.cs);
  assert.equal(files.chess[id].pluginId, 'data-demo');
  const spec = buildBattleSpec({ ...h.b.opts, stageId: 'flat' });
  const server = createBattleFromSpec(spec, new DataSource(set.data));
  const browser = loaded.spec.createBattleFromSpec(spec, loaded.ds);
  server.start();
  browser.start();
  for (let i = 0; i < 30; i++) { server.step(); browser.step(); }
  close(browser.allyUnits[0].s.atk, 300);
  close(server.allyUnits[0].s.atk, 300);
  assert.deepEqual(browser.snapshot(), server.snapshot());
  assert.deepEqual(resultDigest(browser.result()), resultDigest(server.result()));
});

test('a bad DSL spec, a spoofed pluginId, a missing permission and an official chess are refused', (t) => {
  const f = fixture(t);
  const put = (manifest, documents) => {
    f.put('data-demo', manifest, documents);
    return buildContentSet({ registry: f.registry, ids: ['data-demo'] });
  };
  const bad = put(
    { permissions: ['data.add', 'dsl'], operators: ['op.json'] },
    { 'op.json': operator('data-demo', {}) },
  );
  assert.equal(bad.cs, undefined);
  assert.equal(bad.problems[0].code, 'PLUGIN_DSL_VERSION');
  assert.equal(f.registry.plugin('data-demo').status, 'loaded');

  const spoof = put(
    { permissions: ['data.add', 'dsl'], operators: ['op.json'] },
    { 'op.json': operator('data-demo', { ...passive, pluginId: 'other-plug' }) },
  );
  assert.equal(spoof.cs, undefined);
  assert.equal(spoof.problems[0].code, 'PLUGIN_DSL_PLUGIN_ID');

  const bare = put(
    { permissions: ['data.add'], operators: ['op.json'] },
    { 'op.json': operator('data-demo', passive) },
  );
  assert.equal(bare.cs, undefined);
  assert.ok(bare.problems.some((p) => p.code === 'PLUGIN_CONTENT_PERMISSION'));

  const official = put(
    { permissions: ['data.patch', 'dsl'], data: ['p.json'] },
    { 'p.json': { patch: 1, ops: [{ op: 'merge', file: 'chess', id: 'chess_char_1_02_a', value: { dsl: passive, pluginId: 'data-demo' } }] } },
  );
  assert.equal(official.cs, undefined);
  assert.ok(official.problems.some((p) => p.code === 'PLUGIN_DSL_PLUGIN_ID'));

  f.put('data-demo', { permissions: ['dsl'], dsl: ['p.json'] }, { 'p.json': { dsl: 1 } });
  assert.equal(f.registry.plugin('data-demo'), null);
  assert.ok(f.registry.report().skipped.some((p) => p.problems.some((s) => s.includes('PLUGIN_DSL_META'))));

  f.put('data-demo', { permissions: ['dsl'], dsl: ['p.json'] }, {
    'p.json': { dsl: 1, pluginId: 'other-plug', meta: { key: 'effect:other-plug:income', on: [{ when: 'income', do: [{ funds: { amount: 1, setIncome: true } }] }] } },
  });
  assert.equal(f.registry.plugin('data-demo'), null);
  assert.ok(f.registry.report().skipped.some((p) => p.problems.some((s) => s.includes('PLUGIN_DSL_PLUGIN_ID'))));
});

test('DSL in two data plugins spends each plugin id budget', (t) => {
  const f = fixture(t);
  const wide = { dsl: 1, talents: [{ when: 'deploy', do: [{ buff: { target: 'self', key: 'keep', duration: 30, mods: { atkFlat: 50 } } }] }] };
  const tiny = { dsl: 1, budget: 2, talents: [{ when: 'every', seconds: 1 / 30, do: [{ dp: { amount: 1 } }] }] };
  f.put('wideplug', { permissions: ['data.add', 'dsl'], operators: ['op.json'] }, { 'op.json': melee('wideplug', wide) });
  f.put('tinyplug', { permissions: ['data.add', 'dsl'], operators: ['op.json'] }, { 'op.json': melee('tinyplug', tiny) });
  const set = buildContentSet({ registry: f.registry, ids: ['wideplug', 'tinyplug'] });
  assert.deepEqual(set.problems, [], JSON.stringify(set.problems));
  assert.equal(set.data.chess.chess_x_wideplug_keep_a.pluginId, 'wideplug');
  assert.equal(set.data.chess.chess_x_tinyplug_keep_a.pluginId, 'tinyplug');
  const h = makeBattle({
    data: new DataSource(set.data),
    autoFinish: false,
    timeLimit: 5,
    flags: { dpPerSec: 0 },
    units: [
      { chessId: 'chess_x_wideplug_keep_a', row: 10, col: 5 },
      { chessId: 'chess_x_tinyplug_keep_a', row: 10, col: 6 },
    ],
  });
  h.step(1);
  h.run(0.4);
  const v = h.unit('chess_x_wideplug_keep_a');
  const buff = v.findBuff('keep');
  assert.ok(buff, 'the wide budget still holds its buff');
  assert.ok(buff.tags.includes('plugin:wideplug'));
  assert.notEqual(v.s.atk, 100);
  assert.ok(budgetUsed(h.battle, 'tinyplug') > 0);
  assert.notEqual(budgetUsed(h.battle, 'wideplug'), budgetUsed(h.battle, 'tinyplug'));
  assert.equal(h.battle.errors.filter((e) => e.label === 'plugin:wideplug').length, 0);
  assert.equal(h.battle.errors.filter((e) => e.label === 'plugin:tinyplug').length, 1);
});

test('a PLUGIN_DSL_* kit throw ends the battle; any other throw is still the generic kit', () => {
  const id = 'chess_char_1_02_a';
  const boom = (code) => () => { const e = new Error('kit'); if (code) e.code = code; throw e; };
  const bad = makeBattle({ units: [{ chessId: id, row: 10, col: 5 }], kits: { [id]: boom('PLUGIN_DSL_VERSION') } });
  assert.equal(bad.battle.finished, true);
  assert.equal(bad.battle.started, true);
  assert.equal(bad.battle.reason, 'forced');
  assert.equal(bad.battle.contentFault.layer, 'setupUnitKit');
  assert.equal(bad.battle.contentFault.code, 'PLUGIN_DSL_VERSION');
  assert.ok(bad.battle.errors.some((e) => e.label === 'content:dsl' && String(e.message).includes('PLUGIN_DSL_VERSION')));
  assert.equal(bad.result().reason, 'forced');
  assert.ok(bad.result().errors > 0);
  bad.step();
  assert.equal(bad.battle.time, 0);
  const plain = makeBattle({ units: [{ chessId: id, row: 10, col: 5 }], kits: { [id]: boom(null) } });
  plain.step();
  const g = plain.unit(id);
  assert.equal(g.kit.generic, true);
  assert.equal(g.skill.noSkill, false);
  assert.equal(plain.battle.finished, false);
  // PLUGIN_DATA_BOUND on a chess that has no dsl is not a content fault.
  const other = makeBattle({ units: [{ chessId: id, row: 10, col: 5 }], kits: { [id]: boom('PLUGIN_DATA_BOUND') } });
  other.step();
  assert.equal(other.unit(id).kit.generic, true);
  assert.equal(other.battle.contentFault, undefined);
});

const incomeDoc = (id, key = `effect:${id}:income`, amount = 15) => ({
  dsl: 1,
  pluginId: id,
  meta: { key, on: [{ when: 'income', do: [{ funds: { amount, setIncome: true } }] }] },
});

test('potDown cannot attach dsl or pluginId, and a form DSL write needs the owner and the dsl permission', (t) => {
  const f = fixture(t);
  f.put('alpha', { permissions: ['data.patch'], data: ['p.json'] }, {
    'p.json': { patch: 1, ops: [{ op: 'merge', file: 'chess', id: 'chess_char_1_02_a', value: { potDown: { '4': { dsl: { dsl: 2 }, pluginId: 'victim', atk: 1 } } } }] },
  });
  const pot = buildContentSet({ registry: f.registry, ids: ['alpha'] });
  assert.equal(pot.cs, undefined);
  assert.ok(pot.problems.some((p) => p.code === 'PLUGIN_DSL_PLUGIN_ID' && p.plugin === 'alpha' && /potDown cannot write dsl or pluginId/.test(p.message)));

  f.put('alpha', { permissions: ['data.patch'], data: ['p.json'] }, {
    'p.json': { patch: 1, ops: [{ op: 'merge', file: 'chess', id: 'chess_char_1_02_a', value: { potDown: { '4': { 'stats.atk': 1 } } } }] },
  });
  const stat = buildContentSet({ registry: f.registry, ids: ['alpha'] });
  assert.deepEqual(stat.problems, [], JSON.stringify(stat.problems));
  assert.equal(stat.data.chess.chess_char_1_02_a.potDown['4']['stats.atk'], 1);

  const body = operator('alpha', null);
  delete body.kit;
  f.put('alpha', { permissions: ['data.add'], operators: ['op.json'] }, { 'op.json': body });
  const alone = buildContentSet({ registry: f.registry, ids: ['alpha'] });
  assert.deepEqual(alone.problems, [], JSON.stringify(alone.problems));
  const forms = alone.data.backups.units.char_x_alpha_caster.forms;
  const status = Object.keys(forms)[0];
  assert.equal(forms[status].dsl, undefined);
  f.put('bravo', { permissions: ['data.patch'], requires: { alpha: '*' }, data: ['p.json'] }, {
    'p.json': {
      patch: 1,
      ops: [{
        op: 'merge', file: 'backups', path: ['units', 'char_x_alpha_caster', 'forms', status],
        value: { dsl: { dsl: 1, skill: { kind: 'passive', mods: { atkFlat: 50 } } }, pluginId: 'alpha' },
      }],
    },
  });
  const form = buildContentSet({ registry: f.registry, ids: ['alpha', 'bravo'] });
  assert.equal(form.cs, undefined);
  assert.ok(form.problems.some((p) => p.code === 'PLUGIN_CONTENT_PERMISSION' && p.plugin === 'bravo'));
  assert.ok(form.problems.some((p) => p.code === 'PLUGIN_DSL_PLUGIN_ID' && p.plugin === 'bravo' && /only the record owner/.test(p.message)));
});

test('a data patch cannot rewrite the reserved dsl table', (t) => {
  const f = fixture(t);
  f.put('alpha', { permissions: ['dsl'], dsl: ['dsl/income.json'] }, { 'dsl/income.json': incomeDoc('alpha', 'effect:alpha:income', 15) });
  const own = buildContentSet({ registry: f.registry, ids: ['alpha'] });
  assert.deepEqual(own.problems, []);
  assert.equal(own.data.dsl.alpha[0].meta.on[0].do[0].funds.amount, 15);
  f.put('bravo', { permissions: ['data.patch'], data: ['p.json'] }, {
    'p.json': { patch: 1, ops: [{ op: 'set', file: 'dsl', id: 'alpha', value: [incomeDoc('alpha', 'effect:alpha:income', 99)] }] },
  });
  const stolen = buildContentSet({ registry: f.registry, ids: ['alpha', 'bravo'] });
  assert.equal(stolen.cs, undefined);
  assert.equal(stolen.data, undefined);
  const hit = stolen.problems.find((p) => p.code === 'PLUGIN_DSL_PLUGIN_ID' && p.plugin === 'bravo');
  assert.ok(hit, JSON.stringify(stolen.problems));
  assert.match(hit.message, /reserved dsl table/);
});

test('another plugin cannot replace a record DSL; the owner can', (t) => {
  const f = fixture(t);
  const first = { dsl: 1, skill: { kind: 'passive', mods: { atkPct: 0.1 } } };
  const next = { dsl: 1, skill: { kind: 'passive', mods: { atkPct: 0.25 } } };
  f.put('alpha', { permissions: ['data.add', 'data.patch', 'dsl'], data: ['rec.json', 'patch.json'] }, {
    'rec.json': { records: 1, entries: [operator('alpha', first)] },
    'patch.json': { patch: 1, ops: [{ op: 'set', file: 'chess', id: 'chess_x_alpha_caster_a', path: ['dsl'], value: next }] },
  });
  const own = buildContentSet({ registry: f.registry, ids: ['alpha'] });
  assert.deepEqual(own.problems, [], JSON.stringify(own.problems));
  assert.equal(own.data.chess.chess_x_alpha_caster_a.pluginId, 'alpha');
  assert.equal(own.data.chess.chess_x_alpha_caster_a.dsl.skill.mods.atkPct, 0.25);

  f.put('alpha', { permissions: ['data.add', 'dsl'], operators: ['op.json'] }, { 'op.json': melee('alpha', first) });
  const stolenSpec = { dsl: 1, budget: 2, talents: [{ when: 'every', seconds: 1 / 30, do: [{ dp: { amount: 1 } }] }] };
  f.put('bravo', { permissions: ['data.patch', 'dsl'], requires: { alpha: '*' }, data: ['p.json'] }, {
    'p.json': { patch: 1, ops: [{ op: 'set', file: 'chess', id: 'chess_x_alpha_keep_a', path: ['dsl'], value: stolenSpec }] },
  });
  const stolen = buildContentSet({ registry: f.registry, ids: ['alpha', 'bravo'] });
  assert.equal(stolen.cs, undefined);
  assert.equal(stolen.data, undefined);
  assert.ok(stolen.problems.some((p) => p.code === 'PLUGIN_DSL_PLUGIN_ID' && p.plugin === 'bravo'));
  assert.equal(stolen.problems.some((p) => p.plugin === 'alpha' && p.code === 'PLUGIN_DSL_PLUGIN_ID'), false);
});

test('DSL literals above the official cap are refused; an in-range product is clamped', (t) => {
  const f = fixture(t);
  const put = (dsl) => {
    f.put('bounds', { permissions: ['data.add', 'dsl'], operators: ['op.json'] }, { 'op.json': operator('bounds', dsl) });
    return buildContentSet({ registry: f.registry, ids: ['bounds'] });
  };
  const cases = [
    [{ dsl: 1, skill: { kind: 'passive', mods: { atkPct: 1e9 } } }, /黑板 atk/, /300/],
    [{ dsl: 1, skill: { kind: 'passive', ammo: 1e9 } }, /黑板 ammo/, /64/],
    [{ dsl: 1, skill: { kind: 'passive', spCost: 1e9 } }, /字段 skill\.spCost/, /1200/],
    [{ dsl: 1, skill: { kind: 'passive', initSp: 1e9 } }, /字段 skill\.initSp/, /1100/],
    [{ dsl: 1, skill: { kind: 'passive', attack: { atkScale: 1e9 } } }, /黑板 atk_scale/, /80/],
  ];
  for (const [dsl, key, cap] of cases) {
    const set = put(dsl);
    assert.equal(set.cs, undefined, JSON.stringify(set.problems));
    const hit = set.problems.find((p) => p.code === 'PLUGIN_DATA_BOUND');
    assert.ok(hit, JSON.stringify(set.problems));
    assert.match(hit.message, key);
    assert.match(hit.message, cap);
  }

  f.put('mulcap', { permissions: ['data.add', 'dsl'], operators: ['op.json'] }, {
    'op.json': operator('mulcap', { dsl: 1, skill: { kind: 'passive', mods: { atkPct: { mul: [100, 100] } } } }),
  });
  f.put('mulbig', { permissions: ['data.add', 'dsl'], operators: ['op.json'] }, {
    'op.json': operator('mulbig', { dsl: 1, skill: { kind: 'passive', mods: { atkPct: { mul: [1e9, 1e9] } } } }),
  });
  const set = buildContentSet({ registry: f.registry, ids: ['mulcap', 'mulbig'] });
  assert.deepEqual(set.problems, [], JSON.stringify(set.problems));
  const h = makeBattle({
    data: new DataSource(set.data),
    units: [
      { chessId: 'chess_x_mulcap_caster_a', row: 10, col: 5 },
      { chessId: 'chess_x_mulbig_caster_a', row: 10, col: 6 },
    ],
  });
  h.step();
  for (const id of ['chess_x_mulcap_caster_a', 'chess_x_mulbig_caster_a']) {
    const u = h.unit(id);
    assert.equal(u.kit.skill.mods.atkPct, 300);
    close(u.s.atk, 60200);
  }
});

test('a one-skill DSL kit binds the default skill for shop, DIY and a stand-in', (t) => {
  const f = fixture(t);
  f.put('data-demo', { permissions: ['data.add', 'dsl'], operators: ['op.json'] }, { 'op.json': operator('data-demo', passive) });
  const set = buildContentSet({ registry: f.registry, ids: ['data-demo'] });
  assert.deepEqual(set.problems, [], JSON.stringify(set.problems));
  const h = makeBattle({
    data: new DataSource(set.data),
    units: [
      { chessId: 'chess_x_data_demo_caster_a', row: 10, col: 4 },
      { chessId: 'chess_x_data_demo_caster_b', row: 10, col: 5 },
      { diy: { slot: 5, charId: 'char_x_data_demo_caster', skillIndex: 0 }, row: 10, col: 6 },
      { diy: { slot: 5, charId: 'char_x_data_demo_caster', skillIndex: 0 }, elite: true, row: 10, col: 7 },
    ],
  });
  h.step();
  close(h.unit('chess_x_data_demo_caster_a').s.atk, 300);
  close(h.unit('chess_x_data_demo_caster_b').s.atk, 450);
  assert.equal(h.unit('chess_x_data_demo_caster_a').kit.skillSource, undefined);
  const diy = h.battle.allyUnits.filter((u) => u.def?.diyFor && u.def?.charId === 'char_x_data_demo_caster');
  assert.equal(diy.length, 2);
  const diyNormal = diy.find((u) => !String(u.defId).endsWith('_b'));
  const diyElite = diy.find((u) => String(u.defId).endsWith('_b'));
  assert.equal(diyNormal.kit.skillSource, 'skills');
  assert.equal(diyElite.kit.skillSource, 'skills');
  close(diyNormal.s.atk, 300);
  close(diyElite.s.atk, 450);

  const raw = { dsl: passive, pluginId: 'data-demo', skills: [{ skillId: 'skx_data_demo_caster_1' }] };
  const def = { standInFor: 'char_replaced', charId: 'char_x_data_demo_caster', skill: { id: 'skx_data_demo_caster_1' }, raw };
  const selected = selectSkillSpec(kitOf(def)({}, raw, def), {}, raw, def);
  assert.equal(selected.skillSource, 'skills');
  assert.equal(selected.skill.mods.atkPct, 0.5);
  const many = { ...raw, skills: [{ skillId: 'skx_data_demo_caster_1' }, { skillId: 'skx_data_demo_caster_2' }] };
  const unbound = kitOf(def)({}, many, { ...def, raw: many });
  assert.equal(unbound.skills, undefined);
});

test('the runtime validator refuses schema-closed fields, including through buildContentSet', (t) => {
  const f = fixture(t);
  f.put('typo', { permissions: ['data.add', 'dsl'], operators: ['op.json'] }, {
    'op.json': operator('typo', { dsl: 1, skill: { kind: 'passive', modz: { atkPct: 1 } } }),
  });
  const skill = buildContentSet({ registry: f.registry, ids: ['typo'] });
  assert.equal(skill.cs, undefined);
  assert.ok(skill.problems.some((p) => p.code === 'PLUGIN_DSL_SKILL'));
  assert.equal(f.registry.plugin('typo').status, 'loaded');

  f.put('aim', { permissions: ['data.add', 'dsl'], operators: ['op.json'] }, {
    'op.json': operator('aim', { dsl: 1, skill: { kind: 'passive', targeting: { rangeGird: [[0, 1]] } } }),
  });
  const aim = buildContentSet({ registry: f.registry, ids: ['aim'] });
  assert.equal(aim.cs, undefined);
  assert.ok(aim.problems.some((p) => p.code === 'PLUGIN_DSL_SKILL'));

  f.put('badprep', { permissions: ['dsl'], dsl: ['p.json'] }, {
    'p.json': { dsl: 1, pluginId: 'badprep', meta: { key: 'effect:badprep:income', on: [{ when: 'income', do: [{ funds: 123 }] }] } },
  });
  assert.equal(f.registry.plugin('badprep'), null);
  assert.ok(f.registry.report().skipped.some((p) => p.problems.some((s) => String(s).includes('PLUGIN_DSL_ACTION'))));
  const skipped = buildContentSet({ registry: f.registry, ids: ['badprep'] });
  assert.equal(skipped.cs, undefined);
  assert.ok(skipped.problems.some((p) => p.code === 'PLUGIN_UNKNOWN'));
});

test('a prep key for another plugin, or an empty meta.on, fails the content set and still loads', (t) => {
  const f = fixture(t);
  const refuse = (id, doc) => {
    f.put(id, { permissions: ['dsl'], dsl: ['p.json'] }, { 'p.json': doc });
    assert.equal(f.registry.plugin(id).status, 'loaded', id);
    const set = buildContentSet({ registry: f.registry, ids: [id] });
    assert.equal(set.cs, undefined, id);
    assert.ok(set.problems.some((p) => p.code === 'PLUGIN_DSL_META'), JSON.stringify(set.problems));
  };
  refuse('badkey', incomeDoc('badkey', 'effect:other:income'));
  refuse('emptykey', { dsl: 1, pluginId: 'emptykey', meta: {} });
  refuse('blankon', { dsl: 1, pluginId: 'blankon', meta: { key: 'effect:blankon:income', on: [] } });
});

test('a DSL literal that reaches kit setup is a content fault, not a fight', () => {
  const vanilla = getData({ log: { info() {}, warn() {}, error() {}, debug() {} } });
  rememberOfficialBounds(vanilla);
  const id = 'chess_char_1_02_a';
  const rec = { ...vanilla.chess[id], pluginId: 'victim', dsl: { dsl: 1, skill: { kind: 'passive', mods: { atkPct: 1e9 } } } };
  const bad = makeBattle({
    data: new DataSource({ ...vanilla, chess: { ...vanilla.chess, [id]: rec } }),
    units: [{ chessId: id, row: 10, col: 5 }],
  });
  assert.equal(bad.battle.finished, true);
  assert.equal(bad.battle.reason, 'forced');
  assert.equal(bad.battle.contentFault.code, 'PLUGIN_DATA_BOUND');
  assert.equal(bad.battle.contentFault.layer, 'setupUnitKit');
  assert.ok(bad.battle.errors.some((e) => e.label === 'content:dsl' && String(e.message).includes('PLUGIN_DATA_BOUND')));
  assert.equal(bad.result().reason, 'forced');
  assert.ok(bad.result().errors > 0);
});
