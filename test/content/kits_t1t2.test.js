// Content tests for the tier 1 / tier 2 operator kits (server/sim/content/kits/tier1.js, tier2.js).
// Every chess (normal + elite where the elite adds something) runs a real battle through the harness and the test
// asserts its signature effect with numbers taken from the chess blackboards (data/chess.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, chessRec, checkInvariants } from '../helpers/battleHarness.js';
import { getDefaultSource } from '../../server/sim/simdata.js';
import { ELEMENT_GAUGE_MAX, PROJECTILE_SPEEDS, BOOMERANG_RETURN_SPEED } from '../../server/sim/constants.js';
import { sortEnemyTargets } from '../../server/sim/targeting.js';

const ds = getDefaultSource();
const raw = (id) => ds.rawChess(id);
const bbOf = (id) => raw(id).skill.bb;
const tal = (id, i = 0) => raw(id).talents.filter((t) => t.index !== -1)[i].bb;
const hid = (id) => Object.assign({}, ...raw(id).talents.filter((t) => t.index === -1).map((t) => t.bb));
const tbOf = (id) => raw(id).trait.bb;

const approx = (a, b, msg = '', rel = 1e-6) => assert.ok(Math.abs(a - b) <= rel * Math.max(1, Math.abs(b)), `${msg} ${a} ≈ ${b}`);
const dummy = (key, o = {}) => enemyRec({ key, hp: 1e7, speed: 0, ...o });
const READY = { sp: 999 }; // carryState: skill fully charged at deployment
const HOOKS = ['damaged', 'heal', 'skillStart', 'skillEnd', 'statusApplied', 'ammoUsed', 'attack', 'death', 'deploy'];

/** Battle with captured noisy hooks, no auto-finish, long time limit. */
function run(o) {
  return makeBattle({ seed: 7, autoFinish: false, timeLimit: 400, hooks: HOOKS, captureNoisy: true, ...o });
}
const dealt = (h, u, f = () => true) => h.hooksOf('damaged').filter((c) => c.source === u && f(c));
const statuses = (h, key, f = () => true) => h.hooksOf('statusApplied').filter((c) => c.status === key && f(c));
const heals = (h, u, f = () => true) => h.hooksOf('heal').filter((c) => c.source === u && f(c));
const tagged = (tag) => (c) => (c.dmg?.tags || []).includes(tag);
/** defs.chess override: the chess without its 特质 (garrisons have their own tests) — isolates kit damage numbers/types. */
const noGarrison = (id) => ({ [id]: { ...raw(id), garrisonIds: [] } });
const done = (h) => { checkInvariants(h.b); assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0])); };

// =================================================================================================================
// Tier 1

test('1_01 隐现: ammo skill (trigger_time rounds), ATK +atk, interval −30 %, taunt −1, prefers ranged enemies', () => {
  const id = 'chess_char_1_01_a', bb = bbOf(id);
  const h = run({
    defs: { enemies: { e_m: dummy('e_m'), e_r: dummy('e_r', { range: 3 }) } },
    units: [{ chessId: id, row: 10, col: 4 }],
    enemies: [{ key: 'e_m', pos: [10, 5] }, { key: 'e_r', pos: [10, 7] }],
  });
  const u = h.unit(id);
  assert.ok(h.runUntil(() => u.skill.active, 40));
  approx(u.s.atk, u.base.atk * (1 + bb.atk), 'ATK');
  approx(u.s.interval, u.base.bat * (1 + bb.base_attack_time) * 100 / u.s.aspd, 'interval');
  assert.equal(u.s.taunt, -1);
  const t0 = h.b.time;
  h.runUntil(() => !u.skill.active, 40);
  assert.equal(h.hooksOf('ammoUsed').filter((c) => c.unit === u).length, bb['attack@trigger_time']);
  const skillHits = dealt(h, u, (c) => c.t >= t0 && c.dmg.isAttack);
  assert.ok(skillHits.length > 0 && skillHits.every((c) => c.target.defId.endsWith('e_r')), 'the ranged enemy is shot first');
  done(h);
});

test('1_01 隐现 elite: +self_ammo after `duration` s on field; a random other 【拉特兰】 ammo operator +ally_ammo', () => {
  const id = 'chess_char_1_01_b', t = tal(id);
  const lat = chessRec({
    id: 't_lat', profession: 'SNIPER', subProfessionId: 'fastshot', bonds: ['lateranoShip'], rangeGrid: raw(id).rangeGrid,
    skill: { durationType: 'AMMO', duration: 0, spCost: 10, initSp: 0, bb: { 'attack@trigger_time': 5 } },
  });
  const starts = [];
  const h = run({
    defs: { enemies: { e: dummy('e') }, chess: { t_lat: lat } },
    units: [{ chessId: id, row: 10, col: 4 }, { chessId: 't_lat', row: 11, col: 4 }],
    enemies: [{ key: 'e', pos: [10, 6] }],
    setup: (b) => b.on('skillStart', (c) => starts.push({ id: c.unit.defId, ammo: c.skill.ammoLeft, t: b.time }), { priority: -500 }),
  });
  const u = h.unit(id);
  h.runUntil(() => u.skill.activations >= 2, 120);
  const mine = starts.filter((s) => s.id === id);
  assert.ok(mine[0].t < t.duration && mine[0].ammo === bbOf(id)['attack@trigger_time'], 'before 20 s: base magazine');
  assert.ok(mine[1].t >= t.duration);
  assert.equal(mine[1].ammo, bbOf(id)['attack@trigger_time'] + t.self_ammo);
  const ally = starts.filter((s) => s.id === 't_lat');
  assert.equal(ally[0].ammo, 5);
  const later = ally.find((s) => s.t > t.duration);
  assert.ok(later, 'ally cast again after 20 s');
  assert.equal(later.ammo, 5 + t.ally_ammo);
  done(h);
});

test('1_02 角峰: 抗寒体质 (重装 TAKE_DAMAGE) HP/DEF/RES ×(1+x); 雪原卫士 RES +flat (normal and elite)', () => {
  for (const id of ['chess_char_1_02_a', 'chess_char_1_02_b']) {
    const bb = bbOf(id), t = tal(id);
    const h = run({ defs: { enemies: { e: dummy('e', { atk: 100, bat: 1 }) } }, units: [{ chessId: id, row: 9, col: 5, carryState: READY }], enemies: [{ key: 'e', pos: [9, 5] }] });
    const u = h.unit(id);
    approx(u.s.res, u.base.res + t.magic_resistance, `${id} talent RES`);
    assert.ok(h.runUntil(() => u.skill.active, 3), 'cast by the first hit');
    assert.equal(h.hooksOf('skillStart').find((c) => c.unit === u).reason, 'TAKE_DAMAGE');
    approx(u.s.maxHp, u.base.maxHp * (1 + bb.max_hp), 'HP');
    approx(u.s.def, u.base.def * (1 + bb.def), 'DEF');
    approx(u.s.res, (u.base.res + t.magic_resistance) * (1 + bb.magic_resistance), 'RES');
    done(h);
  }
});

test('1_03 惊蛰: chain jumps lose no damage during 初雷 (ATK +atk); 通流无阻 ×atk_scale vs unblocked enemies', () => {
  const id = 'chess_char_1_03_a', bb = bbOf(id), t = tal(id);
  const mk = (carry) => run({
    defs: { enemies: { e: dummy('e') } },
    units: [{ chessId: id, row: 10, col: 4, carryState: carry }],
    enemies: [{ key: 'e', pos: [10, 5] }, { key: 'e', pos: [10, 6] }, { key: 'e', pos: [11, 6] }],
  });
  // before the skill: 100 % → 85 % → 72.25 %, all ×1.1 (unblocked)
  const h1 = mk(null);
  const u1 = h1.unit(id);
  h1.runUntil(() => dealt(h1, u1).length >= 3, 10);
  const a1 = dealt(h1, u1).slice(0, 3).map((c) => c.amount);
  approx(a1[0], u1.s.atk * t.atk_scale, 'primary');
  approx(a1[1], u1.s.atk * t.atk_scale * 0.85, 'jump 1');
  approx(a1[2], u1.s.atk * t.atk_scale * 0.85 * 0.85, 'jump 2');
  // skill: every jump at full damage, ATK +80 %
  const h2 = mk(READY);
  const u2 = h2.unit(id);
  h2.runUntil(() => dealt(h2, u2).length >= 3, 10);
  approx(u2.s.atk, u2.base.atk * (1 + bb.atk));
  for (const c of dealt(h2, u2).slice(0, 3)) approx(c.amount, u2.s.atk * t.atk_scale, 'no falloff');
  done(h1); done(h2);
});

test('1_04 深巡: fin darts pierce attack@max_target enemies on the line + 1 s 停顿; talent arts DoT (×2 vs 海怪)', () => {
  const id = 'chess_char_1_04_a', bb = bbOf(id), t = tal(id);
  const sea = dummy('e_sea');
  sea.tags = ['seamonster'];
  const h = run({
    defs: { enemies: { e: dummy('e'), e_sea: sea } },
    units: [{ chessId: id, row: 9, col: 4, carryState: READY }],
    enemies: [{ key: 'e_sea', pos: [9, 5] }, { key: 'e', pos: [9, 6] }, { key: 'e', pos: [9, 7] }],
  });
  const u = h.unit(id);
  h.step();
  // 技能策略 (issue #4; the deliberate deviation of DESIGN §21.29): an enemy inside her initial 2-2 range is enough — the
  // basic strategy casts it, no hit required
  assert.equal(u.skill.rule, 'DEFAULT', '行动能力剥夺 is an offensive ranged skill, not a 重装 TAKE_DAMAGE one');
  h.run(3.5);
  assert.ok(u.skill.active);
  assert.equal(h.hooksOf('skillStart').find((c) => c.unit === u).reason, 'DEFAULT', 'cast by the basic strategy');
  approx(u.s.atk, u.base.atk * (1 + bb.atk));
  const firstAtk = h.hooksOf('attack').find((c) => c.attacker === u && c.isSkill);
  assert.equal(firstAtk.targets.length, bb['attack@max_target'], 'hits every enemy of the line');
  const sl = statuses(h, 'sluggish', (c) => c.source === u);
  assert.ok(sl.length >= 3 && sl.every((c) => c.duration === bb['attack@sluggish']));
  const dots = dealt(h, u, tagged('dot'));
  assert.ok(dots.some((c) => c.target.defId.endsWith('e_sea') && Math.abs(c.amount - t.damage_seamonster) < 1e-6), '海怪 DoT');
  assert.ok(dots.some((c) => !c.target.defId.endsWith('e_sea') && Math.abs(c.amount - t.damage) < 1e-6), 'normal DoT');
  assert.ok(dots.every((c) => Math.abs(c.amount - (c.target.defId.endsWith('e_sea') ? t.damage_seamonster : t.damage)) < 1e-6));
  done(h);
});

test('1_04 深巡 / 1_20 雷蛇 S2 技能策略: both 哨戒铁卫 S2s cast with an enemy in range, no hit needed (issue #4)', () => {
  // both S2s are offensive (深巡: range up + ATK/ASPD + piercing darts; 雷蛇: ATK +125 % + arts on 3 + stun); the official
  // 下半 重装 row (TAKE_DAMAGE for every MANUAL 重装 skill) made both wait for a hit, and the owner's deliberate deviation
  // from it (DESIGN §21.29, after community feedback) gives them the basic strategy — the data and the kit say DEFAULT.
  for (const id of ['chess_char_1_04_a', 'chess_char_1_04_b', 'chess_char_1_20_a', 'chess_char_1_20_b']) {
    const h = run({ units: [{ chessId: id, row: 9, col: 4, carryState: READY }], enemies: [{ key: 'e', pos: [9, 6] }] });
    const u = h.unit(id);
    assert.equal(u.skill.rule, 'DEFAULT', `${id}: an offensive skill, not the 重装 TAKE_DAMAGE row`);
    assert.ok(h.runUntil(() => u.skill.activations >= 1, 5), `${id}: casts while an enemy is in range and untouched`);
    assert.equal(h.hooksOf('skillStart').find((c) => c.unit === u).reason, 'DEFAULT', `${id}: cast by the basic strategy`);
    done(h);
  }
});

test('1_04 深巡 / 1_20 雷蛇 elite module: stealthed enemies inside the range are revealed', () => {
  for (const id of ['chess_char_1_04_b', 'chess_char_1_20_b']) {
    const h = run({ defs: { enemies: { e: dummy('e') } }, units: [{ chessId: id, row: 9, col: 4 }], enemies: [{ key: 'e', pos: [9, 6] }] });
    h.step();
    const e = h.enemies()[0];
    h.b.applyStatus(e, 'stealth', { duration: 100 });
    h.run(0.5);
    assert.ok(e.s.flags.reveal, `${id} reveals`);
    done(h);
  }
});

test('1_05 红豆 (hidden): 槌音 ATK +atk; 蛮力穿刺 procs ATK +atk on single attacks; elite ×atk_scale vs low-HP enemies', () => {
  const id = 'chess_char_1_05_a', bb = bbOf(id), t = tal(id);
  const h = run({ defs: { enemies: { e: dummy('e') } }, units: [{ chessId: id, row: 9, col: 4 }], enemies: [{ key: 'e', pos: [9, 5] }] });
  const u = h.unit(id);
  h.runUntil(() => u.skill.activations >= 1 && !u.skill.active, 120);
  const ratios = new Set(dealt(h, u).map((c) => Math.round((c.amount / u.base.atk) * 1000) / 1000));
  const allowed = [1, 1 + t.atk, 1 + bb.atk, 1 + bb.atk + t.atk].map((x) => Math.round(x * 1000) / 1000);
  for (const r of ratios) assert.ok(allowed.includes(r), `ratio ${r}`);
  assert.ok(ratios.has(allowed[1]) || ratios.has(allowed[3]), 'a proc happened');
  assert.ok(ratios.has(allowed[2]) || ratios.has(allowed[3]), 'skill hits');
  done(h);

  const idb = 'chess_char_1_05_b', tb = tbOf(idb);
  const h2 = run({ defs: { enemies: { e: dummy('e') } }, units: [{ chessId: idb, row: 9, col: 4 }], enemies: [{ key: 'e', pos: [9, 5] }] });
  h2.step();
  const e = h2.enemies()[0];
  e.hp = e.s.maxHp * (tb.hp_ratio - 0.1);
  const u2 = h2.unit(idb);
  h2.run(5);
  const low = dealt(h2, u2, (c) => c.t > 0);
  assert.ok(low.length > 0 && low.every((c) => [1, 1 + tal(idb).atk].some((k) => Math.abs(c.amount - u2.base.atk * k * tb.atk_scale) < 1e-6)), 'elite ×1.15');
  done(h2);
});

test('1_06 刺玫: 荆藤庇荫 taunts the highest-HP ally in range and counters its attackers; 土壤基肥改良 heal bonus', () => {
  const id = 'chess_char_1_06_a', bb = bbOf(id), t = tal(id);
  const h = run({
    defs: { enemies: { e: dummy('e', { atk: 400, bat: 1 }) } },
    units: [{ chessId: id, row: 10, col: 3, carryState: READY }, { chessId: 'chess_char_1_02_a', row: 9, col: 5 }],
    enemies: [{ key: 'e', pos: [9, 5] }],
  });
  const u = h.unit(id), yak = h.unit('chess_char_1_02_a');
  h.run(4);
  assert.ok(u.skill.active);
  approx(u.s.atk, u.base.atk * (1 + bb.atk));
  assert.equal(yak.s.taunt, bb.taunt_level, 'protected ally taunts');
  const counters = dealt(h, u, tagged('counter'));
  assert.ok(counters.length >= 2);
  for (const c of counters) approx(c.amount, u.s.atk * bb.atk_scale, 'counter = 20 % ATK arts');
  assert.ok(heals(h, u).every((c) => c.target === yak), 'trait heal only on the protected ally during the skill');
  // talent: the highest max-HP ally in range receives more healing
  yak.hp = yak.s.maxHp * 0.3;
  approx(h.b.heal(null, yak, 100), 100 * t.heal_scale, 'heal ×1.08');
  h.runUntil(() => !u.skill.active, 20);
  assert.equal(yak.s.taunt, 0, 'taunt removed at the end');
  done(h);
});

test('1_07 普罗旺斯: 狼眼 +12 % ATK per 20 % HP lost (continuous, PRTS); 狩猎箭头 20 % procs to 140 %', () => {
  const id = 'chess_char_1_07_a', bb = bbOf(id), t = tal(id);
  const ratio = new Map(); // DamageInfo → target HP ratio when the hit landed (狼眼 reads it continuously)
  const h = run({
    defs: { enemies: { e: dummy('e') } }, units: [{ chessId: id, row: 10, col: 4 }], enemies: [{ key: 'e', pos: [10, 6] }],
    setup: (b) => b.on('hit', (c) => ratio.set(c.dmg, c.target.hpRatio), { priority: 1000 }),
  });
  h.step();
  const e = h.enemies()[0];
  e.hp = e.s.maxHp * 0.5;
  const u = h.unit(id);
  h.run(40);
  const kOf = (c) => 1 + ((1 - ratio.get(c.dmg)) / bb.hp_ratio_drop) * bb.atk_scale_up;
  const hits = dealt(h, u, (c) => c.t > 0);
  approx(kOf(hits[0]), 1 + 2.5 * bb.atk_scale_up, 'at 50 % HP: ×(1 + 2.5 × atk_scale_up), not 2 steps', 1e-3);
  let procs = 0;
  for (const c of hits) {
    const k = kOf(c);
    if (Math.abs(c.amount - u.s.atk * k * t.atk_scale) < 1e-6 * c.amount) procs++;
    else approx(c.amount, u.s.atk * k, 'passive');
  }
  assert.ok(procs > 0 && procs < hits.length, `procs ${procs}/${hits.length}`);
  done(h);
});

test('1_07 普罗旺斯: 狼眼 (an ATK increase) scales her attacks only, not fixed damage she sources (叙拉古 proc)', () => {
  for (const id of ['chess_char_1_07_a', 'chess_char_1_07_b']) {
    const bb = bbOf(id);
    const h = run({ defs: { enemies: { e: dummy('e') } }, units: [{ chessId: id, row: 10, col: 4 }], enemies: [{ key: 'e', pos: [10, 6] }] });
    h.step();
    const u = h.unit(id), e = h.enemies()[0];
    e.hp = e.s.maxHp * 0.3;
    const k = 1 + (0.7 / bb.hp_ratio_drop) * bb.atk_scale_up; // continuous: 3.5 × atk_scale_up at 30 % HP
    assert.ok(k > 1, `${id} 狼眼 active`);
    const fixed = h.b.dealDamage(u, e, { amount: 5000, type: 'true', canDodge: false, tags: ['bond:siracusa'] });
    approx(fixed, 5000, `${id} fixed true proc`);
    e.hp = e.s.maxHp * 0.3; // (狼眼 is continuous: back to exactly 30 % HP)
    // an attack instance (splash ⇒ no 狩猎箭头 roll) still gets the 狼眼 multiplier
    const atk = h.b.dealDamage(u, e, { amount: 1000, type: 'true', canDodge: false, isAttack: true, isSplash: true });
    approx(atk, 1000 * k, `${id} attack`);
    done(h);
  }
});

test('1_08 德克萨斯: 战术快递 +DP at start; 剑雨 +cost DP, 2×atk_scale arts on every enemy in the skill grid, stun', () => {
  const id = 'chess_char_1_08_a', bb = bbOf(id), t = tal(id);
  const h0 = run({ units: [{ chessId: id, row: 10, col: 5 }] });
  h0.step();
  approx(h0.b.players[0].dp, 10 + t.cost + h0.b.dt, 'initial DP');

  const h = run({
    defs: { enemies: { e: dummy('e') } },
    units: [{ chessId: id, row: 10, col: 5, carryState: READY }],
    enemies: [{ key: 'e', pos: [10, 6] }, { key: 'e', pos: [11, 5] }, { key: 'e', pos: [10, 9] }],
  });
  const u = h.unit(id);
  h.step();
  approx(h.b.players[0].dp, 10 + t.cost + bb.cost + h.b.dt, 'DP after 剑雨');
  const [near1, near2, far] = h.enemies();
  for (const e of [near1, near2]) {
    const d = dealt(h, u, (c) => c.target === e && c.dmg.isSkill);
    assert.equal(d.length, 2);
    for (const c of d) { assert.equal(c.type, 'arts'); approx(c.amount, u.s.atk * bb.atk_scale); }
    assert.ok(e.s.flags.stun);
  }
  assert.equal(dealt(h, u, (c) => c.target === far).length, 0);
  assert.ok(statuses(h, 'stun').every((c) => c.duration === bb.stun));
  done(h);
});

test('1_09 跃跃: 乐趣加倍 throws cnt boomerangs per attack, ATK +atk; 戏耍随心 procs; elite ×1.1 on adjacent enemies', () => {
  const id = 'chess_char_1_09_a', bb = bbOf(id), t = tal(id);
  const h = run({ defs: { enemies: { e: dummy('e') } }, units: [{ chessId: id, row: 10, col: 4, carryState: READY }], enemies: [{ key: 'e', pos: [10, 6] }] });
  const u = h.unit(id);
  h.run(6);
  assert.ok(u.skill.active);
  approx(u.s.atk, u.base.atk * (1 + bb.atk));
  const atks = h.hooksOf('attack').filter((c) => c.attacker === u && c.t < 5).length;
  const hits = dealt(h, u, (c) => c.t < 5);
  assert.equal(hits.length, atks * bb.cnt, 'cnt hits per attack');
  h.runUntil(() => !u.skill.active, 30);
  const all = dealt(h, u, (c) => c.dmg.isSkill);
  assert.ok(all.every((c) => Math.abs(c.amount - u.base.atk * (1 + bb.atk)) < 1e-6 || Math.abs(c.amount - u.base.atk * (1 + bb.atk) * t.atk_scale) < 1e-6));
  const procs = all.filter((c) => Math.abs(c.amount - u.base.atk * (1 + bb.atk) * t.atk_scale) < 1e-6).length;
  assert.ok(procs > 0 && procs < all.length, `procs ${procs}/${all.length}`);
  done(h);

  const idb = 'chess_char_1_09_b', tb = tbOf(idb), tb2 = tal(idb);
  const h2 = run({ defs: { enemies: { e: dummy('e') } }, units: [{ chessId: idb, row: 10, col: 4 }], enemies: [{ key: 'e', pos: [10, 5] }] });
  const u2 = h2.unit(idb);
  h2.run(5);
  const d2 = dealt(h2, u2);
  assert.ok(d2.length > 0 && d2.every((c) => [1, tb2.atk_scale].some((k) => Math.abs(c.amount - u2.s.atk * k * tb.atk_scale) < 1e-6)), 'adjacent ×1.1');
  done(h2);
});

test('1_09 跃跃 回环射手: each attack is a boomerang (out 15, back 3.75 tiles/s); faster than its flight she waits for the catch; 乐趣加倍 hits land together', () => {
  const id = 'chess_char_1_09_a', bb = bbOf(id);
  const flight = (d) => d / PROJECTILE_SPEEDS.boomerang + d / BOOMERANG_RETURN_SPEED;
  // ASPD +200 (interval 0.333 s) at 3 tiles: the out-and-back flight (1.0 s) sets the pace
  const h = run({
    defs: { enemies: { e: dummy('e') }, chess: noGarrison(id) }, units: [{ chessId: id, row: 10, col: 4 }], enemies: [{ key: 'e', pos: [10, 7] }],
    setup(b) { b.on('deploy', ({ unit }) => { if (unit.kind === 'op') b.addBuff(unit, { key: 'test:aspd', mods: { aspd: 200 } }); }); },
  });
  const u = h.unit(id);
  h.run(6);
  assert.ok(u.s.interval < flight(3) / 2);
  const at = h.hooksOf('attack').filter((c) => c.attacker === u).map((c) => c.t);
  assert.ok(at.length >= 4 && at.length <= 7, `${at.length} attacks in 6 s`);
  for (let i = 1; i < at.length; i++) assert.ok(Math.abs(at[i] - at[i - 1] - flight(3)) <= 2 * h.TICK, `gap ${(at[i] - at[i - 1]).toFixed(3)} ≈ ${flight(3)}`);
  assert.ok(h.eventsOf('atk').filter((e) => e[1] === u.id).every((e) => e[3] === 'boomerang'));
  done(h);
  // 乐趣加倍: cnt boomerangs on the same path — cnt hits at the same moment, then one catch
  const h2 = run({ defs: { enemies: { e: dummy('e') }, chess: noGarrison(id) }, units: [{ chessId: id, row: 10, col: 4, carryState: READY }], enemies: [{ key: 'e', pos: [10, 7] }] });
  const u2 = h2.unit(id);
  h2.run(5);
  assert.ok(u2.skill.active);
  const byT = new Map();
  for (const c of dealt(h2, u2, (x) => x.dmg.isSkill)) byT.set(c.t, (byT.get(c.t) ?? 0) + 1);
  assert.ok(byT.size >= 3 && [...byT.values()].every((n) => n === bb.cnt), `hits per landing ${[...byT.values()]}`);
  done(h2);
});

test('1_10 古米: 备用军粮 (自动触发: an injured ally of the skill range) heals the most injured nearby ally for heal_scale × ATK; elite low-HP bonus; pan stun', () => {
  for (const id of ['chess_char_1_10_a', 'chess_char_1_10_b']) {
    const bb = bbOf(id), tb = tbOf(id), t = tal(id);
    const h = run({
      defs: { enemies: { e: dummy('e', { atk: 300 }) } },
      units: [{ chessId: id, row: 9, col: 5, carryState: READY }, { chessId: 'chess_char_1_02_a', row: 10, col: 5 }],
      enemies: [{ key: 'e', pos: [9, 5] }],
    });
    const u = h.unit(id), yak = h.unit('chess_char_1_02_a');
    h.step();
    yak.hp = yak.s.maxHp * 0.3;
    h.runUntil(() => heals(h, u, (c) => c.target === yak).length > 0, 10);
    const hh = heals(h, u, (c) => c.target === yak)[0];
    const k = tb.hp_ratio != null ? tb.heal_scale : 1;
    approx(hh.amount, u.s.atk * bb.heal_scale * k, `${id} heal`);
    assert.equal(h.hooksOf('skillStart').find((c) => c.unit === u).reason, 'SKILL_RANGE');
    // talent: pan procs stun the enemy t.stun s
    h.runUntil(() => statuses(h, 'stun', (c) => c.source === u).length > 0, 200);
    const st = statuses(h, 'stun', (c) => c.source === u)[0];
    assert.equal(st.duration, t.stun);
    done(h);
  }
});

test('1_11 地灵 (hidden): ATK +atk; elite 地质勘探 lengthens the trait 停顿 by +sluggish', () => {
  const h = run({ defs: { enemies: { e: dummy('e') } }, units: [{ chessId: 'chess_char_1_11_a', row: 10, col: 4, carryState: READY }], enemies: [{ key: 'e', pos: [10, 5] }] });
  const u = h.unit('chess_char_1_11_a');
  h.step();
  approx(u.s.atk, u.base.atk * (1 + bbOf('chess_char_1_11_a').atk));
  done(h);
  const idb = 'chess_char_1_11_b';
  const h2 = run({ defs: { enemies: { e: dummy('e') } }, units: [{ chessId: idb, row: 10, col: 4 }], enemies: [{ key: 'e', pos: [10, 5] }] });
  h2.run(2);
  const s = statuses(h2, 'sluggish', (c) => c.source === h2.unit(idb));
  assert.ok(s.length > 0);
  approx(s[0].duration, tbOf(idb).sluggish + tal(idb).sluggish, 'sluggish 1.3 s');
  done(h2);
});

test('1_12 艾丝黛尔: 舍身突击 ATK +atk and no healing from others; 自愈能力 heals on nearby kills; elite phys −20 % above 50 %', () => {
  const id = 'chess_char_1_12_a', bb = bbOf(id), t = tal(id);
  const h = run({ defs: { enemies: { e: dummy('e') } }, units: [{ chessId: id, row: 9, col: 5, carryState: READY }], enemies: [{ key: 'e', pos: [9, 6] }] });
  const u = h.unit(id);
  h.step();
  assert.ok(u.skill.active);
  approx(u.s.atk, u.base.atk * (1 + bb.atk));
  u.hp = u.s.maxHp * 0.5;
  assert.equal(h.b.heal(null, u, 100), 0, 'not a heal target during the skill');
  // talent: an enemy falling on a surrounding tile heals hp_ratio × max HP
  const weak = h.spawn('e', { pos: [10, 6] });
  const before = u.hp;
  h.b.kill(weak, null);
  approx(u.hp - before, u.s.maxHp * t.hp_ratio, 'self heal');
  const far = h.spawn('e', { pos: [9, 9] });
  const b2 = u.hp;
  h.b.kill(far, null);
  assert.equal(u.hp, b2, 'no heal for distant deaths');
  done(h);

  const idb = 'chess_char_1_12_b', tb = tbOf(idb);
  const h2 = run({ defs: { enemies: { e: dummy('e', { atk: 600, bat: 1 }) } }, units: [{ chessId: idb, row: 9, col: 5 }], enemies: [{ key: 'e', pos: [9, 5] }] });
  const u2 = h2.unit(idb);
  h2.runUntil(() => h2.hooksOf('damaged').some((c) => c.target === u2), 5);
  const hit = h2.hooksOf('damaged').find((c) => c.target === u2);
  approx(hit.amount, (600 - u2.s.def) * (1 - tb.damage_resistance), 'elite −20 %');
  done(h2);
});

test('1_13 波登可: 孢子扩散 cloud — projectile_delay_time pulses of atk_scale × ATK arts + 停顿 + silence; 园丁 SUPPORT ATK aura', () => {
  const id = 'chess_char_1_13_a', bb = bbOf(id), t = tal(id);
  const h = run({
    defs: { enemies: { e: dummy('e') } },
    units: [{ chessId: id, row: 10, col: 4, carryState: READY }, { chessId: 'chess_char_1_11_a', row: 12, col: 3 }],
    enemies: [{ key: 'e', pos: [10, 6] }, { key: 'e', pos: [11, 6] }, { key: 'e', pos: [10, 9] }],
  });
  const u = h.unit(id), goat = h.unit('chess_char_1_11_a');
  h.run(8);
  approx(u.s.atk, u.base.atk * (1 + t.atk), 'self is SUPPORT');
  approx(goat.s.atk, goat.base.atk * (1 + t.atk), 'other SUPPORT');
  const [a, b, far] = h.enemies();
  // PRTS 备注 "孢子群范围半径为0.9": the vial lands on one enemy; the next tile (centre distance 1) is outside 0.9 and inside the old 1.2
  const zone = h.eventsOf('fx').find((e) => e[1] === 'zone' && e[4]?.skill === 'spores');
  assert.equal(zone[4].radius, 0.9);
  let inside = 0;
  for (const e of [a, b, far]) {
    const d = Math.hypot(e.x - zone[2], e.y - zone[3]);
    const z = dealt(h, u, (c) => c.target === e && (c.dmg.tags || []).includes('zone'));
    if (d <= 0.9) {
      inside++;
      assert.equal(z.length, bb.projectile_delay_time, 'one pulse per second');
      for (const c of z) approx(c.amount, u.s.atk * bb.atk_scale);
      assert.ok(statuses(h, 'silence', (c) => c.target === e).length > 0 && statuses(h, 'sluggish', (c) => c.target === e).length > 0);
    } else assert.equal(z.length, 0, `outside 0.9 (d=${d})`);
  }
  assert.equal(inside, 1, 'only the enemy the vial landed on');
  done(h);

  // elite module: +sp_recovery_per_sec SP/s while an enemy is in range
  const idb = 'chess_char_1_13_b', mb = hid(idb);
  const sp = (withEnemy) => {
    const hh = run({ defs: { enemies: { e: dummy('e') } }, units: [{ chessId: idb, row: 10, col: 4 }], enemies: [{ key: 'e', pos: withEnemy ? [10, 5] : [9, 9] }] });
    hh.run(5);
    return hh.unit(idb).skill.sp;
  };
  approx(sp(true) - sp(false), 5 * mb.sp_recovery_per_sec, 'module SP', 1e-3);
});

test('1_14 格雷伊: 静电场 停顿 on the attacked target, ×talent_scale during 静电释放 (ASPD +attack_speed)', () => {
  const id = 'chess_char_1_14_a', bb = bbOf(id), t = tal(id);
  const h1 = run({ defs: { enemies: { e: dummy('e') } }, units: [{ chessId: id, row: 10, col: 4 }], enemies: [{ key: 'e', pos: [10, 6] }] });
  h1.run(1);
  approx(statuses(h1, 'sluggish', (c) => c.source === h1.unit(id))[0].duration, t.sluggish);
  const h2 = run({ defs: { enemies: { e: dummy('e') } }, units: [{ chessId: id, row: 10, col: 4, carryState: READY }], enemies: [{ key: 'e', pos: [10, 6] }] });
  h2.run(1);
  const u = h2.unit(id);
  assert.ok(u.skill.active);
  approx(u.s.aspd - u.base.aspd, bb.attack_speed);
  approx(statuses(h2, 'sluggish', (c) => c.source === u)[0].duration, t.sluggish * bb.talent_scale);
  done(h1); done(h2);
});

test('1_15 盟约·辅助干员 (hidden): 迭代元素 18 % ATK 神经 + 灼燃 + 凋亡 per damage; skill 2 targets + ASPD; elite boost vs ELITE', () => {
  const id = 'chess_char_1_15_a', bb = bbOf(id), t = tal(id);
  const h = run({ defs: { enemies: { e: dummy('e') } }, units: [{ chessId: id, row: 10, col: 4, carryState: READY }], enemies: [{ key: 'e', pos: [10, 5] }, { key: 'e', pos: [10, 6] }] });
  const u = h.unit(id);
  h.run(2);
  assert.ok(u.skill.active);
  approx(u.s.aspd - u.base.aspd, bb.attack_speed);
  assert.equal(h.hooksOf('attack').find((c) => c.attacker === u).targets.length, bb['attack@max_target']);
  const el = dealt(h, u, (c) => c.type === 'element');
  assert.ok(el.length >= 6);
  // every damage she deals attaches all three, in the official order (神经 "（优先）", then 灼燃, then 凋亡)
  for (let i = 0; i + 2 < el.length; i += 3) assert.deepEqual(el.slice(i, i + 3).map((c) => c.dmg.element), ['neural', 'burn', 'apoptosis']);
  for (const c of el) approx(c.amount, u.s.atk * t.ep_damage_ratio);
  done(h);

  const idb = 'chess_char_1_15_b', tb = tal(idb);
  const h2 = run({ defs: { enemies: { e: dummy('e', { rank: 'ELITE' }) } }, units: [{ chessId: idb, row: 10, col: 4 }], enemies: [{ key: 'e', pos: [10, 5] }] });
  h2.run(1);
  const u2 = h2.unit(idb);
  approx(dealt(h2, u2, (c) => c.type === 'element')[0].amount, u2.s.atk * tb.ep_damage_ratio_boss, 'elite rank');
  done(h2);
});

for (const [idA, idB] of [['chess_char_1_16_a', 'chess_char_1_16_b'], ['chess_char_2_19_a', 'chess_char_2_19_b']]) {
  test(`${idA.slice(11, 15)} 锡人: “大拉里” zone — ground enemies take atk_scale × ATK arts/s, allies heal; elite 凋敝魂灵 + module SP`, () => {
    const bb = bbOf(idA);
    const flyer = dummy('e_fly', { motion: 'FLY' });
    const h = run({
      defs: { enemies: { e: dummy('e'), e_fly: flyer } },
      units: [{ chessId: idA, row: 10, col: 4, carryState: READY }, { chessId: 'chess_char_1_02_a', row: 10, col: 6 }],
      enemies: [{ key: 'e', pos: [10, 5] }, { key: 'e_fly', pos: [10, 5] }],
    });
    const u = h.unit(idA), yak = h.unit('chess_char_1_02_a');
    h.step();
    yak.hp = yak.s.maxHp * 0.3;
    h.run(bb.projectile_delay_time + 1);
    const [g, f] = h.enemies();
    const z = dealt(h, u, (c) => c.target === g && (c.dmg.tags || []).includes('zone'));
    assert.equal(z.length, bb.projectile_delay_time);
    for (const c of z) approx(c.amount, u.s.atk * bb.atk_scale);
    assert.equal(dealt(h, u, (c) => c.target === f && (c.dmg.tags || []).includes('zone')).length, 0, 'air units unaffected');
    const zh = heals(h, u, (c) => c.target === yak);
    assert.equal(zh.length, bb.projectile_delay_time);
    for (const c of zh) approx(c.amount, u.s.atk * bb.hp_recovery_per_sec_ratio);
    done(h);

    const bbB = bbOf(idB), w = tal(idB, 1)['skill@damage_scale'], mb = hid(idB);
    const h2 = run({ defs: { enemies: { e: dummy('e') } }, units: [{ chessId: idB, row: 10, col: 4 }], enemies: [{ key: 'e', pos: [10, 5] }] });
    const u2 = h2.unit(idB);
    h2.runUntil(() => u2.skill.activations === 1, 30);
    const sp0 = u2.skill.sp, t0 = h2.b.time;
    h2.run(4);
    approx((u2.skill.sp - sp0) / (h2.b.time - t0), u2.s.spRecovery + mb.sp_recovery_per_sec, 'SP rate with a unit on the field', 1e-3);
    const z2 = dealt(h2, u2, (c) => (c.dmg.tags || []).includes('zone'));
    assert.ok(z2.length >= 4);
    for (const c of z2) approx(c.amount, u2.s.atk * bbB.atk_scale * w, '×damage_scale');
    done(h2);
  });
}

test('1_17 深靛: 光影迷宫 interval ×0.7, bound enemies take 12 % ATK every 0.5 s and are never targeted; 柔光缚目 binds', () => {
  const id = 'chess_char_1_17_a', bb = bbOf(id), t = tal(id);
  const h = run({ defs: { enemies: { e: dummy('e') } }, units: [{ chessId: id, row: 10, col: 4, carryState: READY }], enemies: [{ key: 'e', pos: [10, 6] }, { key: 'e', pos: [10, 7] }] });
  const u = h.unit(id);
  h.step();
  assert.ok(u.skill.active);
  approx(u.s.interval, u.base.bat * bb.base_attack_time, 'interval');
  const [a, b] = h.enemies();
  h.b.applyStatus(a, 'bind', { duration: 30 });
  h.b.applyStatus(b, 'bind', { duration: 0.01 }); // b is free again right away
  const t0 = h.b.time;
  h.run(6);
  const dot = dealt(h, u, (c) => c.t > t0 && (c.dmg.tags || []).includes('dot'));
  assert.ok(dot.length >= 10 && dot.every((c) => c.target === a || c.target.s.flags.bind));
  for (const c of dot.filter((c) => c.target === a)) approx(c.amount, u.s.atk * bb['indigo_s_2[damage].atk_scale']);
  const atks = h.hooksOf('attack').filter((c) => c.attacker === u && c.t > t0);
  assert.ok(atks.length > 0 && atks.every((c) => !c.targets.includes(a)), 'bound enemy never targeted');
  done(h);
  // talent binds happen (prob × talent_scale during the skill), duration from the talent
  const h2 = run({ defs: { enemies: { e: dummy('e') } }, units: [{ chessId: id, row: 10, col: 4 }], enemies: [{ key: 'e', pos: [10, 6] }, { key: 'e', pos: [10, 7] }, { key: 'e', pos: [11, 6] }] });
  h2.runUntil(() => statuses(h2, 'bind').length > 0, 200);
  assert.equal(statuses(h2, 'bind')[0].duration, t.duration);
  done(h2);
});

test('1_18 宴: 落地斩·破门 −50 % HP, ATK +atk and arts damage for `duration` s; 认真模式 ASPD; elite 庇护 below 50 %', () => {
  const id = 'chess_char_1_18_a', bb = bbOf(id), t = tal(id);
  // kit semantics in isolation: her 特质 garrison_01 (弱点伤害) would re-type every hit by the target's DEF/RES
  const h = run({ defs: { enemies: { e: dummy('e', { def: 200 }) }, chess: noGarrison(id) }, units: [{ chessId: id, row: 9, col: 5 }], enemies: [{ key: 'e', pos: [9, 6] }] });
  const u = h.unit(id);
  h.step();
  const expAs = t.min_attack_speed * Math.min(1, (1 - u.hpRatio) / (1 - t.min_hp_ratio));
  assert.ok(Math.abs(u.s.aspd - u.base.aspd - expAs) <= 0.5, `坚忍 ASPD ${u.s.aspd}`);
  h.run(bb.duration + 3);
  const hits = dealt(h, u, (c) => c.dmg.isAttack);
  assert.ok(hits.filter((c) => c.t < bb.duration - 0.1).every((c) => c.type === 'arts'));
  assert.ok(hits.filter((c) => c.t > bb.duration + 0.1).length > 0 && hits.filter((c) => c.t > bb.duration + 0.1).every((c) => c.type === 'phys'));
  done(h);

  const idb = 'chess_char_1_18_b', tb = tal(idb);
  const h2 = run({ defs: { enemies: { e: dummy('e', { atk: 900, bat: 1 }) } }, units: [{ chessId: idb, row: 9, col: 5 }], enemies: [{ key: 'e', pos: [9, 5] }] });
  const u2 = h2.unit(idb);
  h2.step();
  u2.hp = u2.s.maxHp * 0.2;
  const n0 = h2.hooksOf('damaged').length;
  h2.runUntil(() => h2.hooksOf('damaged').slice(n0).some((c) => c.target === u2), 3);
  const hit = h2.hooksOf('damaged').slice(n0).find((c) => c.target === u2);
  approx(hit.amount, (900 - u2.s.def) * (1 - tb.damage_resistance), '庇护');
  done(h2);
});

test('1_19 野鬃: 夹枪冲锋 wider range, ATK +atk, pushes targets away; elite 一致向前 cuts dead 【近卫】 redeploy cost', () => {
  const id = 'chess_char_1_19_a', bb = bbOf(id);
  const h = run({ defs: { enemies: { e: dummy('e') } }, units: [{ chessId: id, row: 9, col: 4, carryState: READY }], enemies: [{ key: 'e', pos: [9, 5] }] });
  const u = h.unit(id);
  h.run(3);
  assert.ok(u.skill.active);
  approx(u.s.atk, u.base.atk * (1 + bb.atk));
  const e = h.enemies()[0];
  assert.ok(e.x >= 6.5, `pushed to x=${e.x}`);
  assert.ok(h.eventsOf('fx').some((f) => f[1] === 'displace'));
  done(h);

  const idb = 'chess_char_1_19_b', t = tal(idb);
  const h2 = run({ units: [{ chessId: idb, row: 9, col: 4 }, { chessId: 'chess_char_1_12_a', row: 9, col: 6 }], flags: { dpInit: 99 } });
  h2.step();
  const wm = h2.unit(idb), est = h2.unit('chess_char_1_12_a');
  const cost0 = est.base.cost;
  h2.b.kill(est, null);
  h2.b.kill(wm, null);
  h2.b.redeploy(wm);
  assert.equal(est.base.cost, cost0 + t.value, 'undeployed 近卫 costs 1 less');
  h2.b.redeploy(est);
  assert.equal(est.base.cost, cost0, 'the discount is consumed by the deployment');
  done(h2);
});

test('1_20 雷蛇: 反击电弧 arts on up to 3 enemies, self-stun `stun` s afterwards; 战术防御 SP on hits; elite 雷抗', () => {
  const id = 'chess_char_1_20_a', bb = bbOf(id);
  const h = run({
    defs: { enemies: { e: dummy('e'), atk: dummy('atk', { atk: 200 }) } },
    units: [{ chessId: id, row: 9, col: 4, carryState: READY }],
    enemies: [{ key: 'atk', pos: [9, 4] }, { key: 'e', pos: [9, 5] }, { key: 'e', pos: [9, 6] }],
  });
  const u = h.unit(id);
  h.run(3);
  assert.ok(u.skill.active);
  assert.equal(h.hooksOf('skillStart').find((c) => c.unit === u).reason, 'DEFAULT', 'an offensive skill: cast with an enemy in range');
  approx(u.s.atk, u.base.atk * (1 + bb.atk));
  approx(u.s.interval, u.base.bat * (1 + bb.base_attack_time) * 100 / u.s.aspd, 'attack interval +70 % (PRTS 增大(+70%): a ratio, not +0.7 s)');
  const a0 = h.hooksOf('attack').find((c) => c.attacker === u && c.isSkill);
  assert.equal(a0.targets.length, 3);
  assert.ok(dealt(h, u, (c) => c.dmg.isAttack && c.dmg.isSkill).every((c) => c.type === 'arts'));
  h.runUntil(() => !u.skill.active, 30);
  h.step();
  const st = statuses(h, 'stun', (c) => c.target === u);
  assert.equal(st.length, 1);
  assert.equal(st[0].duration, bb.stun);
  done(h);

  // talent: each hit taken gives +sp to herself and to a random neighbour
  const t = tal(id);
  const mate = chessRec({ id: 't_mate', profession: 'WARRIOR', rangeGrid: [[0, 0]], skill: { spType: 'INCREASE_WHEN_ATTACK', spCost: 50 } });
  const h2 = run({ defs: { enemies: { atk: dummy('atk', { atk: 200 }) }, chess: { t_mate: mate } }, units: [{ chessId: id, row: 9, col: 4 }, { chessId: 't_mate', row: 10, col: 4 }], enemies: [{ key: 'atk', pos: [9, 4] }] });
  h2.run(6.1);
  const hitsTaken = h2.hooksOf('damaged').filter((c) => c.target === h2.unit(id) && c.source?.side === 'enemy').length;
  assert.ok(hitsTaken >= 2);
  approx(h2.unit('t_mate').skill.sp, hitsTaken * t.sp, 'neighbour SP');
  done(h2);
  const h3 = run({ units: [{ chessId: 'chess_char_1_20_b', row: 9, col: 4 }] });
  const lb = h3.unit('chess_char_1_20_b');
  approx(lb.s.res, lb.base.res + tal('chess_char_1_20_b', 1).magic_resistance);
});

// =================================================================================================================
// Tier 2

test('2_01 送葬人: 最终旅程 double hits and shorter interval; 终结改装 ignores def_penetrate_fixed DEF', () => {
  const id = 'chess_char_2_01_a', bb = bbOf(id), t = tal(id), tb = tbOf(id);
  const h = run({ defs: { enemies: { e: dummy('e', { def: 100 }) } }, units: [{ chessId: id, row: 10, col: 4, carryState: READY }], enemies: [{ key: 'e', pos: [10, 5] }] });
  const u = h.unit(id);
  h.run(3);
  assert.ok(u.skill.active);
  approx(u.s.interval, (u.base.bat + bb.base_attack_time) * 100 / u.s.aspd, 'base attack time −0.5 s (flat seconds)');
  const atks = h.hooksOf('attack').filter((c) => c.attacker === u && c.t < 2.5).length;
  const hits = dealt(h, u, (c) => c.t < 2.5);
  assert.equal(hits.length, 2 * atks);
  for (const c of hits) approx(c.amount, u.s.atk * tb.atk_scale - Math.max(0, 100 - t.def_penetrate_fixed), 'front column ×1.5, DEF ignored');
  done(h);
});

test('2_02 赫默: 医疗无人机 lands on the tile its piece was placed on and expires; 强化注射 MEDIC ASPD; elite ×1.15 on ground units', () => {
  const id = 'chess_char_2_02_a', t = tal(id);
  // the drone is a hand piece the player placed next to the ally (user playtest #6); S2 brings it there
  const h = run({ units: [{ chessId: id, row: 10, col: 4, carryState: READY, uid: 1 }, { chessId: 'chess_char_1_02_a', row: 9, col: 6 }, { chessId: 'chess_char_2_14_a', row: 12, col: 4 },
    { kind: 'token', tokenId: 'token_10000_silent_healrb', ownerUid: 1, row: 9, col: 5 }] });
  const u = h.unit(id), yak = h.unit('chess_char_1_02_a'), fl = h.unit('chess_char_2_14_a');
  h.step();
  yak.hp = yak.s.maxHp * 0.3;
  h.run(1);
  approx(u.s.aspd - u.base.aspd, t.attack_speed);
  approx(fl.s.aspd - fl.base.aspd, t.attack_speed, 'other medic');
  approx(yak.s.aspd, yak.base.aspd, 'non-medic unaffected');
  const drone = h.b.allyUnits.find((x) => x.kind === 'token');
  assert.ok(drone && drone.alive, 'drone deployed');
  assert.deepEqual([drone.tileR, drone.tileC], [9, 5], 'on its placed tile, next to the injured ally');
  assert.ok(drone.s.flags.untargetable);
  h.run(10);
  assert.equal(drone.alive, false, 'self-destructs after its lifetime');
  assert.ok(drone.stats.heal > 0);
  done(h);

  const idb = 'chess_char_2_02_b', tb = tbOf(idb);
  const h2 = run({ units: [{ chessId: idb, row: 10, col: 4 }, { chessId: 'chess_char_1_02_a', row: 9, col: 6 }] });
  const s2 = h2.unit(idb), y2 = h2.unit('chess_char_1_02_a');
  h2.step();
  y2.hp = y2.s.maxHp * 0.3;
  h2.runUntil(() => heals(h2, s2, (c) => c.target === y2).length > 0, 10);
  approx(heals(h2, s2, (c) => c.target === y2)[0].amount, s2.s.atk * tb.heal_scale, 'ground unit heal');
  done(h2);
});

test('2_03 崖心 (hidden): 束缚链 drags max_target enemies to the front tile, true damage, stun; 雪境猎手; elite drag damage', () => {
  const id = 'chess_char_2_03_a', bb = bbOf(id), t = tal(id);
  const h = run({ defs: { enemies: { e: dummy('e') } }, units: [{ chessId: id, row: 10, col: 4, carryState: READY }], enemies: [{ key: 'e', pos: [10, 7] }, { key: 'e', pos: [11, 7] }, { key: 'e', pos: [9, 7] }] });
  const u = h.unit(id);
  h.step();
  approx(u.s.atk, u.base.atk * (1 + t.atk), 'not blocking: ATK +6 %');
  const pulled = h.enemies().filter((e) => e.x < 6);
  assert.equal(pulled.length, bb.max_target);
  for (const e of pulled) {
    // 中力 vs weight 1 (受力等级 0): "必定拉至身前" — to the 急停 radius 0.6708 around her centre (PRTS 推与拉)
    approx(Math.hypot(e.x - 4, e.y - 10), 0.6708, `at her front (${e.x},${e.y})`, 1e-6);
    const tr = dealt(h, u, (c) => c.target === e && c.type === 'true');
    assert.equal(tr.length, 1);
    approx(tr[0].amount, u.s.atk * bb.atk_scale);
    assert.ok(statuses(h, 'stun', (c) => c.target === e && c.duration === bb.stun).length === 1);
  }
  done(h);
  // blocking an enemy removes the talent buff
  const h2 = run({ defs: { enemies: { e: dummy('e') } }, units: [{ chessId: id, row: 10, col: 4 }], enemies: [{ key: 'e', pos: [10, 4] }] });
  h2.run(0.5);
  approx(h2.unit(id).s.atk, h2.unit(id).base.atk, 'blocking');
  // elite module: arts damage proportional to the dragged distance
  const idb = 'chess_char_2_03_b', tb = tbOf(idb);
  const h3 = run({ defs: { enemies: { e: dummy('e') } }, units: [{ chessId: idb, row: 10, col: 4, carryState: READY }], enemies: [{ key: 'e', pos: [10, 7] }] });
  h3.step();
  const drag = dealt(h3, h3.unit(idb), tagged('drag'));
  assert.equal(drag.length, 1);
  approx(drag[0].amount, tb.value * (3 - 0.6708) / tb.dist, 'value per dist tiles', 0.06);
  done(h3);
});

test('2_04 小满: 乡音沉沉 sleeps 3 enemies, holds fire while they sleep, then ASPD +x on 3 targets; 好好听话', () => {
  const id = 'chess_char_2_04_a', bb = bbOf(id), t = tal(id);
  const h = run({ defs: { enemies: { e: dummy('e') } }, units: [{ chessId: id, row: 10, col: 4, carryState: READY }], enemies: [{ key: 'e', pos: [10, 5] }, { key: 'e', pos: [10, 6] }, { key: 'e', pos: [11, 5] }, { key: 'e', pos: [9, 5] }] });
  const u = h.unit(id);
  h.run(bb.sleep + 3);
  const sl = statuses(h, 'sleep');
  assert.equal(sl.length, bb.max_target);
  assert.ok(sl.every((c) => c.duration === bb.sleep));
  const start = h.hooksOf('skillStart').find((c) => c.unit === u).t;
  const atk = h.hooksOf('attack').filter((c) => c.attacker === u);
  assert.equal(atk.filter((c) => c.t > start + 1e-9 && c.t < start + bb.sleep - 1e-9).length, 0, 'no attack while they sleep');
  const after = atk.filter((c) => c.t >= start + bb.sleep);
  assert.ok(after.length > 0 && after.some((c) => c.targets.length === bb.max_target));
  approx(u.s.aspd - u.base.aspd, bb.attack_speed + t.attack_speed);
  done(h);
  // 野生动物 (infection tag): trait 停顿 +sluggish_addition
  const beast = dummy('e_b');
  beast.tags = ['infection'];
  const h2 = run({ defs: { enemies: { e: dummy('e'), e_b: beast } }, units: [{ chessId: id, row: 10, col: 4 }], enemies: [{ key: 'e_b', pos: [10, 5] }] });
  h2.run(1);
  approx(statuses(h2, 'sluggish')[0].duration, tbOf(id).sluggish + t.sluggish_addition);
  done(h2);
});

test('2_05 哈洛德: 重症优先 heals the heaviest element load first with ×trait_scale recovery; 我即军营 element resistance', () => {
  const id = 'chess_char_2_05_a', bb = bbOf(id), t = tal(id);
  const h = run({ units: [{ chessId: id, row: 10, col: 4, carryState: READY }, { chessId: 'chess_char_1_02_a', row: 10, col: 5 }, { chessId: 'chess_char_1_10_a', row: 11, col: 5 }] });
  const u = h.unit(id), low = h.unit('chess_char_1_02_a'), elem = h.unit('chess_char_1_10_a');
  h.step();
  low.hp = low.s.maxHp * 0.3;
  elem.elem.neural = 900;
  h.step();
  const first = h.hooksOf('attack').find((c) => c.attacker === u);
  assert.equal(first.targets[0], elem, 'element-damaged ally first');
  approx(elem.elem.neural, 900 - u.s.atk * tbOf(id).ep_heal_ratio * bb.trait_scale, 'recovery ×1.6');
  h.run(0.3);
  // 我即军营 cuts the 元素损伤 (gauge fill) of an ally over half, on the hit itself — not elemTakenMul (元素伤害 / 元素脆弱)
  assert.ok(elem.elem.neural > 500, 'still over half');
  const b0 = elem.elem.burn;
  h.b.dealDamage(null, elem, { type: 'element', element: 'burn', amount: 100 });
  approx(elem.elem.burn - b0, 100 * (1 - t.ep_damage_resistance), '我即军营');
  approx(elem.s.elemTakenMul, 1, 'no 元素伤害 / 元素脆弱 change');
  // under half: no cut
  const n0 = low.elem.neural;
  h.b.dealDamage(null, low, { type: 'element', element: 'neural', amount: 100 });
  approx(low.elem.neural - n0, 100, 'gauge under half: full fill');
  done(h);
});

test('2_05 哈洛德 (user playtest #5 #3): 侵蚀 counts as element damage for 重症优先 and 我即军营', () => {
  const id = 'chess_char_2_05_a', t = tal(id);
  const h = run({ units: [{ chessId: id, row: 10, col: 4, carryState: READY }, { chessId: 'chess_char_1_02_a', row: 10, col: 5 }, { chessId: 'chess_char_1_10_a', row: 11, col: 5 }] });
  const u = h.unit(id), low = h.unit('chess_char_1_02_a'), eroded = h.unit('chess_char_1_10_a');
  h.step();
  low.hp = low.s.maxHp * 0.3;
  eroded.elem.erosion = 900;
  h.step();
  const first = h.hooksOf('attack').find((c) => c.attacker === u);
  assert.equal(first.targets[0], eroded, 'the eroded ally is the heaviest element load');
  const e0 = eroded.elem.erosion;
  h.b.dealDamage(null, eroded, { type: 'element', element: 'erosion', amount: 100 });
  approx(eroded.elem.erosion - e0, 100 * (1 - t.ep_damage_resistance), '我即军营 on an eroded ally over half');
  done(h);
});

test('2_06 莎草: 巧思乍现 next heal heal_scale × ATK; 博览古卷 barrier scale × ATK (×shield_scale_skill from the skill)', () => {
  const id = 'chess_char_2_06_a', bb = bbOf(id), t = tal(id);
  const h = run({ units: [{ chessId: id, row: 10, col: 4, carryState: READY }, { chessId: 'chess_char_1_02_a', row: 10, col: 5 }] });
  const u = h.unit(id), yak = h.unit('chess_char_1_02_a');
  h.step();
  yak.hp = yak.s.maxHp * 0.2;
  h.step();
  const hh = heals(h, u)[0];
  approx(hh.amount, u.s.atk * bb.heal_scale, 'skill heal');
  approx(yak.findBuff('papyrs:shield').shield, u.s.atk * t['attack@scale'] * bb.shield_scale_skill, 'skill barrier');
  done(h);
  const h2 = run({ units: [{ chessId: id, row: 10, col: 4 }, { chessId: 'chess_char_1_02_a', row: 10, col: 5 }] });
  const u2 = h2.unit(id), y2 = h2.unit('chess_char_1_02_a');
  h2.step();
  y2.hp = y2.s.maxHp * 0.2;
  h2.step();
  approx(heals(h2, u2)[0].amount, u2.s.atk);
  approx(y2.findBuff('papyrs:shield').shield, u2.s.atk * t['attack@scale'], 'talent barrier');
  assert.equal(y2.findBuff('papyrs:shield').timeLeft <= t['attack@shield_duration'], true);
  done(h2);
});

test('2_07 幽灵鲨: 肉斩骨断 HP ≥ 1 while active, stun `stun` s afterwards; HP talent; elite regen and ×1.1 vs blocked', () => {
  const id = 'chess_char_2_07_a', bb = bbOf(id), t = tal(id);
  const h = run({ defs: { enemies: { e: dummy('e', { atk: 3000, bat: 0.5 }) } }, units: [{ chessId: id, row: 9, col: 5, carryState: READY }], enemies: [{ key: 'e', pos: [9, 5] }] });
  const u = h.unit(id);
  approx(u.s.maxHp, u.base.maxHp * (1 + t.max_hp), 'HP +10 %');
  h.step();
  assert.ok(u.skill.active);
  approx(u.s.atk, u.base.atk * (1 + bb.atk));
  h.runUntil(() => !u.skill.active, 20);
  const end = h.hooksOf('skillEnd').find((x) => x.unit === u);
  assert.ok(end && end.reason === 'duration', 'the skill ran its full duration');
  assert.ok(!h.hooksOf('death').some((c) => c.unit === u && c.t < end.t), 'no death during the skill');
  assert.ok(h.hooksOf('damaged').filter((c) => c.target === u).length >= 10, 'kept taking lethal hits');
  assert.equal(statuses(h, 'stun', (c) => c.target === u)[0]?.duration, bb.stun);
  done(h);

  const idb = 'chess_char_2_07_b', tb2 = tal(idb), tb = tbOf(idb);
  const h2 = run({ defs: { enemies: { e: dummy('e') } }, units: [{ chessId: idb, row: 9, col: 5 }], enemies: [{ key: 'e', pos: [9, 5] }] });
  const u2 = h2.unit(idb);
  h2.run(2);
  approx(u2.s.hpRegen, u2.s.maxHp * tb2.hp_recovery_per_sec_by_max_hp_ratio);
  for (const c of dealt(h2, u2)) approx(c.amount, u2.s.atk * tb.atk_scale, 'blocked ×1.1');
  done(h2);
});

test('2_08 泡泡: “挨打” no attacks, DEF +def, taunt, counter atk_scale × DEF phys; 尖刺盾 ATK −5 %; elite DEF while blocking', () => {
  const id = 'chess_char_2_08_a', bb = bbOf(id), t = tal(id);
  const h = run({ defs: { enemies: { e: dummy('e', { atk: 300, bat: 1 }) } }, units: [{ chessId: id, row: 9, col: 5, carryState: READY }], enemies: [{ key: 'e', pos: [9, 5] }] });
  const u = h.unit(id);
  h.run(5);
  assert.ok(u.skill.active);
  approx(u.s.def, u.base.def * (1 + bb.def));
  assert.equal(u.s.taunt, bb.taunt_level);
  const t0 = h.hooksOf('skillStart').find((c) => c.unit === u).t;
  assert.equal(h.hooksOf('attack').filter((c) => c.attacker === u && c.t > t0).length, 0, 'stops attacking');
  const counters = dealt(h, u, tagged('counter'));
  assert.ok(counters.length >= 3);
  for (const c of counters) approx(c.amount, u.s.def * bb.atk_scale);
  const e = h.enemies()[0];
  approx(e.s.atk, e.base.atk * (1 + t.atk), 'spike');
  done(h);
  const idb = 'chess_char_2_08_b';
  const h2 = run({ defs: { enemies: { e: dummy('e') } }, units: [{ chessId: idb, row: 9, col: 5 }], enemies: [{ key: 'e', pos: [9, 5] }] });
  h2.run(0.2);
  const u2 = h2.unit(idb);
  approx(u2.s.def, u2.base.def * (1 + tbOf(idb).def), 'blocking');
  done(h2);
});

test('2_09 休谟斯: 高效处理 block +1 and 精力充沛 by HP thresholds; 再回收 overflow healing becomes a barrier', () => {
  const id = 'chess_char_2_09_a', bb = bbOf(id), t = tal(id);
  const h = run({ defs: { enemies: { e: dummy('e') } }, units: [{ chessId: id, row: 9, col: 5, carryState: READY }], enemies: [{ key: 'e', pos: [9, 6] }] });
  const u = h.unit(id);
  h.step();
  assert.ok(u.skill.active);
  assert.equal(u.s.blockCnt, u.base.blockCnt + bb.block_cnt);
  approx(u.s.atk, u.base.atk * (1 + bb['humus_s_2[peak_2].peak_performance.atk']), '>80 %');
  u.hp = u.s.maxHp * 0.65;
  h.step();
  approx(u.s.atk, u.base.atk * (1 + bb['humus_s_2[peak_1].peak_performance.atk']), '>50 %');
  u.hp = u.s.maxHp * 0.3;
  h.step();
  approx(u.s.atk, u.base.atk, '≤50 %');
  // 再回收
  u.hp = u.s.maxHp;
  const sh0 = u.findBuff('humus:recycle')?.shield ?? 0;
  h.b.heal(u, u, 300, { self: true });
  approx(u.findBuff('humus:recycle').shield - sh0, 300, 'overflow → barrier');
  h.b.heal(u, u, 1e5, { self: true });
  approx(u.findBuff('humus:recycle').shield, u.s.maxHp * t.max_hp_ratio, 'capped');
  done(h);
});

test('2_10 洛洛: 自负此轭 ASPD; 过载 half-way ATK +atk and funnel cap ×scale; stun as long as the overload; 立于磐石', () => {
  const id = 'chess_char_2_10_a', bb = bbOf(id), t = tal(id);
  const h = run({ defs: { enemies: { e: dummy('e') } }, units: [{ chessId: id, row: 10, col: 4, carryState: READY }], enemies: [{ key: 'e', pos: [10, 6] }] });
  const u = h.unit(id);
  const cap0 = u.profile.funnel.max;
  h.step();
  assert.ok(u.skill.active);
  approx(u.s.aspd - u.base.aspd, bb.attack_speed);
  const D = u.skill.duration;
  h.run(D / 2 + 0.2);
  approx(u.profile.funnel.max, cap0 * bb.scale, 'overload cap');
  approx(u.s.atk, u.base.atk * (1 + bb.atk + t.atk * Math.floor(h.b.time / t.interval)), 'overload ATK + rock stacks');
  h.runUntil(() => !u.skill.active, D);
  h.step();
  approx(u.profile.funnel.max, cap0, 'restored');
  const st = statuses(h, 'stun', (c) => c.target === u)[0];
  approx(st.duration, D / 2, 'stun = overload time', 0.01);
  h.run(15);
  approx(u.s.atk, u.base.atk * (1 + t.atk * t.max_stack_cnt), 'rock stacks capped');
  done(h);
});

test('2_11 风丸: 纸艺·双影 −50 % HP, ATK +atk, summons the <替身> whose entrance deals damage_scale × its ATK; substitution too', () => {
  const id = 'chess_char_2_11_a', bb = bbOf(id), t = tal(id);
  const h = run({ defs: { enemies: { e: dummy('e') } }, units: [{ chessId: id, row: 9, col: 5, carryState: READY }], enemies: [{ key: 'e', pos: [9, 6] }, { key: 'e', pos: [9, 9] }] });
  const u = h.unit(id);
  h.step();
  assert.ok(u.skill.active);
  approx(u.hpRatio, 1 - bb.hp_ratio, 'HP loss');
  approx(u.s.atk, u.base.atk * (1 + bb.atk));
  const doll = h.b.allyUnits.find((x) => x.kind === 'token');
  assert.ok(doll && doll.alive && doll.defId === 'token_10022_kazema_shadow');
  const [near, far] = h.enemies();
  const burst = h.hooksOf('damaged').filter((c) => c.source === doll && (c.dmg.tags || []).includes('talent'));
  assert.equal(burst.length, 1);
  assert.equal(burst[0].target, near);
  approx(burst[0].amount, doll.s.atk * t.damage_scale);
  assert.equal(h.hooksOf('damaged').filter((c) => c.target === far).length, 0);
  h.runUntil(() => !u.skill.active, 30);
  h.step();
  assert.equal(doll.alive, false, 'the <替身> leaves with the skill');
  done(h);
  // trait substitution also sets off 折纸生花 (token ATK)
  const h2 = run({ defs: { enemies: { e: dummy('e', { atk: 5000, bat: 1 }) } }, units: [{ chessId: id, row: 9, col: 5 }], enemies: [{ key: 'e', pos: [9, 5] }] });
  const u2 = h2.unit(id);
  h2.runUntil(() => u2.findBuff('trait:substitute'), 20);
  h2.step();
  const tokAtk = ds.getToken('token_10022_kazema_shadow', id).stats.atk;
  const b2 = dealt(h2, u2, tagged('talent'));
  assert.equal(b2.length, 1);
  approx(b2[0].amount, tokAtk * t.damage_scale);
  done(h2);
});

test('2_12 砾: 鼠群 barrier hp_ratio × max HP decaying over `duration` s; 快速部署 cost −1; elite 小个子支援 DEF aura', () => {
  const id = 'chess_char_2_12_a', bb = bbOf(id), t = tal(id);
  const h = run({ units: [{ chessId: id, row: 9, col: 5 }] });
  const u = h.unit(id);
  assert.equal(u.base.cost, raw(id).stats.cost + t.cost);
  h.step();
  const full = u.s.maxHp * bb.hp_ratio;
  assert.equal(u.skill.kind, 'duration');
  assert.equal(u.skill.active, true);
  assert.equal(u.skill.ready, false);
  assert.deepEqual(h.snapshot().units.find((t) => t[0] === u.id).slice(5, 7), [Math.round(u.skill.timeLeft * 10) / 10, bb.duration]);
  approx(u.s.shield, full, 'full barrier', 1e-2);
  h.run(bb.duration / 2 + 0.5);
  approx(u.s.shield, full / 2, 'half decayed', 1e-2);
  h.run(0.4);
  approx(u.s.shield, full / 2, 'PRTS: the capacity steps once per second', 1e-2);
  h.run(bb.duration / 2);
  assert.equal(u.s.shield, 0);
  assert.equal(u.skill.active, false);
  assert.equal(u.skill.ready, false);
  assert.equal(u.findBuff('gravel:rats'), null);
  done(h);
  // PRTS "受到伤害后，剩余容量根据屏障最大容量等比变化": a damaged barrier shrinks in proportion, not to the capacity
  const hd = run({ units: [{ chessId: id, row: 9, col: 5 }] });
  const ud = hd.unit(id);
  hd.step();
  const cap0 = ud.s.shield;
  hd.b.dealDamage(null, ud, { amount: cap0 * 0.6, type: 'true' });
  approx(ud.s.shield, cap0 * 0.4, 'absorbed', 1e-3);
  hd.run(bb.duration / 2 + 0.5);
  approx(ud.s.shield, cap0 * 0.4 / 2, 'remaining × capacity ratio (a plain cap would keep 40 %)', 1e-2);
  assert.ok(ud.hp === ud.s.maxHp);
  hd.b.retreat(ud);
  assert.equal(ud.findBuff('gravel:rats'), null);
  assert.equal(ud.skill.active, false);
  assert.ok(hd.b.redeploy(ud, { free: true }));
  approx(ud.skill.timeLeft, bb.duration);
  approx(ud.s.shield, cap0, 'fresh shield on redeployment');
  done(hd);
  const idb = 'chess_char_2_12_b', tb = tal(idb);
  const cheapRec = chessRec({ id: 't_cheap', stats: { cost: tb['cond.cost'] } });
  const h2 = run({ defs: { chess: { t_cheap: cheapRec } }, units: [{ chessId: idb, row: 9, col: 5 }, { chessId: 't_cheap', row: 10, col: 4 }, { chessId: 'chess_char_1_08_a', row: 11, col: 4 }] });
  h2.step();
  const cheap = h2.unit('t_cheap'), dear = h2.unit('chess_char_1_08_a'), g = h2.unit(idb);
  assert.ok(raw('chess_char_1_08_a').stats.cost > tb['cond.cost']);
  approx(g.s.def, g.base.def * (1 + tb.def), 'self (cost 8)');
  approx(cheap.s.def, cheap.base.def * (1 + tb.def), 'cost ≤ cond.cost');
  approx(dear.s.def, dear.base.def, 'expensive unit unaffected');
  done(h2);
});

test('2_13 蒂比: an incoming attack triggers 紧急赶场通知 and is dodged; airborne blocks flyers only; 片场工作指南 dodge', () => {
  const id = 'chess_char_2_13_a', bb = bbOf(id), t = tal(id);
  const h = run({
    defs: { enemies: { e: dummy('e', { atk: 400, bat: 1 }), f: dummy('f', { motion: 'FLY' }) } },
    units: [{ chessId: id, row: 9, col: 5, carryState: READY }], enemies: [{ key: 'e', pos: [9, 5] }],
  });
  const u = h.unit(id);
  h.step();
  const e = h.enemies()[0];
  assert.equal(e.blockedBy, u, 'ground enemy blocked before takeoff');
  h.runUntil(() => u.skill.active, 3);
  assert.equal(h.hooksOf('skillStart').find((c) => c.unit === u).reason, 'TAKE_DAMAGE');
  assert.equal(u.stats.taken, 0, 'the triggering hit was dodged');
  approx(u.s.atk, u.base.atk * (1 + bb.atk));
  assert.equal(u.s.flags.liftoff, true, 'airborne (起飞)');
  assert.equal(u.ground, true, 'still a ground unit on her low tile');
  h.step();
  assert.equal(e.blockedBy, null, 'airborne: ground enemies are released');
  const fl = h.spawn('f', { pos: [9, 5] });
  h.step();
  assert.equal(fl.blockedBy, u, 'airborne: flyers are blocked');
  h.run(3);
  const atk = h.hooksOf('attack').filter((c) => c.attacker === u && c.isSkill);
  const hits = dealt(h, u, (c) => c.dmg.isAttack && c.dmg.isSkill);
  assert.ok(atk.length > 0);
  assert.equal(hits.length, 3 * atk.length, '3 shots per attack');
  h.runUntil(() => !u.skill.active, 20);
  h.step();
  assert.equal(fl.blockedBy, null, 'landed: flyers released');
  done(h);
  // talent: the first attack after stack_time s without being attacked is dodged, the next one lands
  const h2 = run({ defs: { enemies: { e: dummy('e', { atk: 400, bat: 1 }) } }, units: [{ chessId: id, row: 9, col: 5 }], enemies: [{ key: 'e', pos: [9, 5] }] });
  const u2 = h2.unit(id);
  h2.run(0.9);
  assert.equal(u2.stats.taken, 0, 'first attack dodged');
  h2.run(1.5);
  assert.ok(u2.stats.taken > 0, 'second attack lands');
  assert.ok(t.stack_time > 0);
  done(h2);
});

test('2_14 调香师: 精调 ATK +atk / ASPD −50; 熏衣草 heals every ally atk_to_hp_recovery_ratio × ATK per s; elite heals 4', () => {
  const id = 'chess_char_2_14_a', bb = bbOf(id), t = tal(id);
  const h = run({ units: [{ chessId: id, row: 10, col: 4, carryState: READY }, { chessId: 'chess_char_1_02_a', row: 9, col: 9 }, { chessId: 'chess_char_1_10_a', row: 10, col: 5 }] });
  const u = h.unit(id), far = h.unit('chess_char_1_02_a'), near = h.unit('chess_char_1_10_a');
  h.step();
  far.hp = far.s.maxHp * 0.3;
  near.hp = near.s.maxHp * 0.3;
  h.run(3.1);
  assert.ok(u.skill.active);
  approx(u.s.atk, u.base.atk * (1 + bb.atk));
  approx(u.s.aspd, u.base.aspd + bb.attack_speed);
  const aura = heals(h, u, (c) => c.target === far);
  assert.equal(aura.length, 3, 'one pulse per second, out of range too');
  for (const c of aura) approx(c.amount, u.s.atk * t.atk_to_hp_recovery_ratio);
  done(h);
  const idb = 'chess_char_2_14_b';
  const ids = ['chess_char_1_02_a', 'chess_char_1_10_a', 'chess_char_1_12_a', 'chess_char_2_07_a', 'chess_char_1_18_a'];
  const h2 = run({ units: [{ chessId: idb, row: 10, col: 4 }, ...ids.map((c, i) => ({ chessId: c, row: [9, 10, 11, 9, 11][i], col: [4, 5, 5, 5, 4][i] }))] });
  h2.step();
  for (const c of ids) { const x = h2.unit(c); x.hp = x.s.maxHp * 0.4; }
  h2.runUntil(() => h2.hooksOf('attack').some((c) => c.attacker === h2.unit(idb)), 5);
  assert.equal(h2.hooksOf('attack').find((c) => c.attacker === h2.unit(idb)).targets.length, hid(idb)['attack@max_target']);
  done(h2);
});

test('2_15 协律 (hidden): 震爆调谐 sonic booms at other operators in range; 律脉同构 ATK; elite distance scaling', () => {
  const id = 'chess_char_2_15_a', bb = bbOf(id), t = tal(id);
  const h = run({ defs: { enemies: { e: dummy('e') } }, units: [{ chessId: id, row: 10, col: 3 }, { chessId: 'chess_char_1_02_a', row: 10, col: 5 }], enemies: [{ key: 'e', pos: [10, 5] }, { key: 'e', pos: [10, 8] }] });
  const u = h.unit(id);
  h.step();
  approx(u.s.atk, u.base.atk * (1 + t.atk), 'another operator in range');
  done(h);
  const h2 = run({ defs: { enemies: { e: dummy('e') } }, units: [{ chessId: id, row: 10, col: 3, carryState: READY }, { chessId: 'chess_char_1_02_a', row: 10, col: 5 }], enemies: [{ key: 'e', pos: [10, 5] }, { key: 'e', pos: [10, 8] }] });
  const u2 = h2.unit(id);
  h2.run(3);
  assert.ok(u2.skill.active);
  approx(u2.s.atk, u2.base.atk * (1 + t.atk + bb.atk));
  const sonic = dealt(h2, u2, tagged('sonic'));
  assert.ok(sonic.length >= 1 && sonic.every((c) => c.target === h2.enemies()[0]));
  for (const c of sonic) approx(c.amount, u2.s.atk * bb['attack@aoe_atk_scale']);
  done(h2);
  const idb = 'chess_char_2_15_b', tb = tbOf(idb);
  const h3 = run({ defs: { enemies: { e: dummy('e') } }, units: [{ chessId: idb, row: 10, col: 3 }], enemies: [{ key: 'e', pos: [10, 3 + tb.max_dist] }] });
  h3.run(1);
  const u3 = h3.unit(idb);
  approx(dealt(h3, u3)[0].amount, u3.s.atk * (1 + tb.damage_scale), 'max distance ×1.1');
  done(h3);
});

test('2_16 拉普兰德: 狼魂 arts on one extra target without the ranged ×0.8; 精神摧毁 silence; elite +10 % arts', () => {
  const id = 'chess_char_2_16_a', bb = bbOf(id), t = tal(id), tb = tbOf(id);
  const h = run({ defs: { enemies: { e: dummy('e') } }, units: [{ chessId: id, row: 9, col: 4 }], enemies: [{ key: 'e', pos: [9, 6] }, { key: 'e', pos: [9, 7] }] });
  const u = h.unit(id);
  h.run(1);
  const first = dealt(h, u)[0];
  assert.equal(first.type, 'phys');
  approx(first.amount, u.s.atk * tb.atk_scale, 'ranged ×0.8');
  assert.equal(statuses(h, 'silence', (c) => c.source === u)[0].duration, t.duration);
  h.runUntil(() => u.skill.active, 60);
  h.run(2);
  approx(u.s.atk, u.base.atk * (1 + bb.atk));
  const s0 = h.hooksOf('skillStart').find((c) => c.unit === u).t;
  const sk = dealt(h, u, (c) => c.t > s0 + 0.05);
  assert.ok(sk.length >= 2 && sk.every((c) => c.type === 'arts'));
  for (const c of sk) approx(c.amount, u.s.atk, 'no ranged reduction');
  assert.ok(h.hooksOf('attack').filter((c) => c.attacker === u && c.t > s0).some((c) => c.targets.length === 2));
  done(h);
  const idb = 'chess_char_2_16_b', tbb = tbOf(idb);
  const h2 = run({ defs: { enemies: { e: dummy('e') } }, units: [{ chessId: idb, row: 9, col: 4 }], enemies: [{ key: 'e', pos: [9, 6] }] });
  h2.run(1);
  const u2 = h2.unit(idb);
  approx(dealt(h2, u2, tagged('module'))[0].amount, u2.s.atk * tbb.atk_scale_m);
  done(h2);
});

test('2_17 折桠: 生存决心 trembles ground enemies around, ATK/DEF up, hits all blocked; 简易包扎 heal at the end; elite −15 %', () => {
  const id = 'chess_char_2_17_a', bb = bbOf(id), t = tal(id);
  // the blocked enemy and the ranged one next to her can attack (atk > 0), so 战栗 is observable
  const h = run({
    defs: { enemies: { e: dummy('e', { atk: 50, bat: 1 }), r: dummy('r', { atk: 50, bat: 1, range: 2 }) } },
    units: [{ chessId: id, row: 9, col: 5, carryState: READY }], enemies: [{ key: 'e', pos: [9, 5] }, { key: 'r', pos: [10, 6] }, { key: 'e', pos: [9, 8] }],
  });
  const u = h.unit(id);
  assert.ok(h.runUntil(() => u.skill.active, 2), '重装 TAKE_DAMAGE: cast by the first hit');
  approx(u.s.atk, u.base.atk * (1 + bb.atk));
  approx(u.s.def, u.base.def * (1 + bb.def));
  const [blk, adj, far] = h.enemies();
  for (const e of [blk, adj]) assert.equal(statuses(h, 'tremble', (c) => c.target === e)[0]?.duration, bb.not_combat);
  assert.equal(statuses(h, 'tremble', (c) => c.target === far).length, 0);
  assert.ok(blk.s.flags.tremble && !blk.s.flags.fear, '战栗 (not 恐惧)');
  assert.equal(blk.blockedBy, u);
  const a0 = blk.stats.attacks, r0 = adj.stats.attacks;
  h.run(Math.min(2, bb.not_combat - 0.2));
  assert.equal(blk.stats.attacks, a0, '战栗: the blocked enemy cannot attack');
  assert.ok(adj.stats.attacks > r0, '战栗 only stops attacks while blocked: the unblocked ranged enemy keeps shooting');
  h.run(bb.not_combat);
  assert.ok(!blk.s.flags.tremble && blk.stats.attacks > a0, 'after not_combat s the blocked enemy attacks again');
  u.hp = u.s.maxHp * 0.3;
  h.runUntil(() => !u.skill.active, 20);
  const end = heals(h, u, (c) => c.target === u && (c.opts?.tags || []).includes('talent'));
  assert.equal(end.length, 1);
  approx(end[0].amount, u.s.maxHp * t.hp_ratio);
  done(h);
  const idb = 'chess_char_2_17_b', tb = tbOf(idb);
  const h2 = run({ defs: { enemies: { e: dummy('e', { atk: 1500, bat: 1 }) } }, units: [{ chessId: idb, row: 9, col: 5 }], enemies: [{ key: 'e', pos: [9, 5] }] });
  const u2 = h2.unit(idb);
  h2.runUntil(() => h2.hooksOf('damaged').some((c) => c.target === u2), 3);
  approx(h2.hooksOf('damaged').find((c) => c.target === u2).amount, (1500 - u2.s.def) * tb.damage_scale, 'blocked attacker −15 %');
  done(h2);
});

test('2_18 灰毫: 炮术研习 ATK +atk (ground surroundings: ashlok_t_1.atk); skill ATK +atk cast with an enemy in range (DEFAULT, DESIGN §21.29); elite ×1.1 vs blocked', () => {
  const id = 'chess_char_2_18_a', bb = bbOf(id), t = tal(id);
  const h = run({ units: [{ chessId: id, row: 10, col: 5 }, { chessId: 'chess_char_2_18_b', row: 10, col: 3 }] });
  h.step();
  const inner = h.unit(id), edge = h.unit('chess_char_2_18_b');
  approx(inner.s.atk, inner.base.atk * (1 + t['ashlok_t_1.atk']), 'all four neighbours are ground');
  approx(edge.s.atk, edge.base.atk * (1 + tal('chess_char_2_18_b').atk), 'a high tile next to it');
  const h2 = run({ defs: { enemies: { e: dummy('e', { atk: 400 }) } }, units: [{ chessId: id, row: 10, col: 5, carryState: READY }], enemies: [{ key: 'e', pos: [10, 5] }] });
  const u = h2.unit(id);
  h2.runUntil(() => u.skill.active, 5);
  // the owner's deliberate deviation from the 重装 TAKE_DAMAGE row: the basic strategy, no hit needed — she casts before the
  // enemy she holds has hit her
  assert.equal(u.skill.rule, 'DEFAULT');
  assert.equal(h2.hooksOf('skillStart').find((c) => c.unit === u).reason, 'DEFAULT');
  assert.ok(!h2.hooksOf('damaged').some((c) => c.target === u), 'not hit before the cast');
  approx(u.s.atk, u.base.atk * (1 + t['ashlok_t_1.atk'] + bb.atk));
  done(h2);
  const idb = 'chess_char_2_18_b', tb = tbOf(idb);
  const h3 = run({ defs: { enemies: { e: dummy('e') } }, units: [{ chessId: idb, row: 10, col: 5 }], enemies: [{ key: 'e', pos: [10, 5] }] });
  const u3 = h3.unit(idb);
  h3.run(4);
  const d = dealt(h3, u3);
  assert.ok(d.length > 0);
  for (const c of d) approx(c.amount, u3.s.atk * tb.atk_scale, 'blocked ×1.1');
  done(h3);
});

// =================================================================================================================
// Fidelity fixes (verification pass)

test('1_01 隐现 elite: the ally magazine bonus is one grant per deployment (never stacks) and lapses when 隐现 leaves', () => {
  const id = 'chess_char_1_01_b', t = tal(id);
  const lat = chessRec({
    id: 't_lat', profession: 'SNIPER', subProfessionId: 'fastshot', bonds: ['lateranoShip'], rangeGrid: raw(id).rangeGrid,
    skill: { durationType: 'AMMO', duration: 0, spCost: 999, initSp: 0, bb: { 'attack@trigger_time': 5 } },
  });
  const h = run({ defs: { enemies: { e: dummy('e') }, chess: { t_lat: lat } }, units: [{ chessId: id, row: 10, col: 4 }, { chessId: 't_lat', row: 11, col: 4 }], enemies: [{ key: 'e', pos: [10, 6] }] });
  const u = h.unit(id), l = h.unit('t_lat');
  const magazine = () => {
    if (l.skill.active) l.skill.end('test');
    l.skill.activate('test', { free: true });
    const n = l.skill.ammoLeft;
    l.skill.end('test');
    return n;
  };
  h.run(1);
  assert.equal(magazine(), 5, 'before `duration` s: base magazine');
  for (let i = 0; i < 3; i++) { h.run(t.duration + 1); h.b.kill(u, null); h.b.redeploy(u); }
  h.run(t.duration + 1);
  assert.equal(magazine(), 5 + t.ally_ammo, 'one grant after four deployments');
  h.b.kill(u, null);
  assert.equal(magazine(), 5, 'the source left: no bonus');
  done(h);
});

test('1_03 惊蛰 elite: module chain (attack@max_target targets, −10 % per jump) and no falloff during 初雷', () => {
  const id = 'chess_char_1_03_b', tb = tbOf(id), t = tal(id);
  const mk = (carry) => run({
    defs: { enemies: { e: dummy('e') } },
    units: [{ chessId: id, row: 10, col: 4, carryState: carry }],
    enemies: [{ key: 'e', pos: [10, 5] }, { key: 'e', pos: [10, 6] }, { key: 'e', pos: [11, 6] }, { key: 'e', pos: [11, 7] }],
  });
  const h1 = mk(null), u1 = h1.unit(id);
  h1.runUntil(() => dealt(h1, u1).length >= tb['attack@max_target'], 10);
  const a1 = dealt(h1, u1).slice(0, tb['attack@max_target']).map((c) => c.amount);
  a1.forEach((a, k) => approx(a, u1.s.atk * t.atk_scale * tb['attack@chain.atk_scale'] ** k, `jump ${k}`));
  const h2 = mk(READY), u2 = h2.unit(id);
  h2.runUntil(() => dealt(h2, u2).length >= tb['attack@max_target'], 10);
  for (const c of dealt(h2, u2).slice(0, tb['attack@max_target'])) approx(c.amount, u2.s.atk * t.atk_scale, 'no falloff');
  done(h1); done(h2);
});

test('1_10 古米: 平底锅专精 stuns only when the proc hit lands (a dodged hit stuns nothing)', () => {
  const id = 'chess_char_1_10_b';
  const h = run({
    defs: { enemies: { e: dummy('e') } }, units: [{ chessId: id, row: 9, col: 5 }], enemies: [{ key: 'e', pos: [9, 5] }],
    setup: (b) => b.on('enemySpawn', ({ enemy }) => b.addBuff(enemy, { key: 'test:dodge', mods: { dodgePhys: 1 } })),
  });
  const u = h.unit(id);
  h.run(60);
  assert.ok(h.eventsOf('fx').some((f) => f[1] === 'crit' && f[4]?.id === u.id), 'procs rolled');
  assert.equal(statuses(h, 'stun', (c) => c.source === u).length, 0, 'no stun from dodged hits');
  done(h);
});

test('1_16 锡人 elite: 凋敝魂灵 multiplies damage over time only, never instantaneous bursts', () => {
  const id = 'chess_char_1_16_b', w = tal(id, 1)['skill@damage_scale'];
  const h = run({ defs: { enemies: { e: dummy('e') } }, units: [{ chessId: id, row: 10, col: 4, carryState: READY }], enemies: [{ key: 'e', pos: [10, 5] }] });
  const u = h.unit(id);
  h.run(1.5);
  const e = h.enemies()[0];
  assert.ok(e.findBuff('tinman:wither'), 'inside the alchemy unit');
  approx(h.b.dealDamage(u, e, { amount: 1000, type: 'true', tags: ['dot'] }), 1000 * w, 'DoT ×damage_scale');
  approx(h.b.dealDamage(u, e, { amount: 1000, type: 'true', tags: ['burst', 'necrosis'] }), 1000 * w, 'necrosis burst tick');
  approx(h.b.dealDamage(u, e, { amount: 1000, type: 'true', tags: ['skill', 'burst'] }), 1000, 'instant burst unchanged');
  approx(h.b.dealDamage(u, e, { amount: 1000, type: 'true', tags: ['burst', 'burn'] }), 1000, 'burn burst unchanged');
  done(h);
});

test('1_18 宴 elite: 庇护 reduces physical and arts damage only (true damage is not reduced)', () => {
  const id = 'chess_char_1_18_b', t = tal(id);
  const h = run({ units: [{ chessId: id, row: 9, col: 5 }] });
  const u = h.unit(id);
  h.step();
  u.hp = u.s.maxHp * (t.hp_ratio - 0.2);
  approx(h.b.dealDamage(null, u, { amount: 100, type: 'arts' }), 100 * (1 - t.damage_resistance), 'arts');
  approx(h.b.dealDamage(null, u, { amount: 100, type: 'true' }), 100, 'true');
  done(h);
});

test('1_18 宴 with her 特质 弱点伤害: the garrison re-types every hit after the skill’s arts conversion (both ways)', () => {
  const id = 'chess_char_1_18_a', bb = bbOf(id);
  assert.ok(raw(id).garrisonIds.includes('garrison_01_a'), 'real data: 宴 carries 弱点伤害');
  for (const [stats, want] of [[{ def: 0, res: 60 }, 'phys'], [{ def: 400, res: 0 }, 'arts']]) {
    const h = run({ defs: { enemies: { e: dummy('e', stats) } }, units: [{ chessId: id, row: 9, col: 5 }], enemies: [{ key: 'e', pos: [9, 6] }] });
    h.run(bb.duration + 3);
    const hits = dealt(h, h.unit(id), (c) => c.dmg.isAttack);
    assert.ok(hits.some((c) => c.t < bb.duration - 0.1) && hits.some((c) => c.t > bb.duration + 0.1), 'hits during and after 落地斩·破门');
    assert.ok(hits.every((c) => c.type === want), `vs ${JSON.stringify(stats)} every hit is ${want}`);
    done(h);
  }
});

test('1_19 野鬃 normal: 一致向前 only on the first deployment', () => {
  const id = 'chess_char_1_19_a', t = tal(id);
  assert.equal(t.flag, 0);
  const h = run({ units: [{ chessId: id, row: 9, col: 4 }, { chessId: 'chess_char_1_12_a', row: 9, col: 6 }], flags: { dpInit: 99 } });
  h.step();
  const wm = h.unit(id), est = h.unit('chess_char_1_12_a');
  const cost0 = est.base.cost;
  h.b.kill(est, null);
  h.b.kill(wm, null);
  h.b.redeploy(wm);
  assert.equal(est.base.cost, cost0, 'a redeployment gives no discount');
  done(h);
});

test('2_02 赫默: the drone takes its own placed tile, never the home tile of a knocked-out operator', () => {
  const h = run({ units: [{ chessId: 'chess_char_2_02_a', row: 10, col: 4, carryState: READY, uid: 1 }, { chessId: 'chess_char_1_02_a', row: 10, col: 5 }, { chessId: 'chess_char_1_10_a', row: 9, col: 5 },
    { kind: 'token', tokenId: 'token_10000_silent_healrb', ownerUid: 1, row: 11, col: 5 }] });
  h.step();
  const yak = h.unit('chess_char_1_02_a'), gum = h.unit('chess_char_1_10_a');
  gum.hp = gum.s.maxHp * 0.3;
  h.b.kill(yak, null);
  h.run(0.5);
  const d = h.b.allyUnits.find((x) => x.kind === 'token');
  assert.ok(d && d.alive, 'drone deployed');
  assert.deepEqual([d.tileR, d.tileC], [11, 5], 'its placed tile');
  assert.ok(!(d.tileR === yak.homeR && d.tileC === yak.homeC), 'not on the dead operator tile');
  done(h);
});

test('2_04 小满 elite module: +sp_recovery_per_sec SP/s while an enemy is in range', () => {
  const idb = 'chess_char_2_04_b', mb = hid(idb);
  const sp = (withEnemy) => {
    const hh = run({ defs: { enemies: { e: dummy('e') } }, units: [{ chessId: idb, row: 10, col: 4 }], enemies: [{ key: 'e', pos: withEnemy ? [10, 5] : [9, 9] }] });
    hh.run(5);
    return hh.unit(idb).skill.sp;
  };
  approx(sp(true) - sp(false), 5 * mb.sp_recovery_per_sec, 'module SP', 1e-3);
});

test('2_10 洛洛: 自负此轭 drones stay locked on their target while the skill runs', () => {
  const id = 'chess_char_2_10_a';
  const h = run({ defs: { enemies: { e: dummy('e') } }, units: [{ chessId: id, row: 10, col: 4, carryState: READY }], enemies: [{ key: 'e', pos: [10, 6] }] });
  const u = h.unit(id);
  h.run(2);
  assert.ok(u.skill.active);
  const first = h.enemies()[0];
  const other = h.spawn('e', { pos: [10, 5] });
  h.b.addBuff(other, { key: 'test:taunt', mods: { taunt: 5 } }); // normally the preferred target
  h.step();
  const normal = h.b.enemiesInKeys(u.rangeKeys, u, u.profile);
  sortEnemyTargets(h.b, u, normal, u.profile.priority);
  assert.equal(normal[0], other, 'without the lock the newcomer would be the target');
  const t0 = h.b.time;
  h.run(4);
  const atks = h.hooksOf('attack').filter((c) => c.attacker === u && c.t > t0);
  assert.ok(atks.length > 0 && atks.every((c) => c.targets.length === 1 && c.targets[0] === first), 'locked');
  done(h);
});

test('2_11 风丸: while substituted she fights with the <替身> ATK/DEF (+module ATK on elite)', () => {
  for (const id of ['chess_char_2_11_a', 'chess_char_2_11_b']) {
    const tb = tbOf(id), t = tal(id);
    const h = run({ defs: { enemies: { e: dummy('e', { atk: 9000, bat: 1 }) } }, units: [{ chessId: id, row: 9, col: 5 }], enemies: [{ key: 'e', pos: [9, 5] }] });
    const u = h.unit(id);
    h.runUntil(() => u.findBuff('trait:substitute'), 20);
    h.step();
    const ts = ds.getToken('token_10022_kazema_shadow', id).stats;
    approx(u.s.atk, ts.atk * (1 + (tb.atk || 0)), `${id} substitute ATK`);
    approx(u.s.def, ts.def, `${id} substitute DEF`);
    approx(dealt(h, u, tagged('talent'))[0].amount, u.s.atk * t.damage_scale, `${id} 折纸生花 on substitution`);
    done(h);
  }
});

test('2_13 蒂比: any damage instance sets off 紧急赶场通知 (PRTS 修正 "受到伤害前触发") and a physical one is dodged; a 流失 does not; a true-damage attack triggers it but is not dodged', () => {
  const id = 'chess_char_2_13_a';
  const g = run({ units: [{ chessId: id, row: 9, col: 5, carryState: READY }] });
  const v = g.unit(id);
  g.step();
  g.b.loseHp(v, 50);
  g.step();
  assert.equal(v.skill.active, false, 'a 流失 never triggers it');
  const hp = v.hp;
  g.b.dealDamage(null, v, { amount: 50, type: 'phys' });
  assert.ok(v.skill.active, 'a non-attack (sourceless) damage instance triggers it');
  assert.equal(v.hp, hp, '…and the physical damage is dodged');
  done(g);
  const h = run({ defs: { enemies: { e: dummy('e', { atk: 300, bat: 1, dmgType: 'true' }) } }, units: [{ chessId: id, row: 9, col: 5, carryState: READY }] });
  const u = h.unit(id);
  h.step();
  h.spawn('e', { pos: [9, 5] });
  h.runUntil(() => u.skill.active, 3);
  assert.ok(u.skill.active, 'the attack triggered it');
  assert.ok(h.hooksOf('damaged').some((c) => c.target === u && c.source?.side === 'enemy' && c.type === 'true'), 'true damage landed');
  done(h);
});

test('every tier 1/2 chess (normal & elite, hidden included) fights 40 s with its kit and no content errors', () => {
  const ids = ds.chessIds().filter((id) => /^chess_char_[12]_\d+_[ab]$/.test(id));
  assert.ok(ids.length >= 78);
  for (const id of ids) {
    const h = makeBattle({
      stageId: 'act2autochess_m04', seed: 5,
      defs: { enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 20000, atk: 300, bat: 2, speed: 0.6 }) } },
      units: [{ chessId: id, row: 9, col: 7 }, { chessId: 'chess_char_1_02_a', row: 9, col: 4 }, { chessId: 'chess_char_2_14_a', row: 10, col: 5 }],
      enemies: [{ key: 'enemy_dummy', count: 4, interval: 2 }, { key: 'enemy_dummy', route: 1, count: 2, interval: 3 }],
      timeLimit: 60,
    });
    h.run(40);
    checkInvariants(h.b);
    assert.equal(h.b.errors.length, 0, `${id}: ${JSON.stringify(h.b.errors[0])}`);
    assert.equal(h.unit(id).kit.generic, undefined, `${id} uses its hand-authored kit`);
  }
});
