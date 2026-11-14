// Canvas hand geometry, native semantic fallback and persisted settings in an isolated desktop browser.
// Canvas screenshots now include the real rendered hand; export idle/pressed pixels as well.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { startServer } from '../../server/index.js';
import { localFontsOnly } from '../helpers/localFonts.js';

const BROWSER = process.env.SP_CURSOR_BROWSER === 'chrome' ? (process.env.CHROME_PATH || '/usr/bin/google-chrome')
  : (process.env.FIREFOX_PATH || '/usr/bin/firefox');
const artReady = () => {
  try { return !!JSON.parse(readFileSync('data/local-assets.json', 'utf8')).groups?.['ui/cursor']?.prts_hand; }
  catch { return false; }
};

test('desktop canvas hand opt-in, rapid clicks, semantic cursors and native fallback', {
  skip: process.env.SP_E2E !== '1' || !existsSync(BROWSER) || !artReady(), timeout: 90000,
}, async t => {
  const out = path.resolve(process.env.SP_CURSOR_OUTPUT || '.state/cursor-20261112/firefox');
  await mkdir(out, { recursive: true });
  const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, workers: 0, assetIndex: false });
  const chrome = process.env.SP_CURSOR_BROWSER === 'chrome';
  let browser;
  try {
    browser = await puppeteer.launch(chrome ? {
      executablePath: BROWSER, headless: true, dumpio: process.env.SP_CURSOR_DUMP === '1',
      args: ['--no-sandbox', '--no-first-run', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--renderer-process-limit=1'],
    } : {
      browser: 'firefox', executablePath: BROWSER, headless: true, dumpio: process.env.SP_CURSOR_DUMP === '1',
      extraPrefsFirefox: { 'dom.ipc.processCount': 2, 'dom.ipc.processCount.webIsolated': 1,
        'dom.ipc.processPrelaunch.enabled': false, 'fission.autostart': false },
    });
    t.diagnostic('browser started');
    browser.on('disconnected', () => t.diagnostic('browser disconnected'));
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await localFontsOnly(page);
    await page.setViewport({ width: 1920, height: 1080 });
    const openSettings = async () => {
      await page.waitForSelector('.title-settings', { visible: true });
      await page.click('.title-settings');
      await page.waitForSelector('[data-testid="arknights-cursor"]', { visible: true });
    };
    const enabled = () => page.$eval('[data-testid="arknights-cursor"]', e => e.getAttribute('aria-checked'));
    await page.goto(server.url, { waitUntil: 'domcontentloaded' });
    await openSettings();
    assert.equal(await enabled(), 'false');
    assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--sp-cursor-pointer')), '');
    await page.click('[data-testid="arknights-cursor"]');
    assert.equal(await enabled(), 'true');
    const pointAtProbe = async () => {
      const point = await page.evaluate(() => {
        let target = document.querySelector('#cursor-press-probe');
        if (!target) {
          target = document.createElement('div'); target.id = 'cursor-press-probe';
          target.style.cssText = 'position:absolute;left:8px;bottom:8px;width:32px;height:32px;z-index:99;cursor:var(--sp-cursor-pointer,pointer)';
          target.onclick = () => { window.__cursorClicks = (window.__cursorClicks || 0) + 1; };
          document.querySelector('[data-testid="arknights-cursor"]').closest('.modal__box').append(target);
        }
        const rect = target.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      });
      await page.mouse.move(point.x, point.y);
      await page.waitForFunction(() => {
        const canvas = document.querySelector('canvas.sp-cursor-canvas');
        return canvas && !canvas.hidden && canvas.dataset.pose === '0';
      });
      return point;
    };
    const point = await pointAtProbe();
    const dimensions = await page.$eval('canvas.sp-cursor-canvas', e => ({
      pixels: [e.width, e.height], css: [parseFloat(e.style.width), parseFloat(e.style.height)], dpr: devicePixelRatio,
    }));
    assert.deepEqual(dimensions.css, [90, 102]);
    assert.deepEqual(dimensions.pixels, dimensions.css.map(v => Math.round(v * Math.min(4, Math.max(1, dimensions.dpr)))));
    const nativeCursor = () => page.evaluate(() => document.documentElement.style.getPropertyValue('--sp-cursor-pointer'));
    const idleCursor = await nativeCursor();
    assert.match(idleCursor, /sp-hand-blank/);
    const saveCursor = async name => {
      const png = await page.$eval('canvas.sp-cursor-canvas', e => e.toDataURL('image/png').split(',')[1]);
      await writeFile(path.join(out, name), Buffer.from(png, 'base64'));
    };
    await saveCursor('cursor-idle.png');
    await page.mouse.down();
    await page.waitForFunction(() => document.querySelector('canvas.sp-cursor-canvas')?.dataset.pose === '10');
    assert.equal(await nativeCursor(), idleCursor, 'pressing does not replace a native image');
    await saveCursor('cursor-pressed.png');
    await page.mouse.up();
    await page.waitForFunction(() => document.querySelector('canvas.sp-cursor-canvas')?.dataset.pose === '0');
    const clickCount = await page.evaluate(() => window.__cursorClicks || 0);
    for (let i = 0; i < 8; i++) { await page.mouse.down(); await page.mouse.up(); }
    await page.waitForFunction(() => document.querySelector('canvas.sp-cursor-canvas')?.dataset.pose === '0');
    assert.equal(await nativeCursor(), idleCursor);
    assert.equal(await page.evaluate(() => window.__cursorClicks), clickCount + 8, 'canvas and backdrop do not intercept clicks');
    assert.equal(await page.$$eval('canvas.sp-cursor-canvas', e => e.length), 1);
    assert.equal(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, point), 'cursor-press-probe');
    for (const cursor of ['text', 'grab', 'grabbing', 'ew-resize', 'not-allowed', 'none']) {
      await page.$eval('#cursor-press-probe', (e, value) => { e.style.cursor = value; }, cursor);
      await page.mouse.move(point.x + 1, point.y);
      await page.waitForFunction(() => document.querySelector('canvas.sp-cursor-canvas')?.hidden === true);
      assert.equal(await page.$eval('#cursor-press-probe', e => getComputedStyle(e).cursor), cursor);
      assert.equal(await nativeCursor(), '');
      await page.mouse.move(point.x, point.y);
    }
    await page.$eval('#cursor-press-probe', e => { e.style.cursor = 'var(--sp-cursor-pointer,pointer)'; });
    await page.mouse.move(point.x + 2, point.y);
    await page.waitForFunction(() => document.querySelector('canvas.sp-cursor-canvas')?.hidden === false);
    await page.evaluate(() => {
      for (const a of document.getAnimations()) if (Number.isFinite(a.effect?.getComputedTiming().endTime)) a.finish();
    });
    await page.screenshot({ path: path.join(out, 'settings-appearance.png') });
    const evidence = await page.$eval('canvas.sp-cursor-canvas', e => ({
      ariaHidden: e.getAttribute('aria-hidden'), inert: e.inert, pointerEvents: getComputedStyle(e).pointerEvents,
      native: document.documentElement.style.getPropertyValue('--sp-cursor-pointer'),
    }));
    assert.equal(evidence.ariaHidden, 'true'); assert.equal(evidence.inert, true); assert.equal(evidence.pointerEvents, 'none');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openSettings(); assert.equal(await enabled(), 'true'); await pointAtProbe();
    await page.click('[data-testid="arknights-cursor"]');
    assert.equal(await enabled(), 'false');
    assert.equal(await page.$eval('[data-testid="arknights-cursor"]', e => getComputedStyle(e).cursor), 'pointer');
    assert.equal(await page.$$eval('canvas.sp-cursor-canvas', e => e.length), 0);
    assert.equal(await nativeCursor(), '');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openSettings(); assert.equal(await enabled(), 'false');
    assert.equal(await page.$$eval('canvas.sp-cursor-canvas', e => e.length), 0);
    assert.deepEqual(errors, []);
    await writeFile(path.join(out, 'verification.json'), JSON.stringify({
      browser: await browser.version(), dimensions, ...evidence, rapidClicks: 8, errors,
    }, null, 2));
  } finally {
    await browser?.close();
    await server.close();
  }
});
