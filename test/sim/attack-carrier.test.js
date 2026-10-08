// test/sim/attack-carrier.test.js â€?the two OPT-IN profile fields a kit uses when its own projectile IS the attack:
//
//   noAttackVis    the ordinary attack has no visual of its own: the 'atk' event reports 'none' instead of the profile's
//                  projectile. On its own it changes nothing else â€?the engine's arrow still flies and still lands its
//                  damage, `ranged` included; it only stops a client from drawing a second, wrong projectile next to the
//                  kit's own (ai.js performAttack).
//   noAttackDamage the ordinary attack deals none of its own damage AND is left incomplete: the engine's hit is skipped
//                  (`dealDamage`) and the attack pays no attack-type SP / charge (`onAttackPerformed`), because the
//                  CONTENT's projectile settles both when IT reaches the enemy (ai.js performAttack / resolveHit). Only
//                  the HP loss and the settlement are skipped â€?every other effect of the hit (a skill's
//                  `attack.onHit` / `onEachHit`, the status riders, the splash / chain picks, åä¼¤ and the other on-hit
//                  hooks) stays the engine's, so a kit that hangs its own projectiles on the engine's hit keeps working.
//
// Both are read from the PROFILE, which a kit overrides with its `trait` block (professions.js resolveProfile). A profile
// that sets neither runs every line as before â€?asserted here, since that is the whole backward-compatibility claim.
//
// The synthetic kits below are injected through the harness `kits` option keyed by the unit's base chess id, which is
// exactly how a real kit reaches a profile (content/index.js setupUnitKit: `kits[baseChessId]` first).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';

const dummy = (o = {}) => enemyRec({ key: 'enemy_dummy', hp: 1e6, def: 0, res: 0, atk: 0, speed: 0, ...o });

/** A ranged (SNIPER) operator: row 10 col 4 facing RIGHT â‡?the attack range is cols 4â€? on row 10. */
const sniper = (o = {}) => chessRec({
  id: 't_shot', profession: 'SNIPER', rangeGrid: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]],
  stats: { atk: 100, maxHp: 5000, bat: 1, aspd: 100, spRecovery: 0, blockCnt: 1 },
  skill: null,
  ...o,
});

/**
 * A battle with one sniper and one stationary dummy. `kit` is a kit object (or `(bb, chess, def) => kit`) keyed to the
 * sniper's base chess id â€?the harness injects it through `Battle opts.kits`, the content registry's own override hook
 * (content/index.js setupUnitKit: `kits[baseChessId]` first, which is why `content: 'generic'` is the mode here â€?a
 * `'none'` field resolves no kits at all). The `atk`/`attack`/`hit` hooks are counted, not captured (battleHarness
 * NOISY), so counts are what the tests read.
 */
function field(o = {}) {
  return makeBattle({
    seed: 7, autoFinish: false, timeLimit: 60, content: 'generic',
    defs: { chess: { t_shot: sniper(o.rec) }, enemies: { enemy_dummy: dummy() } },
    kits: o.kit ? { t_shot: typeof o.kit === 'function' ? o.kit : () => o.kit } : undefined,
    units: [{ chessId: 't_shot', row: 10, col: 4 }],
  });
}

const attacks = (h) => h.hooksOf('attack').length;
const hits = (h) => h.hooksOf('hit').length;
const visOf = (h) => h.eventsOf('atk').map((t) => t[3]);

// ---------------------------------------------------------------------------------------------------------------
// the baseline: a profile that sets neither field behaves exactly as it did before

test('a profile without the opt-ins is unchanged: the arrow is reported, it lands, the attack is settled', () => {
  const h = field();
  const u = h.unit('t_shot');
  const e = h.spawn('enemy_dummy', { pos: [10, 8] });
  h.run(2);
  assert.ok(attacks(h) >= 1, 'it attacked');
  assert.deepEqual([...new Set(visOf(h))], ['arrow'], `the 'atk' event carries the profile's projectile (${JSON.stringify(visOf(h))})`);
  assert.ok(e.hp < e.s.maxHp, `the arrow landed damage (hp=${e.hp})`);
  assert.equal(u.stats.attacks, attacks(h), 'every attack went through the whole attack pipeline');
  assert.ok(hits(h) >= 1, 'and through the damage pipeline');
  checkInvariants(h.b);
});

test('noAttackVis alone: the event says "none", the arrow still flies and still lands its damage', () => {
  const h = field({ kit: { trait: { noAttackVis: true } } });
  const u = h.unit('t_shot');
  assert.equal(u.profile.noAttackVis, true, 'the kit\'s trait block reached the profile');
  const e = h.spawn('enemy_dummy', { pos: [10, 8] });
  h.run(2);
  assert.ok(attacks(h) >= 1, 'it attacked');
  assert.deepEqual([...new Set(visOf(h))], ['none'], 'the client is told there is no visual of the engine\'s');
  assert.ok(e.hp < e.s.maxHp, 'and the hit is untouched: noAttackVis alone takes nothing away');
  assert.ok(hits(h) >= 1);
  assert.equal(u.stats.attacks, attacks(h));
  checkInvariants(h.b);
});

// ---------------------------------------------------------------------------------------------------------------
// the two together: the content's projectile carries the attack

test('noAttackVis/noAttackDamage: the engine\'s attack carries no visual, no damage and no settlement', () => {
  const h = field({ kit: { trait: { projectile: 'arrow', noAttackVis: true, noAttackDamage: true } } });
  const u = h.unit('t_shot');
  const e = h.spawn('enemy_dummy', { pos: [10, 8] });
  assert.equal(u.profile.noAttackDamage, true);
  h.run(2);
  assert.ok(attacks(h) >= 1, 'it attacked');
  assert.equal(e.hp, e.s.maxHp, 'the engine\'s own hit dealt nothing');
  assert.equal(hits(h), 0, 'and it never ran the damage pipeline (which is what the hook observes)');
  assert.deepEqual([...new Set(visOf(h))], ['none'], 'the client is told there is no visual of the engine\'s');
  assert.equal(u.stats.attacks, attacks(h), 'it is still an attack of the unit (ai.js counts it)');
  // the hit itself is not lost: it is what the CONTENT settles when its own projectile reaches the enemy
  const before = e.hp;
  h.b.dealDamage(u, e, { amount: 37, type: 'phys', isAttack: true });
  assert.equal(e.hp, before - 37, 'a content settlement is an ordinary hit');
  assert.ok(hits(h) >= 1, 'and it runs the damage pipeline like any other');
  checkInvariants(h.b);
});

test('noAttackDamage keeps the hit\'s other effects: skill onHit / onEachHit run, the splash is picked but deals 0', () => {
  const seen = { onHit: 0, onEachHit: 0, splash: 0 };
  const h = field({
    kit: {
      trait: { splashRadius: 1, noAttackVis: true, noAttackDamage: true },
      skill: {
        kind: 'duration', duration: 10, spCost: 0,
        attack: {
          onHit: (ctx) => { seen.onHit++; seen.target = ctx.target; },
          onEachHit: (ctx) => { seen.onEachHit++; if (ctx.kind === 'splash') seen.splash++; },
        },
      },
    },
  });
  const u = h.unit('t_shot');
  h.step();
  const e = h.spawn('enemy_dummy', { pos: [10, 8] });
  const side = h.spawn('enemy_dummy', { pos: [10, 9] });   // inside the 1-tile splash of the first
  assert.equal(u.skill.activate('test'), true, 'the skill runs: its attack rides the next attack');
  h.run(2);
  assert.ok(seen.onHit >= 1, 'the skill\'s attack.onHit still ran');
  assert.ok(seen.onEachHit >= 2, `the main target and the splash victim were both reported (${JSON.stringify(seen)})`);
  assert.ok(seen.splash >= 1, 'the splash pick is the engine\'s');
  assert.equal(seen.target, e);
  assert.equal(e.hp, e.s.maxHp, 'no HP loss from the engine\'s hit, main target included');
  assert.equal(side.hp, side.s.maxHp, 'no HP loss on the splash either');
  checkInvariants(h.b);
});

test('an attack-type SP skill gains nothing from a carried attack, and pays it when the content\'s projectile lands', () => {
  // spType INCREASE_WHEN_ATTACK, spCost 3: with `noAttackDamage` the engine completes no attack for the ordinary arrow,
  // so the charge only arrives when the kit reports its own projectile's contact (SkillRuntime.onAttackPerformed)
  const h = field({
    rec: { skill: { spType: 'INCREASE_WHEN_ATTACK', spCost: 3, initSp: 0, skillType: 'MANUAL', durationType: 'NONE' } },
    kit: { trait: { noAttackVis: true, noAttackDamage: true }, skill: { kind: 'instant' } },
  });
  const u = h.unit('t_shot');
  const e = h.spawn('enemy_dummy', { pos: [10, 8] });
  h.run(10);
  assert.ok(u.stats.attacks >= 3, `it kept attacking (${u.stats.attacks})`);
  assert.equal(u.skill.sp, 0, 'none of those attacks recovered SP (the content projectile is the attack)');
  assert.equal(u.skill.charges, 0);
  // the content's projectile reaches the enemy: THAT is the attack's settlement
  u.skill.onAttackPerformed([e], false, false);
  assert.equal(u.skill.charges, 0, 'one hit is not enough for a cost of 3');
  assert.equal(u.skill.sp, 1, 'and it is the content\'s hit that paid it');
  u.skill.onAttackPerformed([e], false, false);
  u.skill.onAttackPerformed([e], false, false);
  assert.equal(u.skill.charges, 1, 'three content hits = one charge, exactly as three ordinary attacks would');
  checkInvariants(h.b);
});

test('noAttackVis reaches the "atk" event of a MELEE profile too â€?it only removes a visual, never a hit', () => {
  const h = makeBattle({
    seed: 7, autoFinish: false, timeLimit: 60, content: 'generic',
    defs: {
      chess: { t_melee: chessRec({ id: 't_melee', profession: 'WARRIOR', stats: { atk: 100, maxHp: 5000, bat: 1, aspd: 100, spRecovery: 0 } }) },
      enemies: { enemy_dummy: dummy() },
    },
    kits: { t_melee: () => ({ trait: { noAttackVis: true } }) },
    units: [{ chessId: 't_melee', row: 10, col: 4 }],
  });
  const e = h.spawn('enemy_dummy', { pos: [10, 5] });
  h.run(2);
  assert.ok(h.eventsOf('atk').length >= 1, 'it attacked');
  assert.deepEqual([...new Set(visOf(h))], ['none'], 'the melee blow reports no projectile either');
  assert.ok(e.hp < e.s.maxHp, 'a melee hit is not a projectile: noAttackVis takes nothing away from it');
  checkInvariants(h.b);
});

test('a heal profile with noAttackDamage still heals â€?the opt-in only governs the ATTACK path', () => {
  // `noAttackDamage` is read in performAttack (the non-heal branch) and in resolveHit: doHeal is untouched, so a medic
  // that sets it keeps healing allies (a kit only ever sets it on an attack profile)
  const h = makeBattle({
    seed: 7, autoFinish: false, timeLimit: 60, content: 'generic',
    defs: {
      chess: {
        t_med: chessRec({ id: 't_med', profession: 'MEDIC', rangeGrid: [[0, 0], [0, 1], [0, 2]], stats: { atk: 100, maxHp: 3000, bat: 1, aspd: 100, spRecovery: 0 } }),
        t_hurt: chessRec({ id: 't_hurt', profession: 'WARRIOR', stats: { atk: 10, maxHp: 3000, bat: 1, aspd: 100, spRecovery: 0 } }),
      },
      enemies: { enemy_dummy: dummy() },
    },
    kits: { t_med: () => ({ trait: { noAttackDamage: true } }) },
    units: [{ chessId: 't_med', row: 10, col: 4 }, { chessId: 't_hurt', row: 10, col: 5 }],
  });
  const hurt = h.unit('t_hurt');
  h.step();
  hurt.hp = 1000;
  h.run(2);
  assert.ok(hurt.hp > 1000, `the medic still healed (hp=${hurt.hp})`);
  assert.ok(h.hooksOf('heal').length >= 1);
  checkInvariants(h.b);
});
