// Exercise the actual fuzz suite and replay its printed command under the same controlled fault.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SUITE = 'test/match/fuzz.test.js';
const MATCH = new URL('../../server/match/Match.js', import.meta.url).href;

function fixture(t, seed, fail = true) {
  const dir = mkdtempSync(join(tmpdir(), 'sp-fuzz-diagnostics-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const preload = join(dir, 'fault.mjs');
  writeFileSync(preload, `
    import { Match } from ${JSON.stringify(MATCH)};
    const start = Match.prototype.start;
    Match.prototype.start = function (...args) {
      console.log('FUZZ_STARTED ' + this.seed);
      return start.apply(this, args);
    };
    const handle = Match.prototype.handle;
    Match.prototype.handle = function (...args) {
      const result = handle.apply(this, args);
      return ${fail} && this.seed === ${seed} ? { error: 'CONTROLLED_REPRO_FAILURE' } : result;
    };
  `);
  const env = { ...process.env, NODE_OPTIONS: `--import=${pathToFileURL(preload).href}` };
  delete env.MATCH_FUZZ_SEED;
  return env;
}

function run(pattern, env) {
  env = { ...env };
  delete env.NODE_TEST_CONTEXT; // This is a new runner, not a nested test-runner child.
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', `--test-name-pattern=${pattern}`, SUITE], {
    cwd: ROOT, env, encoding: 'utf8', timeout: 60_000, maxBuffer: 1024 * 1024,
  });
  assert.ifError(result.error);
  return { status: result.status, output: result.stdout + result.stderr };
}

for (const [fake, seed, pattern] of [[true, 7, '^fuzz with FakeBattle:'], [false, 103, '^fuzz with the real simulation:'], [true, 201, '^fuzz with all four rules enabled: FakeBattle$'], [false, 301, '^fuzz with all four rules enabled: real simulation$']]) {
  test(`fuzz ${fake ? 'FakeBattle' : 'real simulation'} failure prints a command that replays only seed ${seed}`, (t) => {
    const env = fixture(t, seed);
    const failed = run(pattern, env);
    assert.equal(failed.status, 1, failed.output);
    assert.match(failed.output, /bad reply.*CONTROLLED_REPRO_FAILURE/);
    const command = /# Reproduce: MATCH_FUZZ_SEED=(\d+) node --test --test-name-pattern="([^"]+)" test\/match\/fuzz.test.js/.exec(failed.output);
    assert.ok(command, `failure needs a copyable reproduction command:\n${failed.output}`);
    assert.equal(Number(command[1]), seed);
    assert.equal(command[2], pattern);
    const context = /# Fuzz failure: (\{[^\n]+\})/.exec(failed.output);
    assert.ok(context, failed.output);
    const config = JSON.parse(context[1]);
    assert.equal(config.seed, seed);
    assert.equal(config.fake, fake);
    assert.ok(['solo', 'coop'].includes(config.mode));
    assert.ok(['FUNNY', 'NORMAL', 'HARD', 'ABYSS'].includes(config.difficulty));
    assert.ok(Number.isInteger(config.humans) && Number.isInteger(config.bots));
    // Execute the env assignment and Node arguments from the printed command without platform-specific shell syntax.
    const replay = run(command[2], { ...env, MATCH_FUZZ_SEED: command[1] });
    assert.equal(replay.status, 1, replay.output);
    assert.deepEqual([...replay.output.matchAll(/# FUZZ_STARTED (\d+)/g)].map((m) => Number(m[1])), [seed]);
    const originalRequest = /bad reply \{"error":"CONTROLLED_REPRO_FAILURE"\} to (\{[^\n]+\})/.exec(failed.output);
    const replayRequest = /bad reply \{"error":"CONTROLLED_REPRO_FAILURE"\} to (\{[^\n]+\})/.exec(replay.output);
    assert.ok(originalRequest, failed.output);
    assert.ok(replayRequest, replay.output);
    assert.deepEqual(JSON.parse(replayRequest[1]), JSON.parse(originalRequest[1]));
    assert.ok(replay.output.includes(context[0]), 'same seed recreates the same match configuration');
  });
}

test('a successful single-seed replay has no failure diagnostic or aggregate intent-count failure', (t) => {
  const env = fixture(t, 7, false);
  const result = run('^fuzz with FakeBattle:', { ...env, MATCH_FUZZ_SEED: '7' });
  assert.equal(result.status, 0, result.output);
  assert.deepEqual([...result.output.matchAll(/# FUZZ_STARTED (\d+)/g)].map((m) => Number(m[1])), [7]);
  assert.doesNotMatch(result.output, /Fuzz failure:|Reproduce:/);
});

test('an invalid replay seed fails instead of silently running the default corpus', () => {
  const result = run('^fuzz with FakeBattle:', { ...process.env, MATCH_FUZZ_SEED: 'nope' });
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /MATCH_FUZZ_SEED must be an integer between 1 and 4294967295/);
});
