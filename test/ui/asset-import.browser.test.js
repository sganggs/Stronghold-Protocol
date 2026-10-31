// SP_E2E=1 node --test test/ui/asset-import.browser.test.js
// The title screen's 导入素材包 (ui/assetImport.js): opening its dialog asks the server for nothing (no art, no manifest,
// no download); a pack laid out like `node tools/package.mjs --assets` writes it (one folder, public/assets/…, a
// README.txt) goes in through the dialog's zip picker. Then a one-file zip and a folder-shaped file list are imported,
// and the server is not asked for those bytes, not even by 下载完整素材. A second page with isSecureContext forced off
// must say on the title screen and in the dialog why import is unavailable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../../server/index.js';
import { hash16 } from '../../server/http/assetIndex.js';
import { crc32 } from '../../public/js/assetPack.js';
import { CHROME, hasChrome } from '../e2e/client.mjs';

/** A zip of stored entries: `[{ name, raw }]`. */
function buildStoredZip(files) {
  const enc = new TextEncoder();
  const locals = [];
  const cds = [];
  let offset = 0;
  for (const { name, raw } of files) {
    const nameBytes = enc.encode(name);
    const crc = crc32(raw);
    const local = new Uint8Array(30 + nameBytes.length + raw.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x800, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, raw.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(raw, 30 + nameBytes.length);
    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x800, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, raw.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);
    locals.push(local);
    cds.push(cd);
    offset += local.length;
  }
  const cdSize = cds.reduce((n, part) => n + part.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + cdSize + 22);
  let p = 0;
  for (const part of [...locals, ...cds, eocd]) { out.set(part, p); p += part.length; }
  return out;
}

test('import has its own dialog that requests nothing on opening; imported art is not fetched again; plain HTTP explains why import is off', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 90000,
}, async (t) => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  const folderPng = Buffer.from('folder-png-bytes');
  const packPng = Buffer.from('pack-png-bytes');
  const zipUrl = `/assets/~${hash16(png)}/import-zip.png`;
  const folderUrl = `/assets/~${hash16(folderPng)}/import-folder.png`;
  const packUrl = `/assets/~${hash16(packPng)}/import-pack.png`;
  const missing = '/assets/import-missing.png';
  const counts = new Map();
  const requests = [];
  let probes = 0;
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, assetIndex: false });
  const serve = srv.server.listeners('request')[0];
  srv.server.removeAllListeners('request');
  srv.server.on('request', (req, res) => {
    const url = req.url.split('?')[0];
    requests.push(url);
    if (req.url.startsWith('/healthz')) probes++;
    // (local-fx.json: the host's official battle effects, DESIGN §33 — none in this fixture)
    if (url === '/data/assets.json' || url === '/data/local-assets.json' || url === '/data/local-fx.json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify(url === '/data/assets.json'
        ? { files: [zipUrl, folderUrl, packUrl, missing] }
        : { groups: {} }));
      return;
    }
    if (url === zipUrl || url === folderUrl || url === packUrl || url === missing) {
      counts.set(url, (counts.get(url) || 0) + 1);
      res.writeHead(url === missing ? 404 : 200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
      res.end(url === folderUrl ? folderPng : url === packUrl ? packPng : png);
      return;
    }
    serve.call(srv.server, req, res);
  });
  t.after(() => srv.close());
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-asset-import-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const { default: puppeteer } = await import('puppeteer-core');
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(srv.url);
  await page.waitForFunction(() => navigator.serviceWorker.controller != null, { timeout: 20000 });
  await page.waitForSelector('[data-testid="resource-manager-open"]');
  // a first gesture unlocks audio (public/js/audio.js): make it elsewhere, so what follows is the dialog's own traffic
  await page.click('.title-tag');
  await new Promise((resolve) => setTimeout(resolve, 500));
  const quiet = requests.length;
  await page.click('[data-testid="resource-manager-open"]');
	await page.click('[data-testid="resource-import"]');
  await page.waitForSelector('.asset-import-dialog [data-testid="asset-import-zip"]');
  await new Promise((resolve) => setTimeout(resolve, 800));
  const opening = requests.slice(quiet);
  assert.deepEqual(opening.filter((url) => /^\/(?:assets|media|fonts)\//.test(url)), [],
    'opening the manager and selecting import requests no art; the default voice section may read manifests');
  assert.equal(await page.$('.asset-download'), null, 'the download dialog stays closed');
  assert.deepEqual(await page.evaluate(async () => ({
    download: (await import('/js/assetDownload.js')).assetDownload.get().phase,
    import: (await import('/js/assetPack.js')).assetImport.get().phase,
  })), { download: 'idle', import: 'idle' });
  assert.ok(await page.$eval('.resource-manager', (box) => box.contains(document.activeElement)), 'the dialog holds the focus');

  // a pack laid out like `node tools/package.mjs --assets`, through the dialog's zip picker
  const packZip = path.join(tmp, 'Stronghold-Protocol-v9.9.9-assets.zip');
  fs.writeFileSync(packZip, buildStoredZip([
    { name: 'Stronghold-Protocol-v9.9.9-assets/README.txt', raw: new TextEncoder().encode('asset pack\n') },
    { name: 'Stronghold-Protocol-v9.9.9-assets/public/assets/import-pack.png', raw: packPng },
  ]));
  const picker = await page.$('[data-testid="asset-import-zip-input"]');
  await picker.uploadFile(packZip);
  await page.waitForFunction(() => document.querySelector('[data-testid="asset-import-status"]')?.textContent.includes('导入完成'));
  assert.match(await page.$eval('[data-testid="asset-import-counts"]', (el) => el.textContent), /已导入 1 个，校验不符 0 个，跳过 1 个，无法读取 0 个/);
  assert.equal(counts.get(packUrl) || 0, 0);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.asset-import-dialog'));

  const zip = buildStoredZip([{ name: 'Stronghold-Protocol/public/assets/import-zip.png', raw: png }]);
  const imported = await page.evaluate(async (zipB64, folderB64) => {
    const decode = (b64) => Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    const { createAssetImport } = await import('/js/assetPack.js');
    const imp = createAssetImport();
    await imp.start({ type: 'zip', data: decode(zipB64) });
    const zipState = imp.get();
    await imp.start({
      type: 'files',
      files: [{ path: 'public/assets/import-folder.png', read: async () => decode(folderB64) }],
    });
    return { zip: zipState, folder: imp.get() };
  }, Buffer.from(zip).toString('base64'), Buffer.from(folderPng).toString('base64'));
  assert.equal(imported.zip.phase, 'complete');
  assert.equal(imported.zip.accepted, 1);
  assert.equal(imported.folder.phase, 'complete');
  assert.equal(imported.folder.accepted, 1);
  const statuses = await page.evaluate(async (urls) => Promise.all(urls.map(async (url) => (await fetch(url)).status)), [zipUrl, folderUrl, packUrl]);
  assert.deepEqual(statuses, [200, 200, 200]);
  assert.equal(counts.get(zipUrl) || 0, 0);
  assert.equal(counts.get(folderUrl) || 0, 0);
  assert.equal(counts.get(packUrl) || 0, 0);
  const beforeProbe = probes;
  await page.evaluate(() => fetch('/healthz?import-probe=1'));
  assert.ok(probes > beforeProbe, 'a non-asset URL still reaches the server');

  await page.click('[data-testid="resource-manager-open"]');
	await page.click('[data-testid="resource-download"]');
	await page.click('[data-testid="asset-download-resume"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="asset-download-status"]')?.textContent.includes('1 个素材下载失败'));
  assert.equal(counts.get(zipUrl) || 0, 0, 'download skips the imported zip file');
  assert.equal(counts.get(folderUrl) || 0, 0, 'download skips the imported folder file');
  assert.equal(counts.get(packUrl) || 0, 0, 'download skips the file of the pack');
  assert.equal(counts.get(missing), 1);
  assert.equal(await page.$('.asset-download .asset-import__row'), null, 'the download dialog has no import controls');

  const insecure = await browser.newPage();
  await insecure.evaluateOnNewDocument(() => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false });
  });
  await insecure.goto(srv.url);
  await insecure.waitForSelector('[data-testid="resource-manager-open"]');
  await insecure.click('[data-testid="resource-manager-open"]');
	await insecure.click('[data-testid="resource-import"]');
  await insecure.waitForSelector('[data-testid="asset-import-unavailable"]');
  const reason = await insecure.$eval('[data-testid="asset-import-unavailable"]', (el) => el.textContent);
  assert.match(reason, /HTTPS/);
  assert.equal(await insecure.$('[data-testid="asset-import-folder"]'), null);
  assert.deepEqual(errors, []);
});
