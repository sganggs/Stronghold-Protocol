// test/sim/hud-readouts.test.js — the optional b.snap lists behind the HP-bar readouts (R22-HUD; PR #303 and #378 by
// @IceCodeNew, PR #383 by @Convey123): `ammo` (a running ammo skill's rounds — 隐现's S2 holds 14 in the data), `wolves`
// (伺夜's 狼群 count), `energy` (a 秘术师's stored attack energies — snapshot.js mysticView) and, in
// test/content/op_hsgma2.test.js, `neg` (斩业星熊's 我执 pool). All of them are display only: the nine-field unit tuples
// are unchanged and no sim state reads them. The client side is test/render/hud-readouts.test.js.
// Run: node --test test/sim/hud-readouts.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { unitInfo, unitTuple, mysticView } from '../../server/sim/snapshot.js';
import { getDefaultSource } from '../../server/sim/simdata.js';

const DUMMY = { enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 1e7, speed: 0 }) } };
const INSIDE = 'chess_char_1_01_a';   // 隐现: the chess skill index 1 is skchr_inside_2 (AMMO, attack@trigger_time 14)
const MYSTIC = 'chess_char_1_17_a';        // 深靛: 秘术师 (the trait times 3)
const MYSTIC_ELITE = 'chess_char_1_17_b';  // 深靛 elite (MSC-X, the trait times 4)
const VEEN = 'char_4226_veen';             // 维伊: 秘术师 whose kit keeps 转置能量 of its own (kit op-veen.js)

test('隐现 S2: b.snap `ammo` carries the whole rounds left and the 14-round magazine of the data; the tuple keeps its SP fraction', () => {
  const h = makeBattle({
    defs: DUMMY, timeLimit: 200, seed: 7,
    units: [{ chessId: INSIDE, row: 10, col: 3 }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 5] }],
  });
  const u = h.unit(INSIDE);
  const row = () => (h.b.snapshot().ammo || []).find((e) => e[0] === u.id);
  assert.equal(h.b.snapshot().ammo, undefined, 'no skill running: no list at all');
  assert.equal(unitInfo(u).ammoSkill, true, 'UnitInfo says the skill is an ammo magazine from the first appearance');
  assert.ok(h.runUntil(() => u.skill.active, 80));
  assert.equal(u.skill.kind, 'ammo');
  assert.equal(u.skill.ammoMax, 14, 'skill_table skchr_inside_2 attack@trigger_time at the chess skill level');
  // the activation tick already fired the first round
  assert.deepEqual(row(), [u.id, 13, 14]);
  const [, , , , , sp, spMax] = unitTuple(u, h.b.time);
  assert.ok(Math.abs(sp / spMax - 13 / 14) < 0.01, 'the 9-field tuple still runs the SP bar on the same fraction');
  assert.equal(h.b.snapshot().units.find((t) => t[0] === u.id).length, 9, 'the tuple is not widened');
  // every attack spends one round
  const before = u.skill.ammoLeft;
  assert.ok(h.runUntil(() => u.skill.ammoLeft < before, 10));
  assert.deepEqual(row(), [u.id, u.skill.ammoLeft, 14]);
  // a refill above the magazine raises it (拉特兰's extras, 逃犯引渡手续, refills: the activation's real total)
  u.skill.addAmmo(20);
  assert.deepEqual(row(), [u.id, u.skill.ammoLeft, u.skill.ammoMax]);
  assert.ok(u.skill.ammoMax > 14 && row()[1] === row()[2], 'full again at the new mark');
  // the skill ends with its last round: the list goes, the plain SP bar is back
  assert.ok(h.runUntil(() => !u.skill.active, 60));
  assert.equal(h.b.snapshot().ammo, undefined);
  checkInvariants(h.b);
  assert.deepEqual(h.b.errors, []);
});

test('ammo rows: whole numbers (a fractional count rounds up), allies only, living deployed units only; an operator without an ammo skill is no ammoSkill', () => {
  const h = makeBattle({
    defs: DUMMY, timeLimit: 200, seed: 7,
    units: [{ chessId: INSIDE, row: 10, col: 3 }, { chessId: 'chess_char_1_02_a', row: 11, col: 3 }],
    enemies: [{ key: 'enemy_dummy', pos: [10, 5] }],
  });
  const u = h.unit(INSIDE);
  h.run(0.5);
  assert.equal(unitInfo(h.unit('chess_char_1_02_a')).ammoSkill, undefined, 'a duration skill is not a magazine');
  assert.equal(unitInfo(h.enemy('enemy_dummy')).ammoSkill, undefined);
  assert.ok(h.runUntil(() => u.skill.active, 80));
  u.skill.ammoLeft = 6.2;                    // (a kit that spends a share of a round)
  const e = h.b.snapshot().ammo.find((r) => r[0] === u.id);
  assert.deepEqual(e, [u.id, 7, 14]);
  assert.ok(Number.isInteger(e[1]) && Number.isInteger(e[2]));
  u.deployed = false;                        // off the field: no row (the unit is not in the snapshot either)
  assert.equal(h.b.snapshot().ammo, undefined);
  u.deployed = true;
});

for (const placed of [false, true]) {
  test(`伺夜's ${placed ? 'placed' : 'automatic'} pack: b.snap \`wolves\` follows the 狼影 count (2 of 3, +1 per 25 s, one lost per lethal hit) and goes with the pack`, () => {
    const units = [{ chessId: 'chess_char_3_19_a', row: 12, col: 3, uid: 1 }];
    if (placed) units.push({ kind: 'token', tokenId: 'token_10028_vigil_wolf', ownerUid: 1, row: 11, col: 5, uid: 2 });
    const h = makeBattle({
      units, timeLimit: 120,
      defs: { enemies: { enemy_d: enemyRec({ key: 'enemy_d', hp: 1e9, speed: 0, atk: 0 }) } },
      enemies: [{ key: 'enemy_d', pos: [1, 1] }],
    });
    h.run(0.2);
    const w = h.b.allyUnits.find((u) => u.defId === 'token_10028_vigil_wolf');
    const count = () => (h.b.snapshot().wolves || []).find((e) => e[0] === w.id);
    assert.deepEqual(count(), [w.id, 2, 3], '初始两只, at most 3 (the talent text)');
    assert.equal(h.b.snapshot().wolves.length, 1, 'only the pack has the row: 伺夜 herself does not');
    h.run(25);
    assert.deepEqual(count(), [w.id, 3, 3], '+1 every 25 s');
    for (const left of [2, 1]) {
      h.b.dealDamage(null, w, { amount: 1e9, type: 'true' });
      assert.deepEqual(count(), [w.id, left, 3], 'a lethal hit spends one 狼影 and refills the HP');
    }
    h.b.dealDamage(null, w, { amount: 1e9, type: 'true' });
    assert.equal(w.alive, false, 'the last 狼影: 战术点形态 (the pack is out of the fight)');
    assert.equal(count(), undefined, 'a pack in that form shows no pips');
    h.run(26);
    assert.deepEqual(count(), [w.id, 1, 3], 'back after the 狼影 interval with one 狼影');

    h.b.retreat(h.unit('chess_char_3_19_a'), { reason: 'expired', permanent: true });
    assert.equal(h.b.snapshot().wolves, undefined, 'the pack leaves with its owner');
    assert.deepEqual(h.b.errors, []);
  });
}
const MOWANG = 'chess_char_4_25_a';     // 魔王: T1 过往尘埃 keeps three 「微尘」 circling her
const OTHER = 'chess_char_1_01_a';      // a plain second operator for the motes to touch

test('魔王 T1 过往尘埃: b.snap `motes` carries the orbiting count — 3, one less when a mote touches an operator, 3 again 6 s later', () => {
  const h = makeBattle({
    defs: DUMMY, timeLimit: 300, seed: 5, autoFinish: false,
    units: [{ chessId: MOWANG, row: 10, col: 3 }, { chessId: OTHER, row: 10, col: 4, uid: 2 }],
  });
  const her = h.unit(1), other = h.unit(2);
  h.step();                                    // 开场：单位进场后快照才带上她们
  const row = (id) => (h.b.snapshot().motes || []).find((e) => e[0] === id);
  assert.deepEqual(row(her.id), [her.id, 3, 0], '三枚都出来了');
  assert.equal(row(other.id), undefined, '别的干员没有这条表');
  // 她的微尘每 0.25 s 扫一次：旁边的友方吃到 cetsyr:mote buff 的那一刻就少一枚
  assert.ok(h.runUntil(() => !!other.findBuff(`cetsyr:mote:${her.id}`), 10), '微尘碰到了旁边的干员');
  assert.deepEqual(row(her.id), [her.id, 2, 0], '撞掉一枚');
  // 同一名友方 6 秒内只会被撞一次（buff 期间 skip），所以第二枚要等这一轮过后才可能掉 —— 这里只验「重生」那一段
  h.run(1);
  assert.deepEqual(row(her.id), [her.id, 2, 0], '这轮里不再掉第二枚');
  // 6 秒后重生：旁边那名友方还在，所以重生出来的那一枚可能又被它撞掉 —— 这里只要求 3 枚确实回来过
  h.run(6.5);
  assert.equal((h.b.snapshot().motes || []).find((e) => e[0] === her.id)?.[2], 0, '半径标记始终是普通半径');
  h.runUntil(() => (row(her.id) || [])[1] === 3, 8);
  assert.deepEqual(row(her.id), [her.id, 3, 0], '重生回三枚');
  assert.equal(Array.isArray(h.b.snapshot().motes), true);
  checkInvariants(h.b);
});

test('魔王 S2 / S3: S2 补到六枚并给宽半径标记，S3 期间不再消耗（一直是三枚）', () => {
  for (const { skillIndex, want } of [{ skillIndex: 1, want: [6, 1] }, { skillIndex: 2, want: [3, 0] }]) {
    const h = makeBattle({
      defs: DUMMY, timeLimit: 300, seed: 5, autoFinish: false,
      units: [{ chessId: MOWANG, row: 10, col: 3, skillIndex }, { chessId: OTHER, row: 10, col: 4, uid: 2 }],
    });
    const her = h.unit(1), other = h.unit(2);
    h.step();
    const row = () => (h.b.snapshot().motes || []).find((e) => e[0] === her.id);
    assert.deepEqual(row(), [her.id, 3, 0], `技能未开：三枚（S${skillIndex + 1}）`);
    her.skill.gainSp(999);
    assert.ok(h.runUntil(() => her.skill.active, 45), `S${skillIndex + 1} 开起来`);
    assert.deepEqual(row(), [her.id, ...want], `S${skillIndex + 1} 的枚数与半径标记`);
    // 开技能后跑一会儿：S2 撞敌人（旁边的友方不再被撞）、S3 撞了也不消失
    h.run(4);
    assert.deepEqual(row(), [her.id, ...want], `S${skillIndex + 1} 期间不掉枚数`);
    // S3：「微尘」不再消失 —— 友方照样吃到 buff，但圈上仍是三枚（上面的断言已经覆盖），这里确认 buff 确实挂上了
    if (skillIndex === 2) assert.ok(other.findBuff(`cetsyr:mote:${her.id}`), 'S3 期间友方照样吃到 buff');
    checkInvariants(h.b);
  }
});

test('b.snap `motes` 只报活着的、已在场的她：撤退后整条表消失', () => {
  const h = makeBattle({
    defs: DUMMY, timeLimit: 300, seed: 5, autoFinish: false,
    units: [{ chessId: MOWANG, row: 10, col: 3 }],
  });
  const her = h.unit(1);
  h.step();
  assert.equal((h.b.snapshot().motes || []).length, 1);
  h.b.retreat(her, { reason: 'test' });
  assert.equal(h.b.snapshot().motes, undefined, '不在场了就不报');
});

/** 深靛 with the talent's random 柔光缚目 bind removed (prob 0): the store runs on its own here. */
function mysticField({ id = MYSTIC, enemies = [] } = {}) {
  const r = getDefaultSource().rawChess(id);
  const chess = { [id]: { ...r, talents: r.talents.map((t) => ({ ...t, bb: { ...t.bb, prob: 0 } })) } };
  return makeBattle({
    seed: 3, autoFinish: false, timeLimit: 300, captureNoisy: true,
    defs: { chess, enemies: { e: enemyRec({ key: 'e', hp: 1e9, speed: 0 }) } },
    units: [{ chessId: id, row: 10, col: 4 }], enemies,
  });
}

test('mysticView: [stored energies, the trait\'s cap], zero included — anything that is not a 秘术师 count is null', () => {
  const u = (o) => ({ side: 'ally', trait: { stored: 0 }, profile: { storeMax: 3 }, ...o });
  assert.deepEqual(mysticView(u({})), [0, 3], 'zero is a count, not an absent state');
  assert.deepEqual(mysticView(u({ trait: { stored: 2 } })), [2, 3]);
  assert.deepEqual(mysticView(u({ trait: { stored: 9 } })), [3, 3], 'clamped to the cap');
  assert.deepEqual(mysticView(u({ trait: { stored: 4 }, profile: { storeMax: 4 } })), [4, 4], '深靛 elite (MSC-X, times 4)');
  assert.equal(mysticView(u({ trait: {} })), null, 'a kit that keeps a store of its own never sets trait.stored (维伊, 黑键)');
  assert.equal(mysticView(u({ trait: undefined })), null, 'not a 秘术师 at all');
  assert.equal(mysticView(u({ trait: { stored: 0.5 } })), null, 'a fractional count is no count');
  assert.equal(mysticView(u({ trait: { stored: -1 } })), null);
  assert.equal(mysticView(u({ profile: {} })), null, 'no cap: no readout');
  assert.equal(mysticView(u({ profile: { storeMax: 0 } })), null);
  assert.equal(mysticView(u({ side: 'enemy' })), null, 'enemies are never counted');
});

test('深靛: b.snap `energy` counts the stored energies under the HP bar — 1/3 at the first attack check, 3/3 full, 0/3 once they leave with an attack', () => {
  const h = mysticField();
  const u = h.unit(MYSTIC);
  const row = () => (h.b.snapshot().energy || []).find((e) => e[0] === u.id);
  assert.equal(h.b.snapshot().energy, undefined, 'nothing stored yet: no list at all');
  h.step();
  assert.equal(u.trait.stored, 1, 'no valid target: the first attack check stores one');
  assert.deepEqual(row(), [u.id, 1, 3]);
  assert.ok(h.runUntil(() => u.trait.stored === 3, 30), 'one per attack interval up to the trait times');
  assert.deepEqual(row(), [u.id, 3, 3], '最多3个');
  assert.equal(u.profile.storeMax, 3);
  h.spawn('e', { pos: [10, 6] });
  assert.ok(h.runUntil(() => u.trait.stored === 0, 5), 'a target in range: the lot leaves with that attack');
  assert.deepEqual(row(), [u.id, 0, 3], 'zero is a count: she is still a 秘术师 on the field');
  assert.equal(h.b.snapshot().units.find((t) => t[0] === u.id).length, 9, 'the tuple is not widened');
  checkInvariants(h.b);
  assert.deepEqual(h.b.errors, []);
});

test('深靛 elite (the MSC-X module): the same row runs to the module\'s 4', () => {
  const h = mysticField({ id: MYSTIC_ELITE });
  const u = h.unit(MYSTIC_ELITE);
  assert.equal(u.profile.storeMax, 4);
  assert.ok(h.runUntil(() => u.trait.stored === 4, 45));
  assert.deepEqual((h.b.snapshot().energy || []).find((e) => e[0] === u.id), [u.id, 4, 4]);
  assert.deepEqual(h.b.errors, []);
});

test('only a 秘术师 has the row — 隐现 (a 速射手) never does — and a 秘术师 off the field drops out of the list', () => {
  const h = makeBattle({
    defs: DUMMY, timeLimit: 200, seed: 7,
    units: [{ chessId: INSIDE, row: 10, col: 3 }, { chessId: MYSTIC, row: 11, col: 4 }],
    enemies: [],
  });
  const u = h.unit(MYSTIC);
  h.step();
  assert.deepEqual(h.b.snapshot().energy, [[u.id, 1, 3]], 'one row, for the 秘术师 alone');
  u.deployed = false;                        // off the field: no row (the unit is not in the snapshot either)
  assert.equal(h.b.snapshot().energy, undefined);
  u.deployed = true;
  checkInvariants(h.b);
  assert.deepEqual(h.b.errors, []);
});

test('a 秘术师 whose kit keeps a store of its own (维伊\'s 转置能量) reports no `energy` row: her count is not the trait\'s', () => {
  const h = makeBattle({
    defs: { enemies: { e: enemyRec({ key: 'e', hp: 1e9, speed: 0 }) } }, timeLimit: 300, autoFinish: false, seed: 5,
    units: [{ uid: 1, diy: { slot: 'chess_char_5_diy1_a', charId: VEEN, skillIndex: 0, uniEquipId: null }, elite: false, row: 10, col: 5 }],
  });
  const u = h.unit(1);
  assert.ok(h.runUntil(() => (u.trait.veen?.t ?? 0) > 0, 60), 'she stores 转置能量 with no target on the field');
  assert.equal(u.trait.stored, undefined, 'the shared trait counter is never touched');
  assert.equal(h.b.snapshot().energy, undefined, 'nothing to count: no row, and no misleading zero');
  checkInvariants(h.b);
  assert.deepEqual(h.b.errors, []);
});
