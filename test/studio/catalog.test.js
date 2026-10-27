// test/studio/catalog.test.js — POST /studio/api/catalog and /catalog/install (DESIGN §32.13).
// The download is an injected fetch. A request that is not local, or that carries no studio key, gets the 404
// page and does not download. The timeout case waits for the real zip timeout (60 s) because the route does not
// take a shorter one.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { startServer } from '../../server/index.js';
import { zipFiles } from '../../server/plugins/zip.js';
import { ZIP_FETCH_TIMEOUT_MS } from '../../server/plugins/install.js';
import { PLUGIN_MAX_BYTES } from '../../shared/plugins/manifest.js';

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

function pluginZip(id, extra = {}) {
  const manifest = {
    manifest: 2, id, version: '1.0.0', app: '*', api: 1, class: 'cosmetic', scope: ['room', 'personal'],
    permissions: ['assets.override'], assets: {}, ...extra,
  };
  return zipFiles([{ name: `${id}/plugin.json`, data: Buffer.from(JSON.stringify(manifest)) }]);
}

describe('the studio catalogue', () => {
  let srv;
  let tmp;
  let plugins;
  let H;
  let handler;
  const zip = pluginZip('demo-skin');
  const digest = sha(zip);
  const entry = {
    id: 'demo-skin', name: 'Demo skin', version: '1.0.0', class: 'cosmetic',
    url: 'https://example.invalid/demo-skin.zip', sha256: digest, bytes: zip.length, app: '*',
  };
  const catalog = { catalog: 1, name: 'Studio catalogue', plugins: [entry, { ...entry, id: 'demo-old', name: 'Old', version: '1.0.0', app: '>=9.0.0', sha256: 'cd'.repeat(32), url: 'https://example.invalid/old.zip' }] };

  const call = async (method, url, body, headers = H) => {
    const r = await fetch(srv.url + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const type = r.headers.get('content-type') || '';
    return { status: r.status, body: type.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
  };
  const raw = (method, url, headers = {}, body = null) => new Promise((resolve, reject) => {
    const u = new URL(srv.url + url);
    const r = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });

  before(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-studio-catalog-'));
    plugins = path.join(tmp, 'plugins');
    fs.mkdirSync(plugins);
    handler = async () => new Response(zip, { status: 200 });
    srv = await startServer({
      port: 0, host: '127.0.0.1', quiet: true, pluginsDir: plugins, assetIndex: false,
      fetch: (url, init) => handler(url, init),
    });
    H = { 'x-sp-studio': srv.studio.key, 'content-type': 'application/json' };
  });
  after(async () => { await srv?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

  test('a foreign host, a public client and a missing key get 404 and do not download', async () => {
    let calls = 0;
    handler = async () => { calls += 1; return new Response(zip, { status: 200 }); };
    assert.equal((await raw('POST', '/studio/api/catalog', { 'content-type': 'application/json' }, '{}')).status, 404);
    assert.equal((await raw('POST', '/studio/api/catalog/install', { host: 'evil.example.com', 'x-sp-studio': srv.studio.key, 'content-type': 'application/json' }, '{}')).status, 404);
    assert.equal((await raw('POST', '/studio/api/catalog', { 'x-forwarded-for': '203.0.113.9', 'x-sp-studio': srv.studio.key, 'content-type': 'application/json' }, '{}')).status, 404);
    assert.equal(calls, 0);
    const wrong = await call('POST', '/studio/api/catalog', { text: '{}' }, { 'x-sp-studio': 'not-the-key', 'content-type': 'application/json' });
    assert.equal(wrong.status, 403);
    assert.equal(wrong.body.error, 'PLUGIN_STUDIO_KEY');
  });

  test('a bad catalogue, an http address and a missing hash are 400; a list is 200', async () => {
    const bad = await call('POST', '/studio/api/catalog', { text: '{]' });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, 'PLUGIN_CATALOG_SHAPE');
    let calls = 0;
    handler = async () => { calls += 1; return new Response('{}', { status: 200 }); };
    const httpUrl = await call('POST', '/studio/api/catalog', { url: 'http://example.invalid/c.json' });
    assert.equal(httpUrl.status, 400);
    assert.equal(httpUrl.body.error, 'PLUGIN_CATALOG_URL');
    assert.equal(calls, 0);
    const list = await call('POST', '/studio/api/catalog', { text: JSON.stringify(catalog) });
    assert.equal(list.status, 200);
    assert.equal(list.body.name, 'Studio catalogue');
    assert.deepEqual(list.body.plugins.map((p) => p.status), ['available', 'incompatible']);
    const noHash = await call('POST', '/studio/api/catalog/install', { url: entry.url });
    assert.equal(noHash.status, 400);
    assert.equal(noHash.body.error, 'PLUGIN_INSTALL_HASH');
  });

  test('install: hash mismatch 422, check 422, zip 422, exists 409, size 413, fetch and redirect 502, then 201', async () => {
    handler = async () => new Response(Buffer.from('not a zip'), { status: 200 });
    const mismatch = await call('POST', '/studio/api/catalog/install', { url: entry.url, sha256: digest, id: 'demo-skin' });
    assert.equal(mismatch.status, 422);
    assert.equal(mismatch.body.error, 'PLUGIN_INSTALL_HASH');
    handler = async (url) => {
      if (String(url).endsWith('/bad.zip')) return new Response(pluginZip('demo-skin', { version: 'nope' }), { status: 200 });
      if (String(url).endsWith('/travel.zip')) return new Response(zipFiles([{ name: '../evil.txt', data: Buffer.from('no') }]), { status: 200 });
      if (String(url).endsWith('/big.zip')) return new Response(new Uint8Array(4), { status: 200, headers: { 'content-length': String(PLUGIN_MAX_BYTES + 1) } });
      if (String(url).endsWith('/redir.zip')) return new Response(null, { status: 302, headers: { location: 'http://example.invalid/x.zip' } });
      if (String(url).endsWith('/down.zip')) return new Response('no', { status: 500 });
      return new Response(zip, { status: 200 });
    };
    const checked = await call('POST', '/studio/api/catalog/install', { url: 'https://example.invalid/bad.zip', sha256: sha(pluginZip('demo-skin', { version: 'nope' })), id: 'demo-skin' });
    assert.equal(checked.status, 422);
    assert.equal(checked.body.error, 'PLUGIN_INSTALL_CHECK');
    assert.equal(fs.existsSync(path.join(plugins, 'demo-skin')), false);
    const travel = zipFiles([{ name: '../evil.txt', data: Buffer.from('no') }]);
    const badZip = await call('POST', '/studio/api/catalog/install', { url: 'https://example.invalid/travel.zip', sha256: sha(travel) });
    assert.equal(badZip.status, 422);
    assert.equal(badZip.body.error, 'PLUGIN_INSTALL_ZIP');
    const big = await call('POST', '/studio/api/catalog/install', { url: 'https://example.invalid/big.zip', sha256: digest });
    assert.equal(big.status, 413);
    assert.equal(big.body.error, 'PLUGIN_INSTALL_SIZE');
    const down = await call('POST', '/studio/api/catalog/install', { url: 'https://example.invalid/down.zip', sha256: digest });
    assert.equal(down.status, 502);
    assert.equal(down.body.error, 'PLUGIN_INSTALL_FETCH');
    const redir = await call('POST', '/studio/api/catalog/install', { url: 'https://example.invalid/redir.zip', sha256: digest });
    assert.equal(redir.status, 502);
    assert.equal(redir.body.error, 'PLUGIN_INSTALL_REDIRECT');
    const ok = await call('POST', '/studio/api/catalog/install', { url: entry.url, sha256: digest, id: 'demo-skin', bytes: zip.length });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(ok.body.id, 'demo-skin');
    assert.equal(ok.body.replaced, null);
    assert.equal(fs.existsSync(path.join(plugins, 'demo-skin', 'plugin.json')), true);
    const again = await call('POST', '/studio/api/catalog/install', { url: entry.url, sha256: digest, id: 'demo-skin' });
    assert.equal(again.status, 409);
    assert.equal(again.body.error, 'PLUGIN_INSTALL_EXISTS');
    const forced = await call('POST', '/studio/api/catalog/install', { url: entry.url, sha256: digest, id: 'demo-skin', force: true });
    assert.equal(forced.status, 201, JSON.stringify(forced.body));
    assert.match(forced.body.replaced, /^demo-skin-/);
    assert.equal(forced.body.replaced.includes('/'), false);
    assert.equal(fs.existsSync(path.join(plugins, '_replaced', forced.body.replaced, 'plugin.json')), true);
  });

  test('a download that never ends is 502 PLUGIN_INSTALL_TIMEOUT', { timeout: ZIP_FETCH_TIMEOUT_MS + 20000 }, async () => {
    handler = (url, init) => new Promise((_, reject) => { init.signal.addEventListener('abort', () => reject(new Error('aborted'))); });
    const slow = await call('POST', '/studio/api/catalog/install', { url: 'https://example.invalid/slow.zip', sha256: digest });
    assert.equal(slow.status, 502);
    assert.equal(slow.body.error, 'PLUGIN_INSTALL_TIMEOUT');
  });
});
