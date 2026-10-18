// Synthetic authoring/renderer contracts. No pack files, official art, sockets or browser process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { fixture } from '../helpers/contentFixtures.js';
import { png, skel, atlas } from '../helpers/pluginFixtures.js';
import { createPlugin, templateById, manifestText } from '../../server/studio/templates/index.js';
import { createAuthoring } from '../../server/studio/authoring.js';
import { createPluginFiles } from '../../server/studio/files.js';
import { checkPluginFolder, packPlugin } from '../../server/plugins/pack.js';
import { createPreviews } from '../../server/studio/preview.js';
import { buildContentSet } from '../../server/plugins/contentSet.js';
import { createTrialBench } from '../../server/studio/trial.js';
import { createStudio } from '../../server/studio/index.js';
import { presentationOptions, validatePresentation, emptyBook } from '../../public/studio/js/presentation.js';
import { validateDraft } from '../../public/studio/js/validateDraft.js';
import { readThemeDeclaration, THEME_TOKENS } from '../../shared/plugins/theme.js';
import { readNotices, localizeNotice } from '../../shared/plugins/notices.js';
import { flipbookProblems, flipbookFrame } from '../../public/js/render/vfx/pluginFormat.js';
import { options as preact } from '../../public/vendor/preact.module.js';
import { EDITORS } from '../../public/studio/js/editors/index.js';
import { previewTheme } from '../../public/studio/js/editors/theme.js';
import { data } from '../../public/js/data.js';
import { availableSkins } from '../../public/js/ui/skins.js';
import { createPreviewLayers } from '../../public/studio/js/preview/layers.js';

function make(f, template, options = {}, id = `look-${template}`) {
  const made = createPlugin(templateById(template), { id, options });
  const dir = f.put(id, { permissions: [], ...made.manifest });
  for (const [rel, body] of Object.entries(made.files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), body);
  }
  fs.writeFileSync(path.join(dir, '.studio.json'), manifestText({ v: 1, authoring: made.authoring }));
  f.registry.rescan();
  const files = createPluginFiles(path.join(f.dir, 'plugins'));
  return { id, dir, made, files, author: createAuthoring({ files, dataDir: path.resolve('data') }) };
}

for (const template of ['theme', 'notices', 'fx', 'skins']) test(`${template}: strict CLI check, visual/content composition and form JSON round trip`, t => {
  const f = fixture(t), m = make(f, template);
  const run = spawnSync(process.execPath, ['tools/plugin.mjs', 'check', m.dir, '--strict'], { encoding: 'utf8', timeout: 60000 });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.equal(packPlugin(m.dir).wrote, true);
  const original = m.author.read(m.id);
  const draft = { ...JSON.parse(JSON.stringify(original)), id: m.id };
  if (template === 'theme') draft.options = { vars: { '--mint-500': '#123456', '--t-fast': '2s' } };
  if (template === 'notices') draft.options = { notices: [{ id: 'hello', title: 'Hello', body: '<b>plain</b>\nSecond line', date: '2026-10-17', i18n: { ja: { title: 'JP', body: 'Translation' } } }] };
  if (template === 'fx') draft.options = { ...presentationOptions('fx'), flipbooks: [{ ...emptyBook(), fps: 24 }], bindings: [{ slot: '0', phase: 'hit', effect: 'flash' }] };
  if (template === 'skins') draft.options.outfits[0] = { key: 'char_102_texas@winter#1', name: 'Winter', group: 'Test' };
  m.author.save(m.id, draft);
  assert.deepEqual(m.author.read(m.id).options, draft.options);
  const check = checkPluginFolder(m.dir);
  assert.deepEqual(check.problems, []); assert.deepEqual(check.warnings, []);
  f.registry.rescan();
  if (m.made.manifest.scope?.includes('room') || !m.made.manifest.scope) assert.deepEqual(buildContentSet({ registry: f.registry, ids: [m.id] }).problems, []);
  else assert.ok(f.registry.pluginIndex().plugins.some(p => p.id === m.id && p.status === 'loaded'), 'personal presentations compose in the catalogue');
  const preview = createPreviews({ vanilla: () => null }).preview(m.id, m.dir);
  if (template === 'skins') assert.ok(preview.ops.some(op => op.at.at(-1) === 'name' && op.value === 'Winter'));
  if (template === 'fx') assert.equal(preview.ops[0].value.config.flipbooks.flash.fps, 24);
  if (template === 'theme') assert.deepEqual(JSON.parse(fs.readFileSync(path.join(m.dir, 'plugin.json'))).theme.vars, draft.options.vars);
  if (template === 'notices') assert.equal(localizeNotice(draft.options.notices[0], 'ja').body, 'Translation');
});

const invalid = [
  ['theme', { vars: { '--t-fast': '2001ms' } }, 'PLUGIN_THEME_VALUE'],
  ['theme', { vars: { '--bg-0': 'url(https://example.test)' } }, 'PLUGIN_THEME_URL'],
  ['notices', { notices: [{ id: 'n', title: 'a'.repeat(81), body: 'body' }] }, 'PLUGIN_NOTICE_LIMIT'],
  ['notices', { notices: [{ id: 'n', title: 'ok', body: 'a'.repeat(2001) }] }, 'PLUGIN_NOTICE_LIMIT'],
  ['notices', { notices: [{ id: 'n', title: 'ok', body: 'body', date: '2026-02-29' }] }, 'PLUGIN_NOTICE_SHAPE'],
  ['skins', { outfits: Array.from({ length: 65 }, (_, i) => ({ key: `s${i}`, name: 'S' })) }, 'PLUGIN_ASSETS_SHAPE'],
  ['skins', { outfits: [{ key: '../bad', name: 'S' }] }, 'PLUGIN_ASSETS_SHAPE'],
  ['skins', { outfits: [{ key: 'valid', name: 'x'.repeat(65) }] }, 'PLUGIN_ASSETS_SHAPE'],
  ['fx', { flipbooks: [{ ...emptyBook(), fps: 61 }] }, 'PLUGIN_PART_SHAPE'],
  ['fx', { flipbooks: [{ ...emptyBook(), frames: 0 }] }, 'PLUGIN_PART_SHAPE'],
  ['fx', { flipbooks: [{ ...emptyBook(), scale: 8.01 }] }, 'PLUGIN_PART_SHAPE'],
  ['fx', { bindings: [{ slot: '__proto__', phase: 'attack', effect: 'flash' }] }, 'PLUGIN_PART_SHAPE'],
];
test('live validation and the save gate refuse the same out-of-range inputs as server generation', async t => {
  const f = fixture(t);
  for (const [template, options, code] of invalid) {
    const draft = { id: `bad-${template}`, template, options };
    const local = validatePresentation(draft);
    assert.equal(local.ok, false, JSON.stringify(options)); assert.equal(local.problems[0].code, code);
    assert.ok(local.problems[0].message); assert.ok(local.problems[0].path);
    assert.deepEqual(await validateDraft(draft, {}), local);
    assert.throws(() => createPlugin(templateById(template), { id: draft.id, options }), { code });
    const m = make(f, template);
    const before = m.author.read(m.id);
    assert.throws(() => m.author.save(m.id, { ...before, options }), { code });
    assert.equal(m.author.read(m.id).revision, before.revision, 'invalid save writes no file');
  }
  assert.equal({}.attack, undefined);
  assert.equal(readThemeDeclaration({ vars: invalid[0][1].vars }).problems[0].code, 'PLUGIN_THEME_VALUE');
  assert.equal(readNotices(invalid[2][1].notices).problems[0].code, 'PLUGIN_NOTICE_LIMIT');
  assert.ok(flipbookProblems({ ...emptyBook(), fps: 61 }).length);
});

// Render just the hook-driven form to VNodes, without a DOM and without running effects/fetch. Exercise the real
// callbacks of its native inputs and controls; server-side JSON generation then consumes that exact draft.
function form(Component, props) {
  const node = { __c: { __h: [], props, context: {}, setState() {} } };
  preact.__r(node);
  try { return Component(props); } finally { preact.__b(node); }
}
function nodes(root) {
  if (Array.isArray(root)) return root.flatMap(nodes);
  if (!root || typeof root !== 'object') return [];
  return [root, ...nodes(root.props?.children)];
}
test('all four real editor forms update drafts consumed by their templates; native number controls retain validator bounds', t => {
  const f = fixture(t);
  for (const template of ['theme', 'notices', 'fx', 'skins']) {
    const m = make(f, template);
    let draft = { ...m.author.read(m.id), id: m.id };
    const props = () => ({ draft, state: { id: m.id, authoring: draft, files: [] }, onChange: next => { draft = next; } });
    const tree = nodes(form(EDITORS[template].Component, props()));
    if (template === 'theme') {
      assert.equal(tree.filter(n => n.props?.['data-token']).length, Object.keys(THEME_TOKENS).length);
      tree.find(n => n.props?.type === 'color').props.onInput({ currentTarget: { value: '#112233' } });
      assert.equal(draft.options.vars['--bg-0'], '#112233');
    }
    if (template === 'notices') {
      tree.find(n => n.props?.label === 'id').props.onChange('edited-notice');
      assert.equal(draft.options.notices[0].id, 'edited-notice');
    }
    if (template === 'fx') {
      const fps = tree.find(n => n.props?.label === 'fps');
      assert.equal(fps.props.min, 0.1); assert.equal(fps.props.max, 60); fps.props.onChange(25);
      assert.equal(draft.options.flipbooks[0].fps, 25);
    }
    if (template === 'skins') {
      const line = tree.find(n => n.props?.value === 'Outfit 1'); line.props.onChange('Edited outfit');
      assert.equal(draft.options.outfits[0].name, 'Edited outfit');
    }
    m.author.save(m.id, draft);
    assert.deepEqual(m.author.read(m.id).options, draft.options);
  }
});

test('theme preview only writes accepted tokens and restores prior inline values and priorities', () => {
  const values = new Map([['--bg-0', ['#abcdef', 'important']]]);
  const style = { getPropertyValue: k => values.get(k)?.[0] || '', getPropertyPriority: k => values.get(k)?.[1] || '',
    setProperty: (k, v, p = '') => values.set(k, [v, p]), removeProperty: k => values.delete(k) };
  const restore = previewTheme(style, { '--bg-0': '#112233', '--mint-500': '#ffffff', '--line': 'url(bad)', '--bad': '#fff' });
  assert.equal(values.get('--bg-0')[0], '#112233'); assert.equal(values.has('--line'), false); assert.equal(values.has('--bad'), false);
  restore(); assert.deepEqual([...values], [['--bg-0', ['#abcdef', 'important']]]);
});

test('skin slots survive metadata edits and rename, and a clear is never resurrected; picker uses real fallbacks', t => {
  const f = fixture(t), m = make(f, 'skins');
  const file = path.join(m.dir, 'plugin.json'), raw = JSON.parse(fs.readFileSync(file));
  raw.description = 'Keep metadata'; raw.assets.items = { test_icon: 'art/icon.png' };
  raw.assets.chars.char_102_texas.skins['outfit-1'].avatar = 'art/face.png';
  fs.mkdirSync(path.join(m.dir, 'art')); fs.writeFileSync(path.join(m.dir, 'art/face.png'), png(4, 4)); fs.writeFileSync(path.join(m.dir, 'art/icon.png'), png(4, 4));
  fs.writeFileSync(file, JSON.stringify(raw));
  const draft = m.author.read(m.id); draft.options.outfits[0].name = 'Renamed'; draft.options.outfits[0].key = 'winter@1#2';
  m.author.save(m.id, draft);
  const saved = JSON.parse(fs.readFileSync(file));
  assert.equal(saved.assets.chars.char_102_texas.skins['winter@1#2'].avatar, 'art/face.png'); assert.equal(saved.description, raw.description); assert.ok(saved.assets.items);
  delete saved.assets.chars.char_102_texas.skins['winter@1#2'].avatar; fs.writeFileSync(file, JSON.stringify(saved));
  m.author.save(m.id, m.author.read(m.id));
  assert.equal(JSON.parse(fs.readFileSync(file)).assets.chars.char_102_texas.skins['winter@1#2'].avatar, undefined);
  const layers = createPreviewLayers();
  layers.set(createPreviews({ vanilla: () => null }).preview(m.id, m.dir).ops, [{ kind: 'operator', key: 'char_102_texas', container: ['chars'] }]);
  data.setContent({ id: 'a'.repeat(64), values: { assets: layers.apply({ chars: { char_102_texas: { portrait: '/own.png' } } }) } });
  t.after(() => data.setContent(null));
  const row = availableSkins('char_102_texas~plugin').find(row => row.id === 'winter@1#2');
  assert.equal(row.portrait, '/own.png'); assert.equal(row.playable, false);
});

test('existing slot API keeps distinct skin keys and front/back models apart, and adding art keeps the wizard', async t => {
  const f = fixture(t), m = make(f, 'skins', { outfits: [{ key: 'a@b', name: 'One' }, { key: 'a#b', name: 'Two' }] });
  const studio = createStudio({ registry: f.registry, pluginsDir: path.join(f.dir, 'plugins'), dataDir: path.resolve('data'), publicDir: path.resolve('public'), watch: () => ({ on() {}, close() {} }) });
  t.after(() => studio.close());
  const call = async (sub, body) => {
    const req = Readable.from([Buffer.from(JSON.stringify(body))]);
    req.method = 'POST'; req.complete = true; req.headers = { host: 'localhost:3000', 'x-sp-studio': studio.key }; req.socket = { remoteAddress: '127.0.0.1' };
    const res = new EventEmitter(); let status, result;
    Object.assign(res, { setHeader() {}, writeHead(code) { status = code; }, end(data) { this.writableEnded = true; result = JSON.parse(data); }, destroy() {} });
    await studio.handle(req, res, `/studio/api/plugins/${m.id}/${sub}`, '');
    assert.equal(status, 200, JSON.stringify(result)); return result;
  };
  for (const key of ['a@b', 'a#b']) for (const side of ['front', 'back']) {
    await call('slot', { at: ['chars', 'char_102_texas', 'skins', key, 'spine', side], files: [
      { name: 'model.skel', data: skel().toString('base64') }, { name: 'model.atlas', data: Buffer.from(atlas(['page.png'])).toString('base64') }, { name: 'page.png', data: png().toString('base64') },
    ] });
  }
  const raw = JSON.parse(fs.readFileSync(path.join(m.dir, 'plugin.json'))), skins = raw.assets.chars.char_102_texas.skins;
  assert.equal(new Set(Object.values(skins).flatMap(s => [s.spine.front.skel, s.spine.back.skel])).size, 4);
  assert.equal(packPlugin(m.dir).wrote, true, 'Spine clip metadata comes from pack, as in the game');
  assert.deepEqual(checkPluginFolder(m.dir).problems, []);
  await call('clear', { at: ['chars', 'char_102_texas', 'skins', 'a@b', 'spine', 'back'] });
  assert.equal(m.author.read(m.id).options.outfits[0].spine.back, undefined);
  await call('sections', { sections: [{ template: 'art', target: 'operator:char_102_texas' }] });
  assert.equal(m.author.read(m.id).template, 'skins');
});

test('official effect picker reads only exact local indexed units and skills; missing index is explicit', t => {
  const f = fixture(t), publicDir = path.join(f.dir, 'public');
  const local = path.join(publicDir, 'assets/local/fx'); fs.mkdirSync(local, { recursive: true });
  const files = createPluginFiles(path.join(f.dir, 'plugins'));
  const author = createAuthoring({ files, dataDir: path.resolve('data'), publicDir });
  assert.deepEqual(author.details('fx', '').units, []);
  fs.writeFileSync(path.join(local, 'index.json'), JSON.stringify({ format: 'fx-index', version: 3, units: { char_102_texas: { kind: 'char', skills: { skchr_texas_2: {} } }, token_test: { kind: 'token', skills: {} } } }));
  assert.deepEqual(author.details('fx', '').units.map(u => u.key), ['char_102_texas']);
  const options = { source: 'official', unit: 'char_102_texas', skills: { 0: 'skchr_texas_2' } };
  const made = createPlugin(templateById('fx'), { id: 'borrow-fx', publicDir, options });
  assert.deepEqual(JSON.parse(made.files['data/operator.json']).fx, { unit: options.unit, skills: options.skills });
  for (const bad of [{ ...options, unit: 'char_102_texas_suffix' }, { ...options, skills: { 0: 'missing' } }]) {
    assert.throws(() => createPlugin(templateById('fx'), { id: 'borrow-fx', publicDir, options: bad }), { code: 'PLUGIN_RECORD_TYPE' });
  }
});

test('fx trial plays a real battle from the unsaved form and returns current flipbooks for both board renderers', { timeout: 30000 }, async t => {
  const f = fixture(t), m = make(f, 'fx');
  const bench = createTrialBench({ registry: f.registry, files: m.files }); t.after(() => bench.close());
  const draft = { ...m.author.read(m.id), id: m.id, options: { ...presentationOptions('fx'), flipbooks: [{ ...emptyBook(), fps: 20 }] } };
  const before = m.author.read(m.id).revision;
  const trial = await bench.run({ id: m.id, draft, seconds: 2, scenario: 'dummy' });
  assert.equal(trial.ok, true, JSON.stringify(trial)); assert.ok(trial.plugin.frames.length); assert.deepEqual(trial.plugin.errors, []);
  assert.equal(trial.plugin.fxAssets[m.id].config.flipbooks.flash.fps, 20);
  assert.match(trial.plugin.fxAssets[m.id].images['fx/flash.png'].url, /^\/studio\/api\/plugins\//);
  assert.equal(m.author.read(m.id).revision, before, 'trial leaves the saved plugin unchanged');
  assert.equal(flipbookFrame({ ...emptyBook(), frames: 4, cols: 2 }, 0.1).frame, 1);
});
