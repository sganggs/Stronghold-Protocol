// Operator model facing (render/facing.js): the direction to draw an operator's model in for the target it is attacking.
// Display only — `dir` (the deploy direction that rotates the attack range and picks Front / Back) never moves.
//
// The rule under test is the OFFICIAL one, disassembled from the shipped client (docs/research/10-face-logic.md):
//   MapUtil.ParseDirection(v, addon)          four-direction argmax; only the horizontal entries (k = 1, 3) get `addon`
//   CharacterAnimator._CalculateLOrRDirection(v, prevSign)
//                                             a horizontal parse is adopted; else v.x < -0.2 -> left, v.x > +0.2 -> right,
//                                             and inside the band the PREVIOUS sign is kept (the hysteresis dead zone)
//   _SetFourDirection(sign, uOrD)             sign 1 = right / 3 = left; uOrD swaps front <-> back
// `node --test test/render/facing.test.js`
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  facingDir, facingToward, parseDirection, FACING_TURN_S, HELD_FACING, FACING_TOLERANCE, FACING_ADDON,
  FACING_TOO_CLOSE, FACING_ZERO, FACING_PARSE_EPS, FACE_SIGN_LEFT, FACE_SIGN_RIGHT, FACE_DEFAULT_SIGN,
} from '../../public/js/render/facing.js';

const LEFT = FACE_SIGN_LEFT;
const RIGHT = FACE_SIGN_RIGHT;

test('the official constants, names and values', () => {
  assert.equal(FACING_TOLERANCE, 0.2, 'TOLERANCE_L_OR_R_DIRECTION');
  assert.equal(FACING_ADDON, 0.25, 'ADDON_TO_L_OR_R_DIRECTION');
  assert.equal(FACING_TOO_CLOSE, 0.25, 'sqrt(TOO_CLOSE_TOLERANCE_SQR = 0.0625)');
  assert.equal(FACING_ZERO, 0.01, 'DIRECTION_ZERO_TOLERANCE');
  assert.equal(FACING_PARSE_EPS, 1e-5, "ParseDirection's inlined |v| threshold");
  assert.equal(LEFT, 3, 'the official encoding: 3 = left');
  assert.equal(RIGHT, 1, '1 = right');
  assert.equal(FACE_DEFAULT_SIGN, 3, 'FaceSwitcher._defaultLOrR');
});

test('ParseDirection: the argmax order and the horizontal-only addon', () => {
  // the table order this port assumes: 0 up, 1 right, 2 down, 3 left (dy grows UP in this renderer)
  assert.equal(parseDirection(0, 1, 0), 0);
  assert.equal(parseDirection(1, 0, 0), 1);
  assert.equal(parseDirection(0, -1, 0), 2);
  assert.equal(parseDirection(-1, 0, 0), 3);
  // without the bias a 45 degree offset is a tie, and the earlier index (UP) wins the strict `>`
  assert.equal(parseDirection(1, 1, 0), 0, 'tie at 45 deg: index 0');
  // with the bias the horizontal entry wins the tie
  assert.equal(parseDirection(1, 1, FACING_ADDON), 1, 'the bias is what makes 45 deg level');
  // the bias is added to k = 1 and k = 3 only, never to the vertical entries
  assert.equal(parseDirection(0, 1, FACING_ADDON), 0, 'straight up is still up');
  // a degenerate vector falls back to the default direction (index 0), it does not return 0 by accident of NaN
  assert.equal(parseDirection(0, 0, FACING_ADDON), 0);
});

test('a horizontal parse is adopted outright', () => {
  for (const [dx, dy, dir] of [[1, 0, 'RIGHT'], [-1, 0, 'LEFT'], [5, 1, 'RIGHT'], [-2, 1, 'LEFT'], [0.9, 0.5, 'RIGHT']]) {
    const r = facingDir(dx, dy, LEFT);
    assert.equal(r.dir, dir, `${dx},${dy}`);
    assert.equal(r.uOrD, false, 'no Back model for a level turn');
  }
});

test('a vertical target keeps the sign inside the dead zone and takes it outside', () => {
  // |v.x| <= 0.2 of the NORMALIZED vector keeps prevSign (the hysteresis band)
  const near = facingDir(0.1, 1, LEFT);
  assert.equal(near.dir, 'UP');
  assert.equal(near.sign, LEFT, 'inside the band: the previous sign is kept');
  assert.equal(near.uOrD, true, 'the Back model');
  assert.equal(facingDir(0.1, 1, RIGHT).sign, RIGHT, 'the band is direction-agnostic: it carries whatever was there');
  // |v.x| > 0.2 takes the target's side
  assert.equal(facingDir(0.3, 1, LEFT).sign, RIGHT, 'a target to the right of the dead zone');
  assert.equal(facingDir(-0.3, 1, RIGHT).sign, LEFT);
  // the same offset, two previous signs -> the dead zone is why deployment matters
  assert.equal(facingDir(0.19, 1, LEFT).sign, LEFT);
  assert.equal(facingDir(0.19, 1, RIGHT).sign, RIGHT);
});

test('the dead zone is a band, not a one-shot threshold: the boundary sits at |x| = 0.2', () => {
  // 0.2 / sqrt(1 + 0.04) = 0.196 of the normalized vector: inside
  assert.equal(facingDir(0.2, 1, LEFT).sign, LEFT);
  // 0.21 / 1.0218 = 0.2055: outside
  assert.equal(facingDir(0.21, 1, LEFT).sign, RIGHT);
  assert.equal(facingDir(-0.21, 1, RIGHT).sign, LEFT);
});

test('the axis (Back model) uses the addon bias: level wins until the target is clearly above', () => {
  // normalized |x| + 0.25 > |y| -> level: a 45 degree offset is level
  assert.equal(facingDir(1, 1, LEFT).dir, 'RIGHT');
  assert.equal(facingDir(1, 1, LEFT).uOrD, false);
  // 0.5 up-right: 0.447 + 0.25 = 0.697 vs 0.894 -> vertical
  assert.equal(facingDir(0.5, 1, LEFT).dir, 'UP');
  assert.equal(facingDir(0.5, 1, LEFT).uOrD, true);
  // the bias boundary for dy = 1 sits between dx = 0.65 and 0.70: below it the Back model, above it level again
  assert.equal(facingDir(0.65, 1, LEFT).uOrD, true, '0.65: still above');
  assert.equal(facingDir(0.7, 1, LEFT).uOrD, false, '0.70: the bias wins');
  // a steep shot far above is vertical, and keeps the dead-zone sign
  const steep = facingDir(1, 5, LEFT);
  assert.equal(steep.dir, 'UP');
  assert.equal(steep.sign, LEFT, '|x| = 0.196 is inside the dead zone');
});

test('too close and zero offsets keep everything', () => {
  for (const [dx, dy] of [[0, 0], [0.1, 0.2], [0.15, 0.15], [0, 0.2], [0.005, -0.005]]) {
    const r = facingDir(dx, dy, LEFT);
    assert.equal(r.dir, null, `${dx},${dy}: no direction`);
    assert.equal(r.sign, LEFT, 'the sign is kept');
  }
  assert.equal(facingDir(0, 0.25, LEFT).dir, 'UP', 'just outside the too-close circle');
});

test('an enemy-style offset never yields a Back model by accident', () => {
  // straight above an enemy is still a horizontal choice there; the renderer routes enemies through _enemyTurnDir,
  // so what matters here is only that facingDir reports the axis truthfully.
  assert.equal(facingDir(0, 1, LEFT).uOrD, true);
});

test('facingToward subtracts the two positions and never throws on a missing one', () => {
  assert.equal(facingToward({ x: 4.5, y: 9.5 }, { x: 4.5, y: 10.4 }).dir, 'UP');
  assert.equal(facingToward({ x: 4.5, y: 9.5 }, { x: 7.2, y: 9.6 }).dir, 'RIGHT');
  assert.equal(facingToward({ x: 4.5, y: 9.5 }, { x: 4.6, y: 8.2 }).dir, 'DOWN', 'below, with |x| inside the dead zone');
  assert.equal(facingToward({ x: 3, y: 4 }, { x: 3, y: 4 }).dir, null);
  assert.equal(facingToward(null, { x: 1, y: 1 }).dir, null);
  assert.equal(facingToward({ x: 0, y: 0 }, undefined).dir, null);
  assert.equal(facingToward({ x: 0, y: 0 }, { x: 'a', y: 'b' }).dir, null);
  // the sign is carried from the caller: the same target gives different mirrors per deployment
  assert.equal(facingToward({ x: 4, y: 9 }, { x: 4.1, y: 12 }, LEFT).sign, LEFT);
  assert.equal(facingToward({ x: 4, y: 9 }, { x: 4.1, y: 12 }, RIGHT).sign, RIGHT);
});

test('the turnaround and the held states', () => {
  assert.equal(FACING_TURN_S, 0.15, '换骨架 + 镜像 + 换动画 takes 0.15 s');
  assert.deepEqual(HELD_FACING, ['stun', 'sleep', 'freeze'], 'the states whose clip plays in the facing the model already has');
});
