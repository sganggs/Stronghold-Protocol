// test/sim/playtest5-targeting.test.js — user playtest #5 items 1 and 5 (DESIGN §19).
//   #1 "有近地悬浮的敌人会被只能攻击地面单位的干员打到": a hovering enemy (近地悬浮, PRTS 术语释义 ba.float) is an air unit for
//      every targeting rule (Unit.isFlying) while it keeps the ground path; it cannot be blocked or displaced (失衡免疫);
//      掠海漂移体 / 吉兆飞鳞 lose the float when stunned (their PRTS pages); 浮空 (levitate) is an air unit too.
//   #5 "敌人优先锁定的干员顺序": PRTS 作战机制 索敌 — 敌方 "阻挡→特殊优先级→仇恨值（更容易被攻击→…→最后部署的目标→不容易被
//      攻击）→最早出现"; PRTS 卫戍协议/帮助 — "按从上到下>从左到右的顺序部署。优先部署干员，随后为召唤物"; a stealthed ally
//      is attacked only by the enemy it blocks (PRTS 作战机制 §隐匿); an enemy's own rule (只攻击地面单位) filters its
//      candidates before the order; a special priority (优先攻击防御力最高的…) breaks ties by taunt, then latest deployed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import * as enemiesMod from '../../server/sim/content/enemies.js';
import * as bossesMod from '../../server/sim/content/bosses.js';
import { canTargetEnemy } from '../../server/sim/targeting.js';

const FLOATER = 'enemy_2025_syufo';   // 掠海漂移体 (海嗣, ELEMENT faction)
const PARROT = 'enemy_10045_parrot';  // 吉兆飞鳞 (悬赏·飞行II)
const approx = (a, b, eps = 1e-6, msg = '') => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg} ${a} ≈ ${b}`);
/** Damage `src` dealt to `target` (recorded `damaged` hooks; needs captureNoisy). */
const dealt = (h, src, target) => h.hooksOf('damaged').filter((c) => c.source === src && c.target === target).reduce((a, c) => a + c.amount, 0);
/** A pinned enemy (speed ×0) on a tile; `o.mods` merged. */
const put = (h, key, pos, o = {}) => h.spawn(key, { pos, routeIndex: 0, mods: { speedMul: o.move ? 1 : 0, ...(o.mods || {}) } });

// synthetic allies: a wall that never attacks, a melee blade, a long-range gun
const WALL = chessRec({ id: 't_wall', profession: 'TANK', stats: { atk: 0, maxHp: 1e7, blockCnt: 3 }, rangeGrid: [[0, 0]], skill: null });
const BLADE = chessRec({ id: 't_blade', profession: 'WARRIOR', stats: { atk: 300, maxHp: 1e7, bat: 1, blockCnt: 2 }, rangeGrid: [[0, 0], [0, 1]], skill: null });
const BIG = [];
for (let dr = -4; dr <= 4; dr++) for (let dc = -12; dc <= 12; dc++) BIG.push([dr, dc]);
const GUN = chessRec({ id: 't_gun', profession: 'SNIPER', projectile: 'none', stats: { atk: 300, maxHp: 1e7, bat: 1, blockCnt: 0 }, rangeGrid: BIG, skill: null });
const SHOOTER = enemyRec({ key: 'enemy_t_shooter', hp: 1e7, atk: 10, range: 9, bat: 1, speed: 0 });
const SLIME = enemyRec({ key: 'enemy_t_slime', hp: 1e7, atk: 0, speed: 0 });
const BAT = enemyRec({ key: 'enemy_t_bat', hp: 1e7, atk: 0, speed: 0, motion: 'FLY' });
const SYN = { chess: { t_wall: WALL, t_blade: BLADE, t_gun: GUN }, enemies: { enemy_t_shooter: SHOOTER, enemy_t_slime: SLIME, enemy_t_bat: BAT } };
const NOATK = () => ({ trait: { noAttack: true } });

/** Synthetic arena: generic kits + the enemies module only (other content never interferes). */
function arena(o = {}) {
  return makeBattle({ content: 'generic', extraContent: [enemiesMod], seed: 7, autoFinish: false, timeLimit: 300, defs: SYN,
    kits: { t_wall: NOATK }, captureNoisy: true, ...o });
}

// ---------------------------------------------------------------------------------------------------------------
// #1 近地悬浮

test('#1 the user\'s case: ground-only operators never hit a 近地悬浮 enemy (melee 山 / 泡泡, 迷迭香\'s ground-only shots); ranged 能天使 and the lord 银灰 do', () => {
  const cases = [
    ['chess_char_5_17_a', 10, 5, false],   // 山 (fighter, melee)
    ['chess_char_2_08_a', 10, 6, false],   // 泡泡 (protector, melee — standing on the floater's tile)
    ['chess_char_6_12_a', 10, 4, false],   // 迷迭香 (bombarder: "攻击对小范围的地面敌人造成…" — ranged but ground only)
    ['chess_char_3_01_a', 10, 4, true],    // 能天使 (fastshot, ranged)
    ['chess_char_4_22_a', 10, 5, true],    // 银灰 (lord: ranged reach, can hit air)
  ];
  for (const [chessId, row, col, hits] of cases) {
    const h = makeBattle({ units: [{ chessId, row, col }], seed: 3, autoFinish: false, timeLimit: 120, captureNoisy: true });
    h.step();
    const e = put(h, FLOATER, [10, 6], { mods: { hpMul: 100, atkMul: 0 } });
    assert.ok(e.isFlying && e.motion === 'WALK', 'an air unit on the ground path');
    h.run(20);
    const op = h.b.allyUnits.find((u) => u.kind === 'op');
    const d = dealt(h, op, e);
    assert.equal(d > 0, hits, `${op.name}: ${d}`);
    assert.ok(!e.blockedBy, `${op.name}: never blocks it`);
    checkInvariants(h.b);
  }
});

test('#1 ground-only splash spares a hovering enemy next to its ground target (迷迭香 + aftershocks)', () => {
  const h = makeBattle({ units: [{ chessId: 'chess_char_6_12_a', row: 10, col: 3 }], seed: 3, autoFinish: false, timeLimit: 120, captureNoisy: true, defs: SYN });
  h.step();
  const g = put(h, 'enemy_t_slime', [10, 6]);
  const e = put(h, FLOATER, [10, 6], { mods: { hpMul: 100, atkMul: 0 } });
  h.run(15);
  const op = h.b.allyUnits.find((u) => u.kind === 'op');
  assert.ok(dealt(h, op, g) > 0, 'the ground enemy is shot');
  assert.equal(dealt(h, op, e), 0, 'the floater on the same tile takes no splash');
});

test('#1 a 近地悬浮 enemy walks the ground path through blockers, cannot be displaced (失衡免疫) and ignores deep water', () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 9, col: 6 }] });
  h.step();
  const e = h.spawn(FLOATER, { routeIndex: 0, mods: { atkMul: 0 } });
  const ys = new Set();
  h.b.on('tick', () => { if (e.alive) ys.add(Math.round(e.y)); });
  h.runUntil(() => e.x < 5.5, 60);
  assert.ok(e.x < 5.5 && !e.blockedBy, 'passed the wall on (9,6)');
  assert.deepEqual([...ys], [9], 'stayed on its ground lane');
  const x0 = e.x;
  assert.equal(h.b.displace(e, { x: 1, y: 0 }, 2, { force: 3 }), 0);
  assert.equal(e.x, x0);
  // 深水 (act2 m04): the floater hovers over the water — no drowning damage or slow
  const w = makeBattle({ stageId: 'act2autochess_m04', autoFinish: false, timeLimit: 30,
    routes: [{ motion: 'WALK', start: [11, 6], end: [9, 2], checkpoints: [{ type: 'WAIT', time: 99 }] }],
    enemies: [{ key: FLOATER, route: { motion: 'WALK', start: [11, 6], end: [9, 2], checkpoints: [{ type: 'WAIT', time: 99 }] } }] });
  w.run(3);
  const f = w.enemy(FLOATER);
  assert.equal(f.hp, f.s.maxHp, 'not in the water');
  assert.equal(f.findBuff('terrain:deepsea'), null);
});

test('#1 掠海漂移体 stunned ⇒ 爬行模式 for good (PRTS): a ground unit — blocked, hit by melee — that only attacks its blocker', () => {
  const h = arena({ units: [{ chessId: 't_blade', row: 10, col: 5 }, { chessId: 't_gun', row: 12, col: 3 }] });
  h.step();
  const e = put(h, FLOATER, [10, 6], { mods: { hpMul: 100 } });
  const blade = h.unit('t_blade'), gun = h.unit('t_gun');
  h.run(3);
  assert.equal(dealt(h, blade, e), 0, 'floating: the blade cannot hit it');
  assert.ok(e.stats.attacks > 0, 'floating: attacks at range');
  assert.ok(h.b.applyStatus(e, 'stun', { duration: 0.2, source: gun }));
  assert.ok(!e.isFlying && !e.s.flags.unblockable && !e.s.flags.noDisplace, 'crawling: a ground unit');
  approx(e.findBuff('stun').timeLeft, 0.5, 1e-9, 'the 0.5 s drop stun (the longer one)');
  assert.ok(e.profile.melee, '仅进行阻挡攻击');
  h.run(3);
  assert.ok(dealt(h, blade, e) > 0, 'the blade hits it now');
  // walking again it is blocked by a ground operator on its way
  const h2 = arena({ units: [{ chessId: 't_wall', row: 9, col: 6 }] });
  h2.step();
  const e2 = h2.spawn(FLOATER, { routeIndex: 0, mods: { atkMul: 0 } });
  h2.b.applyStatus(e2, 'freeze', { duration: 0.5 });
  h2.runUntil(() => !!e2.blockedBy || e2.x < 5.5, 60);
  assert.equal(e2.blockedBy, h2.unit('t_wall'), '冻结 drops it too; then the wall blocks it');
});

test('#1 吉兆飞鳞: a stun grounds it for Stun.duration s (unblockable), then it floats again; a freeze grounds it when it ends', () => {
  const h = arena();
  h.step();
  const e = put(h, PARROT, [10, 7]);
  const down = e.mem.ab.t['Stun.duration'];
  assert.ok(down > 0 && e.isFlying);
  h.b.applyStatus(e, 'stun', { duration: 0.5 });
  assert.ok(!e.isFlying && e.s.flags.unblockable, '晕眩模式: no float, still unblockable');
  approx(e.findBuff('stun').timeLeft, down, 1e-9);
  h.run(down - 0.2);
  assert.ok(!e.isFlying);
  h.run(0.4);
  assert.ok(e.isFlying && e.s.flags.noDisplace, 'floats again (初始模式)');
  h.b.applyStatus(e, 'freeze', { duration: 1 });
  h.run(0.5);
  assert.ok(e.isFlying, 'frozen: still floating');
  h.run(0.6);
  assert.ok(!e.isFlying && e.findBuff('stun'), '【失温坠落】: grounded when the freeze ends');
  // "离开上述异常效果影响后进入初始模式": a sleep that outlasts the mode stun keeps it down until the sleep ends
  const z = put(h, PARROT, [11, 7]);
  assert.ok(h.b.applyStatus(z, 'sleep', { duration: down + 3 }));
  h.run(down + 0.5);
  assert.ok(!z.isFlying && z.s.flags.sleep && !z.findBuff('stun'), 'asleep after the 8 s stun: still grounded');
  h.run(3);
  assert.ok(z.isFlying && !z.s.flags.sleep, 'awake: floats again');
});

test('#1 浮空 (levitate) makes a ground enemy an air unit (melee cannot hit it); data flyers and levitated units refuse it, a 近地悬浮 enemy does not', () => {
  const h = arena({ units: [{ chessId: 't_blade', row: 10, col: 5 }] });
  h.step();
  const g = put(h, 'enemy_t_slime', [10, 6]);
  const blade = h.unit('t_blade');
  assert.ok(canTargetEnemy(blade, g, blade.profile));
  assert.ok(h.b.applyStatus(g, 'levitate', { duration: 3 }));
  assert.ok(g.isFlying && !canTargetEnemy(blade, g, blade.profile) && canTargetEnemy(blade, g, { canHitFly: true }));
  // PRTS 行动方式: "行动类型（数据）为飞行的单位、以及已持有浮空异常的单位无法被施加浮空Buff"
  assert.equal(h.b.applyStatus(g, 'levitate', { duration: 3 }), false, 'already levitated');
  assert.equal(h.b.applyStatus(put(h, 'enemy_t_bat', [9, 6]), 'levitate', { duration: 3 }), false, 'a data flyer');
  // 近地悬浮 is WALK in the data: it can be levitated; 浮空 is none of 掠海漂移体's drop triggers (晕眩/无法行动/沉睡/冻结/缚地)
  const f = put(h, FLOATER, [11, 6]);
  assert.ok(h.b.applyStatus(f, 'levitate', { duration: 3 }), 'a hovering enemy can be levitated');
  assert.ok(f.isFlying && f.s.flags.stun && f.findBuff('ab:float'), 'levitated: helpless, still an air unit, still hovering');
  assert.ok(!f.profile.melee, 'not in 爬行模式');
  h.run(3.1);
  assert.ok(!g.isFlying && canTargetEnemy(blade, g, blade.profile), 'back on the ground');
  assert.ok(f.isFlying && f.findBuff('ab:float') && !f.s.flags.levitate && !f.profile.melee, 'the floater keeps hovering');
});

/**
 * Chess `id` with skill `skillIndex` at (10, col) next to a pinned floating 掠海漂移体 and a ground bait on (10, 6); the
 * skill is refilled every second for `secs` s. Returns the damage its side (the operator, its summons) dealt to the bait
 * and — only while it still hovered — to the floater, per damage tag.
 */
function floaterDuel(id, skillIndex, { col = 5, secs = 30 } = {}) {
  const BAIT = enemyRec({ key: 'enemy_t_bait', hp: 1e9, atk: 0, speed: 0 });
  const h = makeBattle({ units: [{ chessId: id, row: 10, col, skillIndex }], seed: 3, autoFinish: false, timeLimit: 200, captureNoisy: true, defs: { enemies: { enemy_t_bait: BAIT } } });
  h.step();
  const f = put(h, FLOATER, [10, 6], { mods: { hpMul: 1e5, atkMul: 0 } });
  const g = put(h, 'enemy_t_bait', [10, 6]);
  const out = { floater: 0, bait: 0, floaterTags: new Map() };
  h.b.on('damaged', (c) => {
    if (!c.source || c.source.side !== 'ally' || !(c.amount > 0)) return;
    if (c.target === g) out.bait += c.amount;
    if (c.target !== f || !f.findBuff('ab:float')) return;
    out.floater += c.amount;
    for (const t of c.dmg?.tags || ['-']) out.floaterTags.set(t, (out.floaterTags.get(t) || 0) + c.amount);
  });
  const op = h.b.allyUnits.find((u) => u.kind === 'op');
  for (let t = 0; t < secs; t++) {
    if (op.skill && !op.skill.active) op.skill.gainSp(op.skill.spCost * (op.skill.maxCharges || 1) + 1, 'test');
    h.run(1);
  }
  assert.deepEqual(h.b.errors.map((e) => `${e.label} ${e.message}`), []);
  return out;
}

test('#1 ground-only skills and talents spare a hovering enemy (the worst 731a01c offenders + the PRTS "不可对空" notes)', () => {
  const cases = [
    ['chess_char_6_19_a', 1, 5, '锏 S2 无声的嘲笑'],
    ['chess_char_6_07_a', 0, 5, '维娜·维多利亚 S1 重铸晖光'],
    ['chess_char_5_06_a', 2, 5, '隐德来希 S3 灵与欲的惜别'],
    ['chess_char_6_12_a', 2, 4, '迷迭香 S3 “如你所愿”'],
    ['chess_char_5_06_a', 1, 5, '隐德来希 S2 绯红壁合 (PRTS 备注: 血镰 可对空 only on a 起飞 carrier)'],
    ['chess_char_5_13_a', 1, 5, '归溟幽灵鲨 拥抱自我 (PRTS 备注: "伤害与减速不可对空")'],
    ['chess_char_3_04_a', 2, 5, '琳琅诗怀雅 S3 千金一掷 (PRTS 备注: 地面敌方单位, 弹道不可对空)'],
    ['chess_char_5_05_a', 0, 5, '乌尔比安 S1 必须促成的接触 (捕网, like 雪雉\'s "不对空" net)'],
  ];
  for (const [id, idx, col, name] of cases) for (const cid of [id, id.replace(/_a$/, '_b')]) {
    const r = floaterDuel(cid, idx, { col });
    assert.ok(r.bait > 0, `${name} (${cid}): the ground bait is hit`);
    assert.equal(r.floater, 0, `${name} (${cid}): ${JSON.stringify([...r.floaterTags])}`);
  }
});

test('#1 skills PRTS marks "可对空" still hit a hovering enemy (德克萨斯 S2 剑雨, 焰尾 S2 “红松林”, 锏 S3 归于宁静)', () => {
  // 锏 S3: PRTS 备注 "※可对空。不会拖拽自身中心半径0.6708范围内的敌人" (user playtest #6, WF audit — it used to sit in the
  // ground-only list above)
  for (const [id, idx, tag, name] of [['chess_char_1_08_a', 1, 'skill', '德克萨斯 S2'], ['chess_char_4_19_a', 1, 'redPine', '焰尾 S2'], ['chess_char_6_19_a', 2, 'slash', '锏 S3']]) {
    const r = floaterDuel(id, idx);
    assert.ok((r.floaterTags.get(tag) || 0) > 0, `${name}: ${JSON.stringify([...r.floaterTags])}`);
  }
});

test('#1 阿罗玛\'s bubble levitates a hovering 掠海漂移体 (WALK in its data) without dropping it to 爬行模式', () => {
  const h = makeBattle({ units: [{ chessId: 'chess_char_4_10_a', row: 10, col: 3 }], seed: 3, autoFinish: false, timeLimit: 60 });
  h.step();
  const f = put(h, FLOATER, [10, 6], { mods: { hpMul: 100, atkMul: 0 } });
  h.runUntil(() => h.hooksOf('statusApplied').some((c) => c.target === f && c.status === 'levitate'), 10);
  const lev = h.hooksOf('statusApplied').find((c) => c.target === f && c.status === 'levitate');
  assert.ok(lev, 'levitated by her first hit');
  assert.ok(f.isFlying && f.findBuff('ab:float') && !f.profile.melee, 'still hovering, not crawling');
});

test('#1 HOVER_KEYS lists exactly the enemies that spawn hovering (the match\'s bot counts them as air units)', () => {
  const E = JSON.parse(fs.readFileSync(new URL('../../data/enemies.json', import.meta.url), 'utf8'));
  const h = arena();
  h.step();
  const hov = [];
  for (const key of Object.keys(E)) {
    const e = put(h, key, [10, 6]);
    if (e && e.findBuff('ab:float')) hov.push(key);
  }
  assert.deepEqual(hov.sort(), [...enemiesMod.HOVER_KEYS].sort());
});

// ---------------------------------------------------------------------------------------------------------------
// #5 enemy target order

/** The ally the latest attack of `enemy` targeted. */
function lastTarget(h, enemy) {
  const ev = h.eventsOf('atk').filter((x) => x[1] === enemy.id).pop();
  return ev ? h.b.unitById(ev[2]) : null;
}

test('#5 unblocked ranged enemies: highest taunt, then the latest deployed — the rightmost column, its bottom (从上到下 > 从左到右: down each column, the columns left to right)', () => {
  const units = [[12, 5], [11, 3], [9, 4], [9, 7], [10, 8], [12, 8]].map(([row, col], i) => ({ chessId: 't_wall', row, col, uid: i + 1 }));
  const h = arena({ units, enemies: [{ key: 'enemy_t_shooter', pos: [10.5, 6] }] });
  h.step();
  const order = h.hooksOf('deploy').filter((c) => c.initial).map((c) => [c.unit.tileR, c.unit.tileC]);
  assert.deepEqual(order, [[11, 3], [9, 4], [12, 5], [9, 7], [12, 8], [10, 8]]);
  h.run(1.2);
  const e = h.enemy('enemy_t_shooter');
  const t = lastTarget(h, e);
  assert.deepEqual([t.tileR, t.tileC], [10, 8], 'the last deployed');
  // a taunt level beats deployment order
  const h2 = arena({ units, enemies: [{ key: 'enemy_t_shooter', pos: [10.5, 6] }] });
  h2.step();
  h2.b.addBuff(h2.unit(1), { key: 'test:taunt', mods: { taunt: 1 }, persist: true });
  h2.run(1.2);
  assert.equal(lastTarget(h2, h2.enemy('enemy_t_shooter')), h2.unit(1));
});

test('#5 the initial deployment puts every operator before the summons (PRTS 卫戍协议/帮助) — a summon piece draws the fire', () => {
  const tok = { kind: 'token', tokenId: 'token_10028_vigil_wolf', ownerUid: 1, row: 12, col: 4, uid: 3, def: { name: 'tok', stats: { maxHp: 1e7, atk: 0, blockCnt: 0 } } };
  const h = arena({ units: [{ chessId: 't_wall', row: 12, col: 3, uid: 1 }, { chessId: 't_wall', row: 9, col: 8, uid: 2 }, tok], enemies: [{ key: 'enemy_t_shooter', pos: [10.5, 6] }] });
  h.step();
  const order = h.hooksOf('deploy').filter((c) => c.initial).map((c) => c.unit.uid);
  assert.deepEqual(order, [1, 2, 3], 'the operators (by column from the left), then the summon');
  const t = h.unit(3);
  assert.ok(t.aggroSeq > h.unit(1).aggroSeq && t.aggroSeq > h.unit(2).aggroSeq);
  h.run(1.2);
  assert.equal(lastTarget(h, h.enemy('enemy_t_shooter')), t);
  // a summon an operator brings along at the start ranks after every operator too
  const h2 = arena({ units: [{ chessId: 't_wall', row: 12, col: 3, uid: 1 }, { chessId: 't_wall', row: 9, col: 8, uid: 2 }], enemies: [{ key: 'enemy_t_shooter', pos: [10.5, 6] }],
    setup: (b) => b.on('deploy', (c) => { if (c.initial && c.unit.uid === 1) b.spawnToken(c.unit, 'token_10028_vigil_wolf', 12, 4, { def: { name: 'tok', stats: { maxHp: 1e7, atk: 0, blockCnt: 0 } } }); }) });
  h2.step();
  const s = h2.b.allyUnits.find((u) => u.kind === 'token');
  assert.ok(s.deploySeq < h2.unit(2).deploySeq, 'it came in during the first operator\'s deployment');
  assert.ok(s.aggroSeq > h2.unit(2).aggroSeq, '…but ranks after every operator');
  h2.run(1.2);
  assert.equal(lastTarget(h2, h2.enemy('enemy_t_shooter')), s);
  // a redeployed operator is the latest deployed again
  h2.b.retreat(h2.unit(1), { reason: 'retreat' });
  h2.b.redeploy(h2.unit(1), { free: true });
  assert.ok(h2.unit(1).aggroSeq > s.aggroSeq);
});

test('#5 a blocked ranged enemy attacks its blocker first', () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 10, col: 6, uid: 1 }, { chessId: 't_wall', row: 9, col: 7, uid: 2 }], enemies: [{ key: 'enemy_t_shooter', pos: [10, 6] }] });
  h.step();
  h.run(1.2);
  const e = h.enemy('enemy_t_shooter');
  assert.equal(e.blockedBy, h.unit(1));
  assert.equal(lastTarget(h, e), h.unit(1), 'not the later-deployed one beside it');
});

test('#5 隐匿 / 迷彩 allies: only the enemy they block attacks them — blocking does not expose them to other ranged enemies (PRTS 作战机制 §隐匿, 索敌的概念)', () => {
  const units = [{ chessId: 't_wall', row: 12, col: 5, uid: 1 }, { chessId: 't_wall', row: 9, col: 7, uid: 2 }];
  const mk = (stealth) => {
    const h = arena({ units, enemies: [{ key: 'enemy_t_shooter', pos: [10.5, 5] }, { key: 'enemy_t_shooter', pos: [9, 7] }] });
    h.step();
    if (stealth) h.b.applyStatus(h.unit(2), 'stealth', { duration: 99 });
    h.run(1.2);
    const held = h.b.enemies.find((e) => e.blockedBy === h.unit(2));
    const free = h.b.enemies.find((e) => e !== held);
    assert.ok(held && free && !free.blockedBy);
    return { h, held, free };
  };
  const a = mk(true);
  assert.equal(lastTarget(a.h, a.held), a.h.unit(2), 'the enemy it blocks attacks it ("强行无视对方可选性")');
  assert.equal(lastTarget(a.h, a.free), a.h.unit(1), 'an unblocked ranged enemy skips it although it blocks ("我方干员并不会因为阻挡而解除隐匿")');
  const b = mk(false);
  assert.equal(lastTarget(b.h, b.free), b.h.unit(2), 'control: without stealth the latest deployed is shot');
  // 排气格栅 (烟雾) uses the same stealth flag: test/content/tokens_devices.test.js
});

test('#5 an enemy\'s own rule filters its candidates first: 萨卡兹枯朽战车 (只攻击地面单位) shoots the ground operator, never idles', () => {
  // (10,2) is high ground: that operator deploys last (row 10 after row 11) and would be the preferred target
  const h = arena({ units: [{ chessId: 't_wall', row: 11, col: 5, uid: 1 }, { chessId: 't_wall', row: 10, col: 2, uid: 2 }] });
  h.step();
  assert.equal(h.unit(2).ground, false);
  const e = put(h, 'enemy_1272_nhtank', [10, 4], { mods: { atkMul: 0.01 } });
  h.runUntil(() => e.stats.attacks >= 2, 20);
  assert.ok(e.stats.attacks >= 2, 'it attacks');
  const targets = h.eventsOf('atk').filter((x) => x[1] === e.id).map((x) => x[2]);
  assert.ok(targets.every((id) => id === h.unit(1).id), 'only the ground operator');
  // PRTS 天赋 "普通攻击只攻击位于低地的我方单位，且不会攻击飞行单位": a flying ally on a low tile (the 炎佑 dragon) is no target
  const h2 = arena({ units: [{ chessId: 't_wall', row: 11, col: 5, uid: 1 }, { chessId: 't_wall', row: 10, col: 5, uid: 2 }] });
  h2.step();
  h2.unit(2).motion = 'FLY';
  assert.ok(h2.unit(2).ground && h2.unit(2).isFlying);
  const e2 = put(h2, 'enemy_1272_nhtank', [10, 4], { mods: { atkMul: 0.01 } });
  h2.runUntil(() => e2.stats.attacks >= 2, 20);
  assert.ok(e2.stats.attacks >= 2);
  assert.ok(h2.eventsOf('atk').filter((x) => x[1] === e2.id).every((x) => x[2] === h2.unit(1).id), 'never the flyer');
});

test('#5 “萨科塔之眼” (不会攻击飞行单位) filters its candidates: it shoots the ground ally, never the later-deployed flyer', () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 11, col: 5, uid: 1 }, { chessId: 't_wall', row: 10, col: 5, uid: 2 }] });
  h.step();
  h.unit(2).motion = 'FLY';
  const e = put(h, 'enemy_10084_hlegle', [10.5, 5.5], { mods: { atkMul: 0.01 } });
  h.runUntil(() => e.stats.attacks >= 2, 20);
  assert.ok(e.stats.attacks >= 2, 'it attacks');
  assert.ok(h.eventsOf('atk').filter((x) => x[1] === e.id).every((x) => x[2] === h.unit(1).id), 'only the ground ally');
});

test('#5 a shared field (boss / 联防) deploys the players side by side — the i-th operators together, then the summons [ASSUMED]', () => {
  const W = chessRec({ id: 't_w', profession: 'TANK', stats: { atk: 0, maxHp: 1e7, blockCnt: 3 }, rangeGrid: [[0, 0]], skill: null });
  const tok = { kind: 'token', tokenId: 'token_10028_vigil_wolf', ownerUid: 1, row: 12, col: 6, uid: 5, def: { name: 'tok', stats: { maxHp: 1e7, atk: 0, blockCnt: 0 } } };
  const h = makeBattle({ kind: 'boss', content: 'none', autoFinish: false, defs: { chess: { t_w: W } },
    players: [
      { playerId: 'L1', side: 'L', colOffset: 0, units: [{ uid: 1, chessId: 't_w', row: 12, col: 4 }, { uid: 2, chessId: 't_w', row: 11, col: 4 }, { uid: 3, chessId: 't_w', row: 10, col: 4 }, tok] },
      { playerId: 'R1', side: 'R', colOffset: 8, units: [{ uid: 4, chessId: 't_w', row: 12, col: 4 }] },
    ] });
  h.step();
  assert.deepEqual(h.hooksOf('deploy').filter((c) => c.initial).map((c) => c.unit.uid), [1, 4, 2, 3, 5],
    'not every left operator before the right one: at equal taunt the leader does not always prefer one player');
  const seq = (uid) => h.b.allyUnits.find((u) => u.uid === uid).aggroSeq;
  assert.ok(seq(5) > Math.max(seq(1), seq(2), seq(3), seq(4)), 'the summon ranks after every operator');
});

test('#5 a special priority breaks ties by taunt, then the latest deployed (假想敌：铳 "优先攻击防御力最高的单位"; PRTS 索敌: 特殊优先级 → 仇恨值)', () => {
  const pool = { hp: 1e7, maxHp: 1e7, damage(pid, a) { this.hp = Math.max(0, this.hp - a); } };
  const duel = (taunt) => {
    const h = makeBattle({ kind: 'boss', sharedBoss: pool, content: 'generic', extraContent: [enemiesMod, bossesMod], seed: 7, autoFinish: false, timeLimit: 600,
      defs: SYN, kits: { t_wall: NOATK }, units: [{ chessId: 't_wall', row: 10, col: 9, uid: 1 }, { chessId: 't_wall', row: 10, col: 11, uid: 2 }] });
    h.step();
    if (taunt) h.b.addBuff(h.unit(1), { key: 'test:taunt', mods: { taunt: 1 }, persist: true });
    const e = h.spawn('enemy_9017_achunt', { pos: [3, 10], routeIndex: 0, mods: { speedMul: 0 }, tag: 'boss' });
    h.runUntil(() => e.stats.attacks >= 1, 60);
    assert.ok(e.stats.attacks >= 1);
    assert.equal(h.unit(1).s.def, h.unit(2).s.def, 'equal DEF');
    return { h, t: lastTarget(h, e) };
  };
  const a = duel(false);
  assert.equal(a.t, a.h.unit(2), 'equal DEF: the latest deployed');
  const b = duel(true);
  assert.equal(b.t, b.h.unit(1), 'equal DEF: the higher taunt level first');
});
