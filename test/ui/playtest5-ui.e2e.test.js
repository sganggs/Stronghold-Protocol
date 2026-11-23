// Browser regressions of user playtest #5, UI items 8 / 9, through the mock harness (public/dev/game-mock.html) in
// headless Chrome (puppeteer-core + system Chrome). Opt-in: SP_E2E=1.
//
//   SP_E2E=1 node --test test/ui/playtest5-ui.e2e.test.js
//
//  9  during prep no bench (row 7) / temp (row 8) tile is covered by DOM overlays (the shop bar, the corner buttons, the
//     tools) and the field's back row is free of the bond strip — own board and Final Assault half, at the phone
//     landscape viewports (844×390 and 932×430 with and without the iPhone insets, 915×412, 800×360, 914×411,
//     960×411, 924×424, and the user's Android: 756×366 — its 2772×1272 px screenshot shows the page right of a
//     141 px black cutout band, 2631×1272 px at DPR ≈ 3.48, the exit and 准备就绪 buttons matching to ±1 px — and
//     798×366 with a 41 px left inset had the page covered the cutout) and at desktop 16:9 / 16:10 / 3:2 / 21:9, where
//     the official shop camera is unchanged (122 px per bench tile at 1920×1080). Each tile top's projected quad is
//     sampled on a 24 × 24 grid with elementFromPoint (every HUD element hit-testable); a sample counts as covered
//     when the element there paints (background, border, text, image) — v2.3 left 71 % of bench pads 4–9 free at
//     844×390, 49 % at 800×360 and 54 % at 756×366 (the user's screenshot: pads 3–9 about half covered).
//  9  an armed shop card (first tap of the two-tap buy) at 756×366 rises ≤ 5 px above the bar and covers ≤ 4 px of
//     the bench pads' near corners (accepted, ui/fieldHost.js hudBands)
//  8  the corner's ⚙ is the regular gear glyph (ui/gameComponents.js gearPath), square, as large as 📖 / ⛶ (half the
//     grown button on phones)
// Screenshots: test/e2e/out/p5-*.png.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'test/e2e/out');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const IPH = (s) => ({ l: s, r: s, t: 0, b: 21 }); // iPhone landscape safe-area insets (px)
/** name, width, height, touch, insets */
const VIEWS = [
  ['844x390', 844, 390, true, null], ['844x390-notch', 844, 390, true, IPH(47)], ['932x430', 932, 430, true, null],
  ['932x430-notch', 932, 430, true, IPH(59)], ['915x412', 915, 412, true, null], ['800x360', 800, 360, true, null],
  ['914x411', 914, 411, true, null], ['960x411', 960, 411, true, null], ['924x424', 924, 424, true, null],
  ['756x366', 756, 366, true, null], ['798x366-inset41', 798, 366, true, { l: 41, r: 0, t: 0, b: 0 }],
  ['1920x1080', 1920, 1080, false, null], ['1680x1050', 1680, 1050, false, null], ['1560x1040', 1560, 1040, false, null],
  ['2560x1080', 2560, 1080, false, null],
];
const view = (name) => VIEWS.find((v) => v[0] === name);

describe('user playtest #5 — UI items 8 / 9 (mock harness, headless Chrome)', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome) to run' }, () => {
  let srv;
  let browser;
  let base;

  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    base = `http://127.0.0.1:${srv.port}`;
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
    mkdirSync(OUT, { recursive: true });
  });

  after(async () => {
    await browser?.close();
    await srv?.close();
  });

  async function open(query, { w, h, touch, insets }) {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1, isMobile: touch, hasTouch: touch });
    const problems = [];
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
    await page.goto(`${base}/dev/game-mock.html?shot=1&${query}`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => !!document.querySelector('.screen:not(.gload)') && !!globalThis.__SP_VIEW__, { timeout: 20000 });
    if (insets) {
      await page.evaluate((i) => {
        const s = document.documentElement.style;
        s.setProperty('--sa-l', `${i.l}px`); s.setProperty('--sa-r', `${i.r}px`); s.setProperty('--sa-t', `${i.t}px`); s.setProperty('--sa-b', `${i.b}px`);
      }, insets);
      await page.evaluate(() => globalThis.__SP_VIEW__.raw.resize());
    }
    await sleep(1800);
    return { page, problems };
  }

  /** Free fraction of each tile top of the listed board tiles (board coordinates; the boss prep maps them itself). */
  const freeFractions = (page, tiles) => page.evaluate((tiles) => {
    const view = globalThis.__SP_VIEW__.raw;
    const st = document.createElement('style');
    st.textContent = '.gm__hud, .gm__hud * { pointer-events: auto !important; }';
    document.head.appendChild(st);
    const clear = (c) => !c || c === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(c);
    const paints = (el) => {
      if (!el || el.tagName === 'CANVAS' || el.closest('.gm__field')) return false;
      // the official shop shadow (§37.238, the maintainer 2026-11-15: 「加上阴影，按官方的来」) is decorative, under every HUD
      // control and over the field (z-index -1, pointer-events: none); on phones its top reaches the first bench pads.
      // elementFromPoint only lands on it where no HUD control is, so it never hides one.
      if (el.closest('.shopbg')) return false;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
      if (['IMG', 'svg', 'path', 'B', 'SPAN', 'KBD', 'I', 'P', 'LABEL'].includes(el.tagName)) return true;
      if (!clear(cs.backgroundColor) || cs.backgroundImage !== 'none') return true;
      if (['Top', 'Right', 'Bottom', 'Left'].some((s) => parseFloat(cs[`border${s}Width`]) > 0 && !clear(cs[`border${s}Color`]))) return true;
      return [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    };
    const inside = (poly, x, y) => {
      let c = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i], [xj, yj] = poly[j];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
      }
      return c;
    };
    const out = tiles.map(([r, c]) => {
      const t = view.tileScreen(r, c);
      if (!t) return { r, c, free: -1 };
      const xs = t.poly.map((p) => p[0]), ys = t.poly.map((p) => p[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      let n = 0, free = 0;
      const N = 24;
      for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
        const x = x0 + (x1 - x0) * (i + 0.5) / N, y = y0 + (y1 - y0) * (j + 0.5) / N;
        if (!inside(t.poly, x, y)) continue;
        n++;
        if (x >= 0 && y >= 0 && x < innerWidth && y < innerHeight && !paints(document.elementFromPoint(x, y))) free++;
      }
      return { r, c, free: n ? free / n : 0, s: t.s };
    });
    st.remove();
    return out;
  }, tiles);

  const BENCH = Array.from({ length: 10 }, (_, c) => [7, c]);
  const TEMP = [4, 5, 6, 7, 8].map((c) => [8, c]);
  const BACK = [4, 5, 6, 7, 8, 9, 10].map((c) => [12, c]); // the playable back row of 战场#01 (cols 0–3: forbidden)

  test('9: bench, temp and the back row are free of the HUD in prep and in the Final Assault prep', { timeout: 10 * 60 * 1000 }, async () => {
    const report = [];
    for (const [name, w, h, touch, insets] of VIEWS) {
      for (const variant of ['', 'boss']) {
        const { page, problems } = await open(`phase=PREP${variant ? `&variant=${variant}` : ''}`, { w, h, touch, insets });
        const tag = `${name}${variant ? ' (Final Assault prep)' : ''}`;
        const bench = await freeFractions(page, BENCH);
        const temp = await freeFractions(page, TEMP);
        const back = await freeFractions(page, BACK);
        for (const t of [...bench, ...temp]) assert.ok(t.free >= 0.99, `${tag}: ${t.r === 7 ? 'bench' : 'temp'} ${t.c} ${Math.round(t.free * 100)} % free`);
        for (const t of back) assert.ok(t.free >= 0.99, `${tag}: back row ${t.c} ${Math.round(t.free * 100)} % free`);
        // desktop 16:9 keeps the official shop camera
        if (name === '1920x1080' && !variant) assert.ok(Math.abs(bench[5].s - 122) < 1, `1920×1080 px per bench tile ${bench[5].s}`);
        report.push(`${tag}: bench ${Math.round(Math.min(...bench.map((t) => t.free)) * 100)} %, ${Math.round(bench[5].s)} px/tile`);
        if (['844x390', '756x366', '800x360', '1920x1080'].includes(name)) await page.screenshot({ path: path.join(OUT, `p5-bench-${name}${variant ? '-boss' : ''}.png`) });
        assert.deepEqual(problems, [], tag);
        await page.close();
      }
    }
    console.log(report.join('\n'));
  });

  test('9: an armed shop card (two-tap buy) barely reaches the bench on the user\'s phone', async () => {
    // accepted overlap (ui/fieldHost.js hudBands): the armed card rises 4 px above the bar at 1rem = 40 px and covers
    // the pads' near corners by ≈ 3 px — less than under the official camera at 1920×1080 (13 px / ≈ 11 px)
    const [, w, h, touch] = view('756x366');
    const { page, problems } = await open('phase=PREP', { w, h, touch });
    const cards = await page.$$('.scard:not(.scard--sold)');
    assert.ok(cards.length > 0, 'a shop card to arm');
    await cards[0].tap();
    await sleep(400);
    const r = await page.evaluate(() => {
      const a = document.querySelector('.scard.is-armed');
      if (!a) return null;
      const b = a.getBoundingClientRect(), row = document.querySelector('.shopbar__row').getBoundingClientRect();
      const view = globalThis.__SP_VIEW__.raw;
      let over = 0;
      for (let c = 0; c < 10; c++) {
        const t = view.tileScreen(7, c);
        const xs = t.poly.map((p) => p[0]), y1 = Math.max(...t.poly.map((p) => p[1]));
        if (Math.max(...xs) > b.left && Math.min(...xs) < b.right) over = Math.max(over, y1 - b.top);
      }
      return { lift: row.top - b.top, over };
    });
    assert.ok(r, 'the first tap arms the card');
    assert.ok(r.lift <= 5, `armed card ${r.lift} px above the bar`);
    assert.ok(r.over <= 4, `armed card over the bench pads by ${r.over} px`);
    assert.deepEqual(problems, []);
    await page.close();
  });

  test('8: the corner gear is the regular glyph, square and as large as its neighbours', async () => {
    const { GLYPHS } = await import('../../public/js/ui/gameComponents.js');
    for (const [name, w, h, touch] of [view('844x390'), view('756x366'), view('1920x1080')]) {
      const { page, problems } = await open('phase=PREP', { w, h, touch });
      const r = await page.evaluate(() => [...document.querySelectorAll('.gm__corner .gm__gear')].map((b) => {
        const svg = b.querySelector('svg.icon');
        const s = svg.getBoundingClientRect(), br = b.getBoundingClientRect();
        return { cls: b.className, w: s.width, h: s.height, bw: br.width, d: svg.querySelector('path')?.getAttribute('d') };
      }));
      assert.equal(r.length, 3, `${name}: ⚙ 📖 ⛶`);
      assert.equal(r[0].d, GLYPHS.gear, `${name}: the gear glyph`);
      for (const b of r) {
        assert.ok(Math.abs(b.w - b.h) < 0.01, `${name}: ${b.cls} square (${b.w}×${b.h})`);
        assert.ok(b.w >= 0.45 * b.bw && b.w <= 0.55 * b.bw, `${name}: ${b.cls} icon ${b.w} in a ${b.bw} button`);
      }
      await page.screenshot({ path: path.join(OUT, `p5-corner-${name}.png`), clip: { x: 0, y: h - 90, width: 420, height: 90 } });
      assert.deepEqual(problems, [], name);
      await page.close();
    }
  });
});
