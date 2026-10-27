import { seedReleaseRead } from '../helpers/releaseNotes.js';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const enabled = process.env.SP_E2E === '1' && existsSync(CHROME);
describe('community UI: lobby header and shared DIY details', { skip: !enabled }, () => {
  let srv, browser;
  before(async () => {
    const { startServer } = await import('../../server/index.js');
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    const P = (await import('puppeteer-core')).default;
    browser = await P.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
    mkdirSync(new URL('../e2e/out/', import.meta.url), { recursive: true });
  });
  after(async () => { await browser?.close(); await srv?.close(); });
  test('equipment draft clears an armed choice when shared stock becomes unavailable', async () => {
    const { context, page } = await open(1600);
    try {
      await page.evaluate(async () => {
        const { render, h } = await import('/vendor/preact.module.js');
        const { ChoiceOverlay } = await import('/js/ui/choiceOverlay.js');
        const { data } = await import('/js/data.js');
        await data.loadAll('items', 'choices', 'config');
        const props = { pub: { players: [{ playerId: 'p_0', name: 'Doctor' }] }, myId: 'p_0', solo: true,
          onPick: i => { (window.__picks ||= []).push(i); },
          sp: { family: 'supply', name: '道具补给', turnPid: 'p_0', pickOf: new Map(), order: ['p_0'], cards: [
            { idx: 0, kind: 'item', id: 'chess_item_5_07_e_a' }, { idx: 1, kind: 'item', id: 'chess_item_1_01_e_a' },
          ] } };
        const host = document.getElementById('app'); render(h(ChoiceOverlay, props), host);
        window.__exhaustStock = () => render(h(ChoiceOverlay, { ...props,
          sp: { ...props.sp, cards: props.sp.cards.map((c, i) => i ? c : { ...c, soldOut: true }) } }), host);
      });
      await page.waitForSelector('.spcard'); await page.click('.spcard');
      await page.waitForSelector('.spcard.is-armed');
      await page.evaluate(() => window.__exhaustStock());
      await page.waitForFunction(() => document.querySelector('.spcard').disabled && !document.querySelector('.spcard.is-armed'));
      assert.match(await page.$eval('.spcard', e => e.textContent), /库存不足/);
      assert.equal(await page.evaluate(() => window.__picks?.length || 0), 0);
      await page.screenshot({ path: new URL('../e2e/out/shared-stock-unavailable.png', import.meta.url).pathname });
      await page.click('.spcard:nth-child(2)'); await page.click('.spcard:nth-child(2)');
      assert.deepEqual(await page.evaluate(() => window.__picks), [1]);
    } finally { await context.close(); }
  });
  async function open(width, lang = 'zh-CN') {
    const context = await browser.createBrowserContext(), page = await context.newPage();
    await page.setViewport({ width, height: width < 1000 ? 390 : 900, hasTouch: width < 1000 });
    await page.evaluateOnNewDocument(l => {
      localStorage.setItem('sp.name', '超长名称的测试博士名称'); sessionStorage.setItem('sp.entered', '1');
      localStorage.setItem('sp.pref.settings', JSON.stringify({ textSize: 'xl' }));
      localStorage.setItem('sp.pref.lang', JSON.stringify(l));
    }, lang);
    await seedReleaseRead(page);
    await page.goto(`http://127.0.0.1:${srv.port}/`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.lobby-screen');
    return { context, page };
  }
  for (const width of [1600, 844]) for (const lang of ['zh-CN', 'en', 'ja', 'ko', 'zh-TW']) {
    test(`lobby ${width}px ${lang}, XL text, long name, resume and install controls`, async () => {
      const { context, page } = await open(width, lang);
      try {
        // Supply only the optional controls' eligibility; their production components, CSS and click handlers remain.
        await page.evaluate(async () => {
          const { identity } = await import('/js/net.js');
          identity.recoverable = () => [{ id: 'layout-only', name: 'Doctor', code: 'ABCD' }];
          window.dispatchEvent(new Event('focus'));
          const e = new Event('beforeinstallprompt', { cancelable: true });
          e.prompt = async () => {}; e.userChoice = Promise.resolve({ outcome: 'dismissed' });
          window.dispatchEvent(e);
          await document.fonts.ready;
        });
        await page.waitForSelector('[data-testid="resume-local-match"]');
        await page.waitForSelector('[data-testid="pwa-install"]');
        const boxes = await page.$$eval('.lobby-screen .topbar button, .lobby-screen .topbar__center', els => els.map(e => {
          const r = e.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return { label: e.getAttribute('aria-label') || e.textContent.trim(), x: r.x, y: r.y, right: r.right, bottom: r.bottom,
            hit: e.tagName !== 'BUTTON' || hit === e || e.contains(hit) };
        }));
        for (const b of boxes) {
          assert.ok(b.x >= 0 && b.right <= width && b.y >= 0, JSON.stringify(b));
          assert.equal(b.hit, true, JSON.stringify(b));
        }
        for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i], b = boxes[j];
          assert.ok(Math.min(a.right, b.right) - Math.max(a.x, b.x) <= 1 || Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) <= 1,
            `${a.label} overlaps ${b.label}`);
        }
        await page.screenshot({ path: new URL(`../e2e/out/lobby-header-${width}-${lang}.png`, import.meta.url).pathname });
        // 统计数据 from the lobby: the 成就统计 card → its window → 查看完整统计 (the top bar has no 统计数据 chip)
        await page.click(width < 1000 ? '.hub-plate--ach' : '.hub-ach'); await page.waitForSelector('.modal__box.achv .achv__more', { visible: true });
        await page.click('.modal__box.achv .achv__more'); await page.waitForSelector('.st .st-tab');
        await page.click('.st-back');
        await page.waitForSelector('.st', { hidden: true });
        await page.click('.lobby-screen [data-testid="settings-btn"]'); await page.waitForSelector('.modal');
      } finally { await context.close(); }
    });
  }
  for (const width of [1600, 844]) test(`DIY ${width}px XL: shared stats and normal/elite skill details stay usable`, async () => {
    const { context, page } = await open(width);
    try {
      await page.click('[data-testid="loadout-open"]'); await page.click('[data-tab="diy"]');
      await page.click('.diy-slot[data-slot="chess_char_6_diy1_a"] .diy-slot__fill');
      const picker = '[data-testid="diy-picker"]';
      await page.waitForSelector(`${picker} [data-char="char_112_siege"]`);
      await page.click(`${picker} .diy-opt[data-char="char_112_siege"] .diy-opt__pick`);
    // 窄屏是两步（screens/diy.js sel）：第一下只选中该干员，第二下才让详情滑出
    if (width < 1000) await page.click(`${picker} .diy-opt[data-char="char_112_siege"] .diy-opt__pick`);
      await page.waitForSelector(`${picker} .lo-sec--stats[data-variant="elite"]`);
      const detail = () => page.$eval(`${picker} .diy-pick__detail`, e => ({ stats: [...e.querySelectorAll('.dstat__v')].map(n => n.textContent),
        skill: [...e.querySelectorAll('.lo-skill__desc')].map(n => n.textContent), talents: e.querySelectorAll('.lo-minfo__row').length,
        tags: e.querySelector('.lo-skill__tags')?.textContent }));
      const elite = await detail(); assert.equal(elite.stats.length, 8); assert.ok(elite.talents >= 2); assert.match(elite.tags, /初始|被动/);
      await page.click(`${picker} button[data-variant="normal"]`);
      await page.waitForSelector(`${picker} .lo-sec--stats[data-variant="normal"]`);
      const normal = await detail(); assert.notDeepEqual(normal.stats, elite.stats); assert.notDeepEqual(normal.skill, elite.skill);
      await page.click(`${picker} button[data-variant="elite"]`);
      const restored = await detail(); assert.deepEqual(restored.stats, elite.stats);
      // Independent scrolling must reach all skills/modules without displacing the fixed confirm control.
      await page.$eval(`${picker} .diy-pick__detail`, e => { e.scrollTop = e.scrollHeight; });
      await page.screenshot({ path: new URL(`../e2e/out/diy-detail-${width}-xl.png`, import.meta.url).pathname });
      const accessible = await page.$eval('[data-testid="diy-confirm"]', e => {
        const r = e.getBoundingClientRect(), at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return r.bottom <= innerHeight && (at === e || e.contains(at));
      });
      assert.equal(accessible, true);
      await page.click('[data-testid="diy-confirm"]');
      await page.waitForSelector(picker, { hidden: true });
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('sp.pref.diy')).picks.chess_char_6_diy1_a.charId), 'char_112_siege');
    } finally { await context.close(); }
  });
});
