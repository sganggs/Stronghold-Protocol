// Browser E2E of the 干员调配 overlay's optional 卡片视图 against the real server, headless Chrome (puppeteer-core + system
// Chrome). Opt-in: SP_E2E=1 node --test test/ui/loadout-cards.e2e.test.js
//
// Desktop 1920×1080: the overlay opens in the list (the default) → 卡片视图 → tier groups of cards behind the official
// tier tags (or the CSS marker) with the 甄选干员 cards closing tiers 5 / 6, the choice kept across a reopen → a card opens
// the detail in the drawer, the same card again closes it → 快速配置: S1 on 隐现's card is stored like the list's quick
// choice → Esc peels back 快速配置, the drawer, then the overlay → a tier jump scrolls the deck → leaving the tab (the
// 甄选干员 card, 干员持有) closes 快速配置 and the drawer, so one Esc there closes the overlay → ⓘ 卡片视图说明 → 筛选 → 列表
// goes back; a locked loadout said once, in the bottom bar (not again in the top bar, its sync chip or the drawer). Phone
// 844×390 (touch): the cards, the drawer over them, a locked loadout said in the bottom bar (with 快速配置 too). The list at 844×390 keeps its own opening: lo-in, no 转场, nothing replayed by the detail toggle.
// Every page must finish with zero console errors / page errors / failed requests. Screenshots: test/e2e/out/loadout-cards-*.png

import { seedReleaseRead } from '../helpers/releaseNotes.js';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSIONS } from '../../shared/versions.js';
import { textProblems } from '../e2e/text-fit.mjs';

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
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, versions: { enabled: 'all' } });
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
    await seedReleaseRead(page);
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

  for (const touch of [false, true]) for (const version of VERSIONS) {
    test(`#811: ${version.label} ${touch ? 'phones' : 'desktop'} — promotion icons, five languages, text sizes and UI scales`, { timeout: 180000 }, async () => {
      let checked = 0;
      const { ctx, page, problems } = await open(touch ? { w: 844, h: 390, touch } : {});
      try {
        if (await page.$eval('[data-testid="version-switch"]', (e) => e.dataset.version) !== version.id) {
          await clickSel(page, '[data-testid="version-switch"]');
          await page.waitForFunction(() => !document.getAnimations().some((a) => /^tr-/.test(String(a.animationName)) && a.playState === 'running'));
          await clickSel(page, `.verpick__pick[data-version="${version.id}"]`);
        }
        await page.waitForFunction((id) => (globalThis.__SP__.data.get('config')?.version?.id ?? 'act2autochess') === id
          && !document.querySelector('[data-testid="version-picker"]'), { timeout: 30000 }, version.id);
        await openOverlay(page);
        if (!await page.$('.lo-deck')) await clickSel(page, '[data-testid="loadout-view-deck"]');
        await page.waitForSelector('.lo-op__phase', { visible: true });
        await page.waitForFunction(() => !document.querySelector('.lo').getAnimations({ subtree: true })
          .some((a) => a.playState === 'running' && a.effect?.getTiming().iterations !== Infinity));
        const glyphs = await page.evaluate(() => {
          const out = [];
          for (const el of document.querySelectorAll('.lo-op[data-chess]')) {
            const c = globalThis.__SP__.data.lookup('chess', el.dataset.chess);
            const forms = [c, globalThis.__SP__.data.lookup('chess', c.goldenId)].filter(Boolean);
            const rows = [...el.querySelectorAll('.lo-op__lvrow')];
            forms.forEach((rec, i) => {
              const row = rows[i], icon = row?.querySelector('.lo-op__phase');
              if (!icon || !(icon.getAttribute('src')?.endsWith(`/elite_${rec.status.phase}.png`) || icon.textContent === `E${rec.status.phase}`)
                || row.querySelector('b')?.textContent !== String(rec.status.level)) out.push(rec.chessId);
            });
          }
          return out;
        });
        assert.deepEqual(glyphs, [], `${version.id}: the glyph and level match every normal / elite record`);
        for (const lang of ['zh', 'en', 'ja', 'ko', 'zh-TW']) {
          await page.evaluate(async (l) => (await import('/js/ui/lang.js')).switchLang(l), lang);
          for (const ts of ['sm', 'md', 'lg', 'xl']) {
            // 界面大小 is enabled only at 小; also test a stored 75 % with each larger text size.
            for (const ui of ts === 'sm' ? [75, 80, 85, 90, 95, 100] : [75, 100]) {
              await page.evaluate(async (ts, ui) => {
                (await import('/js/ui/settings.js')).updateSettings({ textSize: ts });
                (await import('/js/ui/screenFit.js')).updateFit({ ui });
              }, ts, ui);
              for (const [w, h] of touch ? [[640, 360], [844, 390], [390, 844]] : [[1920, 1080], [1600, 900], [960, 540]]) {
                await page.setViewport({ width: w, height: h, isMobile: touch, hasTouch: touch, deviceScaleFactor: 1 });
                await page.evaluate(async () => { await document.fonts.ready; await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); });
                const label = `${version.id} ${lang} ${ts} ${ui}% ${w}×${h}`;
                const geometry = await page.evaluate(() => {
                  const out = [];
                  for (const card of document.querySelectorAll('.lo-op[data-chess]')) {
                    const rail = card.querySelector('.lo-op__rail'), tier = rail.querySelector('.lo-op__tier');
                    const badge = tier.getBoundingClientRect(), img = tier.querySelector('img')?.getBoundingClientRect();
                    const lv = rail.querySelector('.lo-op__lv').getBoundingClientRect(), cr = card.getBoundingClientRect();
                    const rows = [...rail.querySelectorAll('.lo-op__lvrow')].map((e) => e.getBoundingClientRect());
                    if (Math.max(badge.bottom, img?.bottom ?? 0) > lv.top - 1) out.push(`${card.dataset.chess}: badge overlaps levels`);
                    if (rows.some((r) => r.left < lv.left - 1 || r.right > lv.right + 1 || r.top < lv.top || r.bottom > lv.bottom)
                      || rows.some((r, i) => i && rows[i - 1].bottom > r.top)) out.push(`${card.dataset.chess}: level rows overlap / escape`);
                    if (lv.bottom > cr.bottom + 1) out.push(`${card.dataset.chess}: levels escape card`);
                  }
                  return out;
                });
                assert.deepEqual(geometry, [], label);
                // The first card in each row of every tier covers all phase / level labels; geometry above checks every card.
                assert.deepEqual(await page.evaluate(textProblems, '.lo-tgrid > .lo-op:nth-child(-n+2) .lo-op__rail'), [], label);
                checked++;
              }
            }
          }
        }
        assert.deepEqual(problems, []);
      } finally { await ctx.close(); }
      assert.equal(checked, 180);
    });
  }

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
        marks: [...document.querySelectorAll('.lo-tmark')].map((mk) => (mk.querySelector('img.lo-tmark__art') ? 'art' : mk.querySelector('.lo-tmark__css') ? 'css' : '?')),
        slogan: getComputedStyle(document.querySelector('.lo-tmark'), '::after').content,
        tagInManifest: !!globalThis.__SP__.data.get('assets')?.ui?.['shopLevelSprite/shop_level_tag_1'],
      }));
      assert.equal(deck.cards, 112, 'every visible chess as a card');
      assert.deepEqual(deck.groups, [1, 2, 3, 4, 5, 6]);
      assert.deepEqual(deck.diy, [5, 6], 'the 甄选干员 cards close tiers 5 and 6');
      assert.equal(deck.rows, 2, 'a tier group flows in two rows');
      assert.ok(deck.scrolls, 'the deck scrolls sideways');
      assert.equal(deck.bar, 6);
      assert.equal(deck.stored, '"deck"');
      assert.ok(deck.layers.every((p) => p === 'relative'), `every layer stacks above the background ${deck.layers}`);
      assert.equal(deck.marks.length, 6);
      assert.ok(deck.marks.every((k) => k === 'art' || k === 'css'), `a tier tag or the CSS marker before every group ${deck.marks}`);
      assert.ok(deck.slogan === 'none' || deck.slogan === 'normal', `no invented slogan on the marker (${deck.slogan})`);
      if (deck.tagInManifest) {
        // the official shopLevelSprite tag, drawn at its own proportions (150 × 595)
        await page.waitForFunction(() => document.querySelector('.lo-tgroup[data-tier="1"] img.lo-tmark__art')?.complete, { timeout: 10000 });
        const tag = await page.$eval('.lo-tgroup[data-tier="1"] img.lo-tmark__art', (img) => ({ w: img.naturalWidth, h: img.naturalHeight, src: img.getAttribute('src') }));
        assert.ok(/shop_level_tag_1\.png$/.test(tag.src), tag.src);
        assert.deepEqual([tag.w, tag.h], [150, 595]);
      }
      await page.waitForFunction(() => !document.querySelector('.lo')?.getAnimations({ subtree: true })
        .some((a) => /^lo-tr-/.test(String(a.animationName)) && a.playState === 'running'));
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
      // (stored by operator: sp.pref.loadout v2, DESIGN §35.23 — 隐现 is char_498_inside)
      await page.waitForFunction((id) => JSON.parse(localStorage.getItem('sp.pref.loadout') || '{}').byChar?.[id]?.skill === 0, {}, 'char_498_inside');
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

      // leaving the tab closes the card view's layers: 快速配置 → the 甄选干员 card (自选编队) → back: no 快速配置 columns
      await clickSel(page, '[data-testid="loadout-quick"]');
      await page.waitForSelector('.lo-op__quick', { visible: true });
      await page.click('.lo-op--diy[data-diy-tier="6"]');
      await page.waitForFunction(() => document.querySelector('.lo-top__title')?.textContent.trim() === '自选编队', { timeout: 5000 });
      await page.click('.lo-back');
      await page.waitForSelector('[data-testid="loadout-quick"]', { visible: true });
      assert.equal(await page.$('.lo-op__quick'), null, '快速配置 did not come back stale');
      // the drawer open → 干员持有 → ONE Esc closes the overlay (no hidden layer swallows it)
      await page.click(`.lo-op[data-chess="${INSIDE}"] .lo-op__pick`);
      await page.waitForSelector('[data-testid="loadout-drawer"]', { visible: true });
      await page.click('[data-testid="loadout-ownership"]');
      await page.waitForFunction(() => document.querySelector('.lo-top__title')?.textContent.trim() === '干员持有', { timeout: 5000 });
      await escape(page);
      await page.waitForFunction(() => !document.querySelector('.lo'), { timeout: 3000 });
      // (the overlay reopens on the last tab, 干员持有; its back button returns to the deck — no drawer left open)
      await clickSel(page, '.lobby-screen [data-testid="loadout-open"]');
      await page.waitForFunction(() => document.querySelector('.lo-top__title')?.textContent.trim() === '干员持有', { timeout: 5000 });
      await page.click('.lo-back');
      await page.waitForSelector('[data-testid="loadout-deck"]', { visible: true });
      assert.equal(await page.$('[data-testid="loadout-drawer"]'), null);

      // a locked loadout (the server's 'locked') is said once on a wide screen — the bottom bar's chip — not again in the
      // top bar's note, its sync chip or the drawer's detail (§35.18's leftover: three times); with 快速配置 too
      const lockSays = () => page.evaluate(() => [...document.querySelectorAll('.lo *')].filter((el) => {
        if (![...el.childNodes].some((n) => n.nodeType === 3 && /锁定/.test(n.textContent))) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
      }).map((el) => (el.closest('[data-testid="loadout-deck-locked"]') ? 'chip' : el.closest('[class]')?.className || el.tagName)));
      assert.deepEqual(await lockSays(), [], 'not locked: nothing said');
      const unlockedNote = await page.$eval('.lo-top__note', (el) => el.textContent);
      await page.evaluate(async () => { (await import('/js/ui/loadoutSync.js')).loadoutStore.set({ sync: 'locked' }); });
      await page.waitForSelector('[data-testid="loadout-deck-locked"]', { visible: true, timeout: 5000 });
      assert.deepEqual(await lockSays(), ['chip'], 'locked: once, in the bottom bar');
      assert.equal(await page.$('.lo-top__note'), null, 'the top bar drops its note');
      assert.ok(unlockedNote && !/锁定/.test(unlockedNote), unlockedNote);
      assert.ok((await page.$eval('[data-testid="loadout-deck-locked"]', (el) => el.title)).includes('下一局生效'), 'the full notice in the chip\'s title');
      await page.click(`.lo-op[data-chess="${INSIDE}"] .lo-op__pick`);
      await page.waitForSelector('[data-testid="loadout-drawer"] .lo-detail .lo-skill', { visible: true });
      assert.deepEqual(await lockSays(), ['chip'], 'the drawer adds no second notice');
      await page.waitForFunction(() => !document.querySelector('.lo')?.getAnimations({ subtree: true })
        .some((an) => an.playState === 'running' && an.effect?.getTiming().iterations !== Infinity), { timeout: 5000 });
      await page.screenshot({ path: path.join(OUT, 'loadout-cards-locked.png') });
      await page.click(`.lo-op[data-chess="${INSIDE}"] .lo-op__pick`);
      await page.waitForSelector('[data-testid="loadout-drawer"]', { hidden: true });
      await clickSel(page, '[data-testid="loadout-quick"]');
      await page.waitForSelector('.lo-op__quick', { visible: true });
      assert.deepEqual(await lockSays(), ['chip'], '快速配置: still once');
      await escape(page);
      await page.evaluate(async () => { (await import('/js/ui/loadoutSync.js')).loadoutStore.set({ sync: 'idle' }); });
      await page.waitForSelector('[data-testid="loadout-deck-locked"]', { hidden: true, timeout: 5000 });

      // ⓘ 卡片视图说明 (not the official chapter's name), then 筛选 → 列表: back to the rows, stored
      await clickSel(page, '[data-testid="loadout-help"]');
      await page.waitForSelector('.modal .lo-help', { visible: true });
      const sheet = await page.$eval('.modal', (el) => el.textContent);
      assert.ok(sheet.includes('卡片视图说明') && !sheet.includes('调度手册'), sheet.slice(0, 80));
      await escape(page);
      await page.waitForSelector('.modal', { hidden: true });
      assert.ok(await page.$('.lo'), 'Esc closes only the 卡片视图说明');
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

      // a locked loadout (the server's 'locked'): the top bar's note is hidden at this width, the bottom bar says it —
      // with 快速配置 open too
      assert.equal(await page.$('[data-testid="loadout-deck-locked"]'), null);
      await page.evaluate(async () => { (await import('/js/ui/loadoutSync.js')).loadoutStore.set({ sync: 'locked' }); });
      await page.waitForSelector('[data-testid="loadout-deck-locked"]', { visible: true, timeout: 5000 });
      await page.tap('[data-testid="loadout-quick"]');
      await page.waitForSelector('[data-testid="loadout-quick-done"]', { visible: true });
      const lock = await page.evaluate(() => {
        const r = document.querySelector('[data-testid="loadout-deck-locked"]').getBoundingClientRect();
        const done = document.querySelector('[data-testid="loadout-quick-done"]').getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, w: r.width, vw: window.innerWidth, vh: window.innerHeight, doneLeft: done.left,
          title: document.querySelector('[data-testid="loadout-deck-locked"]').title };
      });
      assert.ok(lock.w > 40 && lock.right <= lock.doneLeft + 1 && lock.top < lock.vh, `the chip is on screen beside 确认配置 ${JSON.stringify(lock)}`);
      assert.ok(lock.title.includes('下一局生效'), lock.title);
      await page.screenshot({ path: path.join(OUT, 'loadout-cards-phone-locked.png') });
      assert.deepEqual(problems, []);
    } finally { await ctx.close(); }
  });

  test('the list (the default) keeps its own opening at 844×390: lo-in, no 转场, the detail toggle replays nothing', async () => {
    const { ctx, page, problems } = await open({ w: 844, h: 390, touch: true });
    try {
      await openOverlay(page);
      await page.waitForSelector('.lo .lo-card', { visible: true });
      const opening = await page.evaluate(() => ({
        lo: getComputedStyle(document.querySelector('.lo')).animationName,
        moving: [...document.querySelectorAll('.lo-top, .lo-top__center, .lo-top__right, .lo-note, .lo-roster, .lo__bg')]
          .map((el) => getComputedStyle(el).animationName).filter((n) => n !== 'none'),
      }));
      assert.equal(opening.lo, 'lo-in', 'the overlay fades in as before');
      assert.deepEqual(opening.moving, [], 'nothing of the 转场 in the list');
      await page.tap(`.lo-card[data-chess="${INSIDE}"] .lo-card__pick`);
      await page.waitForSelector('.lo-body.is-detail .lo-detail-wrap', { visible: true });
      const detail = await page.evaluate(() => ({
        name: getComputedStyle(document.querySelector('.lo-detail-wrap')).animationName,
        running: document.querySelector('.lo-detail-wrap').getAnimations({ subtree: false }).length,
        opacity: getComputedStyle(document.querySelector('.lo-detail-wrap')).opacity,
      }));
      assert.deepEqual(detail, { name: 'none', running: 0, opacity: '1' }, 'the detail shows at once');
      await page.tap('.lo-detail-back');
      await page.waitForSelector('.lo-roster', { visible: true });
      assert.equal(await page.$eval('.lo-roster', (el) => getComputedStyle(el).animationName + el.getAnimations().length), 'none0', 'the roster comes back at once');
      assert.deepEqual(problems, []);
    } finally { await ctx.close(); }
  });
});
