// Synthetic version of the round49 removeBuff reproduction; no official files in the fixtures.
// Source: activity_table.activity.AUTOCHESS_SEASON.act2autochess.bondInfoDict.sargonShip and
// effectBuffInfoDataDict.bondeffect_sargon: independent 5+0.22L s stacks, ASPD +12, six members ATK +12%, cap 25.
// Explicit removal models an extension API call, not a demonstrated vanilla gameplay trigger (DESIGN §35.5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, checkInvariants } from '../helpers/battleHarness.js';

const KEY = 'bond:sargon', ATK = `${KEY}:atk`;
const ids = Array.from({ length: 6 }, (_, i) => `remove_s${i}_a`);
function setup() {
  const h = makeBattle({
    defs: { chess: Object.fromEntries(ids.map(id => [id, chessRec({
      id, bonds: ['sargonShip'], stats: { atk: 1000 },
      skill: { duration: 1000, spCost: 1000, initSp: 0 },
    })])) },
    units: ids.map((chessId, i) => ({ chessId, row: 9 + Math.floor(i / 3), col: 2 + i % 3 })),
    bonds: { sargonShip: { active: true, count: 6, tier: 2, layers: 0 } }, autoFinish: false,
  });
  h.step();
  return { h, u: h.unit(ids[5]), cast(i = 0) {
    const u = h.unit(ids[i]); u.skill.end('test');
    assert.equal(u.skill.activate('test', { free: true }), true);
  } };
}

function trace(u) {
  const calls = [], stats = [];
  for (const [i, b] of u.buffs.filter(b => b.key === KEY).entries()) {
    for (const kind of ['onRemove', 'onExpire']) {
      const fn = b[kind];
      b[kind] = ctx => {
        calls.push([kind, i]); fn?.(ctx);
        stats.push([u.buffs.filter(b => b.key === KEY).length, u.s.aspd, u.s.atk]);
      };
    }
  }
  return { calls, stats };
}

test('Sargon six members: removing the last staggered stack also removes its ATK aggregate without throwing', () => {
  const p = setup(); p.cast(); p.h.run(1); p.cast(1);
  assert.deepEqual(p.u.buffs.map(b => b.key), [KEY, ATK, KEY]);
  const t = trace(p.u); p.h.run(4.1);
  assert.deepEqual(p.u.buffs.map(b => b.key), [ATK, KEY]);
  assert.deepEqual(t.calls, [['onExpire', 0]]);
  assert.equal(p.u.s.atk, 1120);

  assert.equal(p.h.b.removeBuff(p.u, KEY), 1, 'the nested ATK removal is excluded from the count');
  assert.deepEqual(p.u.buffs, []);
  assert.deepEqual(t.calls, [['onExpire', 0], ['onRemove', 1]]);
  assert.deepEqual(t.stats, [[1, 112, 1120], [0, 100, 1000]]);
  p.h.step();
  assert.deepEqual(p.h.b.errors, []);
  checkInvariants(p.h.b);
});

test('Sargon cap: an extension clears all six members and continues, with 25 reverse callbacks per removal', () => {
  const p = setup();
  for (let i = 0; i < 26; i++) p.cast();
  assert.deepEqual(p.u.buffs.map(b => b.key), [ATK, ...Array(25).fill(KEY)]);
  assert.equal(p.u.s.atk, 4000);
  const t = trace(p.u), counts = [];
  let continued = 0;
  p.h.b.on('test:clearSargon', () => {
    for (const id of ids) counts.push(p.h.b.removeBuff(p.h.unit(id), KEY));
    continued++;
  }, { once: true });
  p.h.b.emit('test:clearSargon', {});
  p.h.b.emit('test:clearSargon', {});

  assert.equal(continued, 1, 'the batch reaches its continuation and the once hook stays once');
  assert.deepEqual(counts, Array(6).fill(25));
  assert.deepEqual(t.calls, Array.from({ length: 25 }, (_, i) => ['onRemove', 24 - i]));
  for (const [n, aspd, atk] of t.stats) {
    assert.equal(aspd, 100 + 12 * n);
    assert.ok(Math.abs(atk - 1000 * (1 + 0.12 * n)) < 1e-6, 'ATK sync sees each intermediate stack count');
  }
  for (const id of ids) {
    const u = p.h.unit(id);
    assert.deepEqual(u.buffs, []);
    assert.equal(u.s.atk, 1000);
    assert.equal(u.s.aspd, 100);
  }
  p.h.step();
  assert.equal(p.h.b.finished, false);
  assert.deepEqual(p.h.b.errors, []);
  checkInvariants(p.h.b);
});
