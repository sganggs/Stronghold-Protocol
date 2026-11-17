// PRTS 伤判效果: equal-priority effects follow acquisition order; explicit priority wins over that order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec } from '../helpers/battleHarness.js';

function fixture() {
  const h = makeBattle({ defs: { chess: { probe: chessRec({ id: 'probe', stats: { maxHp: 1000, def: 0 }, skill: null }) } },
    units: [{ uid: 'probe', chessId: 'probe', row: 10, col: 5 }], content: 'none', autoFinish: false });
  h.step();
  let rolls = 0;
  h.b.rng = () => { rolls++; return 0; };
  return { b: h.b, t: h.unit('probe'), rolls: () => rolls };
}

for (const cause of ['dodge', 'shield', 'block', 'reduction']) {
  test(`injury observers continue after ${cause}, without consuming later defences or reviving damage`, () => {
    const { b, t, rolls } = fixture();
    const trace = [];
    b.addBuff(t, { key: 'before', observeInjury(c) { trace.push([c.amount, c.outcome]); } });
    b.addBuff(t, cause === 'dodge' ? { key: cause, mods: { dodgePhys: 1 } }
      : cause === 'shield' ? { key: cause, shieldHits: 1 }
        : cause === 'block' ? { key: cause, injury(c) { c.block(); } }
          : { key: cause, damageReduction: { phys: 100 } });
    b.addBuff(t, { key: 'later-shield', shieldHits: 2 });
    b.addBuff(t, { key: 'later-dodge', mods: { dodgePhys: 1 } });
    b.addBuff(t, { key: 'after', observeInjury(c) { trace.push([c.amount, c.outcome]); c.amount = 999; } });
    let blocks = 0;
    b.on('block', () => { blocks++; });
    const hp = t.hp;
    assert.equal(b.dealDamage({ target: t, amount: 100, type: 'phys' }), 0);
    assert.equal(t.hp, hp);
    assert.equal(t.findBuff('later-shield').shieldHits, 2);
    assert.equal(rolls(), cause === 'dodge' ? 1 : 0);
    assert.equal(blocks, cause === 'shield' || cause === 'block' ? 1 : 0);
    assert.deepEqual(trace, [[100, null], [0, cause === 'dodge' ? 'dodged' : cause === 'reduction' ? 'zero' : 'blocked']]);
  });
}

test('an observer attached to a depleted shield survives and continues observing later instances', () => {
  const { b, t } = fixture();
  const trace = [];
  b.addBuff(t, { key: 'combined', shieldHits: 1, observeInjury(c) { trace.push(c.amount); } });
  b.dealDamage({ target: t, amount: 100 });
  b.dealDamage({ target: t, amount: 100 });
  assert.deepEqual(trace, [0, 100]);
  assert.equal(t.findBuff('combined').shieldHits, 0);
});

test('recursive injury observers share the existing callback depth guard and recover after unwinding', () => {
  const { b, t } = fixture();
  b.addBuff(t, { key: 'recursive', observeInjury() { b.dealDamage({ target: t, amount: 1 }); } });
  b.dealDamage({ target: t, amount: 1 });
  assert.ok(b.errors.some(e => e.label === 'hookDepth:injury.observe'));
  assert.equal(b._emitDepth, 0);
  assert.ok(t.alive);
  b.removeBuff(t, 'recursive');
  assert.equal(b.dealDamage({ target: t, amount: 1 }), 1);
});

for (const first of ['shield', 'dodge']) {
  test(`ordinary ${first} acquired first is considered first`, () => {
    const { b, t, rolls } = fixture();
    const shield = { key: 'shield', shieldHits: 1 };
    const dodge = { key: 'dodge', mods: { dodgePhys: 1 } };
    for (const buff of first === 'shield' ? [shield, dodge] : [dodge, shield]) b.addBuff(t, buff);
    assert.equal(b.dealDamage({ target: t, amount: 100, type: 'phys' }), 0);
    assert.equal(t.findBuff('shield')?.shieldHits ?? 0, first === 'shield' ? 0 : 1);
    assert.equal(rolls(), first === 'shield' ? 0 : 1);
  });
}

test('priority overrides acquisition order; independent dodge effects stop after successful cancellation', () => {
  const { b, t, rolls } = fixture();
  b.addBuff(t, { key: 'dodge', mods: { dodgePhys: 1 } });
  b.addBuff(t, { key: 'shield', shieldHits: 1, injuryPriority: 1000 });
  b.dealDamage({ target: t, amount: 100, type: 'phys' });
  assert.equal(rolls(), 0);
  assert.equal(t.findBuff('shield'), null);
  b.addBuff(t, { key: 'dodge2', mods: { dodgePhys: 1 } });
  b.dealDamage({ target: t, amount: 100, type: 'phys' });
  assert.equal(rolls(), 1);
});

test('a partially consumed barrier permits a later dodge; a full barrier stops later rolls', () => {
  for (const shield of [50, 150]) {
    const { b, t, rolls } = fixture();
    b.addBuff(t, { key: 'barrier', shield });
    b.addBuff(t, { key: 'dodge', mods: { dodgePhys: 1 } });
    const hp = t.hp;
    b.dealDamage({ target: t, amount: 100, type: 'phys' });
    assert.equal(t.hp, hp);
    assert.equal(t.findBuff('barrier')?.shield ?? 0, Math.max(0, shield - 100));
    assert.equal(rolls(), shield < 100 ? 1 : 0);
  }
});

test('uncancellable dodge attempts each eligible effect, then continues into a barrier', () => {
  const { b, t, rolls } = fixture();
  b.addBuff(t, { key: 'dodge1', mods: { dodgePhys: 1 } });
  b.addBuff(t, { key: 'dodge2', mods: { dodgePhys: 1 } });
  b.addBuff(t, { key: 'barrier', shield: 50 });
  assert.equal(b.dealDamage({ target: t, amount: 100, type: 'phys', dodgeMode: 'uncancellable' }), 50);
  assert.equal(rolls(), 2);
});

test('type-specific shields and skipped dodge leave unrelated effects intact', () => {
  const { b, t, rolls } = fixture();
  b.addBuff(t, { key: 'arts-shield', shieldHits: 1, shieldType: 'arts' });
  b.addBuff(t, { key: 'dodge', mods: { dodgePhys: 1 } });
  assert.equal(b.dealDamage({ target: t, amount: 100, type: 'phys', dodgeMode: 'ignore' }), 100);
  assert.equal(t.findBuff('arts-shield').shieldHits, 1);
  assert.equal(rolls(), 0);
});

// PRTS explicitly illustrates an arts barrier acquired before/after fragile on an enemy.
test('fragile acquired after a barrier affects only its overflow; fragile acquired first consumes more barrier', () => {
  for (const first of ['barrier', 'fragile']) {
    const { b, t } = fixture();
    const barrier = { key: 'barrier', shield: 50 };
    const fragile = { key: 'fragile', mods: { dmgTakenMul: 2 } };
    for (const buff of first === 'barrier' ? [barrier, fragile] : [fragile, barrier]) b.addBuff(t, buff);
    assert.equal(b.dealDamage({ target: t, amount: 100, type: 'arts' }), first === 'barrier' ? 100 : 150);
  }
});

test('a depleted earlier barrier cannot be revived by a later modifier; HP loss skips injury multipliers', () => {
  const { b, t } = fixture();
  b.addBuff(t, { key: 'barrier', shield: 100 });
  b.addBuff(t, { key: 'fragile', mods: { dmgTakenMul: 2 } });
  assert.equal(b.dealDamage({ target: t, amount: 100, type: 'true' }), 0);
  assert.equal(b.dealHPLose({ target: t, amount: 100 }), 100);
});

test('transfer reservations use the actual post-barrier amount and distribute complete ancestry once', async () => {
  const { reserveTransfer } = await import('../../server/sim/attack.js');
  const { b, t } = fixture();
  b.addBuff(t, { key: 'barrier', shield: 300 });
  const shares = [];
  for (const [ratio, tag] of [[0.4, 'share:a'], [0.5, 'share:b']]) {
    b.on('hpDamage', ctx => reserveTransfer(ctx, ratio, tag, (amount, tags) => shares.push({ amount, tags })), { priority: -2000 });
  }
  assert.equal(b.dealDamage({ target: t, amount: 1000, type: 'true' }), 70);
  assert.deepEqual(shares, [
    { amount: 280, tags: ['share:a', 'share:b'] },
    { amount: 350, tags: ['share:a', 'share:b'] },
  ]);
  b.addBuff(t, { key: 'full', shield: 1000 });
  b.dealDamage({ target: t, amount: 100, type: 'true' });
  assert.equal(shares.length, 2, 'absorbed damage cannot reserve a share');
});

test('a failing transfer callback is reported without aborting the victim settlement or another callback', async () => {
  const { reserveTransfer } = await import('../../server/sim/attack.js');
  const { b, t } = fixture();
  const errors = [];
  b._internalError = (where, error) => errors.push([where, error.message]);
  let received = 0;
  b.on('hpDamage', ctx => {
    reserveTransfer(ctx, 0.2, 'bad', () => { throw new Error('probe'); });
    reserveTransfer(ctx, 0.3, 'good', amount => { received += amount; });
  });
  assert.equal(b.dealDamage({ target: t, amount: 100, type: 'true' }), 50);
  assert.equal(received, 30);
  assert.deepEqual(errors, [['transfer', 'probe']]);
});

test('deferred injury cleanup follows HP settlement and also runs when a later dodge cancels overflow', () => {
  for (const dodge of [false, true]) {
    const { b, t } = fixture();
    const trace = [];
    b.addBuff(t, { key: 'hp-barrier', mods: { hpPct: 1 }, injury(c) {
      c.amount -= Math.min(50, c.amount);
      c.defer(() => { trace.push('cleanup'); b.removeBuff(t, c.buff); });
    } });
    assert.equal(t.s.maxHp, 2000);
    if (dodge) b.addBuff(t, { key: 'dodge', mods: { dodgePhys: 1 } });
    b.on('damaged', () => { trace.push('hp'); assert.equal(t.s.maxHp, 2000); });
    assert.equal(b.dealDamage({ target: t, amount: 100, type: 'phys' }), dodge ? 0 : 50);
    assert.deepEqual(trace, dodge ? ['cleanup'] : ['hp', 'cleanup']);
    assert.equal(t.s.maxHp, 1000);
    assert.equal(t.hp, dodge ? 1000 : 975);
  }
});

test('guaranteed held dodge consumes its charge without a probability draw; ignore mode preserves it', () => {
  for (const mode of ['normal', 'ignore', 'uncancellable']) {
    const { b, t, rolls } = fixture();
    b.addBuff(t, { key: 'held', injury(c) { if (c.dodge()) b.removeBuff(t, c.buff); } });
    assert.equal(b.dealDamage({ target: t, amount: 100, type: 'phys', dodgeMode: mode }), mode === 'normal' ? 0 : 100);
    assert.equal(!!t.findBuff('held'), mode === 'ignore');
    assert.equal(rolls(), 0);
  }
});

test('same-named flat reduction takes the strongest value separately for each HP damage type', () => {
  const { b, t } = fixture();
  b.addBuff(t, { key: 'one', reductionGroup: 'same', damageReduction: { phys: 75, arts: 20, true: 10, elemental: 5 } });
  b.addBuff(t, { key: 'two', reductionGroup: 'same', damageReduction: { phys: 30, arts: 40 } });
  for (const [type, expected] of [['phys', 25], ['arts', 60], ['true', 90], ['elemental', 95]]) {
    assert.equal(b.dealDamage({ target: t, amount: 100, type }), expected, type);
  }
  assert.equal(b.dealHPLose({ target: t, amount: 100 }), 100, 'loss skips injury reduction');
  b.removeBuff(t, 'one');
  assert.equal(b.dealDamage({ target: t, amount: 100, type: 'phys' }), 70, 'weaker surviving source resumes');
});

// PRTS 伤害减免: reductions of different names stack; the name is `reductionGroup`, else the buff key (DESIGN §35.44).
test('differently named flat reductions stack, one name keeps its strongest', () => {
  const { b, t } = fixture();
  b.addBuff(t, { key: 'a', damageReduction: { phys: 30 } });
  b.addBuff(t, { key: 'b', damageReduction: { phys: 20 } });
  assert.equal(b.dealDamage({ target: t, amount: 100, type: 'phys' }), 50, 'two names: both subtract');
  b.addBuff(t, { key: 'c', reductionGroup: 'a', damageReduction: { phys: 40 } });
  assert.equal(b.dealDamage({ target: t, amount: 100, type: 'phys' }), 40, "'c' joins 'a': 40 replaces 30");
});

// its own test so it reports on its own when the assertions above change (DESIGN §35.47)
test('a reduction group that names no key keeps its strongest (per-unit keys, as 浊心斯卡蒂\'s aura)', () => {
  const { b, t } = fixture();
  b.addBuff(t, { key: 'aura:1', reductionGroup: 'aura', damageReduction: { phys: 25 } });
  b.addBuff(t, { key: 'aura:2', reductionGroup: 'aura', damageReduction: { phys: 35 } });
  assert.equal(b.dealDamage({ target: t, amount: 100, type: 'phys' }), 65, 'two keys of one group: the strongest alone');
});

test('flat reduction follows its buff priority/acquisition position and can remove the mitigation floor', () => {
  for (const priority of [0, 2000]) {
    const { b, t } = fixture();
    b.addBuff(t, { key: 'barrier', shield: 50 });
    b.addBuff(t, { key: 'reduction', injuryPriority: priority, damageReduction: { phys: 30 } });
    assert.equal(b.dealDamage({ target: t, amount: 50, type: 'phys' }), 0);
    assert.equal(t.findBuff('barrier')?.shield ?? 0, priority ? 30 : 0);
  }
  const { b, t } = fixture();
  b.addBuff(t, { key: 'defence', mods: { defFlat: 10000 } });
  b.addBuff(t, { key: 'reduction', damageReduction: { phys: 30 } });
  assert.equal(b.dealDamage({ target: t, amount: 100, type: 'phys' }), 0, '5% floor precedes flat reduction');
});

for (const cause of ['barrier', 'hitShield', 'nativeBlock', 'flatReduction']) {
  test(`fully absorbed ${cause} has injury observation but no successful HP events`, () => {
    const { b, t } = fixture();
    let hurt = 0, observed = 0;
    const events = [];
    t.skill = {};
    b._skills.onDamaged = () => { hurt++; };
    for (const name of ['damaged', 'hpChanged', 'damageApplied', 'fatal', 'death']) b.on(name, () => events.push(name));
    b.addBuff(t, cause === 'barrier' ? { key: cause, shield: 1000 }
      : cause === 'hitShield' ? { key: cause, shieldHits: 1 }
        : cause === 'nativeBlock' ? { key: cause, injury(c) { c.block(); } }
          : { key: cause, damageReduction: { phys: 1000 } });
    b.addBuff(t, { key: 'observer', observeInjury(c) { observed++; assert.equal(c.amount, 0); } });
    const hp = t.hp, lastHitAt = t.lastHitAt;
    assert.equal(b.dealDamage({ target: t, amount: 100, type: 'phys' }), 0);
    assert.equal(t.hp, hp);
    if (cause === 'nativeBlock') assert.equal(t.lastHitAt, lastHitAt);
    assert.equal(observed, 1);
    // The legacy zero notification/basic hurt-SP contract remains separate from the new success events.
    assert.equal(hurt, cause === 'nativeBlock' ? 0 : 1);
    assert.deepEqual(events, cause === 'nativeBlock' ? [] : ['damaged']);
  });
}


test('refillable empty barriers retain acquisition order without changing the default depletion lifecycle', () => {
  const { b, t } = fixture();
  let removed = 0;
  b.addBuff(t, { key: 'refillable', shield: 10, keepEmptyShield: true, onRemove() { removed++; } });
  const held = t.findBuff('refillable');
  b.addBuff(t, { key: 'later', mods: { trueTakenMul: 0.5 } });
  assert.equal(b.dealDamage({ target: t, amount: 100, type: 'true' }), 45);
  assert.equal(t.findBuff('refillable'), held);
  assert.equal(held.shield, 0);
  assert.equal(removed, 0);
  held.shield = 10;
  t.markDirty();
  assert.equal(b.dealDamage({ target: t, amount: 100, type: 'true' }), 45, 'refill stays before the later multiplier');
  b.removeBuff(t, held);
  assert.equal(removed, 1, 'ordinary buff removal still owns lifecycle cleanup');
  b.addBuff(t, { key: 'ordinary', shield: 10 });
  b.dealDamage({ target: t, amount: 100, type: 'true' });
  assert.equal(t.findBuff('ordinary'), null, 'one-shot barriers retain the existing default');
});
