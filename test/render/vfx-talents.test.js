// test/render/vfx-talents.test.js — the official talent and ability effects (index.json version 3, DESIGN §33.17; the
// runtime: §33.16, 0.3.0 Phase 3d) through render/vfx/talents.js, talentfx.js and the wiring on a synthetic version-3
// index: which talents are in force (the record's talents → talentKeys, a module's, the equipped skill), each `when` —
// deploy (once per life, its loops while standing), passive (a mode's copy only in that mode, a general ability's
// modes), toggle (HP ratio, blocked, 隐匿, a restore delay; on and off), reborn (the knock-out's handler loops until the
// stand-up, the end rows, the 无敌 loop for the record's blackboard time, the buffs it leaves), triggers (a fatal blow's
// 'substitute' and the 替身's mode, a skill start), a talent attack marked by 'extraAttack' —; skills' attack abilities'
// projectileKey and shots (mount, follow-up shots), buff lives on the targets; group choice (`select`); the
// UberAnimation loop type is in vfx-index2.test.js.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { FxWiring, pickAttacks } from '../../public/js/render/vfx/wiring.js';
import { talentBindings, activeTalentKeys, formModes, toggleOn, triggerKinds, pointKinds, bindable } from '../../public/js/render/vfx/talents.js';
import { skillPlan, lifeOf, shotOf, mountPointType } from '../../public/js/render/vfx/skills.js';

const BLOCKED = 1, STEALTH = 8, SKILL = 16;
const LOOPING = new Set(['dep_buff', 'mode_buff', 'atk_buff', 'reb_loop', 'reb_inv', 'reb_post', 'common_invisible', 'blk_buff', 'unblk_buff', 'aura_loop', 'gen_loop', 'never_buff',
  'bar_loop', 'enr_loop']);
const KEYS = [...LOOPING, 'dep_birth', 'reb_end', 'reb_hit', 'doll_start', 'def_cast', 'stand_cast', 'sk_trig', 'exa_cast', 'exa_hit', 'pj_cast',
  'lv_hit', 'lv_lim', 'lv_inf', 'lv_once', 'g_hit', 'g_enemy', 'g_heal', 'g_die', 'g_birth', 'sh_cast', 'bomb_hit'];
const PROJ = ['proj_a', 'proj_b', 'proj_c', 'proj_z_s1', 'proj_m'];

const use = (role, key, o = {}) => ({ role, keys: [key], from: 'UberEffectEmitter._castEffects', ...o });
const buff = (role, key, cls, o = {}) => ({ role, keys: [key], from: `${cls}._buffs`, on: 'owner', life: { type: 'INFINITY' }, ...o });
const melee = (cast, extra = {}) => ({ class: 'MeleeAttack', cast: cast.map((k) => ({ effects: [k], startEvent: 2, endEvent: 3, oneshot: 1 })), hit: [], ...extra });

function makeIndex() {
  const prefabs = Object.fromEntries(KEYS.map((k) => [k, { file: `prefabs/${k}.json`, looping: LOOPING.has(k) }]));
  return {
    format: 'fx-index', version: 3,
    units: {
      char_800_dep: {
        kind: 'char', modes: [{ name: 'Default', attack: melee([]) }, { name: 'S1', attack: melee([]) }], skills: {},
        talentKeys: { base: { 0: ['1', '4'], 1: ['2'] }, trait: ['3'], modules: { uniequip_002_dep: { '-1': ['5'] } } },
        talents: {
          // one path, two nodes: the passive buff and the AppearTalent's attack (its uses' ability tells them apart)
          1: { nodes: [{ node: 'Talents/1', class: 'Talent', ability: 'PassiveBuffAbility', when: 'passive' }, { node: 'Talents/1', class: 'AppearTalent', ability: 'MeleeAttack', when: 'deploy' }],
            uses: [buff('loop', 'dep_buff', 'PassiveBuffAbility', { node: 'Talents/1' }), use('start', 'dep_birth', { node: 'Talents/1', ability: 'MeleeAttack', startEvent: 'ON_CAST_START', oneshot: true, list: 'cast' })] },
          2: { nodes: [{ node: 'Talents/2', class: 'Talent', ability: 'PassiveBuffAbility', when: 'passive' }], uses: [buff('loop', 'never_buff', 'PassiveBuffAbility', { node: 'Talents/2' })] },
          // the trait's talent, in force whatever the record says; its copy in S1 only while S1 is the mode
          3: { nodes: [{ node: 'Modes/S1/Talents/3', class: 'Talent', ability: 'PassiveBuffAbility', mode: 'S1', when: 'passive' }], uses: [buff('loop', 'mode_buff', 'PassiveBuffAbility', { node: 'Modes/S1/Talents/3', mode: 'S1' })] },
          // valid only with the second skill equipped
          4: { nodes: [{ node: 'Talents/4', class: 'Talent', ability: 'PassiveBuffAbility', when: 'passive', skills: [1] }], uses: [buff('loop', 'never_buff', 'PassiveBuffAbility', { node: 'Talents/4' })] },
          5: { nodes: [{ node: 'Talents/5', class: 'Talent', ability: 'PassiveBuffAbility', when: 'passive' }], uses: [buff('loop', 'never_buff', 'PassiveBuffAbility', { node: 'Talents/5' })] },
        },
      },
      enemy_801_reb: {
        kind: 'enemy', skills: {},
        modes: [{ name: 'Default', attack: null, combat: melee([]) }, { name: 'Reborn', attack: null, combat: { class: 'MeleeAttack', cast: [], hit: [{ effects: ['reb_hit'] }] } }],
        talents: {
          Reborn: { bb: 'Reborn',
            nodes: [{ node: 'Talents/Reborn', class: 'Talent', ability: 'EmptyAnimatedAbility', when: 'reborn' },
              { node: 'Talents/Reborn', class: 'RebornTalent', ability: 'EmptyAbility', when: 'reborn', reborn: { mode: 'Reborn', maxCount: 1, hpRatio: 0.5, handler: 'Revive', handlerNode: 'Talents/Reborn' } }],
            uses: [use('loop', 'reb_loop', { node: 'Talents/Reborn', ability: 'EmptyAnimatedAbility', startEvent: 'ON_CAST_START', endEvent: 'ON_CAST_END', oneshot: false, list: 'cast' }),
              use('end', 'reb_end', { node: 'Talents/Reborn', ability: 'EmptyAnimatedAbility', startEvent: 'ON_CAST_END', endEvent: 'ON_CAST_END', oneshot: true, list: 'cast' }),
              { role: 'loop', keys: ['reb_inv'], from: 'RebornTalent._buffs', node: 'Talents/Reborn', buff: 'reborn_invincible', life: { type: 'LIMITED', key: 'invincible' } },
              { role: 'loop', keys: ['reb_post'], from: 'RebornTalent._buffs', node: 'Talents/Reborn', life: { type: 'INFINITY' } }] },
          // a toggle held in both modes (one effect: the copy switch keeps it playing)
          AtkUp: { bb: 'AtkUp',
            nodes: ['Default', 'Reborn'].map((m) => ({ node: `Modes/${m}/Talents/AtkUp`, class: 'Talent', ability: 'ToggleablePassiveBuffAbility', mode: m, when: 'toggle',
              toggle: [{ class: 'HpRatioToggleChecker', minHpRatio: 0, maxHpRatio: 0.5, useLTForMax: 0 }] })),
            uses: ['Default', 'Reborn'].map((m) => buff('loop', 'atk_buff', 'ToggleablePassiveBuffAbility', { node: `Modes/${m}/Talents/AtkUp`, mode: m })) },
        },
      },
      enemy_802_inv: { kind: 'enemy', skills: {}, modes: [{ name: 'Default', attack: null, combat: melee([]) }],
        talents: { Invisible: { nodes: [{ node: 'Talents/Invisible', class: 'Talent', ability: 'ToggleablePassiveBuffAbility', when: 'toggle',
          toggle: [{ class: 'AdvancedCompoundToggleChecker', isInitToggled: 1, disableWhenBlocked: 1, restoreDelay: 3 }] }],
        uses: [buff('loop', 'common_invisible', 'ToggleablePassiveBuffAbility', { node: 'Talents/Invisible' })] } } },
      enemy_803_blk: { kind: 'enemy', skills: {}, modes: [{ name: 'Default', attack: null, combat: melee([]) }],
        talents: {
          Block: { nodes: [{ node: 'Talents/Block', class: 'Talent', ability: 'ToggleablePassiveBuffAbility', when: 'toggle', toggle: [{ class: 'BlockedToggleChecker', blockMinCnt: 1, blockMaxCnt: -1 }] }],
            uses: [buff('loop', 'blk_buff', 'ToggleablePassiveBuffAbility', { node: 'Talents/Block' })] },
          Free: { nodes: [{ node: 'Talents/Free', class: 'Talent', ability: 'ToggleablePassiveBuffAbility', when: 'toggle', toggle: [{ class: 'AdvancedCompoundToggleChecker', isInitToggled: 1, disableWhenBlocked: 1, restoreDelay: 1 }] }],
            uses: [buff('loop', 'unblk_buff', 'ToggleablePassiveBuffAbility', { node: 'Talents/Free' })] },
        } },
      char_804_doll: {
        kind: 'char', skills: {}, talentKeys: { base: {} },
        modes: [{ name: 'Default', attack: melee(['def_cast']) }, { name: 'Stand', attack: melee(['stand_cast']) }],
        abilities: [
          { kind: 'common', name: 'x[switch2stand]', node: 'CommonAbilities/x[switch2stand]', class: 'AbilitySequenceGroup', when: null,
            triggers: [{ template: 'x_tr', event: 'ON_BEFORE_TRY_SET_HP_ZERO', action: 'TriggerAbility', name: 'x[switch2stand]' }],
            switchMode: [{ mode: 'Stand', restore: false, event: 'ON_BUFF_START', buff: 'x_switchend' }],
            uses: [use('loop', 'doll_start', { node: 'CommonAbilities/x[switch2stand]/Born', ability: 'AnimatedActionToOwnerAbility' })] },
          { kind: 'common', name: 'y', node: 'CommonAbilities/y', class: 'EmptyAnimatedAbility', when: null,
            triggers: [{ template: 'y_s', event: 'ON_SKILL_START', action: 'TriggerAbility', name: 'y' }],
            uses: [use('start', 'sk_trig', { node: 'CommonAbilities/y', ability: 'EmptyAnimatedAbility', oneshot: true })] },
        ],
      },
      char_805_exa: {
        kind: 'char', skills: {}, talentKeys: { base: { 0: ['1'] } }, modes: [{ name: 'Default', attack: melee([]) }],
        talents: { 1: { nodes: [{ node: 'Modes/Default/Talents/1', class: 'ProbReplaceNextAtkTalent', ability: 'MultiMeleeAttack', mode: 'Default', when: 'attack' }],
          uses: [use('loop', 'exa_cast', { node: 'Modes/Default/Talents/1', ability: 'MultiMeleeAttack', startEvent: 'ON_CAST_START', endEvent: 'ON_CAST_END', oneshot: false, list: 'cast', mode: 'Default' }),
            { role: 'hit', keys: ['exa_hit'], from: 'UberEffectEmitter._hitEffects', node: 'Modes/Default/Talents/1', ability: 'MultiMeleeAttack', list: 'hit', oneshot: true, mode: 'Default' }] } },
      },
      // 新约能天使's 火力电台: an ally's spent bullet may call TalentBomb (its trigger template angel2_t_1[target])
      char_810_bomb: {
        kind: 'char', skills: {}, talentKeys: { base: {} }, modes: [{ name: 'Default', attack: melee([]) }],
        abilities: [{ kind: 'common', name: 'TalentBomb', node: 'Others/Direction/CommonAbilities/TalentBomb', class: 'MultiRangedAttack', when: null,
          triggers: [{ template: 'angel2_t_1[target]', event: 'ON_BUFF_START', action: 'TriggerAbilityUseSelectorMergeBB', name: 'TalentBomb' }],
          uses: [{ role: 'hit', keys: ['bomb_hit'], from: 'UberEffectEmitter._hitEffects', node: 'Others/Direction/CommonAbilities/TalentBomb', ability: 'MultiRangedAttack',
            list: 'hit', oneshot: true, endEvent: 'ON_CAST_END' }] }],
      },
      enemy_806_aura: {
        kind: 'enemy', skills: {}, modes: [{ name: 'Default', attack: null, combat: melee([]) }, { name: 'M2', attack: null, combat: melee([]) }],
        talents: { aoe: { nodes: [{ node: 'Talents/aoe', class: 'AppearSyncedTalent', ability: 'AuraAbility', when: 'deploy' }],
          uses: [{ role: 'loop', keys: ['aura_loop'], from: 'AuraAbility._effects', node: 'Talents/aoe' }] } },
        abilities: [{ kind: 'general', name: 'Gen', node: 'Modes/M2/GeneralAbilities/Gen', class: 'PassiveBuffAbility', modes: ['M2'], when: 'passive',
          uses: [buff('loop', 'gen_loop', 'PassiveBuffAbility', { node: 'Modes/M2/GeneralAbilities/Gen' })] }],
      },
      // an arts barrier talent (its loops while the barrier holds) and a full-range HP toggle with a blackboard hp_ratio
      enemy_809_bar: { kind: 'enemy', skills: {}, modes: [{ name: 'Default', attack: null, combat: melee([]) }],
        talents: {
          shield: { bb: 'shield', nodes: [{ node: 'Talents/shield', class: 'Talent', ability: 'PassiveBuffAbility', when: 'passive' }], uses: [buff('loop', 'bar_loop', 'PassiveBuffAbility', { node: 'Talents/shield' })] },
          enrage: { bb: 'enrage', nodes: [{ node: 'Talents/enrage', class: 'Talent', ability: 'ToggleablePassiveBuffAbility', when: 'toggle', toggle: [{ class: 'HpRatioToggleChecker', minHpRatio: 0, maxHpRatio: 1 }] }],
            uses: [buff('loop', 'enr_loop', 'ToggleablePassiveBuffAbility', { node: 'Talents/enrage' })] },
        } },
      // a ranged unit whose skill names its projectile through its ability, with a mount and two follow-up shots; a mode
      // attack with a mount group
      char_807_proj: {
        kind: 'char', skills: {}, modes: [{ name: 'Default', attack: { class: 'RangedAttack', projectileKey: 'proj_m', mount: 'SPECIAL_0', mountGroup: { loop: 'LOOP', mounts: ['SPECIAL_6', 'SPECIAL_7'] }, cast: [], hit: [] } }],
      },
    },
    skills: {
      skchr_proj_1: { rootClass: 'CastSkill', projectiles: ['proj_z_s1', 'proj_a'],
        abilities: [{ node: 'skchr_proj_1', class: 'RangedAttack', projectileKey: 'proj_a', mount: 'SPECIAL_1', additionalTimes: 2, triggerDelta: 0.1, additionalProjectile: ['proj_b', 'proj_c'] }],
        uses: [use('start', 'pj_cast', { node: 'skchr_proj_1', ability: 'RangedAttack', startEvent: 'ON_CAST_START', oneshot: true, list: 'cast' })] },
      skchr_life_1: { rootClass: 'CastSkill', uses: [
        { role: 'hit', keys: ['lv_hit'], from: 'UberEffectEmitter._hitEffects', node: 'sk', ability: 'MeleeAttack', list: 'hit' },
        { role: 'loop', keys: ['lv_lim'], from: 'MeleeAttack._activeBuffs', node: 'sk', on: 'targets', life: { type: 'LIMITED', key: 'stun_dur' } },
        { role: 'loop', keys: ['lv_inf'], from: 'MeleeAttack._activeBuffs', node: 'sk', on: 'targets', life: { type: 'INFINITY' } },
        { role: 'loop', keys: ['lv_once'], from: 'MeleeAttack._activeBuffs', node: 'sk', on: 'targets', life: { type: 'IMMEDIATELY' } },
      ] },
    },
    projectiles: Object.fromEntries(PROJ.map((k) => [k, { main: null, effects: [], onHit: [] }])),
    skins: {},
    generic: { hit: { phys: 'g_hit', arts: 'g_hit', enemy: 'g_enemy', heal: 'g_heal' }, die: { char: 'g_die', enemy: 'g_die' }, birth: { char: 'g_birth' }, status: {} },
    prefabs,
  };
}

const RECS = {
  char_800_dep: { charId: 'char_800_dep', talents: [{ index: 0 }], module: { id: 'uniequip_002_dep', active: false } },
  enemy_801_reb: { talents: { bb: { 'Reborn.invincible': 2, 'AtkUp.atk': 1 } }, skills: [] },
  char_805_exa: { charId: 'char_805_exa', talents: [{ index: 0 }] },
  char_804_doll: { charId: 'char_804_doll', talents: [] },
  enemy_809_bar: { talents: { bb: { 'enrage.hp_ratio': 0.5 } }, skills: [] },
};

async function setup(recs = RECS) {
  const index = makeIndex();
  const log = [];
  const handles = [];
  const ofx = {
    active: true, time: 0, lite: false, tier: 'full', timers: [],
    lib: { has: (k) => !!index.prefabs[k], def: (k) => (index.prefabs[k] ? { isLoop: index.prefabs[k].looping, spawn: 2 } : null), index: async () => index, preload: async (keys) => keys.length, defs: new Map() },
    spawn(key, place, opts) {
      const h = { key, opts, stopped: false, get alive() { return !this.stopped; }, stop() { this.stopped = true; }, kill() { this.stopped = true; } };
      log.push(key); handles.push(h);
      return h;
    },
  };
  const views = new Map();
  const w = new FxWiring(ofx, { speed: () => 10, record: (info) => recs[info.defId] || null, view: (id) => views.get(id) || null });
  await w.ready();
  const view = (id, key, o = {}) => {
    const enemy = /^enemy_/.test(key);
    const v = { id, x: 5, y: 5, z: 0, visFacing: 1, isEnemy: enemy, alive: true, flags: 0, anim: 0, hp: 100, maxHp: 100,
      info: { id, spine: key, defId: key, side: enemy ? 'enemy' : 'ally', kind: enemy ? 'enemy' : 'op', skillIndex: o.skill ?? 0 }, ...o.v };
    views.set(id, v);
    return v;
  };
  const frame = (n = 1, dt = 1 / 30) => { for (let i = 0; i < n; i++) { w.sync(views.values()); w.tick(); ofx.time += dt; } };
  const live = (k) => handles.filter((h) => h.key === k && h.alive).length;
  return { w, ofx, log, handles, view, frame, live, index };
}

describe('talents in force and their bindings (talents.js)', () => {
  test("an operator's talents: the record's by talentKeys, the trait's, a module's only with it on; a node valid with another skill is left out", () => {
    const idx = makeIndex();
    const keys = activeTalentKeys(idx, 'char_800_dep', { rec: RECS.char_800_dep });
    assert.deepEqual([...keys].sort(), ['1', '3', '4']);
    const withMod = activeTalentKeys(idx, 'char_800_dep', { rec: { talents: [{ index: 0 }, { index: -1, fromModule: true }], module: { id: 'uniequip_002_dep', active: true } } });
    assert.deepEqual([...withMod].sort(), ['1', '3', '4', '5']);
    assert.equal(activeTalentKeys(idx, 'enemy_801_reb', { rec: RECS.enemy_801_reb }), null, "an enemy's: all of them");
    const b = talentBindings(idx, 'char_800_dep', { info: { skillIndex: 0 }, rec: RECS.char_800_dep });
    assert.deepEqual(b.map((x) => `${x.key}:${x.when}`), ['1:passive', '1:deploy', '3:passive']);
    // the two nodes of one path keep their own uses
    assert.deepEqual(b[0].plan.loop.map((e) => e.key), ['dep_buff']);
    assert.deepEqual(b[1].plan.attacks[0].cast.map((e) => e.key), ['dep_birth']);
    const s2 = talentBindings(idx, 'char_800_dep', { info: { skillIndex: 1 }, rec: { talents: [{ index: 0 }] } });
    assert.ok(s2.some((x) => x.key === '4'), 'skill 2 equipped: talent 4 valid');
  });

  test('forms the data ties to modes; toggle checkers on and off, null without a signal; trigger kinds; bindability', () => {
    const idx = makeIndex();
    assert.deepEqual(formModes(idx, 'enemy_801_reb'), { form2: 'Reborn' });
    assert.deepEqual(formModes(idx, 'char_804_doll'), { doll: 'Stand' });
    const hp = { toggle: [{ class: 'HpRatioToggleChecker', minHpRatio: 0, maxHpRatio: 0.5 }] };
    assert.equal(toggleOn(hp, { hp: 40, maxHp: 100 }, {}, 0), true);
    assert.equal(toggleOn(hp, { hp: 60, maxHp: 100 }, {}, 0), false);
    const blk = { toggle: [{ class: 'BlockedToggleChecker', blockMinCnt: 1, blockMaxCnt: -1 }] };
    assert.equal(toggleOn(blk, { flags: BLOCKED }, {}, 0), true);
    assert.equal(toggleOn(blk, { flags: 0 }, {}, 0), false);
    const free = { key: 'Free', toggle: [{ class: 'AdvancedCompoundToggleChecker', disableWhenBlocked: 1, restoreDelay: 1 }], plan: { loop: [] } };
    const mem = {};
    assert.equal(toggleOn(free, { flags: 0 }, mem, 0), true);
    assert.equal(toggleOn(free, { flags: BLOCKED }, mem, 1), false);
    assert.equal(toggleOn(free, { flags: 0 }, mem, 1.5), false, 'the restore delay');
    assert.equal(toggleOn(free, { flags: 0 }, mem, 2.1), true);
    assert.equal(toggleOn({ toggle: [{ class: 'RangeTileToggleChecker' }] }, { flags: 0 }, {}, 0), null);
    assert.equal(toggleOn({ toggle: [{ class: 'AdvancedCompoundToggleChecker', disableWhenTakeDamage: 1 }], plan: { loop: [] } }, { flags: 0 }, {}, 0), null);
    assert.deepEqual(triggerKinds({ triggers: [{ event: 'ON_BEFORE_TRY_SET_HP_ZERO' }] }), ['substitute', 'undying']);
    assert.deepEqual(triggerKinds({ triggers: [{ event: 'ON_BUFF_FINISH', template: 'x_standin[switch]' }] }), ['swap', 'dollEnd']);
    assert.deepEqual(triggerKinds({ triggers: [{ event: 'ON_SKILL_START' }, { event: 'ON_OWNER_BORN' }, { event: 'ON_TAKE_DAMAGE' }] }), ['skill', 'born']);
    const bomb = { triggers: [{ event: 'ON_BUFF_START', template: 'angel2_t_1[target]' }] };
    assert.deepEqual(triggerKinds(bomb), ['airstrike']);
    assert.deepEqual(pointKinds(bomb), ['airstrike'], 'a strike at the fx point');
    assert.deepEqual(pointKinds({ triggers: [{ event: 'ON_SKILL_START' }] }), []);
    const binds = talentBindings(idx, 'char_805_exa', { rec: RECS.char_805_exa });
    assert.deepEqual(bindable(binds[0]), { ok: false, reason: 'attack' });
  });
});

describe('talent and ability effects in a battle (talentfx.js)', () => {
  test('deploy: the AppearTalent once per life; the passive loop while standing, stopped by death; a mode copy only in its mode', async () => {
    const { w, log, view, frame, live } = await setup();
    const v = view(1, 'char_800_dep');
    w.deploy(v); frame();
    assert.ok(log.includes('dep_birth') && log.includes('g_birth'));
    assert.equal(live('dep_buff'), 1);
    assert.equal(live('mode_buff'), 0, 'S1 not on');
    w.spawned(v); w.deploy(v); frame();
    assert.equal(log.filter((k) => k === 'dep_birth').length, 1, 'once per life');
    v.flags = SKILL; w.skill(v, true); frame();
    assert.equal(live('mode_buff'), 1, 'its S1 copy while the skill (mode S1) is on');
    w.skill(v, false); v.flags = 0; frame();
    assert.equal(live('mode_buff'), 0);
    assert.ok(!log.includes('never_buff'), 'talents out of force never play');
    w.death(v); v.alive = false; frame();   // (render/units.js die: the view is down)
    assert.equal(live('dep_buff'), 0);
    v.alive = true; w.deploy(v); frame();
    assert.equal(log.filter((k) => k === 'dep_birth').length, 2, 'a redeploy is a new life');
  });

  test("toggles: HP ratio, 隐匿 (UF.STEALTH), blocked / unblocked with the restore delay", async () => {
    const { w, view, frame, live, ofx } = await setup();
    const r = view(1, 'enemy_801_reb'), inv = view(2, 'enemy_802_inv', { v: { flags: STEALTH } }), b = view(3, 'enemy_803_blk');
    w.spawned(r); w.spawned(inv); w.spawned(b); frame();
    assert.equal(live('atk_buff'), 0);
    assert.equal(live('common_invisible'), 1);
    assert.equal(live('blk_buff'), 0);
    assert.equal(live('unblk_buff'), 1);
    r.hp = 40; inv.flags = 0; b.flags = BLOCKED; frame();
    assert.equal(live('atk_buff'), 1, 'at ≤ 50 % HP');
    assert.equal(live('common_invisible'), 0, 'revealed');
    assert.equal(live('blk_buff'), 1);
    assert.equal(live('unblk_buff'), 0);
    b.flags = 0; frame();
    assert.equal(live('unblk_buff'), 0, 'not before its restore delay');
    ofx.time += 1.1; frame();
    assert.equal(live('unblk_buff'), 1);
  });

  test("reborn: the knock-out's handler loop until the stand-up, the end, the 无敌 loop for the record's time, the buff it leaves, then the Reborn mode", async () => {
    const { w, log, view, frame, live, ofx, index } = await setup();
    const e = view(1, 'enemy_801_reb');
    w.spawned(e); e.hp = 40; frame();
    assert.equal(live('atk_buff'), 1);
    assert.equal(w.form(e, 'reborn', { dur: 5 }), true, 'drawn: the procedural telegraph is skipped');
    assert.equal(live('reb_loop'), 1);
    assert.ok(!log.includes('reb_inv') && !log.includes('reb_post'), 'its buffs come after');
    frame(3);
    assert.equal(w.form(e, 'form2', { kind: 'reborn' }), true);
    assert.equal(live('reb_loop'), 0);
    assert.ok(log.includes('reb_end'));
    frame();
    assert.equal(live('reb_inv'), 1, '无敌: Reborn.invincible s of the record');
    assert.equal(live('reb_post'), 1);
    assert.equal(log.filter((k) => k === 'atk_buff').length, 1, 'the AtkUp copy switch keeps its loop');
    assert.equal(w.mode(index.units.enemy_801_reb, e).name, 'Reborn');
    ofx.time += 2.1; frame();
    assert.equal(live('reb_inv'), 0, 'the 无敌 time is over');
    assert.equal(live('reb_post'), 1);
    w.death(e); e.alive = false; frame();
    assert.equal(live('reb_post') + live('atk_buff'), 0);
  });

  test("新约能天使's 'airstrike': TalentBomb's hit on the ground at the struck spot, not on her; the procedural blast is skipped", async () => {
    const { w, handles, view, frame } = await setup();
    view(7, 'char_810_bomb');
    frame();
    assert.equal(w.simFx('airstrike', 8, 6, { id: 7, r: 1 }), false, 'unmarked: her S3 delivery, not the talent');
    assert.equal(handles.some((x) => x.key === 'bomb_hit'), false);
    assert.equal(w.simFx('airstrike', 8, 6, { id: 7, r: 1, talent: true }), true);
    const h = handles.find((x) => x.key === 'bomb_hit');
    assert.ok(h, 'the official hit');
    assert.equal(h.opts.owner.id, 'fx:point');
    assert.deepEqual([h.opts.owner.x, h.opts.owner.y], [8, 6], 'where the strike landed');
    assert.equal(w.simFx('airstrike', NaN, NaN, { id: 7, talent: true }), false, 'no spot: the procedural blast');
  });

  test("triggers: a fatal blow's 'substitute' casts the 替身 switch (and the 替身 fights in Stand); a skill start casts its node; a talent attack plays on 'extraAttack'", async () => {
    const { w, log, view, frame } = await setup();
    const d = view(1, 'char_804_doll'), t = view(2, 'enemy_802_inv');
    w.deploy(d); frame();
    assert.equal(w.form(d, 'doll', { dur: 21 }), false, 'a form change of its own');
    assert.equal(w.simFx('substitute', 5, 5, { id: 1, form: 'doll' }), true, 'drawn: the procedural vanish is skipped');
    assert.ok(log.includes('doll_start'));
    frame(); w.attack(d, t, 'none', 1);
    assert.ok(log.includes('stand_cast') && !log.includes('def_cast'), 'the Stand mode attack');
    w.form(d, null); frame(); w.attack(d, t, 'none', 2);
    assert.ok(log.includes('def_cast'), 'back to Default');
    d.flags = SKILL; w.skill(d, true);
    assert.ok(log.includes('sk_trig'), 'ON_SKILL_START');
    const x = view(3, 'char_805_exa');
    w.deploy(x); frame(); w.attack(x, t, 'none', 3);
    assert.ok(!log.includes('exa_cast'), 'an ordinary attack');
    assert.equal(w.simFx('extraAttack', 5, 5, { id: 3 }), true);
    assert.ok(log.includes('exa_cast') && log.includes('exa_hit'), "the talent's attack: cast on the owner, hit on the target");
  });

  test("an arts barrier's talent loops while it holds ('shieldBreak' / its 'artsBarrier' phase); a full-range HP toggle takes its blackboard hp_ratio", async () => {
    const { w, view, frame, live } = await setup();
    const e = view(1, 'enemy_809_bar');
    w.spawned(e); w.simFx('phase', 5, 5, { id: 1, kind: 'artsBarrier', value: 1000 }); frame();
    assert.equal(live('bar_loop'), 1);
    assert.equal(live('enr_loop'), 0, 'at full HP: enrage.hp_ratio 0.5');
    w.simFx('shieldBreak', 5, 5, { id: 1 }); frame();
    assert.equal(live('bar_loop'), 0, 'broken');
    w.simFx('phase', 5, 5, { id: 1, kind: 'artsBarrier', value: 1000 }); frame();
    assert.equal(live('bar_loop'), 1, 'raised again');
    e.hp = 45; frame();
    assert.equal(live('enr_loop'), 1);
  });

  test("an enemy's deploy talent (AppearSyncedTalent aura) loops from its spawn; a general ability only in its mode", async () => {
    const { w, view, frame, live } = await setup();
    const e = view(1, 'enemy_806_aura');
    w.spawned(e); frame();
    assert.equal(live('aura_loop'), 1);
    assert.equal(live('gen_loop'), 0);
    w.form(e, 'm2'); frame();
    assert.equal(live('gen_loop'), 1, 'its M2 general ability');
    assert.equal(live('aura_loop'), 1);
  });
});

describe("skills' projectiles and buff lives, attacks' shots and group choice (index v3)", () => {
  test("a skill's attack flies its ability's projectile (not the naming guess) from its mount, with its follow-up shots", async () => {
    const idx = makeIndex();
    const p = skillPlan(idx, null, 'skchr_proj_1');
    assert.equal(p.attacks[0].projectile, 'proj_a');
    assert.deepEqual(p.attacks[0].shot, { mount: mountPointType('SPECIAL_1'), mountGroup: null, times: 2, delta: 0.1, additional: ['proj_b', 'proj_c'] });
    assert.equal(mountPointType('MUZZLE'), 2);
    assert.equal(mountPointType('SPECIAL_6'), 12);
    assert.equal(shotOf({ mount: 'MUZZLE' }), null, 'a plain muzzle shot');
  });

  test('the follow-up shots fly at their delta; a mount group gives its points in turn', async () => {
    const { w, view, frame, ofx } = await setup();
    const flights = [];
    w._fly = (proj, src, tgt, kind, time, o = {}) => flights.push({ t: +ofx.time.toFixed(2), mount: o.mount ?? null, proj });
    const idx = w.idx;
    const a = view(1, 'char_807_proj'), t = view(2, 'enemy_802_inv');
    frame(); w.attack(a, t, 'arrow', 1); frame(); w.attack(a, t, 'arrow', 2);
    assert.deepEqual(flights.map((f) => f.mount), [mountPointType('SPECIAL_6'), mountPointType('SPECIAL_7')]);
    // a skill's shots: the main shot and two follow-ups 0.1 s apart
    flights.length = 0;
    const shot = shotOf(idx.skills.skchr_proj_1.abilities[0], idx.projectiles);
    w._followUps(shot, 'proj_a', a, t, 'arrow', ofx.time, shot.mount);
    for (let i = 0; i < 8; i++) { ofx.time += 0.05; w.tick(); }
    assert.equal(flights.length, 2);
    assert.ok(flights[1].t - flights[0].t > 0.08 && flights[1].t - flights[0].t < 0.12, JSON.stringify(flights));
    assert.deepEqual(flights.map((f) => f.proj), [idx.projectiles.proj_b, idx.projectiles.proj_c]);
  });

  test("a buff's life on the attack's target: LIMITED from the record's blackboard key, INFINITY while the skill lasts, IMMEDIATELY once", async () => {
    assert.deepEqual(lifeOf({ type: 'LIMITED', key: 'stun_dur' }, { stun_dur: 4 }), { s: 4 });
    assert.deepEqual(lifeOf({ type: 'LIMITED', time: 2 }), { s: 2 });
    assert.deepEqual(lifeOf({ type: 'LIMITED', key: 'invincible' }, { 'Reborn.invincible': 3 }, 'Reborn'), { s: 3 });
    assert.equal(lifeOf({ type: 'LIMITED', key: 'x' }, {}), null);
    assert.deepEqual(lifeOf({ type: 'INFINITY' }), { skill: true });
    assert.deepEqual(lifeOf({ type: 'IMMEDIATELY' }), { once: true });
    const idx = makeIndex();
    idx.units.char_808_life = { kind: 'char', skills: {}, modes: [{ name: 'Default', attack: melee([]) }] };
    const recs = { char_808_life: { charId: 'char_808_life', skill: { skillId: 'skchr_life_1', index: 0, skillType: 'MANUAL', duration: 10, bb: { stun_dur: 4 } } } };
    const { w, view, frame, live, ofx } = await setup(recs);
    w.idx.units.char_808_life = idx.units.char_808_life;
    const a = view(1, 'char_808_life'), t = view(2, 'enemy_802_inv');
    a.flags = SKILL; w.skill(a, true); frame();
    w.attack(a, t, 'none', 1); w.damage(t, 'phys', a, 1);
    assert.equal(live('lv_lim'), 1);
    assert.equal(live('lv_inf'), 1);
    ofx.time += 4.2; frame();
    assert.equal(live('lv_lim'), 0, 'its 4 s');
    assert.equal(live('lv_inf'), 1, 'while the skill lasts');
    w.skill(a, false); a.flags = 0; frame();
    assert.equal(live('lv_inf'), 0);
  });

  test('group choice (select): random seeded with diffFromLast, loop / sequential in turn, firstSucceed by kind, parallel main first, a burst attack left out', () => {
    const subs = [{ class: 'MeleeAttack', n: 0 }, { class: 'MeleeAttack', n: 1 }, { class: 'MeleeAttack', n: 2 }];
    const g = (method, extra = {}) => ({ class: 'AbilityRandomGroup', select: { method, ...extra }, abilities: subs });
    assert.deepEqual([0, 1, 2, 3].map((nth) => pickAttacks(g('loop'), { ranged: false }, 7, 0, nth)[1].n), [0, 1, 2, 0]);
    assert.deepEqual([0, 1, 2].map((nth) => pickAttacks(g('sequential'), { ranged: false }, 7, 0, nth)[1].n), [0, 1, 2]);
    const mem = new Map(), rnd = g('random', { diffFromLast: 1 });
    const picks = [5, 5, 5, 5].map((seed) => pickAttacks(rnd, { ranged: false }, seed, 0, 0, mem)[1].n);
    for (let i = 1; i < picks.length; i++) assert.notEqual(picks[i], picks[i - 1], `never the previous one: ${picks}`);
    const fs = { class: 'AbilityFirstSucceedGroup', select: { method: 'firstSucceed' }, abilities: [{ class: 'RangedAttack', k: 'r' }, { class: 'MeleeAttack', k: 'm' }] };
    assert.equal(pickAttacks(fs, { ranged: false }, 0)[1].k, 'm');
    assert.equal(pickAttacks(fs, { ranged: true }, 0)[1].k, 'r');
    const par = { class: 'AbilityParallelGroup', select: { method: 'parallel', main: 1 }, abilities: [{ class: 'MeleeAttack', k: 'a' }, { class: 'RangedAttack', k: 'b', projectileKey: 'pb' }] };
    assert.deepEqual(pickAttacks(par, {}, 0).slice(1).map((x) => x.k), ['b', 'a'], 'the main ability first: its projectile is the attack’s');
    const burst = { class: 'BurstAttackGroup', select: { method: 'trigger', burst: 0 }, abilities: [{ class: 'MeleeAttack', k: 'burst' }, { class: 'MeleeAttack', k: 'plain' }] };
    assert.equal(pickAttacks(burst, { ranged: false }, 0)[1].k, 'plain');
  });
});
