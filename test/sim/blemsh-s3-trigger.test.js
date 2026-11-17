// test/sim/blemsh-s3-trigger.test.js — 瑕光 (chess_char_3_12) S3 先贤化身 开启条件.
//
// Author video BV1UdAHzNEVj and maintainer confirmation of 2026-10-24: S3 opens with an attackable target in range — the basic strategy, DEFAULT — at full
// HP too ("能攻击到人时就会开技能"), not only after a hit. The data's 重装 skill strategy is TAKE_DAMAGE ("不受技能范围影响，
// 受到伤害时释放技能"), which made a full-HP 瑕光 hold S3 with its SP ready until something damaged her; the kit's spec
// overrides the rule for this skill (server/sim/content/kits/ops/chess_char_3_12-blemsh.js, `trigger: 'DEFAULT'`). The
// trigger condition is the engine's own target search (the DEFAULT rule: acquireTargets / the enemies she blocks).
//
// The three cases: target + full HP + SP ready ⇒ opens (the regression: red before the fix); no target ⇒ stays closed;
// wounded + target ⇒ still opens (the old behaviour kept — no HP condition was added).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { getDefaultSource } from '../../server/sim/simdata.js';

const ds = getDefaultSource();
const ID = 'chess_char_3_12_a';
const SKILL = 'skchr_blemsh_3';
const ROW = 10, COL = 4;
const dummy = (key, o = {}) => enemyRec({ key, hp: 1e7, speed: 0, def: 0, res: 0, ...o });
const noGarrison = (id) => ({ [id]: { ...ds.rawChess(id), garrisonIds: [] } });
const fill = (u) => u.skill.gainSp(u.skill.spCost * u.skill.maxCharges + 1, 'test');

/** 瑕光 deployed alone on (10,4), a step taken, its S3 fully charged. */
function deploy() {
  const h = makeBattle({
    defs: { enemies: { enemy_d: dummy('enemy_d') }, chess: noGarrison(ID) }, seed: 3, autoFinish: false, timeLimit: 30,
    hooks: ['damaged', 'skillStart', 'attack'], captureNoisy: true,
    units: [{ chessId: ID, row: ROW, col: COL }],
  });
  const u = h.unit(ID);
  assert.equal(u.skill.id, SKILL);
  h.step();
  fill(u);
  assert.equal(u.skill.ready, true, 'SP ready');
  return { h, u };
}

test('3_12 瑕光 S3: full HP + a target in range + SP ready ⇒ opens (DEFAULT), on the tick her attack is due', () => {
  const { h, u } = deploy();
  const seen = [];
  h.b.on('skillStart', (c) => { if (c.unit === u) seen.push({ t: h.b.time, hp: u.hp, maxHp: u.s.maxHp, reason: c.reason }); });
  h.spawn('enemy_d', { pos: [ROW, COL + 1] });
  const t0 = h.b.time;
  h.step(); // the target is in range and her attack is due: the same tick, no extra frame
  assert.equal(u.skill.activations, 1, 'S3 opened with a target at full HP (before the fix it waited for a hit)');
  assert.equal(u.skill.rule, 'DEFAULT', 'the kit overrides the 重装 TAKE_DAMAGE row for S3');
  assert.equal(ds.rawChess(ID).skills.find((s) => s.skillId === SKILL).trigger.rawRule, 'TAKE_DAMAGE', 'the source table rule remains available');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].reason, 'DEFAULT');
  assert.equal(seen[0].t, t0, 'the same tick the target appeared — no extra frame');
  assert.ok(seen[0].hp >= seen[0].maxHp - 1e-6, 'at full HP');
  assert.equal(h.hooksOf('damaged').filter((c) => c.target === u).length, 0, 'no hit was taken before the cast');
  checkInvariants(h.b);
  assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0]));
});

test('3_12 瑕光 S3: full HP and SP ready but no target in range ⇒ stays closed', () => {
  const { h, u } = deploy();
  h.run(5);
  assert.equal(u.skill.activations, 0, 'no target: not opened');
  assert.equal(u.skill.active, false);
  assert.equal(u.skill.ready, true, 'its SP stays ready (the target, not the SP, is what it waits for)');
  assert.ok(u.hp >= u.s.maxHp - 1e-6, 'still at full HP');
  checkInvariants(h.b);
  assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0]));
});

test('3_12 瑕光 S3: wounded + a target in range ⇒ opens (the old behaviour kept)', () => {
  const { h, u } = deploy();
  u.hp = u.s.maxHp * 0.3;
  h.spawn('enemy_d', { pos: [ROW, COL + 1] });
  assert.ok(h.runUntil(() => u.skill.activations >= 1, 1), 'opened with a target while hurt');
  assert.equal(u.skill.activations, 1);
  checkInvariants(h.b);
  assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0]));
});
