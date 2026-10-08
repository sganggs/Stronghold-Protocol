#!/usr/bin/env node
// tools/ci.mjs — run the checks of .github/workflows/ci.yml locally, one after another (CONTRIBUTING.md §2).
//
//   node tools/ci.mjs                    every step; stops at the first failing one (exit 1)
//   node tools/ci.mjs --keep-going       run every step even after a failure (exit 1 when any failed)
//   node tools/ci.mjs --only lint,test   only the named steps (in the workflow's order)
//   node tools/ci.mjs --list             print the steps and the ci.yml step each one mirrors
//   npm run ci                           the same as the first line
//
// Steps, in the order of ci.yml (job `test`, then job `tooling`):
//   setup      node tools/setup.mjs --check --no-local
//   test       node --test
//   smoke      the server on a free port on 127.0.0.1: GET /healthz, / (must contain <html) and /vendor/pixi.min.js,
//              then node tools/doctor.mjs (its exit code is ignored, like `|| true` in ci.yml), then the server stops
//   lint       eslint .                                   (npm run lint; warnings do not fail it)
//   imports    node tools/check-imports.mjs               (npm run check:imports)
//   typecheck  tsc --noEmit --checkJs -p jsconfig.json    (npm run typecheck)
// The job `test` steps get ci.yml's env (SP_E2E=0, SP_REAL_E2E=0, RENDER_E2E=0, NO_COLOR=1) unless already set.
//
// Not mirrored: actions/checkout and actions/setup-node (GitHub runner setup) and `npm ci` (the install — run it
// yourself; replacing node_modules is not a check). The OS × Node matrix is whatever this machine has.
// Every child is `process.execPath` with a script path (eslint and tsc from node_modules/<pkg>/package.json `bin`),
// never npm or a shell, so the run does not depend on PATH or on the shell npm uses for scripts.
// test/ci.test.js keeps this list and ci.yml in step: a ci.yml step this file does not know fails it.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The env of ci.yml's job `test` (test/ci.test.js compares it with the workflow). */
export const CI_TEST_ENV = { SP_E2E: '0', SP_REAL_E2E: '0', RENDER_E2E: '0', NO_COLOR: '1' };

/** The paths the smoke step requests (the curl URLs of ci.yml's smoke step; test/ci.test.js compares them). */
export const SMOKE_PATHS = ['/healthz', '/', '/vendor/pixi.min.js'];

/** ci.yml steps that only make sense on a GitHub runner, by `uses:` action or by step name. */
export const SKIPPED_CI_STEPS = [
  { uses: 'actions/checkout', why: 'GitHub runner: the checkout is this folder' },
  { uses: 'actions/setup-node', why: 'GitHub runner: the Node.js of this machine is used' },
  { name: 'Install (npm ci → postinstall copies public/vendor)', why: 'run `npm ci` yourself; it is not a check' },
];

/**
 * The local steps (runStep runs them). `ci` names the ci.yml job and step it mirrors; `npm` the package.json script
 * ci.yml runs there, and `describe` is that script's command (test/ci.test.js checks both).
 * @typedef {{ id: string, ci: { job: string, name: string }, npm?: string, describe: string }} Step
 * @type {Step[]}
 */
export const STEPS = [
  { id: 'setup', ci: { job: 'test', name: 'Setup check (no downloads)' }, describe: 'node tools/setup.mjs --check --no-local' },
  { id: 'test', ci: { job: 'test', name: 'Unit & integration tests' }, describe: 'node --test' },
  { id: 'smoke', ci: { job: 'test', name: 'Server smoke test (boot, /healthz, index.html, doctor)' },
    describe: `server on a free port: GET ${SMOKE_PATHS.join(', ')}; node tools/doctor.mjs` },
  { id: 'lint', ci: { job: 'tooling', name: 'Lint (warnings allowed)' }, npm: 'lint', describe: 'eslint .' },
  { id: 'imports', ci: { job: 'tooling', name: 'Import boundaries' }, npm: 'check:imports', describe: 'node tools/check-imports.mjs' },
  { id: 'typecheck', ci: { job: 'tooling', name: 'Typecheck' }, npm: 'typecheck', describe: 'tsc --noEmit --checkJs -p jsconfig.json' },
];

// ---------------------------------------------------------------------------------------------------------------------
// ci.yml, read just far enough: jobs, each job's env (flat KEY: value) and steps (name, uses, run, shell; the names
// of any other step keys in `other`, so test/ci.test.js can refuse per-step config this script does not mirror).

const unquote = (s) => {
  const v = s.trim();
  return /^(['"]).*\1$/.test(v) ? v.slice(1, -1) : v;
};

/**
 * A line-based reader for the shape of .github/workflows/ci.yml (block mappings, `- ` step lists, `run: |` blocks).
 * Not a YAML parser: flow mappings, anchors and multi-document files are not handled.
 * @param {string} text
 * @returns {{ jobs: Record<string, { env: Record<string, string>, steps: { name?: string, uses?: string, run?: string, shell?: string, other?: string[] }[] }> }}
 */
export function parseWorkflow(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const indentOf = (l) => l.length - l.trimStart().length;
  const blank = (l) => l.trim() === '' || l.trim().startsWith('#');
  /** @type {Record<string, { env: Record<string, string>, steps: any[] }>} */
  const jobs = {};
  let i = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (i < 0) return { jobs };
  let jobIndent = -1;
  let job = null;
  let section = null; // 'env' | 'steps' | null
  let sectionIndent = -1;
  let step = null;
  let stepIndent = -1;
  for (i += 1; i < lines.length; i++) {
    const line = lines[i];
    if (blank(line)) continue;
    const ind = indentOf(line);
    if (ind === 0) break; // the next top-level key
    const t = line.trim();
    if (jobIndent < 0) jobIndent = ind;
    if (ind === jobIndent) {
      const m = /^([\w-]+):\s*$/.exec(t);
      job = m ? (jobs[m[1]] = { env: {}, steps: [] }) : null;
      section = null; step = null;
      continue;
    }
    if (!job) continue;
    if (section && ind <= sectionIndent) { section = null; step = null; }
    if (!section) {
      const m = /^(env|steps):\s*$/.exec(t);
      if (m) { section = m[1]; sectionIndent = ind; }
      continue;
    }
    if (section === 'env') {
      const m = /^([\w-]+):\s*(.*)$/.exec(t);
      if (m) job.env[m[1]] = unquote(m[2]);
      continue;
    }
    // steps
    let body = t;
    if (t.startsWith('- ')) {
      step = /** @type {{ name?: string, uses?: string, run?: string, shell?: string, other?: string[] }} */ ({});
      job.steps.push(step);
      stepIndent = ind + 2;
      body = t.slice(2).trim();
    } else if (!step || ind < stepIndent) continue;
    else if (ind > stepIndent) continue; // nested (with: …)
    const m = /^(name|uses|run|shell):\s*(.*)$/.exec(body);
    if (!m) {
      const k = /^([\w-]+):/.exec(body); // env, if, with, continue-on-error, working-directory, …: the key name only
      if (k) (step.other ||= []).push(k[1]);
      continue;
    }
    if (m[1] === 'run' && /^[|>][-+]?$/.test(m[2].trim())) {
      const block = [];
      let j = i + 1;
      let blockIndent = -1;
      for (; j < lines.length; j++) {
        const l = lines[j];
        if (l.trim() === '') { block.push(''); continue; }
        const li = indentOf(l);
        if (li < stepIndent || (blockIndent < 0 && li <= stepIndent)) break;
        if (blockIndent < 0) blockIndent = li;
        if (li < blockIndent) break;
        block.push(l.slice(blockIndent));
      }
      i = j - 1;
      step.run = block.join('\n').replace(/\n+$/, '');
    } else {
      step[m[1]] = unquote(m[2]);
    }
  }
  return { jobs };
}

/** Is a ci.yml step one of SKIPPED_CI_STEPS? @param {{ name?: string, uses?: string }} s */
export function isSkippedCiStep(s) {
  return SKIPPED_CI_STEPS.some((k) => (k.uses ? (s.uses || '').split('@')[0] === k.uses : s.name === k.name));
}

// ---------------------------------------------------------------------------------------------------------------------
// Arguments, env, summary.

/**
 * @param {string[]} argv
 * @returns {{ keepGoing: boolean, only: string[] | null, list: boolean, help: boolean }}
 */
export function parseArgs(argv) {
  const o = { keepGoing: false, only: /** @type {string[] | null} */ (null), list: false, help: false };
  const ids = new Set(STEPS.map((s) => s.id));
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--keep-going' || a === '-k') o.keepGoing = true;
    else if (a === '--list') o.list = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--only' || a.startsWith('--only=')) {
      const v = a === '--only' ? argv[++i] : a.slice('--only='.length);
      if (!v) throw new Error('--only needs step names: ' + [...ids].join(','));
      for (const id of v.split(',').map((x) => x.trim()).filter(Boolean)) {
        if (!ids.has(id)) throw new Error(`unknown step "${id}" (steps: ${[...ids].join(', ')})`);
        (o.only ??= []).push(id);
      }
    } else throw new Error(`unknown option ${a} (node tools/ci.mjs --help)`);
  }
  return o;
}

/** The steps to run, in workflow order. @param {string[] | null} only */
export function selectSteps(only) {
  return only ? STEPS.filter((s) => only.includes(s.id)) : STEPS.slice();
}

/** A child's env: `base` plus ci.yml's job env for the keys `base` does not set. */
export function stepEnv(step, base = process.env) {
  const env = { ...base };
  if (step.ci.job === 'test') for (const [k, v] of Object.entries(CI_TEST_ENV)) if (env[k] === undefined) env[k] = v;
  return env;
}

/** @param {number} ms */
export function formatDuration(ms) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, '0')}s`;
}

/**
 * The summary table. `status`: ok | fail | not run.
 * @param {{ id: string, status: 'ok' | 'fail' | 'not run', ms?: number, note?: string }[]} results
 */
export function formatSummary(results) {
  const w = Math.max(...results.map((r) => r.id.length), 4);
  const label = { ok: 'ok', fail: 'FAIL', 'not run': '-' };
  const rows = results.map((r) => {
    const time = r.ms == null ? '' : formatDuration(r.ms);
    return `  ${label[r.status].padEnd(5)} ${r.id.padEnd(w)}  ${time.padStart(7)}${r.note ? '  ' + r.note : ''}`.trimEnd();
  });
  const failed = results.filter((r) => r.status === 'fail').map((r) => r.id);
  const tail = failed.length ? `FAILED: ${failed.join(', ')}` : results.some((r) => r.status === 'ok') ? 'all steps passed' : 'nothing ran';
  return ['', '── ci summary ──', ...rows, tail, ''].join('\n');
}

// ---------------------------------------------------------------------------------------------------------------------
// Running.

/** The JS entry of a dependency's bin, e.g. ('eslint', 'eslint') → node_modules/eslint/bin/eslint.js. */
export function binPath(pkg, name, root = ROOT) {
  const dir = path.join(root, 'node_modules', pkg);
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); } catch {
    throw new Error(`${pkg} is not installed (node_modules/${pkg}) — run npm ci first`);
  }
  const rel = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[name];
  if (!rel) throw new Error(`node_modules/${pkg}/package.json has no bin "${name}"`);
  return path.join(dir, rel);
}

/** Run `node <args>` in ROOT with inherited stdio; resolves to the exit code (1 when killed by a signal). */
function node(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, env, stdio: 'inherit' });
    child.on('error', (e) => { console.error(e.message); resolve(1); });
    child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

/** A free TCP port on 127.0.0.1. */
export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = /** @type {net.AddressInfo} */ (srv.address());
      srv.close(() => resolve(port));
    });
  });
}

/** Live server children, killed if this process exits early. @type {Set<import('node:child_process').ChildProcess>} */
const servers = new Set();
process.on('exit', () => { for (const c of servers) { try { c.kill('SIGKILL'); } catch { /* gone */ } } });

/** Stop a server child: SIGTERM (graceful on POSIX; on Windows kill() terminates), SIGKILL after 8 s. */
function stopServer(child) {
  if (child.exitCode !== null || child.signalCode !== null) { servers.delete(child); return Promise.resolve(); }
  return new Promise((resolve) => {
    const force = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, 8000);
    child.once('exit', () => { clearTimeout(force); servers.delete(child); resolve(); });
    try { child.kill('SIGTERM'); } catch { clearTimeout(force); servers.delete(child); resolve(); }
  });
}

/** The smoke step of ci.yml's job `test`, on a free port instead of 3000 (a running game server must not clash). */
async function smoke(env) {
  const port = await freePort();
  // [ASSUMED] HOST=127.0.0.1 instead of ci.yml's default 0.0.0.0: the requests go to 127.0.0.1 either way, and
  // listening only on loopback spares a firewall prompt on Windows / macOS.
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT, env: { ...env, PORT: String(port), HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  servers.add(child);
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  const fail = async (msg) => {
    await stopServer(child);
    console.error(`smoke: ${msg}\n── server log ──\n${log}`);
    return 1;
  };
  try {
    let health = null;
    for (let i = 0; i < 30 && !health; i++) {
      if (child.exitCode !== null) return await fail(`the server exited (code ${child.exitCode})`);
      try {
        const r = await fetch(base + '/healthz', { signal: AbortSignal.timeout(2000) });
        if (r.ok) health = await r.text();
      } catch { /* not up yet */ }
      if (!health) await new Promise((r) => setTimeout(r, 1000));
    }
    if (!health) return await fail(`no 200 from ${base}/healthz within 30 s`);
    console.log(`GET /healthz → ${health.trim()}`);
    const index = await fetch(base + '/', { signal: AbortSignal.timeout(10000) });
    const html = await index.text();
    if (!index.ok) return await fail(`GET / → HTTP ${index.status}`);
    if (!/<html/i.test(html)) return await fail('GET / does not contain <html');
    console.log(`GET / → ${index.status}, ${html.length} bytes, <html found`);
    const pixi = await fetch(base + '/vendor/pixi.min.js', { signal: AbortSignal.timeout(10000) });
    await pixi.arrayBuffer();
    if (!pixi.ok) return await fail(`GET /vendor/pixi.min.js → HTTP ${pixi.status} (public/vendor missing? node tools/vendor.mjs)`);
    console.log(`GET /vendor/pixi.min.js → ${pixi.status}`);
    // ci.yml: `node tools/doctor.mjs || true` — its exit code does not fail the step.
    const doctor = await node(['tools/doctor.mjs', '--port', String(port), '--host', '127.0.0.1'], env);
    if (doctor !== 0) console.log(`(doctor exited ${doctor}; ignored, as in ci.yml)`);
  } catch (e) {
    return await fail(e?.message || String(e));
  }
  await stopServer(child);
  return 0;
}

/** @param {Step} step @param {Record<string, string | undefined>} env */
function runStep(step, env) {
  switch (step.id) {
    case 'setup': return node(['tools/setup.mjs', '--check', '--no-local'], env);
    case 'test': return node(['--test'], env);
    case 'smoke': return smoke(env);
    case 'lint': return node([binPath('eslint', 'eslint'), '.'], env);
    case 'imports': return node(['tools/check-imports.mjs'], env);
    case 'typecheck': return node([binPath('typescript', 'tsc'), '--noEmit', '--checkJs', '-p', 'jsconfig.json'], env);
    default: throw new Error(`no runner for step ${step.id}`);
  }
}

export async function main(argv = process.argv.slice(2)) {
  let opts;
  try { opts = parseArgs(argv); } catch (e) { console.error(e.message); return 2; }
  if (opts.help) {
    console.log('node tools/ci.mjs [--keep-going] [--only <step,…>] [--list]  — the checks of .github/workflows/ci.yml');
    console.log('steps: ' + STEPS.map((s) => s.id).join(', '));
    return 0;
  }
  if (opts.list) {
    for (const s of STEPS) console.log(`${s.id.padEnd(10)} ${s.describe}\n${''.padEnd(10)} ← ci.yml ${s.ci.job}: ${s.ci.name}`);
    for (const s of SKIPPED_CI_STEPS) console.log(`(skipped)  ${s.uses || s.name} — ${s.why}`);
    return 0;
  }
  const steps = selectSteps(opts.only);
  const results = steps.map((s) => ({ id: s.id, status: /** @type {'ok' | 'fail' | 'not run'} */ ('not run'), ms: undefined, note: undefined }));
  let stopped = false;
  for (let i = 0; i < steps.length; i++) {
    if (stopped) break;
    const step = steps[i];
    console.log(`\n▶ ${step.id} — ${step.describe}`);
    const t0 = performance.now();
    let code;
    try { code = await runStep(step, stepEnv(step)); } catch (e) { console.error(e?.message || e); code = 1; }
    results[i].ms = performance.now() - t0;
    results[i].status = code === 0 ? 'ok' : 'fail';
    if (code !== 0) {
      results[i].note = `exit ${code}`;
      if (!opts.keepGoing) stopped = true;
    }
  }
  console.log(formatSummary(results));
  return results.some((r) => r.status === 'fail') ? 1 : 0;
}

function isMain() {
  try { return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}

if (isMain()) main().then((code) => { process.exitCode = code; }, (e) => { console.error(e?.stack || e); process.exitCode = 1; });
