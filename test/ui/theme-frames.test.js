// test/ui/theme-frames.test.js — theme pictures that no longer stretch whole (history §37.204): a sliced picture on the
// 本局信息 drawer, the top band and the boss bar is a 9-slice frame at the official size; 可露希尔's drawer starts under its
// window's title bar and closes on the window's ✕; unsliced pictures on the drawer and the countdowns keep their aspect.
// The CSS is read as text; the look was checked in a browser (three window sizes, 规程 and 盟约, the three official themes).
// Run: node --test test/ui/theme-frames.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { themeDeclarations } from '../../shared/uiTheme.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const css = read('public/css/ui-theme.css');
/** The slots drawn as a frame, and their host element. */
const FRAMED = { help_battle: '.edrawer', hud_player_info: '.gtop__band:not(.gtop__band--pf)', boss_damage: '.bossbar' };
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every rule of a stylesheet as [selectors[], body] (comments dropped; the rules inside an @media come out too). */
function rules(text) {
  const out = [];
  for (const m of text.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push([m[1].split(',').map((s) => s.trim()), m[2]]);
  }
  return out;
}
const RULES = rules(css);
const bodyOf = (selector) => RULES.filter(([sels]) => sels.includes(selector)).map(([, body]) => body).join('\n');

test('a sliced picture is never stretched whole on the drawer, the top band or the boss bar', () => {
  let seen = 0;
  for (const [sels, body] of RULES) {
    const m = body.match(/background-image:\s*var\(--sp-img-([a-z_]+)\)/);
    if (!m || !(m[1] in FRAMED)) continue;
    seen += 1;
    for (const sel of sels) {
      assert.match(sel, new RegExp(`:not\\(\\[data-sp-slice~="${m[1]}"\\]\\)`), `${sel} paints ${m[1]} only when it has no slice`);
    }
  }
  assert.equal(seen, 3, 'one background rule per framed slot');
});

test('the frame: ::before behind the content, its centre too, the widths of --sp-slice-rem', () => {
  for (const [slot, host] of Object.entries(FRAMED)) {
    const body = bodyOf(`html[data-sp-slice~="${slot}"] ${host}::before`);
    assert.match(body, /content: ''; position: absolute; inset: 0; z-index: -1; pointer-events: none;/, `${slot}: the frame layer`);
    assert.match(body, /border: 0 solid transparent;/, `${slot}: no border box of its own, the layout stays`);
    assert.match(body, new RegExp(`border-image-source: var\\(--sp-img-${slot}\\);`));
    assert.match(body, new RegExp(`border-image-slice: var\\(--sp-slice-${slot}\\) fill;`));
    assert.match(body, new RegExp(`border-image-width: var\\(--sp-slice-rem-${slot}\\);`));
    assert.match(bodyOf(`html[data-sp-slice~="${slot}"] ${host}`), /isolation: isolate;/, `${slot}: the frame stays over the box's own fill`);
  }
});

test('可露希尔: the rows start under the title bar, the close button lies on the window ✕, no amber corners', () => {
  const pre = 'html[data-sp-theme="ac_s_closur"][data-sp-slice~="help_battle"]';
  assert.match(bodyOf(`${pre} .edrawer`), /padding-top: calc\(26 \* \.0144rem\); border-color: transparent;/);
  assert.match(bodyOf(`${pre} .edrawer::after`), /display: none;/);
  const close = bodyOf(`${pre} .edrawer__close`);
  assert.match(close, /position: absolute; top: calc\(4 \* \.0144rem\); right: calc\(4 \* \.0144rem\);/);
  assert.match(close, /width: calc\(22 \* \.0144rem\); height: calc\(22 \* \.0144rem\);/);
  assert.match(close, /border-color: transparent; background: none;/);
  assert.match(bodyOf(`${pre} .edrawer__close .icon`), /visibility: hidden;/);
  assert.match(css, new RegExp(`${esc(pre)} \\.edrawer__close \\{`), 'one rule, keyed on the theme');
});

test('unsliced pictures keep their aspect: the drawer picture and the three countdown plates (contain)', () => {
  for (const slot of ['help_battle', 'countdown', 'countdown_effectchoose', 'countdown_outer']) {
    const hits = RULES.filter(([, body]) => body.includes(`background-image: var(--sp-img-${slot});`));
    assert.ok(hits.length >= 1, slot);
    for (const [sels, body] of hits) assert.match(body, /background-size: contain; background-position: center;/, sels.join(', '));
  }
});

test('--sp-slice-rem: one prefab unit is OFFICIAL_SCALE / 100 rem (ui/prefab/hud.js)', () => {
  const scale = Number(read('public/js/ui/prefab/hud.js').match(/export const OFFICIAL_SCALE = ([\d.]+);/)?.[1]);
  assert.ok(scale > 0);
  const slice = [38, 62, 16, 124]; // 可露希尔's window_main_frame
  const d = themeDeclarations({ id: 'x', images: { help_battle: { url: 'blob:h', slice } } });
  assert.equal(d.props['--sp-slice-rem-help_battle'], slice.map((n) => `${Number((n * scale / 100).toFixed(4))}rem`).join(' '));
  assert.equal(d.props['--sp-slice-rem-help_battle'], '0.5472rem 0.8928rem 0.2304rem 1.7856rem');
  assert.ok(d.slices.includes('help_battle'));
  // no slice: no frame widths (the stretched / contained rules apply)
  assert.equal(themeDeclarations({ id: 'x', images: { help_battle: { url: 'blob:h' } } }).props['--sp-slice-rem-help_battle'], undefined);
});
