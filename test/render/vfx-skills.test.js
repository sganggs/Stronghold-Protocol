// test/render/vfx-skills.test.js — render/vfx/skills.js, the official skill / talent / charge effect plans (DESIGN §33,
// 0.3.0 Phase 3a), and tools/vfx-skill-coverage.mjs:
//   * synthetic fixtures (always run): unit / skill resolution from the view's info and our records, the placement rules
//     (buff loops by carrier, emitter rows by the ability they serve, hit groups, hooks, template events, ready, paths,
//     missing prefabs), attackFx, slotKey, planKeys, anchorOf, the charge plan and its count steps, the roster;
//   * the local extraction (when public/assets/local/fx/index.json exists — tools/local-extract fx.py): every skill of
//     the index plans without losing a key, the client's hit groups of the multi-hit skills, known skills' plans, the
//     秘术师 charge keys and anchors, the roster coverage.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveSkill, skillPlan, attackFx, slotKey, planKeys, anchorOf, chargePlan, chargeStep, chargeKeys, hitGroups, unitKeyOf,
  skillRecordOf, skillIdsOf, mountPointName, CHARGE_EMITTERS, UNMAPPED,
} from '../../public/js/render/vfx/skills.js';
import { coverage, roster } from '../../tools/vfx-skill-coverage.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const INDEX = path.join(ROOT, 'public/assets/local/fx/index.json');
const FX_DIR = path.dirname(INDEX);

// ---- a small synthetic index ------------------------------------------------------------------------------------------

const P = (looping = false) => ({ file: 'x', looping });
function fixture() {
  const prefabs = {};
  for (const k of ['a_buff', 'a_start', 'a_hit', 'a_range', 'a_end', 'a_ready', 'a_cast_loop', 'tgt_burn', 'tmpl_start', 'tmpl_end',
    'tmpl_after', 'tmpl_dmg', 'tmpl_cond', 'tmpl_tick', 'tmpl_out_hit', 'tok_buff', 'line_fx', 'tile_fx', 'ch_loop', 'ch_hit', 'act_hit',
    'h_01', 'h_range_01', 'h_02', 'h_range_02', 'x_01', 'x_02', 'hook_first', 'hook_next', 'dir_up', 'dir_right', 'dir_down', 'dir_left',
    'heal_hit', 'ranged_cast', 'tgt_aim', 'byname_hit', 'begin_loop']) prefabs[k] = P(/buff|loop|ready|range_?$|^tgt_burn|^tok_/.test(k));
  prefabs.a_range = P(true);
  const skills = {
    sk_buff: { mode: 1, uses: [
      { role: 'loop', keys: ['a_buff'], from: 'ActiveBuffAbility._buffs', node: 'sk', on: 'owner', buff: 'b', template: 'empty' },
      { role: 'loop', keys: ['a_cast_loop'], from: 'UberEffectEmitter._castEffects', node: 'sk', ability: 'ActiveBuffAbility',
        startEvent: 'ON_CAST_START', endEvent: 'ON_ATTACK_FINISH', oneshot: false, list: 'cast' },
      { role: 'start', keys: ['a_start'], from: 'UberEffectEmitter._castEffects', node: 'sk', ability: 'ActiveBuffAbility',
        startEvent: 'ON_CAST_START', endEvent: 'ON_CAST_END', oneshot: true, list: 'cast' },
      { role: 'ready', keys: ['a_ready'], from: 'ReadySkillEffect._effects', node: 'sk' },
      { role: 'end', keys: ['a_end'], from: 'CastSkill._endEffect', node: 'sk' },
      { role: 'start', keys: ['begin_loop'], from: 'AttachOrDetachSkill._beginEffect', node: 'sk' },
      { role: 'loop', keys: ['tgt_burn'], from: 'MeleeAttack._activeBuffs', node: 'sk', on: 'targets', buff: 'burn', template: 'burn' },
      { role: 'loop', keys: ['missing_key'], from: 'ActiveBuffAbility._buffs', node: 'sk', on: 'owner' },
    ] },
    sk_attack: { mode: null, uses: [
      { role: 'start', keys: ['a_start'], from: 'UberEffectEmitter._castEffects', node: 'sk', ability: 'MeleeAttack',
        startEvent: 'ON_CAST_START', endEvent: 'ON_CAST_END', oneshot: true, list: 'cast' },
      { role: 'loop', keys: ['hook_first'], from: 'UberEffectEmitter._castEffects', node: 'sk', ability: 'MeleeAttack', oneshot: false, list: 'cast' },
      { role: 'loop', keys: ['hook_next'], from: 'UberEffectEmitter._castEffects._hookEffectAfterFirstAttack', node: 'sk', ability: 'MeleeAttack', oneshot: false, list: 'cast' },
      { role: 'range', keys: ['a_range'], from: 'UberEffectEmitter._castEffects', node: 'sk', ability: 'MeleeAttack', oneshot: false, list: 'cast' },
      { role: 'hit', keys: ['a_hit'], from: 'UberEffectEmitter._hitEffects', node: 'sk', ability: 'MeleeAttack', oneshot: true, list: 'hit' },
      { role: 'hit', keys: ['tgt_aim'], from: 'UberEffectEmitter._castTargetEffects', node: 'sk', ability: 'MeleeAttack', oneshot: true, list: 'castTarget' },
      { role: 'hit', keys: ['heal_hit'], from: 'UberEffectEmitter._hitEffects', node: 'heal', ability: 'Heal', oneshot: true, list: 'hit' },
      { role: 'start', keys: ['ranged_cast'], from: 'UberEffectEmitter._castEffects', node: 'shot', ability: 'RangedAttack', oneshot: true, list: 'cast' },
    ] },
    sk_multi: { uses: [
      ...['h_01', 'h_range_01', 'h_02', 'h_range_02'].map((k) => ({ role: 'hit', keys: [k], from: 'MultiHitUberEffectEmitter._hitGroups', node: 'm', ability: 'MultiMeleeAttack', oneshot: true, list: 'hit' })),
      ...['x_01', 'x_01', 'x_02'].map((k) => ({ role: 'hit', keys: [k], from: 'MultiHitUberEffectEmitter._hitGroups', node: 'n', ability: 'MultiMeleeAttack', oneshot: true, list: 'hit' })),
    ] },
    sk_tmpl: { uses: [
      { role: 'start', keys: ['tmpl_start'], from: 'BuffToOwner._buffs → template t', event: 'ON_BUFF_START', action: 'CreateEffect', on: 'owner', buff: 't' },
      { role: 'end', keys: ['tmpl_end'], from: 'BuffToOwner._buffs → template t', event: 'ON_BUFF_FINISH', action: 'CreateEffect', on: 'owner', buff: 't' },
      { role: 'loop', keys: ['tmpl_after'], from: 'BuffToOwner._buffs → template t', event: 'ON_BUFF_FINISH', action: 'CreateBuff', on: 'owner', buff: 't' },
      { role: 'trigger', keys: ['tmpl_dmg'], from: 'ActiveBuffAbility._buffs → template t', event: 'ON_TAKE_DAMAGE', action: 'CreateEffect', on: 'owner', buff: 't' },
      { role: 'loop', keys: ['tmpl_cond'], from: 'PassiveBuffAbility._buffs → template t[eff_cond]', event: 'ON_BUFF_TRIGGER', action: 'CreateBuff', on: 'owner', buff: 't[eff_cond]' },
      { role: 'trigger', keys: ['tmpl_tick'], from: 'ActiveBuffAbility._buffs → template t', event: 'ON_BUFF_TRIGGER', action: 'AOEDamage', on: 'owner', buff: 't' },
      { role: 'hit', keys: ['tmpl_out_hit'], from: 'ActiveBuffAbility._buffs → template t', event: 'ON_OUTPUT_DAMAGE', action: 'CreateEffect', on: 'owner', buff: 't' },
      { role: 'loop', keys: ['tok_buff'], from: 'BuffToOwner._buffs → template t', event: 'ON_BUFF_START', action: 'CreateBuffToToken', on: 'owner', buff: 't' },
      { role: 'loop', keys: ['line_fx'], from: 'AphrisEffectEmitter._lineEffectKey', node: 'sk', ability: 'ChannelingMeleeAttack' },
      { role: 'range', keys: ['tile_fx'], from: 'Headb2S3HighlandAOE._tileEffectKey', node: 'sk', on: 'targets' },
      { role: 'loop', keys: ['ch_loop'], from: 'ChannelingEffectEmitter._effect', node: 'sk', ability: 'ChannelingMeleeAttack', startEvent: 'ON_SPELL_ON', endEvent: 'ON_ATTACK_FINISH' },
      { role: 'hit', keys: ['ch_hit'], from: 'ChannelingEffectEmitter._hitEffect', node: 'sk', ability: 'ChannelingMeleeAttack' },
      { role: 'hit', keys: ['act_hit'], from: 'UberEffectEmitter._hitEffects', node: 'sk', ability: 'AnimatedActionToTargetAbility', oneshot: true, list: 'hit' },
      { role: 'hit', keys: ['byname_hit'], from: 'ActiveBuffAbility._buffs.blackboard', node: 'sk', on: 'owner', by: 'name' },
      { role: 'other', keys: ['a_start'], from: 'Foo._effects', node: 'sk', by: 'name' },
    ] },
    sk_dir: { uses: [
      { role: 'start', keys: ['dir_up', 'dir_right', 'dir_down', 'dir_left'], from: 'UberEffectEmitter._castEffects', node: 'sk', ability: 'MeleeAttack',
        oneshot: true, list: 'cast', directionType: 3, slots: ['dir_up', 'dir_right', 'dir_down', 'dir_left'] },
      { role: 'hit', keys: ['dir_up', 'gone_right'], from: 'UberEffectEmitter._hitEffects', node: 'sk', ability: 'MeleeAttack',
        oneshot: true, list: 'hit', directionType: 1, slots: [null, 'gone_right', null, 'dir_up'] },
    ] },
    skchr_foo_2: { uses: [{ role: 'loop', keys: ['a_buff'], from: 'BuffDuringSkill._buffs', node: 'sk', on: 'owner' }] },
    skcom_generic: { uses: [{ role: 'start', keys: ['a_start'], from: 'CastSkill._beginEffect', node: 'sk' }] },
  };
  const charKeys = ['indigo_attack_charge_01_start', 'indigo_attack_charge_02', 'indigo_attack_charge_03', 'indigo_attack_charge_04', 'indigo_attack_charge_05'];
  for (const k of charKeys) prefabs[k] = P(k !== 'indigo_attack_charge_01_start');
  return {
    units: {
      char_100_foo: { kind: 'char', modes: [{ name: 'Default' }, { name: 'S2' }], skills: { sk_buff: skills.sk_buff, skchr_foo_2: skills.skchr_foo_2 } },
      char_469_indigo: { kind: 'char', modes: [{ name: 'Default' }], skills: {} },
      token_1_bar: { kind: 'token', modes: [{ name: 'Default' }], skills: {} },
      enemy_1_baz: { kind: 'enemy', modes: [{ name: 'Default' }], skills: {} },
    },
    skills, prefabs,
    projectiles: { projectile_chr_indigo: {}, projectile_chr_indigo_s1: {}, projectile_chr_indigo_s2: {} },
  };
}

const keysOf = (list) => list.map((e) => e.key);

describe('resolving a battle unit to its official skill', () => {
  const idx = fixture();
  test('the index unit: FxWiring.unitOf\'s candidate order, a `_<n>` suffix dropped', () => {
    assert.equal(unitKeyOf(idx, [null, 'nope', 'char_100_foo']), 'char_100_foo');
    assert.equal(unitKeyOf(idx, ['enemy_1_baz_2']), 'enemy_1_baz');
    assert.equal(unitKeyOf(idx, ['x']), null);
    assert.equal(unitKeyOf({}, ['char_100_foo']), null);
  });
  test('the skill record: skills[] by the loadout index, else `skill`; ids lower case without a [n] variant suffix', () => {
    const rec = { skill: { skillId: 'SK_A', index: 0 }, skills: [{ skillId: 'sk_a', index: 0 }, { skillId: 'sk_b', prefabId: 'SK_B_PREFAB', index: 1 }] };
    assert.equal(skillRecordOf(rec, 1).skillId, 'sk_b');
    assert.equal(skillRecordOf(rec, undefined).skillId, 'SK_A');
    assert.equal(skillRecordOf(rec, 5), null);
    assert.deepEqual(skillIdsOf({ skillId: 'skcom_charge_cost[1]', prefabId: 'skcom_charge_cost' }), ['skcom_charge_cost', 'skcom_charge_cost[1]']);
    assert.deepEqual(skillIdsOf({ skillId: 'SKCHR_X_1' }), ['skchr_x_1']);
  });
  test('an operator by its record, by the client\'s naming, and the reasons when nothing is found', () => {
    const info = { kind: 'op', side: 'ally', defId: 'chess_x', spine: 'char_100_foo', skillIndex: 0 };
    const rec = { charId: 'char_100_foo', skills: [{ skillId: 'sk_buff', index: 0 }, { skillId: 'sk_nope', index: 1 }] };
    const r = resolveSkill(idx, { info, rec });
    assert.deepEqual([r.unitKey, r.skillId, r.via], ['char_100_foo', 'sk_buff', 'record']);
    assert.equal(r.skill, idx.skills.sk_buff);
    // a record naming a skill the index lacks stays unresolved (the naming could name another skill) …
    const unknown = resolveSkill(idx, { info: { ...info, skillIndex: 1 }, rec });
    assert.deepEqual([unknown.skillId, unknown.skill, unknown.reason], ['sk_nope', null, 'not-in-index']);
    // … the naming stands in for a missing record
    const byName = resolveSkill(idx, { info: { ...info, skillIndex: 1 } });
    assert.deepEqual([byName.skillId, byName.via], ['skchr_foo_2', 'name']);
    const generic = resolveSkill(idx, { info, rec: { charId: 'char_100_foo', skill: { skillId: 'skcom_generic', index: 0 } } });
    assert.equal(generic.skillId, 'skcom_generic');   // the global skills table
    const diy = resolveSkill(idx, { info: { kind: 'op', side: 'ally', defId: 'diy_slot', spine: 'zzz', diy: { charId: 'char_100_foo', skillIndex: 0 } }, rec });
    assert.deepEqual([diy.unitKey, diy.skillId], ['char_100_foo', 'sk_buff']);
    assert.equal(resolveSkill(idx, { info: { kind: 'token', side: 'ally', defId: 'token_1_bar' }, rec: { skill: { skillId: 'sktok_bar' } } }).reason, 'token-skill');
    assert.equal(resolveSkill(idx, { info: { kind: 'enemy', side: 'enemy', defId: 'enemy_1_baz' }, rec: { skills: [{ prefabKey: 'boom' }] } }).reason, 'enemy-skill');
    assert.equal(resolveSkill(idx, { info: { defId: 'nobody' } }).reason, 'no-unit');
  });
});

describe('skill plans (synthetic)', () => {
  const idx = fixture();
  test('buff loops by carrier, ActiveBuffAbility rows, ready / end fields, a missing prefab; mode and kind', () => {
    const p = skillPlan(idx, 'char_100_foo', 'sk_buff', { rec: { skillType: 'MANUAL', durationType: 'NONE', duration: 20 } });
    assert.deepEqual([p.mode, p.modeName, p.kind], [1, 'S2', 'lasting']);
    assert.deepEqual(keysOf(p.loop), ['a_buff', 'a_cast_loop']);
    assert.ok(p.loop.every((e) => e.hold === 'skill' && e.at === 'owner'));
    assert.deepEqual(p.start.map((e) => [e.key, e.hold]), [['a_start', null], ['begin_loop', 'skill']]);   // a looping begin effect lasts the skill
    assert.deepEqual(keysOf(p.ready), ['a_ready']);
    assert.equal(p.ready[0].hold, 'ready');
    assert.deepEqual(keysOf(p.end), ['a_end']);
    assert.deepEqual(p.targets.map((e) => [e.key, e.at, e.hold]), [['tgt_burn', 'targets', 'skill']]);
    assert.deepEqual(p.unmapped, [{ key: 'missing_key', role: 'loop', reason: 'no-prefab', from: 'ActiveBuffAbility._buffs' }]);
    assert.equal(p.attacks.length, 0);
    assert.equal(skillPlan(idx, 'char_100_foo', 'sk_buff', { rec: { skillType: 'PASSIVE', duration: 0 } }).kind, 'passive');
    assert.equal(skillPlan(idx, 'char_100_foo', 'sk_buff', { rec: { durationType: 'AMMO' } }).kind, 'ammo');
    assert.equal(skillPlan(idx, 'char_100_foo', 'sk_buff', { rec: { duration: 0 } }).kind, 'instant');
  });
  test('rows of the skill\'s attack abilities play per attack: cast / range / hit, cast-target aims, hooks, one entry per ability', () => {
    const p = skillPlan(idx, null, 'sk_attack');
    assert.deepEqual(p.attacks.map((a) => [a.node, a.ability]), [['sk', 'MeleeAttack'], ['heal', 'Heal'], ['shot', 'RangedAttack']]);
    const melee = p.attacks[0];
    assert.deepEqual(melee.cast.map((e) => [e.key, e.hold, !!e.firstOnly, !!e.afterFirst]),
      [['a_start', null, false, false], ['hook_first', 'cast', true, false], ['hook_next', 'cast', false, true]]);
    assert.deepEqual(melee.range.map((e) => [e.key, e.hold]), [['a_range', 'cast']]);
    assert.deepEqual(melee.hit.map((g) => keysOf(g)), [['a_hit']]);
    assert.deepEqual(melee.aim.map((e) => [e.key, e.at]), [['tgt_aim', 'target']]);   // on the targets at the cast, once
    assert.ok(melee.hit[0].every((e) => e.at === 'target'));
    assert.deepEqual([p.start.length, p.loop.length], [0, 0]);
    // attackFx picks by the attack: a heal → Heal, a shot → RangedAttack, a blow → MeleeAttack
    assert.deepEqual(keysOf(attackFx(p, { heal: true }).hit[0]), ['heal_hit']);
    assert.deepEqual(keysOf(attackFx(p, { ranged: true }).cast), ['ranged_cast']);
    assert.equal(attackFx(p).ability, 'MeleeAttack');
    assert.deepEqual(attackFx(p).aim.map((e) => e.key), ['tgt_aim']);
    assert.deepEqual(attackFx({ attacks: [], each: { cast: [], hit: [[]] } }), { node: null, ability: null, cast: [], range: [], aim: [], hit: [],
      hitOpts: { indexed: false, loop: false, random: false, once: false }, projectile: null, shot: null });
  });
  test('MultiHit groups: a row starts a group unless it names a range; repeated keys are separate hits; `group` wins', () => {
    const p = skillPlan(idx, null, 'sk_multi');
    assert.deepEqual(p.attacks.map((a) => a.hit.map((g) => keysOf(g))), [[['h_01', 'h_range_01'], ['h_02', 'h_range_02']], [['x_01'], ['x_01'], ['x_02']]]);
    const g = hitGroups([{ key: 'a', group: 1 }, { key: 'b', group: 0 }, { key: 'c', group: 1 }]);
    assert.deepEqual(g.map((x) => x.map((r) => r.key)), [['b'], ['a', 'c']]);
  });
  test('buff template events, tokens, paths / tiles, channels, non-attack hits, by-name and other', () => {
    const p = skillPlan(idx, null, 'sk_tmpl');
    assert.deepEqual(keysOf(p.start), ['tmpl_start']);
    assert.deepEqual(keysOf(p.end), ['tmpl_end']);
    assert.deepEqual(keysOf(p.trigger), ['tmpl_dmg']);
    assert.deepEqual(keysOf(p.loop), ['ch_loop']);
    assert.equal(p.loop[0].hold, 'skill');
    assert.deepEqual(keysOf(p.each.hit[0]), ['tmpl_out_hit', 'byname_hit']);
    assert.equal(p.each.hit[0][1].byName, true);
    const why = Object.fromEntries(p.unmapped.map((u) => [u.key, u.reason]));
    assert.deepEqual(why, { tmpl_after: 'after-end', tmpl_cond: 'conditional', tmpl_tick: 'tick', tok_buff: 'token', line_fx: 'path',
      tile_fx: 'tiles', ch_hit: 'channel-hit', act_hit: 'hit-no-attack', a_start: 'other' });
    for (const u of p.unmapped) assert.ok(UNMAPPED[u.reason], u.reason);
  });
  test('directional rows: slotKey by facing; planKeys holds every slot', () => {
    const p = skillPlan(idx, null, 'sk_dir');
    assert.equal(p.attacks[0].cast.length, 1);   // one effect per directional row, picked by facing
    const e = p.attacks[0].cast[0];
    assert.equal(e.key, 'dir_up');
    // a slot whose prefab was not extracted plays nothing: the row falls back to its other side
    assert.deepEqual(p.attacks[0].hit[0][0].slots, [null, null, null, 'dir_up']);
    assert.equal(slotKey(p.attacks[0].hit[0][0], 'RIGHT'), 'dir_up');
    assert.deepEqual(['UP', 'RIGHT', 'DOWN', 'LEFT', undefined].map((d) => slotKey(e, d)), ['dir_up', 'dir_right', 'dir_down', 'dir_left', 'dir_right']);
    assert.equal(slotKey({ key: 'k', directionType: 2, slots: ['back', null, 'front'] }, 'RIGHT'), 'front');
    assert.equal(slotKey({ key: 'k', directionType: 2, slots: ['back', null, 'front'] }, 'UP'), 'back');
    assert.equal(slotKey({ key: 'k', directionType: 1, slots: [null, 'r', null, 'l'] }, 'UP'), 'r');
    assert.equal(slotKey({ key: 'k' }, 'LEFT'), 'k');
    assert.deepEqual(planKeys(p).sort(), ['dir_down', 'dir_left', 'dir_right', 'dir_up']);
    assert.deepEqual(planKeys(skillPlan(idx, 'char_100_foo', 'sk_buff')).sort(), ['a_buff', 'a_cast_loop', 'a_end', 'a_ready', 'a_start', 'begin_loop', 'tgt_burn']);
  });
  test('an unknown skill is an empty plan', () => {
    const p = skillPlan(idx, 'char_100_foo', 'nope');
    assert.deepEqual([p.start, p.loop, p.attacks, p.unmapped, p.mode], [[], [], [], [], null]);
    assert.deepEqual(planKeys(p), []);
  });
});

describe('a unit entry aliased from another node', () => {
  // 规程 铸铁: our record's skcom_heal_self is the extractor's copy of her skchr_sidero_1 node; the shared skill
  // prefab of that id still has its own hit, which the plan keeps beside the unit node's cast
  const idx = {
    units: { char_x: { skills: { skcom_heal_self: { rootClass: 'CastSkill', uses: [{ role: 'start', keys: ['x_skill_01_start'], from: 'UberEffectEmitter._castEffects', node: 'skchr_x_1', ability: 'Heal', list: 'cast' }] },
      skchr_x_2: { rootClass: 'CastSkill', uses: [{ role: 'start', keys: ['x_skill_02_start'], from: 'UberEffectEmitter._castEffects', node: 'skchr_x_2', ability: 'Heal', list: 'cast' }] } } } },
    skills: { skcom_heal_self: { rootClass: 'CastSkill', uses: [{ role: 'hit', keys: ['common_heal_hit_01'], from: 'UberEffectEmitter._hitEffects', node: 'skcom_heal_self', ability: 'Heal', list: 'hit' }] },
      skchr_x_2: { rootClass: 'CastSkill', uses: [{ role: 'hit', keys: ['other_hit'], from: 'UberEffectEmitter._hitEffects', node: 'skchr_x_2', ability: 'Heal', list: 'hit' }] } },
    prefabs: { x_skill_01_start: {}, x_skill_02_start: {}, common_heal_hit_01: {}, other_hit: {} },
    projectiles: {},
  };
  test('keeps the shared prefab\'s keys; a unit entry of its own node does not take them', () => {
    assert.deepEqual(planKeys(skillPlan(idx, 'char_x', 'skcom_heal_self')).sort(), ['common_heal_hit_01', 'x_skill_01_start']);
    assert.deepEqual(planKeys(skillPlan(idx, 'char_x', 'skchr_x_2')), ['x_skill_02_start']);
  });
});

describe('anchors and mount points', () => {
  test('anchorOf reads the root ParticleEffect and FollowMountPoint (also of a compiled def)', () => {
    const desc = { nodes: [{ behaviours: [{ class: 'ParticleEffect', fields: { _spawnLocation: 9, _isLoop: 1 } }, { class: 'FollowMountPoint', fields: { _mountPointType: 6 } }] }] };
    assert.deepEqual(anchorOf(desc), { spawn: 9, point: 'MP_SPECIAL_1', follow: 'SPECIAL_1', loop: true, projectile: false });
    assert.equal(anchorOf({ desc }).point, 'MP_SPECIAL_1');
    assert.deepEqual(anchorOf({ nodes: [{ behaviours: [{ class: 'ProjectileEffect', fields: {} }] }], stats: { looping: true } }),
      { spawn: null, point: null, follow: null, loop: true, projectile: true });
    assert.equal(anchorOf(null), null);
    assert.deepEqual([0, 1, 5, 7, 8, 9, 10, 29, 30, -1].map(mountPointName), ['FOOT', 'HIT', 'SPECIAL_0', 'GROUND', 'SPECIAL_2', 'SPECIAL_3', 'SPECIAL_4', 'SPECIAL_23', null, null]);
  });
});

describe('the 秘术师 charge plan', () => {
  const idx = fixture();
  test('深靛: one looping slot per stored energy at its Special point, the store one-shot every time', () => {
    const p = chargePlan(idx, 'char_469_indigo');
    assert.equal(p.cap, 3);
    assert.deepEqual(p.slots.map((s) => [s.hold, s.gain, s.mount]), [
      [['indigo_attack_charge_02'], ['indigo_attack_charge_01_start'], 'SPECIAL_1'],
      [['indigo_attack_charge_03'], ['indigo_attack_charge_01_start'], 'SPECIAL_2'],
      [['indigo_attack_charge_04'], ['indigo_attack_charge_01_start'], 'SPECIAL_3'],
      [['indigo_attack_charge_05'], ['indigo_attack_charge_01_start'], 'SPECIAL_0'],
    ]);
    assert.deepEqual(p.byCount[1], ['indigo_attack_charge_02']);
    assert.deepEqual(p.byCount[3], ['indigo_attack_charge_02', 'indigo_attack_charge_03', 'indigo_attack_charge_04']);
    assert.deepEqual(p.onGain[2], ['indigo_attack_charge_01_start']);
    assert.deepEqual(p.onRelease.mounts, ['SPECIAL_1', 'SPECIAL_2', 'SPECIAL_3', 'SPECIAL_0']);
    assert.equal(p.onRelease.projectiles.S1, 'projectile_chr_indigo_s1');
    assert.deepEqual(p.missing, []);
    assert.equal(chargeKeys(p).length, 5);
  });
  test('count steps: stores light the next slots with their one-shots, a release dims them', () => {
    const p = chargePlan(idx, 'char_469_indigo');
    assert.deepEqual(chargeStep(p, 0, 2), { gain: ['indigo_attack_charge_01_start', 'indigo_attack_charge_01_start'], light: [0, 1], dim: [], released: 0 });
    assert.deepEqual(chargeStep(p, 3, 0), { gain: [], light: [], dim: [0, 1, 2], released: 3 });
    assert.deepEqual(chargeStep(p, 2, 2), { gain: [], light: [], dim: [], released: 0 });
    assert.deepEqual(chargeStep(p, 1, 9).light, [1, 2, 3]);   // clamped to the slots
    assert.deepEqual(chargeStep(null, 0, 3), { gain: [], light: [], dim: [], released: 0 });
  });
  test('no plan for other units; keys the index lacks are reported', () => {
    assert.equal(chargePlan(idx, 'char_100_foo'), null);
    assert.equal(chargePlan({ units: {} }, 'char_469_indigo'), null);
    const thin = { units: { char_469_indigo: {} }, prefabs: { indigo_attack_charge_02: P(true) }, projectiles: {} };
    const p = chargePlan(thin, 'char_469_indigo');
    assert.deepEqual(p.byCount[1], ['indigo_attack_charge_02']);
    assert.ok(p.missing.includes('indigo_attack_charge_01_start') && p.missing.includes('projectile_chr_indigo'));
  });
  test('the table covers the roster\'s three 秘术师 with slots in the order of the client\'s groups', () => {
    assert.deepEqual(Object.keys(CHARGE_EMITTERS).sort(), ['char_4046_ebnhlz', 'char_4226_veen', 'char_469_indigo']);
    assert.deepEqual(CHARGE_EMITTERS.char_4046_ebnhlz.slots.map((s) => s.mount), [5, 6, 8, 9]);
    assert.deepEqual(CHARGE_EMITTERS.char_4046_ebnhlz.elite[0].spell, ['ebnhlz_attack_charge_red_5', 'ebnhlz_attack_buff_red_5']);
    assert.equal(CHARGE_EMITTERS.char_4226_veen.mergeSize, 3);
  });
});

describe('the coverage roster (tools/vfx-skill-coverage.mjs)', () => {
  test('operators, 补位 / 自选 forms, summons and enemies, one entry per (unit, skill)', () => {
    const r = roster({
      chess: { a: { charId: 'char_1_a', skill: { skillId: 'sk1', index: 0 }, skills: [{ skillId: 'sk1', index: 0 }, { skillId: 'sk2', index: 1 }] },
        b: { charId: 'char_1_a', skill: { skillId: 'sk1', index: 0 } } },
      backups: { units: { char_2_b: { charId: 'char_2_b', forms: { f: { skills: [{ skillId: 'skcom_x[1]', prefabId: 'skcom_x', index: 0 }] } } } },
        tokens: { token_b: { skill: { skillId: 'sktok_b' }, variants: { v: { bySkill: { 0: { skill: { skillId: 'sktok_b2' } } } } } } } },
      tokens: { token_a: { skill: { skillId: 'skcom_withdraw' } } },
      enemies: { enemy_1: { skills: [{ prefabKey: 'boom' }] } },
    });
    assert.deepEqual(r.map((x) => `${x.group}:${x.id}:${x.skill.skillId || x.skill.prefabKey}`), [
      'operators:char_1_a:sk1', 'operators:char_1_a:sk2', 'operators:char_2_b:skcom_x[1]',
      'tokens:token_b:sktok_b', 'tokens:token_b:sktok_b2', 'tokens:token_a:skcom_withdraw', 'enemies:enemy_1:boom',
    ]);
  });
  test('the report counts plans per role and the unmapped keys', () => {
    const idx = fixture();
    const rep = coverage(idx, { chess: { a: { charId: 'char_100_foo', skills: [{ skillId: 'sk_buff', index: 0 }, { skillId: 'sk_nope', index: 1 }] } },
      tokens: { token_1_bar: { skill: { skillId: 'sktok_bar' } } }, enemies: { enemy_1_baz: { skills: [{ prefabKey: 'boom' }] } } });
    assert.deepEqual([rep.groups.operators.skills, rep.groups.operators.resolved, rep.groups.operators.planned], [2, 1, 1]);
    assert.deepEqual(rep.groups.operators.notResolved, { 'not-in-index': 1 });
    assert.equal(rep.groups.operators.roles.loop, 1);
    assert.equal(rep.groups.operators.roles.targets, 1);
    assert.deepEqual(rep.groups.operators.unmapped, { 'no-prefab': 1 });
    assert.deepEqual(rep.groups.tokens.notResolved, { 'token-skill': 1 });
    assert.deepEqual(rep.groups.enemies.notResolved, { 'enemy-skill': 1 });
    assert.equal(rep.charge.find((c) => c.unit === 'char_469_indigo').slots, 4);
  });
});

// ---- the local extraction ---------------------------------------------------------------------------------------------

const HAS_INDEX = existsSync(INDEX);
const real = HAS_INDEX ? JSON.parse(readFileSync(INDEX, 'utf8')) : null;
const ownerOf = (sid) => (real ? Object.keys(real.units).find((k) => real.units[k].skills?.[sid]) ?? null : null);
const desc = (key) => {
  const f = real?.prefabs?.[key]?.file;
  return f && existsSync(path.join(FX_DIR, f)) ? JSON.parse(readFileSync(path.join(FX_DIR, f), 'utf8')) : null;
};

describe('the extracted effects (when fx was extracted on this machine)', { skip: !HAS_INDEX && 'no public/assets/local/fx/index.json (tools/local-extract: extract.py --only fx --fx-set used)' }, () => {
  test('every skill of the index plans, and every key of its uses is placed or unmapped (none lost)', () => {
    let skills = 0;
    for (const sid of Object.keys(real.skills)) {
      const p = skillPlan(real, ownerOf(sid), sid);
      const placed = new Set(planKeys(p));
      const unmapped = new Set(p.unmapped.map((u) => u.key));
      for (const u of real.skills[sid].uses || []) {
        for (const k of u.keys) assert.ok(placed.has(k) || unmapped.has(k), `${sid}: ${k} (${u.role}, ${u.from}) is neither placed nor unmapped`);
      }
      for (const u of p.unmapped) assert.ok(UNMAPPED[u.reason], `${sid}: unknown reason ${u.reason}`);
      skills++;
    }
    assert.ok(skills > 400, `${skills} skills`);
  });
  test('the multi-hit skills get the client\'s hit groups ([uc]skills.ab, client 26-09-13)', () => {
    const groups = (sid, node) => {
      const p = skillPlan(real, ownerOf(sid), sid);
      const a = node ? p.attacks.find((x) => x.node === node) : p.attacks.find((x) => x.hit.length > 1);
      return a.hit.map((g) => g.map((e) => e.key));
    };
    assert.equal(groups('skchr_chen_3').length, 10);
    assert.equal(groups('skchr_acpion_3').length, 8);
    assert.equal(groups('skchr_chen3_2').length, 6);
    assert.deepEqual(groups('skchr_phatm2_1'), [['phatm2_skill_01_hit_01', 'phatm2_skill_01_hit_range_01'], ['phatm2_skill_01_hit_02', 'phatm2_skill_01_hit_range_02']]);
    assert.deepEqual(skillPlan(real, ownerOf('skchr_phatm2_1'), 'skchr_phatm2_1').attacks[0].aim.map((e) => e.key), ['phatm2_skill_01_hit_aim_01', 'phatm2_skill_01_hit_02_aim_01']);
    assert.deepEqual(groups('skchr_irene_1'), [['irene_skill_01_type1_hit_01'], ['irene_skill_01_type2_hit_01']]);
    assert.deepEqual(groups('skchr_zuole_3'), [...Array(6).fill(['zuole_skill_03_hit_01']), ['zuole_skill_03_hit_02']]);
    assert.deepEqual(groups('skchr_zuole_1', 's1_tripple'), Array(3).fill(['zuole_skill_01_hit_01']));
    assert.deepEqual(groups('skchr_vvana_1', 'S1_Attack').length, 3);
    assert.deepEqual(groups('skchr_vvana_1', 'S1_Attack2').length, 2);
  });
  test('known skills: a buff loop with its mode, a one-cast attack with its targets\' burn, a channel', () => {
    const amgoat = skillPlan(real, 'char_180_amgoat', 'skchr_amgoat_3');
    assert.deepEqual(amgoat.loop.map((e) => [e.key, e.hold]), [['amgoat_skill_03_buff', 'skill']]);
    assert.equal(amgoat.modeName, real.units.char_180_amgoat.modes[amgoat.mode].name);
    const ifrit2 = skillPlan(real, 'char_134_ifrit', 'skchr_ifrit_2');
    assert.deepEqual(ifrit2.attacks.map((a) => a.ability), ['MeleeAttack']);
    assert.deepEqual(ifrit2.attacks[0].hit, [[{ ...ifrit2.attacks[0].hit[0][0], key: 'common_firemagic_hit_01' }]]);
    assert.deepEqual(ifrit2.targets.map((e) => e.key), ['buff_burn']);
    const ifrit3 = skillPlan(real, 'char_134_ifrit', 'skchr_ifrit_3');
    assert.deepEqual(ifrit3.loop.map((e) => e.key).sort(), ['ifrit_skill_03_buff', 'ifrit_skill_03_start']);
    assert.deepEqual(ifrit3.range.map((e) => [e.key, e.hold]), [['ifrit_skill_03_range', 'skill']]);
    // a chess record resolves through its skills[] (隐现 fights with skill 2)
    const chess = JSON.parse(readFileSync(path.join(ROOT, 'data/chess.json'), 'utf8'));
    const c = chess.chess_char_1_01_a;
    const r = resolveSkill(real, { info: { kind: 'op', side: 'ally', defId: c.chessId, spine: c.assets.spine, skillIndex: c.skill.index }, rec: c });
    assert.deepEqual([r.unitKey, r.skillId, r.via], ['char_498_inside', 'skchr_inside_2', 'record']);
  });
  test('the 秘术师 charge keys exist and sit where the plan says (descriptors)', () => {
    for (const unit of Object.keys(CHARGE_EMITTERS)) {
      const p = chargePlan(real, unit);
      assert.ok(p, unit);
      assert.deepEqual(p.missing, [], `${unit} misses ${p.missing}`);
      for (const s of [...p.slots, ...(p.elite || []), ...(p.eliteS3 || []), ...(p.merged || [])]) {
        assert.ok(s.hold.length === 1, `${unit}: one loop per slot`);
        const a = anchorOf(desc(s.hold[0]));
        if (a) assert.equal(a.follow, s.mount, `${s.hold[0]} follows ${a.follow}, the slot's projectiles leave from ${s.mount}`);
      }
    }
    const indigo = chargePlan(real, 'char_469_indigo');
    assert.deepEqual(indigo.byCount[4], ['indigo_attack_charge_02', 'indigo_attack_charge_03', 'indigo_attack_charge_04', 'indigo_attack_charge_05']);
    assert.deepEqual(indigo.onGain[1], ['indigo_attack_charge_01_start']);
    const start = anchorOf(desc('indigo_attack_charge_01_start'));
    if (start) assert.deepEqual([start.point, start.loop], ['MP_SPECIAL_0', false]);
    // the charge keys are what the unit references (index.json units[].refs)
    for (const unit of Object.keys(CHARGE_EMITTERS)) {
      const refs = new Set(real.units[unit].refs);
      for (const k of chargeKeys(chargePlan(real, unit))) assert.ok(refs.has(k), `${unit} refs ${k}`);
    }
  });
  test('the roster coverage: most operator skills get a plan; token and enemy skills from index version 2 on', () => {
    const data = Object.fromEntries(['chess', 'backups', 'tokens', 'enemies'].map((n) => [n, JSON.parse(readFileSync(path.join(ROOT, 'data', `${n}.json`), 'utf8'))]));
    const rep = coverage(real, data);
    const op = rep.groups.operators;
    assert.ok(op.resolved / op.skills > 0.95, `${op.resolved} / ${op.skills} resolved`);
    assert.ok(op.planned / op.skills > 0.8, `${op.planned} / ${op.skills} planned`);
    const { enemies, tokens } = rep.groups;
    if ((real.version || 1) >= 2) {
      // index v2: the enemies' skills by prefabKey (123 of 126 roster pairs), the summons' (71 of 78)
      assert.ok(enemies.resolved / enemies.skills > 0.9, `${enemies.resolved} / ${enemies.skills} enemy skills resolved`);
      assert.ok(tokens.resolved / tokens.skills > 0.8, `${tokens.resolved} / ${tokens.skills} summon skills resolved`);
      assert.ok(rep.attacks.enemy.withRows / rep.attacks.enemy.units > 0.7, 'most enemies have official attack rows (combat)');
    } else assert.equal(enemies.resolved, 0);
    assert.ok(rep.unmapped.every((u) => UNMAPPED[u.reason]));
  });
});
