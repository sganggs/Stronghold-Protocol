// #745: real settlement DOM with equipped rows, five languages, desktop/phone and loaded/failed official art.
// SP_E2E=1 node --test test/ui/settle.e2e.test.js
// SP_SETTLE_SHOTS optionally saves both pages (personal at the root, alliance under team/).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { CHROME, hasChrome, startRealServer } from '../e2e/client.mjs';

const enabled = process.env.SP_E2E === '1' && hasChrome();
const languages = ['zh-CN', 'en', 'ja', 'ko', 'zh-TW'];

describe('settlement layout (#745, headless Chrome)', { skip: !enabled }, () => {
  let server, browser;
  before(async () => {
    const puppeteer = (await import('puppeteer-core')).default;
    server = await startRealServer();
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--mute-audio'] });
    if (process.env.SP_SETTLE_SHOTS) mkdirSync(path.join(process.env.SP_SETTLE_SHOTS, 'team'), { recursive: true });
  });
  after(async () => {
    try { await browser?.close(); } finally { await server?.stop(); } // stop this server's child PID
  });

  async function checkTitle(page, selector) {
    // ResizeObserver runs after layout; wait for the measured text to fit rather than a fixed delay.
    await page.waitForFunction((s) => {
      const box = document.querySelector(s), text = box?.firstElementChild;
      if (!text) return false;
      const b = box.getBoundingClientRect(), t = text.getBoundingClientRect();
      return t.width > 0 && t.left >= b.left - 1 && t.right <= b.right + 1 && t.top >= b.top - 1 && t.bottom <= b.bottom + 1;
    }, { timeout: 5000 }, selector);
    const clear = await page.$eval(selector, (box) => {
      const b = box.getBoundingClientRect();
      const obstacles = box.classList.contains('sself__title') ? '.sops, .sop, .sself__rounds, .sself__medals' : '.steam__rounds';
      return [...document.querySelectorAll(obstacles)].every((el) => {
        const r = el.getBoundingClientRect();
        return !r.width || !r.height || b.right <= r.left || b.left >= r.right || b.bottom <= r.top || b.top >= r.bottom;
      });
    });
    assert.ok(clear, `${selector}: the title box does not overlap neighboring content`);
  }

  async function checkButtons(page, noart) {
    const buttons = await page.$$eval('.settle__next, .sbtn', (els) => els.map((el) => {
      el.blur(); // sample idle styling atomically, after any delayed page-entry focus
      const bg = el.querySelector('.settle__btnbg'), style = getComputedStyle(el);
      return { tag: bg?.tagName, loaded: bg instanceof HTMLImageElement && bg.complete && bg.naturalWidth > 0,
        fallback: bg?.className.includes('--'), background: style.backgroundColor, image: style.backgroundImage,
        // A keyboard focus ring is intentional. Blur in the test to check the idle decoration.
        shadow: style.boxShadow, fallbackImage: bg && getComputedStyle(bg).backgroundImage,
        fallbackColor: bg && getComputedStyle(bg).backgroundColor };
    }));
    assert.ok(buttons.length);
    for (const b of buttons) {
      assert.equal(b.background, 'rgba(0, 0, 0, 0)');
      assert.equal(b.image, 'none');
      assert.equal(b.shadow, 'none');
      assert.equal(b.tag, noart ? 'SPAN' : 'IMG');
      if (noart) assert.ok(b.fallback && (b.fallbackImage !== 'none' || b.fallbackColor !== 'rgba(0, 0, 0, 0)'));
      else assert.ok(b.loaded);
    }
  }

  for (const lang of languages) for (const [width, height] of [[1280, 720], [844, 390]]) for (const noart of [false, true]) {
    test(`${lang} ${width}×${height} ${noart ? 'noart' : 'art'}`, async () => {
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      const errors = [];
      const languageWarnings = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => {
        if (m.text().startsWith('[i18n]') && ['warn', 'error'].includes(m.type())) languageWarnings.push(m.text());
      });
      try {
        await page.setViewport({ width, height, deviceScaleFactor: 1 });
        await page.setBypassServiceWorker(true);
        await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
        if (noart) {
          await page.setRequestInterception(true);
          page.on('request', (r) => {
            if (new URL(r.url()).pathname.startsWith('/assets/')) void r.respond({ status: 404, body: '' });
            else void r.continue();
          });
        }
        await page.goto(`${server.base}/dev/game-mock.html?shot=1&render=fallback&phase=RESULT&variant=equipped`, { waitUntil: 'networkidle0' });
        await page.waitForSelector('.sself__title');
        const translatedTitle = await page.evaluate(async (lang) => {
          const { loadLangIndex, switchLang } = await import('/js/ui/lang.js');
          const { t, getLangs } = await import('/shared/i18n.js');
          const expected = lang === 'zh-CN' ? 'zh' : lang;
          // main.js calls initLang() before rendering. The dev mock skips it, so register the real packs first.
          if (!(await loadLangIndex())) throw new Error('language index did not load');
          const actual = await switchLang(expected);
          if (actual !== expected) throw new Error(`language pack did not load: ${lang}; got ${actual}; registered: ${getLangs().map((l) => l.code).join(', ')}`);
          // The dev harness has no main.js App language subscription: refresh its existing mock result.
          globalThis.__MOCK__.setPhase('RESULT');
          await document.fonts.ready;
          return t('模拟完成'); // i18n-ignore: test reads the same heading msgid as the screen
        }, lang).catch((error) => {
          throw new Error(`${error.message}\n${languageWarnings.join('\n')}`, { cause: error });
        });
        await page.waitForNetworkIdle();
        assert.equal(await page.$eval('.sself__title', (el) => el.textContent), translatedTitle);
        for (const size of ['sm', 'md', 'lg', 'xl']) {
          await page.evaluate((size) => { document.documentElement.dataset.text = size; }, size);
          await checkTitle(page, '.sself__title');
        }
        await page.evaluate(() => { document.documentElement.dataset.text = 'md'; document.activeElement?.blur(); });
        await checkTitle(page, '.sself__title');
        const slots = await page.$$eval('.sop__slot.has-item', (els) => els.map((el) => {
          const s = el.getBoundingClientRect(), im = el.querySelector('img'), r = im?.getBoundingClientRect();
          const row = el.parentElement.getBoundingClientRect();
          return { loaded: !!im?.naturalWidth, fallback: !!el.querySelector('b'), objectFit: im && getComputedStyle(im).objectFit,
            contained: !r || (r.left >= s.left - .5 && r.right <= s.right + .5 && r.top >= s.top - .5 && r.bottom <= s.bottom + .5),
            slotFits: s.left >= row.left && s.right <= row.right && s.top >= row.top && s.bottom <= row.bottom };
        }));
        assert.equal(slots.length, 3, 'the fixture actually equips operators');
        for (const s of slots) {
          assert.ok(s.contained && s.slotFits);
          if (noart) assert.ok(s.fallback);
          else { assert.ok(s.loaded); assert.equal(s.objectFit, 'contain'); }
        }
        await checkButtons(page, noart);
        const name = `${lang}-${width}x${height}-${noart ? 'noart' : 'art'}.png`;
        if (process.env.SP_SETTLE_SHOTS) await page.screenshot({ path: path.join(process.env.SP_SETTLE_SHOTS, name) });
        await page.click('.settle__next');
        await page.waitForSelector('.steam__title');
        await page.waitForNetworkIdle();
        assert.equal(await page.$eval('.steam__title', (el) => el.textContent), translatedTitle);
        for (const size of ['sm', 'md', 'lg', 'xl']) {
          await page.evaluate((size) => { document.documentElement.dataset.text = size; }, size);
          await checkTitle(page, '.steam__title');
        }
        await page.evaluate(() => { document.documentElement.dataset.text = 'md'; document.activeElement?.blur(); });
        await checkTitle(page, '.steam__title');
        await checkButtons(page, noart);
        if (process.env.SP_SETTLE_SHOTS) await page.screenshot({ path: path.join(process.env.SP_SETTLE_SHOTS, 'team', name) });
        await page.click('.steam__detail');
        await page.waitForSelector('[data-testid="settle-detail"]');
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });
  }
});
