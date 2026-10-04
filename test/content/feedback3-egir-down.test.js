// test/content/feedback3-egir-down.test.js — 阿戈尔 in 联防 (community report #3, GitHub #33 item 3; per players' reports,
// owner's decision 2026-10-04): an operator down at the end of its own combat still takes part in the battle-start devour
// as if it stood (marking order, the unit in front, base ATK / block gains, its own marks' 物理流失) and is then forced
// out — it used to be forced out first, which broke the chain at its tile. Nothing lands on it (it is never knocked out
// again, revived or devoured).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, checkInvariants } from '../helpers/battleHarness.js';
import { FORCED_EXIT } from '../../server/sim/constants.js';

const close = (a, b, eps = 1e-6, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} expected ${b}, got ${a}`);
const bondOn = (count, layers = 0, tier = null, thresholds = [3, 6, 9]) => ({
  count, active: count >= thresholds[0], tier: tier ?? thresholds.filter((t) => count >= t).length, layers,
});
const buffOf = (u, key) => u.buffs.find((b) => b.key === key) ?? null;
const devours = (h) => h.hooksOf('damaged').filter((c) => c.dmg && c.dmg.tags && c.dmg.tags.includes('bond:egir:devour'));

// ---------------------------------------------------------------------------------------------------------------------
// 阿戈尔 devour in 联防 with an operator down since its own combat

const ULPIA = 'chess_char_5_05_a', GHOST = 'chess_char_2_07_a', GLADY = 'chess_char_4_12_a', FODDER = 'chess_char_1_01_a';

function chain(ghostDown, order = [ULPIA, GHOST, GLADY, FODDER]) {
  const h = makeBattle({
    kind: 'unite', autoFinish: false, timeLimit: 60, captureNoisy: true, hooks: ['damaged', 'death', 'deploy'],
    units: order.map((chessId, i) => ({ chessId, row: 10, col: 3 + i, ...(chessId === GHOST && ghostDown ? { carryState: { down: true } } : {}) })),
    bonds: { egirShip: bondOn(3, 0, null, [3, 5]) },
  });
  h.step();
  return h;
}

test('联防 阿戈尔 chain 乌尔比安 → 幽灵鲨 (down) → 歌蕾蒂娅 → fodder: 乌尔比安 gains as if 幽灵鲨 stood, then 幽灵鲨 is forced out', () => {
  const up = chain(false);
  const down = chain(true);
  const [ulpia, ghost, glady, fodder] = [ULPIA, GHOST, GLADY, FODDER].map((id) => down.unit(id));
  const ref = buffOf(up.unit(ULPIA), 'bond:egir:devour');
  const got = buffOf(ulpia, 'bond:egir:devour');
  assert.ok(ref && got, 'both 乌尔比安 devour');
  const base = (id) => down.unit(id).base;
  close(got.mods.atkFlat, base(GHOST).atk + base(GLADY).atk + base(FODDER).atk, 1e-6, 'the base ATK of 幽灵鲨, 歌蕾蒂娅 and the fodder');
  assert.equal(got.mods.blockCnt, base(GHOST).blockCnt + base(GLADY).blockCnt + base(FODDER).blockCnt);
  assert.deepEqual(got.mods, ref.mods, 'exactly the gains of the chain with 幽灵鲨 standing');
  close(ulpia.s.atk, up.unit(ULPIA).s.atk, 1e-6, '乌尔比安 ATK');
  // then she is out: forced out (not knocked out again), never devoured, never revived
  assert.ok(!ghost.alive && ghost.removeReason === FORCED_EXIT && down.b.isDown(ghost), '幽灵鲨 lies on her tile, forced out');
  assert.equal(down.hooksOf('death').filter((c) => c.unit === ghost && c.reason === 'killed').length, 0, 'no knock-out');
  assert.equal(down.hooksOf('deploy').filter((c) => c.unit === ghost && !c.initial).length, 0, 'no revive');
  assert.ok(!devours(down).some((c) => c.target === ghost), 'no 物理流失 on her');
  // standing, 乌尔比安's first mark knocks her out, so her own marks give nothing; down, her marks resolve but find
  // 歌蕾蒂娅 and the fodder already knocked out by 乌尔比安's (cancelled) — the rest resolves alike
  const pairs = (h) => devours(h).map((c) => [c.source.defId, c.target.defId]);
  assert.deepEqual(pairs(up), [[ULPIA, GHOST], [ULPIA, GLADY], [ULPIA, FODDER]]);
  assert.deepEqual(pairs(down), [[ULPIA, GLADY], [ULPIA, FODDER]]);
  assert.equal(glady.alive, up.unit(GLADY).alive);
  assert.equal(fodder.alive, up.unit(FODDER).alive);
  // her own marks (歌蕾蒂娅, the fodder) still give her their base ATK / block for when she is back
  const own = buffOf(ghost, 'bond:egir:devour');
  close(own ? own.mods.atkFlat : 0, base(GLADY).atk + base(FODDER).atk, 1e-6, '幽灵鲨 keeps her marking gains (a persistent buff)');
  checkInvariants(down.b);
  assert.equal(down.result().perPlayer.p1.deaths, up.result().perPlayer.p1.deaths - 1, 'no knock-out counted for her (standing, the devour knocks her out)');
});

/** 幽灵鲨 (down or standing) → 歌蕾蒂娅 → fodder on row 10; 乌尔比安 (+ 深巡, 海霓 for 5 members) on row 12 facing empty tiles. */
function head(ghostDown, five) {
  const units = [
    { chessId: GHOST, row: 10, col: 3, ...(ghostDown ? { carryState: { down: true } } : {}) }, { chessId: GLADY, row: 10, col: 4 },
    { chessId: FODDER, row: 10, col: 5 }, { chessId: ULPIA, row: 12, col: 3 },
    ...(five ? [{ chessId: 'chess_char_1_04_a', row: 12, col: 5 }, { chessId: 'chess_char_3_09_a', row: 12, col: 7 }] : []),
  ];
  const h = makeBattle({
    kind: 'unite', autoFinish: false, timeLimit: 60, captureNoisy: true, hooks: ['damaged', 'death', 'deploy'],
    units, bonds: { egirShip: bondOn(five ? 5 : 3, 0, null, [3, 5]) },
  });
  h.step();
  return h;
}

test('联防 阿戈尔: a down member at the head of the chain devours as if it stood — its 物理流失 lands (credited to it), then it stays out', () => {
  for (const five of [false, true]) {
    const tag = five ? '5 members' : '3 members';
    const up = head(false, five);
    const down = head(true, five);
    const [ghost, glady, fodder] = [GHOST, GLADY, FODDER].map((id) => down.unit(id));
    const g = buffOf(ghost, 'bond:egir:devour');
    close(g.mods.atkFlat, glady.base.atk + fodder.base.atk, 1e-6, `${tag}: marks 歌蕾蒂娅 and, through her, the fodder`);
    const pairs = (h) => devours(h).map((c) => [c.source.defId, c.target.defId]);
    assert.deepEqual(pairs(down), pairs(up), `${tag}: the marks resolve as with 幽灵鲨 standing`);
    assert.deepEqual(pairs(down), [[GHOST, GLADY], [GHOST, FODDER]], `${tag}: her two marks; 歌蕾蒂娅's on the fodder is cancelled (knocked out first)`);
    assert.ok(!fodder.alive, `${tag}: the fodder falls`);
    assert.equal(ghost.stats.kills, up.unit(GHOST).stats.kills, `${tag}: the kills are hers, as standing`);
    assert.ok(!ghost.alive && ghost.removeReason === FORCED_EXIT && down.b.isDown(ghost), `${tag}: 幽灵鲨 stays forced out`);
    const revived = (h, u) => h.hooksOf('deploy').filter((c) => c.unit === u && !c.initial).length;
    if (five) {
      // the 5-tier revive: 歌蕾蒂娅's first knock-out (by the down 幽灵鲨's mark) spends a charge, as standing
      assert.equal(revived(down, glady), 1, '歌蕾蒂娅 revived once');
      assert.equal(revived(up, up.unit(GLADY)), 1);
      assert.ok(glady.alive, '歌蕾蒂娅 stands again');
      close(glady.hp, glady.s.maxHp, 1e-6, 'at full HP: no further mark on her');
      assert.equal(revived(down, ghost), 0, 'the down 幽灵鲨 spends nothing');
    } else {
      assert.ok(!glady.alive, '歌蕾蒂娅 falls to 幽灵鲨\'s mark (3 members: no revive)');
    }
    assert.equal(down.result().perPlayer.p1.deaths, up.result().perPlayer.p1.deaths, `${tag}: the same knock-outs`);
    checkInvariants(down.b);
  }
});
