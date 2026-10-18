import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fxFixture } from '../helpers/fxFixtures.js';
import { cosmetic, png } from '../helpers/pluginFixtures.js';
import { createPluginRegistry, readVanillaAssets } from '../../server/plugins/registry.js';
import { buildPluginLock } from '../../server/plugins/pack.js';

test('plugin checks see newly extracted official references; local changes invalidate cache without changing base identity', t => {
  const f = fxFixture(t), dataDir = path.join(f.root, 'data'), cache = new Map();
  f.put('data/assets.json', { chars: {} });
  const before = readVanillaAssets(dataDir, cache);
  f.put('data/local-assets.json', { chars: { char_9001_test: { avatar: '/assets/local/a.png' } } });
  const after = readVanillaAssets(dataDir, cache);
  assert.equal(after.manifest.chars.char_9001_test.avatar, '/assets/local/a.png');
  assert.equal(after.sha256, before.sha256);
  fs.unlinkSync(path.join(dataDir, 'local-assets.json'));
  assert.deepEqual(readVanillaAssets(dataDir, cache), before);
});

test('a cosmetic reference is revalidated after extraction and disappears when that local manifest is removed', t => {
  const f = fxFixture(t);
  f.put('data/assets.json', { chars: {} });
  f.put('plugins/borrow/plugin.json', cosmetic({ id: 'borrow', permissions: ['assets.add'], assets: { chars: { char_x_borrow_one: { ref: 'char_9001_test' } } } }));
  const dirs = Object.fromEntries(['public', 'data', 'packs', 'plugins'].map(n => [n === 'public' ? 'publicDir' : n === 'data' ? 'dataDir' : n + 'Dir', path.join(f.root, n)]));
  const registry = createPluginRegistry(dirs, { recheckMs: 0 });
  assert.equal(registry.plugins().some(p => p.id === 'borrow'), false);
  f.put('data/local-assets.json', { chars: { char_9001_test: { avatar: '/assets/local/a.png' } } });
  assert.ok(registry.plugins().some(p => p.id === 'borrow'));
  fs.unlinkSync(path.join(f.root, 'data/local-assets.json'));
  assert.equal(registry.plugins().some(p => p.id === 'borrow'), false);
});

test('optional art never turns assets.add into assets.override or changes an own-art plugin identity', t => {
  const f = fxFixture(t), id = 'char_9001_test';
  f.put('data/assets.json', { chars: { char_1_pool: { avatar: '/pool.png' } } });
  f.put('plugins/own-art/plugin.json', cosmetic({ id: 'own-art', permissions: ['assets.add'], assets: { chars: { [id]: { avatar: 'own.png' } } } }));
  f.put('plugins/own-art/own.png', png(2, 2));
  // A roster entry still requires override, even if local art also names it.
  f.put('plugins/roster/plugin.json', cosmetic({ id: 'roster', permissions: ['assets.add'], assets: { chars: { char_1_pool: { avatar: 'own.png' } } } }));
  f.put('plugins/roster/own.png', png(2, 2));
  const dirs = Object.fromEntries(['public', 'data', 'packs', 'plugins'].map(n => [n === 'public' ? 'publicDir' : n === 'data' ? 'dataDir' : n + 'Dir', path.join(f.root, n)]));
  const registry = createPluginRegistry(dirs, { recheckMs: 0 });
  const before = registry.plugin('own-art');
  assert.ok(before);
  const baseHash = registry.vanillaAssets().sha256;
  f.put('data/local-assets.json', { chars: { [id]: { avatar: '/assets/local/a.png' }, char_1_pool: { avatar: '/assets/local/pool.png' } } });
  const after = registry.plugin('own-art');
  assert.ok(after, JSON.stringify(registry.report()));
  assert.equal(after.visual.hash, before.visual.hash);
  assert.equal(after.visual.vs, before.visual.vs);
  assert.equal(registry.vanillaAssets().sha256, baseHash);
  assert.equal(registry.vanillaAssets().manifest.chars.char_1_pool.avatar, '/pool.png');
  const lock = buildPluginLock(path.join(f.root, 'plugins/own-art'), { vanilla: registry.vanillaAssets() });
  assert.deepEqual(lock.problems, [], 'packing uses the same permission baseline as registry checks');
  assert.ok(lock.lock);
  assert.equal(registry.plugin('roster'), null);
  assert.ok(registry.report().skipped.some(s => s.issues?.some(i => i.code === 'PLUGIN_PERMISSION_MISSING' && i.params?.need === 'assets.override')));
});
