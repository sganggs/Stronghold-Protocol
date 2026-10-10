// Community reports of 2026-10-10: actual attacks / skills, including death and redeployment in the same tick.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';

const bond = (layers = 0) => ({ count: 3, active: true, tier: 1, layers });
const dummy = enemyRec({ key: 'dummy', hp: 1e9, atk: 0, speed: 0, mass: 0 });
const wall = (id, opts = {}) => chessRec({ id, skill: null, stats: { maxHp: 1e7, atk: 0, def: 0, blockCnt: 3 }, ...opts });
const finish = (h) => { checkInvariants(h.b); assert.deepEqual(h.b.errors, []); };
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);

for (const key of ['enemy_1045_hammer', 'enemy_1045_hammer_2', 'enemy_1160_hvyslr', 'enemy_1160_hvyslr_2']) {
  test(`${key}: a lethal stunning strike cannot stun the deployment created by 不屈`, () => {
    const h = makeBattle({ autoFinish: false, timeLimit: 100, defs: { chess: { wall: wall('wall') } },
      units: [{ chessId: 'wall', row: 10, col: 5 }], bonds: { indomShip: bond(300) } });
    const nth = key.includes('hvyslr') ? 4 : 3;
    h.step(); const u = h.unit('wall'); const e = h.spawn(key, { pos: [10, 5], mods: { speedMul: 0 } });
    assert.ok(h.runUntil(() => e.stats.attacks >= nth - 1, 40));
    const seq = u.deploySeq; u.hp = 1;
    assert.ok(h.runUntil(() => e.stats.attacks >= nth, 20));
    assert.ok(u.alive && u.deploySeq > seq, 'the lethal stunning strike immediately redeployed the operator');
    assert.ok(!u.s.flags.stun, 'the old attack cannot put stun on that new deployment');
    // The next stunning strike that does not kill must still stun normally.
    assert.ok(h.runUntil(() => e.stats.attacks >= nth * 2, 40));
    assert.ok(u.s.flags.stun); finish(h);
  });
}

for (const skadi of [false, true]) {
  test(`${skadi ? '浊心斯卡蒂 custom' : 'default'} bard keeps its regeneration while stunned, stops after leaving`, () => {
    const bard = chessRec({ id: 'bard', profession: 'SUPPORT', subProfessionId: 'bard', attackKind: 'none', dmgType: 'heal',
      skill: null, rangeGrid: [[0, 0], [0, 1]], stats: { atk: 1000 } });
    const h = makeBattle({ autoFinish: false, defs: { chess: { bard, wall: wall('wall') } },
      units: [{ chessId: skadi ? 'chess_char_6_04_a' : 'bard', row: 10, col: 4, skillIndex: 1 }, { chessId: 'wall', row: 10, col: 5 }] });
    h.step(); const u = h.b.allyUnits[0], a = h.unit('wall'); a.hp = 100;
    if (skadi) { u.skill.gainSp(999, 'init'); assert.ok(u.skill.activate('test')); }
    h.run(1); const regen = a.s.hpRegen; assert.ok(regen > 0);
    h.b.applyStatus(u, 'stun', { duration: 10 }); h.run(2);
    near(a.s.hpRegen, regen); const hp = a.hp; h.run(1); assert.ok(a.hp > hp);
    h.b.kill(u, null); h.run(1); near(a.s.hpRegen, 0); finish(h);
  });
}

test('黄沙罗盘 + 浓茶 bypass both the active skill lock and noSp, including the caster; ordinary SP still obeys them', () => {
  const op = (id, bonds) => chessRec({ id, bonds, skill: { spCost: 100, initSp: 0, duration: 20 } });
  const h = makeBattle({ autoFinish: false, defs: { chess: { a: op('a', ['sargonShip']), b: op('b', ['sargonShip']), c: op('c', []) } },
    units: [{ chessId: 'a', row: 10, col: 4, items: ['chess_item_6_07_e_a', 'chess_item_2_04_e_a'] },
      { chessId: 'b', row: 11, col: 4 }, { chessId: 'c', row: 12, col: 4 }] });
  h.step(); const a = h.unit('a'), b = h.unit('b'), c = h.unit('c');
  for (const u of [a, b, c]) { u.skill.gainSp(100, 'init'); h.b.addBuff(u, { key: 'test:lock', flags: { noSp: true } }); }
  assert.ok(b.skill.activate('test')); assert.ok(c.skill.activate('test')); assert.ok(a.skill.activate('test'));
  near(a.skill.sp, 3); near(b.skill.sp, 3); near(c.skill.sp, 0);
  near(b.skill.gainSp(5, 'item'), 0); near(b.skill.sp, 3);
  a.skill.end('test'); near(a.skill.sp, 33); finish(h);
});

for (const elite of [false, true]) {
  test(`蕾缪安 S3 real ammo consumption gains active bonds with three operators in the row (${elite ? 'elite' : 'normal'})`, () => {
    const id = `chess_char_6_01_${elite ? 'b' : 'a'}`;
    const h = makeBattle({ autoFinish: false, timeLimit: 120, hooks: ['ammoUsed'],
      defs: { chess: { a: wall('a'), b: wall('b') }, enemies: { dummy } },
      bonds: { lateranoShip: bond(), preciShip: bond() },
      units: [{ chessId: id, row: 10, col: 4 }, { chessId: 'a', row: 10, col: 2 }, { chessId: 'b', row: 10, col: 3 }] });
    h.step(); const u = h.unit(id); h.spawn('dummy', { pos: [10, 6] });
    for (let i = 0; i < 2; i++) { u.skill.gainSp(999, 'init'); assert.ok(u.skill.activate('test')); assert.ok(h.runUntil(() => !u.skill.active, 30)); }
    const spent = h.hooksOf('ammoUsed').filter((c) => c.unit === u).length;
    assert.ok(spent >= 10); const gains = h.result().perPlayer.p1.layerGains;
    for (const b of ['lateranoShip', 'preciShip']) assert.equal(gains[b], Math.floor(spent / 10) * (elite ? 4 : 2), b);
    finish(h);
  });
}

for (const id of ['chess_char_4_23_a', 'chess_char_5_18_a']) {
  test(`${id} 百炼嘉维尔 S2 damages a final boss but cannot pull it`, () => {
    const sharedBoss = { hp: 1e9, maxHp: 1e9, damage(pid, n) { this.hp -= n; } };
    const h = makeBattle({ kind: 'boss', sharedBoss, autoFinish: false, hooks: ['damaged'], captureNoisy: true,
      units: [{ chessId: id, row: 10, col: 3, skillIndex: 1 }] });
    h.step(); const u = h.unit(id);
    const e = h.spawn('enemy_9017_achunt', { pos: [3, 5], tag: 'boss', mods: { speedMul: 0 } });
    e.profile.noAttack = true;
    u.skill.gainSp(999, 'init'); assert.ok(u.skill.activate('test')); h.run(3);
    assert.ok(h.hooksOf('damaged').some((c) => c.source === u && c.target === e), 'S2 actually hits the leader');
    near(e.x, 5); near(e.y, 3);
    // An excessive force isolates the leader exclusion from its ordinary high weight.
    near(h.b.pullToFront(e, u, 99), 0); near(e.x, 5); near(e.y, 3); finish(h);
  });
}
