// Language packs as content packs (docs/I18N.md "Adding a language", docs/PACKS.md): discovery (server/packs.js — the
// language folders and the pack folders, a pack dropped in shows without a restart; GET /packs/index.json and the file
// allowlist), the manifest (shared/packs.js: types, app ranges), the fallback chain (shared/i18n.js: base, fallback, the
// Chinese msgid), placeholder validation, plural categories (Intl.PluralRules: English unchanged, Russian named forms),
// the per-text fallback of game texts (shared/i18nData.js onto, data.js chains), the client loader and menu
// (ui/lang.js), the translator tools (tools/i18n.mjs template / check, tools/packs.mjs index), the machine-translation
// mark (`_meta.machineTranslated`: the manifest, the index, the client's registry, the 设置 note), and that the Chinese
// and English output of t() is what it was before packs. The example packs live only here, in temporary folders ('qaa'
// … 'qtz' are the ISO 639 codes reserved for local use).

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { APP_VERSION } from '../shared/constants.js';
import {
  t, tc, tParts, setLang, getLang, addMessages, setMessages, setI18nWarn, registerLangs, getLangs, langChain, langInfo, normalizeLang,
  checkTranslation, parsePluralForms, pluralCategory, format,
} from '../shared/i18n.js';
import { canonicalLang, computeChain, scriptOf, langFields, packMeta } from '../shared/i18nPacks.js';
import { normalizeManifest, appVersionMatches, isVersionRange, readPackIndex, langMetaOf, PACK_TYPES, isPackPath, packIndexEntry } from '../shared/packs.js';
import { buildRecordOverlay, applyFileOverlay, applyRecordOverlay } from '../shared/i18nData.js';
import { buildOverlay, LANG_SOURCES } from '../tools/build-i18n.mjs';
import { scanPacks, createPackRegistry, packIndexOf } from '../server/packs.js';
import { createDataStore } from '../public/js/data.js';
import { checkPack, packTemplate } from '../tools/i18n.mjs';
import { writePackIndex } from '../tools/packs.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EN = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/i18n/en.json'), 'utf8'));
const ZH_TW = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/i18n/zh-TW.json'), 'utf8'));
/** The 设置 note of a pack marked as machine translation (ui/lang.js machineTranslationNote). */
const MT_NOTE = '当前语言的界面文字为机器翻译，可能不够准确，欢迎在 GitHub 上指正。';

afterEach(() => {
  setLang('zh');
  setI18nWarn(null);
  for (const l of ['en', 'qaa', 'qab', 'pt', 'pt-BR', 'zh-TW', 'ru']) setMessages(l, {});
});

const tmpdir = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `sp-packs-${tag}-`));
const put = (dir, rel, body) => {
  fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), typeof body === 'string' ? body : JSON.stringify(body, null, 2));
};

/** A checkout-shaped temporary root with example packs of both layouts and a few broken ones. */
function exampleRoot() {
  const dir = tmpdir('root');
  put(dir, 'public/i18n/en.json', { _meta: { name: 'English', complete: true }, 开始: 'Start', 设置: 'Settings' });
  put(dir, 'public/i18n/qaa.json', { _meta: { name: 'Qaa-Sprache', englishName: 'Test language A', fallback: ['en'], app: '>=0.2.0', authors: 'Tester' }, 开始: 'Los' });
  put(dir, 'data/i18n/qaa.json', { version: 1, lang: 'qaa', names: {}, files: {} });
  put(dir, 'public/i18n/zh.json', { 开始: '开始' }); // the source language is never a pack
  put(dir, 'public/i18n/QAC.json', { 开始: 'x' }); // not in its usual case
  put(dir, 'public/i18n/qad.json', '{ not json');
  put(dir, 'packs/qab/pack.json', { type: 'lang', lang: 'qab', name: 'Qab', version: '1.0.0', app: '0.1.x', files: { ui: 'ui.json', data: 'texts/game.json' } });
  put(dir, 'packs/qab/ui.json', { 开始: 'Qab-Start', 设置: 'Qab-Settings' });
  put(dir, 'packs/qab/texts/game.json', { version: 1, lang: 'qab', names: { 阿米娅: 'Qab-Amiya' }, files: {} });
  put(dir, 'packs/qab/notes.html', '<script>alert(1)</script>');
  put(dir, 'packs/art/pack.json', { type: 'assets', name: 'HD art' });
  put(dir, 'packs/dup/pack.json', { type: 'lang', lang: 'qaa', files: { ui: 'ui.json' } });
  put(dir, 'packs/dup/ui.json', { 开始: 'dup' });
  put(dir, 'packs/broken/pack.json', { type: 'lang', files: { ui: '../escape.json' } });
  put(dir, 'packs/nomanifest/ui.json', { 开始: 'x' });
  return dir;
}
const dirsOf = (root) => ({ publicDir: path.join(root, 'public'), dataDir: path.join(root, 'data'), packsDir: path.join(root, 'packs') });

test('discovery: single-file language packs and folder packs, one registry; broken, planned and duplicate packs are skipped with a reason', () => {
  const root = exampleRoot();
  try {
    const scan = scanPacks(dirsOf(root), { app: '0.2.0' });
    assert.deepEqual(scan.packs.map((p) => [p.id, p.type, p.layout, p.manifest.lang]), [['en', 'lang', 'file', 'en'], ['qaa', 'lang', 'file', 'qaa'], ['qab', 'lang', 'folder', 'qab']]);
    const why = Object.fromEntries(scan.skipped.map((s) => [s.where, s.problems.join('; ')]));
    assert.match(why['public/i18n/zh.json'], /source language/);
    assert.match(why['public/i18n/QAC.json'], /not a language code in its usual case/);
    assert.match(why['public/i18n/qad.json'], /not valid JSON/);
    assert.match(why['packs/art/'], /type "assets" is planned/);
    assert.match(why['packs/dup/'], /language qaa is already provided by public\/i18n\/qaa\.json/);
    assert.match(why['packs/broken/'], /no "lang".*"files\.ui": "\.\.\/escape\.json" is not a path inside the pack folder/);
    assert.match(why['packs/nomanifest/'], /no pack\.json/);
    assert.ok(scan.warnings.some((w) => w.where === 'packs/qab/' && /made for app 0\.1\.x; this is 0\.2\.0/.test(w.warning)));
    const index = packIndexOf(scan.packs, { app: '0.2.0' });
    const qaa = index.packs.find((p) => p.id === 'qaa');
    assert.deepEqual(qaa, {
      id: 'qaa', type: 'lang', name: 'Qaa-Sprache', englishName: 'Test language A', app: '>=0.2.0', compatible: true, authors: ['Tester'],
      lang: 'qaa', fallback: ['en'], strings: 1, files: { ui: '/i18n/qaa.json', data: '/data/i18n/qaa.json' },
    });
    const qab = index.packs.find((p) => p.id === 'qab');
    assert.equal(qab.compatible, false, 'outside its app range: listed, flagged');
    assert.deepEqual(qab.files, { ui: '/packs/qab/ui.json', data: '/packs/qab/texts/game.json' });
    assert.equal(index.packs.find((p) => p.id === 'en').files.data, undefined, 'no data/i18n/en.json in this root');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('discovery: a pack dropped into the folder shows on the next look (no restart), a removed one leaves; only named files are servable', () => {
  const root = exampleRoot();
  try {
    const reg = createPackRegistry(dirsOf(root), { recheckMs: 0 });
    assert.ok(!reg.index().packs.some((p) => p.id === 'qae'));
    put(root, 'public/i18n/qae.json', { _meta: { name: 'Neu' }, 开始: 'Neu-Start' });
    assert.ok(reg.index().packs.some((p) => p.id === 'qae' && p.name === 'Neu'), 'appears without a restart');
    put(root, 'packs/qaf/pack.json', { type: 'lang', lang: 'qaf', files: { ui: 'ui.json' } });
    put(root, 'packs/qaf/ui.json', { 开始: 'F' });
    assert.ok(reg.index().packs.some((p) => p.id === 'qaf' && p.files.ui === '/packs/qaf/ui.json'));
    fs.rmSync(path.join(root, 'public/i18n/qae.json'));
    assert.ok(!reg.index().packs.some((p) => p.id === 'qae'), 'removed');
    assert.equal(reg.servable('qab', 'ui.json'), path.join(root, 'packs/qab/ui.json'));
    assert.equal(reg.servable('qab', 'texts/game.json'), path.join(root, 'packs/qab/texts/game.json'));
    assert.equal(reg.servable('qab', 'notes.html'), null, 'a file the manifest does not name');
    assert.equal(reg.servable('qab', 'pack.json'), null);
    assert.equal(reg.servable('art', 'pack.json'), null, 'a planned type is never served');
    assert.equal(reg.servable('qaa', 'qaa.json'), null, 'a single-file pack is served by the language folders');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the server: GET /packs/index.json lists the packs live, GET /packs/<id>/<file> serves only what a manifest names', async () => {
  const root = exampleRoot();
  const { startServer } = await import('../server/index.js');
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, publicDir: path.join(root, 'public'), packsDir: path.join(root, 'packs') });
  try {
    const get = (u) => fetch(srv.url + u);
    const res = await get('/packs/index.json');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const body = await res.json();
    assert.equal(body.version, 1);
    assert.deepEqual(readPackIndex(body, 'lang').map((p) => p.id), ['en', 'qaa', 'qab']);
    assert.equal((await get('/packs/qab/ui.json')).status, 200);
    assert.deepEqual(await (await get('/packs/qab/texts/game.json')).json(), { version: 1, lang: 'qab', names: { 阿米娅: 'Qab-Amiya' }, files: {} });
    for (const u of ['/packs/qab/notes.html', '/packs/qab/pack.json', '/packs/art/pack.json', '/packs/qab/', '/packs/nope/ui.json']) {
      assert.equal((await get(u)).status, 404, u);
    }
    // a raw path (fetch would normalize the dots away)
    const raw = await new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: srv.port, path: '/packs/qab/../qab/ui.json' }, (r) => { r.resume(); resolve(r.statusCode); }).on('error', reject);
    });
    assert.equal(raw, 404);
    assert.equal((await get('/i18n/qaa.json')).status, 200, 'a single-file pack: the language folder');
    put(root, 'public/i18n/qag.json', { 开始: 'G' });
    await new Promise((r) => setTimeout(r, 1100)); // the registry looks again after a second
    assert.ok((await (await get('/packs/index.json')).json()).packs.some((p) => p.id === 'qag'), 'a dropped pack shows on the next request');
  } finally {
    await srv.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('manifest: common fields, type fields, app ranges; English is a pack like any other', () => {
  assert.deepEqual(Object.entries(PACK_TYPES).map(([k, v]) => [k, v.status]), [['lang', 'supported'], ['assets', 'planned'], ['data', 'planned']]);
  for (const [range, v, ok] of [['>=0.2.0', '0.2.0-dev', true], ['>=0.2.0', '0.1.4', false], ['0.2.x', '0.2.7', true], ['0.2.x', '0.3.0', false],
    ['^0.2.1', '0.2.9', true], ['^0.2.1', '0.3.0', false], ['^1.2.0', '1.9.0', true], ['~0.2.1', '0.2.0', false], ['>=0.2.0 <0.3.0', '0.2.5', true],
    ['>=0.2.0 <0.3.0', '0.3.0', false], ['0.1.x || 0.2.x', '0.2.0', true], ['*', '9.9.9', true], ['', '0.0.1', true], ['0.2.0', '0.2.1', false]]) {
    assert.equal(appVersionMatches(range, v), ok, `${range} ∋ ${v}`);
  }
  assert.equal(isVersionRange('soon'), false);
  assert.equal(appVersionMatches('soon', '0.2.0'), true, 'an unreadable range never blocks');
  const { manifest, problems, warnings } = normalizeManifest({ type: 'lang', lang: 'pt_br', id: 'other', name: 'Português', fallback: ['pt', 'zh', 'en'], base: 'zh', numberUnits: ['a'] }, { id: 'pt-BR', folder: true, app: '0.2.0' });
  assert.deepEqual(problems, ['no "files.ui"']);
  assert.equal(manifest, null);
  assert.ok(warnings.some((w) => /"id": "other" is not "pt-BR"/.test(w)));
  const ok = normalizeManifest({ type: 'lang', lang: 'pt-BR', fallback: ['pt', 'zh', 'en'], base: 'zh', files: { ui: 'ui.json', extra: 'x.json' } }, { id: 'pt-BR', folder: true, app: '0.2.0' });
  assert.deepEqual([ok.manifest.lang, ok.manifest.base, ok.manifest.fallback, ok.manifest.files], ['pt-BR', null, ['pt', 'en'], { ui: 'ui.json' }], 'the source is never a base or a fallback');
  assert.ok(ok.warnings.some((w) => /files\.extra/.test(w)));
  assert.match(normalizeManifest({ type: 'theme' }, { id: 'x', folder: true }).problems.join(), /unknown type "theme"/);
  assert.match(normalizeManifest({ type: 'assets' }, { id: 'x', type: 'lang', lang: 'qaa' }).problems.join(), /"type": "assets" where a lang pack belongs/);
  assert.deepEqual(['ui.json', 'a/b.json', '../x.json', '/abs.json', 'a//b.json', '.hidden.json', 'a\\b.json'].map(isPackPath), [true, true, false, false, false, false, false]);
  // English: a single-file pack whose `_meta` is the manifest — complete, no fallback, nothing special in the client
  const en = normalizeManifest(EN._meta, { id: 'en', type: 'lang', lang: 'en', app: '0.2.0' });
  assert.deepEqual(en.problems, []);
  assert.deepEqual(en.warnings, []);
  assert.deepEqual([en.manifest.name, en.manifest.complete, en.manifest.fallback, en.manifest.numberUnits], ['English', true, [], null]);
  assert.ok(en.manifest.authors.some((a) => a.includes('@YuriRestia')), 'PR #70 credited');
});

test('manifest: machineTranslated — a boolean, carried into the index entry like complete and into the client\'s registry (from the index or the pack\'s own _meta); the shipped zh-TW pack has it', () => {
  const ctx = { id: 'qam', type: 'lang', lang: 'qam', app: '0.2.0' };
  const on = normalizeManifest({ name: 'Qam', machineTranslated: true }, ctx);
  assert.deepEqual([on.problems, on.warnings, on.manifest.machineTranslated], [[], [], true]);
  assert.equal(normalizeManifest({ name: 'Qam' }, ctx).manifest.machineTranslated, false, 'optional: absent reads as false');
  const odd = normalizeManifest({ name: 'Qam', machineTranslated: 'yes' }, ctx);
  assert.deepEqual(odd.problems, [], 'a warning, not a problem: the pack still loads');
  assert.deepEqual(odd.warnings, ['"machineTranslated": "yes" is not true or false (read as false)']);
  assert.equal(odd.manifest.machineTranslated, false);
  assert.match(normalizeManifest({ machineTranslated: 1 }, ctx).warnings.join(), /"machineTranslated": 1 is not true or false/);
  // the index entry: only when true (like complete)
  const files = { ui: '/i18n/qam.json' };
  assert.equal(packIndexEntry(on.manifest, { files, strings: 1 }).machineTranslated, true);
  assert.equal(Object.hasOwn(packIndexEntry(odd.manifest, { files }), 'machineTranslated'), false);
  // a checkout's packs → the index → readPackIndex / langMetaOf → the client's registry (langInfo)
  const root = tmpdir('mt');
  try {
    put(root, 'public/i18n/qam.json', { _meta: { name: 'Qam', fallback: ['en'], machineTranslated: true }, 开始: 'Qam-Start' });
    put(root, 'public/i18n/qan.json', { _meta: { name: 'Qan' }, 开始: 'Qan-Start' });
    const index = packIndexOf(scanPacks(dirsOf(root), { app: '0.2.0' }).packs, { app: '0.2.0' });
    const entries = readPackIndex(index, 'lang');
    assert.deepEqual(entries.map((e) => [e.id, e.machineTranslated]), [['qam', true], ['qan', undefined]]);
    registerLangs(entries.map(langMetaOf));
    assert.deepEqual([langInfo('qam').machineTranslated, langInfo('qan').machineTranslated, langInfo('zh').machineTranslated], [true, false, false]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  // without an index the pack's own `_meta` registers it (addMessages → packMeta)
  assert.equal(packMeta('qao', { _meta: { machineTranslated: true } }).machineTranslated, true);
  addMessages('qao', { _meta: { name: 'Qao', machineTranslated: true }, 开始: 'Qao-Start' });
  assert.equal(langInfo('qao').machineTranslated, true);
  // the shipped Traditional Chinese pack: a machine conversion (OpenCC, the official TW terms, a manual pass), complete,
  // no fallback (the Simplified Chinese msgids), the note in Traditional Chinese
  const tw = normalizeManifest(ZH_TW._meta, { id: 'zh-TW', type: 'lang', lang: 'zh-TW', app: '0.2.0' });
  assert.deepEqual([tw.problems, tw.warnings], [[], []]);
  assert.deepEqual([tw.manifest.machineTranslated, tw.manifest.complete, tw.manifest.fallback, tw.manifest.numberUnits], [true, true, [], ['萬', '億']]);
  assert.equal(ZH_TW[MT_NOTE], '目前語言的介面文字為機器翻譯，可能不夠準確，歡迎在 GitHub 上指正。');
  assert.ok(EN[MT_NOTE], 'English has the note');
});

test('fallback chain: the pack, its base (pt-BR → pt; zh-TW none), its fallbacks, then the Chinese msgid; cycles end', () => {
  const metas = { 'pt-BR': { fallback: ['en'] }, pt: { fallback: ['es'] }, es: {}, en: {}, 'zh-TW': { fallback: [] }, a: { fallback: ['b'] }, b: { fallback: ['a'] } };
  const known = (c) => Object.hasOwn(metas, c);
  assert.deepEqual(computeChain('pt-BR', (c) => metas[c], known), ['pt-BR', 'pt', 'es', 'en']);
  assert.deepEqual(computeChain('zh-TW', (c) => metas[c], known), ['zh-TW'], 'zh is the source: no base');
  assert.deepEqual(computeChain('pt-BR', (c) => metas[c], (c) => c !== 'pt' && known(c)), ['pt-BR', 'en'], 'a base without a pack is skipped');
  assert.deepEqual(computeChain('a', (c) => metas[c], known), ['a', 'b']);
  assert.deepEqual(computeChain('pt-BR', () => ({ base: null }), known), ['pt-BR'], 'base: null switches it off');
  // through t() / tc(): a partial pack falls through per string
  registerLangs([{ code: 'pt-BR', name: 'Português (Brasil)', fallback: ['en'] }, { code: 'pt', name: 'Português' }, { code: 'en', name: 'English' }]);
  addMessages('en', { 开始: 'Start', 设置: 'Settings', 关闭: 'Close', 'toggle::关闭': 'Off', 准备: 'Ready' });
  addMessages('pt', { 设置: 'Configurações', 关闭: 'Fechar' });
  addMessages('pt-BR', { 开始: 'Iniciar' });
  assert.deepEqual(langChain('pt-BR'), ['pt-BR', 'pt', 'en']);
  assert.equal(normalizeLang('PT_br'), 'pt-BR');
  assert.equal(normalizeLang('pt-PT'), 'pt', 'a region without a pack takes the language');
  setLang('pt-BR');
  assert.deepEqual([t('开始'), t('设置'), t('准备'), t('没有的')], ['Iniciar', 'Configurações', 'Ready', '没有的']);
  assert.equal(tc('toggle', '关闭'), 'Fechar', 'per language: pt\'s plain msgid before en\'s context key');
  setLang('en');
  assert.equal(tc('toggle', '关闭'), 'Off');
  assert.equal(t('开始'), 'Start');
});

test('placeholders: a translation that drops one or uses one the caller does not pass is skipped (reported once), the chain goes on', () => {
  assert.deepEqual(checkTranslation('还剩 {n} 秒', '{n} seconds left'), { ok: true, problems: [], extras: [] });
  assert.deepEqual(checkTranslation('还剩 {n} 秒', 'seconds left').problems, ['drops {n}']);
  assert.deepEqual(checkTranslation('还剩 {n} 秒', '{n|second|seconds} left').problems, ['drops {n}'], 'a plural form does not show the number');
  assert.deepEqual(checkTranslation('{n} 名', '{n} {count|unit|units}').extras, ['count']);
  assert.deepEqual(checkTranslation('{n}', '{n} {n|a|b|c}').problems, ['malformed plural {n|a|b|c}']);
  registerLangs([{ code: 'qaa', fallback: ['en'] }, { code: 'en' }]);
  addMessages('en', { '还剩 {n} 秒': '{n} seconds left', '临时整备区 {n} 个单位待处理': 'Bench: {n} {count|unit|units}' });
  addMessages('qaa', { '还剩 {n} 秒': 'nur noch Sekunden', '临时整备区 {n} 个单位待处理': '{n} {count|Einheit|Einheiten} {extra}' });
  const seen = [];
  setI18nWarn((w) => seen.push(w));
  setLang('qaa');
  assert.equal(t('还剩 {n} 秒', { n: 3 }), '3 seconds left', 'qaa drops {n}: English shows');
  assert.equal(t('还剩 {n} 秒', { n: 4 }), '4 seconds left');
  assert.equal(t('临时整备区 {n} 个单位待处理', { n: 2, count: 2 }), 'Bench: 2 units', '{extra} is not passed');
  assert.equal(t('临时整备区 {n} 个单位待处理', { n: 2, count: 2, extra: '!' }), '2 Einheiten !', 'passed: fine');
  assert.deepEqual(seen.map((w) => [w.lang, w.key, w.problems.join()]), [
    ['qaa', '还剩 {n} 秒', 'drops {n}'],
    ['qaa', '临时整备区 {n} 个单位待处理', 'uses {extra}, which the caller does not pass'],
  ], 'once per language and key');
  setMessages('en', {});
  assert.equal(t('还剩 {n} 秒', { n: 3 }), '还剩 3 秒', 'nothing fits: the Chinese msgid');
});

test('plurals: {n|one|other} by Intl.PluralRules (English as before); named categories for other languages (Russian)', () => {
  assert.deepEqual(parsePluralForms('|second|seconds'), { one: 'second', other: 'seconds' });
  assert.deepEqual(parsePluralForms('|one:день|few:дня|many:дней|other:дня'), { one: 'день', few: 'дня', many: 'дней', other: 'дня' });
  assert.equal(parsePluralForms('|one:a|few:b'), null, 'named forms need other');
  assert.equal(parsePluralForms('|one:a|b'), null, 'no mixing');
  assert.equal(parsePluralForms('|a|b|c'), null, 'three plain forms: the category order is not stable');
  assert.deepEqual([0, 1, 2, 5, 21, 1.5].map((n) => pluralCategory('en', n)), ['other', 'one', 'other', 'other', 'other', 'other']);
  assert.deepEqual([0, 1, 2, 5, 21, 1.5].map((n) => pluralCategory('ru', n)), ['many', 'one', 'few', 'many', 'one', 'other']);
  assert.deepEqual([0, 1, 2].map((n) => pluralCategory('qaa', n)), ['other', 'one', 'other'], 'a language the runtime does not know: one for exactly 1');
  registerLangs([{ code: 'ru', name: 'Русский' }, { code: 'en' }]);
  addMessages('en', { '还剩 {n} 秒': '{n} {n|second|seconds} left' });
  addMessages('ru', { '还剩 {n} 秒': 'осталось {n} {n|one:секунда|few:секунды|many:секунд|other:секунды}', '{n} 名干员': '{n} {n|оператор|операторов}' });
  setLang('en');
  assert.deepEqual([0, 1, 2].map((n) => t('还剩 {n} 秒', { n })), ['0 seconds left', '1 second left', '2 seconds left']);
  setLang('ru');
  assert.deepEqual([1, 2, 5, 21, 1.5].map((n) => t('还剩 {n} 秒', { n })), ['осталось 1 секунда', 'осталось 2 секунды', 'осталось 5 секунд', 'осталось 21 секунда', 'осталось 1.5 секунды']);
  assert.deepEqual([1, 3].map((n) => t('{n} 名干员', { n })), ['1 оператор', '3 операторов'], 'two plain forms: one / the rest');
  const b = { type: 'b' }; // a vnode stand-in: no number, so the form of 'other'
  assert.deepEqual(tParts('还剩 {n} 秒', { n: b }), ['осталось ', b, ' секунды']);
  assert.equal(format('{n|one:a|other:b}', { n: 1 }, { lang: 'ru' }), 'a');
});

test('zh and English output of t() / tc() / tParts() is what it was before language packs (every msgid of public/i18n/en.json)', () => {
  // the renderer of 0.2.0 before packs, frozen: one catalog, `{n|one|other}` by Number(v) === 1, lists ', ' / '、'
  const OLD = /\{([A-Za-z0-9_$]+)(?:\|([^{}|]*)\|([^{}|]*))?\}/g;
  const own = (o, k) => o != null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
  const val = (v, lang) => (v == null ? '' : Array.isArray(v) ? v.map((x) => val(x, lang)).filter((x) => x !== '').join(lang === 'en' ? ', ' : '、') : typeof v === 'object' ? (own(v, 'dn') ? String(v.dn) : '') : String(v));
  const oldFormat = (s, params, lang) => (!params || !s.includes('{') ? s : s.replace(OLD, (m, k, one, other) => (!own(params, k) ? m : one !== undefined ? (Number(params[k]) === 1 ? one : other) : val(params[k], lang))));
  addMessages('en', EN);
  const samples = [0, 1, 2, 5, 21, 'x', ['甲', '乙']];
  let compared = 0;
  for (const lang of ['zh', 'en']) {
    setLang(lang);
    for (const [key, tr] of Object.entries(EN)) {
      if (key.startsWith('_')) continue;
      const sep = key.indexOf('::');
      const ctx = sep >= 0 ? key.slice(0, sep) : null;
      const msgid = sep >= 0 ? key.slice(sep + 2) : key;
      const names = [...new Set([...`${msgid} ${tr}`.matchAll(OLD)].map((m) => m[1]))];
      for (let k = 0; k < samples.length; k++) {
        const params = names.length ? Object.fromEntries(names.map((nm, i) => [nm, samples[(i + k) % samples.length]])) : undefined;
        const want = oldFormat(lang === 'en' ? tr : msgid, params, lang);
        const got = ctx ? tc(ctx, msgid, params) : t(msgid, params);
        assert.equal(got, want, `${lang} ${key} ${JSON.stringify(params)}`);
        compared++;
        if (!names.length) break;
      }
    }
  }
  assert.ok(compared > 3000, `${compared} renders compared`);
  assert.equal(getLang(), 'en');
});

test('game texts fall back per text: the pack\'s overlay, then its fallback\'s, then Chinese (data.js chains, i18nData onto)', async () => {
  const zh = { a: { name: '甲', desc: '一', skills: [{ name: '技' }] }, b: { name: '乙' } };
  const ov = (lang, leaves) => ({ version: 1, lang, names: {}, files: { chess: leaves } });
  const qaa = ov('qaa', { a: buildRecordOverlay([{ path: ['name'], zh: '甲', en: 'A-qaa' }]) });
  const en = ov('en', { a: buildRecordOverlay([{ path: ['name'], zh: '甲', en: 'A' }, { path: ['desc'], zh: '一', en: 'one' }, { path: ['skills', 0, 'name'], zh: '技', en: 'Skill' }]), b: buildRecordOverlay([{ path: ['name'], zh: '乙', en: 'B' }]) });
  en.names = { 甲: 'A' };
  qaa.names = { 乙: 'B-qaa' };
  // the chained apply: lowest priority first, each over the last, hashes always against the Chinese
  let v = applyFileOverlay(zh, en.files.chess).value;
  v = applyFileOverlay(zh, qaa.files.chess, v).value;
  assert.deepEqual(v, { a: { name: 'A-qaa', desc: 'one', skills: [{ name: 'Skill' }] }, b: { name: 'B' } });
  const stale = applyFileOverlay({ ...zh, a: { ...zh.a, name: '变了' } }, qaa.files.chess, v);
  assert.equal(stale.value.a.name, 'A-qaa', 'a stale leaf keeps what the overlays before it left');
  assert.equal(stale.stale, 1);
  const files = { '/data/chess.json': zh, '/packs/qaa/game.json': qaa, '/data/i18n/en.json': en };
  const calls = [];
  const d = createDataStore({ retryDelays: [], fetch: async (url) => { calls.push(url); return files[url] ? { ok: true, status: 200, json: async () => files[url] } : { ok: false, status: 404, json: async () => null }; } });
  await d.load('chess');
  assert.equal(await d.setLocale('qaa', [{ code: 'qaa', url: '/packs/qaa/game.json' }, 'en']), 'qaa');
  assert.deepEqual(calls.filter((u) => u.includes('i18n') || u.includes('packs')).sort(), ['/data/i18n/en.json', '/packs/qaa/game.json']);
  assert.deepEqual(d.lookup('chess', 'a'), { name: 'A-qaa', desc: 'one', skills: [{ name: 'Skill' }] });
  assert.equal(d.lookup('chess', 'b').name, 'B');
  assert.deepEqual([d.localeName('乙'), d.localeName('甲'), d.localeName('丙')], ['B-qaa', 'A', '丙'], 'names: the first overlay of the chain that knows one');
  assert.deepEqual(d.localeChain(), ['qaa', 'en']);
  assert.equal(await d.setLocale('qab', []), 'qab', 'a pack without game texts switches with the Chinese ones');
  assert.equal(d.lookup('chess', 'a').name, '甲');
  const w = console.warn;
  console.warn = () => {};
  try {
    assert.equal(await d.setLocale('qac', ['qac']), 'qab', 'every overlay of the chain missing: no switch (as before packs)');
  } finally { console.warn = w; }
});

test('client: the index registers the language packs; the menu lists them (buttons up to five, a list beyond); packs load by their URLs', async () => {
  const lang = await import('../public/js/ui/lang.js');
  const index = { version: 1, packs: [
    { id: 'en', type: 'lang', lang: 'en', name: 'English', englishName: 'English', fallback: [], files: { ui: '/i18n/en.json', data: '/data/i18n/en.json' } },
    { id: 'qab', type: 'lang', lang: 'qab', name: 'Qab', englishName: 'Test B', fallback: ['en'], numberUnits: ['W', 'Y'], files: { ui: '/packs/qab/ui.json' } },
    { id: 'art', type: 'assets', name: 'x', files: {} },
    { id: 'evil', type: 'lang', lang: 'qay', name: 'x', files: { ui: 'https://example.com/x.json' } },
  ] };
  const got = [];
  const fetchFake = async (url) => {
    got.push(url);
    const body = url === '/packs/index.json' ? index : url === '/packs/qab/ui.json' ? { 开始: 'Qab-Start' } : url === '/i18n/en.json' ? { 开始: 'Start', 设置: 'Settings' } : null;
    return body ? { ok: true, status: 200, json: async () => body } : { ok: false, status: 404, json: async () => null };
  };
  assert.equal(await lang.loadLangIndex(fetchFake), true);
  assert.deepEqual(readPackIndex(index, 'lang').map((e) => e.id), ['en', 'qab'], 'other types and off-site URLs are dropped');
  assert.deepEqual(getLangs().map((m) => m.code).filter((c) => ['zh', 'en', 'qab'].includes(c)), ['zh', 'en', 'qab'], 'the source first, then by code');
  assert.equal(langInfo('qab').ui, '/packs/qab/ui.json');
  const menu = lang.langMenuModel(getLangs().filter((m) => ['zh', 'en', 'qab'].includes(m.code)), 'en');
  assert.equal(menu.kind, 'buttons');
  assert.deepEqual(menu.items.map((i) => [i.code, i.label, i.htmlLang, i.on]), [['zh', '中文', 'zh-CN', false], ['en', 'English', 'en', true], ['qab', 'Qab', 'qab', false]]);
  assert.equal(menu.items[2].title, 'Test B', 'the English name as a tooltip when it reads differently');
  const five = ['a1', 'a2', 'a3', 'a4', 'a5'].map((c) => ({ code: c, name: c, englishName: c }));
  assert.equal(lang.langMenuModel(five, 'a1').kind, 'buttons', 'the five shipped packs stay a segmented row');
  const many = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'].map((c) => ({ code: c, name: c, englishName: c }));
  assert.equal(lang.langMenuModel(many, 'a1').kind, 'select');
  assert.equal(await lang.loadLangChain('qab', fetchFake), true);
  assert.ok(got.includes('/packs/qab/ui.json') && got.includes('/i18n/en.json'), 'the pack and its fallback, by their URLs');
  assert.deepEqual(lang.dataChain('qab'), [{ code: 'en', url: '/data/i18n/en.json' }], 'only packs with game texts');
  setLang('qab');
  assert.deepEqual([t('开始'), t('设置')], ['Qab-Start', 'Settings']);
  const { fmtNum } = await import('../public/js/ui/gameLogic.js');
  assert.deepEqual([fmtNum(150_000), fmtNum(2.5e8)], ['15.0W', '2.5Y'], 'the pack\'s own number units');
  setLang('en');
  assert.deepEqual([fmtNum(150_000), fmtNum(2.5e8)], ['150K', '250M'], 'English: K / M / B as before');
  setLang('zh');
  assert.deepEqual([fmtNum(150_000), fmtNum(2.5e8)], ['15.0万', '2.5亿'], 'Chinese as before');
  assert.deepEqual(lang.initialLang('?lang=QAB', () => null), { lang: 'qab', fromUrl: true });
  assert.deepEqual(lang.initialLang('', () => 'qzz'), { lang: 'zh', fromUrl: false }, 'a stored pack that is gone: Chinese');
  assert.deepEqual(lang.initialLang('', () => 'qzz', { tentative: true }), { lang: 'qzz', fromUrl: false }, 'without an index: tried by its code');
  assert.deepEqual([scriptOf('Stronghold Protocol'), scriptOf('卫戍协议'), scriptOf('堅守協定'), scriptOf('위수 협의'), scriptOf('Протокол')], ['alphabetic', 'cjk', 'cjk', 'cjk', 'alphabetic']);
  assert.deepEqual(langMetaOf(readPackIndex(index, 'lang')[1]).numberUnits, ['W', 'Y']);
  assert.deepEqual(langFields('qab', { base: 'zh', fallback: 'en' }), { lang: 'qab', base: null, fallback: ['en'], complete: false, machineTranslated: false, numberUnits: null });
  assert.equal(canonicalLang('zh-hant-tw'), 'zh-Hant-TW');
});

test('设置: the machine-translation note shows while the current language\'s pack is marked (ui/lang.js machineTranslationNote), in that language; none for Chinese, English or an unmarked pack', async () => {
  const { machineTranslationNote } = await import('../public/js/ui/lang.js');
  registerLangs([{ code: 'qap', name: 'Qap', fallback: ['en'], machineTranslated: true }, { code: 'qaq', name: 'Qaq', fallback: ['en'] }, { code: 'en', name: 'English' }]);
  addMessages('en', { [MT_NOTE]: EN[MT_NOTE] });
  addMessages('qap', { [MT_NOTE]: 'Qap-Hinweis' });
  assert.equal(machineTranslationNote(), null, 'Chinese: no note');
  setLang('qap');
  assert.equal(machineTranslationNote(), 'Qap-Hinweis', 'the marked pack, in its own words');
  setMessages('qap', {});
  assert.equal(machineTranslationNote(), EN[MT_NOTE], 'a marked pack without the string: the next language of its chain');
  setLang('qaq');
  assert.equal(machineTranslationNote(), null, 'a pack that is not marked');
  setLang('en');
  assert.equal(machineTranslationNote(), null, 'English is not marked');
  // the shipped zh-TW pack (no index here: its `_meta` registers it)
  addMessages('zh-TW', ZH_TW);
  setLang('zh-TW');
  assert.equal(machineTranslationNote(), ZH_TW[MT_NOTE]);
  assert.equal(t('设置'), '設定', 'and the rest of the interface in Traditional Chinese');
});

test('tools: template writes a skeleton (or adds the missing msgids to a pack), check reports coverage and errors per pack; packs index writes the static index', () => {
  const used = new Map([['开始', { where: 'a.js:1', params: [] }], ['还剩 {n} 秒', { where: 'b.js:2', params: new Set(['n']) }], ['{n} 名', { where: 'c.js:3', params: new Set(['n', 'count']) }], ['表里的', { where: 'd.js:4', params: null }]]);
  const skel = packTemplate('qaa', { msgids: [...used.keys()] });
  assert.deepEqual(Object.keys(skel.json), ['_meta', '开始', '还剩 {n} 秒', '{n} 名', '表里的']);
  assert.deepEqual([skel.json._meta.type, skel.json._meta.lang, skel.json._meta.fallback, skel.json._meta.app], ['lang', 'qaa', ['en'], `>=${APP_VERSION.replace(/-.*$/, '')}`], 'this release and later (tools/i18n.mjs appRange)');
  assert.equal(packTemplate('zh-TW', { msgids: [] }).json._meta.fallback.length, 0, 'a Chinese variant falls back to the Chinese msgid');
  assert.equal(skel.json['开始'], '');
  const again = packTemplate('qaa', { existing: { _meta: { name: 'Mine' }, 开始: 'Los', 旧的: 'alt' }, msgids: [...used.keys()], fill: { 还剩: 'x' } });
  assert.deepEqual([again.json._meta, again.json['开始'], again.json['旧的'], again.kept, again.added], [{ name: 'Mine' }, 'Los', 'alt', 1, 3], 'translations and _meta kept, the rest added');
  const r = checkPack({ 开始: 'Los', '还剩 {n} 秒': 'Sekunden', '{n} 名': '{n} {count|Name|Namen} {who}', 表里的: '{any}', 旧的: 'alt', 'x::y': 3 }, used, new Set([...used.keys()]));
  assert.deepEqual([r.total, r.translated, r.missing.length, r.obsolete], [4, 2, 0, ['旧的']]);
  assert.deepEqual(r.errors.map((e) => e.split(':')[0]), ['not a string', 'drops {n}', 'uses {who}, which no call site passes']);
  // the CLI on a temporary checkout's packs (the msgids come from this checkout's code)
  const root = tmpdir('cli');
  try {
    put(root, 'public/i18n/en.json', EN);
    const run = (...args) => spawnSync(process.execPath, [path.join(ROOT, 'tools/i18n.mjs'), ...args, '--root', root], { encoding: 'utf8' });
    const tpl = run('template', 'qaa');
    assert.equal(tpl.status, 0, tpl.stderr);
    assert.match(tpl.stdout, /wrote public\/i18n\/qaa\.json: \d+ msgids — 0 translations kept, \d+ added \(empty\)/);
    const pack = JSON.parse(fs.readFileSync(path.join(root, 'public/i18n/qaa.json'), 'utf8'));
    assert.equal(Object.keys(pack).length - 1, Object.keys(EN).filter((k) => !k.startsWith('_')).length, 'every msgid of the complete pack');
    pack['开始'] = 'Los';
    fs.writeFileSync(path.join(root, 'public/i18n/qaa.json'), JSON.stringify(pack));
    const ok = run('check', 'qaa', '--strict');
    assert.equal(ok.status, 0, `${ok.stdout}${ok.stderr}`);
    assert.match(ok.stdout, /public\/i18n\/qaa\.json \(qaa, qaa\): \d+ msgids used, 1 translated \([\d.]+ %\), \d+ missing, 0 errors/);
    pack['还剩 {n} 秒'] = 'x';
    pack['第 {r} 回合 · 最终攻势'] = 'Runde';
    fs.writeFileSync(path.join(root, 'public/i18n/qaa.json'), JSON.stringify(pack));
    const bad = run('check', 'qaa', '--strict');
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, /error {4}public\/i18n\/qaa\.json: drops \{r\}: 第 \{r\} 回合 · 最终攻势 {2}→ {2}Runde/);
    const all = run('check', '--all');
    assert.match(all.stdout, /public\/i18n\/en\.json \(English, en, complete\): (\d+) msgids used, \1 translated \(100 %\), 0 missing, 0 errors/);
    const body = writePackIndex(root);
    assert.deepEqual(body.packs.map((p) => p.id), ['en', 'qaa']);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'packs/index.json'), 'utf8')), body);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('build-i18n --lang: another official client (a text equal to the Chinese is no translation, no English composites); --dict for a language without one', () => {
  assert.deepEqual(Object.keys(LANG_SOURCES), ['en', 'ja', 'ko', 'zh-TW']);
  assert.match(LANG_SOURCES.ja.sources.assets.url, /ArknightsAssets\/ArknightsGamedata\/master\/jp\/gamedata\/$/);
  const zh = [{ chars: { char_x: { name: '测试员', description: '攻击造成法术伤害' } } }];
  const ja = [{ chars: { char_x: { name: 'テスター', description: '攻击造成法术伤害' } } }];
  const data = { chess: { chess_x_a: { charId: 'char_x', name: '测试员', trait: { desc: '攻击造成法术伤害' } } }, stages: { m1: { name: '战场#05(下半) 测试员' } } };
  const { overlay, report } = buildOverlay({ zh, en: ja, data, lang: 'ja' });
  assert.equal(overlay.lang, 'ja');
  const c = applyRecordOverlay(data.chess.chess_x_a, overlay.files.chess.chess_x_a).value;
  assert.deepEqual([c.name, c.trait.desc], ['テスター', '攻击造成法术伤害'], 'the JP text equal to the Chinese one stays untranslated (falls back at run time)');
  assert.equal(overlay.files.stages, undefined, 'the remake\'s stage-name composite is English wording only');
  assert.equal(overlay.names['测试员'], 'テスター');
  assert.equal(report.coverage.operators.translated, 1);
  const fr = buildOverlay({ zh: [], en: [], data, lang: 'fr', fallback: { dict: { 测试员: 'Testeur', 攻击造成法术伤害: 'Inflige des dégâts magiques' } } });
  const f = applyRecordOverlay(data.chess.chess_x_a, fr.overlay.files.chess.chess_x_a).value;
  assert.deepEqual([fr.overlay.lang, f.name, f.trait.desc, fr.overlay.names['测试员']], ['fr', 'Testeur', 'Inflige des dégâts magiques', 'Testeur']);
  assert.deepEqual([fr.report.coverage.operators.dict, fr.report.coverage.traits.dict], [1, 1], 'counted as the dictionary\'s');
});
