import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';

test('Clementia S3 ignores allied erosion bursts but still marks enemy bursts', () => {
  const h = makeBattle({ autoFinish: false, hooks: ['elementBurst'],
    units: [
      { uid: 1, diy: { slot: 6, charId: 'char_4231_clemnt', skillIndex: 2 }, elite: true, row: 10, col: 3 },
      { uid: 2, chessId: 'chess_char_1_02_a', row: 10, col: 4 },
    ], defs: { enemies: { target: enemyRec({ key: 'target', hp: 1e7, atk: 0, speed: 0 }) } },
  });
  h.step();
  const u = h.unit(1), ally = h.unit(2);
  u.skill.gainSp(999, 'test'); assert.ok(u.skill.activate('test'));
  h.b.dealDamage(null, ally, { type: 'element', element: 'erosion', amount: 2000 });
  assert.equal(h.hooksOf('elementBurst').filter(c => c.target === ally).length, 1, 'a real allied burst occurred');
  assert.equal(u.mem.clemntBombs.marks.size, 0, 'friendly injury must not schedule a shot');
  const enemy = h.spawn('target', { pos: [10, 6] });
  h.b.dealDamage(u, enemy, { type: 'element', element: 'erosion', amount: 2000 });
  assert.ok(u.mem.clemntBombs.marks.has(enemy), 'enemy erosion still schedules the bombardment');
  checkInvariants(h.b); assert.deepEqual(h.b.errors, []);
});

for (const skillIndex of [0, 1, 2]) test(`Horn S${skillIndex + 1} can attack an unblockable fragment on her own tile`, () => {
  const h = makeBattle({ autoFinish: false, hooks: ['damaged'], captureNoisy: true,
    units: [{ uid: 1, chessId: 'chess_char_5_08_a', skillIndex, row: 10, col: 3 }],
    defs: { enemies: { fragment: enemyRec({ key: 'fragment', hp: 1e7, atk: 0, speed: 0 }) } },
  });
  h.step();
  const u = h.unit(1), e = h.spawn('fragment', { pos: [10, 3] });
  h.b.addBuff(e, { key: 'test:fragment', persist: true, flags: { unblockable: true } });
  u.skill.gainSp(999, 'test'); h.run(4);
  assert.equal(u.blocking.length, 0, 'the target cannot be blocked');
  assert.ok(e.hp < e.s.maxHp, 'her extra melee range includes her own tile');
  assert.ok(u.skill.activations > 0, 'a target on that tile also satisfies skill automation');
  checkInvariants(h.b); assert.deepEqual(h.b.errors, []);
});

test('bounty catapult normal triple attack splashes adjacent and diagonal allies within 1.5 tiles', () => {
  const rec = (id, tauntLevel = 0) => chessRec({ id, stats: { maxHp: 1e6, atk: 0, def: 0, blockCnt: 0, tauntLevel }, skill: null });
  const h = makeBattle({ autoFinish: false, flags: { dpInit: 999 },
    defs: { chess: { target: rec('target', 5), bystander: rec('bystander') } },
    units: [
      { uid: 1, chessId: 'target', row: 10, col: 5 },
      { uid: 2, chessId: 'bystander', row: 10, col: 6 },
      { uid: 3, chessId: 'bystander', row: 11, col: 6 },
      { uid: 4, chessId: 'bystander', row: 12, col: 7 },
    ],
  });
  h.step();
  const e = h.spawn('enemy_10162_mnctpt', { pos: [10, 8], mods: { speedMul: 0 } });
  assert.ok(h.runUntil(() => h.unit(1).hp < h.unit(1).s.maxHp, 10), 'the primary attack reaches its target');
  const one = e.s.atk;
  for (const uid of [1, 2, 3]) assert.equal(h.unit(uid).s.maxHp - h.unit(uid).hp, one, `unit ${uid}: the first stone lands alone`);
  h.run(0.7);
  for (const uid of [1, 2, 3]) assert.equal(h.unit(uid).s.maxHp - h.unit(uid).hp, one * 3, `unit ${uid}: all three stones`);
  assert.equal(h.unit(4).hp, h.unit(4).s.maxHp, 'beyond the splash');
  checkInvariants(h.b); assert.deepEqual(h.b.errors, []);
});

for (const skillIndex of [0, 1, 2]) test(`Horn S${skillIndex + 1} retains melee splash only for S2 and leaves adjacent blind tiles untargeted`, () => {
  const h = makeBattle({ autoFinish: false, units: [{ uid: 1, chessId: 'chess_char_5_08_a', skillIndex, row: 10, col: 3 }],
    defs: { enemies: { fragment: enemyRec({ key: 'fragment', hp: 1e7, atk: 0, speed: 0 }) } },
  });
  h.step(); const u = h.unit(1);
  const own = h.spawn('fragment', { pos: [10, 3] }), near = h.spawn('fragment', { pos: [10, 4] });
  for (const e of [own, near]) h.b.addBuff(e, { key: 'test:fragment', persist: true, flags: { unblockable: true } });
  u.skill.gainSp(999, 'test'); h.run(4);
  assert.ok(own.hp < own.s.maxHp);
  assert.equal(near.hp < near.s.maxHp, skillIndex === 1, 'only S2 grants splash to melee attacks');
  h.b.kill(own, null); const hp = near.hp; h.run(4);
  assert.equal(near.hp, hp, 'the adjacent blind tile does not become an attack target');
  checkInvariants(h.b); assert.deepEqual(h.b.errors, []);
});

test('Horn prioritizes her ordinary ranged targets over an unblockable enemy on her own tile', () => {
  const h = makeBattle({ autoFinish: false, units: [{ uid: 1, chessId: 'chess_char_5_08_a', row: 10, col: 3 }],
    defs: { enemies: { fragment: enemyRec({ key: 'fragment', hp: 1e7, atk: 0, speed: 0 }) } },
  });
  h.step();
  const own = h.spawn('fragment', { pos: [10, 3] }), far = h.spawn('fragment', { pos: [10, 6] });
  h.b.addBuff(own, { key: 'test:fragment', persist: true, flags: { unblockable: true } });
  h.run(4);
  assert.ok(far.hp < far.s.maxHp); assert.equal(own.hp, own.s.maxHp);
  checkInvariants(h.b); assert.deepEqual(h.b.errors, []);
});

test('Horn changing to melee does not remove splash from an already flying shell', () => {
  const h = makeBattle({ autoFinish: false, hooks: ['attack'], captureNoisy: true, units: [{ uid: 1, chessId: 'chess_char_5_08_a', skillIndex: 2, row: 10, col: 3 }],
    defs: { enemies: { dummy: enemyRec({ key: 'dummy', hp: 1e7, atk: 0, speed: 0 }) } },
  });
  h.step(); const u = h.unit(1);
  h.b.addBuff(u, { key: 'test:fast', persist: true, mods: { aspd: 500 } });
  u.skill.gainSp(999, 'test'); assert.ok(u.skill.activate('test'));
  const far = h.spawn('dummy', { pos: [10, 8] }), side = h.spawn('dummy', { pos: [11, 8] });
  assert.ok(h.runUntil(() => h.hooksOf('attack').some(c => c.attacker === u), 1));
  h.spawn('dummy', { pos: [10, 3] }); h.run(0.4);
  assert.ok(h.hooksOf('attack').filter(c => c.attacker === u).length >= 2, 'a melee attack follows before the shell lands');
  assert.ok(far.hp < far.s.maxHp); assert.equal(side.s.maxHp - side.hp, far.s.maxHp - far.hp);
  checkInvariants(h.b); assert.deepEqual(h.b.errors, []);
});

for (const hidden of [false, true]) test(`${hidden ? 'hidden' : 'final'} Helm actually fires a shell which stuns the target's 3×3 area`, () => {
  const rec = (id, atk) => chessRec({ id, stats: { atk, maxHp: 1e7, blockCnt: 0 }, skill: null });
  const h = makeBattle({ kind: hidden ? 'hidden' : 'boss', autoFinish: false, timeLimit: 90, flags: { dpInit: 999 },
    hooks: ['statusApplied'], defs: { chess: { main: rec('main', 900), bystander: rec('bystander', 0) } },
    kits: { main: () => ({ trait: { noAttack: true } }), bystander: () => ({ trait: { noAttack: true } }) },
    units: [{ uid: 1, chessId: 'main', row: 10, col: 6 }, { uid: 2, chessId: 'bystander', row: 9, col: 5 },
      { uid: 3, chessId: 'bystander', row: 11, col: 7 }, { uid: 4, chessId: 'bystander', row: 12, col: 3 }],
  });
  h.step();
  // 灭顶之灾 takes an attack's turn (DESIGN §35.29): the leader attacks
  h.spawn(hidden ? 'enemy_9013_acstmk_2' : 'enemy_9013_acstmk', { pos: [3, 10], tag: 'boss', mods: { speedMul: 0 } });
  assert.ok(h.runUntil(() => h.b.enemies.some(e => e.defId === 'enemy_9016_acstmr'), 60), 'shell was fired');
  assert.ok(h.runUntil(() => h.hooksOf('statusApplied').some(c => c.target === h.unit(1) && c.status === 'stun'), 25), 'shell arrived');
  const stunned = new Set(h.hooksOf('statusApplied').filter(c => c.status === 'stun').map(c => c.target.uid));
  for (const uid of [1, 2, 3]) assert.ok(stunned.has(uid), `3×3 includes ${uid}`);
  assert.ok(!stunned.has(4), 'outside the 3×3'); checkInvariants(h.b); assert.deepEqual(h.b.errors, []);
});
