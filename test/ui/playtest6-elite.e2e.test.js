// Real-server browser E2E of the user's playtest #6 follow-up: "官方就是合成精锐时，如果消耗了场上的干员，精锐会出现在场上那个
// 位置" (PRTS 卫戍协议/帮助 "若消耗已部署至作战区的干员，则发送至作战区对应位置"). A solo prep (test/e2e/fastServer.mjs hooks
// SP_START_ROUND 2 + SP_START_CHESS: two 古米 in the hand + SP_START_SHOP: a third 古米 in the shop) is driven with real
// input: one copy goes onto the board through the direction wheel facing UP, the shop card is tapped once (armed: the
// gold merge highlight lights that copy's tile) and again (bought) — the elite appears on that tile facing UP with the
// promotion cue (render/app.js setPrep → fx.promote), the hand copy is gone, the deploy count is unchanged and the
// promotion reward shows. Zero console errors.
//
//   SP_E2E=1 node --test test/ui/playtest6-elite.e2e.test.js

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Client, ROOT, sleep, hasChrome, startRealServer, problemsOf } from '../e2e/client.mjs';

const ENABLED = process.env.SP_E2E === '1' && hasChrome() && existsSync(path.join(ROOT, 'public/assets'));
const GUMMY = 'chess_char_1_10_a';

async function soloToPrep(c) {
  await c.open();
  await c.enter('煌');
  await c.click('.mode-card', '独立模拟');
  await c.click('.diff-card', '险境');
  await c.click('.create-box button', '开始独立模拟');
  await c.waitFor((s) => !!s.room, 'solo room');
  if (!(await c.st()).phase) await c.click('.room-bar__right button', '开始模拟', { timeout: 20000 });
  await c.waitFor((s) => s.phase === 'INFO_CHECK', 'briefing', 30000);
  await c.click('.brief__foot .btn--primary', '准备就绪');
  await c.waitFor((s) => s.phase === 'BAND_DRAFT', 'band draft', 30000);
  await c.click('.dband', null, { nth: 1 });
  await c.click('.draft-detail__btns .btn--primary', '确认选择');
  await c.waitFor((x) => x.phase === 'PREP' && !x.ready, 'prep', 60000);
  // the held 已选定策略 and 协议启动！ (screens/game.js DRAFT_HOLD_MS + BOOT_MIN_MS, inside BATTLE_CHECK) cover the board first
  await c.page.waitForFunction(() => !document.querySelector('.screen.draft, [data-testid="protocol-boot"]'), { timeout: 15000 });
  await sleep(1800);
}

const privOf = (c) => c.page.evaluate(() => globalThis.__SP__.store.get().match.private);

describe('user playtest #6 follow-up: a merge\'s elite takes the deployed copy\'s tile (real server, headless Chrome)', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome + assets) to run' }, () => {
  test('buying the third 古米 with one deployed: the elite stands on that tile, facing kept, with the promotion cue', { timeout: 240000 }, async () => {
    const puppeteer = (await import('puppeteer-core')).default;
    const srv = await startRealServer({ fast: { timerScale: 0.5, combatSpeed: 4, startRound: 2, chess: [GUMMY, GUMMY], shop: [GUMMY] } });
    const c = new Client(puppeteer, srv.base, 'elite', { prefix: 'pt6' });
    try {
      await soloToPrep(c);
      await c.hookRequests();
      const hand0 = (await c.handPieces('chess')).filter((p) => p.id === GUMMY);
      assert.equal(hand0.length, 2, 'two 古米 in the starter kit');
      // one copy onto the board, facing UP (drag + direction wheel)
      const tile = await c.freeTileFor(hand0[0].uid);
      const from = await c.piecePoint(hand0[0].uid);
      const to = await c.tilePoint(tile.row, tile.col);
      assert.ok(from && to, 'piece and tile on screen');
      await c.drag(from, to);
      await c.page.waitForSelector('.fwheel__dia', { timeout: 4000 });
      await c.swipe('UP');
      await sleep(500);
      const placed = (await privOf(c)).board.find((p) => p.uid === hand0[0].uid);
      assert.ok(placed && placed.row === tile.row && placed.col === tile.col && placed.dir === 'UP', `placed facing UP (${JSON.stringify(placed)})`);
      const count0 = (await c.st()).deployCount;
      const promos0 = await c.page.evaluate(() => globalThis.__SP_VIEW__?.raw?.debug?.promotions?.length ?? 0);
      // first tap: armed — the card says 可晋升 and the gold highlight lights the copy's tile
      const name = await c.page.evaluate((id) => globalThis.__SP__.data.lookup('chess', id)?.name, GUMMY);
      await c.click('.shopbar__cards .scard', name);
      await sleep(400);
      const armed = await c.page.evaluate(() => {
        const card = document.querySelector('.shopbar__cards .scard.is-armed');
        const hl = globalThis.__SP_VIEW__?.raw?.debug?.tiles?.highlights?.get('mergeTile');
        const hint = document.querySelector('.dpanel .dhint--merge');
        return { merge: !!card?.querySelector('.scard__mergetag'), title: card?.querySelector('.scard__mergetag')?.title || null, tiles: hl ? hl.tiles : null,
          hint: hint ? hint.textContent.trim() : null, hintVisible: !!(hint && hint.getBoundingClientRect().height > 0) };
      });
      assert.ok(armed.merge, 'the armed card is a merge (可晋升)');
      assert.equal(armed.title, '精锐干员将出现在作战区原位置');
      // touch never shows a title: the detail card the first tap opened carries the same line (QA 6b)
      assert.equal(armed.hint, '可晋升：精锐干员将出现在作战区原位置');
      assert.ok(armed.hintVisible, 'the line is laid out in the detail card');
      assert.deepEqual(armed.tiles, [[tile.row, tile.col]], 'the merge highlight lights the deployed copy\'s tile');
      await c.shot('elite-armed');
      // second tap: bought
      await c.click('.shopbar__cards .scard.is-armed');
      await c.page.waitForFunction((id) => (globalThis.__SP__.store.get().match.private?.board || []).some((p) => p.golden && p.id === id), { timeout: 8000 }, `${GUMMY.slice(0, -2)}_b`);
      const priv = await privOf(c);
      const elite = priv.board.find((p) => p.golden);
      assert.deepEqual([elite.row, elite.col, elite.dir], [tile.row, tile.col, 'UP'], 'the elite on the copy\'s tile, facing kept');
      assert.ok(!priv.hand.some((p) => p && p.kind === 'chess'), 'the hand copy was consumed');
      assert.equal((await c.st()).deployCount, count0, 'the deploy count is unchanged');
      assert.ok(priv.shop.rewardOffer, 'the promotion reward is offered');
      assert.ok((await c.requests('g.buy')).length === 1, 'one g.buy');
      await sleep(300);
      const promos = await c.page.evaluate(() => (globalThis.__SP_VIEW__?.raw?.debug?.promotions || []).slice());
      assert.equal(promos.length, promos0 + 1, 'one promotion cue');
      assert.deepEqual([promos.at(-1).area, promos.at(-1).row, promos.at(-1).col, promos.at(-1).uid], ['board', tile.row, tile.col, elite.uid], 'played on the elite\'s tile');
      const hlAfter = await c.page.evaluate(() => globalThis.__SP_VIEW__?.raw?.debug?.tiles?.highlights?.get('mergeTile') || null);
      assert.equal(hlAfter, null, 'the merge highlight is gone with the purchase');
      // the elite's model stands on the tile (a prep view keyed by its uid)
      const view = await c.page.evaluate((uid) => { const v = globalThis.__SP_VIEW__?.raw?.debug?.views?.get('p:' + uid); return v ? { golden: !!v.info?.golden, x: v._home?.x, y: v._home?.y } : null; }, elite.uid);
      assert.ok(view && view.golden, `the elite's view exists (${JSON.stringify(view)})`);
      await c.shot('elite-on-board');
      assert.deepEqual(problemsOf([c]), []);
    } finally {
      await c.close();
      await srv.stop();
    }
  });
});
