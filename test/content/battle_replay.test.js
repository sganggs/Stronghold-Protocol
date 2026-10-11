import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as sim from '../../server/sim/spec.js';
import { TICK } from '../../server/sim/constants.js';
import { DataSource } from '../../server/sim/simdata.js';
import { getData } from '../../server/data.js';
import { defaultBattleConfig } from '../../public/dev/battle-scenario.js';
import { createRecorder, replayScenario, validateReplay, dataVersion } from '../../public/dev/battle-replay.js';

const raw = getData(), ds = new DataSource(raw), version = dataVersion(raw);
const create = (overrides = {}) => createRecorder(sim, ds, raw, { ...defaultBattleConfig(raw, overrides), ...overrides }, version);
const damage = (r, options = {}) => r.perform({ type: 'damage', targetId: r.scene.enemy.id, amount: 1, damageType: 'true', lethal: false, hit: false, ...options });
const run = (r, n) => { for (let i = 0; i < n; i++) assert.equal(r.step(), true); };

test('one fixed frame advances exactly TICK; potential/development go through the production BattleSpec', () => {
  const r = create({ potential: 1, cultivate: 3 }), base = create({ potential: 1, cultivate: 0 });
  assert.equal(r.tick, 0); r.step(); assert.equal(r.tick, 1); assert.equal(r.scene.battle.time, TICK);
  assert.equal(r.scene.spec.players[0].units[0].potential, 1);
  assert.equal(r.scene.spec.players[0].units[0].cultivate, 3);
  assert.ok(r.scene.operator.s.maxHp > base.scene.operator.s.maxHp);
  const rec = Object.values(raw.chess).find((r) => r.charId && !r.isDiy && r.potentials?.length);
  // Any owned operator resolves its own real potential data, rather than a test multiplier.
  const low = create({ chessId: rec?.chessId ?? 'chess_char_1_02_a', potential: 1 });
  const high = create({ chessId: low.scene.config.chessId, potential: 6 });
  assert.notDeepEqual(low.scene.operator.base, high.scene.operator.base);
  for (const overrides of [{ potential: 0 }, { potential: 7 }, { cultivate: -1 }, { cultivate: 4 }, { potential: 1.5 }]) assert.throws(() => create(overrides), /潜能/);
});

test('export/import replay exactly matches snapshots, events and operation order, including same-frame edits', () => {
  const r = create();
  r.perform({ type: 'autoAttack', side: 'ally', enabled: false });
  r.perform({ type: 'autoAttack', side: 'enemy', enabled: false });
  damage(r, { lethal: true }); run(r, 30); damage(r, { hit: true }); damage(r, { hit: true });
  assert.equal(r.scene.enemy.hp, 3);
  assert.deepEqual(r.operations.slice(3).map((x) => [x.tick, x.sequence]), [[30, 0], [30, 1]]);
  run(r, 180); r.perform({ type: 'retreat', targetId: r.scene.operator.id }); run(r, 30);
  const events = r.scene.battle.drainEvents(), doc = JSON.parse(JSON.stringify(r.export()));
  // Imports accept unordered arrays, but sequence is the canonical within-tick order.
  doc.operations.reverse();
  const replay = replayScenario(sim, ds, raw, doc, version).recorder;
  assert.deepEqual(replay.scene.battle.snapshot(), r.scene.battle.snapshot());
  assert.deepEqual(replay.scene.battle.drainEvents(), events);
  assert.deepEqual(replay.export(), r.export());
  assert.equal(replay.scene.battle.errorCount, 0);
  assert.equal(JSON.stringify(doc).includes('battle'), false, 'no runtime graph is serialized');
});

test('boss/terrain contexts and revival replay from their initial data and seed', () => {
  for (const enemyKey of ['enemy_9033_acdeer', 'enemy_1521_dslily', 'enemy_9018_actrpa', 'enemy_1158_divman', 'enemy_1288_duskls']) {
    const r = create({ enemyKey, allyAuto: false, enemyAuto: false });
    if (enemyKey === 'enemy_1288_duskls') damage(r, { lethal: true });
    run(r, 480);
    const q = replayScenario(sim, ds, raw, JSON.stringify(r.export()), version).recorder;
    assert.deepEqual(q.scene.battle.snapshot(), r.scene.battle.snapshot(), enemyKey);
    assert.deepEqual(q.scene.battle.drainEvents(), r.scene.battle.drainEvents(), enemyKey);
  }
});

test('strict validation rejects malformed JSON/schema, IDs, coordinates, loadouts, values, types and sequences', () => {
  const doc = create().export();
  assert.throws(() => validateReplay('{'), /JSON/);
  for (const edit of [
    (d) => d.schemaVersion = 2, (d) => d.seed = 0, (d) => d.endTick = -1, (d) => d.endTick = 18001,
    (d) => d.config.row = 1.5, (d) => d.config.start = [9], (d) => d.config.checkpoints = [[9, '2']],
    (d) => d.config.allyAuto = 1, (d) => d.config.potential = 0, (d) => d.config.cultivate = 4,
    (d) => d.config.moduleId = {}, (d) => d.config.dir = 'EAST', (d) => d.extra = {},
    (d) => d.operations = [{ type: 'unknown', tick: 0, sequence: 0 }],
    (d) => d.operations = [{ type: 'autoAttack', tick: 0, sequence: 1, side: 'ally', enabled: false }],
    (d) => d.operations = [{ type: 'autoAttack', tick: 1, sequence: 0, side: 'ally', enabled: false }],
    (d) => d.operations = [{ type: 'damage', tick: 0, sequence: 0, targetId: 1, amount: null, damageType: 'true', lethal: false, hit: false }],
  ]) {
    const bad = structuredClone(doc); edit(bad); assert.throws(() => validateReplay(bad));
  }
  for (const edit of [
    (d) => d.config.chessId = 'missing', (d) => d.config.enemyKey = 'missing', (d) => d.config.stageId = 'missing',
    (d) => d.config.moduleId = 'missing', (d) => d.config.skillIndex = 9,
    (d) => d.config.start = [0, 0],
    (d) => d.operations = [{ type: 'retreat', tick: 0, sequence: 0, targetId: 999999 }],
    (d) => d.operations = [{ type: 'retreat', tick: 0, sequence: 0, targetId: create().scene.enemy.id }],
  ]) {
    const bad = structuredClone(doc); edit(bad); assert.throws(() => replayScenario(sim, ds, raw, bad, version));
  }
  const active = create(), before = active.scene.battle.snapshot();
  assert.throws(() => replayScenario(sim, ds, raw, '{', version));
  assert.deepEqual(active.scene.battle.snapshot(), before);
});

test('data fingerprints are independent of key order; game/data mismatches produce explicit warnings', () => {
  assert.equal(dataVersion({ a: 1, b: 2 }), dataVersion({ b: 2, a: 1 }));
  assert.notEqual(dataVersion({ a: 1 }), dataVersion({ a: 2 }));
  const doc = create().export(); doc.gameVersion = 'old';
  const { warnings } = replayScenario(sim, ds, raw, doc, version);
  assert.equal(warnings.length, 1); assert.match(warnings[0], /版本不一致/);
  assert.equal(validateReplay(create().export(), { version: 'changed' }).warnings.length, 1);
});

test('state inspection hooks only read scripted meters and do not affect production simulation', () => {
  for (const enemyKey of ['enemy_9032_aclionk', 'enemy_9020_actrpc', 'enemy_9018_actrpa']) {
    const r = create({ enemyKey }), a = sim.createBattleFromSpec(r.scene.spec, ds, { quiet: true }), b = sim.createBattleFromSpec(r.scene.spec, ds, { quiet: true });
    for (let i = 0; i < 90; i++) {
      a.step(); b.step();
      for (const u of a.units) for (const method of ['skillSp', 'frequencyShield', 'damageShield']) u.mem.ab?.[method]?.();
    }
    assert.deepEqual(a.snapshot(), b.snapshot()); assert.deepEqual(a.drainEvents(), b.drainEvents());
  }
});
