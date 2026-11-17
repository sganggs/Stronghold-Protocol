// Real-server browser E2E — cosmetic plugins (DESIGN §32 P1a; opt-in, ~40 s):
//   SP_E2E=1 node --test test/ui/plugins.e2e.test.js
//
// A server with a plugins folder of its own (art made on the spot: a red and a green 8 × 8 square; no file of the game):
// the title screen says 「本服务器安装了 2 个插件」; in a co-op room both players read 原版 at the top; the host opens the
// 插件 panel and switches the room plugin on — the other player's page now draws that operator's avatar from the plugin
// (/p/…, the image loaded in its 干员调配 card) and reads 插件 ×1, while the room's cs stays the vanilla one. A personal
// plugin nobody switched on changes nothing; switched on in the guest's 设置 → 外观插件 it changes the guest's page only
// (kept in that browser, never the host's), on top of the room's art. The host switches the room plugin off: its art
// leaves the guest's page (the personal one stays). No console / page errors, no failed request but the game's own art
// when this checkout has none.
// A match already drawn (the fast server's starter kit placed on the board): a personal plugin switched on during the
// match changes the picture the piece already on the board draws (render/units.js retryAssets — the field view's
// pieceArt introspection), and switched off brings the installation's back (DESIGN §32 P1a review round 2).
// A server without plugins: its page never asks for the catalogue, a visual set or a plugin file — the title shows no
// count, the room's 插件 panel says there is none, 设置 has no 外观插件 (/healthz and welcome send no count) — and its title
// page loads none of the plugin panel, the asset store or what composes a set (the panel's code only once it opens).
//
// Screenshots: test/e2e/out/plugins-*.png, plugins-board-*.png.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client, ROOT, hasChrome, sleep, problemsOf, startRealServer } from '../e2e/client.mjs';
import { png, writePlugin, cosmetic } from '../helpers/pluginFixtures.js';

const ENABLED = process.env.SP_E2E === '1' && hasChrome();

/** Two operators of the 干员调配 roster with an avatar in data/assets.json: [chess record, its avatar asset id]. */
function twoOperators() {
  const chess = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/chess.json'), 'utf8'));
  const assets = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/assets.json'), 'utf8'));
  const list = Object.values(chess.chess || chess)
    .filter((c) => c && !c.isGolden && !c.isDiy && c.visible !== false && !c.isHidden && (!c.baseId || c.baseId === c.chessId))
    .map((c) => [c, c.assets?.avatar || c.charId])
    .filter(([, id]) => typeof id === 'string' && !id.endsWith('_2') && assets.chars?.[id]?.avatar);
  return [list[0], list[1]];
}

/** The avatar a page draws for an asset id now (data.get('assets'): the art every screen reads). */
const avatarOf = (c, id) => c.page.evaluate((k) => globalThis.__SP__.data.get('assets')?.chars?.[k]?.avatar ?? null, id);

describe('cosmetic plugins in the browser (P1a)', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome)' }, () => {
  test('the host switches a room plugin on → the other player sees the new avatar; a personal plugin changes its own page only', { timeout: 4 * 60 * 1000 }, async () => {
    const [[roomChess, roomId], [, personalId]] = twoOperators();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-plugins-e2e-'));
    writePlugin(path.join(tmp, 'room-skin'), cosmetic({ name: { zh: '红色头像', en: 'Red avatar' }, authors: ['e2e'],
      assets: { chars: { [roomId]: { avatar: 'art/red.png' } } } }), { 'art/red.png': png(8, 8, [255, 0, 0, 255]) });
    writePlugin(path.join(tmp, 'my-skin'), cosmetic({ name: { zh: '绿色头像', en: 'Green avatar' }, scope: ['personal'],
      assets: { chars: { [personalId]: { avatar: 'art/green.png' } } } }), { 'art/green.png': png(8, 8, [0, 255, 0, 255]) });
    const { startServer } = await import('../../server/index.js');
    const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, pluginsDir: tmp });
    // the content-hash index (built ~1 s after the start): the page then loads the served manifest's /assets/~<hash>/ URLs
    for (const t0 = Date.now(); Date.now() - t0 < 20000;) {
      const h = await fetch(`${srv.url}/healthz?traffic=1`).then((r) => r.json(), () => null);
      if (!h?.assetHashes || h.assetHashes.ready) break;
      await sleep(150);
    }
    const P = (await import('puppeteer-core')).default;
    const host = new Client(P, srv.url, 'host', { prefix: 'plugins', w: 1600, h: 900 });
    const guest = new Client(P, srv.url, 'guest', { prefix: 'plugins', w: 1600, h: 900 });
    try {
      await host.open();
      // the title screen names the server's plugins
      await host.page.waitForSelector('[data-testid="title-plugins"]', { timeout: 15000 });
      assert.match(await host.page.$eval('[data-testid="title-plugins"]', (e) => e.textContent), /本服务器安装了 2 个插件/);
      await host.shot('title');
      await host.enter('凯尔希');
      const { code } = await host.createCoop();
      await guest.open();
      await guest.enter('阿米娅');
      await guest.click('.mode-card', '同盟模拟');
      await guest.click('.join-row input');
      await guest.page.keyboard.type(code);
      await guest.click('.join-row button', '加入同盟');
      await guest.page.waitForSelector('.room-screen', { timeout: 15000 });
      for (const c of [host, guest]) {
        await c.page.waitForFunction(() => !!globalThis.__SP__.data.get('assets'), { timeout: 20000 });
        assert.match(await c.page.$eval('[data-testid="plugin-tag"]', (e) => e.textContent), /原版/, `${c.label}: 原版 at the top`);
        assert.doesNotMatch(String(await avatarOf(c, roomId)), /^\/p\//);
      }
      const vanilla = await avatarOf(guest, roomId);
      const vanillaCs = await guest.page.evaluate(() => globalThis.__SP__.store.get().content?.vanilla);

      // the host switches the room plugin on in the 插件 panel
      await host.click('[data-testid="plugin-tag"]');
      await host.page.waitForSelector('[data-testid="plugin-panel"] [data-plugin="room-skin"]', { timeout: 10000 });
      assert.equal(await host.page.$('[data-testid="plugin-panel"] [data-plugin="my-skin"]'), null, 'a personal-only plugin is not offered to the room');
      await host.click('[data-plugin="room-skin"] button[role="switch"]');
      await host.page.waitForFunction(() => document.querySelector('[data-plugin="room-skin"] button[role="switch"]')?.getAttribute('aria-checked') === 'true', { timeout: 10000 });
      await host.shot('panel-host');
      await host.click('.modal__actions button', '完成');

      // the other player: the room's art, its avatar loaded in the 干员调配 card; 插件 ×1; the vanilla cs
      await guest.page.waitForFunction((k) => /^\/p\/room-skin\/[0-9a-f]{8}\/art\/red\.png$/.test(globalThis.__SP__.data.get('assets')?.chars?.[k]?.avatar || ''), { timeout: 20000 }, roomId);
      assert.match(await guest.page.$eval('[data-testid="plugin-tag"]', (e) => e.textContent), /插件 ×1/);
      const content = await guest.page.evaluate(() => globalThis.__SP__.store.get().room.content);
      assert.equal(content.cs, vanillaCs, 'art never changes a battle: the vanilla cs');
      assert.deepEqual(content.plugins.map((p) => p.id), ['room-skin']);
      await guest.click('.room-loadout');
      const card = `[data-chess="${roomChess.chessId}"] .lo-card__art img`;
      await guest.page.waitForSelector(`[data-chess="${roomChess.chessId}"]`, { timeout: 20000 });
      await guest.page.$eval(`[data-chess="${roomChess.chessId}"]`, (e) => e.scrollIntoView({ block: 'center' }));
      await guest.page.waitForFunction((sel) => { const img = document.querySelector(sel); return !!img && /\/p\/room-skin\//.test(img.src) && img.complete && img.naturalWidth === 8; }, { timeout: 20000 }, card);
      await sleep(300);
      await guest.shot('loadout-room-avatar');
      await guest.page.keyboard.press('Escape');
      await sleep(300);

      // a personal plugin nobody switched on changes nothing
      for (const c of [host, guest]) assert.doesNotMatch(String(await avatarOf(c, personalId)), /^\/p\//, `${c.label}: the personal plugin is off`);
      // the guest switches it on in 设置 → 外观插件: the guest's page only
      await guest.click('.room-screen [data-testid="settings-btn"]');
      await guest.page.waitForSelector('[data-testid="personal-plugins"] [data-plugin="my-skin"]', { timeout: 10000 });
      await guest.page.$eval('[data-testid="personal-plugins"]', (e) => e.scrollIntoView({ block: 'center' }));
      await guest.click('[data-testid="personal-plugins"] [data-plugin="my-skin"] button[role="switch"]');
      await guest.page.waitForFunction((k) => /^\/p\/my-skin\//.test(globalThis.__SP__.data.get('assets')?.chars?.[k]?.avatar || ''), { timeout: 20000 }, personalId);
      await guest.shot('settings-personal');
      await guest.click('.modal__actions button', '完成');
      assert.match(String(await avatarOf(guest, roomId)), /^\/p\/room-skin\//, 'the room\'s art stays under the personal one');
      assert.deepEqual(await guest.page.evaluate(() => JSON.parse(localStorage.getItem('sp.pref.cosmetics'))), ['my-skin'], 'kept in this browser');
      await sleep(800);
      assert.doesNotMatch(String(await avatarOf(host, personalId)), /^\/p\//, 'the host\'s page never sees the guest\'s personal plugin');
      assert.equal(await host.page.evaluate(() => localStorage.getItem('sp.pref.cosmetics')), null);

      // the host switches the room plugin off: its art leaves the guest's page, the personal one stays
      await host.click('[data-testid="plugin-tag"]');
      await host.click('[data-plugin="room-skin"] button[role="switch"]');
      await guest.page.waitForFunction((k, v) => globalThis.__SP__.data.get('assets')?.chars?.[k]?.avatar === v, { timeout: 20000 }, roomId, vanilla);
      assert.match(String(await avatarOf(guest, personalId)), /^\/p\/my-skin\//);
      assert.match(await guest.page.$eval('[data-testid="plugin-tag"]', (e) => e.textContent), /原版/);
      await guest.shot('room-vanilla-again');

      // no errors; a failed request only for the game's own art when this checkout has none
      const art = fs.existsSync(path.join(ROOT, 'public/assets'));
      const problems = problemsOf([host, guest]).filter((p) => art || !/\/assets\//.test(p));
      assert.deepEqual(problems, []);
    } finally {
      await host.close();
      await guest.close();
      await srv.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('a server without plugins: its page never asks for the catalogue (title, the room\'s 插件 panel, 设置)', { timeout: 2 * 60 * 1000 }, async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-plugins-none-'));
    const { startServer } = await import('../../server/index.js');
    const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, pluginsDir: tmp });
    const seen = [];
    srv.server.on('request', (req) => seen.push(req.url));
    const P = (await import('puppeteer-core')).default;
    const c = new Client(P, srv.url, 'vanilla', { prefix: 'plugins-none', w: 1600, h: 900 });
    try {
      await c.open();
      // the build guard's first /healthz (before any hello) says how many plugins the server has — none here
      for (const t0 = Date.now(); !seen.some((u) => u.startsWith('/healthz')) && Date.now() - t0 < 15000;) await sleep(100);
      await sleep(300);
      assert.equal(await c.page.evaluate(() => globalThis.__SP__.store.get().installedPlugins), 0, '/healthz sent no count');
      assert.equal(await c.page.$('[data-testid="title-plugins"]'), null, 'no count on the title');
      const lazy = ['/js/assets.js', '/js/ui/pluginPanel.js', '/shared/plugins/visual.js'];
      const loaded = (u) => seen.some((x) => x.split('?')[0] === u);
      assert.ok(loaded('/js/content.js') && loaded('/js/cosmetics.js'), 'the small parts load with the page');
      for (const u of lazy) assert.equal(loaded(u), false, `the title page does not load ${u}`);
      await c.enter('凯尔希');
      await c.createCoop();
      await c.click('[data-testid="plugin-tag"]');
      await c.page.waitForSelector('[data-testid="plugin-panel"]', { timeout: 10000 });
      assert.match(await c.page.$eval('[data-testid="plugin-panel"]', (e) => e.textContent), /本服务器没有可在房间中使用的插件/);
      await c.click('.modal__actions button', '完成');
      await c.click('.room-screen [data-testid="settings-btn"]');
      await c.page.waitForSelector('.set-list', { timeout: 10000 });
      assert.equal(await c.page.$('[data-testid="personal-plugins"]'), null, 'no 外观插件 section');
      await sleep(500);
      assert.deepEqual(seen.filter((u) => /^\/(plugins|vs|p)\//.test(u)), [], 'no catalogue, no visual set, no plugin file');
      assert.equal(loaded('/js/ui/pluginPanel.js'), true, 'the panel\'s code once it opened');
      assert.equal(loaded('/shared/plugins/visual.js'), false, 'never what composes a set');
      assert.equal(loaded('/js/assets.js'), false, 'nor the asset store before a match');
      const art = fs.existsSync(path.join(ROOT, 'public/assets'));
      assert.deepEqual(problemsOf([c]).filter((p) => art || !/\/assets\//.test(p)), []);
    } finally {
      await c.close();
      await srv.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('a match already drawn: a personal plugin switched on → the piece on the board draws its picture; off → the installation\'s again', { timeout: 4 * 60 * 1000 }, async () => {
    const [[chess, avatarId]] = twoOperators();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-plugins-board-'));
    writePlugin(path.join(tmp, 'board-skin'), cosmetic({ name: { zh: '棋盘头像', en: 'Board avatar' }, scope: ['personal'],
      assets: { chars: { [avatarId]: { avatar: 'art/blue.png' } } } }), { 'art/blue.png': png(8, 8, [0, 0, 255, 255]) });
    const srv = await startRealServer({ fast: { timerScale: 1, combatSpeed: 2, startRound: 1, chess: [chess.chessId], autoPlace: true }, pluginsDir: tmp });
    const P = (await import('puppeteer-core')).default;
    const c = new Client(P, srv.base, 'solo', { prefix: 'plugins-board', w: 1600, h: 900 });
    const art = (uid) => c.page.evaluate((u) => globalThis.__SP_VIEW__?.raw?.pieceArt?.(u) ?? null, uid);
    try {
      await c.open();
      await c.enter('凯尔希');
      await c.click('.mode-card', '独立模拟');
      await c.click('.diff-card', '标准模拟');
      await c.click('.create-box button', '开始独立模拟');
      await c.waitFor((s) => !!s.room, 'solo room');
      if (!(await c.st()).phase) await c.click('.room-bar__right button', '开始模拟', { timeout: 20000 });
      await c.waitFor((s) => s.phase === 'INFO_CHECK', 'briefing', 30000);
      await c.click('.brief__foot .btn--primary', '准备就绪');
      await c.waitFor((s) => s.phase === 'BAND_DRAFT', 'band draft', 30000);
      await c.click('.dband', null, { nth: 1 });
      await c.click('.draft-detail__btns .btn--primary', '确认选择');
      await c.waitFor((s) => s.phase === 'PREP' && s.board > 0, 'prep with the starter kit on the board', 60000);
      const piece = (await c.boardPieces()).find((p) => p.id === chess.chessId);
      assert.ok(piece, 'the kit operator stands on the board');
      // the board drew the installation's picture for it
      await c.page.waitForFunction((u) => !!globalThis.__SP_VIEW__?.raw?.pieceArt?.(u)?.picture, { timeout: 20000 }, piece.uid);
      const before = await art(piece.uid);
      assert.doesNotMatch(before.picture, /^\/p\//);
      // switched on during the match (设置 → 外观插件 — that switch is the first test's): the view already drawn follows
      await c.page.evaluate(() => import('/js/content.js').then((m) => m.setPersonalPlugin('board-skin', true)));
      await c.page.waitForFunction((u) => { const a = globalThis.__SP_VIEW__.raw.pieceArt(u); return /^\/p\/board-skin\/[0-9a-f]{8}\/art\/blue\.png$/.test(a?.picture || '') && a.pictureState === 'img'; },
        { timeout: 20000 }, piece.uid);
      await c.shot('personal-on');
      // switched off: the installation's picture again
      await c.page.evaluate(() => import('/js/content.js').then((m) => m.setPersonalPlugin('board-skin', false)));
      await c.page.waitForFunction((u, v) => globalThis.__SP_VIEW__.raw.pieceArt(u)?.picture === v, { timeout: 20000 }, piece.uid, before.picture);
      const assetsHere = fs.existsSync(path.join(ROOT, 'public/assets'));
      assert.deepEqual(problemsOf([c]).filter((p) => assetsHere || !/\/assets\//.test(p)), []);
    } finally {
      await c.close();
      await srv.stop();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
