// Browser check of the top bar's phase capsule scenes (opt-in, needs Chrome, ~40 s):
//   SP_E2E=1 CHROME_PATH=… node --test test/ui/capsule-motion.e2e.test.js
//
// Through the dev mock: SETTLE → 回合开始 (the kettles, the capsule's words hidden under them) → 休整期 (the words come
// back) → 作战 (开始作战, then the kills counter) → 联防 (the two faces, 联防开始); without the art pack and with reduced
// motion no scene plays. Static counterpart: test/ui/capsule-motion.test.js.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('phase capsule scenes (headless Chrome)', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome) to run' }, () => {
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
   * The mock at SETTLE in a fresh context, past the service worker (its own fetches would skip the interception);
   * `noart` answers /assets/ui/ with 404 (the CI view) — also as /assets/~<hash>/ui/, the form the served manifest
   * uses once the server's asset index is ready (shared/assetPaths.js) —, `reduce` asks for reduced motion.
   */
  async function open({ noart = false, reduce = false } = {}) {
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
      page.on('request', (r) => (/\/assets\/(?:~[0-9a-f]{16}\/)?ui\//.test(r.url()) ? r.respond({ status: 404, body: '' }) : r.continue()));
    }
    await page.goto(`${base}/dev/game-mock.html?shot=1&render=fallback&phase=SETTLE`, { waitUntil: 'networkidle0', timeout: 60000 });
    await page.waitForSelector('.gtop__cap', { timeout: 30000 });
    if (!noart) await page.waitForFunction(() => performance.getEntriesByType('resource').filter((e) => /hudPanel\/trans_/.test(e.name)).length >= 9, { timeout: 15000 });
    await sleep(300);
    return { page, problems, context };
  }

  const setPhase = (page, phase) => page.evaluate((phase) => {
    const M = globalThis.__MOCK__;
    M.setPhase(phase);
    if (phase === 'ROUND_START') { M.mutate((s) => { s.pub.round = (s.pub.round || 1) + 1; }); M.pushPublic(); }
  }, phase);

  const cap = (page) => page.evaluate(() => {
    const el = document.querySelector('.gtop__cap');
    const vis = (q) => { const e = el.querySelector(q); return e ? getComputedStyle(e).visibility === 'visible' && Number(getComputedStyle(e).opacity) > 0.9 : null; };
    return {
      cls: el.className,
      kettles: [...el.querySelectorAll('.capfx__k img')].filter((i) => i.naturalWidth > 0).length,
      faces: el.querySelectorAll('.capfx__face').length,
      word: el.querySelector('.capfx__word')?.textContent ?? null,
      label: vis('.capsule__label'),
      kills: vis('.capsule__kills'),
    };
  });

  // first: once a page of this browser has loaded the trans_* sprites, a later page gets them even with the requests
  // answered 404 (seen with headless Chrome on Windows), so the CI view is checked before any page loads them
  test('without the art pack: no scene, the content only rises in', async () => {
    const { page, problems, context } = await open({ noart: true });
    await setPhase(page, 'ROUND_START');
    await sleep(500);
    const c = await cap(page);
    assert.equal(c.cls, 'gtop__cap is-fx-enter');
    assert.equal(await page.$('.capfx'), null);
    assert.equal(c.label, true);
    assert.deepEqual(problems, []);
    await context.close();
  });

  test('回合开始 → 休整期 → 作战 → 联防: kettles, the words back, 开始作战 then the kills, the faces and 联防开始', async () => {
    const { page, problems, context } = await open();
    await setPhase(page, 'ROUND_START');
    await sleep(500);
    let c = await cap(page);
    assert.equal(c.cls, 'gtop__cap is-fx-wait');
    assert.equal(c.kettles, 3, 'three official kettles');
    assert.equal(c.label, false, 'the words wait under them');
    await setPhase(page, 'PREP');
    await sleep(1000);
    c = await cap(page);
    assert.equal(c.cls, 'gtop__cap is-fx-rest');
    assert.equal(c.label, true, '休息一下 back');
    await setPhase(page, 'COMBAT');
    await sleep(300);
    c = await cap(page);
    assert.equal(c.cls, 'gtop__cap is-fx-clash');
    assert.equal(c.word, '开始作战');
    assert.equal(c.kills, false, 'the counter waits for the scene');
    await sleep(2000);
    assert.equal((await cap(page)).kills, true, 'then the kills counter');
    await setPhase(page, 'UNITE');
    await sleep(300);
    c = await cap(page);
    assert.equal(c.cls, 'gtop__cap is-fx-unite');
    assert.equal(c.faces, 2);
    assert.equal(c.word, '联防开始');
    await sleep(2900);
    assert.equal((await cap(page)).kills, true);
    assert.deepEqual(problems, []);
    await context.close();
  });

  test('reduced motion: no scene', async () => {
    const { page, problems, context } = await open({ reduce: true });
    await setPhase(page, 'COMBAT');
    await sleep(200);
    const c = await cap(page);
    assert.equal(c.cls, 'gtop__cap');
    assert.equal(c.kills, true);
    assert.deepEqual(problems, []);
    await context.close();
  });
});
