// Browser check of 设置 →「异形屏适配」 (opt-in, needs Chrome, ~30 s):
//   SP_E2E=1 CHROME_PATH=… node --test test/ui/screen-fit.e2e.test.js
//
// With stored offsets the screens' box (.app-root) is inset by them, the board's host and canvas fill that box, and the
// layout root 1rem is computed from it; the settings section moves an edge live and 重置 returns the page to exactly the
// unmoved one (no <html data-fit>). Static counterpart: test/ui/screen-fit.test.js.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('异形屏适配 (headless Chrome)', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome) to run' }, () => {
  let srv;
  let browser;
  let base;

  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    base = `http://127.0.0.1:${srv.port}`;
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--force-device-scale-factor=1'] });
  });

  after(async () => {
    await browser?.close();
    await srv?.close();
  });

  /** A page watching for console / page errors, with `sp.pref.screenFit` seeded before the first script runs. */
  async function open(query, viewport, fit = null) {
    const page = await browser.newPage();
    await page.setViewport(viewport);
    const problems = [];
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    if (fit) await page.evaluateOnNewDocument((f) => { try { localStorage.setItem('sp.pref.screenFit', JSON.stringify(f)); } catch { /* ignore */ } }, fit);
    await page.goto(`${base}/dev/game-mock.html?shot=1&${query}`, { waitUntil: 'networkidle0', timeout: 60000 });
    return { page, problems };
  }

  const boxes = (page) => page.evaluate(() => {
    const r = (sel) => {
      const b = document.querySelector(sel)?.getBoundingClientRect();
      return b ? [b.left, b.top, b.right, b.bottom].map(Math.round) : null;
    };
    return {
      fit: document.documentElement.hasAttribute('data-fit'),
      rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
      app: r('.app-root'),
      field: r('.gm__field'),
      canvas: r('.gm__field canvas'),
    };
  });

  test('stored offsets: the screens, the board and the layout root inside the inset box (844×390 and 1920×1080)', async () => {
    const phone = await open('phase=PREP', { width: 844, height: 390 }, { l: 40, r: 20, t: 30, b: 0 });
    await phone.page.waitForSelector('.gm__field canvas', { timeout: 60000 });
    await sleep(500);
    const p = await boxes(phone.page);
    assert.equal(p.fit, true);
    assert.deepEqual(p.app, [40, 30, 824, 390]);
    assert.deepEqual(p.field, p.app, 'the board\'s host fills the box');
    assert.deepEqual(p.canvas, p.app, 'the canvas is sized from its host');
    assert.equal(p.rem, 40, 'the phone\'s clamp still holds');
    assert.deepEqual(phone.problems, []);
    await phone.page.close();

    const desk = await open('phase=PREP', { width: 1920, height: 1080 }, { l: 100, r: 0, t: 0, b: 0 });
    await desk.page.waitForSelector('.gm__field canvas', { timeout: 60000 });
    await sleep(500);
    const d = await boxes(desk.page);
    assert.deepEqual(d.app, [100, 0, 1920, 1080]);
    assert.ok(Math.abs(d.rem - 1820 / 19.2) < 0.01, `1rem from the box's width: ${d.rem}`);
    assert.deepEqual(desk.problems, []);
    await desk.page.close();
  });

  test('the settings section: + moves an edge live, 重置 returns the unmoved page', async () => {
    // the earlier pages stored offsets in this browser: start from none
    const { page, problems } = await open('phase=PREP&variant=settings', { width: 1280, height: 720 }, { l: 0, r: 0, t: 0, b: 0 });
    await page.waitForSelector('[data-testid="screen-fit"]', { timeout: 10000 });
    const vals = () => page.$$eval('.set-fit__row .set-row__val', (els) => els.map((e) => e.textContent));
    assert.deepEqual(await vals(), ['50', '50', '50', '50']);
    assert.equal(await page.$eval('.set-fit__reset', (b) => b.disabled), true);
    // 顶部 +1 step = 2 px in
    await page.evaluate(() => document.querySelectorAll('.set-fit__row')[2].querySelectorAll('.set-fit__step')[1].click());
    await sleep(200);
    let b = await boxes(page);
    assert.deepEqual([b.fit, b.app?.[1]], [true, 2]);
    assert.deepEqual(await vals(), ['50', '50', '51', '50']);
    await page.click('.set-fit__reset');
    await sleep(200);
    b = await boxes(page);
    assert.deepEqual([b.fit, b.app], [false, [0, 0, 1280, 720]]);
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('sp.pref.screenFit'))), { l: 0, r: 0, t: 0, b: 0 });
    assert.deepEqual(problems, []);
    await page.close();
  });
});
