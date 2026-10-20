// Browser E2E of the 统计数据 page (public/js/screens/stats.js, ui/stats.js; PR #323 by @2321Robin, reworked for 0.2.2)
// against the real server, headless Chrome (puppeteer-core + system Chrome). Opt-in: SP_E2E=1 node --test test/ui/stats.e2e.test.js
//
// 1. A seeded history (records built from three REAL m.result payloads, test/fixtures/stats-results.json) on desktop
//    1920×1080 and a phone in landscape 844×390: the four tabs, the counting rule on screen (the match left in the first
//    round is listed as 中途退出 / 不计入统计 and left out of the totals), the row click that re-views a settlement and
//    its 返回统计, Esc, the title screen's entry; zero console errors. Screenshots: test/e2e/out/stats-*.png
// 2. The data actions: 导出 hands out a file the page itself imports again (nothing new), a corrupt file and a newer
//    one are refused with a message and change nothing, 清空 asks first (the confirm dialog sits above the overlay and
//    Esc closes only it), unreadable storage is set aside with a notice, a newer build's data is never overwritten.
// 3. The real flows: a solo match given up in the briefing is history only; one given up after round 1 counts (1 round
//    cleared, the server's own rule); a match played to its settlement is recorded once — also after a reload (the
//    lobby replays m.result).

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, sleep, startRealServer, hasChrome, OUT } from '../e2e/client.mjs';
import { buildRecord, buildQuitRecord, createLiveMatch, observeMatch, STATS_VERSION } from '../../public/js/ui/stats.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ENABLED = process.env.SP_E2E === '1' && hasChrome();
const FIX = JSON.parse(readFileSync(path.join(ROOT, 'test/fixtures/stats-results.json'), 'utf8'));
const BANDS = Object.keys(JSON.parse(readFileSync(path.join(ROOT, 'data/bands.json'), 'utf8')));
const NOW = Date.parse('2026-10-08T21:30:00');
const DAY = 86400000;

/** n settled records from the real payloads (cycling solo / 4-player co-op, difficulties, outcomes, bands) + two quit records. */
function seed(n = 24) {
  const recs = [];
  const names = ['solo-normal', 'coop4-hard', 'coop4-abyss'];
  for (let i = 0; i < n; i++) {
    const res = JSON.parse(JSON.stringify(FIX[names[i % 3]]));
    const solo = i % 3 === 0;
    const diff = ['FUNNY', 'NORMAL', 'HARD', 'ABYSS'][i % 4];
    const win = i % 5 < 2;
    Object.assign(res, { seed: 1000 + i, difficulty: diff, modeId: `mode_${solo ? 'single' : 'multi'}_${diff.toLowerCase()}`, victory: win, reason: win ? 'victory' : 'defeat', roundsPassed: win ? 14 : 4 + (i % 8), durationMs: (8 + (i % 13)) * 60000 });
    const me = res.players.find((p) => p.playerId === 'p_0');
    Object.assign(me, { bandId: BANDS[i % 7], victory: win, alive: win, roundsPassed: res.roundsPassed, title: i % 3 ? { id: `comment_${1 + (i % 6)}` } : null });
    recs.unshift(buildRecord(res, { myId: 'p_0', roomMode: solo ? 'solo' : 'coop', now: NOW - i * 0.6 * DAY }));
  }
  const state = (phase, round) => ({
    me: { playerId: 'p_0' }, room: { code: 'ABCD', mode: 'solo' },
    match: { public: { phase, round, lastRound: 14, modeId: 'mode_single_hard', difficulty: 'HARD', players: [{ playerId: 'p_0', seat: 0, name: 'Doctor', alive: true, lp: 30, bandId: BANDS[2] }] }, result: null },
  });
  const quit = (phase, round, t) => { const live = createLiveMatch(); observeMatch(live, state('INFO_CHECK', 0), t - 600000); return buildQuitRecord(state(phase, round), { live, now: t }); };
  recs.push(quit('PREP', 1, NOW - 2 * 3600e3), quit('PREP', 7, NOW - 1.3 * DAY));
  return { v: STATS_VERSION, records: recs.sort((a, b) => b.t - a.t) };
}

describe('统计数据 page (real server, headless Chrome)', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome) to run' }, () => {
  let srv;
  let puppeteer;
  const clients = [];

  before(async () => {
    puppeteer = (await import('puppeteer-core')).default;
    srv = await startRealServer();
    mkdirSync(OUT, { recursive: true });
  });
  after(async () => { for (const c of clients) await c.close(); await srv?.stop(); });

  /** A fresh browser on `base` with `sp.pref.stats` (a string) stored before the page loads. */
  async function open({ w = 1920, h = 1080, stored = null, entered = true, base = srv.base, lang = null, nickname = 'Doctor' } = {}) {
    const c = new Client(puppeteer, base, 'stats', { prefix: 'stats', w, h });
    clients.push(c);
    c.browser = await puppeteer.launch({
      executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
      args: ['--no-sandbox', '--mute-audio', '--force-device-scale-factor=1'],
    });
    const [first] = await c.browser.pages();
    c.page = first || await c.browser.newPage();
    await c.page.setViewport({ width: w, height: h, hasTouch: w < 1000, isMobile: w < 1000 });
    c.page.on('console', (m) => { if (m.type() === 'error') c.problems.push(`console: ${m.text()}`); });
    c.page.on('pageerror', (e) => c.problems.push(`pageerror: ${e.message}`));
    await c.page.evaluateOnNewDocument((stored, entered, lang, nickname) => {
      if (nickname !== null) localStorage.setItem('sp.name', nickname);
      if (entered) sessionStorage.setItem('sp.entered', '1');
      if (lang) localStorage.setItem('sp.pref.lang', JSON.stringify(lang));
      if (stored != null && !sessionStorage.getItem('sp.e2e.seeded')) { localStorage.setItem('sp.pref.stats', stored); sessionStorage.setItem('sp.e2e.seeded', '1'); }
    }, stored, entered, lang, nickname);
    await c.page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await c.page.waitForFunction((needOnline) => (!needOnline || globalThis.__SP__?.store.get().connection.status === 'online') && !!document.querySelector('.screen'), { timeout: 30000 }, entered);
    return c;
  }
  const texts = (c, sel) => c.page.$$eval(sel, (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
  const stored = (c) => c.page.evaluate(() => { const r = localStorage.getItem('sp.pref.stats'); return r ? JSON.parse(r) : null; });
  const openStats = async (c, from = '.lobby-screen .stats-entry') => {
    await c.click(from, from.includes('stats-entry') ? null : '统计');
    await c.page.waitForSelector('.st .st-tab', { visible: true, timeout: 15000 });
  };
  const toast = (c) => c.page.waitForFunction(() => document.querySelector('.toast')?.textContent || false, { timeout: 8000 }).then((h) => h.jsonValue());
  const noProblems = (c) => assert.deepEqual(c.problems, [], 'no console errors / failed requests');

  test('current nickname follows the active session rather than saved history', async () => {
    const env = seed(1);
    for (const rec of env.records) rec.players.find((p) => p.playerId === rec.selfId).name = 'ArchiveID';
    const c = await open({ stored: JSON.stringify(env), entered: false });
    await c.page.$eval('.title-login input', (input) => {
      input.value = 'ActiveID';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await c.click('.title-login .btn--primary', '开始');
    await c.page.waitForFunction(() => globalThis.__SP__?.store.get().connection.status === 'online');
    assert.deepEqual(await c.page.evaluate(() => ({
      current: globalThis.__SP__.store.get().me.name, saved: localStorage.getItem('sp.name'),
    })), { current: 'ActiveID', saved: 'ActiveID' }, 'entering a new ID updates the session and saved identity');
    await openStats(c);
    await c.page.waitForFunction(() => document.querySelector('.st-profile__name')?.textContent.trim() === 'Dr. ActiveID');
    await c.page.evaluate(() => {
      localStorage.setItem('sp.name', 'StaleID');
      globalThis.__SP__.store.patch('me', { name: 'LiveID' });
    });
    await c.page.waitForFunction(() => document.querySelector('.st-profile__name')?.textContent.trim() === 'Dr. LiveID');
    await c.page.evaluate(() => globalThis.__SP__.store.patch('me', { name: '' }));
    await c.page.waitForFunction(() => document.querySelector('.st-profile__name')?.textContent.trim() === 'Dr. 未知');
    noProblems(c);
  });

  test('import restores and saves an unknown ID while preserving an already selected ID', async () => {
    const env = seed(1);
    for (const rec of env.records) rec.players.find((p) => p.playerId === rec.selfId).name = 'ArchiveID';
    const dir = mkdtempSync(path.join(tmpdir(), 'sp-stats-name-'));
    const file = path.join(dir, 'stats.json');
    writeFileSync(file, JSON.stringify(env));
    for (const nickname of [null, 'SessionID']) {
      const c = await open({ entered: false, nickname });
      await openStats(c, '.title-corner .btn');
      await c.page.waitForSelector('.st-empty'); // no records yet: the empty page, no profile until the import
      const input = await c.page.$('.st input[type="file"]');
      await input.uploadFile(file);
      const expected = nickname || 'ArchiveID';
      await c.page.waitForFunction((name) => document.querySelector('.st-profile__name')?.textContent.trim() === `Dr. ${name}`, {}, expected);
      await toast(c);
      assert.deepEqual(await c.page.evaluate(() => ({
        current: globalThis.__SP__.store.get().me.name, saved: localStorage.getItem('sp.name'),
      })), { current: expected, saved: expected });
      await c.page.keyboard.press('Escape');
      await c.page.waitForFunction((name) => document.querySelector('.title-login input')?.value === name, {}, expected);
      assert.ok(await c.exists('.title-screen'), 'importing history does not start a session');
      noProblems(c);
      await c.close();
    }
  });

  test('desktop: tabs, the counting rule on screen, a settlement re-viewed, Esc, the title entry', async () => {
    const env = seed();
    const c = await open({ stored: JSON.stringify(env) });
    await c.page.waitForSelector('.lobby-screen');
    await openStats(c);
    // 总览: 24 settled + the quit after 6 rounds count, the first-round one does not
    const cards = await texts(c, '.st-sec > .st-cards .st-card__num');
    assert.equal(cards[0], '25', 'games');
    assert.match(await c.page.$$eval('.st-rule', (els) => els.map((e) => e.textContent).join(' ')), /另有 1 局未计入统计/);
    await c.page.screenshot({ path: path.join(OUT, 'stats-overview-desktop.png') });
    // 策略 / 战斗累计
    await c.click('.st-tab[data-tab="bands"]');
    assert.ok((await c.page.$$eval('.st-table tbody tr', (r) => r.length)) >= 5, 'strategy rows');
    await c.page.screenshot({ path: path.join(OUT, 'stats-bands-desktop.png') });
    await c.click('.st-tab[data-tab="totals"]');
    assert.ok((await c.page.$$eval('.st-sum', (r) => r.length)) >= 8, 'combat totals');
    // 对局记录: every record, the left-early ones marked, the first-round one dimmed, only settled rows open
    await c.click('.st-tab[data-tab="history"]');
    const rows = await texts(c, '.st-table--history tbody tr');
    assert.equal(rows.length, 26);
    assert.equal(rows.filter((r) => r.includes('中途退出')).length, 2);
    assert.equal(rows.filter((r) => r.includes('不计入统计')).length, 1);
    assert.equal(await c.page.$$eval('.st-table--history tr.is-excluded', (r) => r.length), 1);
    assert.equal(await c.page.$$eval('.st-table--history tr.is-clickable', (r) => r.length), 24);
    await c.page.screenshot({ path: path.join(OUT, 'stats-history-desktop.png') });
    // a row re-views the settlement (the real result screen), 返回统计 comes back to the list, Esc closes
    await c.click('.st-table--history tr.is-clickable');
    await c.page.waitForSelector('.st--replay .result', { visible: true, timeout: 20000 });
    await sleep(900);
    await c.page.screenshot({ path: path.join(OUT, 'stats-replay-desktop.png') });
    assert.ok(await c.page.$('.st--replay .rcard.is-self'), 'the player\'s own card is marked 你 (the record\'s own id)');
    await c.page.keyboard.press('Escape');
    await c.page.waitForSelector('.st .st-tab', { timeout: 5000 });
    assert.ok(!(await c.exists('.st--replay')), 'Esc in the re-view goes back to the list');
    await c.page.keyboard.press('Escape');
    await c.page.waitForFunction(() => !document.querySelector('.st'), { timeout: 5000 });
    assert.ok(await c.exists('.lobby-screen'));
    noProblems(c);
    await c.close();
    // the title screen's entry (not entered yet: no connection needed), in English
    const t = await open({ stored: JSON.stringify(env), entered: false, lang: 'en' });
    await t.click('.title-corner .btn', 'Stats');
    await t.page.waitForSelector('.st .st-tab', { visible: true, timeout: 15000 });
    assert.match(await t.page.$eval('.st-top', (e) => e.textContent), /Overview/);
    await t.page.screenshot({ path: path.join(OUT, 'stats-overview-title-en.png') });
    noProblems(t);
    await t.close();
  });

  test('phone in landscape (844×390): the page and the re-view fit; no console errors', async () => {
    const c = await open({ w: 844, h: 390, stored: JSON.stringify(seed()) });
    await c.page.waitForSelector('.lobby-screen');
    await openStats(c);
    const fits = () => c.page.evaluate(() => {
      const st = document.querySelector('.st').getBoundingClientRect();
      const top = document.querySelector('.st-top').getBoundingClientRect();
      const right = document.querySelector('.st-top__right').getBoundingClientRect();
      const tabs = document.querySelector('.st-tabs').getBoundingClientRect();
      return { w: st.width, topH: top.height, rightEdge: right.right, tabsRight: tabs.right, rightLeft: right.left, scrollW: document.documentElement.scrollWidth };
    });
    const f = await fits();
    assert.ok(f.rightEdge <= f.w + 1 && f.tabsRight <= f.rightLeft + 1, `the top bar fits: ${JSON.stringify(f)}`);
    assert.ok(f.scrollW <= 845, 'no horizontal page scroll');
    await c.page.screenshot({ path: path.join(OUT, 'stats-overview-phone.png') });
    await c.click('.st-tab[data-tab="history"]');
    await c.page.screenshot({ path: path.join(OUT, 'stats-history-phone.png') });
    await c.click('.st-table--history tr.is-clickable');
    await c.page.waitForSelector('.st--replay .result', { visible: true, timeout: 20000 });
    await sleep(900);
    await c.page.screenshot({ path: path.join(OUT, 'stats-replay-phone.png') });
    await c.click('.st--replay .btn--primary', '返回统计');
    await c.page.waitForSelector('.st .st-tab', { timeout: 5000 });
    noProblems(c);
  });

  test('the data actions: export → import (nothing new), a corrupt file, a newer file, 清空 with its confirm dialog', async () => {
    const c = await open({ stored: JSON.stringify(seed(6)) });
    await c.page.waitForSelector('.lobby-screen');
    await openStats(c);
    // 导出: capture the blob the page hands to the browser
    // (the Blob itself: the site's CSP, 0.3.0, allows fetch only to 'self', not to a blob: URL)
    await c.page.evaluate(() => {
      const create = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (blob) => { globalThis.__blob = blob; return create(blob); };
      HTMLAnchorElement.prototype.click = function click() { globalThis.__dl = { name: this.download, href: this.href }; };
    });
    await c.click('[data-testid="stats-export"]');
    await c.page.waitForFunction(() => !!globalThis.__dl, { timeout: 5000 });
    const exported = await c.page.evaluate(async () => ({ name: globalThis.__dl.name, text: await globalThis.__blob.text() }));
    assert.match(exported.name, /^stronghold-stats-\d{8}-\d{4}\.json$/);
    const payload = JSON.parse(exported.text);
    assert.equal(payload.kind, 'local-stats');
    assert.equal(payload.records.length, 8);
    const dir = mkdtempSync(path.join(tmpdir(), 'sp-stats-'));
    const upload = async (name, text) => {
      const file = path.join(dir, name);
      writeFileSync(file, text);
      const input = await c.page.$('.st input[type="file"]');
      await input.uploadFile(file);
    };
    await c.page.evaluate(() => document.querySelectorAll('.toast').forEach((e) => e.remove()));
    // 导入 the same file: nothing new
    await upload('same.json', exported.text);
    assert.match(await toast(c), /没有新记录/);
    assert.equal((await stored(c)).records.length, 8);
    await c.page.evaluate(() => document.querySelectorAll('.toast').forEach((e) => e.remove()));
    // a corrupt file and a newer one change nothing
    await upload('bad.json', '{"records": [1, 2');
    assert.match(await toast(c), /不是有效的统计导出文件/);
    await c.page.evaluate(() => document.querySelectorAll('.toast').forEach((e) => e.remove()));
    await upload('newer.json', JSON.stringify({ kind: 'local-stats', v: 99, records: [] }));
    assert.match(await toast(c), /更新版本/);
    assert.equal((await stored(c)).records.length, 8);
    await c.page.evaluate(() => document.querySelectorAll('.toast').forEach((e) => e.remove()));
    // 导入 a file with one new record: merged, newest first
    const extra = { ...payload.records[0], id: 'r1.cafe0001', t: NOW + DAY };
    await upload('extra.json', JSON.stringify({ ...payload, records: [extra] }));
    assert.match(await toast(c), /已导入 1 条记录/);
    assert.equal((await stored(c)).records[0].id, 'r1.cafe0001');
    // 清空: the confirm dialog is above the overlay, Esc closes only it, the second time confirms
    await c.click('[data-testid="stats-clear"]');
    await c.page.waitForSelector('.modal', { visible: true });
    assert.match(await c.page.$eval('.modal', (e) => e.textContent), /将删除本机保存的 9 条对局记录/);
    await sleep(250); // the dialog's key handler is attached by its effect, a moment after it paints
    await c.page.keyboard.press('Escape');
    await c.page.waitForFunction(() => !document.querySelector('.modal'), { timeout: 3000 });
    assert.ok(await c.exists('.st'), 'Esc closed the dialog only');
    assert.equal((await stored(c)).records.length, 9, 'nothing deleted');
    await c.click('[data-testid="stats-clear"]');
    await c.page.waitForSelector('.modal', { visible: true });
    await c.click('.modal__actions button.btn--danger');
    await c.page.waitForFunction(() => /还没有记录/.test(document.querySelector('.st-body')?.textContent || ''), { timeout: 5000 });
    assert.deepEqual((await stored(c)).records, []);
    noProblems(c);
  });

  test('corrupt and newer storage: a notice, no crash; the newer build\'s data is never overwritten', async () => {
    const bad = '{"v":1,"records":[{"players":[';
    const c = await open({ stored: bad });
    await c.page.waitForSelector('.lobby-screen');
    await openStats(c);
    assert.match(await c.page.$eval('.st-note.is-warn', (e) => e.textContent), /无法读取，已另存为备份/);
    assert.equal(await c.page.evaluate(() => localStorage.getItem('sp.pref.stats.damaged')), bad, 'kept as a backup');
    noProblems(c);
    await c.close();
    const newer = JSON.stringify({ v: STATS_VERSION + 3, records: [{ players: [{ playerId: 'x' }], future: true }] });
    const n = await open({ stored: newer });
    await n.page.waitForSelector('.lobby-screen');
    await openStats(n);
    // the page shows 加载中 until its game data is in (the hub's art loads beside it)
    await n.page.waitForFunction(() => /更新版本的统计数据/.test(document.querySelector('.st-body')?.textContent || ''), { timeout: 15000 });
    assert.ok(await n.page.$eval('[data-testid="stats-clear"]', (b) => b.disabled), 'no 清空 over data this build cannot read');
    assert.equal(await n.page.evaluate(() => localStorage.getItem('sp.pref.stats')), newer);
    noProblems(n);
  });
});

describe('统计数据: the real flows (a fast real server, headless Chrome)', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome) to run' }, () => {
  let puppeteer;
  const servers = [];
  before(async () => { puppeteer = (await import('puppeteer-core')).default; });
  after(async () => { for (const s of servers) await s.stop(); });

  const stored = (c) => c.page.evaluate(() => { const r = localStorage.getItem('sp.pref.stats'); return r ? JSON.parse(r) : null; });
  async function toSoloMatch(c) {
    await c.click('.mode-card', '独立模拟');
    await sleep(300);
    await c.click('.diff-card', '标准模拟');
    await c.click('.create-box button', '开始独立模拟');
    await c.waitFor((s) => !!s.room, 'solo room');
    if (!(await c.st()).phase) await c.click('.room-bar__right button', '开始模拟', { timeout: 20000 });
    await c.waitFor((s) => s.phase === 'INFO_CHECK', 'briefing', 30000);
  }
  async function toPrep(c) {
    await c.click('.brief__foot .btn--primary', '准备就绪');
    await c.waitFor((s) => s.phase === 'BAND_DRAFT', 'band draft', 30000);
    await c.click('.dband', null, { nth: 1 });
    await c.click('.draft-detail__btns .btn--primary', '确认选择');
    await c.waitFor((s) => s.phase === 'PREP' && s.round === 1, 'prep round 1', 60000);
    await sleep(1500);
  }
  async function giveUp(c) {
    await c.click('.stephead .btn--danger, .gtop__exit', null, { timeout: 8000 });
    await c.click('.modal__actions button', '放弃模拟');
    await c.waitFor((s) => !s.room && !s.phase, 'back in the lobby', 15000);
  }

  test('given up in the briefing: history only; given up after round 1: it counts', async () => {
    const srv = await startRealServer({ fast: { timerScale: 0.25, combatSpeed: 8 } });
    servers.push(srv);
    const c = new Client(puppeteer, srv.base, 'stats', { prefix: 'stats', w: 1600, h: 900 });
    try {
      await c.open();
      await c.enter('Doc');
      // entered and left right away
      await toSoloMatch(c);
      await giveUp(c);
      let env = await stored(c);
      assert.equal(env.records.length, 1);
      assert.equal(env.records[0].end, 'quit');
      assert.equal(env.records[0].players[0].roundsPassed, 0);
      // through round 1, then given up in round 2
      await toSoloMatch(c);
      await toPrep(c);
      await c.click('.readybtn');
      await c.waitFor((s) => s.round >= 2 && ['PREP', 'ROUND_START', 'SP_DRAFT'].includes(s.phase), 'round 2 (round 1 cleared)', 120000);
      await giveUp(c);
      env = await stored(c);
      assert.equal(env.records.length, 2);
      assert.equal(env.records[0].end, 'quit');
      assert.equal(env.records[0].players[0].roundsPassed, 1, 'one round cleared — the server\'s own count for a quit in round 2');
      assert.ok(env.records[0].players[0].bandId, 'its strategy');
      // the page: one game counted, one left out, both in the history
      await c.click('.lobby-screen .stats-entry');
      await c.page.waitForSelector('.st .st-card', { visible: true });
      assert.equal((await c.page.$$eval('.st-sec > .st-cards .st-card__num', (els) => els.map((e) => e.textContent)))[0], '1');
      assert.match(await c.page.$$eval('.st-rule', (els) => els.map((e) => e.textContent).join(' ')), /另有 1 局未计入统计/);
      await c.click('.st-tab[data-tab="history"]');
      const rows = await c.page.$$eval('.st-table--history tbody tr', (trs) => trs.map((tr) => tr.innerText.replace(/\s+/g, ' ').trim()));
      assert.equal(rows.length, 2);
      assert.ok(rows[0].includes('中途退出') && !rows[0].includes('不计入统计'), rows[0]);
      assert.ok(rows[1].includes('中途退出') && rows[1].includes('不计入统计'), rows[1]);
      await c.shot('history-real');
      assert.deepEqual(c.problems, []);
    } finally { await c.close(); }
  });

  test('played to its settlement: one record, and a reload (the lobby replays m.result) adds no second one', async () => {
    const srv = await startRealServer({ fast: { timerScale: 0.25, combatSpeed: 8, finishAfter: 1 } });
    servers.push(srv);
    const c = new Client(puppeteer, srv.base, 'stats', { prefix: 'stats', w: 1600, h: 900 });
    try {
      await c.open();
      await c.enter('Doc');
      await toSoloMatch(c);
      await toPrep(c);
      await c.click('.readybtn');
      await c.waitFor((s) => s.result, 'the settlement', 120000);
      await sleep(500);
      let env = await stored(c);
      assert.equal(env.records.length, 1);
      assert.equal(env.records[0].end, 'settled');
      assert.equal(env.records[0].roomMode, 'solo');
      assert.equal(env.records[0].selfId, (await c.st()).me);
      await c.page.reload({ waitUntil: 'domcontentloaded' });
      await c.page.waitForFunction(() => !!globalThis.__SP__ && !!document.querySelector('.screen'), { timeout: 30000 });
      await c.waitFor((s) => s.result, 'the replayed settlement after a reload', 30000);
      await sleep(500);
      env = await stored(c);
      assert.equal(env.records.length, 1, 'the replay is the same record');
      assert.deepEqual(c.problems, []);
    } finally { await c.close(); }
  });
});
