// test/render/vfx-r86-f2.test.js — round 86 lane f2. Official prefabs for char_1012–char_1051 that a kit fx can stand
// for: 赤刃明霄陈 S3's wave trail (one living copy, not the procedural qi), her S2 respawn buffs, 怒潮凛冬's highland
// tile, 斩业星熊's shield hit (not also the projectile's onHit), 焰影苇草's scorch burst, 百炼嘉维尔's bleed,
// 淬羽赫默's grave on the ally, 浊心斯卡蒂's transfer hits. 司霆惊蛰's leizi2:current pulse is not a cast flash.
// 官方特效 off keeps the procedural fx.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FxWiring } from '../../public/js/render/vfx/wiring.js';
import { FX_BINDINGS, bindingKeys, skillPlan } from '../../public/js/render/vfx/skills.js';
import { fxSpec } from '../../public/js/render/fx/kinds.js';
import { boardToUnity } from '../../public/js/render/vfx/math.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const INDEX = path.join(ROOT, 'public/assets/local/fx/index.json');

const TRAIL = 'chen3_skill_03_trail_01';
const WAVE_HIT = 'chen3_skill_03_hit_04';
const BUFF_A = 'chen3_skill_02_buff_01';
const BUFF_B = 'chen3_skill_02_f_buff_02';
const TILE = 'headb2_highground';
const SHIELD_HIT = 'hsgma2_skill_02_hit_04';
const BOOM = 'reed2_debuff_boom_01';
const BLEED = 'gvial2_skill_3_bleed';
const GRAVE = 'slent2_skill_03_buff_02';
const SKADI_A = 'skadi2_skill_01_hit';
const SKADI_B = 'skadi2_skill_01_hit_02';
const LOOP = 'leizi2_skill_03_buff';
const START = 'f2_start';

const LOOPING = new Set([TRAIL, BUFF_A, BUFF_B, BLEED, GRAVE, LOOP]);

function skillNode(keys, { projectiles = [], uses = null, rootClass = 'CastSkillWithSuspendable' } = {}) {
  return {
    rootClass, rootAbility: 'ActiveBuffAbility', effects: keys, projectiles, mode: null, modeBy: null,
    abilities: [], unclassified: [], roles: {},
    uses: uses || [{ role: 'start', keys: [START], from: 'UberEffectEmitter._castEffects', ability: 'ActiveBuffAbility', node: 'n', oneshot: true }],
  };
}

function makeIndex(installed) {
  const prefabs = Object.fromEntries(installed.map((k) => [k, { file: `prefabs/${k}.json`, looping: LOOPING.has(k), spawn: 1 }]));
  const unit = (id, skills) => ({
    kind: 'char', talents: {}, startEffect: null, deadEffect: null, skills,
    modes: [{ name: 'Default', attack: { class: 'MeleeAttack', node: 'Modes/Default/Body/Attack', cast: [], hit: [] }, combat: null }],
  });
  return {
    units: {
      char_1050_chen3: unit('char_1050_chen3', {
        skchr_chen3_3: skillNode([START], { projectiles: ['projectile_chr_chen3_s3'] }),
        skchr_chen3_2: skillNode([START]),
      }),
      char_1051_headb2: unit('char_1051_headb2', { skchr_headb2_3: skillNode([START]) }),
      char_1044_hsgma2: unit('char_1044_hsgma2', {
        skchr_hsgma2_2: skillNode([START], { projectiles: ['projectile_chr_hsgma2_s2'] }),
        skchr_hsgma2_1: skillNode([START]),
      }),
      char_1020_reed2: unit('char_1020_reed2', { skchr_reed2_3: skillNode([START]), skchr_reed2_2: skillNode([START]) }),
      char_1026_gvial2: unit('char_1026_gvial2', { skchr_gvial2_3: skillNode([START]) }),
      char_1031_slent2: unit('char_1031_slent2', { skchr_slent2_3: skillNode([START]) }),
      char_1012_skadi2: unit('char_1012_skadi2', { skchr_skadi2_1: skillNode([START]) }),
      char_1043_leizi2: unit('char_1043_leizi2', {
        skchr_leizi2_3: skillNode([LOOP], {
          uses: [{ role: 'loop', keys: [LOOP], from: 'ActiveBuffAbility._buffs', node: 'skchr_leizi2_3', on: 'owner' }],
        }),
      }),
    },
    projectiles: {
      projectile_chr_chen3_s3: { main: TRAIL, onHit: [WAVE_HIT], effects: [TRAIL, WAVE_HIT], lifeTime: 10, movement: { class: 'AdvancedMovement', speed: 1.5 } },
      projectile_chr_hsgma2_s2: { main: 'hsgma2_skill_02_trail_01', onHit: [SHIELD_HIT], effects: [SHIELD_HIT], lifeTime: 10, movement: { class: 'RotateAroundMovement' } },
    },
    skills: {},
    skins: {},
    generic: { hit: { phys: 'g_hit' }, die: {}, birth: {}, status: {}, keys: [] },
    prefabs,
  };
}

const ALL = [START, TRAIL, WAVE_HIT, BUFF_A, BUFF_B, TILE, SHIELD_HIT, BOOM, BLEED, GRAVE, SKADI_A, SKADI_B, LOOP];

async function setup({ defId, skillId, installed = ALL, active = true, at = [4, 6] } = {}) {
  const index = makeIndex(installed);
  const handles = [];
  const ofx = {
    active, time: 0, lite: false, tier: active ? 'full' : 'off', timers: [], ctx: {},
    lib: {
      has: (k) => !!index.prefabs[k], def: (k) => (index.prefabs[k] ? { isLoop: index.prefabs[k].looping, spawn: 1 } : null),
      index: async () => index, preload: async (keys) => keys.length, defs: new Map(),
    },
    spawn(key, place, opts) {
      if (!this.active) return null;
      const h = {
        key, place, opts, time: 0, anchor: place.pos ? place.pos.slice() : [0, 0, 0], yaw: place.yaw ?? 0, pitch: 0, mirror: false, stopped: null,
        get alive() { return !this.stopped; }, stop(o = {}) { this.stopped = o; }, kill() { this.stopped = { killed: true }; },
      };
      handles.push(h);
      return h;
    },
  };
  const views = new Map();
  const w = new FxWiring(ofx, {
    speed: () => 10,
    record: (info) => ({ skill: { skillId: info.skillId, index: 0, skillType: 'MANUAL', durationType: 'SECONDS', duration: 10, bb: { duration: 6 } } }),
    view: (id) => views.get(id) || null,
  });
  await w.ready();
  const her = {
    id: 1, x: at[0], y: at[1], z: 0, visFacing: 1, isEnemy: false, alive: true, flags: 0, sp: 0, spMax: 30, dir: 'RIGHT',
    info: { id: 1, spine: defId, defId, side: 'ally', kind: 'op', skillIndex: 0, skillId },
  };
  const ally = {
    id: 2, x: 5, y: 6, z: 0, visFacing: 1, isEnemy: false, alive: true, flags: 0, sp: 0, spMax: 0, dir: 'RIGHT',
    info: { id: 2, spine: 'char_ally', defId: 'char_ally', side: 'ally', kind: 'op', skillIndex: 0 },
  };
  const enemy = {
    id: 3, x: 8, y: 6, z: 0, visFacing: -1, isEnemy: true, alive: true, flags: 0, dir: 'LEFT',
    info: { id: 3, spine: 'enemy_dummy', defId: 'enemy_dummy', side: 'enemy', kind: 'enemy' },
  };
  views.set(1, her); views.set(2, ally); views.set(3, enemy);
  await w.begin([...views.values()]);
  w.tick();
  return { w, ofx, her, ally, enemy, handles };
}

const keysOf = (handles, k) => handles.filter((h) => h.key === k);
const advance = (ofx, w, s) => { ofx.time += s; w.tick(); };

describe('round 86 lane f2 official effects', () => {
  test('bindings, archetypes and the chen3 projectile preload', () => {
    const c3 = FX_BINDINGS.skchr_chen3_3;
    assert.equal(c3.chen3Wave.track, true);
    assert.deepEqual([...c3.chen3Wave.keys], [TRAIL]);
    assert.equal(c3.chen3Wave.tag, 'chen3:wave');
    assert.deepEqual([...c3.slash.keys], [WAVE_HIT]);
    assert.equal(c3.slash.tag, 'chen3:wave');
    const c2 = FX_BINDINGS.skchr_chen3_2.blink;
    assert.equal(c2.untilSkill, true);
    assert.equal(c2.holdS, 6);
    assert.deepEqual([...c2.keys], [BUFF_A, BUFF_B]);
    assert.equal(FX_BINDINGS.skchr_hsgma2_2.strike.claimHit, true);
    assert.equal(FX_BINDINGS.skchr_headb2_3.aoe.tag, 'headb2:highland');
    assert.equal(FX_BINDINGS.skchr_gvial2_3.gvialBleed.tag, 'gvial2:bleed');
    assert.equal(FX_BINDINGS.skchr_slent2_3.undying.owner, 'src');
    assert.equal(FX_BINDINGS.skchr_skadi2_1.skadiWard.at, 'target');
    assert.equal(fxSpec('chen3Wave').a, 'qi');
    assert.equal(fxSpec('skadiWard').a, 'none');
    assert.equal(fxSpec('gvialBleed').a, 'none');
    assert.equal(fxSpec('undying').a, 'shield');
    const ks = bindingKeys({ projectiles: { projectile_chr_chen3_s3: { main: TRAIL, onHit: [WAVE_HIT] } } }, 'skchr_chen3_3');
    assert.ok(ks.includes(TRAIL) && ks.includes(WAVE_HIT));
    assert.equal(FX_BINDINGS.skchr_aglna2_2, undefined);
    assert.equal(FX_BINDINGS.sktok_skadi2_1, undefined);
  });

  test('chen3 S3: one trail follows the samples and replaces qi; skill off stops it; a missing prefab does not', async () => {
    const { w, ofx, her, handles } = await setup({ defId: 'char_1050_chen3', skillId: 'skchr_chen3_3' });
    assert.equal(w.skill(her, true), true);
    const before = handles.length;
    assert.equal(w.simFx('chen3Wave', 6, 6, { id: 1, fromX: 4, fromY: 6, dr: 0, dc: 1, skill: 'chen3:wave' }), true);
    const trails = keysOf(handles, TRAIL);
    assert.equal(trails.length, 1);
    assert.equal(handles.slice(before).some((h) => h.key !== TRAIL && h.key !== START), false);
    const shot = trails[0];
    assert.ok(shot.opts.loop && shot.opts.important);
    assert.ok(Math.abs(shot.yaw) < 1e-12);
    shot.opts.track(shot);
    assert.deepEqual(shot.anchor, boardToUnity(6, 6, 0));
    assert.equal(w.simFx('chen3Wave', 6, 8, { id: 1, fromX: 6, fromY: 6, dr: 1, dc: 0, skill: 'chen3:wave' }), true);
    assert.equal(keysOf(handles, TRAIL).length, 1, 'the looping trail is not spawned again');
    shot.opts.track(shot);
    assert.deepEqual(shot.anchor, boardToUnity(6, 8, 0));
    assert.ok(Math.abs(shot.yaw - Math.PI / 2) < 1e-12);
    const hitBefore = keysOf(handles, WAVE_HIT).length;
    assert.equal(w.simFx('slash', 7, 8, { id: 1, skill: 'chen3:wave' }), true);
    assert.equal(keysOf(handles, WAVE_HIT).length, hitBefore + 1);
    assert.equal(w.simFx('slash', 7, 8, { id: 1, skill: 'chen3:slash' }), false, 'S2 slash tag is not the wave hit');
    w.skill(her, false);
    assert.ok(shot.stopped, 'skill off stops the living trail');
    // `during` still holds for COVER_AFTER_S. Past that the sample is not the skill's, so qi stays.
    advance(ofx, w, 1.1);
    assert.equal(w.simFx('chen3Wave', 6, 9, { id: 1, dr: 1, dc: 0, skill: 'chen3:wave' }), false);

    const bare = await setup({ defId: 'char_1050_chen3', skillId: 'skchr_chen3_3', installed: ALL.filter((k) => k !== TRAIL) });
    bare.w.skill(bare.her, true);
    assert.equal(bare.w.simFx('chen3Wave', 6, 6, { id: 1, dr: 0, dc: 1, skill: 'chen3:wave' }), false);
    assert.equal(keysOf(bare.handles, TRAIL).length, 0);

    const off = await setup({ defId: 'char_1050_chen3', skillId: 'skchr_chen3_3', active: false });
    off.w.skill(off.her, true);
    assert.equal(off.w.simFx('chen3Wave', 6, 6, { id: 1, dr: 0, dc: 1, skill: 'chen3:wave' }), false);
    assert.equal(off.w.simFx('slash', 7, 6, { id: 1, skill: 'chen3:wave' }), false);
    assert.equal(off.handles.length, 0);
  });

  test('chen3 S2 plays both respawn buffs and stops them with the skill; it does not play the wave hit', async () => {
    const { w, ofx, her, handles } = await setup({ defId: 'char_1050_chen3', skillId: 'skchr_chen3_2' });
    w.skill(her, true);
    const before = handles.length;
    assert.equal(w.simFx('blink', her.x, her.y, { id: 1, skill: 'chen3:respawn' }), true);
    const spawned = handles.slice(before).map((h) => h.key).sort();
    assert.deepEqual(spawned, [BUFF_A, BUFF_B].sort());
    assert.ok(handles.slice(before).every((h) => h.opts.loop));
    assert.equal(w.simFx('slash', 7, 6, { id: 1, skill: 'chen3:slash' }), false);
    assert.equal(w.simFx('chen3Wave', 6, 6, { id: 1, dr: 0, dc: 1, skill: 'chen3:wave' }), false);
    w.skill(her, false);
    assert.ok(handles.slice(before).every((h) => h.stopped), 'untilSkill stops the buffs when the skill ends');
    advance(ofx, w, 6);
    assert.ok(handles.slice(before).every((h) => h.stopped));
  });

  test('headb2 highland tile plays; the hammer aoe does not', async () => {
    const { w, ofx, her, handles } = await setup({ defId: 'char_1051_headb2', skillId: 'skchr_headb2_3' });
    w.skill(her, true);
    advance(ofx, w, 0.1);
    assert.equal(w.simFx('aoe', 7, 8, { id: 1, radius: 1, skill: 'headb2:highland' }), true);
    assert.equal(keysOf(handles, TILE).length, 1);
    const n = handles.length;
    assert.equal(w.simFx('aoe', 9, 4, { id: 1, radius: 1.5, skill: 'headb2:hammer' }), false);
    assert.equal(handles.length, n);
    const off = await setup({ defId: 'char_1051_headb2', skillId: 'skchr_headb2_3', active: false });
    off.w.skill(off.her, true);
    assert.equal(off.w.simFx('aoe', 7, 8, { id: 1, radius: 1, skill: 'headb2:highland' }), false);
  });

  test('hsgma2 shield strike plays the hit; S1 counter does not; claimHit skips the projectile onHit', async () => {
    const { w, her, enemy, handles } = await setup({ defId: 'char_1044_hsgma2', skillId: 'skchr_hsgma2_2' });
    w.skill(her, true);
    assert.equal(w.simFx('strike', 8, 6, { id: 1, skill: 'hsgma2:shield' }), true);
    assert.equal(keysOf(handles, SHIELD_HIT).length, 1);
    const n = handles.length;
    assert.equal(w.simFx('counter', her.x, her.y, { id: 1 }), false);
    assert.equal(w.simFx('strike', 8, 6, { id: 1 }), false);
    assert.equal(handles.length, n);
    assert.equal(w.skills.ownsHit(her, SHIELD_HIT), true);
    w._arrive({ onHit: [SHIELD_HIT] }, enemy, [0, 0, 0], null, null, her);
    assert.equal(keysOf(handles, SHIELD_HIT).length, 1, 'the projectile arrival does not play the hit again');
    const off = await setup({ defId: 'char_1044_hsgma2', skillId: 'skchr_hsgma2_2', active: false });
    assert.equal(off.w.skills.ownsHit(off.her, SHIELD_HIT), false);
    const s1 = await setup({ defId: 'char_1044_hsgma2', skillId: 'skchr_hsgma2_1' });
    s1.w.skill(s1.her, true);
    assert.equal(s1.w.skills.ownsHit(s1.her, SHIELD_HIT), false);
    assert.equal(s1.w.simFx('strike', 8, 6, { id: 1, skill: 'hsgma2:shield' }), false);
    const before = s1.handles.length;
    s1.w._arrive({ onHit: [SHIELD_HIT] }, s1.enemy, [0, 0, 0], null, null, s1.her);
    assert.deepEqual(s1.handles.slice(before).map((h) => h.key), [SHIELD_HIT]);
  });

  test('reed S3 scorch burst plays the boom; S2 does not; official off does not', async () => {
    const { w, her, handles } = await setup({ defId: 'char_1020_reed2', skillId: 'skchr_reed2_3' });
    w.skill(her, true);
    assert.equal(w.simFx('scorchBurst', 9, 7, { id: 1, r: 1 }), true);
    assert.equal(keysOf(handles, BOOM).length, 1);
    const s2 = await setup({ defId: 'char_1020_reed2', skillId: 'skchr_reed2_2' });
    s2.w.skill(s2.her, true);
    assert.equal(s2.w.simFx('scorchBurst', 9, 7, { id: 1, r: 1 }), false);
    const off = await setup({ defId: 'char_1020_reed2', skillId: 'skchr_reed2_3', active: false });
    off.w.skill(off.her, true);
    assert.equal(off.w.simFx('scorchBurst', 9, 7, { id: 1, r: 1 }), false);
  });

  test('gvial bleed starts as the skill ends and holds extra.duration', async () => {
    const { w, ofx, her, handles } = await setup({ defId: 'char_1026_gvial2', skillId: 'skchr_gvial2_3' });
    w.skill(her, true);
    w.skill(her, false);
    assert.equal(w.simFx('gvialBleed', her.x, her.y, { id: 1, duration: 4, skill: 'gvial2:bleed' }), true);
    const bleed = keysOf(handles, BLEED);
    assert.equal(bleed.length, 1);
    assert.equal(bleed[0].opts.loop, true);
    advance(ofx, w, 3.9);
    assert.equal(bleed[0].stopped, null);
    advance(ofx, w, 0.2);
    assert.ok(bleed[0].stopped);
    const late = await setup({ defId: 'char_1026_gvial2', skillId: 'skchr_gvial2_3' });
    late.w.skill(late.her, true);
    late.w.skill(late.her, false);
    advance(late.ofx, late.w, 2);
    assert.equal(late.w.simFx('gvialBleed', late.her.x, late.her.y, { id: 1, duration: 20, skill: 'gvial2:bleed' }), false);
    const off = await setup({ defId: 'char_1026_gvial2', skillId: 'skchr_gvial2_3', active: false });
    off.w.skill(off.her, true);
    off.w.skill(off.her, false);
    assert.equal(off.w.simFx('gvialBleed', off.her.x, off.her.y, { id: 1, duration: 20, skill: 'gvial2:bleed' }), false);
  });

  test('slent2 grave plays on the ally for the fx duration; another undying does not', async () => {
    const { w, ofx, her, ally, handles } = await setup({ defId: 'char_1031_slent2', skillId: 'skchr_slent2_3' });
    w.skill(her, true);
    assert.equal(w.simFx('undying', ally.x, ally.y, { id: ally.id, src: her.id, duration: 5, skill: 'slent2:grave' }), true);
    const g = keysOf(handles, GRAVE);
    assert.equal(g.length, 1);
    assert.equal(g[0].opts.owner.id, ally.id);
    advance(ofx, w, 5);
    assert.ok(g[0].stopped);
    const n = handles.length;
    assert.equal(w.simFx('undying', her.x, her.y, { id: her.id }), false);
    assert.equal(handles.length, n);
    const off = await setup({ defId: 'char_1031_slent2', skillId: 'skchr_slent2_3', active: false });
    off.w.skill(off.her, true);
    assert.equal(off.w.simFx('undying', off.ally.x, off.ally.y, { id: off.ally.id, src: off.her.id, duration: 5, skill: 'slent2:grave' }), false);
  });

  test('skadi transfer plays both hits on the ally; official off plays neither', async () => {
    const { w, her, ally, handles } = await setup({ defId: 'char_1012_skadi2', skillId: 'skchr_skadi2_1' });
    w.skill(her, true);
    assert.equal(w.simFx('skadiWard', ally.x, ally.y, { id: her.id, target: ally.id, skill: 'skadi2:transfer' }), true);
    const spawned = handles.filter((h) => h.key === SKADI_A || h.key === SKADI_B);
    assert.deepEqual(spawned.map((h) => h.key).sort(), [SKADI_A, SKADI_B].sort());
    assert.ok(spawned.every((h) => h.opts.owner.id === ally.id));
    assert.ok(spawned.every((h) => !h.opts.loop));
    const off = await setup({ defId: 'char_1012_skadi2', skillId: 'skchr_skadi2_1', active: false });
    off.w.skill(off.her, true);
    assert.equal(off.w.simFx('skadiWard', off.ally.x, off.ally.y, { id: off.her.id, target: off.ally.id, skill: 'skadi2:transfer' }), false);
    assert.equal(off.handles.length, 0);
  });

  test('leizi2:current is not swallowed while her loop plays; another near pulse still is', async () => {
    const { w, her, handles } = await setup({ defId: 'char_1043_leizi2', skillId: 'skchr_leizi2_3' });
    assert.equal(w.skill(her, true), true);
    assert.ok(keysOf(handles, LOOP).some((h) => h.alive));
    const n = handles.length;
    assert.equal(w.simFx('pulse', her.x, her.y, { id: 1, skill: 'leizi2:current' }), false);
    assert.equal(w.simFx('pulse', 9, 6, { id: 1, skill: 'leizi2:current' }), false);
    assert.equal(handles.length, n);
    assert.equal(w.simFx('pulse', her.x, her.y, { id: 1, skill: 'other:pulse' }), true, 'a different near skill-tagged pulse is still a cast flash');
    assert.equal(handles.length, n);
    const off = await setup({ defId: 'char_1043_leizi2', skillId: 'skchr_leizi2_3', active: false });
    off.w.skill(off.her, true);
    assert.equal(off.w.simFx('pulse', off.her.x, off.her.y, { id: 1, skill: 'leizi2:current' }), false);
  });

  test('retagBound marks keys and hits a binding plays, and leaves no-prefab alone', () => {
    const idx = {
      skills: {
        skchr_reed2_3: {
          rootClass: 'ActiveBuffAbility', projectiles: [], abilities: [],
          uses: [
            { role: 'hit', keys: [BOOM], from: 'UberEffectEmitter._hitEffects', ability: 'ActiveBuffAbility', node: 'skchr_reed2_3' },
            { role: 'hit', keys: ['reed2_other'], from: 'UberEffectEmitter._hitEffects', ability: 'ActiveBuffAbility', node: 'skchr_reed2_3' },
            { role: 'hit', keys: ['missing_boom'], from: 'UberEffectEmitter._hitEffects', ability: 'ActiveBuffAbility', node: 'skchr_reed2_3' },
          ],
        },
        skchr_headb2_3: {
          rootClass: 'ActiveBuffAbility', projectiles: [], abilities: [],
          uses: [{ role: 'range', keys: [TILE], from: 'Headb2S3HighlandAOE._tileEffectKey', node: 'skchr_headb2_3' }],
        },
        skchr_gvial2_3: {
          rootClass: 'ActiveBuffAbility', projectiles: [], abilities: [],
          uses: [{ role: 'loop', keys: [BLEED], from: 'ActiveBuffAbility._buffs', event: 'ON_BUFF_FINISH', action: 'CreateBuff', on: 'owner', node: 'skchr_gvial2_3' }],
        },
      },
      prefabs: { [BOOM]: { looping: false }, reed2_other: { looping: false }, [TILE]: { looping: false }, [BLEED]: { looping: true } },
      projectiles: {},
    };
    const reed = skillPlan(idx, null, 'skchr_reed2_3');
    const reason = (plan, key) => plan.unmapped.find((u) => u.key === key)?.reason;
    assert.equal(reason(reed, BOOM), 'bound');
    assert.equal(reason(reed, 'reed2_other'), 'hit-no-attack');
    assert.equal(reason(reed, 'missing_boom'), 'no-prefab');
    assert.equal(reason(skillPlan(idx, null, 'skchr_headb2_3'), TILE), 'bound');
    assert.equal(reason(skillPlan(idx, null, 'skchr_gvial2_3'), BLEED), 'bound');
  });
});

describe('round 86 lane f2 against the extracted index', { skip: !existsSync(INDEX) && 'no public/assets/local/fx/index.json' }, () => {
  const idx = existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, 'utf8')) : null;
  const reason = (id, key) => {
    const plan = skillPlan(idx, null, id, { rec: { duration: 10, durationType: 'SECONDS', skillId: id } });
    return plan.unmapped.find((u) => u.key === key)?.reason ?? null;
  };

  test('wired keys are bound and the chen3 projectile is no longer an idle shot', () => {
    assert.equal(reason('skchr_skadi2_1', SKADI_A), 'bound');
    assert.equal(reason('skchr_skadi2_1', SKADI_B), 'bound');
    assert.equal(reason('skchr_reed2_3', BOOM), 'bound');
    assert.equal(reason('skchr_gvial2_3', BLEED), 'bound');
    assert.equal(reason('skchr_slent2_3', GRAVE), 'bound');
    assert.equal(reason('skchr_hsgma2_2', SHIELD_HIT), 'bound');
    assert.equal(reason('skchr_chen3_2', BUFF_A), 'bound');
    assert.equal(reason('skchr_chen3_2', BUFF_B), 'bound');
    assert.equal(reason('skchr_headb2_3', TILE), 'bound');
    const chen = skillPlan(idx, 'char_1050_chen3', 'skchr_chen3_3', { rec: { duration: 10, durationType: 'SECONDS' } });
    assert.deepEqual(chen.projectiles, ['projectile_chr_chen3_s3']);
    assert.equal(chen.attacks.length, 0);
    const bound = new Set(bindingKeys(idx, 'skchr_chen3_3'));
    assert.ok(bound.has(TRAIL) && bound.has(WAVE_HIT));
    const leizi = skillPlan(idx, 'char_1043_leizi2', 'skchr_leizi2_3', { rec: { duration: 20, durationType: 'SECONDS' } });
    assert.deepEqual(leizi.pulse, []);
    assert.ok(leizi.loop.some((e) => e.key === LOOP));
  });

  test('rows left unwired stay on their official reason', () => {
    assert.equal(reason('skchr_chen2_2', 'chen2_skill_02_buff_01_01'), 'conditional');
    assert.equal(reason('skchr_nearl2_3', 'nearl2_buff_01_start'), 'conditional');
    assert.equal(reason('skchr_aglna2_3', 'aglna2_skill_03_buff_left_01'), 'conditional');
    assert.equal(reason('skchr_aglna2_3', 'aglna2_skill_03_range_line_01'), 'path');
    assert.equal(reason('skchr_leizi2_1', 'leizi2_skill_01_buff_01'), 'conditional');
    assert.equal(reason('skchr_sbell2_1', 'sbell2_idle'), 'after-end');
    assert.equal(reason('skchr_amiya3_1', 'amiya3_skill_01_range'), 'conditional');
    assert.equal(reason('sktok_skadi2_1', SKADI_A), 'conditional');
    const ag = skillPlan(idx, null, 'skchr_aglna2_2');
    assert.deepEqual(ag.projectiles, ['projectile_chr_aglna2_s2_fly']);
    assert.equal(ag.attacks.length, 0);
    assert.equal(bindingKeys(idx, 'skchr_aglna2_2').length, 0);
  });
});
