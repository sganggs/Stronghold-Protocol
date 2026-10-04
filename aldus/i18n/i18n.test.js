// The i18n layer of the Aldus build (aldus/i18n): the catalogs, the translator, the choice of the locale, and how much of
// the original client's interface text each catalog covers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTranslator, negotiate, tidy, CJK } from './translator.js';
import { extractFragments, coverage } from './extract.mjs';
import { buildCatalogs, operatorNames } from '../build.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const catalogs = fs.readdirSync(path.join(HERE, 'locales')).filter((f) => f.endsWith('.json'))
  .map((f) => [f, JSON.parse(fs.readFileSync(path.join(HERE, 'locales', f), 'utf8'))]);

test('every catalog is well formed: a locale, source strings as keys, translations without source text', () => {
  assert.ok(catalogs.length >= 1);
  for (const [file, cat] of catalogs) {
    assert.equal(`${cat.locale}.json`, file);
    assert.ok(cat.name, `${file}: a name for the language switch`);
    for (const [k, v] of Object.entries(cat.messages)) {
      assert.ok(CJK.test(k), `${file}: the key "${k}" is source text`);
      assert.equal(typeof v, 'string', `${file}: "${k}"`);
      assert.ok(!CJK.test(v), `${file}: the translation of "${k}" still has source text`);
    }
    for (const [re, to] of cat.patterns) {
      assert.doesNotThrow(() => new RegExp(re), `${file}: ${re}`);
      assert.ok(re.startsWith('^') && re.endsWith('$'), `${file}: ${re} matches a whole string`);
      assert.ok(!CJK.test(to), `${file}: the replacement of ${re}`);
    }
  }
});

test('translate: a whole string, a pattern, a string cut into known parts — or nothing', () => {
  const { translate, missing } = createTranslator({
    messages: { '开始': 'Start', '整备区': 'Bench', '已满': 'is full', '第': '#', '名': '' },
    patterns: [['^第\\s*(\\d+)\\s*回合$', 'Round $1'], ['^(.+)博士中途退出了模拟$', 'Dr. $1 left']],
  });
  assert.equal(translate('开始'), 'Start');
  assert.equal(translate('  开始\n'), '  Start\n', 'white space around the text stays');
  assert.equal(translate('第 3 回合'), 'Round 3');
  assert.equal(translate('开始博士中途退出了模拟'), 'Dr. Start left', 'a known name inside a pattern is translated too');
  assert.equal(translate('小明博士中途退出了模拟'), 'Dr. 小明 left', 'a name a player typed stays');
  assert.equal(translate('整备区已满'), 'Bench is full', 'cut into two known parts');
  assert.equal(translate('整备区，已满。'), 'Bench, is full.', 'punctuation of the source becomes that of the translation');
  assert.equal(translate('名'), '', 'an empty translation is a translation');
  assert.equal(translate('整备区第三'), null, 'one unknown part: nothing changes');
  assert.equal(translate('第'), '#');
  assert.equal(translate('整备区第'), null, 'a one-character message is a word only when it stands alone');
  assert.equal(translate('Start 12'), null, 'no source text: nothing to do');
  assert.deepEqual([...missing], ['整备区第三', '整备区第']);
  assert.equal(tidy('a ，b（c）'), 'a, b (c)');
});

test('negotiate: the address, then the saved choice, then the default; the source language means no catalog', () => {
  const base = { available: ['en'], source: 'zh', fallback: 'en' };
  assert.equal(negotiate(base), 'en', 'a first visit shows English');
  assert.equal(negotiate({ ...base, saved: 'zh' }), 'zh');
  assert.equal(negotiate({ ...base, query: 'zh-CN', saved: 'en' }), 'zh', 'the address wins');
  assert.equal(negotiate({ ...base, query: 'en-US' }), 'en');
  assert.equal(negotiate({ ...base, query: 'fr', saved: 'zh' }), 'zh', 'an unknown locale is passed over');
  assert.equal(negotiate({ ...base, query: 'fr' }), 'en');
  assert.equal(negotiate({ available: [], source: 'zh', fallback: 'en' }), 'zh', 'no catalog: the source');
});

test('the English catalog covers the interface text of the original client', () => {
  const fragments = extractFragments();
  assert.ok(fragments.length > 500, `${fragments.length} fragments found`);
  const en = buildCatalogs().en;
  const c = coverage(en, fragments);
  // after a merge from the original project new text may appear: it stays Chinese on the page until it is translated,
  // and `node aldus/i18n/extract.mjs --missing` lists it
  assert.ok(c.translated / c.total >= 0.97, `${c.translated} of ${c.total}; missing: ${c.missing.slice(0, 8).map(([t]) => t).join(' | ')}`);
});

test('the operator names come from the game data, and a catalog entry wins over them', () => {
  const names = operatorNames();
  assert.ok(Object.keys(names).length > 100);
  for (const [zh, latin] of Object.entries(names)) assert.ok(CJK.test(zh) && !CJK.test(latin), `${zh} → ${latin}`);
  const en = buildCatalogs().en;
  const [someName] = Object.keys(names);
  assert.equal(en.messages[someName], names[someName]);
  assert.equal(en.messages['开始'], 'Start');
});
