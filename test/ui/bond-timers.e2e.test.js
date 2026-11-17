// SP_E2E=1 CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node --test test/ui/bond-timers.e2e.test.js
// No art required: the real Game screen's server snapshot path + fallback board, settings, languages and card.
// Simulation/Worker/pacing correctness is covered separately in content/bond-timers and match/bond-timers.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);
const LABEL = '盟约效果剩余时间';
const rows = [{ id: 'sargon', count: 2, remaining: 3.2 }, { id: 'siracusaAspd', count: 1, remaining: 20 },
  { id: 'siracusaStealth', count: 1, remaining: 20 }];

describe('#746 bond timer settings and selected-unit card', { skip: !ENABLED && 'set SP_E2E=1 with Chrome' }, () => {
  let srv, browser, base;
  before(async () => {
    const { startServer } = await import('../../server/index.js');
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    base = `http://127.0.0.1:${srv.port}`;
    const puppeteer = (await import('puppeteer-core')).default;
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--force-device-scale-factor=1'] });
  });
  after(async () => { await browser?.close(); await srv?.close(); });

  async function toggle(page) {
    await page.evaluate(label => [...document.querySelectorAll('.set-row')]
      .find(r => r.querySelector('.set-row__label')?.textContent.startsWith(label))?.querySelector('[role="switch"]')?.click(), LABEL);
  }
  async function inject(page, timers, { dead = false, other = false } = {}) {
    await page.evaluate(async ({ timers, dead, other }) => {
      const mock = globalThis.__MOCK__, field = mock.store.get().match.field;
      clearInterval(mock.S().battle?.timer);
      const unit = field.units.find(u => u.side === 'ally');
      const { net } = await import('/js/net.js');
      net._emit('b.snap', { t: 'b.snap', gt: 7, fieldId: other ? 'unwatched' : field.fieldId,
        units: field.units.map(u => [u.id, u.x, u.y, dead && u.id === unit.id ? 0 : u.maxHp, u.maxHp, 0, 0, 0, 0]),
        ...(timers ? { bondTimers: [[unit.id, timers]] } : {}), dp: 10, killed: 0, total: 10 });
    }, { timers, dead, other });
  }
  const cardText = page => page.$eval('.dbond-times', el => el.textContent);

  test('off by default, toggled next to ammo/energy, saved across reload and hidden again when disabled', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/dev/game-mock.html?phase=COMBAT&render=fallback&shot=1`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('.ff-unit.is-ally');
      await inject(page, rows); await page.click('.ff-unit.is-ally');
      await page.waitForSelector('.dpanel');
      assert.equal(await page.$('.dbond-times'), null);
      await page.click('.gm__gear'); await page.waitForSelector('.modal');
      const state = await page.evaluate(label => {
        const all = [...document.querySelectorAll('.set-row')];
        const i = all.findIndex(r => r.querySelector('.set-row__label')?.textContent.startsWith(label));
        return { on: all[i]?.querySelector('[role="switch"]')?.getAttribute('aria-checked'), prior: all[i - 1]?.textContent };
      }, LABEL);
      assert.equal(state.on, 'false'); assert.match(state.prior, /显示弹药与能量数量/);
      await toggle(page); await page.keyboard.press('Escape');
      // #792 / DESIGN §35.93: opening settings dismisses the detail card. Select the unit again
      // to test the setting, rather than waiting for a card that intentionally closed.
      assert.equal(await page.$('.dpanel'), null);
      await page.click('.ff-unit.is-ally');
      await page.waitForSelector('.dbond-times');
      assert.match(await cardText(page), /2 层 · 下一层 3.2 秒/);
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('sp.pref.settings')).bondTimers), true);
      await page.reload({ waitUntil: 'networkidle0' }); await page.waitForSelector('.ff-unit.is-ally');
      await inject(page, rows); await page.click('.ff-unit.is-ally'); await page.waitForSelector('.dbond-times');
      await page.click('.gm__gear'); await page.waitForSelector('.modal'); await toggle(page); await page.keyboard.press('Escape');
      assert.equal(await page.$('.dpanel'), null);
      await page.click('.ff-unit.is-ally'); await page.waitForSelector('.dpanel');
      assert.equal(await page.$('.dbond-times'), null, 'disabled even with the unit card open');
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('sp.pref.settings')).bondTimers), false);
    } finally { await page.close(); }
  });

  test('snapshot updates, paused reads, reconnect, watched-field isolation, expiry/death, five languages and narrow layout', async () => {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    try {
      for (const [width, height] of [[1280, 720], [844, 390]]) {
        await page.setViewport({ width, height });
        await page.goto(`${base}/dev/game-mock.html?phase=COMBAT&render=fallback&shot=1`, { waitUntil: 'networkidle0' });
        await page.waitForSelector('.ff-unit.is-ally');
        await page.evaluate(async () => {
          const { updateSettings } = await import('/js/ui/settings.js'); updateSettings({ bondTimers: true, textSize: 'xl' });
          const { initLang, switchLang } = await import('/js/ui/lang.js'); await initLang(); await switchLang('zh');
        });
        await inject(page, rows); await page.click('.ff-unit.is-ally'); await page.waitForSelector('.dbond-times');
        const paused = await cardText(page);
        await new Promise(r => setTimeout(r, 1100));
        assert.equal(await cardText(page), paused, 'no new simulation snapshot: time does not drain');
        await inject(page, [{ id: 'sargon', count: 1, remaining: 2 }]);
        await page.waitForFunction(() => document.querySelector('.dbond-times')?.textContent.includes('2.0'));
        await inject(page, rows, { other: true });
        assert.match(await cardText(page), /2.0/, 'unwatched frame cannot replace selected field');
        await inject(page, [{ id: 'siracusaAspd', count: 1, remaining: 15 }, { id: 'siracusaAfter', count: 1, remaining: 10 }]);
        await page.waitForSelector('[data-effect="siracusaAfter"]');
        assert.equal(await page.$('[data-effect="siracusaStealth"]'), null);
        for (const lang of ['zh', 'en', 'ja', 'ko', 'zh-TW']) {
          await page.evaluate(async lang => { const { switchLang } = await import('/js/ui/lang.js'); await switchLang(lang); }, lang);
          const pack = lang === 'zh' ? {} : JSON.parse(readFileSync(new URL(`../../public/i18n/${lang}.json`, import.meta.url)));
          await page.waitForFunction(label => document.querySelector('.dbond-times')?.textContent.includes(label), {}, pack[LABEL] || LABEL);
          assert.ok((await cardText(page)).includes(pack['叙拉古·脱隐后触发窗口'] || '叙拉古·脱隐后触发窗口'));
          const box = await page.$eval('.dbond-times', el => ({ scroll: el.scrollWidth, client: el.clientWidth }));
          assert.ok(box.scroll <= box.client + 1, `${lang} ${width}: no horizontal overflow`);
        }
        await inject(page, null); await page.waitForFunction(() => !document.querySelector('.dbond-times'));
        await inject(page, rows); await page.waitForSelector('.dbond-times');
        // A spectator watches another field with the same unit ids: discard the old field's clocks before its frame.
        await page.evaluate(async () => {
          const store = globalThis.__MOCK__.store, s = store.get();
          store.set({ me: { ...s.me, playerId: 'timer-observer' },
            room: { ...s.room, spectators: [{ playerId: 'timer-observer', name: 'Observer', connected: true }] } });
          const { net } = await import('/js/net.js'); await net.request('g.watch', { fieldId: 'n:p3' });
        });
        await page.waitForFunction(() => !document.querySelector('.dbond-times'));
        await inject(page, rows); await page.click('.ff-unit.is-ally'); await page.waitForSelector('.dbond-times');
        await inject(page, rows, { dead: true }); await page.waitForFunction(() => !document.querySelector('.dbond-times'));
      }
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
});
