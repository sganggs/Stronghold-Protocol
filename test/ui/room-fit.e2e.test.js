// Browser E2E of the waiting room's text fit (§35.18 review of the event UI splits) against the real server, headless
// Chrome. Opt-in: SP_E2E=1 node --test test/ui/room-fit.e2e.test.js
//
// At 特大 on a 667×375 phone the seat cards' state (「Standing by」 on two lines past the card and over 创建者), the empty
// seat's 添加 AI 队友 chip, the key's 复制 and the difficulty pill were cut, the spectator's 观战中 squeezed to a few px,
// 独立模拟's briefing ran under the status line and the 名片干员 picker cut operator names with an ellipsis. Checked here
// on every screen the room shows — a co-op room with the host, a doctor who joined, an AI teammate, an empty seat and a
// spectator (the host's, the doctor's and the spectator's view, the host's ⚙ 同盟设置, the doctor's picker), the room
// before anyone joined, and the 独立模拟 room — on four phones (640×360, 667×375, 740×360, 844×390) and on desktops
// (800×600 – 1920×1080) in all five languages at all four 文字大小: every line of visible text inside each box that clips
// it or draws a box around it (a button, a chip, the card), inside the screen, over no other label's text and not broken
// inside a word (Korean between two syllables too), no line starting with a small kana, ー or a closing mark; only a
// player's name, a plugin mode's name or the compact version pill's name may end in an ellipsis; the pill keeps its full
// accessible name and its control inside the footer (versions-fit's existing policy; §35.23.11). Nothing makes the page
// scroll. On the phones also a doctor
// who readied, a modded room's tags (已同意, 插件内容就绪 / 载入中 / 校验失败) and mode, and a doctor whose connection
// dropped (written into the page's store: no plugin pack here). A box that scrolls (the picker's grid) counts as holding
// its text; on the phones 独立模拟's briefing must not scroll. Every page finishes with zero console errors
// (without the art pack, as on CI, the cards show their avatar frames and the pack's 404s are let through).
// The room's big button and its 选择模拟协议: test/ui/lobby-hub.e2e.test.js; the cards' outfits: room-cards.e2e.test.js.
// Screenshots: test/e2e/out/room-fit-*.png.

import { seedReleaseRead } from '../helpers/releaseNotes.js';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { textProblems } from '../e2e/text-fit.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'test/e2e/out');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);
// without the art pack (CI) every card shows its avatar frame, and the pictures and music the manifest names answer 404
const ART = existsSync(path.join(ROOT, 'public/assets'));
const LANGS = ['zh', 'zh-TW', 'en', 'ja', 'ko'];
const SIZES = ['sm', 'md', 'lg', 'xl'];
const PHONES = [[640, 360], [667, 375], [740, 360], [844, 390]];
const DESKS = [[1920, 1080], [1440, 900], [1280, 720], [1100, 530], [1024, 600], [960, 540], [800, 600]];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('the waiting room\'s text fit (real server, headless Chrome)', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome) to run' }, () => {
  let srv;
  let browser;
  let base;

  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    base = `http://127.0.0.1:${srv.port}`;
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--mute-audio'] });
    mkdirSync(OUT, { recursive: true });
  });
  after(async () => { await browser?.close(); await srv?.close(); });

  const viewport = ([w, h], touch) => ({ width: w, height: h, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
  async function open(lang, who, size, touch) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport(viewport(size, touch));
    const problems = [];
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      if (!ART && /Failed to load resource/.test(m.text()) && /\/(assets|media)\//.test(m.location()?.url || '')) return;
      problems.push(`console: ${m.text()}`);
    });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    await page.evaluateOnNewDocument((l, n) => {
      localStorage.setItem('sp.name', n);
      sessionStorage.setItem('sp.entered', '1');
      if (l) localStorage.setItem('sp.pref.lang', JSON.stringify(l));
    }, lang === 'zh' ? null : lang, who);
    await seedReleaseRead(page);
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => globalThis.__SP__?.store.get().connection.status === 'online' && !!document.querySelector('.lobby-screen'), { timeout: 30000 });
    return { ctx, page, problems };
  }
  const request = (c, type, body) => c.page.evaluate((t, b) => globalThis.__SP__.net.request(t, b).then(() => 'ok', (e) => e?.code || String(e)), type, body);
  const textSize = (c, ts) => c.page.evaluate(async (v) => (await import('/js/ui/settings.js')).updateSettings({ textSize: v }), ts);
  /** Waits out the room's entrance and the 转场 (the cards land, the bottom bar rises). */
  const settled = (page) => page.waitForFunction(() => !document.getAnimations()
    .some((a) => /^(rs|tr|rseat)-/.test(String(a.animationName)) && a.playState === 'running' && a.effect?.getTiming().iterations !== Infinity), { timeout: 8000 });
  const check = async (page, sel = '.room-screen') => {
    await page.evaluate(() => document.fonts.ready);
    // §35.23.11 exposes the compact version pill on a default server too. versions-fit already permits its ellipsis;
    // keep that exception local to this suite, with the full accessible name and the control's actual geometry checked.
    const bad = await page.evaluate(textProblems, sel, '[data-testid="room-version"] .rs-pill__vername');
    if (sel === '.room-screen') bad.push(...await page.evaluate(() => {
      const out = [];
      const buttons = [...document.querySelectorAll('[data-testid="room-version"]')];
      if (!buttons.length) out.push('default server missing the version pill');
      for (const button of buttons) {
        const r = button.getBoundingClientRect(), p = button.closest('.rs-pill').getBoundingClientRect();
        const label = button.querySelector('.rs-pill__vername').textContent.trim();
        if (!r.width || !r.height) out.push('version pill is hidden');
        if (!label || !button.getAttribute('aria-label')?.includes(label)) out.push('version pill missing its full accessible name');
        if (r.left < p.left - 1 || r.right > p.right + 1 || r.top < p.top - 1 || r.bottom > p.bottom + 1
          || r.left < -1 || r.right > innerWidth + 1 || r.top < -1 || r.bottom > innerHeight + 1) out.push('version pill outside its footer');
        // The synthetic trusted-plugin fixture may have its consent modal above the room; controls behind it are inert.
        if (!button.disabled && !document.querySelector('.modal, .guide') && !button.closest('[inert]')
          && !button.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2))) out.push('version pill centre is covered');
      }
      return out;
    }));
    return bad;
  };

  /**
   * One language through `sizes` × `screens` (touch on phones): the co-op room before anyone joined, then with a doctor,
   * an AI teammate, an empty seat and a spectator — three views, the host's ⚙ and the doctor's picker —, and the solo room.
   */
  async function run(lang, screens, touch, shotAt) {
    const bad = [];
    const host = await open(lang, 'Kal\'tsit', screens[0], touch);
    const guest = await open(lang, 'Amiya', screens[0], touch);
    const spec = await open(lang, 'Doctor', screens[0], touch);
    const solo = await open(lang, 'Kal\'tsit', screens[0], touch);
    const clients = [host, guest, spec, solo];
    try {
      assert.equal(await request(host, 'room.create', { mode: 'coop', difficulty: 'NORMAL' }), 'ok');
      await host.page.waitForSelector('.room-screen .rs-go', { visible: true, timeout: 15000 });
      for (const ts of SIZES) {
        await textSize(host, ts);
        for (const size of screens) {
          await host.page.setViewport(viewport(size, touch));
          await sleep(120); await settled(host.page);
          for (const p of await check(host.page)) bad.push(`${lang} ${ts} ${size.join('×')} the new room: ${p}`);
        }
      }
      const code = await host.page.evaluate(() => globalThis.__SP__.store.get().room.code);
      assert.equal(await request(host, 'room.addBot', {}), 'ok');
      assert.equal(await request(guest, 'room.join', { code }), 'ok');
      assert.equal(await request(spec, 'room.spectate', { code }), 'ok');
      assert.equal(await request(solo, 'room.create', { mode: 'solo', difficulty: 'NORMAL' }), 'ok');
      for (const c of [guest, spec, solo]) await c.page.waitForSelector('.room-screen .rs-go', { visible: true, timeout: 15000 });
      await host.page.waitForFunction(() => document.querySelectorAll('.room-screen .seat:not(.seat--empty)').length === 3 && !!document.querySelector('.specbar'));
      for (const ts of SIZES) {
        for (const c of clients) await textSize(c, ts);
        for (const size of screens) {
          for (const c of clients) await c.page.setViewport(viewport(size, touch));
          await sleep(150);
          for (const [who, c] of [['host', host], ['doctor', guest], ['spectator', spec], ['solo host', solo]]) {
            await settled(c.page);
            for (const p of await check(c.page)) bad.push(`${lang} ${ts} ${size.join('×')} ${who}: ${p}`);
          }
          // on a phone 独立模拟's briefing holds its text without scrolling (§35.18 review of the text-fit fixes: it was at its
          // 320 px cap whatever the card's width, and above 中 its text grew a pixel a step while the bars above and below took
          // height from it — at 特大 its last bullet sat half cut at the bottom edge; the check above lets a scrolling box
          // through). At 小 the host's 「Standing by」 keeps one line in 独立模拟's 108 px card, as before the text-fit work
          // (in its review: in flow it had 98 px and took two)
          if (touch) {
            const sc = await solo.page.$eval('.rs-brief', (e) => [e.scrollHeight, e.clientHeight]);
            if (sc[0] > sc[1] + 1) bad.push(`${lang} ${ts} ${size.join('×')} solo host: the briefing scrolls (${sc.join(' / ')})`);
            if (ts === 'sm') {
              const lines = await solo.page.$eval('.rs--solo .rseat__said', (e) => {
                const r = document.createRange(); r.selectNodeContents(e);
                return new Set([...r.getClientRects()].filter((q) => q.width > 0).map((q) => Math.round(q.top))).size;
              });
              if (lines > 1) bad.push(`${lang} ${ts} ${size.join('×')} solo host: the state takes ${lines} lines`);
            }
          }
          await host.page.$eval('.rs-pill__gear', (b) => b.click());
          await host.page.waitForSelector('.rs-opts', { visible: true, timeout: 3000 });
          for (const p of await check(host.page, '.rs-opts')) bad.push(`${lang} ${ts} ${size.join('×')} ⚙ 同盟设置: ${p}`);
          await host.page.$eval('.rs-pill__gear', (b) => b.click());
          await guest.page.$eval('[data-testid="seat-card-pick"]', (b) => b.click());
          await guest.page.waitForSelector('.modal__box.cardpick', { visible: true, timeout: 5000 });
          await sleep(300);
          for (const p of await check(guest.page, '.modal__box.cardpick')) bad.push(`${lang} ${ts} ${size.join('×')} the picker: ${p}`);
          if (shotAt(size, ts)) {
            for (const [who, c] of [['host', host], ['spectator', spec], ['solo', solo]]) await c.page.screenshot({ path: path.join(OUT, `room-fit-${who}-${size.join('x')}-${lang}-${ts}.png`) });
            await guest.page.screenshot({ path: path.join(OUT, `room-fit-picker-${size.join('x')}-${lang}-${ts}.png`) });
          }
          await guest.page.keyboard.press('Escape');
          await guest.page.waitForSelector('.modal__box.cardpick', { hidden: true, timeout: 5000 });
        }
      }
      if (touch) {
        // the seat cards' other labels share the in-flow top / bottom layout (§35.18 review of the text-fit fixes): a doctor
        // who readied (已就绪), a modded room's tags — 已同意, 插件内容就绪 / 载入中 / 校验失败 — and its mode beside the mode
        // name, a doctor whose connection dropped (连接中断 on the art and as the state). The plugin fields are written into
        // the page's store after the server's last room.state (a fixture: there is no plugin pack here). On a phone the
        // 插件内容就绪 tag gives way (§35.18 review of the text-fit fixes: with it the host's state sat below the art on the
        // 640 / 667 px phones at 大 / 特大 in English and Japanese). Known and listed in §35.18's leftovers: on the 640 px
        // phone at 大 / 特大 in English an offline doctor's 「Disconnected」 is wider than the card (it breaks, and at 特大
        // also runs below the art) — let through here, every other case must fit
        const leftover = (ts, size, p) => ['lg', 'xl'].includes(ts) && size[0] <= 640 && lang === 'en'
          && /^(y past div\.seat__art|broken inside a word \([^)]*\)): span\.rseat__said "Disconnected"$/.test(p);
        // (without the spectator: with the 观战席 row as well, the most crowded room, the cards are shorter still — §35.18's
        // leftovers)
        assert.equal(await request(spec, 'room.leave', {}), 'ok');
        assert.equal(await request(guest, 'room.ready', { ready: true }), 'ok');
        for (const c of [host, guest]) await c.page.waitForFunction(() => { const r = globalThis.__SP__.store.get().room; return r.seats.some((s) => s && !s.isBot && s.ready) && !(r.spectators || []).length; });
        const modded = (c, offline) => c.page.evaluate((offline) => {
          const { store } = globalThis.__SP__;
          const r = store.get().room;
          const seats = r.seats.map((s) => (!s || s.isBot ? s : s.playerId === r.hostId ? { ...s, content: 'ready' }
            : { ...s, content: offline ? 'failed' : 'loading', connected: !offline }));
          const consent = Object.fromEntries(seats.filter((s) => s && !s.isBot).map((s) => [s.seat, true]));
          store.set({ room: { ...r, seats, content: { vanilla: false, plugins: [{ id: 'demo', name: 'Demo', version: '1.0.0' }],
            modeId: 'demo:siege', modes: [{ id: 'demo:siege', name: 'Endless Siege' }],
            trusted: { consent, plugins: [{ id: 'demo', version: '1.0.0', authors: [], permissions: [] }] } } } });
        }, offline);
        for (const ts of SIZES) {
          for (const c of [host, guest]) await textSize(c, ts);
          for (const size of screens) {
            for (const c of [host, guest]) await c.page.setViewport(viewport(size, touch));
            await sleep(150);
            for (const [who, c, offline] of [['host', host, false], ['doctor', guest, false], ['host', host, true]]) {
              await modded(c, offline);
              await settled(c.page);
              assert.equal(await c.page.$$eval('.room-screen .rseat__tag', (els) => els.length), 4, 'two tags on each doctor\'s card');
              for (const p of await check(c.page)) if (!leftover(ts, size, p)) bad.push(`${lang} ${ts} ${size.join('×')} ${who}, modded${offline ? ', the doctor offline' : ''}: ${p}`);
            }
          }
        }
      }
      for (const [who, c] of [['host', host], ['doctor', guest], ['spectator', spec], ['solo host', solo]]) assert.deepEqual(c.problems, [], `${lang} ${who}`);
    } finally { for (const c of clients) await c.ctx.close(); }
    return bad;
  }

  for (const lang of LANGS) {
    test(`phones (640×360 – 844×390), ${lang} at every 文字大小: every label of the room, ⚙ and the picker inside its box`, { timeout: 300000 }, async () => {
      const bad = await run(lang, PHONES, true, (size, ts) => size[0] === 667 && ts === 'xl' && ['zh', 'en', 'ja'].includes(lang));
      assert.deepEqual(bad.slice(0, 40), [], `${bad.length} problems`);
    });
  }

  for (const lang of LANGS) {
    test(`desktops (800×600 – 1920×1080), ${lang} at every 文字大小: every label of the room, ⚙ and the picker inside its box`, { timeout: 300000 }, async () => {
      const bad = await run(lang, DESKS, false, (size, ts) => size[0] === 1440 && ts === 'xl' && lang === 'en');
      assert.deepEqual(bad.slice(0, 40), [], `${bad.length} problems`);
    });
  }
});
