import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const enabled = process.env.RENDER_E2E === '1' && existsSync(CHROME);
const art = existsSync(new URL('../../public/assets/local/map/autochess/TX_autochessi_D.png', import.meta.url));
describe('renderer recovery after transient resource failures', { skip: !enabled }, () => {
  let srv, browser, serverRun = false;
  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const { Match } = await import('../../server/match/Match.js');
    class RecoveryMatch extends Match { constructor(opts) { super({ ...opts, clientCombat: !serverRun }); } }
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, MatchClass: RecoveryMatch, seedFn: () => 123 });
    const P = (await import('puppeteer-core')).default;
    browser = await P.launch({ executablePath: CHROME, headless: true,
      args: ['--no-first-run', '--no-proxy-server', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : []), '--enable-gpu', '--ignore-gpu-blocklist'] });
    mkdirSync(new URL('../e2e/out/', import.meta.url), { recursive: true });
  });
  after(async () => { await browser?.close(); await srv?.close(); });

  for (const streamed of [false, true]) test(`a live ${streamed ? 'server' : 'local'} battle survives renderer replacement with current enemy metadata`, { timeout: 45000 }, async (t) => {
    serverRun = streamed;
    const context = await browser.createBrowserContext(), page = await context.newPage(); let failing = true;
    try {
      await page.setRequestInterception(true);
      page.on('request', req => {
        if (failing && new URL(req.url()).pathname === '/vendor/pixi.min.js') void req.abort('failed'); else void req.continue();
      });
      await page.evaluateOnNewDocument(() => { localStorage.setItem('sp.name', 'Recovery'); sessionStorage.setItem('sp.entered', '1'); });
      // Match readiness is asserted below; unrelated title art/audio must not hold the page's load event open.
      await page.goto(`http://127.0.0.1:${srv.port}/?board=2d`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__SP__?.store.get().connection.status === 'online');
      const send = async (type, args = {}) => {
        const response = await page.evaluate(async (t, a) => (await import('/js/net.js')).net.request(t, a), type, args);
        assert.equal(response.t, 'ok', `${type}: ${response.code || ''}`);
        console.info(`[recovery] ${type} accepted`);
        return response;
      };
      await send('room.create', { mode: 'solo', difficulty: 'FUNNY' }); await send('room.start');
      await page.waitForFunction(() => window.__SP__.store.get().match.public?.phase === 'INFO_CHECK');
      await send('g.infoReady', { setupRevision: 0 });
      await page.waitForFunction(() => window.__SP__.store.get().match.public?.phase === 'BAND_DRAFT');
      await send('g.band', { bandId: 'band_bldsk' });
      await page.waitForFunction(() => window.__SP__.store.get().match.public?.phase === 'PREP');
      await page.waitForFunction(() => window.__SP_VIEW__?.kind === 'fallback');
      await send('g.ready', { ready: true });
      await page.waitForSelector('.ff-unit.is-enemy:not(.ff-pen__enemy)');
      const code = await page.evaluate(() => window.__SP__.store.get().room.code);
      const match = srv.lobby.rooms.get(code).match;
      const serverBattle = streamed ? match.fields[0].battle : null;
      const serverTime = serverBattle?.time;
      const enemies = streamed ? match.fields[0].battle.enemies.filter(e => e.alive).map(e => [e.id, e.defId])
        : await page.evaluate(async () => {
          const runner = (await import('/js/battle/runner.js')).battleRunner;
          const entry = [...runner._entries.values()].find(e => e.battle && !e.done);
          window.__originalBattle = entry.battle; window.__originalTime = entry.battle.time;
          return entry.battle.enemies.filter(e => e.alive).map(e => [e.id, e.defId]);
        });
      assert.ok(enemies.length > 0, 'enemies spawned after the original field metadata');
      failing = false; await page.evaluate(() => window.dispatchEvent(new Event('online')));
      await page.waitForFunction(() => window.__SP_VIEW__?.kind === 'engine', { timeout: 15000 });
      await page.waitForFunction(([id, defId]) => {
        const v = window.__SP_VIEW__.raw;
        return v.stats().mode === 'battle' && v.debug.views.get(id)?.info.defId === defId;
      }, { timeout: 7000 }, enemies[0]);
      assert.equal(srv.lobby.rooms.get(code).match, match, 'renderer recovery never restarts the match');
      if (streamed) {
        assert.equal(match.fields[0].battle, serverBattle); assert.ok(serverBattle.time >= serverTime);
      } else {
        assert.equal(await page.evaluate(async () => {
          const runner = (await import('/js/battle/runner.js')).battleRunner;
          return [...runner._entries.values()].some(e => e.battle === window.__originalBattle && e.battle.time >= window.__originalTime);
        }), true, 'the same local simulation continues from its current clock');
      }
      await send('g.leave');
    } finally {
      t.diagnostic(JSON.stringify(await page.evaluate(() => ({
        phase: window.__SP__?.store.get().match.public?.phase, kind: window.__SP_VIEW__?.kind,
      })).catch(() => ({}))));
      await context.close();
    }
  });

  for (const forced of [false, true]) test(`field hook retries a failed Pixi download; forced fallback=${forced}`, async () => {
    const page = await browser.newPage(); let pixiRequests = 0, failing = true;
    try {
      await page.setRequestInterception(true);
      page.on('request', req => {
        const pixi = new URL(req.url()).pathname === '/vendor/pixi.min.js';
        if (pixi) pixiRequests++;
        if (pixi && failing) void req.abort('failed'); else void req.continue();
      });
      await page.goto(`http://127.0.0.1:${srv.port}/?${forced ? 'render=fallback&' : ''}board=2d`);
      await page.evaluate(async () => {
        const { render, h } = await import('/vendor/preact.module.js');
        const { useRef, useEffect } = await import('/vendor/hooks.module.js');
        const { useFieldView } = await import('/js/ui/fieldHost.js');
        const { data } = await import('/js/data.js');
        await data.loadAll('stages', 'chess', 'assets', 'local');
        function Harness() {
          const host = useRef(null), state = useFieldView(host);
          useEffect(() => {
            if (!state.view) return;
            state.view.setStage(data.lookup('stages', 'act2autochess_m01'));
            state.view.setPrep({ playerId: 'p', board: [], hand: [] });
          }, [state.view]);
          return h('div', { ref: host, id: 'recovery-host', style: 'width:100vw;height:100vh' });
        }
        render(h(Harness), document.getElementById('app'));
        window.__unmount = () => render(null, document.getElementById('app'));
      });
      await page.waitForFunction(() => window.__SP_VIEW__?.kind === 'fallback');
      const before = pixiRequests; failing = false;
      await page.evaluate(() => {
        window.__firstView = window.__SP_VIEW__;
        for (let i = 0; i < 5; i++) window.dispatchEvent(new Event('online'));
      });
      if (forced) {
        assert.equal(await page.evaluate(() => window.__SP_VIEW__ === window.__firstView), true);
        assert.equal(pixiRequests, before, 'explicit fallback never requests an engine retry');
      } else {
        await page.waitForFunction(() => window.__SP_VIEW__?.kind === 'engine', { timeout: 20000 });
        assert.equal(pixiRequests, before + 1, 'one successful retry after the failed prefetch and initialization');
        const result = await page.evaluate(() => {
          const view = window.__SP_VIEW__;
          for (let i = 0; i < 5; i++) document.dispatchEvent(new Event('visibilitychange'));
          return { same: view === window.__SP_VIEW__, canvases: document.querySelectorAll('#recovery-host canvas').length,
            field: view.raw.stats().mode };
        });
        assert.deepEqual(result, { same: true, canvases: 1, field: 'prep' });
      }
      await page.evaluate(() => window.__unmount());
      assert.equal(await page.evaluate(() => window.__SP_VIEW__), null, 'unmount releases the recovery view');
    } finally { await page.close(); }
  });

  for (const resource of ['atlas', 'three']) test(`${resource} download can recover the 3D board on visibility`, { skip: !art }, async () => {
    const page = await browser.newPage(); let failing = true, requests = 0;
    try {
      // the imported-art service worker (public/sw.js, PR #628 — registered by an earlier page of this origin) would
      // fetch the hashed atlas itself, past this page's request interception
      await page.setBypassServiceWorker(true);
      await page.setRequestInterception(true);
      page.on('request', req => {
        const p = new URL(req.url()).pathname;
        const selected = resource === 'atlas' ? /\/TX_autochessi_D\.(?:png|webp)$/.test(p) : p === '/vendor/three.module.js';
        if (selected) requests++;
        if (selected && failing) void req.abort('failed'); else void req.continue();
      });
      await page.setViewport({ width: 1280, height: 720 });
      await page.goto(`http://127.0.0.1:${srv.port}/dev/render-demo.html?scene=prep&stage=act2autochess_m01&board=3d&panel=0`);
      await page.waitForFunction(() => window.__demo?.ready, { timeout: 30000 });
      assert.equal(await page.evaluate(() => window.__demo.stats().board3d.on), false);
      const before = requests; failing = false;
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await page.waitForFunction(() => window.__demo.stats().board3d.on, { timeout: 15000 });
      assert.ok(requests > before, 'the failed resource is actually requested again');
      assert.equal(await page.evaluate(() => window.__demo.view.debug.app.view.parentNode.querySelectorAll('canvas').length), 2);
      await page.screenshot({ path: fileURLToPath(new URL(`../e2e/out/recovery-${resource}.png`, import.meta.url)) });
    } finally { await page.close(); }
  });
});
