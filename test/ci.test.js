// test/ci.test.js — tools/ci.mjs (the local run of .github/workflows/ci.yml): its step list is ci.yml's, the reader of
// the workflow, the arguments, the env and the summary. Nothing here boots a server or runs a step.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  CI_SHARD_ENV, CI_TEST_ENV, ROOT, SKIPPED_CI_STEPS, SMOKE_PATHS, STEPS, TEST_FILES, binPath, formatDuration,
  formatSummary, isSkippedCiStep, parseArgs, parseMatrix, parseWorkflow, selectSteps, stepEnv, runStep,
} from '../tools/ci.mjs';
import { SHARD_COUNT } from '../tools/ci-shards.mjs';

const workflowText = fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8').replace(/\r\n?/g, '\n');
const workflow = parseWorkflow(workflowText);
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
  // job env: ci.yml's job test env is CI_TEST_ENV plus the matrix's shard; any other job has none (stepEnv gives the
  // tooling steps nothing)
  for (const [job, j] of Object.entries(workflow.jobs)) {
    assert.deepEqual(j.env, job === 'test' ? { ...CI_TEST_ENV, ...CI_SHARD_ENV } : {}, `env of job ${job}`);
  }
  // per-step config (env, if, continue-on-error, working-directory, with, …) on a mirrored step is not mirrored
  for (const l of STEPS) {
    const s = workflow.jobs[l.ci.job].steps.find((x) => x.name === l.ci.name);
    assert.deepEqual(s.other || [], [], `${l.id}: ci.yml step keys tools/ci.mjs does not mirror`);
    assert.ok(!s.shell || l.id === 'smoke', `${l.id}: shell: ${s.shell}`);
  }
  assert.equal(pkg.scripts.ci, 'node tools/ci.mjs');
});

test('the full Golden check runs independently once on Ubuntu / Node 22 and cannot update or hide differences', () => {
  const golden = workflow.jobs.golden;
  assert.ok(golden, 'ci.yml must have a separate golden job');
  assert.deepEqual(golden.env, {});
  assert.deepEqual(golden.steps, [
    { uses: workflow.jobs.test.steps[0].uses },
    { uses: workflow.jobs.test.steps[1].uses, other: ['with'] },
    { name: 'Install (npm ci → postinstall copies public/vendor)', run: 'npm ci --no-audit --no-fund' },
    { name: 'Full Golden regression check', run: 'npm run golden' },
  ]);
  // The small workflow reader deliberately ignores job settings and nested action inputs: pin this job's here.
  const jobText = workflowText.match(/^  golden:\n((?:\n| {4}[^\n]*\n)*)/m)?.[1];
  assert.ok(jobText, 'golden job settings were read');
  assert.match(jobText, /^    runs-on: ubuntu-latest$/m);
  assert.match(jobText, /^    timeout-minutes: 15$/m);
  assert.match(jobText, /^          node-version: 22$/m);
  assert.match(jobText, /^          cache: npm$/m);
  assert.doesNotMatch(jobText, /^\s*(strategy|needs|if|continue-on-error|defaults|env):/m);
  assert.equal(pkg.scripts.golden, 'node tools/golden.mjs');
  assert.deepEqual(STEPS.map((s) => s.id), ['setup', 'test', 'smoke', 'guards', 'lint', 'imports', 'typecheck']);
});

test('the separate Golden skip is scoped to its job, step name and unfiltered comparison command', () => {
  const step = { job: 'golden', name: 'Full Golden regression check', run: 'npm run golden' };
  assert.equal(isSkippedCiStep(step), true);
  for (const changed of [
    { ...step, job: 'test' }, { ...step, job: 'tooling' }, { ...step, job: undefined },
    { ...step, name: 'Another check' }, { ...step, run: undefined },
    { ...step, run: 'npm run golden:update' }, { ...step, run: 'npm run golden -- --fast' },
    { ...step, run: 'npm run golden -- --family roster' }, { ...step, run: 'npm run golden || true' },
    { job: 'golden', name: 'Another check', run: 'node --test' },
  ]) assert.equal(isSkippedCiStep(changed), false, JSON.stringify(changed));
});

test('npm test runs every test file and nothing else under test/: no helper, no child-process entry, no Forge fixture', () => {
  // `npm test` is tools/test-run.mjs, which runs node --test over TEST_FILES (test/test-run.test.js checks that side:
  // SHARD unset is the whole suite, SHARD=n is one shard of it)
  assert.equal(pkg.scripts.test, 'node tools/test-run.mjs');
  assert.equal(STEPS.find((s) => s.id === 'test').describe, 'node tools/test-run.mjs');
  // what Node's test runner expands them to (the same glob, node_modules left out the way --test leaves it out)
  const picked = fs.globSync(TEST_FILES, { cwd: ROOT, exclude: (p) => path.basename(String(p?.name ?? p)) === 'node_modules' })
    .map((f) => f.split(path.sep).join('/')).sort();
  const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })
    .flatMap((d) => (d.isDirectory() ? walk(`${dir}/${d.name}`) : [`${dir}/${d.name}`]));
  const underTest = walk('test');
  const tests = [...underTest, ...walk('plugins/_template')].filter((f) => f.endsWith('.test.js'));
  assert.deepEqual(picked, [...tests, 'test/e2e/coop.e2e.mjs'].sort());
  assert.ok(!picked.some((f) => /^test\/(fixtures|helpers)\/|\/fixtures\//.test(f)), 'a fixture or helper would run as a test');
  // every other module under test/ is imported by the tests (or is untrusted bait): one that uses node:test is a test
  // file the globs miss — name it *.test.js
  for (const f of underTest.filter((x) => /\.[cm]?js$/.test(x) && !picked.includes(x))) {
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, f), 'utf8'), /['"]node:test['"]/, `${f} uses node:test but npm test does not run it`);
  }
});

test('the test matrix runs every shard exactly once, on both systems, for node 22', () => {
  const matrix = parseMatrix(workflowText);
  assert.deepEqual(Object.keys(matrix), ['test'], 'only the test job is a matrix');
  const m = matrix.test;
  // The shard numbers, not the count: a matrix that listed [0, 1, 3] would run three quarters of the suite and stay
  // green — the table's own guard (test/ci-shards.test.js) only proves the partition inside ci-shards.json.
  assert.deepEqual((m.shard ?? []).map(Number), [...Array(SHARD_COUNT).keys()], 'matrix.shard must list 0..SHARD_COUNT-1 once each');
  assert.deepEqual(m.os, ['ubuntu-latest', 'windows-latest']);
  assert.deepEqual((m.node ?? []).map(Number), [22], 'the full suite runs on node 22; node 24 has its own lane');
  // the job hands its shard to tools/test-run.mjs, which is what turns the number into files
  assert.equal(workflow.jobs.test.env.SHARD, '${{ matrix.shard }}');
  // the node 24 lane is a job of its own, with the guards and without the suite
  assert.ok(workflow.jobs.node24, 'ci.yml has the node 24 lane');
  assert.deepEqual(workflow.jobs.node24.env, {}, 'the node 24 lane needs no job env');
  assert.ok(workflow.jobs.node24.steps.some((s) => s.run === 'npm run test:guards'), 'the node 24 lane runs the guards');
  assert.ok(!workflow.jobs.node24.steps.some((s) => s.run === 'npm run test'), 'the node 24 lane does not run the suite');
});

test('the matrix reader: flow lists, block lists, include/exclude left out, other jobs ignored', () => {
  const yml = [
    'name: X', 'jobs:', '  a:', '    runs-on: x', '    strategy:', '      fail-fast: false', '      matrix:',
    '        os: [ubuntu-latest, windows-latest]', '        node: [22]', "        shard: ['0', 1]", '        extra:',
    '          - one', '          - "two"', '        include:', '          - os: z', '    steps:', '      - run: x',
    '  b:', '    steps:', '      - run: y',
  ].join('\r\n');
  assert.deepEqual(parseMatrix(yml), {
    a: { os: ['ubuntu-latest', 'windows-latest'], node: ['22'], shard: ['0', '1'], extra: ['one', 'two'] },
  });
  assert.deepEqual(parseMatrix('name: no jobs\n'), {});
  assert.deepEqual(parseMatrix('jobs:\n  a:\n    steps:\n      - run: x\n'), {}, 'a job without a matrix is left out');
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


test('local CI clears residual shard and JUnit settings before invoking the full test runner', () => {
  const base = { PATH: 'p', SHARD: '2', JUNIT: 'unexpected.xml' };
  const env = stepEnv(STEPS.find(s => s.id === 'test'), base);
  assert.equal(Object.hasOwn(env, 'SHARD'), false);
  assert.equal(Object.hasOwn(env, 'JUNIT'), false);
  assert.equal(env.PATH, 'p');
  assert.equal(base.SHARD, '2', 'the caller environment is unchanged');
});


test('the local CI dispatcher executes its declared guard and full-test commands', async () => {
  for (const id of ['guards', 'test']) {
    const step = STEPS.find(s => s.id === id), env = { NO_COLOR: '1' };
    let invoked = false;
    const result = await runStep(step, env, async (args, childEnv) => {
      invoked = true;
      assert.deepEqual(args, step.describe.slice('node '.length).split(' '));
      assert.equal(childEnv, env);
      return 0;
    });
    assert.equal(invoked, true, id);
    assert.equal(result, 0);
  }
});
