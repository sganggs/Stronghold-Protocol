import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getData } from '../../server/data.js';
import { expandGameplayRecords, reconcilePluginTokens, validateGameplayData } from '../../server/plugins/gameplayRecords.js';
import { expandRecords } from '../../shared/plugins/records.js';
import { validateData } from '../../shared/plugins/validate.js';
import { buildContentSet } from '../../server/plugins/contentSet.js';
import { fixture, guard } from '../helpers/contentFixtures.js';
import { GameData } from '../../server/match/gamedata.js';
import { computeBonds, bondList } from '../../server/match/bondsMeta.js';
import { createRegistry } from '../../server/match/effectsMeta.js';
import { registerDslMeta } from '../../server/match/dslMeta.js';
import { makeMatch, give, legalTileFor } from '../match/harness.js';
import { makeBattle } from '../helpers/battleHarness.js';
import { DataSource } from '../../server/sim/simdata.js';
import { setGameData } from '../../server/sim/content/support/index.js';

const base = getData(), opts = { pluginId: 'data-demo' };
const bondId = 'bond_x_data_demo_team', itemId = 'item_x_data_demo_hook_a', eliteId = 'item_x_data_demo_hook_b';
const bond = mode => ({ file: 'bonds', id: bondId, value: { name: 'Team', desc: 'A synthetic bond', thresholds: [1, 2], countMode: mode ?? 'BOARD', isCore: true, identifier: 40 } });
function items() {
  return [false, true].map(golden => ({ file: 'items', id: golden ? eliteId : itemId, value: {
    name: 'Hook', desc: 'Speed', itemType: 'EQUIP', tier: 2, price: 2, baseId: itemId, goldenId: eliteId,
    isGolden: golden, hideInShop: golden, shopExcluded: golden, mergeable: !golden, upgradeNum: golden ? 0 : 2,
    upgradeChessId: golden ? null : eliteId, effectId: 'effect_x_data_demo_hook',
    buffs: [{ key: 'env_gbuff_new_with_verify', countType: 'NONE', bb: { attack_speed: golden ? 50 : 25 }, bbStr: { key: 'attr_common_global_buff' } }], params: { attack_speed: golden ? 50 : 25 },
  } }));
}
function entries(mode) {
  return [bond(mode), { file: 'effects', id: 'effect_x_data_demo_hook', value: { name: 'Hook', buffs: [], params: {} } }, ...items()];
}
function compose(t, mode, dsl) {
  const f = fixture(t), op = guard(); op.chess.bonds = [bondId]; op.kit = dsl ? { dsl } : 'generic';
  f.put('data-demo', { data: ['r.json'], operators: ['o.json'], ...(dsl ? { permissions: ['data.add', 'dsl'] } : {}) }, { 'r.json': { records: 1, entries: entries(mode) }, 'o.json': op });
  const set = buildContentSet({ registry: f.registry, ids: ['data-demo'] });
  assert.deepEqual(set.problems, []); return { ...set, registry: f.registry };
}

test('bonds and complete item pairs validate atomically; legacy expansion stays identical', () => {
  const r = expandGameplayRecords(base, entries(), opts);
  assert.deepEqual(r.problems, []); assert.deepEqual(validateData(r.data, { vanilla: base }), []);
  for (const change of [b => { b.id = 'yanShip'; }, b => { b.value.thresholds = [2, 1]; }, b => { b.value.countMode = 'ALL'; }]) {
    const b = bond(); change(b); const result = expandGameplayRecords(base, [b], opts);
    assert.ok(result.problems.length); assert.equal(result.data, base);
  }
  const old = [{ file: 'items', id: itemId, base: 'chess_item_3_02_e_a' }];
  assert.deepEqual(expandGameplayRecords(base, old, opts), expandRecords(base, old, opts));
  const bad = items()[0]; bad.value.buffs[0].bbStr.key = 'invented';
  assert.ok(expandGameplayRecords(base, [bad], opts).problems.length);
});

for (const mode of ['BOARD', 'BOARD_AND_DECK', 'BOARD_ALL_CHESS']) test(`new bond ${mode} uses existing counting, layers, order and membership`, t => {
  const set = compose(t, mode), gd = new GameData(set.data, 'mode_single_normal');
  const id = 'chess_x_data_demo_guard_a', piece = { kind: 'chess', id: mode === 'BOARD_ALL_CHESS' ? gd.chess(id).goldenId : id };
  const ps = { board: new Map(mode === 'BOARD_AND_DECK' ? [] : [['10,4', piece]]), hand: mode === 'BOARD_AND_DECK' ? [piece] : [], layers: { [bondId]: 7 } };
  const states = computeBonds(gd, ps);
  assert.equal(states[bondId].active, true); assert.equal(states[bondId].layers, 7);
  assert.equal(bondList(gd, states).some(b => b.bondId === bondId), true);
  assert.deepEqual(gd.bond(bondId).members, [id]); assert.deepEqual(gd.bond(bondId).visibleMembers, [id]);
  assert.ok(gd.shopItemsByTier[2].includes(itemId)); assert.ok(!gd.shopItemsByTier[2].includes(eliteId));
});

test('modded match activates the new bond, dispatches guarded prep actions, and item tiers add 25/50 ASPD', t => {
  const set = compose(t), reg = createRegistry();
  const spec = { dsl: 1, meta: { key: 'effect:data-demo:team', on: [{ when: 'roundStart', if: { bondActive: bondId }, do: [
    { funds: { amount: 2 } }, { layers: { bond: bondId, amount: 3 } }, { gainItem: { item: itemId } },
  ] }] } };
  registerDslMeta(reg, spec, { pluginId: 'data-demo' });
  const h = makeMatch({ mode: 'solo', data: set.data, cs: set.cs, requireCs: true, fake: true, registry: reg });
  t.after(() => h.m.dispose()); h.start(); h.toPrep();
  const ps = h.ps('p_0'), id = 'chess_x_data_demo_guard_a';
  give(h.m, ps, id, 'board', legalTileFor(h.m, ps, id));
  assert.equal(ps.bonds[bondId].active, true);
  ps.effects.push({ id: 'test-team', key: spec.meta.key, battle: false, hidden: true });
  const funds = ps.funds, layers = ps.layers[bondId] ?? 0;
  h.m.dispatcher.dispatch(ps, 'onRoundStart');
  assert.equal(ps.funds, funds + 2); assert.equal(ps.layers[bondId], layers + 3);
  assert.ok([...ps.hand, ...ps.temp].some(p => p?.id === itemId));
  reg.get(spec.meta.key).onRoundStart({ bonds: {} }, {});
  setGameData(set.data); t.after(() => setGameData(null));
  for (const [item, bonus] of [[itemId, 25], [eliteId, 50]]) {
    const b = makeBattle({ data: new DataSource(set.data), units: [{ chessId: id, row: 10, col: 4, items: [item] }] });
    b.step(); assert.equal(b.unit(id).s.aspd, set.data.chess[id].stats.aspd + bonus);
  }
});

test('new bonds cannot claim another plugin namespace at composition', t => {
  const f = fixture(t), b = bond(); b.id = 'bond_x_someone_else_team';
  f.put('data-demo', { data: ['r.json'] }, { 'r.json': { records: 1, entries: [b] } });
  const set = buildContentSet({ registry: f.registry, ids: ['data-demo'] });
  assert.ok(set.problems.some(p => p.code === 'PLUGIN_RECORD_ID'));
});

test('member DSL talents apply battle buffs only while the plugin bond is active', t => {
  const set = compose(t, 'BOARD', { dsl: 1, talents: [{ when: 'deploy', if: { bondActive: bondId }, do: [
    { buff: { target: 'self', key: 'team-bonus', mods: { atkFlat: 17 } } },
  ] }] });
  const id = 'chess_x_data_demo_guard_a';
  for (const active of [false, true]) {
    const h = makeBattle({ data: new DataSource(set.data), units: [{ chessId: id, row: 10, col: 4 }], bonds: { [bondId]: { active, tier: active ? 1 : 0 } } });
    h.step(); assert.equal(h.unit(id).s.atk, set.data.chess[id].stats.atk + (active ? 17 : 0));
  }
});

test('DIY token references receive independent, complete variants without altering the shop record', t => {
  const f = fixture(t), op = guard(); op.as = 'both'; op.kit = 'generic';
  const tokenId = 'token_x_data_demo_helper', source = structuredClone(Object.values(base.tokens)[0]);
  source.tokenId = tokenId;
  for (const form of Object.values(op.forms)) { form.tokens = [tokenId]; form.tags = ['DPS']; }
  f.put('data-demo', { data: ['r.json'], operators: ['o.json'] }, { 'r.json': { records: 1, entries: [{ file: 'tokens', id: tokenId, value: source }] }, 'o.json': op });
  const set = buildContentSet({ registry: f.registry, ids: ['data-demo'] }); assert.deepEqual(set.problems, []);
  assert.ok(new GameData(set.data, 'mode_single_normal').token(tokenId));
  assert.deepEqual(set.data.chess.chess_x_data_demo_guard_a.tokens, [tokenId]);
  assert.deepEqual(set.data.chess.chess_x_data_demo_guard_a.tags, ['DPS']);
  for (const [status, form] of Object.entries(set.data.backups.units[op.charId].forms)) {
    assert.notEqual(form.tokens[0], tokenId);
    assert.ok(set.data.backups.tokens[form.tokens[0]].variants[`${op.charId}@${status}`]);
  }
});

test('DIY token aliases select the matching normal/elite chess variant', t => {
  const f = fixture(t), op = guard(); op.kit = 'generic';
  const tokenId = 'token_x_data_demo_helper', source = structuredClone(Object.values(base.tokens)[0]);
  source.tokenId = tokenId;
  source.stats.atk = 85;
  const variant = structuredClone(source); delete variant.variants;
  source.variants = Object.fromEntries([false, true].map(golden => [
    `chess_x_data_demo_guard_${golden ? 'b' : 'a'}`,
    { ...structuredClone(variant), sources: ['skill'], stats: { ...source.stats, atk: golden ? 114 : 95 } },
  ]));
  for (const form of Object.values(op.forms)) form.tokens = [tokenId];
  f.put('data-demo', { data: ['r.json'], operators: ['o.json'] }, {
    'r.json': { records: 1, entries: [{ file: 'tokens', id: tokenId, value: source }] }, 'o.json': op,
  });
  const set = buildContentSet({ registry: f.registry, ids: ['data-demo'] });
  assert.deepEqual(set.problems, []);
  assert.deepEqual(set.data.tokens[tokenId], source);
  for (const [status, form] of Object.entries(set.data.backups.units[op.charId].forms)) {
    const alias = form.tokens[0], variant = set.data.backups.tokens[alias].variants[`${op.charId}@${status}`];
    assert.equal(variant.stats.atk, form.status.equipLevel > 0 ? 114 : 95);
    assert.deepEqual(variant.sources, ['skill']);
  }
});

test('custom skill admission retains general limits, step bounds and known zero-valued official keys', () => {
  const vanilla = structuredClone(base), first = Object.values(vanilla.chess)[0];
  first.skill.bb.known_zero = 0; first.skills.find(s => s.isDefault).bb.known_zero = 0;
  const op = guard(); op.kit = 'generic';
  const expanded = bb => expandGameplayRecords(vanilla, [{ ...op, skills: [{ ...op.skills[0], bb }] }], opts).data;
  assert.deepEqual(validateGameplayData(expanded({ heal: 65, 'custom.heal@value': -80 }), { vanilla }), []);
  for (const bb of [{ heal: 1e9 + 1 }, { known_zero: 65 }, { 'custom.interval': 65 }, { 'custom.cost': 0.00001 }]) {
    const data = expanded({ heal: 65 }), chess = data.chess.chess_x_data_demo_guard_a;
    chess.skill.bb = bb; chess.skills[0].bb = bb;
    assert.ok(validateGameplayData(data, { vanilla }).some(p => p.code === 'PLUGIN_DATA_BOUND'), JSON.stringify(bb));
  }
  const talent = expanded({ heal: 65 });
  talent.chess.chess_x_data_demo_guard_a.talents = [{ name: 'Test', bb: { heal: 80 } }];
  assert.ok(validateGameplayData(talent, { vanilla }).some(p => p.code === 'PLUGIN_DATA_BOUND' && p.path.includes('.talents')));
  const missing = expanded({ heal: 65 });
  missing.chess.chess_x_data_demo_guard_a.tokens = ['token_missing'];
  assert.ok(validateGameplayData(missing, { vanilla }).some(p => p.code === 'PLUGIN_DATA_REFERENCE'));
  const mismatch = expanded({ heal: 65 });
  mismatch.chess.chess_x_data_demo_guard_a.skill.bb = { heal: 80 };
  assert.ok(validateGameplayData(mismatch, { vanilla }).length);
});

test('DIY token status variants keep precedence and ambiguous or missing variants retain the base', () => {
  const charId = 'char_x_data_demo_guard', tokenId = 'token_x_data_demo_helper', status = '1/1/1/1', chessId = 'chess_x_data_demo_guard_b';
  const run = variants => {
    const token = { tokenId, stats: { atk: 85 }, sources: ['skill'], variants };
    const data = { tokens: { [tokenId]: token }, chess: {}, backups: { tokens: {}, units: { [charId]: { charId,
      forms: { [status]: { chessId, tokens: [tokenId], displayTokens: [tokenId], skills: [{ overrideTokenKey: tokenId }], talents: [{ tokenKey: tokenId }] } },
    } } } };
    const out = reconcilePluginTokens(data), form = out.backups.units[charId].forms[status], alias = form.tokens[0];
    assert.notEqual(alias, tokenId);
    assert.deepEqual(form.displayTokens, [alias]); assert.equal(form.skills[0].overrideTokenKey, alias); assert.equal(form.talents[0].tokenKey, alias);
    assert.deepEqual(data.tokens[tokenId], token); assert.deepEqual(data.backups.tokens, {});
    return out.backups.tokens[alias].variants[`${charId}@${status}`].stats.atk;
  };
  const chess = { stats: { atk: 114 }, sources: ['skill'] }, trained = { stats: { atk: 130 }, sources: ['skill'] };
  assert.equal(run({ [chessId]: chess }), 114);
  assert.equal(run({ [chessId]: chess, [`owner@${status}`]: trained }), 130);
  assert.equal(run({ [chessId]: chess, [`owner@${status}`]: trained, [`other@${status}`]: trained }), 85);
  assert.equal(run({ chess_someone_else_b: chess }), 85);
});
