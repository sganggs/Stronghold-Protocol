// Browser check of the match top bar (PR #827) through the dev mock (opt-in, needs Chrome, ~40 s):
//   SP_E2E=1 CHROME_PATH=… node --test test/ui/match-topbar.e2e.test.js
//
// Asserted: the HUD waits hidden only while 协议启动！ shows and comes in as soon as it leaves — not waiting for the round
// plate — with the round-1 回合开始 kettles playing in the capsule as it comes in (the maintainer's decision of 2026-10-21),
// and the shop bar does not slide in a second time when the entry ends; the pending-leak red of the LP (GitHub #479) wins
// over the top bar's white; a capsule scene stays on the capsule pill inside the plate; the official deco type
// (hudPanel/frame_deco_txt*, aria-hidden; the same words as text without the art pack, which gives way on a narrow
// screen — the sprites fit and stay, apart); a boss round on phone landscape
// leaves the corners clear; reduced motion never hides the HUD. Static counterpart: test/ui/match-topbar.test.js.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('match top bar (headless Chrome)', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome) to run' }, () => {
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

  /**
   * The mock at `phase` in a fresh context, past the service worker; `noart` answers /assets/ui/ with 404 (the CI view,
   * also as /assets/~<hash>/ui/), `reduce` asks for reduced motion, `phone` is a touch screen.
   */
  async function open({ phase = 'PREP', variant = '', noart = false, reduce = false, width = 1920, height = 1080, phone = false } = {}) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setBypassServiceWorker(true);
    await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: phone, hasTouch: phone });
    const problems = [];
    page.on('console', (m) => { if (m.type() === 'error' && !(noart && /Failed to load resource/.test(m.text()))) problems.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    await page.evaluateOnNewDocument(() => performance.setResourceTimingBufferSize(5000));
    if (reduce) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    if (noart) {
      await page.setRequestInterception(true);
      page.on('request', (r) => (/\/assets\/(?:~[0-9a-f]{16}\/)?ui\//.test(r.url()) ? r.respond({ status: 404, body: '' }) : r.continue()));
    }
    await page.goto(`${base}/dev/game-mock.html?shot=1&render=fallback&phase=${phase}${variant ? `&variant=${variant}` : ''}`, { waitUntil: 'networkidle0', timeout: 60000 });
    await page.waitForSelector('.gtop__cap', { timeout: 30000 });
    if (!noart) {
      await page.waitForFunction(() => {
        const names = performance.getEntriesByType('resource').map((e) => e.name);
        return names.filter((n) => /hudPanel\/trans_/.test(n)).length >= 9 && names.filter((n) => /battleReady\/|settle\/common_logo/.test(n)).length >= 6;
      }, { timeout: 15000 });
    }
    await sleep(300);
    return { page, problems, context };
  }

  /** The deco type on screen (its sprite or text box has a size) and the pairs whose boxes cross. */
  const decoLayout = (page) => page.evaluate(() => {
    const boxes = [...document.querySelectorAll('.gtop__deco')].map((d) => {
      const el = d.querySelector('img, .gtop__decotxt');
      const r = el ? el.getBoundingClientRect() : { width: 0, height: 0 };
      return { k: d.dataset.deco, r, on: r.width > 0 && r.height > 0 };
    }).filter((b) => b.on);
    const overlaps = [];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i].r, b = boxes[j].r;
      if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) overlaps.push(`${boxes[i].k}×${boxes[j].k}`);
    }
    return { shown: boxes.map((b) => b.k), overlaps };
  });

  // first, and in one page (a later page of the same browser was once seen getting sprites past the interception)
  test('without the art pack: the deco type as text, hidden from screen readers; no 协议启动！ screen, so the HUD never waits', async () => {
    const { page, problems, context } = await open({ noart: true });
    const deco = await page.$$eval('.gtop__deco', (els) => els.map((e) => ({ hidden: e.getAttribute('aria-hidden'), text: e.textContent.trim(), img: !!e.querySelector('img') })));
    assert.deepEqual(deco, [
      { hidden: 'true', text: 'RHODES ISLAND TERMINAL SERVICE', img: false },
      { hidden: 'true', text: 'STRONGHOLD PROTOCOL', img: false },
      { hidden: 'true', text: 'RHODES ISLAND TERMINAL SERVICE', img: false },
    ]);
    // a narrow screen (phone landscape): the text stand-in, wider than its sprites, gives way rather than run into itself
    // over the narrowed band (§35.18); back at full width it is there again
    await page.setViewport({ width: 667, height: 375, deviceScaleFactor: 1 });
    await sleep(300);
    assert.deepEqual(await decoLayout(page), { shown: [], overlaps: [] }, '667 px: no deco text, nothing overlapping');
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    await sleep(300);
    assert.deepEqual((await decoLayout(page)).shown, ['txt1', 'txt2', 'txt3']);
    await page.evaluate(() => globalThis.__MOCK__.setPhase('BATTLE_CHECK'));
    await sleep(400);
    assert.equal(await page.$('[data-testid="protocol-boot"]'), null);
    assert.equal(await page.$eval('.gm__hud', (e) => e.className), 'gm__hud');
    assert.deepEqual(problems, []);
    await context.close();
  });

  test('the official deco type: frame_deco_txt1 / txt2 / txt3 drawn, aria-hidden, no text of its own', async () => {
    const { page, problems, context } = await open();
    const deco = await page.$$eval('.gtop__deco', (els) => els.map((e) => ({
      k: e.dataset.deco, hidden: e.getAttribute('aria-hidden'), ok: e.querySelector('img')?.naturalWidth > 0,
      src: (e.querySelector('img')?.getAttribute('src') || '').replace(/^.*\//, ''), text: e.textContent.trim(),
    })));
    assert.deepEqual(deco.map((d) => [d.k, d.hidden, d.ok, d.src, d.text]), [
      ['txt1', 'true', true, 'frame_deco_txt1.png', ''], ['txt2', 'true', true, 'frame_deco_txt2.png', ''], ['txt3', 'true', true, 'frame_deco_txt3.png', ''],
    ]);
    const pseudo = await page.$eval('.gtop__band', (e) => [getComputedStyle(e, '::before').content, getComputedStyle(e, '::after').content]);
    assert.deepEqual(pseudo, ['none', 'none'], 'no CSS-generated words on the band');
    // the sprites fit a phone's narrowed band: all three stay, none over another
    await page.setViewport({ width: 667, height: 375, deviceScaleFactor: 1 });
    await sleep(300);
    assert.deepEqual(await decoLayout(page), { shown: ['txt1', 'txt2', 'txt3'], overlaps: [] }, '667 px: the official sprites, apart');
    assert.deepEqual(problems, []);
    await context.close();
  });

  test('协议启动！ → 回合开始: the HUD waits under the screen, comes in as it leaves, with the round-1 kettles; the shop slides in once', async () => {
    const { page, problems, context } = await open();
    await page.evaluate(() => globalThis.__MOCK__.setPhase('BATTLE_CHECK'));
    await page.waitForSelector('[data-testid="protocol-boot"]', { timeout: 3000 });
    await sleep(200);
    assert.equal(await page.$eval('.gm__hud', (e) => e.className), 'gm__hud is-wait');
    assert.equal(await page.$eval('.gtop', (e) => getComputedStyle(e).visibility), 'hidden');
    // a recorder in the page: every frame's state while the screen leaves and the HUD comes in
    await page.evaluate(() => {
      const log = [];
      globalThis.__topbarLog = log;
      const t0 = performance.now();
      const shopUp = () => document.getAnimations().filter((a) => a.animationName === 'shop-up' && a.playState === 'running').length;
      const tick = () => {
        const s = {
          leaving: !!document.querySelector('.pboot.is-leaving'),
          boot: !!document.querySelector('[data-testid="protocol-boot"]'),
          hud: document.querySelector('.gm__hud')?.className || '',
          cap: document.querySelector('.gtop__cap')?.className || '',
          kettles: document.querySelectorAll('.gtop__cap .capfx--wait .capfx__k').length,
          plate: !!document.querySelector('[data-testid="round-popup"]'),
          shopUp: shopUp(),
        };
        const last = log[log.length - 1];
        if (!last || Object.keys(s).some((k) => s[k] !== last[k])) log.push({ t: Math.round(performance.now() - t0), ...s });
        if (performance.now() - t0 < 6500) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      globalThis.__MOCK__.setPhase('ROUND_START');
    });
    await sleep(6800);
    const log = await page.evaluate(() => globalThis.__topbarLog);
    const at = (pred) => log.find(pred);
    const leave = at((s) => s.leaving);
    const enter = at((s) => s.hud.includes('is-enter'));
    const done = at((s) => enter && s.t > enter.t && !s.hud.includes('is-enter'));
    assert.ok(leave && enter && done, JSON.stringify(log));
    assert.ok(enter.t >= leave.t && enter.t - leave.t < 150, `comes in as 协议启动！ leaves (${leave.t} → ${enter.t} ms)`);
    assert.ok(!log.some((s) => s.t < leave.t && s.hud.includes('is-enter')), 'not before it leaves');
    assert.ok(enter.cap.includes('is-fx-wait') && enter.kettles === 3, `the round-1 kettles play as it comes in: ${JSON.stringify(enter)}`);
    const plate = at((s) => s.plate);
    assert.ok(plate && plate.t >= enter.t && !plate.hud.includes('is-wait'), 'the round plate shows over a visible top bar');
    assert.ok(done.t - enter.t >= 1100 && done.t - enter.t <= 1700, `the entry lasts ~1.2 s (${done.t - enter.t} ms)`);
    assert.ok(!log.some((s) => s.t > leave.t && s.hud.includes('is-wait') && !s.boot), 'never waits once the screen is gone');
    assert.ok(!log.some((s) => s.t >= done.t && s.shopUp > 0), `the shop bar does not slide in again: ${JSON.stringify(log.filter((s) => s.t >= done.t))}`);
    assert.equal(await page.$eval('.gtop', (e) => getComputedStyle(e).visibility), 'visible');
    assert.deepEqual(problems, []);
    await context.close();
  });

  test('real phase spacing: 协议启动！ inside the 3 s BATTLE_CHECK, so the round-1 kettles play over the bar and the entry ends before 准备', async () => {
    // the server's own spacing (data/config.json timers.battleCheck 3, 回合开始 2 s; DESIGN §35.18): 协议启动！ comes
    // DRAFT_HOLD_MS 0.7 s into BATTLE_CHECK, so 回合开始 follows it 2.3 s later, and 准备 2 s after that (the l2 review's
    // integration gate for decisions 5 and 6 — the frozen 回合开始 of the test above cannot show a scene cut short)
    const { page, problems, context } = await open();
    await page.evaluate(() => {
      const log = [];
      globalThis.__spacingLog = log;
      let t0 = null;
      const tick = () => {
        const boot = !!document.querySelector('[data-testid="protocol-boot"]');
        if (t0 == null && boot) {
          t0 = performance.now();
          setTimeout(() => { log.push({ t: Math.round(performance.now() - t0), mark: 'ROUND_START' }); globalThis.__MOCK__.setPhase('ROUND_START'); }, 2300);
          setTimeout(() => { log.push({ t: Math.round(performance.now() - t0), mark: 'PREP' }); globalThis.__MOCK__.setPhase('PREP'); }, 4300);
        }
        if (t0 != null) {
          const st = { boot, hud: document.querySelector('.gm__hud')?.className || '', cap: document.querySelector('.gtop__cap')?.className || '' };
          const last = log.filter((x) => !x.mark).pop();
          if (!last || last.boot !== st.boot || last.hud !== st.hud || last.cap !== st.cap) log.push({ t: Math.round(performance.now() - t0), ...st });
          if (performance.now() - t0 > 6500) return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      globalThis.__MOCK__.setPhase('BATTLE_CHECK');
    });
    await sleep(7200);
    const log = await page.evaluate(() => globalThis.__spacingLog);
    const prep = log.find((x) => x.mark === 'PREP');
    const kettles = log.find((x) => !x.mark && x.cap.includes('is-fx-wait') && !x.hud.includes('is-wait'));
    const rest = log.find((x) => !x.mark && x.cap.includes('is-fx-rest'));
    const enter = log.find((x) => !x.mark && x.hud.includes('is-enter'));
    const done = enter && log.find((x) => !x.mark && x.t > enter.t && !x.hud.includes('is-enter'));
    assert.ok(prep && kettles && rest && enter && done, JSON.stringify(log));
    assert.ok(rest.t - kettles.t >= 1500, `the round-1 kettles play ${rest.t - kettles.t} ms before 准备's scene: ${JSON.stringify(log)}`);
    assert.ok(done.t <= prep.t + 50, `the entry is over (${done.t} ms) before 准备 (${prep.t} ms), so the plate does not drop in twice`);
    assert.deepEqual(problems, []);
    await context.close();
  });

  test('reduced motion: the HUD is never hidden or animated in', async () => {
    const { page, problems, context } = await open({ reduce: true });
    await page.evaluate(() => globalThis.__MOCK__.setPhase('BATTLE_CHECK'));
    await page.waitForSelector('[data-testid="protocol-boot"]', { timeout: 3000 });
    await sleep(200);
    assert.equal(await page.$eval('.gm__hud', (e) => e.className), 'gm__hud');
    await page.evaluate(() => globalThis.__MOCK__.setPhase('ROUND_START'));
    await page.waitForFunction(() => !document.querySelector('[data-testid="protocol-boot"]'), { timeout: 6000 });
    assert.equal(await page.$eval('.gm__hud', (e) => e.className), 'gm__hud');
    assert.deepEqual(problems, []);
    await context.close();
  });

  test('the LP: a pending leak stays red over the top bar\'s white (GitHub #479); white without one', async () => {
    const { page, problems, context } = await open({ phase: 'UNITE', variant: 'leaker' });
    await page.waitForSelector('.gtop .lp.is-pending', { timeout: 3000 });
    const colours = await page.evaluate(() => {
      const probe = document.createElement('i');
      probe.style.color = 'var(--red-premium)';
      document.body.append(probe);
      const red = getComputedStyle(probe).color;
      probe.remove();
      const lp = document.querySelector('.gtop .lp');
      return { red, val: getComputedStyle(lp.querySelector('.lp__val')).color, cls: lp.className };
    });
    assert.ok(!/lp--danger|lp--team/.test(colours.cls), colours.cls);
    assert.equal(colours.val, colours.red, 'the pending red');
    await page.evaluate(() => globalThis.__MOCK__.setPhase('PREP'));
    await page.waitForFunction(() => !document.querySelector('.gtop .lp.is-pending'), { timeout: 3000 });
    assert.equal(await page.$eval('.gtop .lp__val', (e) => getComputedStyle(e).color), 'rgb(238, 242, 242)');
    assert.deepEqual(problems, []);
    await context.close();
  });

  test('a capsule scene stays on the capsule pill, inside the plate\'s frame', async () => {
    const { page, problems, context } = await open();
    await page.evaluate(() => globalThis.__MOCK__.setPhase('COMBAT'));
    await page.waitForSelector('.gtop__cap .capfx--clash', { timeout: 3000 });
    const r = await page.evaluate(() => {
      const box = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; };
      return { fx: box('.gtop__cap .capfx'), pill: box('.gtop__cap > .capsule'), plate: box('.gtop__cap') };
    });
    const inside = (a, b, tol) => a.l >= b.l - tol && a.r <= b.r + tol && a.t >= b.t - tol && a.b <= b.b + tol;
    assert.ok(inside(r.fx, r.pill, 1), JSON.stringify(r));
    assert.ok(r.plate.b - r.plate.t - (r.fx.b - r.fx.t) > 8, `the scene is smaller than the plate: ${JSON.stringify(r)}`);
    assert.deepEqual(problems, []);
    await context.close();
  });

  for (const [width, height] of [[640, 360], [667, 375]]) {
    test(`a boss round on a ${width}×${height} phone: the corners clear the centre (solo clock + pause, 观战席 pill)`, async () => {
      const { page, problems, context } = await open({ phase: 'FINAL_ASSAULT', variant: 'boss,solo,spectators', width, height, phone: true });
      const m = await page.evaluate(() => {
        const shown = (s) => [...document.querySelectorAll(s)].filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.getBoundingClientRect());
        const c = document.querySelector('.gtop__center').getBoundingClientRect();
        return { left: Math.max(...shown('.gtop__left *').map((b) => b.right)), right: Math.min(...shown('.gtop__right *').map((b) => b.left)), c: [c.left, c.right] };
      });
      assert.ok(m.left <= m.c[0] && m.right >= m.c[1], JSON.stringify(m));
      assert.deepEqual(problems, []);
      await context.close();
    });
  }
});
