// Real-server browser check of two player reports after the 0.1.0 release (placement legality, headless Chrome):
//   #3 "有水池的那张图干员可以错误的被部署到水里" — on 战场#08(下半) 涨潮控制 (act2autochess_m04, test/e2e/fastServer.mjs hook
//      SP_STAGE) the drag highlights of an operator never light the 深水区 (board (10–12, 6)) and a drop there is refused.
//   #9 "干员伺夜这样的战术家的战术点能被错误的被放到攻击范围之外" — while 伺夜's 狼群 card is dragged only the free legal
//      tiles of her attack range light up; a drop outside is refused, one inside opens the wheel; re-orienting her so the
//      pack falls outside her range sends it back to the hand.
// Real mouse drags (press, move, read the 'legal' highlight group of the view, release). Zero console errors.
//
//   SP_E2E=1 node --test test/ui/feedback1-placement.e2e.test.js

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client, ROOT, sleep, hasChrome, startRealServer, problemsOf, groundAnchor, anchorPoint, cameraSettled } from '../e2e/client.mjs';
import { ownerRangeKeys } from '../../server/match/board.js';

const ENABLED = process.env.SP_E2E === '1' && hasChrome() && existsSync(path.join(ROOT, 'public/assets'));
const STAGE = 'act2autochess_m04';
const VIGIL = 'chess_char_3_19_a', GUMMY = 'chess_char_1_10_a', WOLF = 'token_10028_vigil_wolf';
const WATER = ['10,6', '11,6', '12,6'];
const json = (f) => JSON.parse(readFileSync(path.join(ROOT, 'data', f), 'utf8'));

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

const handOf = (c, id) => c.page.evaluate((id) => (globalThis.__SP__.store.get().match.private?.hand || []).find((p) => p && p.id === id) || null, id);
const boardOf = (c, id) => c.page.evaluate((id) => (globalThis.__SP__.store.get().match.private?.board || []).filter((p) => p.id === id), id);
const legalLit = (c) => c.page.evaluate(() => {
  const hl = globalThis.__SP_VIEW__?.raw?.debug?.tiles?.highlights?.get('legal');
  return hl ? hl.tiles.map((t) => (Array.isArray(t) ? `${t[0]},${t[1]}` : `${t.row},${t.col}`)) : [];
});
const wheelOpen = (c) => c.page.evaluate(() => !!document.querySelector('.fwheel__dia'));

/**
 * Press on hand piece `uid`, move over `hover` and read the legal highlights mid-drag, then release on `drop`. The tiles'
 * points are aimed at again once the piece is picked up: the deploy fold zooms the board then (GitHub #602).
 */
async function dragRead(c, uid, hover, drop, shot = null) {
  const from = await c.piecePoint(uid);
  let over = await c.tilePoint(hover[0], hover[1]);
  let to = await c.tilePoint(drop[0], drop[1]);
  assert.ok(from && over && to, `piece ${uid} and tiles on screen`);
  const [aOver, aTo] = [await groundAnchor(c.page, over), await groundAnchor(c.page, to)];
  const m = c.page.mouse;
  await m.move(from.x, from.y);
  await m.down();
  for (let i = 1; i <= 3; i++) { await m.move(from.x + ((over.x - from.x) * i) / 12, from.y + ((over.y - from.y) * i) / 12); await sleep(14); }
  await cameraSettled(c.page);
  const start = { x: from.x + ((over.x - from.x) * 3) / 12, y: from.y + ((over.y - from.y) * 3) / 12 };
  over = (await anchorPoint(c.page, aOver)) || over;
  to = (await anchorPoint(c.page, aTo)) || to;
  for (let i = 1; i <= 9; i++) { await m.move(start.x + ((over.x - start.x) * i) / 9, start.y + ((over.y - start.y) * i) / 9); await sleep(14); }
  await sleep(250);
  const lit = (await legalLit(c)).sort();
  if (shot) await c.shot(shot);
  for (let i = 1; i <= 8; i++) { await m.move(over.x + ((to.x - over.x) * i) / 8, over.y + ((to.y - over.y) * i) / 8); await sleep(14); }
  await sleep(200);
  await m.up();
  await sleep(500);
  return lit;
}

describe('player reports #3 / #9 after 0.1.0: placement highlights (real server, headless Chrome)', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome + assets) to run' }, () => {
  test('the pool is never lit nor accepted; 狼群 lights and accepts only 伺夜\'s range', { timeout: 240000 }, async () => {
    const puppeteer = (await import('puppeteer-core')).default;
    const srv = await startRealServer({ fast: { timerScale: 0.5, combatSpeed: 4, startRound: 2, chess: [VIGIL, GUMMY], stage: STAGE } });
    const c = new Client(puppeteer, srv.base, 'feedback1', { prefix: 'fb1' });
    try {
      await soloToPrep(c);
      assert.equal(await c.page.evaluate(() => globalThis.__SP__.store.get().match.public.stageId), STAGE, 'SP_STAGE hook');
      const melee = new Set(json('stages.json')[STAGE].deployTiles.normal.melee.map(([r, col]) => `${r},${col}`));
      for (const k of WATER) assert.ok(!melee.has(k), `data: ${k} not deployable`);

      // 伺夜 onto (10,4) facing RIGHT through the wheel
      const vigil = await handOf(c, VIGIL);
      assert.ok(vigil, '伺夜 in the hand');
      const lit0 = await dragRead(c, vigil.uid, [9, 3], [10, 4]);
      for (const k of WATER) assert.ok(!lit0.includes(k), `伺夜: ${k} not lit (${lit0.join(' ')})`);
      assert.ok(lit0.includes('11,5') && lit0.includes('10,7'), 'the dry tiles around the pool are lit');
      await c.page.waitForSelector('.fwheel__dia', { timeout: 4000 });
      await c.swipe('RIGHT');
      await sleep(600);
      assert.deepEqual((await boardOf(c, VIGIL)).map((p) => [p.row, p.col, p.dir]), [[10, 4, 'RIGHT']]);

      // #3: 古米 (melee) — no water lit, a drop into the pool is refused (no wheel, still in the hand)
      const gummy = await handOf(c, GUMMY);
      const lit1 = await dragRead(c, gummy.uid, [9, 3], [11, 6], 'pool-drag');
      for (const k of WATER) assert.ok(!lit1.includes(k), `古米: ${k} not lit`);
      assert.deepEqual(lit1, [...melee].sort(), 'every melee tile (伺夜\'s too: a swap), no water');
      assert.equal(await wheelOpen(c), false, 'no wheel for a drop into the water');
      assert.ok(await handOf(c, GUMMY), '古米 is still in the hand');
      await c.shot('pool-refused');

      // #9: the pack card lights exactly the free melee tiles of her range (rows 9–11 × cols 4–7 minus her tile and the pool)
      const wolf = await handOf(c, WOLF);
      assert.ok(wolf, 'the 狼群 card is in the hand');
      const range = ownerRangeKeys(json('chess.json')[VIGIL].rangeGrid, 10, 4, 'RIGHT');
      const want = [...melee].filter((k) => range.has(k) && k !== '10,4').sort();
      const lit2 = await dragRead(c, wolf.uid, [11, 5], [12, 3], 'wolf-drag');
      assert.deepEqual(lit2, want, `狼群 highlights = her range (${lit2.join(' ')})`);
      for (const k of ['12,3', '12,4', '10,3', '9,8']) assert.ok(!lit2.includes(k), `${k} outside her range is not lit`);
      assert.equal(await wheelOpen(c), false, 'a drop outside her range opens no wheel');
      assert.ok(await handOf(c, WOLF), 'the pack stays in the hand');
      // inside: the wheel opens and the pack is placed
      await dragRead(c, wolf.uid, [11, 5], [11, 5]);
      await c.page.waitForSelector('.fwheel__dia', { timeout: 4000 });
      await c.swipe('RIGHT');
      await sleep(600);
      assert.deepEqual((await boardOf(c, WOLF)).map((p) => [p.row, p.col]), [[11, 5]], 'placed inside her range');
      await c.shot('wolf-in-range');

      // re-orient 伺夜 to LEFT in place: (11,5) leaves her range → the pack goes back to the hand
      const v = (await boardOf(c, VIGIL))[0];
      const from = await c.piecePoint(v.uid);
      const to = await c.tilePoint(10, 4);
      await c.drag(from, to);
      await c.page.waitForSelector('.fwheel__dia', { timeout: 4000 });
      await c.swipe('LEFT');
      await sleep(800);
      assert.deepEqual((await boardOf(c, VIGIL)).map((p) => p.dir), ['LEFT']);
      assert.equal((await boardOf(c, WOLF)).length, 0, 'the pack left the board');
      assert.ok(await handOf(c, WOLF), '… back to the hand');
      await c.shot('wolf-lifted');
      assert.deepEqual(problemsOf([c]), []);
    } finally {
      await c.close();
      await srv.stop();
    }
  });
});
