// Browser check of 设置 →「文字大小」 (opt-in, needs Chrome, ~30 s):
//   SP_E2E=1 CHROME_PATH=… node --test test/ui/text-scale.e2e.test.js
//
// A 844×390 landscape phone: 1rem is clamped at 40 px, so the .18rem body text is 7.2 CSS px. The setting steps the text
// root `--t` (css/theme.css) instead of the layout root: the readable text grows, while `documentElement`'s font-size,
// the modal's rem-sized box and — through the dev mock's 休整期 screen — the field host, the canvas and the shop bar stay
// exactly where they were. Static counterpart: test/ui/text-scale.test.js.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);
const PHONE = { width: 844, height: 390 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The settings the mock harness reads: `sp.pref.settings` with one text step (the argument is passed into the page —
 *  evaluateOnNewDocument cannot see a closure). */
const seedSettings = (page, textSize) => page.evaluateOnNewDocument((ts) => {
  try { localStorage.setItem('sp.pref.settings', JSON.stringify({ textSize: ts })); } catch { /* ignore */ }
}, textSize);

describe('文字大小 on a phone (headless Chrome)', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome) to run' }, () => {
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

  /** A page watching for console / page errors, with `sp.pref.settings` seeded before the first script runs. */
  async function open(url, textSize, { seed = true } = {}) {
    const page = await browser.newPage();
    await page.setViewport(PHONE);
    const problems = [];
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    if (seed && textSize) await seedSettings(page, textSize);
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
    return { page, problems };
  }

  /** What the settings modal shows at this step: the roots, a readable label, its Latin micro label, the box. */
  const modalMetrics = (page) => page.evaluate(() => {
    const px = (sel, prop = 'fontSize') => {
      const el = document.querySelector(sel);
      return el ? parseFloat(getComputedStyle(el)[prop]) : null;
    };
    const box = document.querySelector('.modal__box')?.getBoundingClientRect();
    const body = document.querySelector('.modal__body');
    const on = document.querySelector('[data-testid="text-size"] button.is-on');
    // nothing may stick out of the modal's box (the label wraps and the four steps fit its row)
    let outRight = 0;
    for (const el of document.querySelectorAll('.modal__box *')) {
      const r = el.getBoundingClientRect();
      if (box && r.width > 0) outRight = Math.max(outRight, r.right - box.right);
    }
    return {
      root: parseFloat(getComputedStyle(document.documentElement).fontSize),
      label: px('.set-row__label'),
      micro: px('.set-row__label .micro'),
      modalWidth: box ? Math.round(box.width) : null,
      bodyOverflowX: body ? body.scrollWidth - body.clientWidth : null,
      outRight: Math.round(outRight),
      step: on?.textContent ?? null,
      hint: document.querySelector('.set-textsize-note')?.textContent ?? null,
    };
  });

  test('the steps grow the readable text; the layout root and the modal box do not move', async () => {
    const { page, problems } = await open(`${base}/`, null, { seed: false });
    await page.waitForSelector('input', { timeout: 15000 });
    await page.type('input', '文字大小');
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /开始/.test(b.textContent))?.click());
    await page.waitForSelector('.lobby-screen', { timeout: 15000 });
    await page.click('.lobby-screen [data-testid="settings-btn"]');
    await page.waitForSelector('.modal .set-list', { timeout: 5000 });
    await sleep(200);

    const small = await modalMetrics(page);
    assert.equal(small.step, '小', 'the default is the design\'s own sizes');
    assert.equal(small.root, 40, 'a landscape phone clamps the layout root at 40 px');
    assert.ok(Math.abs(small.label - 0.18 * 40) < 0.1, `the body text starts at the reported 7.2 px (${small.label})`);
    assert.ok(small.hint && /棋盘/.test(small.hint), 'the row says the layout is not touched');

    const step = async (name) => {
      await page.evaluate((n) => {
        const btn = [...document.querySelectorAll('[data-testid="text-size"] button')].find((b) => b.textContent.trim() === n);
        btn?.click();
      }, name);
      await sleep(200);
      return modalMetrics(page);
    };

    const md = await step('中');
    const lg = await step('大');
    const xl = await step('特大');
    assert.equal(md.step, '中');
    assert.equal(xl.step, '特大', 'the pick sticks');
    assert.ok(md.label > small.label * 1.5 && lg.label > md.label && xl.label > lg.label,
      `the readable text grows step by step (${[small.label, md.label, lg.label, xl.label].join(' → ')})`);
    assert.ok(Math.abs(xl.label - 0.18 * 88) < 0.2, `特大 reaches the 88 px text root (${xl.label})`);
    assert.ok(xl.micro > small.micro * 1.9, `the 4.4 px micro labels follow (${small.micro} → ${xl.micro})`);
    for (const m of [md, lg, xl]) {
      assert.equal(m.root, 40, 'the layout root never moves: the field camera and the DOM board read 1rem');
      assert.equal(m.modalWidth, small.modalWidth, 'the modal\'s box is sized in rem and does not change');
      assert.ok(m.bodyOverflowX <= 1, `the rows do not overflow the modal body (${m.bodyOverflowX} px)`);
      assert.ok(m.outRight <= 1, `nothing sticks out of the modal's box (${m.outRight} px): the label wraps and the four steps fit`);
    }

    // saved with the settings and restored on the next visit
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('sp.pref.settings')).textSize), 'xl');
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('.lobby-screen', { timeout: 15000 });
    await page.click('.lobby-screen [data-testid="settings-btn"]');
    await page.waitForSelector('.modal .set-list', { timeout: 5000 });
    const again = await modalMetrics(page);
    assert.equal(again.step, '特大', 'the choice survives a reload');
    assert.equal(again.root, 40);
    assert.deepEqual(problems, []);
    await page.close();
  });

  test('the in-match field, canvas and shop bar do not move; the settings dialog in a match grows', async () => {
    const measure = async (textSize) => {
      const { page, problems } = await open(`${base}/dev/game-mock.html?shot=1&phase=PREP&variant=settings`, textSize);
      await page.waitForFunction(() => !!document.querySelector('.screen:not(.gload)'), { timeout: 15000 });
      await sleep(900);
      const m = await page.evaluate(() => {
        const box = (sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
        };
        return {
          root: parseFloat(getComputedStyle(document.documentElement).fontSize),
          field: box('.gm__field'),
          canvas: box('.gm__field canvas'),
          shopbar: box('.gm__hud .shopbar'),
          label: (() => { const el = document.querySelector('.set-row__label'); return el ? parseFloat(getComputedStyle(el).fontSize) : null; })(),
        };
      });
      return { ...m, problems, page };
    };

    const small = await measure('sm');
    const big = await measure('xl');
    assert.ok(small.field && small.shopbar, 'the prep screen with its HUD is on screen');
    assert.equal(small.root, 40);
    assert.equal(big.root, 40, 'the text step never reaches the root');
    assert.deepEqual(big.field, small.field, 'the field host (host.clientWidth / clientHeight) is unchanged');
    assert.deepEqual(big.canvas, small.canvas, 'and so is the canvas the renderer resizes to it');
    assert.deepEqual(big.shopbar, small.shopbar, 'the shop bar is a fixed HUD box: still the design\'s size');
    assert.ok(big.label > small.label * 1.9, `while the dialog's readable text grows (${small.label} → ${big.label})`);
    assert.deepEqual(small.problems, []);
    assert.deepEqual(big.problems, []);
    await small.page.close();
    await big.page.close();
  });
});
