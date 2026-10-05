import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as sim from '../../server/sim/spec.js';
import { DataSource } from '../../server/sim/simdata.js';
import { getData } from '../../server/data.js';
import { battleCatalog, defaultBattleConfig, createBattleScenario, setAutoAttack, testDamage } from '../../public/dev/battle-scenario.js';
import { canTargetEnemy } from '../../server/sim/targeting.js';
import { checkInvariants } from '../helpers/battleHarness.js';

const raw = getData(), ds = new DataSource(raw);
const create = (overrides = {}) => createBattleScenario(sim, ds, raw, { ...defaultBattleConfig(raw, overrides), ...overrides });
const run = (s, secs) => { for (let i = 0; i < secs * 30 && !s.battle.finished; i++) s.battle.step(); checkInvariants(s.battle); };

test('catalog derives all real operator forms and every enemy variant from data', () => {
  const c = battleCatalog(raw);
  assert.equal(c.operators.length, Object.values(raw.chess).filter((r) => r.charId && !r.isDiy).length);
  assert.equal(c.enemies.length, Object.keys(raw.enemies).length);
  assert.ok(c.operators.find((x) => x.id === 'chess_char_1_02_a').label.includes('普通'));
  assert.ok(c.operators.find((x) => x.id === 'chess_char_1_02_b').label.includes('精英'));
  assert.ok(c.enemies.find((x) => x.id === 'enemy_1288_duskls_2').label.includes('精锐'));
});

test('melee blocks and both sides automatically attack without test damage', () => {
  const s = create();
  assert.equal(s.battle.time, 0);
  const ehp = s.enemy.hp, ahp = s.operator.hp;
  run(s, 9);
  assert.equal(s.enemy.blockedBy, s.operator);
  assert.ok(s.enemy.hp < ehp && s.operator.hp < ahp);
  assert.ok(s.operator.stats.attacks > 0);
  assert.equal(s.spec.content, 'full');
  assert.equal(s.battle.errorCount, 0);
});

test('ranged operator on a real high tile attacks a ground and a flying enemy', () => {
  const fly = Object.values(raw.enemies).find((e) => e.isFlyEnemy && e.rank === 'NORMAL' && !e.tokenOnly);
  for (const enemyKey of ['enemy_1288_duskls', fly.key]) {
    const s = create({ chessId: 'chess_char_1_01_a', enemyKey, row: 10, col: 4, dir: 'RIGHT', enemyAuto: false });
    assert.equal(s.battle.grid.isLow(10, 4), false);
    const hp = s.enemy.hp;
    run(s, 12);
    assert.ok(s.enemy.hp < hp || !s.enemy.alive, enemyKey);
    assert.ok(s.operator.stats.attacks > 0);
    if (enemyKey === fly.key) assert.equal(s.enemy.blockedBy, null);
    assert.equal(s.battle.errorCount, 0);
  }
});

test('deployment and path constraints reject invalid config with concrete errors', () => {
  assert.throws(() => create({ row: 10, col: 4 }), /地面\/高台/);
  assert.throws(() => create({ row: 8 }), /部署限制/);
  assert.throws(() => create({ start: [10, 4] }), /不能供地面/);
  assert.throws(() => create({ start: [9, 11] }), /战场范围/);
  assert.throws(() => create({ seed: 0 }), /随机种子/);
  assert.throws(() => create({ stageId: 'act1autochess_m05' }), /尚未实现/);
  assert.throws(() => create({ enemyKey: 'missing' }), /数据不存在/);
  assert.throws(() => create({ chessId: 'chess_char_5_diy1_a' }), /甄选/);
  assert.throws(() => create({ enemyKey: 'enemy_9016_acstmr' }), /绑定真实攻击目标/);
});

test('elite Gladiia with HOK-Y can deploy on high ground; other loadouts remain ground-only', () => {
  const placement = { stageId: 'act2autochess_m01', row: 10, col: 4, enemyAuto: false };
  const s = create({ ...placement, chessId: 'chess_char_4_12_b', moduleId: 'uniequip_003_glady' });
  assert.equal(s.operator.def.position, 'MELEE');
  assert.equal(s.operator.ground, false);
  assert.ok(s.operator.alive && s.operator.deployed);
  run(s, 1);
  assert.equal(s.battle.errorCount, 0);
  for (const [chessId, moduleId] of [
    ['chess_char_4_12_b', 'none'], ['chess_char_4_12_b', 'uniequip_002_glady'],
    ['chess_char_4_12_a', 'none'], ['chess_char_2_03_b', 'none'],
  ]) assert.throws(() => create({ ...placement, chessId, moduleId }), /地面\/高台/);
});

test('alternate skill and module resolve through the real loadout data view', () => {
  const r = Object.values(raw.chess).find((r) => r.isGolden && r.skills?.length > 1 && r.modules?.length);
  const skill = r.skills.find((s) => !s.isDefault), module = r.modules[0];
  const s = create({ chessId: r.chessId, skillIndex: skill.index, moduleId: module.uniEquipId });
  assert.equal(s.operator.def.skill.id, skill.skillId);
  assert.equal(s.operator.def.loadout.moduleId, module.uniEquipId);
  assert.equal(s.spec.players[0].units[0].skillIndex, skill.index);
  assert.throws(() => create({ skillIndex: 9 }), /尚未解锁/);
  assert.throws(() => create({ moduleId: 'invalid' }), /不支持所选模组/);
});

test('the selected automatic skill charges from real attacks and fires through the production runtime', () => {
  const s = create({ chessId: 'chess_char_1_01_a', skillIndex: 0, enemyAuto: false });
  run(s, 20);
  assert.equal(s.operator.def.skill.id, 'skchr_inside_1');
  const casts = s.battle.drainEvents().filter((e) => e[0] === 'skill' && e[1] === s.operator.id);
  assert.ok(casts.some((e) => e[2] === 1), 'skill starts');
  assert.ok(casts.some((e) => e[2] === 0), 'ammo skill ends after its real ammunition is spent');
  assert.equal(s.battle.errorCount, 0);
});

test('attack switches suppress both sides and preserve blocking / SP / withdrawal', () => {
  const s = create({ allyAuto: false, enemyAuto: false });
  const hp = [s.operator.hp, s.enemy.hp];
  run(s, 9);
  assert.deepEqual([s.operator.hp, s.enemy.hp], hp);
  assert.equal(s.enemy.blockedBy, s.operator);
  assert.ok(s.operator.skill.sp > 0);
  setAutoAttack(s, 'ally', true); run(s, 2);
  assert.ok(s.enemy.hp < hp[1]);
  setAutoAttack(s, 'enemy', true); run(s, 2);
  assert.ok(s.operator.hp < hp[0]);
  s.battle.retreat(s.operator, { permanent: true }); run(s, 1);
  assert.equal(s.enemy.blockedBy, null);
  assert.ok(s.operator.removed);
});

test('generic page preserves ember hits, reveal, revival, final death and kill counts', () => {
  for (const enemyKey of ['enemy_1288_duskls', 'enemy_1288_duskls_2', 'enemy_1292_duskld']) {
    const s = create({ enemyKey, allyAuto: false, enemyAuto: false });
    const hp = s.enemy.hp;
    testDamage(s, s.enemy, { lethal: true });
    assert.equal(s.enemy.form, 'husk'); assert.equal(s.battle.killed, 0);
    run(s, 7); assert.equal(s.enemy.blockedBy, s.operator); assert.ok(canTargetEnemy(s.operator, s.enemy, s.operator.profile));
    run(s, 9); assert.equal(s.enemy.form, 'revived'); assert.equal(s.enemy.hp, hp);
    testDamage(s, s.enemy, { lethal: true }); run(s, 2);
    while (s.enemy.alive) testDamage(s, s.enemy, { hit: true });
    assert.equal(s.battle.killed, 1); run(s, 20); assert.ok(!s.enemy.alive);
    assert.equal(s.battle.errorCount, 0);
  }
});

test('Quintus receives its device template, shared pool and actual tentacle positions', () => {
  const s = create({ enemyKey: 'enemy_1521_dslily', allyAuto: false });
  assert.equal(s.spec.kind, 'boss'); assert.ok(s.enemy.bossPool === s.battle.sharedBoss);
  assert.equal(s.spec.waveId, 'act1autochess_h07_04_s');
  assert.equal(s.context.template.devices.length, 4);
  s.battle.drainEvents(); run(s, 100);
  const events = s.battle.drainEvents();
  const tentacles = events.filter((e) => e[0] === 'fx' && e[1] === 'tentacle');
  assert.ok(tentacles.length > 0);
  for (const e of tentacles) assert.ok(s.context.template.devices.some((d) => d.pos[0] === e[3] && d.pos[1] === e[2]));
  assert.equal(s.battle.errorCount, 0);
});

test('hidden leaders and standalone parts include real counterparts; pool damage transfers', () => {
  const s = create({ enemyKey: 'enemy_9018_actrpa', allyAuto: false });
  assert.equal(s.spec.kind, 'hidden');
  assert.deepEqual(new Set(s.battle.aliveEnemies().map((e) => e.defId)), new Set(['enemy_9017_achunt_2', 'enemy_9018_actrpa', 'enemy_9019_actrpb', 'enemy_9020_actrpc']));
  const pool = s.battle.sharedBoss.hp;
  testDamage(s, s.enemy, { amount: 1000, type: 'true' });
  assert.ok(s.battle.sharedBoss.hp < pool);
  assert.equal(s.battle.errorCount, 0);
});

test('same configuration / seed / test operations replay identical snapshots and events', () => {
  const replay = () => {
    const s = create({ allyAuto: false, enemyAuto: false });
    const events = s.battle.drainEvents();
    testDamage(s, s.enemy, { lethal: true }); run(s, 7);
    testDamage(s, s.enemy, { hit: true }); run(s, 2);
    events.push(...s.battle.drainEvents());
    return { spec: s.spec, snapshot: s.battle.snapshot(), events };
  };
  assert.deepEqual(replay(), replay());
});

test('terrain-dependent enemies receive supported real maps and spawn on the required terrain', () => {
  const diver = create({ enemyKey: 'enemy_1158_divman', allyAuto: false });
  assert.equal(diver.battle.grid.tile(diver.enemy.y, diver.enemy.x).terrain, 'deepsea');
  run(diver, 1);
  assert.ok(diver.enemy.s.flags.stealth, 'water stealth actually activates');
  const chimera = create({ enemyKey: 'enemy_1425_lrcmra', allyAuto: false });
  assert.equal(chimera.battle.grid.tile(chimera.enemy.y, chimera.enemy.x).terrain, 'infection');
  run(chimera, 1);
  assert.equal(chimera.enemy.mem.ab.atkType, 'arts');
  const dry = create({ enemyKey: 'enemy_1158_divman', stageId: 'act2autochess_m02' });
  assert.ok(dry.context.notes.some((n) => n.includes('不会触发')));
});

test('scripted normal attacks respect the enemy toggle; scripted SP reads the actual runtime', () => {
  const deer = create({ enemyKey: 'enemy_9033_acdeer', allyAuto: false, enemyAuto: false });
  run(deer, 3);
  assert.equal(deer.enemy.stats.attacks, 0);
  setAutoAttack(deer, 'enemy', true); run(deer, 1);
  assert.ok(deer.enemy.stats.attacks > 0);
  const lion = create({ enemyKey: 'enemy_9032_aclionk', allyAuto: false, enemyAuto: false });
  run(lion, 1);
  const meter = lion.enemy.mem.ab.skillSp();
  assert.ok(Math.abs(meter.value - 1) < 1e-9);
  assert.ok(meter.max > 1);
});

test('the sandbox attack switch preserves deer phase checks and independent scripted skills', () => {
  const s = create({ enemyKey: 'enemy_9033_acdeer', allyAuto: false, enemyAuto: false });
  s.battle.loseHp(s.enemy, s.enemy.hp * .6);
  run(s, 41);
  assert.equal(s.enemy.stats.attacks, 0);
  assert.ok(s.enemy.findBuff('boss:madness'), 'the HP phase changes with ordinary attacks disabled');
  assert.ok(s.battle.drainEvents().some((e) => e[0] === 'fx' && e[1] === 'beam' && e[4].kind === 'naturalSurge'), '自然涌动 still fires');
  assert.equal(s.battle.errorCount, 0);
});

test('local attack controls do not change production scripted attack or disarm behaviour', () => {
  const s = create({ enemyKey: 'enemy_9033_acdeer', allyAuto: false, enemyAuto: false });
  const b = sim.createBattleFromSpec(s.spec, ds, { quiet: true });
  b.start(); b._processSpawns();
  const enemy = b.enemies.find((e) => e.defId === s.config.enemyKey);
  b.addBuff(enemy, { key: 'test:disarm', flags: { disarm: true }, persist: true });
  b.step();
  assert.ok(enemy.stats.attacks > 0, 'the production baseline is unchanged by sandbox controls');
  run(s, 1);
  assert.equal(s.enemy.stats.attacks, 0, 'only the local scene suppresses 冰凌');
});

for (const enemyKey of ['enemy_9021_acduml', 'enemy_9021_acduml_2', 'enemy_9022_acdumm']) {
  test(`${enemyKey}: local attack control covers pipe/string counterparts without stopping summons or skills`, () => {
    const s = create({ enemyKey, allyAuto: false, enemyAuto: false });
    run(s, 85);
    const leaders = s.battle.enemies.filter((e) => ['enemy_9021_acduml', 'enemy_9021_acduml_2', 'enemy_9022_acdumm'].includes(e.defId));
    assert.ok(leaders.length > 0);
    for (const e of leaders) assert.equal(e.stats.attacks, 0, `${e.defId} ordinary attacks stay disabled`);
    assert.ok(s.battle.enemies.some((e) => e.defId === 'enemy_9023_acdums'), '余音 summoning continues');
    const events = s.battle.drainEvents();
    assert.ok(events.some((e) => e[0] === 'fx' && ['pipeStrike', 'stringStrike'].includes(e[4]?.kind)), 'scripted skills continue');
    assert.ok(events.some((e) => e[0] === 'fx' && e[1] === 'summon'));
    setAutoAttack(s, 'enemy', true);
    run(s, 45);
    assert.ok(s.enemy.stats.attacks > 0, 'ordinary attacks resume when an echo of its form exists');
    assert.equal(s.battle.errorCount, 0);
  });
}

test('one manual frequency hit consumes one real frequency shield instance', () => {
  const s = create({ enemyKey: 'enemy_9020_actrpc', allyAuto: false, enemyAuto: false });
  const shield = () => s.enemy.mem.ab.frequencyShield();
  const before = shield(), hp = s.enemy.hp;
  assert.ok(before > 0);
  testDamage(s, s.enemy, { hit: true });
  assert.equal(shield(), before - 1);
  assert.equal(s.enemy.hp, hp);
});
