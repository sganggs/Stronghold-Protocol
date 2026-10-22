// The minimum-Python guard stays separate from ci.yml's exact local-runner contract (#744).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseWorkflow } from '../tools/ci.mjs';

test('local extractor CI compiles every Python source with setup\'s minimum version and no extraction dependencies', () => {
  const src = readFileSync(new URL('../.github/workflows/local-extract-python.yml', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const setup = readFileSync(new URL('../tools/setup.mjs', import.meta.url), 'utf8');
  const minimum = setup.match(/major === 3 && minor >= (\d+)/)?.[1];
  assert.ok(minimum, 'read the actual accepted Python floor');
  assert.match(src, new RegExp(`python-version: '3\\.${minimum}'`));
  assert.match(src, /^permissions:\n  contents: read\n/m);
  assert.doesNotMatch(src, /write|continue-on-error|pip install|npm |pull_request_target/);
  assert.match(src, /^on:\n  push:\n  pull_request:\n  workflow_dispatch:/m);
  assert.ok(Number(src.match(/timeout-minutes: (\d+)/)?.[1]) <= 5);
  const steps = parseWorkflow(src).jobs.compile.steps;
  assert.equal(steps[0].uses, main.match(/uses: (actions\/checkout@v\d+)/)?.[1]);
  assert.equal(steps[1].uses, 'actions/setup-python@v7');
  assert.deepEqual(steps.filter((s) => s.run).map((s) => s.run), ['python -m compileall -q -f tools/local-extract']);
});
