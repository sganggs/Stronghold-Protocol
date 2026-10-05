// Issue #142: the real match HUD in the mock harness, using the DOM field so optional art / WebGL is not required.
// SP_E2E=1 CHROME_PATH=/path/to/chrome node --test test/ui/bond-collapse.e2e.test.js
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);
const OUT = fileURLToPath(new URL('../e2e/out/', import.meta.url));

describe('collapsible bond strip (issue #142)', { skip: !ENABLED && 'set SP_E2E=1 and CHROME_PATH to run' }, () => {
  let srv, browser;
  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--no-proxy-server'] });
    mkdirSync(OUT, { recursive: true });
  });
  after(async () => { await browser?.close(); await srv?.close(); });

  for (const [width, height, touch] of [[1920, 1080, false], [640, 360, true]]) {
    test(`collapse releases field input and keeps current bonds at ${width}×${height}`, async () => {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      const activate = (selector) => touch ? page.tap(selector) : page.click(selector);
      const expanded = () => page.$eval('.bonds-toggle', (el) => el.getAttribute('aria-expanded'));
      try {
        await page.setViewport({ width, height, isMobile: touch, hasTouch: touch });
        await page.goto(`${srv.url}/dev/game-mock.html?shot=1&render=fallback&phase=PREP`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('.ff-piece');
        await page.waitForSelector('.bslot .bond');
        assert.equal(await expanded(), 'true');
        const toggle = await page.$eval('.bonds-toggle', (el) => {
          const r = el.getBoundingClientRect();
          return { width: r.width, height: r.height, controls: el.getAttribute('aria-controls') };
        });
        assert.ok(toggle.width >= 44 && toggle.height >= 44, 'visible touch target is at least 44×44');
        assert.equal(toggle.controls, 'match-bond-strip');
        const covered = await page.$eval('.bslot .bond', (el) => {
          const r = el.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        });
        await activate('.bslot .bond');
        await page.waitForSelector('.bpop');
        await activate('.bonds-toggle');
        await page.waitForSelector('#match-bond-strip', { hidden: true });
        assert.equal(await expanded(), 'false');
        assert.equal(await page.$('.bpop'), null, 'collapsing closes the strip popup');
        assert.equal(await page.$eval('.bonds-toggle', (el) => el.getAttribute('aria-label')), '展开盟约');
        assert.ok(await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('.gm__field'), covered),
          'the former bond position now hits the field');
        await page.evaluate(() => {
          globalThis.__fieldPresses = 0;
          document.querySelector('.gm__field').addEventListener('pointerdown', () => globalThis.__fieldPresses++);
        });
        if (touch) await page.touchscreen.tap(covered.x, covered.y);
        else await page.mouse.click(covered.x, covered.y);
        assert.equal(await page.evaluate(() => globalThis.__fieldPresses), 1, 'pointer input reaches the field');
        await page.screenshot({ path: `${OUT}/bonds-collapsed-${width}.png` });

        // Hidden content must keep following state changes, including the empty-bonds state.
        await page.evaluate(() => globalThis.__MOCK__.mutate((s) => { s.priv.board = []; s.priv.hand.fill(null); }));
        await activate('.bonds-toggle');
        await page.waitForSelector('.bstrip--empty', { visible: true });
        assert.equal(await expanded(), 'true');
        await page.focus('.bonds-toggle');
        await page.keyboard.press('Space');
        await page.waitForSelector('#match-bond-strip', { hidden: true });
        assert.equal(await page.evaluate(() => globalThis.__MOCK__.S().priv.ready), false, 'Space on the toggle does not ready the player');
        assert.equal(await page.$('.modal'), null, 'Space does not open the funds confirmation');
        await page.keyboard.press('Enter');
        await page.waitForSelector('.bstrip--empty', { visible: true });

        await activate('.bonds-toggle');
        await activate('.team__row:not(.is-self) .team__btn');
        if (await page.$('.team__ob')) await activate('.team__ob');
        await page.waitForSelector('.gm__watching');
        assert.equal(await expanded(), 'false', 'watching a teammate preserves the collapse choice');
        await activate('.bonds-toggle');
        await page.waitForSelector('.bstrip__owner', { visible: true });
        assert.ok(await page.$eval('.bstrip', (el) => el.getAttribute('data-owner')), 'expanded bonds belong to the watched teammate');
        await activate('.bonds-toggle');
        await page.evaluate(() => globalThis.__MOCK__.setPhase('COMBAT'));
        await page.waitForSelector('.gm--combat');
        assert.equal(await expanded(), 'false', 'phase changes preserve the collapse choice');
        await activate('.bonds-toggle');
        await page.waitForSelector('.bslot .bond', { visible: true });
        assert.equal(await expanded(), 'true');
        await page.screenshot({ path: `${OUT}/bonds-expanded-${width}.png` });
        assert.deepEqual(errors, []);
      } finally { await page.close(); }
    });
  }
});
