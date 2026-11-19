// test/ui/issue963-theme-plates.test.js — GitHub #963: with 卫戍协议终端（官方贴图） (ac_n_initial) the ready button, the 联防
// plate and the result box had a dark ring / box round them: the official sprites (ready_bg's glow, round_bg's and bg_all's
// soft shadow) were 9-sliced without their centre over our own fill and box-shadow, which reached under the whole border.
// For that pack they are drawn as the game draws a sliced Image: the whole sprite (`fill`), nothing of ours under or round
// it. A custom theme keeps the documented hollow slice over our fill (docs/THEMES.md).
// Run: node --test test/ui/issue963-theme-plates.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const css = readFileSync(path.join(ROOT, 'public/css/ui-theme.css'), 'utf8');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const OFFICIAL = 'html[data-sp-theme="ac_n_initial"]';
/** [slice key, element selector] of each sliced plate the official pack paints */
const PLATES = [
  ['prep_ready', '.readybtn:not(.readybtn--pf)'],
  ['coop', '.mpop[data-banner="coop"] .mpop__panel'],
  ['round_result', '.rdialog__box'],
  ['battleEnd', '.rdialog[data-banner="battleEnd"] .rdialog__box'],
  ['perfect', '.rdialog[data-banner="battleEnd"][data-perfect="1"] .rdialog__box'],
];

test('卫戍协议终端（官方贴图）: no fill or shadow of ours under or round the sliced plates', () => {
  const group = PLATES.map(([key, sel]) => `${OFFICIAL}[data-sp-slice~="${key}"] ${sel}`).join(',\n');
  assert.match(css, new RegExp(`${esc(group)} \\{\\n {2}background: none; box-shadow: none;\\n\\}`));
});

test('卫戍协议终端（官方贴图）: each plate draws its sprite whole, centre too (Unity sliced Image, fillCenter)', () => {
  for (const [key, sel] of PLATES) {
    assert.match(css, new RegExp(`${esc(`${OFFICIAL}[data-sp-slice~="${key}"] ${sel}`)} \\{\\s*border-image-slice: var\\(--sp-slice-${key}\\) fill;\\s*\\}`), key);
  }
});

test('a custom theme keeps the hollow slice (no fill): the centre stays our fill', () => {
  assert.match(css, /html\[data-sp-slice~="prep_ready"\] \.readybtn:not\(\.readybtn--pf\) \{[^}]*border-image-slice: var\(--sp-slice-prep_ready\);/);
  for (const [key, sel] of PLATES.slice(1)) {
    if (key === 'round_result') continue;
    assert.match(css, new RegExp(`html\\[data-sp-slice~="${key}"\\] ${esc(sel)} \\{\\n {2}border-width: var\\(--sp-slice-px-${key}\\);\\n {2}border-image-source: var\\(--sp-banner-${key}\\);\\n {2}border-image-slice: var\\(--sp-slice-${key}\\);\\n\\}`), key);
  }
  assert.match(css, /html\[data-sp-slice~="round_result"\] \.rdialog__box \{[^}]*border-image-slice: var\(--sp-slice-round_result\);/);
  // only the official pack's rules carry `fill` on these plates
  const fills = css.match(/border-image-slice: var\(--sp-slice-(prep_ready|coop|round_result|battleEnd|perfect)\) fill/g) || [];
  assert.equal(fills.length, PLATES.length);
});
