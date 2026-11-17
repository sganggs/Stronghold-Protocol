// Browser E2E of the client leftovers (puppeteer-core + system Chrome; opt-in: SP_E2E=1, ~3 min):
//
//   SP_E2E=1 node --test test/ui/leftovers.e2e.test.js
//
// Mock harness (public/dev/game-mock.html, in-process server):
//   1. a third item dropped on a full operator opens the equip-replace dialog (both equipped items with icon / name /
//      effect); 取消 and Esc send nothing and change nothing; picking the 2nd item + 确认替换 sends g.equip {replaceUid};
//   2. 最终攻势: the countdown gauge counts the level's 120 s; the red DOT warning shows the drain start once the level time
//      ran out and a live indicator while the team LP drains (m.public.overtimeAt);
//   4. solo battle: the pause button sends g.pause {on}, m.public.paused shows the overlay and freezes the countdown,
//      Space resumes; no pause control in co-op or in prep.
// Real server (test/e2e/fastServer.mjs, real clicks and canvas drags):
//   1+4. a solo run: equip two items on an operator, drop a third → dialog → 取消 (nothing sent, the item drawn back on its
//        bench slot) → pick the OLDER item →
//        the real engine destroys exactly that one; then ready → the real local battle → pause (the battle clock and the
//        countdown stand still) → 继续作战;
//   3. the server restarts while the briefing is on screen → 「服务器会话已重置，上一局模拟已结束」 and the lobby.
// Screenshots: test/e2e/out/leftover-*.png. Every page must end without console / page / request errors (the restart
// test tolerates only the socket errors of the server's downtime).

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client, ROOT, OUT, CHROME, sleep, hasChrome, startRealServer, problemsOf } from '../e2e/client.mjs';

const ENABLED = process.env.SP_E2E === '1' && hasChrome() && existsSync(path.join(ROOT, 'public/assets'));
const ITEMS = (() => {
  const raw = JSON.parse(readFileSync(path.join(ROOT, 'data/items.json'), 'utf8'));
  const list = Array.isArray(raw) ? raw : Object.values(raw.items || raw);
  return new Map(list.filter((x) => x && x.id).map((x) => [x.id, x]));
})();
const attaches = (id) => !String(ITEMS.get(id)?.kind || '').startsWith('consume_on_equip');
/** Three distinct plain equipment items (attach, mergeable pairs never complete: all different). */
const KIT_ITEMS = [...ITEMS.values()].filter((i) => i.itemType === 'EQUIP' && !i.isGolden && attaches(i.id) && i.tier === 1).map((i) => i.id).sort().slice(0, 3);

describe('client leftovers — mock harness', { skip: !ENABLED && 'set SP_E2E=1 (Chrome + public/assets)' }, () => {
  let srv;
  let browser;
  let base;
  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    base = `http://127.0.0.1:${srv.port}`;
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--force-device-scale-factor=1'] });
    mkdirSync(OUT, { recursive: true });
  });
  after(async () => { await browser?.close(); await srv?.close(); });

  async function open(query, { w = 1920, h = 1080 } = {}) {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h });
    const problems = [];
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('requestfailed', (r) => { if (!/fonts\.(googleapis|gstatic)/.test(r.url())) problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`); });
    page.on('response', (r) => { if (r.status() >= 400) problems.push(`http ${r.status()}: ${r.url()}`); });
    await page.goto(`${base}/dev/game-mock.html?shot=1&${query}`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => !!document.querySelector('.screen:not(.gload)'), { timeout: 15000 });
    await sleep(900);
    return { page, problems };
  }
  const mockPriv = (page) => page.evaluate(() => JSON.parse(JSON.stringify(globalThis.__MOCK__.S().priv)));
  const mockReqs = (page, t) => page.evaluate((t) => globalThis.__MOCK__.S().requests.filter((r) => r[0] === t), t);
  const center = (page, sel) => page.$eval(sel, (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  const drag = async (page, from, to) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8);
    await sleep(80);
    await page.mouse.up();
    await sleep(500);
  };

  test('1. equip-replace dialog: lists both equipped items, cancel / Esc change nothing, the pick is sent as replaceUid', async () => {
    // DOM drag targets exist in the fallback view (the engine's own drag is covered by the real-server test below)
    const { page, problems } = await open('phase=PREP&render=fallback');
    let s = await mockPriv(page);
    const target = s.board.find((p) => p.kind === 'chess' && (p.items || []).length === 2);
    const item = s.hand.find((p) => p && p.kind === 'item' && attaches(p.id) && !target.items.some((x) => x.id === p.id));
    assert.ok(target && item, 'the mock has a full operator and an attachable hand item');
    const dropOnTarget = async () => {
      await drag(page, await center(page, `.ff-piece[data-uid="${item.uid}"]`), await center(page, `.ff-piece[data-uid="${target.uid}"]`));
      await page.waitForSelector('.eqr .eqr__opt', { timeout: 4000 });
    };

    await dropOnTarget();
    const dlg = await page.evaluate(() => ({
      opts: [...document.querySelectorAll('.eqr__opt')].map((el) => ({
        uid: Number(el.dataset.uid), name: el.querySelector('.eqr__name')?.textContent, desc: (el.querySelector('.eqr__desc')?.textContent || '').length,
        icon: !!el.querySelector('.uthumb'), checked: el.getAttribute('aria-checked'),
      })),
      incoming: document.querySelector('.eqr__card--new .eqr__name')?.textContent,
      okDisabled: document.querySelector('.eqr__ok')?.disabled,
      lead: document.querySelector('.eqr__lead')?.textContent || '',
    }));
    assert.deepEqual(dlg.opts.map((o) => o.uid), target.items.map((x) => x.uid), 'both equipped items, oldest first');
    assert.deepEqual(dlg.opts.map((o) => o.name), target.items.map((x) => ITEMS.get(x.id).name));
    assert.ok(dlg.opts.every((o) => o.icon && o.desc > 0 && o.checked === 'false'), 'icons + effects, nothing preselected');
    assert.equal(dlg.incoming, ITEMS.get(item.id).name);
    assert.equal(dlg.okDisabled, true, '确认替换 needs a pick');
    assert.match(dlg.lead, /被替换的装备将被销毁/);
    assert.equal(await page.$('.uframe__btn--destroy'), null, 'no 销毁 anywhere for equipped items');
    await page.screenshot({ path: path.join(OUT, 'leftover-replace-mock.png') });

    // 取消: nothing sent, nothing changed
    await page.click('.eqr__cancel');
    await page.waitForFunction(() => !document.querySelector('.eqr'), { timeout: 3000 });
    // Esc: same
    await dropOnTarget();
    await page.click('.eqr__opt:nth-child(1)');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.eqr'), { timeout: 3000 });
    await sleep(300);
    assert.deepEqual(await mockReqs(page, 'g.equip'), [], 'cancel / Esc: no g.equip');
    s = await mockPriv(page);
    assert.deepEqual(s.board.find((p) => p.uid === target.uid).items.map((x) => x.uid), target.items.map((x) => x.uid));
    assert.ok(s.hand.some((p) => p && p.uid === item.uid), 'the item stays in the hand');

    // pick the SECOND (newer) item → 确认替换
    await dropOnTarget();
    await page.click('.eqr__opt:nth-child(2)');
    await page.waitForFunction(() => document.querySelector('.eqr__opt:nth-child(2)')?.getAttribute('aria-checked') === 'true' && !document.querySelector('.eqr__ok').disabled, { timeout: 2000 });
    await sleep(350); // the 将被销毁 flag slides in
    await page.screenshot({ path: path.join(OUT, 'leftover-replace-mock-picked.png') });
    await page.click('.eqr__ok');
    await page.waitForFunction(() => !document.querySelector('.eqr'), { timeout: 3000 });
    await sleep(400);
    assert.deepEqual(await mockReqs(page, 'g.equip'), [['g.equip', { itemUid: item.uid, targetUid: target.uid, replaceUid: target.items[1].uid }]]);
    s = await mockPriv(page);
    assert.deepEqual(s.board.find((p) => p.uid === target.uid).items.map((x) => x.uid), [target.items[0].uid, item.uid], 'the picked one is destroyed');
    // a loose item still offers 销毁 (tap → underframe)
    const loose = s.hand.find((p) => p && p.kind === 'item');
    if (loose) {
      await page.click(`.ff-piece[data-uid="${loose.uid}"]`);
      await page.waitForSelector('.uframe__btn--destroy', { timeout: 3000 });
    }
    assert.deepEqual(problems, []);
    await page.close();
  });

  test("2. 最终攻势: the 120 s countdown gauge, then the red DOT overtime warning (drain start + live drain)", async () => {
    // start of the round: 95 s of 120 left → 4 of 5 bars, no warning yet
    let { page, problems } = await open('phase=FINAL_ASSAULT');
    const lit = await page.$$eval('.gtop__right .countdown__gauge i.on', (els) => els.length);
    assert.equal(lit, 4, 'gauge counts the 120 s level time');
    assert.equal(await page.$('.otwarn'), null);
    assert.deepEqual(problems, []);
    await page.close();

    // the level time ran out: the drain starts in ~18 s
    ({ page, problems } = await open('phase=FINAL_ASSAULT&variant=overtime'));
    await page.waitForSelector('.otwarn[data-state="pending"]', { timeout: 3000 });
    const pend = await page.$eval('.otwarn', (el) => el.textContent);
    assert.match(pend, /DOT/);
    assert.match(pend, /\d+\s*秒后全队生命值开始流失/);
    const secs = Number(pend.match(/(\d+)\s*秒后/)[1]);
    // the mock sets the drain 18 s after its script ran; the page is read after networkidle0, which waits for the
    // official effects the board preloads (about 8 s here), so only the range is checked
    assert.ok(secs > 0 && secs <= 18, `drain in ${secs} s`);
    assert.equal(await page.$eval('.gtop__right .countdown', (el) => el.getAttribute('aria-label')), '剩余0秒');
    await page.screenshot({ path: path.join(OUT, 'leftover-fa-overtime.png') });
    assert.deepEqual(problems, []);
    await page.close();

    // draining: live indicator, the team LP turns red, the lost counter moves every second
    ({ page, problems } = await open('phase=FINAL_ASSAULT&variant=drain'));
    await page.waitForSelector('.otwarn[data-state="drain"]', { timeout: 3000 });
    const d1 = await page.$eval('.otwarn', (el) => el.textContent);
    assert.match(d1, /超时 · 生命值 −1\/秒/);
    assert.ok(await page.$('.gtop__center .lp--danger'), 'the team LP tower turns red');
    const lost = async () => Number((await page.$eval('.otwarn__lost b', (el) => el.textContent)) || 0);
    const l1 = await lost();
    await sleep(2100);
    const l2 = await lost();
    assert.ok(l2 >= l1 + 2, `the drain counter is live (${l1} → ${l2})`);
    await page.screenshot({ path: path.join(OUT, 'leftover-fa-drain.png') });
    assert.deepEqual(problems, []);
    await page.close();

    ({ page, problems } = await open('phase=HIDDEN_CORE&variant=drain'));
    await page.waitForSelector('.otwarn[data-state="drain"]', { timeout: 3000 });
    assert.deepEqual(problems, []);
    await page.close();
  });

  test('4. solo battle: pause button → g.pause, paused overlay freezes the clock, Space resumes; hidden in co-op / prep', async () => {
    let { page, problems } = await open('phase=COMBAT&variant=solo');
    await page.waitForSelector('[data-testid="pause"]', { timeout: 3000 });
    await page.click('[data-testid="pause"]');
    await page.waitForSelector('.pauseov', { timeout: 3000 });
    assert.deepEqual(await mockReqs(page, 'g.pause'), [['g.pause', { on: true }]]);
    const cd = () => page.$eval('.gtop__right .countdown', (el) => el.getAttribute('aria-label'));
    const c1 = await cd();
    await sleep(1600);
    assert.equal(await cd(), c1, 'the countdown stands still while paused');
    assert.equal(await page.$eval('[data-testid="pause"]', (el) => el.getAttribute('aria-pressed')), 'true');
    await page.screenshot({ path: path.join(OUT, 'leftover-pause-mock.png') });
    await page.keyboard.press('Space');
    await page.waitForFunction(() => !document.querySelector('.pauseov'), { timeout: 3000 });
    assert.deepEqual(await mockReqs(page, 'g.pause'), [['g.pause', { on: true }], ['g.pause', { on: false }]]);
    // the overlay's 继续作战 resumes too
    await page.keyboard.press('Space');
    await page.waitForSelector('.pauseov', { timeout: 3000 });
    await page.click('.pauseov .btn--primary');
    await page.waitForFunction(() => !document.querySelector('.pauseov'), { timeout: 3000 });
    assert.equal((await mockReqs(page, 'g.pause')).length, 4);
    assert.deepEqual(problems, []);
    await page.close();

    for (const q of ['phase=COMBAT', 'phase=FINAL_ASSAULT', 'phase=PREP&variant=solo']) {
      ({ page, problems } = await open(q));
      assert.equal(await page.$('[data-testid="pause"]'), null, `${q}: no pause control`);
      if (q !== 'phase=PREP&variant=solo') {
        await page.keyboard.press('Space');
        await sleep(300);
        assert.deepEqual(await mockReqs(page, 'g.pause'), [], `${q}: Space does not pause`);
      }
      assert.deepEqual(problems, []);
      await page.close();
    }
  });
});

describe('client leftovers — real server', { skip: !ENABLED && 'set SP_E2E=1 (Chrome + public/assets)' }, () => {
  test('1+4. solo: equip-replace dialog on the real engine, then pause / resume the real local battle', { timeout: 6 * 60 * 1000 }, async () => {
    assert.equal(KIT_ITEMS.length, 3);
    const CHESS = 'chess_char_1_01_a'; // a cheap ranged operator (any legal tile)
    const srv = await startRealServer({ fast: { timerScale: 0.5, combatSpeed: 2, startRound: 1, chess: [CHESS], items: KIT_ITEMS } });
    const P = (await import('puppeteer-core')).default;
    const c = new Client(P, srv.base, 'solo', { prefix: 'leftover' });
    try {
      await c.open();
      await c.enter('替换');
      await c.click('.mode-card', '独立模拟');
      await c.click('.diff-card', '标准模拟');
      await c.click('.create-box button', '开始独立模拟');
      await c.waitFor((s) => !!s.room, 'solo room');
      if (!(await c.st()).phase) await c.click('.room-bar__right button', '开始模拟', { timeout: 20000 });
      await c.waitFor((s) => s.phase === 'INFO_CHECK', 'briefing', 30000);
      await c.click('.brief__foot .btn--primary', '准备就绪');
      await c.waitFor((s) => s.phase === 'BAND_DRAFT', 'band draft', 30000);
      await c.click('.dband', null, { nth: 1 });
      await c.click('.draft-detail__btns .btn--primary', '确认选择');
      await c.waitFor((s) => s.phase === 'PREP' && !s.ready && s.hand >= 4, 'prep with the starter kit', 60000);
      // the held 已选定策略 and 协议启动！ (screens/game.js DRAFT_HOLD_MS + BOOT_MIN_MS, inside BATTLE_CHECK) cover the board first
      await c.page.waitForFunction(() => !document.querySelector('.screen.draft, [data-testid="protocol-boot"]'), { timeout: 15000 });
      await sleep(1800);
      await c.hookRequests();

      // the operator onto the board (drag → direction wheel)
      const [unit] = (await c.handPieces('chess')).filter((p) => p.id === CHESS);
      assert.ok(unit, 'the kit operator is in the hand');
      const tile = await c.freeTileFor(unit.uid);
      await c.drag(await c.piecePoint(unit.uid), await c.tilePoint(tile.row, tile.col));
      await c.page.waitForSelector('.fwheel__dia', { timeout: 4000 });
      await c.swipe('RIGHT');
      await c.waitFor((s) => s.board > 0, 'placed', 8000);
      await sleep(700);

      const itemsOf = () => c.page.evaluate((uid) => (globalThis.__SP__.store.get().match.private.board.find((p) => p.uid === uid)?.items || []).map((x) => ({ uid: x.uid, id: x.id })), unit.uid);
      const handItem = async (id) => (await c.handPieces('item')).find((p) => p.id === id) || null;
      // an item goes to the unit on the tile it is dropped on (user playtest #4 item 1): the operator's own tile
      const dropItem = async (it) => {
        for (let i = 0; i < 2; i++) {
          await c.drag(await c.piecePoint(it.uid, 0.5), await c.tilePoint(tile.row, tile.col));
          await sleep(500);
          if (await c.exists('.eqr') || !(await handItem(it.id))) return;
        }
      };
      // two items equipped normally (no dialog)
      for (const id of KIT_ITEMS.slice(0, 2)) {
        const it = await handItem(id);
        assert.ok(it, `${id} in the hand`);
        await dropItem(it);
        assert.equal(await c.exists('.eqr'), false, 'a free slot: no dialog');
        await c.page.waitForFunction((uid, id) => (globalThis.__SP__.store.get().match.private.board.find((p) => p.uid === uid)?.items || []).some((x) => x.id === id), { timeout: 5000 }, unit.uid, id);
      }
      const equipped = await itemsOf();
      assert.deepEqual(equipped.map((x) => x.id), KIT_ITEMS.slice(0, 2));
      const third = await handItem(KIT_ITEMS[2]);
      const benchSlot = await c.piecePoint(third.uid, 0.5); // where the view draws it in the hand

      // the third: dialog → 取消 → nothing sent / changed
      await dropItem(third);
      await c.page.waitForSelector('.eqr .eqr__opt', { timeout: 4000 });
      assert.deepEqual(await c.page.$$eval('.eqr__opt', (els) => els.map((el) => Number(el.dataset.uid))), equipped.map((x) => x.uid));
      assert.deepEqual(await c.page.$$eval('.eqr__opt .eqr__name', (els) => els.map((el) => el.textContent)), equipped.map((x) => ITEMS.get(x.id).name));
      await c.shot('replace-real');
      const sentBefore = (await c.requests('g.equip')).length;
      await c.click('.eqr__cancel');
      await c.page.waitForFunction(() => !document.querySelector('.eqr'), { timeout: 3000 });
      await sleep(500);
      assert.equal((await c.requests('g.equip')).length, sentBefore, '取消: no g.equip');
      assert.deepEqual(await itemsOf(), equipped, '取消: unchanged');
      assert.ok(await handItem(KIT_ITEMS[2]), '取消: the item stays in the hand');
      // ... and is drawn back on its bench slot before it is picked up again. The view keeps a dropped piece on the drop
      // tile for 1.3 s (render/app/tune.js DROP_PENDING_MS), then flies it back in a frame-timed tween: with few frames
      // (software-rendered headless Chrome on a loaded machine) the drag aimed where it stood a moment before grabbed the
      // operator under it, whose direction wheel then swallowed the retry (the 0.2.0 candidate's full pass).
      const back = await c.page.waitForFunction((uid, x, y) => {
        const r = globalThis.__SP_VIEW__?.pieceScreenRect(uid);
        return !!r && Math.abs(r.left + r.width / 2 - x) < 2 && Math.abs(r.top + r.height / 2 - y) < 2;
      }, { timeout: 15000, polling: 100 }, third.uid, benchSlot.x, benchSlot.y).then(() => true, () => false);
      assert.ok(back, '取消: the item is drawn back on its bench slot');

      // again → pick the OLDER item (not the server's default either way: explicit replaceUid) → 确认替换
      await dropItem(third);
      await c.page.waitForSelector('.eqr .eqr__opt', { timeout: 4000 });
      await c.click('.eqr__opt', null, { nth: 0 });
      await c.click('.eqr__ok');
      await c.page.waitForFunction((uid, id) => (globalThis.__SP__.store.get().match.private.board.find((p) => p.uid === uid)?.items || []).some((x) => x.id === id), { timeout: 5000 }, unit.uid, KIT_ITEMS[2]);
      const last = (await c.requests('g.equip')).pop();
      assert.deepEqual(last[1], { itemUid: third.uid, targetUid: unit.uid, replaceUid: equipped[0].uid });
      const after = await itemsOf();
      assert.deepEqual(after.map((x) => x.uid).sort(), [equipped[1].uid, third.uid].sort(), 'the engine destroyed exactly the picked item');
      assert.equal(await handItem(KIT_ITEMS[0]), null, 'the replaced item is not returned to the hand');
      await c.shot('replace-real-after');

      // 4) ready → the local battle → pause / resume
      await c.click('.readybtn');
      await c.waitFor((s) => s.phase === 'COMBAT', 'combat', 60000);
      await c.page.waitForSelector('[data-testid="pause"]', { visible: true, timeout: 15000 });
      await sleep(1500);
      const btime = () => c.page.evaluate(() => {
        const e = [...(globalThis.__SP_RUNNER__?._entries?.values() || [])].find((x) => x.own && x.battle);
        return e ? e.battle.time : null;
      });
      await c.click('[data-testid="pause"]');
      await c.page.waitForFunction(() => globalThis.__SP__.store.get().match.public?.paused === true, { timeout: 5000 });
      await c.page.waitForSelector('.pauseov', { timeout: 3000 });
      await sleep(400);
      const t1 = await btime();
      const cd1 = await c.page.$eval('.gtop__right .countdown', (el) => el.getAttribute('aria-label'));
      await sleep(2000);
      assert.equal(await btime(), t1, 'the local battle clock stands still');
      assert.equal(await c.page.$eval('.gtop__right .countdown', (el) => el.getAttribute('aria-label')), cd1, 'the countdown stands still');
      assert.deepEqual((await c.requests('g.pause')).map((r) => r[1]), [{ on: true }]);
      await c.shot('pause-real');
      await c.click('.pauseov .btn--primary', '继续作战');
      await c.page.waitForFunction(() => globalThis.__SP__.store.get().match.public?.paused === false, { timeout: 5000 });
      await c.page.waitForFunction(() => !document.querySelector('.pauseov'), { timeout: 3000 });
      await sleep(1200);
      const t2 = await btime();
      assert.ok(t2 == null || t2 > t1, `the battle runs again (${t1} → ${t2})`);
      assert.deepEqual((await c.requests('g.pause')).map((r) => r[1]), [{ on: true }, { on: false }]);
      await c.shot('pause-real-resumed');
      assert.deepEqual(problemsOf([c]), []);
    } finally {
      if (c.problems.length) console.log(c.problems.slice(0, 20).join('\n'));
      await c.close();
      await srv.stop();
    }
  });

  test('3. server restart while a match is on screen: toast + back to the lobby', { timeout: 3 * 60 * 1000 }, async () => {
    let srv = await startRealServer();
    const port = srv.port;
    const P = (await import('puppeteer-core')).default;
    const c = new Client(P, srv.base, 'restart', { prefix: 'leftover' });
    try {
      await c.open();
      await c.enter('重启');
      await c.click('.mode-card', '独立模拟');
      await c.click('.diff-card', '标准模拟');
      await c.click('.create-box button', '开始独立模拟');
      await c.waitFor((s) => !!s.room, 'solo room');
      if (!(await c.st()).phase) await c.click('.room-bar__right button', '开始模拟', { timeout: 20000 });
      await c.waitFor((s) => s.phase === 'INFO_CHECK', 'briefing', 30000);
      const before = await c.st();
      await sleep(600);
      // an imperative dialog left open (the app's own module instance) must not survive onto the lobby
      await c.page.evaluate(() => { import('/js/ui/components.js').then((m) => { globalThis.__e2eDlg = m.confirmDialog({ title: '测试对话框', text: '服务器重启前打开' }); }); });
      await c.page.waitForSelector('.modal', { timeout: 3000 });

      // a crash / kill: no room.closed reaches the client — only the new session's welcome tells
      await srv.stop({ hard: true });
      await sleep(800);
      srv = await startRealServer({ port });
      await c.page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => t.textContent.includes('服务器会话已重置，上一局模拟已结束')), { timeout: 30000 });
      await c.page.waitForSelector('.lobby-screen', { timeout: 10000 });
      const s = await c.st();
      assert.notEqual(s.me, before.me, 'a new server session');
      assert.equal(s.room, null);
      assert.equal(s.phase, null);
      assert.equal(await c.exists('.modal'), false, 'no stale dialog');
      assert.equal(await c.page.evaluate(() => globalThis.__e2eDlg), false, 'the dismissed confirm resolved as cancelled');
      assert.equal(await c.exists('.awayov'), false);
      const restoring = await c.page.evaluate(() => globalThis.__SP__.store.get().ui.restoring);
      assert.equal(restoring, false);
      await c.shot('restart');
      // the lobby works on the new server: a new solo run starts
      await c.click('.mode-card', '独立模拟');
      await c.click('.diff-card', '标准模拟');
      await c.click('.create-box button', '开始独立模拟');
      await c.waitFor((x) => !!x.room, 'a new solo room on the restarted server');
      if (!(await c.st()).phase) await c.click('.room-bar__right button', '开始模拟', { timeout: 20000 });
      await c.waitFor((x) => x.phase === 'INFO_CHECK', 'briefing on the restarted server', 30000);
      // a graceful stop (Ctrl+C / SIGTERM): room.closed 'shutdown' says so first, the same clean way back — and only once
      const resetToast = () => c.page.evaluate(() => [...document.querySelectorAll('.toast')].some((t) => t.textContent.includes('服务器会话已重置')));
      await c.page.waitForFunction(() => ![...document.querySelectorAll('.toast')].some((t) => t.textContent.includes('服务器会话已重置')), { timeout: 20000 });
      await srv.stop();
      await c.page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => t.textContent.includes('服务器维护中')), { timeout: 15000 });
      await c.page.waitForSelector('.lobby-screen', { timeout: 10000 });
      srv = await startRealServer({ port });
      await c.waitFor((x) => x.room == null && x.phase == null, 'lobby after the graceful restart', 30000);
      await c.page.waitForFunction(() => globalThis.__SP__.net.status === 'online', { timeout: 30000 });
      await sleep(800);
      assert.equal(await resetToast(), false, 'the room was already closed by room.closed: no second notice');
      await c.shot('restart-graceful');
      // only the downtime's socket errors are expected
      const other = c.problems.filter((p) => !/WebSocket|ERR_CONNECTION_REFUSED|\/ws\b|net::ERR_/.test(p));
      assert.deepEqual(other, []);
    } finally {
      if (c.problems.length) console.log(c.problems.slice(0, 20).join('\n'));
      await c.close();
      await srv.stop();
    }
  });
});
