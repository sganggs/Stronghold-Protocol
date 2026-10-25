// Actual file input, product delete button and native IndexedDB rollback.
// The failure case explicitly aborts the task's deletion transaction; no natural disk error claim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { startServer } from '../../server/index.js';
import { CHROME, OUT, hasChrome } from '../e2e/client.mjs';

const ENABLED = process.env.SP_E2E === '1' && hasChrome();

test('deleting lobby media changes its selection only after storage commits', {
  skip: !ENABLED && 'set SP_E2E=1 (and have Chrome)', timeout: 90000,
}, async t => {
  fs.mkdirSync(OUT, { recursive: true });
  const output = fs.mkdtempSync(path.join(OUT, 'lobby-media-delete-'));
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-media-delete-'));
  fs.mkdirSync(path.join(temp, 'plugins'));
  const log = { node: process.version, classification: 'actual local product UI, physical PNG and native IndexedDB; controlled transaction abort in failure case', cases: [] };
  const snapshot = page => page.evaluate(async () => {
    const { mediaStore } = await import('/js/ui/lobbyMedia.js');
    const { backdrop, prefs } = mediaStore.get();
    const stored = await new Promise((resolve, reject) => {
      const open = indexedDB.open('sp-lobby-media', 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result, tx = db.transaction('files', 'readonly');
        const req = tx.objectStore('files').get('backdrop');
        tx.oncomplete = () => { const r = req.result; resolve(r ? { name: r.name, size: r.blob.size } : null); db.close(); };
        tx.onabort = () => { reject(tx.error); db.close(); };
      };
    });
    return { backdrop: backdrop && { name: backdrop.name, size: backdrop.size }, prefs, stored,
      removeVisible: !!document.querySelector('[data-testid="media-backdrop-remove"]'),
      name: document.querySelector('[data-testid="media-backdrop-name"]')?.textContent,
      toasts: [...document.querySelectorAll('.toast')].map(e => e.textContent), abortEvents: globalThis.__mediaDeleteAbort || [] };
  });
  let srv, browser;
  try {
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, studio: false, pluginsDir: path.join(temp, 'plugins') });
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
    log.browser = await browser.version();
    const cdp = await browser.target().createCDPSession();
    log.arguments = (await cdp.send('Browser.getBrowserCommandLine')).arguments;
    await cdp.detach();
    assert.ok(log.arguments.every(a => !/no-sandbox|disable-setuid-sandbox|ignore-certificate-errors/.test(a)));
    for (const abort of [false, true]) {
      await t.test(abort ? 'an aborted deletion retains the file and reports failure; retry commits' : 'a committed deletion remains deleted after reload', async () => {
        const result = { abort, problems: [], screenshots: [] }; log.cases.push(result);
        const context = await browser.createBrowserContext();
        const page = await context.newPage();
        await page.setViewport({ width: 1440, height: 1000 });
        page.setDefaultTimeout(15000);
        page.on('pageerror', e => result.problems.push({ type: 'pageerror', message: e.message }));
        page.on('console', m => { if (['error', 'warning'].includes(m.type())) result.problems.push({ type: m.type(), message: m.text() }); });
        page.on('requestfailed', r => result.problems.push({ type: 'requestfailed', url: r.url(), failure: r.failure() }));
        page.on('response', r => { if (r.status() >= 400) result.problems.push({ type: 'http', status: r.status(), url: r.url() }); });
        const shot = async name => { const f = `${abort ? 'abort' : 'normal'}-${name}.png`; await page.screenshot({ path: path.join(output, f) }); result.screenshots.push(f); };
        try {
          await page.goto(srv.url, { waitUntil: 'domcontentloaded' });
          await page.waitForSelector('.title-login input'); await page.waitForSelector('#boot', { hidden: true });
          await page.locator('.title-login input').fill('删除存储验证'); await page.locator('.title-login button').click();
          await page.waitForSelector('.lobby-screen');
          await page.locator('[data-testid="lobby-media"]').click();
          const bytes = await page.evaluate(async () => {
            const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 64;
            const g = canvas.getContext('2d'); g.fillStyle = '#266577'; g.fillRect(0, 0, 96, 64);
            const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
            return [...new Uint8Array(await blob.arrayBuffer())];
          });
          const name = abort ? 'abort.png' : 'normal.png', file = path.join(temp, name);
          fs.writeFileSync(file, new Uint8Array(bytes));
          const input = await page.$('[data-testid="media-backdrop-file"]'); await input.uploadFile(file); await input.dispose();
          await page.waitForFunction(n => document.querySelector('[data-testid="media-backdrop-name"]')?.textContent === n, {}, name);
          result.before = await snapshot(page); await shot('before');
          if (abort) await page.evaluate(() => {
            const nativeDelete = IDBObjectStore.prototype.delete;
            globalThis.__mediaDeleteAbort = [];
            IDBObjectStore.prototype.delete = function (key) {
              const req = nativeDelete.call(this, key);
              if (this.transaction.db.name === 'sp-lobby-media' && this.name === 'files' && key === 'backdrop') {
                const tx = this.transaction;
                req.addEventListener('success', () => { globalThis.__mediaDeleteAbort.push({ key, at: performance.now() }); tx.abort(); });
                IDBObjectStore.prototype.delete = nativeDelete;
              }
              return req;
            };
          });
          await page.locator('[data-testid="media-backdrop-remove"]').click();
          if (abort) {
            await page.waitForFunction(() => globalThis.__mediaDeleteAbort?.length === 1);
            await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
          } else await page.waitForSelector('[data-testid="media-backdrop-remove"]', { hidden: true });
          result.afterDelete = await snapshot(page); await shot('after-delete');
          await page.reload({ waitUntil: 'domcontentloaded' });
          await page.waitForSelector('.lobby-screen'); await page.locator('[data-testid="lobby-media"]').click();
          await page.waitForSelector('[data-testid="media-backdrop-file"]');
          if (abort) await page.waitForSelector('[data-testid="media-backdrop-remove"]');
          result.afterReload = await snapshot(page); await shot('after-reload');
          if (abort) {
            await page.locator('[data-testid="media-backdrop-remove"]').click();
            await page.waitForSelector('[data-testid="media-backdrop-remove"]', { hidden: true });
            result.afterRetry = await snapshot(page);
            assert.deepEqual(result.afterDelete.backdrop, result.before.backdrop, 'a transaction rollback must not discard the selectable file');
            assert.equal(result.afterDelete.prefs.backdrop, true, 'a failed delete must not switch the persisted preference off');
            assert.equal(result.afterDelete.stored.name, name);
            assert.ok(result.afterDelete.toasts.some(s => /存储.*未能保存/.test(s)), 'a storage failure must be visible');
            assert.equal(result.afterReload.prefs.backdrop, true);
            assert.equal(result.afterRetry.stored, null, 'retry through the real UI must delete the row');
          } else {
            assert.equal(result.afterDelete.backdrop, null);
            assert.equal(result.afterDelete.stored, null);
            assert.equal(result.afterReload.stored, null);
            assert.equal(result.afterReload.removeVisible, false);
          }
          assert.deepEqual(result.problems.filter(p => p.type === 'pageerror'), []);
          result.passed = true;
        } catch (e) { result.failure = { message: e.message, actual: e.actual, expected: e.expected, stack: e.stack }; throw e; }
        finally { await context.close(); fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(log, null, 2) + '\n'); }
      });
    }
  } finally {
    await browser?.close(); await srv?.close(); fs.rmSync(temp, { recursive: true, force: true });
    log.ownedBrowserAndServerClosed = true;
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(log, null, 2) + '\n');
    t.diagnostic('Evidence: ' + output);
  }
});
