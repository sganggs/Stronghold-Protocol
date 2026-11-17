import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const executable = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const art = existsSync(new URL('../../data/local-assets.json', import.meta.url)) &&
  ['png', 'webp'].some(ext => existsSync(new URL(`../../public/assets/local/map/autochess/TX_autochessi_D.${ext}`, import.meta.url)));
function rendered() {
  const view = window.__SP_VIEW__, state = window.__SP__?.store.get();
  if (view?.kind !== 'engine' || !view.raw.stats().board3d.on) return false;
  const id = state?.match.public?.stageId;
  const listed = window.__SP__.data.get('local')?.groups?.[`scene/${id}`];
  return !listed || view.raw.debug.board3d.scenePacks.has(id);
}
for (const delayed of [false, true]) test(`closing and reopening a real match restores its scene and operator models (delayed=${delayed})`, {
  skip: process.env.RENDER_E2E !== '1' || !existsSync(executable) || !art, timeout: 240000,
}, async t => {
  const { startServer } = await import('../../server/index.js');
  const puppeteer = (await import('puppeteer-core')).default;
  // This fixture tests renderer recovery, not the background hash scan of every installed art file.
  const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, assetIndex: false, seedFn: () => 123 });
  const base = `http://127.0.0.1:${server.port}`;
  console.info(`[reconnect] Testing ${base}`);
  const browser = await puppeteer.launch({ executablePath: executable, headless: true,
    args: ['--no-first-run', '--no-proxy-server', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const context = await browser.createBrowserContext();
  let page;
  const diagnostics = [];
  const open = async (delayed = false) => {
    console.info(`[reconnect] Opening page delayed=${delayed}`);
    const p = await context.newPage();
    p.setDefaultTimeout(60000);
    await p.setViewport({ width: 1280, height: 720 });
    p.on('console', message => {
      if (['warn', 'warning', 'error'].includes(message.type())) diagnostics.push(message.text().slice(0, 400));
    });
    p.on('pageerror', error => diagnostics.push(error.message));
    p.on('requestfailed', request => diagnostics.push(`${new URL(request.url()).pathname}: ${request.failure()?.errorText}`));
    p.on('response', response => { if (response.status() >= 400) diagnostics.push(`HTTP ${response.status()} ${new URL(response.url()).pathname}`); });
    if (delayed) await p.evaluateOnNewDocument(() => {
      // Delay this real script's start, without intercepting unrelated module/data requests or changing visibility.
      const append = Node.prototype.appendChild;
      let held = false;
      Node.prototype.appendChild = function (child) {
        if (!held && child instanceof HTMLScriptElement && new URL(child.src, location.href).pathname === '/vendor/pixi.min.js') {
          held = true; setTimeout(() => append.call(this, child), 16000); return child;
        }
        return append.call(this, child);
      };
    });
    await p.evaluateOnNewDocument(() => {
      localStorage.setItem('sp.name', '重连渲染自检'); sessionStorage.setItem('sp.entered', '1');
    });
    await p.bringToFront();
    await p.goto(`${base}/?board=3d`, { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.__SP__?.store.get().connection.status === 'online');
    console.info(`[reconnect] Connected delayed=${delayed}`);
    return p;
  };
  const send = (type, args = {}) => page.evaluate(async (name, payload) => (await import('/js/net.js')).net.request(name, payload), type, args);
  const stats = () => page.evaluate(async () => ({
    kind: window.__SP_VIEW__?.kind, stats: window.__SP_VIEW__?.raw.stats?.(),
    actors: [...(window.__SP_VIEW__?.raw.debug?.views?.values() || [])].filter(v => v.spineReady).length,
    phase: window.__SP__?.store.get().match.public?.phase,
    data: Object.fromEntries(['assets', 'local', 'chess', 'stages', 'backups'].map(name => [name, window.__SP__?.data?.status?.(name)])),
  }));
  try {
    page = await open();
    await send('room.create', { mode: 'solo', difficulty: 'FUNNY' });
    await send('room.start');
    await page.waitForFunction(() => window.__SP__.store.get().match.public?.phase === 'INFO_CHECK');
    await send('g.infoReady', { setupRevision: 0 });
    await page.waitForFunction(() => window.__SP__.store.get().match.public?.phase === 'BAND_DRAFT');
    await send('g.band', { bandId: 'band_bldsk' });
    await page.waitForFunction(() => window.__SP__.store.get().match.public?.phase === 'PREP');
    await send('g.buy', { slot: 0 });
    await page.waitForFunction(rendered, { timeout: 60000 });
    await page.waitForFunction(() => [...window.__SP_VIEW__.raw.debug.views.values()].some(v => v.spineReady));
    const identity = await page.evaluate(() => ({ id: window.__SP__.store.get().me.playerId, code: window.__SP__.store.get().room.code }));
    t.diagnostic(`Initial ${JSON.stringify(await stats())}`);
    {
      await page.close();
      // Closing a page and receiving its socket close are asynchronous. Do not race the seat's noReplace guard.
      const closedBy = Date.now() + 5000;
      while (server.registry.byId(identity.id)?.connected && Date.now() < closedBy) await new Promise(r => setTimeout(r, 25));
      assert.equal(server.registry.byId(identity.id)?.connected, false);
      page = await open(delayed);
      // A fresh tab in 0.3.0 explicitly recovers a saved seat; do not bypass the normal identity/claim checks.
      await page.waitForFunction(code => window.__SP__.store.get().room?.code === code ||
        document.querySelector('[data-testid="resume-local-match"]'), {}, identity.code);
      if (await page.$('[data-testid="resume-local-match"]')) {
        await page.click('[data-testid="resume-local-match"]');
        // The button opens a chooser; select the saved room through its real UI, not an identity/token override.
        await page.waitForFunction(code => [...document.querySelectorAll('[role="dialog"] button')]
          .some(b => b.textContent.includes(code)), {}, identity.code);
        await page.evaluate(code => [...document.querySelectorAll('[role="dialog"] button')]
          .find(b => b.textContent.includes(code)).click(), identity.code);
      }
      console.info(`[reconnect] Reclaiming saved seat delayed=${delayed}`);
      await page.waitForFunction(({ id, code }) => {
        const state = window.__SP__.store.get(); return state.me.playerId === id && state.room?.code === code && state.match.public?.phase === 'PREP';
      }, {}, identity);
      await page.waitForFunction(rendered, { timeout: 60000 });
      await page.waitForFunction(() => [...window.__SP_VIEW__.raw.debug.views.values()].some(v => v.spineReady));
      t.diagnostic(`Reopened delayed=${delayed}: ${JSON.stringify(await stats())}`);
    }
    assert.equal((await stats()).kind, 'engine');
  } finally {
    if (page && !page.isClosed()) {
      mkdirSync(new URL('../e2e/out/', import.meta.url), { recursive: true });
      await page.screenshot({ path: fileURLToPath(new URL('../e2e/out/reconnect-render.png', import.meta.url)) }).catch(() => {});
      t.diagnostic(`Final ${JSON.stringify(await stats().catch(() => ({})))}`);
      t.diagnostic(JSON.stringify(diagnostics));
      await send('g.leave').catch(() => {});
    }
    await context.close(); await browser.close(); await server?.close();
  }
});
