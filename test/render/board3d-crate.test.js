// #663: the client crate, fallback boxes, DeviceView dimensions and model switches without WebGL / local art.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import * as THREE from 'three';
import { BoardScene, LIGHTING } from '../../public/js/render/board3d/scene.js';
import { parseObj } from '../../public/js/render/board3d/obj.js';
import { resolveUvTable } from '../../public/js/render/board3d/atlas.js';
import { DEVICE_BOX } from '../../public/js/render/tiles.js';
import { switchableBox } from '../../public/js/render/app/view.js';
import { presetCamera } from '../../public/js/render/projection.js';
import { installFakePixi, fakeViewCtx } from './fakepixi.js';

const stage = JSON.parse(readFileSync(new URL('../../data/stages.json', import.meta.url))).act1autochess_m01;
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
// A synthetic slanted quad: asymmetric bounds reveal swapped axes, recentering and double rotations.
const model = parseObj(['v -51 0.2 -52', 'v 50 0.2 -52', 'v 50 84 50', 'v -51 84 50',
  'vt 0.1 0.2', 'vt 0.9 0.2', 'vt 0.9 0.8', 'vt 0.1 0.8', 'vn 0 1 0',
  'f 1/1/1 2/2/1 3/3/1 4/4/1'].join('\n'));
const renderer = () => ({
  domElement: { addEventListener() {}, removeEventListener() {} }, shadowMap: {},
  setClearColor() {}, dispose() {},
});
const pack = () => ({
  key: 'crate-test', images: { D: { width: 4, height: 4 }, crate: { width: 4, height: 4 } },
  meshes: { crate: model }, uv: resolveUvTable(null),
  materials: { trap: { MT_trap_1105_accrate: { floats: { _Ambient: 0.809, _Diffuse: 0.271 } } } },
});
const boardOf = (p = pack()) => new BoardScene(THREE, p, { renderer: renderer(), environment: false });
const bounds = (g) => { g.computeBoundingBox(); return g.boundingBox; };
const light = [0.2, 0.7, 0.5];
const scenePack = () => ({
  key: 'scene', doc: { light: { dir: light, color: [1, 1, 1], intensity: 1 }, materials: {} }, images: {},
  chunks: [{ material: 'ground', lightmap: -1, position: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normal: new Int8Array([0, 0, 127, 0, 0, 0, 127, 0, 0, 0, 127, 0]), uv: new Float32Array(6),
    uv1: new Float32Array(6), color: new Uint8Array(12).fill(255), index: new Uint16Array([0, 1, 2]) }],
});

test('static crates preserve authored UVs, prefab orientation, scale and pivot on either board', () => {
  const board = boardOf();
  board.setStage(stage);
  const geom = board.crateGeometry();
  assert.equal(geom.uv, model.uv);
  for (let i = 0; i < model.position.length; i += 3) {
    near(geom.position[i], -model.position[i] * 0.01);
    near(geom.position[i + 1], model.position[i + 2] * 0.01);
    near(geom.position[i + 2], model.position[i + 1] * 0.01);
  }
  assert.deepEqual([...geom.normal.slice(0, 3)], [-0, 0, 1]);
  const check = () => {
    const mesh = board.meshes.crates;
    assert.equal(mesh.material, board.mat.crate);
    assert.equal(mesh.geometry.getAttribute('position').count, board.staticCrates.length * 4);
    assert.deepEqual([...mesh.geometry.getAttribute('uv').array.slice(0, 8)], [...model.uv]);
    assert.equal(mesh.material.uniforms.uAmbient.value, 0.809);
    assert.equal(mesh.material.uniforms.uDiffuse.value, 0.271);
    assert.equal(mesh.material.uniforms.uOpacity.value, 1);
  };
  check();
  board.setScenePack(stage.id, scenePack());
  assert.ok(board.official);
  check();
  assert.ok(board.mat.crate.uniforms.uLightDir.value.distanceTo(new THREE.Vector3(...light).normalize()) < 1e-6);
  board.destroy();
});

test('missing mesh, texture, normals or UVs preserves the atlas box and old DeviceView spec', () => {
  for (const missing of ['mesh', 'texture', 'normal', 'uv']) {
    const p = pack();
    if (missing === 'mesh') delete p.meshes.crate;
    else if (missing === 'texture') delete p.images.crate;
    else p.meshes.crate = { ...model, [missing]: null };
    const board = boardOf(p);
    board.setStage(stage);
    assert.equal(board.clientCrateGeometry(), null, missing);
    assert.equal(board.crateGeometry(), board.boxGeometry());
    assert.equal(board.meshes.crates.material, board.mat.board);
    assert.equal(board.deviceSpec(DEVICE_BOX.crate), DEVICE_BOX.crate);
    const h = board.createDevice(DEVICE_BOX.crate);
    const mesh = board.dynamic.children.at(-1);
    near(bounds(mesh.geometry).max.z, 0.675);
    h.update(null, { x: 0, y: 0, z: 0, ...DEVICE_BOX.crate, alpha: 0.5 });
    near(mesh.scale.x, 0.84 / 0.9);
    near(mesh.scale.z, 0.74 / 0.675);
    assert.equal(mesh.material.opacity, 0.5);
    assert.equal(mesh.material.onBeforeCompile, board.mat.board.onBeforeCompile);
    board.destroy();
  }
});

test('mounds keep the old box even with client crates; other battle devices do not use the crate model', () => {
  const p = pack();
  // A synthetic old box mesh proves the loaded s_common_box_01 path is kept as well as the procedural fallback.
  p.meshes.box = parseObj(['v -45 0 -45', 'v 45 0 -45', 'v 45 67.5 45', 'v -45 67.5 45',
    'vt 0 0', 'vn 0 0 1', 'f 1/1/1 2/1/1 3/1/1 4/1/1'].join('\n'));
  const board = boardOf(p);
  board.setStage({ ...stage, devices: [{ role: 'mound', key: 'mound', pos: [10, 5], active: true }] });
  const m = board.meshes.props;
  near(bounds(m.geometry).max.z, 0.675 * 0.55);
  assert.equal(m.material, board.mat.board);
  assert.notDeepEqual([...m.geometry.getAttribute('uv').array], [...model.uv]);
  assert.equal(board.boxGeometry().position.length, p.meshes.box.position.length);
  assert.equal(board.deviceSpec(DEVICE_BOX.turret), DEVICE_BOX.turret);
  board.createDevice(DEVICE_BOX.turret);
  assert.ok(board.dynamic.children.at(-1).material.isMeshStandardMaterial);
  board.destroy();
});

test('battle model matches static size, fades independently, keeps focus/light through rebuilds and disposes', () => {
  const board = boardOf();
  board.setStage(stage);
  const spec = board.deviceSpec(DEVICE_BOX.crate);
  near(spec.size, 1.01); near(spec.height, 0.84);
  const h = board.createDevice(DEVICE_BOX.crate), h2 = board.createDevice(DEVICE_BOX.crate);
  const [m, m2] = board.dynamic.children;
  const b = { x: 5, y: 10, z: 0.4, ...spec, alpha: 1 };
  h.update(null, b);
  near(m.scale.x, 1); near(m.scale.y, 1); near(m.scale.z, 1);
  near(bounds(m.geometry).min.z, 0.002);
  near(bounds(m.geometry).max.z, spec.height);
  assert.deepEqual(m.geometry.getAttribute('position').array, board.crateGeometry().position);
  for (const [key, value] of Object.entries(board.focus)) assert.equal(m.material.uniforms[key], value);
  assert.equal(m.material.uniforms.uMap, board.mat.crate.uniforms.uMap);
  h.update(null, { ...b, size: spec.size * 0.8, height: spec.height * 0.5, alpha: 0.5 });
  near(m.scale.x, 0.8); near(m.scale.z, 0.5);
  assert.equal(m.material.uniforms.uOpacity.value, 0.5);
  assert.equal(m.material.depthWrite, false);
  assert.equal(m2.material.uniforms.uOpacity.value, 1);
  assert.equal(board.mat.crate.uniforms.uOpacity.value, 1);
  assert.match(m.material.fragmentShader, /focusMask\(vWorld.xy\), uOpacity/);
  board.setBattleRect({ r0: 9, r1: 12, c0: 0, c1: 10 });
  assert.ok(board.staticCrates.length * 4 > (board.meshes.crates?.geometry.getAttribute('position').count || 0));
  board.setScenePack(stage.id, scenePack());
  assert.equal(m.parent, board.dynamic);
  assert.ok(m.material.uniforms.uLightDir.value.distanceTo(new THREE.Vector3(...light).normalize()) < 1e-6);
  board.setScenePack(stage.id, null);
  assert.ok(m.material.uniforms.uLightDir.value.distanceTo(new THREE.Vector3(...LIGHTING.key.dir).normalize()) < 1e-6);
  h.update(null, { ...b, alpha: 0 });
  assert.equal(m.visible, false);
  h.update(null, b);
  assert.equal(m.visible, true); assert.equal(m.material.depthWrite, true);
  let disposed = 0;
  m.geometry.addEventListener('dispose', () => disposed++);
  m.material.addEventListener('dispose', () => disposed++);
  h.destroy(); h.destroy();
  assert.equal(disposed, 2);
  h2.destroy(); board.destroy();
});

let fake, DeviceView;
before(async () => { fake = installFakePixi(); ({ DeviceView } = await import('../../public/js/render/units.js')); });
after(() => fake.restore());

test('DeviceView uses model size and HP height immediately across 3D → 2D → 3D, including death fade', () => {
  const board = boardOf();
  board.setStage(stage);
  let current = board, last2d;
  const ctx = fakeViewCtx(fake.P, { createBox: (spec) => switchableBox({ board: () => current, spec,
    pixi: () => ({ mesh: new fake.P.Container(), update(cam, b) { last2d = b; }, destroy() {} }) }) });
  const view = new DeviceView(ctx, { id: 1, defId: 'trap_1105_accrate', x: 5, y: 10, maxHp: 100 });
  view.hp = 50;
  const cam = presetCamera('normal', { width: 1280, height: 720 });
  view.update(0, cam, 0);
  const mesh = board.dynamic.children[0];
  near(mesh.scale.x, 1); near(mesh.scale.z, 1);
  near(view.screen.top, cam.project(5, 10, 0.84 + 0.35).y);
  near(view._headTiles, 1.04);
  assert.equal(view.hud.visible, true);
  current = null;
  view.update(0, cam, 0);
  assert.equal(board.devices.size, 0);
  near(last2d.size, 0.84); near(last2d.height, 0.74);
  near(view.screen.top, cam.project(5, 10, 0.74 + 0.35).y);
  current = board;
  view.update(0, cam, 0);
  near(board.dynamic.children[0].scale.z, 1);
  near(view.screen.top, cam.project(5, 10, 0.84 + 0.35).y);
  view.die(); view.dying = 0.225;
  view.update(0, cam, 0);
  near(board.dynamic.children[0].scale.x, 0.8);
  near(board.dynamic.children[0].scale.z, 0.5);
  near(board.dynamic.children[0].material.uniforms.uOpacity.value, 0.5);
  assert.equal(view.hud.visible, false);
  view.destroy(); board.destroy();
});

const localObj = new URL('../../public/assets/local/mesh/trap_110/trap_1105_accrate.obj', import.meta.url);
test('extracted client model: 636 vertices, 344 triangles, original UVs and measured prefab bounds', { skip: !existsSync(localObj) && 'not extracted' }, () => {
  const p = pack(); p.meshes.crate = parseObj(readFileSync(localObj, 'utf8'));
  const board = boardOf(p);
  const h = board.createDevice(DEVICE_BOX.crate), m = board.dynamic.children[0];
  const bb = bounds(m.geometry);
  assert.equal(m.geometry.getAttribute('position').count, 636);
  assert.equal(m.geometry.index.count / 3, 344);
  near(bb.min.x, -0.49969284); near(bb.max.x, 0.51285110);
  near(bb.min.y, -0.51979606); near(bb.max.y, 0.49874275);
  near(bb.min.z, 0.00175342); near(bb.max.z, 0.83772057);
  assert.equal(board.crateGeometry().uv, p.meshes.crate.uv);
  h.update(null, { x: 0, y: 0, z: 0, ...board.deviceSpec(DEVICE_BOX.crate) });
  near(m.scale.x, 1); near(m.scale.z, 1);
  board.destroy();
});
