import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Client, ROOT, hasChrome, startRealServer, problemsOf } from '../e2e/client.mjs';

test('Blaze the Igniting Spark keeps her face inside the strategy name card (#886)', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 90000,
}, async () => {
  const srv = await startRealServer();
  const P = (await import('puppeteer-core')).default;
  const c = new Client(P, srv.base, 'portrait', { prefix: 'draft-portrait' });
  try {
    await c.open();
    await c.enter('名片检查');
    await c.page.evaluate(async () => {
      const { net } = await import('/js/net.js');
      await net.request('room.create', { mode: 'coop', difficulty: 'NORMAL' });
    });
    await c.page.waitForSelector('[data-testid="seat-card-pick"]');
    await c.click('[data-testid="seat-card-pick"]');
    const pick = '.cardpick__op[data-char="char_1040_blaze2"]';
    // the picker lists the operators once the room screen's chess data has loaded (requested as the room opens)
    await c.page.waitForSelector(pick);
    await c.page.$eval(pick, (el) => el.scrollIntoView({ block: 'center' }));
    await c.click(pick);
    await c.page.waitForFunction(() => globalThis.__SP__.store.get().room.seats.some((s) => s?.card === 'char_1040_blaze2'));
    await c.page.evaluate(async () => {
      const { net } = await import('/js/net.js');
      for (let i = 0; i < 3; i++) await net.request('room.addBot', {});
      await net.request('room.start', {});
    });
    await c.click('.brief__foot .btn--primary', '准备就绪');
    await c.page.waitForSelector('.dorder__art');
    await c.page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 2500))); // let the phase banner finish
    for (const [width, height] of [[1920, 1080], [1280, 720], [844, 390]]) {
      await c.page.setViewport({ width, height });
      await c.page.waitForFunction(() => [...document.querySelectorAll('.dorder__art')].some((img) => img.src.includes('char_1040_blaze2_2') && img.complete && img.naturalWidth > 0));
      const crop = await c.page.evaluate(() => {
        const img = [...document.querySelectorAll('.dorder__art')].find((img) => img.src.includes('char_1040_blaze2_2'));
        const style = getComputedStyle(img), r = img.getBoundingClientRect();
        const scale = Math.max(r.width / img.naturalWidth, r.height / img.naturalHeight);
        const offset = parseFloat(style.objectPosition.split(' ')[1]) / 100;
        const top = (img.naturalHeight - r.height / scale) * offset;
        return { top, bottom: top + r.height / scale, natural: [img.naturalWidth, img.naturalHeight] };
      });
      // Visually checked on the shipped 180×360 portrait: eyes through chin occupy y=120..180.
      assert.deepEqual(crop.natural, [180, 360]);
      assert.ok(crop.top <= 120 && crop.bottom >= 180, `${width}×${height}: ${JSON.stringify(crop)}`);
      await c.shot(`${width}`);
    }
    assert.deepEqual(problemsOf([c]), []);
  } finally {
    await c.close();
    await srv.stop();
  }
});

// #877 (DESIGN §37.325): a teammate's 名片干员 of another period (摆渡人: only 规程 lists him, the room plays 第二期下半)
// shows on the strategy draft's name card in that teammate's outfit. The match keeps only the outfits of the operators
// its data knows (server/match/player/basics.js setSkins; 第二期下半's data has no 摆渡人 at all — unlike 蜜蜡, whose
// hidden chess records it keeps), so the draft reads his from the room's seats (ui/seatArt.js cardSkinPlayers); with
// 「显示其他玩家的皮肤」 off the card shows his elite portrait. The outfit is laid over both pages' art manifests as an
// appearance plugin composes one (its portrait another operator's real one, so it loads).
const OTHER = 'char_4166_varkis';
const SKIN = `${OTHER}@e2e#1`;
const addOutfit = (c) => c.page.evaluate(async (charId, skinId) => {
  const { data } = await import('/js/data.js');
  const m = data.get('assets');
  const url = Object.entries(m.chars).find(([id, e]) => id !== charId && typeof e?.portrait === 'string')[1].portrait;
  data.setView('assets', (v) => ({ ...v, chars: { ...v.chars,
    [charId]: { ...v.chars[charId], skins: { ...(v.chars[charId].skins || {}), [skinId]: { name: 'E2E', portrait: url, portraitE2: url } } } } }));
  return url;
}, OTHER, SKIN);
const request = (c, type, body = {}) => c.page.evaluate((t, b) => globalThis.__SP__.net.request(t, b).then(() => 'ok', (e) => e?.code || 'error'), type, body);
/** The src of `name`'s draft name card once it is `want` and loaded (a RegExp or a string). */
const draftArt = (c, name, want, what) => c.page.waitForFunction((name, src, flags) => {
  const row = [...document.querySelectorAll('.dorder')].find((r) => r.querySelector('.dorder__name span')?.textContent === name);
  const img = row?.querySelector('.dorder__art');
  return !!img && img.complete && img.naturalWidth > 0 && (flags == null ? img.getAttribute('src') === src : new RegExp(src, flags).test(img.getAttribute('src')));
}, { timeout: 15000 }, name, want instanceof RegExp ? want.source : want, want instanceof RegExp ? want.flags : null)
  .catch((e) => { throw new Error(`${c.label}: ${what}: ${e.message}`); });

test('a teammate\'s card of another period shows on the strategy name card in the teammate\'s outfit (#877)', {
  skip: (process.env.SP_E2E !== '1' || !hasChrome() || !existsSync(path.join(ROOT, 'public/assets'))) && 'set SP_E2E=1 (Chrome + public/assets)',
  timeout: 3 * 60 * 1000,
}, async () => {
  const srv = await startRealServer();
  const P = (await import('puppeteer-core')).default;
  const host = new Client(P, srv.base, 'host', { prefix: 'draft-portrait-other' });
  const guest = new Client(P, srv.base, 'guest', { prefix: 'draft-portrait-other', w: 1280, h: 720 });
  try {
    await host.open();
    await host.enter('凯尔希');
    assert.equal(await request(host, 'room.create', { mode: 'coop', difficulty: 'NORMAL' }), 'ok');
    const { code } = (await host.waitFor((s) => !!s.room?.code, 'room created')).room;
    await guest.open();
    await guest.enter('阿米娅');
    assert.equal(await request(guest, 'room.join', { code }), 'ok');
    await guest.page.waitForSelector('.room-screen .seat.is-me');
    // the guest picks 摆渡人 and wears an outfit of his; the host's page has that appearance too
    await guest.page.evaluate(async (id) => (await import('/js/ui/seatArt.js')).setCard(id), OTHER);
    const outfit = await addOutfit(guest);
    assert.equal(await addOutfit(host), outfit);
    await guest.page.evaluate(async (id, skin) => (await import('/js/ui/skins.js')).setSkin(id, skin), OTHER, SKIN);
    await host.page.waitForFunction((id, skin) => {
      const s = globalThis.__SP__.store.get().room.seats.find((x) => x?.name === '阿米娅');
      return s?.card === id && s?.skins?.[id] === skin;
    }, { timeout: 10000 }, OTHER, SKIN);
    for (let i = 0; i < 2; i++) assert.equal(await request(host, 'room.addBot'), 'ok');
    assert.equal(await request(guest, 'room.ready', { ready: true }), 'ok');
    assert.equal(await request(host, 'room.start'), 'ok');
    for (const c of [host, guest]) await c.click('.brief__foot .btn--primary', '准备就绪');
    for (const c of [host, guest]) await c.page.waitForSelector('.dorder__art');
    // the match does not carry his outfit: the name card takes it from the room's seats
    assert.equal(await host.page.evaluate((id) => globalThis.__SP__.store.get().match.public?.players?.find((p) => p.name === '阿米娅')?.skins?.[id] ?? null, OTHER), null);
    await draftArt(host, '阿米娅', outfit, 'the teammate\'s card in her outfit');
    await draftArt(guest, '阿米娅', outfit, 'one\'s own card in one\'s outfit');
    await host.shot('outfit');
    // 「显示其他玩家的皮肤」 off: the teammate's card shows 摆渡人's elite portrait
    await host.page.evaluate(async () => (await import('/js/ui/settingsStore.js')).settingsStore.set({ otherSkins: false }));
    await draftArt(host, '阿米娅', /\/char_4166_varkis_2\.(png|webp)(\?|$)/, 'his elite portrait without the outfit');
    await host.shot('plain');
    assert.deepEqual(problemsOf([host, guest]), []);
  } finally {
    await host.close();
    await guest.close();
    await srv.stop();
  }
});
