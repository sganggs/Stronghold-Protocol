// 凋亡: 15 s, −1 SP/s. PRTS 技能 counts stored charges as part of the total SP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec } from '../helpers/battleHarness.js';

function arena(spec = {}) {
  const h = makeBattle({
    content: 'generic', captureNoisy: true, hooks: ['spGain', 'damaged'],
    // Disable natural recovery so the SP assertion after expiry observes only the 15 loss ticks.
    defs: { chess: { t_op: chessRec({ id: 't_op', skill: spec === null ? null : {}, stats: { maxHp: 10000, res: 0, spRecovery: 0 } }) } },
    units: [{ chessId: 't_op', row: 10, col: 4 }],
    kits: { t_op: () => ({ trait: { noAttack: true }, skill: spec === null ? null : {
      kind: 'duration', duration: 30, spCost: 20, initSp: 0, trigger: 'NEVER', ...spec,
    } }) },
  });
  h.b.start();
  const u = h.unit('t_op');
  return { h, u, sk: u.skill };
}

function burst(h, u) {
  h.b.dealDamage(null, u, { type: 'element', element: 'apoptosis', amount: u.gaugeMax });
  assert.ok(u.findBuff('apoptosisBurst'), 'real element damage triggers 凋亡');
  assert.equal(u.s.flags.noSp, true);
  assert.equal(u.s.flags.silence, true);
}

function expectSp(sk, total, charges, sp, ready) {
  assert.equal(sk.spTotal, total, 'total SP includes stored charges');
  assert.equal(sk.charges, charges, 'stored charges match remaining total SP');
  assert.equal(sk.sp, sp, 'SP bar matches remaining total SP');
  assert.equal(sk.ready, ready, 'readiness matches remaining charges');
}

test('凋亡 drains a full ordinary skill once per second for 15 s and removes its ready charge', () => {
  const { h, u, sk } = arena();
  sk.setSpTotal(20);
  expectSp(sk, 20, 1, 20, true);
  burst(h, u);
  const hp = u.hp;
  assert.equal(sk.gainSp(10, 'granted'), 0, '阻回 still prevents SP recovery');
  h.step(29);
  expectSp(sk, 20, 1, 20, true);
  assert.equal(u.hp, hp, 'no damage or SP loss before the first second');
  h.step();
  expectSp(sk, 19, 0, 19, false);
  for (let second = 1; second <= 15; second++) {
    if (second > 1) h.run(1);
    expectSp(sk, 20 - second, 0, 20 - second, false);
    assert.equal(u.hp, hp - second * 100, '100 arts damage each second');
    if (second < 15) {
      assert.equal(u.s.flags.noSp, true);
      assert.equal(u.s.flags.silence, true);
    }
  }
  assert.ok(!u.findBuff('apoptosisBurst'), 'burst expires after 15 seconds');
  assert.ok(!u.s.flags.noSp && !u.s.flags.silence);
  h.run(1);
  expectSp(sk, 5, 0, 5, false);
  assert.equal(u.hp, hp - 1500, 'no extra tick after expiry');
  const hits = h.hooksOf('damaged').filter((c) => c.type === 'arts');
  assert.equal(hits.length, 15);
  assert.ok(hits.every((c) => c.amount === 100));
  assert.equal(h.hooksOf('spGain').length, 0, 'SP loss does not emit a gain hook');
  h.invariants();
});

for (const [total, charges, sp, ready] of [
  [30, 2, 9, true],   // full: the displayed SP bar is not extra SP
  [20, 1, 9, true],   // partially charged with an empty SP bar
  [20.5, 1, 9.5, true],
  [10, 0, 9, false],  // spending the final stored charge clears readiness
]) {
  test(`凋亡 drains stored charges at ${total} / 30 total SP`, () => {
    const { h, u, sk } = arena({ kind: 'charges', spCost: 10, charges: 3 });
    sk.setSpTotal(total);
    burst(h, u);
    h.run(1);
    expectSp(sk, total - 1, charges, sp, ready);
    if (total === 30) {
      h.run(9);
      expectSp(sk, 20, 2, 0, true);
      h.run(1);
      expectSp(sk, 19, 1, 9, true);
      h.run(4);
      expectSp(sk, 15, 1, 5, true);
    }
    assert.equal(h.hooksOf('spGain').length, 0);
    h.invariants();
  });
}

for (const kind of ['duration', 'charges']) {
  for (const total of [0.5, 0]) {
    test(`凋亡 clamps ${kind} skill with ${total} SP to zero`, () => {
      const { h, u, sk } = arena({ kind, charges: kind === 'charges' ? 3 : 1 });
      sk.setSpTotal(total);
      burst(h, u);
      h.run(2);
      expectSp(sk, 0, 0, 0, false);
      assert.equal(h.hooksOf('spGain').length, 0);
      h.invariants();
    });
  }
}

for (const kind of ['duration', 'ammo', 'toggle']) {
  test(`凋亡 leaves SP and stored charges unchanged during an active ${kind} skill`, () => {
    const { h, u, sk } = arena({ kind, ammo: 5, charges: 3 });
    sk.setSpTotal(50);
    assert.equal(sk.activate(), true);
    expectSp(sk, 30, 1, 10, true);
    burst(h, u);
    h.run(2);
    assert.equal(sk.active, true);
    expectSp(sk, 30, 1, 10, true);
    assert.equal(h.hooksOf('spGain').length, 0);
    h.invariants();
  });
}

test('凋亡 leaves passives and already-spent free skills unchanged', () => {
  for (const kind of ['passive', 'instant']) {
    const { h, u, sk } = arena({ kind, spCost: 0 });
    if (kind === 'instant') assert.equal(sk.activate(), true);
    expectSp(sk, 0, 0, 0, false);
    burst(h, u);
    h.run(2);
    expectSp(sk, 0, 0, 0, false);
    assert.equal(sk.active, kind === 'passive');
    assert.equal(h.hooksOf('spGain').length, 0);
    h.invariants();
  }
});

test('凋亡 still deals its damage to a unit without a skill', () => {
  const { h, u, sk } = arena(null);
  assert.equal(sk.noSkill, true);
  burst(h, u);
  h.run(2);
  expectSp(sk, 0, 0, 0, false);
  assert.equal(u.hp, 9800);
  assert.equal(h.hooksOf('spGain').length, 0);
  assert.deepEqual(h.b.errors, []);
  h.invariants();
});
