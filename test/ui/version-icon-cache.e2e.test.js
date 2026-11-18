// Real version hosts and renderer, including the page-lifetime texture cache (never render=fallback).
// SP_E2E=1 node --test test/ui/version-icon-cache.e2e.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, hasChrome, problemsOf, sleep } from '../e2e/client.mjs';

const enabled = process.env.SP_E2E === '1' && hasChrome();
const ITEM = 'chess_item_2_07_e_a'; // 第一期: 迅捷作战粮; 第二期: 见钱眼开玩偶
const PASSIVE = 'chess_item_2_01_e_a'; // 第一期: 歌利亚头盔; 第二期: 不屈弹射器
const req = (c, type, body = {}) => c.page.evaluate((type, body) => globalThis.__SP__.net.request(type, body), type, body);
const command = (c, cmd, args) => req(c, 'g.test', { cmd, args });
const versionReady = (c, version) => c.page.waitForFunction((version) => {
  const { data } = globalThis.__SP__;
  return (data.get('config')?.version?.id || 'act2autochess') === version
    && ['ready', 'idle'].includes(globalThis.__SP_CONTENT__.state().status);
}, { timeout: 30000 }, version);

async function choose(c, version) {
  await c.page.waitForSelector('.lobby-screen', { visible: true });
  // the chip comes with welcome's version list, which can follow the lobby by a moment (the third case of this file)
  await c.page.waitForSelector('[data-testid="version-switch"]', { visible: true });
  if (await c.page.$eval('[data-testid="version-switch"]', e => e.dataset.version) === version) return;
  await c.click('[data-testid="version-switch"]');
  await c.click(`.verpick__pick[data-version="${version}"]`);
  await versionReady(c, version);
}

async function start(c, version, inRoom = false) {
  if (!inRoom) await req(c, 'room.create', { mode: 'solo', difficulty: 'NORMAL', test: true, version, soloUnlimited: true });
  await versionReady(c, version);
  await c.page.waitForSelector('.rs-go:not(:disabled)', { visible: true });
  await req(c, 'room.start');
  await c.waitFor(s => s.phase === 'INFO_CHECK', 'match information');
  await req(c, 'g.infoReady');
  await c.waitFor(s => s.phase === 'BAND_DRAFT', 'strategy draft');
  await req(c, 'g.band', { bandId: 'band_bldsk' });
  await c.waitFor(s => s.phase === 'PREP', 'preparation');
  await command(c, 'funds', { amount: 1000 });
  for (let level = 2; level <= 5; level++) await req(c, 'g.levelUp');
  await c.waitFor(s => s.level === 5, 'equipment slots unlocked');
}

async function buy(c, id) {
  // Force the same reused ID into both versions' real shop; purchase still goes through the UI/server.
  const slots = await c.page.evaluate((id) => {
    const { data, store } = globalThis.__SP__;
    const layout = store.get().match.private.shop.layout;
    const chess = data.list('chess').find(x => !x.isGolden && !x.isDiy && x.tier === 1);
    return [...Array.from({ length: layout.chess }, () => ({ kind: 'chess', id: chess.chessId })),
      ...Array.from({ length: layout.item }, () => ({ kind: 'item', id }))];
  }, id);
  await command(c, 'shop', { slots });
  await req(c, 'g.refresh');
  await c.page.waitForSelector('.shopbar__item button.scard--item img', { visible: true });
  const offer = await c.page.evaluate((id) => {
    const { data } = globalThis.__SP__;
    const item = data.lookup('items', id);
    return { id, name: item.name, desc: item.desc, url: data.get('assets').items[item.iconId] };
  }, id);
  assert.equal(await c.page.$eval('.scard__itemart img', e => e.getAttribute('src')), offer.url);
  await c.click('.shopbar__item button.scard--item');
  await c.page.waitForSelector('.shopbar__item .is-armed');
  await c.page.waitForSelector('.dhead__icon img');
  assert.equal(await c.page.$eval('.dhead__icon img', e => e.getAttribute('src')), offer.url, 'shop detail');
  assert.ok((await c.page.$eval('.dpanel', e => e.textContent)).includes(offer.name));
  await sleep(100);
  await c.click('.shopbar__item button.scard--item');
  await c.page.waitForFunction((id) => globalThis.__SP__.store.get().match.private.hand.some(p => p?.id === id), {}, id);
  return offer;
}

async function plate(c, offer) {
  await c.page.waitForFunction((id) => {
    const views = globalThis.__SP_VIEW__?.raw?.debug?.views;
    return views && [...views.values()].some(v => v.info.kind === 'item' && v.info.defId === id && v.plate?.texture?.baseTexture?.resource?.source);
  }, { timeout: 30000 }, offer.id);
  // Compare the drawn canvas pixels, not just info.icon (which was already correct before the fix).
  const observed = await c.page.evaluate(async (offer) => {
    const { assets } = await import('/js/assets.js');
    const { itemTexture } = await import('/js/render/textures.js');
    const v = [...globalThis.__SP_VIEW__.raw.debug.views.values()].find(v => v.info.kind === 'item' && v.info.defId === offer.id);
    const expected = itemTexture(`verification:${offer.url}`, await assets.image(offer.url), v.info.color);
    return { url: v.info.icon, actual: v.plate.texture.baseTexture.resource.source.toDataURL(),
      expected: expected.baseTexture.resource.source.toDataURL() };
  }, offer);
  assert.equal(observed.url, offer.url);
  assert.ok(observed.actual === observed.expected, `${offer.name}: preparation-area pixels must match the active shop icon`);
  const uid = await c.page.evaluate(id => globalThis.__SP__.store.get().match.private.hand.find(p => p?.id === id).uid, offer.id);
  await c.page.keyboard.press('Escape');
  const point = await c.piecePoint(uid);
  assert.ok(point, 'bench item is visible');
  await c.page.mouse.click(point.x, point.y, { button: 'right' });
  await c.page.waitForSelector('.dhead__icon img');
  assert.equal(await c.page.$eval('.dhead__icon img', e => e.getAttribute('src')), offer.url, 'bench detail');
  assert.ok((await c.page.$eval('.dpanel', e => e.textContent)).includes(offer.name));
  await c.page.keyboard.press('Escape');
}

async function equipped(c, offer) {
  const chessId = await c.page.evaluate(() => globalThis.__SP__.data.list('chess')
    .find(c => !c.isGolden && !c.isDiy && c.tier === 1 && c.position === 'MELEE').chessId);
  await command(c, 'chess', { id: chessId });
  const { itemUid, targetUid } = await c.page.evaluate(({ item, chess }) => {
    const hand = globalThis.__SP__.store.get().match.private.hand;
    return { itemUid: hand.find(p => p?.id === item).uid, targetUid: hand.find(p => p?.id === chess).uid };
  }, { item: offer.id, chess: chessId });
  const tile = await c.freeTileFor(targetUid);
  assert.ok(tile, 'legal deployment tile');
  await req(c, 'g.move', { uid: targetUid, to: { area: 'board', row: tile.row, col: tile.col }, dir: 'RIGHT' });
  await req(c, 'g.equip', { itemUid, targetUid });
  await c.page.waitForFunction(uid => [...globalThis.__SP_VIEW__.raw.debug.views.values()]
    .some(v => v.uid === uid && v.itemPips?.[0]?._url), {}, targetUid);
  const matches = await c.page.evaluate(async ({ uid, url }) => {
    const { assets } = await import('/js/assets.js');
    const { itemTexture } = await import('/js/render/textures.js');
    const img = await assets.image(url);
    const v = [...globalThis.__SP_VIEW__.raw.debug.views.values()].find(v => v.uid === uid);
    return v.itemPips[0]._url === url && v.itemPips[0].texture.baseTexture.resource.source.toDataURL()
      === itemTexture(`verification:${url}`, img, 0x4ed8af).baseTexture.resource.source.toDataURL();
  }, { uid: targetUid, url: offer.url });
  assert.ok(matches, 'equipped item pixels');
  const point = await c.piecePoint(targetUid);
  assert.ok(point);
  await c.page.mouse.click(point.x, point.y, { button: 'right' });
  await c.page.waitForSelector('.ditem img');
  assert.equal(await c.page.$eval('.ditem img', e => e.getAttribute('src')), offer.url, 'operator equipment detail');
  assert.ok((await c.page.$eval('.ditem', e => e.textContent)).includes(offer.name));
  await c.page.keyboard.press('Escape');
}

async function finish(c, offer) {
  // Forced elimination clears the server's lineup. Retain the bought/equipped lineup as a settlement UI fixture.
  const lineup = await c.page.evaluate(() => globalThis.__SP__.store.get().match.private.board.map(p => ({
    id: p.id, tier: p.tier, golden: p.golden, row: p.row, col: p.col, items: p.items.map(it => it.id),
  })));
  await command(c, 'lp', { value: 0 });
  await command(c, 'round', { round: 2 });
  await c.waitFor(s => s.result, 'settlement');
  await c.page.evaluate(lineup => {
    const { store } = globalThis.__SP__;
    const s = store.get();
    const result = { ...s.match.result, players: s.match.result.players.map(p =>
      p.playerId === s.me.playerId ? { ...p, lineup } : p) };
    store.set({ match: { ...s.match, result } });
  }, lineup);
  await c.click('[data-testid="settle-intro"]', null, { optional: true, timeout: 3000 });
  await c.page.waitForSelector('.sop__slot.has-item img');
  assert.equal(await c.page.$eval('.sop__slot.has-item img', e => e.getAttribute('src')), offer.url, 'settlement lineup');
  assert.equal(await c.page.$eval('.sop__slot.has-item', e => e.title), offer.name);
  await c.click('.settle__next');
  await c.click('.settle__back');
  await c.page.waitForSelector('.room-screen', { visible: true });
}

for (const { route, versions } of [
  { route: 'lobby', versions: ['act1autochess', 'act2autochess'] },
  { route: 'lobby', versions: ['act2autochess', 'act1autochess'] },
  { route: 'vote', versions: ['act1autochess', 'act2autochess', 'act1autochess'] },
]) {
  test(`${route}: ${versions.join(' → ')} item pixels on every surface and reload`, { skip: !enabled, timeout: 180000 }, async () => {
    const { startServer } = await import('../../server/index.js');
    const saved = process.env.SP_TEST_MODE;
    process.env.SP_TEST_MODE = '1';
    let srv, c;
    try {
      srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, assetIndex: false,
        versions: { enabled: 'all' }, matchHost: { matchOptions: { botRehearsal: 0 } } });
      c = new Client((await import('puppeteer-core')).default, srv.url, 'icons', { prefix: 'version-icon-cache', w: 1600, h: 900 });
      await c.open();
      await c.enter('Icon regression');
      for (const [i, version] of versions.entries()) {
        const inRoom = route === 'vote' && i > 0;
        if (inRoom) {
          const code = (await c.st()).room.code;
          await c.click('[data-testid="room-version"]');
          await c.click(`.verpick__pick[data-version="${version}"]`);
          await c.page.waitForFunction(version => (globalThis.__SP__.store.get().room?.version || 'act2autochess') === version, {}, version);
          assert.equal((await c.st()).room.code, code, 'vote switches without leaving the room');
        } else await choose(c, version);
        await start(c, version, inRoom);
        const offer = await buy(c, ITEM);
        await plate(c, offer);
        const passive = await buy(c, PASSIVE);
        await plate(c, passive);
        await equipped(c, passive);
        if (i > 0) {
          await c.page.reload({ waitUntil: 'domcontentloaded' });
          await c.page.waitForFunction(() => !!globalThis.__SP__?.store, { timeout: 30000 });
          await c.waitFor(s => s.phase === 'PREP', 'reconnected match');
          await versionReady(c, version);
          await plate(c, offer);
        }
        await finish(c, passive);
        if (route === 'lobby') await c.click('.rs-exit');
      }
      assert.deepEqual(problemsOf([c]), []);
    } catch (err) {
      if (c?.page) {
        console.log('Icon regression state:', await c.st().catch(() => null), await c.page.$eval('body', e => e.innerText.slice(0, 800)));
        await c.shot('failure');
      }
      throw err;
    } finally {
      await c?.close();
      await srv?.close();
      if (saved === undefined) delete process.env.SP_TEST_MODE;
      else process.env.SP_TEST_MODE = saved;
    }
  });
}
