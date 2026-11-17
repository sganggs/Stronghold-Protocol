// Isolated component/tool fixtures, with production modules and CSS in a real browser.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CHROME, hasChrome } from '../e2e/client.mjs';

describe('round30 tool and compound-tooltip browser boundaries', { skip: !(process.env.SP_E2E === '1' && hasChrome()) }, () => {
  let srv, browser, page;
  before(async () => {
    const { startServer } = await import('../../server/index.js');
    srv = await startServer({ host: '127.0.0.1', port: 0, quiet: true });
    const P = (await import('puppeteer-core')).default;
    browser = await P.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-background-timer-throttling'] });
    page = await browser.newPage();
    page.on('pageerror', e => console.error('fixture page error:', e.message));
  });
  after(async () => { await browser?.close(); await srv?.close(); });
  async function blank(query = '') {
    await page.goto(`http://127.0.0.1:${srv.port}/dev/simcheck/ui.js${query}`);
    await page.setContent('<html><head><link rel="stylesheet" href="/css/theme.css"><link rel="stylesheet" href="/css/components.css"></head><body><main id="fixture"></main></body></html>');
  }
  async function tooltip(width, height, anchor = '50%', touch = false) {
    await page.setViewport({ width, height, hasTouch: touch }); await blank();
    await page.evaluate(async (anchor) => {
      const { h, render } = await import('/vendor/preact.module.js');
      const { Tooltip, TooltipLayer } = await import('/js/ui/components.js');
      document.documentElement.style.cssText = 'font-size:100px;--t:130px';
      const root = document.getElementById('fixture');
      root.style.cssText = `position:fixed;top:45%;left:${anchor};font-size:16px`;
      window.changeTip = (names = 'A', aside = true) => render(h('div', {},
        h(Tooltip, { text: 'same count: 12', aside: aside ? h('div', {}, ...Array.from({ length: 12 }, (_, i) => h('div', {}, `${names}-${i} Long operator name`))) : null }, h('button', { id: 'anchor' }, 'bond')),
        h(TooltipLayer)), root);
      window.changeTip();
    }, anchor);
    await page.hover('#anchor'); await page.waitForSelector('.tooltip.is-shown');
  }
  for (const [w, h] of [[1440, 900], [390, 844], [844, 390]]) test(`compound tooltip fits ${w}×${h}, all anchor positions`, async () => {
    for (const anchor of ['1%', '50%', '90%']) {
      await tooltip(w, h, anchor);
      const box = await page.$eval('.tooltip', e => {
        const a = e.getBoundingClientRect(), main = e.querySelector('.tooltip__main').getBoundingClientRect(), side = e.querySelector('.tooltip--aside').getBoundingClientRect();
        return { left: a.left, right: a.right, top: a.top, bottom: a.bottom, overlap: main.left < side.right && side.left < main.right && main.top < side.bottom && side.top < main.bottom,
          overflow: e.scrollHeight > e.clientHeight, canScroll: getComputedStyle(e).overflowY === 'auto' && getComputedStyle(e).pointerEvents === 'auto' };
      });
      assert.ok(box.left >= 7 && box.right <= w - 7 && box.top >= 3 && box.bottom <= h - 3, JSON.stringify(box));
      assert.equal(box.overlap, false); if (box.overflow) assert.equal(box.canScroll, true);
      await page.keyboard.press('Escape'); await page.waitForSelector('.tooltip', { hidden: true });
    }
  });
  test('visible tooltip updates equal-count member lists and removes an absent aside', async () => {
    await tooltip(800, 600);
    await page.evaluate(() => window.changeTip('B'));
    await page.waitForFunction(() => document.querySelector('.tooltip--aside')?.textContent.includes('B-11'));
    assert.equal(await page.$eval('.tooltip', e => e.textContent.includes('A-')), false);
    await page.evaluate(() => window.changeTip('B', false));
    await page.waitForSelector('.tooltip--aside', { hidden: true });
    await page.mouse.move(1, 1); await page.hover('#anchor'); await page.waitForSelector('.tooltip.is-shown');
    assert.equal(await page.$eval('.tooltip', e => getComputedStyle(e).pointerEvents), 'none');
  });
  test('touch long press keeps the long list scrollable and outside tap closes it', async () => {
    await tooltip(390, 260, '40%', true);
    await page.keyboard.press('Escape'); await page.$eval('#anchor', e => e.blur());
    const rect = await page.$eval('#anchor', e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await page.touchscreen.touchStart(rect.x, rect.y);
    await page.waitForSelector('.tooltip.is-shown'); await page.touchscreen.touchEnd();
    await new Promise(r => setTimeout(r, 1750));
    assert.ok(await page.$('.tooltip.is-shown'));
    await page.focus('.tooltip'); await page.keyboard.press('End');
    await page.waitForFunction(() => document.querySelector('.tooltip')?.scrollTop > 0);
    await page.touchscreen.tap(2, 2); await page.waitForSelector('.tooltip', { hidden: true });
  });
  test('ordinary tooltips still hide on mouse click and do not open on a short touch tap', async () => {
    await tooltip(800, 600);
    await page.evaluate(() => window.changeTip('A', false));
    await page.waitForSelector('.tooltip--aside', { hidden: true });
    await page.click('#anchor');
    await page.waitForSelector('.tooltip', { hidden: true });
    await tooltip(390, 600, '40%', true);
    await page.evaluate(() => window.changeTip('A', false));
    await page.waitForSelector('.tooltip--aside', { hidden: true });
    await page.keyboard.press('Escape'); await page.$eval('#anchor', e => e.blur());
    const rect = await page.$eval('#anchor', e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await page.touchscreen.tap(rect.x, rect.y);
    await new Promise(r => setTimeout(r, 1100));
    assert.equal(await page.$('.tooltip'), null, 'the opt-in tap behavior does not change existing tooltip calls');
  });

  const toolHtml = readFileSync(new URL('../../public/dev/sim-check.html', import.meta.url), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
  async function tool({ mode = '', query = '', count = 1 } = {}) {
    await blank(query); await page.setContent(toolHtml);
    await page.evaluate(async ({ mode, count }) => {
      const { mountCheck } = await import('/dev/simcheck/ui.js');
      const { trace } = await import('/dev/simcheck/core.js');
      const scenarios = Array.from({ length: count }, (_, i) => ({ id: `case-${i}`, family: 'fast' }));
      window.failAt = mode;
      const adapter = {
        start: () => { if (window.failAt === 'start') throw Error('start failure'); return { tick: 0 }; },
        step: r => { if (window.failAt === 'step') throw Error('step failure'); return ++r.tick <= 2; },
        state: r => [r.tick + (window.failAt === 'diff' ? 1 : 0)],
        result: () => { if (window.failAt === 'result') throw Error('result failure'); return 'ok'; },
      };
      const saved = window.failAt; window.failAt = '';
      const reference = { every: 1, scenarios: Object.fromEntries(scenarios.map(s => [s.id, trace(adapter, s, { every: 1 })])) };
      window.failAt = saved;
      mountCheck(document.getElementById('app'), { project: 'test', title: 'check', subtitle: '<img src=x onerror="window.injected=true">', adapter, scenarios,
        subsets: [{ id: 'fast', label: 'fast', pick: () => true }], reference });
    }, { mode, count });
  }
  for (const mode of ['start', 'step', 'result']) test(`sim check recovers from ${mode} exceptions and allows rerun`, async () => {
    await tool({ mode }); await page.click('.sc-run');
    await page.waitForFunction(() => window.__simcheck?.status === 'error');
    assert.equal(await page.$eval('.sc-run', b => b.disabled), false);
    assert.equal(await page.evaluate(() => !!window.injected), false);
    await page.evaluate(() => { window.failAt = ''; }); await page.click('.sc-run');
    await page.waitForFunction(() => window.__simcheck?.status === 'done');
    assert.deepEqual(await page.evaluate(() => [window.__simcheck.expected, window.__simcheck.completed, window.__simcheck.summary.ok]), [1, 1, 1]);
  });
  for (const query of ['?only=typo', '?subset=typo']) test(`sim check rejects empty or unknown selection ${query}`, async () => {
    await tool({ query }); await page.click('.sc-run');
    await page.waitForFunction(() => window.__simcheck?.status === 'error');
    assert.equal(await page.$('.sc-allok'), null);
  });
  test('long difference list scrolls to its report; a failed dump restores its button', async () => {
    await page.setViewport({ width: 390, height: 400 }); await tool({ mode: 'diff', count: 30 });
    await page.click('.sc-run'); await page.waitForFunction(() => window.__simcheck?.status === 'done');
    assert.equal(await page.$$eval('.sc-list li', rows => rows.length), 30);
    await page.evaluate(() => { window.failAt = 'start'; }); await page.click('.sc-list button');
    await page.waitForFunction(() => document.querySelector('.sc-status').textContent.includes('start failure'));
    assert.equal(await page.$eval('.sc-list button', b => b.disabled), false);
    await page.$eval('.sc-report', e => e.scrollIntoView());
    assert.ok(await page.evaluate(() => window.scrollY > 0));
    assert.ok(await page.$eval('.sc-report', e => e.getBoundingClientRect().top < window.innerHeight));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  });
});
