// test/render/vfx-r88-g1.test.js — round 88 lane g1.
// Trigger uses (`from` starts with `trigger `) stay off the skill's loop / range / start and are played
// only by the 思衡托 S3 teleport binding. 傀影's 替身, given a synthetic index whose sktok_phatom_2 / _3
// name their modes, attacks with the S2 mode while that passive runs, and S3's own MeleeAttack replaces
// the mode attack. No real art pack (GitHub CI has none).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { FxWiring } from '../../public/js/render/vfx/wiring.js';
import { FX_BINDINGS, skillPlan, UNMAPPED } from '../../public/js/render/vfx/skills.js';
import { fxSpec } from '../../public/js/render/fx/kinds.js';
import { UF } from '../../shared/constants.js';

const END = 'kalts2_skill_03_teleport_end_01';
const RANGE = 'kalts2_skill_03_range_01';
const UNCLAIMED = 'kalts2_unclaimed_trigger';
const KEEP = 'kalts2_skill_03_keep';
const S2_START = 'phatom_skill_02_start';
const S3_SKILL = 'phatom_skill_03_start';
const S3_MODE = 'phatom_attack_01_start';
const DEF_START = 'phatom_default_start';

function prefab(looping) {
  return { file: 'prefabs/x.json', looping, spawn: 1 };
}

function use(key, extra) {
  return { role: 'loop', keys: [key], from: 'PassiveBuffAbility._buffs', node: 'n', on: 'owner', ...extra };
}

function makeOfx(index, active) {
  const handles = [];
  const ofx = {
    active, time: 0, lite: false, tier: active ? 'full' : 'off', timers: [], ctx: {},
    lib: {
      has: (k) => !!index.prefabs[k],
      def: (k) => (index.prefabs[k] ? { isLoop: index.prefabs[k].looping, spawn: 1 } : null),
      index: async () => index, preload: async (keys) => keys.length, defs: new Map(),
    },
    spawn(key, place, opts) {
      if (!this.active) return null;
      const h = {
        key, place, opts, time: 0, anchor: place.pos ? place.pos.slice() : [0, 0, 0], yaw: place.yaw ?? 0, stopped: null,
        get alive() { return !this.stopped; }, stop(o = {}) { this.stopped = o; }, kill() { this.stopped = { killed: true }; },
      };
      handles.push(h);
      return h;
    },
  };
  return { ofx, handles };
}

async function boot(index, record, active = true) {
  const { ofx, handles } = makeOfx(index, active);
  const views = new Map();
  const w = new FxWiring(ofx, { speed: () => 10, record: () => record, view: (id) => views.get(id) || null });
  await w.ready();
  let n = 1;
  const add = (extra) => {
    const v = {
      x: 3, y: 4, z: 0, visFacing: 1, facing: 1, dir: 'RIGHT', isEnemy: false, alive: true,
      flags: 0, sp: 0, spMax: 30, statuses: new Set(), el: null, ...extra, id: extra.id ?? n,
    };
    n = Math.max(n, v.id) + 1;
    views.set(v.id, v);
    return v;
  };
  const frame = (dt = 1 / 30) => {
    w.sync(views.values()); w.tick(); ofx.time += dt;
  };
  return { w, ofx, handles, add, frame, views };
}

function kaltsIndex() {
  const skills = {
    skchr_kalts2_3: {
      rootClass: 'CastSkill', mode: 1, modeBy: 'name', projectiles: [], abilities: [],
      effects: [END, RANGE, UNCLAIMED, KEEP],
      uses: [
        use(KEEP),
        use(END, { role: 'loop', from: 'trigger kalts2_s_3[restore] BuffDuringCastingFixed._buffs' }),
        use(RANGE, { role: 'range', from: 'trigger kalts2_s_3[restore] UberEffectEmitter._castEffects' }),
        use(UNCLAIMED, { role: 'loop', from: 'trigger kalts2_s_3[restore] Something._buffs' }),
      ],
    },
  };
  return {
    units: {
      char_1052_kalts2: {
        kind: 'char', talents: {}, abilities: [], startEffect: null, deadEffect: null,
        modes: [
          { name: 'default', attack: { class: 'MeleeAttack', cast: [], hit: [] } },
          { name: 's3', attack: { class: 'RangedAttack', projectileKey: 'projectile_chr_kalts2_s3_1', cast: [{ effects: ['kalts2_s3_cast'] }], hit: [] } },
        ],
        skills,
      },
    },
    skills,
    projectiles: { projectile_chr_kalts2_s3_1: { main: 'kalts2_s3_cast', effects: [] } },
    skins: {},
    generic: { hit: {}, die: {}, birth: {}, status: {}, keys: [] },
    prefabs: {
      [END]: prefab(false), [RANGE]: prefab(false), [UNCLAIMED]: prefab(true), [KEEP]: prefab(true),
      kalts2_s3_cast: prefab(false),
    },
  };
}

function kaltsRec() {
  return {
    charId: 'char_1052_kalts2',
    skill: { skillId: 'skchr_kalts2_3', index: 2, skillType: 'MANUAL', durationType: 'SECONDS', duration: 20, bb: {} },
  };
}

function twinIndex() {
  const s2 = { rootClass: 'PassiveSkill', mode: 1, modeBy: 'name', effects: [], projectiles: [], abilities: [], uses: [] };
  const s3 = {
    rootClass: 'PassiveSkill', mode: 2, modeBy: 'name', effects: [S3_SKILL], projectiles: [], abilities: [],
    uses: [{
      role: 'start', keys: [S3_SKILL], from: 'MeleeAttack._castEffects', ability: 'MeleeAttack',
      node: 'Attack', oneshot: true, startEvent: 'ON_CAST_START',
    }],
  };
  const modes = [
    { name: 'Default', attack: { class: 'MeleeAttack', node: 'Modes/Default/Attack', cast: [{ effects: [DEF_START], oneshot: 1 }], hit: [] }, combat: null },
    { name: 'S2', attack: { class: 'MeleeAttack', node: 'Modes/S2/Body/Attack', cast: [{ effects: [S2_START], oneshot: 1 }], hit: [{ effects: ['phatom_skill_02_hit'], oneshot: 1 }] }, combat: null },
    { name: 'S3', attack: { class: 'MeleeAttack', node: 'Modes/S3/Body/Attack', cast: [{ effects: [S3_MODE], oneshot: 1 }], hit: [{ effects: ['phatom_attack_01_hit'], oneshot: 1 }] }, combat: null },
  ];
  const skills = { sktok_phatom_2: s2, sktok_phatom_3: s3 };
  return {
    units: { token_10007_phatom_twin: { kind: 'token', talents: {}, abilities: [], startEffect: null, deadEffect: null, modes, skills } },
    skills, projectiles: {}, skins: {},
    generic: { hit: {}, die: {}, birth: {}, status: {}, keys: [] },
    prefabs: {
      [S2_START]: prefab(false), [S3_SKILL]: prefab(false), [S3_MODE]: prefab(false), [DEF_START]: prefab(false),
      phatom_skill_02_hit: prefab(false), phatom_attack_01_hit: prefab(false),
    },
  };
}

function twinRec() {
  return {
    skill: { skillId: 'sktok_phatom_1' },
    variants: {
      char_250_phatom: {
        skill: { skillId: 'sktok_phatom_1', skillType: 'PASSIVE', index: 0, durationType: 'NONE', duration: 0 },
        bySkill: {
          1: { skill: { skillId: 'sktok_phatom_2', prefabId: 'sktok_phatom_2', skillType: 'PASSIVE', index: 1, durationType: 'NONE', duration: 0 } },
          2: { skill: { skillId: 'sktok_phatom_3', prefabId: 'sktok_phatom_3', skillType: 'PASSIVE', index: 2, durationType: 'NONE', duration: 0 } },
        },
      },
    },
  };
}

const keysOf = (handles) => handles.map((h) => h.key);

describe('round 88 lane g1', () => {
  test('teleport stays the procedural blink, and the S3 binding names both arrival prefabs', () => {
    assert.equal(fxSpec('teleport').a, 'blink');
    assert.equal(UNMAPPED.trigger, 'an ability a skill-prefab template triggers: only a binding plays it');
    const b = FX_BINDINGS.skchr_kalts2_3.teleport;
    assert.equal(b.owner, 'id');
    assert.equal(b.oneshot, true);
    // no skill gate: the flight drops her skill state before the landing (round 88 on-screen check)
    assert.equal(b.during, undefined);
    assert.equal(b.claim, true);
    assert.equal(b.tag, undefined);
    assert.deepEqual([...b.keys], [END, RANGE]);
  });

  test('trigger uses are not a skill loop, range or start; a claim retags them and an unclaimed one stays trigger', () => {
    const idx = kaltsIndex();
    const plan = skillPlan(idx, 'char_1052_kalts2', 'skchr_kalts2_3', { rec: kaltsRec().skill });
    const placed = [...plan.start, ...plan.loop, ...plan.range, ...plan.end, ...plan.trigger].map((e) => e.key);
    assert.equal(placed.includes(END), false);
    assert.equal(placed.includes(RANGE), false);
    assert.equal(placed.includes(UNCLAIMED), false);
    assert.ok(plan.loop.some((e) => e.key === KEEP));
    assert.deepEqual(plan.triggers.map((e) => e.key).sort(), [END, RANGE, UNCLAIMED].sort());
    const reason = (k) => plan.unmapped.filter((u) => u.key === k).map((u) => u.reason);
    assert.deepEqual(reason(END), ['bound']);
    assert.deepEqual(reason(RANGE), ['bound']);
    assert.deepEqual(reason(UNCLAIMED), ['trigger']);
  });

  test('思衡托 landing plays both keys once, after the flight dropped her skill state, and not with 官方特效 off', async () => {
    const idx = kaltsIndex();
    const on = await boot(idx, kaltsRec(), true);
    const her = on.add({ info: { id: 1, spine: 'char_1052_kalts2', defId: 'char_1052_kalts2', side: 'ally', kind: 'op', skillIndex: 2 } });
    her.info.id = her.id;
    await on.w.begin([...on.views.values()]);
    on.frame();
    on.w.skill(her, true);
    her.flags = UF.SKILL;
    on.frame();
    const before = keysOf(on.handles).filter((k) => k === END || k === RANGE);
    assert.deepEqual(before, []);
    // the render-demo sequence (round 88 on-screen check): the flight hides her, the snapshot drops her and the views
    // lose her, so the skill layer releases her record (its skill state goes); the landing's 'teleport' then comes
    // before her view takes the next sample (flags 0, still where she took off)
    on.views.delete(her.id);
    on.frame();
    on.views.set(her.id, her);
    her.flags = 0;
    assert.equal(on.w.skills.units.get(her.id).on, null, 'the flight dropped her skill state');
    assert.equal(on.w.simFx('teleport', 9, 4, { id: her.id, fromX: her.x, fromY: her.y }), true);
    assert.deepEqual(keysOf(on.handles).filter((k) => k === END || k === RANGE).sort(), [END, RANGE].sort());
    her.flags = UF.SKILL;
    on.frame();
    on.frame();
    on.frame();
    assert.deepEqual(keysOf(on.handles).filter((k) => k === END || k === RANGE).sort(), [END, RANGE].sort());

    const off = await boot(idx, kaltsRec(), false);
    const her2 = off.add({ info: { id: 1, spine: 'char_1052_kalts2', defId: 'char_1052_kalts2', side: 'ally', kind: 'op', skillIndex: 2 } });
    her2.info.id = her2.id;
    await off.w.begin([...off.views.values()]);
    off.w.skill(her2, true);
    off.frame();
    assert.equal(off.w.simFx('teleport', her2.x, her2.y, { id: her2.id }), false);
    assert.equal(off.handles.length, 0);
  });

  test('the twin passive uses the S2 mode attack, and S3 skill attack replaces the mode attack', async () => {
    const idx = twinIndex();
    const rec = twinRec();
    const s2 = await boot(idx, rec, true);
    const twin = s2.add({ info: { id: 7, spine: 'token_10007_phatom_twin', defId: 'token_10007_phatom_twin', side: 'ally', kind: 'token', skillIndex: 1 } });
    twin.info.id = twin.id;
    const foe = s2.add({ x: 4, y: 4, isEnemy: true, info: { id: 8, side: 'enemy', kind: 'enemy', defId: 'enemy_1007_slime' } });
    foe.info.id = foe.id;
    await s2.w.begin([...s2.views.values()]);
    s2.frame();
    const unit = s2.w.unitOf(twin);
    assert.equal(s2.w.mode(unit, twin)?.name, 'S2');
    assert.equal(s2.w.attack(twin, foe, 'none', 0, false), true);
    assert.ok(keysOf(s2.handles).includes(S2_START));
    assert.equal(keysOf(s2.handles).includes(DEF_START), false);
    assert.equal(keysOf(s2.handles).includes(S3_MODE), false);
    twin.alive = false;
    s2.frame();
    s2.handles.length = 0;
    assert.equal(s2.w.mode(unit, twin)?.name, 'Default');
    s2.w.attack(twin, foe, 'none', 1, false);
    assert.ok(keysOf(s2.handles).includes(DEF_START));
    assert.equal(keysOf(s2.handles).includes(S2_START), false);

    const s3 = await boot(idx, rec, true);
    const twin3 = s3.add({ info: { id: 9, spine: 'token_10007_phatom_twin', defId: 'token_10007_phatom_twin', side: 'ally', kind: 'token', skillIndex: 2 } });
    twin3.info.id = twin3.id;
    const foe3 = s3.add({ x: 5, y: 4, isEnemy: true, info: { id: 10, side: 'enemy', kind: 'enemy', defId: 'enemy_1007_slime' } });
    foe3.info.id = foe3.id;
    await s3.w.begin([...s3.views.values()]);
    s3.frame();
    assert.equal(s3.w.mode(s3.w.unitOf(twin3), twin3)?.name, 'S3');
    assert.equal(s3.w.attack(twin3, foe3, 'none', 0, false), true);
    assert.ok(keysOf(s3.handles).includes(S3_SKILL));
    assert.equal(keysOf(s3.handles).includes(S3_MODE), false);
  });
});
