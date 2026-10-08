// test/sim/charge-cap-release.test.js — 充能至上限立刻释放: the engine's full-charge release, and its OPT-IN.
//
// PRTS 技能 §特殊属性 / 可充能: 「一些技能中存在"可充能X次"的描述，其实际效果为当前技力上限等于该技能技力需求的X倍，从而实现
// 可连续释放该技能的效果…部分可充能技能在技力达到上限后（即充能次数达到上限）会立刻产生额外效果，如立刻释放一次」. Reaching
// the CAP is therefore an extra effect of the charge, not one of the trigger rules (skills.js header):
//
//   * it needs NO target -- a `charges` skill releases with an empty field, where the DEFAULT rule ("about to attack" +
//     an enemy in the initial range, `_defaultCondition`) never becomes true;
//   * it waits for nothing: no attack, no AUTO_OP_COOLDOWN («自动操作具有3s冷却，在完成一次操作…将进入冷却» is about an
//     OPERATION, and this release is the skill's own effect -- the cooldown is left exactly as it was, which is also what
//     lets the remaining charge be spent right afterwards: 「从而实现可连续释放」);
//   * it fires the moment the cap is reached, wherever that SP came from: the skill's own tick (time / attack SP) or the
//     landing hit of a projectile inside the same step (Battle._chargeCapReleases, after the projectiles phase).
//
// It is OPT-IN: PRTS says PART of the chargeable skills (部分可充能技能), so a skill only gets it by setting
// `SkillSpec.capRelease: true`. Without that flag nothing changed at all — the charges pile up to the cap and the trigger
// rules decide when they are spent, which is the behaviour every existing kit (and its test) relies on; that is asserted
// here as well, so a build that never opts in is byte for byte the one it was.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';

const dummy = (o = {}) => enemyRec({ key: 'enemy_dummy', hp: 1e7, def: 0, res: 0, atk: 0, speed: 0, ...o });

/**
 * A chargeable operator: a `charges` skill whose data record asks for `maxChargeTime` (= simdata.js `maxCharges`)
 * charges. The kit's spec records when, why and from how many charges it released -- `spRecovery` 3 SP/s and a cost of 3
 * keep a cap inside two seconds of game time, so a test does not have to run a whole battle for one.
 */
const CHARGEABLE = Object.freeze({ spType: 'INCREASE_WITH_TIME', spCost: 3, initSp: 0, maxChargeTime: 2, skillType: 'MANUAL', durationType: 'NONE' });

/**
 * One chargeable operator on the field. `o.capRelease` sets the SkillSpec opt-in (default false: the pre-existing
 * behaviour); `o.trigger`, `o.skill` and `o.rec` override the rest.
 */
function field(o = {}) {
  const log = o.log ?? [];
  const h = makeBattle({
    seed: 7, autoFinish: false, timeLimit: 60, content: 'generic',
    defs: {
      chess: {
        t_cap: chessRec({
          id: 't_cap', profession: 'WARRIOR', stats: { atk: 100, maxHp: 5000, bat: 1, aspd: 100, spRecovery: 3, blockCnt: 2 },
          skill: { ...CHARGEABLE, ...(o.skill ?? {}) }, ...(o.rec ?? {}),
        }),
      },
      enemies: { enemy_dummy: dummy() },
    },
    kits: {
      t_cap: () => ({
        skill: {
          kind: 'charges', trigger: o.trigger ?? 'DEFAULT', ...(o.capRelease ? { capRelease: true } : {}),
          onStart(ctx) { log.push({ t: ctx.battle.time, reason: ctx.reason, tick: ctx.battle.tickCount, charges: ctx.skill.charges + 1, sp: ctx.skill.sp }); },
        },
      }),
    },
    units: [{ chessId: 't_cap', row: 10, col: 4 }],
  });
  h.capLog = log;
  return h;
}

/** Step until `pred()` holds (or `max` steps went by). Returns the number of steps taken. */
function stepUntil(h, pred, max = 600) {
  for (let i = 0; i < max; i++) { if (pred()) return i; h.step(); }
  return max;
}

/**
 * Put the operator one tick of SP short of the cap (charge 1 of 2 stored, a third of a second of SP/s left), so the very
 * next step both fills the cap and is the step the release has to happen in.
 */
function seedOneTickShort(u) {
  u.skill.charges = 1;
  u.skill.sp = u.skill.spCost - 0.1;
}

// ---------------------------------------------------------------------------------------------------------------
// OPT-IN, OFF by default: no flag, no change

test('without capRelease a full store does NOT release: the charges pile up and the bar reads full (the old behaviour)', () => {
  const h = field();                                 // no `capRelease`: what every existing kit has
  const u = h.unit('t_cap');
  h.step();
  assert.equal(u.skill.kind, 'charges');
  assert.equal(u.skill.maxCharges, 2);
  assert.equal(u.skill.capRelease, false, 'the opt-in is off');
  assert.equal(u.skill.chargeCap, false, 'so the skill is never asked for the cap extra effect');
  assert.equal(h.b._hasChargeCap, false, 'and the battle skips the whole chargeCap phase');
  h.run(12);
  assert.equal(u.skill.charges, 2, 'both charges are stored, the cap included');
  assert.equal(u.skill.sp, u.skill.spCost, 'and `sp` is pinned at the cost: the bar reads full');
  assert.equal(u.skill.activations, 0, 'while the skill never fires -- nothing in range, no attack made');
  assert.equal(h.capLog.length, 0);
  // and the trigger rules still spend the store exactly as they did: an enemy its range covers arms DEFAULT
  const e = h.spawn('enemy_dummy', { pos: [10, 5] });   // a melee unit at (10,4) facing RIGHT covers (10,5)
  assert.ok(h.runUntil(() => h.capLog.length >= 1, 4), 'the ordinary rule cast once an enemy was in range');
  assert.equal(h.capLog[0].reason, 'DEFAULT');
  assert.equal(u.skill.charges, 1, 'one charge spent');
  assert.ok(e.alive);
  checkInvariants(h.b);
});

test('capRelease is per skill: only the skill that sets it is released at the cap', () => {
  const h = field({ capRelease: true });
  const u = h.unit('t_cap');
  h.step();
  assert.equal(u.skill.capRelease, true);
  assert.equal(u.skill.chargeCap, true);
  assert.equal(h.b._hasChargeCap, true, 'the battle enters the chargeCap phase');
  // the flag governs a `charges` skill only: an instant skill that carries it is left alone
  u.skill.kind = 'instant';
  assert.equal(u.skill.chargeCap, false);
  assert.equal(u.skill.onChargeCap(), false);
  u.skill.kind = 'charges';
  assert.equal(u.skill.chargeCap, true);
  checkInvariants(h.b);
});

// ---------------------------------------------------------------------------------------------------------------
// the two key cases (opt-in on)

test('the cap releases by itself: charges == maxCharges fires reason \'chargeFull\' (key case 1)', () => {
  const h = field({ trigger: 'NEVER', capRelease: true });   // no trigger rule: only the cap's own effect can fire it
  const u = h.unit('t_cap');
  h.step();
  assert.equal(u.skill.chargeCap, true, 'a multi-charge skill that opted in');
  assert.equal(u.skill.maxCharges, 2);
  assert.equal(u.skill.charges, 0, 'nothing stored yet');
  assert.equal(h.capLog.length, 0);
  // the bar fills charge by charge (3 SP each at 3 SP/s) and the SECOND one is the cap
  const n = stepUntil(h, () => h.capLog.length > 0, 120);
  assert.ok(n < 120, 'the cap was reached inside 4 s');
  assert.equal(h.capLog.length, 1, 'exactly one release');
  assert.equal(h.capLog[0].reason, 'chargeFull', 'with a reason that says the CAP caused it');
  assert.equal(h.capLog[0].charges, 2, 'from a full store');
  // tickCount is bumped at the END of a step, so the release carries the tick of the step it ended (or the one before)
  assert.ok(h.b.tickCount - h.capLog[0].tick <= 1, `released in the step whose charge filled the cap (${h.capLog[0].tick} vs ${h.b.tickCount})`);
  assert.equal(u.skill.charges, 1, 'one charge spent, one left');
  assert.equal(u.skill.activations, 1);
  assert.equal(u.skill.sp, 0, 'and its SP restarted (the spent charge\'s cost)');
  checkInvariants(h.b);
});

test('the cap releases with NOTHING in range: no enemy on the field, no attack, the bar full (key case 2)', () => {
  const h = field({ trigger: 'NEVER', capRelease: true });
  const u = h.unit('t_cap');
  assert.deepEqual(h.enemies(), [], 'the field is empty');
  const n = stepUntil(h, () => h.capLog.length > 0, 120);
  assert.ok(n < 120, 'the release happened anyway');
  assert.equal(h.capLog[0].reason, 'chargeFull');
  assert.equal(h.capLog[0].charges, 2, 'the bar read full and the skill fired by itself');
  assert.equal(h.hooksOf('attack').length, 0, 'the operator never attacked');
  assert.equal(u.stats.attacks, 0);
  // and it keeps releasing as the SP fills again: one charge is left, the next cap releases it too
  stepUntil(h, () => h.capLog.length > 1, 240);
  assert.equal(h.capLog.length, 2, 'a second cap, a second release');
  assert.equal(h.capLog[1].reason, 'chargeFull');
  checkInvariants(h.b);
});

// ---------------------------------------------------------------------------------------------------------------
// it is the cap's extra effect: no attack gate, no operation cooldown, once per cap

test('a full store with a target in range does not have to wait for an attack either', () => {
  const h = field({ trigger: 'DEFAULT', capRelease: true });
  const e = h.spawn('enemy_dummy', { pos: [10, 5] });
  const u = h.unit('t_cap');
  h.step();
  const attacks0 = u.stats.attacks;
  seedOneTickShort(u);
  u.skill.opReadyAt = h.b.time + 1.5;                // the 3 s operation cooldown is still running
  assert.equal(u.skill.opCooling, true);
  assert.equal(u.skill.onChargeCap(), false, 'not full yet');
  h.step();
  assert.equal(h.capLog.length, 1, 'the cap released');
  assert.equal(h.capLog[0].reason, 'chargeFull');
  assert.equal(u.stats.attacks, attacks0, 'with no attack of its own');
  assert.ok(e.alive);
  checkInvariants(h.b);
});

test('the release is not an 自动操作: it happens inside the operation cooldown and leaves it running', () => {
  const h = field({ trigger: 'NEVER', capRelease: true });
  const u = h.unit('t_cap');
  h.step();
  // one tick of SP short of the cap, inside the 3 s automatic-operation cooldown of the battle-start deployment
  seedOneTickShort(u);
  u.skill.opReadyAt = h.b.time + 1.5;                // as if a cast of its own inside the 3 s cooldown had set it
  const readyAt = u.skill.opReadyAt;
  assert.ok(readyAt > h.b.time, 'the automatic-operation cooldown is still running');
  assert.equal(u.skill.opCooling, true);
  assert.equal(u.skill.ready, true);
  assert.equal(u.skill.onChargeCap(), false, 'not full yet');
  h.step();                                          // the last bit of SP arrives: the cap releases
  assert.equal(h.capLog.length, 1);
  assert.equal(h.capLog[0].reason, 'chargeFull');
  assert.equal(u.skill.charges, 1, 'one charge spent, one left (「从而实现可连续释放」)');
  assert.equal(u.skill.opReadyAt, readyAt, `the cooldown is left exactly as it was (${u.skill.opReadyAt})`);
  assert.equal(u.skill.opCooling, true, 'and the engine\'s own automatic cast is still held back by it');
  assert.equal(h.capLog.length, 1, 'so no second cast came from the trigger rule');
  // the remaining charge is stored, and the ordinary rules spend it once the cooldown is over
  u.skill.setTrigger('SP_FULL');
  u.skill.opReadyAt = -Infinity;
  stepUntil(h, () => h.capLog.length > 1, 120);
  assert.equal(h.capLog.length, 2);
  assert.equal(h.capLog[1].reason, 'SP_FULL');
  checkInvariants(h.b);
});

test('the SP a projectile pays on impact releases the cap inside the SAME step (the phase after the projectiles)', () => {
  const h = field({ trigger: 'NEVER', capRelease: true });
  const u = h.unit('t_cap');
  h.step();
  u.skill.charges = 1;
  u.skill.sp = u.skill.spCost - 1;                   // the time SP of one step will not be enough on its own
  assert.equal(h.capLog.length, 0);
  assert.equal(u.skill.chargeCap, true);
  const t0 = h.b.tickCount;
  // a hit that lands in the projectiles phase of the next step and hands the skill the rest of its charge
  h.b.addProjectile({
    from: { x: 9, y: 10 }, to: { x: 9, y: 10 }, speed: 1, visual: 'arrow',
    onHit: () => { u.skill.gainSp(0.95, 'attack'); },
  });
  h.step();
  assert.equal(h.capLog.length, 1, 'released in the same step the SP arrived in');
  assert.equal(h.capLog[0].reason, 'chargeFull');
  assert.equal(h.capLog[0].tick, t0, 'the tick the projectile landed in');
  assert.equal(u.skill.charges, 1);
  checkInvariants(h.b);
});

test('the charge is spent exactly once per cap: no trailing release in the step after', () => {
  const h = field({ trigger: 'NEVER', capRelease: true });
  const u = h.unit('t_cap');
  stepUntil(h, () => h.capLog.length > 0, 120);
  const n = h.capLog.length;
  const acts = u.skill.activations;
  assert.equal(u.skill.charges, 1, 'the charge the release left is still stored (below the cap)');
  h.step();
  assert.equal(h.capLog.length, n, 'no trailing release');
  assert.equal(u.skill.activations, acts);
  checkInvariants(h.b);
});

// ---------------------------------------------------------------------------------------------------------------
// what the opt-in does NOT do

test('a single-charge skill is untouched: a full bar with nothing in range does NOT release', () => {
  const h = field({ trigger: 'NEVER', capRelease: true, skill: { maxChargeTime: 1 } });
  const u = h.unit('t_cap');
  assert.equal(u.skill.maxCharges, 1);
  assert.equal(u.skill.capRelease, true, 'the flag is set...');
  assert.equal(u.skill.chargeCap, false, '...but a single charge has no cap extra effect');
  assert.equal(h.b._hasChargeCap, false);
  h.run(10);
  assert.equal(u.skill.charges, 1, 'the one charge is stored');
  assert.equal(u.skill.sp, u.skill.spCost, 'and the bar reads full');
  assert.equal(h.capLog.length, 0);
  checkInvariants(h.b);
});

test('a battle without the opt-in is untouched: no extra casts, no errors, no phase', () => {
  const h = makeBattle({
    seed: 7, autoFinish: false, timeLimit: 30, content: 'generic',
    defs: {
      chess: { t_plain: chessRec({ id: 't_plain', profession: 'WARRIOR', stats: { atk: 100, maxHp: 5000, bat: 1, aspd: 100, spRecovery: 3 }, skill: { spCost: 3, initSp: 1.5, durationType: 'NONE', maxChargeTime: 2 } }) },
      enemies: { enemy_dummy: dummy() },
    },
    kits: { t_plain: () => ({ skill: { kind: 'charges', duration: 5 } }) },   // chargeable, but no capRelease
    units: [{ chessId: 't_plain', row: 10, col: 4 }],
  });
  const u = h.unit('t_plain');
  assert.equal(u.skill.kind, 'charges');
  assert.equal(u.skill.maxCharges, 2);
  assert.equal(u.skill.chargeCap, false);
  assert.equal(h.b._hasChargeCap, false, 'the whole phase is skipped when no skill opted in');
  const e = h.spawn('enemy_dummy', { pos: [10, 5] });
  h.run(3);
  assert.ok(u.skill.activations >= 1, 'the ordinary rules still cast');
  assert.equal(h.b.errorCount, 0);
  assert.ok(u.stats.attacks >= 1);
  assert.ok(e.hp <= e.s.maxHp);
  checkInvariants(h.b);
});

test('a stunned unit releases nothing; it releases as soon as it can act again', () => {
  const h = field({ trigger: 'NEVER', capRelease: true });
  const u = h.unit('t_cap');
  h.step();
  h.b.applyStatus(u, 'stun', { duration: 1, source: null, value: null });
  seedOneTickShort(u);
  h.step();
  assert.equal(u.canAct, false);
  assert.equal(h.capLog.length, 0, '晕眩 "无法攻击、释放技能": the cap waits');
  assert.equal(u.skill.charges, 2, 'the charge itself is stored');
  assert.equal(u.skill.sp, u.skill.spCost, 'and the bar reads full');
  stepUntil(h, () => u.canAct, 120);                 // the stun runs out
  assert.equal(u.canAct, true);
  assert.equal(h.capLog.length, 1, 'and the stored full charge releases then');
  assert.equal(h.capLog[0].reason, 'chargeFull');
  checkInvariants(h.b);
});

test('a silenced unit releases nothing (沉默 holds the cast back), and releases once it is over', () => {
  const h = field({ trigger: 'NEVER', capRelease: true });
  const u = h.unit('t_cap');
  h.step();
  h.b.addBuff(u, { key: 'test:silence', flags: { silence: true }, duration: 1 });
  seedOneTickShort(u);
  h.step();
  assert.equal(u.s.flags.silence, true);
  assert.equal(h.capLog.length, 0, 'nothing is released while silenced');
  assert.equal(u.skill.charges, 2, 'but the store fills');
  stepUntil(h, () => !u.s.flags.silence, 120);
  assert.ok(!u.s.flags.silence, 'the 沉默 effect is gone');
  assert.equal(h.capLog.length, 1);
  assert.equal(h.capLog[0].reason, 'chargeFull');
  checkInvariants(h.b);
});
