// SP_E2E=1 CHROME_PATH=<chrome> node --test test/ui/asset-download.browser.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from '../../server/index.js';
import { hash16 } from '../../server/http/assetIndex.js';
import { CHROME, hasChrome } from '../e2e/client.mjs';

test('homepage download, visible failure/retry, pause, cache reuse, and the two asset buttons\' responsive placement', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 90000,
}, async (t) => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  const image = `/assets/~${hash16(png)}/download-test.png`;
  const missing = '/assets/download-test-missing.png';
  let fixed = false, hanging = false;
  const counts = new Map();
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, assetIndex: false });
  // Keep synthetic responses on the actual HTTP server so browser caching stays enabled.
  const serve = srv.server.listeners('request')[0];
  srv.server.removeAllListeners('request');
  srv.server.on('request', (req, res) => {
    const url = req.url;
    if (url === '/data/assets.json' || url === '/data/local-assets.json' || url === '/data/local-fx.json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      // (local-fx.json: the host's official battle effects, DESIGN §33 — none in this fixture)
      res.end(JSON.stringify(url === '/data/assets.json' ? { files: [image, missing] } : { groups: {} }));
      return;
    }
    if (url === image || url === missing) {
      counts.set(url, (counts.get(url) || 0) + 1);
      if (hanging && url === missing) return;
      const ok = url === image || fixed;
      res.writeHead(ok ? 200 : 404, { 'Content-Type': 'image/png', 'Cache-Control': ok ? 'public, max-age=3600' : 'no-store' });
      res.end(ok ? png : 'missing');
      return;
    }
    serve.call(srv.server, req, res);
  });
  t.after(() => srv.close());
  const { default: puppeteer } = await import('puppeteer-core');
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(srv.url);
  await page.waitForSelector('[data-testid="asset-download"]');
  assert.equal(counts.size, 0, 'opening the homepage does not download the asset pack');
  if (process.env.SP_ASSET_SCREENSHOTS) {
    fs.mkdirSync(process.env.SP_ASSET_SCREENSHOTS, { recursive: true });
    await new Promise((resolve) => setTimeout(resolve, 500));
    await page.screenshot({ path: path.join(process.env.SP_ASSET_SCREENSHOTS, 'title.png') });
  }
  await page.click('[data-testid="asset-download"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="asset-download-status"]')?.textContent.includes('1 个素材下载失败'));
  assert.equal(await page.$eval('.asset-download [role="progressbar"]', (el) => el.getAttribute('aria-valuenow')), '1');
  assert.match(await page.$eval('.asset-download', (el) => el.textContent), /已就绪 1，缺少 1/);
  assert.equal(counts.get(image), 1);
  fixed = true;
  await page.click('[data-testid="asset-download-resume"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="asset-download-status"]')?.textContent.includes('本次素材下载完成'));
  assert.match(await page.$eval('.asset-download', (el) => el.textContent), /已就绪 2，缺少 0/);
  assert.equal(counts.get(image), 1, 'retry does not transfer a successful file again');
  assert.equal(await page.evaluate((url) => new Promise((resolve) => {
    const img = new Image(); img.onload = () => resolve(img.naturalWidth); img.onerror = () => resolve(0); img.src = url;
  }), image), 1);
  assert.equal(counts.get(image), 1, 'the renderer Image request reuses the downloaded HTTP cache');
  if (process.env.SP_ASSET_SCREENSHOTS) {
    fs.mkdirSync(process.env.SP_ASSET_SCREENSHOTS, { recursive: true });
    await new Promise((resolve) => setTimeout(resolve, 500));
    await page.screenshot({ path: path.join(process.env.SP_ASSET_SCREENSHOTS, 'complete.png') });
  }
  await page.keyboard.press('Escape');
  await page.reload();
  await page.waitForSelector('[data-testid="asset-download"]');
  const beforeReloadCheck = new Map(counts);
  await page.click('[data-testid="asset-download"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="asset-download-status"]')?.textContent.includes('本次素材下载完成'));
  assert.match(await page.$eval('.asset-download', (el) => el.textContent), /已就绪 2，缺少 0/);
  assert.deepEqual(counts, beforeReloadCheck, 'a fresh queue after reload reuses the HTTP cache');
  await page.keyboard.press('Escape');
  // 下载完整素材 and 导入素材包 side by side (ui/assetDownload.js, ui/assetImport.js): both inside the viewport, uncovered, on one
  // row, not overlapping, their hint lines clear of the footer — on a desktop and on a landscape phone
  for (const viewport of [{ width: 1280, height: 900 }, { width: 844, height: 390 }]) {
    await page.setViewport(viewport);
    const box = (sel) => page.$eval(sel, (el) => {
      const b = el.getBoundingClientRect();
      return { left: b.left, top: b.top, right: b.right, bottom: b.bottom,
        visible: el.contains(document.elementFromPoint((b.left + b.right) / 2, (b.top + b.bottom) / 2)) };
    });
    const download = await box('[data-testid="asset-download"]');
    const importer = await box('[data-testid="asset-import"]');
    for (const [name, bounds] of [['download', download], ['import', importer]]) {
      assert.ok(bounds.left >= 0 && bounds.right <= viewport.width && bounds.top >= 0 && bounds.bottom <= viewport.height, `${name} ${JSON.stringify(bounds)}`);
      assert.ok(bounds.visible, `the ${name} button is not covered`);
    }
    assert.ok(Math.abs(download.top - importer.top) < 1 && download.right <= importer.left, `side by side ${JSON.stringify({ download, importer })}`);
    const hints = await page.$$eval('.title-assets__item > small', (els) => els.map((el) => el.getBoundingClientRect().bottom));
    const foot = await page.$eval('.title-foot', (el) => [...el.children].map((c) => c.getBoundingClientRect())
      .filter((b) => b.width > 0).map((b) => ({ top: b.top, left: b.left, right: b.right })));
    const block = await page.$eval('.title-assets', (el) => el.getBoundingClientRect().toJSON());
    assert.equal(hints.length, 2, 'a hint line under each button');
    for (const f of foot) {
      const across = f.left < block.right && f.right > block.left;
      assert.ok(!across || Math.max(...hints) <= f.top, `the hints stay above the footer ${JSON.stringify({ hints, f })}`);
    }
    if (process.env.SP_ASSET_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.SP_ASSET_SCREENSHOTS, `title-${viewport.width}.png`) });
  }
  // A new browser context has an empty HTTP cache. Closing the dialog must stop a hanging request.
  const context = await browser.createBrowserContext();
  const other = await context.newPage();
  hanging = true;
  await other.goto(srv.url);
  await other.click('[data-testid="asset-download"]');
  await other.waitForFunction(async (size) => (await import('/js/assetDownload.js')).assetDownload.get().bytes === size, {}, png.length);
  await other.keyboard.press('Escape');
  await other.waitForFunction(async () => (await import('/js/assetDownload.js')).assetDownload.get().phase === 'paused');
  assert.equal(await other.evaluate(async () => (await import('/js/assetDownload.js')).assetDownload.get().done), 1);
  hanging = false;
  await other.click('[data-testid="asset-download"]');
  await other.waitForFunction(() => document.querySelector('[data-testid="asset-download-status"]')?.textContent.includes('本次素材下载完成'));
  assert.match(await other.$eval('.asset-download', (el) => el.textContent), /已就绪 2，缺少 0/);

  // A real local import plus one network success must both count as ready (#725).
  const mixedContext = await browser.createBrowserContext();
  const mixed = await mixedContext.newPage();
  await mixed.goto(srv.url);
  const imported = await mixed.evaluate(async (bytes) => {
    const { createAssetImport } = await import('/js/assetPack.js');
    const importer = createAssetImport();
    await importer.start({ type: 'files', files: [{ path: 'public/assets/download-test.png', read: async () => new Uint8Array(bytes) }] });
    return importer.get();
  }, [...png]);
  assert.equal(imported.accepted, 1);
  const beforeMixed = new Map(counts);
  await mixed.click('[data-testid="asset-download"]');
  await mixed.waitForFunction(() => document.querySelector('[data-testid="asset-download-status"]')?.textContent.includes('本次素材下载完成'));
  assert.equal(counts.get(image), beforeMixed.get(image), 'the imported file is not fetched');
  assert.equal(counts.get(missing), beforeMixed.get(missing) + 1, 'the remaining file comes from the server');
  assert.deepEqual(await mixed.evaluate(async () => {
    const { cached, done } = (await import('/js/assetDownload.js')).assetDownload.get();
    return { cached, done };
  }), { cached: 1, done: 2 });
  assert.match(await mixed.$eval('.asset-download', (el) => el.textContent), /已就绪 2，缺少 0/);
  assert.deepEqual(errors, []);
});
