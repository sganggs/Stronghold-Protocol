// 「同盟盟约速查」 flyout in the mock harness (PR #922, §37.347): a teammate's bond popup steps ‹ › through THAT
// teammate's row and keeps the flyout open, the teammates' operators arrive through g.peek (with the elite frame),
// no g.peek is sent before the flyout was ever opened, the toggle uses defined colour tokens, and on a short viewport
// the window stays clear of 冻结 / 刷新.
// Unit counterparts: test/ui/team-flyout.test.js (bondPopupNav, flyOpsFor), test/match/peek.test.js (the channel).
//
//   SP_E2E=1 CHROME_PATH=/path/to/chrome node --test test/ui/team-flyout.e2e.test.js
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);
const OUT = fileURLToPath(new URL('../e2e/out/', import.meta.url));
const URL_FLYOUT = '/dev/game-mock.html?shot=1&render=fallback&phase=PREP&variant=flyout';

describe('同盟盟约速查 flyout (PR #922)', { skip: !ENABLED && 'set SP_E2E=1 and CHROME_PATH to run' }, () => {
  let srv, browser;
  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--no-proxy-server'] });
    mkdirSync(OUT, { recursive: true });
  });
  after(async () => { await browser?.close(); await srv?.close(); });

  test('a teammate\'s bond popup walks that teammate\'s row and keeps the flyout open; operators arrive by g.peek', async () => {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    try {
      await page.setViewport({ width: 1600, height: 900 });
      await page.goto(`${srv.url}${URL_FLYOUT}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.team__fly-window');
      // the mock answers g.peek like the server: the teammates' rows fill in, the elite one framed
      await page.waitForSelector('.team__fly-row:nth-child(2) .team__fly-ops .uthumb');
      const peeks = await page.evaluate(() => globalThis.__MOCK__.S().requests.filter(([t]) => t === 'g.peek'));
      assert.deepEqual(peeks, [['g.peek', { open: true }]], 'one open, no mount-time { open: false }');
      assert.ok(await page.$('.team__fly-row:nth-child(2) .team__fly-ops .uthumb.is-golden'), 'the teammate\'s elite operator keeps its frame');
      // the toggle's colour has a 150 ms transition from --text-md: finish it, or a fast load reads a colour mid-way
      const toggleColor = await page.$eval('.team__bonds-toggle', (el) => {
        for (const a of el.getAnimations()) a.finish();
        return getComputedStyle(el).color;
      });
      assert.equal(toggleColor, 'rgb(89, 244, 202)', 'the open toggle is --mint-400 (the undefined --mint-300 left it the inherited white)');

      const row = 2;
      const mate = await page.$eval(`.team__row:nth-child(${row}) .team__name`, (el) => el.textContent.trim());
      const discNames = await page.$$eval(`.team__fly-row:nth-child(${row}) .team__fly-bonds .bond`,
        (els) => els.map((el) => (el.getAttribute('title') || '').split(' ')[0]));
      assert.ok(discNames.length >= 3, `the teammate has bonds to walk (${discNames.length})`);
      const popup = () => page.evaluate(() => ({
        flyout: !!document.querySelector('.team__fly-window'),
        name: document.querySelector('.bpop .bpop__name')?.textContent.trim() ?? null,
        label: document.querySelector('.bpop')?.getAttribute('aria-label') ?? null,
        arrows: document.querySelectorAll('.bpop-nav__arrow').length,
      }));
      const discs = await page.$$(`.team__fly-row:nth-child(${row}) .team__fly-bonds .bond`);
      await discs[0].click();
      await page.waitForSelector('.bpop');
      let s = await popup();
      assert.deepEqual([s.flyout, s.name, s.arrows], [true, discNames[0], 2]);
      assert.ok(s.label.includes(mate), `the popup names the teammate (${s.label})`);
      await page.screenshot({ path: `${OUT}/team-flyout-bond-1600.png` });

      await page.click('.bpop-nav__arrow--next');
      await page.waitForFunction((n) => document.querySelector('.bpop .bpop__name')?.textContent.trim() === n, { timeout: 3000 }, discNames[1]);
      s = await popup();
      assert.equal(s.flyout, true, '› keeps the flyout open (the arrows sit outside .bpop)');
      assert.ok(s.label.includes(mate), '› stays on the teammate\'s bonds, never the viewer\'s strip');

      await page.click('.bpop-nav__arrow--prev');
      await page.click('.bpop-nav__arrow--prev');
      await page.waitForFunction((n) => document.querySelector('.bpop .bpop__name')?.textContent.trim() === n, { timeout: 3000 }, discNames.at(-1));
      s = await popup();
      assert.equal(s.flyout, true);
      assert.ok(s.label.includes(mate), '‹ wraps inside the teammate\'s row');

      // another flyout disc switches the popup; a second tap on it closes the popup (like the strip's discs); the
      // flyout stays open throughout (the centred popup covers the row's later discs, so the first one is tapped)
      const first = () => page.$(`.team__fly-row:nth-child(${row}) .team__fly-bonds .bond`);
      await (await first()).click();
      await page.waitForFunction((n) => document.querySelector('.bpop .bpop__name')?.textContent.trim() === n, { timeout: 3000 }, discNames[0]);
      await (await first()).click();
      await page.waitForFunction(() => !document.querySelector('.bpop'), { timeout: 3000 });
      assert.ok(await page.$('.team__fly-window'), 'the flyout is still open');
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });

  test('640×360: the open flyout leaves 冻结 / 刷新 reachable', async () => {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    try {
      await page.setViewport({ width: 640, height: 360, isMobile: true, hasTouch: true });
      await page.goto(`${srv.url}${URL_FLYOUT}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.team__fly-window');
      await page.waitForSelector('.shopbar__tools .toolbtn');
      await new Promise((r) => setTimeout(r, 400));
      const hits = await page.evaluate(() => [...document.querySelectorAll('.shopbar__tools .toolbtn')].flatMap((btn) => {
        const r = btn.getBoundingClientRect();
        return [0.25, 0.5, 0.75].map((f) => {
          const el = document.elementFromPoint(r.left + r.width * f, r.top + r.height / 2);
          return !!el && btn.contains(el);
        });
      }));
      assert.ok(hits.length >= 6, 'both buttons sampled');
      assert.ok(hits.every(Boolean), `every sampled point reaches its button (${JSON.stringify(hits)})`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 640, 'no horizontal page scroll');
      await page.screenshot({ path: `${OUT}/team-flyout-640.png` });
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  });
});
