import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FxWiring } from '../../public/js/render/vfx/wiring.js';
import { CANNON_UNIT, CANNON_FX, cannonCastPlace } from '../../public/js/render/vfx/cannonfx.js';

async function fixture(missing = []) {
  const points = {
    SpecialPoint0: { all: { pos: [0, 0, 0], rot: [0, 0, 0, 1] } },
    Muzzle: { all: { pos: [0, -0.1, -0.5], rot: [0, 0, 0, 1] } },
  };
  const idx = {
    units: {},
    skins: { [CANNON_UNIT]: { points } },
    projectiles: {
      projectile_trap_cnnon_small: {
        movement: { class: 'ParacurveMovement', raiseHeight: 0.7, noRaiseHeightThreshold: 1.3 },
      },
    },
    generic: {},
    prefabs: {},
  };
  const handles = [],
    views = new Map();
  const ofx = {
    active: true,
    time: 0,
    timers: [],
    ctx: { heightAt: () => 0.4 },
    lib: {
      has: (k) => !missing.includes(k),
      index: async () => idx,
      preload: async () => {},
      defs: new Map([
        [
          CANNON_FX.cast,
          {
            nodes: [
              { name: 'root', parent: null, pos: [0, 0, 0], rot: [0, 0, 0, 1], scale: [1, 1, 1] },
              { name: 'ball', parent: 0, pos: [5, 0.4249, -7.4477] },
            ],
          },
        ],
      ]),
    },
    spawn(key, place, opts = {}) {
      if (!this.active || !this.lib.has(key)) return null;
      const h = {
        key,
        place,
        opts,
        alive: true,
        kill() {
          this.alive = false;
        },
      };
      handles.push(h);
      return h;
    },
  };
  const stage = { devices: [{ key: CANNON_UNIT, pos: [13, 6], cannon: { distance: 4 } }] };
  const w = new FxWiring(ofx, { view: (id) => views.get(id), record: () => null, stage: () => stage });
  await w.ready();
  const v = {
    id: 1,
    x: 6,
    y: 13,
    z: 0.8,
    alive: true,
    info: { id: 1, defId: CANNON_UNIT, dir: 'DOWN', kind: 'device' },
  };
  views.set(1, v);
  return { w, ofx, idx, v, handles, views, stage };
}

test('cannon idle is owned once, follows phase removal, and restarts after off/lite clearing', async () => {
  const { w, ofx, v, handles } = await fixture();
  w.sync([v]);
  w.sync([v]);
  assert.equal(handles.filter((h) => h.key === CANNON_FX.idle).length, 1);
  assert.deepEqual(handles[0].place.pos, [-4, 4, -0.8]);
  assert.deepEqual(handles.find((h) => h.key === CANNON_FX.marker).place.pos, [-4, 0, -0.4]);
  assert.equal(handles.filter((h) => h.key === CANNON_FX.marker).length, 1);
  ofx.active = false;
  w.sync([v]);
  assert.ok(handles.every((h) => !h.alive));
  ofx.active = true;
  w.sync([v]);
  assert.equal(w.cannons.idle.size, 1);
  w.sync([]);
  assert.equal(w.cannons.idle.size, 0);
  w.clear();
  assert.ok(handles.every((h) => !h.alive));
});

test('landing marker follows the stage distance and facing, using the landing tile height instead of the cannon height', async () => {
  for (const [dir, target] of [
    ['DOWN', [-4, -1, -0.4]],
    ['RIGHT', [1, 4, -0.4]],
    ['UP', [-4, 9, -0.4]],
    ['LEFT', [-9, 4, -0.4]],
  ]) {
    const { w, v, handles, stage } = await fixture();
    stage.devices[0].cannon.distance = 5;
    v.info.dir = dir;
    w.sync([v]);
    const p = handles.find((h) => h.key === CANNON_FX.marker).place;
    p.pos.forEach((x, i) => assert.ok(Math.abs(x - target[i]) < 1e-9, `${dir} axis ${i}`));
    assert.equal(p.groundZ, -0.4);
  }
});

test('shot plays original cast and flies from bound muzzle on the effect clock; only impact emits explosion', async () => {
  const { w, ofx, handles } = await fixture();
  assert.equal(w.simFx('saltCannonShot', 6, 9, { id: 1, t: 0.8 }), true);
  assert.equal(handles[0].key, CANNON_FX.cast);
  const trail = handles.find((h) => h.key === CANNON_FX.trail),
    fx = { anchor: [] };
  assert.ok(Math.abs(trail.place.pos[1] - 3.9) < 1e-9);
  assert.equal(trail.place.pos[2], -1.3);
  ofx.time = 0.4;
  trail.opts.track(fx);
  const middle = [...fx.anchor];
  trail.opts.track(fx);
  assert.deepEqual(fx.anchor, middle, 'paused clock is stable');
  assert.ok(fx.anchor[2] < -0.4, 'native parabolic height');
  ofx.time = 0.8;
  trail.opts.track(fx);
  assert.equal(trail.alive, false);
  assert.deepEqual(fx.anchor, [-4, 0, -0.4]);
  assert.equal(handles.filter((h) => h.key === CANNON_FX.hit).length, 0);
  assert.equal(w.simFx('saltCannonHit', 6, 9, { id: 1 }), true);
  assert.equal(handles.filter((h) => h.key === CANNON_FX.hit).length, 1);
});

test('missing native flight keeps the procedural shot and native impact works after the source disappears', async () => {
  const { w, views, handles } = await fixture([CANNON_FX.trail]);
  assert.equal(w.simFx('saltCannonShot', 6, 9, { id: 1, t: 0.8 }), false);
  assert.ok(handles.some((h) => h.key === CANNON_FX.cast));
  views.clear();
  assert.equal(w.simFx('saltCannonHit', 6, 9, { id: 1 }), true);
});

test('cannon destruction stops idle, preserves its fired projectile and clear releases every handle', async () => {
  const { w, v, handles } = await fixture();
  w.sync([v]);
  w.simFx('saltCannonShot', 6, 9, { id: 1, t: 0.8 });
  v.alive = false;
  assert.equal(w.death(v), true);
  assert.equal(w.cannons.idle.size, 0);
  assert.equal(w.cannons.markers.size, 0);
  assert.equal(handles.find((h) => h.key === CANNON_FX.marker).alive, false);
  assert.ok(handles.find((h) => h.key === CANNON_FX.trail).alive);
  assert.ok(handles.some((h) => h.key === CANNON_FX.destroyed));
  w.clear();
  assert.ok(handles.every((h) => !h.alive));
});

test('preparation uses the actual visible scene devices and clears old phase ownership', async () => {
  const { w } = await fixture();
  const board = { stage: { id: 'm10' }, board: { devices: [{ kind: 'cannon', r: 13, c: 6, z0: 0.8, dir: 'DOWN' }] } };
  w.cannons.prep(board);
  assert.ok(w.cannons.idle.has('m10:13:6'));
  w.cannons.prep(null);
  assert.equal(w.cannons.idle.size, 0);
});

test('cast registration cancels the saved translation and preserves the native motion relative to the muzzle', () => {
  const special = { pos: [1, 2, -0.8], rootRot: [0.5, 0.5, -0.5, -0.5], groundZ: -0.8 },
    muzzle = { pos: [1, 1.862, -1.256] };
  const def = {
    nodes: [
      { name: 'fixed', parent: null, pos: [0, 0, 0], rot: [0, 0, 0, 1], scale: [1, 1, 1] },
      { name: 'ball', parent: 0, pos: [5, 0.4249, -7.4477] },
    ],
  };
  const place = cannonCastPlace(special, muzzle, def);
  // q maps (x,y,z) to (-z,x,-y). At time zero the authored ball is exactly at FixedMuzzle.
  assert.ok(Math.abs(place.pos[0] + 7.4477 - muzzle.pos[0]) < 1e-9);
  assert.ok(Math.abs(place.pos[1] + 5 - muzzle.pos[1]) < 1e-9);
  assert.ok(Math.abs(place.pos[2] - 0.4249 - muzzle.pos[2]) < 1e-9);
  assert.deepEqual(def.nodes[1].pos, [5, 0.4249, -7.4477], 'descriptor remains unchanged');
  def.nodes[0].pos = [1, 0, 0];
  assert.equal(cannonCastPlace(special, muzzle, def), null);
});

test('preloading accepts the production Map iterator and includes all cannon effects', async () => {
  const { w, v } = await fixture();
  const keys = w.keysFor(new Map([[v.id, v]]).values());
  for (const key of Object.values(CANNON_FX)) assert.ok(keys.includes(key), key);
});

test('the device manager owns birth effects without also invoking generic talent emitters', async () => {
  const { w, v } = await fixture();
  w.talents.deployed = () => {
    throw Error('duplicate cannon talent emitter');
  };
  assert.equal(w.spawned(v), false);
});

test('impact plays a hit effect for each selected unit, survives missing targets, and clears its handles', async () => {
  const { w, views, handles } = await fixture();
  const targets = [
    { id: 2, x: 6, y: 9 },
    { id: 3, x: 7, y: 10 },
  ];
  for (const v of targets) views.set(v.id, v);
  const hits = [];
  w.playOn = (key, v) => {
    const h = {
      alive: true,
      kill() {
        this.alive = false;
      },
    };
    hits.push({ key, id: v.id, h });
    return h;
  };
  views.delete(1);
  assert.equal(w.simFx('saltCannonHit', 6, 9, { id: 1, targets: [2, 3, 99] }), true);
  assert.deepEqual(
    hits.map((h) => [h.key, h.id]),
    [
      [CANNON_FX.unitHit, 2],
      [CANNON_FX.unitHit, 3],
    ],
  );
  assert.equal(handles.filter((h) => h.key === CANNON_FX.hit).length, 1);
  w.clear();
  assert.ok(hits.every((h) => !h.h.alive));
});


test('preparation keeps assumed idle and markers without replaying cannon birth', async () => {
  const { w, v, handles } = await fixture();
  const board = { stage: { id: 'm10' }, board: { devices: [{ kind: 'cannon', r: 13, c: 6, z0: .8, dir: 'DOWN' }] } };
  w.cannons.prep(board);
  w.cannons.prep(board);
  assert.equal(handles.filter((h) => h.key === CANNON_FX.born).length, 0);
  assert.equal(handles.filter((h) => h.key === CANNON_FX.idle).length, 1);
  assert.equal(handles.filter((h) => h.key === CANNON_FX.marker).length, 1);
  w.cannons.prep(null);
  w.sync([v]);
  assert.equal(handles.filter((h) => h.key === CANNON_FX.born).length, 1);
  w.clear();
});
