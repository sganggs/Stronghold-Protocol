// Review regressions use generated fixtures and in-memory HTTP requests; no downloaded packs or sockets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { fixture } from '../helpers/contentFixtures.js';
import { png, pngOf, skel, atlas } from '../helpers/pluginFixtures.js';
import { createPlugin, templateById, manifestText } from '../../server/studio/templates/index.js';
import { createPluginFiles } from '../../server/studio/files.js';
import { createAuthoring } from '../../server/studio/authoring.js';
import { createStudio } from '../../server/studio/index.js';
import { checkPluginFolder } from '../../server/plugins/pack.js';
import { createTrialBench } from '../../server/studio/trial.js';
import { buildContentSet } from '../../server/plugins/contentSet.js';
import { readStudioData, officialOperator } from '../../server/studio/gameData.js';
import { PluginFxPlayer } from '../../public/js/render/vfx/pluginPlayer.js';
import { emptyBook } from '../../public/studio/js/presentation.js';
import { validateDraft } from '../../public/studio/js/validateDraft.js';
import { options as preact } from '../../public/vendor/preact.module.js';
import { FxEditor } from '../../public/studio/js/editors/fx.js';
import { Upload } from '../../public/studio/js/editors/presentationControls.js';

function setup(t, template, options = {}) {
  const f = fixture(t), id = `review-${template}`;
  const made = createPlugin(templateById(template), { id, options });
  const dir = f.put(id, { permissions: [], ...made.manifest });
  const files = createPluginFiles(path.join(f.dir, 'plugins'));
  for (const [rel, bytes] of Object.entries(made.files)) files.write(id, rel, Buffer.from(bytes), { generated: true });
  files.writeSidecar(id, '.studio.json', Buffer.from(manifestText({ authoring: made.authoring })));
  const author = createAuthoring({ files, dataDir: path.resolve('data') });
  const raw = () => JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json')));
  const write = manifest => files.write(id, 'plugin.json', Buffer.from(manifestText(manifest)));
  return { ...f, id, dir, files, author, raw, write };
}
function api(t, m) {
  const studio = createStudio({ registry: m.registry, pluginsDir: m.files.base, dataDir: path.resolve('data'), publicDir: path.resolve('public'), watch: () => ({ on() {}, close() {} }) });
  t.after(() => studio.close());
  return async (sub, body, method = 'POST') => {
    const req = Readable.from([Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { method, complete: true, headers: { host: 'localhost:3000', 'x-sp-studio': studio.key }, socket: { remoteAddress: '127.0.0.1' } });
    const res = new EventEmitter(); let status, result;
    Object.assign(res, { setHeader() {}, writeHead(code) { status = code; }, end(bytes) { this.writableEnded = true; result = JSON.parse(bytes); }, destroy() {} });
    await studio.handle(req, res, `/studio/api/plugins/${m.id}/${sub}`, '');
    return { status, result };
  };
}
const media = (name, bytes) => ({ name, data: bytes.toString('base64') });
const slot = (key, field = 'avatar') => ['chars', 'char_102_texas', 'skins', key, ...(field === 'avatar' ? [field] : ['spine', field])];
function clean(m) {
  const result = checkPluginFolder(m.dir);
  assert.deepEqual([...result.problems, ...result.warnings], []);
}

test('review P1: editing FX preserves hand-edited record bytes, other declarations and hidden FX settings', t => {
  const m = setup(t, 'fx'), raw = m.raw();
  const record = JSON.parse(fs.readFileSync(m.files.stat(m.id, 'data/operator.json').abs));
  record.forms.normal.stats.atk = 1234;
  const text = manifestText(record).replace('1234', '1.234e3');
  m.files.write(m.id, 'data/operator.json', Buffer.from(text));
  m.files.write(m.id, 'data/extra.json', Buffer.from(manifestText({ ...record, charId: 'char_x_review_fx_extra' })));
  raw.operators.push('data/extra.json'); raw.assets.fx.silentPhases = ['custom']; m.write(raw); clean(m);
  const draft = m.author.read(m.id); draft.options.flipbooks[0].fps = 25;
  m.author.save(m.id, draft);
  assert.equal(fs.readFileSync(m.files.stat(m.id, 'data/operator.json').abs, 'utf8'), text);
  assert.deepEqual(m.raw().operators, raw.operators); assert.deepEqual(m.raw().assets.fx.silentPhases, ['custom']); clean(m);
});

for (const template of ['theme', 'notices', 'fx']) test(`review P1: ${template} reopens actual declarations and applies only form changes`, t => {
  const m = setup(t, template), raw = m.raw();
  if (template === 'theme') raw.theme.vars = { '--gold': '#123456', '--bg-0': '#445566' };
  if (template === 'notices') raw.notices[0].body = 'Hand-edited announcement';
  if (template === 'fx') { raw.assets.fx.flipbooks.flash.fps = 29; raw.assets.fx.bind.char_x_review_fx_one = { 1: { hit: 'flash' } }; }
  m.write(raw);
  const draft = m.author.read(m.id);
  if (template === 'theme') { assert.equal(draft.options.vars['--gold'], '#123456'); delete draft.options.vars['--gold']; }
  if (template === 'notices') { assert.equal(draft.options.notices[0].body, 'Hand-edited announcement'); draft.options.notices[0].title = 'Edited title'; }
  if (template === 'fx') { assert.equal(draft.options.flipbooks[0].fps, 29); assert.deepEqual(draft.options.bindings, [{ slot: '1', phase: 'hit', effect: 'flash' }]); draft.options.flipbooks[0].fps = 30; }
  m.author.save(m.id, draft); clean(m);
  if (template === 'theme') { assert.equal(m.raw().theme.vars['--gold'], undefined); assert.equal(m.raw().theme.vars['--bg-0'], '#445566'); }
  if (template === 'notices') assert.equal(m.raw().notices[0].body, 'Hand-edited announcement');
  if (template === 'fx') assert.equal(m.raw().assets.fx.flipbooks.flash.fps, 30);
});

test('review P1: FX hydrates current kit and official FX record, keeping other record fields byte-identical', t => {
  const m = setup(t, 'fx'), file = m.files.stat(m.id, 'data/operator.json').abs;
  const record = JSON.parse(fs.readFileSync(file)); record.kit.ref = 'char_377_gdglow';
  // A synthetic local effects index suffices for authoring; no official files are needed.
  const publicDir = path.join(m.dir, 'public'); fs.mkdirSync(path.join(publicDir, 'assets/local/fx'), { recursive: true });
  fs.writeFileSync(path.join(publicDir, 'assets/local/fx/index.json'), JSON.stringify({ format: 'fx-index', version: 3, units: { char_377_gdglow: { kind: 'char', skills: { skill_demo: {} } } } }));
  record.fx = { unit: 'char_377_gdglow', skills: { 1: 'skill_demo' } }; fs.writeFileSync(file, manifestText(record));
  const author = createAuthoring({ files: m.files, dataDir: path.resolve('data'), publicDir });
  const draft = author.read(m.id);
  assert.equal(draft.options.kitRef, 'char_377_gdglow'); assert.equal(draft.options.source, 'official');
  assert.equal(draft.options.unit, 'char_377_gdglow'); assert.deepEqual(draft.options.skills, record.fx.skills);
});

for (const kind of ['missing', 'grid', 'retained', 'empty']) test(`review P1: whole-folder validation refuses ${kind} before any write`, async t => {
  const m = setup(t, kind === 'retained' ? 'theme' : kind === 'empty' ? 'notices' : 'fx');
  if (kind === 'retained') { const raw = m.raw(); raw.permissions.push('assets.override'); raw.assets = { items: { icon: 'missing.png' } }; m.write(raw); }
  const draft = { ...m.author.read(m.id), id: m.id };
  if (kind === 'missing') draft.options.flipbooks.push(emptyBook('new'));
  if (kind === 'grid') draft.options.flipbooks[0].frames = 3;
  if (kind === 'empty') draft.options.notices = [];
  const before = draft.revision;
  const validation = m.author.validateDraft(draft);
  assert.equal(validation.ok, false); assert.ok(validation.problems[0].message);
  assert.throws(() => m.author.save(m.id, draft)); assert.equal(m.author.read(m.id).revision, before);
  const local = await validateDraft(draft, { post: async (route, body) => { assert.equal(route, 'validate-dsl'); return m.author.validateDraft(body.draft); } });
  assert.equal(local.ok, false, 'the form uses the complete folder checker');
});

test('review P1: new flipbook and PNG save in one validated request; invalid upload leaves every byte alone', async t => {
  const m = setup(t, 'fx'), call = api(t, m), draft = m.author.read(m.id);
  draft.options.flipbooks.push({ ...emptyBook('new'), frames: 4, cols: 2 });
  draft.uploads = [{ path: 'fx/new.png', data: png(8, 8).toString('base64') }];
  const result = await call('authoring', draft);
  assert.equal(result.status, 200, JSON.stringify(result)); clean(m);
  assert.ok(fs.readFileSync(m.files.stat(m.id, 'fx/new.png').abs).equals(png(8, 8)));
  const next = m.author.read(m.id), before = next.revision;
  next.options.flipbooks.find(b => b.id === 'new').cols = 3;
  next.uploads = [{ path: 'fx/new.png', data: png(7, 7).toString('base64') }];
  assert.equal((await call('authoring', next)).status, 400); assert.equal(m.author.read(m.id).revision, before);
  next.uploads[0].path = '../escape.png'; assert.equal((await call('authoring', next)).status, 400);
});

test('review P1: FX upload input stays enabled for an unsaved new book and stages bytes in the draft', async t => {
  const m = setup(t, 'fx'); let draft = m.author.read(m.id); draft.options.flipbooks.push(emptyBook('new'));
  const props = { draft, state: { id: m.id, files: [], authoring: draft }, dirty: true, busy: false, onChange: next => { draft = typeof next === 'function' ? next(draft) : next; } };
  const node = { __c: { __h: [], props, context: {}, setState() {} } }; preact.__r(node);
  let tree; try { tree = FxEditor(props); } finally { preact.__b(node); }
  const walk = v => Array.isArray(v) ? v.flatMap(walk) : v && typeof v === 'object' ? [v, ...walk(v.props?.children)] : [];
  const upload = walk(tree).filter(n => n.type === Upload).at(-1);
  assert.equal(upload.props.disabled, false);
  // fileBase64 uses FileReader in browsers; this small stub only provides a generated image's data URL.
  const original = globalThis.FileReader;
  globalThis.FileReader = class { readAsDataURL() { this.result = `data:image/png;base64,${png().toString('base64')}`; this.onload(); } };
  try { await upload.props.onFiles([{ name: 'new.png' }]); } finally { globalThis.FileReader = original; }
  assert.equal(draft.uploads[0].path, 'fx/new.png'); assert.equal(draft.uploads[0].data, png().toString('base64'));
});

for (const field of ['avatar', 'front']) test(`review P1: skin rename/reused key isolates ${field} uploads`, async t => {
  const m = setup(t, 'skins'), call = api(t, m);
  const model = bytes => [media('model.skel', skel()), media('model.atlas', Buffer.from(atlas(['page.png']))), media('page.png', bytes)];
  const old = png(4, 4, [255, 0, 0, 255]), replacement = png(4, 4, [0, 0, 255, 255]);
  assert.equal((await call('slot', { at: slot('outfit-1', field), files: field === 'avatar' ? [media('old.png', old)] : model(old) })).status, 200);
  const draft = m.author.read(m.id); draft.options.outfits[0].key = 'renamed'; draft.options.outfits.push({ key: 'outfit-1', name: 'New' }); m.author.save(m.id, draft);
  const renamed = m.raw().assets.chars.char_102_texas.skins.renamed;
  const oldPath = field === 'avatar' ? renamed.avatar : renamed.spine.front.textures[0];
  const r = await call('slot', { at: slot('outfit-1', field), files: field === 'avatar' ? [media('new.png', replacement)] : model(replacement) });
  assert.equal(r.status, 200, JSON.stringify(r)); clean(m);
  const newer = m.raw().assets.chars.char_102_texas.skins['outfit-1'];
  assert.notEqual(field === 'avatar' ? newer.avatar : newer.spine.front.textures[0], oldPath);
  assert.ok(fs.readFileSync(m.files.stat(m.id, oldPath).abs).equals(old));
});

test('review P2: raw FX and skin uploads reject bad PNG bytes, dimensions and encoding without replacement', async t => {
  const fx = setup(t, 'fx'), skin = setup(t, 'skins'), fxApi = api(t, fx), skinApi = api(t, skin);
  const forged = png(); forged[24] = 16; // a header edited after its checksum
  const broken = [Buffer.from('not a PNG'), forged, png().subarray(0, 33)];
  // well-formed PNGs outside the FX loader's 8-bit RGB/RGBA ≤ 2048 subset
  const outside = [pngOf(2049, 1), pngOf(4, 4, { depth: 16, color: 6 }), pngOf(4, 4, { depth: 8, color: 3 }), pngOf(4, 4, { depth: 8, color: 0 })];
  for (const bytes of [...broken, ...outside]) {
    const before = fx.author.read(fx.id).revision;
    assert.equal((await fxApi('files/fx/flash.png', bytes, 'PUT')).status, 400, 'an effect sheet keeps the FX loader subset');
    assert.equal(fx.author.read(fx.id).revision, before);
  }
  for (const bytes of broken) {
    const before = skin.author.read(skin.id).revision;
    assert.equal((await skinApi('slot', { at: slot('outfit-1'), files: [media('bad.png', bytes)] })).status, 400);
    assert.equal(skin.author.read(skin.id).revision, before);
  }
  for (const bytes of outside) {
    const r = await skinApi('slot', { at: slot('outfit-1'), files: [media('art.png', bytes)] });
    assert.equal(r.status, 200, `skin art is whatever the browser decodes: ${JSON.stringify(r.result)}`);
  }
});

test('review P2: invalid Spine uploads leave the current skeleton, atlas, PNG and declaration untouched', async t => {
  const m = setup(t, 'skins'), call = api(t, m);
  const files = [media('model.skel', skel()), media('model.atlas', Buffer.from(atlas(['page.png']))), media('page.png', png())];
  assert.equal((await call('slot', { at: slot('outfit-1', 'front'), files })).status, 200);
  const before = m.author.read(m.id).revision;
  for (const bad of [[media('model.skel', Buffer.from('bad skeleton'))], [media('model.atlas', Buffer.from(atlas(['missing.png'])))]] ) {
    assert.equal((await call('slot', { at: slot('outfit-1', 'front'), files: bad })).status, 400);
    assert.equal(m.author.read(m.id).revision, before);
  }
});

test('review P2: summon carriers are explicitly refused; supported carriers preserve source attack metadata', t => {
  const data = readStudioData(path.resolve('data'));
  for (const kitRef of ['char_2023_ling', 'char_250_phatom']) {
    assert.throws(() => createPlugin(templateById('fx'), { id: 'summon-fx', options: { kitRef }, data }), e => e.code === 'PLUGIN_RECORD_TYPE' && /summon/.test(e.params.detail));
  }
  const m = setup(t, 'fx', { kitRef: 'char_377_gdglow' }); m.registry.rescan();
  const built = buildContentSet({ registry: m.registry, ids: [m.id] }); assert.deepEqual(built.problems, []);
  const carrier = Object.values(built.data.chess).find(r => r.charId === 'char_x_review_fx_one' && !r.isGolden), source = officialOperator(data, 'char_377_gdglow').normal;
  for (const key of ['dmgType', 'attackKind', 'projectile', 'canHitFly', 'targetPriority']) assert.deepEqual(carrier[key], source[key]);
});

test('review P2: default replay attacks activate the custom sheet on the equipped skill slot', async t => {
  const m = setup(t, 'fx'); m.registry.rescan();
  const bench = createTrialBench({ registry: m.registry, files: m.files }); t.after(() => bench.close());
  const replay = await bench.run({ id: m.id, seconds: 3, scenario: 'dummy' }); assert.equal(replay.ok, true);
  const info = replay.plugin.field.units[0], record = replay.plugin.renderRecords.chess[info.defId];
  const attacks = replay.plugin.frames.flatMap(f => f.ev).filter(e => e[0] === 'atk'); assert.ok(attacks.length);
  let sprites = 0;
  const P = { BaseTexture: { from: () => ({ valid: true, destroy() {} }) }, Texture: class { destroy() {} },
    Sprite: class { constructor() { sprites++; this.anchor = { set() {} }; this.position = { set() {} }; } destroy() {} }, Rectangle: class {}, BLEND_MODES: { NORMAL: 0, ADD: 1 } };
  const player = new PluginFxPlayer({ P, layer: { addChild() {} }, assets: { manifest: { fx: replay.plugin.fxAssets } }, cam: () => ({ project: (x, y) => ({ x, y, s: 40 }) }), enabled: () => true, record: () => record, speed: () => 1, ofx: { active: false } });
  t.after(() => player.destroy());
  for (const _attack of attacks) player.attack({ info, x: 1, y: 2, alive: true }, { info: { id: 999 }, x: 3, y: 2, alive: true }, 'none');
  assert.ok(sprites > 0, 'real replay attack events activate the default binding');
});

test('cosmetic presentation checks and saves do not need installed gameplay tables', t => {
  for (const template of ['theme', 'notices', 'skins']) {
    const m = setup(t, template);
    if (template === 'skins') {
      const side = JSON.parse(m.files.readSidecar(m.id, '.studio.json')); side.authoring.target = 'operator:char_102_texas';
      m.files.writeSidecar(m.id, '.studio.json', Buffer.from(manifestText(side)));
    }
    const author = createAuthoring({ files: m.files, dataDir: path.join(m.dir, 'absent-data') });
    const draft = author.read(m.id); author.save(m.id, draft); clean(m);
  }
});

test('FX edits preserve additional records within the carrier document and unsupported manifest fields', t => {
  const m = setup(t, 'fx'), file = m.files.stat(m.id, 'data/operator.json').abs;
  const carrier = JSON.parse(fs.readFileSync(file)), extra = { ...carrier, charId: 'char_x_review_fx_extra' };
  fs.writeFileSync(file, manifestText([carrier, extra]));
  const draft = m.author.read(m.id); draft.options.flipbooks[0].fps = 22; m.author.save(m.id, draft);
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), [carrier, extra]); clean(m);
  const raw = m.raw(); raw.assets = 'overlay.json'; m.files.write(m.id, 'overlay.json', Buffer.from(manifestText({}))); m.write(raw);
  assert.throws(() => m.author.save(m.id, m.author.read(m.id)), { status: 409 });
});

test('shared Spine page-only uploads copy the skeleton and atlas before changing either skin', async t => {
  const m = setup(t, 'skins'), call = api(t, m), old = png(), next = png(4, 4, [0, 255, 0, 255]);
  assert.equal((await call('slot', { at: slot('outfit-1', 'front'), files: [media('model.skel', skel()), media('model.atlas', Buffer.from(atlas(['page.png']))), media('page.png', old)] })).status, 200);
  const raw = m.raw(), skins = raw.assets.chars.char_102_texas.skins;
  skins.other = structuredClone(skins['outfit-1']); m.write(raw);
  const oldPath = skins.other.spine.front.textures[0];
  const result = await call('slot', { at: slot('outfit-1', 'front'), files: [media('page.png', next)] });
  assert.equal(result.status, 200, JSON.stringify(result)); clean(m);
  assert.ok(fs.readFileSync(m.files.stat(m.id, oldPath).abs).equals(old));
  const current = m.raw().assets.chars.char_102_texas.skins['outfit-1'].spine.front;
  assert.notEqual(current.skel, skins.other.spine.front.skel);
  assert.ok(fs.readFileSync(m.files.stat(m.id, current.textures[0]).abs).equals(next));
});

test('a failed document write rolls back staged media and leaves the author revision intact', t => {
  const m = setup(t, 'fx'), draft = m.author.read(m.id), original = m.files.write;
  draft.options.flipbooks.push(emptyBook('new')); draft.uploads = [{ path: 'fx/new.png', data: png().toString('base64') }];
  let fail = true;
  m.files.write = (id, rel, ...args) => { if (rel === 'plugin.json' && fail) { fail = false; throw new Error('synthetic write failure'); } return original(id, rel, ...args); };
  assert.throws(() => m.author.save(m.id, draft), /synthetic write failure/);
  assert.equal(m.author.read(m.id).revision, draft.revision);
  assert.equal(fs.existsSync(path.join(m.dir, 'fx/new.png')), false); clean(m);
});

test('an older unsupported summon-carrier draft can switch to a supported source', t => {
  const m = setup(t, 'fx');
  const legacy = createPlugin(templateById('operator'), { id: m.id, options: { kitRef: 'char_2023_ling' } });
  m.files.write(m.id, 'data/operator.json', Buffer.from(legacy.files['data/operator.json']));
  const draft = m.author.read(m.id); assert.equal(draft.options.kitRef, 'char_2023_ling');
  assert.throws(() => m.author.save(m.id, draft), e => /summon/.test(e.params?.detail));
  draft.options.kitRef = 'char_102_texas'; m.author.save(m.id, draft); clean(m);
  assert.equal(m.author.read(m.id).options.kitRef, 'char_102_texas');
});
