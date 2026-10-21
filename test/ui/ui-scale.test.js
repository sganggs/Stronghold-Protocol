// 设置 →「界面缩放」 (ui/uiScale.js): one dimensionless `--sp-ui` on <html> that resizes the whole interface, with the
// 75…150 % slider, plus `--sp-shop` — the shop bar's own extra ratio (css/screens/game-shop.css). What this file guards:
// the stored setting; the automatic factor (1 while the design fits, fit / 40 on a short screen, never under the floor,
// the player's 异形屏适配 offsets taken off first); the slider's factor and its percent; <html> gets the properties only
// while they are not 1 and a resize follows the change once; the shop ratio the HUD band (ui/fieldHost.js) also reads;
// and the stylesheet side — the layout root, the px touch floors and the shop bar both ride on the same variables, so a
// later edit cannot drop one of them.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const U = await import('../../public/js/ui/uiScale.js');
const F = await import('../../public/js/ui/screenFit.js');
const FH = await import('../../public/js/ui/fieldHost.js');

const win = (innerWidth, innerHeight, vh = innerHeight) => ({ innerWidth, innerHeight, visualViewport: { height: vh } });
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

describe('the stored setting', () => {
  test('sanitizeScale: 自动 or a 75…150 percentage snapped to the slider step', () => {
    assert.equal(U.sanitizeScale('auto'), 'auto');
    assert.equal(U.sanitizeScale(85), 85);
    assert.equal(U.sanitizeScale('92'), 90, 'snapped to the 5 % step');
    assert.equal(U.sanitizeScale(150), 150);
    assert.equal(U.sanitizeScale(200), 150, 'clamped to the range');
    assert.equal(U.sanitizeScale(40), 75, 'a percentage under the range stops at the slider end');
    for (const v of [null, undefined, '', 'huge', 3, {}]) assert.equal(U.sanitizeScale(v), 'auto');
    // the four gears of the first build are not steps any more
    for (const v of ['sm', 'full', 'lg']) assert.equal(U.sanitizeScale(v), 'auto');
  });
  test('setUiScale / getUiScale round-trip: the store holds { step } (js/store.js spreads its initial state)', () => {
    const saved = U.getUiScale();
    try {
      U.setUiScale(90);
      assert.equal(U.getUiScale(), 90);
      // a bare number as the store's initial state would be spread into {'0':'9','1':'0'} and every step would read as auto
      assert.deepEqual(Object.keys(U.uiScaleStore.get()), ['step']);
      assert.equal(U.scaleFactor(), U.scaleFactor(90), 'the default factor is the chosen step');
      U.setUiScale('nonsense');
      assert.equal(U.getUiScale(), 'auto');
    } finally {
      U.setUiScale(saved);
    }
  });
});

describe('the automatic factor', () => {
  test('a desktop the design fits: exactly 1 (nothing changes on 1920×1080)', () => {
    assert.equal(U.autoScaleFactor(win(1920, 1080)), 1);
    assert.equal(U.autoScaleFactor(win(2560, 1080)), 1);
  });
  test('a short phone: fit / 40 with the visible height — 756×366 is the reported case', () => {
    // min(756/19.2, 366/10.8) = 33.89 → 33.89 / 40
    assert.ok(Math.abs(U.autoScaleFactor(win(756, 366)) - 33.8889 / 40) < 1e-3);
    assert.ok(Math.abs(U.autoScaleFactor(win(844, 390)) - Math.min(844 / 19.2, 390 / 10.8) / 40) < 1e-3);
  });
  test('the browser toolbars showing count: the visible height, not the layout height', () => {
    assert.equal(U.autoScaleFactor(win(1920, 1080, 900)), Math.min(1, Math.min(1920 / 19.2, 900 / 10.8) / 40));
  });
  test('a very short screen stops at the floor, never under UI_SCALE_MIN', () => {
    assert.equal(U.autoScaleFactor(win(640, 200)), U.UI_SCALE_MIN);
    assert.equal(U.UI_SCALE_MIN, 0.66);
  });
  test('the 异形屏适配 offsets are taken off fit, as devices.css does', () => {
    const saved = F.fitStore.get();
    try {
      F.fitStore.set({ l: 96, r: 0, t: 0, b: 0 });
      // (1920 − 96) / 19.2 = 95 → still 1; a short screen reveals the arithmetic
      assert.equal(U.autoScaleFactor(win(1920, 1080)), 1);
      F.fitStore.set({ l: 0, r: 0, t: 0, b: 0 });
      F.fitStore.set({ l: 0, r: 0, t: 0, b: 40 });
      assert.ok(Math.abs(U.autoScaleFactor(win(756, 366)) - (366 - 40) / 10.8 / 40) < 1e-9);
    } finally {
      F.fitStore.set(saved);
    }
  });
});

describe('the slider', () => {
  test('自动 follows the screen; a pinned percentage is the factor itself, above 100 % too', () => {
    const short = win(756, 366);
    close(U.scaleFactor('auto', short), U.autoScaleFactor(short));
    assert.equal(U.scaleFactor(100, short), 1, '100 % is the design size on any screen');
    assert.equal(U.scaleFactor(75, short), 0.75);
    assert.equal(U.scaleFactor(150, win(1920, 1080)), 1.5, 'the slider may enlarge a desktop');
    assert.equal(U.scalePercent('auto', short), 85, '756×366: the number the slider shows in 自动');
    assert.equal(U.scalePercent(120, short), 120);
  });
});

describe('the shop bar ratio', () => {
  test('1 while the design fits, min(1.12, 1 / k) below it, so the bar lags the shrink', () => {
    assert.equal(U.shopRatio(1), 1);
    assert.equal(U.shopRatio(1.4), 1, 'a manual enlargement does not shrink the bar');
    assert.equal(U.shopRatio(0.85), 1.12);
    assert.equal(U.shopRatio(0.5), 1.12, 'capped: the bar is never more than 12 % over the rest');
  });
});

describe('applyUiScale on <html>', () => {
  /** A stand-in for document.documentElement: the inline custom properties and a resize counter. */
  function withRoot(fn) {
    const g = globalThis;
    const saved = { document: g.document, dispatchEvent: g.dispatchEvent, win: g };
    const props = new Map();
    const el = {
      style: {
        setProperty: (k, v) => props.set(k, v),
        removeProperty: (k) => props.delete(k),
        getPropertyValue: (k) => props.get(k) ?? '',
      },
    };
    let resized = 0;
    g.document = { documentElement: el };
    g.dispatchEvent = (e) => { if (e?.type === 'resize') resized++; return true; };
    try { fn(el, props, () => resized); } finally { g.document = saved.document; g.dispatchEvent = saved.dispatchEvent; }
  }
  test('a pinned step under 100 %: --sp-ui and --sp-shop set, and one resize for the HUD', () => {
    withRoot((el, props, resized) => {
      U.applyUiScale(85);
      assert.equal(props.get('--sp-ui'), '0.85');
      assert.equal(props.get('--sp-shop'), '1.12');
      assert.equal(resized(), 1);
    });
  });
  test('a pinned step over 100 %: --sp-ui above 1, no shop ratio', () => {
    withRoot((el, props) => {
      U.applyUiScale(150);
      assert.equal(props.get('--sp-ui'), '1.5');
      assert.equal(props.has('--sp-shop'), false);
    });
  });
  test('100 %: no property at all — the page is exactly the design', () => {
    withRoot((el, props) => {
      U.applyUiScale(85);
      U.applyUiScale(100);
      assert.equal(props.size, 0);
    });
  });
  test('the same factor twice: no second resize (the handler would loop otherwise)', () => {
    withRoot((el, props, resized) => {
      U.applyUiScale(85);
      U.applyUiScale(85);
      assert.equal(resized(), 1);
    });
  });
});

describe('the stylesheet side', () => {
  const css = (f) => readFileSync(path.join(ROOT, 'public/css', f), 'utf8');
  test('theme.css: the layout root multiplies the design rule by --sp-ui, both viewport units', () => {
    const theme = css('theme.css');
    assert.match(theme, /font-size: calc\(clamp\(40px, min\(calc\(100vw \/ 19\.2\), calc\(100vh \/ 10\.8\)\), 240px\) \* var\(--sp-ui, 1\)\)/);
    assert.match(theme, /font-size: calc\(clamp\(40px, min\(calc\(100vw \/ 19\.2\), calc\(100svh \/ 10\.8\)\), 240px\) \* var\(--sp-ui, 1\)\)/);
  });
  test('theme.css: 文字大小 floors ride on the same variable', () => {
    const theme = css('theme.css');
    for (const n of ['64px', '76px', '88px']) {
      assert.ok(theme.includes(`calc(${n} * var(--sp-ui, 1))`), `${n} floor carries --sp-ui`);
    }
  });
  test('devices.css: the 异形屏适配 box and the touch floors ride on the same variable', () => {
    const dev = css('devices.css');
    assert.match(dev, /html\[data-fit\] \{[\s\S]*?\/ 10\.8\)\), 240px\) \* var\(--sp-ui, 1\)\)/);
    for (const n of ['34px', '30px', '26px']) {
      assert.ok(dev.includes(`calc(${n} * var(--sp-ui, 1))`), `${n} touch floor carries --sp-ui`);
    }
  });
  test('game-shop.css: the bar rides on --sp-shop as a whole (zoom), at its design size otherwise', () => {
    const shop = css('screens/game-shop.css');
    // the bar and the folded tab are zoomed together: every rem length, border and card art scales with it
    assert.match(shop, /\.gm__hud > \.shopbar, \.gm__hud > \.shopbar-tab \{ zoom: var\(--sp-shop, 1\); \}/);
    // its own rules stay at the design size (the official layout the research notes measure)
    assert.match(shop, /\.shopbar \{\n {2}position: absolute; right: \.26rem; bottom: \.2rem;/);
    // the band ui/fieldHost.js builds from HUD_REM must keep the same ratio
    assert.equal(FH.HUD_REM.shopBarTop, 2.64);
  });
});
