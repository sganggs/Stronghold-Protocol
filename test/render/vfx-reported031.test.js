// Original synthetic fixtures for §34.31; no extracted official files or artwork.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FxWiring } from '../../public/js/render/vfx/wiring.js';
import { compileEffect, Effect } from '../../public/js/render/vfx/effect.js';
import { FrameData, cameraBasis } from '../../public/js/render/vfx/geom.js';
import { fragmentSource, FAMILIES } from '../../public/js/render/vfx/glsl.js';
import { yuWallLayout } from '../../public/js/render/vfx/yuwall.js';
import { FxSystem } from '../../public/js/render/fx.js';
import { UF } from '../../shared/constants.js';
import { installFakePixi, fakeViewCtx } from './fakepixi.js';
import { presetCamera } from '../../public/js/render/projection.js';

const YU = 'char_2026_yu', TOKEN = 'token_10030_mlyss_wtrman';
const SOURCE = 'yu_skill3_range_01_source', ROOT = 'yu_skill3_range_01_root';
const row = (key, extra = {}) => ({ effects: [key], directionType: 0, startEvent: 2, endEvent: 3, oneshot: 0, ...extra });
const prefab = (key, behaviours = []) => compileEffect({ key, nodes: [{ id: 0, parent: null, active: true, pos: [0, 0, 0], rot: [0, 0, 0, 1], scale: [1, 1, 1], behaviours }], materials: [] });
const beh = (cls, fields) => ({ class: cls, enabled: true, fields });
const rect = { r0: 9, r1: 12, c0: 0, c1: 10 };
async function setup(field = rect) {
  const defs = new Map([
    ['lance', prefab('lance', [beh('ParticleEffect', { _rotateType: 2, _mainDir: 1, _spawnLocation: 5 })])],
    [SOURCE, prefab(SOURCE, [beh('YuS3EffectBehaviour', { _effectEachGrid: ROOT })])],
    [ROOT, prefab(ROOT, [beh('YuS3EffectWithEdgeBehaviour', {
      _offset: 0.4, _edgeEffectInterval: 2, _edgeEffectIntervalFirstTick: 0.05,
      _effectWhenHorizontal: 'horizontal', _effectVerticalWhenAtWorldLeft: 'vertical_l', _effectVerticalWhenAtWorldRight: 'vertical_r',
      _effectEdgeWhenHorizontalLeft: 'left_end', _effectEdgeWhenHorizontalRight: 'right_end',
      _effectEdgeWhenVerticalWorldLeftUp: 'lu_end', _effectEdgeWhenVerticalWorldLeftDown: 'ld_end',
      _effectEdgeWhenVerticalWorldRightUp: 'ru_end', _effectEdgeWhenVerticalWorldRightDown: 'rd_end',
    })])],
  ]);
  for (const key of ['horizontal', 'vertical_l', 'vertical_r', 'left_end', 'right_end', 'lu_end', 'ld_end', 'ru_end', 'rd_end', 'yu_skill3_annex_01', 'melee_cast', 'ranged_cast', 'combat_hit']) defs.set(key, prefab(key));
  const index = { version: 3, skins: {}, generic: {}, projectiles: {}, prefabs: Object.fromEntries([...defs.keys()].map((k) => [k, {}])), units: {
    [YU]: { kind: 'char', modes: [{ name: 'Default' }], skills: {} },
    [TOKEN]: { kind: 'token', skills: {}, modes: [
      { name: 'Default', attack: { class: 'MeleeAttack', cast: [row('ball')] } },
      { name: 'Melee', attack: { class: 'MeleeAttack', cast: [row('melee_cast')], hit: [row('combat_hit')] } },
      { name: 'Range', attack: { class: 'MeleeAttack', cast: [row('ranged_cast')] } },
    ] },
  }, skills: { skchr_yu_3: { rootClass: 'CastSkill', uses: [
    { role: 'start', keys: [SOURCE], from: 'BuffToOwner._buffs', on: 'owner' },
    { role: 'hit', keys: ['yu_skill3_annex_01'], from: 'ProjectileProbElimateBehaviour._effectOnEliminatePos' },
    { role: 'trigger', keys: ['yu_skill3_annex_02'], from: 'GlobalAuraAbility._buffs', on: 'targets', event: 'ON_TAKE_DAMAGE' },
  ] } } };
  const views = new Map(), handles = [];
  const ofx = { active: true, time: 0, timers: [], ctx: { fieldRect: () => field, heightAt: () => 0, cam: () => ({ position: () => ({ x: 10 }) }) },
    lib: { defs, index: async () => index, def: (k) => defs.get(k), has: (k) => defs.has(k), preload: async () => 0 },
    spawn(key, place, opts) { const h = { key, place, opts, alive: true, stop() { this.alive = false; }, kill() { this.alive = false; } }; handles.push(h); return h; },
  };
  const w = new FxWiring(ofx, { view: (id) => views.get(id), record: (info) => info.spine === YU ? { skill: { skillId: 'skchr_yu_3', duration: 45, skillType: 'MANUAL' } } : null });
  await w.ready();
  const view = (id, spine, dir = 'RIGHT') => {
    const v = { id, x: 4, y: 10, z: 0, dir, visFacing: dir === 'LEFT' ? -1 : 1, flags: 0, alive: true, info: { id, spine, defId: spine, kind: spine === TOKEN ? 'token' : 'op', skillIndex: 2 } };
    views.set(id, v); return v;
  };
  return { w, ofx, handles, view, defs };
}

test('Wild Mane S2 cast follows four-direction facing, independently of target row/side', async () => {
  const { w, handles, view } = await setup();
  for (const [dir, yaw] of [['RIGHT', 0], ['LEFT', Math.PI], ['UP', Math.PI / 2], ['DOWN', -Math.PI / 2]]) {
    const src = view(1, 'wild', dir);
    for (const y of [src.y - 1, src.y + 1]) {
      w._casts({ cast: [row('lance', { useFourDirectionalFace: 1 })] }, src, { x: src.x - 2, y }, 'start');
      const p = handles.at(-1).place;
      assert.ok(Math.abs(p.yaw - yaw) < 1e-6, `${dir}, target row ${y}: ${p.yaw}`);
      assert.equal(p.mirror || p.flipY, false);
    }
  }
});

test('Yu S3 creates per-tile wall pieces and holds them until skill end', async () => {
  const { w, handles, view, ofx } = await setup();
  const yu = view(1, YU);
  w.skill(yu, true);
  ofx.time = 1; w.tick();
  const parts = handles.filter((h) => h.key === 'vertical_l');
  assert.equal(parts.length, 4, 'the empty source controller must assemble the wall');
  assert.ok(parts.every((h) => Math.abs(h.place.pos[0] - (4.4 - 10)) < 1e-6));
  ofx.time = 44; w.tick();
  assert.ok(parts.every((h) => h.alive));
  w.skill(yu, false);
  assert.ok(parts.every((h) => !h.alive));
});

test('the shared 2D/3D Manifold view keeps its copied form with official effects off or on, including S3', async () => {
  const fake = installFakePixi();
  try {
    const { UnitView } = await import('../../public/js/render/units.js');
    for (const active of [false, true]) {
      const v = new UnitView(fakeViewCtx(fake.P, { cam: () => presetCamera('normal', { width: 1280, height: 720 }) }), { id: 4, kind: 'token', side: 'ally', spine: TOKEN, defId: TOKEN, maxHp: 100 });
      const attacks = [];
      v.actor = { roles: { attack: { loop: 'Attack' } }, setForm(roles) { this.roles = roles; }, attack() { attacks.push(this.roles.attack?.loop); }, setSkill() {} };
      v.onAttack(null, 1, 'none');
      v.setSkill(true);
      v.onAttack(null, 2, 'none');
      v.onAttack(null, 3, 'bolt');
      assert.deepEqual(attacks, ['A_Attack', 'A_Attack', 'B_Attack']);
      const { w, ofx } = await setup(); ofx.active = active;
      assert.equal(w.mode(w.idx.units[TOKEN], v)?.name, 'Range');
    }
  } finally { fake.restore(); }
});

test('Manifold SpineActor keeps A/B clips across skill toggles and model creation after a copy', async () => {
  const fake = installFakePixi();
  try {
    const { UnitView } = await import('../../public/js/render/units.js');
    const names = ['Idle_1', 'Start', 'Stun', 'Die', 'Attack', 'A_Idle', 'A_Attack', 'A_Combat', 'A_Stun', 'A_Start', 'B_Idle', 'B_Attack', 'B_Combat', 'B_Stun', 'B_Start', 'B_Die', 'Change_A', 'Change_B'];
    const entry = { animations: Object.fromEntries(names.map((n) => [n, 0.5])), hits: { A_Attack: [0.1], B_Attack: [0.1] },
      anims: { idle: 'A_Idle', deploy: 'Start', die: 'Die', attack: { loop: 'Attack' }, skill: { loop: 'Attack', via: 'attack', index: 0 } } };
    const assets = { picture: () => null, image: async () => null, spineEntry: () => entry,
      spine: { acquire: async () => ({ animations: names.map((name) => ({ name })) }), release() {} } };
    for (const [position, prefix] of [['MELEE', 'A'], ['RANGED', 'B']]) {
      const v = new UnitView(fakeViewCtx(fake.P, { assets, cam: () => presetCamera('normal', { width: 1280, height: 720 }) }), { id: 4, kind: 'token', side: 'ally', spine: TOKEN, defId: TOKEN, maxHp: 100 });
      v.copyFrom({ position }); // copy arrives before the model resolves
      await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
      assert.ok(v.actor); assert.equal(v.actor.roles.idle, `${prefix}_Idle`);
      for (const on of [false, true, false]) {
        v.setSkill(on);
        assert.equal(v.actor._attackClip().loop, `${prefix}_Attack`);
      }
      v.destroy();
    }
  } finally { fake.restore(); }
});

test('the lance streak pivot projects forward for both facings and both vertical directions', async () => {
  // Original geometric fixture for the failure class: a behind-origin quad with a positive X pivot.
  // v0.3.0 geom.js:295 subtracted it; §34.6 already fixes the shared math. The authored helper's
  // quarter-turn must be REPLACED, not added to ParticleEffect.FaceTo's direction.
  const node = (id, parent, pos = [0, 0, 0]) => ({ id, parent, children: [], active: true, pos, rot: [0, 0, 0, 1], scale: [1, 1, 1] });
  const root = node(0, null), helper = node(1, 0), particle = node(2, 1, [-1, 0, 0]);
  root.children = [1]; helper.children = [2]; helper.rot = [0, 0, Math.SQRT1_2, Math.SQRT1_2];
  root.behaviours = [beh('ParticleEffect', { _rotateType: 2, _mainDir: 1, _spawnLocation: 5, _rotationZ: { node: 1 } })];
  particle.particleSystem = { lengthInSec: 1, looping: false, playOnAwake: true, simulationSpeed: 1, moveWithTransform: 0, scalingMode: 1,
    InitialModule: { startLifetime: 1, startSpeed: 0, startSize: 2, startColor: [1, 1, 1, 1], maxNumParticles: 4 },
    EmissionModule: { rateOverTime: 0, m_Bursts: [{ time: 0, countCurve: 1, cycleCount: 1, probability: 1 }] } };
  particle.particleSystemRenderer = { m_Enabled: true, renderMode: 'billboard', renderAlignment: 'local', m_Pivot: [1, 0, 0], materials: [0] };
  const d = compileEffect({ key: 'lance', nodes: [root, helper, particle], materials: [{ shader: 'Torappu/Particles/Additive', floats: {}, colors: {}, textures: {} }] });
  const { w, defs, handles, view } = await setup(); defs.set('lance', d);
  for (const [dir, dx, dy] of [['RIGHT', 1, 0], ['LEFT', -1, 0], ['UP', 0, 1], ['DOWN', 0, -1]]) {
    for (const rowOffset of [-1, 1]) {
      const v = view(1, 'wild', dir);
      w._casts({ cast: [row('lance', { useFourDirectionalFace: 1 })] }, v, { x: v.x + dx, y: v.y + rowOffset }, 'start');
      const p = handles.at(-1).place, fx = new Effect(d, { seed: 1 }).place(p), fd = new FrameData();
      fx.update(0.1);
      let drew = false;
      fx.collect(cameraBasis(30, [0, -5, -8], 720, 0.7), fd, (it) => {
        const off = it.first * 27, x = fd.quad[off] - p.pos[0], y = fd.quad[off + 1] - p.pos[1];
        assert.ok(x * dx + y * dy > 0.9, `${dir}: streak centre (${x}, ${y}) must be in front`);
        drew = true;
      }, 1);
      assert.ok(drew);
    }
  }
});

test('Yu wall layout covers normal, unite and boss fields in all four directions with matching caps', async () => {
  const { defs } = await setup();
  const cfg = defs.get(ROOT).nodes[0].behaviours[0].fields;
  for (const r of [rect, { r0: 9, r1: 12, c0: 0, c1: 20 }, { r0: 0, r1: 5, c0: 10, c1: 20 }]) {
    for (const dir of ['UP', 'DOWN', 'LEFT', 'RIGHT']) for (const cameraX of [-1, 30]) {
      const x = r.c0 + 2, y = r.r0 + 1, horizontal = ['UP', 'DOWN'].includes(dir), side = cameraX < x ? 'r' : 'l';
      const ps = yuWallLayout({ x, y, dir }, r, cfg, cameraX), roots = ps.filter((p) => p.root), pieces = ps.filter((p) => !p.root && !p.edge), ends = ps.filter((p) => p.edge);
      assert.equal(roots.length, horizontal ? r.c1 - r.c0 + 1 : r.r1 - r.r0 + 1);
      assert.equal(pieces.length, roots.length);
      assert.ok(pieces.every((p) => p.key === (horizontal ? 'horizontal' : `vertical_${side}`)));
      assert.equal(ends.length, 2);
      assert.deepEqual(ends.map((p) => p.key), horizontal ? ['left_end', 'right_end'] : [`${side}d_end`, `${side}u_end`]);
      const off = ['LEFT', 'DOWN'].includes(dir) ? -0.4 : 0.4;
      assert.ok(pieces.every((p) => Math.abs((horizontal ? p.y - y : p.x - x) - off) < 1e-6));
      assert.deepEqual(ends.map((p) => horizontal ? p.x : p.y), horizontal ? [r.c0 - 1, r.c1 + 1] : [r.r0 - 1, r.r1 + 1]);
    }
  }
  assert.deepEqual(yuWallLayout({ x: 50, y: 10 }, rect, cfg), []);
});

test('Yu wall survives delayed controller loads and stops on death, retreat, clear or skill off', async () => {
  for (const end of ['death', 'retreat', 'clear', 'skill']) {
    const { w, ofx, view, handles, defs } = await setup();
    const source = defs.get(SOURCE), root = defs.get(ROOT); defs.delete(SOURCE); defs.delete(ROOT);
    ofx.lib.has = (k) => k === SOURCE || k === ROOT || defs.has(k);
    const yu = view(1, YU);
    w.skill(yu, true); assert.equal(handles.length, 0);
    defs.set(SOURCE, source); defs.set(ROOT, root); ofx.time = 1; w.tick();
    assert.equal(handles.length, 10);
    assert.ok(handles.every((h) => h.opts.loop && !h.opts.data?.boardClip), 'the whole curtain draws, unclipped');
    if (end === 'death') yu.alive = false;
    else if (end === 'retreat') w.release(yu);
    else if (end === 'clear') w.clear();
    else w.skill(yu, false);
    w.tick(); assert.ok(handles.every((h) => !h.alive), end);
    ofx.time = 50; w.tick(); assert.equal(handles.length, 10, 'no orphan respawns');
  }
  const { w, ofx, view, handles, defs } = await setup();
  const root = defs.get(ROOT); defs.delete(ROOT);
  const yu = view(1, YU); w.skill(yu, true); w.skill(yu, false);
  defs.set(ROOT, root); ofx.time = 2; w.tick();
  assert.equal(handles.length, 0, 'a controller stopped before loading must never spawn');
});

test('Yu binds annex_01 only to firewallBlock; annex_02 has no matching event', async () => {
  const { w, view, handles } = await setup(); const yu = view(1, YU);
  w.skill(yu, true);
  const p = w.skills.state(yu).plan;
  assert.ok(!p.each.hit.flat().some((e) => e.key === 'yu_skill3_annex_01'));
  assert.ok(!p.trigger.some((e) => e.key === 'yu_skill3_annex_02'));
  assert.ok(p.unmapped.some((e) => e.key === 'yu_skill3_annex_02'));
  assert.equal(w.simFx('firewallBlock', 7, 11, { id: yu.id }), true);
  assert.equal(handles.at(-1).key, 'yu_skill3_annex_01');
  assert.equal(handles.at(-1).opts.loop, false);
  assert.deepEqual(handles.at(-1).place.pos.slice(0, 2), [-3, 2]);
  assert.equal(handles.filter((h) => h.key === 'yu_skill3_annex_01').length, 1);
});

test('no effect shader family discards by a board rectangle (the wall draws whole, as in the official video)', () => {
  for (const family of Object.keys(FAMILIES)) assert.ok(!fragmentSource(family).includes('u_BoardClip'));
});

test('Manifold copy chooses official cast/hit rows, never a base ball projectile', async () => {
  const fake = installFakePixi();
  try {
    const { UnitView } = await import('../../public/js/render/units.js');
    const v = new UnitView(fakeViewCtx(fake.P), { id: 4, kind: 'token', side: 'ally', spine: TOKEN, defId: TOKEN, maxHp: 100 });
    const attacks = []; v.actor = { roles: {}, setForm(roles) { this.roles = roles; }, attack() { attacks.push(this.roles.attack.loop); }, setSkill() {} };
    const { w, view, handles } = await setup(); const t = view(2, 'enemy'); t.isEnemy = true;
    for (const [position, kind, key] of [['MELEE', 'none', 'melee_cast'], ['RANGED', 'bolt', 'ranged_cast']]) {
      v.copyFrom({ position });
      v.setSkill(true); v.onAttack(t, 1, kind);
      assert.equal(w.attack(v, t, kind, 1), true);
      assert.equal(handles.at(-1).key, key);
      assert.equal(w.flights.size, 0);
      w.tick();
    }
    v.flags = UF.BLOCKED; v.onAttack(t, 2, 'none');
    assert.equal(attacks.at(-1), 'A_Combat');
    assert.ok(!handles.some((h) => h.key === 'ball' || h.key.includes('_c0')));
  } finally { fake.restore(); }
});

test('2D/off firewall footprint stays until the skill ends or the owner leaves', () => {
  for (const end of ['skill', 'death', 'retreat']) {
    const owner = { alive: true, statuses: new Set(['skill']), dir: 'RIGHT', x: 4, y: 10 };
    const polygons = [], fx = Object.create(FxSystem.prototype);
    Object.assign(fx, { ctx: { cam: () => ({ project(x, y, z, p) { return Object.assign(p, { x, y, s: 1 }); } }), fieldRect: () => rect, timeScale: () => 1, view: () => owner, heightAt: () => 0 },
      _p: {}, tileFlashes: [], tileGfx: { clear() {}, lineStyle() {}, beginFill() {}, endFill() {}, drawPolygon(p) { polygons.push(p); } } });
    fx.simFx('firewall', 4, 10, { id: 1, axis: 'col', dir: 'RIGHT' });
    fx._updateTileFlashes(44);
    assert.equal(fx.tileFlashes.length, 1); assert.equal(polygons.length, 4);
    assert.ok(polygons.flat().every(Number.isFinite));
    assert.ok(polygons.every((p) => p[0] > 4.3 && p[2] < 4.5));
    if (end === 'skill') owner.statuses.clear(); else if (end === 'death') owner.alive = false; else owner.destroyed = true;
    fx._updateTileFlashes(0.1); assert.equal(fx.tileFlashes.length, 0);
  }
});
