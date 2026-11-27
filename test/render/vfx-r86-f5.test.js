// test/render/vfx-r86-f5.test.js — round 86 lane f5. Official effects for 折桠 S2's hit, 娜斯提 S1's
// after-end loop, 乌啾 S2's 迷彩 / heal tick, 可露希尔's 指挥中心 range, 机械师 S2's token buff and S3's
// charge trails. Synthetic index. With 官方特效 off nothing of this plays, and the generic 隐匿 icon stays.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FxWiring } from '../../public/js/render/vfx/wiring.js';
import { FX_BINDINGS, bindingKeys } from '../../public/js/render/vfx/skills.js';
import { fxSpec } from '../../public/js/render/fx/kinds.js';
import { UF } from '../../shared/constants.js';
import { stealthIconCovered } from '../../public/js/render/vfx/stealthcover.js';
import { UnitView } from '../../public/js/render/units.js';

const CAMOU = 'turdus_skill_02_buff_01';
const HOT = 'turdus_skill_02_hit_01';
const BRANCH = 'branch_skill_02_hit_01';
const NASTI = 'nasti_skill_01_common_buff_01';
const NASTI_SIB = 'nasti_other_loop';
const RANGE2 = 'token_closur_ourbase_range_02_loop';
const RANGE3 = 'token_closur_ourbase_range_03_loop';
const MCN_BUFF = 'mcnist_skill_02_buff_01';
const HIT = 'token_mcnist_mcgraf_skill_03_hit_01';
const TRAILS = {
  LEFT: 'token_mcnist_mcgraf_skill_03_trail_01_left',
  RIGHT: 'token_mcnist_mcgraf_skill_03_trail_01_right',
  UP: 'token_mcnist_mcgraf_skill_03_trail_02_up_left',
  UP_RIGHT: 'token_mcnist_mcgraf_skill_03_trail_02_up_right',
  DOWN: 'token_mcnist_mcgraf_skill_03_trail_03_down_left',
  DOWN_RIGHT: 'token_mcnist_mcgraf_skill_03_trail_03_down_right',
};
const PROJS = {
  LEFT: 'projectile_chr_mcnist_s3_token',
  RIGHT: 'projectile_chr_mcnist_s3_token_right',
  UP: 'projectile_chr_mcnist_s3_token_up',
  UP_RIGHT: 'projectile_chr_mcnist_s3_token_up_right',
  DOWN: 'projectile_chr_mcnist_s3_token_down',
  DOWN_RIGHT: 'projectile_chr_mcnist_s3_token_down_right',
};
const BASE = 'token_10066_closur_ourbase';
const GRAF = 'token_10069_mcnist_mcgraf';
const MODE = 'mode_hit';
const LOOPING = new Set([CAMOU, NASTI, NASTI_SIB, RANGE2, RANGE3, MCN_BUFF, ...Object.values(TRAILS)]);
const ALL = [CAMOU, HOT, BRANCH, NASTI, NASTI_SIB, RANGE2, RANGE3, MCN_BUFF, HIT, MODE, 'g_hit', 'g_heal', ...Object.values(TRAILS)];

const loopUse = (key) => ({ role: 'loop', keys: [key], from: 'BuffDuringSkill._buffs', node: 'n', on: 'owner' });
const sk = (uses = [], projectiles = []) => ({
  mode: null, projectiles, effects: uses.flatMap((u) => u.keys), uses,
  rootClass: 'ActiveBuffAbility', abilities: [], unclassified: [],
});

function makeIndex(drop = []) {
  const gone = new Set(drop);
  const prefabs = Object.fromEntries(ALL.filter((k) => !gone.has(k)).map((k) => [k, { file: `prefabs/${k}.json`, looping: LOOPING.has(k) }]));
  const skills = {
    skchr_branch_2: sk([]),
    skchr_nasti_1: sk([loopUse(NASTI), loopUse(NASTI_SIB)]),
    skchr_turdus_2: sk([]),
    skchr_closur_2: sk([]),
    skchr_closur_3: sk([]),
    skchr_mcnist_2: sk([loopUse(MCN_BUFF)]),
    skchr_mcnist_3: sk([], Object.values(PROJS)),
  };
  const melee = { class: 'MeleeAttack', cast: [], hit: [{ effects: [MODE], directionType: 0 }] };
  const char = (skillIds, modes) => ({
    kind: 'char', talents: {}, startEffect: null, deadEffect: null,
    modes: modes || [{ name: 'Default', attack: { class: 'MeleeAttack', cast: [], hit: [] } }],
    skills: Object.fromEntries(skillIds.map((s) => [s, skills[s]])),
  });
  const proj = (main) => ({
    main, onReached: [HIT], onHit: [], lifeTime: 10, effects: [main, HIT],
    movement: { class: 'AdvancedMovement', speed: 20, delayToStart: 0.25 },
    behaviours: [{ class: 'SimpleProjectile', node: 'p', fields: { _mainEffect: main, _lifeTimeType: 1, _lifeTime: 10 } }],
  });
  return {
    units: {
      char_4207_branch: char(['skchr_branch_2'], [{ name: 'Default', attack: melee }]),
      char_4212_nasti: char(['skchr_nasti_1']),
      char_4224_turdus: char(['skchr_turdus_2']),
      char_4228_closur: char(['skchr_closur_2', 'skchr_closur_3']),
      char_4230_mcnist: char(['skchr_mcnist_2', 'skchr_mcnist_3']),
      enemy_dummy: { kind: 'enemy', skills: {}, talents: {}, startEffect: null, deadEffect: null, modes: [{ name: 'Default', attack: null, combat: null }] },
    },
    skills,
    projectiles: Object.fromEntries(Object.entries(PROJS).map(([face, id]) => [id, proj(TRAILS[face])])),
    skins: {},
    generic: { hit: { phys: 'g_hit', arts: 'g_hit', heal: 'g_heal' }, die: {}, birth: {}, status: { stealth: 'common_stealth' }, keys: [] },
    prefabs,
  };
}

function rec(skillId, duration = 10) {
  return { skill: { skillId, index: 0, skillType: 'MANUAL', durationType: duration > 0 ? 'SECONDS' : 'NONE', duration, bb: {} } };
}

async function setup({ skillId, spine, drop = [], active = true, duration = 10 } = {}) {
  const index = makeIndex(drop);
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
  const views = new Map();
  const record = () => rec(skillId, duration);
  const w = new FxWiring(ofx, { speed: () => 10, record, view: (id) => views.get(id) || null });
  await w.ready();
  let n = 1;
  const add = (extra) => {
    const v = {
      id: n, x: 3, y: 4, z: 0, visFacing: 1, facing: 1, dir: 'RIGHT', isEnemy: false, alive: true,
      flags: 0, sp: 0, spMax: 30, statuses: new Set(), el: null, ...extra, id: extra.id ?? n,
    };
    n = Math.max(n, v.id) + 1;
    views.set(v.id, v);
    return v;
  };
  const her = add({ info: { id: 1, spine, defId: spine, side: 'ally', kind: 'op', skillIndex: 0 } });
  her.info.id = her.id;
  const frame = (dt = 1 / 30) => {
    w.sync(views.values()); w.tick(); ofx.time += dt;
    for (const h of handles) if (!h.stopped && typeof h.opts?.track === 'function') { h.time += dt; h.opts.track(h); }
  };
  await w.begin([...views.values()]);
  frame();
  return { w, ofx, her, frame, handles, views, add, index };
}

const alive = (handles, key) => handles.filter((h) => h.key === key && h.alive);
const icons = (v) => UnitView.prototype._iconKeys.call(v).slice();

describe('round 86 lane f5', () => {
  test('cosmetic kinds draw nothing, and the bindings name the official prefabs', () => {
    assert.equal(fxSpec('turdusCamou').a, 'none');
    assert.equal(fxSpec('turdusHot').a, 'none');
    const t = FX_BINDINGS.skchr_turdus_2;
    assert.equal(t.turdusCamou.coverStealth, 'camou');
    assert.deepEqual([...t.turdusCamou.keys], [CAMOU]);
    assert.equal(t.turdusHot.oneshot, true);
    assert.deepEqual([...FX_BINDINGS.skchr_branch_2.onAttack.keys], [BRANCH]);
    assert.equal(FX_BINDINGS.skchr_nasti_1.linger.linger, true);
    assert.equal(FX_BINDINGS.skchr_closur_2.tokenRange.token, BASE);
    assert.equal(FX_BINDINGS.skchr_closur_3.tokenRange.keys[0], RANGE3);
    assert.equal(FX_BINDINGS.skchr_mcnist_2.tokenBuff.token, GRAF);
    const keys = bindingKeys(makeIndex(), 'skchr_mcnist_3');
    for (const k of Object.values(TRAILS)) assert.ok(keys.includes(k), k);
    assert.ok(keys.includes(HIT));
    assert.equal(keys.includes(PROJS.LEFT), false, 'the projectile id is not played as an area');
  });

  test('乌啾 S2 plays 迷彩 on the ally and hides 隐匿 only while that loop is alive', async () => {
    const { w, her, frame, handles, add } = await setup({ skillId: 'skchr_turdus_2', spine: 'char_4224_turdus', duration: 0 });
    const ally = add({ x: 5, y: 6, flags: UF.STEALTH, statuses: new Set(['camou']), info: { id: 2, spine: 'char_x', defId: 'char_x', side: 'ally', kind: 'op' } });
    ally.info.id = ally.id;
    w.skill(her, true);
    w.skill(her, false);
    assert.equal(w.simFx('turdusCamou', ally.x, ally.y, { id: her.id, target: ally.id, skill: 'turdus:camou', duration: 4 }), true);
    assert.equal(w.simFx('turdusHot', ally.x, ally.y, { id: her.id, target: ally.id, skill: 'turdus:hot' }), true);
    assert.deepEqual(handles.map((h) => h.key), [CAMOU, HOT]);
    assert.equal(handles[0].opts.loop, true);
    assert.equal(typeof handles[0].opts.track, 'function', 'follow keeps the buff on the ally');
    assert.equal(handles[0].opts.owner, ally);
    assert.equal(stealthIconCovered(ally), true);
    assert.deepEqual(icons(ally), []);
    // a 隐匿 status that is still on keeps the icon (grass, an item)
    ally.statuses.add('stealth');
    assert.equal(stealthIconCovered(ally), false);
    assert.deepEqual(icons(ally), ['stealth']);
    ally.statuses.delete('stealth');
    assert.equal(stealthIconCovered(ally), true);
    // another camouflage fx is not hers
    const before = handles.length;
    assert.equal(w.simFx('camouflage', ally.x, ally.y, { id: ally.id, skill: 'item:chess_item_4_04_e' }), false);
    assert.equal(w.simFx('turdusCamou', ally.x, ally.y, { id: her.id, target: ally.id, skill: 'other', duration: 4 }), false);
    assert.equal(handles.length, before);
    for (let i = 0; i < 30 * 4 + 2; i++) frame();
    assert.equal(handles[0].alive, false);
    assert.equal(stealthIconCovered(ally), false);
    assert.deepEqual(icons(ally), ['stealth']);
    // an explicit 0 is not the 10 s fallback
    const again = await setup({ skillId: 'skchr_turdus_2', spine: 'char_4224_turdus', duration: 0 });
    const a2 = again.add({ flags: UF.STEALTH, statuses: new Set(['camou']), info: { spine: 'char_x', defId: 'char_x', side: 'ally', kind: 'op' } });
    a2.info.id = a2.id;
    again.w.skill(again.her, true);
    assert.equal(again.w.simFx('turdusCamou', a2.x, a2.y, { id: again.her.id, target: a2.id, skill: 'turdus:camou', duration: 0 }), true);
    again.frame();
    assert.equal(again.handles.at(-1).alive, false, 'duration 0 stops on the next tick');
    assert.equal(stealthIconCovered(a2), false);
  });

  test('官方特效 off plays neither effect and does not cover the icon; a missing prefab neither', async () => {
    const off = await setup({ skillId: 'skchr_turdus_2', spine: 'char_4224_turdus', active: false });
    const ally = off.add({ flags: UF.STEALTH, statuses: new Set(['camou']), info: { spine: 'char_x', defId: 'char_x', side: 'ally', kind: 'op' } });
    ally.info.id = ally.id;
    off.w.skill(off.her, true);
    assert.equal(off.w.simFx('turdusCamou', ally.x, ally.y, { id: off.her.id, target: ally.id, skill: 'turdus:camou', duration: 5 }), false);
    assert.equal(off.w.simFx('turdusHot', ally.x, ally.y, { id: off.her.id, target: ally.id, skill: 'turdus:hot' }), false);
    assert.equal(off.handles.length, 0);
    assert.equal(stealthIconCovered(ally), false);
    assert.deepEqual(icons(ally), ['stealth']);
    const bare = await setup({ skillId: 'skchr_turdus_2', spine: 'char_4224_turdus', drop: [CAMOU] });
    const a2 = bare.add({ flags: UF.STEALTH, statuses: new Set(['camou']), info: { spine: 'char_x', defId: 'char_x', side: 'ally', kind: 'op' } });
    a2.info.id = a2.id;
    bare.w.skill(bare.her, true);
    assert.equal(bare.w.simFx('turdusCamou', a2.x, a2.y, { id: bare.her.id, target: a2.id, skill: 'turdus:camou', duration: 5 }), false);
    assert.equal(stealthIconCovered(a2), false);
    assert.deepEqual(icons(a2), ['stealth']);
    // turning the layer off drops a cover that was playing
    const on = await setup({ skillId: 'skchr_turdus_2', spine: 'char_4224_turdus' });
    const a3 = on.add({ flags: UF.STEALTH, statuses: new Set(['camou']), info: { spine: 'char_x', defId: 'char_x', side: 'ally', kind: 'op' } });
    a3.info.id = a3.id;
    on.w.skill(on.her, true);
    assert.equal(on.w.simFx('turdusCamou', a3.x, a3.y, { id: on.her.id, target: a3.id, skill: 'turdus:camou', duration: 5 }), true);
    assert.equal(stealthIconCovered(a3), true);
    on.ofx.active = false;
    on.ofx.tier = 'off';
    on.frame();
    assert.equal(stealthIconCovered(a3), false);
    assert.deepEqual(icons(a3), ['stealth']);
  });

  test('a target the view does not know gets no cover', async () => {
    const { w, her, handles } = await setup({ skillId: 'skchr_turdus_2', spine: 'char_4224_turdus' });
    w.skill(her, true);
    assert.equal(w.simFx('turdusCamou', 1, 2, { id: her.id, target: 99, skill: 'turdus:camou', duration: 3 }), true);
    assert.equal(handles.length, 1);
    assert.equal(handles[0].opts.owner.info, undefined);
    assert.equal(stealthIconCovered(handles[0].opts.owner), false);
  });

  test('折桠 S2 adds her hit to a blow while the skill is on, and a missing prefab leaves the mode hit', async () => {
    const { w, ofx, her, handles, add } = await setup({ skillId: 'skchr_branch_2', spine: 'char_4207_branch' });
    const foe = add({ x: 4, y: 4, isEnemy: true, info: { spine: 'enemy_dummy', defId: 'enemy_dummy', side: 'enemy', kind: 'enemy' } });
    foe.info.id = foe.id;
    const ally = add({ x: 2, y: 4, info: { spine: 'char_x', defId: 'char_x', side: 'ally', kind: 'op' } });
    ally.info.id = ally.id;
    w.skill(her, true);
    w.attack(her, foe, 'none', ofx.time);
    w.damage(foe, 'phys', her, ofx.time);
    assert.ok(handles.some((h) => h.key === BRANCH), 'the official hit');
    assert.ok(handles.some((h) => h.key === MODE), 'the mode hit still plays');
    const n = handles.filter((h) => h.key === BRANCH).length;
    w.attack(her, ally, 'none', ofx.time);
    w.heal(ally, ofx.time);
    assert.equal(handles.filter((h) => h.key === BRANCH).length, n, 'a heal is not this blow');
    w.skill(her, false);
    const mid = handles.length;
    w.attack(her, foe, 'none', ofx.time);
    w.damage(foe, 'phys', her, ofx.time);
    assert.equal(handles.slice(mid).some((h) => h.key === BRANCH), false);
    assert.ok(handles.slice(mid).some((h) => h.key === MODE));
    const bare = await setup({ skillId: 'skchr_branch_2', spine: 'char_4207_branch', drop: [BRANCH] });
    const foe2 = bare.add({ x: 4, y: 4, isEnemy: true, info: { spine: 'enemy_dummy', defId: 'enemy_dummy', side: 'enemy', kind: 'enemy' } });
    foe2.info.id = foe2.id;
    bare.w.skill(bare.her, true);
    bare.w.attack(bare.her, foe2, 'none', bare.ofx.time);
    bare.w.damage(foe2, 'phys', bare.her, bare.ofx.time);
    assert.equal(bare.handles.some((h) => h.key === BRANCH), false);
    assert.ok(bare.handles.some((h) => h.key === MODE), 'the mode hit is not swallowed');
  });

  test('娜斯提 S1 keeps the buff loop after the skill ends and drops it on recast and release', async () => {
    const { w, her, handles } = await setup({ skillId: 'skchr_nasti_1', spine: 'char_4212_nasti' });
    w.skill(her, true);
    const buff = alive(handles, NASTI);
    const sib = alive(handles, NASTI_SIB);
    assert.equal(buff.length, 1);
    assert.equal(sib.length, 1);
    const kept = buff[0];
    w.skill(her, false);
    assert.equal(kept.alive, true, 'the ON_BUFF_FINISH loop stays');
    assert.equal(sib[0].alive, false, 'a sibling loop stops');
    assert.equal(alive(handles, NASTI).length, 1, 'no second copy at the end');
    w.skill(her, true);
    assert.equal(kept.alive, false, 'a recast stops it');
    assert.equal(alive(handles, NASTI).length, 1);
    w.release(her);
    assert.equal(alive(handles, NASTI).length, 0);
    assert.equal(alive(handles, NASTI_SIB).length, 0);
  });

  test('可露希尔 range loops follow the 指挥中心 while the skill is on and the summon stays procedural', async () => {
    const s2 = await setup({ skillId: 'skchr_closur_2', spine: 'char_4228_closur' });
    const token = s2.add({ info: { spine: BASE, defId: BASE, side: 'ally', kind: 'token' } });
    token.info.id = token.id;
    assert.equal(s2.w.simFx('summon', token.x, token.y, { id: token.id, src: s2.her.id, token: BASE }), false);
    assert.equal(alive(s2.handles, RANGE2).length, 0, 'the skill is not on yet');
    s2.w.skill(s2.her, true);
    assert.equal(alive(s2.handles, RANGE2).length, 1);
    assert.equal(alive(s2.handles, RANGE2)[0].opts.owner, token);
    s2.w.skill(s2.her, false);
    assert.equal(alive(s2.handles, RANGE2).length, 0);
    s2.w.skill(s2.her, true);
    assert.equal(alive(s2.handles, RANGE2).length, 1, 'the token is remembered across the skill');
    const s3 = await setup({ skillId: 'skchr_closur_3', spine: 'char_4228_closur' });
    const t3 = s3.add({ info: { spine: BASE, defId: BASE, side: 'ally', kind: 'token' } });
    t3.info.id = t3.id;
    s3.w.skill(s3.her, true);
    assert.equal(s3.w.simFx('summon', t3.x, t3.y, { id: t3.id, src: s3.her.id, token: BASE }), false);
    assert.equal(alive(s3.handles, RANGE3).length, 1);
    assert.equal(s3.w.simFx('summon', t3.x, t3.y, { id: 50, src: s3.her.id, token: 'token_other' }), false);
    assert.equal(alive(s3.handles, RANGE3).length, 1);
    const off = await setup({ skillId: 'skchr_closur_2', spine: 'char_4228_closur', active: false });
    const ot = off.add({ info: { spine: BASE, defId: BASE, side: 'ally', kind: 'token' } });
    ot.info.id = ot.id;
    off.w.skill(off.her, true);
    assert.equal(off.w.simFx('summon', ot.x, ot.y, { id: ot.id, src: off.her.id, token: BASE }), false);
    assert.equal(off.handles.length, 0);
    off.ofx.active = true;
    off.ofx.tier = 'full';
    off.frame();
    assert.equal(alive(off.handles, RANGE2).length, 1, 'turning 官方特效 on starts the range');
  });

  test('机械师 S2 buff loops on the 结构性原理 while S2 is on and the shield stays procedural', async () => {
    const { w, her, handles, add } = await setup({ skillId: 'skchr_mcnist_2', spine: 'char_4230_mcnist' });
    const token = add({ info: { spine: GRAF, defId: GRAF, side: 'ally', kind: 'token' } });
    token.info.id = token.id;
    w.sync([her, token]);
    assert.equal(w.simFx('shield', token.x, token.y, { id: token.id }), false);
    assert.equal(alive(handles, MCN_BUFF).length, 0, 'S2 is off: the talent barrier does not start it');
    w.skill(her, true);
    const tokenLoops = () => alive(handles, MCN_BUFF).filter((h) => h.opts.owner === token);
    assert.equal(tokenLoops().length, 1, 'S2 starting plays the buff the earlier shield remembered');
    // a later frame: her own barrier is not the token loop. The skill-start frame would treat a
    // 'shield' on her as a cast flash (skillfx.js FLASH), which this lane does not add.
    w.sync([her, token]); w.tick();
    const onHer = handles.length;
    assert.equal(w.simFx('shield', her.x, her.y, { id: her.id }), false);
    assert.equal(handles.length, onHer, 'her own barrier is not the token loop');
    assert.equal(tokenLoops().length, 1);
    assert.equal(w.simFx('shield', token.x, token.y, { id: token.id }), false);
    assert.equal(tokenLoops().length, 1, 'a regrant does not stack');
    w.skill(her, false);
    assert.equal(tokenLoops().length, 0);
  });

  test('机械师 S3 flies the trail for the token facing after the index delay, then the landing hit', async () => {
    const { w, ofx, handles, add } = await setup({ skillId: 'skchr_mcnist_3', spine: 'char_4230_mcnist' });
    const token = add({ x: 2, y: 5, dir: 'RIGHT', visFacing: 1, info: { spine: GRAF, defId: GRAF, side: 'ally', kind: 'token' } });
    token.info.id = token.id;
    const t0 = ofx.time;
    assert.equal(w.simFx('charge', token.x, token.y, { id: token.id, tx: 6, ty: 5 }), true);
    token.destroyed = true;
    assert.equal(handles.some((h) => h.key === TRAILS.RIGHT), false, 'delayToStart 0.25 has not elapsed');
    const step = () => {
      w.tick(); ofx.time += 1 / 30;
      for (const h of handles) if (!h.stopped && typeof h.opts?.track === 'function') { h.time += 1 / 30; h.opts.track(h); }
    };
    let guard = 0;
    while (!handles.some((h) => h.key === TRAILS.RIGHT) && guard++ < 40) step();
    assert.ok(ofx.time >= t0 + 0.25 - 1e-6);
    assert.equal(handles.filter((h) => h.key === TRAILS.RIGHT).length, 1, 'the trail flies after the token is gone');
    assert.equal(handles.some((h) => h.key === TRAILS.LEFT), false);
    guard = 0;
    while (!handles.some((h) => h.key === HIT) && guard++ < 40) step();
    assert.equal(handles.filter((h) => h.key === HIT).length, 1, 'onReached at arrival');
    const left = await setup({ skillId: 'skchr_mcnist_3', spine: 'char_4230_mcnist' });
    const tl = left.add({ x: 4, y: 4, dir: 'LEFT', visFacing: -1, info: { spine: GRAF, defId: GRAF, side: 'ally', kind: 'token' } });
    tl.info.id = tl.id;
    assert.equal(left.w.simFx('charge', tl.x, tl.y, { id: tl.id, tx: 1, ty: 4 }), true);
    let g = 0;
    const stepL = () => {
      left.w.tick(); left.ofx.time += 1 / 30;
      for (const h of left.handles) if (!h.stopped && typeof h.opts?.track === 'function') { h.time += 1 / 30; h.opts.track(h); }
    };
    while (!left.handles.some((h) => h.key === TRAILS.LEFT) && g++ < 40) stepL();
    assert.ok(left.handles.some((h) => h.key === TRAILS.LEFT));
    const up = await setup({ skillId: 'skchr_mcnist_3', spine: 'char_4230_mcnist' });
    const tu = up.add({ x: 3, y: 3, dir: 'UP', visFacing: -1, info: { spine: GRAF, defId: GRAF, side: 'ally', kind: 'token' } });
    tu.info.id = tu.id;
    assert.equal(up.w.simFx('charge', tu.x, tu.y, { id: tu.id, tx: 3, ty: 1 }), true);
    g = 0;
    while (!up.handles.some((h) => h.key === TRAILS.UP) && g++ < 40) { up.w.tick(); up.ofx.time += 1 / 30; }
    assert.ok(up.handles.some((h) => h.key === TRAILS.UP));
    assert.equal(up.handles.some((h) => h.key === TRAILS.UP_RIGHT), false);
    tu.dir = 'UP'; tu.visFacing = 1; tu.destroyed = false;
    // a second charge of the same token, now facing the other way, is a new flight
    const before = up.handles.length;
    assert.equal(up.w.simFx('charge', 3, 3, { id: tu.id, tx: 3, ty: 0 }), true);
    g = 0;
    while (!up.handles.slice(before).some((h) => h.key === TRAILS.UP_RIGHT) && g++ < 40) { up.w.tick(); up.ofx.time += 1 / 30; }
    assert.ok(up.handles.slice(before).some((h) => h.key === TRAILS.UP_RIGHT));
  });

  test('other charges and a missing trail stay procedural', async () => {
    const { w, her, handles, add } = await setup({ skillId: 'skchr_mcnist_3', spine: 'char_4230_mcnist' });
    const token = add({ dir: 'LEFT', info: { spine: GRAF, defId: GRAF, side: 'ally', kind: 'token' } });
    token.info.id = token.id;
    assert.equal(w.simFx('charge', token.x, token.y, { id: token.id, tx: 1, ty: 2, kind: 'bladeDive' }), false);
    assert.equal(w.simFx('charge', token.x, token.y, { id: token.id, kind: 'avengerRush' }), false);
    assert.equal(w.simFx('charge', her.x, her.y, { id: her.id, tx: 1, ty: 2 }), false);
    assert.equal(w.simFx('charge', token.x, token.y, { id: token.id }), false, 'no landing tile');
    assert.equal(w.simFx('mnctur', token.x, token.y, { id: token.id, tx: 1, ty: 2, kind: 'mnctur' }), false);
    assert.equal(handles.length, 0);
    token.destroyed = true;
    assert.equal(w.simFx('charge', 2, 2, { id: token.id, tx: 4, ty: 2 }), false, 'already gone: nothing to snapshot');
    const bare = await setup({ skillId: 'skchr_mcnist_3', spine: 'char_4230_mcnist', drop: [TRAILS.LEFT] });
    const tb = bare.add({ dir: 'LEFT', visFacing: -1, info: { spine: GRAF, defId: GRAF, side: 'ally', kind: 'token' } });
    tb.info.id = tb.id;
    assert.equal(bare.w.simFx('charge', tb.x, tb.y, { id: tb.id, tx: 0, ty: tb.y }), false);
    assert.equal(bare.handles.length, 0);
  });

  test('the real index preloads every 机械师 S3 trail and its landing hit', () => {
    const idx = JSON.parse(readFileSync(new URL('../../public/assets/local/fx/index.json', import.meta.url), 'utf8'));
    const keys = new Set(bindingKeys(idx, 'skchr_mcnist_3'));
    for (const k of Object.values(TRAILS)) assert.ok(keys.has(k), k);
    assert.ok(keys.has(HIT));
    for (const id of Object.values(PROJS)) {
      const p = idx.projectiles[id];
      assert.equal(p.movement.speed, 20);
      assert.equal(p.movement.delayToStart, 0.25);
      assert.deepEqual(p.onReached, [HIT]);
    }
  });
});
