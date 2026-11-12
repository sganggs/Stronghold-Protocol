// SP_E2E=1 node --test test/ui/fullscreen-help.e2e.test.js
// Chrome emulation covers UI selection and layout. Physical iPhone Safari remains a manual check.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedReleaseRead } from '../helpers/releaseNotes.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'test/e2e/out');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);
const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';

describe('fullscreen Home Screen guidance', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome) to run' }, () => {
  let srv, browser, base;
  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    base = `http://127.0.0.1:${srv.port}`;
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
    mkdirSync(OUT, { recursive: true });
  });
  after(async () => { await browser?.close(); await srv?.close(); });

  async function open(t, { ios = true, standalone = false, native = false, match = false, lang = 'zh', width = 844, height = 390 } = {}) {
    const context = await browser.createBrowserContext();
    t.after(() => context.close());
    const page = await context.newPage();
    await page.setViewport({ width, height, isMobile: true, hasTouch: true, isLandscape: true });
    if (ios) await page.setUserAgent(IOS_UA);
    await page.evaluateOnNewDocument(({ standalone, native }) => {
      Object.defineProperty(navigator, 'standalone', { configurable: true, value: standalone });
      Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: native });
      Object.defineProperty(document, 'webkitFullscreenEnabled', { configurable: true, value: false });
      if (native) {
        let active = null;
        globalThis.__FULLSCREEN_CALLS__ = 0;
        Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => active });
        Element.prototype.requestFullscreen = async function () {
          globalThis.__FULLSCREEN_CALLS__++;
          active = this;
          document.dispatchEvent(new Event('fullscreenchange'));
        };
        document.exitFullscreen = async () => { active = null; document.dispatchEvent(new Event('fullscreenchange')); };
      }
    }, { standalone, native });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    t.after(() => assert.deepEqual(errors, [], 'page has no JavaScript exceptions'));
    await seedReleaseRead(page);
    const entry = match ? '/dev/game-mock.html?shot=1&render=fallback&phase=PREP' : '/?render=fallback';
    await page.goto(`${base}${entry}&lang=${lang}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector(match ? '.gm' : '.title-screen');
    return page;
  }

  for (const [match, width, height] of [[false, 844, 390], [true, 844, 390], [false, 640, 360], [true, 640, 360]]) {
    test(`${match ? 'match' : 'title'} opens usable guidance at ${width}×${height}`, async t => {
      const page = await open(t, { match, width, height });
      await page.click('.fsbtn:not(.title-settings)');
      await page.waitForSelector('.modal');
      await page.$eval('.modal', el => Promise.all(el.getAnimations({ subtree: true }).map(animation => animation.finished)));
      assert.match(await page.$eval('.modal', el => el.textContent), /iPhone 全屏/);
      assert.equal(await page.$$eval('.modal ol li', items => items.length), 3);
      assert.equal(await page.$eval('.fsbtn:not(.title-settings)', el => el.getAttribute('aria-haspopup')), 'dialog');
      assert.equal(await page.$eval('.fsbtn:not(.title-settings)', el => el.hasAttribute('aria-pressed')), false);
      assert.equal(await page.$eval('.modal__box', el => {
        const r = el.getBoundingClientRect();
        return r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1;
      }), true, 'dialog fits the phone viewport');
      await page.$eval('.modal ol li:last-child', el => el.scrollIntoView({ block: 'nearest' }));
      await page.screenshot({ path: path.join(OUT, `fullscreen-help-${match ? 'match' : 'title'}-${width}.png`) });
      await page.click('.modal__actions button');
      await page.waitForFunction(() => !document.querySelector('.modal'));
      await page.click('.fsbtn:not(.title-settings)');
      await page.waitForSelector('.modal');
    });
  }

  test('already standalone iPhone hides the unsupported fullscreen control', async t => {
    const page = await open(t, { standalone: true });
    assert.equal(await page.$('.fsbtn:not(.title-settings)'), null);
  });

  test('a non-iOS browser without fullscreen hides the control', async t => {
    const page = await open(t, { ios: false });
    assert.equal(await page.$('.fsbtn:not(.title-settings)'), null);
  });

  test('native fullscreen takes priority on iOS and toggles without opening guidance', async t => {
    const page = await open(t, { native: true, standalone: true });
    await page.click('.fsbtn:not(.title-settings)');
    await page.waitForFunction(() => document.querySelector('.fsbtn:not(.title-settings)')?.getAttribute('aria-pressed') === 'true');
    assert.equal(await page.evaluate(() => globalThis.__FULLSCREEN_CALLS__), 1);
    assert.equal(await page.$('.modal'), null);
    await page.click('.fsbtn:not(.title-settings)');
    await page.waitForFunction(() => document.querySelector('.fsbtn:not(.title-settings)')?.getAttribute('aria-pressed') === 'false');
  });

  test('English guidance uses the selected language', async t => {
    const page = await open(t, { lang: 'en' });
    await page.click('.fsbtn:not(.title-settings)');
    await page.waitForSelector('.modal');
    assert.match(await page.$eval('.modal', el => el.textContent), /Safari/);
    assert.match(await page.$eval('.modal', el => el.textContent), /Add to Home Screen/);
    assert.doesNotMatch(await page.$eval('.modal', el => el.textContent), /添加到主屏幕/);
  });
});
