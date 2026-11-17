// PRTS 伤判效果 / 事件: injury observers continue after earlier dodge/block; success notifications do not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';

function fixture(kind) {
  const choices = {
    bubble: { chessId: 'chess_char_2_08_a', skillIndex: 1 },
    judge: { diy: { slot: 6, charId: 'char_4065_judge', skillIndex: 0 } },
    nianModule: { elite: true, diy: { slot: 6, charId: 'char_2014_nian', skillIndex: 0, uniEquipId: 'uniequip_002_nian' } },
    nian: { diy: { slot: 6, charId: 'char_2014_nian', skillIndex: 1 } },
    hsgma2: { diy: { slot: 6, charId: 'char_1044_hsgma2', skillIndex: 0 } },
    hsgmaModule: { elite: true, diy: { slot: 6, charId: 'char_1044_hsgma2', skillIndex: 2, uniEquipId: 'uniequip_002_hsgma2' } },
    yu: { chessId: 'chess_char_6_03_a', skillIndex: 0 },
  };
  const h = makeBattle({ units: [{ uid: 'defender', row: 10, col: 5, ...choices[kind] }],
    defs: { enemies: { enemy_probe: enemyRec({ key: 'enemy_probe', hp: 100000, def: 0, res: 0, speed: 0, atk: 0 }) } },
    autoFinish: false });
  h.step();
  const u = h.unit('defender'), e = h.spawn('enemy_probe', { pos: [10, 8] });
  if (!['judge', 'nianModule'].includes(kind)) assert.ok(u.skill.activate('test', { free: true }));
  return { h, b: h.b, u, e };
}

for (const kind of ['bubble', 'judge', 'nian', 'hsgma2', 'hsgmaModule', 'yu']) for (const defence of ['dodge', 'barrier', 'block']) {
  test(`${kind} injury observation survives earlier ${defence} without successful HP damage`, () => {
    const { b, u, e } = fixture(kind);
    b.addBuff(u, { key: 'earlier', injuryPriority: 3000,
      ...(defence === 'dodge' ? { mods: { dodgePhys: 1 } }
        : defence === 'barrier' ? { shield: 10000 } : { injury(c) { c.block(); } }) });
    b.rng = () => 0;
    let answers = 0, successes = 0;
    b.on('hit', c => { if (c.source === u && c.target === e && c.dmg.tags?.includes('counter')) answers++; });
    if (kind === 'yu') b.on('elementApplied', c => { if (c.source === u && c.target === e && c.dmg.tags?.includes('counter')) answers++; });
    b.on('damageApplied', c => { if (c.target === u) successes++; });
    u.hp = u.s.maxHp; // Resolve skill max-HP changes before the before/after snapshot.
    const hp = u.hp;
    assert.equal(b.dealDamage({ source: e, target: u, amount: 100, type: 'phys' }), 0);
    assert.equal(u.hp, hp);
    assert.equal(successes, 0);
    assert.equal(answers, 1);
    if (kind === 'yu') assert.ok(e.elem.burn > 0);
    else assert.ok(e.hp < e.s.maxHp);
    if (kind === 'nian') assert.ok(e.findBuff('silence'));
    if (kind === 'bubble') assert.ok(e.findBuff('bubble:spike'));
    // Attribution is not a reflection source; loss/gauges skip injury, but tagged enemy damage still qualifies.
    b.dealDamage({ source: null, credit: e, target: u, amount: 10, type: 'true' });
    b.dealHPLose({ source: e, target: u, amount: 10 });
    b.dealElementDamage({ source: e, target: u, amount: 10, element: 'burn' });
    assert.equal(answers, 1);
    b.dealDamage({ source: e, target: u, amount: 10, type: 'true', tags: ['counter'] });
    assert.equal(answers, 2);
    const skillKeys = { bubble: 'bubble:counter', nian: 'nian:copperSeal', hsgma2: 'hsgma2:karma', yu: 'yu:hostCounter' };
    if (skillKeys[kind]) {
      u.skill.end('test');
      assert.equal(u.findBuff(skillKeys[kind]), null);
      b.dealDamage({ source: e, target: u, amount: 10, type: 'phys' });
      assert.equal(answers, 2);
    }
    checkInvariants(b);
    assert.equal(b.errors.length, 0);
  });
}

test('Judge reflects her own barrier-breaking instance before absorption, but not later unshielded damage', () => {
  const { b, u, e } = fixture('judge');
  let answers = 0;
  b.on('hit', c => { if (c.source === u && c.dmg.tags?.includes('judge:thorns')) answers++; });
  const own = u.findBuff('talent:judge:barrier');
  assert.ok(own);
  own.shield = 10;
  u.markDirty();
  b.dealDamage({ source: e, target: u, amount: 20, type: 'true' });
  assert.equal(answers, 1);
  b.dealDamage({ source: e, target: u, amount: 20, type: 'true' });
  assert.equal(answers, 1);
});

for (const defence of ['dodge', 'shield']) {
  test(`Hoshiguma alter module output damage precedes the primary hit's ${defence}`, () => {
    const { b, u, e } = fixture('hsgmaModule');
    b.rng = () => 0;
    b.addBuff(e, defence === 'dodge' ? { key: 'defence', mods: { dodgePhys: 1 } } : { key: 'defence', shieldHits: 1 });
    const damage = [];
    b.on('hit', c => { if (c.source === u && c.target === e) damage.push(c.dmg.tags ?? []); });
    const hp = e.hp;
    const primary = b.dealDamage({ source: u, target: e, amount: 100, type: 'phys', isAttack: true });
    assert.equal(damage.length, 2);
    assert.ok(damage[1].includes('hsgma2:astx'));
    assert.equal(e.hp < hp, true);
    assert.equal(primary > 0, defence === 'shield', 'the output rider consumes the shield before the primary hit');
  });
}

test('Nian module observes its own layer loss on block, not successful damage or unrelated cancellation', () => {
  const { b, u, e } = fixture('nianModule');
  u.skill.sp = 0;
  u.skill.charges = 0;
  const hp = u.hp, stats = { atk: u.s.atk, def: u.s.def };
  let successes = 0;
  b.on('damageApplied', c => { if (c.target === u) successes++; });
  b.addBuff(u, { key: 'earlier-block', injuryPriority: 3000, injury(c) { c.block(); } });
  b.dealDamage({ source: e, target: u, amount: 100, type: 'true' });
  assert.equal(u.findBuff('talent:nian:shield').shieldHits, 3);
  assert.equal(u.findBuff('talent:nian:shieldBreak'), null);
  assert.equal(u.skill.sp, 0);
  b.removeBuff(u, 'earlier-block');
  for (let n = 1; n <= 3; n++) {
    b.dealDamage({ source: e, target: u, amount: 100, type: 'true' });
    assert.equal(u.hp, hp);
    assert.equal(u.findBuff('talent:nian:shieldBreak').stacks, n);
    assert.equal(u.skill.sp, n * 3);
  }
  assert.equal(successes, 0);
  assert.ok(u.s.atk > stats.atk && u.s.def > stats.def);
  b.dealDamage({ source: e, target: u, amount: 100, type: 'true' });
  assert.equal(u.findBuff('talent:nian:shieldBreak').stacks, 3);
});

for (const kind of ['hsgma2', 'hsgmaModule']) {
  test(`${kind} counter uses ordinary arts dodge rather than bypassing it`, () => {
    const { b, u, e } = fixture(kind);
    b.addBuff(e, { key: 'arts-dodge', mods: { dodgeArts: 1 } });
    b.rng = () => 0;
    let answers = 0, avoided = 0;
    b.on('hit', c => { if (c.source === u && c.dmg.tags?.includes('counter')) answers++; });
    b.on('dodge', c => { if (c.source === u && c.target === e) avoided++; });
    const hp = e.hp;
    b.dealDamage({ source: e, target: u, amount: 10, type: 'true' });
    assert.equal(answers, 1);
    assert.equal(avoided, 1);
    assert.equal(e.hp, hp);
    checkInvariants(b);
  });
}

test('Hoshiguma alter module needs an active skill and remains active in the S3 dying mode', () => {
  const { b, u, e } = fixture('hsgmaModule');
  let riders = 0;
  b.on('hit', c => { if (c.source === u && c.dmg.tags?.includes('hsgma2:astx')) riders++; });
  const exchange = () => {
    b.dealDamage({ source: u, target: e, amount: 1, type: 'phys', isAttack: true });
    b.dealDamage({ source: e, target: u, amount: 1, type: 'true' });
  };
  exchange();
  assert.equal(riders, 2);
  u.skill.end('test');
  exchange();
  assert.equal(riders, 2, 'the trait does not add damage outside a skill');
  assert.ok(u.skill.activate('test', { free: true }));
  u.skill.end('manual');
  assert.ok(u.mem.hsDying);
  exchange();
  assert.equal(riders, 4, 'dying mode retains both module branches');
  checkInvariants(b);
});


test('Penance keeps her empty native barrier through a kill refill but reacquires it on redeploy', () => {
  const { b, u, e } = fixture('judge');
  const barrier = u.findBuff('talent:judge:barrier');
  barrier.shield = 1;
  u.markDirty();
  b.dealDamage({ source: e, target: u, amount: 2, type: 'true' });
  assert.equal(u.findBuff(barrier.key), barrier);
  assert.equal(barrier.shield, 0);
  b.kill(e, u);
  assert.equal(u.findBuff(barrier.key), barrier);
  assert.ok(barrier.shield > 0);
  b.retreat(u);
  assert.equal(u.findBuff(barrier.key), null);
  assert.ok(b.redeploy(u));
  assert.ok(u.findBuff(barrier.key).seq > barrier.seq);
  checkInvariants(b);
});
