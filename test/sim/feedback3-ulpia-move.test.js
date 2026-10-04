// test/sim/feedback3-ulpia-move.test.js — community report 「乌尔比安三技能结束后不属于再部署」 (0.1.3): his S3 【移动】 to the
// anchor and the 【返回】 at its end only changed his tile (Battle.relocate), so no deploy effect saw them — 迅捷作战粮's SP,
// 突袭手雷's window, 卡西米尔 / 叙拉古 / garrison <部署时> effects … — and the return did not empty his SP.
// Official: PRTS 乌尔比安 S3 备注 — the move and the 【返回】 are both 【移动】, "【移动】后仅继承下列效果：技能进度、第二天赋叠加层数",
// "【返回】时将清空技力，但仍可以享受后续由其他效果提供的技力"; PRTS 术语释义 【移动】 "不退场，以当前血量在目标位置部署",
// "本质上为一次特殊的撤退-再部署行为", "因移动撤退时不会积累再部署惩罚", "可以通过移动行为多次触发部署时触发的效果",
// "部署时将清空技力". Now both are Battle.moveRedeploy: a new deployment with a `deploy` { move: true } event, no exit.
// Owner's deviation kept (DESIGN §22.3): his buffs — the 阿戈尔 devour gains — stay through both moves.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { hasGeneratedData } from '../../server/sim/simdata.js';
import { ANIM } from '../../shared/constants.js';
import { TOKEN_IDS } from '../../server/sim/content/tokens.js';

const REAL = { skip: !hasGeneratedData() };
const ULP = 'chess_char_5_05_a';
const RATION = 'chess_item_3_05_e_a';   // 迅捷作战粮 "部署时，获得3点技力；每有一个同盟约的其他干员，额外获得3点技力"
const GRENADE = 'chess_item_3_11_e_a';  // 突袭手雷 "每次部署后的10秒内，攻击时使目标晕眩2秒"
const close = (a, b, eps, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} expected ${b} ± ${eps}, got ${a}`);
const dummy = enemyRec({ key: 'e_dummy', hp: 1e9, speed: 0, def: 0, res: 0 });
const clean = (h) => { assert.deepEqual(h.b.errors.map((e) => `${e.label}: ${e.message}`), []); checkInvariants(h.b); };
const ITEMS = hasGeneratedData() ? JSON.parse(readFileSync(new URL('../../data/items.json', import.meta.url), 'utf8')) : {};
const itemBb = (id) => ITEMS[id]?.buffs?.[0]?.bb ?? null;
const deploysOf = (h, u) => h.hooksOf('deploy').filter((c) => c.unit === u);

test('乌尔比安 S3: the 【移动】 and the 【返回】 are free redeploys — deploy effects fire, the return empties the SP first, no exit', REAL, () => {
  const ration = itemBb(RATION), grenade = itemBb(GRENADE);
  assert.ok(ration && ration.sp_each_person > 0 && grenade && grenade.duration > 0 && grenade.stun > 0, 'item data');
  const h = makeBattle({
    defs: { enemies: { e_dummy: dummy } },
    // 深巡 (阿戈尔, like him) stands apart: the ration counts it as "同盟约的其他干员"
    units: [{ chessId: ULP, row: 10, col: 3, items: [RATION, GRENADE] }, { chessId: 'chess_char_1_04_a', row: 12, col: 3 }],
    enemies: [{ key: 'e_dummy', pos: [10, 6] }], hooks: ['deploy', 'death', 'skillEnd'], autoFinish: false, timeLimit: 120,
  });
  const b = h.b, u = h.unit(ULP);
  const gift = ration.sp_each_person * 2;
  const stuns = [];
  let endT = null;
  b.on('statusApplied', (c) => { if (c.source === u && c.status === 'stun') stuns.push({ t: b.time, d: c.duration }); });
  b.on('skillEnd', (c) => { if (c.unit === u) endT = b.time; });
  h.step();
  assert.equal(deploysOf(h, u).length, 1, 'the battle-start deployment');
  h.run(3);
  const seq0 = u.deploySeq, dp0 = b.getPlayer('p1').dp, hpPct0 = u.hp / u.s.maxHp, respawn0 = u.respawnAt;
  u.skill.gainSp(1000);
  assert.ok(h.runUntil(() => u.skill.active, 2));
  const castT = u.skill.lastStart;
  // the 【移动】: a new deployment on the anchor tile, flagged as a move, while the skill keeps running
  assert.deepEqual([u.tileR, u.tileC], [10, 6], 'moved onto the anchor tile');
  const mv = deploysOf(h, u);
  assert.equal(mv.length, 2);
  assert.equal(mv[1].move, true, 'deploy { move: true }');
  assert.equal(mv[1].initial, false);
  assert.ok(u.deploySeq > seq0, 'a new deployment');
  close(u.deployedAt, castT, 1e-9, 'deployedAt = the move');
  assert.ok(u.skill.active, '技能进度 carries: the skill runs on');
  assert.ok(b.getPlayer('p1').dp >= dp0 - 1e-9, 'free (no DP paid)');
  assert.equal(u.respawnAt, respawn0, 'no redeploy timer');
  close(u.hp / u.s.maxHp, hpPct0, 1e-9, 'its HP');
  const ev = h.eventsOf('deploy').filter((e) => e[1] === u.id);
  assert.equal(ev.length, 2, "the client's deploy event");
  const tup = b.snapshot().units.find((t) => t[0] === u.id);
  assert.equal(tup[8], ANIM.DEPLOY, 'the snapshot plays the deploy');
  // 突袭手雷: its window starts again at the landing (castT + duration), past the battle-start one (0 + duration)
  // leftover SP while the skill runs (gifts of 'init' kind reach a running skill): the return must empty it
  u.skill.sp = 7;
  assert.ok(h.runUntil(() => !u.skill.active, 30));
  close(endT - castT, u.skill.duration, 0.1, 'the skill ran its own duration');
  // the 【返回】: another move, home; the SP emptied before the deploy effects, the ration's gift on top
  assert.deepEqual([u.tileR, u.tileC], [10, 3], 'back home');
  const back = deploysOf(h, u);
  assert.equal(back.length, 3);
  assert.equal(back[2].move, true);
  close(u.deployedAt, endT, 1e-9);
  close(u.skill.sp, gift, 0.1, 'the SP after the return = the ration only (7 cleared)');
  const late = stuns.filter((s) => Math.abs(s.d - grenade.stun) < 1e-9 && s.t > grenade.duration + 0.05);
  assert.ok(late.length > 0, `grenade stuns after ${grenade.duration} s (window from the landing at ${castT.toFixed(2)})`);
  assert.ok(late.every((s) => s.t <= castT + grenade.duration + 1e-6), 'and none past it');
  assert.equal(h.hooksOf('death').filter((c) => c.unit === u).length, 0, 'never an exit');
  assert.equal(h.eventsOf('die').filter((e) => e[1] === u.id).length, 0, 'no die, so no FORCED_EXIT and no knock-out');
  assert.equal(b._perPlayer.p1.deaths, 0, 'the redeploy count (knock-outs) stays 0');
  assert.equal(u.respawnAt, respawn0, 'no redeploy timer after the return either');
  assert.ok(b.getPlayer('p1').dp >= dp0 - 1e-9);
  clean(h);
});

test('乌尔比安 S3 with 不屈 at 100 %: the moves roll nothing (a 【移动】 is no exit); a knock-out still does', REAL, () => {
  const h = makeBattle({
    defs: { enemies: { e_dummy: dummy } },
    units: [{ chessId: ULP, row: 10, col: 3 }], enemies: [{ key: 'e_dummy', pos: [10, 6] }],
    bonds: { indomShip: { count: 2, active: true, tier: 1, layers: 300 } }, hooks: ['deploy', 'death'], autoFinish: false, timeLimit: 120,
  });
  const b = h.b, u = h.unit(ULP);
  h.step();
  u.skill.gainSp(1000);
  assert.ok(h.runUntil(() => u.skill.active, 2));
  assert.equal(deploysOf(h, u).at(-1).move, true);
  assert.ok(h.runUntil(() => !u.skill.active, 30));
  assert.equal(deploysOf(h, u).length, 3, 'start + move + return');
  assert.equal(h.hooksOf('death').filter((c) => c.unit === u).length, 0);
  assert.equal(u.mem.indomShip, undefined, '不屈 never rolled');
  assert.equal(h.eventsOf('fx').filter((e) => e[1] === 'revive').length, 0);
  // the same bond does fire on a real knock-out: back at once, free
  b.dealDamage(null, u, { amount: 1e9, type: 'true' });
  assert.ok(h.hooksOf('death').some((c) => c.unit === u && c.reason === 'killed'));
  assert.ok(u.alive && u.mem.indomShip === b.time, '不屈 redeployed it');
  clean(h);
});

test('乌尔比安 S3: the 阿戈尔 devour gains stay through the 【移动】 and the 【返回】 (owner\'s deviation, DESIGN §22.3)', REAL, () => {
  const fod = chessRec({ id: 't_fod', profession: 'WARRIOR', skill: null, stats: { atk: 1000, maxHp: 100, def: 0, blockCnt: 2 } });
  const h = makeBattle({
    defs: { enemies: { e_dummy: dummy }, chess: { t_fod: fod } },
    units: [{ chessId: ULP, row: 10, col: 3 }, { chessId: 't_fod', row: 10, col: 4 }], enemies: [{ key: 'e_dummy', pos: [10, 7] }],
    bonds: { egirShip: { count: 3, active: true, tier: 1, layers: 0 } }, hooks: ['deploy'], autoFinish: false, timeLimit: 120,
  });
  const u = h.unit(ULP);
  h.step();
  const gain = () => u.buffs.find((x) => x.key === 'bond:egir:devour');
  assert.ok(gain(), 'he devoured the piece in front of him at the battle start');
  const mods = { ...gain().mods }, atk0 = u.s.atk, block0 = u.s.blockCnt;
  assert.equal(mods.atkFlat, 1000);
  u.skill.gainSp(1000);
  assert.ok(h.runUntil(() => u.skill.active, 2));
  assert.deepEqual([u.tileR, u.tileC], [10, 7], 'moved');
  assert.equal(deploysOf(h, u).at(-1).move, true);
  assert.deepEqual({ ...gain().mods }, mods, 'kept through the 【移动】');
  assert.ok(h.runUntil(() => !u.skill.active, 30));
  assert.deepEqual([u.tileR, u.tileC], [10, 3], 'back');
  assert.equal(deploysOf(h, u).at(-1).move, true);
  assert.deepEqual({ ...gain().mods }, mods, 'kept through the 【返回】');
  close(u.s.atk, atk0, 1e-6, 'ATK as before the cast');
  assert.equal(u.s.blockCnt, block0);
  clean(h);
});

test('乌尔比安 S3 while he blocks (GitHub #33, §22.3 unchanged): no 【移动】, no new deployment, nothing to return from', REAL, () => {
  const h = makeBattle({
    defs: { enemies: { e_dummy: dummy } },
    units: [{ chessId: ULP, row: 9, col: 3 }], enemies: [{ key: 'e_dummy', pos: [9, 3] }], hooks: ['deploy'], autoFinish: false, timeLimit: 120,
  });
  const u = h.unit(ULP);
  h.step();
  const e = h.b.enemies[0];
  assert.equal(e.blockedBy, u);
  const seq0 = u.deploySeq;
  u.skill.gainSp(1000);
  assert.ok(h.runUntil(() => u.skill.active, 2));
  assert.deepEqual([u.tileR, u.tileC], [9, 3]);
  assert.ok(h.runUntil(() => !u.skill.active, 30));
  assert.equal(u.deploySeq, seq0, 'the same deployment');
  assert.equal(deploysOf(h, u).length, 1, 'only the battle-start deploy');
  assert.ok(!h.b.allyUnits.some((x) => x.kind === 'token'), 'no 从不混淆的方向');
  clean(h);
});

test('从不混淆的方向 fallback: a kit that only places the marker — the owner comes back by a 【移动】 with its SP emptied', REAL, () => {
  const kit = () => ({ talents: [], skill: { kind: 'duration', duration: 3, trigger: 'SP_FULL', spCost: 10, initSp: 10,
    onStart({ battle, unit }) {
      const [r, c] = [unit.tileR, unit.tileC];
      if (battle.moveRedeploy(unit, 10, 7)) battle.spawnToken(unit, TOKEN_IDS.ulpiaMarker, r, c);
    } } });
  const h = makeBattle({ kits: { [ULP]: kit }, units: [{ chessId: ULP, row: 10, col: 4 }], hooks: ['deploy'], autoFinish: false, timeLimit: 20 });
  h.step(2);
  const u = h.unit(ULP);
  assert.ok(u.skill.active && u.tileC === 7);
  u.skill.sp = 5;
  assert.ok(h.runUntil(() => !u.skill.active, 5));
  assert.deepEqual([u.tileR, u.tileC], [10, 4], 'back home');
  const d = deploysOf(h, u);
  assert.equal(d.length, 3);
  assert.ok(d[1].move && d[2].move);
  assert.ok(u.skill.sp < 0.5, `SP emptied (${u.skill.sp})`);
  clean(h);
});

test('乌尔比安 S3 out and back: a 替身 stays up, 不屈 and the 阿戈尔 revive do not spend, the knock-out count stays 0', REAL, () => {
  // 风丸 is a 傀儡师. Her 替身 is already up when he casts; both of his moves in the one skill must leave her there.
  const DOLL = 'chess_char_2_11_a';
  const h = makeBattle({
    defs: { enemies: { e_dummy: dummy } },
    units: [{ chessId: ULP, row: 10, col: 3 }, { chessId: DOLL, row: 12, col: 8 }],
    enemies: [{ key: 'e_dummy', pos: [10, 6] }],
    bonds: {
      egirShip: { count: 9, active: true, tier: 2, layers: 0 },
      indomShip: { count: 2, active: true, tier: 1, layers: 300 },
    },
    hooks: ['deploy', 'death', 'dollSwap'], autoFinish: false, timeLimit: 120,
  });
  const b = h.b, u = h.unit(ULP), doll = h.unit(DOLL);
  h.step();
  doll.profile.dollDuration = 80; // still the 替身 when the 25 s skill returns
  b.dealDamage(null, doll, { amount: 1e9, type: 'true' });
  assert.equal(doll.form, 'doll', 'she switched to the 替身');
  assert.equal(doll.alive, true);
  const swaps = () => h.hooksOf('dollSwap').filter((c) => c.unit === doll).length;
  const swaps0 = swaps();
  const respawn0 = u.respawnAt;
  u.skill.gainSp(1000);
  assert.ok(h.runUntil(() => u.skill.active, 2));
  assert.equal(deploysOf(h, u).at(-1).move, true);
  assert.ok(h.runUntil(() => !u.skill.active, 30));
  assert.equal(deploysOf(h, u).length, 3, 'start + move + return');
  assert.equal(doll.form, 'doll', 'the 替身 was not knocked out of');
  assert.equal(doll.alive && doll.deployed, true);
  assert.equal(swaps(), swaps0, 'neither move started a 替身 switch');
  assert.equal(h.hooksOf('death').filter((c) => c.unit === u || c.unit === doll).length, 0);
  assert.equal(h.eventsOf('fx').filter((e) => e[1] === 'revive').length, 0, '不屈 and 阿戈尔 revived nobody');
  assert.equal(u.mem.indomShip, undefined);
  assert.equal(b._perPlayer.p1.deaths, 0, 'redeploy count unchanged');
  assert.equal(u.respawnAt, respawn0);
  // the charge is still there: a real knock-out spends it
  b.dealDamage(null, u, { amount: 1e9, type: 'true' });
  assert.ok(u.alive, '阿戈尔 brought him back');
  assert.equal(h.eventsOf('fx').filter((e) => e[1] === 'revive').length, 1);
  assert.equal(b._perPlayer.p1.deaths, 1, 'only the real knock-out counts');
  clean(h);
});

test('a 【移动】 fires each deploy effect once: 卡西米尔 +20 % per move, 叙拉古 refreshes without doubling, 大帝 stacks once', REAL, () => {
  // 大买家-style listeners and these three all key off `deploy`. A move is a new deployment, so each fires again —
  // once. 大帝's permanent redeploy stack is the one that accumulates: PRTS 加急调派 "每次部署后再部署时间减少50%", and a
  // 【移动】 is a deployment (术语释义 移动). Doubling inside the same move would be the bug.
  const kaz = chessRec({ id: 't_kaz', profession: 'WARRIOR', bonds: ['kazimierzShip'], skill: null, stats: { atk: 1000, maxHp: 2000, def: 0, blockCnt: 1, respawnTime: 20 } });
  const sira = chessRec({ id: 't_sira', profession: 'WARRIOR', bonds: ['siracusaShip'], skill: { spCost: 30, initSp: 0, duration: 8 }, stats: { atk: 1000, maxHp: 2000, def: 0, aspd: 100, blockCnt: 1, respawnTime: 20 } });
  const emp = chessRec({ id: 't_emp', profession: 'WARRIOR', skill: { spCost: 30, initSp: 0, duration: 8 }, stats: { atk: 500, maxHp: 2000, def: 0, blockCnt: 1, respawnTime: 20 } });
  const h = makeBattle({
    defs: { chess: { t_kaz: kaz, t_sira: sira, t_emp: emp }, enemies: { e_dummy: dummy } },
    units: [
      { chessId: ULP, row: 10, col: 3 },
      { chessId: 't_kaz', row: 11, col: 2 },
      { chessId: 't_sira', row: 12, col: 2 },
      { chessId: 't_emp', row: 12, col: 6 },
    ],
    enemies: [{ key: 'e_dummy', pos: [10, 6] }],
    bonds: {
      kazimierzShip: { count: 3, active: true, tier: 1, layers: 200 }, // cap 50 + 1×L = 250 %, above the steps below
      siracusaShip: { count: 3, active: true, tier: 1, layers: 0 },
    },
    bandId: 'band_emperor', hooks: ['deploy'], autoFinish: false, timeLimit: 120,
  });
  const b = h.b, u = h.unit(ULP), kz = h.unit('t_kaz'), sr = h.unit('t_sira'), em = h.unit('t_emp');
  h.step();
  // 4 operators deployed at the start. 卡西米尔 is +20 % each, so four steps = +80 %.
  close(kz.s.atk, 1000 * 1.8, 1e-6, 'initial deployments');
  assert.equal(sr.findBuff('bond:siracusa').stacks, 1);
  const aspd = sr.findBuff('bond:siracusa').mods.aspd;
  h.run(1.5);
  const left = sr.findBuff('bond:siracusa').timeLeft;
  em.skill.sp = 11;
  assert.ok(b.moveRedeploy(em, 12, 7)); // no clearSp: the 11 stays (the outbound 【移动】 does not empty SP)
  assert.equal(em.skill.sp, 11);
  assert.equal(em.findBuff('band:band_emperor').stacks, 2, 'initial deploy + this move, not two stacks for one move');
  close(kz.s.atk, 1000 * 2.0, 1e-6, 'that move counted once for 卡西米尔');
  assert.ok(b.moveRedeploy(sr, 12, 3));
  assert.equal(sr.findBuff('bond:siracusa').stacks, 1);
  assert.equal(sr.findBuff('bond:siracusa').mods.aspd, aspd, '叙拉古 replaces the buff; it does not stack');
  assert.ok(sr.findBuff('bond:siracusa').timeLeft > left + 1, 'the new deployment starts the window again');
  close(kz.s.atk, 1000 * 2.2, 1e-6, 'her move counted once');
  u.skill.gainSp(1000);
  assert.ok(h.runUntil(() => u.skill.active, 2));
  close(kz.s.atk, 1000 * 2.4, 1e-6, 'his 【移动】 counts once');
  assert.equal(sr.findBuff('bond:siracusa').stacks, 1, 'he is not 叙拉古: his move does not stack her buff');
  assert.ok(h.runUntil(() => !u.skill.active, 30));
  close(kz.s.atk, 1000 * 2.6, 1e-6, 'the 【返回】 counts once more');
  assert.equal(em.findBuff('band:band_emperor').stacks, 2, 'his moves did not stack someone else\'s 大帝 buff');
  em.skill.sp = 9;
  assert.ok(b.moveRedeploy(em, 12, 5, { clearSp: true }));
  assert.ok(em.skill.sp < 0.5, 'clearSp empties it before deploy handlers; nothing here grants SP back');
  assert.equal(em.findBuff('band:band_emperor').stacks, 3);
  // 0.5^3 of 20 s. A double stack on any one of the three deployments would be 0.5^4 or lower.
  b.kill(em);
  close(em.respawnAt - b.time, 20 * 0.5 ** 3, 1e-6, 'one stack per deployment');
  clean(h);
});

test('Battle.moveRedeploy: refused like relocate (nothing changes); 气流 follows the tile change instead of sticking (devices.js)', REAL, () => {
  const op = chessRec({ id: 't_g', profession: 'WARRIOR', skill: null, stats: { atk: 1000, maxHp: 10000, def: 0 } });
  // act2 m01: (11,5) lies in a DOWN blower's flow, (11,8) does not
  const h = makeBattle({ stageId: 'act2autochess_m01', defs: { chess: { t_g: op, t_h: { ...op, chessId: 't_h', baseId: 't_h', charId: 't_h' } } },
    units: [{ chessId: 't_g', row: 11, col: 5, dir: 'DOWN' }, { chessId: 't_h', row: 12, col: 8 }], hooks: ['deploy'], autoFinish: false, timeLimit: 20 });
  h.run(0.5);
  const u = h.unit('t_g'), b = h.b;
  assert.ok(u.findBuff('terrain:airflow') && u.s.atk > 1000, 'with the flow');
  const seq0 = u.deploySeq;
  assert.equal(b.moveRedeploy(u, 12, 8), false, 'a taken tile');
  assert.equal(b.moveRedeploy(u, 30, 8), false, 'outside the field');
  assert.equal(u.deploySeq, seq0);
  assert.deepEqual([u.tileR, u.tileC], [11, 5]);
  assert.ok(b.moveRedeploy(u, 11, 8));
  assert.equal(deploysOf(h, u).at(-1).move, true);
  h.run(0.2);
  assert.ok(!u.findBuff('terrain:airflow'), 'the old tile\'s airflow ends');
  close(u.s.atk, 1000, 1e-6);
  assert.ok(b.moveRedeploy(u, 11, 5));
  h.run(0.2);
  assert.ok(u.findBuff('terrain:airflow') && u.s.atk > 1000, 'the new tile\'s airflow starts');
  clean(h);
});
