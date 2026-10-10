import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KITS } from '../../server/sim/content/kits/index.js';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';

const GUAY = 'uniequip_003_shu', CRUY = 'uniequip_003_ulpia';
const approx = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
const target = enemyRec({ key: 'dummy', hp: 1e8, speed: 0, def: 0, atk: 0 });
const war = chessRec({ id: 'war', profession: 'WARRIOR', skill: null, stats: { atk: 100, blockCnt: 0 } });
const med = chessRec({ id: 'med', profession: 'MEDIC', skill: null, stats: { atk: 100, blockCnt: 0 } });
const helpers = [2, 3, 4].map((uid) => ({ uid, chessId: 'war', row: 10, col: uid }));
function shu(tier, others = []) {
  const h = makeBattle({ defs: { enemies: { dummy: target }, chess: { war, med } }, autoFinish: false,
    units: [{ uid: 1, diy: { slot: tier, charId: 'char_2025_shu', skillIndex: 2, uniEquipId: GUAY }, elite: true, row: 11, col: 5 }, ...others] });
  h.step(); return { h, u: h.unit(1) };
}

test('黍 GUA-Y stage 1/3 reduces incoming damage by 15%, independently of HP, after deployment', () => {
  for (const tier of [5, 6]) {
    const { h, u } = shu(tier);
    approx(u.s.dmgTakenMul, 0.85);
    const e = h.spawn('dummy', { pos: [10, 9] });
    const hp = u.hp;
    h.b.dealDamage(e, u, { amount: 100, type: 'true' });
    approx(hp - u.hp, 85);
    const hp2 = u.hp;
    h.b.dealDamage(e, u, { amount: 100, type: 'elemental' });
    approx(hp2 - u.hp, 100);
    checkInvariants(h.b); assert.equal(h.b.errors.length, 0);
  }
});

test('黍 GUA-Y stage 3 requires two conditions, buffs each operator once, and drops the bonus when a condition ends', () => {
  for (const tier of [5, 6]) {
    const { h, u } = shu(tier, [...helpers, { uid: 5, chessId: 'med', row: 9, col: 3 }]);
    h.run(0.3);
    const a = h.unit(2);
    approx(a.s.atk / a.base.atk, tier === 6 ? 1.05 : 1);
    assert.equal(a.s.aspd, tier === 6 ? 116 : 112);
    h.b.retreat(h.unit(5), { permanent: true });
    h.run(0.7);
    approx(a.s.atk / a.base.atk, 1);
    assert.equal(u.s.aspd, tier === 6 ? 116 : 112);
    checkInvariants(h.b); assert.equal(h.b.errors.length, 0);
  }
});

function ulpia({ moduleId = CRUY, potential = 6, stage3 = false } = {}) {
  // The mode's tier-5 elite only exposes module stage 1. Exercise its stage-3 talent separately using the
  // official CRU-Y blackboard (battle_equip_table, 2026-10-09); do not change the production slot's module level.
  const kits = stage3 ? { chess_char_5_05_a: (bb, raw, def) => {
    const rec = structuredClone(raw);
    rec.talents.find((t) => t.index === 1).bb = {
      max_stack_cnt: potential === 6 ? 10 : 9, max_hp: 150, atk: 38,
      'ulpia_t_1[abyssal].max_hp': 90, 'ulpia_t_1[abyssal].atk': 22.799999,
      'ulpia_t_1[abyssal].max_stack_cnt': potential === 6 ? 10 : 9,
      block_cnt: 1, add_block_cnt_stack_cnt: 9,
    };
    return KITS.chess_char_5_05_a(bb, rec, def);
  } } : undefined;
  const h = makeBattle({ autoFinish: false, kits, defs: { enemies: { dummy: target, victim: enemyRec({ key: 'victim', hp: 1, atk: 0, speed: 0 }) } },
    units: [{ uid: 1, chessId: 'chess_char_5_05_b', row: 10, col: 5, moduleId, skillIndex: 0, potential },
      { uid: 2, chessId: 'chess_char_3_05_a', row: 11, col: 5 },
      { uid: 3, chessId: 'chess_char_1_01_a', row: 9, col: 5 }] });
  h.step(); return { h, u: h.unit(1), hunter: h.unit(2), other: h.unit(3) };
}

test('乌尔比安 CRU-Y scales damage against enemies blocked by any ally, including skill damage', () => {
  const { h, u, hunter } = ulpia();
  const e = h.spawn('dummy', { pos: [10, 7] });
  const amount = () => h.b.dealDamage(u, e, { amount: 100, type: 'phys', isSkill: true });
  approx(amount(), 100);
  e.blockedBy = hunter; hunter.blocking.push(e);
  approx(amount(), 110);
  e.blockedBy = null; hunter.blocking.length = 0;
  checkInvariants(h.b); assert.equal(h.b.errors.length, 0);
});

test('乌尔比安 CRU-Y hunters share kill stacks; block +1 at nine, potential cap ten, other operators do not trigger it', () => {
  for (const potential of [1, 6]) {
    const { h, u, hunter, other } = ulpia({ potential, stage3: true });
    const kill = (killer) => h.b.dealDamage(killer, h.spawn('victim', { pos: [10, 8] }), { amount: 100, type: 'true' });
    kill(other); assert.equal(u.findBuff('ulpia:blood'), null);
    const block = u.s.blockCnt;
    for (let n = 1; n <= 12; n++) {
      kill(hunter);
      assert.equal(u.findBuff('ulpia:blood')?.stacks, Math.min(n, potential === 6 ? 10 : 9));
      assert.equal(u.s.blockCnt, block + (n >= 9 ? 1 : 0));
    }
    assert.ok(hunter.findBuff('ulpia:bloodShare'));
    checkInvariants(h.b); assert.equal(h.b.errors.length, 0);
  }
});

test('乌尔比安 without the new module still only gains stacks from his own kills', () => {
  const { h, u, hunter } = ulpia({ moduleId: 'none' });
  h.b.dealDamage(hunter, h.spawn('victim', { pos: [10, 8] }), { amount: 100, type: 'true' });
  assert.equal(u.findBuff('ulpia:blood'), null);
  h.b.dealDamage(u, h.spawn('victim', { pos: [10, 8] }), { amount: 100, type: 'true' });
  assert.equal(u.findBuff('ulpia:blood').stacks, 1);
  checkInvariants(h.b); assert.equal(h.b.errors.length, 0);
});


test('乌尔比安 CRU-Y counts a withdrawn hunter’s delayed credited kill only while Ulpianus is deployed', () => {
  const { h, u, hunter } = ulpia({ stage3: true });
  h.b.retreat(hunter, { permanent: true });
  h.b.dealDamage(hunter, h.spawn('victim', { pos: [10, 8] }), { amount: 100, type: 'true' });
  assert.equal(u.findBuff('ulpia:blood')?.stacks, 1);
  h.b.retreat(u, { permanent: true });
  h.b.dealDamage(hunter, h.spawn('victim', { pos: [10, 8] }), { amount: 100, type: 'true' });
  assert.ok((u.findBuff('ulpia:blood')?.stacks ?? 0) <= 1);
  checkInvariants(h.b); assert.deepEqual(h.b.errors, []);
});
