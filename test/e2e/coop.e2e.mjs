// Real-server browser E2E (DESIGN §11 "Browser E2E"): the real server (`node server/index.js` on a free port, real
// match engine) and headless Chrome clients (puppeteer-core + the system Chrome) driving the real UI with real
// clicks, keys and canvas drags — never net.request shortcuts.
//
//   node test/e2e/coop.e2e.mjs                         # everything (facing, co-op, solo, result)
//   SP_E2E=1 node --test test/e2e/coop.e2e.mjs         # same through the test runner (skipped in `npm test` otherwise)
//   SP_E2E_ONLY=facing|coop|solo|result  SP_E2E_ROUNDS=5  CHROME_PATH=…
//
// Co-op (host 1920×1080, guest 1280×720): title → 玩法说明 → lobby → create a 同盟模拟 room (险境) → add an AI → the
// guest joins through the ?room= invite link → ready → start → briefing (both ready) → band draft (the guest skips
// once) → rounds 1..N: merge reward if offered, enemy drawer, emote (bubble seen by the teammate), level up (two taps),
// buy an item, refresh (R), buy operators (two taps: 确认购买), drag hand → board (legal tiles lit) + choose a direction on
// the deploy wheel (g.move carries `dir`), board → board (+ wheel), board → hand, re-orient in place (drop on the own
// tile + wheel), sell by tapping a unit → underframe 出售 +N, equip an item by dragging it onto an operator, detail
// panel (right-click), bond popup, freeze and unfreeze, watch a teammate's field during prep (前往查看), settings,
// in-game 玩法说明, ready (click / Space) → 机变 picks →
// combat rendered by the Pixi engine with units on screen. Combat is client-side (DESIGN §14): each browser simulates
// its own battle (battle/runner.js) and reports it; no view switcher during normal combat; once a player's own battle is
// over (⌛ 作战结束，等待队友完成作战 + teammates' progress) a teammate row → 前往查看 shows a local replica of a
// teammate's running battle and 返回战场 goes back; one forced disconnect mid-combat (the guest's socket drops and
// reconnects): the server takes the field over and the guest keeps watching it as a display replica; LP changes are
// settled from the reported results.
// Every step checks the DOM against the store (funds, round, LP, deploy counter, shop cards, team rows).
// Facing (research 09 §1.2 / §5 / §6.5): a solo 独立模拟 on the real server exercising the official prep interactions
// one by one with screenshots test/e2e/out/facing-*.png — two-tap buy (确认购买) and upgrade (确认升级), place + choose a
// direction on the wheel (swipe UP, live striped range, "拖回中心区域取消"), cancel by ✕ and by releasing in the centre
// (the piece returns), re-orient in place, tap → underframe (撤退 / 出售 +N) + range, 撤退, tap-sell, item → 销毁 only,
// long-press-free right-click detail, no drag-to-sell zone, touch (pointerType touch) placement through the wheel.
// Solo: 独立模拟 (绝境) through round 3 (incl. the solo 机变 of round 3). Result: a solo run on a fast-timer server
// (same engine, scaled timers) to RESULT: the settlement flow (intro → 个人战报 → 下一步 → 同盟), then 返回同盟.
// Every page must finish with zero console errors, page errors, failed requests or HTTP errors.
// Screenshots: test/e2e/out/{coop,solo,result}-*.png (…-720.png = the 1280×720 client).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Client, ROOT, sleep, hasChrome, startRealServer, problemsOf, groundAnchor, anchorPoint, cameraSettled } from './client.mjs';

const ENABLED = (process.env.SP_E2E === '1' || !process.env.NODE_TEST_CONTEXT) && hasChrome() && existsSync(path.join(ROOT, 'public/assets'));
const ONLY = process.env.SP_E2E_ONLY || '';
const ROUNDS = Math.max(4, Number(process.env.SP_E2E_ROUNDS) || 4);
const COMBAT = ['COMBAT', 'UNITE', 'FINAL_ASSAULT', 'HIDDEN_CORE'];

let puppeteer = null;
async function pptr() {
  if (!puppeteer) puppeteer = (await import('puppeteer-core')).default;
  return puppeteer;
}

// ---- UI actions --------------------------------------------------------------------------------------------------

/** DOM ⇄ store consistency of the in-match HUD. */
async function checkHud(c, where) {
  const r = await c.page.evaluate(() => {
    const s = globalThis.__SP__.store.get();
    const pub = s.match.public; const priv = s.match.private;
    const txt = (sel) => document.querySelector(sel)?.textContent?.trim() ?? null;
    // a chess slot is any slot but the item's: a slot a 调度中心 upgrade opened stays null until the next roll and shows an
    // empty card (DESIGN §27.52, ui/shopBar.js chessSlots)
    const shopChess = (priv?.shop?.slots || []).filter((x) => !x || x.kind !== 'item').length;
    return {
      phase: pub?.phase, round: pub?.round, lastRound: pub?.lastRound, players: (pub?.players || []).length,
      lp: priv?.lp, teamLp: pub?.teamLp, funds: priv?.funds, cap: priv?.deployCap, count: priv?.deployCount,
      boardChess: (priv?.board || []).filter((p) => p.kind === 'chess').length, hand: (priv?.hand || []).length, temp: (priv?.temp || []).length,
      domRound: txt('.roundbox__num'), domLp: txt('.gtop .lp b'), domFunds: txt('.funds__num'), domRemain: txt('.shopbar__remain b'),
      teamRows: document.querySelectorAll('.team__row').length, cards: document.querySelectorAll('.shopbar__cards > *').length,
      shopChess, shopShown: !!document.querySelector('.shopbar'),
    };
  });
  const tag = `${c.label} ${where}`;
  if (!r.phase) return r;
  assert.ok(r.funds == null || r.funds >= 0, `${tag}: funds never negative`);
  assert.ok(r.hand === 10 && r.temp === 5, `${tag}: hand/temp sizes (${r.hand}/${r.temp})`);
  assert.ok(r.count == null || r.count <= r.cap, `${tag}: deploy count ≤ cap`);
  if (r.count != null) assert.equal(r.boardChess, r.count, `${tag}: deployCount = chess on board`);
  if (r.round > 0 && r.round <= r.lastRound) assert.equal(r.domRound, String(r.round), `${tag}: top bar round`);
  assert.equal(r.teamRows, r.players, `${tag}: one team row per player`);
  if (r.domLp != null && ['COMBAT', 'UNITE'].includes(r.phase)) {
    // live LP (DESIGN §17.5): while the own battle's enemies enter the blue gate the top bar already shows lp − the
    // pending loss (≤ 10 a round), settled at SETTLE
    const shown = Number(r.domLp);
    assert.ok(shown <= r.lp && shown >= Math.max(0, r.lp - 10), `${tag}: top bar LP ${r.domLp} within the round's pending loss of ${r.lp}`);
  } else if (r.domLp != null && !['FINAL_ASSAULT', 'HIDDEN_CORE'].includes(r.phase)) assert.equal(r.domLp, String(r.lp), `${tag}: top bar LP`);
  if (r.shopShown) {
    assert.equal(r.domFunds, String(r.funds), `${tag}: funds card`);
    assert.equal(r.domRemain, String(Math.max(0, r.cap - r.count)), `${tag}: 剩余可放置角色`);
    assert.equal(r.cards, r.shopChess, `${tag}: one card per chess slot`);
  }
  return r;
}

async function takeReward(c, did) {
  if (!(await c.exists('.shopbar__rwcards .scard:not(.scard--sold)'))) return false;
  const before = await c.st();
  if (!did.rewardShot) { await sleep(400); await c.shot('reward'); did.rewardShot = true; }
  // two taps like the shop: select (确认选择) → confirm
  await c.click('.shopbar__rwcards .scard:not(.scard--sold)');
  await c.page.waitForSelector('.shopbar__rwcards .scard.is-armed', { timeout: 3000 });
  await c.click('.shopbar__rwcards .scard.is-armed');
  await c.waitFor((s) => !s.reward || s.phase !== 'PREP', 'reward taken', 8000);
  c.note(`merge reward taken (hand ${before.hand} → ${(await c.st()).hand})`);
  return true;
}

const BUYABLE = '.shopbar__cards .scard:not(.scard--sold):not(.is-disabled)';
/**
 * Two-tap purchase (research 09 §5): the first tap arms the card (确认购买, detail open, nothing bought), the second
 * tap on the same card buys it.
 */
async function buyOne(c, sel = BUYABLE, { shot = null } = {}) {
  const before = await c.st();
  if (before.hand >= 10) return false;
  // prefer copies that complete (or progress) a promotion: merges exercise the reward overlay
  const pick = sel === BUYABLE ? ((await c.exists(`${BUYABLE}.is-merge`)) ? `${BUYABLE}.is-merge`
    : (await c.exists(`${BUYABLE} .scard__pips`)) ? `${BUYABLE}:has(.scard__pips)` : sel) : sel;
  const ok = await c.click(pick, null, { timeout: 1200, optional: true });
  if (!ok) return false;
  await c.page.waitForSelector('.scard.is-armed .scard__confirm', { timeout: 3000 });
  await sleep(250);
  const mid = await c.st();
  assert.equal(mid.funds, before.funds, `${c.label}: the first tap only selects (确认购买)`);
  if (shot) await c.shot(shot);
  await c.click('.scard.is-armed');
  const after = await c.waitFor((s) => s.funds !== before.funds || s.phase !== 'PREP', 'purchase', 8000);
  c.note(`bought${sel.includes('item') ? ' item' : ''} in two taps (funds ${before.funds} → ${after.funds})`);
  return after.funds < before.funds;
}

/**
 * Enemy preview (research 09 §2 / §6.2 item 3): the amber 🔍▶▶ pans the camera to the pen and 🔍◀◀ returns; the
 * enemy list is the 2nd tab (敌方情报) of the 本局信息 dialog behind the left 🔍.
 */
async function openEnemies(c) {
  await c.click('.enemybtn');
  const pen = await c.page.waitForFunction(() => document.querySelector('.gm')?.dataset.camera === 'pen', { timeout: 5000 }).then(() => true, () => false);
  if (pen) {
    await sleep(500);
    await c.shot('pen');
    await c.click('.gtop__iconbtn');
    await c.page.waitForFunction(() => document.querySelector('.gm')?.dataset.camera !== 'pen', { timeout: 4000 });
  }
  await c.click('.gtop__iconbtn[aria-label="本局信息"]');
  await c.page.waitForSelector('.edrawer', { timeout: 5000 });
  await c.click('.edrawer .tabs__tab:nth-child(2)');
  await sleep(300);
  const rows = await c.page.$$eval('.edrawer .erow', (els) => els.length);
  await c.shot('enemies');
  await c.click('.edrawer__close');
  await c.page.waitForFunction(() => !document.querySelector('.edrawer'), { timeout: 4000 });
  c.note(`enemy pen ${pen ? 'shown' : 'unavailable (not prep)'}, list: ${rows} rows`);
  return rows;
}

async function openInfo(c) {
  await c.click('.gtop__iconbtn[aria-label="本局信息"]');
  await c.page.waitForSelector('.edrawer', { timeout: 5000 });
  await sleep(300);
  await c.shot('info');
  await c.click('.edrawer__close');
  return true;
}

async function sendEmote(c, peer) {
  await c.click('.ewheel__btn');
  await c.page.waitForSelector('.ewheel__panel', { timeout: 4000 });
  const items = await c.page.$$eval('.ewheel__item', (els) => els.length);
  assert.equal(items, 6, 'the emote wheel shows one official theme page (3×2)');
  const arts = await c.page.$$eval('.ewheel__item img', (els) => els.filter((e) => e.complete && e.naturalWidth > 0).length);
  await sleep(300);
  await c.shot('emote-wheel');
  await c.click('.ewheel__item', null, { nth: 2 });
  await peer.page.waitForSelector('.team__bubble', { timeout: 6000 });
  await sleep(250);
  await peer.shot('emote-bubble');
  const bubbleArt = await peer.page.$$eval('.team__bubble img', (els) => els.filter((e) => e.complete && e.naturalWidth > 0).length);
  c.note(`emote sent (wheel art ${arts}/6, bubble art ${bubbleArt})`);
  return true;
}

/** Two-tap upgrade: the first tap arms 确认升级 (level unchanged), the second upgrades. */
async function levelUp(c, { shot = null } = {}) {
  const s = await c.st();
  if (s.level >= 6 || s.funds < s.upgradePrice) return false;
  await c.click('.lvcard');
  await c.page.waitForSelector('.lvcard.is-armed', { timeout: 3000 });
  assert.equal((await c.page.$eval('.lvcard__label', (e) => e.textContent)).trim(), '确认升级', `${c.label}: first tap arms 确认升级`);
  await sleep(200);
  assert.equal((await c.st()).level, s.level, `${c.label}: nothing upgraded yet`);
  if (shot) await c.shot(shot);
  await c.click('.lvcard.is-armed');
  const after = await c.waitFor((x) => x.level > s.level || x.phase !== 'PREP', 'level up', 6000);
  c.note(`level ${s.level} → ${after.level} (two taps)`);
  return after.level > s.level;
}

async function refreshKey(c) {
  // phase, funds, price, free counter and slots from ONE store snapshot: the m.private that answers R carries them all,
  // and two separate reads could straddle it — the new slots with the old funds, a false "refresh cost" under load
  const shop = () => c.page.evaluate(() => {
    const st = globalThis.__SP__.store.get();
    const priv = st.match.private;
    const sh = priv.shop;
    return { phase: st.match.public?.phase ?? null, funds: priv.funds, price: sh.refreshPrice, free: sh.freeRefreshes, ids: JSON.stringify(sh.slots.map((x) => x && x.id)) };
  });
  const before = await shop();
  if (before.funds < before.price) return false;
  await c.page.mouse.click(c.w / 2, c.h * 0.3); // focus the page (not a text field)
  await c.page.keyboard.press('KeyR');
  // a free refresh (机变 补给 …) changes the free counter, a paid one the funds; the slots are rerolled either way
  const t0 = Date.now();
  let now = null;
  while (Date.now() - t0 < 6000) {
    now = await shop();
    if (now.phase !== 'PREP' || now.funds !== before.funds || now.free !== before.free || now.ids !== before.ids) break;
    await sleep(150);
  }
  assert.ok(now.funds !== before.funds || now.free !== before.free || now.ids !== before.ids, `${c.label}: R refreshed the shop`);
  if (before.price > 0) assert.equal(now.funds, before.funds - before.price, `${c.label}: refresh cost`);
  c.note(`refresh (R) ${before.price ? `funds ${before.funds} → ${now.funds}` : `free (${before.free} → ${now.free})`}, slots ${before.ids === now.ids ? 'same ids' : 'rerolled'}`);
  return true;
}

async function freezeToggle(c) {
  const s = await c.st();
  await c.click('.toolbtn--ice');
  await c.waitFor((x) => x.frozen !== s.frozen || x.phase !== 'PREP', 'freeze', 6000);
  assert.ok(await c.exists('.shopbar.is-frozen'), 'the frozen shop is tinted');
  await sleep(250);
  await c.shot('frozen');
  await c.page.keyboard.press('KeyF');
  await c.waitFor((x) => x.frozen === s.frozen || x.phase !== 'PREP', 'unfreeze (F)', 6000);
  c.note('freeze (click) + unfreeze (F)');
  return true;
}

/**
 * Every interactive prep tile (the 10 bench pads, the 5 temp pads, the own board) is reachable: the DOM HUD must not
 * swallow the pointer over it. Probes the centre and 4 inner points of each tile's top face (elementFromPoint honours
 * pointer-events). Review regression: the shop bar's box (and its one-line tool row) covered bench slots 5–9 at 16:9.
 */
async function checkTilesClear(c, where) {
  const bad = await c.page.evaluate(() => {
    const raw = globalThis.__SP_VIEW__?.raw;
    const cam = raw?.debug?.cam;
    const canvas = raw?.debug?.app?.view;
    if (!cam || !canvas) return null;
    const cr = canvas.getBoundingClientRect();
    const out = [];
    const probe = (row, col, label) => {
      const z = raw.debug.tiles.heightAt(row, col);
      for (const [dx, dy] of [[0, 0], [-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) {
        const p = cam.project(col + dx, row + dy, z);
        const x = cr.left + p.x, y = cr.top + p.y;
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
        const el = document.elementFromPoint(x, y);
        if (el && el.tagName !== 'CANVAS') { out.push(`${label}@${dx},${dy}:${String(el.className?.baseVal ?? el.className).split(' ')[0]}`); return; }
      }
    };
    for (let i = 0; i < 10; i++) probe(7, i, `hand${i}`);
    for (let i = 0; i < 5; i++) probe(8, 4 + i, `temp${i}`);
    for (let r = 9; r <= 12; r++) for (let col = 0; col <= 10; col++) probe(r, col, `board${r},${col}`);
    return out;
  });
  if (bad == null) return false;
  assert.deepEqual(bad, [], `${c.label} ${where}: the HUD leaves every bench / temp / board tile reachable`);
  return true;
}

const DIR_CYCLE = ['RIGHT', 'UP', 'LEFT', 'DOWN'];

/**
 * The stored facing (m.private board `dir`) must follow the chosen direction (the wheel's g.move carries it as `dir`
 * and `to.dir`), and the piece's model must show it (Back model for UP, mirrored for LEFT).
 */
async function checkStoredDir(c, uid, dir) {
  const t0 = Date.now();
  let p = await c.boardPiece(uid);
  while (p && p.dir !== dir && Date.now() - t0 < 1500) { await sleep(120); p = await c.boardPiece(uid); }
  assert.ok(p, `${c.label}: piece ${uid} on the board`);
  assert.equal(p.dir, dir, `${c.label}: the board keeps the chosen facing`);
  const shown = await c.page.evaluate((uid) => globalThis.__SP_VIEW__?.raw?.debug?.views?.get('p:' + uid)?.dir ?? null, uid);
  if (shown != null) assert.equal(shown, dir, `${c.label}: the model shows the stored facing`);
  return true;
}

/**
 * After a board drop the direction wheel opens: swipe `dir`, then check the g.move {…, dir} that was sent (and the
 * stored facing once the server echoes it).
 */
async function chooseDirection(c, uid, tile, dir, { midShot = null } = {}) {
  await c.page.waitForSelector('.fwheel__dia', { timeout: 4000 });
  await c.swipe(dir, { midShot });
  const t0 = Date.now();
  let sent = null;
  while (Date.now() - t0 < 4000 && !sent) {
    sent = (await c.requests('g.move')).reverse().find((r) => r[1].uid === uid && r[1].to?.area === 'board' && r[1].to.row === tile.row && r[1].to.col === tile.col) || null;
    if (!sent) await sleep(100);
  }
  assert.ok(sent, `${c.label}: g.move sent after the swipe`);
  assert.equal(sent[1].dir, dir, `${c.label}: g.move carries dir ${dir}`);
  assert.equal(await c.exists('.fwheel'), false, `${c.label}: the wheel closed`);
  return sent;
}

/** Hand → board drags + the direction wheel (the first one screenshots the lit legal tiles). */
async function deployFromHand(c, maxMoves, did) {
  let moved = 0;
  await c.hookRequests();
  for (let i = 0; i < maxMoves; i++) {
    const s = await c.st();
    if (!(await c.isEditable()) || s.deployCount >= s.deployCap) break;
    const hand = (await c.handPieces()).filter((p) => p.kind !== 'item');
    if (!hand.length) break;
    const p = hand[0];
    const tile = await c.freeTileFor(p.uid);
    if (!tile) break;
    const from = await c.piecePoint(p.uid);
    const to = await c.tilePoint(tile.row, tile.col);
    if (!from || !to) break;
    await c.drag(from, to, { midShot: did.dragShot ? null : 'drag-legal' });
    did.dragShot = true;
    if ((await c.st()).phase !== 'PREP') break;
    const dir = DIR_CYCLE[(did.dirN = (did.dirN || 0) + 1) % DIR_CYCLE.length];
    await chooseDirection(c, p.uid, tile, dir);
    await c.waitFor((x) => x.board !== s.board || x.phase !== 'PREP', 'deploy', 6000).catch(() => null);
    const onBoard = (await c.boardPieces()).find((b) => b.uid === p.uid);
    if ((await c.st()).phase !== 'PREP') break;
    assert.ok(onBoard, `${c.label}: dragged piece ${p.id} onto the board`);
    assert.deepEqual([onBoard.row, onBoard.col], [tile.row, tile.col], `${c.label}: landed on the target tile`);
    await checkStoredDir(c, p.uid, dir);
    moved += 1;
  }
  if (moved) c.note(`deployed ${moved} (hand → board, direction wheel)`);
  return moved;
}

/** Board chess pieces, front-most first (nothing is drawn in front of them, so they are the easiest to grab). */
async function frontUnits(c, pred = () => true) {
  return (await c.boardPieces()).filter((b) => b.kind === 'chess' && pred(b)).sort((a, b) => a.row - b.row || b.col - a.col);
}

/**
 * Drag piece `uid` to `to()` (re-evaluated per attempt) until `ok()` holds; retries with other grab points of the
 * piece's sprite (a unit standing in front can cover the default one) and logs the view's drop events on a miss.
 */
async function dragPiece(c, uid, to, ok, what, { midShot = null } = {}) {
  await c.drops();
  for (const at of [0.72, 0.45, 0.9]) {
    const from = await c.piecePoint(uid, at);
    const dest = await to();
    if (!from || !dest) break;
    await c.drag(from, dest, { midShot: at === 0.72 ? midShot : null });
    const t0 = Date.now();
    while (Date.now() - t0 < 1500) { if (await ok()) return true; await sleep(120); }
    if ((await c.st()).phase !== 'PREP') return false;
    c.note(`${what}: retry (grab at ${at}) drops ${await c.drops()} toasts ${JSON.stringify(await c.toasts())}`);
  }
  await c.shot(`debug-${what.replace(/[^a-z0-9]+/gi, '-')}`);
  return false;
}

/** Board → another free board tile (through the wheel). */
async function moveOnBoard(c) {
  const unit = (await frontUnits(c))[0];
  if (!unit) return false;
  const tile = await c.freeTileFor(unit.uid, { prefer: 'back' });
  if (!tile) return false;
  await c.hookRequests();
  const landed = await dragPiece(c, unit.uid, () => c.tilePoint(tile.row, tile.col), async () => {
    if (await c.exists('.fwheel__dia')) await chooseDirection(c, unit.uid, tile, 'RIGHT');
    return (await c.boardPieces()).some((b) => b.uid === unit.uid && b.row === tile.row && b.col === tile.col);
  }, 'board-move');
  assert.ok(landed, `${c.label}: board → board move landed (${unit.row},${unit.col}) → (${tile.row},${tile.col})`);
  c.note(`moved ${unit.id} (${unit.row},${unit.col}) → (${tile.row},${tile.col}) facing RIGHT`);
  return true;
}

/**
 * Press on a board unit at `from`, carry it off its tile and back onto `home` (its own tile), release. `home` is aimed at
 * again after the pickup: the own prep board's deploy fold zooms the board then (GitHub #602, client.mjs aimedDrag).
 */
async function offAndBack(c, from, home) {
  const anchor = await groundAnchor(c.page, home);
  const m = c.page.mouse;
  await m.move(from.x, from.y);
  await m.down();
  for (let i = 1; i <= 8; i++) { await m.move(from.x + i * 9, from.y - i * 4); await sleep(14); }
  await cameraSettled(c.page);
  const to = (await anchorPoint(c.page, anchor)) || home;
  for (let i = 1; i <= 10; i++) { await m.move(from.x + 72 + ((to.x - from.x - 72) * i) / 10, from.y - 32 + ((to.y - from.y + 32) * i) / 10); await sleep(14); }
  await sleep(150);
  await m.up();
}

/** Re-orient in place: drag a board unit off and back onto its own tile → the wheel → a new direction. */
async function reorientInPlace(c, dir = 'LEFT', { midShot = null } = {}) {
  const unit = (await frontUnits(c))[0];
  if (!unit) return false;
  await c.hookRequests();
  const from = await c.piecePoint(unit.uid);
  const home = await c.tilePoint(unit.row, unit.col);
  if (!from || !home) return false;
  // off the tile and back: a plain drag whose release lands on the unit's own tile (aimed at again once the piece is
  // picked up: the deploy fold zooms the board then — GitHub #602)
  await offAndBack(c, from, home);
  await chooseDirection(c, unit.uid, { row: unit.row, col: unit.col }, dir, { midShot });
  await sleep(500);
  const after = await c.boardPiece(unit.uid);
  assert.deepEqual([after.row, after.col], [unit.row, unit.col], `${c.label}: re-oriented in place (tile unchanged)`);
  await checkStoredDir(c, unit.uid, dir);
  c.note(`re-oriented ${unit.id} in place → ${dir}`);
  return true;
}

/** Board → an empty hand slot, then back onto the board. */
async function benchRoundTrip(c) {
  const unit = (await frontUnits(c))[0];
  if (!unit) return false;
  const hand = await c.page.evaluate(() => globalThis.__SP__.store.get().match.private.hand.map((p) => !!p));
  // the rightmost free bench slot the HUD does not cover (at 1280×720 the shop tools can hide the last pads)
  let idx = -1;
  for (let i = hand.length - 1; i >= 0 && idx < 0; i--) {
    if (hand[i]) continue;
    const pt = await c.tilePoint(7, i);
    const free = pt && await c.page.evaluate((x, y) => document.elementFromPoint(x, y)?.tagName === 'CANVAS', pt.x, pt.y);
    if (free) idx = i;
  }
  if (idx < 0) return false;
  const toHand = await dragPiece(c, unit.uid, () => c.tilePoint(7, idx),
    async () => (await c.handPieces()).some((p) => p.uid === unit.uid && p.idx === idx), 'board-to-hand');
  assert.ok(toHand, `${c.label}: board → hand slot ${idx}`);
  const tile = await c.freeTileFor(unit.uid);
  await c.hookRequests();
  const back = await dragPiece(c, unit.uid, () => c.tilePoint(tile.row, tile.col), async () => {
    if (await c.exists('.fwheel__dia')) await chooseDirection(c, unit.uid, tile, 'DOWN');
    return (await c.boardPieces()).some((b) => b.uid === unit.uid);
  }, 'hand-to-board');
  assert.ok(back, `${c.label}: hand → board again`);
  c.note(`bench round trip (${unit.id} via hand slot ${idx})`);
  return true;
}

/** Tap a board unit → its underframe (撤退 / 出售 +N) and range; the screenshot shows it; 出售 sells it. */
async function tapUnit(c, uid) {
  for (const at of [0.72, 0.5, 0.88]) {
    const pt = await c.piecePoint(uid, at);
    if (!pt) return false;
    await c.page.mouse.click(pt.x, pt.y);
    if (await c.page.waitForSelector('.uframe', { timeout: 1500 }).then(() => true, () => false)) return true;
  }
  return false;
}

async function sellByTap(c, { shot = 'underframe' } = {}) {
  const unit = (await frontUnits(c, (b) => !b.golden && !b.items))[0];
  if (!unit) return false;
  const before = await c.st();
  // no drag-to-sell zone: the shop bar folds away while a piece is carried (GitHub #602) and a release over its tab — DOM
  // UI — puts the piece back; the unit stays on the board
  const centre = (sel) => c.page.$eval(sel, (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }).catch(() => null);
  const bar = await c.page.$eval('.shopbar__row', (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width * 0.45, y: r.top + r.height / 2 }; });
  const from = await c.piecePoint(unit.uid);
  await c.drag(from, bar, { retarget: () => centre('.shopbar-tab') });
  await sleep(500);
  assert.ok((await c.boardPieces()).some((b) => b.uid === unit.uid), `${c.label}: a release over the folded shop does not sell`);
  assert.equal(await c.exists('.sellzone'), false, 'no sell zone');
  assert.ok(await tapUnit(c, unit.uid), `${c.label}: tapping the unit opens its underframe`);
  assert.ok(await c.exists('.uframe__btn--retreat'), 'underframe: 撤退');
  assert.ok(await c.exists('.uframe__btn--sell'), 'underframe: 出售');
  const price = await c.page.$eval('.uframe__btn--sell .hex__value', (e) => e.textContent.trim());
  assert.match(price, /^\+\d+$/, `出售 shows +N (${price})`);
  await sleep(300);
  if (shot) await c.shot(shot);
  await c.click('.uframe__btn--sell');
  const after = await c.waitFor((s) => s.board < before.board || s.phase !== 'PREP', 'sold', 6000);
  assert.ok(after.funds > before.funds, `${c.label}: selling paid funds`);
  assert.equal(await c.exists('.uframe'), false, 'underframe closed');
  c.note(`sold ${unit.id} with the underframe 出售 ${price} (funds ${before.funds} → ${after.funds})`);
  return true;
}

/** Drag a hand item onto a board operator → equipped. */
async function equipItem(c) {
  const item = (await c.handPieces('item'))[0];
  const target = (await frontUnits(c, (b) => b.items < 2))[0];
  if (!item || !target) return false;
  const rec = await c.page.evaluate((id) => { const r = globalThis.__SP__.data.lookup('items', id); return { type: r?.itemType, kind: r?.kind, name: r?.name }; }, item.id);
  if (rec.type === 'MAGIC') return false;
  const consumed = String(rec.kind || '').startsWith('consume_on_equip');
  await dragPiece(c, item.uid, () => c.piecePoint(target.uid), async () => (await c.exists('.modal')) || !(await c.handPieces('item')).some((p) => p.uid === item.uid), 'equip');
  // a full operator: the equip-replace dialog picks the item to destroy (ui/equipReplace.js)
  await c.confirmReplace(0);
  await sleep(400);
  const after = (await c.boardPieces()).find((b) => b.uid === target.uid);
  const gone = !(await c.handPieces('item')).some((p) => p.uid === item.uid);
  const ok = gone && after && (consumed || after.items > target.items);
  assert.ok(ok, `${c.label}: item ${item.id} (${rec.kind}) equipped onto ${target.id}`);
  c.note(`equipped ${rec.name} (${rec.kind}) → ${target.id}`);
  return true;
}

/** Right-click a board unit → detail panel (name matches), sell button present; Esc closes. */
async function inspectUnit(c) {
  // the front-most unit: nothing is drawn in front of it
  const unit = (await c.boardPieces()).filter((b) => b.kind === 'chess').sort((a, b) => a.row - b.row || b.col - a.col)[0];
  if (!unit) return false;
  const name = await c.page.evaluate((id) => globalThis.__SP__.data.lookup('chess', id)?.name || '', unit.id);
  const pt = await c.piecePoint(unit.uid);
  await c.page.mouse.click(pt.x, pt.y, { button: 'right' });
  await c.page.waitForSelector('.dpanel', { timeout: 5000 });
  const shown = await c.page.$eval('.dpanel .dhead__name', (e) => e.textContent);
  assert.equal(shown, name, `${c.label}: detail panel shows the right-clicked unit`);
  assert.equal(await c.exists('.uframe'), false, `${c.label}: right-click opens the detail only (no underframe)`);
  await sleep(350);
  await c.shot('detail-chess');
  await c.page.keyboard.press('Escape');
  await c.page.waitForFunction(() => !document.querySelector('.dpanel'), { timeout: 4000 });
  c.note(`inspected ${name}`);
  return true;
}

async function inspectShopCard(c) {
  const ok = await c.click('.shopbar__cards .scard:not(.scard--sold)', null, { button: 'right', optional: true, timeout: 1500, any: true });
  if (!ok) return false;
  await c.page.waitForSelector('.dpanel', { timeout: 5000 });
  await sleep(300);
  await c.shot('detail-shop');
  await c.page.keyboard.press('Escape');
  await c.page.waitForFunction(() => !document.querySelector('.dpanel'), { timeout: 4000 });
  return true;
}

async function openBond(c) {
  if (!(await c.exists('.bslot .bond'))) return false;
  await c.click('.bslot .bond');
  await c.page.waitForSelector('.bpop', { timeout: 5000 });
  const name = await c.page.$eval('.bpop .bpop__name', (e) => e.textContent);
  assert.ok(name && name.length > 0, 'bond popup has a name');
  await sleep(300);
  await c.shot('bond');
  await c.click('.bpop__close');
  c.note(`bond popup ${name}`);
  return true;
}

/** Click a teammate's team row during prep → 前往查看 → read-only view of their board, then back. */
async function watchTeammatePrep(c) {
  const target = await c.page.evaluate(() => {
    const s = globalThis.__SP__.store.get();
    return (s.match.public?.players || []).find((p) => p.playerId !== s.me.playerId && p.alive && p.boardCount > 0)?.name || null;
  });
  if (!target) return false;
  await c.click('.team__row:not(.is-self) .team__btn', null, { nth: 0 });
  // research 09 §3.1: the avatar expands a 前往查看 button (client-side combat flow)
  if (await c.click('.team__ob', '前往查看', { optional: true, timeout: 3000 })) c.note('prep: 前往查看');
  await c.page.waitForSelector('.gm__watching', { timeout: 5000 });
  await c.waitFor((s) => (s.field || '').startsWith('n:') && s.field !== `n:${s.me}` || s.phase !== 'PREP', 'teammate board', 6000);
  await sleep(1200);
  const st = await c.viewStats();
  await c.shot('watch-prep');
  // research 09 §2.2 "Teammates": their preview pen comes with their board (Match.prepFieldMeta nextEnemies)
  const theirs = await c.page.evaluate(() => globalThis.__SP__.store.get().match.field?.nextEnemies ?? null);
  if ((await c.st()).phase === 'PREP' && Array.isArray(theirs)) {
    await c.click('.enemybtn');
    if (await c.page.waitForFunction(() => document.querySelector('.gm')?.dataset.camera === 'pen', { timeout: 4000 }).then(() => true, () => false)) {
      await sleep(500);
      const shown = await c.page.evaluate(() => {
        const v = globalThis.__SP_VIEW__;
        return v?.kind === 'engine' ? [...v.raw.debug.penViews.values()].map((x) => x.info.enemyKey) : [...document.querySelectorAll('.ff-pen__enemy')].map((el) => el.dataset.enemy);
      });
      const total = theirs.reduce((n, e) => n + (e.count || 1), 0);
      if ((await c.st()).phase === 'PREP') {
        assert.ok(shown.length > 0 && shown.length <= Math.min(50, total) + theirs.filter((e) => e.elite).length, `${c.label}: the teammate's pen (${shown.length} of ${total})`);
        assert.deepEqual([...new Set(shown)].sort(), [...new Set(theirs.map((e) => e.enemyKey))].sort(), `${c.label}: THEIR enemies in the pen`);
        await c.shot('watch-prep-pen');
        c.note(`scouting: the teammate's pen shows ${shown.length} figures`);
      }
      await c.click('.gtop__iconbtn');
      await c.page.waitForFunction(() => document.querySelector('.gm')?.dataset.camera !== 'pen', { timeout: 4000 }).catch(() => null);
    }
  }
  await c.click('.gm__watching button');
  await c.page.waitForFunction(() => !document.querySelector('.gm__watching'), { timeout: 5000 });
  await sleep(600);
  c.note(`watched a teammate's board during prep (${st?.units ?? '?'} units)`);
  return true;
}

async function openSettings(c) {
  await c.click('.gm__gear');
  await c.page.waitForSelector('.modal', { timeout: 4000 });
  await sleep(300);
  await c.shot('settings');
  await c.page.keyboard.press('Escape');
  await c.page.waitForFunction(() => !document.querySelector('.modal'), { timeout: 4000 });
  return true;
}

/** 玩法说明 viewer: open from `openSel`, page forward (button + arrow key), screenshot, close. */
async function openGuide(c, openSel, shotName) {
  await c.click(openSel);
  await c.page.waitForSelector('.guide', { timeout: 5000 });
  await c.page.waitForFunction(() => { const i = document.querySelector('.guide__page img'); return i && i.complete && i.naturalWidth > 0; }, { timeout: 15000 });
  const r = await c.page.$eval('.guide__page', (el) => { const b = el.getBoundingClientRect(); return b.width / b.height; });
  assert.ok(Math.abs(r - 16 / 9) < 0.02, `guide pages display at 16:9 (${r.toFixed(3)})`);
  const pages = await c.page.$$eval('.guide__dot', (els) => els.length);
  assert.equal(pages, 19, 'the guide has the 19 official tutorial pages');
  await sleep(300);
  await c.shot(shotName);
  await c.click('.guide__next');
  await c.page.keyboard.press('ArrowRight');
  await sleep(200);
  const at = await c.page.$eval('.guide__count', (e) => e.textContent);
  assert.ok(/^3\s*\/\s*19/.test(at.trim()), `guide paged to 3/19 (${at})`);
  await c.page.keyboard.press('Escape');
  await c.page.waitForFunction(() => !document.querySelector('.guide'), { timeout: 4000 });
  return true;
}

async function ready(c, { key = false } = {}) {
  if (!(await c.isEditable())) return;
  const s = await c.st();
  if (!s.canReady) { c.note(`temp not empty (${s.temp}) — ready blocked`); return; }
  // Space asks about leftover funds like the button does (剩余资金, DESIGN §23.11); the button path confirms inside c.click
  if (key) { await c.page.mouse.click(c.w / 2, c.h * 0.3); await c.page.keyboard.press('Space'); await c.confirmFundsLeft(); } else await c.click('.readybtn');
  await c.waitFor((x) => x.ready || x.phase !== 'PREP', 'ready', 8000);
}

async function waitUnits(c, ms = 15000) {
  const t1 = Date.now();
  let st = null;
  while (Date.now() - t1 < ms) {
    st = await c.viewStats();
    if (st && st.mode === 'battle' && st.units > 0) break;
    await sleep(250);
  }
  return st;
}

/** The local battle runner's state (client-side combat). */
const runnerState = (c) => c.page.evaluate(() => globalThis.__SP_RUNNER__?.state() ?? null);

/**
 * Facing end to end (DESIGN §3 / §14): every board piece's stored `dir` (m.private, set by the wheel's g.move) reaches
 * the BattleSpec the server sent (b.start), the unit of the client's local simulation, whose range tiles equal the
 * UI's rotated preview (ui/facing.js rangeTiles — an independent implementation), and the rendered battle view (model
 * + ground wedge). Returns the number of checked units facing something other than RIGHT.
 */
async function checkFacingChain(c) {
  await c.page.waitForFunction(() => { const s = globalThis.__SP_RUNNER__?.state(); return !!s && !s.loading && s.kind === 'normal' && s.own; }, { timeout: 15000 }).catch(() => {});
  await sleep(1200); // deploy animations: every board unit has a battle view
  const r = await c.page.evaluate(async () => {
    const priv = globalThis.__SP__.store.get().match.private;
    const R = globalThis.__SP_RUNNER__;
    const e = R && priv && [...R._entries.values()].find((x) => x.kind === 'normal' && x.fieldId === 'n:' + priv.playerId);
    if (!e) return { err: 'no local battle of the own field' };
    const { rangeTiles } = await import('/js/ui/facing.js');
    const sp = (e.spec.players || []).find((p) => p && p.playerId === priv.playerId);
    const views = globalThis.__SP_VIEW__?.raw?.debug?.views;
    const rows = [];
    for (const p of priv.board || []) {
      if (p.kind !== 'chess' && p.kind !== 'token') continue;
      const want = p.dir || 'RIGHT';
      const su = (sp?.units || []).find((u) => u.uid === p.uid);
      const bu = e.battle.units.find((u) => u.uid === p.uid && u.side === 'ally');
      let range = null;
      if (bu && Array.isArray(bu.baseRangeKeys) && Number.isInteger(bu.tileR)) {
        const ui = rangeTiles(bu.rangeGrid || [[0, 0]], bu.tileR, bu.tileC, want, { extend: bu.s.baseRangeExtend || 0 }).map(([r, cc]) => r * 21 + cc).sort((a, b) => a - b);
        range = JSON.stringify(ui) === JSON.stringify([...bu.baseRangeKeys].sort((a, b) => a - b));
      }
      let shown = null;
      if (views) for (const v of views.values()) if (v.info && v.info.uid === p.uid && v.info.side === 'ally' && !v.destroyed) { shown = [v.dir, !!v.hasDir]; break; }
      rows.push({ uid: p.uid, kind: p.kind, want, spec: su ? su.dir : null, sim: bu ? bu.dir : null, range, shown });
    }
    return { rows };
  });
  assert.equal(r.err, undefined, `${c.label}: ${r.err}`);
  const chess = r.rows.filter((x) => x.kind === 'chess');
  assert.ok(chess.length > 0, `${c.label}: board operators in the battle`);
  for (const x of r.rows) {
    const tag = `${c.label} unit ${x.uid} (${x.want})`;
    if (x.kind === 'chess' || x.spec != null) assert.equal(x.spec, x.want, `${tag}: the BattleSpec carries the stored dir`);
    if (x.kind === 'chess') assert.equal(x.sim, x.want, `${tag}: the local sim unit faces it`);
    if (x.range != null) assert.equal(x.range, true, `${tag}: sim range tiles = the rotated preview`);
    if (x.shown) assert.deepEqual(x.shown, [x.want, true], `${tag}: the battle view shows it (model + wedge)`);
  }
  assert.ok(chess.some((x) => x.shown), `${c.label}: battle views found for the board operators`);
  const turned = r.rows.filter((x) => x.want !== 'RIGHT' && x.sim === x.want).length;
  c.note(`facing chain: ${r.rows.map((x) => `${x.uid}:${x.want}${x.shown ? '' : '(no view)'}`).join(' ')} — ${turned} not RIGHT`);
  return turned;
}

/**
 * One forced disconnect mid-combat: the client's socket drops while its own battle is authoritative and running; the
 * server takes the field over (re-simulating it) and the reconnected client keeps it on screen as a display replica.
 */
async function forcedDisconnect(c, srv) {
  const before = await runnerState(c);
  if (!before || !before.authoritative || before.done || before.kind !== 'normal') return false;
  const me = (await c.st()).me;
  await c.page.evaluate(() => globalThis.__SP__.net.reconnectNow());
  await c.page.waitForFunction((id) => { const s = globalThis.__SP_RUNNER__?.state(); return !!s && s.battleId === id && !s.authoritative; }, { timeout: 20000 }, before.battleId);
  const t0 = Date.now();
  while (Date.now() - t0 < 10000 && !srv.logs.some((l) => l.includes(`server takeover from ${me} (disconnect)`))) await sleep(200);
  assert.ok(srv.logs.some((l) => l.includes(`server takeover from ${me} (disconnect)`)), 'the server took the field over');
  const st = await waitUnits(c, 8000);
  assert.ok(st && st.units > 0, 'the taken-over battle stays on screen');
  await c.shot('combat-takeover');
  c.note(`forced disconnect: ${before.battleId} taken over by the server, shown as a replica (${st.units} views)`);
  return true;
}

/**
 * research 09 §3.1: while the own normal battle runs a teammate cannot be observed; once it is over the waiting pill
 * (with the teammates' progress) shows, a teammate row → 前往查看 runs a local replica of a still running teammate
 * battle, and 返回战场 goes back to the own field.
 */
async function observeAfterFinish(c) {
  const s0 = await runnerState(c);
  if (!s0 || !s0.own) return false;
  if (!s0.done) {
    // not yet: tapping a teammate never offers 前往查看 while the own battle runs (checked once)
    if (!observeAfterFinish.refusedChecked) {
      observeAfterFinish.refusedChecked = true;
      await c.click('.team__row:not(.is-self) .team__btn', null, { nth: 0, optional: true, timeout: 2000 });
      await sleep(300);
      assert.equal(await c.exists('.team__ob'), false, 'no 前往查看 while the own battle runs');
      c.note('own battle running: a teammate row offers no 前往查看');
    }
    return false;
  }
  const other = await c.page.evaluate(() => {
    const s = globalThis.__SP__.store.get();
    const pub = s.match.public;
    if (pub?.phase !== 'COMBAT') return null;
    const f = (pub.fields || []).find((x) => x.kind === 'normal' && x.live && !x.players.includes(s.me.playerId));
    if (!f) return null;
    const rows = (pub.players || []).slice().sort((a, b) => a.seat - b.seat).filter((p) => p.playerId !== s.me.playerId);
    return { fieldId: f.fieldId, nth: rows.findIndex((p) => p.playerId === f.players[0]) };
  });
  if (!other || other.nth < 0) return false;
  const pill = await c.page.waitForSelector('.chud__wait', { timeout: 5000 }).then(() => true, () => false);
  if (!pill && (await c.st()).phase !== 'COMBAT') return false; // the round moved on meanwhile
  assert.ok(pill, 'waiting pill: 作战结束，等待队友完成作战');
  assert.ok(await c.exists('.chud__progress'), "teammates' progress under the pill");
  await c.shot('combat-waiting');
  await c.click('.team__row:not(.is-self) .team__btn', null, { nth: other.nth });
  if (!(await c.click('.team__ob', '前往查看', { optional: true, timeout: 3000 }))) return false;
  const ok = await c.page.waitForFunction((fid) => { const s = globalThis.__SP_RUNNER__?.state(); return !!s && s.fieldId === fid && s.watch; }, { timeout: 15000 }, other.fieldId).then(() => true, () => false);
  if (!ok) return false; // the phase moved on
  const st = await waitUnits(c, 8000);
  assert.ok(st && st.units > 0, 'the observed battle renders units');
  assert.ok(await c.exists('.chud__observe'), 'observing pill');
  await sleep(800);
  await c.shot('combat-observe');
  if ((await c.st()).phase === 'COMBAT') {
    await c.click('.team__back, .chud__back', '返回战场', { optional: true, timeout: 3000 });
    await c.page.waitForFunction(() => { const s = globalThis.__SP_RUNNER__?.state(); return !s || (s.own && !s.watch); }, { timeout: 10000 }).catch(() => {});
    // user playtest #2 item 6: back on the own battlefield the enemy pen stays hidden (figures, 2D rows, 3D area)
    await sleep(1300);
    const pen = await c.page.evaluate(() => {
      const d = globalThis.__SP_VIEW__?.raw?.debug;
      if (!d || globalThis.__SP__.store.get().match.public?.phase !== 'COMBAT') return null;
      return {
        visible: [...d.penViews.values()].filter((x) => x.root && x.root.visible !== false).length, band: d.tiles.band,
        area: d.board3d ? Math.max(...d.board3d.area.map((a) => a.r1)) : null,
      };
    });
    if (pen) {
      assert.equal(pen.visible, 0, '返回战场: no enemy pen figure');
      // the 3D area ends at the field's separator row 13 (its devices blow into the field: act2 m01's blowers, user
      // playtest #5 item 6); the pen starts at row 14
      assert.ok(pen.band[1] <= 13 && (pen.area == null || pen.area <= 13), `返回战场: no pen rows / area (${JSON.stringify(pen)})`);
    }
  }
  c.note(`observed ${other.fieldId} after the own battle (${st.units} views) and went back`);
  return true;
}

/** Drag hand piece `uid` onto `tile` and stop there (the wheel opens); returns the tile's point. */
async function dropOnTile(c, uid, tile) {
  const from = await c.piecePoint(uid);
  const to = await c.tilePoint(tile.row, tile.col);
  await c.drag(from, to);
  await c.page.waitForSelector('.fwheel__dia', { timeout: 4000 });
  return to;
}

/** The same with touch input (pointerType 'touch': CDP touch events), aimed at `to` again after the pickup (GitHub #602). */
async function touchDrag(c, from, to, steps = 12) {
  const t = c.page.touchscreen;
  const anchor = await groundAnchor(c.page, to);
  await t.touchStart(from.x, from.y);
  const lead = 3;
  for (let i = 1; i <= lead; i++) { await t.touchMove(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps); await sleep(16); }
  if (anchor) await cameraSettled(c.page);
  const dest = (await anchorPoint(c.page, anchor)) || to;
  const start = { x: from.x + ((to.x - from.x) * lead) / steps, y: from.y + ((to.y - from.y) * lead) / steps };
  for (let i = 1; i <= steps - lead; i++) { await t.touchMove(start.x + ((dest.x - start.x) * i) / (steps - lead), start.y + ((dest.y - start.y) * i) / (steps - lead)); await sleep(16); }
  await sleep(120);
  await t.touchEnd();
}

/**
 * The official prep interactions one by one (research 09 §1.2 / §5 / §6.5) on a solo run. Screenshots:
 * facing-{buy-confirm, wheel, wheel-up, placed, cancel, reorient, underframe, retreat, sell, item-destroy,
 * detail-longpress, touch-wheel, upgrade-confirm}.png.
 */
async function facingTour(c, did) {
  await c.hookRequests();
  if (!did.clear) did.clear = await checkTilesClear(c, 'facing tour');
  const s0 = await c.st();
  // two-tap buy
  if (!did.buy) did.buy = await buyOne(c, BUYABLE, { shot: 'buy-confirm' });
  for (let k = 0; k < 2; k++) if (!(await buyOne(c))) break;
  // an item for the 销毁 underframe (when the shop has one and funds allow)
  if (!did.item && !(await c.handPieces('item')).length) did.itemBought = await buyOne(c, '.shopbar__item .scard:not(.scard--sold):not(.is-disabled)').catch(() => false);
  const units = () => c.handPieces().then((h) => h.filter((p) => p.kind === 'chess'));
  let hand = await units();
  // a bought operator can merge into an elite at once (two copies already fielded) and leave the bench empty: the
  // placement steps then wait for a later round (`did` carries them over)
  if (!hand.length) { c.note('facing: no operator on the bench this round (the bought ones merged)'); return; }
  // place + choose a direction (UP: striped rotated range + 拖回中心区域取消 while held) — the unit with the widest range
  // grid shows it best (a defender's grid is its own tile only)
  if (!did.place) {
    const sizes = await c.page.evaluate((ids) => ids.map((id) => globalThis.__SP__.data.lookup('chess', id)?.rangeGrid?.length || 0), hand.map((x) => x.id));
    const p = hand.map((x, i) => ({ ...x, n: sizes[i] })).sort((a, b) => b.n - a.n)[0];
    const tile = await c.freeTileFor(p.uid);
    await dropOnTile(c, p.uid, tile);
    await sleep(350);
    await c.shot('wheel');
    assert.ok(await c.exists('.fwheel__cancel'), '✕ 点击取消 tag');
    const w = await c.wheel();
    const m = c.page.mouse;
    await m.move(w.x, w.y); await m.down();
    for (let i = 1; i <= 10; i++) { await m.move(w.x + 1, w.y - (w.half * 0.72 * i) / 10); await sleep(16); }
    await sleep(250);
    assert.ok(await c.exists('.fwheel__chev.is-on'), 'the UP chevron lights');
    assert.ok(await c.exists('.fwheel__tip'), 'tooltip 拖回中心区域取消 outside the centre');
    if (p.n > 1) assert.ok(await c.exists('.fwheel__stripes polygon'), 'striped range tiles');
    // with the 3D board the stripes lie between the board and the Pixi canvas: under the units, like the original
    if (p.n > 1 && (await c.viewStats())?.board3d?.on) assert.ok(await c.exists('.fwheel__stripes--under polygon'), 'stripes under the units (3D board)');
    await c.shot('wheel-up');
    await m.up();
    const sent = (await c.requests('g.move')).pop();
    assert.deepEqual(sent[1], { uid: p.uid, to: { area: 'board', row: tile.row, col: tile.col, dir: 'UP' }, dir: 'UP' }, 'g.move {uid, to {…, dir}, dir: UP}');
    await c.waitFor((x) => x.board > s0.board, 'placed', 6000);
    await checkStoredDir(c, p.uid, 'UP');
    await sleep(700);
    await c.shot('placed');
    did.place = true;
    c.note(`placed ${p.id} facing UP on (${tile.row},${tile.col})`);
  }
  // cancel: ✕ and releasing in the centre — the piece stays in the bench, nothing is sent
  hand = await units();
  if (hand.length && !did.cancel) {
    const p = hand[0];
    const tile = await c.freeTileFor(p.uid);
    const n0 = (await c.requests('g.move')).length;
    await dropOnTile(c, p.uid, tile);
    await sleep(250);
    await c.click('.fwheel__cancel');
    await sleep(500);
    assert.equal(await c.exists('.fwheel'), false, '✕ closes the wheel');
    assert.ok((await c.handPieces()).some((x) => x.uid === p.uid), '✕: the piece is back on the bench');
    await c.shot('cancel');
    await dropOnTile(c, p.uid, tile);
    await c.swipe(null);
    await sleep(400);
    assert.equal(await c.exists('.fwheel'), false, 'release in the centre closes the wheel');
    assert.ok((await c.handPieces()).some((x) => x.uid === p.uid), 'centre release: the piece is back on the bench');
    assert.equal((await c.requests('g.move')).length, n0, 'nothing sent on cancel');
    // keyboard alternative: ← then Enter
    const b0 = (await c.st()).board;
    await dropOnTile(c, p.uid, tile);
    await c.page.keyboard.press('ArrowLeft');
    await sleep(150);
    await c.page.keyboard.press('Enter');
    await c.waitFor((x) => x.board > b0 || x.phase !== 'PREP', 'keyboard placement', 6000);
    assert.equal((await c.requests('g.move')).pop()[1].dir, 'LEFT', 'arrow keys choose the direction');
    did.cancel = true;
  }
  // re-orient in place (drag onto the own tile → the wheel)
  if (!did.reorient) did.reorient = await reorientInPlace(c, 'DOWN', { midShot: 'reorient' });
  // tap → underframe + range; 撤退 back to the bench
  if (!did.retreat) {
    const unit = (await frontUnits(c))[0];
    assert.ok(await tapUnit(c, unit.uid), 'tap opens the underframe');
    assert.ok(await c.exists('.dpanel'), 'and the detail card');
    await sleep(350);
    await c.shot('underframe');
    await c.click('.uframe__btn--retreat');
    const t0 = Date.now();
    while (Date.now() - t0 < 5000 && (await c.boardPieces()).some((b) => b.uid === unit.uid)) await sleep(120);
    assert.ok((await c.handPieces()).some((x) => x.uid === unit.uid), '撤退: back on the bench');
    await sleep(300);
    await c.shot('retreat');
    // and back onto the board, facing RIGHT
    const tile = await c.freeTileFor(unit.uid);
    const b1 = (await c.st()).board;
    await dropOnTile(c, unit.uid, tile);
    await c.swipe('RIGHT');
    await c.waitFor((x) => x.phase !== 'PREP' || x.board > b1, 'redeploy', 6000);
    did.retreat = true;
  }
  // tap-sell (no drag-to-sell)
  if (!did.sell) did.sell = await sellByTap(c, { shot: 'sell' });
  // items: tap → 销毁 only
  const it = (await c.handPieces('item'))[0];
  if (it && !did.item) {
    const pt = await c.piecePoint(it.uid);
    await c.page.mouse.click(pt.x, pt.y);
    await c.page.waitForSelector('.uframe', { timeout: 4000 });
    assert.ok(await c.exists('.uframe__btn--destroy'), 'items: 销毁');
    assert.equal(await c.exists('.uframe__btn--sell'), false, 'items cannot be sold');
    assert.equal(await c.exists('.uframe__btn--retreat'), false);
    await sleep(300);
    await c.shot('item-destroy');
    await c.click('.uframe__btn--destroy');
    await c.page.waitForSelector('.modal', { timeout: 4000 });
    await c.click('.modal__actions .btn', '销毁');
    const t0 = Date.now();
    while (Date.now() - t0 < 5000 && (await c.handPieces('item')).some((x) => x.uid === it.uid)) await sleep(120);
    assert.ok(!(await c.handPieces('item')).some((x) => x.uid === it.uid), 'item destroyed');
    did.item = true;
    c.note('item tapped → 销毁');
  }
  // right-click = detail only (the touch long-press equivalent)
  const u = (await frontUnits(c))[0];
  if (u && !did.detail) {
    const pt = await c.piecePoint(u.uid);
    await c.page.mouse.click(pt.x, pt.y, { button: 'right' });
    await c.page.waitForSelector('.dpanel', { timeout: 4000 });
    assert.equal(await c.exists('.uframe'), false, 'detail only');
    // a new placement closes that card: drag another board unit (or the same one) onto its own tile → wheel, no card
    const other = (await frontUnits(c)).find((b) => b.uid !== u.uid) || u;
    const n0 = (await c.requests('g.move')).length;
    const from = await c.piecePoint(other.uid);
    const home = await c.tilePoint(other.row, other.col);
    await offAndBack(c, from, home);
    if (await c.page.waitForSelector('.fwheel__dia', { timeout: 3000 }).then(() => true, () => false)) {
      assert.equal(await c.exists('.dpanel'), false, 'a drag closes the right-click detail card');
      await c.page.keyboard.press('Escape');
      await sleep(300);
      assert.equal(await c.exists('.fwheel'), false, 'Esc cancels the wheel');
      assert.equal((await c.requests('g.move')).length, n0, 'nothing sent on Esc');
    } else await c.page.keyboard.press('Escape');
    did.detail = true;
  }
  // touch: drag a bench unit with a finger, swipe the wheel with a finger (pointerType 'touch')
  hand = await units();
  const st = await c.st();
  if (hand.length && !did.touch && st.deployCount < st.deployCap) {
    const p = hand[0];
    const tile = await c.freeTileFor(p.uid);
    const from = await c.piecePoint(p.uid);
    const to = await c.tilePoint(tile.row, tile.col);
    await touchDrag(c, from, to);
    const open = await c.page.waitForSelector('.fwheel__dia', { timeout: 4000 }).then(() => true, () => false);
    if (open) {
      const w = await c.wheel();
      await c.page.touchscreen.touchStart(w.x, w.y);
      for (let i = 1; i <= 10; i++) { await c.page.touchscreen.touchMove(w.x - (w.half * 0.7 * i) / 10, w.y + 1); await sleep(16); }
      await sleep(200);
      await c.shot('touch-wheel');
      await c.page.touchscreen.touchEnd();
      await c.waitFor((x) => x.board > st.board || x.phase !== 'PREP', 'touch placement', 6000);
      assert.equal((await c.requests('g.move')).pop()[1].dir, 'LEFT', 'touch swipe → LEFT');
      did.touch = true;
      c.note('touch drag + touch swipe placed a unit');
    } else c.note('touch drag did not open the wheel (no touch input in this Chrome)');
  }
}

// ---- tests ---------------------------------------------------------------------------------------------------------

describe('browser E2E against the real server', { skip: !ENABLED && 'needs Chrome + public/assets (run: node test/e2e/coop.e2e.mjs)' }, () => {
  test('facing: the direction wheel and the official prep interactions (solo)', { skip: !!ONLY && ONLY !== 'facing', timeout: 15 * 60 * 1000 }, async () => {
    const srv = await startRealServer();
    const c = new Client(await pptr(), srv.base, 'facing', { prefix: 'facing' });
    const did = { dragShot: true, rewardShot: true };
    try {
      await c.open();
      await c.enter('推进之王');
      await c.click('.mode-card', '独立模拟');
      await c.click('.diff-card', '标准模拟');
      await c.click('.create-box button', '开始独立模拟');
      await c.waitFor((s) => !!s.room, 'solo room');
      if (!(await c.st()).phase) await c.click('.room-bar__right button', '开始模拟', { timeout: 20000 });
      await c.waitFor((s) => s.phase === 'INFO_CHECK', 'briefing', 30000);
      await c.click('.brief__foot .btn--primary', '准备就绪');
      await c.waitFor((s) => s.phase === 'BAND_DRAFT', 'band draft', 30000);
      await c.click('.dband', null, { nth: 2 });
      await c.click('.draft-detail__btns .btn--primary', '确认选择');
      for (let round = 1; round <= 3; round++) {
        const s0 = await c.waitFor((s) => (s.phase === 'PREP' && s.round === round && !s.ready) || (s.phase === 'SP_DRAFT' && s.round === round), `prep ${round}`, 90000);
        if (s0.phase === 'SP_DRAFT') {
          // two taps (user playtest #4 item 2): select, then confirm on the selected card
          await c.click('.spcard.is-pickable');
          await c.click('.spcard.is-armed');
          await c.waitFor((s) => s.phase === 'PREP' && !s.ready, `prep ${round} after 机变`, 30000);
        }
        await sleep(1800);
        await takeReward(c, did);
        await facingTour(c, did);
        if (!did.upgrade) did.upgrade = await levelUp(c, { shot: 'upgrade-confirm' });
        await deployFromHand(c, 3, did);
        await ready(c);
        await c.waitFor((s) => s.phase !== 'PREP', `combat ${round}`, 30000);
        if ((await c.st()).phase === 'COMBAT') did.chain = (did.chain || 0) + await checkFacingChain(c);
        if (['buy', 'place', 'cancel', 'reorient', 'retreat', 'sell', 'detail', 'upgrade', 'item', 'touch'].every((k) => did[k])) break;
      }
      c.note(`facing tour: ${JSON.stringify(did)}`);
      for (const k of ['buy', 'place', 'cancel', 'reorient', 'retreat', 'sell', 'detail', 'upgrade', 'chain']) assert.ok(did[k], `did ${k}`);
      if (!did.item) c.note('no item was affordable in 3 rounds: 销毁 underframe not exercised');
      if (!did.touch) c.note('touch placement not exercised');
      assert.deepEqual(problemsOf([c]), [], 'no console errors, page errors, failed requests or HTTP errors');
    } finally {
      console.log(c.log.join('\n'));
      if (c.problems.length) console.log(`facing problems:\n  ${c.problems.slice(0, 30).join('\n  ')}`);
      console.log(`screenshots: ${c.shots.join(' ')}`);
      await c.close();
      await srv.stop();
    }
  });

  test(`co-op: 2 humans + 1 AI, lobby → briefing → band draft → ${ROUNDS} rounds`, { skip: !!ONLY && ONLY !== 'coop', timeout: 40 * 60 * 1000 }, async () => {
    const srv = await startRealServer();
    const P = await pptr();
    const host = new Client(P, srv.base, 'host', { prefix: 'coop' });
    const guest = new Client(P, srv.base, 'guest', { w: 1280, h: 720, prefix: 'coop' });
    const both = [host, guest];
    const did = { watched: false, watchedPrep: false, sold: false, reoriented: false, leveled: false, refreshed: false, froze: false, itemBought: false, equipped: false,
      inspected: false, shopDetail: false, bond: false, enemies: -1, info: false, emote: false, moved: false, bench: false, settings: false, guideGame: false,
      reward: 0, sp: 0, unite: false, combatRounds: new Set(), takeover: false, lpChanged: false, settledBy: new Set(), facingTurned: 0 };
    const lps = new Map();
    try {
      // ---- title, 玩法说明, lobby, room --------------------------------------------------------------------------
      await host.open();
      await sleep(900);
      await host.shot('title');
      await openGuide(host, '.title-guide', 'guide-title');
      await host.enter('凯尔希');
      await sleep(400);
      await host.shot('lobby');
      await openGuide(host, '.lobby-guide', 'guide-lobby');
      // 创建同盟 creates the room at once (标准); the host changes the difficulty in the room (the event's 联合模拟)
      const room = await host.createCoop('险境模拟');
      await host.click('button', '添加 AI 队友');
      await guest.open(`?room=${room.code}`);
      await guest.shot('title');
      await guest.enter('阿米娅');
      await guest.waitFor((s) => s.room?.code === room.code, 'guest joined via the invite link');
      await guest.click('.room-bar__right button', '准备就绪');
      await sleep(500);
      await host.shot('room');
      await guest.shot('room');
      await host.click('.room-bar__right button', '开始模拟', { timeout: 20000 });

      // ---- briefing -----------------------------------------------------------------------------------------------
      for (const c of both) await c.waitFor((s) => s.phase === 'INFO_CHECK', 'briefing', 30000);
      await sleep(1200);
      for (const c of both) await c.shot('briefing');
      for (const c of both) await c.click('.brief__foot .btn--primary', '准备就绪');

      // ---- band draft -----------------------------------------------------------------------------------------------
      for (const c of both) await c.waitFor((s) => s.phase !== 'INFO_CHECK', 'band draft', 40000);
      let guestSkipped = false;
      const picked = new Set();
      const shotDraft = new Set();
      const t0 = Date.now();
      while (Date.now() - t0 < 180000) {
        const [hs, gs] = [await host.st(), await guest.st()];
        if (hs.phase !== 'BAND_DRAFT' && gs.phase !== 'BAND_DRAFT') break;
        for (const [c, s] of [[host, hs], [guest, gs]]) {
          if (s.phase !== 'BAND_DRAFT') continue;
          if (!shotDraft.has(c.label)) { shotDraft.add(c.label); await sleep(700); await c.shot(s.draft?.turn === s.me ? 'draft-myturn' : 'draft-waiting'); }
          if (picked.has(c.label) || s.draft?.turn !== s.me) continue;
          if (c === guest && !guestSkipped) {
            guestSkipped = true;
            // one skip — only while someone is left to pass to: the last player still to pick sees 跳过 disabled
            // (PR #546), which a random draft order gives the guest about one time in three
            // (PR #828: 跳过选择 sits in the step header's turn line, .dturn .draft-skip, on the player's own turn)
            const canSkip = await c.page.evaluate(() => [...document.querySelectorAll('.dturn .draft-skip')]
              .some((b) => b.textContent.includes('跳过') && !b.disabled));
            if (canSkip) {
              await c.click('.dturn .draft-skip', '跳过');
              c.note('band draft: skipped once');
              continue;
            }
            c.note('band draft: 跳过 disabled (the last player still to pick)');
          }
          if ((s.draft?.picks || 0) > 0) {
            // research 09 §5: a strategy a teammate (human or AI) picked is marked 队友已选 and cannot be chosen
            await c.page.waitForSelector('.dband.is-taken .dband__taken', { timeout: 4000 });
            if (!shotDraft.has('taken')) {
              shotDraft.add('taken');
              // the strategy grid scrolls and the AI's weighted pick can sit below the fold: scroll it into view
              // like a player would (a 15 s "nothing clickable" flake whenever the taken band was out of view)
              await c.page.evaluate(() => document.querySelector('.dband.is-taken')?.scrollIntoView({ block: 'center' }));
              await sleep(150);
              await c.click('.dband.is-taken', null, { any: true });
              await sleep(250);
              assert.equal(await c.exists('.draft-detail__btns .btn--primary:not([disabled])'), false, '队友已选: confirm disabled');
              await c.shot('draft-taken');
            }
          }
          // the nth free strategy, skipping 老鲤 (【得闲饮茶】 holds the funds of rounds 1–2 back until round 3: a human on
          // it has nothing to deploy in the first battles, and the round-1 facing chain needs board operators)
          const bandName = await c.page.evaluate((nth) => {
            const free = [...document.querySelectorAll('.dband:not(.is-taken)')].filter((el) => el.querySelector('.dband__name')?.textContent.trim() !== '老鲤');
            const el = free[nth] || free[0];
            el?.scrollIntoView({ block: 'nearest' });
            return el?.querySelector('.dband__name')?.textContent.trim() || null;
          }, c === host ? 3 : 7);
          assert.ok(bandName, `${c.label}: a free strategy to pick`);
          await sleep(150);
          await c.click('.dband:not(.is-taken)', bandName);
          await sleep(250);
          if (!shotDraft.has(`${c.label}-sel`)) { shotDraft.add(`${c.label}-sel`); await c.shot('draft-selected'); }
          await c.click('.draft-detail__btns .btn--primary', '确认选择');
          picked.add(c.label);
          c.note('band picked');
        }
        await sleep(250);
      }
      assert.equal(picked.size, 2, `both humans picked a band (${[...picked]})`);
      assert.ok(guestSkipped, 'the guest used the skip');

      // ---- rounds -----------------------------------------------------------------------------------------------------
      const seen = new Set();
      let lastCombat = '';
      const deadline = Date.now() + 35 * 60 * 1000;
      while (Date.now() < deadline) {
        const hs = await host.st();
        if (hs.result || hs.phase === 'RESULT') break;
        seen.add(hs.phase);
        if (hs.phase === 'BATTLE_CHECK' && !seen.has('bc-shot')) { seen.add('bc-shot'); await host.shot('battle-check'); }
        if (hs.phase === 'PREP') {
          for (const c of both) {
            if (!(await c.isEditable())) continue;
            const s = await c.st();
            const peer = c === host ? guest : host;
            if (!seen.has(`prep-${c.label}-${s.round}`)) {
              seen.add(`prep-${c.label}-${s.round}`);
              await sleep(1800); // past the 休整期 banner
              await c.shot(`prep-r${s.round}`);
            }
            await checkHud(c, `prep r${s.round} start`);
            if (!seen.has(`clear-${c.label}`) && await checkTilesClear(c, `prep r${s.round}`)) seen.add(`clear-${c.label}`);
            if (await takeReward(c, did)) did.reward += 1;
            if (c === host && did.enemies < 0) did.enemies = await openEnemies(c);
            if (c === host && !did.info) did.info = await openInfo(c);
            if (c === guest && !did.emote) did.emote = await sendEmote(c, peer);
            if (c === guest && s.round >= 2 && !did.leveled) did.leveled = await levelUp(c);
            if (c === host && s.round >= 2 && !did.itemBought) did.itemBought = await buyOne(c, '.shopbar__item .scard:not(.scard--sold):not(.is-disabled)');
            if (c === host && s.round >= 3 && !did.refreshed) did.refreshed = await refreshKey(c);
            if (!did.shopDetail && c === host) did.shopDetail = await inspectShopCard(c);
            for (let k = 0; k < 3; k++) if (!(await buyOne(c))) break;
            if (await takeReward(c, did)) did.reward += 1;
            await deployFromHand(c, 4, did);
            if (c === host && s.round >= 2 && !did.moved) did.moved = await moveOnBoard(c);
            if (c === guest && s.round >= 2 && !did.bench) did.bench = await benchRoundTrip(c);
            if (c === host && s.round >= 2 && !did.sold) did.sold = await sellByTap(c);
            if (c === guest && s.round >= 2 && !did.reoriented) did.reoriented = await reorientInPlace(c, 'UP', { midShot: 'reorient' });
            if (!did.equipped) did.equipped = await equipItem(c);
            if (c === host && s.round >= 2 && !did.inspected) did.inspected = await inspectUnit(c);
            if (c === host && !did.bond) did.bond = await openBond(c);
            if (c === guest && !did.froze) did.froze = await freezeToggle(c);
            if (c === host && s.round >= 2 && !did.watchedPrep) did.watchedPrep = await watchTeammatePrep(c);
            if (c === guest && s.round >= 2 && !did.settings) did.settings = await openSettings(c);
            if (c === host && s.round >= 3 && !did.guideGame) did.guideGame = await openGuide(c, '.gm__guide', 'guide-ingame');
            await deployFromHand(c, 2, did);
            await checkHud(c, `prep r${s.round} end`);
            await ready(c, { key: c === guest });
          }
        } else if (hs.phase === 'SP_DRAFT') {
          for (const c of both) {
            const s = await c.st();
            if (s.phase !== 'SP_DRAFT') continue;
            if (!seen.has(`sp-${c.label}-${s.round}`)) { seen.add(`sp-${c.label}-${s.round}`); await sleep(2000); await c.shot(`sp-r${s.round}`); }
            if (s.sp?.turn === s.me && (await c.exists('.spcard.is-pickable'))) {
              await c.click('.spcard.is-pickable');
              await c.click('.spcard.is-armed');
              await c.waitFor((x) => x.sp?.turn !== x.me || x.phase !== 'SP_DRAFT', '机变 pick', 8000);
              did.sp += 1;
              c.note(`机变 picked (round ${s.round})`);
            }
          }
        } else if (COMBAT.includes(hs.phase) && lastCombat !== `${hs.round}:${hs.phase}`) {
          lastCombat = `${hs.round}:${hs.phase}`;
          assert.equal(await host.viewKind(), 'engine', 'the Pixi render engine is mounted (not the DOM fallback)');
          const st = await waitUnits(host);
          assert.ok(st && st.mode === 'battle' && st.units > 0, `round ${hs.round} ${hs.phase}: battle units on screen (${JSON.stringify(st && { mode: st.mode, units: st.units })})`);
          assert.equal(st.spine?.failed ?? 0, 0, 'no Spine load failures');
          const gst = await waitUnits(guest, 8000);
          assert.ok(gst && gst.units > 0, `guest round ${hs.round}: battle units on screen`);
          await sleep(1600);
          const tag = hs.phase === 'UNITE' ? `unite-r${hs.round}` : `combat-r${hs.round}`;
          for (const c of both) await c.shot(tag);
          await checkHud(host, tag);
          if (hs.phase === 'UNITE') did.unite = true;
          else did.combatRounds.add(hs.round);
          host.note(`round ${hs.round} ${hs.phase}: ${st.units} views, fps ${st.fps}, spine ${JSON.stringify(st.spine)}`);
          if (hs.phase === 'COMBAT') {
            // client-side combat: the own battle runs in each browser; no view switcher during normal combat
            assert.equal(await host.exists('.chud .vswitch__arrow'), false, 'no ‹ › switcher during normal combat');
            for (const c of both) {
              await c.page.waitForFunction(() => { const s = globalThis.__SP_RUNNER__?.state(); return !!s && !s.loading && s.kind === 'normal'; }, { timeout: 15000 }).catch(() => {});
              const rs = await runnerState(c);
              assert.ok(rs && rs.kind === 'normal' && rs.own, `${c.label} runs its own battle locally (${JSON.stringify(rs)})`);
              did.facingTurned += await checkFacingChain(c);
            }
            if (!did.takeover && hs.round >= 2) did.takeover = await forcedDisconnect(guest, srv);
            // wait for either human's own battle to end while a teammate still fights, then observe it
            const t1 = Date.now();
            while (!did.watched && Date.now() - t1 < 120000) {
              const cs = await host.st();
              if (cs.phase !== 'COMBAT' || cs.round !== hs.round) break;
              for (const c of both) if (!did.watched) did.watched = await observeAfterFinish(c);
              await sleep(400);
            }
          } else if (hs.phase === 'UNITE') {
            const rs = await runnerState(host);
            assert.ok(rs && rs.kind === 'unite', 'every human simulates the 联防 field locally');
            // 0.2.1 (the owner's decision of 2026-10-07): the 联防 field is the round's battlefield, terrain and crates
            // included — the field meta names the match stage and the view draws it (0.2.0 drew the escaped levels' road)
            for (const c of both) {
              const drawn = await c.page.evaluate(() => {
                const s = globalThis.__SP__.store.get();
                return { match: s.match.public?.stageId ?? null, field: s.match.field?.stageId ?? null, shown: globalThis.__SP_VIEW__?.raw?.debug?.tiles?.stage?.id ?? null };
              });
              assert.ok(drawn.match && drawn.field === drawn.match && drawn.shown === drawn.match, `${c.label}: the 联防 field shows the round's battlefield (${JSON.stringify(drawn)})`);
              c.note(`联防 round ${hs.round} drawn on ${drawn.shown}`);
            }
          }
          if (hs.round >= ROUNDS && hs.phase === 'COMBAT') { await sleep(2000); break; }
        } else if (hs.phase === 'SETTLE' && !seen.has(`settle-${hs.round}`)) {
          seen.add(`settle-${hs.round}`);
          await host.shot(`settle-r${hs.round}`);
        }
        // results are settled from the browsers' reports: kills / leaks reach m.private.stats, LP follows the leaks
        for (const c of both) {
          const s = await c.st();
          if (s.lp == null) continue;
          const prev = lps.get(c.label);
          if (prev && prev.lp !== s.lp) { did.lpChanged = true; c.note(`LP ${prev.lp} → ${s.lp} (round ${s.round})`); }
          if ((s.kills || 0) + (s.leaks || 0) > 0) did.settledBy.add(c.label); // kills / leaks come from the reported results
          lps.set(c.label, { lp: s.lp, kills: s.kills, leaks: s.leaks });
        }
        await sleep(300);
      }
      const end = await host.st();
      assert.ok(end.round >= ROUNDS || end.result, `reached round ${ROUNDS} (at ${end.round} ${end.phase})`);
      host.note(`did: ${JSON.stringify({ ...did, combatRounds: [...did.combatRounds] })}; phases: ${[...seen].filter((x) => !x.includes('-')).join(',')}`);
      const rstats = await host.page.evaluate(() => globalThis.__SP_RUNNER__?.stats());
      host.note(`runner: ${JSON.stringify(rstats)}; lp/kills/leaks: ${JSON.stringify([...lps])}; LP changed: ${did.lpChanged}`);
      assert.ok(did.combatRounds.size >= ROUNDS, `combat rendered in ${ROUNDS} rounds (${[...did.combatRounds]})`);
      assert.ok(did.takeover, 'a forced disconnect mid-combat was taken over by the server');
      assert.deepEqual([...did.settledBy].sort(), ['guest', 'host'], 'both browsers\' reported results were settled (kills / leaks reached m.private.stats)');
      for (const [label, v] of lps) assert.ok(v.lp > 0 && v.lp <= 60, `${label} LP settled (${v.lp})`);
      assert.ok(!srv.logs.some((l) => /rejected client result/.test(l)), 'no client result was rejected');
      assert.equal(rstats.errors, 0, 'the local simulation never failed');
      for (const k of ['watched', 'watchedPrep', 'sold', 'reoriented', 'refreshed', 'froze', 'leveled', 'inspected', 'shopDetail', 'bond', 'emote', 'moved', 'bench', 'settings', 'guideGame', 'info']) {
        assert.ok(did[k], `did ${k}`);
      }
      assert.ok(did.enemies >= 0, 'enemy drawer opened');
      assert.ok(did.facingTurned > 0, 'an UP / LEFT / DOWN unit went through the whole facing chain');
      assert.ok(did.sp >= 1, '机变 picked in round 3');
      assert.deepEqual(problemsOf(both), [], 'no console errors, page errors, failed requests or HTTP errors');
    } finally {
      console.log([...host.log, ...guest.log].join('\n'));
      for (const c of both) if (c.problems.length) console.log(`${c.label} problems:\n  ${c.problems.slice(0, 30).join('\n  ')}`);
      console.log(`screenshots: ${[...host.shots, ...guest.shots].join(' ')}`);
      for (const c of both) await c.close();
      await srv.stop();
    }
  });

  test('solo: 独立模拟 (绝境) through round 3 incl. the solo 机变', { skip: !!ONLY && ONLY !== 'solo', timeout: 20 * 60 * 1000 }, async () => {
    const srv = await startRealServer();
    const solo = new Client(await pptr(), srv.base, 'solo', { prefix: 'solo' });
    const did = { dragShot: true, rewardShot: false };
    try {
      await solo.open();
      await solo.enter('杜宾');
      await solo.click('.mode-card', '独立模拟');
      await solo.click('.diff-card', '绝境模拟');
      await solo.click('.create-box button', '开始独立模拟');
      await solo.waitFor((s) => !!s.room, 'solo room');
      if (!(await solo.st()).phase) await solo.click('.room-bar__right button', '开始模拟', { timeout: 20000 });
      await solo.waitFor((s) => s.phase === 'INFO_CHECK', 'briefing', 30000);
      await sleep(900);
      await solo.shot('briefing');
      await solo.click('.brief__foot .btn--primary', '准备就绪');
      await solo.waitFor((s) => s.phase === 'BAND_DRAFT', 'band draft', 30000);
      await sleep(700);
      await solo.shot('draft');
      await solo.click('.dband', null, { nth: 1 });
      await solo.click('.draft-detail__btns .btn--primary', '确认选择');
      for (let round = 1; round <= 3; round++) {
        const s0 = await solo.waitFor((s) => (s.phase === 'PREP' && s.round === round && !s.ready) || (s.phase === 'SP_DRAFT' && s.round === round), `prep ${round}`, 90000);
        if (s0.phase === 'SP_DRAFT') {
          await sleep(2000);
          await solo.shot(`sp-r${round}`);
          await solo.click('.spcard.is-pickable');
          await solo.click('.spcard.is-armed');
          await solo.waitFor((s) => s.phase === 'PREP' && !s.ready, `prep ${round} after 机变`, 30000);
          solo.note(`solo 机变 picked (round ${round})`);
        }
        await sleep(1700);
        await checkHud(solo, `solo prep r${round}`);
        await takeReward(solo, did);
        if (round === 2) await levelUp(solo);
        for (let k = 0; k < 3; k++) if (!(await buyOne(solo))) break;
        await deployFromHand(solo, 4, did);
        await equipItem(solo).catch(() => false);
        await solo.shot(`prep-r${round}`);
        await ready(solo, { key: round === 2 });
        await solo.waitFor((s) => s.phase === 'COMBAT', `combat ${round}`, 30000);
        const st = await waitUnits(solo);
        assert.ok(st?.units > 0, 'solo battle renders units');
        await sleep(1500);
        await solo.shot(`combat-r${round}`);
      }
      // leave for good: exit → 放弃模拟 → lobby
      await solo.click('.gtop__exit');
      await sleep(300);
      await solo.shot('exit');
      await solo.click('.modal__actions .btn', '放弃模拟');
      await solo.waitFor((s) => !s.room && !s.phase, 'back in the lobby', 20000);
      await solo.page.waitForSelector('.lobby-screen', { timeout: 10000 });
      assert.deepEqual(problemsOf([solo]), [], 'no console errors, page errors, failed requests or HTTP errors');
    } finally {
      console.log(solo.log.join('\n'));
      if (solo.problems.length) console.log(`solo problems:\n  ${solo.problems.slice(0, 30).join('\n  ')}`);
      console.log(`screenshots: ${solo.shots.join(' ')}`);
      await solo.close();
      await srv.stop();
    }
  });

  test('result: a fast-timer solo run to the RESULT screen and back to the room', { skip: !!ONLY && ONLY !== 'result', timeout: 20 * 60 * 1000 }, async () => {
    const srv = await startRealServer({ fast: { timerScale: 0.3, combatSpeed: 24 } });
    const c = new Client(await pptr(), srv.base, 'result', { prefix: 'result' });
    try {
      await c.open();
      await c.enter('煌');
      await c.click('.mode-card', '独立模拟');
      await c.click('.diff-card', '标准模拟');
      await c.click('.create-box button', '开始独立模拟');
      await c.waitFor((s) => !!s.room, 'solo room');
      if (!(await c.st()).phase) await c.click('.room-bar__right button', '开始模拟', { timeout: 20000 });
      await c.waitFor((s) => s.phase === 'INFO_CHECK', 'briefing', 30000);
      await c.click('.brief__foot .btn--primary', '准备就绪');
      await c.waitFor((s) => s.phase === 'BAND_DRAFT', 'band draft', 30000);
      await c.click('.dband', null, { nth: 0 });
      await c.click('.draft-detail__btns .btn--primary', '确认选择');
      const t0 = Date.now();
      let bossShot = false;
      let bossPrep = null; // the Final Assault prep: { camera, deployed } (research 09 §1.2, own half of the boss field)
      while (Date.now() - t0 < 15 * 60 * 1000) {
        const s = await c.st();
        if (s.result || s.phase === 'RESULT') break;
        if (s.phase === 'PREP' && !s.ready && s.alive) {
          // one cheap operator on the board each round keeps some fights going
          await buyOne(c).catch(() => false);
          if (s.round === s.bossRound && !bossPrep) {
            // the boss round's prep: the pieces stand on the own (left, solo) half of the boss field; a hand unit still
            // drags onto a board tile and gets its direction (drops come back in board coordinates)
            await sleep(900);
            const cam = (await c.st()).camera;
            const pf = await c.page.evaluate(() => globalThis.__SP_VIEW__?.raw?.prepField?.() ?? null);
            let deployed = 0;
            let err = null;
            try { deployed = await deployFromHand(c, 1, { dragShot: true }); } catch (e) { err = e; }
            await c.shot('boss-prep');
            bossPrep = { cam, pf, deployed, err: err ? String(err.message || err) : null };
            c.note(`boss-round prep: camera ${cam}, ${JSON.stringify(pf)}, deployed ${deployed}${err ? ` (${bossPrep.err})` : ''}`);
          } else await deployFromHand(c, 2, { dragShot: true }).catch(() => 0);
          await ready(c);
        } else if (s.phase === 'SP_DRAFT' && (await c.exists('.spcard.is-pickable'))) {
          await c.click('.spcard.is-pickable', null, { optional: true, timeout: 2000 });
          await c.click('.spcard.is-armed', null, { optional: true, timeout: 2000 });
        } else if ((s.phase === 'FINAL_ASSAULT' || s.phase === 'HIDDEN_CORE') && !bossShot) {
          await waitUnits(c, 8000);
          await sleep(1200);
          await c.shot('boss');
          bossShot = true;
        }
        await sleep(300);
      }
      await c.waitFor((s) => s.result, 'm.result', 30000);
      if (bossPrep) {
        assert.equal(bossPrep.cam, 'bossPrep', 'the boss-round prep shows the own half of the boss field');
        assert.deepEqual(bossPrep.pf, { kind: 'bossPrep', side: 'L', mirror: false }, 'solo: the left half');
        assert.equal(bossPrep.err, null, 'a deploy in the boss-round prep lands on its board tile with its direction');
      } else c.note('the run ended before the boss round');
      await c.page.waitForSelector('[data-testid="settle"]', { timeout: 10000 });
      // the radar intro gives way to my own report by itself (screens/settle.js INTRO_MS)
      await c.page.waitForSelector('[data-testid="settle-self"]', { timeout: 10000 });
      await sleep(2000);
      await c.shot('screen');
      assert.equal(await c.page.$$eval('.sops .sop', (els) => els.length), 10, 'the report shows the ten lineup slots');
      await c.click('.settle__next');
      await c.page.waitForSelector('[data-testid="settle-team"]', { timeout: 10000 });
      await sleep(1000);
      await c.shot('team');
      const players = await c.page.$$eval('.tcard', (els) => els.length);
      assert.equal(players, 1, 'one player card');
      await c.click('.settle__back');
      await c.page.waitForSelector('.room-screen, .lobby-screen', { timeout: 15000 });
      await sleep(500);
      await c.shot('back');
      assert.deepEqual(problemsOf([c]), [], 'no console errors, page errors, failed requests or HTTP errors');
    } finally {
      console.log(c.log.join('\n'));
      if (c.problems.length) console.log(`result problems:\n  ${c.problems.slice(0, 30).join('\n  ')}`);
      console.log(`screenshots: ${c.shots.join(' ')}`);
      await c.close();
      await srv.stop();
    }
  });
});
