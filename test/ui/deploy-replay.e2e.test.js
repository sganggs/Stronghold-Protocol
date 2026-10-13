// Browser check of the round start's deploy replay (PR #416 by @Cromemadnd, DESIGN §31.8) on the mock harness
// (public/dev/game-mock.html) in headless Chrome (puppeteer-core + the system Chrome); opt-in, ~15 s:
//   SP_E2E=1 node --test test/ui/deploy-replay.e2e.test.js
//
// From a settled battle to 回合开始 of the next round, the real game screen (screens/game.js) and Pixi field view
// (render/app.js) replay the own board's pieces one after another in deployment order — operators by column from the
// left, top to bottom within a column (sim Battle.start) — each with one landing sound (audio.deployCue, spied) that
// really starts in the page's unlocked audio (audio.landStats), never more than LAND_VOICES at once; the same round never
// again (a re-pushed state, the 休整期 that follows), the next round once more. In the 休整期 a purchase
// lands the bought operator; a move onto the board while that Start still plays sounds nothing more; a later move to
// another tile lands again; turning in place does not. No console / page errors.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The deployment order, written out independently of ui/gameLogic deployOrder: operators, then summons; col asc, row desc. */
const expectedOrder = (board) => board.filter((p) => p && (p.kind === 'chess' || p.kind === 'token'))
  .sort((a, b) => (a.kind === 'chess' ? 0 : 1) - (b.kind === 'chess' ? 0 : 1) || a.col - b.col || b.row - a.row)
  .map((p) => p.uid);

describe('the round start replays the own board\'s Start clips in deployment order', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome) to run' }, () => {
  let srv;
  let browser;
  let base;
  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    await srv.assetIndex?.whenReady();
    base = `http://127.0.0.1:${srv.port}`;
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  });
  after(async () => {
    await browser?.close();
    await srv?.close();
  });

  test('SETTLE → 回合开始: one landing per piece, in order and 50 ms apart; once per round; purchases and moves land once', async () => {
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 900 });
    const problems = [];
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    await page.goto(`${base}/dev/game-mock.html?shot=1&render=engine&phase=SETTLE`, { waitUntil: 'networkidle0', timeout: 60000 });
    await page.waitForFunction(() => globalThis.__SP_VIEW__?.kind === 'engine' && globalThis.__SP_VIEW__.raw.mode === 'battle', { timeout: 20000 });
    // spy on the landing sound (the view's ctx.audio is this very manager), sample how many landing voices ring, and
    // unlock the page's audio with a key press (a user gesture; Shift is no shortcut) so the landings really start
    await page.evaluate(async () => {
      const { audio } = await import('/js/audio.js');
      globalThis.__audio = audio;
      const cues = globalThis.__cues = [];
      const real = audio.deployCue.bind(audio);
      audio.deployCue = (info, key) => { cues.push({ key, at: performance.now() }); return real(info, key); };
      globalThis.__mostVoices = 0;
      setInterval(() => { globalThis.__mostVoices = Math.max(globalThis.__mostVoices, audio.landVoices.length); }, 4);
    });
    await page.keyboard.press('Shift');
    await page.waitForFunction(() => globalThis.__audio.unlocked, { timeout: 5000 });
    // the field view asked for the generic landing sounds ahead (audio.warmLandings); the gesture fetched them
    await page.waitForFunction(() => [...globalThis.__audio.buffers.keys()].some((u) => /b_char_set/.test(u)), { timeout: 5000 });
    await sleep(300);
    const stats0 = await page.evaluate(() => ({ ...globalThis.__audio.landStats }));
    const landings = (why) => page.evaluate((w) => globalThis.__SP_VIEW__.raw.debug.landings.filter((l) => !w || l.why === w).map((l) => ({ ...l })), why);
    const toPhase = (phase, round) => page.evaluate((ph, r) => globalThis.__MOCK__.mutate((S) => {
      if (S.battle?.timer) clearInterval(S.battle.timer);
      S.battle = null;
      S.pub.phase = ph; S.pub.round = r; S.pub.deadline = Date.now() + (ph === 'ROUND_START' ? 2000 : 60000);
      S.priv.ready = false;
    }), phase, round);

    // ---- 回合开始 of round 7: the board replays in deployment order
    const board = await page.evaluate(() => JSON.parse(JSON.stringify(globalThis.__MOCK__.S().priv.board)));
    const order = expectedOrder(board);
    assert.ok(order.length >= 5, `the mock board has pieces (${order.length})`);
    const t0 = await page.evaluate(() => performance.now());
    await toPhase('ROUND_START', 7);
    await page.waitForFunction((n) => globalThis.__SP_VIEW__.raw.debug.landings.filter((l) => l.why === 'round').length >= n, { timeout: 5000 }, order.length);
    // the last piece's Start is playing right now (on its model, or owed to one still loading)
    const lastPlaying = await page.evaluate((uid) => globalThis.__SP_VIEW__.raw.debug.views.get(`p:${uid}`)?.deploying(), order.at(-1));
    const round7 = await landings('round');
    assert.deepEqual(round7.map((l) => l.uid), order, 'every operator once, in deployment order (by column from the left, top to bottom)');
    assert.equal(await page.evaluate(() => globalThis.__SP_VIEW__.raw.mode), 'prep');
    assert.ok(round7[0].at >= t0, 'scheduled by this round start');
    for (let i = 1; i < round7.length; i++) {
      const gap = round7[i].at - round7[i - 1].at;
      assert.ok(gap >= 35 && gap < 400, `one after another, ~50 ms apart (${gap.toFixed(1)} ms between #${i - 1} and #${i})`);
    }
    assert.equal(lastPlaying, true, 'the piece is in its Start clip when it lands');
    const cues7 = await page.evaluate(() => globalThis.__cues.map((c) => c.key));
    assert.deepEqual(cues7, order.map((uid) => `p:${uid}`), 'one landing sound per piece, in the same order');
    // every landing's sound really started — most of them share b_char_set — and never more than LAND_VOICES at once
    await sleep(200);
    const voices = await page.evaluate(async () => {
      const { LAND_VOICES } = await import('/js/audio.js');
      const st = globalThis.__audio.landStats;
      return { started: st.started, stolen: st.stolen, most: globalThis.__mostVoices, cap: LAND_VOICES };
    });
    assert.equal(voices.started - stats0.started, order.length, `all ${order.length} landing sounds started (${JSON.stringify(voices)})`);
    assert.ok(voices.most <= voices.cap, `at most ${voices.cap} landing voices at once (${voices.most})`);
    assert.equal(voices.stolen - stats0.stolen, Math.max(0, order.length - voices.cap), 'the oldest gave its voice to each landing over the cap');

    // ---- the same round again: a re-pushed state (a reconnect's resync, a re-render) and the 休整期 that follows replay nothing
    await page.evaluate(() => { globalThis.__MOCK__.pushPublic(); globalThis.__MOCK__.mutate(() => {}); });
    await sleep(600);
    await toPhase('PREP', 7);
    await sleep(800);
    assert.equal((await landings('round')).length, order.length, 'round 7 replayed once');
    assert.equal(await page.evaluate(() => globalThis.__cues.length), order.length, 'and sounded once per piece');

    // ---- a purchase lands the bought operator; a move onto the board during its Start sounds nothing more
    const slot = await page.evaluate(() => globalThis.__MOCK__.S().priv.shop.slots.findIndex((s) => s && s.kind === 'chess' && !s.sold));
    assert.ok(slot >= 0, 'the shop offers an operator');
    await page.evaluate(() => globalThis.__MOCK__.mutate((S) => { S.priv.funds = 99; }));
    await page.evaluate(async (i) => { const { net } = await import('/js/net.js'); await net.request('g.buy', { slot: i }); }, slot);
    await page.waitForFunction(() => globalThis.__SP_VIEW__.raw.debug.landings.some((l) => l.why === 'buy'), { timeout: 4000 });
    const bought = (await landings('buy')).at(-1).uid;
    const inHand = await page.evaluate((uid) => globalThis.__MOCK__.S().priv.hand.some((p) => p && p.uid === uid), bought);
    assert.ok(inHand, 'the landing is the bought piece on the bench');
    const free = await page.evaluate(() => {
      const S = globalThis.__MOCK__.S();
      const used = new Set(S.priv.board.map((p) => `${p.row},${p.col}`));
      const dt = S.stage.deployTiles.normal;
      return [...dt.melee, ...dt.rangedOnly].filter(([r, c]) => !used.has(`${r},${c}`)).slice(0, 2);
    });
    assert.equal(free.length, 2, 'two free deploy tiles');
    const move = (uid, [row, col], dir = 'RIGHT') => page.evaluate(async (u, r, c, d) => {
      const { net } = await import('/js/net.js');
      await net.request('g.move', { uid: u, to: { area: 'board', row: r, col: c }, dir: d });
    }, uid, row, col, dir);
    const cuesOf = (uid) => page.evaluate((k) => globalThis.__cues.filter((c) => c.key === k).length, `p:${uid}`);
    await move(bought, free[0]);
    await sleep(300);
    assert.equal(await page.evaluate((uid) => globalThis.__MOCK__.S().priv.board.some((p) => p.uid === uid), bought), true, 'it is on the board');
    assert.equal(await cuesOf(bought), 1, 'bought and moved within one Start clip: one landing sound');
    // a later move to another tile lands again; turning in place does not
    await sleep(1400);
    await move(bought, free[1]);
    await page.waitForFunction((uid) => globalThis.__SP_VIEW__.raw.debug.landings.some((l) => l.why === 'board' && l.uid === uid), { timeout: 4000 }, bought);
    assert.equal(await cuesOf(bought), 2, 'a move to another tile is a new landing');
    await sleep(1400);
    await move(bought, free[1], 'UP');
    await sleep(600);
    assert.equal(await cuesOf(bought), 2, 'turning in place is no landing');
    assert.equal((await landings('round')).length, order.length, 'the 休整期 never replays the round start');

    // ---- the next round replays again (with the bought operator in its place in the order)
    await toPhase('SETTLE', 7);
    await sleep(300);
    const board8 = await page.evaluate(() => JSON.parse(JSON.stringify(globalThis.__MOCK__.S().priv.board)));
    await toPhase('ROUND_START', 8);
    const order8 = expectedOrder(board8);
    await page.waitForFunction((n) => globalThis.__SP_VIEW__.raw.debug.landings.filter((l) => l.why === 'round').length >= n, { timeout: 5000 }, order.length + order8.length);
    const round8 = (await landings('round')).slice(order.length).map((l) => l.uid);
    assert.deepEqual(round8, order8, 'round 8 replays its board in deployment order');
    await page.close();
    assert.deepEqual(problems, []);
  });
});
