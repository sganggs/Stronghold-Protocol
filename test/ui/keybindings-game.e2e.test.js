// Issue #265: remapped keys reach the real game handlers and live hints through the mock server.
// SP_E2E=1 CHROME_PATH=/path/to/chrome node --test test/ui/keybindings-game.e2e.test.js
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);
const CUSTOM = { refresh: 'Digit1', freeze: 'KeyG', levelUp: 'KeyL', retreat: 'KeyT', sell: 'KeyY', ready: 'KeyP' };
// mockRequest answers after 40–100 ms. Negative / exactly-once assertions must outlast that delay.
const settle = () => new Promise((resolve) => setTimeout(resolve, 200));

describe('custom game shortcuts (issue #265)', { skip: !ENABLED && 'set SP_E2E=1 and CHROME_PATH to run' }, () => {
  let srv, browser;
  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--no-proxy-server'] });
  });
  after(async () => { await browser?.close(); await srv?.close(); });

  async function open(t, query = 'phase=PREP') {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    t.after(async () => { await context.close(); assert.deepEqual(errors, [], 'no browser runtime errors'); });
    await page.setViewport({ width: 1920, height: 1080 });
    await page.goto(`${srv.url}/dev/game-mock.html?shot=1&render=fallback&${query}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => globalThis.__MOCK__ && document.querySelector('.gm:not(.gload)'));
    await page.waitForSelector(query.includes('phase=PREP') ? '.ff-piece' : '.gm--combat');
    return page;
  }

  async function bind(page, map = CUSTOM) {
    await page.evaluate(async (bindings) => {
      const { updateKeybinding } = await import('/js/ui/keymapStore.js');
      for (const [action, code] of Object.entries(bindings)) updateKeybinding(action, code);
      await new Promise(requestAnimationFrame);
    }, map);
  }

  // Selecting an operator also fetches read-only unit stats; compare only gameplay requests.
  const requests = (page) => page.evaluate(() => globalThis.__MOCK__.S().requests.filter(([type]) => type !== 'g.unitStats'));
  const state = (page) => page.evaluate(() => globalThis.__MOCK__.S().priv);
  const pressAll = async (page, keys = Object.values(CUSTOM)) => {
    for (const key of keys) await page.keyboard.press(key);
    await settle();
  };
  async function expectAction(page, key, type) {
    const count = (await requests(page)).length;
    await page.keyboard.press(key);
    await page.waitForFunction((n) => globalThis.__MOCK__.S().requests.filter(([type]) => type !== 'g.unitStats').length > n, {}, count);
    await settle();
    const sent = (await requests(page)).slice(count);
    assert.deepEqual(sent.map(([name]) => name), [type], `${key} sends ${type} exactly once`);
    return sent[0][1];
  }

  test('all six bindings replace defaults and update the shop, HUD and selected-unit hints immediately', async (t) => {
    const page = await open(t);
    await page.evaluate(() => globalThis.__MOCK__.mutate((s) => { s.priv.funds = 40; }));
    const original = await state(page);
    const unit = original.board.find((piece) => piece.kind === 'chess' && !piece.golden);
    await page.click(`.ff-piece[data-uid="${unit.uid}"]`);
    await page.waitForSelector('.uframe__btn--retreat');
    await bind(page);
    const hints = await page.evaluate(() => {
      const button = (selector) => {
        const el = document.querySelector(selector);
        return { text: el.textContent, title: el.title, key: el.getAttribute('aria-keyshortcuts') };
      };
      return {
        refresh: button('.toolbtn--amber'), freeze: button('.toolbtn--ice'), level: button('.lvcard'),
        ready: document.querySelector('.readybtn__key').textContent,
        retreat: button('.uframe__btn--retreat'), sell: button('.uframe__btn--sell'),
      };
    });
    for (const [name, label] of [['refresh', '1'], ['freeze', 'G'], ['level', 'L']]) {
      assert.ok(hints[name].text.includes(label), `${name} key badge`);
      assert.ok(hints[name].title.endsWith(` · ${label}`), `${name} title`);
    }
    assert.equal(hints.ready, 'P');
    for (const [name, label] of [['retreat', 'T'], ['sell', 'Y']]) {
      assert.ok(hints[name].text.includes(`[${label}]`));
      assert.ok(hints[name].title.includes(label));
      assert.equal(hints[name].key, label, 'accessible key shortcut follows the remap');
    }
    const before = await requests(page);
    await page.evaluate(() => document.activeElement?.blur());
    await pressAll(page, ['KeyR', 'KeyF', 'KeyD', 'KeyQ', 'KeyX', 'Space']);
    assert.deepEqual(await requests(page), before, 'old bindings no longer dispatch');
    assert.equal(await page.$('.modal'), null, 'old Space does not open ready confirmation');
    await expectAction(page, 'Digit1', 'g.refresh');
    assert.equal((await state(page)).funds, original.funds - 1);
    await expectAction(page, 'KeyG', 'g.freeze');
    assert.equal((await state(page)).shop.frozen, true);
    await expectAction(page, 'KeyL', 'g.levelUp');
    assert.equal((await state(page)).shop.level, original.shop.level + 1);
    const retreat = await expectAction(page, 'KeyT', 'g.move');
    assert.equal(retreat.uid, unit.uid);
    assert.equal(retreat.to.area, 'hand');
    await page.click(`.ff-piece[data-uid="${unit.uid}"]`);
    await page.waitForSelector('.uframe__btn--sell');
    assert.equal((await expectAction(page, 'KeyY', 'g.sell')).uid, unit.uid);
    assert.ok(!(await state(page)).hand.some((piece) => piece?.uid === unit.uid));
    await page.evaluate(() => globalThis.__MOCK__.mutate((s) => { s.priv.funds = 0; }));
    assert.deepEqual(await expectAction(page, 'KeyP', 'g.ready'), { ready: true });
    assert.equal((await state(page)).ready, true);
    assert.deepEqual(await expectAction(page, 'KeyP', 'g.ready'), { ready: false });
  });

  test('typing, IME composition, repeated and modified keys never dispatch custom shortcuts', async (t) => {
    const page = await open(t);
    await bind(page);
    const before = await requests(page);
    await page.evaluate(() => {
      const input = document.createElement('input');
      input.id = 'keybindings-test-input';
      document.body.append(input);
      input.focus();
    });
    await pressAll(page);
    assert.deepEqual(await requests(page), before, 'typing leaves gameplay alone');
    await page.evaluate(() => document.getElementById('keybindings-test-input').remove());
    await page.evaluate((codes) => {
      for (const code of codes) {
        for (const flags of [{ isComposing: true }, { keyCode: 229 }, { repeat: true }, { ctrlKey: true },
          { metaKey: true }, { altKey: true }, { shiftKey: true }]) {
          document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, code, key: code.slice(-1).toLowerCase(), ...flags }));
        }
      }
    }, Object.values(CUSTOM));
    await settle();
    assert.deepEqual(await requests(page), before, 'IME, repeats and every modifier leave gameplay alone');
    await expectAction(page, 'Digit1', 'g.refresh');
  });

  test('drawer, modal and the placement wheel block custom shortcuts; Escape cancels placement', async (t) => {
    const page = await open(t);
    await bind(page);
    const before = await requests(page);
    for (const [opener, overlay] of [['[data-testid="check-player"]', '.edrawer'], ['.gm__gear[aria-label="设置"]', '.modal']]) {
      await page.click(opener);
      await page.waitForSelector(overlay);
      await pressAll(page);
      assert.deepEqual(await requests(page), before, `${overlay} owns the keyboard`);
      await page.keyboard.press('Escape');
      await page.waitForSelector(overlay, { hidden: true });
    }
    // Select a genuinely legal empty tile for a hand operator, using the real stage and placement rules.
    const placement = await page.evaluate(async () => {
      const { placementContext, canPlace } = await import('/js/ui/gameLogic.js');
      const { data } = await import('/js/data.js');
      const s = globalThis.__MOCK__.S();
      const ctx = placementContext({ priv: s.priv, stage: s.stage, editable: true,
        getChess: (id) => data.lookup('chess', id), getToken: (id) => data.lookup('tokens', id), getItem: (id) => data.lookup('items', id) });
      for (const piece of s.priv.hand.filter((p) => p?.kind === 'chess')) {
        for (const tile of document.querySelectorAll('.ff-tile')) {
          const row = Number(tile.dataset.row), col = Number(tile.dataset.col);
          if (!s.priv.board.some((p) => p.row === row && p.col === col) && canPlace(ctx, piece.uid, { area: 'board', row, col }).ok) {
            return { uid: piece.uid, row, col };
          }
        }
      }
      return null;
    });
    assert.ok(placement, 'the fixture has a legal placement');
    const center = (selector) => page.$eval(selector, (el) => {
      const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    const from = await center(`.ff-piece[data-uid="${placement.uid}"]`);
    const to = await center(`.ff-tile[data-row="${placement.row}"][data-col="${placement.col}"]`);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.mouse.up();
    await page.waitForSelector('.fwheel__dia');
    await pressAll(page);
    assert.deepEqual(await requests(page), before, 'the wheel blocks all rebound game actions');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.fwheel', { hidden: true });
    assert.deepEqual(await requests(page), before, 'cancelling never sends the pending move');
    await expectAction(page, 'Digit1', 'g.refresh');
  });

  test('Space rebound to refresh overrides another focused button and a held key fires once', async (t) => {
    const page = await open(t);
    await bind(page, { ...CUSTOM, refresh: 'Space' });
    await page.focus('.toolbtn--ice');
    await page.evaluate(() => {
      globalThis.__nativeFreezeClicks = 0;
      document.querySelector('.toolbtn--ice').addEventListener('click', () => globalThis.__nativeFreezeClicks++);
    });
    const count = (await requests(page)).length;
    await page.keyboard.down('Space');
    await page.waitForFunction((n) => globalThis.__MOCK__.S().requests.filter(([type]) => type !== 'g.unitStats').length > n, {}, count);
    await page.keyboard.down('Space'); // Chrome generates repeat=true for an already held key.
    await page.keyboard.down('Space');
    await page.keyboard.up('Space');
    await settle();
    assert.deepEqual((await requests(page)).slice(count), [['g.refresh', {}]], 'one physical press produces one refresh');
    assert.equal((await state(page)).shop.frozen, false);
    assert.equal(await page.evaluate(() => globalThis.__nativeFreezeClicks), 0, 'no native Space click on keyup');
    await page.focus('.bonds-toggle');
    const expanded = await page.$eval('.bonds-toggle', (el) => el.getAttribute('aria-expanded'));
    await page.keyboard.press('Space');
    await page.waitForFunction((old) => document.querySelector('.bonds-toggle').getAttribute('aria-expanded') !== old, {}, expanded);
    await settle();
    assert.equal((await requests(page)).length, count + 1, 'the bond toggle retains its native Space interaction');
  });

  test('the custom ready key pauses and resumes solo combat, updates its tooltip, and never pauses coop', async (t) => {
    const solo = await open(t, 'phase=COMBAT&variant=solo');
    await bind(solo);
    await solo.waitForSelector('[data-testid="pause"]');
    await solo.hover('[data-testid="pause"]');
    await solo.waitForFunction(() => document.querySelector('[role="tooltip"]')?.textContent.includes('暂停作战（P）'));
    await solo.mouse.move(0, 0);
    await pressAll(solo, ['Space']);
    assert.deepEqual(await requests(solo), [], 'old Space no longer pauses');
    assert.deepEqual(await expectAction(solo, 'KeyP', 'g.pause'), { on: true });
    await solo.waitForSelector('[data-testid="paused"]');
    assert.deepEqual(await expectAction(solo, 'KeyP', 'g.pause'), { on: false });
    await solo.waitForSelector('[data-testid="paused"]', { hidden: true });

    const coop = await open(t, 'phase=COMBAT');
    await bind(coop);
    const before = await requests(coop);
    await pressAll(coop, ['KeyP', 'Space']);
    assert.deepEqual(await requests(coop), before);
    assert.equal(await coop.$('[data-testid="pause"]'), null);
    assert.equal(await coop.$('[data-testid="paused"]'), null);
  });
});
