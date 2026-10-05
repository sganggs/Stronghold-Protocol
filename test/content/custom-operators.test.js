import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec } from '../helpers/battleHarness.js';
import { customRuntimeId } from '../../shared/customOperators.js';

function battle(charId, skillIndex, moduleId = 'none') {
  const id = customRuntimeId('chess_char_6_diy1_a', charId, 0, true);
  const h = makeBattle({
    autoFinish: false, timeLimit: 150,
    units: [{ chessId: id, skillIndex, moduleId, row: 10, col: 4 }],
    defs: { enemies: { dummy: enemyRec({ key: 'dummy', hp: 1e7, atk: 0, speed: 0 }) } },
    enemies: [{ key: 'dummy', pos: [10, 5] }],
    hooks: ['damaged', 'attack'], captureNoisy: true,
  }).step();
  return { h, u: h.unit(id) };
}

function cast(u) {
  assert.equal(u.skill.activate('manual', { free: true }), true);
}

function redeploy(h, u) {
  h.b.dealDamage(null, u, { type: 'true', amount: 1e9 });
  assert.equal(u.alive, false);
  assert.equal(h.b.redeploy(u, { free: true }), true);
}

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

test('Thorns doubles the second S3 cast but returns to a timed first cast after redeployment', () => {
  const { h, u } = battle('char_293_thorns', 2);
  const bb = u.skill.bb;
  cast(u);
  close(u.s.atk, u.base.atk * (1 + bb.atk));
  close(u.skill.timeLeft, u.def.skill.duration);
  u.skill.end('expired');
  cast(u);
  close(u.s.atk, u.base.atk * (1 + bb['thorns_s_3[b].atk']));
  assert.equal(u.skill.timeLeft, Infinity);
  redeploy(h, u);
  cast(u);
  close(u.s.atk, u.base.atk * (1 + bb.atk));
  close(u.s.aspd, u.base.aspd + bb.attack_speed);
  close(u.skill.timeLeft, u.def.skill.duration);
  h.invariants();
});

test('Eyjafjalla S1 attack bonus begins with the second cast of the current deployment', () => {
  const { h, u } = battle('char_180_amgoat', 0);
  const baseline = u.s.atk;
  cast(u);
  close(u.s.atk, baseline);
  u.skill.end('expired');
  cast(u);
  close(u.s.atk, baseline + u.base.atk * u.skill.bb['amgoat_s_1[b].atk']);
  redeploy(h, u);
  h.run(0.3);
  cast(u);
  close(u.s.atk, baseline);
  h.invariants();
});

test('Thorns S2 stops normal attacks, retaliates at its cooldown boundary, and resumes after ending', () => {
  const { h, u } = battle('char_293_thorns', 1);
  cast(u);
  const victim = h.enemy('dummy');
  const retaliate = () => h.b.dealDamage(victim, u, { type: 'phys', amount: 10, isAttack: true });
  const count = () => h.hooksOf('attack').filter((c) => c.attacker === u && c.isSkill).length;
  const before = count();
  retaliate();
  assert.equal(count(), before + 1);
  retaliate();
  assert.equal(count(), before + 1);
  h.run(u.skill.bb.cooldown);
  retaliate();
  assert.equal(count(), before + 2);
  u.skill.end('expired');
  const after = h.hooksOf('attack').filter((c) => c.attacker === u && !c.isSkill).length;
  h.run(3);
  assert.ok(h.hooksOf('attack').filter((c) => c.attacker === u && !c.isSkill).length > after);
  h.invariants();
});

test('Ifrit S3 damages ground targets without normal attacks and resumes attacks when it ends', () => {
  const { h, u } = battle('char_134_ifrit', 2);
  cast(u);
  const hp = u.hp;
  const before = h.hooksOf('attack').filter((c) => c.attacker === u).length;
  h.run(3.1);
  assert.equal(h.hooksOf('attack').filter((c) => c.attacker === u).length, before);
  assert.ok(h.hooksOf('damaged').some((c) => c.source === u && c.dmg?.tags?.includes('dot') && c.amount > 0));
  assert.ok(u.hp < hp);
  u.skill.end('expired');
  h.run(4);
  assert.ok(h.hooksOf('attack').filter((c) => c.attacker === u).length > before);
  h.invariants();
});
