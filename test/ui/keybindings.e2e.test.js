// Issue #265: real settings controls, with optional screenshots outside the source tree.
// SP_E2E=1 CHROME_PATH=/path/to/chrome [SP_E2E_OUT=/tmp/keybindings] node --test test/ui/keybindings.e2e.test.js
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);
const OUT = process.env.SP_E2E_OUT;
const button = (action) => `[data-key-action="${action}"]`;
const defaults = { refresh: 'R', freeze: 'F', levelUp: 'D', retreat: 'Q', sell: 'X', ready: 'Space' };
function recordProblems(page, problems, t) {
  const reported = new Set();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (message) => {
    if (message.type() !== 'error' && message.type() !== 'warn') return;
    const text = message.text();
    const url = message.location().url || '';
    // The DOM fallback intentionally works without the optional downloaded art / audio / fonts.
    // Exempt only their known 404 diagnostics; missing scripts, app CSS and other errors still fail.
    const missingMedia = /^Failed to load resource:.*status of 404/.test(text)
      && /^http:\/\/127\.0\.0\.1:\d+\/(?:assets\/.*\.(?:png|jpg|webp|mp3|ogg|wav)|media\/bgm\/[^?#]+)(?:[?#]|$)/.test(url);
    const missingFonts = /^Refused to apply style from 'http:\/\/127\.0\.0\.1:\d+\/fonts\/fonts\.css' because its MIME type \('text\/html'\)/.test(text);
    const missingAudio = /^\[audio\] \/assets\/audio\/.* unavailable HTTP 404$/.test(text);
    const optional = missingMedia ? 'art / audio assets' : missingFonts ? 'downloaded fonts' : missingAudio ? 'audio fallback' : null;
    if (optional) {
      if (!reported.has(optional)) t.diagnostic(`DOM fallback: optional ${optional} unavailable; other console errors remain fatal.`);
      reported.add(optional);
      return;
    }
    problems.push(`${message.type()}: ${text} [${url}]`);
  });
}

describe('custom keybindings settings (issue #265)', { skip: !ENABLED && 'set SP_E2E=1 and CHROME_PATH to run' }, () => {
  let srv, browser;
  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--no-proxy-server'] });
    if (OUT) mkdirSync(OUT, { recursive: true });
  });
  after(async () => { await browser?.close(); await srv?.close(); });

  async function openSettings(page) {
    await page.bringToFront();
    await page.click('.gm__gear[aria-label="设置"]');
    await page.waitForSelector('.set-keys__key');
    // Modal focuses its first control after the opening animation starts.
    await page.waitForFunction(() => document.activeElement?.matches('.set-range'));
    await page.waitForFunction(() => document.querySelector('.set-modal').getAnimations().every((animation) => animation.playState === 'finished'));
  }
  async function startEditing(page, action) {
    await page.click(button(action));
    await page.waitForFunction((selector) => document.querySelector(selector)?.getAttribute('aria-pressed') === 'true', {}, button(action));
  }
  const labels = (page) => page.$$eval('.set-keys__key', (els) => Object.fromEntries(els.map((el) => [el.dataset.keyAction, el.textContent.trim()])));
  const pref = (page) => page.evaluate(() => localStorage.getItem('sp.pref.keymap'));
  const gameState = (page) => page.evaluate(() => JSON.parse(JSON.stringify(globalThis.__MOCK__.S().priv)));
  const assertIdle = async (page) => assert.equal(await page.$('.set-keys__key.is-listening'), null, 'no pending capture');

  test('remap, swap, reject, cancel, reload and reset without triggering gameplay', async (t) => {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    const errors = [];
    recordProblems(page, errors, t);
    try {
      await page.setViewport({ width: 1920, height: 1080 });
      await page.goto(`${srv.url}/dev/game-mock.html?shot=1&render=fallback&phase=PREP`, { waitUntil: 'networkidle0' });
      assert.match(await page.title(), /Game Mock/);
      await page.waitForSelector('.ff-piece');
      const initialGame = await gameState(page);
      await openSettings(page);
      assert.deepEqual(await labels(page), defaults);
      assert.match(await page.$eval('.set-keys', (el) => el.textContent), /单人暂停、继续/);

      await startEditing(page, 'refresh');
      await page.keyboard.press('KeyG');
      await page.waitForFunction(() => document.querySelector('[data-key-action="refresh"]')?.textContent === 'G');
      assert.equal(JSON.parse(await pref(page)).refresh, 'KeyG', 'saved immediately');
      await startEditing(page, 'freeze');
      await page.keyboard.press('KeyG');
      await page.waitForFunction(() => document.querySelector('[data-key-action="freeze"]')?.textContent === 'G');
      assert.equal((await labels(page)).refresh, 'F', 'the previous action receives the edited action’s old key');
      assert.match(await page.$eval('.set-keys__status', (el) => el.textContent), /自动交换/);

      await startEditing(page, 'refresh');
      await page.keyboard.down('Space');
      await page.keyboard.down('Space');
      await page.keyboard.up('Space');
      await page.waitForFunction(() => document.querySelector('[data-key-action="refresh"]')?.textContent === 'Space');
      await assertIdle(page);
      assert.equal((await labels(page)).ready, 'F');
      assert.deepEqual(await gameState(page), initialGame, 'captured keys never trigger game actions');

      await startEditing(page, 'sell');
      const beforeInvalid = await pref(page);
      await page.keyboard.press('ArrowUp');
      await page.keyboard.down('Shift');
      await page.keyboard.press('KeyZ');
      await page.keyboard.up('Shift');
      await page.keyboard.down('Control');
      await page.keyboard.press('KeyC');
      await page.keyboard.up('Control');
      await page.evaluate(() => {
        const target = document.activeElement;
        target.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyV', key: 'Process', keyCode: 229, isComposing: true, bubbles: true, cancelable: true }));
        target.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyV', bubbles: true, cancelable: true }));
      });
      assert.equal(await pref(page), beforeInvalid, 'invalid, modifier and IME input leave bindings intact');
      assert.equal(await page.$eval(button('sell'), (el) => el.getAttribute('aria-pressed')), 'true');
      assert.match(await page.$eval('.set-keys__status', (el) => el.textContent), /此按键不可用/);
      assert.equal(await page.$eval('.set-keys__status', (el) => el.getAttribute('aria-live')), 'polite');

      await page.keyboard.down('Escape');
      await page.keyboard.down('Escape');
      await page.keyboard.up('Escape');
      await assertIdle(page);
      assert.ok(await page.$('.set-modal'), 'Escape and its held repeats only cancel editing');
      await page.keyboard.press('Escape');
      await page.waitForSelector('.set-modal', { hidden: true });

      await openSettings(page);
      await assertIdle(page);
      await page.focus(button('retreat'));
      await page.keyboard.press('Enter');
      assert.equal(await page.$eval(button('retreat'), (el) => el.getAttribute('aria-pressed')), 'true', 'Enter starts capture');
      await page.keyboard.press('Tab');
      await assertIdle(page);
      assert.equal(await page.evaluate(() => document.activeElement?.dataset.keyAction), 'sell', 'Tab advances focus normally');
      await startEditing(page, 'retreat');
      await page.click('#set-keys-title');
      await assertIdle(page);
      await page.keyboard.press('KeyV');
      assert.equal(await pref(page), beforeInvalid, 'clicking outside cancels capture immediately');

      await startEditing(page, 'levelUp');
      await page.click('.set-modal .modal__actions .btn--primary');
      await page.waitForSelector('.set-modal', { hidden: true });
      await openSettings(page);
      await assertIdle(page);
      const changedLabels = await labels(page);
      await page.reload({ waitUntil: 'networkidle0' });
      await page.waitForSelector('.ff-piece');
      await openSettings(page);
      assert.deepEqual(await labels(page), changedLabels, 'bindings survive a full reload');
      await assertIdle(page);
      if (OUT) await page.screenshot({ path: path.join(OUT, 'keybindings-desktop.png') });

      await page.$eval('.set-range', (el) => { el.value = '45'; el.dispatchEvent(new Event('input', { bubbles: true })); });
      const audioPref = await page.evaluate(() => localStorage.getItem('sp.pref.settings'));
      await startEditing(page, 'ready');
      await page.click('.set-keys__reset');
      await assertIdle(page);
      assert.deepEqual(await labels(page), defaults);
      assert.equal(await page.evaluate(() => localStorage.getItem('sp.pref.settings')), audioPref, 'reset leaves audio and other settings untouched');
      assert.deepEqual(await gameState(page), initialGame, 'settings interactions never change the match');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });

  test('real storage events synchronize open tabs and keep browser contexts isolated', { timeout: 60000 }, async (t) => {
    const context = await browser.createBrowserContext();
    const independent = await browser.createBrowserContext();
    const errors = [];
    try {
      const first = await context.newPage();
      const second = await context.newPage();
      const isolated = await independent.newPage();
      for (const page of [first, second, isolated]) {
        await page.bringToFront();
        recordProblems(page, errors, t);
        await page.setViewport({ width: 1280, height: 720 });
        await page.goto(`${srv.url}/dev/game-mock.html?shot=1&render=fallback&phase=PREP`, { waitUntil: 'networkidle0' });
        await openSettings(page);
      }
      await first.bringToFront();
      await startEditing(first, 'refresh');
      await first.keyboard.press('KeyT');
      await second.waitForFunction(() => document.querySelector('[data-key-action="refresh"]')?.textContent === 'T', { polling: 100 });
      assert.deepEqual(await labels(second), await labels(first), 'the other open tab updates without reload');
      assert.deepEqual(await labels(isolated), defaults, 'an independent browser context keeps its defaults');
      assert.equal(await pref(isolated), null, 'the independent context has no saved binding');

      await second.bringToFront();
      await startEditing(second, 'freeze');
      await second.keyboard.press('KeyT');
      await first.waitForFunction(() => document.querySelector('[data-key-action="freeze"]')?.textContent === 'T', { polling: 100 });
      assert.equal((await labels(first)).refresh, 'F', 'the collision swap reaches both tabs');
      await first.bringToFront();
      await first.reload({ waitUntil: 'networkidle0' });
      await openSettings(first);
      assert.deepEqual(await labels(first), await labels(second), 'the synchronized map persists after reload');

      await second.bringToFront();
      await second.click('.set-keys__reset');
      await first.waitForFunction(() => document.querySelector('[data-key-action="freeze"]')?.textContent === 'F', { polling: 100 });
      assert.deepEqual(await labels(first), defaults, 'reset also reaches the other tab');
      assert.deepEqual(errors, []);
    } finally { await context.close(); await independent.close(); }
  });

  test('touch settings retain remapping and fit inside a short viewport', async (t) => {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    const errors = [];
    recordProblems(page, errors, t);
    try {
      await page.setViewport({ width: 640, height: 360, isMobile: true, hasTouch: true });
      await page.goto(`${srv.url}/dev/game-mock.html?shot=1&render=fallback&phase=PREP`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('.ff-piece');
      await openSettings(page);
      assert.deepEqual(await labels(page), defaults, 'attached keyboards can still be customized on touch devices');
      assert.match(await page.$eval('.set-list', (el) => el.textContent), /触屏操作/);
      await page.$eval('.set-keys', (el) => el.scrollIntoView({ block: 'center' }));
      const layout = await page.$eval('.set-modal', (el) => {
        const rect = el.getBoundingClientRect();
        const body = el.querySelector('.modal__body');
        return { x: rect.x, right: rect.right, y: rect.y, bottom: rect.bottom, overflow: body.scrollWidth > body.clientWidth + 1,
          keys: [...el.querySelectorAll('.set-keys__key')].map((key) => key.getBoundingClientRect().height) };
      });
      assert.ok(layout.x >= 0 && layout.right <= 640 && layout.y >= 0 && layout.bottom <= 360, JSON.stringify(layout));
      assert.equal(layout.overflow, false, 'no horizontal overflow in the settings body');
      assert.ok(layout.keys.every((height) => height >= 44), `key buttons retain accessible touch target heights: ${JSON.stringify(layout)}`);
      await startEditing(page, 'freeze');
      await page.keyboard.press('Digit7');
      assert.equal((await labels(page)).freeze, '7');
      await assertIdle(page);
      if (OUT) await page.screenshot({ path: path.join(OUT, 'keybindings-touch.png') });
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });
});
