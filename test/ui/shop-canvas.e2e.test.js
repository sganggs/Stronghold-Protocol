// Browser check of the canvas shop (opt-in, ~20 s): card hotspots on top of the canvas, the fold/unfold
// interaction and state, the accessibility tree and keyboard, and WebGL context loss + remount, at
// 1600x900 and 1280x720.
//   SP_E2E=1 CHROME_PATH=… node --test test/ui/shop-canvas.e2e.test.js
//
// The page is the dev host (public/dev/shop-webgl.html): it mounts the renderer with a mock m.private and the
// local ac_s_closur pack (the three documents in data/local-assets.json), owns window.__shopWebglDebug and
// changes no saved settings. The assertions are geometry / state / the accessibility tree, never pixel diffs:
// the canvas is animated and the installed fonts differ per machine.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const CHROME = CANDIDATES.find((p) => existsSync(p)) || '';

function artReady() {
  try {
    const groups = JSON.parse(readFileSync('data/local-assets.json', 'utf8')).groups || {};
    const theme = groups['themes/ac_s_closur'] || {};
    return !!(theme['shop.json'] && theme['card.json'] && theme['prefabs.json']);
  } catch {
    return false;
  }
}

const ENABLED = process.env.SP_E2E === '1' && !!CHROME && artReady();
const OUT = path.resolve(process.env.SP_SHOP_E2E_OUTPUT || path.join(os.tmpdir(), 'shop-canvas-e2e'));

const center = (h) => [h.x + h.w / 2, h.y + h.h / 2];
const inside = (h, w, hh) => h.w > 0 && h.h > 0 && h.x >= 0 && h.y >= 0 && h.x + h.w <= w && h.y + h.h <= hh;

/** The visible hotspots (control buttons and card slots) with their labels and boxes. */
function hotspots(page) {
  return page.evaluate(() => [...document.querySelectorAll('.shop-webgl__slot, .shop-webgl__hit')]
    .filter((el) => !el.hidden)
    .map((el) => {
      const r = el.getBoundingClientRect();
      return {
        action: el.dataset.shopWebglAction || null,
        slot: el.dataset.shopSlot ?? null,
        label: el.getAttribute('aria-label') || '',
        disabled: el.getAttribute('aria-disabled'),
        x: r.x, y: r.y, w: r.width, h: r.height,
      };
    }));
}

/** Wait for the dev host to mount and clear its own error list. */
async function waitMounted(page) {
  await page.waitForFunction(() => {
    const d = window.__shopWebglDebug;
    return d && d.ready && d.host && d.errors.length === 0;
  }, { timeout: 30000 });
}

/** Wait for one state ('unfold' / 'fold') to be drawn. */
async function waitState(page, state) {
  await page.waitForFunction((want) => {
    const d = window.__shopWebglDebug;
    return d && document.querySelector('#status')?.textContent === `mounted · ${want}`;
  }, { timeout: 15000 }, state);
}

/** The card hotspot whose centre a pointer reaches, or null (a panel, the canvas or another slot). */
function reach(page, x, y) {
  return page.evaluate(([px, py]) => {
    const el = document.elementFromPoint(px, py);
    const slot = el && el.closest('.shop-webgl__slot');
    return slot ? slot.dataset.shopSlot : null;
  }, [x, y]);
}

test('canvas shop: hotspots on top, fold state, accessibility and context loss at two widths', {
  skip: !ENABLED && 'set SP_E2E=1, have Chrome and a local ac_s_closur extraction (shop/card/prefabs.json)',
  timeout: 180000,
}, async () => {
  // Loaded only when the suite actually runs (SP_E2E=1 + Chrome + the local extraction). A skipped file would
  // otherwise import puppeteer-core and the whole server on every `node --test` run; the assertions are unchanged.
  const [{ default: puppeteer }, { startServer }] = await Promise.all([
    import('puppeteer-core'),
    import('../../server/index.js'),
  ]);
  const server = await startServer({ port: 0, host: '127.0.0.1', quiet: true, workers: 0, assetIndex: false });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--no-first-run', '--force-device-scale-factor=1', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const problems = [];
  const open = async (width, height) => {
    const page = await browser.newPage();
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
    await page.setViewport({ width, height });
    await page.goto(`http://127.0.0.1:${server.port}/dev/shop-webgl.html?state=unfold&dpr=1`, { waitUntil: 'networkidle0', timeout: 60000 });
    await waitMounted(page);
    // The dev panel floats over the top-left corner; it is a harness control, not part of the shop, so the
    // layering checks below run with it out of the way.
    await page.evaluate(() => { document.querySelector('#panel').style.display = 'none'; });
    return page;
  };
  try {
    mkdirSync(OUT, { recursive: true });

    // --- 1600x900 ------------------------------------------------------------------------------------------
    let page = await open(1600, 900);
    let metrics = await page.evaluate(() => window.__shopWebglDebug.metrics());
    assert.equal(metrics.state, 'unfold');
    assert.ok(Array.isArray(metrics.cardBoxes) && metrics.cardBoxes.length >= 4, 'the mock draws at least four cards');
    assert.ok(metrics.pitch && metrics.pitch.dx > 0, 'the cards stand on a horizontal pitch');
    assert.equal(await page.evaluate(() => document.querySelectorAll('.shopbar').length), 0, 'the dev host draws no DOM bar');

    const slots = (await hotspots(page)).filter((h) => h.slot !== null);
    assert.ok(slots.length >= 4, `at least four card hotspots (got ${slots.length})`);
    for (const h of slots.filter((s) => inside(s, 1600, 900))) {
      const [cx, cy] = center(h);
      assert.equal(await reach(page, cx, cy), h.slot, `the pointer at slot ${h.slot}'s centre reaches that card`);
    }
    // Two adjacent cards are separate targets: their boxes do not overlap.
    for (let i = 1; i < slots.length; i += 1) {
      const a = slots[i - 1];
      const b = slots[i];
      assert.ok(a.x + a.w <= b.x + 0.5, `slot ${a.slot} ends before slot ${b.slot} starts`);
    }
    await page.screenshot({ path: path.join(OUT, '1600-unfold.png') });

    // --- fold: the close hotspot (by keyboard) folds the band, the open hotspot unfolds it -----------------
    await page.focus('[data-shop-webgl-action="close"]');
    await page.keyboard.press('Enter');
    await waitState(page, 'fold');
    metrics = await page.evaluate(() => window.__shopWebglDebug.metrics());
    assert.equal(metrics.state, 'fold', 'the renderer is in its folded state');
    // The dev host sets its status before the next frame moves the hotspots; wait for the control itself.
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-shop-webgl-action="open"]');
      return el && !el.hidden;
    }, { timeout: 15000 });
    await page.evaluate(() => document.querySelector('[data-shop-webgl-action="open"]').click());
    await waitState(page, 'unfold');
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-shop-webgl-action="close"]');
      return el && !el.hidden;
    }, { timeout: 15000 });
    assert.equal((await page.evaluate(() => window.__shopWebglDebug.metrics())).state, 'unfold');

    // --- accessibility: control labels, card names with prices, disabled state ----------------------------
    const snapshot = await page.accessibility.snapshot({ interestingOnly: false });
    const names = [];
    (function walk(node) {
      if (!node) return;
      if (node.name) names.push(node.name);
      (node.children || []).forEach(walk);
    })(snapshot);
    for (const want of ['收起商店', '刷新', '冻结', '升级']) {
      assert.ok(names.some((n) => n.includes(want)), `the accessibility tree carries the ${want} control`);
    }
    for (const h of slots) assert.match(h.label, /，价格 \d+/, `slot ${h.slot} names its price`);
    assert.ok(slots.some((h) => h.disabled === 'false'), 'a buyable card reports aria-disabled=false');

    // --- context loss: the host records the loss, then dispose + remount draws exactly one canvas ---------
    const lost = await page.evaluate(() => {
      const canvas = document.querySelector('canvas.shop-webgl__canvas');
      const gl = canvas && canvas.getContext('webgl2');
      const ext = gl && gl.getExtension('WEBGL_lose_context');
      if (!ext) return 'no-extension';
      ext.loseContext();
      return 'lost';
    });
    assert.equal(lost, 'lost', 'the WebGL context can be lost on purpose');
    await page.waitForFunction(() => {
      const d = window.__shopWebglDebug;
      const m = d.metrics();
      return !!(m.host && m.host.lost) || d.errors.length > 0;
    }, { timeout: 15000 });
    assert.equal(problems.filter((p) => p.startsWith('pageerror')).length, 0, 'the loss does not throw out of the page');
    // The remount button lives in the dev panel this test hid for the layering checks.
    await page.evaluate(() => { document.querySelector('#panel').style.display = ''; });
    await page.click('#remount');
    await page.waitForFunction(() => document.querySelector('#status')?.textContent === 'mounted · unfold', { timeout: 30000 });
    assert.equal(await page.evaluate(() => document.querySelectorAll('canvas.shop-webgl__canvas').length), 1, 'remount leaves exactly one canvas');
    assert.equal((await page.evaluate(() => window.__shopWebglDebug.metrics())).host.lost, false, 'the remounted host has a live context');
    await page.close();

    // --- 1280x720: the same targets on the smaller band ---------------------------------------------------
    page = await open(1280, 720);
    metrics = await page.evaluate(() => window.__shopWebglDebug.metrics());
    assert.equal(metrics.state, 'unfold');
    const small = (await hotspots(page)).filter((h) => h.slot !== null);
    const visible = small.filter((h) => inside(h, 1280, 720));
    assert.ok(visible.length >= 4, `the smaller band still has four card hotspots (got ${visible.length})`);
    for (const h of visible) {
      const [cx, cy] = center(h);
      assert.equal(await reach(page, cx, cy), h.slot, `the pointer at slot ${h.slot}'s centre reaches that card at 1280x720`);
    }
    assert.ok(metrics.host.canvas[0] > 0 && metrics.host.canvas[1] > 0, 'the canvas has a device-pixel size');
    await page.screenshot({ path: path.join(OUT, '1280-unfold.png') });
    await page.close();

    assert.deepEqual(problems, [], 'no console errors and no page errors');
  } finally {
    await browser?.close();
    await server?.close();
  }
});
