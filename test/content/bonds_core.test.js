// The 8 core bonds (server/sim/content/bonds/core.js): per-tier / per-layer formulas of research 02 §3.1–3.8 with the
// data/bonds.json numbers, 调和 / 变形同构体 membership, live layers, inactive bonds, two players in a boss field, and
// the 维多利亚 hammer milestone in a real match.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { bondBb, deps, prdConstant, reached, yanyouShare, registerMeta as coreRegisterMeta } from '../../server/sim/content/bonds/core.js';
import * as items from '../../server/sim/content/items.js';
import { TOKEN_IDS } from '../../server/sim/content/tokens.js';
import { createRegistry } from '../../server/match/effectsMeta.js';
import { makeMatch, DATA, give, legalTileFor } from '../match/harness.js';
import { FORCED_EXIT } from '../../server/sim/constants.js';

const close = (a, b, eps = 1e-6, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} expected ${b}, got ${a}`);
const op = (id, bonds, extra = {}) => chessRec({
  id, bonds, profession: 'WARRIOR', skill: null, ...extra,
  stats: { atk: 1000, maxHp: 10000, def: 0, blockCnt: 2, ...(extra.stats || {}) },
});
const bondOn = (count, layers = 0, tier = null, thresholds = [3, 6, 9]) => ({
  count, active: count >= thresholds[0], tier: tier ?? thresholds.filter((t) => count >= t).length, layers,
});
const dummy = enemyRec({ key: 'e_dummy', hp: 1e8, speed: 0, def: 0, res: 0 });
const buffOf = (u, key) => u.buffs.find((b) => b.key === key) ?? null;
const tagged = (h, tag) => h.hooksOf('damaged').filter((c) => c.dmg && c.dmg.tags && c.dmg.tags.includes(tag));

/** Row-major units on board rows 9–12, cols 3.. (board coords). */
function lineup(ids, { row = 10, col = 3, items: it = {} } = {}) {
  return ids.map((chessId, i) => ({ chessId, row: row + Math.floor(i / 7), col: col + (i % 7), items: it[i] }));
}

function defsOf(list) {
  const chess = {};
  for (const [id, bonds, extra] of list) chess[id] = op(id, bonds, extra);
  return { chess, enemies: { e_dummy: dummy } };
}

// ---------------------------------------------------------------------------------------------------------------------
// 炎

test('炎: members ATK ×(1+0.23+0.009L), 调和 enjoys it, non-members unchanged, live layers', () => {
  const bb = bondBb('yanShip');
  assert.equal(bb.base_atk, 0.23);
  const defs = defsOf([['y1_a', ['yanShip']], ['y2_a', ['yanShip']], ['y3_a', ['yanShip']], ['mani_a', ['maniShip']], ['none_a', ['preciShip']]]);
  const h = makeBattle({
    defs, units: lineup(['y1_a', 'y2_a', 'y3_a', 'mani_a', 'none_a']),
    bonds: { yanShip: bondOn(4, 10), maniShip: { count: 1, active: true, tier: 1, layers: 0 } },
  });
  h.step(1);
  close(h.unit('y1_a').s.atk, 1000 * (1 + 0.23 + 0.009 * 10));
  close(h.unit('mani_a').s.atk, 1000 * (1 + 0.23 + 0.009 * 10), 1e-6, '调和');
  close(h.unit('none_a').s.atk, 1000);
  assert.equal(h.b.allyUnits.filter((u) => u.defId === TOKEN_IDS.yanyou).length, 0, 'no 炎佑 below 6');
  h.b.addLayers('p1', 'yanShip', 20, 'test');
  h.step(2);
  close(h.unit('y2_a').s.atk, 1000 * (1 + 0.23 + 0.009 * 30), 1e-6, 'live layers');
  checkInvariants(h.b);
});

test('炎 6 / 9: one / two 炎佑 with their template stats + 30 % of the real 炎 sums; 9: ATK ×1.5, damage taken ×0.1', () => {
  assert.equal(yanyouShare(), 0.3);
  const bb = bondBb('yanShip');
  // PRTS: "登场时使自身攻击力、生命值增加…所有【炎】盟约干员攻击力、生命值的30%（最终加算）" — added to the template
  const tpl = DATA.tokens.enemy_9012_acloon.stats;
  assert.deepEqual([tpl.atk, tpl.maxHp], [600, 12000], 'enemy_9012_acloon template');
  for (const n of [6, 9]) {
    const list = [];
    for (let i = 0; i < n - 1; i++) list.push([`y${i}_a`, ['yanShip']]);
    list.push(['mani_a', ['maniShip']]);
    const h = makeBattle({
      defs: defsOf(list), units: lineup(list.map((x) => x[0])),
      bonds: { yanShip: bondOn(n, 0), maniShip: { count: 1, active: true, tier: 1, layers: 0 } },
    });
    h.step(1);
    const yy = h.b.allyUnits.filter((u) => u.defId === TOKEN_IDS.yanyou && u.alive);
    assert.equal(yy.length, n === 9 ? 2 : 1, `${n} 炎 → 炎佑 count`);
    const sumAtk = (n - 1) * 1000 * (1 + bb.base_atk);            // 调和 excluded from the sums
    const sumHp = (n - 1) * 10000;
    for (const y of yy) {
      close(y.s.atk, (tpl.atk + sumAtk * 0.3) * (n === 9 ? bb.atk : 1), 1e-6, `炎佑 ATK @${n}`);
      close(y.s.maxHp, tpl.maxHp + sumHp * 0.3, 1e-6, `炎佑 HP @${n}`);
      close(y.s.dmgTakenMul, n === 9 ? 1 - bb.damage_resistance : 1, 1e-9, `炎佑 dmgTaken @${n}`);
    }
    checkInvariants(h.b);
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// 萨尔贡

const sargonDefs = (n) => {
  const list = [];
  for (let i = 0; i < n; i++) list.push([`s${i}_a`, ['sargonShip'], { skill: { duration: 1000, spCost: 10, initSp: 0 } }]);
  list.push(['none_a', ['preciShip']]);
  return list;
};

test('萨尔贡 3: every member skill start → one independent stack on every member (ASPD +12, 5+0.22L s, ≤ 25)', () => {
  const list = sargonDefs(3);
  const L = 10;
  const h = makeBattle({ defs: defsOf(list), units: lineup(list.map((x) => x[0])), bonds: { sargonShip: bondOn(3, L, null, [3, 6]) } });
  h.step(1);
  const [a, b, c] = ['s0_a', 's1_a', 's2_a'].map((id) => h.unit(id));
  a.skill.activate('test', { free: true });
  b.skill.activate('test', { free: true });
  assert.equal(c.s.aspd, 100 + 2 * 12, 'two stacks on the non-caster');
  assert.equal(h.unit('none_a').s.aspd, 100);
  assert.equal(buffOf(c, 'bond:sargon:atk'), null, 'no ATK stacks below 6');
  close(buffOf(c, 'bond:sargon').timeLeft, 5 + 0.22 * L, 1e-6);
  // cap: 30 more activations → 25 stacks
  for (let i = 0; i < 30; i++) { a.skill.end('test'); a.skill.activate('test', { free: true }); }
  assert.equal(c.buffs.filter((x) => x.key === 'bond:sargon').length, 25);
  assert.equal(c.s.aspd, Math.min(600, 100 + 300));
  h.run(5 + 0.22 * L + 0.2);
  assert.equal(c.buffs.filter((x) => x.key === 'bond:sargon').length, 0, 'stacks expire');
  assert.equal(c.s.aspd, 100);
  checkInvariants(h.b);
});

test('萨尔贡 6: each stack also ATK +12 % (additive, one multiplier), dropped when the stacks expire', () => {
  const list = sargonDefs(6);
  const h = makeBattle({ defs: defsOf(list), units: lineup(list.map((x) => x[0])), bonds: { sargonShip: bondOn(6, 0, null, [3, 6]) } });
  h.step(1);
  const a = h.unit('s0_a'), f = h.unit('s5_a');
  for (let i = 0; i < 3; i++) { a.skill.end('test'); a.skill.activate('test', { free: true }); }
  close(f.s.atk, 1000 * (1 + 3 * 0.12));
  for (let i = 0; i < 30; i++) { a.skill.end('test'); a.skill.activate('test', { free: true }); }
  close(f.s.atk, 1000 * (1 + 25 * 0.12), 1e-6, 'cap +300 %');
  h.run(5.3);
  close(f.s.atk, 1000);
  checkInvariants(h.b);
});

test('萨尔贡 6 + 娜仁图亚: no ATK stacks; skill start lends the caster’s equipment (tier ≤ 5, 60 s) to its 8 neighbours', () => {
  const list = sargonDefs(6);
  const calls = [];
  deps.lendItemEffects = (battle, from, to, opts) => calls.push([from.defId, to.defId, opts]);
  try {
    // caster s0 at (10,4) with an item; neighbours: s1 (10,5), s2 (10,3); none_a far away
    const units = [
      { chessId: 's0_a', row: 10, col: 4, items: ['test_item_a'] }, { chessId: 's1_a', row: 10, col: 5 }, { chessId: 's2_a', row: 11, col: 3 },
      { chessId: 's3_a', row: 12, col: 8 }, { chessId: 's4_a', row: 12, col: 9 }, { chessId: 's5_a', row: 12, col: 10 },
      { chessId: 'none_a', row: 9, col: 4 },
    ];
    const h = makeBattle({ defs: defsOf(list), units, bandId: 'band_narant', bonds: { sargonShip: bondOn(6, 0, null, [3, 6]) } });
    h.step(1);
    h.unit('s0_a').skill.activate('test', { free: true });
    assert.deepEqual(calls.map((c) => c[1]).sort(), ['none_a', 's1_a', 's2_a']);
    assert.deepEqual(calls[0][2], { maxTier: 5, duration: 60 });
    assert.equal(h.unit('s1_a').s.aspd, 112, 'ASPD stacks still apply');
    close(h.unit('s1_a').s.atk, 1000, 1e-6, 'no ATK stacks with 娜仁图亚');
    // a member without equipment lends nothing
    calls.length = 0;
    h.unit('s1_a').skill.activate('test', { free: true });
    assert.equal(calls.length, 0);
    checkInvariants(h.b);
  } finally { deps.lendItemEffects = null; }
  if (typeof items.lendItemEffects === 'function') {
    const h = makeBattle({ defs: defsOf(list), units: [{ chessId: 's0_a', row: 10, col: 4, items: ['chess_item_1_01_e_a'] }, { chessId: 's1_a', row: 10, col: 5 }],
      bandId: 'band_narant', bonds: { sargonShip: bondOn(6, 0, null, [3, 6]) } });
    h.step(1);
    h.unit('s0_a').skill.activate('test', { free: true });
    h.run(1);
    assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors));
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// 维多利亚

test('维多利亚: equipment carriers deal ×(1.25+0.008L); 6: ATK +50 % per item, +80 % per golden item', () => {
  const list = [['v0_a', ['victoriaShip']], ['v1_a', ['victoriaShip']], ['v2_a', ['victoriaShip']], ['v3_a', ['victoriaShip']], ['v4_a', ['victoriaShip']], ['v5_a', ['victoriaShip']]];
  const L = 30;
  for (const n of [3, 6]) {
    const h = makeBattle({
      defs: defsOf(list), units: lineup(list.slice(0, n).map((x) => x[0]), { items: { 0: ['test_item_a'], 1: ['test_item_a', 'test_item_b'] } }),
      bonds: { victoriaShip: bondOn(n, L, null, [3, 6]) },
    });
    h.step(1);
    const [a, b, c] = ['v0_a', 'v1_a', 'v2_a'].map((id) => h.unit(id));
    close(a.s.dmgDealtMul, 1.25 + 0.008 * L);
    close(b.s.dmgDealtMul, 1.25 + 0.008 * L);
    close(c.s.dmgDealtMul, 1, 1e-9, 'no equipment → no bonus');
    if (n === 3) {
      close(a.s.atk, 1000);
    } else {
      close(a.s.atk, 1000 * 1.5);
      close(b.s.atk, 1000 * (1 + 0.5 + 0.8));
      close(c.s.atk, 1000);
    }
    h.b.addLayers('p1', 'victoriaShip', 10, 'test');
    h.step(2);
    close(a.s.dmgDealtMul, 1.25 + 0.008 * (L + 10), 1e-9, 'live layers');
    checkInvariants(h.b);
  }
});

test('维多利亚 hammers: every 25 layers → 1 item of pool_equip_vict, once per milestone, only while active (catch-up)', () => {
  // only the core bond meta: no 获得时 garrisons (洛洛 would craft items) muddying the item count
  const reg = createRegistry({ content: false });
  coreRegisterMeta(reg);
  const h = makeMatch({ mode: 'solo', seed: 5, registry: reg, fake: true }).start();
  h.toPrep(1);
  const ps = h.ps('p_0');
  for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean)]) if (p.kind === 'chess') ps.returnCopies(p);
  ps.board.clear();
  ps.hand.fill(null);
  ps.temp.fill(null);
  ps.recompute();
  const pool = new Set(DATA.choices.pools.pool_equip_vict.items.map((id) => id.replace(/_a$/, '')));
  // two identical normal hammers merge into the golden one (= 2 hammers)
  const hammers = () => [...ps.hand, ...ps.temp].filter((p) => p && p.kind === 'item' && pool.has(p.id.replace(/_[ab]$/, '')))
    .reduce((n, p) => n + (/_b$/.test(p.id) ? 2 : 1), 0);
  assert.equal(ps.bonds.victoriaShip?.active ?? false, false);
  ps.addLayers('victoriaShip', 51);           // "无需激活" gains while inactive: milestones 25 and 50 are owed
  assert.equal(hammers(), 0, 'inactive: no hammer');
  for (const id of ['chess_char_1_06_a', 'chess_char_2_05_a', 'chess_char_3_08_a']) give(h.m, ps, id, 'board', legalTileFor(h.m, ps, id));
  assert.equal(ps.bonds.victoriaShip.active, true);
  h.m.dispatch(ps, 'onPrepStart', { round: h.m.round });
  assert.equal(hammers(), 2, 'caught up once active');
  h.m.dispatch(ps, 'onPrepEnd', { round: h.m.round });
  ps.addLayers('victoriaShip', 10);           // 61
  assert.equal(hammers(), 2, 'no double payment');
  ps.addLayers('victoriaShip', 14);           // 75
  assert.equal(hammers(), 3);
  assert.equal(ps.counters['bond:victoria:hammers'], 3);
  h.invariants();
  h.m.dispose();
});

// ---------------------------------------------------------------------------------------------------------------------
// 谢拉格

test('谢拉格: ×1.25, vs cold / frozen ×(1.35+0.01L); 6: a cold wind every 25 s for 20+0.1L s', () => {
  const list = [];
  for (let i = 0; i < 6; i++) list.push([`k${i}_a`, ['kjeragShip']]);
  const L = 40;
  for (const n of [3, 6]) {
    const h = makeBattle({
      defs: defsOf(list), units: lineup(list.slice(0, n).map((x) => x[0])),
      enemies: [{ key: 'e_dummy', pos: [9, 8] }, { key: 'e_dummy', pos: [12, 8] }],
      bonds: { kjeragShip: bondOn(n, L, null, [3, 6]) }, autoFinish: false, timeLimit: 200,
    });
    h.step(1);
    const k = h.unit('k0_a');
    const [e1, e2] = h.enemies();
    if (n === 3) {
      const d1 = h.b.dealDamage(k, e1, { amount: 1000, type: 'true' });
      close(d1, 1250);
      h.b.applyStatus(e2, 'cold', { duration: 5 });
      const d2 = h.b.dealDamage(k, e2, { amount: 1000, type: 'true' });
      close(d2, 1000 * (1.35 + 0.01 * L));
      h.b.applyStatus(e2, 'cold', { duration: 5 });          // second cold ⇒ frozen
      assert.ok(e2.s.flags.freeze);
      close(h.b.dealDamage(k, e2, { amount: 1000, type: 'true' }), 1000 * (1.35 + 0.01 * L), 1e-6, 'frozen');
      h.run(30);
      assert.ok(!e1.s.flags.cold, 'no wind below 6');
    } else {
      h.run(24.8 - h.b.time);
      assert.ok(!e1.s.flags.cold);
      h.run(0.4);
      assert.ok(e1.s.flags.cold && e2.s.flags.cold, 'first gust at 25 s');
      h.run(20 + 0.1 * L - 0.6);
      assert.ok(e1.s.flags.cold, `cold lasts ${20 + 0.1 * L} s`);
      h.run(0.6);
      assert.ok(!e1.s.flags.cold && !e1.s.flags.freeze, 'cold over');
    }
    checkInvariants(h.b);
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// 拉特兰

test('拉特兰: ammo ×(1.05+0.015L) floored; 6: every ammo used → all members ATK +4 %, ≤ +200 %', () => {
  const list = [];
  for (let i = 0; i < 6; i++) list.push([`l${i}_a`, ['lateranoShip'], { profession: 'SNIPER' }]);
  list.push(['none_a', ['preciShip'], { profession: 'SNIPER' }]);
  const kits = {};
  for (const [id] of list) kits[id] = () => ({ skill: { kind: 'ammo', ammo: 14 } });
  const L = 10;
  for (const n of [3, 6]) {
    const ids = [...list.slice(0, n).map((x) => x[0]), 'none_a'];
    const h = makeBattle({ defs: defsOf(list), kits, units: lineup(ids), bonds: { lateranoShip: bondOn(n, L, null, [3, 6]) } });
    h.step(1);
    const a = h.unit('l0_a'), b = h.unit('l1_a'), x = h.unit('none_a');
    a.skill.activate('test', { free: true });
    x.skill.activate('test', { free: true });
    assert.equal(a.skill.ammoLeft, Math.floor(14 * (1 + 0.05 + 0.015 * L)));
    assert.equal(x.skill.ammoLeft, 14, 'non-member unchanged');
    for (let i = 0; i < 3; i++) a.skill.onAttackPerformed([], null);
    if (n === 3) {
      close(b.s.atk, 1000);
    } else {
      close(b.s.atk, 1000 * (1 + 3 * 0.04));
      close(x.s.atk, 1000, 1e-9, 'non-member gets nothing');
      for (let k = 0; k < 80; k++) {
        if (!a.skill.active) a.skill.activate('test', { free: true });
        a.skill.onAttackPerformed([], null);
      }
      close(b.s.atk, 1000 * 3, 1e-6, 'cap +200 %');
    }
    checkInvariants(h.b);
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// 阿戈尔

test('阿戈尔: HP ×(1.35+0.01L); devour chain (left first): 5000 物理流失 less the target\'s DEF, base ATK + block, layers = devoured tiers', () => {
  const list = [
    ['g1_a', ['egirShip']], ['g2_a', ['egirShip']], ['g3_a', ['egirShip']],
    ['fod_a', ['preciShip'], { tier: 4, stats: { atk: 700, blockCnt: 3, maxHp: 20000, def: 900 } }],
    ['tok_free', ['preciShip'], { tier: 6 }],
  ];
  const L = 10;
  // g1 (10,3) → g2 (10,4) → fodder (10,5); g3 (11,3) has an empty front tile
  const units = [{ chessId: 'g1_a', row: 10, col: 3 }, { chessId: 'g2_a', row: 10, col: 4 }, { chessId: 'fod_a', row: 10, col: 5 }, { chessId: 'g3_a', row: 11, col: 3 }];
  const h = makeBattle({ defs: defsOf(list), units, bonds: { egirShip: bondOn(3, L, null, [3, 5]) }, hooks: ['damaged', 'layerGain'], captureNoisy: true });
  h.step(1);
  const [g1, g2, g3, f] = ['g1_a', 'g2_a', 'g3_a', 'fod_a'].map((id) => h.unit(id));
  const devours = tagged(h, 'bond:egir:devour');
  assert.deepEqual(devours.map((c) => [c.credit.defId, c.target.defId]), [['g1_a', 'g2_a'], ['g1_a', 'fod_a'], ['g2_a', 'fod_a']]);
  // PRTS 盟约记录 "造成5000点物理流失"; PRTS 作战机制: a 物理流失 is reduced by the target's DEF
  for (const c of devours) close(c.amount, Math.max(5000 - c.target.s.def, 5000 * 0.05));
  close(g1.s.atk, 1000 + 1000 + 700, 1e-6, 'g1 gains g2 + fodder base ATK');
  close(g2.s.atk, 1000 + 700);
  close(g3.s.atk, 1000);
  assert.equal(g1.s.blockCnt, 2 + 2 + 3);
  assert.equal(g2.s.blockCnt, 2 + 3);
  close(f.hp, 20000 - 2 * (5000 - 900), 1e-6, '物理流失: less DEF 900 (DEF-free until 0.1.1)');
  const Lnow = L + 1 + 4;                                   // g2 tier 1 + fodder tier 4, once each
  assert.equal(h.b.getPlayer('p1').bonds.egirShip.layers, Lnow);
  h.step(2);
  close(g3.s.maxHp, 10000 * (1 + 0.35 + 0.01 * Lnow), 1e-6, 'HP multiplier follows the devour layers');
  close(f.s.maxHp, 20000, 1e-9, 'non-member HP unchanged');
  checkInvariants(h.b);
});

test('阿戈尔 devour ATK is a 最终加算 (GitHub #165 point 2, PR #176): 1000 base ATK, +100 % skill ATK, +2000 devoured → 4000, not 6000', () => {
  // PRTS 盟约记录 "该付与来源获得所有标记单位的基础攻击力（最终加算）"; PRTS 游戏数据基础 A_f = F_t[(A + D_p)(1 + D_t) + F_p]
  const list = [
    ['g1_a', ['egirShip']], ['g2_a', ['egirShip']], ['g3_a', ['egirShip']],
    ['fod_a', ['preciShip'], { stats: { atk: 2000, maxHp: 20000, def: 0, blockCnt: 1 } }],
  ];
  // g1 (10,3) → fodder (10,4, 2000 base ATK); g2 / g3 face empty tiles
  const units = [{ chessId: 'g1_a', row: 10, col: 3 }, { chessId: 'fod_a', row: 10, col: 4 }, { chessId: 'g2_a', row: 12, col: 3 }, { chessId: 'g3_a', row: 12, col: 5 }];
  const h = makeBattle({ defs: defsOf(list), units, bonds: { egirShip: bondOn(3, 0, null, [3, 5]) } });
  h.step(1);
  const g1 = h.unit('g1_a');
  assert.deepEqual(buffOf(g1, 'bond:egir:devour')?.mods, { atkFinal: 2000, blockCnt: 1 }, 'the fodder\'s base ATK as a 最终加算, its block count');
  close(g1.s.atk, 1000 + 2000, 1e-6, 'no percentage: as before');
  h.b.addBuff(g1, { key: 'test:skill', mods: { atkPct: 1 } });
  close(g1.s.atk, 1000 * 2 + 2000, 1e-6, '+100 %: 4000 (0.1.3: (1000 + 2000) × 2 = 6000)');
  h.b.addBuff(g1, { key: 'test:flat', mods: { atkFlat: 100 } });
  close(g1.s.atk, (1000 + 100) * 2 + 2000, 1e-6, 'a 直接加算 is still scaled by the percentages');
  h.b.addBuff(g1, { key: 'test:weaken', mods: { atkMul: 0.5 } });
  close(g1.s.atk, ((1000 + 100) * 2 + 2000) * 0.5, 1e-6, 'the 最终乘算 (Πmul) scales the whole, the 最终加算 included');
  checkInvariants(h.b);
});

test('阿戈尔 devour: 物理流失 ignores the marker’s damage bonuses and the target’s shields; a fallen marker’s marks still resolve (GitHub #165 point 3); kill → marker', () => {
  const list = [
    ['g1_a', ['egirShip', 'kjeragShip']], ['g2_a', ['egirShip'], { stats: { maxHp: 3000 } }], ['g3_a', ['egirShip']],
    ['fod_a', ['preciShip'], { tier: 2, stats: { maxHp: 20000, def: 500 } }],
  ];
  // g1 (10,3) → g2 (10,4, 3000×1.35 HP: dies to the first mark) → fodder (10,5); g3 elsewhere
  const units = [{ chessId: 'g1_a', row: 10, col: 3 }, { chessId: 'g2_a', row: 10, col: 4 }, { chessId: 'fod_a', row: 10, col: 5 }, { chessId: 'g3_a', row: 12, col: 3 }];
  const h = makeBattle({
    defs: defsOf(list), units, hooks: ['damaged', 'kill'], captureNoisy: true,
    bonds: { egirShip: bondOn(3, 0, null, [3, 5]), kjeragShip: bondOn(3, 0, null, [3, 6]) },   // g1 deals ×1.25
    setup: (b) => b.on('battleStart', () => b.addBuff(b.allyUnits.find((u) => u.defId === 'fod_a'), { key: 'test:shield', shield: 3000 }), { priority: 100 }),
  });
  h.step(1);
  const [g1, g2, f] = ['g1_a', 'g2_a', 'fod_a'].map((id) => h.unit(id));
  close(g1.s.dmgDealtMul, 1.25, 1e-9, '谢拉格 bonus present');
  assert.ok(!g2.alive, 'g2 devoured');
  assert.ok(h.hooksOf('kill').some((c) => c.victim === g2 && c.killer === g1), 'kill credited to the marker');
  const dv = tagged(h, 'bond:egir:devour');
  // PRTS 盟约记录: only the knocked-out TARGET's pending marks are cancelled — g2, knocked out by the first mark, still
  // resolves its own (until 0.1.3 a marker off the field gave no further mark)
  assert.deepEqual(dv.map((c) => [c.credit.defId, c.target.defId]), [['g1_a', 'g2_a'], ['g1_a', 'fod_a'], ['g2_a', 'fod_a']], 'g2’s own mark on the fodder resolves');
  close(f.hp, 20000 - 2 * (5000 - 500), 1e-6, '5000 less its DEF 500, twice: no ×1.25, shield untouched');
  assert.equal(f.buffs.find((b) => b.key === 'test:shield')?.shield, 3000);
  close(g1.s.atk, 1000 + 1000 + 1000, 1e-6, 'the base ATK of everything it marked stays');
  assert.equal(h.b.getPlayer('p1').bonds.egirShip.layers, 1 + 2, 'layers = tiers of the devoured units');
  checkInvariants(h.b);
});

test('阿戈尔 devour, A → B → C with B devoured first (GitHub #165 point 3, PR #176): C still takes B\'s 5000 and the kill is B\'s', () => {
  const list = [
    ['A_a', ['egirShip']], ['B_a', ['egirShip'], { stats: { maxHp: 3000 } }], ['g3_a', ['egirShip']],
    ['C_a', ['preciShip'], { tier: 2, stats: { maxHp: 9000, def: 0 } }],
  ];
  // A (10,3) → B (10,4, 3000 × 1.35 HP: knocked out by A's mark) → C (10,5, 9000 HP, DEF 0: A's mark leaves 4000, B's
  // knocks it out); g3 faces an empty tile. Marks: A → B, A → C (through B), B → C.
  const units = [{ chessId: 'A_a', row: 10, col: 3 }, { chessId: 'B_a', row: 10, col: 4 }, { chessId: 'C_a', row: 10, col: 5 }, { chessId: 'g3_a', row: 12, col: 3 }];
  const h = makeBattle({ defs: defsOf(list), units, bonds: { egirShip: bondOn(3, 0, null, [3, 5]) }, hooks: ['damaged', 'kill'], captureNoisy: true });
  h.step(1);
  const [A, B, C] = ['A_a', 'B_a', 'C_a'].map((id) => h.unit(id));
  assert.deepEqual(tagged(h, 'bond:egir:devour').map((c) => [c.credit.defId, c.target.defId]), [['A_a', 'B_a'], ['A_a', 'C_a'], ['B_a', 'C_a']]);
  assert.ok(!B.alive && !C.alive, 'B falls to A\'s mark, C to B\'s (until 0.1.3 B\'s mark was dropped: C stood at 4000 HP)');
  // PRTS 盟约记录 "单位被【吞噬】击杀时，击杀来源始终为对应标记的付与来源"
  assert.deepEqual(h.hooksOf('kill').map((c) => [c.victim.defId, c.killer?.defId]), [['B_a', 'A_a'], ['C_a', 'B_a']], 'the kill credit is the mark\'s marker, down or not');
  close(A.s.atk, 1000 + 1000 + 1000, 1e-6, 'A: the base ATK of B and C');
  assert.equal(h.b.getPlayer('p1').bonds.egirShip.layers, 1 + 2, 'each devoured unit adds its tier once');
  checkInvariants(h.b);
});

test('阿戈尔 devour order: left first, then top first (row 0 is the bottom: the top board row is 12)', () => {
  const list = [['g1_a', ['egirShip']], ['g2_a', ['egirShip']], ['g3_a', ['egirShip']], ['fod_a', ['preciShip']]];
  const units = [
    { uid: 'low', chessId: 'g1_a', row: 9, col: 3 }, { uid: 'f_low', chessId: 'fod_a', row: 9, col: 4 },
    { uid: 'high', chessId: 'g2_a', row: 12, col: 3 }, { uid: 'f_high', chessId: 'fod_a', row: 12, col: 4 },
    { uid: 'right', chessId: 'g3_a', row: 11, col: 2 }, { uid: 'f_right', chessId: 'fod_a', row: 11, col: 3 },
  ];
  const h = makeBattle({ defs: defsOf(list), units, bonds: { egirShip: bondOn(3, 0, null, [3, 5]) }, hooks: ['damaged'], captureNoisy: true });
  h.step(1);
  assert.deepEqual(tagged(h, 'bond:egir:devour').map((c) => c.credit.uid), ['right', 'high', 'low'], 'col 2 first, then row 12 before row 9');
  checkInvariants(h.b);
});

test('阿戈尔 5: in the fight the 3 slots go to the first 3 members knocked out, wherever they stand; a later first knock-out stays down; a second knock-out is final; 3 members: none', () => {
  const list = [];
  for (let i = 0; i < 5; i++) list.push([`g${i}_a`, ['egirShip'], { skill: { spCost: 30, initSp: 5, duration: 10 } }]);
  // one per row pair so nobody devours anybody: col 3 rows 9–12 (g0 bottom … g3 top), g4 at (9,5). PRTS 盟约记录 阿戈尔
  // "前3名【阿戈尔】干员首次被击倒时立刻复活"; the owner's decision of 2026-10-05: the first 3 knocked out, in knock-out order
  const units = list.map(([id], i) => ({ chessId: id, row: 9 + (i % 4), col: 3 + 2 * Math.floor(i / 4) }));
  const h = makeBattle({ defs: defsOf(list), units, bonds: { egirShip: bondOn(5, 0, null, [3, 5]) }, hooks: ['death', 'deploy'] });
  h.step(1);
  const us = list.map(([id]) => h.unit(id));
  const kill = (u) => h.b.dealDamage(null, u, { amount: 1e9, type: 'true' });
  const redeploys = (u) => h.hooksOf('deploy').filter((c) => c.unit === u && !c.initial).length;
  us[0].skill.gainSp(20, 'test');
  const tiles = us.map((u) => [u.tileR, u.tileC]);
  // g4 (second column) and g0 (bottom of the first column) first — the last two by position — then g2
  for (const i of [4, 0, 2]) {
    const u = us[i];
    kill(u);
    assert.ok(u.alive && u.deployed, `member ${i} back on the field`);
    close(u.hp, u.s.maxHp);
    assert.deepEqual([u.tileR, u.tileC], tiles[i], 'same tile');
    assert.ok(h.hooksOf('death').some((c) => c.unit === u && c.reason === 'killed'), 'it was knocked out (被击倒 triggers fire)');
    assert.equal(redeploys(u), 1, `member ${i} redeployed`);
  }
  assert.equal(us[0].skill.sp, 5, 'a redeploy restarts from the initial SP');
  // the 3 are gone: g3 (top-left, first by position) and g1 stay down on their first knock-out
  for (const i of [3, 1]) {
    kill(us[i]);
    assert.ok(!us[i].alive, `member ${i}: no slot left`);
    assert.equal(redeploys(us[i]), 0);
  }
  kill(us[4]);
  assert.ok(!us[4].alive, 'a second knock-out is final');
  assert.equal(h.eventsOf('fx').filter((x) => x[1] === 'revive').length, 3, 'three revives');
  checkInvariants(h.b);
  // a member moved off its board tile (突袭 / relocation) revives where it was knocked out; later redeploys go home
  const hm = makeBattle({ defs: defsOf(list), units, bonds: { egirShip: bondOn(5, 0, null, [3, 5]) }, hooks: [] });
  hm.step(1);
  const m = hm.unit('g3_a');
  const home = [m.homeR, m.homeC];
  assert.ok(hm.b.relocate(m, 12, 8));
  hm.b.dealDamage(null, m, { amount: 1e9, type: 'true' });
  assert.ok(m.alive && m.tileR === 12 && m.tileC === 8, 'revived on the tile it fell on');
  assert.deepEqual([m.homeR, m.homeC], home, 'home unchanged');
  checkInvariants(hm.b);
  // 3 members: no revive
  const h3 = makeBattle({ defs: defsOf(list), units: units.slice(1, 4), bonds: { egirShip: bondOn(3, 0, null, [3, 5]) } });
  h3.step(1);
  h3.b.dealDamage(null, h3.unit('g3_a'), { amount: 1e9, type: 'true' });
  assert.ok(!h3.unit('g3_a').alive);
});

test('阿戈尔 5 + the devour chain (GitHub #33, #105, #140): the eaten members take the 3 slots (by position once the devour is over — here also the knock-out order), uneaten ones keep none — survivors = uneaten + 3 (normal and 联防)', () => {
  // row 10, all facing right: 浊心斯卡蒂 → 幽灵鲨 → 海霓 → 深巡 → 歌蕾蒂娅 → 隐现; 乌尔比安 on row 12 faces an empty tile.
  // PRTS 盟约记录 阿戈尔 备注 "标记按付与顺序触发【吞噬】效果，目标首次被击倒后解除自身被付与但还未触发的【吞噬】效果". Until 0.1.3
  // the slots belonged to the first 3 by position (浊心斯卡蒂, 乌尔比安, 幽灵鲨: two uneaten members held them, so only 幽灵鲨
  // of the food came back — "没被吃的阿戈尔干员也会占用复活名额", "无论食物链怎么吃最终都只有三名阿戈尔人存活")
  const ids = ['chess_char_6_04_a', 'chess_char_2_07_a', 'chess_char_3_09_a', 'chess_char_1_04_a', 'chess_char_4_12_a', 'chess_char_1_01_a'];
  const ULPIA = 'chess_char_5_05_a';
  for (const kind of ['normal', 'unite']) {
    const h = makeBattle({
      kind, units: [...ids.map((chessId, i) => ({ chessId, row: 10, col: 2 + i })), { chessId: ULPIA, row: 12, col: 3 }],
      bonds: { egirShip: bondOn(6, 0, null, [3, 5]) }, hooks: ['damaged', 'death', 'deploy'], captureNoisy: true, autoFinish: false, timeLimit: 60,
    });
    h.step(1);
    const [skadi, ghost, hn, deep, glady, fodder] = ids.map((id) => h.unit(id));
    const ulpia = h.unit(ULPIA);
    // 浊心斯卡蒂 marks the whole row (through the members) and resolves first; every later mark is on a unit knocked out
    assert.deepEqual(tagged(h, 'bond:egir:devour').map((c) => [c.credit.defId, c.target.defId]),
      [ghost, hn, deep, glady, fodder].map((t) => [skadi.defId, t.defId]), kind);
    const kos = (u) => h.hooksOf('death').filter((c) => c.unit === u && c.reason === 'killed').length;
    const revived = (u) => h.hooksOf('deploy').filter((c) => c.unit === u && !c.initial).length;
    for (const u of [ghost, hn, deep, glady]) assert.equal(kos(u), 1, `${kind}: ${u.defId} knocked out once`);
    for (const u of [ghost, hn, deep]) assert.equal(revived(u), 1, `${kind}: ${u.defId} (knocked out 1st–3rd, the first 3 by position) revived at t = 0`);
    assert.equal(revived(glady), 0, `${kind}: 歌蕾蒂娅 (knocked out 4th, 4th by position) stays down`);
    assert.equal(kos(skadi) + kos(ulpia) + revived(skadi) + revived(ulpia), 0, `${kind}: the uneaten members take no slot`);
    h.run(3);
    const members = [skadi, ghost, hn, deep, glady, ulpia];
    assert.deepEqual(members.filter((u) => u.alive).map((u) => u.defId), [skadi, ghost, hn, deep, ulpia].map((u) => u.defId),
      `${kind}: survivors = the 2 uneaten + 3`);
    assert.ok(!fodder.alive, `${kind}: the fodder (no member) is down`);
    // nothing is left for the fight: 浊心斯卡蒂's first knock-out and 幽灵鲨's second stay down
    for (const u of [skadi, ghost]) {
      h.b.dealDamage(null, u, { amount: 1e9, type: 'true' });
      assert.ok(!u.alive, `${kind}: ${u.defId} stays down`);
    }
    checkInvariants(h.b);
  }
});

test('阿戈尔 5: a member devoured by several 阿戈尔 spends one slot at most — its pending marks are cancelled once it is knocked out', () => {
  // A (10,3) → B (10,4) → X (10,5) and C (11,5, facing DOWN) → X: three marks on X; D (12,8) faces an empty tile
  const list = [['A_a', ['egirShip']], ['B_a', ['egirShip']], ['X_a', ['egirShip']], ['C_a', ['egirShip']], ['D_a', ['egirShip']]];
  const defs = defsOf(list.map(([id, b]) => [id, b, { stats: { maxHp: 3000 } }]));
  const units = [
    { chessId: 'A_a', row: 10, col: 3 }, { chessId: 'B_a', row: 10, col: 4 }, { chessId: 'X_a', row: 10, col: 5 },
    { chessId: 'C_a', row: 11, col: 5, dir: 'DOWN' }, { chessId: 'D_a', row: 12, col: 8 },
  ];
  const h = makeBattle({ defs, units, bonds: { egirShip: bondOn(5, 0, null, [3, 5]) }, hooks: ['damaged', 'death', 'deploy'], captureNoisy: true, autoFinish: false, timeLimit: 60 });
  h.step(1);
  const [a, b, x, c, d] = ['A_a', 'B_a', 'X_a', 'C_a', 'D_a'].map((id) => h.unit(id));
  const kos = (u) => h.hooksOf('death').filter((e) => e.unit === u && e.reason === 'killed').length;
  const revived = (u) => h.hooksOf('deploy').filter((e) => e.unit === u && !e.initial).length;
  // marked by A (through B), by B and by C; A's mark knocks it out, B's and C's are cancelled
  assert.deepEqual(tagged(h, 'bond:egir:devour').map((e) => [e.credit.defId, e.target.defId]), [['A_a', 'B_a'], ['A_a', 'X_a']]);
  for (const u of [b, x]) assert.ok(u.alive && kos(u) === 1 && revived(u) === 1, `${u.defId}: one knock-out, one slot`);
  close(x.hp, x.s.maxHp, 1e-6, 'X at full HP: no second mark');
  // two slots used: D's first knock-out takes the third, C's stays down
  h.b.dealDamage(null, d, { amount: 1e9, type: 'true' });
  assert.ok(d.alive, 'D: the third slot');
  h.b.dealDamage(null, c, { amount: 1e9, type: 'true' });
  assert.ok(!c.alive, 'C: none left');
  assert.ok(a.alive && kos(a) === 0, 'A never knocked out');
  checkInvariants(h.b);
  // X with more HP survives A's and B's marks and falls to C's: still one knock-out, one slot
  const tough = defsOf(list.map(([id, bd]) => [id, bd, { stats: { maxHp: id === 'X_a' ? 8000 : 3000 } }]));
  const t = makeBattle({ defs: tough, units, bonds: { egirShip: bondOn(5, 0, null, [3, 5]) }, hooks: ['damaged', 'death', 'deploy'], captureNoisy: true, autoFinish: false, timeLimit: 60 });
  t.step(1);
  const tx = t.unit('X_a');
  assert.deepEqual(tagged(t, 'bond:egir:devour').map((e) => [e.credit.defId, e.target.defId]), [['A_a', 'B_a'], ['A_a', 'X_a'], ['B_a', 'X_a'], ['C_a', 'X_a']]);
  assert.equal(t.hooksOf('death').filter((e) => e.unit === tx && e.reason === 'killed').length, 1, 'X knocked out once, by the third mark');
  assert.ok(tx.alive && t.eventsOf('fx').filter((e) => e[1] === 'revive').length === 2, 'B and X: two slots');
  checkInvariants(t.b);
});

test('阿戈尔 5: an operator\'s own save or revive uses no slot (斯卡蒂\'s DRE-Y, M3茧甲, 埃芒加德 [ASSUMED for the band]); the slot waits for its first unanswered knock-out', () => {
  // 斯卡蒂 (elite, module DRE-Y by default) starts a normal field at half HP in front of 乌尔比安: his mark is lethal,
  // DRE-Y saves her. Half HP is a fixture here; a restored 联防 target no longer pays opening devour damage twice.
  // (PRTS: once per deployment, full HP with max HP −60 %) — no knock-out, so no slot
  const SKADI = 'chess_char_3_05_b', ULPIA = 'chess_char_5_05_a', GHOST = 'chess_char_2_07_a', HN = 'chess_char_3_09_a', DEEP = 'chess_char_1_04_a';
  const h = makeBattle({
    kind: 'normal', autoFinish: false, timeLimit: 60, hooks: ['damaged', 'death', 'deploy'], captureNoisy: true,
    units: [
      { chessId: ULPIA, row: 10, col: 3 }, { chessId: SKADI, row: 10, col: 4, dir: 'UP', carryState: { hpPct: 0.5 } },
      { chessId: GHOST, row: 12, col: 3 }, { chessId: HN, row: 12, col: 5 }, { chessId: DEEP, row: 12, col: 7 },
    ],
    bonds: { egirShip: bondOn(5, 0, null, [3, 5]) },
  });
  h.step(1);
  const sk = h.unit(SKADI);
  assert.deepEqual(tagged(h, 'bond:egir:devour').map((c) => [c.credit.defId, c.target.defId]), [[ULPIA, SKADI]]);
  assert.ok(sk.alive && buffOf(sk, 'trait:skadi_tide'), 'saved by her module');
  assert.equal(h.hooksOf('death').filter((c) => c.unit === sk).length, 0, 'not knocked out');
  assert.equal(h.eventsOf('fx').filter((x) => x[1] === 'revive' && x[4] && x[4].n).length, 0, 'no 阿戈尔 revive');
  const kill = (id) => { const u = h.unit(id); h.b.dealDamage(null, u, { amount: 1e9, type: 'true' }); return u.alive; };
  // all 3 slots are still there: 幽灵鲨, 海霓 and then 斯卡蒂 (DRE-Y spent in this deployment) come back, 深巡 does not
  assert.deepEqual([GHOST, HN, SKADI, DEEP].map(kill), [true, true, true, false]);
  checkInvariants(h.b);

  const list = [['g0_a', ['egirShip']], ['g1_a', ['egirShip']], ['g2_a', ['egirShip']], ['g3_a', ['egirShip']], ['g4_a', ['egirShip']]];
  const units = (it = {}) => list.map(([chessId], i) => ({ chessId, row: 9 + (i % 2) * 3, col: 3 + i, items: it[i] }));
  const killed = (b, id) => { const u = b.unit(id); b.b.dealDamage(null, u, { amount: 1e9, type: 'true' }); return u; };
  // M3茧甲 (an item 复活 — since 0.2.0 PRTS's form: a knock-out answered by a free redeploy, items reviveNow): g0 is knocked
  // out and back at once, the 3 slots go to g1, g2, g3; g4 stays down
  const hi = makeBattle({ defs: defsOf(list), autoFinish: false, timeLimit: 60, hooks: ['death', 'deploy'], units: units({ 0: ['chess_item_4_12_e_a'] }), bonds: { egirShip: bondOn(5, 0, null, [3, 5]) } });
  hi.step(1);
  const g0 = killed(hi, 'g0_a');
  assert.ok(g0.alive && hi.hooksOf('death').filter((c) => c.unit === g0 && c.reason === 'killed').length === 1, 'item: knocked out and revived');
  assert.equal(hi.hooksOf('death').find((c) => c.unit === g0).revivedBy, 'item');
  assert.deepEqual(['g1_a', 'g2_a', 'g3_a', 'g4_a'].map((id) => killed(hi, id).alive), [true, true, true, false], 'item: three slots left after the revive');
  checkInvariants(hi.b);
  // 埃芒加德 (命结之秘: the battle's first 3 knock-downs revive at once — its own count, unchanged): g0, g1, g2 revived by it;
  // the 阿戈尔 slots then go to g3, g4 and g0's next knock-out (its first unanswered one); g1's finds none
  const hb = makeBattle({ defs: defsOf(list), autoFinish: false, timeLimit: 60, hooks: ['death', 'deploy'], units: units(), bandId: 'band_ermengard', bonds: { egirShip: bondOn(5, 0, null, [3, 5]) } });
  hb.step(1);
  for (const id of ['g0_a', 'g1_a', 'g2_a']) {
    const u = killed(hb, id);
    const deaths = hb.hooksOf('death').filter((c) => c.unit === u);
    assert.ok(u.alive && deaths.length === 1 && deaths[0].revivedBy === 'band', `band: ${id} knocked out and revived by the band`);
  }
  assert.deepEqual(hb.eventsOf('fx').filter((x) => x[1] === 'revive' && x[4] && x[4].left != null).map((x) => x[4].left), [2, 1, 0], '埃芒加德 spent its 3');
  assert.deepEqual(['g3_a', 'g4_a', 'g0_a', 'g1_a'].map((id) => killed(hb, id).alive), [true, true, true, false], 'band: the 阿戈尔 slots are untouched');
  checkInvariants(hb.b);
});

test('阿戈尔 5 slots in 联防 and on the boss field: a member entering down takes none until it is knocked out after standing up; a 调和 member takes one; a mirrored player counts its own knock-outs', () => {
  const list = [['g0_a', ['egirShip']], ['g1_a', ['egirShip']], ['g2_a', ['egirShip']], ['g3_a', ['egirShip']], ['g4_a', ['egirShip']], ['mani_a', ['maniShip']]];
  // five members in five columns (one per column, nobody in front of anybody): g0 col 3 … g4 col 7
  const units = list.slice(0, 5).map(([chessId], i) => ({ chessId, row: 9 + (i % 2) * 3, col: 3 + i }));
  const revives = (h, id) => {
    const u = h.unit(id);
    h.b.dealDamage(null, u, { amount: 1e9, type: 'true' });
    return u.alive;
  };
  // 联防: g0 entered down (forced out before battleStart — not a 击倒, so no slot); g4 and g3 take two slots, g0's first
  // knock-out after it stands back up takes the third, g1 finds none
  const hu = makeBattle({
    kind: 'unite', defs: defsOf(list), autoFinish: false, timeLimit: 60, bonds: { egirShip: bondOn(5, 0, null, [3, 5]) },
    units: units.map((u, i) => (i === 0 ? { ...u, carryState: { down: true } } : u)),
  });
  hu.step(1);
  const g0 = hu.unit('g0_a');
  assert.ok(!g0.alive, 'g0 forced out');
  assert.deepEqual(['g4_a', 'g3_a'].map((id) => revives(hu, id)), [true, true]);
  assert.ok(hu.runUntil(() => g0.alive && g0.deployed, 25), 'g0 stands back up inside the redeploy time');
  assert.equal(revives(hu, 'g0_a'), true, 'g0: its first knock-out takes the third slot');
  assert.equal(revives(hu, 'g1_a'), false, 'g1: none left');
  checkInvariants(hu.b);
  // 调和 (an active 调和 member enjoys the core bonds): knocked out first, it takes the first slot
  const hm = makeBattle({
    defs: defsOf(list), autoFinish: false, timeLimit: 60,
    units: [{ chessId: 'mani_a', row: 11, col: 2 }, ...units.slice(0, 4)],
    bonds: { egirShip: bondOn(5, 0, null, [3, 5]), maniShip: { count: 1, active: true, tier: 1, layers: 0 } },
  });
  hm.step(1);
  assert.deepEqual(['mani_a', 'g3_a', 'g2_a', 'g0_a'].map((id) => revives(hm, id)), [true, true, true, false]);
  // the right-hand boss player (mirrored): the order of its own knock-outs, wherever they stand
  const hb = makeBattle({
    kind: 'boss', defs: defsOf(list), autoFinish: false, timeLimit: 60,
    players: [{ playerId: 'R1', side: 'R', colOffset: 8, units: units.map((u, i) => ({ ...u, uid: i + 1 })), bonds: { egirShip: bondOn(5, 0, null, [3, 5]) } }],
  });
  hb.step(1);
  assert.deepEqual(['g4_a', 'g3_a', 'g0_a', 'g1_a', 'g2_a'].map((id) => [hb.unit(id).tileC, revives(hb, id)]),
    [[13, true], [14, true], [17, true], [16, false], [15, false]]);
  checkInvariants(hb.b);
});

test('阿戈尔 devour, a unit back during the pass: a knocked-out marker (revived by the 5-tier once the devour is over) still gives its marks; a target revived in place (埃芒加德) or redeployed (不屈) takes none', () => {
  // g1 (10,3) → g2 (10,4, 3000 × 1.35 HP: knocked out by g1's mark, revived) → g3 (10,5) → fodder (10,6); g4 / g5 face empty tiles
  const list = [
    ['g1_a', ['egirShip']], ['g2_a', ['egirShip'], { stats: { maxHp: 3000 } }], ['g3_a', ['egirShip'], { stats: { maxHp: 20000 } }],
    ['g4_a', ['egirShip']], ['g5_a', ['egirShip']], ['fod_a', ['preciShip'], { tier: 2, stats: { maxHp: 20000 } }],
  ];
  const units = [
    { chessId: 'g1_a', row: 10, col: 3 }, { chessId: 'g2_a', row: 10, col: 4 }, { chessId: 'g3_a', row: 10, col: 5 }, { chessId: 'fod_a', row: 10, col: 6 },
    { chessId: 'g4_a', row: 12, col: 3 }, { chessId: 'g5_a', row: 12, col: 5 },
  ];
  const h = makeBattle({ defs: defsOf(list), units, bonds: { egirShip: bondOn(5, 0, null, [3, 5]) }, hooks: ['damaged', 'deploy'], captureNoisy: true });
  h.step(1);
  const [g2, f] = ['g2_a', 'fod_a'].map((id) => h.unit(id));
  assert.ok(g2.alive && h.hooksOf('deploy').some((c) => c.unit === g2 && !c.initial), 'g2 knocked out and revived');
  // every mark resolves whatever became of its marker (DESIGN §24.7): g2, knocked out (back once the pass is over), still
  // devours g3 and the fodder
  assert.deepEqual(tagged(h, 'bond:egir:devour').map((c) => [c.credit.defId, c.target.defId]),
    [['g1_a', 'g2_a'], ['g1_a', 'g3_a'], ['g1_a', 'fod_a'], ['g2_a', 'g3_a'], ['g2_a', 'fod_a'], ['g3_a', 'fod_a']]);
  close(f.hp, 20000 - 3 * 5000, 1e-6, 'the fodder: g1, g2 and g3');
  close(g2.s.atk, 1000 + 1000 + 1000, 1e-6, 'g2 keeps the base ATK it gained at marking (a persistent buff) [ASSUMED]');
  assert.equal(h.b.getPlayer('p1').bonds.egirShip.layers, 1 + 1 + 2, 'each devoured unit adds its tier once');
  checkInvariants(h.b);
  // 3 members, g1 → g2 → fodder (3000 HP): g1's mark knocks the fodder out, it is back at once, g2's mark on it is cancelled
  const list2 = [
    ['g1_a', ['egirShip']], ['g2_a', ['egirShip'], { stats: { maxHp: 20000 } }], ['g3_a', ['egirShip']],
    ['fod_a', ['indomShip'], { tier: 2, stats: { maxHp: 3000 } }],
  ];
  const units2 = [{ chessId: 'g1_a', row: 10, col: 3 }, { chessId: 'g2_a', row: 10, col: 4 }, { chessId: 'fod_a', row: 10, col: 5 }, { chessId: 'g3_a', row: 12, col: 3 }];
  // 埃芒加德 (命结之秘: the first 3 knocked-out operators revive — knocked out, then redeployed at once where they lie,
  // a new deployment: items reviveNow)
  const e = makeBattle({ defs: defsOf(list2), units: units2, bandId: 'band_ermengard', bonds: { egirShip: bondOn(3, 0, null, [3, 5]) }, hooks: ['damaged'], captureNoisy: true });
  e.step(1);
  const fe = e.unit('fod_a');
  assert.deepEqual(tagged(e, 'bond:egir:devour').map((c) => [c.credit.defId, c.target.defId]), [['g1_a', 'g2_a'], ['g1_a', 'fod_a']]);
  assert.ok(fe.alive, 'revived in place');
  close(fe.hp, fe.s.maxHp, 1e-6, 'at full HP: no second mark');
  assert.deepEqual(e.eventsOf('fx').filter((x) => x[1] === 'revive').map((x) => x[4].left), [2], 'one 埃芒加德 revive spent, not two');
  checkInvariants(e.b);
  // 不屈 at p = min(1, 0.18 + 0.004 × 300) = 1: 立刻重新部署 where it lies — a knock-out and a new deployment. Until 0.1.1
  // g2's mark knocked the fodder out again within the same instant, where 不屈 does not fire twice, and it stayed down
  const u = makeBattle({
    defs: defsOf(list2), units: units2, hooks: ['damaged', 'death', 'deploy'], captureNoisy: true,
    bonds: { egirShip: bondOn(3, 0, null, [3, 5]), indomShip: bondOn(2, 300, 1, [2, 3]) },
  });
  u.step(1);
  const fu = u.unit('fod_a');
  assert.deepEqual(tagged(u, 'bond:egir:devour').map((c) => [c.credit.defId, c.target.defId]), [['g1_a', 'g2_a'], ['g1_a', 'fod_a']]);
  assert.ok(fu.alive && u.hooksOf('deploy').some((c) => c.unit === fu && !c.initial), 'redeployed by 不屈');
  assert.equal(u.hooksOf('death').filter((c) => c.unit === fu && c.reason === 'killed').length, 1, 'knocked out once');
  checkInvariants(u.b);
});

// A community report the owner relayed on 2026-10-07 (DESIGN §25.22.5): 「原作里是第一步给所有鱼加盟约的血量，第二步是开始
// 一个个大鱼吃小鱼，第三步是检测左下到右上哪些鱼睡着了给他复活」.

test('阿戈尔 (community report, 2026-10-07) step 1: the bond HP is on every member before the devour — an elite 深巡 (2904 HP, DEF 655) in front of one 阿戈尔 stands from 15 layers on; step 2: one 5000 物理流失 per mark — over 5000 HP survives one mark, falls to a second', () => {
  const ULPIA = 'chess_char_5_05_b', DEEP = 'chess_char_1_04_b', GHOST = 'chess_char_2_07_b', SKADI2 = 'chess_char_6_04_b';
  const rest = [{ chessId: 'chess_char_4_09_b', row: 12, col: 3 }, { chessId: 'chess_char_3_09_b', row: 12, col: 5 }, { chessId: 'chess_char_4_12_b', row: 12, col: 7 }];
  const fight = (units, layers) => {
    const pre = new Map(), post = new Map();
    const look = (b, into) => () => { for (const u of b.allyUnits) into.set(u.defId, { hp: u.hp, maxHp: u.s.maxHp, def: u.s.def }); };
    const h = makeBattle({
      units: [...units, ...rest], autoFinish: false, timeLimit: 60, hooks: ['damaged', 'death', 'kill'], captureNoisy: true,
      bonds: { egirShip: bondOn(5, layers, null, [3, 5]) },
      // before (priority 100) and after (−100) the devour, which runs at the default 0
      setup: (b) => { b.on('battleStart', look(b, pre), { priority: 100 }); b.on('battleStart', look(b, post), { priority: -100 }); },
    });
    h.step(1);
    return { h, pre, post };
  };
  // the player's official game: 「深巡是精二的，休整期的原始血量只有不到三千，所以肯定是部署后先经过盟约加血才活了下来」
  for (const [L, stands] of [[14, false], [15, true]]) {
    const { h, pre, post } = fight([{ chessId: ULPIA, row: 10, col: 3 }, { chessId: DEEP, row: 10, col: 4 }], L);
    const p = pre.get(DEEP);
    close(p.maxHp, 2904 * (1 + 0.35 + 0.01 * L), 1e-6, `L ${L}: the bond's +(35 + L) % is there before the devour`);
    close(p.hp, p.maxHp, 1e-6, `L ${L}: deployed at full HP`);
    assert.equal(p.def, 655);
    assert.deepEqual(tagged(h, 'bond:egir:devour').map((c) => [c.credit.defId, c.target.defId, c.amount]), [[ULPIA, DEEP, 5000 - 655]]);
    assert.equal(h.hooksOf('death').filter((c) => c.unit === h.unit(DEEP) && c.reason === 'killed').length, stands ? 0 : 1, `L ${L}`);
    if (stands) close(post.get(DEEP).hp, 2904 * 1.5 - 4345, 1e-6, 'L 15: 4356 − 4345 = 11 HP left');
  }
  // an elite 幽灵鲨 at 62 layers: 2422 × (1 + 0.35 + 0.62 + 0.12 her talent at full potential) = 5061.98 HP, DEF 365 — one
  // mark (4635) leaves 426.98; behind 浊心斯卡蒂 and 乌尔比安 she takes both marks and falls to the second (the kill is 乌尔比安's)
  const one = fight([{ chessId: ULPIA, row: 10, col: 3 }, { chessId: GHOST, row: 10, col: 4 }], 62);
  close(one.pre.get(GHOST).maxHp, 2422 * 2.09, 1e-6, 'over 5000 HP');
  close(one.post.get(GHOST).hp, 2422 * 2.09 - (5000 - 365), 1e-6, 'one mark: she stands');
  assert.equal(one.h.hooksOf('death').length, 0);
  const two = fight([{ chessId: SKADI2, row: 10, col: 3 }, { chessId: ULPIA, row: 10, col: 4 }, { chessId: GHOST, row: 10, col: 5 }], 62);
  assert.deepEqual(tagged(two.h, 'bond:egir:devour').filter((c) => c.target.defId === GHOST).map((c) => [c.credit.defId, c.amount]),
    [[SKADI2, 4635], [ULPIA, 4635]], 'marked by each 阿戈尔 behind her (PRTS 盟约记录 "每个标记令目标受到一次5000点物理流失")');
  assert.deepEqual(two.h.hooksOf('kill').filter((c) => c.victim.defId === GHOST).map((c) => c.killer?.defId), [ULPIA], 'the second mark knocks her out');
  checkInvariants(two.h.b);
});

/**
 * Nine members, all facing RIGHT unless noted (row 12 is the top of the board, row 9 the bottom). The four food F1 (12,4),
 * F2 (11,4), F3 (10,4) and F4 (9,5) face LEFT, back at their marker (which marked them), so they mark nothing; B1 (12,3)
 * → F1, B2 (11,3) → F2, B3 (10,3) → F3, B4 (9,4) → F4, and B5 (10,5) facing LEFT → F3 and, through F3, B3. Marks in
 * order (left first, then top first): B1→F1, B2→F2, B3→F3, B4→F4, B5→F3, B5→B3. HP ×1.35: F1 / F2 / F4 4050 fall to
 * one mark, F3 6750 to its second (B5's), the B's 13500 stand. Knocked out: F1, F2, F4, F3 — in that order.
 */
function egirFood({ downB4 = false } = {}) {
  const list = [
    ...['B1_a', 'B2_a', 'B3_a', 'B4_a', 'B5_a'].map((id) => [id, ['egirShip']]),
    ['F1_a', ['egirShip'], { stats: { maxHp: 3000 } }], ['F2_a', ['egirShip'], { stats: { maxHp: 3000 } }],
    ['F3_a', ['egirShip'], { stats: { maxHp: 5000 } }], ['F4_a', ['egirShip'], { stats: { maxHp: 3000 } }],
  ];
  const units = [
    { uid: 11, chessId: 'B1_a', row: 12, col: 3 }, { uid: 1, chessId: 'F1_a', row: 12, col: 4, dir: 'LEFT' },
    { uid: 12, chessId: 'B2_a', row: 11, col: 3 }, { uid: 2, chessId: 'F2_a', row: 11, col: 4, dir: 'LEFT' },
    { uid: 13, chessId: 'B3_a', row: 10, col: 3 }, { uid: 3, chessId: 'F3_a', row: 10, col: 4, dir: 'LEFT' },
    { uid: 14, chessId: 'B4_a', row: 9, col: 4, ...(downB4 ? { carryState: { down: true } } : {}) }, { uid: 4, chessId: 'F4_a', row: 9, col: 5, dir: 'LEFT' },
    { uid: 15, chessId: 'B5_a', row: 10, col: 5, dir: 'LEFT' },
  ];
  return { defs: defsOf(list), units };
}

test('阿戈尔 5 (community report, 2026-10-07) step 3: the battle-start devour\'s knock-outs revive once every devour is over, by position from the bottom-left (columns from the left, bottom first) — not in knock-out order; normal, 联防, the mirrored boss player', () => {
  for (const kind of ['normal', 'unite', 'bossR']) {
    const { defs, units } = egirFood({ downB4: kind === 'unite' });
    const seq = [];
    const setup = (b) => {
      b.on('damaged', (c) => { if (c.dmg?.tags?.includes('bond:egir:devour')) seq.push(`mark ${c.credit.uid}→${c.target.uid}`); }, { priority: -1000 });
      b.on('deploy', (c) => { if (!c.initial) seq.push(`revive ${c.unit.uid}`); }, { priority: -1000 });
    };
    const bonds = { egirShip: bondOn(5, 0, null, [3, 5]) };
    const opts = { defs, autoFinish: false, timeLimit: 60, hooks: ['death', 'deploy'], setup };
    const h = kind === 'bossR'
      ? makeBattle({ ...opts, kind: 'boss', players: [{ playerId: 'R1', side: 'R', colOffset: 8, units, bonds }] })
      : makeBattle({ ...opts, kind, units, bonds });
    h.step(1);
    const uid = (u) => u.uid;
    const kos = h.hooksOf('death').filter((c) => c.reason === 'killed').map((c) => uid(c.unit));
    assert.deepEqual(kos, [1, 2, 4, 3], `${kind}: knocked out F1, F2, F4, F3`);
    // every mark resolves first, then the revives — F3 (10,4), F2 (11,4), F1 (12,4) of the left column, bottom first; F4
    // (9,5), in the next column, finds no slot. Until 0.2.0 (knock-out order, DESIGN §24.3): F1, F2, F4 at once, F3 down.
    // The other reading of 「左下到右上」 (rows from the bottom) would revive F4, F3, F2 and leave F1 down.
    assert.deepEqual(seq, ['mark 11→1', 'mark 12→2', 'mark 13→3', 'mark 14→4', 'mark 15→3', 'mark 15→13', 'revive 3', 'revive 2', 'revive 1'], kind);
    const by = (id) => h.b.allyUnits.find((u) => u.uid === id);
    assert.deepEqual([1, 2, 3, 4].map((id) => by(id).alive), [true, true, true, false], `${kind}: F4 stays down`);
    assert.ok(by(13).alive && !kos.includes(13), `${kind}: B3, marked but standing, takes no slot`);
    assert.equal(h.eventsOf('fx').filter((x) => x[1] === 'revive' && x[4]?.src === 'bond:egirShip').length, 3, `${kind}: the 3 slots`);
    if (kind === 'unite') assert.ok(!by(14).alive && by(14).removeReason === FORCED_EXIT, '联防: B4 entered down — its mark resolved, it stays forced out');
    // the slots are gone: B1's first knock-out in the fight stays down, F4 stays down
    h.b.dealDamage(null, by(11), { amount: 1e9, type: 'true' });
    assert.ok(!by(11).alive && !by(4).alive, `${kind}: no slot left`);
    checkInvariants(h.b);
  }
});

test('阿戈尔 5 (community report, 2026-10-07): the slots the devour leaves go to later knock-outs in time order; an uneaten member takes one only by being knocked out; a member 不屈 redeploys during the devour is awake at the scan and takes none [ASSUMED]', () => {
  const { defs } = egirFood();
  // only F1 and F2 are eaten: B1 → F1, B2 → F2; B3 (10,3), B4 (9,4), B5 (9,6) face empty tiles
  const units = [
    { uid: 11, chessId: 'B1_a', row: 12, col: 3 }, { uid: 1, chessId: 'F1_a', row: 12, col: 4, dir: 'LEFT' },
    { uid: 12, chessId: 'B2_a', row: 11, col: 3 }, { uid: 2, chessId: 'F2_a', row: 11, col: 4, dir: 'LEFT' },
    { uid: 13, chessId: 'B3_a', row: 10, col: 3, dir: 'DOWN' }, { uid: 14, chessId: 'B4_a', row: 9, col: 5 }, { uid: 15, chessId: 'B5_a', row: 9, col: 7 },
  ];
  const run = (extra = {}) => {
    const h = makeBattle({ defs, units, autoFinish: false, timeLimit: 60, hooks: ['death', 'deploy'], bonds: { egirShip: bondOn(5, 0, null, [3, 5]), ...extra } });
    h.step(1);
    const by = (id) => h.b.allyUnits.find((u) => u.uid === id);
    const kill = (id) => { h.b.dealDamage(null, by(id), { amount: 1e9, type: 'true' }); return by(id).alive; };
    const egirRevives = () => h.eventsOf('fx').filter((x) => x[1] === 'revive' && x[4]?.src === 'bond:egirShip').map((x) => x[4].n);
    return { h, by, kill, egirRevives };
  };
  const a = run();
  assert.deepEqual(a.h.hooksOf('deploy').filter((c) => !c.initial).map((c) => c.unit.uid), [2, 1], 'F2 (11,4) before F1 (12,4): bottom first');
  assert.deepEqual(a.egirRevives(), [1, 2]);
  // the third slot: the first member knocked out in the fight — B5, never eaten; then none (B3), and F1's second knock-out
  assert.deepEqual([15, 13, 1].map(a.kill), [true, false, false], 'B5 takes the last slot; B3 and F1 (a second knock-out) stay down');
  checkInvariants(a.h.b);
  // 不屈 at p = 1 (0.18 + 0.004 × 300): it rolls on each devour knock-out (a 被击倒 like any other) and redeploys F1 and F2 at
  // once; awake at the scan, they take no slot — all 3 are left for the fight, where 阿戈尔 (death priority 11) comes first.
  // Until 0.2.0 the 阿戈尔 revive answered both knock-outs at once (2 slots) and 不屈 never rolled.
  const b = run({ indomShip: bondOn(2, 300, 1, [2, 3]) });
  assert.ok(b.by(1).alive && b.by(2).alive, 'F1 and F2 stand again');
  assert.equal(b.h.eventsOf('fx').filter((x) => x[1] === 'revive' && x[4]?.src === 'bond:indomShip').length, 2, 'by 不屈');
  assert.deepEqual(b.egirRevives(), [], 'no 阿戈尔 slot at the battle start');
  assert.deepEqual([15, 13, 14].map(b.kill), [true, true, true]);
  assert.deepEqual(b.egirRevives(), [1, 2, 3], 'the 3 slots, in the fight');
  checkInvariants(b.h.b);
});

// ---------------------------------------------------------------------------------------------------------------------
// 叙拉古

test('叙拉古: after each deployment ASPD +(25+0.8L) for 32+0.4L s; 3 members: no stealth', () => {
  const list = [['r0_a', ['siracusaShip']], ['r1_a', ['siracusaShip']], ['r2_a', ['siracusaShip']], ['none_a', ['preciShip']]];
  const L = 10;
  const h = makeBattle({ defs: defsOf(list), units: lineup(list.map((x) => x[0])), bonds: { siracusaShip: bondOn(3, L, null, [3, 6]) } });
  h.step(1);
  const a = h.unit('r0_a');
  assert.equal(a.s.aspd, 100 + 25 + 0.8 * L);
  assert.equal(h.unit('none_a').s.aspd, 100);
  assert.ok(!a.s.flags.stealth);
  h.run(32 + 0.4 * L - h.b.time - 0.1);
  assert.equal(a.s.aspd, 100 + 25 + 0.8 * L);
  h.run(0.3);
  assert.equal(a.s.aspd, 100);
  // redeploy → again
  h.b.retreat(a);
  a.respawnAt = 0;
  h.b.redeploy(a);
  assert.equal(a.s.aspd, 100 + 25 + 0.8 * L);
  checkInvariants(h.b);
});

test('叙拉古 6: 隐匿 for the same time; attacks while hidden / ≤ 10 s after proc (PRD) 5000+50L true damage + fear 3 s', () => {
  close(prdConstant(0.03), 0.00139, 2e-5);
  const list = [];
  for (let i = 0; i < 6; i++) list.push([`r${i}_a`, ['siracusaShip']]);
  const L = 20;
  const h = makeBattle({
    defs: defsOf(list), units: lineup(list.map((x) => x[0])), enemies: [{ key: 'e_dummy', pos: [12, 9] }],
    bonds: { siracusaShip: bondOn(6, L, null, [3, 6]) }, autoFinish: false, timeLimit: 300, hooks: ['damaged', 'statusApplied'], captureNoisy: true,
  });
  h.step(1);
  const a = h.unit('r0_a');
  const e = h.enemies()[0];
  assert.ok(a.s.flags.stealth, 'stealthed after deploy');
  const attackN = (n) => { for (let i = 0; i < n; i++) h.b.dealDamage(a, e, { amount: 1, type: 'phys', isAttack: true }); };
  attackN(750);                                              // PRD guarantees a proc within ⌈1/C⌉ attempts
  const procs = tagged(h, 'bond:siracusa');
  assert.ok(procs.length >= 1 && procs.length < 60, `procs ${procs.length}`);
  for (const p of procs) close(p.amount, 5000 + 50 * L);
  assert.ok(h.hooksOf('statusApplied').some((c) => c.status === 'fear' && c.target === e && Math.abs(c.duration - 3) < 1e-9));
  const dur = 32 + 0.4 * L;
  h.run(dur + 5 - h.b.time);
  assert.ok(!a.s.flags.stealth, 'stealth over');
  const before = tagged(h, 'bond:siracusa').length;
  attackN(750);
  assert.ok(tagged(h, 'bond:siracusa').length > before, 'still procs within 10 s after stealth');
  h.run(6);
  const after = tagged(h, 'bond:siracusa').length;
  attackN(750);
  assert.equal(tagged(h, 'bond:siracusa').length, after, 'no proc after the 10 s window');
  checkInvariants(h.b);
});

// ---------------------------------------------------------------------------------------------------------------------
// 卡西米尔

test('卡西米尔: every own deployment (initial included) → members ATK +20 %, capped at 50+1×L %', () => {
  const list = [['z0_a', ['kazimierzShip']], ['z1_a', ['kazimierzShip']], ['z2_a', ['kazimierzShip']], ['none_a', ['preciShip']], ['none2_a', ['preciShip']]];
  for (const [L, expect] of [[20, 0.7], [100, 1.0]]) {
    const h = makeBattle({ defs: defsOf(list), units: lineup(list.map((x) => x[0])), bonds: { kazimierzShip: bondOn(3, L, null, [3, 6]) } });
    h.step(1);
    close(h.unit('z0_a').s.atk, 1000 * (1 + expect), 1e-6, `L=${L}`);
    close(h.unit('none_a').s.atk, 1000);
    if (L === 100) {
      const x = h.unit('none_a');
      h.b.retreat(x);
      h.b.redeploy(x);
      close(h.unit('z1_a').s.atk, 1000 * 2.2, 1e-6, 'a redeploy adds +20 %');
    }
    checkInvariants(h.b);
  }
});

test('卡西米尔 6: blocking members pulse 120 % ATK true damage + 0.1 s stun every 2 s; non-blocking attacks add 30 % ATK true', () => {
  const list = [];
  for (let i = 0; i < 6; i++) list.push([`z${i}_a`, ['kazimierzShip']]);
  const walker = enemyRec({ key: 'e_walk', hp: 1e8, speed: 1, atk: 0 });
  const defs = defsOf(list);
  defs.enemies.e_walk = walker;
  // z0 on the walking lane (row 9); the others on row 12 behind the lane's end
  const units = list.map(([id], i) => ({ chessId: id, row: i === 0 ? 9 : 12, col: i === 0 ? 5 : 2 + i }));
  const h = makeBattle({
    defs, units, enemies: [{ key: 'e_walk', route: 0 }], bonds: { kazimierzShip: bondOn(6, 0, null, [3, 6]) },
    autoFinish: false, timeLimit: 120, hooks: ['damaged', 'statusApplied'], captureNoisy: true,
  });
  const z0 = h.unit('z0_a'), z1 = h.unit('z1_a');
  assert.ok(h.runUntil(() => z0.blocking.length > 0, 30), 'blocked');
  const t0 = h.b.time;
  h.run(4.1);
  const pulses = tagged(h, 'bond:kazimierz').filter((c) => c.source === z0 && c.dmg.isSplash && c.t >= t0);
  assert.ok(pulses.length >= 1 && pulses.length <= 3, `pulses ${pulses.length}`);
  close(pulses[0].amount, 1.2 * z0.s.atk, 1e-6);
  assert.ok(h.hooksOf('statusApplied').some((c) => c.status === 'stun' && c.source === z0 && Math.abs(c.duration - 0.1) < 1e-9));
  const onHitExtra = tagged(h, 'bond:kazimierz').filter((c) => c.source === z0 && !c.dmg.isSplash && c.t >= t0);
  assert.equal(onHitExtra.length, 0, 'no on-hit true damage while blocking');
  // z1 does not block: its attacks add 30 % ATK true damage
  const e = h.enemies()[0];
  const n0 = tagged(h, 'bond:kazimierz').filter((c) => c.source === z1).length;
  h.b.dealDamage(z1, e, { amount: 100, type: 'phys', isAttack: true });
  const extra = tagged(h, 'bond:kazimierz').filter((c) => c.source === z1);
  assert.equal(extra.length, n0 + 1);
  close(extra[extra.length - 1].amount, 0.3 * z1.s.atk, 1e-6);
  checkInvariants(h.b);
});

// ---------------------------------------------------------------------------------------------------------------------
// cross-cutting

test('inactive core bonds do nothing (layers alone are not enough)', () => {
  const bonds = ['yanShip', 'sargonShip', 'victoriaShip', 'kjeragShip', 'lateranoShip', 'egirShip', 'siracusaShip', 'kazimierzShip'];
  const list = [['all_a', bonds], ['all2_a', bonds]];
  const h = makeBattle({
    defs: defsOf(list), units: [{ chessId: 'all_a', row: 10, col: 3, items: ['test_item_a'] }, { chessId: 'all2_a', row: 10, col: 4 }],
    bonds: Object.fromEntries(bonds.map((b) => [b, { count: 2, active: false, tier: 0, layers: 50 }])),
    hooks: ['damaged'], captureNoisy: true,
  });
  h.step(1);
  const u = h.unit('all_a');
  assert.deepEqual(u.buffs.filter((b) => b.key.startsWith('bond:')).map((b) => b.key), []);
  close(u.s.atk, 1000);
  assert.equal(tagged(h, 'bond:egir:devour').length, 0);
  assert.ok(!reached(h.b, 'p1', 'yanShip', 0));
  checkInvariants(h.b);
});

test('变形同构体 makes the wearer a member; 6-tier thresholds also read the tier index', () => {
  const list = [['y0_a', ['yanShip']], ['y1_a', ['yanShip']], ['x_a', ['preciShip']]];
  const h = makeBattle({
    defs: defsOf(list),
    units: [{ chessId: 'y0_a', row: 10, col: 3 }, { chessId: 'y1_a', row: 10, col: 4 }, { chessId: 'x_a', row: 10, col: 5, items: ['chess_item_6_09_e_a', 'chess_item_3_04_e_a'] }],
    bonds: { yanShip: { active: true, tier: 1, layers: 0 } },
  });
  h.step(1);
  assert.ok(buffOf(h.unit('x_a'), 'bond:yan'), 'granted member');
  assert.ok(reached(h.b, 'p1', 'yanShip', 3) && !reached(h.b, 'p1', 'yanShip', 6));
  checkInvariants(h.b);
});

test('boss field, two players: bonds only touch their owner’s operators; devour layers are disabled there', () => {
  const list = [['g0_a', ['egirShip', 'yanShip']], ['g1_a', ['egirShip', 'yanShip']], ['g2_a', ['egirShip', 'yanShip']], ['fod_a', ['preciShip'], { tier: 3 }]];
  const lineupFor = (pid) => [
    { uid: `${pid}1`, chessId: 'g0_a', row: 10, col: 3 }, { uid: `${pid}2`, chessId: 'g1_a', row: 10, col: 4 },
    { uid: `${pid}3`, chessId: 'g2_a', row: 11, col: 3 }, { uid: `${pid}4`, chessId: 'fod_a', row: 11, col: 4 },
  ];
  const on = { yanShip: bondOn(3, 0), egirShip: bondOn(3, 0, null, [3, 5]) };
  const h = makeBattle({
    kind: 'boss', defs: defsOf(list), hooks: ['damaged', 'layerGain'], captureNoisy: true,
    players: [
      { playerId: 'p1', seat: 0, side: 'L', colOffset: 0, units: lineupFor('p1'), bonds: on, bandId: null, playerEffects: [] },
      { playerId: 'p2', seat: 1, side: 'R', colOffset: 0, units: lineupFor('p2'), bonds: {}, bandId: null, playerEffects: [] },
    ],
  });
  h.step(1);
  const mine = h.unit('p12'), theirs = h.unit('p22');       // g1: devoured by g0, devours nothing itself
  close(mine.s.atk, 1000 * 1.23, 1e-6);
  close(theirs.s.atk, 1000);
  close(h.unit('p23').s.maxHp, 10000);
  const dv = tagged(h, 'bond:egir:devour');
  assert.ok(dv.length >= 1 && dv.every((c) => c.credit.ownerId === 'p1' && c.target.ownerId === 'p1'));
  assert.equal(h.b.getPlayer('p1').bonds.egirShip.layers, 0, 'no IN_BATTLE layers in a boss field');
  assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors));
  checkInvariants(h.b);
});
