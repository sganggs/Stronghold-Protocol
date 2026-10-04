// Fidelity review (correctness vs Arknights rules / research / real data): SP-on-attack cycles, melee enemies,
// unite carry state, stage devices from data/stages.json, generic-kit heuristics on real chess, profession details.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { getDefaultSource, hasGeneratedData, spawnsFromTemplate } from '../../server/sim/simdata.js';
import { genericSkillSpec, genericKit } from '../../server/sim/content/generic.js';
import { getData } from '../../server/data.js';

const approx = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);
const RANGE3 = [[0, 0], [0, 1], [0, 2], [0, 3], [1, 0], [1, 1], [1, 2], [1, 3], [-1, 0], [-1, 1], [-1, 2], [-1, 3]];
const dummy = (o = {}) => enemyRec({ key: 'enemy_dummy', hp: 1e7, speed: 0, ...o });
const sniper = (skill, o = {}) => chessRec({ id: 't_sn', profession: 'SNIPER', subProfessionId: 'closerange', stats: { atk: 100, bat: 1, ...(o.stats || {}) }, rangeGrid: RANGE3, skill, ...o });
const ds = getDefaultSource();
const specOf = (id) => { const d = ds.getChess(id); return genericSkillSpec(d.skill, d.skill.bb, d); };

// ---------------------------------------------------------------------------------------------------------------
// skills

test('attack-SP instant skill fires every spCost+1 attacks: the skill attack itself recovers no SP', () => {
  const h = makeBattle({
    defs: { chess: { t_sn: sniper({ spType: 'INCREASE_WHEN_ATTACK', spCost: 3, initSp: 0, duration: 0, bb: { atk_scale: 2 } }) }, enemies: { enemy_dummy: dummy() } },
    units: [{ chessId: 't_sn', row: 10, col: 4 }], enemies: [{ key: 'enemy_dummy', pos: [10, 6] }],
    content: 'generic', hooks: ['attack'], captureNoisy: true,
  });
  h.run(16.5);
  const seq = h.hooksOf('attack').map((a) => (a.isSkill ? 'S' : '.')).join('');
  assert.ok(seq.startsWith('...S...S...S'), seq);
  assert.ok(!seq.includes('S..S'), `cycle of 4 attacks: ${seq}`);
});

test('attack-SP ammo skill: no SP from any ammo shot, including the last one', () => {
  const h = makeBattle({
    defs: { chess: { t_sn: sniper({ spType: 'INCREASE_WHEN_ATTACK', spCost: 2, initSp: 0, duration: 0, durationType: 'AMMO', bb: { 'attack@trigger_time': 3 } }) }, enemies: { enemy_dummy: dummy() } },
    units: [{ chessId: 't_sn', row: 10, col: 4 }], enemies: [{ key: 'enemy_dummy', pos: [10, 6] }], content: 'generic',
  });
  const u = h.unit('t_sn');
  assert.ok(h.runUntil(() => u.skill.activations === 1 && !u.skill.active, 30));
  assert.equal(u.stats.attacks, 5, '2 charging attacks + 3 ammo shots');
  assert.equal(u.skill.sp, 0, 'the last ammo shot recovered nothing');
  h.runUntil(() => u.stats.attacks === 6, 5);
  assert.equal(u.skill.sp, 1);
});

test('unite carryState: a skill running at the end of the own combat is not carried — unitsEnd reports sp 0 and the skill enters 联防 off', () => {
  // community report #34 / GitHub #82: the carried skillActive used to restart the skill for free (bar empty, skill on)
  const h = makeBattle({
    defs: { chess: { t_sn: sniper({ duration: 10, spCost: 10, initSp: 10, bb: { atk: 1 } }) }, enemies: { e_dummy: enemyRec({ key: 'e_dummy', hp: 1e9, speed: 0 }) } },
    units: [{ chessId: 't_sn', row: 10, col: 4 }], enemies: [{ key: 'e_dummy', pos: [10, 6] }], content: 'generic', autoFinish: false,
  });
  h.runUntil(() => h.unit('t_sn').skill.active, 10);
  h.run(1);
  const end = h.result().perPlayer.p1.unitsEnd[0];
  assert.equal(end.skillActive, true, 'reported');
  assert.equal(end.sp, 0, 'the SP was spent at the activation (PRTS 技能 "触发技能后…消耗相应的技力")');
  const u2 = makeBattle({
    defs: { chess: { t_sn: sniper({ duration: 10, spCost: 10, initSp: 0, bb: { atk: 1 } }) } },
    units: [{ chessId: 't_sn', row: 10, col: 4, carryState: { hpPct: 0.6, sp: end.sp, skillActive: end.skillActive } }], content: 'generic',
  });
  u2.step();
  const u = u2.unit('t_sn');
  approx(u.hpRatio, 0.6, 1e-9);
  assert.equal(u.skill.active, false);
  assert.equal(u.skill.charges, 0);
  assert.ok(u.skill.sp < 0.2);
  approx(u.s.atk, 100);
});

// ---------------------------------------------------------------------------------------------------------------
// enemies

test('MELEE enemies only hit their blocker even with a data radius; RANGED ones shoot unblocking operators', () => {
  const medic = chessRec({ id: 't_med', profession: 'MEDIC', subProfessionId: 'physician', stats: { atk: 0, maxHp: 1e5 }, rangeGrid: [[0, 0]], skill: null });
  const run = (applyWay) => {
    const h = makeBattle({
      defs: { chess: { t_med: medic }, enemies: { enemy_x: enemyRec({ key: 'enemy_x', applyWay, range: 2.5, atk: 100, speed: 1, hp: 1e6 }) } },
      units: [{ chessId: 't_med', row: 10, col: 2 }], // high ground next to the goal: never blocks
      enemies: [{ key: 'enemy_x', route: 0 }], content: 'none', timeLimit: 30,
    });
    h.runToEnd(31);
    return h.unit('t_med').stats.taken;
  };
  assert.equal(run('MELEE'), 0, 'melee enemy walked past without attacking');
  assert.ok(run('RANGED') > 0, 'ranged enemy shot the medic');
});

test('real data: MELEE enemies with an official radius (宿主士兵) leave high-ground operators alone', () => {
  const h = makeBattle({ units: [{ chessId: 'chess_char_2_14_a', row: 10, col: 2 }], enemies: [{ key: 'enemy_1043_zomsbr', route: 0 }], timeLimit: 40, content: 'none' });
  h.runToEnd(41);
  assert.equal(h.unit('chess_char_2_14_a').stats.taken, 0);
});

// ---------------------------------------------------------------------------------------------------------------
// stage devices (data/stages.json)

test('stage devices: act1 m02 crates are hidden and inactive in 下半 (research 08 §3.2) ⇒ none; act1 m04 active crates ⇒ obstacles', { skip: !hasGeneratedData() }, () => {
  const inRect = (id) => ds.getStage(id).devices.filter((d) => d.role === 'crate' && d.row >= 9 && d.row <= 12 && d.col >= 0 && d.col <= 10);
  const m02 = inRect('act1autochess_m02');
  assert.ok(m02.length > 0 && m02.every((d) => d.hidden), 'fixture: hidden crates on the m02 normal field');
  const h2 = makeBattle({ stageId: 'act1autochess_m02', content: 'none', timeLimit: 5 });
  h2.step();
  assert.equal(h2.b.allyUnits.filter((u) => u.kind === 'device').length, 0, '下半 m02 starts without crates');
  for (const d of m02) assert.ok(!h2.b.grid.isObstacle(d.row, d.col), `no obstacle at (${d.row},${d.col})`);
  const m04 = inRect('act1autochess_m04');
  assert.ok(m04.length > 0 && m04.every((d) => !d.hidden), 'fixture: active crates on the m04 normal field');
  const h4 = makeBattle({ stageId: 'act1autochess_m04', content: 'none', timeLimit: 5 });
  h4.step();
  const crates = h4.b.allyUnits.filter((u) => u.kind === 'device');
  assert.equal(crates.length, m04.length);
  for (const c of crates) assert.ok(h4.b.grid.isObstacle(c.tileR, c.tileC));
});

test('stage devices: active platforms (act1 m03) block ground paths and elevate operators standing on them', { skip: !hasGeneratedData() }, () => {
  const stage = ds.getStage('act1autochess_m03');
  const plats = stage.devices.filter((d) => d.role === 'platform' && d.raw.active && d.row >= 9 && d.row <= 12 && d.col <= 10);
  assert.ok(plats.length > 0);
  const p = plats[0];
  const h = makeBattle({ stageId: 'act1autochess_m03', units: [{ chessId: 'chess_char_1_01_a', row: p.row, col: p.col }], content: 'none', timeLimit: 5 });
  h.step();
  assert.ok(h.b.grid.isObstacle(p.row, p.col));
  const u = h.unit('chess_char_1_01_a');
  assert.ok(u.deployed);
  assert.equal(u.ground, false, 'an operator on a platform never blocks');
  // hidden+inactive platforms (m02) change nothing
  const h2 = makeBattle({ stageId: 'act1autochess_m02', content: 'none', timeLimit: 5 });
  h2.step();
  const p2 = ds.getStage('act1autochess_m02').devices.find((d) => d.role === 'platform' && d.row >= 9 && d.row <= 12 && d.col <= 10 && !h2.b.allyUnits.some((x) => x.tileR === d.row && x.tileC === d.col));
  if (p2) assert.equal(h2.b.grid.isObstacle(p2.row, p2.col), false);
});

// ---------------------------------------------------------------------------------------------------------------
// generic kit on real chess (skill metadata/blackboards from data/chess.json)

test('generic kind: duration −1 is instant/charges unless the skill is explicitly endless', () => {
  assert.equal(specOf('chess_char_6_09_a').kind, 'charges', '塑心 可充能2次');
  assert.equal(specOf('chess_char_5_22_a').kind, 'instant', '妮芙');
  assert.equal(specOf('chess_char_5_12_a').kind, 'charges', '夕 下一次攻击');
  assert.equal(specOf('chess_char_3_17_a').kind, 'instant', '流星 立即');
  assert.equal(specOf('chess_char_4_14_a').kind, 'charges', '莱恩哈特');
  const surtr = specOf('chess_char_5_07_a');
  assert.equal(surtr.kind, 'toggle', '史尔特尔 持续时间无限');
  assert.equal(surtr.mods.hpFlat, 5000, '生命上限+5000 is flat');
  assert.equal(surtr.mods.hpPct, undefined);
});

test('generic scales: attack@atk_scale wins for hits; burst/counter/bonus scales never become the attack scale', () => {
  const lg = specOf('chess_char_3_08_a'); // 薄绿: 110 % per hit, 210 % at skill end
  assert.equal(lg.attack.atkScale, 1.1);
  assert.equal(typeof lg.onEnd, 'function');
  assert.equal(specOf('chess_char_5_19_a').attack.atkScale, 1.25, '玛恩纳 125 % ×5');
  assert.equal(specOf('chess_char_5_03_a').attack?.atkScale, undefined, '烛煌: 额外造成攻击力60% is bonus damage');
  assert.equal(specOf('chess_char_1_06_a').attack?.atkScale, undefined, '刺玫: 20 % belongs to the protected ally counter');
  const ub = specOf('chess_char_5_05_a'); // 乌尔比安: 立即 anchor 135 % + stun 6 once
  assert.equal(ub.attack?.atkScale, undefined);
  assert.equal(ub.attack?.onHit, undefined, 'no 6 s stun on every attack');
  assert.equal(typeof ub.onStart, 'function');
  assert.deepEqual(specOf('chess_char_1_02_a').mods, { defPct: 0.1, hpPct: 0.3, resMul: 1.6 }, '角峰 法术抗性+60%');
});

test('generic passives only buff stats: 星熊 keeps 100 % attacks and counters attackers for 65 % ATK', () => {
  const spec = specOf('chess_char_4_17_a');
  assert.equal(spec.kind, 'passive');
  assert.equal(spec.attack, undefined);
  assert.equal(spec.targeting, undefined);
  assert.equal(specOf('chess_char_4_16_a').targeting, undefined, '缄默德克萨斯 keeps her own range');
  const h = makeBattle({
    defs: { enemies: { enemy_x: enemyRec({ key: 'enemy_x', hp: 1e7, atk: 50, def: 0, speed: 1, bat: 1 }) } },
    units: [{ chessId: 'chess_char_4_17_a', row: 9, col: 6 }], enemies: [{ key: 'enemy_x', route: 0 }],
    hooks: ['damaged'], captureNoisy: true, timeLimit: 20,
  });
  const u = h.unit('chess_char_4_17_a');
  h.run(12);
  const counters = h.hooksOf('damaged').filter((c) => c.source === u && c.dmg?.tags?.includes('counter'));
  assert.ok(counters.length > 0, 'countered');
  approx(counters[0].amount, u.s.atk * 0.65, 1e-6);
  checkInvariants(h.b);
});

test('generic target debuffs: 初雪 shreds enemies in range (not herself); 流星 marks its targets for 5 s', () => {
  const s = specOf('chess_char_3_14_a');
  assert.equal(s.mods, undefined, 'no self debuff');
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy({ def: 500, res: 50 }) } },
    units: [{ chessId: 'chess_char_3_14_a', row: 10, col: 4 }], enemies: [{ key: 'enemy_dummy', pos: [10, 5] }], timeLimit: 120,
  });
  const u = h.unit('chess_char_3_14_a');
  assert.ok(h.runUntil(() => u.skill.active, 90));
  h.step(2);
  const e = h.enemy('enemy_dummy');
  approx(e.s.def, 300);
  approx(e.s.res, 50 * 0.77, 1e-6);
  approx(u.s.def, u.base.def);
  h.runUntil(() => !u.skill.active, 30);
  h.run(1);
  approx(e.s.def, 500);
  const m = specOf('chess_char_3_17_a');
  assert.equal(m.mods, undefined);
  assert.equal(typeof m.attack.onHit, 'function');
});

test('generic text rules: 泡泡 stops attacking; 小满 sleeps ≤3 enemies once; 宴 +65 % ATK only for 14 s after losing half HP; 砾 shield', () => {
  assert.equal(specOf('chess_char_2_08_a').attack.noAttack, true);
  const xm = specOf('chess_char_2_04_a');
  assert.equal(xm.attack?.onHit, undefined, 'no sleep on every attack');
  assert.equal(typeof xm.onStart, 'function');

  const h = makeBattle({ defs: { enemies: { enemy_dummy: dummy() } }, units: [{ chessId: 'chess_char_1_18_a', row: 9, col: 5 }, { chessId: 'chess_char_2_12_a', row: 11, col: 5 }], content: 'full', autoFinish: false, timeLimit: 60 });
  h.step();
  const yan = h.unit('chess_char_1_18_a');
  approx(yan.hpRatio, 0.5, 1e-6);
  approx(yan.s.atk, yan.base.atk * 1.65, 1e-6);
  h.run(14.1);
  approx(yan.s.atk, yan.base.atk, 1e-6);
  const gravel = h.unit('chess_char_2_12_a');
  assert.equal(gravel.s.shield, 0, 'the 10 s decaying barrier is gone');
  const h2 = makeBattle({ units: [{ chessId: 'chess_char_2_12_a', row: 11, col: 5 }], autoFinish: false, timeLimit: 60 });
  h2.step();
  const g2 = h2.unit('chess_char_2_12_a');
  assert.ok(g2.s.shield > g2.s.maxHp * 1.3, `barrier ${g2.s.shield}`);
  h2.run(5);
  assert.ok(g2.s.shield < g2.s.maxHp * 0.8 && g2.s.shield > 0, 'decays');
});

test('generic element: 塑心 charges add 85 % ATK of 凋亡 (apoptosis) damage to the gauge', () => {
  // the generic kit's numbers (tier6.js has a hand-written 塑心 kit whose talent amplifies apoptosis in range)
  const h = makeBattle({ defs: { enemies: { enemy_dummy: dummy() } }, units: [{ chessId: 'chess_char_6_09_a', row: 10, col: 4 }], enemies: [{ key: 'enemy_dummy', pos: [10, 6] }], timeLimit: 60, content: 'generic' });
  const u = h.unit('chess_char_6_09_a');
  assert.ok(h.runUntil(() => u.skill.activations >= 1 && h.enemy('enemy_dummy').elem.apoptosis > 0, 40));
  const e = h.enemy('enemy_dummy');
  approx(e.elem.apoptosis, u.s.atk * 0.85 * u.skill.activations, 1e-3);
});

// ---------------------------------------------------------------------------------------------------------------
// professions / engine details

test('taunt as a buff flag (DESIGN §5.3) raises aggro: ranged enemies pick the taunting operator', () => {
  const tank = (id) => chessRec({ id, profession: 'TANK', stats: { atk: 0, maxHp: 1e6, blockCnt: 0 }, rangeGrid: [[0, 0]], skill: null });
  const h = makeBattle({
    defs: { chess: { t_a: tank('t_a'), t_b: tank('t_b') }, enemies: { enemy_r: enemyRec({ key: 'enemy_r', applyWay: 'RANGED', range: 5, atk: 10, speed: 0, hp: 1e6 }) } },
    units: [{ chessId: 't_a', row: 10, col: 5 }, { chessId: 't_b', row: 11, col: 5 }], enemies: [{ key: 'enemy_r', pos: [10, 8] }], content: 'none', autoFinish: false, timeLimit: 30,
  });
  h.step();
  const a = h.unit('t_a');
  h.b.addBuff(a, { key: 'test:taunt', flags: { taunt: true } });
  assert.equal(a.s.taunt, 1);
  h.run(5);
  assert.ok(a.stats.taken > 0);
  assert.equal(h.unit('t_b').stats.taken, 0, 'latest-deployed rule overridden by taunt');
});

test('librator module (玛恩纳 elite init_atk): +100 % ATK right after deployment', { skip: !hasGeneratedData() }, () => {
  const h = makeBattle({ units: [{ chessId: 'chess_char_5_19_b', row: 9, col: 5 }], autoFinish: false, timeLimit: 10 });
  h.step();
  const u = h.unit('chess_char_5_19_b');
  approx(u.s.atk, u.base.atk * 2, 1e-6);
  const n = makeBattle({ units: [{ chessId: 'chess_char_5_19_a', row: 9, col: 5 }], autoFinish: false, timeLimit: 10 });
  n.step();
  approx(n.unit('chess_char_5_19_a').s.atk, n.unit('chess_char_5_19_a').base.atk, 1e-6);
});

test('dollkeeper without a substitute token (归溟幽灵鲨) keeps its own max HP, not 风丸\'s 纸偶', { skip: !hasGeneratedData() }, () => {
  const h = makeBattle({ defs: { enemies: { enemy_dummy: dummy() } }, units: [{ chessId: 'chess_char_5_13_a', row: 9, col: 5 }], content: 'none', autoFinish: false, timeLimit: 30 });
  h.step();
  const u = h.unit('chess_char_5_13_a');
  const full = u.s.maxHp;
  h.b.dealDamage(null, u, { amount: 1e7, type: 'true' });
  assert.ok(u.alive && u.hasBuff('trait:substitute'));
  // PRTS 分支特性信息 傀儡师 "重设自身生命至最大值"; the trait's 替身 HP bonus (bb max_hp) is 0 and 风丸's 纸偶 has her own HP
  approx(u.s.maxHp, full, 1e-6);
  approx(u.hp, full, 1e-6);
});

// ---------------------------------------------------------------------------------------------------------------
// end-to-end on real data

test('real data: R5 template on act1 m04 (crates) with a real lineup runs to the limit with invariants', { skip: !hasGeneratedData() }, () => {
  const data = getData({ log: { warn() {}, error() {}, info() {} } });
  const mode = data.config.modes.mode_multi_normal;
  const rc = mode.rounds['5'];
  const tpl = ds.getWave(rc.template);
  const sc = mode.enemyScale?.['5'] ?? {};
  const mods = { hpMul: (sc.hp ?? 1) ** (sc.kHp ?? 0), atkMul: (sc.atk ?? 1) ** (sc.kAtk ?? 0), speedMul: sc.speed ?? 1 };
  const conv = spawnsFromTemplate(tpl, { mods });
  const h = makeBattle({
    // act1 m04: active 阻隔工事 at (12,3) (12,4) (12,8) (act1 m02 has none in 下半, research 08 §3.2)
    stageId: 'act1autochess_m04', waveTemplate: tpl, mods, timeLimit: rc.combatTimeLimit, flags: tpl.dp ? { dpInit: tpl.dp.init, dpPerSec: tpl.dp.perSec, dpMax: tpl.dp.max } : undefined,
    units: [
      { chessId: 'chess_char_1_02_a', row: 9, col: 3 }, { chessId: 'chess_char_1_12_b', row: 9, col: 4 }, { chessId: 'chess_char_1_01_a', row: 10, col: 3 },
      { chessId: 'chess_char_2_14_a', row: 11, col: 3 }, { chessId: 'chess_char_1_03_a', row: 11, col: 4 }, { chessId: 'chess_char_3_01_a', row: 10, col: 5 },
    ],
  });
  assert.equal(h.b.total, conv.spawns.reduce((n, s) => n + (s.countInTotal === false ? 0 : s.count), 0));
  let t = 0;
  while (!h.b.finished && t < rc.combatTimeLimit + 2) { h.run(1); t += 1; checkInvariants(h.b); }
  assert.ok(h.b.finished);
  assert.ok(h.b.time <= rc.combatTimeLimit + 1e-6);
  assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0]));
  assert.ok(h.b.allyUnits.some((u) => u.kind === 'device'), 'm04 crates present');
  const r = h.result();
  const p = r.perPlayer.p1;
  assert.equal(p.killed + p.leaked.filter((l) => l.counted).length, p.total, 'every counted enemy is killed or leaked');
});

test('generic kit never throws and yields finite numbers for every real chess (normal & elite)', () => {
  for (const id of ds.chessIds()) {
    const d = ds.getChess(id);
    if (!d || !d.skill) continue;
    const kit = genericKit(d.skill.bb, d.raw, d);
    const s = kit.skill;
    for (const [k, v] of Object.entries(s.mods || {})) assert.ok(Number.isFinite(v), `${id} ${k}`);
    if (s.attack?.atkScale !== undefined) assert.ok(s.attack.atkScale > 0 && s.attack.atkScale < 10, `${id} atkScale ${s.attack.atkScale}`);
    if (s.kind === 'toggle') assert.ok(/无限/.test(d.skill.description), `${id} toggle only when endless`);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// DESIGN §5.1 / §5.4 contract: API surface and the documented ctx keys of every hook

test('DESIGN §5.1/§5.4 contract: Battle API + helpers exist and every hook fires with its documented ctx keys', () => {
  const HOOK_KEYS = {
    battleStart: [], deploy: ['unit', 'initial'], tick: ['dt'], beforeAttack: ['attacker', 'targets'], attack: ['attacker', 'targets', 'isSkill'],
    hit: ['source', 'target', 'dmg'], damaged: ['source', 'target', 'amount', 'type', 'dmg'], heal: ['source', 'target', 'amount'],
    kill: ['killer', 'victim'], death: ['unit'], skillStart: ['unit', 'skill'], skillEnd: ['unit', 'skill'], ammoUsed: ['unit', 'left'],
    spGain: ['unit', 'amount'], statusApplied: ['source', 'target', 'status', 'duration'], blocked: ['blocker', 'enemy'],
    enemySpawn: ['enemy'], enemyLeak: ['enemy'], battleEnd: ['result'],
  };
  const DMG_KEYS = ['amount', 'type', 'element', 'atkScale', 'defIgnoreFlat', 'defIgnorePct', 'resIgnoreFlat', 'resIgnorePct', 'mul', 'canDodge', 'isSkill', 'isSplash', 'tags'];
  const seen = {};
  const h = makeBattle({
    defs: {
      chess: {
        t_sn: sniper({ spCost: 2, initSp: 2, duration: 0, durationType: 'AMMO', bb: { 'attack@trigger_time': 3 } }, { stats: { atk: 400 } }),
        t_g: chessRec({ id: 't_g', profession: 'WARRIOR', stats: { atk: 2000, blockCnt: 2, maxHp: 1e5 }, skill: null }),
        t_med: chessRec({ id: 't_med', profession: 'MEDIC', subProfessionId: 'physician', stats: { atk: 100 }, rangeGrid: RANGE3, skill: null }),
      },
      enemies: { enemy_w: enemyRec({ key: 'enemy_w', hp: 3000, atk: 200, speed: 2 }), enemy_f: enemyRec({ key: 'enemy_f', hp: 1e6, speed: 4, motion: 'FLY' }) },
    },
    units: [{ chessId: 't_g', row: 9, col: 5 }, { chessId: 't_sn', row: 10, col: 3 }, { chessId: 't_med', row: 10, col: 4 }],
    enemies: [{ key: 'enemy_w', route: 0, count: 2, interval: 1 }, { key: 'enemy_f', route: 2 }],
    content: 'generic', hooks: [], timeLimit: 30,
    setup: (b) => {
      for (const name of Object.keys(HOOK_KEYS)) b.on(name, (ctx) => { if (!seen[name]) seen[name] = { ...ctx }; }, { priority: -5000 });
      b.on('battleStart', () => { const e = b.allyUnits[0]; b.applyStatus(e, 'cold', { duration: 1, source: null }); });
    },
  });
  h.runToEnd(40);
  for (const [name, keys] of Object.entries(HOOK_KEYS)) {
    assert.ok(seen[name], `hook ${name} fired`);
    for (const k of keys) assert.ok(k in seen[name], `${name}.${k}`);
  }
  for (const k of DMG_KEYS) assert.ok(k in seen.hit.dmg, `DamageInfo.${k}`);
  const b = h.b;
  for (const m of ['step', 'forceEnd', 'result', 'snapshot', 'drainEvents', 'on', 'off', 'dealDamage', 'heal', 'applyStatus', 'addBuff', 'removeBuff',
    'spawnToken', 'spawnEnemy', 'addProjectile', 'unitsInGrid', 'enemiesInRadius', 'alliesInRadius', 'addLayers', 'addCoins', 'fx', 'rng', 'getPlayer',
    'redeploy', 'after', 'every']) assert.equal(typeof b[m], 'function', `battle.${m}`);
  assert.equal(typeof b.finished, 'boolean');
  assert.equal(typeof b.time, 'number');
  const r = b.result();
  for (const k of ['time', 'reason', 'perPlayer']) assert.ok(k in r, `BattleResult.${k}`);
  for (const k of ['killed', 'total', 'leaked', 'perfect', 'layerGains', 'coins', 'damageDealt', 'bossDamage', 'healingDone', 'deaths', 'unitsEnd']) assert.ok(k in r.perPlayer.p1, `perPlayer.${k}`);
  for (const k of ['enemyKey', 'mods', 'lpr', 'sourcePlayerId']) assert.ok(k in r.perPlayer.p1.leaked[0], `leaked.${k}`);
  for (const k of ['uid', 'hpPct', 'sp', 'alive']) assert.ok(k in r.perPlayer.p1.unitsEnd[0], `unitsEnd.${k}`);
});

test('kits keyed like the DESIGN §5.6 example (suffix-less `chess_char_1_01`) are found for normal and elite chess', () => {
  const calls = [];
  const kits = { chess_char_1_01: (bb, chess, def) => { calls.push(def.id); return { skill: { kind: 'duration', duration: 3, mods: { atkPct: 1 } }, talents: [] }; } };
  const h = makeBattle({ units: [{ chessId: 'chess_char_1_01_a', row: 10, col: 3 }, { chessId: 'chess_char_1_01_b', row: 10, col: 4 }], kits, autoFinish: false, timeLimit: 5 });
  h.step();
  assert.deepEqual(calls.sort(), ['chess_char_1_01_a', 'chess_char_1_01_b']);
  assert.equal(h.unit('chess_char_1_01_a').kit.generic, undefined, 'hand-authored kit, not the generic one');
});
