// test/content/playtest5_followups.test.js — user playtest #5, cross-workstream follow-ups of the integration
// (docs/DESIGN.md §19): the element pipeline rules the workstreams left to the integrator, 塑心 S2's timing and
// 纯烬艾雅法拉's per-source 氤氲.
//   * attack/element.js applyElement refuses a target with no HP left (hasHp — one shared helper): a rider in a `damaged` hook
//     of a killing blow cannot burst the corpse, whatever content adds it.
//   * 脆弱 (dmgTakenMul) does not scale 元素伤害 — gamedata_const ba.fragile "受到的物理、法术、真实伤害提升"; 元素脆弱
//     (elementalTakenMul) does.
//   * element healing lowers EVERY element type by the amount, each on its own — PRTS 菲莱 备注: "清除元素损伤" = "一次等同
//     于自身最大元素值（通常为1000）的全类型元素损伤治疗".
//   * 塑心 S2 安魂的弥撒: "…凋亡损伤生效于当次触发的伤害之前，该造成的凋亡损伤的来源始终为塑心" (PRTS 备注) — the 凋亡 lands
//     before the partner's damage, so a killing blow still carries it.
//   * 纯烬艾雅法拉 氤氲 is keyed per 纯烬 (two of them keep their own stacks and heal source).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, chessRec, checkInvariants } from '../helpers/battleHarness.js';
import { getDefaultSource } from '../../server/sim/simdata.js';
import { hasHp } from '../../server/sim/attack.js';

const SRC = getDefaultSource();
const raw = (id) => SRC.rawChess(id);
const approx = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg}: ${a} ≠ ${b}`);
const dummy = (key, o = {}) => enemyRec({ key, hp: 1e7, speed: 0, ...o });
const plain = (id, o = {}) => chessRec({ id, skill: null, stats: { maxHp: 1e6, ...(o.stats || {}) }, ...o });

// ---------------------------------------------------------------------------------------------------------------------
// the settlement pipeline (attack/element.js)

test('applyElement refuses a target with no HP left: a rider on a killing blow bursts nothing (pipeline guard)', () => {
  for (const lethal of [true, false]) {
    let riders = 0;
    const h = makeBattle({
      content: 'none', autoFinish: false, timeLimit: 30,
      defs: { enemies: { enemy_fu: dummy('enemy_fu', { hp: 1000 }) } },
      enemies: [{ key: 'enemy_fu', pos: [10, 6] }],
      // a content rider with no HP check of its own: 1000 灼燃 on every damage it sees
      setup: (b) => b.on('damaged', (c) => {
        if (c.type === 'element' || c.type === 'elemental' || c.target.side !== 'enemy') return;
        riders++;
        b.dealDamage(null, c.target, { type: 'element', element: 'burn', amount: 1000 });
      }),
    });
    h.step();
    const e = h.enemy('enemy_fu');
    h.b.dealDamage(null, e, { amount: lethal ? 5000 : 10, type: 'true' });
    assert.equal(riders, 1, 'the rider ran');
    if (lethal) {
      assert.equal(e.alive, false);
      assert.equal(e.elem.burn, 0, 'no fill on the corpse');
      assert.equal(h.hooksOf('elementBurst').length, 0, 'no burst on the corpse');
      assert.equal(h.hooksOf('fatal').length, 1, 'one fatal');
      assert.equal(h.hooksOf('kill').length, 1, 'one kill');
    } else {
      assert.equal(h.hooksOf('elementBurst').length, 1, 'a living target still bursts');
    }
    checkInvariants(h.b);
  }
  assert.equal(hasHp(null), false);
  assert.equal(hasHp({ alive: true, hp: 0 }), false);
  assert.equal(hasHp({ alive: true, hp: 0, bossPool: { hp: 5 } }), true, 'a boss: its pool');
  assert.equal(hasHp({ alive: false, hp: 5 }), false);
});

test('脆弱 does not scale 元素伤害 (ba.fragile: 物理、法术、真实); 元素脆弱 does', () => {
  const h = makeBattle({ content: 'none', autoFinish: false, timeLimit: 30, defs: { enemies: { enemy_fu: dummy('enemy_fu') } }, enemies: [{ key: 'enemy_fu', pos: [10, 6] }] });
  h.step();
  const e = h.enemy('enemy_fu');
  const loss = (d) => { const hp0 = e.hp; h.b.dealDamage(null, e, d); return hp0 - e.hp; };
  h.b.applyStatus(e, 'fragile', { duration: 10, value: 0.5 });
  approx(loss({ amount: 1000, type: 'true' }), 1500, '脆弱 on true damage');
  approx(loss({ amount: 1000, type: 'elemental', element: 'burn' }), 1000, '脆弱 skips 元素伤害');
  h.b.applyStatus(e, 'elemFragile', { duration: 10, value: 0.2 });
  approx(loss({ amount: 1000, type: 'elemental', element: 'burn' }), 1200, '元素脆弱');
  approx(loss({ amount: 1000, type: 'true' }), 1500, '元素脆弱 skips true damage');
});

test('element healing lowers every element type by the amount, each on its own (PRTS 菲莱 备注)', () => {
  const h = makeBattle({ content: 'none', autoFinish: false, timeLimit: 30, defs: { chess: { g: plain('g') } }, units: [{ chessId: 'g', row: 10, col: 4 }] });
  h.step();
  const g = h.unit('g');
  Object.assign(g.elem, { burn: 300, neural: 500, apoptosis: 0 });
  approx(h.b.reduceElement(g, 400), 700, 'total removed');
  assert.deepEqual([g.elem.burn, g.elem.neural, g.elem.apoptosis], [0, 100, 0], 'each type −400 (was: 400 in total)');
  Object.assign(g.elem, { burn: 300, neural: 500 });
  approx(h.b.reduceElement(g, 200, 'neural'), 200, 'one element');
  assert.deepEqual([g.elem.burn, g.elem.neural], [300, 300]);
});

// ---------------------------------------------------------------------------------------------------------------------
// 塑心 S2

test('塑心 S2 安魂的弥撒: the partner\'s 凋亡 lands before its damage (PRTS 备注) — a killing blow still carries it', () => {
  const id = 'chess_char_6_09_a', sid = 'skchr_cello_2';
  const s2 = raw(id).skills.find((s) => s.skillId === sid);
  for (const hp of [1e7, 50]) {
    const seq = [];
    const h = makeBattle({
      seed: 7, autoFinish: false, timeLimit: 60,
      defs: { chess: { big: plain('big', { stats: { atk: 2000 } }) }, enemies: { enemy_fu: dummy('enemy_fu', { hp }) } },
      units: [{ chessId: id, row: 10, col: 4, skillIndex: s2.index, carryState: { sp: 999 } }, { chessId: 'big', row: 10, col: 5 }],
      enemies: [{ key: 'enemy_fu', pos: [10, 6] }],
      setup: (b) => {
        b.on('elementHit', (c) => { if (c.dmg.element === 'apoptosis' && c.target.side === 'enemy') seq.push(['el', c.source?.defId, c.target.hp]); });
        b.on('damaged', (c) => { if (c.source?.defId === 'big' && c.type === 'phys') seq.push(['dmg', 'big', c.target.hp]); });
      },
    });
    const u = h.unit(id), big = h.unit('big');
    assert.ok(h.runUntil(() => u.skill.active && u.mem.celloPartner === big, 5), 'S2 running, partner picked');
    assert.ok(h.runUntil(() => seq.some((x) => x[0] === 'dmg'), 10), 'the partner hits');
    const i = seq.findIndex((x) => x[0] === 'dmg');
    assert.ok(i > 0 && seq[i - 1][0] === 'el' && seq[i - 1][1] === id, `the 凋亡 (source 塑心) right before the damage: ${JSON.stringify(seq.slice(0, i + 1))}`);
    assert.ok(seq[i - 1][2] > 0, 'the target still had its HP when the 凋亡 landed');
    if (hp < 1000) assert.equal(h.enemy('enemy_fu')?.alive ?? false, false, 'the killing blow landed after it');
    checkInvariants(h.b);
    assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0]));
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// 纯烬艾雅法拉 氤氲

test('纯烬艾雅法拉 氤氲 is keyed per 纯烬: two of them keep their own stacks and each heals as itself', () => {
  const id = 'chess_char_6_20_a';
  const h = makeBattle({
    seed: 5, autoFinish: false, timeLimit: 60,
    defs: { chess: { g: plain('g') } },
    // the ward stands outside both ranges: only the manual heals below reach it
    units: [{ chessId: id, uid: 1, row: 12, col: 2 }, { chessId: id, uid: 2, row: 12, col: 3 }, { chessId: 'g', uid: 3, row: 9, col: 10 }],
  });
  h.step();
  const a = h.unit(1), b = h.unit(2), g = h.unit(3);
  h.b.heal(a, g, 1);
  h.b.heal(b, g, 1);
  h.b.heal(b, g, 1);
  const ma = g.findBuff(`agoat2:mist:${a.id}`), mb = g.findBuff(`agoat2:mist:${b.id}`);
  assert.ok(ma && mb, 'one 氤氲 per 纯烬');
  assert.deepEqual([ma.stacks, mb.stacks], [1, 2]);
  assert.equal(ma.source, a);
  assert.equal(mb.source, b);
});
