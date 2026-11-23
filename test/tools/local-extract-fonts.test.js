// test/tools/local-extract-fonts.test.js — fonts.py: write a pinned font, keep a local file with the same hash,
// never overwrite a conflicting one, skip a missing source; --only font's non-zero exit only when nothing was written
// or listed and main() handing it the install's Arknights_Data rather than the temporary hot-update root; a full extract
// treating fonts as optional (no Arknights_Data / no face / a SHA-256 mismatch all exit 0 with a warning, no pinned face
// is required), an earlier groups.fonts surviving a run (extract.py previous_groups); --only shopdocs calling the
// merged producer with shopdocs=True and printing its prefabs.json / card.json / shop.json (--themes required); and
// the theme file listing / card.json shader records: a `shaders/*.md` porting page is never listed (a stale copy
// stays out of data/local-assets.json) and no card shader record carries `doc` or `shaderDoc` (S7).
//
// The extraction runs in a temporary directory with fonts._read_fonts (and the pinned FONT_SPECS) monkeypatched, so
// this needs no game client and never touches public/.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TOOL = path.join(ROOT, 'tools', 'local-extract');
const PY = [process.env.PYTHON, 'python', 'python3', 'py']
  .filter(Boolean)
  .find((bin) => {
    try {
      return spawnSync(bin, ['--version'], { encoding: 'utf8' }).status === 0;
    } catch {
      return false;
    }
  });
const ENV = { ...process.env, PYTHONDONTWRITEBYTECODE: '1' };

// Runs one scenario of fonts.export_fonts (or previous_groups for 'full-run') against a temporary out root.
// The monkeypatched FONT_SPECS use a 64-byte fake face: the pinned bytes are the test's own, not a game font.
const DRIVER = String.raw`
import hashlib, json, sys
from pathlib import Path

tool = Path(sys.argv[1])
scenario = sys.argv[2]
work = Path(sys.argv[3])
sys.path.insert(0, str(tool))
import fonts

MAGIC = b'\x00\x01\x00\x00'
def payload(seed, size=64):
    return MAGIC + bytes([seed]) * (size - 4)

DATA = payload(7)
SPEC = {'name': 'FakeFont-One', 'file': 'FakeFont-One.ttf', 'ext': 'ttf', 'family': 'FakeFont-One',
        'weight': 400, 'bytes': len(DATA), 'sha256': hashlib.sha256(DATA).hexdigest()}
fonts.FONT_SPECS = (SPEC,)
game = work / 'Arknights_Data'
game.mkdir(parents=True, exist_ok=True)
out = work / 'out'
logs = []

def log(line):
    logs.append(line)

def source(data):
    return lambda game_data: {'FakeFont-One': (data, 'Arknights_Data/sharedassets1.assets', 360)}

def existing(data):
    target = out / 'fonts' / 'FakeFont-One.ttf'
    target.parent.mkdir(parents=True)
    target.write_bytes(data)
    return target

if scenario == 'write':
    fonts._read_fonts = source(DATA)
elif scenario == 'keep':
    existing(DATA)
    fonts._read_fonts = source(DATA)
elif scenario == 'conflict':
    existing(payload(9))
    fonts._read_fonts = source(DATA)
elif scenario == 'missing':
    fonts._read_fonts = lambda game_data: {}
elif scenario not in ('full-run', 'full-fonts', 'font-exit', 'hot-update', 'shopdocs', 'theme-files', 'card-shaders', 'bundles', 'font-faces', 'font-face-exit'):
    raise SystemExit('unknown scenario ' + scenario)

if scenario == 'full-run':
    import importlib.util
    spec = importlib.util.spec_from_file_location('extract', str(tool / 'extract.py'))
    extract = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(extract)
    old = {'fonts': {'a': {'path': '/x'}}, 'ui/common': {'b': {}}, 'char/x': {'c': {}},
           'themes/ac_s_closur': {'d': {}}, 'ui/cursor': {'e': {}}, 'spine/char/char_1/front': {'f': {}}}
    kept = extract.previous_groups(old, [])
    result = {'kept': sorted(kept), 'partial': sorted(extract.previous_groups(old, ['ui/common'])),
              'merged': sorted(extract.merge_manifest(kept, {}, set())), 'logs': [],
              'wants': [extract.wants_sub(['font'], 'fonts'), extract.wants_sub(['fonts'], 'fonts'),
                        extract.wants_sub(['font/SourceHanSansCN-Bold'], 'fonts'),
                        extract.wants_sub(['common'], 'ui/common')]}
elif scenario == 'font-exit':
    # --only font returns non-zero only when the run neither wrote nor listed a face (the group counts as extracted)
    import argparse, contextlib, importlib.util, io
    spec = importlib.util.spec_from_file_location('extract', str(tool / 'extract.py'))
    extract = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(extract)

    def make_args():
        return argparse.Namespace(only=['font'], themes=[], out=str(work / 'out'), manifest=str(work / 'manifest.json'),
                                  plugin_root='.', plugin_art=False, scenes=[], fx_set='sample', fx_keys='',
                                  fx_jobs=0, fx_add_only=False, fx_texture_format='webp', game=None)

    def run(ab, game_data):
        err, out = io.StringIO(), io.StringIO()
        with contextlib.redirect_stderr(err), contextlib.redirect_stdout(out):
            code = extract.extract(make_args(), ab, None, game_data)
        return code, err.getvalue(), out.getvalue()

    codes, errs = {}, {}
    codes['no_game'], errs['no_game'], _ = run(str(work / 'fake-ab'), None)
    game2 = work / 'client' / 'Arknights_Data'
    game2.mkdir(parents=True)
    extract.fonts.export_fonts = lambda *a, **k: 0
    codes['nothing'], errs['nothing'], _ = run(str(work / 'fake-ab'), game2)

    def keep(game, out_root, manifest, log, only=None):
        manifest.setdefault('fonts', {})['FakeFont-One'] = {'path': '/assets/local/fonts/FakeFont-One.ttf'}
        return 0

    extract.fonts.export_fonts = keep
    codes['kept'], errs['kept'], _ = run(str(work / 'fake-ab'), game2)
    result = {'codes': codes, 'errs': errs}
elif scenario == 'full-fonts':
    # Fonts are optional (like ui/cursor): a plain extract still attempts them, but a missing Arknights_Data, a
    # missing face or a pinned-bytes mismatch only warns and the run exits 0 when anything else was extracted.
    import argparse, contextlib, hashlib, importlib.util, io
    spec = importlib.util.spec_from_file_location('extract', str(tool / 'extract.py'))
    extract = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(extract)
    # A full run with a bare AB root: the other jobs are stubbed to one written group, so the font branch is what
    # decides whether the run fails.
    extract.select_jobs = lambda only: []
    extract.spine_ids = lambda *a, **k: []
    extract.scene_ids = lambda *a, **k: []
    extract.regulation_ids = lambda *a, **k: []
    extract.fx_selected = lambda *a, **k: False
    real_export = extract.fonts.export_fonts
    real_locate = extract.fonts.locate_game_data
    extract.versions.export = lambda ab, out, manifest, log, root: (
        manifest.setdefault('versions', {'a': {'path': '/x'}}), 1)[1]

    def make_args():
        return argparse.Namespace(only=[], themes=[], out=str(work / 'out'), manifest=str(work / 'manifest.json'),
                                  plugin_root='.', plugin_art=False, scenes=[], fx_set='sample', fx_keys='',
                                  fx_jobs=0, fx_add_only=False, fx_texture_format='webp', game=None)

    codes, errs, outs = {}, {}, {}

    def run(name, game_data, font_mode):
        if font_mode == 'skip':
            extract.fonts.export_fonts = real_export
            extract.fonts.locate_game_data = lambda raw, root: None
        elif font_mode == 'listed':
            def keep(game, out_root, manifest, log, only=None):
                manifest.setdefault('fonts', {})['FakeFont-One'] = {'path': '/assets/local/fonts/FakeFont-One.ttf'}
                return 0
            extract.fonts.export_fonts = keep
        elif font_mode == 'unlisted':
            extract.fonts.export_fonts = lambda *a, **k: 0
        elif font_mode == 'sha':
            MAGIC = b'\x00\x01\x00\x00'
            pinned = MAGIC + bytes([7]) * 60
            extract.fonts.FONT_SPECS = ({'name': 'FakeFont-One', 'file': 'FakeFont-One.ttf', 'ext': 'ttf',
                                         'family': 'FakeFont-One', 'weight': 400, 'bytes': len(pinned),
                                         'sha256': hashlib.sha256(pinned).hexdigest()},)
            extract.fonts._read_fonts = lambda game_data: {
                'FakeFont-One': (MAGIC + bytes([9]) * 60, 'Arknights_Data/sharedassets1.assets', 360)}
            extract.fonts.locate_game_data = real_locate
            extract.fonts.export_fonts = real_export
        err, out = io.StringIO(), io.StringIO()
        with contextlib.redirect_stderr(err), contextlib.redirect_stdout(out):
            codes[name] = extract.extract(make_args(), str(work / 'fake-ab'), None, game_data)
        errs[name], outs[name] = err.getvalue(), out.getvalue()

    # A bare AssetBundle root has no Arknights_Data: the faces are skipped, the other jobs still make the run exit 0.
    run('no_game', None, 'skip')
    game2 = work / 'client' / 'Arknights_Data'
    game2.mkdir(parents=True)
    run('listed', game2, 'listed')
    # Nothing written or kept: a warning, not a failure; the other jobs' extraction still counts.
    run('unlisted', game2, 'unlisted')
    # A pinned-bytes mismatch goes through the real check: the source is refused and the run exits 0.
    run('sha', game2, 'sha')
    # Nothing at all: the old "nothing was extracted" failure stays, and it no longer names fonts as required.
    extract.versions.export = lambda *a, **k: 0
    run('empty', game2, 'unlisted')
    result = {'codes': codes, 'errs': errs, 'outs': outs}
elif scenario == 'hot-update':
    # main() resolves Arknights_Data from --game / the located install before client_bundles yields its temporary
    # hot-update root, so --only font never takes the temporary root for the install directory.
    import contextlib, importlib.util
    spec = importlib.util.spec_from_file_location('extract', str(tool / 'extract.py'))
    extract = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(extract)
    ab = work / 'ab'
    ab.mkdir()
    captured = {'locate_client': 0}

    def locate_client(game):
        captured['locate_client'] += 1
        return ab

    extract.locate_client = locate_client
    extract.fonts.locate_game_data = lambda raw, root: 'GAME_DATA'

    @contextlib.contextmanager
    def client_bundles(base):
        captured['bundled_base'] = str(base)
        yield 'TEMP-HOT-ROOT'

    extract.client_bundles = client_bundles

    def fake_extract(args, ab_root, game_arg=None, game_data=None):
        captured.update(ab_root=ab_root, game_arg=game_arg, game_data=game_data)
        return 0

    extract.extract = fake_extract
    old_argv = sys.argv
    sys.argv = ['extract.py', '--only', 'font']
    try:
        code = extract.main()
    finally:
        sys.argv = old_argv
    result = {'code': code, 'captured': captured, 'ab': str(ab), 'logs': []}
elif scenario == 'shopdocs':
    # --only shopdocs calls autochess_themes.export_themes with shopdocs=True (no legacy module swap) and registers
    # prefabs.json / card.json / shop.json; --themes is still mandatory.
    import argparse, contextlib, importlib.util, io
    spec = importlib.util.spec_from_file_location('extract', str(tool / 'extract.py'))
    extract = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(extract)
    logs = []
    manifest = {}
    calls = []

    def export_themes(themes_dirs, out_root, manifest_, log, ids, repo_root, game_root=None, shopdocs=False):
        calls.append({'themes': list(themes_dirs), 'ids': list(ids), 'shopdocs': shopdocs})
        for tid in ids:
            manifest_['themes/' + tid] = {rel: {'path': '/x'} for rel in extract.SHOPDOC_FILES}
        return len(ids) * len(extract.SHOPDOC_FILES)

    extract.autochess_themes.export_themes = export_themes
    total = extract.export_shopdocs(None, str(work / 'out'), manifest, logs.append, ['ac_n_iron'], ['themes-dir'])

    def make_args():
        return argparse.Namespace(only=['shopdocs'], themes=[], out=str(work / 'out'), manifest=str(work / 'manifest.json'),
                                  plugin_root='.', plugin_art=False, scenes=[], fx_set='sample', fx_keys='',
                                  fx_jobs=0, fx_add_only=False, fx_texture_format='webp', game=None)

    err = io.StringIO()
    with contextlib.redirect_stderr(err):
        code = extract.extract(make_args(), str(work / 'fake-ab'), None, None)
    result = {'total': total, 'logs': logs, 'groups': sorted(manifest), 'code': code, 'stderr': err.getvalue(),
              'calls': calls}
elif scenario == 'theme-files':
    # list_theme_files registers the files a theme producer wrote without listing (the free-refresh plate etc.), and
    # never a shaders/*.md porting page: THEME_FILE_KINDS dropped '.md' and the walk skips it, so a stale copy from
    # an older extraction stays out of the manifest (and the re-run theme group replaces an entry an older run listed).
    import importlib.util
    spec = importlib.util.spec_from_file_location('extract', str(tool / 'extract.py'))
    extract = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(extract)
    out = work / 'out'
    sprites = out / 'themes' / 'ac_s_closur' / 'sprites'
    sprites.mkdir(parents=True)
    (sprites / 'listed.webp').write_bytes(b'not-a-real-image')
    (sprites / 'ext_cost_free.webp').write_bytes(b'not-a-real-image')
    shaders = out / 'themes' / 'ac_s_closur' / 'shaders'
    shaders.mkdir(parents=True)
    (shaders / 'x.md').write_text('# stale shader porting page', encoding='utf-8')
    (out / 'themes' / 'ac_s_closur' / 'theme.json').write_text('{}', encoding='utf-8')
    logs = []
    group = 'themes/ac_s_closur'
    manifest = {group: {'sprites/listed.webp': {'path': '/assets/local/' + group + '/sprites/listed.webp',
                                                'kind': 'Sprite', 'w': 7, 'h': 9}}}
    old = {group: {'shaders/x.md': {'path': '/assets/local/' + group + '/shaders/x.md', 'kind': 'TextAsset'},
                   'sprites/listed.webp': manifest[group]['sprites/listed.webp']}}
    extract.list_theme_files(str(out), manifest, logs.append, ['ac_s_closur'])
    merged = extract.merge_manifest(old, manifest, extract.ran_groups(old, manifest))
    result = {'group': manifest[group], 'logs': logs, 'kinds': sorted(extract.THEME_FILE_KINDS),
              'merged': sorted(merged[group])}
elif scenario == 'card-shaders':
    # card.json's shader records no longer link a porting page (S7): _shaders writes no shaders/*.md, so no record
    # carries 'doc', a material gets no 'shaderDoc', and ctx['files'] names no page. The producer's card-file
    # registration loop also filters '.md' as a guard for an older producer (inline in _export_one, so pinned by
    # source), and the merged producer keeps that path behind shopdocs=True (S13).
    import inspect
    import autochess_themes
    import card_prefab

    class Obj:
        def __init__(self, tree):
            self._tree = tree

        def read_typetree(self):
            return self._tree

    tree = {'m_ParsedForm': {'m_Name': 'Torappu/UI/UI-Fx-Common'}, 'm_Script': None,
            'platforms': [4], 'stageCounts': [2]}
    material = {'shader': 'Torappu/UI/UI-Fx-Common', 'name': 'mat_x'}
    ctx = {'shader_objects': {'Torappu/UI/UI-Fx-Common': (Obj(tree), 'CAB-abc')},
           'materials': {'mat_x': material}, 'files': set()}
    pages = []
    card_prefab.card_shader.docs_markdown = lambda record: pages.append(record) or '# page'
    shaders = card_prefab._shaders(ctx)
    record = shaders['Torappu/UI/UI-Fx-Common']
    flag = inspect.signature(autochess_themes.export_themes).parameters.get('shopdocs')
    result = {'record': sorted(record), 'material': sorted(material), 'files': sorted(ctx['files']),
              'pages': len(pages), 'guard': "rel.endswith('.md')" in inspect.getsource(autochess_themes._export_one),
              'shopdocsDefault': flag.default if flag else None,
              'shopdocsGate': 'if shopdocs:' in inspect.getsource(autochess_themes._export_one),
              'module': autochess_themes.__file__}
elif scenario == 'bundles':
    # The two enrichment modules resolve their theme / battle bundles in one order: PersistentData first, then the
    # packaged StreamingAssets/AB/Windows tree, then an AssetBundle root the caller handed us; when all are missing the
    # existing RuntimeError names the paths tried. path_ids.game_data also accepts an AB root (no SystemExit).
    import importlib.util
    sys.path.insert(0, str(tool))
    import path_ids
    import theme_particles
    RELS = ('ui/autochess/autochessvariantskin/[uc]ac_s_closur.ab', 'ui/autochess/[uc]autochessbattle.ab')
    MODULES = {'theme_particles': theme_particles, 'path_ids': path_ids}

    def make(root, sub):
        for rel in RELS:
            target = root / sub / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(b'x')

    def locate(data):
        out = {}
        for name, mod in MODULES.items():
            try:
                theme, battle = mod.bundle_paths(data)
                out[name] = [str(theme), str(battle)]
            except RuntimeError as err:
                out[name] = {'error': str(err)}
        return out

    root = work / 'bundles'
    data = root / 'Arknights_Data'
    data.mkdir(parents=True)
    out = {'missing': locate(data)}
    make(data, 'StreamingAssets/AB/Windows')
    out['streaming'] = locate(data)
    make(data, 'PersistentData/Bundles')
    out['persistent'] = locate(data)
    ab = root / 'Bundles'
    ab.mkdir()
    make(ab, '.')
    out['root'] = locate(ab)
    # A hot-updated install can hold the theme only in PersistentData and the unchanged battle bundle only in
    # StreamingAssets; each bundle is resolved independently, not forced under one root.
    split = root / 'split' / 'Arknights_Data'
    theme_only = split / 'PersistentData' / 'Bundles' / RELS[0]
    battle_only = split / 'StreamingAssets' / 'AB' / 'Windows' / RELS[1]
    for path in (theme_only, battle_only):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b'x')
    out['split'] = locate(split)
    out['gameData'] = [path_ids.game_data(data) == data, path_ids.game_data(ab) == ab]
    out['tmp'] = str(root)
    result = out
elif scenario == 'font-faces':
    # Two pinned faces: --only limits which face is written, but the group is assembled over every FONT_SPECS row:
    # a local file matching the pinned bytes is kept and listed even when its source is gone, a conflicting local
    # file is never overwritten and never listed, and no listed face means no fonts group at all.
    DATA2 = payload(9)
    def spec_of(name, data):
        return {'name': name, 'file': name + '.ttf', 'ext': 'ttf', 'family': name, 'weight': 400,
                'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
    ONE = spec_of('FakeFont-One', DATA)
    TWO = spec_of('FakeFont-Two', DATA2)
    fonts.FONT_SPECS = (ONE, TWO)
    fonts.locate_game_data = lambda raw: game
    def run(name, only, sources, local=None):
        sub = work / name
        sub.mkdir(parents=True, exist_ok=True)
        m, lg = {}, []
        for fname, data in (local or {}).items():
            target = sub / 'fonts' / fname
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        fonts._read_fonts = lambda gd: dict(sources)
        n = fonts.export_fonts(str(game), str(sub), m, lg.append, only=only)
        hashes = {}
        if (sub / 'fonts').is_dir():
            for p in sorted((sub / 'fonts').iterdir()):
                hashes[p.name] = hashlib.sha256(p.read_bytes()).hexdigest()
        return {'written': n, 'group': sorted(m.get('fonts') or {}), 'hashes': hashes, 'logs': lg}
    result = {
        'one_only': run('one', ['FakeFont-One'], {'FakeFont-One': (DATA, 'Arknights_Data/sharedassets1.assets', 1)}),
        'local_two': run('two', ['FakeFont-One'], {}, {'FakeFont-Two.ttf': DATA2}),
        'conflict_two': run('three', ['FakeFont-One'], {}, {'FakeFont-Two.ttf': payload(3)}),
        'nothing': run('four', ['FakeFont-One'], {}, None),
        'all': run('five', None, {'FakeFont-One': (DATA, 'x', 1), 'FakeFont-Two': (DATA2, 'x', 2)}, None),
        'conflict_sha': hashlib.sha256(payload(3)).hexdigest(),
        'two_sha': TWO['sha256'],
    }
elif scenario == 'font-face-exit':
    # --only font/<face> and fonts/<face> (the alias) select that face only, and an unknown face is exit 2 with
    # the pinned names in the message instead of silently running every face.
    import argparse, contextlib, importlib.util, io
    spec = importlib.util.spec_from_file_location('extract', str(tool / 'extract.py'))
    extract = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(extract)
    TWO = {'name': 'FakeFont-Two', 'file': 'FakeFont-Two.ttf', 'ext': 'ttf', 'family': 'FakeFont-Two',
           'weight': 400, 'bytes': 64, 'sha256': 'unused'}
    extract.fonts.FONT_SPECS = (SPEC, TWO)
    game2 = work / 'client' / 'Arknights_Data'
    game2.mkdir(parents=True)
    extract.fonts.locate_game_data = lambda raw: game2
    extract.fonts._read_fonts = lambda gd: {'FakeFont-One': (DATA, 'x', 1)}
    def make_args(only):
        return argparse.Namespace(only=only, themes=[], out=str(work / 'out'), manifest=str(work / 'manifest.json'),
                                  plugin_root='.', plugin_art=False, scenes=[], fx_set='sample', fx_keys='',
                                  fx_jobs=0, fx_add_only=False, fx_texture_format='webp', game=None)
    def run(only):
        err, out = io.StringIO(), io.StringIO()
        with contextlib.redirect_stderr(err), contextlib.redirect_stdout(out):
            code = extract.extract(make_args(only), str(work / 'fake-ab'), None, game2)
        return code, err.getvalue(), out.getvalue()
    results = {'faces': {
        'alias_font': extract.font_faces(['font/FakeFont-One']),
        'alias_fonts': extract.font_faces(['fonts/FakeFont-Two']),
        'job_only': extract.font_faces(['font']),
        'other': extract.font_faces(['common']),
        'unknown': extract.unknown_font_faces(['NoSuchFace']),
    }}
    for key, only in (('one', ['font/FakeFont-One']), ('unknown', ['font/NoSuchFace']), ('alias', ['fonts/FakeFont-One'])):
        code, err, out = run(only)
        results[key] = {'code': code, 'stderr': err, 'stdout': out}
    manifest = json.loads((work / 'manifest.json').read_text(encoding='utf-8')) if (work / 'manifest.json').exists() else {}
    results['manifest_fonts'] = sorted(manifest.get('groups', {}).get('fonts') or {})
    result = results
else:
    manifest = {}
    written = fonts.export_fonts(str(game), str(out), manifest, log)
    files = {}
    if (out / 'fonts').is_dir():
        for p in sorted((out / 'fonts').iterdir()):
            files[p.name] = hashlib.sha256(p.read_bytes()).hexdigest()
    result = {'written': written, 'manifest': manifest, 'files': files, 'logs': logs, 'spec': SPEC}

print(json.dumps(result))
`;

function runDriver(scenario) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-fonts-'));
  try {
    const driver = path.join(work, 'driver.py');
    fs.writeFileSync(driver, DRIVER, 'utf8');
    const r = spawnSync(PY, ['-B', driver, TOOL, scenario, work], { encoding: 'utf8', env: ENV });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

test('fonts.export_fonts writes a source whose bytes match the pinned size and SHA-256', { skip: !PY && 'no python' }, () => {
  const result = runDriver('write');
  assert.equal(result.written, 1);
  assert.deepEqual(result.files, { 'FakeFont-One.ttf': result.spec.sha256 });
  assert.deepEqual(result.manifest, {
    fonts: {
      'FakeFont-One': {
        path: '/assets/local/fonts/FakeFont-One.ttf',
        bytes: result.spec.bytes,
        sha256: result.spec.sha256,
        family: 'FakeFont-One',
        weight: 400,
        kind: 'Font',
      },
    },
  });
  assert.ok(result.logs.some((line) => line.startsWith('write font FakeFont-One:')), result.logs.join('\n'));
});

test('fonts.export_fonts keeps a local file whose bytes already hash to the pinned value', { skip: !PY && 'no python' }, () => {
  const result = runDriver('keep');
  assert.equal(result.written, 0);
  assert.deepEqual(result.files, { 'FakeFont-One.ttf': result.spec.sha256 });
  assert.equal(result.manifest.fonts['FakeFont-One'].sha256, result.spec.sha256);
  assert.ok(result.logs.some((line) => line.startsWith('keep font FakeFont-One:')), result.logs.join('\n'));
});

test('fonts.export_fonts never overwrites a local file whose bytes differ from the pinned value', { skip: !PY && 'no python' }, () => {
  const result = runDriver('conflict');
  assert.equal(result.written, 0);
  assert.notEqual(result.files['FakeFont-One.ttf'], result.spec.sha256, 'the conflicting bytes stay on disk');
  assert.deepEqual(result.manifest, {}, 'a conflict is not listed as extracted');
  assert.ok(
    result.logs.some((line) => line.startsWith('conflict font FakeFont-One:') && line.includes('not overwritten')),
    result.logs.join('\n'),
  );
});

test('fonts.export_fonts skips a font whose source is missing, without writing or listing it', { skip: !PY && 'no python' }, () => {
  const result = runDriver('missing');
  assert.equal(result.written, 0);
  assert.deepEqual(result.files, {});
  assert.deepEqual(result.manifest, {});
  assert.ok(
    result.logs.some((line) => line.startsWith('skip font FakeFont-One:') && line.includes('source not found')),
    result.logs.join('\n'),
  );
});

test('--only font exits non-zero only when nothing was written or listed', { skip: !PY && 'no python' }, () => {
  const result = runDriver('font-exit');
  assert.deepEqual(result.codes, { no_game: 1, nothing: 1, kept: 0 });
  assert.match(result.errs.no_game, /skip fonts: no Arknights_Data directory/);
  assert.match(result.errs.nothing, /warn fonts: none of the pinned official faces was listed/);
  assert.match(result.errs.nothing, /nothing was extracted/);
});

test('fonts: --only font/<face> writes that face only; the group keeps every locally verified face', { skip: !PY && 'no python' }, () => {
  const result = runDriver('font-faces');
  assert.deepEqual(result.one_only.group, ['FakeFont-One'], 'only the named face is listed');
  assert.equal(result.one_only.written, 1);
  assert.deepEqual(Object.keys(result.one_only.hashes), ['FakeFont-One.ttf']);
  // A local file whose bytes match the pinned record is kept and listed even though its source is gone and this
  // run named another face: the group is assembled over every pinned face, not rebuilt from `only`.
  assert.equal(result.local_two.written, 0);
  assert.deepEqual(result.local_two.group, ['FakeFont-Two']);
  assert.equal(result.local_two.hashes['FakeFont-Two.ttf'], result.two_sha);
  // A local file that differs is never overwritten and never listed as the pinned face.
  assert.deepEqual(result.conflict_two.group, []);
  assert.equal(result.conflict_two.written, 0);
  assert.equal(result.conflict_two.hashes['FakeFont-Two.ttf'], result.conflict_sha, 'the conflicting bytes stay on disk');
  assert.ok(result.conflict_two.logs.some((line) => line.startsWith('conflict font FakeFont-Two:') && line.includes('not overwritten')));
  // No face listed at all: no empty `fonts` group (the caller keeps the local font fallback).
  assert.deepEqual(result.nothing.group, []);
  assert.ok(result.nothing.logs.some((line) => line === 'skip font FakeFont-One: source not found; no write, caller falls back'));
  // Without `only`, every pinned face with a source is written and listed.
  assert.equal(result.all.written, 2);
  assert.deepEqual(result.all.group, ['FakeFont-One', 'FakeFont-Two']);
});

test('--only font/<face> selects that face; an unknown face exits 2 naming the pinned faces', { skip: !PY && 'no python' }, () => {
  const result = runDriver('font-face-exit');
  assert.deepEqual(result.faces.alias_font, ['FakeFont-One'], 'font/<face> normalises to the fonts group');
  assert.deepEqual(result.faces.alias_fonts, ['FakeFont-Two']);
  assert.deepEqual(result.faces.job_only, [], 'the job alone selects every face');
  assert.deepEqual(result.faces.other, [], 'an unrelated --only names no face');
  assert.deepEqual(result.faces.unknown, ['NoSuchFace']);
  assert.equal(result.one.code, 0);
  assert.equal(result.alias.code, 0, 'the fonts/<face> alias works the same');
  assert.equal(result.unknown.code, 2);
  assert.match(result.unknown.stderr, /--only font: no pinned face named NoSuchFace \(pinned: FakeFont-One, FakeFont-Two\)/);
  assert.deepEqual(result.manifest_fonts, ['FakeFont-One'], 'the run lists the face it extracted');
});

test('a plain extract treats fonts as optional: a missing install, face or pinned bytes warns and exits 0', { skip: !PY && 'no python' }, () => {
  const result = runDriver('full-fonts');
  assert.deepEqual(result.codes, { no_game: 0, listed: 0, unlisted: 0, sha: 0, empty: 1 }, 'a font skip never fails a run');
  assert.match(result.errs.no_game, /skip fonts: no Arknights_Data directory/);
  assert.match(result.errs.no_game, /local font fallback stays active/);
  assert.match(result.errs.unlisted, /warn fonts: none of the pinned official faces was listed/);
  assert.match(result.errs.sha, /warn fonts: none of the pinned official faces was listed/);
  assert.match(result.outs.sha, /conflict font FakeFont-One: source 64 B [0-9a-f]{12} != pinned/);
  assert.doesNotMatch(result.errs.no_game, /required/);
  assert.match(result.errs.empty, /nothing was extracted/);
});

test('main() hands --only font the install Arknights_Data, not the temporary hot-update AB root', { skip: !PY && 'no python' }, () => {
  const result = runDriver('hot-update');
  assert.equal(result.code, 0);
  assert.equal(result.captured.locate_client, 1);
  assert.equal(result.captured.bundled_base, result.ab);
  assert.equal(result.captured.ab_root, 'TEMP-HOT-ROOT');
  assert.equal(result.captured.game_arg, null);
  assert.equal(result.captured.game_data, 'GAME_DATA');
});

test('--only shopdocs registers prefabs.json / card.json / shop.json, prints them, and needs --themes', { skip: !PY && 'no python' }, () => {
  const result = runDriver('shopdocs');
  assert.equal(result.total, 3);
  assert.deepEqual(result.groups, ['themes/ac_n_iron']);
  assert.deepEqual(result.calls, [{ themes: ['themes-dir'], ids: ['ac_n_iron'], shopdocs: true }],
    'export_shopdocs calls the merged producer with the shopdocs flag, not a legacy module');
  assert.deepEqual(result.logs.slice(0, 3), [
    'shopdocs: themes/ac_n_iron/prefabs.json',
    'shopdocs: themes/ac_n_iron/card.json',
    'shopdocs: themes/ac_n_iron/shop.json',
  ]);
  assert.equal(result.logs.at(-1), 'shopdocs: themes/ac_n_iron/shop.json',
    'no misleading base-documents-only line after the enrichment steps');
  assert.equal(result.code, 2);
  assert.match(result.stderr, /--only shopdocs needs --themes/);
});

test('previous_groups: a full extract keeps an earlier groups.fonts, an --only run keeps every group', { skip: !PY && 'no python' }, () => {
  const result = runDriver('full-run');
  assert.deepEqual(result.kept, ['char/x', 'fonts', 'spine/char/char_1/front', 'ui/cursor']);
  assert.deepEqual(result.partial, ['char/x', 'fonts', 'spine/char/char_1/front', 'themes/ac_s_closur', 'ui/common', 'ui/cursor']);
  assert.deepEqual(result.merged, ['char/x', 'fonts', 'spine/char/char_1/front', 'ui/cursor']);
  // --only takes the documented aliases: `font` (and a face path below it) selects the fonts group, and an unrelated
  // partial word keeps the old exact-prefix rule (`common` selects neither ui/common nor map/common).
  assert.deepEqual(result.wants, [true, true, true, false]);
});

test('list_theme_files lists the files a theme producer left out, keeping the listed ones as they are', { skip: !PY && 'no python' }, () => {
  const result = runDriver('theme-files');
  assert.deepEqual(result.group['sprites/listed.webp'], {
    path: '/assets/local/themes/ac_s_closur/sprites/listed.webp', kind: 'Sprite', w: 7, h: 9,
  }, 'a listed file keeps its own entry');
  assert.deepEqual(result.group['sprites/ext_cost_free.webp'], {
    path: '/assets/local/themes/ac_s_closur/sprites/ext_cost_free.webp', kind: 'Sprite',
  }, 'the free-refresh plate the shop prefab names is now resolvable');
  assert.deepEqual(result.group['theme.json'], {
    path: '/assets/local/themes/ac_s_closur/theme.json', kind: 'TextAsset',
  });
  assert.deepEqual(result.logs.sort(), [
    'themes: listed themes/ac_s_closur/sprites/ext_cost_free.webp (the producer left it out)',
    'themes: listed themes/ac_s_closur/theme.json (the producer left it out)',
  ]);
  // S7: a `shaders/*.md` porting page is a developer note, never theme data. The fixture has a stale one on disk and
  // an older manifest entry for it; neither the listing nor the merged (re-run) group may carry it.
  assert.deepEqual(result.kinds, ['.atlas', '.jpg', '.json', '.mp3', '.png', '.skel', '.webp'], 'no .md kind remains');
  assert.deepEqual(Object.keys(result.group).sort(), ['sprites/ext_cost_free.webp', 'sprites/listed.webp', 'theme.json']);
  assert.deepEqual(result.merged, ['sprites/ext_cost_free.webp', 'sprites/listed.webp', 'theme.json'],
    'the re-run group replaces an old list that still named shaders/x.md');
  assert.ok(!result.logs.some((line) => line.includes('.md')), 'a skipped page is not even logged as listed');
});

test('the card producer writes no shader pages and card records carry no doc / shaderDoc (S7)', { skip: !PY && 'no python' }, () => {
  const result = runDriver('card-shaders');
  assert.equal(result.pages, 0, 'card_prefab no longer renders a shader porting page');
  assert.deepEqual(result.files, [], 'the card file list names no shaders/*.md');
  assert.ok(!result.record.includes('doc'), 'a shader record has no page link');
  assert.deepEqual(result.record.filter((key) => ['name', 'cab', 'compiled', 'properties'].includes(key)),
    ['cab', 'compiled', 'name', 'properties'], 'the record itself stays in card.json');
  assert.deepEqual(result.material, ['name', 'shader'], 'the material gains no shaderDoc');
  // The producer's registration loop filters `.md` from card_files as a guard for an older producer; it is
  // inline in _export_one with no cheap seam, so this pins the guard rather than driving that whole bundle function.
  assert.equal(result.guard, true, 'the card-file registration still skips .md');
  assert.equal(result.shopdocsDefault, false, '`--only theme` keeps the shop / card documents off');
  assert.equal(result.shopdocsGate, true, 'the merged _export_one writes them only behind that flag');
  assert.match(result.module, /tools[/\\]local-extract[/\\]autochess_themes\.py$/,
    'there is one flat producer module, not a legacy copy');
});

test('bundle_paths: PersistentData, then StreamingAssets/AB/Windows, then a handed AB root, else the existing error', { skip: !PY && 'no python' }, () => {
  const result = runDriver('bundles');
  for (const name of ['theme_particles', 'path_ids']) {
    assert.match(result.missing[name].error, /^missing current bundles: /, name);
    assert.match(result.missing[name].error, /also looked in /, name);
    assert.ok(result.streaming[name][0].includes('StreamingAssets'), `${name}: the packaged tree is the fallback`);
    assert.ok(result.streaming[name][1].includes('StreamingAssets'), name);
    assert.ok(result.persistent[name][0].includes('PersistentData'), `${name}: a hot-updated bundle wins`);
    assert.ok(result.persistent[name][1].includes('PersistentData'), name);
    assert.ok(result.root[name][0].startsWith(result.tmp) && result.root[name][0].includes('Bundles'), `${name}: a handed AB root resolves`);
    assert.ok(result.root[name][1].startsWith(result.tmp), name);
    assert.ok(result.split[name][0].includes('PersistentData'), `${name}: theme may be hot-update only`);
    assert.ok(result.split[name][1].includes('StreamingAssets'), `${name}: battle may be packaged only`);
  }
  assert.deepEqual(result.gameData, [true, true],
    'path_ids.game_data accepts both an Arknights_Data and a bare AB root');
});
