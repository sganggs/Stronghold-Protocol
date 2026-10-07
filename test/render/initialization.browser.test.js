// Real renderer startup and cancellation, without downloaded art.
// RENDER_E2E=1 node --test test/render/initialization.browser.test.js
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'test/e2e/out');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const skip = process.env.RENDER_E2E === '1' && existsSync(CHROME) ? false : 'set RENDER_E2E=1 (needs Chrome)';
const HTML = `<!doctype html><html><head><link rel="stylesheet" href="/css/theme.css"><link rel="stylesheet" href="/css/screens/game.css"></head>
<body style="margin:0"><div id="host" style="position:relative;width:1000px;height:650px"></div><div id="hooks"></div></body></html>`;

// These wrappers keep the real browser/Pixi behavior and record resources owned by each view.
function trackBrowserResources() {
  const state = window.__initialization = { apps: [], observers: [], listeners: [], calls: 0, settled: 0 };
  const timers = new Map();
  const set = window.setTimeout.bind(window), clear = window.clearTimeout.bind(window);
  window.setTimeout = (fn, ms, ...args) => {
    const id = set(() => { timers.delete(id); fn(...args); }, ms);
    if (ms === 12000) timers.set(id, () => fn(...args));
    return id;
  };
  window.clearTimeout = (id) => { timers.delete(id); clear(id); };
  state.expire = () => {
    for (const [id, fn] of [...timers]) { clear(id); timers.delete(id); fn(); }
  };
  const NativeObserver = window.ResizeObserver;
  window.ResizeObserver = class extends NativeObserver {
    constructor(fn) { super(fn); this.targets = new Set(); state.observers.push(this); }
    observe(target, ...args) { this.targets.add(target); return super.observe(target, ...args); }
    unobserve(target) { this.targets.delete(target); return super.unobserve(target); }
    disconnect() { this.targets.clear(); return super.disconnect(); }
  };
  const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
  const tracked = (target, type) => target instanceof HTMLCanvasElement ||
    (target === document && type === 'visibilitychange') || (target === window && type === 'resize');
  const capture = (opts) => typeof opts === 'boolean' ? opts : !!opts?.capture;
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    if (tracked(this, type) && !state.listeners.some((r) => r.target === this && r.type === type && r.fn === fn && r.capture === capture(opts))) {
      state.listeners.push({ target: this, type, fn, capture: capture(opts) });
    }
    return add.call(this, type, fn, opts);
  };
  EventTarget.prototype.removeEventListener = function (type, fn, opts) {
    state.listeners = state.listeners.filter((r) => !(r.target === this && r.type === type && r.fn === fn && r.capture === capture(opts)));
    return remove.call(this, type, fn, opts);
  };
  state.snapshot = () => ({
    apps: state.apps.map(({ app, ticker, canvas }) => ({ destroyed: app.renderer === null, ticking: ticker.started, attached: canvas.isConnected })),
    observers: state.observers.filter((r) => r.targets.size).length,
    listeners: state.listeners.map((r) => r.type),
    canvases: document.querySelectorAll('#host canvas').length,
    fallbacks: document.querySelectorAll('#host .ff').length,
  });
}

function trackPixiApplications() {
  const Application = PIXI.Application;
  PIXI.Application = class extends Application {
    constructor(...args) {
      super(...args);
      window.__initialization.apps.push({ app: this, ticker: this.ticker, canvas: this.view });
    }
  };
}

const FACTORY_WRAPPER = `export * from '/js/render/app.js?implementation';
import { createFieldView as create } from '/js/render/app.js?implementation';
export async function createFieldView(...args) {
  window.__initialization.calls++;
  if (window.__initialization.ignoreSignal) args[1] = { ...args[1], signal: undefined };
  try { return await create(...args); }
  finally { window.__initialization.settled++; }
}`;

describe('field initialization in headless Chrome', { skip }, () => {
  let srv, browser, pixi;
  before(async () => {
    const puppeteer = (await import('puppeteer-core')).default;
    const { startServer } = await import('../../server/index.js');
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run'] });
    pixi = readFileSync(path.join(ROOT, 'public/vendor/pixi.min.js'), 'utf8') + `\n;(${trackPixiApplications.toString()})();`;
  });
  after(async () => { await browser?.close(); await srv?.close(); });

  async function open(t, { holdPixi = false } = {}) {
    const page = await browser.newPage();
    t.after(() => page.close());
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.setViewport({ width: 1100, height: 750 });
    await page.evaluateOnNewDocument(trackBrowserResources);
    await page.setRequestInterception(true);
    let releasePixi;
    const requested = new Promise((resolve) => {
      page.on('request', (request) => {
        const url = new URL(request.url());
        if (url.pathname === '/initialization-test') return request.respond({ status: 200, contentType: 'text/html', body: HTML });
        if (url.pathname === '/js/render/app.js' && !url.search) return request.respond({ status: 200, contentType: 'text/javascript', body: FACTORY_WRAPPER });
        if (url.pathname === '/vendor/pixi.min.js') {
          releasePixi = () => request.respond({ status: 200, contentType: 'text/javascript', body: pixi });
          resolve();
          if (!holdPixi) return releasePixi();
          return;
        }
        return request.continue();
      });
    });
    await page.goto(`http://127.0.0.1:${srv.port}/initialization-test?board=2d`);
    // Empty manifests prevent optional local art requests while preserving the real asset store.
    await page.evaluate(async () => {
      const { assets } = await import('/js/assets.js');
      assets.seed({ version: 1, chars: {}, enemies: {}, tokens: {}, items: {} });
      assets.seedLocal({ version: 1, files: {} });
      const { data } = await import('/js/data.js');
      await data.load('stages');
      window.__initialization.stage = data.list('stages')[0];
      window.__initialization.host = document.getElementById('host');
    });
    return { page, errors, requested, release: () => releasePixi() };
  }

  async function start(page) {
    await page.evaluate(async () => {
      const { mountFieldView } = await import('/js/ui/fieldHost.js');
      const s = window.__initialization;
      s.mount = mountFieldView(s.host).then((view) => {
        s.view = view;
        view.setStage(s.stage);
        view.setPrep({ board: [], hand: [], temp: [] }, { editable: true });
        s.clicks = [];
        view.on('tileClick', (click) => s.clicks.push([click.row, click.col]));
      });
    });
  }

  async function pixiFinished(page) {
    await page.evaluate(async () => {
      const { ensurePixi } = await import('/js/render/app/pixi.js');
      await ensurePixi();
      await new Promise(requestAnimationFrame);
    });
  }

  async function clickFallback(page) {
    await page.waitForSelector('#host .ff-tile--floor');
    const tile = await page.$eval('#host .ff-tile--floor', (element) => {
      const r = element.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, row: +element.dataset.row, col: +element.dataset.col };
    });
    await page.mouse.click(tile.x, tile.y);
    return [tile.row, tile.col];
  }

  test('successful startup owns one running app and destroy releases its browser resources', async (t) => {
    const { page, errors } = await open(t);
    await start(page);
    await page.waitForFunction(() => window.__initialization.view?.kind === 'engine');
    const mounted = await page.evaluate(() => window.__initialization.snapshot());
    assert.equal(mounted.canvases, 1);
    assert.deepEqual(mounted.apps, [{ destroyed: false, ticking: true, attached: true }]);
    assert.equal(mounted.observers, 1);
    assert.ok(mounted.listeners.includes('pointerdown'));
    assert.ok(mounted.listeners.includes('visibilitychange'));
    const destroyed = await page.evaluate(() => {
      const s = window.__initialization;
      s.view.destroy(); s.view.destroy();
      return s.snapshot();
    });
    assert.deepEqual(destroyed, { apps: [{ destroyed: true, ticking: false, attached: false }], observers: 0, listeners: [], canvases: 0, fallbacks: 0 });
    assert.deepEqual(errors, []);
  });

  for (const ignoreSignal of [false, true]) test(`a timed-out Pixi load cannot cover the clickable fallback (${ignoreSignal ? 'legacy factory ignores cancellation' : 'cancellable factory'})`, async (t) => {
    const { page, errors, requested, release } = await open(t, { holdPixi: true });
    await page.evaluate((value) => { window.__initialization.ignoreSignal = value; }, ignoreSignal);
    await start(page);
    await requested;
    await page.evaluate(() => window.__initialization.expire());
    await page.waitForFunction(() => window.__initialization.view?.kind === 'fallback');
    const target = await clickFallback(page);
    assert.deepEqual(await page.evaluate(() => window.__initialization.clicks), [target]);
    await release();
    await pixiFinished(page);
    await page.waitForFunction(() => window.__initialization.settled === 1);
    await clickFallback(page);
    const late = await page.evaluate(() => ({ ...window.__initialization.snapshot(), clicks: window.__initialization.clicks }));
    assert.deepEqual(late.clicks, [target, target], 'real pointer input still reaches the fallback after Pixi finishes');
    assert.equal(late.canvases, 0, 'the abandoned engine must not append an orphan canvas');
    assert.equal(late.fallbacks, 1);
    assert.ok(late.apps.every((app) => app.destroyed && !app.ticking && !app.attached));
    assert.deepEqual(late.listeners, []);
    assert.equal(late.observers, 1, 'only the fallback observes the host');
    if (!ignoreSignal) {
      mkdirSync(OUT, { recursive: true });
      await page.screenshot({ path: path.join(OUT, 'render-initialization-fallback.png') });
    }
    const destroyed = await page.evaluate(() => { window.__initialization.view.destroy(); return window.__initialization.snapshot(); });
    assert.equal(destroyed.observers, 0);
    assert.equal(destroyed.canvases, 0);
    assert.equal(destroyed.fallbacks, 0);
    assert.deepEqual(errors, []);
  });

  test('timeout during board-art startup immediately releases the allocated app and permits a fresh engine', async (t) => {
    const { page, errors } = await open(t);
    await page.evaluate(async () => {
      const { assets } = await import('/js/assets.js');
      const s = window.__initialization, local = assets.local.bind(assets);
      assets.local = () => {
        if (!s.apps.length) return local();
        assets.local = local;
        s.artBlocked = true;
        return new Promise((resolve) => { s.releaseArt = async () => resolve(await local()); });
      };
    });
    await start(page);
    await page.waitForFunction(() => window.__initialization.artBlocked);
    const allocated = await page.evaluate(() => window.__initialization.snapshot());
    assert.deepEqual(allocated.apps, [{ destroyed: false, ticking: true, attached: true }]);
    await page.evaluate(() => window.__initialization.expire());
    await page.waitForFunction(() => window.__initialization.view?.kind === 'fallback');
    const cancelled = await page.evaluate(() => window.__initialization.snapshot());
    assert.deepEqual(cancelled.apps, [{ destroyed: true, ticking: false, attached: false }], 'cancellation frees the real renderer before the delayed art resolves');
    assert.equal(cancelled.canvases, 0);
    assert.equal(cancelled.observers, 1);
    assert.deepEqual(cancelled.listeners, []);
    const target = await clickFallback(page);
    assert.deepEqual(await page.evaluate(() => window.__initialization.clicks), [target]);
    await page.evaluate(async () => {
      const s = window.__initialization;
      await s.releaseArt();
      s.view.destroy();
      s.view = null;
    });
    await page.waitForFunction(() => window.__initialization.settled === 1);
    await start(page);
    await page.waitForFunction(() => window.__initialization.view?.kind === 'engine');
    const replacement = await page.evaluate(async () => {
      await new Promise(requestAnimationFrame);
      const s = window.__initialization, app = s.view.raw.debug.app;
      app.renderer.render(app.stage);
      return s.snapshot();
    });
    assert.deepEqual(replacement.apps, [
      { destroyed: true, ticking: false, attached: false },
      { destroyed: false, ticking: true, attached: true },
    ], 'a replacement engine can render with the surviving shared caches');
    assert.equal(replacement.canvases, 1);
    const destroyed = await page.evaluate(() => { window.__initialization.view.destroy(); return window.__initialization.snapshot(); });
    assert.ok(destroyed.apps.every((app) => app.destroyed && !app.ticking && !app.attached));
    assert.equal(destroyed.observers, 0);
    assert.deepEqual(destroyed.listeners, []);
    assert.equal(destroyed.canvases, 0);
    assert.deepEqual(errors, []);
  });

  test('a setup exception releases partial resources without removing another host child', async (t) => {
    const { page, errors } = await open(t);
    await page.evaluate(async () => {
      const { assets } = await import('/js/assets.js');
      const s = window.__initialization, subscribe = assets.onChange.bind(assets);
      s.sibling = document.createElement('span');
      s.sibling.textContent = 'Existing host content';
      s.host.appendChild(s.sibling);
      // Fail after input and resize resources exist, while the real view is still being built.
      assets.onChange = (fn) => {
        if (s.observers.some((observer) => observer.targets.has(s.host))) {
          assets.onChange = subscribe;
          throw new Error('asset subscription unavailable');
        }
        return subscribe(fn);
      };
    });
    await start(page);
    await page.waitForFunction(() => window.__initialization.view?.kind === 'fallback');
    const failed = await page.evaluate(() => ({ ...window.__initialization.snapshot(), sibling: window.__initialization.sibling.isConnected }));
    assert.deepEqual(failed.apps, [{ destroyed: true, ticking: false, attached: false }]);
    assert.equal(failed.sibling, true, 'failed initialization only cleans up its own resources');
    assert.equal(failed.canvases, 0);
    assert.equal(failed.observers, 1);
    assert.deepEqual(failed.listeners, []);
    const target = await clickFallback(page);
    assert.deepEqual(await page.evaluate(() => window.__initialization.clicks), [target]);
    const destroyed = await page.evaluate(() => { window.__initialization.view.destroy(); return window.__initialization.snapshot(); });
    assert.equal(destroyed.observers, 0);
    assert.equal(destroyed.fallbacks, 0);
    assert.deepEqual(errors, []);
  });

  test('unmount during startup cannot erase a newer hook mount on the same host', async (t) => {
    const { page, errors, requested, release } = await open(t, { holdPixi: true });
    await page.evaluate(async () => {
      const { h, render } = await import('/vendor/preact.module.js');
      const { useFieldView } = await import('/js/ui/fieldHost.js');
      const s = window.__initialization;
      function Field() { s.hook = useFieldView({ current: s.host }); return null; }
      s.renderHook = (key) => render(key ? h(Field, { key }) : null, document.getElementById('hooks'));
      s.renderHook('first');
    });
    await requested;
    await page.evaluate(() => {
      const s = window.__initialization;
      s.renderHook(null);
      window.__SP_RENDER__ = 'fallback';
      s.renderHook('second');
    });
    await page.waitForFunction(() => window.__initialization.hook?.kind === 'fallback');
    await page.evaluate(() => {
      const s = window.__initialization;
      s.current = s.hook.view;
      s.current.setStage(s.stage);
      s.current.setPrep({ board: [], hand: [], temp: [] }, { editable: true });
      s.clicks = [];
      s.current.on('tileClick', (click) => s.clicks.push([click.row, click.col]));
      s.expire();
    });
    await release();
    await pixiFinished(page);
    await page.waitForFunction(() => window.__initialization.settled === 1);
    const late = await page.evaluate(() => ({ ...window.__initialization.snapshot(), current: window.__SP_VIEW__ === window.__initialization.current }));
    assert.equal(late.fallbacks, 1, 'the old mount must not clear the newer view from the shared host');
    assert.equal(late.canvases, 0);
    assert.equal(late.current, true);
    assert.ok(late.apps.every((app) => app.destroyed && !app.ticking && !app.attached));
    const target = await clickFallback(page);
    assert.deepEqual(await page.evaluate(() => window.__initialization.clicks), [target]);
    const destroyed = await page.evaluate(() => {
      window.__initialization.renderHook(null);
      return { ...window.__initialization.snapshot(), current: window.__SP_VIEW__ };
    });
    assert.equal(destroyed.current, null);
    assert.equal(destroyed.observers, 0);
    assert.equal(destroyed.canvases, 0);
    assert.equal(destroyed.fallbacks, 0);
    assert.deepEqual(destroyed.listeners, []);
    assert.deepEqual(errors, []);
  });
});
