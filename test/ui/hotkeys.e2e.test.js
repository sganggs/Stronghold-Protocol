// Rebindable shortcuts (Settings > Shortcuts) in the mock match, headless Chrome, the DOM field (no art / WebGL needed):
// Retreat rebound from Q to W with the keyboard only: Enter on the key waits, Esc ends the wait (the dialog stays), a refused
// key keeps it; a swap and reset with their messages, Q then does nothing and W retreats, the underframe shows W, the
// choice survives a reload; at phone width (640×360, touch) the section fits and says the keys need a keyboard.
// Unit side: test/ui/feedback5-hotkeys.test.js.
// SP_E2E=1 CHROME_PATH=/path/to/chrome node --test test/ui/hotkeys.e2e.test.js
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../e2e/out/', import.meta.url));
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);

describe('rebindable shortcuts (设置 → 快捷键)', { skip: !ENABLED && 'set SP_E2E=1 and CHROME_PATH to run' }, () => {
  let srv, browser;
  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--no-proxy-server'] });
    mkdirSync(OUT, { recursive: true });
  });
  after(async () => { await browser?.close(); await srv?.close(); });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const mockState = (page) => page.evaluate(() => JSON.parse(JSON.stringify(globalThis.__MOCK__.S().priv)));
  const keyOf = (page, action) => page.$eval(`.set-key[data-action="${action}"]`, (el) => el.textContent.trim());
  const keyIs = (page, action, label) => page.waitForFunction((a, l) => document.querySelector(`.set-key[data-action="${a}"]`)?.textContent.trim() === l, {}, action, label);
  const note = (page) => page.$eval('.set-keys__note', (el) => el.textContent.trim());

  async function open(page, { width = 1280, height = 720, touch = false } = {}) {
    const problems = [];
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
    await page.setViewport({ width, height, isMobile: touch, hasTouch: touch });
    await page.goto(`${srv.url}/dev/game-mock.html?shot=1&render=fallback&phase=PREP`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.ff-piece');
    return problems;
  }

  test('撤退 rebound to W in a mock match: keyboard only, swap, Esc, refusal, the HUD hint, a reload', async () => {
    const page = await browser.newPage();
    try {
      const problems = await open(page);
      await page.click('.gm__gear');
      await page.waitForSelector('.modal .set-keys');
      await page.waitForFunction(() => !document.querySelector('.modal__box')?.getAnimations().some((a) => a.playState === 'running'));
      await page.$eval('.set-keys', (el) => el.scrollIntoView({ block: 'start' }));
      await page.screenshot({ path: `${OUT}/hotkeys-desktop.png` });
      assert.deepEqual(await page.$$eval('.set-key[data-action]', (els) => els.map((el) => el.textContent.trim())), ['W', 'R', 'F', 'D', 'Q', 'X', 'Space'],
        'the defaults include W to buy');

      // Swap retreat onto X (sell's key): sell takes the old Q, and the line under the list says so.
      await page.click('.set-key[data-action="retreat"]');
      await page.waitForSelector('.set-key.is-waiting[data-action="retreat"]');
      assert.match(await note(page), /请按下「撤退干员（选中优先）」的新按键（Esc 取消）/);
      await page.keyboard.press('KeyX');
      await keyIs(page, 'retreat', 'X');
      assert.equal(await keyOf(page, 'sell'), 'Q');
      assert.match(await note(page), /「撤退干员（选中优先）」已改为 X；「出售干员（选中优先）」原来用 X，已换成 Q/);
      await page.click('.set-keys__reset');
      await keyIs(page, 'retreat', 'Q');
      assert.equal(await keyOf(page, 'sell'), 'X');
      assert.match(await note(page), /已恢复默认快捷键/);
      assert.equal(await page.$eval('.set-keys__reset', (el) => el.disabled), true, '恢复默认 is off at the defaults');

      // keyboard only: Enter on the focused key waits; Esc ends the wait and the dialog stays open
      await page.focus('.set-key[data-action="retreat"]');
      await page.keyboard.press('Enter');
      await page.waitForSelector('.set-key.is-waiting[data-action="retreat"]');
      await page.keyboard.press('Escape');
      await page.waitForSelector('.set-key.is-waiting', { hidden: true });
      assert.ok(await page.$('.modal .set-keys'), 'Esc ends the wait, not the dialog');
      assert.match(await note(page), /已取消，「撤退干员（选中优先）」仍是 Q/);
      // the focus stayed on the key: Enter waits again; Enter itself is refused and the wait goes on; W is taken
      await page.keyboard.press('Enter');
      await page.waitForSelector('.set-key.is-waiting[data-action="retreat"]');
      await page.keyboard.press('Enter');
      await sleep(100);
      assert.match(await note(page), /Enter 不能设为快捷键/);
      assert.ok(await page.$('.set-key.is-waiting[data-action="retreat"]'), 'a refused key keeps the wait');
      await page.keyboard.press('KeyW');
      await keyIs(page, 'retreat', 'W');
      assert.equal(await keyOf(page, 'buy'), 'Q', 'rebinding onto W swaps the buy key');
      assert.match(await note(page), /「撤退干员（选中优先）」已改为 W/);
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('sp.pref.settings')).keys.retreat), 'KeyW', 'saved with the settings');
      await page.keyboard.press('Escape'); // no wait: Esc closes the dialog as before
      await page.waitForSelector('.modal', { hidden: true });

      // the match: the underframe shows W, Q no longer retreats, W does
      const initial = await mockState(page);
      const unit = initial.board.find((p) => p.kind === 'chess' && !p.golden);
      await page.click(`.ff-piece[data-uid="${unit.uid}"]`);
      await page.waitForSelector('.uframe__btn--retreat');
      assert.match(await page.$eval('.uframe__btn--retreat', (el) => el.textContent), /\[W\]/);
      assert.equal(await page.$eval('.uframe__btn--retreat', (el) => el.getAttribute('aria-keyshortcuts')), 'W');
      await page.keyboard.press('KeyQ');
      await sleep(300);
      assert.deepEqual(await mockState(page), initial, 'Q no longer retreats');
      await page.keyboard.press('KeyW');
      await page.waitForFunction((uid) => globalThis.__MOCK__.S().priv.hand.some((p) => p?.uid === uid), {}, unit.uid);
      assert.equal((await mockState(page)).funds, initial.funds, 'W retreats (it does not sell)');

      // The choice survives a reload; reset brings Q back.
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.ff-piece');
      await page.click('.gm__gear');
      await page.waitForSelector('.modal .set-keys');
      assert.equal(await keyOf(page, 'retreat'), 'W');
      await page.click('.set-keys__reset');
      await keyIs(page, 'retreat', 'Q');
      assert.deepEqual(problems, []);
    } finally { await page.close(); }
  });

  test('phone width (640×360, touch): the keys need a keyboard, the folded list opens and fits, no horizontal scroll', async () => {
    const page = await browser.newPage();
    try {
      const problems = await open(page, { width: 640, height: 360, touch: true });
      await page.tap('.gm__gear');
      await page.waitForSelector('.modal .set-keys');
      assert.match(await page.$eval('.set-keys .set-hint', (el) => el.textContent), /快捷键需要实体键盘/);
      assert.equal(await page.$eval('.set-keys__more', (el) => el.open), false, 'the list is folded on a touch-only device');
      // (tap once the dialog's entrance animation is over: a tap during it lands where the summary is about to be)
      await page.waitForFunction(() => !document.querySelector('.modal__box')?.getAnimations().some((a) => a.playState === 'running'));
      await page.tap('.set-keys__more > summary');
      await page.waitForFunction(() => document.querySelector('.set-keys__more')?.open === true);
      const box = await page.$eval('.modal__body', (body) => {
        const b = body.getBoundingClientRect();
        const rows = [...body.querySelectorAll('.set-keys__row')].map((r) => r.getBoundingClientRect());
        return { scroll: body.scrollWidth, client: body.clientWidth, left: b.left, right: b.right, rows: rows.map((r) => [r.left, r.right, r.width]) };
      });
      assert.ok(box.scroll <= box.client, `no horizontal scroll in the dialog (${box.scroll} > ${box.client})`);
      assert.equal(box.rows.length, 8, 'seven shortcuts and the fixed Esc');
      for (const [l, r, w] of box.rows) assert.ok(l >= box.left - 0.5 && r <= box.right + 0.5 && w > 0, `a row inside the dialog: ${l}–${r}`);
      assert.equal(new Set(box.rows.map(([l]) => Math.round(l))).size, 1, 'one column at phone width');
      await page.$eval('.set-keys__more', (el) => el.scrollIntoView({ block: 'start' }));
      assert.equal(await page.$eval('.set-keys__more', (el) => el.open), true);
      await page.screenshot({ path: `${OUT}/hotkeys-phone.png` });
      assert.deepEqual(problems, []);
    } finally { await page.close(); }
  });

  test('W buys the hovered shop card without clicking, with purchase guards and no stale target', async (t) => {
    const context = await browser.createBrowserContext();
    t.after(() => context.close());
    const page = await context.newPage();
    const problems = await open(page, { width: 1920, height: 1080 });
    const card = (i) => `.shopbar .scard[data-shop-slot="${i}"]`;
    const frame = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const calls = () => page.evaluate(() => globalThis.__BUY_CALLS__);
    const sold = (i) => page.waitForFunction((idx) => globalThis.__MOCK__.S().priv.shop.slots[idx].sold, {}, i);
    const inert = async (why, key = 'KeyW') => {
      const before = await calls();
      await page.keyboard.press(key);
      await sleep(180);
      assert.deepEqual(await calls(), before, why);
    };
    await page.evaluate(async () => {
      const { net } = await import('/js/net.js');
      const request = net.request.bind(net);
      globalThis.__BUY_CALLS__ = [];
      net.request = async (type, fields) => {
        if (type === 'g.buy') {
          globalThis.__BUY_CALLS__.push(fields.slot);
          if (globalThis.__HOLD_BUY__) await new Promise((resolve) => { globalThis.__RELEASE_BUY__ = resolve; });
        }
        return request(type, fields);
      };
    });

    await page.evaluate(() => globalThis.__MOCK__.mutate((s) => { s.priv.hand.fill(null); s.priv.funds = 100; }));
    await frame();
    const initial = await mockState(page);
    await page.hover(card(0));
    assert.equal(await page.$('.scard.is-armed'), null, 'no preceding click or selection');
    assert.equal(await page.$eval(card(0), (el) => el.getAttribute('aria-keyshortcuts')), 'W');
    await page.keyboard.press('KeyW');
    await sold(0);
    assert.deepEqual(await calls(), [0]);
    assert.equal((await mockState(page)).funds, initial.funds - initial.shop.slots[0].price);
    await inert('a sold card cannot buy again');

    // A different clicked card must not override the current pointer target.
    await page.click(card(1));
    await page.waitForSelector(`${card(1)}.is-armed`);
    const itemIndex = initial.shop.slots.findIndex((s) => s?.kind === 'item');
    await page.hover(card(itemIndex));
    await page.keyboard.press('KeyW');
    await sold(itemIndex);
    assert.deepEqual(await calls(), [0, itemIndex], 'item cards use their actual shop index');
    assert.equal((await mockState(page)).shop.slots[1].sold, false, 'the old selection stays unsold');
    await page.hover('.lvcard');
    await inert('W over upgrade cannot buy the old selection');
    await page.hover('.gm__gear');
    await inert('W over HUD cannot buy');
    await page.keyboard.press('Escape');

    // Keep the same slot request pending across keyboard repeats and the ordinary two-click flow.
    await page.evaluate(() => { globalThis.__HOLD_BUY__ = true; });
    await page.hover(card(1));
    await page.keyboard.down('KeyW');
    await page.waitForFunction(() => !!globalThis.__RELEASE_BUY__);
    await page.hover(card(3));
    await page.keyboard.down('KeyW'); // auto-repeat, even over a different card
    await page.keyboard.up('KeyW');
    await page.click(card(1));
    await page.click(card(1));
    assert.deepEqual(await calls(), [0, itemIndex, 1], 'one request per slot while in flight; held W never chains purchases');
    await page.evaluate(() => { globalThis.__HOLD_BUY__ = false; globalThis.__RELEASE_BUY__(); });
    await sold(1);

    await page.evaluate(() => globalThis.__MOCK__.mutate((s) => { s.priv.funds = 0; }));
    await frame();
    await page.hover(card(3));
    await inert('insufficient funds send no purchase intent');
    assert.match(await page.$$eval('.toast', (els) => els.map((el) => el.textContent).join('\n')), /资金不足/);
    await page.evaluate(() => globalThis.__MOCK__.mutate((s) => {
      s.priv.funds = 100;
      globalThis.__SAVED_HAND__ = s.priv.hand.slice();
      const sample = s.priv.hand.find(Boolean);
      s.priv.hand = s.priv.hand.map((p, i) => p || { ...sample, uid: 9000 + i });
    }));
    await frame();
    await page.hover(card(3));
    await inert('a full bench sends no purchase intent');
    assert.match(await page.$$eval('.toast', (els) => els.map((el) => el.textContent).join('\n')), /整备区已满/);
    await page.evaluate(() => globalThis.__MOCK__.mutate((s) => { s.priv.hand = globalThis.__SAVED_HAND__; }));
    await frame();
    await page.hover(card(3));
    await page.mouse.down();
    await inert('mouse-button holds block buying');
    await page.mouse.up();
    await page.keyboard.press('Escape');

    await page.click('.gm__gear');
    await page.waitForSelector('.modal .set-keys');
    await page.hover(card(3));
    await inert('the settings dialog blocks buying');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.modal', { hidden: true });
    await page.hover(card(3));
    await page.evaluate(() => {
      const input = document.createElement('input'); input.id = 'buy-test-input';
      document.body.append(input); input.focus();
    });
    await inert('typing W does not buy');
    await page.evaluate(() => document.querySelector('#buy-test-input').remove());

    await page.evaluate(() => globalThis.__MOCK__.mutate((s) => {
      s.priv.shop.rewardOffer = { tier: 5, slots: [{ ...s.priv.shop.slots[3], price: 0, sold: false }] };
    }));
    await page.waitForSelector('.shopbar__rwcards .scard');
    await page.hover('.shopbar__rwcards .scard');
    await inert('reward cards never buy a hidden shop slot');
    assert.equal(await page.$('.shopbar__rwcards [data-shop-slot]'), null);
    await page.evaluate(() => globalThis.__MOCK__.mutate((s) => { s.priv.shop.rewardOffer = null; s.priv.shop.slots[4] = null; }));
    await page.waitForSelector('.scard--empty');
    await page.hover('.scard--empty');
    await inert('empty slots cannot buy');

    await page.hover(card(3));
    await page.keyboard.press('KeyW');
    await sold(3);
    assert.deepEqual(await calls(), [0, itemIndex, 1, 3], 'buying recovers after all blocked states');
    assert.deepEqual(problems, []);
  });

  test('a legacy W binding survives; buy can be rebound and persists across reload', async (t) => {
    const context = await browser.createBrowserContext();
    t.after(() => context.close());
    const page = await context.newPage();
    await page.evaluateOnNewDocument(() => {
      if (!localStorage.getItem('sp.pref.settings')) localStorage.setItem('sp.pref.settings', JSON.stringify({ keys: { retreat: 'KeyW' } }));
    });
    const problems = await open(page);
    await page.click('.gm__gear');
    await page.waitForSelector('.modal .set-keys');
    assert.equal(await keyOf(page, 'retreat'), 'W');
    assert.equal(await keyOf(page, 'buy'), 'Q', 'migration uses the free default, keeping W for retreat');
    await page.click('.set-key[data-action="buy"]');
    await page.waitForSelector('.set-key.is-waiting[data-action="buy"]');
    await page.keyboard.press('KeyB');
    await keyIs(page, 'buy', 'B');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.modal', { hidden: true });
    const card = '.shopbar .scard[data-shop-slot="0"]';
    await page.hover(card);
    assert.equal(await page.$eval(card, (el) => el.getAttribute('aria-keyshortcuts')), 'B');
    await page.keyboard.press('KeyW');
    await page.keyboard.press('KeyQ');
    await sleep(180);
    assert.equal((await mockState(page)).shop.slots[0].sold, false, 'neither the legacy W nor the old buy key purchases');
    await page.keyboard.press('KeyB');
    await page.waitForFunction(() => globalThis.__MOCK__.S().priv.shop.slots[0].sold);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.ff-piece');
    await page.click('.gm__gear');
    await page.waitForSelector('.modal .set-keys');
    assert.equal(await keyOf(page, 'buy'), 'B');
    assert.equal(await keyOf(page, 'retreat'), 'W');
    assert.deepEqual(problems, []);
  });
});
