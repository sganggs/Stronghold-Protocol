// Browser check of the 机变 「轮到你选」 disc (opt-in, needs Chrome, ~40 s):
//   SP_E2E=1 CHROME_PATH=… node --test test/ui/turn-popup.e2e.test.js
//
// Through the dev mock's shared 机变 draft: the pick goes to p4, then back to me (p1) — the disc with the official cube
// shows and leaves; none without the art pack, in a solo draft or with reduced motion. Static counterpart:
// test/ui/turn-popup.test.js.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('轮到你选 disc (headless Chrome)', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome) to run' }, () => {
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

  /**
   * The mock's 机变 draft in a fresh context, past the service worker (its own fetches would skip the interception);
   * `noart` fails /assets/ui/ (the CI view), `reduce` asks for reduced motion.
   */
  async function open({ variant = '', noart = false, reduce = false } = {}) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setBypassServiceWorker(true);
    await page.setViewport({ width: 1920, height: 1080 });
    const problems = [];
    page.on('console', (m) => { if (m.type() === 'error' && !(noart && /Failed to load resource/.test(m.text()))) problems.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    // the mock loads more than the default 250 resource entries: room for the sprites' entries the wait below reads
    await page.evaluateOnNewDocument(() => performance.setResourceTimingBufferSize(5000));
    if (reduce) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    if (noart) {
      await page.setRequestInterception(true);
      page.on('request', (r) => (/\/assets\/ui\//.test(r.url()) ? r.abort() : r.continue()));
    }
    await page.goto(`${base}/dev/game-mock.html?shot=1&render=fallback&phase=SP_DRAFT${variant ? `&variant=${variant}` : ''}`, { waitUntil: 'networkidle0', timeout: 60000 });
    await page.waitForSelector('.spov', { timeout: 30000 });
    if (!noart) await page.waitForFunction(() => performance.getEntriesByType('resource').filter((e) => /effectChoose\//.test(e.name)).length >= 5, { timeout: 15000 });
    await sleep(300);
    return { page, problems, context };
  }

  /** The draft's turn goes to p4, then comes back to me (p1). */
  const myTurnAgain = (page) => page.evaluate(async () => {
    const M = globalThis.__MOCK__;
    M.mutate((s) => { s.pub.sp.turn = 'p4'; }); M.pushPublic();
    await new Promise((r) => setTimeout(r, 300));
    M.mutate((s) => { s.pub.sp.turn = 'p1'; }); M.pushPublic();
  });

  // first: a later page of the same browser was seen getting the sprites past the interception (headless Chrome on
  // Windows), so the CI view is checked before any other page
  test('without the art pack: no disc', async () => {
    const { page, problems, context } = await open({ noart: true });
    await myTurnAgain(page);
    await sleep(500);
    assert.equal(await page.$('[data-testid="turn-popup"]'), null);
    assert.deepEqual(problems, []);
    await context.close();
  });

  test('when the pick comes round to me, the disc with the official cube shows over the cards and leaves', async () => {
    const { page, problems, context } = await open();
    await myTurnAgain(page);
    await page.waitForSelector('[data-testid="turn-popup"]', { timeout: 3000 });
    const s = await page.$eval('[data-testid="turn-popup"]', (el) => ({
      text: el.querySelector('.sptp__text').textContent,
      art: [...el.querySelectorAll('img')].filter((i) => i.naturalWidth > 0).length,
      clicks: getComputedStyle(el).pointerEvents,
    }));
    assert.equal(s.text, '轮到你选');
    assert.ok(s.art >= 8, `the official sprites drawn (${s.art})`);
    assert.equal(s.clicks, 'none', 'the cards stay usable under it');
    await page.waitForFunction(() => !document.querySelector('[data-testid="turn-popup"]'), { timeout: 3000 });
    assert.deepEqual(problems, []);
    await context.close();
  });

  test('a solo draft: no disc', async () => {
    const { page, problems, context } = await open({ variant: 'solo' });
    await myTurnAgain(page);
    await sleep(500);
    assert.equal(await page.$('[data-testid="turn-popup"]'), null);
    assert.deepEqual(problems, []);
    await context.close();
  });

  test('reduced motion: no disc', async () => {
    const { page, problems, context } = await open({ reduce: true });
    await myTurnAgain(page);
    await sleep(500);
    assert.equal(await page.$('[data-testid="turn-popup"]'), null);
    assert.deepEqual(problems, []);
    await context.close();
  });
});
