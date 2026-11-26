// test/render/vfx-oxi-heatwave.test.js — 塔露拉 S3 日冕重烈 under 官方特效 (history §37.354; player report 「塔露拉3技能没有
// 特效」). The kit sends one 'heatwave' per volley (id = her, at her tile, `dir`, `n` lanes) and moves the 簇火 itself;
// each explosion is a 'blast' tagged 'oxi:heatwave' at the enemy. Until round 85 the volley was the shared `wave` rings,
// a cast flash her official stance loop swallowed (skillfx.js FLASH), and the official projectile was not extracted:
// nothing drew the lanes. Now (skills.js FX_BINDINGS skchr_oxi_3) the volley flies projectile_chr_oxi_s_3_heatwave's
// trail oxi_skill_03_trail_01 along each lane (render/vfx/lanes.js) at the skill's wave_speed, and an explosion plays
// the projectile's oxi_skill_03_hit_01 there and stops the shot it ended. Without the projectile (官方特效 off, an
// extraction before round 85, the trail not installed) the procedural lanes stay (render/fx/simfx.js 'lanes').

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { FxWiring } from '../../public/js/render/vfx/wiring.js';
import { FLASH, LANE_HIT_REACH } from '../../public/js/render/vfx/skillfx.js';
import { FX_BINDINGS, bindingKeys, skillPlan } from '../../public/js/render/vfx/skills.js';
import { fxSpec } from '../../public/js/render/fx/kinds.js';
import { boardToUnity } from '../../public/js/render/vfx/math.js';
import { GEO, UF } from '../../shared/constants.js';

const START = 'oxi_skill_03_start_01', LOOP = 'oxi_skill_03_buff_01', TRAIL = 'oxi_skill_03_trail_01', HIT = 'oxi_skill_03_hit_01';
const PROJ = 'projectile_chr_oxi_s_3_heatwave';
const ALL = [START, LOOP, TRAIL, HIT, 'g_hit'];
const LOOPING = new Set([LOOP, TRAIL]);
const BB = { atk: 1.08, heatwave_atk_scale: 1.3, normal_interval: 2.67, overload_interval: 2, wave_speed: 2.3, normal_half_width: 2,
  overload_half_width: 6, projectile_range: 0.5, range_radius: 1.5, random_birth_delay: 0, wave_exit_distance: 5 };

/** The index records as the round-85 extraction writes them (units.char_4247_oxi, skills.skchr_oxi_3, the projectile). */
function makeIndex(installed = ALL, { projectile = true } = {}) {
  const prefabs = Object.fromEntries(installed.map((k) => [k, { file: `prefabs/${k}.json`, looping: LOOPING.has(k) }]));
  const s3 = {
    rootClass: 'CastSkillWithSuspendable', rootAbility: 'ActiveBuffAbility', effects: [LOOP, START], projectiles: projectile ? [PROJ] : [],
    mode: 1, modeBy: 'data', abilities: [], unclassified: [], roles: { start: [START], loop: [LOOP] },
    uses: [
      { role: 'loop', keys: [LOOP], from: 'ActiveBuffAbility._buffs', node: 'skchr_oxi_3', on: 'owner', buff: 'oxi_s_3_stance',
        template: 'switch_mode_restart_fsm', life: { type: 'LIMITED', time: 40, key: 'duration' } },
      { role: 'start', keys: [START], from: 'UberEffectEmitter._castEffects', node: 'skchr_oxi_3', ability: 'ActiveBuffAbility',
        startEvent: 'ON_CAST_START', endEvent: 'ON_CAST_END', oneshot: true, list: 'cast' },
    ],
  };
  return {
    units: {
      char_4247_oxi: {
        kind: 'char', talents: {}, startEffect: null, deadEffect: null, skills: { skchr_oxi_3: s3 },
        modes: [{ name: 'Default', attack: { class: 'MeleeAttack', node: 'Modes/Default/Body/Attack', cast: [], hit: [] }, combat: null },
          { name: 'S3NoAttack', attack: null, combat: null }],
      },
      enemy_dummy: { kind: 'enemy', skills: {}, talents: {}, startEffect: null, deadEffect: null, modes: [{ name: 'Default', attack: null, combat: null }] },
    },
    projectiles: projectile ? {
      [PROJ]: { rolesVersion: 1, main: TRAIL, lifeTime: 25, effects: [HIT, TRAIL], projectiles: [],
        movement: { class: 'AdvancedMovement', speed: 6, speedKey: 'wave_speed' },
        behaviours: [{ class: 'SimpleProjectile', node: PROJ, fields: { _mainEffect: TRAIL, _lifeTimeType: 1, _lifeTime: 25, _stopAfterFirstHit: 1 } }] },
    } : {},
    skills: { skchr_oxi_3: s3 },
    skins: {},
    generic: { hit: { phys: 'g_hit' }, die: {}, birth: {}, status: {}, keys: [] },
    prefabs,
  };
}

const rec = (skillId = 'skchr_oxi_3', bb = BB) => ({ skill: { skillId, index: 2, skillType: 'MANUAL', durationType: 'NONE', duration: 36, bb } });

async function setup({ installed = ALL, projectile = true, active = true, record = rec(), rect = GEO.NORMAL_RECT, at = [3, 10], dir = 'RIGHT' } = {}) {
  const index = makeIndex(installed, { projectile });
  const handles = [];
  const ofx = {
    active, time: 0, lite: false, tier: active ? 'full' : 'off', timers: [], ctx: { fieldRect: () => rect },
    lib: {
      has: (k) => !!index.prefabs[k], def: (k) => (index.prefabs[k] ? { isLoop: index.prefabs[k].looping, spawn: 1 } : null),
      index: async () => index, preload: async (keys) => keys.length, defs: new Map(),
    },
    spawn(key, place, opts) {
      if (!this.active) return null;
      const h = { key, place, opts, time: 0, anchor: place.pos ? place.pos.slice() : [0, 0, 0], yaw: place.yaw ?? 0, stopped: null,
        get alive() { return !this.stopped; }, stop(o = {}) { this.stopped = o; }, kill() { this.stopped = { killed: true }; } };
      handles.push(h);
      return h;
    },
  };
  const views = new Map();
  const w = new FxWiring(ofx, { speed: () => 10, record: () => record, view: (id) => views.get(id) || null });
  await w.ready();
  const her = { id: 1, x: at[0], y: at[1], z: 0, visFacing: 1, isEnemy: false, alive: true, flags: 0, sp: 0, spMax: 45, dir,
    info: { id: 1, spine: 'char_4247_oxi', defId: 'char_4247_oxi', side: 'ally', kind: 'op', skillIndex: 2 } };
  views.set(1, her);
  const frame = (dt = 1 / 30) => {
    w.sync(views.values()); w.tick(); ofx.time += dt;
    for (const h of handles) if (!h.stopped && typeof h.opts?.track === 'function') { h.time += dt; h.opts.track(h); }
  };
  await w.begin([...views.values()]);
  frame();
  return { w, ofx, her, frame, handles };
}

const volley = (w, her, n = 5, extra = {}) => w.simFx('heatwave', her.x, her.y, { id: her.id, dir: her.dir, n, skill: 'oxi:heatwave', ...extra });
const blast = (w, x, y, extra = {}) => w.simFx('blast', x, y, { id: 1, r: 1.5, element: 'burn', skill: 'oxi:heatwave', ...extra });
const trails = (handles) => handles.filter((h) => h.key === TRAIL);
const near = (a, b, eps = 1e-6) => a.every((v, i) => Math.abs(v - b[i]) <= eps);

describe('塔露拉 S3 日冕重烈 under 官方特效 (round 85)', () => {
  test('the bindings, the archetype, preloading and the plan: the volley flies the projectile, the blast is its hit', () => {
    const b = FX_BINDINGS.skchr_oxi_3;
    assert.deepEqual([b.heatwave.owner, b.heatwave.lanes, b.heatwave.projectile, b.heatwave.tag, b.heatwave.during], ['id', true, PROJ, 'oxi:heatwave', undefined]);
    assert.deepEqual([b.blast.owner, [...b.blast.keys], b.blast.at, b.blast.oneshot, b.blast.ends, b.blast.tag, b.blast.during],
      ['id', [HIT], 'point', true, 'heatwave', 'oxi:heatwave', undefined]);
    assert.deepEqual(bindingKeys(makeIndex(), 'skchr_oxi_3').sort(), [HIT, TRAIL]);
    // not a cast flash any more: no official start or loop stands for the lanes
    assert.equal(fxSpec('heatwave').a, 'lanes');
    assert.equal(FLASH.has('lanes'), false);
    assert.equal(FLASH.has('wave'), true, 'the other pulses stay cast flashes');
    const plan = skillPlan(makeIndex(), 'char_4247_oxi', 'skchr_oxi_3', { rec: rec().skill });
    assert.deepEqual([plan.projectiles, plan.pulse, plan.attacks.length], [[PROJ], [], 0], 'preloaded with the skill; no pulse row takes the fx');
  });

  test('a volley flies the trail along every lane of the field from the back edge at wave_speed; it clears at its end', async () => {
    const { w, her, frame, handles } = await setup();
    her.flags |= UF.SKILL;
    assert.equal(w.skill(her, true), true, 'the stance start and loop still play');
    assert.ok(handles.some((h) => h.key === START) && handles.some((h) => h.key === LOOP));
    assert.equal(volley(w, her, 5), true, 'drawn on the skill-start frame (the stance does not swallow it)');
    const shots = trails(handles);
    // the normal field has 4 rows (< 5 lanes): every row, from column 0 (nearer than 11 tiles behind her) to 10 + 5
    assert.equal(shots.length, 4);
    assert.deepEqual(shots.map((h) => h.place.pos), [9, 10, 11, 12].map((r) => boardToUnity(0, r, 0)));
    assert.ok(shots.every((h) => h.yaw === 0 && h.opts.important && near(h.place.rootRot, [0, 0, 0, 1])), 'facing right, a projectile body');
    for (let i = 0; i < 30; i++) frame();   // 1 s
    for (const [i, h] of shots.entries()) assert.ok(near(h.anchor, boardToUnity(2.3 * h.time, 9 + i, 0), 1e-9), `lane ${9 + i} at 2.3 tiles/s`);
    assert.ok(shots.every((h) => !h.stopped));
    for (let i = 0; i < 6 * 30; i++) frame();   // 7 s: 15 tiles / 2.3 = 6.52 s
    assert.ok(shots.every((h) => h.stopped && !h.stopped.hit), 'cleared where it reached its end');
    assert.ok(shots.every((h) => near(h.anchor, boardToUnity(15, h.anchor[1] + 9, 0))), 'at column 10 + wave_exit_distance');
    // a later volley (the stance loop alive) flies again
    assert.equal(volley(w, her, 13), true);
    assert.equal(trails(handles).length, 8, '过载\'s 13 lanes are the field\'s 4 rows too');
  });

  test('facing up in a boss field: columns from 11 tiles behind her up past the far edge; the window shifted at the edge', async () => {
    const { w, her, handles } = await setup({ rect: GEO.BOSS_RECT, at: [20, 5], dir: 'UP' });
    assert.equal(volley(w, her, 5), true);
    const shots = trails(handles);
    assert.deepEqual(shots.map((h) => h.place.pos), [16, 17, 18, 19, 20].map((c) => boardToUnity(c, 0, 0)), 'shifted left at column 20');
    assert.ok(shots.every((h) => Math.abs(h.yaw - Math.PI / 2) < 1e-12), 'turned up the rows');
  });

  test('an explosion plays the projectile\'s hit there and stops the shot it ended; the other lanes fly on', async () => {
    const { w, her, frame, handles } = await setup();
    volley(w, her, 5);
    for (let i = 0; i < 30; i++) frame();   // the heads at column ≈ 2.3
    const before = handles.length;
    assert.equal(blast(w, 2.7, 10), true);
    assert.deepEqual(handles.slice(before).map((h) => h.key), [HIT], 'the official explosion, no other prefab');
    frame();
    const shots = trails(handles);
    assert.deepEqual(shots.map((h) => !!h.stopped), [false, true, false, false], 'row 10\'s shot stopped');
    assert.equal(shots[1].stopped.hit, true);
    const x = shots[1].anchor[0];
    frame();
    assert.equal(shots[1].anchor[0], x, 'where it went off');
    // farther than LANE_HIT_REACH from every head: still its explosion, no shot stops
    assert.ok(LANE_HIT_REACH < 3);
    assert.equal(blast(w, 9, 12), true);
    frame();
    assert.deepEqual(trails(handles).map((h) => !!h.stopped), [false, true, false, false]);
  });

  test('another \'blast\' of hers (no S3 tag) is not the skill\'s; another skill of hers binds nothing', async () => {
    const { w, handles } = await setup();
    const before = handles.length;
    assert.equal(w.simFx('blast', 4, 10, { id: 1, r: 1, element: 'burn' }), false);
    assert.equal(w.simFx('blast', 4, 10, { id: 1, r: 0.9, element: 'burn', skill: 'oxi:retaliate' }), false);
    assert.equal(handles.length, before);
    const s2 = await setup({ record: rec('skchr_oxi_2', {}) });
    assert.equal(volley(s2.w, s2.her, 5), false, 'S2\'s owner: the procedural lanes');
  });

  test('without the projectile the procedural lanes stay: 官方特效 off, an extraction before round 85, the trail missing', async () => {
    const off = await setup({ active: false });
    off.w.skill(off.her, true);
    assert.equal(volley(off.w, off.her, 5), false);
    const old = await setup({ projectile: false });
    old.her.flags |= UF.SKILL; old.w.skill(old.her, true); old.frame();
    assert.equal(volley(old.w, old.her, 5), false, 'no projectile record (and the stance loop does not swallow the volley)');
    assert.equal(blast(old.w, 4, 10), true, 'its hit prefab alone still plays the explosion');
    const bare = await setup({ installed: ALL.filter((k) => k !== TRAIL && k !== HIT) });
    bare.her.flags |= UF.SKILL; bare.w.skill(bare.her, true); bare.frame();
    assert.equal(volley(bare.w, bare.her, 5), false);
    assert.equal(blast(bare.w, 4, 10), false, 'the procedural explosion too');
    assert.equal(trails(bare.handles).length, 0);
  });

  test('the skill record\'s wave_speed / wave_exit_distance; the record-less defaults; a junk volley draws what it can', async () => {
    const fast = await setup({ record: rec('skchr_oxi_3', { ...BB, wave_speed: 5, wave_exit_distance: 2 }) });
    volley(fast.w, fast.her, 1);
    for (let i = 0; i < 30; i++) fast.frame();
    const [s] = trails(fast.handles);
    assert.ok(near(s.anchor, boardToUnity(5 * s.time, 10, 0), 1e-9), 'wave_speed 5');
    for (let i = 0; i < 60; i++) fast.frame();
    assert.ok(s.stopped && near(s.anchor, boardToUnity(12, 10, 0)), 'stops at 10 + 2');
    const bare = await setup({ record: rec('skchr_oxi_3', {}) });
    volley(bare.w, bare.her, 1);
    for (let i = 0; i < 30; i++) bare.frame();
    const [d] = trails(bare.handles);
    assert.ok(near(d.anchor, boardToUnity(2.3 * d.time, 10, 0), 1e-9), 'the data\'s 2.3 when the record has none');
    assert.equal(bare.w.simFx('heatwave', NaN, NaN, { id: 1, dir: 'UP', n: 3, skill: 'oxi:heatwave' }), false, 'no caster tile');
    assert.equal(bare.w.simFx('heatwave', 3, 10, { id: 1, skill: 'oxi:heatwave' }), true, 'no facing or count: one lane to the right');
  });
});
