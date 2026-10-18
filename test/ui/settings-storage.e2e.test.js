// Browser check of 设置 → 素材存储 (the maintainer's request of 2026-10-17; opt-in, ~10 s):
//   SP_E2E=1 CHROME_PATH=… node --test test/ui/settings-storage.e2e.test.js
//
// The title screen's settings modal has a 素材存储 section (ui/settings.js StorageSection). http://127.0.0.1 is a secure
// context, so its line says whether the browser keeps this site's storage and its button asks again. Chrome's answer
// follows its persistent-storage permission, set here per browser context: granted → 已持久保存 with the button off;
// denied → 未持久保存, and asking shows the refusal with the button still on. 清理旧版本素材, after its confirm, deletes an
// imported copy that no current manifest names and keeps the current file. No console / page errors.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);
const KEPT = '已持久保存：存储空间不足时，浏览器不会自动清掉导入的素材。';
const NOT_KEPT = '未持久保存：存储空间不足时，浏览器可能清掉导入的素材。';
const REFUSED = /^浏览器没有同意。/;

describe('设置 → 素材存储', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome) to run' }, () => {
  let srv;
  let browser;
  let base;
  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    base = `http://127.0.0.1:${srv.port}`;
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--force-device-scale-factor=1'] });
  });
  after(async () => {
    await browser?.close();
    await srv?.close();
  });

  /** The title screen's settings, in a fresh context whose persistent-storage permission is `granted` or denied. */
  const openSettings = async (t, granted) => {
    const context = await browser.createBrowserContext();
    t.after(() => context.close());
    await context.overridePermissions(base, granted ? ['persistent-storage'] : []);
    const page = await context.newPage();
    const problems = [];
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    await page.setViewport({ width: 1600, height: 900 });
    await page.goto(`${base}/`, { waitUntil: 'networkidle0', timeout: 60000 });
    await page.waitForSelector('.title-settings', { timeout: 15000 });
    await page.click('.title-settings');
    await page.waitForSelector('[data-testid="storage-note"]', { timeout: 5000 });
    return { page, problems };
  };
  const view = (page) => page.evaluate(() => {
    const btn = document.querySelector('[data-testid="storage-persist"]');
    return { note: document.querySelector('[data-testid="storage-note"]')?.textContent.trim() ?? null,
      label: btn?.textContent.trim() ?? null, disabled: btn ? btn.disabled : null };
  });

  test('granted: the line says the assets are kept and the button is off', async (t) => {
    const { page, problems } = await openSettings(t, true);
    let now = await view(page);
    if (now.note === NOT_KEPT) {
      // a browser that reports the bucket rather than the permission turns persistent on the first ask
      await page.click('[data-testid="storage-persist"]');
      await page.waitForFunction((text) => document.querySelector('[data-testid="storage-note"]')?.textContent.trim() === text, { timeout: 5000 }, KEPT);
      now = await view(page);
    }
    assert.deepEqual(now, { note: KEPT, label: '已持久保存', disabled: true });
    assert.deepEqual(problems, []);
  });

  test('清理旧版本素材: after a confirm, the copy no current manifest names goes and the current file stays', async (t) => {
    const context = await browser.createBrowserContext();
    t.after(() => context.close());
    const page = await context.newPage();
    const problems = [];
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    await page.setViewport({ width: 1600, height: 900 });
    await page.goto(`${base}/`, { waitUntil: 'networkidle0', timeout: 60000 });
    // a current hashed picture of the served manifest (hashed once the server's asset index is ready, about 1 s in)
    const current = await page.evaluate(async () => {
      for (let i = 0; i < 40; i++) { // loop-cap: 40 polls of 250 ms
        const assets = await (await fetch('/data/assets.json', { cache: 'no-store' })).json();
        let found = null;
        const walk = (v) => {
          if (found) return;
          if (typeof v === 'string' && /^\/assets\/~[0-9a-f]{16}\/.+\.png$/.test(v)) found = v;
          else if (v && typeof v === 'object') for (const c of Object.values(v)) walk(c);
        };
        walk(assets);
        if (found) return found;
        await new Promise((r) => setTimeout(r, 250));
      }
      return null;
    });
    if (!current) { t.skip('the served manifest lists no hashed picture (no art on this machine)'); return; }
    const old = '/assets/~0000000000000000/ui/old-version.png';
    await page.evaluate(async (urls) => {
      const cache = await caches.open('sp-imported-assets-v1');
      for (const u of urls) await cache.put(u, new Response('x', { headers: { 'Content-Type': 'image/png' } }));
      await cache.put('/sp-imported-index.json', new Response(JSON.stringify([...urls].sort()), { headers: { 'Content-Type': 'application/json' } }));
    }, [current, old]);
    await page.waitForSelector('.title-settings', { timeout: 15000 });
    await page.click('.title-settings');
    await page.waitForSelector('[data-testid="storage-prune"]', { timeout: 5000 });
    await page.click('[data-testid="storage-prune"]');
    await page.waitForFunction(() => [...document.querySelectorAll('button[data-autofocus]')].some((b) => b.textContent.trim() === '清理'), { timeout: 5000 });
    await page.evaluate(() => [...document.querySelectorAll('button[data-autofocus]')].find((b) => b.textContent.trim() === '清理').click());
    await page.waitForSelector('[data-testid="storage-prune-note"]', { timeout: 15000 });
    assert.equal(await page.$eval('[data-testid="storage-prune-note"]', (el) => el.textContent.trim()), '已清理 1 个旧版本文件。');
    const left = await page.evaluate(async (urls) => {
      const cache = await caches.open('sp-imported-assets-v1');
      const index = await (await cache.match('/sp-imported-index.json')).json();
      return { current: !!(await cache.match(urls[0])), old: !!(await cache.match(urls[1])), index };
    }, [current, old]);
    assert.deepEqual(left, { current: true, old: false, index: [current] });
    assert.deepEqual(problems, []);
  });

  test('denied: not kept until asked; asking shows the refusal and the button stays on', async (t) => {
    const { page, problems } = await openSettings(t, false);
    assert.deepEqual(await view(page), { note: NOT_KEPT, label: '申请持久保存', disabled: false });
    await page.click('[data-testid="storage-persist"]');
    await page.waitForFunction(() => /^浏览器没有同意。/.test(document.querySelector('[data-testid="storage-note"]')?.textContent.trim() || ''), { timeout: 5000 });
    const after = await view(page);
    assert.match(after.note, REFUSED);
    assert.deepEqual({ label: after.label, disabled: after.disabled }, { label: '申请持久保存', disabled: false });
    assert.deepEqual(problems, []);
  });
});
