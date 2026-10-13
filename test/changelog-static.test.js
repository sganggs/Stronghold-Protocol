// test/changelog-static.test.js — /changelog.md, the release notes the in-game 更新说明 dialog reads
// (public/js/ui/changelog.js, server/http/static.js).
//
// The contract this pins, and why it matters: CHANGELOG.md is the ONE file of the repository root the server exposes.
// Everything else in the repository — docs/ (the design document, the research notes) and server/ included — must stay
// unreachable, so this route is a named single file rather than another mount. The client and the server each name the
// URL in their own file, so the last test reads both and refuses to let them drift apart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createStaticHandler } from '../server/index.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The real handler, with the real directories unless a test overrides one. */
function serve(extra = {}) {
  const handler = createStaticHandler({
    publicDir: path.join(ROOT, 'public'),
    dataDir: path.join(ROOT, 'data'),
    sharedDir: path.join(ROOT, 'shared'),
    ...extra,
  });
  const srv = http.createServer((req, res) => {
    const [p, q] = req.url.split('?');
    handler(req, res, p, q || '');
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(srv)));
}

/** One request; `raw` keeps the body a Buffer (for the gzip case). */
function get(srv, url, { method = 'GET', headers = {}, raw = false } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: srv.address().port, path: url, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({ status: res.statusCode, headers: res.headers, body: raw ? buf : buf.toString('utf8') });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

test('/changelog.md serves the repository file as markdown, with ETag / 304 / gzip / HEAD', async () => {
  const srv = await serve();
  try {
    const disk = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
    const r = await get(srv, '/changelog.md');
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'], /text\/markdown/);
    assert.ok(r.headers.etag, 'a strong ETag (this is the same serveFile every other static file uses)');
    assert.equal(r.body, disk, 'byte for byte the repository file');
    assert.match(r.body, /^## \d+\.\d+\.\d+/, 'starts at the newest release heading the dialog splits on');

    const cached = await get(srv, '/changelog.md', { headers: { 'If-None-Match': r.headers.etag } });
    assert.equal(cached.status, 304);
    assert.equal(cached.body, '');

    const gz = await get(srv, '/changelog.md', { headers: { 'Accept-Encoding': 'gzip' }, raw: true });
    assert.equal(gz.status, 200);
    assert.equal(gz.headers['content-encoding'], 'gzip', 'the notes gzip like every other text file');
    assert.equal(zlib.gunzipSync(gz.body).toString('utf8'), disk);

    const head = await get(srv, '/changelog.md', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.body, '');

    // the URL is lower case by convention, but one named file has nothing to collide with: a hand-typed path works
    const upper = await get(srv, '/CHANGELOG.md');
    assert.equal(upper.status, 200);
    assert.equal(upper.body, disk);
  } finally {
    srv.close();
  }
});

test('no other part of the repository is reachable', async () => {
  const srv = await serve();
  try {
    for (const p of [
      '/docs/DESIGN.md',                  // the design document
      '/docs/history/0.2.5.md',           // the per-release design chapters, NOT a player-facing changelog
      '/docs/design/engine.md',
      '/changelog/0.2.5.md',              // there is no changelog directory mount
      '/changelog.md/',                   // …and no directory listing behind the single file
      '/package.json',
      '/server/http/static.js',
      '/CHANGELOG.md/../package.json',    // traversal out of the named file
      '/changelog.md%2F..%2Fpackage.json',
    ]) {
      const r = await get(srv, p);
      assert.ok([400, 403, 404].includes(r.status), `${p} → ${r.status} (must not be served)`);
    }
  } finally {
    srv.close();
  }
});

test('a checkout without CHANGELOG.md answers 404 instead of crashing the handler', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-nochangelog-'));
  const srv = await serve({ changelogFile: path.join(dir, 'CHANGELOG.md') });
  try {
    const r = await get(srv, '/changelog.md');
    assert.equal(r.status, 404);
    assert.match(r.body, /页面不存在/);
  } finally {
    srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the served file is injectable, so a packaged build can point it at its own notes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-notes-'));
  const file = path.join(dir, 'CHANGELOG.md');
  fs.writeFileSync(file, '## 9.9.9 — 2030-01-01\n\n- from a package\n');
  const srv = await serve({ changelogFile: file });
  try {
    const r = await get(srv, '/changelog.md');
    assert.equal(r.status, 200);
    assert.match(r.body, /## 9\.9\.9/);
  } finally {
    srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Regression: the route once matched the FILE name while the client asked for the lower-case URL, which the public
// mount answered with a 404 — the dialog never loaded. The two ends each name the path in their own file; this reads
// both so they cannot drift apart again.
test('the client asks for the exact URL the server answers', () => {
  const server = fs.readFileSync(path.join(ROOT, 'server/http/static.js'), 'utf8');
  const client = fs.readFileSync(path.join(ROOT, 'public/js/ui/changelog.js'), 'utf8');
  const url = /const CHANGELOG_URL = '([^']+)'/.exec(server)?.[1];
  assert.ok(url, 'server/http/static.js names its route in CHANGELOG_URL');
  assert.ok(client.includes(`'${url}'`), `public/js/ui/changelog.js fetches ${url}`);
});
