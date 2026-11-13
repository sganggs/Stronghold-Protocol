// Browser check of 设置 →「界面主题」 (opt-in, needs Chrome):
//   SP_E2E=1 node --test test/ui/themes.e2e.test.js
//
// Imports a generated pack through the real settings page on the in-match mock and checks one shop
// slot, one colour, and the 协议启动 banner. Static counterpart: test/ui/themes.test.js.
// Claude should also run the settings, screen-fit, text-scale and in-match HUD suites
// (test/ui/screen-fit.e2e.test.js, test/ui/text-scale.test.js, test/ui/protocol-boot.e2e.test.js,
// test/ui/boss-plates.e2e.test.js, test/ui/resultbox.e2e.test.js).

import { seedReleaseRead } from '../helpers/releaseNotes.js';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipStored } from '../../tools/theme-template.mjs';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

describe('界面主题 (headless Chrome)', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome) to run' }, () => {
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

  test('an imported pack paints the shop, a colour, and the boot banner, and survives reload', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sp-theme-'));
    const json = JSON.stringify({
      spTheme: 1,
      id: 'e2e-skin',
      name: 'E2E',
      author: 'test',
      version: '1.0.0',
      description: 'e2e',
      colors: { skinLightColor: '#123456' },
      images: { shop_main: 'ui/shop.png' },
      banners: { gameStart: 'fx/start.png' },
    });
    const zipPath = join(dir, 'theme.zip');
    writeFileSync(zipPath, zipStored([
      { name: 'theme.json', data: Buffer.from(json) },
      { name: 'ui/shop.png', data: PNG },
      { name: 'fx/start.png', data: PNG },
    ]));

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    const problems = [];
    page.on('console', (msg) => { if (msg.type() === 'error') problems.push(`console: ${msg.text()}`); });
    page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
    await seedReleaseRead(page);
    await page.goto(`${base}/dev/game-mock.html?shot=1&phase=PREP`, { waitUntil: 'networkidle0', timeout: 60000 });
    await page.waitForSelector('.shopbar__row', { timeout: 60000 });
    await page.click('button.gm__gear[aria-label="设置"]');
    await page.waitForSelector('[data-testid="theme-import-zip"]', { timeout: 10000 });
    const input = await page.$('[data-testid="theme-import-zip"]');
    await input.uploadFile(zipPath);
    await page.waitForFunction(() => document.documentElement.dataset.spTheme === 'e2e-skin', { timeout: 15000 });
    await page.waitForSelector('[data-theme-id="e2e-skin"] .theme-card__using', { timeout: 5000 });
    const painted = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const shop = getComputedStyle(document.querySelector('.shopbar__row'));
      return {
        color: root.getPropertyValue('--sp-c-skin-light').trim(),
        slot: document.documentElement.dataset.spSlot || '',
        shop: shop.backgroundImage,
      };
    });
    assert.equal(painted.color, '#123456');
    assert.match(painted.slot, /shop_main/);
    assert.match(painted.shop, /blob:/);

    await page.reload({ waitUntil: 'networkidle0', timeout: 60000 });
    await page.waitForFunction(
      () => getComputedStyle(document.documentElement).getPropertyValue('--sp-c-skin-light').trim() === '#123456',
      { timeout: 15000 },
    );

    await page.goto(`${base}/dev/game-mock.html?shot=1&phase=BATTLE_CHECK`, { waitUntil: 'networkidle0', timeout: 60000 });
    // 协议启动 shows its own screen only once that art is in (ui/protocolBoot.js); otherwise the plate falls back to the
    // phase strip (game.js THEME_PLATE). Either carries data-banner="gameStart" and must show the theme's picture.
    await page.waitForSelector('.pboot[data-banner="gameStart"], .pbanner[data-banner="gameStart"]', { timeout: 15000 });
    await page.waitForFunction(() => {
      const boot = document.querySelector('.pboot[data-banner="gameStart"]');
      const band = document.querySelector('.pbanner[data-banner="gameStart"] .pbanner__band');
      const el = boot || band;
      return !!el && (getComputedStyle(el).backgroundImage || '').includes('blob:');
    }, { timeout: 15000, polling: 100 });
    assert.deepEqual(problems, []);
    await page.close();
  });
});
