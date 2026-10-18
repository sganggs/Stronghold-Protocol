// test/render/vfx-orient.test.js — official effects that stand, start at the weapon or come back (the maintainer's report
// of 2026-10-16, DESIGN §34.6): the prefab root's authored transform is no part of the effect (the client sets the root
// where it plays it: 安洁莉娜 S2's orbs flew 0.94 tile above their path); an effect spawned at FOOT_POINT / HIT_POINT /
// HEAD_POINT takes the unit's Graphic tilt (荒芜拉普兰德 S3's seal and 能天使 S3's light bars stand facing the camera), the
// ground and NONE spawns the identity, FLIP_TWO_SIDE still flips the tilted ones, a FollowMountPoint keeps or follows; a
// renderer's pivot moves the particle off its position by pivot × size (the seal's tips point outward); a local-space
// particle is drawn at its node's scale as it is now (the seal's discs grow with their 0.5 s pop-in), and per axis (the
// seal's tips are flat spikes, 娜仁图亚 S3's hit a streak); a 回环射手's
// boomerang flies back to its thrower after its hit (index.json movement `comeBack`).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileEffect, Effect } from '../../public/js/render/vfx/effect.js';
import { FxWiring } from '../../public/js/render/vfx/wiring.js';
import { spawnRotation, graphicRotation } from '../../public/js/render/vfx/mounts.js';
import { quatRotate } from '../../public/js/render/vfx/math.js';
import { FrameData, cameraBasis } from '../../public/js/render/vfx/geom.js';
import { builtinMesh } from '../../public/js/render/vfx/library.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PREFABS = path.join(ROOT, 'public/assets/local/fx/prefabs');
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);
const nearV = (a, b, eps, msg) => a.forEach((x, i) => near(x, b[i], eps, `${msg}[${i}]`));

const MAT = {
  name: 'm', shader: 'Torappu/Particles/Additive', passes: [{ blend: ['SrcAlpha', 'One', 'Zero', 'OneMinusSrcAlpha'], blendOp: 'Add', zTest: 'Disabled', zWrite: false, cull: 'Off', colorMask: 15 }],
  queue: 'Transparent', keywords: [], floats: {}, colors: { _TintColor: [1, 1, 1, 1] }, textures: { _MainTex: { tex: 't', st: [1, 1, 0, 0] } },
};

/** A node with a burst system (billboard by default; `r` overrides renderer fields, `ps` the system's). */
const psNode = (id, parent, o = {}) => ({
  id, name: o.name || `ps${id}`, parent, children: [], active: true, pos: o.pos || [0, 0, 0], rot: o.rot || [0, 0, 0, 1], scale: o.scale || [1, 1, 1],
  particleSystem: { lengthInSec: 1, looping: !!o.loop, prewarm: false, startDelay: 0, playOnAwake: true, simulationSpeed: 1, moveWithTransform: o.space ?? 0, scalingMode: o.scaling ?? 1,
    InitialModule: { startLifetime: o.life ?? 1, startSpeed: 0, startSize: o.size ?? 1, startColor: [1, 1, 1, 1], maxNumParticles: 100 },
    EmissionModule: { rateOverTime: 0, m_Bursts: [{ time: 0, countCurve: 1, cycleCount: 1, repeatInterval: 0.01, probability: 1 }] }, ...(o.ps || {}) },
  particleSystemRenderer: { m_Enabled: true, renderMode: 'billboard', renderAlignment: 'view', materials: [0, null], m_SortingOrder: o.order ?? 0, ...(o.r || {}) },
  behaviours: o.behaviours || [],
});

function desc(nodes, extra = {}) {
  for (const n of nodes) if (n.parent != null) nodes[n.parent].children.push(n.id);
  return { format: 'fx-prefab', version: 1, key: 'test', root: 0, nodes, materials: [MAT], clips: [], textures: ['t'], meshes: [], refs: [], stats: {}, ...extra };
}
const rootNode = (behaviours = [], o = {}) => ({ id: 0, name: 'root', parent: null, children: [], active: true, pos: o.pos || [0, 0, 0], rot: o.rot || [0, 0, 0, 1], scale: [1, 1, 1], behaviours });
const pe = (fields = {}) => ({ class: 'ParticleEffect', enabled: true, fields: { _delayToPlay: 0, _delayToFinish: 0, _maxLifetime: -1, _isLoop: 0, _rotateType: 0, _spawnLocation: 2, _inactiveOnFinish: [], ...fields } });
const proj = (fields = {}) => ({ class: 'ProjectileEffect', enabled: true, fields: { _mainDir: 1, _delayToFinish: 0, _inactiveOnFinish: [], _inactiveOnHit: [], ...fields } });
const worldPos = (fx, i) => [fx.world[i][12], fx.world[i][13], fx.world[i][14]];
/** The world direction of a node's local +x axis. */
const worldX = (fx, i) => { const w = fx.world[i], l = Math.hypot(w[0], w[1], w[2]) || 1; return [w[0] / l, w[1] / l, w[2] / l]; };

describe('the root of a prefab is placed by the game', () => {
  test("the root's authored position is not added to the anchor (a projectile's body, an effect on a unit)", () => {
    // 安洁莉娜 S2's aglina_skill_02_trail: its root left at (0.181, 0.738, −0.601) in the prefab
    for (const beh of [[proj()], [pe({ _spawnLocation: 1 })]]) {
      const d = desc([rootNode(beh, { pos: [0.181, 0.738, -0.601] }), psNode(1, 0, { pos: [0.1, 0, 0] })]);
      const def = compileEffect(d);
      nearV(def.rootPos, [0.181, 0.738, -0.601], 1e-6, 'the authored position is kept for reference');
      const fx = new Effect(def, { seed: 1 }).place({ pos: [2, 3, -1] });
      fx.update(1 / 30);
      nearV(worldPos(fx, 0), [2, 3, -1], 1e-6, `${beh[0].class}: the root at the anchor`);
      nearV(worldPos(fx, 1), [2.1, 3, -1], 1e-6, `${beh[0].class}: its child at its own offset from the anchor`);
    }
  });

  test("a projectile body's authored root rotation gives way to its flight; `rootRot` replaces a prefab's own; a map-position effect keeps it", () => {
    const quarter = [0, 0, Math.SQRT1_2, Math.SQRT1_2];   // 90° about z left in the prefab
    const child = () => psNode(1, 0, { pos: [1, 0, 0] });
    const p = new Effect(compileEffect(desc([rootNode([proj()], { rot: quarter }), child()])), { seed: 1 }).place({ pos: [0, 0, 0], yaw: 0 });
    p.update(1 / 30);
    nearV(worldPos(p, 1), [1, 0, 0], 1e-6, 'a projectile body flies along +x (its direction), not turned by the leftover 90°');
    const kept = new Effect(compileEffect(desc([rootNode([pe({ _spawnLocation: 0 })], { rot: quarter }), child()])), { seed: 1 }).place({ pos: [0, 0, 0] });
    kept.update(1 / 30);
    nearV(worldPos(kept, 1), [0, 1, 0], 1e-6, 'placed at a map position (Effect._InitLocation sets only the position): the authored rotation stays');
    const tilt = [-0.258819, 0, 0, 0.965926];
    const set = new Effect(compileEffect(desc([rootNode([pe({ _spawnLocation: 1 })], { rot: quarter }), child()])), { seed: 1 }).place({ pos: [0, 0, 0], rootRot: tilt });
    set.update(1 / 30);
    nearV(worldPos(set, 1), [1, 0, 0], 1e-6, 'the rotation the game sets replaces the authored one');
    set.place({ rootRot: null });
    set.update(1 / 30);
    nearV(worldPos(set, 1), [0, 1, 0], 1e-6, 'and is cleared with null');
  });
});

const TRAIL = path.join(PREFABS, 'aglina_skill_02_trail.json');
test("the local client: 安洁莉娜 S2's flying orb is drawn at its projectile, not 0.94 tile above it", { skip: !existsSync(TRAIL) && 'local extraction absent' }, () => {
  const d = JSON.parse(readFileSync(TRAIL, 'utf8'));
  nearV(d.nodes[0].pos, [0.181, 0.738, -0.601], 1e-3, 'the prefab keeps the editor position of its root');
  const fx = new Effect(compileEffect(d), { seed: 1 }).place({ pos: [-5.654, 2.147, -1.082], yaw: Math.PI, rootRot: [0, 0, 0, 1] });
  fx.update(1 / 30);
  const trail = d.nodes.findIndex((n) => n.trailRenderer);
  nearV(worldPos(fx, trail), [-5.654, 2.147, -1.082], 1e-4, 'the trail rides the projectile');
  nearV(worldX(fx, trail), [-1, 0, 0], 1e-4, 'turned along the flight');
});

// ---- the spawn location's rotation (DESIGN §33.11, the client's Effect._InitLocationFromEntity) ------------------------

const GRAPHIC = [-0.258819, 0, 0, 0.965926];
/** The battle camera's view direction in the Unity frame (30° from straight down, towards +row). */
const CAM_FWD = [0, Math.sin(Math.PI / 6), Math.cos(Math.PI / 6)];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** The world direction of a node's local +z axis (a local billboard's / a quad's normal). */
const worldZ = (fx, i) => { const w = fx.world[i], l = Math.hypot(w[8], w[9], w[10]) || 1; return [w[8] / l, w[9] / l, w[10] / l]; };

/** A prefab: a root with its ParticleEffect (`f`), a `rotation_y` helper and a local billboard in its XY plane. */
function standing(f = {}, beh = []) {
  return desc([rootNode([pe({ _rotationY: { node: 1 }, ...f }), ...beh]), { ...psNode(1, 0, { name: 'rotation_y' }), particleSystemRenderer: { m_Enabled: false, materials: [0] } },
    psNode(2, 1, { pos: [0.3, 0.6, 0], r: { renderAlignment: 'local' } })]);
}

/** A wiring over a fake layer whose library holds compiled `defs`; it records every spawn's placement. */
async function wired(defs) {
  const index = { version: 3, units: { char_t: { kind: 'char', modes: [], skills: {}, skin: 'char_t', refs: [] } },
    skins: { char_t: { graphic: { rot: GRAPHIC }, points: { HitPoint: { all: { pos: [0, 0.232, -0.25], rot: [0, 0, 0, 1] } }, HeadPoint: { all: { pos: [0, 0.75, -0.55], rot: [0, 0, 0, 1] } },
      Muzzle: { front: { pos: [0.4, 0.2, -0.1], rot: [0, 0, 0, 1] } } } } },
    projectiles: {}, skills: {}, generic: {}, prefabs: {} };
  const spawned = [];
  const ofx = {
    active: true, time: 0, timers: [], ctx: { cam: () => ({ tilt: 30 }) },
    lib: { has: (k) => k in defs, def: (k) => defs[k] || null, index: async () => index, preload: async (keys) => keys.length, defs: new Map() },
    spawn(key, place, opts) { const h = { key, place, opts, alive: true, stop() {} }; spawned.push(h); return h; },
  };
  const w = new FxWiring(ofx, { speed: () => 10, record: () => null });
  await w.ready();
  const view = (o = {}) => ({ id: 1, x: 5, y: 10, z: 0, visFacing: 1, isEnemy: false, alive: true, flags: 0, dir: 'RIGHT', info: { id: 1, spine: 'char_t', defId: 'char_t', side: 'ally', kind: 'op' }, ...o });
  return { w, spawned, view };
}

/** The effect a recorded spawn draws: the prefab under the placement the wiring gave it, one frame on. */
function drawn(def, h) {
  const fx = new Effect(def, { seed: 1 }).place(h.place);
  fx.update(1 / 30);
  return fx;
}

describe('the rotation an effect takes from its spawn location', () => {
  test('FOOT / HIT / HEAD: the Graphic tilt; MUZZLE / a Special point: the point; the ground, NONE and MUZZLE_POINT_WITHOUT_ROTATION: none', () => {
    for (const s of [1, 2, 4]) assert.equal(spawnRotation(s), 'graphic', `spawn ${s}`);
    assert.equal(spawnRotation(3), 'muzzle');
    assert.equal(spawnRotation(8), 's0');
    assert.equal(spawnRotation(13), 's4');
    for (const s of [0, 5, 6, 7, 12, 17, 26, 35]) assert.equal(spawnRotation(s), null, `spawn ${s}`);
    nearV(graphicRotation(null), GRAPHIC, 1e-9, 'the client\'s −30° about X without a skin');
    nearV(graphicRotation({ graphic: { rot: [0.258819, 0, 0, -0.965926] } }), [0.258819, 0, 0, -0.965926], 1e-9, 'the skin\'s own');
  });

  test('an effect authored standing (荒芜拉普兰德 S3\'s seal: a local plane at FOOT_POINT) faces the camera; HIT and HEAD alike', async () => {
    for (const spawn of [1, 2, 4]) {
      const def = compileEffect(standing({ _spawnLocation: spawn, _rotateType: 1 }));
      const { w, spawned, view } = await wired({ seal: def });
      w.playOn('seal', view(), { follow: true, loop: true });
      const h = spawned[0];
      nearV(h.place.rootRot, GRAPHIC, 1e-6, `spawn ${spawn}: the Graphic tilt`);
      assert.equal(h.place.mountRot, null, 'no facing turn of its own');
      const n = worldZ(drawn(def, h), 2);
      assert.ok(dot(n, CAM_FWD) > 0.9999, `spawn ${spawn}: the plane faces the camera (normal ${n.map((x) => x.toFixed(3))})`);
    }
  });

  test('a ground spawn, NONE and MUZZLE_POINT_WITHOUT_ROTATION take the identity: a local plane lies on the board', async () => {
    for (const spawn of [0, 5, 6, 7]) {
      const def = compileEffect(standing({ _spawnLocation: spawn }));
      const { w, spawned, view } = await wired({ fx: def });
      w.playOn('fx', view(), {});
      nearV(spawned[0].place.rootRot, [0, 0, 0, 1], 1e-9, `spawn ${spawn}`);
      nearV(worldZ(drawn(def, spawned[0]), 2), [0, 0, 1], 1e-6, `spawn ${spawn}: flat`);
    }
  });

  test('FLIP_TWO_SIDE still flips a tilted effect for a unit facing left (the tilt has no facing turn); a MUZZLE_POINT one faces with the unit', async () => {
    const foot = compileEffect(standing({ _spawnLocation: 1, _rotateType: 1 }));
    const muzzle = compileEffect(standing({ _spawnLocation: 3, _rotateType: 1 }));
    const { w, spawned, view } = await wired({ foot, muzzle });
    const left = view({ visFacing: -1, dir: 'LEFT' });
    w.playOn('foot', left, {});
    w.playOn('muzzle', left, {});
    const [hf, hm] = spawned;
    assert.equal(hf.place.flipY, true, 'the tilted effect turns its rotation_y helper');
    nearV(hf.place.rootRot, GRAPHIC, 1e-6, '… under the tilt');
    const fx = drawn(foot, hf);
    near(fx.world[2][12] - fx.world[0][12], -0.3, 1e-6, 'its content mirrored to the left in the camera plane');
    assert.ok(dot(worldZ(fx, 2), CAM_FWD) < -0.9999, '… the plane still facing the camera (seen from behind)');
    assert.ok(hm.place.mountRot && !hm.place.flipY, 'MUZZLE_POINT takes the point\'s rotation, the facing turn included: no flip of its own');
  });

  test('a FollowMountPoint with `_keepOriginRotation` keeps its spawn location\'s tilt (the status loops); without it a FOOT point turns with the unit', async () => {
    const fmp = (mount, keep) => ({ class: 'FollowMountPoint', enabled: true, fields: { _mountPointType: mount, _keepOriginRotation: keep ? 1 : 0 } });
    const stun = compileEffect(standing({ _spawnLocation: 4 }, [fmp(3, true)]));
    const feet = compileEffect(standing({ _spawnLocation: 1 }, [fmp(0, false)]));
    const { w, spawned, view } = await wired({ stun, feet });
    const v = view({ visFacing: -1, dir: 'LEFT' });
    w.playOn('stun', v, { follow: true, loop: true });
    w.playOn('feet', v, { follow: true, loop: true });
    const [hs, hf] = spawned;
    nearV(hs.place.rootRot, GRAPHIC, 1e-6, 'kept: the HEAD_POINT spawn\'s tilt');
    assert.equal(hs.place.mountRot, null);
    // FOOT followed with its rotation: the face's skeleton root — the tilt and the facing turn (180° about the skeleton's up)
    const r = hf.place.mountRot;
    assert.ok(r, 'a FOOT FollowMountPoint without _keepOriginRotation takes the point\'s rotation');
    nearV(quatRotate(r, [1, 0, 0]), [-1, 0, 0], 1e-6, 'turned to face left');
    nearV(quatRotate(r, [0, 0, 1]), [0, -CAM_FWD[1], -CAM_FWD[2]], 1e-6, '… about the tilted up axis');
  });

  test('a point on the ground (a kit fx\'s tile, a projectile\'s target tile) is a map position: the prefab root keeps its own rotation', async () => {
    const def = compileEffect(standing({ _spawnLocation: 1 }));
    const { w, spawned } = await wired({ fx: def });
    w.playOn('fx', { id: 'fx:point', x: 5, y: 10, z: 0 }, {});
    assert.equal(spawned[0].place.rootRot, null, 'no rotation given (Effect._InitLocation)');
    assert.equal(spawned[0].place.mountRot, null);
  });

  test('a chained effect (OnPlayEmitter) takes its own spawn location\'s rotation, not its parent\'s', async () => {
    const child = compileEffect(standing({ _spawnLocation: 5 }));
    const parent = compileEffect(standing({ _spawnLocation: 1 }, [{ class: 'OnPlayEmitter', enabled: true, fields: { _effects: ['child'] } }]));
    const { w, spawned, view } = await wired({ parent, child });
    w.playOn('parent', view(), { follow: true, loop: true });
    const h = spawned[0];
    nearV(h.place.rootRot, GRAPHIC, 1e-6, 'the parent tilted');
    // system.js FxHandle._start hands the chained effect the parent's placement and track
    const fx = { def: child, anchor: h.place.pos.slice(), yaw: 0, mirror: false, flipY: false, mountRot: null, rootRot: h.place.rootRot.slice(), time: 0 };
    h.opts.track(fx);
    nearV(fx.rootRot, [0, 0, 0, 1], 1e-9, 'the chained GROUND_CENTER effect lies on the board');
    assert.equal(fx.mountRot, null);
  });
});

// ---- the renderer's pivot (DESIGN §33.6 m_Pivot) ---------------------------------------------------------------------

const CAM = cameraBasis(30, [0, -5, -8], 720, 0.7);
const QUAD = builtinMesh('Quad');

/** The quads (or mesh instances) one system draws one frame after its burst: [{ c: centre, ax, ay }]. */
function quads(node) {
  const lib = { mesh: (k) => (k === 'builtin:Quad' ? QUAD : null) };
  const fx = new Effect(compileEffect(desc([rootNode([pe({ _spawnLocation: 0 })]), node])), { seed: 1, lib }).place({ pos: [0, 0, 0], rootRot: [0, 0, 0, 1] });
  fx.update(1 / 30);
  const fd = new FrameData();
  const out = [];
  fx.collect(CAM, fd, (it) => {
    const mesh = it.kind === 'mesh', b = mesh ? fd.mesh : fd.quad, st = mesh ? 30 : 27;
    for (let k = 0; k < it.count; k++) { const o = (it.first + k) * st; out.push({ c: [b[o], b[o + 1], b[o + 2]], ax: [b[o + 3], b[o + 4], b[o + 5]], ay: [b[o + 6], b[o + 7], b[o + 8]] }); }
  }, 1);
  return out;
}

describe("a renderer's pivot", () => {
  test('moves a billboard by pivot × size along its own axes: a Y pivot of 0.5 stands it on its position (艾雅法拉 S2\'s flames rise)', () => {
    const [q] = quads(psNode(1, 0, { size: 1, r: { m_Pivot: [0, 0.5, 0] } }));
    nearV(q.c, [q.ay[0] * 0.5, q.ay[1] * 0.5, q.ay[2] * 0.5], 1e-6, 'the quad\'s centre half its height up the camera');
    assert.ok(q.ay[1] > 0 && q.ay[2] < 0, 'up the screen (+row, up from the board)');
  });

  test('a stretched billboard adds pivot × size: Y along the velocity, X across — the particle\'s Y size, not the stretched length', () => {
    const burst = { InitialModule: { startLifetime: 1, startSpeed: 6, startSize: 2, startColor: [1, 1, 1, 1], maxNumParticles: 10 } };
    const stretch = (pivot) => quads(psNode(1, 0, {
      r: { renderMode: 'stretch', m_LengthScale: 4, m_VelocityScale: 0, m_MaxParticleSize: 0, m_Pivot: pivot },
      ps: burst,
    }))[0];
    const z = stretch([0, 0, 0]);
    const y = stretch([0, 0.5, 0]);
    const x = stretch([0.5, 0, 0]);
    const len = Math.hypot(...z.ax);
    near(len, 8, 1e-3, 'length is size.y 2 × lengthScale 4');
    near(Math.hypot(...y.ax), len, 1e-4, 'a pivot does not change the stretched length');
    const along = z.ax.map((v) => v / len);
    nearV([y.c[0] - z.c[0], y.c[1] - z.c[1], y.c[2] - z.c[2]], along.map((v) => v * 1), 1e-4, 'Y pivot 0.5 × size.y 2 = 1 along the velocity, not half of the length 8');
    const across = z.ay.map((v) => v / (Math.hypot(...z.ay) || 1));
    nearV([x.c[0] - z.c[0], x.c[1] - z.c[1], x.c[2] - z.c[2]], across.map((v) => v * 1), 1e-4, 'X pivot 0.5 × size.x 2 across');
  });

  test('a mesh particle\'s pivot alike: 荒芜拉普兰德 S3\'s seal tips (a pivot of −0.5) reach out to the left of their node, their mirrored twins to the right', () => {
    const tip = (o) => psNode(1, 0, { size: 1, pos: o.pos, rot: o.rot, r: { renderMode: 'mesh', renderAlignment: 'local', m_Mesh: { builtin: 'Quad' }, m_Pivot: [-0.5, 0, 0] } });
    const left = quads(tip({ pos: [-0.1, 0, 0] }))[0];
    near(left.c[0], -0.6, 1e-6, 'left tip: its quad from x −1.1 to −0.1');
    const right = quads(tip({ pos: [0.1, 0, 0], rot: [0, 1, 0, 0] }))[0];   // 180° about Y
    near(right.c[0], 0.6, 1e-6, 'right tip (turned 180° about Y): from 0.1 to 1.1');
  });
});

// ---- a local-space particle's size follows its node's scale (DESIGN §33.5 scaling modes) -------------------------------

describe("the scaling mode's scale, as it is now", () => {
  /** A prefab whose clip grows node 1 from 0 to 1 over 0.5 s (荒芜拉普兰德 S3's seal discs: `s3_buffstart`). */
  const popIn = (space) => {
    const d = desc([rootNode([pe({ _spawnLocation: 0, _isLoop: 1 })]), psNode(1, 0, { size: 1.24, life: 4.8, space, scale: [0, 0, 0] })], {
      clips: [{ name: 'pop', length: 0.5, loop: false, curves: ['x', 'y', 'z'].map((c) => ({ node: 1, type: 'Transform', property: `localScale.${c}`, keys: [[0, 0, 2, 2], [0.5, 1, 2, 2]] })) }],
    });
    d.nodes[0].animator = { controller: 'c', clips: [0], default: 0, enabled: true };
    return d;
  };
  const sizeOn = (fx) => {
    const fd = new FrameData();
    let a = 0;
    fx.collect(CAM, fd, (it) => { for (let k = 0; k < it.count; k++) { const o = (it.first + k) * 27; a = Math.max(a, Math.hypot(fd.quad[o + 3], fd.quad[o + 4], fd.quad[o + 5])); } }, 1);
    return a;
  };
  test('a local-space particle born at the scale 0 of its node grows as the node does', () => {
    const fx = new Effect(compileEffect(popIn(0)), { seed: 1 }).place({ pos: [0, 0, 0], rootRot: [0, 0, 0, 1] });
    fx.update(1 / 60);
    assert.equal(fx.sys[1].count, 1, 'born in the first frame');
    for (let i = 0; i < 59; i++) fx.update(1 / 60);
    near(sizeOn(fx), 1.24, 1e-3, 'full size once the node is (it stayed 0 for its 4.8 s life)');
  });
  test('a world-space particle keeps the scale it was born at', () => {
    const fx = new Effect(compileEffect(popIn(1)), { seed: 1 }).place({ pos: [0, 0, 0], rootRot: [0, 0, 0, 1] });
    for (let i = 0; i < 60; i++) fx.update(1 / 60);
    near(sizeOn(fx), 0, 1e-6, 'born at 0');
  });
  test('per axis, sizes uniform or not: a quad on a node scaled (0.27, 4.2, 1) is a streak (娜仁图亚 S3\'s hit), the seal\'s tips (1, 0.7) are flat', () => {
    const mesh = (scale, space) => quads(psNode(1, 0, { size: 1.2, scale, space, r: { renderMode: 'mesh', renderAlignment: 'local', m_Mesh: { builtin: 'Quad' } } }))[0];
    for (const space of [0, 1]) {
      const q = mesh([0.269, 4.205, 1], space);
      near(Math.hypot(...q.ax), 1.2 * 0.269, 1e-6, `${space ? 'world' : 'local'} space: the quad's width`);
      near(Math.hypot(...q.ay), 1.2 * 4.205, 1e-6, `${space ? 'world' : 'local'} space: its height (it was drawn as wide)`);
    }
    const tip = mesh([1, 0.7, 1], 0);
    near(Math.hypot(...tip.ay) / Math.hypot(...tip.ax), 0.7, 1e-6, 'the seal tip\'s height / width');
    const b = quads(psNode(1, 0, { size: 1, scale: [2, 0.5, 1] }))[0];
    near(Math.hypot(...b.ax), 2, 1e-6, 'a view billboard: the x scale across the screen');
    near(Math.hypot(...b.ay), 0.5, 1e-6, 'the y scale up it');
  });
});

// ---- a boomerang comes back (index.json movement `comeBack`, the client's AdvancedMovement / ParacurveMovement.Comeback) ----

describe('a projectile whose movement comes back', () => {
  /** A wiring over a fake layer: a thrower (char_b) whose normal attack throws `proj`; fake effects record their track. */
  async function thrower(movement) {
    const index = { version: 3,
      units: { char_b: { kind: 'char', skin: 'char_b', refs: [], skills: {}, modes: [{ name: 'Default', attack: { class: 'RangedAttack', projectileKey: 'p_boom', mount: 'MUZZLE' } }] }, enemy_t: { kind: 'enemy', skin: 'enemy_t', refs: [], skills: {}, modes: [] } },
      skins: { char_b: { graphic: { rot: GRAPHIC }, points: { HitPoint: { all: { pos: [0, 0.232, -0.25] } }, Muzzle: { front: { pos: [0.3, 0.3, -0.2] } } } }, enemy_t: { points: { HitPoint: { all: { pos: [0, 0.3, -0.3] } } } } },
      projectiles: { p_boom: { main: 'boom_trail', lifeTime: 10, movement, onHit: ['boom_hit'], effects: ['boom_trail', 'boom_hit'], behaviours: [{ class: 'SimpleProjectile', fields: { _mainEffect: 'boom_trail', _lifeTimeType: 1, _lifeTime: 10 } }] } },
      skills: {}, generic: { hit: {} }, prefabs: {} };
    const DEFS = { boom_trail: { isLoop: true, flipIfLeft: false, proj: {} }, boom_hit: { spawn: 2 } };
    const spawned = [];
    const ofx = {
      active: true, time: 0, timers: [], ctx: { cam: () => ({ tilt: 30 }) },
      lib: { has: (k) => k in DEFS, def: (k) => DEFS[k] || null, index: async () => index, preload: async (keys) => keys.length, defs: new Map() },
      spawn(key, place, opts) {
        const fx = { key, def: DEFS[key], anchor: place.pos.slice(), yaw: 0, pitch: 0, mirror: false, time: 0, stopped: null, killed: false, stop(o = {}) { this.stopped = o; }, kill() { this.killed = true; } };
        const h = { key, place, opts, fx, alive: true, stop(o) { fx.stop(o); } };
        spawned.push(h);
        return h;
      },
    };
    const w = new FxWiring(ofx, { speed: (k) => (k === 'boomerangReturn' ? 3.75 : k === 'boomerang' ? 15 : 10), record: () => null });
    await w.ready();
    const view = (id, key, x, y) => ({ id, x, y, z: 0, visFacing: 1, isEnemy: /^enemy_/.test(key), alive: true, flags: 0, dir: 'RIGHT', info: { id, spine: key, defId: key, side: /^enemy_/.test(key) ? 'enemy' : 'ally', kind: 'op' } });
    return { w, ofx, spawned, src: view(1, 'char_b', 4, 10), tgt: view(2, 'enemy_t', 7, 10) };
  }
  const run = (h, t, ofx) => { ofx.time = t; h.fx.time = t; h.opts.track(h.fx); };

  test('跃跃\'s boomerang hits on its way out and flies back to her HitPoint at 3.75 tiles/s, its effect on until she catches it', async () => {
    const mv = { class: 'AdvancedMovement', moveType: 1, speed: 15, comeBack: 1, comeBackSpeedScale: 0.25, delayAfterReached: 0.01 };
    const { w, ofx, spawned, src, tgt } = await thrower(mv);
    assert.equal(w.attack(src, tgt, 'boomerang', 0), true, 'the official layer draws it (no procedural boomerang over it)');
    const h = spawned.find((x) => x.key === 'boom_trail');
    const out = 3 / 15;                                 // the sim's flight: 3 tiles at 15 tiles/s
    run(h, out * 0.5, ofx);
    assert.ok(h.fx.anchor[0] > -6 + 0.3 && h.fx.anchor[0] < -3, 'on its way out');
    run(h, out + 1e-6, ofx);
    assert.ok(spawned.some((x) => x.key === 'boom_hit'), 'its hit on the target');
    assert.equal(h.fx.stopped, null, 'it does not stop at the hit');
    const back = 3 / 3.75;                              // and back: 3 tiles at 3.75 tiles/s
    run(h, out + back * 0.5, ofx);
    near(h.fx.anchor[0], -3 + (-6 - -3) * 0.5, 0.02, 'half way back');
    assert.ok(Math.cos(h.fx.yaw) < -0.99, `turned towards her (yaw ${h.fx.yaw.toFixed(3)})`);
    assert.equal(h.fx.stopped, null, 'still flying');
    run(h, out + back + 1e-3, ofx);
    near(h.fx.anchor[0], -6, 1e-6, 'caught at her HitPoint');
    near(h.fx.anchor[1], 1 + 0.232, 1e-6, '… (its height on the board)');
    assert.ok(h.fx.killed && !h.fx.stopped, 'and it ends there, at once (its prefab has no `_delayToFinish` to linger)');
    assert.equal(spawned.filter((x) => x.key === 'boom_hit').length, 1, 'one hit, on the way out only');
  });

  test('a thrower who moves is followed at 3.75 tiles/s, not rubber-banded onto the duration locked at the turn', async () => {
    const mv = { class: 'AdvancedMovement', moveType: 1, speed: 15, comeBack: 1, comeBackSpeedScale: 0.25 };
    const { w, ofx, spawned, src, tgt } = await thrower(mv);
    tgt.x = 8;                                            // 4 tiles out (the locked ETA is 4 / 3.75 = 1.067 s)
    w.attack(src, tgt, 'boomerang', 0);
    const h = spawned.find((x) => x.key === 'boom_trail');
    const out = 4 / 15, eta = 4 / 3.75;
    run(h, out + 1e-6, ofx);
    const turn = h.fx.anchor.slice();
    let maxSp = 0, prev = turn.slice(), prevT = out + 1e-6;
    const N = 32;
    for (let i = 1; i <= N; i++) {
      src.x = 4 - 2 * (i / N);                            // +2 tiles away over that ETA, then she stops
      const t = out + eta * (i / N);
      run(h, t, ofx);
      const sp = Math.hypot(h.fx.anchor[0] - prev[0], h.fx.anchor[1] - prev[1]) / (t - prevT);
      if (sp > maxSp) maxSp = sp;
      prev = h.fx.anchor.slice(); prevT = t;
    }
    const travelled = Math.hypot(h.fx.anchor[0] - turn[0], h.fx.anchor[1] - turn[1]);
    assert.equal(h.fx.killed, false, 'not caught when the locked duration runs out');
    near(travelled, 4, 0.08, '4 tiles covered, not the 6 to where she went');
    assert.ok(maxSp < 4.05, `the come-back speed stays 3.75 (peak ${maxSp.toFixed(2)}; a locked duration peaks near 7)`);
    near(h.fx.anchor[0], -6, 0.15, 'about 2 tiles short of her (unity x −8)');
    let caughtAt = null;
    for (let i = 1; i <= 40; i++) {
      const t = out + eta + (2 / 3.75) * (i / 20);
      run(h, t, ofx);
      if (h.fx.killed) { caughtAt = t - out; break; }
    }
    assert.ok(caughtAt > 1.45 && caughtAt < 1.75, `caught near 1.60 s (at ${caughtAt})`);
    near(h.fx.anchor[0], -8, 1e-4, 'at her HitPoint, where she stopped');
    near(h.fx.anchor[1], 1 + 0.232, 1e-4, '… (its height on the board)');
    assert.equal(spawned.filter((x) => x.key === 'boom_hit').length, 1, 'one hit, on the way out only');
  });

  test('a thrower gone at the hit gets nothing back; a projectile that does not come back stops at its hit as before', async () => {
    const mv = { class: 'AdvancedMovement', moveType: 1, speed: 15, comeBack: 1, comeBackSpeedScale: 0.25 };
    const a = await thrower(mv);
    a.w.attack(a.src, a.tgt, 'boomerang', 0);
    const h = a.spawned.find((x) => x.key === 'boom_trail');
    a.src.alive = false;
    run(h, 0.2 + 1e-6, a.ofx);
    assert.deepEqual(h.fx.stopped, {}, 'stopped at the hit');
    const b = await thrower({ class: 'AdvancedMovement', moveType: 1, speed: 15 });
    b.w.attack(b.src, b.tgt, 'arrow', 0);
    const g = b.spawned.find((x) => x.key === 'boom_trail');
    run(g, 0.3 + 1e-6, b.ofx);
    assert.deepEqual(g.fx.stopped, { hit: true });
  });

  test('a Paracurve boomerang (跃跃 S2) comes back along its arc', async () => {
    const mv = { class: 'ParacurveMovement', speed: 15, raiseHeight: 0.3, noRaiseHeightThreshold: 1.3, comeBack: 1, comeBackSpeedScale: 0.25 };
    const { w, ofx, spawned, src, tgt } = await thrower(mv);
    w.attack(src, tgt, 'boomerang', 0);
    const h = spawned.find((x) => x.key === 'boom_trail');
    run(h, 0.2 + 1e-6, ofx);
    let top = -Infinity;
    for (let i = 1; i < 40; i++) { run(h, 0.2 + (0.8 * i) / 40, ofx); top = Math.max(top, -h.fx.anchor[2]); }
    const start = 0.3 * Math.sin(Math.PI / 6);   // the target's HitPoint height
    assert.ok(top > start + 0.25, `rises on its way back too (top ${top.toFixed(3)})`);
  });
});
