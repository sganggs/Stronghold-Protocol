// Browser E2E of the 干员调配 overlay (DESIGN §16) against the real server, headless Chrome (puppeteer-core + system
// Chrome). Opt-in: SP_E2E=1 node --test test/ui/loadout.e2e.test.js
//
// Desktop 1920×1080: lobby → 干员调配 → search 隐现 → S1 + 不装备 (persisted in localStorage, synced with room.loadout)
// → create a 独立模拟 room → start → the briefing's m.private.loadout carries the choice, the briefing entry reopens the
// overlay, the solo briefing shows no countdown value from the server (deadline 0) → 准备就绪 closes the overlay
// (auto-close when INFO_CHECK ends). Phone 844×390 (touch): the roster → tap a card → the detail slides over → back.
// Module cards: the official module type icons from the local-client art (data/local-assets.json groups.module, optional)
// or the lettered tiles without it → test/e2e/out/module-icons.png.
// Every page must finish with zero console errors / page errors / failed requests. Screenshots: test/e2e/out/loadout-*.png

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'test/e2e/out');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const INSIDE = 'chess_char_1_01_a';
/** Whether this machine has the extracted module type icons (local-client art is optional, DESIGN §13). */
function localModuleIcons() {
  try { return !!JSON.parse(readFileSync(path.join(ROOT, 'data/local-assets.json'), 'utf8'))?.groups?.module; } catch { return false; }
}

describe('干员调配 overlay (real server, headless Chrome)', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome) to run' }, () => {
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
  after(async () => { await browser?.close(); await srv?.close(); });

  async function open({ w = 1920, h = 1080, touch = false } = {}) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: w, height: h, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
    const problems = [];
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('requestfailed', (r) => { if (!/fonts\.(googleapis|gstatic)/.test(r.url())) problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`); });
    page.on('response', (r) => { if (r.status() >= 400) problems.push(`http ${r.status()}: ${r.url()}`); });
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('sp.name', '调配测试');
      sessionStorage.setItem('sp.entered', '1');
    });
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => globalThis.__SP__?.store.get().connection.status === 'online' && !!document.querySelector('.lobby-screen'), { timeout: 30000 });
    return { ctx, page, problems };
  }
  const st = (page) => page.evaluate(() => {
    const s = globalThis.__SP__.store.get();
    return { phase: s.match.public?.phase ?? null, deadline: s.match.public?.deadline ?? null, loadout: s.match.private?.loadout ?? null, room: s.room?.code ?? null };
  });
  async function waitSt(page, pred, what, timeout = 20000) {
    const t0 = Date.now();
    let last = null;
    while (Date.now() - t0 < timeout) { last = await st(page); if (pred(last)) return last; await sleep(150); }
    throw new Error(`timed out waiting for ${what}: ${JSON.stringify(last)}`);
  }
  /** The overlay's background layer (css/screens/loadout.css .lo__bg — the mint glow and the grid): out of the flex flow
   *  and as large as the overlay, every other layer stacked above it. It used to be a 0-px flex item: `.lo > *` (same
   *  specificity, a later rule) overrode its position: absolute (PR #14). */
  const bgLayer = (page) => page.evaluate(() => {
    const lo = document.querySelector('.lo');
    const el = lo.querySelector(':scope > .lo__bg');
    const a = lo.getBoundingClientRect(), b = el.getBoundingClientRect();
    return {
      position: getComputedStyle(el).position, first: lo.firstElementChild === el, rect: [b.x, b.y, b.width, b.height], lo: [a.x, a.y, a.width, a.height],
      others: [...lo.children].filter((c) => c !== el).map((c) => getComputedStyle(c).position),
    };
  });
  const assertBgLayer = async (page) => {
    const bg = await bgLayer(page);
    assert.equal(bg.position, 'absolute', `the background layer is out of the flex flow ${JSON.stringify(bg)}`);
    assert.ok(bg.first && bg.rect[3] > 0 && JSON.stringify(bg.rect) === JSON.stringify(bg.lo), `it covers the whole overlay ${JSON.stringify(bg)}`);
    assert.ok(bg.others.length >= 3 && bg.others.every((p) => p === 'relative'), `every other layer stacks above it ${JSON.stringify(bg)}`);
  };
  const clickSel = async (page, sel) => {
    await page.waitForSelector(sel, { visible: true, timeout: 10000 });
    await page.click(sel);
  };

  test('desktop: choose S1 + 不装备 for 隐现, persisted, synced into the solo match, briefing entry, auto-close', async () => {
    const { ctx, page, problems } = await open();
    await clickSel(page, '.lobby-screen [data-testid="loadout-open"]');
    await page.waitForSelector('.lo .lo-card', { visible: true, timeout: 15000 });
    assert.equal(await page.$$eval('.lo-card', (els) => els.length), 112, 'every visible chess');
    await assertBgLayer(page);
    await page.screenshot({ path: path.join(OUT, 'loadout-desktop.png') });
    // search → one card
    await page.type('.lo-search input', '隐现');
    await page.waitForFunction(() => document.querySelectorAll('.lo-card').length === 1, { timeout: 5000 });
    await page.click('.lo-card');
    await page.waitForSelector('.lo-detail .lo-skill[data-skill="0"]', { visible: true });
    await page.click('.lo-detail .lo-skill[data-skill="0"]');
    await page.click('.lo-detail .lo-mod[data-module="none"]');
    // elite-level descriptions toggle
    await page.click('.lo-seg button:nth-child(2)');
    await page.waitForFunction(() => document.querySelector('.lo-skill.is-on[data-skill="0"]') && document.querySelector('.lo-mod.is-on[data-module="none"]'));
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('sp.pref.loadout')));
    assert.deepEqual(stored.entries, { [INSIDE]: { skill: 0, module: 'none' } });
    await page.waitForFunction(() => /已同步/.test(document.querySelector('.lo-sync')?.textContent || ''), { timeout: 5000 });
    await page.screenshot({ path: path.join(OUT, 'loadout-detail.png') });
    // close (Esc), create a solo room, start
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.lo'), { timeout: 3000 });
    await page.evaluate(() => globalThis.__SP__.net.request('room.create', { mode: 'solo', difficulty: 'NORMAL' }));
    await waitSt(page, (s) => !!s.room, 'room');
    await page.waitForSelector('.room-screen [data-testid="loadout-open"]', { visible: true });
    await page.evaluate(() => globalThis.__SP__.net.request('room.start', {}));
    const brief = await waitSt(page, (s) => s.phase === 'INFO_CHECK' && s.loadout, 'briefing');
    assert.deepEqual(brief.loadout, { [INSIDE]: { skill: 0, module: 'none' } }, 'the match fights with the loadout');
    assert.equal(brief.deadline, 0, 'solo briefing: no deadline');
    assert.equal(await page.$$eval('.brief .countdown', (els) => els.filter((e) => getComputedStyle(e).display !== 'none').length), 0,
      'no countdown shown in the solo briefing');
    // the briefing entry reopens it; 准备就绪 (INFO_CHECK ends) closes it
    await clickSel(page, '.brief [data-testid="loadout-open"]');
    await page.waitForSelector('.lo', { visible: true });
    await page.screenshot({ path: path.join(OUT, 'loadout-briefing.png') });
    await page.evaluate(() => globalThis.__SP__.net.request('g.infoReady', {}));
    await page.waitForFunction(() => !document.querySelector('.lo'), { timeout: 5000 });
    assert.deepEqual(problems, []);
    await ctx.close();
  });

  test('import: Tab stays in the dialog and Enter cannot edit a background module', async () => {
    const { ctx, page, problems } = await open();
    try {
      await clickSel(page, '.lobby-screen [data-testid="loadout-open"]');
      await page.waitForSelector('.lo-mod.is-on');
      const module = () => page.$eval('.lo-mod.is-on', (el) => el.dataset.module);
      const original = await module();
      const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('sp.pref.loadout') || '{}').entries || {});
      const openImport = async () => {
        await clickSel(page, '[data-testid="loadout-import"]');
        await page.waitForSelector('.modal textarea');
        await page.waitForFunction(() => !document.querySelector('.modal__box').getAnimations().some((a) => a.playState === 'running'));
      };
      const focused = () => page.evaluate(() => document.activeElement.getAttribute('data-testid'));
      await openImport();
      await page.click('.modal textarea');
      await page.keyboard.down('Shift');
      await page.keyboard.press('Tab');
      await page.keyboard.up('Shift');
      assert.equal(await focused(), 'loadout-io-pick', 'Shift+Tab wraps past the disabled import and hidden file input');
      const chooser = page.waitForFileChooser();
      await page.keyboard.press('Enter');
      await (await chooser).cancel();
      assert.ok(await page.$('.modal'), 'Enter acts on the file picker inside the dialog');
      assert.equal(await module(), original, 'the background module cannot be activated');
      assert.deepEqual(await saved(), {});
      await page.keyboard.press('Tab');
      assert.equal(await focused(), 'loadout-io-text', 'Tab wraps back to the textarea');
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), '取消');
      await page.keyboard.press('Enter');
      await page.waitForSelector('.modal', { hidden: true });
      assert.equal(await focused(), 'loadout-import', 'cancel restores the opener');
      assert.equal(await module(), original);
      assert.deepEqual(await saved(), {});

      await openImport();
      await page.keyboard.press('Escape');
      await page.waitForSelector('.modal', { hidden: true });
      assert.ok(await page.$('.lo'), 'Esc closes only the import');
      assert.equal(await focused(), 'loadout-import');

      await openImport();
      await page.click('.modal textarea');
      await page.keyboard.type(JSON.stringify({ v: 1, kind: 'stronghold.loadout', entries: { [INSIDE]: { skill: 0 } } }));
      await page.keyboard.down('Shift');
      await page.keyboard.press('Tab');
      await page.keyboard.up('Shift');
      assert.equal(await focused(), 'loadout-io-apply', 'the enabled import becomes the last stop');
      await page.keyboard.press('Enter');
      await page.waitForSelector('.modal', { hidden: true });
      assert.deepEqual(await saved(), { [INSIDE]: { skill: 0 } }, 'keyboard confirmation still imports');
      assert.equal(await focused(), 'loadout-import');
      // Optional art / fonts / audio can be absent; this keyboard regression needs no asset pack.
      assert.deepEqual(problems.filter((p) => p.startsWith('pageerror:')), []);
    } finally { await ctx.close(); }
  });

  test('desktop: 导出 hands out a versioned payload; 导入 restores it and refuses junk', async () => {
    const { ctx, page, problems } = await open();
    await clickSel(page, '.lobby-screen [data-testid="loadout-open"]');
    await page.waitForSelector('.lo .lo-card', { visible: true, timeout: 15000 });
    // one edit, so there is something to export
    await page.type('.lo-search input', '隐现');
    await page.waitForFunction(() => document.querySelectorAll('.lo-card').length === 1, { timeout: 5000 });
    await page.click('.lo-card');
    await page.waitForSelector('.lo-detail .lo-skill[data-skill="0"]', { visible: true });
    await page.click('.lo-detail .lo-skill[data-skill="0"]');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('sp.pref.loadout')));
    assert.deepEqual(stored.entries, { [INSIDE]: { skill: 0 } });

    // 导出: a centred dialog — its own full-viewport overlay, rendered NEXT TO the .lo screen rather than inside it
    await clickSel(page, '[data-testid="loadout-export"]');
    await page.waitForSelector('.modal [data-testid="loadout-io-text"]', { visible: true, timeout: 5000 });
    // the box slides in (`modal-in`, 250 ms): measure the settled geometry, not a frame of the entry animation
    await page.waitForFunction(() => document.querySelector('.modal__box')?.getAnimations().every((a) => a.playState === 'finished'), { timeout: 5000 });
    const box = await page.evaluate(() => {
      const m = document.querySelector('.modal');
      const b = document.querySelector('.modal__box').getBoundingClientRect();
      return { position: getComputedStyle(m).position, y: b.y, h: b.height, vh: innerHeight, inside: !!m.closest('.lo') };
    });
    assert.equal(box.position, 'fixed', 'the modal keeps components.css `position: fixed`');
    assert.equal(box.inside, false, 'a sibling of .lo, so `.lo > *` needs no exception for it');
    assert.ok(Math.abs(box.y + box.h / 2 - box.vh / 2) < 2, `centred vertically (${JSON.stringify(box)})`);
    const payload = JSON.parse(await page.$eval('[data-testid="loadout-io-text"]', (t) => t.value));
    assert.equal(payload.kind, 'stronghold.loadout');
    assert.equal(payload.v, 1);
    assert.deepEqual(payload.entries, stored.entries, 'what is exported is what is stored');
    await page.screenshot({ path: path.join(OUT, 'loadout-export.png') });
    await page.evaluate(() => [...document.querySelectorAll('.modal__actions .btn')].find((b) => b.textContent.trim() === '关闭').click());
    await page.waitForFunction(() => !document.querySelector('.modal'), { timeout: 3000 });

    // wipe it, then 导入 the payload back
    await page.evaluate(() => localStorage.setItem('sp.pref.loadout', JSON.stringify({ v: 1, entries: {} })));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => globalThis.__SP__?.store.get().connection.status === 'online' && !!document.querySelector('.lobby-screen'), { timeout: 30000 });
    await clickSel(page, '.lobby-screen [data-testid="loadout-open"]');
    await page.waitForSelector('.lo .lo-card', { visible: true, timeout: 15000 });
    await clickSel(page, '[data-testid="loadout-import"]');
    await page.waitForSelector('.modal [data-testid="loadout-io-text"]', { visible: true, timeout: 5000 });
    await page.$eval('[data-testid="loadout-io-text"]', (t, v) => { t.value = v; t.dispatchEvent(new Event('input', { bubbles: true })); }, JSON.stringify(payload));
    await page.click('[data-testid="loadout-io-apply"]');
    await page.waitForFunction(() => !document.querySelector('.modal'), { timeout: 5000 });
    await sleep(300);
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('sp.pref.loadout')).entries), stored.entries, 'round trip');

    // a payload of another tool is refused and leaves the loadout alone
    await clickSel(page, '[data-testid="loadout-import"]');
    await page.waitForSelector('.modal [data-testid="loadout-io-text"]', { visible: true, timeout: 5000 });
    await page.$eval('[data-testid="loadout-io-text"]', (t) => { t.value = '{"kind":"other.tool","entries":{"a":{"skill":1}}}'; t.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.click('[data-testid="loadout-io-apply"]');
    await page.waitForFunction(() => /导入失败/.test(document.body.textContent || ''), { timeout: 5000 });
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('sp.pref.loadout')).entries), stored.entries, 'a refused import changes nothing');

    // a payload this build cannot use at all (every chess unknown) must leave the loadout alone too (review fix)
    await page.$eval('[data-testid="loadout-io-text"]', (t) => { t.value = '{"v":1,"entries":{"chess_not_here":{"skill":0}}}'; t.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.click('[data-testid="loadout-io-apply"]');
    await page.waitForFunction(() => /没有可用的调配/.test(document.body.textContent || ''), { timeout: 5000 });
    assert.ok(await page.$('.modal'), 'the dialog stays open for the player to fix the payload');
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('sp.pref.loadout')).entries), stored.entries, 'an import that keeps nothing changes nothing');
    assert.deepEqual(problems, []);
    await ctx.close();
  });

  test('solo briefing: an edit made right before 准备就绪 still applies to this match (closing the overlay sends it)', async () => {
    const { ctx, page, problems } = await open();
    await page.evaluate(() => globalThis.__SP__.net.request('room.create', { mode: 'solo', difficulty: 'NORMAL' }));
    await waitSt(page, (s) => !!s.room, 'room');
    await page.evaluate(() => globalThis.__SP__.net.request('room.start', {}));
    await waitSt(page, (s) => s.phase === 'INFO_CHECK', 'briefing');
    await clickSel(page, '.brief [data-testid="loadout-open"]');
    await page.waitForSelector('.lo .lo-card', { visible: true, timeout: 15000 });
    await page.type('.lo-search input', '隐现');
    await page.waitForFunction(() => document.querySelectorAll('.lo-card').length === 1, { timeout: 5000 });
    await page.click('.lo-card');
    await page.waitForSelector('.lo-detail .lo-skill[data-skill="0"]', { visible: true });
    // choose S1, close and confirm at once — well inside the sync's debounce
    await page.click('.lo-detail .lo-skill[data-skill="0"]');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.lo'), { timeout: 3000 });
    await page.click('.brief__foot .btn--primary');
    const s = await waitSt(page, (x) => x.phase && x.phase !== 'INFO_CHECK' && x.loadout && x.loadout[INSIDE], 'band draft with the loadout', 8000)
      .catch(async (e) => { throw new Error(`${e.message} — last loadout ${JSON.stringify((await st(page)).loadout)}`); });
    assert.equal(s.loadout[INSIDE].skill, 0, 'the match fights with the edit made just before 准备就绪');
    assert.deepEqual(problems, []);
    await ctx.close();
  });

  test('co-op briefing (review fix): the overlay shows the INFO_CHECK time left; an edit that misses the lock is told, not lost silently', async () => {
    const { ctx, page, problems } = await open();
    await page.evaluate(() => globalThis.__SP__.net.request('room.create', { mode: 'coop', difficulty: 'NORMAL' }));
    const { room } = await waitSt(page, (s) => !!s.room, 'room');
    // a second human joins: a single human is untimed like solo (Match.soloUntimed, user playtest #4 item 3)
    const mate = await open();
    await mate.page.evaluate((code) => globalThis.__SP__.net.request('room.join', { code }), room);
    await waitSt(mate.page, (s) => s.room === room, 'the teammate in the room');
    await mate.page.evaluate(() => globalThis.__SP__.net.request('room.ready', { ready: true }));
    await page.evaluate(() => globalThis.__SP__.net.request('room.addBot', {}));
    await page.evaluate(() => globalThis.__SP__.net.request('room.start', {}));
    const brief = await waitSt(page, (s) => s.phase === 'INFO_CHECK', 'briefing');
    assert.ok(brief.deadline > 0, 'co-op briefing (two humans) is timed (25 s)');
    await clickSel(page, '.brief [data-testid="loadout-open"]');
    await page.waitForSelector('.lo .lo-card', { visible: true, timeout: 15000 });
    // the briefing (and its countdown) is hidden under the overlay: the overlay carries the time left
    await page.waitForSelector('.lo-top .lo-deadline', { visible: true, timeout: 3000 });
    assert.match(await page.$eval('.lo-top .lo-deadline', (el) => el.getAttribute('aria-label')), /剩余\d+秒/);
    // review: the two new 导出 / 导入 buttons must fit next to the countdown on a narrow phone in landscape (667×375).
    // 0.2.0: the third tab (自选编队) ran the right column into the tabs there, at 844×390, and in English at every size.
    // Only the size changes (toggling isMobile / hasTouch would make puppeteer reload the page).
    const switchLang = async (lang) => {
      await page.evaluate((l) => import('/js/ui/lang.js').then((m) => m.switchLang(l)), lang);
      await page.waitForFunction((l) => document.documentElement.lang.startsWith(l) && /[一-鿿]/.test(document.querySelector('.lo-tabs').textContent) === (l === 'zh'), { timeout: 5000 }, lang);
    };
    for (const [lang, sizes] of [['zh', [[667, 375], [844, 390]]], ['en', [[667, 375], [844, 390], [1920, 1080]]]]) {
      if (lang !== 'zh') await switchLang(lang);
      for (const [w, h] of sizes) {
        await page.setViewport({ width: w, height: h });
        const bar = await page.evaluate(() => {
          const top = document.querySelector('.lo-top');
          const tabs = document.querySelector('.lo-tabs');
          const right = document.querySelector('.lo-top__right').getBoundingClientRect();
          const center = document.querySelector('.lo-top__center').getBoundingClientRect();
          const buttons = [...document.querySelectorAll('.lo-top__right .btn')].map((b) => Math.round(b.getBoundingClientRect().right));
          return { overflow: top.scrollWidth - top.clientWidth, overlap: right.left < center.right, offscreen: right.right > innerWidth, tabsCut: tabs.scrollWidth - tabs.clientWidth, buttons };
        });
        const at = `${lang} ${w}×${h} ${JSON.stringify(bar)}`;
        assert.ok(bar.overflow <= 0, `the top bar does not scroll sideways (${at})`);
        assert.equal(bar.overlap, false, `the right column does not run into the title (${at})`);
        assert.equal(bar.offscreen, false, `every button ends inside the viewport (${at})`);
        assert.ok(bar.tabsCut <= 0, `the three tabs show in full (${at})`);
        if (w === 667) await page.screenshot({ path: path.join(OUT, `loadout-narrow-toolbar${lang === 'zh' ? '' : `-${lang}`}.png`) });
      }
    }
    await switchLang('zh');
    await page.setViewport({ width: 1920, height: 1080 });
    await page.type('.lo-search input', '隐现');
    await page.waitForFunction(() => document.querySelectorAll('.lo-card').length === 1, { timeout: 5000 });
    await page.click('.lo-card');
    await page.waitForSelector('.lo-detail .lo-skill[data-skill="0"]', { visible: true });
    // edit, and the briefing ends before the debounced send (every human ready: the requests stand in for the timer)
    await page.click('.lo-detail .lo-skill[data-skill="0"]');
    await mate.page.evaluate(() => globalThis.__SP__.net.request('g.infoReady', {}));
    await page.evaluate(() => globalThis.__SP__.net.request('g.infoReady', {}));
    await page.waitForFunction(() => !document.querySelector('.lo'), { timeout: 5000 });
    await page.waitForFunction(() => [...document.querySelectorAll('.toast__text')].some((e) => /下一局生效/.test(e.textContent)), { timeout: 5000 });
    const s = await st(page);
    assert.ok(!s.loadout || !s.loadout[INSIDE], 'the running match kept its locked loadout');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('sp.pref.loadout')));
    assert.deepEqual(stored.entries[INSIDE], { skill: 0 }, 'kept for the next match');
    assert.deepEqual(problems, []);
    assert.deepEqual(mate.problems, []);
    await mate.ctx.close();
    await ctx.close();
  });

  test('module cards: official type icons (PRI-X.png / pri-y.png, matched case-insensitively) or lettered tiles', async () => {
    const { ctx, page, problems } = await open();
    await clickSel(page, '.lobby-screen [data-testid="loadout-open"]');
    await page.waitForSelector('.lo .lo-card', { visible: true, timeout: 15000 });
    await page.type('.lo-search input', '烛煌');
    await page.waitForFunction(() => document.querySelectorAll('.lo-card').length === 1, { timeout: 5000 });
    await page.click('.lo-card');
    await page.waitForSelector('.lo-detail .lo-mod[data-module="none"]', { visible: true });
    // wait for every module tile to settle (image loaded or lettered fallback)
    await page.waitForFunction(() => [...document.querySelectorAll('.lo-mod:not(.lo-mod--none) .lo-mglyph')]
      .every((g) => g.querySelector('.lo-mglyph__t') || (g.querySelector('img')?.complete && g.querySelector('img').naturalWidth > 0)), { timeout: 5000 });
    const tiles = await page.$$eval('.lo-mod:not(.lo-mod--none)', (els) => els.map((el) => ({
      type: el.querySelector('.lo-mod__type')?.textContent || '',
      src: el.querySelector('.lo-mglyph img')?.getAttribute('src') || null,
      letter: el.querySelector('.lo-mglyph__t')?.textContent || null,
    })));
    assert.deepEqual(tiles.map((t) => t.type).sort(), ['PRI-X', 'PRI-Y']);
    if (localModuleIcons()) {
      for (const t of tiles) assert.match(t.src || '', new RegExp(`^/assets/local/module/${t.type}\\.png$`, 'i'), JSON.stringify(t));
      assert.ok(await page.$('.lo-minfo__title .lo-minfo__icon'), 'the selected module\'s info shows its icon too');
    } else {
      for (const t of tiles) assert.equal(t.letter, t.type.slice(-1), JSON.stringify(t));
    }
    await page.hover('.lo-mod[data-module]:not(.is-on):not(.lo-mod--none)');
    await page.screenshot({ path: path.join(OUT, 'module-icons.png') });
    assert.deepEqual(problems, []);
    await ctx.close();
  });

  test('phone 844×390 (touch): roster + detail side by side, tier / class filters, tap to choose', async () => {
    const { ctx, page, problems } = await open({ w: 844, h: 390, touch: true });
    await page.tap('.lobby-screen [data-testid="loadout-open"]');
    await page.waitForSelector('.lo .lo-card', { visible: true, timeout: 15000 });
    await assertBgLayer(page);
    await page.screenshot({ path: path.join(OUT, 'loadout-phone.png') });
    // review fix: the shared Button / TextField shrink to 6–7 px text on phones — the overlay's own controls stay readable
    // and tappable (返回, 全部恢复默认, the detail's 恢复默认, the search input)
    const ctl = await page.evaluate(() => Object.fromEntries(['.lo-back', '.lo-top__right .btn', '.lo-dhead__reset', '.lo-search .field__input'].map((sel) => {
      const el = document.querySelector(sel);
      const b = el.getBoundingClientRect();
      return [sel, { h: Math.round(b.height), fs: parseFloat(getComputedStyle(el).fontSize) }];
    })));
    for (const [sel, v] of Object.entries(ctl)) {
      assert.ok(v.fs >= 11, `${sel} text ≥ 11 px (${JSON.stringify(v)})`);
      if (sel !== '.lo-search .field__input') assert.ok(v.h >= 28, `${sel} ≥ 28 px tall (${JSON.stringify(v)})`);
    }
    await page.tap('.lo-chip--t6');
    await page.waitForFunction(() => [...document.querySelectorAll('.lo-card')].every((c) => c.classList.contains('lo-card--t6')));
    await page.tap('.lo-chip--prof[title="狙击"]');
    await page.waitForFunction(() => document.querySelectorAll('.lo-card').length >= 1);
    await page.tap('.lo-card');
    await page.waitForSelector('.lo-detail .lo-skill', { visible: true });
    assert.notEqual(await page.$eval('.lo-roster', (el) => getComputedStyle(el).display), 'none', 'side by side');
    // every skill option is reachable inside the viewport (the detail body scrolls)
    const r = await page.$eval('.lo-detail .lo-skill:last-child', (el) => { el.scrollIntoView({ block: 'nearest' }); const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom }; });
    assert.ok(r.top >= 0 && r.bottom <= 390, JSON.stringify(r));
    await page.tap('.lo-detail .lo-skill:last-child');
    await page.waitForFunction(() => document.querySelector('.lo-detail .lo-skill:last-child').classList.contains('is-on'));
    await page.screenshot({ path: path.join(OUT, 'loadout-phone-detail.png') });
    assert.deepEqual(problems, []);
    await ctx.close();
  });

  test('small phone 667×375 (touch): the detail slides over the roster and back', async () => {
    const { ctx, page, problems } = await open({ w: 667, h: 375, touch: true });
    await page.tap('.lobby-screen [data-testid="loadout-open"]');
    await page.waitForSelector('.lo .lo-card', { visible: true, timeout: 15000 });
    assert.equal(await page.$eval('.lo-detail-wrap', (el) => getComputedStyle(el).display), 'none');
    await page.tap('.lo-card');
    await page.waitForSelector('.lo-detail .lo-skill', { visible: true });
    assert.equal(await page.$eval('.lo-roster', (el) => getComputedStyle(el).display), 'none', 'detail covers the roster');
    await page.screenshot({ path: path.join(OUT, 'loadout-small-phone.png') });
    await page.tap('.lo-detail-back');
    await page.waitForSelector('.lo-roster', { visible: true });
    assert.deepEqual(problems, []);
    await ctx.close();
  });

  // ---- 局内数值 (GitHub issue #64) -------------------------------------------------------------------------------------
  const CHESS = () => JSON.parse(readFileSync(path.join(ROOT, 'data/chess.json'), 'utf8'));
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  /** The section's eight stats: label → shown value. */
  const shownStats = (page) => page.$$eval('.lo-sec--stats .dstat', (els) => Object.fromEntries(els.map((e) => [e.querySelector('.dstat__k').textContent, e.querySelector('.dstat__v').textContent])));
  const rangeTiles = (page) => page.$$eval('.lo-sec--stats .rgrid i.on', (els) => els.length);
  async function pickChess(page, name) {
    await page.$eval('.lo-search input', (el) => { el.focus(); el.select(); });
    await page.keyboard.press('Backspace');
    await page.type('.lo-search input', name);
    await page.waitForFunction((n) => document.querySelectorAll('.lo-card').length === 1 && document.querySelector('.lo-card .lo-card__name')?.textContent === n, { timeout: 5000 }, name);
    await page.click('.lo-card');
    await page.waitForSelector('.lo-sec--stats .dstat', { visible: true });
  }

  test('局内数值 (desktop): 隐现\'s stats follow the module and the 普通 / 精锐 toggle, the range follows 信仰搅拌机\'s SPT-Y', async () => {
    const chess = CHESS();
    const base = chess[INSIDE];
    const golden = chess[base.goldenId];
    const mod = golden.modules.find((m) => m.isDefault);
    const { ctx, page, problems } = await open();
    await clickSel(page, '.lobby-screen [data-testid="loadout-open"]');
    await page.waitForSelector('.lo .lo-card', { visible: true, timeout: 15000 });
    await pickChess(page, '隐现');
    // between the skills and the modules, 精锐 shown first: the default module's numbers, the 3 × 4 range
    assert.deepEqual(await page.$$eval('.lo-detail__body > .lo-sec > header h3', (els) => els.map((e) => e.firstChild.textContent)), ['技能', '局内数值', '模组']);
    const stats = await shownStats(page);
    assert.deepEqual(Object.keys(stats), ['生命上限', '攻击', '防御', '法术抗性', '攻击间隔', '阻挡数', '部署费用', '再部署']);
    assert.equal(stats['生命上限'], fmt(golden.statsBase.maxHp + mod.attr.maxHp));
    assert.equal(stats['攻击'], fmt(golden.statsBase.atk + mod.attr.atk));
    assert.equal(await rangeTiles(page), base.rangeGrid.length);
    assert.equal(await page.$eval('.lo-sec--stats', (el) => el.dataset.variant), 'elite');
    await page.screenshot({ path: path.join(OUT, 'loadout-stats-desktop.png') });
    // 不装备 → the base numbers; the skill choice changes nothing; 普通 → the normal chess; both toggles are independent
    await page.click('.lo-detail .lo-mod[data-module="none"]');
    await page.waitForFunction((v) => document.querySelector('.lo-sec--stats .dstat__v')?.textContent === v, {}, fmt(golden.statsBase.maxHp));
    assert.equal((await shownStats(page))['攻击'], fmt(golden.statsBase.atk));
    await page.click('.lo-detail .lo-skill[data-skill="0"]');
    assert.equal((await shownStats(page))['攻击'], fmt(golden.statsBase.atk), 'a skill is not a stat');
    await page.click('.lo-sec--stats .lo-seg button[data-variant="normal"]');
    await page.waitForFunction((v) => document.querySelector('.lo-sec--stats .dstat__v')?.textContent === v, {}, fmt(base.stats.maxHp));
    assert.equal(await page.$eval('.lo-sec--stats', (el) => el.dataset.variant), 'normal');
    assert.equal(await page.$eval('.lo-skill.is-on', (el) => el.dataset.skill), '0');
    assert.equal(await page.$eval('.lo-seg button.is-on', (el) => el.textContent.startsWith('普通')), true, 'the skill level toggle is its own');
    // the layout: no sideways overflow, the range box beside the numbers
    const box = await page.evaluate(() => {
      const body = document.querySelector('.lo-detail__body');
      const grid = document.querySelector('.lo-sec--stats .dstats').getBoundingClientRect();
      const range = document.querySelector('.lo-sec--stats .drange').getBoundingClientRect();
      return { over: body.scrollWidth - body.clientWidth, beside: range.left >= grid.right - 1 && Math.abs(range.top - grid.top) < 2 };
    });
    assert.ok(box.over <= 1 && box.beside, JSON.stringify(box));
    // 信仰搅拌机: SPT-Y's "攻击距离+1" draws one more tile in the 精锐 view (the toggle stays where it was left: 普通 has no
    // module, and says so); 不装备 goes back
    await pickChess(page, '信仰搅拌机');
    assert.match(await page.$eval('.lo-stats__cap', (el) => el.textContent), /普通干员没有模组/);
    await page.click('.lo-sec--stats .lo-seg button[data-variant="elite"]');
    const t0 = await rangeTiles(page);
    await page.click('.lo-detail .lo-mod[data-module="uniequip_003_rmixer"]');
    await page.waitForFunction((n) => document.querySelectorAll('.lo-sec--stats .rgrid i.on').length === n, {}, t0 + 1);
    await page.click('.lo-detail .lo-mod[data-module="none"]');
    await page.waitForFunction((n) => document.querySelectorAll('.lo-sec--stats .rgrid i.on').length === n, {}, t0);
    assert.deepEqual(problems, []);
    await ctx.close();
  });

  test('局内数值 (phone 844×390, touch): the numbers, the range box and the 特性 / 天赋 card stay inside the narrow detail, text keeps its floor', async () => {
    const chess = CHESS();
    const golden = chess[chess[INSIDE].goldenId];
    const { ctx, page, problems } = await open({ w: 844, h: 390, touch: true });
    await page.tap('.lobby-screen [data-testid="loadout-open"]');
    await page.waitForSelector('.lo .lo-card', { visible: true, timeout: 15000 });
    await page.type('.lo-search input', '隐现');
    await page.waitForFunction(() => document.querySelectorAll('.lo-card').length === 1, { timeout: 5000 });
    await page.tap('.lo-card');
    await page.waitForSelector('.lo-sec--stats .dstat', { visible: true });
    await page.$eval('.lo-sec--stats', (el) => el.scrollIntoView({ block: 'start' }));
    const m = await page.evaluate(() => {
      const bodyEl = document.querySelector('.lo-detail__body');
      const body = bodyEl.getBoundingClientRect();
      const inside = (el) => { const b = el.getBoundingClientRect(); return b.left >= body.left - 1 && b.right <= body.right + 1 && b.width > 0; };
      const fs = (sel) => parseFloat(getComputedStyle(document.querySelector(sel)).fontSize);
      const grid = document.querySelector('.lo-sec--stats .dstats').getBoundingClientRect();
      const range = document.querySelector('.lo-sec--stats .drange').getBoundingClientRect();
      return {
        over: bodyEl.scrollWidth - bodyEl.clientWidth,
        inside: [...document.querySelectorAll('.lo-sec--stats .dstat, .lo-sec--stats .drange, .lo-sec--stats .lo-minfo--kit')].every(inside),
        // beside the numbers when the column is wide enough, else under them — never over them
        laidOut: range.left >= grid.right - 1 || range.top >= grid.bottom - 1,
        k: fs('.lo-sec--stats .dstat__k'), v: fs('.lo-sec--stats .dstat__v'), cap: fs('.lo-stats__cap'), row: fs('.lo-sec--stats .lo-minfo__v'),
        tab: Math.round(document.querySelector('.lo-sec--stats .lo-seg button').getBoundingClientRect().height),
        cell: Math.min(...[...document.querySelectorAll('.lo-sec--stats .dstat')].map((c) => Math.round(c.getBoundingClientRect().width))),
        clipped: [...document.querySelectorAll('.lo-sec--stats .dstat__k')].filter((e) => e.scrollWidth > e.clientWidth).map((e) => e.textContent),
      };
    });
    assert.ok(m.over <= 1 && m.inside && m.laidOut, JSON.stringify(m));
    assert.ok(m.k >= 9 && m.v >= 12 && m.cap >= 9 && m.row >= 10, `text floors ${JSON.stringify(m)}`);
    assert.ok(m.tab >= 22, `the toggle stays tappable ${JSON.stringify(m)}`);
    assert.deepEqual(m.clipped, [], `no stat label is cut off ${JSON.stringify(m)}`);
    await page.screenshot({ path: path.join(OUT, 'loadout-stats-phone.png') });
    // a choice made further down updates it (touch: the module card, 不装备)
    await page.tap('.lo-detail .lo-mod[data-module="none"]');
    await page.waitForFunction((v) => document.querySelector('.lo-sec--stats .dstat__v')?.textContent === v, {}, fmt(golden.statsBase.maxHp));
    assert.equal((await shownStats(page))['攻击'], fmt(golden.statsBase.atk));
    assert.deepEqual(problems, []);
    await ctx.close();
  });
});
