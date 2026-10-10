// test/sim/feedback2-surtr-stealth.test.js — GitHub issues after 0.1.1 (DESIGN §22.7, §22.8):
//   #52 史尔特尔 余烬 (PRTS 天赋备注 "触发本天赋后，获得禁疗与不死"; 异常效果 禁疗 HEAL_FREE "无法成为治疗类能力的目标，且受到
//       的治疗量变为0", an HP-regen attribute excepted; 技能3 备注 "（无视禁疗）"): v0.1.1 kept healing her during the 8 s —
//       medics picked her as the lowest HP ratio and wasted their heals on a unit that leaves anyway.
//   #43 follow-up — PRTS 作战机制 §隐匿 "对于绝大部分可隐匿的敌人而言，在被我方单位阻挡后会解除隐匿，不被阻挡的3秒后重新进入隐匿"
//       (and the enemy pages' "（解除阻挡N秒后恢复）"): v0.1.1 hid an enemy again 1 tick after its block ended. Our operators'
//       隐匿 is never lifted by blocking. A 深池逐火 ember gains a new 隐匿 source after its warrior's block ends;
//       only blocking the ember itself can start that source's 3 s restore window (PRTS 深池逐火战士 天赋).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import * as enemiesMod from '../../server/sim/content/enemies.js';
import { canTargetEnemy, canTargetAlly, enemyStealthed, stealthOffKey } from '../../server/sim/targeting.js';
import { flagsOf } from '../../server/sim/snapshot.js';
import { STEALTH_RESTORE } from '../../server/sim/constants.js';
import { UF } from '../../shared/constants.js';
import { statusIconKey } from '../../public/js/render/style.js';
import { STATUS_KEYS } from '../../public/js/render/textures.js';

const { HUSK_REBIRTH } = enemiesMod;
const clean = (h) => { assert.deepEqual(h.b.errors.map((e) => `${e.label}: ${e.message}`), []); checkInvariants(h.b); };

// ---------------------------------------------------------------------------------------------------------------
// #52 史尔特尔 余烬: 禁疗 + 不死 until the forced exit

const SURTR = 'chess_char_5_07_a', MEDIC = 'chess_char_2_02_a' /* 赫默 */, TANK = 'chess_char_1_04_a' /* 深巡 */;
const DUMMY = enemyRec({ key: 'enemy_dummy', hp: 1e9, speed: 0, atk: 0 });
const lethal = (h, u) => h.b.dealDamage(null, u, { amount: 1e9, type: 'true', canDodge: false });
const waitOf = (u) => (u.def.raw.talents || []).find((t) => t.index === 1).bb['surtr_t_2[withdraw].interval'];

describe('#52 史尔特尔 余烬: 禁疗 from the lethal blow until she leaves', () => {
  test('a medic beside her heals the other injured operator instead — 0 heals reach her, she is never its target, she still leaves at 9 s (8 + the potential step); the 禁疗 status is shown', () => {
    const h = makeBattle({
      defs: { enemies: { enemy_dummy: DUMMY } }, autoFinish: false, timeLimit: 200, seed: 2,
      units: [
        { chessId: SURTR, row: 9, col: 5, dir: 'RIGHT', skillIndex: 0, carryState: { sp: 0 } },
        { chessId: MEDIC, row: 9, col: 4, dir: 'RIGHT' },     // her range covers (9,5) and (10,5)
        { chessId: TANK, row: 10, col: 5, dir: 'RIGHT' },
      ],
      enemies: [{ key: 'enemy_dummy', pos: [9, 9] }],
    });
    const s = h.unit(SURTR), medic = h.unit(MEDIC), tank = h.unit(TANK);
    const wait = waitOf(s);
    assert.equal(wait, 9, 'data: surtr_t_2[withdraw].interval (8 s, 9 at full potential)');
    h.run(1);
    const healed = new Map();
    const picked = new Set();
    h.b.on('heal', (c) => { if (c.amount > 0) healed.set(c.target, (healed.get(c.target) ?? 0) + c.amount); }, { priority: -9999 });
    h.b.on('attack', (c) => { if (c.attacker === medic) for (const t of c.targets) picked.add(t); }, { priority: -9999 });
    tank.hp = tank.s.maxHp * 0.5;
    lethal(h, s);
    const t0 = h.b.time;
    assert.ok(s.alive && s.deployed && s.hp >= 1 && s.hp < 2, '余烬: HP held at 1');
    assert.ok(s.s.flags.noHeal && s.s.flags.healFree, '禁疗: no heal pick, no heal at all');
    const on = h.eventsOf('status').filter((ev) => ev[1] === s.id && ev[2] === 'healFree');
    assert.deepEqual(on.map((ev) => ev[3]), [1], 'the status 禁疗 is reported to the clients');
    assert.equal(statusIconKey('healFree'), 'healFree');
    assert.ok(STATUS_KEYS.includes('healFree'), 'and drawn in the status atlas');
    // 不死: a second lethal blow inside the window changes nothing (and does not restart the 9 s)
    h.run(3);
    lethal(h, s);
    assert.ok(s.alive && s.hp >= 1);
    h.run(wait - 3 - 0.2);
    assert.ok(s.alive && s.deployed, 'still on the field just before 9 s');
    assert.ok(s.hp < 2, 'nobody healed her');
    assert.equal(healed.get(s) ?? 0, 0, '0 heals to her');
    assert.ok(!picked.has(s), 'the medic never picks her');
    assert.ok((healed.get(tank) ?? 0) > 0 && picked.has(tank), 'the medic heals the other injured operator instead');
    h.run(0.4);
    assert.equal(s.deployed, false, 'she leaves at 9 s');
    assert.equal(s.removeReason, 'retreat', '"强制退出战场视为撤回干员"');
    assert.ok(h.b.time - t0 <= wait + 0.25);
    const ev = h.eventsOf('status').filter((e) => e[1] === s.id && e[2] === 'healFree').map((e) => e[3]);
    assert.deepEqual(ev, [1, 0], 'the status ends with her stay');
    clean(h);
  });

  test('her own heals stop too (休眠子裔), an HP-regen attribute does not, and S3 黄昏\'s start heal ignores 禁疗 (PRTS 技能3 备注) — she still leaves at 9 s', () => {
    const mk = (o = {}) => makeBattle({
      defs: { enemies: { enemy_dummy: DUMMY } }, autoFinish: false, timeLimit: 200, seed: 2,
      units: [{ chessId: SURTR, row: 9, col: 5, dir: 'RIGHT', carryState: { sp: 0 }, ...o }],
      enemies: [{ key: 'enemy_dummy', pos: [9, 6] }],
    });
    // control: 休眠子裔 ("每攻击1个目标，回复自身2%最大生命值") heals her while she is not under 禁疗
    const h0 = mk({ skillIndex: 0, items: ['chess_item_4_06_e_a'] });
    const c = h0.unit(SURTR);
    h0.run(1);
    c.hp = c.s.maxHp * 0.5;
    h0.run(3);
    assert.ok(c.hp > c.s.maxHp * 0.5 + 1, 'control: the item heals her on attack');
    // under 禁疗 it gives nothing; an HP-regen attribute still works
    const h = mk({ skillIndex: 0, items: ['chess_item_4_06_e_a'] });
    const s = h.unit(SURTR);
    h.run(1);
    lethal(h, s);
    const atk0 = s.stats.attacks;
    h.run(3);
    assert.ok(s.stats.attacks > atk0, 'she keeps attacking');
    assert.ok(s.hp < 2, '休眠子裔: no heal under 禁疗');
    h.b.addBuff(s, { key: 'test:regen', mods: { hpRegen: 100 } });
    h.run(2);
    assert.ok(s.hp > 150, `生命回复速度 is no 治疗类能力: regen still applies (${s.hp.toFixed(0)})`);
    // S3 黄昏 starting inside the window: "立即恢复所有生命（无视禁疗）"
    const h3 = mk();
    const u = h3.unit(SURTR);
    assert.equal(u.skill.id, 'skchr_surtr_3');
    h3.run(1);
    lethal(h3, u);
    const t0 = h3.b.time;
    h3.run(1);
    assert.ok(u.hp < 2 && !u.skill.active);
    u.skill.gainSp(1000);
    assert.ok(h3.runUntil(() => u.skill.active, 3), 'S3 starts');
    assert.ok(u.hp > u.s.maxHp - 50, 'healed to full in spite of 禁疗');
    h3.runUntil(() => !u.deployed, waitOf(u) + 1);
    assert.equal(u.removeReason, 'retreat');
    assert.ok(Math.abs(h3.b.time - t0 - waitOf(u)) < 0.1, 'and she still leaves 9 s after the lethal blow');
    clean(h); clean(h3);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// #43 follow-up: an enemy's 隐匿 returns 3 s after its block ends

const WALL = (id, block = 3) => chessRec({ id, profession: 'TANK', stats: { atk: 0, maxHp: 1e7, def: 0, res: 0, blockCnt: block }, rangeGrid: [[0, 0]], skill: null });
const BIG = [];
for (let dr = -4; dr <= 4; dr++) for (let dc = -12; dc <= 12; dc++) BIG.push([dr, dc]);
const CHESS = {
  t_wall: WALL('t_wall'), t_wall1: WALL('t_wall1', 1),
  t_gun: chessRec({ id: 't_gun', profession: 'SNIPER', projectile: 'none', stats: { atk: 50, maxHp: 1e7, bat: 1, blockCnt: 0 }, rangeGrid: BIG, skill: null }),
};
const NOATK = () => ({ trait: { noAttack: true } });
function arena(o = {}) {
  const { kits = {}, ...rest } = o;
  return makeBattle({
    content: 'generic', extraContent: [enemiesMod], seed: 7, autoFinish: false, timeLimit: 600,
    defs: { chess: CHESS }, kits: { t_wall: NOATK, t_wall1: NOATK, ...kits }, ...rest,
  });
}
/** A pinned enemy (speed ×0) at a tile. */
const put = (h, key, pos, o = {}) => h.spawn(key, { pos, routeIndex: 0, mods: { speedMul: 0, ...(o.mods || {}) } });
const anyGun = { canHitFly: false };
/** Is `e` hidden by its 隐匿 for every consumer: ally targeting, operator splash and the b.snap stealth bit. */
function hidden(h, e) {
  const st = enemyStealthed(e);
  assert.equal(!canTargetEnemy(null, e, anyGun), st, 'targeting agrees');
  assert.equal(!h.b.foesInRadius(e.x, e.y, 0.3).includes(e), st, 'operator splash agrees (Battle.foesInRadius)');
  assert.equal(!!(flagsOf(e) & UF.STEALTH), st, 'the stealth bit agrees');
  return st;
}
const stun = (h, u, d) => h.b.applyStatus(u, 'stun', { duration: d, force: true });

describe('#43: a blocked 隐匿 enemy hides again only 3 s after the block ends (PRTS 作战机制 §隐匿)', () => {
  test(`潜伏者: blocked = revealed; the blocker lets go ⇒ revealed for STEALTH_RESTORE (${STEALTH_RESTORE}) s — targetable, splashed, drawn solid, shot by a ranged operator — then 隐匿 again`, () => {
    const h = arena({ units: [{ chessId: 't_wall', row: 9, col: 5 }, { chessId: 't_gun', row: 11, col: 3 }] });
    h.step();
    const wall = h.unit('t_wall');
    const e = put(h, 'enemy_1009_lurker', [9, 5]);
    h.step(2);
    assert.ok(e.blockedBy === wall && !hidden(h, e), 'blocked: revealed');
    stun(h, wall, 30);                                  // a stunned blocker lets go and blocks nobody
    assert.ok(!e.blockedBy);
    const t0 = h.b.time;
    assert.ok(e.findBuff(stealthOffKey('ab:stealth')), 'its 隐匿 source is switched off');
    h.run(1);
    assert.equal(hidden(h, e), false, '+1 s: still revealed');
    const taken = e.stats.taken;
    h.run(STEALTH_RESTORE - 1 - 0.1);
    assert.equal(hidden(h, e), false, `+${STEALTH_RESTORE - 0.1} s: still revealed`);
    assert.ok(e.stats.taken > taken, 'the ranged operator shoots it meanwhile');
    h.run(0.2);
    assert.equal(hidden(h, e), true, `+${STEALTH_RESTORE + 0.1} s: 隐匿 again`);
    assert.ok(Math.abs(h.b.time - t0 - STEALTH_RESTORE - 0.1) < 0.05);
    // an arrow loosed before it hid still lands (a projectile keeps its target): count from when none is in flight
    h.runUntil(() => !h.b.projectiles.list.some((p) => p.target === e), 1);
    const after = e.stats.taken;
    h.run(2);
    assert.equal(e.stats.taken, after, 'no ranged hit once it hides');
    clean(h);
  });

  test('a new block inside the window lifts it again, and the window restarts when that block ends (the first one does not cut it short)', () => {
    const h = arena({ units: [{ chessId: 't_wall', row: 9, col: 5 }] });
    h.step();
    const wall = h.unit('t_wall');
    const e = put(h, 'enemy_1009_lurker', [9, 5]);
    h.step(2);
    stun(h, wall, 1.5);                                 // let go at t0 …
    const t0 = h.b.time;
    h.run(1.6);
    assert.equal(e.blockedBy, wall, '… blocked again at +1.6 s (inside the 3 s)');
    assert.equal(hidden(h, e), false);
    h.run(2.5 - 1.6);
    stun(h, wall, 30);                                  // … and let go again at +2.5 s
    const t1 = h.b.time;
    h.run(t0 + 4 - h.b.time);
    assert.equal(hidden(h, e), false, '+4 s: revealed (the first window would have ended at +3 s)');
    h.run(t1 + STEALTH_RESTORE - 0.1 - h.b.time);
    assert.equal(hidden(h, e), false, `${STEALTH_RESTORE - 0.1} s after the second block: revealed`);
    h.run(0.2);
    assert.equal(hidden(h, e), true, `${STEALTH_RESTORE + 0.1} s after it: 隐匿`);
    clean(h);
  });

  test('a release through the block count (ai.js enforceBlockCapacity) and a 反隐 that ends: the same switch; a 反隐 ending inside the window keeps it revealed', () => {
    const h = arena({ units: [{ chessId: 't_wall', row: 9, col: 5 }] });
    h.step();
    const wall = h.unit('t_wall');
    const e = put(h, 'enemy_1009_lurker', [9, 5]);
    h.step(2);
    h.b.addBuff(e, { key: 'test:reveal', duration: 1, flags: { reveal: true } });
    h.b.addBuff(wall, { key: 'test:noblock', mods: { blockCnt: -99 } });
    h.step(1);
    assert.ok(!e.blockedBy, 'over capacity: released');
    h.run(1.5);
    assert.ok(!e.s.flags.reveal && hidden(h, e) === false, 'the 反隐 is over, the block switch still holds it');
    h.run(STEALTH_RESTORE - 1.5);
    assert.equal(hidden(h, e), true);
    // a plain 反隐 (no block): hidden again as soon as it ends
    h.b.addBuff(e, { key: 'test:reveal', duration: 1, flags: { reveal: true } });
    assert.equal(hidden(h, e), false);
    h.run(1.05);
    assert.equal(hidden(h, e), true, '反隐 alone: no 3 s');
    clean(h);
  });

  test('"（解除阻挡N秒后恢复）" on the enemy pages: 0 s (业余竞演者, 清明\'s veil …), 1 s (家族灭迹人); a veil over its own 隐匿 hides it at once, its own switch takes over when the veil ends', () => {
    const h = arena({ units: [{ chessId: 't_wall', row: 9, col: 5 }, { chessId: 't_wall', row: 11, col: 5 }, { chessId: 't_wall', row: 12, col: 7 }] });
    h.step();
    const [w1, w2, w3] = h.allies();
    // (流泪小子 has 0 s too, but its first hit stuns its blocker, which lets it go at once)
    const thief = put(h, 'enemy_10031_cnvsld', [9, 5]);
    const killer = put(h, 'enemy_1283_sgkill', [11, 5]);
    const lurker = put(h, 'enemy_1009_lurker', [12, 7]);
    h.step(2);
    assert.ok(thief.blockedBy && killer.blockedBy && lurker.blockedBy);
    assert.equal(thief.findBuff('ab:stealth').data.stealthRestore, 0);
    assert.equal(killer.findBuff('ab:stealth').data.stealthRestore, 1);
    assert.equal(lurker.findBuff('ab:stealth').data.stealthRestore, undefined, 'a plain 隐匿: the general 3 s');
    // the 清明 veil the same way kitInvisShield gives it, over the lurker's own 隐匿
    h.b.addBuff(lurker, { key: 'ab:veiled', duration: 0.5, flags: { stealth: true }, visible: true, data: { stealthRestore: 0 } });
    for (const w of [w1, w2, w3]) stun(h, w, 30);
    h.step();
    assert.equal(hidden(h, thief), true, '业余竞演者: 0 s');
    assert.equal(hidden(h, lurker), true, 'veiled: 0 s');
    assert.equal(hidden(h, killer), false);
    h.run(0.85);
    assert.equal(hidden(h, killer), false, '家族灭迹人: still revealed at +0.9 s');
    assert.equal(hidden(h, lurker), false, 'the veil is over and its own 隐匿 is still switched off');
    h.run(0.25);
    assert.equal(hidden(h, killer), true, '家族灭迹人: 隐匿 at +1.1 s');
    h.run(STEALTH_RESTORE - 1.1 + 0.1);
    assert.equal(hidden(h, lurker), true, 'its own switch: 3 s after the block');
    clean(h);
  });

  test('清明 / 堂皇 give their veil a 0 s switch; every other stealthy enemy here keeps the general 3 s unless its PRTS page says otherwise', () => {
    const h = arena({ units: [{ chessId: 't_wall', row: 12, col: 3 }] });
    h.step();
    const lamp = put(h, 'enemy_1209_sfden', [10, 7]);
    const o = put(h, 'enemy_1007_slime', [10, 8]);
    assert.ok(h.runUntil(() => !!o.findBuff('ab:veiled'), 30), 'the veil comes');
    assert.equal(o.findBuff('ab:veiled').data.stealthRestore, 0);
    assert.ok(lamp.alive);
    const ZERO = ['enemy_10031_cnvsld', 'enemy_10034_cnvsax', 'enemy_9008_acbunn', 'enemy_2034_sythef', 'enemy_2034_sythef_2', 'enemy_1389_winbab_2'];
    const ONE = ['enemy_1283_sgkill', 'enemy_1283_sgkill_2'];
    const PLAIN = ['enemy_1009_lurker', 'enemy_1019_jshoot', 'enemy_1019_jshoot_2', 'enemy_1023_jmage', 'enemy_1299_ymkilr', 'enemy_1299_ymkilr_2', 'enemy_1404_msnip', 'enemy_10042_prtrop', 'enemy_10042_prtrop_2', 'enemy_1175_dushdo_2'];
    for (const [keys, n] of [[ZERO, 0], [ONE, 1], [PLAIN, undefined]]) {
      for (const k of keys) assert.equal(put(h, k, [10, 9]).findBuff('ab:stealth').data.stealthRestore, n, k);
    }
  });

  test('our operators: 隐匿 is never lifted by blocking, and its block ending switches nothing (PRTS "我方干员并不会因为阻挡而解除隐匿")', () => {
    const h = arena({ units: [{ chessId: 't_wall', row: 9, col: 5 }] });
    h.step();
    const wall = h.unit('t_wall');
    h.b.applyStatus(wall, 'stealth', { duration: 99 });
    const e = put(h, 'enemy_1007_slime', [9, 5]);
    h.step(2);
    assert.ok(e.blockedBy === wall && flagsOf(wall) & UF.STEALTH, 'blocking and still 隐匿');
    assert.ok(canTargetAlly(e, wall, true), 'the enemy it blocks attacks it');
    h.b.releaseBlocked(wall);
    assert.ok(!wall.buffs.some((b) => b.key.startsWith('stealthOff')) && !e.buffs.some((b) => b.key.startsWith('stealthOff')));
    assert.ok(flagsOf(wall) & UF.STEALTH);
    clean(h);
  });

  test('山海众头目: its 强击标记 comes with its 隐匿 ("该隐匿每次生效后自身获得强击标记") — a new block inside the 3 s gives no second strong hit, one after it hid again does', () => {
    const key = 'enemy_1299_ymkilr';
    const h = arena({ units: [{ chessId: 't_wall', row: 9, col: 5 }], captureNoisy: true, hooks: ['damaged'] });
    h.step();
    const wall = h.unit('t_wall');
    const e = put(h, key, [9, 5]);
    const scale = e.mem.ab.sk.InvisibleCombat.bb.atk_scale;
    const hits = () => h.hooksOf('damaged').filter((c) => c.source === e && c.dmg.isAttack).map((c) => c.amount);
    assert.ok(h.runUntil(() => hits().length >= 1, 20));
    assert.ok(Math.abs(hits()[0] - e.s.atk * scale) < 1e-6, 'the first blocked attack: ×atk_scale (the mark of its spawn)');
    stun(h, wall, 1);                                   // let go, blocked again at +1 s (inside the 3 s)
    h.run(1.2);
    assert.ok(e.blockedBy === wall);
    const n1 = hits().length;
    assert.ok(h.runUntil(() => hits().length > n1, 20));
    assert.ok(Math.abs(hits()[n1] - e.s.atk) < 1e-6, 'never hidden in between: a plain hit');
    stun(h, wall, STEALTH_RESTORE + 1);                 // let go long enough to hide again
    h.run(STEALTH_RESTORE + 0.5);
    assert.equal(enemyStealthed(e), true);
    const n2 = hits().length;
    assert.ok(h.runUntil(() => hits().length > n2, 20));
    assert.ok(e.blockedBy === wall);
    assert.ok(Math.abs(hits()[n2] - e.s.atk * scale) < 1e-6, 'it hid again: the next blocked attack is ×atk_scale');
    clean(h);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// the 深池逐火 embers: the warrior's block ends before the ember gains 隐匿

describe('深池逐火: a fresh ember starts 隐匿 independently of the warrior\'s former block', () => {
  for (const key of ['enemy_1288_duskls', 'enemy_1288_duskls_2', 'enemy_1292_duskld']) {
    test(`${key}: its blocker takes the next warrior during the 1 s 重生 — the unblocked ember starts 隐匿, excluding ranged targeting, splash and the solid snapshot`, () => {
      const h = arena({ units: [{ chessId: 't_wall1', row: 9, col: 5 }, { chessId: 't_gun', row: 11, col: 3 }], kits: { t_gun: NOATK } });
      h.step();
      const wall = h.unit('t_wall1'), gun = h.unit('t_gun');
      const a = put(h, key, [9, 5]);
      const b = put(h, key, [9, 5.3]);                   // queued right behind it, in contact
      h.step(2);
      assert.ok(a.blockedBy === wall && !b.blockedBy, 'block 1: the first warrior is blocked');
      h.b.kill(a, gun);
      const t0 = h.b.time;
      assert.ok(a.alive && a.form === 'husk' && !a.blockedBy, 'the knock-out: 重生, its block ends at once');
      assert.ok(!a.findBuff(stealthOffKey('ab:ember')), 'the old warrior\'s block cannot switch off the new 隐匿 source');
      h.step();
      assert.equal(b.blockedBy, wall, 'the blocker takes the next warrior');
      h.run(HUSK_REBIRTH - 0.2);
      assert.ok(a.s.flags.invulnerable && !canTargetEnemy(gun, a, gun.profile), '重生: 无敌 + untargetable');
      h.run(0.4);
      assert.ok(!a.s.flags.untargetable && !a.blockedBy && a.s.flags.stealth, 'the ember walks, unblocked (the blocker is full)');
      assert.equal(hidden(h, a), true, 'initial 隐匿 after the 重生');
      assert.ok(!canTargetEnemy(gun, a, gun.profile), 'a ranged operator cannot target it');
      h.run(t0 + STEALTH_RESTORE - 0.1 - h.b.time);
      assert.equal(hidden(h, a), true, `+${STEALTH_RESTORE - 0.1} s: still 隐匿`);
      h.run(0.2);
      assert.equal(hidden(h, a), true, `+${STEALTH_RESTORE + 0.1} s: 隐匿`);
      clean(h);
    });
  }

  test('knocked out while NOT blocked: 隐匿 at once when the 重生 ends (the switch only follows a block)', () => {
    const h = arena({ units: [{ chessId: 't_gun', row: 11, col: 3 }], kits: { t_gun: NOATK } });
    h.step();
    const a = put(h, 'enemy_1288_duskls', [9, 6]);
    h.b.kill(a, h.unit('t_gun'));
    assert.ok(!a.buffs.some((x) => x.key.startsWith('stealthOff')));
    h.run(HUSK_REBIRTH + 0.1);
    assert.equal(hidden(h, a), true);
    clean(h);
  });

  for (const key of ['enemy_1288_duskls', 'enemy_1288_duskls_2', 'enemy_1292_duskld']) {
    test(`${key}: blocking the ember reveals it; releasing that block opens its own 3 s restore window`, () => {
      const h = arena({ units: [{ chessId: 't_wall1', row: 9, col: 5 }, { chessId: 't_gun', row: 11, col: 3 }], kits: { t_gun: NOATK } });
      h.step();
      const wall = h.unit('t_wall1'), gun = h.unit('t_gun');
      const a = put(h, key, [9, 5]);
      h.step(2);
      assert.equal(a.blockedBy, wall);
      h.b.kill(a, gun);
      h.run(HUSK_REBIRTH + 0.1);
      assert.equal(a.blockedBy, wall, 'the free blocker takes the ember itself');
      assert.equal(hidden(h, a), false, 'blocking reveals the ember');
      stun(h, wall, STEALTH_RESTORE + 2);
      h.step();
      const released = h.b.time;
      assert.ok(!a.blockedBy && a.findBuff(stealthOffKey('ab:ember')));
      assert.equal(hidden(h, a), false, 'the ember\'s own block ends: revealed');
      const hp = a.hp;
      h.b.dealDamage(gun, a, { amount: 1, type: 'phys', tags: ['test'] });
      assert.equal(a.hp, hp - 1, 'one hit still lands in the restore window');
      h.run(STEALTH_RESTORE - 0.1);
      assert.equal(hidden(h, a), false, 'still revealed just before the deadline');
      h.run(0.2);
      assert.equal(hidden(h, a), true, '隐匿 returns after the ember\'s own block');
      assert.ok(Math.abs(h.b.time - released - STEALTH_RESTORE - 0.1) < 0.05);
      clean(h);
    });
  }
});

test('#52 a chain healer\'s bounces skip 史尔特尔 in 余烬 (禁疗: no heal target) and go to the next injured ally', () => {
  const SURTR = 'chess_char_5_07_a', PAP = 'chess_char_2_06_a', TANK = 'chess_char_1_04_a', MEDIC = 'chess_char_2_02_a';
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 1e9, speed: 0, atk: 0 }) } }, autoFinish: false, timeLimit: 200, seed: 3,
    units: [
      { chessId: SURTR, row: 9, col: 5, dir: 'RIGHT', skillIndex: 0, carryState: { sp: 0 } },
      { chessId: PAP, row: 10, col: 3, dir: 'RIGHT', skillIndex: 0, carryState: { sp: 0 } },
      { chessId: TANK, row: 10, col: 5, dir: 'RIGHT' },
      { chessId: MEDIC, row: 11, col: 5, dir: 'RIGHT', carryState: { sp: 0 } },
    ],
    enemies: [{ key: 'enemy_dummy', pos: [9, 9] }],
  });
  const s = h.unit(SURTR), tank = h.unit(TANK), med = h.unit(MEDIC);
  h.run(1);
  tank.hp = tank.s.maxHp * 0.5; med.hp = med.s.maxHp * 0.7;
  h.b.dealDamage(null, s, { amount: 1e9, type: 'true', canDodge: false });
  assert.ok(s.findBuff('surtr:ember'), '余烬 is on');
  const ev0 = h.events.length;
  h.run(6);
  const bounces = h.events.slice(ev0).filter((ev) => ev[0] === 'atk' && ev[3] === 'chainHeal').map((ev) => ev[2]);
  assert.ok(bounces.length > 0, 'the chain bounced');
  assert.ok(!bounces.includes(s.id), 'no bounce picks her');
  assert.ok(bounces.includes(med.id), 'the injured 赫默 gets the bounces');
  clean(h);
});
