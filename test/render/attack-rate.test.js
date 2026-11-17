// Attack-clip pacing (render/attackRate.js). The symptom this fixed: at the start of a battle an operator's attack clip
// ran in slow motion. The clip is stretched over the unit's attack interval, the view started from the operator's BASE
// record (`bat × 100 / aspd`) while the battle had already buffed it (宴: 1.20 s guessed vs 0.74 s real = a 62 % slow
// clip), and only the measured gap between attacks pulled it right. The snapshot's own interval now starts the view, the
// measured gap is followed directly (a real change is taken on the next swing), and the sim pushes a changed interval as a
// ['rate', ...] event (EV.RATE) — see test/render/attack-rate.test.js.
// `node --test test/render/attack-rate.test.js`
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  clampAtkInterval, startAtkInterval, nextAtkInterval, ATK_DEFAULT_S, ATK_MAX_S, ATK_MIN_S,
  ATK_JUMP_TOLERANCE, ATK_DRIFT_SHARE, attackRateEvents,
} from '../../public/js/render/attackRate.js';

test('the snapshot interval wins over the base-record guess', () => {
  assert.equal(startAtkInterval(0.74, 1.2), 0.74, '宴 in its stance: the sim says 0.74, the record guessed 1.2');
  assert.equal(startAtkInterval(1, 1.2), 1);
  assert.equal(startAtkInterval(undefined, 1.3), 1.3, 'no snapshot value (an older field): the record guess is used');
  assert.equal(startAtkInterval(0, null), ATK_DEFAULT_S, 'nothing known at all');
  assert.equal(startAtkInterval(NaN, 2), 2);
});

test('intervals are clamped to what the renderer can show', () => {
  assert.equal(clampAtkInterval(0.01), ATK_MIN_S);
  assert.equal(clampAtkInterval(99), ATK_MAX_S);
  assert.equal(clampAtkInterval(1.04), 1.04);
  assert.equal(clampAtkInterval(NaN), ATK_DEFAULT_S);
  assert.equal(clampAtkInterval(-2), ATK_DEFAULT_S);
});

test('the first measured gap replaces the estimate outright', () => {
  const r = nextAtkInterval(1.2, 0.74, false);
  assert.equal(r.measured, true);
  assert.equal(r.interval, 0.74, 'no slow-motion ramp-in');
});

test('a real change is taken on the very next swing (no long smoothing)', () => {
  // a skill turning on / off, an attack-speed buff: 1.20 → 0.74 is far past the tolerance
  for (const [prev, measured] of [[1.2, 0.74], [0.74, 1.2], [1.3, 0.9], [0.9, 1.3]]) {
    const r = nextAtkInterval(prev, measured, true);
    assert.equal(r.measured, true);
    assert.equal(r.interval, measured, `${prev} → ${measured} is followed at once`);
  }
});

test('tick-sized wobble is smoothed, not copied', () => {
  const wobble = 1.0 * (1 + ATK_JUMP_TOLERANCE / 2);       // inside the tolerance
  const r = nextAtkInterval(1.0, wobble, true);
  assert.equal(r.measured, true);
  assert.ok(r.interval > 1.0 && r.interval < wobble, `moved part way (${r.interval})`);
  assert.equal(r.interval, 1.0 + (wobble - 1.0) * ATK_DRIFT_SHARE);
});

test('a stall is not a rhythm', () => {
  for (const d of [0.01, 0.05, 6, 30, NaN, undefined]) {
    const r = nextAtkInterval(1.1, d, true);
    assert.equal(r.measured, false, `gap ${d} is ignored`);
    assert.equal(r.interval, 1.1);
  }
});


for (const attack of [false, true]) {
  test(`batched interval changes retain the last value when an attack is ${attack ? 'present' : 'absent'}`, () => {
    const spawn = ['spawn', { id: 1 }], skill = ['skill', 1, 1];
    const first = ['rate', 1, 1.1], last = ['rate', 1, 0.6], other = ['rate', 2, 2];
    const atk = ['atk', 1, 3, 'none'];
    const input = [spawn, first, skill, ...(attack ? [atk] : []), other, last];
    const output = attackRateEvents(input);
    assert.deepEqual(output.filter(e => e[0] === 'rate'), [last, other]);
    assert.deepEqual(output.filter(e => e[0] !== 'rate'), [spawn, skill, ...(attack ? [atk] : [])]);
    if (attack) assert.ok(output.indexOf(last) < output.indexOf(atk));
    assert.equal(input[1], first, 'the received batch is not mutated');
  });
}
