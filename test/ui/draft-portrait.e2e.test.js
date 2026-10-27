import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, hasChrome, startRealServer, problemsOf } from '../e2e/client.mjs';

test('Blaze the Igniting Spark keeps her face inside the strategy name card (#886)', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 90000,
}, async () => {
  const srv = await startRealServer();
  const P = (await import('puppeteer-core')).default;
  const c = new Client(P, srv.base, 'portrait', { prefix: 'draft-portrait' });
  try {
    await c.open();
    await c.enter('名片检查');
    await c.page.evaluate(async () => {
      const { net } = await import('/js/net.js');
      await net.request('room.create', { mode: 'coop', difficulty: 'NORMAL' });
    });
    await c.page.waitForSelector('[data-testid="seat-card-pick"]');
    await c.click('[data-testid="seat-card-pick"]');
    const pick = '.cardpick__op[data-char="char_1040_blaze2"]';
    await c.page.$eval(pick, (el) => el.scrollIntoView({ block: 'center' }));
    await c.click(pick);
    await c.page.waitForFunction(() => globalThis.__SP__.store.get().room.seats.some((s) => s?.card === 'char_1040_blaze2'));
    await c.page.evaluate(async () => {
      const { net } = await import('/js/net.js');
      for (let i = 0; i < 3; i++) await net.request('room.addBot', {});
      await net.request('room.start', {});
    });
    await c.click('.brief__foot .btn--primary', '准备就绪');
    await c.page.waitForSelector('.dorder__art');
    await c.page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 2500))); // let the phase banner finish
    for (const [width, height] of [[1920, 1080], [1280, 720], [844, 390]]) {
      await c.page.setViewport({ width, height });
      await c.page.waitForFunction(() => [...document.querySelectorAll('.dorder__art')].some((img) => img.src.includes('char_1040_blaze2_2') && img.complete && img.naturalWidth > 0));
      const crop = await c.page.evaluate(() => {
        const img = [...document.querySelectorAll('.dorder__art')].find((img) => img.src.includes('char_1040_blaze2_2'));
        const style = getComputedStyle(img), r = img.getBoundingClientRect();
        const scale = Math.max(r.width / img.naturalWidth, r.height / img.naturalHeight);
        const offset = parseFloat(style.objectPosition.split(' ')[1]) / 100;
        const top = (img.naturalHeight - r.height / scale) * offset;
        return { top, bottom: top + r.height / scale, natural: [img.naturalWidth, img.naturalHeight] };
      });
      // Visually checked on the shipped 180×360 portrait: eyes through chin occupy y=120..180.
      assert.deepEqual(crop.natural, [180, 360]);
      assert.ok(crop.top <= 120 && crop.bottom >= 180, `${width}×${height}: ${JSON.stringify(crop)}`);
      await c.shot(`${width}`);
    }
    assert.deepEqual(problemsOf([c]), []);
  } finally {
    await c.close();
    await srv.stop();
  }
});
