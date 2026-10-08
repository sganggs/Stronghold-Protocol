// test/ci.test.js — tools/ci.mjs (the local run of .github/workflows/ci.yml): its step list is ci.yml's, the reader of
// the workflow, the arguments, the env and the summary. Nothing here boots a server or runs a step.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  CI_TEST_ENV, ROOT, SKIPPED_CI_STEPS, SMOKE_PATHS, STEPS, binPath, formatDuration, formatSummary, isSkippedCiStep,
  parseArgs, parseWorkflow, selectSteps, stepEnv,
} from '../tools/ci.mjs';

const workflow = parseWorkflow(fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

/** ci.yml's smoke run block as smoke() in tools/ci.mjs mirrors it (lines trimmed, comments dropped). */
const SMOKE_CI_RUN = [
  'node server/index.js > server.log 2>&1 &',
  'pid=$!',
  'ok=',
  'for i in $(seq 1 30); do',
  'if curl -fsS http://127.0.0.1:3000/healthz; then ok=1; break; fi',
  'sleep 1',
  'done',
  'echo',
  '[ -n "$ok" ] || { cat server.log; exit 1; }',
  'curl -fsS -o index.out http://127.0.0.1:3000/',
  "grep -qi '<html' index.out",
  'curl -fsS -o /dev/null http://127.0.0.1:3000/vendor/pixi.min.js',
  'node tools/doctor.mjs || true',
  'kill $pid || true',
];

test('every ci.yml step is mirrored by a tools/ci.mjs step or skipped on purpose, and none is invented', () => {
  const ciSteps = Object.entries(workflow.jobs).flatMap(([job, j]) => j.steps.map((s) => ({ job, ...s })));
  assert.ok(ciSteps.length >= 6, 'ci.yml was read');
  const unknown = ciSteps.filter((s) => !isSkippedCiStep(s) && !STEPS.some((l) => l.ci.job === s.job && l.ci.name === s.name));
  assert.deepEqual(unknown.map((s) => `${s.job}: ${s.name || s.uses}`), [], 'ci.yml steps tools/ci.mjs does not run');
  for (const l of STEPS) {
    assert.ok(ciSteps.some((s) => s.job === l.ci.job && s.name === l.ci.name), `${l.id} mirrors no ci.yml step (${l.ci.job}: ${l.ci.name})`);
  }
  for (const k of SKIPPED_CI_STEPS) assert.ok(ciSteps.some((s) => isSkippedCiStep(s) && (k.uses ? s.uses?.startsWith(k.uses) : s.name === k.name)), `stale skip ${k.uses || k.name}`);
  // the local order is the workflow's (job test, then job tooling)
  const order = ciSteps.filter((s) => !isSkippedCiStep(s)).map((s) => STEPS.find((l) => l.ci.job === s.job && l.ci.name === s.name).id);
  assert.deepEqual(order, STEPS.map((s) => s.id));
});

test('the commands match ci.yml: the run lines, the npm scripts ci.yml calls, the smoke script, the job env, no step config', () => {
  const run = (job, name) => workflow.jobs[job].steps.find((s) => s.name === name).run;
  for (const l of STEPS) {
    const r = run(l.ci.job, l.ci.name);
    if (l.npm) {
      assert.equal(r, `npm run ${l.npm}`, l.id);
      assert.equal(pkg.scripts[l.npm], l.describe, `package.json script ${l.npm} is what ${l.id} runs`);
    } else if (l.id !== 'smoke') assert.equal(r, l.describe, l.id);
  }
  const smokeRun = run('test', STEPS.find((s) => s.id === 'smoke').ci.name);
  const urls = [...smokeRun.matchAll(/http:\/\/127\.0\.0\.1:3000([^\s;]*)/g)].map((m) => m[1] || '/');
  assert.deepEqual([...new Set(urls)].sort(), [...SMOKE_PATHS].sort());
  // The whole smoke script, comments and indentation aside: any edit to it (the wait loop, the page check, …) fails
  // here, so that smoke() in tools/ci.mjs is looked at and this copy updated with it.
  const normalized = smokeRun.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  assert.deepEqual(normalized, SMOKE_CI_RUN, "ci.yml's smoke step changed: update smoke() in tools/ci.mjs and SMOKE_CI_RUN");
  // job env: ci.yml's job test env is CI_TEST_ENV; any other job has none (stepEnv gives the tooling steps nothing)
  for (const [job, j] of Object.entries(workflow.jobs)) {
    assert.deepEqual(j.env, job === 'test' ? CI_TEST_ENV : {}, `env of job ${job}`);
  }
  // per-step config (env, if, continue-on-error, working-directory, with, …) on a mirrored step is not mirrored
  for (const l of STEPS) {
    const s = workflow.jobs[l.ci.job].steps.find((x) => x.name === l.ci.name);
    assert.deepEqual(s.other || [], [], `${l.id}: ci.yml step keys tools/ci.mjs does not mirror`);
    assert.ok(!s.shell || l.id === 'smoke', `${l.id}: shell: ${s.shell}`);
  }
  assert.equal(pkg.scripts.ci, 'node tools/ci.mjs');
});

test('the workflow reader: jobs, flat env, named and uses steps, run blocks; comments and nested blocks skipped, other step keys named', () => {
  const yml = [
    'name: X', 'on:', '  push:', 'jobs:', '  a:', '    runs-on: x', '    env:', "      K: '1'", '      L: "two"', '    steps:',
    '      - uses: actions/checkout@v7', '      - uses: actions/setup-node@v7', '        with:', '          node-version: 22',
    '      # a comment', '      - name: One', '        if: always()', '        run: echo 1', '        env:', '          X: 1',
    '      - name: Block', '        shell: bash', '        run: |',
    '          a', '', '            b', '          c', '  b:', '    steps:', '      - run: x', 'other: 1', '  ignored: 2',
  ].join('\r\n');
  assert.deepEqual(parseWorkflow(yml), {
    jobs: {
      a: { env: { K: '1', L: 'two' }, steps: [
        { uses: 'actions/checkout@v7' }, { uses: 'actions/setup-node@v7', other: ['with'] }, { name: 'One', run: 'echo 1', other: ['if', 'env'] },
        { name: 'Block', shell: 'bash', run: 'a\n\n  b\nc' },
      ] },
      b: { env: {}, steps: [{ run: 'x' }] },
    },
  });
  assert.deepEqual(parseWorkflow('name: no jobs\n'), { jobs: {} });
});

test('arguments: --keep-going, --only (comma list, repeated, = form) in workflow order, --list, --help; bad ones throw', () => {
  assert.deepEqual(parseArgs([]), { keepGoing: false, only: null, list: false, help: false });
  assert.deepEqual(parseArgs(['-k', '--only', 'lint,test', '--only=smoke']), { keepGoing: true, only: ['lint', 'test', 'smoke'], list: false, help: false });
  assert.deepEqual(selectSteps(['lint', 'test', 'smoke']).map((s) => s.id), ['test', 'smoke', 'lint']);
  assert.equal(selectSteps(null).length, STEPS.length);
  assert.equal(parseArgs(['--list']).list, true);
  assert.equal(parseArgs(['-h']).help, true);
  assert.throws(() => parseArgs(['--only', 'golden']), /unknown step "golden"/);
  assert.throws(() => parseArgs(['--only']), /needs step names/);
  assert.throws(() => parseArgs(['--fast']), /unknown option --fast/);
});

test("env: the job test steps get ci.yml's env for unset keys only; the tooling steps get the caller's env as is", () => {
  const test_ = STEPS.find((s) => s.id === 'test');
  const lint = STEPS.find((s) => s.id === 'lint');
  assert.deepEqual(stepEnv(test_, { PATH: 'p', SP_E2E: '1' }), { PATH: 'p', SP_E2E: '1', SP_REAL_E2E: '0', RENDER_E2E: '0', NO_COLOR: '1' });
  assert.deepEqual(stepEnv(lint, { PATH: 'p' }), { PATH: 'p' });
});

test('summary: one row per step (status, name, duration, note), the failed steps named; durations', () => {
  assert.equal(formatDuration(42.4), '42ms');
  assert.equal(formatDuration(1234), '1.2s');
  assert.equal(formatDuration(125_000), '2m05s');
  const s = formatSummary([
    { id: 'setup', status: 'ok', ms: 400 },
    { id: 'test', status: 'fail', ms: 61_000, note: 'exit 1' },
    { id: 'typecheck', status: 'not run' },
  ]);
  assert.equal(s, [
    '', '── ci summary ──',
    '  ok    setup        400ms',
    '  FAIL  test         1m01s  exit 1',
    '  -     typecheck',
    'FAILED: test', '',
  ].join('\n'));
  assert.match(formatSummary([{ id: 'lint', status: 'ok', ms: 1 }]), /all steps passed/);
});

test('the eslint and tsc entry points come from their package.json bin; a missing package says to run npm ci', () => {
  assert.ok(fs.existsSync(binPath('eslint', 'eslint')));
  assert.ok(fs.existsSync(binPath('typescript', 'tsc')));
  assert.throws(() => binPath('no-such-package-sp', 'x'), /npm ci/);
});

test('node tools/ci.mjs --list and a bad option run without npm (exit 0 / 2)', () => {
  const list = spawnSync(process.execPath, ['tools/ci.mjs', '--list'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(list.status, 0, list.stderr);
  for (const s of STEPS) assert.match(list.stdout, new RegExp(`^${s.id} `, 'm'));
  const bad = spawnSync(process.execPath, ['tools/ci.mjs', '--only', 'nope'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /unknown step "nope"/);
});
