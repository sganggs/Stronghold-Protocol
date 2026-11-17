import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../../server/index.js';
import { CHROME, hasChrome, cameraSettled } from '../e2e/client.mjs';

test('selected operator frame follows its tile through screen offsets, UI size and resize (#889)', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 90000,
}, async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  const puppeteer = (await import('puppeteer-core')).default;
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--no-proxy-server'] });
  try {
    for (const renderer of ['fallback', 'engine']) {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.setViewport({ width: 1280, height: 720 });
      await page.goto(`${srv.url}/dev/game-mock.html?shot=1&phase=PREP&render=${renderer}`);
      await page.waitForFunction(() => !!globalThis.__SP_VIEW__?.raw && !!globalThis.__MOCK__);
      await cameraSettled(page);
      assert.equal(await page.evaluate(() => !!globalThis.__SP_VIEW__.raw.debug?.app?.view), renderer === 'engine');
      const piece = await page.evaluate(() => globalThis.__MOCK__.S().priv.board.find((p) => p.kind === 'chess'));
      const point = await page.evaluate((p) => globalThis.__SP_VIEW__.raw.tileScreen(p.row, p.col), piece);
      await page.mouse.click(point.x, point.y);
      await page.waitForSelector('.uframe');
      for (const fit of [
        { l: 0, r: 0, t: 0, b: 0, ui: 100 },
        { l: 80, r: 24, t: 40, b: 18, ui: 100 },
        { l: -30, r: 50, t: -16, b: 24, ui: 75 },
        { l: 0, r: 0, t: 0, b: 0, ui: 100 },
      ]) {
        await page.evaluate(async (fit) => (await import('/js/ui/screenFit.js')).updateFit(fit), fit);
        await cameraSettled(page);
        await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 350)));
        const delta = await page.evaluate((p) => {
          const tile = globalThis.__SP_VIEW__.raw.tileScreen(p.row, p.col);
          const frame = document.querySelector('.uframe').getBoundingClientRect();
          return [frame.x + frame.width / 2 - tile.x, frame.y + frame.height / 2 - tile.y];
        }, piece);
        assert.ok(delta.every((d) => Math.abs(d) < 1), `${renderer} ${JSON.stringify(fit)}: ${delta}`);
      }
      // a notched phone / PWA: the HUD sits inside the safe area, the fixed frame must still sit on its tile (round-54 audit)
      await page.evaluate(() => { for (const [k, v] of [['--sa-l', '34px'], ['--sa-t', '22px'], ['--sa-r', '12px'], ['--sa-b', '16px']]) document.documentElement.style.setProperty(k, v); });
      await cameraSettled(page);
      await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 350)));
      const notched = await page.evaluate((p) => {
        const tile = globalThis.__SP_VIEW__.raw.tileScreen(p.row, p.col);
        const frame = document.querySelector('.uframe').getBoundingClientRect();
        return [frame.x + frame.width / 2 - tile.x, frame.y + frame.height / 2 - tile.y];
      }, piece);
      assert.ok(notched.every((d) => Math.abs(d) < 1), `${renderer} safe-area insets: ${notched}`);
      await page.evaluate(() => { for (const k of ['--sa-l', '--sa-t', '--sa-r', '--sa-b']) document.documentElement.style.removeProperty(k); });
      await page.setViewport({ width: 844, height: 390 });
      await cameraSettled(page);
      // The fixed overlay must retain the functional button hit areas too.
      await page.click('.uframe__btn--retreat');
      await page.waitForFunction((uid) => !globalThis.__MOCK__.S().priv.board.some((p) => p.uid === uid), {}, piece.uid);
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser.close();
    await srv.close();
  }
});
