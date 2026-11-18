// 规程 briefing map is a render of the stage's 3D board (headless Chrome). Opt-in: SP_E2E=1.
//
//   SP_E2E=1 node --test test/ui/stage-thumb.e2e.test.js
//
// The mock harness swaps in 规程 config + stages (?version=regulation) and opens INFO_CHECK.
// Headless Chrome is often a software GPU, which webgl2Available refuses unless ?board=3d
// (the same allowSlow the match uses for an explicit 3D opt-in). Without that flag the preview
// stays on the cell crop — that fallback is intended.
// m01 is the desert board, m05 the Syracuse metro board. A stage with no scene group
// (act3autochess_escaped_single) stays on the cells. Screenshots: test/e2e/out/stage-thumb-*.png.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'test/e2e/out');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);

describe('规程 briefing map is a 3D render of the stage', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome) to run' }, () => {
  let srv;
  let browser;
  let base;

  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    base = `http://127.0.0.1:${srv.port}`;
    browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: true,
      args: ['--no-sandbox', '--no-first-run', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
    });
    mkdirSync(OUT, { recursive: true });
  });

  after(async () => {
    await browser?.close();
    await srv?.close();
  });

  const url = (stage) => `${base}/dev/game-mock.html?shot=1&phase=INFO_CHECK&variant=solo&version=regulation&board=3d&stage=${stage}`;

  async function open(stage, w, h) {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    const problems = [];
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    await page.goto(url(stage), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('[data-layout="regulation"] .reg-preview', { timeout: 20000 });
    return { page, problems };
  }

  async function pixels(page) {
    return page.evaluate(() => {
      const img = document.querySelector('[data-preview="render"] img');
      if (!img || !img.naturalWidth) return null;
      const c = document.createElement('canvas');
      c.width = 32;
      c.height = 18;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0, 32, 18);
      const d = g.getImageData(0, 0, 32, 18).data;
      let min = 255;
      let max = 0;
      const buckets = new Set();
      for (let i = 0; i < d.length; i += 4) {
        const y = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        if (y < min) min = y;
        if (y > max) max = y;
        buckets.add(y >> 3);
      }
      const host = img.closest('[data-preview="render"]');
      return {
        min, max, buckets: buckets.size, w: img.naturalWidth, h: img.naturalHeight,
        ms: host?.getAttribute('data-render-ms') || '',
        src: img.currentSrc.slice(0, 24),
      };
    });
  }

  for (const [stage, name] of [['act3autochess_m01', 'm01-desert'], ['act3autochess_m05', 'm05-metro']]) {
    test(`${name}: the preview becomes a non-uniform image`, { timeout: 180000 }, async () => {
      const { page, problems } = await open(stage, 1280, 720);
      const painted = await page.evaluate(() => ({
        layout: document.querySelector('[data-layout]')?.getAttribute('data-layout'),
        preview: document.querySelector('.reg-preview [data-preview]')?.getAttribute('data-preview'),
        go: !!document.querySelector('.brief-go'),
      }));
      assert.equal(painted.layout, 'regulation');
      assert.equal(painted.go, true);
      assert.ok(painted.preview === 'cells' || painted.preview === 'render');
      await page.waitForFunction(() => {
        const img = document.querySelector('[data-preview="render"] img');
        return img && img.complete && img.naturalWidth >= 320 && img.naturalHeight >= 180;
      }, { timeout: 120000 });
      const shot = await pixels(page);
      assert.ok(shot, 'the render image did not decode');
      assert.ok(shot.w >= 320 && shot.h >= 180, `buffer ${shot.w}x${shot.h}`);
      assert.ok(Math.abs(shot.w / shot.h - 16 / 9) < 0.02, `aspect ${shot.w}x${shot.h}`);
      assert.ok(shot.buckets >= 4 && shot.max - shot.min > 20, `flat image min=${shot.min} max=${shot.max} buckets=${shot.buckets}`);
      assert.ok(shot.src.startsWith('data:image/'), shot.src);
      await page.click('.reg-preview__zoom');
      await page.waitForSelector('.reg-mapdlg [data-preview="render"] img', { timeout: 5000 });
      const dialog = await page.evaluate(() => {
        const box = document.querySelector('.reg-mapdlg');
        const a = document.querySelector('.reg-preview [data-preview="render"] img')?.currentSrc;
        const b = document.querySelector('.reg-mapdlg [data-preview="render"] img')?.currentSrc;
        const name = document.querySelector('.reg-mapdlg__name')?.textContent || '';
        return {
          focused: !!(box && (box === document.activeElement || box.contains(document.activeElement))),
          same: !!a && a === b,
          name,
        };
      });
      assert.equal(dialog.focused, true);
      assert.equal(dialog.same, true);
      assert.match(dialog.name, /战场/);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('.reg-mapdlg'), { timeout: 5000 });
      await page.screenshot({ path: path.join(OUT, `stage-thumb-${name}.png`) });
      assert.deepEqual(problems, []);
      await page.close();
    });
  }

  test('m01 at a short landscape width stays inside the viewport', { timeout: 180000 }, async () => {
    const { page, problems } = await open('act3autochess_m01', 844, 390);
    await page.waitForFunction(() => {
      const img = document.querySelector('[data-preview="render"] img');
      return img && img.complete && img.naturalWidth > 0;
    }, { timeout: 120000 });
    const box = await page.$eval('.reg-preview', (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, vw: window.innerWidth, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
    });
    assert.ok(box.left >= -1 && box.right <= box.vw + 1, `preview ${box.left}..${box.right} in ${box.vw}`);
    assert.ok(box.sw <= box.cw + 1, `page scroll ${box.sw} > ${box.cw}`);
    await page.screenshot({ path: path.join(OUT, 'stage-thumb-m01-844.png') });
    assert.deepEqual(problems, []);
    await page.close();
  });

  test('a stage with no scene group keeps the cell thumbnail', { timeout: 120000 }, async () => {
    const { page, problems } = await open('act3autochess_escaped_single', 1280, 720);
    await page.waitForSelector('[data-preview="cells"]', { timeout: 20000 });
    await new Promise((r) => setTimeout(r, 1500));
    const kind = await page.evaluate(() => ({
      preview: document.querySelector('.reg-preview [data-preview]')?.getAttribute('data-preview'),
      pending: document.querySelector('.reg-preview [data-pending]')?.getAttribute('data-pending') || '',
      cells: document.querySelectorAll('.reg-preview .reg-map__cell').length,
      render: document.querySelectorAll('[data-preview="render"]').length,
    }));
    assert.equal(kind.preview, 'cells');
    assert.equal(kind.pending, '');
    assert.equal(kind.render, 0);
    assert.ok(kind.cells > 0);
    await page.screenshot({ path: path.join(OUT, 'stage-thumb-no-scene.png') });
    assert.deepEqual(problems, []);
    await page.close();
  });
});
