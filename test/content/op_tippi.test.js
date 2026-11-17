import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, checkInvariants } from '../helpers/battleHarness.js';
import { getDefaultSource } from '../../server/sim/simdata.js';

const ID = 'chess_char_2_13_a';
const stackTime = getDefaultSource().rawChess(ID).talents.find(t => t.index === 0).bb.stack_time;
function setup({ skill = false } = {}) {
  const h = makeBattle({ autoFinish: false,
    defs: { chess: { probe: chessRec({ id: 'probe', skill: null, stats: { atk: 0 } }) } },
    units: [{ uid: 'tippi', chessId: ID, row: 10, col: 5 }, { uid: 'source', chessId: 'probe', row: 12, col: 3 }] });
  h.step();
  const b = h.b, u = h.unit('tippi'), source = h.unit('source');
  u.profile.noAttack = source.profile.noAttack = true;
  if (!skill) b.addBuff(u, { key: 'test:noSkill', persist: true, flags: { silence: true } });
  return { h, b, u, source, hit: (opts = {}) => b.dealDamage({ target: u, amount: 10, type: 'arts', calculation: 'resolved', ...opts }) };
}
function done(b) { assert.deepEqual(b.errors, []); checkInvariants(b); }

test('Tippi: deployment waits for the native one-second stack timer; ready dodge persists until consumed', () => {
  const { h, b, u, hit } = setup();
  assert.equal(u.findBuff('tippi:evade'), null);
  assert.equal(hit(), 10);
  h.run(stackTime - 0.1);
  assert.equal(u.findBuff('tippi:evade'), null);
  h.run(0.2);
  const held = u.findBuff('tippi:evade');
  assert.ok(held);
  h.run(stackTime + 1);
  assert.equal(u.findBuff('tippi:evade'), held, 'waiting does not replace its acquisition position');
  const rng = b.rng.state();
  assert.equal(hit(), 0);
  assert.equal(b.rng.state(), rng, 'guaranteed native Evade has no probability roll');
  assert.equal(u.findBuff('tippi:evade'), null);
  assert.equal(hit(), 10);
  done(b);
});

test('Tippi: an earlier barrier preserves ready dodge; a later barrier is untouched by the dodge', () => {
  for (const earlier of [true, false]) {
    const { h, b, u, hit } = setup();
    if (earlier) b.addBuff(u, { key: 'test:barrier', shield: 100 });
    h.run(stackTime + 0.1);
    const held = u.findBuff('tippi:evade');
    if (!earlier) b.addBuff(u, { key: 'test:barrier', shield: 100 });
    assert.equal(hit(), 0);
    assert.equal(u.findBuff('test:barrier').shield, earlier ? 90 : 100);
    assert.equal(u.findBuff('tippi:evade'), earlier ? held : null);
    done(b);
  }
});

test('Tippi: cancelled injury restarts unready talent timing, HP loss and gauge intake do not', () => {
  for (const kind of ['barrier', 'hpLoss', 'gauge']) {
    const { h, b, u, hit } = setup();
    h.run(stackTime - 1);
    if (kind === 'barrier') { b.addBuff(u, { key: 'test:barrier', shield: 100 }); hit(); }
    if (kind === 'hpLoss') b.dealHPLose({ target: u, amount: 10 });
    if (kind === 'gauge') b.dealElementDamage({ target: u, amount: 10, element: 'burn' });
    h.run(1.1);
    assert.equal(!!u.findBuff('tippi:evade'), kind !== 'barrier');
    done(b);
  }
});

test('Tippi S2: target applying stage follows source output and suppresses all later injury effects on accepted dodge', () => {
  const { b, u, source, hit } = setup({ skill: true }), order = [];
  u.skill.gainSp(999);
  for (const event of ['damageCalculate', 'damageOutput', 'damageBeforeApply', 'damageApplying', 'dodge'])
    b.on(event, c => { if (c.target === u) order.push(event); }, { priority: 1000 });
  b.addBuff(u, { key: 'test:observer', observeInjury() { order.push('injury'); } });
  assert.equal(hit({ source, calculation: 'base' }), 0);
  assert.deepEqual(order, ['damageCalculate', 'damageOutput', 'damageBeforeApply', 'damageApplying', 'dodge']);
  assert.equal(u.skill.active, true);
  done(b);
});

test('Tippi S2: successful early dodge preserves both a ready talent and a running talent timer', () => {
  for (const ready of [false, true]) {
    const { h, b, u, hit } = setup({ skill: true });
    if (ready) h.run(stackTime + 0.1);
    else h.run(stackTime - 1);
    const held = u.findBuff('tippi:evade');
    u.skill.gainSp(999);
    assert.equal(hit(), 0);
    if (ready) assert.equal(u.findBuff('tippi:evade'), held);
    else { h.run(1.1); assert.ok(u.findBuff('tippi:evade'), 'the original deployment timer completes'); }
    done(b);
  }
});

test('Tippi: true damage and ignored dodge retain a ready charge; rejected dodge cancellation consumes it', () => {
  for (const kind of ['true', 'ignore', 'uncancellable']) {
    const { h, b, u, hit } = setup();
    h.run(stackTime + 0.1);
    const held = u.findBuff('tippi:evade');
    assert.equal(hit(kind === 'true' ? { type: 'true' } : { dodgeMode: kind }), 10);
    assert.equal(u.findBuff('tippi:evade'), kind === 'uncancellable' ? null : held);
    done(b);
  }
});

test('Tippi: death cancels pending talent acquisition and redeployment starts a fresh timer', () => {
  const { h, b, u } = setup();
  h.run(stackTime - 1);
  b.kill(u, null);
  h.run(1.1);
  assert.equal(u.findBuff('tippi:evade'), null);
  assert.equal(b.redeploy(u, { free: true }), true);
  b.addBuff(u, { key: 'test:noSkill', persist: true, flags: { silence: true } });
  h.run(stackTime - 0.1);
  assert.equal(u.findBuff('tippi:evade'), null);
  h.run(0.2);
  assert.ok(u.findBuff('tippi:evade'));
  done(b);
});
