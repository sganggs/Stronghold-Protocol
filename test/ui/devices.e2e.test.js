// Multi-device E2E (puppeteer-core + system Chrome device emulation). Opt-in: SP_E2E=1 (needs Chrome, ~2 min).
//
//   SP_E2E=1 node --test test/ui/devices.e2e.test.js
//
// Devices (landscape): iPad (1180×820, touch), iPhone 14 (844×390, touch), Pixel 7 (915×412, touch), a 1366×768 touch
// laptop (touch + mouse) and the smallest supported phone (640×360). For each: the real title page (index.html) — on
// phones and the iPad also title → lobby → room with taps against the real server — and the in-match mock
// (public/dev/game-mock.html) — screenshots → test/e2e/out/device-<device>-<screen>.png — and checks:
//   * no page overflow, every visible HUD control fully inside the viewport, the rotate hint hidden in landscape;
//   * <html> feature classes (sp-touch / sp-coarse) from feature detection, touch-action on the field and the page;
//   * touch: tap targets of the small HUD controls are ≥ 40 px (hit-area probe with elementFromPoint), the 🔍▶▶ pen
//     button works with taps, two-tap buy works with taps, a long press on a shop card opens its detail (no purchase);
//   * safe-area insets (a notch on the left) move the HUD, not the field;
// plus graceful degradation: WebGL disabled → the DOM view with a notice, local-client art missing → CSS look-alikes,
// portrait → the rotate hint.

import { seedReleaseRead } from '../helpers/releaseNotes.js';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'test/e2e/out');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);
const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';

const DEVICES = {
  ipad: { viewport: { width: 1180, height: 820, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true }, userAgent: IPAD_UA, coarse: true },
  iphone14: { viewport: { width: 844, height: 390, deviceScaleFactor: 3, isMobile: true, hasTouch: true, isLandscape: true }, userAgent: IOS_UA, coarse: true },
  pixel7: { viewport: { width: 915, height: 412, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, isLandscape: true }, userAgent: ANDROID_UA, coarse: true },
  'laptop-touch': { viewport: { width: 1366, height: 768, deviceScaleFactor: 1, isMobile: false, hasTouch: true, isLandscape: true }, userAgent: null, coarse: true },
  'phone-min': { viewport: { width: 640, height: 360, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true }, userAgent: ANDROID_UA, coarse: true },
};
/** Small HUD controls that must have a ≥ 40 px hit area on touch screens. */
const HUD_TARGETS = ['.gtop__exit', '.gtop__iconbtn', '.enemybtn', '.readybtn', '.toolbtn', '.ewheel__btn', '.gm__gear'];

describe('multi-device (Chrome device emulation)', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome) to run' }, () => {
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

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function open(dev, url, { render = 'engine', intercept = null, b = browser, ctx = null } = {}) {
    const page = await (ctx || b).newPage();
    const d = DEVICES[dev];
    await page.emulate({ viewport: d.viewport, userAgent: d.userAgent || await b.userAgent() });
    const problems = [];
    const local = (u) => u.startsWith(base);
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('requestfailed', (r) => { if (local(r.url()) && !intercept) problems.push(`requestfailed: ${r.url()}`); });
    if (intercept) {
      await page.setRequestInterception(true);
      page.on('request', (r) => (intercept(r.url()) ? r.respond({ status: 404, body: 'gone' }) : r.continue()));
    }
    const full = url.startsWith('/') ? `${base}${url}` : `${base}/dev/game-mock.html?shot=1&render=${render}&${url}`;
    await seedReleaseRead(page);
    await page.goto(full, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => !!document.querySelector('.screen:not(.gload)'), { timeout: 20000 });
    await sleep(url.startsWith('/') ? 600 : 1600);
    return { page, problems };
  }

  /** No scrollbars, every visible control inside the viewport. */
  async function layoutProblems(page, scope = 'body') {
    return page.evaluate((sel) => {
      const out = [];
      const se = document.scrollingElement || document.documentElement;
      if (se.scrollWidth > innerWidth + 1) out.push(`page overflows horizontally (${se.scrollWidth} > ${innerWidth})`);
      if (se.scrollHeight > innerHeight + 1) out.push(`page overflows vertically (${se.scrollHeight} > ${innerHeight})`);
      const root = document.querySelector(sel) || document.body;
      for (const el of root.querySelectorAll('button, input, [role="button"]')) {
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        let hidden = false;
        for (let a = el; a && a !== document.body; a = a.parentElement) {
          const cs = getComputedStyle(a);
          if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.05) { hidden = true; break; }
        }
        if (hidden || el.closest('.mockbar')) continue;
        // content of a scroller (strategy grid, result list …) may scroll; an element parked fully off-screen is hidden
        let scroller = false;
        for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
          const cs = getComputedStyle(a);
          if (/(auto|scroll)/.test(cs.overflowX + cs.overflowY)) { scroller = true; break; }
        }
        if (scroller) continue;
        if (r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) continue;
        if (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) {
          out.push(`clipped: ${el.className || el.tagName} ${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 12)} [${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}]`);
        }
      }
      return out;
    }, scope);
  }

  /** Effective hit box of the first visible match of each selector (probe outward from the centre). */
  async function hitBoxes(page, sels) {
    return page.evaluate((list) => list.map((sel) => {
      const el = [...document.querySelectorAll(sel)].find((x) => x.getBoundingClientRect().width > 1);
      if (!el) return { sel, missing: true };
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const inside = (x, y) => { const t = document.elementFromPoint(x, y); return !!t && (t === el || el.contains(t)); };
      const reach = (dx, dy) => { let d = 0; while (d < 30 && inside(cx + dx * (d + 1), cy + dy * (d + 1))) d++; return d; };
      return { sel, w: reach(-1, 0) + reach(1, 0) + 1, h: reach(0, -1) + reach(0, 1) + 1 };
    }), sels);
  }

  for (const dev of Object.keys(DEVICES)) {
    test(`${dev}: title page — fits, touch classes, no zoom gestures, no errors`, async () => {
      const { page, problems } = await open(dev, '/');
      await page.waitForSelector('.title-screen', { timeout: 10000 });
      await page.screenshot({ path: path.join(OUT, `device-${dev}-title.png`) });
      const st = await page.evaluate(() => ({
        cls: document.documentElement.className,
        rotate: getComputedStyle(document.querySelector('.rotate-hint')).display,
        touchAction: getComputedStyle(document.documentElement).touchAction,
        focus: document.activeElement?.tagName,
      }));
      assert.match(st.cls, /\bsp-touch\b/, 'touch detected');
      assert.match(st.cls, /\bsp-coarse\b/, 'coarse pointer detected');
      assert.equal(st.rotate, 'none', 'no rotate hint in landscape');
      assert.equal(st.touchAction, 'pan-x pan-y', 'no pinch / double-tap zoom');
      assert.notEqual(st.focus, 'INPUT', 'no autofocus on touch screens (it would pop the keyboard)');
      assert.deepEqual(await layoutProblems(page), []);
      assert.deepEqual(problems, []);
      await page.close();
    });

    test(`${dev}: match HUD (prep / combat / strategy draft) fits; ≥ 40 px touch targets`, async () => {
      for (const [name, q] of [['prep', 'phase=PREP'], ['combat', 'phase=COMBAT'], ['draft', 'phase=BAND_DRAFT'], ['briefing', 'phase=INFO_CHECK'], ['sp', 'phase=SP_DRAFT&variant=bounty'], ['result', 'phase=RESULT']]) {
        const { page, problems } = await open(dev, q);
        await page.screenshot({ path: path.join(OUT, `device-${dev}-${name}.png`) });
        assert.deepEqual(await layoutProblems(page), [], `${dev} ${name}`);
        if (name === 'prep') {
          assert.equal(await page.$eval('.gm__field canvas:last-of-type', (el) => getComputedStyle(el).touchAction).catch(() => 'none'), 'none', 'the field owns its gestures');
          for (const b of await hitBoxes(page, HUD_TARGETS)) {
            if (b.missing) continue;
            assert.ok(b.w >= 34 && b.h >= 34 && Math.max(b.w, b.h) >= 40, `${dev}: ${b.sel} hit box ${b.w}×${b.h}`);
          }
        }
        assert.deepEqual(problems, [], `${dev} ${name}`);
        await page.close();
      }
    });
  }

  for (const dev of ['iphone14', 'ipad', 'laptop-touch']) {
    test(`${dev}: touch — tap the pen button and back, two-tap buy, long-press = detail`, async () => {
      const { page, problems } = await open(dev, 'phase=PREP');
      await page.waitForFunction(() => !!globalThis.__SP_VIEW__, { timeout: 15000 });
      const tap = async (sel) => {
        const r = await page.$eval(sel, (el) => { const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
        await page.touchscreen.tap(r.x, r.y);
        await sleep(350);
      };
      await tap('.enemybtn');
      await page.waitForFunction(() => document.querySelector('.gm')?.dataset.camera === 'pen', { timeout: 3000 });
      await sleep(400);
      await page.screenshot({ path: path.join(OUT, `device-${dev}-pen.png`) });
      await tap('.gtop__iconbtn');
      await page.waitForFunction(() => document.querySelector('.gm')?.dataset.camera === 'prep', { timeout: 3000 });
      assert.equal(await page.$('.tooltip.is-shown'), null, 'a tap never leaves a tooltip behind');
      // two taps buy
      const funds0 = await page.evaluate(() => globalThis.__MOCK__.S().priv.funds);
      await tap('.shopbar__cards .scard:not(.scard--sold):not(.is-disabled)');
      assert.ok(await page.$('.scard.is-armed'), 'first tap arms 确认购买');
      await tap('.scard.is-armed');
      const funds1 = await page.evaluate(() => globalThis.__MOCK__.S().priv.funds);
      assert.ok(funds1 < funds0, 'second tap buys');
      // long press on a card: its detail, no purchase / arming
      await page.keyboard.press('Escape');
      await sleep(200);
      const card = await page.$eval('.shopbar__cards .scard:not(.scard--sold):not(.is-disabled):not(.is-armed)', (el) => { const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
      await page.touchscreen.touchStart(card.x, card.y);
      await sleep(800);
      await page.touchscreen.touchEnd();
      await sleep(400);
      assert.ok(await page.$('.dpanel'), 'long press opens the detail card');
      assert.equal(await page.evaluate(() => globalThis.__MOCK__.S().priv.funds), funds1, 'long press never buys');
      assert.deepEqual(problems, []);
      await page.close();
    });
  }

  for (const dev of ['iphone14', 'phone-min', 'pixel7', 'ipad']) {
    test(`${dev}: 交流 pager — every emote cell, dot and ‹ › is hit at its centre; taps send / change the page`, async () => {
      const { page, problems } = await open(dev, 'phase=PREP');
      await page.evaluate(() => localStorage.removeItem('sp.pref.emoteTheme'));
      const tapAt = async (p) => { await page.touchscreen.tap(p.x, p.y); await sleep(350); };
      const openWheel = async () => {
        const b = await page.$eval('.ewheel__btn', (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
        await tapAt(b);
        await page.waitForSelector('.ewheel__panel');
        await sleep(450); // the panel's pop-in animation
      };
      await openWheel();
      const hits = await page.evaluate(() => {
        const own = (el, sel) => {
          const r = el.getBoundingClientRect();
          const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return t?.closest(sel) === el ? null : `${el.getAttribute('aria-label')} → ${t ? `${t.tagName}.${t.className} ${t.getAttribute('aria-label') || ''}` : 'nothing'}`;
        };
        return [...document.querySelectorAll('.ewheel__item')].map((el) => own(el, '.ewheel__item'))
          .concat([...document.querySelectorAll('.ewheel__dot')].map((el) => own(el, '.ewheel__dot')))
          .concat([...document.querySelectorAll('.ewheel__nav')].map((el) => own(el, '.ewheel__nav')))
          .filter(Boolean);
      });
      assert.deepEqual(hits, [], `${dev}: controls covered by a neighbour's hit area`);
      // each dot opens its own page — the last one first: dot 1 used to act as ‹ from the last page
      const dots = await page.$$eval('.ewheel__dot', (els) => els.map((el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }));
      for (const i of [dots.length - 1, ...dots.keys()]) {
        await tapAt(dots[i]);
        assert.equal(await page.$$eval('.ewheel__dot', (els) => els.findIndex((d) => d.classList.contains('is-on'))), i, `${dev}: dot ${i + 1}`);
      }
      await tapAt(dots[0]);
      // the bottom corners of page 1 send (they sat under the enlarged ‹ / › hit areas)
      for (const idx of [3, 5]) {
        if (!(await page.$('.ewheel__panel'))) await openWheel();
        const c = await page.$$eval('.ewheel__item', (els, k) => { const r = els[k].getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, page: document.querySelector('.ewheel__dot.is-on')?.getAttribute('aria-label') }; }, idx);
        assert.match(c.page, /1\/6/, 'page 1');
        await tapAt(c);
        assert.equal(await page.$('.ewheel__panel'), null, `${dev}: a tap on emote #${idx + 1} sends it (the panel closes)`);
        await sleep(1100); // chatCD
      }
      assert.deepEqual(problems, []);
      await page.close();
    });
  }

  for (const dev of ['phone-min', 'iphone14']) {
    test(`${dev}: the left detail card leaves the corner buttons (⚙ 📖 ⛶) usable`, async () => {
      const { page, problems } = await open(dev, 'phase=PREP');
      // not a card that completes a merge: it lights its elite's board tile, and the card moves to the right slot when that
      // tile lies under the left one (screens/game.js dSide, DESIGN §20.11) — 20–40 ms after it opened on the left, at
      // 640×360 for the mock's first card, so the left card was caught only sometimes and the check below saw the right one
      const card = await page.$eval('.shopbar__cards .scard:not(.scard--sold):not(.is-disabled):not(.is-merge)', (el) => { const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
      await page.touchscreen.tap(card.x, card.y);
      await page.waitForSelector('.dpanel:not(.dpanel--right)', { timeout: 3000 });
      await sleep(400);
      assert.equal(await page.$('.dpanel.dpanel--right'), null, `${dev}: the card stays in the left slot`);
      const covered = await page.evaluate(() => [...document.querySelectorAll('.gm__corner .gm__gear')].map((el) => {
        const r = el.getBoundingClientRect();
        const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return t && el.contains(t) ? null : `${el.getAttribute('aria-label') || el.className} under ${t?.className}`;
      }).filter(Boolean));
      await page.screenshot({ path: path.join(OUT, `device-${dev}-detail-corner.png`) });
      assert.deepEqual(covered, []);
      assert.deepEqual(problems, []);
      await page.close();
    });
  }

  for (const dev of ['iphone14', 'phone-min', 'ipad']) {
    test(`${dev}: title → lobby → room with taps (the on-screen flow before a match fits and responds)`, async () => {
      // a fresh profile: another device's saved session (same origin) would resume straight into its room
      const ctx = await browser.createBrowserContext();
      const { page, problems } = await open(dev, '/', { ctx });
      const tapText = async (sel, text) => {
        const r = await page.evaluate((s, t) => {
          const el = [...document.querySelectorAll(s)].find((x) => !t || x.textContent.includes(t));
          if (!el) return null;
          const b = el.getBoundingClientRect();
          return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
        }, sel, text);
        assert.ok(r, `${sel} ${text || ''}`);
        await page.touchscreen.tap(r.x, r.y);
        await sleep(350);
      };
      await tapText('.title-login input');
      await page.keyboard.type('凯尔希');
      await tapText('.title-login button', '开始');
      await page.waitForSelector('.lobby-screen', { timeout: 15000 }).catch(async (err) => {
        await page.screenshot({ path: path.join(OUT, `device-${dev}-lobby-FAILED.png`) });
        throw err;
      });
      await sleep(400);
      await page.screenshot({ path: path.join(OUT, `device-${dev}-lobby.png`) });
      assert.deepEqual(await layoutProblems(page), [], `${dev} lobby`);
      await tapText('.mode-card', '同盟模拟');
      await tapText('[data-testid="alliance-create"]');
      await page.waitForSelector('.room-bar__right', { timeout: 15000 });
      await sleep(500);
      await page.screenshot({ path: path.join(OUT, `device-${dev}-room.png`) });
      assert.deepEqual(await layoutProblems(page), [], `${dev} room`);
      assert.deepEqual(problems, []);
      await page.close();
      await ctx.close();
    });
  }

  test('safe-area insets (notch on the left): the HUD moves in, the field stays full-bleed', async () => {
    const { page, problems } = await open('iphone14', 'phase=PREP');
    await page.addStyleTag({ content: ':root { --sa-l: 47px !important; --sa-r: 0px !important; --sa-b: 21px !important; }' });
    await sleep(300);
    const r = await page.evaluate(() => {
      const box = (s) => { const b = document.querySelector(s)?.getBoundingClientRect(); return b ? { left: b.left, bottom: b.bottom, right: b.right } : null; };
      return { hud: box('.gm__hud'), field: box('.gm__field'), exit: box('.gtop__exit'), corner: box('.gm__corner') };
    });
    assert.equal(Math.round(r.hud.left), 47);
    assert.equal(Math.round(r.field.left), 0, 'the board stays full-bleed');
    assert.ok(r.exit.left >= 47, `exit button clear of the notch (${r.exit.left})`);
    assert.ok(r.corner.bottom <= 390 - 21 + 0.5, 'corner buttons clear of the home indicator');
    await page.screenshot({ path: path.join(OUT, 'device-iphone14-notch.png') });
    // review regression: a top inset moves the in-match toasts under the top bar once (not twice: margin + top)
    await page.addStyleTag({ content: ':root { --sa-t: 20px !important; }' });
    await page.evaluate(() => import('/js/ui/toasts.js').then((m) => m.toast('整备区已满', 'warn')));
    await page.waitForSelector('.toast');
    const t = await page.evaluate(() => ({
      host: document.querySelector('.toast-host').getBoundingClientRect().top,
      rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
    }));
    assert.ok(Math.abs(t.host - (1.34 * t.rem + 20)) <= 1.5, `toast host at ${t.host} (expected ${1.34 * t.rem + 20})`);
    assert.deepEqual(problems, []);
    await page.close();
  });

  test('交流 button: the label never runs into the robot icon (desktop sizes, phones, CJK 12 px minimum font size)', async () => {
    const puppeteer = (await import('puppeteer-core')).default;
    const { mkdtempSync, mkdirSync: mk, writeFileSync, rmSync } = await import('node:fs');
    const os = await import('node:os');
    const prof = mkdtempSync(path.join(os.tmpdir(), 'sp-minfont-'));
    mk(path.join(prof, 'Default'), { recursive: true });
    // Chrome / Edge in Chinese locales clamp text to 12 px (webkit.webprefs.minimum_font_size)
    writeFileSync(path.join(prof, 'Default', 'Preferences'), JSON.stringify({ webkit: { webprefs: { minimum_font_size: 12, minimum_logical_font_size: 12 } } }));
    const b12 = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'], userDataDir: prof });
    try {
      for (const b of [browser, b12]) {
        for (const [w, h, touch] of [[1280, 720], [1366, 657], [1920, 1080], [2560, 1440], [844, 390, true], [640, 360, true]]) {
          const page = await b.newPage();
          await page.emulate({ viewport: { width: w, height: h, deviceScaleFactor: 1, isMobile: !!touch, hasTouch: !!touch, isLandscape: true }, userAgent: await b.userAgent() });
          await seedReleaseRead(page);
          await page.goto(`${base}/dev/game-mock.html?shot=1&render=fallback&phase=PREP`, { waitUntil: 'networkidle0' });
          await page.waitForSelector('.ewheel__btn');
          await sleep(300);
          const m = await page.$eval('.ewheel__btn', (btn) => {
            const r = btn.getBoundingClientRect();
            const lab = btn.querySelector('.ewheel__label');
            const range = document.createRange();
            range.selectNodeContents(lab);
            const t = range.getBoundingClientRect();
            const icon = btn.querySelector('.icon, svg');
            const ir = icon ? icon.getBoundingClientRect() : null;
            return { sprite: btn.classList.contains('has-sprite'), l: r.left, w: r.width, right: r.right, tl: t.left, tr: t.right, iconRight: ir ? ir.right : null, fs: parseFloat(getComputedStyle(lab).fontSize) };
          });
          const where = `${b === b12 ? 'min-font 12 ' : ''}${w}×${h}`;
          // sprite: the robot + chevron end at x = 79/151 of the button; CSS fallback: after the icon
          const iconEnd = m.sprite ? m.l + m.w * (80 / 151) : m.iconRight;
          assert.ok(m.tl >= iconEnd - 0.5, `${where}: label starts at ${m.tl.toFixed(1)} < icon end ${iconEnd.toFixed(1)} (font ${m.fs}px)`);
          assert.ok(m.tr <= m.right + 0.5, `${where}: label spills out of the button`);
          await page.close();
        }
      }
    } finally {
      await b12.close();
      try { rmSync(prof, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  test('portrait phone: the rotate hint covers the page', async () => {
    const page = await browser.newPage();
    await page.emulate({ viewport: { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true }, userAgent: IOS_UA });
    await seedReleaseRead(page);
    await page.goto(`${base}/`, { waitUntil: 'networkidle0' });
    await sleep(400);
    assert.equal(await page.$eval('.rotate-hint', (el) => getComputedStyle(el).display), 'grid');
    await page.screenshot({ path: path.join(OUT, 'device-portrait-rotate.png') });
    await page.close();
    // review regression: a narrow desktop window (half a 1080p screen, portrait monitor) cannot be "rotated" — no hint
    const desk = await browser.newPage();
    await desk.setViewport({ width: 900, height: 1000 });
    await seedReleaseRead(desk);
    await desk.goto(`${base}/`, { waitUntil: 'networkidle0' });
    await desk.waitForSelector('.title-screen', { timeout: 10000 });
    assert.equal(await desk.$eval('.rotate-hint', (el) => getComputedStyle(el).display), 'none', 'desktop keeps the game');
    await desk.close();
  });

  test('graceful degradation: no WebGL → the DOM view (with a notice); no local-client art → CSS look-alikes', async () => {
    const puppeteer = (await import('puppeteer-core')).default;
    const nogl = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-webgl', '--disable-webgl2', '--disable-3d-apis'] });
    try {
      const { page, problems } = await open('ipad', 'phase=PREP', { b: nogl });
      await page.waitForFunction(() => globalThis.__SP_VIEW__?.kind === 'fallback', { timeout: 20000 });
      await page.waitForSelector('.toast', { timeout: 5000 });
      assert.match(await page.$eval('.toast-host', (el) => el.textContent), /简化视图/);
      await page.click('.enemybtn');
      await page.waitForSelector('.ff-pen__enemy', { timeout: 3000 });
      await page.screenshot({ path: path.join(OUT, 'device-ipad-nowebgl-pen.png') });
      assert.deepEqual(problems, []);
      await page.close();
    } finally {
      await nogl.close();
    }
    const { page, problems } = await open('iphone14', 'phase=PREP', { intercept: (u) => /\/data\/local-assets\.json|\/assets\/local\//.test(u) });
    const st = await page.evaluate(() => ({
      chk: document.querySelector('.enemybtn')?.classList.contains('has-sprite'),
      emo: document.querySelector('.ewheel__btn')?.classList.contains('has-sprite'),
      label: document.querySelector('.ewheel__label')?.textContent,
    }));
    assert.deepEqual(st, { chk: false, emo: false, label: '交流' }, 'CSS look-alikes');
    await page.screenshot({ path: path.join(OUT, 'device-iphone14-noart.png') });
    assert.deepEqual(await layoutProblems(page), []);
    assert.deepEqual(problems, []);
    await page.close();
  });
});
