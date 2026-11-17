import { seedReleaseRead } from '../helpers/releaseNotes.js';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);
const results = JSON.parse(readFileSync(new URL('../fixtures/stats-results.json', import.meta.url)));

describe('settlement return control under enlarged text (#458)', { skip: !ENABLED }, () => {
  let srv, browser;
  before(async () => {
    const { startServer } = await import('../../server/index.js');
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    const P = (await import('puppeteer-core')).default;
    browser = await P.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
    mkdirSync(new URL('../e2e/out/', import.meta.url), { recursive: true });
  });
  after(async () => { await browser?.close(); await srv?.close(); });
  for (const [width, height] of [[1366, 768], [844, 390]]) for (const textSize of ['md', 'lg', 'xl']) {
    test(`${width}×${height}, ${textSize}: return is inside the viewport and clickable`, async () => {
      const page = await browser.newPage();
      try {
        await page.setViewport({ width, height });
        await page.evaluateOnNewDocument(ts => localStorage.setItem('sp.pref.settings', JSON.stringify({ textSize: ts })), textSize);
        await seedReleaseRead(page);
        await page.goto(`http://127.0.0.1:${srv.port}/`, { waitUntil: 'networkidle0' });
        // Use the production ResultView with a captured real match result; no CSS or geometry is changed by the fixture.
        await page.evaluate(async res => {
          const { render, h } = await import('/vendor/preact.module.js');
          const { ResultView } = await import('/js/screens/result.js');
          render(h(ResultView, { res, myId: 'p_0', quiet: true, backLabel: '返回同盟', onBack: () => { window.__returned = true; } }), document.getElementById('app'));
          await document.fonts.ready;
        }, results['coop4-hard']);
        await page.waitForSelector('.result__foot button');
        await page.screenshot({ path: new URL(`../e2e/out/result-text-${width}-${textSize}.png`, import.meta.url).pathname });
        const bounds = await page.$eval('.result__foot button', b => {
          const r = b.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, reachable: !!hit && (hit === b || b.contains(hit)) };
        });
        assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.right <= width && bounds.bottom <= height, JSON.stringify(bounds));
        assert.equal(bounds.reachable, true);
        await page.click('.result__foot button'); assert.equal(await page.evaluate(() => window.__returned), true);
      } finally { await page.close(); }
    });
  }
});
