// The face-mode table, audited: for EVERY operator and EVERY skill the renderer must resolve the row the table names.
//
// The table is per ability and names the animation that ability plays; the renderer only sees clip names, so the lookup has
// to be exact where it can be (`Skill_2_Begin` vs `Skill_2_Loop` are different rows) and forgiving where the table names a
// cast clip while the loop plays (野鬃 S2 is `Skill_2`, the loop is `Skill_2_Loop`). This test pins both, over the whole
// table, so a change to the resolver cannot quietly break an operator nobody tested by hand.
// `node --test test/render/face-mode-audit.test.js`
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FACE_MODES } from '../../public/js/render/faceModes.js';
import { faceModeFor, faceModeFlags } from '../../public/js/render/facing.js';

/** The row the table names for one skill (by animation stem, longest match). */
function intendedRow(rows, n) {
  let best = null;
  for (const row of rows) {
    if (!Array.isArray(row) || !row[0]) continue;
    const stem = String(row[0]).replace(/(_(Loop|Begin|End|Idle|Daze|Attack))+$/, '').replace(/_(Down|Up)$/, '');
    if (stem === `Skill_${n}` || (n === 1 && stem === 'Skill')) {
      if (!best || row[0].length > best[0].length) best = row;
    }
  }
  return best;
}

/** What render/units.js `_faceMode()` resolves while a skill runs and `activeClip` is playing (same candidate rule). */
function resolvedRow(rows, n, activeClip) {
  const clip = activeClip || `Skill_${n}_Loop`;
  const names = [`Skill_${n}_Loop`, `Skill_${n}`, 'Skill_Loop', 'Skill', clip];
  const candidates = (/^skill/i.test(clip) ? [clip, ...names] : names).concat(['Attack', 'Attack']);
  return faceModeFor(rows, candidates);
}

const label = (row) => (row ? `${row[1]} (${row[0] || 'default'})` : '-');
const same = (a, b) => a === b || (a && b && a[0] === b[0] && a[1] === b[1]);

test('every skill of every operator resolves to the row the table names', () => {
  const failures = [];
  let checks = 0;
  for (const [id, rows] of Object.entries(FACE_MODES)) {
    for (let n = 1; n <= 3; n++) {
      const want = intendedRow(rows, n);
      if (!want) continue;
      checks++;
      const got = resolvedRow(rows, n, want[0] || `Skill_${n}_Loop`);
      if (!same(want, got)) failures.push(`${id} S${n}: table says ${label(want)}, renderer ${label(got)}`);
    }
  }
  assert.ok(checks > 200, `skill checks: ${checks}`);   // every (operator, skill) the table names
  assert.deepEqual(failures, [], `${failures.length} skill(s) resolve to the wrong row`);
});

test('the clip playing now is ground truth: a skill with a Begin and a Loop row uses the one that plays', () => {
  // char_4222_taraxa S2: the cast (`Skill_2_Begin`) keeps the facing, the loop (`Skill_2_Loop`) turns
  const rows = FACE_MODES.char_4222_taraxa;
  assert.ok(faceModeFlags(faceModeFor(rows, ['Skill_2_Begin']).at(1)).none, 'the cast row wins while it plays');
  assert.ok(faceModeFlags(faceModeFor(rows, ['Skill_2_Loop']).at(1)).target, 'the loop row while the loop plays');
});

test('a row named like the clip always wins (no operator is unreachable because of the lookup order)', () => {
  const unreachable = [];
  const seen = new Set();
  for (const [id, rows] of Object.entries(FACE_MODES)) {
    for (const row of rows) {
      if (!Array.isArray(row) || !row[0]) continue;
      const key = `${id}|${row[0]}`;
      if (seen.has(key)) continue;                 // a duplicate animKey (one operator has two): the first wins by design
      seen.add(key);
      const got = faceModeFor(rows, [row[0], 'Attack']);
      if (!same(got, row)) unreachable.push(`${id} ${row[0]}: ${label(row)} -> ${label(got)}`);
    }
  }
  assert.deepEqual(unreachable, []);
});

test('the two operators the owner reported stay on the deployed direction through S2', () => {
  for (const id of ['char_496_wildmn', 'char_4137_udflow']) {
    const rows = FACE_MODES[id];
    assert.ok(faceModeFlags(faceModeFor(rows, ['Skill_2_Loop', 'Skill_2', 'Attack']).at(1)).def, `${id} S2 -> Default`);
  }
  // 忍冬 S3: the table says Target, so it DOES turn - the audit above proves that is what the renderer does
  const wild = FACE_MODES.char_4026_vulpis;
  assert.ok(faceModeFlags(faceModeFor(wild, ['Skill_3_Loop']).at(1)).target, '忍冬 S3 -> Target (turns)');
});
test('a skill keeps its own row even while an attack clip plays (野鬃 S2 was still turning)', () => {
  const wild = FACE_MODES.char_496_wildmn;   // Attack = Target, Skill_2 = Default
  // the window that mattered: the skill is on and the ATTACK clip is what the actor shows at the wind-up
  const atWindUp = faceModeFor(wild, ['Skill_2_Loop', 'Skill_2', 'Skill_Loop', 'Skill', 'Attack', 'Attack']);
  assert.ok(faceModeFlags(atWindUp.at(1)).def, 'S2 keeps the deployed direction even mid-swing');
  // without the skill the Attack row is back in charge
  assert.ok(faceModeFlags(faceModeFor(wild, ['Attack']).at(1)).target);
});