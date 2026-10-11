// GitHub issue #8 item 1 (v0.1.1) in the browser: the strategy draft's 本局信息 dialog shows the briefing's disabled bonds
// and banned operators again (ui/matchInfo.js — the briefing's own blocks), against the real server in headless Chrome
// (puppeteer-core + the system Chrome, one Chrome per player). Opt-in:
//
//   SP_E2E=1 node --test test/ui/match-info.e2e.test.js
//
// 1. Solo 标准模拟 (the mode that switches 10 bonds off), desktop 1920×1080: the briefing's greyed bonds, badges, legend
//    and banned operators are read; in the draft 查看禁用盟约与干员 opens the dialog with exactly the same (and the 本局禁用
//    tooltip); Esc, a click outside — right over 确认选择 — and 关闭 close it without touching the highlighted band or
//    sending an intent; a strategy is then confirmed; in the first prep the in-game 本局信息 tab lists the same.
// 2. Co-op 绝境 with two humans — desktop (mouse) and a phone (touch, 844×390, then 756×366): both briefings agree with
//    the server; the waiting player's dialog shows whose turn it is with the live countdown and closes by itself when the
//    picker — whose own dialog counted its seconds down and was closed (Esc / 关闭) — confirms; on the next turn the
//    phone's dialog fits both screens, its text stays ≥ 9 px, a swipe scrolls its body to the banned operators and a tap
//    outside closes it; the player who already picked keeps its dialog open while the last strategy is confirmed, and
//    the end of the draft takes it away.
// Zero console errors / page errors / failed requests. Screenshots: test/e2e/out/match-info-*.png

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

describe('GitHub issue #8 item 1: 本局信息 in the strategy draft (real server, headless Chrome)', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome + assets) to run' }, () => {
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

  /** The bonds, badges, legend and banned operators as drawn under `root` (the briefing's column or the dialog). */
  const readInfo = (page, root) => page.evaluate((root) => {
    const scope = document.querySelector(root);
    if (!scope) return null;
    const data = globalThis.__SP__.data;
    const ids = [...new Set([...scope.querySelectorAll('[data-banned-chess]')].map((el) => el.dataset.bannedChess))]
      .sort((a, b) => data.lookup('chess', a).tier - data.lookup('chess', b).tier || a.localeCompare(b));
    return {
      bonds: [...scope.querySelectorAll('.brief-bond')].map((el) => ({
        id: el.dataset.bond, name: el.querySelector('.bond__name')?.textContent || '',
        off: el.classList.contains('is-off'), incomplete: el.classList.contains('is-incomplete'), partial: el.classList.contains('is-partial'),
        x: !!el.querySelector('.bond.is-disabled .bond__ban'), ban: el.querySelector('.brief-bond__ban')?.textContent.trim() || '',
      })),
      rows: [...scope.querySelectorAll('.brief-bonds .brief-h > span:first-child')].map((el) => el.textContent),
      legend: scope.querySelector('.brief-legend')?.textContent.trim() || '',
      count: scope.querySelector('.brief-banned__n')?.textContent.trim() || '',
      banned: ids.map((id) => data.lookup('chess', id).name),
      groups: [...scope.querySelectorAll('[data-banned-bond]')].map((el) => ({
        id: el.dataset.bannedBond, name: el.getAttribute('aria-label'),
        ids: [...el.querySelectorAll('[data-banned-chess]')].map((op) => op.dataset.bannedChess),
        marked: [...el.querySelectorAll('.uthumb')].every((op) => !!op.querySelector('.brief-banned__mark') && !!op.querySelector('.uthumb__tier')),
      })),
    };
  }, root);
  /** What the server says: greyed = the drawn set ∪ the mode's inactive bonds; banned names by tier. */
  const truth = (page) => page.evaluate(() => {
    const { store, data } = globalThis.__SP__;
    const pub = store.get().match.public;
    const mode = data.get('config')?.modes?.[pub.modeId];
    const greyed = [...new Set([...(pub.drawnDisabledBonds || []), ...(mode?.inactiveBondIds || [])])].sort();
    const chess = pub.bannedChess.map((id) => data.lookup('chess', id)).filter(Boolean);
    const ordered = chess.slice().sort((a, b) => b.tier - a.tier);
    const groups = data.list('bonds').slice().sort((a, b) => a.bondOrder - b.bondOrder || a.identifier - b.identifier)
      .map((b) => ({ id: b.bondId, name: b.name, ids: ordered.filter((c) => c.bonds.includes(b.bondId)).map((c) => c.chessId), marked: true }))
      .filter((g) => g.ids.length);
    return { greyed, off: (mode?.inactiveBondIds || []).slice().sort(), tiers: chess.map((c) => c.tier), groups,
      names: chess.slice().sort((a, b) => a.tier - b.tier || a.chessId.localeCompare(b.chessId)).map((c) => c.name) };
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
    await page.waitForSelector('.brief__right .brief-banned', { visible: true, timeout: 15000 });
    await sleep(600);
    const brief = await readInfo(page, '.brief__right');
    const want = await truth(page);
    assert.deepEqual(want.off, [...OFF_FUNNY].sort(), '标准模拟 switches the official 10 bonds off');
    assert.deepEqual(greyedOf(brief), want.greyed, 'the briefing greys D ∪ the mode\'s inactive bonds');
    assert.deepEqual(brief.banned, want.names, 'the briefing\'s banned operators, by tier');
    assert.deepEqual(brief.groups, want.groups, 'each alliance lists exactly its banned operators, with tier and ban marks');
    assert.equal(brief.count, String(want.names.length));
    assert.match(brief.legend, /或本模式禁用/);
    // 0.2.3 text-size settings must also scale the alliance rows introduced by this PR.
    const banFonts = () => page.evaluate(() => ['.brief-banned__n', '.brief-banned__bond .bond__name']
      .map((sel) => parseFloat(getComputedStyle(document.querySelector(sel)).fontSize)));
    const smallFonts = await banFonts();
    await page.evaluate(async () => (await import('/js/ui/settings.js')).updateSettings({ textSize: 'xl' }));
    const largeFonts = await banFonts();
    assert.ok(largeFonts.every((size, i) => size > smallFonts[i] * 1.25), `banned count and alliance names grow: ${smallFonts} → ${largeFonts}`);
    await page.evaluate(async () => (await import('/js/ui/settings.js')).updateSettings({ textSize: 'sm' }));
    await shot(page, 'solo-briefing');
    await page.$eval('.brief__right', (el) => {
      el.scrollTop += el.querySelector('.brief-banned').getBoundingClientRect().top - el.getBoundingClientRect().top - 8;
    });
    await shot(page, 'solo-briefing-bans');

    await press(p, '.brief__foot .btn--primary', '准备就绪');
    await waitSt(page, (s) => s.phase === 'BAND_DRAFT', 'band draft');
    await page.waitForSelector('[data-testid="match-info-open"]', { visible: true, timeout: 10000 });
    await shot(page, 'solo-draft');
    const sel0 = await selBand(page);
    assert.ok(sel0, 'a highlighted band');
    const req0 = (await intents(page)).length;

    // open: the very same blocks, the same tip; nothing sent
    await openDialog(p);
    const dlg = await readInfo(page, '.minfo-dlg');
    assert.deepEqual(dlg, brief, 'the dialog shows exactly the briefing\'s bonds, badges, legend and banned operators');
    assert.deepEqual(dlg.rows, ['核心盟约', '附加盟约']);
    assert.ok(dlg.bonds.filter((b) => b.off).every((b) => b.x), 'every greyed disc carries the ✕');
    const arcane = await centre(page, '.minfo-dlg .brief-bond[data-bond="arcaneShip"] .bond__disc');
    await page.mouse.move(arcane.x, arcane.y);
    await page.waitForSelector('.tooltip.is-shown', { visible: true, timeout: 3000 });
    assert.equal(await page.$eval('.tooltip.is-shown', (el) => el.textContent), '奥术：本局禁用（该盟约不会激活）');
    const status = await page.$eval('[data-testid="match-info-status"]', (el) => el.textContent.trim());
    assert.equal(status, '轮到你决策', 'solo: untimed — no seconds');
    const box = await page.$eval('.minfo-dlg', (el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; });
    assert.ok(box.top >= 0 && box.bottom <= 1080 && box.left >= 0 && box.right <= 1920, `inside the screen ${JSON.stringify(box)}`);
    const fits = await page.$eval('.minfo-dlg .modal__body', (el) => ({ horizontal: el.scrollWidth <= el.clientWidth + 1, overflow: getComputedStyle(el).overflowY }));
    assert.ok(fits.horizontal && fits.overflow === 'auto', 'desktop: alliance rows wrap and the full list can scroll');
    await shot(page, 'solo-dialog');

    // Esc
    await page.mouse.move(5, 5);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.minfo-dlg'), { timeout: 3000 });
    // a click outside the box, right over 确认选择: closes, confirms nothing
    await openDialog(p);
    const confirmPt = await centre(page, '.draft-detail__btns .btn--primary');
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
    await page.waitForFunction(() => !document.querySelector('.pbanner'), { timeout: 10000 }); // the 休整期 banner has played
    await press(p, '.gtop__iconbtn');
    await page.waitForSelector('.edrawer .ibanned', { visible: true, timeout: 5000 });
    const tab = await page.evaluate(() => ({
      off: [...document.querySelectorAll('.edrawer .ibond.is-off')].map((el) => el.querySelector(':scope > span:not([class])')?.textContent || ''),
      ban: Object.fromEntries([...document.querySelectorAll('.edrawer .ibond')].map((el) => [el.querySelector(':scope > span:not([class])')?.textContent || '', el.querySelector('.ibond__ban')?.textContent.trim() || ''])),
      count: document.querySelector('.edrawer .ihead small')?.textContent.trim() || '',
    }));
    assert.deepEqual(tab.off.sort(), brief.bonds.filter((b) => b.off).map((b) => b.name).sort(), 'the same greyed bonds');
    for (const b of brief.bonds) if (b.ban) assert.equal(tab.ban[b.name], b.ban, `${b.name}: the same badge`);
    const ingame = await readInfo(page, '.edrawer');
    assert.deepEqual(ingame.banned, brief.banned, 'the same banned operators');
    assert.deepEqual(ingame.groups, brief.groups, 'the same alliance/operator rows in-game');
    assert.equal(tab.count, brief.count);
    await shot(page, 'solo-ingame-tab');
    const firstId = ingame.groups[0].ids[0];
    await press(p, `.edrawer [data-banned-chess="${firstId}"]`);
    await page.waitForSelector('.dpanel', { visible: true, timeout: 5000 });
    const detailName = await page.$eval('.dpanel', (el) => el.textContent);
    const expectedName = await page.evaluate((id) => globalThis.__SP__.data.lookup('chess', id).name, firstId);
    assert.ok(detailName.includes(expectedName), 'a grouped banned portrait still opens its operator detail');
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
      await p.page.waitForSelector('.brief__right .brief-banned', { timeout: 15000 });
    }
    await sleep(500);
    const briefs = new Map();
    for (const p of [a, b]) briefs.set(p, await readInfo(p.page, '.brief__right'));
    const want = await truth(a.page);
    assert.deepEqual(want.off, [], '绝境 switches no bond off');
    assert.equal(want.greyed.length, 7, '3 core + 4 add-on bonds drawn');
    for (const [p, info] of briefs) {
      assert.deepEqual(greyedOf(info), want.greyed, `${p.name}: briefing greyed`);
      assert.deepEqual(info.banned, want.names, `${p.name}: briefing banned`);
      assert.deepEqual(info.groups, want.groups, `${p.name}: briefing alliance/operator correspondence`);
      if (p.phone) {
        const rowsFit = await p.page.evaluate(() => {
          const rows = document.querySelector('.brief-banned__rows');
          const name = rows.querySelector('.bond__name');
          return { namePx: parseFloat(getComputedStyle(name).fontSize), width: rows.scrollWidth <= rows.clientWidth + 1,
            portraitPx: rows.querySelector('.uthumb').getBoundingClientRect().width };
        });
        assert.ok(rowsFit.namePx >= 10 && rowsFit.portraitPx >= 32 && rowsFit.width, `phone briefing: readable rows without horizontal overflow ${JSON.stringify(rowsFit)}`);
      }
      assert.doesNotMatch(info.legend, /本模式禁用/);
    }
    assert.deepEqual(briefs.get(b), briefs.get(a), 'both players see the same briefing');
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
          badge: px('.brief-bond__ban'), status: vis('[data-testid="match-info-status"]'), close: vis('[data-testid="match-info-close"]'),
        };
      });
      assert.ok(lay.box[0] >= 0 && lay.box[1] >= 0 && lay.box[2] <= lay.vw && lay.box[3] <= lay.vh, `${w}×${h}: the dialog inside the screen ${JSON.stringify(lay.box)}`);
      assert.ok(lay.name >= 9 && lay.legend >= 9 && lay.badge >= 9 && lay.title >= 14, `${w}×${h}: readable text ${JSON.stringify(lay)}`);
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
        const rows = document.querySelectorAll('.minfo-dlg .brief-banned__row');
        const g = rows[rows.length - 1].getBoundingClientRect();
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
});
