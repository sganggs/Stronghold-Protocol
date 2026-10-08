// test/sim/feedback5-attack-clip-rest.test.js — community report of 2026-10-07 on the 鸭爵 strategy's 流泪小子 (GitHub #214's
// 「泪眼汪汪」): 「哭狗一摸干员、干员直接晕、哭狗瞬间隐匿没有后摇马上就到下一格干员的脸上秒抬手秒晕」.
// Official, and kept: its strike stuns the blocker for 3.5 s (enemy_database Combat.attack@stun), a stunned operator
// blocks nothing (gamedata_const ba.stun 「无法移动、阻挡、攻击及使用技能」; PRTS 异常效果 STUNNED 「无法攻击、释放技能、阻挡敌人
// 类单位」), its 隐匿 is back 0 s after the block ends (PRTS 流泪小子 「隐匿（解除阻挡0秒后恢复）」), and its cooldown runs on the
// walk, so its first swing at the next operator starts at once and strikes 0.767 s later (the Attack clip's OnAttack).
// The deviation (fixed in 0.2.0): it walked on the very tick of its strike. PRTS 状态机: an enemy's ATTACK / COMBAT state
// checks only 异常状态 every frame and "攻击结束后回退到MOVE状态" (only a character's COMBAT drops when its blocker is gone),
// so any enemy whose block ends after its strike — the strike stunned or knocked out its blocker, the blocker left —
// stands for the rest of its attack clip first (server/sim/ai.js enemyAttack / attackStand); a displacement (失衡) ends
// that stand (Battle.displace). The copies here are spawned without the band's 'duck' tag: the official rules throughout.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBattle, chessRec, checkInvariants } from '../helpers/battleHarness.js';
import * as enemiesMod from '../../server/sim/content/enemies.js';
import { TICK, UNBALANCE_STAGGER, UNBALANCE_TRAVEL } from '../../server/sim/constants.js';
import { attackStand, attackWindup } from '../../server/sim/ai.js';
import { enemyStealthed } from '../../server/sim/targeting.js';

const E = JSON.parse(readFileSync(new URL('../../data/enemies.json', import.meta.url), 'utf8'));
const DOG = 'enemy_2034_sythef_2';     // 流泪小子 (the 鸭爵 strategy's version: 4500 HP, 3.5 s stun)
const ENVOY = 'enemy_1438_dspred';     // 复核洋流使者: a plain melee enemy (stats only) with a 2.133 s clip, strike at 0.733 s
const WALL = (id, hp = 1e7) => chessRec({ id, profession: 'TANK', stats: { atk: 0, maxHp: hp, def: 0, blockCnt: 1 }, rangeGrid: [[0, 0]], skill: null });
const NOATK = () => ({ trait: { noAttack: true } });

function arena(units) {
  return makeBattle({
    content: 'generic', extraContent: [enemiesMod], seed: 7, autoFinish: false, timeLimit: 600,
    defs: { chess: { w1: WALL('w1'), w2: WALL('w2'), weak: WALL('weak', 100) } }, kits: { w1: NOATK, w2: NOATK, weak: NOATK },
    units, hooks: ['statusApplied', 'attack', 'death'],
  });
}
/** Walk an enemy down route 0 (row 9, from the gate at col 10 towards col 2) until its first strike; returns its time. */
function untilStrike(h, e) {
  assert.ok(h.runUntil(() => e.stats.attacks >= 1, 60), 'it strikes');
  return h.b.time;
}

test('流泪小子 numbers (enemy_database / its Spine clip): 0.8 move speed, 2.0 s interval, 3.5 s stun, strike 0.767 s into its 1.567 s Attack clip, 隐匿 back 0 s after a block', () => {
  const d = E[DOG];
  assert.equal(d.stats.moveSpeed, 0.8);
  assert.equal(d.stats.bat, 2);
  assert.equal(d.applyWay, 'MELEE');
  assert.equal(d.talents.bb['Combat.attack@stun'], 3.5);
  assert.deepEqual(d.attackAnim, { clip: 'Attack', dur: 1.567, hit: 0.767 });
  const h = arena([]);
  h.step();
  const e = h.spawn(DOG, { routeIndex: 0 });
  assert.ok(Math.abs(attackWindup(e) - 0.767) < 1e-9);
  assert.ok(Math.abs(attackStand(e).rest - 0.8) < 1e-9);
  assert.equal(e.findBuff('ab:stealth').data.stealthRestore, 0);
});

test('流泪小子: its strike stuns the blocker, which lets it go at once (晕眩 blocks nothing) and its 隐匿 is back at once — then it stands for the rest of its clip (0.8 s) before it walks on', () => {
  const h = arena([{ chessId: 'w1', row: 9, col: 6 }]);
  h.step();
  const wall = h.unit('w1');
  const e = h.spawn(DOG, { routeIndex: 0 });
  assert.ok(h.runUntil(() => e.blockedBy === wall, 30), 'blocked by the wall');
  assert.equal(enemyStealthed(e), false, 'revealed while blocked');
  const t0 = h.b.time;
  const ts = untilStrike(h, e);
  // its cooldown was ready: the swing starts on contact and strikes after the 0.767 s wind-up
  assert.ok(Math.abs(ts - t0 - attackWindup(e)) < 2 * TICK + 1e-9, `strike ${ts - t0} s after the contact`);
  const stun = h.hooksOf('statusApplied').find((c) => c.status === 'stun' && c.target === wall);
  assert.ok(stun && Math.abs(stun.duration - 3.5) < 1e-9, 'the wall is stunned for 3.5 s');
  assert.equal(e.blockedBy, null, 'a stunned operator blocks nothing');
  assert.equal(wall.blocking.length, 0);
  assert.equal(enemyStealthed(e), true, '隐匿 0 s after the block ends');
  const x0 = e.x;
  h.run(attackStand(e).rest - 2 * TICK);
  assert.equal(e.x, x0, 'it stands for the rest of its Attack clip (pre-0.2.0: it walked on at once)');
  assert.equal(e.moving, false);
  h.run(0.2);
  assert.ok(e.x < x0 - 0.02 && e.moving, `then it walks on (${x0} → ${e.x})`);
  checkInvariants(h.b);
});

test('流泪小子 down a lane of two operators: the second one is reached a stand later, struck 0.767 s after the contact, and the first one takes it over again once its stun ends (contact rule)', () => {
  const h = arena([{ chessId: 'w1', row: 9, col: 7 }, { chessId: 'w2', row: 9, col: 6 }]);
  h.step();
  const [w1, w2] = [h.unit('w1'), h.unit('w2')];
  const e = h.spawn(DOG, { routeIndex: 0 });
  const ts1 = untilStrike(h, e);
  assert.ok(h.runUntil(() => e.blockedBy === w2, 10), 'the second operator blocks it');
  const tb2 = h.b.time;
  // 0.8 s stand + 1 tile at 0.4 tiles/s (moveSpeed 0.8 × the level's 0.5) between the two contacts
  assert.ok(tb2 - ts1 > attackStand(e).rest + 2.4, `${(tb2 - ts1).toFixed(3)} s from the first strike to the second contact`);
  assert.ok(h.runUntil(() => e.stats.attacks >= 2, 5));
  assert.ok(Math.abs(h.b.time - tb2 - attackWindup(e)) < 2 * TICK + 1e-9, 'its cooldown ran on the walk: struck after the wind-up');
  assert.ok(w2.s.flags.stun);
  // it stands 0.8 s inside w1's block radius (0.7071): w1, whose 3.5 s stun is over by then, blocks it again
  assert.ok(h.runUntil(() => e.blockedBy === w1, 2), 'the first operator takes it over again');
  checkInvariants(h.b);
});

test('a plain melee enemy whose strike knocks out its blocker stands for the rest of its clip, then walks on', () => {
  const h = arena([{ chessId: 'weak', row: 9, col: 6 }]);
  h.step();
  const e = h.spawn(ENVOY, { routeIndex: 0 });
  const rest = attackStand(e).rest;
  assert.ok(Math.abs(rest - (2.133 - 0.733)) < 1e-9);
  untilStrike(h, e);
  assert.ok(!h.unit('weak').alive && !e.blockedBy, 'the blocker is knocked out');
  const x0 = e.x;
  h.run(rest - 2 * TICK);
  assert.equal(e.x, x0, 'it finishes its clip where it struck');
  h.run(0.2);
  assert.ok(e.x < x0 - 0.02, 'then it walks on');
});

test('a blocker leaving later in the clip leaves only the rest of it; a displacement ends the stand; a blocked enemy keeps striking every interval', () => {
  const h = arena([{ chessId: 'w1', row: 9, col: 6 }]);
  h.step();
  const wall = h.unit('w1');
  const e = h.spawn(ENVOY, { routeIndex: 0 });
  const ts = untilStrike(h, e);
  // still blocked: the next strike comes one interval later, as before
  assert.ok(h.runUntil(() => e.stats.attacks >= 2, 10));
  assert.ok(Math.abs(h.b.time - ts - e.s.interval) < 2 * TICK + 1e-9, 'one strike per interval while blocked');
  const t2 = h.b.time;
  h.run(1);                                    // 1 s into the 1.4 s rest: the wall is gone
  h.b.releaseBlocked(wall);
  wall.s.flags.noBlock = true;                 // (keeps it from taking the enemy over again: _blockerFor)
  const x0 = e.x;
  h.run(t2 + attackStand(e).rest - h.b.time - 2 * TICK);
  assert.equal(e.x, x0, 'it stands until its clip is over');
  h.run(0.2);
  assert.ok(e.x < x0 - 0.02, 'then it walks');
  // a displacement (失衡) during the stand ends the attack clip's own stand, and then holds the enemy for the flight
  // itself: PRTS《失衡位移机制》's 0.1 s is only the hard stagger — the state runs until the displacement is flown out
  // (constants UNBALANCE_STAGGER / UNBALANCE_TRAVEL). So it walks on once that hold is over, not at once.
  const h2 = arena([{ chessId: 'weak', row: 9, col: 6 }]);
  h2.step();
  const e2 = h2.spawn(ENVOY, { routeIndex: 0 });
  untilStrike(h2, e2);
  assert.ok(h2.b.time < e2.atkStandUntil, 'standing');
  const dist = 0.3;
  assert.ok(h2.b.displace(e2, { x: 1, y: 0 }, dist) > 0);
  assert.equal(e2.atkStandUntil, -Infinity, 'the attack pose stand is over');
  const x1 = e2.x;
  const hold = Math.max(UNBALANCE_STAGGER, UNBALANCE_TRAVEL * Math.sqrt(dist));
  h2.run(hold - 0.05);
  assert.ok(e2.x > x1 - 0.03, `held for the flight (${hold.toFixed(2)} s; x ${x1} → ${e2.x})`);
  h2.run(0.2);
  assert.ok(e2.x < x1 - 0.02, `then it walks on (${x1} → ${e2.x})`);
});
