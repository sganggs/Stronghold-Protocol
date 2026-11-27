// test/render/vfx-r87-h2.test.js — round 87 lane h2.
//
// Miss.Christine S2: christ_skill_02_range waits for projectile_chr_christ_s2 to land. The trail still
// flies at the throw, the hit still plays at landing, and the range's hold ends at throw-time plus the
// spirit window. 承曦格雷伊 S2's range is the same landing (round 88): the ball's onReached, not the throw.
// 菲莱 S2's element-hit pair and 阿米娅（医疗） S1's heal pulse play their prefabs, and nothing with 官方特效 off.
// The art pack is absent on CI: the index assertions skip when public/assets/local/fx/index.json is missing.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FxWiring } from '../../public/js/render/vfx/wiring.js';
import { FX_BINDINGS, bindingKeys, skillPlan } from '../../public/js/render/vfx/skills.js';
import { fxSpec } from '../../public/js/render/fx/kinds.js';

const C_TRAIL = 'christ_skill_02_trail_01';
const C_RANGE = 'christ_skill_02_range';
const C_HIT = 'christ_skill_02_hit_02';
const C_PROJ = 'projectile_chr_christ_s2';
const G_TRAIL = 'greyy2_skill_02_trail';
const G_RANGE = 'greyy2_skill_02_range';
const G_HIT = 'greyy2_skill_02_hit_02';
const G_PROJ = 'projectile_chr_greyy2_s2';
const P_START = 'philae_skill_02_start_02';
const P_LOOP = 'philae_skill_02_buff_02';
const A_RANGE = 'amiya3_skill_01_range';
const ALL = [C_TRAIL, C_RANGE, C_HIT, G_TRAIL, G_RANGE, G_HIT, P_START, P_LOOP, A_RANGE];
const LOOPING = new Set([C_TRAIL, C_RANGE, G_TRAIL, G_RANGE, P_LOOP]);

function skillNode(projectiles = []) {
  return {
    rootClass: 'CastSkill', rootAbility: 'ActiveBuffAbility', effects: [], projectiles, mode: null,
    abilities: [], unclassified: [], roles: {}, uses: [],
  };
}

function makeIndex(installed = ALL) {
  const prefabs = Object.fromEntries(installed.map((k) => [k, { file: `prefabs/${k}.json`, looping: LOOPING.has(k), spawn: 1 }]));
  const christ = skillNode([C_PROJ]);
  const greyy = skillNode([G_PROJ]);
  const philae = skillNode();
  const amiya = skillNode();
  const unit = (skills) => ({ kind: 'char', talents: {}, startEffect: null, deadEffect: null, skills, modes: [{ name: 'Default', attack: null, combat: null }] });
  return {
    units: {
      char_4198_christ: unit({ skchr_christ_2: christ }),
      char_1027_greyy2: unit({ skchr_greyy2_2: greyy }),
      char_4148_philae: unit({ skchr_philae_2: philae }),
      char_1037_amiya3: unit({ skchr_amiya3_1: amiya }),
    },
    skills: { skchr_christ_2: christ, skchr_greyy2_2: greyy, skchr_philae_2: philae, skchr_amiya3_1: amiya },
    projectiles: {
      [C_PROJ]: { main: C_TRAIL, onReached: [C_RANGE], onHit: [C_HIT], movement: { class: 'ParacurveMovement', speed: 8 }, effects: [C_TRAIL, C_RANGE, C_HIT] },
      [G_PROJ]: { main: G_TRAIL, onReached: [G_RANGE], onHit: [G_HIT], movement: { class: 'AdvancedMovement', speed: 8 }, effects: [G_TRAIL, G_RANGE, G_HIT] },
    },
    skins: {}, generic: { hit: {}, die: {}, birth: {}, status: {}, keys: [] }, prefabs,
  };
}

const RECS = {
  char_4198_christ: { skillId: 'skchr_christ_2', index: 1, duration: 20, bb: {} },
  char_1027_greyy2: { skillId: 'skchr_greyy2_2', index: 1, duration: 16, bb: {} },
  char_4148_philae: { skillId: 'skchr_philae_2', index: 1, duration: 20, bb: {} },
  char_1037_amiya3: { skillId: 'skchr_amiya3_1', index: 0, duration: 20, bb: {} },
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
    record: (info) => ({ charId: info.defId, skill: RECS[info.defId] }),
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
  await w.begin([]);
  frame();
  return { w, ofx, view, frame, handles, index, keys: () => handles.map((h) => h.key) };
}

describe('round 87 lane h2 bindings', () => {
  test('the new entries and the in-place claims name the official keys', () => {
    const c = FX_BINDINGS.skchr_christ_2.zone;
    assert.deepEqual([...c.arrive], [C_RANGE]);
    assert.equal(c.fly, true);
    assert.equal(c.tag, 'christ:spirit');
    assert.equal(c.projectile, C_PROJ);
    assert.deepEqual([...(c.cover || [])], ['zone']);
    assert.deepEqual([...FX_BINDINGS.skchr_greyy2_2.zone.arrive], [G_RANGE]);
    assert.equal(FX_BINDINGS.skchr_blkkgt_2.slash.claim, true);
    assert.equal(FX_BINDINGS.skchr_tinman_2.zone.claim, true);
    assert.equal(FX_BINDINGS.skchr_ascln_2.aoe.claim, true);
    assert.equal(FX_BINDINGS.skchr_ascln_2.aoe.keys.includes('ascln_buff_01'), false);
    const p = FX_BINDINGS.skchr_philae_2;
    assert.deepEqual([...p.philaeRage.keys], [P_START]);
    assert.equal(p.philaeRage.oneshot, true);
    assert.equal(p.philaeRage.tag, 'philae:rage');
    assert.deepEqual([...p.philaeRageLoop.keys], [P_LOOP]);
    assert.equal(p.philaeRageLoop.hold, 'skill');
    const a = FX_BINDINGS.skchr_amiya3_1.amiyaHeal;
    assert.deepEqual([...a.keys], [A_RANGE]);
    assert.equal(a.at, 'point');
    assert.equal(a.oneshot, true);
    assert.equal(a.tag, 'amiya3:empathy');
    assert.equal(fxSpec('philaeRage').a, 'none');
    assert.equal(fxSpec('philaeRageLoop').a, 'none');
    assert.equal(fxSpec('amiyaHeal').a, 'none');
  });

  test('Miss.Christine S2 starts the range on the frame the flask lands, and the hold is measured from the throw', async () => {
    const { w, ofx, view, frame, keys } = await setup();
    const her = view('char_4198_christ', 4, 9, { info: { skillIndex: 1 } });
    w.skill(her, true);
    const t0 = ofx.time;
    assert.equal(w.simFx('zone', 6, 9, { id: her.id, radius: 1.5, dur: 20, skill: 'christ:spirit' }), true);
    assert.ok(keys().includes(C_TRAIL));
    assert.equal(keys().includes(C_RANGE), false);
    assert.equal(keys().includes(C_HIT), false);
    for (let i = 0; i < 7; i++) frame();
    assert.equal(keys().includes(C_RANGE), false, 'still in the air at 7/30 s (flight is 2/8 s)');
    assert.equal(keys().includes(C_HIT), false);
    frame();
    assert.ok(Math.abs((ofx.time - t0) - 8 / 30) < 1e-9);
    assert.equal(keys().filter((k) => k === C_RANGE).length, 1);
    assert.equal(keys().filter((k) => k === C_HIT).length, 1);
    assert.equal(keys().filter((k) => k === C_TRAIL).length, 1);
    assert.equal(ofx.timers.length, 1);
    assert.ok(Math.abs(ofx.timers[0].at - (t0 + 20)) < 1e-6, 'the range stops at throw + window, not landing + window');
    frame();
    assert.equal(keys().filter((k) => k === C_RANGE).length, 1, 'bindsReached does not play the range again');
  });

  test('Miss.Christine S2 plays no range when the spirit window ends before the flask lands', async () => {
    const { w, view, frame, keys } = await setup();
    const her = view('char_4198_christ', 4, 9, { info: { skillIndex: 1 } });
    w.skill(her, true);
    assert.equal(w.simFx('zone', 6, 9, { id: her.id, radius: 1.5, dur: 0.1, skill: 'christ:spirit' }), true);
    assert.ok(keys().includes(C_TRAIL));
    for (let i = 0; i < 8; i++) frame();
    assert.equal(keys().includes(C_RANGE), false);
    assert.equal(keys().filter((k) => k === C_HIT).length, 1, 'the hit is not the range');
  });

  test('Miss.Christine S2 plays nothing with 官方特效 off or with the range prefab missing', async () => {
    const off = await setup({ active: false });
    const her = off.view('char_4198_christ', 4, 9, { info: { skillIndex: 1 } });
    off.w.skill(her, true);
    assert.equal(off.w.simFx('zone', 6, 9, { id: her.id, dur: 20, skill: 'christ:spirit' }), false);
    assert.equal(off.keys().length, 0);
    const bare = await setup({ installed: ALL.filter((k) => k !== C_RANGE) });
    const b = bare.view('char_4198_christ', 4, 9, { info: { skillIndex: 1 } });
    bare.w.skill(b, true);
    assert.equal(bare.w.simFx('zone', 6, 9, { id: b.id, dur: 20, skill: 'christ:spirit' }), false);
    assert.equal(bare.keys().includes(C_TRAIL), false, 'no range prefab, so the throw is not claimed');
  });

  test('承曦格雷伊 S2 starts the range when the ball lands, and the hold is measured from the throw', async () => {
    const { w, ofx, view, frame, keys } = await setup();
    const her = view('char_1027_greyy2', 4, 9, { info: { skillIndex: 1 } });
    w.skill(her, true);
    const t0 = ofx.time;
    assert.equal(w.simFx('zone', 6, 9, { id: her.id, radius: 1, dur: 8 }), true);
    assert.ok(keys().includes(G_TRAIL));
    assert.equal(keys().includes(G_RANGE), false);
    assert.equal(keys().includes(G_HIT), false);
    for (let i = 0; i < 7; i++) frame();
    assert.equal(keys().includes(G_RANGE), false, 'still in the air at 7/30 s (flight is 2/8 s)');
    frame();
    assert.equal(keys().filter((k) => k === G_RANGE).length, 1);
    assert.equal(keys().filter((k) => k === G_HIT).length, 1);
    assert.equal(keys().filter((k) => k === G_TRAIL).length, 1);
    assert.equal(ofx.timers.length, 1);
    assert.ok(Math.abs(ofx.timers[0].at - (t0 + 8)) < 1e-6, 'the range stops at throw + window');
    assert.equal(w.simFx('zone', 6, 9, { id: her.id, radius: 1, dur: 8 }), true, 'a re-sent zone is covered');
    assert.equal(keys().filter((k) => k === G_TRAIL).length, 1, 'the covered tile does not fly a second ball');
  });

  test('菲莱 S2 plays the rage oneshot and the loop on the tagged pair, and stops the loop with the skill', async () => {
    const { w, view, handles, keys } = await setup();
    const her = view('char_4148_philae', 4, 9, { info: { skillIndex: 1 } });
    w.skill(her, true);
    assert.equal(w.simFx('philaeRage', her.x, her.y, { id: her.id }), false, 'no skill tag');
    assert.equal(w.simFx('philaeRage', her.x, her.y, { id: her.id, skill: 'philae:rage' }), true);
    assert.equal(w.simFx('philaeRageLoop', her.x, her.y, { id: her.id, skill: 'philae:rage' }), true);
    const start = handles.find((h) => h.key === P_START);
    const loop = handles.find((h) => h.key === P_LOOP);
    assert.ok(start && start.opts.loop !== true);
    assert.ok(loop && loop.opts.loop === true && typeof loop.opts.track === 'function');
    assert.equal(keys().filter((k) => k === P_START).length, 1);
    assert.equal(keys().filter((k) => k === P_LOOP).length, 1);
    w.skill(her, false);
    assert.ok(loop.stopped, 'the buff ends with the skill');
  });

  test('菲莱 S2 and 阿米娅 S1 play nothing with 官方特效 off, before the skill, or without the tag', async () => {
    const off = await setup({ active: false });
    const p = off.view('char_4148_philae', 4, 9, { info: { skillIndex: 1 } });
    const a = off.view('char_1037_amiya3', 5, 9);
    off.w.skill(p, true);
    off.w.skill(a, true);
    assert.equal(off.w.simFx('philaeRage', 4, 9, { id: p.id, skill: 'philae:rage' }), false);
    assert.equal(off.w.simFx('philaeRageLoop', 4, 9, { id: p.id, skill: 'philae:rage' }), false);
    assert.equal(off.w.simFx('amiyaHeal', 5, 9, { id: a.id, skill: 'amiya3:empathy' }), false);
    assert.equal(off.keys().length, 0);
    const { w, view, keys } = await setup();
    const late = view('char_1037_amiya3', 5, 9);
    assert.equal(w.simFx('amiyaHeal', 5, 9, { id: late.id, skill: 'amiya3:empathy' }), false, 'the skill is not on');
    w.skill(late, true);
    assert.equal(w.simFx('amiyaHeal', 5, 9, { id: late.id }), false);
    assert.equal(w.simFx('amiyaHeal', 6, 9, { id: late.id, skill: 'amiya3:empathy' }), true);
    const h = keys();
    assert.deepEqual(h.filter((k) => k === A_RANGE), [A_RANGE]);
    assert.equal(keys().includes(P_START), false);
  });
});

const INDEX = 'public/assets/local/fx/index.json';

describe('round 87 lane h2 against the extracted index', { skip: !fs.existsSync(INDEX) && 'no public/assets/local/fx/index.json' }, () => {
  const idx = fs.existsSync(INDEX) ? JSON.parse(fs.readFileSync(INDEX, 'utf8')) : null;
  const reasons = (skillId, key) => {
    const plan = skillPlan(idx, null, skillId, { rec: { skillId, duration: 15, durationType: 'SECONDS' } });
    return plan.unmapped.filter((u) => u.key === key).map((u) => u.reason);
  };

  test('wired keys are bound and the rows left unwired keep their reason', () => {
    for (const [skill, key] of [
      ['skchr_philae_2', 'philae_skill_02_buff_02'],
      ['skchr_philae_2', 'philae_skill_02_start_02'],
      ['skchr_amiya3_1', 'amiya3_skill_01_range'],
      ['skchr_blkkgt_2', 'blkkgt_skill_02_hit_1'],
      ['skchr_tinman_2', 'tinman_skill_02_hit_01'],
      ['skchr_ascln_2', 'ascln_skill_02_death_01'],
      ['skchr_ascln_2', 'ascln_buff_01'],
      ['skchr_aphris_2', 'aphris_skill_02_hit_01'],
      ['skchr_aphris_2', 'aphris_skill_02_line_01'],
      ['skchr_aphris_2', 'aphris_skill_02_line_point_01'],
      ['skchr_aphris_2', 'aphris_skill_02_start_01'],
      ['skchr_aphris_2', 'token_aphris_pc_skill_02_buff_01'],
    ]) {
      const got = reasons(skill, key);
      assert.ok(got.length > 0 && got.every((r) => r === 'bound'), `${skill} ${key} ${got.join(',')}`);
    }
    for (const [skill, key, reason] of [
      ['skchr_lessng_2', 'lessng_skill_02_buff_2', 'conditional'],
      ['skchr_lumen_2', 'lumen_skill_02_buff', 'conditional'],
      ['skchr_lumen_2', 'lumen_skill_02_buff_02', 'conditional'],
      ['skchr_highmo_2', 'highmo_recover_01', 'conditional'],
      ['skchr_gnosis_2', 'gnosis_skill_02_buff_01', 'conditional'],
      ['skchr_gnosis_2', 'gnosis_skill_02_buff_02', 'conditional'],
      ['skchr_titi_3', 'titi_skill_03_hit_02', 'tick'],
      ['skchr_mlyss_3', 'token_10030_mlyss_wtrman_c2_skill_03_buff_01', 'conditional'],
      ['skchr_nearl2_3', 'nearl2_buff_01_start', 'conditional'],
      ['skchr_malist_2', 'malist_skill_2_buff', 'conditional'],
      ['skchr_malist_2', 'malist_skill_2_buff_weapon', 'conditional'],
      ['skchr_demetr_1', 'demetr_buff_01', 'conditional'],
      ['skchr_caper_1', 'caper_skill_01_buff', 'conditional'],
      ['skchr_cetsyr_2', 'cetsyr_skill_02_tie', 'conditional'],
      ['skchr_shwaz_1', 'buff_defdown', 'conditional'],
    ]) {
      const got = reasons(skill, key);
      assert.ok(got.includes(reason), `${skill} ${key} ${got.join(',')}`);
      assert.equal(got.includes('bound'), false, `${skill} ${key}`);
    }
  });

  test('idle projectiles with nothing to fly stay off the binding keys', () => {
    const idle = (skillId, projId) => {
      const plan = skillPlan(idx, null, skillId, { rec: { skillId, duration: 15 } });
      assert.equal(plan.attacks.length, 0, skillId);
      assert.ok(plan.projectiles.includes(projId), `${skillId} ${projId}`);
      const bound = new Set(bindingKeys(idx, skillId));
      const proj = idx.projectiles[projId] || {};
      const keys = [projId, proj.main, ...(proj.onHit || []), ...(proj.onReached || [])].filter((k) => typeof k === 'string');
      assert.equal(keys.some((k) => bound.has(k.toLowerCase())), false, projId);
    };
    idle('skchr_sleach_3', 'projectile_chr_sleach_t1_2');
    // round 88 g2 plays these (orbitfx.js / bouncefx.js). Their mains and hits are binding keys now.
    const played = (skillId, projId) => {
      const plan = skillPlan(idx, null, skillId, { rec: { skillId, duration: 15 } });
      assert.equal(plan.attacks.length, 0, skillId);
      assert.ok(plan.projectiles.includes(projId), `${skillId} ${projId}`);
      const bound = new Set(bindingKeys(idx, skillId));
      const proj = idx.projectiles[projId] || {};
      const keys = [projId, proj.main, ...(proj.onHit || []), ...(proj.onReached || [])].filter((k) => typeof k === 'string');
      assert.equal(keys.some((k) => bound.has(k.toLowerCase())), true, projId);
    };
    played('skchr_mantra_3', 'projectile_chr_mantra_s3_2');
    played('skchr_cetsyr_1', 'projectile_chr_cetsyr_talent_s1');
    played('skchr_cetsyr_2', 'projectile_chr_cetsyr_talent');
    played('skchr_cetsyr_2', 'projectile_chr_cetsyr_talent_s2');
    played('skchr_cetsyr_3', 'projectile_chr_cetsyr_talent');
    played('skchr_cetsyr_3', 'projectile_chr_cetsyr_talent_s3');
  });
});
