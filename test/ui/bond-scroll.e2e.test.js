import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHROME, hasChrome } from '../e2e/client.mjs';
test('all bonds remain reachable by mouse drag, wheel, keyboard and native scrolling (no arrows, §37.201)', { skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 90000 }, async () => {
  const { startServer } = await import('../../server/index.js');
  const puppeteer = (await import('puppeteer-core')).default;
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--no-proxy-server'] });
  try {
    for (const [width, height, touch] of [[1920, 1080, false], [844, 390, true]]) {
      const page = await browser.newPage();
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.evaluateOnNewDocument(() => {
        globalThis.__bondResizeErrors = [];
        // Native observer delivery errors reach window.error, rather than Puppeteer's pageerror event.
        addEventListener('error', e => { if (e.message.includes('ResizeObserver')) globalThis.__bondResizeErrors.push(e.message); });
      });
      await page.setViewport({ width, height, isMobile: touch, hasTouch: touch });
      await page.goto(srv.url + '/dev/game-mock.html?shot=1&render=fallback&phase=PREP');
      await page.waitForSelector('.bstrip .bond');
      const count = await page.evaluate(async () => {
        const { data } = await import('/js/data.js');
        const mock = globalThis.__MOCK__, state = mock.store.get();
        const bonds = data.list('bonds').map((b, i) => ({ bondId: b.bondId, count: 1, tier: 0, active: false, layers: i }));
        mock.store.set({ match: { ...state.match, private: { ...state.match.private, bonds } } });
        return bonds.length;
      });
      await page.waitForFunction(n => document.querySelectorAll('.bslot').length === n, {}, count);
      const bounds = await page.$eval('.bstrip', el => ({ width: el.clientWidth, all: el.scrollWidth }));
      assert.ok(bounds.all > bounds.width);
      assert.equal(await page.$('.bstrip-scroll__arrow'), null, 'no arrow buttons');
      assert.deepEqual(await page.$eval('.bstrip-scroll', el => [el.classList.contains('is-l'), el.classList.contains('is-r')]), [false, true], 'the right edge fades');
      if (!touch) {
        // a mouse drag scrolls, and the click that ends it opens no popup
        const box = await page.$eval('.bstrip', el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
        const y = box.y + box.h / 2;
        await page.mouse.move(box.x + box.w * 0.8, y);
        await page.mouse.down();
        await page.mouse.move(box.x + box.w * 0.5, y, { steps: 6 });
        await page.mouse.move(box.x + box.w * 0.2, y, { steps: 6 });
        await page.mouse.up();
        await page.waitForFunction(() => document.querySelector('.bstrip').scrollLeft > 0);
        assert.equal(await page.$('.bpop'), null, 'the drag opened no bond');
        assert.equal(await page.$eval('.bstrip-scroll', el => el.classList.contains('is-l')), true, 'the left edge fades once scrolled');
        // a short press still opens the disc under it
        await page.$eval('.bstrip', el => { el.scrollLeft = 0; });
        await page.click('.bslot:first-child .bond'); await page.waitForSelector('.bpop');
        await page.click('.bpop__close');
        // the wheel scrolls it sideways
        await page.mouse.move(box.x + box.w / 2, y);
        await page.mouse.wheel({ deltaY: 240 });
        await page.waitForFunction(() => document.querySelector('.bstrip').scrollLeft > 0);
      }
      await page.$eval('.bstrip', el => { el.scrollLeft = el.scrollWidth; });
      await page.waitForFunction(() => !document.querySelector('.bstrip-scroll').classList.contains('is-r'));
      const last = '.bslot:last-child .bond';
      await page.click(last); await page.waitForSelector('.bpop');
      await page.click('.bpop__close');
      // Reset native scroll separately; only ArrowRight below is a keyboard assertion.
      await page.$eval('.bstrip', el => { el.scrollLeft = 0; });
      await page.waitForFunction(() => !document.querySelector('.bstrip-scroll').classList.contains('is-l'));
      await page.focus('.bstrip');
      await page.keyboard.press('ArrowRight');
      await page.waitForFunction(() => document.querySelector('.bstrip').scrollLeft > 0);
      await page.click('.bonds-toggle');
      assert.equal(await page.$eval('.gm__bond-list', el => el.hidden), true);
      const frozen = await page.evaluate(async () => {
        const { data } = await import('/js/data.js');
        const { render } = await import('/vendor/preact.module.js');
        const { html } = await import('/js/ui/components.js');
        const { BondStrip } = await import('/js/ui/bondStrip.js');
        const host = document.createElement('div'); host.id = 'frozen-bonds';
        host.className = 'gm__bonds'; host.style.width = '300px'; document.body.appendChild(host);
        const bonds = data.list('bonds').map(b => ({ bondId: b.bondId, count: 1, tier: 0, layers: 0 }));
        const NativeObserver = globalThis.ResizeObserver;
        let created = 0, disconnected = 0;
        globalThis.ResizeObserver = class extends NativeObserver {
          constructor(callback) { super(callback); created++; }
          disconnect() { disconnected++; super.disconnect(); }
        };
        try {
          const draw = async entries => {
            render(html`<div class="gm__bond-list"><${BondStrip} bonds=${entries} layersDisabled=${true} onOpen=${() => {}} /></div>`, host);
            await new Promise(r => setTimeout(r, 100));
          };
          await draw(bonds);
          const initial = created;
          await draw(bonds.map(b => ({ ...b, layers: b.layers + 1 })));
          const afterUpdate = { created, disconnected };
          const strip = host.querySelector('.bstrip');
          const result = { all: strip.querySelectorAll('.bslot').length, width: strip.clientWidth, scroll: strip.scrollWidth,
            initial, afterUpdate };
          render(null, host);
          return { ...result, afterUnmount: disconnected };
        } finally {
          globalThis.ResizeObserver = NativeObserver;
          render(null, host); host.remove();
        }
      });
      assert.equal(frozen.all, count); assert.ok(frozen.width <= 300 && frozen.scroll > frozen.width);
      assert.equal(frozen.initial, 1);
      assert.deepEqual(frozen.afterUpdate, { created: 1, disconnected: 0 }, 'layer updates reuse the observer');
      assert.equal(frozen.afterUnmount, 1, 'unmount disconnects the observer');
      assert.deepEqual(await page.evaluate(() => globalThis.__bondResizeErrors), [], 'resizing the strip must not loop during observer delivery');
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally { await browser.close(); await srv.close(); }
});
