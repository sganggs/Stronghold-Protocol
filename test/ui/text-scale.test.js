// 设置 →「文字大小」 (the owner's decision of 2026-10-09): the interface text root `--t` of css/theme.css, stepped by
// the settings store (`sp.pref.settings` textSize), applied to <html data-text> by ui/settings.js applyTextSize.
// A phone clamps the LAYOUT root `1rem` at 40 px (theme.css), which left the .18rem body text at 7.2 CSS px, while the
// browser's own font settings only inflate glyphs inside fixed boxes and page zoom is off (index.html's viewport,
// ui/device.js). Only font-size declarations read `--t`: the five modules that turn `1rem` into pixels — ui/fieldHost.js
// hudPadding / hudBands (the prep camera's HUD clearance), ui/gameLogic/panel.js panelSlots (the detail card's side),
// ui/underframe.js (the tile labels' budget) and ui/fallbackField.js (the DOM board) — must never move with it, and the
// field itself is sized from the host element's clientWidth (render/app.js).
//
// What this file guards: the default is the design's own sizes; a bad or missing value falls back to 小; the step lands
// on <html data-text>; the layout root's clamp is untouched; and every font-size that stayed on a plain `rem` is one of
// the deliberate exclusions (the in-match HUD's fixed boxes, the board-pinned DOM text, geometry-derived sizes, the
// ≥16 px iOS-zoom guards) — a new readable size that forgets `--t` fails here, the way `tools/i18n.mjs extract 0` fails
// on an unwrapped string. Browser counterpart: test/ui/text-scale.e2e.test.js (SP_E2E=1).

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SETTINGS, TEXT_SIZES, sanitizeSettings } from '../../public/js/ui/gameLogic.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const CSS = 'public/css';

/** Every stylesheet under public/css (index.html loads all of them, devices.css last), as { rel, src }. */
function stylesheets() {
  const out = [];
  const visit = (rel) => {
    for (const e of readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) visit(r);
      else if (r.endsWith('.css')) out.push({ rel: r, src: read(r).replace(/\/\*[\s\S]*?\*\//g, '') });
    }
  };
  visit(CSS);
  return out;
}

/** Rules as { selector, body } (flat; @media blocks are walked into, as test/client-static.test.js does). */
function cssRules(src) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(src))) out.push({ selector: m[1].trim(), body: m[2] });
  return out;
}

/**
 * The font sizes that deliberately stay on a plain `rem` (or a bare px): the in-match HUD chrome in fixed boxes, the
 * DOM text pinned onto board tiles, the geometry-derived sizes and the ≥16 px iOS-zoom guards. Listed by selector, the
 * same list the codemod used — a rule that stops being an exclusion (or a new one that should have used `--t`) shows up
 * as a failure with its file and selector.
 */
const NOT_SCALED = [
  // pinned onto board tiles by JS-computed pixels (ui/standInTags.js, ui/underframe.js)
  /\.sitag/, /\.tempnote/, /\.uframe/, /\.ff-/,
  // in-match HUD chrome whose box the design fixed (a later pass: shop cards, top bar, bond strip, corner buttons)
  /\.gm__/, /\.roundbox/, /\.capsule/, /\.lp\b/, /\.lp--/, /\.misstag/, /\.bossbar/, /\.readywrap/,
  /\.bstrip/, /\.bslot/, /\.effect/, /\.efftip/, /\.ebubble/, /\.ticker/, /\.dpbox/, /\.vswitch/,
  /\.specpill/, /\.otwarn/, /\.team/, /\.enemybtn/, /\.readybtn/, /\.ewheel/, /\.fwheel/, /\.chud/, /\.toolbtn/,
  /\.shopbar/, /\.scard/, /\.scr\b/,
  // text inside a fixed-height bar (the HP bar of the detail card, the boss bar's fill)
  /\.dhp\b/,
  // the 机变 card: its grid fits 7 lines of the effect text (game-panels.css), so a bigger font would clamp text away
  /\.spcard/,
  // decorative wordmarks and boot/rotate overlays whose size is the composition
  /\.title-cn/, /\.title-en/, /\.title-bg__target/, /\.brief-boss__q/, /\.boot__/, /\.rotate-hint/,
  // the join code's letter-spaced field, the px-floored 本局信息 dialog, the 16 px diagnostics box (iOS zoom guard)
  /\.field--code/, /\.minfo-dlg/, /\.set-diag__text/,
  // the keyboard hints of the 快捷键 list (a shared rule with the HUD's .toolbtn kbd)
  /\.set-hint kbd/,
];

const notScaled = (selector) => NOT_SCALED.some((re) => re.test(selector));

/**
 * Whole stylesheets a later pass owns: the shop bar's fixed cards (their height feeds the prep camera's HUD band,
 * ui/fieldHost.js HUD_REM), and the 干员调配 / 统计 screens, whose text is already px-floored (`max(.15rem, 11px)`) and
 * therefore readable on a phone as it is. Scaling them is step 2/3 of the change, not a forgotten line.
 */
const NOT_SCALED_FILES = [`${CSS}/screens/game-shop.css`, `${CSS}/screens/loadout.css`, `${CSS}/screens/stats.css`];

/** A font-size value that is neither scaled nor an exclusion: a plain `rem`, or `max(<rem>, …)`. */
function plainRem(value) {
  if (/var\(/.test(value)) return false;              // --t, or a geometry-derived size
  if (/(^|[^r])em\b|%/.test(value.replace(/rem\b/g, ''))) return false;
  return /^\s*(max\(\s*)?\d*\.?\d+rem\b/.test(value);
}

describe('文字大小: the setting', () => {
  test('the default is 小 (the design\'s own sizes) and a saved profile without it keeps it', () => {
    assert.deepEqual([...TEXT_SIZES], ['sm', 'md', 'lg', 'xl'], 'the steps, in the settings order');
    assert.equal(DEFAULT_SETTINGS.textSize, 'sm');
    assert.equal(sanitizeSettings(null).textSize, 'sm');
    assert.equal(sanitizeSettings({ bgm: 0.4 }).textSize, 'sm', 'a profile saved before the setting existed');
  });

  test('every step survives sanitising; anything else falls back to 小', () => {
    for (const v of TEXT_SIZES) assert.equal(sanitizeSettings({ textSize: v }).textSize, v);
    for (const bad of ['huge', 'SM', 'xl2', 'md ', 1, true, null, undefined, {}, []]) {
      assert.equal(sanitizeSettings({ textSize: bad }).textSize, 'sm', String(bad));
    }
    assert.equal(sanitizeSettings({ textSize: 'xl', quality: 'low' }).quality, 'low', 'the other settings are untouched');
  });

  test('applyTextSize writes the step to <html data-text>, and 小 when it is not a step', async () => {
    const { applyTextSize } = await import('../../public/js/ui/settings.js');
    const el = { dataset: {} };
    const prev = globalThis.document;
    globalThis.document = { documentElement: el };
    try {
      for (const v of TEXT_SIZES) {
        applyTextSize(v);
        assert.equal(el.dataset.text, v);
      }
      for (const bad of ['', 'big', null, undefined, 42]) {
        applyTextSize(bad);
        assert.equal(el.dataset.text, 'sm', String(bad));
      }
      applyTextSize(undefined);
      assert.equal(el.dataset.text, 'sm', 'the attribute is always written, never left stale');
    } finally {
      if (prev === undefined) delete globalThis.document; else globalThis.document = prev;
    }
  });

  test('the store applies the step on every change, and at boot before the first render', async () => {
    const { settingsStore, updateSettings } = await import('../../public/js/ui/settings.js');
    const el = { dataset: {} };
    const prev = globalThis.document;
    globalThis.document = { documentElement: el };
    try {
      updateSettings({ textSize: 'lg' });
      assert.equal(el.dataset.text, 'lg', 'picking a step re-renders the text immediately');
      assert.equal(settingsStore.get().textSize, 'lg', 'and it is saved with the settings (sp.pref.settings)');
      updateSettings({ textSize: 'sm' });
      assert.equal(el.dataset.text, 'sm');
    } finally {
      updateSettings({ textSize: DEFAULT_SETTINGS.textSize });
      if (prev === undefined) delete globalThis.document; else globalThis.document = prev;
    }
  });

  test('the settings modal offers the four steps (data-testid text-size), below 画面质量', () => {
    const src = read('public/js/ui/settings.js');
    assert.match(src, /data-testid="text-size"/);
    assert.match(src, /const TEXT_SCALES = \[\[?.*'sm'.*'md'.*'lg'.*'xl'/s, 'the steps with their labels');
    assert.match(src, /applyTextSize\(settingsStore\.get\(\)\.textSize\)/, 'applied at module load (before main.js renders)');
    assert.ok(src.indexOf("t('文字大小')") > src.indexOf("t('画面质量')"), 'the row is below the quality row');
    assert.match(read('public/css/screens/game.css'), /\.set-seg\.set-textsize button \{ min-width: \.62rem; \}/,
      'four steps fit the row on a phone (1rem = 40 px)');
  });
});

describe('文字大小: the CSS text root', () => {
  const sheets = stylesheets();
  const theme = sheets.find((s) => s.rel === `${CSS}/theme.css`).src;

  test('theme.css defines --t for 小 and every step, and nothing else defines it', () => {
    assert.match(theme, /:root \{ --t: 1rem; \}/, '小 = the design\'s own sizes');
    for (const [attr, value] of [['md', /--t: max\(1rem, 64px\)/], ['lg', /--t: max\(calc\(1rem \* 1\.15\), 76px\)/], ['xl', /--t: max\(calc\(1rem \* 1\.3\), 88px\)/]]) {
      assert.match(theme, new RegExp(`:root\\[data-text="${attr}"\\] \\{ ${value.source}; \\}`), `the ${attr} step`);
    }
    for (const { rel, src } of sheets) {
      if (rel === `${CSS}/theme.css`) continue;
      assert.doesNotMatch(src, /--t\s*:/, `${rel}: --t is defined in theme.css only`);
    }
  });

  test('the layout root 1rem is untouched — the five rem→px readers must not move', () => {
    assert.match(theme, /html \{\n {2}font-size: clamp\(40px, min\(calc\(100vw \/ 19\.2\), calc\(100vh \/ 10\.8\)\), 240px\);/,
      'the desktop clamp');
    assert.match(theme, /font-size: clamp\(40px, min\(calc\(100vw \/ 19\.2\), calc\(100svh \/ 10\.8\)\), 240px\);/,
      'the svh clamp (mobile toolbars)');
    assert.doesNotMatch(theme, /font-size: clamp\([^)]*var\(--t\)/, 'the root scale never reads the text root');
    // and the modules that convert it keep their own floor: a text step must not reach them
    for (const f of ['public/js/ui/fieldHost.js', 'public/js/ui/gameLogic/panel.js', 'public/js/ui/underframe.js', 'public/js/ui/fallbackField.js']) {
      const src = read(f);
      assert.doesNotMatch(src, /--t\b|data-text/, `${f}: the layout must not read the text root`);
      assert.match(src, /getComputedStyle\(document\.documentElement\)\.fontSize|rem\b/, `${f}: still converts 1rem`);
    }
  });

  test('readable text reads --t (body, .micro, buttons, modals, panels, settings)', () => {
    const want = [
      [theme, /body \{[^}]*font-size: calc\(\.18 \* var\(--t\)\)/s, 'theme.css body (the 7.2 px text)'],
      [theme, /\.micro \{[^}]*font-size: calc\(\.11 \* var\(--t\)\)/s, 'theme.css .micro (92 render sites)'],
      [theme, /:root\[data-text="md"\]/, 'the steps'],
    ];
    for (const [src, re, what] of want) assert.match(src, re, what);
    const byRel = new Map(sheets.map((s) => [s.rel, s.src]));
    const samples = [
      ['components.css', /\.btn \{[^}]*font-size: calc\(\.18 \* var\(--t\)\)/s],
      ['screens/game.css', /\.set-row__label \{[^}]*font-size: calc\(\.18 \* var\(--t\)\)/s],
      ['screens/game-panels.css', /\.dtext \{ font-size: calc\(\.15 \* var\(--t\)\); line-height: 1\.65;/],
      ['screens/guide.css', /\.guide__tips li \{ font-size: calc\(\.18 \* var\(--t\)\)/],
      ['screens/lobby.css', /\.mode-card__desc/, ],
    ];
    for (const [file, re] of samples) assert.match(byRel.get(`${CSS}/${file}`), re, file);
  });

  test('a newer reader would be caught: every plain rem font-size is a documented exclusion', () => {
    const bad = [];
    let scaled = 0;
    for (const { rel, src } of sheets) {
      if (NOT_SCALED_FILES.includes(rel)) continue;
      for (const { selector, body } of cssRules(src)) {
        for (const m of body.matchAll(/font-size:([^;}]*)/g)) {
          const value = m[1];
          if (/var\(--t\)/.test(value)) { scaled++; continue; }
          if (!plainRem(value)) continue;
          if (notScaled(selector)) continue;
          bad.push(`${rel}: ${selector} { font-size:${value.trim()} }`);
        }
      }
    }
    assert.deepEqual(bad, [], `not on --t and not a documented exclusion (${scaled} declarations do read --t):`);
    assert.ok(scaled >= 250, `${scaled} declarations read --t — a mass revert would fail here`);
  });

  test('the in-match HUD, the board-pinned text and the iOS zoom guards stay as they were', () => {
    const byRel = new Map(sheets.map((s) => [s.rel, s.src]));
    const plain = [
      ['screens/game-panels.css', /\.sitag \{[^}]*font-size: max\(\.12rem, 9px\)/, '.sitag'],
      ['screens/game-panels.css', /\.tempnote__title \{[^}]*font-size: \.15rem/, '.tempnote__title'],
      ['screens/game-panels.css', /\.uframe__label \{[^}]*font-size: \.14rem/, '.uframe__label'],
      ['screens/game-panels.css', /\.spcard__desc \{ flex: none; font-size: \.2rem/, '.spcard__desc (7 clamped lines)'],
      ['screens/game-panels.css', /\.dhp span \{[^}]*font-size: \.12rem/, '.dhp span (a fixed-height HP bar)'],
      ['screens/game-shop.css', /\.scard__name \{[^}]*font-size: \.19rem/, 'the shop card'],
      ['screens/game.css', /\.bslot \.bond__name \{[^}]*font-size: \.14rem/, 'the bond strip'],
      ['screens/game.css', /\.bossbar__txt \{[^}]*font-size: \.14rem/, 'the boss bar'],
      ['screens/game.css', /\.lp--md \{ font-size: \.24rem; \}/, 'the top bar LP'],
      ['screens/game.css', /\.sp-coarse \.set-diag__text \{ font-size: 16px; \}/, 'the 16 px iOS-zoom guard'],
      ['theme.css', /\.rotate-hint \{[\s\S]*?font-size: 16px/, 'the rotate hint'],
    ];
    for (const [file, re, what] of plain) assert.match(byRel.get(`${CSS}/${file}`), re, what);
  });
});
