// Browser smoke of the M1 transport page (PRD M1, headless Chrome): /dev/transport.html drives
// net.js through shared/transport.js against the in-page host. The loopback section is hermetic —
// no signalling server, no internet — so it runs anywhere Chrome runs. The p2p/WebRTC section of
// the same page is covered by test/transport/webrtc.test.js (FakePeer) plus a manual run against
// the public PeerJS cloud; it is left out here to keep the suite offline-safe.
// SP_E2E=1 CHROME_PATH=/path/to/chrome node --test test/transport/transport.e2e.test.js
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);

describe('transport smoke page (headless Chrome)', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome) to run' }, () => {
  let srv, browser;
  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--no-proxy-server'] });
  });
  after(async () => { await browser?.close(); await srv?.close(); });

  test('loopback: handshake to online, request resolves, a 120 KB frame round trips', async (t) => {
    const page = await browser.newPage();
    t.after(() => page.close());
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const text = (id) => page.$eval(id, (el) => el.textContent);
    await page.goto(`http://127.0.0.1:${srv.port}/dev/transport.html`, { waitUntil: 'load' });
    assert.match(await page.title(), /Transport/, 'the dev page loaded');

    await page.click('#lbHost');
    await page.click('#lbConnect');
    await page.waitForFunction(() => document.getElementById('lbState').textContent.startsWith('online'), { timeout: 5000 });
    assert.match(await text('#lbState'), /^online/, 'Net online over loopback:');

    await page.click('#lbReq');
    await page.waitForFunction(() => document.getElementById('lbLog').textContent.includes('ok rid='), { timeout: 5000 });
    assert.match(await text('#lbLog'), /← ok rid=\d+/, 'the request round trip resolved');

    // The host answers with ~120 KB (UTF-8) — one message in-process (loopback does not chunk by default).
    await page.click('#lbBig');
    await page.waitForFunction(() => /KB in \d+ ms/.test(document.getElementById('lbLog').textContent), { timeout: 8000 });
    assert.match(await text('#lbLog'), /← \d+ KB in \d+ ms \(loopback/, 'the big frame arrived whole');

    await page.click('#lbClose');
    await page.waitForFunction(() => document.getElementById('lbState').textContent.startsWith('closed'), { timeout: 5000 });
    assert.deepEqual(errors, [], 'no uncaught page errors');
  });
});
