// test/sim/feedback5-counters-any-damage.test.js — community report of 2026-10-06 (item 30) 「退行的潮涌者的攻击无法触发菲莱2技能
// 的受击反击（排查其他类似技能的干员）」. The enemy is 深溟巢涌者 / 富营养的巢涌者 (the 退行的巢涌者 of the main story): it makes no
// normal attack — its talent hurts every operator in range once a second (PRTS "无途径法术伤害"; buff_template_data
// enemy_dsubrl_aoe[aura]: an AdvancedApplyDamage with the enemy as its source). The official counters fire on ON_TAKE_DAMAGE —
// 菲莱 S2 philae_s_2 with no filter at all, the others on a source of the other side (inverse_damage — 星熊 S2 —,
// inverse_damage[magic] + nian_s_2 — 年 S2 —, bubble_s_2 / bubble_t_1 — 泡泡 —, vendla_s_2 — 刺玫 S2 —, yu_s_1[inverse_damage] —
// 余 S1 —, hsgma2_s_1 — 斩业星熊 S1 —, mlynar_t_2[inverse] — 玛恩纳 无动于衷) — but the remake took enemy attacks only.
// Now any damage instance from an enemy (kits/shared/tier1.js byEnemyDamage; 菲莱: any instance), never a 流失.
// Run: node --test test/sim/feedback5-counters-any-damage.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, checkInvariants } from '../helpers/battleHarness.js';

const NEST = 'enemy_1234_dsubrl';

/**
 * `units` on the flat field, a parked 深溟巢涌者 on `nestAt` (speed ×0: it pulses every operator within 1.6 every second and
 * never attacks); `cast` = the unit whose skill is cast at once. Returns the harness after `seconds`.
 */
function nestFight(units, { cast = null, nestAt = [10, 5], seconds = 8 } = {}) {
  const h = makeBattle({ seed: 7, autoFinish: false, timeLimit: 60, captureNoisy: true, hooks: ['damaged', 'attack', 'hit'], units });
  h.step();
  const nest = h.spawn(NEST, { pos: nestAt, mods: { speedMul: 0 } });
  if (cast) { const u = h.unit(cast); u.skill.gainSp(999, 'test'); if (!u.skill.active) assert.ok(u.skill.activate('test'), `${cast}: cast`); }
  h.run(seconds);
  checkInvariants(h.b);
  return { h, nest };
}
const fromTo = (h, src, tgt, pred) => h.hooksOf('damaged').filter((c) => c.source === src && c.target === tgt && pred(c));
const tagged = (tag) => (c) => (c.dmg?.tags || []).includes(tag);
/** The pulses `u` took (the 巢涌者's arts instances; its 神经损伤 rider is an element 损伤, no counter's business). */
const pulsesOn = (h, nest, u) => fromTo(h, nest, u, (c) => c.type === 'arts').length;

test('the 巢涌者 never attacks — its pulse is the only damage it deals (the operators take it)', () => {
  const { h, nest } = nestFight([{ chessId: 'chess_char_4_17_a', row: 10, col: 4, skillIndex: 1 }]);
  assert.equal(h.hooksOf('attack').filter((c) => c.attacker === nest).length, 0, 'no normal attack');
  const pulses = h.hooksOf('damaged').filter((c) => c.source === nest && c.target.side === 'ally');
  assert.ok(pulses.length >= 3, `pulses ${pulses.length}`);
  assert.ok(pulses.every((c) => !c.dmg.isAttack), 'not an attack');
});

test('菲莱 S2 冥河诅咒: the pulse sets off her blast (every 2 s at most) — until 0.2.0 it never did', () => {
  for (const id of ['chess_char_3_06_a', 'chess_char_3_06_b']) {
    const { h, nest } = nestFight([{ chessId: id, row: 10, col: 4, skillIndex: 1 }], { cast: id });
    const u = h.unit(id);
    const n = pulsesOn(h, nest, u);
    const blasts = fromTo(h, u, nest, tagged('counter'));
    assert.ok(n >= 4, `${id}: ${n} pulses`);
    assert.equal(blasts.length, Math.ceil(n / 2), `${id}: ${blasts.length} blasts for ${n} pulses a second apart (aoe_cd 2 s)`);
  }
});

test('星熊 S2 荆棘, 泡泡 “挨打” (+ 尖刺盾), 余 S1, 玛恩纳 无动于衷: each answers the pulse', () => {
  const each = (label, f, unitId, pred, observesCancelled = false) => {
    const u = f.h.unit(unitId);
    const n = observesCancelled ? f.h.hooksOf('hit').filter(c => c.source === f.nest && c.target === u && c.dmg.type === 'arts').length
      : pulsesOn(f.h, f.nest, u);
    assert.ok(n >= 4, `${label}: ${n} pulses`);
    assert.equal(fromTo(f.h, u, f.nest, pred).length, n, `${label}: one answer per pulse`);
  };
  each('星熊 S2 荆棘', nestFight([{ chessId: 'chess_char_4_17_a', row: 10, col: 4, skillIndex: 1 }]), 'chess_char_4_17_a', tagged('counter'), true);
  const bb = nestFight([{ chessId: 'chess_char_2_08_a', row: 10, col: 4, skillIndex: 1 }], { cast: 'chess_char_2_08_a' });
  each('泡泡 S2 “挨打”', bb, 'chess_char_2_08_a', tagged('counter'));
  assert.ok(bb.nest.findBuff('bubble:spike'), '泡泡 尖刺盾 on the pulse\'s source');
  // 余 S1 — the 灼燃损伤 rider: once the 巢涌者's gauge bursts, its 爆发冷却 refuses further fills, so count the answers that landed
  const yu = nestFight([{ chessId: 'chess_char_6_03_a', row: 10, col: 4, skillIndex: 0 }], { cast: 'chess_char_6_03_a' });
  const yuN = fromTo(yu.h, yu.h.unit('chess_char_6_03_a'), yu.nest, (c) => c.type === 'element').length;
  assert.ok(yuN >= 3, `余 S1 灼燃损伤: ${yuN} answers`);
  each('玛恩纳 无动于衷', nestFight([{ chessId: 'chess_char_5_19_a', row: 10, col: 4 }]), 'chess_char_5_19_a', tagged('reflect'));
});

test('刺玫 S2 荆藤庇荫: a pulse on her protégé is answered (the counter names the protégé for her trait heal)', () => {
  const { h, nest } = nestFight([
    { chessId: 'chess_char_1_06_a', row: 10, col: 3, skillIndex: 1 },
    { chessId: 'chess_char_4_17_a', row: 10, col: 4, skillIndex: 0 },
  ], { cast: 'chess_char_1_06_a' });
  const v = h.unit('chess_char_1_06_a'), p = v.mem.protege;
  assert.ok(p && p.defId === 'chess_char_4_17_a', 'the protégé');
  const hits = fromTo(h, v, nest, tagged('counter'));
  const n = h.hooksOf('hit').filter(c => c.source === nest && c.target === p && c.dmg.type === 'arts').length;
  assert.ok(n >= 4, `${n} pulses on the protégé (including armor-blocked injury)`);
  assert.equal(hits.length, n, `one counter per pulse on the protégé (${hits.length})`);
  assert.ok(hits.every((c) => c.dmg.traitAlly === p));
});

test('自选 年 S2 铜印 and 斩业星熊 S1 恶业苦果 answer the pulse too', () => {
  const ni = nestFight([{ diy: { slot: 6, charId: 'char_2014_nian', skillIndex: 1 }, row: 10, col: 4 }]);
  const n = ni.h.allies().find((u) => u.def?.charId === 'char_2014_nian' || u.charId === 'char_2014_nian' || /nian/.test(u.def?.diy?.charId ?? ''));
  assert.ok(n, '年 fielded');
  n.skill.gainSp(999, 'test');
  if (!n.skill.active) n.skill.activate('test');
  const before = pulsesOn(ni.h, ni.nest, n);
  ni.h.run(6);
  assert.ok(fromTo(ni.h, n, ni.nest, tagged('counter')).length >= pulsesOn(ni.h, ni.nest, n) - before && pulsesOn(ni.h, ni.nest, n) - before >= 4, '年 S2');
  assert.ok(ni.nest.findBuff('silence') || ni.nest.s.flags.silence, '年 S2 silences the source');

  const hm = nestFight([{ diy: { slot: 6, charId: 'char_1044_hsgma2', skillIndex: 0 }, row: 10, col: 4 }]);
  const s = hm.h.allies()[0];
  s.skill.gainSp(999, 'test');
  if (!s.skill.active) s.skill.activate('test');
  const before2 = pulsesOn(hm.h, hm.nest, s);
  hm.h.run(6);
  assert.ok(fromTo(hm.h, s, hm.nest, tagged('counter')).length >= pulsesOn(hm.h, hm.nest, s) - before2 && pulsesOn(hm.h, hm.nest, s) - before2 >= 4, '斩业星熊 S1');
});

test('HP loss and source-less credit do not trigger Hoshiguma; tagged enemy damage still does', () => {
  const h = makeBattle({ seed: 7, autoFinish: false, timeLimit: 60, captureNoisy: true, hooks: ['damaged'],
    units: [{ chessId: 'chess_char_4_17_a', row: 10, col: 4, skillIndex: 1 }] });
  h.step();
  const nest = h.spawn(NEST, { pos: [10, 8], mods: { speedMul: 0 } });   // out of pulse range
  const u = h.unit('chess_char_4_17_a');
  u.skill.gainSp(999, 'test');
  if (!u.skill.active) u.skill.activate('test');
  h.step();
  h.b.loseHp(u, 10, { source: nest });
  assert.equal(fromTo(h, u, nest, tagged('counter')).length, 0, 'HP loss is not injury');
  h.b.dealDamage(nest, u, { amount: 10, type: 'true', tags: ['counter'] });
  h.b.dealDamage(nest, u, { amount: 10, type: 'true', tags: ['reflect'] });
  assert.equal(fromTo(h, u, nest, tagged('counter')).length, 2, 'native enemy-source filter does not inspect descriptive tags');
  h.b.dealDamage({ source: null, credit: nest, target: u, amount: 10, type: 'true', tags: ['reflect'] });
  assert.equal(fromTo(h, u, nest, tagged('counter')).length, 2, 'credit is not an actual source');
  h.b.dealDamage(nest, u, { amount: 10, type: 'true' });   // thorns observes this instance even if her armor blocks it
  assert.equal(fromTo(h, u, nest, tagged('counter')).length, 3, 'a plain damage instance does');
  checkInvariants(h.b);
});
