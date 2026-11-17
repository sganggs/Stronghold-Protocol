// Browser check of the pre-game screens — 协议启动！ and the 请选择策略 band (opt-in, needs Chrome, ~60 s):
//   SP_E2E=1 CHROME_PATH=… node --test test/ui/protocol-boot.e2e.test.js
//
// Through the dev mock: PREP → BATTLE_CHECK shows the screen (a card per doctor, 协议启动！), and it goes once
// 回合开始 follows; one card for a solo run; with reduced motion it shows without motion; without the art pack the 0.3.0
// banner stays. The band draft: the 请选择策略 band when the pick becomes mine — also when its sprites arrive late (a cold
// cache: it plays once they are in, never taking a click) — none without the art or with reduced motion. Static
// counterpart: test/ui/protocol-boot.test.js.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('协议启动！ screen (headless Chrome)', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome) to run' }, () => {
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
   * The mock (at `phase`) in a fresh context, past the service worker (its own fetches would skip the interception);
   * `noart` fails /assets/ui/ (the CI view) — also as /assets/~<hash>/ui/, the form the served manifest uses once the
   * server's asset index is ready (shared/assetPaths.js) —, `reduce` asks for reduced motion.
   */
  async function open({ variant = '', noart = false, reduce = false, phase = 'PREP' } = {}) {
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
      page.on('request', (r) => (/\/assets\/(?:~[0-9a-f]{16}\/)?ui\//.test(r.url()) ? r.abort() : r.continue()));
    }
    await page.goto(`${base}/dev/game-mock.html?shot=1&render=fallback&phase=${phase}${variant ? `&variant=${variant}` : ''}`, { waitUntil: 'networkidle0', timeout: 60000 });
    await page.waitForSelector(phase === 'BAND_DRAFT' ? '.screen.draft' : '.gm__hud', { timeout: 30000 });
    if (!noart) await page.waitForFunction(() => performance.getEntriesByType('resource').filter((e) => /battleReady\/|settle\/common_logo/.test(e.name)).length >= 6, { timeout: 15000 });
    await sleep(300);
    return { page, problems, context };
  }

  const battleCheck = (page) => page.evaluate(() => globalThis.__MOCK__.setPhase('BATTLE_CHECK'));
  /** The band draft's turn goes to p4, then comes back to me (p1). */
  const myTurnAgain = (page) => page.evaluate(async () => {
    const M = globalThis.__MOCK__;
    M.mutate((s) => { s.pub.draft.turn = 'p4'; }); M.pushPublic();
    await new Promise((r) => setTimeout(r, 300));
    M.mutate((s) => { s.pub.draft.turn = 'p1'; }); M.pushPublic();
  });

  // first, and in one page: a later page of the same browser was seen getting the sprites past the interception
  // (headless Chrome on Windows), so the CI view is checked before any other page
  test('without the art pack: no 请选择策略 band, then the 0.3.0 协议启动 banner and no screen', async () => {
    const { page, problems, context } = await open({ noart: true, phase: 'BAND_DRAFT' });
    await myTurnAgain(page);
    await sleep(500);
    assert.equal(await page.$('[data-testid="turn-banner"]'), null);
    await battleCheck(page);
    await page.waitForSelector('.pbanner', { timeout: 3000 });
    assert.equal(await page.$('[data-testid="protocol-boot"]'), null);
    assert.deepEqual(problems, []);
    await context.close();
  });

  test('the band draft: when the pick becomes mine, the 请选择策略 band plays and leaves', async () => {
    const { page, problems, context } = await open({ phase: 'BAND_DRAFT' });
    await myTurnAgain(page);
    await page.waitForSelector('[data-testid="turn-banner"]', { timeout: 3000 });
    assert.equal(await page.$eval('.tbanner__text', (e) => e.textContent), '请选择策略');
    assert.ok(await page.$eval('.tbanner__head', (e) => e.naturalWidth > 0), 'the official robot head');
    await page.waitForFunction(() => !document.querySelector('[data-testid="turn-banner"]'), { timeout: 4000 });
    assert.deepEqual(problems, []);
    await context.close();
  });

  test('four doctors: a card each and 协议启动！; it goes once 回合开始 follows, not before BOOT_MIN_MS, the round plate coming in under its fade', async () => {
    const { page, problems, context } = await open();
    // the page's own clock: when 协议启动！ and the round plate reach the DOM, and when 协议启动！ has gone (a Node-side
    // clock started after the waitForSelector round trip made the measured span tens of ms short under load)
    await page.evaluate(() => {
      const t = (globalThis.__pbT = {});
      const mark = () => {
        const boot = document.querySelector('[data-testid="protocol-boot"]');
        if (t.boot == null && boot) t.boot = performance.now();
        if (t.plate == null && document.querySelector('[data-testid="round-popup"]')) t.plate = performance.now();
        if (t.boot != null && t.gone == null && !boot) t.gone = performance.now();
      };
      new MutationObserver(mark).observe(document.body, { childList: true, subtree: true });
      mark();
    });
    await battleCheck(page);
    await page.waitForSelector('[data-testid="protocol-boot"]', { timeout: 3000 });
    assert.equal(await page.$('.pbanner'), null, 'the screen, not the banner');
    const s = await page.$eval('[data-testid="protocol-boot"]', (el) => ({
      cards: [...el.querySelectorAll('.pboot__num')].map((n) => n.textContent),
      title: el.querySelector('.pboot__title').textContent,
      art: [...el.querySelectorAll('img')].filter((i) => i.naturalWidth > 0).length,
    }));
    assert.deepEqual(s.cards, ['01', '02', '03', '04']);
    assert.equal(s.title, '协议启动！');
    assert.ok(s.art >= 4, 'the official sprites drawn');
    await page.evaluate(() => globalThis.__MOCK__.setPhase('ROUND_START'));
    // (its animation plays whole — screens/game.js BOOT_MIN_MS 2300, with DRAFT_HOLD_MS inside the official 3 s
    // BATTLE_CHECK — then it fades, BOOT_LEAVE_MS 350, while the round plate comes in under it)
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(await page.$('[data-testid="protocol-boot"]'), 'still up right after 回合开始');
    assert.equal(await page.$('[data-testid="round-popup"]'), null, 'no round plate before it starts to leave');
    await page.waitForSelector('[data-testid="round-popup"]', { timeout: 4000 });
    assert.ok(await page.$('[data-testid="protocol-boot"].is-leaving'), 'the plate comes in while 协议启动！ fades, not after it');
    await page.waitForFunction(() => !document.querySelector('[data-testid="protocol-boot"]'), { timeout: 6000 });
    const t = await page.evaluate(() => globalThis.__pbT);
    // BOOT_MIN_MS counts from boot.at, set just before the screen's first render: up to 100 ms of render time allowed
    assert.ok(t.plate - t.boot >= 2300 - 100, `the plate after the boot's minimum (${Math.round(t.plate - t.boot)} ms)`);
    assert.ok(t.gone - t.boot >= 2300, `shown ${Math.round(t.gone - t.boot)} ms`);
    assert.ok(await page.$('[data-testid="round-popup"]'), 'the plate plays on after it');
    assert.deepEqual(problems, []);
    await context.close();
  });

  test('solo: the 请选择策略 band plays with the 轮到你 sound, the same as co-op (the maintainer, 2026-10-21)', async () => {
    const { page, problems, context } = await open({ phase: 'BAND_DRAFT', variant: 'solo' });
    await page.evaluate(async () => {
      const { audio } = await import('/js/audio.js');
      globalThis.__sfx = [];
      const sfx = audio.sfx.bind(audio);
      audio.sfx = (name, ...rest) => { globalThis.__sfx.push(name); return sfx(name, ...rest); };
    });
    // a solo turn begins again: pick (已选定策略 shows), then the pick goes (m.private.bandId) — the band of the first
    // turn, if its art came in time, has played by then
    await page.waitForFunction(() => !document.querySelector('[data-testid="turn-banner"]'), { timeout: 4000 });
    await page.evaluate(() => globalThis.__MOCK__.mutate((s) => { s.priv.bandId = 'band_bldsk'; }));
    await page.waitForSelector('.draft-done', { timeout: 3000 });
    await page.evaluate(() => { globalThis.__sfx.length = 0; globalThis.__MOCK__.mutate((s) => { s.priv.bandId = null; }); });
    await page.waitForSelector('[data-testid="turn-banner"]', { timeout: 3000 });
    await page.waitForFunction(() => globalThis.__sfx.includes('yourTurn'), { timeout: 2000 }).catch(() => null);
    assert.ok((await page.evaluate(() => globalThis.__sfx)).includes('yourTurn'), 'the 轮到你 sound in solo too');
    await page.waitForFunction(() => !document.querySelector('[data-testid="turn-banner"]'), { timeout: 4000 });
    assert.deepEqual(problems, []);
    await context.close();
  });

  test('solo with a cold cache: the band\'s sprites arrive 2 s after the turn began — it plays once they are in, never taking a click (§35.18)', async () => {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setBypassServiceWorker(true);
    await page.setViewport({ width: 1920, height: 1080 });
    const problems = [];
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    // the page's own clock: when the draft screen (its first turn: solo) and the band reach the DOM
    await page.evaluateOnNewDocument(() => {
      const t = (globalThis.__bandT = {});
      new MutationObserver(() => {
        if (t.draft == null && document.querySelector('.screen.draft')) t.draft = performance.now();
        if (t.band == null && document.querySelector('[data-testid="turn-banner"]')) t.band = performance.now();
      }).observe(document, { childList: true, subtree: true });
    });
    // the pre-game sprites held back 2 s (a cold cache on a slow line); everything else at once
    await page.setRequestInterception(true);
    page.on('request', (r) => {
      if (/battleReady\/|settle\/common_logo|roundStartDialog\/round_emoji_head/.test(r.url())) setTimeout(() => r.continue().catch(() => {}), 2000);
      else r.continue().catch(() => {});
    });
    await page.goto(`${base}/dev/game-mock.html?shot=1&render=fallback&phase=BAND_DRAFT&variant=solo`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('.screen.draft', { timeout: 30000 });
    await page.waitForSelector('[data-testid="turn-banner"]', { timeout: 15000 });
    const t = await page.evaluate(() => globalThis.__bandT);
    const late = Math.round(t.band - t.draft);
    assert.ok(late > 1000, `the band came after the old 1 s limit, not skipped (${late} ms)`);
    assert.ok(late <= 5000, `inside TURN_BANNER_LATE_MS (${late} ms)`);
    assert.equal(await page.$eval('[data-testid="turn-banner"]', (e) => getComputedStyle(e).pointerEvents), 'none', 'the draft stays usable under it');
    assert.ok(await page.$eval('.tbanner__head', (e) => e.naturalWidth > 0), 'the official robot head');
    await page.waitForFunction(() => !document.querySelector('[data-testid="turn-banner"]'), { timeout: 4000 });
    assert.deepEqual(problems, []);
    await context.close();
  });

  test('solo: one card', async () => {
    const { page, problems, context } = await open({ variant: 'solo' });
    await battleCheck(page);
    await page.waitForSelector('[data-testid="protocol-boot"]', { timeout: 3000 });
    assert.deepEqual(await page.$$eval('.pboot__card', (c) => c.map((e) => e.className.includes('pboot__card--c'))), [true]);
    assert.deepEqual(problems, []);
    await context.close();
  });

  test('reduced motion: no 请选择策略 band', async () => {
    const { page, problems, context } = await open({ phase: 'BAND_DRAFT', reduce: true });
    await myTurnAgain(page);
    await sleep(500);
    assert.equal(await page.$('[data-testid="turn-banner"]'), null);
    assert.deepEqual(problems, []);
    await context.close();
  });

  test('reduced motion: the screen at once, nothing moving', async () => {
    const { page, problems, context } = await open({ reduce: true });
    await battleCheck(page);
    await page.waitForSelector('[data-testid="protocol-boot"]', { timeout: 3000 });
    await sleep(100);
    const moving = await page.evaluate(() => document.getAnimations().filter((a) => String(a.animationName).startsWith('pboot-')).map((a) => a.animationName));
    assert.deepEqual(moving, []);
    assert.equal(await page.$eval('.pboot__card', (e) => getComputedStyle(e).opacity), '1');
    assert.deepEqual(problems, []);
    await context.close();
  });
});
