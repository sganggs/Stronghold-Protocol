// Equipment (56 EQUIP, normal + golden) and the 3 Arts: battle side (server/sim/content/items/battle.js) with synthetic
// operators / enemies for exact numbers, prep side (items/meta.js + the engine built-ins it keeps) through the real
// registry and dispatcher. Numbers are the data blackboards (research 04 §3–§7); every item key is covered (last test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { makeMatch, give, giveItem, DATA, legalTileFor } from '../match/harness.js';
import { createRegistry } from '../../server/match/effectsMeta.js';
import { lendItemEffects, itemGrants, PRIO_REVIVE } from '../../server/sim/content/items/battle.js';
import { unitBonds } from '../../server/sim/content/support/index.js';

const QUIET = { warn() {}, error() {}, info() {} };
const REG = createRegistry({ log: QUIET });
const A = (k) => `chess_item_${k}_e_a`;
const B = (k) => `chess_item_${k}_e_b`;
const COVER = new Set();
const cover = (...ids) => { for (const id of ids) { assert.ok(DATA.items[id], id); COVER.add(id); } };
const close = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} ≠ ${b}`);

// ---------------------------------------------------------------------------------------------------------------
// battle helpers

/** Synthetic operator: 2000 HP, 500 ATK, 200 DEF, 10 RES, ASPD 100, 1 s attacks, 20 s redeploy, time SP 1/s. */
function op(id, o = {}) {
  return chessRec({
    id, profession: o.profession ?? 'WARRIOR', bonds: o.bonds ?? [], tier: o.tier ?? 1, golden: !!o.golden,
    rangeGrid: o.range ?? [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]],
    stats: { maxHp: 2000, atk: 500, def: 200, res: 10, aspd: 100, bat: 1, respawnTime: 20, spRecovery: 1, blockCnt: 2, ...(o.stats || {}) },
    skill: { spCost: 60, duration: 5, initSp: 0, ...(o.skill || {}) },
  });
}
const DUMMY = (key = 'e_d', o = {}) => enemyRec({ key, hp: 1e7, speed: 0, ...o });

/**
 * Battle with synthetic ops (`ops`: { id: record }), units (board coords), static dummies at `foes` [[r, c, key?]…].
 */
function fight({ ops = { t_op: op('t_op') }, units, foes = [], enemies = {}, kits, bonds, players, stageId, round, setup } = {}) {
  const defsEnemies = { e_d: DUMMY(), ...enemies };
  return makeBattle({
    defs: { chess: ops, enemies: defsEnemies }, units, players, stageId, round, kits, bonds, setup,
    enemies: foes.map(([r, c, key]) => ({ key: key ?? 'e_d', pos: [r, c] })), timeLimit: 999, autoFinish: false,
  });
}
/** Replace `battle.rng()` by a constant (helpers such as rng.pick keep the seeded stream). */
function forceRng(h, v) { const orig = h.b.rng; h.b.rng = Object.assign(() => v, orig); }
const foe = (h, i = 0) => h.b.enemies.filter((e) => e.alive)[i];
/** True damage `amount` from `src` to `tgt`; returns the HP removed. */
const hitTrue = (h, src, tgt, amount) => h.b.dealDamage(src, tgt, { amount, type: 'true', canDodge: false });

// ---------------------------------------------------------------------------------------------------------------
// stats (直接乘算: each equipment % is its own multiplier)

const STAT_CASES = [
  // [item id, expected stats (partial), note]
  [A('1_01'), { atk: 575 }], [B('1_01'), { atk: 625 }],                                   // 维式重锤 +15 / +25 %
  [A('1_02'), { def: 240 }], [B('1_02'), { def: 270 }],                                   // 坚守盾牌 +20 / +35 %
  [A('1_05'), { atk: 700 }], [B('1_05'), { atk: 800 }],                                   // 源石溶剂 +40 / +60 %
  [A('2_01'), { maxHp: 1400, redeployMul: 0.7 }], [B('2_01'), { maxHp: 1400, redeployMul: 0.5 }], // 不屈弹射器
  [A('2_03'), { atk: 600 }], [B('2_03'), { atk: 675 }],                                   // 战栗维式重锤
  [A('2_04'), { spRecovery: 1.15 }], [B('2_04'), { spRecovery: 1.25 }],                  // 萨尔贡浓茶
  [A('3_01'), { aspd: 115 }], [B('3_01'), { aspd: 125 }],                                 // 叙拉古正装 (self)
  [A('3_03'), { resIgnorePct: 0.25 }], [B('3_03'), { resIgnorePct: 0.45 }],              // 激光发射器
  [A('3_07'), { atk: 700, aspd: 90 }], [B('3_07'), { atk: 800, aspd: 90 }],               // 阿戈尔重刃
  [A('3_08'), { res: 30 }], [B('3_08'), { res: 40 }],                                     // 奥术法阵 +20 / +30
  [A('3_09'), { atk: 625 }], [B('3_09'), { atk: 725 }],                                   // 坚固维式重锤
  [A('3_10'), { atk: 625, aspd: 130 }], [B('3_10'), { atk: 725, aspd: 130 }],             // 加速维式重锤 (+30 special)
  [A('4_02'), { maxHp: 2800, taunt: 1 }], [B('4_02'), { maxHp: 3200, taunt: 1 }],         // 蜂鸣器
  [A('4_09'), { atk: 650 }], [B('4_09'), { atk: 750 }],                                   // 灼燃维式重锤
  [A('5_03'), { atk: 650 }], [B('5_03'), { atk: 750 }],                                   // 双模机械臂
  [A('5_09'), { maxHp: 3000 }], [B('5_09'), { maxHp: 3500 }],                             // 天马之盔
  [A('6_01'), { atk: 700 }], [B('6_01'), { atk: 800 }],                                   // 天马之枪
  [A('6_02'), { atk: 700 }], [B('6_02'), { atk: 800 }],                                   // 铳骑之威
  [A('6_03'), { maxHp: 2900 }], [B('6_03'), { maxHp: 3400 }],                             // 天师古鼎
  [A('6_05'), { aspd: 135 }], [B('6_05'), { aspd: 155 }],                                 // 蒸汽之心
  [A('6_06'), { res: 40 }], [B('6_06'), { res: 60 }],                                     // 耶拉冈德之泪
  [A('6_10'), { redeployMul: 0.6, maxHp: 2000 }], [B('6_10'), { redeployMul: 0.4 }],      // 骑士戒律
  [A('6_11'), { spRecovery: 1.2 }], [B('6_11'), { spRecovery: 1.35 }],                   // 家族徽章
];

test('stat equipment: percentages are 直接乘算 — additive with each other (normal / golden numbers from data)', () => {
  for (const [id, want] of STAT_CASES) {
    const h = fight({ units: [{ chessId: 't_op', row: 10, col: 4, items: [id] }] });
    h.step(1);
    const s = h.unit('t_op').s;
    for (const [k, v] of Object.entries(want)) close(s[k], v, `${id} ${k}`);
    cover(id);
  }
  // two items add up (PRTS 盟约记录 "装备效果提供的属性加成均为直接乘算"; 直接乘算 values are summed, PRTS 游戏数据基础):
  // 维式重锤 +15 % and 阿戈尔重刃 +40 % = +55 %, not ×1.15 × 1.4; a normal + golden copy of one item both apply
  const h = fight({ units: [{ chessId: 't_op', row: 10, col: 4, items: [A('1_01'), A('3_07')] }] });
  h.step(1);
  close(h.unit('t_op').s.atk, 500 * (1 + 0.15 + 0.4), 'stacked');
  const h2 = fight({ units: [{ chessId: 't_op', row: 10, col: 4, items: [A('1_01'), B('1_01')] }] });
  h2.step(1);
  close(h2.unit('t_op').s.atk, 500 * (1 + 0.15 + 0.25), 'normal + golden');
  checkInvariants(h2.b);
});

test('源石溶剂: −60 HP per second on the field (无来源真实伤害, not 流失 — feedback1d-solvent.test.js), ATK +40 %', () => {
  for (const id of [A('1_05'), B('1_05')]) {
    const h = fight({ units: [{ chessId: 't_op', row: 10, col: 4, items: [id] }] });
    h.step(1);
    const u = h.unit('t_op');
    h.run(3.05);
    close(u.hp, 2000 - 3 * 60, id);
  }
});

test('不屈弹射器 / 骑士戒律: redeploy time ×(1 + respawn_time)', () => {
  for (const [id, mul] of [[A('2_01'), 0.7], [B('2_01'), 0.5], [A('6_10'), 0.6], [B('6_10'), 0.4]]) {
    const h = fight({ units: [{ chessId: 't_op', row: 10, col: 4, items: [id] }] });
    h.step(1);
    const u = h.unit('t_op');
    h.b.kill(u);
    close(u.respawnAt - h.b.time, 20 * mul, id);
  }
});

test('叙拉古正装: allies on the two tiles beside the carrier (perpendicular to its facing) ASPD +10 / +15', () => {
  for (const [id, self, side] of [[A('3_01'), 115, 110], [B('3_01'), 125, 115]]) {
    const ops = { t_op: op('t_op'), t_a: op('t_a'), t_b: op('t_b'), t_c: op('t_c') };
    const h = fight({ ops, units: [
      { chessId: 't_op', row: 10, col: 5, items: [id] }, { chessId: 't_a', row: 11, col: 5 }, { chessId: 't_b', row: 9, col: 5 }, { chessId: 't_c', row: 10, col: 6 },
    ] });
    h.run(1);
    assert.equal(h.unit('t_op').s.aspd, self);
    assert.equal(h.unit('t_a').s.aspd, side, 'above');
    assert.equal(h.unit('t_b').s.aspd, side, 'below');
    assert.equal(h.unit('t_c').s.aspd, 100, 'in front: no');
    cover(id);
  }
});

test('精准狙击镜: damage ×1.3 / ×1.5 against targets ≥ 3 tiles away', () => {
  for (const [id, sc] of [[A('3_02'), 1.3], [B('3_02'), 1.5]]) {
    const h = fight({ units: [{ chessId: 't_op', row: 10, col: 3, items: [id] }], foes: [[10, 6], [10, 5]] });
    h.step(1);
    const u = h.unit('t_op');
    const [far, near] = [h.b.enemies.find((e) => e.x === 6), h.b.enemies.find((e) => e.x === 5)];
    close(hitTrue(h, u, far, 1000), 1000 * sc, `${id} far`);
    close(hitTrue(h, u, near, 1000), 1000, `${id} near`);
    cover(id);
  }
});

test('激光发射器: attacks ignore 25 % / 45 % of the target RES', () => {
  for (const [id, p] of [[A('3_03'), 0.25], [B('3_03'), 0.45]]) {
    const h = fight({ units: [{ chessId: 't_op', row: 10, col: 3, items: [id] }], foes: [[10, 9, 'e_r']], enemies: { e_r: DUMMY('e_r', { res: 50 }) } });
    h.step(1);
    close(h.b.dealDamage(h.unit('t_op'), foe(h), { amount: 1000, type: 'arts', canDodge: false }), 1000 * (1 - 50 * (1 - p) / 100), id);
  }
});

test('炎国短刀: each skill activation ATK +5 % / +8 % (one multiplier), at most 10 stacks per battle', () => {
  for (const [id, per] of [[A('3_04'), 0.05], [B('3_04'), 0.08]]) {
    const h = fight({ units: [{ chessId: 't_op', row: 10, col: 3, items: [id] }] });
    h.step(1);
    const u = h.unit('t_op');
    const cast = (n) => { for (let i = 0; i < n; i++) { u.skill.activate('test', { free: true }); u.skill.end('test'); } };
    cast(3);
    close(u.s.atk, 500 * (1 + per * 3), `${id} ×3`);
    cast(9);
    close(u.s.atk, 500 * (1 + per * 10), `${id} capped`);
    cover(id);
  }
});

test('炎国短刀: timed deployment skill adds one stack per deployment, including carry.skillActive', () => {
  const id = 'chess_char_1_19_a';
  for (const [item, per] of [[A('3_04'), 0.05], [B('3_04'), 0.08]]) {
    const h = makeBattle({ units: [{ chessId: id, row: 10, col: 4, skillIndex: 0, items: [item], carryState: { skillActive: true } }] });
    h.b.start();
    const u = h.unit(id);
    assert.equal(u.skill.activations, 1);
    close(u.s.atk, u.base.atk * (1 + per), 'one deployment stack');
    h.run(u.skill.duration + 1);
    close(u.s.atk, u.base.atk * (1 + per), 'no extra stack on end');
    h.b.retreat(u);
    assert.ok(h.b.redeploy(u, { free: true }));
    assert.equal(u.skill.activations, 2);
    close(u.s.atk, u.base.atk * (1 + per * 2), 'one more on redeployment');
    checkInvariants(h.b);
  }
});

test('迅捷作战粮: on deploy SP +3 / +6, plus as much per other operator sharing a bond', () => {
  for (const [id, each] of [[A('3_05'), 3], [B('3_05'), 6]]) {
    const ops = { t_op: op('t_op', { bonds: ['swiftShip'] }), t_a: op('t_a', { bonds: ['swiftShip'] }), t_b: op('t_b', { bonds: ['yanShip'] }) };
    const h = fight({ ops, units: [{ chessId: 't_op', row: 10, col: 3, items: [id] }, { chessId: 't_a', row: 11, col: 3 }, { chessId: 't_b', row: 12, col: 3 }] });
    h.step(1);
    close(h.unit('t_op').skill.sp, each * 2, id, 0.1); // own + 1 bond-mate (t_b shares nothing); ≤ 1 tick of SP regen
    cover(id);
  }
});

test('歌利亚头盔: HP +25 % / +45 %, and +15 % / +25 % more when nobody stands on the tile in front at deploy', () => {
  for (const [id, base, ex] of [[A('3_06'), 1.25, 1.15], [B('3_06'), 1.45, 1.25]]) {
    const ops = { t_op: op('t_op'), t_f: op('t_f') };
    const free = fight({ ops, units: [{ chessId: 't_op', row: 10, col: 4, items: [id] }] });
    free.step(1);
    close(free.unit('t_op').s.maxHp, 2000 * (base + ex - 1), `${id} free (+25 % and +15 % add up: 直接乘算)`);
    close(free.unit('t_op').hp, 2000 * (base + ex - 1), `${id} deployed at full HP`);
    const blocked = fight({ ops, units: [{ chessId: 't_op', row: 10, col: 4, items: [id] }, { chessId: 't_f', row: 10, col: 5 }] });
    blocked.step(1);
    close(blocked.unit('t_op').s.maxHp, 2000 * base, `${id} front occupied`);
    cover(id);
  }
});

test('奥术法阵: attacks silence the target (失去特殊能力) for 5 s', () => {
  for (const id of [A('3_08'), B('3_08')]) {
    const h = fight({ units: [{ chessId: 't_op', row: 10, col: 4, items: [id] }], foes: [[10, 5]] });
    h.runUntil(() => h.hooksOf('attack').length >= 1, 5);
    const b = foe(h).findBuff('silence');
    assert.ok(b, `${id} silenced`);
    close(b.timeLeft, 5, `${id} duration`, 0.05);
  }
});

test('坚固维式重锤: the first lethal hit leaves the carrier at ≥ 1 HP for 8 s; afterwards it can die', () => {
  for (const id of [A('3_09'), B('3_09')]) {
    const h = fight({ units: [{ chessId: 't_op', row: 10, col: 4, items: [id] }], foes: [[10, 9]] });
    h.step(1);
    const u = h.unit('t_op');
    const src = foe(h);
    hitTrue(h, src, u, 1e6);
    assert.ok(u.alive && u.hp >= 1, 'survives');
    h.run(7.5);
    hitTrue(h, src, u, 1e6);
    assert.ok(u.alive, 'still undying inside 8 s');
    h.run(0.6);
    hitTrue(h, src, u, 1e6);
    assert.equal(u.alive, false, `${id}: dies after the window`);
  }
});

test('突袭手雷: within 10 s / 15 s after each deploy, attacks stun the target for 2 s', () => {
  for (const [id, win] of [[A('3_11'), 10], [B('3_11'), 15]]) {
    const h = fight({ units: [{ chessId: 't_op', row: 10, col: 4, items: [id] }], foes: [[10, 5]] });
    h.runUntil(() => h.hooksOf('attack').length >= 1, 5);
    const st = foe(h).findBuff('stun');
    assert.ok(st, 'stunned');
    close(st.timeLeft, 2, 'stun 2 s', 0.05);
    h.run(win + 2.5 - h.b.time);
    assert.equal(foe(h).findBuff('stun'), null, `${id}: no stun once the window is over`);
    cover(id);
  }
});

test('有限加速器: every attack ASPD +1 / +2 for the battle, at most 60 stacks', () => {
  for (const [id, per] of [[A('4_03'), 1], [B('4_03'), 2]]) {
    const h = fight({ units: [{ chessId: 't_op', row: 10, col: 4, items: [id] }], foes: [[10, 5]] });
    h.run(5);
    const n = h.hooksOf('attack').length;
    assert.ok(n >= 5, 'attacked');
    assert.equal(h.unit('t_op').s.aspd, 100 + per * n, `${id} after ${n}`);
    h.run(60);
    assert.equal(h.unit('t_op').s.aspd, 100 + per * 60, `${id} capped`);
    cover(id);
  }
});

test('伪装服: the first damage taken gives 隐匿 for 15 s / 25 s, once per battle', () => {
  for (const [id, d] of [[A('4_04'), 15], [B('4_04'), 25]]) {
    const h = fight({ units: [{ chessId: 't_op', row: 10, col: 4, items: [id] }], foes: [[10, 9]] });
    h.step(1);
    const u = h.unit('t_op');
    hitTrue(h, foe(h), u, 10);
    assert.ok(u.s.flags.stealth, 'camouflaged');
    h.run(d - 0.2);
    assert.ok(u.s.flags.stealth, 'still camouflaged');
    h.run(0.4);
    assert.ok(!u.s.flags.stealth, 'expired');
    hitTrue(h, foe(h), u, 10);
    assert.ok(!u.s.flags.stealth, `${id}: only the first damage`);
    cover(id);
  }
});

test('防暴盾: while blocking, damage from units it does not block ×0.6 / ×0.3 (blocked sources and sourceless damage unchanged)', () => {
  for (const [id, sc] of [[A('4_05'), 0.6], [B('4_05'), 0.3]]) {
    const h = makeBattle({
      defs: { chess: { t_op: op('t_op') }, enemies: { e_w: enemyRec({ key: 'e_w', hp: 1e7, speed: 4 }), e_d: DUMMY() } },
      units: [{ chessId: 't_op', row: 9, col: 6, items: [id] }], enemies: [{ key: 'e_w', route: 0 }, { key: 'e_d', pos: [11, 9] }],
      timeLimit: 999, autoFinish: false,
    });
    const u = h.unit('t_op');
    assert.ok(h.runUntil(() => u.blocking.length > 0, 20), 'blocks the walker');
    const walker = u.blocking[0];
    const other = h.b.enemies.find((e) => e !== walker);
    close(hitTrue(h, other, u, 100), 100 * sc, `${id} unblocked source`);
    close(hitTrue(h, walker, u, 100), 100, `${id} blocked source`);
    close(hitTrue(h, null, u, 100), 100, `${id} sourceless (regression)`);
    cover(id);
  }
});

test('休眠子裔: each attacked target heals the carrier 2 % / 4 % of its max HP', () => {
  for (const [id, r] of [[A('4_06'), 0.02], [B('4_06'), 0.04]]) {
    const h = fight({ units: [{ chessId: 't_op', row: 10, col: 4, items: [id] }], foes: [[10, 5]] });
    h.step(1);
    const u = h.unit('t_op');
    h.b.loseHp(u, 1000);
    const n0 = h.hooksOf('attack').length;
    h.runUntil(() => h.hooksOf('attack').length > n0, 5);
    const heals = h.eventsOf('heal').filter((e) => e[1] === u.id);
    assert.ok(heals.length >= 1);
    close(heals[0][2], 2000 * r, id, 0.6);
    cover(id);
  }
});

test('卡西米尔竞技旗: damage ×1.35 / ×1.6 for 15 s after deploying, then −0.04 / −0.07 every 0.5 s down to ×1', () => {
  for (const [id, sc, minus] of [[A('4_07'), 1.35, 0.04], [B('4_07'), 1.6, 0.07]]) {
    const h = fight({ units: [{ chessId: 't_op', row: 10, col: 3, items: [id] }], foes: [[10, 9]] });
    h.step(1);
    const u = h.unit('t_op');
    close(hitTrue(h, u, foe(h), 1000), 1000 * sc, `${id} t≈0`);
    h.run(14.5);
    close(hitTrue(h, u, foe(h), 1000), 1000 * sc, `${id} t≈14.5`);
    h.run(16.8 - h.b.time); // 1.8 s past the window: 4 steps of 0.5 s started
    close(hitTrue(h, u, foe(h), 1000), 1000 * (sc - 4 * minus), `${id} t≈16.8`, 1e-3);
    h.run(10);
    close(hitTrue(h, u, foe(h), 1000), 1000, `${id} decayed`);
    cover(id);
  }
});

test('拉特兰桥夹: an ammo skill down to 1 bullet regains ceil(40 % / 60 %) of its ammo (prob), ≤ 3 times per deploy', () => {
  const kits = { t_op: () => ({ skill: { kind: 'ammo', ammo: 10, duration: 0, initSp: 60 } }) };
  for (const [id, add, rngV, shots] of [[A('4_08'), 4, 0, 10 + 3 * 4], [B('4_08'), 6, 0, 10 + 3 * 6], [A('4_08'), 4, 0.99, 10]]) {
    const h = fight({ kits, units: [{ chessId: 't_op', row: 10, col: 4, items: [id] }], foes: [[10, 5]] });
    forceRng(h, rngV);
    const u = h.unit('t_op');
    h.runUntil(() => u.skill.activations >= 1 && !u.skill.active, 60);
    assert.equal(h.hooksOf('ammoUsed').length, shots, `${id} rng ${rngV} (+${add} per proc)`);
    cover(id);
  }
});

test('灼燃维式重锤: arts damage also deals 10 % of it as 灼燃损伤 (physical does not)', () => {
  for (const id of [A('4_09'), B('4_09')]) {
    const h = fight({ units: [{ chessId: 't_op', row: 10, col: 3, items: [id] }], foes: [[10, 9]] });
    h.step(1);
    const u = h.unit('t_op'), e = foe(h);
    h.b.dealDamage(u, e, { amount: 1000, type: 'arts', canDodge: false });
    close(e.elem.burn, 100, `${id} burn`);
    h.b.dealDamage(u, e, { amount: 1000, type: 'phys', canDodge: false });
    close(e.elem.burn, 100, `${id} phys adds nothing`);
  }
});

test('浓缩嗅盐: above 70 % / 40 % HP immune to stun, freeze, sleep, levitate (寒冷 still applies)', () => {
  for (const [id, thr] of [[A('4_10'), 0.7], [B('4_10'), 0.4]]) {
    const h = fight({ units: [{ chessId: 't_op', row: 10, col: 4, items: [id] }] });
    h.step(1);
    const u = h.unit('t_op');
    for (const k of ['stun', 'freeze', 'sleep', 'levitate']) assert.equal(h.b.applyStatus(u, k, { duration: 1 }), false, `${id} ${k}`);
    assert.equal(h.b.applyStatus(u, 'cold', { duration: 1 }), true, `${id}: 寒冷 is not a control state (regression)`);
    assert.equal(h.b.applyStatus(u, 'cold', { duration: 1 }), true);
    assert.equal(u.findBuff('freeze'), null, 'the freeze of a second 寒冷 is cancelled');
    h.b.loseHp(u, 2000 * (1 - thr) + 1);
    assert.equal(h.b.applyStatus(u, 'stun', { duration: 1 }), true, `${id}: at ≤ ${thr} HP the stun lands`);
    cover(id);
  }
});

test('护盾无人机: a heal by the carrier gives the target 1 shield layer (prob), at most 1', () => {
  for (const [id, rngV, want] of [[A('4_11'), 0, 1], [B('4_11'), 0.14, 1], [A('4_11'), 0.11, 0]]) {
    const ops = { t_op: op('t_op'), t_a: op('t_a') };
    const h = fight({ ops, units: [{ chessId: 't_op', row: 10, col: 4, items: [id] }, { chessId: 't_a', row: 11, col: 4 }] });
    h.step(1);
    forceRng(h, rngV);
    const a = h.unit('t_a');
    h.b.loseHp(a, 500);
    h.b.heal(h.unit('t_op'), a, 100);
    h.b.heal(h.unit('t_op'), a, 100);
    const sh = a.findBuff('item:shield_drone');
    assert.equal(sh ? sh.shieldHits : 0, want, `${id} rng ${rngV}`);
    cover(id);
  }
});

test('M3茧甲: knocked down ⇒ revives at once at full HP, 1 / 2 times per battle; a free skill undying never spends it', () => {
  for (const [id, n] of [[A('4_12'), 1], [B('4_12'), 2]]) {
    const h = fight({ units: [{ chessId: 't_op', row: 10, col: 4, items: [id] }], foes: [[10, 9]] });
    h.step(1);
    const u = h.unit('t_op');
    // a skill-style undying (kits use priority ≥ −60) prevents the knock-down first: the revive is kept
    let skillUndying = true;
    h.b.on('fatal', (c) => { if (c.unit === u && skillUndying) c.prevented = true; }, { priority: 10 });
    hitTrue(h, foe(h), u, 1e6);
    assert.ok(u.alive && u.hp < 2, 'kept alive by the skill, no revive');
    skillUndying = false;
    for (let i = 0; i < n; i++) {
      hitTrue(h, foe(h), u, 1e6);
      assert.ok(u.alive, `revive ${i + 1}`);
      close(u.hp, 2000, 'full HP');
    }
    hitTrue(h, foe(h), u, 1e6);
    assert.equal(u.alive, false, `${id}: no revive left`);
    cover(id);
  }
  assert.ok(PRIO_REVIVE < -60, 'revive items run after every kit / talent death saver');
});

test('催泪瓦斯 / 谢拉格不融冰: attacks proc 麻痹 (3 % / 5 %) and 寒冷 1.5 s (12 % / 20 %)', () => {
  for (const [id, rngHit, rngMiss, status] of [
    [A('5_01'), 0.029, 0.031, 'palsy'], [B('5_01'), 0.049, 0.051, 'palsy'],
    [A('5_02'), 0.119, 0.121, 'cold'], [B('5_02'), 0.199, 0.201, 'cold'],
  ]) {
    for (const [v, want] of [[rngHit, true], [rngMiss, false]]) {
      const h = fight({ units: [{ chessId: 't_op', row: 10, col: 4, items: [id] }], foes: [[10, 5]] });
      forceRng(h, v);
      h.runUntil(() => h.hooksOf('attack').length >= 1, 5);
      const b = foe(h).findBuff(status);
      assert.equal(!!b, want, `${id} rng ${v}`);
      if (b && status === 'cold') close(b.timeLeft, 1.5, 'cold 1.5 s', 0.05);
    }
    cover(id);
  }
});

test('双模机械臂: physical / arts damage is dealt as whichever the target resists less (弱点伤害)', () => {
  for (const id of [A('5_03'), B('5_03')]) {
    const h = fight({ units: [{ chessId: 't_op', row: 10, col: 3, items: [id] }], foes: [[10, 8, 'e_def'], [10, 9, 'e_res']],
      enemies: { e_def: DUMMY('e_def', { def: 900 }), e_res: DUMMY('e_res', { res: 90 }) } });
    h.step(1);
    const u = h.unit('t_op');
    const eDef = h.b.enemies.find((e) => e.x === 8), eRes = h.b.enemies.find((e) => e.x === 9);
    close(h.b.dealDamage(u, eDef, { amount: 1000, type: 'phys', canDodge: false }), 1000, `${id} phys → arts vs DEF`);
    close(h.b.dealDamage(u, eRes, { amount: 1000, type: 'arts', canDodge: false }), 1000, `${id} arts → phys vs RES`);
  }
  const plain = fight({ units: [{ chessId: 't_op', row: 10, col: 3 }], foes: [[10, 8, 'e_def']], enemies: { e_def: DUMMY('e_def', { def: 900 }) } });
  plain.step(1);
  close(plain.b.dealDamage(plain.unit('t_op'), foe(plain), { amount: 1000, type: 'phys', canDodge: false }), 100, 'without the arm');
});

test('天马之盔 + 天马之枪 (either quality): regen 8 % max HP / s and +30 % ATK true damage per damage instance', () => {
  for (const [helm, lance] of [[A('5_09'), A('6_01')], [B('5_09'), A('6_01')], [A('5_09'), B('6_01')]]) {
    const h = fight({ units: [{ chessId: 't_op', row: 10, col: 3, items: [helm, lance] }], foes: [[10, 9]] });
    h.step(1);
    const u = h.unit('t_op');
    const e = foe(h);
    const before = e.hp;
    hitTrue(h, u, e, 1000);
    close(before - e.hp, 1000 + 0.3 * u.s.atk, `${helm}+${lance} lance proc`);
    h.b.loseHp(u, 1000);
    const hp0 = u.hp;
    h.run(1.02);
    close(u.hp - hp0, 0.08 * u.s.maxHp, `${helm}+${lance} regen`, 1);
    cover(helm, lance);
  }
  // alone: neither set part does anything beyond its stat
  for (const id of [A('5_09'), A('6_01')]) {
    const h = fight({ units: [{ chessId: 't_op', row: 10, col: 3, items: [id] }], foes: [[10, 9]] });
    h.step(1);
    const u = h.unit('t_op'), e = foe(h);
    const before = e.hp;
    hitTrue(h, u, e, 1000);
    close(before - e.hp, 1000, `${id} alone: no proc`);
    h.b.loseHp(u, 1000);
    const hp0 = u.hp;
    h.run(2.05);
    close(u.hp, hp0, `${id} alone: no regen`);
  }
});

test('铳骑之威 (拉特兰): 35 % per attack an extra bullet of 150 % ATK (300 % with 拉特兰桥夹) at an enemy in range', () => {
  const run = (bonds, items, rngV) => {
    const ops = { t_op: op('t_op', { bonds }) };
    let bullets = [];
    const h = fight({ ops, units: [{ chessId: 't_op', row: 10, col: 4, items }], foes: [[10, 5]],
      setup: (b) => b.on('damaged', (c) => { if (c.dmg.tags && c.dmg.tags.includes('item:gunknight')) bullets.push(c.amount); }) });
    forceRng(h, rngV);
    h.runUntil(() => h.hooksOf('attack').length >= 1, 5);
    return { bullets, atk: h.unit('t_op').s.atk };
  };
  let r = run(['lateranoShip'], [A('6_02')], 0.34);
  assert.deepEqual(r.bullets.map(Math.round), [Math.round(1.5 * r.atk)], 'laterano bullet');
  r = run(['lateranoShip'], [B('6_02'), A('4_08')], 0.34);
  assert.deepEqual(r.bullets.map(Math.round), [Math.round(3 * r.atk)], 'with 拉特兰桥夹');
  r = run(['lateranoShip'], [A('6_02')], 0.36);
  assert.equal(r.bullets.length, 0, 'prob 35 %');
  r = run(['yanShip'], [A('6_02')], 0);
  assert.equal(r.bullets.length, 0, 'not 拉特兰: no bullet');
  cover(A('6_02'), B('6_02'));
});

test('天师古鼎 (炎): battle start ASPD +25 per operator gained this round (max 3)', () => {
  for (const [bonds, gained, aspd] of [[['yanShip'], 2, 150], [['yanShip'], 5, 175], [['yanShip'], 0, 100], [['sargonShip'], 3, 100]]) {
    const players = [{ playerId: 'p1', seat: 0, side: 'L', colOffset: 0, bonds: {}, playerEffects: [],
      units: [{ uid: 1, kind: 'chess', chessId: 't_op', row: 10, col: 4, items: [A('6_03')] }],
      contentInfo: { roundStats: { gainedChess: gained } } }];
    const h = fight({ ops: { t_op: op('t_op', { bonds }) }, players });
    h.step(1);
    assert.equal(h.unit('t_op').s.aspd, aspd, `${bonds} gained ${gained}`);
  }
  cover(A('6_03'), B('6_03'));
});

test('海沟实验体: −180 / −300 per damage instance; (阿戈尔) hit taken ⇒ 50 % ATK arts to the source (0.5 s CD), ×2 with 阿戈尔重刃', () => {
  for (const [id, dr] of [[A('6_04'), 180], [B('6_04'), 300]]) {
    const h = fight({ units: [{ chessId: 't_op', row: 10, col: 3, items: [id] }], foes: [[10, 9]] });
    h.step(1);
    close(hitTrue(h, foe(h), h.unit('t_op'), 1000), 1000 - dr, `${id} flat DR`);
    close(hitTrue(h, foe(h), h.unit('t_op'), 100), 0, `${id} small hits are negated`);
    cover(id);
  }
  const counter = (items) => {
    const h = fight({ ops: { t_op: op('t_op', { bonds: ['egirShip'] }) }, units: [{ chessId: 't_op', row: 10, col: 3, items }], foes: [[10, 9]] });
    h.step(1);
    const u = h.unit('t_op'), e = foe(h);
    const hp0 = e.hp;
    hitTrue(h, e, u, 500);
    const first = hp0 - e.hp;
    hitTrue(h, e, u, 500); // inside the 0.5 s lock
    const second = hp0 - e.hp;
    h.run(0.6);
    hitTrue(h, e, u, 500);
    return { first, second, third: hp0 - e.hp, atk: u.s.atk };
  };
  let c = counter([A('6_04')]);
  close(c.first, 0.5 * c.atk, 'counter');
  close(c.second, c.first, 'CD');
  close(c.third, 2 * c.first, 'after the CD');
  c = counter([A('6_04'), A('3_07')]);
  close(c.first, 2 * 0.5 * c.atk, 'two hits with 阿戈尔重刃');
  const other = fight({ units: [{ chessId: 't_op', row: 10, col: 3, items: [A('6_04')] }], foes: [[10, 9]] });
  other.step(1);
  const e = foe(other), hp0 = e.hp;
  hitTrue(other, e, other.unit('t_op'), 500);
  close(hp0 - e.hp, 0, 'not 阿戈尔: no counter');
});

test('蒸汽之心 (维多利亚): hammers equipped on the field are granted; the carrier\'s own hammer counts twice', () => {
  const vict = { t_op: op('t_op', { bonds: ['victoriaShip'] }), t_a: op('t_a'), t_n: op('t_n') };
  // another operator's 加速维式重锤 ⇒ +30 on the carrier; own 加速 + 蒸汽 ⇒ +60
  let h = fight({ ops: vict, units: [{ chessId: 't_op', row: 10, col: 4, items: [A('6_05')] }, { chessId: 't_a', row: 11, col: 4, items: [A('3_10')] }] });
  h.run(1);
  assert.equal(h.unit('t_op').s.aspd, 100 + 35 + 30, 'field hammer');
  assert.equal(h.unit('t_a').s.aspd, 130, 'the hammer holder keeps its own');
  h = fight({ ops: vict, units: [{ chessId: 't_op', row: 10, col: 4, items: [B('6_05'), A('3_10')] }] });
  h.run(1);
  assert.equal(h.unit('t_op').s.aspd, 100 + 55 + 60, 'own hammer ×2');
  h = fight({ ops: { t_op: op('t_op', { bonds: ['yanShip'] }), t_a: op('t_a') }, units: [{ chessId: 't_op', row: 10, col: 4, items: [A('6_05')] }, { chessId: 't_a', row: 11, col: 4, items: [A('3_10')] }] });
  h.run(1);
  assert.equal(h.unit('t_op').s.aspd, 135, 'not 维多利亚: stat only');
  // 灼燃 ×2 (20 % of arts damage), 坚固 ×2 (16 s) — checked in the first 0.5 s of the battle (regression: the field
  // cache filled before the initial deployment hid the field's hammers until its first 0.5 s refresh)
  h = fight({ ops: vict, units: [{ chessId: 't_op', row: 10, col: 3, items: [A('6_05'), A('4_09')] }], foes: [[10, 9]] });
  h.step(1);
  h.b.dealDamage(h.unit('t_op'), foe(h), { amount: 1000, type: 'arts', canDodge: false });
  close(foe(h).elem.burn, 200, 'burn ×2');
  h = fight({ ops: vict, units: [{ chessId: 't_op', row: 10, col: 3, items: [A('6_05'), A('3_09')] }], foes: [[10, 9]] });
  h.step(1);
  const u = h.unit('t_op');
  hitTrue(h, foe(h), u, 1e6);
  h.run(15.5);
  hitTrue(h, foe(h), u, 1e6);
  assert.ok(u.alive, 'undying 16 s');
  h.run(0.7);
  hitTrue(h, foe(h), u, 1e6);
  assert.equal(u.alive, false);
  // 战栗 ×2: 10 % → 20 % (ground carrier)
  for (const [items, rngV, want] of [[[A('2_03')], 0.15, false], [[A('2_03'), A('6_05')], 0.15, true], [[A('2_03')], 0.05, true]]) {
    h = fight({ ops: vict, units: [{ chessId: 't_op', row: 10, col: 4, items }], foes: [[10, 5]] });
    forceRng(h, rngV);
    h.runUntil(() => h.hooksOf('attack').length >= 1, 5);
    const tr = foe(h).findBuff('tremble');
    assert.equal(!!tr, want, `tremble ${items} rng ${rngV}`);
    if (tr) close(tr.timeLeft, 2, 'tremble 2 s', 0.05);
  }
  cover(A('6_05'), B('6_05'), A('2_03'), B('2_03'), A('3_09'), B('3_09'), A('3_10'), B('3_10'), A('4_09'), B('4_09'));
});

test('耶拉冈德之泪 (谢拉格): cold / frozen enemies in range take 30 % ATK arts per second (100 % with 谢拉格不融冰)', () => {
  const count = (bonds, items) => {
    const ops = { t_op: op('t_op', { bonds }) };
    const h = fight({ ops, units: [{ chessId: 't_op', row: 10, col: 4, items }], foes: [[10, 5], [10, 6]] });
    h.step(1);
    const u = h.unit('t_op');
    const [cold, warm] = h.b.enemies;
    h.b.applyStatus(cold, 'cold', { duration: 100 });
    const procs = [];
    h.b.on('damaged', (c) => { if (c.dmg.tags && c.dmg.tags.includes('item:tears')) procs.push([c.target === cold, c.amount]); });
    h.run(3.05);
    return { procs, atk: u.s.atk };
  };
  let r = count(['kjeragShip'], [A('6_06')]);
  assert.ok(r.procs.length >= 3 && r.procs.every(([isCold]) => isCold), 'only the cold one, once per second');
  close(r.procs[0][1], 0.3 * r.atk, '30 % ATK');
  r = count(['kjeragShip'], [B('6_06'), A('5_02')]);
  close(r.procs[0][1], 1.0 * r.atk, '100 % ATK with 不融冰');
  r = count(['yanShip'], [A('6_06')]);
  assert.equal(r.procs.length, 0, 'not 谢拉格');
  cover(A('6_06'), B('6_06'), A('5_02'), B('5_02'));
});

test('黄沙罗盘: initial SP +30 / +50; (萨尔贡) first skill end +30 SP; + 萨尔贡浓茶 each cast ⇒ every 萨尔贡 operator +3 SP', () => {
  for (const [id, init] of [[A('6_07'), 30], [B('6_07'), 50]]) {
    const h = fight({ units: [{ chessId: 't_op', row: 10, col: 4, items: [id] }] });
    h.step(1);
    close(h.unit('t_op').skill.sp, init, id, 0.1);
  }
  const ops = { t_op: op('t_op', { bonds: ['sargonShip'] }), t_a: op('t_a', { bonds: ['sargonShip'] }), t_b: op('t_b') };
  const h = fight({ ops, units: [{ chessId: 't_op', row: 10, col: 4, items: [A('6_07'), A('2_04')] }, { chessId: 't_a', row: 11, col: 4 }, { chessId: 't_b', row: 12, col: 4 }] });
  h.step(1);
  const u = h.unit('t_op'), a = h.unit('t_a'), b = h.unit('t_b');
  const a0 = a.skill.sp, b0 = b.skill.sp;
  u.skill.activate('test', { free: true });
  close(a.skill.sp - a0, 3, '萨尔贡 ally +3');
  close(b.skill.sp - b0, 0, 'non-萨尔贡 ally +0');
  u.skill.sp = 0;
  u.skill.end('test');
  close(u.skill.sp, 30, 'first skill end +30');
  u.skill.sp = 0;
  u.skill.activate('test', { free: true });
  u.skill.end('test');
  close(u.skill.sp, 3, 'only the first skill end gives 30; this cast still gives its own 3 through the lock');
  cover(A('6_07'), B('6_07'), A('2_04'), B('2_04'));
});

test('骑士戒律 (卡西米尔): 20 s after a skill starts enemies in range ASPD −35 %, move ×0.65; + 竞技旗: ATK ×2 in the skill, no death until it ends', () => {
  const ops = { t_op: op('t_op', { bonds: ['kazimierzShip'] }) };
  let h = fight({ ops, units: [{ chessId: 't_op', row: 10, col: 4, items: [A('6_10')] }], foes: [[10, 6]], enemies: { e_d: DUMMY('e_d', { speed: 1 }) } });
  h.step(1);
  const u = h.unit('t_op');
  u.skill.activate('test', { free: true });
  h.run(1);
  const e = foe(h);
  assert.equal(e.s.aspd, 65, 'enemy ASPD −35 %');
  close(e.s.moveSpeed, 0.65, 'move ×0.65');
  h.run(20);
  assert.equal(e.s.aspd, 100, 'aura over after 20 s');
  const h2 = fight({ ops: { t_op: op('t_op', { bonds: ['yanShip'] }) }, units: [{ chessId: 't_op', row: 10, col: 4, items: [A('6_10')] }], foes: [[10, 6]] });
  h2.step(1);
  h2.unit('t_op').skill.activate('test', { free: true });
  h2.run(1);
  assert.equal(foe(h2).s.aspd, 100, 'not 卡西米尔: no aura');
  // combo with 卡西米尔竞技旗 (either quality)
  h = fight({ ops, units: [{ chessId: 't_op', row: 10, col: 4, items: [B('6_10'), B('4_07')] }], foes: [[10, 9]] });
  h.step(1);
  const k = h.unit('t_op');
  k.skill.activate('test', { free: true });
  close(k.s.atk, 1000, 'ATK +100 % during the skill');
  hitTrue(h, foe(h), k, 1e6);
  assert.ok(k.alive && k.hp >= 1, 'lethal damage does not retreat it');
  h.run(5.2);
  assert.equal(k.alive, false, 'retreats when the skill ends');
  assert.equal(k.removeReason, 'retreat');
  cover(A('6_10'), B('6_10'), A('4_07'), B('4_07'));
});

test('家族徽章 (叙拉古): ATK +2 %/s while 隐匿 (max +100 %) until the first damage after; + 叙拉古正装 ⇒ that hit +800 % ATK true', () => {
  const run = (items) => {
    const h = fight({ ops: { t_op: op('t_op', { bonds: ['siracusaShip'], range: [[0, 0]] }) }, units: [{ chessId: 't_op', row: 10, col: 4, items }], foes: [[10, 9]] });
    h.step(1);
    const u = h.unit('t_op');
    const atk0 = u.s.atk;
    h.b.applyStatus(u, 'stealth', { duration: 10 });
    h.run(10);
    const ramp = u.s.atk / atk0;
    h.run(0.5);
    const e = foe(h);
    const hp0 = e.hp;
    hitTrue(h, u, e, 100);
    return { ramp, dealt: hp0 - e.hp, atkAfter: u.s.atk / atk0, atk0, u };
  };
  let r = run([A('6_11')]);
  close(r.ramp, 1.2, '+2 %/s over 10 s', 0.02);
  close(r.dealt, 100, 'no true damage without 叙拉古正装');
  close(r.atkAfter, 1, 'bonus consumed by the first damage');
  r = run([B('6_11'), A('3_01')]);
  const atkAtHit = r.atk0 * 1.2;
  close(r.dealt, 100 + 8 * atkAtHit, '+800 % ATK true', atkAtHit * 0.2);
  cover(A('6_11'), B('6_11'), A('3_01'), B('3_01'));
});

test('变形同构体: carrier counts as a member of the other item\'s giveBondId bond (battle + prep), never merges', () => {
  const h = fight({ units: [{ chessId: 't_op', row: 10, col: 4, items: [A('6_09'), A('4_08')] }] });
  h.step(1);
  assert.deepEqual([...unitBonds(h.unit('t_op'))], ['lateranoShip']);
  const h2 = fight({ units: [{ chessId: 't_op', row: 10, col: 4, items: [A('4_08')] }] });
  assert.deepEqual([...unitBonds(h2.unit('t_op'))], [], 'the bond item alone grants nothing');
  // every giveBondId item grants its bond (14 bonds)
  const grants = Object.values(DATA.items).filter((r) => r.giveBondId && !r.isGolden);
  assert.equal(grants.length, 18);
  assert.equal(new Set(grants.map((r) => r.giveBondId)).size, 14);
  for (const r of grants) {
    const hh = fight({ units: [{ chessId: 't_op', row: 10, col: 4, items: [r.id, A('6_09')] }] });
    assert.ok(unitBonds(hh.unit('t_op')).includes(r.giveBondId), r.id);
  }
  // prep side: the bond count includes the grant
  const { m, ps } = setup();
  const chess = Object.values(DATA.chess).find((c) => c.visible && !c.isGolden && c.tier === 1 && !c.bonds.includes('victoriaShip')).chessId;
  const piece = give(m, ps, chess, 'board', [10, 5]);
  const before = ps.bonds.victoriaShip ? ps.bonds.victoriaShip.count : 0;
  const iso = giveItem(m, ps, A('6_09'));
  const ham = giveItem(m, ps, A('1_01'));
  assert.deepEqual(m.handle('p_0', { t: 'g.equip', itemUid: iso.uid, targetUid: piece.uid }), { ok: true });
  assert.deepEqual(m.handle('p_0', { t: 'g.equip', itemUid: ham.uid, targetUid: piece.uid }), { ok: true });
  assert.equal(ps.bonds.victoriaShip.count, before + 1);
  assert.equal(DATA.items[A('6_09')].upgradeNum, 100);
  cover(A('6_09'), B('6_09'), A('1_01'));
});

test('lendItemEffects (萨尔贡 × 娜仁图亚): tier ≤ V battle effects lent for 60 s, then removed', () => {
  const ops = { t_op: op('t_op'), t_a: op('t_a') };
  const h = fight({ ops, units: [{ chessId: 't_op', row: 10, col: 4, items: [A('1_01'), A('6_01')] }, { chessId: 't_a', row: 11, col: 4 }] });
  h.step(1);
  const [from, to] = [h.unit('t_op'), h.unit('t_a')];
  assert.equal(lendItemEffects(h.b, from, to, { maxTier: 5, duration: 60 }), 1, 'the VI-tier lance is not lent');
  close(to.s.atk, 575, 'lent hammer');
  assert.deepEqual(itemGrants(h.b, to).map((g) => [g.id, g.lent]), [[A('1_01'), true]]);
  h.run(60.1);
  close(to.s.atk, 500, 'expired');
});

// ---------------------------------------------------------------------------------------------------------------
// prep side

function setup({ mode = 'solo', humans = 1, seed = 41 } = {}) {
  const h = makeMatch({ mode, humans, seed, registry: REG, fake: true }).start();
  h.toPrep(1);
  const m = h.m;
  for (const ps of m.players.values()) {
    for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean), ...ps.temp.filter(Boolean)]) if (p.kind === 'chess') ps.returnCopies(p);
    ps.board.clear(); ps.hand.fill(null); ps.temp.fill(null); ps.offers.length = 0;
    ps.funds = 50; ps.layers = {}; ps.pendingFunds = 0; ps.shop.freeRefreshes = 0;
    ps.bandId = null; // no band prep effects
    ps.recompute();
  }
  const ps = h.ps('p_0');
  const equip = (item, target, pid = 'p_0') => m.handle(pid, { t: 'g.equip', itemUid: item.uid, targetUid: target.uid });
  return { h, m, ps, equip };
}
const handIds = (ps, kind) => [...ps.hand, ...ps.temp].filter((p) => p && (!kind || p.kind === kind)).map((p) => p.id);
/** Visible normal chess whose 特质 are all IN_BATTLE (no prep-side side effects), sorted. */
const plain = (pred = () => true) => Object.values(DATA.chess)
  .filter((c) => c.visible && !c.isGolden && (c.garrisonIds || []).every((g) => DATA.garrisons[g].eventType === 'IN_BATTLE') && pred(c))
  .map((c) => c.chessId).sort();
/** Record the chess granted by item effects (acquireChess with an `item:` source). */
/** The warn toasts sent to the match's players from now on: [{ msgid, who, name }] (server msg() objects). */
function spyWarns(m) {
  const got = [];
  const orig = m.toast.bind(m);
  m.toast = (ps, kind, text) => {
    if (kind === 'warn') got.push({ msgid: text?.msgid ?? text, who: text?.params?.who?.dn ?? null, name: text?.params?.name?.dn ?? null });
    return orig(ps, kind, text);
  };
  return got;
}
function spyGrants(ps) {
  const got = [];
  const orig = ps.acquireChess.bind(ps);
  ps.acquireChess = (id, o = {}) => { const p = orig(id, o); if (p && String(o.source || '').startsWith('item:')) got.push(id); return p; };
  return got;
}
const OK = { ok: true };
/** Pool chess (with a free copy, not banned this match) of tier ≤ maxTier sharing a bond with `cid`. */
const sameBondPool = (m, cid, maxTier) => Object.values(DATA.chess)
  .filter((c) => c.visible && !c.isGolden && c.tier <= maxTier && c.bonds.some((b) => DATA.chess[cid].bonds.includes(b)) && m.pool.has(c.chessId) && m.pool.left(c.chessId) > 0)
  .map((c) => c.chessId);
/** A plain chess of `tier` whose bonds have ≥ `need` pool candidates of tier ≤ maxTier in this match. */
const targetWithCandidates = (m, tier, maxTier, need, skip = 0) => plain((c) => c.tier === tier && c.bonds.length)
  .filter((cid) => sameBondPool(m, cid, maxTier).length >= need)[skip];

test('consume-on-equip items resolve once, are destroyed and never take a slot', () => {
  const consume = Object.values(DATA.items).filter((r) => typeof r.kind === 'string' && r.kind.startsWith('consume_on_equip') && r.id !== A('5_06'));
  assert.equal(consume.length, 23, '11 consume items ×2 + golden 博士投影');
  const { m, ps, equip } = setup({ seed: 11 });
  const pool = plain((c) => c.tier === 1 && c.bonds.length);
  for (const [k, rec] of consume.entries()) {
    ps.hand.fill(null); ps.temp.fill(null); ps.offers.length = 0; ps.funds = 50;
    const t = give(m, ps, pool[k % pool.length], 'hand', 0);
    const it = giveItem(m, ps, rec.id);
    assert.deepEqual(equip(it, t), OK, rec.id);
    assert.ok(!ps.find(it.uid), `${rec.id} destroyed`);
    const holder = ps.find(t.uid);
    assert.ok(!holder || holder.piece.items.length === 0, `${rec.id} takes no slot`);
  }
});

test('盟约之币 +1 / +2, 骑士储蓄罐 1–6 / 2–12 funds (random, both ends reachable)', () => {
  for (const [id, lo, hi] of [[A('1_03'), 1, 1], [B('1_03'), 2, 2], [A('3_12'), 1, 6], [B('3_12'), 2, 12]]) {
    const { m, ps, equip } = setup({ seed: 100 + lo + hi });
    const t = give(m, ps, plain((c) => c.tier === 1)[0], 'hand');
    const seen = new Set();
    for (let k = 0; k < 60; k++) {
      const f0 = ps.funds;
      assert.deepEqual(equip(giveItem(m, ps, id), t), OK);
      const got = ps.funds - f0;
      assert.ok(got >= lo && got <= hi, `${id} ${got}`);
      seen.add(got);
    }
    assert.equal(seen.size, hi - lo + 1, `${id} covers ${lo}..${hi}`);
    cover(id);
  }
});

test('随身身份牌: every bond of the target +3 / +6 layers, active or not', () => {
  for (const [id, n] of [[A('1_04'), 3], [B('1_04'), 6]]) {
    const { m, ps, equip } = setup();
    const cid = plain((c) => c.bonds.length >= 2)[0];
    const t = give(m, ps, cid, 'hand');
    assert.deepEqual(equip(giveItem(m, ps, id), t), OK);
    for (const b of DATA.chess[cid].bonds) assert.equal(ps.layers[b], n, `${id} ${b}`);
    cover(id);
  }
});

test('紧急调度券: takes 1 / 2 random shop operators for free (their slots empty); a slot whose chess cannot be granted stays', () => {
  for (const [id, n] of [[A('2_02'), 1], [B('2_02'), 2]]) {
    const { m, ps, equip } = setup();
    const ids = plain((c) => c.tier === 1).slice(0, 4);
    ps.shop.slots = ids.map((cid) => ({ kind: 'chess', id: cid, basePrice: 2, frozen: false, sold: false }));
    const t = give(m, ps, plain((c) => c.tier === 2)[0], 'hand');
    const got = spyGrants(ps);
    const f0 = ps.funds;
    assert.deepEqual(equip(giveItem(m, ps, id), t), OK);
    assert.equal(ps.funds, f0, 'free');
    assert.equal(got.length, n, `${id} gained ${n}`);
    assert.equal(ps.shop.slots.filter(Boolean).length, 4 - n, 'their slots are empty');
    for (const g of got) assert.ok(ids.includes(g) && !ps.shop.slots.some((s) => s && s.id === g));
    cover(id);
  }
  // regression: a shop chess without a free pool copy is not lost — its slot keeps it and another one is taken
  const { m, ps, equip } = setup({ seed: 5 });
  const [dry, other] = plain((c) => c.tier === 1);
  ps.shop.slots = [dry, other].map((cid) => ({ kind: 'chess', id: cid, basePrice: 2, frozen: false, sold: false }));
  m.pool.take(m.gd.baseIdOf(dry), m.pool.left(m.gd.baseIdOf(dry)));
  const got = spyGrants(ps);
  assert.deepEqual(equip(giveItem(m, ps, A('2_02')), give(m, ps, plain((c) => c.tier === 2)[0], 'hand')), OK);
  assert.deepEqual(got, [other]);
  assert.equal(ps.shop.slots[0] && ps.shop.slots[0].id, dry, 'unavailable chess stays in its slot');
  assert.equal(ps.shop.slots[1], null);
});

test('精打细算玩偶 +1 / +2 funds at every later round start; 见钱眼开玩偶 +2 / +4 next round only', () => {
  for (const [doll, per, cash, once] of [[A('2_05'), 1, A('2_07'), 2], [B('2_05'), 2, B('2_07'), 4]]) {
    const { h, m, ps, equip } = setup();
    const t = give(m, ps, plain((c) => c.tier === 1)[0], 'hand');
    assert.deepEqual(equip(giveItem(m, ps, doll), t), OK);
    assert.deepEqual(equip(giveItem(m, ps, cash), t), OK);
    assert.equal(ps.pendingFunds, once);
    h.toPrep(2);
    assert.equal(ps.funds, m.gd.income(2) + once + per, `R2 ${doll}`);
    h.toPrep(3);
    assert.equal(ps.funds, m.gd.income(3) + per, `R3 ${doll}`);
    cover(doll, cash);
  }
});

test('简易通讯机: 1 / 2 random operators sharing a bond with the target, tier ≤ shop level', () => {
  for (const [id, n] of [[A('2_06'), 1], [B('2_06'), 2]]) {
    for (let k = 0; k < 4; k++) {
      const { m, ps, equip } = setup({ seed: 17 + k });
      ps.shop.level = 2;
      const cid = targetWithCandidates(m, 2, 2, 3, k % 2);
      assert.ok(cid, 'a target with candidates');
      const t = give(m, ps, cid, 'hand');
      const got = spyGrants(ps);
      assert.deepEqual(equip(giveItem(m, ps, id), t), OK);
      assert.equal(got.length, n, `${id}`);
      for (const g of got) {
        const c = DATA.chess[g];
        assert.ok(c.tier <= 2 && !c.isGolden && c.bonds.some((b) => DATA.chess[cid].bonds.includes(b)), `${g} shares a bond, tier ≤ 2`);
      }
    }
    cover(id);
  }
});

test('寻呼模块: a pick-one offer of 3 different same-bond operators (tier ≤ shop level), the pick is free', () => {
  const { m, ps, equip } = setup({ seed: 23 });
  ps.shop.level = 3;
  const cid = targetWithCandidates(m, 1, 3, 4);
  const t = give(m, ps, cid, 'hand');
  assert.deepEqual(equip(giveItem(m, ps, A('4_01')), t), OK);
  const offer = ps.offers[0];
  assert.ok(offer, 'offer');
  const ids = offer.slots.map((s) => s.id);
  assert.equal(ids.length, 3);
  assert.equal(new Set(ids).size, 3, 'distinct');
  for (const id of ids) assert.ok(DATA.chess[id].tier <= 3 && DATA.chess[id].bonds.some((b) => DATA.chess[cid].bonds.includes(b)), id);
  const f0 = ps.funds;
  assert.deepEqual(m.handle('p_0', { t: 'g.reward', idx: 1 }), OK);
  assert.equal(ps.funds, f0);
  assert.ok(handIds(ps, 'chess').includes(ids[1]) || handIds(ps, 'chess').includes(DATA.chess[ids[1]].goldenId));
  assert.equal(DATA.items[A('4_01')].upgradeNum, 100, 'never merges');
  cover(A('4_01'), B('4_01'));
});

test('信标: target and item destroyed, offer of 2 same-tier operators; co-op: the original goes to the teammate with most of its bonds next round', () => {
  const { h, m, equip } = setup({ mode: 'coop', humans: 2, seed: 31 });
  const p0 = h.ps('p_0'), p1 = h.ps('p_1');
  const cid = plain((c) => c.tier === 3 && c.bonds.length)[0];
  const bond = DATA.chess[cid].bonds[0];
  const mate = plain((c) => c.bonds.includes(bond) && c.chessId !== cid)[0];
  give(m, p1, mate, 'hand');
  const t = give(m, p0, cid, 'hand');
  assert.deepEqual(equip(giveItem(m, p0, A('5_04')), t), OK);
  assert.equal(p0.find(t.uid), null, 'target destroyed');
  const offer = p0.offers[0];
  assert.equal(offer.slots.length, 2);
  for (const s of offer.slots) assert.equal(DATA.chess[s.id].tier, 3);
  h.toPrep(2);
  assert.ok([...p1.hand, ...p1.temp, ...p1.board.values()].some((p) => p && m.gd.baseIdOf(p.id) === cid), 'gift arrived');
  cover(A('5_04'), B('5_04'));
});

test('pick-one chess offers never repeat an operator — 信标, 寻呼模块, any offer list (user playtest #6 item 19)', () => {
  let n = 0;
  for (let seed = 1; seed <= 24; seed++) {
    for (const lvl of [1, 3, 6]) {
      // 寻呼模块: same-bond operators up to the shop level — fewer cards when the pool has no other one, never a repeat
      let { m, ps, equip } = setup({ seed });
      ps.shop.level = lvl;
      const pool1 = plain((c) => c.bonds.length && c.tier <= lvl);
      const cid = pool1[seed % pool1.length];
      const t = give(m, ps, cid, 'hand');
      assert.deepEqual(equip(giveItem(m, ps, A('4_01')), t), OK);
      for (const o of ps.offers) { const ids = o.slots.map((x) => x.id); assert.equal(new Set(ids).size, ids.length, `寻呼模块 seed ${seed} lv ${lvl}: ${ids}`); n++; }
      // 信标: operators of the target's tier (topped up from the tier below), never a repeat
      ({ m, ps, equip } = setup({ seed }));
      const pool2 = plain((c) => c.tier === lvl && c.bonds.length);
      const t2 = give(m, ps, pool2[seed % pool2.length], 'hand');
      assert.deepEqual(equip(giveItem(m, ps, A('5_04')), t2), OK);
      for (const o of ps.offers) { const ids = o.slots.map((x) => x.id); assert.equal(new Set(ids).size, ids.length, `信标 seed ${seed} tier ${lvl}: ${ids}`); n++; }
    }
  }
  assert.ok(n >= 100, `offers checked (${n})`);
  // whoever builds the list, the offer drops a repeated operator
  const { ps } = setup({ seed: 5 });
  const [a, b] = plain((c) => c.tier === 2);
  const offer = ps.pushRewardOffer('effect', { ids: [a, a, b, a] });
  assert.deepEqual(offer.slots.map((x) => x.id), [a, b]);
});

test('拟态物质: owning 2 copies gives the 3rd (→ elite); otherwise a random same-bond normal operator', () => {
  let { m, ps, equip } = setup({ seed: 9 });
  const cid = plain((c) => c.tier === 2 && c.bonds.length)[0];
  const t = give(m, ps, cid, 'hand');
  give(m, ps, cid, 'hand');
  assert.deepEqual(equip(giveItem(m, ps, A('5_05')), t), OK);
  assert.ok(handIds(ps, 'chess').includes(DATA.chess[cid].goldenId), 'merged to elite');
  ({ m, ps, equip } = setup({ seed: 9 }));
  const t2 = give(m, ps, cid, 'hand');
  const got = spyGrants(ps);
  assert.deepEqual(equip(giveItem(m, ps, A('5_05')), t2), OK);
  assert.equal(got.length, 1);
  assert.ok(!DATA.chess[got[0]].isGolden && DATA.chess[got[0]].bonds.some((b) => DATA.chess[cid].bonds.includes(b)));
  cover(A('5_05'), B('5_05'));
});

test('拟态物质 with 2 copies owned and none left in the pool gives nothing — never a same-bond operator; with copies left the 3rd still merges (GitHub #207)', () => {
  // the report: an elite 溯光星源 (3 of the Ⅵ阶's 5 copies) and 2 normal ones — the pool is empty, the item text's 否则
  // (a random same-bond operator) is only for fewer than 2 owned
  const cid = 'chess_char_6_16_a';
  const elite = DATA.chess[cid].goldenId;
  const chessIn = (ps) => [...ps.board.values(), ...ps.hand, ...ps.temp].filter((p) => p && p.kind === 'chess').map((p) => p.id).sort();
  for (const item of [A('5_05'), B('5_05')]) {
    const { m, ps, equip } = setup({ seed: 9 });
    give(m, ps, elite, 'hand');
    const t = give(m, ps, cid, 'hand');
    give(m, ps, cid, 'hand');
    assert.equal(m.pool.left(cid), 0, 'elite 3 + 2 normal = the pool cap 5');
    const before = chessIn(ps);
    const got = spyGrants(ps);
    const warns = spyWarns(m);
    const it = giveItem(m, ps, item);
    assert.deepEqual(equip(it, t), OK, item);
    assert.deepEqual(got, [], `${item}: nothing granted`);
    assert.deepEqual(chessIn(ps), before, `${item}: no other operator, no second elite`);
    assert.ok(!ps.find(it.uid), `${item}: consumed`);
    // …and says why (GitHub #401, the owner's OK of 2026-10-09)
    assert.deepEqual(warns, [{ msgid: '{who}：卡池中已没有{name}', who: '拟态物质', name: '溯光星源' }], `${item}: the toast`);
  }
  // 2 normal copies, no elite, the pool drained by other players: nothing either
  {
    const { m, ps, equip } = setup({ seed: 9 });
    const t = give(m, ps, cid, 'hand');
    give(m, ps, cid, 'hand');
    m.pool.take(cid, m.pool.left(cid));
    const got = spyGrants(ps);
    const warns = spyWarns(m);
    assert.deepEqual(equip(giveItem(m, ps, A('5_05')), t), OK);
    assert.deepEqual(got, []);
    assert.deepEqual(chessIn(ps), [cid, cid]);
    assert.deepEqual(warns.map((w) => w.msgid), ['{who}：卡池中已没有{name}']);
  }
  // 2 normal copies with copies left: the 3rd merges into the elite
  {
    const { m, ps, equip } = setup({ seed: 9 });
    const t = give(m, ps, cid, 'hand');
    give(m, ps, cid, 'hand');
    assert.equal(m.pool.left(cid), 3);
    const warns = spyWarns(m);
    assert.deepEqual(equip(giveItem(m, ps, A('5_05')), t), OK);
    assert.deepEqual(chessIn(ps), [elite]);
    assert.deepEqual(warns, [], 'a grant: no warn toast');
    assert.equal(m.pool.left(cid), 2, 'the elite holds 3 copies');
  }
});

test('拟态物质 with fewer than 2 copies and no same-bond operator left gives nothing and says so (GitHub #401)', () => {
  // 缪尔赛思's only bond is 调和 and she is its only member: one copy owned, the rest of her pool taken by others
  const cid = 'chess_char_6_11_a';
  const { m, ps, equip } = setup({ seed: 9 });
  const t = give(m, ps, cid, 'hand');
  m.pool.take(cid, m.pool.left(cid));
  const got = spyGrants(ps);
  const warns = spyWarns(m);
  assert.deepEqual(equip(giveItem(m, ps, A('5_05')), t), OK);
  assert.deepEqual(got, [], 'nothing granted');
  assert.deepEqual(warns, [{ msgid: '{who}：没有可获得的同盟约干员', who: '拟态物质', name: null }]);
});

test('博士投影: golden promotes at once; normal stays equipped and promotes at the next round start', () => {
  const { h, m, ps, equip } = setup();
  const cid = plain((c) => c.tier === 2)[0];
  const a = give(m, ps, cid, 'hand');
  assert.deepEqual(equip(giveItem(m, ps, B('5_06')), a), OK);
  assert.ok(m.gd.isGolden(ps.find(a.uid).piece.id), 'elite now');
  assert.equal(ps.find(a.uid).piece.items.length, 0, 'golden is consumed');
  const cid2 = plain((c) => c.tier === 3)[0];
  const b = give(m, ps, cid2, 'hand');
  const holo = giveItem(m, ps, A('5_06'));
  assert.deepEqual(equip(holo, b), OK);
  assert.deepEqual(ps.find(b.uid).piece.items.map((x) => x.id), [A('5_06')], 'occupies a slot');
  assert.ok(!m.gd.isGolden(ps.find(b.uid).piece.id));
  h.toPrep(2);
  const now = ps.find(b.uid).piece;
  assert.ok(m.gd.isGolden(now.id), 'promoted at round start');
  assert.ok(!now.items.some((x) => x.id === A('5_06')), 'item consumed');
  cover(A('5_06'), B('5_06'));
});

test('商业包装方案: every 8 / 7 operators sold ⇒ 1 normal operator sharing a bond with the carrier (≤ shop level)', () => {
  for (const [id, n] of [[A('5_07'), 8], [B('5_07'), 7]]) {
    const { m, ps, equip } = setup({ seed: 12 });
    const cid = plain((c) => c.tier === 1 && c.bonds.length)[0];
    const holder = give(m, ps, cid, 'board', [10, 5]);
    assert.deepEqual(equip(giveItem(m, ps, id), holder), OK);
    const got = spyGrants(ps);
    const fodder = plain((c) => c.tier === 1 && c.chessId !== cid);
    for (let i = 0; i < n - 1; i++) assert.deepEqual(m.handle('p_0', { t: 'g.sell', uid: give(m, ps, fodder[i % fodder.length], 'hand').uid }), OK);
    assert.equal(got.length, 0, 'nothing yet');
    assert.deepEqual(m.handle('p_0', { t: 'g.sell', uid: give(m, ps, fodder[0], 'hand').uid }), OK);
    assert.equal(got.length, 1, `${id}: 1 after ${n} sells`);
    const c = DATA.chess[got[0]];
    assert.ok(c.bonds.some((b) => DATA.chess[cid].bonds.includes(b)) && !c.isGolden && c.tier <= ps.shop.level);
    cover(id);
  }
});

test('突变细胞: after a battle the carrier becomes a random NORMAL tier+1 operator; its equipment, the cell included, returns to the hand', () => {
  // PRTS 下半 记录 备注 "生效时，原干员销毁，获得一名高一阶的随机初始干员（最高六阶）"; the cell is not consumed (player
  // feedback after 0.1.0 — players re-inject it every round; test/match/feedback1-meta.test.js)
  const { m, ps, equip } = setup({ seed: 3 });
  const cid = plain((c) => c.tier === 2)[0];
  const holder = give(m, ps, cid, 'hand');
  assert.deepEqual(equip(giveItem(m, ps, A('5_08')), holder), OK);
  assert.deepEqual(equip(giveItem(m, ps, A('1_01')), holder), OK);
  m.dispatch(ps, 'onBattleResult', { result: {}, lpLoss: 0, perfect: true });
  const chess = ps.hand.filter((p) => p && p.kind === 'chess');
  assert.equal(chess.length, 1);
  const p = chess[0];
  assert.equal(DATA.chess[p.id].tier, 3);
  assert.ok(!DATA.chess[p.id].isGolden);
  assert.deepEqual(p.items, [], 'no equipment left on it');
  assert.ok(handIds(ps, 'item').includes(A('1_01')), 'other item back in the hand');
  assert.ok(handIds(ps, 'item').includes(A('5_08')), 'the cell back in the hand (not consumed)');
  assert.equal(DATA.items[A('5_08')].upgradeNum, 100);
  // the golden record (same buff) behaves the same
  const g = ps.hand.find((x) => x && x.id === A('5_08'));
  g.id = B('5_08');
  assert.deepEqual(equip(g, p), OK);
  m.dispatch(ps, 'onBattleResult', { result: {}, lpLoss: 0, perfect: true });
  const q = ps.hand.find((x) => x && x.kind === 'chess');
  assert.equal(DATA.chess[q.id].tier, 4);
  assert.ok(handIds(ps, 'item').includes(B('5_08')));
  cover(A('5_08'), B('5_08'));
});

test('突变细胞: a DEPLOYED carrier leaves the field — the new operator is gained into the 整备区, the deploy slot comes back (PR #2)', () => {
  // official footage (bilibili BV1vzyVBuEN9, BV1Qkw1zMEoR): the tile is empty at the next prep and the new operator waits
  // on the bench; the case added by the closed PR #2, on the destroy-then-gain rule (DESIGN §21.1)
  const { m, ps, equip } = setup({ seed: 3 });
  const cid = plain((c) => c.tier === 2)[0];
  const holder = give(m, ps, cid, 'board', legalTileFor(m, ps, cid));
  assert.deepEqual(equip(giveItem(m, ps, A('5_08')), holder), OK);
  assert.equal(ps.deployCount, 1, 'the carrier is deployed');
  m.dispatch(ps, 'onBattleResult', { result: {}, lpLoss: 0, perfect: true });
  assert.equal(ps.board.size, 0, 'the carrier left the field');
  assert.equal(ps.deployCount, 0, 'the deploy slot came back');
  const chess = ps.hand.filter((p) => p && p.kind === 'chess');
  assert.equal(chess.length, 1, 'the new operator waits in the 整备区');
  assert.equal(DATA.chess[chess[0].id].tier, 3, 'the random tier+1 operator');
  assert.equal(DATA.chess[chess[0].id].isGolden, false);
  assert.ok(handIds(ps, 'item').includes(A('5_08')), 'the cell back in the hand');
});

test('人事部文档: deploy cap becomes 9 (a second copy adds nothing)', () => {
  const { m, ps, equip } = setup();
  const t = give(m, ps, plain((c) => c.tier === 1)[0], 'hand');
  assert.equal(ps.deployCap, 8);
  assert.deepEqual(equip(giveItem(m, ps, A('6_08')), t), OK);
  assert.equal(ps.deployCap, 9);
  assert.deepEqual(equip(giveItem(m, ps, A('6_08')), t), OK);
  assert.equal(ps.deployCap, 9);
  cover(A('6_08'), B('6_08'));
});

test('天师古鼎 + 炎国短刀 (炎 carrier): +2 funds per operator gained, at most 3 times per round', () => {
  const fodder = plain((c) => c.tier <= 2 && !c.bonds.includes('yanShip'));
  const { h, m, ps, equip } = setup({ seed: 44 });
  const yan = plain((c) => c.bonds.includes('yanShip'))[0];
  const holder = give(m, ps, yan, 'board', [10, 5]);
  assert.deepEqual(equip(giveItem(m, ps, B('6_03')), holder), OK);
  assert.deepEqual(equip(giveItem(m, ps, A('3_04')), holder), OK);
  const f0 = ps.funds;
  for (let i = 0; i < 5; i++) ps.acquireChess(fodder[i], { source: 'test' });
  assert.equal(ps.funds - f0, 6, 'max 3 per round');
  h.toPrep(2);
  const f1 = ps.funds;
  ps.acquireChess(fodder[5], { source: 'test' });
  assert.equal(ps.funds - f1, 2, 'new round');
  // without 炎国短刀 (another item), or a non-炎 carrier: nothing
  for (const [carrier, other] of [[yan, A('1_01')], [fodder[6], A('3_04')]]) {
    const s2 = setup({ seed: 44 });
    const piece = give(s2.m, s2.ps, carrier, 'board', [10, 5]);
    assert.deepEqual(s2.equip(giveItem(s2.m, s2.ps, A('6_03')), piece), OK);
    assert.deepEqual(s2.equip(giveItem(s2.m, s2.ps, other), piece), OK);
    const g0 = s2.ps.funds;
    s2.ps.acquireChess(fodder[0], { source: 'test' });
    assert.equal(s2.ps.funds, g0, `${carrier} + ${other}`);
  }
  cover(A('3_04'), B('3_04'));
});

test('画卷 (Art): copies the operator on the tile / in front with its elite status and equipment into the hand', () => {
  const { m, ps } = setup({ seed: 8 });
  const cid = plain((c) => c.tier === 2)[0];
  const target = give(m, ps, DATA.chess[cid].goldenId, 'board', [10, 6]);
  target.items.push(ps.newPiece('item', A('3_03')), ps.newPiece('item', A('6_09')));
  ps.recompute();
  const art = giveItem(m, ps, 'chess_item_6_02_m');
  assert.deepEqual(m.handle('p_0', { t: 'g.art', itemUid: art.uid, row: 10, col: 5 }), OK, 'range 1-1: the tile in front');
  const copy = ps.hand.find((p) => p && p.kind === 'chess');
  assert.equal(copy && copy.id, DATA.chess[cid].goldenId, 'elite copy in the hand');
  // the copied 激光发射器 pairs with the original's (items merge "无论是否被装备") ⇒ the golden goes to the hand;
  // 变形同构体 never merges ⇒ its copy waits in the hand too, unequipped (PRTS 画卷 备注 "获得的装备为未装备状态";
  // until 0.2.2 the copy wore it)
  assert.deepEqual(copy.items.map((x) => x.id), [], 'the copy wears nothing');
  assert.deepEqual(ps.find(target.uid).piece.items.map((x) => x.id), [A('6_09')]);
  assert.deepEqual(handIds(ps, 'item').slice().sort(), [B('3_03'), A('6_09')].sort(), 'the merged golden and the copied 变形同构体 in the hand');
  const art2 = giveItem(m, ps, 'chess_item_6_02_m');
  assert.equal(m.handle('p_0', { t: 'g.art', itemUid: art2.uid, row: 11, col: 7 }).error, 'BAD_TARGET', 'no operator in range');
  cover('chess_item_6_02_m');
});

test('教鞭 (Art): a 战术特训 bounty (PRTS "于3个战术特训的悬赏任务中选择一项": extra enemies, coins for a perfect own phase); “神秘顾客”: a band bounty; destroyed ⇒ +1 fund, passes on', () => {
  // the 20 战术特训 cards — the ones the 悬赏决策 draft leaves out ("※以下悬赏任务仅由法术教鞭生成")
  const training = new Set(DATA.choices.cards.bounty.filter((c) => c.draftExcluded === 'perfect').map((c) => c.effectId));
  assert.equal(training.size, 20);
  const seen = new Set();
  for (let s = 0; s < 6; s++) {
    const { m, ps } = setup({ seed: 60 + s });
    for (let k = 0; k < 2; k++) {
      const art = giveItem(m, ps, 'chess_item_6_03_m');
      const deadline = m.deadline;
      assert.deepEqual(m.handle('p_0', { t: 'g.art', itemUid: art.uid, row: 10, col: 5 }), OK);
      const pending = ps.personalChoice;
      assert.equal(ps.bounties.length, k, 'offering cards does not add a bounty');
      assert.equal(pending.cards.length, 3);
      assert.equal(new Set(pending.cards.map((c) => c.effectId)).size, 3);
      assert.equal(pending.round, m.round);
      assert.equal(pending.sourceItemId, art.id);
      assert.equal(m.deadline, deadline, 'uses the existing PREP clock');
      assert.equal(ps.find(art.uid), null);
      assert.equal(ps.round.arts, k + 1, 'consumed when offered');
      for (const c of pending.cards) assert.ok(training.has(c.effectId) && !m.gd.inactiveEnemies.has(c.enemyKey));
      assert.deepEqual(m.handle('p_0', { t: 'g.choice', idx: 1, choiceId: pending.id }), OK);
      assert.equal(ps.personalChoice, null);
      assert.equal(ps.bounties[k].card.effectId, pending.cards[1].effectId, 'the submitted card is applied');
      assert.equal(ps.round.arts, k + 1, 'picking does not consume another Art');
      assert.equal(m.handle('p_0', { t: 'g.choice', idx: 1, choiceId: pending.id }).error, 'BAD_TARGET');
    }
    assert.equal(ps.bounties.length, 2);
    for (const b of ps.bounties) {
      assert.ok(training.has(b.card.effectId), `${b.card.effectId} ${b.card.name}: a 战术特训 card (user playtest #6 item 4 review)`);
      assert.match(b.card.name, /战术特训/);
      assert.equal(b.card.payout, 'perfect', 'pays for a perfect own phase, not per kill');
      assert.ok(m.gd.enemy(b.card.enemyKey) && !m.gd.inactiveEnemies.has(b.card.enemyKey), 'its enemy can appear in the mode');
      seen.add(b.card.effectId);
    }
  }
  assert.ok(seen.size >= 5, 'different offered cards across seeds');
  const { h, m } = setup({ mode: 'coop', humans: 2, seed: 7 });
  const p0 = h.ps('p_0'), p1 = h.ps('p_1');
  const art = giveItem(m, p0, 'chess_item_6_01_m');
  const f0 = p0.funds;
  assert.deepEqual(m.handle('p_0', { t: 'g.destroy', uid: art.uid }), OK);
  assert.equal(p0.funds, f0 + 1);
  assert.ok(p1.hand.some((p) => p && p.id === 'chess_item_6_01_m'), 'passed to the next player');
  const passed = p1.hand.find((p) => p && p.id === 'chess_item_6_01_m');
  assert.deepEqual(m.handle('p_1', { t: 'g.art', itemUid: passed.uid, row: 10, col: 5 }), OK);
  assert.match(p1.bounties[0].card.effectId, /^enemyeffect_b_/);
  assert.equal(p1.personalChoice, null, '神秘顾客 still applies its random bounty immediately');
  cover('chess_item_6_03_m', 'chess_item_6_01_m');
});

test('教鞭: pending and empty-pool failures keep the Art, Arts count and RNG; short offers use actual cards', () => {
  const { m, ps } = setup();
  const first = giveItem(m, ps, 'chess_item_6_03_m');
  const second = giveItem(m, ps, 'chess_item_6_03_m', 'temp');
  assert.deepEqual(ps.useArt(first.uid, 10, 5), OK);
  const pending = ps.personalChoice;
  const rng = m.rngMeta.state(), uid = m.uidSeq;
  assert.deepEqual(ps.useArt(second.uid, 10, 5), { error: 'BAD_TARGET', detail: '请先完成当前教鞭选择' });
  assert.equal(ps.personalChoice, pending);
  assert.ok(ps.find(second.uid));
  assert.equal(ps.round.arts, 1);
  assert.equal(m.rngMeta.state(), rng);
  assert.equal(m.uidSeq, uid);
  assert.equal(m.pickPersonalChoice(ps, -1, pending.id).error, 'BAD_TARGET');
  assert.equal(m.pickPersonalChoice(ps, 0.5, pending.id).error, 'BAD_TARGET');
  assert.equal(m.pickPersonalChoice(ps, 3, pending.id).error, 'BAD_TARGET');
  assert.equal(ps.personalChoice, pending);
  assert.deepEqual(m.pickPersonalChoice(ps, 0, pending.id), OK);
  const training = DATA.choices.cards.bounty.filter((c) => c.payout === 'perfect');
  m.gd.inactiveEnemies = new Set(training.map((c) => c.enemyKey));
  assert.deepEqual(ps.useArt(second.uid, 10, 5), { error: 'BAD_TARGET', detail: '当前没有可用的战术特训' });
  assert.ok(ps.find(second.uid));
  assert.equal(ps.round.arts, 1);
  assert.equal(ps.personalChoice, null);
  assert.equal(m.rngMeta.state(), rng);
  const allowed = training.find((c) => c.multiRound && m.gd.enemy(c.enemyKey));
  m.gd.inactiveEnemies.delete(allowed.enemyKey);
  assert.deepEqual(ps.useArt(second.uid, 10, 5), OK);
  assert.ok(ps.personalChoice.cards.length > 0 && ps.personalChoice.cards.length < 3);
  assert.equal(new Set(ps.personalChoice.cards.map((c) => c.effectId)).size, ps.personalChoice.cards.length);
  assert.equal(ps.find(second.uid), null, 'Arts in temp are consumed too');
  const view = ps.privateView().personalChoice;
  assert.ok(view.cards.every((c) => c.kind === 'bounty' && c.rounds === 2));
  assert.ok(view.cards.every((c) => !/每场/.test(c.descRaw || c.desc)), 'multi-round candidates use the same two-battle text as applied bounties');
  m.dispose();
});

test('教鞭: an open choice goes with a player who is eliminated, and nothing of it is left in its views', () => {
  const { h, m } = setup({ mode: 'coop', humans: 2, seed: 8 });
  const a = h.ps('p_0');
  const art = giveItem(m, a, 'chess_item_6_03_m');
  assert.deepEqual(a.useArt(art.uid, 10, 5), { ok: true });
  assert.equal(a.privateView().personalChoice.cards.length, 3);
  a.eliminate(m.round);
  assert.equal(a.personalChoice, null);
  assert.equal(a.privateView().personalChoice, null);
  assert.equal(a.privateView().canReady, false);
  m.dispose();
});

test('merging: two identical normal items become the golden one (upgradeNum 2); upgradeNum-100 items never merge', () => {
  const never = Object.values(DATA.items).filter((r) => r.itemType === 'EQUIP' && !r.isGolden && r.upgradeNum === 100).map((r) => r.name).sort();
  assert.deepEqual(never, ['人事部文档', '信标', '变形同构体', '寻呼模块', '拟态物质', '突变细胞'].sort());
  const { m, ps } = setup();
  ps.acquireItem(A('3_07'));
  ps.acquireItem(A('3_07'));
  assert.deepEqual(handIds(ps, 'item'), [B('3_07')]);
  ps.acquireItem(A('6_09'));
  ps.acquireItem(A('6_09'));
  assert.equal(handIds(ps, 'item').filter((x) => x === A('6_09')).length, 2);
  cover(A('3_07'), B('3_07'));
});

test('coverage: every equipment (normal + golden) and every Art is exercised by a test above', () => {
  // items whose numbers are asserted in the stat table, the proc tests or the meta tests
  const missing = Object.keys(DATA.items).filter((id) => !COVER.has(id)).sort();
  assert.deepEqual(missing, []);
  assert.equal(Object.keys(DATA.items).length, 115);
});
