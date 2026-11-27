// test/render/vfx-r86-f4.test.js — round 86 lane f4 (operators char_4100–char_4199). The bindings in
// public/js/render/vfx/skills.js (the round 86 f4 block) play the official prefab on the kit event that
// stands for that moment, and play nothing when 官方特效 is off.
//
// 锏 S2: AnimatedActionToTargetAbility is not an attack, so blkkgt_skill_02_hit_1 never rode a plan attack.
// `strike` plays it on each later unclaimed HP hit of the slash's frame.
// 阿斯卡纶 S2: the death 'aoe' (skill ascln:endowment) is ascln_skill_02_death_01 at the corpse. The circle
// debuff ascln_buff_01 has no per-target event and is not played.
// 乌尔比安 S3: 'anchor' flies projectile_chr_ulpia_s3; the landing plays ulpia_skill_03_range_01. S1's anchor
// does not. A `flight` binding does not hold the reached effect early, and bindsReached does not swallow it.
// 信仰搅拌机 S2: the fatal 'shield' tagged rmixer:s2 follows her with rmixer_skill_02_start_02 until the skill
// ends. The talent's untagged 'shield' does not.
// Miss.Christine S2: the cosmetic 'zone' (skill christ:spirit) flies projectile_chr_christ_s2 at the throw.
// christ_skill_02_range waits for the landing (`arrive`, round 87); christ_skill_02_hit_02 still plays then.
// 锡人 S2's tick, 锏 S2's hit and 阿斯卡纶's death burst are claimed (reason 'bound'). The dread loop is not.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FxWiring } from '../../public/js/render/vfx/wiring.js';
import { FX_BINDINGS, bindingKeys, skillPlan } from '../../public/js/render/vfx/skills.js';

const HIT = 'blkkgt_skill_02_hit_1';
const DEATH = 'ascln_skill_02_death_01';
const DREAD = 'ascln_buff_01';
const U_TRAIL = 'ulpia_skill_03_trail_01';
const U_RANGE = 'ulpia_skill_03_range_01';
const U_CAST = 'ulpia_skill_03_range_02';
const U_PROJ = 'projectile_chr_ulpia_s3';
const GUARD = 'rmixer_skill_02_start_02';
const C_TRAIL = 'christ_skill_02_trail_01';
const C_RANGE = 'christ_skill_02_range';
const C_HIT = 'christ_skill_02_hit_02';
const C_PROJ = 'projectile_chr_christ_s2';
const ALL = [HIT, DEATH, DREAD, U_TRAIL, U_RANGE, U_CAST, GUARD, C_TRAIL, C_RANGE, C_HIT];
const LOOPING = new Set([DREAD, GUARD, C_TRAIL, C_RANGE, U_TRAIL, U_CAST]);

function skillNode(id, extra = {}) {
  return {
    rootClass: 'CastSkill', rootAbility: extra.rootAbility || 'ActiveBuffAbility', effects: [], projectiles: extra.projectiles || [],
    mode: extra.mode ?? null, abilities: extra.abilities || [], unclassified: [], roles: {}, uses: extra.uses || [],
  };
}

function makeIndex(installed = ALL) {
  const prefabs = Object.fromEntries(installed.map((k) => [k, { file: `prefabs/${k}.json`, looping: LOOPING.has(k), spawn: 1 }]));
  const blkkgt2 = skillNode('skchr_blkkgt_2', {
    rootAbility: 'AnimatedActionToTargetAbility',
    abilities: [{ node: 'skchr_blkkgt_2', class: 'AnimatedActionToTargetAbility', animKey: 'Skill_2' }],
    uses: [{ role: 'hit', keys: [HIT], from: 'UberEffectEmitter._hitEffects', node: 'skchr_blkkgt_2', ability: 'AnimatedActionToTargetAbility', endEvent: 'ON_CAST_END', oneshot: false, list: 'hit' }],
  });
  const ascln2 = skillNode('skchr_ascln_2', { mode: 1, uses: [
    { role: 'trigger', event: 'ON_OWNER_KILLED', action: 'CreateEffect', keys: [DEATH], node: 'Aura', on: 'targets', buff: 'ascln_s_2[enemy]' },
  ] });
  const ulpia3 = skillNode('skchr_ulpia_3', {
    rootAbility: 'UlpiaS3CastSkill', mode: 2, projectiles: [U_PROJ],
    abilities: [{ node: 'AOEAttack', class: 'ProjectileToTileWithExtraActionsAbility', projectileKey: U_PROJ }],
    uses: [{ role: 'range', keys: [U_CAST], from: 'UberEffectEmitter._castEffects', node: 'AOEAttack', ability: 'ProjectileToTileWithExtraActionsAbility', list: 'cast' }],
  });
  const ulpia1 = skillNode('skchr_ulpia_1');
  const rmixer2 = skillNode('skchr_rmixer_2', { mode: 1, uses: [
    { role: 'trigger', event: 'ON_BEFORE_TRY_SET_HP_ZERO', action: 'CreateEffect', keys: [GUARD], node: 'skchr_rmixer_2', on: 'owner', buff: 'rmixer_sk2[attr]' },
  ] });
  const christ2 = skillNode('skchr_christ_2', {
    mode: 2, projectiles: [C_PROJ],
    abilities: [{ node: 'skchr_christ_2', class: 'ProjectileToTileAbility', projectileKey: C_PROJ }],
    uses: [{ role: 'loop', keys: ['christ_skill_02_buff_01'], node: 'skchr_christ_2', on: 'owner' }],
  });
  const unit = (skills) => ({ kind: 'char', talents: {}, startEffect: null, deadEffect: null, skills, modes: [{ name: 'Default', attack: null, combat: null }] });
  const skills = { skchr_blkkgt_2: blkkgt2, skchr_ascln_2: ascln2, skchr_ulpia_3: ulpia3, skchr_ulpia_1: ulpia1, skchr_rmixer_2: rmixer2, skchr_christ_2: christ2 };
  return {
    units: {
      char_4116_blkkgt: unit({ skchr_blkkgt_2: blkkgt2 }),
      char_4132_ascln: unit({ skchr_ascln_2: ascln2 }),
      char_4145_ulpia: unit({ skchr_ulpia_1: ulpia1, skchr_ulpia_3: ulpia3 }),
      char_4194_rmixer: unit({ skchr_rmixer_2: rmixer2 }),
      char_4198_christ: unit({ skchr_christ_2: christ2 }),
    },
    projectiles: {
      [U_PROJ]: { main: U_TRAIL, onReached: [U_RANGE], onHit: [], movement: { class: 'AdvancedMovement', speed: 15 }, effects: [U_TRAIL, U_RANGE] },
      [C_PROJ]: { main: C_TRAIL, onReached: [C_RANGE], onHit: [C_HIT], movement: { class: 'ParacurveMovement', speed: 8 }, effects: [C_TRAIL, C_RANGE, C_HIT] },
    },
    skills, skins: {}, generic: { hit: {}, die: {}, birth: {}, status: {}, keys: [] }, prefabs,
  };
}

const RECS = {
  char_4116_blkkgt: { skillId: 'skchr_blkkgt_2', duration: 0, durationType: 'NONE', bb: {} },
  char_4132_ascln: { skillId: 'skchr_ascln_2', index: 1, duration: 20, bb: {} },
  char_4145_ulpia: { skillId: 'skchr_ulpia_3', index: 2, duration: 25, bb: {} },
  'char_4145_ulpia#1': { skillId: 'skchr_ulpia_1', index: 0, duration: 0, bb: {} },
  char_4194_rmixer: { skillId: 'skchr_rmixer_2', index: 1, duration: 30, durationType: 'AMMO', bb: {} },
  char_4198_christ: { skillId: 'skchr_christ_2', index: 1, duration: 20, bb: { projectile_delay_time: 20, interval: 1 } },
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
    record: (info) => ({ charId: info.defId, skill: RECS[info.fxRec] || RECS[info.defId] }),
    view: (id) => views.get(id) || null,
  });
  await w.ready();
  const view = (defId, x, y, extra = {}) => {
    const id = seq++;
    const { info: infoExtra, ...rest } = extra;
    const v = {
      id, x, y, z: 0, visFacing: 1, isEnemy: false, alive: true, flags: 0, sp: 0, spMax: 30, dir: 'RIGHT',
      ...rest,
      info: { id, spine: defId, defId, side: 'ally', kind: 'op', skillIndex: 0, ...infoExtra },
    };
    views.set(id, v);
    return v;
  };
  const frame = (dt = 1 / 30) => {
    w.sync(views.values()); w.tick(); ofx.time += dt;
    for (const h of handles) if (!h.stopped && typeof h.opts?.track === 'function') { h.time += dt; h.opts.track(h); }
  };
  const fly = (pred, frames = 90) => {
    for (let i = 0; i < frames && !handles.some(pred); i++) frame();
  };
  await w.begin([]);
  frame();
  return { w, ofx, view, frame, fly, handles, index, keys: () => handles.map((h) => h.key) };
}

describe('round 86 lane f4 bindings', () => {
  test('the block names the five wired skills and leaves 锡人 S2 on its existing hits entry', () => {
    const b2 = FX_BINDINGS.skchr_blkkgt_2.slash;
    assert.deepEqual([b2.owner, b2.strike, b2.during, [...b2.keys]], ['id', true, true, [HIT]]);
    assert.equal(FX_BINDINGS.skchr_blkkgt_3.slash.attack, 'Damage');
    assert.equal(FX_BINDINGS.skchr_blkkgt_3.slash.strike, undefined);
    const a = FX_BINDINGS.skchr_ascln_2.aoe;
    assert.deepEqual([a.at, a.oneshot, a.tag, [...a.keys]], ['point', true, 'ascln:endowment', [DEATH]]);
    const u = FX_BINDINGS.skchr_ulpia_3.anchor;
    assert.deepEqual([u.flight, u.fly, u.projectile, u.during], [true, undefined, U_PROJ, true]);
    const r = FX_BINDINGS.skchr_rmixer_2.shield;
    assert.deepEqual([r.hold, r.tag, r.during, [...r.keys]], ['skill', 'rmixer:s2', true, [GUARD]]);
    const c = FX_BINDINGS.skchr_christ_2.zone;
    assert.deepEqual([c.fly, c.tag, c.projectile, [...(c.cover || [])]], [true, 'christ:spirit', C_PROJ, ['zone']]);
    assert.deepEqual([...FX_BINDINGS.skchr_tinman_2.zone.hits], ['tinman_skill_02_hit_01']);
  });

  test('锏 S2 plays the hit on each unclaimed HP damage of the slash frame, and not on an ally or a heal', async () => {
    const { w, view, keys } = await setup();
    const her = view('char_4116_blkkgt', 4, 9);
    const foe = view('enemy_dummy', 5, 9, { isEnemy: true, info: { side: 'enemy', kind: 'enemy' } });
    const ally = view('char_4116_blkkgt', 3, 9);
    w.skill(her, true);
    assert.equal(w.simFx('slash', her.x, her.y, { id: her.id, n: 1 }), true);
    assert.deepEqual(keys().filter((k) => k === HIT), [], 'the spark waits for the damage');
    assert.equal(w.damage(foe, 'phys', null, 0), true);
    assert.equal(w.damage(foe, 'phys', null, 0), true);
    assert.equal(keys().filter((k) => k === HIT).length, 2, 'once per slash, as the hit list does');
    const before = keys().length;
    assert.equal(w.damage(ally, 'phys', null, 0), false);
    assert.equal(w.skills.seen(foe, true, false), false);
    assert.equal(keys().length, before);
  });

  test('锏 S2 plays nothing with 官方特效 off, with the prefab missing, or before the skill is on', async () => {
    const off = await setup({ active: false });
    const her = off.view('char_4116_blkkgt', 4, 9);
    off.w.skill(her, true);
    assert.equal(off.w.simFx('slash', 4, 9, { id: her.id }), false);
    assert.equal(off.keys().length, 0);
    const bare = await setup({ installed: ALL.filter((k) => k !== HIT) });
    const b = bare.view('char_4116_blkkgt', 4, 9);
    bare.w.skill(b, true);
    assert.equal(bare.w.simFx('slash', 4, 9, { id: b.id }), false);
    const { w, view } = await setup();
    const late = view('char_4116_blkkgt', 4, 9);
    assert.equal(w.simFx('slash', 4, 9, { id: late.id }), false, 'the skill is not on');
  });

  test('阿斯卡纶 S2 plays the death burst at the corpse only for the endowment aoe', async () => {
    const { w, view, handles, keys } = await setup();
    const her = view('char_4132_ascln', 4, 9, { info: { skillIndex: 1 } });
    w.skill(her, true);
    assert.equal(w.simFx('aoe', 6, 10, { id: her.id, radius: 1.3, skill: 'ascln:endowment' }), true);
    assert.deepEqual(keys(), [DEATH]);
    assert.notEqual(handles[0].opts.loop, true, 'oneshot, duration 6.5');
    assert.equal(w.simFx('aoe', 6, 10, { id: her.id, radius: 1.3 }), false, 'another aoe of hers is not the kill burst');
    assert.ok(!keys().includes(DREAD));
  });

  test('乌尔比安 S3 flies the anchor; the landing burst plays when it arrives; S1 does not', async () => {
    const { w, view, fly, handles, keys, index } = await setup();
    const him = view('char_4145_ulpia', 3, 9, { info: { skillIndex: 2 } });
    w.skill(him, true);
    const before = keys().length;
    const castN = keys().filter((k) => k === U_CAST).length;
    assert.equal(w.simFx('anchor', 6, 9, { id: him.id, fromX: 3, fromY: 9, r: 1.2 }), true);
    assert.ok(keys().includes(U_TRAIL));
    assert.ok(!keys().slice(before).includes(U_RANGE), 'the burst waits for the landing');
    assert.equal(w.skills.bindsReached(him, index.projectiles[U_PROJ]), false);
    fly((h) => h.key === U_RANGE);
    assert.equal(keys().filter((k) => k === U_RANGE).length, 1);
    assert.equal(keys().filter((k) => k === U_CAST).length, castN, 'the cast range is the skill start, not the anchor');
    const s1 = view('char_4145_ulpia', 3, 8, { info: { skillIndex: 0, fxRec: 'char_4145_ulpia#1' } });
    w.skill(s1, true);
    const n = keys().filter((k) => k === U_TRAIL).length;
    assert.equal(w.simFx('anchor', 6, 8, { id: s1.id, fromX: 3, fromY: 8 }), false);
    assert.equal(keys().filter((k) => k === U_TRAIL).length, n);
    assert.ok(handles.some((h) => h.key === U_TRAIL && h.opts.track), 'the trail is a flight');
  });

  test('乌尔比安 S3 with the trail missing leaves the procedural anchor', async () => {
    const { w, view, keys } = await setup({ installed: ALL.filter((k) => k !== U_TRAIL) });
    const him = view('char_4145_ulpia', 3, 9, { info: { skillIndex: 2 } });
    w.skill(him, true);
    assert.equal(w.simFx('anchor', 6, 9, { id: him.id }), false);
    assert.equal(keys().includes(U_RANGE), false);
  });

  test('信仰搅拌机 S2 plays the guard on the tagged fatal shield and stops it with the skill', async () => {
    const { w, view, handles, keys } = await setup();
    const her = view('char_4194_rmixer', 4, 9, { info: { skillIndex: 1 } });
    w.skill(her, true);
    assert.equal(w.simFx('shield', her.x, her.y, { id: her.id }), false, 'the talent shield has no skill tag');
    assert.equal(w.simFx('shield', her.x, her.y, { id: her.id, n: 30, skill: 'rmixer:s2' }), true);
    const h = handles.find((x) => x.key === GUARD);
    assert.ok(h && h.opts.loop === true && typeof h.opts.track === 'function', 'a looping follow on her until the skill ends');
    assert.equal(keys().filter((k) => k === GUARD).length, 1);
    w.skill(her, false);
    assert.ok(h.stopped, 'the skill buff ended, so the looping guard stops');
  });

  test('Miss.Christine S2 flies the trail at the throw and starts the range once when the flask lands', async () => {
    const { w, view, fly, keys } = await setup();
    const her = view('char_4198_christ', 4, 9, { info: { skillIndex: 1 } });
    w.skill(her, true);
    assert.equal(w.simFx('zone', 6, 9, { id: her.id, radius: 1.5, dur: 20 }), false, 'an untagged zone is not the spirit');
    assert.equal(w.simFx('zone', 6, 9, { id: her.id, radius: 1.5, dur: 20, skill: 'christ:spirit' }), true);
    assert.ok(keys().includes(C_TRAIL));
    assert.ok(!keys().includes(C_RANGE), 'the range waits for the landing');
    assert.ok(!keys().includes(C_HIT), 'the hit waits for the landing');
    fly((h) => h.key === C_HIT);
    assert.equal(keys().filter((k) => k === C_HIT).length, 1);
    assert.equal(keys().filter((k) => k === C_RANGE).length, 1, 'the range starts once, when the flask lands');
  });

  test('Miss.Christine S2 plays nothing with 官方特效 off', async () => {
    const { w, view, keys } = await setup({ active: false });
    const her = view('char_4198_christ', 4, 9, { info: { skillIndex: 1 } });
    w.skill(her, true);
    assert.equal(w.simFx('zone', 6, 9, { id: her.id, radius: 1.5, dur: 20, skill: 'christ:spirit' }), false);
    assert.equal(keys().length, 0);
  });
});

const F4_INDEX = 'public/assets/local/fx/index.json';
// the official effects are local art (never in the repo, absent on CI): these checks need an extraction on this machine
describe('round 86 lane f4 against the extracted index', { skip: !fs.existsSync(F4_INDEX) && 'no public/assets/local/fx/index.json' }, () => {
  const idx = fs.existsSync(F4_INDEX) ? JSON.parse(fs.readFileSync(F4_INDEX, 'utf8')) : null;

  test('乌尔比安 S3 and Miss.Christine S2 have no attack to fly the projectile, and the binding keys cover it', () => {
    const ulpia = skillPlan(idx, 'char_4145_ulpia', 'skchr_ulpia_3', { rec: { skillId: 'skchr_ulpia_3', duration: 25 } });
    assert.equal(ulpia.attacks.length, 0);
    assert.ok(ulpia.projectiles.includes(U_PROJ));
    const ub = new Set(bindingKeys(idx, 'skchr_ulpia_3'));
    assert.ok(ub.has(U_TRAIL) && ub.has(U_RANGE));
    const christ = skillPlan(idx, 'char_4198_christ', 'skchr_christ_2', { rec: { skillId: 'skchr_christ_2', duration: 20 } });
    assert.equal(christ.attacks.length, 0);
    assert.ok(christ.projectiles.includes(C_PROJ));
    const cb = new Set(bindingKeys(idx, 'skchr_christ_2'));
    assert.ok(cb.has(C_TRAIL) && cb.has(C_RANGE));
  });

  test('claimed rows are bound; 阿斯卡纶\'s dread loop stays conditional', () => {
    const tin = skillPlan(idx, 'char_4151_tinman', 'skchr_tinman_2', { rec: { skillId: 'skchr_tinman_2', duration: -1 } });
    const tinHit = tin.unmapped.filter((u) => u.key === 'tinman_skill_02_hit_01');
    assert.ok(tinHit.length > 0 && tinHit.every((u) => u.reason === 'bound'));
    assert.ok(bindingKeys(idx, 'skchr_tinman_2').includes('tinman_skill_02_hit_01'));
    const blk = skillPlan(idx, 'char_4116_blkkgt', 'skchr_blkkgt_2', { rec: { skillId: 'skchr_blkkgt_2', duration: 0 } });
    assert.equal(blk.attacks.length, 0);
    const blkHit = blk.unmapped.filter((u) => u.key === HIT);
    assert.ok(blkHit.length > 0 && blkHit.every((u) => u.reason === 'bound'));
    const asc = skillPlan(idx, 'char_4132_ascln', 'skchr_ascln_2', { rec: { skillId: 'skchr_ascln_2', duration: 20 } });
    const death = asc.unmapped.filter((u) => u.key === DEATH);
    assert.ok(death.length > 0 && death.every((u) => u.reason === 'bound'));
    assert.ok(asc.unmapped.some((u) => u.key === DREAD && u.reason === 'conditional'));
  });
});
