// PRTS reaper / native *_trait[heal_fake] 0.05 s admission and *_trait[heal] 0.12 s delivery.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';

function field({ block = 2, chessId = null } = {}) {
  const h = makeBattle({ autoFinish: false, content: chessId ? 'full' : 'none',
    defs: { chess: { reaper: chessRec({ id: 'reaper', profession: 'WARRIOR', subProfessionId: 'reaper',
      stats: { maxHp: 100000, atk: 100, blockCnt: block }, skill: null }) },
      enemies: { enemy_probe: enemyRec({ key: 'enemy_probe', hp: 1000000, def: 0, res: 0, atk: 0, speed: 0 }) } },
    units: [{ uid: 'reaper', chessId: chessId ?? 'reaper', row: 10, col: 5 }] });
  h.step();
  const b = h.b, u = h.unit('reaper'), e = h.spawn('enemy_probe', { pos: [10, 6] }), heals = [];
  u.atkCd = 999;
  if (u.skill) { u.skill.sp = 0; u.skill.charges = 0; }
  u.hp = u.s.maxHp * 0.6;
  b.on('heal', c => { if (c.source === u && c.target === u && c.opts?.self && !c.opts.tags) heals.push({ time: b.time, amount: c.amount }); });
  return { h, b, u, e, heals };
}
const output = (f, opts = {}) => f.b.dealDamage({ source: f.u, target: f.e, amount: 10, type: 'true', ...opts });
const done = f => { checkInvariants(f.b); assert.deepEqual(f.b.errors, []); };

for (const defense of ['none', 'dodge', 'shield']) test(`reaper source output queues healing before ${defense}, with separate 0.12 s deliveries`, () => {
  const f = field(), { h, b, u, e, heals } = f, hp = u.hp;
  if (defense === 'dodge') b.addBuff(e, { key: 'defense', injury(c) { c.dodge(); } });
  if (defense === 'shield') b.addBuff(e, { key: 'defense', shieldHits: 9 });
  output(f); output(f); output(f);
  assert.equal(heals.length, 0, 'output admits healing; it does not apply it synchronously');
  assert.equal(u.hp, hp);
  h.run(0.4);
  assert.equal(heals.length, 2, 'initial block count caps the group');
  assert.ok(heals[1].time - heals[0].time >= 0.12 - 1e-9);
  assert.ok(heals[1].time - heals[0].time <= 0.12 + b.dt + 1e-9);
  assert.equal(u.hp, hp + 100);
  done(f);
});

test('reaper 0.05 s admission window spans adjacent simulation ticks and is shared by attacks and skills', () => {
  const f = field(), { h, heals } = f;
  output(f, { isAttack: true }); output(f, { isSkill: true });
  h.step();
  output(f, { isSkill: true }); // One 1/30 s step is still within the 0.05 s window.
  h.step();
  output(f, { isAttack: true }); output(f, { isSkill: true }); // Two steps open a new window.
  h.run(0.8);
  assert.equal(heals.length, 4);
  for (let i = 1; i < heals.length; i++) assert.ok(heals[i].time - heals[i - 1].time >= 0.12 - 1e-9);
  done(f);
});

for (const block of [0, 1, 3]) test(`reaper admission respects an initial block count of ${block}`, () => {
  const f = field({ block });
  for (let i = 0; i < 5; i++) output(f);
  f.h.run(0.6);
  assert.equal(f.heals.length, block);
  done(f);
});

test('bare attack events, source-less credit, HP loss and gauges do not enqueue reaper healing', () => {
  const f = field(), { h, b, u, e, heals } = f;
  b.emit('attack', { attacker: u, targets: [e, e] });
  b.dealDamage({ credit: u, target: e, amount: 10, type: 'true' });
  b.dealHPLose({ source: u, target: e, amount: 10 });
  b.dealElementDamage({ source: u, target: e, amount: 1, element: 'burn' });
  output(f, { amount: 0 });
  h.run(0.3);
  assert.equal(heals.length, 0);
  done(f);
});

for (const chessId of ['chess_char_5_01_a', 'chess_char_5_06_a']) for (const attackType of ['NORMAL', 'BUFF']) {
  test(`${chessId} applies its own native ${attackType} heal eligibility`, () => {
    const f = field({ chessId });
    output(f, { attackType, tags: ['talent', 'dot'] });
    f.h.run(0.2);
    assert.equal(f.heals.length, chessId === 'chess_char_5_06_a' && attackType === 'BUFF' ? 0 : 1);
    done(f);
  });
}

test('death clears pending reaper healing so redeployment cannot receive the prior deployment queue', () => {
  const f = field(), { h, b, u, e, heals } = f;
  output(f); output(f);
  b.kill(u, e);
  assert.ok(b.redeploy(u, { free: true }));
  u.atkCd = 999;
  u.hp = 100;
  h.run(0.5);
  assert.equal(heals.length, 0);
  assert.equal(u.hp, 100);
  done(f);
});
