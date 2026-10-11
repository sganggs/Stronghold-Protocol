// RENDER_E2E=1 node --test test/render/battle-replay.browser.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
const chrome = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const skip = process.env.RENDER_E2E !== '1' || !existsSync(chrome) ? 'set RENDER_E2E=1 with Chrome' : false;

test('sandbox: fixed ticks, loadouts, ordered replay, invalid input, version warning, bounded logs and teardown', { skip, timeout: 120000 }, async () => {
  const { startServer } = await import('../../server/index.js');
  const puppeteer = (await import('puppeteer-core')).default;
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: chrome, headless: true, pipe: true, args: ['--no-first-run', '--no-sandbox', `--explicitly-allowed-ports=${srv.port}`] });
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto(`http://127.0.0.1:${srv.port}/dev/ember-test.html`);
    await page.waitForFunction(() => window.__battleTest?.ready || window.__battleTest?.error);
    assert.equal(await page.evaluate(() => window.__battleTest.error), null);
    const state = () => page.evaluate(() => {
      const d = window.__battleTest;
      return { tick: d.recorder.tick, time: d.scene.battle.time, snapshot: d.scene.battle.snapshot(), spec: d.scene.spec, operations: d.recorder.operations,
        renderT: d.view.stats().renderT, errors: d.scene.battle.errorCount };
    });
    await page.click('#step-frame'); const one = await state();
    assert.equal(one.tick, 1); assert.equal(one.time, 1 / 30); assert.equal(one.snapshot.t, .033);
    assert.match(await page.$eval('#state', (e) => e.textContent), /帧 1 · 0\.033 秒/);
    await page.$eval('#frame-count', (e) => e.value = '7'); await page.click('#step-n'); assert.equal((await state()).tick, 8);
    await page.click('#step'); assert.equal((await state()).tick, 38);
    await page.select('#potential', '1'); await page.select('#cultivate', '3');
    const loaded = await state(); assert.equal(loaded.tick, 0);
    assert.equal(loaded.spec.players[0].units[0].potential, 1); assert.equal(loaded.spec.players[0].units[0].cultivate, 3);
    const hp = loaded.snapshot.units.find((u) => u[0] === 1)?.[4];
    await page.select('#cultivate', '0'); assert.ok((await state()).snapshot.units.find((u) => u[0] === 1)?.[4] < hp);
    await page.click('#ally-auto'); await page.click('#enemy-auto'); await page.click('#knockout'); await page.click('#step');
    await page.click('#hit'); await page.click('#hit');
    const edited = await state();
    assert.deepEqual(edited.operations.slice(-2).map((op) => [op.tick, op.sequence]), [[30, 0], [30, 1]]);
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 500)));
    assert.equal((await state()).renderT, edited.snapshot.t, 'the exact-frame render clock holds while paused');
    await page.click('#rebuild-view'); assert.deepEqual((await state()).snapshot, edited.snapshot);
    // The production feed still interpolates/extrapolates; exact presentation is an opt-in API.
    await page.evaluate(() => {
      const d = window.__battleTest;
      d.view.enterBattle(d.scene.battle.fieldMeta()); d.view.pushSnapshot(d.scene.battle.snapshot());
    });
    await page.waitForFunction(() => window.__battleTest.view.stats().renderT > window.__battleTest.scene.battle.snapshot().t);
    await page.click('#rebuild-view');
    assert.equal((await state()).renderT, edited.snapshot.t);
    await page.click('#withdraw'); await page.click('#step');
    const before = await state(); await page.click('#export');
    const json = await page.$eval('#scene-json', (e) => e.value);
    await page.click('#import'); const after = await state();
    assert.deepEqual(after.snapshot, before.snapshot); assert.deepEqual(after.operations, before.operations); assert.equal(after.errors, 0);
    await page.click('#replay'); assert.deepEqual((await state()).snapshot, before.snapshot);
    for (const input of ['{', JSON.stringify({ schemaVersion: 99 }), JSON.stringify({ ...JSON.parse(json), config: { ...JSON.parse(json).config, enemyKey: 'missing' } })]) {
      await page.$eval('#scene-json', (e, value) => e.value = value, input); await page.click('#import');
      assert.ok(await page.$eval('#error', (e) => e.textContent)); assert.deepEqual((await state()).snapshot, before.snapshot, 'invalid import keeps the current scene');
    }
    const mismatched = JSON.parse(json); mismatched.gameVersion = 'old';
    await page.$eval('#scene-json', (e, value) => e.value = value, JSON.stringify(mismatched)); await page.click('#import');
    assert.match(await page.$eval('#version-warning', (e) => e.textContent), /版本不一致/);
    await page.click('#restart');
    await page.evaluate(() => {
      const d = window.__battleTest, old = d.scene;
      old.battle.after(.1, () => document.getElementById('state').dataset.oldCallback = 'fired');
      d.restart(); d.advanceFrames(30);
      assertUnused();
      function assertUnused() { if (old.battle.time !== 0) throw new Error('old battle was stepped after restart'); }
      for (let i = 0; i < 230; i++) document.getElementById('ally-auto').dispatchEvent(new Event('change'));
    });
    assert.equal(await page.$eval('#state', (e) => e.dataset.oldCallback), undefined);
    assert.equal(await page.evaluate(() => window.__battleTest.logs.length), 200);
    await page.select('#log-filter', 'operation');
    assert.ok(await page.$eval('#log', (e) => [...e.children].every((row) => row.textContent.includes('测试操作'))));
    // Verify the clipboard payload without depending on a headless OS clipboard service.
    await page.evaluate(() => { navigator.clipboard.writeText = async (text) => { window.__copiedLog = text; }; });
    await page.click('#copy-log');
    await page.waitForFunction(() => window.__copiedLog?.includes('测试操作'));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'desktop has no overflow');
    await page.setViewport({ width: 320, height: 720 });
    await page.evaluate(async () => { for (let i = 0; i < 5; i++) await new Promise(requestAnimationFrame); });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'narrow phone has no overflow');
    assert.ok(await page.evaluate(() => !document.body.textContent.includes('__BATTLE_MSG_')));
    await page.evaluate(() => {
      const d = window.__battleTest; d.destroy(); if (d.scene !== null) throw new Error('scene retained after teardown');
    });
    assert.equal(await page.$eval('#field', (e) => e.querySelectorAll('canvas').length), 0);
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await srv.close(); }
});

test('sandbox: unavailable models explain the fallback, and every shipped locale translates the page', { skip, timeout: 120000 }, async () => {
  const { startServer } = await import('../../server/index.js');
  const puppeteer = (await import('puppeteer-core')).default;
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: chrome, headless: true, pipe: true, args: ['--no-first-run', '--no-sandbox', `--explicitly-allowed-ports=${srv.port}`] });
    for (const lang of ['en', 'ja', 'ko', 'zh-TW']) {
      const page = await browser.newPage();
      await page.setRequestInterception(true);
      page.on('request', (req) => /\/assets\/.*\.(skel|atlas|png)(?:\?|$)/.test(req.url()) ? req.respond({ status: 404, body: '' }) : req.continue());
      await page.goto(`http://127.0.0.1:${srv.port}/dev/ember-test.html?lang=${lang}`);
      await page.waitForFunction(() => window.__battleTest?.ready || window.__battleTest?.error);
      assert.equal(await page.evaluate(() => window.__battleTest.error), null);
      await page.waitForFunction(() => /missing|failed|ありません|失敗|없습니다|실패|缺少|失敗/.test(document.getElementById('models').textContent));
      await page.click('#step-frame'); assert.equal(await page.evaluate(() => window.__battleTest.recorder.tick), 1);
      assert.notEqual(await page.$eval('h1', (e) => e.textContent), '通用战斗测试');
      assert.ok(await page.evaluate(() => !document.body.textContent.includes('__BATTLE_MSG_')));
      await page.close();
    }
  } finally { await browser?.close(); await srv.close(); }
});
