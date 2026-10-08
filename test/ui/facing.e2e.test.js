// Actual FacingWheel keyboard interactions through the in-match mock harness (no optional art required).
// SP_E2E=1 node --test test/ui/facing.e2e.test.js
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('facing wheel keyboard (in-match UI, headless Chrome)', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome) to run' }, () => {
  let srv, browser;
  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  });
  after(async () => { await browser?.close(); await srv?.close(); });

  async function setup(t) {
    const page = await browser.newPage();
    t.after(() => page.close());
    await page.setViewport({ width: 1920, height: 1080 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${srv.port}/dev/game-mock.html?shot=1&render=fallback&phase=PREP`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.ff-piece');
    const state = () => page.evaluate(() => JSON.parse(JSON.stringify(globalThis.__MOCK__.S().priv)));
    const requests = () => page.evaluate(() => globalThis.__MOCK__.S().requests.filter(([type]) => type === 'g.move'));
    const initial = await state();
    // Make room under the deploy cap using the real UI, then choose an unoccupied legal tile.
    const sell = initial.board.find((p) => p.kind === 'chess' && !p.golden);
    await page.click(`.ff-piece[data-uid="${sell.uid}"]`);
    await page.waitForSelector('.uframe__btn--sell');
    await page.click('.uframe__btn--sell');
    await page.waitForFunction((uid) => !globalThis.__MOCK__.S().priv.board.some((p) => p.uid === uid), {}, sell.uid);
    const ready = await state();
    const piece = ready.hand.find((p) => p?.kind === 'chess');
    const tile = [[9, 9], [9, 8], [12, 6], [11, 7], [10, 7], [9, 7]].find(([r, c]) => !ready.board.some((p) => p.row === r && p.col === c));
    assert.ok(piece && tile, 'an operator and free legal tile exist');
    const center = (sel) => page.$eval(sel, (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    const open = async () => {
      const from = await center(`.ff-piece[data-uid="${piece.uid}"]`);
      const to = await center(`.ff-tile[data-row="${tile[0]}"][data-col="${tile[1]}"]`);
      await page.mouse.move(from.x, from.y); await page.mouse.down();
      await page.mouse.move(from.x + 20, from.y, { steps: 4 }); // also trigger an in-place reorientation drag
      await page.mouse.move(to.x, to.y, { steps: 12 }); await sleep(80); await page.mouse.up();
      await page.waitForSelector('.fwheel__dia');
      await sleep(200); // let the capture listener's mount effect settle
    };
    const preview = async (key) => {
      await page.keyboard.press(key);
      await page.waitForSelector(`.fwheel.is-${key.slice(5).toLowerCase()}`);
    };
    const closed = async () => { await page.waitForFunction(() => !document.querySelector('.fwheel')); await sleep(150); };
    const tabTo = async (selector) => {
      for (let i = 0; i < 80; i++) {
        await page.keyboard.press('Tab');
        if (await page.evaluate((s) => document.activeElement?.matches(s), selector)) return;
      }
      assert.fail(`Tab did not focus ${selector}`);
    };
    return { page, state, requests, errors, ready, piece, tile, open, preview, tabTo, closed };
  }

  test('Enter on a focused HUD button leaves the facing preview and placement unchanged', async (t) => {
    const h = await setup(t);
    await h.open();
    await h.preview('ArrowRight');
    await h.tabTo('.gtop__iconbtn[aria-label="本局信息"]');
    const control = await h.page.evaluate(() => ({
      tag: document.activeElement.tagName,
      disabled: document.activeElement.disabled,
      ariaDisabled: document.activeElement.getAttribute('aria-disabled'),
    }));
    assert.deepEqual(control, { tag: 'BUTTON', disabled: false, ariaDisabled: 'false' });
    await h.page.keyboard.press('Enter');
    await sleep(150);
    assert.ok(await h.page.$('.fwheel.is-right'), 'the preview remains open');
    assert.deepEqual(await h.requests(), [], 'focused HUD Enter sends no placement intent');
    assert.deepEqual(await h.state(), h.ready, 'the operator remains in its original location');
    assert.equal(await h.page.$('.gtop__iconbtn.is-on'), null, 'the covered HUD action stays blocked');
    assert.deepEqual(h.errors, []);
  });

  test('focused settings, guide, ready and shop buttons stay blocked during facing', async (t) => {
    const h = await setup(t);
    await h.open();
    await h.preview('ArrowRight');
    for (const selector of ['.gm__gear[aria-label="设置"]', '.gm__guide', '.readybtn', '.toolbtn--ice']) {
      await h.tabTo(selector);
      await h.page.keyboard.press('Enter');
      await sleep(150);
      assert.ok(await h.page.$('.fwheel.is-right'), selector);
      assert.deepEqual(await h.requests(), [], selector);
      assert.deepEqual(await h.state(), h.ready, selector);
    }
    assert.deepEqual(h.errors, []);
  });

  test('HUD Enter without a direction and bound action keys keep the preview open', async (t) => {
    const h = await setup(t);
    await h.open();
    await h.tabTo('.gtop__iconbtn[aria-label="本局信息"]');
    await h.page.keyboard.press('Enter');
    await sleep(150);
    assert.ok(await h.page.$('.fwheel'), 'HUD Enter does not activate a covered control');
    assert.equal(await h.page.$('.gtop__iconbtn.is-on'), null);
    await h.preview('ArrowRight');
    for (const key of ['Space', 'KeyF', 'KeyR', 'KeyD']) {
      await h.page.keyboard.press(key);
      await sleep(80);
      assert.ok(await h.page.$('.fwheel.is-right'), key);
      assert.deepEqual(await h.state(), h.ready, key);
    }
    await h.page.keyboard.press('Escape');
    await h.closed();
    assert.deepEqual(await h.requests(), []);
    assert.deepEqual(await h.state(), h.ready);
    assert.deepEqual(h.errors, []);
  });

  test('arrows plus Enter on the field confirm exactly once in all four directions', async (t) => {
    const h = await setup(t);
    for (const dir of ['UP', 'RIGHT', 'DOWN', 'LEFT']) {
      await h.open();
      assert.equal(await h.page.evaluate(() => !!document.activeElement?.closest('button, [role="button"]')), false);
      await h.preview('Arrow' + dir[0] + dir.slice(1).toLowerCase());
      const count = (await h.requests()).length;
      await h.page.keyboard.press('Enter');
      await h.closed();
      assert.equal((await h.requests()).length, count + 1, 'one intent per confirmation');
      assert.deepEqual((await h.requests()).at(-1), ['g.move', { uid: h.piece.uid, to: { area: 'board', row: h.tile[0], col: h.tile[1], dir }, dir }]);
      const board = (await h.state()).board.filter((p) => p.uid === h.piece.uid);
      assert.equal(board.length, 1, 'reorienting keeps a single operator');
      assert.deepEqual([board[0].row, board[0].col, board[0].dir], [...h.tile, dir]);
    }
    assert.deepEqual(h.errors, []);
  });
});
