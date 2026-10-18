// test/plugins/visual.test.js — the cosmetic plugins' format (DESIGN §32 P1a, shared/plugins/visual.js): an asset overlay
// read into ops (the containers and fields of data/assets.json, a plugin's own files by extension, Spine models next to
// their atlas, whole-record and field references to the installation's manifest — a missing one is a problem —, the
// permissions a write needs), plugin.lock.json and a model's clip data (a stale lock refused), the browser's composition
// of a set's document (prepareVisualDoc / layVisualOps: every plugin URL built from the composition's file table — a
// file's /p/<id>/<hash8>/ URL, one hash for every file of a model —, a reference copied out of the page's own manifest,
// the composition's load order; whatever does not fit dropped — a file the table lacks, of another kind, a path outside
// the containers, a model out of its folder or of the lock's shape, a reference the page lacks, any URL the document
// would carry — so its entry keeps the art beneath it; a file that failed to load left out), applyOps (a value written
// whole, nothing changed in place), the merge of several plugins (the later one applies, an override warning), the
// visual hash `vs` (the same input → the same hash, one changed byte → another) and the check a browser runs on a
// served document.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ASSET_CONTAINERS, VISUAL_HASH_VERSION, VISUAL_LIMITS, applyOps, attachSpineMeta, checkVisualDoc, getPath, isAssetKey, layVisualOps,
  locateAssetPath, mergePluginOps, modelHashOf, pluginFileUrl, prepareVisualDoc, readAssetOverlay, readPluginLock, visualHashInput,
  visualHashOf, vsUrlPart, writesHashOf,
} from '../../shared/plugins/visual.js';
import { canonicalJson } from '../../shared/plugins/identity.js';
import { sha256Hex } from '../../shared/sha256.js';
import { createPreviews } from '../../server/studio/preview.js';
import { cosmetic, png, writePlugin } from '../helpers/pluginFixtures.js';

const VANILLA = {
  version: 1, hash: 'abc',
  chars: {
    char_102_texas: { avatar: '/assets/~1111111111111111/char/avatar/texas.png', portrait: '/assets/char/portrait/texas_1.png',
      spine: { front: { skel: '/assets/~2222222222222222/spine/op/texas/front/t.skel', atlas: '/assets/~2222222222222222/spine/op/texas/front/t.atlas', textures: ['/assets/~2222222222222222/spine/op/texas/front/t.png'], pma: false, anims: { idle: 'Idle' } } } },
    char_112_siege: { avatar: '/assets/char/avatar/siege.png', avatarE2: '/assets/char/avatar/siege_2.png', portrait: '/assets/char/portrait/siege_1.png' },
  },
  ui: { 'hudPanel/icon_hp': '/assets/ui/hp.png', 'hudPanel/icon_lp': '/assets/ui/lp.png' },
  audio: { voice: { char_102_texas: { skill1: '/assets/audio/voice/cn/texas/s1.mp3' }, char_112_siege: { skill1: '/assets/audio/voice/cn/siege/s1.mp3', select: ['/a.mp3', '/b.mp3'] } },
    bgm: { lobby: { loop: '/assets/audio/bgm/lobby.mp3' } } },
};
const FILES = new Set(['art/a.png', 'art/b.webp', 'v/s1.mp3', 'v/s2.ogg', 'spine/front/t.skel', 'spine/front/t.atlas', 'spine/front/t.png', 'spine/front/t2.png', 'other/x.png', 'other/x.atlas']);
const has = (rel) => FILES.has(rel);
const sha = (rel) => sha256Hex(`bytes of ${rel}`);
const read = (assets, ctx = {}) => readAssetOverlay(assets, { vanilla: VANILLA, permissions: ['assets.override', 'assets.add'], has, ...ctx });
/** A set's document as server/plugins/visualSet.js serves it: the composition (file tables) and each plugin's writes. */
const setDoc = (plugins) => {
  const overlays = plugins.map((p) => ({ id: p.id, version: '1.0.0', files: Object.fromEntries((p.files || [...FILES, 'plugin.json']).map((rel) => [rel, sha(rel)])), writes: writesHashOf(p.ops) }));
  const parts = { assets: 'aa'.repeat(32), overlays };
  return { visual: { v: VISUAL_HASH_VERSION, vs: visualHashOf(parts), ...parts }, writes: plugins.map((p) => ({ id: p.id, ops: p.ops })) };
};
/** What a page draws: the document composed on `base`. */
const compose = (base, ...docs) => layVisualOps(base, docs.map((d) => prepareVisualDoc(d))).manifest;

describe('reading an overlay', () => {
  test('the containers and fields of data/assets.json → ops in the plugin\'s order; its files and models', () => {
    const r = read({
      chars: { char_102_texas: { avatar: 'art/a.png', spine: { front: { skel: 'spine/front/t.skel', anims: 'auto' } } } },
      ui: { 'hudPanel/icon_hp': 'art/b.webp' },
      audio: { voice: { char_102_texas: { skill1: 'v/s1.mp3', select: ['v/s1.mp3', 'v/s2.ogg'] } }, bgm: { lobby: { loop: 'v/s2.ogg' } } },
      prof: { icon: { sniper: 'other/x.png' } },
    });
    assert.deepEqual([r.problems, r.warnings], [[], []]);
    assert.deepEqual(r.ops.map((o) => o.at.join('.')), [
      'chars.char_102_texas.avatar', 'chars.char_102_texas.spine.front', 'ui.hudPanel/icon_hp', 'audio.voice.char_102_texas.skill1',
      'audio.voice.char_102_texas.select', 'audio.bgm.lobby', 'prof.icon.sniper',
    ]);
    assert.deepEqual(r.ops[5].track, { loop: 'v/s2.ogg' }, 'a track is written whole');
    assert.deepEqual(r.ops[1].spine, { skel: 'spine/front/t.skel', atlas: 'spine/front/t.atlas', textures: ['spine/front/t.png'], pma: false }, 'the atlas and page by the skeleton\'s name');
    assert.deepEqual(r.ops[4].files, ['v/s1.mp3', 'v/s2.ogg']);
    assert.deepEqual(r.files, ['art/a.png', 'spine/front/t.skel', 'spine/front/t.atlas', 'spine/front/t.png', 'art/b.webp', 'v/s1.mp3', 'v/s2.ogg', 'other/x.png']);
    assert.deepEqual(r.models, [['spine/front/t.skel', 'spine/front/t.atlas', 'spine/front/t.png']]);
  });

  test('references: a whole record (replaced as a whole, other keys change fields of it) or one field — of the same container', () => {
    const r = read({ chars: {
      char_102_texas: { ref: 'char_112_siege', avatar: 'art/a.png' },
      char_x_new: { portrait: { ref: 'char_112_siege' } },
    }, audio: { voice: { char_102_texas: { select: { ref: 'char_112_siege' } } } }, ui: { 'hudPanel/icon_hp': { ref: 'hudPanel/icon_lp' } } });
    assert.deepEqual(r.problems, []);
    assert.deepEqual(r.ops.map((o) => [o.at.join('.'), o.ref ?? o.file, o.from?.join('.')]), [
      ['chars.char_102_texas', 'char_112_siege', 'chars.char_112_siege'],
      ['chars.char_102_texas.avatar', 'art/a.png', undefined],
      ['chars.char_x_new.portrait', 'char_112_siege', 'chars.char_112_siege.portrait'],
      ['audio.voice.char_102_texas.select', 'char_112_siege', 'audio.voice.char_112_siege.select'],
      ['ui.hudPanel/icon_hp', 'hudPanel/icon_lp', 'ui.hudPanel/icon_lp'],
    ]);
    assert.deepEqual(r.files, ['art/a.png'], 'a reference serves no file of the plugin');
  });

  test('a reference the installation\'s manifest does not have is a problem (unchecked without the manifest)', () => {
    const r = read({ chars: { char_102_texas: { ref: 'char_999_none' }, char_112_siege: { avatarE2: { ref: 'char_102_texas' } } } });
    assert.equal(r.problems.length, 2, r.problems.join('\n'));
    assert.match(r.problems[0], /assets\.chars\.char_102_texas: \{ "ref": "char_999_none" \} — this installation's art manifest \(data\/assets\.json\) has no chars\.char_999_none/);
    assert.match(r.problems[1], /has no chars\.char_102_texas\.avatarE2/, 'a field reference needs that field');
    assert.deepEqual(readAssetOverlay({ chars: { char_102_texas: { ref: 'char_999_none' } } }).problems, [], 'no manifest: not checked');
    assert.match(read({ chars: { char_102_texas: { avatar: { ref: '__proto__' } } } }).problems.join(), /does not name an entry/);
    assert.match(read({ ui: { 'hudPanel/icon_hp': { ref: 'hudPanel/icon_lp', extra: 1 } } }).problems.join(), /a reference to a image takes no other key/);
  });

  test('an illustration and an operator\'s own skins: one key per skin, its pictures, its model and its name', () => {
    const r = read({ chars: { char_4058_pepe: { illust: 'art/a.png', skins: {
      'char_4058_pepe@sightseer#2': { name: '悠然假日', group: '珊瑚海岸', avatar: 'art/b.webp', spine: { front: { skel: 'spine/front/t.skel' } } },
      char_4058_pepe_sightseer_2: { name: 'stem form' },
    } } } });
    assert.deepEqual([r.problems, r.warnings], [[], []]);
    assert.deepEqual(r.ops.map((o) => o.at.join('.')), [
      'chars.char_4058_pepe.illust',
      'chars.char_4058_pepe.skins.char_4058_pepe@sightseer#2.name', 'chars.char_4058_pepe.skins.char_4058_pepe@sightseer#2.group',
      'chars.char_4058_pepe.skins.char_4058_pepe@sightseer#2.avatar', 'chars.char_4058_pepe.skins.char_4058_pepe@sightseer#2.spine.front',
      'chars.char_4058_pepe.skins.char_4058_pepe_sightseer_2.name',
    ]);
    assert.deepEqual(r.ops.filter((o) => o.text !== undefined).map((o) => o.text), ['悠然假日', '珊瑚海岸', 'stem form'], 'a text op: the line itself');
    assert.deepEqual(r.files, ['art/a.png', 'art/b.webp', 'spine/front/t.skel', 'spine/front/t.atlas', 'spine/front/t.png']);
    assert.deepEqual(r.models, [['spine/front/t.skel', 'spine/front/t.atlas', 'spine/front/t.png']], 'a skin\'s model is packed like any other');
    assert.equal(locateAssetPath(['chars', 'char_4058_pepe', 'skins', 'char_4058_pepe@sightseer#2', 'spine', 'front']).kind, 'spine');
    const bad = (assets) => read(assets).problems.join('\n');
    const warn = (assets) => read(assets).warnings.join('\n');
    assert.match(bad({ chars: { char_4058_pepe: { skins: { 'a b': { name: 'x' } } } } }), /assets\.chars\.char_4058_pepe\.skins\.a b is not a key \(letters, digits, _ @ # \+ \. -, at most 64 characters\)/, 'a key of the wrong shape is refused (the overlay reader resolves it)');
    // the 64-character ceiling the schema sets is the reader's too ($defs.skinKey, isSkinKey, readFields, locateAssetPath):
    // a longer key addresses nothing, so the plugin is refused and that write never reaches the ops
    assert.deepEqual([...bad({ chars: { char_4058_pepe: { skins: { ['s'.repeat(64)]: { name: 'x' } } } } })], [], 'a 64-character key is one');
    const long = 's'.repeat(65);
    const longRead = read({ chars: { char_4058_pepe: { skins: { [long]: { name: 'x' } } } } });
    assert.match(longRead.problems.join(), /is not a key \(letters, digits, _ @ # \+ \. -, at most 64 characters\)/, 'a 65-character key is a problem');
    assert.deepEqual(longRead.ops, [], 'and no write of it is kept');
    assert.equal(read({ chars: { char_4058_pepe: { skins: { s: { name: 'x', group: '' } } } } }).problems.length, 0, 'a skin without a series is fine (the installation has such skins)');
    assert.match(warn({ chars: { char_4058_pepe: { skins: { s: { skin: 'a.png' } } } } }), /skins\.s\.skin is not a field/);
    assert.match(bad({ chars: { char_4058_pepe: { skins: Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`skin_${i}`, { name: 'x' }])) } } }), /more than 64 entries under assets\.chars\.char_4058_pepe\.skins/);
    assert.match(bad({ chars: { char_4058_pepe: { skins: { s: { name: 'x'.repeat(65) } } } } }), /not a text of 1–64 characters/);
    assert.match(bad({ chars: { char_4058_pepe: { skins: { s: { name: 5 } } } } }), /not a text of 1–64 characters/);
    assert.match(bad({ chars: { char_4058_pepe: { skins: { s: { name: { ref: 'char_102_texas' } } } } } }), /not a text of 1–64 characters/, 'a name is never a reference');
    assert.match(bad({ chars: { char_4058_pepe: { illust: 'art/missing.png' } } }), /art\/missing\.png is missing/);
    assert.match(bad({ chars: { char_4058_pepe: { skins: { s: { illust: 'art/missing.png' } } } } }), /assets\.chars\.char_4058_pepe\.skins\.s\.illust: art\/missing\.png is missing/);
    assert.match(bad({ chars: { char_4058_pepe: { skins: { s: { spine: { front: { skel: 'spine/front/t.skel', animations: { Idle: 1 } } } } } } } }), /come from plugin\.lock\.json/);
    assert.deepEqual(read({ chars: { char_4058_pepe: { skins: {} } } }).problems, [], 'no skins is no write');
  });

  test('files: plain paths inside the folder, of the field\'s kind, present; Spine models side by side; no clip data by hand', () => {
    const bad = (assets) => read(assets).problems.join('\n');
    assert.match(bad({ chars: { char_102_texas: { avatar: '../a.png' } } }), /"\.\.\/a\.png" is not a path inside the plugin folder/);
    assert.match(bad({ chars: { char_102_texas: { avatar: '/assets/char/avatar/x.png' } } }), /is not a path inside the plugin folder/, 'never another URL of the server');
    assert.match(bad({ chars: { char_102_texas: { avatar: 'https://example.com/a.png' } } }), /is not a path inside the plugin folder/, 'never another host');
    assert.match(bad({ chars: { char_102_texas: { avatar: 'v/s1.mp3' } } }), /v\/s1\.mp3 is not \.png \/ \.jpg \/ \.webp/);
    assert.match(bad({ audio: { sfx: { ui: { click: 'art/a.png' } } } }), /art\/a\.png is not \.mp3 \/ \.ogg/);
    assert.match(bad({ chars: { char_102_texas: { avatar: 'art/missing.png' } } }), /art\/missing\.png is missing/);
    assert.match(bad({ chars: { char_102_texas: { avatar: 5 } } }), /5 is not a path/, 'never a number in the manifest');
    assert.match(bad({ chars: { char_102_texas: { spine: { front: { skel: 'spine/front/t.skel', atlas: 'other/x.atlas' } } } } }), /other\/x\.atlas — the atlas sits next to its skeleton with the same name \(spine\/front\/t\.atlas\)/);
    assert.match(bad({ chars: { char_102_texas: { spine: { front: { skel: 'spine/front/t.skel', textures: ['art/a.png'] } } } } }), /outside the atlas's folder/);
    assert.match(bad({ chars: { char_102_texas: { spine: { front: { skel: 'spine/front/t.skel', anims: { idle: 'Idle' } } } } } }), /come from plugin\.lock\.json/);
    assert.match(bad({ chars: { char_102_texas: { spine: { front: { skel: 'spine/front/t.skel', hits: {} } } } } }), /come from plugin\.lock\.json/);
    const ok = read({ chars: { char_102_texas: { spine: { front: { skel: 'spine/front/t.skel', textures: ['spine/front/t.png', 'spine/front/t2.png'], pma: true } } } } });
    assert.deepEqual([ok.problems, ok.ops[0].spine.textures, ok.ops[0].spine.pma], [[], ['spine/front/t.png', 'spine/front/t2.png'], true]);
    assert.match(bad({ audio: { voice: { char_102_texas: { select: Array.from({ length: VISUAL_LIMITS.listFiles + 1 }, () => 'v/s1.mp3') } } } }), /a list of 1–16/);
  });

  test('a track is written whole (a loop alone plays without the installation\'s intro); an enemy\'s or a token\'s model takes its local-client model away', () => {
    const vanilla = { ...VANILLA, enemies: { enemy_1305_mhslim: { icon: '/assets/e.png', spine: { skel: '/assets/e.skel' }, spineLocal: { group: 'spine/enemy/enemy_1305_mhslim' } },
      enemy_1007_slime: { icon: '/assets/s.png', spine: { skel: '/assets/s.skel' } } }, audio: { ...VANILLA.audio, bgm: { lobby: { intro: '/assets/i.mp3', loop: '/assets/l.mp3' } } } };
    const r = readAssetOverlay({
      audio: { bgm: { lobby: { loop: 'v/s1.mp3' }, prep: { intro: 'v/s1.mp3', loop: 'v/s2.ogg', extra: 'x' } } },
      enemies: { enemy_1305_mhslim: { spine: { skel: 'spine/front/t.skel' } }, enemy_1007_slime: { spine: { ref: 'enemy_1305_mhslim' } }, enemy_x: { ref: 'enemy_1305_mhslim' } },
    }, { vanilla, permissions: ['assets.override', 'assets.add'], has });
    assert.deepEqual(r.problems, []);
    assert.deepEqual(r.warnings, ['assets.audio.bgm.prep.extra is not a field of a track (ignored)']);
    assert.deepEqual(r.ops.map((o) => [o.at.join('.'), o.track ? 'track' : o.spine ? 'spine' : o.ref ? 'ref' : o.clear ? 'clear' : '?']), [
      ['audio.bgm.lobby', 'track'], ['audio.bgm.prep', 'track'],
      ['enemies.enemy_1305_mhslim.spine', 'spine'], ['enemies.enemy_1305_mhslim.spineLocal', 'clear'],
      ['enemies.enemy_1007_slime.spine', 'ref'], ['enemies.enemy_1007_slime.spineLocal', 'clear'],
      ['enemies.enemy_x', 'ref'],
    ], 'a whole-record reference takes the referenced record as it is');
    const lock = readPluginLock({ lock: 1, spine: { 'spine/front/t.skel': { sha256: sha('spine/front/t.skel'), anims: { idle: 'Idle' }, animations: { Idle: 1 }, events: [], hits: {}, bounds: null } } }).lock;
    const doc = setDoc([{ id: 'p', ops: attachSpineMeta(r.ops, lock, sha).ops }]);
    assert.equal(prepareVisualDoc(doc).droppedCount, 0);
    const out = compose(vanilla, doc);
    assert.deepEqual(out.audio.bgm.lobby, { loop: `/p/p/${sha('v/s1.mp3').slice(0, 8)}/v/s1.mp3` }, 'no intro left behind');
    assert.deepEqual(Object.keys(out.audio.bgm.prep), ['intro', 'loop']);
    assert.equal('spineLocal' in out.enemies.enemy_1305_mhslim, false, 'the plugin\'s model is drawn, not the local one');
    assert.equal(JSON.parse(JSON.stringify(out)).enemies.enemy_1305_mhslim.spineLocal, undefined);
    assert.deepEqual(out.enemies.enemy_x.spineLocal, vanilla.enemies.enemy_1305_mhslim.spineLocal);
    assert.equal(vanilla.enemies.enemy_1305_mhslim.spineLocal.group, 'spine/enemy/enemy_1305_mhslim', 'the base untouched');
    assert.match(readAssetOverlay({ audio: { bgm: { lobby: { intro: 'v/s1.mp3' } } } }).problems.join(), /not a track \{ "loop", "intro"\? \}/);
    // two plugins writing one model: one warning (the implied clear is no override of its own)
    const twice = mergePluginOps([{ id: 'a', ops: r.ops.slice(2, 4) }, { id: 'b', ops: r.ops.slice(2, 4) }]);
    assert.deepEqual(twice.warnings, [{ code: 'override', params: { path: 'enemies.enemy_1305_mhslim.spine', plugins: ['a', 'b'] } }]);
    assert.equal(twice.ops.length, 4);
  });

  test('what a cosmetic plugin does not change is a warning and left out', () => {
    const r = read({ fonts: { css: 'f.css' }, skillsById: { a: 'b' }, chars: { char_102_texas: { owner: 'x', avatar: 'art/a.png' } }, audio: { bgm: { combatAlts: [] } } });
    assert.deepEqual(r.problems, []);
    assert.deepEqual(r.ops.map((o) => o.at.join('.')), ['chars.char_102_texas.avatar']);
    assert.deepEqual(r.warnings, [
      'assets.fonts is not something a cosmetic plugin changes (ignored)',
      'assets.skillsById is not something a cosmetic plugin changes (ignored)',
      'assets.chars.char_102_texas.owner is not a field a cosmetic plugin changes (ignored)',
      'assets.audio.bgm.combatAlts is not one of lobby, prep, combat, unite, boss (ignored)',
    ]);
    assert.match(read({ chars: { 'bad key!': { avatar: 'art/a.png' } } }).problems.join(), /is not an entry key/);
    assert.match(read([]).problems.join(), /not an object in the shape of data\/assets\.json/);
  });

  test('what references copy out of the installation\'s manifest is counted and capped (2 MB a plugin)', () => {
    const big = { chars: Object.fromEntries(Array.from({ length: 3 }, (_, i) => [`char_${i}`, { avatar: `/assets/${'x'.repeat(400 * 1024)}.png` }])) };
    const fine = readAssetOverlay({ chars: { char_new: { ref: 'char_0' } } }, { vanilla: big, permissions: ['assets.add'] });
    assert.deepEqual(fine.problems, []);
    assert.ok(fine.copyBytes > 400 * 1024 && fine.copyBytes < 410 * 1024, String(fine.copyBytes));
    const many = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`char_n${i}`, { ref: `char_${i % 3}` }]));
    const r = readAssetOverlay({ chars: many }, { vanilla: big, permissions: ['assets.add'] });
    assert.match(r.problems.join(), /its references copy more than 2 MB of this installation's manifest/);
    assert.equal(readAssetOverlay({ chars: many }).copyBytes, 0, 'without the manifest nothing is counted');
  });

  test('permissions: changing an entry of the installation needs assets.override, a new one assets.add', () => {
    const assets = { chars: { char_102_texas: { avatar: 'art/a.png' }, char_x_new: { avatar: 'art/a.png' } } };
    assert.deepEqual(read(assets, { permissions: ['assets.override', 'assets.add'] }).problems, []);
    assert.match(read(assets, { permissions: ['assets.add'] }).problems.join(), /changes an entry of this installation's manifest — needs the permission "assets\.override"/);
    assert.match(read(assets, { permissions: ['assets.override'] }).problems.join(), /adds an entry — needs the permission "assets\.add"/);
  });

  test('the containers: every one is a path of data/assets.json\'s schema; keys are plain and never Object.prototype\'s', () => {
    assert.deepEqual(ASSET_CONTAINERS.map((c) => c.path.join('.')), ['chars', 'enemies', 'tokens', 'bonds', 'items', 'bands', 'skills', 'modules', 'ui',
      'prof.icon', 'prof.large', 'prof.battlecard', 'prof.sub', 'audio.bgm', 'audio.bossBgm', 'audio.voice', 'audio.voiceJp', 'audio.voiceEn', 'audio.voiceKr', 'audio.voiceNative', 'audio.sfx.ui', 'audio.sfx.battle', 'audio.sfx.units']);
    for (const k of ['char_102_texas', 'hudPanel/icon_hp', 'sol-x', 'emoticon/basic/pic_happy_battle']) assert.ok(isAssetKey(k), k);
    for (const k of ['', '__proto__', 'constructor', 'a b', '/x', 'x'.repeat(129)]) assert.ok(!isAssetKey(k), k);
  });
});

describe('plugin.lock.json and the models\' clip data', () => {
  const meta = { anims: { idle: 'Idle', attack: { begin: null, loop: 'Attack', end: null } }, animations: { Idle: 1, Attack: 0.5 }, events: ['OnAttack'], hits: { Attack: [0.5] }, bounds: { x: 0, y: 0, width: 10, height: 10 } };
  const lockOf = (skelSha = sha('spine/front/t.skel')) => ({ lock: 1, id: 'p', version: '1.0.0', files: { 'art/a.png': { sha256: sha('art/a.png'), bytes: 9 } }, spine: { 'spine/front/t.skel': { sha256: skelSha, ...meta } } });
  const ops = read({ chars: { char_102_texas: { spine: { front: { skel: 'spine/front/t.skel' } } } } }).ops;

  test('a lock gives a model its clip data; a missing or stale one is a problem', () => {
    const { lock, problems } = readPluginLock(lockOf());
    assert.deepEqual(problems, []);
    const a = attachSpineMeta(ops, lock, sha);
    assert.deepEqual([a.problems, a.ops[0].spine.meta], [[], meta]);
    assert.notEqual(a.ops, ops, 'new ops, the old ones unchanged');
    assert.equal(ops[0].spine.meta, undefined);
    assert.match(attachSpineMeta(ops, null, sha).problems.join(), /plugin\.lock\.json has no clip data for spine\/front\/t\.skel — run node tools\/plugin\.mjs pack/);
    const stale = readPluginLock(lockOf('ff'.repeat(32))).lock;
    assert.match(attachSpineMeta(ops, stale, sha).problems.join(), /was made from another spine\/front\/t\.skel — run node tools\/plugin\.mjs pack again/);
  });

  test('a lock\'s clip data is rebuilt in the pack tool\'s shape: nothing a hand-made lock adds reaches a browser', () => {
    const good = { sha256: 'ab'.repeat(32), anims: { idle: 'Idle', deploy: null, attack: { begin: null, loop: 'Attack', end: null, via: 'attack' },
      skill: { begin: null, loop: 'Attack', end: null, index: 0, idle: null }, skills: { 1: { begin: null, loop: 'Skill', end: null, index: 1, idle: 'Idle' } } },
    animations: { Idle: 1, Attack: 0.5, Skill: 2 }, events: ['OnAttack'], hits: { Attack: [0.25] }, bounds: { x: 1, y: 2, width: 3, height: 4, extra: '<img>' } };
    const ok = readPluginLock({ lock: 1, spine: { 'm/t.skel': good } });
    assert.deepEqual(ok.problems, []);
    const meta = ok.lock.spine['m/t.skel'];
    assert.deepEqual(meta.bounds, { x: 1, y: 2, width: 3, height: 4 }, 'only the four numbers');
    assert.deepEqual(meta.anims.skills, { 1: { begin: null, loop: 'Skill', end: null, index: 1, idle: 'Idle' } });
    const refused = (patch, why) => {
      const r = readPluginLock({ lock: 1, spine: { 'm/t.skel': { ...good, ...patch } } });
      assert.equal(r.lock, null, why);
      assert.match(r.problems.join(), /is not the clip data of a skeleton/, why);
    };
    refused({ anims: { ...good.anims, '<img src=x onerror=alert(1)>': 'Idle' } }, 'an unknown role');
    refused({ anims: { ...good.anims, idle: 'Nope' } }, 'a clip the skeleton has not');
    refused({ anims: { ...good.anims, attack: 12345 } }, 'a role that is no clip');
    refused({ anims: { ...good.anims, attack: { loop: 'Attack', via: 'teleport' } } }, 'an unknown via');
    refused({ anims: { deploy: 'Idle' } }, 'no idle');
    refused({ events: ['x'.repeat(200000)] }, 'a huge event name');
    refused({ events: Array.from({ length: 65 }, (_, i) => `e${i}`) }, 'too many events');
    refused({ animations: { ['A'.repeat(100000)]: 1, Idle: 1, Attack: 1, Skill: 1 } }, 'a huge animation name');
    refused({ animations: { Idle: 1e6, Attack: 1, Skill: 1 } }, 'a duration beyond 600 s');
    refused({ hits: { Elsewhere: [0.1] } }, 'hits of a clip the skeleton has not');
    let deep = 'Idle';
    for (let i = 0; i < 20000; i++) deep = { loop: deep };
    refused({ anims: { idle: 'Idle', attack: deep } }, 'nesting');
    const proto = readPluginLock(JSON.parse('{"lock":1,"files":{"__proto__":{"sha256":"' + 'ab'.repeat(32) + '","bytes":1}}}'));
    assert.equal(proto.lock, null, 'a path through a name of Object.prototype');
    assert.equal(({}).sha256, undefined);
    assert.equal(Object.getPrototypeOf(ok.lock.spine), null, 'the maps have no prototype');
  });

  test('a broken lock is a problem', () => {
    for (const raw of [null, [], { lock: 2 }, { lock: 1, files: { '../x': { sha256: 'a', bytes: 1 } } }, { lock: 1, spine: { 'a.skel': { sha256: 'aa'.repeat(32), anims: 'x' } } }]) {
      const r = readPluginLock(raw);
      assert.equal(r.lock, null, JSON.stringify(raw));
      assert.match(r.problems.join(), /write it again with node tools\/plugin\.mjs pack/);
    }
  });
});

describe('resolution, merge, application', () => {
  test('the browser composes: every plugin URL from the composition\'s file table (a file\'s own hash, a model\'s for each of its files); a reference out of the page\'s own manifest', () => {
    const r0 = read({ chars: { char_102_texas: { avatar: 'art/a.png', spine: { front: { skel: 'spine/front/t.skel' } } }, char_112_siege: { ref: 'char_102_texas' } },
      audio: { voice: { char_102_texas: { select: ['v/s1.mp3', 'v/s2.ogg'] } } } });
    const lock = readPluginLock({ lock: 1, spine: { 'spine/front/t.skel': { sha256: sha('spine/front/t.skel'), anims: { idle: 'Idle' }, animations: { Idle: 1 }, events: [], hits: {}, bounds: null } } }).lock;
    const doc = setDoc([{ id: 'my-skin', ops: attachSpineMeta(r0.ops, lock, sha).ops }]);
    assert.equal(checkVisualDoc(doc, doc.visual.vs), null);
    assert.doesNotMatch(JSON.stringify(doc.writes), /\/p\/|\/assets\//, 'the document names paths of the folder and references — never a URL');
    const prep = prepareVisualDoc(doc);
    assert.deepEqual([prep.droppedCount, prep.dropped], [0, []]);
    const out = compose(VANILLA, doc);
    assert.equal(out.chars.char_102_texas.avatar, `/p/my-skin/${sha('art/a.png').slice(0, 8)}/art/a.png`);
    const m = modelHashOf(['spine/front/t.skel', 'spine/front/t.atlas', 'spine/front/t.png'].map(sha)).slice(0, 8);
    assert.deepEqual(out.chars.char_102_texas.spine.front, {
      skel: `/p/my-skin/${m}/spine/front/t.skel`, atlas: `/p/my-skin/${m}/spine/front/t.atlas`, textures: [`/p/my-skin/${m}/spine/front/t.png`], pma: false,
      anims: { idle: 'Idle' }, animations: { Idle: 1 }, events: [], hits: {}, bounds: null,
    }, 'pixi-spine finds the atlas next to the skeleton and the pages next to the atlas: one folder');
    assert.equal(out.chars.char_112_siege, VANILLA.chars.char_102_texas, 'a whole-record reference: the page\'s own entry (shared — nothing changes it in place)');
    assert.deepEqual(out.audio.voice.char_102_texas.select, [`/p/my-skin/${sha('v/s1.mp3').slice(0, 8)}/v/s1.mp3`, `/p/my-skin/${sha('v/s2.ogg').slice(0, 8)}/v/s2.ogg`]);
    assert.equal(out.audio.voice.char_102_texas.skill1, VANILLA.audio.voice.char_102_texas.skill1, 'what no write touches stays the page\'s');
    assert.deepEqual([...prep.urls].sort(), [out.chars.char_102_texas.avatar, ...Object.values(out.chars.char_102_texas.spine.front).filter((v) => typeof v === 'string'),
      ...out.chars.char_102_texas.spine.front.textures, ...out.audio.voice.char_102_texas.select].sort(), 'every plugin URL it writes');
    assert.equal(pluginFileUrl('p', '01234567', 'a b/c.png'), '/p/p/01234567/a%20b/c.png', 'every segment encoded');
    // a skin key in a path segment: '@' and '#' percent-encoded, so '#' never starts a fragment and two keys that
    // differ only after it are two URLs (not the file before the '#')
    const sharp = pluginFileUrl('p', '01234567', 'char_4058_pepe@sightseer#2/illust.png');
    assert.equal(sharp, '/p/p/01234567/char_4058_pepe%40sightseer%232/illust.png');
    assert.equal(new URL(sharp, 'https://game.invalid').pathname, sharp, 'the whole path reaches the server');
    assert.notEqual(sharp, pluginFileUrl('p', '01234567', 'char_4058_pepe@sightseer/illust.png'));
    // a page whose manifest is another (the server's references copied the committed one): the reference follows the page's
    const other = { ...VANILLA, chars: { ...VANILLA.chars, char_102_texas: { avatar: '/assets/~9999999999999999/char/avatar/texas.png' } } };
    assert.equal(compose(other, doc).chars.char_112_siege, other.chars.char_102_texas);
  });

  test('an operator\'s skins reach the manifest under their own keys, and their writes are part of the vs', () => {
    const r = read({ chars: { char_102_texas: { illust: 'art/a.png', skins: { 'char_102_texas@sightseer#2': { name: '悠然假日', portrait: 'art/b.webp' } } } } });
    assert.deepEqual(r.problems, []);
    const doc = setDoc([{ id: 'p', ops: r.ops }]);
    const prep = prepareVisualDoc(doc);
    assert.deepEqual([prep.droppedCount, prep.dropped], [0, []]);
    const out = compose(VANILLA, doc);
    assert.equal(out.chars.char_102_texas.illust, `/p/p/${sha('art/a.png').slice(0, 8)}/art/a.png`);
    assert.deepEqual(out.chars.char_102_texas.skins, {
      'char_102_texas@sightseer#2': { name: '悠然假日', portrait: `/p/p/${sha('art/b.webp').slice(0, 8)}/art/b.webp` },
    }, 'its name and its own picture, under its own key');
    assert.equal(VANILLA.chars.char_102_texas.skins, undefined, 'the page\'s own manifest untouched');
    // another skin key is another write: the file table alone would not tell the two sets apart
    const other = setDoc([{ id: 'p', ops: read({ chars: { char_102_texas: { skins: { 'char_102_texas@sightseer#3': { name: '悠然假日', portrait: 'art/b.webp' } } } } }).ops }]);
    assert.notEqual(other.visual.vs, doc.visual.vs);
    // a picture of a skin that failed to load is left out; the skin's name is no file and stays
    const failed = layVisualOps(VANILLA, [prepareVisualDoc(doc)], { failed: new Set([out.chars.char_102_texas.skins['char_102_texas@sightseer#2'].portrait]) }).manifest;
    assert.equal(failed.chars.char_102_texas.skins['char_102_texas@sightseer#2'].portrait, undefined);
    assert.equal(failed.chars.char_102_texas.skins['char_102_texas@sightseer#2'].name, '悠然假日');
  });

  test('what does not fit the set is dropped — its entry keeps the art beneath it; no URL is ever taken from the document', () => {
    const lockMeta = { anims: { idle: 'Idle' }, animations: { Idle: 1 }, events: [], hits: {}, bounds: null };
    const spine = (o) => ({ at: ['chars', 'char_102_texas', 'spine', 'front'], spine: { skel: 'spine/front/t.skel', atlas: 'spine/front/t.atlas', textures: ['spine/front/t.png'], pma: false, meta: lockMeta, ...o } });
    const bad = [
      { at: ['chars', 'char_102_texas', 'avatar'], file: 'art/missing.png' },                      // not in the file table
      { at: ['chars', 'char_102_texas', 'avatar'], file: 'v/s1.mp3' },                             // a sound as an image
      { at: ['chars', 'char_102_texas', 'avatar'], file: 'plugin.json' },                          // in the table, but no image
      { at: ['chars', 'char_102_texas', 'avatar'], value: 'https://evil.example/track.png' },     // a URL: no write of a plugin
      { at: ['chars', 'char_102_texas', 'avatar'], file: 'https://evil.example/a.png' },
      { at: ['chars', 'char_102_texas', 'avatar'], file: 'data:image/png;base64,AAAA' },
      { at: ['chars', 'char_102_texas', 'avatar'], file: '/assets/char/avatar/siege.png' },
      { at: ['fonts', 'main'], file: 'art/a.png' },                                                // outside the containers
      { at: ['chars', 'char_102_texas', 'name'], file: 'art/a.png' },                              // a field a record has not
      { at: ['chars', '__proto__', 'avatar'], file: 'art/a.png' },
      spine({ textures: ['other/x.png'] }),                                                         // a page outside its folder
      spine({ atlas: 'other/x.atlas' }),                                                            // an atlas not beside it
      spine({ meta: { ...lockMeta, anims: { idle: 'Nope' } } }),                                    // clip data out of the lock's shape
      spine({ meta: undefined }),
      { at: ['chars', 'char_112_siege', 'avatar'], from: ['ui', 'hudPanel/icon_hp'] },               // a reference to another container
      { at: ['chars', 'char_112_siege', 'avatar'], from: ['chars', 'char_102_texas', 'portrait'] },  // to another field
      { at: ['chars', 'char_102_texas', 'avatar'], clear: true },                                   // a clear of no local model
    ];
    const doc = setDoc([{ id: 'p', ops: [...bad, { at: ['ui', 'hudPanel/icon_lp'], file: 'art/b.webp' }] }]);
    const prep = prepareVisualDoc(doc);
    assert.equal(prep.droppedCount, bad.length, prep.dropped.join('\n'));
    assert.ok(prep.dropped.length <= 16 && prep.dropped.every((d) => d.startsWith('p: ')), 'the reasons, bounded');
    const out = compose(VANILLA, doc);
    assert.equal(out.chars.char_102_texas.avatar, VANILLA.chars.char_102_texas.avatar, 'the installation\'s art');
    assert.equal(out.chars.char_102_texas.spine.front, VANILLA.chars.char_102_texas.spine.front);
    assert.equal(out.ui['hudPanel/icon_lp'], `/p/p/${sha('art/b.webp').slice(0, 8)}/art/b.webp`, 'a write that fits still applies');
    assert.doesNotMatch(JSON.stringify(out), /evil|data:image/);
    assert.equal(({}).avatar, undefined);
    // a reference the page's manifest lacks: dropped when laid (told), the entry the page's
    const ref = setDoc([{ id: 'p', ops: [{ at: ['chars', 'char_112_siege'], from: ['chars', 'char_000_nobody'], ref: 'char_000_nobody' }] }]);
    const laid = layVisualOps(VANILLA, [prepareVisualDoc(ref)]);
    assert.equal(laid.manifest.chars.char_112_siege, VANILLA.chars.char_112_siege);
    assert.match(laid.dropped.join(), /has no chars\.char_000_nobody/);
    // a plugin the composition does not name writes nothing; a document's writes never reorder the composition
    assert.equal(prepareVisualDoc({ ...setDoc([{ id: 'p', ops: [] }]), writes: [{ id: 'stranger', ops: [{ at: ['ui', 'hudPanel/icon_lp'], file: 'art/a.png' }] }] }).ops.length, 0);
    const a = { id: 'a', ops: [{ at: ['ui', 'hudPanel/icon_hp'], file: 'art/a.png' }] };
    const b = { id: 'b', ops: [{ at: ['ui', 'hudPanel/icon_hp'], file: 'art/b.webp' }] };
    const ab = setDoc([a, b]);
    assert.match(compose(VANILLA, { ...ab, writes: [...ab.writes].reverse() }).ui['hudPanel/icon_hp'], /^\/p\/b\//, 'the composition\'s load order: b, the later, applies');
  });

  test('an enemy\'s local-client model is taken away only with its new model: a model write dropped, failed or a reference missing leaves it', () => {
    const vanilla = { ...VANILLA, enemies: { enemy_1305_mhslim: { icon: '/assets/e.png', spine: { skel: '/assets/e.skel', atlas: '/assets/e.atlas', anims: { idle: 'Idle' } }, spineLocal: { group: 'spine/enemy/mh' } },
      enemy_1007_slime: { icon: '/assets/s.png', spine: { skel: '/assets/s.skel', atlas: '/assets/s.atlas', anims: { idle: 'Idle' } } } } };
    const meta = { anims: { idle: 'Idle' }, animations: { Idle: 1 }, events: [], hits: {}, bounds: null };
    const model = (o = {}) => ({ at: ['enemies', 'enemy_1305_mhslim', 'spine'], spine: { skel: 'spine/front/t.skel', atlas: 'spine/front/t.atlas', textures: ['spine/front/t.png'], pma: false, meta, ...o } });
    const clear = { at: ['enemies', 'enemy_1305_mhslim', 'spineLocal'], clear: true, implied: true };
    const local = (doc, failed) => layVisualOps(vanilla, [prepareVisualDoc(doc)], { failed }).manifest.enemies.enemy_1305_mhslim;
    // written: the local model goes (the client would draw it first)
    const ok = local(setDoc([{ id: 'p', ops: [model(), clear] }]));
    assert.equal('spineLocal' in ok, false);
    assert.match(ok.spine.skel, /^\/p\/p\//);
    // the write dropped (clip data out of the lock's shape): the clear goes with it
    const bad = setDoc([{ id: 'p', ops: [model({ meta: { ...meta, anims: { idle: 'Nope' } } }), clear] }]);
    assert.equal(prepareVisualDoc(bad).droppedCount, 2);
    assert.deepEqual(local(bad), vanilla.enemies.enemy_1305_mhslim, 'the installation\'s model and its local one');
    // the model's file failed to load: left out with it
    const good = setDoc([{ id: 'p', ops: [model(), clear] }]);
    const skelUrl = prepareVisualDoc(good).ops[0].value.skel;
    assert.deepEqual(local(good, new Set([skelUrl])), vanilla.enemies.enemy_1305_mhslim);
    // a reference the page's manifest lacks: its clear stays out too
    const ref = setDoc([{ id: 'p', ops: [{ at: ['enemies', 'enemy_1305_mhslim', 'spine'], ref: 'enemy_gone', from: ['enemies', 'enemy_gone', 'spine'] }, clear] }]);
    assert.deepEqual(local(ref), vanilla.enemies.enemy_1305_mhslim);
    // a clear with no model write before it (a document out of order): dropped
    assert.equal(prepareVisualDoc(setDoc([{ id: 'p', ops: [clear] }])).ops.length, 0);
  });

  test('locateAssetPath: the container, key, fields and kind of a manifest path — null outside the containers', () => {
    assert.deepEqual(locateAssetPath(['chars', 'char_102_texas', 'spine', 'front']), { container: ['chars'], key: 'char_102_texas', field: ['spine', 'front'], kind: 'spine' });
    assert.equal(locateAssetPath(['audio', 'bgm', 'combat']).kind, 'track');
    assert.equal(locateAssetPath(['audio', 'voice', 'char_102_texas', 'select']).kind, 'audioList');
    assert.equal(locateAssetPath(['audio', 'sfx', 'units', 'char_102_texas', 'skills', '1']).kind, 'audio');
    assert.equal(locateAssetPath(['ui', 'hudPanel/icon_hp']).kind, 'image');
    assert.equal(locateAssetPath(['chars', 'char_102_texas', 'illust']).kind, 'image');
    assert.equal(locateAssetPath(['chars', 'char_102_texas', 'skins', 'sightseer#2', 'name']).kind, 'text');
    assert.equal(locateAssetPath(['chars', 'char_102_texas', 'skins', 'sightseer#2', 'spine', 'front']).kind, 'spine');
    assert.equal(typeof locateAssetPath(['chars', 'char_102_texas']).kind, 'object', 'a whole record');
    for (const at of [['audio', 'bgm', 'combatAlts'], ['chars'], ['chars', 'x', 'nope'], ['ui', 'k', 'deeper'], ['skillsById', 'x'], 'chars', null, ['chars', 'constructor'],
      ['chars', 'char_102_texas', 'skins', 'bad key!', 'name'], ['chars', 'char_102_texas', 'skins', 'sightseer_2', 'nope'],
      ['chars', 'char_102_texas', 'skins', 's'.repeat(65), 'name']]) {
      assert.equal(locateAssetPath(at), null, JSON.stringify(at));
    }
  });

  test('a plugin file that failed to load is left out: its entry falls back to the art beneath it (the room\'s under a personal plugin)', () => {
    const room = setDoc([{ id: 'room', ops: [{ at: ['chars', 'char_102_texas', 'avatar'], file: 'art/a.png' }] }]);
    const mine = setDoc([{ id: 'mine', ops: [{ at: ['chars', 'char_102_texas', 'avatar'], file: 'art/b.webp' }] }]);
    const sets = [prepareVisualDoc(room), prepareVisualDoc(mine)];
    const roomUrl = `/p/room/${sha('art/a.png').slice(0, 8)}/art/a.png`;
    const mineUrl = `/p/mine/${sha('art/b.webp').slice(0, 8)}/art/b.webp`;
    assert.equal(layVisualOps(VANILLA, sets).manifest.chars.char_102_texas.avatar, mineUrl);
    assert.equal(layVisualOps(VANILLA, sets, { failed: new Set([mineUrl]) }).manifest.chars.char_102_texas.avatar, roomUrl);
    assert.equal(layVisualOps(VANILLA, sets, { failed: new Set([mineUrl, roomUrl]) }).manifest.chars.char_102_texas.avatar, VANILLA.chars.char_102_texas.avatar);
  });

  test('applyOps: each value written whole at its path, the objects on the way copied — nothing changed in place', () => {
    const base = JSON.parse(JSON.stringify(VANILLA));
    const frozen = JSON.stringify(base);
    const whole = { avatar: '/x.png' };
    const out = applyOps(base, [
      { at: ['chars', 'char_102_texas'], value: whole },
      { at: ['chars', 'char_102_texas', 'portrait'], value: '/y.png' },
      { at: ['chars', 'char_x_new', 'spine', 'front'], value: { skel: '/n.skel' } },
      { at: ['__proto__', 'polluted'], value: true },
      { at: ['chars', 'constructor'], value: 1 },
    ]);
    assert.equal(JSON.stringify(base), frozen, 'the base is untouched');
    assert.deepEqual(whole, { avatar: '/x.png' }, 'an op\'s value is copied before a later op writes into it');
    assert.deepEqual(out.chars.char_102_texas, { avatar: '/x.png', portrait: '/y.png' }, 'the whole record replaced, then a field of it');
    assert.deepEqual(out.chars.char_x_new, { spine: { front: { skel: '/n.skel' } } });
    assert.equal(out.chars.char_112_siege, base.chars.char_112_siege, 'what no op touches is shared');
    assert.equal(out.ui, base.ui);
    assert.equal(({}).polluted, undefined);
    assert.equal(Object.hasOwn(out.chars, 'constructor'), false);
  });

  test('merge: the later plugin applies; an override warning names the path and both plugins (also one inside the other)', () => {
    const a = [{ at: ['chars', 'char_102_texas', 'avatar'], value: '/a.png' }, { at: ['ui', 'hudPanel/icon_hp'], value: '/a-hp.png' }];
    const b = [{ at: ['chars', 'char_102_texas', 'avatar'], value: '/b.png' }];
    const c = [{ at: ['chars', 'char_102_texas'], value: { avatar: '/c.png' } }, { at: ['ui', 'hudPanel/icon_lp'], value: '/c-lp.png' }];
    const m = mergePluginOps([{ id: 'a', ops: a }, { id: 'b', ops: b }, { id: 'c', ops: c }]);
    assert.deepEqual(m.ops.map((o) => o.value), ['/a.png', '/a-hp.png', '/b.png', { avatar: '/c.png' }, '/c-lp.png'], 'in load order');
    assert.deepEqual(m.warnings, [
      { code: 'override', params: { path: 'chars.char_102_texas.avatar', plugins: ['a', 'b'] } },
      { code: 'override', params: { path: 'chars.char_102_texas', plugins: ['b', 'c'] } },
    ]);
    assert.equal(applyOps(VANILLA, mergePluginOps([{ id: 'a', ops: a }, { id: 'b', ops: b }]).ops).chars.char_102_texas.avatar, '/b.png');
    assert.deepEqual(mergePluginOps([{ id: 'a', ops: [...a, ...a] }]).warnings, [], 'a plugin never conflicts with itself');
    const many = Array.from({ length: 40 }, (_, i) => ({ at: ['ui', `k${i}`], value: '/x.png' }));
    assert.equal(mergePluginOps([{ id: 'a', ops: many }, { id: 'b', ops: many }]).warnings.length, VISUAL_LIMITS.warnings);
  });
});

describe('the visual hash vs', () => {
  const OPS = [{ at: ['chars', 'char_102_texas', 'avatar'], file: 'art/a.png' }];
  const overlay = (files, writes = writesHashOf(OPS)) => ({ id: 'texas-recolor', version: '1.0.0', files, writes });
  const parts = { assets: 'aa'.repeat(32), overlays: [overlay({ 'plugin.json': 'bb'.repeat(32), 'art/a.png': 'cc'.repeat(32) })] };

  test('sha256 of the canonical { v, assets, overlays }; the same input → the same hash, in any key order', () => {
    const vs = visualHashOf(parts);
    assert.match(vs, /^[0-9a-f]{64}$/);
    assert.equal(vs, sha256Hex(canonicalJson({ v: VISUAL_HASH_VERSION, assets: parts.assets, overlays: parts.overlays })));
    assert.equal(vs, createHash('sha256').update(canonicalJson(visualHashInput(parts))).digest('hex'), 'node:crypto agrees');
    assert.equal(visualHashOf({ overlays: [overlay({ 'art/a.png': 'cc'.repeat(32), 'plugin.json': 'bb'.repeat(32) })], assets: parts.assets }), vs);
    assert.equal(vsUrlPart(vs), vs.slice(0, 16));
  });

  test('one changed byte of any part → another vs: a file, data/assets.json, a version, the load order, the writes', () => {
    const vs = visualHashOf(parts);
    const variants = [
      { ...parts, assets: 'ab'.repeat(32) },
      // the same file table, another slot for the same file: the writes are part of vs
      { ...parts, overlays: [overlay({ 'plugin.json': 'bb'.repeat(32), 'art/a.png': 'cc'.repeat(32) }, writesHashOf([{ at: ['chars', 'char_102_texas', 'portrait'], file: 'art/a.png' }]))] },
      { ...parts, overlays: [overlay({ 'plugin.json': 'bb'.repeat(32), 'art/a.png': `c${'c'.repeat(62)}d` })] },
      { ...parts, overlays: [{ ...parts.overlays[0], version: '1.0.1' }] },
      { ...parts, overlays: [...parts.overlays, overlay({})] },
      { ...parts, overlays: [overlay({}), ...parts.overlays] },
      { ...parts, overlays: [] },
    ];
    for (const v of variants) assert.notEqual(visualHashOf(v), vs, JSON.stringify(v).slice(0, 120));
  });

  test('checkVisualDoc: the composition of a served document hashes to the vs the room named, and each plugin\'s writes to its part', () => {
    const vs = visualHashOf(parts);
    const doc = { visual: { v: VISUAL_HASH_VERSION, vs, assets: parts.assets, overlays: parts.overlays }, writes: [{ id: 'texas-recolor', ops: OPS }] };
    assert.equal(checkVisualDoc(doc, vs), null);
    // the same file table, the same vs, other writes (another file of the table, another slot, other clip data): refused
    const tampered = [
      [{ at: ['chars', 'char_102_texas', 'avatar'], file: 'plugin.json' }],
      [{ at: ['chars', 'char_112_siege', 'avatar'], file: 'art/a.png' }],
      [...OPS, { at: ['ui', 'hudPanel/icon_hp'], file: 'art/a.png' }],
      [],
    ];
    for (const ops of tampered) assert.match(checkVisualDoc({ ...doc, writes: [{ id: 'texas-recolor', ops }] }, vs), /writes of texas-recolor are not the ones its vs names/, JSON.stringify(ops));
    assert.match(checkVisualDoc({ ...doc, writes: [] }, vs), /writes of texas-recolor/, 'missing writes are writes of none');
    assert.match(checkVisualDoc({ ...doc, writes: [...doc.writes, { id: 'texas-recolor', ops: OPS }] }, vs), /one list per plugin/);
    assert.match(checkVisualDoc({ ...doc, writes: [...doc.writes, { id: 'stranger', ops: [] }] }, vs), /a plugin its composition does not name/);
    assert.match(checkVisualDoc({ ...doc, writes: [{ id: 'texas-recolor', ops: [{ at: ['x'], n: 1n }] }] }, vs), /not plain data/, 'never throws');
    assert.equal(writesHashOf(JSON.parse(JSON.stringify(OPS))), writesHashOf(OPS), 'what a browser receives hashes as the server hashed it');
    assert.match(checkVisualDoc(doc, 'ee'.repeat(32)), /names another set/);
    assert.match(checkVisualDoc({ visual: { ...doc.visual, overlays: [] } }, vs), /does not hash to its vs/);
    assert.match(checkVisualDoc({ chars: {} }, vs), /not a visual set document/);
    assert.match(checkVisualDoc(doc, 'short'), /no visual hash/);
    assert.match(checkVisualDoc({ visual: { ...doc.visual, overlays: [null] } }, vs), /not plain data/);
  });

  test('getPath reads own properties only', () => {
    assert.equal(getPath(VANILLA, ['chars', 'char_112_siege', 'avatar']), '/assets/char/avatar/siege.png');
    assert.equal(getPath(VANILLA, ['chars', 'toString']), undefined);
    assert.equal(getPath(VANILLA, ['chars', 'char_112_siege', 'avatar', 'length']), undefined);
  });
});

describe('the studio\'s preview of a folder', () => {
  test('a skin\'s name and series are in the studio\'s ops too, beside the URL of the picture', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-preview-'));
    try {
      const folder = writePlugin(path.join(dir, 'skinned'), cosmetic({ assets: 'assets.json' }), {
        'assets.json': { chars: { char_102_texas: { illust: 'art/pepe.png', skins: {
          'char_102_texas@sightseer#2': { name: '悠然假日', group: '', avatar: 'art/pepe.png' },
        } } } },
        'art/pepe.png': png(),
      });
      const { ops, issues } = createPreviews({ vanilla: () => ({ manifest: VANILLA }) }).preview('skinned', folder);
      assert.deepEqual(issues, []);
      assert.deepEqual(ops.map((o) => o.at.join('.')), [
        'chars.char_102_texas.illust',
        'chars.char_102_texas.skins.char_102_texas@sightseer#2.name',
        'chars.char_102_texas.skins.char_102_texas@sightseer#2.group',
        'chars.char_102_texas.skins.char_102_texas@sightseer#2.avatar',
      ]);
      assert.deepEqual(ops.filter((o) => o.value === '悠然假日' || o.value === '').map((o) => [o.at.at(-1), o.value]), [['name', '悠然假日'], ['group', '']], 'a line of the manifest as it is');
      assert.match(ops[0].value, /^\/studio\/api\/plugins\/skinned\/f\/[0-9a-f]{8}\/art\/pepe\.png$/, 'a picture is the studio\'s URL');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
