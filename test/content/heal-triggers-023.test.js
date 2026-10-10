import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
const GUARDIANS = [
  { chessId: 'chess_char_5_11_b', skillIndex: 0 },
  { diy: { slot: 6, charId: 'char_2025_shu', skillIndex: 0 }, elite: true },
];
function guardian(entry) {
  const h = makeBattle({ autoFinish: false, captureNoisy: true, hooks: ['heal', 'skillStart'],
    defs: { chess: { patient: chessRec({ id: 'patient', skill: null, stats: { maxHp: 100000 } }) } },
    units: [{ uid: 1, ...entry, row: 10, col: 4 }, { uid: 2, chessId: 'patient', row: 10, col: 5 }] });
  h.step();const u = h.unit(1), p = h.unit(2);u.skill.gainSp(999);return { h, u, p };
}
for (const entry of GUARDIANS) {
  const name = entry.chessId ? '塞雷娅' : '黍';
  test(`${name} S1 heals without enemies, respects half HP and keeps attack cadence`, () => {
    const { h, u, p } = guardian(entry);
    p.hp = p.s.maxHp * 0.5001;h.run(0.5);assert.equal(u.skill.activations, 0);
    p.hp = p.s.maxHp * 0.5;u.atkCd = 1;
    h.run(0.5);assert.equal(u.skill.activations, 0, 'wait for the attack interval');
    assert.ok(h.runUntil(() => u.skill.activations > 0, 1));
    assert.ok(p.hp > p.s.maxHp * 0.5, 'exact half HP is eligible');
    p.hp = p.s.maxHp * 0.2;
    assert.ok(h.runUntil(() => u.skill.activations >= 2, 4));
    const casts = h.hooksOf('skillStart').filter(c => c.unit === u);
    assert.ok(casts[1].t - casts[0].t >= u.base.bat - 0.04, 'charges are paced by attacks');
    checkInvariants(h.b);assert.deepEqual(h.b.errors, []);
  });
  test(`${name} S1 preserves exact normal/fast attack intervals and waits out disarm`, () => {
    for (const aspd of [0, 100]) {
      const { h, u, p } = guardian(entry);
      p.hp *= 0.1;
      if (aspd) h.b.addBuff(u, { key: 'test:aspd', mods: { aspd } });
      h.b.on('heal', c => { if (c.source === u) u.skill.gainSp(999); });
      const charges = u.skill.charges;
      h.b.applyStatus(u, 'disarm', { duration: 1 });
      h.run(0.5);
      assert.equal(u.skill.activations, 0);
      assert.equal(u.skill.pending, false);
      assert.equal(u.skill.charges, charges);
      h.run(4);
      const times = h.hooksOf('heal').filter(c => c.source === u).map(c => c.t);
      assert.ok(times.length >= 3);
      for (let i = 1; i < times.length; i++) assert.ok(Math.abs(times[i] - times[i - 1] - u.s.interval) < 1e-9);
      checkInvariants(h.b);assert.deepEqual(h.b.errors, []);
    }
  });
  test(`${name} S1 cannot heal a forbidden patient or cast while silenced; invalid pending heal refunds the charge`, () => {
    const { h, u, p } = guardian(entry);p.hp *= 0.2;
    h.b.addBuff(p, { key: 'test:noheal', flags: { noHeal: true } });h.run(2);assert.equal(u.skill.activations, 0);
    h.b.removeBuff(p, 'test:noheal');h.b.applyStatus(u, 'silence', { duration: 2 });h.run(1);assert.equal(u.skill.activations, 0);
    h.run(1.1);assert.ok(u.skill.activations > 0);
    u.skill.gainSp(999);const charges = u.skill.charges;u.atkCd = 1;
    assert.ok(u.skill.activate('test'));p.hp = p.s.maxHp;h.step();
    assert.equal(u.skill.pending, false);assert.equal(u.skill.charges, charges);
    checkInvariants(h.b);assert.deepEqual(h.b.errors, []);
  });
}
for (const motion of ['WALK', 'FLY']) {
  test(`凯尔希·思衡托 S2 opens for a selectable ${motion} enemy only in the expanded range, without an injured ally`, () => {
    const h = makeBattle({ autoFinish: false,
      defs: { enemies: { target: enemyRec({ key: 'target', motion, hp: 1e8, atk: 0, speed: 0 }) } },
      units: [{ uid: 1, diy: { slot: 6, charId: 'char_1052_kalts2', skillIndex: 1 }, elite: true, row: 10, col: 4 }] });
    h.step();const u = h.unit(1);u.skill.gainSp(999);h.run(0.5);assert.equal(u.skill.activations, 0);
    const e = h.spawn('target', { pos: [10, 7] });h.b.applyStatus(e, 'sleep', { duration: 1 });
    assert.equal(h.b.enemiesInKeys(u.baseRangeKeys, u, { canHitFly: true }).length, 0);
    h.run(0.5);assert.equal(u.skill.activations, 0, 'sleep cannot open the mixed skill');
    assert.ok(h.runUntil(() => u.skill.active, 1));
    assert.equal(u.skill.activations, 1);checkInvariants(h.b);assert.deepEqual(h.b.errors, []);
  });
}
