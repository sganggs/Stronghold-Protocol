// Third-review regressions: original PNGs and JSON; HTTP handlers run without listening sockets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { fixture } from '../helpers/contentFixtures.js';
import { png } from '../helpers/pluginFixtures.js';
import { createPlugin, templateById, manifestText } from '../../server/studio/templates/index.js';
import { createPluginFiles } from '../../server/studio/files.js';
import { createStudio } from '../../server/studio/index.js';
import { checkGameplayFolder } from '../../server/studio/gameplayCheck.js';
import { validatePng } from '../../server/studio/mediaValidation.js';
import { fxPath } from '../../public/js/render/vfx/pluginFormat.js';

function setup(t, template = 'fx') {
  const f = fixture(t), id = `third-${template}`, made = createPlugin(templateById(template), { id });
  const dir = f.put(id, made.manifest), files = createPluginFiles(path.dirname(dir));
  for (const [rel, bytes] of Object.entries(made.files)) files.write(id, rel, Buffer.from(bytes), { generated: true });
  const raw = () => JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json')));
  const write = value => files.write(id, 'plugin.json', Buffer.from(manifestText(value)));
  const studio = createStudio({ registry: f.registry, pluginsDir: files.base, dataDir: path.resolve('data'), publicDir: path.resolve('public'), watch: () => ({ on() {}, close() {} }) });
  t.after(() => studio.close());
  const api = async (sub, body, method = 'PUT') => {
    const req = Readable.from([Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { method, complete: true, headers: { host: 'localhost:3000', 'x-sp-studio': studio.key }, socket: { remoteAddress: '127.0.0.1' } });
    const res = new EventEmitter(); let status, result;
    Object.assign(res, { setHeader() {}, writeHead(code) { status = code; }, end(bytes) { this.writableEnded = true; result = JSON.parse(bytes); }, destroy() {} });
    await studio.handle(req, res, `/studio/api/plugins/${id}/${sub}`, '');
    return { status, result };
  };
  const check = () => checkGameplayFolder(dir, { dataDir: path.resolve('data'), pluginsDir: files.base, strict: true, updateLock: false });
  return { id, dir, files, raw, write, api, check };
}
function chunk(type, data) {
  const bytes = Buffer.alloc(data.length + 12);
  bytes.writeUInt32BE(data.length); Buffer.from(type).copy(bytes, 4); data.copy(bytes, 8);
  let crc = 0xffffffff;
  for (const byte of bytes.subarray(4, -4)) { crc ^= byte; for (let i = 0; i < 8; i++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; }
  bytes.writeUInt32BE((crc ^ 0xffffffff) >>> 0, bytes.length - 4);
  return bytes;
}
function badChunk(type, index) {
  const good = png(), pieces = [good.subarray(0, 8)];
  for (let off = 8; off < good.length;) { // loop-cap: advances off by at least 12 bytes
    const size = good.readUInt32BE(off), name = good.subarray(off + 4, off + 8);
    if (name.equals(Buffer.from(type))) { const bad = Buffer.from(name); bad[index] |= 128; pieces.push(chunk(bad, good.subarray(off + 8, off + 8 + size))); }
    else pieces.push(good.subarray(off, off + 12 + size));
    off += size + 12;
  }
  if (['PLTE', 'tEXt'].includes(type)) {
    const name = Buffer.from(type); name[index] |= 128;
    pieces.splice(2, 0, chunk(name, type === 'PLTE' ? Buffer.from([0,0,0]) : Buffer.from('key\0value')));
  }
  return Buffer.concat(pieces);
}
for (const type of ['IHDR', 'PLTE', 'IDAT', 'IEND', 'tEXt']) test(`PNG rejects CRC-correct high-bit bytes in every ${type} type position`, () => {
  for (let i = 0; i < 4; i++) assert.throws(() => validatePng(badChunk(type, i), 'art.png'), { code: 'PLUGIN_PART_SHAPE' });
});

test('malformed chunk uploads retain working skin art and PUT files', async t => {
  const m = setup(t, 'skins'), at = ['chars', 'char_102_texas', 'skins', 'outfit-1', 'avatar'], good = png();
  assert.equal((await m.api('slot', { at, files: [{ name: 'good.png', data: good.toString('base64') }] }, 'POST')).status, 200);
  const before = fs.readFileSync(path.join(m.dir, 'plugin.json')), rel = m.raw().assets.chars.char_102_texas.skins['outfit-1'].avatar;
  assert.equal((await m.api('slot', { at, files: [{ name: 'bad.png', data: badChunk('IHDR', 0).toString('base64') }] }, 'POST')).status, 400);
  assert.equal((await m.api(`files/${rel}`, badChunk('IDAT', 1))).status, 400);
  assert.deepEqual(fs.readFileSync(path.join(m.dir, 'plugin.json')), before);
  assert.deepEqual(fs.readFileSync(path.join(m.dir, rel)), good);
});

function patchFolder(m, value = null) {
  const manifest = m.raw(); manifest.assets.fx.flipbooks.flash.image = 'fx/missing.png';
  manifest.data = ['data/patch.json']; manifest.permissions.push('data.patch'); m.write(manifest);
  const table = JSON.parse(fs.readFileSync(new URL('../../data/chess.json', import.meta.url)));
  const id = Object.values(table).find(r => r.charId === 'char_102_texas' && !r.isGolden).chessId;
  const slot = table[id].skills.findIndex(s => s.index === table[id].skill.index);
  const patch = { patch: 1, ops: [['skill', 'spCost'], ['skills', slot, 'spCost']].map(at => ({ op: 'set', file: 'chess', id, path: at, value: value ?? table[id].skill.spCost })) };
  m.files.write(m.id, 'data/patch.json', Buffer.from(manifestText(patch)), { generated: true });
  return patch;
}
test('missing art cannot hide an independently invalid gameplay upload', async t => {
  const m = setup(t), patch = patchFolder(m), before = fs.readFileSync(path.join(m.dir, 'data/patch.json'));
  assert.ok(m.check().problems.some(p => p.code === 'PLUGIN_FILE_MISSING'));
  for (const op of patch.ops) op.value = 999999999;
  const response = await m.api('files/data/patch.json', Buffer.from(manifestText(patch)));
  assert.equal(response.status, 400); assert.equal(response.result.error, 'PLUGIN_DATA_BOUND');
  assert.deepEqual(fs.readFileSync(path.join(m.dir, 'data/patch.json')), before);
  assert.equal((await m.api('files/fx/missing.png', png())).status, 200);
  const repaired = m.check(); assert.equal(repaired.ok, true, JSON.stringify(repaired.problems));
});
test('folder reports asset and gameplay findings together without crashing on broken documents', async t => {
  const m = setup(t); patchFolder(m, 999999999);
  const findings = m.check().problems;
  assert.ok(findings.some(p => p.code === 'PLUGIN_FILE_MISSING'));
  assert.ok(findings.some(p => p.code === 'PLUGIN_DATA_BOUND'));
  const manifest = m.raw(); manifest.assets.fx.flipbooks.flash.cols = 3; m.write(manifest);
  assert.ok(m.check().problems.some(p => p.code === 'PLUGIN_DATA_BOUND'), 'invalid FX grammar also leaves content validation independent');
  for (const text of ['null', '{', '{"patch":1,"ops":null}']) {
    m.files.write(m.id, 'data/patch.json', Buffer.from(text));
    const checked = m.check(); assert.equal(checked.ok, false);
    assert.ok(checked.problems.some(p => /PLUGIN_(CONTENT|JSON)/.test(p.code)), JSON.stringify(checked));
    assert.equal((await m.api('files/note.txt', Buffer.from('same broken document'))).status, 200);
  }
});
test('one FX defect cannot excuse a different reason at the same code and location', async t => {
  const m = setup(t), manifest = m.raw(); manifest.assets.fx.flipbooks.flash.cols = 3; m.write(manifest);
  const before = fs.readFileSync(path.join(m.dir, 'plugin.json'));
  manifest.assets.fx.flipbooks.flash.cols = 1;
  manifest.assets.fx.bind[`char_x_${m.id.replace(/-/g, '_')}_one`]['1'].attack = 'does-not-exist';
  const response = await m.api('files/plugin.json', Buffer.from(manifestText(manifest)));
  assert.equal(response.status, 400); assert.match(response.result.params.detail, /missing bound effect does-not-exist/);
  assert.deepEqual(fs.readFileSync(path.join(m.dir, 'plugin.json')), before);
});
test('existing findings excuse only their own multiplicity, and identical retained findings allow repair', async t => {
  const m = setup(t), manifest = m.raw();
  manifest.assets.fx.flipbooks['Bad-A'] = { ...manifest.assets.fx.flipbooks.flash }; m.write(manifest);
  const before = fs.readFileSync(path.join(m.dir, 'plugin.json'));
  const count = m.check().problems.filter(p => p.message.includes('invalid flipbook id')).length;
  assert.ok(count > 0);
  assert.equal((await m.api('files/note.txt', Buffer.from('unchanged findings'))).status, 200);
  manifest.assets.fx.flipbooks['Bad-B'] = { ...manifest.assets.fx.flipbooks.flash };
  const response = await m.api('files/plugin.json', Buffer.from(manifestText(manifest)));
  assert.equal(response.status, 400); assert.match(response.result.params.detail, /invalid flipbook id/);
  assert.deepEqual(fs.readFileSync(path.join(m.dir, 'plugin.json')), before);
});
test('changed measured values in a finding count as a new reason', async t => {
  const m = setup(t), patch = patchFolder(m, 999999999);
  // Fix the independent art so the original finding already exists in both implementations.
  m.files.write(m.id, 'fx/missing.png', png(), { generated: true });
  assert.ok(m.check().problems.some(p => p.code === 'PLUGIN_DATA_BOUND'));
  const before = fs.readFileSync(path.join(m.dir, 'data/patch.json')); for (const op of patch.ops) op.value--;
  assert.equal((await m.api('files/data/patch.json', Buffer.from(manifestText(patch)))).status, 400);
  assert.deepEqual(fs.readFileSync(path.join(m.dir, 'data/patch.json')), before);
});
test('legacy art slots keep direct writes and FX extensions keep their lowercase grammar', async t => {
  const m = setup(t, 'art'), bytes = Buffer.from('not png');
  const response = await m.api('slot', { at: ['chars', 'char_102_texas', 'avatar'], files: [{ name: 'legacy.png', data: bytes.toString('base64') }] }, 'POST');
  assert.equal(response.status, 200);
  assert.deepEqual(fs.readFileSync(path.join(m.dir, m.raw().assets.chars.char_102_texas.avatar)), bytes);
  assert.equal(fxPath('fx/art.png'), true); assert.equal(fxPath('fx/index.json'), true);
  assert.equal(fxPath('fx/art.PNG'), false); assert.equal(fxPath('fx/index.JSON'), false);
});

test('a repair upload in a trait plugin is not refused for a gameplay finding both checks report', async t => {
  // The folder checker composes trait plugins once nothing else is wrong (pack.js), and the studio composes too: after
  // the picture is repaired both passes report the same data finding, which is still the one finding the folder had.
  const m = setup(t, 'trait'), manifest = m.raw();
  const table = JSON.parse(fs.readFileSync(new URL('../../data/chess.json', import.meta.url)));
  const id = Object.values(table).find(r => r.charId === 'char_102_texas' && !r.isGolden).chessId;
  const slot = table[id].skills.findIndex(s => s.index === table[id].skill.index);
  manifest.data = ['data/patch.json'];
  manifest.assets = { chars: { char_102_texas: { avatar: 'art/missing.png' } } };
  manifest.permissions = [...new Set([...manifest.permissions, 'data.patch', 'assets.override'])];
  m.write(manifest);
  const patch = { patch: 1, ops: [['skill', 'spCost'], ['skills', slot, 'spCost']].map(at => ({ op: 'set', file: 'chess', id, path: at, value: 999999999 })) };
  m.files.write(m.id, 'data/patch.json', Buffer.from(manifestText(patch)), { generated: true });
  const findings = r => r.problems.filter(p => p.code === 'PLUGIN_DATA_BOUND').map(p => `${p.path}|${p.message}`).sort();
  const before = m.check();
  assert.ok(before.problems.some(p => p.code === 'PLUGIN_FILE_MISSING'), JSON.stringify(before.problems));
  assert.ok(findings(before).length, JSON.stringify(before.problems));
  const r = await m.api('files/art/missing.png', png());
  assert.equal(r.status, 200, JSON.stringify(r.result));
  const after = m.check();
  assert.ok(!after.problems.some(p => p.code === 'PLUGIN_FILE_MISSING'));
  assert.deepEqual(findings(after), findings(before), 'the same data findings, each once');
});
