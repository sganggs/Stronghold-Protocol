// GitHub #8 item 1 and #484 in the browser: the strategy draft's 本局信息 dialog shows the briefing's leader,
// battlefield, special enemies, disabled bonds and banned operators again, against the real server in headless Chrome
// (puppeteer-core + the system Chrome, one Chrome per player). Opt-in:
//
//   SP_E2E=1 node --test test/ui/match-info.e2e.test.js
//
// 1. Solo 标准模拟 (the mode that switches 10 bonds off), desktop 1920×1080: the briefing's greyed bonds, badges, legend
//    and banned operators are read; in the draft 本局信息 opens the dialog with exactly the same (and the 本局禁用
//    tooltip); Esc, a click outside — right over 确认选择 — and 关闭 close it without touching the highlighted band or
//    sending an intent; a strategy is then confirmed; in the first prep the in-game 本局信息 tab lists the same.
// 2. Co-op 绝境 with two humans — desktop (mouse) and a phone (touch, 844×390, then 756×366): both briefings agree with
//    the server; the waiting player's dialog shows whose turn it is with the live countdown and closes by itself when the
//    picker — whose own dialog counted its seconds down and was closed (Esc / 关闭) — confirms; on the next turn the
//    phone's dialog fits both screens, its text stays ≥ 9 px, a long press on a special enemy's icon shows its
//    description, a swipe scrolls its body to the banned operators and a tap outside closes it; the player who already
//    picked keeps its dialog open while the last strategy is confirmed, and the end of the draft takes it away.
// 3. Solo 绝境 at 1000–1280 px: a special enemy's description shows in the tooltip on hover and on keyboard focus of its
//    icon (the maintainer's decision of 2026-10-22; the icon's aria-describedby points at the same text); the dialog fits
//    and scrolls at every width and closing it keeps the highlighted strategy.
// 4. The dev mock's 确认本局信息 and 本局信息 dialog at 1440×900 (hover) and on phones 667×375 / 844×390 (long press): each
//    special enemy's tooltip sits 8 px above or below its own icon, over it, inside the dialog and the screen, and covers
//    nothing of the leader block (§35.18's leftover: in the dialog it was centred over the whole row, over the 战场 line).
// Zero console errors / page errors / failed requests. Screenshots: test/e2e/out/match-info-*.png

import { seedReleaseRead } from '../helpers/releaseNotes.js';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'test/e2e/out');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME) && existsSync(path.join(ROOT, 'public/assets'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ARGS = ['--no-sandbox', '--no-first-run', '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--mute-audio'];
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
const PHONE = (width, height) => ({ width, height, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true });
const OFF_FUNNY = ['lateranoShip', 'egirShip', 'kazimierzShip', 'skillfulShip', 'arcaneShip', 'miraShip', 'investShip', 'raidShip', 'soloShip', 'suntShip'];

describe('GitHub #8 and #484: 本局信息 in the strategy draft (real server, headless Chrome)', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome + assets) to run' }, () => {
  let srv;
  let base;
  let puppeteer;
  const browsers = [];

  before(async () => {
    const { startServer } = await import('../../server/index.js');
    puppeteer = (await import('puppeteer-core')).default;
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    base = `http://127.0.0.1:${srv.port}`;
    mkdirSync(OUT, { recursive: true });
  });
  after(async () => {
    for (const b of browsers) {
      const proc = b.process();
      await b.close().catch(() => {});
      // Chrome's helpers (its crash handler, the macOS updater) can inherit its stderr and outlive it: drop our ends of
      // its pipes, or this test process never exits
      for (const s of [proc?.stdout, proc?.stderr]) s?.destroy();
    }
    await srv?.close();
  });

  /** One player: its own Chrome with one always-visible page, past the title screen, in the lobby. */
  async function player(name, { phone = null } = {}) {
    const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ARGS, protocolTimeout: 90000 });
    browsers.push(browser);
    const [first] = await browser.pages();
    const page = first || await browser.newPage();
    if (phone) await page.emulate({ viewport: phone, userAgent: ANDROID_UA });
    else await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    const problems = [];
    // the optional Google Fonts stylesheet (index.html: never render-blocking, system fallbacks) is the only external request
    const external = (url) => /fonts\.(googleapis|gstatic)\.com/.test(url || '');
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const url = m.location()?.url || '';
      if (/Failed to load resource/.test(m.text()) && external(url)) return;
      problems.push(`console: ${m.text()} @ ${url}`);
    });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('requestfailed', (r) => {
      const err = r.failure()?.errorText || '';
      if (external(r.url())) return;
      if (err === 'net::ERR_ABORTED' && /\.(mp3|ogg|wav|m4a)(\?|$)/.test(r.url())) return; // media element swaps
      problems.push(`requestfailed: ${r.url()} ${err}`);
    });
    page.on('response', (r) => { if (r.status() >= 400) problems.push(`http ${r.status()}: ${r.url()}`); });
    await page.evaluateOnNewDocument((n) => { localStorage.setItem('sp.name', n); sessionStorage.setItem('sp.entered', '1'); }, name);
    await seedReleaseRead(page);
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => globalThis.__SP__?.store.get().connection.status === 'online' && !!document.querySelector('.lobby-screen'), { timeout: 30000 });
    // record every intent the UI sends (gameActions looks net.request up per call)
    await page.evaluate(() => {
      const n = globalThis.__SP__.net;
      const orig = n.request.bind(n);
      globalThis.__req = [];
      n.request = (t, f, o) => { globalThis.__req.push(t); return orig(t, f, o); };
    });
    return { browser, page, problems, phone: !!phone, name };
  }

  const st = (page) => page.evaluate(() => {
    const s = globalThis.__SP__.store.get();
    const pub = s.match.public;
    return {
      me: s.me.playerId, room: s.room?.code ?? null, phase: pub?.phase ?? null, turn: pub?.draft?.turn ?? null,
      picks: pub?.draft?.picks ?? {}, bandId: s.match.private?.bandId ?? null, modeId: pub?.modeId ?? null,
    };
  });
  async function waitSt(page, pred, what, timeout = 30000) {
    const t0 = Date.now();
    let last = null;
    while (Date.now() - t0 < timeout) { last = await st(page); if (pred(last)) return last; await sleep(150); }
    throw new Error(`timed out waiting for ${what}: ${JSON.stringify(last)}`);
  }
  const shot = (page, name) => page.screenshot({ path: path.join(OUT, `match-info-${name}.png`) });
  const intents = (page) => page.evaluate(() => (globalThis.__req || []).slice());
  /** Centre of the first visible match (client px), or null. */
  const centre = (page, sel, text = null) => page.evaluate((sel, text) => {
    for (const el of document.querySelectorAll(sel)) {
      if (text && !(el.textContent || '').includes(text)) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 1 && r.height > 1) return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    return null;
  }, sel, text);
  /** A click with the mouse, or a tap on a touch phone. */
  async function press(p, sel, text = null) {
    let pt = null;
    for (let i = 0; i < 60 && !pt; i++) { pt = await centre(p.page, sel, text); if (!pt) await sleep(100); }
    assert.ok(pt, `${p.name}: ${sel}${text ? ` "${text}"` : ''} on screen`);
    if (p.phone) await p.page.touchscreen.tap(pt.x, pt.y); else await p.page.mouse.click(pt.x, pt.y);
    await sleep(250);
  }
  const dialogOpen = (page) => page.evaluate(() => !!document.querySelector('.minfo-dlg'));

  /** The announced enemies, bonds, badges, legend and banned operators in the briefing or dialog. */
  const readInfo = (page, root) => page.evaluate((root) => {
    const scope = document.querySelector(root);
    if (!scope) return null;
    return {
      leader: {
        name: scope.querySelector('.brief-boss__name')?.textContent || '',
        when: scope.querySelector('.brief-boss__when')?.textContent || '',
        abilities: [...scope.querySelectorAll('.brief-boss__abil li')].map(el => el.textContent),
        icon: scope.querySelector('.brief-boss__img')?.getAttribute('src') || '',
      },
      battlefield: scope.querySelector('.brief-stage')?.textContent || '',
      // (the description: the tooltip's text, also what the icon's aria-describedby points at — the maintainer's
      // decision of 2026-10-22)
      factions: [...scope.querySelectorAll('.brief-faction')].map(el => {
        const icon = el.querySelector('.brief-faction__icon');
        return {
          type: el.dataset.faction, name: el.querySelector('.brief-faction__text b')?.textContent || '',
          desc: document.getElementById(icon?.getAttribute('aria-describedby') || '')?.textContent || '',
          label: icon?.getAttribute('aria-label') || '', focusable: icon?.tabIndex === 0,
          icon: el.querySelector('img')?.getAttribute('src') || '',
        };
      }),
      emptyFactions: scope.querySelector('.brief-factions .t-dim')?.textContent || '',
      bonds: [...scope.querySelectorAll('.brief-bond')].map((el) => ({
        id: el.dataset.bond, name: el.querySelector('.bond__name')?.textContent || '',
        off: el.classList.contains('is-off'), incomplete: el.classList.contains('is-incomplete'), partial: el.classList.contains('is-partial'),
        x: !!el.querySelector('.bond.is-disabled .bond__ban'), ban: el.querySelector('.brief-bond__ban')?.textContent.trim() || '',
      })),
      rows: [...scope.querySelectorAll('.brief-bonds .brief-h > span:first-child')].map((el) => el.textContent),
      legend: scope.querySelector('.brief-legend')?.textContent.trim() || '',
      count: scope.querySelector('.brief-banned__n')?.textContent.trim() || '',
      banned: [...scope.querySelectorAll('.brief-banned__grid .uthumb')].map((el) => el.getAttribute('title')),
    };
  }, root);
  /** What the server says: greyed = the drawn set ∪ the mode's inactive bonds; banned names by tier. */
  const truth = (page) => page.evaluate(() => {
    const { store, data } = globalThis.__SP__;
    const pub = store.get().match.public;
    const mode = data.get('config')?.modes?.[pub.modeId];
    const greyed = [...new Set([...(pub.drawnDisabledBonds || []), ...(mode?.inactiveBondIds || [])])].sort();
    const chess = pub.bannedChess.map((id) => data.lookup('chess', id)).filter(Boolean);
    return { greyed, off: (mode?.inactiveBondIds || []).slice().sort(), tiers: chess.map((c) => c.tier), names: chess.slice().sort((a, b) => a.tier - b.tier).map((c) => c.name) };
  });
  const greyedOf = (info) => info.bonds.filter((b) => b.off).map((b) => b.id).sort();
  const selBand = (page) => page.evaluate(() => document.querySelector('.dband.is-sel .dband__name')?.textContent || null);

  async function openDialog(p) {
    await press(p, '[data-testid="match-info-open"]');
    await p.page.waitForSelector('.minfo-dlg .brief-banned', { visible: true, timeout: 5000 });
    await sleep(350); // the dialog's pop-in
  }

  test('solo 标准模拟 (desktop): the dialog = the briefing; Esc / outside / 关闭 leave the draft alone; confirm; the in-game tab agrees', { timeout: 240000 }, async () => {
    const p = await player('信息测试');
    const { page } = p;
    await page.evaluate(() => globalThis.__SP__.net.request('room.create', { mode: 'solo', difficulty: 'FUNNY' }));
    await waitSt(page, (s) => !!s.room, 'solo room');
    await page.evaluate(() => globalThis.__SP__.net.request('room.start', {}));
    const s0 = await waitSt(page, (s) => s.phase === 'INFO_CHECK', 'briefing');
    assert.equal(s0.modeId, 'mode_single_funny');
    await page.waitForSelector('.brief__main .brief-banned', { visible: true, timeout: 15000 });
    await sleep(600);
    const brief = await readInfo(page, '.brief__main');
    const want = await truth(page);
    assert.deepEqual(want.off, [...OFF_FUNNY].sort(), '标准模拟 switches the official 10 bonds off');
    assert.deepEqual(greyedOf(brief), want.greyed, 'the briefing greys D ∪ the mode\'s inactive bonds');
    assert.deepEqual(brief.banned, want.names, 'the briefing\'s banned operators, by tier');
    assert.equal(brief.count, String(want.names.length));
    assert.match(brief.legend, /或本模式禁用/);
    assert.ok(brief.leader.name, 'the leader is announced');
    const announcedTypes = await page.evaluate(() => globalThis.__SP__.store.get().match.public.factions);
    assert.deepEqual(brief.factions.map(f => f.type), announcedTypes, 'the announced special enemy types');
    if (!announcedTypes.length) assert.equal(brief.emptyFactions, '本局没有特训敌人');
    await shot(page, 'solo-briefing');

    await press(p, '.brief__foot .btn--primary', '准备就绪');
    await waitSt(page, (s) => s.phase === 'BAND_DRAFT', 'band draft');
    await page.waitForSelector('[data-testid="match-info-open"]', { visible: true, timeout: 10000 });
    assert.equal(await page.$eval('[data-testid="match-info-open"]', el => el.textContent.trim()), '本局信息');
    await shot(page, 'solo-draft');
    // (PR #643: the wall highlights nothing until a portrait is tapped; the tap opens the detail pane with 确认选择)
    await press(p, '.dband', '华法琳');
    await page.waitForSelector('.draft-detail__btns .btn--primary', { visible: true, timeout: 5000 });
    const sel0 = await selBand(page);
    assert.ok(sel0, 'a highlighted band');
    const req0 = (await intents(page)).length;

    // open: the very same blocks, the same tip; nothing sent
    await openDialog(p);
    const dlg = await readInfo(page, '.minfo-dlg');
    assert.deepEqual(dlg, brief, 'the dialog shows the same enemies, battlefield, bonds and banned operators as the briefing');
    assert.deepEqual(dlg.rows, ['核心盟约', '附加盟约']);
    assert.ok(dlg.bonds.filter((b) => b.off).every((b) => b.x), 'every greyed disc carries the ✕');
    const arcane = await centre(page, '.minfo-dlg .brief-bond[data-bond="arcaneShip"] .bond__disc');
    await page.mouse.move(arcane.x, arcane.y);
    await page.waitForSelector('.tooltip.is-shown', { visible: true, timeout: 3000 });
    assert.equal(await page.$eval('.tooltip.is-shown .tooltip__main', (el) => el.textContent), '奥术：本局禁用（该盟约不会激活）');
    const listed = await page.$$eval('.tooltip--aside .brief-bantip__txt b', els => els.map(e => e.textContent));
    const arcaneNames = await page.evaluate(() => {
      const { store, data } = globalThis.__SP__;
      return store.get().match.public.bannedChess.map(id => data.lookup('chess', id)).filter(c => c?.bonds?.includes('arcaneShip')).map(c => c.name).sort();
    });
    assert.deepEqual(listed.sort(), arcaneNames, 'the aside shows precisely this bond\'s banned members');
    const status = await page.$eval('[data-testid="match-info-status"]', (el) => el.textContent.trim());
    assert.equal(status, '轮到你决策', 'solo: untimed — no seconds');
    const box = await page.$eval('.minfo-dlg', (el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; });
    assert.ok(box.top >= 0 && box.bottom <= 1080 && box.left >= 0 && box.right <= 1920, `inside the screen ${JSON.stringify(box)}`);
    const fits = await page.$eval('.minfo-dlg .modal__body', (el) => el.scrollHeight <= el.clientHeight + 1);
    assert.ok(fits, 'desktop: everything visible without scrolling');
    await shot(page, 'solo-dialog');

    // Esc
    await page.mouse.move(5, 5);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.minfo-dlg'), { timeout: 3000 });
    // a click outside the box, right over 确认选择: closes, confirms nothing
    await openDialog(p);
    const confirmPt = await page.$eval('.draft-detail__btns .btn--primary', el => {
      const r = el.getBoundingClientRect();
      return { x: r.right - 8, y: r.top + r.height / 2 };
    });
    const inBox = await page.$eval('.minfo-dlg', (el, pt) => { const r = el.getBoundingClientRect(); return pt.x >= r.left && pt.x <= r.right && pt.y >= r.top && pt.y <= r.bottom; }, confirmPt);
    assert.equal(inBox, false, '确认选择 lies outside the dialog box (on its backdrop)');
    await page.mouse.click(confirmPt.x, confirmPt.y);
    await page.waitForFunction(() => !document.querySelector('.minfo-dlg'), { timeout: 3000 });
    await sleep(400);
    assert.equal((await st(page)).phase, 'BAND_DRAFT', 'the press on the backdrop confirmed nothing');
    // 关闭
    await openDialog(p);
    await press(p, '[data-testid="match-info-close"]', '关闭');
    await page.waitForFunction(() => !document.querySelector('.minfo-dlg'), { timeout: 3000 });
    assert.equal(await selBand(page), sel0, 'the highlighted band is untouched');
    assert.deepEqual((await intents(page)).slice(req0), [], 'no intent while looking');

    // the draft still works: highlight another strategy, confirm
    await press(p, '.dband', '阿米娅');
    assert.equal(await selBand(page), '阿米娅');
    await press(p, '.draft-detail__btns .btn--primary', '确认选择');
    const s1 = await waitSt(page, (s) => s.phase !== 'BAND_DRAFT', 'the draft to end');
    assert.equal(s1.bandId, 'band_amiya');

    // the in-game 本局信息 tab (left 🔍) lists the same greyed bonds, badges and banned operators (by tier)
    await waitSt(page, (s) => s.phase === 'PREP', 'the first prep', 60000);
    // the held 已选定策略 and 协议启动！ (screens/game.js DRAFT_HOLD_MS + BOOT_MIN_MS, inside BATTLE_CHECK) stay over the board first, then the HUD
    // comes in (PR #643: screens/game.js hudIn — .gm__hud.is-wait / .is-enter until its entry has played)
    await page.waitForFunction(() => !document.querySelector('.screen.draft, [data-testid="protocol-boot"]'), { timeout: 15000 });
    await page.waitForFunction(() => !!document.querySelector('.gm__hud') && !document.querySelector('.gm__hud.is-wait, .gm__hud.is-enter'), { timeout: 15000 });
    await page.waitForFunction(() => !document.querySelector('.pbanner'), { timeout: 10000 }); // the 休整期 banner has played
    await press(p, '.gtop__iconbtn');
    await page.waitForSelector('.edrawer .ibanned', { visible: true, timeout: 5000 });
    const tab = await page.evaluate(() => ({
      off: [...document.querySelectorAll('.edrawer .ibond.is-off')].map((el) => el.querySelector(':scope > span:not([class])')?.textContent || ''),
      ban: Object.fromEntries([...document.querySelectorAll('.edrawer .ibond')].map((el) => [el.querySelector(':scope > span:not([class])')?.textContent || '', el.querySelector('.ibond__ban')?.textContent.trim() || ''])),
      banned: [...document.querySelectorAll('.edrawer .ibanned .uthumb')].map((el) => el.getAttribute('title')),
      count: document.querySelector('.edrawer .ihead small')?.textContent.trim() || '',
    }));
    assert.deepEqual(tab.off.sort(), brief.bonds.filter((b) => b.off).map((b) => b.name).sort(), 'the same greyed bonds');
    for (const b of brief.bonds) if (b.ban) assert.equal(tab.ban[b.name], b.ban, `${b.name}: the same badge`);
    assert.deepEqual(tab.banned, brief.banned, 'the same banned operators, in the same (tier) order');
    assert.equal(tab.count, brief.count);
    await shot(page, 'solo-ingame-tab');
    assert.deepEqual(p.problems, []);
  });

  test('1000–1280px windows: match information fits and scrolls; closing restores strategy selection', { timeout: 180000 }, async () => {
    const p = await player('窗口测试');
    const { page } = p;
    await page.evaluate(() => globalThis.__SP__.net.request('room.create', { mode: 'solo', difficulty: 'HARD' }));
    await waitSt(page, s => !!s.room, 'solo room');
    await page.evaluate(() => globalThis.__SP__.net.request('room.start', {}));
    await waitSt(page, s => s.phase === 'INFO_CHECK', 'briefing');
    await page.waitForSelector('.brief__main .brief-banned', { visible: true, timeout: 15000 });
    await sleep(500);
    const brief = await readInfo(page, '.brief__main');
    assert.equal(brief.factions.length, 3, 'dire announces three special enemy types');
    // the description in the tooltip (the maintainer's decision of 2026-10-22): on hover, then on keyboard focus of the icon
    const first = brief.factions[0];
    assert.ok(first.desc && first.focusable && first.label === first.name, JSON.stringify(first));
    const tipText = () => page.$eval('.tooltip.is-shown', (el) => el.textContent);
    const noTip = () => page.waitForFunction(() => !document.querySelector('.tooltip.is-shown'), { timeout: 3000 });
    const iconPt = await centre(page, '.brief__main .brief-faction__icon');
    await page.mouse.move(iconPt.x, iconPt.y);
    await page.waitForSelector('.tooltip.is-shown', { visible: true, timeout: 3000 });
    assert.equal(await tipText(), first.desc, 'hover: the description');
    await page.mouse.move(5, 5);
    await noTip();
    await page.$eval('.brief__main .brief-faction__icon', (el) => el.focus());
    await page.waitForSelector('.tooltip.is-shown', { visible: true, timeout: 3000 });
    assert.equal(await tipText(), first.desc, 'keyboard focus: the description');
    await page.$eval('.brief__main .brief-faction__icon', (el) => el.blur());
    await noTip();
    await press(p, '.brief__foot .btn--primary', '准备就绪');
    await waitSt(page, s => s.phase === 'BAND_DRAFT', 'band draft');
    // (PR #643: nothing is highlighted until a portrait is tapped; the first one stays in view at every width)
    await press(p, '.dband');
    await page.waitForSelector('.draft-detail__btns .btn--primary', { visible: true, timeout: 5000 });
    const selected = await selBand(page);
    assert.ok(selected, 'a highlighted band');
    const requests = (await intents(page)).length;

    for (const [width, height] of [[1000, 600], [1001, 600], [1024, 768], [1120, 630], [1280, 720]]) {
      await page.setViewport({ width, height, deviceScaleFactor: 1 });
      await sleep(250);
      await openDialog(p);
      assert.deepEqual(await readInfo(page, '.minfo-dlg'), brief, width + 'px: all briefing information is retained');
      await shot(page, 'window-' + width + '-dialog');
      const layout = await page.$eval('.minfo-dlg', el => {
        const r = el.getBoundingClientRect();
        return { box: [r.left, r.top, r.right, r.bottom], fits: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight };
      });
      assert.ok(layout.fits, width + 'px: dialog stays inside the window ' + JSON.stringify(layout.box));

      const clipped = await page.evaluate(() => {
        const box = document.querySelector('.minfo-dlg');
        const body = box.querySelector('.modal__body');
        const failures = [];
        if (body.scrollWidth > body.clientWidth + 1) failures.push('horizontal overflow');
        const selectors = '.brief-boss__name, .brief-boss__when, .brief-boss__abil li, .brief-stage__name, .brief-faction__text b, .brief-bonds .brief-h, .brief-bond .bond__name, .brief-banned .brief-h, .brief-banned__grid .uthumb';
        for (const el of box.querySelectorAll(selectors)) {
          el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          const r = el.getBoundingClientRect(), b = body.getBoundingClientRect();
          if (r.left < b.left - 1 || r.right > b.right + 1 || r.top < b.top - 1 || r.bottom > b.bottom + 1) failures.push(el.textContent.trim() || el.getAttribute('title'));
        }
        for (const sel of ['[data-testid="match-info-close"]', '[data-testid="match-info-status"]']) {
          const r = box.querySelector(sel).getBoundingClientRect();
          if (r.left < 0 || r.right > innerWidth || r.top < 0 || r.bottom > innerHeight) failures.push(sel);
        }
        return failures;
      });
      assert.deepEqual(clipped, [], width + 'px: scrolling reveals every name, description, ability and banned operator');
      await shot(page, 'window-' + width + '-scrolled');
      await press(p, '[data-testid="match-info-close"]', '关闭');
      await page.waitForFunction(() => !document.querySelector('.minfo-dlg'), { timeout: 3000 });
      assert.equal(await selBand(page), selected, width + 'px: closing preserves the selected strategy');
      const interactive = await page.evaluate(() => {
        const reachable = sel => {
          const el = document.querySelector(sel), r = el.getBoundingClientRect();
          return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight
            && el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
        };
        return { strategy: reachable('.dband.is-sel'), confirm: reachable('.draft-detail__btns .btn--primary') };
      });
      assert.deepEqual(interactive, { strategy: true, confirm: true }, width + 'px: strategy and confirmation controls are reachable after closing');
    }
    assert.deepEqual((await intents(page)).slice(requests), [], 'reading match information sends no game intent');
    await press(p, '.draft-detail__btns .btn--primary', '确认选择');
    await waitSt(page, s => s.phase !== 'BAND_DRAFT', 'confirmation ends the draft');
    assert.deepEqual(p.problems, []);
  });

  test('co-op 绝境, desktop + phone: live countdown in the dialog, a turn change closes it, phones fit and scroll, the draft completes', { timeout: 300000 }, async (t) => {
    const a = await player('桌面博士');
    const b = await player('手机博士', { phone: PHONE(844, 390) });
    await a.page.evaluate(() => globalThis.__SP__.net.request('room.create', { mode: 'coop', difficulty: 'HARD' }));
    const code = (await waitSt(a.page, (s) => !!s.room, 'co-op room')).room;
    await b.page.evaluate((c) => globalThis.__SP__.net.request('room.join', { code: c }), code);
    await waitSt(b.page, (s) => s.room === code, 'joined');
    await b.page.evaluate(() => globalThis.__SP__.net.request('room.ready', { ready: true }));
    await sleep(300);
    await a.page.evaluate(() => globalThis.__SP__.net.request('room.start', {}));
    for (const p of [a, b]) {
      const s = await waitSt(p.page, (x) => x.phase === 'INFO_CHECK', `${p.name}: briefing`);
      assert.equal(s.modeId, 'mode_multi_hard');
      await p.page.waitForSelector('.brief__main .brief-banned', { timeout: 15000 });
    }
    await sleep(500);
    const briefs = new Map();
    for (const p of [a, b]) briefs.set(p, await readInfo(p.page, '.brief__main'));
    const want = await truth(a.page);
    assert.deepEqual(want.off, [], '绝境 switches no bond off');
    assert.equal(want.greyed.length, 7, '3 core + 4 add-on bonds drawn');
    for (const [p, info] of briefs) {
      assert.deepEqual(greyedOf(info), want.greyed, `${p.name}: briefing greyed`);
      assert.deepEqual(info.banned, want.names, `${p.name}: briefing banned`);
      assert.doesNotMatch(info.legend, /本模式禁用/);
    }
    assert.deepEqual(briefs.get(b), briefs.get(a), 'both players see the same briefing');
    const announcedTypes = await a.page.evaluate(() => globalThis.__SP__.store.get().match.public.factions);
    assert.equal(announcedTypes.length, 3, 'dire announces three special enemy types');
    assert.deepEqual(briefs.get(a).factions.map(f => f.type), announcedTypes);
    assert.ok(briefs.get(a).factions.every(f => f.name && f.desc), 'every special enemy type has its name and description');
    await shot(b.page, 'coop-phone-briefing-844');
    for (const p of [a, b]) await press(p, '.brief__foot .btn--primary', '准备就绪');
    for (const p of [a, b]) await waitSt(p.page, (s) => s.phase === 'BAND_DRAFT' && !!s.turn, `${p.name}: band draft`);

    const turn = (await st(a.page)).turn;
    const meA = (await st(a.page)).me;
    const picker = turn === meA ? a : b;
    const waiter = picker === a ? b : a;
    t.diagnostic(`first pick: the ${picker.phone ? 'phone' : 'desktop'} player`);
    await waiter.page.waitForSelector('[data-testid="match-info-open"]', { visible: true, timeout: 10000 });
    if (waiter.phone) await shot(waiter.page, 'coop-phone-draft-844');

    // the waiting player looks first: the briefing's blocks, the picker's live countdown
    await openDialog(waiter);
    assert.deepEqual(await readInfo(waiter.page, '.minfo-dlg'), briefs.get(waiter), `${waiter.name}: the dialog = the briefing`);
    const wStatus = await waiter.page.$eval('[data-testid="match-info-status"]', (el) => el.textContent.trim());
    assert.match(wStatus, new RegExp(`^${picker.name} 决策中\\s*\\d+s$`), `whose turn and its seconds: ${wStatus}`);
    await shot(waiter.page, waiter.phone ? 'coop-phone-dialog-waiting-844' : 'coop-dialog-waiting');

    // the picker: its own dialog says 轮到你决策 with the running clock; Esc; then it confirms with the dialog closed
    const reqP = (await intents(picker.page)).length;
    const selP = await selBand(picker.page);
    await openDialog(picker);
    assert.deepEqual(await readInfo(picker.page, '.minfo-dlg'), briefs.get(picker), `${picker.name}: the dialog = the briefing`);
    const secsOf = async (p) => Number((await p.page.$eval('[data-testid="match-info-status"]', (el) => el.textContent)).match(/(\d+)s/)?.[1]);
    const s1 = await secsOf(picker);
    assert.match(await picker.page.$eval('[data-testid="match-info-status"]', (el) => el.textContent.trim()), /^轮到你决策\s*\d+s$/);
    await sleep(2200);
    const s2 = await secsOf(picker);
    assert.ok(s1 > 0 && s2 < s1, `the countdown keeps running in the dialog (${s1} → ${s2})`);
    await shot(picker.page, picker.phone ? 'coop-phone-dialog-picker-844' : 'coop-dialog-picker');
    if (picker.phone) {
      await press(picker, '[data-testid="match-info-close"]', '关闭');
    } else {
      await picker.page.keyboard.press('Escape');
    }
    await picker.page.waitForFunction(() => !document.querySelector('.minfo-dlg'), { timeout: 3000 });
    assert.equal(await selBand(picker.page), selP, 'the highlighted band survived the dialog');
    assert.deepEqual((await intents(picker.page)).slice(reqP).filter((t) => t !== 'g.bandFocus'), [], 'nothing but the draft\'s own focus report');
    assert.equal(await dialogOpen(waiter.page), true, 'the waiting player is still looking');
    await press(picker, '.dband', '阿米娅');
    await press(picker, '.draft-detail__btns .btn--primary', '确认选择');
    await waitSt(picker.page, (s) => !!s.bandId, `${picker.name}: picked`);

    // the turn moves on: the waiting player's dialog closes by itself, its draft is in front of it
    await waitSt(waiter.page, (s) => s.turn === s.me, `${waiter.name}: its turn`);
    await waiter.page.waitForFunction(() => !document.querySelector('.minfo-dlg'), { timeout: 4000 });
    const last = waiter;
    const done = picker;

    // the phone (whichever role it has now: deciding, or waiting after its pick) at 844×390, then 756×366: inside the
    // screen, ≥ 9 px text, the countdown and 关闭 in view, the body scrolls to the banned operators; a tap outside closes it
    const ph = b;
    for (const [w, h] of [[844, 390], [756, 366]]) {
      if (w === 756) { await ph.page.setViewport(PHONE(756, 366)); await sleep(500); }
      await openDialog(ph);
      const lay = await ph.page.evaluate(() => {
        const boxEl = document.querySelector('.minfo-dlg');
        const r = boxEl.getBoundingClientRect();
        const body = boxEl.querySelector('.modal__body');
        const px = (sel) => parseFloat(getComputedStyle(boxEl.querySelector(sel)).fontSize);
        const vis = (sel) => { const e = boxEl.querySelector(sel).getBoundingClientRect(); return e.top >= r.top - 1 && e.bottom <= r.bottom + 1 && e.left >= r.left - 1 && e.right <= r.right + 1; };
        return {
          box: [r.left, r.top, r.right, r.bottom], vw: innerWidth, vh: innerHeight, scrolls: body.scrollHeight > body.clientHeight + 4,
          overflow: getComputedStyle(body).overflowY, name: px('.bond__name'), legend: px('.brief-legend'), title: px('.modal__title'),
          badge: px('.brief-bond__ban'), enemyName: px('.brief-faction__text b'),
          bossName: px('.brief-boss__name'), bossAbilities: px('.brief-boss__abil'),
          horizontalOverflow: body.scrollWidth > body.clientWidth + 1,
          status: vis('[data-testid="match-info-status"]'), close: vis('[data-testid="match-info-close"]'),
        };
      });
      assert.ok(lay.box[0] >= 0 && lay.box[1] >= 0 && lay.box[2] <= lay.vw && lay.box[3] <= lay.vh, `${w}×${h}: the dialog inside the screen ${JSON.stringify(lay.box)}`);
      assert.ok(lay.name >= 9 && lay.legend >= 9 && lay.badge >= 9 && lay.title >= 14, `${w}×${h}: readable text ${JSON.stringify(lay)}`);
      assert.ok(lay.enemyName >= 12 && lay.bossName >= 16 && lay.bossAbilities >= 10, `${w}×${h}: readable enemy information`);
      // a long press on a special enemy's icon shows its description (≥ 10 px, inside the screen); it expires after the release
      const fdesc = briefs.get(ph).factions[0].desc;
      const fPt = await centre(ph.page, '.minfo-dlg .brief-faction__icon');
      await ph.page.touchscreen.touchStart(fPt.x, fPt.y);
      await sleep(700);
      await ph.page.touchscreen.touchEnd();
      await ph.page.waitForSelector('.tooltip.is-shown', { visible: true, timeout: 3000 });
      const tip = await ph.page.$eval('.tooltip.is-shown', (el) => {
        const r = el.getBoundingClientRect();
        return { text: el.textContent, px: parseFloat(getComputedStyle(el).fontSize), inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight };
      });
      assert.deepEqual(tip, { text: fdesc, px: tip.px, inside: true }, `${w}×${h}: the long press shows the description`);
      assert.ok(tip.px >= 10, `${w}×${h}: the tooltip's text ${tip.px} px`);
      await ph.page.waitForFunction(() => !document.querySelector('.tooltip.is-shown'), { timeout: 4000 });
      assert.equal(lay.horizontalOverflow, false, `${w}×${h}: no horizontal scrolling`);
      assert.ok(lay.status && lay.close, `${w}×${h}: the status line and 关闭 stay in view`);
      assert.ok(lay.scrolls && lay.overflow === 'auto', `${w}×${h}: the body scrolls`);
      assert.deepEqual(await readInfo(ph.page, '.minfo-dlg'), briefs.get(ph), `${w}×${h}: the dialog = the briefing`);
      const phStatus = await ph.page.$eval('[data-testid="match-info-status"]', (el) => el.textContent.trim());
      if (ph === last) assert.match(phStatus, /^轮到你决策\s*\d+s$/);
      else assert.equal(phStatus, '已选择「阿米娅」，等待其他博士');
      await shot(ph.page, `coop-phone-dialog-${w}`);
      // a finger swipe up the body brings the banned operators into view
      const bodyPt = await centre(ph.page, '.minfo-dlg .modal__body');
      const top0 = await ph.page.$eval('.minfo-dlg .modal__body', (el) => el.scrollTop);
      await ph.page.touchscreen.touchStart(bodyPt.x, bodyPt.y + 60);
      for (let i = 1; i <= 8; i++) { await ph.page.touchscreen.touchMove(bodyPt.x, bodyPt.y + 60 - i * 22); await sleep(16); }
      await ph.page.touchscreen.touchEnd();
      await sleep(500);
      const top1 = await ph.page.$eval('.minfo-dlg .modal__body', (el) => el.scrollTop);
      assert.ok(top1 > top0, `${w}×${h}: the swipe scrolled the body (${top0} → ${top1})`);
      await ph.page.$eval('.minfo-dlg .modal__body', (el) => { el.scrollTop = el.scrollHeight; });
      await sleep(200);
      const bannedVisible = await ph.page.evaluate(() => {
        const body = document.querySelector('.minfo-dlg .modal__body').getBoundingClientRect();
        const g = document.querySelector('.minfo-dlg .brief-banned__grid').getBoundingClientRect();
        return g.top >= body.top - 1 && g.bottom <= body.bottom + 1;
      });
      assert.ok(bannedVisible, `${w}×${h}: the banned operators scrolled into view`);
      await shot(ph.page, `coop-phone-dialog-${w}-scrolled`);
      // a tap outside the box (the order list on the left) closes it and changes nothing
      const sel = await selBand(ph.page);
      const req = (await intents(ph.page)).length;
      const outside = await ph.page.$eval('.minfo-dlg', (el) => { const r = el.getBoundingClientRect(); return { x: Math.max(4, r.left / 2), y: r.top + r.height / 2 }; });
      await ph.page.touchscreen.tap(outside.x, outside.y);
      await ph.page.waitForFunction(() => !document.querySelector('.minfo-dlg'), { timeout: 3000 });
      assert.equal(await selBand(ph.page), sel, `${w}×${h}: the highlighted band is untouched`);
      assert.deepEqual((await intents(ph.page)).slice(req), [], `${w}×${h}: no intent`);
    }
    await shot(ph.page, 'coop-phone-draft-756');

    // the player who already picked keeps its dialog open; the last picker confirms a free strategy (阿米娅 is 队友已选) —
    // the end of the draft takes the open dialog away with the screen
    await openDialog(done);
    await press(last, '.dband', '华法琳');
    await press(last, '.draft-detail__btns .btn--primary', '确认选择');
    for (const p of [a, b]) {
      const s = await waitSt(p.page, (x) => x.phase !== 'BAND_DRAFT', `${p.name}: the draft to end`);
      assert.ok(s.bandId, `${p.name} has a strategy`);
    }
    assert.deepEqual([(await st(done.page)).bandId, (await st(last.page)).bandId], ['band_amiya', 'band_bldsk']);
    await done.page.waitForFunction(() => !document.querySelector('.minfo-dlg'), { timeout: 4000 });
    assert.equal(await dialogOpen(a.page) || await dialogOpen(b.page), false, 'no dialog outlives the draft');
    await sleep(500);
    assert.deepEqual([...a.problems, ...b.problems], []);
  });

  test('the 特训敌人 tooltip at its own icon in both places (dev mock; desktop hover, phone long press)', { timeout: 180000 }, async () => {
    const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ARGS, protocolTimeout: 90000 });
    browsers.push(browser);
    const views = { '1440x900': { width: 1440, height: 900, deviceScaleFactor: 1 }, '667x375': PHONE(667, 375), '844x390': PHONE(844, 390) };
    for (const [view, viewport] of Object.entries(views)) {
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      await page.setBypassServiceWorker(true);
      await page.setViewport(viewport);
      const problems = [];
      page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)/.test(m.location()?.url || '')) problems.push(`console: ${m.text()}`); });
      page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
      await page.evaluateOnNewDocument(() => { localStorage.setItem('sp.name', '凯尔希'); sessionStorage.setItem('sp.entered', '1'); });
      for (const [phase, scope] of [['INFO_CHECK', '.brief__main'], ['BAND_DRAFT', '.minfo-dlg']]) {
        await seedReleaseRead(page);
        await page.goto(`${base}/dev/game-mock.html?shot=1&render=fallback&phase=${phase}`, { waitUntil: 'networkidle0', timeout: 60000 });
        if (phase === 'BAND_DRAFT') {
          await page.waitForSelector('[data-testid="match-info-open"]', { visible: true, timeout: 20000 });
          await page.waitForFunction(() => !document.querySelector('[data-testid="turn-banner"]'), { timeout: 8000 }).catch(() => {});
          await sleep(300);
          await page.$eval('[data-testid="match-info-open"]', (el) => el.click());
          await page.waitForSelector('.minfo-dlg .brief-faction__icon', { visible: true, timeout: 8000 });
        } else await page.waitForSelector('.brief__main .brief-faction__icon', { visible: true, timeout: 20000 });
        await sleep(900);
        const n = await page.$$eval(`${scope} .brief-faction__icon`, (els) => els.length);
        assert.ok(n >= 2, `${view} ${phase}: the mock's special enemies (${n})`);
        for (let i = 0; i < n; i++) {
          const pt = await page.evaluate((scope, i) => {
            const el = document.querySelectorAll(`${scope} .brief-faction__icon`)[i];
            el.scrollIntoView({ block: 'center' });
            const r = el.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
          }, scope, i);
          await sleep(250);
          if (viewport.hasTouch) { await page.touchscreen.touchStart(pt.x, pt.y); await sleep(700); } else await page.mouse.move(pt.x, pt.y);
          await page.waitForSelector('.tooltip.is-shown', { visible: true, timeout: 3000 });
          await sleep(200); // its fade-in
          const at = await page.evaluate((scope, i) => {
            const box = (el) => el.getBoundingClientRect();
            const icon = box(document.querySelectorAll(`${scope} .brief-faction__icon`)[i]);
            const tipEl = document.querySelector('.tooltip.is-shown');
            const tip = box(tipEl);
            const dlg = document.querySelector(scope).closest('.modal__box');
            const area = dlg ? box(dlg) : { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
            const over = (a, b) => a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;
            const lead = [...document.querySelectorAll(`${scope} .brief-boss, ${scope} .brief-boss__text > *`)].map(box);
            const gap = tip.bottom <= icon.top + 0.5 ? icon.top - tip.bottom : tip.top >= icon.bottom - 0.5 ? tip.top - icon.bottom : -1;
            return { text: tipEl.textContent, desc: document.getElementById(document.querySelectorAll(`${scope} .brief-faction__icon`)[i].getAttribute('aria-describedby'))?.textContent,
              gap: Math.round(gap), overIcon: tip.left < icon.right && tip.right > icon.left, leader: lead.length,
              inside: tip.left >= area.left - 0.5 && tip.right <= area.right + 0.5 && tip.top >= area.top - 0.5 && tip.bottom <= area.bottom + 0.5
                && tip.left >= 0 && tip.top >= 0 && tip.right <= innerWidth && tip.bottom <= innerHeight,
              coversLeader: lead.some((r) => over(tip, r)) };
          }, scope, i);
          const what = `${view} ${phase} #${i}: ${JSON.stringify(at)}`;
          assert.equal(at.text, at.desc, what);
          assert.ok(at.gap >= 6 && at.gap <= 12, `next to its icon — ${what}`);
          assert.ok(at.overIcon && at.inside && at.leader >= 3, what);
          assert.equal(at.coversLeader, false, `clear of the leader block — ${what}`);
          if (i === 0) await shot(page, `faction-tip-${phase === 'BAND_DRAFT' ? 'dialog' : 'briefing'}-${view}`);
          if (viewport.hasTouch) await page.touchscreen.touchEnd(); else await page.mouse.move(2, 2);
          await page.waitForFunction(() => !document.querySelector('.tooltip.is-shown'), { timeout: 4000 });
        }
      }
      assert.deepEqual(problems, [], view);
      await ctx.close();
    }
  });
});
