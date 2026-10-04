// Wheel-convergence guard: the shared scalar / selection helpers each have ONE implementation, and the old copies
// do not creep back. Behaviour tests for the helpers themselves live here too.
//
// Covered:
//   * weightedPick  — the one weighted-draw primitive (server/sim/rng.js); rng.weighted is gone.
//   * countedLeaks  — the one counted-leak filter (server/sim/util.js); only the documented per-entry sites still
//                     spell out `counted !== false`.
//   * the platform reply shapes / noopLog (server/util.js) are declared once.
//   * the numeric helpers (server/sim/util.js) have one implementation (no per-file `const num`/`clamp` clones in
//     the sim/match files that used to carry them).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  clamp, clamp01, numOr, coerceNum, toNum, toNumOrUndef, intOr, posIntOr, posNumOr, finiteIn, roundHalfEven, countedLeaks,
} from '../server/sim/util.js';
import { createRng, weightedPick } from '../server/sim/rng.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Every .js file under `dir` (absolute paths). */
function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && p.endsWith('.js')) out.push(p);
  }
  return out;
}

const SERVER_JS = walk(join(ROOT, 'server'));
const rel = (p) => relative(ROOT, p).split('\\').join('/');
const read = (p) => readFileSync(p, 'utf8');

// ---------------------------------------------------------------------------------------------------------------
// behaviour of the helpers

test('sim/util: scalar helpers keep their documented coercions', () => {
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(clamp(-1, 0, 3), 0);
  assert.equal(clamp01(2), 1);
  assert.equal(clamp01(-2), 0);
  assert.equal(numOr('3', 7), 7, 'strict: a string is not a number');
  assert.equal(numOr(3, 7), 3);
  assert.equal(coerceNum('3', 7), 3);
  assert.equal(coerceNum('', 7), 7);
  assert.equal(coerceNum(null, 7), 7);
  assert.equal(toNum(' 3 ', 7), 3);
  assert.equal(toNum('', 7), 7);
  assert.equal(toNumOrUndef('x'), undefined);
  assert.equal(intOr(3.9, 0), 3);
  assert.equal(intOr(NaN, 5), 5);
  assert.equal(posIntOr(0, 5), 5);
  assert.equal(posIntOr(3, 5), 3);
  assert.equal(posNumOr(0, 5), 5);
  assert.equal(posNumOr(0.5, 5), 0.5);
  assert.equal(finiteIn(3, 0, 5), true);
  assert.equal(finiteIn('3', 0, 5), false);
});

test('sim/util: roundHalfEven is C# Math.Round (half to even)', () => {
  assert.deepEqual([0.5, 1.5, 2.5, 3.5, 4.5, 4.49, 4.51].map(roundHalfEven), [0, 2, 2, 4, 4, 4, 5]);
});

test('sim/util: countedLeaks ignores only counted:false and tolerates junk', () => {
  assert.equal(countedLeaks([{}, { counted: true }, { counted: false }]), 2);
  assert.equal(countedLeaks([null, undefined, { counted: false }]), 0);
  assert.equal(countedLeaks(null), 0);
  assert.equal(countedLeaks(undefined), 0);
});

test('sim/rng: weightedPick picks by weight and handles the empty / zero-total cases', () => {
  const rng = createRng(1);
  assert.equal(weightedPick(rng, []), null);
  assert.equal(weightedPick(rng, [['a', 0], ['b', 0]]), 'a', 'zero total → the first id');
  let a = 0;
  const r2 = createRng(42);
  for (let i = 0; i < 2000; i++) if (weightedPick(r2, [['a', 3], ['b', 1]]) === 'a') a++;
  assert.ok(a > 1200 && a < 1800, `weight 3:1 picked a ${a}/2000`);
});

// ---------------------------------------------------------------------------------------------------------------
// single-source guards

test('server/match/Match reply shapes and noopLog are declared only in server/util.js', () => {
  const patterns = ['const OK = Object.freeze({ ok: true })', 'const noopLog = {', 'const fail = (error, detail) =>'];
  for (const p of patterns) {
    const hits = SERVER_JS.filter((f) => read(f).includes(p)).map(rel);
    assert.deepEqual(hits, ['server/util.js'], `${p} should live only in server/util.js, found in ${hits.join(', ')}`);
  }
});

test('weightedPick is defined once (server/sim/rng.js) and rng.weighted is gone', () => {
  const defs = SERVER_JS.filter((f) => /export function weightedPick\b/.test(read(f))).map(rel);
  assert.deepEqual(defs, ['server/sim/rng.js']);
  const users = SERVER_JS.filter((f) => /\brng\.weighted\(/.test(read(f)));
  assert.deepEqual(users, [], 'rng.weighted was removed; use weightedPick');
});

test('counted !== false survives only at the documented per-entry sites', () => {
  const allow = new Set(['server/sim/util.js', 'server/match/fields.js', 'server/sim/spec.js']);
  const hits = SERVER_JS.filter((f) => read(f).includes('counted !== false')).map(rel).sort();
  for (const f of hits) assert.ok(allow.has(f), `unexpected counted-leak filter in ${f} — use countedLeaks()`);
});

test('sim scalar helpers are not re-declared outside server/sim/util.js', () => {
  // The clones this refactor removed; a new file adding one of these again should import util.js instead.
  const re = /^[ \t]*(export )?(const|let|var) (num|fin|clamp|clamp01) *= *\(|^[ \t]*(export )?function (num|fin|clamp|clamp01) *\(/m;
  const hits = SERVER_JS.filter((f) => re.test(read(f))).map(rel).sort();
  assert.deepEqual(hits, ['server/sim/util.js']);
});
