// HTTP(S)_PROXY for the asset downloader. Node's built-in fetch honours it only when
// the process was started with NODE_USE_ENV_PROXY=1 (Node >=22.21 and >=24). The
// npm undici dispatcher does not reach that fetch, so fetch-assets restarts once
// and every other default fetch fails closed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import { connect as netConnect } from 'node:net';
import { Downloader } from '../tools/assets/downloader.mjs';
import { cachedJson } from '../tools/assets/cache.mjs';
import {
  PROXY_ENV_KEYS, REEXEC_MARKER, envProxyPlan, guardDefaultFetch, nodeHonoursEnvProxy,
  proxyConfigured, restartForEnvProxy, startedWithEnvProxy,
} from '../tools/assets/env-proxy.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'tools', 'fetch-assets.mjs');
const PROXY = 'http://127.0.0.1:9';
const STRIP = [...PROXY_ENV_KEYS, 'NO_PROXY', 'no_proxy', 'ALL_PROXY', 'all_proxy', 'NODE_USE_ENV_PROXY', REEXEC_MARKER];

function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of STRIP) delete env[key];
  return Object.assign(env, extra);
}

test('version gate: fetch() env proxy is Node >=22.21 and >=24, not 23 or early 22', () => {
  assert.equal(nodeHonoursEnvProxy('22.20.0'), false);
  assert.equal(nodeHonoursEnvProxy('22.21.0'), true);
  assert.equal(nodeHonoursEnvProxy('v22.22.0'), true);
  assert.equal(nodeHonoursEnvProxy('23.11.0'), false);
  assert.equal(nodeHonoursEnvProxy('24.0.0'), true);
  assert.equal(nodeHonoursEnvProxy('24.5.0'), true);
  assert.equal(nodeHonoursEnvProxy('25.1.0'), true);
  assert.equal(nodeHonoursEnvProxy(''), false);
  assert.equal(nodeHonoursEnvProxy('nope'), false);
});

test('startup switch: the variable, the flag, and NODE_OPTIONS; a late or lookalike value does not count', () => {
  assert.equal(startedWithEnvProxy({ NODE_USE_ENV_PROXY: '1' }, []), true);
  assert.equal(startedWithEnvProxy({ NODE_USE_ENV_PROXY: 'true' }, []), false);
  assert.equal(startedWithEnvProxy({ NODE_USE_ENV_PROXY: '' }, []), false);
  assert.equal(startedWithEnvProxy({}, ['--use-env-proxy']), true);
  assert.equal(startedWithEnvProxy({}, ['--use_env_proxy']), true);
  assert.equal(startedWithEnvProxy({}, ['--no-warnings']), false);
  assert.equal(startedWithEnvProxy({ NODE_OPTIONS: '--no-warnings --use-env-proxy' }, []), true);
  assert.equal(startedWithEnvProxy({ NODE_OPTIONS: '--use-env-proxy-extra' }, []), false);
  assert.equal(startedWithEnvProxy({}, []), false);
});

test('plan: unset proxy is off; a proxy restarts, is already on, or (old Node) goes direct with a warning', () => {
  assert.equal(proxyConfigured({}), false);
  assert.equal(proxyConfigured({ HTTP_PROXY: '   ', NO_PROXY: 'localhost' }), false);
  assert.equal(envProxyPlan({}).action, 'off');
  assert.equal(envProxyPlan({ NO_PROXY: '127.0.0.1' }).action, 'off');
  assert.equal(envProxyPlan({ HTTP_PROXY: 'http://proxy.example:8080' }, '22.20.0', false).action, 'unsupported');
  assert.match(envProxyPlan({ HTTP_PROXY: 'http://proxy.example:8080' }, '23.11.0', true).reason, /Node 23\.11\.0/);
  assert.match(envProxyPlan({ HTTP_PROXY: 'http://proxy.example:8080' }, '22.20.0', false).reason, /downloading directly instead/);
  assert.equal(envProxyPlan({ http_proxy: 'http://proxy.example:8080' }, '22.21.0', false).action, 'reexec');
  assert.match(envProxyPlan({ HTTPS_PROXY: 'http://proxy.example:8080' }, '24.0.0', false).reason, /Refusing to fetch directly/);
  // The flag on the object is not the startup snapshot: the third argument is.
  assert.equal(envProxyPlan({ HTTP_PROXY: 'http://proxy.example:8080', NODE_USE_ENV_PROXY: '1' }, '22.22.0', false).action, 'reexec');
  assert.equal(envProxyPlan({ HTTP_PROXY: 'http://proxy.example:8080', NODE_USE_ENV_PROXY: '1' }, '24.5.0', true).action, 'already');
  assert.equal(envProxyPlan({ HTTPS_PROXY: 'http://proxy.example:8080' }, '25.0.0', true).action, 'already');
});

test('an explicit fetch is returned unchanged', () => {
  const fetchImpl = async () => new Response('ok');
  assert.equal(guardDefaultFetch(fetchImpl), fetchImpl);
});

test('downloader and index cache fail closed under HTTP_PROXY, and an injected fetch still runs', async (t) => {
  // The only test that mutates process.env. Node runs tests in a file concurrently;
  // the plan tests above pass their own env object and do not read process.env.
  const dir = await mkdtemp(join(tmpdir(), 'sp-env-proxy-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const saved = STRIP.map((key) => [key, process.env[key]]);
  for (const key of STRIP) delete process.env[key];
  process.env.HTTP_PROXY = 'http://127.0.0.1:9';
  process.env.HTTPS_PROXY = process.env.HTTP_PROXY;
  try {
    const plan = envProxyPlan();
    const bare = new Downloader({
      root: dir, ledgerPath: join(dir, 'ledger.json'), retries: 1, backoffMs: 0, log() {},
    });
    if (plan.action !== 'already') {
      const refused = await bare.fetchWithRetries('https://example.invalid/a.json', 'json');
      assert.match(refused.error, /Refusing to fetch directly/);
      await assert.rejects(guardDefaultFetch()('https://example.invalid/a.json'), /Refusing to fetch directly/);
      // Set after startup. Node has already decided not to proxy, so this must still refuse.
      process.env.NODE_USE_ENV_PROXY = '1';
      const late = await bare.fetchWithRetries('https://example.invalid/b.json', 'json');
      assert.match(late.error, /not started with NODE_USE_ENV_PROXY=1/);
      delete process.env.NODE_USE_ENV_PROXY;
      await assert.rejects(
        cachedJson({
          cacheFile: join(dir, 'missing.json'), url: 'https://example.invalid/index.json',
          log() {}, backoffMs: 0, timeoutMs: 1000,
        }),
        /Refusing to fetch directly/,
      );
    }
    let called = 0;
    const injected = new Downloader({
      root: dir, ledgerPath: join(dir, 'ledger.json'), retries: 1, backoffMs: 0, log() {},
      fetchImpl: async () => { called += 1; return Response.json({ ok: true }); },
    });
    const got = await injected.fetchWithRetries('https://example.invalid/a.json', 'json');
    assert.equal(called, 1);
    assert.equal(got.buf.toString(), '{"ok":true}');
    assert.deepEqual(await cachedJson({
      cacheFile: join(dir, 'ok.json'), url: 'https://example.invalid/index.json', log() {}, backoffMs: 0,
      fetchImpl: async () => Response.json({ ok: true }),
    }), { ok: true });
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('restart decision: nothing to do, one spawn, or a hard stop — and the marker cannot loop', () => {
  const prev = process.exitCode;
  const spawned = [];
  const logs = [];
  const child = new EventEmitter();
  const spawnImpl = (...args) => { spawned.push(args); return child; };
  try {
    assert.equal(restartForEnvProxy({
      env: cleanEnv(), spawnImpl, error: (line) => logs.push(line),
    }), false);
    assert.equal(spawned.length, 0);

    const proxyEnv = cleanEnv({ HTTP_PROXY: 'http://proxy.example:8080', KEEP: 'yes' });
    const stopped = restartForEnvProxy({
      env: proxyEnv,
      execPath: process.execPath,
      execArgv: ['--no-warnings'],
      argv: ['node', SCRIPT, '--help'],
      spawnImpl,
      error: (line) => logs.push(line),
    });
    if (!nodeHonoursEnvProxy(process.versions.node)) {
      assert.equal(stopped, false, 'an old Node goes on in this process (direct download)');
      assert.equal(spawned.length, 0);
      assert.match(logs.join('\n'), /does not route fetch/);
      return;
    }
    assert.equal(stopped, true);
    assert.equal(spawned.length, 1);
    const [bin, args, opts] = spawned[0];
    assert.equal(bin, process.execPath);
    assert.deepEqual(args, ['--no-warnings', SCRIPT, '--help']);
    assert.equal(opts.stdio, 'inherit');
    assert.equal(opts.env.NODE_USE_ENV_PROXY, '1');
    assert.equal(opts.env[REEXEC_MARKER], '1');
    assert.equal(opts.env.KEEP, 'yes');
    assert.equal(opts.env.HTTP_PROXY, 'http://proxy.example:8080');
    assert.match(logs.join('\n'), /restarting once with NODE_USE_ENV_PROXY=1/);
    child.emit('close', 0);

    spawned.length = 0;
    logs.length = 0;
    assert.equal(restartForEnvProxy({
      env: cleanEnv({ HTTP_PROXY: 'http://proxy.example:8080', [REEXEC_MARKER]: '1' }),
      spawnImpl,
      error: (line) => logs.push(line),
    }), true);
    assert.equal(spawned.length, 0);
    assert.match(logs.join('\n'), /refused to restart again/);
  } finally {
    process.exitCode = prev;
  }
});

function runHelp(extra) {
  return spawnSync(process.execPath, [SCRIPT, '--help'], {
    encoding: 'utf8', env: cleanEnv(extra), timeout: 20000,
  });
}

test('fetch-assets --help restarts once when HTTP(S)_PROXY is set, and a second restart is refused', () => {
  const supported = nodeHonoursEnvProxy(process.versions.node);
  const first = runHelp({ HTTP_PROXY: PROXY, HTTPS_PROXY: PROXY });
  if (!supported) {
    assert.equal(first.status, 1, first.stderr);
    assert.match(first.stderr, /does not route fetch/);
    assert.equal(first.stdout, '');
    return;
  }
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /--allow-shrink/);
  assert.equal((first.stderr.match(/restarting once with NODE_USE_ENV_PROXY=1/g) || []).length, 1, first.stderr);

  const already = runHelp({ HTTP_PROXY: PROXY, NODE_USE_ENV_PROXY: '1' });
  assert.equal(already.status, 0, already.stderr);
  assert.match(already.stdout, /--allow-shrink/);
  assert.doesNotMatch(already.stderr, /restarting once/);

  const loop = runHelp({ HTTP_PROXY: PROXY, [REEXEC_MARKER]: '1' });
  assert.equal(loop.status, 1, loop.stderr);
  assert.match(loop.stderr, /refused to restart again/);
  assert.equal(loop.stdout, '');
});

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

test('built-in fetch tunnels through HTTP_PROXY only when NODE_USE_ENV_PROXY was set at startup', { timeout: 30000 }, async (t) => {
  if (!nodeHonoursEnvProxy(process.versions.node)) return;
  const hits = [];
  const sockets = new Set();
  const proxy = createServer((req, res) => {
    hits.push(`REQ ${req.method} ${req.url ?? ''}`);
    // Every supported line up to 26.4 opens a CONNECT tunnel; 26.5+ forward the request itself in
    // absolute-form. Relay it to the origin so both shapes end at the target.
    const absolute = /^http:\/\/[^/]+(?:\/.*)?$/.exec(req.url || '');
    if (!absolute) { res.writeHead(500); res.end(); return; }
    // Only forward to 127.0.0.1: a stray request must not turn this test's proxy into an open relay.
    if (new URL(absolute[0]).hostname !== '127.0.0.1') { res.writeHead(403); res.end(); return; }
    const relay = httpRequest(absolute[0], { method: req.method, headers: req.headers });
    relay.on('response', (ures) => {
      res.writeHead(ures.statusCode, ures.headers);
      ures.pipe(res);
    });
    relay.on('error', () => { res.writeHead(502); res.end(); });
    req.pipe(relay);
  });
  proxy.on('connect', (req, client, head) => {
    hits.push(`CONNECT ${req.url}`);
    const cut = req.url.lastIndexOf(':');
    // Same rule for CONNECT: only 127.0.0.1 is tunneled.
    if (req.url.slice(0, cut) !== '127.0.0.1') { client.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    const upstream = netConnect(Number(req.url.slice(cut + 1)), req.url.slice(0, cut), () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    sockets.add(upstream);
    upstream.on('error', () => client.destroy());
    client.on('error', () => upstream.destroy());
  });
  proxy.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  const target = createServer((req, res) => {
    hits.push(`TARGET ${req.url}`);
    res.end('from-target');
  });
  target.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  const proxyPort = await listen(proxy);
  const targetPort = await listen(target);
  t.after(() => {
    for (const socket of sockets) socket.destroy();
    proxy.close();
    target.close();
  });
  const targetUrl = `http://127.0.0.1:${targetPort}/x`;
  const proxyUrl = `http://127.0.0.1:${proxyPort}`;
  // The first hop is exactly one of two shapes depending on the Node line: `CONNECT 127.0.0.1:<port>`
  // (every supported line up to 26.4) or `REQ GET http://127.0.0.1:<port>/x` (26.5+). Asserted as this
  // exact set, so a stray host, port, path, or an extra hop before the origin answers fails the test.
  const hopForms = [`CONNECT 127.0.0.1:${targetPort}`, `REQ GET ${targetUrl}`];
  const snippet = `
    const res = await fetch(process.env.TARGET, { signal: AbortSignal.timeout(2500) });
    console.log(JSON.stringify({ status: res.status, body: await res.text() }));
  `;
  // spawn, not spawnSync: a synchronous child would freeze this server, and fetch would time out.
  const run = (extra) => new Promise((resolve, reject) => {
    hits.length = 0;
    const child = spawn(process.execPath, ['--input-type=module', '-e', snippet], {
      env: cleanEnv({ TARGET: targetUrl, ...extra }), stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`fetch child hung\n${stderr}`)); }, 8000);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) { reject(new Error(stderr || `exit ${code}`)); return; }
      const body = JSON.parse(stdout.trim().split('\n').pop());
      resolve({ body, hits: [...hits] });
    });
  });

  const direct = await run({});
  assert.deepEqual(direct.body, { status: 200, body: 'from-target' });
  assert.deepEqual(direct.hits, ['TARGET /x']);

  const ignored = await run({ HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl });
  assert.deepEqual(ignored.body, { status: 200, body: 'from-target' });
  assert.deepEqual(ignored.hits, ['TARGET /x'], 'a proxy set without the startup switch is ignored by fetch()');

  const tunneled = await run({ http_proxy: proxyUrl, NODE_USE_ENV_PROXY: '1' });
  assert.deepEqual(tunneled.body, { status: 200, body: 'from-target' });
  assert.ok(hopForms.includes(tunneled.hits[0]),
    `the first hop is exactly one of ${JSON.stringify(hopForms)}, got ${JSON.stringify(tunneled.hits)}`);
  assert.deepEqual(tunneled.hits.slice(1), ['TARGET /x']);

  const both = await run({ HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl, NODE_USE_ENV_PROXY: '1' });
  assert.equal(both.body.body, 'from-target');
  assert.ok(hopForms.includes(both.hits[0]),
    `the first hop is exactly one of ${JSON.stringify(hopForms)}, got ${JSON.stringify(both.hits)}`);
  assert.deepEqual(both.hits.slice(1), ['TARGET /x']);

  const bypass = await run({ HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl, NO_PROXY: '127.0.0.1', NODE_USE_ENV_PROXY: '1' });
  assert.equal(bypass.body.body, 'from-target');
  assert.deepEqual(bypass.hits, ['TARGET /x']);

  // The relay forwards only to 127.0.0.1, in both shapes: anything else is refused and nothing leaves.
  hits.length = 0;
  const foreignStatus = await new Promise((resolve, reject) => {
    const rq = httpRequest({ host: '127.0.0.1', port: proxyPort, path: 'http://example.invalid/x', method: 'GET' }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    rq.on('error', reject);
    rq.end();
  });
  assert.equal(foreignStatus, 403, JSON.stringify(hits));
  assert.deepEqual(hits, ['REQ GET http://example.invalid/x'], 'the absolute-form request was seen, and refused');
  const connectRefusal = await new Promise((resolve, reject) => {
    const client = netConnect(proxyPort, '127.0.0.1');
    let received = '';
    client.on('data', (chunk) => { received += chunk; });
    client.on('close', () => resolve(received));
    client.on('error', reject);
    client.on('connect', () => client.write('CONNECT example.invalid:443 HTTP/1.1\r\nHost: example.invalid:443\r\n\r\n'));
  });
  assert.match(connectRefusal, /^HTTP\/1\.1 403 /, JSON.stringify(hits));
  assert.deepEqual(hits, ['REQ GET http://example.invalid/x', 'CONNECT example.invalid:443'], 'both shapes were refused');
});

test('an old Node with HTTP(S)_PROXY set warns and downloads directly instead of stopping (0.2.2: a stray proxy variable must not break setup)', () => {
  const prev = process.exitCode;
  const spawned = [];
  const logs = [];
  try {
    const goOn = restartForEnvProxy({
      env: cleanEnv({ HTTPS_PROXY: 'http://proxy.example:8080' }),
      version: '22.20.0',
      spawnImpl: (...args) => { spawned.push(args); return new EventEmitter(); },
      error: (line) => logs.push(line),
    });
    assert.equal(goOn, false, 'the caller continues in this process');
    assert.equal(spawned.length, 0, 'no restart: this Node cannot proxy fetch()');
    assert.notEqual(process.exitCode, 1, 'no failure exit code');
    assert.match(logs.join('\n'), /Node 22\.20\.0 does not route fetch\(\) through it .*downloading directly instead/);
  } finally {
    process.exitCode = prev;
  }
});
