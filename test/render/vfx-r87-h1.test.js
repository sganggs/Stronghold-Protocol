// test/render/vfx-r87-h1.test.js — round 87 lane h1. Claims for effects round 86 already plays, plus
// 暴雨 S1's camou loop and 摆渡人 S2's barrier loop. Synthetic index. With 官方特效 off nothing of this plays.
// The real public/assets/local index is read only when the file is present (GitHub CI has no art pack).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FxWiring } from '../../public/js/render/vfx/wiring.js';
import { FX_BINDINGS, bindingKeys, skillPlan } from '../../public/js/render/vfx/skills.js';
import { fxSpec } from '../../public/js/render/fx/kinds.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const INDEX = path.join(ROOT, 'public/assets/local/fx/index.json');

const ZEBRA = 'zebra_buff_01';
const VARKIS = 'varkis_skill_02_shield_1';
const CAMOU = 'turdus_skill_02_buff_01';
const HOT = 'turdus_skill_02_hit_01';
const BRANCH = 'branch_skill_02_hit_01';
const NASTI = 'nasti_skill_01_common_buff_01';
const RANGE2 = 'token_closur_ourbase_range_02_loop';
const MCN = 'mcnist_skill_02_buff_01';
const GUARD = 'rmixer_skill_02_start_02';
const H1 = 'hbound_skill1_hit_01';
const H2 = 'hbound_skill2_hit_01';
const LEFT = 'h1_left_unclaimed';

const LOOPING = new Set([ZEBRA, VARKIS, CAMOU, NASTI, RANGE2, MCN, GUARD]);

function use(key, extra) {
  return { role: 'loop', keys: [key], from: 'PassiveBuffAbility._buffs', node: 'n', on: 'owner', ...extra };
}

function skillOf(uses) {
  return { rootClass: 'CastSkill', mode: null, projectiles: [], effects: uses.flatMap((u) => u.keys), abilities: [], uses };
}

function makeIndex(drop = []) {
  const gone = new Set(drop);
  const keys = [ZEBRA, VARKIS, CAMOU, HOT, BRANCH, NASTI, RANGE2, MCN, GUARD, H1, H2, LEFT];
  const prefabs = Object.fromEntries(keys.filter((k) => !gone.has(k)).map((k) => [k, { file: `prefabs/${k}.json`, looping: LOOPING.has(k), spawn: 1 }]));
  const skills = {
    skchr_zebra_1: skillOf([use(ZEBRA, { event: 'ON_BUFF_TRIGGER', action: 'CreateBuff', on: 'targets' })]),
    skchr_varkis_2: skillOf([use(VARKIS, { event: 'ON_BUFF_TRIGGER', action: 'CreateBuff' })]),
    skchr_turdus_2: skillOf([
      use(CAMOU, { event: 'ON_BUFF_TRIGGER', action: 'CreateBuff', on: 'targets' }),
      use(HOT, { role: 'trigger', event: 'ON_BUFF_TRIGGER', action: 'CreateEffect', on: 'targets' }),
      use(LEFT, { role: 'trigger', event: 'ON_BUFF_TRIGGER', action: 'CreateEffect', on: 'targets' }),
    ]),
    skchr_branch_2: skillOf([use(BRANCH, { role: 'hit', ability: 'AnimatedToTarget', oneshot: true, from: 'UberEffectEmitter._hitEffects' })]),
    skchr_nasti_1: skillOf([use(NASTI, { event: 'ON_BUFF_FINISH', action: 'CreateBuff', from: 'BuffDuringSkill._buffs' })]),
    skchr_closur_2: skillOf([use(RANGE2, { event: 'ON_BUFF_START', action: 'CreateBuffToToken' })]),
    skchr_mcnist_2: skillOf([use(MCN, { action: 'CreateBuffToToken', on: 'token' })]),
    skchr_rmixer_2: skillOf([use(GUARD, { role: 'trigger', event: 'ON_BEFORE_TRY_SET_HP_ZERO', action: 'CreateEffect' })]),
    skchr_hbound_1: skillOf([use(H1, { role: 'trigger', event: 'ON_BUFF_TRIGGER', action: 'CreateEffectHookProjectileEffect', on: 'targets' })]),
    skchr_hbound_2: skillOf([use(H2, { role: 'trigger', event: 'ON_BUFF_TRIGGER', action: 'CreateEffect', on: 'targets' })]),
  };
  const char = (id, skillIds) => ({
    kind: 'char', talents: {}, startEffect: null, deadEffect: null,
    modes: [{ name: 'Default', attack: { class: 'MeleeAttack', cast: [], hit: [] }, combat: null }],
    skills: Object.fromEntries(skillIds.map((s) => [s, skills[s]])),
  });
  return {
    units: {
      char_304_zebra: char('char_304_zebra', ['skchr_zebra_1']),
      char_4166_varkis: char('char_4166_varkis', ['skchr_varkis_2']),
      char_4224_turdus: char('char_4224_turdus', ['skchr_turdus_2']),
      char_4207_branch: char('char_4207_branch', ['skchr_branch_2']),
      char_4212_nasti: char('char_4212_nasti', ['skchr_nasti_1']),
      char_4228_closur: char('char_4228_closur', ['skchr_closur_2']),
      char_4230_mcnist: char('char_4230_mcnist', ['skchr_mcnist_2']),
      char_4194_rmixer: char('char_4194_rmixer', ['skchr_rmixer_2']),
      char_4232_hbound: char('char_4232_hbound', ['skchr_hbound_1', 'skchr_hbound_2']),
    },
    skills, projectiles: {}, skins: {},
    generic: { hit: {}, die: {}, birth: {}, status: {}, keys: [] },
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
  const w = new FxWiring(ofx, { speed: () => 10, record: () => rec(skillId, duration), view: (id) => views.get(id) || null });
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
  const her = add({ info: { id: 1, spine, defId: spine, side: 'ally', kind: 'op', skillIndex: 0 } });
  her.info.id = her.id;
  const frame = (dt = 1 / 30) => {
    w.sync(views.values()); w.tick(); ofx.time += dt;
    for (const h of handles) if (!h.stopped && typeof h.opts?.track === 'function') { h.time += dt; h.opts.track(h); }
  };
  await w.begin([...views.values()]);
  frame();
  return { w, ofx, her, frame, handles, add };
}

const reasons = (plan, key) => plan.unmapped.filter((u) => u.key === key).map((u) => u.reason);

describe('round 87 lane h1', () => {
  test('cosmetic kinds draw nothing, and the new bindings name the official prefabs', () => {
    assert.equal(fxSpec('zebraCamou').a, 'none');
    assert.equal(fxSpec('varkisShield').a, 'none');
    assert.equal(fxSpec('varkisShieldEnd').a, 'none');
    const z = FX_BINDINGS.skchr_zebra_1.zebraCamou;
    assert.equal(z.claim, true);
    assert.equal(z.at, 'target');
    assert.equal(z.hold, 'fx');
    assert.deepEqual([...z.keys], [ZEBRA]);
    const v = FX_BINDINGS.skchr_varkis_2.varkisShield;
    assert.equal(v.hold, 'open');
    assert.equal(v.claim, true);
    assert.deepEqual([...v.keys], [VARKIS]);
    assert.equal(FX_BINDINGS.skchr_varkis_2.varkisShieldEnd.stopOpen, 'varkisShield');
    assert.equal(FX_BINDINGS.skchr_turdus_2.turdusCamou.claim, true);
    assert.equal(FX_BINDINGS.skchr_turdus_2.turdusHot.claim, true);
    assert.equal(FX_BINDINGS.skchr_rmixer_2.shield.claim, true);
    assert.equal(FX_BINDINGS.skchr_branch_2.onAttack.claim, true);
    assert.equal(FX_BINDINGS.skchr_nasti_1.linger.claim, true);
    assert.equal(FX_BINDINGS.skchr_closur_2.tokenRange.claim, true);
    assert.equal(FX_BINDINGS.skchr_closur_3.tokenRange.claim, true);
    assert.equal(FX_BINDINGS.skchr_mcnist_2.tokenBuff.claim, true);
    assert.equal(FX_BINDINGS.skchr_hbound_1.zone.claim, true);
    assert.equal(FX_BINDINGS.skchr_hbound_2.zone.claim, true);
    // empty projectiles and unresolved conditions stay unbound
    for (const id of ['skchr_aglna2_2', 'skchr_aglna2_3', 'skchr_tocka_1', 'skchr_tocka_2', 'skchr_tocka_3', 'skchr_monstr_1', 'skchr_vigil_2', 'skchr_sbell2_1', 'skchr_sbell2_2', 'skchr_sbell2_3', 'skchr_leizi2_1', 'skchr_chen2_2']) {
      assert.equal(FX_BINDINGS[id], undefined, id);
    }
    assert.deepEqual([...FX_BINDINGS.skchr_closur_2.tokenRange.keys], [RANGE2]);
  });

  test('claim retags the rows these bindings play and leaves an unlisted tick', () => {
    const idx = makeIndex();
    const plan = (unit, sid) => skillPlan(idx, unit, sid);
    const bound = (unit, sid, key) => {
      const rs = reasons(plan(unit, sid), key);
      assert.ok(rs.length > 0 && rs.every((r) => r === 'bound'), `${sid} ${key} ${rs}`);
    };
    bound('char_304_zebra', 'skchr_zebra_1', ZEBRA);
    bound('char_4166_varkis', 'skchr_varkis_2', VARKIS);
    bound('char_4224_turdus', 'skchr_turdus_2', CAMOU);
    bound('char_4224_turdus', 'skchr_turdus_2', HOT);
    assert.deepEqual(reasons(plan('char_4224_turdus', 'skchr_turdus_2'), LEFT), ['tick']);
    bound('char_4207_branch', 'skchr_branch_2', BRANCH);
    bound('char_4212_nasti', 'skchr_nasti_1', NASTI);
    bound('char_4228_closur', 'skchr_closur_2', RANGE2);
    bound('char_4230_mcnist', 'skchr_mcnist_2', MCN);
    bound('char_4194_rmixer', 'skchr_rmixer_2', GUARD);
    bound('char_4232_hbound', 'skchr_hbound_1', H1);
    bound('char_4232_hbound', 'skchr_hbound_2', H2);
  });

  test('暴雨 S1 plays zebra_buff_01 on the ally for the fx duration, and not for another skill', async () => {
    const { w, ofx, her, frame, handles, add } = await setup({ skillId: 'skchr_zebra_1', spine: 'char_304_zebra', duration: 0 });
    const ally = add({ x: 5, y: 6, info: { spine: 'char_x', defId: 'char_x', side: 'ally', kind: 'op' } });
    ally.info.id = ally.id;
    w.skill(her, true);
    w.skill(her, false);
    assert.equal(w.simFx('zebraCamou', ally.x, ally.y, { id: her.id, target: ally.id, skill: 'zebra:camou', duration: 1 }), true);
    assert.deepEqual(handles.map((h) => h.key), [ZEBRA]);
    assert.equal(handles[0].opts.loop, true);
    assert.equal(handles[0].opts.owner, ally);
    assert.equal(typeof handles[0].opts.track, 'function');
    const n = handles.length;
    assert.equal(w.simFx('zebraCamou', ally.x, ally.y, { id: her.id, target: ally.id, skill: 'other', duration: 1 }), false);
    assert.equal(handles.length, n);
    for (let i = 0; i < 20; i++) frame();
    assert.equal(handles[0].alive, true, 'still inside the 1 s buff');
    for (let i = 0; i < 16; i++) frame();
    assert.equal(handles[0].alive, false, 'the loop stops when the buff duration ends');
    const off = await setup({ skillId: 'skchr_zebra_1', spine: 'char_304_zebra', active: false });
    const a2 = off.add({ info: { spine: 'char_x', defId: 'char_x', side: 'ally', kind: 'op' } });
    a2.info.id = a2.id;
    off.w.skill(off.her, true);
    assert.equal(off.w.simFx('zebraCamou', a2.x, a2.y, { id: off.her.id, target: a2.id, skill: 'zebra:camou', duration: 4 }), false);
    assert.equal(off.handles.length, 0);
    const bare = await setup({ skillId: 'skchr_zebra_1', spine: 'char_304_zebra', drop: [ZEBRA] });
    const a3 = bare.add({ info: { spine: 'char_x', defId: 'char_x', side: 'ally', kind: 'op' } });
    a3.info.id = a3.id;
    bare.w.skill(bare.her, true);
    assert.equal(bare.w.simFx('zebraCamou', a3.x, a3.y, { id: bare.her.id, target: a3.id, skill: 'zebra:camou', duration: 4 }), false);
    assert.equal(bare.handles.length, 0);
    assert.equal(ofx.time > 0, true);
  });

  test('摆渡人 S2 holds the shield loop until the barrier ends, including after the skill', async () => {
    const { w, her, handles } = await setup({ skillId: 'skchr_varkis_2', spine: 'char_4166_varkis' });
    w.skill(her, true);
    assert.equal(w.simFx('varkisShield', her.x, her.y, { id: her.id, skill: 'varkis:shield' }), true);
    assert.equal(handles.length, 1);
    assert.equal(handles[0].key, VARKIS);
    assert.equal(handles[0].opts.loop, true);
    assert.equal(handles[0].opts.owner, her);
    const first = handles[0];
    assert.equal(w.simFx('varkisShield', her.x, her.y, { id: her.id, skill: 'varkis:shield' }), true);
    assert.equal(first.alive, false, 'a second start replaces the loop');
    assert.equal(handles.filter((h) => h.alive && h.key === VARKIS).length, 1);
    w.skill(her, false);
    const live = handles.filter((h) => h.alive && h.key === VARKIS);
    assert.equal(live.length, 1, 'the barrier outlives the skill');
    assert.equal(w.simFx('varkisShieldEnd', her.x, her.y, { id: her.id, skill: 'varkis:shield' }), true);
    assert.equal(live[0].alive, false);
    assert.equal(handles.filter((h) => h.alive).length, 0);
    const again = handles.length;
    assert.equal(w.simFx('varkisShieldEnd', her.x, her.y, { id: her.id, skill: 'other' }), false);
    assert.equal(handles.length, again);
    const off = await setup({ skillId: 'skchr_varkis_2', spine: 'char_4166_varkis', active: false });
    off.w.skill(off.her, true);
    assert.equal(off.w.simFx('varkisShield', off.her.x, off.her.y, { id: off.her.id, skill: 'varkis:shield' }), false);
    assert.equal(off.w.simFx('varkisShieldEnd', off.her.x, off.her.y, { id: off.her.id, skill: 'varkis:shield' }), false);
    assert.equal(off.handles.length, 0);
    const bare = await setup({ skillId: 'skchr_varkis_2', spine: 'char_4166_varkis', drop: [VARKIS] });
    bare.w.skill(bare.her, true);
    assert.equal(bare.w.simFx('varkisShield', bare.her.x, bare.her.y, { id: bare.her.id, skill: 'varkis:shield' }), false);
    assert.equal(bare.handles.length, 0);
  });

  test('releasing 摆渡人 stops a shield loop that is still open', async () => {
    const { w, her, handles } = await setup({ skillId: 'skchr_varkis_2', spine: 'char_4166_varkis' });
    w.skill(her, true);
    assert.equal(w.simFx('varkisShield', her.x, her.y, { id: her.id, skill: 'varkis:shield' }), true);
    w.release(her);
    assert.equal(handles[0].alive, false);
  });
});

describe('round 87 lane h1 against the extracted index', { skip: !existsSync(INDEX) && 'no public/assets/local/fx/index.json' }, () => {
  const idx = existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, 'utf8')) : null;
  const reason = (id, key) => {
    const plan = skillPlan(idx, null, id, { rec: { duration: 10, durationType: 'SECONDS', skillId: id } });
    return plan.unmapped.filter((u) => u.key === key).map((u) => u.reason);
  };
  const allBound = (id, key) => {
    const rs = reason(id, key);
    assert.ok(rs.length > 0 && rs.every((r) => r === 'bound'), `${id} ${key} ${rs}`);
  };

  test('wired rows are bound and the rows left stay on their official reason', () => {
    allBound('skchr_zebra_1', ZEBRA);
    allBound('skchr_varkis_2', VARKIS);
    allBound('skchr_turdus_2', CAMOU);
    allBound('skchr_turdus_2', HOT);
    allBound('skchr_branch_2', BRANCH);
    allBound('skchr_nasti_1', NASTI);
    allBound('skchr_closur_2', RANGE2);
    allBound('skchr_closur_3', 'token_closur_ourbase_range_03_loop');
    allBound('skchr_mcnist_2', MCN);
    allBound('skchr_rmixer_2', GUARD);
    allBound('skchr_hbound_1', H1);
    allBound('skchr_hbound_2', H2);
    assert.ok(reason('skchr_monstr_1', 'monstr_skill_01_buff').includes('conditional'));
    assert.ok(reason('skchr_aglna2_3', 'aglna2_skill_03_buff_left_01').includes('conditional'));
    assert.ok(reason('skchr_aglna2_3', 'aglna2_skill_03_buff_right_01').includes('conditional'));
    assert.ok(reason('skchr_aglna2_3', 'aglna2_skill_03_range_line_01').includes('path'));
    assert.ok(reason('skchr_yu_3', 'yu_skill3_annex_02').includes('conditional'));
    assert.ok(reason('skchr_chen2_2', 'chen2_skill_02_buff_01_01').includes('conditional'));
    assert.ok(reason('skchr_chen2_2', 'chen2_skill_02_buff_01_02').includes('conditional'));
    assert.ok(reason('skchr_tocka_1', 'tocka_skill_01_buff_01').includes('conditional'));
    assert.ok(reason('skchr_leizi2_1', 'leizi2_skill_01_buff_01').includes('conditional'));
    assert.ok(reason('skchr_sbell2_1', 'sbell2_idle').includes('after-end'));
    assert.ok(reason('skchr_sbell2_2', 'sbell2_idle').includes('after-end'));
    assert.ok(reason('skchr_sbell2_3', 'sbell2_idle').includes('after-end'));
    assert.ok(reason('skchr_vigil_2', 'vigil_token_skill_02_ready').includes('token'));
    assert.ok(reason('skchr_closur_2', 'common_charge_cost_start_01').includes('tick'));
    const idle = (id) => {
      const plan = skillPlan(idx, null, id);
      const bound = new Set(bindingKeys(idx, id));
      return (plan.projectiles || []).filter((pk) => {
        const proj = idx.projectiles?.[pk];
        const ks = [pk, proj?.main, ...(proj?.onHit || []), ...(proj?.onReached || [])].filter(Boolean);
        return !ks.some((k) => bound.has(String(k).toLowerCase()));
      });
    };
    assert.deepEqual(idle('skchr_aglna2_2'), ['projectile_chr_aglna2_s2_fly']);
    assert.deepEqual(idle('skchr_aglna2_3').sort(), ['projectile_chr_aglna2_s3_aura', 'projectile_chr_aglna2_s3_fly']);
    assert.deepEqual(idle('skchr_tocka_2'), ['projectile_chr_tocka_s2']);
    assert.deepEqual(idle('skchr_tocka_3'), ['projectile_tocka_s3_effect']);
  });
});
