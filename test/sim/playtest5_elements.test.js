// test/sim/playtest5_elements.test.js — user playtest #5 report 3 (enemy side): "海嗣敌人元素损伤效率有点低 — check every
// enemy's element damage and element gauge against the official game". Encodes the official numbers (enemy_database /
// PRTS 元素 / 游戏数据基础 / the enemies' PRTS pages / gamedata_const termDescriptionDict) for the gauge pipeline
// (server/sim/attack/element.js) and the enemies' element abilities (content/enemies.js):
//   · 海嗣 enemies take element damage at the full rate (损伤抵抗 0, 1000 / leader 2000) and deal ATK × ratio per hit;
//   · 元素损伤倍率 (elemTakenMul) scales the gauge, 元素脆弱 (elementalTakenMul) the 元素伤害 — never each other;
//   · 损伤抵抗 (epResistance) reduces the gauge, 元素抗性 (epDamageResistance) the 元素伤害 (both with the 5 % floor);
//   · bursts deal 无来源 damage (no damage-dealt multiplier / penetration of the unit that filled the gauge, no content hook
//     sees a source — 深巡's 海怪 ×1.5, 精准狙击镜 — while the credit, the kill and damage sharing keep working);
//   · 麻痹免疫 enemies get no 麻痹 from a 神经 burst;
//   · 淤困 spreads 1000, 灼藤's first attack covers 3×3, 节日爵士乐手 channels on one locked target;
//   · target-side block/dodge (星熊 战术装甲, 拉普兰德 日晷) still negates a 无来源 burst — it has no source condition.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { ELEMENT, ELEMENT_GAUGE_MAX, ELEMENT_GAUGE_MAX_LEADER } from '../../server/sim/constants.js';
import * as enemiesMod from '../../server/sim/content/enemies.js';
import * as bossesMod from '../../server/sim/content/bosses.js';

const E = JSON.parse(fs.readFileSync(new URL('../../data/enemies.json', import.meta.url), 'utf8'));
const approx = (a, b, eps = 1e-6, msg = '') => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg} ${a} ≈ ${b}`);
const WALL = (id, o = {}) => chessRec({ id, profession: 'TANK', stats: { atk: 0, maxHp: 1e7, def: 0, res: o.res ?? 0, blockCnt: 3 }, rangeGrid: [[0, 0]], skill: null });
const NOATK = () => ({ trait: { noAttack: true } });
const CHESS = { t_wall: WALL('t_wall'), t_wall2: WALL('t_wall2'), t_wall3: WALL('t_wall3'), t_wall4: WALL('t_wall4') };
const KITS = { t_wall: NOATK, t_wall2: NOATK, t_wall3: NOATK, t_wall4: NOATK };
/** Real enemies with their content (enemies.js / bosses.js) against inert synthetic walls. */
const arena = (o = {}) => makeBattle({
  content: 'generic', extraContent: [enemiesMod, bossesMod], seed: 7, autoFinish: false, timeLimit: 600,
  defs: { chess: CHESS }, kits: KITS, captureNoisy: true, hooks: ['elementBurst', 'damaged'], ...o,
});
/** Spawn a pinned enemy (speed ×0) at a tile. */
const put = (h, key, pos, mods = {}) => h.spawn(key, { pos, routeIndex: 0, mods: { speedMul: 0, ...mods } });
const elemHits = (h, target, source = null) => h.hooksOf('damaged').filter((c) => c.type === 'element' && c.target === target && (!source || c.source === source));
const dummy = (o = {}) => enemyRec({ key: 'enemy_dummy', hp: 1e6, speed: 0, ...o });
const SEA = Object.values(E).filter((e) => e.tags.includes('seamonster'));

test('海嗣 enemies take element damage at the official rate: 损伤抵抗 0, gauge 1000 (leaders 2000), 元素抗性 0 on the burst', () => {
  assert.ok(SEA.length >= 10, `${SEA.length} 海嗣 enemies in data`);
  for (const rec of SEA) {
    assert.equal(rec.stats.elementRes, 0, `${rec.name}: enemy_database epResistance (损伤抵抗) 0`);
    assert.equal(rec.stats.elementDmgRes, 0, `${rec.name}: epDamageResistance (元素抗性) 0`);
    const h = arena();
    h.step();
    const e = put(h, rec.key, [11, 8]);
    assert.equal(e.gaugeMax, rec.rank === 'BOSS' ? ELEMENT_GAUGE_MAX_LEADER : ELEMENT_GAUGE_MAX, rec.name);
    h.b.dealDamage(null, e, { type: 'element', element: 'burn', amount: 250 });
    approx(e.elem.burn, 250, 1e-9, `${rec.name}: no hidden reduction`);
    if (rec.rank === 'BOSS' || e.bossPool) continue;
    const hp0 = e.hp;
    h.b.dealDamage(null, e, { type: 'element', element: 'burn', amount: e.gaugeMax });
    assert.ok(e.findBuff('burnBurst'), `${rec.name} bursts`);
    approx(hp0 - e.hp, Math.min(hp0, ELEMENT.burn.enemy.elemDamage), 1e-9, `${rec.name}: 7000 元素伤害`);
  }
});

test('海嗣 element attackers deal ATK × the official ratio per hit (PRTS talents), with the round\'s ATK multiplier', () => {
  const cases = [
    ['enemy_1148_dssbr', 'neural', 'epdamage.attack@ep_damage_ratio', [9, 5]],     // 底海滑动者 普通攻击额外造成攻击力15%的神经损伤
    ['enemy_1148_dssbr_2', 'neural', 'epdamage.attack@ep_damage_ratio', [9, 5]],   // 富营养的滑动者 15 %
    ['enemy_2021_syfish', 'erosion', 'EpDamage.attack@ep_damage_ratio', [9, 5]],   // 骨海漂流体 攻击附加相当于攻击力20%的侵蚀损伤
    ['enemy_2025_syufo', 'erosion', 'EpDamage.attack@ep_damage_ratio', [9, 7]],    // 掠海漂移体 普通攻击附加攻击力50%的侵蚀损伤 (ranged 2.6)
    ['enemy_1234_dsubrl', 'neural', 'EpDamage.ep_damage_ratio', [9, 6]],           // 深溟巢涌者 每次输出伤害时，再造成攻击力5%的神经损伤
    ['enemy_1521_dslily', 'neural', 'epdamage.attack@ep_damage_ratio', null],      // 盐风主教昆图斯 攻击力20%的神经损伤
  ];
  for (const [key, el, k, pos] of cases) {
    const h = arena({ units: [{ chessId: 't_wall', row: 9, col: 5 }] });
    h.step();
    const e = pos ? put(h, key, pos, { atkMul: 1.331 }) : h.spawn(key, { pos: [9, 7], routeIndex: 0, mods: { speedMul: 0, atkMul: 1.331 } });
    approx(e.s.atk, E[key].stats.atk * 1.331, 1e-9, `${E[key].name} ATK × round multiplier`);
    const w = h.unit('t_wall');
    assert.ok(h.runUntil(() => elemHits(h, w, e).length > 0, 30), `${E[key].name} hits the wall`);
    const first = elemHits(h, w, e)[0];
    assert.equal(first.dmg.element, el);
    approx(first.amount, e.s.atk * E[key].talents.bb[k], 1e-9, `${E[key].name}: ATK × ${E[key].talents.bb[k]}`);
  }
  // 元核孽生者 (season override: ATK 400, 1.ep_damage_ratio 0.05): once hurt, every second, radius 2.5
  const h = arena({ units: [{ chessId: 't_wall', row: 9, col: 5 }] });
  h.step();
  const e = put(h, 'enemy_1439_dslntf', [9, 7]);
  h.b.dealDamage(null, e, { amount: 1, type: 'true' });
  h.run(3.05);
  const w = h.unit('t_wall');
  const hits = elemHits(h, w, e);
  assert.equal(hits.length, 3, 'one pulse per second');
  approx(hits[0].amount, 400 * 0.05, 1e-9);
});

test('the user\'s case in numbers: blocking a 底海滑动者 (险境 R5, ATK ×0.968) bursts 神经 on the 25th hit — the official rate', () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 9, col: 5 }] });
  h.step();
  const e = put(h, 'enemy_1148_dssbr', [9, 5], { atkMul: 0.968 });
  const w = h.unit('t_wall');
  const per = 280 * 0.968 * 0.15;
  const need = Math.ceil(ELEMENT_GAUGE_MAX / per);
  assert.equal(need, 25);
  assert.ok(h.runUntil(() => h.hooksOf('elementBurst').some((c) => c.target === w), 120), 'the wall bursts');
  assert.equal(elemHits(h, w, e).length, need, `${need} hits of ${per.toFixed(1)}`);
  approx(h.b.time, need * E.enemy_1148_dssbr.stats.bat, 0.2, '≈ 25 attacks × 2 s (game s)');
});

test('元素损伤倍率 (elemTakenMul) scales the gauge only; 元素脆弱 (elementalTakenMul) the 元素伤害 only', () => {
  const h = makeBattle({ defs: { enemies: { enemy_dummy: dummy() } }, enemies: [{ key: 'enemy_dummy', pos: [11, 8] }], content: 'none', autoFinish: false });
  h.step();
  const e = h.enemy('enemy_dummy');
  h.b.applyStatus(e, 'elemFragile', { duration: 60, value: 0.2 });
  approx(e.s.elementalTakenMul, 1.2);
  approx(e.s.elemTakenMul, 1, 1e-9, '元素脆弱 ("受到的元素伤害提升") leaves the gauge alone');
  h.b.dealDamage(null, e, { type: 'element', element: 'burn', amount: 500 });
  approx(e.elem.burn, 500, 1e-9, 'gauge fill not × 元素脆弱');
  const hp0 = e.hp;
  h.b.dealDamage(null, e, { type: 'element', element: 'burn', amount: 500 });
  approx(hp0 - e.hp, ELEMENT.burn.enemy.elemDamage * 1.2, 1e-9, '7000 元素伤害 × 元素脆弱');
  // "受到的元素损伤提高至130%" (淤困) / "…降低12%" (operators' talents): the gauge, not 元素伤害
  const h2 = makeBattle({ defs: { enemies: { enemy_dummy: dummy() } }, enemies: [{ key: 'enemy_dummy', pos: [11, 8] }], content: 'none', autoFinish: false });
  h2.step();
  const e2 = h2.enemy('enemy_dummy');
  h2.b.addBuff(e2, { key: 't:ep', mods: { elemTakenMul: 1.3 } });
  h2.b.dealDamage(null, e2, { type: 'element', element: 'burn', amount: 500 });
  approx(e2.elem.burn, 650);
  const hp1 = e2.hp;
  h2.b.dealDamage(null, e2, { amount: 100, type: 'elemental', element: 'burn' });
  approx(hp1 - e2.hp, 100, 1e-9, '元素伤害 not × 元素损伤倍率');
});

test('损伤抵抗 (epResistance) reduces the gauge; 元素抗性 (epDamageResistance) reduces 元素伤害 — both with the 5 % floor (PRTS 游戏数据基础)', () => {
  const rec = dummy({ key: 'enemy_res' });
  rec.stats.elementRes = 10;
  rec.stats.elementDmgRes = 30;
  const hard = dummy({ key: 'enemy_hard' });
  hard.stats.elementDmgRes = 100;
  // "目标受到元素损伤时也可以使用该公式计算，只需要将 D 值改为目标的损伤抵抗即可": max(0.05A, A(1 − 损伤抵抗 %))
  hard.stats.elementRes = 98;
  const h = makeBattle({ defs: { enemies: { enemy_res: rec, enemy_hard: hard } }, enemies: [{ key: 'enemy_res', pos: [11, 8] }, { key: 'enemy_hard', pos: [10, 8] }], content: 'none', autoFinish: false });
  h.step();
  const e = h.enemy('enemy_res');
  h.b.dealDamage(null, e, { type: 'element', element: 'burn', amount: 500 });
  approx(e.elem.burn, 450, 1e-9, '× (1 − 10 %)');
  const hp0 = e.hp;
  h.b.dealDamage(null, e, { amount: 1000, type: 'elemental' });
  approx(hp0 - e.hp, 700, 1e-9, '元素伤害 × (1 − 30 %)');
  const x = h.enemy('enemy_hard');
  const hp1 = x.hp;
  h.b.dealDamage(null, x, { amount: 1000, type: 'elemental' });
  approx(hp1 - x.hp, 50, 1e-9, 'at least 5 %');
  h.b.dealDamage(null, x, { type: 'element', element: 'burn', amount: 100 });
  approx(x.elem.burn, 5, 1e-9, 'the gauge takes at least 5 % too (损伤抵抗 98 → 5, not 2)');
  // The actual pipeline combines 元素抗性 and 元素脆弱; no predicted damage is fed back into settlement.
  h.b.addBuff(e, { key: 't:frag', mods: { elementalTakenMul: 1.2 } });
  const d = h.b.makeDamage({ amount: 1000, type: 'elemental' });
  const hp2 = e.hp;
  h.b.dealDamage(null, e, d);
  approx(hp2 - e.hp, 1000 * 0.7 * 1.2, 1e-9, '元素抗性 30 and 元素脆弱 20 %');
});

test('element bursts deal 无来源 damage: the filler\'s damage-dealt multipliers and penetration never apply; it keeps the credit', () => {
  const op = chessRec({ id: 't_op', profession: 'CASTER', stats: { atk: 0, maxHp: 1e6, def: 0, res: 50, blockCnt: 0 }, skill: null });
  const h = makeBattle({
    defs: { chess: { t_op: op }, enemies: { enemy_dummy: dummy({ res: 50 }) } }, units: [{ chessId: 't_op', row: 9, col: 5 }],
    enemies: [{ key: 'enemy_dummy', pos: [11, 8] }], content: 'none', autoFinish: false,
  });
  h.step();
  const u = h.unit('t_op'), e = h.enemy('enemy_dummy');
  h.b.addBuff(u, { key: 't:boost', mods: { dmgDealtMul: 2, artsDealtMul: 1.5, resIgnoreFlat: 50 } });
  h.b.addBuff(e, { key: 't:boost', mods: { dmgDealtMul: 2, artsDealtMul: 1.5, resIgnoreFlat: 50 } });
  const hp0 = e.hp;
  h.b.dealDamage(u, e, { type: 'element', element: 'burn', amount: 1000 });
  approx(hp0 - e.hp, ELEMENT.burn.enemy.elemDamage, 1e-9, '7000, not ×2');
  approx(u.stats.dmg, ELEMENT.burn.enemy.elemDamage, 1e-9, 'credited to the operator that filled the gauge');
  const hp1 = u.hp;
  h.b.dealDamage(e, u, { type: 'element', element: 'burn', amount: 1000 });
  approx(hp1 - u.hp, ELEMENT.burn.ally.damage * (1 - (50 - ELEMENT.burn.ally.resDown) / 100), 1e-9, '1200 arts through RES 50 − 20, no penetration, not ×3');
  // apoptosis ticks on enemies too
  h.run(10.1);
  const hp2 = e.hp;
  h.b.dealDamage(u, e, { type: 'element', element: 'apoptosis', amount: 1000 });
  h.run(3.02);
  approx(hp2 - e.hp, 3 * ELEMENT.apoptosis.enemy.elemDps, 1e-9);
});

test('无来源 reaches the content hooks too: `hit` / `damaged` get no source, `credit` and the kill keep the filler (PRTS 伤害分类)', () => {
  const op = chessRec({ id: 't_op', profession: 'CASTER', stats: { atk: 0, maxHp: 1e6, def: 0, res: 0, blockCnt: 0 }, skill: null });
  const h = makeBattle({
    defs: { chess: { t_op: op }, enemies: { enemy_dummy: dummy(), enemy_small: dummy({ key: 'enemy_small', hp: 5000 }) } },
    units: [{ chessId: 't_op', row: 9, col: 5 }], enemies: [{ key: 'enemy_dummy', pos: [11, 8] }, { key: 'enemy_small', pos: [10, 8] }],
    content: 'none', autoFinish: false, hooks: ['hit', 'damaged', 'kill'], captureNoisy: true,
  });
  h.step();
  const u = h.unit('t_op'), e = h.enemy('enemy_dummy'), small = h.enemy('enemy_small');
  // a content hook keyed on the attacker ("攻击…时攻击力提升至150%" style) — it must not see the burst
  h.b.on('hit', (c) => { if (c.source === u && c.target.side === 'enemy') c.dmg.mul *= 1.5; });
  h.b.dealDamage(u, e, { amount: 1000, type: 'true' });
  approx(1e6 - e.hp, 1500, 1e-9, 'the hook works on the operator\'s own damage');
  const hp0 = e.hp;
  h.b.dealDamage(u, e, { type: 'element', element: 'burn', amount: 1000 });
  approx(hp0 - e.hp, ELEMENT.burn.enemy.elemDamage, 1e-9, '7000, not ×1.5');
  const burstHit = h.hooksOf('hit').find((c) => c.dmg.sourceless && c.target === e);
  assert.equal(burstHit.source, null, 'hit: no source');
  assert.equal(burstHit.credit, u, 'hit: credit');
  const burstDmg = h.hooksOf('damaged').find((c) => c.dmg && c.dmg.sourceless && c.target === e);
  assert.equal(burstDmg.source, null, 'damaged: no source');
  assert.equal(burstDmg.credit, u, 'damaged: credit');
  const gauge = h.hooksOf('damaged').find((c) => c.type === 'element' && c.target === e);
  assert.equal(gauge.source, u, 'the 元素损伤 itself keeps its source');
  // "无来源伤害的击杀也能追溯击杀来源"
  h.b.dealDamage(u, small, { type: 'element', element: 'burn', amount: 1000 });
  assert.equal(small.alive, false);
  assert.equal(h.hooksOf('kill').find((c) => c.victim === small)?.killer, u, 'kill credited to the filler');
});

test('the user\'s pairing: a real 深巡 (garrison "攻击海怪敌人时攻击力提升至150%") bursting a real 海嗣 deals 7000, not 10500', () => {
  const h = makeBattle({ units: [{ chessId: 'chess_char_1_04_a', row: 10, col: 3 }], content: 'full', autoFinish: false, timeLimit: 600, seed: 3 });
  h.step();
  const u = h.allies()[0];
  assert.deepEqual(u.def.raw.garrisonIds, ['garrison_18_a']);
  const e = put(h, 'enemy_1439_dslntf', [11, 8]);
  assert.ok(e.def.tags.includes('seamonster'), '元核孽生者 is a 海怪');
  const hp0 = e.hp;
  h.b.dealDamage(u, e, { amount: 100, type: 'true' });
  approx(hp0 - e.hp, 100 * 1.5 * u.s.dmgDealtMul, 1e-9, 'its own damage vs a 海怪: ×1.5');
  const hp1 = e.hp;
  h.b.dealDamage(u, e, { type: 'element', element: 'burn', amount: e.gaugeMax });
  assert.ok(e.findBuff('burnBurst'));
  approx(hp1 - e.hp, ELEMENT.burn.enemy.elemDamage, 1e-9, 'the burst is 无来源: 7000');
});

test('精准狙击镜 (×damage_scale at ≥ 3 tiles) boosts its carrier\'s hits, never the burst it causes', () => {
  const op = chessRec({ id: 't_op', profession: 'SNIPER', stats: { atk: 0, maxHp: 1e6, def: 0, res: 0, blockCnt: 0 }, skill: null });
  const h = makeBattle({
    defs: { chess: { t_op: op }, enemies: { enemy_dummy: dummy() } }, units: [{ chessId: 't_op', row: 10, col: 3, items: ['chess_item_3_02_e_a'] }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 8] }], content: 'full', autoFinish: false, timeLimit: 600,
  });
  h.step();
  const u = h.unit('t_op'), e = h.enemy('enemy_dummy');
  h.b.dealDamage(u, e, { amount: 1000, type: 'true' });
  const boosted = (1e6 - e.hp) / u.s.dmgDealtMul;
  assert.ok(boosted > 1000 + 1e-6, `the scope works at range (${boosted})`);
  const hp0 = e.hp;
  h.b.dealDamage(u, e, { type: 'element', element: 'erosion', amount: 1000 });
  approx(hp0 - e.hp, ELEMENT.erosion.enemy.elemDamage, 1e-9, '5000 侵蚀 burst, not × the scope');
});

test('a 无来源 burst still passes on through content that shares damage: 圣杯 (credited, no source multiplier) and 盲信之誓', () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 12, col: 3 }] });
  h.step();
  const w = h.unit('t_wall');
  h.b.addBuff(w, { key: 't:boost', mods: { dmgDealtMul: 2 } });
  const c = put(h, 'enemy_1430_lrrook', [10, 7]);
  const o = put(h, 'enemy_1439_dslntf', [10, 6]);
  const share = E.enemy_1430_lrrook.talents.bb['takeDmg.damage_scale'];
  const c0 = c.hp, o0 = o.hp;
  h.b.dealDamage(w, o, { type: 'element', element: 'burn', amount: o.gaugeMax });
  const burst = ELEMENT.burn.enemy.elemDamage;
  approx(c0 - c.hp, Math.min(c0, burst * (1 - share)), 1e-9, 'the chalice takes all but 5 % of 7000 (not ×2)');
  approx(o0 - o.hp, Math.min(o0, burst * share), 1e-9);
  approx(w.stats.dmg, (c0 - c.hp) + (o0 - o.hp), 1e-9, 'both parts credited to the filler');
  // 盲信之誓: a spring passes PART_TRANSFER of what it takes to 假想敌：铳 — a burst too
  const hb = arena({ kind: 'boss', sharedBoss: { hp: 1e6, maxHp: 1e6, damage(pid, a) { this.hp = Math.max(0, this.hp - a); } }, units: [{ chessId: 't_wall', row: 12, col: 3 }] });
  hb.step();
  const g = hb.spawn('enemy_9017_achunt_2', { pos: [3, 18], routeIndex: 0, mods: { speedMul: 0 }, tag: 'boss' });
  g.profile.noAttack = true;
  assert.ok(g.bossPool, '铳 on the shared pool');
  const sp = hb.spawn('enemy_9020_actrpc', { pos: [3, 4], routeIndex: 0, mods: { speedMul: 0 }, tag: 'part' });
  // The native count shield blocks elemental HP damage too. Exercise sharing after spending its charges.
  const count = sp.findBuff('boss:springShield').shieldHits;
  for (let i = 0; i < count; i++) hb.b.dealDamage({ target: sp, amount: 1, type: 'true' });
  assert.equal(sp.findBuff('boss:springShield'), null);
  const pool0 = hb.b.sharedBoss.hp, sp0 = sp.hp;
  hb.b.dealDamage(hb.unit('t_wall'), sp, { type: 'element', element: 'burn', amount: sp.gaugeMax });
  assert.ok(sp0 - sp.hp > 0, 'the spring takes the burst');
  approx(pool0 - hb.b.sharedBoss.hp, (sp0 - sp.hp) * bossesMod.PART_TRANSFER, 1e-9, '…and passes its share to 铳');
});

test('凋亡 burst on an enemy: 800 元素伤害 per second, the 50 % 虚弱 drops to 50 % × 剩余时间 ÷ 15 s at each tick (PRTS 元素)', () => {
  const h = makeBattle({ defs: { enemies: { enemy_dummy: dummy({ atk: 1000 }) } }, enemies: [{ key: 'enemy_dummy', pos: [11, 8] }], content: 'none', autoFinish: false });
  h.step();
  const e = h.enemy('enemy_dummy');
  h.b.dealDamage(null, e, { type: 'element', element: 'apoptosis', amount: 1000 });
  approx(e.s.atk, 500, 1e-9, '50 % at once');
  for (const t of [1, 5, 14]) {
    h.run(t - (h.b.time - 1 / 30) + 0.02);
    const left = ELEMENT.apoptosis.enemy.duration - t;
    assert.ok(Math.abs(e.s.atk - 1000 * (1 - 0.5 * left / ELEMENT.apoptosis.enemy.duration)) < 3, `${t} s: ATK ${e.s.atk.toFixed(1)}`);
  }
  approx(1e6 - e.hp, 14 * ELEMENT.apoptosis.enemy.elemDps, 1e-9);
});

test('麻痹免疫 enemies get no 麻痹 from a 神经 burst (PRTS 元素 "若单位不具有麻痹免疫") — still the 6000 元素伤害', () => {
  const imm = dummy({ key: 'enemy_imm', otherImmunities: ['palsy'] });
  const h = makeBattle({ defs: { enemies: { enemy_dummy: dummy(), enemy_imm: imm } }, enemies: [{ key: 'enemy_dummy', pos: [11, 8] }, { key: 'enemy_imm', pos: [10, 8] }], content: 'none', autoFinish: false });
  h.step();
  const a = h.enemy('enemy_dummy'), b = h.enemy('enemy_imm');
  for (const e of [a, b]) h.b.dealDamage(null, e, { type: 'element', element: 'neural', amount: 1000 });
  assert.equal(a.findBuff('palsy')?.stacks, ELEMENT.neural.enemy.palsy);
  assert.equal(b.findBuff('palsy'), null, 'immune');
  approx(1e6 - b.hp, ELEMENT.neural.enemy.elemDamage);
  // a real one: 假想敌：铳 (palsyImmune)
  assert.ok(E.enemy_9017_achunt.stats.otherImmunities.includes('palsy'));
});

test('假想敌：淤困: its host\'s burst deals 1000 of the same element to the allies of the 4 tiles around (PRTS)', () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 10, col: 5 }, { chessId: 't_wall2', row: 11, col: 5 }, { chessId: 't_wall3', row: 10, col: 6 }, { chessId: 't_wall4', row: 11, col: 6 }] });
  h.step();
  put(h, 'enemy_9007_acelem', [10, 5]);
  h.run(0.5);
  const host = h.unit('t_wall');
  assert.ok(host.findBuff('ab:parasite'), 'parasitised');
  h.b.dealDamage(null, host, { type: 'element', element: 'neural', amount: 1000 });
  const spread = (u) => elemHits(h, u).filter((c) => c.dmg.element === 'neural');
  for (const id of ['t_wall2', 't_wall3']) {
    const s = spread(h.unit(id));
    assert.equal(s.length, 1, `${id} (next to the host) takes one spread`);
    approx(s[0].amount, 1000, 1e-9, `${id}: 1000`);
    assert.ok(h.unit(id).findBuff('neuralBurst'), `${id} bursts`);
  }
  assert.equal(spread(h.unit('t_wall4')).length, 0, 'the diagonal tile is not one of the 4');
});

test('灼藤: its first attack burns and hits every other ally of the target\'s 3×3 (x-4), diagonals included', () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 10, col: 5 }, { chessId: 't_wall2', row: 11, col: 6 }, { chessId: 't_wall3', row: 9, col: 5 }, { chessId: 't_wall4', row: 12, col: 5 }] });
  h.step();
  const v = put(h, 'enemy_10067_ftsjc', [10, 5]);
  assert.ok(h.runUntil(() => v.stats.attacks >= 1, 10), 'first attack');
  const atk = elemHits(h, h.unit('t_wall'), v)[0].amount / E.enemy_10067_ftsjc.talents.bb['pow.attack@ep_damage_ratio'];
  for (const id of ['t_wall2', 't_wall3']) {
    const u = h.unit(id);
    approx(elemHits(h, u, v)[0]?.amount ?? 0, atk * 0.25, 1e-6, `${id}: 25 % burn`);
    assert.ok(u.stats.taken > 0, `${id}: 100 % arts splash`);
  }
  assert.equal(elemHits(h, h.unit('t_wall4'), v).length, 0, 'two rows away: outside');
});

test('节日爵士乐手 狂欢式演奏: channels on ONE locked target (20 % arts + 10 % burn every 0.5 s), not on everyone around', () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 10, col: 5 }, { chessId: 't_wall2', row: 10, col: 6 }, { chessId: 't_wall3', row: 11, col: 5 }] });
  h.step();
  const e = put(h, 'enemy_10034_cnvsax', [10, 5]);
  h.run(6);
  const w = h.unit('t_wall');
  const hits = elemHits(h, w, e);
  assert.ok(hits.length >= 4, `the locked target burns (${hits.length})`);
  approx(hits[0].amount, e.s.atk * 0.1, 1e-9);
  for (const id of ['t_wall2', 't_wall3']) assert.equal(elemHits(h, h.unit(id), e).length, 0, `${id} is not the target`);
});

test('节日爵士乐手: channels never overlap (cooldown 10 s < channel 10.6 s) — 21 ticks each, no normal attack while channelling', () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 10, col: 5 }] });
  h.step();
  const e = put(h, 'enemy_10034_cnvsax', [10, 5]);
  const w = h.unit('t_wall');
  const sk = E.enemy_10034_cnvsax.skills.find((x) => x.prefabKey === 'fire');
  const iv = sk.bb.hit_interval, n = Math.floor(sk.bb['enemy_cnvsax[cd].duration'] / iv + 1e-9);
  assert.equal(n, 21, 'floor(10.6 / 0.5)');
  const arts = [], during = [];
  h.b.on('damaged', (c) => {
    if (c.target !== w || c.source !== e) return;
    if (c.type === 'arts') arts.push(h.b.time);
    else if (c.type === 'phys' && e.findBuff('ab:channel')) during.push(h.b.time);
  });
  const skill = e.mem.ab.list.find((a) => a && a.fire && a.cd != null);
  const casts = [];
  for (let i = 0; i < 30 * 30; i++) {
    h.step();
    if ((skill.casts ?? 0) > casts.length) casts.push(h.b.time);
  }
  assert.ok(casts.length >= 2, `cast twice in 30 s (${casts.map((t) => t.toFixed(2))})`);
  for (let i = 1; i < arts.length; i++) assert.ok(arts[i] - arts[i - 1] >= iv - 0.02, `no doubled tick at ${arts[i].toFixed(2)}`);
  for (let i = 0; i + 1 < casts.length; i++) {
    const k = arts.filter((t) => t > casts[i] && t <= casts[i + 1]).length;
    assert.equal(k, n, `cast ${i + 1}: ${n} ticks`);
    assert.ok(casts[i + 1] - casts[i] >= n * iv - 1e-6, 'the next cast waits for the channel');
  }
  assert.deepEqual(during, [], 'no normal attack while a channel runs');
});

test('target-side block/dodge: 星熊 armor and 拉普兰德 S1 can negate source-less bursts', async () => {
  const { getDefaultSource } = await import('../../server/sim/simdata.js');
  const ds = getDefaultSource();
  const altIdx = (id) => ds.rawChess(id).skills.find((s) => !s.isDefault).index;
  const cases = [
    ['chess_char_4_17_a', {}, ['erosion', 'burn']],                                 // 星熊: phys (侵蚀 800) and arts (灼燃 1200)
    ['chess_char_2_16_a', { skillIndex: altIdx('chess_char_2_16_a'), carryState: { sp: 999 } }, ['erosion']], // 日晷: phys only
  ];
  for (const [id, extra, elements] of cases) {
    for (const roll of [true, false]) {
      for (const element of elements) {
        const h = makeBattle({
          units: [{ chessId: id, row: 9, col: 5, ...extra }], defs: { enemies: { enemy_dummy: dummy() } },
          enemies: [{ key: 'enemy_dummy', pos: [9, 5] }], content: 'full', autoFinish: false, timeLimit: 600, seed: 3, // blocked: in range
          setup: (b) => { b.rng.chance = () => roll; },
        });
        h.step();
        const u = h.unit(id), e = h.enemy('enemy_dummy');
        if (extra.skillIndex != null) assert.ok(h.runUntil(() => u.skill.active, 3), `${id}: 日晷 on`);
        // Both native block/dodge effects draw from rng(), independent of credit.
        h.b.rng = Object.assign(() => roll ? 0 : 0.999999, h.b.rng);
        const hp0 = u.hp;
        h.b.dealDamage(e, u, { type: 'element', element, amount: u.gaugeMax });
        assert.ok(u.findBuff(`${element}Burst`), `${id} ${element}: bursts`);
        if (roll) assert.equal(u.hp, hp0, `${id} ${element}: the burst is 抵挡-ed`);
        else assert.ok(u.hp < hp0, `${id} ${element}: a failed roll lands`);
        assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0]));
      }
    }
  }
});

test('卢西恩 / 不祥幻影 in their only stage (boss_5 = act2autochess_h07_05 / _s): the level\'s overrides — ATK 700 (solo 600) / 200, 12 % 神经 per hit', () => {
  const W = JSON.parse(fs.readFileSync(new URL('../../data/waves.json', import.meta.url), 'utf8'));
  // level_act2autochess_h07_05(_s).json enemyDbRefs[5] / [7] overwrittenData: atk 700 (600) / 200,
  // combat.attack@ep_damage_ratio 0.12
  for (const [tpl, key, atk] of [['act2autochess_h07_05', 'enemy_2016_csphtm', 700], ['act2autochess_h07_05_s', 'enemy_2016_csphtm', 600], ['act2autochess_h07_05', 'enemy_2017_csphts', 200]]) {
    const h = arena({
      kind: 'boss', sharedBoss: { hp: 1e7, maxHp: 1e7, damage(pid, a) { this.hp = Math.max(0, this.hp - a); } },
      units: [{ chessId: 't_wall', row: 10, col: 5 }], setup(b) { b.enemyOverrides = W[tpl].overrides; },
    });
    h.step();
    const w = h.unit('t_wall');
    // blocked on the wall's tile: its first normal attack lands before the 5 s initial cooldown of its aoe skill (0.2)
    const e = h.spawn(key, { pos: [w.y, w.x].map(Math.round), routeIndex: 0, mods: { speedMul: 0 }, tag: key === 'enemy_2016_csphtm' ? 'boss' : undefined });
    assert.equal(e.s.atk, atk, `${tpl} ${E[key].name}: ATK`);
    assert.ok(h.runUntil(() => elemHits(h, w, e).length > 0, 4.5), `${E[key].name} hits`);
    const first = elemHits(h, w, e)[0];
    assert.equal(first.dmg.element, 'neural');
    approx(first.amount, atk * 0.12, 1e-9, `${tpl} ${E[key].name}: ATK × 0.12 (base data: ${E[key].stats.atk} × ${E[key].talents.bb['combat.attack@ep_damage_ratio']})`);
  }
});
