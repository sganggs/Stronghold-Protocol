// #746: authoritative, read-only HUD values. Synthetic units; no official client files copied into fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, checkInvariants } from '../helpers/battleHarness.js';
import { bondTimerView } from '../../server/sim/content/bonds/timers.js';

const make = (bondId, count = 6, layers = 0) => makeBattle({
  defs: { chess: { timer_a: chessRec({ id: 'timer_a', bonds: [bondId], skill: { duration: 1000, spCost: 10, initSp: 0 } }) } },
  units: [{ chessId: 'timer_a', row: 10, col: 4 }],
  bonds: { [bondId]: { count, active: count >= 3, tier: count >= 6 ? 2 : 1, layers } }, autoFinish: false, timeLimit: 300,
});
const rows = h => h.snapshot().bondTimers?.find(r => r[0] === h.unit('timer_a').id)?.[1] || [];
const row = (h, id) => rows(h).find(r => r.id === id);
const activate = h => { const u = h.unit('timer_a'); u.skill.end('test'); u.skill.activate('test', { free: true }); };

test('Sargon: staggered stacks report their count and earliest expiry; gaining layers does not refresh old stacks', () => {
  const h = make('sargonShip', 6, 10); h.step(1);
  assert.deepEqual(rows(h), []);
  activate(h);
  assert.deepEqual(row(h, 'sargon'), { id: 'sargon', count: 1, remaining: 7.2 });
  h.run(2);
  h.b.addLayers('p1', 'sargonShip', 10, 'test');
  activate(h);
  assert.deepEqual(row(h, 'sargon'), { id: 'sargon', count: 2, remaining: 5.2 });
  h.run(5.3);
  assert.deepEqual(row(h, 'sargon'), { id: 'sargon', count: 1, remaining: 4.1 });
  h.run(4.2);
  assert.deepEqual(rows(h), []);
  checkInvariants(h.b);
});

test('Sargon: cap stays 25, explicit removal clears the readout immediately', () => {
  const h = make('sargonShip', 3); h.step(1);
  for (let i = 0; i < 30; i++) activate(h);
  assert.equal(row(h, 'sargon').count, 25);
  h.b.removeBuff(h.unit('timer_a'), 'bond:sargon');
  assert.equal(h.snapshot().bondTimers, undefined);
  checkInvariants(h.b);
});

test('Siracusa: three-member deployment has only ASPD; inactive bond has no readout', () => {
  const h = make('siracusaShip', 3, 10); h.step(1);
  assert.deepEqual(rows(h).map(r => r.id), ['siracusaAspd']);
  assert.ok(row(h, 'siracusaAspd').remaining > 35.9);
  const inactive = make('siracusaShip', 2); inactive.step(1);
  assert.equal(inactive.snapshot().bondTimers, undefined);
});

test('Siracusa: natural expiry replaces deploy ASPD/stealth with its separate 10-second window', () => {
  const h = make('siracusaShip'); h.step(1);
  assert.deepEqual(rows(h).map(r => r.id), ['siracusaAspd', 'siracusaStealth']);
  h.run(32);
  assert.deepEqual(rows(h).map(r => r.id), ['siracusaAfter']);
  assert.ok(row(h, 'siracusaAfter').remaining <= 10 && row(h, 'siracusaAfter').remaining >= 9.9);
  h.run(10.1);
  assert.deepEqual(rows(h), []);
  checkInvariants(h.b);
});

test('Siracusa: early stealth removal starts the window while ASPD continues; no display reads mutate state', () => {
  const h = make('siracusaShip'); h.step(1); h.run(2);
  const u = h.unit('timer_a');
  h.b.removeBuff(u, 'bond:siracusa:stealth');
  assert.deepEqual(rows(h).map(r => r.id), ['siracusaAspd', 'siracusaAfter']);
  assert.equal(row(h, 'siracusaAfter').remaining, 10);
  const before = { time: h.b.time, mem: { ...u.mem }, buffs: u.buffs.map(b => [b.key, b.timeLeft]), rng: h.b.rng.state };
  const snap = h.snapshot();
  for (let i = 0; i < 20; i++) assert.deepEqual(h.snapshot(), snap, 'paused reads never count down');
  assert.deepEqual({ time: h.b.time, mem: { ...u.mem }, buffs: u.buffs.map(b => [b.key, b.timeLeft]), rng: h.b.rng.state }, before);
  h.b.removeBuff(u, 'bond:siracusa');
  assert.deepEqual(rows(h).map(r => r.id), ['siracusaAfter']);
  h.run(10.1);
  assert.equal(h.snapshot().bondTimers, undefined);
});

test('death, hidden/undeployed units and a fresh deployment never carry stale clocks', () => {
  const h = make('siracusaShip'); h.step(1);
  const u = h.unit('timer_a');
  for (const patch of [{ alive: false }, { deployed: false }, { hidden: true }, { side: 'enemy' }]) {
    assert.deepEqual(bondTimerView({ ...u, ...patch }, h.b.time), []);
  }
  h.b.removeBuff(u, 'bond:siracusa:stealth'); h.run(3);
  assert.equal(row(h, 'siracusaAfter').remaining, 7);
  h.b.emit('deploy', { unit: u });
  assert.deepEqual(rows(h).map(r => r.id), ['siracusaAspd', 'siracusaStealth']);
  assert.equal(row(h, 'siracusaStealth').remaining, 32);
  h.b.kill(u);
  assert.equal(h.snapshot().bondTimers, undefined, 'death animation has no active readout');
});

test('JSON transport/reconnect is self-contained; invalid/infinite/expired durations are not numeric clocks', () => {
  const h = make('siracusaShip'); h.step(1); h.run(7);
  const snap = h.snapshot();
  assert.deepEqual(JSON.parse(JSON.stringify(snap)).bondTimers, snap.bondTimers);
  const u = h.unit('timer_a');
  const invalid = { ...u, mem: {}, buffs: [NaN, Infinity, -1, 0].map(timeLeft => ({ key: 'bond:sargon', timeLeft })) };
  assert.deepEqual(bondTimerView(invalid, h.b.time), []);
});
