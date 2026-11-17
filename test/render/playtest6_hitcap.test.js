// 限伤 on screen (docs/research/11-limits-official.md §2, DESIGN §20.12): a leader's hit of ≥ 300000 in a boss battle
// is cancelled by the sim (server/sim/attack/health.js leaderHitCancelled), which emits ['fx', 'hitCap', x, y, { id, n }] and
// no 'dmg' event. The official shows no number for it [ASSUMED]; the renderer draws nothing for the event.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FxSystem, FX_KINDS, fxSpec } from '../../public/js/render/fx.js';
import { presetCamera } from '../../public/js/render/projection.js';

function recordingFx() {
  const cam = presetCamera('boss', { width: 1280, height: 720 });
  const calls = [];
  const fx = Object.create(FxSystem.prototype);
  const rec = (name) => (...a) => { calls.push(name); return name === '_where' || name === '_point' ? { x: a[0], y: a[1], z: 0, v: null } : undefined; };
  Object.assign(fx, {
    ctx: { cam: () => cam, heightAt: () => 0, fieldRect: () => ({ r0: 0, r1: 5, c0: 0, c1: 20 }), timeScale: () => 2 },
    _p: { x: 0, y: 0, s: 0, depth: 0 }, _q: { x: 0, y: 0, s: 0, depth: 0 }, locks: [],
    _where: rec('_where'), _point: rec('_point'), particle: rec('particle'), ring: rec('ring'), burst: rec('burst'),
    explosion: rec('explosion'), flashScreen: rec('flashScreen'), tileFlash: rec('tileFlash'),
  });
  fx._chest = (v, out) => Object.assign(out, cam.project(0, 0, 0.5, out));
  return { fx, calls };
}

test('hitCap: listed in FX_KINDS as a kind that draws nothing', () => {
  assert.equal(FX_KINDS.hitCap.a, 'none');
  assert.equal(fxSpec('hitCap', { id: 3, n: 300000 }).a, 'none');
});

test('hitCap: simFx draws nothing (no number, no spark); an unknown kind still gets its generic sparkle', () => {
  const { fx, calls } = recordingFx();
  fx.simFx('hitCap', 10, 3, { id: 7, n: 412345 });
  assert.deepEqual(calls, [], 'nothing drawn for a cancelled leader hit');
  fx.simFx('zzzUnknownKind', 10, 3, {});
  assert.ok(calls.includes('particle'), 'the generic sparkle still works');
});
