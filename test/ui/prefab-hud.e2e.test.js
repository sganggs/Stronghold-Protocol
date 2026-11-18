// Browser check of the 规程 HUD drawn from the official prefabs (§37.144) through the dev mock (opt-in, needs Chrome and
// the local theme packs with prefabs.json; skipped without them, as on CI):
//   SP_E2E=1 CHROME_PATH=… node --test test/ui/prefab-hud.e2e.test.js
//
// Asserted: with 可露希尔 selected in a 规程 match, the top bar band, the countdown and the ready button are the pack's
// prefabs (the round and LP show where `_roundText` / `_playerHpText` point, the countdown is the bitmap font, the ready
// face sits on the countdown and still toggles); 主题动画 off leaves no running prefab animation; the default theme
// and 盟约 keep the hand-made top bar.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PACK = new URL('../../public/assets/local/themes/ac_s_closur/prefabs.json', import.meta.url);
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME) && existsSync(PACK);

describe('规程 official prefab HUD (headless Chrome)', { skip: !ENABLED && 'set SP_E2E=1, have Chrome and the local theme packs' }, () => {
  let srv;
  let browser;
  let base;

  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, versions: { enabled: 'all' } });
    base = `http://127.0.0.1:${srv.port}`;
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--force-device-scale-factor=1'] });
  });

  after(async () => {
    await browser?.close();
    await srv?.close();
  });

  async function open({ theme = 'ac_s_closur', version = 'regulation', motion = true } = {}) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setBypassServiceWorker(true);
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    const problems = [];
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
    await page.evaluateOnNewDocument((s) => { localStorage.setItem('sp.pref.settings', JSON.stringify(s)); }, { uiTheme: theme, themeMotion: motion });
    await page.goto(`${base}/dev/game-mock.html?shot=1&render=fallback&phase=PREP${version ? `&version=${version}` : ''}`, { waitUntil: 'networkidle0', timeout: 60000 });
    await page.waitForSelector('.gtop', { timeout: 30000 });
    return { page, context, problems };
  }

  test('可露希尔: band, countdown and ready face from the pack; the ready face still toggles', { timeout: 120000 }, async () => {
    const { page, context, problems } = await open();
    try {
      await page.waitForSelector('.gtop__band--pf .pf__n', { timeout: 20000 });
      const info = await page.evaluate(() => {
        const text = (name) => [...document.querySelectorAll(`.gtop__band--pf .pf__n[data-n="${name}"] > .pf__t`)].map((e) => e.textContent.trim()).filter(Boolean);
        const clock = document.querySelector('.gtop__clock--pf .pfclock');
        const ready = document.querySelector('.readywrap--pf .readybtn--pf');
        const c = clock?.getBoundingClientRect();
        const r = ready?.getBoundingClientRect();
        return {
          round: text('text_num'), hp: text('text_hp'), mid: [...document.querySelectorAll('.gtop__band--pf .pf__n[data-n="group_mid_screen"] > .pf__n')].map((e) => e.dataset.n),
          glyphs: clock ? clock.querySelectorAll('.pf__glyph').length : 0, timer: clock?.getAttribute('role'),
          readyOnClock: !!(c && r && r.top > c.top && r.top < c.bottom && r.left >= c.left - 1 && r.right <= c.right + 1),
          pressed: ready?.getAttribute('aria-pressed'), label: ready?.querySelector('.readybtn__label')?.textContent,
          handmade: !!document.querySelector('.gtop__band:not(.gtop__band--pf)'),
        };
      });
      assert.equal(info.handmade, false);
      assert.ok(info.round.length && /^\d+$/.test(info.round[0]), `round number in the official text_num: ${JSON.stringify(info.round)}`);
      assert.ok(info.hp.length && /^\d+$/.test(info.hp[0]), `LP in text_hp: ${JSON.stringify(info.hp)}`);
      assert.deepEqual(info.mid, ['group_rest'], 'prep: the rest panel only');
      assert.ok(info.glyphs >= 2, 'the countdown digits are bitmap glyphs');
      assert.equal(info.timer, 'timer');
      assert.ok(info.readyOnClock, 'the ready face sits on the countdown');
      assert.equal(info.pressed, 'false');
      assert.equal(info.label, '准备就绪');
      await page.click('.readybtn--pf');
      // funds are left, so 准备 asks first (剩余资金), as with the hand-made button (test/ui/mock.e2e.test.js)
      await page.waitForSelector('.modal__title', { timeout: 5000 }).catch(() => null);
      if (await page.$('.modal__title')) {
        const title = await page.$eval('.modal__title', (el) => el.textContent || '');
        if (title.includes('剩余资金')) await page.click('.modal__actions .btn--primary');
      }
      await page.waitForFunction(() => document.querySelector('.readybtn--pf')?.getAttribute('aria-pressed') === 'true', { timeout: 10000 });
      assert.equal(await page.$eval('.readybtn--pf .readybtn__label', (e) => e.textContent), '取消准备');
      assert.deepEqual(problems, []);
    } finally {
      await context.close();
    }
  });

  test('可露希尔: the round start is the pack\'s banner, it plays and leaves inside 回合开始; the bond discs wear the pack\'s rings', { timeout: 120000 }, async () => {
    const { page, context, problems } = await open({ version: 'regulation' });
    try {
      await page.waitForSelector('.gtop__band--pf .pf__n', { timeout: 20000 });
      const rings = await page.evaluate(() => {
        const el = document.querySelector('.gm__bonds--pf');
        return el ? getComputedStyle(el).getPropertyValue('--pf-bond-on').includes('bg_active') : false;
      });
      assert.ok(rings, 'the bond strip carries the pack\'s bg_active ring');
      await page.evaluate(async () => {
        const M = globalThis.__MOCK__;
        M.mutate((s) => { s.pub.round = 4; s.priv.funds = 13; }); M.pushPublic();
        await new Promise((r) => setTimeout(r, 300));
        M.setPhase('ROUND_START'); M.mutate((s) => { s.pub.round = 5; s.priv.funds = 21; }); M.pushPublic();
      });
      await page.waitForSelector('.mpop--pf[data-testid="round-popup"] .pf__n', { timeout: 5000 });
      const banner = await page.evaluate(() => {
        const texts = [...document.querySelectorAll('.mpop--pf .pf__t')].map((e) => e.textContent.trim()).filter(Boolean);
        return { texts, running: document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.target?.closest?.('.mpop--pf')).length };
      });
      assert.ok(banner.texts.includes('05') && banner.texts.includes('04'), `the round rolls 04 → 05: ${JSON.stringify(banner.texts)}`);
      assert.ok(banner.texts.includes('8'), 'the income, its plus drawn by the pack');
      assert.ok(banner.running > 0, 'the in clip plays');
      await page.waitForFunction(() => !document.querySelector('[data-testid="round-popup"]'), { timeout: 3500 });
      assert.deepEqual(problems, []);
    } finally {
      await context.close();
    }
  });

  test('主题动画 off: no prefab animation runs', { timeout: 120000 }, async () => {
    const { page, context } = await open({ motion: false });
    try {
      await page.waitForSelector('.gtop__band--pf .pf__n', { timeout: 20000 });
      const running = await page.evaluate(() => document.getAnimations().filter((a) => String(a.animationName || '').startsWith('pf-') && a.playState === 'running').length);
      assert.equal(running, 0);
    } finally {
      await context.close();
    }
  });

  test('the default theme and 盟约 keep the hand-made top bar', { timeout: 120000 }, async () => {
    for (const [theme, version] of [['', 'regulation'], ['ac_s_closur', '']]) {
      const { page, context } = await open({ theme, version });
      try {
        await page.waitForSelector('.gtop__band', { timeout: 20000 });
        const pf = await page.evaluate(() => !!document.querySelector('.gtop__band--pf, .readybtn--pf, .gtop__clock--pf'));
        assert.equal(pf, false, `${theme || 'default'} / ${version || '盟约'}`);
      } finally {
        await context.close();
      }
    }
  });
});
