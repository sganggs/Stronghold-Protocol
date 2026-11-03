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
