// test/render/vfx-r86-f3.test.js — round 86 lane f3. Official prefabs for 余 S2, 号角 S2/S3, 流明 S1, 斥罪 S2,
// 伊内丝 S3, 望 S2/S3 and 棋子 连星 (skills.js FX_BINDINGS, the block "round 86 f3"). Synthetic index records.
// With 官方特效 off, or the prefab missing, the kit's procedural fx stays.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { FxWiring } from '../../public/js/render/vfx/wiring.js';
import { FX_BINDINGS, bindingKeys, skillPlan } from '../../public/js/render/vfx/skills.js';
import { boardToUnity } from '../../public/js/render/vfx/math.js';

const YU_TP = 'yu_skill2_teleport_02';
const HORN2_BACK = 'horn_skill_02_buff_03_back';
const HORN2_FRONT = 'horn_skill_02_buff_03_front';
const HORN3_BACK = 'horn_skill_03_buff_02_03_back';
const HORN3_FRONT = 'horn_skill_03_buff_02_03_front';
const LUMEN_HIT = 'lumen_skill_01_hit';
const LUMEN_RANGE = 'lumen_skill_01_range';
const JUDGE_HIT = 'judge_skill_02_hit_01';
const JUDGE_WEAPON = 'judge_skill_02_weapon_hit_01';
const INES_TRAIL = 'ines_skill_03_label_trail_01';
const INES_ROPE = 'ines_skill_03_pulllabel_line_01';
const INES_REACH = 'ines_skill_03_getlabel_01';
const INES_REACH_RANGE = 'ines_skill_03_getlabel_range_01';
const INES_ONHIT = 'ines_skill_03_label_hit_01';
const INES_PROJ = 'projectile_chr_ines_guard_back';
const WANG2_HIT = 'token_wang_skill_02_hit_02';
const WANG3_HIT = 'token_wang_skill_03_hit';
const WANG3_HIT2 = 'token_wang_skill_03_hit_02';
const WANG_BUFF = 'wang_passive_01_buff';
const WANG_BUFF2 = 'wang_passive_01_buff_02';

function bare(id) {
  return { rootClass: 'CastSkill', effects: [], projectiles: [], abilities: [], uses: [], node: id };
}

function makeIndex(units, { prefabs = {}, projectiles = {} } = {}) {
  const skills = {};
  for (const u of Object.values(units)) Object.assign(skills, u.skills || {});
  return {
    units, skills, projectiles, skins: {},
    generic: { hit: {}, die: {}, birth: {}, status: {}, keys: [] },
    prefabs,
  };
}

function op(id, defId, x, y, dir = 'RIGHT', extra = {}) {
  return {
    id, x, y, z: 0, visFacing: 1, isEnemy: !!extra.isEnemy, alive: true, flags: 0, sp: 0, spMax: 30, dir,
    info: { id, spine: defId, defId, side: extra.isEnemy ? 'enemy' : 'ally', kind: extra.kind || (extra.isEnemy ? 'enemy' : 'op'), skillIndex: extra.skillIndex ?? 0 },
  };
}

async function setup({ index, record, units, active = true }) {
  const handles = [];
  const ofx = {
    active, time: 0, lite: false, tier: active ? 'full' : 'off', timers: [], ctx: {},
    lib: {
      has: (k) => !!index.prefabs[k],
      def: (k) => (index.prefabs[k] ? { isLoop: !!index.prefabs[k].looping, spawn: index.prefabs[k].spawn ?? 2 } : null),
      index: async () => index,
      preload: async (keys) => keys.length,
      defs: new Map(),
    },
    spawn(key, place, opts) {
      if (!this.active) return null;
      const h = {
        key, place, opts, time: 0, anchor: place.pos ? place.pos.slice() : [0, 0, 0], yaw: place.yaw ?? 0, lines: null,
        get alive() { return !this.stopped; },
        stop(o = {}) { this.stopped = o; },
        kill() { this.stopped = { killed: true }; },
        linkLines(from, to) { this.lines = { from: from.slice(), to: to.slice() }; },
      };
      handles.push(h);
      return h;
    },
  };
  const views = new Map();
  const w = new FxWiring(ofx, {
    speed: () => 10,
    record: (info) => (typeof record === 'function' ? record(info) : record),
    view: (id) => views.get(id) || null,
  });
  await w.ready();
  for (const u of units) views.set(u.id, u);
  if (active) await w.begin([...views.values()]);
  const frame = (dt = 1 / 30) => {
    w.tick();
    ofx.time += dt;
    for (const h of handles) if (!h.stopped && typeof h.opts?.track === 'function') { h.time += dt; h.opts.track(h); }
  };
  return { w, ofx, views, handles, frame };
}

const rec = (skillId, bb = {}, index = 0) => ({ skill: { skillId, index, skillType: 'MANUAL', durationType: 'NONE', duration: 10, bb } });

function reasons(plan, key) {
  return plan.unmapped.filter((u) => u.key === key).map((u) => u.reason);
}

/** Board points compare equal when their Unity z is −0 versus 0 (boardToUnity negates a zero height). */
function nearPoint(actual, expected) {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < actual.length; i++) assert.ok(Math.abs(actual[i] - expected[i]) < 1e-9, `${actual} vs ${expected}`);
}

describe('round 86 f3 bindings', () => {
  test('owners stay id / src / skill, and only the f3 rows claim a sweep key', () => {
    for (const kinds of Object.values(FX_BINDINGS)) for (const b of Object.values(kinds)) assert.ok(['id', 'src', 'skill'].includes(b.owner));
    const claimed = ['skchr_yu_2', 'skchr_horn_2', 'skchr_horn_3', 'skchr_lumen_1', 'skchr_judge_2', 'skchr_ines_3', 'skchr_wang_3', 'skchr_wang_2', 'sktok_wang_2'];
    for (const sid of claimed) for (const b of Object.values(FX_BINDINGS[sid])) assert.equal(b.claim, true, sid);
    assert.equal(FX_BINDINGS.skchr_tinman_1.zone.claim, undefined);
    assert.equal(FX_BINDINGS.skchr_hbound_1.zone.claim, undefined);
    assert.equal(FX_BINDINGS.skchr_yu_3.firewallBlock.claim, undefined, '余 S3 的防火墙绑定保持原样');
    assert.deepEqual([...FX_BINDINGS.skchr_lumen_1.healField.hits], [LUMEN_HIT]);
    assert.equal(FX_BINDINGS.skchr_lumen_1.healField.pass, true);
    assert.equal(FX_BINDINGS.skchr_ines_3.beam.recall, true);
    assert.deepEqual([...FX_BINDINGS.skchr_horn_2.overload.slots], [HORN2_BACK, HORN2_FRONT, HORN2_FRONT, HORN2_FRONT]);
    assert.ok(!FX_BINDINGS.skchr_wang_3.explode.keys.includes(WANG_BUFF));
    assert.ok(!FX_BINDINGS.skchr_wang_2.explode.keys.includes('token_wang_skill_02_hit'));
  });

  test('claim retags only the listed keys; an unlisted tick stays a tick', () => {
    const horn = bare('skchr_horn_2');
    horn.uses = [
      { role: 'loop', keys: [HORN2_BACK], from: 'BuffToOwnerDuringAbility._buffs → template horn_s_2[overload_switch_effect]', node: 'skchr_horn_2', event: 'ON_BUFF_TRIGGER', action: 'CreateBuff', buff: 'horn_s_2[overload_mark]', on: 'owner', life: { type: 'INFINITY', tick: 0.2 } },
      { role: 'loop', keys: [HORN2_FRONT], from: 'BuffToOwnerDuringAbility._buffs → template horn_s_2[overload_switch_effect]', node: 'skchr_horn_2', event: 'ON_BUFF_TRIGGER', action: 'CreateBuff', buff: 'horn_s_2[overload_mark]', on: 'owner', life: { type: 'INFINITY', tick: 0.2 } },
      { role: 'trigger', keys: ['horn_unclaimed_tick'], from: 'ActiveBuffAbility._buffs', node: 'skchr_horn_2', event: 'ON_BUFF_TRIGGER', action: 'CreateEffect', on: 'owner' },
    ];
    const yu = bare('skchr_yu_2');
    yu.uses = [
      { role: 'trigger', keys: [YU_TP], from: 'MeleeAttack._activeBuffs → template yu_s_2[try_tp]', node: 'Tel', event: 'ON_BUFF_TRIGGER', action: 'CreateEffect', buff: 'yu_s_2[try_tp]', on: 'targets', life: { type: 'LIMITED', time: 1, tick: 0.13 } },
    ];
    const tok = bare('sktok_wang_2');
    tok.uses = [
      { role: 'hit', keys: [WANG2_HIT], from: 'UberEffectEmitter._hitEffects', node: 'ExplodeCol', ability: 'AnimatedActionToTargetAbility', oneshot: true },
      { role: 'hit', keys: ['token_left_hit'], from: 'UberEffectEmitter._hitEffects', node: 'ExplodeRow', ability: 'AnimatedActionToTargetAbility', oneshot: true },
    ];
    const prefabs = Object.fromEntries([HORN2_BACK, HORN2_FRONT, 'horn_unclaimed_tick', YU_TP, WANG2_HIT, 'token_left_hit'].map((k) => [k, { looping: false }]));
    const idx = makeIndex({
      char_4039_horn: { kind: 'char', skills: { skchr_horn_2: horn }, talents: {}, modes: [] },
      char_2026_yu: { kind: 'char', skills: { skchr_yu_2: yu }, talents: {}, modes: [] },
      token_10064_wang_stone1: { kind: 'token', skills: { sktok_wang_2: tok }, talents: {}, modes: [] },
    }, { prefabs });
    const hp = skillPlan(idx, 'char_4039_horn', 'skchr_horn_2');
    assert.deepEqual([...new Set(reasons(hp, HORN2_BACK))], ['bound']);
    assert.deepEqual([...new Set(reasons(hp, HORN2_FRONT))], ['bound']);
    assert.deepEqual(reasons(hp, 'horn_unclaimed_tick'), ['tick']);
    assert.deepEqual(bindingKeys(idx, 'skchr_horn_2').sort(), [HORN2_BACK, HORN2_FRONT].sort());
    const yp = skillPlan(idx, 'char_2026_yu', 'skchr_yu_2');
    assert.deepEqual(reasons(yp, YU_TP), ['bound']);
    assert.equal(yp.trigger.some((e) => e.key === YU_TP), false);
    const tp = skillPlan(idx, 'token_10064_wang_stone1', 'sktok_wang_2');
    assert.deepEqual([...new Set(reasons(tp, WANG2_HIT))], ['bound']);
    assert.deepEqual(reasons(tp, 'token_left_hit'), ['hit-no-attack']);
  });
});

describe('余 S2 厚礼上宾', () => {
  const index = makeIndex({
    char_2026_yu: { kind: 'char', skills: { skchr_yu_2: bare('skchr_yu_2') }, talents: {}, modes: [] },
  }, { prefabs: { [YU_TP]: { looping: false, spawn: 2 } } });
  const units = () => [op(1, 'char_2026_yu', 3, 10), op(2, 'enemy_x', 3, 10, 'LEFT', { isEnemy: true })];

  test('the teleport plays once on the enemy the fx names', async () => {
    const { w, handles, views } = await setup({ index, record: () => rec('skchr_yu_2'), units: units() });
    const yu = views.get(1), foe = views.get(2);
    // a bare skill draws no cast, so skill() is false; it still marks the skill on, which the teleport needs
    w.skill(yu, true);
    const before = handles.length;
    assert.equal(w.simFx('teleport', foe.x, foe.y, { id: foe.id, src: yu.id }), true);
    const spawned = handles.slice(before).filter((h) => h.key === YU_TP);
    assert.equal(spawned.length, 1);
    assert.equal(spawned[0].opts.owner, foe);
    assert.equal(spawned[0].opts.loop, false);
  });

  test('a teleport with no src, the skill off, and 官方特效 off stay procedural', async () => {
    const on = await setup({ index, record: () => rec('skchr_yu_2'), units: units() });
    const yu = on.views.get(1), foe = on.views.get(2);
    on.w.skill(yu, true);
    const n = on.handles.length;
    assert.equal(on.w.simFx('teleport', foe.x, foe.y, { id: foe.id }), false);
    assert.equal(on.handles.length, n);
    const off = await setup({ index, record: () => rec('skchr_yu_2'), units: units() });
    assert.equal(off.w.simFx('teleport', 3, 10, { id: 2, src: 1 }), false, 'skill not on');
    assert.equal(off.handles.filter((h) => h.key === YU_TP).length, 0);
    const dark = await setup({ index, record: () => rec('skchr_yu_2'), units: units(), active: false });
    dark.w.skill(dark.views.get(1), true);
    assert.equal(dark.w.simFx('teleport', 3, 10, { id: 2, src: 1 }), false);
    assert.equal(dark.handles.length, 0);
  });
});

describe('号角 S2 / S3 过载朝向', () => {
  function hornIndex(installed, sid = 'skchr_horn_2') {
    const prefabs = {};
    for (const k of installed) prefabs[k] = { looping: true, spawn: 1 };
    const skills = { [sid]: bare(sid), skchr_other_1: bare('skchr_other_1') };
    return makeIndex({
      char_4039_horn: { kind: 'char', skills, talents: {}, modes: [] },
      char_other: { kind: 'char', skills: { skchr_other_1: skills.skchr_other_1 }, talents: {}, modes: [] },
    }, { prefabs });
  }
  const both = [HORN2_BACK, HORN2_FRONT, HORN3_BACK, HORN3_FRONT];

  async function horn(dir, { installed = both, sid = 'skchr_horn_2', active = true, skillOn = true } = {}) {
    const her = op(1, 'char_4039_horn', 4, 10, dir);
    const other = op(2, 'char_other', 5, 10, dir);
    const s = await setup({
      index: hornIndex(installed, sid),
      record: (info) => rec(info.defId === 'char_other' ? 'skchr_other_1' : sid),
      units: [her, other], active,
    });
    if (skillOn && active) s.w.skill(s.views.get(1), true);
    return s;
  }
  const facing = (handles, back, front) => ({
    back: handles.filter((h) => h.key === back).length,
    front: handles.filter((h) => h.key === front).length,
  });

  test('UP plays only _back; RIGHT and DOWN play only _front; the loop ends with the skill', async () => {
    const up = await horn('UP');
    assert.equal(up.w.simFx('overload', 4, 10, { id: 1 }), true);
    assert.deepEqual(facing(up.handles, HORN2_BACK, HORN2_FRONT), { back: 1, front: 0 });
    const loop = up.handles.find((h) => h.key === HORN2_BACK);
    assert.equal(loop.opts.loop, true);
    assert.equal(loop.opts.owner, up.views.get(1));
    up.w.skill(up.views.get(1), false);
    assert.equal(loop.alive, false, 'until skill');

    const right = await horn('RIGHT');
    assert.equal(right.w.simFx('overload', 4, 10, { id: 1 }), true);
    assert.deepEqual(facing(right.handles, HORN2_BACK, HORN2_FRONT), { back: 0, front: 1 });
    const down = await horn('DOWN', { sid: 'skchr_horn_3' });
    assert.equal(down.w.simFx('overload', 4, 10, { id: 1 }), true);
    assert.deepEqual(facing(down.handles, HORN3_BACK, HORN3_FRONT), { back: 0, front: 1 });
    const left = await horn('LEFT', { sid: 'skchr_horn_3' });
    assert.equal(left.w.simFx('overload', 4, 10, { id: 1 }), true);
    assert.deepEqual(facing(left.handles, HORN3_BACK, HORN3_FRONT), { back: 0, front: 1 });
  });

  test('a missing chosen facing does not fall through; another operator and 官方特效 off stay procedural', async () => {
    const up = await horn('UP', { installed: [HORN2_FRONT] });
    assert.equal(up.w.simFx('overload', 4, 10, { id: 1 }), false);
    assert.deepEqual(facing(up.handles, HORN2_BACK, HORN2_FRONT), { back: 0, front: 0 });
    const idle = await horn('RIGHT', { skillOn: false });
    assert.equal(idle.w.simFx('overload', 4, 10, { id: 1 }), false);
    const other = await horn('RIGHT');
    assert.equal(other.w.simFx('overload', 5, 10, { id: 2 }), false);
    const dark = await horn('UP', { active: false });
    assert.equal(dark.w.simFx('overload', 4, 10, { id: 1 }), false);
    assert.equal(dark.handles.length, 0);
  });
});

describe('流明 S1 沐雨', () => {
  function lumenIndex(installed) {
    const all = { [LUMEN_HIT]: { looping: false, spawn: 2 }, [LUMEN_RANGE]: { looping: true, spawn: 1 } };
    const prefabs = {};
    for (const k of installed) prefabs[k] = all[k];
    const skill = bare('skchr_lumen_1');
    skill.uses = [
      { role: 'loop', keys: [LUMEN_RANGE], from: 'RangedHeal._activeBuffs → template lumen_s_1', node: 'skchr_lumen_1', event: 'ON_BUFF_START', action: 'CreateBuff', buff: 'lumen_s_1', on: 'targets', life: { type: 'IMMEDIATELY' } },
      { role: 'trigger', keys: [LUMEN_HIT], from: 'RangedAttack._activeBuffs → template lumen_s_1[heal]', node: 'aura', event: 'ON_BUFF_TRIGGER', action: 'CreateEffect', buff: 'lumen_s_1[heal]', on: 'targets', life: { type: 'INFINITY' } },
    ];
    return makeIndex({
      char_4042_lumen: { kind: 'char', skills: { skchr_lumen_1: skill }, talents: {}, modes: [] },
      char_other: { kind: 'char', skills: { skchr_other_1: bare('skchr_other_1') }, talents: {}, modes: [] },
    }, { prefabs });
  }
  const sparks = (handles) => handles.filter((h) => h.key === LUMEN_HIT);

  test('the spark pulses at the field for projectile_life_time and does not replay the range', async () => {
    const her = op(1, 'char_4042_lumen', 3, 10);
    const { w, ofx, handles } = await setup({
      index: lumenIndex([LUMEN_HIT, LUMEN_RANGE]),
      record: (info) => rec(info.defId === 'char_4042_lumen' ? 'skchr_lumen_1' : 'skchr_other_1', { projectile_life_time: 2, interval: 1 }),
      units: [her, op(2, 'char_other', 6, 10)],
    });
    w.skill(her, true);
    assert.equal(handles.some((h) => h.key === LUMEN_RANGE), false, 'the range is a target buff, not this binding');
    assert.equal(w.simFx('healField', 5, 12, { id: 1 }), true);
    assert.equal(sparks(handles).length, 1);
    assert.equal(sparks(handles)[0].opts.owner.id, 'fx:point');
    assert.equal(sparks(handles)[0].opts.owner.x, 5);
    assert.equal(sparks(handles)[0].opts.owner.y, 12);
    assert.equal(handles.filter((h) => h.key === LUMEN_RANGE).length, 0);
    ofx.time += 1; w.tick();
    assert.equal(sparks(handles).length, 2);
    ofx.time += 1; w.tick();
    assert.equal(sparks(handles).length, 2, 'life 2 / interval 1');
    assert.equal(w.simFx('healField', 5, 12, { id: 2 }), false, 'another operator');
  });

  test('a missing spark falls through to the heal-field cover; neither prefab leaves the procedural field', async () => {
    const covered = await setup({
      index: lumenIndex([LUMEN_RANGE]),
      record: () => rec('skchr_lumen_1', { projectile_life_time: 4, interval: 1 }),
      units: [op(1, 'char_4042_lumen', 3, 10)],
    });
    covered.w.skill(covered.views.get(1), true);
    assert.equal(covered.w.simFx('healField', 5, 12, { id: 1 }), true, 'FX_COVER');
    assert.equal(sparks(covered.handles).length, 0);
    const bareField = await setup({
      index: lumenIndex([]),
      record: () => rec('skchr_lumen_1'),
      units: [op(1, 'char_4042_lumen', 3, 10)],
    });
    bareField.w.skill(bareField.views.get(1), true);
    assert.equal(bareField.w.simFx('healField', 5, 12, { id: 1 }), false);
    const idle = await setup({
      index: lumenIndex([LUMEN_HIT, LUMEN_RANGE]),
      record: () => rec('skchr_lumen_1', { projectile_life_time: 4 }),
      units: [op(1, 'char_4042_lumen', 3, 10)],
    });
    assert.equal(idle.w.simFx('healField', 5, 12, { id: 1 }), false, 'skill off');
    assert.equal(sparks(idle.handles).length, 0);
    const dark = await setup({
      index: lumenIndex([LUMEN_HIT, LUMEN_RANGE]),
      record: () => rec('skchr_lumen_1'),
      units: [op(1, 'char_4042_lumen', 3, 10)], active: false,
    });
    assert.equal(dark.w.simFx('healField', 5, 12, { id: 1 }), false);
    assert.equal(dark.handles.length, 0);
  });
});

describe('斥罪 S2 坚心苦修', () => {
  const index = makeIndex({
    char_4065_judge: { kind: 'char', skills: { skchr_judge_2: bare('skchr_judge_2') }, talents: {}, modes: [] },
  }, { prefabs: { [JUDGE_HIT]: { looping: false, spawn: 2 }, [JUDGE_WEAPON]: { looping: false, spawn: 1, follow: 5 } } });

  test('both oneshots play on her, and only for her atonement tag', async () => {
    const her = op(1, 'char_4065_judge', 4, 11);
    const { w, handles } = await setup({ index, record: () => rec('skchr_judge_2'), units: [her] });
    w.skill(her, true);
    const before = handles.length;
    assert.equal(w.simFx('aoe', her.x, her.y, { id: 1, radius: 1.5, skill: 'judge:atonement' }), true);
    const spawned = handles.slice(before);
    assert.deepEqual(spawned.map((h) => h.key).sort(), [JUDGE_HIT, JUDGE_WEAPON].sort());
    assert.ok(spawned.every((h) => h.opts.owner === her && h.opts.loop === false));
    const n = handles.length;
    assert.equal(w.simFx('aoe', her.x, her.y, { id: 1, radius: 1.5, skill: 'other' }), false);
    assert.equal(w.simFx('aoe', her.x, her.y, { id: 1, radius: 1.5 }), false);
    assert.equal(handles.length, n);
  });

  test('the skill off and 官方特效 off stay procedural', async () => {
    const idle = await setup({ index, record: () => rec('skchr_judge_2'), units: [op(1, 'char_4065_judge', 4, 11)] });
    assert.equal(idle.w.simFx('aoe', 4, 11, { id: 1, skill: 'judge:atonement' }), false);
    assert.equal(idle.handles.filter((h) => h.key === JUDGE_HIT || h.key === JUDGE_WEAPON).length, 0);
    const dark = await setup({ index, record: () => rec('skchr_judge_2'), units: [op(1, 'char_4065_judge', 4, 11)], active: false });
    assert.equal(dark.w.simFx('aoe', 4, 11, { id: 1, skill: 'judge:atonement' }), false);
    assert.equal(dark.handles.length, 0);
  });
});

describe('伊内丝 S3 独影归途', () => {
  function inesIndex(installed) {
    const prefabs = {};
    for (const k of installed) prefabs[k] = { looping: false };
    const proj = {
      [INES_PROJ]: {
        main: INES_TRAIL, onHit: [INES_ONHIT], onReached: [INES_REACH, INES_REACH_RANGE],
        movement: { class: 'AdvancedMovement', speed: 10 },
        behaviours: [
          { class: 'HarpoonProjectile', fields: { _mainEffect: INES_TRAIL } },
          { class: 'HarpoonRenderer', fields: { _mainEffect: 'ines_skill_03_pullLabel_line_01', _useEndPointAsStartPos: 1 } },
        ],
      },
    };
    return makeIndex({
      char_4087_ines: { kind: 'char', skills: { skchr_ines_3: { ...bare('skchr_ines_3'), projectiles: [INES_PROJ] } }, talents: {}, modes: [] },
      char_other: { kind: 'char', skills: { skchr_other_1: bare('skchr_other_1') }, talents: {}, modes: [] },
    }, { prefabs, projectiles: proj });
  }
  const all = [INES_TRAIL, INES_ROPE, INES_REACH, INES_REACH_RANGE, INES_ONHIT];

  test('the label flies from the sentry back to her; the rope starts at her; arrival is onReached, not onHit', async () => {
    const her = op(1, 'char_4087_ines', 6, 10);
    const { w, handles, frame } = await setup({
      index: inesIndex(all),
      record: (info) => rec(info.defId === 'char_4087_ines' ? 'skchr_ines_3' : 'skchr_other_1'),
      units: [her, op(2, 'char_other', 1, 10)],
    });
    assert.deepEqual(bindingKeys(inesIndex(all), 'skchr_ines_3').sort(), [INES_TRAIL, INES_ROPE, INES_REACH, INES_REACH_RANGE].sort());
    w.skill(her, true);
    assert.equal(w.simFx('beam', 2, 10, { id: 1, tx: 6, ty: 10 }), true);
    const trail = handles.find((h) => h.key === INES_TRAIL);
    const rope = handles.find((h) => h.key === INES_ROPE);
    assert.ok(trail && rope);
    nearPoint(trail.place.pos, boardToUnity(2, 10, 0));
    assert.equal(trail.yaw, 0);
    nearPoint(rope.lines.from, boardToUnity(6, 10, 0));
    nearPoint(rope.lines.to, boardToUnity(2, 10, 0));
    frame(0.2);
    nearPoint(trail.anchor, boardToUnity(4, 10, 0));
    assert.equal(trail.stopped, undefined);
    frame(0.2);
    assert.ok(trail.stopped && rope.stopped);
    nearPoint(trail.anchor, boardToUnity(6, 10, 0));
    const arrived = handles.filter((h) => h.key === INES_REACH || h.key === INES_REACH_RANGE);
    assert.equal(arrived.length, 2);
    assert.ok(arrived.every((h) => h.opts.owner === her));
    assert.equal(handles.some((h) => h.key === INES_ONHIT), false);
    assert.equal(w.simFx('beam', 2, 10, { id: 2, tx: 6, ty: 10 }), false, 'another operator');
  });

  test('no end point, no prefab, the skill off, and 官方特效 off stay the procedural beam', async () => {
    const her = op(1, 'char_4087_ines', 6, 10);
    const on = await setup({ index: inesIndex(all), record: () => rec('skchr_ines_3'), units: [her] });
    on.w.skill(her, true);
    const n = on.handles.length;
    assert.equal(on.w.simFx('beam', 2, 10, { id: 1 }), false);
    assert.equal(on.handles.length, n);
    const bareFly = await setup({ index: inesIndex([]), record: () => rec('skchr_ines_3'), units: [her] });
    bareFly.w.skill(her, true);
    assert.equal(bareFly.w.simFx('beam', 2, 10, { id: 1, tx: 6, ty: 10 }), false);
    assert.equal(bareFly.handles.some((h) => h.key === INES_TRAIL || h.key === INES_ROPE), false);
    const idle = await setup({ index: inesIndex(all), record: () => rec('skchr_ines_3'), units: [her] });
    assert.equal(idle.w.simFx('beam', 2, 10, { id: 1, tx: 6, ty: 10 }), false);
    const dark = await setup({ index: inesIndex(all), record: () => rec('skchr_ines_3'), units: [her], active: false });
    assert.equal(dark.w.simFx('beam', 2, 10, { id: 1, tx: 6, ty: 10 }), false);
    assert.equal(dark.handles.length, 0);
  });
});

describe('望 S2 / S3 与棋子', () => {
  function wangIndex(sid) {
    const prefabs = {
      [WANG2_HIT]: { looping: false, spawn: 2 },
      [WANG3_HIT]: { looping: false, spawn: 2 },
      [WANG3_HIT2]: { looping: false, spawn: 2 },
      [WANG_BUFF]: { looping: true },
      [WANG_BUFF2]: { looping: true },
    };
    const tok = bare('sktok_wang_2');
    return makeIndex({
      char_2027_wang: { kind: 'char', skills: { [sid]: bare(sid) }, talents: {}, modes: [] },
      token_10064_wang_stone1: {
        kind: 'token',
        skills: { sktok_wang_1: bare('sktok_wang_1'), sktok_wang_2: tok, sktok_wang_3: bare('sktok_wang_3') },
        talents: {}, modes: [],
      },
    }, { prefabs });
  }
  const of = (sid) => setup({
    index: wangIndex(sid),
    record: (info) => (info.defId === 'char_2027_wang' ? rec(sid, {}, sid.endsWith('3') ? 2 : 1) : null),
    units: [op(1, 'char_2027_wang', 3, 10, 'RIGHT', { skillIndex: sid.endsWith('3') ? 2 : 1 }), op(2, 'token_10064_wang_stone1', 5, 11, 'RIGHT', { kind: 'token' })],
  });

  test('连星 plays the hit once for a 跟子 and once for a 棋子, not for 望 S1', async () => {
    const { w, handles } = await of('skchr_wang_2');
    assert.equal(w.simFx('explode', 3, 10, { id: 1, src: 1, skill: 'wang_2' }), true);
    assert.equal(handles.filter((h) => h.key === WANG2_HIT).length, 1);
    assert.equal(handles.at(-1).opts.owner.id, 'fx:point');
    assert.equal(handles.at(-1).opts.owner.x, 3);
    assert.equal(w.simFx('explode', 5, 11, { id: 2, src: 1, skill: 'wang_2' }), true);
    assert.equal(handles.filter((h) => h.key === WANG2_HIT).length, 2, 'the stone does not add a second copy');
    const n = handles.length;
    assert.equal(w.simFx('explode', 4, 10, { id: 1, src: 1, skill: 'wang_1' }), false);
    assert.equal(w.simFx('explode', 5, 11, { id: 2, skill: 'wang_2' }), false, 'a stone with no skill id and no src');
    assert.equal(handles.length, n);
  });

  test('天下劫 plays the two oneshots at the point and not the looping tile marks, with the skill off', async () => {
    const { w, handles } = await of('skchr_wang_3');
    assert.equal(w.skills.of(w.view ? null : null), null);
    const her = [...w.skills.units.values()].find((u) => u && u.skillId === 'skchr_wang_3');
    assert.ok(her);
    assert.equal(her.on, null, 'no during: equipped, not cast');
    assert.equal(w.simFx('explode', 5, 11, { id: 2, src: 1, skill: 'wang_3' }), true);
    assert.deepEqual(handles.map((h) => h.key).sort(), [WANG3_HIT, WANG3_HIT2].sort());
    assert.ok(handles.every((h) => h.opts.loop === false && h.opts.owner.x === 5 && h.opts.owner.y === 11));
    assert.equal(handles.some((h) => h.key === WANG_BUFF || h.key === WANG_BUFF2), false);
  });
});
