// SP_E2E=1 CHROME_PATH=<chrome> node --test test/ui/asset-index-concurrency.browser.test.js
// Two pages, actual CacheStorage and assetCache.js. Only page A's first index match is held after its real read,
// to give page B time to attempt the competing update. This is a controlled module test, not a UI timing claim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { CHROME, hasChrome } from '../e2e/client.mjs';

test('cross-tab index updates preserve imports and prune results', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 60000,
}, async (t) => {
  const module = fs.readFileSync(new URL('../../public/js/assetCache.js', import.meta.url));
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', req.url === '/assetCache.js' ? 'text/javascript' : 'text/html');
    res.end(req.url === '/assetCache.js' ? module : '<!doctype html><title>Import index test</title>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { default: puppeteer } = await import('puppeteer-core');
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const pages = await Promise.all([browser.newPage(), browser.newPage()]);
  for (const page of pages) {
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(async () => {
      globalThis.ac = await import('/assetCache.js');
      globalThis.a = '/assets/~1111111111111111/a.png';
      globalThis.b = '/fonts/~2222222222222222/b.woff2';
      globalThis.stale = '/assets/~0000000000000000/stale.png';
    });
  }
  const [first, second] = pages;
  // Both writes must survive. Prune must not replace a newer import with the old snapshot either.
  for (const [left, right] of [['add', 'add'], ['add', 'prune'], ['prune', 'add'], ['prune', 'prune']]) {
    await t.test(`${left}/${right}`, async () => {
      await first.evaluate(async (bothPrune) => {
        const { ac, a, b, stale } = globalThis;
        await caches.delete(ac.IMPORTED_ASSET_CACHE);
        const cache = await caches.open(ac.IMPORTED_ASSET_CACHE);
        await cache.put(a, new Response('A'));
        await cache.put(b, new Response('B'));
        await cache.put(stale, new Response('old'));
        await cache.put(ac.IMPORTED_INDEX_URL, Response.json(bothPrune ? [a, b, stale] : [stale]));
      }, left === 'prune' && right === 'prune');
      await first.evaluate((kind) => {
        const { ac, a } = globalThis;
        globalThis.held = false;
        const match = Cache.prototype.match;
        Cache.prototype.match = async function (request, ...args) {
          const hit = await match.call(this, request, ...args);
          if (request === ac.IMPORTED_INDEX_URL && !globalThis.held) {
            globalThis.held = true;
            await new Promise((resolve) => { globalThis.release = resolve; });
          }
          return hit;
        };
        globalThis.restore = () => { Cache.prototype.match = match; };
        globalThis.pending = kind === 'add'
          ? caches.open(ac.IMPORTED_ASSET_CACHE).then((cache) => ac.addImportedPaths(cache, [a]))
          : ac.pruneImportedPaths(new Set([a]));
      }, left);
      await first.waitForFunction(() => globalThis.held);
      await second.evaluate(({ kind, bothPrune }) => {
        const { ac, a, b } = globalThis;
        globalThis.settled = false;
        globalThis.pending = kind === 'add'
          ? caches.open(ac.IMPORTED_ASSET_CACHE).then((cache) => ac.addImportedPaths(cache, [b]))
          : ac.pruneImportedPaths(new Set(bothPrune ? [b] : [a, b]));
        globalThis.pending.finally(() => { globalThis.settled = true; });
      }, { kind: right, bothPrune: left === 'prune' && right === 'prune' });
      // B finishes on the unfixed code; with the lock it queues until A releases its real read.
      await second.waitForFunction(async () => globalThis.settled || (await navigator.locks.query()).pending.length > 0);
      await first.evaluate(() => { globalThis.release(); });
      await Promise.all(pages.map((page) => page.evaluate(() => globalThis.pending)));
      await first.evaluate(() => { globalThis.restore(); });
      const expected = left === 'add' && right === 'add' ? [
        '/assets/~0000000000000000/stale.png', '/assets/~1111111111111111/a.png', '/fonts/~2222222222222222/b.woff2',
      ] : left === 'add' && right === 'prune' ? ['/assets/~1111111111111111/a.png'] : left === 'prune' && right === 'add' ? ['/fonts/~2222222222222222/b.woff2'] : [];
      assert.deepEqual(await first.evaluate(async () => [...await globalThis.ac.listImportedPaths()].sort()), expected, `${left}/${right}`);
      const bodies = await second.evaluate(async () => {
        const { ac, a, b, stale } = globalThis;
        const cache = await caches.open(ac.IMPORTED_ASSET_CACHE);
        return Promise.all([a, b, stale].map(async (url) => (await cache.match(url))?.text() ?? null));
      });
      assert.deepEqual(bodies, left === 'prune' && right === 'prune' ? [null, null, null] : ['A', 'B', left === 'add' && right === 'add' ? 'old' : null]);
    });
  }
});
