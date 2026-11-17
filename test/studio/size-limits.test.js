import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPluginFiles } from '../../server/studio/files.js';
import { candidateLimits } from '../../server/studio/candidate.js';
import { pluginByteLimit } from '../../shared/plugins/manifest.js';

function setup(t, cls) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-studio-size-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const files = createPluginFiles(base), id = 'size-test', dir = files.root(id, { create: true });
  const manifest = Buffer.from(JSON.stringify({ manifest: 2, id, name: 'Size test', version: '1.0.0', class: cls }));
  files.write(id, 'plugin.json', manifest);
  const large = path.join(dir, 'large.txt');
  fs.writeFileSync(large, '');
  return { files, id, dir, manifest, large };
}

for (const cls of ['content', 'cosmetic']) {
  test(`${cls}: Studio accepts the exact class cap and rejects another byte before writing`, t => {
    const { files, id, dir, manifest, large } = setup(t, cls);
    fs.truncateSync(large, pluginByteLimit(cls) - manifest.length - 1);
    files.write(id, 'a.txt', Buffer.from('a'));
    files.write(id, 'a.txt', Buffer.from('b'));
    assert.doesNotThrow(() => candidateLimits({ dir }));
    assert.throws(() => files.write(id, 'b.txt', Buffer.from('b')), { code: 'PLUGIN_STUDIO_SIZE', status: 413 });
    assert.equal(fs.existsSync(path.join(dir, 'b.txt')), false);
    fs.writeFileSync(path.join(dir, 'b.txt'), 'b');
    assert.throws(() => candidateLimits({ dir }), { code: 'PLUGIN_STUDIO_SIZE', status: 413 });
  });
}

test('changing a large cosmetic manifest to content enforces the incoming cap atomically', t => {
  const { files, id, dir, manifest, large } = setup(t, 'cosmetic');
  fs.truncateSync(large, pluginByteLimit('content') + 1);
  const content = Buffer.from(manifest.toString().replace('cosmetic', 'content'));
  assert.throws(() => files.write(id, 'plugin.json', content), { code: 'PLUGIN_STUDIO_SIZE', status: 413 });
  assert.deepEqual(fs.readFileSync(path.join(dir, 'plugin.json')), manifest);
  assert.doesNotThrow(() => candidateLimits({ dir }));
  fs.writeFileSync(path.join(dir, 'plugin.json'), content);
  assert.throws(() => candidateLimits({ dir }), { code: 'PLUGIN_STUDIO_SIZE', status: 413 });
});

test('Studio class detection never follows a linked manifest', t => {
  const { files, id, dir, manifest } = setup(t, 'content');
  const outside = path.join(path.dirname(dir), 'outside.json');
  fs.writeFileSync(outside, manifest);
  fs.unlinkSync(path.join(dir, 'plugin.json'));
  fs.symlinkSync(outside, path.join(dir, 'plugin.json'));
  assert.throws(() => files.write(id, 'a.txt', Buffer.from('a')), { code: 'PLUGIN_STUDIO_PATH', status: 403 });
  assert.throws(() => candidateLimits({ dir }), { code: 'PLUGIN_STUDIO_PATH', status: 403 });
  assert.deepEqual(fs.readFileSync(outside), manifest);
});
