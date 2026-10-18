// The optional local-client art manifest (data/local-assets.json, DESIGN §13): an install without it must get an
// empty manifest (200) instead of a 404, and an install with it must get the real file. The docs and the setup /
// doctor messages say what falls back without it (GitHub issue #42, DESIGN §22.5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createStaticHandler } from '../server/index.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function serve(dataDir) {
  const handler = createStaticHandler({ publicDir: path.join(ROOT, 'public'), dataDir, sharedDir: path.join(ROOT, 'shared') });
  const srv = http.createServer((req, res) => {
    const [p, q] = req.url.split('?');
    handler(req, res, p, q || '');
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(srv)));
}

function get(srv, url, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: srv.address().port, path: url, method }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('missing data/local-assets.json → 200 empty manifest (no 404 on installs without local art)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-noart-'));
  fs.writeFileSync(path.join(dir, 'config.json'), '{}');
  const srv = await serve(dir);
  try {
    const r = await get(srv, '/data/local-assets.json');
    assert.equal(r.status, 200);
    assert.match(r.type, /application\/json/);
    const doc = JSON.parse(r.body);
    assert.deepEqual(doc.groups, {});
    const h = await get(srv, '/data/local-assets.json', 'HEAD');
    assert.equal(h.status, 200);
    assert.equal(h.body, '');
    // the official effects' file list (data/local-fx.json, DESIGN §33.1): the same empty stand-in
    const fx = await get(srv, '/data/local-fx.json');
    assert.equal(fx.status, 200);
    assert.deepEqual(JSON.parse(fx.body).groups, {});
    // other missing data files still 404
    assert.equal((await get(srv, '/data/nope.json')).status, 404);
    assert.equal((await get(srv, '/data/sub/local-assets.json')).status, 404);
    assert.equal((await get(srv, '/data/sub/local-fx.json')).status, 404);
  } finally {
    srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('present data/local-assets.json is served as-is', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-art-'));
  const doc = { version: 1, source: 'local-client', count: 1, groups: { module: { 'mar-x': { path: '/assets/local/module/mar-x.png' } } } };
  fs.writeFileSync(path.join(dir, 'local-assets.json'), JSON.stringify(doc));
  const srv = await serve(dir);
  try {
    const r = await get(srv, '/data/local-assets.json');
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(r.body), doc);
  } finally {
    srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('docs and messages say what falls back without the local art and how a server without the client gets it (GitHub issue #42)', async () => {
  const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
  const { LOCAL_ART_FALLBACK, LOCAL_ART_COPY_HINT } = await import('../tools/setup.mjs');
  for (const f of ['README.md', 'docs/DEPLOY.md', 'tools/setup.mjs', 'tools/doctor.mjs']) {
    assert.ok(!/不影响游戏|其他功能不受影响|游戏不受影响/.test(read(f)), `${f}: never "the local art does not matter"`);
  }
  for (const re of [/3D 棋盘/, /界面图标/, /源石虫/]) assert.match(LOCAL_ART_FALLBACK, re);
  assert.ok(!/表情|玩法说明/.test(LOCAL_ART_FALLBACK), 'the emotes and the 玩法说明 pages are downloaded, not local-only');
  assert.match(LOCAL_ART_COPY_HINT, /同一版本的整合包/);
  // setup's row is printed on every start (scripts/launch.mjs): it names the fallbacks and points to DEPLOY §6; doctor adds the hint
  const noClientRow = read('tools/setup.mjs').split('\n').find((l) => l.includes("'未检测到本机明日方舟客户端'"));
  assert.ok(noClientRow && noClientRow.includes('LOCAL_ART_FALLBACK') && noClientRow.includes('DEPLOY.md 第 6 节') && !noClientRow.includes('LOCAL_ART_COPY_HINT'), noClientRow);
  assert.match(read('tools/doctor.mjs'), /未提取：\$\{LOCAL_ART_FALLBACK\}（\$\{LOCAL_ART_COPY_HINT\}）/);
  const deploy = read('docs/DEPLOY.md');
  const s6 = deploy.slice(deploy.indexOf('## 6. 本地客户端素材'));
  assert.ok(deploy.includes('## 6. 本地客户端素材') && s6.length > 200, 'DEPLOY §6');
  for (const re of [/同一版本/, /public\/assets\/local\//, /data\/local-assets\.json/, /3D 棋盘/, /源石虫/, /表情/, /玩法说明/]) assert.match(s6, re);
  // 0.2.0: the summon models of the local client (extract.py TOKEN_SPINES) — named in the fallbacks, DEPLOY §6 and README,
  // and an extraction made before them is reported by setup as lacking them (re-extract with --local)
  assert.match(LOCAL_ART_FALLBACK, /召唤物/);
  assert.match(s6, /召唤物/);
  assert.match(s6, /--only spine\/token/);
  const { localGaps } = await import('../tools/setup.mjs');
  assert.equal(localGaps({ enemySpines: true, tokenSpines: true }), '');
  assert.equal(localGaps({ enemySpines: true, tokenSpines: false }), '，缺少新版的自选召唤物模型');
  assert.equal(localGaps({ enemySpines: false, tokenSpines: false }), '，缺少新版的灼热/炽焰源石虫模型和自选召唤物模型');
  const setupSrc = read('tools/setup.mjs');
  assert.match(setupSrc, /localGaps\(local/);
  assert.match(setupSrc, /（重新提取：--local）/);
  // a non-empty gap already names --local; the fresh-extract hint is not glued on after it
  assert.match(setupSrc, /\$\{gap\}\$\{gap \? '' : again\}/);
  const readme = read('README.md');
  assert.match(readme, /召唤物/);
  assert.match(readme, /表情和「玩法说明」的教程图随上面的素材一起从公开镜像下载/);
  assert.match(readme, /\*\*同一版本\*\*的整合包/);
  assert.ok(!/需本地提取/.test(read('docs/PLAYING.md')), 'PLAYING: the 玩法说明 pages come with the download');
});
