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
  assert.deepEqual(devours.map((c) => [c.source.defId, c.target.defId]), [['g1_a', 'g2_a'], ['g1_a', 'fod_a'], ['g2_a', 'fod_a']]);
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

test('阿戈尔 devour: 物理流失 ignores the marker’s damage bonuses and the target’s shields; a dead marker’s marks are cancelled; kill → marker', () => {
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
  assert.deepEqual(dv.map((c) => [c.source.defId, c.target.defId]), [['g1_a', 'g2_a'], ['g1_a', 'fod_a']], 'g2’s own mark on the fodder is cancelled');
  close(f.hp, 20000 - (5000 - 500), 1e-6, '5000 less its DEF 500: no ×1.25, shield untouched');
  assert.equal(f.buffs.find((b) => b.key === 'test:shield')?.shield, 3000);
  close(g1.s.atk, 1000 + 1000 + 1000, 1e-6, 'the base ATK of everything it marked stays');
  assert.equal(h.b.getPlayer('p1').bonds.egirShip.layers, 1 + 2, 'layers = tiers of the devoured units');
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
  assert.deepEqual(tagged(h, 'bond:egir:devour').map((c) => c.source.uid), ['right', 'high', 'low'], 'col 2 first, then row 12 before row 9');
  checkInvariants(h.b);
});

test('阿戈尔 5: the first 3 members by position (left column first, top first) revive at once on their first knock-out, whatever the order of knock-outs; the others never; a second knock-out is final', () => {
  const list = [];
  for (let i = 0; i < 5; i++) list.push([`g${i}_a`, ['egirShip'], { skill: { spCost: 30, initSp: 5, duration: 10 } }]);
  // one per row pair so nobody devours anybody: col 3 rows 9–12 (g0 bottom … g3 top), g4 at (9,5). PRTS 盟约记录 阿戈尔
  // "前3名【阿戈尔】干员首次被击倒时立刻复活", the first 3 being the first deployed — "更靠左和靠上": g3, g2, g1
  const units = list.map(([id], i) => ({ chessId: id, row: 9 + (i % 4), col: 3 + 2 * Math.floor(i / 4) }));
  const h = makeBattle({ defs: defsOf(list), units, bonds: { egirShip: bondOn(5, 0, null, [3, 5]) }, hooks: ['death', 'deploy'] });
  h.step(1);
  const us = list.map(([id]) => h.unit(id));
  const kill = (u) => h.b.dealDamage(null, u, { amount: 1e9, type: 'true' });
  const redeploys = (u) => h.hooksOf('deploy').filter((c) => c.unit === u && !c.initial).length;
  // knocked out first, yet no beneficiary: g0 (bottom of the first column) and g4 (second column) stay down
  for (const u of [us[0], us[4]]) {
    kill(u);
    assert.ok(!u.alive, `${u.defId} is not among the first 3 by position: no revive`);
    assert.equal(redeploys(u), 0);
  }
  us[1].skill.gainSp(20, 'test');
  const tiles = us.map((u) => [u.tileR, u.tileC]);
  for (const i of [1, 3, 2]) {
    const u = us[i];
    const before = redeploys(u);
    kill(u);
    assert.ok(u.alive && u.deployed, `member ${i} back on the field`);
    close(u.hp, u.s.maxHp);
    assert.deepEqual([u.tileR, u.tileC], tiles[i], 'same tile');
    assert.ok(h.hooksOf('death').some((c) => c.unit === u && c.reason === 'killed'), 'it was knocked out (被击倒 triggers fire)');
    assert.equal(redeploys(u), before + 1, `member ${i} redeployed`);
  }
  assert.equal(us[1].skill.sp, 5, 'a redeploy restarts from the initial SP');
  kill(us[1]);
  assert.ok(!us[1].alive, 'second knock-out is final');
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

test('阿戈尔 5 + the devour chain (GitHub #33): the devour knocks out the food, only the members among the first 3 by position come back; the others keep theirs for the fight (normal and 联防)', () => {
  // one row, all facing right: 浊心斯卡蒂 → 乌尔比安 → 幽灵鲨 → 海霓 → 深巡 → 隐现. PRTS 盟约记录 阿戈尔 备注 "标记按付与顺序触发
  // 【吞噬】效果，目标首次被击倒后解除自身被付与但还未触发的【吞噬】效果". The 3 revives belong to the first 3 by position
  // (浊心斯卡蒂, 乌尔比安, 幽灵鲨 — community reports 「阿戈尔盟约复活有bug，只能复活一个干员」); until 0.1.3 the first 3
  // knocked out took them, so the food (幽灵鲨, 海霓, 深巡) spent all 3 at t = 0 and nobody came back in the fight
  const ids = ['chess_char_6_04_a', 'chess_char_5_05_a', 'chess_char_2_07_a', 'chess_char_3_09_a', 'chess_char_1_04_a', 'chess_char_1_01_a'];
  for (const kind of ['normal', 'unite']) {
    const h = makeBattle({
      kind, units: ids.map((chessId, i) => ({ chessId, row: 10, col: 2 + i })), bonds: { egirShip: bondOn(5, 0, null, [3, 5]) },
      hooks: ['damaged', 'death', 'deploy'], captureNoisy: true, autoFinish: false, timeLimit: 60,
    });
    h.step(1);
    const [skadi, ulpia, ghost, hn, deep, fodder] = ids.map((id) => h.unit(id));
    // 浊心斯卡蒂 marks the whole row and resolves first; every later mark is on a unit already knocked out (乌尔比安's), or
    // comes from one (幽灵鲨's, 海霓's, 深巡's)
    assert.deepEqual(tagged(h, 'bond:egir:devour').map((c) => [c.source.defId, c.target.defId]),
      [ulpia, ghost, hn, deep, fodder].map((t) => [skadi.defId, t.defId]), kind);
    const revived = (u) => h.hooksOf('deploy').filter((c) => c.unit === u && !c.initial).length;
    for (const u of [ghost, hn, deep]) {
      assert.equal(h.hooksOf('death').filter((c) => c.unit === u && c.reason === 'killed').length, 1, `${kind}: ${u.defId} knocked out once`);
    }
    assert.equal(revived(ghost), 1, `${kind}: 幽灵鲨 (third by position) revived at once`);
    assert.equal(revived(hn) + revived(deep), 0, `${kind}: 海霓 and 深巡 (fourth, fifth) not revived`);
    h.run(3);
    for (const u of [skadi, ulpia, ghost]) assert.ok(u.alive && u.deployed && u.hp > 0, `${kind}: ${u.defId} standing`);
    for (const u of [hn, deep, fodder]) assert.ok(!u.alive, `${kind}: ${u.defId} down`);
    // 浊心斯卡蒂 and 乌尔比安 still hold theirs: their first knock-out in the fight is revived, 幽灵鲨's second is final
    for (const u of [skadi, ulpia]) {
      h.b.dealDamage(null, u, { amount: 1e9, type: 'true' });
      assert.ok(u.alive && revived(u) === 1, `${kind}: ${u.defId} revived in the fight`);
    }
    h.b.dealDamage(null, ghost, { amount: 1e9, type: 'true' });
    assert.ok(!ghost.alive, `${kind}: 幽灵鲨 has no revive left`);
    checkInvariants(h.b);
  }
});

test('阿戈尔 5 beneficiaries: fixed at battle start — a 联防 member entering down keeps the slot, a 调和 member is one, the mirrored boss side counts from its own left', () => {
  const list = [['g0_a', ['egirShip']], ['g1_a', ['egirShip']], ['g2_a', ['egirShip']], ['g3_a', ['egirShip']], ['g4_a', ['egirShip']], ['mani_a', ['maniShip']]];
  // five members in five columns (one per column, nobody in front of anybody): g0 col 3 … g4 col 7
  const units = list.slice(0, 5).map(([chessId], i) => ({ chessId, row: 9 + (i % 2) * 3, col: 3 + i }));
  const revives = (h, id) => {
    const u = h.unit(id);
    h.b.dealDamage(null, u, { amount: 1e9, type: 'true' });
    return u.alive;
  };
  // 联防: g0 entered down (forced out before battleStart). The slots stay the first 3 by position — g0, g1, g2.
  // The forced exit is not a 击倒, so g0's charge waits until they stand back up. g3 is not promoted into it.
  const hu = makeBattle({
    kind: 'unite', defs: defsOf(list), autoFinish: false, timeLimit: 60, bonds: { egirShip: bondOn(5, 0, null, [3, 5]) },
    units: units.map((u, i) => (i === 0 ? { ...u, carryState: { down: true } } : u)),
  });
  hu.step(1);
  const g0 = hu.unit('g0_a');
  assert.ok(!g0.alive, 'g0 forced out');
  assert.deepEqual(['g4_a', 'g3_a', 'g1_a', 'g2_a'].map((id) => revives(hu, id)), [false, false, true, true]);
  assert.ok(hu.runUntil(() => g0.alive && g0.deployed, 25), 'g0 stands back up inside the redeploy time');
  assert.equal(revives(hu, 'g0_a'), true, 'g0 still held the first slot');
  hu.b.dealDamage(null, g0, { amount: 1e9, type: 'true' });
  assert.ok(!g0.alive, 'g0 has no second revive');
  checkInvariants(hu.b);
  // 调和 (an active 调和 member enjoys the core bonds) in the first column: one of the 3
  const hm = makeBattle({
    defs: defsOf(list), autoFinish: false, timeLimit: 60,
    units: [{ chessId: 'mani_a', row: 11, col: 2 }, ...units.slice(0, 4)],
    bonds: { egirShip: bondOn(5, 0, null, [3, 5]), maniShip: { count: 1, active: true, tier: 1, layers: 0 } },
  });
  hm.step(1);
  assert.deepEqual(['g2_a', 'mani_a', 'g0_a', 'g1_a'].map((id) => revives(hm, id)), [false, true, true, true]);
  // the right-hand boss player (mirrored): its board's left is the field's right — board cols 3, 4, 5 = field cols 17,
  // 16, 15 hold the revives (read in field columns from the left they would go to g4, g3, g2)
  const hb = makeBattle({
    kind: 'boss', defs: defsOf(list), autoFinish: false, timeLimit: 60,
    players: [{ playerId: 'R1', side: 'R', colOffset: 8, units: units.map((u, i) => ({ ...u, uid: i + 1 })), bonds: { egirShip: bondOn(5, 0, null, [3, 5]) } }],
  });
  hb.step(1);
  assert.deepEqual(['g4_a', 'g3_a', 'g0_a', 'g1_a', 'g2_a'].map((id) => [hb.unit(id).tileC, revives(hb, id)]),
    [[13, false], [14, false], [17, true], [16, true], [15, true]]);
  checkInvariants(hb.b);
});

test('阿戈尔 5: a beneficiary 埃芒加德 or M3茧甲 save in place has used its 阿戈尔 revive [ASSUMED]; the others keep theirs', () => {
  const list = [['g0_a', ['egirShip']], ['g1_a', ['egirShip']], ['g2_a', ['egirShip']], ['g3_a', ['egirShip']], ['g4_a', ['egirShip']]];
  const units = (it = {}) => list.map(([chessId], i) => ({ chessId, row: 9 + (i % 2) * 3, col: 3 + i, items: it[i] }));
  const kill = (h, id) => { const u = h.unit(id); h.b.dealDamage(null, u, { amount: 1e9, type: 'true' }); return u; };
  for (const how of ['band', 'item']) {
    const h = makeBattle({
      defs: defsOf(list), autoFinish: false, timeLimit: 60, hooks: ['death', 'deploy'],
      units: units(how === 'item' ? { 0: ['chess_item_4_12_e_a'] } : {}), ...(how === 'band' ? { bandId: 'band_ermengard' } : {}),
      bonds: { egirShip: bondOn(5, 0, null, [3, 5]) },
    });
    h.step(1);
    // g0, g1, g2 (columns 3–5) hold the 阿戈尔 revives; g0 is saved in place first
    const g0 = kill(h, 'g0_a');
    assert.ok(g0.alive && h.hooksOf('death').filter((c) => c.unit === g0).length === 0, `${how}: saved in place (no knock-out)`);
    // 埃芒加德 saves the battle's first 3 knock-downs: its other 2 go to g3 and g4 (no 阿戈尔 beneficiaries)
    if (how === 'band') for (const id of ['g3_a', 'g4_a']) assert.ok(kill(h, id).alive, 'band revive');
    kill(h, 'g0_a');
    assert.ok(!g0.alive, `${how}: its 阿戈尔 revive went with the save — its first knock-out is final`);
    assert.equal(h.hooksOf('deploy').filter((c) => c.unit === g0 && !c.initial).length, 0);
    for (const id of ['g1_a', 'g2_a']) {
      const u = kill(h, id);
      assert.ok(u.alive && h.hooksOf('deploy').filter((c) => c.unit === u && !c.initial).length === 1, `${how}: ${id} revived by 阿戈尔`);
    }
    checkInvariants(h.b);
  }
});

test('阿戈尔 devour, a unit back during the pass: a marker revived by the 5-tier revive still gives its marks; a target revived in place (埃芒加德) or redeployed (不屈) takes none', () => {
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
  // only a marker off the field gives no further mark (the rule since 0.1.0): g2, back at once, still devours g3 and the fodder
  assert.deepEqual(tagged(h, 'bond:egir:devour').map((c) => [c.source.defId, c.target.defId]),
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
  // 埃芒加德 (命结之秘: the first 3 knocked-out operators revive in place — a new deployment, items revivedInPlace)
  const e = makeBattle({ defs: defsOf(list2), units: units2, bandId: 'band_ermengard', bonds: { egirShip: bondOn(3, 0, null, [3, 5]) }, hooks: ['damaged'], captureNoisy: true });
  e.step(1);
  const fe = e.unit('fod_a');
  assert.deepEqual(tagged(e, 'bond:egir:devour').map((c) => [c.source.defId, c.target.defId]), [['g1_a', 'g2_a'], ['g1_a', 'fod_a']]);
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
  assert.deepEqual(tagged(u, 'bond:egir:devour').map((c) => [c.source.defId, c.target.defId]), [['g1_a', 'g2_a'], ['g1_a', 'fod_a']]);
  assert.ok(fu.alive && u.hooksOf('deploy').some((c) => c.unit === fu && !c.initial), 'redeployed by 不屈');
  assert.equal(u.hooksOf('death').filter((c) => c.unit === fu && c.reason === 'killed').length, 1, 'knocked out once');
  checkInvariants(u.b);
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
  assert.ok(dv.length >= 1 && dv.every((c) => c.source.ownerId === 'p1' && c.target.ownerId === 'p1'));
  assert.equal(h.b.getPlayer('p1').bonds.egirShip.layers, 0, 'no IN_BATTLE layers in a boss field');
  assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors));
  checkInvariants(h.b);
});
