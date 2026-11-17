// test/ui/round78-ui.test.js — the owner's playtest of 2026-11-14 (history §37.201), the CSS / markup halves that have no
// behaviour of their own to drive: thumbnails' tier marks readable, the top bar's 🔍 buttons at their pictures' aspect,
// 可露希尔's TVs behind the bond row, the overtime warning over the effects column, the shop's repeated-operator
// highlight. Behaviour lives elsewhere: bond-scroll.e2e (drag), regulation-commands.e2e (aim arrow, reminder),
// feedback3-ready (prompts), leader-rank (spot), show-tags (texts), band-command (aim path).
// Run: node --test test/ui/round78-ui.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

test('thumbnail tier marks: at least 16 / 15 / 12 px, never scaled down; themed icons a size up', () => {
  const panels = read('public/css/screens/game-panels.css');
  assert.match(panels, /\.uthumb \.uthumb__tier \{[^}]*--tier-h: max\(\.26rem, 16px\)/);
  assert.match(panels, /\.uthumb--sm \.uthumb__tier \{ --tier-h: max\(\.24rem, 15px\); \}/);
  assert.match(panels, /\.uthumb--xs \.uthumb__tier \{ --tier-h: max\(\.18rem, 12px\);/);
  assert.doesNotMatch(panels, /uthumb__tier[^{]*\{[^}]*scale\(\.66\)/);
  const theme = read('public/css/ui-theme.css');
  assert.match(theme, /html\[data-sp-theme="ac_s_closur"\]\[data-sp-slot~="chess_level_icon_1"\] \.uthumb \.uthumb__tier \{ --tier-h: max\(\.42rem, 26px\);/);
  assert.match(theme, /html\[data-sp-theme="ac_n_iron"\]\[data-sp-slot~="chess_level_icon_1"\] \.uthumb \.uthumb__tier \{[^}]*width: calc\(var\(--tier-h\) \* 59 \/ 34\)/);
});

test('top bar 🔍 buttons: a theme picture keeps its aspect (measured into --sp-ar-<slot>), the box height stays', async () => {
  const theme = read('public/css/ui-theme.css');
  assert.match(theme, /\.gtop__iconbtn\.has-sprite \{ width: auto; aspect-ratio: var\(--sp-ar-img_check_player, 35 \/ 29\); \}/);
  assert.match(theme, /\.enemybtn\.has-sprite \{ width: auto; aspect-ratio: var\(--sp-ar-img_check_enemy, 35 \/ 29\); \}/);
  globalThis.fetch ??= async () => ({ ok: false, status: 404, json: async () => ({}) });
  const { ASPECT_SLOTS } = await import('../../public/js/uiTheme.js');
  assert.deepEqual([...ASPECT_SLOTS], ['img_check_player', 'img_check_enemy']);
});

test('可露希尔: the bond row draws over the prefab band (its TVs), the overtime warning over the effects column', () => {
  const reg = read('public/css/screens/game-reghud.css');
  assert.match(reg, /\.gtop--pf ~ \.gm__bonds \{ z-index: 2; \}/);
  assert.match(reg, /\.gtop__band\.gtop__band--pf \{ position: relative; z-index: 1; \}/);
  const game = read('public/css/screens/game.css');
  assert.match(game, /\.otwarn \{\n {2}position: relative; z-index: 3;[^}]*width: max-content;/);
});

test('shop: an operator the player holds (≥ 1 copy) wears the repeated-operator highlight, in both card layouts', () => {
  const shop = read('public/js/ui/shopBar.js');
  assert.match(shop, /const repeat = prog\.copies > 0 && reason !== t\('已售出'\);/);
  assert.equal((shop.match(/repeat && 'is-repeat'/g) || []).length, 2, '规程 and 盟约 cards');
  assert.equal((shop.match(/\$\{repeatFx\}/g) || []).length, 2);
  const css = read('public/css/screens/game-shop.css');
  assert.match(css, /\.scard__repeat \{[^}]*--repeat-c: var\(--sp-c-skin-light, #ffe9a6\)/);
  assert.match(css, /\.scard__repeatglow \{[^}]*animation: scard-repeat-flow 2\.5s/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.scard__repeat, \.scard__repeatglow \{ animation: none; \} \}/);
});
