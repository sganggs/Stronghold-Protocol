// test/tools/local-extract-fonts.test.js — fonts.py: write a pinned font, keep a local file with the same hash,
// never overwrite a conflicting one, skip a missing source; --only font's non-zero exit when nothing was written and
// main() handing it the install's Arknights_Data rather than the temporary hot-update root; a full extract keeping an
// earlier groups.fonts (extract.py previous_groups); and --only shopdocs registering and printing the archived
// producer's prefabs.json / card.json / shop.json with --themes required.
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
elif scenario not in ('full-run', 'font-exit', 'hot-update', 'shopdocs'):
    raise SystemExit('unknown scenario ' + scenario)

if scenario == 'full-run':
    import importlib.util
    spec = importlib.util.spec_from_file_location('extract', str(tool / 'extract.py'))
    extract = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(extract)
    old = {'fonts': {'a': {'path': '/x'}}, 'ui/common': {'b': {}}, 'char/x': {'c': {}},
           'themes/ac_s_closur': {'d': {}}}
    kept = extract.previous_groups(old, [])
    result = {'kept': sorted(kept), 'partial': sorted(extract.previous_groups(old, ['ui/common'])),
              'merged': sorted(extract.merge_manifest(kept, {}, set())), 'logs': []}
elif scenario == 'font-exit':
    # --only font returns non-zero when nothing was written or listed (extract.py: fonts_ok)
    import argparse, contextlib, importlib.util, io
    spec = importlib.util.spec_from_file_location('extract', str(tool / 'extract.py'))
    extract = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(extract)

    def make_args():
        return argparse.Namespace(only=['font'], themes=[], out=str(work / 'out'), manifest=str(work / 'manifest.json'),
                                  plugin_root='.', plugin_art=False, scenes=[], fx_set='sample', fx_keys='',
                                  fx_jobs=0, fx_add_only=False, fx_texture_format='webp', game=None)

    printed = io.StringIO()
    codes = {}
    with contextlib.redirect_stdout(printed):
        codes['no_game'] = extract.extract(make_args(), str(work / 'fake-ab'), None, None)
        game2 = work / 'client' / 'Arknights_Data'
        game2.mkdir(parents=True)
        extract.fonts.export_fonts = lambda *a, **k: 0
        codes['nothing'] = extract.extract(make_args(), str(work / 'fake-ab'), None, game2)

        def keep(game, out_root, manifest, log, only=None):
            manifest.setdefault('fonts', {})['FakeFont-One'] = {'path': '/assets/local/fonts/FakeFont-One.ttf'}
            return 0

        extract.fonts.export_fonts = keep
        codes['kept'] = extract.extract(make_args(), str(work / 'fake-ab'), None, game2)
    result = {'codes': codes, 'logs': printed.getvalue().splitlines()}
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
    # --only shopdocs registers prefabs.json / card.json / shop.json and prints them; --themes is mandatory.
    import argparse, contextlib, importlib.util, io, types
    spec = importlib.util.spec_from_file_location('extract', str(tool / 'extract.py'))
    extract = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(extract)
    logs = []
    manifest = {}
    legacy = types.SimpleNamespace(THEME_SUB='themes')

    def export_themes(themes_dirs, out_root, manifest_, log, ids, repo_root, game_root=None):
        for tid in ids:
            manifest_['themes/' + tid] = {rel: {'path': '/x'} for rel in extract.SHOPDOC_FILES}
        return len(ids) * len(extract.SHOPDOC_FILES)

    legacy.export_themes = export_themes
    extract.load_legacy_themes = lambda: legacy
    total = extract.export_shopdocs(None, str(work / 'out'), manifest, logs.append, ['ac_n_iron'], ['themes-dir'])

    def make_args():
        return argparse.Namespace(only=['shopdocs'], themes=[], out=str(work / 'out'), manifest=str(work / 'manifest.json'),
                                  plugin_root='.', plugin_art=False, scenes=[], fx_set='sample', fx_keys='',
                                  fx_jobs=0, fx_add_only=False, fx_texture_format='webp', game=None)

    err = io.StringIO()
    with contextlib.redirect_stderr(err):
        code = extract.extract(make_args(), str(work / 'fake-ab'), None, None)
    result = {'total': total, 'logs': logs, 'groups': sorted(manifest), 'code': code, 'stderr': err.getvalue()}
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

test('--only font exits non-zero when nothing was written, and only a listed font group counts as extracted', { skip: !PY && 'no python' }, () => {
  const result = runDriver('font-exit');
  assert.deepEqual(result.codes, { no_game: 1, nothing: 1, kept: 0 });
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
  assert.deepEqual(result.logs.slice(0, 3), [
    'shopdocs: themes/ac_n_iron/prefabs.json',
    'shopdocs: themes/ac_n_iron/card.json',
    'shopdocs: themes/ac_n_iron/shop.json',
  ]);
  assert.match(result.logs.at(-1), /base documents only .* enrichment/);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /--only shopdocs needs --themes/);
});

test('previous_groups: a full extract keeps an earlier groups.fonts, an --only run keeps every group', { skip: !PY && 'no python' }, () => {
  const result = runDriver('full-run');
  assert.deepEqual(result.kept, ['char/x', 'fonts']);
  assert.deepEqual(result.partial, ['char/x', 'fonts', 'themes/ac_s_closur', 'ui/common']);
  assert.deepEqual(result.merged, ['char/x', 'fonts']);
});
