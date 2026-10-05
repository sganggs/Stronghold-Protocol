// test/render/board3d-extract.test.js — the local-client exports behind the official 3D board (DESIGN §13/§15):
// tools/local-extract/extract.py's board jobs (gate / objective effects, blower texture, water & noise maps), the
// derived three.js maps (BC5 normal → RGB normal, Unity metallic/gloss → roughness), the WebP copies of the textures
// the renderer downloads (extract.py WEBP), the prefab mesh keys, and —
// when a client was extracted here — the files and manifest entries the renderer loads (render/board3d/load.js).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng } from '../../tools/crop-board-atlas.mjs';
import { PACK_IMAGES, PACK_MESHES, GATE_NODES } from '../../public/js/render/board3d/load.js';
import { VENDOR_FILES } from '../../tools/vendor.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TOOL = path.join(ROOT, 'tools/local-extract');
const ENV = { ...process.env, PYTHONDONTWRITEBYTECODE: '1' };
const PY = ['python3', 'python'].find((bin) => spawnSync(bin, ['--version']).status === 0);
const HAS_PIL = !!PY && spawnSync(PY, ['-c', 'import PIL'], { env: ENV }).status === 0;
const HAS_WEBP = HAS_PIL && spawnSync(PY, ['-c', "import sys; from PIL import features; sys.exit(0 if features.check('webp') else 1)"], { env: ENV }).status === 0;
const manifest = (() => { try { return JSON.parse(readFileSync(path.join(ROOT, 'data/local-assets.json'), 'utf8')); } catch { return null; } })();

function py(code) {
  const src = `import sys, json\nsys.path.insert(0, ${JSON.stringify(TOOL)})\nimport extract as e\n${code}`;
  const r = spawnSync(PY, ['-c', src], { encoding: 'utf8', env: ENV });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

describe('extract.py board jobs', { skip: !PY && 'no python3' }, () => {
  test('job table: gate effects, blower texture and water maps; derived maps for the theme', () => {
    const r = spawnSync(PY, [path.join(TOOL, 'extract.py'), '--print-jobs'], { encoding: 'utf8', env: ENV });
    assert.equal(r.status, 0, r.stderr);
    const { jobs, derived } = JSON.parse(r.stdout);
    const by = Object.fromEntries(jobs.map((j) => [j.sub, j]));
    assert.equal(by['map/fx'].bundle, 'arts/effects/[pack]map.ab');
    assert.deepEqual(by['map/fx'].kinds, ['GameObject', 'Material', 'Mesh', 'Texture2D']);
    assert.equal(by['map/common'].bundle, 'arts/maps/common/res.ab');
    assert.ok(new RegExp(by['map/common'].keep).test('TX_wind_device') && !new RegExp(by['map/common'].keep).test('TX_R6_bomb'));
    assert.ok(new RegExp(by['map/water'].keep).test('[ucp]TX_water_normal'));
    // no new mesh/ groups (the board meshes of DESIGN §15 stay the four of the mesh job table)
    assert.equal(jobs.filter((j) => j.sub.startsWith('mesh/')).length, 4);
    assert.deepEqual(derived.map((d) => [d.sub, d.from, d.derive, d.name]), [
      ['map/autochess', 'TX_autochessi_N', 'normal_rg', 'TX_autochessi_N_rgb'],
      ['map/autochess', 'TX_autochessi_M', 'rough_from_gloss', 'TX_autochessi_M_rough'],
    ]);
  });

  test('derived maps: Z of a two-channel normal map is rebuilt; roughness = 1 − smoothness', { skip: !HAS_PIL && 'no Pillow' }, () => {
    const out = py(`
from PIL import Image
n = Image.new('RGB', (3, 1))
n.putpixel((0, 0), (128, 128, 0)); n.putpixel((1, 0), (255, 128, 0)); n.putpixel((2, 0), (128, 20, 0))
rn = e.derive_normal_rg(n)
m = Image.new('RGBA', (2, 1)); m.putpixel((0, 0), (0, 0, 0, 0)); m.putpixel((1, 0), (0, 0, 0, 200))
rm = e.derive_rough_from_gloss(m)
print(json.dumps({'n': [list(rn.getpixel((i, 0))) for i in range(3)], 'm': [list(rm.getpixel((i, 0))) for i in range(2)], 'mode': [rn.mode, rm.mode]}))`);
    assert.deepEqual(out.mode, ['RGB', 'RGB']);
    assert.ok(out.n[0][2] >= 254, 'flat normal → z = 1');
    assert.ok(Math.abs(out.n[1][2] - 128) <= 1, 'x = 1 → z = 0 (byte 128)');
    assert.deepEqual(out.n[0].slice(0, 2), [128, 128], 'XY kept');
    assert.deepEqual(out.m, [[255, 255, 0], [255, 55, 0]]);
  });

  test('WebP copies: exactly the board textures the renderer downloads; normal and data maps stay lossless', () => {
    const r = spawnSync(PY, [path.join(TOOL, 'extract.py'), '--print-jobs'], { encoding: 'utf8', env: ENV });
    assert.equal(r.status, 0, r.stderr);
    const { webp } = JSON.parse(r.stdout);
    assert.deepEqual(webp.map((w) => `${w.sub}/${w.name}`).sort(), Object.values(PACK_IMAGES).map(([g, n]) => `${g}/${n}`).sort());
    const mode = Object.fromEntries(webp.map((w) => [w.name, w.mode]));
    for (const n of ['TX_autochessi_N_rgb', '[ucp]TX_water_normal', 'TX_autochessi_M_rough', 'T_noise_clouds_01']) assert.equal(mode[n], 'lossless', n);
    for (const n of ['TX_autochessi_D', 'TX_autochessi_BG', 'TX_autochessi_common_D']) assert.equal(mode[n], 'lossy', n);
  });

  test('run_webp / --webp: a copy beside the PNG that the manifest lists; normals exact, alpha and hidden RGB kept', { skip: !HAS_WEBP && 'no Pillow with WebP' }, () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sp-webp-'));
    try {
      const out = py(`
from pathlib import Path
from PIL import Image
root = Path(${JSON.stringify(dir)})
sub = root / 'map' / 'autochess'
sub.mkdir(parents=True)
d = Image.new('RGBA', (64, 64), (200, 40, 40, 0))  # transparent texels whose colour the opaque board material shows
for x in range(32):
    for y in range(64): d.putpixel((x, y), (x * 8, y * 4, 90, 255))
d.save(sub / 'TX_autochessi_D.png')
n = Image.new('RGB', (64, 64))
for x in range(64):
    for y in range(64): n.putpixel((x, y), ((x * 37) % 256, (y * 53) % 256, 200 + (x + y) % 56))
n.save(sub / 'TX_autochessi_N_rgb.png')
entry = lambda name, kind: {'path': f'/assets/local/map/autochess/{name}.png', 'w': 64, 'h': 64, 'kind': kind}
groups = {'map/autochess': {'TX_autochessi_D': entry('TX_autochessi_D', 'Texture2D'),
                            'TX_autochessi_N_rgb': entry('TX_autochessi_N_rgb', 'Derived'),
                            'TX_autochessi_E': entry('TX_autochessi_E', 'Texture2D')}}
mf = root / 'local-assets.json'
mf.write_text(json.dumps({'version': 1, 'source': 'local-client', 'count': 3, 'groups': groups}))
logs = []
code = e.webp_only(root, mf, logs.append)
doc = json.loads(mf.read_text())
g = doc['groups']['map/autochess']
px = lambda p: list(Image.open(p).convert('RGBA').getdata())
a, b = px(sub / 'TX_autochessi_D.png'), px(sub / 'TX_autochessi_D.webp')
hidden = [q for p, q in zip(a, b) if p[3] == 0]
print(json.dumps({'code': code, 'paths': {k: v['path'] for k, v in g.items()}, 'modes': {k: v.get('webp') for k, v in g.items()},
                  'count': doc['count'], 'pngKept': (sub / 'TX_autochessi_D.png').exists(),
                  'alphaSame': all(p[3] == q[3] for p, q in zip(a, b)),
                  'normalSame': px(sub / 'TX_autochessi_N_rgb.png') == px(sub / 'TX_autochessi_N_rgb.webp'),
                  'hidden': [sum(q[i] for q in hidden) / len(hidden) for i in range(3)],
                  'again': e.run_webp(root, 'map/autochess', doc['groups'], logs.append)}))`);
      assert.equal(out.code, 0);
      const at = (n, ext) => `/assets/local/map/autochess/${n}.${ext}`;
      // TX_autochessi_E is listed without a PNG on disk: its entry stays as it was
      assert.deepEqual(out.paths, { TX_autochessi_D: at('TX_autochessi_D', 'webp'), TX_autochessi_N_rgb: at('TX_autochessi_N_rgb', 'webp'), TX_autochessi_E: at('TX_autochessi_E', 'png') });
      assert.deepEqual(out.modes, { TX_autochessi_D: 'lossy', TX_autochessi_N_rgb: 'lossless', TX_autochessi_E: null });
      assert.equal(out.count, 3);
      assert.ok(out.pngKept, 'the PNG stays beside the copy (crop tool, setup)');
      assert.ok(out.alphaSame, 'alpha lossless');
      assert.ok(out.normalSame, 'normal map lossless');
      out.hidden.forEach((v, i) => assert.ok(Math.abs(v - [200, 40, 40][i]) < 12, `RGB under alpha 0 kept: ${out.hidden}`));
      assert.equal(out.again, 2, 'a second run rewrites both copies');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('prefab_node names the exported OBJ of a mesh whose name is shared (map/fx has two Start_back meshes)', () => {
    const out = py(`
from types import SimpleNamespace as NS
class P:
    def __init__(self, obj=None, pid=1, fid=0): self.m_PathID, self.m_FileID, self._o = pid, fid, obj
    def read(self): return self._o
class MeshFilter:
    def __init__(self, **k): self.__dict__.update(k)
go = NS(m_Name='Start_back', m_Component=[NS(component=P(MeshFilter(m_Mesh=P(NS(m_Name='Start_back'), pid=42))))])
print(json.dumps([e.prefab_node(go)['mesh'], e.prefab_node(go, {42: 'Start_back_42'})['mesh'], e.prefab_node(go, {7: 'x'})['mesh']]))`);
    assert.deepEqual(out, ['Start_back', 'Start_back_42', 'Start_back']);
  });
});

describe('vendored three.js', () => {
  test('tools/vendor.mjs copies both ES modules of three (module imports ./three.core.js)', () => {
    const names = VENDOR_FILES.map((f) => f[1]);
    assert.ok(names.includes('three.module.js') && names.includes('three.core.js'));
    const mod = path.join(ROOT, 'public/vendor/three.module.js');
    if (existsSync(mod)) {
      assert.match(readFileSync(mod, 'utf8').slice(0, 4000), /from '\.\/three\.core\.js'/);
      assert.ok(existsSync(path.join(ROOT, 'public/vendor/three.core.js')));
    }
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.ok(pkg.dependencies.three, 'three is a dependency');
  });
});

describe('extracted board files (when a local client was extracted)', { skip: !manifest?.groups?.['map/fx'] && 'map/fx not extracted' }, () => {
  const onDisk = (p) => path.join(ROOT, 'public', decodeURIComponent(p));
  const pngOf = (p) => p.replace(/\.webp$/, '.png');  // a WebP copy (extract.py WEBP) keeps its PNG beside it
  const hasFiles = existsSync(path.join(ROOT, 'public/assets/local/map/fx'));

  test('every pack slot the renderer loads is in the manifest (and on disk)', () => {
    for (const [slot, [g, n]] of [...Object.entries(PACK_IMAGES), ...Object.entries(PACK_MESHES)]) {
      const e = manifest.groups[g]?.[n];
      assert.ok(e && e.path, `${slot}: ${g}/${n}`);
      if (hasFiles) assert.ok(existsSync(onDisk(e.path)), `${slot} file`);
    }
    const prefab = JSON.parse(readFileSync(onDisk(manifest.groups['map/fx'].prefab.path), 'utf8'));
    for (const node of Object.values(GATE_NODES)) {
      const rec = prefab.find((p) => p.name === node && (node !== 'Start_back' || p.parent === '[opt]start_box'));
      assert.ok(rec && manifest.groups['map/fx'][rec.mesh], `${node} → ${rec?.mesh}`);
    }
    const mats = JSON.parse(readFileSync(onDisk(manifest.groups['map/fx'].materials.path), 'utf8'));
    assert.equal(mats['[opt]start_end_add'].shader, 'Torappu/Particles/Additive');
    assert.equal(mats['[opt]start_end_ab'].shader, 'Torappu/Particles/AlphaBlend');
    assert.equal(mats['[opt]start_end_add'].textures._MainTex.texture, '[opt]merged_textures');
  });

  test('derived maps on disk: RGB normals point out of the surface; roughness mirrors the smoothness', { skip: !hasFiles && 'files not extracted' }, () => {
    const g = manifest.groups['map/autochess'];
    const n = decodePng(readFileSync(onDisk(pngOf(g.TX_autochessi_N_rgb.path))));
    let zSum = 0, cnt = 0;
    for (let i = 0; i < n.rgba.length; i += 4 * 97) { zSum += n.rgba[i + 2]; cnt++; }
    assert.ok(zSum / cnt > 230, `mean z ${zSum / cnt}`);
    const m = decodePng(readFileSync(onDisk(g.TX_autochessi_M.path)));
    const r = decodePng(readFileSync(onDisk(pngOf(g.TX_autochessi_M_rough.path))));
    assert.deepEqual([r.w, r.h], [m.w, m.h]);
    for (let i = 0; i < m.rgba.length; i += 4 * 131) assert.equal(r.rgba[i + 1], 255 - m.rgba[i + 3]);
  });

  test('the WebP copies the manifest lists are on disk with their PNGs beside them', { skip: !hasFiles && 'files not extracted' }, () => {
    for (const [g, entries] of Object.entries(manifest.groups)) {
      for (const [n, e] of Object.entries(entries)) {
        if (!/\.webp$/.test(e?.path || '')) continue;
        assert.ok(existsSync(onDisk(e.path)), `${g}/${n}`);
        assert.ok(existsSync(onDisk(pngOf(e.path))), `${g}/${n}: PNG`);
        assert.ok(e.webp === 'lossy' || e.webp === 'lossless', `${g}/${n}: mode ${e.webp}`);
      }
    }
  });
});
