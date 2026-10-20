// Real-server browser E2E — 名片干员 on the room's seat cards (PR #643 split 6). Two doctors in a co-op room: every
// doctor's card shows a portrait (the default chosen by the player id — the same operator on both screens), a bot keeps
// its robot frame, only one's own card has 更换立绘; the picker (the project's Modal) opens with the current choice
// focused, filters by name and rarity, a pick shows at once on one's own card, reaches the teammate through room.card
// (room.state seats[].card) and survives a reload; 默认 clears it; Esc closes the picker and gives the focus back; on a
// phone in landscape the picker fits the screen and its grid scrolls inside it, with no on-screen keyboard.
// The rooms are made through net (room.create / room.join), so the test does not depend on the lobby's layout.
// Server side: test/lobby-card.test.js; the pure rules: test/ui/seat-art.test.js.
//
//   SP_E2E=1 node --test test/ui/room-cards.e2e.test.js
//
// Screenshots: test/e2e/out/room-cards-*.png.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Client, ROOT, hasChrome, startRealServer, problemsOf } from '../e2e/client.mjs';

const ENABLED = process.env.SP_E2E === '1' && hasChrome() && existsSync(path.join(ROOT, 'public/assets'));
const PICK = 'char_1012_skadi2'; // 浊心斯卡蒂, 6★

const request = (c, t, body) => c.page.evaluate(async (t, body) => {
  const { net } = await import('/js/net.js');
  return net.request(t, body).then(() => 'ok', (e) => e?.code || 'error');
}, t, body);

/** The seat cards as one client draws them. */
const seats = (c) => c.page.evaluate(() => [...document.querySelectorAll('.seats .seat')].map((el) => ({
  name: el.querySelector('.seat__name')?.textContent || null,
  empty: el.classList.contains('seat--empty'),
  bot: el.classList.contains('is-bot'),
  me: el.classList.contains('is-me'),
  art: el.querySelector('img.seat__portrait')?.getAttribute('src') || null,
  op: el.querySelector('.seat__op')?.textContent || null,
  pick: !!el.querySelector('[data-testid="seat-card-pick"]'),
  frame: !!el.querySelector('.seat__art .avatar'),
})));
const seatNamed = async (c, name) => (await seats(c)).find((s) => s.name === name);
/** Waits until `name`'s card on `c`'s screen shows the operator `op` (its portrait loaded). */
const waitOp = (c, name, op, what) => c.page.waitForFunction((name, op) => {
  const el = [...document.querySelectorAll('.seats .seat')].find((x) => x.querySelector('.seat__name')?.textContent === name);
  const img = el?.querySelector('img.seat__portrait');
  return !!img && img.complete && img.naturalWidth > 0 && (op == null || el.querySelector('.seat__op')?.textContent === op);
}, { timeout: 10000 }, name, op).catch((e) => { throw new Error(`${c.label}: ${what}: ${e.message}`); });

const picker = (c) => c.page.evaluate(() => {
  const box = document.querySelector('.modal__box.cardpick');
  if (!box) return null;
  const grid = box.querySelector('[data-testid="card-picker"]');
  const r = box.getBoundingClientRect();
  return {
    tiles: grid.querySelectorAll('.cardpick__op[data-char]:not([data-char=""])').length,
    names: [...grid.querySelectorAll('.cardpick__op[data-char]:not([data-char=""]) .cardpick__name')].map((e) => e.textContent),
    on: [...grid.querySelectorAll('.cardpick__op.is-on')].map((e) => e.dataset.char),
    focus: document.activeElement?.dataset?.char ?? (document.activeElement?.tagName || null),
    inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5,
    gridScrolls: grid.scrollHeight > grid.clientHeight + 1,
    bodyScrolls: box.querySelector('.modal__body').scrollHeight > box.querySelector('.modal__body').clientHeight + 1,
    pageFits: document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight,
  };
});

describe('名片干员 seat cards (real server)', { skip: !ENABLED && 'set SP_E2E=1 (Chrome + public/assets)' }, () => {
  test('default portraits, the picker, the pick on both screens and after a reload, 默认, a phone', { timeout: 4 * 60 * 1000 }, async () => {
    const srv = await startRealServer();
    const P = (await import('puppeteer-core')).default;
    const host = new Client(P, srv.base, 'host', { prefix: 'room-cards' });
    const guest = new Client(P, srv.base, 'guest', { prefix: 'room-cards', w: 1280, h: 720 });
    try {
      await host.open();
      await host.enter('凯尔希');
      assert.equal(await request(host, 'room.create', { mode: 'coop', difficulty: 'NORMAL' }), 'ok');
      const { code } = (await host.waitFor((s) => !!s.room?.code, 'room created')).room;
      await host.page.waitForSelector('.room-screen .seat.is-me');
      await guest.open();
      await guest.enter('阿米娅');
      assert.equal(await request(guest, 'room.join', { code }), 'ok');
      await guest.page.waitForSelector('.room-screen .seat.is-me');
      await host.click('.seat--empty button', '添加 AI 队友');
      await host.page.waitForSelector('.seat.is-bot');
      await guest.page.waitForSelector('.seat.is-bot');

      // default portraits: every doctor has one, the same on both screens; a bot keeps its frame; 更换立绘 only on one's own
      for (const c of [host, guest]) for (const name of ['凯尔希', '阿米娅']) await waitOp(c, name, null, `${name}'s portrait`);
      const hv = await seats(host), gv = await seats(guest);
      for (const view of [hv, gv]) {
        const docs = view.filter((s) => !s.empty && !s.bot);
        assert.equal(docs.length, 2);
        assert.ok(docs.every((s) => s.art && s.op && !s.frame), JSON.stringify(docs));
        assert.deepEqual(view.filter((s) => s.pick).map((s) => s.me), [true], 'only one\'s own card offers 更换立绘');
        const bot = view.find((s) => s.bot);
        assert.ok(bot.frame && !bot.art && !bot.op && !bot.pick, JSON.stringify(bot));
      }
      for (const name of ['凯尔希', '阿米娅']) {
        assert.equal(hv.find((s) => s.name === name).op, gv.find((s) => s.name === name).op, `${name}: the same default on both screens`);
      }
      await host.shot('room-default');

      // 就绪 (PR #643 转场): the seat of a doctor who turns ready flashes once on the other screen, then stays lit
      assert.equal(await host.page.$('.seat.is-flash'), null, 'nothing flashes for seats already there');
      assert.equal(await request(guest, 'room.ready', { ready: true }), 'ok');
      await host.page.waitForSelector('.seat.is-flash.is-ready', { timeout: 3000 });
      await host.page.waitForSelector('.seat.is-flash', { hidden: true, timeout: 3000 });
      assert.ok(await host.page.$('.seat.is-ready.is-lit'), 'the ready seat stays lit');
      assert.equal(await request(guest, 'room.ready', { ready: false }), 'ok');

      // the picker: 默认 is the choice and has the focus; search and rarity filter the tiles
      await host.click('[data-testid="seat-card-pick"]');
      await host.page.waitForSelector('.modal__box.cardpick');
      let pk = await picker(host);
      assert.ok(pk.tiles > 100, `tiles: ${pk.tiles}`);
      assert.deepEqual(pk.on, ['']);
      assert.equal(pk.focus, '', 'the current choice (默认) takes the focus');
      assert.ok(pk.inside && pk.pageFits && !pk.bodyScrolls, JSON.stringify(pk));
      await host.click('.cardpick__search input');
      await host.page.keyboard.type('斯卡蒂');
      await host.page.waitForFunction(() => document.querySelectorAll('.cardpick__op[data-char]:not([data-char=""])').length === 2);
      assert.deepEqual((await picker(host)).names.sort(), ['斯卡蒂', '浊心斯卡蒂'].sort());
      await host.click('.cardpick__search input');
      await host.page.keyboard.down('Control'); await host.page.keyboard.press('KeyA'); await host.page.keyboard.up('Control');
      await host.page.keyboard.press('Backspace');
      await host.page.waitForFunction(() => document.querySelectorAll('.cardpick__op[data-char]:not([data-char=""])').length > 100);
      await host.click('.cardpick__stars button', '5★');
      pk = await picker(host);
      assert.ok(pk.tiles > 20 && pk.tiles < 60, `5★ tiles: ${pk.tiles}`);
      await host.click('.cardpick__stars button', '6★');
      await host.shot('picker');
      await host.page.$eval(`.cardpick__op[data-char="${PICK}"]`, (el) => el.scrollIntoView({ block: 'center' })); // the grid scrolls
      await host.click(`.cardpick__op[data-char="${PICK}"]`);
      await host.page.waitForFunction(() => !document.querySelector('.modal__box.cardpick'));

      // the pick: at once on one's own card, then on the teammate's screen (room.card → seats[].card), and kept as a pref
      assert.equal((await seatNamed(host, '凯尔希')).op, '浊心斯卡蒂');
      await waitOp(guest, '凯尔希', '浊心斯卡蒂', 'the teammate sees the pick');
      assert.equal(await host.page.evaluate(() => localStorage.getItem('sp.pref.room.card')), JSON.stringify(PICK));
      assert.equal(await guest.page.evaluate(() => globalThis.__SP__.store.get().room.seats.find((s) => s?.name === '凯尔希')?.card), PICK);
      await guest.shot('room-picked');

      // reopening: the pick is the choice; Esc closes the picker and gives the focus back to 更换立绘
      await host.click('[data-testid="seat-card-pick"]');
      await host.page.waitForSelector('.modal__box.cardpick');
      pk = await picker(host);
      assert.deepEqual(pk.on, [PICK]);
      assert.equal(pk.focus, PICK);
      await host.page.keyboard.press('Escape');
      await host.page.waitForFunction(() => !document.querySelector('.modal__box.cardpick'));
      assert.equal(await host.page.evaluate(() => document.activeElement?.dataset?.testid || null), 'seat-card-pick');

      // a reload resumes the seat with the pick
      await host.page.reload({ waitUntil: 'domcontentloaded' });
      await host.page.waitForSelector('.room-screen .seat.is-me');
      await waitOp(host, '凯尔希', '浊心斯卡蒂', 'the pick after a reload');

      // 默认 clears it: the teammate is back on the default
      await host.click('[data-testid="seat-card-pick"]');
      await host.page.waitForSelector('.modal__box.cardpick');
      // (the focus on the pick scrolled the grid down to it: 默认 is the first tile)
      await host.page.$eval('.cardpick__op[data-char=""]', (el) => el.scrollIntoView({ block: 'center' }));
      await host.click('.cardpick__op[data-char=""]');
      const before = hv.find((s) => s.name === '凯尔希').op;
      await waitOp(guest, '凯尔希', before, 'default again');
      assert.equal(await guest.page.evaluate(() => 'card' in globalThis.__SP__.store.get().room.seats.find((s) => s?.name === '凯尔希')), false);

      // a phone in landscape: the picker fits, its grid scrolls inside it, no input takes the focus
      for (const [w, h] of [[844, 390], [667, 375]]) {
        await guest.page.setViewport({ width: w, height: h, isMobile: true, hasTouch: true });
        await guest.page.waitForFunction(() => document.querySelector('.seat.is-me [data-testid="seat-card-pick"]')?.getClientRects().length > 0);
        await guest.click('[data-testid="seat-card-pick"]');
        await guest.page.waitForSelector('.modal__box.cardpick');
        pk = await picker(guest);
        assert.ok(pk.inside && pk.pageFits && pk.gridScrolls && !pk.bodyScrolls, `${w}×${h}: ${JSON.stringify(pk)}`);
        assert.notEqual(pk.focus, 'INPUT');
        await guest.page.screenshot({ path: path.join(ROOT, `test/e2e/out/room-cards-picker-${w}.png`) });
        await guest.page.keyboard.press('Escape');
        await guest.page.waitForFunction(() => !document.querySelector('.modal__box.cardpick'));
      }

      assert.deepEqual(problemsOf([host, guest]), []);
    } finally {
      await host.close();
      await guest.close();
      await srv.stop();
    }
  });
});
