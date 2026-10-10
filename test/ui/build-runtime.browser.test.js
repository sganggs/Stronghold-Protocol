// Issue #343: a page keeps the browser simulator in its module map across a server restart.
// Exercise the real server, WebSocket client, simulator loader, route selector and build guard in Chrome.
// Only a throwaway install changes; no game assets or tracked runtime files are modified.
// Run: SP_E2E=1 node --test test/ui/build-runtime.browser.test.js (CHROME_PATH overrides system Chrome).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const enabled = process.env.SP_E2E === '1' && fs.existsSync(CHROME);

const PAGE = `<!doctype html><title>Build runtime regression</title><link rel="icon" href="data:,">
<h1>Build runtime regression</h1><p id="state">Loading simulator</p>
<button id="battle">Start battle</button><button id="result">Show settlement</button><button id="lobby">Return to lobby</button>
<script type="module">
import { startBuildGuard } from '/js/ui/buildGuard.js';
import { Net } from '/js/net.js';
import { store, selectRoute, emptyMatch } from '/js/store.js';
import { PHASE } from '/shared/constants.js';
import { loadBrowserSim } from '/js/battle/runner.js';

const boots = Number(sessionStorage.getItem('boots') || 0) + 1;
sessionStorage.setItem('boots', String(boots));
store.patch('session', { entered: true });
const sim = await loadBrowserSim();
let fingerprint = null;
const render = () => {
  document.querySelector('#state').textContent = JSON.stringify({ boots, route: selectRoute(store.get()),
    phase: store.get().match.public?.phase, stale: store.get().ui.buildStale, fingerprint });
};
store.subscribe(render);
document.querySelector('#battle').onclick = () => {
  const spec = sim.spec.buildBattleSpec({ seed: 91, content: 'none' });
  const battle = sim.spec.createBattleFromSpec(spec, sim.ds, { quiet: true });
  fingerprint = battle.rng();
  store.patch('match', { public: { phase: PHASE.COMBAT } });
};
document.querySelector('#result').onclick = () => store.patch('match', { public: { phase: PHASE.RESULT } });
document.querySelector('#lobby').onclick = () => store.set({ match: emptyMatch(), room: null });
const net = new Net();
net.setName('Build test');
const guard = startBuildGuard({
  intervalMs: 3600000,
  inMatch: () => selectRoute(store.get()) === 'game',
  onStale: ({ waiting }) => { if (waiting) store.patch('ui', { buildStale: true }); },
});
window.fixture = { guard, net, state: () => ({ boots, fingerprint, route: selectRoute(store.get()),
  stale: store.get().ui.buildStale, known: guard.known(), connection: net.status }) };
render();
</script>`;

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-build-browser-'));
  for (const rel of ['server', 'shared', 'data', 'public/js', 'public/css', 'public/index.html',
    'public/vendor/hooks.module.js', 'public/vendor/preact.module.js', 'package.json']) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.cpSync(path.join(ROOT, rel), path.join(root, rel), { recursive: true });
  }
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(root, 'node_modules'), 'junction');
  fs.mkdirSync(path.join(root, 'public/dev'), { recursive: true });
  fs.writeFileSync(path.join(root, 'public/dev/build-runtime.html'), PAGE);
  fs.writeFileSync(path.join(root, 'start.mjs'), `
import { startServer } from './server/index.js';
const srv = await startServer({ port: Number(process.env.PORT), host: '127.0.0.1', quiet: true });
process.send({ port: srv.port });
process.on('SIGTERM', async () => { await srv.close(); process.exit(0); });
`);
  return root;
}

async function start(root, port = 0) {
  const child = fork(path.join(root, 'start.mjs'), [], {
    cwd: root, env: { ...process.env, PORT: String(port) }, silent: true,
  });
  let stderr = '';
  child.stderr.on('data', (buf) => { stderr += buf; });
  try {
    const [ready] = await once(child, 'message', { signal: AbortSignal.timeout(15000) });
    return { port: ready.port, stop: async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    } };
  } catch (error) {
    child.kill('SIGKILL');
    throw new Error(`Fixture server failed to start: ${stderr}`, { cause: error });
  }
}

test('an old simulator page reconnects safely, then reloads before the next match after a runtime-only deploy', {
  skip: enabled ? false : 'set SP_E2E=1 (needs Chrome)', timeout: 120000,
}, async () => {
  const root = fixture();
  let server, browser;
  try {
    server = await start(root);
    const port = server.port;
    const puppeteer = (await import('puppeteer-core')).default;
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, protocolTimeout: 30000,
      args: ['--no-first-run', '--no-sandbox'] });
    const page = await browser.newPage();
    const problems = [];
    let navigations = 0, simRequests = 0, plannedOutage = false;
    page.on('pageerror', (error) => problems.push(error.message));
    page.on('console', (message) => {
      // Only the fixture's deliberate outages may produce these transport errors. Record the same errors
      // during normal operation, and always retain application errors (including pageerror above).
      const outageTransport = plannedOutage && /net::ERR_(?:CONNECTION_(?:REFUSED|RESET)|SOCKET_NOT_CONNECTED)|WebSocket connection to .* failed/.test(message.text());
      if (message.type() === 'error' && !outageTransport) problems.push(message.text());
    });
    page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) navigations++; });
    page.on('request', (request) => { if (new URL(request.url()).pathname === '/sim/rng.js') simRequests++; });
    await page.goto(`http://127.0.0.1:${port}/dev/build-runtime.html`);
    const ready = async () => {
      try { await page.waitForFunction(() => window.fixture?.guard.known() && window.fixture.net.status === 'online'); }
      catch (error) { throw new Error(`Fixture page failed: ${JSON.stringify(problems)}`, { cause: error }); }
    };
    const state = () => page.evaluate(() => window.fixture.state());
    const check = () => page.evaluate(() => window.fixture.guard.check());
    await ready();
    assert.equal(await page.title(), 'Build runtime regression');
    await page.click('#battle');
    const old = await state();
    assert.equal(old.route, 'game');
    assert.equal(simRequests, 1, 'the first match imported the actual simulator');

    plannedOutage = true;
    await server.stop();
    await page.waitForFunction(() => window.fixture.net.status === 'reconnecting');
    assert.equal((await check()).status, 'unknown', 'a stopped server never causes a mid-match reload');
    await page.click('#lobby');
    assert.equal((await check()).status, 'unknown', 'a stopped server never causes an outside-match reload either');
    assert.equal(navigations, 1);
    await page.click('#battle');

    // Change an actual simulator dependency, retaining its size to exercise the mtime portion of the build tag.
    const rngPath = path.join(root, 'server/sim/rng.js');
    const source = fs.readFileSync(rngPath, 'utf8');
    assert.match(source, /0x6d2b79f5/);
    const stat = fs.statSync(rngPath);
    fs.writeFileSync(rngPath, source.replace('0x6d2b79f5', '0x6d2b79f4'));
    fs.utimesSync(rngPath, stat.atime, new Date(stat.mtimeMs + 5000));
    const { createRng } = await import(pathToFileURL(rngPath).href);
    const freshFingerprint = createRng(91)();
    assert.notEqual(freshFingerprint, old.fingerprint);

    server = await start(root, port);
    await ready();
    plannedOutage = false;
    assert.equal((await state()).boots, 1, 'the original page actually reconnected');
    assert.equal((await state()).fingerprint, old.fingerprint, 'the already loaded simulator still has old code');
    assert.equal(simRequests, 1, 'reconnect does not refetch an imported ES module');
    assert.equal((await check()).status, 'new', 'the restarted server advertises the simulator-only deploy');
    assert.equal((await state()).stale, false, 'one new tag is not confirmation');
    assert.equal((await check()).status, 'stale');
    assert.equal((await state()).stale, true, 'confirmed update is exposed to the in-match banner');
    assert.equal(navigations, 1, 'a confirmed update never interrupts combat');
    await page.click('#result');
    assert.equal((await check()).status, 'stale');
    assert.equal(navigations, 1, 'settlement also remains on screen');

    // Even an already-confirmed update must wait while the server is unavailable.
    plannedOutage = true;
    await server.stop();
    await page.click('#lobby');
    assert.equal((await check()).status, 'unknown');
    assert.equal(navigations, 1);
    server = await start(root, port);
    await ready();
    plannedOutage = false;
    assert.equal((await check()).status, 'new', 'the failed check resets consecutive confirmations');
    assert.equal(navigations, 1, 'one successful check after downtime is insufficient');
    await Promise.all([
      page.waitForNavigation(),
      page.evaluate(() => { window.fixture.guard.check(); }),
    ]);
    await ready();
    assert.equal(navigations, 2, 'the confirmed healthy build reloads exactly once in the lobby');
    assert.equal((await state()).boots, 2);
    assert.notEqual((await state()).known, old.known);
    await page.click('#battle');
    assert.equal((await state()).fingerprint, freshFingerprint, 'the next battle uses the updated simulator');
    assert.equal(simRequests, 2, 'the real reload creates a fresh module map');
    assert.equal((await check()).status, 'current', 'the refreshed page does not enter a reload loop');
    assert.equal(navigations, 2);
    assert.deepEqual(problems, []);
    if (process.env.SP_BUILD_SCREENSHOT) await page.screenshot({ path: process.env.SP_BUILD_SCREENSHOT });
  } finally {
    await browser?.close();
    await server?.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
