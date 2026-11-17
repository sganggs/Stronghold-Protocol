import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';

function field({ sub = 'pioneer', enabled = true, charges = 1 } = {}) {
  const h = makeBattle({
    units: [{ chessId: 'test', row: 10, col: 5 }],
    defs: { chess: { test: chessRec({ id: 'test', subProf: sub, skill: { maxChargeTime: charges } }) } },
    kits: { test: () => ({ skill: { kind: charges > 1 ? 'charges' : 'duration', duration: 10, spCost: 10, maxCharges: charges, trigger: 'NEVER' } }) },
    flags: { dpInit: 50, dpPerSec: 0, dpMax: 99 },
    setup(b) { b.opts.resourceNumbers = enabled; },
  });
  h.b.start();
  h.b.drainEvents();
  return { h, b: h.b, u: h.unit('test'), events: () => h.b.drainEvents().filter((e) => e[0] === 'resource') };
}

test('SP receipts use actual recovery after hooks, caps and charge rollover', () => {
  const { b, u, events } = field({ charges: 2 });
  u.skill.setSpTotal(9);
  b.on('spGain', (ctx) => { if (ctx.reason === 'bond') ctx.amount = 4; });
  assert.equal(u.skill.gainSp(99, 'bond'), 4, 'legacy return value stays intact');
  assert.equal(u.skill.spTotal, 13);
  assert.deepEqual(events(), [['resource', u.id, 'sp', 4, 'bond']]);
  u.skill.setSpTotal(19.5);
  u.skill.gainSp(3, 'talent');
  assert.deepEqual(events(), [['resource', u.id, 'sp', 0.5, 'talent']]);
  u.skill.gainSp(3, 'skill');
  assert.deepEqual(events(), [], 'full charge gives nothing');
});

test('SP ordinary/init recovery, denied gifts and active timed skills do not pop', () => {
  const { b, u, events } = field();
  for (const reason of ['time', 'attack', 'hurt', 'init']) u.skill.gainSp(1, reason);
  assert.deepEqual(events(), []);
  b.addBuff(u, { key: 'test:no-sp', flags: { noSp: true } });
  u.skill.gainSp(2, 'talent');
  assert.deepEqual(events(), []);
  b.removeBuff(u, 'test:no-sp');
  b.on('spGain', (ctx) => { ctx.amount = 0; });
  u.skill.gainSp(2, 'skill');
  assert.deepEqual(events(), []);
  u.skill.active = true;
  u.skill.gainSp(2, 'bond');
  assert.deepEqual(events(), []);
});

test('COST receipts clamp at cap/zero, retain source and ignore natural DP', () => {
  for (const sub of ['pioneer', 'charger', 'agent', 'merchant']) {
    const { b, u, events } = field({ sub });
    const ps = b.getPlayer(u.ownerId);
    ps.dp = sub === 'merchant' ? 2 : 98;
    const delta = sub === 'merchant' ? -3 : 3;
    const result = b.addDp(u.ownerId, delta, u);
    assert.equal(result, sub === 'merchant' ? 0 : 99);
    assert.deepEqual(events(), [['resource', u.id, 'cost', sub === 'merchant' ? -2 : 1, sub]]);
    b.addDp(u.ownerId, delta, u);
    b.addDp(u.ownerId, -1);
    assert.deepEqual(events(), []);
  }
});

test('live-only observation changes no SP/DP result or random state', () => {
  const a = field(), z = field({ enabled: false });
  for (const f of [a, z]) {
    f.b.addDp(f.u.ownerId, 3, f.u);
    f.u.skill.gainSp(3, 'talent');
  }
  assert.equal(a.events().length, 2);
  assert.equal(z.events().length, 0);
  assert.deepEqual(a.b.snapshot(), z.b.snapshot());
  assert.equal(a.b.rng(), z.b.rng());
});

test('real pioneer and merchant sources attribute their automatic skill/pay receipts', () => {
  for (const id of ['chess_char_1_08_a', 'chess_char_3_04_a']) {
    const h = makeBattle({ units: [{ chessId: id, row: 10, col: 5 }],
      defs: { enemies: { dummy: enemyRec({ key: 'dummy', hp: 1e9, speed: 0 }) } },
      enemies: [{ key: 'dummy', pos: [10, 6] }], flags: { dpInit: 50, dpPerSec: 0 },
      setup(b) { b.opts.resourceNumbers = true; } });
    h.run(40);
    const events = h.eventsOf('resource').filter((e) => e[2] === 'cost');
    assert.ok(events.length > 0, id);
    assert.ok(events.every((e) => e[1] === h.unit(id).id && (id.includes('1_08') ? e[3] > 0 : e[3] < 0)));
  }
});
