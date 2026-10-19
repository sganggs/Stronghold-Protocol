// Audit: for EVERY operator and every skill index, does the renderer's resolver pick the row the table intends?
//   node tools/audit-face-modes.mjs
//
// The table is per ability: a row names the animation that ability plays (`Attack`, `Skill_2`, `Skill_2_Loop`, `Combat`,
// `Attack_A`, …). The renderer has to find that row at runtime from the clip names it can see, so this script simulates
// that lookup for skill 1..3 of every operator and reports where the answer differs from the row the table names.
import { FACE_MODES } from '../public/js/render/faceModes.js';
import { faceModeFor } from '../public/js/render/facing.js';

const stem = (name) => String(name || '').replace(/(_(Loop|Begin|End|Idle|Daze|Attack))+$/, '').replace(/_(Down|Up)$/, '');

/** The row the table names for one skill index (by animation STEM, the longest match). */
function intendedRow(rows, n) {
  let best = null;
  for (const row of rows) {
    if (!Array.isArray(row) || !row[0]) continue;
    const s = stem(row[0]);
    if (s === `Skill_${n}` || s === `Skill_${n}_Loop` || s === 'Skill' || s === `Skill_${n}`) {
      if (!best || row[0].length > best[0].length) best = row;
    }
  }
  // `Skill_Loop` (no index) is the first skill's loop in the official clips
  if (!best && n === 1) {
    for (const row of rows) if (Array.isArray(row) && row[0] && stem(row[0]) === 'Skill') { best = row; break; }
  }
  return best;
}

/** What render/units.js `_faceMode()` would resolve for that skill (candidate list, in its order). */
function resolvedRow(rows, n, activeClip) {
  // mirrors render/units.js _faceMode(): while the skill runs the skill names decide; a skill clip playing now wins over
  // the guesses. The attack clip only comes in when no skill row exists at all.
  const clip = activeClip || `Skill_${n}_Loop`;
  const skillNames = [`Skill_${n}_Loop`, `Skill_${n}`, 'Skill_Loop', 'Skill', clip];
  const candidates = (/^skill/i.test(clip) ? [clip, ...skillNames] : skillNames).concat(['Attack', 'Attack']);
  return faceModeFor(rows, candidates);
}

const label = (row) => (row ? `${row[1]}${row[0] ? ` (${row[0]})` : ' (default)'}` : '-');
const same = (a, b) => (a === b) || (a && b && a[0] === b[0] && a[1] === b[1]);

let ops = 0, withSkillRows = 0, checks = 0;
const mismatches = [];
const modes = new Map();
const unreachable = [];
for (const [id, rows] of Object.entries(FACE_MODES)) {
  ops++;
  const skillRows = rows.filter((r) => Array.isArray(r) && r[0] && /^Skill/.test(r[0]));
  if (!skillRows.length) continue;
  withSkillRows++;
  for (const row of skillRows) modes.set(row[1], (modes.get(row[1]) || 0) + 1);
  for (let n = 1; n <= 3; n++) {
    const want = intendedRow(rows, n);
    if (!want) continue;
    checks++;
    // the clip the unit is really playing during that skill, and the one it may be showing (an attack) at wind-up time
    const got = resolvedRow(rows, n, want[0] || `Skill_${n}_Loop`);
    if (!same(want, got)) mismatches.push({ id, n, want: label(want), got: label(got) });
  }
}

console.log(`operators: ${ops} | with skill rows: ${withSkillRows} | skill checks: ${checks}`);
console.log('skill row modes:', [...modes.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(', '));
console.log(`mismatches: ${mismatches.length}`);
for (const m of mismatches.slice(0, 40)) console.log(`  ${m.id} S${m.n}: table says ${m.want} | renderer ${m.got}`);
if (mismatches.length > 40) console.log(`  … ${mismatches.length - 40} more`);

// skills whose row the resolver can never reach (they would fall back to the ability default / Attack)
for (const [id, rows] of Object.entries(FACE_MODES)) {
  for (const row of rows) {
    if (!Array.isArray(row) || !row[0] || !/^Skill/.test(row[0])) continue;
    const n = (row[0].match(/Skill_(\d)/) || [])[1];
    const probe = Number(n) || 1;
    if (!same(row, resolvedRow(rows, probe, row[0]))) unreachable.push(`${id} ${row[0]}`);
  }
}
console.log(`unreachable skill rows: ${unreachable.length}`);
for (const u of unreachable.slice(0, 20)) console.log('  ' + u);
