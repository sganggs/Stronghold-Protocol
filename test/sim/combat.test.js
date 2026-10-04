// Combat rules: statuses & immunities, cold→freeze, element bursts, blocking, melee vs FLY, stealth, priorities, healers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { ELEMENT } from '../../server/sim/constants.js';

const approx = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

const guard = (o = {}) => chessRec({ id: 't_guard', profession: 'WARRIOR', stats: { atk: 300, blockCnt: 2 }, skill: null, ...o });
const sniper = (o = {}) => chessRec({ id: 't_sniper', profession: 'SNIPER', subProfessionId: 'closerange', stats: { atk: 300 }, rangeGrid: [[0, 0], [0, 1], [0, 2], [0, 3], [1, 0], [1, 1], [1, 2], [1, 3], [-1, 0], [-1, 1], [-1, 2], [-1, 3]], skill: null, ...o });
const dummy = (o = {}) => enemyRec({ key: 'enemy_dummy', hp: 1e6, speed: 0, ...o });
const walker = (o = {}) => enemyRec({ key: 'enemy_walker', hp: 1e6, speed: 1, ...o });

test('stun stops enemy movement and attacks; immunity honoured; statusApplied fires', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_walker: walker({ atk: 100 }), enemy_boss: enemyRec({ key: 'enemy_boss', hp: 1e6, speed: 1, immunities: { stun: true } }) } },
    enemies: [{ key: 'enemy_walker' }, { key: 'enemy_boss', route: 1 }],
    content: 'none', autoFinish: false,
  });
  h.step();
  const e = h.enemy('enemy_walker');
  const boss = h.enemy('enemy_boss');
  assert.equal(h.b.applyStatus(e, 'stun', { duration: 1 }), true);
  assert.equal(h.b.applyStatus(boss, 'stun', { duration: 1 }), false, 'immune');
  const x0 = e.x, bx0 = boss.x;
  h.run(0.9);
  approx(e.x, x0);
  assert.ok(boss.x < bx0, 'boss keeps walking');
  h.run(0.3);
  assert.ok(e.x < x0, 'moves again after stun');
  assert.equal(h.hooksOf('statusApplied').length, 1);
  assert.ok(h.eventsOf('status').some((ev) => ev[1] === e.id && ev[2] === 'stun' && ev[3] === 1));
  assert.ok(h.eventsOf('status').some((ev) => ev[1] === e.id && ev[2] === 'stun' && ev[3] === 0));
});

test('stunned operator neither attacks nor casts but keeps its natural SP recovery; silence blocks skill activation', () => {
  const h = makeBattle({
    defs: { chess: { t_guard: guard({ skill: { spCost: 5, initSp: 0, duration: 3, bb: { atk: 0.5 } } }) }, enemies: { enemy_dummy: dummy() } },
    units: [{ chessId: 't_guard', row: 9, col: 5 }], enemies: [{ key: 'enemy_dummy', pos: [9, 6] }], content: 'generic',
  });
  h.step();
  const u = h.unit('t_guard');
  h.b.applyStatus(u, 'stun', { duration: 2 });
  const atk0 = u.stats.attacks;
  const sp0 = u.skill.sp;
  h.run(1.9);
  assert.equal(u.stats.attacks, atk0);
  // PRTS 技能: only 阻回 pauses the SP cooldown ("在阻回状态或技力条已满时…计时暂停"); 晕眩 (PRTS 异常效果 STUNNED) does not
  approx(u.skill.sp - sp0, 1.9, 0.02);
  assert.equal(u.skill.activations, 0, 'no cast while stunned');
  h.b.applyStatus(u, 'silence', { duration: 20 });
  h.run(8);
  assert.ok(u.stats.attacks > atk0, 'attacks after stun');
  assert.equal(u.skill.ready, true);
  assert.equal(u.skill.activations, 0, 'silenced: no cast');
});

test('cold on cold ⇒ freeze for the longer cold (res −15), not a fixed 3 s; frozen-immune enemies only get cold', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy({ res: 30 }), enemy_icy: enemyRec({ key: 'enemy_icy', speed: 0, hp: 1e6, immunities: { frozen: true } }) } },
    enemies: [{ key: 'enemy_dummy', pos: [11, 8] }, { key: 'enemy_icy', pos: [10, 8] }], content: 'none',
  });
  h.step();
  const e = h.enemy('enemy_dummy');
  const icy = h.enemy('enemy_icy');
  h.b.applyStatus(e, 'cold', { duration: 5 });
  assert.equal(e.s.aspd, 70);
  assert.equal(e.s.flags.freeze, undefined);
  h.b.applyStatus(e, 'cold', { duration: 5 });
  assert.equal(e.s.flags.freeze, true);
  assert.equal(e.s.flags.stun, true);
  assert.equal(e.s.res, 15);
  assert.ok(Math.abs(e.findBuff('freeze').timeLeft - 5) < 1e-6, 'freeze lasts the longer cold (5 s), not 3 s');
  h.run(3.1);
  assert.ok(e.s.flags.freeze, 'still frozen past the old fixed 3 s');
  h.run(2);
  assert.ok(!e.s.flags.freeze, 'freeze ends with that cold');
  h.b.applyStatus(icy, 'cold', { duration: 5 });
  h.b.applyStatus(icy, 'cold', { duration: 5 });
  assert.ok(!icy.s.flags.freeze);
  assert.ok(icy.s.flags.cold);
});

test('sleep: target is untargetable and inactive; fear stops enemy attacks', () => {
  const h = makeBattle({
    defs: { chess: { t_sniper: sniper() }, enemies: { enemy_dummy: dummy() } },
    units: [{ chessId: 't_sniper', row: 11, col: 5 }], enemies: [{ key: 'enemy_dummy', pos: [11, 7] }], content: 'none',
  });
  h.step();
  const e = h.enemy('enemy_dummy');
  h.b.applyStatus(e, 'sleep', { duration: 2 });
  const u = h.unit('t_sniper');
  const a0 = u.stats.attacks;
  h.run(1.5);
  assert.equal(u.stats.attacks, a0, 'sleeping enemy not targeted');
  h.run(1.5);
  assert.ok(u.stats.attacks > a0);
});

test('element bursts on enemies ("·我方" terms): burn 7000 元素伤害 + RES −20 (10 s lock), neural 6000 + 3 麻痹, leaders hold 2000', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy({ res: 50 }), enemy_lead: enemyRec({ key: 'enemy_lead', hp: 1e6, speed: 0, rank: 'BOSS' }) } },
    enemies: [{ key: 'enemy_dummy', pos: [11, 8] }, { key: 'enemy_lead', pos: [10, 8] }], content: 'none', autoFinish: false,
  });
  h.step();
  const e = h.enemy('enemy_dummy');
  const hp0 = e.hp;
  h.b.dealDamage(null, e, { type: 'element', element: 'burn', amount: 600 });
  approx(e.elem.burn, 600);
  assert.equal(e.hp, hp0, 'element damage fills the gauge only');
  h.b.dealDamage(null, e, { type: 'element', element: 'burn', amount: 600 });
  assert.ok(e.findBuff('burnBurst'));
  approx(hp0 - e.hp, ELEMENT.burn.enemy.elemDamage, 1e-6, '元素伤害 ignores RES');
  assert.equal(e.s.res, 50 - ELEMENT.burn.enemy.resDown);
  h.b.dealDamage(null, e, { type: 'element', element: 'burn', amount: 500 });
  assert.equal(e.elem.burn, 1000, 'locked during burst');
  h.run(10.1);
  assert.equal(e.elem.burn, 0);
  assert.equal(e.s.res, 50);
  // neural: 6000 元素伤害 + 3 麻痹 stacks
  const hp1 = e.hp;
  h.b.dealDamage(null, e, { type: 'element', element: 'neural', amount: 1000 });
  approx(hp1 - e.hp, ELEMENT.neural.enemy.elemDamage);
  assert.equal(e.findBuff('palsy').stacks, ELEMENT.neural.enemy.palsy);
  assert.ok(!e.s.flags.stun, 'enemies are not stunned by a neural burst');
  assert.equal(h.hooksOf('elementBurst').length, 2);
  // 元素脆弱 (elementalTakenMul) multiplies 元素伤害; the gauge's 元素损伤倍率 (elemTakenMul) does not
  h.b.addBuff(e, { key: 'test:ef', mods: { elementalTakenMul: 1.5, elemTakenMul: 3 } });
  const hp2 = e.hp;
  h.b.dealDamage(null, e, { amount: 100, type: 'elemental', element: 'burn' });
  approx(hp2 - e.hp, 150);
  // leaders need 2000
  const L = h.enemy('enemy_lead');
  assert.equal(L.gaugeMax, 2000);
  h.b.dealDamage(null, L, { type: 'element', element: 'burn', amount: 1500 });
  assert.ok(!L.findBuff('burnBurst'));
  h.b.dealDamage(null, L, { type: 'element', element: 'burn', amount: 600 });
  assert.ok(L.findBuff('burnBurst'));
});

test('element bursts on enemies: apoptosis = 800 元素伤害/s + 50 % weaken recovering; erosion = 5000 + permanent DEF −120 (8 s lock)', () => {
  const h = makeBattle({ defs: { enemies: { enemy_dummy: dummy({ atk: 1000, def: 500 }) } }, enemies: [{ key: 'enemy_dummy', pos: [11, 8] }], content: 'none', autoFinish: false });
  h.step();
  const e = h.enemy('enemy_dummy');
  h.b.dealDamage(null, e, { type: 'element', element: 'apoptosis', amount: 1000 });
  approx(e.s.atk, 500, 1e-6, '50 % weaken at the start');
  const hp0 = e.hp;
  h.run(5.02);
  approx(hp0 - e.hp, 5 * ELEMENT.apoptosis.enemy.elemDps, 1e-6);
  assert.ok(e.s.atk > 500 && e.s.atk < 1000, `weaken recovers (${e.s.atk})`);
  h.run(10.1);
  assert.ok(!e.findBuff('apoptosisBurst'));
  approx(e.s.atk, 1000);
  const hp1 = e.hp;
  h.b.dealDamage(null, e, { type: 'element', element: 'erosion', amount: 1000 });
  approx(hp1 - e.hp, ELEMENT.erosion.enemy.elemDamage);
  assert.equal(e.s.def, 500 - ELEMENT.erosion.enemy.defDown);
  assert.equal(e.elem.erosion, 1000, 'locked for 8 s');
  h.run(8.1);
  assert.equal(e.elem.erosion, 0);
  h.b.dealDamage(null, e, { type: 'element', element: 'erosion', amount: 1000 });
  assert.equal(e.s.def, 500 - 2 * ELEMENT.erosion.enemy.defDown, 'stacks, permanent');
});

test('element bursts on operators (enemy damage): burn 1200 arts, neural stun 10 s then 1000 true, apoptosis 阻回 + no skill / −1 SP/s / 100 arts/s, erosion DEF −100 then 800 phys (10 s cooldown)', () => {
  const op = chessRec({ id: 't_op', profession: 'WARRIOR', stats: { atk: 0, maxHp: 1e6, def: 300, res: 0, blockCnt: 0 }, skill: { spCost: 30, initSp: 20, duration: 5, bb: { atk: 0.5 } } });
  const h = makeBattle({ defs: { chess: { t_op: op } }, units: [{ chessId: 't_op', row: 9, col: 5 }], content: 'generic', autoFinish: false, timeLimit: 120 });
  h.step();
  const u = h.unit('t_op');
  let hp = u.hp;
  h.b.dealDamage(null, u, { type: 'element', element: 'burn', amount: 1000 });
  approx(hp - u.hp, ELEMENT.burn.ally.damage);
  h.run(ELEMENT.burn.ally.duration + 0.1); // the burn cooldown holds every gauge
  hp = u.hp;
  let stunned = null;
  h.b.on('damaged', (c) => { if (c.target === u && c.type === 'true' && stunned == null) stunned = !!u.s.flags.stun; });
  h.b.dealDamage(null, u, { type: 'element', element: 'neural', amount: 1000 });
  approx(hp - u.hp, ELEMENT.neural.ally.damage);
  assert.equal(stunned, true, 'PRTS: "立刻获得等时长的眩晕；随后受到1000点…真实伤害" — stunned before the hit');
  approx(u.findBuff('stun').timeLeft, ELEMENT.neural.ally.stun);
  h.run(10.1);
  const sp0 = u.skill.sp;
  hp = u.hp;
  h.b.dealDamage(null, u, { type: 'element', element: 'apoptosis', amount: 1000 });
  assert.ok(u.s.flags.silence, 'no skill activation');
  assert.ok(u.s.flags.noSp, '阻回: no SP recovery');
  h.run(3.02);
  approx(hp - u.hp, 3 * ELEMENT.apoptosis.ally.dps);
  approx(u.skill.sp, sp0 - 3 * ELEMENT.apoptosis.ally.spLossPerSec, 0.05);
  const spHeld = u.skill.sp;
  assert.ok(spHeld < u.skill.spCost && !u.skill.active, 'room for SP (a 0 below is 阻回, not a full bar)');
  assert.equal(u.skill.gainSp(5, 'talent'), 0, '阻回 ("停止并阻止任意形式的技力回复"): no granted SP');
  assert.equal(u.skill.gainSp(1, 'hurt'), 0, '… nor SP from hits taken');
  assert.equal(u.skill.gainSp(1, 'attack'), 0, '… nor from attacks');
  assert.equal(u.skill.sp, spHeld);
  h.run(12.1);
  assert.ok(!u.s.flags.silence && !u.s.flags.noSp);
  hp = u.hp;
  h.b.dealDamage(null, u, { type: 'element', element: 'erosion', amount: 1000 });
  approx(hp - u.hp, ELEMENT.erosion.ally.damage - (300 - ELEMENT.erosion.ally.defDown), 1e-6, 'DEF cut first, then 800 phys');
  assert.equal(u.s.def, 300 - ELEMENT.erosion.ally.defDown);
  assert.equal(ELEMENT.erosion.ally.duration, 10, 'PRTS 元素: 侵蚀 爆发 10 s on operators');
  assert.equal(u.elem.erosion, 1000, 'held full during its cooldown');
  h.run(10.1);
  assert.equal(u.elem.erosion, 0, 'reset when the cooldown ends');
  h.b.dealDamage(null, u, { type: 'element', element: 'erosion', amount: 1000 });
  assert.equal(u.findBuff('erosionDown').stacks, 2, 'the DEF cut stacks (permanent)');
});

test('爆发冷却 (PRTS 元素): during a burst no element fills or recovers; its end resets every gauge; 损伤抵抗 = epResistance %', () => {
  const resRec = enemyRec({ key: 'enemy_res', hp: 1e6, speed: 0 });
  resRec.stats.elementRes = 10;
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy(), enemy_res: resRec } },
    enemies: [{ key: 'enemy_dummy', pos: [11, 8] }, { key: 'enemy_res', pos: [10, 8] }], content: 'none', autoFinish: false,
  });
  h.step();
  const e = h.enemy('enemy_dummy');
  h.b.dealDamage(null, e, { type: 'element', element: 'neural', amount: 400 });
  h.b.dealDamage(null, e, { type: 'element', element: 'burn', amount: 1000 });
  assert.ok(e.findBuff('burnBurst') && e.s.flags.burstLock);
  assert.equal(h.b.dealDamage(null, e, { type: 'element', element: 'neural', amount: 1000 }), 0, 'another element cannot fill during the cooldown');
  approx(e.elem.neural, 400);
  assert.equal(h.b.reduceElement(e, 300), 0, 'nor be recovered');
  h.run(ELEMENT.burn.enemy.duration - 0.2);
  assert.equal(e.elem.burn, 1000);
  h.run(0.3);
  assert.deepEqual([e.elem.burn, e.elem.neural, e.elem.apoptosis, e.elem.erosion], [0, 0, 0, 0], 'every gauge restored');
  h.b.dealDamage(null, e, { type: 'element', element: 'neural', amount: 300 });
  approx(e.elem.neural, 300, 1e-6, 'fills again after the cooldown');
  // 损伤抵抗 (data elementRes → epResistance, a percentage): 受到的元素损伤 = 损伤值 × (1 − 损伤抵抗 × 0.01)
  const r = h.enemy('enemy_res');
  assert.equal(r.def.epResistance, 10);
  h.b.dealDamage(null, r, { type: 'element', element: 'burn', amount: 500 });
  approx(r.elem.burn, 450);
});

test('a resolving burst already locks its gauge: an elementBurst handler spreading the element back cannot re-burst (no ping-pong recursion)', () => {
  // two operators that spread every burst to each other (the 淤困 parasite pattern) — every burst has its cooldown
  // (erosion on operators too: 10 s), apoptosis locks with a ticker: each must burst exactly once per fill
  const op = (id) => chessRec({ id, profession: 'WARRIOR', stats: { atk: 0, maxHp: 1e6, def: 300, res: 0, blockCnt: 0 }, skill: null });
  for (const el of ['burn', 'erosion', 'apoptosis', 'neural']) {
    const h = makeBattle({
      defs: { chess: { t_a: op('t_a'), t_b: op('t_b') } },
      units: [{ chessId: 't_a', row: 9, col: 5 }, { chessId: 't_b', row: 9, col: 6 }], content: 'none', autoFinish: false,
      extraContent: [{ install(battle) {
        battle.on('elementBurst', (c) => {
          for (const o of battle.units) if (o.side === 'ally' && o.alive && o.deployed) battle.dealDamage(null, o, { type: 'element', element: c.element, amount: 5000 });
        });
      } }],
    });
    h.step();
    const A = h.unit('t_a'), B = h.unit('t_b');
    const hpA = A.hp, hpB = B.hp;
    h.b.dealDamage(null, A, { type: 'element', element: el, amount: 1000 });
    assert.deepEqual(h.b.errors.map((e) => e.label), [], `${el}: no hook-depth errors`);
    assert.deepEqual(h.hooksOf('elementBurst').map((c) => c.target.defId).sort(), ['t_a', 't_b'], `${el}: one burst per unit`);
    assert.ok(A.alive && B.alive);
    if (el === 'burn') { approx(hpA - A.hp, ELEMENT.burn.ally.damage); approx(hpB - B.hp, ELEMENT.burn.ally.damage); }
    if (el === 'erosion') {
      for (const u of [A, B]) assert.equal(u.findBuff('erosionDown').stacks, 1, 'one permanent DEF cut');
      h.b.dealDamage(null, A, { type: 'element', element: 'erosion', amount: 1000 });
      assert.equal(A.findBuff('erosionDown').stacks, 1, 'locked during its 10 s cooldown');
      h.run(ELEMENT.erosion.ally.duration + 0.1);
      assert.equal(A.elem.erosion, 0, 'reset once the cooldown ended');
      h.b.dealDamage(null, A, { type: 'element', element: 'erosion', amount: 1000 });
      assert.equal(A.findBuff('erosionDown').stacks, 2, 'a later fill bursts again');
    }
    assert.ok(!A.burstPending?.[el] && !B.burstPending?.[el], 'pending marker cleared');
  }
});

test('淤困 (enemy_9007_acelem) parasite hosts side by side: one burst spreads once, no ping-pong', () => {
  const h = makeBattle({
    seed: 3,
    units: [{ chessId: 'chess_char_4_17_a', row: 9, col: 5 }, { chessId: 'chess_char_2_08_a', row: 10, col: 5 }],
    enemies: [{ key: 'enemy_9007_acelem', pos: [9, 7], route: { motion: 'WALK', start: [9, 7], end: [9, 2], checkpoints: [] } },
      { key: 'enemy_9007_acelem', pos: [10, 7], route: { motion: 'WALK', start: [10, 7], end: [9, 2], checkpoints: [[10, 3]] } }],
    hooks: ['elementBurst'],
  });
  const A = h.unit('chess_char_4_17_a'), B = h.unit('chess_char_2_08_a');
  assert.ok(h.runUntil(() => A.findBuff('ab:parasite') && B.findBuff('ab:parasite'), 20), 'both defenders parasitised');
  const hpA = A.hp, hpB = B.hp;
  h.eventsOf('dmg'); // drain into h.events
  const ev0 = h.events.length;
  h.b.dealDamage(null, A, { type: 'element', element: 'burn', amount: 1000 });
  assert.deepEqual(h.b.errors.map((e) => e.label), []);
  assert.equal(h.hooksOf('elementBurst').length, 2, 'A bursts, the spread bursts B, B\'s spread back to A is locked out');
  assert.ok(A.alive && B.alive, `defenders survive (${Math.round(A.hp)}/${Math.round(B.hp)})`);
  assert.ok(A.findBuff('burnBurst') && B.findBuff('burnBurst'));
  h.eventsOf('dmg');
  const burstHit = (u) => h.events.slice(ev0).filter((e) => e[0] === 'dmg' && e[1] === u.id && e[3] === 'arts').length;
  assert.equal(burstHit(A), 1, 'one 灼燃 burst hit on A');
  assert.equal(burstHit(B), 1, 'one 灼燃 burst hit on B');
  assert.ok(hpA - A.hp < 2 * ELEMENT.burn.ally.damage && hpB - B.hp < 2 * ELEMENT.burn.ally.damage);
});

test('statuses (official terms): tremble only stops attacks while blocked; fear = unblockable + no attack + no advance (no source: it stays on its tile, fear.js); stunned blocker lets go', () => {
  const g = chessRec({ id: 't_guard', profession: 'WARRIOR', stats: { atk: 0, blockCnt: 2, maxHp: 1e6 }, skill: null });
  const h = makeBattle({
    defs: { chess: { t_guard: g }, enemies: { enemy_walker: walker({ atk: 100, bat: 1 }) } },
    units: [{ chessId: 't_guard', row: 9, col: 6 }], enemies: [{ key: 'enemy_walker' }], content: 'none', autoFinish: false, timeLimit: 120,
  });
  const u = h.unit('t_guard');
  assert.ok(h.runUntil(() => h.enemies()[0]?.blockedBy === u, 20));
  const e = h.enemies()[0];
  h.b.applyStatus(e, 'tremble', { duration: 3 });
  const a0 = e.stats.attacks;
  h.run(2.5);
  assert.equal(e.stats.attacks, a0, 'trembling + blocked: no normal attack');
  h.run(1);
  assert.ok(e.stats.attacks > a0, 'attacks again');
  // stun on the blocker: releases the enemy; it is re-blocked once the stun ends
  h.b.applyStatus(u, 'stun', { duration: 1 });
  assert.equal(e.blockedBy, null, 'a stunned operator blocks nothing');
  assert.equal(u.blocking.length, 0);
  h.run(1.2);
  // fear: released, no attacks, does not advance — without a source there is no 恐惧可达地块: it flutters on its own tile
  if (!e.blockedBy) assert.ok(h.runUntil(() => e.blockedBy === u, 20));
  h.b.applyStatus(e, 'fear', { duration: 2 });
  assert.equal(e.blockedBy, null);
  const x0 = e.x, a1 = e.stats.attacks, tc = Math.round(e.x);
  h.run(1.9);
  assert.ok(Math.abs(e.x - tc) <= 0.5 && Math.round(e.x) === Math.round(x0), `stays on its tile (${x0} → ${e.x})`);
  assert.equal(e.blockedBy, null);
  assert.equal(e.stats.attacks, a1);
  h.run(0.5);
  assert.ok(e.blockedBy === u || e.x < x0, 'walks / is blocked again after the fear');
});

test('statuses: sleep = invulnerable except `hitSleep` attackers; levitate halves on heavy units; frozen RES cut only on enemies', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy(), enemy_heavy: enemyRec({ key: 'enemy_heavy', hp: 1e6, speed: 0, mass: 4 }) } },
    units: [{ chessId: 'chess_char_1_18_a', row: 9, col: 3 }], enemies: [{ key: 'enemy_dummy', pos: [11, 8] }, { key: 'enemy_heavy', pos: [10, 8] }], content: 'none', autoFinish: false,
  });
  h.step();
  const e = h.enemy('enemy_dummy');
  h.b.applyStatus(e, 'sleep', { duration: 5 });
  assert.equal(h.b.dealDamage(null, e, { amount: 100, type: 'true' }), 0, 'sleepers take no damage');
  assert.equal(h.b.dealDamage(null, e, { amount: 100, type: 'true', ignoreSleep: true }), 100);
  const fake = { side: 'ally', s: { dmgDealtMul: 1, physDealtMul: 1, artsDealtMul: 1, defIgnorePct: 0, defIgnoreFlat: 0, resIgnorePct: 0, resIgnoreFlat: 0 }, profile: { hitSleep: true }, stats: { dmg: 0 }, ownerId: 'p1' };
  assert.equal(h.b.dealDamage(fake, e, { amount: 100, type: 'true' }), 100, 'hitSleep attacker');
  const heavy = h.enemy('enemy_heavy');
  h.b.applyStatus(heavy, 'levitate', { duration: 4 });
  approx(heavy.findBuff('levitate').timeLeft, 2);
  h.b.applyStatus(e, 'levitate', { duration: 4 });
  approx(e.findBuff('levitate').timeLeft, 4);
  const op = h.unit('chess_char_1_18_a');
  const r0 = op.s.res;
  h.b.applyStatus(op, 'freeze', { duration: 2 });
  assert.equal(op.s.res, r0, 'operators keep their RES when frozen');
  assert.ok(op.s.flags.freeze);
});

test('statuses: "同名效果取最高" — a weaker fragile never overrides a stronger one and resumes after it; palsy cancels attacks', () => {
  const g = chessRec({ id: 't_guard', profession: 'WARRIOR', stats: { atk: 0, blockCnt: 2, maxHp: 1e6 }, skill: null });
  const h = makeBattle({
    defs: { chess: { t_guard: g }, enemies: { enemy_dummy: dummy({ atk: 100, bat: 1 }) } },
    units: [{ chessId: 't_guard', row: 11, col: 8 }], enemies: [{ key: 'enemy_dummy', pos: [11, 8] }], content: 'none', autoFinish: false,
  });
  h.step();
  const e = h.enemy('enemy_dummy');
  h.b.applyStatus(e, 'fragile', { duration: 2, value: 0.3 });
  h.b.applyStatus(e, 'fragile', { duration: 5, value: 0.1 });
  approx(e.s.dmgTakenMul, 1.3, 1e-9, 'the weaker one does not override');
  h.run(2.1);
  approx(e.s.dmgTakenMul, 1.1, 1e-9, 'the weaker one resumes after the stronger ends');
  h.run(3.1);
  approx(e.s.dmgTakenMul, 1);
  h.b.applyStatus(e, 'fragile', { duration: 5, value: 0.1 });
  h.b.applyStatus(e, 'fragile', { duration: 1, value: 0.4 });
  approx(e.s.dmgTakenMul, 1.4, 1e-9, 'a stronger one takes over');
  h.run(1.1);
  approx(e.s.dmgTakenMul, 1.1, 1e-9, 'the longer weaker one comes back');
  // palsy: 2 stacks cancel 2 attacks
  const u = h.unit('t_guard');
  assert.ok(h.runUntil(() => e.blockedBy === u, 10));
  h.b.applyStatus(e, 'palsy', { value: 2 });
  const a0 = e.stats.attacks;
  h.run(2.05);
  assert.equal(e.stats.attacks, a0, 'two attacks interrupted');
  assert.ok(!e.findBuff('palsy'));
  h.run(1.1);
  assert.ok(e.stats.attacks > a0);
});

test('beforeStatus may change the duration / value; NEVER trigger never auto-casts; dodge sources roll independently; no SP while a timed skill runs', () => {
  const op = chessRec({ id: 't_op', profession: 'WARRIOR', stats: { atk: 100, blockCnt: 1 }, skill: { spCost: 2, initSp: 2, duration: 5, bb: { atk: 0.5 } } });
  const h = makeBattle({
    defs: { chess: { t_op: op }, enemies: { enemy_dummy: dummy() } },
    units: [{ chessId: 't_op', row: 11, col: 7 }], enemies: [{ key: 'enemy_dummy', pos: [11, 8] }], content: 'generic', autoFinish: false,
    kits: { t_op: () => ({ skill: { kind: 'duration', trigger: 'NEVER', mods: { atkPct: 0.5 } } }) },
    setup: (b) => b.on('beforeStatus', (c) => { if (c.status === 'slow') { c.duration *= 2; c.value = 0.9; } }),
  });
  h.step();
  const e = h.enemy('enemy_dummy');
  h.b.applyStatus(e, 'slow', { duration: 1.5, value: 0.2 });
  approx(e.findBuff('slow').timeLeft, 3);
  approx(e.s.moveSpeed, e.base.moveSpeed * 0.1);
  const u = h.unit('t_op');
  h.run(4);
  assert.ok(u.skill.ready && u.stats.attacks > 0);
  assert.equal(u.skill.activations, 0, 'NEVER: no auto-cast');
  assert.equal(u.skill.activate('manual'), true);
  assert.equal(u.skill.gainSp(5, 'talent'), 0, 'no SP while the timed skill runs');
  h.b.addBuff(u, { key: 'd1', mods: { dodgePhys: 0.5 } });
  h.b.addBuff(u, { key: 'd2', mods: { dodgePhys: 0.5 } });
  approx(u.s.dodgePhys, 0.75, 1e-9, '1 − 0.5 × 0.5');
});

test('blocking: capacity, heavy enemies, release on blocker death', () => {
  const h = makeBattle({
    defs: {
      chess: { t_guard: guard({ stats: { atk: 0, blockCnt: 2, maxHp: 1e6 } }) },
      enemies: { enemy_walker: walker(), enemy_heavy: enemyRec({ key: 'enemy_heavy', hp: 1e6, speed: 1, blockCnt: 3 }) },
    },
    units: [{ chessId: 't_guard', row: 9, col: 6 }],
    enemies: [{ key: 'enemy_walker', count: 3, interval: 0.5 }, { key: 'enemy_heavy', time: 0.2 }],
    content: 'none', autoFinish: false,
  });
  const g = h.unit('t_guard');
  h.run(12);
  assert.equal(g.blocking.length, 2, 'blocks exactly 2');
  const blocked = h.enemies().filter((e) => e.blockedBy === g);
  assert.equal(blocked.length, 2);
  const passed = h.enemies().filter((e) => !e.blockedBy);
  assert.ok(passed.length === 0 || passed.every((e) => e.x < 6), 'others walked through');
  assert.ok(h.hooksOf('blocked').length >= 2);
  const heavy = h.b.units.find((u) => u.defId === 'enemy_heavy');
  assert.notEqual(heavy.blockedBy, g, 'blockCnt 3 enemy cannot be blocked by capacity 2');
  h.b.dealDamage(null, g, { amount: 1e9, type: 'true' });
  assert.equal(g.alive, false);
  assert.equal(g.blocking.length, 0);
  for (const e of blocked) assert.equal(e.blockedBy, null);
  const bx = blocked[0].x;
  h.run(1);
  assert.ok(blocked[0].x < bx || !blocked[0].alive, 'released enemy moves on');
});

test('blocked melee enemy attacks its blocker', () => {
  const h = makeBattle({
    defs: { chess: { t_guard: guard({ stats: { atk: 0, maxHp: 1e6 } }) }, enemies: { enemy_walker: walker({ atk: 500 }) } },
    units: [{ chessId: 't_guard', row: 9, col: 7 }], enemies: [{ key: 'enemy_walker' }], content: 'none', autoFinish: false,
  });
  h.run(10);
  const g = h.unit('t_guard');
  assert.ok(g.stats.taken > 0);
  assert.ok(g.hp < g.s.maxHp);
});

test('melee operators cannot hit FLY enemies; ranged ones can', () => {
  const h = makeBattle({
    defs: { chess: { t_guard: guard({ rangeGrid: [[0, 0], [0, 1], [0, 2]] }), t_sniper: sniper() }, enemies: { enemy_fly: enemyRec({ key: 'enemy_fly', hp: 1e6, speed: 0, motion: 'FLY' }) } },
    units: [{ chessId: 't_guard', row: 9, col: 5 }, { chessId: 't_sniper', row: 10, col: 4 }],
    enemies: [{ key: 'enemy_fly', pos: [9, 6], route: 2 }], content: 'none',
  });
  h.run(3);
  assert.equal(h.unit('t_guard').stats.attacks, 0);
  assert.ok(h.unit('t_sniper').stats.attacks > 0);
  assert.equal(h.enemy('enemy_fly').blockedBy, null, 'FLY never blocked');
});

test('stealth enemies are untargetable unless blocked or revealed', () => {
  const h = makeBattle({
    defs: { chess: { t_sniper: sniper() }, enemies: { enemy_dummy: dummy() } },
    units: [{ chessId: 't_sniper', row: 11, col: 5 }], enemies: [{ key: 'enemy_dummy', pos: [11, 7] }], content: 'none',
  });
  h.step();
  const e = h.enemy('enemy_dummy');
  h.b.applyStatus(e, 'stealth', { duration: 100 });
  const u = h.unit('t_sniper');
  const a0 = u.stats.attacks;
  h.run(3);
  assert.equal(u.stats.attacks, a0);
  h.b.applyStatus(e, 'reveal', { duration: 100 });
  h.run(2);
  assert.ok(u.stats.attacks > a0);
});

test('target priority: least remaining distance to goal, then earliest spawned; fly-first profiles', () => {
  const h = makeBattle({
    defs: {
      chess: { t_sniper: sniper({ rangeGrid: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [1, 1], [1, 2], [1, 3], [1, 4], [2, 1], [2, 2], [2, 3], [2, 4], [3, 2], [3, 3]] }) },
      enemies: { enemy_dummy: dummy(), enemy_fly: enemyRec({ key: 'enemy_fly', hp: 1e6, speed: 0, motion: 'FLY' }) },
    },
    units: [{ chessId: 't_sniper', row: 9, col: 3 }],
    enemies: [{ key: 'enemy_dummy', pos: [9, 7] }, { key: 'enemy_dummy', pos: [9, 5] }, { key: 'enemy_dummy', pos: [12, 6] }],
    content: 'none',
  });
  h.run(1.2);
  const [far, near, high] = h.b.units.filter((u) => u.defId === 'enemy_dummy');
  assert.ok(near.stats.taken > 0, 'closest to goal attacked');
  assert.equal(far.stats.taken, 0);
  assert.equal(high.stats.taken, 0);
  // fly-first
  const h2 = makeBattle({
    defs: {
      chess: { t_fast: sniper({ id: 't_fast', subProfessionId: 'fastshot', targetPriority: 'fly' }) },
      enemies: { enemy_dummy: dummy(), enemy_fly: enemyRec({ key: 'enemy_fly', hp: 1e6, speed: 0, motion: 'FLY' }) },
    },
    units: [{ chessId: 't_fast', row: 9, col: 3 }],
    enemies: [{ key: 'enemy_dummy', pos: [9, 4] }, { key: 'enemy_fly', pos: [9, 6], route: 2 }], content: 'none',
  });
  h2.run(1.2);
  assert.ok(h2.enemy('enemy_fly').stats.taken > 0);
  assert.equal(h2.enemy('enemy_dummy').stats.taken, 0);
});

test('operators prioritise enemies they block', () => {
  const h = makeBattle({
    defs: { chess: { t_guard: guard({ rangeGrid: [[0, 0], [0, 1], [0, 2]], stats: { atk: 100, blockCnt: 1, maxHp: 1e6 } }) }, enemies: { enemy_walker: walker(), enemy_dummy: dummy() } },
    units: [{ chessId: 't_guard', row: 9, col: 5 }],
    enemies: [{ key: 'enemy_dummy', pos: [9, 6] }, { key: 'enemy_walker', pos: [9, 5.4] }],
    content: 'none', autoFinish: false,
  });
  h.run(0.2);
  const w = h.enemy('enemy_walker');
  assert.equal(w.blockedBy, h.unit('t_guard'));
  h.run(3);
  assert.ok(w.stats.taken > 0);
  assert.equal(h.enemy('enemy_dummy').stats.taken, 0);
});

test('healers target the lowest HP% ally in range; idle when everyone is full; noHeal allies skipped', () => {
  const medic = chessRec({ id: 't_medic', profession: 'MEDIC', subProfessionId: 'physician', dmgType: 'heal', attackKind: 'heal', stats: { atk: 200 }, rangeGrid: [[0, 0], [0, 1], [0, 2], [0, 3], [1, 0], [1, 1], [1, 2], [-1, 0], [-1, 1], [-1, 2]], skill: null });
  const reaper = chessRec({ id: 't_reaper', profession: 'WARRIOR', subProfessionId: 'reaper', skill: null, stats: { maxHp: 5000 } });
  const h = makeBattle({
    defs: { chess: { t_medic: medic, t_a: guard({ id: 't_a', stats: { maxHp: 5000 } }), t_b: guard({ id: 't_b', stats: { maxHp: 5000 } }), t_reaper: reaper } },
    units: [{ chessId: 't_medic', row: 10, col: 3 }, { chessId: 't_a', row: 10, col: 4 }, { chessId: 't_b', row: 11, col: 4 }, { chessId: 't_reaper', row: 9, col: 4 }],
    content: 'none',
  });
  h.step();
  const m = h.unit('t_medic'), a = h.unit('t_a'), b = h.unit('t_b'), r = h.unit('t_reaper');
  h.run(2);
  assert.equal(m.stats.attacks, 0, 'no injured ally: no heal');
  a.hp = 4000; b.hp = 2000; r.hp = 100;
  h.run(1.05);
  assert.ok(b.hp > 2000, 'lowest ratio (non-reaper) healed first');
  assert.equal(a.hp, 4000);
  assert.equal(r.hp, 100, 'reaper cannot be healed by others');
});

test('ranged enemies attack allies in radius: blocker → taunt → latest deployed, then pause', () => {
  const mk = (taunt) => makeBattle({
    defs: {
      chess: { t_a: guard({ id: 't_a', stats: { maxHp: 1e6, atk: 0 } }), t_b: guard({ id: 't_b', stats: { maxHp: 1e6, atk: 0, tauntLevel: taunt } }) },
      enemies: { enemy_caster: enemyRec({ key: 'enemy_caster', hp: 1e6, speed: 1, atk: 100, range: 2.5, dmgType: 'arts' }) },
    },
    // deploy order: one column, top to bottom, so t_b (row 11) deploys before t_a (row 10) ⇒ t_a is the latest deployed
    units: [{ chessId: 't_a', row: 10, col: 8 }, { chessId: 't_b', row: 11, col: 8 }],
    enemies: [{ key: 'enemy_caster', pos: [10, 10] }], content: 'none', autoFinish: false,
  });
  const h = mk(1);
  h.step(1);
  const e = h.enemy('enemy_caster');
  assert.ok(e.lastAttackAt >= 0, 'attacked on the first tick');
  // attack pause: no movement for ATTACK_PAUSE (0.35 s) after the attack
  const x = e.x;
  h.step(9);
  assert.equal(e.x, x);
  h.run(0.5);
  assert.ok(e.x < x, 'moves after the pause');
  assert.ok(h.unit('t_b').stats.taken > 0, 'highest taunt chosen');
  assert.equal(h.unit('t_a').stats.taken, 0);
  const h2 = mk(0);
  h2.run(0.8);
  assert.ok(h2.unit('t_a').stats.taken > 0, 'latest deployed chosen');
  assert.equal(h2.unit('t_b').stats.taken, 0);
});
