import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zipFolder } from '../tools/package.mjs';
import { smokePackage } from '../tools/package-smoke.mjs';

function fixture(t, { missing = '', healthVersion = '1.0.0', hang = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-smoke-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'Stronghold-Protocol');
  fs.mkdirSync(path.join(root, 'server'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ type: 'module', version: '1.0.0' }));
  const server = `import http from 'node:http';
import fs from 'node:fs';
fs.writeFileSync('started.json', JSON.stringify({pid: process.pid, cwd: process.cwd()}));
${hang ? 'setInterval(() => {}, 1000);' : `const srv = http.createServer((req,res) => {
  if (req.url === ${JSON.stringify(missing)}) { res.writeHead(404); res.end(); return; }
  res.end(req.url === '/healthz' ? JSON.stringify({ok:true,app:${JSON.stringify(healthVersion)}}) : req.url === '/' ? '<html><script src="/js/main.js"></script></html>' : '/* PIXI */');
});
srv.listen(Number(process.env.PORT), process.env.HOST, () => console.log('Local: http://127.0.0.1:' + srv.address().port));`}`;
  fs.writeFileSync(path.join(root, 'server/index.js'), server);
  const zip = path.join(dir, 'release.zip');
  zipFolder(dir, zip);
  return { dir, root, zip };
}

test('actual archive boots in isolation and an update overlays its base before boot', async (t) => {
  const f = fixture(t);
  await smokePackage(f.zip, { log: () => {} });
  assert.match(fs.readFileSync(`${f.zip}.smoke.log`, 'utf8'), /OK \/healthz\nOK \/\nOK \/vendor\/pixi.min.js\nPASS/);
  assert.equal(fs.existsSync(path.join(f.root, 'started.json')), false, 'never starts the staging copy');
  // The update intentionally lacks the unchanged entry point; it only works over the base zip.
  fs.rmSync(path.join(f.root, 'server'), { recursive: true });
  fs.writeFileSync(path.join(f.root, 'update-only.txt'), 'overlaid');
  const update = path.join(f.dir, 'update.zip');
  zipFolder(f.dir, update);
  await smokePackage(update, { base: f.zip, log: () => {} });
});

test('smoke rejects each failed stage and retains diagnostics', async (t) => {
  for (const [opts, expected] of [
    [{ missing: '/vendor/pixi.min.js' }, /request \/vendor\/pixi.min.js: HTTP 404/],
    [{ healthVersion: '0.0.0' }, /request \/healthz: health\/version mismatch/],
    [{ hang: true }, /boot: server did not become ready/],
  ]) {
    const f = fixture(t, opts);
    await assert.rejects(smokePackage(f.zip, { timeoutMs: opts.hang ? 250 : 3000, log: () => {} }), expected);
    const log = fs.readFileSync(`${f.zip}.smoke.log`, 'utf8');
    assert.match(log, /FAIL/);
    assert.match(log, /exit:/, 'the server has exited before the rejection returns');
  }
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, 'server/index.js'), "import 'missing-runtime-dependency';");
  zipFolder(f.dir, f.zip);
  await assert.rejects(smokePackage(f.zip, { log: () => {} }), /boot: server exited/);
  assert.match(fs.readFileSync(`${f.zip}.smoke.log`, 'utf8'), /ERR_MODULE_NOT_FOUND/);
  fs.writeFileSync(f.zip, 'not a zip');
  await assert.rejects(smokePackage(f.zip, { log: () => {} }), /at extract:/);
});
