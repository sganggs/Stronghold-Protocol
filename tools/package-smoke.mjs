// #568: exercise the actual release zip in isolation, never the staging tree or checkout dependencies.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { readZip } from './package-update.mjs';

const FOLDER = 'Stronghold-Protocol';

export function extractRelease(zip, dest) {
  const seen = new Set();
  readZip(zip, (name, data) => {
    const parts = name.split('/');
    if (parts[0] !== FOLDER || parts.length < 2 || parts.some((p) => !p || p === '.' || p === '..' || /[\\:\x00]/.test(p))) {
      throw new Error(`invalid release path: ${name}`);
    }
    if (seen.has(name)) throw new Error(`duplicate release path: ${name}`);
    seen.add(name);
    const file = path.join(dest, ...parts);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
  });
}

/** Full/lite zip, or update over one supplied base (zip or extracted installation). */
export async function smokePackage(zip, { base, version, timeoutMs = 30000, logPath = `${zip}.smoke.log`, log = console.log } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-package-smoke-'));
  const root = path.join(temp, FOLDER);
  let child;
  let closed;
  let exited = false;
  let spawnError;
  let output = '';
  let stage = 'extract';
  fs.writeFileSync(logPath, `zip: ${zip}\n${base ? `base: ${base}\n` : ''}`);
  const record = (text) => fs.appendFileSync(logPath, text);
  try {
    if (base) {
      if (fs.statSync(base).isDirectory()) {
        const source = fs.existsSync(path.join(base, 'package.json')) ? base : path.join(base, FOLDER);
        fs.cpSync(source, root, { recursive: true });
      } else extractRelease(base, temp);
    }
    extractRelease(zip, temp);
    stage = 'boot';
    const expected = version || JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
    // Only OS runtime variables survive: no NODE_PATH/NODE_OPTIONS, host ports, plugins or external AI settings.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|SystemRoot|WINDIR|TEMP|TMP|TMPDIR|HOME|USERPROFILE|LANG)$/i.test(key)));
    Object.assign(env, { HOST: '127.0.0.1', PORT: '0', NO_COLOR: '1' });
    child = spawn(process.execPath, ['server/index.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    closed = new Promise((resolve) => child.once('close', (code, signal) => {
      exited = true; record(`\nexit: ${code}, signal: ${signal}\n`); resolve();
    }));
    child.on('error', (err) => { spawnError = err; });
    for (const stream of [child.stdout, child.stderr]) stream.on('data', (data) => {
      record(data); output = (output + data.toString()).slice(-65536);
    });
    const deadline = Date.now() + timeoutMs;
    let url;
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      if (exited) throw new Error('server exited before readiness');
      url = output.match(/Local:\s+(http:\/\/127\.0\.0\.1:\d+)/)?.[1];
      if (url) break;
      await delay(50);
    }
    if (!url) throw new Error(`server did not become ready within ${timeoutMs} ms`);
    for (const route of ['/healthz', '/', '/vendor/pixi.min.js']) {
      stage = `request ${route}`;
      const response = await fetch(url + route, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.text();
      if (route === '/healthz') {
        const health = JSON.parse(body);
        if (health.ok !== true || health.app !== expected) throw new Error(`health/version mismatch (expected ${expected})`);
      } else if (route === '/') {
        if (!/<html[\s>]/i.test(body) || !body.includes('/js/main.js')) throw new Error('missing game entry page');
      } else if (!body.includes('PIXI')) throw new Error('missing Pixi runtime');
      record(`OK ${route}\n`);
    }
    if (exited) throw new Error('server exited during checks');
    record('PASS\n');
    log(`smoke: PASS ${path.basename(zip)}${base ? ` over ${path.basename(base)}` : ''} (log: ${logPath})`);
    return { logPath };
  } catch (error) {
    record(`FAIL ${stage}: ${error.message}\n`);
    throw new Error(`package smoke failed at ${stage}: ${error.message}; log: ${logPath}`, { cause: error });
  } finally {
    if (child && !exited) {
      child.kill('SIGTERM');
      const timer = setTimeout(() => { if (!exited) child.kill('SIGKILL'); }, 2000);
      await closed;
      clearTimeout(timer);
    }
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

const invoked = (() => { try { return pathToFileURL(fs.realpathSync(process.argv[1] || '')).href; } catch { return null; } })();
if (invoked === import.meta.url) {
  const [zip, base] = process.argv.slice(2);
  if (!zip) { console.error('usage: node tools/package-smoke.mjs <release.zip> [base.zip or folder]'); process.exitCode = 2; }
  else smokePackage(path.resolve(zip), { base: base && path.resolve(base) }).catch((error) => {
    console.error(error.message); process.exitCode = 1;
  });
}
