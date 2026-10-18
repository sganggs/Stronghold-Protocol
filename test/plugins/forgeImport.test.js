// test/plugins/forgeImport.test.js — Forge workshop import (DESIGN §32.12, docs/PLUGINS.md §16).
// The three packs under test/fixtures/forge/ are written for this test (no official art, nothing copied from Forge).
// The chess, official-kit and kit packs of round 43 are written inline into temporary folders: a kit is a .js file,
// and `node --test` runs every .js under test/ (an `@kit/…` import would fail it there). Their numbers are made up;
// only official ids (skills, kits, bonds, garrisons) are real.
// A cosmetic product must resolve through createVisualSets with no problems and no warnings. A content product must
// come back from buildContentSet with an empty problems list. There is no buildVisualSet symbol.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { main } from '../../tools/plugin.mjs';
import { importForge, readUntrustedZip } from '../../server/plugins/forgeImport.js';
import { skeletonClipData } from '../../server/plugins/pack.js';
import { parseSkel } from '../../tools/assets/skel.mjs';
import { crc32, zipFiles } from '../../server/plugins/zip.js';
import { createStudio } from '../../server/studio/index.js';
import { createPluginRegistry, readVanillaAssets } from '../../server/plugins/registry.js';
import { createVisualSets } from '../../server/plugins/visualSet.js';
import { buildContentSet, contentSetFiles } from '../../server/plugins/contentSet.js';
import { PLUGIN_LIMITS } from '../../shared/plugins/manifest.js';
import { skel, atlas, png } from '../helpers/pluginFixtures.js';
import { canonicalJson } from '../../shared/plugins/identity.js';
import { bundleForgeKits, FORGE_IMPORT_MAP, KIT_BUNDLE_BYTES, KIT_MODULES_MAX, SDK_KIT_NAMES } from '../../server/plugins/forgeKits.js';
import { checkScript } from '../../shared/plugins/scriptCheck.js';
import { makeBattle, checkInvariants } from '../helpers/battleHarness.js';
import { DataSource } from '../../server/sim/simdata.js';
import { setGameData } from '../../server/sim/content/support/index.js';
import { availableSkins } from '../../public/js/ui/skins.js';
import { data } from '../../public/js/data.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURES = path.join(ROOT, 'test', 'fixtures', 'forge');
const BAIT = '/tmp/sp-forge-bait-wp-h.txt';
const vanilla = readVanillaAssets(path.join(ROOT, 'data'));

const quiet = async (argv) => {
  const out = [];
  const log = console.log;
  const err = console.error;
  console.log = (...a) => out.push(a.join(' '));
  console.error = (...a) => out.push(a.join(' '));
  try { return { code: await main(argv), out: out.join('\n') }; }
  finally { console.log = log; console.error = err; }
};

function walk(dir, rel = '') {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    const next = rel ? `${rel}/${name}` : name;
    const st = fs.lstatSync(abs);
    if (st.isDirectory()) out.push(...walk(abs, next));
    else out.push(next);
  }
  return out;
}

function zipEntry({ name, data = Buffer.alloc(0), rawSize = data.length, method = 0, external = (0o100644 << 16) >>> 0 }) {
  const nameBuf = Buffer.from(name, 'utf8');
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(rawSize >>> 0, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(rawSize >>> 0, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(external, 38);
  return { local: Buffer.concat([local, nameBuf, data]), central, nameBuf };
}

function zipOf(entries) {
  const built = entries.map(zipEntry);
  let offset = 0;
  const parts = [];
  const centrals = [];
  for (const b of built) {
    b.central.writeUInt32LE(offset, 42);
    parts.push(b.local);
    centrals.push(b.central, b.nameBuf);
    offset += b.local.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(built.length, 8);
  eocd.writeUInt16LE(built.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, eocd]);
}

async function importPack(name, { dryRun = false, json = false } = {}) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-forge-'));
  const id = name === 'skin-pack' ? 'rose-skin' : name === 'numbers-pack' ? 'rose-numbers' : 'rose-mixed';
  const argv = ['import-forge', path.join(FIXTURES, name), '--out', path.join(parent, id), '--root', ROOT];
  if (dryRun) argv.push('--dry-run');
  if (json) argv.push('--json');
  const r = await quiet(argv);
  return { parent, id, ...r };
}

function setsOf(parent) {
  const registry = createPluginRegistry({
    publicDir: path.join(ROOT, 'public'), packsDir: path.join(ROOT, 'packs'), pluginsDir: parent, dataDir: path.join(ROOT, 'data'),
  }, { recheckMs: 0, log: { info() {}, warn() {} } });
  return { registry, visual: createVisualSets({ registry }) };
}

test('skin pack: cosmetic overlay, check --strict, pack, visual set with no problems', async () => {
  fs.rmSync(BAIT, { force: true });
  const got = await importPack('skin-pack');
  try {
    assert.equal(got.code, 0, got.out);
    const dir = path.join(got.parent, 'rose-skin');
    assert.ok(fs.existsSync(path.join(dir, 'IMPORT-REPORT.md')));
    assert.match(fs.readFileSync(path.join(dir, 'IMPORT-REPORT.md'), 'utf8'), /audio\.voiceJp/);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8'));
    assert.equal(manifest.class, 'cosmetic');
    assert.deepEqual(manifest.permissions, ['assets.override']);
    const check = await quiet(['check', dir, '--strict', '--root', ROOT]);
    assert.equal(check.code, 0, check.out);
    const pack = await quiet(['pack', dir, '--root', ROOT]);
    assert.equal(pack.code, 0, pack.out);
    const { visual } = setsOf(got.parent);
    const set = visual.resolve(['rose-skin']);
    assert.equal(set.ok, true, JSON.stringify(set));
    assert.deepEqual(set.set.warnings, []);
    assert.equal(fs.existsSync(BAIT), false);
  } finally { fs.rmSync(got.parent, { recursive: true, force: true }); }
});

test('one outfit per skin: an id that is a skin key becomes that operator\'s own skins variant; no usable id collapses onto the operator', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-forge-'));
  const pack = path.join(parent, 'pack');
  fs.mkdirSync(path.join(pack, 'chars'), { recursive: true });
  fs.copyFileSync(path.join(FIXTURES, 'skin-pack', 'chars', 'texas', 'avatar.png'), path.join(pack, 'chars', 'sightseer.png'));
  fs.writeFileSync(path.join(pack, 'pack.json'), JSON.stringify({
    id: 'rose-wardrobe', name: '玫瑰衣柜', version: '1.0.0', license: 'CC0-1.0', content: [],
    skins: [
      { id: 'char_102_texas@sightseer#2', charId: 'char_102_texas', name: '悠然假日', art: { portrait: 'chars/sightseer.png' } },
      { charId: 'char_112_siege', art: { avatar: 'chars/sightseer.png' } },
    ],
  }));
  const out = path.join(parent, 'out');
  const r = await quiet(['import-forge', pack, '--out', path.join(out, 'rose-wardrobe'), '--root', ROOT]);
  try {
    assert.equal(r.code, 0, r.out);
    const dir = path.join(out, 'rose-wardrobe');
    const overlay = JSON.parse(fs.readFileSync(path.join(dir, 'assets.json'), 'utf8'));
    assert.equal(overlay.chars.char_102_texas.skins['char_102_texas@sightseer#2'].name, '悠然假日');
    assert.equal(overlay.chars.char_102_texas.skins['char_102_texas@sightseer#2'].portrait, 'files/chars/sightseer.png');
    assert.equal(overlay.chars.char_112_siege.avatar, 'files/chars/sightseer.png', 'no skin key: the operator\'s own overlay, as before');
    assert.equal(overlay.chars.char_112_siege.skins, undefined);
    assert.match(fs.readFileSync(path.join(dir, 'IMPORT-REPORT.md'), 'utf8'), /skins 变体/);
    // the overlay writes into chars[char_102_texas], an operator this installation has: the entry counts as changed, so
    // the permission readAssetOverlay asks for is assets.override — no assets.add anywhere in this pack (§9, §16)
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8'));
    assert.deepEqual(manifest.permissions, ['assets.override'], `permissions ${manifest.permissions.join(', ')}`);
    const check = await quiet(['check', dir, '--strict', '--root', ROOT]);
    assert.equal(check.code, 0, check.out);
    const packed = await quiet(['pack', dir, '--root', ROOT]);
    assert.equal(packed.code, 0, packed.out);
    const { visual } = setsOf(out);
    const set = visual.resolve(['rose-wardrobe']);
    assert.equal(set.ok, true, JSON.stringify(set));
    assert.deepEqual(set.set.warnings, []);
    // the imported outfit is what the picker lists: availableSkins reads chars[charId].skins off the composed manifest
    data.setContent({ id: 'f'.repeat(64), values: { assets: overlay } });
    try {
      const rows = availableSkins('char_102_texas');
      assert.ok(rows.some((r) => r.id === 'char_102_texas@sightseer#2'), 'an imported Forge outfit is a picker row');
      assert.deepEqual(availableSkins('char_112_siege').map((r) => r.id), [''], 'a collapsed outfit is the operator\'s own row, not a skin');
    } finally { data.setContent(null); }
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('an operator-level illustration lands on chars[<charId>].illust (and needs assets.override when the operator exists here)', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-forge-'));
  const pack = path.join(parent, 'pack');
  fs.mkdirSync(pack, { recursive: true });
  fs.writeFileSync(path.join(pack, 'illust.png'), PNG);
  fs.writeFileSync(path.join(pack, 'pack.json'), JSON.stringify({
    id: 'rose-illust', name: '玫瑰立绘', version: '1.0.0', license: 'CC0-1.0', content: [],
    art: { chars: { char_102_texas: { illust: 'illust.png' }, char_rose_new: { illust: 'illust.png' } } },
  }));
  const out = path.join(parent, 'out');
  const r = await quiet(['import-forge', pack, '--out', path.join(out, 'rose-illust'), '--root', ROOT]);
  try {
    assert.equal(r.code, 0, r.out);
    const dir = path.join(out, 'rose-illust');
    const overlay = JSON.parse(fs.readFileSync(path.join(dir, 'assets.json'), 'utf8'));
    assert.equal(overlay.chars.char_102_texas.illust, 'files/illust.png', 'the illustration of an operator this installation has');
    assert.equal(overlay.chars.char_rose_new.illust, 'files/illust.png', 'and of one the plugin introduces');
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8'));
    // the same rule readAssetOverlay applies: an entry the manifest already has is an override, a new one an add. This
    // overlay names one operator the installation has and one it does not, so both are declared
    if (vanilla?.manifest?.chars?.char_102_texas) {
      assert.ok(manifest.permissions.includes('assets.override'), `permissions ${manifest.permissions.join(', ')}`);
      assert.ok(manifest.permissions.includes('assets.add'), `permissions ${manifest.permissions.join(', ')}`);
    } else {
      assert.ok(manifest.permissions.includes('assets.add'), `permissions ${manifest.permissions.join(', ')}`);
    }
    const check = await quiet(['check', dir, '--strict', '--root', ROOT]);
    assert.equal(check.code, 0, check.out);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('boss music and ui sounds become a cosmetic overlay; an unknown sound bucket is named and left out', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-forge-'));
  const pack = path.join(parent, 'pack');
  fs.mkdirSync(path.join(pack, 'audio'), { recursive: true });
  fs.copyFileSync(path.join(FIXTURES, 'skin-pack', 'voice', 'select.mp3'), path.join(pack, 'audio', 'click.mp3'));
  fs.copyFileSync(path.join(FIXTURES, 'skin-pack', 'voice', 'select.mp3'), path.join(pack, 'audio', 'boss.mp3'));
  fs.writeFileSync(path.join(pack, 'pack.json'), JSON.stringify({
    id: 'rose-audio', name: '玫瑰音效', version: '1.0.0', license: 'CC0-1.0', content: [],
    art: { audio: { bossBgm: { roseboss: 'audio/boss.mp3' }, sfx: { ui: { click: 'audio/click.mp3' }, nope: { x: 'audio/click.mp3' } } } },
  }));
  const out = path.join(parent, 'out');
  const r = await quiet(['import-forge', pack, '--out', path.join(out, 'rose-audio'), '--root', ROOT]);
  try {
    assert.equal(r.code, 0, r.out);
    const dir = path.join(out, 'rose-audio');
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8'));
    const overlay = JSON.parse(fs.readFileSync(path.join(dir, 'assets.json'), 'utf8'));
    assert.equal(manifest.class, 'cosmetic');
    assert.equal(overlay.audio.sfx.ui.click, 'files/audio/click.mp3');
    assert.equal(overlay.audio.bossBgm.roseboss.loop, 'files/audio/boss.mp3');
    assert.equal(overlay.audio.sfx.nope, undefined);
    const report = fs.readFileSync(path.join(dir, 'IMPORT-REPORT.md'), 'utf8');
    assert.match(report, /art\.audio\.sfx\.nope/);
    assert.match(report, /ui、battle、units/);
    const check = await quiet(['check', dir, '--strict', '--root', ROOT]);
    assert.equal(check.code, 0, check.out);
    const packed = await quiet(['pack', dir, '--root', ROOT]);
    assert.equal(packed.code, 0, packed.out);
    const { visual } = setsOf(out);
    const set = visual.resolve(['rose-audio']);
    assert.equal(set.ok, true, JSON.stringify(set));
    assert.deepEqual(set.set.warnings, []);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('numbers pack: bond patch, operator and enemy, content set with no problems, kit script not run', async () => {
  fs.rmSync(BAIT, { force: true });
  const got = await importPack('numbers-pack');
  try {
    assert.equal(got.code, 0, got.out);
    const dir = path.join(got.parent, 'rose-numbers');
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8'));
    assert.equal(manifest.class, 'content');
    assert.deepEqual(manifest.permissions, ['data.patch', 'data.add']);
    const op = JSON.parse(fs.readFileSync(path.join(dir, 'operators', 'imported.json'), 'utf8'));
    assert.equal(op.profession, 'TANK');
    assert.equal(op.as, 'chess');
    assert.equal(op.kit, 'generic');
    assert.deepEqual(op.chess.bonds, ['deputShip']);
    assert.match(op.charId, /^char_x_rose_numbers_/);
    const enemy = JSON.parse(fs.readFileSync(path.join(dir, 'enemies', 'imported.json'), 'utf8'));
    assert.equal(enemy.base, 'enemy_1422_lrsldr');
    assert.equal(enemy.set.stats.maxHp, 6000);
    assert.match(enemy.id, /^enemy_x_rose_numbers_/);
    const report = fs.readFileSync(path.join(dir, 'IMPORT-REPORT.md'), 'utf8');
    assert.match(report, /通用 kit/);
    assert.match(report, /kits\/guard\.js/);
    assert.equal(walk(dir).some((f) => f.endsWith('.js')), false);
    const check = await quiet(['check', dir, '--strict', '--root', ROOT]);
    assert.equal(check.code, 0, check.out);
    const pack = await quiet(['pack', dir, '--root', ROOT]);
    assert.equal(pack.code, 0, pack.out);
    const { registry } = setsOf(got.parent);
    const set = buildContentSet({ registry, ids: ['rose-numbers'] });
    assert.deepEqual(set.problems, [], JSON.stringify(set.problems));
    assert.equal(fs.existsSync(BAIT), false);
  } finally { fs.rmSync(got.parent, { recursive: true, force: true }); }
});

test('mixed pack: cosmetic, content, ui and lang; refused pieces named with their reasons', async () => {
  fs.rmSync(BAIT, { force: true });
  const got = await importPack('mixed-pack');
  try {
    assert.equal(got.code, 0, got.out);
    const ids = fs.readdirSync(got.parent).filter((n) => !n.startsWith('.')).sort();
    assert.deepEqual(ids, ['rose-mixed', 'rose-mixed-en', 'rose-mixed-hud-right', 'rose-mixed-look']);
    const report = fs.readFileSync(path.join(got.parent, 'rose-mixed', 'IMPORT-REPORT.md'), 'utf8');
    assert.match(report, /服务端逻辑/);
    assert.match(report, /server logic/);
    assert.match(report, /HTTP 路由/);
    assert.match(report, /root\.overlays/);
    assert.match(report, /需要人工适配/);
    assert.match(report, /extra\/note\.png/);
    assert.match(report, /没有引用它/);
    assert.match(report, /kits\/boom\.js/);
    assert.match(report, /不执行/);
    const ui = JSON.parse(fs.readFileSync(path.join(got.parent, 'rose-mixed-hud-right', 'plugin.json'), 'utf8'));
    assert.deepEqual(ui.slots, ['hud.right']);
    assert.match(fs.readFileSync(path.join(got.parent, 'rose-mixed-hud-right', 'ui', 'index.html'), 'utf8'), /postMessage API v1/);
    const lang = JSON.parse(fs.readFileSync(path.join(got.parent, 'rose-mixed-en', 'plugin.json'), 'utf8'));
    assert.equal(lang.class, 'lang');
    assert.equal(lang.lang, 'en');
    for (const id of ids) {
      const dir = path.join(got.parent, id);
      const check = await quiet(['check', dir, '--strict', '--root', ROOT]);
      assert.equal(check.code, 0, `${id}\n${check.out}`);
      const pack = await quiet(['pack', dir, '--root', ROOT]);
      assert.equal(pack.code, 0, `${id}\n${pack.out}`);
      assert.equal(walk(dir).some((f) => f.endsWith('.js')), false, id);
    }
    const { registry, visual } = setsOf(got.parent);
    const look = visual.resolve(['rose-mixed-look']);
    assert.equal(look.ok, true, JSON.stringify(look));
    assert.deepEqual(look.set.warnings, []);
    const content = buildContentSet({ registry, ids: ['rose-mixed'] });
    assert.deepEqual(content.problems, [], JSON.stringify(content.problems));
    assert.equal(fs.existsSync(BAIT), false);
  } finally { fs.rmSync(got.parent, { recursive: true, force: true }); }
});

test('--dry-run writes nothing; --json is stable and has no home path', async () => {
  const a = await importPack('skin-pack', { dryRun: true, json: true });
  const b = await importPack('skin-pack', { dryRun: true, json: true });
  try {
    assert.equal(a.code, 0, a.out);
    assert.equal(b.code, 0, b.out);
    assert.equal(a.out, b.out);
    const report = JSON.parse(a.out);
    assert.equal(report.ok, true);
    assert.equal(report.dryRun, true);
    assert.equal(report.wrote, false);
    assert.equal(report.products[0].id, 'rose-skin');
    assert.equal(fs.readdirSync(a.parent).length, 0);
    assert.equal(fs.readdirSync(b.parent).length, 0);
    assert.equal(a.out.includes(os.homedir()), false);
    assert.equal(a.out.includes('/Users/'), false);
  } finally {
    fs.rmSync(a.parent, { recursive: true, force: true });
    fs.rmSync(b.parent, { recursive: true, force: true });
  }
});

test('a second import into the same folder is refused and leaves the first folder as it was', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-forge-'));
  try {
    const first = await importForge(path.join(FIXTURES, 'skin-pack'), { pluginsDir: parent, root: ROOT, dataDir: path.join(ROOT, 'data'), vanilla });
    assert.equal(first.ok, true, first.markdown);
    const before = fs.readFileSync(path.join(parent, 'rose-skin', 'plugin.json'));
    const second = await importForge(path.join(FIXTURES, 'skin-pack'), { pluginsDir: parent, root: ROOT, dataDir: path.join(ROOT, 'data'), vanilla });
    assert.equal(second.ok, false);
    assert.equal(second.issues[0].code, 'PLUGIN_FORGE_EXISTS');
    assert.ok(before.equals(fs.readFileSync(path.join(parent, 'rose-skin', 'plugin.json'))));
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('malicious zip and directory input is refused and a script in the pack is not executed', async () => {
  fs.rmSync(BAIT, { force: true });
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-forge-'));
  const opts = { pluginsDir: parent, root: ROOT, dataDir: path.join(ROOT, 'data'), vanilla };
  try {
    const slip = await importForge({ zip: zipOf([{ name: '../slip.txt', data: Buffer.from('no') }, { name: 'pack.json', data: Buffer.from('{"id":"rose-slip","name":"x","version":"1.0.0"}') }]) }, opts);
    assert.equal(slip.ok, false);
    assert.equal(slip.issues[0].code, 'PLUGIN_FORGE_ZIP');
    assert.match(slip.issues[0].detail, /path escapes/);

    const link = await importForge({ zip: zipOf([{ name: 'link.txt', data: Buffer.from('/tmp/x'), external: (0o120000 << 16) >>> 0 }, { name: 'pack.json', data: Buffer.from('{"id":"rose-link","name":"x","version":"1.0.0"}') }]) }, opts);
    assert.equal(link.issues[0].code, 'PLUGIN_FORGE_ZIP');
    assert.match(link.issues[0].detail, /symbolic link/);

    const huge = await importForge({ zip: zipOf([{ name: 'pack.json', data: Buffer.from('{"id":"rose-huge","name":"x","version":"1.0.0"}'), rawSize: PLUGIN_LIMITS.pluginBytes + 1 }]) }, opts);
    assert.equal(huge.issues[0].code, 'PLUGIN_FORGE_ZIP');
    assert.match(huge.issues[0].detail, /larger than/);

    let deep = { id: 'rose-deep', name: 'd', version: '1.0.0' };
    for (let i = 0; i < 70; i++) deep = { nest: deep };
    const deepDir = path.join(parent, 'deep');
    fs.mkdirSync(deepDir);
    fs.writeFileSync(path.join(deepDir, 'pack.json'), JSON.stringify(deep));
    const nested = await importForge(deepDir, opts);
    assert.equal(nested.issues[0].code, 'PLUGIN_FORGE_JSON');
    assert.match(nested.issues[0].detail, /nested deeper/);

    const escaped = await importForge({ files: new Map([['../evil.json', Buffer.from('{}')], ['pack.json', Buffer.from('{"id":"rose-evil","name":"x","version":"1.0.0"}')]]) }, opts);
    assert.equal(escaped.issues[0].code, 'PLUGIN_FORGE_ZIP');

    const baitDir = path.join(parent, 'bait');
    fs.mkdirSync(path.join(baitDir, 'kits'), { recursive: true });
    fs.writeFileSync(path.join(baitDir, 'pack.json'), JSON.stringify({ id: 'rose-bait', name: 'bait', version: '1.0.0' }));
    fs.copyFileSync(path.join(FIXTURES, 'mixed-pack', 'kits', 'boom.js'), path.join(baitDir, 'kits', 'boom.js'));
    const bait = await importForge(baitDir, opts);
    assert.equal(bait.ok, true, bait.markdown);
    assert.equal(bait.wrote, false);
    assert.match(bait.markdown, /kits\/boom\.js/);
    assert.match(bait.markdown, /不执行/);
    assert.equal(fs.existsSync(BAIT), false);
    assert.equal(fs.readdirSync(parent).includes('rose-bait'), false);

    const linked = path.join(parent, 'linked');
    fs.mkdirSync(linked);
    fs.writeFileSync(path.join(linked, 'pack.json'), '{"id":"rose-linked","name":"x","version":"1.0.0"}');
    fs.symlinkSync('/tmp', path.join(linked, 'escape'));
    const sym = await importForge(linked, opts);
    assert.equal(sym.issues[0].code, 'PLUGIN_FORGE_ZIP');
    assert.match(sym.issues[0].detail, /symbolic link/);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
    fs.rmSync(BAIT, { force: true });
  }
});

test('readUntrustedZip rejects a truncated archive before it yields entries', async () => {
  await assert.rejects(readUntrustedZip(Buffer.from('not a zip')), (e) => e.code === 'PLUGIN_FORGE_ZIP');
});

const PNG = fs.readFileSync(path.join(FIXTURES, 'skin-pack', 'chars', 'texas', 'avatar.png'));
const MP3 = fs.readFileSync(path.join(FIXTURES, 'skin-pack', 'voice', 'select.mp3'));
const protoNames = () => Object.getOwnPropertyNames(Object.prototype).slice().sort();

function forgeOpts(parent) {
  return { pluginsDir: parent, root: ROOT, dataDir: path.join(ROOT, 'data'), vanilla };
}

function writePack(dir, pack, files) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'pack.json'), JSON.stringify(pack));
  for (const [rel, data] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, data);
  }
}

function dirsOf(parent) {
  return fs.readdirSync(parent).filter((n) => !n.startsWith('.'));
}

function zipDir(dir) {
  const files = [];
  const walk = (abs, rel) => {
    for (const name of fs.readdirSync(abs)) {
      const p = path.join(abs, name);
      const next = rel ? `${rel}/${name}` : name;
      if (fs.statSync(p).isDirectory()) walk(p, next);
      else files.push({ name: next, data: fs.readFileSync(p) });
    }
  };
  walk(dir, '');
  return zipFiles(files);
}

async function postPreview(studio, body) {
  const raw = Buffer.from(JSON.stringify(body));
  const req = Readable.from([raw]);
  req.method = 'POST';
  req.url = '/studio/api/forge/preview';
  req.headers = {
    host: 'localhost',
    'content-type': 'application/json',
    'content-length': String(raw.length),
    'x-sp-studio': studio.key,
  };
  req.socket = { remoteAddress: '127.0.0.1' };
  const chunks = [];
  let status = 0;
  const res = {
    headersSent: false,
    setHeader() {},
    getHeader() { return undefined; },
    writeHead(code) { status = code; this.headersSent = true; return this; },
    write(c) { if (c) chunks.push(Buffer.from(c)); return true; },
    end(c) { if (c) chunks.push(Buffer.from(c)); this.headersSent = true; },
    destroy() {},
  };
  await studio.handle(req, res, '/studio/api/forge/preview', '');
  const text = Buffer.concat(chunks).toString('utf8');
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text }; }
  return { status, body: parsed, text };
}

test('preview and dry-run leave Object.prototype unchanged on success and on a poisoned pack', async () => {
  const before = protoNames();
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-forge-proto-'));
  const plugins = path.join(parent, 'plugins');
  fs.mkdirSync(plugins);
  const registry = createPluginRegistry({
    publicDir: path.join(ROOT, 'public'), packsDir: path.join(ROOT, 'packs'), pluginsDir: plugins, dataDir: path.join(ROOT, 'data'),
  }, { recheckMs: 0, log: { info() {}, warn() {} } });
  const studio = createStudio({
    publicDir: path.join(ROOT, 'public'), pluginsDir: plugins, dataDir: path.join(ROOT, 'data'), registry, mode: 'local',
    log: { info() {}, warn() {}, error() {} },
  });
  const poison = zipOf([
    { name: 'a.mp3', data: MP3 },
    { name: 'pack.json', data: Buffer.from('{"id":"poison-test","name":"p","version":"1.0.0","voices":{"__proto__":{"wpHProbe":"a.mp3"}}}') },
  ]);
  const ctor = zipOf([
    { name: 'a.mp3', data: MP3 },
    { name: 'pack.json', data: Buffer.from('{"id":"poison-ctor","name":"p","version":"1.0.0","voices":{"constructor":{"wpHProbe":"a.mp3"}}}') },
  ]);
  const skinZip = zipDir(path.join(FIXTURES, 'skin-pack'));
  const poisonPath = path.join(parent, 'poison.zip');
  const skinPath = path.join(parent, 'skin.zip');
  const truncPath = path.join(parent, 'trunc.zip');
  fs.writeFileSync(poisonPath, poison);
  fs.writeFileSync(skinPath, skinZip);
  fs.writeFileSync(truncPath, Buffer.from('not a zip'));
  try {
    const bad = await postPreview(studio, { zip: poison.toString('base64') });
    assert.equal(bad.status, 400, bad.text);
    assert.equal(bad.body.error, 'PLUGIN_FORGE_JSON');
    const ctorRes = await postPreview(studio, { zip: ctor.toString('base64') });
    assert.equal(ctorRes.status, 400, ctorRes.text);
    const ok = await postPreview(studio, { zip: skinZip.toString('base64') });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.body.report.ok, true);
    assert.equal(ok.body.report.wrote, false);
    const broken = await postPreview(studio, { zip: Buffer.from('not a zip').toString('base64') });
    assert.equal(broken.status, 400, broken.text);
    assert.equal(broken.body.error, 'PLUGIN_FORGE_ZIP');

    const dryPoison = await quiet(['import-forge', poisonPath, '--dry-run', '--json', '--root', ROOT, '--out', path.join(parent, 'poison-test')]);
    assert.equal(dryPoison.code, 1, dryPoison.out);
    const dryPoisonReport = JSON.parse(dryPoison.out);
    assert.equal(dryPoisonReport.ok, false);
    assert.equal(dryPoisonReport.issues[0].code, 'PLUGIN_FORGE_JSON');
    const drySkin = await quiet(['import-forge', skinPath, '--dry-run', '--json', '--root', ROOT, '--out', path.join(parent, 'rose-skin')]);
    assert.equal(drySkin.code, 0, drySkin.out);
    assert.equal(JSON.parse(drySkin.out).wrote, false);
    const dryTrunc = await quiet(['import-forge', truncPath, '--dry-run', '--json', '--root', ROOT]);
    assert.equal(dryTrunc.code, 1, dryTrunc.out);
    assert.equal(JSON.parse(dryTrunc.out).issues[0].code, 'PLUGIN_FORGE_ZIP');

    assert.equal(({}).wpHProbe, undefined);
    assert.deepEqual(protoNames(), before);
    assert.equal(Object.prototype.hasOwnProperty('wpHProbe'), false);
  } finally {
    delete Object.prototype.wpHProbe;
    studio.close();
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('two language codes that canonicalise together are refused and write nothing', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-forge-lang-'));
  const pack = path.join(parent, 'pack');
  // en and EN name two files whose paths do not differ only by case: i18n/en.json + i18n/EN.json are one file on a
  // case-insensitive disk (macOS, Windows) but two on Linux, where the case clash is refused first (checked below)
  writePack(pack, {
    id: 'lang-alias', name: '别名', version: '1.0.0', license: 'CC0-1.0', content: [],
    i18n: { en: 'i18n/en.json', EN: 'i18n/en-caps.json' },
  }, {
    'i18n/en.json': JSON.stringify({ hello: 'hi' }),
    'i18n/en-caps.json': JSON.stringify({ hello: 'HI' }),
  });
  const casePack = { id: 'lang-case', name: '大小写', version: '1.0.0', license: 'CC0-1.0', content: [],
    i18n: { en: 'i18n/en.json', EN: 'i18n/EN.json' } };
  const caseFiles = { 'i18n/en.json': JSON.stringify({ hello: 'hi' }), 'i18n/EN.json': JSON.stringify({ hello: 'HI' }) };
  const written = () => dirsOf(parent).filter((n) => n !== 'pack' && n !== 'case-pack');
  try {
    const got = await importForge(pack, { ...forgeOpts(parent), out: path.join(parent, 'lang-alias') });
    assert.equal(got.ok, false);
    assert.equal(got.issues[0].code, 'PLUGIN_FORGE_INPUT');
    assert.match(got.issues[0].detail, /same language/);
    assert.deepEqual(written(), []);
    assert.equal(got.markdown.includes(os.homedir()), false);
    // i18n/en.json and i18n/EN.json side by side: a zip holds both names on every disk, a folder only on a
    // case-sensitive one; either way the names clash by case, which is refused before the language rule (nothing written)
    const zip = zipOf([{ name: 'pack.json', data: Buffer.from(JSON.stringify(casePack)) },
      ...Object.entries(caseFiles).map(([name, body]) => ({ name, data: Buffer.from(body) }))]);
    const zipped = await importForge({ zip }, { ...forgeOpts(parent), out: path.join(parent, 'lang-case') });
    assert.equal(zipped.ok, false);
    assert.equal(zipped.issues[0].code, 'PLUGIN_FORGE_ZIP');
    assert.match(zipped.issues[0].detail, /differs only by case/);
    const folder = path.join(parent, 'case-pack');
    writePack(folder, casePack, caseFiles);
    if (fs.readdirSync(path.join(folder, 'i18n')).length === 2) {
      const read = await importForge(folder, { ...forgeOpts(parent), out: path.join(parent, 'lang-case') });
      assert.equal(read.ok, false);
      assert.equal(read.issues[0].code, 'PLUGIN_FORGE_ZIP');
      assert.match(read.issues[0].detail, /differs only by case/);
    }
    assert.deepEqual(written(), []);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('a rename failure rolls back only destinations this attempt created', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-forge-eio-'));
  fs.mkdirSync(path.join(parent, 'keep-me'));
  fs.writeFileSync(path.join(parent, 'keep-me', 'x'), 'stay');
  const real = fs.renameSync;
  let moves = 0;
  fs.renameSync = (from, to) => {
    if (path.resolve(path.dirname(to)) === path.resolve(parent)) {
      moves += 1;
      if (moves === 2) {
        const err = new Error('injected');
        err.code = 'EIO';
        throw err;
      }
    }
    return real(from, to);
  };
  try {
    const got = await importForge(path.join(FIXTURES, 'mixed-pack'), { ...forgeOpts(parent), out: path.join(parent, 'rose-mixed') });
    assert.equal(got.ok, false, got.markdown);
    assert.equal(got.wrote, false);
    assert.equal(got.issues[0].code, 'PLUGIN_FORGE_ZIP');
    assert.match(got.issues[0].detail, /EIO/);
    assert.equal(got.report.wrote, false);
    assert.deepEqual(dirsOf(parent), ['keep-me']);
    assert.equal(fs.readFileSync(path.join(parent, 'keep-me', 'x'), 'utf8'), 'stay');
    assert.equal(JSON.stringify(got.report).includes(os.homedir()), false);
  } finally {
    fs.renameSync = real;
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('form skills and numeric form ranks become normal and elite', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-forge-forms-'));
  const pack = path.join(parent, 'pack');
  writePack(pack, {
    id: 'rose-rank', name: '阶', version: '1.0.0', license: 'CC0-1.0', content: ['units'],
    operators: { rose_rank: {} },
  }, {
    'units.json': JSON.stringify({
      rose_rank: {
        name: '阶位守卫', rarity: 4, profession: 'DEFENDER', subProfessionId: 'protector', position: 'MELEE',
        bonds: ['deputShip'],
        forms: {
          '2/9/1/0': { stats: { maxHp: 1111, atk: 100, def: 80, bat: 1.2 }, rangeGrid: [[0, 0]], skills: [{ name: '低', default: true, duration: 5, spCost: 10, initSp: 0, rangeId: 'far' }] },
          '2/60/7/1': { stats: { maxHp: 6666, atk: 200, def: 90, bat: 1.2 }, rangeGrid: [[0, 0]], skills: [{ name: '高', default: true, duration: 8, spCost: 20, initSp: 4 }] },
        },
      },
    }),
  });
  try {
    const got = await importForge(pack, { ...forgeOpts(parent), out: path.join(parent, 'rose-rank') });
    assert.equal(got.ok, true, got.markdown);
    const op = JSON.parse(fs.readFileSync(path.join(parent, 'rose-rank', 'operators', 'imported.json'), 'utf8'));
    assert.equal(op.forms.normal.stats.maxHp, 1111);
    assert.equal(op.forms.elite.stats.maxHp, 6666);
    assert.equal(op.forms.normal.skills[0].name, '低');
    assert.equal(op.forms.elite.skills[0].name, '高');
    assert.equal(op.profession, 'TANK');
    assert.equal(op.as, 'chess');
    assert.equal(op.kit, 'generic');
    assert.deepEqual(op.chess.bonds, ['deputShip']);
    assert.match(got.markdown, /rangeId/);
    assert.equal(/没有技能/.test(got.markdown), false);
    const { registry } = setsOf(parent);
    const set = buildContentSet({ registry, ids: ['rose-rank'] });
    assert.deepEqual(set.problems, [], JSON.stringify(set.problems));
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('--out basename is the record namespace', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-forge-out-'));
  try {
    const got = await importForge(path.join(FIXTURES, 'numbers-pack'), { ...forgeOpts(parent), out: path.join(parent, 'renamed-pack') });
    assert.equal(got.ok, true, got.markdown);
    assert.equal(got.issues.some((i) => i.code === 'PLUGIN_RECORD_ID'), false);
    const op = JSON.parse(fs.readFileSync(path.join(parent, 'renamed-pack', 'operators', 'imported.json'), 'utf8'));
    assert.match(op.charId, /^char_x_renamed_pack_/);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('a.png and files/a.png stay distinct; case and prefix collisions are refused', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-forge-names-'));
  const pack = path.join(parent, 'pack');
  const other = Buffer.concat([PNG, Buffer.from([1])]);
  writePack(pack, {
    id: 'rose-files', name: '双路径', version: '1.0.0', license: 'CC0-1.0', content: [],
    art: { chars: { char_rose_file: { avatar: 'a.png', portrait: 'files/a.png' } } },
  }, { 'a.png': PNG, 'files/a.png': other });
  const caseZip = zipOf([
    { name: 'pack.json', data: Buffer.from('{"id":"rose-case","name":"c","version":"1.0.0"}') },
    { name: 'Art.png', data: PNG },
    { name: 'art.png', data: other },
  ]);
  const prefixZip = zipOf([
    { name: 'pack.json', data: Buffer.from('{"id":"rose-prefix","name":"p","version":"1.0.0"}') },
    { name: 'a', data: Buffer.from('file') },
    { name: 'a/b.png', data: PNG },
  ]);
  try {
    const got = await importForge(pack, { ...forgeOpts(parent), out: path.join(parent, 'rose-files') });
    assert.equal(got.ok, true, got.markdown);
    const avatar = fs.readFileSync(path.join(parent, 'rose-files', 'files', 'a.png'));
    const portrait = fs.readFileSync(path.join(parent, 'rose-files', 'files', 'files', 'a.png'));
    assert.ok(avatar.equals(PNG));
    assert.ok(portrait.equals(other));
    const cased = await importForge({ zip: caseZip }, forgeOpts(parent));
    assert.equal(cased.ok, false);
    assert.equal(cased.issues[0].code, 'PLUGIN_FORGE_ZIP');
    assert.match(cased.issues[0].detail, /case/);
    const prefixed = await importForge({ zip: prefixZip }, forgeOpts(parent));
    assert.equal(prefixed.ok, false);
    assert.equal(prefixed.issues[0].code, 'PLUGIN_FORGE_ZIP');
    assert.match(prefixed.issues[0].detail, /prefix/);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('an override array is one set; talents stay an index merge', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-forge-arr-'));
  const range = path.join(parent, 'range');
  const talents = path.join(parent, 'talents');
  writePack(range, {
    id: 'rose-range', name: '范围', version: '1.0.0', license: 'CC0-1.0', content: ['chess'],
    overrides: ['chess:chess_char_1_01_a'],
  }, { 'chess.json': JSON.stringify({ chess_char_1_01_a: { rangeGrid: [[1, 0]] } }) });
  writePack(talents, {
    id: 'rose-talents', name: '天赋', version: '1.0.0', license: 'CC0-1.0', content: ['chess'],
    overrides: ['chess:chess_char_1_01_a'],
  }, { 'chess.json': JSON.stringify({ chess_char_1_01_a: { talents: [{ name: '探' }] } }) });
  try {
    const grid = await importForge(range, { ...forgeOpts(parent), out: path.join(parent, 'rose-range') });
    assert.match(grid.markdown, /chess:chess_char_1_01_a → 1 set/);
    assert.equal(/没有类型对得上的字段/.test(grid.markdown), false);
    if (grid.ok) {
      const patch = JSON.parse(fs.readFileSync(path.join(parent, 'rose-range', 'data', 'patch.json'), 'utf8'));
      const ops = patch.ops.filter((o) => o.id === 'chess_char_1_01_a' && o.path.join('.') === 'rangeGrid');
      assert.equal(ops.length, 1);
      assert.equal(ops[0].op, 'set');
      assert.deepEqual(ops[0].value, [[1, 0]]);
    }
    const talent = await importForge(talents, { ...forgeOpts(parent), out: path.join(parent, 'rose-talents') });
    assert.match(talent.markdown, /数组「talents」要按 index 合并/);
    assert.equal(/没有类型对得上的字段/.test(talent.markdown), false);
    assert.equal(/类型对不上/.test(talent.markdown), false);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('voices and skill icons follow the new char and skill ids', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-forge-voice-'));
  const pack = path.join(parent, 'pack');
  writePack(pack, {
    id: 'rose-voice', name: '语音', version: '1.0.0', license: 'CC0-1.0', content: ['units'], operators: {},
    voices: { rose_guard: { select: 'voice/select.mp3' } },
    art: { skills: { original_skill: 'icons/skill.png' } },
  }, {
    'voice/select.mp3': MP3,
    'icons/skill.png': PNG,
    'units.json': JSON.stringify({
      rose_guard: {
        name: '玫瑰守卫', rarity: 4, profession: 'DEFENDER', subProfessionId: 'protector', position: 'MELEE',
        bonds: ['deputShip'],
        forms: {
          '0': { stats: { maxHp: 2000, atk: 200, def: 200, bat: 1.2 }, rangeGrid: [[0, 0]], skills: [{ name: '守御', skillId: 'original_skill', default: true, duration: 10, spCost: 20, initSp: 5 }] },
          '2': { stats: { maxHp: 3000, atk: 300, def: 300, bat: 1.2 }, rangeGrid: [[0, 0]] },
        },
      },
    }),
  });
  try {
    const got = await importForge(pack, { ...forgeOpts(parent), out: path.join(parent, 'rose-voice') });
    assert.equal(got.ok, true, got.markdown);
    const op = JSON.parse(fs.readFileSync(path.join(parent, 'rose-voice', 'operators', 'imported.json'), 'utf8'));
    const assets = JSON.parse(fs.readFileSync(path.join(parent, 'rose-voice-look', 'assets.json'), 'utf8'));
    const skillId = op.forms.normal.skills[0].skillId;
    assert.equal(op.skills[0].skillId, skillId);
    assert.ok(assets.skills[skillId], JSON.stringify(Object.keys(assets.skills)));
    assert.equal(assets.skills.original_skill, undefined);
    assert.ok(assets.audio.voiceJp[op.charId], JSON.stringify(Object.keys(assets.audio.voiceJp)));
    assert.equal(assets.audio.voiceJp.rose_guard, undefined);
    assert.equal(fs.existsSync(path.join(parent, 'rose-voice-look')), true);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('a dependency on an installed plugin is visible; a missing one is named', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-forge-dep-'));
  const base = path.join(parent, 'base');
  const dep = path.join(parent, 'dep');
  const missing = path.join(parent, 'missing');
  const art = { 'chars/texas/avatar.png': PNG, 'voice/select.mp3': MP3 };
  writePack(base, {
    id: 'base-skin', name: '底', version: '1.0.0', license: 'CC0-1.0', content: [],
    art: { chars: { char_102_texas: { avatar: 'chars/texas/avatar.png' } } },
    voices: { char_102_texas: { select: 'voice/select.mp3' } },
  }, art);
  writePack(dep, {
    id: 'dep-skin', name: '依', version: '1.0.0', license: 'CC0-1.0', content: [], dependencies: ['base-skin'],
    art: { chars: { char_rose_dep: { avatar: 'chars/texas/avatar.png' } } },
    voices: { char_rose_dep: { select: 'voice/select.mp3' } },
  }, art);
  writePack(missing, {
    id: 'miss-skin', name: '缺', version: '1.0.0', license: 'CC0-1.0', content: [], dependencies: ['missing-plugin'],
    art: { chars: { char_rose_miss: { avatar: 'chars/texas/avatar.png' } } },
    voices: { char_rose_miss: { select: 'voice/select.mp3' } },
  }, art);
  try {
    const first = await importForge(base, { ...forgeOpts(parent), out: path.join(parent, 'base-skin') });
    assert.equal(first.ok, true, first.markdown);
    const second = await importForge(dep, { ...forgeOpts(parent), out: path.join(parent, 'dep-skin') });
    assert.equal(second.ok, true, second.markdown);
    assert.ok(fs.existsSync(path.join(parent, 'dep-skin', 'plugin.json')));
    const third = await importForge(missing, { ...forgeOpts(parent), out: path.join(parent, 'miss-skin') });
    assert.equal(third.ok, false, third.markdown);
    assert.match(third.issues.map((i) => i.detail).join('\n'), /missing-plugin/);
    assert.match(third.issues.map((i) => i.detail).join('\n'), /not available/);
    assert.equal(fs.existsSync(path.join(parent, 'miss-skin')), false);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('a 6★ declared in operators is diy and is not a visible shop chess', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-forge-diy-'));
  const pack = path.join(parent, 'pack');
  writePack(pack, {
    id: 'rose-ace', name: '王牌', version: '1.0.0', license: 'CC0-1.0', content: ['units'],
    operators: { rose_ace: { bonds: ['deputShip'] } },
  }, {
    'units.json': JSON.stringify({
      rose_ace: {
        name: '玫瑰王牌', rarity: 6, profession: 'GUARD', subProfessionId: 'sword', position: 'MELEE',
        bonds: ['deputShip'],
        forms: {
          '0/1/1/0': { stats: { maxHp: 1500, atk: 400, def: 100, bat: 1 }, rangeGrid: [[0, 0]], skills: [{ name: '斩', skillId: 'ace_skill', default: true, duration: 10, spCost: 30, initSp: 10 }] },
          '2/80/7/0': { stats: { maxHp: 2800, atk: 700, def: 150, bat: 1 }, rangeGrid: [[0, 0]], skills: [{ name: '斩', skillId: 'ace_skill', default: true, duration: 12, spCost: 30, initSp: 15 }] },
        },
      },
    }),
  });
  try {
    const got = await importForge(pack, { ...forgeOpts(parent), out: path.join(parent, 'rose-ace') });
    assert.equal(got.ok, true, got.markdown);
    const op = JSON.parse(fs.readFileSync(path.join(parent, 'rose-ace', 'operators', 'imported.json'), 'utf8'));
    assert.equal(op.as, 'diy');
    assert.equal(op.profession, 'WARRIOR');
    assert.deepEqual(op.chess.bonds, ['deputShip']);
    assert.equal(op.chess.tier, 6);
    const { registry } = setsOf(parent);
    const set = buildContentSet({ registry, ids: ['rose-ace'] });
    assert.deepEqual(set.problems, [], JSON.stringify(set.problems));
    const shop = Object.values(set.data.chess).filter((c) => c.backup?.charId === op.charId && c.visible && !c.isDiy && !c.isHidden);
    assert.equal(shop.length, 0);
    assert.ok(set.data.backups.diy.ownedPool.includes(op.charId));
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('a hard link into the pack is refused, and empty directories count toward the file cap', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-forge-link-'));
  const outside = path.join(parent, 'outside.bin');
  fs.writeFileSync(outside, 'OUTSIDE BYTES');
  const pack = path.join(parent, 'pack');
  writePack(pack, {
    id: 'rose-hard', name: '硬链', version: '1.0.0', license: 'CC0-1.0', content: [],
    voices: { char_102_texas: { select: 'a.mp3' } },
  }, {});
  fs.linkSync(outside, path.join(pack, 'a.mp3'));
  const empties = path.join(parent, 'empties');
  fs.mkdirSync(empties);
  fs.writeFileSync(path.join(empties, 'pack.json'), '{"id":"rose-empties","name":"e","version":"1.0.0"}');
  for (let i = 0; i < 5001; i++) fs.mkdirSync(path.join(empties, `d${i}`));
  try {
    const linked = await importForge(pack, { ...forgeOpts(parent), out: path.join(parent, 'rose-hard') });
    assert.equal(linked.ok, false);
    assert.equal(linked.issues[0].code, 'PLUGIN_FORGE_ZIP');
    assert.match(linked.issues[0].detail, /hard link/);
    assert.equal(fs.existsSync(path.join(parent, 'rose-hard')), false);
    assert.equal(walk(parent).some((f) => fs.readFileSync(path.join(parent, f)).includes('OUTSIDE BYTES') && f !== 'outside.bin' && f !== 'pack/a.mp3'), false);
    const many = await importForge(empties, forgeOpts(parent));
    assert.equal(many.ok, false);
    assert.equal(many.issues[0].code, 'PLUGIN_FORGE_ZIP');
    assert.match(many.issues[0].detail, /more than 5000 files/);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('a sparse zip over the raw cap is refused before it is read', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-forge-sparse-'));
  const zipPath = path.join(parent, 'big.zip');
  const fd = fs.openSync(zipPath, 'w');
  fs.ftruncateSync(fd, 201 * 1024 * 1024);
  fs.closeSync(fd);
  const real = fs.readFileSync;
  let reads = 0;
  fs.readFileSync = (p, ...args) => {
    if (typeof p === 'string' && path.resolve(p) === path.resolve(zipPath)) reads += 1;
    return real(p, ...args);
  };
  try {
    const t0 = Date.now();
    const got = await importForge(zipPath, forgeOpts(parent));
    assert.equal(got.ok, false);
    assert.equal(got.issues[0].code, 'PLUGIN_FORGE_ZIP');
    assert.match(got.issues[0].detail, /larger than/);
    assert.equal(reads, 0);
    assert.ok(Date.now() - t0 < 2000, `took ${Date.now() - t0}ms`);
  } finally {
    fs.readFileSync = real;
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test('ZIP64 magic inside a stored entry is not ZIP64; a locator before the EOCD still is', async () => {
  const payload = Buffer.concat([Buffer.from('hello '), Buffer.from([0x50, 0x4b, 0x06, 0x06]), Buffer.from(' tail')]);
  const zip = zipOf([
    { name: 'pack.json', data: Buffer.from('{"id":"rose-bytes","name":"b","version":"1.0.0"}') },
    { name: 'note.bin', data: payload },
  ]);
  const files = await readUntrustedZip(zip);
  assert.ok(files.get('note.bin').equals(payload));
  const eocd = zip.subarray(zip.length - 22);
  const head = zip.subarray(0, zip.length - 22);
  const loc = Buffer.alloc(20);
  loc.writeUInt32LE(0x07064b50, 0);
  await assert.rejects(readUntrustedZip(Buffer.concat([head, loc, eocd])), (e) => e.code === 'PLUGIN_FORGE_ZIP' && /ZIP64/.test(e.detail));
  await assert.rejects(readUntrustedZip(zipOf([
    { name: 'pack.json', data: Buffer.from('{"id":"rose-dir","name":"d","version":"1.0.0"}') },
    { name: '../secret/', data: Buffer.alloc(0) },
  ])), (e) => e.code === 'PLUGIN_FORGE_ZIP' && /path escapes/.test(e.detail));
});

// ---- round 43: chess.json pairs, official kits, kits/<id>.js → a sandboxed script plugin ------------------------------

const STATS_A = { maxHp: 1000, atk: 400, def: 100, res: 0, cost: 12, blockCnt: 1, bat: 1, aspd: 100, respawnTime: 70 };
const STATS_B = { ...STATS_A, maxHp: 1400, atk: 500, def: 120 };

/** One Forge chess pair (`_a` normal, `_b` elite) with made-up numbers; `both` patches both records, `a`/`b` one. */
function pairOf(stem, { both = {}, a = {}, b = {} } = {}) {
  const base = { baseId: `chess_${stem}_a`, goldenId: `chess_${stem}_b`, tier: 3, rarity: 4, name: '玫瑰猎手', charId: null,
    profession: 'SNIPER', subProfessionId: 'fastshot', position: 'RANGED', bonds: ['deputShip'], price: 3, sellPrice: 1,
    assets: { avatar: 'char_102_texas' }, rangeGrid: [[0, 0], [0, 1], [0, 2]],
    skills: [{ skillId: `sk_${stem}`, name: '瞄准', skillType: 'MANUAL', durationType: 'NONE', spType: 'INCREASE_WITH_TIME', duration: 10, spCost: 40, initSp: 0, bb: { atk: 0.3 }, isDefault: true }],
    ...both };
  return {
    [`chess_${stem}_a`]: { chessId: `chess_${stem}_a`, isGolden: false, stats: STATS_A, ...base, ...a },
    [`chess_${stem}_b`]: { chessId: `chess_${stem}_b`, isGolden: true, stats: STATS_B, ...base, ...b },
  };
}

/** The kit of the round-43 pack: an SDK helper, a file of the pack, and a permanent +25% ATK talent. */
const KIT_SOURCE = `// a Forge-style kit written for this test
import { num } from '@kit/tier1.js';
import { bonus } from './lib/bonus.js';
import { dirVec, offsetTile } from '@sim/dir.js';
import { absoluteRangeKeys } from '@sim/targeting.js';

export default function kit(bb) {
  const v = dirVec('UP'), tile = offsetTile(2, 2, 0, 1, 'UP');
  const keys = absoluteRangeKeys([[0, 0]], 2, 2, 'UP');
  if (v[0] !== 1 || tile[0] !== 3 || keys.length !== 1 || !Object.isFrozen(v) || !Object.isFrozen(tile) || !Object.isFrozen(keys)) throw new Error('geometry facade');
  return {
    skill: { kind: 'duration', duration: 10, mods: { atkPct: num(bb.atk, 0) } },
    talents: [{ install(battle, unit) { battle.addBuff(unit, { key: 'rose:resolve', mods: { atkPct: bonus() }, persist: true, allowDead: true }); } }],
  };
}
`;
const KIT_HELPER = 'export const bonus = () => 0.25;\n';

function kitPack(dir, { kits = { 'kits/chess_rose_hunter_a.js': KIT_SOURCE, 'kits/lib/bonus.js': KIT_HELPER }, pack = {}, chess = pairOf('rose_hunter') } = {}) {
  writePack(dir, { id: 'rose-kit', name: '玫瑰行为', version: '1.0.0', license: 'CC0-1.0', content: ['chess'], ...pack },
    { ...(chess ? { 'chess.json': JSON.stringify(chess) } : {}), ...kits });
}

const opsOf = (dir) => {
  const doc = JSON.parse(fs.readFileSync(path.join(dir, 'operators', 'imported.json'), 'utf8'));
  return Array.isArray(doc) ? doc : [doc];
};

test('chess.json pairs become compact records: a shop piece and a 自选 piece; unknown characters and dropped fields are named', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-forge-chess-'));
  const pack = path.join(parent, 'pack');
  const skill = { skillId: 'sk_rose_pair', name: '连射', skillType: 'AUTO', spType: 'INCREASE_WHEN_ATTACK', durationType: 'NONE', duration: 0,
    spCost: 4, initSp: 0, maxChargeTime: 1, increment: 1, trigger: { rule: 'SP_FULL', rawRule: 'SP_FULL', customRangeGrid: null },
    bb: { atk_scale: 1.5 }, isDefault: true, prefabId: 'sk_rose_prefab', rangeId: '1-1', index: 0, level: 4 };
  writePack(pack, { id: 'rose-chess', name: '玫瑰棋子', version: '1.0.0', license: 'CC0-1.0', content: ['chess'] }, {
    'chess.json': JSON.stringify({
      ...pairOf('rose_pair', {
        both: { charId: 'char_102_texas', tier: 2, skills: [skill], identifier: 7, shopSortId: 3, chessType: 'NORMAL', upgradeNum: 2,
          module: { id: 'uniequip_rose', active: false }, potDown: { 0: { 'stats.cost': 11 } }, statsBase: { atk: 380 },
          trait: { desc: '优先攻击空中单位', bb: { value: 7 } },
          talents: [{ index: 0, name: '玫瑰', bb: { atk: 0.1 }, tokenKey: null, fromModule: false }, { index: -1, fromModule: true, bb: { attack_speed: 5 } }] },
        a: { garrisonIds: ['garrison_01_a'], status: { phase: 9, level: 9, skillLevel: 9, equipLevel: 0 } },
        b: { garrisonIds: ['garrison_01_b'] },
      }),
      ...pairOf('rose_ace', { both: { charId: 'char_102_texas', isDiy: true, visible: false, rarity: 6, tier: 6, name: '玫瑰王牌' } }),
      ...pairOf('rose_ghost', { both: { charId: 'char_rose_nobody', name: '玫瑰幽灵' } }),
    }),
  });
  try {
    const got = await importForge(pack, { ...forgeOpts(parent), out: path.join(parent, 'rose-chess') });
    assert.equal(got.ok, true, got.markdown);
    const ops = opsOf(path.join(parent, 'rose-chess'));
    const piece = ops.find((o) => o.charId === 'char_x_rose_chess_rose_pair');
    const ace = ops.find((o) => o.charId === 'char_x_rose_chess_rose_ace');
    assert.equal(ops.length, 2, JSON.stringify(ops.map((o) => o.charId)));
    assert.equal(piece.as, 'chess');
    assert.deepEqual(piece.chess, { tier: 2, bonds: ['deputShip'], price: 3, sellPrice: 1, garrisonIds: { normal: ['garrison_01_a'], golden: ['garrison_01_b'] }, identifier: 7, shopSortId: 3, ids: { normal: 'chess_x_rose_chess_rose_pair_a', elite: 'chess_x_rose_chess_rose_pair_b' } });
    assert.deepEqual(piece.art, { ref: 'char_102_texas', assets: { avatar: 'char_102_texas', avatarGolden: 'char_102_texas' } });
    assert.deepEqual(piece.origin, { charId: 'char_102_texas' });
    assert.equal(piece.kit, 'generic');
    const s = piece.forms.normal.skills[0];
    assert.match(s.skillId, /^skx_rose_chess_/);
    assert.equal(s.default, true);
    assert.deepEqual([s.skillType, s.spType, s.durationType, s.maxChargeTime, s.trigger.rule], ['AUTO', 'INCREASE_WHEN_ATTACK', 'NONE', 1, 'SP_FULL']);
    assert.equal(s.prefabId, undefined);
    assert.equal(piece.forms.normal.talents.length, 1);
    assert.deepEqual(piece.forms.normal.talents[0].bb, { atk: 0.1 });
    assert.deepEqual(piece.forms.elite.trait.bb, { value: 7 });
    assert.equal(piece.forms.elite.stats.atk, STATS_B.atk);
    assert.equal(ace.as, 'diy');
    for (const word of ['module', 'potDown', 'statsBase', 'talents(module)', 'skills.prefabId', 'skills.rangeId', '#status', '#upgradeNum', 'char_rose_nobody']) {
      assert.ok(got.markdown.includes(word), word);
    }
    assert.equal(got.markdown.includes('skills.index'), false);
    assert.equal(got.report.partial, true);
    assert.equal(got.report.dropped.operators, 1);
    assert.ok(got.report.assumed.some((a) => a.what === 'chess-preset'));
    const check = await quiet(['check', path.join(parent, 'rose-chess'), '--strict', '--root', ROOT]);
    assert.equal(check.code, 0, check.out);
    const { registry } = setsOf(parent);
    const set = buildContentSet({ registry, ids: ['rose-chess'] });
    assert.deepEqual(set.problems, [], JSON.stringify(set.problems));
    assert.deepEqual(set.data.chess.chess_x_rose_chess_rose_pair_a.garrisonIds, ['garrison_01_a']);
    assert.deepEqual(set.data.chess.chess_x_rose_chess_rose_pair_b.garrisonIds, ['garrison_01_b']);
    assert.equal(set.data.chess.chess_x_rose_chess_rose_pair_a.skill.spType, 'INCREASE_WHEN_ATTACK');
    assert.ok(set.data.backups.diy.ownedPool.includes(ace.charId));
    assert.equal(Object.values(set.data.chess).some((c) => c.backup?.charId === ace.charId && !c.isDiy), false);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('a pack unit whose shop piece is a chess pair is written once, as that pair; no bond at all gets the fallback bond', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-forge-body-'));
  const pack = path.join(parent, 'pack');
  writePack(pack, { id: 'rose-body', name: '玫瑰身体', version: '1.0.0', license: 'CC0-1.0', content: ['units', 'chess'] }, {
    'units.json': JSON.stringify({ rose_body: { name: '玫瑰身体', rarity: 4, profession: 'SNIPER', subProfessionId: 'fastshot', bonds: ['deputShip'],
      forms: { 0: { stats: STATS_A, rangeGrid: [[0, 0]], skills: [{ skillId: 'sk_body', name: '身体', default: true, duration: 5, spCost: 10, initSp: 0 }] } } } }),
    'chess.json': JSON.stringify(pairOf('rose_body', { both: { charId: 'rose_body', bonds: [] } })),
  });
  try {
    const got = await importForge(pack, { ...forgeOpts(parent), out: path.join(parent, 'rose-body') });
    assert.equal(got.ok, true, got.markdown);
    const ops = opsOf(path.join(parent, 'rose-body'));
    assert.deepEqual(ops.map((o) => o.charId), ['char_x_rose_body_rose_body']);
    assert.deepEqual(ops[0].chess.bonds, ['emptyShip']);
    assert.match(got.markdown, /Its shop piece is the chess\.json pair chess_rose_body_a/);
    assert.equal(got.report.partial, undefined);
    assert.ok(got.report.assumed.some((a) => a.what === 'chess-fallback-bond'));
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('official skills of one operator keep their ids and bind that operator\'s kit, for a 自选 unit and a shop pair', async (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-forge-official-'));
  const ops = path.join(parent, 'ops');
  const clem = (n) => ['skchr_clemnt_1', 'skchr_clemnt_2', 'skchr_clemnt_3'].map((skillId, i) => ({ skillId, name: `技能${i + 1}`, skillType: i ? 'MANUAL' : 'AUTO',
    spType: i ? 'INCREASE_WITH_TIME' : 'INCREASE_WHEN_ATTACK', durationType: 'NONE', duration: 10 + n, spCost: 20 + i, initSp: 0, bb: { atk: 0.2 + i / 10 }, isDefault: i === 0 }));
  const talents = [{ index: 0, name: '一', bb: { prob_normal: 0.2 } }, { index: 1, name: '二', bb: { damage_resistance_normal: 0.3 } }];
  writePack(ops, { id: 'rose-sea', name: '海', version: '1.0.0', license: 'CC0-1.0', content: ['units', 'chess'], operators: { char_rose_sea: { bonds: ['egirShip'], powers: ['egir'] } } }, {
    'units.json': JSON.stringify({ char_rose_sea: { charId: 'char_rose_sea', name: '海的女儿', rarity: 6, profession: 'WARRIOR', subProfessionId: 'primguard', position: 'MELEE',
      forms: { '2/1/4/0': { stats: STATS_A, rangeGrid: [[0, 0], [0, 1]], skills: clem(0), talents }, '2/60/7/3': { stats: STATS_B, rangeGrid: [[0, 0], [0, 1]], skills: clem(5), talents } } } }),
    'chess.json': JSON.stringify(pairOf('rose_saint', { both: { charId: 'char_1032_excu2', tier: 5, rarity: 6, profession: 'WARRIOR', subProfessionId: 'reaper', position: 'MELEE',
      skills: ['skchr_excu2_1', 'skchr_excu2_2', 'skchr_excu2_3'].map((skillId) => ({ skillId, name: skillId, duration: 10, spCost: 30, initSp: 10, bb: {}, isDefault: skillId === 'skchr_excu2_2' })) } })),
  });
  try {
    const got = await importForge(ops, { ...forgeOpts(parent), out: path.join(parent, 'rose-sea') });
    assert.equal(got.ok, true, got.markdown);
    const records = opsOf(path.join(parent, 'rose-sea'));
    const sea = records.find((o) => o.charId === 'char_x_rose_sea_char_rose_sea');
    const saint = records.find((o) => o.charId === 'char_x_rose_sea_rose_saint');
    assert.deepEqual(sea.kit, { ref: 'char_4231_clemnt' });
    assert.equal(sea.as, 'diy');
    assert.deepEqual(sea.forms.elite.skills.map((s) => s.skillId), ['skchr_clemnt_1', 'skchr_clemnt_2', 'skchr_clemnt_3']);
    assert.equal(sea.forms.normal.skills[0].default, true);
    assert.equal(sea.forms.normal.talents.length, 2);
    assert.deepEqual(saint.kit, { ref: 'chess_char_5_01_a' });
    assert.deepEqual(saint.skills.map((s) => s.skillId), ['skchr_excu2_1', 'skchr_excu2_2', 'skchr_excu2_3']);
    assert.match(got.markdown, /char_4231_clemnt/);
    assert.equal(got.markdown.includes('units:char_rose_sea#kit'), false);
    const { registry } = setsOf(parent);
    const set = buildContentSet({ registry, ids: ['rose-sea'] });
    assert.deepEqual(set.problems, [], JSON.stringify(set.problems));
    setGameData(set.data);
    t.after(() => setGameData(null));
    const diy = makeBattle({ data: new DataSource(set.data), units: [{ diy: { slot: 6, charId: sea.charId, skillIndex: 0 }, row: 10, col: 5 }] });
    diy.step();
    const u = diy.allies()[0];
    assert.equal(u.kit.generic, undefined);
    assert.equal(u.kit.skillSource, 'skills');
    checkInvariants(diy.b);
    const shop = makeBattle({ data: new DataSource(set.data), units: [{ chessId: 'chess_x_rose_sea_rose_saint_a', row: 10, col: 5 }] });
    shop.step();
    assert.equal(shop.allies()[0].kit.generic, undefined);
    checkInvariants(shop.b);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('a partial or ambiguous official match keeps the generic kit and the report says which skills and why', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-forge-partial-'));
  const pack = path.join(parent, 'pack');
  const excu = (def) => ['skchr_excu2_1', 'skchr_excu2_2', 'skchr_excu2_3'].map((skillId) => ({ skillId, name: skillId, duration: 10, spCost: 30, initSp: 10, isDefault: skillId === def }));
  writePack(pack, { id: 'rose-part', name: '半', version: '1.0.0', license: 'CC0-1.0', content: ['chess'] }, {
    'chess.json': JSON.stringify({
      ...pairOf('rose_half', { both: { charId: 'char_1032_excu2', skills: [{ skillId: 'skchr_excu2_1', name: '一', duration: 5, spCost: 9, initSp: 0, isDefault: true }, { skillId: 'sk_rose_new', name: '新', duration: 5, spCost: 9, initSp: 0 }] } }),
      ...pairOf('rose_turn', { both: { charId: 'char_1032_excu2', tier: 5, skills: excu('skchr_excu2_1') } }),
      ...pairOf('rose_common', { both: { charId: 'char_102_texas', skills: [{ skillId: 'skcom_atk_up[3]', name: '强化', duration: 5, spCost: 9, initSp: 0, isDefault: true }] } }),
    }),
  });
  try {
    const got = await importForge(pack, { ...forgeOpts(parent), out: path.join(parent, 'rose-part') });
    assert.equal(got.ok, true, got.markdown);
    const records = opsOf(path.join(parent, 'rose-part'));
    for (const o of records) assert.equal(o.kit, 'generic', o.charId);
    for (const o of records) for (const sk of o.skills) assert.match(sk.skillId, /^skx_rose_part_/);
    const kitLine = (stem) => got.report.skipped.find((s) => s.path === `chess:chess_${stem}_a#kit`)?.en || '';
    assert.match(kitLine('rose_half'), /sk_rose_new are not official skill ids/);
    assert.match(kitLine('rose_turn'), /default skill skchr_excu2_1 differs from skchr_excu2_2/);
    assert.match(kitLine('rose_common'), /several operators/);
    const { registry } = setsOf(parent);
    assert.deepEqual(buildContentSet({ registry, ids: ['rose-part'] }).problems, []);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('kits/<id>.js becomes one script plugin: SDK imports rewritten, the pack\'s ./ file carried, the registry\'s script check passed', async () => {
  fs.rmSync(BAIT, { force: true });
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-forge-kit-'));
  const pack = path.join(parent, 'pack');
  kitPack(pack);
  try {
    const got = await importForge(pack, { ...forgeOpts(parent), out: path.join(parent, 'rose-kit') });
    assert.equal(got.ok, true, got.markdown);
    assert.deepEqual(dirsOf(parent).filter((n) => n !== 'pack').sort(), ['kits-rose-kit', 'rose-kit']);
    const dir = path.join(parent, 'kits-rose-kit');
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8'));
    assert.equal(manifest.class, 'script');
    assert.deepEqual(manifest.scope, ['room']);
    assert.deepEqual(manifest.permissions, ['sim.code']);
    assert.deepEqual(manifest.entry, { sim: 'sim/index.js' });
    assert.deepEqual(manifest.requires, { 'rose-kit': '1.0.0' });
    assert.equal(manifest.overrides, undefined);
    const source = fs.readFileSync(path.join(dir, 'sim', 'index.js'), 'utf8');
    assert.deepEqual(checkScript(source).problems, []);
    assert.match(source, /^import \{ kit as __forgeKit, dir as __forgeDir, targeting as __forgeTargeting \} from 'sp:sdk@1';$/m);
    assert.match(source, /const num = __forgeKit\["num"\];/);
    assert.match(source, /\/\/ ---- kits\/lib\/bonus\.js ----/);
    assert.match(source, /sp\.kits\.register\("char_x_rose_kit_rose_hunter", __forgeModule1\["default"\]\);/);
    assert.equal(/from '@kit|from '\.\//.test(source), false);
    assert.deepEqual(walk(dir).sort(), ['README.md', 'plugin.json', 'plugin.lock.json', 'sim/index.js']);
    assert.equal(opsOf(path.join(parent, 'rose-kit'))[0].kit, 'generic');
    const product = got.report.products.find((p) => p.id === 'kits-rose-kit');
    assert.deepEqual(product.rewritten, ['@kit/tier1.js { num } → sp:sdk@1 kit.num', '@sim/dir.js { dirVec } → sp:sdk@1 dir.dirVec', '@sim/dir.js { offsetTile } → sp:sdk@1 dir.offsetTile', '@sim/targeting.js { absoluteRangeKeys } → sp:sdk@1 targeting.absoluteRangeKeys']);
    assert.match(product.imported[0], /kits\/chess_rose_hunter_a\.js → sim\/index\.js · sp\.kits\.register\("char_x_rose_kit_rose_hunter"\).* \+ kits\/lib\/bonus\.js/);
    const report = fs.readFileSync(path.join(parent, 'rose-kit', 'IMPORT-REPORT.md'), 'utf8');
    assert.match(report, /SP_PLUGIN_SCRIPTS=sandbox/);
    assert.match(report, /`kits-rose-kit`/);
    for (const id of ['rose-kit', 'kits-rose-kit']) {
      const check = await quiet(['check', path.join(parent, id), '--strict', '--root', ROOT]);
      assert.equal(check.code, 0, `${id}\n${check.out}`);
    }
    const registry = createPluginRegistry({ publicDir: path.join(ROOT, 'public'), packsDir: path.join(ROOT, 'packs'), pluginsDir: parent, dataDir: path.join(ROOT, 'data') },
      { scriptMode: 'sandbox', recheckMs: 0, log: { info() {}, warn() {} } });
    const plugin = registry.plugin('kits-rose-kit');
    assert.equal(plugin.status, 'loaded');
    assert.equal(plugin.script.lockValid, true);
    assert.equal(plugin.script.sandboxable, true);
    assert.equal(fs.existsSync(BAIT), false);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('a kit whose import does not map, that fails the script check, or uses syntax the sandbox refuses is named and not written; nothing runs', async () => {
  fs.rmSync(BAIT, { force: true });
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-forge-kitbad-'));
  const pack = path.join(parent, 'pack');
  kitPack(pack, {
    chess: { ...pairOf('rose_dir'), ...pairOf('rose_fs'), ...pairOf('rose_date'), ...pairOf('rose_async'), ...pairOf('rose_tier') },
    kits: {
      'kits/chess_rose_dir_a.js': "import { sortEnemyTargets } from '@sim/targeting.js';\nexport default function kit() { return { skill: null, x: sortEnemyTargets }; }\n",
      'kits/chess_rose_fs_a.js': `import { writeFileSync } from 'node:fs';\nwriteFileSync('${BAIT}', 'executed\\n');\nexport default function kit() { return {}; }\n`,
      'kits/chess_rose_date_a.js': 'export default function kit() { return { skill: { kind: "passive", mods: { atkPct: Date.now() % 2 } } }; }\n',
      'kits/chess_rose_async_a.js': 'export default async function kit() { return {}; }\n',
      'kits/chess_rose_tier_a.js': "import { selectedId } from '@kit/tier3.js';\nexport default function kit() { return { x: selectedId }; }\n",
      'kits/chess_rose_nobody_a.js': 'export default function kit() { return {}; }\n',
    },
  });
  try {
    const got = await importForge(pack, { ...forgeOpts(parent), out: path.join(parent, 'rose-kit') });
    assert.equal(got.ok, true, got.markdown);
    assert.deepEqual(dirsOf(parent).filter((n) => n !== 'pack'), ['rose-kit']);
    const reason = (file) => got.report.skipped.find((s) => s.path === file);
    assert.match(reason('kits/chess_rose_dir_a.js').en, /sortEnemyTargets mutates the candidate array/);
    assert.match(reason('kits/chess_rose_fs_a.js').en, /"node:fs"/);
    assert.match(reason('kits/chess_rose_date_a.js').en, /fails the script check \(Date is not available in sp:sdk@1\)/);
    assert.match(reason('kits/chess_rose_async_a.js').en, /an async function/);
    assert.match(reason('kits/chess_rose_tier_a.js').en, /"@kit\/tier3\.js"/);
    assert.match(reason('kits/chess_rose_nobody_a.js').en, /not an imported chess or operator record/);
    for (const file of ['kits/chess_rose_dir_a.js', 'kits/chess_rose_fs_a.js', 'kits/chess_rose_date_a.js', 'kits/chess_rose_async_a.js']) {
      assert.equal(reason(file).code, 'PLUGIN_FORGE_SCRIPT', file);
      assert.match(reason(file).zh, /导入时不执行它/);
    }
    assert.equal(walk(path.join(parent, 'rose-kit')).some((f) => f.endsWith('.js')), false);
    assert.equal(fs.existsSync(BAIT), false);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
    fs.rmSync(BAIT, { force: true });
  }
});

test('--no-scripts (and the studio\'s noScripts) leaves the script plugin out and names the kit', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-forge-noscripts-'));
  const pack = path.join(parent, 'pack');
  kitPack(pack);
  try {
    const r = await quiet(['import-forge', pack, '--out', path.join(parent, 'out', 'rose-kit'), '--root', ROOT, '--json', '--no-scripts']);
    assert.equal(r.code, 0, r.out);
    const report = JSON.parse(r.out);
    assert.deepEqual(report.products.map((p) => p.id), ['rose-kit']);
    const line = report.skipped.find((s) => s.path === 'kits/chess_rose_hunter_a.js');
    assert.equal(line.code, 'PLUGIN_FORGE_SCRIPT');
    assert.match(line.en, /^--no-scripts: no script plugin was written/);
    assert.deepEqual(dirsOf(path.join(parent, 'out')), ['rose-kit']);
    const dry = await importForge(pack, { ...forgeOpts(parent), dryRun: true, scripts: false });
    assert.deepEqual(dry.report.products.map((p) => p.class), ['content']);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('a kit for an official id needs the pack\'s overrides; with it the script plugin lists that kit in overrides', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-forge-override-'));
  const pack = path.join(parent, 'pack');
  const kit = 'export default function kit() { return { skill: { kind: "passive", mods: { atkPct: 0.1 } } }; }\n';
  kitPack(pack, { pack: { id: 'rose-over', content: [], overrides: ['chess:chess_char_1_01_a'] }, chess: null,
    kits: { 'kits/chess_char_1_01_a.js': kit, 'kits/chess_char_1_02_a.js': kit } });
  try {
    const got = await importForge(pack, { ...forgeOpts(parent), out: path.join(parent, 'rose-over') });
    assert.equal(got.ok, true, got.markdown);
    assert.deepEqual(dirsOf(parent).filter((n) => n !== 'pack'), ['rose-over']);
    const dir = path.join(parent, 'rose-over');
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8'));
    assert.equal(manifest.class, 'script');
    assert.deepEqual(manifest.overrides, ['chess_char_1_01_a']);
    assert.equal(manifest.requires, undefined);
    assert.match(fs.readFileSync(path.join(dir, 'sim', 'index.js'), 'utf8'), /sp\.kits\.register\("chess_char_1_01_a"/);
    assert.match(got.report.skipped.find((s) => s.path === 'kits/chess_char_1_02_a.js').en, /nor an official id the pack declares in overrides/);
    assert.ok(fs.existsSync(path.join(dir, 'IMPORT-REPORT.md')));
    // the report is in the lock (written again after it), so the sandbox still accepts the plugin
    const registry = createPluginRegistry({ publicDir: path.join(ROOT, 'public'), packsDir: path.join(ROOT, 'packs'), pluginsDir: parent, dataDir: path.join(ROOT, 'data') },
      { scriptMode: 'sandbox', recheckMs: 0, log: { info() {}, warn() {} } });
    assert.equal(registry.plugin('rose-over').script.lockValid, true);
    assert.equal(registry.plugin('rose-over').status, 'loaded');
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('the imported script plugin runs in our own sandbox: the kit\'s talent raises ATK by 25% (the content plugin alone does not)', { timeout: 120000 }, async (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-forge-sandbox-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const pack = path.join(parent, 'pack');
  kitPack(pack);
  const plugins = path.join(parent, 'plugins');
  const got = await importForge(pack, { ...forgeOpts(plugins), out: path.join(plugins, 'rose-kit') });
  assert.equal(got.ok, true, got.markdown);
  const chessId = 'chess_x_rose_kit_rose_hunter_a';
  // the content plugin alone: the generic kit, no talent
  const { registry: plain } = setsOf(plugins);
  const alone = buildContentSet({ registry: plain, ids: ['rose-kit'] });
  assert.deepEqual(alone.problems, []);
  setGameData(alone.data);
  t.after(() => setGameData(null));
  const h = makeBattle({ data: new DataSource(alone.data), units: [{ chessId, row: 10, col: 4 }] });
  h.step();
  assert.equal(h.allies()[0].s.atk, STATS_A.atk);
  setGameData(null);
  // the script plugin, through the production path: SES preflight child, the checked content set, an SES Worker
  const registry = createPluginRegistry({ publicDir: path.join(ROOT, 'public'), packsDir: path.join(ROOT, 'packs'), pluginsDir: plugins, dataDir: path.join(ROOT, 'data') },
    { scriptMode: 'sandbox', recheckMs: 0, log: { info() {}, warn() {} } });
  const built = buildContentSet({ registry, ids: ['kits-rose-kit'] });
  assert.deepEqual(built.problems, [], JSON.stringify(built.problems));
  assert.equal(built.execution, 'sandbox');
  const { loadContentSet } = await import('../../public/js/content.js');
  const { WorkerSimHost } = await import('../../public/js/battle/simHost.js');
  const { Worker } = await import('node:worker_threads');
  const served = contentSetFiles(built);
  const fetch = async (url) => {
    const body = url.startsWith('/cs/') ? served.get(url.split('/').slice(3).join('/'))?.body : fs.readFileSync(path.join(ROOT, url.split('?')[0]));
    return { ok: !!body, arrayBuffer: async () => new Uint8Array(body).buffer };
  };
  const loaded = await loadContentSet(built.cs, { fetch, retryDelays: [] });
  assert.equal(loaded.canSim, true);
  const host = new WorkerSimHost({ workerFactory: () => {
    const worker = new Worker(new URL('../helpers/simWorkerNode.mjs', import.meta.url));
    const port = { postMessage: (m) => worker.postMessage(m), terminate: () => worker.terminate() };
    worker.on('message', (data) => port.onmessage?.({ data }));
    worker.on('error', (e) => port.onerror?.(e));
    return port;
  } });
  t.after(() => host.stop());
  await host.load(built.cs, { cs: built.cs, data: Object.fromEntries(loaded.values), bounds: loaded.bounds, scripts: loaded.scripts, hashInput: loaded.index });
  await host.start({ v: 1, kind: 'normal', fieldId: 'n:p1', battleId: 'forge-kit', seed: 73, stageId: 'act1autochess_m01', rect: { r0: 9, r1: 12, c0: 0, c1: 10 }, timeLimit: 8,
    players: [{ playerId: 'p1', units: [{ uid: 1, chessId, row: 10, col: 4 }], bonds: {} }],
    routes: [{ start: [10, 6], end: [10, 0], motion: 'WALK' }], spawns: [{ time: 5, enemyKey: 'enemy_1001_bigbo', count: 1, routeIndex: 0 }] });
  await host.step(30);
  const stats = await host.rpc('unitStats', [1]);
  assert.equal(stats.defId, chessId);
  assert.equal(stats.base.atk, STATS_A.atk);
  assert.equal(stats.atk, STATS_A.atk * 1.25);
});

test('the bundler mirrors the SDK and the sandbox limits; it refuses cycles, missing exports and a non-function default without running a file', async () => {
  const { kit, math, constants } = await import('../../shared/plugins/sdk.js');
  const { SANDBOX_LIMITS } = await import('../../shared/plugins/sandbox.js');
  const { parse } = await import('acorn');
  assert.deepEqual([...SDK_KIT_NAMES], Object.keys(kit));
  assert.deepEqual([...FORGE_IMPORT_MAP['@sim/constants.js'].names].sort(), Object.keys(constants).sort());
  assert.deepEqual([...FORGE_IMPORT_MAP['@sim/detmath.js'].names].sort(), Object.keys(math).sort());
  assert.equal(KIT_BUNDLE_BYTES, SANDBOX_LIMITS.bytes);
  assert.equal(KIT_MODULES_MAX, SANDBOX_LIMITS.files);
  const files = new Map(Object.entries({
    'kits/a.js': "import { b } from './b.js';\nexport default function kit() { return b; }\n",
    'kits/b.js': "import { a } from './c.js';\nexport const b = 1;\n",
    'kits/c.js': "import kitA from './a.js';\nexport const a = kitA;\n",
    'kits/missing.js': "import { nope } from './lib.js';\nexport default () => nope;\n",
    'kits/lib.js': 'export const yes = 1;\n',
    'kits/object.js': 'export default { skill: null };\n',
    'kits/reexport.js': "export { yes as default } from './lib.js';\n",
    'kits/star.js': "export * from './lib.js';\nexport default () => ({});\n",
    'kits/mutable.js': 'export let x = 1;\nexport default () => ({});\n',
  }).map(([k, v]) => [k, Buffer.from(v)]));
  const got = bundleForgeKits({ files, parse, kits: ['a', 'missing', 'object', 'star', 'mutable', 'reexport'].map((n) => ({ file: `kits/${n}.js`, register: `char_x_rose_${n}` })) });
  const why = (n) => got.refused.find((r) => r.path === `kits/${n}.js`)?.en || '';
  assert.match(why('a'), /cyclic import/);
  assert.match(why('missing'), /does not export "nope"/);
  assert.match(why('object'), /default export is not a function/);
  assert.match(why('star'), /export \*/);
  assert.match(why('mutable'), /simple const/);
  assert.deepEqual(got.registered.map((r) => r.register), ['char_x_rose_reexport']);
  assert.match(got.source, /"default": __forgeModule0\["yes"\]/);
  assert.deepEqual(checkScript(got.source).problems, []);
  const none = bundleForgeKits({ files, parse: null, kits: [{ file: 'kits/lib.js', register: 'char_x_rose_lib' }] });
  assert.equal(none.source, null);
  assert.match(none.refused[0].en, /no JavaScript parser/);
});

test('hidden pieces preserve explicit pair, source and both forms of art without kit inference', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-forge-sidecar-'));
  try {
    const pack = path.join(parent, 'pack');
    const source = Object.values(pairOf('seed'));
    const normal = 'chess_seed', elite = 'chess_bloom';
    const chess = Object.fromEntries(source.map((r, i) => [i ? elite : normal, { ...r,
      chessId: i ? elite : normal, baseId: normal, goldenId: elite, upgradeChessId: i ? null : elite,
      isHidden: true, visible: false, base: 'chess_char_1_02_a',
      assets: { portrait: i ? 'char_102_texas_2' : 'char_102_texas_1', spine: i ? 'char_112_siege' : 'char_102_texas', voice: 'char_102_texas' },
    }]));
    writePack(pack, { id: 'sidecar', name: 'Sidecar', version: '1.0.0', license: 'CC0-1.0', content: ['chess'] }, { 'chess.json': JSON.stringify(chess) });
    const got = await importForge(pack, { ...forgeOpts(parent), out: path.join(parent, 'sidecar') });
    assert.equal(got.ok, true, got.markdown);
    const [op] = opsOf(path.join(parent, 'sidecar'));
    assert.equal(op.chess.hidden, true);
    assert.deepEqual(op.chess.ids, { normal: 'chess_x_sidecar_seed', elite: 'chess_x_sidecar_bloom' });
    assert.equal(op.origin.chessId, 'chess_char_1_02_a');
    assert.equal(op.art.assets.spineGolden, 'char_112_siege');
    assert.equal(op.art.assets.voice, 'char_102_texas');
    assert.equal(op.art.ref, undefined);
    const { registry } = setsOf(parent);
    const set = buildContentSet({ registry, ids: ['sidecar'] });
    assert.deepEqual(set.problems, []);
    assert.equal(set.data.chess.chess_x_sidecar_seed.upgradeChessId, 'chess_x_sidecar_bloom');
    assert.equal(set.data.chess.chess_x_sidecar_bloom.assets.portrait, 'char_102_texas_2');
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('a Forge built-in language imports as a global lang overlay, separate from room content', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-forge-overlay-'));
  try {
    const pack = path.join(parent, 'pack');
    writePack(pack, { id: 'english-overlay', name: 'English overlay', version: '1.0.0', license: 'CC0-1.0', content: [], i18n: { en: 'i18n/en.json' } }, {
      'i18n/en.json': JSON.stringify({ 开始: 'Begin here' }),
    });
    const got = await importForge(pack, { ...forgeOpts(parent), out: path.join(parent, 'english-overlay') });
    assert.equal(got.ok, true, got.markdown);
    assert.equal(got.report.products[0].class, 'lang');
    const manifest = JSON.parse(fs.readFileSync(path.join(parent, 'english-overlay/plugin.json')));
    assert.equal(manifest.class, 'lang');
    assert.ok(got.report.assumed.some(a => a.what === 'i18n-ui' && a.en.includes('falls back')));
    const { registry } = setsOf(parent);
    assert.ok(registry.plugins().some(p => p.id === 'english-overlay'));
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('all nine Forge UI mounts distinguish adaptation from uncopied scripts, including UI-only packs', async () => {
  const mounts = { 'root.overlays': null, 'root.guide': null, 'screen.game.aside': 'hud.right', 'screen.game.hud': 'hud.right',
    'screen.game.overlay': null, 'screen.game.shopCard': null, 'screen.game.bondStrip': null, 'screen.result.footer': 'result.tab', 'screen.loadout.detail': null };
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-forge-panels-'));
  try {
    for (const [slot, expected] of Object.entries(mounts)) {
      const pack = path.join(parent, slot);
      writePack(pack, { id: 'panel-pack', name: 'Panel pack', version: '1.0.0', license: 'CC0-1.0', content: [],
        client: { panels: [{ id: 'example-panel', name: 'Example panel', slot, module: 'panel.js' }] } }, { 'panel.js': "throw new Error('must never execute');" });
      const got = await importForge(pack, { ...forgeOpts(parent), dryRun: true });
      assert.equal(got.ok, true, got.markdown);
      const scripts = got.report.skipped.filter(s => s.code === 'PLUGIN_FORGE_PANEL_SCRIPT');
      const mismatches = got.report.skipped.filter(s => s.code === 'PLUGIN_FORGE_MOUNT');
      assert.equal(scripts.length, 1);
      assert.equal(mismatches.length, expected ? 0 : 1);
      assert.equal(got.report.needsManualAdaptation, true);
      assert.equal(got.report.partial, true);
      assert.equal(got.report.dropped.panels, 1);
      assert.ok(got.report.manualReasons.some((s) => s.path.endsWith('#module')));
      if (expected) assert.ok(got.report.products.some(p => p.class === 'ui'));
      else {
        assert.match(got.report.check, /需要人工适配.*needs manual adaptation/);
        assert.equal(got.report.manualPanels[0].mount, slot);
        assert.equal(got.report.manualPanels[0].panel, 'Example panel');
        assert.ok(['hud.right', 'stats.tab', 'room.panel'].includes(got.report.manualPanels[0].suggestedSlot));
      }
    }
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('a Spine import writes clip data the way pack does, and drops only an unreadable skeleton', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-forge-spine-'));
  const pack = path.join(parent, 'pack');
  const page = png(4, 4);
  writePack(pack, {
    id: 'rose-spine', name: '骨架', version: '1.0.0', license: 'CC0-1.0', content: [],
    art: { chars: {
      char_rose_good: { spine: { front: { skel: 'models/good.skel', atlas: 'models/good.atlas', textures: ['models/a.png'] } } },
      char_rose_bad: { spine: { front: { skel: 'models/bad.skel', atlas: 'models/bad.atlas', textures: ['models/a.png'] } } },
    } },
  }, {
    'models/good.skel': skel(), 'models/good.atlas': atlas(['a.png']),
    'models/bad.skel': Buffer.from('not a skeleton'), 'models/bad.atlas': atlas(['a.png']),
    'models/a.png': page,
  });
  const out = path.join(parent, 'rose-spine');
  try {
    const dry = await importForge(pack, { ...forgeOpts(parent), out, dryRun: true });
    assert.equal(dry.ok, true, dry.markdown);
    assert.equal(dry.wrote, false);
    assert.equal(dry.issues.length, 0);
    assert.equal(fs.existsSync(out), false);
    const dropped = dry.report.skipped.filter((s) => /bad\.skel/.test(s.path));
    assert.equal(dropped.length, 1);
    assert.match(dropped[0].en, /only this model was dropped/);
    assert.match(dropped[0].zh, /只丢掉这个模型/);
    const wrote = await importForge(pack, { ...forgeOpts(parent), out });
    assert.equal(wrote.ok, true, wrote.markdown);
    assert.equal(wrote.wrote, true);
    const assets = JSON.parse(fs.readFileSync(path.join(out, 'assets.json'), 'utf8'));
    assert.equal(assets.chars.char_rose_good.spine.front.skel, 'files/models/good.skel');
    assert.equal(assets.chars.char_rose_bad, undefined);
    const lock = JSON.parse(fs.readFileSync(path.join(out, 'plugin.lock.json'), 'utf8'));
    assert.ok(lock.spine['files/models/good.skel'], Object.keys(lock.spine).join(','));
    assert.equal(lock.spine['files/models/bad.skel'], undefined);
    assert.equal(lock.spine['files/models/good.skel'].sha256.length, 64);
    const check = await quiet(['check', out, '--strict', '--root', ROOT]);
    assert.equal(check.code, 0, check.out);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('a safe integer past ±1e9 does not reject a Forge file; game-data fields stay inside that window', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-forge-num-'));
  const pack = path.join(parent, 'pack');
  const bomb = path.join(parent, 'bomb');
  writePack(pack, {
    id: 'rose-stamp', name: '时间戳', version: '1.0.0', license: 'CC0-1.0', content: ['stages', 'chess'],
    overrides: ['chess:chess_char_1_01_a'],
  }, {
    'data/stages.json': JSON.stringify({ 来源: 'forge', 内容: { act: { events: [{ start: 1745674200, end: 1746993599 }] } } }),
    'chess.json': JSON.stringify({ chess_char_1_01_a: { price: 2e9, rangeGrid: [[1, 0]] } }),
  });
  writePack(bomb, {
    id: 'rose-bomb', name: '过大', version: '1.0.0', license: 'CC0-1.0', content: ['stages'],
  }, {
    'data/stages.json': JSON.stringify({ 内容: { act: { events: [{ start: 1e20 }] } } }),
  });
  try {
    const got = await importForge(pack, { ...forgeOpts(parent), out: path.join(parent, 'rose-stamp') });
    assert.equal(got.ok, true, got.markdown);
    assert.equal(got.issues.length, 0);
    assert.match(got.markdown, /1745674200/);
    assert.match(got.markdown, /2000000000/);
    assert.match(got.markdown, /price/);
    const patch = JSON.parse(fs.readFileSync(path.join(parent, 'rose-stamp', 'data', 'patch.json'), 'utf8'));
    const grid = patch.ops.filter((o) => o.id === 'chess_char_1_01_a' && o.path.join('.') === 'rangeGrid');
    assert.equal(grid.length, 1);
    assert.deepEqual(grid[0].value, [[1, 0]]);
    assert.equal(patch.ops.some((o) => o.path.join('.') === 'price'), false);
    const { registry } = setsOf(parent);
    const set = buildContentSet({ registry, ids: ['rose-stamp'] });
    assert.deepEqual(set.problems, [], JSON.stringify(set.problems));
    const refused = await importForge(bomb, { ...forgeOpts(parent), dryRun: true });
    assert.equal(refused.ok, false);
    assert.equal(refused.issues[0].code, 'PLUGIN_FORGE_JSON');
    assert.match(refused.issues[0].detail, /not a safe integer/);
    assert.match(refused.issues[0].detail, /stages\.json/);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('a chess override writes skill and the default skills[] entry as one object', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-forge-skill-'));
  const pack = path.join(parent, 'pack');
  const official = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'chess.json'), 'utf8'));
  const aligned = (rec, mutate) => {
    const skills = JSON.parse(JSON.stringify(rec.skills));
    const i = skills.findIndex((s) => s && s.isDefault === true);
    const body = { ...skills[i] };
    delete body.isDefault;
    mutate(body);
    skills[i] = { ...body, isDefault: true };
    return { skill: body, skills };
  };
  const good = aligned(official.chess_char_1_01_a, (body) => { body.bb = { ...body.bb, extra_key: 3 }; });
  const bad = aligned(official.chess_char_1_01_b, () => {});
  bad.skill = { ...bad.skill, name: `${bad.skill.name}-other` };
  writePack(pack, {
    id: 'rose-skill', name: '技能', version: '1.0.0', license: 'CC0-1.0', content: ['chess'],
    overrides: ['chess:chess_char_1_01_a', 'chess:chess_char_1_01_b'],
  }, {
    'chess.json': JSON.stringify({
      chess_char_1_01_a: { skill: good.skill, skills: good.skills },
      chess_char_1_01_b: { skill: bad.skill, skills: bad.skills },
    }),
  });
  try {
    const got = await importForge(pack, { ...forgeOpts(parent), out: path.join(parent, 'rose-skill') });
    assert.equal(got.ok, true, got.markdown);
    assert.match(got.markdown, /chess:chess_char_1_01_b/);
    assert.match(got.markdown, /differ: name/);
    assert.match(got.markdown, /这条记录没有导入/);
    const patch = JSON.parse(fs.readFileSync(path.join(parent, 'rose-skill', 'data', 'patch.json'), 'utf8'));
    const of = (id, key) => patch.ops.filter((o) => o.id === id && o.path.join('.') === key);
    assert.equal(of('chess_char_1_01_b', 'skill').length, 0);
    const skill = of('chess_char_1_01_a', 'skill');
    const skills = of('chess_char_1_01_a', 'skills');
    assert.equal(skill.length, 1);
    assert.equal(skills.length, 1);
    assert.equal(canonicalJson(skill[0].value), canonicalJson(good.skill));
    const marked = skills[0].value.find((s) => s.isDefault === true);
    const body = { ...marked };
    delete body.isDefault;
    assert.equal(canonicalJson(body), canonicalJson(skill[0].value));
    assert.equal(body.bb.extra_key, 3);
    const { registry } = setsOf(parent);
    const set = buildContentSet({ registry, ids: ['rose-skill'] });
    assert.deepEqual(set.problems, [], JSON.stringify(set.problems));
    const composed = set.data.chess.chess_char_1_01_a;
    const def = composed.skills.find((s) => s.isDefault === true);
    const composedBody = { ...def };
    delete composedBody.isDefault;
    assert.equal(canonicalJson(composedBody), canonicalJson(composed.skill));
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('an unknown bond, garrison or bond member is named and left out of the override', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-forge-bond-'));
  const pack = path.join(parent, 'pack');
  const bonds = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'bonds.json'), 'utf8'));
  const members = bonds.deputShip.members;
  writePack(pack, {
    id: 'rose-bond', name: '盟约', version: '1.0.0', license: 'CC0-1.0', content: ['chess', 'bonds'],
    overrides: ['chess:chess_char_1_01_a', 'bonds:deputShip'],
  }, {
    'chess.json': JSON.stringify({ chess_char_1_01_a: {
      bonds: ['lateranoShip', 'victoriaShip', 'noSuchShip'], garrisonIds: ['no_such_garrison'], rangeGrid: [[1, 0]],
      chessType: 'NORMAL', backup: { charId: 'char_102_texas', tmplId: null, skillIndex: 0, uniEquipId: null, potRank: 0 },
      status: { phase: 0, level: 1, skillLevel: 1, equipLevel: 0 },
    } }),
    'bonds.json': JSON.stringify({ deputShip: { members: [...members, 'chess_nope'] } }),
  });
  try {
    const got = await importForge(pack, { ...forgeOpts(parent), out: path.join(parent, 'rose-bond') });
    assert.equal(got.ok, true, got.markdown);
    assert.match(got.markdown, /noSuchShip/);
    assert.match(got.markdown, /swiftShip/);
    assert.match(got.markdown, /victoriaShip/);
    assert.match(got.markdown, /no_such_garrison/);
    assert.match(got.markdown, /chess_nope/);
    assert.match(got.markdown, /「backup」沿用本安装的官方记录/);
    assert.match(got.markdown, /「chessType」沿用本安装的官方记录/);
    assert.match(got.markdown, /「status」沿用本安装的官方记录/);
    const patch = JSON.parse(fs.readFileSync(path.join(parent, 'rose-bond', 'data', 'patch.json'), 'utf8'));
    assert.equal(patch.ops.some((o) => ['backup', 'chessType', 'status'].includes(o.path[0])), false);
    const bondsOp = patch.ops.find((o) => o.id === 'chess_char_1_01_a' && o.path.join('.') === 'bonds');
    assert.deepEqual(bondsOp.value, ['lateranoShip', 'victoriaShip']);
    assert.equal(patch.ops.some((o) => o.path.join('.') === 'garrisonIds'), false);
    assert.equal(patch.ops.some((o) => o.id === 'deputShip' && o.path.join('.') === 'members'), false);
    assert.equal(patch.ops.some((o) => o.id === 'lateranoShip'), false);
    const bondField = (id, field) => patch.ops.find((o) => o.file === 'bonds' && o.id === id && o.path.join('.') === field);
    const swiftM = bondField('swiftShip', 'members');
    const swiftV = bondField('swiftShip', 'visibleMembers');
    assert.deepEqual(swiftM.value, bonds.swiftShip.members.filter((x) => x !== 'chess_char_1_01_a'));
    assert.deepEqual(swiftV.value, bonds.swiftShip.visibleMembers.filter((x) => x !== 'chess_char_1_01_a'));
    assert.deepEqual(bondField('victoriaShip', 'members').value, [...bonds.victoriaShip.members, 'chess_char_1_01_a']);
    assert.deepEqual(bondField('victoriaShip', 'visibleMembers').value, [...bonds.victoriaShip.visibleMembers, 'chess_char_1_01_a']);
    const grid = patch.ops.find((o) => o.id === 'chess_char_1_01_a' && o.path.join('.') === 'rangeGrid');
    assert.deepEqual(grid.value, [[1, 0]]);
    const { registry } = setsOf(parent);
    const set = buildContentSet({ registry, ids: ['rose-bond'] });
    assert.deepEqual(set.problems, [], JSON.stringify(set.problems));
    assert.deepEqual(set.data.chess.chess_char_1_01_a.bonds, ['lateranoShip', 'victoriaShip']);
    assert.equal(set.data.bonds.swiftShip.members.includes('chess_char_1_01_a'), false);
    assert.equal(set.data.bonds.swiftShip.visibleMembers.includes('chess_char_1_01_a'), false);
    assert.equal(set.data.bonds.victoriaShip.members.at(-1), 'chess_char_1_01_a');
    assert.equal(set.data.bonds.victoriaShip.visibleMembers.at(-1), 'chess_char_1_01_a');
    assert.equal(set.data.bonds.lateranoShip.members.includes('chess_char_1_01_a'), true);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('a finite number past ±1e9 inside an array leaf is omitted and the rest of the record imports', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-forge-grid-'));
  const pack = path.join(parent, 'pack');
  writePack(pack, {
    id: 'rose-grid', name: '射程', version: '1.0.0', license: 'CC0-1.0', content: ['chess'],
    overrides: ['chess:chess_char_1_01_a'],
  }, {
    'chess.json': JSON.stringify({ chess_char_1_01_a: { rangeGrid: [[2e9, 0]], price: 3 } }),
  });
  try {
    const got = await importForge(pack, { ...forgeOpts(parent), out: path.join(parent, 'rose-grid') });
    assert.equal(got.ok, true, got.markdown);
    assert.equal(got.issues.length, 0);
    assert.match(got.markdown, /2000000000/);
    assert.match(got.markdown, /rangeGrid/);
    const patch = JSON.parse(fs.readFileSync(path.join(parent, 'rose-grid', 'data', 'patch.json'), 'utf8'));
    assert.equal(JSON.stringify(patch).includes('2000000000'), false);
    assert.equal(patch.ops.some((o) => o.path.join('.') === 'rangeGrid'), false);
    const price = patch.ops.find((o) => o.id === 'chess_char_1_01_a' && o.path.join('.') === 'price');
    assert.equal(price.value, 3);
    const { registry } = setsOf(parent);
    const set = buildContentSet({ registry, ids: ['rose-grid'] });
    assert.deepEqual(set.problems, [], JSON.stringify(set.problems));
    assert.equal(set.data.chess.chess_char_1_01_a.price, 3);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('a skill override without skills[] merges onto the official skill', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-forge-partial-'));
  const pack = path.join(parent, 'pack');
  const official = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'chess.json'), 'utf8')).chess_char_1_01_a;
  writePack(pack, {
    id: 'rose-partial', name: '半技能', version: '1.0.0', license: 'CC0-1.0', content: ['chess'],
    overrides: ['chess:chess_char_1_01_a'],
  }, {
    'chess.json': JSON.stringify({ chess_char_1_01_a: { skill: { spCost: 30 }, rangeGrid: [[1, 0]] } }),
  });
  try {
    const got = await importForge(pack, { ...forgeOpts(parent), out: path.join(parent, 'rose-partial') });
    assert.equal(got.ok, true, got.markdown);
    assert.equal(got.issues.some((i) => i.code === 'PLUGIN_DATA_REQUIRED'), false);
    const patch = JSON.parse(fs.readFileSync(path.join(parent, 'rose-partial', 'data', 'patch.json'), 'utf8'));
    const skill = patch.ops.find((o) => o.id === 'chess_char_1_01_a' && o.path.join('.') === 'skill');
    const skills = patch.ops.find((o) => o.id === 'chess_char_1_01_a' && o.path.join('.') === 'skills');
    assert.equal(skill.value.spCost, 30);
    assert.equal(skill.value.skillId, official.skill.skillId);
    assert.equal(skill.value.index, official.skill.index);
    assert.equal(canonicalJson(skill.value.bb), canonicalJson(official.skill.bb));
    const marked = skills.value.find((s) => s.isDefault === true);
    const body = { ...marked };
    delete body.isDefault;
    assert.equal(canonicalJson(body), canonicalJson(skill.value));
    const grid = patch.ops.find((o) => o.id === 'chess_char_1_01_a' && o.path.join('.') === 'rangeGrid');
    assert.deepEqual(grid.value, [[1, 0]]);
    const { registry } = setsOf(parent);
    const set = buildContentSet({ registry, ids: ['rose-partial'] });
    assert.deepEqual(set.problems, [], JSON.stringify(set.problems));
    assert.equal(set.data.chess.chess_char_1_01_a.skill.spCost, 30);
    assert.equal(set.data.chess.chess_char_1_01_a.skill.skillId, official.skill.skillId);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('a garrison bbStr bond token that is not a bond id is named and that field is not written', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-forge-gar-'));
  const pack = path.join(parent, 'pack');
  const official = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'garrisons.json'), 'utf8'));
  writePack(pack, {
    id: 'rose-gar', name: '驻守', version: '1.0.0', license: 'CC0-1.0', content: ['garrisons'],
    overrides: ['garrisons:garrison_10_a', 'garrisons:garrison_10_b', 'garrisons:garrison_35_a'],
  }, {
    'garrisons.json': JSON.stringify({
      garrison_10_a: { bbStr: { bond_id: 'yanShip' }, charLevel: 1 },
      garrison_10_b: { bbStr: { bond_id: `${official.garrison_10_b.bbStr.bond_id},noSuchBond` } },
      garrison_35_a: { bbStr: { bond: 'yanShip,victoriaShip,rhodesShip' }, charLevel: 2 },
    }),
  });
  try {
    const got = await importForge(pack, { ...forgeOpts(parent), out: path.join(parent, 'rose-gar') });
    assert.equal(got.ok, true, got.markdown);
    assert.match(got.markdown, /noSuchBond/);
    assert.match(got.markdown, /rhodesShip/);
    assert.match(got.markdown, /bbStr\.bond_id/);
    assert.match(got.markdown, /bbStr\.bond/);
    const patch = JSON.parse(fs.readFileSync(path.join(parent, 'rose-gar', 'data', 'patch.json'), 'utf8'));
    const field = (id, key) => patch.ops.find((o) => o.id === id && o.path.join('.') === key);
    assert.equal(field('garrison_10_a', 'bbStr.bond_id').value, 'yanShip');
    assert.equal(field('garrison_10_a', 'charLevel').value, 1);
    assert.equal(patch.ops.some((o) => o.id === 'garrison_10_b' && o.path.join('.') === 'bbStr.bond_id'), false);
    assert.equal(patch.ops.some((o) => o.id === 'garrison_35_a' && o.path.join('.') === 'bbStr.bond'), false);
    assert.equal(field('garrison_35_a', 'charLevel').value, 2);
    assert.equal(JSON.stringify(patch).includes('rhodesShip'), false);
    assert.equal(JSON.stringify(patch).includes('noSuchBond'), false);
    const { registry } = setsOf(parent);
    const set = buildContentSet({ registry, ids: ['rose-gar'] });
    assert.deepEqual(set.problems, [], JSON.stringify(set.problems));
    assert.equal(set.data.garrisons.garrison_10_b.bbStr.bond_id, official.garrison_10_b.bbStr.bond_id);
    assert.equal(set.data.garrisons.garrison_35_a.bbStr.bond, official.garrison_35_a.bbStr.bond);
    assert.equal(set.data.garrisons.garrison_10_a.bbStr.bond_id, 'yanShip');
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('a skeleton whose bone, slot or skin count exceeds the cap is rejected before allocation', async () => {
  const hostile = (counts) => {
    const parts = [];
    const str = (s) => { const b = Buffer.from(s); parts.push(Buffer.from([b.length + 1]), b); };
    const vi = (n) => {
      const bytes = [];
      let v = n >>> 0;
      while (v > 127) { bytes.push((v & 127) | 128); v >>>= 7; }
      bytes.push(v & 127);
      parts.push(Buffer.from(bytes));
    };
    str('hash');
    str('3.8.99');
    parts.push(Buffer.alloc(16));
    parts.push(Buffer.from([0]));
    vi(0);
    vi(counts.bones || 0);
    vi(counts.slots || 0);
    vi(0); vi(0); vi(0);
    vi(0);
    vi(counts.skins || 0);
    return Buffer.concat(parts);
  };
  const info = parseSkel(skel());
  assert.ok(info.animations.includes('Idle'));
  assert.throws(() => parseSkel(hostile({ bones: 5000 })), /bone count 5000 exceeds 4096/);
  assert.throws(() => parseSkel(hostile({ slots: 5000 })), /slot count 5000 exceeds 4096/);
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-forge-skelcap-'));
  try {
    const bomb = hostile({ skins: 1 << 24 });
    fs.writeFileSync(path.join(parent, 'a.skel'), bomb);
    fs.writeFileSync(path.join(parent, 'a.atlas'), atlas(['a.png']));
    fs.writeFileSync(path.join(parent, 'a.png'), png(1, 1));
    const t0 = Date.now();
    const clip = skeletonClipData(parent, { skel: 'a.skel', atlas: 'a.atlas', textures: ['a.png'] }, new Set(['chars']));
    const ms = Date.now() - t0;
    assert.equal(clip.entry, null);
    assert.match(clip.problems.map(String).join('\n'), /exceeds/);
    assert.ok(ms < 1000, `skel cap took ${ms}ms`);
    const good = path.join(parent, 'good');
    fs.mkdirSync(good);
    fs.writeFileSync(path.join(good, 'a.skel'), skel());
    fs.writeFileSync(path.join(good, 'a.atlas'), atlas(['a.png']));
    fs.writeFileSync(path.join(good, 'a.png'), png(1, 1));
    const kept = skeletonClipData(good, { skel: 'a.skel', atlas: 'a.atlas', textures: ['a.png'] }, new Set(['chars']));
    assert.ok(kept.entry, JSON.stringify(kept.problems));
    assert.equal(kept.problems.length, 0);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('P9: dropped records map distinct chess/item ids to art keys, while retained targets stay usable', async t => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-forge-targets-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  for (const kind of ['chess', 'items', 'bonds']) {
    const pack = path.join(parent, kind);
    const key = kind === 'chess' ? 'char_forge_target' : kind === 'items' ? 'trap_forge_target' : 'bond_forge_target';
    const records = kind === 'chess' ? pairOf('target', { both: { charId: key, name: '' } })
      : { record_forge_target: { id: 'record_forge_target', trapId: key, iconId: `${key}_icon` } };
    if (kind === 'bonds') { delete records.record_forge_target; records[key] = { id: key }; }
    writePack(pack, { id: `target-${kind}`, name: 'Targets', version: '1.0.0', license: 'CC0-1.0', content: [kind],
      art: { [kind === 'chess' ? 'chars' : kind]: { [key]: kind === 'chess' ? { avatar: 'icon.png' } : 'icon.png' } } },
    { [`${kind}.json`]: JSON.stringify(records), 'icon.png': PNG });
    const got = await importForge(pack, { ...forgeOpts(parent), out: path.join(parent, `target-${kind}`) });
    assert.equal(got.ok, true, got.markdown);
    assert.equal(got.report.cosmeticBare, true, `${kind}: ${got.markdown}`);
    assert.match(got.markdown, /nothing to apply to/);
    if (kind === 'chess') {
      // An invalid extra copy cannot make the retained operator's shared portrait look unusable.
      writePack(pack, { id: `target-${kind}`, name: 'Targets', version: '1.0.0', license: 'CC0-1.0', content: [kind],
        art: { chars: { char_112_siege: { avatar: 'icon.png' } } } },
      { 'chess.json': JSON.stringify({ ...pairOf('target', { both: { charId: 'char_112_siege', name: '' } }),
        ...pairOf('valid_target', { both: { charId: 'char_112_siege' } }) }), 'icon.png': PNG });
      const mixed = await importForge(pack, { ...forgeOpts(parent), out: path.join(parent, 'target-chess-mixed'), dryRun: true });
      assert.equal(mixed.ok, true, mixed.markdown);
      assert.equal(mixed.report.cosmeticBare, undefined, mixed.markdown);
      fs.writeFileSync(path.join(pack, 'chess.json'), JSON.stringify(pairOf('target', { both: { charId: 'char_112_siege', name: '' } })));
      const existing = await importForge(pack, { ...forgeOpts(parent), out: path.join(parent, 'target-chess-existing'), dryRun: true });
      assert.equal(existing.ok, true, existing.markdown);
      assert.equal(existing.report.cosmeticBare, undefined, 'the official operator still uses the portrait');
    }
    if (kind === 'items') {
      const manifest = JSON.parse(fs.readFileSync(path.join(pack, 'pack.json')));
      manifest.art.items = { [`${key}_icon`]: 'icon.png' };
      fs.writeFileSync(path.join(pack, 'pack.json'), JSON.stringify(manifest));
      const icon = await importForge(pack, { ...forgeOpts(parent), out: path.join(parent, 'target-items-icon'), dryRun: true });
      assert.equal(icon.report.cosmeticBare, true, icon.markdown);
    }
  }
  const kept = path.join(parent, 'kept');
  writePack(kept, { id: 'target-kept', name: 'Kept', version: '1.0.0', license: 'CC0-1.0', content: ['chess'],
    art: { chars: { char_112_siege: { avatar: 'icon.png' } } } },
  { 'chess.json': JSON.stringify(pairOf('target_kept', { both: { charId: 'char_112_siege' } })), 'icon.png': PNG });
  const got = await importForge(kept, { ...forgeOpts(parent), out: path.join(parent, 'target-kept') });
  assert.equal(got.ok, true, got.markdown);
  assert.equal(got.report.cosmeticBare, undefined);
  const content = got.report.products.find(p => p.class === 'content');
  const look = got.report.products.find(p => p.class === 'cosmetic');
  const manifest = JSON.parse(fs.readFileSync(path.join(parent, content.id, 'plugin.json')));
  assert.deepEqual(manifest.optional, { [look.id]: '1.0.0' });
  assert.equal(manifest.requires?.[look.id], undefined, 'companion art is never auto-enabled');
});

test('P9: an engine resource container reports partial/manual even with no product', async t => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-forge-container-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const pack = path.join(parent, 'pack');
  writePack(pack, { id: 'resource-only', name: 'Resources', version: '1.0.0', license: 'CC0-1.0',
    assets: { container: 'bundle.spresources', manifest: 'resource-manifest.json' } },
  { 'bundle.spresources': 'synthetic container', 'resource-manifest.json': '{}' });
  const got = await importForge(pack, { ...forgeOpts(parent), dryRun: true });
  assert.equal(got.ok, true, got.markdown);
  assert.deepEqual(got.report.products, []);
  assert.equal(got.report.partial, true);
  assert.equal(got.report.needsManualAdaptation, true);
  assert.ok(got.report.manualReasons.some(r => r.path === 'pack.json:assets' && /spresources/.test(r.en)));
});

test('a pack that drops whole gameplay records says so, and a cosmetic aimed only at those records has nothing to apply to', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-forge-gap-'));
  const pack = path.join(parent, 'pack');
  const droppedTables = {
    'bonds.json': { forge_gap_bond: { id: 'forge_gap_bond', name: '空盟' } },
    'bands.json': { forge_gap_band: { id: 'forge_gap_band', name: '空队' } },
    'items.json': { forge_gap_item: { id: 'forge_gap_item', name: '空道具' } },
    'tokens.json': { forge_gap_token: { id: 'forge_gap_token', name: '空召唤' } },
    'garrisons.json': { forge_gap_garrison: { id: 'forge_gap_garrison', name: '空驻守' } },
    'traits.json': { forge_gap_trait_a: { id: 'forge_gap_trait_a' }, forge_gap_trait_b: { id: 'forge_gap_trait_b' } },
  };
  writePack(pack, {
    id: 'gap-pack', name: '缺口', version: '1.0.0', license: 'CC0-1.0',
    content: ['chess', 'bonds', 'bands', 'items', 'tokens', 'garrisons', 'traits'],
    art: { items: { forge_gap_item: 'icon.png' } },
  }, {
    'chess.json': JSON.stringify(pairOf('lost', { both: { charId: 'char_forge_nobody', name: '失落', assets: {} } })),
    'kits/chess_lost_a.js': 'export default function kit(){ return {}; }\n',
    'icon.png': PNG,
    ...Object.fromEntries(Object.entries(droppedTables).map(([name, doc]) => [name, JSON.stringify(doc)])),
  });
  const clean = path.join(parent, 'clean');
  writePack(clean, { id: 'gap-clean', name: '完整', version: '1.0.0', license: 'CC0-1.0', content: ['chess'] }, {
    'chess.json': JSON.stringify(pairOf('rose_clean')),
  });
  const keep = path.join(parent, 'keep');
  writePack(keep, {
    id: 'gap-keep', name: '留一', version: '1.0.0', license: 'CC0-1.0', content: ['bonds'],
    art: { chars: { char_102_texas: { avatar: 'icon.png' } } },
  }, {
    'bonds.json': JSON.stringify({ forge_gap_bond: { id: 'forge_gap_bond', name: '空盟' } }),
    'icon.png': PNG,
  });
  const audio = path.join(parent, 'audio');
  writePack(audio, {
    id: 'gap-audio', name: '只有声音', version: '1.0.0', license: 'CC0-1.0', content: ['items'],
    voices: { char_102_texas: { select: 'select.mp3' } },
  }, {
    'items.json': JSON.stringify({ forge_gap_item: { id: 'forge_gap_item', name: '空道具' } }),
    'select.mp3': MP3,
  });
  const panel = path.join(parent, 'panel');
  writePack(panel, {
    id: 'gap-panel', name: '面板', version: '1.0.0', license: 'CC0-1.0',
    client: { panels: [{ name: '侧栏', slot: 'nowhere.panel' }] },
  }, {});
  const collide = path.join(parent, 'collide');
  writePack(collide, {
    id: 'gap-collide', name: '撞名', version: '1.0.0', license: 'CC0-1.0',
    art: { chars: { char_102_texas: { avatar: 'icon.png' } } },
    client: { panels: [{ name: 'char_102_texas', slot: 'nowhere.panel' }] },
  }, { 'icon.png': PNG });
  const noscript = path.join(parent, 'noscript');
  writePack(noscript, { id: 'gap-noscript', name: '不转脚本', version: '1.0.0', license: 'CC0-1.0', content: ['chess'] }, {
    'chess.json': JSON.stringify(pairOf('rose_hunter')),
    'kits/chess_rose_hunter_a.js': 'export default function kit(){ return {}; }\n',
  });
  try {
    const got = await importForge(pack, { ...forgeOpts(parent), out: path.join(parent, 'gap-pack') });
    assert.equal(got.ok, true, got.markdown);
    assert.equal(got.report.needsManualAdaptation, false);
    assert.equal(got.report.partial, true);
    assert.deepEqual(got.report.dropped, {
      operators: 1, bonds: 1, bands: 1, items: 1, tokens: 1, traits: 3, kits: 1, panels: 0,
    });
    const play = got.markdown.indexOf('## 没有导入的玩法');
    const importedAt = got.markdown.indexOf('## 导入了什么');
    assert.ok(play >= 0 && play < importedAt, got.markdown.slice(0, 800));
    assert.match(got.markdown, /1 干员 \/ 棋子/);
    assert.match(got.markdown, /3 特性/);
    assert.equal(got.report.cosmeticBare, true);
    assert.match(got.markdown, /nothing to apply to/);
    const look = got.report.products.find((p) => p.class === 'cosmetic');
    assert.ok(look, JSON.stringify(got.report.products.map((p) => p.class)));
    assert.match(look.imported.join('\n'), /没有可应用的目标/);
    assert.match(look.imported.join('\n'), /nothing to apply to/);
    const assets = JSON.parse(fs.readFileSync(path.join(parent, look.id, 'assets.json'), 'utf8'));
    assert.equal(assets.items.forge_gap_item, 'files/icon.png');
    assert.equal(fs.existsSync(path.join(parent, look.id, 'files', 'icon.png')), true);

    const whole = await importForge(clean, { ...forgeOpts(parent), out: path.join(parent, 'gap-clean') });
    assert.equal(whole.ok, true, whole.markdown);
    assert.equal(whole.report.partial, undefined);
    assert.equal(whole.report.dropped, undefined);
    assert.equal(whole.markdown.includes('## 没有导入的玩法'), false);

    const kept = await importForge(keep, { ...forgeOpts(parent), out: path.join(parent, 'gap-keep') });
    assert.equal(kept.ok, true, kept.markdown);
    assert.equal(kept.report.partial, true);
    assert.equal(kept.report.dropped.bonds, 1);
    assert.equal(kept.report.dropped.operators, 0);
    assert.equal(kept.report.cosmeticBare, undefined);
    const keptLook = kept.report.products.find((p) => p.class === 'cosmetic');
    assert.equal(/没有可应用的目标|nothing to apply to/.test(keptLook.imported.join('\n')), false);
    assert.match(kept.markdown, /chars\.char_102_texas/);

    const voice = await importForge(audio, { ...forgeOpts(parent), out: path.join(parent, 'gap-audio') });
    assert.equal(voice.ok, true, voice.markdown);
    assert.equal(voice.report.partial, true);
    assert.equal(voice.report.dropped.items, 1);
    assert.equal(voice.report.cosmeticBare, undefined);
    const voiceLook = voice.report.products.find((p) => p.class === 'cosmetic');
    assert.equal(/没有可应用的目标|nothing to apply to/.test(voiceLook.imported.join('\n')), false);
    assert.match(voiceLook.imported.join('\n'), /voiceJp/);

    const mounted = await importForge(panel, { ...forgeOpts(parent), out: path.join(parent, 'gap-panel') });
    assert.equal(mounted.ok, true, mounted.markdown);
    assert.equal(mounted.report.partial, true);
    assert.equal(mounted.report.needsManualAdaptation, true);
    assert.equal(mounted.report.dropped.panels, 1);
    assert.match(mounted.markdown, /1 面板/);

    const hit = await importForge(collide, { ...forgeOpts(parent), out: path.join(parent, 'gap-collide') });
    assert.equal(hit.ok, true, hit.markdown);
    assert.equal(hit.report.partial, true);
    assert.equal(hit.report.dropped.panels, 1);
    assert.equal(hit.report.dropped.operators, 0);
    assert.equal(hit.report.cosmeticBare, undefined);
    const hitLook = hit.report.products.find((p) => p.class === 'cosmetic');
    assert.ok(hitLook, JSON.stringify(hit.report.products.map((p) => p.class)));
    assert.equal(/没有可应用的目标|nothing to apply to/.test(hitLook.imported.join('\n')), false);
    assert.match(hitLook.imported.join('\n'), /chars\.char_102_texas\.avatar/);
    const hitAssets = JSON.parse(fs.readFileSync(path.join(parent, hitLook.id, 'assets.json'), 'utf8'));
    assert.deepEqual(Object.keys(hitAssets.chars), ['char_102_texas']);

    const skippedKit = await importForge(noscript, { ...forgeOpts(parent), out: path.join(parent, 'gap-noscript'), scripts: false });
    assert.equal(skippedKit.ok, true, skippedKit.markdown);
    assert.equal(skippedKit.report.partial, undefined);
    assert.match(skippedKit.markdown, /--no-scripts/);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});
