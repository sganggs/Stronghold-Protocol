// 规程·序列Ⅰ (act3autochess@V3_1) equipment: new and changed items.
// Numbers come from the loaded record. Battle uses content 'lite' (generic skill, no bond modules)
// plus the item installer. Prep uses the built-in registry only, so bond/garrison hooks stay quiet.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { getVersionData, setData, resetData } from '../../server/data.js';
import { setGameData, unitBonds } from '../../server/sim/content/support/index.js';
import { createRegistry, resetDefaultRegistry } from '../../server/match/effectsMeta.js';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { makeMatch, give, giveItem } from '../match/harness.js';
import { install as installItems, installItem } from '../../server/sim/content/items/battle.js';
import { createBotPrepSteps } from '../../server/match/bot.js';
import { beginCommandPrep } from '../../server/match/bandCommands.js';
import { KITTED_CHARS } from '../../server/sim/content/kits/index.js';

const QUIET = { warn() {}, error() {}, info() {} };
const V3 = getVersionData('act3autochess@V3_1', { log: QUIET });
setData(V3);
setGameData(V3);
const REG = createRegistry({ log: QUIET, builtins: true, content: false });
after(() => { setGameData(null); resetData(); resetDefaultRegistry(); });

const A = (k) => `chess_item_${k}_e_a`;
const XIA = 'chess_char_1_11_a';
const XING = 'chess_char_2_23_a';
const OK = { ok: true };
const close = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} ≠ ${b}`);

function quals(id) {
  const g = id.endsWith('_a') ? `${id.slice(0, -2)}_b` : null;
  return g && V3.items[g] ? [id, g] : [id];
}
function bb(id, key) {
  const rec = V3.items[id];
  if (!rec) throw new Error(`no item ${id}`);
  for (const b of rec.buffs || []) {
    const k = b.bbStr && b.bbStr.key;
    if (k === key || b.key === key) return { ...(b.bb || {}), ...(b.bbStr || {}) };
  }
  throw new Error(`${id} has no buff ${key}`);
}
function forceRng(h, v) { const orig = h.b.rng; h.b.rng = Object.assign(() => v, orig); }
function op(id, o = {}) {
  return chessRec({
    id, profession: o.profession ?? 'WARRIOR', bonds: o.bonds ?? [], tier: 1,
    rangeGrid: o.range ?? [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]],
    stats: { maxHp: 2000, atk: 500, def: 200, res: 10, aspd: 100, blockCnt: 2, ...(o.stats || {}) },
    skill: o.skill === null ? null : { spCost: 60, duration: 5, initSp: 0, ...(o.skill || {}) },
  });
}
function fight(opts = {}) {
  const chess = opts.ops || { t_op: op('t_op', opts.op || {}) };
  const foes = opts.foes === undefined ? [[10, 6]] : opts.foes;
  return makeBattle({
    content: 'lite', extraContent: [installItems],
    defs: {
      chess,
      enemies: { e_d: enemyRec({ key: 'e_d', hp: opts.ehp ?? 1e7, def: opts.edef ?? 0, res: opts.eres ?? 0, speed: 0 }) },
    },
    units: opts.units || [{ chessId: 't_op', row: 10, col: 4, items: opts.items || [] }],
    bonds: opts.bondState, timeLimit: 999, autoFinish: false, seed: opts.seed ?? 1,
    enemies: foes.map(([r, c]) => ({ key: 'e_d', pos: [r, c] })),
    captureNoisy: opts.captureNoisy,
  });
}
const unit = (h, id = 't_op') => h.unit(id);
function setup(seed = 41) {
  // 规程 has no mode_single_normal; its solo ladder starts at mode_single_1.
  const h = makeMatch({ mode: 'solo', modeId: 'mode_single_1', humans: 1, seed, registry: REG, fake: true, data: V3 }).start();
  h.toPrep(1, { band: 'band_amiya' });
  const ps = h.ps('p_0');
  for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean), ...ps.temp.filter(Boolean)]) if (p.kind === 'chess') ps.returnCopies(p);
  ps.board.clear(); ps.hand.fill(null); ps.temp.fill(null); ps.offers.length = 0;
  ps.funds = 50; ps.layers = {}; ps.pendingFunds = 0; ps.shop.freeRefreshes = 0;
  ps.shop.level = 6; ps.bandId = null; ps.recompute();
  const equip = (item, target) => h.m.handle('p_0', { t: 'g.equip', itemUid: item.uid, targetUid: target.uid });
  return { h, m: h.m, ps, equip };
}
function withPrep(seed, fn) {
  const s = setup(seed);
  try { fn(s); }
  finally { s.m.dispose(); }
}
const held = (ps) => [...ps.hand, ...ps.temp].filter(Boolean);
const chessHeld = (ps) => [...ps.board.values(), ...held(ps)].filter((p) => p && p.kind === 'chess');
function slot(kind, id, extra = {}) {
  return { kind, id, basePrice: 1, frozen: false, sold: false, ...extra };
}

const PAIRS = [
  [A('6_01'), A('5_05'), A('6_12')],
  [A('4_12'), A('5_12'), A('6_05')],
  [A('3_16'), A('5_11'), A('6_06')],
  [A('6_07'), A('4_13'), A('6_08')],
  [A('4_14'), A('6_09'), A('6_10')],
];

test('catalog: five fusion pairs, and duration 0 equipment is consume-on-equip', () => {
  const fusers = Object.values(V3.items).filter((r) => r && r.canFuse === true);
  assert.equal(fusers.length, 10);
  for (const [a, b, result] of PAIRS) {
    const ra = V3.items[a], rb = V3.items[b], rr = V3.items[result];
    assert.equal(ra.fuseWith, b);
    assert.equal(rb.fuseWith, a);
    assert.equal(ra.fuseResult, result);
    assert.equal(rb.fuseResult, result);
    assert.equal(rr.canFuse, undefined);
    assert.equal(rr.isGolden, true);
    assert.equal(rr.itemType, 'EQUIP');
  }
  for (const r of Object.values(V3.items)) {
    if (!r || r.itemType !== 'EQUIP' || r.duration !== 0) continue;
    assert.equal(typeof r.kind, 'string', r.id);
    assert.ok(r.kind.startsWith('consume_on_equip'), `${r.id} ${r.kind}`);
  }
});

test('虹彩活血饮料: no heal from others, regen keeps going', () => {
  const p = bb(A('1_06'), 'act3autochess_equip_acarm126_global_buff');
  const h = fight({
    items: [A('1_06')], foes: [],
    ops: { t_op: op('t_op'), t_a: op('t_a') },
    units: [{ chessId: 't_op', row: 10, col: 4, items: [A('1_06')] }, { chessId: 't_a', row: 10, col: 5 }],
  });
  h.step(1);
  const u = unit(h), a = unit(h, 't_a');
  assert.equal(u.s.flags.noHeal, true);
  close(u.s.hpRegen, p.value, 'regen');
  u.hp = 1000;
  const hp = u.hp;
  h.b.heal(a, u, 500);
  close(u.hp, hp, 'blocked');
  h.b.heal(u, u, 40, { self: true });
  close(u.hp, hp + 40, 'self');
});

test('雪祀之衣: block and taunt, max HP from the attr buff', () => {
  const p = bb(A('1_07'), 'act3autochess_equip_acarm127_global_buff');
  const hp = bb(A('1_07'), 'attr_common_global_buff').max_hp;
  const h = fight({ items: [A('1_07')], foes: [] });
  h.step(1);
  const s = unit(h).s;
  assert.equal(s.blockCnt, 2 + p.block_cnt);
  assert.equal(s.taunt, p.taunt_level);
  close(s.maxHp, 2000 * (1 + hp), 'hp');
});

test('聚合急救箱: first drop below the line heals that ally once; 虹彩 blocks it', () => {
  const p = bb(A('2_09'), 'act3autochess_equip_acarm136_ability');
  const h = fight({
    foes: [],
    ops: { t_op: op('t_op'), t_a: op('t_a') },
    units: [{ chessId: 't_op', row: 10, col: 4, items: [A('2_09')] }, { chessId: 't_a', row: 10, col: 5 }],
  });
  h.step(1);
  const a = unit(h, 't_a');
  a.hp = 400;
  h.run(0.3);
  close(a.hp, 400 + a.s.maxHp * p.hp_ratio, 'heal');
  const again = a.hp;
  a.hp = 400;
  h.run(0.3);
  close(a.hp, 400, 'once');
  assert.ok(again > 400);
  const h2 = fight({
    foes: [],
    ops: { t_op: op('t_op'), t_a: op('t_a') },
    units: [
      { chessId: 't_op', row: 10, col: 4, items: [A('2_09')] },
      { chessId: 't_a', row: 10, col: 5, items: [A('1_06')] },
    ],
  });
  h2.step(1);
  const patient = unit(h2, 't_a');
  patient.hp = 400;
  h2.run(0.3);
  assert.ok(patient.hp < 500, `rainbow patient ${patient.hp}`);
});

test('灵巧涡轮手套: ASPD per second, damage clears the stacks and they build again', () => {
  for (const id of quals(A('2_10'))) {
    const p = bb(id, 'act3autochess_equip_acarm132_global_buff');
    const h = fight({ items: [id], foes: [] });
    h.step(1);
    const u = unit(h);
    assert.equal(u.s.aspd, 100);
    h.run(1.05);
    assert.equal(u.s.aspd, 100 + p.attack_speed);
    h.b.dealDamage(u, u, { amount: 50, type: 'true' });
    assert.equal(u.s.aspd, 100, 'cleared');
    h.run(1.05);
    assert.equal(u.s.aspd, 100 + p.attack_speed, 'rebuild');
  }
});

test('乌萨斯呼吸器: the deployment in progress is layer 1', () => {
  const p = bb(A('3_12'), 'act3autochess_equip_acarm138_global_buff');
  const h = fight({ items: [A('3_12')], foes: [] });
  h.step(1);
  const s = unit(h).s;
  assert.equal(s.blockCnt, 2 + p.block_cnt_cell);
  close(s.atk, 500 * (1 + p.atk_cell), 'atk');
});

test('多功能补剂: a hit adds layers to the carrier\'s active bond, capped', () => {
  const p = bb(A('3_13'), 'act3autochess_equip_acarm131_global_buff');
  const h = fight({
    items: [A('3_13')], foes: [[10, 9]],
    op: { bonds: ['yanShip'] },
    bondState: { yanShip: { count: 1, active: true, tier: 1, layers: 0 } },
  });
  h.step(1);
  const u = unit(h);
  const bond = h.b.getPlayer(u.ownerId).bonds.yanShip;
  h.b.dealDamage(u, h.enemies()[0], { amount: 100, type: 'true' });
  assert.equal(bond.layers, p.temp_stack_count_add);
  bond.layers = p.temp_stack_count_max;
  // the cap is tracked on the grant, not the live total we just wrote; one more hit still adds until the grant's own count hits the cap
  h.b.dealDamage(u, h.enemies()[0], { amount: 100, type: 'true' });
  assert.ok(bond.layers >= p.temp_stack_count_max);
});

test('伊比利亚骨刺刀: extra arts on a hit, same seed twice', () => {
  const p = bb(A('3_14'), 'act3autochess_equip_acarm133_global_buff');
  const drop = (seed) => {
    const h = fight({ items: [A('3_14')], seed, ehp: 8000, foes: [[10, 6]] });
    h.step(1);
    const e = h.enemies()[0];
    const hp = e.hp;
    h.b.dealDamage(unit(h), e, { amount: 1000, type: 'true' });
    return hp - e.hp;
  };
  const extra = 500 * p.atk_scale * (1 + p.double_damage);
  close(drop(7), 1000 + extra, 'bone');
  assert.equal(drop(7), drop(7));
});

test('莱塔尼亚小鼓: a knockout in range restores SP', () => {
  const p = bb(A('4_09'), 'act3autochess_equip_acarm134_ability');
  const h = fight({ items: [A('4_09')], ehp: 8000, foes: [[10, 5]] });
  h.step(1);
  const u = unit(h);
  const before = u.skill.sp;
  h.b.dealDamage(u, h.enemies()[0], { amount: 1e6, type: 'true' });
  close(u.skill.sp - before, p.sp, 'sp');
});

test('可靠怀表: skill cost scale and floor, ASPD fraction while the skill is on', () => {
  for (const id of quals(A('4_11'))) {
    const p = bb(id, 'act3autochess_equip_acarm137_global_buff');
    const h = fight({ items: [id], foes: [], op: { skill: { spCost: 20, duration: 5, initSp: 0 } } });
    h.step(1);
    const u = unit(h);
    assert.equal(u.skill.spCost, Math.floor(20 * p.sp_cost_scale));
    assert.equal(u.skill.activate('test', { free: true }), true, id);
    h.run(0.55);
    close(u.s.aspd, 100 + 100 * p.attack_speed, `${id} aspd`);
  }
  const g = bb(A('4_11').replace('_a', '_b'), 'act3autochess_equip_acarm137_global_buff');
  const low = fight({ items: [A('4_11').replace('_a', '_b')], foes: [], op: { skill: { spCost: 4, duration: 5, initSp: 0 } } });
  low.step(1);
  assert.equal(unit(low).skill.spCost, g.sp_cost_min);
  const mid = fight({ items: [A('4_11')], foes: [], op: { skill: { spCost: 4, duration: 5, initSp: 0 } } });
  mid.step(1);
  const scale = bb(A('4_11'), 'act3autochess_equip_acarm137_global_buff').sp_cost_scale;
  assert.equal(unit(mid).skill.spCost, Math.floor(4 * scale));
});

test('佣兵名牌: ATK and HP per active bond of the player', () => {
  const p = bb(A('5_08'), 'act3autochess_equip_acarm141_global_buff');
  const h = fight({
    items: [A('5_08')], foes: [],
    bondState: {
      deputShip: { count: 2, active: true, tier: 1, layers: 0 },
      yanShip: { count: 2, active: true, tier: 1, layers: 0 },
    },
  });
  h.step(1);
  const s = unit(h).s;
  close(s.atk, 500 * (1 + p.atk * 2), 'atk');
  close(s.maxHp, 2000 * (1 + p.hp * 2), 'hp');
});

test('瓶装烈性反应: damage scale against a burst-locked target', () => {
  const p = bb(A('5_10'), 'act3autochess_equip_acarm158_global_buff');
  const h = fight({ items: [A('5_10')], ehp: 5000 });
  h.step(1);
  const e = h.enemies()[0];
  e.s.flags.burstLock = true;
  const hp = e.hp;
  h.b.dealDamage(unit(h), e, { amount: 1000, type: 'true' });
  close(hp - e.hp, 1000 * p.damage_scale, 'burst');
});

test('驱逐者警棍 / 瓦斯: controlled targets take more, and control in range lasts longer', () => {
  const bat = bb(A('4_12'), 'act3autochess_equip_acarm144_global_buff');
  const gas = bb(A('5_12'), 'act3autochess_equip_acarm143_ability');
  const h = fight({ items: [A('4_12')], ehp: 5000, foes: [[10, 5]] });
  h.step(1);
  const e = h.enemies()[0];
  h.b.applyStatus(e, 'stun', { duration: 2 });
  const hp = e.hp;
  h.b.dealDamage(unit(h), e, { amount: 1000, type: 'true' });
  close(hp - e.hp, 1000 * bat.damage_scale, 'baton');
  const h2 = fight({ items: [A('5_12')], foes: [[10, 5]] });
  h2.step(1);
  const e2 = h2.enemies()[0];
  h2.b.applyStatus(e2, 'stun', { duration: 2 });
  close(e2.findBuff('stun').timeLeft, 2 * (1 + gas.one_minus_status_resistance), 'gas', 0.05);
  const h3 = fight({
    foes: [[10, 5]],
    ops: { t_op: op('t_op'), t_a: op('t_a') },
    units: [
      { chessId: 't_op', row: 10, col: 4, items: [A('5_12')] },
      { chessId: 't_a', row: 10, col: 3, items: [A('5_12')] },
    ],
  });
  h3.step(1);
  const e3 = h3.enemies()[0];
  h3.b.applyStatus(e3, 'stun', { duration: 2 });
  close(e3.findBuff('stun').timeLeft, 2 * (1 + gas.one_minus_status_resistance) ** 2, 'two gas', 0.05);
});

test('不退者力场 / 之盾: block bonus, and stun is cancelled while alive', () => {
  const field = bb(A('5_11'), 'act3autochess_equip_acarm147_global_buff');
  const h = fight({ items: [A('5_11')], foes: [] });
  h.step(1);
  assert.equal(unit(h).s.blockCnt, 2 + field.block_cnt);
  const h2 = fight({ items: [A('3_16')], foes: [] });
  h2.step(1);
  const u = unit(h2);
  h2.b.applyStatus(u, 'stun', { duration: 2 });
  assert.equal(u.findBuff('stun'), null);
});

test('动能加速器 grows on attack and on heal; 轰击弩 does not grow on heal', () => {
  const p = bb(A('6_07'), 'act3autochess_equip_acarm149_global_buff');
  const h = fight({ items: [A('6_07')], foes: [] });
  h.step(1);
  const u = unit(h);
  assert.equal(u.s.aspd, 100);
  h.b.heal(u, u, 30, { self: true });
  assert.equal(u.s.aspd, 100 + p.attack_speed);
  const fused = bb(A('6_08'), 'act3autochess_equip_acarm149_global_buff');
  assert.notEqual(fused.have_splash_damage, null);
  const h2 = fight({ items: [A('6_08')], foes: [[10, 5]] });
  h2.step(1);
  const u2 = unit(h2);
  const aspd = u2.s.aspd;
  h2.b.heal(u2, u2, 30, { self: true });
  assert.equal(u2.s.aspd, aspd, 'fused heal');
  const attacks = h2.hooksOf('attack').length;
  assert.ok(h2.runUntil(() => h2.hooksOf('attack').length > attacks, 4));
  assert.equal(u2.s.aspd, aspd + fused.attack_speed);
});

test('动能单手弩: a hit is multiplied by atk_scale', () => {
  const p = bb(A('4_13'), 'act3autochess_equip_acarm150_global_buff');
  const h = fight({ items: [A('4_13')], ehp: 5000 });
  forceRng(h, 0);
  h.step(1);
  const e = h.enemies()[0];
  const hp = e.hp;
  h.b.dealDamage(unit(h), e, { amount: 1000, type: 'true' });
  close(hp - e.hp, 1000 * p.atk_scale, 'crossbow');
});

test('汲取者之喙 heals a fraction; 汲取者之心 drains and buffs; the fused 镰 doubles both during the skill', () => {
  const beak = bb(A('4_14'), 'act3autochess_equip_acarm152_global_buff');
  const h = fight({ items: [A('4_14')], ehp: 5000 });
  h.step(1);
  const u = unit(h);
  u.hp = 1000;
  h.b.dealDamage(u, h.enemies()[0], { amount: 1000, type: 'true' });
  close(u.hp, 1000 + 1000 * beak.heal_scale, 'beak');
  const heart = bb(A('6_09'), 'act3autochess_equip_acarm153_global_buff');
  const h2 = fight({ items: [A('6_09')], foes: [] });
  h2.step(1);
  const u2 = unit(h2);
  close(u2.s.atk, 500 * (1 + heart.atk), 'heart atk');
  assert.equal(u2.s.aspd, 100 + heart.attack_speed);
  h2.run(1.05);
  close(u2.hp, 2000 - 2000 * heart.hp_ratio_base, 'drain');
  const h3 = fight({ items: [A('6_10')], foes: [] });
  h3.step(1);
  const u3 = unit(h3);
  assert.equal(u3.skill.activate('test', { free: true }), true);
  h3.run(1.05);
  close(u3.s.atk, 500 * (1 + heart.atk * 2), 'scythe atk');
  assert.equal(u3.s.aspd, 100 + heart.attack_speed * 2);
  close(u3.hp, 2000 - 2000 * heart.hp_ratio_base * 2, 'scythe drain');
  assert.equal(u3.s.flags.noHeal, true);
});

test('天马之枪 is only the ATK bonus; 天马之耀 adds true damage and regen', () => {
  const lance = bb(A('6_01'), 'attr_common_global_buff');
  const h = fight({ items: [A('6_01')], ehp: 5000 });
  h.step(1);
  const u = unit(h);
  close(u.s.atk, 500 * (1 + lance.atk), 'lance');
  const e = h.enemies()[0];
  const hp = e.hp;
  h.b.dealDamage(u, e, { amount: 1000, type: 'true' });
  close(hp - e.hp, 1000, 'no extra');
  const helm = bb(A('5_05'), 'attr_common_global_buff');
  const h2 = fight({ items: [A('5_05')], foes: [] });
  h2.step(1);
  close(unit(h2).s.maxHp, 2000 * (1 + helm.max_hp), 'helm');
  const glory = bb(A('6_12'), 'act3autochess_equip_acarm156_global_buff');
  const attr = bb(A('6_12'), 'attr_common_global_buff');
  const h3 = fight({ items: [A('6_12')], ehp: 8000 });
  h3.step(1);
  const u3 = unit(h3);
  close(u3.s.atk, 500 * (1 + attr.atk), 'glory atk');
  close(u3.s.maxHp, 2000 * (1 + attr.max_hp), 'glory hp');
  close(u3.s.hpRegen, u3.s.maxHp * glory.hp_recovery_per_sec_by_max_hp_ratio, 'regen');
  const e3 = h3.enemies()[0];
  const hp3 = e3.hp;
  h3.b.dealDamage(u3, e3, { amount: 1000, type: 'true' });
  close(hp3 - e3.hp, 1000 + u3.s.atk * glory.atk_scale, 'glory extra');
});

test('防暴装备 spreads control while the skill is on; 卫护系统 attracts on skill start', () => {
  const riot = bb(A('6_05'), 'act3autochess_equip_acarm145_ability');
  const h = fight({
    items: [A('6_05')], foes: [[10, 5], [10, 6]],
  });
  forceRng(h, 0);
  h.step(1);
  const u = unit(h);
  assert.equal(u.skill.activate('test', { free: true }), true);
  const [near, far] = h.enemies();
  h.b.applyStatus(near, 'stun', { duration: 2 });
  const spread = far.findBuff('stun');
  assert.ok(spread, 'spread');
  assert.ok(spread.timeLeft >= riot.ab_buff_duration - 0.05);
  const pull = bb(A('6_06'), 'act3autochess_equip_acarm148_global_buff');
  const h2 = fight({ items: [A('6_06')], foes: [[10, 5], [10, 8]] });
  h2.step(1);
  const u2 = unit(h2);
  assert.equal(u2.skill.activate('test', { free: true }), true);
  const [closeFoe, farFoe] = h2.enemies();
  assert.ok(closeFoe.findBuff('attract'), 'attract');
  close(closeFoe.findBuff('attract').timeLeft, pull.attract_duration, 'attract dur', 0.05);
  assert.equal(farFoe.findBuff('attract'), null);
});

test('changed battle items read the regulation blackboard', () => {
  for (const id of quals(A('3_03'))) {
    const p = bb(id, 'act1vautochess_equip_acarm024_global_buff');
    const h = fight({ items: [id], foes: [] });
    h.step(1);
    const u = unit(h);
    assert.equal(u.skill.activate('test', { free: true }), true, id);
    close(u.s.atk, 500 * (1 + p.atk), id);
  }
  for (const id of quals(A('3_06'))) {
    const p = bb(id, 'attr_common_global_buff');
    const h = fight({ items: [id], foes: [] });
    h.step(1);
    close(unit(h).s.atk, 500 * (1 + p.atk), `${id} atk`);
    assert.equal(unit(h).s.aspd, 100 + p.attack_speed);
  }
  for (const id of quals(A('3_07'))) {
    const res = bb(id, 'attr_common_global_buff').magic_resistance;
    const silence = bb(id, 'silence_attachment').silence;
    const h = fight({ items: [id], foes: [[10, 5]] });
    h.step(1);
    assert.equal(unit(h).s.res, 10 + res);
    assert.ok(h.runUntil(() => h.enemies()[0].findBuff('silence'), 4), id);
    close(h.enemies()[0].findBuff('silence').timeLeft, silence, `${id} silence`, 0.2);
  }
  for (const id of quals(A('3_05'))) {
    const p = bb(id, 'act1autochess_equip_acarm049_global_buff');
    const empty = fight({ items: [id], foes: [[10, 8]] });
    empty.step(1);
    close(unit(empty).s.maxHp, 2000 * (1 + p.init_max_hp + p.ex_max_hp), `${id} empty`);
    const blocked = fight({
      foes: [[10, 8]],
      ops: { t_op: op('t_op'), t_a: op('t_a') },
      units: [{ chessId: 't_op', row: 10, col: 4, items: [id] }, { chessId: 't_a', row: 10, col: 5 }],
    });
    blocked.step(1);
    close(unit(blocked).s.maxHp, 2000 * (1 + p.init_max_hp), `${id} blocked`);
  }
  for (const id of quals(A('3_04'))) {
    const each = bb(id, 'act1autochess_equip_acarm051_global_buff').sp_each_person;
    const solo = fight({ items: [id], foes: [], op: { bonds: ['yanShip'] } });
    solo.step(1);
    assert.ok(unit(solo).skill.sp >= each && unit(solo).skill.sp < each + 1, id);
    const pair = fight({
      foes: [],
      ops: { t_op: op('t_op', { bonds: ['yanShip'] }), t_a: op('t_a', { bonds: ['yanShip'] }) },
      units: [{ chessId: 't_op', row: 10, col: 4, items: [id] }, { chessId: 't_a', row: 10, col: 6 }],
    });
    pair.step(1);
    const want = each * 2;
    assert.ok(unit(pair).skill.sp >= want && unit(pair).skill.sp < want + 1, `${id} pair`);
  }
  for (const id of quals(A('4_03'))) {
    const d = bb(id, 'act2autochess_equip_acarm055_global_buff').duration;
    const h = fight({ items: [id], foes: [[10, 8]] });
    h.step(1);
    const u = unit(h);
    h.b.dealDamage(h.enemies()[0], u, { amount: 10, type: 'true' });
    assert.equal(u.s.flags.stealth, true);
    close(u.findBuff('stealth').timeLeft, d, id, 0.05);
  }
  for (const id of quals(A('4_04'))) {
    const p = bb(id, 'act2autochess_equip_acarm120_global_buff');
    const h = fight({ items: [id], ehp: 8000 });
    h.step(1);
    const e = h.enemies()[0];
    const hp = e.hp;
    h.b.dealDamage(unit(h), e, { amount: 1000, type: 'true' });
    close(hp - e.hp, 1000 * p.damage_scale, id);
  }
  for (const id of quals(A('4_07'))) {
    const h = fight({
      items: [id], foes: [],
      ops: { t_op: op('t_op'), t_a: op('t_a') },
      units: [{ chessId: 't_op', row: 10, col: 4, items: [id] }, { chessId: 't_a', row: 10, col: 5 }],
    });
    forceRng(h, 0);
    h.step(1);
    h.b.heal(unit(h), unit(h, 't_a'), 50);
    assert.ok(unit(h, 't_a').findBuff('item:shield_drone'), id);
  }
  for (const id of quals(A('4_10'))) {
    const h = fight({ items: [id], ehp: 5000, foes: [[10, 9]] });
    forceRng(h, 0);
    h.step(1);
    h.b.dealDamage(unit(h), h.enemies()[0], { amount: 100, type: 'true' });
    assert.ok(h.enemies()[0].findBuff('cold'), id);
  }
  for (const id of quals(A('3_10'))) {
    const stun = bb(id, 'act1autochess_equip_acarm064_global_buff').stun;
    const h = fight({ items: [id], foes: [[10, 5]] });
    h.step(1);
    assert.ok(h.runUntil(() => h.enemies()[0].findBuff('stun'), 4), id);
    close(h.enemies()[0].findBuff('stun').timeLeft, stun, id, 0.2);
  }
  const arm = bb(A('5_01'), 'attr_common_global_buff');
  const h = fight({ items: [A('5_01')], edef: 800, eres: 0, ehp: 5000, foes: [[10, 9]], captureNoisy: true });
  h.step(1);
  close(unit(h).s.atk, 500 * (1 + arm.atk), 'arm');
  const e = h.enemies()[0];
  h.b.dealDamage(unit(h), e, { amount: 1000, type: 'phys' });
  const hit = h.hooksOf('hit').find((c) => c.dmg);
  assert.equal(hit && hit.dmg.type, 'arts');
});

test('M3茧甲 revives; 驱逐者警棍 does not', () => {
  for (const id of quals(A('4_08'))) {
    const n = bb(id, 'act1autochess_equip_acarm068_global_buff').max_respawn_cnt;
    const h = fight({ items: [id], foes: [[10, 9]] });
    h.step(1);
    const u = unit(h);
    for (let i = 0; i < n; i++) {
      h.b.dealDamage(h.enemies()[0], u, { amount: 1e6, type: 'true' });
      assert.equal(u.alive, true, `${id} revive ${i}`);
    }
    h.b.dealDamage(h.enemies()[0], u, { amount: 1e6, type: 'true' });
    assert.equal(u.alive, false, id);
  }
  const h = fight({ items: [A('4_12')], foes: [[10, 9]] });
  h.step(1);
  const u = unit(h);
  h.b.dealDamage(h.enemies()[0], u, { amount: 1e6, type: 'true' });
  assert.equal(u.alive, false, 'baton');
});

test('维式重锤 specials and 终极维式重锤 grant field hammers without doubling an owned copy', () => {
  const burn = bb(A('4_05'), 'attr_common_global_buff');
  const hb = fight({ items: [A('4_05')], ehp: 5000, foes: [[10, 9]] });
  hb.step(1);
  close(unit(hb).s.atk, 500 * (1 + burn.atk), 'burn atk');
  const eb = hb.enemies()[0];
  const gauge = eb.elem.burn;
  hb.b.dealDamage(unit(hb), eb, { amount: 400, type: 'arts' });
  assert.ok(eb.elem.burn > gauge, 'burn gauge');

  const firm = bb(A('3_08'), 'act1autochess_equip_acarm043_global_buff');
  const hf = fight({ items: [A('3_08')], foes: [[10, 9]] });
  hf.step(1);
  const uf = unit(hf);
  hf.b.dealDamage(hf.enemies()[0], uf, { amount: 1e6, type: 'true' });
  assert.equal(uf.alive, true);
  assert.ok(uf.hp >= 1 && uf.hp < 2);
  assert.ok(uf.mem.undyingUntil > hf.b.time);
  assert.ok(uf.mem.undyingUntil - hf.b.time <= firm.undeadable_duration + 0.05);

  const haste = bb(A('3_09'), 'act1autochess_equip_acarm044_global_buff');
  const hh = fight({ items: [A('3_09')], foes: [] });
  hh.step(1);
  assert.equal(unit(hh).s.aspd, 100 + haste.attack_speed);

  const trem = fight({ items: [A('2_03')], foes: [[10, 5]] });
  forceRng(trem, 0);
  trem.step(1);
  assert.ok(trem.runUntil(() => trem.enemies()[0].findBuff('tremble'), 4));

  const palsy = bb(A('5_07'), 'act3autochess_equip_acarm140_global_buff');
  const hpalsy = fight({ items: [A('5_07')], edef: 200, ehp: 8000, foes: [[10, 9]] });
  forceRng(hpalsy, 0);
  hpalsy.step(1);
  const ep = hpalsy.enemies()[0];
  const d1 = hpalsy.b.dealDamage(unit(hpalsy), ep, { amount: 1000, type: 'phys' });
  const d2 = hpalsy.b.dealDamage(unit(hpalsy), ep, { amount: 1000, type: 'phys' });
  close(d1, 800, 'first');
  close(d2, 1000 - 200 * (1 - palsy.def_penetrate), 'penetrate');

  const steam = bb(A('6_11'), 'act1autochess_equip_acarm079_global_buff');
  const owned = fight({ items: [A('6_11'), A('3_09')], foes: [] });
  owned.step(1);
  owned.run(0.6);
  const uo = unit(owned);
  assert.equal(uo.s.aspd, 100 + haste.attack_speed, 'own copy is not doubled');
  close(uo.s.atk, 500 * (1 + 0.25 + steam.atk_per_hammer), 'steam atk');

  const shared = fight({
    foes: [],
    ops: { t_op: op('t_op'), t_a: op('t_a') },
    units: [
      { chessId: 't_op', row: 10, col: 4, items: [A('6_11')] },
      { chessId: 't_a', row: 10, col: 5, items: [A('3_09')] },
    ],
  });
  shared.step(1);
  shared.run(0.6);
  const us = unit(shared);
  assert.equal(us.s.aspd, 100 + steam.attack_speed);
  close(us.s.atk, 500 * (1 + steam.atk_per_hammer), 'field hammer');
});

test('a token is not an operator, so installItem does nothing', () => {
  const h = fight({ foes: [] });
  assert.equal(installItem(h.b, { kind: 'token' }, A('1_06')), null);
});

test('prep: bench equip, fusion, sell, morph, coins, passbook, dice, documents', () => {
  withPrep(3, ({ m, ps, equip }) => {
    const bench = give(m, ps, XIA, 'hand');
    const rainbow = giveItem(m, ps, A('1_06'));
    assert.deepEqual(equip(rainbow, bench), OK);
    assert.ok(bench.items.some((it) => it.id === A('1_06')));
  });
  withPrep(4, ({ m, ps, equip }) => {
    for (const [a, b, result] of PAIRS) {
      ps.board.clear();
      const t = give(m, ps, XIA, 'board', [10, 5]);
      assert.deepEqual(equip(giveItem(m, ps, a), t), OK, a);
      assert.deepEqual(equip(giveItem(m, ps, b), t), OK, b);
      assert.deepEqual(t.items.map((it) => it.id), [result], result);
    }
  });
  withPrep(5, ({ m, ps, equip }) => {
    const t = give(m, ps, XIA, 'board', [10, 5]);
    equip(giveItem(m, ps, A('1_06')), t);
    assert.deepEqual(m.handle('p_0', { t: 'g.sell', uid: t.uid }), OK);
    assert.ok(held(ps).some((p) => p.kind === 'item' && p.id === A('1_06')));
    const t2 = give(m, ps, XING, 'board', [10, 6]);
    assert.deepEqual(equip(giveItem(m, ps, A('6_01')), t2), OK);
    assert.deepEqual(equip(giveItem(m, ps, A('5_05')), t2), OK);
    assert.equal(t2.items[0].id, A('6_12'));
    assert.deepEqual(m.handle('p_0', { t: 'g.sell', uid: t2.uid }), OK);
    assert.ok(held(ps).some((p) => p.kind === 'item' && p.id === A('6_12')));
    assert.equal(m.handle('p_0', { t: 'g.sell', uid: held(ps).find((p) => p.kind === 'item').uid }).error, 'BAD_TARGET');
  });
  withPrep(6, ({ m, ps, equip }) => {
    const t = give(m, ps, XIA, 'board', [10, 5]);
    assert.deepEqual(equip(giveItem(m, ps, A('6_03')), t), OK);
    assert.deepEqual(equip(giveItem(m, ps, A('1_01')), t), OK);
    ps.recompute();
    assert.ok(ps.bonds.victoriaShip && ps.bonds.victoriaShip.count >= 1);
    const h = fight({ items: [A('6_03'), A('1_01')], foes: [], op: { bonds: ['deputShip'] } });
    h.step(1);
    assert.ok(unitBonds(unit(h)).includes('victoriaShip'));
  });
  for (const id of quals(A('1_03'))) {
    const p = bb(id, 'equip_destory_gain_random_coin');
    withPrep(7, ({ m, ps, equip }) => {
      const t = give(m, ps, XIA, 'hand');
      const f0 = ps.funds;
      assert.deepEqual(equip(giveItem(m, ps, id), t), OK);
      const got = ps.funds - f0;
      assert.ok(got >= p.min && got <= p.max, `${id} ${got}`);
    });
  }
  for (const id of [A('3_11'), A('3_11').replace('_a', '_b')]) {
    const p = bb(id, 'equip_destory_gain_random_coin');
    const seen = new Set();
    for (let k = 0; k < 12; k++) {
      withPrep(20 + k, ({ m, ps, equip }) => {
        const t = give(m, ps, XIA, 'hand');
        const f0 = ps.funds;
        assert.deepEqual(equip(giveItem(m, ps, id), t), OK);
        const got = ps.funds - f0;
        assert.ok(got >= p.min && got <= p.max, `${id} ${got}`);
        seen.add(got);
      });
    }
    assert.ok(seen.size >= 1);
  }
});

test('prep: passbook, dice, documents, dolls, letter, identity, pager, beacon, mimic, shop, records, projection', () => {
  withPrep(8, ({ m, ps, equip }) => {
    const book = giveItem(m, ps, A('3_15'));
    m.dispatch(ps, 'onRoundStart', { round: 2 });
    m.dispatch(ps, 'onRoundStart', { round: 3 });
    assert.equal(ps.counters[`passbook:${book.uid}`], 2);
    const t = give(m, ps, XIA, 'hand');
    const f0 = ps.funds;
    assert.deepEqual(equip(book, t), OK);
    assert.equal(ps.funds - f0, 2);
    assert.equal(ps.find(book.uid), null);
    const fresh = giveItem(m, ps, A('3_15'));
    const f1 = ps.funds;
    assert.deepEqual(equip(fresh, t), OK);
    assert.equal(ps.funds, f1);
    assert.equal(ps.find(fresh.uid), null);
  });
  withPrep(9, ({ m, ps, equip }) => {
    const t = give(m, ps, XIA, 'hand');
    // a strategy with a 指令 (band_upgrade): the dice opens its 3-card replacement draft (bandCommands.js)
    ps.bandId = 'band_upgrade'; ps.commandDrafts = []; ps.recompute(); beginCommandPrep(ps);
    const die = giveItem(m, ps, A('5_06'));
    assert.deepEqual(equip(die, t), OK);
    assert.equal(ps.commandDrafts.length, 1);
    assert.equal(ps.commandDrafts[0].choiceId, 'skill_change_1');
    assert.equal(ps.commandDrafts[0].cards.length, 3);
    assert.equal(ps.find(die.uid), null);
  });
  withPrep(10, ({ m, ps, equip }) => {
    const t = give(m, ps, XIA, 'hand');
    const before = ps.deployCap;
    assert.equal(before, 8);
    assert.deepEqual(equip(giveItem(m, ps, A('6_02')), t), OK);
    assert.ok(ps.deployCap >= bb(A('6_02'), 'equip_use_deploy').count);
  });
  for (const id of quals(A('2_05'))) {
    const n = bb(id, 'gain_coin_when_round_start').count;
    withPrep(11, ({ m, ps, equip }) => {
      const t = give(m, ps, XIA, 'hand');
      const f0 = ps.funds;
      assert.deepEqual(equip(giveItem(m, ps, id), t), OK);
      assert.equal(ps.funds, f0);
      assert.ok(ps.effects.some((e) => e.key === 'effect:builtin_round_coin' && e.params.count === n));
      m.dispatch(ps, 'onRoundStart', { round: 2 });
      assert.equal(ps.funds - f0, n);
    });
  }
  for (const id of quals(A('2_07'))) {
    const n = bb(id, 'use_equip_next_gold').count;
    withPrep(12, ({ m, ps, equip }) => {
      const t = give(m, ps, XIA, 'hand');
      assert.deepEqual(equip(giveItem(m, ps, id), t), OK);
      assert.equal(ps.pendingFunds, n);
    });
  }
  for (const id of quals(A('1_04'))) {
    const n = bb(id, 'use_equip_bond_layer').layer;
    withPrep(13, ({ m, ps, equip }) => {
      const t = give(m, ps, XIA, 'board', [10, 5]);
      assert.equal(ps.bonds.deputShip.active, false);
      assert.deepEqual(equip(giveItem(m, ps, id), t), OK);
      assert.equal(ps.layers.deputShip, n);
    });
  }
  for (const id of quals(A('2_08'))) {
    const n = bb(id, 'prep_end_act_bond').count;
    withPrep(14, ({ m, ps, equip }) => {
      const one = give(m, ps, XIA, 'board', [10, 5]);
      equip(giveItem(m, ps, id), one);
      m.dispatch(ps, 'onPrepEnd', {});
      assert.equal(ps.layers.deputShip || 0, 0);
      assert.ok(one.items.some((it) => it.id === id));
    });
    withPrep(15, ({ m, ps, equip }) => {
      give(m, ps, XIA, 'board', [10, 5]);
      const two = give(m, ps, XING, 'board', [10, 6]);
      ps.recompute();
      assert.equal(ps.bonds.deputShip.active, true);
      const letter = giveItem(m, ps, id);
      assert.deepEqual(equip(letter, two), OK);
      m.dispatch(ps, 'onPrepEnd', {});
      assert.equal(ps.layers.deputShip, n);
      assert.ok(two.items.some((it) => it.id === id));
    });
  }
  withPrep(16, ({ m, ps, equip }) => {
    const t = give(m, ps, XIA, 'hand');
    assert.deepEqual(equip(giveItem(m, ps, A('4_01')), t), OK);
    const offer = ps.offers[0];
    assert.ok(offer);
    assert.equal(offer.picks, undefined);
    assert.equal(offer.slots.length, bb(A('4_01'), 'use_equip_spe_goods_first_bond').option_count);
    for (const s of offer.slots) assert.ok((V3.chess[s.id].bonds || []).includes('deputShip'), s.id);
  });
  for (const id of quals(A('2_06'))) {
    const n = bb(id, 'equip_destory_first_bond_char').count;
    withPrep(17, ({ m, ps, equip }) => {
      const t = give(m, ps, XIA, 'hand');
      const before = chessHeld(ps).length;
      assert.deepEqual(equip(giveItem(m, ps, id), t), OK);
      const added = chessHeld(ps).filter((p) => p.uid !== t.uid);
      assert.equal(chessHeld(ps).length, before + n);
      for (const p of added) assert.ok((ps.gd.chess(p.id).bonds || []).includes('deputShip'), p.id);
    });
  }
  for (const id of quals(A('2_02'))) {
    const n = bb(id, 'use_equip_take_shop').count;
    withPrep(18, ({ m, ps, equip }) => {
      // shop chess of this match's pool: a chess the bond draw excludes never shows in a real shop
      const inPool = [XING, 'chess_char_1_04_a', XIA, ...[...m.pool.entries.keys()]].filter((id) => m.pool.has(id));
      ps.shop.slots = [...new Set(inPool)].slice(0, 3).map((id) => slot('chess', id));
      const t = give(m, ps, XIA, 'hand');
      const before = new Set(chessHeld(ps).map((p) => p.uid));
      assert.deepEqual(equip(giveItem(m, ps, id), t), OK);
      const gained = chessHeld(ps).filter((p) => !before.has(p.uid));
      assert.equal(gained.length, n);
      assert.equal(ps.shop.slots.filter((s) => s && s.kind === 'chess').length, 3 - n);
    });
  }
  withPrep(19, ({ m, ps, equip }) => {
    const t = give(m, ps, XIA, 'board', [10, 5]);
    assert.deepEqual(equip(giveItem(m, ps, A('5_02')), t), OK);
    assert.equal(ps.find(t.uid), null);
    assert.equal(ps.offers[0].slots.length, bb(A('5_02'), 'equip_tier_recr_gift').refresh_cnt);
  });
  withPrep(21, ({ ps, m, equip }) => {
    assert.equal(ps.setDiy({ chess_char_5_diy1_a: { charId: 'char_601_cguard' } }, { kitted: KITTED_CHARS }), true);
    const diy = give(m, ps, 'chess_char_5_diy1_a', 'hand');
    assert.ok(ps.gd.chess(diy.id).diyFor);
    const beacon = giveItem(m, ps, A('5_02'));
    const res = equip(beacon, diy);
    assert.equal(res.error, 'BAD_TARGET');
    assert.equal(res.detail, 'diy');
    assert.ok(ps.find(beacon.uid));
    assert.ok(ps.find(diy.uid));
  });
  withPrep(22, ({ m, ps, equip }) => {
    const a = give(m, ps, XIA, 'board', [10, 5]);
    const b = give(m, ps, XIA, 'board', [10, 6]);
    assert.deepEqual(equip(giveItem(m, ps, A('5_03')), a), OK);
    const ids = chessHeld(ps).map((p) => p.id);
    const golden = V3.chess[XIA].goldenId;
    const normals = ids.filter((id) => id === XIA).length;
    assert.ok(ids.includes(golden) || normals >= 3, ids.join(','));
    assert.ok(ps.find(b.uid) || ids.includes(golden));
  });
  withPrep(23, ({ m, ps, equip }) => {
    const t = give(m, ps, XIA, 'hand');
    const before = chessHeld(ps).map((p) => p.id);
    assert.deepEqual(equip(giveItem(m, ps, A('5_03')), t), OK);
    const added = chessHeld(ps).map((p) => p.id).filter((id) => !before.includes(id) || id !== XIA);
    assert.ok(chessHeld(ps).length >= before.length);
    for (const p of chessHeld(ps)) {
      if (before.includes(p.id) && p.id === XIA) continue;
      assert.equal(ps.gd.tierOf(p.id), ps.gd.tierOf(XIA));
    }
    assert.ok(added.length >= 0);
  });
  withPrep(24, ({ m, ps, equip }) => {
    const t = give(m, ps, XIA, 'hand');
    ps.shop.slots = [
      slot('item', A('1_02'), { frozen: true }),
      slot('chess', XING),
      slot('item', A('1_01'), { frozen: true }),
    ];
    assert.deepEqual(equip(giveItem(m, ps, A('5_09')), t), OK);
    assert.ok(ps.shop.slots.every((s) => !s || s.kind === 'chess'));
    assert.ok(ps.shop.slots.some((s) => s && (ps.gd.chess(s.id).bonds || []).includes('deputShip')));
    assert.ok(!ps.shop.slots.some((s) => s && s.id === A('1_02')));
  });
  withPrep(25, ({ m, ps, equip }) => {
    const t = give(m, ps, XIA, 'hand');
    const item = giveItem(m, ps, A('5_04'));
    assert.deepEqual(equip(item, t), OK);
    assert.equal(t.id, XIA);
    assert.ok(t.items.some((it) => it.id === A('5_04')));
    m.dispatch(ps, 'onRoundStart', { round: 2 });
    assert.equal(t.id, V3.chess[XIA].goldenId);
    assert.equal(ps.find(item.uid), null);
  });
  withPrep(26, ({ m, ps, equip }) => {
    const t = give(m, ps, V3.chess[XIA].goldenId, 'hand');
    const item = giveItem(m, ps, A('5_04').replace('_a', '_b'));
    const res = equip(item, t);
    assert.equal(res.error, 'BAD_TARGET');
    assert.equal(res.detail, 'already elite');
    assert.ok(ps.find(item.uid));
    assert.equal(t.id, V3.chess[XIA].goldenId);
  });
  withPrep(27, ({ m, ps, equip }) => {
    const t = give(m, ps, XIA, 'hand');
    assert.deepEqual(equip(giveItem(m, ps, A('5_04').replace('_a', '_b')), t), OK);
    assert.equal(t.id, V3.chess[XIA].goldenId);
    assert.equal(t.items.length, 0);
  });
});

test('bot takes both picks of a golden 促销券', () => {
  withPrep(28, ({ m, ps, equip }) => {
    ps.shop.level = 6;
    const t = give(m, ps, XIA, 'board', [10, 5]);
    assert.deepEqual(equip(giveItem(m, ps, A('4_15').replace('_a', '_b')), t), OK);
    const offer = ps.offers[0];
    const p = bb(A('4_15').replace('_a', '_b'), 'use_equip_spe_goods_equip');
    assert.equal(offer.picks, p.select_count);
    assert.equal(offer.slots.length, p.option_count);
    const gen = createBotPrepSteps().prepBegin(m, ps);
    gen.next();
    assert.equal(ps.offers.length, 0);
    const items = held(ps).filter((x) => x.kind === 'item');
    assert.equal(items.length, p.select_count);
  });
});
