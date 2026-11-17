// setup and doctor must not count directories at manifest URLs as downloaded files. All art here is inert fixture data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URLS = ['/assets/sample%20art.png', '/fonts/sample.woff2'];

async function fixture(t, kind) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-setup-assets-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const put = (rel, data = '{}') => {
    const dest = path.join(root, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, data);
  };
  for (const dir of ['shared', 'tools/assets']) {
    fs.cpSync(path.join(ROOT, dir), path.join(root, dir), { recursive: true });
  }
  for (const rel of ['tools/setup.mjs', 'tools/doctor.mjs', 'tools/local-extract/expected.mjs',
    'tools/local-extract/client-candidates.json',
    'server/update.js', 'server/plugins/fxReferences.js', 'server/plugins/artReferences.js']) {
    put(rel, fs.readFileSync(path.join(ROOT, rel)));
  }
  put('package.json', '{"type":"module"}');
  const setup = await import(pathToFileURL(path.join(root, 'tools/setup.mjs')).href);
  for (const name of setup.RUNTIME_PACKAGES) put(`node_modules/${name}/package.json`);
  for (const name of [...setup.VENDOR_REQUIRED, ...setup.VENDOR_OPTIONAL]) put(`public/vendor/${name}`, 'fixture');
  for (const name of setup.DATA_FILES) put(`data/${name}.json`);
  put('data/assets.json', JSON.stringify({ art: { urls: [...URLS, URLS[0]] }, stats: { bytes: 14 } }));
  for (const url of URLS) {
    const rel = `public${decodeURIComponent(url)}`;
    if (kind === 'directory') fs.mkdirSync(path.join(root, rel), { recursive: true });
    else if (kind !== 'missing') put(rel, kind === 'empty' ? '' : 'fixture');
  }
  // The assets directory may exist even when every referenced file is missing.
  fs.mkdirSync(path.join(root, 'public/assets'), { recursive: true });
  return { root, setup, put };
}

for (const kind of ['directory', 'empty', 'missing', 'file']) {
  test(`checkAssets: ${kind} at asset and font URLs`, async (t) => {
    const { setup } = await fixture(t, kind);
    const valid = kind === 'file';
    assert.deepEqual(setup.checkAssets(), {
      ok: valid, present: true, manifest: true, total: 2,
      missing: valid ? 0 : 2, sample: valid ? [] : URLS, bytes: 14,
    });
  });
}

for (const [script, flags] of [['setup', ['--check', '--no-local', '--no-scenes']], ['doctor', ['--port', '0', '--host', '127.0.0.1']]]) {
  test(`${script} CLI warns when manifest files are directories`, async (t) => {
    const { root, put } = await fixture(t, 'directory');
    const run = () => {
      const r = spawnSync(process.execPath, [path.join(root, 'tools', `${script}.mjs`), ...flags], {
        cwd: root, encoding: 'utf8', timeout: 30000, env: { ...process.env, NO_COLOR: '1' },
      });
      assert.ifError(r.error);
      assert.equal(r.status, 0, r.stderr); // Missing art stays optional.
      return r.stdout.split('\n').find((line) => line.includes('美术/音频 public/assets'));
    };
    assert.match(run(), /^! .*缺 2\/2/);
    for (const url of URLS) {
      fs.rmSync(path.join(root, 'public', decodeURIComponent(url)), { recursive: true });
      put(`public${decodeURIComponent(url)}`, 'fixture');
    }
    assert.match(run(), /^✔ .*2 个文件/);
  });
}
