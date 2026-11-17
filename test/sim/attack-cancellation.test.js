// PRTS 逻各斯 / 游戏数据基础: cancellation immunity preserves attempts and partial barrier reduction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { dealDamage, cancelDamage } from '../../server/sim/attack.js';

function fixture() {
  const h = makeBattle({ content: 'none', autoFinish: false,
    defs: { chess: { probe: chessRec({ id: 'probe', stats: { maxHp: 1000, def: 0 }, skill: null }) },
      enemies: { enemy_probe: enemyRec({ key: 'enemy_probe', hp: 1000, speed: 0, atk: 0, def: 0, res: 0 }) } },
    units: [{ uid: 'probe', chessId: 'probe', row: 10, col: 5 }] });
  h.step();
  return { h, b: h.b, t: h.unit('probe'), e: h.spawn('enemy_probe', { pos: [10, 8] }) };
}

for (const kind of ['count', 'pool', 'callback']) for (const uncancellable of [false, true]) {
  test(`${kind} block consumes its resource with cancellation ${uncancellable ? 'rejected' : 'accepted'}`, () => {
    const { b, t } = fixture();
    b.addBuff(t, { key: 'block', ...(kind === 'count' ? { shieldHits: 1 } : kind === 'pool' ? { shield: 200 }
      : { injury(c) { if (c.block()) b.removeBuff(t, c.buff); } }) });
    const held = t.findBuff('block'), blocks = [], observed = [], notifications = [], applied = [];
    b.addBuff(t, { key: 'observer', observeInjury(c) { observed.push([c.amount, c.outcome, c.cancelled]); } });
    b.on('block', c => { blocks.push(c.cancelled); });
    b.on('damaged', c => { if (c.target === t) notifications.push(c.amount); });
    b.on('damageApplied', c => { if (c.target === t) applied.push(c.amount); });
    const result = b.dealDamage({ target: t, amount: 100, type: 'true', ignoreCancelReasons: uncancellable ? ['block'] : [] });
    assert.equal(result, uncancellable ? 100 : 0);
    assert.equal(t.hp, uncancellable ? 900 : 1000);
    assert.deepEqual(blocks, [!uncancellable]);
    assert.deepEqual(observed, [[uncancellable ? 100 : 0, uncancellable ? null : 'blocked', !uncancellable]]);
    assert.deepEqual(notifications, uncancellable ? [100] : kind === 'callback' ? [] : [0], 'legacy zero notifications are independent of native cancellation');
    assert.deepEqual(applied, uncancellable ? [100] : [], 'an accepted block is not positive damage settlement');
    if (kind === 'pool') assert.equal(held.shield, 100);
    else assert.equal(t.findBuff('block'), null);
    checkInvariants(b);
  });
}

test('partial barrier reduction survives while later full shields spend resources without cancelling', () => {
  const { b, t } = fixture(), blocks = [];
  b.addBuff(t, { key: 'partial', shield: 40 });
  b.addBuff(t, { key: 'full', shield: 1000 });
  b.addBuff(t, { key: 'count', shieldHits: 1 });
  b.on('block', c => { blocks.push(c.cancelled); });
  assert.equal(b.dealDamage({ target: t, amount: 100, type: 'true', ignoreCancelReasons: ['block'] }), 60);
  assert.equal(t.findBuff('partial'), null);
  assert.equal(t.findBuff('full').shield, 940);
  assert.equal(t.findBuff('count'), null);
  assert.deepEqual(blocks, [false, false]);
  checkInvariants(b);
});

test('block cancellation immunity does not revive damage reduced to zero by a later flat reduction', () => {
  const { b, t } = fixture();
  b.addBuff(t, { key: 'count', shieldHits: 1 });
  b.addBuff(t, { key: 'flat', damageReduction: { true: 100 } });
  assert.equal(b.dealDamage({ target: t, amount: 100, type: 'true', ignoreCancelReasons: ['block'] }), 0);
  assert.equal(t.findBuff('count'), null);
  assert.equal(t.hp, 1000);
});

for (const skip of [false, true]) {
  test(`dodge cancellation mask ${skip ? 'does not override explicit attempt skipping' : 'preserves probability draws and attempt events'}`, () => {
    const { b, t } = fixture();
    b.addBuff(t, { key: 'dodge', mods: { dodgePhys: 1 } });
    let rolls = 0;
    const dodges = [];
    b.rng = () => { rolls++; return 0; };
    b.on('dodge', c => { dodges.push(c.cancelled); });
    assert.equal(b.dealDamage({ target: t, amount: 100, type: 'phys', ignoreCancelReasons: ['dodge'],
      dodgeMode: skip ? 'ignore' : 'normal' }), 100);
    assert.equal(rolls, skip ? 0 : 1);
    assert.deepEqual(dodges, skip ? [] : [false]);
  });
}

for (const mask of ['dodgeMode', 'ignoreCancelReasons']) {
  test(`a held dodge with several stacks notifies once per instance under a dodge cancellation mask (${mask})`, () => {
    const { b, t, e } = fixture();
    b.addBuff(t, { key: 'dodge', refresh: 'stack', stacks: 3, mods: { dodgePhys: 1 } });
    assert.equal(t.findBuff('dodge').stacks, 3);
    let rolls = 0;
    const dodges = [], fx = [], fxOf = b.fx.bind(b);
    b.rng = () => { rolls++; return 0; };
    b.fx = (kind, data) => { if (kind === 'dodge') fx.push(data); return fxOf(kind, data); };
    b.on('dodge', c => { dodges.push(c.cancelled); });
    assert.equal(b.dealDamage({ source: e, target: t, amount: 100, type: 'phys',
      ...(mask === 'dodgeMode' ? { dodgeMode: 'uncancellable' } : { ignoreCancelReasons: ['dodge'] }) }), 100);
    assert.equal(rolls, 1, 'the stacks stop rolling at the first success');
    assert.deepEqual(dodges, [false]);
    assert.equal(fx.length, 1, 'one MISS for one hit');
  });
}

for (const uncancellable of [false, true]) {
  test(`actual miss remains recorded when its cancellation is ${uncancellable ? 'rejected' : 'accepted'}`, () => {
    const { b, t, e } = fixture();
    let instance, later = 0;
    b.on('hit', c => { instance = c.dmg; if (cancelDamage(c.dmg, 'miss')) c.stopPropagation = true; }, { priority: 100 });
    b.on('hit', () => { later++; });
    assert.equal(b.dealDamage({ source: e, target: t, amount: 100, type: 'phys', isAttack: true,
      ignoreCancelReasons: uncancellable ? ['miss'] : [] }), uncancellable ? 100 : 0);
    assert.equal(instance.missed, true);
    assert.equal(instance.cancel, !uncancellable);
    assert.equal(later, uncancellable ? 1 : 0);
  });
}

test('cancellation masks cannot bypass unrelated refusal, mode cap or malformed reason validation', () => {
  const { b, t, e } = fixture();
  const ignoreCancelReasons = ['dodge', 'block', 'miss'];
  b.on('hit', c => { if (c.target === t) c.dmg.cancel = true; });
  assert.equal(b.dealDamage({ target: t, amount: 100, type: 'true', ignoreCancelReasons }), 0);
  b.addBuff(e, { key: 'invulnerable', flags: { invulnerable: true } });
  assert.equal(b.dealDamage({ target: e, amount: 100, type: 'true', ignoreCancelReasons }), 0);
  b.removeBuff(e, 'invulnerable');
  b.kind = 'boss'; e.isBoss = true;
  b.addBuff(e, { key: 'count', shieldHits: 1 });
  assert.equal(b.dealDamage({ target: e, amount: 300000, type: 'true', ignoreCancelReasons }), 0);
  assert.equal(e.findBuff('count').shieldHits, 1);
  assert.throws(() => dealDamage(b, { target: t, amount: 1, ignoreCancelReasons: ['unknown'] }), TypeError);
  assert.throws(() => dealDamage(b, { target: t, amount: 1, ignoreCancelReasons: 'block' }), TypeError);
});

for (const kind of ['count', 'full', 'partial', 'special-hp']) {
  test(`Logos S1 native cancellation mask works through ${kind} and preserves its single survivor attempt`, () => {
    const h = makeBattle({ autoFinish: false, units: [{ uid: 'logos', diy: { slot: 6, charId: 'char_4133_logos', skillIndex: 0 }, row: 10, col: 5 }],
      defs: { enemies: { enemy_probe: enemyRec({ key: 'enemy_probe', hp: 1000, speed: 0, atk: 0, def: 0, res: 0 }) } } });
    h.step();
    const b = h.b, u = h.unit('logos'), e = h.spawn('enemy_probe', { pos: [10, 8] });
    e.hp = 10;
    b.addBuff(e, { key: 'attempt-dodge', injury(c) { c.dodge(1); } });
    if (kind !== 'special-hp') b.addBuff(e, { key: 'shield', ...(kind === 'count' ? { shieldHits: 1 } : { shield: kind === 'full' ? 10000000 : 40 }) });
    else b.addBuff(e, { key: 'special', flags: { hitCount: true } });
    const shield = e.findBuff('shield'), seen = [];
    b.rng = Object.assign(() => 0, b.rng);
    b.on('damageApplied', c => { if (c.target === e && c.dmg.tags.includes('execute')) seen.push(c); });
    assert.ok(u.skill.activate('test', { free: true }));
    u.atkCd = 999;
    h.step();
    assert.equal(seen.length, 1);
    assert.equal(seen[0].source, null);
    assert.equal(seen[0].credit, u);
    assert.equal(seen[0].amount, kind === 'partial' ? 9999959 : 9999999);
    assert.equal(seen[0].hpRemoved, kind === 'special-hp' ? 1 : 10);
    if (kind === 'full') assert.equal(shield.shield, 1);
    if (kind === 'count') assert.equal(shield.shieldHits, 0);
    if (kind === 'partial') assert.equal(shield.shield, 0);
    if (kind === 'special-hp') {
      assert.equal(e.hp, 9);
      h.step(2);
      assert.equal(seen.length, 1, 'surviving execution is not retried');
    } else assert.equal(e.alive, false);
    checkInvariants(b);
    assert.equal(b.errors.length, 0);
  });
}

for (const charId of ['char_4138_narant', 'char_1502_crosly', 'char_4132_ascln']) {
  for (const uncancellable of [false, true]) test(`${charId} retains one accuracy draw per attack under miss cancellation policy ${uncancellable}`, () => {
    const h = makeBattle({ autoFinish: false, units: [{ uid: 'operator', diy: { slot: 6, charId,
      skillIndex: charId === 'char_4132_ascln' ? 2 : 0 }, row: 10, col: 5 }],
      defs: { enemies: { enemy_probe: enemyRec({ key: 'enemy_probe', hp: 10000, speed: 0, atk: 0, def: 0, res: 0 }) } } });
    h.step();
    const b = h.b, u = h.unit('operator'), e = h.spawn('enemy_probe', { pos: [10, 6] });
    if (charId !== 'char_4138_narant' && !u.skill.active) assert.ok(u.skill.activate('test', { free: true }));
    u.hp = u.s.maxHp / 2;
    let rolls = 0;
    b.rng = Object.assign(() => { rolls++; return 0; }, b.rng);
    const hits = [], heals = [];
    b.on('hit', c => { if (c.source === e) hits.push(c.dmg); }, { priority: 1000 });
    b.on('heal', c => { if (c.target === u) heals.push(c); });
    for (const attackId of [501, 501, 502]) {
      const removed = b.dealDamage({ source: e, target: u, amount: 10, type: 'arts', calculation: 'resolved',
        isAttack: true, attackId, dodgeMode: 'ignore', noSp: true, ignoreCancelReasons: uncancellable ? ['miss'] : [] });
      assert.equal(removed, uncancellable ? 10 : 0);
    }
    assert.equal(rolls, 2);
    assert.equal(hits.length, 3);
    assert.ok(hits.every(d => d.missed && d.cancel === !uncancellable));
    assert.equal(heals.length, charId === 'char_4132_ascln' ? 2 : 0);
    checkInvariants(b);
    assert.equal(b.errors.length, 0, JSON.stringify(b.errors));
  });
}

for (const mode of ['normal', 'uncancellable', 'ignore']) test(`Tippi S2 activates while respecting ${mode} dodge policy`, () => {
  const h = makeBattle({ autoFinish: false, units: [{ uid: 'tippi', chessId: 'chess_char_2_13_a', row: 10, col: 5 }] });
  h.step();
  const b = h.b, u = h.unit('tippi'), dodges = [];
  u.skill.gainSp(999);
  assert.equal(u.skill.ready, true);
  b.on('dodge', c => { if (c.target === u) dodges.push(c.cancelled); });
  const hp = u.hp;
  assert.equal(b.dealDamage({ target: u, amount: 10, type: 'arts', calculation: 'resolved', dodgeMode: mode }), mode === 'normal' ? 0 : 10);
  assert.equal(u.hp, hp - (mode === 'normal' ? 0 : 10));
  assert.equal(u.skill.active, true);
  assert.deepEqual(dodges, mode === 'ignore' ? [] : [mode === 'normal']);
  checkInvariants(b);
  assert.equal(b.errors.length, 0, JSON.stringify(b.errors));
});

test('explicit dodge mode normalizes the legacy canDodge view used by content and plugins', () => {
  for (const mode of ['normal', 'uncancellable', 'ignore']) {
    const { b, t } = fixture();
    let seen;
    b.on('hit', c => { seen = c.dmg.canDodge; });
    b.dealDamage({ target: t, amount: 1, type: 'arts', dodgeMode: mode, canDodge: mode === 'ignore' });
    assert.equal(seen, mode !== 'ignore');
    assert.deepEqual(b.errors, []);
  }
});
