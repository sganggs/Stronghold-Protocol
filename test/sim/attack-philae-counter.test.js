// Pinned native philae_s_2 and philae_s_2[ep]: unfiltered injury, cooldown, selector, delayed precomputed child.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';

function fixture(state = 'ordinary') {
  const h = makeBattle({ autoFinish: false, units: [{ uid: 'philae', chessId: 'chess_char_3_06_a', skillIndex: 1, row: 10, col: 5 }],
    defs: { enemies: { enemy_probe: enemyRec({ key: 'enemy_probe', hp: 1000000, def: 0, res: 0, speed: 0, atk: 0,
      motion: state === 'flying' ? 'FLY' : 'WALK' }) } } });
  h.step();
  const b = h.b, u = h.unit('philae'), e = h.spawn('enemy_probe', { pos: [10, 5.5] });
  assert.ok(u.skill.activate('test', { free: true }));
  u.hp = u.s.maxHp;
  if (['stealth', 'untargetable', 'sleep'].includes(state)) b.addBuff(e, { key: 'selection', flags: { [state]: true } });
  const hits = [];
  b.on('hit', c => { if (c.source === u && c.target === e && c.dmg.tags?.includes('counter')) hits.push(c); });
  return { h, b, u, e, hits };
}
for (const sourceKind of ['enemy', 'source-less', 'self']) for (const tag of ['counter', 'reflect']) {
  test(`Philae ${sourceKind} injury tagged ${tag} triggers one delayed blast despite earlier absorption`, () => {
    const { h, b, u, e, hits } = fixture();
    b.addBuff(u, { key: 'prior-barrier', shield: 100000, injuryPriority: 3000 });
    const hp = u.hp;
    b.dealDamage({ source: sourceKind === 'enemy' ? e : sourceKind === 'self' ? u : null,
      target: u, amount: 1, type: 'true', attackType: 'BUFF', isAttack: false, tags: [tag] });
    assert.equal(u.hp, hp);
    assert.equal(hits.length, 0, 'native target buff waits for its trigger');
    h.run(0.1);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].source, u);
    assert.equal(hits[0].target, e);
    checkInvariants(b);
    assert.deepEqual(b.errors, []);
  });
}
for (const state of ['ordinary', 'flying', 'stealth', 'untargetable', 'sleep']) {
  test(`Philae blast selector respects ${state} target state`, () => {
    const { h, b, u, hits } = fixture(state);
    b.dealDamage({ target: u, amount: 1, type: 'true' });
    h.run(0.1);
    assert.equal(hits.length, state === 'ordinary' ? 1 : 0);
    assert.deepEqual(b.errors, []);
  });
}
test('Philae blast skips source calculation but retains target calculation, output, ordinary dodge and separate gauge', () => {
  const { h, b, u, e, hits } = fixture();
  let source = 0, target = 0, output = 0, dodge = 0;
  b.on('damageCalculate', c => { if (c.source === u) { source++; c.dmg.amount *= 100; } });
  b.on('damageCalculateTarget', c => { if (c.source === u) target++; });
  b.on('damageOutput', c => { if (c.source === u) output++; });
  b.on('dodge', c => { if (c.source === u) dodge++; });
  b.addBuff(e, { key: 'arts-dodge', mods: { dodgeArts: 1 } });
  b.rng = () => 0;
  const hp = e.hp;
  b.dealDamage({ target: u, amount: 1, type: 'true' });
  h.run(0.1);
  assert.deepEqual([source, target, output, dodge], [0, 1, 1, 1]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].dmg.calculation, 'precomputed');
  assert.equal(hits[0].dmg.attackType, 'NORMAL');
  assert.equal(hits[0].dmg.applyWay, 'NONE');
  assert.equal(e.hp, hp);
  assert.ok(e.elem.apoptosis > 0);
  assert.deepEqual(b.errors, []);
});
test('Philae cooldown is acquired before children; HP loss/gauges do not reserve it, and skill end does not revoke selected children', () => {
  const { h, b, u, e, hits } = fixture();
  b.dealHPLose({ target: u, amount: 1 });
  b.dealElementDamage({ target: u, amount: 1, element: 'burn' });
  assert.equal(u.mem.philaeCd, -Infinity);
  b.dealDamage({ target: u, amount: 1, type: 'true', tags: ['reflect'] });
  const until = u.mem.philaeCd;
  assert.ok(until > b.time);
  b.dealDamage({ target: u, amount: 1, type: 'true' });
  assert.equal(u.mem.philaeCd, until);
  u.skill.end('test');
  e.x += 5; // The target was selected when the injury occurred, not when the child executes.
  h.run(0.1);
  assert.equal(hits.length, 1);
  assert.equal(u.findBuff('philae:counter'), null);
  assert.deepEqual(b.errors, []);
});
