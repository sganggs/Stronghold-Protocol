// A second 寒冷 used to apply a fixed 3 s 冻结 (COLD_FREEZE_DURATION) whatever the two colds lasted.
// PRTS 术语释义 寒冷 (id ba.cold): 友方寒冷 pairs into 友方冻结, 「持续时间取双方之中最高」. The cold that remains is
// already max(remaining, incoming) via addBuff refresh 'extend'; the freeze in the same moment must match it.
// 抵抗 shortens the incoming duration before that max. A frozen-immune enemy still gets no freeze.
// [ASSUMED] the engine's one cold uses that 友方 sentence for an enemy-applied cold too (PRTS states the max on
// the 友方 line only). gamedata_const ba.cold names the freeze and not its length.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec } from '../helpers/battleHarness.js';
import { hasGeneratedData } from '../../server/sim/simdata.js';

const REAL = { skip: !hasGeneratedData() };
const close = (a, b, eps, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} expected ${b} ± ${eps}, got ${a}`);

function coldBattle(extra = {}) {
  return makeBattle({
    defs: { enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 1e6, speed: 0, res: 30 }) } },
    enemies: [{ key: 'enemy_dummy', pos: [11, 8] }],
    content: 'none', autoFinish: false, timeLimit: 60,
    ...extra,
  });
}

test('cold 10s then immediately another cold 1s → freeze lasts about 10s, not 3', () => {
  const h = coldBattle();
  h.step();
  const e = h.enemy('enemy_dummy');
  h.b.applyStatus(e, 'cold', { duration: 10 });
  h.b.applyStatus(e, 'cold', { duration: 1 });
  close(e.findBuff('cold').timeLeft, 10, 1e-6, 'the shorter cold does not replace the longer one');
  close(e.findBuff('freeze').timeLeft, 10, 1e-6, 'freeze');
  assert.equal(e.s.res, 15, 'frozen: RES −15');
  h.run(3.2);
  assert.ok(e.s.flags.freeze, 'still frozen past the old fixed 3 s');
  h.run(7);
  assert.ok(!e.s.flags.freeze, 'ends with the 10 s cold');
  assert.equal(e.s.res, 30);
});

test('cold 1s then cold 8s → freeze lasts about 8s, not 3', () => {
  const h = coldBattle();
  h.step();
  const e = h.enemy('enemy_dummy');
  h.b.applyStatus(e, 'cold', { duration: 1 });
  h.b.applyStatus(e, 'cold', { duration: 8 });
  close(e.findBuff('cold').timeLeft, 8, 1e-6);
  close(e.findBuff('freeze').timeLeft, 8, 1e-6);
  h.run(3.2);
  assert.ok(e.s.flags.freeze, 'still frozen past 3 s');
  h.run(5);
  assert.ok(!e.s.flags.freeze, 'ends with the 8 s cold');
});

test('a shorter second cold does not shorten a longer remaining cold\'s freeze', () => {
  const h = coldBattle();
  h.step();
  const e = h.enemy('enemy_dummy');
  h.b.applyStatus(e, 'cold', { duration: 10 });
  h.run(6);
  const remain = e.findBuff('cold').timeLeft;
  assert.ok(remain > 3.5 && remain < 4.5, `about 4 s left, got ${remain}`);
  h.b.applyStatus(e, 'cold', { duration: 1 });
  close(e.findBuff('cold').timeLeft, remain, 1e-6, 'cold');
  close(e.findBuff('freeze').timeLeft, remain, 1e-6, 'freeze follows the remaining cold, not 1 s and not 3 s');
  h.run(3.2);
  assert.ok(e.s.flags.freeze, 'a 1 s or 3 s freeze would have ended');
  h.run(1.2);
  assert.ok(!e.s.flags.freeze);
});

test('抵抗 still shortens the incoming duration before the max', () => {
  const h = coldBattle({ hooks: ['statusApplied'] });
  h.step();
  const e = h.enemy('enemy_dummy');
  h.b.applyStatus(e, 'cold', { duration: 2 });
  h.b.applyStatus(e, 'resist', { value: 0.5 });
  h.b.applyStatus(e, 'cold', { duration: 10 });
  // incoming 10 × (1 − 0.5) = 5, remaining 2 → both cold and freeze are 5, not 10 and not 2.5
  close(e.findBuff('cold').timeLeft, 5, 1e-6, 'cold');
  close(e.findBuff('freeze').timeLeft, 5, 1e-6, 'freeze');
  const freeze = h.hooksOf('statusApplied').filter((c) => c.target === e && c.status === 'freeze');
  assert.equal(freeze.length, 1);
  close(freeze[0].duration, 5, 1e-9, 'the reported freeze duration');
  h.run(3.2);
  assert.ok(e.s.flags.freeze, 'not halved a second time down to 2.5 s');
  h.run(2);
  assert.ok(!e.s.flags.freeze, 'not the unresisted 10 s');
});

test('a frozen-immune enemy gets the second cold and no freeze', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_icy: enemyRec({ key: 'enemy_icy', hp: 1e6, speed: 0, immunities: { frozen: true } }) } },
    enemies: [{ key: 'enemy_icy', pos: [10, 8] }],
    content: 'none', autoFinish: false,
  });
  h.step();
  const icy = h.enemy('enemy_icy');
  h.b.applyStatus(icy, 'cold', { duration: 10 });
  h.b.applyStatus(icy, 'cold', { duration: 1 });
  assert.ok(icy.s.flags.cold);
  close(icy.findBuff('cold').timeLeft, 10, 1e-6, 'the colds still take the longer duration');
  assert.equal(icy.findBuff('freeze'), null);
  assert.ok(!icy.s.flags.freeze);
});

test('吉兆飞鳞: the stun when a freeze ends follows the longer or shorter cold, not a fixed 3 s', REAL, () => {
  const run = (first, second) => {
    const h = makeBattle({
      autoFinish: false, timeLimit: 40, hooks: ['statusApplied'],
      enemies: [{ key: 'enemy_10045_parrot', pos: [10, 6], mods: { speedMul: 0, hpMul: 100 } }],
    });
    h.step();
    const e = h.enemy('enemy_10045_parrot');
    h.b.applyStatus(e, 'cold', { duration: first });
    h.b.applyStatus(e, 'cold', { duration: second });
    const want = Math.max(first, second);
    close(e.findBuff('freeze').timeLeft, want, 1e-6, `freeze ${first} then ${second}`);
    h.run(3.2);
    const early = h.hooksOf('statusApplied').filter((c) => c.target === e && c.status === 'stun');
    if (want > 3.2) {
      assert.ok(e.s.flags.freeze, 'still frozen at 3.2 s');
      assert.equal(early.length, 0, '失温坠落 has not fired at the old 3 s mark');
    }
    h.run(want - 3.2 + 0.3);
    assert.ok(!e.s.flags.freeze, 'the freeze has ended');
    const stuns = h.hooksOf('statusApplied').filter((c) => c.target === e && c.status === 'stun');
    // the 0.05 s 【失温坠落】 stun is what the freeze's end applies; its own status hook then grounds the bird
    // (Stun.duration, 8 s). The harness hears the 8 s one first because that hook runs inside the 0.05 s emit.
    assert.ok(stuns.some((c) => Math.abs(c.duration - 0.05) < 1e-6), `【失温坠落】 0.05 s stun, got ${stuns.map((c) => c.duration)}`);
    return h;
  };
  run(1, 1);   // shorter than the old 3 s: the stun is not held until 3 s
  run(10, 1);  // longer than 3 s: no stun at 3 s, stun when the 10 s freeze ends
});
