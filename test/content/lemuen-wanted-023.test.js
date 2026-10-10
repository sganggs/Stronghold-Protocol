import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
const LEM = 'chess_char_6_01_a';
function field({ skillIndex = 2, second = false, unite = false } = {}) {
  const units = [{ uid: 1, chessId: LEM, row: 12, col: 2, skillIndex, potential: 1 },
    { uid: 2, chessId: 'chess_char_2_01_a', row: 9, col: 7 }];
  if (second) units.push({ uid: 3, chessId: LEM, row: 12, col: 4, skillIndex, potential: 1 });
  const config = { defs: { enemies: { target: enemyRec({ key: 'target', rank: 'ELITE', hp: 1e9, speed: 0 }) } },
    units, enemies: [{ key: 'target', pos: [9, 8] }], autoFinish: false, hooks: ['skillStart'] };
  if (unite) {
    config.kind = 'unite';
    config.players = [{ playerId: 'p1', seat: 0, side: 'L', colOffset: 0, bonds: {}, units: [{ kind: 'chess', ...units[0] }] },
      { playerId: 'p2', seat: 1, side: 'L', colOffset: 0, bonds: {}, units: [{ kind: 'chess', ...units[1] }] }];
    delete config.units;
  }
  const h = makeBattle(config);h.step();return { h, u: h.unit(1), e: h.enemies()[0] };
}
function done(h) { checkInvariants(h.b); assert.deepEqual(h.b.errors, []); }
for (const elite of [false, true]) test(`rear player's 蕾缪安 S3 locks and spends ammo on the front player's wanted target (elite=${elite})`, () => {
  const h = makeBattle({ kind: 'unite', autoFinish: false, flags: { startOpCooldown: 3 },
    hooks: ['ammoUsed'], captureNoisy: true,
    defs: { enemies: { target: enemyRec({ key: 'target', rank: 'ELITE', hp: 1e9, atk: 0, speed: 0 }) } },
    players: [
      { playerId: 'front', seat: 0, side: 'L', colOffset: 0, bonds: {},
        units: [{ kind: 'chess', uid: 1, chessId: 'chess_char_2_01_a', row: 9, col: 7 }] },
      { playerId: 'rear', seat: 1, side: 'L', colOffset: 0, bonds: {},
        units: [{ kind: 'chess', uid: 2, chessId: elite ? 'chess_char_6_01_b' : LEM, row: 12, col: 2,
          skillIndex: 2, carryState: { sp: 999 } }] },
    ], enemies: [{ key: 'target', pos: [9, 8] }],
  });
  h.step(); const u = h.unit(2), e = h.enemies()[0];
  assert.equal(u.ownerId, 'rear'); assert.equal(h.b.enemiesInKeys(u.baseRangeKeys, u, u.profile).length, 0);
  assert.ok(h.runUntil(() => h.hooksOf('ammoUsed').some(c => c.unit === u), 25));
  assert.ok(e.findBuff('lemuen:wanted')); assert.ok(u.mem.lemLocks.some(l => l.e === e));
  assert.ok(u.skill.activations > 0); done(h);
});

for (const skillIndex of [0, 1, 2]) for (const unite of [false, true]) {
  test(`通缉 opens S${skillIndex + 1} outside original range (unite=${unite})`, () => {
    const { h, u, e } = field({ skillIndex, unite });
    u.skill.gainSp(999);h.run(8.5);
    assert.ok(e.findBuff('lemuen:wanted'));
    assert.ok(h.hooksOf('skillStart').some(c => c.unit === u));
    done(h);
  });
}
test('a new 通缉 timer waits for selectability; an existing timer continues through sleep', () => {
  for (const startBeforeSleep of [false, true]) {
    const { h, u, e } = field();
    if (startBeforeSleep) h.run(0.5);
    h.b.applyStatus(e, 'sleep', { duration: 10 });
    u.skill.gainSp(999);h.run(8.5);
    assert.equal(!!e.findBuff('lemuen:wanted'), startBeforeSleep);
    assert.equal(u.skill.active, false, 'sleep cannot trigger the skill');
    h.run(2);
    assert.equal(u.skill.active, startBeforeSleep, 'waking a marked enemy opens S3');
    if (!startBeforeSleep) { h.run(8);assert.ok(e.findBuff('lemuen:wanted')); }
    done(h);
  }
});
test('each 蕾缪安 clears only her own timer/mark on exit and starts fresh on redeployment', () => {
  const { h, u, e } = field({ second: true });const other = h.unit(3);
  h.run(8.5);assert.ok(e.findBuff('lemuen:wanted'));
  h.b.retreat(u, { reason: 'test' });assert.ok(e.findBuff('lemuen:wanted'), 'other source remains');
  h.b.retreat(other, { reason: 'test' });assert.equal(e.findBuff('lemuen:wanted'), null);
  h.b.redeploy(u, { free: true });h.run(0.5);assert.equal(e.findBuff('lemuen:wanted'), null);
  h.run(8);assert.ok(e.findBuff('lemuen:wanted'));
  done(h);
});

test('immediate redeployment cannot attack through a cleared wanted range', () => {
  const { h, u, e } = field();h.run(8.5);assert.ok(e.findBuff('lemuen:wanted'));
  h.b.retreat(u, { reason: 'test' });
  assert.equal(e.findBuff('lemuen:wanted'), null);
  assert.equal(h.b.enemiesInKeys(u.extraRangeKeys || [], u, u.profile).length, 0);
  h.b.redeploy(u, { free: true });const before = u.stats.attacks;u.atkCd = 0;
  h.step();assert.equal(u.stats.attacks, before, 'the allies phase sees the cleared range immediately');
  done(h);
});

for (const skillIndex of [0, 1, 2]) test(`wanted S${skillIndex + 1} waits for the next attack, not the next tick`, () => {
  const { h, u, e } = field({ skillIndex });
  u.skill.sp = 0;h.run(8.5);assert.ok(e.findBuff('lemuen:wanted'));
  u.atkCd = 0.7;u.skill.gainSp(999);
  h.run(0.3);assert.equal(u.skill.activations, 0);
  h.run(0.6);assert.equal(u.skill.activations, 1);done(h);
});
