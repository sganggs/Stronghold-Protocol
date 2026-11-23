// The 0.1.1 gaps on screen (DESIGN §21.26), in headless Chrome (puppeteer-core + system Chrome) through the mock harness
// (public/dev/game-mock.html ?phase=PREP&variant=funny,morph,harmony: a 标准 match, a 变形同构体 in the shop's item slot, the
// first board operator wearing 变形同构体 + 维式重锤, 缪尔赛思 on the board). Opt-in: SP_E2E=1.
//
//   SP_E2E=1 node --test test/ui/feedback1-gaps.e2e.test.js
//   SP_E2E=1 SP_E2E_OUT=<dir> node --test test/ui/feedback1-gaps.e2e.test.js   # screenshots elsewhere
//
// At 1920×1080 and on phones (844×390, 756×366, touch): the 变形同构体 card from the shop lists its 14 pairings (5 marked 本局禁用),
// the wearer's card highlights 维多利亚 (生效中), and the popup of a core bond holding 调和's +1 says 在场 n/m [尚未激活]（含调和 +1） with the
// 调和 row naming 缪尔赛思 — every line inside its panel (the detail card without sideways scrolling), text ≥ 9 px on the
// phones. The strategy draft of a 标准 match (?phase=BAND_DRAFT&variant=funny, 1920×1080 and 844×390): 潘格尼尼, 克莱门莎 and
// 玛恩纳 — and no other — read 本局禁用 on their card, the detail pane says "本局禁用【拉特兰】盟约，此策略效果可能无法发挥", and
// 潘格尼尼 can still be picked. Screenshots:
// fb1-gaps-{morph-shop,morph-wearer,harmony,draft}-<w>x<h>.png. Unit counterparts: test/ui/feedback1-gaps.test.js.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = process.env.SP_E2E_OUT ? path.resolve(process.env.SP_E2E_OUT) : path.join(ROOT, 'test/e2e/out');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Geometry and text of the rows matching `sel` inside the scroller `box`: every row inside it, font size, overflow. */
const measure = (page, box, sel) => page.evaluate((box, sel) => {
  const b = document.querySelector(box);
  if (!b) return null;
  const r = b.getBoundingClientRect();
  const rows = [...b.querySelectorAll(sel)].map((el) => {
    const q = el.getBoundingClientRect();
    return { text: el.textContent.trim(), off: el.classList.contains('is-off'), worn: el.classList.contains('is-worn'), bond: el.getAttribute('data-bond'),
      inside: q.left >= r.left - 0.5 && q.right <= r.right + 0.5, font: parseFloat(getComputedStyle(el).fontSize) };
  });
  return { rows, sideways: b.scrollWidth > b.clientWidth + 1 };
}, box, sel);

describe('0.1.1 gaps: 变形同构体 pairings and 调和\'s +1 (mock harness, headless Chrome)', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome) to run' }, () => {
  let srv;
  let browser;
  let base;

  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    base = `http://127.0.0.1:${srv.port}`;
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
    mkdirSync(OUT, { recursive: true });
  });

  after(async () => {
    await browser?.close();
    await srv?.close();
  });

  for (const [name, w, h, touch] of [['1920x1080', 1920, 1080, false], ['844x390', 844, 390, true], ['756x366', 756, 366, true]]) {
    test(`${name}: the 变形同构体 card, its wearer's card and the 调和 row of the bond popup`, { timeout: 120000 }, async () => {
      const page = await browser.newPage();
      await page.setViewport({ width: w, height: h, deviceScaleFactor: 1, isMobile: touch, hasTouch: touch });
      const problems = [];
      page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
      page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
      await page.goto(`${base}/dev/game-mock.html?shot=1&render=fallback&phase=PREP&variant=funny,morph,harmony`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('.shopbar__item .scard', { timeout: 20000 });
      await sleep(600);
      const minFont = touch ? 9 : 13.5;
      const tap = async (sel) => { const el = await page.$(sel); assert.ok(el, sel); if (touch) await el.tap(); else await el.click(); await sleep(300); };

      // 1. the shop's 变形同构体 card: the first tap opens its detail with the 天赋 list
      await tap('.shopbar__item .scard');
      await page.waitForSelector('.dpanel .dmorph__row', { timeout: 5000 });
      await page.screenshot({ path: path.join(OUT, `fb1-gaps-morph-shop-${name}.png`) });
      const shop = await measure(page, '.dpanel__scroll', '.dmorph__row');
      assert.equal(shop.rows.length, 14, 'one line per bond');
      assert.deepEqual(shop.rows.filter((r) => r.off).map((r) => r.bond), ['lateranoShip', 'egirShip', 'kazimierzShip', 'arcaneShip', 'raidShip'], '标准: 本局禁用');
      assert.ok(shop.rows.filter((r) => r.off).every((r) => /本局禁用/.test(r.text)));
      assert.match(shop.rows.find((r) => r.bond === 'victoriaShip').text, /^【维多利亚】维式重锤、战栗维式重锤、坚固维式重锤、加速维式重锤、灼燃维式重锤$/);
      assert.equal(shop.rows.filter((r) => r.worn).length, 0, 'no wearer: no highlight');
      assert.ok(shop.rows.every((r) => r.inside), 'every line inside the card');
      assert.equal(shop.sideways, false, 'no sideways scrolling');
      assert.ok(shop.rows.every((r) => r.font >= minFont), `font ${shop.rows[0].font} px`);
      assert.match(await page.$eval('.dpanel .dmorph__lead', (el) => el.textContent), /搭配以下装备时，携带者视为对应盟约的成员：/);
      await page.evaluate(() => document.querySelector('.dpanel .dmorph__list')?.scrollIntoView({ block: 'start' }));
      await sleep(150);
      await page.screenshot({ path: path.join(OUT, `fb1-gaps-morph-shop-${name}-list.png`) });
      await page.keyboard.press('Escape');
      await sleep(300);

      // 2. the wearer's card (long-press / right-click on the board piece: contextmenu on the DOM board)
      const uid = await page.evaluate(() => globalThis.__MOCK__.S().priv.board[0].uid);
      await page.evaluate((uid) => document.querySelector(`.ff-piece[data-uid="${uid}"]`)?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 })), uid);
      await page.waitForSelector('.dpanel .dsec--equip .dmorph__row', { timeout: 5000 });
      await page.evaluate(() => document.querySelector('.dpanel .dmorph__row.is-worn')?.scrollIntoView({ block: 'center' }));
      await sleep(200);
      await page.screenshot({ path: path.join(OUT, `fb1-gaps-morph-wearer-${name}.png`) });
      const wearer = await measure(page, '.dpanel__scroll', '.dmorph__row');
      const worn = wearer.rows.filter((r) => r.worn);
      assert.deepEqual(worn.map((r) => r.bond), ['victoriaShip'], 'the pairing it wears');
      assert.match(worn[0].text, /生效中$/);
      assert.ok(wearer.rows.every((r) => r.inside) && !wearer.sideways);
      assert.match(await page.$eval('.dpanel .dhint--morph', (el) => el.textContent.trim()), /与变形同构体一同装备时，携带者视为【维多利亚】成员生效中/);
      await page.keyboard.press('Escape');
      await sleep(300);

      // 3. the popup of a core bond whose count holds 调和's +1 (the strip disc)
      const entry = await page.evaluate(() => {
        const e = globalThis.__MOCK__.store.get().match.private.bonds.find((b) => b.harmony > 0);
        return e ? { bondId: e.bondId, count: e.count, active: !!e.active, first: e.thresholds?.[0] } : null;
      });
      assert.ok(entry, 'a bond entry with the +1');
      const bond = entry.bondId;
      await tap(`.bslot[data-bond="${bond}"] .bond`);
      await page.waitForSelector('.bpop .bpop__harmony', { timeout: 5000 });
      await page.screenshot({ path: path.join(OUT, `fb1-gaps-harmony-${name}.png`) });
      const facts = await page.$eval('.bpop .bpop__facts', (el) => el.textContent);
      // members / first threshold (§37.342), then the state — the ✓ icon (no text) or 「尚未激活」, which PR #923 (§37.258)
      // put between the count and the note — then the 调和 note
      const m = facts.match(/在场\s*(\d+)\/(\d+)(尚未激活)?（含调和 \+1）/);
      assert.ok(m, `the facts line: ${facts}`);
      assert.deepEqual([Number(m[1]), Number(m[2]), !m[3]], [entry.count, entry.first, entry.active], `count / first threshold / state: ${facts}`);
      const note = await page.$eval('.bpop .bpop__hnote', (el) => parseFloat(getComputedStyle(el).fontSize));
      assert.ok(note >= (touch ? 8 : 11.5), `the note at ${note} px`);
      await page.evaluate(() => document.querySelector('.bpop .bpop__harmony')?.scrollIntoView({ block: 'center' }));
      await sleep(150);
      await page.screenshot({ path: path.join(OUT, `fb1-gaps-harmony-${name}-row.png`) });
      const row = await measure(page, '.bpop', '.bpop__harmony');
      assert.equal(row.rows.length, 1);
      assert.match(row.rows[0].text, /^调和 \+1缪尔赛思 在场：核心盟约激活人数 \+1$/);
      // (inside the popup's box; the popup's own few px of sideways overflow on phones predate this row)
      assert.ok(row.rows[0].inside, 'inside the popup');
      assert.ok(row.rows[0].font >= minFont, `font ${row.rows[0].font} px`);
      // the 调和 row opens 缪尔赛思's card
      await tap('.bpop .bpop__harmony');
      await page.waitForFunction(() => /缪尔赛思/.test(document.querySelector('.dpanel .dhead__name')?.textContent || ''), { timeout: 5000 });
      assert.deepEqual(problems, []);
      await page.close();
    });
  }

  // the strategy draft of a 标准 match (?phase=BAND_DRAFT&variant=funny; my turn): the strategies built around a bond 标准
  // switches off read 本局禁用 on their card and in the detail pane — and can still be picked
  for (const [name, w, h, touch] of [['1920x1080', 1920, 1080, false], ['844x390', 844, 390, true]]) {
    test(`${name}: the 标准 strategy draft marks 潘格尼尼 / 克莱门莎 / 玛恩纳 本局禁用, and 潘格尼尼 can still be picked`, { timeout: 120000 }, async () => {
      const page = await browser.newPage();
      await page.setViewport({ width: w, height: h, deviceScaleFactor: 1, isMobile: touch, hasTouch: touch });
      const problems = [];
      page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
      page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
      await page.goto(`${base}/dev/game-mock.html?shot=1&phase=BAND_DRAFT&variant=funny`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('.draft-grid .dband[data-band]', { timeout: 20000 });
      await sleep(500);
      const tap = async (sel) => { const el = await page.$(sel); assert.ok(el, sel); await el.scrollIntoView(); if (touch) await el.tap(); else await el.click(); await sleep(300); };
      const cards = await page.$$eval('.draft-grid .dband[data-band]', (els) => els.map((c) => {
        const t = c.querySelector('.dband__off');
        const r = c.getBoundingClientRect();
        const q = t ? t.getBoundingClientRect() : null;
        return { id: c.getAttribute('data-band'), off: c.classList.contains('is-off'), tag: t ? t.textContent : null, title: c.title || null,
          font: t ? parseFloat(getComputedStyle(t).fontSize) : null, inside: !q || (q.left >= r.left - 0.5 && q.right <= r.right + 0.5 && q.bottom <= r.bottom + 0.5) };
      }));
      assert.ok(cards.length >= 30, `${cards.length} strategies on offer`);
      assert.deepEqual(cards.filter((c) => c.tag).map((c) => c.id), ['band_paganini', 'band_clementia', 'band_mlynar'], 'only the three');
      assert.ok(cards.filter((c) => c.tag).every((c) => c.off && c.tag === '本局禁用' && c.inside && c.font >= (touch ? 8 : 11.5)), JSON.stringify(cards.filter((c) => c.tag)));
      assert.equal(cards.find((c) => c.id === 'band_paganini').title, '本局禁用【拉特兰】盟约，此策略效果可能无法发挥');
      await page.screenshot({ path: path.join(OUT, `fb1-gaps-draft-${name}.png`) });
      // its detail pane: the note, inside the pane; 确认选择 stays enabled (information only)
      await tap('.draft-grid .dband[data-band="band_paganini"]');
      await page.waitForSelector('.draft-detail .draft-detail__off', { timeout: 5000 });
      const note = await page.evaluate(() => {
        const n = document.querySelector('.draft-detail .draft-detail__off');
        const p = document.querySelector('.draft-detail').getBoundingClientRect();
        const r = n.getBoundingClientRect();
        const btn = [...document.querySelectorAll('.draft-detail__btns button')].pop();
        return { text: n.textContent.trim(), struck: n.querySelector('.draft-detail__offname')?.textContent, font: parseFloat(getComputedStyle(n).fontSize),
          inside: r.left >= p.left - 0.5 && r.right <= p.right + 0.5, confirm: btn ? { text: btn.textContent.trim(), disabled: btn.disabled } : null };
      });
      assert.equal(note.text, '本局禁用【拉特兰】盟约，此策略效果可能无法发挥');
      assert.equal(note.struck, '拉特兰');
      assert.ok(note.inside && note.font >= (touch ? 9 : 13.5), JSON.stringify(note));
      assert.deepEqual(note.confirm, { text: '确认选择', disabled: false }, 'still selectable');
      await page.screenshot({ path: path.join(OUT, `fb1-gaps-draft-${name}-detail.png`) });
      // a strategy tied to no switched-off bond: no note
      await tap('.draft-grid .dband[data-band="band_bldsk"]');
      assert.equal(await page.$('.draft-detail .draft-detail__off'), null);
      // picking 潘格尼尼 works like any strategy
      await tap('.draft-grid .dband[data-band="band_paganini"]');
      await tap('.draft-detail__btns button:last-child');
      await page.waitForFunction(() => /已选择「潘格尼尼」/.test(document.querySelector('.draft-detail__status')?.textContent || ''), { timeout: 5000 });
      assert.deepEqual(problems, []);
      await page.close();
    });
  }
});
