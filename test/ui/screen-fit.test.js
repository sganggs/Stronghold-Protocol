// 设置 →「异形屏适配」 (ui/screenFit.js): four 0–100 sliders (50 = unchanged, 2 CSS px a step, ±100 px) move the edges of
// the interface for a screen whose cutout or curved edge the browser does not report. What this file guards: the stored
// value is clamped and whole; the slider ↔ pixel mapping; <html data-fit> and --fit-* only while an edge is moved (all
// four at 0 leave the page exactly as before); the stylesheet's inset box and layout root under [data-fit] alone; and
// the prep camera's HUD bands measured from the board's host, which starts below the top inset.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const F = await import('../../public/js/ui/screenFit.js');
const { hudBands } = await import('../../public/js/ui/fieldHost.js');

describe('the stored offsets and the sliders', () => {
  test('sanitizeFit: whole pixels within ±100, anything else 0', () => {
    assert.deepEqual(F.sanitizeFit(null), { l: 0, r: 0, t: 0, b: 0 });
    assert.deepEqual(F.sanitizeFit({ l: 12.4, r: -300, t: 160, b: 'x' }), { l: 12, r: -100, t: 100, b: 0 });
    assert.deepEqual(F.sanitizeFit({ l: Infinity, extra: 5 }), { l: 0, r: 0, t: 0, b: 0 });
  });
  test('sliderOf / pxOf: 50 = unchanged, 2 px a step, 0 and 100 at the ends', () => {
    assert.equal(F.sliderOf(0), 50);
    assert.equal(F.sliderOf(F.FIT_MAX), 100);
    assert.equal(F.sliderOf(F.FIT_MIN), 0);
    assert.equal(F.pxOf(51), 2);
    assert.equal(F.pxOf('40'), -20);
    for (const px of [-100, -2, 0, 6, 100]) assert.equal(F.pxOf(F.sliderOf(px)), px);
  });
});

describe('applyFit on <html>', () => {
  /** A stand-in for document.documentElement: dataset and the inline custom properties. */
  function withRoot(fn) {
    const g = globalThis;
    const saved = { document: g.document, dispatchEvent: g.dispatchEvent };
    const props = new Map();
    const el = { dataset: {}, style: { setProperty: (k, v) => props.set(k, v), removeProperty: (k) => props.delete(k) } };
    let resized = 0;
    g.document = { documentElement: el };
    g.dispatchEvent = (e) => { if (e?.type === 'resize') resized++; return true; };
    try { fn(el, props, () => resized); } finally { g.document = saved.document; g.dispatchEvent = saved.dispatchEvent; }
  }
  test('an edge moved: data-fit and the four --fit-* in px, then a resize for the board and the HUD', () => {
    withRoot((el, props, resized) => {
      F.applyFit({ l: 0, r: 0, t: 24, b: -10 });
      assert.ok('fit' in el.dataset);
      assert.deepEqual(Object.fromEntries(props), { '--fit-l': '0px', '--fit-r': '0px', '--fit-t': '24px', '--fit-b': '-10px' });
      assert.equal(resized(), 1);
    });
  });
  test('all four at 0: no attribute, no property — the page as before', () => {
    withRoot((el, props) => {
      F.applyFit({ l: 8, r: 0, t: 0, b: 0 });
      F.applyFit({ l: 0, r: 0, t: 0, b: 0 });
      assert.ok(!('fit' in el.dataset));
      assert.equal(props.size, 0);
    });
  });
});

test('the stylesheet: the inset box and its layout root only under [data-fit]', () => {
  const css = readFileSync(path.join(ROOT, 'public/css/devices.css'), 'utf8');
  const sec = css.slice(css.indexOf('/* ---- 5. 异形屏适配'));
  assert.ok(sec.length > 0 && sec.length < css.length);
  const root = sec.match(/html\[data-fit\] \{([^}]*)\}/)?.[1] || '';
  assert.match(root, /font-size: clamp\(40px, min\(calc\(\(100vw - var\(--fit-l, 0px\) - var\(--fit-r, 0px\)\) \/ 19\.2\), calc\(\(100vh - var\(--fit-t, 0px\) - var\(--fit-b, 0px\)\) \/ 10\.8\)\), 240px\);/);
  assert.match(root, /font-size: clamp\(40px, min\(calc\(\(100vw - var\(--fit-l, 0px\) - var\(--fit-r, 0px\)\) \/ 19\.2\), calc\(\(100svh - var\(--fit-t, 0px\) - var\(--fit-b, 0px\)\) \/ 10\.8\)\), 240px\);/,
    'theme.css\'s layout root, with the insets taken off (svh after the vh fallback)');
  assert.match(sec, /html\[data-fit\] :is\(\.app-root, \.st, \.lo, \.guide\) \{\n {2}left: var\(--fit-l, 0px\); right: var\(--fit-r, 0px\); top: var\(--fit-t, 0px\); bottom: var\(--fit-b, 0px\);/);
  assert.doesNotMatch(sec, /!important/);
  assert.doesNotMatch(sec, /--t\s*:/, 'the text size setting is left alone');
  const settings = readFileSync(path.join(ROOT, 'public/js/ui/settings.js'), 'utf8');
  assert.match(settings, /<\$\{ScreenFitSection\} \/>/, 'the section is in the settings modal');
});

describe('hudBands from the board\'s host', () => {
  function withDom({ fieldTop, hudTop, hudBottom }, fn) {
    const g = globalThis;
    const saved = { document: g.document, getComputedStyle: g.getComputedStyle };
    const root = { classList: { contains: () => false } };
    g.getComputedStyle = () => ({ fontSize: '100px', getPropertyValue: () => '' });
    const rect = (r) => ({ getBoundingClientRect: () => r });
    g.document = {
      documentElement: root,
      querySelector: (s) => (s === '.gm__field' ? rect({ top: fieldTop }) : s === '.gm__hud' ? rect({ top: hudTop, bottom: hudBottom }) : null),
      querySelectorAll: () => [],
    };
    try { return fn(); } finally { g.document = saved.document; g.getComputedStyle = saved.getComputedStyle; }
  }
  test('a top inset moves the host and the HUD alike: the bands stay those of the unmoved page', () => {
    const size = { width: 1920, height: 1000 };
    const plain = withDom({ fieldTop: 0, hudTop: 0, hudBottom: 1000 }, () => hudBands('prep', size, { shop: false }));
    const moved = withDom({ fieldTop: 40, hudTop: 40, hudBottom: 1040 }, () => hudBands('prep', size, { shop: false }));
    assert.deepEqual(moved, plain);
    assert.deepEqual(withDom({ fieldTop: 40, hudTop: 40, hudBottom: 1040 }, () => hudBands('prep', size)),
      withDom({ fieldTop: 0, hudTop: 0, hudBottom: 1000 }, () => hudBands('prep', size)));
  });
});
