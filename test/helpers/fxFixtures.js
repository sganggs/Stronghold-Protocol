// Small original fixtures, never extracted assets.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { png } from './pluginFixtures.js';

export function fxFixture(t) {
  const root = fs.mkdtempSync(path.join(process.env.SP_FX_TEST_TMP || os.tmpdir(), 'fx-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const put = (rel, doc) => { const abs = path.join(root, rel); fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, Buffer.isBuffer(doc) ? doc : JSON.stringify(doc)); };
  return { root, put };
}
export const book = () => ({ image: 'fx/sheet.png', frames: 4, cols: 2, fps: 10, anchor: [0.5, 0.5], scale: 1, blend: 'add', loop: false });
export const prefab = () => ({ format: 'fx-prefab', version: 1, key: 'spark', root: 0, nodes: [{ id: 0, parent: null, name: 'root',
  children: [], meshFilter: { builtin: 'Quad' }, meshRenderer: { materials: [0] }, behaviours: [{ class: 'ParticleEffect', fields: { _maxLifetime: 0.5 } }] }],
  materials: [{ name: 'spark', shader: 'Torappu/Particles/Additive', textures: { _MainTex: { tex: 'sheet', st: [1, 1, 0, 0] } } }], textures: ['sheet'], refs: [], clips: [], meshes: [] });
export function compiled(f) {
  const skill = { uses: [{ keys: ['spark'], role: 'start', from: 'Skill._beginEffect' }], mode: 0 };
  const index = { format: 'fx-index', version: 3, units: { char_x_fx_demo_guard: { kind: 'char', skills: { skx_fx_demo_one: skill },
    modes: [{ name: 'Default', attack: { cast: [{ effects: ['spark'], oneshot: true }], hit: [{ effects: ['spark'], oneshot: true }] } }] } },
  skills: { skx_fx_demo_one: skill }, prefabs: { spark: { file: 'fx/prefabs/spark.json', looping: false } }, textures: { sheet: { file: 'fx/sheet.png' } } };
  f.put('fx/index.json', index); f.put('fx/prefabs/spark.json', prefab()); f.put('fx/sheet.png', png(8, 8));
  return index;
}
