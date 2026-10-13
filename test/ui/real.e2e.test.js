// Real-server browser E2E (DESIGN §11 "Browser E2E"): the real server (server/index.js on a free port) and headless
// Chrome clients driving the real UI with real clicks, keys and canvas drags — no net.request shortcuts.
//
//   SP_REAL_E2E=1 node --test test/ui/real.e2e.test.js            # co-op (2 humans + AI) to round 4+, then a solo run
//   SP_REAL_E2E=1 SP_REAL_ROUNDS=6 node --test test/ui/real.e2e.test.js
//
// Co-op: host creates a 同盟模拟 room (险境), adds an AI teammate; the guest joins through the ?room= invite link;
// both ready, the host starts. Briefing ready → band draft (guest skips once, then picks a strategy nobody took —
// 队友已选) → every prep round: take a merge reward if offered (two taps), buy from the shop (two taps: 确认购买), drag
// hand pieces onto legal board tiles and choose a direction on the deploy wheel (g.move carries `dir`), sell a unit by
// tapping it → underframe 出售 +N, level up (two taps), refresh, freeze/unfreeze, equip bought items by dragging them
// onto a unit, ready (mouse / keyboard) → 机变 picks → combat rendered by the Pixi engine with real Spine units (client-
// side combat: no view switcher); once a human's own battle is over, a teammate row → 前往查看 shows that teammate's
// running battle and 返回战场 goes back (research 09 §3.1) → … until combat of round SP_REAL_ROUNDS (default 4).
// Solo: 独立模拟 (标准), free band pick, two rounds with shopping and deployment, then 放弃模拟 back to the lobby.
// Every page must finish with zero console errors, page errors, failed requests or HTTP errors.
// Screenshots: test/e2e/out/real-*.png.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'test/e2e/out');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_REAL_E2E === '1' && existsSync(CHROME) && existsSync(path.join(ROOT, 'public/assets'));
const ROUNDS = Math.max(2, Number(process.env.SP_REAL_ROUNDS) || 4);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CHROME_ARGS = ['--no-sandbox', '--no-first-run', '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'];

/**
 * One player: its own Chrome process with a single (always visible) tab. Two tabs of one browser would leave one
 * hidden — no animation frames, so the Pixi view and puppeteer's visibility checks stall.
 */
class Client {
  constructor(puppeteer, base, label, { w = 1920, h = 1080 } = {}) {
    Object.assign(this, { puppeteer, base, label, w, h, problems: [], log: [], shots: 0, hashed: { spine: 0, media: 0, other: 0 } });
  }

  async open(query = '') {
    this.browser = await this.puppeteer.launch({ executablePath: CHROME, headless: true, args: CHROME_ARGS, protocolTimeout: 60000 });
    const [first] = await this.browser.pages();
    const page = first || await this.browser.newPage();
    this.page = page;
    await page.setViewport({ width: this.w, height: this.h });
    page.on('console', (m) => { if (m.type() === 'error') this.problems.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => this.problems.push(`pageerror: ${e.message}`));
    page.on('requestfailed', (r) => { if (!/fonts\.(googleapis|gstatic)/.test(r.url())) this.problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`); });
    page.on('response', (r) => {
      if (r.status() >= 400) this.problems.push(`http ${r.status()}: ${r.url()}`);
      // the served manifest's content-hashed URLs (docs/ASSETS.md): Spine files, audio through /media/~<hash>/, the rest
      const p = new URL(r.url()).pathname;
      if (r.status() === 200 && /^\/(?:assets|media)\/~[0-9a-f]{16}\//.test(p)) {
        this.hashed[/\.(?:skel|atlas)$|\/spine\//.test(p) ? 'spine' : p.startsWith('/media/') ? 'media' : 'other']++;
      }
    });
    page.on('dialog', (d) => d.dismiss().catch(() => {}));
    await page.goto(`${this.base}/${query}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!globalThis.__SP__ && !!document.querySelector('.screen'), { timeout: 30000 });
  }

  note(msg) { this.log.push(`[${this.label}] ${msg}`); }

  /** Compact snapshot of the client store. */
  st() {
    return this.page.evaluate(() => {
      const s = globalThis.__SP__.store.get();
      const pub = s.match.public;
      const priv = s.match.private;
      const me = pub?.players?.find((p) => p.playerId === s.me.playerId) || null;
      return {
        me: s.me.playerId, room: s.room ? { code: s.room.code, inMatch: !!s.room.inMatch, mode: s.room.mode } : null,
        phase: pub?.phase ?? null, round: pub?.round ?? 0, status: me?.status ?? null, alive: priv ? priv.alive !== false : true,
        ready: !!priv?.ready, funds: priv?.funds ?? null, level: priv?.shop?.level ?? null, frozen: !!priv?.shop?.frozen,
        upgradePrice: priv?.shop?.upgradePrice ?? null, refreshPrice: priv?.shop?.refreshPrice ?? null,
        deployCap: priv?.deployCap ?? 8, deployCount: priv?.deployCount ?? 0, reward: !!priv?.shop?.rewardOffer,
        hand: (priv?.hand || []).filter(Boolean).length, temp: (priv?.temp || []).filter(Boolean).length,
        board: (priv?.board || []).length, result: !!s.match.result, field: s.match.field?.fieldId ?? null,
        sp: pub?.sp ? { turn: pub.sp.turn, picked: Object.keys(pub.sp.picks || {}).length } : null,
        draft: pub?.draft ? { turn: pub.draft.turn, picks: Object.keys(pub.draft.picks || {}).length } : null,
      };
    });
  }

  async waitFor(pred, what, timeout = 60000) {
    const t0 = Date.now();
    let last = null;
    while (Date.now() - t0 < timeout) {
      last = await this.st();
      if (pred(last)) return last;
      await sleep(250);
    }
    throw new Error(`${this.label}: timed out waiting for ${what} (last: ${JSON.stringify(last)})`);
  }

  async close() { await this.browser?.close().catch(() => {}); }

  /** Real mouse click on the `nth` visible element matching `sel` whose text includes `text`. */
  async click(sel, text = null, { timeout = 15000, optional = false, nth = 0 } = {}) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const pt = await this.page.evaluate((sel, text, nth) => {
        let n = 0;
        for (const el of document.querySelectorAll(sel)) {
          if (text && !(el.textContent || '').includes(text)) continue;
          if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
          const r = el.getBoundingClientRect();
          if (r.width < 2 || r.height < 2) continue;
          const x = r.left + r.width / 2, y = r.top + r.height / 2;
          const top = document.elementFromPoint(x, y);
          if (top && !el.contains(top) && !top.contains(el)) continue; // covered
          if (n++ < nth) continue;
          return { x, y };
        }
        return null;
      }, sel, text, nth);
      if (pt) { await this.page.mouse.click(pt.x, pt.y); return true; }
      await sleep(200);
    }
    if (optional) return false;
    throw new Error(`${this.label}: nothing clickable for ${sel}${text ? ` "${text}"` : ''}`);
  }

  async exists(sel) { return !!(await this.page.$(sel)); }

  async shot(name) {
    await this.page.screenshot({ path: path.join(OUT, `real-${name}.png`) });
    this.shots += 1;
  }

  /** Title → lobby with a callsign. */
  async enter(name) {
    await this.page.waitForSelector('.title-login input', { timeout: 20000 });
    await this.click('.title-login input'); // fresh profile per client: the field starts empty
    await this.page.keyboard.type(name);
    await this.click('.title-login button', '开始');
  }

  // ---- field view helpers (render engine debug hooks) ------------------------------------------------------------

  viewKind() { return this.page.evaluate(() => globalThis.__SP_VIEW__?.kind ?? null); }
  viewStats() { return this.page.evaluate(() => { try { return globalThis.__SP_VIEW__?.raw?.stats?.() ?? null; } catch { return null; } }); }

  /** Client point to grab a prep piece. Waits (up to 2.5 s) until the piece is drawn and holds still: a piece bought
   *  this frame has no rect yet, and one still sliding to its tile would be grabbed over a neighbouring tile. */
  async piecePoint(uid) {
    const read = () => this.page.evaluate((uid) => {
      const r = globalThis.__SP_VIEW__?.pieceScreenRect(uid);
      if (!r || !(r.width >= 4)) return null;
      const x = r.left + r.width / 2, y = r.top + r.height * 0.72;
      return x >= 0 && y >= 0 && x <= innerWidth && y <= innerHeight ? { x, y } : null;
    }, uid);
    let last = null;
    for (const end = Date.now() + 2500; Date.now() < end; await sleep(80)) {
      const p = await read();
      if (p && last && Math.abs(p.x - last.x) < 1.5 && Math.abs(p.y - last.y) < 1.5) return p;
      last = p;
    }
    return last;
  }

  /** Client point of a board tile centre (top face). */
  tilePoint(row, col) {
    return this.page.evaluate((row, col) => {
      const raw = globalThis.__SP_VIEW__?.raw;
      const cam = raw?.debug?.cam;
      if (!cam) return null;
      const z = raw.debug.tiles.heightAt(row, col);
      const p = cam.project(col, row, z);
      const cr = raw.debug.app.view.getBoundingClientRect();
      return { x: cr.left + p.x, y: cr.top + p.y };
    }, row, col);
  }

  async drag(from, to, steps = 14) {
    const m = this.page.mouse;
    await m.move(from.x, from.y);
    await m.down();
    for (let i = 1; i <= steps; i++) { await m.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps); await sleep(14); }
    await sleep(120);
    await m.up();
  }

  /** An empty legal tile for a hand piece (mirrors the deploy rules: melee on melee tiles, ranged anywhere). */
  freeTileFor(uid) {
    return this.page.evaluate((uid) => {
      const { store, data } = globalThis.__SP__;
      const s = store.get();
      const priv = s.match.private;
      const st = data.lookup('stages', s.match.public.stageId);
      const piece = [...priv.hand, ...priv.temp].find((p) => p && p.uid === uid);
      if (!piece || !st?.deployTiles?.normal) return null;
      const rec = piece.kind === 'token' ? data.lookup('tokens', piece.id) : data.lookup('chess', piece.id);
      const melee = rec?.position === 'MELEE';
      const dt = st.deployTiles.normal;
      const tiles = melee ? dt.melee : [...dt.rangedOnly, ...dt.melee];
      const used = new Set(priv.board.map((p) => `${p.row},${p.col}`));
      const free = tiles.filter(([r, c]) => !used.has(`${r},${c}`));
      if (!free.length) return null;
      free.sort((a, b) => (b[1] - a[1]) || (a[0] - b[0])); // towards the gates first
      return { row: free[0][0], col: free[0][1] };
    }, uid);
  }

  handPieces(kind = null) {
    return this.page.evaluate((kind) => {
      const priv = globalThis.__SP__.store.get().match.private;
      return (priv?.hand || []).filter((p) => p && (!kind || p.kind === kind)).map((p) => ({ uid: p.uid, id: p.id, kind: p.kind, golden: !!p.golden }));
    }, kind);
  }

  boardPieces() {
    return this.page.evaluate(() => (globalThis.__SP__.store.get().match.private?.board || []).map((p) => ({
      uid: p.uid, id: p.id, kind: p.kind, golden: !!p.golden, row: p.row, col: p.col, items: (p.items || []).length,
    })));
  }

  async isEditable() {
    const s = await this.st();
    return s.phase === 'PREP' && !s.ready && s.alive;
  }

  // ---- prep actions ---------------------------------------------------------------------------------------------------

  async takeReward() {
    if (!(await this.exists('.shopbar__rwcards .scard:not(.scard--sold)'))) return false;
    const before = await this.st();
    await this.click('.shopbar__rwcards .scard:not(.scard--sold)');
    await this.page.waitForSelector('.shopbar__rwcards .scard.is-armed', { timeout: 3000 });
    await this.click('.shopbar__rwcards .scard.is-armed');
    await this.waitFor((s) => !s.reward || s.phase !== 'PREP', 'reward taken', 8000);
    this.note(`reward taken (hand ${before.hand} → ${(await this.st()).hand})`);
    return true;
  }

  /** Two taps (research 09 §5): the first selects (确认购买), the second buys. */
  async buyOne(sel = '.shopbar__cards .scard:not(.scard--sold):not(.is-disabled)') {
    const before = await this.st();
    const ok = await this.click(sel, null, { timeout: 1500, optional: true });
    if (!ok) return false;
    await this.page.waitForSelector('.scard.is-armed', { timeout: 3000 });
    assert.equal((await this.st()).funds, before.funds, `${this.label}: the first tap only selects`);
    await this.click('.scard.is-armed');
    const after = await this.waitFor((s) => s.funds !== before.funds || s.phase !== 'PREP', 'purchase', 8000);
    this.note(`bought${sel.includes('item') ? ' item' : ''} (funds ${before.funds} → ${after.funds})`);
    return after.funds < before.funds;
  }

  buyItem() { return this.buyOne('.shopbar__item .scard:not(.scard--sold):not(.is-disabled)'); }

  /** Right-click a board unit on the canvas → detail panel with its name. */
  async inspectUnit() {
    // the front-most unit (nothing is drawn in front of it)
    const unit = (await this.boardPieces()).filter((b) => b.kind === 'chess').sort((a, b) => a.row - b.row || b.col - a.col)[0];
    if (!unit) return false;
    const name = await this.page.evaluate((id) => globalThis.__SP__.data.lookup('chess', id)?.name || '', unit.id);
    const pt = await this.piecePoint(unit.uid);
    await this.page.mouse.click(pt.x, pt.y, { button: 'right' });
    await this.page.waitForSelector('.dpanel', { timeout: 5000 });
    const shown = await this.page.$eval('.dpanel .dhead__name', (e) => e.textContent);
    assert.equal(shown, name, `${this.label}: detail panel shows the right-clicked unit`);
    await sleep(300);
    await this.shot(`detail-${this.label}`);
    await this.page.keyboard.press('Escape');
    await this.page.waitForFunction(() => !document.querySelector('.dpanel'), { timeout: 4000 });
    this.note(`inspected ${name}`);
    return true;
  }

  /** Click the first bond disc → popup with the bond name; close it. */
  async openBond() {
    if (!(await this.exists('.bslot .bond'))) return false;
    await this.click('.bslot .bond');
    await this.page.waitForSelector('.bpop', { timeout: 5000 });
    const name = await this.page.$eval('.bpop .bpop__name', (e) => e.textContent);
    assert.ok(name && name.length > 0, 'bond popup has a name');
    await sleep(250);
    await this.shot(`bond-${this.label}`);
    await this.click('.bpop__close');
    this.note(`bond popup ${name}`);
    return true;
  }

  /** Enemy preview: 🔍▶▶ pans to the pen (🔍◀◀ back); the list is the 敌方情报 tab of the 本局信息 dialog (left 🔍). */
  async openEnemies() {
    await this.click('.enemybtn');
    const pen = await this.page.waitForFunction(() => document.querySelector('.gm')?.dataset.camera === 'pen', { timeout: 5000 }).then(() => true, () => false);
    if (pen) {
      await sleep(500);
      await this.shot(`pen-${this.label}`);
      await this.click('.gtop__iconbtn');
      await this.page.waitForFunction(() => document.querySelector('.gm')?.dataset.camera !== 'pen', { timeout: 4000 });
    }
    await this.click('.gtop__iconbtn[aria-label="本局信息"]');
    await this.page.waitForSelector('.edrawer', { timeout: 5000 });
    await this.click('.edrawer .tabs__tab:nth-child(2)');
    await sleep(250);
    const rows = await this.page.$$eval('.edrawer .erow', (els) => els.length);
    await this.shot(`enemies-${this.label}`);
    await this.click('.edrawer__close');
    this.note(`enemy pen ${pen ? 'shown' : 'unavailable'}, list: ${rows} rows`);
    return rows;
  }

  async emote() {
    await this.click('.ewheel__btn');
    await this.click('.ewheel__item', null, { nth: 2 });
  }

  async deployFromHand(maxMoves = 3) {
    let moved = 0;
    for (let i = 0; i < maxMoves; i++) {
      const s = await this.st();
      if (!(await this.isEditable()) || s.deployCount >= s.deployCap) break;
      const hand = (await this.handPieces()).filter((p) => p.kind !== 'item');
      if (!hand.length) break;
      const p = hand[0];
      const tile = await this.freeTileFor(p.uid);
      if (!tile) break;
      const from = await this.piecePoint(p.uid);
      const to = await this.tilePoint(tile.row, tile.col);
      if (!from || !to) break;
      await this.drag(from, to);
      // the direction wheel (research 09 §1.2): swipe from its centre towards a side, release
      await this.page.waitForSelector('.fwheel__dia', { timeout: 4000 });
      const w = await this.page.$eval('.fwheel__dia', (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, half: r.width / 2 }; });
      const up = i % 2 === 1;
      await this.drag({ x: w.x, y: w.y }, { x: w.x + (up ? 1 : w.half * 0.7), y: w.y - (up ? w.half * 0.7 : 0) }, 10);
      await this.waitFor((x) => x.board !== s.board || x.phase !== 'PREP', 'deploy', 6000).catch(() => null);
      const onBoard = (await this.boardPieces()).find((b) => b.uid === p.uid);
      assert.ok(onBoard, `${this.label}: dragged piece ${p.id} onto the board`);
      assert.deepEqual([onBoard.row, onBoard.col], [tile.row, tile.col], `${this.label}: landed on the target tile`);
      moved += 1;
    }
    if (moved) this.note(`deployed ${moved}`);
    return moved;
  }

  /** Tap a normal board unit → its underframe → 出售 +N (research 09 §5: no drag-to-sell). */
  async sellByTap() {
    const unit = (await this.boardPieces()).filter((b) => b.kind === 'chess' && !b.golden && !b.items).sort((a, b) => a.row - b.row || b.col - a.col)[0];
    if (!unit) return false;
    const before = await this.st();
    let open = false;
    for (const at of [0.72, 0.5, 0.88]) {
      const pt = await this.page.evaluate((uid, at) => { const r = globalThis.__SP_VIEW__?.pieceScreenRect(uid); return r && { x: r.left + r.width / 2, y: r.top + r.height * at }; }, unit.uid, at);
      if (!pt) break;
      await this.page.mouse.click(pt.x, pt.y);
      if (await this.page.waitForSelector('.uframe__btn--sell', { timeout: 1500 }).then(() => true, () => false)) { open = true; break; }
    }
    if (!open) return false;
    await this.click('.uframe__btn--sell');
    const after = await this.waitFor((s) => s.board < before.board || s.phase !== 'PREP', 'sell', 6000);
    assert.ok(after.funds > before.funds, `${this.label}: selling paid funds`);
    this.note(`sold ${unit.id} with 出售 (funds ${before.funds} → ${after.funds})`);
    return true;
  }

  /** Two taps: 确认升级 then the upgrade. */
  async levelUp() {
    const s = await this.st();
    if (s.level >= 6 || s.funds < s.upgradePrice) return false;
    await this.click('.lvcard');
    await this.page.waitForSelector('.lvcard.is-armed', { timeout: 3000 });
    await this.click('.lvcard.is-armed');
    const after = await this.waitFor((x) => x.level > s.level || x.phase !== 'PREP', 'level up', 6000);
    this.note(`level ${s.level} → ${after.level}`);
    return after.level > s.level;
  }

  /** R shortcut → the shop is rerolled for the refresh price (or a free refresh from a 机变 card is used up). */
  async refresh() {
    const s = await this.st();
    if (s.funds < s.refreshPrice) return false;
    const shop = () => this.page.evaluate(() => { const sh = globalThis.__SP__.store.get().match.private.shop; return { ids: JSON.stringify(sh.slots.map((x) => x && x.id)), free: sh.freeRefreshes }; });
    const before = await shop();
    await this.page.mouse.click(this.w / 2, this.h * 0.3); // focus the page (not a HUD button)
    await this.page.keyboard.press('KeyR');
    const t0 = Date.now();
    let after = null; let now = null;
    while (Date.now() - t0 < 6000) {
      after = await this.st(); now = await shop();
      if (after.phase !== 'PREP' || after.funds !== s.funds || now.free !== before.free || now.ids !== before.ids) break;
      await sleep(150);
    }
    assert.ok(after.funds !== s.funds || now.free !== before.free || now.ids !== before.ids, `${this.label}: R refreshed the shop`);
    if (s.refreshPrice > 0) assert.equal(after.funds, s.funds - s.refreshPrice, `${this.label}: refresh cost`);
    this.note(`refresh (${s.refreshPrice ? `funds ${s.funds} → ${after.funds}` : `free ${before.free} → ${now.free}`}, slots ${before.ids === now.ids ? 'same ids' : 'rerolled'})`);
    return true;
  }

  /** 冻结 → 解冻 with the mouse. */
  async freezeToggle() {
    const s = await this.st();
    await this.click('.toolbtn--ice');
    await this.waitFor((x) => x.frozen !== s.frozen || x.phase !== 'PREP', 'freeze', 6000);
    assert.ok(await this.exists('.shopbar.is-frozen'), 'the frozen shop is tinted');
    await this.click('.toolbtn--ice', '解冻');
    await this.waitFor((x) => x.frozen === s.frozen || x.phase !== 'PREP', 'unfreeze', 6000);
    this.note('freeze toggled twice');
    return true;
  }

  /** Drag a hand item onto a board operator → equipped. */
  async equipItem() {
    const item = (await this.handPieces('item'))[0];
    const target = (await this.boardPieces()).find((b) => b.kind === 'chess' && b.items < 2);
    if (!item || !target) return false;
    const from = await this.piecePoint(item.uid);
    const to = await this.piecePoint(target.uid);
    if (!from || !to) return false;
    await this.drag(from, to);
    await sleep(400);
    // a full operator: the equip-replace dialog (ui/equipReplace.js) — replace the older item
    if (await this.exists('.eqr .eqr__opt')) {
      await this.click('.eqr__opt');
      await this.click('.eqr__ok');
      await sleep(400);
    }
    const after = (await this.boardPieces()).find((b) => b.uid === target.uid);
    const itemGone = !(await this.handPieces('item')).some((p) => p.uid === item.uid);
    this.note(`equip ${item.id} → ${target.id}: ${itemGone && after && after.items > target.items ? 'ok' : 'not applied'}`);
    return itemGone;
  }

  async ready() {
    if (!(await this.isEditable())) return;
    await this.click('.readybtn');
    await this.confirmFundsLeft();
    await this.waitFor((s) => s.ready || s.phase !== 'PREP', 'ready', 8000);
  }

  /** 准备 with funds left asks first (剩余资金, DESIGN §23.11): confirm it, as a player who means to start the fight does. */
  async confirmFundsLeft() {
    await sleep(250);
    const asked = await this.page.evaluate(() => {
      const t = document.querySelector('.modal__title');
      return !!(t && t.textContent.includes('剩余资金'));
    });
    if (asked) await this.click('.modal__actions button', '准备就绪', { timeout: 4000 });
  }
}

async function assertClean(clients) {
  for (const c of clients) {
    assert.deepEqual(c.problems, [], `${c.label}: console / page / network errors`);
  }
}

describe('real server + real browsers', { skip: !ENABLED && 'set SP_REAL_E2E=1 (needs Chrome and downloaded assets)' }, () => {
  let srv;
  let puppeteer;
  let base;

  before(async () => {
    const { startServer } = await import('../../server/index.js');
    puppeteer = (await import('puppeteer-core')).default;
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    // the content-hash index first, so the pages load the served manifests' /assets/~<hash>/… URLs like a player's
    await srv.assetIndex?.whenReady();
    base = `http://127.0.0.1:${srv.port}`;
    mkdirSync(OUT, { recursive: true });
  });

  after(async () => {
    await srv?.close();
  });

  test(`co-op: 2 humans + AI from the lobby through combat of round ${ROUNDS}`, { timeout: 30 * 60 * 1000 }, async () => {
    const host = new Client(puppeteer, base, 'host');
    const guest = new Client(puppeteer, base, 'guest', { w: 1280, h: 720 });
    const both = [host, guest];
    try {
      // ---- lobby & room --------------------------------------------------------------------------------------------
      await host.open();
      await host.enter('凯尔希');
      await host.click('.mode-card', '同盟模拟');
      await host.click('.diff-card', '险境模拟');
      await host.click('.create-box button', '创建同盟');
      const room = (await host.waitFor((s) => !!s.room?.code, 'room created')).room;
      await host.click('button', '添加 AI 队友');
      await guest.open(`?room=${room.code}`);
      await guest.enter('阿米娅');
      await guest.waitFor((s) => s.room?.code === room.code, 'guest joined via invite link');
      await guest.click('.room-bar__right button', '准备就绪');
      await host.shot('room');
      await host.click('.room-bar__right button', '开始模拟', { timeout: 20000 });

      // ---- briefing ---------------------------------------------------------------------------------------------------
      for (const c of both) await c.waitFor((s) => s.phase === 'INFO_CHECK', 'briefing', 30000);
      await sleep(800);
      await host.shot('briefing');
      await guest.shot('briefing-720');
      for (const c of both) await c.click('.brief__foot .btn--primary', '准备就绪');

      // ---- band draft -------------------------------------------------------------------------------------------------
      for (const c of both) await c.waitFor((s) => s.phase === 'BAND_DRAFT' || s.phase === 'BATTLE_CHECK' || s.phase === 'PREP', 'band draft', 40000);
      let guestSkipped = false;
      let shotDraft = false;
      const picked = new Set();
      const t0 = Date.now();
      while (Date.now() - t0 < 150000) {
        const [hs, gs] = [await host.st(), await guest.st()];
        if (hs.phase !== 'BAND_DRAFT' && gs.phase !== 'BAND_DRAFT') break;
        for (const [c, s] of [[host, hs], [guest, gs]]) {
          if (s.phase !== 'BAND_DRAFT' || picked.has(c.label) || s.draft?.turn !== s.me) continue;
          if (!shotDraft) { await sleep(600); await c.shot('draft'); shotDraft = true; }
          if (c === guest && !guestSkipped) {
            guestSkipped = true;
            // one skip — only while someone is left to pass to: the last player still to pick sees 跳过 disabled (PR #546)
            const canSkip = await c.page.evaluate(() => [...document.querySelectorAll('.draft-detail__btns .btn')]
              .some((b) => b.textContent.includes('跳过') && !b.disabled));
            if (canSkip) {
              await c.click('.draft-detail__btns .btn', '跳过');
              c.note('skipped once');
              continue;
            }
            c.note('跳过 disabled (the last player still to pick)');
          }
          await c.click('.dband:not(.is-taken)', null, { nth: c === host ? 3 : 7 });
          await c.click('.draft-detail__btns .btn--primary', '确认选择');
          picked.add(c.label);
          c.note('band picked');
        }
        await sleep(300);
      }
      assert.ok(picked.size === 2, `both humans picked a band (${[...picked]})`);

      // ---- rounds -----------------------------------------------------------------------------------------------------
      const seen = new Set();
      const did = { watched: false, sold: false, leveled: false, refreshed: false, froze: false, item: false, equipped: false, inspected: false, bond: false, enemies: -1, emote: false };
      let spPicked = 0;
      let lastCombatRound = 0;
      const deadline = Date.now() + 25 * 60 * 1000;
      while (Date.now() < deadline) {
        const hs = await host.st();
        if (hs.result || hs.phase === 'RESULT') break;
        seen.add(hs.phase);
        if (hs.phase === 'PREP') {
          for (const c of both) {
            if (!(await c.isEditable())) continue;
            const s = await c.st();
            if (!seen.has(`prep-shot-${c.label}-${s.round}`)) {
              seen.add(`prep-shot-${c.label}-${s.round}`);
              await sleep(1700); // past the 休整期 banner
              await c.shot(`prep-r${s.round}-${c.label}`);
            }
            await c.takeReward();
            if (c === host && did.enemies < 0) did.enemies = await c.openEnemies();
            if (c === guest && !did.emote) {
              await c.emote();
              await host.page.waitForSelector('.team__bubble', { timeout: 5000 });
              await host.shot('emote-bubble');
              did.emote = true;
              c.note('emote seen by the host');
            }
            if (c === guest && s.round >= 2 && !did.leveled) did.leveled = await c.levelUp();
            if (c === host && s.round >= 2 && !did.item) did.item = await c.buyItem();
            if (c === host && s.round >= 3 && !did.refreshed) did.refreshed = await c.refresh();
            for (let k = 0; k < 3; k++) if (!(await c.buyOne())) break;
            await c.deployFromHand(4);
            if (c === host && s.round >= 2 && !did.sold) did.sold = await c.sellByTap();
            if (!did.equipped) did.equipped = await c.equipItem();
            if (c === host && s.round >= 2 && !did.inspected) did.inspected = await c.inspectUnit();
            if (c === host && s.round >= 2 && !did.bond) did.bond = await c.openBond();
            if (c === guest && !did.froze) did.froze = await c.freezeToggle();
            await c.deployFromHand(2);
            const s2 = await c.st();
            if (s2.temp > 0) c.note(`temp not empty (${s2.temp}) — ready blocked`);
            if (c === guest) { await c.page.keyboard.press('Space'); await c.confirmFundsLeft(); await c.waitFor((x) => x.ready || x.phase !== 'PREP', 'ready (Space)', 8000); } else await c.ready();
          }
        } else if (hs.phase === 'SP_DRAFT') {
          for (const c of both) {
            const s = await c.st();
            if (s.phase === 'SP_DRAFT' && s.sp?.turn === s.me && (await c.exists('.spcard.is-pickable'))) {
              if (!seen.has(`sp-shot-${s.round}`)) { seen.add(`sp-shot-${s.round}`); await sleep(500); await c.shot(`sp-r${s.round}-${c.label}`); }
              // two taps (user playtest #4 item 2): select, then tap the selected card again
              await c.click('.spcard.is-pickable');
              await c.click('.spcard.is-armed');
              await c.waitFor((x) => x.sp?.turn !== x.me || x.phase !== 'SP_DRAFT', 'sp pick', 8000);
              spPicked += 1;
              c.note(`机变 picked (round ${s.round})`);
            }
          }
        } else if (['COMBAT', 'UNITE', 'FINAL_ASSAULT', 'HIDDEN_CORE'].includes(hs.phase) && lastCombatRound !== hs.round * 10 + (hs.phase === 'UNITE' ? 1 : 0)) {
          lastCombatRound = hs.round * 10 + (hs.phase === 'UNITE' ? 1 : 0);
          assert.equal(await host.viewKind(), 'engine', 'the Pixi render engine is mounted (not the DOM fallback)');
          // units rendered by the engine, Spine models loaded
          const t1 = Date.now();
          let st = null;
          while (Date.now() - t1 < 15000) {
            st = await host.viewStats();
            if (st && st.mode === 'battle' && st.units > 0 && (st.spine?.ready ?? 0) > 0) break;
            await sleep(300);
          }
          assert.ok(st && st.mode === 'battle' && st.units > 0, `round ${hs.round} ${hs.phase}: battle units on screen (${JSON.stringify(st && { mode: st.mode, units: st.units })})`);
          assert.ok((st.spine?.ready ?? 0) > 0, `round ${hs.round}: Spine models loaded (${JSON.stringify(st.spine)})`);
          assert.equal(st.spine?.failed ?? 0, 0, 'no Spine load failures');
          await sleep(1500);
          await host.shot(`combat-r${hs.round}${hs.phase === 'UNITE' ? '-unite' : ''}`);
          await guest.shot(`combat-r${hs.round}${hs.phase === 'UNITE' ? '-unite' : ''}-720`);
          host.note(`round ${hs.round} ${hs.phase}: ${st.units} views, fps ${st.fps}, spine ${JSON.stringify(st.spine)}`);
          // research 09 §3.1: no view switcher in normal combat; after the own battle ends, a teammate row → 前往查看
          if (hs.phase === 'COMBAT') assert.equal(await host.exists('.chud .vswitch__arrow'), false, 'no ‹ › switcher during normal combat');
          const tObs = Date.now();
          while (!did.watched && hs.phase === 'COMBAT' && Date.now() - tObs < 90000) {
            const cs = await host.st();
            if (cs.phase !== 'COMBAT' || cs.round !== hs.round) break;
            for (const c of both) {
              if (did.watched) break;
              const rs = await c.page.evaluate(() => globalThis.__SP_RUNNER__?.state() ?? null);
              if (!rs || !rs.own || !rs.done) continue;
              const other = await c.page.evaluate(() => {
                const s = globalThis.__SP__.store.get();
                const pub = s.match.public;
                const f = (pub?.fields || []).find((x) => x.kind === 'normal' && x.live && !x.players.includes(s.me.playerId));
                if (!f) return null;
                const rows = (pub.players || []).slice().sort((a, b) => a.seat - b.seat).filter((p) => p.playerId !== s.me.playerId);
                return { fieldId: f.fieldId, nth: rows.findIndex((p) => p.playerId === f.players[0]) };
              });
              if (!other || other.nth < 0) continue;
              await c.click('.team__row:not(.is-self) .team__btn', null, { nth: other.nth });
              if (!(await c.click('.team__ob', '前往查看', { optional: true, timeout: 3000 }))) continue;
              const ok = await c.page.waitForFunction((fid) => { const s = globalThis.__SP_RUNNER__?.state(); return !!s && s.fieldId === fid && s.watch; }, { timeout: 15000 }, other.fieldId).then(() => true, () => false);
              if (!ok) continue;
              await sleep(1200);
              const other2 = await c.viewStats();
              assert.ok(other2 && other2.units > 0, 'the observed field renders units');
              await c.shot(`combat-observe-r${hs.round}`);
              await c.click('.team__back, .chud__back', '返回战场', { optional: true, timeout: 3000 });
              did.watched = true;
              c.note(`前往查看 ${other.fieldId} (${other2.units} views) and 返回战场`);
            }
            await sleep(400);
          }
          if (hs.round >= ROUNDS && hs.phase !== 'UNITE') break;
        }
        await sleep(400);
      }
      const end = await host.st();
      assert.ok(end.round >= ROUNDS || end.result, `reached round ${ROUNDS} (at ${end.round} ${end.phase})`);
      assert.ok(seen.has('PREP') && seen.has('COMBAT'), 'saw prep and combat');
      host.note(`did: ${JSON.stringify(did)}, 机变 picks: ${spPicked}, phases: ${[...seen].filter((x) => !x.includes('-')).join(',')}`);
      assert.ok(did.watched, 'observed a teammate through 前往查看');
      assert.ok(did.sold, 'sold a unit with the underframe 出售');
      assert.ok(did.refreshed, 'refreshed the shop (R)');
      assert.ok(did.froze, 'froze + unfroze the shop');
      assert.ok(did.leveled, 'levelled the dispatch center up');
      assert.ok(did.inspected && did.bond, 'detail panel + bond popup');
      assert.ok(did.emote, 'emote bubble reached the teammate');
      assert.ok(did.enemies >= 0, 'enemy drawer opened');
      if (srv.assetIndex) {
        host.note(`content-hashed responses: ${JSON.stringify(host.hashed)}`);
        assert.ok(host.hashed.spine > 0 && host.hashed.media > 0 && host.hashed.other > 0, `Spine, audio and art through hashed URLs: ${JSON.stringify(host.hashed)}`);
      }
      await assertClean(both);
    } finally {
      console.log([...host.log, ...guest.log].join('\n'));
      for (const c of both) if (c.problems.length) console.log(`${c.label} problems:\n  ${c.problems.slice(0, 20).join('\n  ')}`);
      for (const c of both) await c.close();
    }
  });

  test('solo: 独立模拟 through two rounds, then 放弃模拟 back to the lobby', { timeout: 10 * 60 * 1000 }, async () => {
    const solo = new Client(puppeteer, base, 'solo');
    try {
      await solo.open();
      await solo.enter('杜宾');
      await solo.click('.mode-card', '独立模拟');
      await solo.click('.diff-card', '标准模拟');
      await solo.click('.create-box button', '开始独立模拟');
      await solo.waitFor((s) => !!s.room, 'solo room');
      if (!(await solo.st()).phase) await solo.click('.room-bar__right button', '开始模拟', { timeout: 20000 });
      await solo.waitFor((s) => s.phase === 'INFO_CHECK', 'briefing', 30000);
      await solo.click('.brief__foot .btn--primary', '准备就绪');
      await solo.waitFor((s) => s.phase === 'BAND_DRAFT', 'band draft', 30000);
      await sleep(600);
      await solo.shot('solo-draft');
      await solo.click('.dband', null, { nth: 1 });
      await solo.click('.draft-detail__btns .btn--primary', '确认选择');
      for (let round = 1; round <= 2; round++) {
        await solo.waitFor((s) => s.phase === 'PREP' && s.round === round && !s.ready, `prep ${round}`, 60000);
        await sleep(700);
        await solo.takeReward();
        for (let k = 0; k < 3; k++) if (!(await solo.buyOne())) break;
        await solo.deployFromHand(4);
        await solo.shot(`solo-prep-r${round}`);
        await solo.ready();
        await solo.waitFor((s) => s.phase === 'COMBAT', `combat ${round}`, 30000);
        const t1 = Date.now();
        let st = null;
        while (Date.now() - t1 < 15000) { st = await solo.viewStats(); if (st?.mode === 'battle' && st.units > 0) break; await sleep(300); }
        assert.ok(st?.units > 0, 'solo battle renders units');
        await sleep(1500);
        await solo.shot(`solo-combat-r${round}`);
      }
      // leave for good: exit → 放弃模拟 → lobby
      await solo.click('.gtop__exit');
      await solo.click('.modal__actions .btn', '放弃模拟');
      await solo.waitFor((s) => !s.room && !s.phase, 'back in the lobby', 20000);
      await solo.page.waitForSelector('.lobby-screen', { timeout: 10000 });
      await assertClean([solo]);
    } finally {
      console.log(solo.log.join('\n'));
      if (solo.problems.length) console.log(`solo problems:\n  ${solo.problems.slice(0, 20).join('\n  ')}`);
      await solo.close();
    }
  });
});
