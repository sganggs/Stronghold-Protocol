import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { APP_VERSION } from '../../shared/constants.js';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

test('release notes: fresh install, dismiss/reload, history, update overlay and match deferral', {
  skip: !(process.env.SP_E2E === '1' && existsSync(CHROME)), timeout: 90000,
}, async () => {
  const { startServer } = await import('../../server/index.js');
  const puppeteer = (await import('puppeteer-core')).default;
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--no-proxy-server'] });
  try {
    const page = await browser.newPage();
    const base = `http://127.0.0.1:${srv.port}`;
    const response = await page.goto(`${base}/CHANGELOG.md?v=old`);
    assert.equal(response.headers()['cache-control'], 'no-cache');
    assert.match(await response.text(), /## 0\.3\.3/);
    assert.equal((await page.goto(`${base}/package.json`)).status(), 404);
    await page.goto(base);
    await page.waitForSelector('.release-notes');
    assert.match(await page.$eval('.release-notes', (e) => e.textContent), new RegExp(APP_VERSION.replaceAll('.', '\\.')));
    assert.ok(await page.$('.release-notes-body li a'));
    await page.evaluate(() => [...document.querySelectorAll('.release-notes button')].find((b) => b.textContent.includes('更早版本')).click());
    assert.match(await page.$eval('.release-notes', (e) => e.textContent), /0\.3\.2/);
    await page.keyboard.press('Escape');
    await page.waitForSelector('.release-notes', { hidden: true });
    await page.reload();
    await page.waitForSelector('.release-notes-entry');
    assert.equal(await page.$('.release-notes'), null);
    await page.click('.release-notes-entry');
    await page.waitForSelector('.release-notes');
    await page.keyboard.press('Escape');
    // Only the previous version was read, as with an update-zip overlay retaining browser storage.
    await page.evaluate((version) => {
      localStorage.removeItem(`sp.pref.release-seen.${version}`);
      localStorage.setItem('sp.pref.release-seen.0.3.2', '1');
    }, APP_VERSION);
    await page.reload();
    await page.waitForSelector('.release-notes');
    await page.evaluate(async () => {
      const { store } = await import('/js/store.js');
      store.set({ session: { entered: true }, room: { inMatch: true } });
    });
    await page.waitForSelector('.release-notes', { hidden: true });
    assert.equal(await page.evaluate((v) => localStorage.getItem(`sp.pref.release-seen.${v}`), APP_VERSION), null);
  } finally { await browser.close(); await srv.close(); }
});
