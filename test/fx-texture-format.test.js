// Effect texture transport: unchanged WebP defaults, optional PNG, mixed manifests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FxLibrary } from '../public/js/render/vfx/library.js';
import { rewriteManifest } from '../server/http/assetViews.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = path.join(ROOT, 'tools/local-extract');
const PY = ['python3', 'python'].find(bin => spawnSync(bin, ['--version']).status === 0);
const ENV = { ...process.env, PYTHONDONTWRITEBYTECODE: '1' };
const pillow = PY && spawnSync(PY, ['-c', 'from PIL import Image, features; assert features.check("webp")'], { env: ENV }).status === 0;

function py(code) {
  const r = spawnSync(PY, ['-c', `import sys, json, tempfile, pathlib, types, io\nsys.path.insert(0, ${JSON.stringify(TOOL)})\nimport fx\nfrom PIL import Image\n${code}`], { encoding: 'utf8', env: ENV });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test('extraction preserves default WebP bytes and encoder options; PNG is lossless opt-in', { skip: !pillow && 'needs Pillow with WebP' }, () => {
  const out = py(`
from unittest.mock import patch
with tempfile.TemporaryDirectory() as tmp:
    img = Image.new('RGBA', (128, 64))
    img.putdata([(x * 2, y * 4, (x + y) % 256, (x * 3 + y * 7) % 256) for y in range(64) for x in range(128)])
    tex = types.SimpleNamespace(image=img, m_Name='fixture', m_Width=128, m_Height=64)
    obj = types.SimpleNamespace(read=lambda: tex)
    env = types.SimpleNamespace(tt=lambda o: {'m_TextureFormat': 4, 'm_TextureSettings': {'m_WrapU': 1, 'm_FilterMode': 0}})
    half_img = img.convert('RGBa').resize((64, 32), Image.LANCZOS).convert('RGBA')
    expected = []
    for original in (img, half_img):
        buf = io.BytesIO()
        original.save(buf, 'WEBP', quality=90, method=4)
        expected.append(buf.getvalue())
    save = Image.Image.save
    calls = []
    def record(self, fp, format=None, **options):
        calls.append({'format': format, 'options': options})
        return save(self, fp, format, **options)
    exports = []
    for encoding in (None, 'png'):
        target = pathlib.Path(tmp) / (encoding or 'default')
        ex = fx.Exporter(env, target, **({'texture_format': encoding} if encoding else {}))
        with patch.object(Image.Image, 'save', record):
            key = ex._export_texture(obj)
        meta = ex.textures[key]
        full_path, half_path = (target / 'fx' / meta[f] for f in ('file', 'half'))
        full = Image.open(full_path).convert('RGBA')
        half = Image.open(half_path).convert('RGBA')
        exports.append({'key': key, 'meta': meta, 'size': full.size, 'halfSize': half.size,
                        'defaultBytesMatch': [p.read_bytes() == raw for p, raw in zip((full_path, half_path), expected)],
                        'alphaExact': full.getchannel('A').tobytes() == img.getchannel('A').tobytes(),
                        'pixelsExact': full.tobytes() == img.tobytes(),
                        'halfPixelsExact': half.tobytes() == half_img.tobytes()})
    default_file = pathlib.Path(tmp) / 'save-default.webp'
    with patch.object(Image.Image, 'save', record):
        fx.save_texture(img, default_file)
    print(json.dumps({'exports': exports, 'calls': calls, 'constants': [fx.WEBP_QUALITY, fx.WEBP_METHOD],
                      'defaultSaveBytes': default_file.read_bytes() == expected[0]}))`);
  assert.deepEqual(out.constants, [90, 4]);
  assert.deepEqual(out.calls, [
    { format: 'WEBP', options: { quality: 90, method: 4 } },
    { format: 'WEBP', options: { quality: 90, method: 4 } },
    { format: 'PNG', options: {} },
    { format: 'PNG', options: {} },
    { format: 'WEBP', options: { quality: 90, method: 4 } },
  ]);
  assert.equal(out.defaultSaveBytes, true);
  const [webp, png] = out.exports;
  assert.deepEqual(webp.defaultBytesMatch, [true, true]);
  assert.deepEqual(webp.meta, { name: 'fixture', w: 128, h: 64, format: 'RGBA32', mips: 1, srgb: true, alpha: true,
    file: `tex/${webp.key}.webp`, half: `tex/half/${webp.key}.webp`, wrapU: 'clamp', wrapV: 'repeat', filter: 'point', aniso: 0 });
  assert.equal(png.key, webp.key);
  assert.equal(png.meta.encoding, 'png');
  for (const [i, encoding] of ['webp', 'png'].entries()) {
    const entry = out.exports[i];
    assert.ok(entry.meta.file.endsWith(`.${encoding}`));
    assert.ok(entry.meta.half.endsWith(`.${encoding}`));
    assert.deepEqual(entry.size, [128, 64]);
    assert.deepEqual(entry.halfSize, [64, 32]);
    assert.equal(entry.alphaExact, true);
    assert.equal(entry.meta.wrapU, 'clamp');
    assert.equal(entry.meta.filter, 'point');
  }
  assert.equal(png.pixelsExact, true);
  assert.equal(png.halfPixelsExact, true);
  assert.equal(webp.meta.format, png.meta.format, 'source texture format remains separate from file encoding');
});

test('flag-free extraction preserves an existing WebP set and targeted PNG updates produce a mixed manifest', { skip: !pillow && 'needs Pillow with WebP' }, () => {
  const out = py(`
from unittest.mock import patch
import contextlib, extract
with tempfile.TemporaryDirectory() as tmp:
    root = pathlib.Path(tmp)
    # --game resolves recognizable client roots; bundle reads below remain mocked.
    (root / 'ui' / 'autochess').mkdir(parents=True)
    images = {key: Image.new('RGBA', (128, 64), color) for key, color in
              (('spark', (60, 100, 180, 120)), ('glow', (180, 80, 60, 80)))}
    class Env:
        def __init__(self, *args):
            pass
        def tt(self, obj):
            return {}
        def prefabs(self, rel):
            return {key: key for key in images}
    def prefab(self, key, obj, rel):
        image = images[key]
        texture = types.SimpleNamespace(image=image, m_Name=key, m_Width=128, m_Height=64)
        self._export_texture(types.SimpleNamespace(read=lambda: texture))
        file = 'prefabs/' + key + '.json'
        fx.write_atomic(self.out / file, b'{}')
        return {'file': file, 'bundle': rel, 'refs': []}
    dest = root / 'assets'
    manifest = root / 'data/local-fx.json'
    with contextlib.ExitStack() as stack:
        stack.enter_context(patch.object(fx, 'scan_cabs', return_value={}))
        stack.enter_context(patch.object(fx, 'container_index', return_value={key: 'fixture.ab' for key in images}))
        stack.enter_context(patch.object(fx, 'game_data', return_value={'chars': [], 'enemies': [], 'tokens': []}))
        stack.enter_context(patch.object(fx, 'crawl_units', return_value=({}, {}, {}, {}, set(images))))
        stack.enter_context(patch.object(fx, 'client_version', return_value='fixture'))
        stack.enter_context(patch.object(fx, 'AssetEnv', Env))
        stack.enter_context(patch.object(fx.Exporter, 'prefab', prefab))
        run = lambda **options: fx.export_fx(root, dest, {}, lambda line: None, selection='used', jobs=1,
                                             root=root, fx_manifest=manifest, **options)
        run()
        snapshot = lambda: {str(p.relative_to(root)): p.read_bytes() for p in root.rglob('*') if p.is_file()}
        original = snapshot()
        groups = json.loads(manifest.read_text())['groups']
        first = [entry['path'] for entry in groups['fx/tex'].values()]
        fields = [sorted(entry) for entry in groups['fx/tex'].values()]
        run()
        unchanged = snapshot() == original
        run(keys=['spark'], texture_format='png')
        mixed = json.loads(manifest.read_text())['groups']['fx/tex']
        mixed_files = sorted(pathlib.PurePosixPath(entry['path']).suffix for entry in mixed.values())
        run()
        restored = snapshot() == original
        # Exercise the CLI call used by setup, with no texture-format flag, against the same synthetic source.
        args = ['extract.py', '--game', str(root), '--only', 'fx', '--fx-set', 'used', '--fx-jobs', '1',
                '--out', str(dest), '--manifest', str(root / 'data/local-assets.json')]
        with patch.object(sys, 'argv', args), contextlib.redirect_stdout(io.StringIO()):
            assert extract.main() == 0
        cli_unchanged = all((root / name).read_bytes() == raw for name, raw in original.items())
    print(json.dumps({'first': first, 'fields': fields, 'unchanged': unchanged, 'mixed': mixed_files,
                      'restored': restored, 'cliUnchanged': cli_unchanged}))`);
  assert.equal(out.first.length, 2);
  assert.ok(out.first.every(url => url.endsWith('.webp')));
  assert.deepEqual(out.fields, Array(2).fill(['h', 'half', 'kind', 'path', 'w']));
  assert.equal(out.unchanged, true);
  assert.deepEqual(out.mixed, ['.png', '.webp']);
  assert.equal(out.restored, true, 'full default extraction keeps WebP files and removes obsolete PNG copies');
  assert.equal(out.cliUnchanged, true, 'the flag-free CLI keeps the WebP set byte-identical');
});

test('an unavailable WebP encoder fails before extraction writes an output', { skip: !pillow && 'needs Pillow' }, () => {
  assert.deepEqual(py(`
from PIL import features
features.check = lambda name: False
with tempfile.TemporaryDirectory() as tmp:
    target = pathlib.Path(tmp) / 'unwritten'
    try:
        fx.export_fx(pathlib.Path(tmp), target, {}, lambda line: None)
    except RuntimeError:
        print(json.dumps({'written': target.exists()}))
    else:
        raise AssertionError('encoder absence was accepted')`), { written: false });
});

test('mixed PNG/WebP and legacy entries use exactly the manifest full/half URLs and retain hashing', async () => {
  const groups = { fx: { textures: { path: '/t.json' } }, 'fx/prefabs': { spark: { path: '/spark.json' } }, 'fx/mesh': {},
    'fx/tex': {
      png: { path: '/assets/local/fx/tex/a.png', half: '/assets/local/fx/tex/half/a.png', encoding: 'png' },
      webp: { path: '/assets/local/fx/tex/b.webp', half: '/assets/local/fx/tex/half/b.webp', encoding: 'webp' },
      legacy: { path: '/assets/local/fx/tex/old.webp' },
    } };
  const list = rewriteManifest({ groups }, 'local-fx.json', { hashOf: () => '1234567890abcdef', modelHash: () => null }).doc;
  const lib = new FxLibrary({ list, fetch: async () => ({ ok: true, json: async () => ({ textures: { png: { wrapU: 'clamp' } } }) }) });
  const loaded = [];
  lib._image = async url => { loaded.push(url); return { image: { width: 8, height: 4 }, flipped: true }; };
  for (const key of ['png', 'webp', 'legacy']) for (const half of [false, true]) {
    const r = await lib.loadTexture(key, half);
    assert.ok(r.image);
    assert.equal(loaded.at(-1), half && list.groups['fx/tex'][key].half || list.groups['fx/tex'][key].path);
  }
  assert.equal(lib.texture('png', false).info.wrapU, 'clamp');
  assert.ok(loaded.every(url => url.includes('/~1234567890abcdef/')));
  lib.dropImages();
});
