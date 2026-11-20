// test/ui/round83-ui.test.js — community UI reports of round 83 (after 0.4.0).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

test('规程 shop on a short landscape screen: the scroll box leaves room for the armed card lift, the band passes taps (#963)', () => {
  const reg = read('public/css/screens/game-reghud.css');
  const shop = read('public/css/screens/game-shop.css');
  // the block that styles the shop row (an earlier one-line block of the same query moves the detail card)
  const at = reg.indexOf('@media (max-height: 430px) {\n');
  assert.ok(at >= 0, 'the short-landscape block exists');
  const block = reg.slice(at, reg.indexOf('\n}\n', at));
  const row = block.match(/\.shopbar--reg \.shopbar__row \{([^}]*)\}/)?.[1] ?? '';
  assert.match(row, /overflow-y:\s*auto/, 'the row still scrolls (it clips)');
  const pad = Number(row.match(/padding-top:\s*([\d.]+)rem/)?.[1] ?? 0);
  const pull = Number(row.match(/margin-top:\s*-([\d.]+)rem/)?.[1] ?? 0);
  assert.equal(pull, pad, 'the band reaches up without moving the cards');
  const armed = shop.match(/\.scard\.is-armed \{([^}]*)\}/)?.[1] ?? '';
  const lift = Number(armed.match(/translateY\(-([\d.]+)rem\)/)?.[1]);
  const scale = Number(armed.match(/scale\(([\d.]+)\)/)?.[1]);
  const cardH = Number(block.match(/\.shopbar--reg \.scard \{[^}]*height:\s*([\d.]+)rem/)?.[1]);
  assert.ok(lift > 0 && scale > 1 && cardH > 0, 'read the lift, the scale and the card height');
  // the lift, half the growth of the card, and its 2 px gold outline (about .05rem on a phone)
  const need = lift + ((scale - 1) / 2) * cardH + 0.05;
  assert.ok(pad >= need, `padding-top ${pad}rem ≥ ${need.toFixed(3)}rem`);
  assert.match(row, /pointer-events:\s*none/, 'the transparent band does not take taps meant for the field');
  assert.match(block, /\.shopbar--reg \.shopbar__row > \* \{\s*pointer-events:\s*auto;\s*\}/, 'the cards still take taps');
});

/** The comma-separated layers of a CSS value, commas inside parentheses kept. */
function topLevelLayers(value) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}

test('theme pictures: no colour inside a background-image list (the whole declaration would be dropped; round 83)', () => {
  const css = read('public/css/ui-theme.css').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [, value] of css.matchAll(/background-image:\s*([^;}]+)/g)) {
    for (const layer of topLevelLayers(value)) {
      assert.doesNotMatch(layer.trim(), /^(rgba?|hsla?)\(|^#[0-9a-f]{3,8}$/i, `not an <image>: ${value.trim()}`);
    }
  }
});
