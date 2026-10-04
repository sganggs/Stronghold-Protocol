// test/render/feedback3-shot-height.test.js — GitHub #61 (0.1.3): shots left an operator at its hips and aimed at the
// target's hips, and every attack shoved the whole model 0.12 tiles toward its target. render/fx.js took 0.45 × the
// head height as a WORLD height, which the 30° camera pitch draws at ≈ 18 % of the (upright, screen-space) model; the
// attack jolt of render/units.js was meant for the avatar diamond only. Now launch / aim points are heights on screen
// (fx.js SHOT_HEIGHT, solved through projection.js Camera.liftFor) and a shown Spine model keeps its place.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installFakePixi, fakeViewCtx } from './fakepixi.js';
import { presetCamera } from '../../public/js/render/projection.js';

let fake, FX, UnitView;
before(async () => {
  fake = installFakePixi();
  FX = await import('../../public/js/render/fx.js');
  ({ UnitView } = await import('../../public/js/render/units.js'));
});
after(() => fake.restore());

const cam = presetCamera('normal', { width: 1600, height: 900 });
const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);

test('Camera.liftFor: the world height that draws `px` above a point — exact on every preset camera', () => {
  const fields = { normal: [[2, 9, 0], [10, 11, 0.4], [9, 12, 0]], prep: [[2, 7, 0.16], [8, 12, 0]], boss: [[3, 0, 0], [10, 3, 0], [18, 5, 0.4]], unite: [[2, 9, 0], [18, 12, 0]] };
  for (const [kind, pts] of Object.entries(fields)) {
    const c = presetCamera(kind, { width: 1280, height: 720 });
    for (const [x, y, z] of pts) {
      for (const px of [0, 20, 64, 140]) {
        const h = c.liftFor(x, y, z, px);
        close(c.project(x, y, z).y - c.project(x, y, z + h).y, px, 1e-6, `${kind} (${x},${y},${z}) +${px}px`);
      }
    }
  }
  const s = cam.scaleAt(5, 10, 0);
  assert.ok(cam.liftFor(5, 10, 0, s) > 1.8, 'one tile of screen height is ≈ 2 world tiles under the 30° pitch');
});

/** A unit view as the FX system reads it. */
const unit = (id, x, y, o = {}) => ({ id, x, y, z: 0, hover: 0, _headTiles: 1.18, alive: true, destroyed: false, isEnemy: false, info: { defId: 'char_x' }, onHit() {}, ...o });
function makeFx() {
  const ctx = fakeViewCtx(fake.P);
  return new FX.FxSystem({
    P: fake.P, layers: ctx.layers, cam: () => cam, heightAt: () => 0, settings: { quality: 'high', damageNumbers: true },
    timeScale: () => 2, loadLevel: () => 0, subProfOf: () => null, view: () => null, screenSize: () => ({ width: 1600, height: 900 }), fieldTop: () => 120,
  });
}
/** Share of a unit's drawn model height (above its feet, on screen) of world point (x, y, z). */
const share = (v, x, y, z) => { const f = cam.project(x, y, v.z); return (f.y - cam.project(x, y, z).y) / (v._headTiles * f.s); };

test('an arrow leaves the shooter at its hands and flies at the target\'s chest (SHOT_HEIGHT), not at the hips', () => {
  assert.deepEqual({ ...FX.SHOT_HEIGHT }, { launch: 0.45, aim: 0.5 });
  const fx = makeFx();
  const src = unit(1, 3, 10), tgt = unit(2, 7, 11, { isEnemy: true, _headTiles: 1.6 });
  fx.attack(src, tgt, 'arrow');
  const pr = fx.projs[fx.projs.length - 1];
  close(share(src, pr.x0, pr.y0, pr.z0), FX.SHOT_HEIGHT.launch, 0.03, 'launch share of the model height');
  close(share(tgt, pr.tx, pr.ty, pr.tz), FX.SHOT_HEIGHT.aim, 1e-6, 'aim share of the target\'s model');
  // the old rule: 0.45 × head height as a world height → ≈ 18–23 % of the model
  assert.ok(share(src, src.x, src.y, 0.45 * src._headTiles) < 0.25, 'the hip height it used to start from');
  // a raised / flying unit: measured from where it is drawn
  const fly = unit(3, 6, 9, { z: 0.4, hover: 0.32 });
  assert.ok(Math.abs(FX.bodyZ(cam, fly, 0.5) - 0.72 - cam.liftFor(6, 9, 0.72, 0.5 * 1.18 * cam.scaleAt(6, 9, 0.72))) < 1e-9);
});

test('the attack jolt only moves the avatar diamond: a shown Spine model keeps its place on an attack', async () => {
  const entry = { skel: '/s/x.skel', atlas: '/s/x.atlas', textures: ['/s/x.png'], anims: { idle: 'Idle', attack: { begin: null, loop: 'Attack', end: null } }, animations: { Idle: 1, Attack: 1 } };
  let ready = false;
  const assets = { picture: () => null, image: async () => null, spineEntry: () => entry,
    spine: { acquire: () => (ready ? Promise.resolve({ animations: [{ name: 'Idle' }, { name: 'Attack' }] }) : new Promise(() => {})), release() {} } };
  const make = () => new UnitView(fakeViewCtx(fake.P, { assets, cam: () => cam }), { id: 1, side: 'ally', kind: 'op', defId: 'c', spine: 'c', tier: 3, x: 4, y: 10, maxHp: 1000, dir: 'RIGHT' });
  const target = { x: 8, y: 12 };
  const feet = cam.project(4, 10, 0);
  // no model (still loading): the diamond jolts toward the target
  const d = make();
  d.update(1 / 60, cam, 0);
  d.onAttack(target, 1, 'arrow');
  d.update(0.1, cam, 0.1); d.update(0.01, cam, 0.11);   // (the jolt peaks a tenth of a second in)
  assert.ok(Math.hypot(d.root.position.x - feet.x, d.root.position.y - feet.y) > 1, 'the avatar diamond lunges');
  // a Spine model shown: no jolt
  ready = true;
  const v = make();
  await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
  assert.ok(v.actor && v.spineReady);
  v.update(1 / 60, cam, 0);
  v.onAttack(target, 1, 'arrow');
  for (let i = 0; i < 4; i++) {
    v.update(0.05, cam, 0.05 * i);
    close(v.root.position.x, feet.x, 1e-6, 'x'); close(v.root.position.y, feet.y, 1e-6, 'y');
  }
  assert.equal(v.actor.current, 'Attack', 'the model shows the attack with its own clip');
});
