// test/plugins/manifest.test.js — the plugin manifest (DESIGN §32, shared/plugins/manifest.js): manifest 2 read and
// normalised (classes, parts, permissions, settings, dependencies, the lang class), manifest 1 read exactly as the
// content packs of 0.2.0 (shared/packs.js normalizeManifest forwards to it), the problems that keep a plugin out and
// the warnings that do not, the file rules and limits (types by class, documents, sizes, links, the paths a manifest
// names), the JSON limits, and the catalogue entries (no server path, every class but lang marked unofficial).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APP_VERSION, PLUGIN_API } from '../../shared/constants.js';
import {
  PLUGIN_CLASSES, PACK_TYPES, PERMISSIONS, PLUGIN_LIMITS, ASSET_EXT, isPluginId, isPackId, isSemver, readPluginManifest, readPackManifest,
  declaredPaths, checkPluginFiles, checkJsonLimits, classStatus, pluginIndexEntry, buildPluginIndex,
} from '../../shared/plugins/manifest.js';
import { normalizeManifest, PACK_TYPES as PACK_TYPES_COMPAT, isPackPath as isPackPathCompat, appVersionMatches } from '../../shared/packs.js';

const APP = '0.3.0';
const ctx = (id, extra = {}) => ({ id, app: APP, ...extra });
/** A valid content plugin (the design study's example, trimmed). */
const marathon = () => ({
  $schema: '../../schemas/plugin.schema.json',
  manifest: 2,
  id: 'marathon',
  name: { zh: '马拉松模式', en: 'Marathon' },
  version: '0.1.0',
  app: '>=0.3.0 <0.4.0',
  api: 1,
  class: 'content',
  scope: ['room'],
  authors: ['A', 'B'],
  license: 'CC-BY-4.0',
  settings: { refresh: { type: 'integer', min: 0, max: 3, default: 1, label: { zh: '刷新价格' } } },
  permissions: ['data.patch', 'data.add'],
  data: ['data/economy.json'],
  modes: ['modes/marathon.json'],
  operators: ['operators/rosa.json'],
  i18n: { en: 'i18n/en.json' },
});
const problemsOf = (raw, id = 'marathon', extra) => readPluginManifest(raw, ctx(id, extra)).problems.join(' | ');
const warningsOf = (raw, id = 'marathon') => readPluginManifest(raw, ctx(id)).warnings.join(' | ');

test('manifest 2: a content plugin, normalised', () => {
  const { manifest: m, problems, warnings } = readPluginManifest(marathon(), ctx('marathon'));
  assert.deepEqual(problems, []);
  assert.deepEqual(warnings, []);
  assert.equal(m.manifest, 2);
  assert.equal(m.class, 'content');
  assert.equal(m.type, 'data', 'the manifest 1 type of the class');
  assert.equal(m.name, '马拉松模式', 'the text in sourceLang (zh)');
  assert.equal(m.englishName, 'Marathon');
  assert.deepEqual(m.names, { zh: '马拉松模式', en: 'Marathon' });
  assert.equal(m.version, '0.1.0');
  assert.equal(m.compatible, true);
  assert.equal(m.api, 1);
  assert.deepEqual(m.scope, ['room']);
  assert.deepEqual(m.settings, { refresh: { type: 'integer', default: 1, min: 0, max: 3, label: { zh: '刷新价格' } } });
  assert.deepEqual(Object.keys(m.parts), ['data', 'operators', 'modes', 'i18n']);
  assert.deepEqual(m.parts.i18n, { files: ['i18n/en.json'], langs: { en: 'i18n/en.json' } });
  assert.deepEqual(declaredPaths(m).map((d) => d.rel), ['data/economy.json', 'operators/rosa.json', 'modes/marathon.json', 'i18n/en.json']);
  assert.equal(readPluginManifest(marathon(), ctx('marathon', { app: '0.4.1' })).manifest.compatible, false);
  assert.match(warningsOf({ ...marathon(), app: '0.2.x' }), /made for app 0\.2\.x; this is 0\.3\.0/);
});

test('manifest 2: defaults — the class\'s scope, priority 0, sourceLang zh, a plain-text name', () => {
  const raw = { manifest: 2, name: '德克萨斯配色', version: '1.0.0', app: '0.3.x', api: 1, class: 'cosmetic', permissions: ['assets.override'],
    assets: { chars: { char_102_texas: { avatar: 'art/avatar.png', spine: { front: { skel: 'spine/t.skel', atlas: 'spine/t.atlas', textures: ['spine/t.png'] } } }, char_x: { ref: 'char_112_siege.png' } } } };
  const { manifest: m, problems } = readPluginManifest(raw, ctx('texas-recolor'));
  assert.deepEqual(problems, []);
  assert.deepEqual(m.scope, ['room', 'personal']);
  assert.equal(m.priority, 0);
  assert.equal(m.sourceLang, 'zh');
  assert.deepEqual(m.names, { zh: '德克萨斯配色' });
  assert.equal(m.englishName, '德克萨斯配色', 'no English name: the name');
  assert.deepEqual(m.parts.assets.files, ['art/avatar.png', 'spine/t.skel', 'spine/t.atlas', 'spine/t.png'], 'a ref is a record, not a file');
  assert.equal(m.type, 'assets');
});

test('manifest 2: a lang plugin carries manifest 1\'s language fields and files', () => {
  const { manifest: m, problems, warnings } = readPluginManifest({ manifest: 2, class: 'lang', lang: 'pt_br', name: 'Português', version: '1.2.0',
    fallback: ['pt', 'zh', 'en'], files: { ui: 'ui.json', data: 'texts/game.json' } }, ctx('qab'));
  assert.deepEqual(problems, []);
  assert.deepEqual(warnings, ['"lang": "pt_br" read as pt-BR']);
  assert.deepEqual([m.lang, m.fallback, m.files, m.name, m.scope, m.api], ['pt-BR', ['pt', 'en'], { ui: 'ui.json', data: 'texts/game.json' }, 'Português', ['personal'], null]);
  assert.deepEqual(m.names, {}, 'a lang plugin\'s plain name is the language\'s own, not a text in zh');
  assert.equal(m.type, 'lang');
  assert.match(problemsOf({ manifest: 2, class: 'lang', lang: 'qab', version: '1.0.0' }, 'qab'), /no "files\.ui"/);
  assert.match(problemsOf({ manifest: 2, class: 'lang', lang: 'zh', version: '1.0.0', files: { ui: 'u.json' } }, 'zhx'), /source language/);
  assert.match(problemsOf({ manifest: 2, class: 'lang', lang: 'qab', version: '1.0.0', files: { ui: 'u.json' }, permissions: ['theme'] }, 'qab'), /the permission "theme" is not one a lang plugin may have/);
  assert.match(problemsOf({ manifest: 2, class: 'lang', lang: 'qab', version: '1.0.0', files: { ui: 'u.json' }, data: ['d.json'] }, 'qab'), /"data" is not something a lang plugin carries/);
});

test('manifest 2: what keeps a plugin out', () => {
  const cases = [
    [{ ...marathon(), manifest: undefined }, /no "manifest": 2/],
    [{ ...marathon(), manifest: 3 }, /"manifest": 3 is not 2/],
    [[1, 2], /not a JSON object/],
    [{ ...marathon(), class: 'magic' }, /unknown class "magic"/],
    [{ ...marathon(), class: undefined }, /no "class"/],
    [{ ...marathon(), version: undefined }, /no "version"/],
    [{ ...marathon(), version: '1.0' }, /"version": "1\.0" is not a semantic version/],
    [{ ...marathon(), app: undefined }, /no "app"/],
    [{ ...marathon(), app: 'soon' }, /"app": "soon" is not a version range/],
    [{ ...marathon(), api: undefined }, /no "api"/],
    [{ ...marathon(), api: PLUGIN_API.current + 1 }, /"api": \d+ is not supported/],
    [{ ...marathon(), api: 1.5 }, /"api": 1\.5 is not an integer/],
    [{ ...marathon(), scope: ['personal'] }, /a content plugin's scope is "room"/],
    [{ ...marathon(), scope: ['room', 'room'] }, /scope/],
    [{ ...marathon(), entry: { sim: 'sim/index.js' } }, /"entry\.sim" is not something a content plugin has/],
    [{ ...marathon(), permissions: [] }, /"data" needs the permission "data\.patch" or "data\.add"/],
    [{ ...marathon(), theme: { '--accent': '#fff' } }, /"theme" is not something a content plugin carries/],
    [{ ...marathon(), permissions: ['data.patch'] }, /"operators" needs the permission "data\.add"/],
    [{ ...marathon(), permissions: ['data.patch', 'data.add', 'fly'] }, /unknown permission "fly"/],
    [{ ...marathon(), permissions: ['data.patch', 'data.add', 'sim.code'] }, /the permission "sim\.code" is not one a content plugin may have/],
    [{ ...marathon(), data: ['../escape.json'] }, /"data"\[0\]: "\.\.\/escape\.json" is not a path inside the plugin folder/],
    [{ ...marathon(), data: 'data/economy.txt' }, /"data": data\/economy\.txt is not a \.json file/],
    [{ ...marathon(), data: [] }, /"data" is not a \.json path or a list of 1–256 of them/],
    [{ ...marathon(), i18n: { klingon: 'x.json' } }, /"i18n\.klingon" is not a language code/],
    [{ ...marathon(), files: { ui: 'ui.json' } }, /"files" belongs to a lang plugin, not a content one/],
    [{ ...marathon(), requires: { marathon: '*' } }, /"requires" names the plugin itself/],
    [{ ...marathon(), requires: { Base: '*' } }, /"requires": "Base" is not a plugin id/],
    [{ ...marathon(), requires: { base: 'soon' } }, /"requires\.base": "soon" is not a version range/],
    [{ ...marathon(), requires: { base: '*' }, conflicts: { base: '*' } }, /"base" is both required and a conflict/],
    [{ ...marathon(), loadAfter: ['ab'], loadBefore: ['ab'] }, /"ab" is in loadAfter and in loadBefore/],
    [{ ...marathon(), loadAfter: ['a'] }, /"loadAfter": "a" is not a plugin id/],
    [{ ...marathon(), priority: 1.5 }, /"priority": 1\.5 is not an integer within ±1000/],
    [{ ...marathon(), sourceLang: 'klingon' }, /"sourceLang": "klingon" is not a language code/],
  ];
  for (const [raw, re] of cases) {
    const r = readPluginManifest(raw, ctx('marathon'));
    assert.equal(r.manifest, null, `${re} keeps it out`);
    assert.match(r.problems.join(' | '), re);
  }
  assert.deepEqual(readPluginManifest({ ...marathon(), permissions: ['data.add'] }, ctx('marathon')).problems, [], 'data.add covers data too');
  assert.match(problemsOf(marathon(), 'Marathon'), /"Marathon" is not a plugin id/);
  assert.match(problemsOf(marathon(), 'a'), /"a" is not a plugin id/, 'at least 2 characters');
  assert.match(problemsOf(marathon(), 'my_plug'), /not a plugin id/, 'no underscore: it would collide in record ids');
});

test('a value JSON.parse reads but JSON.stringify cannot write back (deep nesting) is quoted by its kind, never thrown', () => {
  const deep = (open, close, n = 20000) => JSON.parse(`${open.repeat(n)}${close.repeat(n)}`);
  assert.match(readPluginManifest({ manifest: deep('[', ']') }, ctx('deep')).problems.join(), /"manifest": \[…\] is not 2/);
  assert.match(readPluginManifest({ ...marathon(), api: deep('[', ']') }, ctx('marathon')).problems.join(), /"api": \[…\] is not an integer/);
  assert.match(readPluginManifest({ ...marathon(), class: { a: deep('[', ']') } }, ctx('marathon')).problems.join(), /unknown class \{…\}/);
  assert.match(normalizeManifest({ name: 'Q', machineTranslated: deep('[', ']') }, { id: 'qam', type: 'lang', lang: 'qam' }).warnings.join(), /"machineTranslated": \[…\] is not true or false/);
  assert.equal(normalizeManifest({ name: 'Q', machineTranslated: { yes: 1 } }, { id: 'qam', type: 'lang', lang: 'qam' }).warnings[0],
    '"machineTranslated": {"yes":1} is not true or false (read as false)', 'an ordinary value is quoted as 0.2.0 quoted it');
});

test('manifest 2: settings — four types, bounded, no free text', () => {
  const s = (settings) => readPluginManifest({ ...marathon(), settings }, ctx('marathon'));
  const ok = s({
    hard: { type: 'boolean' },
    speed: { type: 'number', min: 0.5, max: 2, step: 0.25, default: 1.5, label: 'Speed' },
    mode: { type: 'enum', options: ['a', 'b', 3] },
  });
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(ok.manifest.settings, {
    hard: { type: 'boolean', default: false, label: {} },
    speed: { type: 'number', default: 1.5, min: 0.5, max: 2, step: 0.25, label: { zh: 'Speed' } },
    mode: { type: 'enum', default: 'a', options: ['a', 'b', 3], label: {} },
  });
  for (const [def, re] of [
    [{ type: 'text' }, /"type" "text" is not one of boolean, integer, number, enum/],
    [{ type: 'integer', min: 0 }, /an integer needs "min" ≤ "max"/],
    [{ type: 'integer', min: 3, max: 1 }, /an integer needs "min" ≤ "max"/],
    [{ type: 'integer', min: 0, max: 5, default: 7 }, /the default is not a value between min and max/],
    [{ type: 'number', min: 0, max: 1, step: 0.3, default: 0.5 }, /on its step/],
    [{ type: 'integer', min: 0, max: 1, step: 0 }, /"step" must be a positive integer/],
    [{ type: 'enum', options: [] }, /"options" is not a list/],
    [{ type: 'enum', options: ['a', 'a'] }, /"options" is not a list/],
    [{ type: 'enum', options: ['a'], default: 'b' }, /the default is not one of its options/],
    [{ type: 'boolean', default: 'yes' }, /the default of a boolean is true or false/],
  ]) assert.match(s({ x: def }).problems.join(), re);
  assert.match(s({ 'bad key': { type: 'boolean' } }).problems.join(), /a key is a letter/);
  const many = Object.fromEntries(Array.from({ length: PLUGIN_LIMITS.settings + 1 }, (_, i) => [`k${i}`, { type: 'boolean' }]));
  assert.match(s(many).problems.join(), /more than 32 settings/);
  assert.match(s({ x: { type: 'boolean', hint: 1 } }).warnings.join(), /"settings\.x"\.hint is not a setting field/);
});

test('manifest 2: warnings never keep a plugin out', () => {
  const r = readPluginManifest({ ...marathon(), id: 'other', homepage: 'ftp://x', colour: 'red', permissions: ['data.patch', 'data.add', 'assets.add'] }, ctx('marathon'));
  assert.ok(r.manifest, r.problems.join());
  const w = r.warnings.join(' | ');
  assert.match(w, /"id": "other" is not "marathon" \(the folder name decides\)/);
  assert.match(w, /"homepage": "ftp:\/\/x" is not an http\(s\) address/);
  assert.match(w, /"colour" is not a field of manifest 2/);
  assert.match(w, /the permission "assets\.add" is declared but nothing in the manifest uses it/);
  assert.equal(r.manifest.homepage, '');
  assert.match(warningsOf({ manifest: 2, version: '1.0.0', app: '*', api: 1, class: 'cosmetic' }, 'empty'), /carries nothing a cosmetic plugin is made of/);
});

test('manifest 2: inline assets name art, models, audio or fonts; a theme never names a URL; code classes need their permission', () => {
  const cos = (extra) => readPluginManifest({ manifest: 2, version: '1.0.0', app: '*', api: 1, class: 'cosmetic', permissions: ['assets.override', 'theme'], ...extra }, ctx('skin'));
  assert.match(cos({ assets: { ui: { 'top/bar': 'ui/bar.svg' } } }).problems.join(), /assets\.ui\.top\/bar: ui\/bar\.svg is not an image, a Spine file, audio or a font/);
  assert.match(cos({ assets: { chars: { c: { avatar: '../x.png' } } } }).problems.join(), /is not a path inside the plugin folder/);
  assert.deepEqual(cos({ assets: { audio: { bgm: 'audio/b.ogg' } }, theme: { '--amber': '#f6a329' } }).problems, []);
  assert.deepEqual(cos({ assets: { chars: { c: { avatar: 'a.png', scale: '1.5', anims: 'auto' } } } }).manifest.parts.assets.files, ['a.png'], 'only file names count');
  assert.match(cos({ assets: { chars: { c: { avatar: 'https://cdn.example/a.png' } } } }).problems.join(), /is not a path inside the plugin folder/, 'no outside URL');
  assert.match(cos({ assets: { audio: { bgm: 'audio/b.ogg' } }, theme: { '--bg': 'url(https://evil.example/x)' } }).problems.join(), /"theme" names a URL/);
  assert.match(cos({ assets: 'assets.json', permissions: [] }).problems.join(), /"assets" needs the permission "assets\.override" or "assets\.add"/);
  const script = readPluginManifest({ manifest: 2, version: '1.0.0', app: '*', api: 1, class: 'script', permissions: ['sim.code'], entry: { sim: 'sim/index.js', meta: 'meta/index.js' } }, ctx('kit'));
  assert.match(script.problems.join(), /"entry\.meta" needs the permission "meta\.code"/);
  const ui = readPluginManifest({ manifest: 2, version: '1.0.0', app: '*', api: 1, class: 'ui', permissions: ['ui.frame'], entry: { client: 'ui/index.js' } }, ctx('dps'));
  assert.match(ui.problems.join(), /"entry\.client": "ui\/index\.js" is not a \.html file/);
  const trusted = readPluginManifest({ manifest: 2, version: '1.0.0', app: '*', api: 1, class: 'trusted', permissions: ['trusted.server'], entry: { server: 'server/index.js' } }, ctx('admin'));
  assert.deepEqual([trusted.problems, trusted.manifest.scope], [[], ['server']]);
});

test('the classes: lang and cosmetic load (P1a), content loads (P1b), ui loads (P4), code is supported behind owner gates; manifest 1 types map onto them', () => {
  assert.deepEqual(Object.keys(PLUGIN_CLASSES), ['lang', 'cosmetic', 'content', 'script', 'ui', 'trusted']);
  assert.deepEqual(Object.keys(PLUGIN_CLASSES).map(classStatus), ['loaded', 'loaded', 'loaded', 'loaded', 'loaded', 'loaded']);
  assert.deepEqual(Object.entries(PLUGIN_CLASSES).filter(([, c]) => !c.unofficial).map(([k]) => k), ['lang'], 'everything but a language is unofficial');
  assert.equal(PACK_TYPES_COMPAT, PACK_TYPES, 'shared/packs.js forwards the type table');
  assert.deepEqual(Object.entries(PACK_TYPES).map(([k, v]) => [k, v.status, v.class]), [['lang', 'supported', 'lang'], ['assets', 'planned', 'cosmetic'], ['data', 'planned', 'content']]);
  for (const [p, classes] of Object.entries(PERMISSIONS)) for (const c of classes) assert.ok(PLUGIN_CLASSES[c], `${p}: ${c}`);
  assert.ok(!ASSET_EXT.includes('.svg'), 'no SVG (scripts in images)');
  assert.ok(!PLUGIN_CLASSES.cosmetic.ext.includes('.js') && !PLUGIN_CLASSES.content.ext.includes('.js'), 'no code in art or data');
  assert.equal(isPackPathCompat('a/b.json'), true);
  assert.equal(appVersionMatches('>=0.3.0 <0.4.0', '0.3.0-dev'), true);
  assert.deepEqual(['ab', 'a-b', '0x', 'a'.repeat(32), 'a', '-a', 'A', 'a_b', 'a.b', 'a'.repeat(33)].map(isPluginId),
    [true, true, true, true, false, false, false, false, false, false]);
  assert.equal(isPackId('pt-BR'), true);
  assert.deepEqual(['1.0.0', '0.2.1-beta.1', '1.0.0+build.5', '1.0', '01.0.0', 'v1.0.0'].map(isSemver), [true, true, true, false, false, false]);
});

test('manifest 1: shared/packs.js normalizeManifest is readPackManifest, the 0.2.0 fields unchanged', () => {
  const raw = { type: 'lang', lang: 'qab', name: 'Qab', version: '1.0.0', app: '0.1.x', files: { ui: 'ui.json', data: 'texts/game.json', notes: 'n.json' } };
  const a = normalizeManifest(raw, { id: 'qab', folder: true, app: '0.2.0' });
  const b = readPackManifest(raw, { id: 'qab', folder: true, app: '0.2.0' });
  assert.deepEqual(a, b);
  assert.deepEqual(a.problems, []);
  assert.deepEqual(a.warnings, ['made for app 0.1.x; this is 0.2.0', '"files.notes" is not a role of a lang pack (ignored)']);
  const m = a.manifest;
  assert.deepEqual([m.manifest, m.class, m.type, m.id, m.name, m.version, m.compatible, m.files], [1, 'lang', 'lang', 'qab', 'Qab', '1.0.0', false, { ui: 'ui.json', data: 'texts/game.json' }]);
  assert.deepEqual([m.scope, m.api, m.parts, m.settings], [['personal'], null, {}, {}], 'the manifest 2 fields at their defaults');
  const art = normalizeManifest({ type: 'assets', name: 'HD art' }, { id: 'art', folder: true });
  assert.deepEqual([art.problems, art.manifest.class], [[], 'cosmetic'], 'a planned type still reads (the registry skips it)');
  assert.match(normalizeManifest({ type: 'theme' }, { id: 'x', folder: true }).problems.join(), /unknown type "theme" \(known: lang, assets, data\)/);
  assert.equal(normalizeManifest({ type: 'lang', lang: 'qab' }, { id: 'qab', folder: true }).manifest, null, 'no files.ui');
  assert.equal(readPackManifest({ name: 'Q' }, { id: 'qaq', type: 'lang', lang: 'qaq' }).manifest.app, '', 'no range: any version');
  // 0.2.0's role lookup: a role named like an Object.prototype member passed silently, and still does (manifest 2 warns)
  const proto = { type: 'lang', lang: 'qab', files: { ui: 'ui.json', constructor: 'x.json', toString: 'y.json' } };
  assert.deepEqual(normalizeManifest(proto, { id: 'qab', folder: true }).warnings, []);
  assert.deepEqual(readPluginManifest({ manifest: 2, class: 'lang', lang: 'qab', version: '1.0.0', files: proto.files }, ctx('qab')).warnings,
    ['"files.constructor" is not a role of a lang plugin (ignored)', '"files.toString" is not a role of a lang plugin (ignored)']);
  assert.equal(APP_VERSION.length > 0, true);
});

test('files: types by class, documents, sizes, links, counts and the paths a manifest names', () => {
  const m = readPluginManifest(marathon(), ctx('marathon')).manifest;
  const files = [
    { rel: 'plugin.json', bytes: 900 }, { rel: 'README.md', bytes: 10 }, { rel: 'LICENSE', bytes: 10 }, { rel: 'docs/notes.txt', bytes: 5 },
    { rel: 'data/economy.json', bytes: 100 }, { rel: 'modes/marathon.json', bytes: 50 }, { rel: 'operators/rosa.json', bytes: 70 },
    { rel: 'i18n/en.json', bytes: 30 }, { rel: 'art/rosa.png', bytes: 2000 },
  ];
  const ok = checkPluginFiles(m, files);
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.count, 5, 'the manifest and the documents are not counted');
  assert.equal(ok.bytes, 3175);
  const bad = checkPluginFiles(m, [
    ...files.filter((f) => f.rel !== 'i18n/en.json'),
    { rel: 'tool.js', bytes: 1 }, { rel: 'pic.svg', bytes: 1 }, { rel: 'Makefile', bytes: 1 }, { rel: 'big.json', bytes: PLUGIN_LIMITS.jsonBytes + 1 },
    { rel: 'link.png', bytes: 0, link: true }, { rel: 'bad/../x.png', bytes: 1 },
  ]).problems.join('\n');
  assert.match(bad, /tool\.js: \.js is not a file a content plugin may carry/);
  assert.match(bad, /pic\.svg: \.svg is not a file a content plugin may carry/);
  assert.match(bad, /Makefile: a file without an extension is not a file a content plugin may carry/);
  assert.match(bad, /big\.json: 8\.0 MB, larger than the 8 MB a JSON file may be/);
  assert.match(bad, /link\.png: a symbolic link/);
  assert.match(bad, /bad\/\.\.\/x\.png: not a plain file name/);
  assert.match(bad, /"i18n": i18n\/en\.json is missing/);
  const crowd = Array.from({ length: PLUGIN_LIMITS.files + 1 }, (_, i) => ({ rel: `a/${i}.png`, bytes: 1 }));
  assert.match(checkPluginFiles(m, crowd).problems.join(), /5001 files, more than 5000/);
  assert.match(checkPluginFiles(m, [{ rel: 'huge.png', bytes: PLUGIN_LIMITS.pluginBytes + 1 }]).problems.join(), /MB in all, more than 200 MB/);
  // a ui plugin's frame files stay under its client's folder; code is a script / trusted / ui file only
  const ui = readPluginManifest({ manifest: 2, version: '1.0.0', app: '*', api: 1, class: 'ui', permissions: ['ui.frame'], entry: { client: 'ui/index.html' } }, ctx('dps')).manifest;
  assert.match(checkPluginFiles(ui, [{ rel: 'ui/index.html', bytes: 1 }, { rel: 'ui/a.js', bytes: 1 }, { rel: 'b.js', bytes: 1 }]).problems.join(), /b\.js: a frame file outside the folder of entry\.client \(ui\/\)/);
  const lang = readPluginManifest({ manifest: 2, class: 'lang', lang: 'qab', version: '1.0.0', files: { ui: 'ui.json' } }, ctx('qab')).manifest;
  assert.match(checkPluginFiles(lang, [{ rel: 'ui.json', bytes: 2 }, { rel: 'flag.png', bytes: 2 }]).problems.join(), /flag\.png: \.png is not a file a lang plugin may carry/);
});

test('JSON limits: nesting, numbers finite and within ±1e9', () => {
  assert.equal(checkJsonLimits({ a: [1, 2, { b: -1e9 }], s: 'x' }), null);
  assert.equal(checkJsonLimits(JSON.parse('{ "x": [0, 1e999] }')), '$.x[1]: a number that is not finite');
  assert.equal(checkJsonLimits({ hp: 2e9 }), '$.hp: 2000000000 is beyond ±1000000000');
  assert.equal(checkJsonLimits({ start: 1745674200 }, { numbers: 'safe' }), null);
  assert.equal(checkJsonLimits({ hp: 2e9 }, { numbers: 'safe' }), null);
  assert.match(checkJsonLimits({ hp: 1e20 }, { numbers: 'safe' }), /not a safe integer/);
  assert.match(checkJsonLimits({ hp: 1.5e16 }, { numbers: 'safe' }), /not a safe integer/);
  let deep = 0;
  for (let i = 0; i < PLUGIN_LIMITS.jsonDepth; i++) deep = [deep];
  assert.equal(checkJsonLimits(deep), null, 'exactly 64 levels');
  assert.match(checkJsonLimits([deep]), /nested deeper than 64 levels/);
});

test('the catalogue: entries by class then id, unofficial marks, no server paths', () => {
  const m = readPluginManifest(marathon(), ctx('marathon')).manifest;
  const lang = readPackManifest({ name: 'English' }, { id: 'en', type: 'lang', lang: 'en' }).manifest;
  const plugins = [
    { id: 'marathon', class: 'content', status: 'planned', source: 'plugins', manifest: m, bytes: 1234, count: 4 },
    { id: 'en', class: 'lang', status: 'loaded', source: 'i18n', manifest: lang },
  ];
  const body = buildPluginIndex(plugins, { app: APP, vanilla: 'ab'.repeat(32) });
  assert.deepEqual(Object.keys(body), ['version', 'app', 'api', 'content', 'plugins']);
  assert.deepEqual(body.content, { vanilla: 'ab'.repeat(32) });
  assert.deepEqual(body.api, { current: PLUGIN_API.current, min: PLUGIN_API.min });
  assert.deepEqual(body.plugins.map((e) => e.id), ['en', 'marathon']);
  const e = body.plugins[1];
  assert.equal(e.unofficial, true);
  assert.equal(body.plugins[0].unofficial, undefined, 'a language is not unofficial content');
  assert.deepEqual([e.status, e.source, e.manifest, e.bytes, e.files, e.version, e.compatible], ['planned', 'plugins', 2, 1234, 4, '0.1.0', true]);
  assert.deepEqual(e.settings, m.settings);
  assert.ok(!/data\/economy|\/Users\/|\\\\/.test(JSON.stringify(body)), 'no file path of the plugin');
  assert.equal(buildPluginIndex([]).content, undefined, 'no vanilla hash given: none listed');
  assert.deepEqual(pluginIndexEntry(plugins[1]).scope, ['personal']);
  // what the load order reads (a browser orders a player's personal plugins with it): set fields only
  const ordered = readPluginManifest({ ...marathon(), loadAfter: ['base'], loadBefore: ['late'], priority: 3 }, ctx('marathon')).manifest;
  const oe = pluginIndexEntry({ ...plugins[0], manifest: ordered });
  assert.deepEqual([oe.loadAfter, oe.loadBefore, oe.priority], [['base'], ['late'], 3]);
  assert.deepEqual([e.loadAfter, e.loadBefore, e.priority], [undefined, undefined, undefined], 'none set: none listed');
});
