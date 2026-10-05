// test/sim/feedback2-forced-exit-down.test.js — GitHub #60 「42突袭死后会消失」 (42 = 史尔特尔): every operator that leaves
// the field lies down on its tile and redeploys there — PRTS 卫戍协议/帮助 §作战阶段 单位部署: "干员退场后，将返回隐藏的待部署区，
// 并原地留下一个“倒地干员”以供查看信息，满足再部署条件时，移除场上的该倒地干员并自动部署至该位置。" (the owner's decision of
// 2026-10-04). A forced exit — 史尔特尔's 余烬 (8 s after the lethal blow), 耀骑士临光 S2's withdrawal, the 骑士戒律 + 竞技旗
// combo, 伊内丝 S3's first deployment, a 商人 that cannot pay — used to leave no body and no ring and to come back on the
// board tile (Battle.isDown took only 'killed' / FORCED_EXIT); it still is no kill. The 突袭 retreat ('raid') redeploys at
// once and leaves nothing; a real knock-out is unchanged.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeBattle, enemyRec } from '../helpers/battleHarness.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const chess = JSON.parse(readFileSync(path.join(ROOT, 'data/chess.json'), 'utf8'));
const SURTR = 'chess_char_5_07_a', NEARL2 = 'chess_char_6_17_a', INSIDE = 'chess_char_1_01_a';
const DUMMY = { enemy_far: enemyRec({ key: 'enemy_far', hp: 1e9, speed: 0, atk: 0 }) };
const approx = (a, b, msg, eps = 0.05) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);
const RAID = { raidShip: { count: 2, active: true, tier: 1, layers: 10 } };

function field(units, bonds = {}) {
  return makeBattle({ defs: { enemies: DUMMY }, units, bonds, enemies: [{ key: 'enemy_far', pos: [12, 8] }], autoFinish: false, timeLimit: 300, hooks: ['death', 'kill', 'deploy'] });
}
const downOf = (h, u) => (h.b.snapshot().down || []).find((d) => d[0] === u.id) ?? null;

/** Lethal blow on 史尔特尔: 余烬 holds her at 1 HP, then forces her out 8 s later. */
function ember(h, u) {
  h.b.dealDamage(null, u, { amount: 1e9, type: 'true' });
  assert.ok(u.alive && u.hp >= 1, '余烬 holds her at 1 HP');
  assert.ok(h.runUntil(() => !u.alive, 10), 'forced out');
  assert.equal(u.removeReason, 'retreat');
}

test('史尔特尔 after 余烬 lies down on her tile (b.snap down, field meta) and redeploys there after 70 s — no kill', () => {
  const h = field([{ chessId: SURTR, row: 10, col: 3, dir: 'RIGHT' }]);
  const u = h.unit(SURTR);
  h.run(1);
  ember(h, u);
  assert.ok(h.b.isDown(u));
  const d = downOf(h, u);
  assert.ok(d, 'the 倒地干员 and its redeploy ring');
  assert.deepEqual(d.slice(4), [10, 3]);
  approx(d[2], 70, 'her redeploy time');
  assert.ok(h.b.fieldMeta().units.some((x) => x.id === u.id), 'a client joining late draws her down');
  assert.equal(h.hooksOf('kill').filter((c) => c.victim === u).length, 0, 'no knock-out hooks');
  assert.deepEqual(h.hooksOf('death').filter((c) => c.unit === u).map((c) => c.reason), ['retreat']);
  assert.equal(h.b.result().perPlayer.p1.deaths, 0, 'no knock-down counted');
  h.b.getPlayer(u.ownerId).dp = 99;
  const out = u.deathAt;
  assert.ok(h.runUntil(() => u.alive, 75));
  approx(h.b.time - out, 70, 'back after her redeploy time', 0.1);
  assert.deepEqual([u.tileR, u.tileC], [10, 3]);
  assert.equal(downOf(h, u), null);
  h.invariants();
});

test('史尔特尔 with 突袭: forced out after her jump she lies on the landing tile and comes back there, not on her board tile', () => {
  const h = field([{ chessId: SURTR, row: 10, col: 3, dir: 'RIGHT' }], RAID);
  const u = h.unit(SURTR);
  assert.ok(h.runUntil(() => u.tileR !== u.homeR || u.tileC !== u.homeC, 30), 'jumped');
  const at = [u.tileR, u.tileC];
  ember(h, u);
  assert.deepEqual(downOf(h, u)?.slice(4), at, 'down where she stood');
  assert.ok(h.b.isReservedTile(at[0], at[1]), 'no ally lands on her body');
  h.b.getPlayer(u.ownerId).dp = 99;
  const n = h.hooksOf('deploy').filter((c) => c.unit === u).length;
  assert.ok(h.runUntil(() => u.alive, 75));
  assert.equal(h.hooksOf('deploy').filter((c) => c.unit === u).length, n + 1);
  assert.deepEqual([u.tileR, u.tileC], at, 'redeployed on that tile (it used to be her board tile)');
  assert.deepEqual([u.homeR, u.homeC], [10, 3], 'her home is unchanged');
});

test('耀骑士临光 S2: withdrawn at the skill end, she lies down on her tile with the ×1.25 redeploy ring and comes back there', () => {
  const idx = chess[NEARL2].skills.findIndex((s) => (s.skillId ?? s.id) === 'skchr_nearl2_2');
  assert.ok(idx >= 0);
  const h = field([{ chessId: NEARL2, row: 10, col: 4, skillIndex: idx }]);
  const u = h.unit(NEARL2);
  h.step();
  assert.ok(u.alive && u.skill.active, 'S2 on deploy');
  assert.ok(h.runUntil(() => !u.alive, 40), 'withdraws when the skill ends');
  assert.equal(u.removeReason, 'retreat');
  const d = downOf(h, u);
  assert.deepEqual(d?.slice(4), [10, 4]);
  approx(d[2], u.base.respawnTime * 1.25, 'this redeploy ×1.25', 0.02);
  assert.equal(h.hooksOf('kill').filter((c) => c.victim === u).length, 0);
  h.b.getPlayer(u.ownerId).dp = 99;
  assert.ok(h.runUntil(() => u.alive, d[2] + 2));
  assert.deepEqual([u.tileR, u.tileC], [10, 4]);
});

test('a real knock-out is unchanged: down on its tile, the kill hooks and the knock-down count', () => {
  const h = field([{ chessId: INSIDE, row: 10, col: 3, dir: 'RIGHT' }]);
  const u = h.unit(INSIDE);
  h.run(1);
  h.b.dealDamage(null, u, { amount: 1e9, type: 'true' });
  assert.ok(!u.alive);
  assert.equal(u.removeReason, 'killed');
  assert.deepEqual(downOf(h, u)?.slice(4), [10, 3]);
  assert.equal(h.hooksOf('kill').filter((c) => c.victim === u).length, 1);
  assert.equal(h.b.result().perPlayer.p1.deaths, 1);
});
