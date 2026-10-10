// #440: special targeting supplies the DEFAULT attack opportunity, without extending S2 links.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { COLS } from '../../server/sim/constants.js';

function field(skillIndex, kind = 'unite') {
  const h = makeBattle({ kind, timeLimit: 90, autoFinish: false, seed: 5,
    flags: { dpPerSec: 0, dpMax: 999 }, hooks: ['skillStart', 'damaged'], captureNoisy: true,
    defs: { enemies: { weak: enemyRec({ key: 'weak', hp: 100, speed: 0, mass: 0 }),
      walker: enemyRec({ key: 'walker', hp: 1e9, speed: 0.5, mass: 0 }) } },
    units: [{ uid: 1, elite: true, row: 10, col: 3,
      diy: { slot: 'chess_char_6_diy1_a', charId: 'char_450_necras', skillIndex, uniEquipId: null } }],
  });
  h.step();
  const u = h.unit(1);u.skill.sp = 0;
  const weak = h.spawn('weak', { pos: [10, 6] });h.step();h.b.kill(weak, null);h.run(0.2);
  const summon = u.mem.necras.skels.find((s) => s.alive);assert.ok(summon);
  const e = h.spawn('walker', { pos: [10, 9] });
  assert.ok(h.runUntil(() => e.blockedBy === summon, 20));h.step(3);
  const key = Math.round(e.y) * COLS + Math.round(e.x);
  assert.ok(!u.baseRangeKeys.includes(key) && u.extraRangeKeys.includes(key));
  return { h, u, e, summon };
}
function done(h) { checkInvariants(h.b);assert.deepEqual(h.b.errors, []); }
for (const kind of ['normal', 'unite']) for (const skillIndex of [0, 1]) {
  test(`Necras S${skillIndex + 1} starts on its next attack against a summon-blocked remote target (${kind})`, () => {
    const { h, u, e } = field(skillIndex, kind);
    u.skill.gainSp(999);u.atkCd = 0.7;
    h.run(0.3);assert.equal(u.skill.activations, 0, 'retain attack cadence');
    h.run(0.6);assert.equal(u.skill.activations, 1);
    if (skillIndex === 1) assert.ok(!u.mem.necrasLinks?.some((l) => l.e === e), 'remote trigger does not extend S2 effect range');
    done(h);
  });
}
test('remote Necras trigger needs a selectable enemy and the owning summon', () => {
  const { h, u, e, summon } = field(1);
  e.base.moveSpeed = 0;e.markDirty();
  h.b.applyStatus(e, 'sleep', { duration: 5 });u.skill.gainSp(999);u.atkCd = 0;
  h.run(1);assert.equal(u.skill.activations, 0, 'sleep cannot open DEFAULT');
  h.b.retreat(summon, { reason: 'test' });
  h.run(5);assert.equal(u.skill.activations, 0, 'expired block does not retain an extra trigger');
  done(h);
});
