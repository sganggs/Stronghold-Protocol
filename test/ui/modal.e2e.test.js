// Shared Modal keyboard boundaries, real Chrome. Component fixtures cover nested / empty dialogs; the settings
// case uses the real title screen. Opt-in: SP_E2E=1 node --test test/ui/modal.e2e.test.js
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);

describe('Modal keyboard focus', { skip: !ENABLED && 'set SP_E2E=1 and have Chrome to run' }, () => {
  let srv, browser;
  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--no-proxy-server'] });
  });
  after(async () => { await browser?.close(); await srv?.close(); });
  const active = (page) => page.evaluate(() => document.activeElement.id);
  const tab = async (page, reverse = false) => {
    if (reverse) await page.keyboard.down('Shift');
    await page.keyboard.press('Tab');
    if (reverse) await page.keyboard.up('Shift');
  };
  async function fixture(page) {
    page.setDefaultTimeout(5000);
    await page.goto(`${srv.url}/dev/uikit.html`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(async () => {
      const { render } = await import('/vendor/preact.module.js');
      const { useState } = await import('/vendor/hooks.module.js');
      const { html, Modal, DialogHost, confirmDialog } = await import('/js/ui/components.js');
      function Fixture() {
        const [outer, setOuter] = useState(false), [inner, setInner] = useState(false), [empty, setEmpty] = useState(false);
        return html`<div>
          <button id="open" onClick=${() => setOuter(true)}>Open</button>
          <button id="empty-open" onClick=${() => setEmpty(true)}>Empty</button>
          <button id="confirm" onClick=${async () => { const ok = await confirmDialog({ text: 'Confirm?' }); document.querySelector('#result').textContent = String(ok); }}>Confirm</button>
          <output id="result"></output>
          <${Modal} open=${outer} onClose=${() => setOuter(false)}>
            <textarea id="first"></textarea>
            <button disabled>Disabled</button><input type="hidden" /><button hidden>Hidden</button>
            <button style="display:none">Display none</button><button style="visibility:hidden">Invisible</button>
            <div inert><button>Inert</button></div><button tabindex="-1">Programmatic only</button>
            <button id="inner-open" onClick=${() => setInner(true)}>Nested</button>
            <a id="last" href="#inside">Last</a>
          <//>
          <${Modal} open=${inner} onClose=${() => setInner(false)}>
            <button id="inner-first" data-autofocus>First</button><button id="inner-last">Last</button>
          <//>
          <${Modal} open=${empty} onClose=${() => setEmpty(false)}>No controls<//>
          <${DialogHost} />
        </div>`;
      }
      render(html`<${Fixture} />`, document.getElementById('kit'));
    });
  }

  test('initial focus, both Tab boundaries, nested priority, recovery and cleanup', async () => {
    const page = await browser.newPage();
    try {
      await fixture(page);
      await page.click('#open');
      await page.waitForFunction(() => document.activeElement.id === 'first');
      await tab(page, true);
      assert.equal(await active(page), 'last', 'hidden, disabled, inert and negative-tabindex controls are excluded');
      await tab(page);
      assert.equal(await active(page), 'first');
      await tab(page);
      assert.equal(await active(page), 'inner-open');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.activeElement.id === 'inner-first');
      await tab(page, true);
      assert.equal(await active(page), 'inner-last', 'only the topmost dialog traps focus');
      await tab(page);
      assert.equal(await active(page), 'inner-first');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.querySelectorAll('.modal').length === 1);
      assert.equal(await active(page), 'inner-open');
      await page.focus('#open');
      assert.equal(await active(page), 'first', 'focus escaping to the background returns to the active dialog');
      await page.keyboard.press('Escape');
      await page.waitForSelector('.modal', { hidden: true });
      assert.equal(await active(page), 'open');
      await tab(page);
      assert.equal(await active(page), 'empty-open', 'closed dialogs no longer trap focus');
      await page.click('#open');
      await page.waitForFunction(() => document.activeElement.id === 'first');
      await tab(page, true);
      assert.equal(await active(page), 'last', 'reopening does not leave stale listeners');
    } finally { await page.close(); }
  });

  test('no controls: focus the dialog itself; imperative confirm retains autofocus and native Enter', async () => {
    const page = await browser.newPage();
    try {
      await fixture(page);
      await page.click('#empty-open');
      await page.waitForFunction(() => document.activeElement.matches('.modal__box'));
      for (const reverse of [false, true]) {
        await tab(page, reverse);
        assert.equal(await page.evaluate(() => document.activeElement.matches('.modal__box')), true);
      }
      await page.keyboard.press('Escape');
      await page.waitForSelector('.modal', { hidden: true });
      assert.equal(await active(page), 'empty-open');
      await page.click('#confirm');
      await page.waitForFunction(() => document.activeElement.hasAttribute('data-autofocus'));
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelector('#result').textContent === 'true');
      assert.equal(await active(page), 'confirm');
    } finally { await page.close(); }
  });

  test('title settings: Tab cycles and leaves hotkey capture; Esc cancels capture before closing', async () => {
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 1280, height: 720 });
      page.setDefaultTimeout(5000);
      await page.goto(srv.url, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.title-settings');
      await page.click('.title-settings');
      await page.waitForFunction(() => document.querySelector('.modal__box')?.contains(document.activeElement));
      const assertInside = async () => assert.equal(await page.evaluate(() => document.querySelector('.modal__box').contains(document.activeElement)), true);
      for (const reverse of [false, true]) for (let i = 0; i < 25; i++) { await tab(page, reverse); await assertInside(); }
      await page.focus('.set-key[data-action="retreat"]');
      await page.keyboard.press('Enter');
      await page.waitForSelector('.set-key.is-waiting');
      await tab(page);
      await page.waitForSelector('.set-key.is-waiting', { hidden: true });
      await assertInside();
      assert.equal(await page.$eval('.set-key[data-action="retreat"]', (el) => el.textContent.trim()), 'Q');
      await page.focus('.set-key[data-action="retreat"]');
      await page.keyboard.press('Enter');
      await page.waitForSelector('.set-key.is-waiting');
      await page.keyboard.press('Escape');
      await page.waitForSelector('.set-key.is-waiting', { hidden: true });
      assert.ok(await page.$('.modal'), 'capture consumes the first Esc');
      await page.keyboard.press('Escape');
      await page.waitForSelector('.modal', { hidden: true });
      assert.equal(await page.evaluate(() => document.activeElement.matches('.title-settings')), true);
      assert.ok(await page.$('.title-screen'), 'the background start button was not activated');
    } finally { await page.close(); }
  });

  test('settings lets the higher guide keep keyboard focus and resumes after it closes', async () => {
    const page = await browser.newPage();
    try {
      page.setDefaultTimeout(5000);
      await page.goto(srv.url, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.title-settings');
      await page.click('.title-settings');
      await page.waitForSelector('.set-guide');
      await page.waitForFunction(() => !document.querySelector('.modal__box').getAnimations().some((a) => a.playState === 'running'));
      await page.click('.set-guide');
      await page.waitForSelector('.guide');
      await page.waitForFunction(() => document.querySelector('.guide').contains(document.activeElement));
      await tab(page);
      assert.equal(await page.evaluate(() => document.querySelector('.guide').contains(document.activeElement)), true);
      await page.keyboard.press('Escape');
      await page.waitForSelector('.guide', { hidden: true });
      assert.ok(await page.$('.modal'), 'closing the guide keeps settings');
      await tab(page);
      assert.equal(await page.evaluate(() => document.querySelector('.modal__box').contains(document.activeElement)), true);
      await page.click('.modal__actions button:last-child');
      await page.waitForSelector('.modal', { hidden: true });
    } finally { await page.close(); }
  });
});
