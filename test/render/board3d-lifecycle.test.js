// test/render/board3d-lifecycle.test.js — lifecycle and framing regressions of the official 3D board (DESIGN §15,
// public/js/render/board3d + render/app.js glue), found in the board3d review:
//   * battle device meshes (render/units.js DeviceView crates) survive the area / stage rebuilds that a camera
//     flight triggers mid-battle (prep → Final Assault rebuilt the scene and dropped every crate);
//   * GPU resources: every BufferGeometry the scene creates is disposed again on rebuilds and on destroy;
//   * the background plane covers every official / fitted framing (no visible edge at 21:9, 4:3, portrait);
//   * a 'prep' camera on the boss rows (Final Assault prep) builds / draws / lights the boss field (viewKind);
//   * device boxes follow the board layer (3D ⇄ 2D switch mid-battle: lost context) — switchableBox;
//   * fitted (portrait) Final Assault prep camera frames the right half for the right-hand player;
//   * three.js is only fetched when the local-art manifest lists the board atlas (boardArtListed).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { BoardScene, extendPlane, LIGHTING } from '../../public/js/render/board3d/scene.js';
import { AREAS, unionAreas, areaFor } from '../../public/js/render/board3d/layout.js';
import { resolveUvTable } from '../../public/js/render/board3d/atlas.js';
import { parseObj } from '../../public/js/render/board3d/obj.js';
import { boardArtListed } from '../../public/js/render/board3d/load.js';
import { presetCamera } from '../../public/js/render/projection.js';
import { viewKind, switchableBox } from '../../public/js/render/app.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const stages = JSON.parse(readFileSync(path.join(ROOT, 'data/stages.json'), 'utf8'));

function stubRenderer() {
  return {
    domElement: { addEventListener() {}, removeEventListener() {} },
    shadowMap: { enabled: true, needsUpdate: false },
    capabilities: { getMaxAnisotropy: () => 8 },
    info: { render: { calls: 7, triangles: 1234 }, memory: { textures: 3, geometries: 5 } },
    setClearColor() {}, setPixelRatio() {}, setSize() {}, render() {}, dispose() {},
  };
}

// the official background plane as exported by tools/local-extract (mesh/s_background_common/pPlane1.obj)
const PLANE_OBJ = ['g pPlane1', 'v -50 0 50', 'v -50 0 -50', 'v 50 0 -50', 'v 50 0 50', 'vt 0 0', 'vt 0 1', 'vt 1 1', 'vt 1 0',
  'vn -0 1 0', 'vn -0 1 0', 'vn -0 1 0', 'vn -0 1 0', 'g pPlane1_0', 'f 3/3/3 2/2/2 1/1/1', 'f 4/4/4 3/3/3 1/1/1'].join('\n');

function fakePack() {
  const img = { width: 4, height: 4 };
  const cube = parseObj(['v -50 -50 -50', 'v 50 -50 -50', 'v 50 50 -50', 'v -50 50 -50', 'vt 0 0', 'vt 1 0', 'vt 1 1', 'vt 0 1', 'vn 0 0 -1', 'f 1/1/1 2/2/1 3/3/1 4/4/1'].join('\n'));
  return {
    key: 'test', images: { D: img, N: img, R: img, E: img, common: img, gate: img, BG: img, wind: img },
    meshes: { crate: null, blower: cube, bgPlane: parseObj(PLANE_OBJ), gate: { startDown: { mesh: cube }, startUp: { mesh: cube }, startBack: { mesh: cube }, endDown: { mesh: cube }, endUp: { mesh: cube } } },
    tiles: null, uv: resolveUvTable(null), materials: {},
  };
}

const inScene = (board, obj) => { let found = false; board.scene.traverse((o) => { if (o === obj) found = true; }); return found; };

describe('BoardScene lifecycle', () => {
  test('battle device meshes survive the area / stage rebuilds of a camera flight (prep → Final Assault)', () => {
    const board = new BoardScene(THREE, fakePack(), { renderer: stubRenderer() });
    board.setStage(stages.act1autochess_m01);
    board.setBattleRect({ r0: 0, r1: 5, c0: 0, c1: 20 });
    const h = board.createDevice();
    h.update(null, { x: 5, y: 4, z: 0, size: 0.9, height: 0.675, alpha: 1 });
    const mesh = board.dynamic.children.at(-1);
    let disposed = 0;
    mesh.geometry.addEventListener('dispose', () => { disposed++; });
    // the flight: union of both areas, then the boss field only; a stage swap for good measure
    assert.equal(board.setArea(unionAreas(areaFor('prep'), areaFor('boss'))), true);
    assert.equal(board.setArea(AREAS.boss), true);
    board.setStage(stages.act2autochess_m03);
    assert.ok(inScene(board, mesh), 'device mesh still in the scene');
    assert.equal(disposed, 0, 'device geometry not disposed by the rebuilds');
    assert.equal(board.devices.size, 1);
    h.update(null, { x: 6, y: 3, z: 0, size: 0.9, height: 0.675, alpha: 1 });
    assert.equal(mesh.position.x, 6, 'the handle still drives its mesh');
    h.destroy();
    h.destroy(); // idempotent (DeviceView + the board teardown may both destroy it)
    assert.equal(disposed, 1);
    assert.ok(!inScene(board, mesh));
    assert.equal(h.destroyed, true);
    board.destroy();
  });

  test('every BufferGeometry created is disposed again (stage / area rebuilds, crates, devices, destroy)', () => {
    const live = new Set();
    class CountingGeometry extends THREE.BufferGeometry {
      constructor() { super(); live.add(this); this.addEventListener('dispose', () => live.delete(this)); }
    }
    const T = { ...THREE, BufferGeometry: CountingGeometry };
    const board = new BoardScene(T, fakePack(), { renderer: stubRenderer() });
    const meshCount = () => { let n = 0; board.scene.traverse((o) => { if (o.isMesh) n++; }); return n; };
    const devices = [];
    for (const id of ['act2autochess_m01', 'act1autochess_m01', 'act2autochess_m04', 'act1autochess_m03', 'act2autochess_m01']) {
      board.setStage(stages[id]);
      for (const area of [AREAS.boss, AREAS.unite, AREAS.normal]) board.setArea(area);
      board.setBattleRect({ r0: 9, r1: 12, c0: 0, c1: 10 });
      board.setBattleRect(null);
      devices.push(board.createDevice());
      if (devices.length > 2) devices.shift().destroy();
      assert.equal(live.size, meshCount(), `${id}: live geometries = meshes in the scene`);
    }
    assert.ok(live.size < 40, `bounded (${live.size})`);
    board.destroy();
    assert.equal(live.size, 0, 'destroy frees everything');
  });

  test('the background plane covers every framing (official 16:9 / 21:9 / 4:3 and fitted portrait); clear = fog colour', () => {
    const board = new BoardScene(THREE, fakePack(), { renderer: stubRenderer() });
    board.setStage(stages.act2autochess_m04);
    const g = board.meshes.bg.geometry;
    g.computeBoundingBox();
    const bb = g.boundingBox;
    const B = LIGHTING.bg;
    assert.ok(bb.max.x - bb.min.x >= B.size * B.tiles - 1e-3 && bb.max.y - bb.min.y >= B.size * B.tiles - 1e-3, 'extended plane');
    assert.ok(Math.abs(bb.max.z - B.z) < 1e-6 && Math.abs(bb.min.z - B.z) < 1e-6, 'flat at the official depth');
    const uv = g.getAttribute('uv').array;
    assert.ok(Math.min(...uv) <= -0.99 && Math.max(...uv) >= 1.99, 'texel density kept: UVs span the mirrored copies');
    assert.equal(board.tex.BG.wrapS, THREE.MirroredRepeatWrapping);
    assert.equal(board.tex.BG.wrapT, THREE.MirroredRepeatWrapping);
    assert.equal(LIGHTING.clear, LIGHTING.fog.color, 'the void beyond the fogged plane has the fog colour');
    // every screen corner of every preset hits the plane, or lies beyond the fog (fully fogged → no edge)
    const cx = (bb.min.x + bb.max.x) / 2, cy = (bb.min.y + bb.max.y) / 2, half = (bb.max.x - bb.min.x) / 2;
    const bad = [];
    for (const [W, H] of [[1920, 1080], [2560, 1080], [3440, 1440], [1024, 768], [900, 1600], [800, 800], [390, 844], [1280, 720]]) {
      for (const [kind, o] of [['prep', {}], ['prep', { shop: false }], ['normal', {}], ['unite', {}], ['unite', { half: true, side: 'R' }],
        ['boss', {}], ['boss', { half: true, side: 'L' }], ['bossPrep', { side: 'R' }], ['bossPrep', {}], ['pen', {}]]) {
        const cam = presetCamera(kind, { width: W, height: H }, o);
        const P = cam.position();
        for (const [sx, sy] of [[0, 0], [W, 0], [0, H], [W, H], [W / 2, 0]]) {
          const p = cam.unproject(sx, sy, B.z);
          const inside = !!p && Math.abs(p.x - cx) <= half && Math.abs(p.y - cy) <= half;
          const far = !!p && Math.hypot(p.x - P.x, p.y - P.y, B.z - P.z) >= LIGHTING.fog.far;
          if (!inside && !far) bad.push(`${W}×${H} ${kind} ${JSON.stringify(o)} (${sx},${sy})`);
        }
      }
    }
    assert.deepEqual(bad, []);
    board.destroy();
  });

  test('settings quality: low drops the key-light shadow, back to high restores it (shadow map re-rendered)', () => {
    const R = stubRenderer();
    const board = new BoardScene(THREE, fakePack(), { renderer: R });
    board.setStage(stages.act2autochess_m01);
    R.shadowMap.needsUpdate = false;
    assert.equal(board.setQuality('low'), true);
    assert.equal(R.shadowMap.enabled, false);
    assert.equal(board.key.castShadow, false);
    assert.equal(board.setQuality('low'), false, 'no-op');
    assert.equal(board.setQuality('high'), true);
    assert.equal(R.shadowMap.enabled, true);
    assert.equal(board.key.castShadow, true);
    assert.equal(R.shadowMap.needsUpdate, true);
    board.destroy();
  });

  test('extendPlane grows a plane about its centre with UVs scaled about the texture centre', () => {
    const src = { position: new Float32Array([0, 0, -8, 2, 0, -8, 2, 2, -8]), uv: new Float32Array([0, 0, 1, 0, 1, 1]), index: new Uint16Array([0, 1, 2]) };
    const out = extendPlane(src, 1, 1, 3);
    assert.deepEqual([...out.position], [-2, -2, -8, 4, -2, -8, 4, 4, -8]);
    assert.deepEqual([...out.uv], [-1, -1, 2, -1, 2, 2]);
    assert.equal(extendPlane(src, 1, 1, 1), src, 'k ≤ 1: unchanged');
  });
});

describe('render/app.js glue', () => {
  test('viewKind: the field a camera request shows (Final Assault prep = the boss field)', () => {
    assert.equal(viewKind('prep', { rect: { r0: 9, r1: 12, c0: 0, c1: 10 } }), 'prep');
    assert.equal(viewKind('prep', { rect: { r0: 0, r1: 5, c0: 0, c1: 10 }, side: 'L' }), 'bossPrep');
    assert.equal(viewKind('prep', { rect: { r0: 0, r1: 5, c0: 10, c1: 20 }, side: 'R' }), 'bossPrep');
    assert.equal(viewKind('prep', {}), 'prep');
    assert.equal(viewKind('hidden', {}), 'boss');
    assert.equal(viewKind('pen'), 'pen');
    assert.equal(viewKind('bogus', null), 'normal');
    // the built 3D area follows (the boss field, not the normal field + pen)
    assert.equal(areaFor(viewKind('prep', { rect: { r0: 0, r1: 5, c0: 0, c1: 10 } })), AREAS.boss);
    assert.equal(areaFor(viewKind('prep', { rect: { r0: 9, r1: 12, c0: 0, c1: 10 } })), AREAS.normal);
  });

  test('switchableBox: device boxes follow the board layer (3D scene ⇄ 2D Pixi box), never a dead scene', () => {
    const board = new BoardScene(THREE, fakePack(), { renderer: stubRenderer() });
    board.setStage(stages.act1autochess_m01);
    let current = board;
    const pixiBoxes = [];
    const pixi = () => { const b = { mesh: { parent: null }, destroyed: false, updates: 0, update() { this.updates++; }, destroy() { this.destroyed = true; } }; pixiBoxes.push(b); return b; };
    const box = switchableBox({ board: () => current, pixi });
    const B = { x: 5, y: 10, z: 0, size: 0.9, height: 0.675, alpha: 1 };
    assert.equal(box.mesh, null, 'nothing before the first update');
    box.update(null, B);
    assert.equal(box.mesh, null, '3D: no Pixi mesh');
    assert.equal(board.devices.size, 1);
    // the WebGL context is lost: the scene is destroyed and the view falls back to the 2D board
    board.destroy();
    current = null;
    box.update(null, B);
    assert.equal(pixiBoxes.length, 1);
    assert.equal(box.mesh, pixiBoxes[0].mesh, '2D: the Pixi box mesh (DeviceView parents it)');
    assert.equal(pixiBoxes[0].updates, 1);
    // back to 3D (setBoardMode('3d')): the Pixi box goes, a device of the new scene takes over
    const board2 = new BoardScene(THREE, fakePack(), { renderer: stubRenderer() });
    board2.setStage(stages.act1autochess_m01);
    current = board2;
    box.update(null, B);
    assert.equal(pixiBoxes[0].destroyed, true);
    assert.equal(board2.devices.size, 1);
    box.destroy();
    assert.equal(board2.devices.size, 0);
    box.destroy();
    board2.destroy();
  });

  test('fitted Final Assault prep camera (portrait) frames the right half for the right-hand player', () => {
    const vp = { width: 900, height: 1600 };
    const L = presetCamera('bossPrep', vp, { side: 'L' }), R = presetCamera('bossPrep', vp, { side: 'R' });
    assert.ok(L.tx < 10 && R.tx > 10, `L ${L.tx} R ${R.tx}`);
    assert.ok(Math.abs(L.tx + R.tx - 20) < 1e-6, 'mirrored about col 10');
    // landscape keeps the official left / right boss prepare params
    const oL = presetCamera('bossPrep', { width: 1920, height: 1080 }, { side: 'L' }), oR = presetCamera('bossPrep', { width: 1920, height: 1080 }, { side: 'R' });
    assert.ok(oL.tx < 10 && oR.tx > 10);
  });
});

describe('asset pack gate', () => {
  test('boardArtListed: three.js is fetched only when the manifest lists the board atlas', async () => {
    const store = (groups, fail = false) => ({
      local: async () => { if (fail) throw new Error('offline'); return { groups }; },
      localUrl: (g, n) => groups?.[g]?.[n]?.path || null,
    });
    assert.equal(await boardArtListed(store({ 'map/autochess': { TX_autochessi_D: { path: '/assets/local/map/autochess/TX_autochessi_D.png' } } })), true);
    assert.equal(await boardArtListed(store({ 'map/autochess': {} })), false);
    assert.equal(await boardArtListed(store(null)), false);
    assert.equal(await boardArtListed(store({}, true)), false);
    assert.equal(await boardArtListed(null), false);
    assert.equal(await boardArtListed({ local: 1 }), false);
  });
});

test('cannon device upgrades when its scene art arrives late and drops a replaced native model', () => {
  let model = null,
    created = 0,
    dropped = 0;
  const scene = {
    cannonModel: () => model,
    createDevice: () => ({
      cannonModel: model,
      native: !!model,
      update() {},
      destroy() {
        dropped++;
      },
    }),
  };
  const box = switchableBox({ board: () => scene, spec: { cannon: true }, pixi: () => null });
  const create = scene.createDevice;
  scene.createDevice = () => {
    created++;
    return create();
  };
  box.update(null, {});
  assert.equal(box.native, false);
  model = { pack: 'loaded' };
  box.update(null, {});
  assert.equal(box.native, true);
  assert.equal(dropped, 1);
  box.update(null, {});
  assert.equal(created, 2, 'stable source reuses its handle');
  model = { pack: 'updated' };
  box.update(null, {});
  assert.equal(dropped, 2);
  assert.equal(created, 3);
  box.destroy();
  assert.equal(dropped, 3);
});
