// Real server and normal UI operations only: create/join, ready, skip and confirm.
// No mocked draft, injected game state, direct network requests or fixed seed.
// SP_E2E=1 node --test test/ui/band-draft-skip.e2e.test.js
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'test/e2e/out/band-draft-skip');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);
const SKIP = '.draft-detail__btns .btn:not(.btn--primary)';

describe('strategy skip eligibility (real server, normal browser operations)', {
  skip: !ENABLED && 'set SP_E2E=1 and have Chrome to run',
}, () => {
  let srv;
  let browser;
  let base;
  const observations = [];

  before(async () => {
    mkdirSync(OUT, { recursive: true });
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    base = `http://127.0.0.1:${srv.port}`;
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
      args: ['--no-sandbox', '--no-first-run', '--mute-audio', '--disable-background-timer-throttling'] });
  });
  after(async () => {
    try {
      writeFileSync(path.join(OUT, 'observations.json'), JSON.stringify(observations, null, 2));
    } finally {
      const proc = browser?.process();
      try { await browser?.close(); } finally {
        for (const stream of [proc?.stdout, proc?.stderr]) stream?.destroy();
        await srv?.close();
      }
    }
  });

  async function state(page) {
    return page.evaluate(() => {
      const s = globalThis.__SP__.store.get();
      return { me: s.me.playerId, code: s.room?.code, phase: s.match.public?.phase,
        draft: s.match.public?.draft, bandId: s.match.private?.bandId };
    });
  }
  async function click(page, selector, text = '') {
    await page.waitForFunction((sel, txt) => [...document.querySelectorAll(sel)]
      .some((el) => !el.disabled && el.textContent.includes(txt)), { timeout: 10000 }, selector, text);
    const buttons = await page.$$(selector);
    for (const button of buttons) {
      const match = await button.evaluate((el, txt) => !el.disabled && el.textContent.includes(txt), text);
      if (match) { await button.click(); return; }
    }
    assert.fail(`no enabled ${selector} ${text}`);
  }
  async function player(name, suffix = '') {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    const errors = [];
    const frames = [];
    page.on('pageerror', (e) => errors.push(e.stack || e.message));
    const cdp = await page.createCDPSession();
    await cdp.send('Network.enable');
    // Observe only: retain skip requests and replies, never handshake tokens or session data.
    cdp.on('Network.webSocketFrameSent', ({ response }) => {
      try { const m = JSON.parse(response.payloadData); if (m.t === 'g.bandSkip') frames.push({ direction: 'sent', message: m }); } catch { /* non-JSON */ }
    });
    cdp.on('Network.webSocketFrameReceived', ({ response }) => {
      try { const m = JSON.parse(response.payloadData); if (m.t === 'error') frames.push({ direction: 'received', message: m }); } catch { /* non-JSON */ }
    });
    await page.goto(base + '/' + suffix, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.title-login input');
    await page.type('.title-login input', name);
    await click(page, '.title-login button', '开始');
    await page.waitForFunction(() => globalThis.__SP__?.store.get().connection.status === 'online');
    return { context, page, errors, frames };
  }
  async function draft(humans, mode = 'coop') {
    const clients = [await player('轮选测试1')];
    const host = clients[0].page;
    await click(host, '.mode-card', mode === 'solo' ? '独立模拟' : '同盟模拟');
    await click(host, '.create-box button', mode === 'solo' ? '开始独立模拟' : '创建同盟');
    await host.waitForFunction(() => !!globalThis.__SP__.store.get().room?.code);
    const code = (await state(host)).code;
    for (let i = 1; i < humans; i++) {
      const c = await player(`轮选测试${i + 1}`, `?room=${code}`);
      clients.push(c);
      await c.page.waitForFunction((code) => globalThis.__SP__.store.get().room?.code === code, {}, code);
      await click(c.page, '.room-bar__right button', '准备就绪');
    }
    if ((await state(host)).phase !== 'INFO_CHECK') await click(host, '.room-bar__right button', '开始模拟');
    for (const c of clients) {
      await c.page.waitForSelector('.brief__foot .btn--primary');
      await click(c.page, '.brief__foot .btn--primary', '准备就绪');
    }
    await host.waitForFunction(() => globalThis.__SP__.store.get().match.public?.phase === 'BAND_DRAFT');
    return clients;
  }
  async function current(clients) {
    const s = await state(clients[0].page);
    for (const c of clients) if ((await state(c.page)).me === s.draft.turn) {
      await c.page.waitForFunction(() => {
        const s = globalThis.__SP__.store.get();
        return s.match.public?.draft?.turn === s.me.playerId;
      });
      return c;
    }
    assert.fail('current human not found');
  }
  async function capture(c, name) {
    await c.page.waitForSelector(SKIP);
    const s = await state(c.page);
    const disabled = await c.page.$eval(SKIP, (el) => el.disabled);
    const toasts = await c.page.$$eval('.toast', (els) => els.map((el) => el.textContent));
    const file = `${name}.png`;
    await c.page.screenshot({ path: path.join(OUT, file), fullPage: true });
    const result = { name, ...s, disabled, toasts, file, frames: c.frames.slice() };
    observations.push(result);
    return result;
  }
  async function confirm(c) {
    await click(c.page, '.dband:not(.is-taken)');
    await click(c.page, '.draft-detail__btns .btn--primary', '确认选择');
    await c.page.waitForFunction(() => !!globalThis.__SP__.store.get().match.private?.bandId);
  }
  async function close(clients) {
    const runtimeErrors = clients.flatMap((c) => c.errors);
    try { assert.deepEqual(runtimeErrors, [], 'no page errors during normal operations'); } finally {
      for (const c of clients) await c.context.close();
      observations.push({ name: 'browser-cleanup', runtimeErrors,
        errorsAfterClose: clients.flatMap((c) => c.errors) });
    }
  }

  for (const humans of [2, 3, 4]) test(`${humans} humans: initial/middle turns enabled, last disabled with quota left`, { timeout: 120000 }, async () => {
    const clients = await draft(humans);
    try {
      for (let i = 0; i < humans; i++) {
        const c = await current(clients);
        const s = await capture(c, `${humans}p-position-${i + 1}`);
        assert.equal(s.draft.skipsLeft[s.me], 1, 'no player has skipped');
        assert.equal(s.disabled, i === humans - 1, 'skip only while another player remains');
        if (i === humans - 1) {
          const before = c.frames.length;
          // A real click on the disabled button must send nothing and leave the turn unchanged.
          await c.page.click(SKIP);
          await new Promise((resolve) => setTimeout(resolve, 150));
          assert.equal((await state(c.page)).draft.turn, s.me);
          assert.equal(c.frames.length, before);
        }
        await confirm(c);
      }
      await clients[0].page.waitForFunction(() => globalThis.__SP__.store.get().match.public?.phase !== 'BAND_DRAFT');
    } finally { await close(clients); }
  });

  test('spent quota stays disabled even with another unpicked player; waiting/selected players disabled', { timeout: 120000 }, async () => {
    const clients = await draft(3);
    try {
      const first = await current(clients);
      const firstId = (await state(first.page)).me;
      const waiting = clients.find((c) => c !== first);
      assert.equal((await capture(waiting, '3p-waiting')).disabled, true);
      await click(first.page, SKIP, '跳过');
      await first.page.waitForFunction((id) => globalThis.__SP__.store.get().match.public.draft.turn !== id, {}, firstId);
      const second = await current(clients);
      await click(second.page, SKIP, '跳过');
      const secondId = (await state(second.page)).me;
      await second.page.waitForFunction((id) => globalThis.__SP__.store.get().match.public.draft.turn !== id, {}, secondId);
      await confirm(await current(clients));
      await first.page.waitForFunction((id) => globalThis.__SP__.store.get().match.public.draft.turn === id, {}, firstId);
      const spent = await capture(first, '3p-spent-quota-with-successor');
      assert.equal(spent.draft.skipsLeft[firstId], 0);
      assert.equal(spent.draft.order.filter((id) => !spent.draft.picks[id]).length, 2);
      assert.equal(spent.disabled, true);
      const before = first.frames.length;
      await first.page.click(SKIP);
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.equal(first.frames.length, before);
      await confirm(first);
      assert.equal((await capture(first, '3p-already-selected')).disabled, true);
      await confirm(await current(clients));
    } finally { await close(clients); }
  });

  test('solo draft has no skip button', { timeout: 60000 }, async () => {
    const clients = await draft(1, 'solo');
    try {
      assert.equal(await clients[0].page.$(SKIP), null);
      await confirm(clients[0]);
    } finally { await close(clients); }
  });
});
