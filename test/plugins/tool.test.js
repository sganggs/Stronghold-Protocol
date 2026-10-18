// test/plugins/tool.test.js — tools/plugin.mjs pack and the cosmetic template (DESIGN §32 P1a): pack writes
// plugin.lock.json — every file's SHA-256 and size, each Spine model's clip data parsed from the skeleton the way the
// game's own models are (roles, durations, events, hits, bounds) — and checks the folder; an atlas page `textures` does
// not name refuses the lock; a skeleton changed after the pack is refused until it is packed again; `check` follows a
// cosmetic plugin's references to this checkout's data/assets.json; plugins/_template/cosmetic/ is a valid cosmetic
// plugin made of references only — no file of the game.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { main, buildPluginLock } from '../../tools/plugin.mjs';
import { readPluginFolder, readVanillaAssets, listPluginFiles } from '../../server/plugins/registry.js';
import { png, skel, atlas, writePlugin, cosmetic } from '../helpers/pluginFixtures.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const quiet = async (argv) => {
  const out = [];
  const log = console.log;
  const err = console.error;
  console.log = (...a) => out.push(a.join(' '));
  console.error = (...a) => out.push(a.join(' '));
  try { return { code: await main(argv), out: out.join('\n') }; } finally { console.log = log; console.error = err; }
};

test('pack writes plugin.lock.json: the files\' hashes and each model\'s clip data; then the plugin loads', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-pack-'));
  try {
    const p = writePlugin(path.join(dir, 'texas-red'), cosmetic({ assets: { chars: { char_102_texas: { spine: { front: { skel: 'spine/t.skel' } } }, char_112_siege: { avatar: 'a.png' } } } }), {
      'spine/t.skel': skel({ animations: { Idle: [['OnStart', 2]], Attack: [['OnAttack', 0.3], ['OnAttack', 0.6]], Skill_2_Loop: [['OnAttack', 0.4]] } }),
      'spine/t.atlas': atlas(['t.png']), 'spine/t.png': png(4, 4), 'a.png': png(2, 2), 'README.md': '# texas\n',
    });
    // before the pack: the model has no clip data, the plugin is kept out
    assert.match(readPluginFolder(p).problems.join(), /plugin\.lock\.json has no clip data for spine\/t\.skel/);
    const r = await quiet(['pack', p, '--root', ROOT]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /wrote plugin\.lock\.json \(6 files, 1 Spine model\)/);
    const lock = JSON.parse(fs.readFileSync(path.join(p, 'plugin.lock.json'), 'utf8'));
    assert.deepEqual([lock.lock, lock.id, lock.version, lock.generator], [1, 'texas-red', '1.0.0', 'tools/plugin.mjs pack']);
    assert.deepEqual(Object.keys(lock.files).sort(), ['README.md', 'a.png', 'plugin.json', 'spine/t.atlas', 'spine/t.png', 'spine/t.skel']);
    assert.equal(lock.files['a.png'].sha256, sha(fs.readFileSync(path.join(p, 'a.png'))));
    const s = lock.spine['spine/t.skel'];
    assert.equal(s.sha256, sha(fs.readFileSync(path.join(p, 'spine/t.skel'))));
    assert.deepEqual([s.anims.idle, s.anims.attack.loop, s.anims.skill.loop, s.anims.skills['1'].loop], ['Idle', 'Attack', 'Attack', 'Skill_2_Loop'], 'an operator: its three skill slots');
    assert.deepEqual([s.animations, s.events, s.hits, s.bounds], [{ Idle: 2, Attack: 0.6, Skill_2_Loop: 0.4 }, ['OnStart', 'OnAttack'], { Attack: [0.3, 0.6], Skill_2_Loop: [0.4] }, { x: -50, y: 0, width: 100, height: 120 }]);
    const loaded = readPluginFolder(p, { vanilla: readVanillaAssets(path.join(ROOT, 'data')) });
    assert.deepEqual(loaded.problems, []);
    assert.deepEqual(loaded.plugin.visual.ops.find((o) => o.spine).spine.meta.hits, { Attack: [0.3, 0.6], Skill_2_Loop: [0.4] });
    // the skeleton changed after the pack: refused until it is packed again
    fs.writeFileSync(path.join(p, 'spine/t.skel'), skel({ animations: { Idle: [['OnStart', 1]] } }));
    assert.match(readPluginFolder(p).problems.join(), /plugin\.lock\.json was made from another spine\/t\.skel — run node tools\/plugin\.mjs pack again/);
    assert.equal((await quiet(['pack', p])).code, 0);
    assert.deepEqual(readPluginFolder(p).problems, []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('pack refuses an atlas page the model does not list, a skeleton the client cannot read, and a folder without plugin.json', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-pack-'));
  try {
    const p = writePlugin(path.join(dir, 'pages'), cosmetic({ assets: { chars: { char_102_texas: { spine: { front: { skel: 'm/t.skel' } } } } } }), {
      'm/t.skel': skel(), 'm/t.atlas': atlas(['t.png', 't2.png']), 'm/t.png': png(), 'm/t2.png': png(),
    });
    const r = await quiet(['pack', p]);
    assert.equal(r.code, 1);
    assert.match(r.out, /m\/t\.atlas: its page m\/t2\.png is not in "textures"/);
    assert.match(r.out, /plugin\.lock\.json not written/);
    assert.equal(fs.existsSync(path.join(p, 'plugin.lock.json')), false);
    const junk = writePlugin(path.join(dir, 'junk'), cosmetic({ assets: { chars: { char_102_texas: { spine: { front: { skel: 'j.skel' } } } } } }), {
      'j.skel': 'not a skeleton', 'j.atlas': atlas(['j.png']), 'j.png': png(),
    });
    assert.match(buildPluginLock(junk).problems.join(), /j\.skel: not a Spine 3\.8 skeleton the client can read/);
    assert.equal((await quiet(['pack', path.join(dir, 'nothing-here')])).code, 2);
    assert.equal((await quiet(['pack'])).code, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('pack writes no lock while the overlay has a problem (a reference the manifest lacks); one skeleton, two kinds of entry: both role sets', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-pack-'));
  try {
    const bad = writePlugin(path.join(dir, 'badref'), cosmetic({ assets: { chars: { char_102_texas: { avatar: { ref: 'char_000_nobody' }, spine: { front: { skel: 's/t.skel' } } } } } }), {
      's/t.skel': skel(), 's/t.atlas': atlas(['t.png']), 's/t.png': png(),
    });
    const r = await quiet(['pack', bad, '--root', ROOT]);
    assert.equal(r.code, 1);
    assert.match(r.out, /has no chars\.char_000_nobody\.avatar/);
    assert.equal(fs.existsSync(path.join(bad, 'plugin.lock.json')), false);
    // one skeleton drawn for an operator and for an enemy: an operator's three skill slots and an enemy's numbered clips
    const both = writePlugin(path.join(dir, 'both'), cosmetic({ permissions: ['assets.override', 'assets.add'], assets: {
      chars: { char_102_texas: { spine: { front: { skel: 's/t.skel' } } } }, enemies: { enemy_x_new: { spine: { skel: 's/t.skel' } } },
    } }), { 's/t.skel': skel({ animations: { Idle: [['OnStart', 1]], Attack: [['OnAttack', 0.3]], Skill_4: [['OnAttack', 0.5]] } }), 's/t.atlas': atlas(['t.png']), 's/t.png': png() });
    assert.equal((await quiet(['pack', both, '--root', ROOT])).code, 0);
    const roles = JSON.parse(fs.readFileSync(path.join(both, 'plugin.lock.json'), 'utf8')).spine['s/t.skel'].anims;
    assert.deepEqual(Object.keys(roles.skills).sort(), ['0', '1', '2', '3'], 'skills 0–2 (an operator) and the numbered Skill_4 (an enemy)');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('check follows a cosmetic plugin\'s references to this checkout\'s data/assets.json', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-check-'));
  try {
    const p = writePlugin(path.join(dir, 'refs'), cosmetic({ assets: { chars: { char_102_texas: { avatar: { ref: 'char_000_nobody' } } } } }));
    const r = await quiet(['check', p, '--root', ROOT]);
    assert.equal(r.code, 1);
    assert.match(r.out, /\{ "ref": "char_000_nobody" \} — this installation's art manifest \(data\/assets\.json\) has no chars\.char_000_nobody\.avatar/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the cosmetic template: original real media and installed references, no file of the game; valid against this checkout\'s manifest', async () => {
  const tpl = path.join(ROOT, 'plugins', '_template', 'cosmetic');
  assert.deepEqual(listPluginFiles(tpl).map((f) => f.rel).sort(), ['README.md', 'media/sample.ogg', 'media/sample.png', 'plugin.json'], 'original media files in the template');
  const r = readPluginFolder(tpl, { vanilla: readVanillaAssets(path.join(ROOT, 'data')) });
  assert.deepEqual([r.problems, r.warnings], [[], []]);
  assert.equal(r.plugin.class, 'cosmetic');
  assert.ok(r.plugin.visual.ops.some((o) => o.ref), 'installed references remain usable');
  assert.equal(r.plugin.visual.served.size, 2, 'both original files are served');
  const m = JSON.parse(fs.readFileSync(path.join(tpl, 'plugin.json'), 'utf8'));
  assert.equal(m.id, undefined, 'the folder name decides the id: a copy needs no edit of it');
  assert.equal((await quiet(['check', tpl])).code, 0);
});

test('new: every template makes a folder that passes check and pack as it is (manifest, README, no file of the game)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-new-'));
  try {
    const list = await quiet(['new']);
    assert.equal(list.code, 0);
    for (const id of ['art', 'spine', 'voice', 'audio']) assert.match(list.out, new RegExp(`^ {2}${id} +cosmetic`, 'm'));
    const cases = [['art', 'red-texas', '德克萨斯'], ['spine', 'texas-model', 'char_102_texas'], ['voice', 'texas-voice', '德克萨斯'], ['audio', 'lobby-music', '大厅音乐'], ['art', 'no-target', null]];
    for (const [tpl, id, target] of cases) {
      const r = await quiet(['new', tpl, id, '--dir', dir, '--name', `${tpl} 名字`, '--author', 'me', ...(target ? ['--target', target] : []), '--root', ROOT]);
      assert.equal(r.code, 0, r.out);
      const folder = path.join(dir, id);
      const sample = id === 'red-texas' ? 'art/char_102_texas/avatar.png' : id === 'lobby-music' ? 'music/lobby/loop.ogg' : null;
      assert.deepEqual(listPluginFiles(folder).map((f) => f.rel).sort(), ['README.md', 'plugin.json', ...(sample ? [sample] : [])].sort());
      if (sample) assert.deepEqual(fs.readFileSync(path.join(folder, sample)), fs.readFileSync(path.join(ROOT, 'plugins/_template/cosmetic/media/sample.' + (tpl === 'art' ? 'png' : 'ogg'))));
      const m = JSON.parse(fs.readFileSync(path.join(folder, 'plugin.json'), 'utf8'));
      assert.deepEqual([m.manifest, m.class, m.version, m.authors, m.name], [2, 'cosmetic', '1.0.0', ['me'], { zh: `${tpl} 名字` }]);
      const c = await quiet(['check', folder, '--strict', '--root', ROOT]);
      assert.equal(c.code, 0, `${id}: ${c.out}`);
      const p = await quiet(['pack', folder, '--root', ROOT]);
      assert.equal(p.code, 0, `${id}: ${p.out}`);
    }
    assert.match(fs.readFileSync(path.join(dir, 'red-texas', 'README.md'), 'utf8'), /德克萨斯（char_102_texas）/);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'lobby-music', 'plugin.json'), 'utf8')).assets, { audio: { bgm: { lobby: { loop: 'music/lobby/loop.ogg' } } } });
    assert.equal((await quiet(['new', 'art', 'red-texas', '--dir', dir])).code, 2, 'an existing folder');
    assert.equal((await quiet(['new', 'nope', 'zz-zz', '--dir', dir])).code, 2, 'no such template');
    assert.equal((await quiet(['new', 'art', 'Bad_Id', '--dir', dir])).code, 2, 'no plugin id');
    assert.equal((await quiet(['new', 'voice', 'zz-zz', '--dir', dir, '--target', '大厅音乐', '--root', ROOT])).code, 2, 'a target the template does not change');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('new dsl: a content plugin with an operator and a prep spec, and it passes check --strict and pack', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-new-dsl-'));
  try {
    const list = await quiet(['new']);
    assert.match(list.out, /^ {2}dsl +content/m);
    const r = await quiet(['new', 'dsl', 'demo-dsl', '--dir', dir, '--name', 'DSL demo', '--author', 'me', '--root', ROOT]);
    assert.equal(r.code, 0, r.out);
    const folder = path.join(dir, 'demo-dsl');
    assert.deepEqual(listPluginFiles(folder).map((f) => f.rel).sort(), ['README.md', 'dsl/income.json', 'operators/demo_dsl.json', 'plugin.json']);
    const m = JSON.parse(fs.readFileSync(path.join(folder, 'plugin.json'), 'utf8'));
    assert.deepEqual([m.class, m.scope, m.permissions, m.operators, m.dsl], ['content', ['room'], ['data.add', 'dsl'], ['operators/demo_dsl.json'], ['dsl/income.json']]);
    assert.equal(m.id, undefined);
    const op = JSON.parse(fs.readFileSync(path.join(folder, 'operators/demo_dsl.json'), 'utf8'));
    assert.equal(op.kit.dsl.skill.mods.atkPct, 0.5);
    assert.equal(op.charId, 'char_x_demo_dsl_caster');
    const prep = JSON.parse(fs.readFileSync(path.join(folder, 'dsl/income.json'), 'utf8'));
    assert.equal(prep.meta.key, 'effect:demo-dsl:income');
    const c = await quiet(['check', folder, '--strict', '--root', ROOT]);
    assert.equal(c.code, 0, c.out);
    const p = await quiet(['pack', folder, '--root', ROOT]);
    assert.equal(p.code, 0, p.out);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('check in plain words: under each technical line its code, the explanation and what to do (--lang zh|en); --json for editors and AI agents', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-plain-'));
  try {
    const p = writePlugin(path.join(dir, 'plain'), cosmetic({ version: '1', colour: 'x', assets: { chars: { char_102_texas: { avatar: 'a.png' } } } }), { 'a.png': png() });
    const zh = await quiet(['check', p, '--root', ROOT]);
    assert.equal(zh.code, 1);
    assert.match(zh.out, /^ {2}problem {2}"version": "1" is not a semantic version/m);
    assert.match(zh.out, /^ {11}↳ PLUGIN_VERSION 插件的版本号 "version" 没写，或者写法不对。改法：写成三段数字，例如 "1\.0\.0"/m);
    assert.match(zh.out, /^ {11}↳ PLUGIN_FIELD_UNKNOWN 「colour」不是清单里的字段，被忽略了/m);
    const en = await quiet(['check', p, '--lang', 'en', '--root', ROOT]);
    assert.match(en.out, /↳ PLUGIN_VERSION The plugin's "version" is missing or not a version number\. Fix: Write three numbers/);
    const json = await quiet(['check', p, '--json', '--root', ROOT]);
    const body = JSON.parse(json.out);
    assert.deepEqual([body.problems, body.warnings, body.folders[0].loadable], [1, 1, false]);
    const v = body.folders[0].issues.find((i) => i.code === 'PLUGIN_VERSION');
    assert.deepEqual([v.level, v.at, v.autofix, v.doc], ['problem', ['version'], 'setVersion', 'docs/PLUGINS.md#3-the-manifest-manifest-2']);
    assert.match(v.message, /版本号/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('pack --zip: the lock, then the folder as a zip (deterministic) — by default into plugins/_dist/, never read as a plugin', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-zip-'));
  try {
    const p = writePlugin(path.join(dir, 'zipped'), cosmetic({ assets: { chars: { char_102_texas: { avatar: 'art/a.png' } } } }), { 'art/a.png': png(), 'LICENSE': 'CC0' });
    const out = path.join(dir, 'out');
    const r = await quiet(['pack', p, '--zip', '--out', `${out}/`, '--root', ROOT]);
    assert.equal(r.code, 0, r.out);
    const zip = fs.readFileSync(path.join(out, 'zipped-1.0.0.zip'));
    const { unzipFiles } = await import('../../server/plugins/zip.js');
    assert.deepEqual(unzipFiles(zip).map((e) => e.name), ['zipped/LICENSE', 'zipped/art/a.png', 'zipped/plugin.json', 'zipped/plugin.lock.json']);
    await quiet(['pack', p, '--zip', '--out', path.join(out, 'again.zip'), '--root', ROOT]);
    assert.ok(fs.readFileSync(path.join(out, 'again.zip')).equals(zip), 'the same files, the same bytes');
    // the default place: <root>/plugins/_dist/ (a '_' folder the registry never reads)
    const root2 = path.join(dir, 'root');
    fs.mkdirSync(path.join(root2, 'plugins'), { recursive: true });
    fs.mkdirSync(path.join(root2, 'data'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'data', 'assets.json'), path.join(root2, 'data', 'assets.json'));
    assert.equal((await quiet(['pack', p, '--zip', '--root', root2])).code, 0);
    assert.ok(fs.existsSync(path.join(root2, 'plugins', '_dist', 'zipped-1.0.0.zip')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('errors: the catalogue in plain words; --markdown its symptom table', async () => {
  const r = await quiet(['errors']);
  assert.match(r.out, /^PLUGIN_LOCK_MISSING +problem +模型 \{file\} 还没有动画数据.+\[pack\]$/m);
  const md = await quiet(['errors', '--markdown', '--lang', 'en']);
  assert.match(md.out, /^\| Symptom \| Code \| Cause \| Fix \|$/m);
});
