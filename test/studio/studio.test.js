// test/studio/studio.test.js — the plugin studio's server side (server/studio/, DESIGN §32.9, the 0.3.0 plan's C5):
//   * who may use it (gate.js): this machine and the local network, a local Host name (no DNS rebinding), the
//     X-SP-Studio header and the studio's own origin on a change — anyone else gets the 404 of a page that does not exist,
//     at the page and at every API route, whatever the method;
//   * the files (files.js): only inside plugins/<id>/ — no traversal, no link followed (a link inside the folder, a
//     folder swapped for a link), only the file types a plugin carries, the size limits (a body over the limit is refused
//     before it is read);
//   * the API: a new plugin from a template and a target, files dropped on a slot (the right names, the overlay set, the
//     old file removed), a reference, a slot emptied, the coded findings, a one-click fix, the preview composition (a
//     draft too, a model not packed yet), pack and a deterministic zip, the list.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { startServer } from '../../server/index.js';
import { studioAllowed, isStudioChange, isLocalHost, hostName, studioMode } from '../../server/studio/gate.js';
import { createPluginFiles, StudioError } from '../../server/studio/files.js';
import { suggestId, isStudioPath } from '../../server/studio/index.js';
import { printBanner } from '../../server/http/boot.js';
import { unzipFiles, zipFiles } from '../../server/plugins/zip.js';
import { listPluginFiles, readPluginFolder, WALK_LIMITS } from '../../server/plugins/registry.js';
import { buildPluginLock, zipPlugin } from '../../server/plugins/pack.js';
import { png, skel, atlas, writePlugin, cosmetic } from '../helpers/pluginFixtures.js';

const req = (remoteAddress, headers = {}) => ({ socket: { remoteAddress }, headers: { host: 'localhost:3000', ...headers } });

test('gate: loopback and private networks with a local Host name; a public client, a forwarded public client, a foreign Host — refused', () => {
  for (const ip of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '192.168.1.20', '10.0.0.8', '172.16.4.4', '100.100.1.1', 'fd12::1']) {
    assert.equal(studioAllowed(req(ip), { mode: 'lan', hosts: [] }).ok, true, ip);
  }
  for (const ip of ['8.8.8.8', '203.0.113.7', '2001:db8::1']) assert.equal(studioAllowed(req(ip), { mode: 'lan', hosts: [] }).ok, false, ip);
  // a tunnel or proxy on this machine names a public visitor: refused (TRUST_PROXY auto honours a local peer's headers)
  assert.equal(studioAllowed(req('127.0.0.1', { 'x-forwarded-for': '203.0.113.9' }), { mode: 'lan', hosts: [] }).ok, false);
  assert.equal(studioAllowed(req('127.0.0.1', { 'cf-connecting-ip': '198.51.100.4' }), { mode: 'lan', hosts: [] }).ok, false);
  assert.equal(studioAllowed(req('127.0.0.1', { 'x-forwarded-for': '192.168.1.7' }), { mode: 'lan', hosts: [] }).ok, true);
  // every forwarding header counts: a proxy that sets one passes the others a visitor sent — a header can refuse, never admit
  assert.equal(studioAllowed(req('127.0.0.1', { 'x-forwarded-for': '203.0.113.9', 'x-real-ip': '127.0.0.1' }), { mode: 'lan', hosts: [] }).ok, false);
  assert.equal(studioAllowed(req('127.0.0.1', { 'x-forwarded-for': '203.0.113.9', 'cf-connecting-ip': '10.0.0.1' }), { mode: 'lan', hosts: [] }).ok, false);
  assert.equal(studioAllowed(req('127.0.0.1', { 'x-forwarded-for': '203.0.113.9, 192.168.1.7' }), { mode: 'lan', hosts: [] }).ok, false, 'every hop');
  assert.equal(studioAllowed(req('127.0.0.1', { 'true-client-ip': '198.51.100.1' }), { mode: 'lan', hosts: [] }).ok, false);
  assert.equal(studioAllowed(req('127.0.0.1', { forwarded: 'for=198.51.100.1;proto=https' }), { mode: 'lan', hosts: [] }).ok, false);
  assert.equal(studioAllowed(req('127.0.0.1', { forwarded: 'for=unknown' }), { mode: 'lan', hosts: [] }).ok, false, 'an address that cannot be read');
  assert.equal(studioAllowed(req('127.0.0.1', { forwarded: 'for="[::1]:4711", proto=http' }), { mode: 'lan', hosts: [] }).ok, true);
  assert.equal(studioAllowed(req('8.8.8.8', { 'x-forwarded-for': '127.0.0.1' }), { mode: 'lan', hosts: [] }).ok, false, 'a public peer, whatever it claims');
  // SP_STUDIO=local: this machine only — the peer and every forwarded address (a LAN peer claiming 127.0.0.1 is refused)
  assert.equal(studioAllowed(req('192.168.1.20', { 'x-forwarded-for': '127.0.0.1' }), { mode: 'local', hosts: [] }).ok, false);
  assert.equal(studioAllowed(req('192.168.1.20', { 'x-real-ip': '::1' }), { mode: 'local', hosts: [] }).ok, false);
  assert.equal(studioAllowed(req('127.0.0.1', { 'x-forwarded-for': '192.168.1.20' }), { mode: 'local', hosts: [] }).ok, false);
  // a Host that is a public address (a port forward, a tunnel's public IP) is no local name
  assert.equal(studioAllowed(req('127.0.0.1', { host: '203.0.113.5:7000' }), { mode: 'lan', hosts: [] }).ok, false);
  assert.equal(studioAllowed(req('127.0.0.1', { host: '[2001:db8::1]:3000' }), { mode: 'lan', hosts: [] }).ok, false);
  // SP_STUDIO=local: this machine only; off: nobody
  assert.equal(studioAllowed(req('192.168.1.20'), { mode: 'local', hosts: [] }).ok, false);
  assert.equal(studioAllowed(req('127.0.0.1'), { mode: 'local', hosts: [] }).ok, true);
  assert.equal(studioAllowed(req('127.0.0.1'), { mode: 'off', hosts: [] }).ok, false);
  assert.deepEqual([studioMode({}), studioMode({ SP_STUDIO: 'off' }), studioMode({ SP_STUDIO: 'local' }), studioMode({ SP_STUDIO: '0' })], ['lan', 'off', 'local', 'off']);
  // Host names: addresses and local names only (a public name pointed at this machine — DNS rebinding — is refused)
  for (const h of ['localhost:3000', '127.0.0.1:3000', '[::1]:3000', '192.168.1.5', 'mypc:3000', 'nas.local', 'game.lan', 'x.home.arpa', 'a.localhost']) assert.equal(isLocalHost(h), true, h);
  for (const h of ['evil.example.com', 'example.com:3000', '', 'a b', 'localhost.evil.com', '8.8.8.8:3000', '[2606:4700::1111]']) assert.equal(isLocalHost(h), false, h);
  assert.equal(isLocalHost('play.example.org', ['play.example.org']), true, 'SP_STUDIO_HOSTS adds a name');
  assert.equal(studioAllowed(req('127.0.0.1', { host: 'evil.example.com' }), { mode: 'lan', hosts: [] }).ok, false);
  assert.equal(hostName('[::1]:80'), '::1');
  // a change: the header, the same origin
  assert.equal(isStudioChange({ headers: { host: 'localhost:3000', 'x-sp-studio': '1' } }), true);
  assert.equal(isStudioChange({ headers: { host: 'localhost:3000', 'x-sp-studio': '1', origin: 'http://localhost:3000', 'sec-fetch-site': 'same-origin' } }), true);
  assert.equal(isStudioChange({ headers: { host: 'localhost:3000' } }), false, 'no header');
  assert.equal(isStudioChange({ headers: { host: 'localhost:3000', 'x-sp-studio': '1', origin: 'http://evil.example.com' } }), false, 'another origin');
  assert.equal(isStudioChange({ headers: { host: 'localhost:3000', 'x-sp-studio': '1', 'sec-fetch-site': 'cross-site' } }), false);
});

test('files: confined to plugins/<id>/ — ids, paths, links, types, sizes; a write is atomic', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-studio-files-'));
  try {
    const plugins = path.join(dir, 'plugins');
    const f = createPluginFiles(plugins);
    const code = (fn) => { try { fn(); return null; } catch (e) { return e instanceof StudioError ? `${e.code}:${e.status}` : String(e); } };
    assert.equal(code(() => f.root('ab', { create: true })), null);
    assert.equal(code(() => f.root('ab', { create: true })), 'PLUGIN_STUDIO_EXISTS:409');
    assert.equal(code(() => f.root('AB', { create: true })), 'PLUGIN_ID:400', 'upper case is no plugin id');
    for (const bad of ['_template', '.git', '../x', 'A', 'a/b', 'x', 'a']) assert.match(code(() => f.root(bad, { create: true })), /^PLUGIN_ID:400$/, bad);
    assert.equal(code(() => f.root('nope')), 'PLUGIN_UNKNOWN:404');
    f.write('ab', 'art/x.png', png());
    assert.ok(fs.existsSync(path.join(plugins, 'ab', 'art', 'x.png')));
    assert.deepEqual(fs.readdirSync(path.join(plugins, 'ab', 'art')), ['x.png'], 'no temporary file left');
    for (const rel of ['../b.png', 'art/../../b.png', '.hidden.png', 'art/.x/y.png', '/abs.png', 'a\\b.png', ' sp.png', 'x'.repeat(201) + '.png']) {
      assert.match(code(() => f.write('ab', rel, png())), /^PLUGIN_STUDIO_PATH:400$/, rel);
    }
    assert.equal(code(() => f.write('ab', 'run.exe', Buffer.from('x'))), 'PLUGIN_FILE_TYPE:400');
    assert.equal(code(() => f.write('ab', 'plugin.lock.json', Buffer.from('{}'))), 'PLUGIN_FILE_TYPE:400', 'the lock is the packer\'s');
    assert.equal(code(() => f.write('ab', 'plugin.json', Buffer.alloc(1024 * 1024 + 1, 32))), 'PLUGIN_STUDIO_SIZE:413');
    // links: a link inside the folder (to a file or a folder outside) is never followed, for reading or writing
    const outside = path.join(dir, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'secret.png'), 'secret');
    fs.symlinkSync(path.join(outside, 'secret.png'), path.join(plugins, 'ab', 'link.png'));
    fs.symlinkSync(outside, path.join(plugins, 'ab', 'out'));
    assert.equal(code(() => f.stat('ab', 'link.png')), 'PLUGIN_STUDIO_PATH:403');
    assert.equal(code(() => f.write('ab', 'link.png', png())), 'PLUGIN_STUDIO_PATH:403');
    assert.equal(code(() => f.write('ab', 'out/new.png', png())), 'PLUGIN_STUDIO_PATH:403');
    assert.equal(code(() => f.remove('ab', 'out/secret.png')), 'PLUGIN_STUDIO_PATH:403');
    assert.equal(fs.readFileSync(path.join(outside, 'secret.png'), 'utf8'), 'secret', 'nothing outside was touched');
    assert.deepEqual(fs.readdirSync(outside), ['secret.png']);
    // a plugin folder that is itself a link (an archive unpacked into plugins/ can bring one, to anywhere) is never a root
    // of the studio: every read and write refused, nothing of the target read or written; listed apart (links)
    const real = path.join(dir, 'elsewhere');
    fs.mkdirSync(real);
    fs.writeFileSync(path.join(real, 'secret.json'), '{"s":"SECRET"}');
    fs.symlinkSync(real, path.join(plugins, 'linked'));
    for (const fn of [() => f.root('linked'), () => f.stat('linked', 'secret.json'), () => f.resolve('linked', 'secret.json'), () => f.write('linked', 'a.png', png()),
      () => f.remove('linked', 'secret.json'), () => f.list('linked'), () => f.readSidecar('linked', '.studio.json'), () => f.writeSidecar('linked', '.studio.json', Buffer.from('{}')),
      () => f.moveOut('linked', 'secret.json')]) {
      assert.equal(code(fn), 'PLUGIN_STUDIO_PATH:403', String(fn));
    }
    assert.deepEqual(fs.readdirSync(real), ['secret.json'], 'nothing written into the target, nothing removed from it');
    assert.deepEqual([f.ids().includes('linked'), f.links()], [false, ['linked']]);
    // remove: plain files, empty folders go with them, never plugin.json
    f.write('ab', 'plugin.json', Buffer.from('{}'));
    assert.equal(code(() => f.remove('ab', 'plugin.json')), 'PLUGIN_STUDIO_PATH:400');
    f.remove('ab', 'art/x.png');
    assert.equal(fs.existsSync(path.join(plugins, 'ab', 'art')), false);
    assert.deepEqual([f.ids(), f.links()], [['ab'], ['linked']], 'the folders the studio opens; the links apart');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the walk of a plugin folder is bounded (folders, depth, entries read): a folder over a limit is refused — the registry, the lock, the zip', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-walk-'));
  try {
    const p = path.join(dir, 'deep');
    writePlugin(p, cosmetic({ assets: { chars: { char_102_texas: { avatar: 'a.png' } } } }), { 'a.png': png(), 'a/b/c/x.txt': 'x' });
    assert.equal(listPluginFiles(p).truncated, undefined, 'within the limits: no flag');
    assert.equal(listPluginFiles(p, { maxDepth: 2 }).truncated, 'depth');
    assert.equal(listPluginFiles(p, { maxDirs: 2 }).truncated, 'dirs');
    assert.equal(listPluginFiles(p, { maxEntries: 3 }).truncated, 'entries');
    assert.deepEqual(Object.keys(listPluginFiles(p, { maxDepth: 2 })).length, listPluginFiles(p, { maxDepth: 2 }).length, 'the flag is no entry of the list');
    // the real limits: folders one level deeper than WALK_LIMITS.depth
    fs.mkdirSync(path.join(p, ...Array.from({ length: WALK_LIMITS.depth + 1 }, (_, i) => `d${i}`)), { recursive: true });
    const r = readPluginFolder(p, { where: 'plugins/deep/' });
    assert.equal(r.plugin, null);
    assert.ok(r.issues.some((i) => i.code === 'PLUGIN_FILE_SIZE' && i.text.includes(`deeper than ${WALK_LIMITS.depth} levels`)), JSON.stringify(r.problems));
    assert.equal(buildPluginLock(p).lock, null, 'no lock');
    assert.throws(() => zipPlugin(p), (e) => e.code === 'PLUGIN_FILE_SIZE', 'no zip');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('isStudioPath: every spelling a static server would map to public/studio/', () => {
  for (const p of ['/studio', '/studio/', '/Studio/x', '//studio/', '/%73tudio/', '/STUDIO', '/studio%2Fapi', '/%C5%BFtudio/', '/ｓｔｕｄｉｏ/']) assert.equal(isStudioPath(p), true, p);
  for (const p of ['/', '/studios/', '/js/studio.js', '/studio.html', '/%E0%A4%A']) assert.equal(isStudioPath(p), false, p);
});

test('suggestId: from Latin letters of the name, else from the target and the template; free and legal', () => {
  const taken = new Set(['texas-art']);
  assert.equal(suggestId({ name: 'Red Texas!' }, taken), 'red-texas');
  assert.equal(suggestId({ name: '红色德克萨斯', target: { key: 'char_102_texas' }, template: 'art' }, taken), 'texas-art-2');
  assert.equal(suggestId({ name: '', target: { key: 'enemy_1007_slime' }, template: 'spine' }, new Set()), 'slime-spine');
  assert.equal(suggestId({ name: '音乐' }, new Set()), 'plugin');
  assert.match(suggestId({ name: 'x'.repeat(80) }, new Set()), /^[a-z0-9][a-z0-9-]{1,31}$/);
});

test('zip: deterministic (the same files give the same bytes), stored media, deflated text, a round trip', () => {
  const files = [{ name: 'p/b.png', data: png(8, 8) }, { name: 'p/plugin.json', data: Buffer.from(JSON.stringify({ a: 'x'.repeat(500) })) }, { name: 'p/中文.md', data: Buffer.from('说明') }];
  const a = zipFiles(files);
  const b = zipFiles([...files].reverse());
  assert.ok(a.equals(b), 'order and time do not matter');
  const back = unzipFiles(a);
  assert.deepEqual(back.map((e) => e.name), ['p/b.png', 'p/plugin.json', 'p/中文.md']);
  for (const e of back) assert.ok(e.data.equals(files.find((f) => f.name === e.name).data), e.name);
  assert.ok(a.length < files.reduce((n, f) => n + f.data.length, 0) + 400, 'the JSON was deflated');
});

describe('the studio over HTTP', () => {
  let srv;
  let tmp;
  let plugins;
  /** The headers of a change: the studio's key (server/studio/key.js), JSON. */
  let H;
  let KEY;
  const call = async (method, url, body, headers = H) => {
    const r = await fetch(srv.url + url, { method, headers, body: body === undefined ? undefined : typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body) });
    const type = r.headers.get('content-type') || '';
    return { status: r.status, body: type.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()), headers: r.headers };
  };
  /** A raw request (any Host header, a body over its declared length). */
  const raw = (method, url, headers = {}, body = null) => new Promise((resolve, reject) => {
    const u = new URL(srv.url + url);
    const r = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
  const b64 = (buf) => Buffer.from(buf).toString('base64');

  before(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-studio-http-'));
    plugins = path.join(tmp, 'plugins');
    writePlugin(path.join(plugins, 'handmade'), cosmetic({ colour: 'red', assets: { chars: { char_102_texas: { avatar: 'a.png' } } } }), { 'a.png': png(), 'notes.psd': 'x' });
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, pluginsDir: plugins, assetIndex: false });
    KEY = srv.studio.key;
    H = { 'x-sp-studio': KEY, 'content-type': 'application/json' };
  });
  after(async () => { await srv?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

  test('the page and every API route answer 404 to a foreign Host, a forwarded public client, a change without the header', async () => {
    assert.equal((await raw('GET', '/studio/')).status, 200);
    assert.equal((await raw('GET', '/studio')).status, 301);
    for (const url of ['/studio/', '/studio/api/info', '/studio/api/plugins', '/studio/js/main.js', '/studio/studio.css']) {
      assert.equal((await raw('GET', url, { host: 'evil.example.com' })).status, 404, `${url}: foreign Host`);
      assert.equal((await raw('GET', url, { 'x-forwarded-for': '203.0.113.9' })).status, 404, `${url}: forwarded public client`);
    }
    const page = await raw('GET', '/studio/api/info', { 'x-forwarded-for': '203.0.113.9' });
    assert.match(page.text, /页面不存在 · Not found/, 'the same page as any missing one');
    // changes: the header, the studio's own origin; OPTIONS (a preflight) gets no answer that allows anything
    assert.equal((await raw('POST', '/studio/api/plugins', { 'content-type': 'application/json' }, '{}')).status, 404, 'no X-SP-Studio');
    assert.equal((await raw('POST', '/studio/api/plugins', { 'x-sp-studio': '1', origin: 'http://evil.example.com' }, '{}')).status, 404, 'another origin');
    const pre = await raw('OPTIONS', '/studio/api/plugins', { origin: 'http://evil.example.com', 'access-control-request-method': 'POST' });
    assert.ok(pre.status === 404 || pre.status === 405, `preflight ${pre.status}`);
    assert.equal((await raw('DELETE', '/studio/api/plugins/handmade/files/a.png', { 'x-forwarded-for': '203.0.113.9', 'x-sp-studio': '1' })).status, 404);
    assert.ok(fs.existsSync(path.join(plugins, 'handmade', 'a.png')), 'nothing was removed');
    // another spelling of the prefix never reaches the page — neither through the studio nor through the static mounts
    for (const url of ['/Studio/', '/STUDIO/api/info', '//studio/', '/%73tudio/', '/studio%2Fapi/info', '//studio/js/main.js']) {
      assert.equal((await raw('GET', url)).status, 404, url);
    }
    // the game's pages are untouched by the studio's routes
    assert.equal((await raw('GET', '/')).status, 200);
    assert.equal((await raw('POST', '/')).status, 405);
  });

  test('a server without a studio (startServer studio: false) never serves its page as a static file', async () => {
    const other = await startServer({ port: 0, host: '127.0.0.1', quiet: true, pluginsDir: plugins, assetIndex: false, studio: false });
    try {
      for (const u of ['/studio/', '/studio/index.html', '/studio/js/main.js', '/Studio/', '/studio']) assert.equal((await fetch(other.url + u)).status, 404, u);
      assert.equal(other.studio, null);
    } finally { await other.close(); }
  });

  test('a new plugin from a template; files on a slot; a reference; a slot emptied; the preview; pack and zip; the list', async () => {
    const info = await call('GET', '/studio/api/info');
    assert.deepEqual(info.body.templates.map((t) => t.id), ['art', 'spine', 'voice', 'audio', 'numbers', 'operator', 'dsl', 'meta', 'mode', 'ui', 'script', 'bond', 'item', 'trait', 'offers', 'rules', 'theme', 'notices', 'fx', 'skins']);
    const found = await call('GET', `/studio/api/targets?q=${encodeURIComponent('德克萨斯')}&kinds=operator`);
    assert.equal(found.body.targets[0].key, 'char_102_texas');
    const slots = await call('GET', '/studio/api/slots?template=art&target=operator:char_102_texas');
    assert.deepEqual(slots.body.slots.map((s) => s.field), ['avatar', 'avatarE2', 'portrait', 'portraitE2']);
    let r = await call('POST', '/studio/api/plugins', { template: 'art', id: 'red-texas', name: '红色德克萨斯', target: 'operator:char_102_texas', authors: ['me'], license: 'CC-BY-4.0' });
    assert.equal(r.status, 201);
    assert.deepEqual([r.body.loaded, r.body.check.ok, r.body.sections], [true, true, [{ template: 'art', target: 'operator:char_102_texas' }]]);
    const m0 = JSON.parse(fs.readFileSync(path.join(plugins, 'red-texas', 'plugin.json'), 'utf8'));
    assert.deepEqual([m0.manifest, m0.class, m0.name, m0.license, m0.assets], [2, 'cosmetic', { zh: '红色德克萨斯' }, 'CC-BY-4.0', { chars: { char_102_texas: { avatar: 'art/char_102_texas/avatar.png' } } }]);
    assert.equal((await call('POST', '/studio/api/plugins', { template: 'art', id: 'red-texas', name: 'x' })).body.error, 'PLUGIN_STUDIO_EXISTS');
    assert.equal((await call('POST', '/studio/api/plugins', { template: 'nope', id: 'zz-1' })).body.error, 'PLUGIN_STUDIO_TEMPLATE');
    assert.equal((await call('POST', '/studio/api/plugins', { template: 'voice', id: 'zz-2', target: 'music:lobby' })).body.error, 'PLUGIN_STUDIO_TARGET');
    // a picture on the avatar slot: art/<key>/avatar.png, the overlay set, loaded at once
    r = await call('POST', '/studio/api/plugins/red-texas/slot', { at: ['chars', 'char_102_texas', 'avatar'], files: [{ name: 'my red.PNG', data: b64(png(4, 4, [255, 0, 0, 255])) }] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.overlay, { chars: { char_102_texas: { avatar: 'art/char_102_texas/avatar.png' } } });
    assert.equal(r.body.loaded, true);
    // the same slot, a WebP: the old PNG goes, the new file takes its place
    r = await call('POST', '/studio/api/plugins/red-texas/slot', { at: ['chars', 'char_102_texas', 'avatar'], files: [{ name: 'b.webp', data: b64(Buffer.from('RIFF....WEBP')) }] });
    assert.deepEqual(r.body.files.filter((f) => f.rel.startsWith('art/')).map((f) => f.rel), ['art/char_102_texas/avatar.webp']);
    // the wrong kind of file for a slot
    const wrong = await call('POST', '/studio/api/plugins/red-texas/slot', { at: ['chars', 'char_102_texas', 'portrait'], files: [{ name: 'a.mp3', data: b64('x') }] });
    assert.deepEqual([wrong.status, wrong.body.error], [400, 'PLUGIN_STUDIO_FILE_KIND']);
    // a reference, then the slot emptied
    r = await call('POST', '/studio/api/plugins/red-texas/ref', { at: ['chars', 'char_102_texas', 'portrait'], ref: 'char_112_siege' });
    assert.deepEqual(r.body.overlay.chars.char_102_texas.portrait, { ref: 'char_112_siege' });
    r = await call('POST', '/studio/api/plugins/red-texas/ref', { at: ['chars', 'char_102_texas', 'portraitE2'], ref: 'char_000_nobody' });
    assert.ok(r.body.check.issues.some((i) => i.code === 'PLUGIN_REF' && i.at.join('.') === 'assets.chars.char_102_texas.portraitE2'), 'the finding beside its slot');
    r = await call('POST', '/studio/api/plugins/red-texas/clear', { at: ['chars', 'char_102_texas', 'portraitE2'] });
    assert.equal(r.body.check.ok, true);
    // the preview: the plugin's file at the studio's URL, the reference to copy, a draft's too
    const pv = await call('GET', '/studio/api/plugins/red-texas/preview');
    assert.deepEqual(pv.body.ops.map((o) => [o.at.join('.'), o.value ? 'value' : 'from']), [['chars.char_102_texas.avatar', 'value'], ['chars.char_102_texas.portrait', 'from']]);
    assert.match(pv.body.ops[0].value, /^\/studio\/api\/plugins\/red-texas\/f\/[0-9a-f]{8}\/art\/char_102_texas\/avatar\.webp$/);
    assert.equal((await call('GET', pv.body.ops[0].value)).status, 200);
    // meta: the basic fields
    r = await call('POST', '/studio/api/plugins/red-texas/meta', { fields: { version: '1.0.1', credits: '我自己画的', scope: ['personal'] }, lang: 'zh' });
    assert.equal(r.body.version, '1.0.1');
    const m1 = JSON.parse(fs.readFileSync(path.join(plugins, 'red-texas', 'plugin.json'), 'utf8'));
    assert.deepEqual([m1.version, m1.credits, m1.scope], ['1.0.1', '我自己画的', ['personal']]);
    assert.equal((await call('POST', '/studio/api/plugins/red-texas/meta', { fields: { version: '1.0' } })).body.error, 'PLUGIN_VERSION');
    // pack: the lock; the zip: every file under <id>/, the same bytes twice
    r = await call('POST', '/studio/api/plugins/red-texas/pack', {});
    assert.deepEqual([r.body.pack.wrote, r.body.check.ok, r.body.lock.present, r.body.lock.fresh], [true, true, true, true]);
    const z1 = await call('GET', '/studio/api/plugins/red-texas/zip');
    assert.equal(z1.headers.get('content-disposition'), 'attachment; filename="red-texas-1.0.1.zip"');
    assert.deepEqual(unzipFiles(z1.body).map((e) => e.name), ['red-texas/README.md', 'red-texas/art/char_102_texas/avatar.webp', 'red-texas/plugin.json', 'red-texas/plugin.lock.json']);
    assert.ok((await call('GET', '/studio/api/plugins/red-texas/zip')).body.equals(z1.body), 'deterministic');
    const list = await call('GET', '/studio/api/plugins');
    assert.deepEqual(list.body.plugins.map((p) => [p.id, p.status, p.codes]), [['handmade', 'skipped', ['PLUGIN_FILE_TYPE']], ['red-texas', 'loaded', []]], 'the hand-made one keeps a .psd: skipped, with its code');
  });

  test('a hand-made plugin: its sections read off its overlay; the findings coded; one-click fixes; a file type moved out, never deleted', async () => {
    let r = await call('GET', '/studio/api/plugins/handmade');
    assert.deepEqual(r.body.sections, [{ template: 'art', target: 'operator:char_102_texas' }]);
    assert.deepEqual(r.body.check.issues.map((i) => i.code).sort(), ['PLUGIN_FIELD_UNKNOWN', 'PLUGIN_FILE_TYPE']);
    assert.equal(r.body.loaded, false, 'the .psd keeps it out');
    r = await call('POST', '/studio/api/plugins/handmade/fix', { code: 'PLUGIN_FIELD_UNKNOWN', at: ['colour'] });
    assert.deepEqual(r.body.fixed, { code: 'PLUGIN_FIELD_UNKNOWN', did: 'removed "colour"' });
    r = await call('POST', '/studio/api/plugins/handmade/fix', { code: 'PLUGIN_FILE_TYPE', file: 'notes.psd' });
    assert.equal(r.body.loaded, true);
    assert.equal(fs.readFileSync(path.join(plugins, '_moved', 'handmade', 'notes.psd'), 'utf8'), 'x', 'moved into plugins/_moved/ (never read by the registry)');
    assert.equal((await call('POST', '/studio/api/plugins/handmade/fix', { code: 'PLUGIN_VERSION_X' })).body.error, 'PLUGIN_STUDIO_REQUEST');
    // a missing permission fixed in one click
    fs.writeFileSync(path.join(plugins, 'handmade', 'plugin.json'), JSON.stringify(cosmetic({ permissions: [], assets: { chars: { char_102_texas: { avatar: 'a.png' } } } })));
    r = await call('GET', '/studio/api/plugins/handmade');
    const miss = r.body.check.issues.find((i) => i.code === 'PLUGIN_PERMISSION_MISSING');
    r = await call('POST', '/studio/api/plugins/handmade/fix', { code: miss.code, at: miss.at, params: miss.params });
    assert.deepEqual([r.body.check.ok, r.body.manifest.permissions], [true, ['assets.override']]);
  });

  test('a model on a slot: one name for the skeleton and its atlas, the pages by theirs, textures from the atlas; previewed before it is packed', async () => {
    await call('POST', '/studio/api/plugins', { template: 'spine', id: 'model', name: 'model', target: 'operator:char_102_texas' });
    const r = await call('POST', '/studio/api/plugins/model/slot', { at: ['chars', 'char_102_texas', 'spine', 'front'], files: [
      { name: 'exported.skel', data: b64(skel()) }, { name: 'whatever.atlas', data: b64(atlas(['page one.png'])) }, { name: 'page one.png', data: b64(png()) }] });
    assert.deepEqual(r.body.overlay.chars.char_102_texas.spine.front, { skel: 'spine/char_102_texas/front/char_102_texas.skel', atlas: 'spine/char_102_texas/front/char_102_texas.atlas', textures: ['spine/char_102_texas/front/page one.png'] });
    assert.deepEqual(r.body.check.issues.map((i) => i.code), ['PLUGIN_LOCK_MISSING'], 'not packed yet');
    const pv = await call('GET', '/studio/api/plugins/model/preview');
    const sp = pv.body.ops[0].value;
    assert.deepEqual([sp.anims.idle, Object.keys(sp.animations).sort()], ['Idle', ['Attack', 'Die', 'Idle', 'Start']], 'the clips read from the skeleton itself');
    const hash = sp.skel.split('/')[5];
    assert.ok([sp.atlas, ...sp.textures].every((u) => u.split('/')[5] === hash), 'one folder for the model\'s files');
    const fixed = await call('POST', '/studio/api/plugins/model/fix', { code: 'PLUGIN_LOCK_MISSING' });
    assert.deepEqual([fixed.body.check.ok, fixed.body.loaded], [true, true]);
  });

  test('a music track: the loop, then its intro added to it; a new loop keeps the intro; an intro before any loop is refused', async () => {
    let r = await call('POST', '/studio/api/plugins', { template: 'audio', id: 'music-x', name: 'm', target: 'music:lobby' });
    assert.equal(r.status, 201);
    const at = ['audio', 'bgm', 'lobby'];
    const slot = (files) => call('POST', '/studio/api/plugins/music-x/slot', { at, files });
    assert.deepEqual(fs.readFileSync(path.join(plugins, 'music-x/music/lobby/loop.ogg')), fs.readFileSync(new URL('../../plugins/_template/cosmetic/media/sample.ogg', import.meta.url)));
    assert.equal((await call('POST', '/studio/api/plugins/music-x/clear', { at })).status, 200);
    r = await slot([{ name: 'i.mp3', data: b64('ID3a'), role: 'intro' }]);
    assert.deepEqual([r.status, r.body.error], [400, 'PLUGIN_STUDIO_REQUEST']);
    r = await slot([{ name: 'l.ogg', data: b64('OggS') }]);
    assert.deepEqual(r.body.overlay.audio.bgm.lobby, { loop: 'music/lobby/loop.ogg' });
    r = await slot([{ name: 'i.mp3', data: b64('ID3a'), role: 'intro' }]);
    assert.deepEqual(r.body.overlay.audio.bgm.lobby, { loop: 'music/lobby/loop.ogg', intro: 'music/lobby/intro.mp3' }, 'the intro added to the loop');
    r = await slot([{ name: 'l2.mp3', data: b64('ID3b') }]);
    assert.deepEqual(r.body.overlay.audio.bgm.lobby, { loop: 'music/lobby/loop.mp3', intro: 'music/lobby/intro.mp3' }, 'a new loop keeps the intro');
    assert.deepEqual(r.body.files.filter((f) => f.rel.startsWith('music/')).map((f) => f.rel), ['music/lobby/intro.mp3', 'music/lobby/loop.mp3'], 'the old loop removed');
    assert.equal(r.body.check.ok, true);
  });

  test('limits: a body over the limit is refused before it is read; a file the studio does not write; a path out of the folder', async () => {
    const big = await raw('POST', '/studio/api/plugins/model/slot', { 'x-sp-studio': KEY, 'content-type': 'application/json', 'content-length': String(400 * 1024 * 1024) });
    assert.equal(big.status, 413);
    assert.equal(JSON.parse(big.text).error, 'PLUGIN_STUDIO_SIZE');
    assert.equal((await call('PUT', '/studio/api/plugins/model/files/run.exe', 'x', { 'x-sp-studio': KEY })).body.error, 'PLUGIN_FILE_TYPE');
    assert.equal((await call('PUT', '/studio/api/plugins/model/files/..%2F..%2Fx.png', 'x', { 'x-sp-studio': KEY })).body.error, 'PLUGIN_STUDIO_PATH');
    assert.equal((await call('GET', '/studio/api/plugins/..%2Fx')).status, 400);
    assert.equal(fs.existsSync(path.join(tmp, 'x.png')), false);
  });

  test('links put into a plugin folder by hand: nothing is read or written through them (plugin.json, an overlay file, the lock, the studio\'s note, plugins/_moved)', async () => {
    const outside = path.join(tmp, 'outside');
    fs.mkdirSync(outside, { recursive: true });
    const SECRET = '{"name":"SECRET-NAME","chars":"SECRET-VALUE"}';
    const secret = path.join(outside, 'secret.json');
    fs.writeFileSync(secret, SECRET);
    const victim = path.join(outside, 'victim.txt');
    fs.writeFileSync(victim, 'keep me');
    const leaks = (body) => /SECRET/.test(JSON.stringify(body));
    // plugin.json itself a link: its text is never sent; the check names the link; an edit is refused; the zip leaves it out
    fs.mkdirSync(path.join(plugins, 'lnk-manifest'));
    fs.symlinkSync(secret, path.join(plugins, 'lnk-manifest', 'plugin.json'));
    let r = await call('GET', '/studio/api/plugins/lnk-manifest');
    assert.equal(r.status, 200);
    assert.equal(leaks(r.body), false, 'the state');
    assert.deepEqual([r.body.text, r.body.check.issues.map((i) => [i.code, i.file])], [null, [['PLUGIN_FILE_LINK', 'plugin.json']]]);
    for (const u of ['/studio/api/plugins', '/studio/api/plugins/lnk-manifest/preview']) assert.equal(leaks((await call('GET', u)).body), false, u);
    r = await call('POST', '/studio/api/plugins/lnk-manifest/meta', { fields: { version: '1.0.1' } });
    assert.deepEqual([r.status, r.body.error], [403, 'PLUGIN_STUDIO_PATH']);
    const z = await call('GET', '/studio/api/plugins/lnk-manifest/zip');
    assert.deepEqual(unzipFiles(z.body).map((e) => e.name), []);
    assert.equal(fs.readFileSync(secret, 'utf8'), SECRET);
    // an overlay file that is a link: never read through — the state, the preview and a pack say nothing of the file outside
    r = await call('POST', '/studio/api/plugins', { template: 'art', id: 'lnk-files', name: 'x', target: 'operator:char_102_texas' });
    assert.equal(r.status, 201);
    const dir = path.join(plugins, 'lnk-files');
    fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify(cosmetic({ assets: 'overlay.json' })));
    fs.symlinkSync(secret, path.join(dir, 'overlay.json'));
    r = await call('GET', '/studio/api/plugins/lnk-files');
    assert.equal(leaks(r.body), false, 'the state');
    assert.deepEqual(r.body.check.issues.map((i) => [i.code, i.file]), [['PLUGIN_FILE_LINK', 'overlay.json']]);
    assert.equal(leaks((await call('GET', '/studio/api/plugins/lnk-files/preview')).body), false, 'the preview');
    assert.equal(leaks((await call('POST', '/studio/api/plugins/lnk-files/pack', {})).body), false, 'a pack');
    fs.rmSync(path.join(dir, 'overlay.json'));
    fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify(cosmetic({ assets: { chars: { char_102_texas: {} } } })));
    // the studio's note and the lock as links to a file outside: saving and packing replace the link, never write through it
    fs.rmSync(path.join(dir, '.studio.json'));
    fs.symlinkSync(victim, path.join(dir, '.studio.json'));
    fs.rmSync(path.join(dir, 'plugin.lock.json'), { force: true });
    fs.symlinkSync(victim, path.join(dir, 'plugin.lock.json'));
    r = await call('POST', '/studio/api/plugins/lnk-files/sections', { sections: [{ template: 'art', target: 'operator:char_102_texas' }] });
    assert.equal(r.status, 200);
    r = await call('POST', '/studio/api/plugins/lnk-files/pack', {});
    assert.equal(r.body.pack.wrote, true);
    assert.equal(fs.readFileSync(victim, 'utf8'), 'keep me', 'nothing written through a link');
    assert.deepEqual([fs.lstatSync(path.join(dir, '.studio.json')).isFile(), fs.lstatSync(path.join(dir, 'plugin.lock.json')).isFile()], [true, true]);
    assert.equal(r.body.check.ok, true, 'the folder holds plain files again');
    // plugins/_moved a link to a folder outside: a file is never moved through it
    fs.writeFileSync(path.join(dir, 'notes.psd'), 'x');
    fs.rmSync(path.join(plugins, '_moved'), { recursive: true, force: true });
    fs.symlinkSync(outside, path.join(plugins, '_moved'));
    r = await call('POST', '/studio/api/plugins/lnk-files/fix', { code: 'PLUGIN_FILE_TYPE', file: 'notes.psd' });
    assert.deepEqual([r.status, r.body.error], [403, 'PLUGIN_STUDIO_PATH']);
    assert.ok(fs.existsSync(path.join(dir, 'notes.psd')), 'the file stays where it was');
    assert.deepEqual(fs.readdirSync(outside).sort(), ['secret.json', 'victim.txt']);
  });

  test('files a plugin folder holds are served sandboxed and only of the types the studio writes (no page or script put there by hand); HEAD answers like GET', async () => {
    const dir = path.join(plugins, 'lnk-files');
    fs.writeFileSync(path.join(dir, 'page.html'), '<script>alert(1)</script>');
    fs.writeFileSync(path.join(dir, 'pic.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    fs.writeFileSync(path.join(dir, 'x.js'), 'alert(1)');
    fs.writeFileSync(path.join(dir, 'a.png'), png());
    for (const f of ['page.html', 'pic.svg', 'x.js']) assert.equal((await raw('GET', `/studio/api/plugins/lnk-files/files/${f}`)).status, 404, f);
    const ok = await call('GET', '/studio/api/plugins/lnk-files/files/a.png');
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('content-security-policy'), "default-src 'none'; sandbox; frame-ancestors 'none'");
    assert.equal(ok.headers.get('x-content-type-options'), 'nosniff');
    for (const f of ['page.html', 'pic.svg', 'x.js']) fs.rmSync(path.join(dir, f));
    // HEAD: the read routes answer as GET does, without a body; the events stream is not opened
    for (const u of ['/studio/api/info', '/studio/api/plugins', '/studio/api/plugins/lnk-files', '/studio/api/events']) {
      const h = await raw('HEAD', u);
      assert.deepEqual([h.status, h.text], [200, ''], u);
    }
    const hz = await raw('HEAD', '/studio/api/plugins/lnk-files/zip');
    assert.deepEqual([hz.status, hz.text], [200, ''], 'HEAD of the zip builds none');
  });

  test('a plugin folder that is itself a link: the studio never opens it (403 for every read and change, with the key or without; listed apart, nothing of the target sent); the game may still load it and serves only the files its overlay names', async () => {
    const target = path.join(tmp, 'linked-target');
    writePlugin(target, cosmetic({ assets: { chars: { char_102_texas: { avatar: 'a.png' } } } }), { 'a.png': png(4, 4, [9, 9, 9, 255]), 'secret.json': '{"s":"LEAK-JSON"}', 'notes.txt': 'LEAK-TXT' });
    const before = fs.readdirSync(target).sort();
    fs.symlinkSync(target, path.join(plugins, 'linked-skin'));
    srv.packs.rescan();
    const leaks = (b) => /LEAK/.test(Buffer.isBuffer(b) ? b.toString('latin1') : JSON.stringify(b));
    const NO = {};
    for (const [m, u, h] of [['GET', 'linked-skin', NO], ['GET', 'linked-skin/files/secret.json', NO], ['GET', 'linked-skin/files/notes.txt', NO], ['GET', 'linked-skin/zip', NO],
      ['GET', 'linked-skin/preview', NO], ['GET', 'linked-skin', H], ['GET', 'linked-skin/zip', H], ['POST', 'linked-skin/pack', H], ['POST', 'linked-skin/sections', H],
      ['PUT', 'linked-skin/files/x.png', H], ['DELETE', 'linked-skin/files/notes.txt', H], ['POST', 'linked-skin/fix', H]]) {
      const r = await call(m, `/studio/api/plugins/${u}`, m === 'GET' ? undefined : '{"code":"PLUGIN_LOCK_MISSING"}', h);
      assert.deepEqual([r.status, r.body?.error], [403, 'PLUGIN_STUDIO_PATH'], `${m} ${u}`);
      assert.equal(leaks(r.body), false, `${m} ${u}`);
    }
    assert.deepEqual(fs.readdirSync(target).sort(), before, 'nothing written into the target, nothing removed');
    const list = await call('GET', '/studio/api/plugins');
    const item = list.body.plugins.find((x) => x.id === 'linked-skin');
    assert.deepEqual([item.linked, item.name], [true, 'linked-skin']);
    assert.equal(leaks(list.body), false);
    // the game's registry follows the owner's link (P1a) and serves only the files the overlay names
    const entry = srv.packs.plugin('linked-skin');
    assert.equal(entry?.status, 'loaded');
    const h8 = entry.visual.served.get('a.png').sha256.slice(0, 8);
    assert.equal((await raw('GET', `/p/linked-skin/${h8}/a.png`)).status, 200);
    for (const f of ['secret.json', 'notes.txt', 'plugin.json']) assert.equal((await raw('GET', `/p/linked-skin/${h8}/${f}`)).status, 404, f);
    fs.rmSync(path.join(plugins, 'linked-skin'));
    srv.packs.rescan();
  });

  test('a file system error answers with its code only — never the message, which names the absolute path', { skip: (process.platform === 'win32' || process.getuid?.() === 0) && 'needs a folder the server cannot write' }, async () => {
    let r = await call('POST', '/studio/api/plugins', { template: 'art', id: 'locked', name: 'x' });
    assert.equal(r.status, 201);
    const dir = path.join(plugins, 'locked');
    fs.chmodSync(dir, 0o500);
    try {
      r = await call('PUT', '/studio/api/plugins/locked/files/new.txt', 'x', { 'x-sp-studio': KEY });
      assert.deepEqual([r.status, r.body.error, r.body.params.detail, r.body.detail], [500, 'PLUGIN_UNREADABLE', 'EACCES', 'EACCES']);
      assert.doesNotMatch(JSON.stringify(r.body), /\//, 'no path in the answer');
    } finally { fs.chmodSync(dir, 0o755); }
  });

  test('event streams: at most three from one address — a fourth ends the oldest (a browser keeps about six connections to a server)', async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const open = [];
    try {
      for (let i = 0; i < 4; i++) {
        const ctl = new AbortController();
        const res = await fetch(`${srv.url}/studio/api/events`, { signal: ctl.signal });
        const reader = res.body.getReader();
        await reader.read(); // hello
        open.push({ ctl, reader });
      }
      // the oldest ends (an event of a change may come before its end)
      let ended = false;
      for (const until = Date.now() + 2000; !ended && Date.now() < until;) {
        const r = await Promise.race([open[0].reader.read(), wait(until - Date.now()).then(() => null)]);
        if (!r) break;
        ended = r.done;
      }
      assert.equal(ended, true, 'the oldest stream was ended');
      // the newest stays (nothing, or an event of a change, arrives — never its end)
      const last = await Promise.race([open[3].reader.read(), wait(300).then(() => ({ done: 'still open' }))]);
      assert.notEqual(last.done, true);
    } finally { for (const o of open) o.ctl.abort(); }
  });

  test('the key (server/studio/key.js): a change without it is refused whatever the address; reads need none; info tells the page; the same key after a restart, printed with the studio\'s address', async () => {
    assert.match(KEY, /^[A-Za-z0-9_-]{22}$/);
    const file = path.join(plugins, '.studio-key');
    assert.equal(fs.readFileSync(file, 'utf8').trim(), KEY, 'kept in plugins/.studio-key');
    if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600, 'the owner\'s only');
    // a change: no header → the 404 page; another value → PLUGIN_STUDIO_KEY (the page asks for the key); nothing changed
    assert.equal((await raw('POST', '/studio/api/plugins', { 'content-type': 'application/json' }, '{}')).status, 404);
    const NOKEY = { 'x-sp-studio': '-', 'content-type': 'application/json' };
    const wrong = await call('POST', '/studio/api/plugins', { template: 'art', id: 'no-key', name: 'x' }, { ...NOKEY, 'x-sp-studio': 'A'.repeat(22) });
    assert.deepEqual([wrong.status, wrong.body.error], [403, 'PLUGIN_STUDIO_KEY']);
    assert.equal(fs.existsSync(path.join(plugins, 'no-key')), false);
    for (const [m, u] of [['PUT', '/studio/api/plugins/lnk-files/files/x.png'], ['DELETE', '/studio/api/plugins/lnk-files/files/README.md'], ['POST', '/studio/api/authors'], ['POST', '/studio/api/plugins/lnk-files/pack']]) {
      assert.equal((await call(m, u, '{}', NOKEY)).status, 403, `${m} ${u}`);
    }
    assert.ok(fs.existsSync(path.join(plugins, 'lnk-files', 'README.md')));
    // reads need none; info says whether the request carried it
    assert.equal((await raw('GET', '/studio/api/plugins')).status, 200);
    assert.equal((await call('GET', '/studio/api/info', undefined, {})).body.key, 'missing');
    assert.equal((await call('GET', '/studio/api/info', undefined, NOKEY)).body.key, 'wrong');
    assert.equal((await call('GET', '/studio/api/info')).body.key, 'ok');
    // the studio's page is never framed by another page
    const page = await call('GET', '/studio/', undefined, {});
    assert.deepEqual([page.headers.get('x-frame-options'), page.headers.get('content-security-policy')], ['DENY', "frame-ancestors 'none'"]);
    // the same key after a restart; the boot banner prints the studio's address with it
    const again = await startServer({ port: 0, host: '127.0.0.1', quiet: true, pluginsDir: plugins, assetIndex: false });
    try {
      assert.equal(again.studio.key, KEY);
      const lines = [];
      const log = console.log;
      console.log = (...a) => lines.push(a.join(' '));
      try { printBanner(again); } finally { console.log = log; }
      assert.ok(lines.some((l) => l.includes(`${again.url}/studio/#key=${KEY}`)), lines.join('\n'));
    } finally { await again.close(); }
  });

  test('corner cases: two track files at once (by name); a lone .skel only under the slot\'s own name; page names the atlas finds; a reference removes the slot\'s old files; a file moved out only when the plugin may not carry it; odd values; a body over the limit without a length; /ſtudio/', async () => {
    const at = ['audio', 'bgm', 'lobby'];
    let r = await call('POST', '/studio/api/plugins/music-x/slot', { at, files: [{ name: 'Main Loop.ogg', data: b64('OggS1') }, { name: 'intro part.ogg', data: b64('OggS2') }] });
    assert.deepEqual(r.body.overlay.audio.bgm.lobby, { loop: 'music/lobby/loop.ogg', intro: 'music/lobby/intro.ogg' }, 'the one named intro');
    r = await call('POST', '/studio/api/plugins/music-x/slot', { at, files: [{ name: 'a.ogg', data: b64('x') }, { name: 'b.ogg', data: b64('y') }] });
    assert.deepEqual([r.status, r.body.error], [400, 'PLUGIN_STUDIO_REQUEST'], 'never one silently dropped');
    // a model under the slot's own name: a new .skel alone keeps its atlas and pages
    const front = ['chars', 'char_102_texas', 'spine', 'front'];
    r = await call('POST', '/studio/api/plugins/model/slot', { at: front, files: [{ name: 'new.skel', data: b64(skel()) }] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.overlay.chars.char_102_texas.spine.front.textures, ['spine/char_102_texas/front/page one.png']);
    // a hand-made model elsewhere: a lone .skel is refused and nothing of the model goes
    writePlugin(path.join(plugins, 'hand-model'), cosmetic({ assets: { chars: { char_102_texas: { spine: { front: { skel: 'm/t.skel', atlas: 'm/t.atlas', textures: ['m/t.png'] } } } } } }),
      { 'm/t.skel': skel(), 'm/t.atlas': atlas(['t.png']), 'm/t.png': png() });
    r = await call('POST', '/studio/api/plugins/hand-model/slot', { at: front, files: [{ name: 'x.skel', data: b64(skel()) }] });
    assert.deepEqual([r.status, r.body.error], [400, 'PLUGIN_STUDIO_REQUEST']);
    assert.deepEqual(fs.readdirSync(path.join(plugins, 'hand-model', 'm')).sort(), ['t.atlas', 't.png', 't.skel']);
    // a page name the atlas could not find on disk: refused before anything is written
    r = await call('POST', '/studio/api/plugins/hand-model/slot', { at: front, files: [{ name: 'x.skel', data: b64(skel()) }, { name: 'x.atlas', data: b64(atlas(['page(1).png'])) }, { name: 'page(1).png', data: b64(png()) }] });
    assert.deepEqual([r.status, r.body.error], [400, 'PLUGIN_FILE_NAME']);
    assert.equal(fs.existsSync(path.join(plugins, 'hand-model', 'spine')), false);
    // a reference in place of a file: the file goes
    r = await call('POST', '/studio/api/plugins/music-x/ref', { at, ref: 'lobby' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(fs.readdirSync(path.join(plugins, 'music-x')).filter((n) => !n.startsWith('.')).sort(), ['README.md', 'plugin.json']);
    // moveOut: only a file the check finds of a type the plugin may not carry (never plugin.json)
    r = await call('POST', '/studio/api/plugins/music-x/fix', { code: 'PLUGIN_FILE_TYPE', file: 'plugin.json' });
    assert.deepEqual([r.status, r.body.error], [400, 'PLUGIN_STUDIO_REQUEST']);
    assert.ok(fs.existsSync(path.join(plugins, 'music-x', 'plugin.json')));
    // values that are not texts count as none
    r = await call('POST', '/studio/api/plugins', { template: 'art', id: 'odd-target', name: 'x', target: { toString: 1 } });
    assert.deepEqual([r.status, r.body.error], [404, 'PLUGIN_STUDIO_TARGET']);
    r = await call('POST', '/studio/api/plugins', { template: 'art', id: 'odd-values', name: { toString: 'x' }, authors: [{ toString: 1 }, 'me'], license: ['x'] });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.deepEqual([r.body.manifest.name, r.body.manifest.authors, r.body.manifest.license], [{ zh: 'odd-values' }, ['me'], undefined]);
    r = await call('POST', '/studio/api/plugins/odd-values/meta', { fields: { name: ['x'], authors: [{ a: 1 }, 'you'] } });
    assert.deepEqual([r.status, r.body.manifest.authors], [200, ['you']]);
    // a body over the limit without a Content-Length (chunked): the 413 answer, not a reset
    const big = await raw('POST', '/studio/api/authors', { 'x-sp-studio': KEY, 'content-type': 'application/json' }, `{"tokens":"${'x'.repeat(40 * 1024)}"}`);
    assert.deepEqual([big.status, JSON.parse(big.text).error], [413, 'PLUGIN_STUDIO_SIZE']);
    // another spelling a disk may fold into public/studio/ (the long s on macOS, a trailing dot on Windows) is no static file
    for (const u of ['/%C5%BFtudio/index.html', '/studio./index.html', '/%EF%BD%93tudio/index.html']) assert.equal((await raw('GET', u)).status, 404, u);
  });

  test('the dsl template: a content plugin with an operator and a prep spec, no cosmetic target', async () => {
    let r = await call('POST', '/studio/api/plugins', { template: 'dsl', id: 'demo-dsl', name: 'DSL demo', authors: ['me'] });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.check.ok, true, JSON.stringify(r.body.check));
    const dir = path.join(plugins, 'demo-dsl');
    assert.deepEqual(fs.readdirSync(dir).filter((n) => !n.startsWith('.')).sort(), ['README.md', 'dsl', 'operators', 'plugin.json']);
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8'));
    assert.deepEqual([m.class, m.permissions, m.operators, m.dsl], ['content', ['data.add', 'dsl'], ['operators/demo_dsl.json'], ['dsl/income.json']]);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'dsl/income.json'), 'utf8')).meta.key, 'effect:demo-dsl:income');
    r = await call('POST', '/studio/api/plugins', { template: 'dsl', id: 'demo-dsl-2', name: 'x', target: 'operator:char_102_texas' });
    assert.deepEqual([r.status, r.body.error], [400, 'PLUGIN_STUDIO_TARGET']);
  });
});
