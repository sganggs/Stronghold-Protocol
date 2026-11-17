// Room period/difficulty pill geometry and text fit, including the Tooltip wrapper (fix53, §35.111).
// SP_E2E=1 node --test test/ui/version-pills.e2e.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { Client, hasChrome, startRealServer, problemsOf, sleep } from '../e2e/client.mjs';
import { textProblems } from '../e2e/text-fit.mjs';

const enabled = process.env.SP_E2E === '1' && hasChrome();
const screens = [[640, 360], [667, 375], [740, 360], [844, 390], [1280, 720], [1920, 1080]];
const shots = process.env.SP_FIX53_SHOTS;
const shot = async (c, name) => {
  if (!shots) return;
  mkdirSync(shots, { recursive: true });
  await c.page.screenshot({ path: path.join(shots, `${name}.png`) });
};

const look = (c, lang, textSize, ui) => c.page.evaluate(async (lang, textSize, ui) => {
  const { switchLang } = await import('/js/ui/lang.js');
  const { settingsStore } = await import('/js/ui/settingsStore.js');
  const { fitStore } = await import('/js/ui/screenFit.js');
  await switchLang(lang);
  settingsStore.set({ textSize });
  fitStore.set({ ui });
  await document.fonts.ready;
}, lang, textSize, ui);

const frame = (c, width, height) => c.page.setViewport({ width, height, deviceScaleFactor: 1 });
async function matrix(c, room) {
  const bad = [];
  for (const lang of ['zh', 'zh-TW', 'en', 'ja', 'ko']) for (const size of ['sm', 'md', 'lg', 'xl']) {
    // 界面大小 is active only at 小; 中–特大 always use 100%, as in Settings.
    for (const ui of size === 'sm' ? [75, 80, 85, 90, 95, 100] : [100]) {
      await look(c, lang, size, ui);
      for (const [w, h] of screens) {
        await frame(c, w, h);
        await c.page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const label = `${room ? 'room' : 'lobby'} ${lang} ${size} ${ui}% ${w}×${h}`;
        const fit = await c.page.evaluate(textProblems, room ? '.rs-pill' : '.verchip-wrap', '.rs-pill__vername');
        if (fit.length) bad.push({ label, fit });
        if (room) {
          const measures = await c.page.evaluate(() => {
            const selectors = ['.rs-pill__diff', '.rs-pill__ver'];
            return selectors.map((sel) => {
              const e = document.querySelector(sel), s = getComputedStyle(e), r = e.getBoundingClientRect();
              const p = e.closest('.rs-pill').getBoundingClientRect();
              return { height: r.height, top: r.top, padding: s.padding, fontSize: s.fontSize, radius: s.borderRadius,
                contained: p.left >= -1 && p.right <= innerWidth + 1,
                reachable: e.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) };
            });
          });
          const [d, v] = measures;
          if (Math.abs(d.height - v.height) > 0.5 || Math.abs(d.top - v.top) > 0.5 || d.padding !== v.padding || d.fontSize !== v.fontSize
            || d.radius !== v.radius || !v.reachable || !v.contained) bad.push({ label, measures });
        }
      }
      if (lang === 'zh' && size === 'sm' && (ui === 75 || ui === 100)) {
        await shot(c, `after-${room ? 'room' : 'lobby'}-desktop-${ui}`);
        await frame(c, 667, 375);
        await sleep(100);
        await shot(c, `after-${room ? 'room' : 'lobby'}-phone-${ui}`);
      }
    }
  }
  assert.deepEqual(bad, []);
}

test('period controls: five languages, four text sizes, 75–100% UI, phones and desktops', {
  skip: !enabled, timeout: 5 * 60 * 1000,
}, async () => {
  const srv = await startRealServer({ env: { SP_VERSIONS: 'all' } });
  const P = (await import('puppeteer-core')).default;
  const c = new Client(P, srv.base, 'period-pills');
  try {
    await c.open(); await c.enter('版本验收');
    await c.click('[data-testid="version-switch"]');
    await c.click('.verpick__pick[data-version="act1autochess@V1_1"]');
    await c.page.waitForFunction(() => globalThis.__SP_CONTENT__?.state().status === 'ready');
    await matrix(c, false);
    await look(c, 'zh', 'sm', 100);
    await frame(c, 1920, 1080);
    await c.createCoop();
    await c.page.evaluate(() => globalThis.__SP__.net.request('room.setDifficulty', { difficulty: 'HARD' }));
    await sleep(1000);
    await matrix(c, true);
    await c.click('[data-testid="room-version"]');
    await c.page.waitForSelector('[data-testid="version-picker"]', { visible: true });
    assert.deepEqual(problemsOf([c]), []);
  } finally { await c.close(); await srv.stop(); }
});
