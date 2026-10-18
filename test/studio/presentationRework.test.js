// Second-review regressions: synthetic media only; HTTP is exercised without listening sockets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { fixture } from '../helpers/contentFixtures.js';
import { png } from '../helpers/pluginFixtures.js';
import { createPlugin, templateById, manifestText } from '../../server/studio/templates/index.js';
import { createPluginFiles } from '../../server/studio/files.js';
import { createAuthoring } from '../../server/studio/authoring.js';
import { createStudio } from '../../server/studio/index.js';
import { editMediaDraft } from '../../server/studio/mediaDraft.js';
import { createCandidate } from '../../server/studio/candidate.js';
import { writeTrialDraftFile } from '../../server/studio/trialDraft.js';
import { checkCandidate } from '../../server/studio/check.js';
import { validatePng } from '../../server/studio/mediaValidation.js';
import { emptyBook, presentationOptions } from '../../public/studio/js/presentation.js';
import { options as preact } from '../../public/vendor/preact.module.js';
import { FxEditor } from '../../public/studio/js/editors/fx.js';
import { Authoring } from '../../public/studio/js/authoring.js';
import { Upload } from '../../public/studio/js/editors/presentationControls.js';

function setup(t, template = 'skins') {
  const f = fixture(t), id = `rework-${template}`, made = createPlugin(templateById(template), { id });
  const dir = f.put(id, { permissions: [], ...made.manifest }), files = createPluginFiles(path.join(f.dir, 'plugins'));
  for (const [rel, bytes] of Object.entries(made.files)) files.write(id, rel, Buffer.from(bytes), { generated: true });
  files.writeSidecar(id, '.studio.json', Buffer.from(manifestText({ authoring: made.authoring })));
  const author = createAuthoring({ files, dataDir: path.resolve('data') });
  const raw = () => JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json')));
  const write = manifest => files.write(id, 'plugin.json', Buffer.from(manifestText(manifest)));
  const studio = createStudio({ registry: f.registry, pluginsDir: files.base, dataDir: path.resolve('data'), publicDir: path.resolve('public'), watch: () => ({ on() {}, close() {} }) });
  t.after(() => studio.close());
  const api = async (sub, body, method = 'POST') => {
    const req = Readable.from([Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { method, complete: true, headers: { host: 'localhost:3000', 'x-sp-studio': studio.key }, socket: { remoteAddress: '127.0.0.1' } });
    const res = new EventEmitter(); let status, result;
    Object.assign(res, { setHeader() {}, writeHead(code) { status = code; }, end(bytes) { this.writableEnded = true; result = JSON.parse(bytes); }, destroy() {} });
    await studio.handle(req, res, sub === 'trial' ? '/studio/api/trial' : `/studio/api/plugins/${id}/${sub}`, '');
    return { status, result };
  };
  return { ...f, id, dir, files, author, raw, write, api };
}
const noCandidates = m => assert.deepEqual(fs.readdirSync(m.files.base).filter(n => n.startsWith('.sp-studio-')), []);
const at = ['chars', 'char_102_texas', 'skins', 'outfit-1', 'avatar'];
function chunk(type, bytes) {
  const out = Buffer.alloc(bytes.length + 12); out.writeUInt32BE(bytes.length); out.write(type, 4); bytes.copy(out, 8);
  let crc = 0xffffffff;
  for (const byte of out.subarray(4, -4)) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; }
  out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, out.length - 4); return out;
}
function encoded({ color = 6, depth = 8, interlace = 0, width = 9, height = 9, corrupt = false, filter = 0, palette = true } = {}) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = depth; header[9] = color; header[12] = interlace;
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color];
  const rows = [];
  const passes = interlace ? [[0,0,8,8], [4,0,8,8], [0,4,4,8], [2,0,4,4], [0,2,2,4], [1,0,2,2], [0,1,1,2]] : [[0,0,1,1]];
  for (const [x,y,dx,dy] of passes) {
    const w = Math.max(0, Math.ceil((width-x)/dx)), h = Math.max(0, Math.ceil((height-y)/dy));
    if (!w || !h) continue;
    for (let i = 0; i < h; i++) { const row = Buffer.alloc(1 + Math.ceil(w * channels * depth / 8)); row[0] = filter; rows.push(row); }
  }
  return Buffer.concat([png().subarray(0,8), chunk('IHDR', header), ...(color === 3 && palette ? [chunk('PLTE', Buffer.from([0,0,0]))] : []), chunk('IDAT', corrupt ? Buffer.from('broken') : deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

for (const [color, depths] of Object.entries({ 0: [1,2,4,8,16], 2: [8,16], 3: [1,2,4,8], 4: [8,16], 6: [8,16] })) {
  for (const depth of depths) for (const interlace of [0,1]) test(`PNG decode: type ${color}, depth ${depth}, interlace ${interlace}`, () => {
    validatePng(encoded({ color: Number(color), depth, interlace }), 'art.PNG');
    assert.throws(() => validatePng(encoded({ color: Number(color), depth, interlace, corrupt: true }), 'art.PNG'));
    assert.throws(() => validatePng(encoded({ color: Number(color), depth, interlace, filter: 5 }), 'art.PNG'));
  });
}

test('PNG palette, CRC, end, exact decoded size and raw cap are enforced', () => {
  assert.throws(() => validatePng(encoded({ color: 3, palette: false }), 'p.png'));
  const bad = png(); bad[bad.length - 1] ^= 1; assert.throws(() => validatePng(bad, 'p.png'));
  assert.throws(() => validatePng(Buffer.concat([png(), Buffer.from('extra')]), 'p.png'));
  const huge = Buffer.alloc(13); huge.writeUInt32BE(100000); huge.writeUInt32BE(100000, 4); huge[8] = 16; huge[9] = 6;
  assert.throws(() => validatePng(Buffer.concat([png().subarray(0,8), chunk('IHDR', huge), chunk('IDAT', deflateSync(Buffer.alloc(1))), chunk('IEND', Buffer.alloc(0))]), 'p.png'), /PLUGIN_PART_SHAPE/);
  const short = Buffer.from(encoded()); short.writeUInt32BE(10, 16);
  const head = chunk('IHDR', short.subarray(16,29)); head.copy(short, 8);
  assert.throws(() => validatePng(short, 'p.png'));
});

test('P1: 5000 files link once, no unchanged media reads/writes, checker yields, candidate is invisible and cleaned', async t => {
  const m = setup(t), bytes = png(); fs.mkdirSync(path.join(m.dir, 'padding'));
  fs.writeFileSync(path.join(m.dir, 'tiny.png'), bytes);
  const paddingCount = 5000 - m.files.list(m.id).length;
  for (let i = 0; i < paddingCount; i++) fs.writeFileSync(path.join(m.dir, 'padding', `${i}.txt`), 'padding');
  const original = fs.readFileSync, originalWrite = fs.writeFileSync; let writes = 0, yielded = false;
  fs.readFileSync = (file, ...args) => { assert.ok(!String(file).includes('/padding/'), 'unchanged bytes must stay on disk'); return original(file, ...args); };
  fs.writeFileSync = (...args) => { writes++; return originalWrite(...args); };
  t.after(() => { fs.readFileSync = original; fs.writeFileSync = originalWrite; });
  setImmediate(() => { yielded = true; });
  await editMediaDraft(m.files, m.id, staged => {
    assert.equal(fs.statSync(staged.stat(m.id, 'padding/0.txt').abs).ino, fs.statSync(path.join(m.dir, 'padding/0.txt')).ino);
    assert.deepEqual(m.files.ids(), [m.id]);
    staged.write(m.id, 'tiny.png', bytes);
  }, { dataDir: path.resolve('data') });
  assert.equal(yielded, true); assert.ok(writes <= 3, `${writes} writes`); noCandidates(m);
});

test('P2: uploads repair missing images incrementally; form saves still refuse the incomplete folder', async t => {
  const m = setup(t), raw = m.raw(); raw.assets.chars.char_102_texas.skins['outfit-1'].avatar = 'a.png'; raw.assets.chars.char_102_texas.skins['outfit-1'].portrait = 'b.png'; m.write(raw);
  assert.equal((await m.api('files/a.png', png(), 'PUT')).status, 200);
  const draft = m.author.read(m.id); draft.options.outfits[0].name = 'Changed';
  assert.equal((await m.api('authoring', draft)).status, 400);
  assert.equal((await m.api('files/b.png', png(), 'PUT')).status, 200);
  assert.equal((await m.api('authoring', m.author.read(m.id))).status, 200); noCandidates(m);
});

test('P2: untouched 65 MiB file stays editable by upload and form save', async t => {
  const m = setup(t); fs.writeFileSync(path.join(m.dir, 'big.ogg'), ''); fs.truncateSync(path.join(m.dir, 'big.ogg'), 65 * 1024 * 1024);
  const old = fs.statSync(path.join(m.dir, 'big.ogg'));
  assert.equal((await m.api('files/tiny.png', png(), 'PUT')).status, 200);
  const draft = m.author.read(m.id); draft.options.outfits[0].name = 'Changed';
  assert.equal((await m.api('authoring', draft)).status, 200);
  assert.equal(fs.statSync(path.join(m.dir, 'big.ogg')).ino, old.ino); noCandidates(m);
});

test('P2: corrupt ordinary art and uppercase PNGs never replace working art', async t => {
  const m = setup(t), good = png();
  assert.equal((await m.api('slot', { at, files: [{ name: 'good.PNG', data: good.toString('base64') }] })).status, 200);
  const rel = m.raw().assets.chars.char_102_texas.skins['outfit-1'].avatar;
  assert.equal((await m.api('slot', { at, files: [{ name: 'bad.PNG', data: encoded({ corrupt: true }).toString('base64') }] })).status, 400);
  assert.equal((await m.api('files/new.PNG', Buffer.from('not png'), 'PUT')).status, 400);
  assert.deepEqual(fs.readFileSync(m.files.stat(m.id, rel).abs), good); noCandidates(m);
});

test('P2: external overlay effect sheets enforce decoding and FX subset, ordinary 16-bit/Adam7 art remains allowed', async t => {
  const m = setup(t, 'fx'), raw = m.raw();
  fs.writeFileSync(path.join(m.dir, 'overlay.json'), JSON.stringify(raw.assets)); raw.assets = 'overlay.json'; m.write(raw);
  for (const bytes of [encoded({ corrupt: true }), encoded({ depth: 16 }), encoded({ interlace: 1 }), png(2049,1)])
    assert.equal((await m.api('files/fx/flash.png', bytes, 'PUT')).status, 400);
  assert.equal((await m.api('files/art.PNG', encoded({ depth: 16, interlace: 1 }), 'PUT')).status, 200); noCandidates(m);
});

test('candidates refuse hidden links before staging, use clone fallback, and clean failed edits/timeouts', async t => {
  const m = setup(t); fs.symlinkSync(m.dir, path.join(m.dir, '.hidden'));
  await assert.rejects(editMediaDraft(m.files, m.id, () => assert.fail('must not stage'), { dataDir: path.resolve('data') }), { code: 'PLUGIN_STUDIO_PATH' });
  noCandidates(m); fs.unlinkSync(path.join(m.dir, '.hidden'));
  const link = fs.linkSync, copy = fs.copyFileSync; let cloned = 0;
  fs.linkSync = () => { throw Object.assign(new Error('cross-device'), { code: 'EXDEV' }); };
  fs.copyFileSync = (from, to, flags) => { assert.equal(flags, fs.constants.COPYFILE_FICLONE); cloned++; return copy(from, to, flags); };
  try { const c = createCandidate(m.files, m.id); c.cleanup(); } finally { fs.linkSync = link; fs.copyFileSync = copy; }
  assert.ok(cloned); noCandidates(m);
  await assert.rejects(editMediaDraft(m.files, m.id, () => { throw new Error('edit failure'); }, { dataDir: path.resolve('data') })); noCandidates(m);
  await assert.rejects(checkCandidate({ dir: m.dir }, { timeoutMs: 1 }), { code: 'PLUGIN_STUDIO_TRIAL_TIMEOUT' });
});

const walk = v => Array.isArray(v) ? v.flatMap(walk) : v && typeof v === 'object' ? [v, ...walk(v.props?.children)] : [];
function renderer(Component) {
  const instance = { __h: [], context: {}, setState() {} };
  return props => { instance.props = props; const node = { __c: instance }; preact.__r(node); try { return Component(props); } finally { preact.__b(node); } };
}
test('P2: completed FX reads merge newest edits/uploads and save stays disabled until all reads finish', async () => {
  const original = globalThis.FileReader, pending = [];
  globalThis.FileReader = class { readAsDataURL() { pending.push(() => { this.result = `data:image/png;base64,${png().toString('base64')}`; this.onload(); }); } };
  try {
    let draft = { id: 'race', template: 'fx', options: presentationOptions('fx', { flipbooks: [emptyBook('one'), emptyBook('two')] }) };
    const state = { id: 'race', files: [], authoring: draft }, render = renderer(Authoring), renderFx = renderer(FxEditor);
    const props = { state, initialDraft: draft, onDraft: next => { draft = next; } };
    const tree = render(props), editor = walk(tree).find(n => n.type === FxEditor);
    const uploads = walk(renderFx(editor.props)).filter(n => n.type === Upload);
    const first = uploads[0].props.onFiles([{}]), second = uploads[1].props.onFiles([{}]);
    let current = render(props);
    assert.equal(walk(current).find(n => n.props?.['data-testid'] === 'save-wizard').props.disabled, true);
    walk(current).find(n => n.type === FxEditor).props.onChange(latest => ({ ...latest, options: { ...latest.options, flipbooks: latest.options.flipbooks.map((b,i) => i ? b : { ...b, fps: 24 }) } }));
    pending.shift()(); await first; current = render(props);
    assert.equal(walk(current).find(n => n.props?.['data-testid'] === 'save-wizard').props.disabled, true);
    pending.shift()(); await second; current = render(props);
    assert.deepEqual(draft.uploads.map(u => u.path), ['fx/one.png', 'fx/two.png']); assert.equal(draft.options.flipbooks[0].fps, 24);
    assert.equal(walk(current).find(n => n.props?.['data-testid'] === 'save-wizard').props.disabled, false);
  } finally { globalThis.FileReader = original; }
});

test('P2: trial accepts authoring-size requests and embeds new staged sheet bytes after cleanup', async t => {
  const m = setup(t, 'fx'); m.registry.rescan(); const draft = m.author.read(m.id);
  draft.options.flipbooks.push({ ...emptyBook('new'), frames: 4, cols: 2 });
  draft.options.bindings = [{ slot: '1', phase: 'attack', effect: 'new' }];
  const small = png(8,8), bytes = Buffer.concat([small.subarray(0,33), chunk('tEXt', Buffer.concat([Buffer.from('key\0'), Buffer.alloc(210000,97)])), small.subarray(33)]);
  draft.uploads = [{ path: 'fx/new.png', data: bytes.toString('base64') }];
  const response = await m.api('trial', { id: m.id, draft, seconds: 2, scenario: 'dummy' });
  assert.equal(response.status, 200, JSON.stringify(response)); assert.equal(response.result.ok, true, JSON.stringify(response.result.issues));
  const url = response.result.plugin.fxAssets[m.id].images['fx/new.png'].url;
  assert.match(url, /^data:image\/png;base64,/); assert.deepEqual(Buffer.from(url.split(',')[1], 'base64'), bytes);
  assert.equal(fs.existsSync(path.join(m.dir, 'fx/new.png')), false); noCandidates(m);
});

test('no-new-problems compares locations as well as codes and aggregate caps still refuse uploads', async t => {
  const m = setup(t), raw = m.raw(); raw.assets.chars.char_102_texas.skins['outfit-1'].avatar = 'a.png'; m.write(raw);
  const before = fs.readFileSync(path.join(m.dir, 'plugin.json'));
  raw.assets.chars.char_102_texas.skins['outfit-1'].portrait = 'b.png';
  assert.equal((await m.api('files/plugin.json', Buffer.from(JSON.stringify(raw)), 'PUT')).status, 400);
  assert.deepEqual(fs.readFileSync(path.join(m.dir, 'plugin.json')), before);
  fs.writeFileSync(path.join(m.dir, 'big.ogg'), ''); fs.truncateSync(path.join(m.dir, 'big.ogg'), 200 * 1024 * 1024);
  const response = await m.api('files/a.png', png(), 'PUT');
  assert.equal(response.status, 413, JSON.stringify(response)); assert.equal(fs.existsSync(path.join(m.dir, 'a.png')), false); noCandidates(m);
});

test('checker startup failure releases its slot without waiting for an exit that never happens', async () => {
  const spawn = () => {
    const child = new EventEmitter(); child.send = () => queueMicrotask(() => child.emit('error', new Error('spawn failed'))); return child;
  };
  for (let i = 0; i < 3; i++) await assert.rejects(checkCandidate({}, { spawn }), { code: 'PLUGIN_STUDIO_TRIAL_FAILED' });
});


test('trial document writes replace links without touching a similarly named existing file', t => {
  const m = setup(t); fs.writeFileSync(path.join(m.dir, 'draft.json'), 'original');
  fs.writeFileSync(path.join(m.dir, 'draft.json.studio-tmp'), 'keep');
  const candidate = createCandidate(m.files, m.id);
  try {
    writeTrialDraftFile(candidate.dir, 'draft.json', 'changed');
    assert.equal(fs.readFileSync(path.join(m.dir, 'draft.json'), 'utf8'), 'original');
    assert.equal(fs.readFileSync(path.join(m.dir, 'draft.json.studio-tmp'), 'utf8'), 'keep');
    assert.equal(fs.readFileSync(path.join(candidate.dir, 'draft.json.studio-tmp'), 'utf8'), 'keep');
  } finally { candidate.cleanup(); }
});
