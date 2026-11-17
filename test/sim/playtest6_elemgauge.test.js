// test/sim/playtest6_elemgauge.test.js — user playtest #6 report 11, sim side: "干员血条右边的元素损伤条积累速度不对，损伤条
// 远远没扣完但是实际已经爆条受到伤害了". The gauge a unit shows (attack/element.js elementView → b.snap `elem`) must be exactly
// the gauge that bursts (PRTS 元素: "以白条显示剩余的元素值", the shown element = 当前损伤元素, lowest 元素值 > element id):
//   · every tick, the shown element is the one with the least 元素值 left, and the shown remainder (1 − fill) is the
//     sim's remainder rounded UP to 1 % — never less than what is left, so the bar is never empty before the burst;
//   · the element that bursts is the one shown the tick before (one source), and the burst shows as its 爆发冷却;
//   · real 海嗣 against a real operator (古米): 底海滑动者 (15 % ATK 神经 per hit) and 掠海漂移体 (50 % ATK 侵蚀 per hit,
//     × the round's ATK multiplier: a chunk of the gauge per hit) with 骨海漂流体 (20 % 侵蚀).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle } from '../helpers/battleHarness.js';
import { elementView } from '../../server/sim/attack.js';
import { ELEMENT_ORDER } from '../../server/sim/constants.js';

const OP = 'chess_char_1_10_a'; // 古米 (T1 defender, real kit)

/** A real operator with real 海嗣 pinned in contact; returns the harness and the operator. */
function arena(keys, mods = {}) {
  const h = makeBattle({ units: [{ chessId: OP, row: 10, col: 5 }], seed: 3, autoFinish: false, timeLimit: 600 });
  h.step();
  const pos = [[10, 5.6], [10, 4.4], [10.6, 5]];
  keys.forEach((k, i) => h.spawn(k, { pos: pos[i], routeIndex: 0, mods: { speedMul: 0, hpMul: 1000, ...mods } }));
  return { h, u: h.allies()[0] };
}

/** The sim's own view of the gauge: the element with the least 元素值 left (ties: official id) and that remainder. */
function simGauge(u) {
  let best = null, bv = 0;
  for (const k of ELEMENT_ORDER) if (u.elem[k] > bv) { bv = u.elem[k]; best = k; }
  return best ? { el: best, left: 1 - bv / u.gaugeMax } : null;
}

/** Run until `bursts` bursts of the operator happened, checking the shown gauge against the sim's every tick. */
function followGauge(h, u, bursts, maxSeconds = 200) {
  const seen = [];
  let prevShown = null;
  h.b.on('elementBurst', (c) => { if (c.target === u) seen.push({ el: c.element, shownBefore: prevShown }); });
  for (let i = 0; i < maxSeconds * 30 && seen.length < bursts; i++) {
    const snap = h.b.snapshot();
    const entry = (snap.elem || []).find((x) => x[0] === u.id) || null;
    const g = simGauge(u);
    const locked = !!u.s.flags.burstLock;
    if (!locked) {
      if (!g) assert.equal(entry, null, `t=${h.b.time}: no gauge, nothing shown`);
      else {
        assert.ok(entry, `t=${h.b.time}: a gauge (${g.el} ${g.left}) is shown`);
        assert.equal(entry[1], g.el, `t=${h.b.time}: the shown element is the one with the least 元素值 left`);
        const shownLeft = 1 - entry[2];
        assert.ok(shownLeft >= g.left - 1e-9, `t=${h.b.time}: shown remainder ${shownLeft} is never below the real ${g.left}`);
        assert.ok(shownLeft - g.left < 0.01 + 1e-9, `t=${h.b.time}: shown remainder ${shownLeft} within 1 % of the real ${g.left}`);
        assert.ok(shownLeft > 0, `t=${h.b.time}: the bar is not empty before the burst`);
        assert.equal(entry[3], 0, 'no cooldown numbers outside a burst');
      }
    } else {
      assert.equal(entry[2], 1, 'the burst shows full with its cooldown');
      assert.ok(entry[3] > h.b.time && entry[4] > 0);
    }
    prevShown = entry && !locked ? { el: entry[1], left: +(1 - entry[2]).toFixed(2) } : null;
    h.step();
    if (u.alive) u.hp = u.s.maxHp; // keep the operator standing (only its gauge matters)
    assert.ok(u.alive, 'the operator stays on the field');
  }
  return seen;
}

test('底海滑动者 on 古米: the shown gauge is the sim\'s gauge every tick; the burst comes as the bar runs out', () => {
  const { h, u } = arena(['enemy_1148_dssbr']);
  const seen = followGauge(h, u, 2);
  assert.equal(seen.length, 2, 'two 神经 bursts');
  for (const s of seen) {
    assert.equal(s.el, 'neural');
    assert.equal(s.shownBefore.el, 'neural', 'the burst is the element shown the tick before');
    assert.ok(s.shownBefore.left <= 0.05, `a steady 42-per-hit source bursts off a sliver (${s.shownBefore.left} left)`);
  }
});

test('掠海漂移体 (a chunk per hit, × the round\'s ATK) with 骨海漂流体 on 古米: shown = sim every tick, bursts off the shown element', () => {
  const { h, u } = arena(['enemy_2025_syufo', 'enemy_2021_syfish'], { atkMul: 1.771561 }); // 绝境 multi R11
  const seen = followGauge(h, u, 2);
  assert.equal(seen.length, 2);
  for (const s of seen) {
    assert.equal(s.el, 'erosion');
    assert.equal(s.shownBefore.el, 'erosion');
    // one 掠海漂移体 hit = 500 × 1.77 × 0.5 ≈ 443 of 1000: officially the bar drops by ~44 % per hit, so a burst can
    // come off a bar that still shows up to that much — the sim and the bar agree on it
    assert.ok(s.shownBefore.left <= 0.45, `${s.shownBefore.left} left before the burst ≤ one hit`);
  }
});

test('a gauge a few 元素值 short of bursting still shows a sliver (the remainder rounds up, never to an empty bar)', () => {
  const { h, u } = arena([]);
  h.b.dealDamage(null, u, { type: 'element', element: 'neural', amount: 996 });
  assert.equal(u.s.flags.burstLock, undefined, 'no burst yet');
  const v = elementView(u, h.b.time);
  assert.equal(v[0], 'neural');
  assert.ok(v[1] < 1, `fill ${v[1]} < 1: 4 元素值 are left`);
  assert.equal(v[1], 0.99);
  h.b.dealDamage(null, u, { type: 'element', element: 'neural', amount: 3 });
  assert.equal(elementView(u, h.b.time)[1], 0.99, '1 元素值 left still shows');
  h.b.dealDamage(null, u, { type: 'element', element: 'neural', amount: 1 });
  assert.ok(u.s.flags.burstLock, 'the last point bursts');
  assert.deepEqual(elementView(u, h.b.time).slice(0, 2), ['neural', 1], 'now it shows the 爆发冷却');
  // a tiny first hit shows at least 1 %
  const { h: h2, u: u2 } = arena([]);
  h2.b.dealDamage(null, u2, { type: 'element', element: 'burn', amount: 3 });
  assert.equal(elementView(u2, h2.b.time)[1], 0.01);
});
