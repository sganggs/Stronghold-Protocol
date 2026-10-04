// test/sim/feedback3-ammo-bar.test.js — community report #35 (0.1.3): "拉特兰盟约叠层之后蕾缪安3技能锁定敌人消耗的子弹不会实时让技力条一格
// 一格减少，而是最后突然消耗". 拉特兰's skillStart multiplies the bullets (×(1.05 + 0.015 × layers), floored) and 逃犯引渡手续 adds
// one, but the snapshot drew ammoLeft / skill.ammo (the base 5) and the client clamps at 1: the bar stayed full until
// fewer than 5 bullets were left. Now the draining bar is ammoLeft / ammoMax — the most bullets this activation held
// (set at activation, raised by skillStart additions and addAmmo) — so it starts full and every bullet shortens it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { unitTuple } from '../../server/sim/snapshot.js';

const DEFS = { enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 1e7, speed: 0 }) } };
const bar = (u, t) => { const [, , , , , sp, spMax] = unitTuple(u, t); return sp / spMax; };

test('蕾缪安 S3 with 30 拉特兰 layers: the bar starts full and loses one bullet\'s share per lock (base 5 + extras)', () => {
  const seen = [];
  const h = makeBattle({
    defs: DEFS, timeLimit: 200, seed: 7,
    units: [{ chessId: 'chess_char_6_01_a', row: 10, col: 3 }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 5] }],
    bonds: { lateranoShip: { count: 3, active: true, tier: 1, layers: 30 } },
    setup(b) {
      b.on('ammoUsed', ({ unit, left, skill }) => seen.push({ left, max: skill.ammoMax, bar: bar(unit, b.time) }), { priority: -999 });
    },
  });
  const u = h.unit('chess_char_6_01_a');
  assert.equal(u.skill.ammo, 5, 'S3: 5 bullets (attack@trigger_time)');
  assert.ok(h.runUntil(() => u.skill.active, 80));
  assert.ok(h.runUntil(() => !u.skill.active, 30));
  assert.ok(seen.length >= 7, `${seen.length} bullets: 5 × 1.5 floored, + 逃犯引渡手续`);
  const full = seen[0].left + 1;
  for (const s of seen) assert.equal(s.max, full, 'the full mark is the activation\'s real total');
  seen.forEach((s, i) => assert.ok(Math.abs(s.bar - (full - 1 - i) / full) < 0.01, `bullet ${i + 1}: bar ${s.bar.toFixed(3)} = ${full - 1 - i}/${full}`));
  assert.ok(seen[0].bar < 1 - 0.1, 'the first lock already shortens the bar (it used to stay full until < 5 were left)');
  assert.equal(u.skill.ammoMax, 0, 'reset when the skill ends');
  checkInvariants(h.b);
});

test('the full mark follows bullets added mid-skill only above it; without extras the bar is unchanged (n / base)', () => {
  const h = makeBattle({
    defs: DEFS, timeLimit: 200, seed: 7,
    units: [{ chessId: 'chess_char_6_01_a', row: 10, col: 3 }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 5] }],
  });
  const u = h.unit('chess_char_6_01_a');
  h.step(1);
  u.skill.activate('test', { free: true });
  const sk = u.skill;
  assert.equal(sk.ammoMax, sk.ammoLeft);
  const base = sk.ammoMax;
  assert.ok(Math.abs(bar(u, h.b.time) - 1) < 1e-9, 'full at the start');
  sk.ammoLeft -= 2;                                 // two locks
  assert.ok(Math.abs(bar(u, h.b.time) - (base - 2) / base) < 0.01);
  sk.addAmmo(1);                                    // a refill under the mark: the mark stays
  assert.equal(sk.ammoMax, base);
  sk.addAmmo(3);                                    // above it: the mark rises, the bar is full again
  assert.equal(sk.ammoMax, base + 2);
  assert.ok(Math.abs(bar(u, h.b.time) - 1) < 1e-9);
  sk.end('test');
  assert.equal(sk.ammoMax, 0);
});
