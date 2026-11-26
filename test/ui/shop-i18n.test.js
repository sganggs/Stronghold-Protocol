// test/ui/shop-i18n.test.js — the shop's i18n surface.
// 1) every key the shop shows exists in the four non-default language packs: the literals of t('…') and the
//    module-level N_('…') marks (host.js CONTROL_LABELS and the freeze label) that tools/i18n.mjs extracts;
// 2) a language switch changes the mount key, and every data file the card model reads (LOCALE_FILES)
//    repaints the live host when it arrives late.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LOCALE_FILES, shopMountKey } from '../../public/js/ui/shop/ShopCanvas.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const LANGS = ['en', 'ja', 'ko', 'zh-TW'];
const SHOP_DIR = join(ROOT, 'public/js/ui/shop');

/** t('…') at the call site and N_('…') where a label is marked for translation at module level. */
const CALLS = [/\bt\(\s*'([^']+)'/g, /\bN_\(\s*'([^']+)'/g];

function shopFiles(dir = SHOP_DIR, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) shopFiles(path, out);
    else if (name.endsWith('.js')) out.push(path);
  }
  return out;
}

function literals() {
  const keys = new Set();
  for (const file of shopFiles()) {
    const source = readFileSync(file, 'utf8');
    for (const pattern of CALLS) {
      for (const match of source.matchAll(pattern)) keys.add(match[1]);
    }
  }
  return keys;
}

test('every shop t()/N_() key exists in en/ja/ko/zh-TW', () => {
  const keys = literals();
  assert.ok(keys.size > 0, 'shop uses t()');
  // a scan that stops seeing N_() loses keys silently, so pin a few of host.js's marks to the scan itself
  for (const key of ['展开商店', '收起商店', '解冻', '冻结']) assert.ok(keys.has(key), `N_() scan misses ${key}`);
  for (const lang of LANGS) {
    const messages = JSON.parse(readFileSync(join(ROOT, `public/i18n/${lang}.json`), 'utf8'));
    const missing = [...keys].filter((key) => !Object.prototype.hasOwnProperty.call(messages, key));
    assert.deepEqual(missing, [], `${lang} is missing shop keys`);
  }
});

test('the shop mount key changes with the language and defaults to zh', () => {
  assert.equal(shopMountKey('zh'), 'zh');
  assert.equal(shopMountKey('en'), 'en');
  assert.equal(shopMountKey('ja'), 'ja');
  assert.equal(shopMountKey('ko'), 'ko');
  assert.equal(shopMountKey('zh-TW'), 'zh-TW');
  assert.notEqual(shopMountKey('zh'), shopMountKey('en'), 'a language switch remounts the host');
  assert.equal(shopMountKey(null), 'zh');
  assert.equal(shopMountKey(undefined), 'zh');
});

test('LOCALE_FILES lists every data file the card model reads', () => {
  // The live repaint is the ShopCanvas data subscription (a Preact mount this suite has no DOM renderer for),
  // and its filter is exactly this list, so the list is the contract pinned here.
  for (const name of ['chess', 'items', 'bonds', 'garrisons', 'assets', 'backups', 'local']) {
    assert.ok(LOCALE_FILES.includes(name), `${name} repaints the canvas when it arrives`);
  }
});
