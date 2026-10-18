import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { fixture, guard, bondPatch } from '../helpers/contentFixtures.js';
import { buildContentSet, contentSetFiles } from '../../server/plugins/contentSet.js';
import { DataSource } from '../../server/sim/simdata.js';
import { setGameData, gameData, bondRecord, itemRecord, bandRecord, garrisonRecord, effectRecord, chessRecord } from '../../server/sim/content/support/index.js';
import { GameData } from '../../server/match/gamedata.js';
import { DATA_SHIM_JS } from '../../server/http/static.js';
import { loadBrowserSim } from '../../public/js/battle/runner.js';
import { buildBattleSpec, createBattleFromSpec, resultDigest } from '../../server/sim/spec.js';
import { compileDsl } from '../../server/sim/content/dsl/compile.js';
const close = (a,b) => assert.ok(Math.abs(a-b) < 1e-7, `${a} != ${b}`);
function setFor(t, { operators = [guard()], entries = [], patch = bondPatch() } = {}) {
  const f = fixture(t); f.put('data-demo', { operators: ['op.json'], data: ['p.json', 'r.json'] }, { 'op.json': operators, 'p.json': patch, 'r.json': { records: 1, entries } });
  const set = buildContentSet({ registry: f.registry, ids: ['data-demo'] }); assert.deepEqual(set.problems, []);
  setGameData(set.data); t.after(() => setGameData(null)); return { ...f, set };
}
test('kitRef normal and elite use official behavior with plugin blackboards', t => {
  const { set } = setFor(t);
  for (const suffix of ['a','b']) {
    const id = `chess_x_data_demo_guard_${suffix}`, rec = set.data.chess[id];
    const h = makeBattle({ data: new DataSource(set.data), units: [{ chessId: id, row: 10, col: 5 }] });
    h.step(); const u = h.unit(id); assert.ok(!u.kit.generic); u.skill.activate('test', { free: true });
    close(u.s.def, rec.stats.def * 1.5); close(u.s.maxHp, rec.stats.maxHp * 1.4); checkInvariants(h.b);
  }
});
test('kitRef survives a one-skill DIY pick and a file-stem alias resolves', t => {
  const op = guard(); op.kit = { ref: 'chess_char_1_02-yak' };
  const { set } = setFor(t, { operators: [op] });
  const h = makeBattle({ data: new DataSource(set.data), units: [{ diy: { slot: 5, charId: op.charId, skillIndex: 0 }, row: 10, col: 5 }] });
  h.step(); const u = h.allies()[0]; assert.ok(!u.kit.generic); u.skill.activate('test', { free: true }); close(u.s.def, 375); checkInvariants(h.b);
});

test('JSON SkillSpec and permanent talent mods work on shop and DIY units', t => {
  const op = guard(); op.kit = { spec: { kind: 'passive', mods: { atkPct: 0.5 }, attack: { dmgType: 'arts', hits: 2 } } }; op.talentMods = { defFlat: 25 };
  const { set } = setFor(t, { operators: [op] });
  for (const units of [[{ chessId: 'chess_x_data_demo_guard_a', row: 10, col: 5 }], [{ diy: { slot: 5, charId: op.charId, skillIndex: 0 }, row: 10, col: 5 }]]) {
    const h = makeBattle({ data: new DataSource(set.data), units }); h.step(); const u = h.allies()[0];
    assert.ok(!u.kit.generic); close(u.s.atk, 300); close(u.s.def, 275); assert.equal(u.skill.spec.attack.hits, 2); checkInvariants(h.b);
  }
  // P2's compiler stands at the C2 seam since claude/030-int was merged (the stub is gone): an invalid spec is a coded refusal
  assert.throws(() => compileDsl({}), (e) => /^PLUGIN_DSL_/.test(e.code));
});
test('effectRef item reaches the id-dispatched battle effect; copied params remain concrete', t => {
  const { set } = setFor(t, { entries: [{ file: 'items', id: 'item_x_data_demo_scope', base: 'chess_item_3_02_e_a' }] });
  const probe = chessRec({ id: 'probe', stats: { atk: 500, maxHp: 2000 } });
  const raw = { ...set.data, chess: { ...set.data.chess, probe }, enemies: { ...set.data.enemies, enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 1e7, speed: 0 }) } };
  const h = makeBattle({ data: new DataSource(raw), units: [{ chessId: 'probe', row: 10, col: 3, items: ['item_x_data_demo_scope'] }], enemies: [{ key: 'enemy_dummy', pos: [10,6] }] });
  h.step(); const u = h.unit('probe'), e = h.enemy('enemy_dummy');
  close(h.b.dealDamage(u, e, { amount: 1000, type: 'true', canDodge: false }), 1300); checkInvariants(h.b);
});
test('mode economy and global overrides reach GameData and the battle flags', t => {
  const { set } = setFor(t, { entries: [{ file: 'modes', id: 'mode_x_data_demo_free', base: 'mode_single_normal', set: {
    economy: { refreshPrice: 0, income: [0, 99], chessPrice: { 1: { normal: 7 } } }, dp: { init: 35 }, timers: { infoCheck: 7 }, lpCapPerRound: 4,
  } }] });
  const gd = new GameData(set.data, 'mode_x_data_demo_free'), normal = new GameData(set.data, 'mode_single_normal');
  assert.equal(gd.refreshPrice, 0); assert.equal(gd.income(1), 99); assert.equal(gd.chessPrice('chess_char_1_02_a'), 7);
  assert.equal(gd.timer('infoCheck'), 7); assert.equal(gd.lpCapPerRound, 4); assert.equal(normal.refreshPrice, 1);
  const h = makeBattle({ data: new DataSource(set.data), units: [{ chessId: 'chess_x_data_demo_guard_a', row: 10, col: 5 }], flags: gd.dp });
  assert.equal(h.b.flags.dpInit, 35); checkInvariants(h.b);
});
test('merged data reaches every support lookup and a real battle, through Node and the actual browser-style loader', async t => {
  const { set, dir } = setFor(t);
  for (const [file, get] of [['bonds',bondRecord],['items',itemRecord],['bands',bandRecord],['garrisons',garrisonRecord],['effects',effectRecord],['chess',chessRecord]]) {
    const id = Object.keys(set.data[file])[0]; assert.equal(get(id), set.data[file][id]);
  }
  assert.equal(gameData(), set.data);
  const runtime = path.join(dir, 'runtime'); fs.mkdirSync(path.join(runtime, 'server'), { recursive: true });
  // as the browser gets /sim/: no Node loader (by file name — cpSync passes paths with the OS separator, `\` on
  // Windows). With it simdata.js → nodeData.js → this data.js shim → simdata.js would deadlock the imports below.
  fs.cpSync('server/sim', path.join(runtime,'server/sim'), { recursive: true, filter: src => path.basename(src) !== 'nodeData.js' });
  assert.equal(fs.existsSync(path.join(runtime, 'server/sim/nodeData.js')), false);
  fs.cpSync('shared', path.join(runtime,'shared'), { recursive: true });
  fs.writeFileSync(path.join(runtime,'package.json'), '{"type":"module"}');
  fs.writeFileSync(path.join(runtime,'server/data.js'), DATA_SHIM_JS);
  const table = contentSetFiles(set), base = pathToFileURL(path.join(runtime,'server/sim')).href + '/';
  // as the page does (public/js/content.js loadContentSet → simContent): the set's checked files and its official-bounds
  // snapshot, never a fetch of /data/
  const files = Object.fromEntries([...table].filter(([rel]) => /^data\/[^/]+\.json$/.test(rel)).map(([rel, f]) => [rel.slice(5, -5), JSON.parse(f.body.toString('utf8'))]));
  const bounds = JSON.parse(table.get('bounds/official.json').body.toString('utf8'));
  const caps = await import(new URL('../../shared/plugins/officialBounds.js', base).href);
  const noFetch = async (url) => assert.fail(`no fetch for a content set (${url})`);
  // without its snapshot the set runs on the floor — never on a scan of its own tables (a scan would give 10 × 12)
  await loadBrowserSim({ base, data: files, cs: set.cs, fetchFn: noFetch });
  assert.equal(caps.bbCap('times'), 64);
  const loaded = await loadBrowserSim({ base, data: files, cs: set.cs, bounds, fetchFn: noFetch });
  assert.equal(loaded.cs, set.cs);
  assert.equal(caps.bbCap('times'), 120, 'the snapshot the server validated against (and its match host installs)');
  const support = await import(base + 'content/support/index.js');
  for (const file of ['bonds','items','bands','garrisons','effects','chess']) assert.deepEqual(support.gameData()[file], set.data[file]);
  const h = makeBattle({ data: new DataSource(set.data), stageId: 'act1autochess_m01', timeLimit: 2, units: [{ chessId: 'chess_x_data_demo_guard_a', row: 9, col: 5 }], bonds: { deputShip: { active: true, tier: 1, layers: 0 } } });
  h.step(); close(h.allies()[0].s.def, 250 * 1.3);
  const spec = buildBattleSpec({ ...h.b.opts, stageId: 'act1autochess_m01' });
  const server = createBattleFromSpec(spec, new DataSource(set.data));
  const browser = loaded.spec.createBattleFromSpec(spec, loaded.ds);
  server.start(); browser.start();
  for (let i = 0; i < 90; i++) { server.step(); browser.step(); }
  close(browser.allyUnits[0].s.def, 250 * 1.3);
  assert.deepEqual(browser.snapshot(), server.snapshot()); assert.deepEqual(resultDigest(browser.result()), resultDigest(server.result()));
});

test('effectRef band keeps the new record parameters in its battle handler', t => {
  const { set } = setFor(t, { entries: [{ file: 'bands', id: 'band_x_data_demo_emperor', base: 'band_emperor', set: {
    buffs: [{ key: 'env_gbuff_new_with_verify', bb: { respawn_time: -0.2, value: 0 }, bbStr: { key: 'act1autochess_band16_buff' } }],
  } }] });
  const h = makeBattle({ data: new DataSource(set.data), bandId: 'band_x_data_demo_emperor', units: [{ chessId: 'chess_x_data_demo_guard_a', row: 10, col: 5 }] });
  h.step(); close(h.allies()[0].s.redeployMul, 0.8); checkInvariants(h.b);
});
