// test/render/vfx-audit031.test.js — 0.3.1's fixes of the 0.3.0 effects audit's low findings (history 0.3.1, DESIGN
// §33.16 / §33.6) on a synthetic index and a fake effects layer: a token's skill record from its owners' variants (R18:
// 诅咒娃娃's aura), the 狼群's buff-bound cast rows (R19), an ability action's target effect on the unit a kit fx names
// (R20: 归溟幽灵鲨 S1), a skill's own start effect replacing the deploy effect (R21: 缄默德克萨斯, 斯卡蒂 S2), a
// stretched billboard's Y size along its velocity (风笛's lance), an effect authored behind its unit drawn under it (瑕光 S3).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { FxWiring, wolfHolds } from '../../public/js/render/vfx/wiring.js';
import { skillRecordOf, tokenSkillRecord, planFor, resolveSkill, skillPlan, targetBound, bindingKeys } from '../../public/js/render/vfx/skills.js';
import { compileEffect, Effect, behindUnits } from '../../public/js/render/vfx/effect.js';
import { FrameData, cameraBasis } from '../../public/js/render/vfx/geom.js';

const KEYS = ['doll_aura', 'sea_aura_1', 'sea_aura_3', 'g_hit', 'g_heal', 'g_enemy', 'g_birth', 'wolf_sub_1', 'wolf_sub_2', 'wolf_cast', 'ghost2_skill_01_start', 'ghost2_skill_01_hit', 'ghost2_skill_01_buff', 'tx_birth_01', 'common_empty', 'tx_appear', 'sk_start_loop', 'mode_birth', 'bomb_loop', 'bomb_hit', 'bomb_hit_02'];
const LOOPING = new Set(['doll_aura', 'sea_aura_1', 'sea_aura_3', 'ghost2_skill_01_buff', 'sk_start_loop', 'bomb_loop']);
const aura = (k) => ({ role: 'loop', keys: [k], from: 'AuraAbility._effects', node: 'Aura' });

function makeIndex() {
  const prefabs = Object.fromEntries(KEYS.map((k) => [k, { file: `prefabs/${k}.json`, looping: LOOPING.has(k), spawn: 5 }]));
  const tok = (skills) => ({ kind: 'token', rootClass: 'Trap', modes: [{ name: 'Default', attack: { class: 'MeleeAttack' } }], skills, startEffect: null, deadEffect: null });
  return {
    units: {
      // 诅咒娃娃: an AppearSkill whose aura loops (sktok_vodfox_token)
      token_1_doll: tok({ sktok_doll: { rootClass: 'AppearSkill', rootAbility: 'ActiveAbilityWrapper', projectiles: [], mode: null, uses: [aura('doll_aura')] } }),
      // 斯卡蒂的海嗣: one skill per owner skill (sktok_skadi2_1 / _3)
      // 狼群: a MeleeAttack whose VigilWolfEffectEmitter rows are bound to the talent's buffs, and a plain cast row
      token_3_wolf: { kind: 'token', rootClass: 'RallyPoint', skills: {}, startEffect: null, deadEffect: null, modes: [{ name: 'Default', attack: {
        class: 'MeleeAttack', emitters: [{ class: 'VigilWolfEffectEmitter' }, { class: 'UberEffectEmitter' }], cast: [
          { directionType: 0, effects: ['wolf_sub_1'], oneshot: 0, startEvent: 2, endEvent: 3, buffKey: 'vigil_wolf_t_1_enhance[damage]', field: '_vigilWolfCastEffects', emitter: 0 },
          { directionType: 0, effects: ['wolf_sub_2'], oneshot: 0, startEvent: 2, endEvent: 3, buffKey: 'vigil_wolf_t_1_enhance[trigger_override]', field: '_vigilWolfCastEffects', emitter: 0 },
          { directionType: 0, effects: ['wolf_cast'], oneshot: 1, startEvent: 2, endEvent: 3, buffKey: 'some_other_buff', emitter: 1 },
        ] } }] },
      // 归溟幽灵鲨 S1: the ExchangeHp ability's two CreateEffect actions (SOURCE's start, TARGET's hit) as index v3 writes them
      char_1023_ghost2: { kind: 'char', modes: [{ name: 'Default', attack: { class: 'MeleeAttack' } }], startEffect: null, deadEffect: null, skills: {
        skchr_ghost2_1: { rootClass: 'CastSkill', rootAbility: 'ActiveBuffAbility', projectiles: [], mode: null, uses: [
          { role: 'loop', keys: ['ghost2_skill_01_buff'], from: 'ActiveBuffAbility._buffs', node: 'skchr_ghost2_1', on: 'owner', buff: 'ghost2_s_1' },
          { role: 'start', keys: ['ghost2_skill_01_start'], from: 'AnimatedActionToTargetAbility._actions CreateEffect', node: 'ExchangeHp', action: 'CreateEffect' },
          { role: 'start', keys: ['ghost2_skill_01_hit'], from: 'AnimatedActionToTargetAbility._actions CreateEffect', node: 'ExchangeHp', action: 'CreateEffect' },
        ] } } },
      // 缄默德克萨斯 S1 / S2 and 斯卡蒂 S2: skills that appear with the unit and name its start effect
      char_1028_texas2: { kind: 'char', modes: [{ name: 'Default', attack: { class: 'MeleeAttack' } }], startEffect: null, deadEffect: null, skills: {
        skchr_tx_1: { rootClass: 'MultiAppearSkill', rootAbility: 'ActiveBuffAbility', projectiles: [], mode: null, uses: [
          { role: 'start', keys: ['tx_birth_01'], from: 'MultiAppearSkill._overrideStartEffect', node: 'skchr_tx_1' }] },
        skchr_tx_2: { rootClass: 'MultiAppearSkill', rootAbility: 'AbilitySequenceGroup', projectiles: [], mode: null, uses: [
          { role: 'start', keys: ['common_empty'], from: 'MultiAppearSkill._overrideStartEffect', node: 'skchr_tx_2' },
          { role: 'start', keys: ['tx_appear'], from: 'UberEffectEmitter._castEffects', node: 'Damage', ability: 'MeleeAttack', startEvent: 'ON_CAST_START', endEvent: 'ON_CAST_END', oneshot: true, list: 'cast' }] },
        // a lasting (not passive) appear skill: the deploy plays the override itself, the skill's start leaves it out
        skchr_tx_9: { rootClass: 'AppearSkill', rootAbility: 'ActiveBuffAbility', projectiles: [], mode: null, uses: [
          { role: 'start', keys: ['tx_birth_01'], from: 'AppearSkill._overrideStartEffect', node: 'skchr_tx_9' }] },
      } },
      char_263_skadi: { kind: 'char', modes: [{ name: 'Default', overrideStartEffect: 'mode_birth', attack: { class: 'MeleeAttack' } }], startEffect: null, deadEffect: null, skills: {
        skchr_skadi_2: { rootClass: 'AppearSkill', rootAbility: 'ActiveBuffAbility', projectiles: [], mode: null, uses: [
          { role: 'start', keys: ['sk_start_loop'], from: 'AppearSkill._overrideStartEffect', node: 'skchr_skadi_2' }] },
        skchr_skadi_3: { rootClass: 'CastSkill', rootAbility: 'ActiveBuffAbility', projectiles: [], mode: null, uses: [] },
      } },
      char_9_mate: { kind: 'char', modes: [{ name: 'Default', attack: { class: 'MeleeAttack' } }], skills: {}, startEffect: null, deadEffect: null },
      enemy_1: { kind: 'enemy', modes: [{ name: 'Default', attack: { class: 'MeleeAttack', cast: [], hit: [] } }], skills: {} },
      // 香槟炸弹: a PassiveSkill naming mode M2, whose general ability loops its buff effect while the unit is in M2
      token_4_bomb: { kind: 'token', rootClass: 'Trap', startEffect: null, deadEffect: null,
        modes: [
          { name: 'Default', attack: { class: 'MeleeAttack', cast: [{ directionType: 0, effects: ['bomb_hit'], oneshot: 0, startEvent: 2, endEvent: 3 }] } },
          { name: 'M2', attack: { class: 'MultiMeleeAttack', cast: [{ directionType: 0, effects: ['bomb_hit'], oneshot: 0, startEvent: 2, endEvent: 3 }, { directionType: 0, effects: ['bomb_hit_02'], oneshot: 0, startEvent: 2, endEvent: 3 }] } },
        ],
        skills: { sktok_bomb: { rootClass: 'PassiveSkill', rootAbility: 'PassiveBuffAbility', projectiles: [], mode: 1, modeBy: 'data', uses: [] } },
        abilities: [{ kind: 'general', name: 'Ability0', node: 'Modes/M2/Body/GeneralAbilities/Ability0', class: 'PassiveBuffAbility', modes: ['M2'], when: 'passive',
          effects: ['bomb_loop'], projectiles: [], roles: { loop: ['bomb_loop'] }, unclassified: [], abilities: [],
          uses: [{ role: 'loop', keys: ['bomb_loop'], from: 'PassiveBuffAbility._buffs', node: 'Modes/M2/Body/GeneralAbilities/Ability0', on: 'owner', buff: 'token_gdtrap_passive[eff]', template: 'empty', life: { type: 'INFINITY' } }] }] },
      token_2_sea: tok({
        sktok_sea_1: { rootClass: 'CastSkill', rootAbility: 'ActiveAbilityWrapper', projectiles: [], mode: null, uses: [aura('sea_aura_1')] },
        sktok_sea_3: { rootClass: 'CastSkill', rootAbility: 'ActiveAbilityWrapper', projectiles: [], mode: null, uses: [aura('sea_aura_3')] },
      }),
    },
    skills: {}, projectiles: {}, skins: {},
    generic: { hit: { phys: 'g_hit', arts: 'g_hit', enemy: 'g_enemy', heal: 'g_heal' }, die: {}, birth: { char: 'g_birth' }, status: {} },
    prefabs,
  };
}

// data/tokens.json shapes: the top `skill` has only { skillId, bb }; the owners' variants hold the full records
const tokSkill = (skillId, index, o = {}) => ({ skillId, prefabId: skillId, index, skillType: 'PASSIVE', durationType: 'NONE', duration: -1, spType: 'ON_DEPLOY', bb: {}, ...o });
const chessRec = (charId, skills) => ({ charId, skills: skills.map(([skillId, index, skillType, duration]) => ({ skillId, index, skillType, durationType: 'NONE', duration, bb: {} })) });
const RECS = {
  token_4_bomb: { tokenId: 'token_4_bomb', skill: { skillId: 'sktok_bomb', bb: {} }, variants: { chess_c: { skill: tokSkill('sktok_bomb', 1, { duration: 0 }) } } },
  char_1028_texas2: chessRec('char_1028_texas2', [['skchr_tx_1', 0, 'PASSIVE', 11], ['skchr_tx_2', 1, 'PASSIVE', 8], ['skchr_tx_9', 2, 'AUTO', 10]]),
  char_263_skadi: chessRec('char_263_skadi', [['skchr_skadi_2', 1, 'PASSIVE', -1], ['skchr_skadi_3', 2, 'MANUAL', 38]]),
  char_1023_ghost2: { charId: 'char_1023_ghost2', skill: { skillId: 'skchr_ghost2_1', index: 0, skillType: 'AUTO', durationType: 'NONE', duration: 20, bb: {} } },
  token_1_doll: {
    tokenId: 'token_1_doll', skill: { skillId: 'sktok_doll', bb: { atk: -0.25 } },
    variants: { chess_a: { skill: tokSkill('sktok_doll', 1, { duration: 15 }), bySkill: { 0: { skill: tokSkill('sktok_doll', 1, { duration: 15 }) } } } },
  },
  token_2_sea: {
    tokenId: 'token_2_sea', skill: { skillId: 'sktok_sea_3', bb: {} },
    variants: { chess_b: { skill: tokSkill('sktok_sea_3', 2), bySkill: { 0: { skill: tokSkill('sktok_sea_1', 0) } } } },
  },
};

async function setup() {
  const index = makeIndex();
  const spawned = [];
  const handles = [];
  const ofx = {
    active: true, time: 0, lite: false, tier: 'full', timers: [],
    lib: { has: (k) => !!index.prefabs[k], def: (k) => (index.prefabs[k] ? { isLoop: index.prefabs[k].looping, spawn: 5 } : null), index: async () => index, preload: async (keys) => keys.length, defs: new Map() },
    spawn(key, place, opts) {
      const h = { key, place, opts, stopped: false, get alive() { return !this.stopped; }, stop() { this.stopped = true; }, kill() { this.stopped = true; } };
      spawned.push(key); handles.push(h);
      return h;
    },
  };
  const views = new Map();
  const w = new FxWiring(ofx, { speed: () => 10, record: (info) => RECS[info.defId] || null, view: (id) => views.get(id) || null });
  await w.ready();
  const view = (id, key, x, o = {}) => {
    const enemy = /^enemy_/.test(key);
    const kind = /^token_/.test(key) ? 'token' : enemy ? 'enemy' : 'op';
    const v = { id, x, y: 10, z: 0, visFacing: enemy ? -1 : 1, isEnemy: enemy, alive: true, flags: 0, sp: 0, spMax: 0, energy: null, dir: enemy ? undefined : (o.dir || 'RIGHT'),
      info: { id, spine: key, defId: key, side: enemy ? 'enemy' : 'ally', kind, skillIndex: o.skillIndex ?? 0 } };
    views.set(id, v);
    return v;
  };
  const frame = (dt = 1 / 30) => { w.sync(views.values()); w.tick(); ofx.time += dt; };
  return { w, spawned, handles, view, frame, index, views };
}

const count = (spawned, k) => spawned.filter((x) => x === k).length;
const live = (handles, k) => handles.filter((h) => h.key === k && h.alive).length;

describe('a token\'s skill record from its owners\' variants (R18)', () => {
  test('the variant record with the unit\'s skillIndex; without one the top record completed with its type', () => {
    assert.equal(skillRecordOf(RECS.token_1_doll, 1).skillType, 'PASSIVE');
    assert.equal(skillRecordOf(RECS.token_1_doll, 1).duration, 15);
    assert.equal(skillRecordOf(RECS.token_2_sea, 0).skillId, 'sktok_sea_1', 'the owner\'s S1 picks the token\'s first skill');
    assert.equal(skillRecordOf(RECS.token_2_sea, 2).skillId, 'sktok_sea_3');
    const top = skillRecordOf(RECS.token_1_doll, undefined);
    assert.equal(top.skillType, 'PASSIVE');
    assert.deepEqual(top.bb, { atk: -0.25 }, 'the top record\'s own blackboard kept');
    // a record of the usual shape (a typed top skill) is read as before
    const chessRec = { skill: { skillId: 'a', index: 0, skillType: 'MANUAL' }, variants: {} };
    assert.equal(skillRecordOf(chessRec, 0), chessRec.skill);
    assert.equal(tokenSkillRecord({ skill: { skillId: 'zzz' }, variants: { x: { skill: tokSkill('other', 0) } } }, undefined), null);
  });

  test('the plan of the doll is a passive (no skill event comes for it) and the 海嗣 plays its owner\'s skill', async () => {
    const index = makeIndex();
    const doll = planFor(index, { info: { kind: 'token', side: 'ally', defId: 'token_1_doll', spine: 'token_1_doll', skillIndex: 1 }, rec: RECS.token_1_doll });
    assert.equal(doll.plan.kind, 'passive');
    assert.equal(resolveSkill(index, { info: { kind: 'token', side: 'ally', defId: 'token_2_sea', spine: 'token_2_sea', skillIndex: 0 }, rec: RECS.token_2_sea }).skillId, 'sktok_sea_1');
  });

  test('the doll\'s aura loops from its deploy, with no skill event, and stops when it leaves', async () => {
    const { w, spawned, handles, view, frame } = await setup();
    const d = view(1, 'token_1_doll', 5, { skillIndex: 1 });
    frame();
    w.deploy(d);
    frame();
    assert.equal(count(spawned, 'doll_aura'), 1);
    assert.equal(live(handles, 'doll_aura'), 1);
    for (let i = 0; i < 30; i++) frame();
    assert.equal(count(spawned, 'doll_aura'), 1, 'one loop for the deployment');
    d.alive = false;
    w.death(d);
    frame();
    assert.equal(live(handles, 'doll_aura'), 0);
  });

  test('a view built mid-battle (no deploy event) starts the aura from the snapshot', async () => {
    const { spawned, view, frame } = await setup();
    view(1, 'token_1_doll', 5, { skillIndex: 1 });
    frame();
    assert.equal(count(spawned, 'doll_aura'), 1);
  });

  test('a passive token skill\'s mode holds from the deploy: 香槟炸弹 in M2 (its ability loop, M2\'s attack)', async () => {
    const { w, spawned, view, frame, index } = await setup();
    const b = view(1, 'token_4_bomb', 5, { skillIndex: 1 });
    frame();
    w.deploy(b);
    frame();
    assert.equal(w.mode(index.units.token_4_bomb, b)?.name, 'M2', 'no skill event comes: the passive is on while it stands');
    assert.equal(count(spawned, 'bomb_loop'), 1);
    for (let i = 0; i < 10; i++) frame();
    assert.equal(count(spawned, 'bomb_loop'), 1, 'one loop for the deployment');
  });
});

describe('the 狼群\'s buff-bound cast rows (R19)', () => {
  test('wolfHolds: [damage] with 2 wolves or more, [trigger_override] with all of them, nothing else', () => {
    assert.equal(wolfHolds({ wolves: [1, 3] }, 'vigil_wolf_t_1_enhance[damage]'), false);
    assert.equal(wolfHolds({ wolves: [2, 3] }, 'vigil_wolf_t_1_enhance[damage]'), true);
    assert.equal(wolfHolds({ wolves: [2, 3] }, 'vigil_wolf_t_1_enhance[trigger_override]'), false);
    assert.equal(wolfHolds({ wolves: [3, 3] }, 'vigil_wolf_t_1_enhance[trigger_override]'), true);
    assert.equal(wolfHolds({ wolves: [1, 1] }, 'vigil_wolf_t_1_enhance[trigger_override]'), false, 'a lone wolf holds no holder');
    assert.equal(wolfHolds({ wolves: null }, 'vigil_wolf_t_1_enhance[damage]'), false);
    assert.equal(wolfHolds({ wolves: [3, 3] }, 'vigil_wolf_t_1[block_cnt]'), false);
  });

  test('a bite casts the shadows\' attack effects by the pack\'s wolves; a row bound to another buff never plays', async () => {
    const { w, spawned, view, frame } = await setup();
    const wolf = view(1, 'token_3_wolf', 5);
    const t = view(2, 'enemy_1', 6);
    const bite = (n) => { frame(); w.castStart(wolf, t, 'none', { skip: 0, left: 0.5 }); w.attack(wolf, t, 'none', n, true); w.damage(t, 'phys', wolf, n); };
    wolf.wolves = [1, 3];
    bite(1);
    assert.deepEqual(['wolf_sub_1', 'wolf_sub_2', 'wolf_cast'].map((k) => count(spawned, k)), [0, 0, 0]);
    assert.equal(count(spawned, 'g_hit'), 1, 'the generic hit (the client\'s own hit comes from a buff template the index lacks)');
    wolf.wolves = [2, 3];
    bite(2);
    assert.deepEqual(['wolf_sub_1', 'wolf_sub_2'].map((k) => count(spawned, k)), [1, 0]);
    wolf.wolves = [3, 3];
    bite(3);
    assert.deepEqual(['wolf_sub_1', 'wolf_sub_2'].map((k) => count(spawned, k)), [2, 1]);
    wolf.wolves = null;
    bite(4);
    assert.deepEqual(['wolf_sub_1', 'wolf_sub_2', 'wolf_cast'].map((k) => count(spawned, k)), [2, 1, 0]);
  });
});

describe('an ability action\'s target effect on the unit the kit fx names (R20)', () => {
  test('归溟幽灵鲨 S1: the hit is no start row on her; the binding names it', () => {
    const index = makeIndex();
    const p = skillPlan(index, 'char_1023_ghost2', 'skchr_ghost2_1', { rec: RECS.char_1023_ghost2.skill });
    assert.deepEqual(p.start.map((e) => e.key), ['ghost2_skill_01_start']);
    assert.deepEqual([...targetBound('skchr_ghost2_1')], ['ghost2_skill_01_hit']);
    assert.ok(bindingKeys(index, 'skchr_ghost2_1').includes('ghost2_skill_01_hit'), 'still preloaded');
  });

  test('her start plays on her, the hit on the ally of the kit\'s hpShare (its procedural flash skipped)', async () => {
    const { w, handles, view, frame } = await setup();
    const g = view(1, 'char_1023_ghost2', 5);
    const ally = view(2, 'char_9_mate', 6);
    frame();
    w.skill(g, true);
    assert.equal(handles.filter((h) => h.key === 'ghost2_skill_01_start' && h.opts.owner === g).length, 1);
    assert.equal(handles.filter((h) => h.key === 'ghost2_skill_01_hit').length, 0, 'not on her at the start');
    assert.equal(w.simFx('hpShare', ally.x, ally.y, { id: g.id, to: ally.id }), true);
    const hits = handles.filter((h) => h.key === 'ghost2_skill_01_hit');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].opts.owner, ally, 'on the ally');
    // another kit's hpShare (魔王's, a ratio on herself, names no `to`) is not this binding's
    const other = view(3, 'char_9_mate', 4);
    assert.equal(w.simFx('hpShare', other.x, other.y, { id: other.id, ratio: 0.5 }), false);
  });
});

describe('a skill\'s own start effect replaces the deploy effect (R21)', () => {
  test('缄默德克萨斯 S1: her birth effect once, no generic pillar; S2 (common_empty): nothing but the appear strike', async () => {
    const { w, spawned, view, frame } = await setup();
    const s1 = view(1, 'char_1028_texas2', 5, { skillIndex: 0 });
    frame();
    assert.equal(w.deploy(s1), true, 'the official layer stands for the deploy');
    assert.equal(count(spawned, 'tx_birth_01'), 1);
    assert.equal(count(spawned, 'g_birth'), 0);
    const s2 = view(2, 'char_1028_texas2', 6, { skillIndex: 1 });
    frame();
    assert.equal(w.deploy(s2), true);
    assert.equal(count(spawned, 'g_birth'), 0, 'common_empty: no deploy effect');
    assert.equal(count(spawned, 'tx_birth_01'), 1);
    assert.equal(count(spawned, 'tx_appear'), 1, 'her appear strike (the skill\'s own cast at its start)');
  });

  test('斯卡蒂 S2: the looping start effect lasts while she stands; the mode\'s override and the generic one never play', async () => {
    const { w, spawned, handles, view, frame } = await setup();
    const sk = view(1, 'char_263_skadi', 5, { skillIndex: 1 });
    frame();
    w.deploy(sk);
    w.skill(sk, true);   // the sim's 0.5 s window of a passive without a duration
    for (let i = 0; i < 20; i++) frame();
    w.skill(sk, false);
    frame();
    assert.equal(count(spawned, 'sk_start_loop'), 1);
    assert.equal(live(handles, 'sk_start_loop'), 1, 'held while deployed');
    assert.deepEqual([count(spawned, 'mode_birth'), count(spawned, 'g_birth')], [0, 0]);
    sk.alive = false;
    w.death(sk);
    frame();
    assert.equal(live(handles, 'sk_start_loop'), 0);
    // with another skill the mode's own override is her start effect
    const s3 = view(2, 'char_263_skadi', 6, { skillIndex: 2 });
    frame();
    w.deploy(s3);
    assert.equal(count(spawned, 'mode_birth'), 1);
  });

  test('an appear skill that is no passive: the deploy plays its start effect, the skill\'s start does not again', async () => {
    const { w, spawned, view, frame } = await setup();
    const u = view(1, 'char_1028_texas2', 5, { skillIndex: 2 });
    frame();
    assert.equal(w.deploy(u), true);
    assert.equal(count(spawned, 'tx_birth_01'), 1);
    w.skill(u, true);
    frame();
    assert.equal(count(spawned, 'tx_birth_01'), 1);
    assert.equal(count(spawned, 'g_birth'), 0);
  });
});

describe('a stretched billboard runs its Y size along the velocity (风笛\'s lance thrust)', () => {
  const MAT = {
    name: 'm', shader: 'Torappu/Particles/Additive', passes: [{ blend: ['SrcAlpha', 'One', 'Zero', 'OneMinusSrcAlpha'], blendOp: 'Add', zTest: 'Disabled', zWrite: false, cull: 'Off', colorMask: 15 }],
    queue: 'Transparent', keywords: [], floats: {}, colors: { _TintColor: [1, 1, 1, 1] }, textures: { _MainTex: { tex: 't', st: [1, 1, 0, 0] } },
  };
  // bpipe_attack_01_start's 'baoshan': a burst moving along +x (startSpeed with the node turned −90° about Y), its
  // SizeModule's separate axes X 0.5 / Y 3.5 (both flat here), length scale 1
  const prefab = (sizeX, sizeY, lengthScale = 1) => ({
    format: 'fx-prefab', version: 1, key: 'lance', materials: [MAT], clips: [], textures: ['t'], meshes: [], refs: [], stats: {},
    nodes: [
      { id: 0, name: 'root', parent: null, children: [1], active: true, pos: [0, 0, 0], rot: [0, 0, 0, 1], scale: [1, 1, 1],
        behaviours: [{ class: 'ParticleEffect', enabled: true, fields: { _delayToPlay: 0, _delayToFinish: 0, _maxLifetime: -1, _isLoop: 0, _rotateType: 0, _spawnLocation: 1, _inactiveOnFinish: [] } }] },
      { id: 1, name: 'baoshan', parent: 0, children: [], active: true, pos: [0, 0, 0], rot: [0, -0.707107, 0, 0.707107], scale: [1, 1, 1],
        particleSystem: { lengthInSec: 0.5, looping: false, prewarm: false, startDelay: 0, playOnAwake: true, simulationSpeed: 1, moveWithTransform: 0, scalingMode: 1,
          InitialModule: { startLifetime: 0.25, startSpeed: -12, startSize: 2, startColor: [1, 1, 1, 1], maxNumParticles: 10 },
          EmissionModule: { rateOverTime: 0, m_Bursts: [{ time: 0, countCurve: 1, cycleCount: 1, repeatInterval: 0.01, probability: 1 }] },
          SizeModule: { curve: { scalar: sizeX, curve: [[0, 1, 0, 0], [1, 1, 0, 0]] }, y: { scalar: sizeY, curve: [[0, 1, 0, 0], [1, 1, 0, 0]] }, z: 1, separateAxes: true } },
        particleSystemRenderer: { m_Enabled: true, m_RenderMode: 1, renderMode: 'stretch', renderAlignment: 'view', m_LengthScale: lengthScale, m_VelocityScale: 0, m_MaxParticleSize: 0, materials: [0, null] } },
    ],
  });
  const quad = (d) => {
    const fx = new Effect(compileEffect(d), { seed: 1 });
    fx.update(1 / 30);
    const fd = new FrameData();
    fx.collect(cameraBasis(30, [0, -5, -8], 720, 0.7), fd, () => {}, 1);
    const b = fd.quad;
    return { ax: [b[3], b[4], b[5]], ay: [b[6], b[7], b[8]] };
  };
  const len = (v) => Math.hypot(v[0], v[1], v[2]);

  test('the quad\'s length (along +x, the thrust) is 2 × 3.5 × lengthScale, its width 2 × 0.5', () => {
    const { ax, ay } = quad(prefab(0.5, 3.5));
    assert.ok(Math.abs(Math.abs(ax[0]) - 7) < 1e-4 && Math.abs(ax[1]) < 1e-4 && Math.abs(ax[2]) < 1e-4, `along the velocity: ${ax}`);
    assert.ok(Math.abs(len(ay) - 1) < 1e-4, `across: ${len(ay)}`);
    assert.ok(Math.abs(ay[0]) < 1e-4, 'across is perpendicular to the thrust');
    // a negative length scale extends ahead of the particle with the same size
    const neg = quad(prefab(0.5, 3.5, -1));
    assert.ok(Math.abs(len(neg.ax) - 7) < 1e-4);
  });
});

describe('an effect authored behind its unit is drawn under the units at order 0 (瑕光 S3)', () => {
  const MAT = {
    name: 'm', shader: 'Torappu/Particles/Additive', passes: [{ blend: ['SrcAlpha', 'One', 'Zero', 'OneMinusSrcAlpha'], blendOp: 'Add', zTest: 'Disabled', zWrite: false, cull: 'Off', colorMask: 15 }],
    queue: 'Transparent', keywords: [], floats: {}, colors: { _TintColor: [1, 1, 1, 1] }, textures: { _MainTex: { tex: 't', st: [1, 1, 0, 0] } },
  };
  // a standing cone (no flat decal) at the given sorting order, under the root's static_offset at depth z
  const CONE = { positions: [0, 0, 0, 1, 0, 1, -1, 0, 1, 0, 1, 1], uv0: [0, 0, 1, 0, 0, 1, 1, 1], submeshes: [[0, 1, 2, 0, 2, 3]] };
  const gathered = (z, orders, name = 'static_offset') => {
    const nodes = [
      { id: 0, name: 'root', parent: null, children: [1], active: true, pos: [0, 0, 0], rot: [0, 0, 0, 1], scale: [1, 1, 1],
        behaviours: [{ class: 'ParticleEffect', enabled: true, fields: { _delayToPlay: 0, _delayToFinish: 0, _maxLifetime: -1, _isLoop: 1, _rotateType: 0, _spawnLocation: 1 } }] },
      { id: 1, name, parent: 0, children: [], active: true, pos: [0, 0, z], rot: [0, 0, 0, 1], scale: [1, 1, 1] },
    ];
    orders.forEach((o, i) => {
      nodes[1].children.push(2 + i);
      nodes.push({ id: 2 + i, name: `m${i}`, parent: 1, children: [], active: true, pos: [0, 0.6, 0], rot: [0, 0, 0, 1], scale: [1, 1, 1],
        meshFilter: 'cone', meshRenderer: { m_Enabled: true, materials: [0], m_SortingOrder: o, m_SortingLayer: 0 } });
    });
    const d = { format: 'fx-prefab', version: 1, key: 'aura', nodes, materials: [MAT], clips: [], textures: ['t'], meshes: [], refs: [], stats: {} };
    const fx = new Effect(compileEffect(d), { seed: 1, lib: { mesh: (k) => (k === 'cone' ? CONE : null) } });
    fx.update(1 / 30);
    const out = [];
    fx.gather(cameraBasis(30, [0, -5, -8], 720, 0.7), (e) => out.push(e));
    return out.map((e) => e.ground);
  };

  test('behindUnits: order 0 on the Default layer is behind only for an effect authored so', () => {
    assert.equal(behindUnits(0, 0, true), true);
    assert.equal(behindUnits(0, 0), false);
    assert.equal(behindUnits(0, 3, true), false, 'a positive order is drawn after the units');
    assert.equal(behindUnits(0, -1, false), true);
  });

  test('static_offset z +0.23 (blemsh_skill_03_buff): order 0 under the units, order 10 over; z −0.2 or 0: over as before', () => {
    assert.deepEqual(gathered(0.23, [0, 10]), [true, false]);
    assert.deepEqual(gathered(-0.2, [0, 10]), [false, false]);
    assert.deepEqual(gathered(0, [0]), [false]);
    assert.deepEqual(gathered(0.23, [0], 'other_helper'), [false], 'only the root\'s static_offset says so');
  });
});

describe('an effect saved with an inactive root plays (the 狼群\'s shadow attacks, 艾雅法拉\'s hit …)', () => {
  test('its systems emit as the root is activated on play; an inactive child stays off', () => {
    const MAT = { name: 'm', shader: 'Torappu/Particles/Additive', passes: [{ blend: ['SrcAlpha', 'One', 'Zero', 'OneMinusSrcAlpha'], blendOp: 'Add', zTest: 'Disabled', zWrite: false, cull: 'Off', colorMask: 15 }],
      queue: 'Transparent', keywords: [], floats: {}, colors: { _TintColor: [1, 1, 1, 1] }, textures: { _MainTex: { tex: 't', st: [1, 1, 0, 0] } } };
    const ps = (id, active) => ({ id, name: `ps${id}`, parent: 0, children: [], active, pos: [0, 0, 0], rot: [0, 0, 0, 1], scale: [1, 1, 1],
      particleSystem: { lengthInSec: 0.5, looping: false, prewarm: false, startDelay: 0, playOnAwake: true, simulationSpeed: 1, moveWithTransform: 0, scalingMode: 1,
        InitialModule: { startLifetime: 0.3, startSpeed: 0, startSize: 1, startColor: [1, 1, 1, 1], maxNumParticles: 10 },
        EmissionModule: { rateOverTime: 0, m_Bursts: [{ time: 0, countCurve: 2, cycleCount: 1, repeatInterval: 0.01, probability: 1 }] } },
      particleSystemRenderer: { m_Enabled: true, renderMode: 'billboard', renderAlignment: 'view', materials: [0, null] } });
    const d = { format: 'fx-prefab', version: 1, key: 'saved_off', root: 0, materials: [MAT], clips: [], textures: ['t'], meshes: [], refs: [], stats: {}, nodes: [
      { id: 0, name: 'root', parent: null, children: [1, 2], active: false, pos: [0, 0, 0], rot: [0, 0, 0, 1], scale: [1, 1, 1],
        behaviours: [{ class: 'ParticleEffect', enabled: true, fields: { _delayToPlay: 0, _delayToFinish: 0, _maxLifetime: -1, _isLoop: 0, _rotateType: 0, _spawnLocation: 1, _inactiveOnFinish: [] } }] },
      ps(1, true), ps(2, false)] };
    const fx = new Effect(compileEffect(d), { seed: 1 });
    fx.update(1 / 30);
    assert.equal(fx.sys[1].count, 2, 'the active child plays');
    assert.equal(fx.sys[2].count, 0, 'an inactive child stays off');
  });
});
