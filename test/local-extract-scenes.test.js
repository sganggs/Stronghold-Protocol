// #684 / DESIGN §34.24: synthetic complete renderer lists only; no official mesh or texture bytes.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TOOL = fileURLToPath(new URL('../tools/local-extract', import.meta.url));
const PY = ['python3', 'python'].find((bin) => spawnSync(bin, ['--version']).status === 0);

function py(code) {
  const src = `import sys, json, copy
sys.path.insert(0, ${JSON.stringify(TOOL)})
import scenes as s
def renderer(pid=1, group='', static=True):
    tree = {'m_GameObject': {'m_FileID': 0, 'm_PathID': pid}, 'm_Enabled': True,
            'm_Materials': [{'m_FileID': 2, 'm_PathID': 11}, {'m_FileID': 2, 'm_PathID': 12}],
            'm_CastShadows': 1, 'm_SortingOrder': 0, 'm_AdditionalVertexStreams': {'m_FileID': 0, 'm_PathID': 0},
            'm_StaticBatchInfo': {'firstSubMesh': pid, 'subMeshCount': int(static)},
            'm_LightmapIndex': pid, 'm_LightmapTilingOffset': {'x': 1 / pid, 'y': 1 / pid, 'z': 0, 'w': 0}}
    parts = [{'material': material, 'lightmap': 0, 'pos': [(0, 0, 0), (1, 0, 0), (0, 1, 0)],
              'uv': [(0, 0), (1, 0), (0, 1)], 'uv1': [(0, 0), (0.1, 0), (0, 0.1)],
              'nrm': [(0, 0, 1)] * 3, 'col': [(1, 1, 1, 1)] * 3, 'idx': [0, 1, 2],
              'tangent': [(1, 0, 0, 1)] * 3, 'extraUV': {2: [(0, 0)] * 3}} for material in ('stone', 'sand')]
    return {'id': pid, 'path': 'Scene/Rock' + str(pid), 'group': group, 'static': static,
            'state': s.renderer_state(tree, 0), 'world': copy.deepcopy(s.IDENTITY), 'parts': parts}
def result(rows):
    logs = []
    kept = s.drop_duplicate_renderers(rows, logs.append)
    return {'kept': [r['id'] for r in kept], 'logs': logs}
${code}`;
  const r = spawnSync(PY, ['-I', '-B', '-c', src], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

describe('exact scene renderer duplicates (no UnityPy)', { skip: !PY && 'no python3' }, () => {
  test('drops an entire exact loose copy, retaining the base static bake regardless of input order', () => {
    const out = py(`a, b = renderer(), renderer(2, 'HIDDEN@1', False)
for p in b['parts']:
    p['uv1'] = [(0.25, 0)] * 3
    for attr in ('pos', 'uv', 'uv1', 'nrm', 'col', 'tangent'): p[attr] = [p[attr][i] for i in (2, 0, 1)]
    p['idx'] = [1, 2, 0]
print(json.dumps([result([a, b]), result([b, a])]))`);
    for (const r of out) {
      assert.deepEqual(r.kept, [1]);
      assert.equal(r.logs.length, 1);
      assert.match(r.logs[0], /drop renderer #2 Scene\/Rock2 \[HIDDEN@1\].*#1 Scene\/Rock1 \[base\], 2 triangles/);
    }
  });

  test('admits only the absolute float32 bake epsilon for positions, normals and world transform', () => {
    const out = py(`a, b = renderer(), renderer(2, 'HIDDEN@1', False)
b['world'][0][3] += s.DUPLICATE_EPSILON * 0.5
b['parts'][0]['pos'][0] = (s.DUPLICATE_EPSILON * 0.5, 0, 0)
b['parts'][0]['nrm'][0] = (s.DUPLICATE_EPSILON * 0.5, 0, 1)
print(json.dumps(result([a, b])))`);
    assert.deepEqual(out.kept, [1]);
  });

  test('keeps near-but-different transforms and meshes, including large world coordinates', () => {
    const out = py(`results = []
for field in ('world', 'pos', 'nrm'):
    a, b = renderer(), renderer(2)
    if field == 'world':
        a['world'][0][3], b['world'][0][3] = 1000, 1000 + 2e-6
    else: b['parts'][0][field][0] = (2e-6, 0, 1 if field == 'nrm' else 0)
    results.append(result([a, b]))
print(json.dumps(results))`);
    for (const r of out) assert.deepEqual(r, { kept: [1, 2], logs: [] });
  });

  test('keeps a single hidden renderer and copies in independently switched hidden groups', () => {
    const out = py(`a, b = renderer(1, 'HIDDEN@1'), renderer(2, 'HIDDEN@2')
print(json.dumps([result([a]), result([a, b])]))`);
    assert.deepEqual(out, [{ kept: [1], logs: [] }, { kept: [1, 2], logs: [] }]);
  });

  test('keeps an inactive base from replacing a visible hidden copy', () => {
    const out = py(`print(json.dumps(result([renderer(1, 'inactive'), renderer(2, 'HIDDEN@1')])))`);
    assert.deepEqual(out, { kept: [1, 2], logs: [] });
  });

  test('keeps partial overlaps, extra submeshes, different triangle winding and topology', () => {
    const out = py(`results = []
for change in ('partial', 'extra', 'winding', 'topology'):
    a, b = renderer(), renderer(2)
    if change == 'partial': b['parts'][1]['pos'][2] = (0, 2, 0)
    if change == 'extra': b['parts'].append(copy.deepcopy(b['parts'][0]))
    if change == 'winding': b['parts'][0]['idx'] = [0, 2, 1]
    if change == 'topology': b['parts'][0]['idx'] += [0, 1, 2]
    results.append(result([a, b]))
print(json.dumps(results))`);
    for (const r of out) assert.deepEqual(r, { kept: [1, 2], logs: [] });
  });

  test('keeps different UVs, colours, materials/textures, layers and lightmap-independent draw state', () => {
    const out = py(`results = []
for field in ('uv', 'col', 'tangent', 'extraUV', 'material', 'texture', 'layer', 'shadows', 'sorting', 'unknown'):
    a, b = renderer(), renderer(2)
    if field == 'uv': b['parts'][1]['uv'][0] = (0.001, 0)
    if field == 'col': b['parts'][1]['col'][0] = (0.9, 1, 1, 1)
    if field == 'tangent': b['parts'][1]['tangent'][0] = (1, 0, 0, -1)
    if field == 'extraUV': b['parts'][1]['extraUV'][2][0] = (0.1, 0)
    if field == 'material': b['parts'][1]['material'] = 'different'
    if field == 'texture': b['state']['renderer']['m_Materials'][1]['m_PathID'] = 99
    if field == 'layer': b['state']['layer'] = 1
    if field == 'shadows': b['state']['renderer']['m_CastShadows'] = 0
    if field == 'sorting': b['state']['renderer']['m_SortingOrder'] = 1
    if field == 'unknown': b['state']['renderer']['new_renderer_feature'] = 1
    results.append(result([a, b]))
print(json.dumps(results))`);
    for (const r of out) assert.deepEqual(r, { kept: [1, 2], logs: [] });
  });

  test('prefers a usable lightmap in the same group over a collapsed bake, even with a higher id', () => {
    const out = py(`a, b = renderer(1, 'HIDDEN@1'), renderer(2, 'HIDDEN@1')
for p in a['parts']: p['uv1'] = [(0.25, 0)] * 3
print(json.dumps(result([a, b])))`);
    assert.deepEqual(out.kept, [2]);
    assert.match(out.logs[0], /drop renderer #1.*#2/);
  });

  test('preserves the valid normal bake when both lightmaps have area; identical bake ties use the stable id', () => {
    const out = py(`a, b = renderer(2), renderer(1, 'HIDDEN@1', False)
for p in b['parts']: p['uv1'] = [(0.5, 0.5), (0.6, 0.5), (0.5, 0.6)]
print(json.dumps([result([b, a]), result([renderer(2), renderer(1)])]))`);
    assert.deepEqual(out[0].kept, [2]);
    assert.deepEqual(out[1].kept, [1]);
  });

  test('never proves a duplicate from incomplete renderer state or a non-finite world transform', () => {
    const out = py(`results = []
for field in ('state', 'parts', 'nan'):
    a, b = renderer(), renderer(2)
    if field == 'state': b['state'] = None
    if field == 'parts': b['parts'] = []
    if field == 'nan': b['world'][0][3] = float('nan')
    results.append(result([a, b]))
print(json.dumps(results))`);
    for (const r of out) assert.deepEqual(r, { kept: [1, 2], logs: [] });
  });
});
