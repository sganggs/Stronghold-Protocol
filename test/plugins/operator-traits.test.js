// Synthetic declarations only: issue #671 acquisition and erosion examples.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { schemaValidator } from '../helpers/jsonSchema.js';
import { checkOperatorTraitRuntime } from '../../public/js/battle/simLoader.js';
import { installServerOperatorTraits } from '../../server/plugins/operatorTraits.js';
import { applyRecordOverlay } from '../../shared/i18nData.js';
import { contentSetFiles } from '../../server/plugins/contentSet.js';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fixture, guard } from '../helpers/contentFixtures.js';
import { buildContentSet } from '../../server/plugins/contentSet.js';
import { validateTraitSpec } from '../../server/plugins/operatorTraits.js';
import { installOperatorTraits } from '../../public/js/battle/operatorTraits.js';
import { loadBrowserSim } from '../../public/js/battle/simLoader.js';
import { makeBattle } from '../helpers/battleHarness.js';
import { DataSource } from '../../server/sim/simdata.js';
import { setGameData } from '../../server/sim/content/support/index.js';
import { elementBurst } from '../../server/sim/attack/element.js';
import { makeMatch, legalTileFor, DATA } from '../match/harness.js';

const CHAR = 'char_4145_ulpia', ID = 'chess_char_5_05_a', ITEM = 'chess_item_3_07_e_a';
const gain = count => ({ dsl: 1, meta: { on: [{ when: 'gain', do: [{ gainItem: { item: ITEM, count } }] }] } });
const burst = (amount = 1, maxPerBattle = 12) => ({ dsl: 1, talents: [{ when: 'elementBurst',
  if: { element: 'erosion', targetOnField: true, selfOnField: true }, do: [{ layers: { bond: 'selfActive', amount, maxPerBattle } }] }] });
const trait = dsl => ({ desc: 'Synthetic trait', dsl, translations: { en: 'Translated trait' } });
function official(replace = false) { return { op: 1, charId: CHAR, trait: trait(gain(1)),
  forms: { elite: { trait: trait(gain(2)) } }, ...(replace ? { overrides: [`trait:${CHAR}`] } : {}) }; }
function put(t, record, docs = {}) {
  const f = fixture(t);
  f.put('data-demo', { permissions: ['data.add', 'data.patch', 'dsl'], operators: ['op.json'] }, { 'op.json': record, ...docs });
  const set = buildContentSet({ registry: f.registry, ids: ['data-demo'] });
  assert.deepEqual(set.problems, []);
  return { f, set };
}
function custom() {
  const r = guard();
  r.chess.tier = 6; r.chess.bonds = ['egirShip', 'swiftShip'];
  r.trait = trait(burst());
  r.forms.elite.trait = trait(burst(2, 24));
  return r;
}

test('official traits add by default, explicit replacement and removal restore exact base bytes', t => {
  const { f, set } = put(t, official());
  assert.deepEqual(set.data.chess[ID].garrisonIds.slice(0, 1), DATA.chess[ID].garrisonIds);
  assert.equal(set.data.chess[ID].garrisonIds.length, 2);
  assert.equal(set.data.chess[ID].trait.desc, DATA.chess[ID].trait.desc);
  const vanilla = buildContentSet({ registry: f.registry, ids: [] });
  assert.deepEqual(vanilla.data.chess[ID], DATA.chess[ID]);
  const { set: replaced } = put(t, official(true));
  assert.equal(replaced.data.chess[ID].garrisonIds.length, 1);
  assert.ok(replaced.data.garrisons[replaced.data.chess[ID].garrisonIds[0]].operatorTrait);
});

test('gain once per acquisition, normal merge-triggering copy grants one, direct elite grants two', t => {
  const { set } = put(t, official(true));
  const h = makeMatch({ data: set.data, mode: 'solo', fake: true }).start(); h.toPrep(1);
  const ps = h.ps('p_0'), calls = [];
  const acquire = ps.acquireItem.bind(ps);
  ps.acquireItem = (id, opts) => { if (opts?.source === 'plugin:data-demo') calls.push(id); return acquire(id, opts); };
  for (const source of ['buy', 'reward', 'grant']) ps.acquireChess(ID, { source });
  assert.equal(calls.length, 3);
  assert.equal(ps.allChess().filter(p => p.id === ID.replace('_a', '_b')).length, 1);
  ps.acquireChess(ID.replace('_a', '_b'), { source: 'grant' });
  assert.equal(calls.length, 5);
  ps.promote(ps.acquireChess(ID));
  assert.equal(calls.length, 6, 'promotion is not another acquisition');
  assert.deepEqual(h.logs.error, []);
});

test('prep ownership is player-local, once per character, elite wins, last sale stops it', t => {
  const r = official(true);
  const hooks = ['deploy', 'roundStart', 'buy', 'sell', 'merge', 'levelUp', 'battleResult'];
  r.trait.dsl.meta.on = hooks.map(when => ({ when, do: [{ funds: { amount: 7 } }] }));
  delete r.forms;
  const { set } = put(t, r);
  const h = makeMatch({ data: set.data, humans: 2, fake: true }).start(); h.toPrep(1);
  const ps = h.ps('p_0'), other = h.ps('p_1');
  const p = ps.acquireChess(ID); ps.acquireChess(ID);
  for (const hook of ['onRoundStart', 'onBuy', 'onSold', 'onMerge', 'onLevelUp', 'onBattleResult']) {
    const old = ps.funds, theirs = other.funds;
    h.m.dispatch(ps, hook, {});
    assert.equal(ps.funds, old + 7, hook); assert.equal(other.funds, theirs);
  }
  const [row, col] = legalTileFor(h.m, ps, ID), before = ps.funds;
  assert.deepEqual(ps.move(p.uid, { area: 'board', row, col }, 'RIGHT'), { ok: true });
  assert.equal(ps.funds, before + 7);
  for (const piece of ps.allChess().filter(x => x.id === ID)) ps.sell(piece.uid);
  const after = ps.funds; h.m.dispatch(ps, 'onRoundStart', {}); assert.equal(ps.funds, after);
});

for (const [elite, amount, cap] of [[false, 1, 12], [true, 2, 24]]) test(`erosion layers cap ${cap}, independent holders, inactive bonds and redeploy`, async t => {
  const { set } = put(t, custom());
  await installOperatorTraits(set.data); setGameData(set.data);
  t.after(async () => { await installOperatorTraits(DATA); setGameData(null); });
  const id = Object.values(set.data.chess).find(c => c.charId === custom().charId && c.isGolden === elite).chessId;
  const h = makeBattle({ data: new DataSource(set.data), units: [{ chessId: id, row: 10, col: 5 }, { chessId: id, row: 11, col: 5 }] });
  h.step();
  const b = h.b, [a, c] = b.allyUnits, ps = b.getPlayer(a.ownerId);
  ps.bonds.egirShip = { active: true, layers: 0 }; ps.bonds.swiftShip = { active: false, layers: 0 };
  const seen = []; b.on('layers', ev => seen.push(ev));
  const old = ps.bonds.egirShip.layers;
  b.emit('elementBurst', { target: a, element: 'burn' });
  assert.equal(ps.bonds.egirShip.layers, old);
  for (let i = 0; i < 20; i++) b.emit('elementBurst', { target: a, element: 'erosion' });
  assert.equal(ps.bonds.egirShip.layers - old, cap * 2);
  assert.equal(ps.bonds.swiftShip.layers, 0);
  a.deploySeq++; c.deploySeq++;
  b.emit('elementBurst', { target: a, element: 'erosion' });
  assert.equal(ps.bonds.egirShip.layers - old, cap * 2);
  assert.equal(b.errors.length, 0);
  assert.ok(amount > 0);
});

test('existing element burst path, same-seed browser loader and next battle resets cap', async t => {
  const { set } = put(t, custom());
  setGameData(set.data); t.after(async () => { await installOperatorTraits(DATA); setGameData(null); });
  const id = Object.values(set.data.chess).find(c => c.charId === custom().charId && !c.isGolden).chessId;
  const run = () => {
    const h = makeBattle({ seed: 18, data: new DataSource(set.data), units: [{ chessId: id, row: 10, col: 5 }] }); h.step();
    const b = h.b, u = b.allyUnits[0], ps = b.getPlayer(u.ownerId);
    ps.bonds.egirShip = { active: true, layers: 0 }; ps.bonds.swiftShip = { active: false, layers: 0 };
    elementBurst(b, u, u, 'erosion');
    return { layers: ps.bonds.egirShip.layers, events: b.drainEvents() };
  };
  await installOperatorTraits(set.data); const server = run();
  await loadBrowserSim({ base: pathToFileURL(process.cwd() + '/server/sim/').href, data: set.data, cs: set.cs, bounds: set.bounds });
  assert.deepEqual(run(), server); assert.equal(server.layers, 1);
});

test('selfActive includes equipment-granted bonds like official self-bond traits', async t => {
  const { set } = put(t, custom());
  const { operatorTraitLayerAllowance } = await import('../../server/match/operatorTraits.js');
  const { fixtureSpec } = await import('../helpers/simHostFixture.js');
  await installOperatorTraits(set.data); setGameData(set.data);
  t.after(async () => { await installOperatorTraits(DATA); setGameData(null); });
  const id = Object.values(set.data.chess).find(c => c.charId === custom().charId && !c.isGolden).chessId;
  const items = [Object.values(DATA.items).find(i => i.canGiveBond && !i.isGolden).id, 'chess_item_1_01_e_a'];
  const h = makeBattle({ data: new DataSource(set.data), units: [{ chessId: id, row: 10, col: 5, items }] }); h.step();
  const u = h.b.allyUnits[0], ps = h.b.getPlayer(u.ownerId);
  ps.bonds.victoriaShip = { active: true, layers: 0 };
  h.b.emit('elementBurst', { target: u, element: 'erosion' });
  assert.equal(ps.bonds.victoriaShip.layers, 1);
  const spec = fixtureSpec(); Object.assign(spec.players[0].units[0], { chessId: id, items });
  assert.equal(operatorTraitLayerAllowance(spec.players[0], makeMatch({ data: set.data, fake: true }).m.gd).get('victoriaShip'), 12);
});

test('trait DSL file references are pinned and inline kit trait leaves skill/talents intact', t => {
  const r = official(true); r.trait.dsl = 'data/trait.json';
  const { set } = put(t, r, { 'data/trait.json': gain(1) });
  assert.ok(set.index.plugins[0].files['data/trait.json']);
  const compact = guard(); compact.kit = { dsl: { dsl: 1, skill: { kind: 'passive', mods: { atkPct: 0.1 } }, trait: { desc: 'Inline trait', on: burst().talents } } };
  const other = put(t, compact).set;
  assert.equal(Object.values(other.data.chess).find(c => c.charId === compact.charId).dsl.skill.mods.atkPct, 0.1);
});

for (const [name, mutate] of Object.entries({
  element: s => s.talents[0].if.element = 'water', field: s => s.talents[0].if.selfOnField = 1,
  bond: s => delete s.talents[0].do[0].layers.bond, reference: s => s.talents[0].do[0].layers.bond = 'missing',
  zero: s => s.talents[0].do[0].layers.maxPerBattle = 0, fraction: s => s.talents[0].do[0].layers.maxPerBattle = 1.5,
  big: s => s.talents[0].do[0].layers.maxPerBattle = 1000001, capExpr: s => s.talents[0].do[0].layers.maxPerBattle = { bb: 'n' },
  amount: s => s.talents[0].do[0].layers.amount = -1,
})) test(`reject invalid trait ${name}`, () => { const spec = burst(); mutate(spec); assert.throws(() => validateTraitSpec(spec, 'data-demo', DATA)); });
for (const count of [0, -1, 1.5, 65, '2', null]) test(`reject gain count ${count}`, () => assert.throws(() => validateTraitSpec(gain(count), 'data-demo', DATA)));


test('author schemas accept both examples and reject the new invalid fields', () => {
  const v = schemaValidator('schemas');
  for (const spec of [burst(), gain(2)]) assert.deepEqual(v.validate('operator-trait.schema.json', spec), []);
  for (const r of [custom(), official(true)]) assert.deepEqual(v.validate('records.schema.json', r), []);
  const s = burst(); s.talents[0].if.element = 'water'; assert.ok(v.validate('operator-trait.schema.json', s).length);
  const r = official(); r.trait.translations.bad = 'x'; assert.ok(v.validate('records.schema.json', r).length);
});

test('runtime bytes checked on the page and host; no check fetch for vanilla', async t => {
  const { set } = put(t, custom());
  const bytes = fs.readFileSync(new URL('../../public/js/battle/operatorTraits.js', import.meta.url));
  let fetches = 0;
  const fetch = async () => { fetches++; return { ok: true, arrayBuffer: async () => bytes }; };
  assert.match(await checkOperatorTraitRuntime(set.data, fetch), /^[a-f0-9]{64}$/);
  assert.equal(fetches, 1);
  assert.equal(await checkOperatorTraitRuntime(DATA, fetch), null); assert.equal(fetches, 1);
  await assert.rejects(checkOperatorTraitRuntime(set.data, async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1]) })), /hash mismatch/);
  const damaged = structuredClone(set.data);
  Object.values(damaged.garrisons).find(g => g.operatorTrait).operatorTrait.runtime = '0'.repeat(64);
  await assert.rejects(installServerOperatorTraits(damaged), /hash mismatch/);
});

test('translated trait overlays are pinned, while legacy content fields are untouched', t => {
  const { set } = put(t, official());
  const g = Object.values(set.data.garrisons).find(g => g.operatorTrait);
  const file = contentSetFiles(set).get('i18n/en.json');
  const doc = JSON.parse(file.body);
  assert.equal(applyRecordOverlay(g, doc.files.garrisons[g.garrisonId]).value.desc, 'Translated trait');
  assert.deepEqual(set.data.chess[ID].trait, DATA.chess[ID].trait);
});

test('dependency patches cannot bypass trait validation or erase compiled metadata', t => {
  const { f, set } = put(t, custom());
  const g = Object.values(set.data.garrisons).find(g => g.operatorTrait && !g.operatorTrait.elite);
  const paths = [
    { path: ['operatorTrait', 'spec', 'talents', 0, 'do', 0, 'layers', 'maxPerBattle'], value: 0 },
    { path: ['operatorTrait'], value: {} },
    { path: [], value: { ...g, operatorTrait: undefined } },
  ];
  for (const change of paths) {
    f.put('trait-patch', { permissions: ['data.patch'], requires: { 'data-demo': '1.0.0' }, data: ['patch.json'] },
      { 'patch.json': { patch: 1, ops: [{ op: 'set', file: 'garrisons', id: g.garrisonId, ...change }] } });
    assert.ok(buildContentSet({ registry: f.registry, ids: ['data-demo', 'trait-patch'] }).problems.some(p => p.code === 'PLUGIN_DSL_PLUGIN_ID'));
  }
  f.put('trait-patch', { permissions: ['data.add'], requires: { 'data-demo': '1.0.0' }, data: ['copy.json'] },
    { 'copy.json': { records: 1, entries: [{ file: 'garrisons', id: 'garrison_x_trait_patch_copy', base: g.garrisonId, set: {} }] } });
  assert.ok(buildContentSet({ registry: f.registry, ids: ['data-demo', 'trait-patch'] }).problems.some(p => p.code === 'PLUGIN_DSL_PLUGIN_ID'));
});

test('off-field filters reject hidden/dead targets, and removal removes installed battle behavior', async t => {
  const { set } = put(t, custom());
  setGameData(set.data); await installOperatorTraits(set.data);
  t.after(async () => { await installOperatorTraits(DATA); setGameData(null); });
  const id = Object.values(set.data.chess).find(c => c.charId === custom().charId && !c.isGolden).chessId;
  const build = () => { const h = makeBattle({ data: new DataSource(set.data), units: [{ chessId: id, row: 10, col: 5 }] }); h.step(); return h.b; };
  const b = build(), u = b.allyUnits[0], ps = b.getPlayer(u.ownerId);
  ps.bonds.egirShip = { active: true, layers: 0 };
  for (const target of [null, { alive: false, side: 'enemy' }, { alive: true, hidden: true, side: 'enemy' }, { alive: true, deployed: false, side: 'ally' }]) b.emit('elementBurst', { target, element: 'erosion' });
  assert.equal(ps.bonds.egirShip.layers, 0);
  u.deployed = false; b.emit('elementBurst', { target: { alive: true, side: 'enemy' }, element: 'erosion' });
  assert.equal(ps.bonds.egirShip.layers, 0);
  u.deployed = true; b.emit('elementBurst', { target: { alive: true, side: 'enemy' }, element: 'erosion' });
  assert.equal(ps.bonds.egirShip.layers, 1);
  await installOperatorTraits(DATA);
  const removed = build(), player = removed.getPlayer(removed.allyUnits[0].ownerId);
  player.bonds.egirShip = { active: true, layers: 0 };
  removed.emit('elementBurst', { target: removed.allyUnits[0], element: 'erosion' });
  assert.equal(player.bonds.egirShip.layers, 0);
});

test('real official battle garrison is disabled only by explicit trait override', async t => {
  const charId = DATA.chess.chess_char_2_05_a.charId;
  const stats = [];
  t.after(async () => { await installOperatorTraits(DATA); setGameData(null); });
  for (const replace of [false, true]) {
    const r = { op: 1, charId, trait: trait({ dsl: 1, talents: [] }), ...(replace ? { overrides: [`trait:${charId}`] } : {}) };
    const { set } = put(t, r); setGameData(set.data); await installOperatorTraits(set.data);
    const h = makeBattle({ data: new DataSource(set.data), units: [{ chessId: 'chess_char_2_05_a', row: 10, col: 5 }] }); h.step();
    stats.push(h.b.allyUnits[0].s.maxHp);
  }
  assert.ok(stats[0] > stats[1], `${stats}`);
});

test('custom gain reaches bot and DIY acquisition through the same primitive', t => {
  const { set } = put(t, [official(true), { op: 1, charId: 'char_4231_clemnt', trait: trait(gain(1)) }]);
  const h = makeMatch({ data: set.data, humans: 1, bots: 1, fake: true }).start(); h.toPrep(1);
  const bot = h.ps('ai_0'), calls = [];
  bot.acquireItem = (id, opts) => { if (opts?.source === 'plugin:data-demo') calls.push(id); return null; };
  bot.acquireChess(ID); assert.deepEqual(calls, [ITEM]);
  const ps = h.ps('p_0'), slot = 'chess_char_5_diy1_a';
  assert.equal(ps.setDiy({ [slot]: { charId: 'char_4231_clemnt', skillIndex: 0, uniEquipId: null } }), true);
  ps.acquireItem = (id, opts) => { if (opts?.source === 'plugin:data-demo') calls.push(id); return null; };
  assert.ok(ps.acquireChess(slot)); assert.equal(calls.length, 2);
});

test('test console grant fires gain exactly once', t => {
  const { set } = put(t, official(true));
  const h = makeMatch({ data: set.data, mode: 'solo', test: true, fake: true }).start(); h.toPrep(1);
  const ps = h.ps('p_0'), calls = [];
  h.m.hostId = ps.playerId;
  ps.acquireItem = (id, opts) => { if (opts?.source === 'plugin:data-demo') calls.push(id); return null; };
  assert.deepEqual(h.m.applyTestCommand(ps, { cmd: 'chess', args: { id: ID } }), { ok: true });
  assert.deepEqual(calls, [ITEM]);
});

test('custom layer declarations never enlarge client-result allowances', async t => {
  const { specBounds, validateClientResult } = await import('../../server/match/fields.js');
  const { fixtureSpec } = await import('../helpers/simHostFixture.js');
  const { createBattleFromSpec } = await import('../../server/sim/spec.js');
  const r = custom(); delete r.forms.elite.trait;
  r.trait.dsl = { dsl: 1, talents: [{ when: 'battleStart', do: [{ layers: { bond: 'arcaneShip', amount: 100, maxPerBattle: 100 } }] }] };
  const { set } = put(t, r);
  await installOperatorTraits(set.data); setGameData(set.data);
  t.after(async () => { await installOperatorTraits(DATA); setGameData(null); });
  const spec = fixtureSpec(); spec.players[0].units[0].chessId = Object.values(set.data.chess).find(c => c.charId === r.charId && !c.isGolden).chessId;
  const h = makeMatch({ data: set.data, fake: true }), gd = h.m.gd;
  const bounds = specBounds(spec, gd).players.get('p1');
  assert.equal(bounds.layerAllow.get('arcaneShip'), undefined);
  const b = createBattleFromSpec(spec, new DataSource(set.data)); b.start(); b.forceEnd();
  const result = b.result(); assert.equal(result.perPlayer.p1.layerGains.arcaneShip, 100);
  assert.equal(validateClientResult(spec, result, { gd }).ok, false);
  result.perPlayer.p1.layerGains.arcaneShip = 161;
  assert.equal(validateClientResult(spec, result, { gd }).reason, 'trait layers require server authority');
  result.perPlayer.p1.layerGains = { yanShip: 1 };
  assert.equal(validateClientResult(spec, result, { gd }).reason, 'trait layers require server authority');
});

test('detail card displays translated custom traits and returns to the official trait on removal', async t => {
  const { data } = await import('../../public/js/data.js');
  const { ChessDetail } = await import('../../public/js/ui/detailPanel.js');
  const { set } = put(t, official());
  t.after(() => { data.setLocale('zh'); data.setContent(null); });
  const view = () => ChessDetail({ chess: data.lookup('chess', ID), piece: null, editable: false, bonds: [] }).flat().filter(b => b.props?.garrison).map(b => b.props.garrison);
  data.setContent({ id: 'vanilla', values: DATA });
  const native = view().map(g => g.garrisonId);
  data.setContent({ id: set.cs, values: set.data, langs: ['en'], overlay: async () => JSON.parse(contentSetFiles(set).get('i18n/en.json').body) });
  assert.equal(view().length, 2); assert.equal(view()[1].desc, 'Synthetic trait');
  await data.setLocale('en'); assert.equal(view()[1].desc, 'Translated trait');
  data.setLocale('zh'); data.setContent({ id: 'vanilla', values: DATA });
  assert.deepEqual(view().map(g => g.garrisonId), native);
});

for (const [name, mutate] of Object.entries({
  forms: r => r.forms = [], overrides: r => r.overrides = ['trait:char_wrong'],
  text: r => r.trait.desc = '', translation: r => r.trait.translations.xx = 'bad',
  owner: r => r.trait.dsl.pluginId = 'someone-else', event: r => r.trait.dsl.meta.on[0].when = 'refresh',
  metaKey: r => r.trait.dsl.meta.key = 'global:bad', unknown: r => r.trait.unused = true,
  path: r => r.trait.dsl = '../outside.json', marker: r => r.trait.operatorTrait = {},
})) test(`reject operator declaration ${name}`, t => {
  const f = fixture(t), r = official(); mutate(r);
  f.put('data-demo', { permissions: ['data.add', 'data.patch', 'dsl'], operators: ['op.json'] }, { 'op.json': r });
  assert.ok(buildContentSet({ registry: f.registry, ids: ['data-demo'] }).problems.length);
});

test('production match host and an isolated browser module tree agree', { timeout: 30000 }, async t => {
  const { createContentSets } = await import('../../server/plugins/contentSets.js');
  const { createMatchHosts } = await import('../../server/match/host/index.js');
  const { fixtureSpec } = await import('../helpers/simHostFixture.js');
  const { resultDigest } = await import('../../server/sim/spec.js');
  const { DATA_SHIM_JS } = await import('../../server/http/static.js');
  const r = custom();
  r.trait.dsl = { dsl: 1, talents: [{ when: 'battleStart', do: [{ layers: { bond: 'egirShip', amount: 5, maxPerBattle: 3 } }] }] };
  const { f, set } = put(t, r);
  const contents = createContentSets({ registry: f.registry, vanillaData: DATA });
  const resolved = contents.resolve(['data-demo']); assert.equal(resolved.ok, true);
  const id = Object.values(set.data.chess).find(c => c.charId === r.charId && !c.isGolden).chessId;
  const spec = fixtureSpec(); spec.cs = set.cs; spec.players[0].units[0].chessId = id;
  spec.players[0].bonds = { egirShip: { active: true, layers: 0, count: 1 } };
  const root = f.dir + '/runtime';
  fs.mkdirSync(root + '/server', { recursive: true });
  // Browser /sim has no Node loader: including it creates a cycle through the data shim.
  fs.cpSync('server/sim', root + '/server/sim', { recursive: true, filter: src => path.basename(src) !== 'nodeData.js' });
  assert.equal(fs.existsSync(path.join(root, 'server/sim/nodeData.js')), false);
  fs.cpSync('shared', root + '/shared', { recursive: true });
  fs.writeFileSync(root + '/package.json', '{"type":"module"}'); fs.writeFileSync(root + '/server/data.js', DATA_SHIM_JS);
  const sim = await loadBrowserSim({ base: pathToFileURL(root + '/server/sim/').href, data: set.data, bounds: set.bounds, cs: set.cs });
  const battle = sim.spec.createBattleFromSpec(spec, sim.ds);
  battle.start(); for (let i = 0; i < 90; i++) battle.step();
  assert.equal(battle.getPlayer('p1').bonds.egirShip.layers, 3);
  const errors = [];
  const hosts = createMatchHosts({ contents, log: { info() {}, warn() {}, error: (...a) => errors.push(a) },
    options: { matchModule: fileURLToPath(new URL('./fixtures/scriptBattleMatch.js', import.meta.url)), matchOptions: { scriptSpec: spec } } });
  t.after(() => hosts.close());
  let deliver, timer;
  const done = new Promise((resolve, reject) => { deliver = resolve; timer = setTimeout(() => reject(new Error(JSON.stringify(errors))), 20000); });
  t.after(() => clearTimeout(timer));
  const match = hosts.create(set.cs, { roomCode: 'TRAITS', seats: [], scriptSpec: spec, broadcast: deliver, send() {}, onEnd() {} });
  match.start();
  const result = await done;
  assert.deepEqual(result.errors, []); assert.deepEqual(result.snapshot, battle.snapshot());
  assert.deepEqual(result.digest, resultDigest(battle.result())); match.dispose();
});

// Review regressions (#671): all fixtures are synthetic JSON, never third-party code.
test('review: forced gain discovery and dispatch survive an official trait override', t => {
  const { set } = put(t, official(true));
  const h = makeMatch({ data: set.data, fake: true }).start(); t.after(() => h.m.dispose()); h.toPrep(1);
  const ps = h.ps('p_0'); let rewards = 0;
  const acquire = ps.acquireItem.bind(ps);
  ps.acquireItem = (...args) => { rewards++; return acquire(...args); };
  const piece = ps.acquireChess(ID);
  assert.equal(rewards, 1);
  const gs = ps.gd.chess(ID).garrisonIds.map(id => ps.gd.garrison(id));
  assert.ok(gs.some(g => g.eventType === 'SERVER_GAIN'));
  assert.equal(h.m.dispatcher.triggerGarrisons(ps, piece, 'SERVER_GAIN'), 1);
  assert.equal(rewards, 2);
  ps.bonds.investShip = { active: true, layers: 0 };
  h.m.dispatcher.triggerGarrisons(ps, piece, 'SERVER_GAIN', { asPiece: piece });
  assert.equal(rewards, 4, 'forced gain keeps the existing investor multiplier');
});

test('review: self-sale uses the sold form even for the last copy or with an elite remaining', t => {
  const r = official(true);
  r.trait.dsl = { dsl: 1, meta: { on: [{ when: 'sell', do: [{ funds: { amount: 7 } }] }] } };
  r.forms.elite.trait.dsl = { dsl: 1, meta: { on: [{ when: 'sell', do: [{ funds: { amount: 17 } }] }] } };
  const { set } = put(t, r);
  for (const keepElite of [false, true]) {
    const h = makeMatch({ data: set.data, fake: true }).start(); t.after(() => h.m.dispose()); h.toPrep(1);
    const ps = h.ps('p_0'), sold = ps.acquireChess(ID);
    if (keepElite) ps.acquireChess(ID.replace('_a', '_b'));
    ps.funds = 100;
    assert.deepEqual(ps.sell(sold.uid), { ok: true });
    assert.equal(ps.funds, 108, 'one normal sale reward, independent of remaining copies');
  }
});

test('review: trait layers receive garrison amplification, preserving source, cap and budget', async t => {
  const r = custom(); r.trait.dsl.talents[0].do = [{ layers: { bond: 'egirShip', amount: 1, maxPerBattle: 2 } }];
  const { set } = put(t, r);
  await installOperatorTraits(set.data); setGameData(set.data);
  t.after(async () => { await installOperatorTraits(DATA); setGameData(null); });
  const id = Object.values(set.data.chess).find(c => c.charId === r.charId && !c.isGolden).chessId;
  const h = makeBattle({ data: new DataSource(set.data), units: [
    { uid: 1, chessId: 'chess_char_4_25_a', row: 10, col: 3 }, { uid: 2, chessId: id, row: 10, col: 4 }], autoFinish: false });
  h.step(); const b = h.b, u = h.unit(2), seen = [];
  b.getPlayer('p1').bonds.egirShip = { active: true, layers: 0 };
  b.on('layerGain', e => seen.push({ reason: e.reason, source: e.source }));
  for (let i = 0; i < 3; i++) b.emit('elementBurst', { target: u, element: 'erosion' });
  assert.equal(b.result().perPlayer.p1.layerGains.egirShip, 4, 'cap limits base grants; official bonus remains extra');
  assert.deepEqual(seen, [{ reason: 'garrison', source: u }, { reason: 'garrison', source: u }]);
  const { budgetUsed } = await import('../../server/sim/content/dsl/budget.js');
  assert.equal(budgetUsed(b, 'data-demo'), 3);
  const v = await import('../../server/sim/content/dsl/vocab.js');
  v.runActions([{ layers: { bond: 'egirShip', amount: 1 } }], v.makeRuntime(b, u, { pluginId: 'data-demo' }));
  assert.equal(b.result().perPlayer.p1.layerGains.egirShip, 5, 'ordinary DSL from the same plugin keeps its original provenance');
  assert.equal(seen.at(-1).reason, 'plugin:data-demo');
  assert.equal(budgetUsed(b, 'data-demo'), 4, 'traits and ordinary DSL share one plugin budget');
});

test('review: burst cooldown uses the established one-nanosecond tolerance', async t => {
  const r = custom(); r.trait.dsl.talents[0].cooldown = 0.1;
  const { set } = put(t, r);
  await installOperatorTraits(set.data); setGameData(set.data);
  t.after(async () => { await installOperatorTraits(DATA); setGameData(null); });
  const id = Object.values(set.data.chess).find(c => c.charId === r.charId && !c.isGolden).chessId;
  const h = makeBattle({ data: new DataSource(set.data), units: [{ chessId: id, row: 10, col: 4 }], autoFinish: false }); h.step();
  h.b.getPlayer('p1').bonds.egirShip = { active: true, layers: 0 };
  for (let i = 0; i < 30; i++) { h.b.emit('elementBurst', { target: h.b.allyUnits[0], element: 'erosion' }); h.step(); }
  assert.equal(h.b.result().perPlayer.p1.layerGains.egirShip, 10);
});

test('review: zero-burst client gains require server authority even below the old allowance', async t => {
  const { fixtureSpec } = await import('../helpers/simHostFixture.js');
  const { validateClientResult, runHeadless } = await import('../../server/match/fields.js');
  const { createBattleFromSpec } = await import('../../server/sim/spec.js');
  const { set } = put(t, custom());
  await installOperatorTraits(set.data); setGameData(set.data);
  t.after(async () => { await installOperatorTraits(DATA); setGameData(null); });
  const spec = fixtureSpec(); spec.round = 1;
  spec.players[0].units[0].chessId = Object.values(set.data.chess).find(c => c.charId === custom().charId && !c.isGolden).chessId;
  const h = makeMatch({ data: set.data, fake: true, verify: 'off' }); t.after(() => h.m.dispose());
  const result = runHeadless(createBattleFromSpec(spec, new DataSource(set.data)), { players: ['p1'] }).result;
  assert.deepEqual(result.perPlayer.p1.layerGains, {});
  for (const n of [0, 1, 12, 76]) {
    result.perPlayer.p1.layerGains = { egirShip: n };
    assert.equal(validateClientResult(spec, result, { gd: h.m.gd }).ok, false);
  }
  for (const kind of ['normal', 'unite', 'boss', 'hidden']) {
    const field = { kind, spec: { ...spec, kind }, players: ['p_0'], demoted: new Set() };
    assert.equal(h.m._authorityFor(field), null, 'layer-granting fields are server-owned');
    assert.equal(h.m._authorityFor({ ...field, spec: { ...field.spec, flags: { layerGainsEnabled: false } } }), 'p_0');
    const plain = fixtureSpec();
    assert.equal(h.m._authorityFor({ ...field, spec: plain }), 'p_0', 'unrelated fields retain client authority');
  }
});

test('review: trait permissions pass strict checking and cannot be removed by a stale autofix', async t => {
  const { checkPluginFolder } = await import('../../server/plugins/pack.js');
  const { FIXES } = await import('../../server/studio/edit.js');
  const { f } = put(t, official(true)), dir = f.dir + '/plugins/data-demo';
  const checked = checkPluginFolder(dir, dir);
  assert.deepEqual(checked.problems, []);
  assert.deepEqual(checked.issues.filter(i => i.code === 'PLUGIN_PERMISSION_UNUSED'), []);
  for (const permission of ['data.patch', 'dsl']) {
    const p = { manifest: JSON.parse(fs.readFileSync(dir + '/plugin.json')) };
    assert.throws(() => FIXES.dropPermission(p, { params: { permission } }, { files: { root: () => dir }, id: 'data-demo' }));
    assert.ok(p.manifest.permissions.includes(permission));
  }
});

test('P9: embedded kit DSL passes check/registry and survives a stale studio permission autofix', async t => {
  const { checkPluginFolder } = await import('../../server/plugins/pack.js');
  const { FIXES } = await import('../../server/studio/edit.js');
  for (const part of ['operators', 'data']) {
    const f = fixture(t), record = guard();
    record.kit = { dsl: { dsl: 1, skill: { kind: 'passive', mods: { atkPct: 0.2 } } } };
    f.put('data-demo', { permissions: ['data.add', 'dsl'], [part]: ['op.json'] },
      { 'op.json': part === 'operators' ? [record] : { records: 1, entries: [record] } });
    const dir = f.dir + '/plugins/data-demo';
    const checked = checkPluginFolder(dir, dir);
    assert.deepEqual(checked.problems, []);
    assert.deepEqual(checked.issues.filter(i => i.code === 'PLUGIN_PERMISSION_UNUSED'), []);
    assert.deepEqual(buildContentSet({ registry: f.registry, ids: ['data-demo'] }).problems, []);
    const p = { manifest: JSON.parse(fs.readFileSync(dir + '/plugin.json')) };
    assert.throws(() => FIXES.dropPermission(p, { params: { permission: 'dsl' } }, { files: { root: () => dir }, id: 'data-demo' }));
    assert.ok(p.manifest.permissions.includes('dsl'));
  }
});

for (const [label, dsl] of Object.entries({
  item: { dsl: 1, meta: { on: [{ when: 'gain', do: [{ gainItem: { item: 'missing_item' } }] }] } },
  bond: { dsl: 1, talents: [{ when: 'elementBurst', do: [{ layers: { bond: 'missing_bond', amount: 1 } }] }] },
  condition: { dsl: 1, talents: [{ when: 'elementBurst', if: { bondActive: 'missing_bond' }, do: [] }] },
})) test(`review: checking rejects nonexistent trait ${label} references`, async t => {
  const { checkPluginFolder } = await import('../../server/plugins/pack.js');
  const f = fixture(t), r = official(); r.trait.dsl = dsl; delete r.forms;
  const dir = f.put('data-demo', { permissions: ['data.add', 'data.patch', 'dsl'], operators: ['op.json'] }, { 'op.json': r });
  const checked = checkPluginFolder(dir, dir);
  assert.ok(checked.issues.some(i => i.level === 'problem' && i.code === 'PLUGIN_DATA_REFERENCE'));
  assert.equal(checked.plugin, null);
});

test('checking resolves trait references in declared dependency data and refuses missing dependencies', async t => {
  const { checkPluginFolder } = await import('../../server/plugins/pack.js');
  const f = fixture(t), bond = 'bond_x_trait_dep_team', item = 'item_x_trait_dep_gift';
  f.put('trait-dep', { permissions: ['data.add'], data: ['records.json'] }, { 'records.json': { records: 1, entries: [
    { file: 'bonds', id: bond, value: { name: 'Team', desc: 'Synthetic', thresholds: [1], countMode: 'BOARD', isCore: false, identifier: 40 } },
    { file: 'items', id: item, base: ITEM, set: {} },
  ] } });
  const r = official(true); delete r.forms;
  r.trait.dsl = { dsl: 1, talents: [{ when: 'elementBurst', if: { bondActive: { id: bond, tier: 1 } }, do: [{ layers: { bond, amount: 1 } }] }],
    meta: { on: [{ when: 'gain', do: [{ gainItem: { item } }] }] } };
  const dir = f.put('data-demo', { permissions: ['data.add', 'data.patch', 'dsl'], operators: ['op.json'], requires: { 'trait-dep': '1.0.0' } }, { 'op.json': r });
  assert.deepEqual(checkPluginFolder(dir, dir).problems, []);
  const depDir = f.dir + '/plugins/trait-dep';
  const dep = JSON.parse(fs.readFileSync(depDir + '/plugin.json'));
  Object.assign(dep, { class: 'script', entry: { sim: 'index.js' }, permissions: ['data.add', 'sim.code'] });
  fs.writeFileSync(depDir + '/plugin.json', JSON.stringify(dep));
  fs.writeFileSync(depDir + '/index.js', 'export function setup() { throw new Error("must not execute during checking"); }');
  assert.deepEqual(checkPluginFolder(dir, dir).problems, [], 'dependency JSON is checked without executing or authorizing its script');
  fs.rmSync(depDir, { recursive: true });
  assert.ok(checkPluginFolder(dir, dir).issues.some(i => i.code === 'PLUGIN_DEPENDENCY'));
});

test('layer-trait fields settle from a real server run with verification disabled', async t => {
  const r = custom(); delete r.forms.elite.trait;
  r.trait.dsl = { dsl: 1, talents: [{ when: 'battleStart', do: [{ layers: { bond: 'egirShip', amount: 3, maxPerBattle: 3 } }] }] };
  const { set } = put(t, r);
  await installOperatorTraits(set.data); setGameData(set.data);
  t.after(async () => { await installOperatorTraits(DATA); setGameData(null); });
  const h = makeMatch({ data: set.data, mode: 'solo', clientCombat: true, clients: false, verify: 'off' }).start();
  t.after(() => h.m.dispose()); h.toPrep(1);
  const ps = h.ps('p_0'), id = Object.values(set.data.chess).find(c => c.charId === r.charId && !c.isGolden).chessId;
  const piece = ps.acquireChess(id), [row, col] = legalTileFor(h.m, ps, id);
  assert.deepEqual(ps.move(piece.uid, { area: 'board', row, col }), { ok: true });
  assert.ok(h.drive(() => h.m.phase === 'COMBAT'));
  const f = h.m.fields[0];
  assert.equal(f.mode, 'server'); assert.equal(f.authority, null);
  assert.equal(f.result.perPlayer.p_0.layerGains.egirShip, 3);
  const forged = structuredClone(f.result); forged.perPlayer.p_0.layerGains.egirShip = 76;
  h.m._onResult(ps, { battleId: f.battleId, result: forged });
  assert.equal(f.result.perPlayer.p_0.layerGains.egirShip, 3);
  assert.ok(h.runToPhase('SETTLE'));
  assert.equal(h.m.lastResults.get('p_0').layerGains.egirShip, 3);
  assert.equal(ps.bonds.egirShip.layers, 5, 'three earned layers plus the standard round award');
  assert.deepEqual(h.logs.error, []);
});
