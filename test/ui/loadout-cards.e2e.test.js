// Browser E2E of the 干员调配 overlay's optional 卡片视图 against the real server, headless Chrome (puppeteer-core + system
// Chrome). Opt-in: SP_E2E=1 node --test test/ui/loadout-cards.e2e.test.js
//
// Desktop 1920×1080: the overlay opens in the list (the default) → 卡片视图 → tier groups of cards with the 甄选干员 cards
// closing tiers 5 / 6, the choice kept across a reopen → a card opens the detail in the drawer, the same card again closes
// it → 快速配置: S1 on 隐现's card is stored like the list's quick choice → Esc peels back 快速配置, the drawer, then the
// overlay → a tier jump scrolls the deck → 筛选 → 列表 goes back. Phone 844×390 (touch): the cards, the drawer over them.
// Every page must finish with zero console errors / page errors / failed requests. Screenshots: test/e2e/out/loadout-cards-*.png

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'test/e2e/out');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);
const INSIDE = 'chess_char_1_01_a';

describe('干员调配 卡片视图 (real server, headless Chrome)', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome) to run' }, () => {
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
  after(async () => { await browser?.close(); await srv?.close(); });

  async function open({ w = 1920, h = 1080, touch = false } = {}) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: w, height: h, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
    const problems = [];
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('requestfailed', (r) => { if (!/fonts\.(googleapis|gstatic)/.test(r.url())) problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`); });
    page.on('response', (r) => { if (r.status() >= 400) problems.push(`http ${r.status()}: ${r.url()}`); });
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('sp.name', '卡片测试');
      sessionStorage.setItem('sp.entered', '1');
    });
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => globalThis.__SP__?.store.get().connection.status === 'online' && !!document.querySelector('.lobby-screen'), { timeout: 30000 });
    return { ctx, page, problems };
  }
  const clickSel = async (page, sel) => {
    await page.waitForSelector(sel, { visible: true, timeout: 10000 });
    await page.click(sel);
  };
  const openOverlay = async (page) => {
    await clickSel(page, '.lobby-screen [data-testid="loadout-open"]');
    await page.waitForSelector('.lo .lo-card, .lo .lo-op', { visible: true, timeout: 15000 });
  };
  const escape = async (page) => { await page.keyboard.press('Escape'); await new Promise((r) => setTimeout(r, 120)); };

  test('desktop: list by default → cards (kept), drawer, 快速配置, Esc layers, tier jump, back to the list', async () => {
    const { ctx, page, problems } = await open();
    try {
      await openOverlay(page);
      assert.equal(await page.$$eval('.lo-card', (els) => els.length), 112, 'the list is the default');
      assert.equal(await page.$('.lo-deck'), null);
      await clickSel(page, '[data-testid="loadout-view-deck"]');
      await page.waitForSelector('[data-testid="loadout-deck"] .lo-op[data-chess]', { visible: true });
      const deck = await page.evaluate(() => ({
        cards: document.querySelectorAll('.lo-op[data-chess]').length,
        groups: [...document.querySelectorAll('.lo-tgroup')].map((g) => Number(g.dataset.tier)),
        diy: [...document.querySelectorAll('.lo-op--diy')].map((d) => Number(d.dataset.diyTier)),
        rows: new Set([...document.querySelectorAll('.lo-tgroup[data-tier="1"] .lo-op')].map((c) => Math.round(c.getBoundingClientRect().top))).size,
        scrolls: (() => { const d = document.querySelector('.lo-deck'); return d.scrollWidth > d.clientWidth; })(),
        bar: document.querySelectorAll('.lo-bbar__tier').length,
        stored: localStorage.getItem('sp.pref.loadout.view'),
        layers: [...document.querySelector('.lo').children].filter((c) => !c.classList.contains('lo__bg')).map((c) => getComputedStyle(c).position),
      }));
      assert.equal(deck.cards, 112, 'every visible chess as a card');
      assert.deepEqual(deck.groups, [1, 2, 3, 4, 5, 6]);
      assert.deepEqual(deck.diy, [5, 6], 'the 甄选干员 cards close tiers 5 and 6');
      assert.equal(deck.rows, 2, 'a tier group flows in two rows');
      assert.ok(deck.scrolls, 'the deck scrolls sideways');
      assert.equal(deck.bar, 6);
      assert.equal(deck.stored, '"deck"');
      assert.ok(deck.layers.every((p) => p === 'relative'), `every layer stacks above the background ${deck.layers}`);
      await page.screenshot({ path: path.join(OUT, 'loadout-cards-desktop.png') });

      // a card opens the drawer with the list's own detail; the same card again closes it
      await page.click(`.lo-op[data-chess="${INSIDE}"] .lo-op__pick`);
      await page.waitForSelector('[data-testid="loadout-drawer"] .lo-detail .lo-skill', { visible: true });
      assert.equal(await page.$eval('[data-testid="loadout-drawer"] .lo-dhead__name', (el) => el.textContent.trim()), '隐现');
      const covered = await page.evaluate((id) => {
        const card = document.querySelector(`.lo-op[data-chess="${id}"]`).getBoundingClientRect();
        const drawer = document.querySelector('.lo-drawer').getBoundingClientRect();
        return card.left >= drawer.right - 1;
      }, INSIDE);
      assert.ok(covered, 'the picked card stays visible beside the drawer');
      await page.screenshot({ path: path.join(OUT, 'loadout-cards-drawer.png') });
      await page.click(`.lo-op[data-chess="${INSIDE}"] .lo-op__pick`);
      await page.waitForSelector('[data-testid="loadout-drawer"]', { hidden: true });

      // 快速配置: the same stored choice as the list's quick buttons
      await clickSel(page, '[data-testid="loadout-quick"]');
      await page.waitForSelector(`.lo-op[data-chess="${INSIDE}"] .lo-op__quick .lo-q--skill[data-skill="0"]`, { visible: true });
      await page.click(`.lo-op[data-chess="${INSIDE}"] .lo-op__quick .lo-q--skill[data-skill="0"]`);
      await page.waitForFunction((id) => JSON.parse(localStorage.getItem('sp.pref.loadout') || '{}').entries?.[id]?.skill === 0, {}, INSIDE);
      await clickSel(page, '.lo-qseg [data-quick="cult"]');
      await page.waitForSelector(`.lo-op[data-chess="${INSIDE}"] .lo-op__quick--cult select`, { visible: true });
      await page.screenshot({ path: path.join(OUT, 'loadout-cards-quick.png') });
      assert.ok(await page.$(`.lo-op[data-chess="${INSIDE}"].is-changed .lo-op__mark`), 'the changed card is marked');

      // Esc: 快速配置 first, then the drawer, then the overlay
      await page.click(`.lo-op[data-chess="${INSIDE}"] .lo-op__pick`);
      await page.waitForSelector('[data-testid="loadout-drawer"]', { visible: true });
      await escape(page);
      assert.equal(await page.$('.lo-op__quick'), null, 'Esc closes 快速配置');
      assert.ok(await page.$('[data-testid="loadout-drawer"]'), 'the drawer stays');
      await escape(page);
      assert.equal(await page.$('[data-testid="loadout-drawer"]'), null, 'Esc closes the drawer');
      assert.ok(await page.$('.lo'));
      await escape(page);
      await page.waitForFunction(() => !document.querySelector('.lo'), { timeout: 3000 });

      // the choice is kept: the overlay reopens in the cards; a tier jump scrolls the deck to that group
      await openOverlay(page);
      assert.ok(await page.$('[data-testid="loadout-deck"]'), 'reopened in the card view');
      await page.click('.lo-bbar__tier[data-tier="6"]');
      await page.waitForFunction(() => {
        const d = document.querySelector('.lo-deck');
        const g = document.querySelector('.lo-tgroup[data-tier="6"]');
        return g.getBoundingClientRect().left < d.getBoundingClientRect().left + d.clientWidth / 2;
      }, { timeout: 5000 });
      await page.waitForFunction(() => document.querySelector('.lo-bbar__tier.is-on')?.dataset.tier === '6', { timeout: 5000 });

      // 调度手册, then 筛选 → 列表: back to the rows, stored
      await clickSel(page, '[data-testid="loadout-help"]');
      await page.waitForSelector('.modal .lo-help', { visible: true });
      await escape(page);
      await page.waitForSelector('.modal', { hidden: true });
      assert.ok(await page.$('.lo'), 'Esc closes only the 调度手册');
      await clickSel(page, '[data-testid="loadout-filter"]');
      await page.waitForSelector('.lo-pop--filter .lo-search input', { visible: true });
      await page.type('.lo-pop--filter .lo-search input', '隐现');
      await page.waitForFunction(() => document.querySelectorAll('.lo-op[data-chess]').length === 1 && !document.querySelector('.lo-op--diy'), { timeout: 5000 });
      await clickSel(page, '[data-testid="loadout-view-list"]');
      await page.waitForSelector('.lo .lo-card', { visible: true });
      assert.equal(await page.evaluate(() => localStorage.getItem('sp.pref.loadout.view')), '"list"');
      assert.deepEqual(problems, []);
    } finally { await ctx.close(); }
  });

  test('phone 844×390 (touch): the cards fit two rows, the drawer slides over them', async () => {
    const { ctx, page, problems } = await open({ w: 844, h: 390, touch: true });
    try {
      await page.evaluate(() => localStorage.setItem('sp.pref.loadout.view', JSON.stringify('deck')));
      await openOverlay(page);
      await page.waitForSelector('[data-testid="loadout-deck"] .lo-op[data-chess]', { visible: true });
      // measured once the 转场 (lo-tr-*: the bottom bar rises into place) is over
      await page.waitForFunction(() => !document.querySelector('.lo')?.getAnimations({ subtree: true })
        .some((a) => /^lo-tr-/.test(String(a.animationName)) && a.playState === 'running'));
      const fit = await page.evaluate(() => {
        const vh = window.innerHeight;
        const bar = document.querySelector('.lo-bbar').getBoundingClientRect();
        const cards = [...document.querySelectorAll('.lo-tgroup[data-tier="1"] .lo-op')].map((c) => c.getBoundingClientRect());
        return { barBottom: bar.bottom, vh, rows: new Set(cards.map((r) => Math.round(r.top))).size, lowest: Math.max(...cards.map((r) => r.bottom)), barTop: bar.top };
      });
      assert.ok(fit.barBottom <= fit.vh + 1, `the bottom bar is on screen ${JSON.stringify(fit)}`);
      assert.equal(fit.rows, 2);
      assert.ok(fit.lowest <= fit.barTop + 1, `the cards end above the bar ${JSON.stringify(fit)}`);
      await page.tap(`.lo-op[data-chess="${INSIDE}"] .lo-op__pick`);
      await page.waitForSelector('[data-testid="loadout-drawer"] .lo-detail', { visible: true });
      await page.screenshot({ path: path.join(OUT, 'loadout-cards-phone.png') });
      await page.tap('.lo-drawer__close');
      await page.waitForSelector('[data-testid="loadout-drawer"]', { hidden: true });
      assert.deepEqual(problems, []);
    } finally { await ctx.close(); }
  });
});
