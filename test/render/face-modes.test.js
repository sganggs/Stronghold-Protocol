// render/faceModes.js — the official per-ability face modes (@Seals-awa's extraction, PR #730; DESIGN §37.329): the
// table's shape, that nothing in it is lost by leaving out the all-Target operators, the operators it does not cover,
// and the lookup over the whole table (the PR's audit, kept as a test): every skill row the table names is the row the
// renderer resolves for that skill.
//
//   node --test test/render/face-modes.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FACE_MODES } from '../../public/js/render/faceModes.js';
import { faceModeFor, faceModeFlags, faceAction } from '../../public/js/render/facing.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FLAGS = new Set(['Target', 'none', 'Default', 'Front', 'FirstCastTarget', 'ForceToDirection', 'CheckDownAttack']);
const KINDS = new Set(['attack', 'skill', 'other', 'unspecified']);

test('every row is [animKey, mode, up, down, escapeTime, kind] with known flags; every operator has a non-Target row', () => {
  const ids = Object.keys(FACE_MODES);
  assert.equal(ids.length, 109);
  let rows = 0;
  for (const id of ids) {
    assert.match(id, /^char_\d+_[a-z0-9]+$/, id);
    const list = FACE_MODES[id];
    assert.ok(Array.isArray(list) && list.length, id);
    assert.ok(list.some((r) => r[1] !== 'Target'), `${id}: an all-Target operator draws as one without rows`);
    for (const r of list) {
      rows++;
      assert.equal(r.length, 6, id);
      assert.equal(typeof r[0], 'string');
      for (const flag of r[1].split('+')) assert.ok(FLAGS.has(flag), `${id}: ${r[1]}`);
      assert.equal(typeof r[2], 'string');
      assert.equal(typeof r[3], 'string');
      assert.ok(Number.isFinite(r[4]) && r[4] >= 0, id);
      assert.ok(KINDS.has(r[5]), `${id}: ${r[5]}`);
    }
  }
  assert.equal(rows, 464);
});

test('the file carries no broken characters (the PR\'s header comments had mojibake)', () => {
  const src = readFileSync(path.join(ROOT, 'public/js/render/faceModes.js'), 'utf8');
  assert.doesNotMatch(src, /[�]|鈥|閲|娣|鍥|绱|鈬/);
  const facing = readFileSync(path.join(ROOT, 'public/js/render/facing.js'), 'utf8');
  assert.doesNotMatch(facing, /[�]|鈥|閲|娣|鍥|绱|鈬/);
});

test('operators the extraction did not cover have no rows: they turn toward the target (Target) [ASSUMED]', () => {
  for (const id of ['char_1012_skadi2', 'char_4045_heidi', 'char_4244_tocka', 'char_4245_alga', 'char_4246_dminon', 'char_4247_oxi', 'char_618_acrbot']) {
    assert.equal(FACE_MODES[id], undefined, id);
    assert.equal(faceAction(faceModeFlags(faceModeFor(FACE_MODES[id], ['Attack'], 'attack')?.[1])), 'target', id);
  }
});

test('spot checks against the table', () => {
  const act = (id, cands, kind, opts) => faceAction(faceModeFlags(faceModeFor(FACE_MODES[id], cands, kind, opts)?.[1]));
  assert.equal(act('char_134_ifrit', ['Attack'], 'attack'), 'none', '伊芙利特 never turns for her attack');
  assert.equal(act('char_1013_chen2', ['Attack'], 'attack'), 'deploy', '假日威龙陈 keeps her deployed facing');
  assert.equal(act('char_496_wildmn', ['Attack'], 'attack'), 'target');
  assert.equal(act('char_496_wildmn', ['Skill_2_Loop', 'Skill_2'], 'skill'), 'deploy', '野鬃 S2 keeps the deployed facing');
  assert.equal(act('char_4222_taraxa', ['Skill_2_Begin'], 'skill'), 'none', 'the clip playing is ground truth: the cast');
  assert.equal(act('char_4222_taraxa', ['Skill_2_Loop'], 'skill'), 'target', 'and the loop');
  const k = FACE_MODES.char_1052_kalts2;
  assert.ok(faceModeFlags(faceModeFor(k, ['Skill_3_Attack'], 'skill', { firstCast: true })[1]).firstCast, '凯尔希 S3 first attack');
  assert.ok(!faceModeFlags(faceModeFor(k, ['Skill_3_Attack'], 'skill', { firstCast: false })[1]).firstCast, 'and the later ones');
});

test('the operators whose rows disagree for one clip are the 13 the docs list; they resolve to Target [ASSUMED]', () => {
  // groups faceModeFor cannot tell apart: the default rows (no name), or one name and kind — first-cast rows apart
  const act = (r) => faceAction(faceModeFlags(r[1]));
  const found = {};
  for (const [id, rows] of Object.entries(FACE_MODES)) {
    const groups = new Map();
    for (const r of rows) {
      const key = r[0] ? `${r[0]}/${r[5]}` : '';
      const g = `${key}|${/FirstCastTarget/.test(r[1])}`;
      if (!groups.has(g)) groups.set(g, { key, rows: [] });
      groups.get(g).rows.push(r);
    }
    for (const { key, rows: g } of groups.values()) {
      if (new Set(g.map(act)).size > 1) (found[id] ||= []).push(key);
    }
  }
  assert.deepEqual(found, {
    char_002_amiya: [''], char_1026_gvial2: ['Attack/attack'], char_1040_blaze2: [''], char_1041_angel2: [''],
    char_2015_dusk: [''], char_297_hamoni: [''], char_338_iris: [''], char_4080_lin: [''], char_4126_fuze: ['Attack/attack'],
    char_4182_oblvns: ['Attack/attack'], char_4217_makoto: [''], char_4222_taraxa: [''], char_469_indigo: [''],
  });
  const at = (id, cands) => faceAction(faceModeFlags(faceModeFor(FACE_MODES[id], cands, 'attack')?.[1]));
  // 新约能天使 (the default pool): no Attack row, two default rows (none, Target) — she turns, in either row order
  assert.equal(at('char_1041_angel2', ['Attack_Loop', 'Attack_Loop', 'Attack']), 'target');
  const rev = [...FACE_MODES.char_1041_angel2].reverse();
  assert.equal(faceAction(faceModeFlags(faceModeFor(rev, ['Attack_Loop', 'Attack'], 'attack')[1])), 'target');
  assert.equal(at('char_1026_gvial2', ['Attack']), 'target', '百炼嘉维尔: Target, Target, Default');
  assert.equal(at('char_4126_fuze', ['Attack']), 'target');
  assert.equal(at('char_4182_oblvns', ['Attack']), 'target', '8 Default rows and 2 Target ones: still a conflict');
  assert.equal(at('char_4182_oblvns', ['Combat']), 'deploy', 'its Combat row alone: Default');
  assert.equal(at('char_4098_vvana', ['Attack']), 'target', 'Target and Target+ForceToDirection agree');
  assert.equal(at('char_2015_dusk', ['Attack']), 'none', '夕: her Attack rows agree (none); the default rows are not reached');
});

/** The row the table names for skill n (by animation stem, the longest match) — the PR's audit. */
function intendedRow(rows, n) {
  let best = null;
  for (const row of rows) {
    if (!row[0]) continue;
    const stem = String(row[0]).replace(/(_(Loop|Begin|End|Idle|Daze|Attack))+$/, '').replace(/_(Down|Up)$/, '');
    if (stem === `Skill_${n}` || (n === 1 && stem === 'Skill')) {
      if (!best || row[0].length > best[0].length) best = row;
    }
  }
  return best;
}

test('every skill row of every operator resolves to itself while its clip plays (render/units.js _faceMode order)', () => {
  const failures = [];
  let checks = 0;
  for (const [id, rows] of Object.entries(FACE_MODES)) {
    for (let n = 1; n <= 3; n++) {
      const want = intendedRow(rows, n);
      if (!want) continue;
      checks++;
      // the clip playing, the skill names of slot n, then the attack (UnitView._faceMode while a skill runs)
      const got = faceModeFor(rows, [want[0], `Skill_${n}_Loop`, `Skill_${n}`, 'Skill_Loop', 'Skill', 'Attack', 'Attack'], 'skill');
      if (!(got && got[0] === want[0] && got[1] === want[1]) && !(got && got[0] === want[0] && /FirstCastTarget/.test(got[1]))) {
        failures.push(`${id} S${n}: table ${want[1]} (${want[0]}), resolved ${got ? `${got[1]} (${got[0]})` : '-'}`);
      }
    }
  }
  assert.ok(checks > 60, `skill checks: ${checks}`);
  assert.deepEqual(failures, []);
});
