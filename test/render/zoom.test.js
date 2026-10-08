// test/render/zoom.test.js — the player's own map view: zoom and pan (render/projection.js zoomCamera / panCamera /
// zoomedPan / clampZoom / clampZoomFor / clampPan, render/app.js). The whole battlefield is drawn and hit-tested through
// ONE camera, so the view is a transform of that camera and every layer (3D board, tiles, units, FX, particles, HUD,
// highlights) follows it. What is pinned down here:
//   * zoomCamera scales the focal length and moves the principal point so that the world point under the anchor stays
//     exactly under it (screen' = A + f·(screen − A)) — at any anchor, at any zoom, in every direction;
//   * panCamera translates the whole image by (dx, dy) and nothing else — the same camera, moved;
//   * the two compose as the app writes them: a pan plus a zoom about the viewport's centre K, i.e.
//     screen' = K + pan + zoom·(screen − K); `zoomedPan` is the pan a zoom at a pointer leaves so that the world point
//     under it stays under it — after any earlier pan, too — which is what keeps picking under the pointer exact;
//   * clampZoom / clampZoomFor hold the factor inside ZOOM_MIN…ZOOM_MAX and this camera's readable px per tile;
//     clampPan holds the player's offset within PAN_LIMIT_FRAC of the viewport (the board cannot be lost);
//   * the pitch, the camera position and the tilt never change — a perspective zoom and a 2D pan, not a dolly;
//   * picking stays exact: a tile's centre projects to a pixel that picks that same tile back at every zoom and pan
//     (the deployment / drag / hover path runs through pickTile → Camera.unproject);
//   * the three.js camera the 3D board uses is rebuilt from the view camera and still matches the 2D projection
//     (render/projection.js syncThreeCamera) — the 3D board cannot lag half a zoom behind the 2D layers.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  Camera, presetCamera, zoomCamera, panCamera, zoomedPan, clampPan, clampZoom, clampZoomFor,
  ZOOM_MIN, ZOOM_MAX, ZOOM_MIN_TILE_PX, ZOOM_MAX_TILE_PX, PAN_LIMIT_FRAC,
  pickTile, tileQuad, threeCameraParams, syncThreeCamera,
} from '../../public/js/render/projection.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const VIEW = { width: 1600, height: 900 };
const level = () => 0;
const K = { x: VIEW.width / 2, y: VIEW.height / 2 };
/** A battle camera (the official framing) and a prep one, the two the game zooms most. */
const battle = () => presetCamera('normal', VIEW);
const prep = () => presetCamera('prep', VIEW, { hud: { top: 90, bottom: 120 } });
/**
 * The app's view transform (render/app.js refreshCam / viewZoom): the camera a preset produced, zoomed about the
 * viewport's centre and panned — `screen' = K + pan + zoom·(screen − K)`.
 */
function view(base, zoom, panX = 0, panY = 0, K0 = K) {
  const z = zoomCamera(base, zoom, K0.x, K0.y);
  return (panX || panY) ? panCamera(z, panX, panY, z) : z;
}

describe('zoomCamera', () => {
  test('scales the focal length by the factor, keeps position / pitch / dist', () => {
    const cam = battle();
    for (const f of [0.5, 0.8, 1, 1.5, 3]) {
      const z = zoomCamera(cam, f, 400, 300);
      assert.ok(near(z.scale, cam.scale * f), `scale ${z.scale} vs ${cam.scale * f}`);
      assert.ok(near(z.focal(), z.scale * z.dist), 'the focal length follows the scale');
      assert.equal(z.tx, cam.tx); assert.equal(z.ty, cam.ty); assert.equal(z.tz, cam.tz);
      assert.equal(z.tilt, cam.tilt); assert.equal(z.dist, cam.dist);
      const a = cam.position(), b = z.position();
      assert.ok(near(a.x, b.x) && near(a.y, b.y) && near(a.z, b.z), 'the camera itself does not move (a zoom, not a dolly)');
    }
  });

  test('the world point under the anchor stays exactly under it (any anchor, any factor)', () => {
    for (const cam of [battle(), prep()]) {
      for (const [ax, ay] of [[800, 450], [200, 120], [1450, 830], [640, 60]]) {
        const before = cam.unproject(ax, ay, 0);
        for (const f of [0.55, 1.2, 2.4, 3]) {
          const z = zoomCamera(cam, f, ax, ay);
          const after = z.unproject(ax, ay, 0);
          assert.ok(before && after, `the anchor ${ax},${ay} is on the ground plane`);
          assert.ok(near(before.x, after.x, 1e-9) && near(before.y, after.y, 1e-9),
            `x${f} about ${ax},${ay}: anchor world (${before.x.toFixed(4)}, ${before.y.toFixed(4)}) -> (${after.x.toFixed(4)}, ${after.y.toFixed(4)})`);
        }
      }
    }
  });

  test('an off-centre anchor really is the fixed point: other points move away from it', () => {
    const cam = battle();
    const ax = 300, ay = 200;
    const z = zoomCamera(cam, 2, ax, ay);
    const p0 = cam.project(8, 10, 0);
    const p1 = z.project(8, 10, 0);
    // the anchor's own screen point does not move; a point to its right ends twice as far right of it
    assert.ok(near(p1.x - ax, (p0.x - ax) * 2, 1e-6), `x: ${p1.x - ax} vs ${(p0.x - ax) * 2}`);
    assert.ok(near(p1.y - ay, (p0.y - ay) * 2, 1e-6), `y: ${p1.y - ay} vs ${(p0.y - ay) * 2}`);
    // ... and zooming out mirrors it about the same point
    const out = zoomCamera(cam, 0.5, ax, ay);
    const p2 = out.project(8, 10, 0);
    assert.ok(near(p2.x - ax, (p0.x - ax) * 0.5, 1e-6));
  });

  test('a factor of 1 is the camera it came from; `out` may be a reused camera', () => {
    const cam = battle();
    const z = zoomCamera(cam, 1, 500, 400);
    for (const k of ['tx', 'ty', 'tz', 'tilt', 'dist', 'scale', 'cx', 'cy']) assert.equal(z[k], cam[k], k);
    const reuse = new Camera();
    const a = zoomCamera(cam, 1.4, 100, 100, reuse);
    assert.equal(a, reuse);
    assert.ok(near(reuse.scale, cam.scale * 1.4));
    zoomCamera(cam, 0.7, 900, 500, reuse);
    assert.ok(near(reuse.scale, cam.scale * 0.7), 'the reused camera is fully rewritten');
    assert.ok(near(reuse.cx, 900 + (cam.cx - 900) * 0.7));
  });

  test('degenerate input is safe (no NaN, no mirroring)', () => {
    const cam = battle();
    for (const f of [NaN, Infinity, 0, -2, undefined]) {
      const z = zoomCamera(cam, f, 400, 300);
      assert.ok(Number.isFinite(z.scale) && z.scale > 0, `factor ${f} -> scale ${z.scale}`);
      assert.ok(Number.isFinite(z.cx) && Number.isFinite(z.cy));
    }
    const z = zoomCamera(cam, 1.2, NaN, NaN);
    assert.ok(Number.isFinite(z.cx) && Number.isFinite(z.cy), 'a bad anchor falls back to the principal point');
    assert.equal(z.cx, cam.cx, 'and the transform then scales about that point (which does not move)');
    assert.equal(z.cy, cam.cy);
  });

  test('clampZoom holds the app\'s limits; clampZoomFor also keeps the tile readable', () => {
    assert.equal(clampZoom(1), 1);
    assert.equal(clampZoom(0.01), ZOOM_MIN);
    assert.equal(clampZoom(99), ZOOM_MAX);
    assert.equal(clampZoom(NaN), 1);
    assert.equal(clampZoom(undefined), 1);
    assert.ok(ZOOM_MIN < 1 && ZOOM_MAX > 1, 'both directions are possible');
    for (const base of [battle(), prep()]) {
      const px = (f) => base.scale * clampZoomFor(base, f);       // px per tile at the target after clamping
      assert.equal(clampZoomFor(base, 1), 1, 'no zoom is always allowed');
      assert.ok(px(0.01) >= ZOOM_MIN_TILE_PX - 1e-9, `widest ${px(0.01).toFixed(1)} px per tile`);
      assert.ok(px(99) <= ZOOM_MAX_TILE_PX + 1e-9, `closest ${px(99).toFixed(1)} px per tile`);
      assert.ok(px(99) > px(0.01) * 1.4, 'both ends are far enough apart to matter');
      assert.equal(clampZoomFor(base, NaN), 1);
    }
    // the official framings differ a lot (the pen is ~156 px per tile, a wide unite field ~89): the closer camera may
    // zoom in less far — that is the point of the camera-aware cap
    const pen = presetCamera('pen', VIEW), unite = presetCamera('unite', VIEW);
    assert.ok(clampZoomFor(pen, 99) < clampZoomFor(unite, 99), `pen ${clampZoomFor(pen, 99).toFixed(2)} < unite ${clampZoomFor(unite, 99).toFixed(2)}`);
    assert.ok(clampZoomFor(unite, 99) <= ZOOM_MAX, 'never past the absolute factor ceiling');
    assert.ok(near(unite.scale * clampZoomFor(unite, 99), ZOOM_MAX_TILE_PX, 1e-6), 'the widest-field camera stops exactly at the tile cap');
  });

  test('zooming a zoomed camera composes (the factor multiplies, the focal length follows)', () => {
    const cam = battle();
    const once = zoomCamera(cam, 1.5, 700, 400);
    const twice = zoomCamera(once, 1.5, 700, 400);
    assert.ok(near(twice.scale, cam.scale * 2.25));
    const anchor = once.unproject(700, 400, 0);
    const after = twice.unproject(700, 400, 0);
    assert.ok(near(anchor.x, after.x, 1e-9) && near(anchor.y, after.y, 1e-9), 'the same anchor stays put through both steps');
  });
});

describe('panCamera / the player\'s view transform (pan + zoom about the viewport centre)', () => {
  test('a pan translates the whole image by exactly (dx, dy) and changes nothing else', () => {
    const cam = battle();
    for (const [dx, dy] of [[120, 0], [0, -80], [-250, 140], [37.5, 12.25]]) {
      const p = panCamera(cam, dx, dy);
      assert.equal(p.scale, cam.scale); assert.equal(p.tilt, cam.tilt); assert.equal(p.dist, cam.dist);
      assert.equal(p.tx, cam.tx); assert.equal(p.ty, cam.ty); assert.equal(p.tz, cam.tz);
      assert.ok(near(p.cx, cam.cx + dx) && near(p.cy, cam.cy + dy), 'the principal point is the only thing that moves');
      for (const [x, y] of [[5, 10], [12, 4], [18, 16]]) {
        const a = cam.project(x, y, 0), b = p.project(x, y, 0);
        assert.ok(near(b.x, a.x + dx, 1e-9) && near(b.y, a.y + dy, 1e-9), `world ${x},${y} moved by the pan`);
        assert.equal(b.s, a.s, 'and its px per tile is untouched');
      }
    }
    // a pan of (0, 0) is the same camera, and `out` may be reused
    const same = panCamera(cam, 0, 0);
    for (const k of ['tx', 'ty', 'tz', 'tilt', 'dist', 'scale', 'cx', 'cy']) assert.equal(same[k], cam[k], k);
    const reuse = new Camera();
    assert.equal(panCamera(cam, 10, 10, reuse), reuse);
    assert.ok(near(reuse.cx, cam.cx + 10) && near(reuse.scale, cam.scale), 'the reused camera is fully rewritten');
  });

  test('clampPan holds the offset inside ±limit (and is safe on junk)', () => {
    assert.equal(clampPan(0, 100), 0);
    assert.equal(clampPan(40, 100), 40);
    assert.equal(clampPan(999, 100), 100);
    assert.equal(clampPan(-999, 100), -100);
    assert.equal(clampPan(NaN, 100), 0);
    assert.equal(clampPan(undefined, 100), 0);
    assert.equal(clampPan(50, -5), 0, 'a negative limit is no travel');
    assert.ok(PAN_LIMIT_FRAC > 0 && PAN_LIMIT_FRAC <= 0.5, 'the base framing\'s centre always stays on screen');
  });

  test('zoomedPan is the pan a zoom leaves so the point under the pointer does not move', () => {
    for (const base of [battle(), prep()]) {
      for (const pan0 of [{ x: 0, y: 0 }, { x: -60, y: 45 }, { x: 300, y: -260 }]) {
        for (const [ax, ay] of [[800, 450], [260, 180], [1400, 780]]) {
          for (const [z0, f] of [[1, 1.35], [1.4, 0.72], [2.2, 0.8]]) {
            const before = view(base, z0, pan0.x, pan0.y);
            const world = before.unproject(ax, ay, 0);
            if (!world) continue;
            const p1 = zoomedPan(f, { x: ax, y: ay }, K, pan0);
            const after = view(base, z0 * f, p1.x, p1.y);
            const now = after.unproject(ax, ay, 0);
            assert.ok(now, 'the pointer is on the ground plane');
            assert.ok(near(world.x, now.x, 1e-9) && near(world.y, now.y, 1e-9),
              `zoom ${z0}->${(z0 * f).toFixed(2)} pan ${pan0.x},${pan0.y} at ${ax},${ay}: (${world.x.toFixed(4)}, ${world.y.toFixed(4)}) -> (${now.x.toFixed(4)}, ${now.y.toFixed(4)})`);
          }
        }
      }
    }
    // a zoom of 1 (a clamped no-op) leaves the pan alone, and no pan at the centre needs none
    assert.deepEqual(zoomedPan(1, { x: 500, y: 300 }, K, { x: 12, y: -34 }), { x: 12, y: -34 });
    assert.deepEqual(zoomedPan(2, K, K, { x: 0, y: 0 }), { x: 0, y: 0 });
    // the existing pan scales with the zoom (it is a screen offset of the zoomed image)
    assert.deepEqual(zoomedPan(2, K, K, { x: 100, y: -50 }), { x: 200, y: -100 });
  });

  test('the composed transform is the documented one: screen\' = K + pan + zoom·(screen − K)', () => {
    const base = battle();
    const z = clampZoomFor(base, 1.7), pan = { x: -90, y: 70 };
    const cam = view(base, z, pan.x, pan.y);
    assert.ok(near(cam.scale, base.scale * z), 'scale = zoom / base.scale');
    assert.ok(near(cam.cx, K.x + pan.x + z * (base.cx - K.x)), 'cx = K.x + pan.x + zoom/(base.cx − K.x)');
    assert.ok(near(cam.cy, K.y + pan.y + z * (base.cy - K.y)), 'cy = K.y + pan.y + zoom/(base.cy − K.y)');
    // the map centre: the pane centre K projects to K + pan
    const c = base.unproject(K.x, K.y, 0);
    const p = cam.project(c.x, c.y, 0);
    assert.ok(near(p.x, K.x + pan.x, 1e-6) && near(p.y, K.y + pan.y, 1e-6), 'the base centre lands on K + pan');
  });

  test('a double click reset drops zoom AND pan together (resetZoom)', () => {
    const base = battle();
    const zoomed = clampZoomFor(base, 2), panned = { x: 200, y: -150 };
    const applied = view(base, zoomed, panned.x, panned.y);          // what the app draws while the view is applied
    const reset = view(base, 1, 0, 0);                               // ... and what resetZoom leaves
    for (const k of ['tx', 'ty', 'tz', 'tilt', 'dist', 'scale', 'cx', 'cy']) assert.equal(reset[k], base[k], k);
    assert.notEqual(applied.scale, reset.scale);
    assert.notEqual(applied.cx, reset.cx);
    // a reset camera picks exactly like the preset camera again
    for (const [row, col] of [[10, 5], [3, 12], [17, 19]]) {
      const pt = base.project(col, row, 0);
      assert.deepEqual(pickTile(reset, pt.x, pt.y, level, [0]), pickTile(base, pt.x, pt.y, level, [0]));
    }
  });

  test('the pan is bounded: the base framing\'s centre can never leave the viewport', () => {
    const base = battle();
    for (const [px, py] of [[9999, 0], [-9999, 0], [0, 9999], [400, -300]]) {
      const x = clampPan(px, VIEW.width * PAN_LIMIT_FRAC), y = clampPan(py, VIEW.height * PAN_LIMIT_FRAC);
      const cam = view(base, clampZoomFor(base, 1.6), x, y);
      const c = base.unproject(K.x, K.y, 0);
      const p = cam.project(c.x, c.y, 0);
      assert.ok(p.x >= 0 && p.x <= VIEW.width, `the base centre stays on screen in x (${p.x})`);
      assert.ok(p.y >= 0 && p.y <= VIEW.height, `the base centre stays on screen in y (${p.y})`);
    }
    // ... and the clamp is what the app would apply: beyond the limit the offset stops growing
    assert.equal(clampPan(1e6, VIEW.width * PAN_LIMIT_FRAC), VIEW.width * PAN_LIMIT_FRAC);
  });
});

describe('picking at every zoom and pan', () => {
  test('every tile centre projects to a pixel that picks that tile back (battle and prep, zoomed and panned)', () => {
    for (const base of [battle(), prep()]) {
      for (const [raw, ax, ay, px, py] of [
        [1, 800, 450, 0, 0], [0.5, 800, 450, 0, 0], [1.8, 300, 200, -140, 90], [3, 1200, 700, 260, -180],
        [0.6, 100, 800, 400, 300], [1.2, 640, 360, -400, -300],
      ]) {
        const f = clampZoomFor(base, raw);      // what the app would really allow on this camera
        const zoomed = zoomCamera(base, f, ax, ay);
        const cam = (px || py) ? panCamera(zoomed, clampPan(px, VIEW.width * PAN_LIMIT_FRAC), clampPan(py, VIEW.height * PAN_LIMIT_FRAC), zoomed) : zoomed;
        let checked = 0;
        for (let row = 0; row < 19; row++) {
          for (let col = 0; col < 21; col++) {
            const p = cam.project(col, row, 0);
            if (p.x < -20 || p.x > VIEW.width + 20 || p.y < -20 || p.y > VIEW.height + 20) continue;
            const t = pickTile(cam, p.x, p.y, level, [0]);
            assert.ok(t, `x${f.toFixed(2)} pan ${px},${py}: the centre of ${row},${col} at ${p.x.toFixed(1)},${p.y.toFixed(1)} picks something`);
            assert.equal(t.row, row, `x${f.toFixed(2)} pan ${px},${py}: row of ${row},${col}`);
            assert.equal(t.col, col, `x${f.toFixed(2)} pan ${px},${py}: col of ${row},${col}`);
            checked++;
          }
        }
        assert.ok(checked >= 4, `x${f.toFixed(2)} pan ${px},${py}: enough tiles were on screen (${checked})`);
      }
    }
  });

  test('the anchor picks the same tile before and after zooming (what the cursor is on stays put)', () => {
    const cam = battle();
    for (const [ax, ay] of [[800, 450], [420, 300], [1100, 600]]) {
      const before = pickTile(cam, ax, ay, level, [0]);
      if (!before) continue;
      for (const f of [0.5, 1.3, 2.6]) {
        const z = zoomCamera(cam, f, ax, ay);
        const after = pickTile(z, ax, ay, level, [0]);
        assert.equal(after.row, before.row, `x${f}: row under ${ax},${ay}`);
        assert.equal(after.col, before.col, `x${f}: col under ${ax},${ay}`);
      }
    }
  });

  test('a world point on screen keeps picking its own tile through a pan (and after a zoom at the cursor)', () => {
    const base = battle();
    for (const [px, py] of [[0, 0], [180, -120], [-260, 200]]) {
      // the pan is applied, then the player zooms at a pointer: that pointer still picks the same tile
      const panned = panCamera(base, clampPan(px, VIEW.width * PAN_LIMIT_FRAC), clampPan(py, VIEW.height * PAN_LIMIT_FRAC));
      for (const [ax, ay] of [[700, 420], [1000, 300]]) {
        const before = pickTile(panned, ax, ay, level, [0]);
        if (!before) continue;
        const f = clampZoomFor(base, 1.6) / 1;                 // the app zooms from 1 by this factor
        const p1 = zoomedPan(f, { x: ax, y: ay }, K, { x: px, y: py });
        const after = panCamera(zoomCamera(base, f, K.x, K.y), clampPan(p1.x, VIEW.width * PAN_LIMIT_FRAC), clampPan(p1.y, VIEW.height * PAN_LIMIT_FRAC));
        const now = pickTile(after, ax, ay, level, [0]);
        assert.ok(now, `pan ${px},${py} + zoom at ${ax},${ay}: the pointer is still on the board`);
        assert.equal(now.row, before.row, `pan ${px},${py} + zoom at ${ax},${ay}: row`);
        assert.equal(now.col, before.col, `pan ${px},${py} + zoom at ${ax},${ay}: col`);
      }
    }
  });

  test('a tile quad drawn at zoom still contains the screen point of its own centre', () => {
    const cam = panCamera(zoomCamera(battle(), 2.2, K.x, K.y), 130, -90);
    const q = tileQuad(cam, 10, 5, 0, 0);
    const c = cam.project(5, 10, 0);
    let sign = 0;
    for (let i = 0; i < q.length; i++) {
      const a = q[i], b = q[(i + 1) % q.length];
      const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      if (Math.abs(cross) < 1e-9) continue;
      const s = cross > 0 ? 1 : -1;
      if (!sign) sign = s; else assert.equal(s, sign, 'the projected centre is inside its own quad');
    }
    assert.notEqual(sign, 0, 'the quad has area');
  });
});

describe('the 3D board camera follows the zoom', () => {
  test('Camera and THREE agree on every tile centre at several zoom levels', () => {
    const three = new THREE.PerspectiveCamera();
    for (const f of [0.5, 1, 1.7, 3]) {
      const cam = zoomCamera(battle(), f, 640, 380);
      syncThreeCamera(cam, three, VIEW.width, VIEW.height);
      three.updateMatrixWorld(true);
      for (let row = 0; row < 19; row += 3) {
        for (let col = 0; col < 21; col += 3) {
          const a = cam.project(col, row, 0);
          const v = new THREE.Vector3(col, row, 0).project(three);
          const sx = (v.x + 1) / 2 * VIEW.width, sy = (1 - v.y) / 2 * VIEW.height;
          assert.ok(near(a.x, sx, 0.01) && near(a.y, sy, 0.01), `x${f} tile ${row},${col}: pixi ${a.x.toFixed(2)},${a.y.toFixed(2)} vs three ${sx.toFixed(2)},${sy.toFixed(2)}`);
        }
      }
    }
  });

  test('Camera and THREE agree through a pan too (the whole view is one camera)', () => {
    const three = new THREE.PerspectiveCamera();
    for (const [f, px, py] of [[1, 0, 0], [1.6, -220, 160], [0.7, 420, -330], [2.4, 80, 400]]) {
      const cam = panCamera(zoomCamera(battle(), clampZoomFor(battle(), f), K.x, K.y), px, py);
      syncThreeCamera(cam, three, VIEW.width, VIEW.height);
      three.updateMatrixWorld(true);
      for (let row = 0; row < 19; row += 4) {
        for (let col = 0; col < 21; col += 4) {
          const a = cam.project(col, row, 0);
          const v = new THREE.Vector3(col, row, 0).project(three);
          const sx = (v.x + 1) / 2 * VIEW.width, sy = (1 - v.y) / 2 * VIEW.height;
          assert.ok(near(a.x, sx, 0.01) && near(a.y, sy, 0.01), `zoom ${f} pan ${px},${py} tile ${row},${col}`);
        }
      }
    }
  });

  test('the three.js parameters of a zoomed camera are the preset camera\'s, zoomed', () => {
    const cam = battle();
    const z = zoomCamera(cam, 2, 400, 300);
    const a = threeCameraParams(cam, VIEW.width, VIEW.height);
    const b = threeCameraParams(z, VIEW.width, VIEW.height);
    assert.ok(near(b.fov, 2 * Math.atan(VIEW.height / 2 / (z.scale * z.dist)) / (Math.PI / 180)), 'the fov narrows with the zoom');
    assert.ok(b.fov < a.fov, `fov ${b.fov} < ${a.fov}`);
    assert.deepEqual(b.position, a.position, 'the camera stays where it was');
    assert.ok(near(b.view.offsetX, VIEW.width / 2 - z.cx) && near(b.view.offsetY, VIEW.height / 2 - z.cy), 'the lens shift carries the anchor');
  });
});

describe('zoom limits keep the view usable', () => {
  test('the extremes stay inside the project\'s own px-per-tile sanity range', () => {
    for (const base of [battle(), prep()]) {
      const wide = zoomCamera(base, clampZoomFor(base, 0.01), 0, 0);
      const close = zoomCamera(base, clampZoomFor(base, 99), 0, 0);
      const sWide = wide.scaleAt(base.tx, base.ty, 0);
      const sClose = close.scaleAt(base.tx, base.ty, 0);
      assert.ok(sWide >= ZOOM_MIN_TILE_PX - 1e-9, `widest ${sWide.toFixed(1)} px per tile`);
      assert.ok(sClose <= ZOOM_MAX_TILE_PX + 1e-9, `closest ${sClose.toFixed(1)} px per tile`);
      assert.ok(sClose > sWide * 1.4, 'the two ends are far apart enough to matter');
    }
  });
});
