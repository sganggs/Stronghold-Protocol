// test/render/vfx-r88-g2.test.js — round 88 lane g2.
//
// 魔王: RotateAroundMovement orbits one body per snapshot mote. S1 does not add a second orbit.
// S2 swaps to the slow projectile, S3 to its own trail. 官方特效 off spawns nothing and MoteRing still builds.
// 真言 S3: BouncedAdvancedMovement moveType 1 is a straight hop, not an arc. mantraArc is the first
// landing's onHit. mantraHop follows the kit endpoints. 官方特效 off spawns nothing; the procedural
// mantraArc bolt stays in the kind table.
// The art pack is absent on CI: the real-index assertions skip when public/assets/local/fx/index.json is missing.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FxWiring } from '../../public/js/render/vfx/wiring.js';
import { FX_BINDINGS, bindingKeys } from '../../public/js/render/vfx/skills.js';
import { fxSpec } from '../../public/js/render/fx/kinds.js';
import { unityToBoard } from '../../public/js/render/vfx/math.js';
import { UF } from '../../shared/constants.js';
import {
  CETSYR_ORBIT, cetsyrOrbitKey, orbitMotion, orbitOffset,
} from '../../public/js/render/vfx/orbitfx.js';
import { bounceMotion, bounceSegments, bounceAt } from '../../public/js/render/vfx/bouncefx.js';

const TALENT = 'cetsyr_trail_01';
const S2_TRAIL = 'cetsyr_skill_02_trail_01';
const S3_TRAIL = 'cetsyr_skill_03_trail_01';
const S2_HIT = 'cetsyr_skill_02_hit_01';
const HIT = 'cetsyr_hit_01';
const BOUNCE_TRAIL = 'mantra_bounce_trail_01';
const BOUNCE_HIT = 'mantra_bounce_hit_01';
const ALL = [TALENT, S2_TRAIL, S3_TRAIL, S2_HIT, HIT, BOUNCE_TRAIL, BOUNCE_HIT];

const around = (main, onHit, speed) => ({
  main, onHit: [onHit], lifeTime: 20,
  movement: { class: 'RotateAroundMovement', aroundSpeed: speed, projectileAroundRadius: 1, clockwise: 0 },
});

function makeIndex(installed = ALL) {
  const prefabs = Object.fromEntries(installed.map((k) => [k, { file: `prefabs/${k}.json`, looping: k.endsWith('trail_01'), spawn: 0 }]));
  const skill = (projectiles) => ({
    rootClass: 'CastSkill', rootAbility: 'ActiveBuffAbility', effects: [], projectiles, mode: null,
    abilities: [], unclassified: [], roles: {}, uses: [],
  });
  const c1 = skill(['projectile_chr_cetsyr_talent_s1']);
  const c2 = skill(['projectile_chr_cetsyr_talent', 'projectile_chr_cetsyr_talent_s2']);
  const c3 = skill(['projectile_chr_cetsyr_talent', 'projectile_chr_cetsyr_talent_s3']);
  const m3 = skill(['projectile_chr_mantra_s3_2']);
  const unit = (skills) => ({ kind: 'char', talents: {}, startEffect: null, deadEffect: null, skills, modes: [{ name: 'Default', attack: null, combat: null }] });
  return {
    units: {
      char_4134_cetsyr: unit({ skchr_cetsyr_1: c1, skchr_cetsyr_2: c2, skchr_cetsyr_3: c3 }),
      char_4204_mantra: unit({ skchr_mantra_3: m3, skchr_mantra_2: skill([]) }),
    },
    skills: { skchr_cetsyr_1: c1, skchr_cetsyr_2: c2, skchr_cetsyr_3: c3, skchr_mantra_3: m3, skchr_mantra_2: skill([]) },
    projectiles: {
      projectile_chr_cetsyr_talent: around(TALENT, HIT, 150),
      projectile_chr_cetsyr_talent_s1: around(TALENT, HIT, 150),
      projectile_chr_cetsyr_talent_s2: around(S2_TRAIL, S2_HIT, 0.01),
      projectile_chr_cetsyr_talent_s3: around(S3_TRAIL, HIT, 150),
      projectile_chr_mantra_s3_2: {
        main: BOUNCE_TRAIL, onHit: [BOUNCE_HIT], lifeTime: 0,
        movement: { class: 'BouncedAdvancedMovement', moveType: 1, speed: 30, speedAfterFirstReach: 4, comeBack: 0 },
      },
    },
    skins: {}, generic: { hit: {}, die: {}, birth: {}, status: {}, keys: [] }, prefabs,
  };
}

const SKILL_OF = {
  char_4134_cetsyr: ['skchr_cetsyr_1', 'skchr_cetsyr_2', 'skchr_cetsyr_3'],
  char_4204_mantra: ['skchr_mantra_1', 'skchr_mantra_2', 'skchr_mantra_3'],
};

async function setup({ installed = ALL, active = true } = {}) {
  const index = makeIndex(installed);
  const handles = [];
  const ofx = {
    active, time: 0, lite: false, tier: active ? 'full' : 'off', timers: [],
    lib: {
      has: (k) => !!index.prefabs[k],
      def: (k) => (index.prefabs[k] ? { isLoop: index.prefabs[k].looping, spawn: index.prefabs[k].spawn } : null),
      index: async () => index, preload: async (keys) => keys.length, defs: new Map(),
    },
    spawn(key, place, opts) {
      if (!this.active) return null;
      const h = {
        key, place, opts, time: 0, anchor: place.pos ? place.pos.slice() : [0, 0, 0], yaw: 0, stopped: null,
        get alive() { return !this.stopped; }, stop(o = {}) { this.stopped = o; }, kill() { this.stopped = { killed: true }; },
      };
      handles.push(h);
      return h;
    },
  };
  const views = new Map();
  let seq = 1;
  const w = new FxWiring(ofx, {
    speed: () => 10,
    record: (info) => {
      const ids = SKILL_OF[info.defId] || [];
      const index = Number.isInteger(info.skillIndex) ? info.skillIndex : 0;
      return { charId: info.defId, skill: { skillId: ids[index], index, duration: 30 } };
    },
    view: (id) => views.get(id) || null,
  });
  await w.ready();
  const view = (defId, x, y, extra = {}) => {
    const id = seq++;
    const { info: infoExtra, ...rest } = extra;
    const v = {
      id, x, y, z: 0, visFacing: 1, isEnemy: false, alive: true, flags: 0, sp: 0, spMax: 30,
      dir: 'RIGHT', gameT: 0, motes: null, officialMotes: false,
      ...rest,
      info: { id, spine: defId, defId, side: 'ally', kind: 'op', skillIndex: 0, ...infoExtra },
    };
    views.set(id, v);
    return v;
  };
  const track = () => {
    for (const h of handles) if (!h.stopped && typeof h.opts?.track === 'function') h.opts.track(h);
  };
  return { w, ofx, view, handles, track, index, keys: () => handles.filter((h) => h.alive).map((h) => h.key) };
}

const boardOf = (h) => {
  const p = unityToBoard(h.anchor[0], h.anchor[1], h.anchor[2]);
  return { x: p[0], y: p[1] };
};

describe('orbit math', () => {
  const motion = orbitMotion(around(TALENT, HIT, 150));

  test('radius and speed are the reviewed MoteRing orbit, not the record', () => {
    // the record says 150°/s and radius 1; the sim and render/motes.js orbit at dynamic_spd 30°/s, 1.15 tiles
    assert.equal(motion.radius, 1.15);
    assert.equal(motion.degPerSec, 30);
    assert.equal(motion.record.degPerSec, 150);
    assert.equal(motion.record.radius, 1);
    assert.equal(motion.clockwise, false);
    const r = motion.radius;
    const a = orbitOffset(0, 0, 1, motion);
    assert.ok(Math.abs(a.x - r) < 1e-9 && Math.abs(a.y) < 1e-9);
    const q = orbitOffset(3, 0, 1, motion);
    assert.ok(Math.abs(q.x) < 1e-9 && Math.abs(q.y - r) < 1e-9, '90° in 3 s');
    const full = orbitOffset(12, 0, 1, motion);
    assert.ok(Math.abs(full.x - r) < 1e-9 && Math.abs(full.y) < 1e-9, 'one turn in 12 s (MOTE_PERIOD)');
    const wide = orbitMotion(around(TALENT, HIT, 150), true);
    assert.equal(wide.radius, 2, "S2's outside_radius");
  });

  test('three motes sit 120° apart', () => {
    const pts = [0, 1, 2].map((i) => orbitOffset(0, i, 3, motion));
    assert.ok(Math.abs(pts[1].x - (-0.5 * motion.radius)) < 1e-9);
    assert.ok(Math.abs(pts[1].y - Math.sin(2 * Math.PI / 3) * motion.radius) < 1e-9);
    const side = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    const side2 = Math.hypot(pts[1].x - pts[2].x, pts[1].y - pts[2].y);
    assert.ok(Math.abs(side - side2) < 1e-9);
  });

  test('clockwise reverses the turn', () => {
    const cw = { ...motion, clockwise: true };
    const q = orbitOffset(3, 0, 1, cw);
    assert.ok(Math.abs(q.x) < 1e-9 && Math.abs(q.y - (-motion.radius)) < 1e-9);
  });

  test('a non-orbit movement is not played', () => {
    assert.equal(orbitMotion({ movement: { class: 'AdvancedMovement', speed: 10 }, main: 'x' }), null);
  });

  test('swap rules: S1 keeps the talent orbiter, S2 and S3 replace it', () => {
    assert.equal(cetsyrOrbitKey('skchr_cetsyr_1', true), CETSYR_ORBIT.talent);
    assert.notEqual(cetsyrOrbitKey('skchr_cetsyr_1', true), CETSYR_ORBIT.s1);
    assert.equal(cetsyrOrbitKey('skchr_cetsyr_2', false), CETSYR_ORBIT.talent);
    assert.equal(cetsyrOrbitKey('skchr_cetsyr_2', true), CETSYR_ORBIT.s2);
    assert.equal(cetsyrOrbitKey('skchr_cetsyr_3', true), CETSYR_ORBIT.s3);
    assert.equal(cetsyrOrbitKey(null, true), CETSYR_ORBIT.talent);
    // S2's record says 0.01°/s; the trail still turns with the snapshot's orbit (30°/s, wide radius 2), as MoteRing
    const s2 = orbitMotion(around(S2_TRAIL, S2_HIT, 0.01), true);
    assert.equal(s2.degPerSec, 30);
    assert.equal(s2.radius, 2);
    assert.equal(s2.main, S2_TRAIL);
  });
});

describe('魔王 orbit player', () => {
  test('snapshot motes rebuild the talent orbit, and each skill uses its own projectile', async () => {
    const { w, view, handles, track, keys } = await setup();
    const her = view('char_4134_cetsyr', 5, 10, { gameT: 0, motes: { n: 3, wide: 0 } });
    w.sync([her]);
    track();
    assert.equal(her.officialMotes, true);
    assert.deepEqual(keys(), [TALENT, TALENT, TALENT]);
    const expect0 = orbitOffset(0, 0, 3, orbitMotion(around(TALENT, HIT, 150)));
    const got = boardOf(handles[0]);
    assert.ok(Math.abs(got.x - (5 + expect0.x)) < 1e-6 && Math.abs(got.y - (10 + expect0.y)) < 1e-6);
    her.gameT = 3;
    w.sync([her]);
    track();
    const expectQ = orbitOffset(3, 0, 3, orbitMotion(around(TALENT, HIT, 150)));
    const turned = boardOf(handles[0]);
    assert.ok(Math.abs(turned.x - (5 + expectQ.x)) < 1e-6 && Math.abs(turned.y - (10 + expectQ.y)) < 1e-6);
    const s2 = view('char_4134_cetsyr', 5, 10, {
      flags: UF.SKILL, motes: { n: 6, wide: 1 }, gameT: 10, info: { skillIndex: 1 },
    });
    w.sync([her, s2]);
    assert.equal(keys().filter((k) => k === S2_TRAIL).length, 6);
    assert.equal(s2.officialMotes, true);
    const s3 = view('char_4134_cetsyr', 8, 10, {
      motes: { n: 3, wide: 0 }, info: { skillIndex: 2 },
    });
    w.skill(s3, true);
    w.sync([her, s2, s3]);
    assert.equal(keys().filter((k) => k === S3_TRAIL).length, 3);
    assert.equal(keys().filter((k) => k === TALENT).length, 3, 'an idle 魔王 keeps the talent orbiter');
  });

  test('S1 does not spawn a second body', async () => {
    const { w, view, keys } = await setup();
    const her = view('char_4134_cetsyr', 5, 10, {
      flags: UF.SKILL, motes: { n: 3, wide: 0 }, info: { skillIndex: 0 },
    });
    w.sync([her]);
    assert.deepEqual(keys(), [TALENT, TALENT, TALENT]);
    assert.equal(FX_BINDINGS.skchr_cetsyr_1.cetsyrOrbit.projectiles.includes(CETSYR_ORBIT.s1), true);
  });

  test('death, retreat and a missing prefab drop the orbit', async () => {
    const { w, view, keys } = await setup();
    const her = view('char_4134_cetsyr', 5, 10, { motes: { n: 3, wide: 0 }, gameT: 4 });
    w.sync([her]);
    assert.equal(keys().length, 3);
    her.motes = null;
    w.sync([her]);
    assert.equal(keys().length, 0);
    assert.equal(her.officialMotes, false);
    her.motes = { n: 2, wide: 0 };
    her.alive = false;
    w.sync([her]);
    assert.equal(keys().length, 0);
    const bare = await setup({ installed: ALL.filter((k) => k !== TALENT) });
    const other = bare.view('char_4134_cetsyr', 5, 10, { motes: { n: 3, wide: 0 } });
    bare.w.sync([other]);
    assert.equal(other.officialMotes, false);
    assert.equal(bare.keys().length, 0);
  });

  test('官方特效 off spawns nothing', async () => {
    const { w, view, keys } = await setup({ active: false });
    const her = view('char_4134_cetsyr', 5, 10, { flags: UF.SKILL, motes: { n: 6, wide: 1 }, info: { skillIndex: 1 } });
    w.sync([her]);
    assert.equal(her.officialMotes, false);
    assert.equal(keys().length, 0);
  });
});

describe('bounce path', () => {
  const motion = bounceMotion({
    main: BOUNCE_TRAIL, onHit: [BOUNCE_HIT],
    movement: { class: 'BouncedAdvancedMovement', moveType: 1, speed: 30, speedAfterFirstReach: 4, comeBack: 0 },
  });

  test('moveType 1 is straight, first leg at 30 and the rest at 4', () => {
    assert.equal(motion.speed, 30);
    assert.equal(motion.speedAfter, 4);
    const segs = bounceSegments([{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }], motion);
    assert.equal(segs.length, 2);
    assert.equal(segs[0].speed, 30);
    assert.ok(Math.abs(segs[0].dur - 0.1) < 1e-9);
    assert.equal(segs[1].speed, 4);
    assert.ok(Math.abs(segs[1].dur - 1) < 1e-9);
    for (const k of [0.25, 0.5, 0.75]) {
      const p = bounceAt(segs[0], k);
      assert.ok(Math.abs(p.y) < 1e-9 && Math.abs(p.x - 3 * k) < 1e-9, 'on the straight segment');
    }
  });

  test('a kit hop speed replaces the record speed, and an arc movement is refused', () => {
    const segs = bounceSegments([{ x: 1, y: 2 }, { x: 1, y: 5.2, speed: 3.2 }], motion, { afterFirst: true });
    assert.equal(segs[0].speed, 3.2);
    assert.ok(Math.abs(segs[0].dur - 1) < 1e-9);
    const later = bounceSegments([{ x: 0, y: 0 }, { x: 4, y: 0 }], motion, { afterFirst: true });
    assert.equal(later[0].speed, 4, 'a hop past the first landing uses speedAfterFirstReach');
    assert.equal(bounceMotion({ movement: { class: 'ParacurveMovement', speed: 8 }, main: 'x' }), null);
    assert.equal(bounceMotion({ movement: { class: 'BouncedAdvancedMovement', moveType: 8, speed: 30 }, main: 'x' }), null);
  });
});

describe('真言 bounce player', () => {
  test('the first landing is the hit, and a hop flies the trail then the hit', async () => {
    const { w, ofx, view, handles, track, keys } = await setup();
    const her = view('char_4204_mantra', 4, 9, { flags: UF.SKILL, info: { skillIndex: 2 } });
    assert.equal(w.simFx('mantraArc', 6, 9, { id: her.id, target: 99 }), true);
    assert.deepEqual(keys(), [BOUNCE_HIT]);
    assert.equal(keys().includes(BOUNCE_TRAIL), false, 'the first reach has no flight');
    ofx.time = 0;
    assert.equal(w.simFx('mantraHop', 6, 9, { id: her.id, target: 7, tx: 6 + 3.2, ty: 9, speed: 3.2 }), true);
    const trail = handles.find((h) => h.key === BOUNCE_TRAIL && h.alive);
    assert.ok(trail && trail.opts.loop === true);
    ofx.time = 0.5;
    track();
    const mid = boardOf(trail);
    assert.ok(Math.abs(mid.x - (6 + 1.6)) < 1e-6 && Math.abs(mid.y - 9) < 1e-6);
    ofx.time = 1;
    track();
    assert.ok(trail.stopped, 'the trail clears when it reaches');
    assert.equal(handles.filter((h) => h.key === BOUNCE_HIT).length, 2, 'one hit per landing');
    assert.equal(w.simFx('atk', 4, 9, { id: her.id }), false, 'her attack shot is not this projectile');
  });

  test('S2 and 官方特效 off do not spawn the bounce', async () => {
    const { w, view, keys } = await setup();
    const s2 = view('char_4204_mantra', 4, 9, { flags: UF.SKILL, info: { skillIndex: 1 } });
    assert.equal(w.simFx('mantraArc', 6, 9, { id: s2.id, target: 3 }), false);
    assert.equal(w.simFx('mantraHop', 6, 9, { id: s2.id, tx: 8, ty: 9, speed: 3.2 }), false);
    assert.equal(keys().length, 0);
    const off = await setup({ active: false });
    const her = off.view('char_4204_mantra', 4, 9, { flags: UF.SKILL, info: { skillIndex: 2 } });
    assert.equal(off.w.simFx('mantraArc', 6, 9, { id: her.id, target: 3 }), false);
    assert.equal(off.w.simFx('mantraHop', 6, 9, { id: her.id, tx: 8, ty: 9, speed: 3.2 }), false);
    assert.equal(off.keys().length, 0);
    assert.equal(fxSpec('mantraArc').a, 'bolt');
    assert.equal(fxSpec('mantraHop').a, 'none');
  });

  test('a missing hit prefab does not claim the procedural bolt', async () => {
    const bare = await setup({ installed: [BOUNCE_TRAIL] });
    const her = bare.view('char_4204_mantra', 4, 9, { flags: UF.SKILL, info: { skillIndex: 2 } });
    assert.equal(bare.w.simFx('mantraArc', 6, 9, { id: her.id, target: 3 }), false);
    assert.equal(bare.keys().length, 0);
  });
});

describe('bindings name the projectiles the sweep looks for', () => {
  test('each row lists its projectile, and the tie is not claimed', () => {
    const mains = (skillId, ids) => {
      const bound = new Set(bindingKeys(makeIndex(), skillId));
      for (const id of ids) {
        const proj = makeIndex().projectiles[id];
        assert.equal(bound.has(proj.main), true, id);
        assert.equal(bound.has(proj.onHit[0]), true, id);
      }
    };
    mains('skchr_cetsyr_1', ['projectile_chr_cetsyr_talent_s1']);
    mains('skchr_cetsyr_2', ['projectile_chr_cetsyr_talent', 'projectile_chr_cetsyr_talent_s2']);
    mains('skchr_cetsyr_3', ['projectile_chr_cetsyr_talent', 'projectile_chr_cetsyr_talent_s3']);
    mains('skchr_mantra_3', ['projectile_chr_mantra_s3_2']);
    assert.equal(FX_BINDINGS.skchr_cetsyr_2.cetsyrOrbit.keys, undefined);
    assert.equal(JSON.stringify(FX_BINDINGS).includes('cetsyr_skill_02_tie'), false);
  });
});

const INDEX = 'public/assets/local/fx/index.json';

describe('round 88 lane g2 against the extracted index', { skip: !fs.existsSync(INDEX) && 'no public/assets/local/fx/index.json' }, () => {
  const idx = fs.existsSync(INDEX) ? JSON.parse(fs.readFileSync(INDEX, 'utf8')) : null;

  test('the orbit and bounce records still say what the player reads', () => {
    const talent = idx.projectiles.projectile_chr_cetsyr_talent;
    const s1 = idx.projectiles.projectile_chr_cetsyr_talent_s1;
    const s2 = idx.projectiles.projectile_chr_cetsyr_talent_s2;
    const s3 = idx.projectiles.projectile_chr_cetsyr_talent_s3;
    for (const p of [talent, s1, s3]) {
      assert.equal(p.movement.class, 'RotateAroundMovement');
      assert.equal(p.movement.projectileAroundRadius, 1);
      assert.equal(p.movement.aroundSpeed, 150);
      assert.equal(p.movement.clockwise, 0);
    }
    assert.equal(s1.main, talent.main);
    assert.equal(s2.movement.aroundSpeed, 0.01);
    assert.equal(s2.main, 'cetsyr_skill_02_trail_01');
    assert.equal(s3.main, 'cetsyr_skill_03_trail_01');
    const bounce = idx.projectiles.projectile_chr_mantra_s3_2;
    assert.equal(bounce.movement.class, 'BouncedAdvancedMovement');
    assert.equal(bounce.movement.moveType, 1);
    assert.equal(bounce.movement.speed, 30);
    assert.equal(bounce.movement.speedAfterFirstReach, 4);
    assert.equal(bounce.movement.comeBack, 0);
    assert.equal(bounce.main, 'mantra_bounce_trail_01');
    assert.deepEqual(bounce.onHit, ['mantra_bounce_hit_01']);
    assert.deepEqual(idx.skills.skchr_mantra_3.projectiles, ['projectile_chr_mantra_s3_2']);
    const tie = idx.skills.skchr_cetsyr_2.uses.find((u) => (u.keys || []).includes('cetsyr_skill_02_tie'));
    assert.equal(tie.on, 'owner');
    assert.equal(tie.buff != null || tie.template != null, true);
  });
});

describe('MoteRing stays when the official orbit is not drawing', () => {
  let fake, UnitView, fakeViewCtx, presetCamera;
  before(async () => {
    const pixi = await import('./fakepixi.js');
    fakeViewCtx = pixi.fakeViewCtx;
    ({ presetCamera } = await import('../../public/js/render/projection.js'));
    fake = pixi.installFakePixi();
    ({ UnitView } = await import('../../public/js/render/units.js'));
  });
  after(() => { fake?.restore(); });

  test('officialMotes suppresses the ring, and clearing it builds the ring again', () => {
    const cam = () => presetCamera('normal', { width: 1280, height: 720 });
    const v = new UnitView(fakeViewCtx(fake.P, { cam }), {
      id: 1, side: 'ally', kind: 'op', defId: 'chess_char_4_25_a', spine: 'char_4134_cetsyr', tier: 4, x: 5, y: 10, maxHp: 1000, dir: 'RIGHT',
    });
    try {
      const spine = new fake.P.Container();
      v.actor = { spine, destroy() {}, effectTexture: () => new fake.P.Texture() };
      v.spineReady = true;
      v.motes = { n: 3, wide: 1 };
      v.officialMotes = true;
      v._syncMotes(0.02);
      assert.equal(v.moteRing, null, 'the official orbit replaces the ring');
      v.officialMotes = false;
      v._syncMotes(0.02);
      assert.ok(v.moteRing, '官方特效 off keeps MoteRing');
      assert.equal(v.moteRing.n, 3);
      assert.equal(v.moteRing.sprites.length, 3);
    } finally { v.destroy(); }
  });
});
