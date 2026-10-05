// Hand-authored 甄选 (DIY) operator kits — 望 / 丰川祥子 / 贝洛内 (server/sim/content/kits/custom-wang.js,
// custom-oblvns.js, custom-demetr.js; registered in kits/custom.js). Each test asserts the signature mechanic with
// the official blackboards' numbers; the whole candidate set × every selectable skill runs in
// test/match/custom-operators.test.js (deployment + zero content errors).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { customRuntimeId } from '../../shared/customOperators.js';

const SLOT6 = 'chess_char_6_diy1_a';
/** Battle with the golden tier-VI variant of `charId` on the flat stage; one idle dummy at (10, 5). */
function battle(charId, skillIndex, extra = {}) {
  const id = customRuntimeId(SLOT6, charId, 0, true);
  const h = makeBattle({
    autoFinish: false, timeLimit: 60,
    units: [{ chessId: id, skillIndex, moduleId: 'none', row: 10, col: 4 }],
    defs: { enemies: { dummy: enemyRec({ key: 'dummy', hp: 1e7, atk: 0, speed: 0 }) } },
    enemies: [{ key: 'dummy', pos: [10, 5] }],
    hooks: ['damaged', 'statusApplied', 'attack'], captureNoisy: true, ...extra,
  }).step();
  return { h, u: h.unit(id) };
}
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} != ${b}`);

test('望 取势: two 棋子 per cast; an enemy entering a stone takes 120 % ATK arts and 停顿', () => {
  const { h, u } = battle('char_2027_wang', 0);
  assert.equal(u.skill.activate('smoke', { free: true }), true);
  const stones = () => h.b.allyUnits.filter((a) => a.kind === 'token' && a.defId === 'token_10064_wang_stone1' && a.alive);
  assert.equal(stones().length, 2, 'two stones per cast');
  const atk = u.s.atk;
  const s = stones()[0];
  // 料敌机先: +10 % damage per other stone on the triggered stone's row/column (max 3 stacks)
  const line = stones().filter((x) => x !== s && (x.tileR === s.tileR || x.tileC === s.tileC)).length;
  const before = h.hooksOf('damaged').length;
  h.spawn('dummy', { pos: [s.tileR, s.tileC] });
  h.run(1.2);
  const hits = h.hooksOf('damaged').slice(before).filter((c) => c.source === u && c.target.side === 'enemy');
  const trigger = hits.find((c) => c.type === 'arts');
  assert.ok(trigger, 'the stone triggers');
  close(trigger.amount, atk * 1.2 * (1 + 0.1 * Math.min(3, line)), 'S1 trigger damage = 120 % ATK arts × 料敌机先');
  assert.ok(h.hooksOf('statusApplied').some((c) => c.status === 'sluggish' && c.target.side === 'enemy'), '停顿 applied by the trigger');
  assert.equal(stones().length, 1, 'the triggered stone is spent');
  checkInvariants(h.b);
});

test('丰川祥子 新月的苏醒: eight arts notes decaying 0.80 → 0.04 × ATK (total 3.37 × ATK)', () => {
  const { h, u } = battle('char_4182_oblvns', 0);
  const atk = u.s.atk;
  assert.equal(u.skill.activate('smoke', { free: true }), true);
  h.run(1.5);
  const notes = h.hooksOf('damaged').filter((c) => c.source === u && c.type === 'arts' && c.target.side === 'enemy');
  assert.equal(notes.length, 8, 'eight notes');
  close(notes.reduce((n, c) => n + c.amount, 0), atk * 3.37, 'note total = 3.37 × ATK');
  checkInvariants(h.b);
});

test('贝洛内 家主的余裕: the next attack hits twice at 210 % ATK and 家族手段 lowers the target\'s DEF', () => {
  const { h, u } = battle('char_4037_demetr', 0);
  const atk = u.s.atk;
  const dummy = h.enemies()[0];
  assert.equal(u.skill.activate('smoke', { free: true }), true);
  h.run(2);
  const hits = h.hooksOf('damaged').filter((c) => c.source === u && c.target === dummy && c.dmg?.isAttack);
  // 家族手段 scales with the target's missing HP (×1.28 at ≤20 %), so the pair is ATK × 2.1 up to a relative epsilon
  const empowered = hits.filter((c) => c.dmg.isSkill);
  assert.equal(empowered.length, 2, 'the next attack hits twice');
  for (const c of empowered) assert.ok(Math.abs(c.amount - atk * 2.1) <= 1e-3 * atk * 2.1, `empowered per-hit damage = 210 % ATK: ${c.amount}`);
  assert.ok(hits.some((c) => !c.dmg.isSkill), 'later attacks are plain');
  assert.ok(dummy.buffs.some((b) => b.key.startsWith('demetr:def:')), '家族手段 DEF-down stack on the target');
  checkInvariants(h.b);
});
