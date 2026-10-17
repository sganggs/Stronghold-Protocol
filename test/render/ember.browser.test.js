// RENDER_E2E=1 node --test test/render/ember.browser.test.js (Chrome + downloaded models).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { EMBER_ENEMIES } from '../../public/dev/ember-scenario.js';

const chrome = process.env.CHROME_PATH || (process.platform === 'win32'
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const skip = process.env.RENDER_E2E !== '1' || !existsSync(chrome) ? 'set RENDER_E2E=1 with Chrome and downloaded assets' : false;

test('fixed ember page: real damage, real models, blocking, death, revival and restart controls', { skip }, async () => {
  const puppeteer = (await import('puppeteer-core')).default;
  const { startServer } = await import('../../server/index.js');
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: chrome, headless: true, pipe: true, args: ['--no-first-run', '--no-sandbox', `--explicitly-allowed-ports=${srv.port}`] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(`http://127.0.0.1:${srv.port}/dev/ember-test.html`);
    await page.waitForFunction(() => window.__emberTest?.ready || window.__emberTest?.error).catch(async (error) => {
      throw new Error(`Page did not load: ${await page.$eval('#state', (e) => e.textContent)}; ${errors.join('; ')}; ${error.message}`);
    });
    assert.equal(await page.evaluate(() => window.__emberTest.error), null);
    // The general sandbox defaults to real combat. Keep this regression in manual observation mode.
    await page.click('#ally-auto');
    await page.click('#enemy-auto');
    const state = () => page.evaluate(() => {
      const d = window.__emberTest, e = d.scene.enemy, v = d.view.debug.views.get(e.id);
      return { form: e.form ?? null, alive: e.alive, stealth: !!e.s.flags.stealth && !e.s.flags.reveal && !e.blockedBy, blocked: !!e.blockedBy,
        hp: e.hp, killed: d.scene.battle.killed, clip: v?.actor?.current, viewAlive: v?.alive };
    });
    const clip = (name) => page.waitForFunction((n) => {
      const d = window.__emberTest;
      return d.view.debug.views.get(d.scene.enemy.id)?.actor?.current === n;
    }, {}, name).catch(async () => { throw new Error(`Expected clip ${name}, got ${JSON.stringify(await state())}; ${errors.join('; ')}`); });
    for (const key of Object.keys(EMBER_ENEMIES)) {
      await page.select('#enemy', key);
      await page.click('#step');
      await clip('Move');
      await page.click('#knockout');
      await clip('Die');
      assert.deepEqual(await state(), { form: 'husk', alive: true, stealth: true, blocked: false,
        hp: key === 'enemy_1292_duskld' ? 10 : 5, killed: 0, clip: 'Die', viewAlive: true });
      await clip('Move_2');
      await page.evaluate(() => {
        const d = window.__emberTest;
        d.view.enterBattle(d.scene.battle.fieldMeta());
        d.view.pushSnapshot(d.scene.battle.snapshot());
      });
      await clip('Move_2');
      assert.equal((await state()).form, 'husk', 'rejoining keeps the ember model');
      await page.click('#step');
      await clip('Move_2');
      await page.evaluate(() => window.__emberTest.advance(6));
      await clip('Idle_2');
      assert.ok((await state()).blocked && !(await state()).stealth);
      await page.click('#withdraw');
      await page.click('#step');
      await clip('Move_2');
      assert.ok(!(await state()).blocked && (await state()).stealth);
      const hits = (await state()).hp;
      for (let i = 0; i < hits; i++) await page.click('#hit');
      await clip('Die_2');
      assert.ok(!(await state()).alive && (await state()).killed === 1);
      await page.click('#rebuild-view');
      await clip('Die_2');
      assert.ok(!(await state()).alive);
      await page.evaluate(() => window.__emberTest.advance(20));
      assert.ok(!(await state()).alive);
      await page.click('#restart');
      await page.click('#step');
      await clip('Move');
      await page.click('#knockout');
      await clip('Move_2');
      await page.evaluate(() => window.__emberTest.advance(15));
      await clip('Revive');
      assert.equal((await state()).form, 'revived');
      await clip('Idle');
      assert.ok((await state()).alive && (await state()).killed === 0);
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await srv.close();
  }
});
