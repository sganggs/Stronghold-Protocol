// test/plugins/schema.test.js — the JSON Schemas of plugins (schemas/plugin.schema.json, schemas/overlay.schema.json;
// DESIGN §32.9, the 0.3.0 plan's C7) say what the checks say: on one set of manifests and one set of asset overlays —
// valid ones and ones broken in every way a schema can describe — a fixture is accepted by the schema exactly when the
// checks (shared/plugins/manifest.js readPluginManifest, shared/plugins/visual.js readAssetOverlay) find neither a problem
// nor a warning in it. What only the checks can see (the folder and its files, the running game's version against
// "app", cross-field rules: a plugin both required and in conflict, a setting's default between its min and max, an
// atlas beside its skeleton with its name) is left out of the set and named in the schemas' descriptions. The templates
// of the studio and the repository's cosmetic and ui templates are accepted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { schemaValidator } from '../helpers/jsonSchema.js';
import { readPluginManifest } from '../../shared/plugins/manifest.js';
import { readAssetOverlay } from '../../shared/plugins/visual.js';
import { PLUGIN_API } from '../../shared/constants.js';
import { TEMPLATES, createPlugin } from '../../server/studio/templates/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const v = schemaValidator(path.join(ROOT, 'schemas'));
const C = (extra = {}) => ({ manifest: 2, version: '1.0.0', app: '>=0.3.0 <0.4.0', api: 1, class: 'cosmetic', permissions: ['assets.override'], assets: {}, ...extra });
const without = (o, k) => { const x = { ...o }; delete x[k]; return x; };

/** [name, manifest] — accepted by both, or by neither (see the header). */
const MANIFESTS = [
  ['the smallest cosmetic plugin', C()],
  ['with $schema, the folder id, names, a description, authors, licence, credits, homepage', C({ $schema: '../../schemas/plugin.schema.json', id: 'demo', name: { zh: '红', en: 'Red' }, description: '说明', authors: ['me', 'you'], license: 'CC-BY-4.0', credits: 'mine', homepage: 'https://example.com/x' })],
  ['scope personal, priority, order hints, dependencies', C({ scope: ['personal'], priority: -5, loadAfter: ['base'], loadBefore: ['top'], requires: { base: '>=1.0.0' }, optional: { opt: '*' }, conflicts: { rival: '^2.0.0' } })],
  ['a single scope string, an app alternative', C({ scope: 'room', app: '0.2.x || >=0.3.0' })],
  ['the overlay in a file', C({ assets: 'assets.json' })],
  ['an inline overlay', C({ assets: { chars: { char_102_texas: { avatar: 'art/a.png', spine: { front: { skel: 'm/t.skel' } } } } } })],
  ['settings of every type', C({ settings: { on: { type: 'boolean', default: true, label: '开' }, n: { type: 'integer', min: 0, max: 3, step: 1, default: 1 }, x: { type: 'number', min: 0, max: 1 }, e: { type: 'enum', options: ['a', 'b'], default: 'b' } } })],
  ['both asset permissions', C({ permissions: ['assets.override', 'assets.add'] })],
  ['a theme with its permission', C({ permissions: ['assets.override', 'theme'], theme: { '--mint-500': '#f00' } })],
  ['theme value at the raw length limit', C({ permissions: ['assets.override', 'theme'], theme: { vars: { '--t-fast': '0'.repeat(399) + 's' } } })],
  ['theme value over the raw length limit', C({ permissions: ['assets.override', 'theme'], theme: { vars: { '--t-fast': '0'.repeat(400) + 's' } } })],
  ['flat theme over the raw length limit', C({ permissions: ['assets.override', 'theme'], theme: { '--t-fast': '0'.repeat(400) + 's' } })],
  ['canonical theme variables', C({ permissions: ['assets.override', 'theme'], theme: { vars: { '--text-hi': '#f4faf7', '--t-fast': '0s' } } })],
  ['unknown theme variable', C({ permissions: ['assets.override', 'theme'], theme: { vars: { '--unknown': '#fff' } } })],
  ['theme has a mixed wrapper', C({ permissions: ['assets.override', 'theme'], theme: { vars: { '--text-hi': '#fff' }, extra: true } })],
  ['plain-text notices with translations', C({ notices: [{ id: 'hello', title: 'Hello', body: 'First\nSecond', date: '2026-10-17', i18n: { en: { title: 'Hi', body: 'Text' } } }] })],
  ['notice title too long', C({ notices: [{ id: 'hello', title: 'x'.repeat(81), body: 'B' }] })],
  ['notice missing body', C({ notices: [{ id: 'hello', title: 'Hi' }] })],
  ['notice duplicate ids', C({ notices: [{ id: 'hello', title: 'Hi', body: 'B' }, { id: 'hello', title: 'Hi', body: 'B' }] })],
  ['notice unknown keys', C({ notices: [{ id: 'hello', title: 'Hi', body: 'B', html: true }] })],
  ['notice translation unknown keys', C({ notices: [{ id: 'hello', title: 'Hi', body: 'B', i18n: { en: { title: 'Hi', body: 'B', html: true } } }] })],
  ['a content plugin', { manifest: 2, version: '0.1.0', app: '*', api: 1, class: 'content', permissions: ['data.patch', 'data.add'], data: ['data/a.json'], operators: 'ops.json', i18n: { en: 'i18n/en.json' } }],
  ['a content plugin with a DSL operator and a prep file', { manifest: 2, version: '0.1.0', app: '*', api: 1, class: 'content', permissions: ['data.add', 'dsl'], operators: ['operators/a.json'], dsl: ['dsl/income.json'] }],
  ['a prep-only DSL plugin', { manifest: 2, version: '0.1.0', app: '*', api: 1, class: 'content', permissions: ['dsl'], dsl: ['dsl/income.json'] }],
  ...['content', 'script', 'trusted'].map(cls => ['rules-only ' + cls, { manifest: 2, version: '1.0.0', app: '*', api: 2, class: cls, rules: { unequip: 'allow' } }]),
  ['empty rules-only content', { manifest: 2, version: '1.0.0', app: '*', api: 2, class: 'content', rules: {} }],
  ['a dsl part without the dsl permission', { manifest: 2, version: '0.1.0', app: '*', api: 1, class: 'content', permissions: ['data.add'], operators: ['ops.json'], dsl: ['dsl/a.json'] }],
  ['a dsl permission with no dsl part', { manifest: 2, version: '0.1.0', app: '*', api: 1, class: 'content', permissions: ['data.add', 'dsl'], operators: ['ops.json'] }],
  ['a lang plugin', { manifest: 2, version: '1.0.0', class: 'lang', lang: 'en', files: { ui: 'ui.json' } }],
  ['a ui plugin', { manifest: 2, version: '1.0.0', app: '*', api: 1, class: 'ui', scope: ['personal'], permissions: ['ui.frame'], entry: { client: 'ui/index.html' }, slots: ['hud.right', 'stats.tab'] }],
  ['a script plugin', { manifest: 2, version: '1.0.0', app: '*', api: 1, class: 'script', permissions: ['sim.code', 'mode.code'], entry: { sim: 'sim/index.js' } }],
  ['a trusted plugin', { manifest: 2, version: '1.0.0', app: '*', api: 1, class: 'trusted', scope: ['server'], permissions: ['trusted.server'], entry: { server: 'server/index.js' } }],
  ['trusted page is an ES module', {manifest:2,version:'1.0.0',app:'*',api:1,class:'trusted',permissions:['trusted.page'],entry:{client:'page.js'}}],
  ['trusted page rejects HTML', {manifest:2,version:'1.0.0',app:'*',api:1,class:'trusted',permissions:['trusted.page'],entry:{client:'page.html'}}],
  ['script override', {manifest:2,version:'1.0.0',app:'*',api:1,class:'script',permissions:['sim.code'],entry:{sim:'sim.js'},overrides:['chess_char_1_02_a']}],
  ['invalid overrides', C({overrides:['chess_char_1_02_a']})],
  // broken — a problem
  ['no manifest', without(C(), 'manifest')],
  ['manifest 1', C({ manifest: 1 })],
  ['no version', without(C(), 'version')],
  ['a version that is no semver', C({ version: '1.0' })],
  ['no app', without(C(), 'app')],
  ['an app that is no range', C({ app: 'latest' })],
  ['no api', without(C(), 'api')],
  ['an api this game does not support', C({ api: PLUGIN_API.current + 1 })],
  ['an unknown class', C({ class: 'skin' })],
  ['a scope the class does not allow', C({ scope: ['server'] })],
  ['an empty scope', C({ scope: [] })],
  ['the overlay without a permission', C({ permissions: [] })],
  ['an unknown permission', C({ permissions: ['assets.override', 'fly'] })],
  ['a permission of another class', C({ permissions: ['assets.override', 'data.patch'] })],
  ['a part of another class', C({ data: ['d.json'], permissions: ['assets.override'] })],
  ['an entry of another class', C({ entry: { client: 'x.html' } })],
  ['a lang field in a cosmetic plugin', C({ lang: 'en' })],
  ['a dependency that is no plugin id', C({ requires: { Bad_ID: '*' } })],
  ['a dependency range that is no range', C({ requires: { base: 'abc' } })],
  ['a priority out of range', C({ priority: 5000 })],
  ['a setting key that starts with a digit', C({ settings: { '1x': { type: 'boolean' } } })],
  ['an integer setting without max', C({ settings: { n: { type: 'integer', min: 0 } } })],
  ['an enum setting without options', C({ settings: { e: { type: 'enum' } } })],
  ['a sourceLang that is no language code', C({ sourceLang: '日本' })],
  ['the overlay as a file that is no .json', C({ assets: 'assets.txt' })],
  ['an overlay path out of the folder', C({ assets: { chars: { char_102_texas: { avatar: '../a.png' } } } })],
  ['a lang plugin without files', { manifest: 2, version: '1.0.0', class: 'lang', lang: 'en' }],
  ['a lang plugin for the source language', { manifest: 2, version: '1.0.0', class: 'lang', lang: 'zh', files: { ui: 'ui.json' } }],
  ['slots on a cosmetic plugin', C({ slots: ['hud.right'] })],
  ['a ui plugin without its page', { manifest: 2, version: '1.0.0', app: '*', api: 1, class: 'ui', permissions: ['ui.frame'], slots: ['hud.right'] }],
  ['a slot that is no slot', { manifest: 2, version: '1.0.0', app: '*', api: 1, class: 'ui', permissions: ['ui.frame'], entry: { client: 'ui/index.html' }, slots: ['hud.left'] }],
  ['the same slot twice', { manifest: 2, version: '1.0.0', app: '*', api: 1, class: 'ui', permissions: ['ui.frame'], entry: { client: 'ui/index.html' }, slots: ['hud.right', 'hud.right'] }],
  // broken — a warning
  ['an unknown field', C({ colour: 'red' })],
  ['a name that is no text', C({ name: 5 })],
  ['a name in a language that is no code', C({ name: { 日本: 'x' } })],
  ['a homepage that is no http(s) address', C({ homepage: 'ftp://example.com' })],
  ['a permission nothing uses', C({ permissions: ['assets.override', 'theme'] })],
  ['carries nothing', without(C(), 'assets')],
  ['an unknown setting field', C({ settings: { b: { type: 'boolean', hint: 'x' } } })],
  ['an unknown entry point', { manifest: 2, version: '1.0.0', app: '*', api: 1, class: 'ui', permissions: ['ui.frame'], entry: { client: 'ui/index.html', extra: 'x.js' }, slots: ['hud.right'] }],
  ['a ui plugin that asks for no slot', { manifest: 2, version: '1.0.0', app: '*', api: 1, class: 'ui', permissions: ['ui.frame'], entry: { client: 'ui/index.html' } }],
  ['a ui plugin with an empty slot list', { manifest: 2, version: '1.0.0', app: '*', api: 1, class: 'ui', permissions: ['ui.frame'], entry: { client: 'ui/index.html' }, slots: [] }],
  ['an overlay field a cosmetic plugin does not change', C({ assets: { chars: { char_102_texas: { skin: 'a.png' } } } })],
];

/** [name, overlay] — accepted by both, or by neither. */
const OVERLAYS = [
  ['nothing', {}],
  ['an avatar', { chars: { char_102_texas: { avatar: 'art/a.png', avatarE2: 'art/b.webp', portrait: 'p.jpg', portraitE2: 'P.PNG' } } }],
  ['a model with its atlas and pages', { chars: { char_102_texas: { spine: { front: { skel: 'm/t.skel', atlas: 'm/t.atlas', textures: ['m/t.png', 'm/t2.png'], pma: false }, back: { skel: 'b/t.skel', anims: 'auto' } } } } }],
  ['a whole record borrowed, one field its own', { chars: { char_102_texas: { ref: 'char_112_siege', avatar: 'a.png' } } }],
  ['field references', { chars: { char_102_texas: { avatar: { ref: 'char_112_siege' }, spine: { front: { ref: 'char_112_siege' } } } } }],
  ['an illustration and two skins of one operator, a skin key with @ and #', { chars: { char_4058_pepe: { illust: 'art/pepe.png', skins: {
    'char_4058_pepe@sightseer#2': { name: '悠然假日', group: '珊瑚海岸', avatar: 'art/a.png', avatarE2: 'art/b.webp', portrait: 'p.jpg', portraitE2: 'P.PNG', illust: 'art/pepe.png',
      spine: { front: { skel: 'm/t.skel', atlas: 'm/t.atlas', textures: ['m/t.png', 'm/t2.png'], pma: true }, back: { skel: 'b/t.skel', anims: 'auto' } } },
    char_4058_pepe_sightseer_2: { ref: 'char_112_siege', name: 'stem form' } } } } }],
  ['an enemy, a summon', { enemies: { enemy_1007_slime: { icon: 'e.png', spine: { skel: 'e/s.skel' } } }, tokens: { token_x: { avatar: 't.png', spine: { ref: 'token_y' } } } }],
  ['a skin key of exactly 64 characters, a series left empty', { chars: { char_102_texas: { skins: { ['s'.repeat(64)]: { name: 'x', group: '' }, s: { name: 'y', group: '时代/VII' } } } } }],
  ['icons and interface pictures', { bonds: { yanShip: 'b.png' }, items: { trap_1: 'i.png' }, bands: { band_a: { ref: 'band_b' } }, skills: { s1: 's.png' }, modules: { 'PRI-X': 'm.png' }, ui: { 'battle/sprite_shadow': 'u.png' }, prof: { icon: { sniper: 'p.png' }, sub: { fortress: 'q.png' } } }],
  ['music', { audio: { bgm: { lobby: { intro: 'i.mp3', loop: 'l.ogg' }, boss: { ref: 'combat' } }, bossBgm: { boss_1: { loop: 'b.mp3' } } } }],
  ['voices', { audio: { voice: { char_102_texas: { select: ['a.mp3', 'b.mp3'], skill1: 's.ogg', place: { ref: 'char_112_siege' } } }, voiceJp: { char_102_texas: { ref: 'char_112_siege' } } } }],
  ['sounds', { audio: { sfx: { ui: { click: 'c.mp3' }, battle: { win: { ref: 'lose' } }, units: { char_102_texas: { attack: 'a.mp3', skills: { 0: 's.mp3', 12: 't.mp3' }, hits: { ref: 'char_x' } } } } } }],
  // broken — a problem
  ['not an object', 'nope'],
  ['a container that is no object', { chars: 'x' }],
  ['a record that is no object', { chars: { char_102_texas: 'a.png' } }],
  ['an entry key with a space', { chars: { 'char 102': { avatar: 'a.png' } } }],
  ['a picture that is a sound', { chars: { char_102_texas: { avatar: 'a.mp3' } } }],
  ['a path out of the folder', { chars: { char_102_texas: { avatar: '../a.png' } } }],
  ['an absolute path', { chars: { char_102_texas: { avatar: '/assets/a.png' } } }],
  ['a hidden part', { chars: { char_102_texas: { avatar: 'art/.a.png' } } }],
  ['a URL', { chars: { char_102_texas: { avatar: 'https://example.com/a.png' } } }],
  ['clip data by hand', { chars: { char_102_texas: { spine: { front: { skel: 'm/t.skel', animations: { Idle: 1 } } } } } }],
  ['anims other than auto', { enemies: { e: { spine: { skel: 'm/t.skel', anims: { idle: 'Idle' } } } } }],
  ['a model without its skeleton', { enemies: { e: { spine: { atlas: 'm/t.atlas' } } } }],
  ['no pages', { enemies: { e: { spine: { skel: 'm/t.skel', textures: [] } } } }],
  ['pma that is no boolean', { enemies: { e: { spine: { skel: 'm/t.skel', pma: 'yes' } } } }],
  ['a field reference with another key', { chars: { char_102_texas: { avatar: { ref: 'char_112_siege', x: 1 } } } }],
  ['a reference that names no entry', { chars: { char_102_texas: { avatar: { ref: 'a b' } } } }],
  ['a track without its loop', { audio: { bgm: { lobby: { intro: 'i.mp3' } } } }],
  ['an illustration that is a sound', { chars: { char_102_texas: { illust: 'a.mp3' } } }],
  ['a skin name that is no text', { chars: { char_102_texas: { skins: { s: { name: 5 } } } } }],
  ['a skin name of 65 characters', { chars: { char_102_texas: { skins: { s: { name: 'x'.repeat(65) } } } } }],
  ['a skin picture that is a sound', { chars: { char_102_texas: { skins: { s: { avatar: 'a.mp3' } } } } }],
  ['sixty-five skins of one operator', { chars: { char_102_texas: { skins: Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`skin_${i}`, { name: `s${i}` }])) } } }],
  ['a skin key that is no skin key', { chars: { char_102_texas: { skins: { 'bad key!': { name: 'x' } } } } }],
  ['a skin key of 65 characters', { chars: { char_102_texas: { skins: { ['s'.repeat(65)]: { name: 'x' } } } } }],
  ['seventeen lines in one slot', { audio: { voice: { c: { select: Array.from({ length: 17 }, (_, i) => `v${i}.mp3`) } } } }],
  ['an empty list of lines', { audio: { voice: { c: { select: [] } } } }],
  // broken — a warning
  ['a section a cosmetic plugin does not change', { fonts: { a: 'f.woff2' } }],
  ['a field of a record that does not exist', { chars: { char_102_texas: { skin: 'a.png' } } }],
  ['the mode\'s own battle music', { audio: { bgm: { combatAlts: { loop: 'a.mp3' } } } }],
  ['a voice slot that is no slot name', { audio: { voice: { c: { '1bad': 'a.mp3' } } } }],
  ['a skill index that is no index', { audio: { sfx: { units: { u: { skills: { x: 'a.mp3' } } } } } }],
  ['an unknown field of a track', { audio: { bgm: { lobby: { loop: 'a.mp3', volume: 1 } } } }],
  ['an unknown field of a model', { chars: { char_102_texas: { spine: { front: { skel: 'm/t.skel', scale: 2 } } } } }],
  ['a field of a skin that does not exist', { chars: { char_102_texas: { skins: { sightseer_2: { skin: 'a.png' } } } } }],
];

test('the manifest schema accepts exactly what the checks find clean (no problem, no warning)', () => {
  const disagree = [];
  for (const [name, m] of MANIFESTS) {
    const r = readPluginManifest(m, { id: 'demo', app: '0.3.0', api: PLUGIN_API });
    let clean = !r.problems.length && !r.warnings.length;
    // an inline overlay is checked as the registry checks it
    if (clean && r.manifest?.parts.assets?.inline) { const o = readAssetOverlay(r.manifest.parts.assets.inline); clean = !o.problems.length && !o.warnings.length; }
    const errs = v.validate('plugin.schema.json', m);
    if (clean !== !errs.length) disagree.push(`${name}: checks ${clean ? 'clean' : [...r.problems, ...r.warnings].join(' / ')} · schema ${errs.length ? errs.slice(0, 3).join(' / ') : 'valid'}`);
  }
  assert.deepEqual(disagree, []);
  const clean = MANIFESTS.filter(([, m]) => !v.validate('plugin.schema.json', m).length).length;
  assert.ok(clean >= 10 && MANIFESTS.length - clean >= 30, `${clean} valid, ${MANIFESTS.length - clean} broken fixtures`);
});

test('the manifest schema bounds raw theme strings in both accepted map shapes', () => {
  for (const wrapped of [false, true]) for (const length of [400, 401]) {
    const vars = { '--t-fast': '0'.repeat(length - 1) + 's' };
    const m = C({ permissions: ['assets.override', 'theme'], theme: wrapped ? { vars } : vars });
    assert.equal(v.validate('plugin.schema.json', m).length === 0, length === 400);
  }
});

test('a notices-only cosmetic agrees with the runtime; an empty notices-only payload is not clean', () => {
  const manifest = { manifest: 2, version: '1.0.0', class: 'cosmetic', app: '*', api: PLUGIN_API.current, scope: ['personal'],
    notices: [{ id: 'hello', title: 'Hello', body: 'Plain text' }] };
  assert.deepEqual(v.validate('plugin.schema.json', manifest), []);
  const read = readPluginManifest(manifest, { id: 'notice-demo' });
  assert.deepEqual(read.problems, []); assert.deepEqual(read.warnings, []);
  assert.ok(v.validate('plugin.schema.json', { ...manifest, notices: [] }).length);
});

test('the overlay schema accepts exactly what the checks find clean (no problem, no warning)', () => {
  const disagree = [];
  for (const [name, o] of OVERLAYS) {
    const r = readAssetOverlay(o);
    const clean = !r.problems.length && !r.warnings.length;
    const errs = v.validate('overlay.schema.json', o);
    if (clean !== !errs.length) disagree.push(`${name}: checks ${clean ? 'clean' : [...r.problems, ...r.warnings].join(' / ')} · schema ${errs.length ? errs.slice(0, 3).join(' / ') : 'valid'}`);
  }
  assert.deepEqual(disagree, []);
});

test('the studio\'s templates and plugins/_template/cosmetic/ and ui/ are accepted; the schemas are draft 2020-12 with descriptions', () => {
  const target = { kind: 'operator', key: 'char_102_texas', container: ['chars'], name: '德克萨斯' };
  for (const tpl of TEMPLATES) {
    const t = tpl.kinds.includes('operator') ? target : { kind: 'music', key: 'lobby', container: ['audio', 'bgm'], name: 'lobby', group: 'bgm' };
    for (const tg of [t, null]) {
      const { manifest } = createPlugin(tpl, { id: 'demo', name: '名字', target: tg, authors: ['me'], license: 'CC0-1.0' });
      const errors = v.validate('plugin.schema.json', manifest);
      assert.deepEqual(errors, [], `${tpl.id} ${tg ? tg.kind : 'no target'}`);
    }
  }
  for (const dir of ['cosmetic', 'ui', 'content']) {
    const m = JSON.parse(fs.readFileSync(path.join(ROOT, `plugins/_template/${dir}/plugin.json`), 'utf8'));
    assert.deepEqual(v.validate('plugin.schema.json', m), [], dir);
  }
  for (const f of ['plugin.schema.json', 'overlay.schema.json']) {
    const s = JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas', f), 'utf8'));
    assert.equal(s.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.ok(s.title && s.description.length > 100, `${f}: title and description`);
  }
});

test('API 2 operator files can consume trait permissions; complete file checks still validate their use', () => {
  const manifest = { manifest: 2, version: '1.0.0', class: 'content', app: '*', api: 2,
    permissions: ['data.add', 'data.patch', 'dsl'], operators: ['trait.json'] };
  assert.deepEqual(v.validate('plugin.schema.json', manifest), []);
  assert.ok(v.validate('plugin.schema.json', without(manifest, 'operators')).length);
  assert.ok(v.validate('plugin.schema.json', { ...manifest, api: 1 }).length);
  assert.ok(v.validate('plugin.schema.json', { ...manifest, class: 'cosmetic' }).length);
});


test('the shipped offers example validates, and offers manifest constraints match the reader', () => {
  const example = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/examples/offers-demo/plugin.json'), 'utf8'));
  assert.deepEqual(v.validate('plugin.schema.json', example), []);
  const O = extra => ({ manifest: 2, version: '1.0.0', class: 'content', app: '*', api: 2, permissions: ['offers'], offers: ['offers.json'], ...extra });
  const cases = [
    ...['content', 'script', 'trusted'].map(cls => [true, O({ class: cls })]),
    [true, O({ offers: 'offers.json' })],
    ...['cosmetic', 'lang', 'ui'].map(cls => [false, O({ class: cls })]),
    [false, O({ api: 1 })], [false, without(O(), 'api')],
    [false, O({ permissions: [] })], [false, without(O(), 'permissions')],
    [false, without(O(), 'offers')], [false, O({ offers: [] })],
    [false, O({ offers: ['../out.json'] })], [false, O({ offers: 'bad.js' })],
    [false, O({ offers: {} })], [false, O({ offers: Array(257).fill('offers.json') })],
  ];
  for (const [valid, manifest] of cases) {
    const read = readPluginManifest(manifest, { id: 'demo', app: '0.3.1', api: PLUGIN_API });
    assert.equal(!read.problems.length && !read.warnings.length, valid, JSON.stringify(manifest));
    assert.equal(v.validate('plugin.schema.json', manifest).length === 0, valid, JSON.stringify(manifest));
  }
});
