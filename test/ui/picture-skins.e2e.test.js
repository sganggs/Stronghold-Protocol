// SP_E2E=1 node --test test/ui/picture-skins.e2e.test.js
// Original synthetic PNGs; no installed game art, plugins or Chrome needed for ordinary CI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHROME, hasChrome } from '../e2e/client.mjs';
import { png } from '../helpers/pluginFixtures.js';
import { CHAR, manifest, chess } from '../helpers/pictureSkins.js';

test('picture-only picker updates a card and avatar live, preserves other seats and restores defaults',
  { skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 60000 }, async () => {
    const { startServer } = await import('../../server/index.js');
    const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, assetIndex: false });
    const puppeteer = (await import('puppeteer-core')).default;
    let browser;
    try {
      browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--mute-audio'] });
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      // A minimal same-origin document mounts the production components, without the game's route / socket lifecycle.
      await page.setRequestInterception(true);
      const image = png(4, 4);
      page.on('request', (req) => {
        const path = new URL(req.url()).pathname;
        if (path === '/picture-skins-test') void req.respond({ status: 200, contentType: 'text/html', body:
          '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><link rel="stylesheet" href="/css/theme.css"><link rel="stylesheet" href="/css/components.css"><link rel="stylesheet" href="/css/screens/loadout.css"><link rel="stylesheet" href="/css/screens/game.css"><body><div id="test"></div></body></html>' });
        else if (/^\/(base|skin|backup).*\.png$/.test(path)) void req.respond({ status: 200, contentType: 'image/png', body: image });
        else void req.continue();
      });
      await page.goto(`${server.url}/picture-skins-test`);
      await page.evaluate(async ({ manifest, chess }) => {
        const { data } = await import('/js/data.js');
        const { store } = await import('/js/store.js');
        const { setSkins } = await import('/js/ui/skins.js');
        const { render } = await import('/vendor/preact.module.js');
        const { html } = await import('/js/ui/components.js');
        const { SkinSection } = await import('/js/ui/skinPicker.js');
        const { ChessCard } = await import('/js/ui/shopBar.js');
        const { UnitThumb } = await import('/js/ui/gameComponents.js');
        await data.loadAll('chess', 'assets', 'backups', 'items', 'effects', 'garrisons');
        setSkins({});
        data.setContent({ id: 'b'.repeat(64), values: { assets: manifest, chess: { [chess.chessId]: chess } } });
        store.set({ me: { playerId: 'one' }, match: { ...store.get().match,
          public: { players: [{ playerId: 'two', skins: { [chess.charId]: 'avatar' } }] } } });
        render(html`<div style="max-width:800px">
          <${SkinSection} charId=${chess.charId} />
          <div id="own"><${ChessCard} slot=${{ id: chess.chessId, price: 1 }} idx=${0} priv=${{}} />
            <${UnitThumb} id=${chess.chessId} /></div>
          <div id="peer"><${ChessCard} slot=${{ id: chess.chessId, price: 1 }} idx=${1} priv=${{ playerId: 'two' }} />
            <${UnitThumb} id=${chess.chessId} ownerId="two" /></div>
        </div>`, document.querySelector('#test'));
      }, { manifest, chess });
      await page.waitForSelector('[data-skin="picture"]');
      for (const [width, height] of [[1280, 720], [844, 390]]) {
        await page.setViewport({ width, height });
        assert.ok(await page.$eval('[data-skin="picture"]', (e) => {
          const tile = e.getBoundingClientRect(), note = e.querySelector('.lo-skin__note').getBoundingClientRect();
          return note.width > 0 && note.left >= tile.left && note.right <= tile.right && note.bottom <= tile.bottom;
        }), 'picture-only note fits its tile');
      }
      assert.match(await page.$eval('[data-skin="picture"]', (e) => e.textContent), /仅更换头像与立绘/);
      assert.equal(await page.$('[data-skin="empty"]'), null);
      assert.doesNotMatch(await page.$eval('[data-skin="model"]', (e) => e.textContent), /仅更换头像与立绘/);
      await page.click('[data-skin="picture"]');
      await page.waitForFunction(() => document.querySelector('#own .scard__art')?.getAttribute('src') === '/skin-p.png');
      assert.equal(await page.$eval('#own .uthumb img', (e) => e.getAttribute('src')), '/skin-a.png');
      assert.equal(await page.$eval('#peer .scard__art', (e) => e.getAttribute('src')), '/base-p.png');
      assert.equal(await page.$eval('[data-skin="picture"]', (e) => e.getAttribute('aria-checked')), 'true');
      assert.equal(await page.evaluate((id) => JSON.parse(localStorage.getItem('sp.pref.skins'))[id], CHAR), 'picture');
      await page.waitForFunction(() => [...document.querySelectorAll('#own img, #peer img')].every((e) => e.complete && e.naturalWidth > 0));
      await page.evaluate(async () => { (await import('/js/ui/settingsStore.js')).settingsStore.set({ otherSkins: false }); });
      await page.waitForFunction(() => document.querySelector('#peer .uthumb img')?.getAttribute('src') === '/base-a.png');
      assert.equal(await page.$eval('#own .uthumb img', (e) => e.getAttribute('src')), '/skin-a.png');
      await page.evaluate(async () => { (await import('/js/ui/settingsStore.js')).settingsStore.set({ otherSkins: true }); });
      await page.waitForFunction(() => document.querySelector('#peer .uthumb img')?.getAttribute('src') === '/skin-a.png');
      await page.evaluate(async (id) => {
        const { store } = await import('/js/store.js');
        store.set({ match: { ...store.get().match, public: { players: [{ playerId: 'two', skins: { [id]: 'picture' } }] } } });
      }, CHAR);
      await page.waitForFunction(() => document.querySelector('#peer .scard__art')?.getAttribute('src') === '/skin-p.png');
      await page.evaluate(async () => {
        const { store } = await import('/js/store.js');
        store.set({ match: { ...store.get().match, public: { players: [{ playerId: 'two' }] } } });
      });
      await page.waitForFunction(() => document.querySelector('#peer .scard__art')?.getAttribute('src') === '/base-p.png');
      await page.click('[data-skin=""]');
      await page.waitForFunction(() => document.querySelector('#own .scard__art')?.getAttribute('src') === '/base-p.png');
      await page.click('[data-skin="picture"]');
      await page.waitForFunction(() => document.querySelector('#own .scard__art')?.getAttribute('src') === '/skin-p.png');
      await page.evaluate(async ({ manifest, chess }) => {
        for (const rec of Object.values(manifest.chars)) delete rec.skins;
        const { data } = await import('/js/data.js');
        data.setContent({ id: 'c'.repeat(64), values: { assets: manifest, chess: { [chess.chessId]: chess } } });
      }, { manifest, chess });
      await page.waitForFunction(() => document.querySelector('#own .scard__art')?.getAttribute('src') === '/base-p.png');
      assert.equal(await page.$('[data-testid="skin-section"]'), null);
      assert.equal(await page.evaluate((id) => JSON.parse(localStorage.getItem('sp.pref.skins'))[id], CHAR), 'picture');
      assert.deepEqual(errors, []);
    } finally {
      try { await browser?.close(); } finally { await server.close(); }
    }
  });
