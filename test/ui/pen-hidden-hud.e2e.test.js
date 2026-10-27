// #892: in the enemy preview (pen) view the faded bond strip and effects column must not catch board clicks; back in
// the prep view the bond discs are clickable again. Both renderers. Opt-in (~15 s):
//   SP_E2E=1 CHROME_PATH=… node --test test/ui/pen-hidden-hud.e2e.test.js
// The static half (always on) pins the CSS: the faded HUD is visibility: hidden after the fade, not only
// pointer-events: none (the reporter's Chrome 155 / Windows still hit-tested the faded discs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('#892 static: the pen view hides the bond strip and effects column with visibility after the fade', () => {
  const css = readFileSync(new URL('../../public/css/screens/game.css', import.meta.url), 'utf8');
  const rule = css.match(/\.gm\.is-pen \.gm__bonds, \.gm\.is-pen \.gm__effects \{([^}]*)\}/);
  assert.ok(rule, 'the pen rule exists');
  assert.match(rule[1], /visibility: hidden/);
  assert.match(rule[1], /pointer-events: none/);
  assert.match(rule[1], /visibility 0s linear var\(--t-med\)/, 'visibility flips only after the fade');
  assert.match(css, /\.gm__bonds, \.gm__effects \{ transition: opacity var\(--t-med\) var\(--ease-out\), visibility 0s linear 0s; \}/,
    'and comes back at once when the pen closes');
});

test('#892 browser: hidden enemy-preview HUD leaves board clicks free, then the bonds are clickable again', {
  skip: !ENABLED && 'set SP_E2E=1 (and have Chrome) to run', timeout: 90000,
}, async () => {
  const { startServer } = await import('../../server/index.js');
  const puppeteer = (await import('puppeteer-core')).default;
  const { cameraSettled } = await import('../e2e/client.mjs');
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--no-proxy-server'] });
  try {
    for (const renderer of ['engine', 'fallback']) {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.setViewport({ width: 1600, height: 900 });
      await page.goto(`${srv.url}/dev/game-mock.html?shot=1&phase=PREP&variant=pen&render=${renderer}`);
      await page.waitForFunction(() => !!globalThis.__SP_VIEW__?.raw);
      await page.waitForSelector('.gm.is-pen');
      await cameraSettled(page);
      await sleep(350);
      const points = await page.$$eval('.gm__bonds .bond, .gm__effects', (els) => els.map((el) => {
        const r = el.getBoundingClientRect();
        const x = r.x + r.width / 2, y = r.y + r.height / 2;
        const hit = document.elementFromPoint(x, y);
        return { x, y, width: r.width, height: r.height, blocked: !!hit?.closest('.gm__bonds, .gm__effects') };
      }).filter((p) => p.width && p.height));
      assert.ok(points.length > 1, 'the hidden bond and effects areas keep their layout boxes');
      assert.ok(points.every((p) => !p.blocked), `${renderer}: ${JSON.stringify(points)}`);
      await page.mouse.click(points[0].x, points[0].y);
      await sleep(200);
      assert.equal(await page.$('.bpop'), null, `${renderer}: a real click cannot open a hidden bond`);
      await page.click('.enemybtn');
      await page.waitForFunction(() => !document.querySelector('.gm.is-pen'));
      await cameraSettled(page);
      await sleep(350);
      await page.click('.gm__bonds .bond');
      await page.waitForSelector('.bpop');
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser.close();
    await srv.close();
  }
});
