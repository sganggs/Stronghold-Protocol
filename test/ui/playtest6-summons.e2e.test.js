// Real-server browser E2E of user playtest #6 items 1 and 2 (from a friend): 凯瑟琳's device and 赫默's drone could not be
// placed by hand. A solo prep (test/e2e/fastServer.mjs hook SP_START_ROUND 2 + SP_START_CHESS: 古米, 凯瑟琳, 赫默 in the
// hand) is driven with real mouse drags: the three operators go onto the board through the direction wheel, their
// summon cards appear in the hand (赫默's 医疗探机 ×1, 凯瑟琳's 支援装置 ×2), the drone is dropped on a free tile and a
// device next to 古米 facing it — then the battle starts with both on the field: the device fights from the start and
// the placed drone deploys once at the battle start (PRTS 卫戍协议/帮助 §作战阶段; settled by the user after playtest #6 —
// shared/constants.js SKILL_SUMMON_START_DEPLOY), then comes back with each S2 (sim/content/tokens.js). Zero console
// errors.
//
//   SP_E2E=1 node --test test/ui/playtest6-summons.e2e.test.js

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Client, ROOT, sleep, hasChrome, startRealServer, problemsOf } from '../e2e/client.mjs';

const ENABLED = process.env.SP_E2E === '1' && hasChrome() && existsSync(path.join(ROOT, 'public/assets'));
const GUMMY = 'chess_char_1_10_a', CATHY = 'chess_char_4_11_a', SILENCE = 'chess_char_2_02_a';
const DRONE = 'token_10000_silent_healrb', DEVICE = 'token_10041_cathy_catsld';

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

/** Drag hand piece `uid` onto (row, col) and pick `dir` on the wheel; returns the board piece. */
async function place(c, uid, tile, dir) {
  const from = await c.piecePoint(uid);
  const to = await c.tilePoint(tile.row, tile.col);
  assert.ok(from && to, `piece ${uid} and tile ${tile.row},${tile.col} on screen`);
  await c.drag(from, to);
  await c.page.waitForSelector('.fwheel__dia', { timeout: 4000 });
  await c.swipe(dir);
  await sleep(500);
}

const handOf = (c, id) => c.page.evaluate((id) => (globalThis.__SP__.store.get().match.private?.hand || []).find((p) => p && p.id === id) || null, id);
const boardOf = (c, id) => c.page.evaluate((id) => (globalThis.__SP__.store.get().match.private?.board || []).filter((p) => p.id === id), id);

/**
 * A free deploy tile orthogonally next to one of the board's operators and the direction that faces it from there
 * (board coordinates): { row, col, dir } or null.
 */
function spotNextToOperator(c) {
  return c.page.evaluate(() => {
    const { store, data } = globalThis.__SP__;
    const s = store.get();
    const st = data.lookup('stages', s.match.public.stageId);
    const dt = st.deployTiles.normal;
    const ok = new Set([...dt.rangedOnly, ...dt.melee].map(([a, b]) => `${a},${b}`));
    const used = new Set(s.match.private.board.map((p) => `${p.row},${p.col}`));
    for (const op of s.match.private.board.filter((p) => p.kind === 'chess')) {
      for (const [dr, dc, dir] of [[0, -1, 'RIGHT'], [1, 0, 'DOWN'], [-1, 0, 'UP'], [0, 1, 'LEFT']]) {
        const k = `${op.row + dr},${op.col + dc}`;
        if (ok.has(k) && !used.has(k)) return { row: op.row + dr, col: op.col + dc, dir };
      }
    }
    return null;
  });
}

describe('user playtest #6: summons placed by hand (real server, headless Chrome)', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome + assets) to run' }, () => {
  let puppeteer = null;
  test('赫默\'s drone and 凯瑟琳\'s devices are hand cards, placed with the wheel; both are on the field at the battle start', { timeout: 240000 }, async () => {
    puppeteer = puppeteer || (await import('puppeteer-core')).default;
    const srv = await startRealServer({ fast: { timerScale: 0.5, combatSpeed: 4, startRound: 2, chess: [GUMMY, CATHY, SILENCE] } });
    const c = new Client(puppeteer, srv.base, 'summons', { prefix: 'pt6' });
    try {
      await soloToPrep(c);
      await c.hookRequests();
      // the three operators onto the board (melee first: 古米 and 凯瑟琳 take melee tiles)
      for (const id of [GUMMY, CATHY, SILENCE]) {
        const p = await handOf(c, id);
        assert.ok(p, `${id} in the starter kit`);
        const tile = await c.freeTileFor(p.uid);
        await place(c, p.uid, tile, 'RIGHT');
        assert.equal((await boardOf(c, id)).length, 1, `${id} placed`);
      }
      // their summon cards
      const drone = await handOf(c, DRONE);
      const dev = await handOf(c, DEVICE);
      assert.ok(drone, '赫默\'s 医疗探机 card is in the hand');
      assert.ok(dev && dev.count === 2, `凯瑟琳's 支援装置 card ×2 (${dev && dev.count})`);
      await c.shot('hand-cards');
      // the drone on a free tile, facing UP
      const dt = await c.freeTileFor(drone.uid, { prefer: 'back' });
      await place(c, drone.uid, dt, 'UP');
      const [dp] = await boardOf(c, DRONE);
      assert.ok(dp && dp.row === dt.row && dp.col === dt.col && dp.dir === 'UP', `drone placed (${JSON.stringify(dp)})`);
      // a device next to an operator, facing it
      const spot = await spotNextToOperator(c);
      assert.ok(spot, 'a free tile next to an operator');
      await place(c, dev.uid, spot, spot.dir);
      const devs = await boardOf(c, DEVICE);
      assert.equal(devs.length, 1);
      assert.deepEqual([devs[0].row, devs[0].col, devs[0].dir], [spot.row, spot.col, spot.dir], 'device placed facing the operator');
      assert.equal((await handOf(c, DEVICE))?.count, 1, 'one device left on the card');
      assert.ok((await c.requests('g.move')).length >= 5, 'every placement went through g.move');
      // the rest of the stack (one device) is drawn back on its bench slot at once (not left over the placed copy)
      await sleep(450);
      const slot = await c.page.evaluate((id) => (globalThis.__SP__.store.get().match.private?.hand || []).findIndex((p) => p && p.id === id), DEVICE);
      const home = await c.tilePoint(7, slot);
      const at = await c.piecePoint(dev.uid, 0.5);
      assert.ok(home && at && Math.hypot(at.x - home.x, at.y - home.y) < 90, `the device card is back on its bench slot (${JSON.stringify({ home, at })})`);
      await c.shot('placed');
      // the battle: the device deploys with the board, and so does the placed drone, once (then with each S2)
      await c.click('.readybtn');
      await c.waitFor((s) => s.phase === 'COMBAT', 'combat', 30000);
      // the battle views (render/app.js: unit id → view with its UnitInfo) once the board has deployed
      const onField = () => c.page.evaluate(() => [...(globalThis.__SP_VIEW__?.raw?.debug?.views?.values() || [])].filter((v) => v?.info && v.alive !== false).map((v) => v.info.defId));
      await c.page.waitForFunction((id) => [...(globalThis.__SP_VIEW__?.raw?.debug?.views?.values() || [])].some((v) => v?.info?.defId === id), { timeout: 30000 }, GUMMY);
      await sleep(600);
      const start = await onField();
      assert.ok(start.includes(DEVICE), `the device is on the field from the start (${start.join(', ')})`);
      assert.ok(start.includes(DRONE), `the placed drone deploys once at the battle start (${start.join(', ')})`);
      await c.shot('battle');
      assert.deepEqual(problemsOf([c]), []);
    } finally {
      await c.close();
      await srv.stop();
    }
  });
});
