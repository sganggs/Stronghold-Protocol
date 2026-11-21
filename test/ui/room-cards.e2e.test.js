// Real-server browser E2E — 名片干员 on the room's seat cards (PR #643 split 6). Two doctors in a co-op room: every
// doctor's card shows a portrait (the default chosen by the player id — the same operator on both screens), a bot keeps
// its robot frame and flashes once when it is added (only it), only one's own card has 更换立绘; the picker (the
// project's Modal) opens with the current choice focused, filters by name and rarity, a pick shows at once on one's own
// card, reaches the teammate through room.card (room.state seats[].card) and survives a reload; the card wears its
// player's outfit (the maintainer's decision 4 of 2026-10-21: one's own at once, the teammate's through room.skins →
// room.state seats[].skins once the teammate's page has that appearance, the default without it or with
// 「显示其他玩家的皮肤」 off; an outfit picture that fails to load gives way to the default portrait, not the avatar
// frame); 默认 clears the pick; Esc closes the picker and gives the focus back; on a phone in landscape
// the picker fits the screen and its grid scrolls inside it, with no on-screen keyboard.
// Other periods (#877, DESIGN §37.325): the picker's tiles come in groups (本房间版本 first, then 其他时期 newest first);
// an operator only another period lists (蜜蜡, 第二期上半 alone) is found by its Chinese name and by its appellation, in
// that period's group, shows on both screens in its E2 art, survives a reload and a version switch, and a 第二期下半 room
// loads no other version's data for it (one /data/card-roster.json per page load, no /data/versions/). Without the
// roster (a 404) the picker keeps the room's group, says so with 重试, a cross-period pref shows the default on both
// screens and is not sent; 重试 brings the groups and the card back.
// The rooms are made through net (room.create / room.join), so the test does not depend on the lobby's layout.
// Server side: test/lobby-card.test.js; the pure rules: test/ui/seat-art.test.js, test/ui/card-sync.test.js.
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

/** The src of `name`'s portrait on `c`'s screen once it is `src` (an outfit or the default art). */
const waitArt = (c, name, src, what) => c.page.waitForFunction((name, src) => {
  const el = [...document.querySelectorAll('.seats .seat')].find((x) => x.querySelector('.seat__name')?.textContent === name);
  return el?.querySelector('img.seat__portrait')?.getAttribute('src') === src;
}, { timeout: 10000 }, name, src).catch((e) => { throw new Error(`${c.label}: ${what}: ${e.message}`); });

/**
 * Lays an outfit of `charId` over this page's art manifest, as an appearance plugin composes one (data.js setView): its
 * portrait is another operator's real one, so it loads. Returns that URL (the same on every page: the same manifest).
 */
const addOutfit = (c, charId, skinId) => c.page.evaluate(async (charId, skinId) => {
  const { data } = await import('/js/data.js');
  const m = data.get('assets');
  const url = Object.entries(m.chars).find(([id, e]) => id !== charId && typeof e?.portrait === 'string')[1].portrait;
  data.setView('assets', (v) => ({ ...v, chars: { ...v.chars,
    [charId]: { ...v.chars[charId], skins: { ...(v.chars[charId].skins || {}), [skinId]: { name: 'E2E', portrait: url, portraitE2: url } } } } }));
  return url;
}, charId, skinId);

const picker = (c) => c.page.evaluate(() => {
  const box = document.querySelector('.modal__box.cardpick');
  if (!box) return null;
  const grid = box.querySelector('[data-testid="card-picker"]');
  const r = box.getBoundingClientRect();
  return {
    tiles: grid.querySelectorAll('.cardpick__op[data-char]:not([data-char=""])').length,
    room: grid.querySelectorAll('.cardpick__op[data-group="room"][data-char]:not([data-char=""])').length,
    groups: [...grid.querySelectorAll('.cardpick__group')].map((e) => e.dataset.group),
    names: [...grid.querySelectorAll('.cardpick__op[data-char]:not([data-char=""]) .cardpick__name')].map((e) => e.textContent),
    on: [...grid.querySelectorAll('.cardpick__op.is-on')].map((e) => e.dataset.char),
    focus: document.activeElement?.dataset?.char ?? (document.activeElement?.tagName || null),
    inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5,
    gridScrolls: grid.scrollHeight > grid.clientHeight + 1,
    bodyScrolls: box.querySelector('.modal__body').scrollHeight > box.querySelector('.modal__body').clientHeight + 1,
    pageFits: document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight,
  };
});

// ---- other periods (#877, DESIGN §37.325) -------------------------------------------------------------------------
const BEE = 'char_344_beewax'; // 蜜蜡 (Beeswax): only 第二期上半 lists her — another period in a 第二期下半 room
const ROSTER = '/data/card-roster.json';
/** Her elite portrait (the roster's golden rule: 第二期上半 has her elite chess record). */
const E2_ART = /\/char_344_beewax_2\.(png|webp)(\?|$)/;

/**
 * puppeteer-core whose browser hands its first page to `setup` before Client.open loads the site — listeners and
 * scripts set there see the page's very first request (Client.open takes that same page).
 */
const withPage = (P, setup) => ({
  launch: async (opts) => {
    const browser = await P.launch(opts);
    const [page] = await browser.pages();
    await setup(page);
    return browser;
  },
});
/** Records every request of the page: `nav` counts the main frame's loads (Client.open's, a reload). */
const track = (log) => async (page) => {
  let nav = 0;
  page.on('request', (r) => {
    if (r.isNavigationRequest() && r.frame() === page.mainFrame()) nav++;
    let p = '';
    try { p = new URL(r.url()).pathname; } catch { /* not a URL */ }
    log.push({ nav, path: p });
  });
};
/** While `gate.blocked`, the page's data/card-roster.json answers 404 (CDP Fetch: only that file pauses). */
const rosterGate = (gate) => async (page) => {
  const cdp = await page.createCDPSession();
  cdp.on('Fetch.requestPaused', ({ requestId }) => {
    (gate.blocked
      ? cdp.send('Fetch.fulfillRequest', { requestId, responseCode: 404, responseHeaders: [{ name: 'Content-Type', value: 'text/plain' }],
        body: Buffer.from('not here').toString('base64') })
      : cdp.send('Fetch.continueRequest', { requestId })).catch(() => {});
  });
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: `*${ROSTER}*`, requestStage: 'Request' }] });
};
/** The page starts with `charId` as its 名片干员 pref (written before the first load while the browser has none). */
const seedCard = (charId) => (page) => page.evaluateOnNewDocument((id) => {
  if (window.top !== window || !/^https?:$/.test(location.protocol)) return;
  if (localStorage.getItem('sp.pref.room.card') == null) localStorage.setItem('sp.pref.room.card', JSON.stringify(id));
}, charId);
/** `name`'s seat card in `c`'s store (room.state seats[]). */
const storeSeat = (c, name) => c.page.evaluate((name) => {
  const s = globalThis.__SP__.store.get().room?.seats?.find((x) => x?.name === name);
  return s ? { card: s.card ?? null, skins: s.skins ?? null } : null;
}, name);
const waitStoreCard = (c, name, card, what) => c.page.waitForFunction((name, card) =>
  (globalThis.__SP__.store.get().room?.seats?.find((x) => x?.name === name)?.card ?? null) === card, { timeout: 10000 }, name, card)
  .catch((e) => { throw new Error(`${c.label}: ${what}: ${e.message}`); });
/** Types `text` into the picker's search (the field emptied first). */
const search = async (c, text) => {
  await c.page.$eval('.cardpick__search input', (el) => { el.focus(); el.select(); });
  await c.page.keyboard.press('Backspace');
  if (text) await c.page.keyboard.type(text);
};
const openPicker = async (c) => {
  await c.click('[data-testid="seat-card-pick"]');
  await c.page.waitForSelector('.modal__box.cardpick');
};
const closePicker = async (c) => {
  await c.page.keyboard.press('Escape');
  await c.page.waitForFunction(() => !document.querySelector('.modal__box.cardpick'));
};
/** Waits until the room plays `version` and the page shows that version's data (as test/ui/versions.e2e.test.js). */
const roomOn = (c, version, what) => c.page.waitForFunction((v) => {
  const r = globalThis.__SP__.store.get().room;
  return !!r && (r.version ?? 'act2autochess') === v && !r.versionVote
    && (globalThis.__SP__.data.get('config')?.version?.id ?? 'act2autochess') === v;
}, { timeout: 30000 }, version).catch((e) => { throw new Error(`${c.label}: ${what}: ${e.message}`); });

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
      // an AI teammate added while the room is open flashes once on both screens (转场, ui/transitions.js useRise), alone
      const guestFlash = guest.page.waitForSelector('.seat.is-bot.is-flash', { timeout: 5000 }).then(() => null, (e) => e);
      await host.click('.seat--empty button', '添加 AI 队友');
      await host.page.waitForSelector('.seat.is-bot.is-flash', { timeout: 5000 });
      assert.equal(await host.page.$$eval('.seat.is-flash', (els) => els.length), 1, 'only the new card flashes');
      assert.equal(await guestFlash, null, 'the teammate\'s screen flashes the new card too');
      for (const c of [host, guest]) await c.page.waitForSelector('.seat.is-flash', { hidden: true, timeout: 3000 });

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
      // (the field's text selected by the page, then deleted by a key: Ctrl+A only moves the caret on macOS)
      await host.page.$eval('.cardpick__search input', (el) => { el.focus(); el.select(); });
      await host.page.keyboard.press('Backspace');
      await host.page.waitForFunction(() => document.querySelectorAll('.cardpick__op[data-char]:not([data-char=""])').length > 100);
      await host.click('.cardpick__stars button', '5★');
      pk = await picker(host);
      // (#877: the room's own group; the other periods' 5★ follow under their headings)
      assert.ok(pk.room > 20 && pk.room < 60, `5★ tiles of the room's group: ${pk.room}`);
      assert.ok(pk.tiles > pk.room, `5★ tiles of every group: ${pk.tiles}`);
      await host.click('.cardpick__stars button', '6★');
      await host.shot('picker');
      await host.page.$eval(`.cardpick__op[data-char="${PICK}"]`, (el) => el.scrollIntoView({ block: 'center' })); // the grid scrolls
      await host.click(`.cardpick__op[data-char="${PICK}"]`);
      await host.page.waitForFunction(() => !document.querySelector('.modal__box.cardpick'));

      // the pick: at once on one's own card, then on the teammate's screen (room.card → seats[].card), and kept as a pref
      assert.equal((await seatNamed(host, '凯尔希')).op, '浊心斯卡蒂');
      await waitOp(guest, '凯尔希', '浊心斯卡蒂', 'the teammate sees the pick');
      assert.equal(await host.page.evaluate(() => localStorage.getItem('sp.pref.room.card')), JSON.stringify(PICK));
      // The default portrait can already be PICK; its image alone does not prove room.card reached the teammate.
      await guest.page.waitForFunction((id) => globalThis.__SP__.store.get().room.seats.find((s) => s?.name === '凯尔希')?.card === id,
        { timeout: 10000 }, PICK);
      assert.equal(await guest.page.evaluate(() => globalThis.__SP__.store.get().room.seats.find((s) => s?.name === '凯尔希')?.card), PICK);
      await guest.shot('room-picked');

      // outfits (decision 4): one's own card wears one's own at once; the teammate's page shows it once it has that
      // appearance (room.skins → room.state seats[].skins), the default before, and with 「显示其他玩家的皮肤」 off
      const SKIN = `${PICK}@e2e#1`;
      const plain = (await seatNamed(guest, '凯尔希')).art;
      const outfit = await addOutfit(host, PICK, SKIN);
      assert.notEqual(outfit, plain);
      await host.page.evaluate(async (id, skin) => (await import('/js/ui/skins.js')).setSkin(id, skin), PICK, SKIN);
      await waitArt(host, '凯尔希', outfit, 'one\'s own card wears one\'s outfit');
      await guest.page.waitForFunction((id, skin) => globalThis.__SP__.store.get().room.seats.find((s) => s?.name === '凯尔希')?.skins?.[id] === skin,
        { timeout: 10000 }, PICK, SKIN);
      assert.equal((await seatNamed(guest, '凯尔希')).art, plain, 'an outfit this page has no appearance for: the default art');
      assert.equal(await addOutfit(guest, PICK, SKIN), outfit);
      await waitArt(guest, '凯尔希', outfit, 'the teammate sees the outfit');
      await guest.shot('room-outfit');
      const otherSkins = (on) => guest.page.evaluate(async (on) => (await import('/js/ui/settingsStore.js')).settingsStore.set({ otherSkins: on }), on);
      await otherSkins(false);
      await waitArt(guest, '凯尔希', plain, '显示其他玩家的皮肤 off');
      assert.equal((await seatNamed(host, '凯尔希')).art, outfit, 'the switch is the guest\'s alone');
      await otherSkins(true);
      await waitArt(guest, '凯尔希', outfit, '显示其他玩家的皮肤 on again');
      await host.page.evaluate(async (id) => (await import('/js/ui/skins.js')).clearSkin(id), PICK);
      await waitArt(guest, '凯尔希', plain, 'the outfit taken off');
      assert.equal(await guest.page.evaluate(() => 'skins' in globalThis.__SP__.store.get().room.seats.find((s) => s?.name === '凯尔希')), false);
      // an outfit whose picture fails to load (a broken file) gives way to the default portrait, not the avatar frame
      // (§35.18's leftover)
      const BROKEN = `${PICK}@e2e#broken`;
      const brokenUrl = await host.page.evaluate(async (charId, skinId) => {
        const { data } = await import('/js/data.js');
        const url = 'data:image/png;base64,AAAA'; // not an image: the load fails without a request
        data.setView('assets', (v) => ({ ...v, chars: { ...v.chars,
          [charId]: { ...v.chars[charId], skins: { ...(v.chars[charId].skins || {}), [skinId]: { name: 'E2E', portrait: url, portraitE2: url } } } } }));
        (await import('/js/ui/skins.js')).setSkin(charId, skinId);
        return url;
      }, PICK, BROKEN);
      await waitArt(host, '凯尔希', plain, 'a broken outfit picture: the default portrait');
      await waitOp(host, '凯尔希', '浊心斯卡蒂', 'the default portrait loaded');
      assert.equal((await seatNamed(host, '凯尔希')).frame, false, 'not the avatar frame');
      assert.notEqual(plain, brokenUrl);
      await host.page.evaluate(async (id) => (await import('/js/ui/skins.js')).clearSkin(id), PICK);

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
      await guest.page.waitForFunction(() => !('card' in globalThis.__SP__.store.get().room.seats.find((s) => s?.name === '凯尔希')),
        { timeout: 10000 });
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

  test('another period\'s operator: its group, both screens, a reload, a version switch, no version data for it (#877)', { timeout: 4 * 60 * 1000 }, async () => {
    const srv = await startRealServer();
    const P = (await import('puppeteer-core')).default;
    const reqs = { host: [], guest: [] };
    const host = new Client(withPage(P, track(reqs.host)), srv.base, 'host', { prefix: 'room-cards-other' });
    const guest = new Client(withPage(P, track(reqs.guest)), srv.base, 'guest', { prefix: 'room-cards-other', w: 1280, h: 720 });
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
      for (const c of [host, guest]) await waitOp(c, '凯尔希', null, 'the host\'s default portrait');
      assert.ok(reqs.host.length && reqs.guest.length, 'the request logs see the pages');

      // the groups: 本房间版本 first with 默认 as its first tile, then the other periods newest first, each operator once
      await openPicker(host);
      await host.page.waitForSelector(`.cardpick__op[data-char="${BEE}"]`, { timeout: 10000 }); // the roster is in
      let pk = await picker(host);
      assert.deepEqual(pk.groups, ['room', 'act3autochess@V3_1', 'act2autochess@V2_1', 'act1autochess']);
      const layout = await host.page.evaluate(() => {
        const grid = document.querySelector('[data-testid="card-picker"]');
        const tiles = [...grid.querySelectorAll('.cardpick__op[data-char]:not([data-char=""])')];
        const per = {};
        for (const el of tiles) per[el.dataset.group] = (per[el.dataset.group] || 0) + 1;
        return {
          first: grid.querySelector('.cardpick__op')?.dataset.char ?? null,
          unique: new Set(tiles.map((el) => el.dataset.char)).size === tiles.length,
          per,
          headingWide: [...grid.querySelectorAll('.cardpick__group')].every((h) => Math.abs(h.getBoundingClientRect().width - grid.clientWidth) < 24),
          title: grid.querySelector('.cardpick__op[data-char="char_344_beewax"]')?.title ?? null,
          notices: [...document.querySelectorAll('.cardpick__notice')].map((e) => e.dataset.testid),
        };
      });
      assert.equal(layout.first, '', '默认 is the first tile');
      assert.ok(layout.unique, 'each operator once');
      assert.ok(layout.per.room > 100 && Object.keys(layout.per).length === 4 && Object.values(layout.per).every((n) => n > 0), JSON.stringify(layout.per));
      assert.ok(layout.headingWide, 'each heading spans the grid');
      assert.match(layout.title, /^蜜蜡 · 第二期上半$/, 'a cross-period tile names its period');
      assert.deepEqual(layout.notices, [], 'nothing loading, nothing failed, no lost pick');
      assert.ok(pk.inside && pk.pageFits && !pk.bodyScrolls, JSON.stringify(pk));
      await host.shot('picker-groups');

      // 蜜蜡 by her Chinese name and by her appellation: one tile, in 第二期上半's group (the other groups' headings hidden)
      for (const q of ['蜜蜡', 'Beeswax']) {
        await search(host, q);
        await host.page.waitForFunction(() => document.querySelectorAll('.cardpick__op[data-char]:not([data-char=""])').length === 1);
        pk = await picker(host);
        assert.deepEqual(pk.names, ['蜜蜡'], q);
        assert.deepEqual(pk.groups, ['room', 'act2autochess@V2_1'], q);
        assert.equal(await host.page.$eval('.cardpick__op[data-char]:not([data-char=""])', (el) => el.dataset.group), 'act2autochess@V2_1', q);
      }
      // her tile shows her avatar (the roster's records draw from the same art manifest)
      await host.page.waitForFunction((id) => {
        const img = document.querySelector(`.cardpick__op[data-char="${id}"] .cardpick__img img`);
        return !!img && img.complete && img.naturalWidth > 0;
      }, { timeout: 10000 }, BEE);
      await host.click(`.cardpick__op[data-char="${BEE}"]`);
      await host.page.waitForFunction(() => !document.querySelector('.modal__box.cardpick'));

      // the pick: one's own card at once, the teammate's through room.card; her E2 art and name; the pref written
      await waitOp(host, '凯尔希', '蜜蜡', 'one\'s own card shows the pick');
      await waitOp(guest, '凯尔希', '蜜蜡', 'the teammate sees the pick');
      await waitStoreCard(guest, '凯尔希', BEE, 'room.state seats[].card');
      for (const c of [host, guest]) assert.match((await seatNamed(c, '凯尔希')).art, E2_ART, `${c.label}: her elite portrait`);
      assert.equal(await host.page.evaluate(() => localStorage.getItem('sp.pref.room.card')), JSON.stringify(BEE));
      await guest.shot('room-picked');

      // a reload: one's own card is still 蜜蜡, the picker's focus on her tile
      await host.page.reload({ waitUntil: 'domcontentloaded' });
      await host.page.waitForSelector('.room-screen .seat.is-me');
      await waitOp(host, '凯尔希', '蜜蜡', 'the pick after a reload');
      await openPicker(host);
      await host.page.waitForSelector(`.cardpick__op.is-on[data-char="${BEE}"]`, { timeout: 10000 });
      await host.page.waitForFunction((id) => document.activeElement?.dataset?.char === id, { timeout: 5000 }, BEE);
      pk = await picker(host);
      assert.deepEqual(pk.on, [BEE]);
      assert.equal(pk.focus, BEE);
      await closePicker(host);

      // no other version's data for a 第二期下半 room, and one roster download per page load
      for (const [who, log] of Object.entries(reqs)) {
        assert.deepEqual(log.filter((r) => r.path.startsWith('/data/versions/')).map((r) => r.path), [], `${who}: no /data/versions/`);
        const per = {};
        for (const r of log) if (r.path === ROSTER) per[r.nav] = (per[r.nav] || 0) + 1;
        assert.ok(Object.values(per).length >= 1 && Object.values(per).every((n) => n === 1), `${who}: roster downloads per page load ${JSON.stringify(per)}`);
      }
      assert.ok(Math.max(...reqs.host.map((r) => r.nav)) >= 2, 'the host\'s log spans the reload');

      // the host switches the room to 规程 (the guest agrees): the card stays 蜜蜡 on both screens
      assert.equal(await request(host, 'room.proposeVersion', { version: 'act3autochess@V3_1' }), 'ok');
      const voteId = await guest.page.waitForFunction(() => globalThis.__SP__.store.get().room?.versionVote?.id, { timeout: 10000 }).then((h) => h.jsonValue());
      assert.equal(await request(guest, 'room.versionVote', { voteId, agree: true }), 'ok');
      for (const c of [host, guest]) await roomOn(c, 'act3autochess@V3_1', 'the room on 规程');
      for (const c of [host, guest]) {
        await waitStoreCard(c, '凯尔希', BEE, 'the card kept by the switch');
        await waitOp(c, '凯尔希', '蜜蜡', 'the card after the switch');
        assert.match((await seatNamed(c, '凯尔希')).art, E2_ART, `${c.label}: her elite portrait in the 规程 room`);
      }
      // in the 规程 room she is still another period's: in 第二期上半's group, the choice
      await openPicker(host);
      await host.page.waitForSelector(`.cardpick__op.is-on[data-char="${BEE}"]`, { timeout: 10000 });
      pk = await picker(host);
      assert.equal(pk.groups[0], 'room');
      assert.ok(pk.groups.includes('act2autochess@V2_1') && !pk.groups.includes('act3autochess@V3_1'), JSON.stringify(pk.groups));
      assert.equal(await host.page.$eval(`.cardpick__op[data-char="${BEE}"]`, (el) => el.dataset.group), 'act2autochess@V2_1');
      await host.shot('picker-v3');
      await closePicker(host);

      assert.deepEqual(problemsOf([host, guest]), []);
    } finally {
      await host.close();
      await guest.close();
      await srv.stop();
    }
  });

  test('without the roster: the room\'s group with 重试, a cross-period pref shows the default and waits, 重试 brings it back (#877)', { timeout: 3 * 60 * 1000 }, async () => {
    const srv = await startRealServer();
    const P = (await import('puppeteer-core')).default;
    const gate = { blocked: true };
    const host = new Client(withPage(P, async (page) => { await seedCard(BEE)(page); await rosterGate(gate)(page); }), srv.base, 'host', { prefix: 'room-cards-noroster' });
    const guest = new Client(withPage(P, rosterGate(gate)), srv.base, 'guest', { prefix: 'room-cards-noroster', w: 1280, h: 720 });
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

      // the picker: only the room's group, the failure with 重试, the pick that cannot show here; 默认 lit
      await openPicker(host);
      await host.page.waitForSelector('[data-testid="card-roster-failed"] button', { timeout: 10000 });
      await host.page.waitForSelector('[data-testid="card-pick-lost"]');
      let pk = await picker(host);
      assert.deepEqual(pk.groups, ['room']);
      assert.equal(await host.page.$(`.cardpick__op[data-char="${BEE}"]`), null);
      assert.deepEqual(pk.on, ['']);
      assert.ok(pk.inside && pk.pageFits, JSON.stringify(pk));
      await host.shot('picker-failed');

      // both screens draw the host's default (the same operator), and the pick never reached the server
      for (const c of [host, guest]) await waitOp(c, '凯尔希', null, 'the host\'s default portrait');
      const def = (await seatNamed(host, '凯尔希')).op;
      assert.notEqual(def, '蜜蜡');
      assert.equal((await seatNamed(guest, '凯尔希')).op, def, 'the same default on both screens');
      for (const c of [host, guest]) assert.equal((await storeSeat(c, '凯尔希')).card, null, `${c.label}: no card on the server`);
      assert.equal(await host.page.evaluate(() => localStorage.getItem('sp.pref.room.card')), JSON.stringify(BEE), 'the pref is kept');

      // 重试 once the roster answers: the groups, 蜜蜡 the choice, the card on one's own screen and on the server
      gate.blocked = false;
      await host.click('[data-testid="card-roster-failed"] button');
      await host.page.waitForSelector(`.cardpick__op.is-on[data-char="${BEE}"]`, { timeout: 10000 });
      pk = await picker(host);
      assert.ok(pk.groups.length > 1 && pk.groups.includes('act2autochess@V2_1'), JSON.stringify(pk.groups));
      assert.deepEqual(pk.on, [BEE]);
      assert.equal(await host.page.$('.cardpick__notice'), null, 'no notice left');
      await closePicker(host);
      await waitOp(host, '凯尔希', '蜜蜡', 'one\'s own card after 重试');
      await waitStoreCard(guest, '凯尔希', BEE, 'the pick sent once the roster arrived');
      // the teammate's page without the roster still draws the default; its own 重试 shows the pick
      assert.equal((await seatNamed(guest, '凯尔希')).op, def);
      await openPicker(guest);
      await guest.click('[data-testid="card-roster-failed"] button');
      await guest.page.waitForSelector(`.cardpick__op[data-char="${BEE}"]`, { timeout: 10000 });
      await closePicker(guest);
      await waitOp(guest, '凯尔希', '蜜蜡', 'the teammate after its 重试');
      assert.match((await seatNamed(guest, '凯尔希')).art, E2_ART);

      // the only problems: the blocked roster's 404s
      const problems = problemsOf([host, guest]);
      assert.ok(problems.some((p) => p.includes(ROSTER)), 'the roster was answered 404');
      assert.deepEqual(problems.filter((p) => !p.includes(ROSTER)), []);
    } finally {
      await host.close();
      await guest.close();
      await srv.stop();
    }
  });
});
