// test/sim/feedback2-doll.test.js — GitHub issue #44 「归鲨死了没替身」 (DESIGN §22.11), sim side. 归溟幽灵鲨
// (chess_char_5_13_a / _b) is a 傀儡师 (server/sim/professions.js installDollkeeper). Official: PRTS 分支特性信息 傀儡师 —
// a lethal hit on the <本体> without 不死 starts a switch animation, then she fights as her <替身> for 20 s holding 阻回
// (block 0), then switches back; PRTS 归溟幽灵鲨 特性备注 "<替身>不进行普通攻击"; S2 生存的渴望 holds 不死 while it runs and
// "技能结束后立刻切换为<替身>" (PRTS's correction of 视为被击倒). 0.1.1: the 替身 attacked, could cast S2 (whose end then
// killed her) and the client never drew it (no model form). Cases A–D of the report's repro + 风丸 (her 替身 attacks).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { DOLL_SWITCH } from '../../server/sim/professions.js';
import { holdsUndying } from '../../server/sim/content/items/battle.js';
import { hasGeneratedData } from '../../server/sim/simdata.js';
import { fxForm } from '../../shared/protocol.js';

const skip = !hasGeneratedData();
const G = 'chess_char_5_13_a';
const approx = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} ≈ ${b}`);
const dummy = () => enemyRec({ key: 'enemy_dummy', hp: 1e9, atk: 0, speed: 0 });

/** 归溟幽灵鲨 on (9,5) facing right; a harmless parked enemy on (9,6) (in her range) unless `enemy` is false. */
function setup({ id = G, skillIndex = 1, sp = 0, enemy = true, capture = false, items = undefined } = {}) {
  const h = makeBattle({
    seed: 4, timeLimit: 300, autoFinish: false, captureNoisy: capture,
    defs: { enemies: { enemy_dummy: dummy() } },
    units: [{ chessId: id, row: 9, col: 5, dir: 'RIGHT', skillIndex, carryState: { sp }, items }],
    enemies: enemy ? [{ key: 'enemy_dummy', pos: [9, 6] }] : [],
  });
  h.step();
  const g = h.unit(id);
  const log = { attacksAsDoll: 0, attacks: 0, castsAsDoll: [], casts: [] };
  h.b.on('attack', (c) => { if (c.attacker === g) { log.attacks++; if (g.trait.doll) log.attacksAsDoll++; } }, { priority: -2000 });
  h.b.on('skillStart', (c) => { if (c.unit === g) { log.casts.push(h.b.time); if (g.trait.doll) log.castsAsDoll.push(c.skill.id); } }, { priority: -2000 });
  const lethal = () => h.b.dealDamage(null, g, { amount: 1e9, type: 'true' });
  const fx = (kind) => h.eventsOf('fx').filter((e) => e[1] === kind && e[4]?.id === g.id);
  return { h, g, log, lethal, fx };
}

test('A: a lethal hit with no skill running ⇒ the 替身 (form, full HP, block 0, 阻回), no normal attack, 拥抱自我 works; back after the 1 s switch + 20 s', { skip }, () => {
  for (const [id, skillIndex] of [[G, 1], [G, 0], [G, 2], ['chess_char_5_13_b', 1]]) {
    const { h, g, log, lethal, fx } = setup({ id, skillIndex, capture: true });
    h.run(1.5);
    assert.ok(log.attacks > 0, `${id}/${skillIndex}: the 本体 attacks`);
    const atk0 = log.attacks;
    const full = g.s.maxHp;
    const sp = g.skill.sp;
    lethal();
    assert.ok(g.alive && g.trait.doll && g.form === 'doll', `${id}/${skillIndex}: the 替身`);
    approx(g.hp, g.s.maxHp, 'full HP');
    approx(g.s.maxHp, full * (1 + (g.def.traitBb.max_hp || 0)), 'her own max HP (no 替身 token; trait bb max_hp the module bonus)');
    assert.equal(g.s.blockCnt, 0);
    const [sub] = fx('substitute');
    assert.ok(sub && fxForm(sub) === 'doll', 'the fx puts the model in its 替身 form');
    approx(sub[4].dur, DOLL_SWITCH + 20, 'until the switch back');
    h.run(DOLL_SWITCH + 19);
    assert.equal(log.attacks, atk0, 'no normal attack as the 替身 (PRTS 特性备注)');
    approx(g.skill.sp, sp, '阻回: the SP waits');
    const e = h.enemy('enemy_dummy');
    assert.ok(e.findBuff('ghost2:embrace'), '拥抱自我 slows');
    assert.ok(h.hooksOf('damaged').some((c) => c.source === g && c.target === e && (c.dmg.tags || []).includes('embrace')), '…and deals arts damage');
    h.run(1.05);
    assert.ok(!g.trait.doll && g.form === null && g.trait.dollSwitching, 'switching back after 1 s + 20 s');
    assert.ok(fxForm(fx('swap')[0]) === null, 'the fx gives the 本体 its model back');
    assert.equal(g.s.blockCnt, 2);
    approx(g.hp, g.s.maxHp, 'full HP again');
    h.run(DOLL_SWITCH + 1.5);
    assert.ok(log.attacks > atk0, 'the 本体 attacks again');
    assert.ok(g.skill.sp > sp, 'SP again');
    checkInvariants(h.b);
  }
});

test('B: S2 生存的渴望 — a lethal hit during it leaves 1 HP (不死), its end switches her to the 替身 at once (no lethal HP loss, no knockout fx)', { skip }, () => {
  for (const hit of [true, false]) {
    const { h, g, lethal, fx } = setup({ sp: 999 });
    assert.ok(h.runUntil(() => g.skill.active, 5), 'S2 cast');
    h.run(1);
    if (hit) {
      lethal();
      assert.ok(g.alive && !g.trait.doll && g.hp >= 1 && g.hp < 2, '不死: 1 HP, not the 替身');
    }
    const fatals = h.hooksOf('fatal').length;
    assert.ok(h.runUntil(() => !g.skill.active, 30));
    assert.ok(g.alive && g.trait.doll && g.form === 'doll', 'the 替身 when S2 ends');
    approx(g.hp, g.s.maxHp, 'at full HP');
    assert.equal(h.hooksOf('fatal').length, fatals, 'a switch, not a lethal HP loss');
    assert.equal(fx('knockout').length, 0);
    assert.equal(fx('substitute').length, 1);
    h.run(DOLL_SWITCH + 20.05);
    assert.ok(g.alive && !g.trait.doll, 'back to the 本体, alive');
    checkInvariants(h.b);
  }
});

test('C: a second lethal hit while she is the 替身 knocks her out: the death clip first, then the model form back; the redeploy is the 本体', { skip }, () => {
  const { h, g, log, lethal } = setup();
  h.run(1);
  lethal();
  h.run(DOLL_SWITCH / 2);
  lethal();
  assert.ok(g.alive && g.trait.doll, 'not during the switch animation (无敌)');
  h.run(DOLL_SWITCH);
  lethal();
  assert.equal(g.alive, false, 'knocked out');
  assert.ok(!g.trait.doll && g.form === null);
  h.step();
  const ev = h.events.filter((e) => (e[0] === 'die' && e[1] === g.id) || (e[0] === 'fx' && e[4]?.id === g.id && fxForm(e) !== undefined));
  assert.deepEqual(ev.slice(-2).map((e) => (e[0] === 'die' ? 'die' : `${e[1]}:${fxForm(e)}`)), ['die', 'dollEnd:null'], 'its 替身 death clip plays, then the form resets');
  assert.ok(h.b.redeploy(g, { free: true }), 'redeployed');
  assert.ok(g.alive && !g.trait.doll && g.form === null && g.s.blockCnt === 2, 'the 本体');
  const n = log.attacks;
  h.run(2);
  assert.ok(log.attacks > n, 'and she attacks');
  checkInvariants(h.b);
});

test('D: SP near full or full when she switches ⇒ no skill cast as the 替身 (S2 DEFAULT, S1 技能范围); cast again as the 本体', { skip }, () => {
  // S2 38 / 40: 阻回 holds it under the cost; after the switch back it fills and S2 is cast
  {
    const { h, g, log, lethal } = setup({ sp: 38 });
    h.run(0.5);
    lethal();
    h.run(DOLL_SWITCH + 20 + DOLL_SWITCH + 5);
    assert.deepEqual(log.castsAsDoll, [], 'no S2 as the 替身');
    assert.ok(log.casts.length === 1 && log.casts[0] > 0.5 + 2 * DOLL_SWITCH + 20, 'S2 after the switch back');
    assert.ok(g.alive);
  }
  // S1 (SKILL_RANGE) ready with no enemy around, then an enemy steps next to the 替身: no cast until she is back
  {
    const { h, g, log, lethal } = setup({ skillIndex: 0, sp: 999, enemy: false });
    h.run(0.5);
    assert.ok(g.skill.ready && !g.skill.active && log.casts.length === 0, 'S1 ready, nothing in its range');
    lethal();
    h.run(DOLL_SWITCH + 0.5);
    h.spawn('enemy_dummy', { pos: [9, 6] });
    h.run(15);
    assert.deepEqual(log.castsAsDoll, [], 'no S1 as the 替身 (silenced with its disarm) [ASSUMED]');
    assert.ok(g.skill.ready, 'still ready');
    h.run(10);
    assert.equal(log.casts.length, 1, 'cast once she is the 本体 again');
    assert.equal(log.castsAsDoll.length, 0);
  }
});

test('S1 / S3 running at a lethal hit end with the switch (清除自身一切Buff); the content hook switches her at once, once', { skip }, () => {
  const { h, g, lethal } = setup({ skillIndex: 2, sp: 999 });
  const full = g.base.maxHp * (1 + g.findBuff('ghost2:abyss').mods.hpPct); // 阿戈尔的深邃 on herself
  assert.ok(h.runUntil(() => g.skill.active, 5), 'S3 cast');
  assert.ok(g.s.maxHp > full * 2, 'S3 max HP +');
  lethal();
  assert.ok(g.trait.doll && !g.skill.active, 'S3 over');
  assert.equal(h.hooksOf('skillEnd').at(-1).reason, 'substitute');
  approx(g.s.maxHp, full, 'no S3 max HP on the 替身');
  approx(g.hp, full, 'at its full HP');
  const s2 = setup();
  const c = s2.h.b.emit('dollSwitch', { unit: s2.g, reason: 'test', done: false });
  assert.ok(c.done && s2.g.trait.doll && s2.g.form === 'doll');
  assert.equal(s2.h.b.emit('dollSwitch', { unit: s2.g, reason: 'test', done: false }).done, false, 'already the 替身');
});

test('E: a lethal 流失 inside the switch (a second 阿戈尔 devour mark) — she leaves it at full HP, both ways (PRTS "切换途中重设自身生命至最大值"; community report #2)', { skip }, () => {
  // 乌尔比安 → 斯卡蒂 → 归溟幽灵鲨 → 深巡 → 幽灵鲨 → 隐现 (5 阿戈尔): 乌尔比安's mark switches her, 斯卡蒂's lands inside
  // the 1 s switch (无敌 does not stop a 流失, 不死 holds it at 1 HP; the switch is no knock-out, so the mark is not
  // cancelled). Until 0.1.3 she then fought the 替身's 20 s at 1 HP and fell to the first hit
  const ids = ['chess_char_5_05_a', 'chess_char_3_05_a', G, 'chess_char_1_04_a', 'chess_char_2_07_a', 'chess_char_1_01_a'];
  const h = makeBattle({
    seed: 4, timeLimit: 300, autoFinish: false, captureNoisy: true, hooks: ['damaged', 'death'],
    units: ids.map((chessId, i) => ({ chessId, row: 10, col: 3 + i })),
    bonds: { egirShip: { count: 5, active: true, tier: 2, layers: 0 } },
  });
  h.step();
  const g = h.unit(G);
  const marks = h.hooksOf('damaged').filter((c) => c.target === g && c.dmg?.tags?.includes('bond:egir:devour'));
  assert.equal(marks.length, 2, 'two devour marks resolve on her');
  assert.ok(g.alive && g.trait.doll && g.trait.dollSwitching, 'the first switched her');
  assert.ok(g.hp < 2, `the second, inside the switch, left 1 HP (不死; a regen tick aside): ${g.hp}`);
  h.run(DOLL_SWITCH + 0.05);
  assert.ok(g.trait.doll && !g.trait.dollSwitching, 'the 替身 fights');
  approx(g.hp, g.s.maxHp, 'at full HP when the switch ends');
  // the switch back: a lethal 流失 inside it is held at 1 HP, then she is the 本体 at full HP
  assert.ok(h.runUntil(() => !g.trait.doll && g.trait.dollSwitching, 25), 'switching back');
  h.b.loseHp(g, 1e9, { source: null });
  assert.ok(g.alive && g.hp < 2, `not knocked out while switching: held at 1 HP (${g.hp})`);
  h.run(DOLL_SWITCH + 0.05);
  assert.ok(!g.trait.doll && !g.trait.dollSwitching && g.form === null, 'the 本体');
  approx(g.hp, g.s.maxHp, 'at full HP when the switch back ends');
  assert.equal(h.hooksOf('death').filter((c) => c.unit === g).length, 0, 'never knocked out');
  checkInvariants(h.b);
});

test('a 本体 holding 不死 (a running 坚固维式重锤 window) does not switch: held at 1 HP (PRTS "受到足以致命的伤害且未持有不死的情况下")', { skip }, () => {
  const { h, g, lethal } = setup({ items: ['chess_item_3_09_e_a'] });
  lethal();
  assert.ok(g.trait.doll && !holdsUndying(h.b, g), 'the first lethal hit: the switch, the hammer\'s lock unspent');
  h.run(15);
  lethal();
  assert.ok(g.alive && g.trait.doll && holdsUndying(h.b, g), 'the 替身\'s lethal hit sets off the lock: 8 s of 不死');
  approx(g.hp, 1, 'held at 1 HP');
  assert.ok(h.runUntil(() => !g.trait.doll && !g.trait.dollSwitching, 10), 'switched back');
  assert.ok(holdsUndying(h.b, g), 'the window still runs');
  lethal();
  assert.ok(g.alive && !g.trait.doll && g.form === null, 'no switch while it holds 不死');
  approx(g.hp, 1, 'held at 1 HP');
  assert.ok(h.runUntil(() => !holdsUndying(h.b, g), 10));
  lethal();
  assert.ok(g.alive && g.trait.doll, 'the window over: the switch');
  checkInvariants(h.b);
});

test('风丸: her 替身 still attacks (PRTS "<替身>状态下可对空"); the same 替身 form, switch and 阻回', { skip }, () => {
  const id = 'chess_char_2_11_a';
  const { h, g, log, lethal } = setup({ id, skillIndex: 0 });
  h.run(1);
  lethal();
  assert.ok(g.trait.doll && g.form === 'doll' && g.s.flags.noSp);
  h.run(DOLL_SWITCH + 5);
  assert.ok(log.attacksAsDoll > 0, 'the 替身 attacks');
  assert.ok(!g.s.flags.silence && !g.s.flags.disarm);
});
