// Local-client art is optional (DESIGN §13): the emote art, the 玩法说明 pages and the official tier chips resolve
// from data/local-assets.json when present and fall back (text / tips / CSS) when the manifest or an entry is missing.
// The emotes and the 玩法说明 pages are also on the public mirror (GitHub issue #42): data/assets.json lists the copies
// tools/fetch-assets.mjs downloads under the same group and name (ui['<group>/<name>']); the client takes the local
// file first, then the mirror copy, then its fallback (data.js artUrls / nextArtUrl).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EMOTES, EMOTE_CATALOG, emoteArtPath, emoteArtGroup, emoteInfo } from '../../shared/constants.js';
import { GUIDE_PAGES } from '../../tools/assets/plan.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const manifest = {
  version: 1,
  groups: {
    'emoticon/basic': { pic_happy_battle: { path: '/assets/local/emoticon/basic/pic_happy_battle.png', w: 120, h: 120 } },
    guide: Object.fromEntries(['autochess_home_1', 'autochess_home_2', 'autochess_shop_1', 'autochess_handbook_4']
      .map((k) => [k, { path: `/assets/local/guide/${k}.png`, w: 1024, h: 1024 }])),
    'ui/battle': { img_chess_level_3: { path: '/assets/local/ui/battle/img_chess_level_3.png', w: 45, h: 45 } },
  },
};
// what the server (server/http/static.js) serves when data/local-assets.json is absent
const EMPTY_LOCAL = { version: 1, source: 'none', count: 0, groups: {} };

let mode = 'ok';         // data/local-assets.json: 'ok' (the manifest above) | 'empty' (the server's stand-in) | 'missing' (404)
let assetsDoc = null;    // data/assets.json, or null (404)
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.endsWith('/local-assets.json')) {
    if (mode === 'ok') return { ok: true, status: 200, json: async () => manifest };
    if (mode === 'empty') return { ok: true, status: 200, json: async () => EMPTY_LOCAL };
  } else if (u.endsWith('/assets.json') && assetsDoc) return { ok: true, status: 200, json: async () => assetsDoc };
  return { ok: false, status: 404, json: async () => ({}) };
};

/** Reload both manifests after changing `mode` / `assetsDoc`. */
async function reload(data) {
  const orig = console.warn; console.warn = () => {};
  try {
    for (const n of ['local', 'assets']) { await data.invalidate(n); await data.load(n); }
  } finally { console.warn = orig; }
}

describe('local-client art fallbacks', () => {
  test('manifest present: listed entries resolve, unlisted ones stay null', async () => {
    const { data, localAsset } = await import('../../public/js/data.js');
    await data.load('local');
    const { emoteArtUrl } = await import('../../public/js/ui/emotes.js');
    const { guidePages, GUIDE_CHAPTERS } = await import('../../public/js/ui/guide.js');
    const { tierChipUrl } = await import('../../public/js/ui/components.js');
    assert.equal(emoteArtUrl('autochess_battle_happy'), emoteArtPath('autochess_battle_happy'));
    assert.equal(emoteArtUrl('autochess_battle_sad'), null, 'listed by neither manifest (no data/assets.json here): no URL, never requested');
    assert.equal(emoteArtUrl('nope'), null);
    const pages = guidePages();
    assert.deepEqual(pages.map((p) => p.key), ['autochess_home_1', 'autochess_home_2', 'autochess_shop_1', 'autochess_handbook_4'], 'reading order, missing pages skipped');
    assert.deepEqual(pages.map((p) => p.chapter), [0, 0, 1, 2]);
    assert.equal(GUIDE_CHAPTERS.reduce((n, c) => n + c.pages.length, 0), 19, 'the 19 official tutorial pages');
    assert.equal(tierChipUrl(3), '/assets/local/ui/battle/img_chess_level_3.png');
    assert.equal(tierChipUrl(4), null, 'CSS fallback');
    assert.equal(localAsset('guide', 'autochess_home_9'), null);
    assert.equal(localAsset('nope', 'x'), null);
  });

  test('manifest missing: everything falls back', async () => {
    mode = 'missing';
    assetsDoc = null;
    const { data } = await import('../../public/js/data.js');
    await reload(data);
    assert.equal(data.status('local'), 'missing');
    const { emoteArtUrl } = await import('../../public/js/ui/emotes.js');
    const { guidePages } = await import('../../public/js/ui/guide.js');
    const { tierChipUrl } = await import('../../public/js/ui/components.js');
    for (const id of EMOTES) assert.equal(emoteArtUrl(id), null);
    assert.deepEqual(guidePages(), []);
    assert.equal(tierChipUrl(1), null);
  });

  test('the real manifest (when extracted) lists all 36 emotes and all 19 guide pages', { skip: !safeRead() && 'no data/local-assets.json' }, () => {
    const real = JSON.parse(safeRead());
    for (const id of EMOTES) {
      const entry = real.groups[emoteArtGroup(id)]?.[emoteInfo(id).picId];
      assert.ok(entry, `emote ${id}`);
      assert.equal(entry.path, emoteArtPath(id));
    }
    assert.equal(Object.keys(real.groups.guide || {}).length, 19);
  });
});

describe('emotes and 玩法说明 pages: local art first, then the mirror copy (GitHub issue #42)', () => {
  test('lookup order: the local file, then data/assets.json ui[\'<group>/<name>\'], then nothing', async () => {
    mode = 'ok';
    assetsDoc = { ui: {
      'emoticon/basic/pic_happy_battle': '/assets/ui/emoticon/basic/pic_happy_battle.png',  // both: the local one wins
      'emoticon/basic_2/pic_sad_battle': '/assets/ui/emoticon/basic_2/pic_sad_battle.png',  // the mirror copy only
      'guide/autochess_home_1': '/assets/ui/guide/autochess_home_1.png',
      'guide/autochess_home_9': '/assets/ui/guide/autochess_home_9.png',
      'ui/battle/img_chess_level_4': '/assets/ui/x.png',                                     // not one of the mirrored groups' names
    } };
    const { data, artUrls, nextArtUrl, localAsset } = await import('../../public/js/data.js');
    await reload(data);
    const { emoteArtUrl, emoteArtUrls } = await import('../../public/js/ui/emotes.js');
    const { guidePages } = await import('../../public/js/ui/guide.js');
    assert.deepEqual(emoteArtUrls('autochess_battle_happy'), ['/assets/local/emoticon/basic/pic_happy_battle.png', '/assets/ui/emoticon/basic/pic_happy_battle.png']);
    assert.equal(emoteArtUrl('autochess_battle_happy'), '/assets/local/emoticon/basic/pic_happy_battle.png', 'local first');
    assert.equal(emoteArtUrl('autochess_battle_sad'), '/assets/ui/emoticon/basic_2/pic_sad_battle.png', 'no local file: the mirror copy');
    assert.deepEqual(emoteArtUrls('autochess_battle_dying'), [], 'neither: the glyph');
    assert.equal(emoteArtUrl('autochess_battle_dying'), null);
    assert.deepEqual(emoteArtUrls('__proto__'), []);
    const pages = guidePages();
    assert.deepEqual(pages.map((p) => p.key), ['autochess_home_1', 'autochess_home_2', 'autochess_home_9', 'autochess_shop_1', 'autochess_handbook_4'], 'reading order, either source');
    assert.deepEqual(pages[0].urls, ['/assets/local/guide/autochess_home_1.png', '/assets/ui/guide/autochess_home_1.png']);
    assert.equal(pages[0].url, '/assets/local/guide/autochess_home_1.png');
    assert.deepEqual(pages[2].urls, ['/assets/ui/guide/autochess_home_9.png']);
    assert.deepEqual(artUrls('guide', 'autochess_home_2'), ['/assets/local/guide/autochess_home_2.png']);
    assert.deepEqual(artUrls('ui/battle', 'img_chess_level_3'), ['/assets/local/ui/battle/img_chess_level_3.png']);
    assert.deepEqual(artUrls('guide', '__proto__'), []);
    assert.deepEqual(artUrls('constructor', 'x'), []);
    assert.equal(localAsset('guide', 'autochess_home_9'), null, 'localAsset stays local-only');
    // an image that fails to load (a copied local-assets.json without its files) falls through to the next URL
    const urls = emoteArtUrls('autochess_battle_happy');
    assert.equal(nextArtUrl(urls, new Set()), urls[0]);
    assert.equal(nextArtUrl(urls, new Set([urls[0]])), urls[1]);
    assert.equal(nextArtUrl(urls, new Set(urls)), null, 'both failed: the fallback');
    assert.equal(nextArtUrl(urls), urls[0]);
    assert.equal(nextArtUrl(null), null);
  });

  test('no local client (a source deploy on a server, issue #42): every emote and all 19 pages come from the committed data/assets.json', async () => {
    mode = 'empty';
    assetsDoc = JSON.parse(readFileSync(path.join(ROOT, 'data/assets.json'), 'utf8'));
    const { data } = await import('../../public/js/data.js');
    await reload(data);
    const { emoteArtUrl } = await import('../../public/js/ui/emotes.js');
    const { guidePages } = await import('../../public/js/ui/guide.js');
    for (const e of EMOTE_CATALOG) assert.equal(emoteArtUrl(e.id), `/assets/ui/emoticon/${e.dir}/${e.picId}.png`, e.id);
    const pages = guidePages();
    assert.deepEqual(pages.map((p) => p.key), GUIDE_PAGES);
    assert.deepEqual(pages.map((p) => p.url), GUIDE_PAGES.map((k) => `/assets/ui/guide/${k}.png`));
    assert.ok(pages.every((p) => p.urls.length === 1));
  });

  test('the guide stage: the local page, else the downloaded copy, else the official tips text (0.1.1\'s fallback)', async () => {
    const { guideStage } = await import('../../public/js/ui/guide.js');
    const local = '/assets/local/guide/autochess_home_1.png';
    const mirror = '/assets/ui/guide/autochess_home_1.png';
    const page = { key: 'autochess_home_1', urls: [local, mirror] };
    assert.deepEqual(guideStage(page, new Set()), { kind: 'image', src: local }, 'local ok → local');
    assert.deepEqual(guideStage(page), { kind: 'image', src: local }, 'nothing failed yet');
    assert.deepEqual(guideStage(page, new Set([local])), { kind: 'image', src: mirror }, 'local fails → the downloaded copy');
    assert.deepEqual(guideStage(page, new Set([local, mirror])), { kind: 'tips' }, 'both fail → tips');
    // data/assets.json lists the downloaded page but the file is not on disk (a git pull and restart without setup)
    assert.deepEqual(guideStage({ urls: [mirror] }, new Set([mirror])), { kind: 'tips' }, 'listed, not on disk → tips, not a blank notice');
    assert.deepEqual(guideStage({ urls: [] }), { kind: 'tips' }, 'no copy');
    assert.deepEqual(guideStage(null), { kind: 'tips' }, 'no page');
    // the viewer shows exactly that: the image stage for a URL, the tips stage otherwise (never the old blank notice)
    const src = readFileSync(path.join(ROOT, 'public/js/ui/guide.js'), 'utf8');
    assert.match(src, /const stage = guideStage\(cur, failed\)/);
    assert.match(src, /: html`<div class="guide__stage guide__stage--text"><\$\{TipsFallback\} \/><\/div>`\}/);
    assert.ok(!src.includes('该页面暂时无法显示'), 'no blank notice left');
  });

  test('the guide preloads only the next page (host bandwidth layer 0): wraps around, skips a failed copy, never the previous page', async () => {
    const { guidePreloadUrl } = await import('../../public/js/ui/guide.js');
    const page = (k) => ({ urls: [`/assets/local/guide/${k}.webp`, `/assets/ui/guide/${k}.png`] });
    const pages = ['autochess_home_1', 'autochess_home_2', 'autochess_home_3'].map(page);
    assert.equal(guidePreloadUrl(pages, 0), '/assets/local/guide/autochess_home_2.webp');
    assert.equal(guidePreloadUrl(pages, 2), '/assets/local/guide/autochess_home_1.webp', 'wraps to the first page');
    assert.equal(guidePreloadUrl(pages, 1, new Set(['/assets/local/guide/autochess_home_3.webp'])), '/assets/ui/guide/autochess_home_3.png', 'the copy that has not failed');
    assert.equal(guidePreloadUrl([page('autochess_home_1')], 0), null, 'a single page needs no preload');
    assert.equal(guidePreloadUrl([], 0), null);
    const src = readFileSync(path.join(ROOT, 'public/js/ui/guide.js'), 'utf8');
    assert.deepEqual(src.match(/^\s+preload\(.*$/gm).map((l) => l.trim()), ['preload(guidePreloadUrl(pages, i, failed));'], 'one preload call in the viewer');
  });

  test('tools/assets/plan.mjs GUIDE_PAGES is the viewer\'s page list (GUIDE_CHAPTERS), in reading order', async () => {
    const { GUIDE_CHAPTERS } = await import('../../public/js/ui/guide.js');
    assert.deepEqual([...GUIDE_PAGES], GUIDE_CHAPTERS.flatMap((c) => c.pages.map(([key]) => key)));
  });
});

function safeRead() {
  try { return readFileSync(path.join(ROOT, 'data/local-assets.json'), 'utf8'); } catch { return null; }
}
