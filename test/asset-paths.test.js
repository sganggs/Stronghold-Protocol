// shared/assetPaths.js: the content-hash segment of asset URLs (split / insert / strip) and the traffic categories the
// server's counters and the browser's diagnostics share (host bandwidth, layers 0 and 1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitHashedPath, hashedPath, unhashedUrl, trafficCategory, TRAFFIC_CATEGORIES, ASSET_HASH_HEX, HASH_SEGMENT_RE } from '../shared/assetPaths.js';

const H = '0123456789abcdef';

test('the hash segment: split off, inserted after the root, removed again', () => {
  assert.equal(ASSET_HASH_HEX, 16);
  assert.ok(HASH_SEGMENT_RE.test(`~${H}`));
  assert.deepEqual(splitHashedPath(`/assets/~${H}/char/avatar/a.png`), { hash: H, path: '/assets/char/avatar/a.png' });
  assert.deepEqual(splitHashedPath(`/fonts/~${H}/f.woff2`), { hash: H, path: '/fonts/f.woff2' });
  assert.deepEqual(splitHashedPath(`/media/~${H}/bgm/a`), { hash: H, path: '/media/bgm/a' });
  for (const p of ['/assets/char/a.png', `/assets/~${H.toUpperCase()}/a.png`, `/assets/~${H}0/a.png`, `/assets/~${H}`, `/data/~${H}/x.json`,
    `/assets/x/~${H}/a.png`, '/assets/~zz/a.png', '']) {
    assert.deepEqual(splitHashedPath(p), { hash: null, path: p }, p);
  }
  assert.equal(hashedPath('/assets/char/a.png', H), `/assets/~${H}/char/a.png`);
  assert.equal(hashedPath('/media/bgm/a', H), `/media/~${H}/bgm/a`);
  assert.equal(hashedPath('/fonts/f.woff2', H), `/fonts/~${H}/f.woff2`);
  assert.equal(hashedPath('/data/assets.json', H), '/data/assets.json', 'not a hashed root');
  assert.equal(hashedPath('/assets/a.png', null), '/assets/a.png');
  assert.equal(hashedPath('/assets/a.png', 'nothex'), '/assets/a.png');
  assert.equal(hashedPath(`/assets/~${H}/a.png`, 'fedcba9876543210'), `/assets/~${H}/a.png`, 'never two segments');
  assert.equal(hashedPath('/assets/', H), '/assets/');
  assert.equal(unhashedUrl(`/assets/~${H}/audio/sfx/b_char_dead.mp3`), '/assets/audio/sfx/b_char_dead.mp3');
  assert.equal(unhashedUrl(null), null);
});

test('traffic categories: audio, assets, code, data, other — the hash segment does not matter', () => {
  assert.deepEqual([...TRAFFIC_CATEGORIES], ['assets', 'audio', 'code', 'data', 'other']);
  const cases = {
    '/media/bgm/act1': 'audio', [`/media/~${H}/bgm/act1`]: 'audio', '/assets/audio/bgm/a.mp3': 'audio', [`/assets/~${H}/audio/sfx/a.mp3`]: 'audio',
    '/assets/char/avatar/a.png': 'assets', [`/assets/~${H}/spine/op/x/front/x.skel`]: 'assets', '/fonts/f.woff2': 'assets', '/icons/app.svg': 'assets',
    '/packs/foo/art/a.png': 'assets', '/packs/index.json': 'data', '/data/assets.json': 'data', '/data/i18n/en.json': 'data', '/i18n/en.json': 'data',
    '/manifest.json': 'data', '/': 'code', '/index.html': 'code', '/js/main.js': 'code', '/css/theme.css': 'code', '/vendor/pixi.min.js': 'code',
    '/sim/Battle.js': 'code', '/shared/protocol.js': 'code', '/data.js': 'code', '/healthz': 'other', '/favicon.ico': 'other',
  };
  for (const [p, cat] of Object.entries(cases)) assert.equal(trafficCategory(p), cat, p);
});
