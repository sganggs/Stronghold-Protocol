// test/render/board3d.test.js — the official 3D board scene (DESIGN §15, public/js/render/board3d): the atlas surface
// table, the OBJ reader, the geometry builder (heights agree with the Pixi layers, areas per phase, gates, devices,
// fences, terrain, sane buffers), the board-space conversion of the official meshes, the asset pack loader (fake
// store), and the three.js scene graph built with the real three package and a stub renderer (no WebGL in Node).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { SURFACES, SOURCES, surfaceUV, resolveUvTable, cleanSurface, sideRect, tintRgb } from '../../public/js/render/board3d/atlas.js';
import { parseObj, mapMesh } from '../../public/js/render/board3d/obj.js';
import {
  buildBoard, classifyStage, heightOf, AREAS, areaFor, unionAreas, objToBoard, boxProjectUV, tube, Geom, uvAt, ROWS, COLS,
  DEVICE_H, RAISED_FOOT,
} from '../../public/js/render/board3d/layout.js';
import { BoardScene, gatePulse, GATE_TINT, DIR_TURNS, boxData, LIGHTING } from '../../public/js/render/board3d/scene.js';
import { loadBoardPack, loadThree, resetBoardPack, PACK_IMAGES } from '../../public/js/render/board3d/load.js';
import { parseStage } from '../../public/js/render/tiles.js';
import { TILE_H } from '../../public/js/render/style.js';
import { presetCamera, syncThreeCamera } from '../../public/js/render/projection.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const stages = JSON.parse(readFileSync(path.join(ROOT, 'data/stages.json'), 'utf8'));
const ACTIVE = Object.values(stages).filter((s) => s.active).map((s) => s.id);
const LOCAL = path.join(ROOT, 'public/assets/local');
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

describe('atlas surfaces', () => {
  test('every surface is valid and inside its source; tiles.json overrides merge, junk is ignored', () => {
    for (const [k, v] of Object.entries(SURFACES)) {
      const c = cleanSurface(v);
      assert.ok(c, k);
      const S = SOURCES[c.src];
      assert.ok(c.rect[0] + c.rect[2] <= S.w && c.rect[1] + c.rect[3] <= S.h, k);
    }
    const t = resolveUvTable({ board3d: { concrete: { src: 'D', rect: [0, 0, 64, 64], rot: 90 }, bogus: { src: 'X', rect: [0, 0, 1, 1] }, hatch: { src: 'D', rect: [2040, 0, 64, 64] } } });
    assert.deepEqual(t.concrete.rect, [0, 0, 64, 64]);
    assert.equal(t.concrete.rot, 90);
    assert.equal(t.bogus, undefined);
    assert.deepEqual(t.hatch.rect, SURFACES.hatch.rect, 'out-of-bounds override rejected');
    assert.deepEqual(Object.keys(resolveUvTable(null)).sort(), Object.keys(SURFACES).sort());
  });

  test('surfaceUV: corner order BL, BR, TR, TL with the texture top on the far edge; rotation and flip permute', () => {
    const s = { src: 'D', rect: [256, 512, 256, 256] };
    const uv = surfaceUV(s, null, 0);
    // BL = (x0, bottom) → v = 1 − 768/2048; TL = (x0, top) → v = 1 − 512/2048
    assert.deepEqual(uv.map((x) => +x.toFixed(6)), [0.125, 0.625, 0.25, 0.625, 0.25, 0.75, 0.125, 0.75]);
    const r90 = surfaceUV({ ...s, rot: 90 }, null, 0);
    assert.deepEqual(r90.slice(0, 2), uv.slice(2, 4), 'rot 90: BL samples the texture BR');
    const f = surfaceUV({ ...s, flipX: true }, null, 0);
    assert.deepEqual(f.slice(0, 2), uv.slice(2, 4));
    const inset = surfaceUV(s, null, 2);
    assert.ok(inset[0] > uv[0] && inset[2] < uv[2], 'mip inset');
    // side panels keep their aspect: a 1 × 0.42 face uses the top 0.42·272/384 of the gold panel
    const sr = sideRect(SURFACES.goldSide, 1, 0.42);
    assert.ok(near(sr[3], 0.42 / (384 / 272), 1e-9));
    assert.deepEqual(sideRect(SURFACES.goldSide, 1, 5), [0, 0, 1, 1]);
    assert.deepEqual(tintRgb('#ff0000'), [1, 0, 0]);
    assert.deepEqual(tintRgb('nope'), [1, 1, 1]);
    assert.deepEqual(uvAt([0, 0, 1, 0, 1, 1, 0, 1], 0.25, 0.5), [0.25, 0.5]);
  });
});

describe('OBJ reader', () => {
  test('polygons fan into triangles; relative indices; groups; per-corner de-duplication', () => {
    const m = parseObj(['# quad', 'v 0 0 0', 'v 1 0 0', 'v 1 1 0', 'v 0 1 0', 'vt 0 0', 'vt 1 0', 'vt 1 1', 'vt 0 1', 'vn 0 0 1',
      'g a', 'f 1/1/1 2/2/1 3/3/1 4/4/1', 'g b', 'f -4/-4/-1 -2/-2/-1 -1/-1/-1'].join('\n'));
    assert.equal(m.index.length, 9);
    assert.equal(m.position.length / 3, 4, 'shared corners reused');
    assert.deepEqual(m.groups.map((g) => [g.name, g.count]), [['a', 6], ['b', 3]]);
    assert.deepEqual(m.bounds, { min: [0, 0, 0], max: [1, 1, 0] });
    assert.ok(m.normal && m.uv);
    assert.equal(parseObj(''), null);
    assert.equal(parseObj('v 1 2 3\nf 1 2 9'), null, 'bad indices dropped');
    const moved = mapMesh(m, (x, y, z) => [x + 1, y, z]);
    assert.equal(moved.position[0], 1);
  });

  test('vertex colours (v x y z r g b) are read', () => {
    const m = parseObj('v 0 0 0 1 0 0\nv 1 0 0 0 1 0\nv 0 1 0 0 0 1\nf 1 2 3');
    assert.deepEqual([...m.color], [1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  test('the extracted official meshes parse (when the local client was extracted)', { skip: !existsSync(path.join(LOCAL, 'mesh/s_common_box_01/pCube2.obj')) && 'not extracted' }, () => {
    const crate = parseObj(readFileSync(path.join(LOCAL, 'mesh/s_common_box_01/pCube2.obj'), 'utf8'));
    assert.deepEqual(crate.bounds.max.map(Math.round), [45, 68, 45]);
    const b = objToBoard(crate, 0.01);
    // Y-up Unity → board z-up: the crate stands 0.675 tall on the ground, 0.9 wide
    let z1 = -Infinity, z0 = Infinity;
    for (let i = 2; i < b.position.length; i += 3) { z1 = Math.max(z1, b.position[i]); z0 = Math.min(z0, b.position[i]); }
    assert.ok(near(z0, 0, 1e-6) && near(z1, 0.675, 1e-4), `${z0}..${z1}`);
    const blower = parseObj(readFileSync(path.join(LOCAL, 'mesh/s_wind_device/S_wild_wind_device.obj'), 'utf8'));
    assert.ok(blower.index.length > 100 && blower.uv);
    const gate = parseObj(readFileSync(path.join(LOCAL, 'map/fx/Start_up.obj'), 'utf8'));
    assert.deepEqual(gate.bounds.min.map(Math.round), [-50, -50, -50], 'the gate box is a 1-tile cube at scale 0.01');
  });
});

describe('board geometry (layout.js)', () => {
  test('heights agree with the Pixi tile field (units stand on the same tops) on every stage', () => {
    for (const st of Object.values(stages)) {
      const G = classifyStage(st, AREAS.all);
      const P = parseStage(st, [0, 18], [0, 18]);
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        const a = G[r][c], b = P[r][c];
        assert.equal(a.glyph, b.glyph, `${st.id} ${r},${c}`);
        if (a.drawn) assert.ok(near(a.h, b.h), `${st.id} ${r},${c} h ${a.h} vs ${b.h}`);
      }
      assert.equal(heightOf(G, -1, 3), 0);
    }
    assert.equal(classifyStage(stages.act2autochess_m01)[10][4].h, TILE_H.wall, 'high ground');
  });

  test('areas: the normal phase builds the own field + pen, 联防 both halves, the Final Assault the boss field', () => {
    const st = stages.act2autochess_m01;
    const drawnRows = (area) => { const G = classifyStage(st, area); const rows = new Set(); for (const row of G) for (const t of row) if (t.drawn) rows.add(t.r); return [...rows].sort((a, b) => a - b); };
    const n = drawnRows(AREAS.normal), b = drawnRows(AREAS.boss);
    assert.ok(n.includes(7) && n.includes(12) && n.includes(16) && !n.includes(3), `normal rows ${n}`);
    assert.ok(b.includes(0) && b.includes(5) && !b.includes(9), `boss rows ${b}`);
    const G = classifyStage(st, AREAS.normal);
    assert.ok(!G[9][14].drawn, 'the partner half is not built in the normal phase');
    assert.ok(classifyStage(st, AREAS.unite)[9][14].drawn, '联防 builds the partner half');
    assert.equal(areaFor('prep'), AREAS.normal);
    assert.equal(areaFor('pen'), AREAS.normal);
    assert.equal(areaFor('unite'), AREAS.unite);
    assert.equal(areaFor('hidden'), AREAS.boss);
    assert.equal(unionAreas(AREAS.normal, AREAS.normal, AREAS.boss).length, 3);
  });

  test('every active stage: finite buffers, unit normals, UVs inside the atlas, gates / fences / devices / terrain', () => {
    for (const id of ACTIVE) {
      const st = stages[id];
      for (const area of [AREAS.normal, AREAS.unite, AREAS.boss]) {
        const b = buildBoard(st, { area });
        for (const [name, g] of Object.entries(b.buckets)) {
          const n = g.position.length / 3;
          assert.equal(g.normal.length, n * 3, `${id} ${name}`);
          for (const v of g.position) assert.ok(Number.isFinite(v), `${id} ${name} position`);
          for (let i = 0; i < g.normal.length; i += 3) assert.ok(near(Math.hypot(g.normal[i], g.normal[i + 1], g.normal[i + 2]), 1, 1e-4), `${id} ${name} normal`);
          for (const u of g.uv) assert.ok(u >= 0 && u <= 1, `${id} ${name} uv ${u}`);
          for (const i of g.index) assert.ok(i < n, `${id} ${name} index`);
        }
        // top faces wind counter-clockwise seen from above (front faces for three.js)
        const g = b.buckets.board, P = g.position, I = g.index;
        let tops = 0;
        for (let t = 0; t < I.length; t += 3) {
          const [a, bb, c] = [I[t], I[t + 1], I[t + 2]];
          if (g.normal[a * 3 + 2] < 0.99) continue;
          const ux = P[bb * 3] - P[a * 3], uy = P[bb * 3 + 1] - P[a * 3 + 1], vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1];
          assert.ok(ux * vy - uy * vx > 0, `${id}: top triangle faces up`);
          tops++;
        }
        assert.ok(tops > 100, `${id} tops`);
        const G = b.grid;
        const expected = [];
        for (const row of G) for (const t of row) if (t.drawn && (t.glyph === 'S' || t.glyph === 'E')) expected.push(`${t.r},${t.c}`);
        assert.deepEqual(b.gates.map((x) => `${x.r},${x.c}`).sort(), expected.sort(), `${id} gates`);
        const fenced = G.flat().some((t) => t.drawn && t.glyph === 'b');
        assert.equal(b.buckets.pipe.vertexCount > 0, fenced, `${id} railings iff fenced tiles`);
        for (const d of b.devices) assert.ok(G[d.r][d.c].drawn, `${id} device on a built tile`);
        assert.ok(b.edges.length > 0, `${id} field edge glow`);
      }
    }
    // terrain lists
    assert.ok(buildBoard(stages.act2autochess_m04).terrain.water.length > 0);
    assert.ok(buildBoard(stages.act2autochess_m02).terrain.mire.length > 0);
    assert.ok(buildBoard(stages.act2autochess_m03).terrain.smog.length > 0);
    assert.ok(buildBoard(stages.act1autochess_m04).terrain.infection.length > 0);
    // blowers are active devices of act2 m01; inactive crates of act1 m02 are not built
    assert.ok(buildBoard(stages.act2autochess_m01).devices.some((d) => d.kind === 'blower' && d.dir === 'DOWN'));
    assert.ok(!buildBoard(stages.act1autochess_m02).devices.some((d) => d.kind === 'crate'));
  });

  test('#569: the device slabs (射击台 / 特制水上平台 / 封印的地面) are repeated for an official scene, their sides reaching under its ground; nothing else is', () => {
    const SLAB = new Set(['platform', 'waterPlatform', 'sealedFloor']);
    for (const [id, st] of Object.entries(stages)) {
      if (!Array.isArray(st?.rows)) continue;
      for (const area of [AREAS.normal, AREAS.boss]) {
        const b = buildBoard(st, { area });
        const slabs = b.devices.filter((d) => SLAB.has(d.kind));
        const decals = slabs.filter((d) => d.kind === 'sealedFloor').length;
        // per slab four sides, plus its top: a plate (raised) or the hazard decal of a sealed floor (raisedDecal)
        assert.equal(b.buckets.raised.vertexCount, (slabs.length * 5 - decals) * 4, `${id}: raised quads`);
        assert.equal(b.buckets.raisedDecal.vertexCount, decals * 4, `${id}: raised decal quads`);
        const P = b.buckets.raised.position;
        for (let i = 0; i < P.length; i += 3) {
          const d = slabs.find((x) => Math.abs(P[i] - x.c) <= 0.5 && Math.abs(P[i + 1] - x.r) <= 0.5);
          assert.ok(d, `${id}: every raised vertex is on a slab tile`);
          const h = b.grid[d.r][d.c].h;
          assert.ok(near(P[i + 2], h + DEVICE_H[d.kind]) || near(P[i + 2], h - RAISED_FOOT), `${id}: a slab top or its foot, z ${P[i + 2]}`);
        }
      }
    }
    // the report's 射击台 beside the blue gate (战场#03) and the water platforms (战场#05 上半) are there; the 'h' high
    // ground of act2 m01 / m02 is the scenes' own geometry and is not repeated
    assert.ok(buildBoard(stages.act1autochess_m03, { area: AREAS.normal }).buckets.raised.vertexCount > 0);
    assert.equal(buildBoard(stages.act1autochess_m05, { area: AREAS.normal }).devices.filter((d) => d.kind === 'waterPlatform').length, 16);
    for (const id of ['act2autochess_m01', 'act2autochess_m02']) assert.equal(buildBoard(stages[id], { area: AREAS.normal }).buckets.raised.vertexCount, 0, id);
  });

  test('round 40: with the official 射击台 model (platformMesh) the 射击台 get no slab on either board; water platforms and sealed floors keep theirs', () => {
    for (const [id, st] of Object.entries(stages)) {
      if (!Array.isArray(st?.rows)) continue;
      for (const area of [AREAS.normal, AREAS.boss]) {
        const slab = buildBoard(st, { area }), model = buildBoard(st, { area, platformMesh: true });
        const n = slab.devices.filter((d) => d.kind === 'platform').length;
        assert.deepEqual(model.devices, slab.devices, `${id}: the same devices`);
        // a platform slab = a top plate and four sides on each of the two boards
        assert.equal(slab.buckets.board.vertexCount - model.buckets.board.vertexCount, n * 5 * 4, `${id}: board quads`);
        assert.equal(slab.buckets.raised.vertexCount - model.buckets.raised.vertexCount, n * 5 * 4, `${id}: scene-board quads`);
        assert.equal(model.buckets.raisedDecal.vertexCount, slab.buckets.raisedDecal.vertexCount, `${id}: sealed floors stay`);
      }
    }
    assert.equal(buildBoard(stages.act1autochess_m03, { area: AREAS.normal, platformMesh: true }).buckets.raised.vertexCount, 0, '战场#03: only 射击台');
    const m05 = buildBoard(stages.act1autochess_m05, { area: AREAS.normal, platformMesh: true });
    assert.equal(m05.buckets.raised.vertexCount, buildBoard(stages.act1autochess_m05, { area: AREAS.normal }).buckets.raised.vertexCount, '战场#05: the water platforms stay');
    // units stand on the model's top (46.5 cm at the prefab scale 0.01) on every board
    assert.equal(TILE_H.platform, 0.465);
    assert.equal(DEVICE_H.platform, TILE_H.platform);
  });

  test('malformed stages never throw and still build an island', () => {
    for (const st of [null, {}, { rows: ['xyz'] }, { rows: Array(19).fill('r'.repeat(21)), devices: [{ role: 'crate', pos: [3, 3] }, { role: 'crate', pos: 'x' }] }]) {
      const b = buildBoard(st, { area: AREAS.all });
      assert.ok(b.buckets.board.index.length >= 0);
    }
  });

  test('objToBoard is a proper rotation (normals stay unit, outward); boxProjectUV maps tops and sides', () => {
    const box = { position: new Float32Array([0, 1, 0, 1, 1, 0, 1, 1, 1]), normal: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), index: new Uint16Array([0, 1, 2]) };
    const b = objToBoard(box, 1);
    assert.deepEqual([...b.normal.slice(0, 3)], [-0, 0, 1], 'Unity +Y is board +z');
    assert.deepEqual([...b.position.slice(3, 6)], [-1, 0, 1]);
    const crate = boxProjectUV({ ...boxData(0.9, 0.675), color: null }, SURFACES.crateTop, SURFACES.crateSide);
    const top = surfaceUV(SURFACES.crateTop), side = surfaceUV(SURFACES.crateSide);
    const inRange = (u, v, uv) => u >= Math.min(uv[0], uv[2], uv[4]) - 1e-6 && u <= Math.max(uv[0], uv[2], uv[4]) + 1e-6 && v >= Math.min(uv[1], uv[5]) - 1e-6 && v <= Math.max(uv[1], uv[5]) + 1e-6;
    for (let i = 0; i < crate.uv.length / 2; i++) {
      const up = crate.normal[i * 3 + 2] > 0.6;
      assert.ok(inRange(crate.uv[i * 2], crate.uv[i * 2 + 1], up ? top : side), `vertex ${i}`);
    }
    const g = tube(new Geom(), [0, 0, 0], [1, 0, 0], 0.05);
    assert.ok(g.vertexCount > 0 && g.triangleCount > 0);
  });
});

// ---- the three.js scene with a stub renderer ---------------------------------------------------------------------

function stubRenderer() {
  const calls = [];
  return {
    calls,
    domElement: { addEventListener() {}, removeEventListener() {} },
    shadowMap: { enabled: true, needsUpdate: false },
    capabilities: { getMaxAnisotropy: () => 8 },
    info: { render: { calls: 7, triangles: 1234 }, memory: { textures: 3, geometries: 5 } },
    setClearColor() {}, setPixelRatio(d) { calls.push(['dpr', d]); }, setSize(w, h) { calls.push(['size', w, h]); },
    render(scene, camera) { calls.push(['render', scene, camera]); },
    dispose() { calls.push(['dispose']); },
  };
}

function fakePack() {
  const img = { width: 4, height: 4 };
  const crate = existsSync(path.join(LOCAL, 'mesh/s_common_box_01/pCube2.obj')) ? parseObj(readFileSync(path.join(LOCAL, 'mesh/s_common_box_01/pCube2.obj'), 'utf8')) : null;
  const cube = parseObj(['v -50 -50 -50', 'v 50 -50 -50', 'v 50 50 -50', 'v -50 50 -50', 'vt 0 0', 'vt 1 0', 'vt 1 1', 'vt 0 1', 'vn 0 0 -1', 'f 1/1/1 2/2/1 3/3/1 4/4/1'].join('\n'));
  return {
    key: 'test', images: { D: img, N: img, R: img, E: img, common: img, gate: img, BG: img, wind: img },
    meshes: { box: crate, blower: cube, bgPlane: null, gate: { startDown: { mesh: cube }, startUp: { mesh: cube }, startBack: { mesh: cube }, endDown: { mesh: cube }, endUp: { mesh: cube } } },
    tiles: null, uv: resolveUvTable(null), materials: {},
  };
}

describe('BoardScene (three.js scene graph, stub renderer)', () => {
  test('builds merged meshes per material, few draw objects, shadows once; areas rebuild', () => {
    const R = stubRenderer();
    const board = new BoardScene(THREE, fakePack(), { renderer: R });
    board.setStage(stages.act2autochess_m01);
    const meshes = board.root.children;
    assert.ok(meshes.length >= 5 && meshes.length <= 16, `draw objects ${meshes.length}`);
    for (const m of meshes) assert.ok(m.geometry.getAttribute('position').count > 0);
    assert.ok(board.meshes.board && board.meshes.gateStart && board.meshes.gateEndAb && board.meshes.blowers && board.meshes.bg, Object.keys(board.meshes).join());
    assert.equal(R.shadowMap.needsUpdate, true);
    const before = board.meshes.board.geometry.getAttribute('position').count;
    assert.equal(board.setArea(AREAS.boss), true);
    assert.notEqual(board.meshes.board.geometry.getAttribute('position').count, before);
    assert.equal(board.setArea(AREAS.boss), false, 'same area: no rebuild');
    board.destroy();
    assert.ok(R.calls.some((c) => c[0] === 'dispose'));
  });

  test('battle rect hides the static crates inside it (the sim spawns them); device handles follow DeviceView', () => {
    const board = new BoardScene(THREE, fakePack(), { renderer: stubRenderer() });
    board.setStage(stages.act1autochess_m01);
    const crates = () => board.meshes.crates ? board.meshes.crates.geometry.getAttribute('position').count : 0;
    const all = crates();
    assert.ok(all > 0);
    board.setBattleRect({ r0: 9, r1: 12, c0: 0, c1: 10 });
    assert.ok(crates() < all, 'field crates hidden in battle');
    board.setBattleRect(null);
    assert.equal(crates(), all);
    const h = board.createDevice();
    assert.equal(h.mesh, null, 'DeviceView adds nothing to Pixi');
    h.update(null, { x: 5, y: 10, z: 0, size: 0.45, height: 0.3, alpha: 0.5 });
    const m = [...board.dynamic.children].at(-1);
    assert.ok(near(m.position.x, 5) && near(m.scale.x, 0.5, 0.02) && m.material.opacity === 0.5);
    h.destroy();
    assert.equal(board.devices.size, 0);
    board.destroy();
  });

  test('render syncs the three camera from the projection camera (identical pixels) and animates the gates', () => {
    const R = stubRenderer();
    const board = new BoardScene(THREE, fakePack(), { renderer: R });
    board.setStage(stages.act2autochess_m03);
    board.resize(1280, 720, 2);
    const cam = presetCamera('normal', { width: 1280, height: 720 });
    assert.equal(board.render(cam, 1.25), true);
    const ref = syncThreeCamera(cam, new THREE.PerspectiveCamera(), 1280, 720);
    board.camera.updateMatrixWorld(true);
    for (const [x, y, z] of [[2, 9, 0], [10, 12, 0.42], [6, 10.5, 0]]) {
      const a = new THREE.Vector3(x, y, z).project(board.camera), b = new THREE.Vector3(x, y, z).project(ref);
      assert.ok(near(a.x, b.x, 1e-9) && near(a.y, b.y, 1e-9));
    }
    const p0 = board.mat.gateStartAdd.uniforms.uAlpha.value;
    board.render(cam, 2.25);
    assert.notEqual(board.mat.gateStartAdd.uniforms.uAlpha.value, p0, 'gate pulse animates');
    board.flashObjective(9, 2);
    board.render(cam, 2.4);
    assert.ok(board.mat.gateEndAb.uniforms.uFlash.value.r > 0.5, 'leak flash');
    board.setFocus({ r0: 9, r1: 12, c0: 0, c1: 10 });
    for (let i = 0; i < 60; i++) board.render(cam, 2.4 + i / 30);
    const F = board.focus.uFocus.value;
    assert.ok(near(F.x, -0.5, 0.05) && near(F.w, 12.5, 0.05), 'focus eases to the field rect');
    assert.equal(R.calls.filter((c) => c[0] === 'render').length, 63);
    assert.deepEqual(board.stats().calls, 7);
    board.lost = true;
    assert.equal(board.render(cam, 5), false, 'lost context: no draw');
    board.destroy();
  });

  test('gate pulse follows the official 2 s curve; device outlets turn with their dir', () => {
    let lo = Infinity, hi = -Infinity;
    for (let t = 0; t < 2; t += 0.01) { const v = gatePulse(t); lo = Math.min(lo, v); hi = Math.max(hi, v); }
    assert.ok(near(lo, 0.134, 1e-3) && near(hi, 0.229, 1e-3));
    assert.ok(near(gatePulse(0.3), gatePulse(2.3), 1e-9), 'periodic');
    // the objective's curve falls while the start's rises (the client's clip: 0.16 → 0.097 → 0.16)
    assert.ok(near(gatePulse(0, GATE_TINT.end.alpha), 0.16, 1e-9) && near(gatePulse(1, GATE_TINT.end.alpha), 0.097, 1e-9));
    assert.deepEqual(GATE_TINT.start.rgb, [1, 0, 0], 'the start gate is tinted red, not white');
    // the clip's cubic keys (flat ends): 0.134 + 0.095 · smoothstep(0.25) at 0.25 s, mirrored on the way back
    assert.ok(near(gatePulse(0.25), 0.134 + 0.095 * 0.15625, 1e-9) && near(gatePulse(1.75), gatePulse(0.25), 1e-9));
    assert.deepEqual(new Set(Object.values(DIR_TURNS)), new Set([0, 1, 2, 3]));
    assert.ok(LIGHTING.key.intensity > 0 && LIGHTING.bg.z < 0);
  });
});

describe('asset pack loader (fake store)', () => {
  test('resetBoardPack lets a later three.js import try again after three failures', async () => {
    resetBoardPack();
    const missing = new URL('./no-such-three.mjs', import.meta.url).href;
    for (let i = 0; i < 3; i++) assert.equal(await loadThree(missing), null);
    assert.equal(await loadThree(missing), null, 'three failures stop further imports');
    resetBoardPack();
    const mod = await loadThree(new URL('./fake-three.mjs', import.meta.url).href);
    assert.equal(typeof mod?.WebGLRenderer, 'function');
    resetBoardPack();
  });
  test('a transient diffuse-image failure is retried by the next mount instead of cached as permanent 2D', async () => {
    resetBoardPack();
    let calls = 0;
    const store = { local: async () => ({ groups: {} }), localUrl: (g, n) => n === 'TX_autochessi_D' ? '/test/atlas.png' : null,
      image: async () => ++calls === 1 ? null : { width: 8, height: 8 } };
    const original = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: false });
    try {
      assert.equal(await loadBoardPack(store), null);
      const pack = await loadBoardPack(store);
      assert.ok(pack?.images.D); assert.equal(calls, 2);
      assert.equal(await loadBoardPack(store), pack, 'successful pack remains shared');
    } finally { globalThis.fetch = original; resetBoardPack(); }
  });
  test('loads images through the store and meshes through fetch; null without the diffuse atlas', async () => {
    resetBoardPack();
    const manifest = { groups: {} };
    for (const [slot, [g, n]] of Object.entries(PACK_IMAGES)) (manifest.groups[g] ||= {})[n] = { path: `/assets/local/${g}/${n}.png` };
    manifest.groups['mesh/s_common_box_01'] = { pCube2: { path: '/assets/local/mesh/s_common_box_01/pCube2.obj' } };
    manifest.groups['mesh/trap_110'].trap_1105_accrate = { path: '/assets/local/mesh/trap_110/trap_1105_accrate.obj' };
    manifest.groups['map/fx'] = { ...manifest.groups['map/fx'], Start_up: { path: '/assets/local/map/fx/Start_up.obj' }, prefab: { path: '/assets/local/map/fx/prefab.json' } };
    const requested = [];
    const store = {
      local: async () => manifest,
      localUrl: (g, n) => manifest.groups[g]?.[n]?.path || null,
      image: async (u) => { requested.push(u); return { width: 8, height: 8 }; },
    };
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (u) => {
      const s = String(u);
      if (s.endsWith('.obj')) return { ok: true, text: async () => 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3' };
      if (s.endsWith('prefab.json')) return { ok: true, json: async () => [{ name: 'Start_up', parent: 'Start', mesh: 'Start_up', materials: ['[opt]start_end_add'] }] };
      return { ok: false, json: async () => null, text: async () => '' };
    };
    try {
      const pack = await loadBoardPack(store);
      assert.ok(pack && pack.images.D && pack.images.gate, 'images');
      assert.ok(requested.some((u) => u.includes('%5Bopt%5Dmerged_textures')), 'bracketed names are URL-encoded');
      assert.ok(pack.meshes.crate && pack.meshes.box && pack.meshes.gate.startUp, 'client model and fallback loaded separately');
      assert.ok(pack.images.crate, 'client crate texture loaded');
      assert.equal(pack.meshes.gate.startUp.material, '[opt]start_end_add');
      assert.ok(pack.uv.concrete);
      resetBoardPack();
      delete manifest.groups['mesh/trap_110'].trap_1105_accrate;
      delete manifest.groups['mesh/trap_110'].TX_trap_1105_accrate;
      const legacy = await loadBoardPack(store);
      assert.ok(legacy.meshes.box && !legacy.meshes.crate && !legacy.images.crate, 'old extraction keeps the box');
      resetBoardPack();
      delete manifest.groups['map/autochess'].TX_autochessi_D;
      assert.equal(await loadBoardPack(store), null, 'no diffuse atlas → no 3D board');
      resetBoardPack();
      assert.equal(await loadBoardPack(null), null);
    } finally {
      globalThis.fetch = realFetch;
      resetBoardPack();
    }
  });
});
