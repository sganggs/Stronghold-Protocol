// test/plugins/errors.test.js — the plugin error catalogue (shared/plugins/errors.js, DESIGN §32.9, the 0.3.0 plan's C6):
// every PLUGIN_* code the code names is in the catalogue with its plain words in Chinese and English, what to do and a
// document anchor that exists; the room's refusal codes are the ERR codes (with their translated ERR_TEXT); every
// one-click fix it names exists (server/studio/edit.js FIXES, the API's own); the checks report coded issues beside their
// unchanged text, and every issue they produce for a set of broken plugins fills the placeholders of its explanation; the
// symptom tables of docs/PLUGINS.md and docs/PLUGIN-GUIDE.md are the catalogue's (node tools/plugin.mjs errors --write).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLUGIN_ERRORS, REFUSAL_CODES, TABLE_MARKERS, describeIssue, issueLine, issueList, issuesOf, makeIssue, placeholdersOf, symptomTable, errorLang } from '../../shared/plugins/errors.js';
import { ERR, ERR_TEXT, PLUGIN_API } from '../../shared/constants.js';
import { readPluginManifest } from '../../shared/plugins/manifest.js';
import { readAssetOverlay, readPluginLock } from '../../shared/plugins/visual.js';
import { readPluginFolder, scanPlugins } from '../../server/plugins/registry.js';
import { buildPluginLock, checkPluginFolder } from '../../server/plugins/pack.js';
import { FIXES } from '../../server/studio/edit.js';
import { API_FIXES } from '../../server/studio/index.js';
import { png, skel, atlas, writePlugin, cosmetic } from '../helpers/pluginFixtures.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Every .js / .mjs file of the code folders. */
function codeFiles() {
  const out = [];
  const walk = (rel) => {
    for (const name of fs.readdirSync(path.join(ROOT, rel)).sort()) {
      if (['node_modules', 'vendor', 'assets', 'fonts'].includes(name) || name.startsWith('.')) continue;
      const r = `${rel}/${name}`;
      if (fs.statSync(path.join(ROOT, r)).isDirectory()) walk(r);
      else if (/\.m?js$/.test(name)) out.push(r);
    }
  };
  for (const root of ['server', 'shared', 'tools', 'public/js', 'public/studio']) walk(root);
  return out;
}

test('every PLUGIN_* code the code names (as a string) is in the catalogue, every ERR PLUGIN_* code too', () => {
  const used = new Map();
  for (const f of codeFiles()) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of src.matchAll(/['"`](PLUGIN_[A-Z0-9_]+)['"`]/g)) if (!used.has(m[1])) used.set(m[1], f);
  }
  assert.ok(used.size >= 40, `${used.size} codes found`);
  const missing = [...used].filter(([code]) => !Object.hasOwn(PLUGIN_ERRORS, code)).map(([code, f]) => `${code} (${f})`);
  assert.deepEqual(missing, []);
  const errCodes = Object.keys(ERR).filter((k) => k.startsWith('PLUGIN_'));
  for (const code of errCodes) assert.ok(PLUGIN_ERRORS[code], `${code} (ERR) is in the catalogue`);
  assert.deepEqual([...REFUSAL_CODES].sort(), errCodes.sort(), 'the refusals are exactly the ERR codes');
  for (const code of REFUSAL_CODES) assert.ok(ERR_TEXT[code], `${code}: ERR_TEXT (the language packs translate it)`);
});

test('every entry: plain words in Chinese and English, a fix in both, a document anchor that exists, a known level', () => {
  const anchors = new Map();
  const slug = (h) => h.trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s/g, '-');
  const anchorsOf = (file) => {
    if (!anchors.has(file)) {
      const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
      anchors.set(file, new Set([...text.matchAll(/^#{1,6} (.+)$/gm)].map((m) => slug(m[1]))));
    }
    return anchors.get(file);
  };
  for (const [code, e] of Object.entries(PLUGIN_ERRORS)) {
    assert.match(code, /^PLUGIN_[A-Z0-9_]+$/);
    assert.ok(['problem', 'warning', 'refusal', 'studio', 'frame'].includes(e.level), `${code}: level`);
    for (const k of ['zh', 'en']) {
      assert.ok(typeof e[k] === 'string' && e[k].length > 3, `${code}.${k}`);
      assert.ok(typeof e.fix?.[k] === 'string' && e.fix[k].length > 3, `${code}.fix.${k}`);
    }
    assert.match(e.zh, /[一-鿿]/, `${code}: the Chinese text is Chinese`);
    assert.doesNotMatch(e.en, /[一-鿿]{3}/, `${code}: the English text is English (a Chinese UI word here and there is fine)`);
    const [file, anchor] = e.doc.split('#');
    assert.ok(fs.existsSync(path.join(ROOT, file)), `${code}: ${file} exists`);
    if (anchor) assert.ok(anchorsOf(file).has(anchor), `${code}: ${e.doc} is a heading`);
    // the placeholders of zh / en / fix are the same set in both languages
    const ph = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
    assert.equal(ph(e.zh), ph(e.en), `${code}: the same placeholders in both explanations`);
    assert.equal(ph(e.fix.zh), ph(e.fix.en), `${code}: the same placeholders in both fixes`);
  }
});

test('every one-click fix the catalogue names exists (the manifest edits of server/studio/edit.js, the API\'s pack and moveOut)', () => {
  const have = new Set([...Object.keys(FIXES), ...API_FIXES]);
  for (const [code, e] of Object.entries(PLUGIN_ERRORS)) if (e.autofix) assert.ok(have.has(e.autofix), `${code}: autofix ${e.autofix}`);
});

test('issues: makeIssue keeps the path and file apart from the params; an unknown code becomes PLUGIN_INVALID with the text; issuesOf covers older checks', () => {
  assert.deepEqual(makeIssue('problem', 'PLUGIN_VERSION', 'no "version"', { at: ['version'], x: 1 }), { level: 'problem', code: 'PLUGIN_VERSION', text: 'no "version"', params: { x: 1 }, at: ['version'] });
  const odd = makeIssue('warning', 'PLUGIN_SOMETHING_NEW', 'a line', { file: 'a.png' });
  assert.deepEqual([odd.code, odd.file, odd.params.detail, odd.params.code], ['PLUGIN_INVALID', 'a.png', 'a line', 'PLUGIN_SOMETHING_NEW']);
  const list = issueList();
  list.problem('PLUGIN_VERSION', 'p1', { at: ['version'] });
  list.warning('PLUGIN_HOMEPAGE', 'w1', { at: ['homepage'] });
  list.take({ problems: ['old p'], warnings: ['old w'] });
  assert.deepEqual([list.problems, list.warnings], [['p1', 'old p'], ['w1', 'old w']]);
  assert.deepEqual(list.issues.map((i) => [i.level, i.code]), [['problem', 'PLUGIN_VERSION'], ['warning', 'PLUGIN_HOMEPAGE'], ['problem', 'PLUGIN_INVALID'], ['warning', 'PLUGIN_INVALID']]);
  assert.equal(issuesOf({ problems: ['a'], warnings: [], issues: [] }).length, 1, 'issues that do not cover the strings are rebuilt');
  assert.equal(errorLang('zh-TW'), 'zh');
  assert.equal(errorLang('ja'), 'en');
});

test('describeIssue / issueLine: the explanation in plain words with its placeholders filled, the fix, the document', () => {
  const i = makeIssue('problem', 'PLUGIN_PERMISSION_MISSING', '"assets" needs the permission "assets.override" or "assets.add"', { at: ['assets'], need: 'assets.override' });
  const zh = describeIssue(i, 'zh');
  assert.equal(zh.message, '「assets」需要权限 assets.override，清单里没有声明');
  assert.match(zh.fix, /在 "permissions" 里加上 "assets.override"/);
  assert.equal(zh.autofix, 'addPermission');
  const en = describeIssue(i, 'en');
  assert.match(en.message, /needs the permission assets\.override/);
  assert.match(issueLine(i, 'zh'), /^PLUGIN_PERMISSION_MISSING 「assets」需要权限 .+。改法：.+ \(docs\/PLUGINS\.md#4-permissions\)$/);
});

test('a value whose text cannot be made (an object with a "toString" key, a list of them) never breaks a check or an explanation', () => {
  // JSON.parse gives such objects; String() of one throws — the checks name them as short JSON, as the text always did
  for (const bad of [{ toString: '' }, [{ toString: 'x' }], { valueOf: 1, toString: 2 }]) {
    const r = readPluginManifest({ manifest: 2, class: 'cosmetic', version: '1.0.0', app: '*', api: 1, permissions: [bad], assets: {} }, { id: 'me', api: PLUGIN_API });
    assert.equal(r.manifest, null);
    const p = r.issues.find((i) => i.code === 'PLUGIN_PERMISSION');
    assert.ok(p, JSON.stringify(r.problems));
    assert.ok(r.problems.some((t) => t.startsWith(`unknown permission ${JSON.stringify(bad).slice(0, 40)}`)), 'the text as before');
    assert.match(describeIssue(p, 'zh').message, /权限/);
  }
  // an issue whose params hold such a value (an issue a page sends back for a fix) is still explained
  const odd = makeIssue('problem', 'PLUGIN_PERMISSION', 'x', { where: { toString: '' }, class: [{ toString: 1 }] });
  assert.match(describeIssue(odd, 'en').message, /toString/);
});

/** The issues of many broken plugins (each check of the plugin system). */
function brokenIssues() {
  const issues = [];
  const take = (r) => issues.push(...(r.issues || []));
  const manifests = [
    {}, { manifest: 1 }, { manifest: 2 }, { manifest: 2, class: 'skin' },
    { manifest: 2, class: 'cosmetic', version: '1', app: 'latest', api: 9, scope: ['server'], colour: 1, homepage: 'ftp://x', name: 5, sourceLang: '日本',
      requires: { Bad_ID: '1', ok: 'abc', me: '*' }, conflicts: { ok: '*' }, loadAfter: ['x', 'x2'], loadBefore: ['x'], priority: 5000, permissions: ['fly', 'data.patch', 'theme'],
      settings: { '1x': {}, a: { type: 'integer' }, b: { type: 'boolean', hint: 1 }, c: { type: 'enum', options: [] } }, data: ['d.json'], lang: 'en', entry: { client: 'x.html', foo: 'y' },
      assets: { chars: { char_102_texas: { avatar: '../a.png', portrait: 'p.mp3' } } }, theme: { a: 'url(http://x)' }, i18n: { xx_bad: 'q.txt' } },
    { manifest: 2, class: 'cosmetic', version: '1.0.0', app: '*', api: 1, id: 'other' },
    { manifest: 2, class: 'cosmetic', version: '1.0.0', api: 1, assets: {} },
    { manifest: 2, class: 'cosmetic', version: '1.0.0', app: '>=9.0.0', api: 1, permissions: ['assets.override'], assets: {} },
    { manifest: 2, class: 'cosmetic', version: '1.0.0', app: '*', api: 1, assets: { chars: {} } },
  ];
  for (const m of manifests) take(readPluginManifest(m, { id: 'me', api: PLUGIN_API }));
  const vanilla = { chars: { char_112_siege: { avatar: '/x.png', spine: { front: { skel: '/s.skel' } } } }, audio: { voice: {} } };
  take(readAssetOverlay('nope'));
  take(readAssetOverlay({
    fonts: {}, chars: { 'a b': {}, char_102_texas: { avatar: { ref: 'char_000_none' }, portrait: { ref: 'char_112_siege', x: 1 }, skin: 'a.png', skins: { 'a b': { name: 'x' } }, spine: { front: { skel: 'm/t.skel', atlas: 'n/t.atlas' }, back: { skel: 'm/t.skel', animations: {} } } } },
    enemies: { e1: { spine: { skel: 'e/t.skel', textures: [] } }, e2: 'x' }, items: { i: 'a.mp3' },
    audio: { bgm: { combatAlts: {}, lobby: { intro: 'a.mp3' } }, voice: { v: { select: Array(17).fill('a.mp3'), '1bad': 'a.mp3' } }, sfx: { units: { u: { skills: { x: 'a.mp3' } } } } },
  }, { vanilla, permissions: [], has: (rel) => rel !== 'missing.png' }));
  take(readAssetOverlay({ chars: { char_102_texas: { avatar: 'missing.png' } } }, { has: () => false }));
  take(readPluginLock('nope'));
  take(readPluginLock({ lock: 1, files: { 'a.png': {} } }));
  // folders: the registry's and the packer's own findings
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-errors-'));
  try {
    const plugins = path.join(dir, 'plugins');
    fs.mkdirSync(plugins);
    fs.mkdirSync(path.join(plugins, 'empty'));
    writePlugin(path.join(plugins, 'badjson'), {}, {});
    fs.writeFileSync(path.join(plugins, 'badjson', 'plugin.json'), '{ nope');
    writePlugin(path.join(plugins, 'files'), cosmetic({ assets: { chars: { char_102_texas: { avatar: 'a.png' } } } }), { 'a.png': png(), 'x.exe': 'x', 'deep.json': JSON.parse('{"a":'.repeat(70) + '1' + '}'.repeat(70)) });
    try { fs.symlinkSync(path.join(dir, 'outside.png'), path.join(plugins, 'files', 'link.png')); } catch { /* no links here */ }
    writePlugin(path.join(plugins, 'model'), cosmetic({ assets: { chars: { char_102_texas: { spine: { front: { skel: 'm/t.skel' } } } } } }), { 'm/t.skel': skel(), 'm/t.atlas': atlas(['t.png', 'u.png']), 'm/t.png': png(), 'm/u.png': png() });
    writePlugin(path.join(plugins, 'junk'), cosmetic({ assets: { chars: { char_102_texas: { spine: { front: { skel: 'j.skel' } } } } } }), { 'j.skel': 'nope', 'j.atlas': atlas(['j.png']), 'j.png': png() });
    writePlugin(path.join(plugins, 'needs'), cosmetic({ requires: { gone: '*' }, assets: { chars: { char_102_texas: { avatar: 'a.png' } } } }), { 'a.png': png() });
    writePlugin(path.join(plugins, 'Needs'.toLowerCase() + '-2'), cosmetic({ theme: { a: 1 }, permissions: ['assets.override', 'theme'], assets: { chars: { char_102_texas: { avatar: 'a.png' } } } }), { 'a.png': png() });
    const scan = scanPlugins({ publicDir: path.join(dir, 'public'), dataDir: path.join(dir, 'data'), packsDir: path.join(dir, 'packs'), pluginsDir: plugins });
    for (const k of scan.skipped) issues.push(...(k.issues || []));
    for (const w of scan.warnings) if (w.issue) issues.push(w.issue);
    take(readPluginFolder(path.join(plugins, 'empty')));
    take(checkPluginFolder(path.join(plugins, 'files'), 'plugins/files/'));
    take(buildPluginLock(path.join(plugins, 'model')));
    take(buildPluginLock(path.join(plugins, 'junk')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  return issues;
}

test('the checks report coded issues — one per problem and warning — whose explanations have every placeholder filled', () => {
  const issues = brokenIssues();
  const codes = new Set(issues.map((i) => i.code));
  assert.ok(codes.size >= 40, `${codes.size} codes: ${[...codes].join(' ')}`);
  assert.ok(!codes.has('PLUGIN_INVALID'), 'every finding of the plugin checks has a code of its own');
  const unfilled = [];
  for (const i of issues) {
    const d = describeIssue(i, 'zh');
    const e = describeIssue(i, 'en');
    for (const text of [d.message, d.fix, e.message, e.fix]) if (/\{\w+\}|「」|“”|^\s*:|\s{2,}$/.test(text)) unfilled.push(`${i.code}: ${text}`);
    // every placeholder of its entry is given (where / file / detail come from the issue itself)
    for (const p of placeholdersOf(i.code)) {
      if (['where', 'file', 'detail'].includes(p)) continue;
      if (i.params[p] === undefined || i.params[p] === '') unfilled.push(`${i.code}: {${p}} of "${i.text}"`);
    }
  }
  assert.deepEqual(unfilled, []);
});

test('the symptom tables of docs/PLUGINS.md (English) and docs/PLUGIN-GUIDE.md (Chinese) are the catalogue\'s', () => {
  for (const [file, lang] of [['docs/PLUGINS.md', 'en'], ['docs/PLUGIN-GUIDE.md', 'zh']]) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const a = text.indexOf(TABLE_MARKERS.start);
    const b = text.indexOf(TABLE_MARKERS.end);
    assert.ok(a >= 0 && b > a, `${file}: the generated table's markers`);
    assert.equal(text.slice(a + TABLE_MARKERS.start.length, b).trim(), symptomTable(lang), `${file}: run node tools/plugin.mjs errors --write`);
  }
  const en = symptomTable('en');
  assert.equal(en.split('\n').length, Object.keys(PLUGIN_ERRORS).length + 2, 'one row per code');
  assert.match(symptomTable('zh'), /^\| 症状 \| 代码 \| 原因 \| 怎么改 \|/);
});
