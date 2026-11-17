// DESIGN §35.5: synthetic callbacks exercise the public API's re-entrant removal contract.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, checkInvariants } from '../helpers/battleHarness.js';

const KEY = 'test:stack';
const make = () => makeBattle({
  defs: { chess: { remove_a: chessRec({ id: 'remove_a', skill: null }) } },
  units: [{ chessId: 'remove_a', row: 10, col: 4 }], content: 'none', autoFinish: false,
});

test('removeBuff: nested removals retain reverse callback order, real counts, flags and status events', () => {
  const h = make(); h.step();
  const u = h.unit('remove_a'), calls = [], nested = [];
  let expired = 0;
  const record = name => calls.push([name, u.buffs.filter(b => b.key === KEY).length, u.s.aspd, !!u.flags.disarm]);
  h.b.addBuff(u, { key: 'test:other', visible: true, onRemove: () => record('other') });
  const add = (name, onRemove) => h.b.addBuff(u, {
    key: KEY, refresh: 'independent', maxStacks: 10, visible: true,
    mods: { aspd: 1 }, flags: { disarm: true },
    onRemove: () => { record(name); onRemove?.(); }, onExpire: () => expired++,
  });
  add('oldest');
  const middle = add('middle');
  add('next');
  add('latest', () => {
    nested.push(h.b.removeBuff(u, middle));
    nested.push(h.b.removeBuff(u, 'test:other'));
  });

  assert.equal(h.b.removeBuff(u, KEY), 3, 'the nested removals are counted by their own calls');
  assert.deepEqual(nested, [1, 1]);
  assert.deepEqual(calls, [
    ['latest', 3, 103, true], ['middle', 2, 102, true], ['other', 2, 102, true],
    ['next', 1, 101, true], ['oldest', 0, 100, false],
  ]);
  assert.equal(expired, 0, 'explicit removal never calls onExpire');
  assert.deepEqual(u.buffs, []);
  assert.deepEqual(h.eventsOf('status'), [
    ['status', u.id, 'test:other', 1], ['status', u.id, KEY, 1],
    ['status', u.id, 'test:other', 0], ['status', u.id, KEY, 0],
  ]);
  assert.equal(h.b.removeBuff(u, middle), 0, 'an already removed object is a no-op');
  assert.equal(h.b.removeBuff(u, KEY), 0);
  assert.equal(h.b.removeBuff(null, KEY), 0);
  assert.deepEqual(h.b.errors, []);
  checkInvariants(h.b);
});

test('removeBuff: a callback can replace a pending match without removing the new same-key instance', () => {
  const h = make(); h.step();
  const u = h.unit('remove_a'), calls = [];
  let nestedCount, added;
  const add = (name, onRemove) => h.b.addBuff(u, {
    key: KEY, refresh: 'independent', maxStacks: 10,
    onRemove: () => { calls.push(name); onRemove?.(); },
  });
  add('oldest');
  const middle = add('middle');
  add('latest', () => {
    nestedCount = h.b.removeBuff(u, middle);
    added = add('new');
  });

  assert.equal(h.b.removeBuff(u, KEY), 2);
  assert.equal(nestedCount, 1);
  assert.deepEqual(calls, ['latest', 'middle', 'oldest']);
  assert.equal(u.buffs.length, 1);
  assert.equal(u.buffs[0], added);
  assert.equal(h.b.removeBuff(u, middle), 0, 'same key does not make an absent object match');
  assert.equal(h.b.removeBuff(u, added), 1);
  assert.equal(h.b.removeBuff(u, added), 0);
  assert.deepEqual(calls, ['latest', 'middle', 'oldest', 'new']);
  assert.deepEqual(h.b.errors, []);
  checkInvariants(h.b);
});
