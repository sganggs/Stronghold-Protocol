// Official 卫戍协议 packs: the reader, the settings list, and a same-origin load.
// The Chrome pass is test/ui/themes.e2e.test.js (this sandbox has no Chrome).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createThemeLibrary } from '../../public/js/uiTheme.js';
import { characterAnimName } from '../../shared/uiTheme.js';
import {
  assessTheme, installedOfficialThemes, officialAssetUrl, officialThemeById, themePathsOf,
} from '../../shared/uiTheme.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const IDS = ['ac_n_initial', 'ac_n_iron', 'ac_s_closur'];

function installed(id) {
  return join(ROOT, 'public/assets/local/themes', id, 'theme.json');
}

const havePacks = IDS.every((id) => existsSync(installed(id)));

test('official card metadata and a safe served URL', () => {
  assert.equal(officialThemeById('ac_n_initial').name, '卫戍协议终端（官方贴图）');
  assert.equal(officialThemeById('ac_n_iron').name, '乌萨斯齐心团');
  assert.equal(officialThemeById('ac_s_closur').name, '“全能的”可露希尔');
  assert.equal(officialThemeById('nope'), null);
  const group = 'themes/ac_n_iron';
  assert.equal(officialAssetUrl(group, { path: '/assets/local/themes/ac_n_iron/theme.json' }), '/assets/local/themes/ac_n_iron/theme.json');
  assert.equal(officialAssetUrl(group, { path: '/assets/local/themes/ac_n_initial/theme.json' }), null);
  assert.equal(officialAssetUrl(group, { path: '/assets/local/themes/ac_n_iron/../secret' }), null);
  assert.equal(officialAssetUrl(group, { path: 'https://evil.example/theme.json' }), null);
  const listed = installedOfficialThemes({
    groups: {
      'themes/ac_n_iron': { 'theme.json': { path: '/assets/local/themes/ac_n_iron/theme.json' }, 'thumb.webp': { path: '/assets/local/themes/ac_n_iron/thumb.webp' } },
    },
  });
  assert.deepEqual(listed.map((row) => row.id), ['ac_n_iron']);
  assert.equal(listed[0].thumbnailUrl, '/assets/local/themes/ac_n_iron/thumb.webp');
  assert.deepEqual(installedOfficialThemes({ groups: {} }), []);
  assert.deepEqual(installedOfficialThemes(null), []);
});

test('a voice stem picks the skeleton clip, and an unmapped line does not', () => {
  const character = { anims: { idle: 'Idle', voice: { cn_001: 'Happy' } } };
  assert.equal(characterAnimName(character, 'CN_001'), 'Happy');
  assert.equal(characterAnimName(character, 'cn_099'), null);
  assert.equal(characterAnimName({ image: { path: 'a.webp' } }, 'cn_001'), null);
});

test('themePathsOf gathers banner objects and a spine, and skips a scheme', () => {
  const paths = themePathsOf({
    thumbnail: 'thumb.webp',
    images: { shop_main: { src: 'sprites/a.webp', slice: [1, 1, 1, 1] }, nope: '' },
    banners: { rest: { src: 'sprites/rest.webp', slice: [2, 2, 2, 2] }, gameStart: 'sprites/start.webp' },
    voice: { AUTOCHESS_FREEZE: 'voice/cn_001.mp3' },
    character: { spine: { skel: 'spine/a.skel', atlas: 'spine/a.atlas', textures: ['spine/a.png'] } },
  });
  assert.deepEqual(paths.sort(), [
    'spine/a.atlas', 'spine/a.png', 'spine/a.skel', 'sprites/a.webp', 'sprites/rest.webp', 'sprites/start.webp', 'thumb.webp', 'voice/cn_001.mp3',
  ]);
  assert.deepEqual(themePathsOf({ thumbnail: 'http://evil/a.png' }), []);
});

test('a sliced banner and a character are kept; a bad character drops only that key', () => {
  const doc = {
    spTheme: 1, id: 'iron-fan', name: '主题名',
    images: { char_spine_outer: 'sprites/frame.webp', shop_level_1: 'sprites/lv.webp' },
    banners: { rest: { src: 'sprites/rest.webp', slice: [8, 9, 10, 11] }, gameStart: { src: 1 } },
    character: {
      spine: { skel: 'spine/a.skel', atlas: 'spine/a.atlas', textures: ['spine/a.png'] },
      anims: { idle: 'Idle', voice: { CN_001: 'Happy', 'nope key': 'Talk' } },
    },
  };
  const files = ['sprites/frame.webp', 'sprites/lv.webp', 'sprites/rest.webp', 'spine/a.skel', 'spine/a.atlas', 'spine/a.png']
    .map((path) => ({ path, size: 12, width: 8, height: 8, measured: true }));
  const report = assessTheme({ jsonText: JSON.stringify(doc), files, replace: true });
  assert.equal(report.ok, true);
  assert.deepEqual(report.banners.rest, { path: 'sprites/rest.webp', slice: [8, 9, 10, 11] });
  assert.equal(report.images.char_spine_outer.path, 'sprites/frame.webp');
  assert.equal(report.images.shop_level_1.path, 'sprites/lv.webp');
  assert.equal(report.character.spine.skel, 'spine/a.skel');
  assert.equal(report.character.anims.idle, 'Idle');
  assert.deepEqual(report.character.anims.voice, { cn_001: 'Happy' });
  assert.ok(report.refused.some((item) => item.path === 'banners.gameStart' && item.code === 'bad-type'));

  const both = assessTheme({
    jsonText: JSON.stringify({ ...doc, character: { image: 'sprites/frame.webp', spine: { skel: 'spine/a.skel' } } }),
    files,
    replace: true,
  });
  assert.equal(both.ok, true);
  assert.equal(both.character, null);
  assert.ok(both.refused.some((item) => item.path === 'character' && item.code === 'bad-type'));

  const portrait = assessTheme({
    jsonText: JSON.stringify({ ...doc, character: { image: { src: 'sprites/char.webp', slice: [1, 2, 3, 4] }, anims: 'nope' } }),
    files: [...files, { path: 'sprites/char.webp', size: 12, width: 8, height: 8, measured: true }],
    replace: true,
  });
  assert.equal(portrait.ok, true);
  assert.deepEqual(portrait.character.image, { path: 'sprites/char.webp', slice: [1, 2, 3, 4] });
  assert.equal(portrait.character.anims, undefined);
});

test('an installed official theme.json is accepted, including sliced banners', { skip: !havePacks && 'official theme files are not installed' }, () => {
  for (const id of IDS) {
    const jsonText = readFileSync(installed(id), 'utf8');
    const doc = JSON.parse(jsonText);
    const dir = dirname(installed(id));
    const files = [];
    for (const rel of themePathsOf(doc)) {
      const abs = join(dir, rel);
      assert.equal(existsSync(abs), true, `${id} ${rel}`);
      files.push({ path: rel, size: statSync(abs).size });
    }
    const report = assessTheme({ jsonText, files, replace: true });
    assert.equal(report.ok, true, `${id} ${report.code || ''}`);
    assert.equal(report.id, id);
    assert.deepEqual(report.refused, [], `${id} refused ${JSON.stringify(report.refused)}`);
    for (const [key, value] of Object.entries(doc.banners || {})) {
      if (value && typeof value === 'object') {
        assert.deepEqual(report.banners[key]?.slice, value.slice, `${id} ${key}`);
      }
    }
    for (const key of Object.keys(doc)) {
      assert.equal(report.unused.keys.includes(key), false, `${id} dropped ${key}`);
    }
  }
});

test('loading an official pack resolves blob pictures and keeps the spine URL', async () => {
  const group = 'themes/ac_n_initial';
  const prefix = '/assets/local/themes/ac_n_initial';
  const doc = {
    spTheme: 1,
    id: 'ac_n_initial',
    name: '卫戍协议终端',
    description: '一切模拟都从此开始。',
    thumbnail: 'thumb.webp',
    images: { char_spine_outer: 'sprites/frame.webp' },
    banners: { rest: { src: 'sprites/rest.webp', slice: [4, 5, 6, 7] } },
    voice: { AUTOCHESS_FREEZE: 'voice/cn_014.mp3' },
    character: {
      spine: { skel: 'spine/trap.skel', atlas: 'spine/trap.atlas', textures: ['spine/trap.png'] },
      anims: { idle: 'Idle', voice: { cn_014: 'Interact' } },
    },
  };
  const bytes = {
    [`${prefix}/theme.json`]: new TextEncoder().encode(JSON.stringify(doc)),
    [`${prefix}/thumb.webp`]: Uint8Array.of(1, 2, 3),
    [`${prefix}/sprites/frame.webp`]: Uint8Array.of(4, 5),
    [`${prefix}/sprites/rest.webp`]: Uint8Array.of(6),
    [`${prefix}/voice/cn_014.mp3`]: Uint8Array.of(7, 8),
    [`${prefix}/spine/trap.skel`]: Uint8Array.of(9),
    [`${prefix}/spine/trap.atlas`]: Uint8Array.of(10),
    [`${prefix}/spine/trap.png`]: Uint8Array.of(11),
  };
  const manifest = { groups: { [group]: {} } };
  for (const url of Object.keys(bytes)) {
    const rel = url.slice(`${prefix}/`.length);
    manifest.groups[group][rel] = { path: url };
  }
  const lib = createThemeLibrary({
    openDb: async () => { throw new Error('no IndexedDB'); },
    measure: async () => ({ ok: true, width: 16, height: 16 }),
    createUrl: (blob) => `blob:test/${blob.size}`,
    revokeUrl: () => {},
    fetchImpl: async (url) => {
      if (url === '/data/local-assets.json') {
        return { ok: true, json: async () => manifest, text: async () => JSON.stringify(manifest) };
      }
      const body = bytes[url];
      if (!body) return { ok: false, status: 404 };
      return {
        ok: true,
        status: 200,
        text: async () => new TextDecoder().decode(body),
        json: async () => JSON.parse(new TextDecoder().decode(body)),
        arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
      };
    },
  });
  await lib.loadAssetManifest();
  assert.deepEqual(lib.officialCards().map((card) => card.id), ['ac_n_initial']);
  assert.equal(lib.officialCards()[0].official, true);
  assert.equal(lib.officialCards()[0].thumbnailUrl, `${prefix}/thumb.webp`);
  const loaded = await lib.loadOfficial(officialThemeById('ac_n_initial'), manifest);
  assert.equal(loaded.ok, true, loaded.code);
  const pack = lib.get('ac_n_initial');
  assert.equal(pack.official, true);
  assert.equal(pack.banners.rest.slice.join(','), '4,5,6,7');
  assert.ok(pack.banners.rest.url.startsWith('blob:'));
  assert.equal(pack.voiceStem[pack.voice.AUTOCHESS_FREEZE[0]], 'cn_014');
  assert.equal(pack.character.spine.skel, `${prefix}/spine/trap.skel`);
  assert.equal(pack.character.spine.atlas, `${prefix}/spine/trap.atlas`);
  assert.deepEqual(pack.character.anims.voice, { cn_014: 'Interact' });
  assert.equal(await lib.remove('ac_n_initial'), false);
});
