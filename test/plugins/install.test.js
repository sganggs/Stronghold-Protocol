// test/plugins/install.test.js — install a plugin zip (DESIGN §32.13, docs/PLUGINS.md §17).
// Downloads use an injected fetch. Nothing here contacts the public network. The production cap
// INSTALL_MAX_BYTES is asserted equal to PLUGIN_MAX_BYTES (the largest class ceiling); oversized cases pass a small
// maxBytes or declare an uncompressed size over the real cap before inflate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PLUGIN_LIMITS, PLUGIN_MAX_BYTES } from '../../shared/plugins/manifest.js';
import { crc32, readPluginZip, zipFiles } from '../../server/plugins/zip.js';
import {
  INSTALL_MAX_BYTES, fetchHttps, hostAllowed, installFromFile, installFromUrl, installPluginBytes,
  installedPluginVersion, isNonPublicAddress, isRemoteAddress, loadCatalogText, pinningLookup, readDownloadAllow,
} from '../../server/plugins/install.js';
import { main } from '../../tools/plugin.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const HASH = 'ab'.repeat(32);

function pluginZip(id, manifestExtra = {}, files = {}) {
  const manifest = {
    manifest: 2, id, name: { zh: '测试', en: 'Test' }, version: '1.0.0', app: '*', api: 1,
    class: 'cosmetic', scope: ['room', 'personal'], permissions: ['assets.override'], assets: {},
    ...manifestExtra,
  };
  const entries = [{ name: `${id}/plugin.json`, data: Buffer.from(JSON.stringify(manifest)) }];
  for (const [rel, data] of Object.entries(files)) entries.push({ name: `${id}/${rel}`, data: Buffer.isBuffer(data) ? data : Buffer.from(data) });
  return zipFiles(entries);
}

function patchCentral(zip, name, edit) {
  const z = Buffer.from(zip);
  const nb = Buffer.from(name, 'utf8');
  let p = 0;
  while ((p = z.indexOf(nb, p)) !== -1) {
    if (p >= 46 && z.readUInt32LE(p - 46) === 0x02014b50) {
      edit(z, p - 46);
      return z;
    }
    p += 1;
  }
  throw new Error(`no central entry for ${name}`);
}

async function quiet(argv) {
  const out = [];
  const log = console.log;
  const err = console.error;
  console.log = (...a) => out.push(a.join(' '));
  console.error = (...a) => out.push(a.join(' '));
  try { return { code: await main(argv), out: out.join('\n') }; }
  finally { console.log = log; console.error = err; }
}

const rejects = async (fn, code, status) => {
  await assert.rejects(fn, (e) => {
    assert.equal(e.code, code, e.message);
    if (status !== undefined) assert.equal(e.status, status);
    return true;
  });
};

test('the production download cap is PLUGIN_MAX_BYTES, the largest class ceiling', () => {
  assert.equal(INSTALL_MAX_BYTES, PLUGIN_MAX_BYTES);
  assert.equal(INSTALL_MAX_BYTES, 536870912);
  assert.ok(INSTALL_MAX_BYTES > PLUGIN_LIMITS.pluginBytes);
});

test('a local zip installs, a bad hash is refused, an existing id is kept, --force moves the old folder', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-install-'));
  const plugins = path.join(tmp, 'plugins');
  fs.mkdirSync(plugins);
  const zip = pluginZip('demo-skin');
  const file = path.join(tmp, 'demo-skin.zip');
  fs.writeFileSync(file, zip);
  try {
    const first = installFromFile(file, { pluginsDir: plugins });
    assert.equal(first.id, 'demo-skin');
    assert.equal(JSON.parse(fs.readFileSync(path.join(plugins, 'demo-skin', 'plugin.json'), 'utf8')).version, '1.0.0');
    assert.equal(installedPluginVersion(plugins, 'demo-skin'), '1.0.0');
    fs.writeFileSync(path.join(plugins, 'demo-skin', 'README.md'), 'keep me');
    assert.throws(() => installFromFile(file, { pluginsDir: plugins, sha256: '0'.repeat(64) }), (e) => e.code === 'PLUGIN_INSTALL_HASH' && e.status === 422);
    assert.equal(fs.readFileSync(path.join(plugins, 'demo-skin', 'README.md'), 'utf8'), 'keep me', 'a bad hash did not replace it');
    assert.throws(() => installFromFile(file, { pluginsDir: plugins }), (e) => e.code === 'PLUGIN_INSTALL_EXISTS' && e.status === 409);
    const again = pluginZip('demo-skin', { version: '2.0.0' });
    const second = installPluginBytes(again, { pluginsDir: plugins, force: true });
    assert.equal(JSON.parse(fs.readFileSync(path.join(plugins, 'demo-skin', 'plugin.json'), 'utf8')).version, '2.0.0');
    assert.ok(second.replaced && second.replaced.startsWith(path.join(plugins, '_replaced', 'demo-skin-')));
    assert.equal(fs.readFileSync(path.join(second.replaced, 'README.md'), 'utf8'), 'keep me', 'the old folder was moved, not deleted');
    assert.equal(fs.existsSync(path.join(plugins, 'demo-skin', 'README.md')), false);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('a decoy script in the package is copied and not executed', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-install-decoy-'));
  const plugins = path.join(tmp, 'plugins');
  const marker = path.join(tmp, 'ran');
  fs.mkdirSync(plugins);
  const prev = process.env.SP_INSTALL_DECOY;
  process.env.SP_INSTALL_DECOY = marker;
  const script = "import { writeFileSync } from 'node:fs';\nwriteFileSync(process.env.SP_INSTALL_DECOY, 'ran');\n";
  const manifest = {
    manifest: 2, id: 'demo-widget', version: '1.0.0', app: '*', api: 1, class: 'ui', scope: ['personal'],
    permissions: ['ui.frame'], entry: { client: 'ui/index.html' }, slots: ['hud.right'],
  };
  const zip = zipFiles([
    { name: 'demo-widget/plugin.json', data: Buffer.from(JSON.stringify(manifest)) },
    { name: 'demo-widget/ui/index.html', data: Buffer.from('<!doctype html><title>x</title>') },
    { name: 'demo-widget/ui/trap.js', data: Buffer.from(script) },
  ]);
  try {
    installPluginBytes(zip, { pluginsDir: plugins });
    assert.equal(fs.existsSync(marker), false, 'importing trap.js would have written the marker');
    assert.match(fs.readFileSync(path.join(plugins, 'demo-widget', 'ui', 'trap.js'), 'utf8'), /writeFileSync/);
  } finally {
    if (prev === undefined) delete process.env.SP_INSTALL_DECOY; else process.env.SP_INSTALL_DECOY = prev;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('path traversal, a symbolic link, a hidden name, a declared size and a file-count bomb are refused before install', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-install-zip-'));
  const plugins = path.join(tmp, 'plugins');
  fs.mkdirSync(plugins);
  try {
    const travel = zipFiles([{ name: '../evil.txt', data: Buffer.from('no') }]);
    assert.throws(() => installPluginBytes(travel, { pluginsDir: plugins }), (e) => e.code === 'PLUGIN_INSTALL_ZIP');
    assert.equal(fs.existsSync(path.join(tmp, 'evil.txt')), false);
    const linked = patchCentral(pluginZip('demo-skin'), 'demo-skin/plugin.json', (z, at) => {
      z.writeUInt32LE((0o120777 << 16) >>> 0, at + 38);
    });
    assert.throws(() => installPluginBytes(linked, { pluginsDir: plugins }), (e) => e.code === 'PLUGIN_INSTALL_ZIP' && /symbolic link/.test(e.message));
    assert.equal(fs.existsSync(path.join(plugins, 'demo-skin')), false);
    const hidden = zipFiles([{ name: 'demo-skin/.secret', data: Buffer.from('no') }, { name: 'demo-skin/plugin.json', data: Buffer.from('{}') }]);
    assert.throws(() => installPluginBytes(hidden, { pluginsDir: plugins }), (e) => e.code === 'PLUGIN_INSTALL_ZIP');
    const huge = patchCentral(pluginZip('demo-skin'), 'demo-skin/plugin.json', (z, at) => {
      z.writeUInt32LE(PLUGIN_MAX_BYTES + 1, at + 24);
    });
    assert.throws(() => installPluginBytes(huge, { pluginsDir: plugins }), (e) => e.code === 'PLUGIN_INSTALL_ZIP' && /uncompressed size/.test(e.message));
    const bomb = zipFiles(Array.from({ length: PLUGIN_LIMITS.files + 1 }, (_, i) => ({ name: `n/${String(i).padStart(4, '0')}.png`, data: Buffer.from([1]) })));
    assert.throws(() => installPluginBytes(bomb, { pluginsDir: plugins }), (e) => e.code === 'PLUGIN_INSTALL_ZIP' && /entries/.test(e.message));
    assert.equal(fs.readdirSync(plugins).length, 0);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('https install: hash required before fetch, redirect manual, http and a bad redirect refused, size and timeout stop', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-install-https-'));
  const plugins = path.join(tmp, 'plugins');
  fs.mkdirSync(plugins);
  const zip = pluginZip('demo-skin');
  const digest = sha(zip);
  let calls = 0;
  const fetch = async (url, init) => {
    calls += 1;
    assert.equal(init.redirect, 'manual');
    if (url.endsWith('/start')) return new Response(null, { status: 302, headers: { location: 'https://example.invalid/file.zip' } });
    if (url.endsWith('/to-http')) return new Response(null, { status: 302, headers: { location: 'http://example.invalid/file.zip' } });
    if (url.endsWith('/opaque')) return { status: 0, type: 'opaqueredirect', headers: { get() { return null; } }, body: { cancel() {} } };
    if (url.endsWith('/big-len')) return new Response(new Uint8Array(4), { status: 200, headers: { 'content-length': '999' } });
    if (url.endsWith('/stream')) {
      let left = 80;
      const body = new ReadableStream({ pull(c) { if (left <= 0) { c.close(); return; } const n = Math.min(left, 16); c.enqueue(new Uint8Array(n)); left -= n; } });
      return new Response(body, { status: 200 });
    }
    if (url.endsWith('/hang')) return new Promise((_, reject) => { init.signal.addEventListener('abort', () => reject(new Error('aborted'))); });
    if (url.endsWith('/500')) return new Response('no', { status: 500 });
    return new Response(zip, { status: 200 });
  };
  try {
    calls = 0;
    await rejects(() => installFromUrl('http://example.invalid/a.zip', { pluginsDir: plugins, sha256: digest, fetch }), 'PLUGIN_INSTALL_URL', 400);
    await rejects(() => installFromUrl('https://user:pass@example.invalid/a.zip', { pluginsDir: plugins, sha256: digest, fetch }), 'PLUGIN_INSTALL_URL', 400);
    await rejects(() => installFromUrl('https://example.invalid/a.zip', { pluginsDir: plugins, sha256: '', fetch }), 'PLUGIN_INSTALL_HASH', 400);
    assert.equal(calls, 0, 'refused before any fetch');
    await rejects(() => installFromUrl('https://example.invalid/to-http', { pluginsDir: plugins, sha256: digest, fetch }), 'PLUGIN_INSTALL_REDIRECT', 502);
    await rejects(() => installFromUrl('https://example.invalid/opaque', { pluginsDir: plugins, sha256: digest, fetch }), 'PLUGIN_INSTALL_REDIRECT', 502);
    await rejects(() => installFromUrl('https://example.invalid/file.zip', { pluginsDir: plugins, sha256: HASH, fetch }), 'PLUGIN_INSTALL_HASH', 422);
    assert.equal(fs.existsSync(path.join(plugins, 'demo-skin')), false);
    const ok = await installFromUrl('https://example.invalid/start', { pluginsDir: plugins, sha256: digest, fetch });
    assert.equal(ok.id, 'demo-skin');
    await rejects(() => installFromUrl('https://example.invalid/big-len', { pluginsDir: plugins, sha256: digest, fetch, maxBytes: 100 }), 'PLUGIN_INSTALL_SIZE', 413);
    await rejects(() => installFromUrl('https://example.invalid/stream', { pluginsDir: plugins, sha256: digest, fetch, maxBytes: 32 }), 'PLUGIN_INSTALL_SIZE', 413);
    await rejects(() => installFromUrl('https://example.invalid/hang', { pluginsDir: plugins, sha256: digest, fetch, timeoutMs: 30 }), 'PLUGIN_INSTALL_TIMEOUT', 502);
    await rejects(() => installFromUrl('https://example.invalid/500', { pluginsDir: plugins, sha256: digest, fetch }), 'PLUGIN_INSTALL_FETCH', 502);
    await rejects(() => installFromUrl('https://example.invalid/file.zip', { pluginsDir: plugins, sha256: digest, fetch, expectedBytes: 1 }), 'PLUGIN_INSTALL_SIZE', 413);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('a symlink id is not followed: status has no version, and --force renames the link', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-install-link-'));
  const plugins = path.join(tmp, 'plugins');
  const real = path.join(tmp, 'real');
  fs.mkdirSync(plugins);
  fs.mkdirSync(path.join(real, 'elsewhere'), { recursive: true });
  fs.writeFileSync(path.join(real, 'elsewhere', 'plugin.json'), JSON.stringify({ version: '9.9.9' }));
  fs.symlinkSync(path.join(real, 'elsewhere'), path.join(plugins, 'demo-skin'));
  const incoming = path.join(tmp, 'incoming-target');
  fs.mkdirSync(incoming);
  fs.symlinkSync(incoming, path.join(plugins, '_incoming'));
  try {
    assert.equal(installedPluginVersion(plugins, 'demo-skin'), null);
    assert.throws(() => installPluginBytes(pluginZip('demo-skin'), { pluginsDir: plugins }), (e) => e.code === 'PLUGIN_INSTALL_ZIP');
    assert.equal(fs.readdirSync(incoming).length, 0, 'a linked _incoming was not written through');
    fs.unlinkSync(path.join(plugins, '_incoming'));
    const done = installPluginBytes(pluginZip('demo-skin'), { pluginsDir: plugins, force: true });
    assert.equal(fs.lstatSync(done.replaced).isSymbolicLink(), true);
    assert.equal(fs.readFileSync(path.join(real, 'elsewhere', 'plugin.json'), 'utf8').includes('9.9.9'), true, 'the link target was not deleted');
    assert.equal(fs.lstatSync(path.join(plugins, 'demo-skin')).isSymbolicLink(), false);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('the CLI installs a local zip, refuses https without --sha256, and lists a catalogue', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-install-cli-'));
  const plugins = path.join(tmp, 'plugins');
  fs.mkdirSync(plugins);
  const zip = pluginZip('demo-skin');
  const file = path.join(tmp, 'demo.zip');
  fs.writeFileSync(file, zip);
  const catalog = {
    catalog: 1, name: 'CLI catalogue',
    plugins: [{ id: 'demo-skin', name: 'Demo', version: '2.0.0', class: 'cosmetic', url: 'https://example.invalid/a.zip', sha256: HASH, app: '*' }],
  };
  fs.writeFileSync(path.join(tmp, 'catalog.json'), JSON.stringify(catalog));
  try {
    const missing = await quiet(['install', 'https://example.invalid/a.zip', '--root', tmp]);
    assert.equal(missing.code, 1, missing.out);
    assert.match(missing.out, /PLUGIN_INSTALL_HASH/);
    const http = await quiet(['install', 'http://example.invalid/a.zip', '--sha256', HASH, '--root', tmp]);
    assert.equal(http.code, 1, http.out);
    assert.match(http.out, /PLUGIN_INSTALL_URL/);
    const ok = await quiet(['install', file, '--root', tmp]);
    assert.equal(ok.code, 0, ok.out);
    assert.match(ok.out, /plugins\/demo-skin\//);
    const listed = await quiet(['catalog', path.join(tmp, 'catalog.json'), '--json', '--root', tmp]);
    assert.equal(listed.code, 0, listed.out);
    const body = JSON.parse(listed.out);
    assert.equal(body.plugins[0].status, 'updatable');
    const words = await quiet(['catalog', path.join(tmp, 'catalog.json'), '--root', tmp]);
    assert.match(words.out, /可更新/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('a catalogue document over 1 MB is refused, and https catalogue fetch does not follow http', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-catalog-fetch-'));
  const big = path.join(tmp, 'big.json');
  fs.writeFileSync(big, `{${' '.repeat(1024 * 1024)}}`);
  let calls = 0;
  const fetch = async (url, init) => {
    calls += 1;
    assert.equal(init.redirect, 'manual');
    if (url.endsWith('/redir')) return new Response(null, { status: 302, headers: { location: 'http://example.invalid/c.json' } });
    return new Response('{}', { status: 200 });
  };
  try {
    await rejects(() => loadCatalogText(big), 'PLUGIN_CATALOG_SIZE', 413);
    await rejects(() => loadCatalogText('http://example.invalid/c.json', { fetch }), 'PLUGIN_CATALOG_URL', 400);
    assert.equal(calls, 0);
    await rejects(() => loadCatalogText('https://example.invalid/redir', { fetch }), 'PLUGIN_CATALOG_FETCH', 502);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('CLI catalogue of the example file exits 0 and does not mark the documentation entries installed', async () => {
  const r = await quiet(['catalog', path.join(ROOT, 'docs/plugin-catalog.example.json'), '--json', '--root', ROOT]);
  assert.equal(r.code, 0, r.out);
  const body = JSON.parse(r.out);
  assert.equal(body.plugins.length, 2);
  assert.ok(body.plugins.every((e) => e.status === 'available' || e.status === 'incompatible'));
});

const PRIVATE_URLS = [
  'https://127.0.0.1/admin',
  'https://127.1/admin',
  'https://10.0.0.1/admin',
  'https://169.254.169.254/metadata',
  'https://0177.0.0.1/admin',
  'https://0x7f.0.0.1/admin',
  'https://2130706433/admin',
  'https://printer.local/admin',
  'https://[::1]/admin',
  'https://example.invalid:8443/admin',
];

test('a non-public or non-443 address is refused before fetch, including a redirect', async () => {
  for (const ip of ['0.0.0.0', '10.1.2.3', '100.64.0.1', '127.0.0.1', '169.254.169.254', '172.16.0.1', '192.0.0.1', '192.0.2.1', '192.168.1.1', '198.18.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '240.0.0.1', '255.255.255.255', '::', '::1', 'fd00::1', 'fe80::1', 'ff02::1', '2001:db8::1', '100::1', '2001::1', '2002::1', '::ffff:1.1.1.1', '::ffff:127.0.0.1']) {
    assert.equal(isNonPublicAddress(ip), true, ip);
  }
  assert.equal(isNonPublicAddress('1.1.1.1'), false);
  assert.equal(isNonPublicAddress('8.8.8.8'), false);
  assert.equal(isNonPublicAddress('2606:4700:4700::1111'), false);
  for (const url of PRIVATE_URLS) {
    let calls = 0;
    await rejects(() => fetchHttps(url, {
      fetch: () => { calls += 1; return new Response('no'); },
      allowDownloadHosts: [],
      timeoutMs: 1000,
    }), 'PLUGIN_INSTALL_URL', 400);
    assert.equal(calls, 0, url);
  }
  let catalogCalls = 0;
  await rejects(() => fetchHttps('https://127.0.0.1/catalog.json', {
    fetch: () => { catalogCalls += 1; return new Response('{}'); },
    allowDownloadHosts: [], kind: 'catalog', timeoutMs: 1000,
  }), 'PLUGIN_CATALOG_URL', 400);
  assert.equal(catalogCalls, 0);
  let calls = [];
  const fetch = async (url) => {
    calls.push(url);
    if (calls.length > 1) throw new Error('second request');
    return new Response(null, { status: 302, headers: { location: 'https://192.168.1.1/admin' } });
  };
  await rejects(() => fetchHttps('https://public.example/start', { fetch, allowDownloadHosts: [], timeoutMs: 1000 }), 'PLUGIN_INSTALL_REDIRECT', 502);
  assert.deepEqual(calls, ['https://public.example/start']);
});

test('a lookup that returns a private address is not connected, unless that host is allowlisted', async () => {
  let handed;
  pinningLookup('443', [], (hostname, options, cb) => cb(null, [{ address: '10.0.0.1', family: 4 }]))('evil.example', {}, (err, address) => {
    assert.equal(err.code, 'ENONPUBLIC');
    handed = address;
  });
  assert.equal(handed, undefined);
  pinningLookup('443', ['evil.example'], (hostname, options, cb) => cb(null, [{ address: '10.0.0.1', family: 4 }]))('evil.example', {}, (err, address) => {
    assert.equal(err, null);
    assert.equal(address, '10.0.0.1');
  });
  let fetches = 0;
  const lookup = (hostname, options, cb) => cb(null, [{ address: '10.0.0.1', family: 4 }]);
  await rejects(() => fetchHttps('https://evil.example/a.zip', {
    fetch: () => { fetches += 1; return new Response('x'); },
    lookup, allowDownloadHosts: [], timeoutMs: 1000,
  }), 'PLUGIN_INSTALL_URL', 400);
  assert.equal(fetches, 0);
  const ok = await fetchHttps('https://evil.example/a.zip', {
    fetch: () => { fetches += 1; return new Response('x'); },
    lookup, allowDownloadHosts: ['evil.example'], timeoutMs: 1000,
  });
  assert.equal(ok.toString(), 'x');
  assert.equal(fetches, 1);
  assert.equal(hostAllowed('evil.example', '8443', ['evil.example:443']), false);
  assert.equal(hostAllowed('evil.example', '8443', ['evil.example']), true);
  assert.equal(hostAllowed('evil.example', '8443', ['evil.example:8443']), true);
  let connected = false;
  const request = (options) => {
    const handlers = {};
    const req = {
      on(ev, fn) { (handlers[ev] ||= []).push(fn); return req; },
      end() {
        options.lookup(options.hostname, {}, (err, address) => {
          if (address !== undefined) connected = true;
          for (const fn of handlers.error || []) fn(err || new Error('refusing non-public address'));
        });
      },
    };
    return req;
  };
  await rejects(() => fetchHttps('https://evil.example/a.zip', {
    lookup, request, allowDownloadHosts: [], timeoutMs: 1000,
  }), 'PLUGIN_INSTALL_URL', 400);
  assert.equal(connected, false);
});

test('the operator allowlist is the env and plugins/config.json, and a broken file does not block a public download', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-install-allow-'));
  const plugins = path.join(tmp, 'plugins');
  fs.mkdirSync(plugins);
  const prev = process.env.SP_PLUGIN_DOWNLOAD_ALLOW;
  delete process.env.SP_PLUGIN_DOWNLOAD_ALLOW;
  let calls = 0;
  const fetch = async () => { calls += 1; return new Response('{}', { status: 200 }); };
  try {
    fs.writeFileSync(path.join(plugins, 'config.json'), JSON.stringify({ rooms: 'host', allowDownloadHosts: ['10.0.0.1'] }));
    assert.deepEqual(readDownloadAllow(plugins), ['10.0.0.1']);
    const buf = await fetchHttps('https://10.0.0.1/a.zip', { fetch, pluginsDir: plugins, timeoutMs: 1000 });
    assert.equal(buf.toString(), '{}');
    assert.equal(calls, 1);
    fs.writeFileSync(path.join(plugins, 'config.json'), '{');
    calls = 0;
    await rejects(() => fetchHttps('https://10.0.0.1/a.zip', { fetch, pluginsDir: plugins, timeoutMs: 1000 }), 'PLUGIN_INSTALL_URL', 400);
    assert.equal(calls, 0);
    const pub = await fetchHttps('https://example.invalid/c.json', { fetch, pluginsDir: plugins, timeoutMs: 1000, kind: 'catalog' });
    assert.equal(pub.toString(), '{}');
    process.env.SP_PLUGIN_DOWNLOAD_ALLOW = '192.168.1.1';
    calls = 0;
    await fetchHttps('https://192.168.1.1/admin', { fetch, pluginsDir: plugins, timeoutMs: 1000 });
    assert.equal(calls, 1);
    calls = 0;
    await rejects(() => fetchHttps('https://10.0.0.1/a.zip', { fetch, pluginsDir: plugins, allowDownloadHosts: [], timeoutMs: 1000 }), 'PLUGIN_INSTALL_URL');
    assert.equal(calls, 0, 'an explicit empty list replaces the operator list');
  } finally {
    if (prev === undefined) delete process.env.SP_PLUGIN_DOWNLOAD_ALLOW;
    else process.env.SP_PLUGIN_DOWNLOAD_ALLOW = prev;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('one deadline covers a stalled body and is not reset on each redirect', async () => {
  let signal;
  const stalled = async (url, init) => {
    signal = init.signal;
    const stream = new ReadableStream({
      start(controller) {
        setTimeout(() => { try { controller.enqueue(new Uint8Array([1])); controller.close(); } catch { /* aborted */ } }, 400);
      },
    });
    return new Response(stream, { status: 200 });
  };
  const t0 = Date.now();
  await rejects(() => fetchHttps('https://example.invalid/a.zip', { fetch: stalled, timeoutMs: 40, allowDownloadHosts: [] }), 'PLUGIN_INSTALL_TIMEOUT', 502);
  assert.ok(Date.now() - t0 < 250, `body wait was ${Date.now() - t0} ms`);
  assert.equal(signal.aborted, true);
  const hops = async (url, init) => {
    signal = init.signal;
    if (url.endsWith('/start')) {
      await new Promise((resolve) => setTimeout(resolve, 80));
      if (init.signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      return new Response(null, { status: 302, headers: { location: 'https://example.invalid/body' } });
    }
    const stream = new ReadableStream({
      start(controller) {
        setTimeout(() => { try { controller.enqueue(new Uint8Array([1])); controller.close(); } catch { /* aborted */ } }, 400);
      },
    });
    return new Response(stream, { status: 200 });
  };
  const t1 = Date.now();
  await rejects(() => fetchHttps('https://example.invalid/start', { fetch: hops, timeoutMs: 120, allowDownloadHosts: [] }), 'PLUGIN_INSTALL_TIMEOUT', 502);
  const elapsed = Date.now() - t1;
  assert.ok(elapsed < 180, `redirect budget was ${elapsed} ms`);
  assert.equal(signal.aborted, true);
});

test('names that differ only by case are refused before _incoming', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-install-case-'));
  const plugins = path.join(tmp, 'plugins');
  fs.mkdirSync(plugins);
  try {
    for (const entries of [
      [{ name: 'A.txt', data: Buffer.from('1') }, { name: 'a.txt', data: Buffer.from('2') }],
      [{ name: 'A/first.txt', data: Buffer.from('1') }, { name: 'a/second.txt', data: Buffer.from('2') }],
    ]) {
      assert.throws(() => installPluginBytes(zipFiles(entries), { pluginsDir: plugins }), (e) => e.code === 'PLUGIN_INSTALL_ZIP' && /case/.test(e.message));
      assert.equal(fs.existsSync(path.join(plugins, '_incoming')), false);
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

/** A stored one-file zip. Central version stays 20 unless asked. Local extra is not copied into the central header. */
function storedZip({ name, data, localExtra = Buffer.alloc(0), localVersion = 20 }) {
  const nameBuf = Buffer.from(name);
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(localVersion, 4);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(localExtra.length, 28);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(0, 42);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + nameBuf.length, 12);
  end.writeUInt32LE(30 + nameBuf.length + localExtra.length + data.length, 16);
  return Buffer.concat([local, nameBuf, localExtra, data, central, nameBuf, end]);
}

test('a ZIP64 extra on the local header, or version 45, is refused before inflate and before _incoming', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-install-zip64-'));
  const plugins = path.join(tmp, 'plugins');
  fs.mkdirSync(plugins);
  const extra = Buffer.alloc(24);
  extra.writeUInt16LE(1, 0);
  extra.writeUInt16LE(20, 2);
  const data = Buffer.from('hello');
  try {
    const localOnly = storedZip({ name: 'a.txt', data, localExtra: extra, localVersion: 20 });
    assert.throws(() => readPluginZip(localOnly), (e) => e.code === 'PLUGIN_INSTALL_ZIP' && /ZIP64/.test(e.message));
    assert.throws(() => installPluginBytes(localOnly, { pluginsDir: plugins }), (e) => e.code === 'PLUGIN_INSTALL_ZIP');
    assert.equal(fs.existsSync(path.join(plugins, '_incoming')), false);
    const version45 = storedZip({ name: 'a.txt', data, localVersion: 45 });
    assert.throws(() => readPluginZip(version45), (e) => e.code === 'PLUGIN_INSTALL_ZIP' && /ZIP64/.test(e.message));
    const plain = storedZip({ name: 'a.txt', data });
    assert.equal(readPluginZip(plain)[0].data.toString(), 'hello');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('a Windows drive or UNC path is a file, and http and ftp stay remote', async () => {
  assert.equal(isRemoteAddress('C:/Downloads/demo.zip'), false);
  assert.equal(isRemoteAddress('C:\\Downloads\\demo.zip'), false);
  assert.equal(isRemoteAddress('\\\\server\\share\\demo.zip'), false);
  assert.equal(isRemoteAddress('//server/share/demo.zip'), false);
  assert.equal(isRemoteAddress('http://example.invalid/a.zip'), true);
  assert.equal(isRemoteAddress('ftp://example.invalid/a.zip'), true);
  assert.equal(isRemoteAddress('https://example.invalid/a.zip'), true);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-install-win-'));
  fs.mkdirSync(path.join(tmp, 'plugins'));
  try {
    const zip = await quiet(['install', 'C:/Downloads/demo.zip', '--root', tmp]);
    assert.equal(zip.code, 1, zip.out);
    assert.doesNotMatch(zip.out, /PLUGIN_INSTALL_URL/);
    assert.match(zip.out, /PLUGIN_INSTALL_ZIP/);
    const catalog = await quiet(['catalog', 'C:/Downloads/catalog.json', '--root', tmp]);
    assert.equal(catalog.code, 1, catalog.out);
    assert.doesNotMatch(catalog.out, /PLUGIN_CATALOG_URL/);
    assert.match(catalog.out, /PLUGIN_CATALOG_FETCH/);
    const ftp = await quiet(['install', 'ftp://example.invalid/a.zip', '--sha256', HASH, '--root', tmp]);
    assert.match(ftp.out, /PLUGIN_INSTALL_URL/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
