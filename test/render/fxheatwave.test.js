// test/render/fxheatwave.test.js — 塔露拉 S3 日冕重烈's 簇火 without the official projectile (player report 「塔露拉3技能没有
// 特效」, history §37.354): with 官方特效 off, or projectile_chr_oxi_s_3_heatwave's trail not installed, the field view
// draws the kit's one 'heatwave' per volley (`dir`, `n` at her tile) as a fire streak along each lane the kit's shots fly
// (render/vfx/lanes.js — the same paths the official flights take). Until round 85 the volley was the shared `wave`
// rings on her tile: they never travelled, and her official stance loop swallowed them (skillfx.js FLASH). Against the
// headless fake PIXI (test/render/fakepixi.js), like fxchen3wave.test.js.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installFakePixi, fakeViewCtx } from './fakepixi.js';
import { presetCamera } from '../../public/js/render/projection.js';
import { GEO } from '../../shared/constants.js';

let fake, FX;
before(async () => {
  fake = installFakePixi();
  FX = await import('../../public/js/render/fx.js');
});
after(() => fake.restore());

const DT = 1 / 120;
const cam = presetCamera('normal', { width: 1600, height: 900 });
const unit = (id, x, y) => ({ id, x, y, z: 0, hover: 0, _headTiles: 1.2, alive: true, destroyed: false, info: { defId: 'char_4247_oxi' }, onHit() {} });

function makeFx(views, { quality = 'high', rect = null } = {}) {
  const P = fake.P;
  const ctx = fakeViewCtx(P);
  const map = new Map(views.map((v) => [v.id, v]));
  return new FX.FxSystem({
    P, layers: ctx.layers, cam: () => cam, heightAt: () => 0, settings: { quality, damageNumbers: true },
    timeScale: () => 1, loadLevel: () => 0, subProfOf: () => null, view: (id) => map.get(id) || null,
    screenSize: () => ({ width: 1600, height: 900 }), fieldTop: () => 120, ...(rect ? { fieldRect: () => rect } : {}),
  });
}
const run = (fx, seconds) => { for (let t = 0; t < seconds - 1e-9; t += DT) fx.update(DT); };
const volley = (fx, id, x, y, dir, n) => fx.simFx('heatwave', x, y, { x, y, dir, n, id, skill: 'oxi:heatwave' });
const streaks = (fx) => fx.parts.filter((p) => p.sp && p.sp.visible !== false && p.sp.texture === fx.tex.streak);
const screen = (x, y) => cam.project(x, y, 0.15, { x: 0, y: 0, s: 0, depth: 0 });

describe('塔露拉 S3 簇火 without the official projectile: one streak per lane', () => {
  test('its own archetype — the lanes, not the cast-flash rings; at her tile', () => {
    assert.equal(FX.FX_KINDS.heatwave.a, 'lanes');
    assert.equal(FX.fxSpec('heatwave').a, 'lanes');
    assert.equal(FX.fxSpec('heatwave').pt, true);
  });

  test('a volley draws a streak and a core per lane, from behind her to past the field\'s far edge', () => {
    const her = unit(1, 3, 10);
    const fx = makeFx([her], { rect: GEO.NORMAL_RECT });
    volley(fx, her.id, her.x, her.y, 'RIGHT', 3);
    run(fx, 1 / 60);
    const lines = streaks(fx);
    assert.equal(lines.length, 6, 'three lanes, a body and a core each');
    const hers = screen(her.x, her.y);
    assert.ok(Math.max(...lines.map((p) => p.sp.position.x)) > hers.x + 40, 'the lanes run to her right');
    // a streak sprite sits at its lane's end (anchorX 1): column 10 + wave_exit_distance of the rows 9, 10, 11
    const ends = [9, 10, 11].flatMap((r) => [0.15, 0.19].map((z) => cam.project(15, r, z, { x: 0, y: 0, s: 0, depth: 0 })));
    for (const p of lines) {
      assert.ok(ends.some((q) => Math.hypot(q.x - p.sp.position.x, q.y - p.sp.position.y) < 1), `a lane end (${Math.round(p.sp.position.x)}, ${Math.round(p.sp.position.y)})`);
    }
  });

  test('left runs the other way; low quality keeps one streak per lane; 过载\'s 13 lanes are the field\'s rows', () => {
    const her = unit(1, 10, 10);
    const fx = makeFx([her]);
    volley(fx, her.id, her.x, her.y, 'LEFT', 1);
    run(fx, 1 / 60);
    const lines = streaks(fx);
    assert.equal(lines.length, 2);
    assert.ok(Math.min(...lines.map((p) => p.sp.position.x)) < screen(her.x, her.y).x - 40, 'the lane runs to her left');
    const low = makeFx([her], { quality: 'low' });
    volley(low, her.id, her.x, her.y, 'UP', 5);
    run(low, 1 / 60);
    assert.equal(streaks(low).length, 5, 'low quality: one streak per lane, no core');
    const field = makeFx([her], { quality: 'low', rect: GEO.NORMAL_RECT });
    volley(field, her.id, her.x, her.y, 'RIGHT', 13);
    run(field, 1 / 60);
    assert.equal(streaks(field).length, 4, 'the normal field\'s 4 rows');
  });

  test('a missing direction, a zero lane count and a non-finite point never throw', () => {
    const her = unit(1, 3, 10);
    const fx = makeFx([her]);
    volley(fx, her.id, her.x, her.y, undefined, 0);
    fx.simFx('heatwave', her.x, her.y, { id: her.id });
    fx.simFx('heatwave', NaN, NaN, { id: her.id, dir: 'UP', n: 4 });
    run(fx, 0.2);
    assert.ok(streaks(fx).length >= 2, 'the junk direction still draws a lane (to the right)');
  });
});
