// SP_E2E=1 CHROME_PATH=<chrome> node --test test/ui/resource-check.browser.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../../server/index.js';
import { CHROME, hasChrome } from '../e2e/client.mjs';

test('real cache-only misses, with and without the real service worker, never request resource bytes', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 60000,
}, async t => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, assetIndex: false });
  t.after(() => srv.close());
  const requests = [];
  const serve = srv.server.listeners('request')[0];
  srv.server.removeAllListeners('request');
  srv.server.on('request', (req, res) => {
    if (/^\/(assets|media|fonts)\//.test(req.url)) requests.push(req.url);
    if (req.url === '/resource-check-fixture') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Resource check</title>'); return; }
    if (req.url === '/data/assets.json') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ image: '/assets/~0123456789abcdef/cold.png', font: '/fonts/~0123456789abcdef/cold.woff2', plain: '/assets/cold.png',
        audio: { voice: { char_cold: { select: '/assets/~0123456789abcdef/audio/voice/cn/char_cold/a.mp3' } } } })); return;
    }
    if (['/data/local-assets.json', '/data/local-fx.json'].includes(req.url)) { res.writeHead(404); res.end(); return; }
    serve.call(srv.server, req, res);
  });
  const { default: puppeteer } = await import('puppeteer-core');
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(`${srv.url}/resource-check-fixture`);
  for (const controlled of [false, true]) {
    if (controlled) {
      await page.evaluate(async () => {
        await navigator.serviceWorker.register('/sw.js');
        await navigator.serviceWorker.ready;
        if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
      });
    }
    const report = await page.evaluate(async () => {
      for (const key of await caches.keys()) await caches.delete(key);
      const { checkResources } = await import('/js/resourceCheck.js');
      return checkResources(); // Native fetch and Cache Storage; no request interception or mocks.
    });
    assert.equal(report.complete, false);
    assert.equal(report.nonVoice.ready, 0);
    assert.equal(report.voices.ready, 0);
    assert.deepEqual(report.unverified, []);
    assert.deepEqual(requests, [], `no resource network requests (worker controlled: ${controlled})`);
  }
});

test('under the real worker, a file that is only in the HTTP cache counts and nothing is fetched', {
  skip: process.env.SP_E2E !== '1' || !hasChrome(), timeout: 60000,
}, async t => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  const hashed = '/assets/~0123456789abcdef/warm.png';
  const plain = '/assets/warm-plain.png';
  const cached = new Set([hashed, plain]);
  const requests = [];
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, assetIndex: false });
  t.after(() => srv.close());
  const serve = srv.server.listeners('request')[0];
  srv.server.removeAllListeners('request');
  srv.server.on('request', (req, res) => {
    if (cached.has(req.url)) {
      requests.push(req.url);
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': String(png.length),
        'Cache-Control': 'public, max-age=3600',
      });
      res.end(png);
      return;
    }
    if (/^\/(assets|media|fonts)\//.test(req.url)) { requests.push(req.url); res.writeHead(404); res.end(); return; }
    if (req.url === '/resource-check-fixture') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Resource check</title>'); return; }
    if (req.url === '/data/assets.json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({
        image: hashed, plain,
        audio: { voice: { char_warm: { select: '/assets/audio/voice/cn/char_warm/a.mp3' } } },
      }));
      return;
    }
    if (['/data/local-assets.json', '/data/local-fx.json'].includes(req.url)) { res.writeHead(404); res.end(); return; }
    serve.call(srv.server, req, res);
  });
  const { default: puppeteer } = await import('puppeteer-core');
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setCacheEnabled(true);
  await page.goto(`${srv.url}/resource-check-fixture`);
  const warmed = await page.evaluate(async (urls) => {
    const out = [];
    for (const url of urls) {
      const response = await fetch(url);
      out.push([response.status, (await response.arrayBuffer()).byteLength]);
    }
    return out;
  }, [hashed, plain]);
  assert.deepEqual(warmed, [[200, png.length], [200, png.length]]);
  assert.deepEqual(requests, [hashed, plain]);
  const fromHttpCache = await page.evaluate(async (urls) => {
    const out = [];
    for (const url of urls) {
      const response = await fetch(url, { cache: 'only-if-cached', mode: 'same-origin' });
      out.push(response.status);
    }
    return out;
  }, [hashed, plain]);
  assert.deepEqual(fromHttpCache, [200, 200], 'the files are in the HTTP cache before the worker controls the page');
  assert.deepEqual(requests, [hashed, plain], 'reading the HTTP cache did not touch the network');
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    }
    for (const key of await caches.keys()) await caches.delete(key);
  });
  const report = await page.evaluate(async () => {
    const { checkResources } = await import('/js/resourceCheck.js');
    return checkResources();
  });
  assert.equal(report.nonVoice.ready, 2);
  assert.deepEqual(report.nonVoice.missing, []);
  assert.equal(report.voices.ready, 0, 'the uncached dub is still missing');
  assert.equal(report.complete, false);
  assert.deepEqual(report.unverified, []);
  assert.deepEqual(requests, [hashed, plain], 'the worker-controlled check does not fetch HTTP-cached files or cache misses');
});
