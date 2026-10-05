// Browser E2E for the in-match UI via the mock harness (public/dev/game-mock.html) in headless Chrome
// (puppeteer-core + system Chrome). Opt-in: runs only with SP_E2E=1 (it needs Chrome and takes ~1 min).
//
//   SP_E2E=1 node --test test/ui/mock.e2e.test.js
//   SP_E2E=1 SP_RENDER=fallback node --test test/ui/mock.e2e.test.js   # screenshots with the DOM fallback view
//
// 1. Screenshots of every phase / variant at 1920×1080 and 1280×720 → test/e2e/out/ui-<name>-<w>.png,
//    asserting zero console errors / page errors / failed requests.
// 2. Interactions against the harness's mock server: two-tap buy, keyboard shortcuts (R/F/D/Space/Esc), drag a hand
//    unit onto the board + choose a direction on the wheel, tap a unit → underframe 出售 (no drag-to-sell), drag an
//    item onto a unit (equip), 机变 pick, band pick, briefing ready, emote, exit → 暂离 → 返回.
// 3. Regressions: tooltip after a click, toasts / reconnect banner placement, refused watch targets, battle unit
//    panel closing at the next prep, no Hidden Core medal before R15, equipment dropped on an operator's upper body
//    (engine), illegal drops toasting their reason, the folded shop's prep camera (public issue #5).

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'test/e2e/out');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);
const RENDER = process.env.SP_RENDER === 'fallback' ? 'fallback' : 'engine';

const SHOTS = [
  ['briefing', 'phase=INFO_CHECK'], ['draft', 'phase=BAND_DRAFT'], ['draft-solo', 'phase=BAND_DRAFT&variant=solo'],
  ['boot', 'phase=BATTLE_CHECK'], ['prep', 'phase=PREP'], ['prep-reward-temp', 'phase=PREP&variant=reward,temp'],
  ['prep-frozen', 'phase=PREP&variant=frozen'], ['prep-dead', 'phase=PREP&variant=dead'], ['prep-collapsed', 'phase=PREP&variant=collapsed'],
  ['prep-detail', 'phase=PREP&variant=detailpiece'], ['prep-shopdetail', 'phase=PREP&variant=detail'], ['prep-bond', 'phase=PREP&variant=bond'],
  ['prep-enemies', 'phase=PREP&variant=drawer'], ['prep-pen', 'phase=PREP&variant=pen'], ['prep-info', 'phase=PREP&variant=info'], ['prep-emote-ticker', 'phase=PREP&variant=emote,ticker'],
  ['prep-settings', 'phase=PREP&variant=settings'], ['sp-bounty', 'phase=SP_DRAFT&variant=bounty'], ['sp-supply', 'phase=SP_DRAFT&variant=supply'],
  ['sp-tactic', 'phase=SP_DRAFT&variant=tactic'], ['sp-solo', 'phase=SP_DRAFT&variant=solo'], ['combat', 'phase=COMBAT'],
  ['combat-done', 'phase=COMBAT&variant=done'], ['unite', 'phase=UNITE'], ['settle', 'phase=SETTLE'], ['final-assault', 'phase=FINAL_ASSAULT'],
  ['hidden-core', 'phase=HIDDEN_CORE'], ['result-win', 'phase=RESULT'], ['result-lose', 'phase=RESULT&variant=defeat'],
];

describe('in-match UI (mock harness, headless Chrome)', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome) to run' }, () => {
  let srv;
  let browser;
  let base;

  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    base = `http://127.0.0.1:${srv.port}`;
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
    mkdirSync(OUT, { recursive: true });
  });

  after(async () => {
    await browser?.close();
    await srv?.close();
  });

  async function open(query, { w = 1920, h = 1080, render = RENDER } = {}) {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h });
    const problems = [];
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('requestfailed', (r) => problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
    page.on('response', (r) => { if (r.status() >= 400) problems.push(`http ${r.status()}: ${r.url()}`); });
    await page.goto(`${base}/dev/game-mock.html?shot=1&render=${render}&${query}`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => !!document.querySelector('.screen:not(.gload)'), { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 900));
    return { page, problems };
  }
  const mockState = (page) => page.evaluate(() => JSON.parse(JSON.stringify(globalThis.__MOCK__.S().priv)));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  /** Swipe the open direction wheel from its centre towards `dir` and release (research 09 §1.2). */
  const swipeWheel = async (page, dir = 'RIGHT') => {
    await page.waitForSelector('.fwheel__dia', { timeout: 4000 });
    const w = await page.$eval('.fwheel__dia', (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, h: r.width / 2 }; });
    const v = { UP: [0, -1], RIGHT: [1, 0], DOWN: [0, 1], LEFT: [-1, 0] }[dir];
    await page.mouse.move(w.x, w.y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) { await page.mouse.move(w.x + (v[0] * w.h * 0.7 * i) / 8 + 1, w.y + (v[1] * w.h * 0.7 * i) / 8 + 1); await sleep(16); }
    await page.mouse.up();
    await sleep(400);
  };

  for (const [w, h] of [[1920, 1080], [1280, 720]]) {
    test(`screenshots of every phase at ${w}×${h} with zero console errors`, async () => {
      for (const [name, query] of SHOTS) {
        const { page, problems } = await open(query, { w, h });
        await sleep(RENDER === 'engine' ? 1500 : 700);
        await page.screenshot({ path: path.join(OUT, `ui-${name}-${w}.png`) });
        assert.deepEqual(problems, [], `${name} @${w}`);
        await page.close();
      }
    });
  }

  test('prep: buy, shortcuts, ready, Esc', async () => {
    const { page, problems } = await open('phase=PREP');
    let s = await mockState(page);
    const funds0 = s.funds;
    const empty0 = s.hand.filter((x) => !x).length;
    await page.click('.shopbar__cards .scard:not(.scard--sold)');
    await sleep(300);
    assert.equal((await mockState(page)).funds, funds0, 'the first tap only selects (确认购买)');
    assert.ok(await page.$('.scard.is-armed .scard__confirm'));
    await page.click('.scard.is-armed');
    await sleep(300);
    s = await mockState(page);
    assert.ok(s.funds < funds0, 'bought');
    assert.equal(s.hand.filter((x) => !x).length, empty0 - 1);
    const f1 = s.funds;
    await page.keyboard.press('KeyR');
    await sleep(300);
    s = await mockState(page);
    assert.equal(s.funds, f1 - 1, 'R refreshes');
    await page.keyboard.press('KeyF');
    await sleep(300);
    assert.equal((await mockState(page)).shop.frozen, true, 'F freezes');
    await page.evaluate(() => globalThis.__MOCK__.mutate((S) => { S.priv.funds = 40; }));
    await sleep(100);
    const lv = (await mockState(page)).shop.level;
    await page.keyboard.press('KeyD');
    await sleep(300);
    assert.equal((await mockState(page)).shop.level, lv + 1, 'D levels up');
    await page.keyboard.press('Space');
    await sleep(300);
    // funds are left, so 准备 asks first (剩余资金). Confirm, then the seat is ready.
    if (await page.$('.modal__title')) {
      const title = await page.$eval('.modal__title', (el) => el.textContent || '');
      if (title.includes('剩余资金')) await page.click('.modal__actions .btn--primary');
      await sleep(300);
    }
    assert.equal((await mockState(page)).ready, true, 'Space readies');
    assert.ok(await page.$('.readybtn.is-on'));
    await page.keyboard.press('KeyR');
    await sleep(200);
    assert.equal((await mockState(page)).shop.frozen, true, 'no actions while ready');
    await page.keyboard.press('Space');
    await sleep(300);
    assert.equal((await mockState(page)).ready, false);
    // detail + Esc: the first tap on a card opens its detail (there is no ⓘ corner — user playtest #6 item 10)
    await page.click('.shopbar__cards .scard:not(.scard--sold)');
    await page.waitForSelector('.dpanel');
    await page.keyboard.press('Escape');
    await sleep(200);
    assert.equal(await page.$('.dpanel'), null, 'Esc closes the detail panel');
    assert.deepEqual(problems, []);
    await page.close();
  });

  test('prep: Q retreats and X sells only the selected operator', async () => {
    const { page, problems } = await open('phase=PREP', { render: 'fallback' });
    const initial = await mockState(page);
    await page.keyboard.press('KeyQ');
    await page.keyboard.press('KeyX');
    assert.deepEqual(await mockState(page), initial, 'no selection means no action');
    const unit = initial.board.find((piece) => piece.kind === 'chess' && !piece.golden);
    await page.click(`.ff-piece[data-uid="${unit.uid}"]`);
    await page.waitForSelector('.uframe__btn--retreat');
    await page.evaluate(() => {
      const input = document.createElement('input');
      input.id = 'shortcut-test-input';
      document.body.append(input);
      input.focus();
    });
    await page.keyboard.press('KeyQ');
    await page.keyboard.press('KeyX');
    assert.deepEqual(await mockState(page), initial, 'typing must not retreat or sell');
    await page.evaluate(() => document.getElementById('shortcut-test-input').remove());
    await page.keyboard.press('KeyQ');
    await page.waitForFunction((uid) => globalThis.__MOCK__.S().priv.hand.some((piece) => piece?.uid === uid), {}, unit.uid);
    const retreated = await mockState(page);
    assert.ok(!retreated.board.some((piece) => piece.uid === unit.uid));
    assert.equal(retreated.funds, initial.funds, 'retreat does not sell');
    await page.click(`.ff-piece[data-uid="${unit.uid}"]`);
    await page.waitForSelector('.uframe__btn--sell');
    assert.equal(await page.$('.uframe__btn--retreat'), null, 'bench operator cannot retreat');
    await page.keyboard.press('KeyQ');
    assert.deepEqual(await mockState(page), retreated, 'Q on the bench does nothing');
    await page.keyboard.press('KeyX');
    await page.waitForFunction((uid) => !globalThis.__MOCK__.S().priv.hand.some((piece) => piece?.uid === uid), {}, unit.uid);
    assert.ok((await mockState(page)).funds > retreated.funds, 'X sells the selected operator');
    const item = (await mockState(page)).hand.find((piece) => piece?.kind === 'item');
    await page.click(`.ff-piece[data-uid="${item.uid}"]`);
    await page.waitForSelector('.uframe__btn--destroy');
    await page.keyboard.press('KeyX');
    assert.ok((await mockState(page)).hand.some((piece) => piece?.uid === item.uid), 'X must not destroy an item');
    assert.equal(await page.$('.modal'), null, 'no destroy confirmation');
    assert.deepEqual(problems, []);
    await page.close();
  });

  test('prep: drag & drop — tap-sell (no sell zone), hand → board + wheel, item → unit (equip)', async () => {
    // DOM drag targets only exist in the fallback view (the Pixi engine's own drag is tested by the render module)
    const { page, problems } = await open('phase=PREP', { render: 'fallback' });
    const center = async (sel) => page.$eval(sel, (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    const drag = async (from, to) => {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      for (let i = 1; i <= 8; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8);
      await sleep(80);
      await page.mouse.up();
      await sleep(400);
    };
    let s = await mockState(page);
    // sell one board unit first so the deploy cap has room: dropping it on the shop bar does nothing (no drag-to-sell),
    // tapping it opens its underframe → 出售
    const boardUnit = s.board.find((p) => p.kind === 'chess' && !p.golden);
    const cap0 = s.board.length;
    const funds0 = s.funds;
    await drag(await center(`.ff-piece[data-uid="${boardUnit.uid}"]`), await center('.shopbar__cards'));
    assert.equal((await mockState(page)).board.length, cap0, 'the shop bar is not a sell zone');
    await page.click(`.ff-piece[data-uid="${boardUnit.uid}"]`);
    await page.waitForSelector('.uframe__btn--sell', { timeout: 3000 });
    assert.ok(await page.$('.uframe__btn--retreat'), '撤退 too');
    await page.click('.uframe__btn--sell');
    await sleep(400);
    s = await mockState(page);
    assert.equal(s.board.length, cap0 - 1, '出售 ⇒ sold');
    assert.equal(s.funds, funds0 + 1);
    // hand chess → an empty melee tile, then the direction wheel
    const handChess = s.hand.find((p) => p && p.kind === 'chess');
    const handLen = s.hand.filter(Boolean).length;
    const occupied = new Set(s.board.map((p) => `${p.row},${p.col}`));
    const freeTile = [[9, 9], [9, 8], [12, 6], [11, 7], [10, 7], [9, 7]].find(([r, c]) => !occupied.has(`${r},${c}`));
    await drag(await center(`.ff-piece[data-uid="${handChess.uid}"]`), await center(`.ff-tile[data-row="${freeTile[0]}"][data-col="${freeTile[1]}"]`));
    await swipeWheel(page, 'UP');
    s = await mockState(page);
    assert.ok(s.board.some((p) => p.uid === handChess.uid && p.row === freeTile[0] && p.col === freeTile[1]), 'moved to the board');
    assert.equal(s.hand.filter(Boolean).length, handLen - 1);
    // item → a unit without items
    const itemPiece = s.hand.find((p) => p && p.kind === 'item');
    const target = s.board.find((p) => p.kind === 'chess' && (!p.items || p.items.length === 0));
    await drag(await center(`.ff-piece[data-uid="${itemPiece.uid}"]`), await center(`.ff-piece[data-uid="${target.uid}"]`));
    s = await mockState(page);
    assert.ok(s.board.find((p) => p.uid === target.uid).items.some((i) => i.uid === itemPiece.uid), 'equipped');
    // illegal: melee piece onto high ground does nothing
    assert.deepEqual(problems, []);
    await page.close();
  });

  test('engine drag & drop: tap-sell, hand unit → board unit (swap) + wheel', async (t) => {
    if (RENDER !== 'engine') { t.skip('SP_RENDER=fallback'); return; }
    const { page, problems } = await open('phase=PREP');
    await sleep(1500); // spine models
    const rect = (uid) => page.evaluate((u) => { const r = globalThis.__SP_VIEW__?.pieceScreenRect(u); return r && { x: r.left + r.width / 2, y: r.top + r.height * 0.65 }; }, uid);
    const drag = async (from, to) => {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      for (let i = 1; i <= 12; i++) { await page.mouse.move(from.x + ((to.x - from.x) * i) / 12, from.y + ((to.y - from.y) * i) / 12); await sleep(16); }
      await sleep(100);
      await page.mouse.up();
      await sleep(600);
    };
    let s = await mockState(page);
    const unit = s.board.find((x) => x.kind === 'chess' && !x.golden && !(x.items || []).length);
    const bar = await page.$eval('.shopbar__cards', (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await drag(await rect(unit.uid), bar);
    assert.equal((await mockState(page)).board.length, s.board.length, 'no drag-to-sell');
    const pt = await rect(unit.uid);
    await page.mouse.click(pt.x, pt.y);
    await page.waitForSelector('.uframe__btn--sell', { timeout: 3000 });
    await page.click('.uframe__btn--sell');
    await sleep(400);
    const s2 = await mockState(page);
    assert.equal(s2.board.length, s.board.length - 1, 'sold with the underframe 出售');
    assert.equal(s2.funds, s.funds + 1);
    const hc = s2.hand.find((x) => x && x.kind === 'chess' && !x.golden);
    const target = s2.board.find((x) => x.kind === 'chess' && x.row === 9);
    await drag(await rect(hc.uid), await rect(target.uid));
    await swipeWheel(page, 'LEFT');
    s = await mockState(page);
    assert.ok(s.board.some((x) => x.uid === hc.uid), 'hand unit deployed');
    assert.ok(s.hand.some((x) => x && x.uid === target.uid), 'board unit swapped into the hand');
    assert.equal(s.board.find((x) => x.uid === hc.uid).dir, 'LEFT', 'the mock server stores the wheel direction');
    assert.equal(s.hand.find((x) => x && x.uid === target.uid).dir, undefined, 'bench pieces carry no direction');
    // re-orient in place: drop the unit on its own tile → wheel → UP (no duplicate piece)
    const here = await rect(hc.uid);
    await page.mouse.move(here.x, here.y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) { await page.mouse.move(here.x + i * 12, here.y - i * 6); await sleep(16); } // off the tile…
    for (let i = 7; i >= 0; i--) { await page.mouse.move(here.x + i * 12, here.y - i * 6); await sleep(16); } // …and back onto it
    await sleep(100);
    await page.mouse.up();
    await sleep(600);
    await swipeWheel(page, 'UP');
    const s3 = await mockState(page);
    assert.equal(s3.board.length, s.board.length, 'still one piece');
    assert.equal(s3.board.find((x) => x.uid === hc.uid).dir, 'UP', 're-oriented in place');
    assert.equal(await page.evaluate((u) => globalThis.__SP_VIEW__?.raw?.debug?.views?.get('p:' + u)?.dir ?? null, hc.uid), 'UP', 'the model shows it');
    assert.deepEqual(problems, []);
    await page.close();
  });

  test('机变 pick (two taps, user playtest #4 item 2), band pick, briefing ready', async () => {
    let { page, problems } = await open('phase=SP_DRAFT&variant=bounty');
    await page.click('.spcard.is-pickable');
    await sleep(200);
    // the first tap only selects: the card lifts with its 确认选择 strip, the header offers 确认选择, nothing was sent
    assert.ok(await page.$('.spcard.is-armed .spcard__confirm'), 'selected (armed)');
    assert.ok(await page.$('.spov__confirm'), 'the header confirm');
    assert.ok(!(await page.$('.spcard.is-mine')), 'not picked yet');
    assert.ok(!(await page.evaluate(() => globalThis.__MOCK__.S().requests.some(([t]) => t === 'g.choice'))), 'no g.choice after one tap');
    // another card moves the selection; Esc drops it
    const pickable = await page.$$('.spcard.is-pickable');
    await pickable[1].click();
    await sleep(150);
    assert.equal(await page.$$eval('.spcard.is-armed', (els) => els.length), 1, 'one selection');
    await page.keyboard.press('Escape');
    await sleep(150);
    assert.ok(!(await page.$('.spcard.is-armed')), 'Esc drops the selection');
    // select, then tap the same card again: picked
    await page.click('.spcard.is-pickable');
    await sleep(150);
    await page.click('.spcard.is-armed');
    await sleep(300);
    assert.ok(await page.$('.spcard.is-mine'), 'picked card marked');
    // the header's 确认选择 confirms as well
    await page.close();
    ({ page, problems } = await open('phase=SP_DRAFT&variant=supply'));
    await page.click('.spcard.is-pickable');
    await sleep(150);
    await page.click('.spov__confirm');
    await sleep(300);
    assert.ok(await page.$('.spcard.is-mine'), 'confirmed from the header');
    assert.deepEqual(problems, []);
    await page.close();

    ({ page, problems } = await open('phase=BAND_DRAFT'));
    const bands = await page.$$('.dband');
    await bands[5].click();
    await page.click('.draft-detail__btns .btn--primary');
    await sleep(300);
    assert.ok(await page.$('.dband.is-mine'), 'band picked');
    assert.deepEqual(problems, []);
    await page.close();

    ({ page, problems } = await open('phase=INFO_CHECK'));
    await page.click('.brief__foot .btn--primary');
    await sleep(300);
    const txt = await page.$eval('.brief-ready__txt', (el) => el.textContent);
    assert.match(txt, /3/);
    assert.deepEqual(problems, []);
    await page.close();
  });

  // ---- round-1 UI fixes ----------------------------------------------------------------------------------------
  const rectOf = (page, sel) => page.$eval(sel, (el) => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; });
  const overlaps = (a, b) => !!a && !!b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

  test('tooltip: after clicking 本局信息 it does not come back with stale text over the dialog', async () => {
    const { page, problems } = await open('phase=PREP');
    const btn = await rectOf(page, '.gtop__iconbtn');
    await page.mouse.move((btn.left + btn.right) / 2, (btn.top + btn.bottom) / 2);
    await sleep(600);
    await page.mouse.down();
    await page.mouse.up();
    await sleep(800);
    await page.waitForSelector('.edrawer');
    const tip = await page.$eval('.tooltip', (el) => ({ shown: el.classList.contains('is-shown'), text: el.textContent })).catch(() => null);
    assert.ok(!tip || !tip.shown, `no tooltip after the click (got ${JSON.stringify(tip)})`);
    // leaving and coming back shows the current text
    await page.mouse.move(5, 500);
    await sleep(200);
    await page.mouse.move((btn.left + btn.right) / 2, (btn.top + btn.bottom) / 2);
    await sleep(600);
    assert.match(await page.$eval('.tooltip.is-shown', (el) => el.textContent), /本局信息/);
    assert.deepEqual(problems, []);
    await page.close();
  });

  // ---- enemy preview pen (research 09 §2 / §6.2 item 3) ------------------------------------------------------------
  const camera = (page) => page.$eval('.gm', (el) => el.dataset.camera);
  const sprite = (page, sel) => page.$eval(sel, (el) => ({ sprite: el.dataset.sprite, label: el.getAttribute('aria-label'), disabled: el.getAttribute('aria-disabled') }));

  for (const render of ['engine', 'fallback']) {
    test(`pen (${render}): 🔍▶▶ pans to the pen, 🔍◀◀ / grey 🔍 / Esc return; the shop folds away and comes back`, async (t) => {
      if (render === 'engine' && RENDER !== 'engine') { t.skip('SP_RENDER=fallback'); return; }
      const { page, problems } = await open('phase=PREP', { render });
      await page.waitForFunction(() => !!globalThis.__SP_VIEW__, { timeout: 15000 });
      assert.equal(await camera(page), 'prep');
      assert.deepEqual(await sprite(page, '.enemybtn'), { sprite: 'btn_check_enemy', label: '敌方情报', disabled: 'false' });
      assert.equal((await sprite(page, '.gtop__iconbtn')).sprite, 'btn_check_player_normal');
      assert.ok(await page.$('.shopbar:not(.is-collapsed), .shopbar'), 'shop bar shown');
      const cards0 = await page.$$eval('.shopbar__cards .scard', (els) => els.length);
      await page.click('.enemybtn');
      await page.waitForFunction(() => document.querySelector('.gm')?.dataset.camera === 'pen', { timeout: 3000 });
      assert.ok(await page.$('.gm.is-pen'));
      assert.equal((await sprite(page, '.gtop__iconbtn')).sprite, 'btn_check_player_back', 'left button: 🔍◀◀');
      assert.equal((await sprite(page, '.enemybtn')).sprite, 'btn_check_enemy_unfold', 'right button greys out');
      assert.equal(await page.$$eval('.shopbar__cards .scard', (els) => els.length), 0, 'the shop bar folded away');
      assert.equal(await page.$('.edrawer'), null, 'no DOM list: the pen is the preview');
      await sleep(400);
      await page.screenshot({ path: path.join(OUT, `ui-pen-${render}.png`) });
      // the left 🔍◀◀ returns
      await page.click('.gtop__iconbtn');
      await page.waitForFunction(() => document.querySelector('.gm')?.dataset.camera === 'prep', { timeout: 3000 });
      assert.equal(await page.$$eval('.shopbar__cards .scard', (els) => els.length), cards0, 'the shop bar is back');
      assert.equal(await page.$('.edrawer'), null, 'returning does not open the info dialog');
      // the grey right button returns too; Esc returns
      await page.click('.enemybtn');
      await page.waitForFunction(() => document.querySelector('.gm')?.dataset.camera === 'pen');
      await page.click('.enemybtn');
      await page.waitForFunction(() => document.querySelector('.gm')?.dataset.camera === 'prep');
      await page.click('.enemybtn');
      await page.waitForFunction(() => document.querySelector('.gm')?.dataset.camera === 'pen');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.querySelector('.gm')?.dataset.camera === 'prep');
      assert.deepEqual(problems, []);
      await page.close();
    });
  }

  test('pen (fallback view): the enemies of m.private.nextEnemies stand in their gate zones; a tap opens the detail card', async () => {
    const { page, problems } = await open('phase=PREP', { render: 'fallback' });
    await page.click('.enemybtn');
    await page.waitForSelector('.ff-pen__enemy', { timeout: 3000 });
    const s = await mockState(page);
    const total = s.nextEnemies.reduce((n, e) => n + e.count, 0);
    const shown = await page.$$eval('.ff-pen__enemy', (els) => els.map((el) => el.dataset.enemy));
    assert.equal(shown.length, Math.min(50, total), 'one figure per enemy (≤ 50)');
    assert.deepEqual([...new Set(shown)].sort(), [...new Set(s.nextEnemies.map((e) => e.enemyKey))].sort());
    await page.click('.ff-pen__enemy');
    await page.waitForSelector('.dpanel', { timeout: 3000 });
    assert.equal(await camera(page), 'pen', 'the detail card opens over the pen');
    await page.keyboard.press('Escape');
    await sleep(200);
    assert.equal(await page.$('.dpanel'), null, 'Esc closes the card first');
    assert.equal(await camera(page), 'pen');
    await page.keyboard.press('Escape');
    await sleep(200);
    assert.equal(await camera(page), 'prep', 'then leaves the pen');
    assert.deepEqual(problems, []);
    await page.close();
  });

  test('pen: only in 休整期 — in combat the right 🔍 is grey and inert; the left 🔍 opens 本局信息 with the enemy list as its 2nd tab', async () => {
    const { page, problems } = await open('phase=COMBAT');
    const b = await sprite(page, '.enemybtn');
    assert.equal(b.sprite, 'btn_check_enemy_unfold');
    assert.equal(b.disabled, 'true');
    const cam0 = await camera(page);
    await page.click('.enemybtn');
    await sleep(400);
    assert.equal(await camera(page), cam0, 'no pen outside prep');
    await page.close();
    const p2 = await open('phase=PREP');
    await p2.page.click('.gtop__iconbtn');
    await p2.page.waitForSelector('.edrawer');
    const tabs = await p2.page.$$eval('.edrawer .tabs__tab', (els) => els.map((el) => el.textContent.trim()));
    assert.deepEqual(tabs, ['本局信息', '敌方情报']);
    assert.equal(await p2.page.$eval('.edrawer .tabs__tab.is-active', (el) => el.textContent.trim()), '本局信息', 'info first');
    await p2.page.click('.edrawer .tabs__tab:nth-child(2)');
    await p2.page.waitForSelector('.edrawer .erow');
    await p2.page.click('.gtop__iconbtn');
    await sleep(200);
    assert.equal(await p2.page.$('.edrawer'), null, 'the left 🔍 closes the dialog again');
    assert.deepEqual([...problems, ...p2.problems], []);
    await p2.page.close();
  });

  // ---- review regressions (ui-compat): FA prep on the own half, teammate pen, pen state machine ------------------------
  for (const side of ['L', 'R']) {
    test(`Final Assault prep (${side}): the own half of the boss field; a screen swipe → the board direction${side === 'R' ? ' (mirrored)' : ''}`, async (t) => {
      if (RENDER !== 'engine') { t.skip('SP_RENDER=fallback'); return; }
      const { page, problems } = await open(`phase=PREP&variant=${side === 'R' ? 'bossR' : 'boss'}`, { w: 1600, h: 900 });
      await page.waitForFunction(() => !!globalThis.__SP_VIEW__?.raw?.prepField, { timeout: 15000 });
      await sleep(900);
      assert.equal(await camera(page), 'bossPrep');
      assert.deepEqual(await page.evaluate(() => globalThis.__SP_VIEW__.raw.prepField()), { kind: 'bossPrep', side, mirror: side === 'R' });
      const plan = await page.evaluate(async () => {
        const v = globalThis.__SP_VIEW__.raw;
        const S = globalThis.__MOCK__.S();
        const piece = S.priv.hand.find((x) => x && x.kind === 'chess');
        const stage = (await import('/js/data.js')).data.lookup('stages', S.pub.stageId);
        const taken = new Set(S.priv.board.map((b) => `${b.row},${b.col}`));
        const [row, col] = (stage.deployTiles.normal.melee || []).find(([r, c]) => !taken.has(`${r},${c}`));
        const r = v.pieceScreenRect(piece.uid);
        const tt = v.tileScreen(row, col);
        return { uid: piece.uid, row, col, from: { x: r.left + r.width / 2, y: r.top + r.height * 0.6 }, to: { x: tt.x, y: tt.y } };
      });
      const m = page.mouse;
      await m.move(plan.from.x, plan.from.y); await m.down();
      for (let i = 1; i <= 14; i++) { await m.move(plan.from.x + ((plan.to.x - plan.from.x) * i) / 14, plan.from.y + ((plan.to.y - plan.from.y) * i) / 14); await sleep(16); }
      await sleep(120); await m.up();
      await swipeWheel(page, 'RIGHT');
      await page.waitForFunction((uid) => globalThis.__MOCK__.S().priv.board.some((b) => b.uid === uid), { timeout: 4000 }, plan.uid);
      const sent = await page.evaluate(() => globalThis.__MOCK__.S().requests.filter((r) => r[0] === 'g.move').pop()[1]);
      assert.deepEqual(sent.to, { area: 'board', row: plan.row, col: plan.col, dir: side === 'R' ? 'LEFT' : 'RIGHT' }, 'board coordinates and the board direction');
      const shown = await page.evaluate((uid) => { const v = globalThis.__SP_VIEW__.raw.debug.views.get('p:' + uid); return { x: v.x, y: v.y, dir: v.dir }; }, plan.uid);
      assert.deepEqual(shown, { x: side === 'R' ? 20 - plan.col : plan.col, y: plan.row - 7, dir: 'RIGHT' }, 'drawn where it was dropped, facing the swipe');
      // the pen is a detour of this camera: the way back is the boss-field half again
      await page.click('.enemybtn');
      await page.waitForFunction(() => document.querySelector('.gm')?.dataset.camera === 'pen');
      await page.click('.gtop__iconbtn');
      await page.waitForFunction(() => document.querySelector('.gm')?.dataset.camera === 'bossPrep');
      assert.equal(await page.evaluate(() => globalThis.__SP_VIEW__.raw.prepField().side), side);
      await page.screenshot({ path: path.join(OUT, `ui-fa-prep-${side}.png`) });
      assert.deepEqual(problems, []);
      await page.close();
    });
  }

  for (const render of ['engine', 'fallback']) {
    test(`pen (${render}): scouting a teammate in prep shows THEIR pen; the way back is their board, then home shows mine`, async (t) => {
      if (render === 'engine' && RENDER !== 'engine') { t.skip('SP_RENDER=fallback'); return; }
      const { page, problems } = await open('phase=PREP', { render });
      await page.waitForFunction(() => !!globalThis.__SP_VIEW__, { timeout: 15000 });
      const penKeys = () => page.evaluate(() => {
        const v = globalThis.__SP_VIEW__;
        if (v.kind === 'engine') return [...v.raw.debug.penViews.values()].map((x) => [x.info.enemyKey, Math.round(x.info.y)]);
        return [...document.querySelectorAll('.ff-pen__enemy')].map((el) => [el.dataset.enemy, null]);
      });
      const rows = await page.$$('.team__btn');
      await rows[2].click();
      await sleep(250);
      if (await page.$('.team__ob')) await page.click('.team__ob');
      await page.waitForSelector('.gm__watching', { timeout: 4000 });
      await page.click('.enemybtn');
      await page.waitForFunction(() => document.querySelector('.gm')?.dataset.camera === 'pen', { timeout: 3000 });
      await sleep(300);
      const theirs = await page.evaluate(() => globalThis.__MOCK__.store.get().match.field.nextEnemies);
      const shown = await penKeys();
      assert.equal(shown.length, theirs.reduce((n, e) => n + e.count, 0), 'one figure per enemy of THEIR round');
      assert.deepEqual([...new Set(shown.map((x) => x[0]))].sort(), [...new Set(theirs.map((e) => e.enemyKey))].sort());
      if (render === 'engine') assert.ok(shown.every((x) => x[1] >= 17), 'their upper-gate enemies stand in rows 17–18');
      await page.click('.gtop__iconbtn');
      await page.waitForFunction(() => document.querySelector('.gm')?.dataset.camera === 'normal', { timeout: 3000 });
      assert.ok(await page.$('.gm__watching'), 'still scouting the teammate');
      await page.click('.gm__watching button');
      await page.waitForFunction(() => document.querySelector('.gm')?.dataset.camera === 'prep', { timeout: 3000 });
      await page.click('.enemybtn');
      await page.waitForFunction(() => document.querySelector('.gm')?.dataset.camera === 'pen', { timeout: 3000 });
      await sleep(300);
      const mine = await page.evaluate(() => globalThis.__MOCK__.S().priv.nextEnemies);
      assert.equal((await penKeys()).length, Math.min(50, mine.reduce((n, e) => n + e.count, 0)), 'home: my own pen again');
      assert.deepEqual(problems, []);
      await page.close();
    });
  }

  test('pen: leaving prep while the pen is shown returns the camera and unfolds the shop; a folded shop stays folded', async (t) => {
    if (RENDER !== 'engine') { t.skip('SP_RENDER=fallback'); return; }
    const { page, problems } = await open('phase=PREP');
    await page.waitForFunction(() => !!globalThis.__SP_VIEW__, { timeout: 15000 });
    await page.click('.enemybtn');
    await page.waitForFunction(() => document.querySelector('.gm')?.dataset.camera === 'pen');
    await page.evaluate(() => globalThis.__MOCK__.setPhase('COMBAT'));
    await page.waitForFunction(() => document.querySelector('.gm')?.dataset.camera === 'normal', { timeout: 4000 });
    assert.equal(await page.$('.gm.is-pen'), null);
    assert.equal(await page.evaluate(() => globalThis.__SP_VIEW__.raw.debug.camKind), 'normal', 'the view left the pen too');
    assert.equal(await page.evaluate(() => globalThis.__SP_VIEW__.raw.stats().pen), 0, 'a real battle empties the pen');
    await page.evaluate(() => globalThis.__MOCK__.setPhase('PREP'));
    await page.waitForFunction(() => document.querySelector('.gm')?.dataset.camera === 'prep', { timeout: 4000 });
    assert.equal(await page.$('.gm.is-collapsed'), null, 'the shop is back');
    await page.click('.funds__collapse');
    await page.click('.enemybtn');
    await page.waitForFunction(() => document.querySelector('.gm')?.dataset.camera === 'pen');
    for (let i = 0; i < 9; i++) await page.click(i % 2 ? '.enemybtn' : '.gtop__iconbtn'); // fast back-and-forth
    await page.waitForFunction(() => document.querySelector('.gm')?.dataset.camera === 'prep', { timeout: 3000 });
    await sleep(400);
    assert.equal(await page.evaluate(() => globalThis.__SP_VIEW__.raw.debug.camKind), 'prep', 'view and HUD agree');
    assert.ok(await page.$('.gm.is-collapsed'), 'the shop folded before the pen stays folded');
    assert.deepEqual(problems, []);
    await page.close();
  });

  for (const [w, h] of [[1920, 1080], [844, 390]]) {
    test(`fold (public issue #5): the own prep board grows with the shop folded, every bench pad stays free, unfolding returns (${w}×${h})`, async (t) => {
      if (RENDER !== 'engine') { t.skip('SP_RENDER=fallback'); return; }
      const { page, problems } = await open('phase=PREP', { w, h });
      await page.waitForFunction(() => !!globalThis.__SP_VIEW__?.raw?.debug?.cam, { timeout: 15000 });
      await sleep(900);
      const look = () => page.evaluate(() => {
        const V = globalThis.__SP_VIEW__; const raw = V.raw; const cam = raw.debug.cam;
        const tile = cam.project(5.5, 9.5).x - cam.project(4.5, 9.5).x;
        let worst = 1;
        for (let c = 0; c <= 9; c++) {
          const q = V.tileScreen(7, c);
          if (!q) continue;
          const cx = q.poly.reduce((s, p) => s + p[0], 0) / 4, cy = q.poly.reduce((s, p) => s + p[1], 0) / 4;
          const pts = [[cx, cy], ...q.poly.map(([x, y]) => [x + (cx - x) * 0.12, y + (cy - y) * 0.12])];
          const free = pts.filter(([x, y]) => document.elementFromPoint(x, y) === raw.debug.app.view).length / pts.length;
          worst = Math.min(worst, free);
        }
        return { tile, worst, kind: raw.debug.camKind, params: JSON.stringify(cam.params()) };
      });
      const open1 = await look();
      await page.click('.funds__collapse');
      await page.waitForSelector('.shopbar-tab', { timeout: 3000 });
      await sleep(1200); // the 0.75 s camera flight
      const folded = await look();
      assert.equal(folded.kind, 'prep');
      assert.ok(folded.tile > open1.tile * 1.15, `tile ${open1.tile.toFixed(1)} → ${folded.tile.toFixed(1)} px`);
      assert.equal(folded.worst, 1, 'every bench pad fully pressable under the folded camera');
      await page.screenshot({ path: path.join(OUT, `ui-prep-folded-${w}.png`) });
      await page.click('.shopbar-tab__btn');
      await page.waitForSelector('.shopbar', { timeout: 3000 });
      await sleep(1200);
      const back = await look();
      assert.equal(back.params, open1.params, 'unfolded: exactly the shop camera again');
      assert.equal(back.worst, 1);
      assert.deepEqual(problems, []);
      await page.close();
    });
  }

  for (const [w, h] of [[1920, 1080], [1366, 768]]) {
    test(`toasts clear the top bar capsule; the reconnect banner clears the view switcher (${w}×${h})`, async () => {
      let { page, problems } = await open('phase=PREP', { w, h });
      await page.evaluate(() => import('/js/ui/toasts.js').then((m) => m.toast('整备区已满', 'error')));
      await sleep(500);
      const toastR = await rectOf(page, '.toast');
      const cap = await rectOf(page, '.gtop__center');
      assert.ok(!overlaps(toastR, cap), `toast ${JSON.stringify(toastR)} over the capsule ${JSON.stringify(cap)}`);
      assert.deepEqual(problems, []);
      await page.close();

      ({ page, problems } = await open('phase=COMBAT', { w, h }));
      await page.evaluate(() => globalThis.__MOCK__.store.set({ connection: { status: 'reconnecting', ping: 0, attempt: 2, retryAt: Date.now() + 5000, lastError: null, everOnline: true } }));
      await page.waitForSelector('.conn-banner');
      await sleep(900);
      const banner = await rectOf(page, '.conn-banner');
      const vs = await rectOf(page, '.vswitch');
      assert.ok(!overlaps(banner, vs), `banner ${JSON.stringify(banner)} over the switcher ${JSON.stringify(vs)}`);
      assert.ok(!overlaps(banner, await rectOf(page, '.gtop__center')), 'banner clear of the capsule');
      const hit = await page.evaluate((x, y) => !!document.elementFromPoint(x, y)?.closest('.vswitch'), (vs.left + vs.right) / 2, (vs.top + vs.bottom) / 2);
      assert.ok(hit, 'the switcher stays clickable');
      await page.evaluate(() => import('/js/ui/toasts.js').then((m) => m.toast('连接中断', 'error')));
      await sleep(500);
      assert.ok(!overlaps(await rectOf(page, '.toast'), banner), 'toasts stack below the banner');
      assert.deepEqual(problems, []);
      await page.close();
    });
  }

  test('watch: the other pair of the Final Assault is refused and the eye stays put', async () => {
    const { page, problems } = await open('phase=FINAL_ASSAULT');
    const rows = await page.$$('.team__row');
    await (await rows[2].$('.team__btn')).click(); // P3: the other pair (field b2)
    await sleep(500);
    const watched = await page.$$eval('.team__row.is-watched .team__name', (els) => els.map((e) => e.textContent));
    assert.ok(!watched.includes('Doctor·B') && !watched.includes('灰烬'), `other pair not marked watched (${watched})`);
    assert.match(await page.$eval('.toast', (el) => el.textContent), /另一组/);
    assert.equal(await page.$eval('.vswitch__label', (el) => el.textContent), '全景');
    assert.deepEqual(problems, []);
    await page.close();
  });

  test('a battle unit panel opened in combat closes when the next prep starts', async () => {
    const { page, problems } = await open('phase=COMBAT', { render: 'fallback' });
    await page.waitForSelector('.ff-unit.is-ally');
    await page.$eval('.ff-unit.is-ally', (el) => el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 })));
    await page.waitForSelector('.dpanel');
    await page.evaluate(() => globalThis.__MOCK__.setPhase('SETTLE'));
    await sleep(300);
    assert.ok(await page.$('.dpanel'), 'still open while the battle is being settled');
    await page.evaluate(() => globalThis.__MOCK__.setPhase('PREP'));
    await sleep(400);
    assert.equal(await page.$('.dpanel'), null, 'closed in the next prep');
    assert.deepEqual(problems, []);
    await page.close();
  });

  test('R / F / D / Space do nothing behind the 本局信息 / 敌方情报 drawer; Esc closes it', async () => {
    const { page, problems } = await open('phase=PREP');
    await page.evaluate(() => globalThis.__MOCK__.mutate((S) => { S.priv.funds = 40; }));
    await sleep(100);
    const before = await mockState(page);
    await page.click('.gtop__iconbtn[aria-label="本局信息"]');
    await page.waitForSelector('.edrawer');
    for (const k of ['KeyR', 'KeyF', 'KeyD', 'Space']) { await page.keyboard.press(k); await sleep(150); }
    const s = await mockState(page);
    assert.deepEqual([s.funds, s.shop.frozen, s.shop.level, s.ready], [before.funds, before.shop.frozen, before.shop.level, before.ready], 'nothing acted behind the drawer');
    await page.keyboard.press('Escape');
    await sleep(200);
    assert.equal(await page.$('.edrawer'), null, 'Esc closes the drawer');
    await page.keyboard.press('KeyF');
    await sleep(300);
    assert.equal((await mockState(page)).shop.frozen, !before.shop.frozen, 'the shortcuts work again');
    assert.deepEqual(problems, []);
    await page.close();
  });

  for (const render of ['fallback', 'engine']) {
    test(`a detail card opened by right-click closes when the field is pressed (${render})`, async (t) => {
      if (render === 'engine' && RENDER !== 'engine') { t.skip('SP_RENDER=fallback'); return; }
      const { page, problems } = await open('phase=PREP', { render });
      await page.waitForFunction((k) => globalThis.__SP_VIEW__?.kind === k, { timeout: 15000 }, render);
      if (render === 'engine') await sleep(1500); // spine models
      const s = await mockState(page);
      const unit = s.board.find((p) => p.kind === 'chess');
      const occupied = new Set(s.board.map((p) => `${p.row},${p.col}`));
      const [er, ec] = [[9, 9], [9, 8], [11, 7], [10, 7], [9, 7], [12, 6]].find(([r, c]) => !occupied.has(`${r},${c}`));
      const pts = await page.evaluate((uid, row, col) => {
        const v = globalThis.__SP_VIEW__;
        const r = v.pieceScreenRect(uid);
        const tile = document.querySelector(`.ff-tile[data-row="${row}"][data-col="${col}"]`)?.getBoundingClientRect();
        const ts = tile ? { x: tile.left + tile.width / 2, y: tile.top + tile.height / 2 } : v.raw.tileScreen(row, col);
        return { piece: { x: r.left + r.width / 2, y: r.top + r.height * 0.65 }, tile: { x: ts.x, y: ts.y } };
      }, unit.uid, er, ec);
      await page.mouse.click(pts.piece.x, pts.piece.y, { button: 'right' });
      await page.waitForSelector('.dpanel', { timeout: 3000 });
      await sleep(300);
      assert.equal(await page.$('.uframe'), null, 'right-click only opens the card (no selection)');
      await page.mouse.click(pts.tile.x, pts.tile.y);
      await sleep(400);
      assert.equal(await page.$('.dpanel'), null, `${render}: a press on an empty tile closes the card`);
      assert.deepEqual(problems, []);
      await page.close();
    });
  }

  test('an eliminated player sees one elimination banner during SETTLE', async () => {
    for (const phase of ['SETTLE', 'PREP']) {
      const { page, problems } = await open(`phase=${phase}&variant=dead`, { render: 'fallback' });
      await sleep(300);
      const banners = await page.$$eval('.gm__dead, .chud__msg--dead', (els) => els.map((el) => el.className));
      assert.equal(banners.length, 1, `${phase}: ${JSON.stringify(banners)}`);
      assert.deepEqual(problems, []);
      await page.close();
    }
  });

  test('leaving the match screen clears the __SP_VIEW__ dev hook (no detached screen kept alive)', async () => {
    const { page, problems } = await open('phase=PREP', { render: 'fallback' });
    await page.waitForFunction(() => !!globalThis.__SP_VIEW__, { timeout: 15000 });
    await page.evaluate(() => globalThis.__MOCK__.setPhase('RESULT'));
    await page.waitForFunction(() => !document.querySelector('.gm'), { timeout: 5000 });
    await sleep(200);
    assert.equal(await page.evaluate(() => globalThis.__SP_VIEW__), null);
    assert.deepEqual(problems, []);
    await page.close();
  });

  test('result: no Hidden Core medal when R15 was never reached', async () => {
    const { page, problems } = await open('phase=RESULT&variant=defeat');
    assert.equal(await page.$('.medal--hidden'), null);
    assert.ok(await page.$('.medal'), 'the leader medal is still shown');
    assert.deepEqual(problems, []);
    await page.close();
  });

  test('engine: equipment dropped on an operator\'s tile equips it — the tile under the pointer decides (user playtest #4 item 1)', async (t) => {
    if (RENDER !== 'engine') { t.skip('SP_RENDER=fallback'); return; }
    const { page, problems } = await open('phase=PREP');
    await sleep(1500); // spine models
    const at = (uid, fy) => page.evaluate((u, f) => { const r = globalThis.__SP_VIEW__?.pieceScreenRect(u); return r && { x: r.left + r.width / 2, y: r.top + r.height * f }; }, uid, fy);
    const tileAt = (row, col) => page.evaluate((r, c) => { const x = globalThis.__SP_VIEW__?.raw?.tileScreen?.(r, c); return x && { x: x.x, y: x.y }; }, row, col);
    const drag = async (from, to) => {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      for (let i = 1; i <= 12; i++) { await page.mouse.move(from.x + ((to.x - from.x) * i) / 12, from.y + ((to.y - from.y) * i) / 12); await sleep(16); }
      await sleep(120);
      await page.mouse.up();
      await sleep(600);
    };
    let s = await mockState(page);
    const targets = s.board.filter((x) => x.kind === 'chess' && !(x.items || []).length).sort((a, b) => a.row - b.row);
    const items = s.hand.filter((x) => x && x.kind === 'item');
    assert.ok(targets.length && items.length, 'mock board has an unequipped operator and a hand item');
    const unit = targets[0];
    await drag(await at(items[0].uid, 0.5), await tileAt(unit.row, unit.col));
    s = await mockState(page);
    assert.ok(s.board.find((x) => x.uid === unit.uid).items.some((i) => i.uid === items[0].uid), 'equipped: dropped on its tile');
    assert.deepEqual(problems, []);
    await page.close();
  });

  test('an illegal drop says why (DOM fallback: pieceDrop, engine: cancelled drag)', async () => {
    for (const render of RENDER === 'engine' ? ['fallback', 'engine'] : ['fallback']) {
      const { page, problems } = await open('phase=PREP', { render });
      if (render === 'engine') await sleep(1500);
      // deploy cap reached: a hand operator dropped on any empty board tile is refused
      await page.evaluate(() => globalThis.__MOCK__.mutate((S) => { S.priv.deployCap = S.priv.board.filter((x) => x.kind === 'chess').length; S.priv.deployCount = S.priv.deployCap; }));
      await sleep(200);
      const s = await mockState(page);
      const hc = s.hand.find((x) => x && x.kind === 'chess' && !x.golden);
      const occupied = new Set(s.board.map((x) => `${x.row},${x.col}`));
      let from;
      let to = null;
      if (render === 'fallback') {
        from = await page.$eval(`.ff-piece[data-uid="${hc.uid}"]`, (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
        const free = [[9, 9], [9, 8], [12, 6], [11, 7], [10, 7], [9, 7], [10, 4], [11, 4]].find(([r, c]) => !occupied.has(`${r},${c}`));
        to = await page.$eval(`.ff-tile[data-row="${free[0]}"][data-col="${free[1]}"]`, (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      } else {
        from = await page.evaluate((u) => { const r = globalThis.__SP_VIEW__.pieceScreenRect(u); return { x: r.left + r.width / 2, y: r.top + r.height * 0.65 }; }, hc.uid);
        // find the screen point of an empty board tile through the view's tileHover events
        await page.evaluate(() => { globalThis.__TH__ = null; globalThis.__SP_VIEW__.on('tileHover', (t) => { globalThis.__TH__ = t; }); });
        const box = await page.evaluate((uids) => {
          const rs = uids.map((u) => globalThis.__SP_VIEW__.pieceScreenRect(u)).filter(Boolean);
          return { l: Math.min(...rs.map((r) => r.left)) - 150, r: Math.max(...rs.map((r) => r.right)) + 150, t: Math.min(...rs.map((r) => r.top)), b: Math.max(...rs.map((r) => r.bottom)) + 40 };
        }, s.board.map((x) => x.uid));
        for (let y = box.t; y <= box.b && !to; y += 18) {
          for (let x = box.l; x <= box.r && !to; x += 18) {
            await page.mouse.move(x, y);
            const t = await page.evaluate(() => globalThis.__TH__);
            if (t && t.area === 'board' && !occupied.has(`${t.row},${t.col}`)) to = { x, y };
          }
        }
        assert.ok(to, 'found an empty board tile on screen');
      }
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      for (let i = 1; i <= 12; i++) { await page.mouse.move(from.x + ((to.x - from.x) * i) / 12, from.y + ((to.y - from.y) * i) / 12); await sleep(16); }
      await sleep(120);
      await page.mouse.up();
      await sleep(500);
      const toastText = await page.$eval('.toast', (el) => el.textContent).catch(() => null);
      assert.match(String(toastText), /已达到部署上限|无法部署在该位置|近战单位只能部署在地面/, `${render}: toast explains the refusal`);
      assert.ok((await mockState(page)).hand.some((x) => x && x.uid === hc.uid), `${render}: the operator stays in the hand`);
      assert.deepEqual(problems, []);
      await page.close();
    }
  });

  test('emote, exit → 暂离 → 返回', async () => {
    const { page, problems } = await open('phase=PREP');
    await page.click('.ewheel__btn');
    await page.click('.ewheel__item');
    await page.waitForSelector('.team__bubble');
    await page.click('.gtop__exit');
    await page.waitForSelector('.modal');
    const buttons = await page.$$('.modal__actions .btn');
    await buttons[1].click(); // 暂离
    await page.waitForSelector('.awayov');
    await page.click('.awayov .btn');
    await sleep(300);
    assert.equal(await page.$('.awayov'), null);
    assert.deepEqual(problems, []);
    await page.close();
  });
});
