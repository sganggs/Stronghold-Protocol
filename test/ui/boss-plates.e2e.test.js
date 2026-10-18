// Browser check of the leader rounds' plates and the run's end (opt-in, needs Chrome, ~60 s):
//   SP_E2E=1 CHROME_PATH=… node --test test/ui/boss-plates.e2e.test.js
//
// Through the dev mock: 最终攻势 opens with the merged-LP plate (a row per survivor, the team's LP, the official crest)
// and it goes; 隐秘核心已解锁 at the hidden round; the endings in the pause before RESULT — 未能击破隐秘核心 then 击败了全部领袖！,
// 模拟中断 after a lost 最终攻势 and in place of the result box when a settlement leaves nobody alive; without the art
// pack the 0.3.0 banner and result box stay; with reduced motion the plate shows its final state. Static counterpart:
// test/ui/boss-plates.test.js.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('leader plates and endings (headless Chrome)', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome) to run' }, () => {
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
   * The mock at PREP in a fresh context, past the service worker (its own fetches would skip the interception);
   * `noart` fails /assets/ui/ (the CI view), `reduce` asks for reduced motion.
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
      page.on('request', (r) => (/\/assets\/ui\//.test(r.url()) ? r.abort() : r.continue()));
    }
    await page.goto(`${base}/dev/game-mock.html?shot=1&render=fallback&phase=PREP`, { waitUntil: 'networkidle0', timeout: 60000 });
    await page.waitForSelector('.gm__hud', { timeout: 30000 });
    if (!noart) await page.waitForFunction(() => performance.getEntriesByType('resource').filter((e) => /round_info_boss|settlemen_personal_fail|icon_hp|icon_warn/.test(e.name)).length >= 7, { timeout: 15000 });
    await sleep(300);
    return { page, problems, context };
  }

  const setPhase = (page, ph) => page.evaluate((ph) => globalThis.__MOCK__.setPhase(ph), ph);
  const mutate = (page, fn) => page.evaluate((src) => { const M = globalThis.__MOCK__; M.mutate(new Function('s', src)); M.pushPublic(); }, fn);
  const roundOver = 's.pub.deadline = 0; s.pub.fields.forEach((f) => { f.live = false; });';

  // first: a later page of the same browser was seen getting the sprites past the interception (headless Chrome on
  // Windows), so the CI view is checked before any other page
  test('without the art pack: the 0.3.0 最终攻势 banner and result box, no plate', async () => {
    const { page, problems, context } = await open({ noart: true });
    await setPhase(page, 'FINAL_ASSAULT');
    await page.waitForSelector('.pbanner', { timeout: 3000 });
    await mutate(page, roundOver);
    await sleep(500);
    assert.equal(await page.$('.bpl'), null);
    await setPhase(page, 'SETTLE');
    await mutate(page, 's.pub.players.forEach((p) => { p.alive = false; });');
    await sleep(500);
    assert.equal(await page.$('.bpl'), null);
    assert.deepEqual(problems, []);
    await context.close();
  });

  test('最终攻势: a row per survivor, the team\'s LP in the node, the official crest; it goes by itself', async () => {
    const { page, problems, context } = await open();
    await setPhase(page, 'FINAL_ASSAULT');
    await page.waitForSelector('[data-testid="final-plate"]', { timeout: 3000 });
    assert.equal(await page.$('.pbanner'), null, 'the plate, not the banner');
    await sleep(1400);
    const s = await page.$eval('[data-testid="final-plate"]', (el) => ({
      rows: el.querySelectorAll('.fa__row').length,
      total: el.querySelector('.fa__total').textContent,
      title: el.querySelector('.fa__title').textContent,
      // the settle sprite, or the local client's full-size one tinted through a mask (ui/bossPlates.js Crest)
      crest: ((c) => (c.tagName === 'IMG' ? c.naturalWidth > 0
        : /icon_boss_normal_white/.test(getComputedStyle(c).maskImage || getComputedStyle(c).webkitMaskImage)))(el.querySelector('.bpl__crest')),
      clicks: getComputedStyle(el).pointerEvents,
    }));
    assert.equal(s.rows, 4);
    assert.equal(s.total, '61', 'm.public teamLp');
    assert.equal(s.title, '合力击败敌方领袖！');
    assert.ok(s.crest, 'the leader crest');
    assert.equal(s.clicks, 'none');
    await page.waitForFunction(() => !document.querySelector('[data-testid="final-plate"]'), { timeout: 4000 });
    // the leader still standing when the round is over: 模拟中断
    await mutate(page, roundOver);
    await page.waitForSelector('[data-testid="end-plate"].end--abort', { timeout: 3000 });
    assert.equal(await page.$eval('.end__title', (e) => e.textContent), '模拟中断');
    assert.deepEqual(problems, []);
    await context.close();
  });

  test('隐秘核心已解锁, then 未能击破隐秘核心 when the round is over, 击败了全部领袖！ when its leader falls', async () => {
    const { page, problems, context } = await open();
    await setPhase(page, 'HIDDEN_CORE');
    await page.waitForSelector('[data-testid="core-plate"]', { timeout: 3000 });
    assert.equal(await page.$eval('.core__title', (e) => e.textContent), '隐秘核心已解锁');
    await mutate(page, roundOver);
    await page.waitForSelector('[data-testid="end-plate"].end--coreFail', { timeout: 3000 });
    assert.equal(await page.$eval('.end__title', (e) => e.textContent), '未能击破隐秘核心');
    await mutate(page, 's.pub.bossHp.hp = 0;');
    await page.waitForSelector('[data-testid="end-plate"].end--allClear', { timeout: 3000 });
    assert.equal(await page.$eval('.end__title', (e) => e.textContent), '击败了全部领袖！');
    assert.equal(await page.$$eval('.end--allClear .bpl__done', (l) => l.filter((i) => i.naturalWidth > 0).length), 2, 'both leaders ✓');
    assert.deepEqual(problems, []);
    await context.close();
  });

  test('a settlement that leaves nobody alive: 模拟中断 in place of the result box', async () => {
    const { page, problems, context } = await open();
    await setPhase(page, 'SETTLE');
    await mutate(page, 's.pub.players.forEach((p) => { p.alive = false; p.lp = 0; });');
    await page.waitForSelector('[data-testid="end-plate"].end--abort', { timeout: 3000 });
    assert.equal(await page.$('.rdialog'), null);
    assert.deepEqual(problems, []);
    await context.close();
  });

  test('reduced motion: the 最终攻势 plate at its final state, nothing moving', async () => {
    const { page, problems, context } = await open({ reduce: true });
    await setPhase(page, 'FINAL_ASSAULT');
    await page.waitForSelector('[data-testid="final-plate"]', { timeout: 3000 });
    await sleep(100);
    const moving = await page.evaluate(() => document.getAnimations().filter((a) => /^(bpl|fa|core|end)-/.test(String(a.animationName))).map((a) => a.animationName));
    assert.deepEqual(moving, []);
    assert.equal(await page.$eval('.fa__total', (e) => e.textContent), '61');
    assert.equal(await page.$eval('.fa__words', (e) => getComputedStyle(e).opacity), '1');
    assert.deepEqual(problems, []);
    await context.close();
  });
});
