// tools/local-extract/skins.py — the official outfits (--only skins) and the picture gallery (--only library), ported from
// PR #776 by @xcdoge (DESIGN §37.331). No game client: duck-typed UnityPy fakes built from original synthetic pixels and
// skeletons (test/helpers/pluginFixtures.js), as the other local-extract tests do. Covers the plan from skin_table, the
// opt-in selection in extract.py, Front / Back by node name, the hot update overlay, plugin-safe names with the atlas
// rewritten, no overwrite between two outfits or pictures of one name, the gallery's per-kind dedup, picture-only outfits,
// the plugin parts, and extraction → plugin.json → `node tools/plugin.mjs pack`.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fxFixture } from '../helpers/fxFixtures.js';
import { png, skel } from '../helpers/pluginFixtures.js';
import { PLUGIN_CLASSES, PLUGIN_LIMITS } from '../../shared/plugins/manifest.js';
import { WALK_LIMITS } from '../../server/plugins/registry.js';
import { LOCAL_ONLY_ART_PREFIXES, artPlan } from '../../tools/package.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const TOOL = path.join(ROOT, 'tools/local-extract');
const PY = ['python3', 'python'].find((bin) => spawnSync(bin, ['--version']).status === 0);
const PIL = PY && spawnSync(PY, ['-c', 'import PIL']).status === 0;
const ENV = { ...process.env, PYTHONDONTWRITEBYTECODE: '1' };

function py(code, args = [], env = ENV) {
  const src = `import sys, json\nsys.path.insert(0, ${JSON.stringify(TOOL)})\nimport skins as s, extract as ex\n${code}`;
  const r = spawnSync(PY, ['-B', '-c', src, ...args], { encoding: 'utf8', env, maxBuffer: 1 << 26 });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

// A fake client: bundles of duck-typed objects that UnityPy.load hands out by bundle path (relative to the AB root). No
// Pillow: PngFile is a picture whose save() writes PNG bytes made in JavaScript (pluginFixtures png); PIL_FAKE adds
// Pillow images for the pixel tests.
const FAKE = `
from types import SimpleNamespace as NS
from pathlib import Path
_ids = [100]
def ref(o):
    return {'m_FileID': 0, 'm_PathID': o.path_id if o is not None else 0}
class Obj:
    def __init__(self, kind, tt=None, data=None, name=None):
        _ids[0] += 1
        self.path_id, self.type, self.tt, self.data, self.name = _ids[0], NS(name=kind), tt, data, name
    def read_typetree(self): return self.tt
    def read(self): return self.data
    def peek_name(self): return self.name
class Bundle:
    def __init__(self): self.objects, self.container = [], {}
    def add(self, kind, tt=None, data=None, name=None):
        o = Obj(kind, tt, data, name); self.objects.append(o); return o
class PngFile:
    def __init__(self, path):
        self.data = Path(path).read_bytes()
        self.width, self.height = int.from_bytes(self.data[16:20], 'big'), int.from_bytes(self.data[20:24], 'big')
    def save(self, path, fmt='PNG', **kw):
        assert fmt == 'PNG', fmt
        Path(path).write_bytes(self.data)
def png_width(path): return int.from_bytes(Path(path).read_bytes()[16:20], 'big')
def sprite(b, name, img, rect=None, offset=(0, 0), texture=None):
    r = rect or (0, 0, img.width, img.height)
    data = NS(m_Name=name, image=img, m_Rect=NS(x=r[0], y=r[1], width=r[2], height=r[3]),
              m_RD=NS(textureRectOffset=NS(x=offset[0], y=offset[1]), texture=NS(read=lambda: texture)))
    return b.add('Sprite', data=data, name=name)
def spine(b, name, skel_bytes, pages):
    sk = b.add('TextAsset', data=NS(m_Name=name + '.skel', m_Script=skel_bytes))
    text = ''.join('\\n%s.png\\nsize: %d,%d\\nformat: RGBA8888\\nfilter: Linear,Linear\\nrepeat: none\\npma: true\\n' % (p, i.width, i.height) for p, i, a in pages)
    at = b.add('TextAsset', data=NS(m_Name=name + '.atlas', m_Script=text.encode()))
    mats = []
    for p, img, alpha in pages:
        tex = b.add('Texture2D', data=NS(m_Name=p, image=img))
        envs = [['_MainTex', {'m_Texture': ref(tex)}]]
        if alpha is not None:
            envs.append(['_AlphaTex', {'m_Texture': ref(b.add('Texture2D', data=NS(m_Name=p + '[alpha]', image=alpha)))}])
        mats.append(b.add('Material', tt={'m_SavedProperties': {'m_TexEnvs': envs}}))
    aa = b.add('MonoBehaviour', tt={'atlasFile': ref(at), 'materials': [ref(m) for m in mats]})
    return b.add('MonoBehaviour', tt={'m_Name': name + '_SkeletonData', 'skeletonJSON': ref(sk), 'atlasAssets': [ref(aa)]})
def node(b, name, comps=(), children=(), kind='Transform'):
    tr = b.add(kind, tt={'m_Children': [ref(c[1]) for c in children]})
    g = b.add('GameObject', tt={'m_Name': name, 'm_IsActive': 1, 'm_Component': [{'component': ref(tr)}] + [{'component': ref(c)} for c in comps]})
    tr.tt['m_GameObject'] = ref(g)
    return g, tr
def battle_prefab(b, key, faces):
    kids = [node(b, n, [b.add('MonoBehaviour', tt={'skeletonDataAsset': ref(sda)})]) for n, sda in faces]
    b.container[key] = node(b, key.rsplit('/', 1)[1][:-7], (), kids)[0]
def illust_prefab(b, key, spr, material=None):
    img = b.add('MonoBehaviour', tt={'m_Sprite': ref(spr), 'm_Material': ref(material)})
    b.container[key] = node(b, key.rsplit('/', 1)[1][:-7], [img], (), 'RectTransform')[0]
def install(ab, bundles):
    for rel in bundles:
        p = Path(ab) / rel; p.parent.mkdir(parents=True, exist_ok=True); p.write_text('synthetic bundle ' + rel, encoding='utf-8')
    def load(path):
        rel = Path(path).resolve().relative_to(Path(ab).resolve()).as_posix()
        return bundles[rel]
    sys.modules['UnityPy'] = NS(load=load)
    sys.modules['aklz4'] = NS()
`;
const PIL_FAKE = `
from PIL import Image
def solid(w, h, rgba): return Image.new('RGBA', (w, h), rgba)
`;

// The client of the end-to-end tests: two outfits of char_102_texas (one with a model, whose Back renderer comes FIRST in
// the prefab and whose two skeletons, pages and textures share one official name; one picture-only, whose `+` id makes the
// same plugin-safe folder name), a model outfit whose prefab is missing, and an operator without a skin pack.
const CLIENT = `
TABLE = {'charSkins': {
  'char_102_texas#1': {'charId': 'char_102_texas', 'avatarId': 'char_102_texas', 'battleSkin': {'skinOrPrefabId': 'DefaultSkin'}, 'displaySkin': {'skinName': None, 'skinGroupName': '默认服装'}},
  'char_102_texas@epoque#7': {'charId': 'char_102_texas', 'illustId': 'illust_char_102_texas_epoque#7', 'avatarId': 'char_102_texas_epoque#7', 'portraitId': 'char_102_texas_epoque#7',
    'battleSkin': {'overwritePrefab': False, 'skinOrPrefabId': 'char_102_texas_epoque#7'}, 'displaySkin': {'skinName': '意志 SS.SP', 'skinGroupName': '时代/VII', 'sortId': 2}},
  'char_102_texas@epoque+7': {'charId': 'char_102_texas', 'illustId': 'illust_char_102_texas_epoque+7', 'avatarId': 'char_102_texas_epoque+7', 'portraitId': 'char_102_texas_epoque+7',
    'battleSkin': {'overwritePrefab': False, 'skinOrPrefabId': 'DefaultSkin'}, 'displaySkin': {'skinName': '图片', 'skinGroupName': 'i.t', 'sortId': 1}},
  'char_9001_test@sale#1': {'charId': 'char_9001_test', 'illustId': 'illust_char_9001_test_sale#1', 'avatarId': 'char_9001_test_sale#1', 'portraitId': 'char_9001_test_sale#1',
    'battleSkin': {'skinOrPrefabId': 'char_9001_test_sale#1'}, 'displaySkin': {'skinName': '缺模型', 'skinGroupName': '测试'}},
  'char_9002_none@sale#1': {'charId': 'char_9002_none', 'avatarId': 'char_9002_none_sale#1',
    'battleSkin': {'skinOrPrefabId': 'char_9002_none_sale#1'}, 'displaySkin': {'skinName': '无包', 'skinGroupName': '测试'}},
}}
FRONT, BACK = Path(sys.argv[1]).read_bytes(), Path(sys.argv[2]).read_bytes()
avatars, portraits, texas, test9001 = Bundle(), Bundle(), Bundle(), Bundle()
for sid in ('char_102_texas_epoque#7', 'char_102_texas_epoque+7', 'char_9001_test_sale#1', 'char_9002_none_sale#1'):
    sprite(avatars, sid, solid(4, 4, (10, 20, 30, 255)))
    sprite(portraits, sid, solid(4, 8, (30, 20, 10, 255)))
sprite(avatars, 'char_102_texas_epoque#7', solid(2, 2, (0, 0, 0, 255)))  # a second sprite of the name in a later pack entry
name = 'char_102_texas_epoque#7'
front = spine(texas, name, FRONT, [(name, solid(4, 4, (200, 10, 10, 255)), Image.new('L', (4, 4), 128)),
                                   (name + '_2', solid(4, 4, (10, 200, 10, 255)), None)])
back = spine(texas, name, BACK, [(name, solid(4, 4, (10, 10, 200, 255)), Image.new('L', (4, 4), 64))])
battle_prefab(texas, 'dyn/battle/prefabs/skins/character/char_102_texas/' + name + '.prefab', [('Back', back), ('Front', front)])
illust_prefab(texas, 'dyn/arts/characters/char_102_texas/illust_' + name + '.prefab',
              sprite(texas, name, solid(4, 4, (250, 250, 0, 255)), rect=(0, 0, 8, 8), offset=(2, 1)))
illust_prefab(texas, 'dyn/arts/characters/char_102_texas/illust_' + name + 'b.prefab', sprite(texas, name + 'b', solid(8, 8, (1, 1, 1, 255))))
tex = texas.add('Texture2D', data=NS(m_Name='char_102_texas_epoque+7', image=solid(8, 8, (0, 90, 200, 255))))
alpha = texas.add('Texture2D', data=NS(m_Name='char_102_texas_epoque+7[alpha]', image=Image.new('L', (4, 4), 200)))
mat = texas.add('Material', tt={'m_SavedProperties': {'m_TexEnvs': [['_MainTex', {'m_Texture': ref(tex)}], ['_AlphaTex', {'m_Texture': ref(alpha)}]]}})
illust_prefab(texas, 'dyn/arts/characters/char_102_texas/illust_char_102_texas_epoque+7.prefab',
              sprite(texas, 'char_102_texas_epoque+7', solid(8, 8, (0, 90, 200, 255)), texture=tex.data), mat)
illust_prefab(test9001, 'dyn/arts/characters/char_9001_test/illust_char_9001_test_sale#1.prefab', sprite(test9001, 'x', solid(4, 4, (1, 2, 3, 255))))
BUNDLES = {'spritepack/ui_char_avatar_0.ab': avatars, 'spritepack/char_portrait_0.ab': portraits,
           'skinpack/char_102_texas.ab': texas, 'skinpack/char_9001_test.ab': test9001}
`;

/**
 * A locale whose code page Python takes for a pipe it decodes as text and that is not UTF-8 (macOS zh_CN.GBK, a Windows
 * runner's own ANSI code page), as { env, encoding }; else null and the test runs in the default one. PYTHONUTF8=0
 * keeps the locale's code page also where UTF-8 mode becomes the default. Not on Linux: there Python names files in that
 * code page too, which node (UTF-8) does not read back.
 */
function legacyLocale() {
  if (!PY || process.platform === 'linux') return null;
  const tries = process.platform === 'win32' ? [{}] : [{ LC_ALL: 'zh_CN.GBK' }, { LC_ALL: 'zh_CN.GB18030' }, { LC_ALL: 'en_US.ISO8859-1' }];
  for (const extra of tries) {
    const env = { ...ENV, PYTHONUTF8: '0', ...extra };
    const r = spawnSync(PY, ['-c', 'import locale; print(locale.getpreferredencoding(False))'], { encoding: 'utf8', env });
    const encoding = String(r.stdout || '').trim();
    if (r.status === 0 && encoding && !/^utf-?8$/i.test(encoding)) return { env, encoding };
  }
  return null;
}

function clientFiles(t) {
  const f = fxFixture(t);
  f.put('front.skel', skel());
  f.put('back.skel', skel({ animations: { Idle: [['OnStart', 1]] } }));
  return f;
}

/** Every file under a folder, relative, sorted. */
function tree(dir) {
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile())
    .map((e) => path.relative(dir, path.join(e.parentPath ?? e.path, e.name)).split(path.sep).join('/')).sort();
}

describe('skins.py: the official outfits and the picture gallery (no game client)', { skip: !PY && 'no python3' }, () => {
  test('the Python ceilings are the plugin rules they copy (cosmetic bytes, files, folders, skins per record, text length)', () => {
    const got = py(`print(json.dumps([s.PLUGIN_BYTES, s.PLUGIN_FILES, s.PLUGIN_DIRS, s.SKINS_PER_RECORD, s.TEXT_MAX]))`);
    const visual = fs.readFileSync(path.join(ROOT, 'shared/plugins/visual.js'), 'utf8');
    assert.deepEqual(got, [PLUGIN_CLASSES.cosmetic.bytes, PLUGIN_LIMITS.files, WALK_LIMITS.dirs,
      Number(visual.match(/const SKINS_MAX = (\d+)/)[1]), Number(visual.match(/const TEXT_MAX = (\d+)/)[1])]);
  });

  test('plan: alternative outfits only, per template operator, official order, picture-only and unique plugin-safe folders', () => {
    const got = py(`table = {'charSkins': {
  'char_002_amiya#1': {'charId': 'char_002_amiya', 'displaySkin': {'skinGroupName': '默认服装'}},
  'char_1037_amiya3#2': {'charId': 'char_002_amiya', 'tmplId': 'char_1037_amiya3', 'displaySkin': {'skinGroupName': '默认服装'}},
  'char_1037_amiya3@sale#13': {'charId': 'char_002_amiya', 'tmplId': 'char_1037_amiya3', 'illustId': 'illust_char_1037_amiya3_sale#13',
    'avatarId': 'char_1037_amiya3_sale#13', 'portraitId': 'char_1037_amiya3_sale#13',
    'battleSkin': {'overwritePrefab': False, 'skinOrPrefabId': 'char_1037_amiya3_sale#13'}, 'displaySkin': {'skinName': '  寻访\\n者 ', 'skinGroupName': '忒斯特收藏/XIII', 'sortId': 5}},
  'char_102_texas@b#1': {'charId': 'char_102_texas', 'battleSkin': {'skinOrPrefabId': 'DefaultSkin'}, 'displaySkin': {'skinName': '', 'skinGroupName': 'G' * 80, 'sortId': 9}},
  'char_102_texas@b+1': {'charId': 'char_102_texas', 'battleSkin': None, 'displaySkin': {'skinName': 'X' * 80, 'sortId': 3}},
  'char_103_angel@a#1': {'charId': 'char_103_angel', 'battleSkin': {'skinOrPrefabId': 'char_103_angel_a#1'}, 'displaySkin': {'skinName': '能天使'}},
}}
print(json.dumps({'all': s.plan(table), 'some': [j['skinId'] for j in s.plan(table, ['char_102_texas'])],
  'owners': s.table_owners(table), 'safe': [s.plugin_safe(x) for x in ['boc#6', 'a+', '@#', '../x', 'Ünï']],
  'unique': [s.unique(n, t) for t in [set()] for n in ['a', 'A', 'a', 'b']]}))`);
    const byId = Object.fromEntries(got.all.map((j) => [j.skinId, j]));
    // by operator (Python's string order: '7' sorts before '_'), then official order
    assert.deepEqual(got.all.map((j) => j.skinId), ['char_102_texas@b+1', 'char_102_texas@b#1', 'char_1037_amiya3@sale#13', 'char_103_angel@a#1']);
    assert.ok(!got.all.some((j) => !j.skinId.includes('@')), 'default outfits (#1, #2, char_1037_amiya3#2) are the operator\'s own art');
    assert.equal(byId['char_1037_amiya3@sale#13'].char, 'char_1037_amiya3', 'a patch form dresses its template operator');
    assert.equal(byId['char_1037_amiya3@sale#13'].model, 'char_1037_amiya3_sale#13');
    assert.equal(byId['char_1037_amiya3@sale#13'].name, '寻访 者');
    assert.equal(byId['char_1037_amiya3@sale#13'].dir, 'char_1037_amiya3/sale_13');
    // official order (displaySkin.sortId): b+1 (3) before b#1 (9) — and their plugin-safe folders never coincide
    assert.deepEqual(got.all.filter((j) => j.char === 'char_102_texas').map((j) => [j.skinId, j.dir]),
      [['char_102_texas@b+1', 'char_102_texas/b_1'], ['char_102_texas@b#1', 'char_102_texas/b_1_2']]);
    assert.equal(byId['char_102_texas@b#1'].model, null, 'DefaultSkin keeps the operator\'s own model: pictures only');
    assert.equal(byId['char_102_texas@b+1'].model, null, 'no battleSkin either');
    assert.equal(byId['char_102_texas@b#1'].name, 'char_102_texas@b#1', 'an empty name falls back to the id');
    assert.equal(byId['char_102_texas@b#1'].group.length, 64);
    assert.equal(byId['char_102_texas@b+1'].name.length, 64);
    assert.deepEqual(got.some, ['char_102_texas@b+1', 'char_102_texas@b#1']);
    assert.deepEqual(got.owners, ['char_102_texas', 'char_1037_amiya3', 'char_103_angel']);
    assert.deepEqual(got.safe, ['boc_6', 'a', 'unnamed', 'x', 'n']);
    assert.deepEqual(got.unique, ['a', 'A_2', 'a_3', 'b'], 'compared without case: one file on Windows and macOS');
  });

  test('records, permissions, parts and merging are the plugin\'s rules', () => {
    const got = py(`job = {'name': 'n', 'group': ''}
print(json.dumps({
  'full': s.record(job, {'avatar': 'a/b/avatar.png', 'illust': 'a/b/illust.webp', 'front': {'skel': 'a/b/front.skel'}, 'back': {'skel': 'a/b/back.skel'}}),
  'pictures': s.record(job, {'portrait': 'a/b/portrait.png', 'back': {'skel': 'a/b/back.skel'}}),
  'nothing': s.record(job, {'illust': None}),
  'perms': [s.manifest({'char_102_texas': {}}, ['char_102_texas'], '0.4.1')['permissions'],
            s.manifest({'char_102_texas': {}, 'char_9001_test': {}}, ['char_102_texas'], '0.4.1')['permissions'],
            s.manifest({'char_9001_test': {}}, [], '0.4.1')['permissions']],
  'app': [s.app_range('0.4.1-dev'), s.app_range('1.12.0'), s.app_range('x')],
  'parts': [s.part_folder(1), s.part_folder(2), s.part_number('local-skins'), s.part_number('local-skins-12'),
            s.part_number('local-skins-1'), s.part_number('local-skins-01'), s.part_number('skins')],
  'name2': s.manifest({}, [], '0.4.1', 2)['name'],
  'merge': s.merge({'c': {'old': {'x': 1}, 'gone': {'x': 2}, 'same': {'x': 3}}}, {'c': {'same': {'x': 4}, 'new': {'x': 5}}},
                   lambda r: r['x'] != 2),
  'dir': [s.record_dir({'avatar': 'c/o/avatar.png', 'spine': {'front': {'skel': 'c/o/front.skel'}}}), s.record_dir({})],
}))`);
    assert.deepEqual(got.full.spine, { front: { skel: 'a/b/front.skel' }, back: { skel: 'a/b/back.skel' } });
    assert.deepEqual(got.pictures, { name: 'n', group: '', portrait: 'a/b/portrait.png' }, 'no front, no model (a Back alone draws nothing)');
    assert.equal(got.nothing, null);
    assert.deepEqual(got.perms, [['assets.override'], ['assets.override', 'assets.add'], ['assets.add']]);
    assert.deepEqual(got.app, ['>=0.4.0 <0.5.0', '>=1.12.0 <1.13.0', '*']);
    assert.deepEqual(got.parts, ['local-skins', 'local-skins-2', 1, 12, null, null, null]);
    assert.deepEqual(got.name2, { zh: '本机提取的时装（第 2 部分）', en: 'Outfits from the local client (part 2)' });
    assert.deepEqual(got.merge, { c: { same: { x: 4 }, new: { x: 5 }, old: { x: 1 } } });
    assert.deepEqual(got.dir, ['c/o', null]);
  });

  test('write_spine renames to plugin-safe files and rewrites the atlas page lines; without `rename` it is unchanged', { skip: !PIL && 'no Pillow' }, (t) => {
    const f = fxFixture(t);
    const got = py(`${FAKE}${PIL_FAKE}
b = Bundle()
sda = spine(b, 'a#1', b'skel', [('a#1', solid(4, 4, (9, 9, 9, 255)), None), ('a#1_2', solid(2, 2, (9, 9, 9, 255)), None)])
objs = {o.path_id: o for o in b.objects}
names = {}
def rename(kind, n):
    if kind == 'skel': return 'front'
    names.setdefault(n, 'front' if not names else 'front_%d' % (len(names) + 1)); return names[n]
m1, m2, logs = {}, {}, []
n1 = ex.write_spine(objs, sda.tt, 'r', 'a#1', ${JSON.stringify(f.root)}, m1, logs.append, rename=rename)
n2 = ex.write_spine(objs, sda.tt, 'plain', 'a#1', ${JSON.stringify(f.root)}, m2, logs.append)
print(json.dumps({'n': [n1, n2], 'files': sorted(m1['r']), 'atlas': open(${JSON.stringify(f.root)} + '/r/front.atlas', encoding='utf-8').read(),
  'pages': ex.rename_atlas_pages('a.png\\nsize: 1,1\\n\\nb.png\\nsize: 1,1\\nregion\\n  xy: 0,0', lambda p: p.upper()), 'logs': logs}))`);
    assert.deepEqual(got.n, [4, 0], 'the default names keep "#" in the atlas but not in the files: two pages do not match (unchanged)');
    assert.deepEqual(got.files, ['front.atlas', 'front.png', 'front.skel', 'front_2.png']);
    assert.match(got.atlas, /^\nfront\.png\nsize: 4,4\n/);
    assert.match(got.atlas, /\nfront_2\.png\nsize: 2,2\n/);
    assert.doesNotMatch(got.atlas, /#|pma/, 'plugin-safe pages; straight pages carry no pma (#668)');
    assert.equal(got.pages, 'A.PNG\nsize: 1,1\n\nB.PNG\nsize: 1,1\nregion\n  xy: 0,0');
  });

  test('extract.py: --only skins / library are opt-in, narrow by operator or kind, and never touch the manifest', (t) => {
    const f = fxFixture(t);
    f.put('table.json', { charSkins: {
      'char_102_texas@a#1': { charId: 'char_102_texas', displaySkin: { skinName: 'a' } },
      'char_9001_test@a#1': { charId: 'char_9001_test', displaySkin: { skinName: 'b' } },
    } });
    f.put('install/data/assets.json', { chars: { char_102_texas: {} } });
    let got = py(`from pathlib import Path
import contextlib, io
root = Path(${JSON.stringify(f.root)})
(root/'ab'/'ui'/'autochess').mkdir(parents=True)
calls = []
for name in ('export_bundle', 'export_enemy_spines', 'export_token_spines', 'export_scenes'):
    setattr(ex, name, lambda *a, **k: 0)
ex.versions.export = lambda *a, **k: 0
ex.season_entry.export = lambda *a, **k: 0
ex.cursor.export = lambda *a, **k: 0
outs = []
s.export = lambda ab, out, log, jobs, installed, version, limit, pack_root: outs.append(str(out)) or calls.append(['skins', [j['skinId'] for j in jobs], installed, limit]) or 3
s.export_library = lambda ab, out, log, kinds, limit: outs.append(str(out)) or calls.append(['library', kinds, limit]) or 2
runs = []
for i, flags in enumerate([[], ['--only', 'skins'], ['--only', 'skins/char_9001_test'], ['--only', 'library/opavatar', '--limit', '4'],
                           ['--only', 'library', '--only', 'skins'], ['--only', 'skins', '--skin-table', str(root/'missing.json')]]):
    calls.clear()
    sys.argv = ['extract.py', '--game', str(root/'ab'), '--out', str(root/('out%d' % i)), '--manifest', str(root/('m%d.json' % i)),
                '--plugin-root', str(root/'install'), '--skin-table', str(root/'table.json'), *flags]
    err = io.StringIO()
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(err):
        code = ex.main()
    runs.append({'code': code, 'calls': list(calls), 'manifest': (root/('m%d.json' % i)).exists(), 'err': err.getvalue()[:60]})
given = list(outs)
outs.clear()
sys.argv = ['extract.py', '--game', str(root/'ab'), '--manifest', str(root/'m9.json'), '--plugin-root', str(root/'install'),
            '--skin-table', str(root/'table.json'), '--only', 'skins', '--only', 'library/opavatar']
with contextlib.redirect_stdout(io.StringIO()):
    code = ex.main()
print(json.dumps({'runs': runs, 'given': given, 'default': [code, outs, str(ex.ROOT / 'out' / 'local-extract')]}))`);
    const { given, default: [code, outs, scratch] } = got;
    got = got.runs;
    assert.deepEqual(given, [1, 2, 3, 4, 4].map((i) => path.join(f.root, `out${i}`)), '--out given: the outfits and the gallery go there');
    assert.deepEqual([code, outs], [0, [scratch, scratch]], 'no --out: out/local-extract (ignored by git, not served), not public/assets/local');
    assert.deepEqual(got[0].calls, [], 'a plain run extracts no outfit and no gallery');
    assert.equal(got[0].manifest, true);
    assert.deepEqual(got[1].calls, [['skins', ['char_102_texas@a#1'], ['char_102_texas'], 0]], 'plain skins: the installation\'s operators');
    assert.equal(got[1].manifest, false, 'outfits are not listed in data/local-assets.json');
    assert.equal(got[1].code, 0);
    assert.deepEqual(got[2].calls, [['skins', ['char_9001_test@a#1'], ['char_102_texas'], 0]], 'a named operator outside the installation');
    assert.deepEqual(got[3].calls, [['library', ['opavatar'], 4]]);
    assert.equal(got[3].manifest, false);
    assert.deepEqual(got[4].calls.map((c) => c[0]), ['skins', 'library']);
    assert.deepEqual(got[4].calls[1][1], ['opillust', 'opportrait', 'opavatar']);
    assert.equal(got[5].code, 2);
    assert.match(got[5].err, /--only skins needs the official skin_table\.json/);
    const jobs = py(`print(json.dumps(ex.expected_local_groups()))`);
    assert.ok(!jobs.some((g) => g.startsWith('skins') || g.startsWith('library')), 'never expected: no install goes stale');
  });

  test('the skins job reads the Windows hot update over the packaged bundles (client_bundles)', (t) => {
    const f = fxFixture(t);
    f.put('table.json', { charSkins: { 'char_102_texas@a#1': { charId: 'char_102_texas', displaySkin: { skinName: 'a' } } } });
    const got = py(`from pathlib import Path
import contextlib, io
root = Path(${JSON.stringify(f.root)})
data = root / 'Arknights_Data'
base, hot = data / 'StreamingAssets/AB/Windows', data / 'PersistentData/Bundles'
def put(r, name, value):
    p = r / name; p.parent.mkdir(parents=True, exist_ok=True); p.write_text(value, encoding='utf-8')
def index(r, name, version, records):
    put(r, name, json.dumps({'versionId': version, 'manifestName': 'm.idx', 'manifestVersion': 'V1', 'abInfos': [{'name': n, 'hash': h} for n, h in records]}))
index(base, 'hot_update_list.json', '26-10-20', [('skinpack/char_102_texas.ab', 'old'), ('ui/autochess/x.ab', 'same')])
index(hot, 'hot_update_list.json', '26-11-06', [('skinpack/char_102_texas.ab', 'new'), ('ui/autochess/x.ab', 'same')])
index(hot, 'persistent_res_list.json', '26-11-06', [('skinpack/char_102_texas.ab', 'new')])
put(base, 'skinpack/char_102_texas.ab', 'packaged'); put(base, 'ui/autochess/x.ab', 'ui')
put(hot, 'skinpack/char_102_texas.ab', 'downloaded')
seen = []
s.export = lambda ab, out, log, jobs, *a: seen.append((Path(ab) / 'skinpack/char_102_texas.ab').read_text(encoding='utf-8')) or 1
ex.cursor.client_data = lambda *a: None
sys.argv = ['extract.py', '--game', str(base), '--only', 'skins', '--skin-table', str(root/'table.json'),
            '--out', str(root/'out'), '--manifest', str(root/'m.json')]
with contextlib.redirect_stdout(io.StringIO()):
    code = ex.main()
print(json.dumps({'code': code, 'seen': seen}))`);
    assert.deepEqual(got, { code: 0, seen: ['downloaded'] });
  });

  test('extraction → plugin → pack: Front / Back by node name, no overwrite, straight pages, picture-only, skips', { skip: !PIL && 'no Pillow' }, (t) => {
    const f = clientFiles(t);
    const out = path.join(f.root, 'out');
    const got = py(`${FAKE}${PIL_FAKE}${CLIENT}
import contextlib, io
root = Path(${JSON.stringify(f.root)})
(root/'ab'/'ui'/'autochess').mkdir(parents=True)
(root/'table.json').write_text(json.dumps(TABLE), encoding='utf-8')
install(root/'ab', BUNDLES)
ex.cursor.client_data = lambda *a: None
s.pack = lambda *a: None
sys.argv = ['extract.py', '--game', str(root/'ab'), '--only', 'skins', '--only', 'skins/char_9001_test', '--only', 'skins/char_9002_none',
            '--skin-table', str(root/'table.json'), '--out', ${JSON.stringify(out)}, '--manifest', str(root/'m.json')]
log = io.StringIO()
with contextlib.redirect_stdout(log):
    code = ex.main()
d = Path(${JSON.stringify(out)}) / 'skins' / 'local-skins'
def px(rel, xy): return list(Image.open(d / rel).convert('RGBA').getpixel(xy))
def pic(folder): return next(folder + n for n in ('illust.webp', 'illust.png') if (d / (folder + n)).exists())
o = 'char_102_texas/epoque_7_2/'
p = 'char_102_texas/epoque_7/'
print(json.dumps({'code': code, 'log': log.getvalue(), 'manifest': (root/'m.json').exists(),
  'plugin': json.loads((d/'plugin.json').read_text(encoding='utf-8')), 'overlay': json.loads((d/'skins.json').read_text(encoding='utf-8')),
  'front': (d/(o+'front.skel')).read_bytes() == FRONT, 'back': (d/(o+'back.skel')).read_bytes() == BACK,
  'page': px(o+'front.png', (0, 0)), 'page2': px(o+'front_2.png', (0, 0)), 'backPage': px(o+'back.png', (0, 0)),
  'atlas': (d/(o+'front.atlas')).read_text(encoding='utf-8'), 'avatar': list(Image.open(d/(o+'avatar.png')).size),
  'illust': [list(Image.open(d/pic(o)).size), px(pic(o), (0, 0)), px(pic(o), (3, 4))],
  'pictureIllust': px(pic(p), (1, 1))}))`, [path.join(f.root, 'front.skel'), path.join(f.root, 'back.skel')]);
    assert.equal(got.code, 0, got.log);
    assert.equal(got.manifest, false);
    const pluginDir = path.join(out, 'skins/local-skins');
    const p = got.plugin;
    assert.equal(p.class, 'cosmetic');
    assert.deepEqual(p.scope, ['personal']);
    assert.deepEqual(p.permissions, ['assets.override'], 'char_102_texas is in this checkout\'s data/assets.json');
    assert.equal(p.assets, 'skins.json', 'the overlay is a file: an inline text ending like ".SP" would be read as a file path');
    assert.deepEqual(Object.keys(got.overlay.chars), ['char_102_texas'], 'the missing prefab and the missing pack wrote no outfit');
    const skins = got.overlay.chars.char_102_texas.skins;
    assert.deepEqual(Object.keys(skins), ['char_102_texas@epoque+7', 'char_102_texas@epoque#7'], 'official order');
    const pic = skins['char_102_texas@epoque+7'];
    assert.equal(pic.spine, undefined, 'DefaultSkin: pictures only, the battle model stays the operator\'s own');
    assert.equal(pic.avatar, 'char_102_texas/epoque_7/avatar.png');
    assert.match(pic.illust, /^char_102_texas\/epoque_7\/illust\.(webp|png)$/);
    const model = skins['char_102_texas@epoque#7'];
    assert.deepEqual({ name: model.name, group: model.group }, { name: '意志 SS.SP', group: '时代/VII' });
    assert.equal(pic.group, 'i.t');
    assert.deepEqual(model.spine, {
      front: { skel: 'char_102_texas/epoque_7_2/front.skel', atlas: 'char_102_texas/epoque_7_2/front.atlas',
        textures: ['char_102_texas/epoque_7_2/front.png', 'char_102_texas/epoque_7_2/front_2.png'] },
      back: { skel: 'char_102_texas/epoque_7_2/back.skel', atlas: 'char_102_texas/epoque_7_2/back.atlas',
        textures: ['char_102_texas/epoque_7_2/back.png'] },
    });
    assert.ok(got.front && got.back, 'the Front node\'s skeleton is front, the Back node\'s back — though Back comes first and both share one name');
    assert.deepEqual(got.page, [200, 10, 10, 128], 'the [alpha] texture merged in, RGB untouched (straight, #668)');
    assert.deepEqual(got.page2, [10, 200, 10, 255]);
    assert.deepEqual(got.backPage, [10, 10, 200, 64], 'the back page is not the front page of the same name');
    assert.doesNotMatch(got.atlas, /#|pma/);
    assert.deepEqual(got.avatar, [4, 4], 'the first sprite of the name; a later one never overwrites it');
    assert.deepEqual(got.illust[0], [8, 8], 'the tight sprite padded back to its rect');
    assert.equal(got.illust[1][3], 0, 'outside the tight image: transparent');
    assert.ok(got.illust[2][3] > 200, 'the image sits at the offset (from the bottom-left)');
    assert.ok(Math.abs(got.pictureIllust[3] - 200) <= 2, 'the Image material\'s _AlphaTex is the 立绘\'s alpha');
    assert.match(got.log, /skip \(model not extracted\) char_9001_test@sale#1/);
    assert.match(got.log, /skip \(not in this client\) skinpack\/char_9002_none\.ab/);
    for (const rel of tree(pluginDir)) assert.match(rel, /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/, rel);
    const packed = spawnSync(process.execPath, [path.join(ROOT, 'tools/plugin.mjs'), 'pack', pluginDir], { encoding: 'utf8', cwd: ROOT });
    assert.equal(packed.status, 0, packed.stdout + packed.stderr);
    const lock = JSON.parse(fs.readFileSync(path.join(pluginDir, 'plugin.lock.json'), 'utf8'));
    assert.ok(lock.files && Object.keys(lock.files).some((k) => k.endsWith('back.skel')), 'both models and their files are locked');
    const checked = spawnSync(process.execPath, [path.join(ROOT, 'tools/plugin.mjs'), 'check', pluginDir, '--strict'], { encoding: 'utf8', cwd: ROOT });
    assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  });

  test('outfits fill parts within the cosmetic ceilings; a re-run keeps an outfit in its part', { skip: !PIL && 'no Pillow' }, (t) => {
    const f = clientFiles(t);
    const got = py(`${FAKE}${PIL_FAKE}${CLIENT}
root = Path(${JSON.stringify(f.root)})
install(root/'ab', BUNDLES)
s.RESERVE = {'bytes': 0, 'files': 0, 'dirs': 0}
s.PLUGIN_FILES = 12   # the picture-only outfit is 3 files, the model outfit 10: one part each
jobs = s.plan(TABLE, ['char_102_texas'])
logs = []
n1 = s.export(root/'ab', root/'out', logs.append, jobs, ['char_102_texas'], '0.4.1')
first = sorted(p.name for p in (root/'out'/'skins').iterdir())
(root/'out'/'skins'/'local-skins-2'/'plugin.lock.json').write_text('{}', encoding='utf-8')  # a pack's lock: RESERVE's, not the outfit's room
n2 = s.export(root/'ab', root/'out', logs.append, [j for j in jobs if '#' in j['skinId']], ['char_102_texas'], '0.4.1')
parts = {p.name: list(json.loads((p/'skins.json').read_text(encoding='utf-8'))['chars']['char_102_texas']['skins'])
         for p in sorted((root/'out'/'skins').iterdir())}
print(json.dumps({'n': [n1, n2], 'first': first, 'parts': parts,
  'names': [json.loads((root/'out'/'skins'/k/'plugin.json').read_text(encoding='utf-8'))['name']['en'] for k in sorted(parts)]}))`, [path.join(f.root, 'front.skel'), path.join(f.root, 'back.skel')]);
    assert.deepEqual(got.first, ['local-skins', 'local-skins-2']);
    assert.deepEqual(got.parts, { 'local-skins': ['char_102_texas@epoque+7'], 'local-skins-2': ['char_102_texas@epoque#7'] },
      'the re-extracted outfit stays in part 2: plugin.json, skins.json and the lock do not count against it');
    assert.deepEqual(got.names, ['Outfits from the local client', 'Outfits from the local client (part 2)']);
    assert.deepEqual(got.n, [3 + 10 + 2 * 2, 10 + 2], 'files written, with each part\'s plugin.json and skins.json');
  });

  test('extraction → plugin → the real pack in a Chinese folder under a non-UTF-8 locale, without Pillow (CI runs it)', (t) => {
    const f = fxFixture(t);
    f.put('a.png', png(3, 3, [10, 20, 30, 255]));
    f.put('p.png', png(3, 6, [30, 20, 10, 255]));
    const legacy = legacyLocale();
    t.diagnostic(legacy ? `locale code page ${legacy.encoding}` : 'no non-UTF-8 locale here: the default one');
    const dirName = '卫戍协议 测试';
    const got = py(`${FAKE}
import contextlib, io
root = Path(${JSON.stringify(f.root)})
out = root / '卫戍协议 测试'
TABLE = {'charSkins': {
  'char_102_texas@epoque#7': {'charId': 'char_102_texas', 'avatarId': 'char_102_texas_epoque#7', 'portraitId': 'char_102_texas_epoque#7',
    'battleSkin': {'skinOrPrefabId': 'DefaultSkin'}, 'displaySkin': {'skinName': '意志 SS.SP', 'skinGroupName': '时代/VII', 'sortId': 2}},
  'char_102_texas@epoque+7': {'charId': 'char_102_texas', 'avatarId': 'char_102_texas_epoque+7',
    'battleSkin': {'skinOrPrefabId': 'DefaultSkin'}, 'displaySkin': {'skinName': 'i.t', 'sortId': 1}},
}}
(root/'ab'/'ui'/'autochess').mkdir(parents=True)
(root/'table.json').write_text(json.dumps(TABLE), encoding='utf-8')
avatars, portraits = Bundle(), Bundle()
for sid in ('char_102_texas_epoque#7', 'char_102_texas_epoque+7'):
    sprite(avatars, sid, PngFile(root/'a.png'))
sprite(portraits, 'char_102_texas_epoque#7', PngFile(root/'p.png'))
install(root/'ab', {'spritepack/ui_char_avatar_0.ab': avatars, 'spritepack/char_portrait_0.ab': portraits, 'skinpack/char_102_texas.ab': Bundle()})
ex.cursor.client_data = lambda *a: None
sys.argv = ['extract.py', '--game', str(root/'ab'), '--only', 'skins/char_102_texas', '--skin-table', str(root/'table.json'),
            '--out', str(out), '--manifest', str(root/'m.json')]
log = io.StringIO()
with contextlib.redirect_stdout(log):
    code = ex.main()
d = out / 'skins' / 'local-skins'
print(json.dumps({'code': code, 'log': log.getvalue(), 'folder': str(d), 'lock': (d/'plugin.lock.json').is_file(),
  'overlay': json.loads((d/'skins.json').read_text(encoding='utf-8')), 'manifest': (root/'m.json').exists(),
  'stages': sorted(p.name for p in (out/'skins').iterdir() if p.name.startswith('.'))}))`, [], legacy ? legacy.env : ENV);
    assert.equal(got.code, 0, got.log);
    assert.equal(got.folder, path.join(f.root, dirName, 'skins', 'local-skins'));
    // pack's own line, its folder path in Chinese: decoded as UTF-8 (the locale's code page raised or garbled it)
    assert.ok(got.log.includes(`  pack: ${got.folder}: wrote plugin.lock.json`), got.log);
    assert.match(got.log, /pack: +check: ok/);
    assert.equal(got.lock, true);
    assert.equal(got.manifest, false);
    assert.deepEqual(got.stages, [], 'the stage beside the parts is gone');
    const skins = got.overlay.chars.char_102_texas.skins;
    assert.deepEqual(Object.keys(skins), ['char_102_texas@epoque+7', 'char_102_texas@epoque#7']);
    assert.deepEqual(skins['char_102_texas@epoque#7'], { name: '意志 SS.SP', group: '时代/VII',
      avatar: 'char_102_texas/epoque_7_2/avatar.png', portrait: 'char_102_texas/epoque_7_2/portrait.png' });
    const checked = spawnSync(process.execPath, [path.join(ROOT, 'tools/plugin.mjs'), 'check', got.folder, '--strict'], { encoding: 'utf8', cwd: ROOT });
    assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  });

  test('a re-run keeps every outfit\'s folder: two outfits of one plugin-safe name never swap or delete each other\'s files', (t) => {
    const f = fxFixture(t);
    f.put('3.png', png(3, 3)); f.put('5.png', png(5, 5)); f.put('7.png', png(7, 7));
    const got = py(`${FAKE}
root = Path(${JSON.stringify(f.root)})
avatars = Bundle()
for sid, w in (('char_x_a#1', 3), ('char_x_a+1', 5), ('char_x_a_1', 7)):
    sprite(avatars, sid, PngFile(root / ('%d.png' % w)))
install(root/'ab', {'spritepack/ui_char_avatar_0.ab': avatars})
def table(order):
    return {'charSkins': {sid: {'charId': 'char_x', 'avatarId': 'char_x_' + sid.split('@')[1], 'battleSkin': {'skinOrPrefabId': 'DefaultSkin'},
                                'displaySkin': {'skinName': sid, 'sortId': i}} for i, sid in enumerate(order)}}
skins_dir = root/'out'/'skins'
def state():
    recs = json.loads((skins_dir/'local-skins'/'skins.json').read_text(encoding='utf-8'))['chars']['char_x']['skins']
    return {sid: [r['avatar'], png_width(skins_dir/'local-skins'/r['avatar']) if (skins_dir/'local-skins'/r['avatar']).is_file() else None]
            for sid, r in recs.items()}
logs, states = [], []
s.export(root/'ab', root/'out', logs.append, s.plan(table(['char_x@a+1', 'char_x@a#1'])), ['char_x'], '0.4.1')
states.append(state())
(skins_dir/'.staging-skins-left').mkdir()   # an interrupted run's stage
# the official order flips: plan names a#1 a_1 and a+1 a_1_2, the other way round
s.export(root/'ab', root/'out', logs.append, s.plan(table(['char_x@a#1', 'char_x@a+1'])), ['char_x'], '0.4.1')
states.append(state())
# a new outfit of the name comes first, and a partial run (--limit 1) extracts only it
s.export(root/'ab', root/'out', logs.append, s.plan(table(['char_x@a_1', 'char_x@a+1', 'char_x@a#1'])), ['char_x'], '0.4.1', limit=1)
states.append(state())
print(json.dumps({'states': states, 'left': sorted(p.name for p in skins_dir.iterdir()),
  'kept': [j['dir'] for j in s.keep_dirs(s.plan(table(['char_x@a#1', 'char_x@a+1'])), {1: {'char_x': {
      'char_x@a+1': {'avatar': 'char_x/a_1/avatar.png'}, 'char_x@a#1': {'avatar': '../a_1_2/avatar.png'}}}})]}))`);
    const [first, flipped, partial] = got.states;
    assert.deepEqual(first, { 'char_x@a+1': ['char_x/a_1/avatar.png', 5], 'char_x@a#1': ['char_x/a_1_2/avatar.png', 3] });
    assert.deepEqual(flipped, first, 'each outfit keeps its folder and its own picture');
    assert.deepEqual(partial, { ...first, 'char_x@a_1': ['char_x/a_1_3/avatar.png', 7] },
      'the new outfit takes a free name; the outfits this run left alone keep their files');
    assert.deepEqual(got.left, ['local-skins'], 'no stage is left, also not one an interrupted run left');
    assert.deepEqual(got.kept, ['char_x/a_1_2', 'char_x/a_1'], 'a record folder outside <charId>/<name> is never kept');
  });

  test('library: every kind deduplicated by its own names, illust_* prefabs only, plugin-safe names never collide', { skip: !PIL && 'no Pillow' }, (t) => {
    const f = fxFixture(t);
    const got = py(`${FAKE}${PIL_FAKE}
root = Path(${JSON.stringify(f.root)})
a0, a1, p0, base, skin = Bundle(), Bundle(), Bundle(), Bundle(), Bundle()
sprite(a0, 'char_x', solid(4, 4, (1, 1, 1, 255))); sprite(a0, 'char_x+', solid(4, 4, (2, 2, 2, 255)))
sprite(a1, 'char_x', solid(2, 2, (3, 3, 3, 255)))         # the same name in a later pack: written once
sprite(p0, 'char_x', solid(4, 8, (4, 4, 4, 255)))         # the same name in another kind: written there too
tex = base.add('Texture2D', data=NS(m_Name='char_x_1', image=solid(8, 8, (9, 9, 9, 255))))
al = base.add('Texture2D', data=NS(m_Name='char_x_1[alpha]', image=Image.new('L', (8, 8), 77)))
mat = base.add('Material', tt={'m_SavedProperties': {'m_TexEnvs': [['_MainTex', {'m_Texture': ref(tex)}], ['_AlphaTex', {'m_Texture': ref(al)}]]}})
illust_prefab(base, 'dyn/arts/characters/char_x/illust_char_x_1.prefab', sprite(base, 'char_x_1', solid(4, 4, (9, 9, 9, 255)), rect=(0, 0, 8, 8), texture=tex.data), mat)
illust_prefab(skin, 'dyn/arts/characters/char_x/illust_char_x_1.prefab', sprite(skin, 'dup', solid(4, 4, (5, 5, 5, 255))))
illust_prefab(skin, 'dyn/arts/characters/char_x/sp_illust_char_x_s#1.prefab', sprite(skin, 'sp', solid(4, 4, (5, 5, 5, 255))))
illust_prefab(skin, 'dyn/arts/characters/char_x/illust_char_x_s#1.prefab', sprite(skin, 's', solid(4, 4, (6, 6, 6, 255))))
install(root/'ab', {'spritepack/ui_char_avatar_0.ab': a0, 'spritepack/ui_char_avatar_1.ab': a1, 'spritepack/char_portrait_0.ab': p0,
                    'chararts/char_x.ab': base, 'skinpack/char_x.ab': skin})
logs = []
n = s.export_library(root/'ab', root/'out', logs.append, list(s.LIB_KINDS))
d = root/'out'/'library'
idx = json.loads((d/'index.json').read_text(encoding='utf-8'))
first = Image.open(d/idx['kinds']['opillust']['illust_char_x_1']['path'])
n2 = s.export_library(root/'ab', root/'out', logs.append, ['opavatar'], limit=1)
idx2 = json.loads((d/'index.json').read_text(encoding='utf-8'))
print(json.dumps({'n': [n, n2], 'idx': idx, 'alpha': first.convert('RGBA').getpixel((0, 0))[3], 'size': first.size,
  'avatars2': idx2['kinds']['opavatar'], 'kept': sorted(idx2['kinds']), 'files': sorted(p.relative_to(d).as_posix() for p in d.rglob('*') if p.is_file())}))`);
    const k = got.idx.kinds;
    assert.equal(got.n[0], 2 + 1 + 2);
    assert.deepEqual(Object.keys(k.opavatar), ['char_x', 'char_x+']);
    assert.equal(k.opavatar.char_x.path, 'opavatar/char_x.png');
    assert.equal(k.opavatar['char_x+'].path, 'opavatar/char_x_2.png', 'plugin-safe "char_x" was taken: no overwrite');
    assert.equal(k.opavatar.char_x.w, 4, 'the first sprite of a name wins; the later pack does not overwrite it');
    assert.deepEqual(Object.keys(k.opportrait), ['char_x'], 'its own dedup set: the avatar of the name does not hide the portrait');
    assert.deepEqual(Object.keys(k.opillust), ['illust_char_x_1', 'illust_char_x_s#1'], 'sp_illust and the second copy are left out');
    assert.match(k.opillust['illust_char_x_s#1'].path, /^opillust\/illust_char_x_s_1\.(webp|png)$/);
    assert.ok(Math.abs(got.alpha - 77) <= 2, 'the default 立绘 take their alpha from the Image material');
    assert.deepEqual(got.size, [8, 8]);
    assert.deepEqual(Object.keys(got.avatars2), ['char_x'], '--limit 1 rewrites only that kind');
    assert.deepEqual(got.kept, ['opavatar', 'opillust', 'opportrait'], 'the other kinds keep their earlier pictures');
    assert.ok(!got.files.includes('opavatar/char_x_2.png'), 'a kind is replaced as a whole');
  });

  test('packages never ship the extracted outfits or gallery (public/assets/local/skins, library)', (t) => {
    const f = fxFixture(t);
    f.put('data/assets.json', {});
    f.put('data/local-assets.json', { version: 1, groups: { 'ui/battle': { b: { path: '/assets/local/ui/battle/b.png' } } } });
    f.put('public/assets/local/ui/battle/b.png', 'png');
    f.put('public/assets/local/skins/local-skins/plugin.json', {});
    f.put('public/assets/local/skins/local-skins/char_102_texas/a_1/front.png', 'png');
    f.put('public/assets/local/library/index.json', {});
    assert.deepEqual(LOCAL_ONLY_ART_PREFIXES, ['public/assets/local/skins/', 'public/assets/local/library/']);
    const plan = artPlan(f.root, { fx: false });
    assert.deepEqual(plan.files, ['data/local-assets.json', 'public/assets/local/ui/battle/b.png']);
    assert.deepEqual(plan.localOnly, ['public/assets/local/library/index.json', 'public/assets/local/skins/local-skins/char_102_texas/a_1/front.png',
      'public/assets/local/skins/local-skins/plugin.json']);
    assert.deepEqual(plan.orphans, [], 'held back on purpose, not "nothing lists them"');
  });
});
