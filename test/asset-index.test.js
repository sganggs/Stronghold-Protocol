// Content-hashed asset URLs (host bandwidth, layer 1; docs/ASSETS.md "The served manifests"):
//   * server/http/assetIndex.js — SHA-256 (16 hex) of every file under public/assets and public/fonts, cached by path +
//     size + mtime in a JSON file, never trusted for a file whose size or mtime changed; Spine models share one hash;
//   * server/http/assetViews.js — the served data/assets.json / data/local-assets.json with every art URL carrying its
//     hash segment, the committed files untouched;
//   * the ~hash routes of static.js / media.js — the segment stripped, `immutable` only when it names the file's bytes,
//     the current file with `no-cache` otherwise; content ETags; the plain URLs as before.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { createAssetIndex, hash16 } from '../server/http/assetIndex.js';
import { rewriteManifest, relOf } from '../server/http/assetViews.js';
import { startServer } from '../server/index.js';

const sha16 = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16);
const IMMUTABLE = 'public, max-age=31536000, immutable';

function tree(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-hash-'));
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  return dir;
}

function get(port, p, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, headers, method, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

const until = async (fn, ms = 3000) => { for (const t0 = Date.now(); Date.now() - t0 < ms;) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 20)); } return false; };

describe('the asset index', () => {
  test('hashes every file under assets/ and fonts/ (dot names skipped, a linked folder followed), persists them, rehashes only what changed', async () => {
    const a = randomBytes(2000);
    const b = Buffer.from('atlas text\n'.repeat(50));
    const dir = tree({
      'public/assets/char/a.png': a, 'public/assets/spine/x/x.atlas': b, 'public/assets/.hidden': 'h', 'public/assets/.git/obj': 'o',
      'public/fonts/f.woff2': 'font', 'public/js/app.js': 'not indexed', 'elsewhere/linked/l.png': 'linked',
    });
    fs.symlinkSync(path.join(dir, 'elsewhere/linked'), path.join(dir, 'public/assets/link'), 'dir');
    const cacheFile = path.join(dir, '.cache/asset-hashes.json');
    try {
      const idx = createAssetIndex({ publicDir: path.join(dir, 'public'), cacheFile, delayMs: 0 });
      assert.equal(idx.ready, false);
      idx.start();
      await idx.whenReady();
      assert.equal(idx.ready, true);
      const st = (rel) => fs.statSync(path.join(dir, 'public', rel));
      assert.equal(idx.hashOf('assets/char/a.png', st('assets/char/a.png')), sha16(a));
      assert.equal(idx.hashOf('assets/spine/x/x.atlas'), sha16(b));
      assert.equal(idx.hashOf('fonts/f.woff2'), sha16(Buffer.from('font')));
      assert.equal(idx.hashOf('assets/link/l.png'), sha16(Buffer.from('linked')), 'a linked folder is followed');
      assert.equal(idx.hashOf('assets/.hidden'), null, 'dot names are never served, never hashed');
      assert.equal(idx.hashOf('assets/.git/obj'), null);
      assert.equal(idx.hashOf('js/app.js'), null, 'only the asset folders');
      assert.equal(idx.size, 4);
      assert.equal(idx.stats().last.hashed, 4);
      assert.equal(idx.hashOf('assets/CHAR/A.PNG'), sha16(a), 'a name that differs only in case finds the file');
      // a stat that no longer matches: no hash (the caller serves the plain way)
      assert.equal(idx.hashOf('assets/char/a.png', { size: 1, mtimeMs: st('assets/char/a.png').mtimeMs }), null);
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      assert.equal(cached.version, 1);
      assert.deepEqual(cached.files['assets/char/a.png'], [a.length, st('assets/char/a.png').mtimeMs, sha16(a)]);
      idx.close();

      // a restart: the cache answers for the unchanged files; a changed file is hashed again; a removed one is dropped
      const a2 = randomBytes(2100);
      fs.writeFileSync(path.join(dir, 'public/assets/char/a.png'), a2);
      fs.rmSync(path.join(dir, 'public/fonts/f.woff2'));
      const idx2 = createAssetIndex({ publicDir: path.join(dir, 'public'), cacheFile, delayMs: 0 });
      idx2.start();
      await idx2.whenReady();
      assert.equal(idx2.stats().last.hashed, 1, 'only the changed file was read');
      assert.equal(idx2.stats().last.reused, 2);
      assert.equal(idx2.hashOf('assets/char/a.png'), sha16(a2));
      assert.equal(idx2.hashOf('fonts/f.woff2'), null);
      assert.equal(JSON.parse(fs.readFileSync(cacheFile, 'utf8')).files['fonts/f.woff2'], undefined);
      idx2.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('models: one hash for a skeleton, its atlas and pages; urlHashOk accepts the own or the model hash, nothing else', async () => {
    const dir = tree({ 'public/assets/s/x.skel': 'skel', 'public/assets/s/x.atlas': 'atlas', 'public/assets/s/x.png': 'png', 'public/assets/o.png': 'other' });
    try {
      const idx = createAssetIndex({ publicDir: path.join(dir, 'public'), delayMs: 0 });
      idx.start();
      await idx.whenReady();
      const trio = ['assets/s/x.skel', 'assets/s/x.atlas', 'assets/s/x.png'];
      const m = idx.modelHash(trio);
      assert.equal(m, hash16(['skel', 'atlas', 'png'].map((s) => sha16(Buffer.from(s))).join('\n')));
      assert.equal(idx.modelHash([...trio, 'assets/missing.png']), null, 'a member the index does not know: no model hash');
      const st = (rel) => fs.statSync(path.join(dir, 'public', rel));
      assert.equal(idx.urlHashOk('assets/s/x.atlas', st('assets/s/x.atlas'), m), false, 'not before the lists are known');
      idx.setModels([trio]);
      for (const rel of trio) assert.equal(idx.urlHashOk(rel, st(rel), m), true, rel);
      assert.equal(idx.urlHashOk('assets/s/x.png', st('assets/s/x.png'), sha16(Buffer.from('png'))), true, 'the own hash too');
      assert.equal(idx.urlHashOk('assets/o.png', st('assets/o.png'), m), false, 'not a member');
      assert.equal(idx.urlHashOk('assets/s/x.png', st('assets/s/x.png'), '0000000000000000'), false);
      assert.equal(idx.urlHashOk('assets/s/x.png', { size: 99, mtimeMs: 1 }, m), false, 'changed since: never immutable');
      idx.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('a served file the index no longer matches asks for a rescan (rate-limited); the new hash follows', async () => {
    const dir = tree({ 'public/assets/a.png': 'one' });
    try {
      let changes = 0;
      const idx = createAssetIndex({ publicDir: path.join(dir, 'public'), delayMs: 0, rescanGapMs: 50 });
      idx.onChange(() => changes++);
      idx.start();
      await idx.whenReady();
      assert.equal(changes, 1);
      const gen = idx.generation;
      fs.writeFileSync(path.join(dir, 'public/assets/a.png'), 'two!');
      assert.equal(idx.hashOf('assets/a.png', fs.statSync(path.join(dir, 'public/assets/a.png'))), null);
      idx.noteMiss('assets/a.png');
      idx.noteMiss('assets/a.png');
      assert.ok(await until(() => idx.generation > gen), 'rescanned');
      assert.equal(idx.hashOf('assets/a.png'), sha16(Buffer.from('two!')));
      assert.equal(changes, 2, 'one rescan for both misses');
      idx.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the served manifests (rewriteManifest)', () => {
  const H = { '/assets/char/a.png': 'aaaaaaaaaaaaaaaa', '/assets/audio/bgm/x.mp3': 'bbbbbbbbbbbbbbbb', '/fonts/f.woff2': 'cccccccccccccccc',
    '/assets/spine/x/x.skel': '1111111111111111', '/assets/spine/x/x.atlas': '2222222222222222', '/assets/spine/x/x.png': '3333333333333333',
    '/assets/local/spine/token/t/t.skel': '4444444444444444', '/assets/local/spine/token/t/t.atlas': '5555555555555555',
    '/assets/local/spine/token/t/t.png': '6666666666666666', '/assets/local/ui/battle/b.png': '7777777777777777' };
  const index = {
    hashOf: (rel) => H[`/${rel}`] || null,
    modelHash: (rels) => (rels.every((r) => H[`/${r}`]) ? hash16(rels.map((r) => H[`/${r}`]).join('\n')) : null),
  };

  test('data/assets.json: own hashes, one model hash per Spine object, unknown files and names left alone, the input untouched', () => {
    const doc = {
      version: 1, hash: 'a1b2c3d4e5f6', generator: 'tools/fetch-assets.mjs',
      chars: { c: { avatar: '/assets/char/a.png', portrait: '/assets/char/missing.png',
        spine: { front: { skel: '/assets/spine/x/x.skel', atlas: '/assets/spine/x/x.atlas', textures: ['/assets/spine/x/x.png'], pma: false, anims: { idle: 'Idle' } } } } },
      enemies: { e: { icon: '/assets/char/a.png', spineLocal: { group: 'spine/enemy/e', skel: 'e.skel', atlas: 'e.atlas', textures: ['e.png'] } } },
      audio: { bgm: { lobby: { loop: '/assets/audio/bgm/x.mp3' } } },
      fonts: { css: '/fonts/fonts.css', faces: { f: { woff2: '/fonts/f.woff2', family: 'F' } } },
    };
    const copy = JSON.parse(JSON.stringify(doc));
    const r = rewriteManifest(doc, 'assets.json', index);
    assert.deepEqual(doc, copy, 'the committed manifest object is not changed');
    const m = index.modelHash(['assets/spine/x/x.skel', 'assets/spine/x/x.atlas', 'assets/spine/x/x.png']);
    assert.equal(r.doc.chars.c.avatar, '/assets/~aaaaaaaaaaaaaaaa/char/a.png');
    assert.equal(r.doc.chars.c.portrait, '/assets/char/missing.png', 'no hash: the plain URL');
    assert.deepEqual(r.doc.chars.c.spine.front, { skel: `/assets/~${m}/spine/x/x.skel`, atlas: `/assets/~${m}/spine/x/x.atlas`, textures: [`/assets/~${m}/spine/x/x.png`], pma: false, anims: { idle: 'Idle' } });
    assert.deepEqual(r.doc.enemies.e.spineLocal, copy.enemies.e.spineLocal, 'spineLocal holds names, not URLs');
    assert.equal(r.doc.audio.bgm.lobby.loop, '/assets/~bbbbbbbbbbbbbbbb/audio/bgm/x.mp3', 'audio keeps /assets/…/audio/….mp3 (media.js makes it /media/~hash/…)');
    assert.equal(r.doc.fonts.faces.f.woff2, '/fonts/~cccccccccccccccc/f.woff2');
    assert.equal(r.doc.fonts.css, '/fonts/fonts.css');
    assert.equal(r.doc.hash, 'a1b2c3d4e5f6');
    assert.deepEqual(r.models, [['assets/spine/x/x.skel', 'assets/spine/x/x.atlas', 'assets/spine/x/x.png']]);
    assert.equal(r.hashed, 7);
    assert.equal(r.plain, 2);
  });

  test('data/local-assets.json: a spine/ group is one model, other groups own hashes', () => {
    const doc = { version: 1, source: 'local-client', count: 4, groups: {
      'spine/token/t': { 't.atlas': { path: '/assets/local/spine/token/t/t.atlas', kind: 'TextAsset' }, 't.png': { path: '/assets/local/spine/token/t/t.png', w: 4, h: 4 }, 't.skel': { path: '/assets/local/spine/token/t/t.skel' } },
      'ui/battle': { b: { path: '/assets/local/ui/battle/b.png', w: 2, h: 2, kind: 'Sprite' } },
    } };
    const r = rewriteManifest(doc, 'local-assets.json', index);
    const m = index.modelHash(['assets/local/spine/token/t/t.atlas', 'assets/local/spine/token/t/t.png', 'assets/local/spine/token/t/t.skel']);
    assert.ok(m);
    for (const [n, e] of Object.entries(r.doc.groups['spine/token/t'])) assert.equal(e.path, doc.groups['spine/token/t'][n].path.replace('/assets/', `/assets/~${m}/`), n);
    assert.equal(r.doc.groups['spine/token/t']['t.png'].w, 4);
    assert.deepEqual(r.doc.groups['ui/battle'].b, { path: '/assets/~7777777777777777/local/ui/battle/b.png', w: 2, h: 2, kind: 'Sprite' });
    assert.deepEqual([r.doc.version, r.doc.source, r.doc.count], [1, 'local-client', 4]);
    assert.equal(r.models.length, 1);
  });

  test('relOf: URL path → index path, refusing what the static server refuses', () => {
    assert.equal(relOf('/assets/a%20b.png'), 'assets/a b.png');
    assert.equal(relOf('/fonts/f.woff2'), 'fonts/f.woff2');
    for (const u of ['/data/x.json', '/assets/../x', '/assets//x', '/assets/x?v=1', '/assets/%E0%A4%A', 'assets/x', null]) assert.equal(relOf(u), null, String(u));
  });
});

describe('content-hashed URLs through a real server', () => {
  let srv;
  let dir;
  const png = randomBytes(3000);
  const mp3 = randomBytes(6000);
  const skel = Buffer.from('skel-binary'.repeat(80));
  const atlas = Buffer.from('x.png\nsize: 64,64\n'.repeat(30));
  const page = randomBytes(1500);
  const manifest = {
    version: 1, hash: 'abcdefabcdef',
    chars: { c: { avatar: '/assets/char/a.png', spine: { front: { skel: '/assets/spine/x/x.skel', atlas: '/assets/spine/x/x.atlas', textures: ['/assets/spine/x/x.png'], anims: { idle: 'Idle' } } } } },
    audio: { bgm: { lobby: { loop: '/assets/audio/bgm/lobby.mp3' } } },
    fonts: { css: '/fonts/fonts.css', faces: { f: { woff2: '/fonts/f.woff2' } } },
    stats: { note: 'a manifest large enough to be compressed '.repeat(40) },
  };
  const manifestText = JSON.stringify(manifest, null, 2);

  before(async () => {
    dir = tree({
      'secret.txt': 'TOP-SECRET-CONTENT',
      'public/index.html': '<p>hi</p>', 'public/assets/char/a.png': png, 'public/assets/audio/bgm/lobby.mp3': mp3,
      'public/assets/spine/x/x.skel': skel, 'public/assets/spine/x/x.atlas': atlas, 'public/assets/spine/x/x.png': page,
      'public/assets/spine/x/tiles.json': '{"t":1}', 'public/fonts/f.woff2': randomBytes(500), 'public/fonts/fonts.css': '@font-face{}',
      'data/assets.json': manifestText, 'data/config.json': '{}', 'shared/x.js': 'export const y = 2;',
    });
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, publicDir: path.join(dir, 'public'), dataDir: path.join(dir, 'data'),
      sharedDir: path.join(dir, 'shared'), assetIndex: { delayMs: 0 } });
    await srv.assetIndex.whenReady();
  });
  after(async () => {
    await srv?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const view = async () => JSON.parse((await get(srv.port, '/data/assets.json')).body);

  test('/data/assets.json is served with hashed URLs (no-cache, its own ETag, 304, gzip, HEAD); the committed file stays as it was', async () => {
    const r = await get(srv.port, '/data/assets.json');
    assert.equal(r.status, 200);
    assert.equal(r.headers['content-type'], 'application/json; charset=utf-8');
    assert.equal(r.headers['cache-control'], 'no-cache');
    assert.match(r.headers.etag, /^"[0-9a-f]{16}"$/);
    const v = JSON.parse(r.body);
    assert.equal(v.chars.c.avatar, `/assets/~${sha16(png)}/char/a.png`);
    assert.equal(v.audio.bgm.lobby.loop, `/assets/~${sha16(mp3)}/audio/bgm/lobby.mp3`);
    assert.match(v.fonts.faces.f.woff2, /^\/fonts\/~[0-9a-f]{16}\/f\.woff2$/);
    const m = hash16([skel, atlas, page].map(sha16).join('\n'));
    assert.deepEqual([v.chars.c.spine.front.skel, v.chars.c.spine.front.atlas, v.chars.c.spine.front.textures[0]],
      [`/assets/~${m}/spine/x/x.skel`, `/assets/~${m}/spine/x/x.atlas`, `/assets/~${m}/spine/x/x.png`]);
    assert.equal((await get(srv.port, '/data/assets.json', { 'if-none-match': r.headers.etag })).status, 304);
    const gz = await get(srv.port, '/data/assets.json', { 'accept-encoding': 'gzip' });
    assert.equal(gz.headers['content-encoding'], 'gzip');
    assert.notEqual(gz.headers.etag, r.headers.etag);
    const head = await get(srv.port, '/data/assets.json', {}, 'HEAD');
    assert.equal(head.status, 200);
    assert.equal(head.body.length, 0);
    assert.equal(fs.readFileSync(path.join(dir, 'data/assets.json'), 'utf8'), manifestText, 'never written');
    assert.equal((await get(srv.port, '/data/local-assets.json')).status, 200, 'an absent local manifest is still the empty stand-in');
    assert.deepEqual(JSON.parse((await get(srv.port, '/data/local-assets.json')).body).groups, {});
  });

  test('a hashed URL: immutable with a content ETag when the hash names the file; the current file with no-cache otherwise; plain URLs as before', async () => {
    const v = await view();
    const ok = await get(srv.port, v.chars.c.avatar);
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body, png);
    assert.equal(ok.headers['cache-control'], IMMUTABLE);
    assert.equal(ok.headers.etag, `"${sha16(png)}"`);
    const old = await get(srv.port, '/assets/~0000000000000000/char/a.png');
    assert.deepEqual(old.body, png, 'an old page still gets the file');
    assert.equal(old.headers['cache-control'], 'no-cache');
    const plain = await get(srv.port, '/assets/char/a.png');
    assert.equal(plain.headers['cache-control'], 'public, max-age=86400');
    assert.equal(plain.headers.etag, `"${sha16(png)}"`, 'a content ETag on the plain URL too (an mtime change alone is a 304)');
    assert.equal((await get(srv.port, '/assets/char/a.png', { 'if-none-match': `"${sha16(png)}"` })).status, 304);
    const font = await get(srv.port, v.fonts.faces.f.woff2);
    assert.equal(font.headers['cache-control'], IMMUTABLE);
    const query = await get(srv.port, '/assets/char/a.png?v=1');
    assert.match(query.headers['cache-control'], /immutable/, 'the old ?v= rule is kept');
  });

  test('a Spine model: skeleton, atlas, page and the atlas derived from the skeleton URL are immutable under the model hash; a file derived beside them is no-cache', async () => {
    const sp = (await view()).chars.c.spine.front;
    for (const u of [sp.skel, sp.atlas, sp.textures[0], sp.skel.replace(/\.skel$/, '.atlas')]) {
      const r = await get(srv.port, u);
      assert.equal(r.status, 200, u);
      assert.equal(r.headers['cache-control'], IMMUTABLE, u);
    }
    const sk = await get(srv.port, sp.skel);
    assert.deepEqual(sk.body, skel);
    assert.equal(sk.headers.etag, `"${sha16(skel)}"`, 'the ETag is the file\'s own content hash');
    const tiles = await get(srv.port, sp.skel.replace(/[^/]+$/, 'tiles.json'));
    assert.equal(tiles.status, 200);
    assert.equal(tiles.headers['cache-control'], 'no-cache', 'not a member of the model');
  });

  test('audio: /media/~hash/… resolves like /media/…, immutable when the hash matches, ranges and ETags as before', async () => {
    const loop = (await view()).audio.bgm.lobby.loop;
    const media = loop.replace(/^\/assets\/(~[0-9a-f]{16})\/audio\/(.+)\.mp3$/, '/media/$1/$2');
    assert.match(media, /^\/media\/~[0-9a-f]{16}\/bgm\/lobby$/);
    const r = await get(srv.port, media);
    assert.equal(r.status, 200);
    assert.equal(r.headers['content-type'], 'audio/mpeg');
    assert.equal(r.headers['cache-control'], IMMUTABLE);
    assert.equal(r.headers.etag, `"${sha16(mp3)}"`);
    assert.deepEqual(r.body, mp3);
    const range = await get(srv.port, media, { range: 'bytes=0-9' });
    assert.equal(range.status, 206);
    assert.deepEqual(range.body, mp3.subarray(0, 10));
    assert.equal((await get(srv.port, loop)).headers['cache-control'], IMMUTABLE, 'the .mp3 fallback URL too');
    assert.equal((await get(srv.port, '/media/~0000000000000000/bgm/lobby')).headers['cache-control'], 'no-cache');
    assert.equal((await get(srv.port, '/media/bgm/lobby')).headers['cache-control'], 'public, max-age=86400');
  });

  test('the segment never opens a way out of the served folders', async () => {
    const h = sha16(png);
    for (const p of [`/assets/~${h}/../../secret.txt`, `/assets/~${h}/%2e%2e/%2e%2e/secret.txt`, `/assets/~${h}/..%2f..%2fsecret.txt`,
      `/media/~${h}/..%2f..%2f..%2fsecret.txt`, `/fonts/~${h}/../../secret.txt`, `/assets/~${h}/.hidden`, `/assets/~${h}`, '/assets/~/char/a.png']) {
      const r = await get(srv.port, p);
      assert.ok([301, 400, 403, 404].includes(r.status), `${p} → ${r.status}`);
      assert.ok(!r.body.toString().includes('TOP-SECRET'), `${p} leaked`);
    }
  });

  test('a file replaced on disk: its old hashed URL turns no-cache at once, and after the rescan the view names the new bytes', async () => {
    const before = (await view()).chars.c.avatar;
    const next = randomBytes(3100);
    fs.writeFileSync(path.join(dir, 'public/assets/char/a.png'), next);
    const stale = await get(srv.port, before);
    assert.deepEqual(stale.body, next, 'the current file');
    assert.equal(stale.headers['cache-control'], 'no-cache', 'the index no longer vouches for these bytes');
    // the miss asked for a rescan (RESCAN_GAP_MS after the last build) — trigger it now instead of waiting
    await srv.assetIndex.refresh();
    assert.ok(await until(async () => (await view()).chars.c.avatar === `/assets/~${sha16(next)}/char/a.png`), 'the view follows');
    assert.equal((await get(srv.port, `/assets/~${sha16(next)}/char/a.png`)).headers['cache-control'], IMMUTABLE);
  });
});

test('without the index (assetIndex: false) the manifest goes out as committed and a hashed URL is served no-cache', async () => {
  const dir = tree({ 'public/assets/a.png': 'png', 'data/assets.json': JSON.stringify({ chars: { c: { avatar: '/assets/a.png' } } }) });
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, publicDir: path.join(dir, 'public'), dataDir: path.join(dir, 'data'), assetIndex: false });
  try {
    assert.equal(srv.assetIndex, null);
    assert.equal(JSON.parse((await get(srv.port, '/data/assets.json')).body).chars.c.avatar, '/assets/a.png');
    const r = await get(srv.port, `/assets/~${sha16(Buffer.from('png'))}/a.png`);
    assert.equal(r.status, 200);
    assert.equal(r.headers['cache-control'], 'no-cache');
    assert.match(r.headers.etag, /^"[0-9a-f]+-[0-9a-f]+"$/, 'size-mtime ETag');
  } finally {
    await srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
