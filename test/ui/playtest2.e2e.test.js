// Browser regressions of user playtest #2 (UI items 6–9 + the loadout display of item 1), through the mock harness
// (public/dev/game-mock.html) in headless Chrome (puppeteer-core + system Chrome). Opt-in: SP_E2E=1.
//
//   SP_E2E=1 node --test test/ui/playtest2.e2e.test.js
//   SP_E2E=1 SP_P2_ONLY=pen|sell|reach|bonds|loadout node --test test/ui/playtest2.e2e.test.js
//
//  6  (superseded by the maintainer's decision of 2026-10-15) the enemy preview pen shows with the prep board — its
//     figures at the top right, its rows drawn (2D), its block built (3D) — in the pen view and back on the board after
//     🔍◀◀ "返回战场"; never in a battle camera (normal / 联防 / 最终攻势 / 隐秘核心) nor with the Final Assault prep
//  7  the underframe's 出售 / 销毁 buttons are coloured plates (amber / red), not a white block — 3D engine and DOM fallback
//  8  at 16:9, 16:10, 21:9 (2560×1080 and 3440×1440), 4:3, 1280×720, 1366×768 and iPad landscape every bench / temp /
//     board unit's underframe buttons are the topmost element under their centre (clickable) and the detail card
//     never overlaps them; a real click on 出售 sells
//  9  the detail card shows the unit's bonds (icon, name, count / threshold, tier pips) in the header's right column
//     (under name / tier, beside the portrait), visible without scrolling; the bond popup lists its facts and the
//     current effect before the long description and keeps clear of the selected unit's underframe
//  §16 the loadout's skill / module: shop card skill badge (mint when not the default; S1–S3 when the manifest has no
//     icon for the chosen skill), detail card skill + 已调配, an elite with its module unequipped shows 未装备模组
// Screenshots: test/e2e/out/fix-*.png.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'test/e2e/out');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);
const ONLY = process.env.SP_P2_ONLY || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const skipUnless = (k) => (ONLY && ONLY !== k ? `SP_P2_ONLY=${ONLY}` : false);

/** Viewports of item 8 (name, w, h). */
const SIZES = [
  ['16x9', 1920, 1080], ['16x10', 1680, 1050], ['21x9', 2560, 1080], ['uw', 3440, 1440], ['4x3', 1600, 1200],
  ['720p', 1280, 720], ['1366', 1366, 768], ['ipad', 1180, 820],
];

describe('user playtest #2 — UI fixes (mock harness, headless Chrome)', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome) to run' }, () => {
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

  after(async () => {
    await browser?.close();
    await srv?.close();
  });

  async function open(query, { w = 1920, h = 1080, render = 'engine' } = {}) {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h });
    const problems = [];
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('requestfailed', (r) => problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
    page.on('response', (r) => { if (r.status() >= 400) problems.push(`http ${r.status()}: ${r.url()}`); });
    await page.goto(`${base}/dev/game-mock.html?shot=1&render=${render}&${query}`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => !!document.querySelector('.screen:not(.gload)') && !!globalThis.__SP_VIEW__, { timeout: 20000 });
    await sleep(render === 'engine' ? 1600 : 700);
    return { page, problems };
  }

  /** Mean RGB of a client rect of the page (screenshot decoded by the page itself). */
  async function meanColor(page, r) {
    const clip = { x: Math.max(0, r.x), y: Math.max(0, r.y), width: Math.max(1, r.w), height: Math.max(1, r.h) };
    const b64 = await page.screenshot({ clip, encoding: 'base64' });
    return page.evaluate(async (src) => {
      const img = new Image();
      img.src = `data:image/png;base64,${src}`;
      await img.decode();
      const cv = document.createElement('canvas');
      cv.width = img.width; cv.height = img.height;
      const g = cv.getContext('2d');
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, cv.width, cv.height).data;
      let R = 0, G = 0, B = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) { R += d[i]; G += d[i + 1]; B += d[i + 2]; n++; }
      return { r: R / n, g: G / n, b: B / n };
    }, b64);
  }

  /** Client rect of a prep piece (plain object: the DOM fallback returns a DOMRect). */
  const pieceRect = (page, uid) => page.evaluate((uid) => {
    const r = globalThis.__SP_VIEW__.pieceScreenRect(uid);
    return r ? { left: r.left, top: r.top, width: r.width, height: r.height } : null;
  }, uid);

  /**
   * Tap an own prep piece (real mouse) until ITS underframe shows (a unit standing in front can take a low tap: the
   * next try is higher up the sprite). Pieces without an underframe (bench summons) just get one tap.
   */
  async function tapPiece(page, uid, { underframe = true } = {}) {
    for (const at of [0.72, 0.4, 0.18, 0.88]) {
      const r = await pieceRect(page, uid);
      assert.ok(r && r.width > 0, `piece ${uid} on screen`);
      await page.mouse.click(r.left + r.width / 2, r.top + r.height * at);
      await sleep(350);
      if (!underframe) return true;
      if (await page.$(`.uframe[data-uid="${uid}"]`)) return true;
      await page.keyboard.press('Escape');
      await page.mouse.click(5, Math.round((await page.evaluate(() => innerHeight)) / 2)); // deselect (field press)
      await sleep(150);
    }
    return false;
  }

  /** Every underframe button: centre, topmost-ness, overlap with the detail card. */
  const underframeState = (page) => page.evaluate(() => {
    const panel = document.querySelector('.dpanel');
    const pr = panel ? panel.getBoundingClientRect() : null;
    const out = [];
    for (const b of document.querySelectorAll('.uframe__btn')) {
      const r = b.getBoundingClientRect();
      const x = r.left + r.width / 2; const y = r.top + r.height * 0.35;
      const top = document.elementFromPoint(x, y);
      const overlap = !!pr && r.left < pr.right && r.right > pr.left && r.top < pr.bottom && r.bottom > pr.top;
      out.push({ cls: b.className, x, y, topmost: !!top && b.contains(top), inView: x > 0 && y > 0 && x < innerWidth && y < innerHeight, overlap });
    }
    return { buttons: out, side: panel?.dataset.side ?? null };
  });

  // ---- 7 -------------------------------------------------------------------------------------------------------------

  for (const render of ['engine', 'fallback']) {
    test(`7: 出售 / 销毁 are amber / red plates, not a white block (${render})`, { skip: skipUnless('sell') }, async () => {
      const { page, problems } = await open('phase=PREP', { render });
      const uids = await page.evaluate(() => {
        const p = globalThis.__MOCK__.S().priv;
        return { chess: p.hand.find((x) => x && x.kind === 'chess')?.uid, item: p.hand.find((x) => x && x.kind === 'item')?.uid };
      });
      await tapPiece(page, uids.chess);
      await page.waitForSelector('.uframe__btn--sell .uframe__plate', { timeout: 3000 });
      const plate = await page.$eval('.uframe__btn--sell .uframe__plate', (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width * 0.2, y: r.top + r.height * 0.2, w: r.width * 0.6, h: r.height * 0.6 }; });
      const c = await meanColor(page, plate);
      assert.ok(!(c.r > 225 && c.g > 225 && c.b > 225), `sell plate is not white (${JSON.stringify(c)})`);
      assert.ok(c.r > c.b + 50 && c.g > c.b + 10, `sell plate reads amber (${JSON.stringify(c)})`);
      await page.screenshot({ path: path.join(OUT, `fix-sell-${render}.png`) });
      await page.keyboard.press('Escape');
      await tapPiece(page, uids.item);
      await page.waitForSelector('.uframe__btn--destroy .uframe__plate', { timeout: 3000 });
      const dp = await page.$eval('.uframe__btn--destroy .uframe__plate', (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width * 0.2, y: r.top + r.height * 0.2, w: r.width * 0.6, h: r.height * 0.6 }; });
      const d = await meanColor(page, dp);
      assert.ok(!(d.r > 225 && d.g > 225 && d.b > 225), `destroy plate is not white (${JSON.stringify(d)})`);
      assert.ok(d.r > d.g + 60 && d.r > d.b + 60, `destroy plate reads red (${JSON.stringify(d)})`);
      await page.screenshot({ path: path.join(OUT, `fix-destroy-${render}.png`) });
      assert.deepEqual(problems, []);
      await page.close();
    });
  }

  // ---- 8 -------------------------------------------------------------------------------------------------------------

  for (const render of ['engine', 'fallback']) {
    test(`8: every bench / temp / board underframe stays clickable at 8 viewports (${render})`, { skip: skipUnless('reach'), timeout: 12 * 60 * 1000 }, async () => {
      for (const [name, w, h] of SIZES) {
        const { page, problems } = await open('phase=PREP', { w, h, render });
        // a full bench and a full temp row (chess + one item each)
        await page.evaluate(() => globalThis.__MOCK__.mutate((S) => {
          const pool = S.pool;
          let k = 0;
          let uid = 9000;
          const chess = () => { const c = pool[(k += 3) % pool.length]; return { uid: ++uid, kind: 'chess', id: c.chessId, golden: false, tier: c.tier, items: [] }; };
          for (let i = 0; i < S.priv.hand.length; i++) if (!S.priv.hand[i] || S.priv.hand[i].kind === 'token') S.priv.hand[i] = chess();
          for (let i = 0; i < S.priv.temp.length; i++) S.priv.temp[i] = chess();
          S.priv.temp[4] = { uid: ++uid, kind: 'item', id: S.priv.hand.find((x) => x && x.kind === 'item')?.id, golden: false, tier: 1 };
        }));
        await sleep(600);
        const pieces = await page.evaluate(() => {
          const p = globalThis.__MOCK__.S().priv;
          return [
            ...p.hand.map((x, i) => x && { uid: x.uid, where: `hand${i}` }),
            ...p.temp.map((x, i) => x && { uid: x.uid, where: `temp${i}` }),
            ...p.board.map((x) => ({ uid: x.uid, where: `board${x.row},${x.col}` })),
          ].filter(Boolean);
        });
        let checked = 0;
        let rightDocked = 0;
        const board = await page.evaluate(() => globalThis.__MOCK__.S().priv.board.map((p) => ({ uid: p.uid, row: p.row, col: p.col })));
        for (const pc of pieces) {
          const tapped = await tapPiece(page, pc.uid);
          // a board unit standing right behind others in its column can be hidden by their sprites (as in the game)
          const b = board.find((x) => x.uid === pc.uid);
          if (!tapped && b && board.some((o) => o.col === b.col && o.row < b.row && b.row - o.row <= 2)) continue;
          assert.ok(tapped, `${name}/${render}: ${pc.where} shows its underframe`);
          const st2 = await underframeState(page);
          assert.ok(st2.buttons.length, `${name}/${render}: ${pc.where} underframe buttons`);
          for (const b of st2.buttons) {
            assert.ok(b.inView, `${name}/${render}: ${pc.where} ${b.cls} inside the viewport`);
            assert.ok(b.topmost, `${name}/${render}: ${pc.where} ${b.cls} is the topmost element (clickable)`);
            assert.ok(!b.overlap, `${name}/${render}: ${pc.where} ${b.cls} not under the detail card (${st2.side})`);
          }
          if (st2.side === 'right') rightDocked++;
          checked++;
          if (pc.where === 'hand0' || pc.where === 'hand1') await page.screenshot({ path: path.join(OUT, `fix-reach-${name}-${render}-${pc.where}.png`) });
          await page.keyboard.press('Escape'); // closes the card (the next tap selects the next unit)
          await sleep(120);
        }
        assert.ok(checked >= pieces.length - 2, `${name}/${render}: checked ${checked}/${pieces.length}`);
        // the leftmost bench unit's card docks right whenever the left card would cover its underframe
        // a real click on 出售 of the leftmost bench unit sells it
        const first = pieces[0];
        await tapPiece(page, first.uid);
        const funds0 = await page.evaluate(() => globalThis.__MOCK__.S().priv.funds);
        const sell = await page.$eval('.uframe__btn--sell', (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height * 0.35 }; });
        await page.mouse.click(sell.x, sell.y);
        await sleep(400);
        const after = await page.evaluate((uid) => ({ funds: globalThis.__MOCK__.S().priv.funds, gone: !globalThis.__MOCK__.S().priv.hand.some((x) => x && x.uid === uid) }), first.uid);
        assert.ok(after.gone && after.funds > funds0, `${name}/${render}: 出售 of ${first.where} sold it (${JSON.stringify(after)})`);
        assert.deepEqual(problems, [], `${name}/${render}`);
        await page.close();
        void rightDocked;
      }
    });
  }

  // review: the top board row under the bond strip, and a notched phone's safe-area insets
  test('8: a top-row unit under the bond strip is tappable; on a notched phone the underframe stays on its unit', { skip: skipUnless('reach'), timeout: 5 * 60 * 1000 }, async () => {
    for (const [name, w, h] of [['16x9', 1920, 1080], ['21x9', 2560, 1080], ['720p', 1280, 720], ['phone', 844, 390]]) {
      const { page, problems } = await open('phase=PREP', { w, h });
      // the mock's row-12 unit (col 4, behind the row-11 one): its body reaches under the bond strip at these sizes; a
      // press on its tile selects it (picking is by tile, user playtest #4 item 1), so the tile must be free of the strip
      const top = await page.evaluate(() => {
        const b = globalThis.__MOCK__.S().priv.board.filter((p) => p.row === 12).sort((a, c) => a.col - c.col)[0];
        const r = globalThis.__SP_VIEW__.pieceScreenRect(b.uid);
        const t = globalThis.__SP_VIEW__.raw.tileScreen(b.row, b.col);
        const strip = document.querySelector('.gm__bonds').getBoundingClientRect();
        const pts = [-0.3, 0, 0.3].map((dx) => ({ x: t.x + dx * t.s, y: t.y }));
        const hits = pts.map((p) => { const el = document.elementFromPoint(p.x, p.y); return el.tagName === 'CANVAS' ? 'canvas' : el.closest('.bslot') ? 'disc' : `${el.tagName}.${el.className}`; });
        return { uid: b.uid, pts, hits, bodyUnderStrip: r.top < strip.bottom };
      });
      assert.ok(top.bodyUnderStrip, `${name}: the row-12 unit's body reaches under the bond strip (test premise)`);
      for (const hit of top.hits) assert.equal(hit, 'canvas', `${name}: the row-12 unit's tile is free of the bond strip`);
      await page.mouse.click(top.pts[1].x, top.pts[1].y);
      await sleep(350);
      assert.ok(await page.$(`.uframe[data-uid="${top.uid}"]`), `${name}: a tap on the row-12 unit's tile selects it`);
      await page.keyboard.press('Escape');
      await page.mouse.click(5, Math.round(h / 2));
      await sleep(150);
      // notched phone in landscape: the HUD layer sits inside the safe-area insets (css/devices.css)
      await page.evaluate(() => { const s = document.documentElement.style; s.setProperty('--sa-l', '47px'); s.setProperty('--sa-r', '47px'); s.setProperty('--sa-t', '12px'); s.setProperty('--sa-b', '21px'); });
      await sleep(300);
      const hand = await page.evaluate(() => globalThis.__MOCK__.S().priv.hand.map((x, i) => x && x.kind === 'chess' && { uid: x.uid, i }).filter(Boolean).slice(0, 2));
      for (const pc of hand) {
        assert.ok(await tapPiece(page, pc.uid), `${name} (safe area): hand${pc.i} selected`);
        const st = await page.evaluate((pc) => {
          const uf = document.querySelector(`.uframe[data-uid="${pc.uid}"]`).getBoundingClientRect();
          const t = globalThis.__SP_VIEW__.raw.tileScreen(7, pc.i);
          return { dx: uf.left + uf.width / 2 - t.x, dy: uf.top + uf.height / 2 - t.y };
        }, pc);
        assert.ok(Math.abs(st.dx) < 2 && Math.abs(st.dy) < 2, `${name} (safe area): hand${pc.i} underframe centred on its tile (${JSON.stringify(st)})`);
        const s2 = await underframeState(page);
        for (const b of s2.buttons) {
          assert.ok(b.topmost && b.inView, `${name} (safe area): hand${pc.i} ${b.cls} clickable`);
          assert.ok(!b.overlap, `${name} (safe area): hand${pc.i} ${b.cls} not under the detail card (${s2.side})`);
        }
        await page.keyboard.press('Escape');
        await page.mouse.click(5, Math.round(h / 2)); // deselect (a field press)
        await sleep(150);
      }
      if (name === '16x9') await page.screenshot({ path: path.join(OUT, 'fix-reach-safearea.png') });
      assert.deepEqual(problems, [], name);
      await page.close();
    }
  });

  // ---- 9 -------------------------------------------------------------------------------------------------------------

  test('9: the detail card shows the unit\'s bonds under the header, visible without scrolling; the bond popup leads with its facts', { skip: skipUnless('bonds') }, async () => {
    for (const [w, h] of [[1920, 1080], [1280, 720]]) {
      const { page, problems } = await open('phase=PREP', { w, h });
      // a front-row unit (row 9: nothing stands in front of it)
      const uid = await page.evaluate(() => globalThis.__MOCK__.S().priv.board.find((p) => p.row === 9).uid);
      assert.ok(await tapPiece(page, uid), 'unit selected');
      await page.waitForSelector('.dpanel .dbonds--top', { timeout: 3000 });
      const r = await page.evaluate(() => {
        const panel = document.querySelector('.dpanel__scroll');
        const pr = panel.getBoundingClientRect();
        const art = document.querySelector('.dpanel .dhead__art').getBoundingClientRect();
        const name = document.querySelector('.dpanel .dhead__name').getBoundingClientRect();
        const chips = [...document.querySelectorAll('.dpanel .dbonds--top .dbond')];
        const kids = [...panel.children].map((el) => el.className);
        return {
          first: kids[0], inInfo: !!document.querySelector('.dpanel .dhead__info > .dbonds--top'),
          art: { right: art.right, top: art.top, bottom: art.bottom }, nameBottom: name.bottom,
          chips: chips.map((el) => { const r = el.getBoundingClientRect(); return { text: el.textContent.trim(), left: r.left, bottom: r.bottom, top: r.top, icon: !!el.querySelector('.bglyph'), count: el.querySelector('.dbond__count')?.textContent.trim() || '' }; }),
          visibleBottom: pr.bottom, scrollTop: panel.scrollTop,
          bonds: (globalThis.__SP__?.store || globalThis.__MOCK__.store).get().match.private.bonds.length,
        };
      });
      assert.equal(r.first, 'dhead');
      assert.ok(r.inInfo, 'bonds in the header\'s right column (under name / tier)');
      assert.ok(r.chips.length >= 1, 'bond chips');
      for (const c of r.chips) {
        assert.ok(c.icon, `chip ${c.text} has its icon`);
        assert.match(c.count, /^\d+(\/\d+)?$/, `chip ${c.text} shows count/threshold`);
        assert.ok(c.bottom <= r.visibleBottom && r.scrollTop === 0, `chip ${c.text} visible without scrolling`);
        assert.ok(c.left >= r.art.right - 1, `chip ${c.text} right of the portrait (top right)`);
        assert.ok(c.top >= r.nameBottom - 1 && c.top < r.art.bottom, `chip ${c.text} under the name, beside the portrait`);
      }
      await page.screenshot({ path: path.join(OUT, `fix-bonds-${w}.png`) });
      // the chip opens the bond popup; facts + current effect come before the long description
      const side = await page.$eval('.dpanel', el => el.dataset.side);
      const chip = await (await page.$('.dpanel .dbonds--top .dbond')).boundingBox();
      await page.mouse.move(chip.x + chip.width / 2, chip.y + chip.height / 2);
      await page.mouse.down(); await sleep(100);
      assert.equal(await page.$eval('.dpanel', el => el.dataset.side), side, '#792: pointerdown must not move the card before click');
      assert.ok(await page.$(`.uframe[data-uid="${uid}"]`), 'using the card keeps its piece selected');
      await page.mouse.up();
      await page.waitForSelector('.bpop', { timeout: 3000 });
      const pop = await page.evaluate(() => {
        const secs = [...document.querySelectorAll('.bpop .bpop__sec')].map((s) => s.querySelector('h4')?.textContent || '');
        const facts = document.querySelector('.bpop__facts').getBoundingClientRect();
        const box = document.querySelector('.bpop').getBoundingClientRect();
        const btn = [...document.querySelectorAll('.uframe__btn')].map((b) => { const r = b.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height * 0.35); return !!t && b.contains(t); });
        const hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        const card = document.querySelector('.dpanel').getBoundingClientRect();
        const pop = document.querySelector('.bpop');
        return {
          secs, factsIn: facts.bottom <= box.bottom, btnTop: btn, place: pop.dataset.place, over: pop.classList.contains('is-over'),
          coversButtons: [...document.querySelectorAll('.uframe__btn')].some((b) => hit(b.getBoundingClientRect(), box)),
          coversCard: hit(card, box),
        };
      });
      // the playtest's case (a unit left of the board, card docked right) — the popup keeps clear of the underframe
      assert.equal(pop.coversButtons, false, `the bond popup (${pop.place}) keeps clear of the underframe buttons`);
      assert.ok(!pop.coversCard || pop.over, `the popup covers the card only when placed over it (${pop.place})`);
      const iNow = pop.secs.findIndex((t) => t.includes('当前效果'));
      const iDesc = pop.secs.findIndex((t) => t.includes('盟约效果'));
      if (iNow >= 0) assert.ok(iNow < iDesc, `current effect before the description (${pop.secs})`);
      assert.ok(pop.factsIn);
      assert.ok(pop.btnTop.every(Boolean), 'the underframe stays above the bond popup');
      await sleep(450); // the pop-in animation
      await page.screenshot({ path: path.join(OUT, `fix-bondpop-${w}.png`) });
      await page.click('.bpop__facts');
      assert.ok(await page.$('.bpop'), 'reading inside the popup keeps it open');
      assert.ok(await page.$(`.uframe[data-uid="${uid}"]`), 'reading the popup keeps its piece selected');
      await page.click('.gm__gear'); await page.waitForSelector('.modal');
      assert.equal(await page.$('.bpop'), null, '#792: another HUD control still dismisses the popup');
      assert.equal(await page.$('.dpanel'), null, 'another HUD control dismisses the card');
      assert.equal(await page.$('.uframe'), null, 'another HUD control clears the selection');
      await page.keyboard.press('Escape');
      assert.deepEqual(problems, []);
      await page.close();
    }
  });

  // ---- §16 loadout ---------------------------------------------------------------------------------------------------

  test('loadout (DESIGN §16): shop card skill badge, detail card skill + 已调配, elite module 未装备模组', { skip: skipUnless('loadout') }, async () => {
    const { page, problems } = await open('phase=PREP&variant=loadout');
    const lo = await page.evaluate(() => globalThis.__MOCK__.S().priv.loadout);
    assert.ok(lo && Object.keys(lo).length >= 1, 'the mock sends m.private.loadout');
    const badges = await page.$$eval('.scard__skill', (els) => els.map((el) => ({ custom: el.classList.contains('is-custom'), title: el.getAttribute('title') || '' })));
    assert.ok(badges.length >= 3, 'every operator card shows its skill');
    assert.ok(badges.some((b) => b.custom && b.title.includes('已调配')), `a card with a non-default skill (${JSON.stringify(badges)})`);
    assert.ok(badges.some((b) => !b.custom), 'default skills stay plain');
    // a chosen skill is never a blank square: its icon, or its slot letter when the manifest has no icon for it
    const marks = await page.$$eval('.scard__skill.is-custom', (els) => els.map((el) => ({ img: el.querySelector('img')?.getAttribute('src') || null, glyph: el.querySelector('.scard__sglyph')?.textContent || null })));
    for (const g of marks) assert.ok((g.img && !/empty/i.test(g.img)) || /^S[1-3]$/.test(g.glyph || ''), `custom skill badge shows an icon or S1–S3 (${JSON.stringify(g)})`);
    await page.screenshot({ path: path.join(OUT, 'fix-loadout-shop.png') });
    const b0 = await page.evaluate(() => globalThis.__MOCK__.S().priv.board[0].uid);
    await tapPiece(page, b0);
    await page.waitForSelector('.dpanel .dskill', { timeout: 3000 });
    const d = await page.evaluate(() => ({ name: document.querySelector('.dpanel .dskill__name')?.textContent || '', tag: !!document.querySelector('.dpanel .dskill__name .dtag-loadout') }));
    assert.ok(d.tag, `detail card marks the loadout skill (${d.name})`);
    const icon = await page.evaluate(() => { const el = document.querySelector('.dpanel .dskill > .dskill__icon'); return { img: el?.tagName === 'IMG' ? el.getAttribute('src') : null, glyph: el?.querySelector('b')?.textContent || null }; });
    assert.ok((icon.img && !/empty/i.test(icon.img)) || /^S[1-3]$/.test(icon.glyph || ''), `detail skill icon or S1–S3 (${JSON.stringify(icon)})`);
    await page.evaluate(() => { const el = document.querySelector('.dpanel .dsec--skill'); el?.scrollIntoView({ block: 'center' }); });
    await sleep(200);
    await page.screenshot({ path: path.join(OUT, 'fix-loadout-detail.png') });
    await page.keyboard.press('Escape');
    const g = await page.evaluate(() => globalThis.__MOCK__.S().priv.board.find((p) => p.golden)?.uid);
    if (g) {
      assert.ok(await tapPiece(page, g), 'the elite is selected');
      await page.waitForSelector('.dpanel .dsec--module', { timeout: 3000 });
      const mod = await page.$eval('.dpanel .dmodule', (el) => ({ none: el.classList.contains('is-none'), text: el.textContent }));
      assert.ok(mod.none && mod.text.includes('未装备模组'), `elite module unequipped (${mod.text})`);
    }
    assert.deepEqual(problems, []);
    await page.close();
  });

  // ---- 6 -------------------------------------------------------------------------------------------------------------

  /** Pen / board-area state of the engine view. */
  const penState = (page) => page.evaluate(() => {
    const raw = globalThis.__SP_VIEW__.raw;
    const d = raw.debug;
    const pens = [...d.penViews.values()];
    const area = d.board3d ? d.board3d.area : null;
    return {
      camera: document.querySelector('.gm')?.dataset.camera, kind: d.camKind,
      pen: pens.length, penVisible: pens.filter((v) => v.root && v.root.visible !== false).length,
      band: d.tiles.band, penRowsDrawn: d.tiles.grid.some((row) => row.some((t) => t.r >= 14 && t.drawn)),
      area3d: area ? Math.max(...area.map((a) => a.r1)) : null, board3d: !!d.board3d, penHidden: raw.stats().penHidden,
    };
  });

  // The field's 3D area ends at its separator row 13 — the row-13 devices blow into the field (act2 m01's blowers, user
  // playtest #5 item 6: render/app.js boardArea) — and the enemy preview pen starts at row 14.
  const NO_PEN_R1 = 13;

  test('6: the enemy pen shows with the prep board, in the pen view and after 返回战场 — never in a battle or the Final Assault prep', { skip: skipUnless('pen'), timeout: 5 * 60 * 1000 }, async () => {
    const { page, problems } = await open('phase=PREP', { w: 1920, h: 1080 });
    await sleep(900);
    let s = await penState(page);
    assert.equal(s.camera, 'prep');
    assert.ok(s.pen > 0, 'the pen holds the next round\'s enemies');
    // the maintainer's decision of 2026-10-15 (the official 休整期: the next round's enemies at the top right of the
    // prep view); user playtest #2 item 6 had kept the pen to the pen camera
    assert.equal(s.penHidden, false, 'prep board: the camera shows the pen');
    assert.ok(s.penVisible > 0, 'prep board: the pen\'s figures shown');
    assert.ok(s.penRowsDrawn, 'prep board: pen rows drawn');
    if (s.board3d) assert.ok(s.area3d >= 18, `prep board: 3D pen area built (${s.area3d})`);
    await page.screenshot({ path: path.join(OUT, 'fix-pen-prep.png') });
    await page.click('.enemybtn');
    await page.waitForFunction(() => document.querySelector('.gm')?.dataset.camera === 'pen', { timeout: 3000 });
    await sleep(700);
    s = await penState(page);
    assert.ok(s.penVisible > 0, 'pen view: figures shown');
    assert.ok(s.penRowsDrawn, 'pen view: pen rows drawn');
    if (s.board3d) assert.ok(s.area3d >= 18, 'pen view: 3D pen area built');
    await page.screenshot({ path: path.join(OUT, 'fix-pen-view.png') });
    // 🔍◀◀ (tooltip 返回战场) back to the board: the pen stays where it stands
    await page.click('.gtop__iconbtn');
    await page.waitForFunction(() => document.querySelector('.gm')?.dataset.camera === 'prep', { timeout: 3000 });
    await sleep(900);
    s = await penState(page);
    assert.equal(s.penHidden, false, 'back on the board (返回战场): the camera shows the pen');
    assert.ok(s.penVisible > 0, 'back on the board (返回战场): the pen\'s figures still shown');
    assert.ok(s.penRowsDrawn, 'back on the board: pen rows drawn');
    if (s.board3d) assert.ok(s.area3d >= 18, `back on the board: the pen area (${s.area3d})`);
    await page.screenshot({ path: path.join(OUT, 'fix-pen-back.png') });
    assert.deepEqual(problems, []);
    await page.close();

    // the Final Assault prep frames the boss field: no pen there
    {
      const o = await open('phase=PREP&variant=boss', { w: 1920, h: 1080 });
      await sleep(1200);
      const b = await penState(o.page);
      assert.equal(b.camera, 'bossPrep');
      assert.equal(b.penVisible, 0, 'Final Assault prep: no pen figure');
      assert.equal(b.penHidden, true, 'Final Assault prep: the camera hides the pen');
      assert.equal(b.penRowsDrawn, false, 'Final Assault prep: pen rows not drawn');
      if (b.board3d) assert.ok(b.area3d <= 6, `Final Assault prep: the boss field only (${b.area3d})`);
      assert.deepEqual(o.problems, [], 'boss prep');
      await o.page.close();
    }

    // every battle camera
    for (const phase of ['COMBAT', 'UNITE', 'FINAL_ASSAULT', 'HIDDEN_CORE']) {
      const o = await open(`phase=${phase}`, { w: 1920, h: 1080 });
      await sleep(1200);
      const b = await penState(o.page);
      assert.equal(b.penVisible, 0, `${phase}: no pen figure`);
      assert.equal(b.penRowsDrawn, false, `${phase}: pen rows not drawn`);
      if (b.board3d) assert.ok(b.area3d <= NO_PEN_R1, `${phase}: no pen area (${b.area3d})`);
      await o.page.screenshot({ path: path.join(OUT, `fix-pen-${phase.toLowerCase()}.png`) });
      assert.deepEqual(o.problems, [], phase);
      await o.page.close();
    }
  });
});
